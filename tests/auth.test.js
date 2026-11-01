'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const authService = require('../src/services/authService');
const db = require('../src/db');
const jwt = require('jsonwebtoken');
const config = require('../src/config');

describe('Sprint 1: User Stories #2, #3, #4, and #15 Tests', () => {

  beforeEach(() => {
    db.reset();
  });

  describe('[US-01 / TC-HMS-01] User Registration & Password Complexity Policy', () => {
    test('should reject password with less than 8 characters', () => {
      const res = authService.validatePasswordComplexity('Pass1!');
      assert.strictEqual(res.isValid, false);
      assert.match(res.message, /at least 8 characters/);
    });

    test('should reject password missing an uppercase letter', () => {
      const res = authService.validatePasswordComplexity('password123!');
      assert.strictEqual(res.isValid, false);
      assert.match(res.message, /uppercase letter/);
    });

    test('should reject password missing a number', () => {
      const res = authService.validatePasswordComplexity('Password!');
      assert.strictEqual(res.isValid, false);
      assert.match(res.message, /number/);
    });

    test('should reject password missing a special character', () => {
      const res = authService.validatePasswordComplexity('Password123');
      assert.strictEqual(res.isValid, false);
      assert.match(res.message, /special character/);
    });

    test('should accept strong compliant password and register user', async () => {
      const user = await authService.register({
        name: 'Alice Johnson',
        email: 'alice.johnson@hospital.com',
        password: 'Valid@Pass2026!',
        role: 'PATIENT'
      });

      assert.ok(user.id.startsWith('USR-'));
      assert.strictEqual(user.email, 'alice.johnson@hospital.com');
      assert.strictEqual(user.role, 'PATIENT');
      // Verify plain password is not leaked in user output
      assert.strictEqual(user.password, undefined);
      assert.strictEqual(user.passwordHash, undefined);
    });

    test('should reject registration when email already exists', async () => {
      await assert.rejects(
        async () => {
          await authService.register({
            name: 'Duplicate Admin',
            email: 'admin@hospital.com', // Pre-seeded email
            password: 'Valid@Pass2026!'
          });
        },
        {
          status: 409,
          message: 'An account with this email already exists'
        }
      );
    });
  });

  describe('[US-02 / TC-HMS-02] Account Lockout on 5 Consecutive Failed Logins', () => {
    test('should authenticate successfully with correct credentials and issue valid JWT token', async () => {
      const result = await authService.login({
        email: 'doctor.smith@hospital.com',
        password: 'HospSecure#2026'
      });

      assert.ok(result.accessToken);
      assert.strictEqual(result.tokenType, 'Bearer');
      assert.strictEqual(result.user.role, 'DOCTOR');

      // Verify JWT token signature and claims
      const decoded = jwt.verify(result.accessToken, config.JWT_SECRET);
      assert.strictEqual(decoded.email, 'doctor.smith@hospital.com');
      assert.strictEqual(decoded.role, 'DOCTOR');
    });

    test('should track failed attempts and lock account on the 5th failed attempt for 15 minutes', async () => {
      const testEmail = 'patient.jane@hospital.com';

      // 4 failed attempts should report remaining attempts
      for (let i = 1; i <= 4; i++) {
        await assert.rejects(
          async () => {
            await authService.login({
              email: testEmail,
              password: 'WrongPassword#999'
            });
          },
          (err) => {
            assert.strictEqual(err.status, 401);
            assert.strictEqual(err.attemptsRemaining, 5 - i);
            return true;
          }
        );
      }

      // 5th failed attempt triggers 15-minute lockout
      await assert.rejects(
        async () => {
          await authService.login({
            email: testEmail,
            password: 'WrongPassword#999'
          });
        },
        (err) => {
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.locked, true);
          assert.match(err.message, /Account locked for 15 minutes/);
          return true;
        }
      );

      // Even with the CORRECT password, login is blocked while locked
      await assert.rejects(
        async () => {
          await authService.login({
            email: testEmail,
            password: 'HospSecure#2026'
          });
        },
        (err) => {
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.locked, true);
          assert.match(err.message, /Account locked/);
          return true;
        }
      );
    });

    test('should reset failed attempts count upon a successful login', async () => {
      const testEmail = 'receptionist@hospital.com';

      // 2 failed attempts
      for (let i = 0; i < 2; i++) {
        try {
          await authService.login({ email: testEmail, password: 'WrongPassword' });
        } catch (_) {}
      }

      const userBefore = db.findUserByEmail(testEmail);
      assert.strictEqual(userBefore.failedAttempts, 2);

      // Now login with correct credentials
      await authService.login({ email: testEmail, password: 'HospSecure#2026' });

      const userAfter = db.findUserByEmail(testEmail);
      assert.strictEqual(userAfter.failedAttempts, 0);
      assert.strictEqual(userAfter.lockedUntil, null);
    });
  });

  describe('[US-03 / TC-HMS-09] Role-Based Access Control (RBAC) Boundaries', () => {
    test('should allow user with DOCTOR role to generate token with doctor privileges', async () => {
      const result = await authService.login({
        email: 'doctor.smith@hospital.com',
        password: 'HospSecure#2026'
      });
      const decoded = jwt.verify(result.accessToken, config.JWT_SECRET);
      assert.strictEqual(decoded.role, 'DOCTOR');
    });

    test('should distinguish PATIENT, DOCTOR, RECEPTIONIST, and ADMIN permissions', async () => {
      const patient = await authService.login({ email: 'patient.jane@hospital.com', password: 'HospSecure#2026' });
      const doctor = await authService.login({ email: 'doctor.smith@hospital.com', password: 'HospSecure#2026' });
      const admin = await authService.login({ email: 'admin@hospital.com', password: 'HospSecure#2026' });

      assert.strictEqual(patient.user.role, 'PATIENT');
      assert.strictEqual(doctor.user.role, 'DOCTOR');
      assert.strictEqual(admin.user.role, 'ADMIN');
    });
  });

  describe('[US-14 / SEC-REQ-2.1] Immutable Audit Logging', () => {
    test('should record audit log on login success', async () => {
      await authService.login({
        email: 'admin@hospital.com',
        password: 'HospSecure#2026'
      });

      const logs = db.getAuditLogs();
      const loginLog = logs.find(l => l.actionType === 'AUTH_LOGIN_SUCCESS');
      assert.ok(loginLog);
      assert.strictEqual(loginLog.status, 'SUCCESS');
      assert.ok(loginLog.timestamp);
      assert.strictEqual(loginLog.targetResource, 'User:admin@hospital.com');
    });

    test('should record audit log on account lockout', async () => {
      const testEmail = 'patient.jane@hospital.com';
      for (let i = 0; i < 5; i++) {
        try {
          await authService.login({ email: testEmail, password: 'BadPassword' });
        } catch (_) {}
      }

      const logs = db.getAuditLogs();
      const lockLog = logs.find(l => l.actionType === 'ACCOUNT_LOCKED');
      assert.ok(lockLog);
      assert.strictEqual(lockLog.status, 'FORBIDDEN');
      assert.match(lockLog.details, /Account locked for 15 minutes/);
    });

    test('audit logs should be tamper-evident and frozen against modification', () => {
      const record = db.appendAuditLog({
        actorUserId: 'USR-TEST-99',
        actorRole: 'ADMIN',
        actionType: 'EHR_VIEW',
        targetResource: 'Record:REC-102',
        status: 'SUCCESS'
      });

      assert.strictEqual(Object.isFrozen(record), true);
      assert.throws(() => {
        record.status = 'MODIFIED';
      }, TypeError);
    });
  });

});
