'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const authService = require('../src/services/authService');
const db = require('../src/db');
const config = require('../src/config');

describe('[US-02 / TC-HMS-02] Account Lockout on 5 Consecutive Failed Logins', () => {

  beforeEach(() => {
    db.reset();
  });

  test('should accurately report remaining attempts from attempt 1 to 4', async () => {
    const testEmail = 'patient.jane@hospital.com';

    for (let i = 1; i <= 4; i++) {
      await assert.rejects(
        async () => {
          await authService.login({ email: testEmail, password: 'WrongPassword' });
        },
        (err) => {
          assert.strictEqual(err.status, 401);
          assert.strictEqual(err.attemptsRemaining, 5 - i);
          assert.strictEqual(err.locked, false);
          return true;
        }
      );

      const status = authService.getLockoutStatus(testEmail);
      assert.strictEqual(status.failedAttempts, i);
      assert.strictEqual(status.attemptsRemaining, 5 - i);
      assert.strictEqual(status.isLocked, false);
    }
  });

  test('should trigger 15-minute account lockout on the 5th consecutive failed attempt', async () => {
    const testEmail = 'doctor.smith@hospital.com';

    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      try {
        await authService.login({ email: testEmail, password: 'WrongPassword' });
      } catch (_) {}
    }

    // 5th failed attempt must throw HTTP 403 and locked: true
    await assert.rejects(
      async () => {
        await authService.login({ email: testEmail, password: 'WrongPassword' });
      },
      (err) => {
        assert.strictEqual(err.status, 403);
        assert.strictEqual(err.locked, true);
        assert.match(err.message, /Account locked for 15 minutes due to excessive failed attempts/);
        return true;
      }
    );

    // Verify status endpoint reflects locked state
    const status = authService.getLockoutStatus(testEmail);
    assert.strictEqual(status.isLocked, true);
    assert.strictEqual(status.failedAttempts, 5);
    assert.strictEqual(status.attemptsRemaining, 0);
    assert.ok(status.remainingMinutes >= 14 && status.remainingMinutes <= 15);
  });

  test('should reject correct password while account is locked', async () => {
    const testEmail = 'receptionist@hospital.com';

    // Lock account with 5 failed attempts
    for (let i = 0; i < 5; i++) {
      try {
        await authService.login({ email: testEmail, password: 'WrongPassword' });
      } catch (_) {}
    }

    // Attempt login with the valid password: must still be rejected
    await assert.rejects(
      async () => {
        await authService.login({ email: testEmail, password: 'HospSecure#2026' });
      },
      (err) => {
        assert.strictEqual(err.status, 403);
        assert.strictEqual(err.locked, true);
        assert.match(err.message, /Account locked for 15 minutes/);
        return true;
      }
    );
  });

  test('should allow account unlock and reset failed attempts counter', async () => {
    const testEmail = 'doctor.smith@hospital.com';

    // Lock account
    for (let i = 0; i < 5; i++) {
      try {
        await authService.login({ email: testEmail, password: 'WrongPassword' });
      } catch (_) {}
    }
    assert.strictEqual(authService.getLockoutStatus(testEmail).isLocked, true);

    // Administrative unlock
    const unlockResult = authService.unlockAccount({ email: testEmail, adminUserId: 'USR-ADMIN-01' });
    assert.strictEqual(unlockResult.status, 'UNLOCKED');

    // Status should be unlocked
    const statusAfter = authService.getLockoutStatus(testEmail);
    assert.strictEqual(statusAfter.isLocked, false);
    assert.strictEqual(statusAfter.failedAttempts, 0);

    // Login with valid credentials should succeed immediately
    const loginRes = await authService.login({ email: testEmail, password: 'HospSecure#2026' });
    assert.ok(loginRes.accessToken);
    assert.strictEqual(loginRes.user.email, testEmail);
  });

  test('should record audit log on account lockout and on unlock', async () => {
    const testEmail = 'patient.jane@hospital.com';

    for (let i = 0; i < 5; i++) {
      try {
        await authService.login({ email: testEmail, password: 'WrongPassword' });
      } catch (_) {}
    }

    let logs = db.getAuditLogs();
    const lockEntry = logs.find(l => l.actionType === 'ACCOUNT_LOCKED');
    assert.ok(lockEntry);
    assert.strictEqual(lockEntry.status, 'FORBIDDEN');
    assert.match(lockEntry.details, /Account locked for 15 minutes/);

    // Unlock
    authService.unlockAccount({ email: testEmail, adminUserId: 'ADMIN' });

    logs = db.getAuditLogs();
    const unlockEntry = logs.find(l => l.actionType === 'ACCOUNT_UNLOCKED');
    assert.ok(unlockEntry);
    assert.strictEqual(unlockEntry.status, 'SUCCESS');
  });

});
