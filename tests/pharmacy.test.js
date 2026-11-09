'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const authService = require('../src/services/authService');
const patientService = require('../src/services/patientService');
const ehrService = require('../src/services/ehrService');
const pharmacyService = require('../src/services/pharmacyService');

describe('Sprint 2: [US-13 / TC-HMS-07] Pharmacy Medicine Stock and Low Stock Alerts', () => {
  let pharmacistToken;
  let adminToken;
  let doctorToken;
  let receptionistToken;
  let patientToken;
  let testPatient;

  beforeEach(async () => {
    db.reset();

    // Authenticate Pharmacist
    const pharmAuth = await authService.login({
      email: 'pharmacist@hospital.com',
      password: 'HospSecure#2026'
    });
    pharmacistToken = pharmAuth.accessToken;

    // Authenticate Admin
    const adminAuth = await authService.login({
      email: 'admin@hospital.com',
      password: 'HospSecure#2026'
    });
    adminToken = adminAuth.accessToken;

    // Authenticate Doctor
    const docAuth = await authService.login({
      email: 'doctor.smith@hospital.com',
      password: 'HospSecure#2026'
    });
    doctorToken = docAuth.accessToken;

    // Authenticate Receptionist
    const recAuth = await authService.login({
      email: 'receptionist@hospital.com',
      password: 'HospSecure#2026'
    });
    receptionistToken = recAuth.accessToken;

    // Authenticate Patient
    const patAuth = await authService.login({
      email: 'patient.jane@hospital.com',
      password: 'HospSecure#2026'
    });
    patientToken = patAuth.accessToken;

    // Register a test patient
    testPatient = patientService.registerPatient({
      name: 'Eleanor Vance',
      dateOfBirth: '1988-04-12',
      gender: 'FEMALE',
      phone: '9876543210',
      emergencyContact: 'John Vance'
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. TC-HMS-07: Test Case Execution as specified in Test_Plan.md
  // ───────────────────────────────────────────────────────────────────────────
  describe('Test Case TC-HMS-07: Pharmacy Stock Auto-Decrement and Low-Stock Alert Trigger', () => {
    test('Pre-condition: Medication "Paracetamol 500mg" (MED-012) initial stock = 12, alertThreshold = 10', () => {
      const item = db.getInventoryItem('MED-012');
      assert.ok(item, 'Medication MED-012 should exist in inventory');
      assert.strictEqual(item.name, 'Paracetamol 500mg');
      assert.strictEqual(item.stock, 12, 'Initial stock should be 12 units');
      assert.strictEqual(item.alertThreshold, 10, 'Alert threshold should be 10 units');
    });

    test('Step 1 & 2: Pharmacist dispenses 5 units of "Paracetamol 500mg" (MED-012)', () => {
      const result = pharmacyService.dispenseMedication({
        medicationId: 'MED-012',
        quantity: 5,
        actorUserId: 'USR-PHARM-01',
        actorRole: 'PHARMACIST',
        clientIp: '127.0.0.1'
      });

      assert.strictEqual(result.status, 'SUCCESS');
      assert.strictEqual(result.medicationId, 'MED-012');
      assert.strictEqual(result.dispensedQuantity, 5);
      assert.strictEqual(result.previousStock, 12);
      assert.strictEqual(result.remainingStock, 7, 'Stock should decrement from 12 to 7');
      assert.strictEqual(result.isLowStock, true, 'Stock 7 is below threshold 10, should flag low stock');
      assert.ok(result.alert, 'Low stock alert record should be generated');
      assert.strictEqual(result.alert.currentStock, 7);
      assert.strictEqual(result.alert.alertThreshold, 10);
    });

    test('Step 3: Query inventory stock table and notification queue (FR-PHARM-02, FR-PHARM-03)', () => {
      // Dispense 5 units to bring stock from 12 to 7
      pharmacyService.dispenseMedication({
        medicationId: 'MED-012',
        quantity: 5,
        actorUserId: 'USR-PHARM-01',
        actorRole: 'PHARMACIST'
      });

      // Query inventory table
      const inventory = pharmacyService.getInventory();
      const med012 = inventory.find(i => i.medicationId === 'MED-012');
      assert.ok(med012);
      assert.strictEqual(med012.stock, 7, 'Stock must persist at 7 units');
      assert.strictEqual(med012.isLowStock, true);
      assert.strictEqual(med012.stockStatus, 'LOW_STOCK');

      // Query alerts queue
      const alerts = pharmacyService.getLowStockAlerts();
      assert.ok(alerts.length >= 1, 'At least 1 alert should be recorded');
      const medAlert = alerts.find(a => a.medicationId === 'MED-012');
      assert.ok(medAlert, 'Alert for MED-012 must exist in alerts queue');
      assert.strictEqual(medAlert.currentStock, 7);
      assert.strictEqual(medAlert.status, 'ACTIVE');

      // Verify audit logs for administrative restocking visibility
      const auditLogs = db.getAuditLogs();
      const dispenseLog = auditLogs.find(l => l.actionType === 'PHARMACY_DISPENSE' && l.targetResource.includes('MED-012'));
      const alertLog = auditLogs.find(l => l.actionType === 'PHARMACY_LOW_STOCK_ALERT' && l.targetResource.includes('MED-012'));
      assert.ok(dispenseLog, 'PHARMACY_DISPENSE audit log must be recorded');
      assert.ok(alertLog, 'PHARMACY_LOW_STOCK_ALERT audit log must be recorded');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. FR-PHARM-01: Live Dispensary Queue from Doctor Consultations
  // ───────────────────────────────────────────────────────────────────────────
  describe('FR-PHARM-01: Live Queue of Verified Prescriptions', () => {
    test('should automatically enqueue prescriptions when doctor completes consultation', () => {
      // Doctor completes consultation
      ehrService.recordConsultation({
        patientId: testPatient.patientId,
        vitals: { bloodPressure: '120/80', heartRate: 72, temperature: 98.6 },
        symptoms: ['Mild fever', 'Headache'],
        examinationNotes: 'Throat clear, vitals normal',
        diagnosis: 'Tension Headache',
        prescriptions: [
          { name: 'Paracetamol 500mg', dosage: '500mg', quantity: 2, instructions: 'Twice daily' },
          { name: 'Amoxicillin 500mg', dosage: '500mg', quantity: 1, instructions: 'Once daily' }
        ],
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR',
        doctorName: 'Dr. Sarah Smith'
      });

      const queue = pharmacyService.getDispensaryQueue();
      assert.ok(queue.length > 0, 'Dispensary queue should contain the enqueued prescription');
      const latest = queue[queue.length - 1];
      assert.strictEqual(latest.patientId, testPatient.patientId);
      assert.strictEqual(latest.status, 'PENDING_DISPENSE');
      assert.strictEqual(latest.prescriptions.length, 2);
    });

    test('should allow filtering dispensary queue by status', () => {
      // Create consultation
      ehrService.recordConsultation({
        patientId: testPatient.patientId,
        vitals: { bloodPressure: '120/80' },
        symptoms: ['Cough'],
        examinationNotes: 'Chest clear',
        diagnosis: 'Acute Bronchitis',
        prescriptions: [{ name: 'Amoxicillin 500mg', dosage: '500mg', quantity: 5 }],
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR',
        doctorName: 'Dr. Sarah Smith'
      });

      const pending = pharmacyService.getDispensaryQueue({ status: 'PENDING_DISPENSE' });
      assert.ok(pending.length >= 1);
      assert.ok(pending.every(item => item.status === 'PENDING_DISPENSE'));

      const dispensed = pharmacyService.getDispensaryQueue({ status: 'DISPENSED' });
      assert.strictEqual(dispensed.length, 0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. FR-PHARM-02: Prescription Dispensing & Auto-Decrement Inventory
  // ───────────────────────────────────────────────────────────────────────────
  describe('FR-PHARM-02: Marking Prescription as Dispensed & Inventory Auto-Decrement', () => {
    test('should dispense queue item, decrement inventory counts, and mark queue item as DISPENSED', () => {
      // 1. Doctor creates consultation prescribing 2 units of Paracetamol 500mg (initial: 12)
      ehrService.recordConsultation({
        patientId: testPatient.patientId,
        vitals: { bloodPressure: '120/80' },
        symptoms: ['Fever'],
        examinationNotes: 'Normal',
        diagnosis: 'Pyrexia',
        prescriptions: [
          { name: 'Paracetamol 500mg', dosage: '500mg', quantity: 2, instructions: 'After meals' }
        ],
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR',
        doctorName: 'Dr. Sarah Smith'
      });

      const queue = pharmacyService.getDispensaryQueue({ status: 'PENDING_DISPENSE' });
      const itemToDispense = queue[0];
      assert.ok(itemToDispense);

      // 2. Pharmacist dispenses the prescription
      const result = pharmacyService.dispenseMedication({
        queueId: itemToDispense.queueId,
        actorUserId: 'USR-PHARM-01',
        actorRole: 'PHARMACIST',
        notes: 'Dispensed original prescription'
      });

      assert.strictEqual(result.status, 'SUCCESS');
      assert.strictEqual(result.queueItem.status, 'DISPENSED');
      assert.strictEqual(result.queueItem.dispensedBy, 'USR-PHARM-01');
      assert.ok(result.queueItem.dispensedAt);

      // 3. Verify stock decremented: 12 - 2 = 10
      const med = db.getInventoryItem('MED-012');
      assert.strictEqual(med.stock, 10);
    });

    test('should prevent double dispensing of already dispensed prescription (409 Conflict)', () => {
      ehrService.recordConsultation({
        patientId: testPatient.patientId,
        vitals: { bloodPressure: '120/80' },
        symptoms: ['Pain'],
        examinationNotes: 'Sprain',
        diagnosis: 'Ankle Sprain',
        prescriptions: [
          { name: 'Ibuprofen 400mg', dosage: '400mg', quantity: 2 }
        ],
        actorUserId: 'USR-DOC-01',
        actorRole: 'DOCTOR',
        doctorName: 'Dr. Sarah Smith'
      });

      const queueItem = pharmacyService.getDispensaryQueue({ status: 'PENDING_DISPENSE' })[0];

      // First dispense succeeds
      pharmacyService.dispenseMedication({
        queueId: queueItem.queueId,
        actorUserId: 'USR-PHARM-01',
        actorRole: 'PHARMACIST'
      });

      // Second dispense attempt must fail with 409 Conflict
      assert.throws(() => {
        pharmacyService.dispenseMedication({
          queueId: queueItem.queueId,
          actorUserId: 'USR-PHARM-01',
          actorRole: 'PHARMACIST'
        });
      }, /already been dispensed/);
    });

    test('should reject dispensing and preserve stock if requested quantity exceeds available stock', () => {
      const initialStock = db.getInventoryItem('MED-012').stock; // 12 units

      assert.throws(() => {
        pharmacyService.dispenseMedication({
          medicationId: 'MED-012',
          quantity: 20, // Exceeds 12 available
          actorUserId: 'USR-PHARM-01',
          actorRole: 'PHARMACIST'
        });
      }, /Insufficient stock/);

      // Verify stock was not changed
      const currentStock = db.getInventoryItem('MED-012').stock;
      assert.strictEqual(currentStock, initialStock, 'Stock must not change when transaction is rejected');
    });

    test('should reject dispensing with non-existent medication ID', () => {
      assert.throws(() => {
        pharmacyService.dispenseMedication({
          medicationId: 'MED-NONEXISTENT',
          quantity: 1,
          actorUserId: 'USR-PHARM-01',
          actorRole: 'PHARMACIST'
        });
      }, /not found in inventory/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. FR-PHARM-03: Low Stock Alerts and Restocking
  // ───────────────────────────────────────────────────────────────────────────
  describe('FR-PHARM-03: Low Stock Alerts and Restocking Management', () => {
    test('should trigger low-stock alert when stock falls below configurable threshold', () => {
      // Amoxicillin has stock 50, alertThreshold 15
      const initialAmx = db.getInventoryItem('MED-001');
      assert.strictEqual(initialAmx.stock, 50);

      // Dispense 40 units -> new stock = 10, which is < threshold (15)
      const res = pharmacyService.dispenseMedication({
        medicationId: 'MED-001',
        quantity: 40,
        actorUserId: 'USR-PHARM-01',
        actorRole: 'PHARMACIST'
      });

      assert.strictEqual(res.remainingStock, 10);
      assert.strictEqual(res.isLowStock, true);
      assert.ok(res.alert);
      assert.strictEqual(res.alert.medicationId, 'MED-001');
      assert.strictEqual(res.alert.currentStock, 10);
      assert.strictEqual(res.alert.alertThreshold, 15);
    });

    test('should NOT trigger low-stock alert when remaining stock is above threshold', () => {
      // Ibuprofen has stock 25, alertThreshold 10
      // Dispense 5 units -> new stock = 20, which is >= 10
      const res = pharmacyService.dispenseMedication({
        medicationId: 'MED-005',
        quantity: 5,
        actorUserId: 'USR-PHARM-01',
        actorRole: 'PHARMACIST'
      });

      assert.strictEqual(res.remainingStock, 20);
      assert.strictEqual(res.isLowStock, false);
      assert.strictEqual(res.alert, null);
    });

    test('should allow restocking medication and reflect updated stock levels', () => {
      // Restock Paracetamol from current 12 by +30 units = 42 units
      const restocked = pharmacyService.addOrUpdateInventory({
        medicationId: 'MED-012',
        name: 'Paracetamol 500mg',
        stock: 42,
        alertThreshold: 10,
        batchNo: 'BATCH-PCM-RESTOCK-01',
        actorUserId: 'USR-PHARM-01',
        actorRole: 'PHARMACIST'
      });

      assert.strictEqual(restocked.stock, 42);
      assert.strictEqual(restocked.batchNo, 'BATCH-PCM-RESTOCK-01');

      const item = db.getInventoryItem('MED-012');
      assert.strictEqual(item.stock, 42);
    });

    test('should allow creating a new medication item in inventory', () => {
      const newItem = pharmacyService.addOrUpdateInventory({
        medicationId: 'MED-099',
        name: 'Metformin 500mg',
        category: 'Antidiabetic',
        stock: 100,
        alertThreshold: 20,
        unit: 'tablets',
        unitPrice: 3.5,
        actorUserId: 'USR-ADMIN-01',
        actorRole: 'ADMIN'
      });

      assert.strictEqual(newItem.medicationId, 'MED-099');
      assert.strictEqual(newItem.name, 'Metformin 500mg');
      assert.strictEqual(newItem.stock, 100);

      const found = db.getInventoryItem('MED-099');
      assert.ok(found);
      assert.strictEqual(found.category, 'Antidiabetic');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Audit Trail & Role-Based Access Control Boundaries
  // ───────────────────────────────────────────────────────────────────────────
  describe('RBAC & Audit Trail Verification (SEC-REQ-1.1, SEC-REQ-2.1)', () => {
    test('should record immutable audit log for every dispensation', () => {
      pharmacyService.dispenseMedication({
        medicationId: 'MED-012',
        quantity: 1,
        actorUserId: 'USR-PHARM-01',
        actorRole: 'PHARMACIST'
      });

      const auditLogs = db.getAuditLogs();
      const lastDispense = auditLogs.find(l => l.actionType === 'PHARMACY_DISPENSE');
      assert.ok(lastDispense);
      assert.strictEqual(lastDispense.actorUserId, 'USR-PHARM-01');
      assert.strictEqual(lastDispense.actorRole, 'PHARMACIST');
      assert.strictEqual(lastDispense.status, 'SUCCESS');
    });

    test('should record immutable audit log for stock updates', () => {
      pharmacyService.addOrUpdateInventory({
        name: 'Omeprazole 20mg',
        stock: 40,
        actorUserId: 'USR-PHARM-01',
        actorRole: 'PHARMACIST'
      });

      const auditLogs = db.getAuditLogs();
      const stockLog = auditLogs.find(l => l.actionType === 'PHARMACY_STOCK_UPDATE');
      assert.ok(stockLog);
      assert.strictEqual(stockLog.actorUserId, 'USR-PHARM-01');
      assert.strictEqual(stockLog.status, 'SUCCESS');
    });
  });
});
