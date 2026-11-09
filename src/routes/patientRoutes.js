'use strict';

const express = require('express');
const router = express.Router();
const patientService = require('../services/patientService');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/rbac');

// Only RECEPTIONIST, DOCTOR, and ADMIN can access patient data
const PATIENT_ACCESS_ROLES = ['RECEPTIONIST', 'DOCTOR', 'ADMIN'];
const PATIENT_ACCOUNT_LINK_ROLES = ['RECEPTIONIST', 'ADMIN'];

/**
 * POST /api/v1/patients/register
 * Register a new patient with a unique 10-digit MPI ID (US-04 / FR-PAT-01, FR-PAT-02)
 */
router.post('/register', authenticateToken, requireRole(PATIENT_ACCESS_ROLES), (req, res) => {
  try {
    const { name, dateOfBirth, gender, phone, bloodGroup, emergencyContact, accountUserId } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress;

    const patient = patientService.registerPatient({
      name,
      dateOfBirth,
      gender,
      phone,
      bloodGroup,
      emergencyContact,
      accountUserId,
      actorUserId: req.user.id,
      actorRole: req.user.role,
      clientIp
    });

    return res.status(201).json({
      status: 'success',
      message: `Patient registered successfully with ID ${patient.patientId}`,
      data: { patient }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: 'https://hms.hospital.com/errors/patient-registration-failed',
      title: 'Patient Registration Error',
      status,
      detail: error.message,
      errors: error.errors || undefined
    });
  }
});

/**
 * POST /api/v1/patients/:patientId/account
 * Link an existing MPI record to its patient login so personal prescriptions are available in the portal.
 */
router.post('/:patientId/account', authenticateToken, requireRole(PATIENT_ACCOUNT_LINK_ROLES), (req, res) => {
  try {
    const patient = patientService.linkPatientAccount({
      patientId: req.params.patientId,
      accountUserId: req.body.accountUserId,
      actorUserId: req.user.id,
      actorRole: req.user.role,
      clientIp: req.ip || req.connection?.remoteAddress
    });
    return res.status(200).json({ status: 'success', data: { patient } });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/patient-account-link-failed',
      title: status === 403 ? 'Access Forbidden' : 'Patient Account Link Error',
      status,
      detail: error.message
    });
  }
});

/**
 * GET /api/v1/patients/search?q=<query>
 * Quick patient search by exact Patient ID, phone number, or partial name (US-05 / FR-PAT-03)
 * Exact IDs and phones use maps; partial names use a trigram index.
 */
router.get('/search', authenticateToken, requireRole(PATIENT_ACCESS_ROLES), (req, res) => {
  try {
    const { q } = req.query;
    const clientIp = req.ip || req.connection?.remoteAddress;

    const searchResult = patientService.searchPatients({
      query: q,
      actorUserId: req.user.id,
      actorRole: req.user.role,
      clientIp
    });

    return res.status(200).json({
      status: 'success',
      ...searchResult
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: 'https://hms.hospital.com/errors/patient-search-failed',
      title: 'Patient Search Error',
      status,
      detail: error.message
    });
  }
});

/**
 * GET /api/v1/patients
 * Retrieve all registered patients (RECEPTIONIST / DOCTOR / ADMIN only)
 */
router.get('/', authenticateToken, requireRole(PATIENT_ACCESS_ROLES), (req, res) => {
  try {
    const patients = patientService.getAllPatients();
    return res.status(200).json({
      status: 'success',
      count: patients.length,
      data: { patients }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: 'https://hms.hospital.com/errors/patient-fetch-failed',
      title: 'Patient Fetch Error',
      status,
      detail: error.message
    });
  }
});

/**
 * GET /api/v1/patients/:patientId
 * Retrieve a single patient by 10-digit MPI ID (RECEPTIONIST / DOCTOR / ADMIN only)
 */
router.get('/:patientId', authenticateToken, requireRole(PATIENT_ACCESS_ROLES), (req, res) => {
  try {
    const patient = patientService.getPatientById(req.params.patientId);
    return res.status(200).json({
      status: 'success',
      data: { patient }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: 'https://hms.hospital.com/errors/patient-not-found',
      title: 'Patient Not Found',
      status,
      detail: error.message
    });
  }
});

module.exports = router;
