'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const authService = require('../src/services/authService');
const appointmentService = require('../src/services/appointmentService');
const app = require('../src/app');

describe('Sprint 2: [US-06 / TC-HMS-04] Doctor Sets Working Hours, Available Slots & Double-Booking Prevention', () => {
  let doctorToken;
  let doctorHouseToken;
  let adminToken;
  let patientAToken;
  let patientBToken;
  let receptionistToken;

  beforeEach(async () => {
    db.reset();

    // Authenticate Doctor Smith
    const docAuth = await authService.login({
      email: 'doctor.smith@hospital.com',
      password: 'HospSecure#2026'
    });
    doctorToken = docAuth.accessToken;

    // Authenticate Doctor House (DOC-401)
    const docHouseAuth = await authService.login({
      email: 'doctor.house@hospital.com',
      password: 'HospSecure#2026'
    });
    doctorHouseToken = docHouseAuth.accessToken;

    // Authenticate Admin
    const adminAuth = await authService.login({
      email: 'admin@hospital.com',
      password: 'HospSecure#2026'
    });
    adminToken = adminAuth.accessToken;

    // Authenticate Patient A (PAT-01)
    const patAAuth = await authService.login({
      email: 'patient.alice@hospital.com',
      password: 'HospSecure#2026'
    });
    patientAToken = patAAuth.accessToken;

    // Authenticate Patient B (PAT-02)
    const patBAuth = await authService.login({
      email: 'patient.bob@hospital.com',
      password: 'HospSecure#2026'
    });
    patientBToken = patBAuth.accessToken;

    // Authenticate Receptionist
    const recAuth = await authService.login({
      email: 'receptionist@hospital.com',
      password: 'HospSecure#2026'
    });
    receptionistToken = recAuth.accessToken;
  });

  // ─── 1. Doctor Sets Working Hours & Generates Slots (FR-APPT-01) ─────────────
  describe('Doctor Working Hours & Slot Generation (FR-APPT-01)', () => {
    test('should allow doctor to configure working hours and generate 15-minute consultation slots', () => {
      const result = appointmentService.setWorkingHours({
        doctorId: 'USR-DOC-01',
        doctorName: 'Dr. Sarah Smith',
        date: '2026-10-15',
        startTime: '09:00',
        endTime: '11:00',
        slotDurationMinutes: 15,
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR'
      });

      // 2 hours = 120 minutes / 15 = 8 slots
      assert.strictEqual(result.totalSlots, 8);
      assert.strictEqual(result.slots.length, 8);
      assert.strictEqual(result.slots[0].startTime, '09:00');
      assert.strictEqual(result.slots[0].endTime, '09:15');
      assert.strictEqual(result.slots[7].startTime, '10:45');
      assert.strictEqual(result.slots[7].endTime, '11:00');
      assert.strictEqual(result.slots[0].status, 'AVAILABLE');

      // Check DB persistence
      const storedSlots = db.getSlotsByDoctor('USR-DOC-01', '2026-10-15');
      assert.strictEqual(storedSlots.length, 8);
    });

    test('should record DOCTOR_SCHEDULE_SET in immutable audit log (SEC-REQ-2.1)', () => {
      const initialLogs = db.getAuditLogs().length;

      appointmentService.setWorkingHours({
        doctorId: 'USR-DOC-01',
        date: '2026-10-16',
        startTime: '14:00',
        endTime: '15:00',
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR'
      });

      const logs = db.getAuditLogs();
      assert.ok(logs.length > initialLogs);
      const scheduleLog = logs.find(l => l.actionType === 'DOCTOR_SCHEDULE_SET');
      assert.ok(scheduleLog);
      assert.strictEqual(scheduleLog.targetResource, 'DOCTOR:USR-DOC-01');
      assert.strictEqual(scheduleLog.status, 'SUCCESS');
    });

    test('should reject invalid time range where startTime is after endTime with 400', () => {
      assert.throws(
        () => {
          appointmentService.setWorkingHours({
            doctorId: 'USR-DOC-01',
            date: '2026-10-15',
            startTime: '16:00',
            endTime: '14:00',
            actorUserId: 'USR-DOC-01',
            actorRole: 'DOCTOR'
          });
        },
        err => err.status === 400 && err.message.includes('before end time')
      );
    });

    test('should reject malformed date format with 400', () => {
      assert.throws(
        () => {
          appointmentService.setWorkingHours({
            doctorId: 'USR-DOC-01',
            date: '15-10-2026',
            startTime: '09:00',
            endTime: '10:00'
          });
        },
        err => err.status === 400 && err.message.includes('YYYY-MM-DD')
      );
    });
  });

  // ─── 2. Shows Only Currently Available Slots (Acceptance Criteria 1) ──────────
  describe('Available Slots Filtering (Acceptance Criteria 1 / FR-APPT-02)', () => {
    test('should return only currently available slots for the selected doctor', () => {
      // Seeded Dr. House DOC-401 has SLOT-1004 available
      const avail = appointmentService.getAvailableSlots({
        doctorId: 'DOC-401',
        date: '2026-10-05'
      });

      assert.strictEqual(avail.count, 1);
      assert.strictEqual(avail.slots[0].slotId, 'SLOT-1004');
      assert.strictEqual(avail.slots[0].status, 'AVAILABLE');
    });

    test('should exclude BOOKED slots from available slots list', () => {
      // Book SLOT-1004
      appointmentService.bookAppointment({
        slotId: 'SLOT-1004',
        patientId: 'PAT-01',
        reasonForVisit: 'Leg pain checkup',
        actorUserId: 'PAT-01',
        actorRole: 'PATIENT'
      });

      const avail = appointmentService.getAvailableSlots({
        doctorId: 'DOC-401',
        date: '2026-10-05'
      });

      // Should now be empty because SLOT-1004 is booked
      assert.strictEqual(avail.count, 0);
      assert.deepStrictEqual(avail.slots, []);
    });

    test('should exclude slots that are currently HELD by another user', () => {
      // Patient A holds SLOT-1004
      appointmentService.holdSlot({
        slotId: 'SLOT-1004',
        patientId: 'PAT-01',
        actorUserId: 'PAT-01',
        actorRole: 'PATIENT'
      });

      // Patient B checks available slots
      const availForB = appointmentService.getAvailableSlots({
        doctorId: 'DOC-401',
        date: '2026-10-05',
        requestingPatientId: 'PAT-02'
      });

      // Patient B cannot see the held slot
      assert.strictEqual(availForB.count, 0);

      // Patient A checks available slots
      const availForA = appointmentService.getAvailableSlots({
        doctorId: 'DOC-401',
        date: '2026-10-05',
        requestingPatientId: 'PAT-01'
      });

      // Patient A can see their own held slot
      assert.strictEqual(availForA.count, 1);
      assert.strictEqual(availForA.slots[0].isHeldByMe, true);
    });

    test('should automatically release expired holds and return slot to available pool', () => {
      const now = Date.now();
      // Patient A holds slot at time T
      appointmentService.holdSlot({
        slotId: 'SLOT-1004',
        patientId: 'PAT-01',
        holdDurationMinutes: 5,
        currentTime: now
      });

      // 6 minutes later (hold expired)
      const sixMinutesLater = now + 6 * 60 * 1000;
      const avail = appointmentService.getAvailableSlots({
        doctorId: 'DOC-401',
        date: '2026-10-05',
        requestingPatientId: 'PAT-02',
        currentTime: sixMinutesLater
      });

      // Slot is available again!
      assert.strictEqual(avail.count, 1);
      assert.strictEqual(avail.slots[0].slotId, 'SLOT-1004');
      assert.strictEqual(avail.slots[0].status, 'AVAILABLE');
    });
  });

  // ─── 3. Temporary Slot Hold / Lock (Acceptance Criteria 2 / FR-APPT-02) ────────
  describe('Temporary Slot Hold During Checkout (Acceptance Criteria 2 / FR-APPT-02)', () => {
    test('when a user selects a slot, it is temporarily held so another person cannot pick it', () => {
      const now = Date.now();
      const holdRes = appointmentService.holdSlot({
        slotId: 'SLOT-1004',
        patientId: 'PAT-01',
        currentTime: now,
        actorUserId: 'PAT-01',
        actorRole: 'PATIENT'
      });

      assert.strictEqual(holdRes.status, 'HELD');
      assert.strictEqual(holdRes.heldBy, 'PAT-01');
      assert.strictEqual(holdRes.ttlSeconds, 300); // 5 minutes TTL
      assert.strictEqual(holdRes.holdExpiresAt, now + 5 * 60 * 1000);

      // Now Patient B tries to hold the same slot
      assert.throws(
        () => {
          appointmentService.holdSlot({
            slotId: 'SLOT-1004',
            patientId: 'PAT-02',
            currentTime: now + 30000, // 30s later
            actorUserId: 'PAT-02',
            actorRole: 'PATIENT'
          });
        },
        err => err.status === 409 && (err.message.includes('Slot is currently held') || err.message.includes('already reserved'))
      );
    });

    test('should allow user to release hold and let another person pick the slot', () => {
      appointmentService.holdSlot({
        slotId: 'SLOT-1004',
        patientId: 'PAT-01'
      });

      // Release hold
      const releaseRes = appointmentService.releaseSlotHold({
        slotId: 'SLOT-1004',
        patientId: 'PAT-01'
      });
      assert.strictEqual(releaseRes.status, 'AVAILABLE');

      // Now Patient B can hold it
      const holdB = appointmentService.holdSlot({
        slotId: 'SLOT-1004',
        patientId: 'PAT-02'
      });
      assert.strictEqual(holdB.status, 'HELD');
      assert.strictEqual(holdB.heldBy, 'PAT-02');
    });

    test('should log APPOINTMENT_SLOT_HELD in immutable audit log', () => {
      const initialLogs = db.getAuditLogs().length;

      appointmentService.holdSlot({
        slotId: 'SLOT-1004',
        patientId: 'PAT-01',
        actorUserId: 'PAT-01',
        actorRole: 'PATIENT'
      });

      const logs = db.getAuditLogs();
      assert.ok(logs.length > initialLogs);
      const holdLog = logs.find(l => l.actionType === 'APPOINTMENT_SLOT_HELD');
      assert.ok(holdLog);
      assert.strictEqual(holdLog.targetResource, 'SLOT:SLOT-1004');
    });
  });

  // ─── 4. Concurrency & Double-Booking Prevention (Acceptance Criteria 3 / TC-HMS-04) ─
  describe('Concurrent Booking & Double-Booking Prevention (TC-HMS-04 / FR-APPT-02)', () => {
    test('if two users try to confirm the same slot at the same time, the first one succeeds and the second receives a "Slot already booked" message', async () => {
      // TC-HMS-04 Pre-condition: Doctor ID DOC-401 has available slot SLOT-1004 on 2026-10-05 10:00:00
      const initialSlot = db.findSlotById('SLOT-1004');
      assert.ok(initialSlot);
      assert.strictEqual(initialSlot.status, 'AVAILABLE');

      // Spawn 2 parallel concurrent booking attempts
      const bookingAttempts = [
        Promise.resolve().then(() =>
          appointmentService.bookAppointment({
            slotId: 'SLOT-1004',
            patientId: 'PAT-01',
            patientName: 'Alice Patient',
            reasonForVisit: 'Annual physical examination',
            actorUserId: 'PAT-01',
            actorRole: 'PATIENT'
          })
        ),
        Promise.resolve().then(() =>
          appointmentService.bookAppointment({
            slotId: 'SLOT-1004',
            patientId: 'PAT-02',
            patientName: 'Bob Patient',
            reasonForVisit: 'Consultation for headache',
            actorUserId: 'PAT-02',
            actorRole: 'PATIENT'
          })
        )
      ];

      const results = await Promise.allSettled(bookingAttempts);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      // Acceptance Criteria: The first one succeeds and the second receives a "Slot already booked" message
      assert.strictEqual(fulfilled.length, 1, 'Exactly one reservation must succeed');
      assert.strictEqual(rejected.length, 1, 'Exactly one reservation must be rejected');

      // Verify winning thread
      const successData = fulfilled[0].value;
      assert.strictEqual(successData.status, 'CONFIRMED');
      assert.ok(successData.appointmentId.startsWith('APT-'));

      // Verify losing thread received 409 and "Slot already booked" message
      const errorData = rejected[0].reason;
      assert.strictEqual(errorData.status, 409);
      assert.ok(
        errorData.message.includes('Slot already booked'),
        `Error message must contain "Slot already booked", got: ${errorData.message}`
      );
      assert.ok(
        errorData.message.includes('Selected slot has already been reserved'),
        `Error message must satisfy TC-HMS-04 expected text, got: ${errorData.message}`
      );

      // Verify database state: Exactly one appointment created, slot is BOOKED, no duplicates
      const allAppts = db.getAllAppointments().filter(a => a.slotId === 'SLOT-1004');
      assert.strictEqual(allAppts.length, 1, 'Database must contain exactly 1 appointment for this slot');
      assert.strictEqual(allAppts[0].appointmentId, successData.appointmentId);

      const updatedSlot = db.findSlotById('SLOT-1004');
      assert.strictEqual(updatedSlot.status, 'BOOKED');

      // Verify audit logs recorded double booking rejection (SEC-REQ-2.1)
      const logs = db.getAuditLogs();
      const conflictLog = logs.find(l => l.actionType === 'APPOINTMENT_DOUBLE_BOOKING_REJECTED');
      assert.ok(conflictLog, 'Must record audit log for double booking conflict');
      assert.strictEqual(conflictLog.status, 'FAILED_CONFLICT');
    });

    test('should allow booking by doctorId and slotTime directly as per Architecture specification', () => {
      const res = appointmentService.bookAppointment({
        doctorId: 'DOC-401',
        slotTime: '2026-10-05 10:00:00',
        patientId: 'PAT-01',
        reasonForVisit: 'Fever consultation',
        actorUserId: 'PAT-01',
        actorRole: 'PATIENT'
      });

      assert.strictEqual(res.status, 'CONFIRMED');
      assert.strictEqual(res.appointment.doctorId, 'DOC-401');
      assert.strictEqual(res.appointment.slotTime, '2026-10-05 10:00:00');
    });

    test('should reject booking when slot does not exist with HTTP 404', () => {
      assert.throws(
        () => {
          appointmentService.bookAppointment({
            slotId: 'SLOT-NON-EXISTENT',
            patientId: 'PAT-01',
            actorUserId: 'PAT-01',
            actorRole: 'PATIENT'
          });
        },
        err => err.status === 404
      );
    });
  });

  // ─── 5. Sends Booking Confirmation (Acceptance Criteria 4 / FR-APPT-04) ──────
  describe('Booking Confirmation Dispatch (Acceptance Criteria 4 / FR-APPT-04)', () => {
    test('sends a booking confirmation to the patient via SMS and Email', () => {
      const res = appointmentService.bookAppointment({
        slotId: 'SLOT-1004',
        patientId: 'PAT-01',
        patientName: 'Alice Patient',
        patientEmail: 'patient.alice@hospital.com',
        patientPhone: '9876543210',
        reasonForVisit: 'General Wellness Visit',
        actorUserId: 'PAT-01',
        actorRole: 'PATIENT'
      });

      // Verify confirmation in return object
      assert.ok(res.confirmation);
      assert.ok(res.confirmation.confirmationId.startsWith('CNF-'));
      assert.strictEqual(res.confirmation.appointmentId, res.appointmentId);
      assert.strictEqual(res.confirmation.recipientEmail, 'patient.alice@hospital.com');
      assert.strictEqual(res.confirmation.recipientPhone, '9876543210');
      assert.deepStrictEqual(res.confirmation.channels, ['EMAIL', 'SMS']);
      assert.ok(res.confirmation.emailBody.includes('CONFIRMED'));
      assert.ok(res.confirmation.smsBody.includes('HMS Alert'));

      // Verify stored in DB notifications
      const notifications = db.getNotificationsByPatientId('PAT-01');
      assert.strictEqual(notifications.length, 1);
      assert.strictEqual(notifications[0].appointmentId, res.appointmentId);

      // Verify audit log
      const logs = db.getAuditLogs();
      const confirmLog = logs.find(l => l.actionType === 'APPOINTMENT_CONFIRMED');
      assert.ok(confirmLog);
      assert.strictEqual(confirmLog.status, 'SUCCESS');
    });
  });

  // ─── 6. HTTP API Endpoint Tests ──────────────────────────────────────────────
  describe('HTTP REST API Integration (/api/v1/appointments)', () => {
    test('POST /working-hours should allow doctor to set hours with 201 Created', async () => {
      const res = await makeRequest('/api/v1/appointments/working-hours', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${doctorToken}`
        },
        body: JSON.stringify({
          doctorId: 'USR-DOC-01',
          date: '2026-11-20',
          startTime: '08:00',
          endTime: '09:00',
          slotDurationMinutes: 15
        })
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.status, 'success');
      assert.strictEqual(res.body.data.totalSlots, 4);
    });

    test('POST /working-hours should reject PATIENT with HTTP 403 Forbidden', async () => {
      const res = await makeRequest('/api/v1/appointments/working-hours', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${patientAToken}`
        },
        body: JSON.stringify({
          doctorId: 'USR-DOC-01',
          date: '2026-11-20',
          startTime: '08:00',
          endTime: '09:00'
        })
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.title, 'Forbidden');
    });

    test('GET /slots should return only currently available slots', async () => {
      const res = await makeRequest('/api/v1/appointments/slots?doctorId=DOC-401&date=2026-10-05', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${patientAToken}`
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.count, 1);
      assert.strictEqual(res.body.data.slots[0].slotId, 'SLOT-1004');
    });

    test('POST /slots/:slotId/hold should hold slot for 5 minutes', async () => {
      const res = await makeRequest('/api/v1/appointments/slots/SLOT-1004/hold', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${patientAToken}`
        },
        body: JSON.stringify({ holdDurationMinutes: 5 })
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'HELD');
      assert.strictEqual(res.body.data.ttlSeconds, 300);
    });

    test('POST / should atomically book slot and return 201 Created and confirmation', async () => {
      const res = await makeRequest('/api/v1/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${patientAToken}`
        },
        body: JSON.stringify({
          slotId: 'SLOT-1004',
          patientId: 'PAT-01',
          reasonForVisit: 'Routine health screening'
        })
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.status, 'success');
      assert.ok(res.body.appointmentId.startsWith('APT-'));
      assert.ok(res.body.data.confirmation);
    });

    test('POST / should return 409 Conflict with "Slot already booked" message when slot is already booked', async () => {
      // First booking
      await makeRequest('/api/v1/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${patientAToken}`
        },
        body: JSON.stringify({
          slotId: 'SLOT-1004',
          patientId: 'PAT-01'
        })
      });

      // Second booking attempt by another patient
      const res2 = await makeRequest('/api/v1/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${patientBToken}`
        },
        body: JSON.stringify({
          slotId: 'SLOT-1004',
          patientId: 'PAT-02'
        })
      });

      assert.strictEqual(res2.status, 409);
      assert.strictEqual(res2.body.title, 'Conflict');
      assert.ok(
        res2.body.detail.includes('Slot already booked'),
        `Detail must contain "Slot already booked", got: ${res2.body.detail}`
      );
    });
  });
});

// Helper for HTTP requests in test suite
function makeRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const http = require('node:http');
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
