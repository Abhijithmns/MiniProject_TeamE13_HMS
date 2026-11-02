'use strict';

const express = require('express');
const router = express.Router();
const prescriptionService = require('../services/prescriptionService');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/rbac');

/**
 * POST /api/v1/prescriptions
 * Create a new digital prescription (US-11 / FR-EHR-04, SEC-REQ-2.2)
 * DOCTOR and ADMIN only.
 */
router.post('/', authenticateToken, requireRole(['DOCTOR', 'ADMIN']), async (req, res) => {
  try {
    const { patientId, diagnosis, vitals, medicines } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress;

    const prescription = prescriptionService.createPrescription({
      patientId,
      diagnosis,
      vitals,
      medicines,
      actorUserId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      clientIp
    });

    return res.status(201).json({
      status: 'success',
      message: 'Prescription created successfully',
      data: { prescription }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: 'https://hms.hospital.com/errors/prescription-creation-failed',
      title: 'Prescription Creation Failed',
      status,
      detail: error.message,
      errors: error.errors || undefined
    });
  }
});

/**
 * GET /api/v1/prescriptions/:id
 * Retrieve details of a prescription by ID.
 * PATIENT, DOCTOR, ADMIN
 */
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const prescription = prescriptionService.getPrescriptionById(req.params.id);
    return res.status(200).json({
      status: 'success',
      data: { prescription }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: 'https://hms.hospital.com/errors/prescription-not-found',
      title: 'Prescription Not Found',
      status,
      detail: error.message
    });
  }
});

/**
 * GET /api/v1/prescriptions/:id/pdf
 * Download digital prescription as a clean PDF (US-11 / FR-EHR-04)
 * Contains doctor details, patient ID, date, vitals, medicines, and HMAC verification code.
 */
router.get('/:id/pdf', authenticateToken, async (req, res) => {
  try {
    const clientIp = req.ip || req.connection?.remoteAddress;
    const pdfBuffer = await prescriptionService.generatePrescriptionPdf(
      req.params.id,
      req.user.id,
      req.user.role,
      clientIp
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="prescription-${req.params.id}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    return res.status(200).send(pdfBuffer);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: 'https://hms.hospital.com/errors/prescription-pdf-generation-failed',
      title: 'PDF Generation Failed',
      status,
      detail: error.message
    });
  }
});

/**
 * GET /api/v1/prescriptions/:id/verify
 * Public or authenticated verification check for genuine/untampered prescription code (SEC-REQ-2.2).
 */
router.get('/:id/verify', (req, res) => {
  try {
    const result = prescriptionService.verifyPrescription(req.params.id);
    return res.status(200).json({
      status: 'success',
      data: result
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: 'https://hms.hospital.com/errors/prescription-verify-failed',
      title: 'Prescription Verification Failed',
      status,
      detail: error.message
    });
  }
});

/**
 * GET /api/v1/prescriptions/patient/:patientId
 * List all prescriptions for a specific patient.
 */
router.get('/patient/:patientId', authenticateToken, (req, res) => {
  try {
    const prescriptions = prescriptionService.getPrescriptionsByPatient(req.params.patientId);
    return res.status(200).json({
      status: 'success',
      count: prescriptions.length,
      data: { prescriptions }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: 'https://hms.hospital.com/errors/patient-prescriptions-fetch-failed',
      title: 'Prescriptions Fetch Failed',
      status,
      detail: error.message
    });
  }
});

module.exports = router;
