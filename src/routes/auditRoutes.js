const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/rbac');
const db = require('../db');

// Protected: Only System Administrator can inspect audit logs (US-14 / SEC-REQ-2.1)
router.get('/logs', authenticateToken, requireRole(['ADMIN']), (req, res) => {
  const logs = db.getAuditLogs();

  return res.status(200).json({
    status: 'success',
    totalEntries: logs.length,
    data: {
      logs
    }
  });
});

module.exports = router;
