'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const prescriptionService = require('../src/services/prescriptionService');
const patientService = require('../src/services/patientService');
const db = require('../src/db');

describe('Sprint 2: [US-11 / TC-HMS-06] Download Digital Prescription as PDF', () => {
  let seededPatient;

  beforeEach(() => {
    db.reset();
    seededPatient = patientService.registerPatient({
      name: 'Rohan Sharma',
      dateOfBirth: '1988-10-14',
      gender: 'MALE',
      phone: '9876543210',
      bloodGroup: 'O+',
      emergencyContact: 'Meena Sharma',
      actorUserId: 'USR-REC-01',
      actorRole: 'RECEPTIONIST'
    });
  });

  describe('Input Validation & Creation (FR-EHR-04)', () => {
    test('should reject prescription when patient does not exist', () => {
      assert.throws(
        () => {
          prescriptionService.createPrescription({
            patientId: '0000000000',
            diagnosis: 'Viral Fever',
            medicines: [{ name: 'Paracetamol', dosage: '500mg', frequency: 'TID', duration: '5 days' }],
            actorUserId: 'USR-DOC-01',
            actorName: 'Dr. Sarah Smith',
            actorRole: 'DOCTOR'
          });
        },
        (err) => {
          assert.strictEqual(err.status, 400);
          assert.ok(err.message.includes('not found'));
          return true;
        }
      );
    });

    test('should reject prescription when diagnosis is empty', () => {
      assert.throws(
        () => {
          prescriptionService.createPrescription({
            patientId: seededPatient.patientId,
            diagnosis: '',
            medicines: [{ name: 'Paracetamol', dosage: '500mg', frequency: 'TID', duration: '5 days' }],
            actorUserId: 'USR-DOC-01',
            actorName: 'Dr. Sarah Smith',
            actorRole: 'DOCTOR'
          });
        },
        (err) => {
          assert.strictEqual(err.status, 400);
          assert.ok(err.message.includes('Diagnosis'));
          return true;
        }
      );
    });

    test('should reject prescription when medicine list is empty or malformed', () => {
      assert.throws(
        () => {
          prescriptionService.createPrescription({
            patientId: seededPatient.patientId,
            diagnosis: 'Hypertension',
            medicines: [],
            actorUserId: 'USR-DOC-01',
            actorName: 'Dr. Sarah Smith',
            actorRole: 'DOCTOR'
          });
        },
        (err) => {
          assert.strictEqual(err.status, 400);
          assert.ok(err.message.includes('At least one medicine'));
          return true;
        }
      );
    });

    test('should successfully issue digital prescription with doctor, patient, vitals, and medicines', () => {
      const rx = prescriptionService.createPrescription({
        patientId: seededPatient.patientId,
        diagnosis: 'Acute Bronchitis',
        vitals: {
          bp: '120/80',
          temperature: '98.6 F',
          weight: '70 kg',
          pulse: '72 bpm'
        },
        medicines: [
          { name: 'Amoxicillin', dosage: '500mg', frequency: 'Every 8 hours', duration: '7 days' },
          { name: 'Cetirizine', dosage: '10mg', frequency: 'Once daily at bedtime', duration: '5 days' }
        ],
        actorUserId: 'USR-DOC-01',
        actorName: 'Dr. Sarah Smith',
        actorRole: 'DOCTOR'
      });

      assert.ok(rx.prescriptionId.startsWith('RX-2026-'));
      assert.strictEqual(rx.patientId, seededPatient.patientId);
      assert.strictEqual(rx.patientName, 'Rohan Sharma');
      assert.strictEqual(rx.doctorName, 'Dr. Sarah Smith');
      assert.strictEqual(rx.vitals.bp, '120/80');
      assert.strictEqual(rx.medicines.length, 2);
      assert.ok(rx.verificationCode, 'Must generate verification code');
    });
  });

  describe('Tamper-Evident Verification Code (SEC-REQ-2.2)', () => {
    test('should generate 16-character HMAC verification code', () => {
      const rx = prescriptionService.createPrescription({
        patientId: seededPatient.patientId,
        diagnosis: 'Migraine',
        medicines: [{ name: 'Sumatriptan', dosage: '50mg', frequency: 'As needed', duration: '3 days' }],
        actorUserId: 'USR-DOC-01',
        actorName: 'Dr. Sarah Smith',
        actorRole: 'DOCTOR'
      });

      assert.strictEqual(rx.verificationCode.length, 16);
      assert.match(rx.verificationCode, /^[A-F0-9]{16}$/);
    });

    test('should verify valid prescription code as genuine', () => {
      const rx = prescriptionService.createPrescription({
        patientId: seededPatient.patientId,
        diagnosis: 'Gastritis',
        medicines: [{ name: 'Omeprazole', dosage: '20mg', frequency: 'Once daily before breakfast', duration: '14 days' }],
        actorUserId: 'USR-DOC-01',
        actorName: 'Dr. Sarah Smith',
        actorRole: 'DOCTOR'
      });

      const verifyResult = prescriptionService.verifyPrescription(rx.prescriptionId);
      assert.strictEqual(verifyResult.isValid, true);
      assert.strictEqual(verifyResult.verificationCode, rx.verificationCode);
    });
  });

  describe('PDF Generation & Download (FR-EHR-04)', () => {
    test('should generate valid PDF binary buffer', async () => {
      const rx = prescriptionService.createPrescription({
        patientId: seededPatient.patientId,
        diagnosis: 'Type 2 Diabetes Routine Check',
        vitals: { bp: '130/85', pulse: '76 bpm' },
        medicines: [
          { name: 'Metformin', dosage: '500mg', frequency: 'Twice daily with meals', duration: '30 days' }
        ],
        actorUserId: 'USR-DOC-01',
        actorName: 'Dr. Sarah Smith',
        actorRole: 'DOCTOR'
      });

      const pdfBuffer = await prescriptionService.generatePrescriptionPdf(
        rx.prescriptionId,
        'USR-PAT-01',
        'PATIENT'
      );

      assert.ok(Buffer.isBuffer(pdfBuffer));
      assert.ok(pdfBuffer.length > 500, 'PDF buffer should have non-trivial size');
      // Verify PDF header magic bytes: %PDF-
      const header = pdfBuffer.slice(0, 5).toString('ascii');
      assert.strictEqual(header, '%PDF-');
    });

    test('should record audit trail log on prescription PDF download', async () => {
      const rx = prescriptionService.createPrescription({
        patientId: seededPatient.patientId,
        diagnosis: 'Seasonal Allergies',
        medicines: [{ name: 'Loratadine', dosage: '10mg', frequency: 'Once daily', duration: '10 days' }],
        actorUserId: 'USR-DOC-01',
        actorName: 'Dr. Sarah Smith',
        actorRole: 'DOCTOR'
      });

      await prescriptionService.generatePrescriptionPdf(rx.prescriptionId, 'USR-PAT-01', 'PATIENT');

      const logs = db.getAuditLogs();
      const downloadLog = logs.find(l => l.actionType === 'PRESCRIPTION_PDF_DOWNLOAD');
      assert.ok(downloadLog, 'Audit log entry must be present');
      assert.strictEqual(downloadLog.status, 'SUCCESS');
      assert.ok(downloadLog.targetResource.includes(rx.prescriptionId));
    });
  });

  describe('Patient Prescriptions History', () => {
    test('should list all prescriptions for given patient', () => {
      prescriptionService.createPrescription({
        patientId: seededPatient.patientId,
        diagnosis: 'Checkup 1',
        medicines: [{ name: 'Vitamin D', dosage: '1000 IU', frequency: 'Daily', duration: '30 days' }],
        actorUserId: 'USR-DOC-01',
        actorName: 'Dr. Sarah Smith',
        actorRole: 'DOCTOR'
      });

      prescriptionService.createPrescription({
        patientId: seededPatient.patientId,
        diagnosis: 'Checkup 2',
        medicines: [{ name: 'Calcium', dosage: '500mg', frequency: 'Daily', duration: '30 days' }],
        actorUserId: 'USR-DOC-01',
        actorName: 'Dr. Sarah Smith',
        actorRole: 'DOCTOR'
      });

      const list = prescriptionService.getPrescriptionsByPatient(seededPatient.patientId);
      assert.strictEqual(list.length, 2);
    });
  });
});
