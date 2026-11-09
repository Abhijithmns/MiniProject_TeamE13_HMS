'use strict';

const db = require('../db');

/**
 * Appointment Scheduling Service (FR-APPT-01, FR-APPT-02, FR-APPT-04)
 * Handles doctor working hours configuration, slot generation (15m intervals),
 * temporary slot locking (5m TTL), atomic double-booking prevention, and booking confirmations.
 */
class AppointmentService {
  /**
   * Acquire atomic lock on a slot key (emulating Redis SETNX with TTL)
   * @param {string} lockKey
   * @param {string} ownerId
   * @param {number} ttlMs
   * @param {number} currentTime
   * @returns {boolean} True if lock acquired, false if already held by another owner
   */
  _acquireMutex(lockKey, ownerId, ttlMs = 300000, currentTime = Date.now()) {
    if (!db.slotLocks) db.slotLocks = new Map();
    const existing = db.slotLocks.get(lockKey);
    if (existing && existing.expiresAt > currentTime && existing.owner !== ownerId) {
      return false; // Lock acquisition failed (SETNX returned 0)
    }
    db.slotLocks.set(lockKey, { owner: ownerId, expiresAt: currentTime + ttlMs });
    return true; // Lock acquired (SETNX returned 1)
  }

  _releaseMutex(lockKey, ownerId) {
    if (!db.slotLocks) return true;
    const existing = db.slotLocks.get(lockKey);
    if (existing && (existing.owner === ownerId || !ownerId)) {
      db.slotLocks.delete(lockKey);
      return true;
    }
    return false;
  }

  /**
   * Configure Doctor Working Hours & Generate 15-Minute Consultation Slots (FR-APPT-01)
   * RBAC: Allowed for DOCTOR and ADMIN.
   */
  setWorkingHours({
    doctorId,
    doctorName,
    date,
    startTime,
    endTime,
    slotDurationMinutes = 15,
    actorUserId,
    actorRole,
    clientIp
  }) {
    if (!doctorId) {
      const err = new Error('Doctor ID is required');
      err.status = 400;
      throw err;
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const err = new Error('Valid date in YYYY-MM-DD format is required');
      err.status = 400;
      throw err;
    }

    if (!startTime || !/^\d{2}:\d{2}$/.test(startTime)) {
      const err = new Error('Valid start time in HH:MM format (24-hour) is required');
      err.status = 400;
      throw err;
    }

    if (!endTime || !/^\d{2}:\d{2}$/.test(endTime)) {
      const err = new Error('Valid end time in HH:MM format (24-hour) is required');
      err.status = 400;
      throw err;
    }

    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes >= endMinutes) {
      const err = new Error('Start time must be strictly before end time');
      err.status = 400;
      throw err;
    }

    if (slotDurationMinutes < 5 || slotDurationMinutes > 120) {
      const err = new Error('Slot duration must be between 5 and 120 minutes');
      err.status = 400;
      throw err;
    }

    // Resolve doctor name if not provided
    let resolvedDoctorName = doctorName;
    if (!resolvedDoctorName) {
      const docUser = db.findUserById(doctorId);
      resolvedDoctorName = docUser ? docUser.name : `Dr. ${doctorId}`;
    }

    // Generate 15-minute intervals
    const generatedSlots = [];
    let currentMinute = startMinutes;
    let slotIndex = 1;

    while (currentMinute + slotDurationMinutes <= endMinutes) {
      const slotStartH = Math.floor(currentMinute / 60).toString().padStart(2, '0');
      const slotStartM = (currentMinute % 60).toString().padStart(2, '0');
      const slotEndTotal = currentMinute + slotDurationMinutes;
      const slotEndH = Math.floor(slotEndTotal / 60).toString().padStart(2, '0');
      const slotEndM = (slotEndTotal % 60).toString().padStart(2, '0');

      const sTime = `${slotStartH}:${slotStartM}`;
      const eTime = `${slotEndH}:${slotEndM}`;
      const slotTime = `${date} ${sTime}:00`;
      const slotId = `SLOT-${doctorId.replace(/[^a-zA-Z0-9]/g, '')}-${date.replace(/-/g, '')}-${sTime.replace(':', '')}`;

      // Check if slot already exists to prevent duplicate overwrite
      let existingSlot = db.findSlotById(slotId);
      if (!existingSlot) {
        existingSlot = db.findSlotByDoctorAndTime(doctorId, slotTime);
      }

      if (!existingSlot) {
        const slot = db.createSlot({
          slotId,
          doctorId,
          doctorName: resolvedDoctorName,
          date,
          startTime: sTime,
          endTime: eTime,
          slotTime,
          status: 'AVAILABLE'
        });
        generatedSlots.push(slot);
      } else {
        generatedSlots.push(existingSlot);
      }

      currentMinute += slotDurationMinutes;
      slotIndex++;
    }

    // Save schedule in DB
    const scheduleKey = `${doctorId}:${date}`;
    const scheduleRecord = {
      scheduleKey,
      doctorId,
      doctorName: resolvedDoctorName,
      date,
      startTime,
      endTime,
      slotDurationMinutes,
      totalSlots: generatedSlots.length,
      createdAt: new Date().toISOString()
    };
    db.doctorSchedules.set(scheduleKey, scheduleRecord);

    // Audit log (SEC-REQ-2.1)
    db.appendAuditLog({
      actorUserId: actorUserId || doctorId,
      actorRole: actorRole || 'DOCTOR',
      clientIp: clientIp || '127.0.0.1',
      actionType: 'DOCTOR_SCHEDULE_SET',
      targetResource: `DOCTOR:${doctorId}`,
      status: 'SUCCESS',
      details: `Working hours set for ${date} (${startTime}-${endTime}, ${slotDurationMinutes}m slots, count: ${generatedSlots.length})`
    });

    return {
      doctorId,
      doctorName: resolvedDoctorName,
      date,
      startTime,
      endTime,
      slotDurationMinutes,
      totalSlots: generatedSlots.length,
      slots: generatedSlots
    };
  }

  /**
   * Get Only Currently Available Slots for a Selected Doctor (Acceptance Criteria 1)
   * Automatically clears expired holds before returning.
   */
  getAvailableSlots({
    doctorId,
    date = null,
    requestingPatientId = null,
    currentTime = Date.now()
  }) {
    if (!doctorId) {
      const err = new Error('Doctor ID is required');
      err.status = 400;
      throw err;
    }

    // Clean expired holds across all slots
    db.cleanExpiredHolds(currentTime);

    // Retrieve slots for this doctor
    const allSlots = db.getSlotsByDoctor(doctorId, date);

    // Filter to currently available slots:
    // 1. Exclude BOOKED slots.
    // 2. Exclude HELD slots unless held by requesting patient or hold has expired.
    const availableSlots = allSlots.filter(slot => {
      if (slot.status === 'BOOKED') {
        return false;
      }

      if (slot.status === 'HELD') {
        const hold = db.slotHolds.get(slot.slotId);
        if (!hold || hold.holdExpiresAt <= currentTime) {
          // Hold expired - slot is available
          slot.status = 'AVAILABLE';
          slot.heldBy = null;
          slot.holdExpiresAt = null;
          return true;
        }

        // If held by requesting patient, patient can still see it
        if (requestingPatientId && hold.patientId === String(requestingPatientId)) {
          return true;
        }

        // Held by another user - exclude from available slots!
        return false;
      }

      return slot.status === 'AVAILABLE';
    }).map(slot => {
      const isHeldByMe = requestingPatientId && slot.heldBy === String(requestingPatientId);
      return {
        ...slot,
        isHeldByMe: Boolean(isHeldByMe)
      };
    });

    return {
      doctorId,
      date,
      count: availableSlots.length,
      slots: availableSlots
    };
  }

  /**
   * Temporarily Hold a Slot during checkout (Acceptance Criteria 2 / FR-APPT-02)
   * Locks slot for 5 minutes (TTL 300,000 ms) so nobody else can pick it.
   */
  holdSlot({
    slotId,
    patientId,
    patientName,
    holdDurationMinutes = 5,
    currentTime = Date.now(),
    actorUserId,
    actorRole,
    clientIp
  }) {
    if (!slotId) {
      const err = new Error('Slot ID is required');
      err.status = 400;
      throw err;
    }

    if (!patientId) {
      const err = new Error('Patient ID is required to hold a slot');
      err.status = 400;
      throw err;
    }

    // Clean expired holds first
    db.cleanExpiredHolds(currentTime);

    const slot = db.findSlotById(slotId);
    if (!slot) {
      const err = new Error(`Slot with ID ${slotId} does not exist`);
      err.status = 404;
      err.type = 'https://hms.hospital.com/errors/not-found';
      throw err;
    }

    const lockKey = `lock:slot:${slot.doctorId}:${slot.slotTime}`;

    // Check if slot is already booked
    if (slot.status === 'BOOKED') {
      const err = new Error('Slot already booked. Selected slot has already been reserved.');
      err.status = 409;
      err.type = 'https://hms.hospital.com/errors/slot-already-booked';
      err.title = 'Conflict';
      throw err;
    }

    // Check if held by another user
    if (slot.status === 'HELD' && slot.heldBy && slot.heldBy !== String(patientId)) {
      const hold = db.slotHolds.get(slot.slotId);
      if (hold && hold.holdExpiresAt > currentTime) {
        const err = new Error('Slot is currently held by another patient. Selected slot has already been reserved.');
        err.status = 409;
        err.type = 'https://hms.hospital.com/errors/slot-already-booked';
        err.title = 'Conflict';
        throw err;
      }
    }

    // Concurrency lock check
    if (!this._acquireMutex(lockKey, patientId, holdDurationMinutes * 60 * 1000, currentTime)) {
      const err = new Error('Slot is currently held by another patient. Selected slot has already been reserved.');
      err.status = 409;
      err.type = 'https://hms.hospital.com/errors/slot-already-booked';
      err.title = 'Conflict';
      throw err;
    }

    const holdExpiresAt = currentTime + (holdDurationMinutes * 60 * 1000);

    // Atomically set hold
    slot.status = 'HELD';
    slot.heldBy = String(patientId);
    slot.holdExpiresAt = holdExpiresAt;

    db.slotHolds.set(slot.slotId, {
      slotId: slot.slotId,
      patientId: String(patientId),
      heldAt: currentTime,
      holdExpiresAt
    });

    // Audit log
    db.appendAuditLog({
      actorUserId: actorUserId || patientId,
      actorRole: actorRole || 'PATIENT',
      clientIp: clientIp || '127.0.0.1',
      actionType: 'APPOINTMENT_SLOT_HELD',
      targetResource: `SLOT:${slot.slotId}`,
      status: 'SUCCESS',
      details: `Slot ${slot.slotId} temporarily held for patient ${patientId} until ${new Date(holdExpiresAt).toISOString()}`
    });

    return {
      slotId: slot.slotId,
      doctorId: slot.doctorId,
      doctorName: slot.doctorName,
      slotTime: slot.slotTime,
      status: 'HELD',
      heldBy: String(patientId),
      holdExpiresAt,
      ttlSeconds: holdDurationMinutes * 60,
      message: `Slot temporarily held for ${holdDurationMinutes} minutes.`
    };
  }

  /**
   * Release Temporary Slot Hold
   */
  releaseSlotHold({ slotId, patientId, actorUserId, actorRole, clientIp }) {
    if (!slotId) {
      const err = new Error('Slot ID is required');
      err.status = 400;
      throw err;
    }

    const slot = db.findSlotById(slotId);
    if (!slot) {
      const err = new Error(`Slot with ID ${slotId} does not exist`);
      err.status = 404;
      throw err;
    }

    const hold = db.slotHolds.get(slotId);
    if (hold && patientId && hold.patientId !== String(patientId)) {
      const err = new Error('You cannot release a hold owned by another user');
      err.status = 403;
      throw err;
    }

    db.slotHolds.delete(slotId);
    const lockKey = `lock:slot:${slot.doctorId}:${slot.slotTime}`;
    this._releaseMutex(lockKey, patientId);

    if (slot.status === 'HELD') {
      slot.status = 'AVAILABLE';
      slot.heldBy = null;
      slot.holdExpiresAt = null;
    }

    db.appendAuditLog({
      actorUserId: actorUserId || patientId || 'ANONYMOUS',
      actorRole: actorRole || 'PATIENT',
      clientIp: clientIp || '127.0.0.1',
      actionType: 'APPOINTMENT_SLOT_RELEASED',
      targetResource: `SLOT:${slot.slotId}`,
      status: 'SUCCESS',
      details: `Hold on slot ${slot.slotId} released back to public pool`
    });

    return {
      slotId: slot.slotId,
      status: 'AVAILABLE',
      message: 'Slot hold released successfully'
    };
  }

  /**
   * Book / Confirm Appointment (Acceptance Criteria 3 & 4 / FR-APPT-02, FR-APPT-04, TC-HMS-04)
   * Atomic double-booking prevention:
   * If two users try to confirm the same slot at the same time, the first one succeeds
   * and the second receives a "Slot already booked" message (409 Conflict).
   * Sends booking confirmation to patient.
   */
  bookAppointment({
    slotId,
    doctorId,
    slotTime,
    patientId,
    patientName,
    patientEmail,
    patientPhone,
    reasonForVisit,
    currentTime = Date.now(),
    actorUserId,
    actorRole,
    clientIp
  }) {
    if (!patientId) {
      const err = new Error('Patient ID is required to book an appointment');
      err.status = 400;
      throw err;
    }

    // Clean expired holds
    db.cleanExpiredHolds(currentTime);

    // Locate the slot either by slotId or by (doctorId, slotTime)
    let slot = null;
    if (slotId) {
      slot = db.findSlotById(slotId);
    }
    if (!slot && doctorId && slotTime) {
      slot = db.findSlotByDoctorAndTime(doctorId, slotTime);
    }

    if (!slot) {
      const err = new Error(
        slotId
          ? `Appointment slot ${slotId} not found`
          : `No appointment slot found for Doctor ${doctorId} at ${slotTime}`
      );
      err.status = 404;
      err.type = 'https://hms.hospital.com/errors/not-found';
      err.title = 'Resource Not Found';
      throw err;
    }

    const lockKey = `lock:slot:${slot.doctorId}:${slot.slotTime}`;

    // Atomic double-booking check:
    // If the slot is already BOOKED:
    if (slot.status === 'BOOKED') {
      db.appendAuditLog({
        actorUserId: actorUserId || patientId,
        actorRole: actorRole || 'PATIENT',
        clientIp: clientIp || '127.0.0.1',
        actionType: 'APPOINTMENT_DOUBLE_BOOKING_REJECTED',
        targetResource: `SLOT:${slot.slotId}`,
        status: 'FAILED_CONFLICT',
        details: `Rejected concurrent booking attempt for patient ${patientId}: Slot already booked`
      });

      const err = new Error('Slot already booked. Selected slot has already been reserved.');
      err.status = 409;
      err.type = 'https://hms.hospital.com/errors/slot-already-booked';
      err.title = 'Conflict';
      err.detail = 'Slot already booked. Selected slot has already been reserved.';
      throw err;
    }

    // Attempt to acquire atomic mutex lock (SETNX simulation)
    const acquired = this._acquireMutex(lockKey, patientId, 60000, currentTime);
    if (!acquired) {
      db.appendAuditLog({
        actorUserId: actorUserId || patientId,
        actorRole: actorRole || 'PATIENT',
        clientIp: clientIp || '127.0.0.1',
        actionType: 'APPOINTMENT_DOUBLE_BOOKING_REJECTED',
        targetResource: `SLOT:${slot.slotId}`,
        status: 'FAILED_CONFLICT',
        details: `Lock acquisition failed for slot ${slot.slotId}: Concurrent reservation in progress`
      });

      const err = new Error('Slot already booked. Selected slot has already been reserved.');
      err.status = 409;
      err.type = 'https://hms.hospital.com/errors/slot-already-booked';
      err.title = 'Conflict';
      err.detail = 'Slot already booked. Selected slot has already been reserved.';
      throw err;
    }

    // If held by another patient and hold has not expired:
    if (slot.status === 'HELD' && slot.heldBy && slot.heldBy !== String(patientId)) {
      const hold = db.slotHolds.get(slot.slotId);
      if (hold && hold.holdExpiresAt > currentTime) {
        this._releaseMutex(lockKey, patientId);
        db.appendAuditLog({
          actorUserId: actorUserId || patientId,
          actorRole: actorRole || 'PATIENT',
          clientIp: clientIp || '127.0.0.1',
          actionType: 'APPOINTMENT_DOUBLE_BOOKING_REJECTED',
          targetResource: `SLOT:${slot.slotId}`,
          status: 'FAILED_CONFLICT',
          details: `Rejected booking attempt: Slot held by another patient (${slot.heldBy})`
        });

        const err = new Error('Slot already booked. Selected slot has already been reserved.');
        err.status = 409;
        err.type = 'https://hms.hospital.com/errors/slot-already-booked';
        err.title = 'Conflict';
        err.detail = 'Slot already booked. Selected slot has already been reserved.';
        throw err;
      }
    }

    // ATOMIC RESERVATION SUCCESS
    slot.status = 'BOOKED';
    slot.bookedBy = String(patientId);
    slot.bookedAt = new Date(currentTime).toISOString();
    slot.heldBy = null;
    slot.holdExpiresAt = null;
    db.slotHolds.delete(slot.slotId);

    // Resolve patient details
    const existingPatient = db.findPatientById(patientId);
    const resolvedPatientName = patientName || (existingPatient ? existingPatient.name : `Patient ${patientId}`);
    const resolvedEmail = patientEmail || (existingPatient?.email || `${patientId.toLowerCase()}@hospital.com`);
    const resolvedPhone = patientPhone || (existingPatient?.phone || '9876543210');

    // Create Appointment Record (ID: APT-XXXX)
    const appointmentId = `APT-${Math.floor(1000 + Math.random() * 9000)}`;
    const appointment = db.createAppointment({
      appointmentId,
      slotId: slot.slotId,
      patientId: String(patientId),
      patientName: resolvedPatientName,
      doctorId: slot.doctorId,
      doctorName: slot.doctorName,
      slotTime: slot.slotTime,
      reasonForVisit: reasonForVisit || 'General Consultation',
      status: 'CONFIRMED',
      createdAt: new Date(currentTime).toISOString()
    });

    // Release temporary mutex lock (slot is now permanently marked BOOKED)
    this._releaseMutex(lockKey, patientId);

    // Automated Confirmation Notifications (Acceptance Criteria 4 / FR-APPT-04)
    const confirmation = db.createNotification({
      confirmationId: `CNF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      appointmentId: appointment.appointmentId,
      patientId: String(patientId),
      recipientEmail: resolvedEmail,
      recipientPhone: resolvedPhone,
      channels: ['EMAIL', 'SMS'],
      emailBody: `Dear ${resolvedPatientName}, your consultation appointment with ${slot.doctorName} on ${slot.slotTime} has been successfully CONFIRMED. Appointment ID: ${appointment.appointmentId}.`,
      smsBody: `HMS Alert: Your appointment (${appointment.appointmentId}) with ${slot.doctorName} for ${slot.slotTime} is CONFIRMED.`,
      sentAt: new Date(currentTime).toISOString()
    });

    // Audit Log (SEC-REQ-2.1)
    db.appendAuditLog({
      actorUserId: actorUserId || patientId,
      actorRole: actorRole || 'PATIENT',
      clientIp: clientIp || '127.0.0.1',
      actionType: 'APPOINTMENT_CONFIRMED',
      targetResource: `APPOINTMENT:${appointment.appointmentId}`,
      status: 'SUCCESS',
      details: `Appointment confirmed for patient ${patientId} with doctor ${slot.doctorId} for slot ${slot.slotTime}. Booking confirmation notification dispatched.`
    });

    return {
      appointmentId: appointment.appointmentId,
      status: 'CONFIRMED',
      appointment,
      slot,
      confirmation,
      message: 'Appointment booked successfully. Confirmation sent to patient.'
    };
  }

  /**
   * Retrieve Appointment Details by ID
   */
  getAppointmentById(appointmentId) {
    const appointment = db.findAppointmentById(appointmentId);
    if (!appointment) {
      const err = new Error(`Appointment with ID ${appointmentId} not found`);
      err.status = 404;
      err.type = 'https://hms.hospital.com/errors/not-found';
      throw err;
    }
    return appointment;
  }

  /**
   * Retrieve Booking Confirmations for Patient (FR-APPT-04)
   */
  getConfirmationsByPatientId(patientId) {
    return db.getNotificationsByPatientId(patientId);
  }

  /**
   * Cancel Appointment (US-08 / FR-APPT-03)
   * Allows cancellation up to 2 hours before the scheduled time.
   * Immediately releases the canceled slot back to the available pool.
   * Updates appointment status to "Cancelled" in patient history.
   * Dispatches automated cancellation notification (FR-APPT-04).
   */
  cancelAppointment({
    appointmentId,
    reason,
    currentTime = Date.now(),
    actorUserId,
    actorRole,
    clientIp
  }) {
    if (!appointmentId) {
      const err = new Error('Appointment ID is required');
      err.status = 400;
      throw err;
    }

    const appointment = db.findAppointmentById(appointmentId);
    if (!appointment) {
      const err = new Error(`Appointment with ID ${appointmentId} not found`);
      err.status = 404;
      err.type = 'https://hms.hospital.com/errors/not-found';
      err.title = 'Resource Not Found';
      throw err;
    }

    // RBAC / IDOR check:
    // PATIENT can only cancel their own appointment.
    // RECEPTIONIST, DOCTOR, ADMIN can cancel appointments.
    if (actorRole === 'PATIENT' && actorUserId && appointment.patientId !== actorUserId) {
      const err = new Error('Access Denied: You cannot cancel an appointment for another patient');
      err.status = 403;
      err.type = 'https://hms.hospital.com/errors/insufficient-privilege';
      err.title = 'Forbidden';
      throw err;
    }

    if (appointment.status === 'CANCELLED') {
      const err = new Error('Appointment has already been cancelled');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/already-cancelled';
      err.title = 'Bad Request';
      throw err;
    }

    // 2-Hour Window Rule Check (FR-APPT-03)
    const slotTimeMs = new Date(appointment.slotTime).getTime();
    const timeDiffMs = slotTimeMs - currentTime;
    const twoHoursMs = 2 * 60 * 60 * 1000; // 7,200,000 ms

    if (timeDiffMs < twoHoursMs) {
      const err = new Error('Appointments cannot be cancelled within 2 hours of the scheduled time.');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/cancellation-window-expired';
      err.title = 'Cancellation Window Expired';
      err.detail = 'Appointments cannot be cancelled within 2 hours of the scheduled time.';
      throw err;
    }

    // 1. Update appointment status to "Cancelled" in patient history
    appointment.status = 'CANCELLED';
    appointment.cancelledAt = new Date(currentTime).toISOString();
    appointment.cancelledBy = actorUserId || 'SYSTEM';
    appointment.cancellationReason = reason || 'Patient requested cancellation';
    appointment.updatedAt = new Date(currentTime).toISOString();

    if (!appointment.history) appointment.history = [];
    appointment.history.push({
      status: 'CANCELLED',
      timestamp: new Date(currentTime).toISOString(),
      cancelledBy: actorUserId || 'SYSTEM',
      reason: appointment.cancellationReason
    });

    // 2. Immediately release the canceled slot back to the available pool
    if (appointment.slotId) {
      const slot = db.findSlotById(appointment.slotId);
      if (slot) {
        slot.status = 'AVAILABLE';
        slot.bookedBy = null;
        slot.bookedAt = null;
        slot.heldBy = null;
        slot.holdExpiresAt = null;
      }
      db.slotHolds.delete(appointment.slotId);
      if (db.slotLocks) {
        db.slotLocks.delete(`lock:slot:${appointment.doctorId}:${appointment.slotTime}`);
      }
    }

    // 3. Automated Cancellation Notification (FR-APPT-04)
    const notification = db.createNotification({
      confirmationId: `CNF-CANC-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      appointmentId: appointment.appointmentId,
      patientId: appointment.patientId,
      recipientEmail: appointment.patientEmail || `${appointment.patientId.toLowerCase()}@hospital.com`,
      recipientPhone: appointment.patientPhone || '9876543210',
      channels: ['EMAIL', 'SMS'],
      emailBody: `Dear ${appointment.patientName}, your appointment (${appointment.appointmentId}) scheduled for ${appointment.slotTime} has been CANCELLED as requested. The slot has been released back to the hospital pool.`,
      smsBody: `HMS Alert: Appointment ${appointment.appointmentId} on ${appointment.slotTime} is CANCELLED.`,
      sentAt: new Date(currentTime).toISOString()
    });

    // 4. Immutable Audit Log (SEC-REQ-2.1)
    db.appendAuditLog({
      actorUserId: actorUserId || appointment.patientId,
      actorRole: actorRole || 'PATIENT',
      clientIp: clientIp || '127.0.0.1',
      actionType: 'APPOINTMENT_CANCELLED',
      targetResource: `APPOINTMENT:${appointment.appointmentId}`,
      status: 'SUCCESS',
      details: `Appointment ${appointment.appointmentId} cancelled at least 2 hours prior to scheduled time. Slot ${appointment.slotId} released.`
    });

    return {
      appointmentId: appointment.appointmentId,
      status: 'CANCELLED',
      appointment,
      releasedSlotId: appointment.slotId,
      notification,
      message: 'Appointment successfully cancelled. Slot has been immediately released back to the available pool.'
    };
  }

  /**
   * Reschedule Appointment (US-08 / FR-APPT-03)
   * Allows rescheduling up to 2 hours before the current scheduled time.
   * Immediately releases the old slot back to the available pool.
   * Atomically books the new slot.
   * Updates appointment status to "Rescheduled" in patient history.
   * Dispatches automated notification (FR-APPT-04).
   */
  rescheduleAppointment({
    appointmentId,
    newSlotId,
    newDoctorId,
    newSlotTime,
    reason,
    currentTime = Date.now(),
    actorUserId,
    actorRole,
    clientIp
  }) {
    if (!appointmentId) {
      const err = new Error('Appointment ID is required');
      err.status = 400;
      throw err;
    }

    const appointment = db.findAppointmentById(appointmentId);
    if (!appointment) {
      const err = new Error(`Appointment with ID ${appointmentId} not found`);
      err.status = 404;
      err.type = 'https://hms.hospital.com/errors/not-found';
      err.title = 'Resource Not Found';
      throw err;
    }

    // RBAC / IDOR check
    if (actorRole === 'PATIENT' && actorUserId && appointment.patientId !== actorUserId) {
      const err = new Error('Access Denied: You cannot reschedule an appointment for another patient');
      err.status = 403;
      err.type = 'https://hms.hospital.com/errors/insufficient-privilege';
      err.title = 'Forbidden';
      throw err;
    }

    if (appointment.status === 'CANCELLED') {
      const err = new Error('Cannot reschedule an appointment that has already been cancelled');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/cannot-reschedule-cancelled';
      err.title = 'Bad Request';
      throw err;
    }

    // 2-Hour Window Rule Check on CURRENT appointment (FR-APPT-03)
    const currentSlotTimeMs = new Date(appointment.slotTime).getTime();
    const timeDiffMs = currentSlotTimeMs - currentTime;
    const twoHoursMs = 2 * 60 * 60 * 1000;

    if (timeDiffMs < twoHoursMs) {
      const err = new Error('Appointments cannot be rescheduled within 2 hours of the scheduled time.');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/reschedule-window-expired';
      err.title = 'Rescheduling Window Expired';
      err.detail = 'Appointments cannot be rescheduled within 2 hours of the scheduled time.';
      throw err;
    }

    // Clean expired holds
    db.cleanExpiredHolds(currentTime);

    // Locate the target new slot
    let newSlot = null;
    if (newSlotId) {
      newSlot = db.findSlotById(newSlotId);
    }
    if (!newSlot && newDoctorId && newSlotTime) {
      newSlot = db.findSlotByDoctorAndTime(newDoctorId, newSlotTime);
    }

    if (!newSlot) {
      const err = new Error(
        newSlotId
          ? `Target slot ${newSlotId} not found`
          : `No slot found for Doctor ${newDoctorId} at ${newSlotTime}`
      );
      err.status = 404;
      err.type = 'https://hms.hospital.com/errors/not-found';
      throw err;
    }

    // Check if new slot is available
    if (newSlot.status === 'BOOKED') {
      const err = new Error('Target slot is already booked. Please choose an open slot.');
      err.status = 409;
      err.type = 'https://hms.hospital.com/errors/slot-already-booked';
      err.title = 'Conflict';
      throw err;
    }

    if (newSlot.status === 'HELD' && newSlot.heldBy && newSlot.heldBy !== appointment.patientId) {
      const hold = db.slotHolds.get(newSlot.slotId);
      if (hold && hold.holdExpiresAt > currentTime) {
        const err = new Error('Target slot is currently held by another patient. Please choose another slot.');
        err.status = 409;
        err.type = 'https://hms.hospital.com/errors/slot-already-booked';
        err.title = 'Conflict';
        throw err;
      }
    }

    const oldSlotId = appointment.slotId;
    const oldSlotTime = appointment.slotTime;

    // 1. Immediately release the old slot back to the available pool
    if (oldSlotId) {
      const oldSlot = db.findSlotById(oldSlotId);
      if (oldSlot) {
        oldSlot.status = 'AVAILABLE';
        oldSlot.bookedBy = null;
        oldSlot.bookedAt = null;
        oldSlot.heldBy = null;
        oldSlot.holdExpiresAt = null;
      }
      db.slotHolds.delete(oldSlotId);
      if (db.slotLocks) {
        db.slotLocks.delete(`lock:slot:${appointment.doctorId}:${oldSlotTime}`);
      }
    }

    // 2. Atomically book the new slot
    newSlot.status = 'BOOKED';
    newSlot.bookedBy = appointment.patientId;
    newSlot.bookedAt = new Date(currentTime).toISOString();
    newSlot.heldBy = null;
    newSlot.holdExpiresAt = null;
    db.slotHolds.delete(newSlot.slotId);

    // 3. Update appointment record and history
    if (!appointment.history) appointment.history = [];
    appointment.history.push({
      status: 'RESCHEDULED',
      previousSlotId: oldSlotId,
      previousSlotTime: oldSlotTime,
      rescheduledAt: new Date(currentTime).toISOString(),
      rescheduledBy: actorUserId || 'SYSTEM',
      reason: reason || 'Patient requested reschedule'
    });

    appointment.status = 'RESCHEDULED';
    appointment.slotId = newSlot.slotId;
    appointment.slotTime = newSlot.slotTime;
    appointment.doctorId = newSlot.doctorId;
    appointment.doctorName = newSlot.doctorName;
    appointment.rescheduledAt = new Date(currentTime).toISOString();
    appointment.updatedAt = new Date(currentTime).toISOString();

    // 4. Automated Reschedule Notification (FR-APPT-04)
    const notification = db.createNotification({
      confirmationId: `CNF-RESCH-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      appointmentId: appointment.appointmentId,
      patientId: appointment.patientId,
      recipientEmail: appointment.patientEmail || `${appointment.patientId.toLowerCase()}@hospital.com`,
      recipientPhone: appointment.patientPhone || '9876543210',
      channels: ['EMAIL', 'SMS'],
      emailBody: `Dear ${appointment.patientName}, your appointment (${appointment.appointmentId}) has been RESCHEDULED to ${newSlot.slotTime} with ${newSlot.doctorName}. Old slot ${oldSlotTime} has been released.`,
      smsBody: `HMS Alert: Appointment ${appointment.appointmentId} rescheduled to ${newSlot.slotTime} with ${newSlot.doctorName}.`,
      sentAt: new Date(currentTime).toISOString()
    });

    // 5. Immutable Audit Log (SEC-REQ-2.1)
    db.appendAuditLog({
      actorUserId: actorUserId || appointment.patientId,
      actorRole: actorRole || 'PATIENT',
      clientIp: clientIp || '127.0.0.1',
      actionType: 'APPOINTMENT_RESCHEDULED',
      targetResource: `APPOINTMENT:${appointment.appointmentId}`,
      status: 'SUCCESS',
      details: `Appointment ${appointment.appointmentId} rescheduled from ${oldSlotTime} to ${newSlot.slotTime}. Old slot ${oldSlotId} released back to public pool.`
    });

    return {
      appointmentId: appointment.appointmentId,
      status: 'RESCHEDULED',
      appointment,
      releasedSlotId: oldSlotId,
      newSlotId: newSlot.slotId,
      newSlotTime: newSlot.slotTime,
      notification,
      message: 'Appointment successfully rescheduled. Previous slot has been immediately released back to available pool.'
    };
  }

  /**
   * Retrieve appointments for a patient (history)
   */
  getPatientAppointments(patientId) {
    return db.getAppointmentsByPatientId(patientId);
  }
}

const appointmentService = new AppointmentService();
module.exports = appointmentService;
