'use strict';

const express = require('express');
const router = express.Router();
const appointmentService = require('../services/appointmentService');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/rbac');

/**
 * POST /api/v1/appointments/working-hours
 * Doctor Sets Working Hours and Generates 15-Minute Slots (FR-APPT-01)
 * RBAC: Restricted to DOCTOR and ADMIN.
 */
router.post(
  '/working-hours',
  authenticateToken,
  requireRole(['DOCTOR', 'ADMIN']),
  (req, res) => {
    try {
      const {
        doctorId,
        doctorName,
        date,
        startTime,
        endTime,
        slotDurationMinutes
      } = req.body;

      const clientIp = req.ip || req.connection?.remoteAddress;

      const effectiveDoctorId =
        req.user.role === 'DOCTOR' ? (doctorId || req.user.id) : (doctorId || req.user.id);

      const result = appointmentService.setWorkingHours({
        doctorId: effectiveDoctorId,
        doctorName: doctorName || req.user.name,
        date,
        startTime,
        endTime,
        slotDurationMinutes: Number(slotDurationMinutes) || 15,
        actorUserId: req.user.id,
        actorRole: req.user.role,
        clientIp
      });

      return res.status(201).json({
        status: 'success',
        message: 'Doctor working hours configured and consultation slots generated.',
        data: result
      });
    } catch (error) {
      const status = error.status || 400;
      return res.status(status).json({
        type: error.type || 'https://hms.hospital.com/errors/working-hours-configuration-failed',
        title: error.title || (status === 403 ? 'Access Forbidden' : 'Working Hours Configuration Error'),
        status,
        detail: error.message,
        message: error.message
      });
    }
  }
);

/**
 * GET /api/v1/appointments/slots
 * Shows ONLY currently available slots for the selected doctor (Acceptance Criteria 1 / FR-APPT-02)
 * RBAC: Accessible to authenticated users (PATIENT, RECEPTIONIST, DOCTOR, ADMIN).
 */
router.get(
  '/slots',
  authenticateToken,
  (req, res) => {
    try {
      const { doctorId, date, simulatedCurrentTime } = req.query;
      const requestingPatientId =
        req.user.role === 'PATIENT' ? req.user.id : req.query.patientId || null;

      const currentTime = simulatedCurrentTime
        ? new Date(simulatedCurrentTime).getTime()
        : Date.now();

      const result = appointmentService.getAvailableSlots({
        doctorId,
        date: date || null,
        requestingPatientId,
        currentTime
      });

      return res.status(200).json({
        status: 'success',
        message: 'Currently available consultation slots retrieved successfully.',
        data: result
      });
    } catch (error) {
      const status = error.status || 400;
      return res.status(status).json({
        type: error.type || 'https://hms.hospital.com/errors/slot-retrieval-failed',
        title: error.title || 'Slot Retrieval Error',
        status,
        detail: error.message,
        message: error.message
      });
    }
  }
);

/**
 * POST /api/v1/appointments/slots/:slotId/hold
 * Temporarily hold a slot so another person cannot pick it (Acceptance Criteria 2 / FR-APPT-02)
 * Locks slot for 5 minutes (TTL).
 */
router.post(
  '/slots/:slotId/hold',
  authenticateToken,
  (req, res) => {
    try {
      const { slotId } = req.params;
      const { simulatedCurrentTime, holdDurationMinutes } = req.body;
      const patientId =
        req.user.role === 'PATIENT' ? req.user.id : (req.body.patientId || req.user.id);
      const clientIp = req.ip || req.connection?.remoteAddress;

      const currentTime = simulatedCurrentTime
        ? new Date(simulatedCurrentTime).getTime()
        : Date.now();

      const result = appointmentService.holdSlot({
        slotId,
        patientId,
        patientName: req.user.name,
        holdDurationMinutes: holdDurationMinutes || 5,
        currentTime,
        actorUserId: req.user.id,
        actorRole: req.user.role,
        clientIp
      });

      return res.status(200).json({
        status: 'success',
        message: 'Slot temporarily held. Proceed to checkout.',
        data: result
      });
    } catch (error) {
      const status = error.status || 400;
      return res.status(status).json({
        type: error.type || 'https://hms.hospital.com/errors/slot-hold-failed',
        title: error.title || (status === 409 ? 'Conflict' : 'Slot Hold Error'),
        status,
        detail: error.detail || error.message,
        message: error.message
      });
    }
  }
);

/**
 * POST /api/v1/appointments/slots/:slotId/release
 * Release temporary hold on a slot
 */
router.post(
  '/slots/:slotId/release',
  authenticateToken,
  (req, res) => {
    try {
      const { slotId } = req.params;
      const patientId = req.user.role === 'PATIENT' ? req.user.id : req.body.patientId;
      const clientIp = req.ip || req.connection?.remoteAddress;

      const result = appointmentService.releaseSlotHold({
        slotId,
        patientId,
        actorUserId: req.user.id,
        actorRole: req.user.role,
        clientIp
      });

      return res.status(200).json({
        status: 'success',
        message: result.message,
        data: result
      });
    } catch (error) {
      const status = error.status || 400;
      return res.status(status).json({
        type: error.type || 'https://hms.hospital.com/errors/slot-release-failed',
        title: error.title || 'Slot Release Error',
        status,
        detail: error.message,
        message: error.message
      });
    }
  }
);

/**
 * POST /api/v1/appointments
 * Atomically reserves an appointment consultation slot (Acceptance Criteria 3 & 4 / FR-APPT-02, TC-HMS-04)
 * If two users try to confirm the same slot at the same time, the first succeeds and the second
 * receives a "Slot already booked" message (409 Conflict).
 * Dispatches automated confirmation to the patient.
 */
router.post(
  '/',
  authenticateToken,
  (req, res) => {
    try {
      const {
        slotId,
        doctorId,
        slotTime,
        patientId,
        patientName,
        patientEmail,
        patientPhone,
        reasonForVisit,
        simulatedCurrentTime
      } = req.body;

      const clientIp = req.ip || req.connection?.remoteAddress;
      const effectivePatientId =
        req.user.role === 'PATIENT' ? req.user.id : (patientId || req.user.id);

      const currentTime = simulatedCurrentTime
        ? new Date(simulatedCurrentTime).getTime()
        : Date.now();

      const result = appointmentService.bookAppointment({
        slotId,
        doctorId,
        slotTime,
        patientId: effectivePatientId,
        patientName: patientName || req.user.name,
        patientEmail: patientEmail || req.user.email,
        patientPhone,
        reasonForVisit,
        currentTime,
        actorUserId: req.user.id,
        actorRole: req.user.role,
        clientIp
      });

      return res.status(201).json({
        status: 'success',
        message: result.message,
        appointmentId: result.appointmentId,
        data: result
      });
    } catch (error) {
      const status = error.status || 500;
      return res.status(status).json({
        type: error.type || 'https://hms.hospital.com/errors/slot-already-booked',
        title: error.title || (status === 409 ? 'Conflict' : 'Appointment Booking Error'),
        status,
        detail: error.detail || error.message,
        message: error.message
      });
    }
  }
);

/**
 * GET /api/v1/appointments/:id
 * Retrieve Appointment details
 */
router.get(
  '/:id',
  authenticateToken,
  (req, res) => {
    try {
      const appointment = appointmentService.getAppointmentById(req.params.id);
      return res.status(200).json({
        status: 'success',
        data: { appointment }
      });
    } catch (error) {
      const status = error.status || 404;
      return res.status(status).json({
        type: error.type || 'https://hms.hospital.com/errors/not-found',
        title: error.title || 'Not Found',
        status,
        detail: error.message,
        message: error.message
      });
    }
  }
);

/**
 * GET /api/v1/appointments/confirmations/patient/:patientId
 * Retrieve booking confirmation notifications for a patient (FR-APPT-04)
 */
router.get(
  '/confirmations/patient/:patientId',
  authenticateToken,
  (req, res) => {
    try {
      const patientId = req.params.patientId;
      const confirmations = appointmentService.getConfirmationsByPatientId(patientId);
      return res.status(200).json({
        status: 'success',
        count: confirmations.length,
        data: { confirmations }
      });
    } catch (error) {
      const status = error.status || 400;
      return res.status(status).json({
        type: error.type || 'https://hms.hospital.com/errors/confirmation-fetch-failed',
        title: 'Confirmation Fetch Error',
        status,
        detail: error.message,
        message: error.message
      });
    }
  }
);

module.exports = router;
