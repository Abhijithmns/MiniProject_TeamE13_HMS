'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const authService = require('../src/services/authService');
const patientService = require('../src/services/patientService');
const ehrService = require('../src/services/ehrService');

describe('Sprint 2: [US-09 / TC-HMS-05] Doctor Records Visit Notes, Vitals, and Medicines', () => {
  let doctorToken;
  let adminToken;
  let receptionistToken;
  let patientToken;
  let testPatient;

  beforeEach(async () => {
    db.reset();

    // Authenticate Doctor
    const docAuth = await authService.login({
      email: 'doctor.smith@hospital.com',
      password: 'HospSecure#2026'
    });
    doctorToken = docAuth.accessToken;

    // Authenticate Admin
    const adminAuth = await authService.login({
      email: 'admin@hospital.com',
      password: 'HospSecure#2026'
    });
    adminToken = adminAuth.accessToken;

    // Authenticate Receptionist
    const recAuth = await authService.login({
      email: 'receptionist@hospital.com',
      password: 'HospSecure#2026'
    });
    receptionistToken = recAuth.accessToken;

    // Authenticate Patient
    const patAuth = await authService.login({
      email: 'patient.jane@hospital.com',
      password: 'HospSecure#2026'
    });
    patientToken = patAuth.accessToken;

    // Register a test patient
    testPatient = patientService.registerPatient({
      name: 'Robert Langdon',
      dateOfBirth: '1975-04-12',
      gender: 'Male',
      phone: '9876543210',
      bloodGroup: 'A+',
      emergencyContact: 'Sophie Neveu (9876543211)',
      actorUserId: 'USR-REC-01',
      actorRole: 'RECEPTIONIST'
    });
  });

  describe('Consultation Recording (FR-EHR-01, FR-EHR-02)', () => {
    test('should allow doctor to record visit notes, complete vitals, and prescribed medicines', () => {
      const payload = {
        appointmentId: 'APT-1029',
        patientId: testPatient.patientId,
        vitals: {
          bloodPressure: '120/80',
          pulse: 74,
          temperature: 98.6,
          spo2: 99
        },
        symptoms: 'Persistent dry cough and mild fever for 3 days',
        examinationNotes: 'Chest auscultation clear, throat mildly congested',
        diagnosis: 'Acute viral bronchitis',
        prescriptions: [
          {
            medicationId: 'MED-001',
            name: 'Amoxicillin 500mg',
            dosage: '1 capsule',
            frequency: 'TDS (3 times daily)',
            durationDays: 5,
            instructions: 'Take with food'
          },
          {
            medicationId: 'MED-002',
            name: 'Paracetamol 650mg',
            dosage: '1 tablet',
            frequency: 'SOS (when needed)',
            durationDays: 3,
            instructions: 'For fever above 100°F'
          }
        ],
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR',
        doctorName: 'Dr. Sarah Smith'
      };

      const result = ehrService.recordConsultation(payload);

      assert.ok(result.consultationId.startsWith('CNS-'));
      assert.strictEqual(result.consultation.patientId, testPatient.patientId);
      assert.strictEqual(result.consultation.diagnosis, 'Acute viral bronchitis');
      assert.strictEqual(result.consultation.vitals.bloodPressure, '120/80');
      assert.strictEqual(result.consultation.vitals.pulse, 74);
      assert.strictEqual(result.consultation.vitals.temperature, 98.6);
      assert.strictEqual(result.consultation.vitals.spo2, 99);
      assert.strictEqual(result.consultation.prescriptions.length, 2);
      assert.strictEqual(result.consultation.prescriptions[0].name, 'Amoxicillin 500mg');
      assert.ok(result.prescriptionHash.startsWith('sha256:'));
    });

    test('should automatically enqueue prescribed medicines to pharmacy dispensary queue (FR-PHARM-01)', () => {
      ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'Seasonal Allergies',
        prescriptions: [
          {
            medicationId: 'MED-010',
            name: 'Cetirizine 10mg',
            dosage: '1 tablet',
            frequency: 'Once daily at bedtime',
            durationDays: 10
          }
        ],
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR'
      });

      const queue = db.getPharmacyQueue();
      assert.strictEqual(queue.length, 1);
      assert.strictEqual(queue[0].patientId, testPatient.patientId);
      assert.strictEqual(queue[0].status, 'PENDING_DISPENSE');
      assert.strictEqual(queue[0].prescriptions[0].name, 'Cetirizine 10mg');
    });

    test('should record EHR_CREATE in immutable audit log (SEC-REQ-2.1)', () => {
      const initialLogs = db.getAuditLogs().length;

      const res = ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'Hypertension Check',
        vitals: { bloodPressure: '135/85' },
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR'
      });

      const logs = db.getAuditLogs();
      assert.ok(logs.length > initialLogs);

      const ehrLog = logs.find(l => l.actionType === 'EHR_CREATE');
      assert.ok(ehrLog);
      assert.strictEqual(ehrLog.actorUserId, 'USR-DOC-01');
      assert.strictEqual(ehrLog.targetResource, `CONSULTATION:${res.consultationId}`);
      assert.strictEqual(ehrLog.status, 'SUCCESS');
    });
  });

  describe('RBAC & Security Boundaries (FR-EHR-01, FR-AUTH-04)', () => {
    test('should reject consultation creation attempt by RECEPTIONIST with HTTP 403', () => {
      assert.throws(
        () => {
          ehrService.recordConsultation({
            patientId: testPatient.patientId,
            diagnosis: 'Pharyngitis',
            actorUserId: 'USR-REC-01',
            actorRole: 'RECEPTIONIST'
          });
        },
        err => err.status === 403 && err.message.includes('Only consulting doctors can record clinical notes')
      );
    });

    test('should reject consultation creation attempt by PATIENT with HTTP 403', () => {
      assert.throws(
        () => {
          ehrService.recordConsultation({
            patientId: testPatient.patientId,
            diagnosis: 'Self diagnosis',
            actorUserId: 'USR-PAT-01',
            actorRole: 'PATIENT'
          });
        },
        err => err.status === 403
      );
    });

    test('should deny RECEPTIONIST access to view doctor clinical diagnosis notes (US-03 / FR-AUTH-04)', () => {
      const recorded = ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'Confidential Diagnosis',
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR'
      });

      assert.throws(
        () => {
          ehrService.getConsultationById(recorded.consultationId, {
            actorUserId: 'USR-REC-01',
            actorRole: 'RECEPTIONIST'
          });
        },
        err => err.status === 403 && err.message.includes('Receptionists are not authorized to view clinical examination notes')
      );
    });
  });

  describe('Input Validation & Error Handling (RFC 7807)', () => {
    test('should reject consultation if patientId does not exist with 404', () => {
      assert.throws(
        () => {
          ehrService.recordConsultation({
            patientId: '9999999999',
            diagnosis: 'General Checkup',
            actorUserId: 'USR-DOC-01',
            actorRole: 'DOCTOR'
          });
        },
        err => err.status === 404 && err.message.includes('not found')
      );
    });

    test('should reject consultation if diagnosis is missing with 400', () => {
      assert.throws(
        () => {
          ehrService.recordConsultation({
            patientId: testPatient.patientId,
            diagnosis: '',
            actorUserId: 'USR-DOC-01',
            actorRole: 'DOCTOR'
          });
        },
        err => err.status === 400 && err.errors.some(e => e.includes('diagnosis is mandatory'))
      );
    });

    test('should reject invalid blood pressure format with 400', () => {
      assert.throws(
        () => {
          ehrService.recordConsultation({
            patientId: testPatient.patientId,
            diagnosis: 'Hypertension',
            vitals: { bloodPressure: 'invalid-bp' },
            actorUserId: 'USR-DOC-01',
            actorRole: 'DOCTOR'
          });
        },
        err => err.status === 400 && err.errors.some(e => e.includes('Blood pressure'))
      );
    });

    test('should reject unrealistic vitals (e.g. pulse 999 or temperature 150) with 400', () => {
      assert.throws(
        () => {
          ehrService.recordConsultation({
            patientId: testPatient.patientId,
            diagnosis: 'Fever',
            vitals: { pulse: 999, temperature: 150 },
            actorUserId: 'USR-DOC-01',
            actorRole: 'DOCTOR'
          });
        },
        err => err.status === 400
      );
    });

    test('should reject prescription items with missing medicine name with 400', () => {
      assert.throws(
        () => {
          ehrService.recordConsultation({
            patientId: testPatient.patientId,
            diagnosis: 'Infection',
            prescriptions: [{ dosage: '500mg' }],
            actorUserId: 'USR-DOC-01',
            actorRole: 'DOCTOR'
          });
        },
        err => err.status === 400 && err.errors.some(e => e.includes('Medicine name is required'))
      );
    });
  });

  describe('Consultation History Retrieval', () => {
    test('should allow doctor to retrieve all consultation records for a patient', () => {
      ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'Visit 1: Viral Infection',
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR'
      });

      ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'Visit 2: Follow-up Check',
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR'
      });

      const list = ehrService.getPatientConsultations(testPatient.patientId, {
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR'
      });

      assert.strictEqual(list.length, 2);
      assert.strictEqual(list[0].diagnosis, 'Visit 1: Viral Infection');
      assert.strictEqual(list[1].diagnosis, 'Visit 2: Follow-up Check');
    });
  });
});
