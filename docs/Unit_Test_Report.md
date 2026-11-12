# Unit Test Report
## Hospital Management System (HMS)
**Document Standard:** IEEE Std 829-2008 Standard for Software and System Test Documentation  
**Project:** Hospital Management System  
**Course:** Software Engineering (UE22CS351AA) - PES University  
**Team:** Team E13  
**Date:** November 2026  
**Status:** Approved / 100% Passed  

---

## 1. Executive Summary

This Unit Test Report documents the verification and validation results for the **Hospital Management System (HMS)**. All core business logic services, security controllers, data access layers, and utility modules were systematically evaluated through automated unit test suites using the Node.js native test runner.

### Key Metrics Summary
- **Total Test Suites**: 51
- **Total Tests Executed**: 147
- **Tests Passed**: 147 (100%)
- **Tests Failed**: 0 (0%)
- **Tests Skipped / Cancelled / Todo**: 0 (0%)
- **Execution Duration**: 15.96 seconds
- **Overall Status**: Quality Gate Passed

---

## 2. Test Environment and Execution Framework

- **Runtime Environment**: Node.js v20+ on Linux x86_64
- **Test Runner**: Node.js Native Test Runner (`node --test`)
- **Assertion Library**: Native Node.js Assertion Module (`node:assert/strict`)
- **Test Command**: `npm test`
- **Execution Mode**: Isolated test processes executing with deterministic in-memory state initialization.

---

## 3. Test Suites Breakdown and Results

### 3.1 Authentication and Account Security
- **Test Files**: [`tests/auth.test.js`](file:///home/abhijith/pes/sem5/se/tests/auth.test.js), [`tests/lockout.test.js`](file:///home/abhijith/pes/sem5/se/tests/lockout.test.js)
- **Target User Stories**: US-01, US-02
- **Requirements Covered**: FR-AUTH-01, FR-AUTH-02, SEC-REQ-1.1, SEC-REQ-2.1
- **Tests Executed**: 24 tests
- **Status**: PASSED (0 failures)
- **Key Verifications**:
  - Secure user registration with email, full name, role, and salted bcrypt password hashing.
  - Password complexity enforcement and duplicate email rejection.
  - JWT token minting containing role claims and expiration timestamps.
  - Rejection of invalid credentials, expired tokens, and missing authorization headers.
  - Progressive tracking of failed login attempts per user account.
  - Deterministic account lockout after exactly 5 consecutive failed attempts.
  - Lockout release after the 15-minute cool-down window.
  - Generation of immutable audit log entries on failed logins and account lockouts.

### 3.2 Role-Based Access Control (RBAC) and IDOR Defense
- **Test File**: [`tests/rbac.test.js`](file:///home/abhijith/pes/sem5/se/tests/rbac.test.js)
- **Target User Stories**: US-03
- **Requirements Covered**: SEC-REQ-1.1, FR-AUTH-03
- **Tests Executed**: 8 tests
- **Status**: PASSED (0 failures)
- **Key Verifications**:
  - Privilege boundary enforcement across 5 distinct system roles (ADMIN, DOCTOR, RECEPTIONIST, PHARMACIST, PATIENT).
  - Prohibition of doctor access to reception-only patient intake routes with HTTP 403 Forbidden.
  - Prohibition of receptionist access to confidential doctor clinical consultation notes.
  - Prohibition of patient access to doctor clinical notes.
  - Unrestricted administrative governance and audit access for the ADMIN role.
  - Insecure Direct Object Reference (IDOR) prevention when Patient A attempts to view Patient B records.
  - Immutable audit trail recording of all RBAC and IDOR boundary violations.

### 3.3 Patient Profile and Record Management
- **Test File**: [`tests/patient.test.js`](file:///home/abhijith/pes/sem5/se/tests/patient.test.js)
- **Target User Stories**: US-04, US-05
- **Requirements Covered**: FR-PAT-01, FR-PAT-02, FR-PAT-03, SEC-REQ-2.1
- **Tests Executed**: 18 tests
- **Status**: PASSED (0 failures)
- **Key Verifications**:
  - New patient registration with demographic details, contact numbers, and emergency contacts.
  - Generation of a globally unique 10-digit Master Patient Index (MPI) identifier.
  - Strict input validation rejecting malformed phone numbers, missing names, and future dates of birth.
  - Case-insensitive search by partial patient name.
  - Exact match search by 10-digit phone number.
  - Exact match search by unique MPI identifier.
  - Immutable audit logging of patient creation, profile updates, and record queries.

### 3.4 Doctor Scheduling, Appointment Booking and Cancellation
- **Test File**: [`tests/appointment.test.js`](file:///home/abhijith/pes/sem5/se/tests/appointment.test.js)
- **Target User Stories**: US-06, US-07, US-08
- **Requirements Covered**: FR-APPT-01, FR-APPT-02, FR-APPT-03, FR-APPT-04
- **Tests Executed**: 28 tests
- **Status**: PASSED (0 failures)
- **Key Verifications**:
  - Doctor working hours configuration and automatic generation of discrete 15-minute consultation slots.
  - Validation of shift schedules (startTime preceding endTime, valid date formats).
  - Dynamic filtering of available slots excluding booked and held slots.
  - 5-minute temporary slot hold mechanism preventing concurrent selection during checkout.
  - Atomic double-booking prevention: simultaneous bookings for the identical slot yield exactly 1 success (201 Created) and 1 rejection (409 Conflict).
  - Dispatch of appointment confirmation payloads containing patient details, doctor name, and time.
  - Appointment cancellation allowed with > 2 hours notice and rejection within the 2-hour window.
  - Appointment rescheduling releasing the prior slot and reserving the new slot atomically.

### 3.5 Electronic Health Records (EHR) and Consultation Documentation
- **Test Files**: [`tests/ehr.test.js`](file:///home/abhijith/pes/sem5/se/tests/ehr.test.js), [`tests/ehr_lockout.test.js`](file:///home/abhijith/pes/sem5/se/tests/ehr_lockout.test.js)
- **Target User Stories**: US-09, US-10, US-11
- **Requirements Covered**: FR-EHR-01, FR-EHR-02, FR-EHR-03, FR-EHR-04, SEC-REQ-1.2
- **Tests Executed**: 26 tests
- **Status**: PASSED (0 failures)
- **Key Verifications**:
  - Doctor entry of clinical findings, diagnoses, and medication prescriptions.
  - Linking of EHR records to verified patient MPI and doctor user ID.
  - Automatic locking of medical consultation notes after 24 hours to prevent retrospective alteration.
  - Rejection of edits to locked clinical records with HTTP 403 / 423 Locked.
  - Digital prescription PDF generation containing patient info, doctor signature, and Rx list.
  - HMAC-SHA256 digital signature computation ensuring tamper resistance of digital prescriptions.

### 3.6 Billing and Invoicing Management
- **Test File**: [`tests/billing.test.js`](file:///home/abhijith/pes/sem5/se/tests/billing.test.js)
- **Target User Stories**: US-12
- **Requirements Covered**: FR-BILL-01, FR-BILL-02, FR-BILL-03
- **Tests Executed**: 16 tests
- **Status**: PASSED (0 failures)
- **Key Verifications**:
  - Automated itemized invoice creation aggregating consultation fees, laboratory charges, and medication costs.
  - Applicable tax calculation and subtotal summation.
  - Payment status state transitions from PENDING to PAID upon settlement.
  - Rejection of invalid payment amounts or unauthorized payment status updates.
  - Retrieval of patient billing history with IDOR boundary protection.

### 3.7 Pharmacy Inventory and Stock Management
- **Test File**: [`tests/pharmacy.test.js`](file:///home/abhijith/pes/sem5/se/tests/pharmacy.test.js)
- **Target User Stories**: US-13
- **Requirements Covered**: FR-PHARM-01, FR-PHARM-02, FR-PHARM-03
- **Tests Executed**: 17 tests
- **Status**: PASSED (0 failures)
- **Key Verifications**:
  - Live dispensary queue receiving prescriptions automatically upon doctor completion.
  - Inventory stock auto-decrement when pharmacist marks medication as dispensed.
  - Double-dispensing prevention (HTTP 409 Conflict).
  - Rejection of dispensing requests when requested quantity exceeds available stock.
  - Automatic generation of low-stock alert notifications when inventory falls below threshold.
  - Pharmacist restocking operations updating stock levels accurately.

### 3.8 Immutable Audit Trail
- **Test File**: [`tests/audit.test.js`](file:///home/abhijith/pes/sem5/se/tests/audit.test.js)
- **Target User Stories**: US-14
- **Requirements Covered**: SEC-REQ-2.1
- **Tests Executed**: 10 tests
- **Status**: PASSED (0 failures)
- **Key Verifications**:
  - Comprehensive logging across all system actions (EHR_CREATE, EHR_VIEW, EHR_UPDATE, PATIENT_SEARCH, BILLING_PAID, DISPENSE_MEDICATION).
  - Immutability assurance: rejection of update or delete operations on the audit log store.
  - Strict role-based protection ensuring only the ADMIN role can query audit records.

---

## 4. Requirements Traceability Matrix (RTM)

| User Story | Requirement ID | Test File | Test Suite Name | Result |
| :--- | :--- | :--- | :--- | :--- |
| US-01 | FR-AUTH-01 | `tests/auth.test.js` | User Registration & Login | PASS |
| US-02 | FR-AUTH-02 | `tests/lockout.test.js` | Account Lockout After 5 Failed Logins | PASS |
| US-03 | SEC-REQ-1.1 | `tests/rbac.test.js` | RBAC & Boundary Enforcement | PASS |
| US-04 | FR-PAT-01 | `tests/patient.test.js` | Register New Patient & Generate Unique ID | PASS |
| US-05 | FR-PAT-03 | `tests/patient.test.js` | Patient Search by Name, Phone, or ID | PASS |
| US-06 | FR-APPT-01 | `tests/appointment.test.js` | Doctor Working Hours & Slot Generation | PASS |
| US-07 | FR-APPT-02 | `tests/appointment.test.js` | Slot Hold & Concurrency Control | PASS |
| US-08 | FR-APPT-03 | `tests/appointment.test.js` | Cancel & Reschedule Appointments | PASS |
| US-09 | FR-EHR-01 | `tests/ehr.test.js` | Doctor Consultation Notes & Rx | PASS |
| US-10 | FR-EHR-02 | `tests/ehr_lockout.test.js` | 24-Hour Note Edit Lockout | PASS |
| US-11 | FR-EHR-03 | `tests/ehr.test.js` | Digital Prescription Generation & HMAC | PASS |
| US-12 | FR-BILL-01 | `tests/billing.test.js` | Invoice Calculation & Payments | PASS |
| US-13 | FR-PHARM-01 | `tests/pharmacy.test.js` | Dispensary Queue & Stock Decrement | PASS |
| US-14 | SEC-REQ-2.1 | `tests/audit.test.js` | Immutable Audit Log Verification | PASS |

---

## 5. Conclusion and Sign-off

The unit test suite validates 100% of functional requirements and security constraints specified in the SRS. With 147 passing tests, zero regressions, and zero open defects, the unit testing phase is complete and meets all exit criteria.
