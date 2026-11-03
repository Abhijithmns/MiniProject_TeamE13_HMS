'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const authService = require('../src/services/authService');
const db = require('../src/db');
const requireRole = require('../src/middleware/rbac');

describe('[US-03 / TC-HMS-09] Role-Based Access Control (RBAC) & Boundary Enforcement', () => {

  let patientUser;
  let doctorUser;
  let receptionistUser;
  let adminUser;

  beforeEach(async () => {
    db.reset();

    const pLogin = await authService.login({ email: 'patient.jane@hospital.com', password: 'HospSecure#2026' });
    patientUser = pLogin.user;

    const dLogin = await authService.login({ email: 'doctor.smith@hospital.com', password: 'HospSecure#2026' });
    doctorUser = dLogin.user;

    const rLogin = await authService.login({ email: 'receptionist@hospital.com', password: 'HospSecure#2026' });
    receptionistUser = rLogin.user;

    const aLogin = await authService.login({ email: 'admin@hospital.com', password: 'HospSecure#2026' });
    adminUser = aLogin.user;
  });

  function mockRequestResponse(user, params = {}) {
    let responseStatus = 200;
    let responseBody = null;

    const req = {
      user,
      params,
      originalUrl: '/test-endpoint',
      ip: '127.0.0.1'
    };

    const res = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      }
    };

    return { req, res, getStatus: () => responseStatus, getBody: () => responseBody };
  }

  test('should allow PATIENT to access patient-specific features', (t, done) => {
    const middleware = requireRole(['PATIENT']);
    const { req, res } = mockRequestResponse(patientUser);

    middleware(req, res, () => {
      // next() was called successfully
      done();
    });
  });

  test('should deny DOCTOR access to Reception-only intake routes with HTTP 403 Access Denied', () => {
    const middleware = requireRole(['RECEPTIONIST']);
    const { req, res, getStatus, getBody } = mockRequestResponse(doctorUser);

    middleware(req, res, () => {
      assert.fail('Doctor should not be permitted into receptionist intake');
    });

    assert.strictEqual(getStatus(), 403);
    assert.match(getBody().detail, /Access Denied: Insufficient privilege/);
  });

  test('should deny RECEPTIONIST access to confidential Doctor clinical notes (US-03)', () => {
    const middleware = requireRole(['DOCTOR']);
    const { req, res, getStatus, getBody } = mockRequestResponse(receptionistUser);

    middleware(req, res, () => {
      assert.fail('Receptionist should not have access to doctor clinical notes');
    });

    assert.strictEqual(getStatus(), 403);
    assert.strictEqual(getBody().status, 403);
    assert.match(getBody().detail, /Access Denied/);
  });

  test('should deny PATIENT access to Doctor clinical notes with HTTP 403', () => {
    const middleware = requireRole(['DOCTOR']);
    const { req, res, getStatus, getBody } = mockRequestResponse(patientUser);

    middleware(req, res, () => {
      assert.fail('Patient should not have access to doctor clinical notes');
    });

    assert.strictEqual(getStatus(), 403);
    assert.strictEqual(getBody().status, 403);
  });

  test('should allow ADMIN global access across all role endpoints', (t, done) => {
    const middlewareDoctor = requireRole(['DOCTOR']);
    const { req, res } = mockRequestResponse(adminUser);

    middlewareDoctor(req, res, () => {
      done();
    });
  });

  test('should prevent Insecure Direct Object Reference (IDOR) when Patient A accesses Patient B records', () => {
    const idorMiddleware = requireRole.verifyPatientOwnership('patientId');
    // Patient Jane (USR-PAT-01) tries to access record of another patient (USR-PAT-99)
    const { req, res, getStatus, getBody } = mockRequestResponse(patientUser, { patientId: 'USR-PAT-99' });

    idorMiddleware(req, res, () => {
      assert.fail('Patient should not be allowed to access another patient record');
    });

    assert.strictEqual(getStatus(), 403);
    assert.match(getBody().detail, /cannot view another patient/);
  });

  test('should allow patient to access their own record matching their user id', (t, done) => {
    const idorMiddleware = requireRole.verifyPatientOwnership('patientId');
    // Patient Jane (USR-PAT-01) accessing her own record
    const { req, res } = mockRequestResponse(patientUser, { patientId: patientUser.id });

    idorMiddleware(req, res, () => {
      done();
    });
  });

  test('should record RBAC and IDOR violations in immutable audit trail', () => {
    const middleware = requireRole(['DOCTOR']);
    const { req, res } = mockRequestResponse(patientUser);

    middleware(req, res, () => {});

    const logs = db.getAuditLogs();
    const deniedLog = logs.find(l => l.actionType === 'RBAC_ACCESS_DENIED');
    assert.ok(deniedLog);
    assert.strictEqual(deniedLog.status, 'FORBIDDEN');
    assert.match(deniedLog.details, /Role \[PATIENT\] attempted access/);
  });

});
