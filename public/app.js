// Client-side Application Logic for Hospital Management System

let currentToken = localStorage.getItem('hms_token') || null;
let currentUser = JSON.parse(localStorage.getItem('hms_user') || 'null');

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupPasswordChecklist();
  setupForms();
  updateSessionUI();
});

// Tab Navigation
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');

      if (targetId === 'tab-audit' && currentUser && currentUser.role === 'ADMIN') {
        fetchAuditLogs();
      }
    });
  });
}

// Live Password Complexity Checker
function setupPasswordChecklist() {
  const pwdInput = document.getElementById('reg-password');
  if (!pwdInput) return;

  pwdInput.addEventListener('input', () => {
    const val = pwdInput.value;
    updateRule('rule-length', val.length >= 8);
    updateRule('rule-upper', /[A-Z]/.test(val));
    updateRule('rule-lower', /[a-z]/.test(val));
    updateRule('rule-number', /[0-9]/.test(val));
    updateRule('rule-symbol', /[!@#$%^&*(),.?":{}|<>]/.test(val));
  });
}

function updateRule(elementId, isValid) {
  const el = document.getElementById(elementId);
  if (isValid) {
    el.classList.add('valid');
  } else {
    el.classList.remove('valid');
  }
}

// Setup Forms
function setupForms() {
  // Login Form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      await executeLogin(email, password);
    });
  }

  // Registration Form
  const regForm = document.getElementById('register-form');
  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('reg-name').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const role = document.getElementById('reg-role').value;
      const password = document.getElementById('reg-password').value;

      const alertEl = document.getElementById('register-alert');
      alertEl.className = 'alert info';
      alertEl.textContent = 'Submitting registration...';
      alertEl.classList.remove('hidden');

      try {
        const res = await fetch('/api/v1/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, role, password })
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.detail || 'Registration failed');
        }

        alertEl.className = 'alert success';
        alertEl.textContent = `User ${data.data.name} (${data.data.role}) registered successfully. User ID: ${data.data.id}. You can now sign in.`;
        regForm.reset();
        document.querySelectorAll('.password-checklist .check-item').forEach(el => el.classList.remove('valid'));
      } catch (err) {
        alertEl.className = 'alert error';
        alertEl.textContent = `Registration Rejected: ${err.message}`;
      }
    });
  }

  // Doctor Consultation Form (US-09)
  const ehrForm = document.getElementById('ehr-form');
  if (ehrForm) {
    ehrForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const alertEl = document.getElementById('ehr-alert');
      const resultBox = document.getElementById('ehr-result');
      const displayEl = document.getElementById('ehr-display');

      if (!currentToken) {
        alertEl.className = 'alert error';
        alertEl.textContent = 'Please log in with a DOCTOR or ADMIN account first.';
        alertEl.classList.remove('hidden');
        return;
      }

      const patientId = document.getElementById('ehr-patient-id').value.trim();
      const appointmentId = document.getElementById('ehr-appointment-id').value.trim() || undefined;
      const bp = document.getElementById('ehr-bp').value.trim() || undefined;
      const pulse = document.getElementById('ehr-pulse').value.trim() || undefined;
      const temp = document.getElementById('ehr-temp').value.trim() || undefined;
      const spo2 = document.getElementById('ehr-spo2').value.trim() || undefined;
      const symptoms = document.getElementById('ehr-symptoms').value.trim();
      const examinationNotes = document.getElementById('ehr-examination').value.trim();
      const diagnosis = document.getElementById('ehr-diagnosis').value.trim();

      const rxName = document.getElementById('rx-name').value.trim();
      const rxDosage = document.getElementById('rx-dosage').value.trim();
      const rxFrequency = document.getElementById('rx-frequency').value.trim();
      const rxDuration = document.getElementById('rx-duration').value.trim();

      const prescriptions = [];
      if (rxName && rxDosage) {
        prescriptions.push({
          name: rxName,
          dosage: rxDosage,
          frequency: rxFrequency || 'Once daily',
          durationDays: rxDuration ? Number(rxDuration) : 5
        });
      }

      alertEl.className = 'alert info';
      alertEl.textContent = 'Saving consultation and generating digital prescription hash...';
      alertEl.classList.remove('hidden');

      try {
        const res = await fetch('/api/v1/ehr/consultations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentToken}`
          },
          body: JSON.stringify({
            patientId,
            appointmentId,
            vitals: {
              bloodPressure: bp,
              pulse: pulse ? Number(pulse) : undefined,
              temperature: temp ? Number(temp) : undefined,
              spo2: spo2 ? Number(spo2) : undefined
            },
            symptoms,
            examinationNotes,
            diagnosis,
            prescriptions
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || data.title || 'Failed to save consultation');
        }

        alertEl.className = 'alert success';
        alertEl.textContent = `Consultation recorded successfully (${data.data.consultationId}). Prescriptions dispatched to Pharmacy Queue.`;

        displayEl.textContent = JSON.stringify(data.data, null, 2);
        resultBox.classList.remove('hidden');
        ehrForm.reset();
      } catch (err) {
        alertEl.className = 'alert error';
        alertEl.textContent = `Consultation Error: ${err.message}`;
        resultBox.classList.add('hidden');
      }
    });
  }

  // Medical Addendum Form (US-10)
  const addendumForm = document.getElementById('addendum-form');
  if (addendumForm) {
    addendumForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const alertEl = document.getElementById('addendum-alert');
      const resultBox = document.getElementById('addendum-result');
      const displayEl = document.getElementById('addendum-display');

      if (!currentToken) {
        alertEl.className = 'alert error';
        alertEl.textContent = 'Please log in with a DOCTOR or ADMIN account first.';
        alertEl.classList.remove('hidden');
        return;
      }

      const consultationId = document.getElementById('addendum-consultation-id').value.trim();
      const note = document.getElementById('addendum-note').value.trim();

      alertEl.className = 'alert info';
      alertEl.textContent = 'Appending signed addendum to medical record...';
      alertEl.classList.remove('hidden');

      try {
        const res = await fetch(`/api/v1/ehr/consultations/${encodeURIComponent(consultationId)}/addendum`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentToken}`
          },
          body: JSON.stringify({ note })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || data.title || 'Failed to append addendum');
        }

        alertEl.className = 'alert success';
        alertEl.textContent = `Addendum ${data.data.addendum.addendumId} appended permanently to ${consultationId} by Dr. ${data.data.addendum.doctorName}.`;

        displayEl.textContent = JSON.stringify(data.data, null, 2);
        resultBox.classList.remove('hidden');
        addendumForm.reset();
      } catch (err) {
        alertEl.className = 'alert error';
        alertEl.textContent = `Addendum Error: ${err.message}`;
        resultBox.classList.add('hidden');
      }
    });
  }
}

async function executeLogin(email, password) {
  const alertEl = document.getElementById('login-alert');
  alertEl.className = 'alert info';
  alertEl.textContent = 'Authenticating...';
  alertEl.classList.remove('hidden');

  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.locked) {
        throw new Error(`SECURITY ALERT: ${data.detail} (${data.lockedUntil})`);
      }
      const attemptsInfo = data.remainingAttempts !== undefined ? ` (Attempts remaining: ${data.remainingAttempts})` : '';
      throw new Error((data.detail || 'Login failed') + attemptsInfo);
    }

    currentToken = data.data.accessToken;
    currentUser = data.data.user;
    localStorage.setItem('hms_token', currentToken);
    localStorage.setItem('hms_user', JSON.stringify(currentUser));

    alertEl.className = 'alert success';
    alertEl.textContent = `Welcome ${currentUser.name}! Authenticated with role: ${currentUser.role}.`;

    const tokenCard = document.getElementById('token-card');
    const tokenDisplay = document.getElementById('token-display');
    tokenDisplay.textContent = currentToken;
    tokenCard.classList.remove('hidden');

    updateSessionUI();
  } catch (err) {
    alertEl.className = 'alert error';
    alertEl.textContent = err.message;
  }
}

function updateSessionUI() {
  const badge = document.getElementById('session-badge');
  if (currentUser) {
    badge.textContent = `${currentUser.name} (${currentUser.role})`;
    badge.style.background = '#047857';
  } else {
    badge.textContent = 'Not Logged In';
    badge.style.background = '#374151';
  }
}

function quickFill(email, password) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = password;
}

function fillTestPassword(type) {
  const pwdInput = document.getElementById('reg-password');
  if (type === 'weak') {
    pwdInput.value = 'pass123';
  } else {
    pwdInput.value = 'HospSecure#2026';
  }
  pwdInput.dispatchEvent(new Event('input'));
}

async function simulateFailedAttempts() {
  const email = document.getElementById('login-email').value.trim() || 'doctor.smith@hospital.com';
  document.getElementById('login-email').value = email;
  const alertEl = document.getElementById('login-alert');

  alertEl.className = 'alert info';
  alertEl.textContent = `Simulating 5 consecutive bad password attempts for ${email}...`;
  alertEl.classList.remove('hidden');

  for (let i = 1; i <= 5; i++) {
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'WrongPassword@123' })
      });
      const data = await res.json();
      if (res.status === 403 && data.locked) {
        alertEl.className = 'alert error';
        alertEl.textContent = `[Attempt ${i}/5] Lockout triggered! ${data.detail}. Status checked via API.`;
        return;
      }
    } catch (e) {
      console.error(e);
    }
  }
}

function logoutUser() {
  currentToken = null;
  currentUser = null;
  localStorage.removeItem('hms_token');
  localStorage.removeItem('hms_user');
  updateSessionUI();

  const alertEl = document.getElementById('login-alert');
  alertEl.className = 'alert info';
  alertEl.textContent = 'You have logged out.';
  alertEl.classList.remove('hidden');

  document.getElementById('token-card').classList.add('hidden');
}

async function testPortalAccess(endpoint) {
  const resultBox = document.getElementById('rbac-result');
  const resultTitle = document.getElementById('rbac-result-title');
  const resultJson = document.getElementById('rbac-result-json');

  resultBox.classList.remove('hidden');
  resultTitle.textContent = `Testing: ${endpoint}`;
  resultJson.textContent = 'Sending authenticated request...';

  try {
    const headers = {};
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const res = await fetch(endpoint, { headers });
    const data = await res.json();

    if (!res.ok) {
      resultBox.style.borderLeft = '4px solid #ef4444';
      resultJson.textContent = JSON.stringify({
        httpStatus: res.status,
        statusText: res.statusText,
        errorPayload: data
      }, null, 2);
    } else {
      resultBox.style.borderLeft = '4px solid #10b981';
      resultJson.textContent = JSON.stringify({
        httpStatus: res.status,
        responsePayload: data
      }, null, 2);
    }
  } catch (err) {
    resultBox.style.borderLeft = '4px solid #ef4444';
    resultJson.textContent = `Network / Execution Error: ${err.message}`;
  }
}

async function fetchAuditLogs() {
  const alertEl = document.getElementById('audit-alert');
  const tbody = document.getElementById('audit-tbody');

  alertEl.classList.add('hidden');
  tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading immutable audit logs...</td></tr>';

  try {
    const headers = {};
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const res = await fetch('/api/v1/audit/logs', { headers });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.title || 'Access Denied: Admin privileges required to view audit trail.');
    }

    const logs = data.data.logs;
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center">No audit records recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td><code>${l.timestamp}</code></td>
        <td><strong>${escapeHtml(l.actorUserId)}</strong></td>
        <td>${escapeHtml(l.actorRole)}</td>
        <td><code>${escapeHtml(l.actionType)}</code></td>
        <td>${escapeHtml(l.targetResource)}</td>
        <td><span style="font-weight: 700; color: ${l.status === 'SUCCESS' ? '#065f46' : '#991b1b'};">${escapeHtml(l.status)}</span></td>
        <td>${escapeHtml(l.details || '')}</td>
      </tr>
    `).join('');

  } catch (err) {
    alertEl.className = 'alert error';
    alertEl.textContent = err.message;
    alertEl.classList.remove('hidden');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
