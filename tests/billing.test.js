'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const db = require('../src/db');
const authService = require('../src/services/authService');
const patientService = require('../src/services/patientService');
const billingService = require('../src/services/billingService');
const app = require('../src/app');

function makeRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const url = `http://localhost:${port}${urlPath}`;

      fetch(url, options)
        .then(async res => {
          let body = null;
          try {
            body = await res.json();
          } catch {
            body = null;
          }
          server.close(() => {
            resolve({
              status: res.status,
              headers: res.headers,
              body
            });
          });
        })
        .catch(err => {
          server.close(() => reject(err));
        });
    });
  });
}

describe('Sprint 2: [US-12 / TC-HMS-06] Calculate Bill and Take Payments (FR-BILL-01, FR-BILL-02, FR-BILL-03)', () => {
  let adminToken;
  let receptionistToken;
  let patientAToken;
  let patientBToken;
  let doctorToken;
  let pharmacistToken;
  let testPatientA;
  let testPatientB;

  beforeEach(async () => {
    db.reset();

    // Authenticate Admin
    const adminAuth = await authService.login({
      email: 'admin@hospital.com',
      password: 'HospSecure#2026'
    });
    adminToken = adminAuth.accessToken;

    // Authenticate Receptionist
    const recAuth = await authService.login({
      email: 'receptionist@hospital.com',
      password: 'HospSecure#2026'
    });
    receptionistToken = recAuth.accessToken;

    // Authenticate Doctor
    const docAuth = await authService.login({
      email: 'doctor.smith@hospital.com',
      password: 'HospSecure#2026'
    });
    doctorToken = docAuth.accessToken;

    // Authenticate Pharmacist
    const pharmAuth = await authService.login({
      email: 'pharmacist@hospital.com',
      password: 'HospSecure#2026'
    });
    pharmacistToken = pharmAuth.accessToken;

    // Authenticate Patient A (PAT-01)
    const patAAuth = await authService.login({
      email: 'patient.alice@hospital.com',
      password: 'HospSecure#2026'
    });
    patientAToken = patAAuth.accessToken;

    // Authenticate Patient B (PAT-02)
    const patBAuth = await authService.login({
      email: 'patient.bob@hospital.com',
      password: 'HospSecure#2026'
    });
    patientBToken = patBAuth.accessToken;

    // Register test patients
    testPatientA = patientService.registerPatient({
      name: 'Alice Smith',
      dateOfBirth: '1990-05-15',
      gender: 'Female',
      phone: '9876543210',
      bloodGroup: 'O+',
      emergencyContact: 'John Smith (9876543211)',
      actorUserId: 'USR-REC-01',
      actorRole: 'RECEPTIONIST'
    });

    testPatientB = patientService.registerPatient({
      name: 'Bob Johnson',
      dateOfBirth: '1985-11-20',
      gender: 'Male',
      phone: '9876543220',
      bloodGroup: 'A+',
      emergencyContact: 'Mary Johnson (9876543221)',
      actorUserId: 'USR-REC-01',
      actorRole: 'RECEPTIONIST'
    });
  });

  describe('TC-HMS-06 Acceptance Criteria Validation', () => {
    test('TC-HMS-06: Automatically calculates $50 consultation + $30 lab + 5% tax = $84.00, records UPI payment, marks PAID and issues receipt', () => {
      const result = billingService.calculateBill({
        patientId: testPatientA.patientId,
        consultationFee: 50.00,
        labTestFee: 30.00,
        taxRate: 0.05,
        paymentMethod: 'UPI',
        amountPaid: 84.00,
        actorUserId: 'USR-REC-01',
        actorRole: 'RECEPTIONIST'
      });

      // Verify invoice numbers and status
      assert.ok(result.invoice, 'Invoice must be returned');
      assert.match(result.invoice.invoiceNumber, /^INV-\d{4}-\d+$/, 'Invoice number should follow INV-YYYY-XXXX format');
      assert.strictEqual(result.invoice.subtotal, 80.00, 'Subtotal should be 50 + 30 = 80.00');
      assert.strictEqual(result.invoice.taxRate, 0.05, 'Tax rate should be 5% (0.05)');
      assert.strictEqual(result.invoice.taxAmount, 4.00, 'Tax should be 5% of 80 = 4.00');
      assert.strictEqual(result.invoice.totalAmount, 84.00, 'Total should be 80 + 4 = 84.00');
      assert.strictEqual(result.invoice.amountPaid, 84.00, 'Amount paid should be 84.00');
      assert.strictEqual(result.invoice.balance, 0, 'Balance should be 0');
      assert.strictEqual(result.invoice.status, 'PAID', 'Status should be marked as PAID');
      assert.strictEqual(result.invoice.paymentMethod, 'UPI', 'Payment method should be UPI');

      // Verify receipt
      assert.ok(result.receipt, 'Receipt should be issued for PAID invoice');
      assert.match(result.receipt.receiptNumber, /^REC-/, 'Receipt number should start with REC-');
      assert.strictEqual(result.receipt.amountPaid, 84.00);
      assert.strictEqual(result.receipt.status, 'PAID');
    });

    test('should record payment via Cash and Card as well as UPI (FR-BILL-02)', () => {
      // 1. Cash payment
      const cashResult = billingService.calculateBill({
        patientId: testPatientA.patientId,
        lineItems: [{ description: 'General Consultation', amount: 50.00 }],
        taxRate: 0.05,
        paymentMethod: 'cash',
        amountPaid: 52.50
      });
      assert.strictEqual(cashResult.invoice.status, 'PAID');
      assert.strictEqual(cashResult.invoice.paymentMethod, 'CASH');

      // 2. Card payment
      const cardResult = billingService.calculateBill({
        patientId: testPatientB.patientId,
        lineItems: [{ description: 'Cardiology Consultation', amount: 100.00 }],
        taxRate: 0.05,
        paymentMethod: 'Card',
        amountPaid: 105.00
      });
      assert.strictEqual(cardResult.invoice.status, 'PAID');
      assert.strictEqual(cardResult.invoice.paymentMethod, 'CARD');
    });

    test('should reject invalid or unsupported payment methods with 400 Bad Request', () => {
      assert.throws(
        () => {
          billingService.calculateBill({
            patientId: testPatientA.patientId,
            lineItems: [{ description: 'Dental Cleaning', amount: 40.00 }],
            paymentMethod: 'BITCOIN',
            amountPaid: 42.00
          });
        },
        err => err.status === 400 && err.message.includes('Supported payment methods: Cash, Card, UPI')
      );
    });
  });

  describe('Invoice Status Transitions: PENDING -> PARTIAL -> PAID (FR-BILL-03)', () => {
    test('should mark invoice as PENDING when no initial payment is provided', () => {
      const result = billingService.calculateBill({
        patientId: testPatientA.patientId,
        consultationFee: 50.00,
        labTestFee: 30.00,
        taxRate: 0.05
      });

      assert.strictEqual(result.invoice.status, 'PENDING');
      assert.strictEqual(result.invoice.amountPaid, 0);
      assert.strictEqual(result.invoice.balance, 84.00);
      assert.strictEqual(result.receipt, null, 'No receipt should be issued if unpaid');
    });

    test('should mark invoice as PARTIAL and update balance upon partial payment', () => {
      const genResult = billingService.calculateBill({
        patientId: testPatientA.patientId,
        consultationFee: 100.00,
        taxRate: 0.05
      }); // Total: 105.00

      assert.strictEqual(genResult.invoice.status, 'PENDING');
      assert.strictEqual(genResult.invoice.totalAmount, 105.00);

      // Make partial payment of $50 via Card
      const payResult = billingService.recordPayment({
        invoiceNumber: genResult.invoice.invoiceNumber,
        amountPaid: 50.00,
        paymentMethod: 'CARD',
        actorUserId: 'USR-REC-01',
        actorRole: 'RECEPTIONIST'
      });

      assert.strictEqual(payResult.invoice.status, 'PARTIAL');
      assert.strictEqual(payResult.invoice.amountPaid, 50.00);
      assert.strictEqual(payResult.invoice.balance, 55.00);
      assert.ok(payResult.receipt.receiptNumber);

      // Make remaining payment of $55 via UPI to transition to PAID
      const finalPayResult = billingService.recordPayment({
        invoiceNumber: genResult.invoice.invoiceNumber,
        amountPaid: 55.00,
        paymentMethod: 'UPI',
        actorUserId: 'USR-REC-01',
        actorRole: 'RECEPTIONIST'
      });

      assert.strictEqual(finalPayResult.invoice.status, 'PAID');
      assert.strictEqual(finalPayResult.invoice.amountPaid, 105.00);
      assert.strictEqual(finalPayResult.invoice.balance, 0);
    });

    test('should reject payments on an already fully paid invoice', () => {
      const result = billingService.calculateBill({
        patientId: testPatientA.patientId,
        consultationFee: 50.00,
        taxRate: 0.05,
        paymentMethod: 'CASH',
        amountPaid: 52.50
      });
      assert.strictEqual(result.invoice.status, 'PAID');

      assert.throws(
        () => {
          billingService.recordPayment({
            invoiceNumber: result.invoice.invoiceNumber,
            amountPaid: 10.00,
            paymentMethod: 'CASH'
          });
        },
        err => err.status === 400 && err.message.includes('already fully paid')
      );
    });
  });

  describe('Audit Logging for Billing Activities', () => {
    test('should log INVOICE_GENERATED and PAYMENT_RECORDED in immutable audit store', () => {
      const initialLogs = db.getAuditLogs().length;

      billingService.calculateBill({
        patientId: testPatientA.patientId,
        consultationFee: 50.00,
        labTestFee: 30.00,
        paymentMethod: 'UPI',
        amountPaid: 84.00,
        actorUserId: 'USR-REC-01',
        actorRole: 'RECEPTIONIST',
        clientIp: '192.168.1.50'
      });

      const logs = db.getAuditLogs();
      assert.ok(logs.length >= initialLogs + 2, 'Should create at least 2 audit entries');

      const invLog = logs.find(l => l.actionType === 'INVOICE_GENERATED');
      assert.ok(invLog, 'Should contain INVOICE_GENERATED entry');
      assert.strictEqual(invLog.targetResource, 'BILLING_INVOICE');
      assert.strictEqual(invLog.actorRole, 'RECEPTIONIST');
      assert.strictEqual(invLog.clientIp, '192.168.1.50');

      const payLog = logs.find(l => l.actionType === 'PAYMENT_RECORDED');
      assert.ok(payLog, 'Should contain PAYMENT_RECORDED entry');
      assert.strictEqual(payLog.targetResource, 'BILLING_PAYMENT');
      assert.strictEqual(payLog.actorRole, 'RECEPTIONIST');
    });
  });

  describe('REST API Endpoints & RBAC Validation', () => {
    test('POST /api/v1/billing/generate: Receptionist can generate bill and pay via UPI (TC-HMS-06)', async () => {
      const res = await makeRequest('/api/v1/billing/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${receptionistToken}`
        },
        body: JSON.stringify({
          patientId: testPatientA.patientId,
          consultationFee: 50.00,
          labTestFee: 30.00,
          taxRate: 0.05,
          paymentMethod: 'UPI',
          amountPaid: 84.00
        })
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.status, 'PAID');
      assert.strictEqual(res.body.totalAmount, 84.00);
      assert.strictEqual(res.body.subtotal, 80.00);
      assert.strictEqual(res.body.taxAmount, 4.00);
      assert.ok(res.body.invoiceNumber);
      assert.ok(res.body.receiptNumber);
    });

    test('POST /api/v1/billing/invoices: Supports alias route per Architecture specification', async () => {
      const res = await makeRequest('/api/v1/billing/invoices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          patientId: testPatientB.patientId,
          consultationFee: 50.00,
          labTestFee: 30.00,
          paymentMethod: 'UPI',
          amountPaid: 84.00
        })
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.totalAmount, 84.00);
      assert.strictEqual(res.body.status, 'PAID');
    });

    test('POST /api/v1/billing/invoices/:invoiceNumber/pay: Receptionist records subsequent payment', async () => {
      // 1. Generate pending invoice
      const invoice = db.createInvoice({
        patientId: testPatientA.patientId,
        subtotal: 100,
        taxAmount: 5,
        totalAmount: 105,
        balance: 105,
        status: 'PENDING'
      });

      // 2. Pay via endpoint
      const res = await makeRequest(`/api/v1/billing/invoices/${invoice.invoiceNumber}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${receptionistToken}`
        },
        body: JSON.stringify({
          amountPaid: 105.00,
          paymentMethod: 'CARD'
        })
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.invoice.status, 'PAID');
      assert.strictEqual(res.body.data.invoice.balance, 0);
      assert.ok(res.body.data.receipt.receiptNumber);
    });

    test('GET /api/v1/billing/invoices/:invoiceNumber: Patient can view their own invoice', async () => {
      const invoice = db.createInvoice({
        patientId: 'PAT-01', // Alice Smith's user id in seeds
        totalAmount: 84,
        status: 'PAID'
      });

      const res = await makeRequest(`/api/v1/billing/invoices/${invoice.invoiceNumber}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${patientAToken}`
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.invoiceNumber, invoice.invoiceNumber);
    });

    test('GET /api/v1/billing/invoices/:invoiceNumber: Patient receives 403 Forbidden when accessing another patient\'s invoice (IDOR protection)', async () => {
      const invoice = db.createInvoice({
        patientId: 'PAT-02', // Bob's user id
        totalAmount: 150,
        status: 'PENDING'
      });

      // Alice tries to access Bob's invoice
      const res = await makeRequest(`/api/v1/billing/invoices/${invoice.invoiceNumber}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${patientAToken}`
        }
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.title, 'Forbidden');
    });

    test('RBAC: Unauthorized role (Pharmacist) is denied access to generate invoice with 403 Forbidden', async () => {
      const res = await makeRequest('/api/v1/billing/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pharmacistToken}`
        },
        body: JSON.stringify({
          patientId: testPatientA.patientId,
          consultationFee: 50.00
        })
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.title, 'Forbidden');
    });

    test('Unauthenticated request to billing is rejected with 401 Unauthorized', async () => {
      const res = await makeRequest('/api/v1/billing/invoices', {
        method: 'GET'
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.title, 'Unauthorized');
    });
  });
});
