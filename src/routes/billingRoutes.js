'use strict';

const express = require('express');
const router = express.Router();
const billingService = require('../services/billingService');
const { generateBillingPdf } = require('../services/billingPdfService');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/rbac');
const db = require('../db');

/**
 * Helper to check IDOR on invoice
 */
function verifyPatientInvoiceAccess(user, patientId) {
  if (user.role === 'PATIENT') {
    const userPatientId = user.patientId || user.id;
    return String(userPatientId) === String(patientId);
  }
  return true;
}

/**
 * POST /api/v1/billing/generate & POST /api/v1/billing/invoices
 * Aggregates consultation and pharmacy costs into an invoice (FR-BILL-01, FR-BILL-02, FR-BILL-03)
 * RBAC: Receptionist, Admin, Patient
 */
const generateInvoiceHandler = (req, res) => {
  try {
    const {
      patientId,
      consultationId,
      appointmentId,
      lineItems,
      consultationFee,
      labTestFee,
      medicineFee,
      taxRate,
      paymentMethod,
      amountPaid,
      transactionReference
    } = req.body;

    const targetPatientId = req.user.role === 'PATIENT' ? (req.user.patientId || req.user.id) : patientId;

    if (!targetPatientId) {
      return res.status(400).json({
        type: 'https://hms.hospital.com/errors/validation-failed',
        title: 'Validation Error',
        status: 400,
        detail: 'Patient ID is mandatory.'
      });
    }

    const clientIp = req.ip || req.connection?.remoteAddress;

    const result = billingService.calculateBill({
      patientId: targetPatientId,
      consultationId,
      appointmentId,
      lineItems,
      consultationFee,
      labTestFee,
      medicineFee,
      taxRate,
      paymentMethod,
      amountPaid,
      transactionReference,
      actorUserId: req.user.id,
      actorRole: req.user.role,
      clientIp
    });

    return res.status(201).json({
      status: 'success',
      message: 'Invoice generated successfully.',
      invoiceNumber: result.invoice.invoiceNumber,
      invoiceStatus: result.invoice.status,
      status: result.invoice.status, // Per Architecture doc: { invoiceNumber, status, totalAmount }
      totalAmount: result.invoice.totalAmount,
      subtotal: result.invoice.subtotal,
      taxAmount: result.invoice.taxAmount,
      amountPaid: result.invoice.amountPaid,
      balance: result.invoice.balance,
      receiptNumber: result.receipt ? result.receipt.receiptNumber : null,
      data: result
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/billing-failed',
      title: error.status === 400 ? 'Validation Error' : 'Billing Error',
      status,
      detail: error.message
    });
  }
};

router.post('/generate', authenticateToken, requireRole(['RECEPTIONIST', 'ADMIN', 'PATIENT']), generateInvoiceHandler);
router.post('/invoices', authenticateToken, requireRole(['RECEPTIONIST', 'ADMIN', 'PATIENT']), generateInvoiceHandler);

/**
 * POST /api/v1/billing/invoices/:invoiceNumber/pay & POST /api/v1/billing/pay
 * Record payment for an invoice (FR-BILL-02, FR-BILL-03)
 * RBAC: Receptionist, Admin, Patient
 */
const recordPaymentHandler = (req, res) => {
  try {
    const invoiceNumber = req.params.invoiceNumber || req.body.invoiceNumber;
    const { amountPaid, paymentMethod, transactionReference } = req.body;

    if (!invoiceNumber) {
      return res.status(400).json({
        type: 'https://hms.hospital.com/errors/validation-failed',
        title: 'Validation Error',
        status: 400,
        detail: 'Invoice number is required.'
      });
    }

    const existingInvoice = db.findInvoiceByNumber(invoiceNumber);
    if (!existingInvoice) {
      return res.status(404).json({
        type: 'https://hms.hospital.com/errors/not-found',
        title: 'Resource Not Found',
        status: 404,
        detail: `Invoice ${invoiceNumber} was not found.`
      });
    }

    // IDOR check for PATIENT
    if (!verifyPatientInvoiceAccess(req.user, existingInvoice.patientId)) {
      return res.status(403).json({
        type: 'https://hms.hospital.com/errors/insufficient-privilege',
        title: 'Forbidden',
        status: 403,
        detail: 'You are not authorized to make payments for other patients\' invoices.'
      });
    }

    const clientIp = req.ip || req.connection?.remoteAddress;

    const result = billingService.recordPayment({
      invoiceNumber,
      amountPaid,
      paymentMethod,
      transactionReference,
      actorUserId: req.user.id,
      actorRole: req.user.role,
      clientIp
    });

    return res.status(200).json({
      status: 'success',
      message: 'Payment successfully recorded.',
      data: result
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/payment-failed',
      title: 'Payment Error',
      status,
      detail: error.message
    });
  }
};

router.post('/invoices/:invoiceNumber/pay', authenticateToken, requireRole(['RECEPTIONIST', 'ADMIN', 'PATIENT']), recordPaymentHandler);
router.post('/pay', authenticateToken, requireRole(['RECEPTIONIST', 'ADMIN', 'PATIENT']), recordPaymentHandler);

/**
 * GET /api/v1/billing/invoices/:invoiceNumber
 * Retrieve details of an invoice
 * RBAC: Receptionist, Admin, Doctor, Patient
 */
const getInvoiceByNumberHandler = (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    const invoice = billingService.getInvoiceByNumber(invoiceNumber);

    if (!invoice) {
      return res.status(404).json({
        type: 'https://hms.hospital.com/errors/not-found',
        title: 'Resource Not Found',
        status: 404,
        detail: `Invoice ${invoiceNumber} was not found.`
      });
    }

    // IDOR check for PATIENT
    if (!verifyPatientInvoiceAccess(req.user, invoice.patientId)) {
      return res.status(403).json({
        type: 'https://hms.hospital.com/errors/insufficient-privilege',
        title: 'Forbidden',
        status: 403,
        detail: 'Access denied: You can only view your own invoices.'
      });
    }

    return res.status(200).json({
      status: 'success',
      data: invoice
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/internal-server-error',
      title: 'Billing Retrieval Error',
      status,
      detail: error.message
    });
  }
};

router.get('/invoices/:invoiceNumber', authenticateToken, requireRole(['RECEPTIONIST', 'ADMIN', 'DOCTOR', 'PATIENT']), getInvoiceByNumberHandler);

/**
 * GET /api/v1/billing/invoices/:invoiceNumber/pdf & /receipt/pdf & /receipt
 * Retrieve and generate official PDF receipt for an invoice
 * RBAC: Receptionist, Admin, Doctor, Patient
 */
const getInvoicePdfHandler = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    const invoice = billingService.getInvoiceByNumber(invoiceNumber);

    if (!invoice) {
      return res.status(404).json({
        type: 'https://hms.hospital.com/errors/not-found',
        title: 'Resource Not Found',
        status: 404,
        detail: `Invoice ${invoiceNumber} was not found.`
      });
    }

    // IDOR check for PATIENT
    if (!verifyPatientInvoiceAccess(req.user, invoice.patientId)) {
      return res.status(403).json({
        type: 'https://hms.hospital.com/errors/insufficient-privilege',
        title: 'Forbidden',
        status: 403,
        detail: 'Access denied: You can only view your own invoice receipts.'
      });
    }

    const pdf = await generateBillingPdf({
      invoice,
      payments: invoice.payments || []
    });

    const safeId = invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '');
    const disposition = req.query.download === 'true' ? 'attachment' : 'inline';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="receipt-${safeId}.pdf"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.status(200).send(pdf);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/billing-pdf-failed',
      title: 'Billing Receipt PDF Error',
      status,
      detail: error.message
    });
  }
};

router.get('/invoices/:invoiceNumber/pdf', authenticateToken, requireRole(['RECEPTIONIST', 'ADMIN', 'DOCTOR', 'PATIENT']), getInvoicePdfHandler);
router.get('/invoices/:invoiceNumber/receipt/pdf', authenticateToken, requireRole(['RECEPTIONIST', 'ADMIN', 'DOCTOR', 'PATIENT']), getInvoicePdfHandler);
router.get('/invoices/:invoiceNumber/receipt', authenticateToken, requireRole(['RECEPTIONIST', 'ADMIN', 'DOCTOR', 'PATIENT']), getInvoicePdfHandler);

/**
 * GET /api/v1/billing/patient/:patientId
 * Retrieve all invoices for a patient
 * RBAC: Receptionist, Admin, Doctor, Patient
 */
const getPatientInvoicesHandler = (req, res) => {
  try {
    const { patientId } = req.params;

    if (!verifyPatientInvoiceAccess(req.user, patientId)) {
      return res.status(403).json({
        type: 'https://hms.hospital.com/errors/insufficient-privilege',
        title: 'Forbidden',
        status: 403,
        detail: 'Access denied: You can only view your own billing records.'
      });
    }

    const invoices = billingService.getPatientInvoices(patientId);

    return res.status(200).json({
      status: 'success',
      data: invoices
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/internal-server-error',
      title: 'Billing Retrieval Error',
      status,
      detail: error.message
    });
  }
};

router.get('/patient/:patientId', authenticateToken, requireRole(['RECEPTIONIST', 'ADMIN', 'DOCTOR', 'PATIENT']), getPatientInvoicesHandler);
router.get('/invoices/patient/:patientId', authenticateToken, requireRole(['RECEPTIONIST', 'ADMIN', 'DOCTOR', 'PATIENT']), getPatientInvoicesHandler);

/**
 * GET /api/v1/billing/invoices
 * List all invoices in the system
 * RBAC: Receptionist, Admin
 */
router.get('/invoices', authenticateToken, requireRole(['RECEPTIONIST', 'ADMIN']), (req, res) => {
  try {
    const invoices = billingService.getAllInvoices();
    return res.status(200).json({
      status: 'success',
      data: invoices
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.type || 'https://hms.hospital.com/errors/internal-server-error',
      title: 'Billing Retrieval Error',
      status,
      detail: error.message
    });
  }
});

module.exports = router;
