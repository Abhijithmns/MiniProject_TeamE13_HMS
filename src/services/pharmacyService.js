'use strict';

const db = require('../db');

/**
 * Stock health status classifications per FR-PHARM-03 / SRS Section 3.6
 */
const STOCK_STATUS = Object.freeze({
  ADEQUATE: 'ADEQUATE',
  LOW_STOCK: 'LOW_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK'
});

class PharmacyService {
  /**
   * Retrieve live dispensary queue of verified doctor prescriptions (FR-PHARM-01)
   * @param {Object} [filter] Optional filter { status: 'PENDING_DISPENSE' | 'DISPENSED' }
   * @returns {Array} List of queue items
   */
  getDispensaryQueue(filter = {}) {
    const queue = db.getPharmacyQueue(filter);
    return queue.map(item => ({
      ...item,
      itemCount: Array.isArray(item.prescriptions) ? item.prescriptions.length : 0
    }));
  }

  /**
   * Retrieve pharmacy medication stock inventory with low-stock status (FR-PHARM-02, FR-PHARM-03)
   * @returns {Array} Inventory items with computed stock health
   */
  getInventory() {
    const items = db.getAllInventory();
    return items.map(item => {
      const threshold = item.alertThreshold !== undefined ? item.alertThreshold : 10;
      const isLowStock = item.stock < threshold;
      let stockStatus = STOCK_STATUS.ADEQUATE;
      if (item.stock === 0) {
        stockStatus = STOCK_STATUS.OUT_OF_STOCK;
      } else if (isLowStock) {
        stockStatus = STOCK_STATUS.LOW_STOCK;
      }
      return {
        ...item,
        alertThreshold: threshold,
        isLowStock,
        stockStatus
      };
    });
  }

  /**
   * Retrieve a single inventory item by ID or name
   * @param {string} idOrName Medication ID or name
   * @returns {Object|null}
   */
  getInventoryItem(idOrName) {
    return db.getInventoryItem(idOrName);
  }

  /**
   * Add a new medication or update existing inventory stock (FR-PHARM-02)
   * @param {Object} params Medication details
   */
  addOrUpdateInventory({
    medicationId,
    name,
    category,
    stock,
    alertThreshold,
    unit,
    unitPrice,
    batchNo,
    expiryDate,
    actorUserId = 'SYSTEM',
    actorRole = 'PHARMACIST',
    clientIp = '127.0.0.1'
  }) {
    if (!name || !name.trim()) {
      const err = new Error('Medication name is required.');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/invalid-inventory-data';
      throw err;
    }

    const stockQty = stock !== undefined ? parseInt(stock, 10) : 0;
    if (isNaN(stockQty) || stockQty < 0) {
      const err = new Error('Stock quantity must be a non-negative integer.');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/invalid-inventory-data';
      throw err;
    }

    const threshold = alertThreshold !== undefined ? parseInt(alertThreshold, 10) : 10;

    const item = db.createOrUpdateInventoryItem({
      medicationId,
      name: name.trim(),
      category: category ? category.trim() : 'General',
      stock: stockQty,
      alertThreshold: threshold,
      unit: unit ? unit.trim() : 'units',
      unitPrice: unitPrice !== undefined ? parseFloat(unitPrice) : 0,
      batchNo: batchNo ? batchNo.trim() : `BATCH-${Date.now()}`,
      expiryDate: expiryDate || '2028-12-31'
    });

    // Immutable audit log (SEC-REQ-2.1)
    db.appendAuditLog({
      actorUserId,
      actorRole,
      clientIp,
      actionType: 'PHARMACY_STOCK_UPDATE',
      targetResource: `MEDICATION:${item.medicationId}`,
      status: 'SUCCESS',
      details: `Inventory updated for ${item.name} (${item.medicationId}). Stock: ${item.stock}, Threshold: ${item.alertThreshold}`
    });

    return item;
  }

  /**
   * Dispense medication from prescription queue or direct dispensation (FR-PHARM-02, FR-PHARM-03, TC-HMS-07)
   * Decrements stock automatically and triggers low-stock alert when item falls below threshold.
   * 
   * @param {Object} options
   * @param {string} [options.queueId] Prescription queue identifier
   * @param {string} [options.medicationId] Direct medication identifier (TC-HMS-07)
   * @param {number} [options.quantity] Direct quantity to dispense (TC-HMS-07)
   * @param {string} [options.notes] Dispensation notes
   * @param {string} options.actorUserId
   * @param {string} options.actorRole
   * @param {string} options.clientIp
   */
  dispenseMedication({
    queueId,
    medicationId,
    quantity,
    notes,
    actorUserId = 'SYSTEM',
    actorRole = 'PHARMACIST',
    clientIp = '127.0.0.1'
  }) {
    // ─── Direct Medication Dispensation (TC-HMS-07 step 2) ───────────────────
    if (medicationId) {
      const item = db.getInventoryItem(medicationId);
      if (!item) {
        const err = new Error(`Medication not found in inventory: ${medicationId}`);
        err.status = 404;
        err.type = 'https://hms.hospital.com/errors/medication-not-found';
        throw err;
      }

      const qty = parseInt(quantity, 10);
      if (isNaN(qty) || qty <= 0) {
        const err = new Error('Dispense quantity must be a positive integer.');
        err.status = 400;
        err.type = 'https://hms.hospital.com/errors/invalid-dispense-quantity';
        throw err;
      }

      const decResult = db.decrementInventoryStock(item.medicationId, qty);
      if (!decResult.success) {
        const err = new Error(`Insufficient stock for medication "${item.name}". Available: ${decResult.previousStock}, Requested: ${qty}`);
        err.status = 400;
        err.type = 'https://hms.hospital.com/errors/insufficient-stock';
        throw err;
      }

      const alerts = [];
      let alertRecord = null;
      // Trigger low-stock alert when stock falls below alertThreshold (FR-PHARM-03, TC-HMS-07)
      if (decResult.isLowStock) {
        alertRecord = db.createLowStockAlert({
          medicationId: item.medicationId,
          medicationName: item.name,
          currentStock: decResult.newStock,
          alertThreshold: item.alertThreshold
        });
        alerts.push(alertRecord);

        db.appendAuditLog({
          actorUserId,
          actorRole,
          clientIp,
          actionType: 'PHARMACY_LOW_STOCK_ALERT',
          targetResource: `MEDICATION:${item.medicationId}`,
          status: 'WARNING',
          details: `LOW STOCK ALERT: ${item.name} (${item.medicationId}) dropped to ${decResult.newStock} units (threshold: ${item.alertThreshold})`
        });
      }

      db.appendAuditLog({
        actorUserId,
        actorRole,
        clientIp,
        actionType: 'PHARMACY_DISPENSE',
        targetResource: `MEDICATION:${item.medicationId}`,
        status: 'SUCCESS',
        details: `Dispensed ${qty} units of ${item.name} (${item.medicationId}). Stock reduced from ${decResult.previousStock} to ${decResult.newStock}.`
      });

      return {
        status: 'SUCCESS',
        message: `Dispensed ${qty} units of ${item.name} successfully.`,
        medicationId: item.medicationId,
        medicationName: item.name,
        dispensedQuantity: qty,
        previousStock: decResult.previousStock,
        remainingStock: decResult.newStock,
        isLowStock: decResult.isLowStock,
        alert: alertRecord,
        alerts
      };
    }

    // ─── Queue-based Prescription Dispensation (FR-PHARM-01, FR-PHARM-02) ───
    if (!queueId) {
      const err = new Error('Either queueId or medicationId must be provided for dispensing.');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/missing-dispense-target';
      throw err;
    }

    const queueItem = db.getPharmacyQueueItem(queueId);
    if (!queueItem) {
      const err = new Error(`Prescription queue item "${queueId}" not found.`);
      err.status = 404;
      err.type = 'https://hms.hospital.com/errors/queue-item-not-found';
      throw err;
    }

    if (queueItem.status === 'DISPENSED') {
      const err = new Error(`Prescription "${queueId}" has already been dispensed.`);
      err.status = 409;
      err.type = 'https://hms.hospital.com/errors/already-dispensed';
      throw err;
    }

    // 1. Dry-run verification: check stock sufficiency for ALL prescribed items
    const prescriptions = Array.isArray(queueItem.prescriptions) ? queueItem.prescriptions : [];
    const itemsToDispense = [];

    for (const p of prescriptions) {
      const medName = p.medication || p.name || p.medicationId;
      const qty = parseInt(p.quantity || 1, 10);
      const invItem = db.getInventoryItem(medName);

      if (!invItem) {
        const err = new Error(`Prescribed medication "${medName}" is not registered in pharmacy inventory.`);
        err.status = 404;
        err.type = 'https://hms.hospital.com/errors/medication-not-found';
        throw err;
      }

      if (invItem.stock < qty) {
        const err = new Error(`Insufficient stock for medication "${invItem.name}". Available: ${invItem.stock}, Requested: ${qty}`);
        err.status = 400;
        err.type = 'https://hms.hospital.com/errors/insufficient-stock';
        throw err;
      }

      itemsToDispense.push({
        invItem,
        requestedQty: qty,
        dosage: p.dosage,
        instructions: p.instructions
      });
    }

    // 2. Perform atomic stock decrements & low-stock checks
    const alerts = [];
    const dispensedDetails = [];

    for (const { invItem, requestedQty, dosage, instructions } of itemsToDispense) {
      const decResult = db.decrementInventoryStock(invItem.medicationId, requestedQty);
      dispensedDetails.push({
        medicationId: invItem.medicationId,
        medicationName: invItem.name,
        dosage,
        instructions,
        dispensedQuantity: requestedQty,
        previousStock: decResult.previousStock,
        remainingStock: decResult.newStock,
        isLowStock: decResult.isLowStock
      });

      if (decResult.isLowStock) {
        const alertRecord = db.createLowStockAlert({
          medicationId: invItem.medicationId,
          medicationName: invItem.name,
          currentStock: decResult.newStock,
          alertThreshold: invItem.alertThreshold
        });
        alerts.push(alertRecord);

        db.appendAuditLog({
          actorUserId,
          actorRole,
          clientIp,
          actionType: 'PHARMACY_LOW_STOCK_ALERT',
          targetResource: `MEDICATION:${invItem.medicationId}`,
          status: 'WARNING',
          details: `LOW STOCK ALERT: ${invItem.name} (${invItem.medicationId}) dropped to ${decResult.newStock} units (threshold: ${invItem.alertThreshold})`
        });
      }
    }

    // 3. Update queue item status to DISPENSED
    const updatedQueueItem = db.updatePharmacyQueueItem(queueId, {
      status: 'DISPENSED',
      dispensedAt: new Date().toISOString(),
      dispensedBy: actorUserId,
      dispensedByRole: actorRole,
      dispensedNotes: notes ? String(notes).trim() : 'Prescription fulfilled',
      dispensedItems: dispensedDetails
    });

    // 4. Append immutable audit log (SEC-REQ-2.1)
    db.appendAuditLog({
      actorUserId,
      actorRole,
      clientIp,
      actionType: 'PHARMACY_DISPENSE',
      targetResource: `QUEUE:${queueId}`,
      status: 'SUCCESS',
      details: `Prescription ${queueId} dispensed by ${actorUserId}. ${itemsToDispense.length} items dispensed.`
    });

    return {
      status: 'SUCCESS',
      message: `Prescription ${queueId} successfully dispensed.`,
      queueItem: updatedQueueItem,
      dispensedItems: dispensedDetails,
      alerts
    };
  }

  /**
   * Retrieve active low-stock alerts (FR-PHARM-03, TC-HMS-07)
   */
  getLowStockAlerts() {
    return db.getLowStockAlerts();
  }
}

const pharmacyService = new PharmacyService();
module.exports = pharmacyService;
