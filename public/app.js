// Client-side Application Logic for Sprint 1 Prototype

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
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    await executeLogin(email, password);
  });

  // Registration Form
  const regForm = document.getElementById('register-form');
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
      if (res.status === 403 && data.locked) {
        alertEl.className = 'alert error';
        alertEl.textContent = `SECURITY LOCK: ${data.detail}`;
      } else {
        alertEl.className = 'alert error';
        alertEl.textContent = `Authentication Failed: ${data.detail}`;
      }
      return;
    }

    currentToken = data.data.accessToken;
    currentUser = data.data.user;
    localStorage.setItem('hms_token', currentToken);
    localStorage.setItem('hms_user', JSON.stringify(currentUser));

    alertEl.className = 'alert success';
    alertEl.textContent = `Welcome, ${currentUser.name} (${currentUser.role}). Signed in successfully with JWT.`;

    document.getElementById('token-display').textContent = JSON.stringify(data.data, null, 2);
    document.getElementById('token-card').classList.remove('hidden');
    updateSessionUI();
  } catch (err) {
    alertEl.className = 'alert error';
    alertEl.textContent = `Error: ${err.message}`;
  }
}

// Quick Fill helper
function quickFill(email, password) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = password;
}

function fillTestPassword(type) {
  const pwdInput = document.getElementById('reg-password');
  if (type === 'weak') {
    pwdInput.value = 'weak';
  } else {
    pwdInput.value = 'HospSecure#2026';
  }
  pwdInput.dispatchEvent(new Event('input'));
}

// Simulate 5 Failed Logins (Demonstrating FR-AUTH-02 / TC-HMS-02)
async function simulateFailedAttempts() {
  const email = document.getElementById('login-email').value.trim() || 'doctor.smith@hospital.com';
  document.getElementById('login-email').value = email;
  const alertEl = document.getElementById('login-alert');
  alertEl.className = 'alert info';
  alertEl.classList.remove('hidden');

  for (let i = 1; i <= 5; i++) {
    alertEl.textContent = `Simulating wrong password attempt ${i} of 5 on ${email}...`;
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'WrongPasswordAttempt' })
      });
      const data = await res.json();

      if (i === 5) {
        alertEl.className = 'alert error';
        alertEl.textContent = `ACCOUNT LOCKED: ${data.detail}`;
      } else {
        alertEl.textContent = `Attempt ${i}: ${data.detail}`;
      }
    } catch (e) {
      alertEl.className = 'alert error';
      alertEl.textContent = `Simulation error: ${e.message}`;
      break;
    }
    await new Promise(r => setTimeout(r, 400));
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

function updateSessionUI() {
  const badge = document.getElementById('session-badge');
  if (currentUser) {
    badge.textContent = `Logged in: ${currentUser.name} [${currentUser.role}]`;
    badge.classList.add('logged-in');
  } else {
    badge.textContent = 'Not Logged In';
    badge.classList.remove('logged-in');
  }
}

// Test RBAC Portal Endpoints (US-03 / SEC-REQ-1.1)
async function testPortalAccess(endpoint) {
  const resultCard = document.getElementById('rbac-result');
  const titleEl = document.getElementById('rbac-result-title');
  const jsonEl = document.getElementById('rbac-result-json');

  resultCard.classList.remove('hidden');
  titleEl.textContent = `Testing Endpoint: ${endpoint}`;
  jsonEl.textContent = 'Sending request with current Bearer token...';

  try {
    const headers = {};
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const res = await fetch(endpoint, { headers });
    const data = await res.json();

    if (res.ok) {
      titleEl.textContent = `HTTP ${res.status} OK: Access Granted`;
      titleEl.style.color = '#065f46';
    } else {
      titleEl.textContent = `HTTP ${res.status} ${res.statusText}: Access Denied`;
      titleEl.style.color = '#991b1b';
    }

    jsonEl.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    titleEl.textContent = 'Request Failed';
    titleEl.style.color = '#991b1b';
    jsonEl.textContent = err.message;
  }
}

// Fetch Audit Logs (US-14 / SEC-REQ-2.1)
async function fetchAuditLogs() {
  const alertEl = document.getElementById('audit-alert');
  const tbody = document.getElementById('audit-tbody');

  alertEl.classList.add('hidden');
  tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading audit events...</td></tr>';

  try {
    const headers = {};
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const res = await fetch('/api/v1/audit/logs', { headers });
    const data = await res.json();

    if (!res.ok) {
      alertEl.className = 'alert error';
      alertEl.textContent = `Access Denied: ${data.detail || 'Admin role is required to view audit logs.'}`;
      alertEl.classList.remove('hidden');
      tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color: #991b1b;">Permission Denied. Please log in as System Administrator (admin@hospital.com).</td></tr>';
      return;
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
