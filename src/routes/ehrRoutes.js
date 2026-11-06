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
