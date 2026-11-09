'use strict';

const db = require('../db');

/**
 * Supported payment methods per FR-BILL-02 / SRS Section 3.5
 */
const SUPPORTED_PAYMENT_METHODS = Object.freeze(['CASH', 'CARD', 'UPI']);

class BillingService {
  /**
   * Validate and normalize payment method
   * @param {string} method
   * @returns {string}
   */
  normalizePaymentMethod(method) {
    if (!method || typeof method !== 'string') {
      const err = new Error('Payment method is required. Supported payment methods: Cash, Card, UPI.');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/invalid-payment-method';
      throw err;
    }
    const normalized = method.trim().toUpperCase();
    if (!SUPPORTED_PAYMENT_METHODS.includes(normalized)) {
      const err = new Error(`Invalid payment method "${method}". Supported payment methods: Cash, Card, UPI.`);
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/invalid-payment-method';
      throw err;
    }
    return normalized;
  }

  /**
   * Generate an invoice aggregating consultation fees, lab tests, and medications (FR-BILL-01, FR-BILL-02, FR-BILL-03)
   * Also optionally processes immediate payment and marks as PAID with unique receipt number (TC-HMS-06).
   */
  calculateBill({
    patientId,
    consultationId,
    appointmentId,
    lineItems,
    consultationFee,
    labTestFee,
    medicineFee,
    taxRate = 0.05,
    paymentMethod,
    amountPaid,
    transactionReference,
    actorUserId = 'SYSTEM',
    actorRole = 'BILLING_STAFF',
    clientIp = '127.0.0.1'
  }) {
    if (!patientId || String(patientId).trim() === '') {
      const err = new Error('Patient ID is mandatory for generating an invoice.');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/validation-failed';
      throw err;
    }

    const patient = db.findPatientById(patientId);
    let patientName = patient
      ? (patient.fullName || `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Patient')
      : 'Patient';

    // Assemble line items
    const aggregatedItems = [];

    if (Array.isArray(lineItems) && lineItems.length > 0) {
      for (const item of lineItems) {
        if (!item || !item.description || typeof item.description !== 'string') {
          const err = new Error('Each line item must have a valid description.');
          err.status = 400;
          err.type = 'https://hms.hospital.com/errors/validation-failed';
          throw err;
        }
        const amt = Number(item.amount);
        if (isNaN(amt) || amt < 0) {
          const err = new Error(`Invalid amount for item "${item.description}". Amount must be a non-negative number.`);
          err.status = 400;
          err.type = 'https://hms.hospital.com/errors/validation-failed';
          throw err;
        }
        aggregatedItems.push({
          description: item.description.trim(),
          amount: Number(amt.toFixed(2))
        });
      }
    } else {
      // Gather fee items automatically (FR-BILL-01 / TC-HMS-06)
      // 1. Consultation fee: default $50.00
      const cFee = consultationFee !== undefined ? Number(consultationFee) : 50.00;
      if (cFee > 0) {
        aggregatedItems.push({
          description: 'Physician Consultation Fee',
          amount: Number(cFee.toFixed(2))
        });
      }

      // 2. Lab tests: $30.00 if specified or passed
      if (labTestFee !== undefined && Number(labTestFee) > 0) {
        aggregatedItems.push({
          description: 'Diagnostic Lab Test Fee',
          amount: Number(Number(labTestFee).toFixed(2))
        });
      }

      // 3. Medicine fee: if specified or derived from consultation
      if (medicineFee !== undefined && Number(medicineFee) > 0) {
        aggregatedItems.push({
          description: 'Prescribed Medications Fee',
          amount: Number(Number(medicineFee).toFixed(2))
        });
      } else if (consultationId) {
        const consultation = db.findConsultationById(consultationId);
        if (consultation && Array.isArray(consultation.prescriptions) && consultation.prescriptions.length > 0) {
          // Standard nominal cost per prescribed item if not explicitly specified
          const medCost = consultation.prescriptions.length * 15.00;
          aggregatedItems.push({
            description: `Prescribed Medications (${consultation.prescriptions.length} items)`,
            amount: Number(medCost.toFixed(2))
          });
        }
      }
    }

    if (aggregatedItems.length === 0) {
      aggregatedItems.push({
        description: 'General Hospital Consultation Services',
        amount: 50.00
      });
    }

    // Calculate subtotal, tax, and total
    const subtotal = Number(aggregatedItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
    const effectiveTaxRate = (taxRate !== undefined && taxRate !== null) ? Number(taxRate) : 0.05;
    if (isNaN(effectiveTaxRate) || effectiveTaxRate < 0) {
      const err = new Error('Tax rate must be a non-negative number.');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/validation-failed';
      throw err;
    }
    const taxAmount = Number((subtotal * effectiveTaxRate).toFixed(2));
    const totalAmount = Number((subtotal + taxAmount).toFixed(2));

    // Handle payment if provided
    let normalizedMethod = null;
    let paymentAmount = 0;
    if (paymentMethod) {
      normalizedMethod = this.normalizePaymentMethod(paymentMethod);
    }

    if (amountPaid !== undefined && amountPaid !== null) {
      paymentAmount = Number(amountPaid);
      if (isNaN(paymentAmount) || paymentAmount < 0) {
        const err = new Error('Amount paid must be a non-negative number.');
        err.status = 400;
        err.type = 'https://hms.hospital.com/errors/validation-failed';
        throw err;
      }
      if (paymentAmount > 0 && !normalizedMethod) {
        const err = new Error('Payment method (Cash, Card, UPI) is required when recording a payment.');
        err.status = 400;
        err.type = 'https://hms.hospital.com/errors/validation-failed';
        throw err;
      }
    }

    let status = 'PENDING';
    if (paymentAmount >= totalAmount && totalAmount > 0) {
      status = 'PAID';
    } else if (paymentAmount > 0) {
      status = 'PARTIAL';
    }

    const balance = Math.max(0, Number((totalAmount - paymentAmount).toFixed(2)));

    // Generate unique receipt number if payment received
    let receiptNumber = null;
    let receipt = null;
    if (paymentAmount > 0 || status === 'PAID') {
      receiptNumber = `REC-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
    }

    // Persist invoice in database
    const invoice = db.createInvoice({
      patientId,
      patientName,
      consultationId: consultationId || null,
      appointmentId: appointmentId || null,
      lineItems: aggregatedItems,
      subtotal,
      taxRate: effectiveTaxRate,
      taxAmount,
      totalAmount,
      amountPaid: paymentAmount,
      balance,
      status,
      paymentMethod: normalizedMethod,
      receiptNumber
    });

    if (receiptNumber && paymentAmount > 0) {
      db.recordPayment({
        invoiceNumber: invoice.invoiceNumber,
        patientId,
        amount: paymentAmount,
        paymentMethod: normalizedMethod,
        receiptNumber,
        transactionReference: transactionReference || null
      });

      receipt = {
        receiptNumber,
        invoiceNumber: invoice.invoiceNumber,
        patientId: String(patientId),
        patientName,
        totalAmount,
        amountPaid: paymentAmount,
        balance,
        paymentMethod: normalizedMethod,
        status,
        issuedAt: invoice.createdAt
      };
    }

    // Log to audit log (FR-BILL-01, FR-BILL-03)
    db.appendAuditLog({
      actorUserId,
      actorRole,
      clientIp,
      actionType: 'INVOICE_GENERATED',
      targetResource: 'BILLING_INVOICE',
      status: 'SUCCESS',
      details: `Generated invoice ${invoice.invoiceNumber} for patient ${patientId}, total: $${totalAmount.toFixed(2)}, tax: $${taxAmount.toFixed(2)} (Status: ${status})`
    });

    if (paymentAmount > 0) {
      db.appendAuditLog({
        actorUserId,
        actorRole,
        clientIp,
        actionType: 'PAYMENT_RECORDED',
        targetResource: 'BILLING_PAYMENT',
        status: 'SUCCESS',
        details: `Recorded payment of $${paymentAmount.toFixed(2)} via ${normalizedMethod} for invoice ${invoice.invoiceNumber} (Receipt: ${receiptNumber})`
      });
    }

    return {
      invoice,
      receipt
    };
  }

  /**
   * Record a subsequent payment against an existing invoice (FR-BILL-02, FR-BILL-03)
   */
  recordPayment({
    invoiceNumber,
    amountPaid,
    paymentMethod,
    transactionReference,
    actorUserId = 'SYSTEM',
    actorRole = 'BILLING_STAFF',
    clientIp = '127.0.0.1'
  }) {
    if (!invoiceNumber) {
      const err = new Error('Invoice number is required.');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/validation-failed';
      throw err;
    }

    const invoice = db.findInvoiceByNumber(invoiceNumber);
    if (!invoice) {
      const err = new Error(`Invoice with number "${invoiceNumber}" was not found.`);
      err.status = 404;
      err.type = 'https://hms.hospital.com/errors/not-found';
      throw err;
    }

    if (invoice.status === 'PAID' && invoice.balance === 0) {
      const err = new Error(`Invoice ${invoiceNumber} is already fully paid.`);
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/invoice-already-paid';
      throw err;
    }

    const normalizedMethod = this.normalizePaymentMethod(paymentMethod);

    const paymentAmount = Number(amountPaid);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      const err = new Error('Payment amount must be a number greater than 0.');
      err.status = 400;
      err.type = 'https://hms.hospital.com/errors/validation-failed';
      throw err;
    }

    const newAmountPaid = Number((invoice.amountPaid + paymentAmount).toFixed(2));
    const newBalance = Math.max(0, Number((invoice.totalAmount - newAmountPaid).toFixed(2)));
    const newStatus = newAmountPaid >= invoice.totalAmount ? 'PAID' : 'PARTIAL';
    const receiptNumber = `REC-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const updatedInvoice = db.updateInvoice(invoiceNumber, {
      amountPaid: newAmountPaid,
      balance: newBalance,
      status: newStatus,
      paymentMethod: normalizedMethod,
      receiptNumber
    });

    const paymentRecord = db.recordPayment({
      invoiceNumber,
      patientId: invoice.patientId,
      amount: paymentAmount,
      paymentMethod: normalizedMethod,
      receiptNumber,
      transactionReference: transactionReference || null
    });

    const receipt = {
      receiptNumber,
      invoiceNumber: updatedInvoice.invoiceNumber,
      patientId: updatedInvoice.patientId,
      patientName: updatedInvoice.patientName,
      totalAmount: updatedInvoice.totalAmount,
      amountPaid: paymentAmount,
      totalPaidToDate: newAmountPaid,
      balance: newBalance,
      paymentMethod: normalizedMethod,
      status: newStatus,
      issuedAt: paymentRecord.recordedAt
    };

    db.appendAuditLog({
      actorUserId,
      actorRole,
      clientIp,
      actionType: 'PAYMENT_RECORDED',
      targetResource: 'BILLING_PAYMENT',
      status: 'SUCCESS',
      details: `Recorded payment of $${paymentAmount.toFixed(2)} via ${normalizedMethod} for invoice ${invoiceNumber} (Status: ${newStatus}, Receipt: ${receiptNumber})`
    });

    return {
      invoice: updatedInvoice,
      payment: paymentRecord,
      receipt
    };
  }

  /**
   * Look up invoice details by invoice number
   */
  getInvoiceByNumber(invoiceNumber) {
    const invoice = db.findInvoiceByNumber(invoiceNumber);
    if (!invoice) return null;
    const payments = db.getPaymentsByInvoiceNumber(invoiceNumber);
    return {
      ...invoice,
      payments
    };
  }

  /**
   * Get all invoices for a patient
   */
  getPatientInvoices(patientId) {
    return db.getInvoicesByPatientId(patientId);
  }

  /**
   * Get all invoices in the hospital system
   */
  getAllInvoices() {
    return db.getAllInvoices();
  }
}

module.exports = new BillingService();
