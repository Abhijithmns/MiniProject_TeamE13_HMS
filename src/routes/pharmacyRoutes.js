'use strict';

const express = require('express');
const router = express.Router();
const pharmacyService = require('../services/pharmacyService');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/rbac');

/**
 * GET /api/v1/pharmacy/queue
 * Live queue of verified prescriptions sent to hospital pharmacy dispensary (FR-PHARM-01)
 * RBAC: Restricted to PHARMACIST, ADMIN, and DOCTOR.
 */
router.get('/queue', authenticateToken, requireRole(['PHARMACIST', 'ADMIN', 'DOCTOR']), (req, res) => {
  try {
    const { status } = req.query;
    const queue = pharmacyService.getDispensaryQueue(status ? { status } : {});
    return res.status(200).json({
      status: 'success',
      count: queue.length,
      data: { queue }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/pharmacy-queue-failed',
      title: 'Pharmacy Queue Error',
      status,
      detail: error.message
    });
  }
});

/**
 * POST /api/v1/pharmacy/dispense
 * Mark prescription as DISPENSED, auto-decrement inventory counts, and trigger low-stock alert if applicable (FR-PHARM-02, FR-PHARM-03, TC-HMS-07)
 * RBAC: Restricted to PHARMACIST and ADMIN.
 */
router.post('/dispense', authenticateToken, requireRole(['PHARMACIST', 'ADMIN']), (req, res) => {
  try {
    const { queueId, medicationId, quantity, notes } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress;

    const result = pharmacyService.dispenseMedication({
      queueId,
      medicationId,
      quantity,
      notes,
      actorUserId: req.user.id,
      actorRole: req.user.role,
      clientIp
    });

    return res.status(200).json({
      status: 'success',
      message: result.message,
      data: result
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/pharmacy-dispense-failed',
      title: status === 403 ? 'Access Forbidden' : (status === 409 ? 'Prescription Conflict' : 'Pharmacy Dispensation Error'),
      status,
      detail: error.message
    });
  }
});

/**
 * GET /api/v1/pharmacy/inventory
 * View medication stock levels and low-stock alerts (FR-PHARM-02, FR-PHARM-03)
 * RBAC: Restricted to PHARMACIST, ADMIN, and DOCTOR.
 */
router.get('/inventory', authenticateToken, requireRole(['PHARMACIST', 'ADMIN', 'DOCTOR']), (req, res) => {
  try {
    const inventory = pharmacyService.getInventory();
    return res.status(200).json({
      status: 'success',
      count: inventory.length,
      data: { inventory }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/inventory-fetch-failed',
      title: 'Pharmacy Inventory Error',
      status,
      detail: error.message
    });
  }
});

/**
 * POST /api/v1/pharmacy/inventory
 * Add or restock medication items in inventory (FR-PHARM-02)
 * RBAC: Restricted to PHARMACIST and ADMIN.
 */
router.post('/inventory', authenticateToken, requireRole(['PHARMACIST', 'ADMIN']), (req, res) => {
  try {
    const {
      medicationId,
      name,
      category,
      stock,
      alertThreshold,
      unit,
      unitPrice,
      batchNo,
      expiryDate
    } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress;

    const item = pharmacyService.addOrUpdateInventory({
      medicationId,
      name,
      category,
      stock,
      alertThreshold,
      unit,
      unitPrice,
      batchNo,
      expiryDate,
      actorUserId: req.user.id,
      actorRole: req.user.role,
      clientIp
    });

    return res.status(201).json({
      status: 'success',
      message: `Medication "${item.name}" inventory successfully updated.`,
      data: { item }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/inventory-update-failed',
      title: 'Pharmacy Inventory Update Error',
      status,
      detail: error.message
    });
  }
});

/**
 * GET /api/v1/pharmacy/alerts
 * View active low-stock alerts (FR-PHARM-03, TC-HMS-07)
 * RBAC: Restricted to PHARMACIST and ADMIN.
 */
router.get('/alerts', authenticateToken, requireRole(['PHARMACIST', 'ADMIN']), (req, res) => {
  try {
    const alerts = pharmacyService.getLowStockAlerts();
    return res.status(200).json({
      status: 'success',
      count: alerts.length,
      data: { alerts }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/alerts-fetch-failed',
      title: 'Pharmacy Alerts Error',
      status,
      detail: error.message
    });
  }
});

module.exports = router;
