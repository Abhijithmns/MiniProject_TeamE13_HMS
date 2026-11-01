const bcrypt = require('bcryptjs');

class Database {
  constructor() {
    this.users = new Map();
    this.auditLogs = [];
    this.seedDefaults();
  }

  seedDefaults() {
    // Seed initial users for immediate testing and verification
    const defaultPasswordHash = bcrypt.hashSync('HospSecure#2026', 10);

    const defaultUsers = [
      {
        id: 'USR-ADMIN-01',
        name: 'System Administrator',
        email: 'admin@hospital.com',
        passwordHash: defaultPasswordHash,
        role: 'ADMIN',
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: new Date().toISOString()
      },
      {
        id: 'USR-DOC-01',
        name: 'Dr. Sarah Smith',
        email: 'doctor.smith@hospital.com',
        passwordHash: defaultPasswordHash,
        role: 'DOCTOR',
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: new Date().toISOString()
      },
      {
        id: 'USR-REC-01',
        name: 'Reception Desk',
        email: 'receptionist@hospital.com',
        passwordHash: defaultPasswordHash,
        role: 'RECEPTIONIST',
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: new Date().toISOString()
      },
      {
        id: 'USR-PAT-01',
        name: 'Jane Doe',
        email: 'patient.jane@hospital.com',
        passwordHash: defaultPasswordHash,
        role: 'PATIENT',
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: new Date().toISOString()
      }
    ];

    for (const u of defaultUsers) {
      this.users.set(u.email.toLowerCase(), u);
    }
  }

  findUserByEmail(email) {
    if (!email) return null;
    return this.users.get(email.toLowerCase()) || null;
  }

  findUserById(id) {
    for (const user of this.users.values()) {
      if (user.id === id) return user;
    }
    return null;
  }

  createUser(userData) {
    const user = {
      id: `USR-${Date.now().toString().slice(-6)}`,
      name: userData.name,
      email: userData.email.toLowerCase(),
      passwordHash: userData.passwordHash,
      role: userData.role || 'PATIENT',
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date().toISOString()
    };
    this.users.set(user.email, user);
    return user;
  }

  updateUser(email, updates) {
    const user = this.findUserByEmail(email);
    if (!user) return null;
    Object.assign(user, updates);
    this.users.set(user.email, user);
    return user;
  }

  // Immutable audit log store: Append-only
  appendAuditLog(entry) {
    const record = {
      logId: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      actorUserId: entry.actorUserId || 'ANONYMOUS',
      actorRole: entry.actorRole || 'NONE',
      clientIp: entry.clientIp || '127.0.0.1',
      actionType: entry.actionType,
      targetResource: entry.targetResource || 'SYSTEM',
      status: entry.status || 'SUCCESS',
      details: entry.details || ''
    };
    // Append to array - no update or delete allowed
    this.auditLogs.push(Object.freeze(record));
    return record;
  }

  getAuditLogs() {
    // Return copy of audit logs sorted newest first
    return [...this.auditLogs].reverse();
  }

  reset() {
    this.users.clear();
    this.auditLogs = [];
    this.seedDefaults();
  }
}

const db = new Database();
module.exports = db;
