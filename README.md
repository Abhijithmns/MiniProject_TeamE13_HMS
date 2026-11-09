# Hospital Management System (HMS)

A centralized, secure web-based clinical and administrative management platform developed for the Software Engineering course (PES University).

---

## Mini-Project Deliverables (Part-1)

The following three specification documents fulfill all requirements specified in [`SE_Mini_Project_Delivereables_Part-1.pdf`](file:///home/abhijith/pes/sem5/se/SE_Mini_Project_Delivereables_Part-1.pdf):

1. **[Software Requirements Specification (SRS)](file:///home/abhijith/pes/sem5/se/docs/SRS.md)**
   - *Standard*: IEEE Std 830-1998 / ISO/IEC/IEEE 29148
   - Complete introductory and descriptive sections
   - Structured, measurable Functional Requirements (FRs) & Non-Functional Requirements (NFRs)
   - UML Use Case Diagram with core healthcare actors
   - Dedicated Security Section (Objectives & Requirements)

2. **[Software Test Plan & Test Cases](file:///home/abhijith/pes/sem5/se/docs/Test_Plan.md)**
   - *Standard*: IEEE Std 829-2008
   - Full implementation of Section 3 (Pass/Fail, Suspension/Resumption), Section 4 (Deliverables), and Section 5 (Tasks & Schedule)
   - **Section 5.1**: Dedicated Security Validation Plan (RBAC, IDOR, Injection, Cryptography, Audit)
   - Requirements Traceability Matrix (RTM) linking tests to SRS requirements
   - 10 detailed test cases covering both Functional and Non-Functional criteria

3. **[Software Architecture & Design Specification (SADS)](file:///home/abhijith/pes/sem5/se/docs/Architecture_and_Design.md)**
   - *Standard*: IEEE Std 1016-2009 / ISO/IEC/IEEE 42010
   - Multi-tier architectural pattern choice with rationale and trade-offs
   - UML Component Diagram and Subsystem decomposition
   - Security Architecture (defense-in-depth, RBAC matrix, encryption)
   - 2 UML Sequence Diagrams (Appointment Booking & Doctor Consultation)
   - RESTful API Design, RFC 7807 Error Handling, and Entity-Relationship Data Models

---

## System Diagrams

All system architecture and design diagrams are located in [`docs/diagrams/`](file:///home/abhijith/pes/sem5/se/docs/diagrams/). Each diagram includes both the editable Draw.io XML source (`.drawio`) and the exported publication-ready monochrome image (`.png`):

| Diagram | Deliverable Document | Image Preview | Editable Draw.io Source |
| :--- | :--- | :--- | :--- |
| **UML Use Case Diagram** | [`docs/SRS.md`](file:///home/abhijith/pes/sem5/se/docs/SRS.md) | [View PNG](file:///home/abhijith/pes/sem5/se/docs/diagrams/use_case_diagram.drawio.png) | [`use_case_diagram.drawio`](file:///home/abhijith/pes/sem5/se/docs/diagrams/use_case_diagram.drawio) |
| **UML Component Diagram** | [`docs/Architecture_and_Design.md`](file:///home/abhijith/pes/sem5/se/docs/Architecture_and_Design.md) | [View PNG](file:///home/abhijith/pes/sem5/se/docs/diagrams/component_diagram.drawio.png) | [`component_diagram.drawio`](file:///home/abhijith/pes/sem5/se/docs/diagrams/component_diagram.drawio) |
| **Sequence: Appointment Booking** | [`docs/Architecture_and_Design.md`](file:///home/abhijith/pes/sem5/se/docs/Architecture_and_Design.md) | [View PNG](file:///home/abhijith/pes/sem5/se/docs/diagrams/sequence_diagram_booking.drawio.png) | [`sequence_diagram_booking.drawio`](file:///home/abhijith/pes/sem5/se/docs/diagrams/sequence_diagram_booking.drawio) |
| **Sequence: Doctor Consultation** | [`docs/Architecture_and_Design.md`](file:///home/abhijith/pes/sem5/se/docs/Architecture_and_Design.md) | [View PNG](file:///home/abhijith/pes/sem5/se/docs/diagrams/sequence_diagram_consultation.drawio.png) | [`sequence_diagram_consultation.drawio`](file:///home/abhijith/pes/sem5/se/docs/diagrams/sequence_diagram_consultation.drawio) |

## System Overview
The HMS supports <actors> for <core modules, e.g. appointments,
consultations, billing, records>.

## Digital Prescription PDFs

Doctors can generate a signed prescription PDF from a consultation. A patient account must be linked to its patient MPI record by a receptionist or administrator before the prescription appears in the patient portal.

- Link a patient account: `POST /api/v1/patients/:patientId/account` with `{ "accountUserId": "USR-..." }`.
- List the signed-in patient's prescriptions: `GET /api/v1/ehr/my/prescriptions`.
- View or download a PDF: `GET /api/v1/ehr/consultations/:consultationId/prescription` (add `?download=true` to download it).
- Verify the printed code without returning patient data: `POST /api/v1/ehr/prescriptions/:consultationId/verify` with `{ "verificationCode": "sha256:..." }`.

The PDF code is an HMAC-SHA256 signature covering the patient, doctor, issue date, diagnosis, vitals, and medicines. Set `PRESCRIPTION_SIGNING_KEY` to a strong secret in deployed environments; the built-in value is for local development only.

## Performance Check

Run `npm run test:performance` to exercise patient search, slot retrieval, and consultation reads with 200 concurrent request loops against 10,000 seeded patient records. The check passes only when every request succeeds and p95 latency is at most 480 ms. GitHub Actions runs this check for pull requests targeting `main`.

## Requirement Coverage Summary
| Deliverable | Coverage |
|-------------|----------|
| SRS security | <n> objectives, <n> requirements |
| Test cases | <n> total: <n> functional, <n> non-functional |
| Sequence diagrams | 2 (Booking, Consultation) |
| Traceability | SRS → Test Plan (RTM); SRS → Architecture (Section <x>) |

---

## Project Directory Layout

```text
├── docs/
│   ├── SRS.md                              # IEEE 830 Requirements Specification
│   ├── Test_Plan.md                        # IEEE 829 Test Plan & 10 Test Cases
│   ├── Architecture_and_Design.md          # IEEE 1016 Architectural & Design Spec
│   └── diagrams/                           # Diagram assets directory
│       ├── use_case_diagram.drawio
│       ├── use_case_diagram.drawio.png
│       ├── component_diagram.drawio
│       ├── component_diagram.drawio.png
│       ├── sequence_diagram_booking.drawio
│       ├── sequence_diagram_booking.drawio.png
│       ├── sequence_diagram_consultation.drawio
│       └── sequence_diagram_consultation.drawio.png
├── SE_Mini_Project_Delivereables_Part-1.pdf # Course Rubric & Deliverables Definition
└── README.md                               # Project Overview & Index
```

## Team Members
- Likith Adithya (PES1UG24CS250)
- M Naga Sai Abhijith (PES1UG24CS252)
- Mahilan (PES1UG24CS256)
- Madhav Vinod (PES1UG24CS254)
