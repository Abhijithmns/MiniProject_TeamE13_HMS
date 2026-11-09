'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const db = require('../src/db');
const authService = require('../src/services/authService');
const patientService = require('../src/services/patientService');
const ehrService = require('../src/services/ehrService');
const app = require('../src/app');

describe('Sprint 2: [US-14 / TC-HMS-09 / SEC-REQ-2.1] Track Activity History on Medical Records (Audit Log)', () => {
  let adminToken;
  let doctorToken;
  let patientToken;
  let receptionistToken;

  let seededConsultationId;
  let testPatientId;

  beforeEach(async () => {
    db.reset();

    // Authenticate users
    const adminLogin = await authService.login({
      email: 'admin@hospital.com',
      password: 'HospSecure#2026'
    });
    adminToken = adminLogin.accessToken;

    const docLogin = await authService.login({
      email: 'doctor.smith@hospital.com',
      password: 'HospSecure#2026'
    });
    doctorToken = docLogin.accessToken;

    const patLogin = await authService.login({
      email: 'patient.jane@hospital.com',
      password: 'HospSecure#2026'
    });
    patientToken = patLogin.accessToken;

    const recLogin = await authService.login({
      email: 'receptionist@hospital.com',
      password: 'HospSecure#2026'
    });
    receptionistToken = recLogin.accessToken;

    // Register test patient
    const patientRecord = patientService.registerPatient({
      name: 'Jane Doe',
      dateOfBirth: '1990-05-15',
      gender: 'Female',
      phone: '9876543210',
      bloodGroup: 'O+',
      emergencyContact: 'John Doe (9876543211)',
      actorUserId: 'USR-REC-01',
      actorRole: 'RECEPTIONIST'
    });
    testPatientId = patientRecord.patientId;

    // Seed a consultation record for testing
    const created = ehrService.recordConsultation({
      appointmentId: 'APT-1001',
      patientId: testPatientId,
      vitals: { bp: '120/80', pulse: 72, temp: 98.6 },
      symptoms: 'Mild headaches',
      examinationNotes: 'General appearance healthy, neurological exam normal',
      diagnosis: 'Tension headache',
      prescriptions: [{ name: 'Paracetamol', dosage: '500mg', duration: '3 days' }],
      actorUserId: 'USR-DOC-01',
      actorRole: 'DOCTOR',
      doctorName: 'Dr. John Smith',
      clientIp: '127.0.0.1'
    });
    seededConsultationId = created.consultationId;
  });

  // ─── Acceptance Criteria 1: Records user ID, date & time, patient ID, and action taken ────────
  describe('Acceptance Criteria 1: Activity Logging on Medical Records', () => {
    test('should record EHR_CREATE with user ID, timestamp, patient ID, and action taken', () => {
      const logs = db.getAuditLogs({ actionType: 'EHR_CREATE' });
      assert.ok(logs.length >= 1, 'EHR_CREATE log entry must be recorded');

      const log = logs[0];
      assert.strictEqual(log.actionType, 'EHR_CREATE');
      assert.strictEqual(log.actorUserId, 'USR-DOC-01');
      assert.strictEqual(log.actorRole, 'DOCTOR');
      assert.strictEqual(log.patientId, testPatientId);
      assert.ok(log.timestamp, 'Timestamp must be present');
      assert.strictEqual(log.status, 'SUCCESS');
      assert.ok(log.targetResource.includes(seededConsultationId));
    });

    test('should record EHR_VIEW with user ID, timestamp, patient ID when viewing consultation notes', () => {
      ehrService.getConsultationById(seededConsultationId, {
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR',
        clientIp: '127.0.0.1'
      });

      const logs = db.getAuditLogs({ actionType: 'EHR_VIEW' });
      assert.ok(logs.length >= 1, 'EHR_VIEW log entry must be recorded');

      const log = logs[0];
      assert.strictEqual(log.actionType, 'EHR_VIEW');
      assert.strictEqual(log.actorUserId, 'USR-DOC-01');
      assert.strictEqual(log.patientId, testPatientId);
      assert.ok(log.timestamp);
      assert.strictEqual(log.status, 'SUCCESS');
    });

    test('should record EHR_UPDATE with user ID, timestamp, patient ID on consultation note edit', () => {
      ehrService.updateConsultation(
        seededConsultationId,
        { diagnosis: 'Migraine with aura' },
        {
          actorUserId: 'USR-DOC-01',
          actorRole: 'DOCTOR',
          doctorName: 'Dr. John Smith',
          clientIp: '127.0.0.1',
          currentTime: Date.now()
        }
      );

      const logs = db.getAuditLogs({ actionType: 'EHR_UPDATE' });
      assert.ok(logs.length >= 1, 'EHR_UPDATE log entry must be recorded');

      const log = logs[0];
      assert.strictEqual(log.actionType, 'EHR_UPDATE');
      assert.strictEqual(log.actorUserId, 'USR-DOC-01');
      assert.strictEqual(log.patientId, testPatientId);
      assert.ok(log.timestamp);
      assert.strictEqual(log.status, 'SUCCESS');
    });

    test('should record EHR_ADDENDUM with user ID, timestamp, patient ID on permanent addendum', () => {
      ehrService.appendAddendum(seededConsultationId, {
        note: 'Patient reported improvement following prescribed medication',
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR',
        doctorName: 'Dr. John Smith',
        clientIp: '127.0.0.1',
        timestamp: new Date().toISOString()
      });

      const logs = db.getAuditLogs({ actionType: 'EHR_ADDENDUM' });
      assert.ok(logs.length >= 1, 'EHR_ADDENDUM log entry must be recorded');

      const log = logs[0];
      assert.strictEqual(log.actionType, 'EHR_ADDENDUM');
      assert.strictEqual(log.actorUserId, 'USR-DOC-01');
      assert.strictEqual(log.patientId, testPatientId);
      assert.ok(log.timestamp);
      assert.strictEqual(log.status, 'SUCCESS');
    });

    test('should record EHR_DOWNLOAD with user ID, timestamp, patient ID when downloading medical records', () => {
      const downloaded = ehrService.downloadConsultation(seededConsultationId, {
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR',
        clientIp: '127.0.0.1'
      });

      assert.strictEqual(downloaded.consultationId, seededConsultationId);
      assert.strictEqual(downloaded.patientId, testPatientId);

      const logs = db.getAuditLogs({ actionType: 'EHR_DOWNLOAD' });
      assert.ok(logs.length >= 1, 'EHR_DOWNLOAD log entry must be recorded');

      const log = logs[0];
      assert.strictEqual(log.actionType, 'EHR_DOWNLOAD');
      assert.strictEqual(log.actorUserId, 'USR-DOC-01');
      assert.strictEqual(log.patientId, testPatientId);
      assert.ok(log.timestamp);
      assert.strictEqual(log.status, 'SUCCESS');
    });

    test('should record EHR_PATIENT_HISTORY_VIEW with user ID, timestamp, and patient ID', () => {
      ehrService.getPatientConsultations(testPatientId, {
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR',
        clientIp: '127.0.0.1'
      });

      const logs = db.getAuditLogs({ actionType: 'EHR_PATIENT_HISTORY_VIEW' });
      assert.ok(logs.length >= 1, 'EHR_PATIENT_HISTORY_VIEW log entry must be recorded');

      const log = logs[0];
      assert.strictEqual(log.actionType, 'EHR_PATIENT_HISTORY_VIEW');
      assert.strictEqual(log.patientId, testPatientId);
      assert.ok(log.timestamp);
    });
  });

  // ─── Acceptance Criteria 2: Audit log records cannot be edited or deleted ─────────
  describe('Acceptance Criteria 2: Immutability & Tamper Resistance', () => {
    test('audit log records are frozen objects preventing attribute mutation', () => {
      const record = db.appendAuditLog({
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR',
        patientId: testPatientId,
        actionType: 'EHR_VIEW',
        targetResource: `CONSULTATION:${seededConsultationId}`,
        status: 'SUCCESS'
      });

      assert.strictEqual(Object.isFrozen(record), true, 'Audit log object must be deeply frozen');
      assert.throws(() => {
        record.status = 'FORGED_SUCCESS';
      }, TypeError);
      assert.throws(() => {
        record.actionType = 'DELETED';
      }, TypeError);
      assert.throws(() => {
        record.patientId = 'PAT-ALTERED';
      }, TypeError);
    });

    test('HTTP PUT/DELETE/POST on /api/v1/audit/logs should return HTTP 405 Method Not Allowed', async () => {
      const putRes = await makeRequest('/api/v1/audit/logs/AUD-1001', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'TAMPERED' })
      });
      assert.strictEqual(putRes.status, 405);
      assert.match(putRes.body.detail, /strictly append-only and immutable/);

      const delRes = await makeRequest('/api/v1/audit/logs/AUD-1001', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      });
      assert.strictEqual(delRes.status, 405);
      assert.match(delRes.body.detail, /Modifying or deleting audit entries is prohibited/);
    });
  });

  // ─── Acceptance Criteria 3: Administrator can view log history for reviews ──────────
  describe('Acceptance Criteria 3: Security Review by Administrator', () => {
    test('GET /api/v1/audit/logs should allow ADMIN to view the complete log history', async () => {
      const res = await makeRequest('/api/v1/audit/logs', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'success');
      assert.ok(Array.isArray(res.body.data.logs));
      assert.ok(res.body.totalEntries >= 1);
    });

    test('GET /api/v1/audit/logs?patientId=... should filter audit entries by patient ID', async () => {
      const res = await makeRequest(`/api/v1/audit/logs?patientId=${testPatientId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'success');
      const logs = res.body.data.logs;
      assert.ok(logs.length >= 1);
      logs.forEach(log => {
        const matchesPatient = log.patientId === testPatientId || (log.targetResource && log.targetResource.includes(testPatientId));
        assert.ok(matchesPatient, `Log entry must match patient ID: ${JSON.stringify(log)}`);
      });
    });

    test('GET /api/v1/audit/logs?actionType=... should filter audit entries by action type', async () => {
      const res = await makeRequest('/api/v1/audit/logs?actionType=EHR_CREATE', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'success');
      const logs = res.body.data.logs;
      assert.ok(logs.length >= 1);
      logs.forEach(log => {
        assert.strictEqual(log.actionType, 'EHR_CREATE');
      });
    });
  });

  // ─── RBAC & Boundary Violations ──────────────────────────────────────────────────
  describe('RBAC Protection and Violation Logging', () => {
    test('should reject non-admin users (DOCTOR, PATIENT, RECEPTIONIST) from accessing audit logs with 403', async () => {
      const doctorRes = await makeRequest('/api/v1/audit/logs', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${doctorToken}` }
      });
      assert.strictEqual(doctorRes.status, 403);

      const patientRes = await makeRequest('/api/v1/audit/logs', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${patientToken}` }
      });
      assert.strictEqual(patientRes.status, 403);

      const receptionistRes = await makeRequest('/api/v1/audit/logs', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${receptionistToken}` }
      });
      assert.strictEqual(receptionistRes.status, 403);
    });

    test('should record UNAUTHORIZED_ACCESS_ATTEMPT when unauthorized role attempts medical record download', async () => {
      const res = await makeRequest(`/api/v1/ehr/consultations/${seededConsultationId}/download`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${receptionistToken}` }
      });

      assert.strictEqual(res.status, 403);

      const logs = db.getAuditLogs({ actionType: 'UNAUTHORIZED_ACCESS_ATTEMPT' });
      assert.ok(logs.length >= 1);
      const deniedLog = logs.find(l => l.targetResource.includes('DOWNLOAD'));
      assert.ok(deniedLog);
      assert.strictEqual(deniedLog.status, 'DENIED');
      assert.strictEqual(deniedLog.actorRole, 'RECEPTIONIST');
      assert.strictEqual(deniedLog.patientId, testPatientId);
    });
  });
});

// Helper for HTTP requests in test suite
function makeRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);

    server.listen(0, () => {
      const port = server.address().port;
      const url = `http://localhost:${port}${urlPath}`;

      fetch(url, options)
        .then(async res => {
          let body = null;
          try {
            body = await res.json();
          } catch {
            body = null;
          }
          server.close(() => {
            resolve({
              status: res.status,
              headers: res.headers,
              body
            });
          });
        })
        .catch(err => {
          server.close(() => reject(err));
        });
    });
  });
}
