'use strict';

const express = require('express');
const router = express.Router();
const ehrService = require('../services/ehrService');
const db = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/rbac');

/**
 * POST /api/v1/ehr/consultations
 * Doctor records visit notes, vitals, diagnosis, and prescribed medicines (US-09 / FR-EHR-01, FR-EHR-02)
 * RBAC: Restricted to DOCTOR and ADMIN.
 */
router.post('/consultations', authenticateToken, requireRole(['DOCTOR', 'ADMIN']), (req, res) => {
  try {
    const {
      appointmentId,
      patientId,
      vitals,
      symptoms,
      examinationNotes,
      diagnosis,
      prescriptions
    } = req.body;

    const clientIp = req.ip || req.connection?.remoteAddress;

    const result = ehrService.recordConsultation({
      appointmentId,
      patientId,
      vitals,
      symptoms,
      examinationNotes,
      diagnosis,
      prescriptions,
      actorUserId: req.user.id,
      actorRole: req.user.role,
      doctorName: req.user.name,
      clientIp
    });

    return res.status(201).json({
      status: 'success',
      message: 'Consultation notes and digital prescriptions successfully recorded.',
      data: result
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/ehr-recording-failed',
      title: error.status === 403 ? 'Access Forbidden' : 'EHR Consultation Error',
      status,
      detail: error.message,
      errors: error.errors || undefined
    });
  }
});

/**
 * PUT /api/v1/ehr/consultations/:id
 * Direct update to clinical notes permitted ONLY within 24 hours (US-10 / FR-EHR-03, TC-HMS-05)
 * After 24 hours, returns 403 Forbidden: Direct edits prohibited; submit addendum.
 */
router.put('/consultations/:id', authenticateToken, requireRole(['DOCTOR', 'ADMIN']), (req, res) => {
  try {
    const consultationId = req.params.id;
    const clientIp = req.ip || req.connection?.remoteAddress;
    const { diagnosis, symptoms, examinationNotes, vitals, simulatedCurrentTime } = req.body;

    const updated = ehrService.updateConsultation(
      consultationId,
      { diagnosis, symptoms, examinationNotes, vitals },
      {
        actorUserId: req.user.id,
        actorRole: req.user.role,
        doctorName: req.user.name,
        clientIp,
        currentTime: simulatedCurrentTime ? new Date(simulatedCurrentTime).getTime() : Date.now()
      }
    );

    return res.status(200).json({
      status: 'success',
      message: 'Consultation notes successfully updated within the 24-hour window.',
      data: { consultation: updated }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/ehr-update-failed',
      title: error.status === 403 ? 'Direct Edits Prohibited' : 'EHR Update Error',
      status,
      detail: error.message
    });
  }
});

/**
 * POST /api/v1/ehr/consultations/:id/addendum
 * Append a permanent, timestamped addendum with physician name and ID (US-10 / FR-EHR-03)
 */
router.post('/consultations/:id/addendum', authenticateToken, requireRole(['DOCTOR', 'ADMIN']), (req, res) => {
  try {
    const consultationId = req.params.id;
    const clientIp = req.ip || req.connection?.remoteAddress;
    const { note, timestamp } = req.body;

    const result = ehrService.appendAddendum(consultationId, {
      note,
      actorUserId: req.user.id,
      actorRole: req.user.role,
      doctorName: req.user.name,
      clientIp,
      timestamp
    });

    return res.status(201).json({
      status: 'success',
      message: 'Addendum successfully appended to medical record.',
      data: result
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/addendum-failed',
      title: error.status === 403 ? 'Access Forbidden' : 'Addendum Error',
      status,
      detail: error.message
    });
  }
});

/**
 * GET /api/v1/ehr/consultations/:id
 * Retrieve a specific consultation record by ID.
 * RBAC: DOCTOR and ADMIN can access. RECEPTIONIST is denied access (US-03).
 */
router.get('/consultations/:id', authenticateToken, (req, res) => {
  try {
    const consultationId = req.params.id;
    const clientIp = req.ip || req.connection?.remoteAddress;

    const consultation = ehrService.getConsultationById(consultationId, {
      actorUserId: req.user.id,
      actorRole: req.user.role,
      clientIp
    });

    return res.status(200).json({
      status: 'success',
      data: { consultation }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/ehr-fetch-failed',
      title: error.status === 403 ? 'Access Forbidden' : 'EHR Fetch Error',
      status,
      detail: error.message
    });
  }
});

/**
 * GET /api/v1/ehr/consultations/:id/download
 * Download clinical record / prescription data and record EHR_DOWNLOAD in audit log (US-14 / SEC-REQ-2.1)
 */
router.get('/consultations/:id/download', authenticateToken, (req, res) => {
  try {
    const consultationId = req.params.id;
    const clientIp = req.ip || req.connection?.remoteAddress;

    const data = ehrService.downloadConsultation(consultationId, {
      actorUserId: req.user.id,
      actorRole: req.user.role,
      clientIp
    });

    return res.status(200).json({
      status: 'success',
      message: 'Medical record downloaded and access logged in immutable audit trail.',
      data
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/ehr-download-failed',
      title: error.status === 403 ? 'Access Forbidden' : 'EHR Download Error',
      status,
      detail: error.message
    });
  }
});

/**
 * GET /api/v1/ehr/patients/:patientId/consultations
 * Retrieve all clinical consultations recorded for a given patient.
 */
router.get('/patients/:patientId/consultations', authenticateToken, (req, res) => {
  try {
    const patientId = req.params.patientId;
    const clientIp = req.ip || req.connection?.remoteAddress;

    const consultations = ehrService.getPatientConsultations(patientId, {
      actorUserId: req.user.id,
      actorRole: req.user.role,
      clientIp
    });

    return res.status(200).json({
      status: 'success',
      patientId,
      count: consultations.length,
      data: { consultations }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/ehr-patient-history-failed',
      title: error.status === 403 ? 'Access Forbidden' : 'EHR Patient History Error',
      status,
      detail: error.message
    });
  }
});

/**
 * GET /api/v1/ehr/pharmacy/queue
 * Live queue of verified prescriptions sent to hospital pharmacy dispensary (FR-PHARM-01)
 */
router.get('/pharmacy/queue', authenticateToken, requireRole(['DOCTOR', 'ADMIN', 'PHARMACIST']), (req, res) => {
  try {
    const queue = db.getPharmacyQueue();
    return res.status(200).json({
      status: 'success',
      count: queue.length,
      data: { queue }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: 'https://hms.hospital.com/errors/pharmacy-queue-failed',
      title: 'Pharmacy Queue Error',
      status,
      detail: error.message
    });
  }
});

module.exports = router;
