'use strict';

const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const db = require('../db');

const VERIFICATION_SECRET = process.env.PRESCRIPTION_HMAC_SECRET || 'HMS-PRESC-SEC-2026';

/**
 * Prescription Service — US-11 / FR-EHR-04, SEC-REQ-2.2
 * Issues digital prescriptions with HMAC verification codes and PDF generation.
 */
class PrescriptionService {
  /**
   * Generates a unique prescription ID.
   * Format: RX-<year>-<random 8 hex chars>  e.g. RX-2026-A3F9C1D2
   */
  generatePrescriptionId() {
    const year = new Date().getFullYear();
    const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `RX-${year}-${rand}`;
  }

  /**
   * Creates a tamper-evident HMAC-SHA256 verification code for the prescription.
   * (SEC-REQ-2.2) — proves prescription is genuine and untampered.
   */
  generateVerificationCode(prescriptionId, patientId, doctorId, issuedAt) {
    const payload = `${prescriptionId}|${patientId}|${doctorId}|${issuedAt}`;
    return crypto
      .createHmac('sha256', VERIFICATION_SECRET)
      .update(payload)
      .digest('hex')
      .toUpperCase()
      .slice(0, 16); // 16-char human-readable code
  }

  /**
   * Validates prescription input fields.
   */
  validatePrescriptionInput({ patientId, diagnosis, medicines }) {
    const errors = [];

    if (!patientId || String(patientId).trim().length === 0) {
      errors.push('Patient ID is required');
    } else if (!db.findPatientById(patientId)) {
      errors.push(`Patient with ID ${patientId} not found`);
    }

    if (!diagnosis || typeof diagnosis !== 'string' || diagnosis.trim().length < 3) {
      errors.push('Diagnosis is required (minimum 3 characters)');
    }

    if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
      errors.push('At least one medicine is required');
    } else {
      medicines.forEach((med, i) => {
        if (!med.name || !med.dosage || !med.frequency || !med.duration) {
          errors.push(`Medicine #${i + 1}: name, dosage, frequency, and duration are all required`);
        }
      });
    }

    return errors;
  }

  /**
   * Create a new digital prescription (FR-EHR-04).
   * Only DOCTOR role may issue prescriptions.
   */
  createPrescription({ patientId, diagnosis, vitals = {}, medicines, actorUserId, actorName, actorRole, clientIp = '127.0.0.1' }) {
    const errors = this.validatePrescriptionInput({ patientId, diagnosis, medicines });
    if (errors.length > 0) {
      const err = new Error(errors.join('; '));
      err.status = 400;
      err.errors = errors;
      throw err;
    }

    const patient = db.findPatientById(patientId);
    const prescriptionId = this.generatePrescriptionId();
    const issuedAt = new Date().toISOString();
    const verificationCode = this.generateVerificationCode(prescriptionId, patientId, actorUserId, issuedAt);

    const prescription = db.createPrescription({
      prescriptionId,
      patientId,
      patientName: patient.name,
      doctorId: actorUserId,
      doctorName: actorName || actorUserId,
      diagnosis: diagnosis.trim(),
      vitals: {
        bp: vitals.bp || null,
        temperature: vitals.temperature || null,
        weight: vitals.weight || null,
        pulse: vitals.pulse || null
      },
      medicines: medicines.map(m => ({
        name: m.name.trim(),
        dosage: m.dosage.trim(),
        frequency: m.frequency.trim(),
        duration: m.duration.trim()
      })),
      verificationCode,
      issuedAt
    });

    db.appendAuditLog({
      actorUserId,
      actorRole,
      clientIp,
      actionType: 'PRESCRIPTION_ISSUED',
      targetResource: `Prescription:${prescriptionId}`,
      status: 'SUCCESS',
      details: `Prescription ${prescriptionId} issued for patient ${patientId} by ${actorName}`
    });

    return prescription;
  }

  /**
   * Get a prescription by ID.
   */
  getPrescriptionById(prescriptionId) {
    const prescription = db.findPrescriptionById(prescriptionId);
    if (!prescription) {
      const err = new Error(`Prescription ${prescriptionId} not found`);
      err.status = 404;
      throw err;
    }
    return prescription;
  }

  /**
   * Get all prescriptions for a patient.
   */
  getPrescriptionsByPatient(patientId) {
    if (!db.findPatientById(patientId)) {
      const err = new Error(`Patient with ID ${patientId} not found`);
      err.status = 404;
      throw err;
    }
    return db.getPrescriptionsByPatient(patientId);
  }

  /**
   * Verify a prescription's HMAC code — confirms it is genuine and untampered (SEC-REQ-2.2).
   */
  verifyPrescription(prescriptionId) {
    const prescription = this.getPrescriptionById(prescriptionId);
    const expectedCode = this.generateVerificationCode(
      prescription.prescriptionId,
      prescription.patientId,
      prescription.doctorId,
      prescription.issuedAt
    );
    const isValid = expectedCode === prescription.verificationCode;
    return { isValid, prescriptionId, verificationCode: prescription.verificationCode };
  }

  /**
   * Generate a PDF for a prescription (FR-EHR-04).
   * Returns a Buffer containing the PDF bytes.
   */
  generatePrescriptionPdf(prescriptionId, actorUserId, actorRole, clientIp = '127.0.0.1') {
    const prescription = this.getPrescriptionById(prescriptionId);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Header ──────────────────────────────────────────────────────────────
      doc
        .fontSize(22)
        .font('Helvetica-Bold')
        .text('HOSPITAL MANAGEMENT SYSTEM', { align: 'center' });

      doc
        .fontSize(14)
        .font('Helvetica')
        .text('Digital Prescription', { align: 'center' });

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      // ── Prescription Meta ────────────────────────────────────────────────────
      const issued = new Date(prescription.issuedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

      doc.fontSize(10).font('Helvetica-Bold').text('Prescription ID:', { continued: true });
      doc.font('Helvetica').text(`  ${prescription.prescriptionId}`);

      doc.font('Helvetica-Bold').text('Date & Time:', { continued: true });
      doc.font('Helvetica').text(`  ${issued}`);

      doc.moveDown(0.5);

      // ── Doctor Details ───────────────────────────────────────────────────────
      doc.fontSize(12).font('Helvetica-Bold').text('Prescribing Doctor');
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.3);

      doc.fontSize(10).font('Helvetica-Bold').text('Doctor:', { continued: true });
      doc.font('Helvetica').text(`  ${prescription.doctorName}`);

      doc.font('Helvetica-Bold').text('Doctor ID:', { continued: true });
      doc.font('Helvetica').text(`  ${prescription.doctorId}`);

      doc.moveDown(0.5);

      // ── Patient Details ──────────────────────────────────────────────────────
      doc.fontSize(12).font('Helvetica-Bold').text('Patient Details');
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.3);

      doc.fontSize(10).font('Helvetica-Bold').text('Patient Name:', { continued: true });
      doc.font('Helvetica').text(`  ${prescription.patientName}`);

      doc.font('Helvetica-Bold').text('Patient ID (MPI):', { continued: true });
      doc.font('Helvetica').text(`  ${prescription.patientId}`);

      doc.moveDown(0.5);

      // ── Vitals ───────────────────────────────────────────────────────────────
      const v = prescription.vitals;
      if (v.bp || v.temperature || v.weight || v.pulse) {
        doc.fontSize(12).font('Helvetica-Bold').text('Vitals');
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.3);

        doc.fontSize(10);
        if (v.bp)          { doc.font('Helvetica-Bold').text('Blood Pressure:', { continued: true }); doc.font('Helvetica').text(`  ${v.bp}`); }
        if (v.temperature) { doc.font('Helvetica-Bold').text('Temperature:', { continued: true }); doc.font('Helvetica').text(`  ${v.temperature}`); }
        if (v.weight)      { doc.font('Helvetica-Bold').text('Weight:', { continued: true }); doc.font('Helvetica').text(`  ${v.weight}`); }
        if (v.pulse)       { doc.font('Helvetica-Bold').text('Pulse:', { continued: true }); doc.font('Helvetica').text(`  ${v.pulse}`); }

        doc.moveDown(0.5);
      }

      // ── Diagnosis ────────────────────────────────────────────────────────────
      doc.fontSize(12).font('Helvetica-Bold').text('Diagnosis');
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica').text(prescription.diagnosis);
      doc.moveDown(0.5);

      // ── Medicines ────────────────────────────────────────────────────────────
      doc.fontSize(12).font('Helvetica-Bold').text('Medicines Prescribed');
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.3);

      prescription.medicines.forEach((med, i) => {
        doc.fontSize(10).font('Helvetica-Bold').text(`${i + 1}. ${med.name}`);
        doc.font('Helvetica')
          .text(`   Dosage: ${med.dosage}   |   Frequency: ${med.frequency}   |   Duration: ${med.duration}`);
        doc.moveDown(0.2);
      });

      doc.moveDown(0.5);

      // ── Digital Verification Code ─────────────────────────────────────────────
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      doc.fontSize(11).font('Helvetica-Bold').text('Digital Verification Code (SEC-REQ-2.2)', { align: 'center' });
      doc.fontSize(14)
        .font('Courier-Bold')
        .fillColor('#1a56db')
        .text(prescription.verificationCode, { align: 'center' });

      doc.moveDown(0.3);
      doc.fontSize(8)
        .font('Helvetica')
        .fillColor('#555')
        .text(
          'This code is an HMAC-SHA256 tamper-evident signature. Verify at: https://hms.hospital.com/verify',
          { align: 'center' }
        );

      // ── Footer ───────────────────────────────────────────────────────────────
      doc.moveDown(1);
      doc.fontSize(8).fillColor('#888').text(
        'This is a digitally issued prescription. Generated by Hospital Management System v1.0',
        { align: 'center' }
      );

      doc.end();
    }).then(pdfBuffer => {
      db.appendAuditLog({
        actorUserId,
        actorRole,
        clientIp,
        actionType: 'PRESCRIPTION_PDF_DOWNLOAD',
        targetResource: `Prescription:${prescriptionId}`,
        status: 'SUCCESS',
        details: `PDF downloaded for prescription ${prescriptionId}`
      });
      return pdfBuffer;
    });
  }
}

module.exports = new PrescriptionService();

