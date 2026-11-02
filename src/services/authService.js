const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

class AuthService {
  /**
   * Validates password complexity policy (FR-AUTH-01):
   * Minimum 8 characters, at least 1 uppercase, 1 lowercase, 1 digit, 1 special character.
   */
  validatePasswordComplexity(password) {
    if (!password || typeof password !== 'string') {
      return {
        isValid: false,
        message: 'Password is required'
      };
    }
    if (password.length < 8) {
      return {
        isValid: false,
        message: 'Password must be at least 8 characters long'
      };
    }
    if (!/[A-Z]/.test(password)) {
      return {
        isValid: false,
        message: 'Password must contain at least one uppercase letter'
      };
    }
    if (!/[a-z]/.test(password)) {
      return {
        isValid: false,
        message: 'Password must contain at least one lowercase letter'
      };
    }
    if (!/[0-9]/.test(password)) {
      return {
        isValid: false,
        message: 'Password must contain at least one number'
      };
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      return {
        isValid: false,
        message: 'Password must contain at least one special character'
      };
    }
    return { isValid: true };
  }

  /**
   * Register a new user (US-01 / FR-AUTH-01)
   */
  async register({ name, email, password, role = 'PATIENT', clientIp = '127.0.0.1' }) {
    if (!name || !email || !password) {
      const err = new Error('Name, email, and password are required');
      err.status = 400;
      throw err;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      const err = new Error('Invalid email address format');
      err.status = 400;
      throw err;
    }

    const passwordValidation = this.validatePasswordComplexity(password);
    if (!passwordValidation.isValid) {
      const err = new Error(passwordValidation.message);
      err.status = 400;
      throw err;
    }

    const existingUser = db.findUserByEmail(email);
    if (existingUser) {
      const err = new Error('An account with this email already exists');
      err.status = 409;
      throw err;
    }

    const allowedRoles = ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'ADMIN'];
    const assignedRole = allowedRoles.includes(role.toUpperCase()) ? role.toUpperCase() : 'PATIENT';

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = db.createUser({
      name,
      email,
      passwordHash,
      role: assignedRole
    });

    db.appendAuditLog({
      actorUserId: newUser.id,
      actorRole: newUser.role,
      clientIp,
      actionType: 'AUTH_REGISTER',
      targetResource: `User:${newUser.email}`,
      status: 'SUCCESS',
      details: 'New user registered successfully'
    });

    return {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      createdAt: newUser.createdAt
    };
  }

  /**
   * Authenticate user with 5-attempt lockout policy (US-01, US-02 / FR-AUTH-01, FR-AUTH-02, FR-AUTH-03)
   */
  async login({ email, password, clientIp = '127.0.0.1' }) {
    if (!email || !password) {
      const err = new Error('Email and password are required');
      err.status = 400;
      throw err;
    }

    const user = db.findUserByEmail(email);

    if (!user) {
      db.appendAuditLog({
        actorUserId: 'UNKNOWN',
        actorRole: 'NONE',
        clientIp,
        actionType: 'AUTH_LOGIN_FAILED',
        targetResource: `User:${email}`,
        status: 'FAILED',
        details: 'User email not found'
      });
      const err = new Error('Invalid email or password');
      err.status = 401;
      throw err;
    }

    // Check if account is currently locked (FR-AUTH-02)
    const now = Date.now();
    if (user.lockedUntil && user.lockedUntil > now) {
      const remainingMinutes = Math.ceil((user.lockedUntil - now) / 60000);
      db.appendAuditLog({
        actorUserId: user.id,
        actorRole: user.role,
        clientIp,
        actionType: 'AUTH_LOGIN_BLOCKED',
        targetResource: `User:${user.email}`,
        status: 'FORBIDDEN',
        details: `Login attempt rejected on locked account (${remainingMinutes} mins remaining)`
      });

      const err = new Error(`Account locked for 15 minutes due to excessive failed attempts (${remainingMinutes} minute(s) remaining)`);
      err.status = 403;
      err.locked = true;
      err.remainingMinutes = remainingMinutes;
      throw err;
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if (!isMatch) {
      const newFailedCount = (user.failedAttempts || 0) + 1;
      let updates = { failedAttempts: newFailedCount };

      if (newFailedCount >= config.MAX_FAILED_ATTEMPTS) {
        // Trigger 15-minute account lock
        updates.lockedUntil = now + config.LOCKOUT_DURATION_MS;
        db.updateUser(user.email, updates);

        db.appendAuditLog({
          actorUserId: user.id,
          actorRole: user.role,
          clientIp,
          actionType: 'ACCOUNT_LOCKED',
          targetResource: `User:${user.email}`,
          status: 'FORBIDDEN',
          details: `Account locked for 15 minutes after ${newFailedCount} failed attempts`
        });

        const err = new Error('Account locked for 15 minutes due to excessive failed attempts');
        err.status = 403;
        err.locked = true;
        throw err;
      } else {
        db.updateUser(user.email, updates);
        const remainingAttempts = config.MAX_FAILED_ATTEMPTS - newFailedCount;

        db.appendAuditLog({
          actorUserId: user.id,
          actorRole: user.role,
          clientIp,
          actionType: 'AUTH_LOGIN_FAILED',
          targetResource: `User:${user.email}`,
          status: 'FAILED',
          details: `Failed attempt ${newFailedCount}/${config.MAX_FAILED_ATTEMPTS}`
        });

        const err = new Error(`Invalid email or password. ${remainingAttempts} attempt(s) remaining before account lockout.`);
        err.status = 401;
        err.attemptsRemaining = remainingAttempts;
        throw err;
      }
    }

    // Successful login: Reset counters and issue JWT token (FR-AUTH-03)
    db.updateUser(user.email, {
      failedAttempts: 0,
      lockedUntil: null
    });

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );

    db.appendAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      clientIp,
      actionType: 'AUTH_LOGIN_SUCCESS',
      targetResource: `User:${user.email}`,
      status: 'SUCCESS',
      details: 'User authenticated successfully'
    });

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: config.JWT_EXPIRES_IN,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    };
  }
}

module.exports = new AuthService();
