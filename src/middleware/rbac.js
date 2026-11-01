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

module.exports = requireRole;
