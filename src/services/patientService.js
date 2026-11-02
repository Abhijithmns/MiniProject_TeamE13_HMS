'use strict';

const db = require('../db');

/**
 * Patient Service — US-04, US-05 / FR-PAT-01, FR-PAT-02, FR-PAT-03
 * Handles patient registration and quick search by name, phone, or MPI ID.
 */
class PatientService {
  /**
   * Generates a unique 10-digit Patient ID (Master Patient Index).
   * Format: 4-digit year + 6-digit zero-padded sequential number e.g. 2026000001
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

  /**
   * Quick patient search by exact Patient ID, exact phone number,
   * or partial (case-insensitive) patient name. (US-05 / FR-PAT-03)
   *
   * @param {string} query - The search string from clinic staff
   * @param {string} actorUserId - For audit logging
   * @param {string} actorRole - For audit logging
   * @param {string} clientIp - For audit logging
   * @returns {{ results: Array, query: string, count: number, searchedBy: string }}
   */
  searchPatients({ query, actorUserId, actorRole, clientIp = '127.0.0.1' }) {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      const err = new Error('Search query is required');
      err.status = 400;
      throw err;
    }

    const q = query.trim();
    const qLower = q.toLowerCase();
    const qDigits = q.replace(/\D/g, '');

    const allPatients = db.getAllPatients();
    let results = [];
    let searchedBy = 'name'; // default

    // Search priority:
    // 1. Exact 10-digit Patient ID — try patientId first, if found use it
    // 2. If not found as patientId (or no exact match), try as phone number
    // 3. Otherwise partial name match (case-insensitive)
    if (/^\d{10}$/.test(q)) {
      // Try exact Patient ID first
      const byId = db.findPatientById(q);
      if (byId) {
        results = [byId];
        searchedBy = 'patientId';
      } else {
        // Fall through to phone search — same 10-digit format
        results = allPatients.filter(p => p.phone === qDigits);
        searchedBy = 'phone';
      }
    }
    // Partial name match (case-insensitive)
    else {
      results = allPatients.filter(p =>
        p.name.toLowerCase().includes(qLower)
      );
      searchedBy = 'name';
    }

    db.appendAuditLog({
      actorUserId: actorUserId || 'SYSTEM',
      actorRole: actorRole || 'RECEPTIONIST',
      clientIp,
      actionType: 'PATIENT_SEARCH',
      targetResource: 'Patient:SEARCH',
      status: 'SUCCESS',
      details: `Patient search by ${searchedBy}: "${q}" — ${results.length} result(s) found`
    });

    return {
      query: q,
      searchedBy,
      count: results.length,
      results
    };
  }
}

module.exports = new PatientService();
