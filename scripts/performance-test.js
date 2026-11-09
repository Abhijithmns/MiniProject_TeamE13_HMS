'use strict';

const { performance } = require('node:perf_hooks');
const app = require('../src/app');
const db = require('../src/db');
const authService = require('../src/services/authService');
const ehrService = require('../src/services/ehrService');

const CONCURRENCY = Number(process.env.PERF_CONCURRENCY || 200);
const DURATION_SECONDS = Number(process.env.PERF_DURATION_SECONDS || 15);
const RESPONSE_TIME_LIMIT_MS = Number(process.env.PERF_P95_LIMIT_MS || 480);
const DEFAULT_PASSWORD = 'HospSecure#2026';

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

async function seedPerformanceData() {
  db.reset();

  const today = new Date().toISOString().slice(0, 10);
  for (let index = 0; index < 10000; index++) {
    const patientId = String(9000000000 + index);
    db.createPatient({
      patientId,
      name: `Performance Patient ${String(index).padStart(5, '0')}`,
      dateOfBirth: '1980-01-01',
      gender: 'OTHER',
      phone: String(7000000000 + index),
      emergencyContact: 'Performance Test Contact',
      accountUserId: index === 0 ? 'USR-PAT-01' : null
    });
  }

  const consultation = ehrService.recordConsultation({
    appointmentId: 'PERF-APPT-01',
    patientId: '9000000000',
    vitals: { bloodPressure: '120/80', pulse: 72, temperature: 98.6, spo2: 99 },
    diagnosis: 'Performance test visit',
    prescriptions: [{ name: 'Sample medicine', dosage: '1 tablet', frequency: 'Once daily' }],
    actorUserId: 'USR-DOC-01',
    actorRole: 'DOCTOR',
    doctorName: 'Dr. Sarah Smith'
  });

  const staff = await authService.login({ email: 'receptionist@hospital.com', password: DEFAULT_PASSWORD });
  const doctor = await authService.login({ email: 'doctor.smith@hospital.com', password: DEFAULT_PASSWORD });
  return {
    patientSearchToken: staff.accessToken,
    slotsToken: doctor.accessToken,
    recordToken: doctor.accessToken,
    searchTerm: `performance patient ${String(5000).padStart(5, '0')}`,
    consultationId: consultation.consultationId,
    date: today,
    doctorId: 'USR-DOC-01',
  };
}

async function runPerformanceCheck(baseUrl, setup) {
  const latencies = [];
  const failures = [];
  const deadline = Date.now() + DURATION_SECONDS * 1000;
  let nextRequest = 0;

  async function request(workerNumber) {
    const scenario = nextRequest++ % 10;
    let path;
    let token;
    if (scenario < 7) {
      path = `/api/v1/patients/search?q=${encodeURIComponent(setup.searchTerm)}`;
      token = setup.patientSearchToken;
    } else if (scenario < 9) {
      path = `/api/v1/appointments/slots?doctorId=${encodeURIComponent(setup.doctorId)}&date=${encodeURIComponent(setup.date)}`;
      token = setup.slotsToken;
    } else {
      path = `/api/v1/ehr/consultations/${encodeURIComponent(setup.consultationId)}`;
      token = setup.recordToken;
    }

    const startedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Perf-Worker': String(workerNumber) }
      });
      await response.arrayBuffer();
      latencies.push(performance.now() - startedAt);
      if (!response.ok) failures.push(`${response.status} ${path}`);
    } catch (error) {
      latencies.push(performance.now() - startedAt);
      failures.push(error.message);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, async (_, workerNumber) => {
    while (Date.now() < deadline) await request(workerNumber);
  }));

  const p95 = percentile(latencies, 0.95);
  const errorRate = latencies.length ? failures.length / latencies.length : 1;
  const summary = {
    activeUsers: CONCURRENCY,
    durationSeconds: DURATION_SECONDS,
    requests: latencies.length,
    p50Ms: Number(percentile(latencies, 0.5).toFixed(1)),
    p95Ms: Number(p95.toFixed(1)),
    p99Ms: Number(percentile(latencies, 0.99).toFixed(1)),
    errorRate: Number(errorRate.toFixed(4)),
    responseTimeLimitMs: RESPONSE_TIME_LIMIT_MS
  };
  console.log(JSON.stringify(summary, null, 2));

  if (latencies.length === 0 || p95 > RESPONSE_TIME_LIMIT_MS || failures.length > 0) {
    const sampleFailures = failures.slice(0, 5).join('; ');
    throw new Error(`Performance criteria failed.${sampleFailures ? ` Sample failures: ${sampleFailures}` : ''}`);
  }
}

async function main() {
  if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) throw new Error('PERF_CONCURRENCY must be a positive integer.');
  if (!Number.isFinite(DURATION_SECONDS) || DURATION_SECONDS < 1) throw new Error('PERF_DURATION_SECONDS must be at least 1.');

  const setup = await seedPerformanceData();
  const server = app.listen(0, '127.0.0.1');
  server.on('error', error => { throw error; });
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await runPerformanceCheck(baseUrl, setup);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
