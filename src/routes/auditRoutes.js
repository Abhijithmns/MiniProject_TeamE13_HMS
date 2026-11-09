const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/rbac');
const db = require('../db');

// Prohibit modification or deletion of immutable audit logs (SEC-REQ-2.1)
router.use('/logs', (req, res, next) => {
  if (['PUT', 'DELETE', 'PATCH', 'POST'].includes(req.method)) {
    return res.status(405).json({
      type: 'https://hms.hospital.com/errors/immutable-audit-log',
      title: 'Method Not Allowed',
      status: 405,
      detail: 'Audit logs are strictly append-only and immutable. Modifying or deleting audit entries is prohibited.'
    });
  }
  next();
});

// Protected: Only System Administrator can inspect audit logs (US-14 / SEC-REQ-2.1)
router.get('/logs', authenticateToken, requireRole(['ADMIN']), (req, res) => {
  const { patientId, actionType, actorUserId, status } = req.query;

  const logs = db.getAuditLogs({
    patientId: patientId ? String(patientId).trim() : undefined,
    actionType: actionType ? String(actionType).trim() : undefined,
    actorUserId: actorUserId ? String(actorUserId).trim() : undefined,
    status: status ? String(status).trim() : undefined
  });

  return res.status(200).json({
    status: 'success',
    totalEntries: logs.length,
    filters: {
      patientId: patientId || null,
      actionType: actionType || null,
      actorUserId: actorUserId || null,
      status: status || null
    },
    data: {
      logs
    }
  });
});

module.exports = router;
