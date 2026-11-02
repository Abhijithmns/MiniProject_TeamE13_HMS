const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/rbac');
const db = require('../db');

// All portal routes require a valid JWT token
router.use(authenticateToken);

// Patient Portal Endpoint (Only PATIENT role)
router.get('/patient', requireRole(['PATIENT']), (req, res) => {
  db.appendAuditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    clientIp: req.ip || req.connection?.remoteAddress,
    actionType: 'PORTAL_ACCESS',
    targetResource: '/api/v1/portal/patient',
    status: 'SUCCESS',
    details: 'Patient accessed personal records portal'
  });

  return res.status(200).json({
    status: 'success',
    portal: 'Patient Portal',
    message: `Welcome, ${req.user.name}. You have access to your personal health records, appointments, and invoices.`,
    data: {
      accessibleFeatures: [
        'View My Appointments',
        'Book New Consultation',
        'Download My Prescriptions',
        'View My Billing Statements'
      ]
    }
  });
});

// Doctor Portal Endpoint (Only DOCTOR role)
router.get('/doctor', requireRole(['DOCTOR']), (req, res) => {
  db.appendAuditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    clientIp: req.ip || req.connection?.remoteAddress,
    actionType: 'PORTAL_ACCESS',
    targetResource: '/api/v1/portal/doctor',
    status: 'SUCCESS',
    details: 'Doctor accessed clinical EHR management portal'
  });

  return res.status(200).json({
    status: 'success',
    portal: 'Doctor Clinical Portal',
    message: `Welcome, Dr. ${req.user.name}. You have access to your consultation queue and assigned patient records.`,
    data: {
      accessibleFeatures: [
        'View Today Consultation Roster',
        'Record Patient Diagnosis & Vitals',
        'Issue Signed Electronic Prescriptions',
        'Lock Consultation Notes'
      ]
    }
  });
});

// Receptionist Portal Endpoint (Only RECEPTIONIST role)
router.get('/receptionist', requireRole(['RECEPTIONIST']), (req, res) => {
  db.appendAuditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    clientIp: req.ip || req.connection?.remoteAddress,
    actionType: 'PORTAL_ACCESS',
    targetResource: '/api/v1/portal/receptionist',
    status: 'SUCCESS',
    details: 'Receptionist accessed front-desk onboarding portal'
  });

  return res.status(200).json({
    status: 'success',
    portal: 'Front-Desk Reception Portal',
    message: `Welcome, ${req.user.name}. You have access to patient intake, directory search, and scheduling.`,
    data: {
      accessibleFeatures: [
        'Register New Patient (10-Digit MPI)',
        'Search Patient Directory',
        'Schedule & Lock Doctor Consultation Slots',
        'Collect Consultation Payments'
      ]
    }
  });
});

module.exports = router;
