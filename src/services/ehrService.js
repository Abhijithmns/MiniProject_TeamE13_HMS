'use strict';

const crypto = require('crypto');
const db = require('../db');

// 24 hours in milliseconds (US-10 / FR-EHR-03)
const LOCKOUT_PERIOD_MS = 24 * 60 * 60 * 1000;

class EHRService {
  /**
   * Validate blood pressure string (e.g. "120/80")
   */
  isValidBP(bp) {
    if (!bp || typeof bp !== 'string') return false;
    return /^\d{2,3}\/\d{2,3}$/.test(bp.trim());
  }

  /**
   * Record visit notes, vitals, diagnosis, and prescriptions (US-09 / FR-EHR-01, FR-EHR-02)
   */
  recordConsultation({
    appointmentId,
    patientId,
    vitals = {},
    symptoms = '',
    examinationNotes = '',
    diagnosis,
    prescriptions = [],
    actorUserId,
    actorRole,
    doctorName,
    clientIp
  }) {
    const errors = [];

    // Role verification (FR-EHR-01): Only DOCTOR and ADMIN can create clinical consultation notes
    if (actorRole !== 'DOCTOR' && actorRole !== 'ADMIN') {
      db.appendAuditLog({
        actorUserId: actorUserId || 'ANONYMOUS',
        actorRole: actorRole || 'NONE',
        clientIp: clientIp || '127.0.0.1',
        actionType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        targetResource: 'EHR_CONSULTATION',
        status: 'DENIED',
        details: `Role ${actorRole} attempted to record clinical consultation notes`
      });

      const err = new Error('Access Denied: Only consulting doctors can record clinical notes.');
      err.status = 403;
      err.type = 'https://hms.hospital.com/errors/forbidden';
      throw err;
    }

    // Patient ID validation
    if (!patientId || String(patientId).trim() === '') {
      errors.push('Patient ID is mandatory.');
    }

    const patient = patientId ? db.findPatientById(patientId) : null;
    if (patientId && !patient) {
      const err = new Error(`Patient record with ID ${patientId} not found.`);
      err.status = 404;
      err.type = 'https://hms.hospital.com/errors/patient-not-found';
      throw err;
    }

    // Diagnosis validation (FR-EHR-02)
    if (!diagnosis || typeof diagnosis !== 'string' || diagnosis.trim() === '') {
      errors.push('Clinical diagnosis is mandatory.');
    }

    // Vitals validation if provided
    if (vitals && typeof vitals === 'object') {
      if (vitals.bloodPressure && !this.isValidBP(vitals.bloodPressure)) {
        errors.push('Blood pressure must be in standard format (e.g., "120/80").');
      }
      if (vitals.pulse !== undefined && vitals.pulse !== null && vitals.pulse !== '') {
        const pulse = Number(vitals.pulse);
        if (isNaN(pulse) || pulse < 30 || pulse > 250) {
          errors.push('Pulse must be a realistic number between 30 and 250 bpm.');
        }
      }
      if (vitals.temperature !== undefined && vitals.temperature !== null && vitals.temperature !== '') {
        const temp = Number(vitals.temperature);
        if (isNaN(temp) || temp < 90 || temp > 110) {
          errors.push('Temperature must be a realistic number between 90 and 110 °F.');
        }
      }
      if (vitals.spo2 !== undefined && vitals.spo2 !== null && vitals.spo2 !== '') {
        const spo2 = Number(vitals.spo2);
        if (isNaN(spo2) || spo2 < 50 || spo2 > 100) {
          errors.push('SpO2 must be a percentage between 50 and 100.');
        }
      }
    }

    // Prescriptions validation (FR-EHR-02)
    if (!Array.isArray(prescriptions)) {
      errors.push('Prescriptions must be an array of medications.');
    } else {
      prescriptions.forEach((rx, index) => {
        if (!rx.name || typeof rx.name !== 'string' || rx.name.trim() === '') {
          errors.push(`Prescription item ${index + 1}: Medicine name is required.`);
        }
        if (!rx.dosage || typeof rx.dosage !== 'string' || rx.dosage.trim() === '') {
          errors.push(`Prescription item ${index + 1}: Dosage is required.`);
        }
      });
    }

    if (errors.length > 0) {
      const err = new Error(`Consultation validation failed: ${errors.join(' ')}`);
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/validation-failed';
      err.errors = errors;
      throw err;
    }

    // Generate Consultation ID (e.g. CNS-102941)
    const consultationId = `CNS-${Math.floor(100000 + Math.random() * 900000)}`;
    const timestamp = new Date().toISOString();

    // Generate Cryptographic SHA-256 Verification Hash (FR-EHR-04 / SEC-REQ-2.2 / SADS §6.2 autonumber 295)
    const hashPayload = JSON.stringify({
      consultationId,
      appointmentId: appointmentId || null,
      patientId: String(patientId),
      doctorId: actorUserId,
      diagnosis: diagnosis.trim(),
      prescriptions,
      createdAt: timestamp
    });
    const prescriptionHash = `sha256:${crypto.createHash('sha256').update(hashPayload).digest('hex')}`;

    // Create and save consultation record
    const consultation = db.createConsultation({
      consultationId,
      appointmentId: appointmentId || `APT-${Date.now().toString().slice(-4)}`,
      patientId: String(patientId),
      doctorId: actorUserId,
      doctorName: doctorName || 'Consulting Doctor',
      symptoms: Array.isArray(symptoms) ? symptoms.join(', ') : (symptoms ? String(symptoms).trim() : ''),
      examinationNotes: examinationNotes ? examinationNotes.trim() : '',
      vitals: {
        bloodPressure: vitals?.bloodPressure?.trim() || null,
        pulse: vitals?.pulse ? Number(vitals.pulse) : null,
        temperature: vitals?.temperature ? Number(vitals.temperature) : null,
        spo2: vitals?.spo2 ? Number(vitals.spo2) : null
      },
      diagnosis: diagnosis.trim(),
      prescriptions: prescriptions.map((p, idx) => ({
        medicationId: p.medicationId || `MED-${(idx + 1).toString().padStart(3, '0')}`,
        name: p.name.trim(),
        dosage: p.dosage.trim(),
        quantity: p.quantity !== undefined ? parseInt(p.quantity, 10) : 1,
        frequency: p.frequency ? p.frequency.trim() : 'Once daily',
        durationDays: p.durationDays ? Number(p.durationDays) : 5,
        instructions: p.instructions ? p.instructions.trim() : 'Take after meals'
      })),
      prescriptionHash,
      addenda: [],
      createdAt: timestamp,
      updatedAt: timestamp
    });

    // Automatically queue verified prescriptions to hospital pharmacy queue (FR-PHARM-01 / SADS §6.2)
    if (consultation.prescriptions.length > 0) {
      db.enqueuePrescription({
        consultationId: consultation.consultationId,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
        prescriptions: consultation.prescriptions,
        prescriptionHash: consultation.prescriptionHash
      });
    }

    // Append to immutable audit log (SEC-REQ-2.1 / SADS §6.2)
    db.appendAuditLog({
      actorUserId,
      actorRole,
      clientIp: clientIp || '127.0.0.1',
      actionType: 'EHR_CREATE',
      targetResource: `CONSULTATION:${consultationId}`,
      status: 'SUCCESS',
      details: `Consultation recorded for patient ${patientId} (Doctor: ${actorUserId}) with diagnosis: ${diagnosis.trim()}`
    });

    return {
      consultationId,
      consultation,
      prescriptionHash,
      downloadUrl: `/api/v1/ehr/consultations/${consultationId}/prescription`
    };
  }

  /**
   * Update clinical consultation notes within 24-hour lockout window (US-10 / FR-EHR-03, TC-HMS-05)
   */
  updateConsultation(consultationId, updates, {
    actorUserId,
    actorRole,
    doctorName,
    clientIp,
    currentTime = Date.now()
  }) {
    const consultation = db.findConsultationById(consultationId);
    if (!consultation) {
      const err = new Error(`Consultation record ${consultationId} not found.`);
      err.status = 404;
      err.type = 'https://hms.hospital.com/errors/not-found';
      throw err;
    }

    // Role verification (FR-EHR-01): Only assigned doctor or ADMIN can edit
    if (actorRole !== 'ADMIN' && consultation.doctorId !== actorUserId) {
      db.appendAuditLog({
        actorUserId: actorUserId || 'ANONYMOUS',
        actorRole: actorRole || 'NONE',
        clientIp: clientIp || '127.0.0.1',
        actionType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        targetResource: `CONSULTATION:${consultationId}`,
        status: 'DENIED',
        details: `Unauthorized attempt to edit consultation notes: doctor ${actorUserId} is not the author (${consultation.doctorId})`
      });

      const err = new Error('Access Denied: Only the assigned consulting doctor can edit clinical notes.');
      err.status = 403;
      err.type = 'https://hms.hospital.com/errors/forbidden';
      throw err;
    }

    // 24-Hour Lockout check (FR-EHR-03 / TC-HMS-05)
    const createdTimeMs = new Date(consultation.createdAt).getTime();
    const elapsedMs = (typeof currentTime === 'number' ? currentTime : new Date(currentTime).getTime()) - createdTimeMs;

    if (elapsedMs > LOCKOUT_PERIOD_MS || consultation.lockedAt) {
      db.appendAuditLog({
        actorUserId: actorUserId || 'ANONYMOUS',
        actorRole: actorRole || 'NONE',
        clientIp: clientIp || '127.0.0.1',
        actionType: 'EHR_UPDATE_LOCKED_ATTEMPT',
        targetResource: `CONSULTATION:${consultationId}`,
        status: 'DENIED',
        details: `Direct edit rejected: record locked after 24 hours (elapsed: ${(elapsedMs / 3600000).toFixed(1)} hrs)`
      });

      const err = new Error('403 Forbidden: Direct edits prohibited; submit addendum.');
      err.status = 403;
      err.type = 'https://hms.hospital.com/errors/record-locked';
      throw err;
    }

    // Validate updates
    const allowedUpdates = {};
    if (updates.diagnosis !== undefined) {
      if (!updates.diagnosis || typeof updates.diagnosis !== 'string' || updates.diagnosis.trim() === '') {
        const err = new Error('Clinical diagnosis cannot be empty.');
        err.status = 400;
        throw err;
      }
      allowedUpdates.diagnosis = updates.diagnosis.trim();
    }

    if (updates.symptoms !== undefined) {
      allowedUpdates.symptoms = String(updates.symptoms).trim();
    }

    if (updates.examinationNotes !== undefined) {
      allowedUpdates.examinationNotes = String(updates.examinationNotes).trim();
    }

    if (updates.vitals && typeof updates.vitals === 'object') {
      if (updates.vitals.bloodPressure && !this.isValidBP(updates.vitals.bloodPressure)) {
        const err = new Error('Blood pressure must be in standard format (e.g. "120/80").');
        err.status = 400;
        throw err;
      }
      allowedUpdates.vitals = {
        ...consultation.vitals,
        ...updates.vitals
      };
    }

    const updatedRecord = db.updateConsultation(consultationId, allowedUpdates);

    // Immutable audit logging (SEC-REQ-2.1)
    db.appendAuditLog({
      actorUserId,
      actorRole,
      clientIp: clientIp || '127.0.0.1',
      actionType: 'EHR_UPDATE',
      targetResource: `CONSULTATION:${consultationId}`,
      status: 'SUCCESS',
      details: `Consultation notes updated within 24-hour window by ${actorUserId}`
    });

    return updatedRecord;
  }

  /**
   * Append an immutable addendum to clinical notes after 24-hour lock (US-10 / FR-EHR-03)
   */
  appendAddendum(consultationId, {
    note,
    actorUserId,
    actorRole,
    doctorName,
    clientIp,
    timestamp = new Date().toISOString()
  }) {
    const consultation = db.findConsultationById(consultationId);
    if (!consultation) {
      const err = new Error(`Consultation record ${consultationId} not found.`);
      err.status = 404;
      err.type = 'https://hms.hospital.com/errors/not-found';
      throw err;
    }

    // Role check: Only DOCTOR or ADMIN can add an addendum
    if (actorRole !== 'DOCTOR' && actorRole !== 'ADMIN') {
      db.appendAuditLog({
        actorUserId: actorUserId || 'ANONYMOUS',
        actorRole: actorRole || 'NONE',
        clientIp: clientIp || '127.0.0.1',
        actionType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        targetResource: `CONSULTATION:${consultationId}:ADDENDUM`,
        status: 'DENIED',
        details: `Role ${actorRole} attempted to append addendum to clinical notes`
      });

      const err = new Error('Access Denied: Only physicians can append addenda to medical records.');
      err.status = 403;
      err.type = 'https://hms.hospital.com/errors/forbidden';
      throw err;
    }

    if (!note || typeof note !== 'string' || note.trim() === '') {
      const err = new Error('Addendum text note is required and cannot be empty.');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/validation-failed';
      throw err;
    }

    const addendum = {
      addendumId: `ADD-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`,
      note: note.trim(),
      doctorUserId: actorUserId,
      doctorName: doctorName || 'Consulting Physician',
      timestamp: typeof timestamp === 'string' ? timestamp : new Date(timestamp).toISOString()
    };

    const updatedConsultation = db.addConsultationAddendum(consultationId, addendum);

    // Audit log (SEC-REQ-2.1)
    db.appendAuditLog({
      actorUserId,
      actorRole,
      clientIp: clientIp || '127.0.0.1',
      actionType: 'EHR_ADDENDUM',
      targetResource: `CONSULTATION:${consultationId}`,
      status: 'SUCCESS',
      details: `Addendum ${addendum.addendumId} appended by Dr. ${addendum.doctorName} (${actorUserId})`
    });

    return {
      consultationId,
      addendum,
      consultation: updatedConsultation
    };
  }

  /**
   * Retrieve consultation details by ID with RBAC and confidential note shielding (US-03 / FR-AUTH-04)
   */
  getConsultationById(consultationId, { actorUserId, actorRole, clientIp }) {
    const consultation = db.findConsultationById(consultationId);
    if (!consultation) {
      const err = new Error(`Consultation record ${consultationId} not found.`);
      err.status = 404;
      err.type = 'https://hms.hospital.com/errors/not-found';
      throw err;
    }

    // Boundary check (FR-AUTH-04): Receptionists CANNOT read clinical diagnosis notes
    if (actorRole === 'RECEPTIONIST') {
      db.appendAuditLog({
        actorUserId: actorUserId || 'ANONYMOUS',
        actorRole,
        clientIp: clientIp || '127.0.0.1',
        actionType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        targetResource: `CONSULTATION:${consultationId}`,
        status: 'DENIED',
        details: 'Receptionist attempted to read confidential clinical diagnosis notes'
      });

      const err = new Error('Access Denied: Receptionists are not authorized to view clinical examination notes.');
      err.status = 403;
      err.type = 'https://hms.hospital.com/errors/forbidden';
      throw err;
    }

    // Audit view event
    db.appendAuditLog({
      actorUserId: actorUserId || 'ANONYMOUS',
      actorRole: actorRole || 'NONE',
      clientIp: clientIp || '127.0.0.1',
      actionType: 'EHR_VIEW',
      targetResource: `CONSULTATION:${consultationId}`,
      status: 'SUCCESS',
      details: `Consultation record ${consultationId} viewed by ${actorRole}`
    });

    return consultation;
  }

  /**
   * Retrieve all consultations for a patient
   */
  getPatientConsultations(patientId, { actorUserId, actorRole, clientIp }) {
    if (actorRole === 'RECEPTIONIST') {
      const err = new Error('Access Denied: Receptionists cannot access clinical consultation records.');
      err.status = 403;
      err.type = 'https://hms.hospital.com/errors/forbidden';
      throw err;
    }

    const consultations = db.getConsultationsByPatientId(patientId);

    db.appendAuditLog({
      actorUserId: actorUserId || 'ANONYMOUS',
      actorRole: actorRole || 'NONE',
      clientIp: clientIp || '127.0.0.1',
      actionType: 'EHR_PATIENT_HISTORY_VIEW',
      targetResource: `PATIENT_EHR:${patientId}`,
      status: 'SUCCESS',
      details: `Viewed ${consultations.length} consultation entries for patient ${patientId}`
    });

    return consultations;
  }
}

const ehrService = new EHRService();
module.exports = ehrService;
