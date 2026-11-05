const bcrypt = require('bcryptjs');

class Database {
  constructor() {
    this.users = new Map();
    this.patients = new Map(); // keyed by 10-digit patientId (MPI)
    this.consultations = new Map(); // keyed by consultationId (CNS-XXXXXX)
    this.pharmacyQueue = []; // live queue of prescriptions for dispensary (FR-PHARM-01)
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

  // ─── Patient Store (US-04 / FR-PAT-01, FR-PAT-02) ───────────────────────────

  /**
   * Create a new patient record with a unique 10-digit MPI ID.
   */
  createPatient(patientData) {
    const patient = {
      patientId: patientData.patientId,       // 10-digit unique MPI ID
      name: patientData.name,
      dateOfBirth: patientData.dateOfBirth,
      gender: patientData.gender,
      phone: patientData.phone,               // stored as 10-digit string
      bloodGroup: patientData.bloodGroup || null,
      emergencyContact: patientData.emergencyContact,
      registeredAt: new Date().toISOString()
    };
    this.patients.set(patient.patientId, patient);
    return patient;
  }

  findPatientById(patientId) {
    return this.patients.get(String(patientId)) || null;
  }

  getAllPatients() {
    return [...this.patients.values()];
  }

  // ─── EHR Consultations Store (US-09 / FR-EHR-01, FR-EHR-02) ───────────────────

  createConsultation(consultationData) {
    const consultation = {
      consultationId: consultationData.consultationId,
      appointmentId: consultationData.appointmentId || null,
      patientId: String(consultationData.patientId),
      doctorId: consultationData.doctorId,
      doctorName: consultationData.doctorName || 'Doctor',
      symptoms: consultationData.symptoms || '',
      examinationNotes: consultationData.examinationNotes || '',
      vitals: {
        bloodPressure: consultationData.vitals?.bloodPressure || null,
        pulse: consultationData.vitals?.pulse || null,
        temperature: consultationData.vitals?.temperature || null,
        spo2: consultationData.vitals?.spo2 || null
      },
      diagnosis: consultationData.diagnosis,
      prescriptions: Array.isArray(consultationData.prescriptions) ? consultationData.prescriptions : [],
      prescriptionHash: consultationData.prescriptionHash || null,
      lockedAt: consultationData.lockedAt || null,
      createdAt: consultationData.createdAt || new Date().toISOString(),
      updatedAt: consultationData.updatedAt || new Date().toISOString()
    };
    this.consultations.set(consultation.consultationId, consultation);
    return consultation;
  }

  findConsultationById(consultationId) {
    return this.consultations.get(String(consultationId)) || null;
  }

  getConsultationsByPatientId(patientId) {
    const id = String(patientId);
    return [...this.consultations.values()].filter(c => c.patientId === id);
  }

  getConsultationsByDoctorId(doctorId) {
    return [...this.consultations.values()].filter(c => c.doctorId === doctorId);
  }

  getAllConsultations() {
    return [...this.consultations.values()];
  }

  // ─── Pharmacy Queue Store (FR-PHARM-01) ──────────────────────────────────────

  enqueuePrescription(entry) {
    const queueItem = {
      queueId: `RX-Q-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      consultationId: entry.consultationId,
      patientId: entry.patientId,
      doctorId: entry.doctorId,
      prescriptions: entry.prescriptions,
      prescriptionHash: entry.prescriptionHash,
      status: 'PENDING_DISPENSE',
      enqueuedAt: new Date().toISOString()
    };
    this.pharmacyQueue.push(queueItem);
    return queueItem;
  }

  getPharmacyQueue() {
    return [...this.pharmacyQueue];
  }

  // ─── Audit Log Store ─────────────────────────────────────────────────────────

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
    this.patients.clear();
    this.consultations.clear();
    this.pharmacyQueue = [];
    this.auditLogs = [];
    this.seedDefaults();
  }
}

const db = new Database();
module.exports = db;
