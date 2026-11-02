'use strict';

const db = require('../db');

/**
 * Role-Based Access Control Middleware (FR-AUTH-04 / SEC-REQ-1.1 / US-03)
 * @param {Array<string>} allowedRoles List of roles permitted to access endpoint
 */
function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        type: 'https://hms.hospital.com/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'User context is missing. Authentication required.'
      });
    }

    const userRole = req.user.role ? req.user.role.toUpperCase() : '';
    const normalizedAllowed = allowedRoles.map(r => r.toUpperCase());

    // ADMIN always has full access or check role match
    if (userRole === 'ADMIN' || normalizedAllowed.includes(userRole)) {
      return next();
    }

    // Access Denied: Log attempt in immutable audit trail (SEC-REQ-2.1)
    db.appendAuditLog({
      actorUserId: req.user.id,
      actorRole: req.user.role,
      clientIp: req.ip || req.connection?.remoteAddress,
      actionType: 'RBAC_ACCESS_DENIED',
      targetResource: req.originalUrl,
      status: 'FORBIDDEN',
      details: `Role [${userRole}] attempted access to endpoint requiring [${normalizedAllowed.join(', ')}]`
    });

    return res.status(403).json({
      type: 'https://hms.hospital.com/errors/insufficient-privilege',
      title: 'Forbidden',
      status: 403,
      detail: 'Access Denied: Insufficient privilege for requested resource.',
      userRole,
      requiredRoles: normalizedAllowed
    });
  };
}

/**
 * Insecure Direct Object Reference (IDOR) Protection Middleware (SEC-REQ-1.1 / US-03)
 * Enforces that PATIENT users cannot inspect other patients' records by tampering with URL parameters.
 * @param {string} paramKey Route parameter name containing the patient identifier
 */
function verifyPatientOwnership(paramKey = 'patientId') {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        type: 'https://hms.hospital.com/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Authentication required'
      });
    }

    const userRole = req.user.role ? req.user.role.toUpperCase() : '';
    const requestedId = req.params[paramKey];

    // Doctors and Admins are permitted clinical access
    if (userRole === 'ADMIN' || userRole === 'DOCTOR') {
      return next();
    }

    // Patient role must own the requested record
    if (userRole === 'PATIENT') {
      const isOwner = (req.user.id === requestedId || req.user.patientId === requestedId);
      if (isOwner) {
        return next();
      }

      // Log IDOR breach attempt in audit trail
      db.appendAuditLog({
        actorUserId: req.user.id,
        actorRole: req.user.role,
        clientIp: req.ip || req.connection?.remoteAddress,
        actionType: 'IDOR_ACCESS_DENIED',
        targetResource: req.originalUrl,
        status: 'FORBIDDEN',
        details: `Patient [${req.user.id}] attempted unauthorized access to record [${requestedId}]`
      });

      return res.status(403).json({
        type: 'https://hms.hospital.com/errors/idor-prohibited',
        title: 'Forbidden',
        status: 403,
        detail: "Access Denied: You cannot view another patient's medical records."
      });
    }

    return res.status(403).json({
      type: 'https://hms.hospital.com/errors/insufficient-privilege',
      title: 'Forbidden',
      status: 403,
      detail: 'Access Denied: Insufficient privilege for requested clinical record.'
    });
  };
}

requireRole.requireRole = requireRole;
requireRole.verifyPatientOwnership = verifyPatientOwnership;

module.exports = requireRole;
