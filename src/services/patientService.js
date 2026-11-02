'use strict';

const db = require('../db');

/**
 * Patient Service — US-04 / FR-PAT-01, FR-PAT-02
 * Handles patient registration with a unique 10-digit Master Patient Index (MPI) ID.
 */
class PatientService {
  /**
   * Generates a unique 10-digit Patient ID (Master Patient Index).
   * Format: 4-digit year + 6-digit zero-padded sequential number → e.g. 2026000001
   * Guaranteed unique against existing patients in the store.
   */
  generatePatientId() {
    const year = new Date().getFullYear().toString();
    let id;
    let attempts = 0;
    do {
      const seq = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
      id = `${year}${seq}`;
      attempts++;
      if (attempts > 1000) throw new Error('Could not generate unique patient ID');
    } while (db.findPatientById(id));
    return id;
  }

  /**
   * Validates all required fields for patient registration (FR-PAT-01).
   */
  validatePatientInput({ name, dateOfBirth, gender, phone, bloodGroup, emergencyContact }) {
    const errors = [];

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      errors.push('Full name is required (minimum 2 characters)');
    }

    if (!dateOfBirth) {
      errors.push('Date of birth is required');
    } else {
      const dob = new Date(dateOfBirth);
      if (isNaN(dob.getTime())) {
        errors.push('Date of birth must be a valid date');
      } else if (dob >= new Date()) {
        errors.push('Date of birth must be in the past');
      }
    }

    const validGenders = ['MALE', 'FEMALE', 'OTHER'];
    if (!gender || !validGenders.includes(gender.toUpperCase())) {
      errors.push(`Gender must be one of: ${validGenders.join(', ')}`);
    }

    // 10-digit phone number validation
    const phoneDigits = phone ? phone.replace(/\D/g, '') : '';
    if (!phone || phoneDigits.length !== 10) {
      errors.push('Phone number must be exactly 10 digits');
    }

    if (bloodGroup) {
      const validBloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      if (!validBloodGroups.includes(bloodGroup.toUpperCase())) {
        errors.push(`Blood group must be one of: ${validBloodGroups.join(', ')}`);
      }
    }

    if (!emergencyContact || typeof emergencyContact !== 'string' || emergencyContact.trim().length < 2) {
      errors.push('Emergency contact name is required');
    }

    return errors;
  }

  /**
   * Register a new patient (US-04 / FR-PAT-01, FR-PAT-02).
   * @param {object} data - Patient data from request body
   * @param {string} actorUserId - ID of the staff member performing registration
   * @param {string} actorRole - Role of the actor
   * @param {string} clientIp - Client IP for audit logging
   */
  registerPatient({ name, dateOfBirth, gender, phone, bloodGroup, emergencyContact, actorUserId, actorRole, clientIp = '127.0.0.1' }) {
    const errors = this.validatePatientInput({ name, dateOfBirth, gender, phone, bloodGroup, emergencyContact });
    if (errors.length > 0) {
      const err = new Error(errors.join('; '));
      err.status = 400;
      err.errors = errors;
      throw err;
    }

    const patientId = this.generatePatientId();
    const phoneDigits = phone.replace(/\D/g, '');

    const patient = db.createPatient({
      patientId,
      name: name.trim(),
      dateOfBirth,
      gender: gender.toUpperCase(),
      phone: phoneDigits,
      bloodGroup: bloodGroup ? bloodGroup.toUpperCase() : null,
      emergencyContact: emergencyContact.trim()
    });

    db.appendAuditLog({
      actorUserId: actorUserId || 'SYSTEM',
      actorRole: actorRole || 'RECEPTIONIST',
      clientIp,
      actionType: 'PATIENT_REGISTER',
      targetResource: `Patient:${patientId}`,
      status: 'SUCCESS',
      details: `New patient registered: ${name.trim()} with MPI ID ${patientId}`
    });

    return patient;
  }

  /**
   * Get all patients (admin/receptionist/doctor access).
   */
  getAllPatients() {
    return db.getAllPatients();
  }

  /**
   * Get a single patient by their 10-digit MPI ID.
   */
  getPatientById(patientId) {
    const patient = db.findPatientById(patientId);
    if (!patient) {
      const err = new Error(`Patient with ID ${patientId} not found`);
      err.status = 404;
      throw err;
    }
    return patient;
  }
}

module.exports = new PatientService();
