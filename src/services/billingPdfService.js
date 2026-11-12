'use strict';

const PDFDocument = require('pdfkit');

function generateBillingPdf({ invoice, payments = [] }) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Receipt & Invoice ${invoice.invoiceNumber}`,
        Author: 'Hospital Management System',
        Subject: 'Official Billing Receipt & Tax Invoice'
      }
    });
    const chunks = [];

    document.on('data', chunk => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));

    // Header
    document.fillColor('#124559').font('Helvetica-Bold').fontSize(22).text('Hospital Management System');
    document.moveDown(0.2);
    document.fillColor('#4b5563').font('Helvetica').fontSize(11).text('Official Patient Billing Receipt & Tax Invoice');
    document.moveTo(50, document.y + 6).lineTo(545, document.y + 6).strokeColor('#0ea5e9').lineWidth(2).stroke();
    document.moveDown(0.8);

    const section = (title) => {
      document.moveDown(0.6);
      document.fillColor('#124559').font('Helvetica-Bold').fontSize(12).text(title);
      document.moveTo(50, document.y + 3).lineTo(545, document.y + 3).strokeColor('#d5e1e6').lineWidth(1).stroke();
      document.moveDown(0.4);
      document.fillColor('#111827').font('Helvetica').fontSize(10);
    };

    // Metadata section (2 columns layout)
    const topY = document.y + 5;
    // Left column: Invoice & Receipt info
    document.font('Helvetica-Bold').fontSize(11).fillColor('#124559').text('Invoice & Receipt Details', 50, topY);
    document.moveDown(0.3);

    const leftColDetail = (label, value) => {
      document.font('Helvetica-Bold').fillColor('#374151').text(`${label}: `, 50, document.y, { continued: true });
      document.font('Helvetica').fillColor('#111827').text(String(value ?? 'N/A'));
      document.moveDown(0.2);
    };

    leftColDetail('Invoice Number', invoice.invoiceNumber);
    leftColDetail('Receipt Number', invoice.receiptNumber || 'None (Unpaid)');
    const issueDate = invoice.createdAt
      ? new Date(invoice.createdAt).toLocaleString('en-IN', { timeZone: 'UTC' })
      : new Date().toLocaleString('en-IN', { timeZone: 'UTC' });
    leftColDetail('Issued Date', issueDate);
    leftColDetail('Payment Status', invoice.status);
    if (invoice.paymentMethod) {
      leftColDetail('Payment Method', invoice.paymentMethod);
    }

    const leftBottomY = document.y;

    // Right column: Patient info
    document.font('Helvetica-Bold').fontSize(11).fillColor('#124559').text('Patient Information', 320, topY);
    document.moveDown(0.3);

    const rightColDetail = (label, value) => {
      document.font('Helvetica-Bold').fillColor('#374151').text(`${label}: `, 320, document.y, { continued: true });
      document.font('Helvetica').fillColor('#111827').text(String(value ?? 'N/A'));
      document.moveDown(0.2);
    };

    rightColDetail('Patient Name', invoice.patientName || 'Patient');
    rightColDetail('Patient ID', invoice.patientId || 'N/A');
    if (invoice.consultationId) {
      rightColDetail('Consultation ID', invoice.consultationId);
    }
    if (invoice.appointmentId) {
      rightColDetail('Appointment ID', invoice.appointmentId);
    }

    const maxY = Math.max(leftBottomY, document.y);
    document.y = maxY + 10;
    document.x = 50;

    // Itemized table
    section('Itemized Charges');
    document.moveDown(0.2);

    // Table Header
    const tableTop = document.y;
    document.rect(50, tableTop, 495, 20).fill('#f1f5f9');
    document.fillColor('#1e293b').font('Helvetica-Bold').fontSize(10);
    document.text('Description', 60, tableTop + 5);
    document.text('Amount ($)', 430, tableTop + 5, { align: 'right', width: 100 });

    let currentY = tableTop + 24;
    document.font('Helvetica').fontSize(10).fillColor('#111827');

    const items = Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0
      ? invoice.lineItems
      : [{ description: 'Hospital Services', amount: invoice.subtotal || invoice.totalAmount || 0 }];

    items.forEach((item, idx) => {
      if (idx % 2 === 1) {
        document.rect(50, currentY - 2, 495, 18).fill('#f8fafc');
      }
      document.fillColor('#111827');
      document.text(item.description, 60, currentY);
      document.text(`$${Number(item.amount).toFixed(2)}`, 430, currentY, { align: 'right', width: 100 });
      currentY += 18;
    });

    document.moveTo(50, currentY + 2).lineTo(545, currentY + 2).strokeColor('#cbd5e1').stroke();
    currentY += 10;

    // Totals section (right aligned)
    const totalsX = 330;
    document.y = currentY;

    const rowTotal = (label, val, isBold = false, color = '#111827') => {
      const lineY = document.y;
      document.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(color);
      document.text(label, totalsX, lineY, { width: 110, align: 'left' });
      document.text(val, totalsX + 110, lineY, { width: 105, align: 'right' });
      document.moveDown(0.4);
    };

    rowTotal('Subtotal:', `$${Number(invoice.subtotal).toFixed(2)}`);
    const taxPct = ((invoice.taxRate !== undefined ? Number(invoice.taxRate) : 0.05) * 100).toFixed(0);
    rowTotal(`Tax (${taxPct}%):`, `$${Number(invoice.taxAmount).toFixed(2)}`);
    document.moveTo(totalsX, document.y).lineTo(545, document.y).strokeColor('#cbd5e1').stroke();
    document.moveDown(0.3);
    rowTotal('Total Amount:', `$${Number(invoice.totalAmount).toFixed(2)}`, true, '#124559');
    rowTotal('Amount Paid:', `$${Number(invoice.amountPaid).toFixed(2)}`, true, '#16a34a');
    rowTotal('Balance Due:', `$${Number(invoice.balance).toFixed(2)}`, true, invoice.balance > 0 ? '#dc2626' : '#111827');

    // Payment History if any
    if (Array.isArray(payments) && payments.length > 0) {
      document.y += 10;
      section('Payment History & Recorded Transactions');
      payments.forEach((p, idx) => {
        const pDate = p.recordedAt
          ? new Date(p.recordedAt).toLocaleString('en-IN', { timeZone: 'UTC' })
          : 'N/A';
        document.font('Helvetica').fontSize(9).fillColor('#374151')
          .text(`${idx + 1}. Receipt: ${p.receiptNumber}  |  Amount: $${Number(p.amount).toFixed(2)}  |  Method: ${p.paymentMethod}  |  Date: ${pDate}${p.transactionReference ? `  |  Ref: ${p.transactionReference}` : ''}`);
        document.moveDown(0.3);
      });
    }

    // Official Stamp / Footer
    document.moveDown(1.5);
    document.moveTo(50, document.y).lineTo(545, document.y).strokeColor('#e2e8f0').stroke();
    document.moveDown(0.5);
    document.font('Helvetica-Bold').fontSize(9).fillColor('#124559')
      .text('OFFICIAL DIGITAL RECEIPT - HOSPITAL MANAGEMENT SYSTEM', { align: 'center' });
    document.font('Helvetica-Oblique').fontSize(8).fillColor('#64748b')
      .text('This document serves as an official electronic receipt and tax invoice. Logged in immutable audit log.', { align: 'center' });
    document.font('Helvetica').fontSize(7).fillColor('#94a3b8')
      .text('For billing questions or insurance claims, please contact hospital billing administration.', { align: 'center' });

    document.end();
  });
}

module.exports = { generateBillingPdf };
