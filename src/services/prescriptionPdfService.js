'use strict';

const PDFDocument = require('pdfkit');

function formatVital(value, unit = '') {
  return value === null || value === undefined || value === '' ? 'Not recorded' : `${value}${unit}`;
}

function generatePrescriptionPdf({ consultation, patient }) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',
      margin: 52,
      info: {
        Title: `Digital prescription ${consultation.consultationId}`,
        Author: consultation.doctorName || 'Hospital Management System',
        Subject: 'Verified digital prescription'
      }
    });
    const chunks = [];

    document.on('data', chunk => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));

    document.fillColor('#124559').font('Helvetica-Bold').fontSize(22).text('Digital Prescription');
    document.moveDown(0.25);
    document.fillColor('#4b5563').font('Helvetica').fontSize(10)
      .text('Hospital Management System  |  Verified clinical record');
    document.moveDown(1.1);

    const section = (title) => {
      document.moveDown(0.7);
      document.fillColor('#124559').font('Helvetica-Bold').fontSize(12).text(title);
      document.moveTo(52, document.y + 4).lineTo(543, document.y + 4).strokeColor('#d5e1e6').stroke();
      document.moveDown(0.5);
      document.fillColor('#111827').font('Helvetica').fontSize(10);
    };
    const detail = (label, value) => {
      document.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      document.font('Helvetica').text(String(value));
    };

    section('Patient');
    detail('Name', consultation.patientName || patient.name || 'Patient');
    detail('Patient ID', patient.patientId);
    detail('Prescription date', new Date(consultation.createdAt).toLocaleString('en-IN', { timeZone: 'UTC' }));
    detail('Consultation ID', consultation.consultationId);

    section('Prescribing doctor');
    detail('Doctor', consultation.doctorName || 'Doctor');
    detail('Doctor ID', consultation.doctorId || 'Not recorded');

    section('Vitals');
    detail('Blood pressure', formatVital(consultation.vitals?.bloodPressure));
    detail('Pulse', formatVital(consultation.vitals?.pulse, ' bpm'));
    detail('Temperature', formatVital(consultation.vitals?.temperature, ' °F'));
    detail('SpO₂', formatVital(consultation.vitals?.spo2, '%'));

    section('Diagnosis');
    document.text(consultation.diagnosis || 'Not recorded');

    section('Medicines and dosages');
    if (!consultation.prescriptions?.length) {
      document.text('No medicines prescribed.');
    } else {
      consultation.prescriptions.forEach((prescription, index) => {
        document.font('Helvetica-Bold').fontSize(10)
          .text(`${index + 1}. ${prescription.name} — ${prescription.dosage}`);
        document.font('Helvetica').fontSize(9)
          .text(`Frequency: ${prescription.frequency || 'Not recorded'}  |  Duration: ${prescription.durationDays ?? 'Not recorded'} day(s)`);
        if (prescription.instructions) document.text(`Instructions: ${prescription.instructions}`);
        document.moveDown(0.6);
      });
    }

    section('Digital verification');
    document.font('Helvetica-Bold').fontSize(9).text('HMAC-SHA256 verification code');
    document.font('Courier').fontSize(8).text(consultation.prescriptionHash, { width: 490, lineBreak: true });
    document.moveDown(0.3);
    document.font('Helvetica').fontSize(8).fillColor('#4b5563')
      .text(`Verify this code at: POST /api/v1/ehr/prescriptions/${encodeURIComponent(consultation.consultationId)}/verify`);
    document.moveDown(0.5);
    document.font('Helvetica-Oblique').fontSize(8)
      .text('The verification code covers the patient, doctor, issue date, diagnosis, vitals, and prescribed medicines shown on this page.');

    document.end();
  });
}

module.exports = { generatePrescriptionPdf };
