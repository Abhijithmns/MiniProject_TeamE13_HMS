'use strict';

const crypto = require('crypto');
const config = require('../config');

function canonicalPrescriptionPayload(consultation) {
  return JSON.stringify({
    consultationId: String(consultation.consultationId),
    appointmentId: consultation.appointmentId || null,
    patientId: String(consultation.patientId),
    patientName: consultation.patientName || '',
    doctorId: consultation.doctorId || '',
    doctorName: consultation.doctorName || '',
    issuedAt: consultation.createdAt,
    diagnosis: consultation.diagnosis || '',
    vitals: {
      bloodPressure: consultation.vitals?.bloodPressure ?? null,
      pulse: consultation.vitals?.pulse ?? null,
      temperature: consultation.vitals?.temperature ?? null,
      spo2: consultation.vitals?.spo2 ?? null
    },
    prescriptions: (consultation.prescriptions || []).map(prescription => ({
      medicationId: prescription.medicationId || '',
      name: prescription.name || '',
      dosage: prescription.dosage || '',
      frequency: prescription.frequency || '',
      durationDays: prescription.durationDays ?? null,
      instructions: prescription.instructions || ''
    }))
  });
}

function createPrescriptionSignature(consultation) {
  const digest = crypto
    .createHmac('sha256', config.PRESCRIPTION_SIGNING_KEY)
    .update(canonicalPrescriptionPayload(consultation))
    .digest('hex');
  // Keep the sha256 prefix for compatibility with previously issued API responses.
  return `sha256:${digest}`;
}

function verifyPrescriptionSignature(consultation, signature = consultation?.prescriptionHash) {
  if (typeof signature !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createPrescriptionSignature(consultation);
  const providedBytes = Buffer.from(signature.toLowerCase());
  const expectedBytes = Buffer.from(expected.toLowerCase());
  return providedBytes.length === expectedBytes.length && crypto.timingSafeEqual(providedBytes, expectedBytes);
}

module.exports = {
  createPrescriptionSignature,
  verifyPrescriptionSignature
};
