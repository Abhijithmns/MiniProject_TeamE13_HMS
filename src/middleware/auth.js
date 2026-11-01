const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    db.appendAuditLog({
      actorUserId: 'ANONYMOUS',
      actorRole: 'NONE',
      clientIp: req.ip || req.connection?.remoteAddress,
      actionType: 'AUTH_TOKEN_MISSING',
      targetResource: req.originalUrl,
      status: 'UNAUTHORIZED',
      details: 'Missing Bearer authorization header'
    });
    return res.status(401).json({
      type: 'https://hms.hospital.com/errors/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Authentication token is required. Please log in.'
    });
  }

  jwt.verify(token, config.JWT_SECRET, (err, user) => {
    if (err) {
      db.appendAuditLog({
        actorUserId: 'INVALID',
        actorRole: 'NONE',
        clientIp: req.ip || req.connection?.remoteAddress,
        actionType: 'AUTH_TOKEN_INVALID',
        targetResource: req.originalUrl,
        status: 'FORBIDDEN',
        details: err.message
      });
      return res.status(403).json({
        type: 'https://hms.hospital.com/errors/invalid-token',
        title: 'Forbidden',
        status: 403,
        detail: 'Authentication token is invalid or has expired.'
      });
    }

    req.user = user;
    next();
  });
}

module.exports = authenticateToken;
