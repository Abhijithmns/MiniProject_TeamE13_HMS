'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const authService = require('../src/services/authService');
const patientService = require('../src/services/patientService');
const ehrService = require('../src/services/ehrService');

describe('Sprint 2: [US-10 / TC-HMS-05] Lock Medical Notes After 24 Hours & Addenda', () => {
  let doctorUser;
  let doctorUser2;
  let receptionistUser;
  let patientUser;
  let testPatient;

  beforeEach(async () => {
    db.reset();

    // Authenticate primary Doctor (author)
    const docAuth = await authService.login({
      email: 'doctor.smith@hospital.com',
      password: 'HospSecure#2026'
    });
    doctorUser = docAuth.user;

    // Register & authenticate a second doctor (to test ownership / non-assigned doctor)
    const secondDoc = await authService.register({
      name: 'Dr. John Watson',
      email: 'doctor.watson@hospital.com',
      password: 'DocWatson#2026',
      role: 'DOCTOR'
    });
    doctorUser2 = secondDoc;

    // Authenticate Receptionist
    const recAuth = await authService.login({
      email: 'receptionist@hospital.com',
      password: 'HospSecure#2026'
    });
    receptionistUser = recAuth.user;

    // Authenticate Patient
    const patAuth = await authService.login({
      email: 'patient.jane@hospital.com',
      password: 'HospSecure#2026'
    });
    patientUser = patAuth.user;

    // Register test patient
    testPatient = patientService.registerPatient({
      name: 'Sherlock Holmes',
      dateOfBirth: '1980-01-06',
      gender: 'Male',
      phone: '9876543210',
      bloodGroup: 'B+',
      emergencyContact: 'Mrs. Hudson (9876543211)',
      actorUserId: 'USR-REC-01',
      actorRole: 'RECEPTIONIST'
    });
  });

  describe('24-Hour Edit Window (FR-EHR-03)', () => {
    test('should allow consulting doctor to update notes within 24 hours of creation', () => {
      const created = ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'Mild Bronchitis',
        symptoms: 'Cough',
        actorUserId: doctorUser.id,
        actorRole: doctorUser.role,
        doctorName: doctorUser.name
      });

      // Simulate edit 2 hours later
      const twoHoursLater = new Date(created.consultation.createdAt).getTime() + (2 * 60 * 60 * 1000);

      const updated = ehrService.updateConsultation(
        created.consultationId,
        {
          diagnosis: 'Acute Bronchitis (Updated)',
          examinationNotes: 'Wheezing heard on left lower lobe'
        },
        {
          actorUserId: doctorUser.id,
          actorRole: doctorUser.role,
          doctorName: doctorUser.name,
          currentTime: twoHoursLater
        }
      );

      assert.strictEqual(updated.diagnosis, 'Acute Bronchitis (Updated)');
      assert.strictEqual(updated.examinationNotes, 'Wheezing heard on left lower lobe');
    });

    test('should reject direct edits when record is +25 hours old with HTTP 403 (TC-HMS-05)', () => {
      const created = ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'Acute Bronchitis',
        actorUserId: doctorUser.id,
        actorRole: doctorUser.role,
        doctorName: doctorUser.name
      });

      // Simulate attempt 25 hours later (+25h)
      const twentyFiveHoursLater = new Date(created.consultation.createdAt).getTime() + (25 * 60 * 60 * 1000);

      assert.throws(
        () => {
          ehrService.updateConsultation(
            created.consultationId,
            { diagnosis: 'Attempted Tamper Diagnosis' },
            {
              actorUserId: doctorUser.id,
              actorRole: doctorUser.role,
              currentTime: twentyFiveHoursLater
            }
          );
        },
        err => {
          return err.status === 403 && err.message.includes('Direct edits prohibited; submit addendum');
        }
      );
    });

    test('should record EHR_UPDATE_LOCKED_ATTEMPT in immutable audit log upon expired edit (SEC-REQ-2.1)', () => {
      const created = ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'Initial Clinical Note',
        actorUserId: doctorUser.id,
        actorRole: doctorUser.role
      });

      const twentySixHoursLater = new Date(created.consultation.createdAt).getTime() + (26 * 60 * 60 * 1000);

      try {
        ehrService.updateConsultation(
          created.consultationId,
          { diagnosis: 'Hacked Note' },
          {
            actorUserId: doctorUser.id,
            actorRole: doctorUser.role,
            currentTime: twentySixHoursLater
          }
        );
      } catch (e) {
        // expected 403
      }

      const logs = db.getAuditLogs();
      const lockAttemptLog = logs.find(l => l.actionType === 'EHR_UPDATE_LOCKED_ATTEMPT');
      assert.ok(lockAttemptLog);
      assert.strictEqual(lockAttemptLog.status, 'DENIED');
      assert.strictEqual(lockAttemptLog.targetResource, `CONSULTATION:${created.consultationId}`);
    });

    test('should reject direct edits from a non-assigned doctor (FR-EHR-01)', () => {
      const created = ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'Doctor Smith Diagnosis',
        actorUserId: doctorUser.id,
        actorRole: doctorUser.role
      });

      // Doctor Watson attempts to edit Doctor Smith's notes within 1 hour
      const oneHourLater = new Date(created.consultation.createdAt).getTime() + (1 * 60 * 60 * 1000);

      assert.throws(
        () => {
          ehrService.updateConsultation(
            created.consultationId,
            { diagnosis: 'Doctor Watson Edit' },
            {
              actorUserId: doctorUser2.id,
              actorRole: doctorUser2.role,
              currentTime: oneHourLater
            }
          );
        },
        err => err.status === 403 && err.message.includes('Only the assigned consulting doctor can edit clinical notes')
      );
    });
  });

  describe('Addendum System for Locked Records (FR-EHR-03)', () => {
    test('should allow physician to append an addendum with date, time, and doctor name after 24h', () => {
      const created = ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'Initial Diagnosis',
        actorUserId: doctorUser.id,
        actorRole: doctorUser.role,
        doctorName: doctorUser.name
      });

      const addendumTime = new Date(new Date(created.consultation.createdAt).getTime() + (30 * 60 * 60 * 1000)).toISOString();

      const res = ehrService.appendAddendum(created.consultationId, {
        note: 'Patient called reporting mild dizziness. Advised hydration and follow-up in 48 hours.',
        actorUserId: doctorUser.id,
        actorRole: doctorUser.role,
        doctorName: doctorUser.name,
        timestamp: addendumTime
      });

      assert.ok(res.addendum.addendumId.startsWith('ADD-'));
      assert.strictEqual(res.addendum.note, 'Patient called reporting mild dizziness. Advised hydration and follow-up in 48 hours.');
      assert.strictEqual(res.addendum.doctorName, doctorUser.name);
      assert.strictEqual(res.addendum.doctorUserId, doctorUser.id);
      assert.strictEqual(res.addendum.timestamp, addendumTime);

      // Verify original notes are preserved intact
      assert.strictEqual(res.consultation.diagnosis, 'Initial Diagnosis');
      assert.strictEqual(res.consultation.addenda.length, 1);
      assert.strictEqual(res.consultation.addenda[0].note, res.addendum.note);
    });

    test('should record EHR_ADDENDUM event in immutable audit log', () => {
      const created = ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'General Checkup',
        actorUserId: doctorUser.id,
        actorRole: doctorUser.role,
        doctorName: doctorUser.name
      });

      ehrService.appendAddendum(created.consultationId, {
        note: 'Lab results received: normal blood counts.',
        actorUserId: doctorUser.id,
        actorRole: doctorUser.role,
        doctorName: doctorUser.name
      });

      const logs = db.getAuditLogs();
      const addendumLog = logs.find(l => l.actionType === 'EHR_ADDENDUM');
      assert.ok(addendumLog);
      assert.strictEqual(addendumLog.status, 'SUCCESS');
      assert.strictEqual(addendumLog.actorUserId, doctorUser.id);
    });

    test('should reject addendum from RECEPTIONIST with HTTP 403', () => {
      const created = ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'Clinical Entry',
        actorUserId: doctorUser.id,
        actorRole: doctorUser.role
      });

      assert.throws(
        () => {
          ehrService.appendAddendum(created.consultationId, {
            note: 'Receptionist trying to add addendum',
            actorUserId: receptionistUser.id,
            actorRole: receptionistUser.role
          });
        },
        err => err.status === 403
      );
    });

    test('should reject empty addendum note with HTTP 400', () => {
      const created = ehrService.recordConsultation({
        patientId: testPatient.patientId,
        diagnosis: 'Clinical Entry',
        actorUserId: doctorUser.id,
        actorRole: doctorUser.role
      });

      assert.throws(
        () => {
          ehrService.appendAddendum(created.consultationId, {
            note: '   ',
            actorUserId: doctorUser.id,
            actorRole: doctorUser.role
          });
        },
        err => err.status === 400 && err.message.includes('required and cannot be empty')
      );
    });
  });
});
