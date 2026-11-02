'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const patientService = require('../src/services/patientService');
const db = require('../src/db');

describe('Sprint 1: [US-04 / TC-HMS-03] Patient Registration with Unique 10-Digit MPI ID', () => {

  beforeEach(() => {
    db.reset();
  });

  describe('Input Validation (FR-PAT-01)', () => {
    test('should reject registration when name is missing', () => {
      const errors = patientService.validatePatientInput({
        name: '',
        dateOfBirth: '1990-05-15',
        gender: 'MALE',
        phone: '9876543210',
        emergencyContact: 'John Doe'
      });
      assert.ok(errors.some(e => e.toLowerCase().includes('name')));
    });

    test('should reject registration when phone number is not exactly 10 digits', () => {
      const errors = patientService.validatePatientInput({
        name: 'Ravi Kumar',
        dateOfBirth: '1990-05-15',
        gender: 'MALE',
        phone: '12345',
        emergencyContact: 'Priya Kumar'
      });
      assert.ok(errors.some(e => e.toLowerCase().includes('10 digits')));
    });

    test('should reject registration when gender is invalid', () => {
      const errors = patientService.validatePatientInput({
        name: 'Ravi Kumar',
        dateOfBirth: '1990-05-15',
        gender: 'UNKNOWN',
        phone: '9876543210',
        emergencyContact: 'Priya Kumar'
      });
      assert.ok(errors.some(e => e.toLowerCase().includes('gender')));
    });

    test('should reject registration when date of birth is in the future', () => {
      const errors = patientService.validatePatientInput({
        name: 'Ravi Kumar',
        dateOfBirth: '2099-01-01',
        gender: 'MALE',
        phone: '9876543210',
        emergencyContact: 'Priya Kumar'
      });
      assert.ok(errors.some(e => e.toLowerCase().includes('past')));
    });

    test('should reject registration when emergency contact is missing', () => {
      const errors = patientService.validatePatientInput({
        name: 'Ravi Kumar',
        dateOfBirth: '1990-05-15',
        gender: 'MALE',
        phone: '9876543210',
        emergencyContact: ''
      });
      assert.ok(errors.some(e => e.toLowerCase().includes('emergency contact')));
    });

    test('should accept valid blood group values', () => {
      const errors = patientService.validatePatientInput({
        name: 'Ravi Kumar',
        dateOfBirth: '1990-05-15',
        gender: 'MALE',
        phone: '9876543210',
        bloodGroup: 'AB+',
        emergencyContact: 'Priya Kumar'
      });
      assert.strictEqual(errors.length, 0);
    });

    test('should reject invalid blood group', () => {
      const errors = patientService.validatePatientInput({
        name: 'Ravi Kumar',
        dateOfBirth: '1990-05-15',
        gender: 'MALE',
        phone: '9876543210',
        bloodGroup: 'XY',
        emergencyContact: 'Priya Kumar'
      });
      assert.ok(errors.some(e => e.toLowerCase().includes('blood group')));
    });
  });

  describe('Patient ID Generation (FR-PAT-02)', () => {
    test('should register patient and return a unique 10-digit MPI ID', () => {
      const patient = patientService.registerPatient({
        name: 'Ananya Krishnan',
        dateOfBirth: '1995-08-20',
        gender: 'FEMALE',
        phone: '9876543210',
        bloodGroup: 'B+',
        emergencyContact: 'Rajesh Krishnan',
        actorUserId: 'USR-REC-01',
        actorRole: 'RECEPTIONIST'
      });

      assert.ok(patient.patientId, 'Patient ID should be generated');
      assert.strictEqual(patient.patientId.length, 10, 'Patient ID must be exactly 10 digits');
      assert.match(patient.patientId, /^\d{10}$/, 'Patient ID must be numeric');
    });

    test('should store patient data safely in the database', () => {
      const patient = patientService.registerPatient({
        name: 'Mohan Das',
        dateOfBirth: '1980-03-10',
        gender: 'MALE',
        phone: '8765432109',
        emergencyContact: 'Sita Das',
        actorUserId: 'USR-REC-01',
        actorRole: 'RECEPTIONIST'
      });

      const stored = db.findPatientById(patient.patientId);
      assert.ok(stored, 'Patient should be retrievable by MPI ID');
      assert.strictEqual(stored.name, 'Mohan Das');
      assert.strictEqual(stored.gender, 'MALE');
      assert.strictEqual(stored.phone, '8765432109');
    });

    test('each registered patient should receive a unique MPI ID', () => {
      const p1 = patientService.registerPatient({
        name: 'Patient One',
        dateOfBirth: '1985-01-01',
        gender: 'MALE',
        phone: '9000000001',
        emergencyContact: 'Contact One',
        actorUserId: 'USR-REC-01',
        actorRole: 'RECEPTIONIST'
      });

      const p2 = patientService.registerPatient({
        name: 'Patient Two',
        dateOfBirth: '1990-06-15',
        gender: 'FEMALE',
        phone: '9000000002',
        emergencyContact: 'Contact Two',
        actorUserId: 'USR-REC-01',
        actorRole: 'RECEPTIONIST'
      });

      assert.notStrictEqual(p1.patientId, p2.patientId, 'Each patient must have a unique MPI ID');
    });

    test('patient phone should be stored as clean 10-digit string (strips formatting)', () => {
      const patient = patientService.registerPatient({
        name: 'Formatted Phone',
        dateOfBirth: '1992-04-12',
        gender: 'OTHER',
        phone: '98-765-43210', // formatted input
        emergencyContact: 'Next of Kin',
        actorUserId: 'USR-REC-01',
        actorRole: 'RECEPTIONIST'
      });

      assert.strictEqual(patient.phone, '9876543210');
    });
  });

  describe('Audit Logging (SEC-REQ-2.1)', () => {
    test('should create an audit log entry on successful patient registration', () => {
      patientService.registerPatient({
        name: 'Audit Test Patient',
        dateOfBirth: '1975-11-30',
        gender: 'FEMALE',
        phone: '7654321098',
        emergencyContact: 'Audit Contact',
        actorUserId: 'USR-REC-01',
        actorRole: 'RECEPTIONIST'
      });

      const logs = db.getAuditLogs();
      const registrationLog = logs.find(l => l.actionType === 'PATIENT_REGISTER');
      assert.ok(registrationLog, 'Audit log entry should be created');
      assert.strictEqual(registrationLog.status, 'SUCCESS');
      assert.match(registrationLog.details, /Audit Test Patient/);
    });
  });

  describe('Data Retrieval', () => {
    test('should retrieve patient by MPI ID', () => {
      const registered = patientService.registerPatient({
        name: 'Lookup Patient',
        dateOfBirth: '1988-07-22',
        gender: 'MALE',
        phone: '6543210987',
        emergencyContact: 'Lookup Contact',
        actorUserId: 'USR-REC-01',
        actorRole: 'RECEPTIONIST'
      });

      const fetched = patientService.getPatientById(registered.patientId);
      assert.strictEqual(fetched.patientId, registered.patientId);
      assert.strictEqual(fetched.name, 'Lookup Patient');
    });

    test('should throw 404 when patient ID does not exist', () => {
      assert.throws(
        () => patientService.getPatientById('0000000000'),
        (err) => {
          assert.strictEqual(err.status, 404);
          return true;
        }
      );
    });

    test('should list all registered patients', () => {
      patientService.registerPatient({
        name: 'List Patient A', dateOfBirth: '1991-02-14', gender: 'FEMALE',
        phone: '5432109876', emergencyContact: 'Contact A',
        actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST'
      });
      patientService.registerPatient({
        name: 'List Patient B', dateOfBirth: '1993-09-05', gender: 'MALE',
        phone: '4321098765', emergencyContact: 'Contact B',
        actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST'
      });

      const all = patientService.getAllPatients();
      assert.strictEqual(all.length, 2);
    });
  });

});
