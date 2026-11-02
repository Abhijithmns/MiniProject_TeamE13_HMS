'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const patientService = require('../src/services/patientService');
const db = require('../src/db');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function registerTestPatient(overrides = {}) {
  return patientService.registerPatient({
    name: 'Default Patient',
    dateOfBirth: '1990-05-15',
    gender: 'MALE',
    phone: '9876543210',
    bloodGroup: 'O+',
    emergencyContact: 'Default Contact',
    actorUserId: 'USR-REC-01',
    actorRole: 'RECEPTIONIST',
    ...overrides
  });
}

// ─── US-04 Tests ──────────────────────────────────────────────────────────────
describe('Sprint 1: [US-04 / TC-HMS-03] Patient Registration with Unique 10-Digit MPI ID', () => {

  beforeEach(() => db.reset());

  describe('Input Validation (FR-PAT-01)', () => {
    test('should reject registration when name is missing', () => {
      const errors = patientService.validatePatientInput({
        name: '', dateOfBirth: '1990-05-15', gender: 'MALE',
        phone: '9876543210', emergencyContact: 'John Doe'
      });
      assert.ok(errors.some(e => e.toLowerCase().includes('name')));
    });

    test('should reject registration when phone number is not exactly 10 digits', () => {
      const errors = patientService.validatePatientInput({
        name: 'Ravi Kumar', dateOfBirth: '1990-05-15', gender: 'MALE',
        phone: '12345', emergencyContact: 'Priya Kumar'
      });
      assert.ok(errors.some(e => e.toLowerCase().includes('10 digits')));
    });

    test('should reject registration when gender is invalid', () => {
      const errors = patientService.validatePatientInput({
        name: 'Ravi Kumar', dateOfBirth: '1990-05-15', gender: 'UNKNOWN',
        phone: '9876543210', emergencyContact: 'Priya Kumar'
      });
      assert.ok(errors.some(e => e.toLowerCase().includes('gender')));
    });

    test('should reject registration when date of birth is in the future', () => {
      const errors = patientService.validatePatientInput({
        name: 'Ravi Kumar', dateOfBirth: '2099-01-01', gender: 'MALE',
        phone: '9876543210', emergencyContact: 'Priya Kumar'
      });
      assert.ok(errors.some(e => e.toLowerCase().includes('past')));
    });

    test('should reject registration when emergency contact is missing', () => {
      const errors = patientService.validatePatientInput({
        name: 'Ravi Kumar', dateOfBirth: '1990-05-15', gender: 'MALE',
        phone: '9876543210', emergencyContact: ''
      });
      assert.ok(errors.some(e => e.toLowerCase().includes('emergency contact')));
    });

    test('should accept valid blood group values', () => {
      const errors = patientService.validatePatientInput({
        name: 'Ravi Kumar', dateOfBirth: '1990-05-15', gender: 'MALE',
        phone: '9876543210', bloodGroup: 'AB+', emergencyContact: 'Priya Kumar'
      });
      assert.strictEqual(errors.length, 0);
    });

    test('should reject invalid blood group', () => {
      const errors = patientService.validatePatientInput({
        name: 'Ravi Kumar', dateOfBirth: '1990-05-15', gender: 'MALE',
        phone: '9876543210', bloodGroup: 'XY', emergencyContact: 'Priya Kumar'
      });
      assert.ok(errors.some(e => e.toLowerCase().includes('blood group')));
    });
  });

  describe('Patient ID Generation (FR-PAT-02)', () => {
    test('should register patient and return a unique 10-digit MPI ID', () => {
      const patient = registerTestPatient({ name: 'Ananya Krishnan', phone: '9876543210' });
      assert.ok(patient.patientId);
      assert.strictEqual(patient.patientId.length, 10);
      assert.match(patient.patientId, /^\d{10}$/);
    });

    test('should store patient data safely in the database', () => {
      const patient = registerTestPatient({ name: 'Mohan Das', phone: '8765432109' });
      const stored = db.findPatientById(patient.patientId);
      assert.ok(stored);
      assert.strictEqual(stored.name, 'Mohan Das');
      assert.strictEqual(stored.phone, '8765432109');
    });

    test('each registered patient should receive a unique MPI ID', () => {
      const p1 = registerTestPatient({ name: 'Patient One', phone: '9000000001' });
      const p2 = registerTestPatient({ name: 'Patient Two', phone: '9000000002' });
      assert.notStrictEqual(p1.patientId, p2.patientId);
    });

    test('patient phone should be stored as clean 10-digit string (strips formatting)', () => {
      const patient = registerTestPatient({ phone: '98-765-43210' });
      assert.strictEqual(patient.phone, '9876543210');
    });
  });

  describe('Audit Logging (SEC-REQ-2.1)', () => {
    test('should create an audit log entry on successful patient registration', () => {
      registerTestPatient({ name: 'Audit Test Patient' });
      const logs = db.getAuditLogs();
      const registrationLog = logs.find(l => l.actionType === 'PATIENT_REGISTER');
      assert.ok(registrationLog);
      assert.strictEqual(registrationLog.status, 'SUCCESS');
      assert.match(registrationLog.details, /Audit Test Patient/);
    });
  });

  describe('Data Retrieval', () => {
    test('should retrieve patient by MPI ID', () => {
      const registered = registerTestPatient({ name: 'Lookup Patient', phone: '6543210987' });
      const fetched = patientService.getPatientById(registered.patientId);
      assert.strictEqual(fetched.patientId, registered.patientId);
      assert.strictEqual(fetched.name, 'Lookup Patient');
    });

    test('should throw 404 when patient ID does not exist', () => {
      assert.throws(
        () => patientService.getPatientById('0000000000'),
        (err) => { assert.strictEqual(err.status, 404); return true; }
      );
    });

    test('should list all registered patients', () => {
      registerTestPatient({ name: 'List Patient A', phone: '5432109876' });
      registerTestPatient({ name: 'List Patient B', phone: '4321098765' });
      const all = patientService.getAllPatients();
      assert.strictEqual(all.length, 2);
    });
  });
});

// ─── US-05 Tests ──────────────────────────────────────────────────────────────
describe('Sprint 1: [US-05 / TC-HMS-04] Quick Patient Search by Name, Phone, or ID', () => {

  beforeEach(() => {
    db.reset();
    // Seed known patients for all search tests
    registerTestPatient({ name: 'Ananya Krishnan',  phone: '9876543210', gender: 'FEMALE' });
    registerTestPatient({ name: 'Ravi Kumar',       phone: '8765432109', gender: 'MALE' });
    registerTestPatient({ name: 'Priya Krishnamurthy', phone: '7654321098', gender: 'FEMALE' });
  });

  describe('Search by Partial Name (FR-PAT-03)', () => {
    test('should return patients matching partial name (case-insensitive)', () => {
      const result = patientService.searchPatients({ query: 'krishnan', actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' });
      assert.strictEqual(result.count, 1);
      assert.strictEqual(result.results[0].name, 'Ananya Krishnan');
      assert.strictEqual(result.searchedBy, 'name');
    });

    test('should return multiple patients matching a common partial name', () => {
      const result = patientService.searchPatients({ query: 'krish', actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' });
      assert.strictEqual(result.count, 2); // Krishnan + Krishnamurthy
    });

    test('should return empty results when no name matches', () => {
      const result = patientService.searchPatients({ query: 'NonExistentName', actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' });
      assert.strictEqual(result.count, 0);
      assert.deepStrictEqual(result.results, []);
    });

    test('should be case-insensitive for name search', () => {
      const lower = patientService.searchPatients({ query: 'ravi', actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' });
      const upper = patientService.searchPatients({ query: 'RAVI', actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' });
      assert.strictEqual(lower.count, upper.count);
      assert.strictEqual(lower.count, 1);
    });
  });

  describe('Search by Exact Phone Number (FR-PAT-03)', () => {
    test('should return patient matching exact 10-digit phone number', () => {
      // 9876543210 is seeded in beforeEach for Ananya Krishnan
      const result = patientService.searchPatients({ query: '9876543210', actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' });
      assert.strictEqual(result.count, 1);
      assert.strictEqual(result.results[0].name, 'Ananya Krishnan');
    });

    test('should return empty when phone number does not match any patient', () => {
      const result = patientService.searchPatients({ query: '1111111111', actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' });
      assert.strictEqual(result.count, 0);
    });
  });

  describe('Search by Exact Patient ID (FR-PAT-03)', () => {
    test('should return patient matching exact 10-digit MPI Patient ID', () => {
      const all = patientService.getAllPatients();
      const target = all[0];
      const result = patientService.searchPatients({ query: target.patientId, actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' });
      assert.strictEqual(result.count, 1);
      assert.strictEqual(result.results[0].patientId, target.patientId);
      assert.strictEqual(result.searchedBy, 'patientId');
    });

    test('should return empty when patient ID does not match', () => {
      const result = patientService.searchPatients({ query: '0000000000', actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' });
      assert.strictEqual(result.count, 0);
    });
  });

  describe('Input Validation', () => {
    test('should reject empty search query with 400 error', () => {
      assert.throws(
        () => patientService.searchPatients({ query: '', actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' }),
        (err) => { assert.strictEqual(err.status, 400); return true; }
      );
    });

    test('should reject whitespace-only search query', () => {
      assert.throws(
        () => patientService.searchPatients({ query: '   ', actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' }),
        (err) => { assert.strictEqual(err.status, 400); return true; }
      );
    });
  });

  describe('Response Shape', () => {
    test('should return query, searchedBy, count, and results in response', () => {
      const result = patientService.searchPatients({ query: 'Ravi', actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' });
      assert.ok('query' in result);
      assert.ok('searchedBy' in result);
      assert.ok('count' in result);
      assert.ok('results' in result);
      assert.ok(Array.isArray(result.results));
    });
  });

  describe('Audit Logging (SEC-REQ-2.1)', () => {
    test('should log a PATIENT_SEARCH audit entry on every search', () => {
      patientService.searchPatients({ query: 'Ananya', actorUserId: 'USR-REC-01', actorRole: 'RECEPTIONIST' });
      const logs = db.getAuditLogs();
      const searchLog = logs.find(l => l.actionType === 'PATIENT_SEARCH');
      assert.ok(searchLog);
      assert.strictEqual(searchLog.status, 'SUCCESS');
      assert.match(searchLog.details, /Ananya/);
    });
  });
});
