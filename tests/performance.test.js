'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const db = require('../src/db');
const patientService = require('../src/services/patientService');
const authService = require('../src/services/authService');

describe('Sprint 2: [US-15 / TC-HMS-08] Concurrency & High Performance Verification (NFR-PERF-01)', () => {
  let server;
  let port;
  let authToken;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 300 });

  before(async () => {
    db.reset();

    // Seed test patients for concurrent searches
    for (let i = 1; i <= 30; i++) {
      patientService.registerPatient({
        name: `Performance Patient ${i}`,
        dateOfBirth: '1992-06-15',
        gender: i % 2 === 0 ? 'FEMALE' : 'MALE',
        phone: `98000000${String(i).padStart(2, '0')}`,
        bloodGroup: 'B+',
        emergencyContact: 'Emergency Care',
        actorUserId: 'USR-REC-01',
        actorRole: 'RECEPTIONIST'
      });
    }

    // Authenticate a staff user to test concurrent authenticated endpoints
    const loginResult = await authService.login({
      email: 'doctor.smith@hospital.com',
      password: 'HospSecure#2026'
    });
    authToken = loginResult.accessToken;

    // Start HTTP server on an OS-assigned ephemeral port
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after((done) => {
    agent.destroy();
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  // Fast HTTP request helper measuring end-to-end response time
  function makeRequest(path, headers = {}) {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method: 'GET',
          agent,
          headers
        },
        (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            const duration = performance.now() - startTime;
            let body = null;
            try { body = JSON.parse(data); } catch (_) {}
            resolve({
              status: res.statusCode,
              duration,
              body,
              headers: res.headers
            });
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  test('Performance endpoint exposes targets and health metrics', async () => {
    const res = await makeRequest('/api/v1/system/performance');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'healthy');
    assert.strictEqual(res.body.targetResponseTimeMs, 500);
    assert.strictEqual(res.body.concurrencyTargetUsers, 200);
    assert.ok(res.body.memoryUsageMB.rss);
  });

  test('System handles 200 simultaneous health/page requests with 0% failure and latency < 500ms', async () => {
    const CONCURRENT_USERS = 200;
    const requests = Array.from({ length: CONCURRENT_USERS }, () =>
      makeRequest('/api/health')
    );

    const results = await Promise.all(requests);

    // Verify all 200 succeeded without crashes or error codes
    const successCount = results.filter(r => r.status === 200).length;
    assert.strictEqual(successCount, CONCURRENT_USERS, 'All 200 concurrent requests must return HTTP 200');

    // Calculate response latency statistics
    const durations = results.map(r => r.duration).sort((a, b) => a - b);
    const avgDuration = durations.reduce((acc, d) => acc + d, 0) / durations.length;
    const p95Duration = durations[Math.floor(durations.length * 0.95)];

    // Target: NFR-PERF-01 requires 95% of standard requests to respond in under 500ms under 200 concurrent users
    assert.ok(
      p95Duration < 500,
      `95th percentile latency (${p95Duration.toFixed(2)}ms) exceeded 500ms under 200 concurrent users`
    );
    assert.ok(
      avgDuration < 500,
      `Average latency (${avgDuration.toFixed(2)}ms) exceeded 500ms under 200 concurrent users`
    );
  });

  test('System handles 200 simultaneous patient searches under 500ms (FR-PAT-03 / TC-HMS-08 / NFR-PERF-01)', async () => {
    const CONCURRENT_USERS = 200;
    const searchQueries = ['Patient', 'Performance', '9800000001', 'Patient 10', 'None'];

    const requests = Array.from({ length: CONCURRENT_USERS }, (_, idx) => {
      const q = encodeURIComponent(searchQueries[idx % searchQueries.length]);
      return makeRequest(`/api/v1/patients/search?q=${q}`, {
        Authorization: `Bearer ${authToken}`
      });
    });

    const results = await Promise.all(requests);

    const successCount = results.filter(r => r.status === 200).length;
    assert.strictEqual(successCount, CONCURRENT_USERS, 'All 200 simultaneous searches must succeed');

    const durations = results.map(r => r.duration).sort((a, b) => a - b);
    const p95Duration = durations[Math.floor(durations.length * 0.95)];
    const avgDuration = durations.reduce((acc, d) => acc + d, 0) / durations.length;

    // NFR-PERF-01: 95% of database read requests respond in under 500ms
    assert.ok(
      p95Duration < 500,
      `95th percentile search response time (${p95Duration.toFixed(2)}ms) exceeded 500ms under 200 concurrent users`
    );
    assert.ok(
      avgDuration < 250,
      `Average search latency (${avgDuration.toFixed(2)}ms) should be well within bounds`
    );
  });

  test('System handles 200 simultaneous patient profile fetches without crash or slowdown', async () => {
    const CONCURRENT_USERS = 200;
    const patients = patientService.getAllPatients();
    const targetPatientId = patients[0].patientId;

    const requests = Array.from({ length: CONCURRENT_USERS }, () =>
      makeRequest(`/api/v1/patients/${targetPatientId}`, {
        Authorization: `Bearer ${authToken}`
      })
    );

    const results = await Promise.all(requests);

    const successCount = results.filter(r => r.status === 200).length;
    assert.strictEqual(successCount, CONCURRENT_USERS, 'All 200 concurrent patient fetches must succeed');

    const durations = results.map(r => r.duration).sort((a, b) => a - b);
    const p95Duration = durations[Math.floor(durations.length * 0.95)];
    assert.ok(
      p95Duration < 500,
      `95th percentile patient profile fetch latency (${p95Duration.toFixed(2)}ms) exceeded 500ms`
    );
  });

  test('Responses include X-Response-Time header demonstrating fast processing', async () => {
    const res = await makeRequest('/api/health');
    const responseTimeHeader = res.headers['x-response-time'];
    assert.ok(responseTimeHeader, 'X-Response-Time header must be present');
    assert.ok(responseTimeHeader.endsWith('ms'));
  });
});
