const bcrypt = require('bcryptjs');

class Database {
  constructor() {
    this.users = new Map();
    this.patients = new Map(); // keyed by 10-digit patientId (MPI)
    this.consultations = new Map(); // keyed by consultationId (CNS-XXXXXX)
    this.slots = new Map(); // keyed by slotId (SLOT-XXXXXX)
    this.appointments = new Map(); // keyed by appointmentId (APT-XXXXXX)
    this.slotHolds = new Map(); // keyed by slotId, holds temporary lock with TTL
    this.slotLocks = new Map(); // mutex locks for SETNX emulation
    this.notifications = []; // booking confirmation notifications (FR-APPT-04)
    this.doctorSchedules = new Map(); // keyed by doctorId:date
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
        id: 'DOC-401',
        name: 'Dr. Gregory House',
        email: 'doctor.house@hospital.com',
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
      },
      {
        id: 'PAT-01',
        name: 'Alice Patient',
        email: 'patient.alice@hospital.com',
        passwordHash: defaultPasswordHash,
        role: 'PATIENT',
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: new Date().toISOString()
      },
      {
        id: 'PAT-02',
        name: 'Bob Patient',
        email: 'patient.bob@hospital.com',
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

    // Seed TC-HMS-04 pre-condition: Doctor ID DOC-401 has an available slot on 2026-10-05 10:00:00 (SLOT-1004)
    this.createSlot({
      slotId: 'SLOT-1004',
      doctorId: 'DOC-401',
      doctorName: 'Dr. Gregory House',
      date: '2026-10-05',
      startTime: '10:00',
      endTime: '10:15',
      slotTime: '2026-10-05 10:00:00',
      status: 'AVAILABLE'
    });

    // Seed slots for Dr. Sarah Smith (USR-DOC-01) for prototype UI testing
    const defaultSlots = [
      { id: 'SLOT-2001', time: '09:00', end: '09:15' },
      { id: 'SLOT-2002', time: '09:15', end: '09:30' },
      { id: 'SLOT-2003', time: '09:30', end: '09:45' },
      { id: 'SLOT-2004', time: '09:45', end: '10:00' },
      { id: 'SLOT-2005', time: '10:00', end: '10:15' }
    ];

    const today = new Date().toISOString().slice(0, 10);
    for (const s of defaultSlots) {
      this.createSlot({
        slotId: s.id,
        doctorId: 'USR-DOC-01',
        doctorName: 'Dr. Sarah Smith',
        date: today,
        startTime: s.time,
        endTime: s.end,
        slotTime: `${today} ${s.time}:00`,
        status: 'AVAILABLE'
      });
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

  // ─── EHR Consultations Store (US-09, US-10 / FR-EHR-01, FR-EHR-02, FR-EHR-03) ──

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
      addenda: Array.isArray(consultationData.addenda) ? consultationData.addenda : [],
      createdAt: consultationData.createdAt || new Date().toISOString(),
      updatedAt: consultationData.updatedAt || new Date().toISOString()
    };
    this.consultations.set(consultation.consultationId, consultation);
    return consultation;
  }

  findConsultationById(consultationId) {
    return this.consultations.get(String(consultationId)) || null;
  }

  updateConsultation(consultationId, updates) {
    const consultation = this.findConsultationById(consultationId);
    if (!consultation) return null;
    Object.assign(consultation, updates);
    consultation.updatedAt = updates.updatedAt || new Date().toISOString();
    this.consultations.set(consultation.consultationId, consultation);
    return consultation;
  }

  addConsultationAddendum(consultationId, addendumData) {
    const consultation = this.findConsultationById(consultationId);
    if (!consultation) return null;
    if (!Array.isArray(consultation.addenda)) {
      consultation.addenda = [];
    }
    consultation.addenda.push(Object.freeze({ ...addendumData }));
    this.consultations.set(consultation.consultationId, consultation);
    return consultation;
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

  // ─── Slot & Schedule Store (FR-APPT-01, FR-APPT-02) ──────────────────────────

  createSlot(slotData) {
    const slot = {
      slotId: slotData.slotId || `SLOT-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      doctorId: slotData.doctorId,
      doctorName: slotData.doctorName || 'Doctor',
      date: slotData.date,
      startTime: slotData.startTime,
      endTime: slotData.endTime,
      slotTime: slotData.slotTime,
      status: slotData.status || 'AVAILABLE', // AVAILABLE, HELD, BOOKED
      heldBy: null,
      holdExpiresAt: null,
      bookedBy: null,
      bookedAt: null,
      createdAt: slotData.createdAt || new Date().toISOString()
    };
    this.slots.set(slot.slotId, slot);
    return slot;
  }

  findSlotById(slotId) {
    return this.slots.get(String(slotId)) || null;
  }

  findSlotByDoctorAndTime(doctorId, slotTime) {
    for (const slot of this.slots.values()) {
      if (slot.doctorId === doctorId) {
        if (
          slot.slotTime === slotTime ||
          slot.slotTime?.replace(' ', 'T') === slotTime?.replace(' ', 'T') ||
          slot.slotTime?.startsWith(slotTime) ||
          slotTime?.startsWith(slot.slotTime)
        ) {
          return slot;
        }
      }
    }
    return null;
  }

  getAllSlots() {
    return [...this.slots.values()];
  }

  getSlotsByDoctor(doctorId, date = null) {
    return [...this.slots.values()].filter(s => {
      if (s.doctorId !== doctorId) return false;
      if (date && s.date !== date) return false;
      return true;
    });
  }

  updateSlot(slotId, updates) {
    const slot = this.findSlotById(slotId);
    if (!slot) return null;
    Object.assign(slot, updates);
    this.slots.set(slot.slotId, slot);
    return slot;
  }

  cleanExpiredHolds(currentTime = Date.now()) {
    for (const [slotId, hold] of this.slotHolds.entries()) {
      if (hold.holdExpiresAt <= currentTime) {
        this.slotHolds.delete(slotId);
        const slot = this.slots.get(slotId);
        if (slot && slot.status === 'HELD') {
          slot.status = 'AVAILABLE';
          slot.heldBy = null;
          slot.holdExpiresAt = null;
        }
      }
    }
  }

  // ─── Appointments Store (FR-APPT-02) ─────────────────────────────────────────

  createAppointment(appointmentData) {
    const appointment = {
      appointmentId: appointmentData.appointmentId || `APT-${Math.floor(1000 + Math.random() * 9000)}`,
      slotId: appointmentData.slotId,
      patientId: String(appointmentData.patientId),
      patientName: appointmentData.patientName || 'Patient',
      doctorId: appointmentData.doctorId,
      doctorName: appointmentData.doctorName || 'Doctor',
      slotTime: appointmentData.slotTime,
      reasonForVisit: appointmentData.reasonForVisit || 'General Consultation',
      status: appointmentData.status || 'CONFIRMED',
      createdAt: appointmentData.createdAt || new Date().toISOString()
    };
    this.appointments.set(appointment.appointmentId, appointment);
    return appointment;
  }

  findAppointmentById(appointmentId) {
    return this.appointments.get(String(appointmentId)) || null;
  }

  getAppointmentsByPatientId(patientId) {
    const id = String(patientId);
    return [...this.appointments.values()].filter(a => a.patientId === id);
  }

  getAllAppointments() {
    return [...this.appointments.values()];
  }

  // ─── Booking Confirmation Notifications (FR-APPT-04) ─────────────────────────

  createNotification(notificationData) {
    const notification = {
      confirmationId: notificationData.confirmationId || `CNF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      appointmentId: notificationData.appointmentId,
      patientId: String(notificationData.patientId),
      recipientEmail: notificationData.recipientEmail,
      recipientPhone: notificationData.recipientPhone,
      channels: notificationData.channels || ['EMAIL', 'SMS'],
      emailSubject: `HMS Appointment Confirmation - ${notificationData.appointmentId}`,
      emailBody: notificationData.emailBody,
      smsBody: notificationData.smsBody,
      status: 'DELIVERED',
      sentAt: notificationData.sentAt || new Date().toISOString()
    };
    this.notifications.push(Object.freeze(notification));
    return notification;
  }

  getNotificationsByPatientId(patientId) {
    const id = String(patientId);
    return this.notifications.filter(n => n.patientId === id);
  }

  getAllNotifications() {
    return [...this.notifications];
  }

  // ─── Audit Log Store ─────────────────────────────────────────────────────────

  // Immutable audit log store: Append-only
  appendAuditLog(entry) {
    const record = {
      logId: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      actorUserId: entry.actorUserId || 'ANONYMOUS',
      actorRole: entry.actorRole || 'NONE',
      patientId: entry.patientId || null,
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

  getAuditLogs(filters = {}) {
    let logs = [...this.auditLogs];

    if (filters.patientId) {
      logs = logs.filter(l => l.patientId === filters.patientId || (l.targetResource && l.targetResource.includes(filters.patientId)));
    }
    if (filters.actionType) {
      logs = logs.filter(l => l.actionType === filters.actionType);
    }
    if (filters.actorUserId) {
      logs = logs.filter(l => l.actorUserId === filters.actorUserId);
    }
    if (filters.status) {
      logs = logs.filter(l => l.status === filters.status);
    }

    // Return copy of audit logs sorted newest first
    return logs.reverse();
  }

  reset() {
    this.users.clear();
    this.patients.clear();
    this.consultations.clear();
    this.pharmacyQueue = [];
    this.auditLogs = [];
    this.slots.clear();
    this.appointments.clear();
    this.slotHolds.clear();
    this.slotLocks.clear();
    this.notifications = [];
    this.doctorSchedules.clear();
    this.seedDefaults();
  }
}

const db = new Database();
module.exports = db;
