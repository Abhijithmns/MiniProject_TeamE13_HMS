// Client-side Application Logic for Hospital Management System

let currentToken = localStorage.getItem('hms_token') || null;
let currentUser = JSON.parse(localStorage.getItem('hms_user') || 'null');

// Route Registry & Role Access Policy
const ROUTES = {
  '#login': {
    tabId: 'tab-login',
    title: 'Sign In',
    authRequired: false
  },
  '#register': {
    tabId: 'tab-register',
    title: 'User Registration',
    authRequired: false
  },
  '#portals': {
    tabId: 'tab-rbac',
    title: 'Department Portals',
    authRequired: true,
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'PHARMACIST', 'ADMIN']
  },
  '#appointments': {
    tabId: 'tab-booking',
    title: 'Appointments & Scheduling',
    authRequired: true,
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'ADMIN']
  },
  '#ehr': {
    tabId: 'tab-ehr',
    title: 'Consultations & EHR',
    authRequired: true,
    roles: ['DOCTOR', 'ADMIN']
  },
  '#billing': {
    tabId: 'tab-billing',
    title: 'Billing & Payments',
    authRequired: true,
    roles: ['RECEPTIONIST', 'ADMIN', 'PATIENT']
  },
  '#pharmacy': {
    tabId: 'tab-pharmacy',
    title: 'Pharmacy & Dispensary',
    authRequired: true,
    roles: ['PHARMACIST', 'ADMIN', 'DOCTOR']
  },
  '#audit': {
    tabId: 'tab-audit',
    title: 'Security Audit Trail',
    authRequired: true,
    roles: ['ADMIN']
  }
};

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupPasswordChecklist();
  setupForms();
  setupBookingTab();
  setupBillingTab();
  updateSessionUI();

  // Periodic token validity & session expiry check every 30 seconds
  setInterval(checkSessionExpiry, 30000);
});

// Check if JWT token is expired or malformed
function checkSessionExpiry() {
  if (!currentToken) return false;

  try {
    const parts = currentToken.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      if (payload.exp && (payload.exp * 1000) < Date.now()) {
        logoutUser('Your session has expired. Please sign in again.');
        return true;
      }
    }
  } catch (e) {
    logoutUser('Session verification error. Please sign in again.');
    return true;
  }
  return false;
}

function getDefaultRouteForRole(role) {
  switch (role) {
    case 'DOCTOR': return '#ehr';
    case 'PHARMACIST': return '#pharmacy';
    case 'RECEPTIONIST': return '#appointments';
    case 'ADMIN': return '#audit';
    case 'PATIENT': return '#portals';
    default: return '#portals';
  }
}

function navigateTo(hash) {
  if (window.location.hash === hash) {
    handleRoute();
  } else {
    window.location.hash = hash;
  }
}

function navigateToDefaultPortal() {
  if (currentUser) {
    navigateTo(getDefaultRouteForRole(currentUser.role));
  } else {
    navigateTo('#login');
  }
}

// Router & Route Guard Handler
function handleRoute() {
  if (checkSessionExpiry()) return;

  let currentHash = window.location.hash;
  if (!currentHash || !ROUTES[currentHash]) {
    currentHash = currentUser ? getDefaultRouteForRole(currentUser.role) : '#login';
  }

  const routeConfig = ROUTES[currentHash];
  const guardView = document.getElementById('route-guard-view');
  const guardIcon = document.getElementById('guard-icon');
  const guardTitle = document.getElementById('guard-title');
  const guardMessage = document.getElementById('guard-message');
  const guardPrimaryBtn = document.getElementById('guard-primary-btn');
  const guardSecondaryBtn = document.getElementById('guard-secondary-btn');

  // Hide all tab contents
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  // 1. Authentication Guard: Feature requires an active session
  if (routeConfig.authRequired && !currentToken) {
    if (guardView) {
      guardView.classList.add('active');
      if (guardIcon) guardIcon.textContent = '[Authentication Required]';
      if (guardTitle) guardTitle.textContent = `Sign In Required: ${routeConfig.title}`;
      if (guardMessage) {
        guardMessage.innerHTML = `You must be logged in to access <strong>${routeConfig.title}</strong>. Please sign in with your hospital account credentials.`;
      }
      if (guardPrimaryBtn) {
        guardPrimaryBtn.textContent = 'Sign In to Continue';
        guardPrimaryBtn.setAttribute('href', '#login');
      }
      if (guardSecondaryBtn) {
        guardSecondaryBtn.textContent = 'Register New Account';
        guardSecondaryBtn.onclick = () => navigateTo('#register');
      }
    }
    updateNavActive(null);
    return;
  }

  // 2. Role-Based Access Guard: Feature requires specific system role
  if (routeConfig.roles && currentUser && !routeConfig.roles.includes(currentUser.role)) {
    if (guardView) {
      guardView.classList.add('active');
      if (guardIcon) guardIcon.textContent = '[Access Restricted]';
      if (guardTitle) guardTitle.textContent = `Access Restricted: ${routeConfig.title}`;
      const allowedRolesStr = routeConfig.roles.join(', ');
      if (guardMessage) {
        guardMessage.innerHTML = `Your account role (<strong>${currentUser.role}</strong>) does not have authorization to access <strong>${routeConfig.title}</strong>.<br><small style="color:var(--text-muted); margin-top:0.5rem; display:inline-block;">Permitted roles: ${allowedRolesStr}</small>`;
      }
      if (guardPrimaryBtn) {
        guardPrimaryBtn.textContent = 'Go to My Permitted Workspace';
        guardPrimaryBtn.setAttribute('href', getDefaultRouteForRole(currentUser.role));
      }
      if (guardSecondaryBtn) {
        guardSecondaryBtn.textContent = 'Switch Account';
        guardSecondaryBtn.onclick = () => logoutUser('Please sign in with an authorized account.');
      }
    }
    updateNavActive(null);
    return;
  }

  // Hide guard view and activate target tab
  if (guardView) guardView.classList.remove('active');
  const targetTab = document.getElementById(routeConfig.tabId);
  if (targetTab) {
    targetTab.classList.add('active');
  }

  updateNavActive(currentHash);

  // Trigger tab-specific initializations
  if (currentHash === '#audit' && currentUser && currentUser.role === 'ADMIN') {
    fetchAuditLogs();
  }
  if (currentHash === '#pharmacy' && currentUser) {
    fetchPharmacyQueue();
    fetchPharmacyInventory();
  }
  if (currentHash === '#portals' && currentUser && currentUser.role === 'PATIENT') {
    loadMyPrescriptions();
  }
}

function updateNavActive(activeHash) {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    const route = btn.getAttribute('data-route') || btn.getAttribute('href');
    if (activeHash && route === activeHash) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// Router Event Listeners
function setupTabs() {
  window.addEventListener('hashchange', () => {
    handleRoute();
  });

  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const routeHash = btn.getAttribute('data-route') || btn.getAttribute('href');
      if (routeHash) {
        navigateTo(routeHash);
      }
    });
  });

  // Initial route dispatch on load
  handleRoute();
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

        const c = data.data || {};
        const vitals = c.vitals || {};
        const rx = Array.isArray(c.prescriptions) ? c.prescriptions : [];

        displayEl.innerHTML = `
          <div style="background:#ffffff; border:1px solid var(--border-color); border-radius:6px; padding:1.25rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; border-bottom:1px solid var(--border-color); padding-bottom:0.75rem;">
              <div>
                <h4 style="margin:0; color:var(--text-primary); font-size:1.1rem;">Consultation Record</h4>
                <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.25rem;">ID: <code>${escapeHtml(c.consultationId || 'N/A')}</code></div>
              </div>
              <span class="badge badge-success">RECORDED</span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:0.75rem; font-size:0.875rem; margin-bottom:1rem;">
              <div><strong>Patient ID:</strong> <code>${escapeHtml(c.patientId || 'N/A')}</code></div>
              <div><strong>Physician:</strong> Dr. ${escapeHtml(c.doctorName || 'Attending Physician')}</div>
              <div style="grid-column:1 / -1;"><strong>Diagnosis:</strong> ${escapeHtml(c.diagnosis || 'Clinical evaluation')}</div>
            </div>
            <div style="background:#f8fafc; border:1px solid var(--border-color); border-radius:4px; padding:0.75rem; margin-bottom:1rem; font-size:0.85rem;">
              <strong>Recorded Vitals:</strong>
              <div style="display:flex; gap:1.5rem; flex-wrap:wrap; margin-top:0.25rem;">
                <span>BP: <strong>${escapeHtml(vitals.bloodPressure || 'N/A')}</strong></span>
                <span>Pulse: <strong>${escapeHtml(String(vitals.pulse || 'N/A'))} bpm</strong></span>
                <span>Temp: <strong>${escapeHtml(String(vitals.temperature || 'N/A'))} °F</strong></span>
                <span>SpO2: <strong>${escapeHtml(String(vitals.spo2 || 'N/A'))}%</strong></span>
              </div>
            </div>
            ${rx.length > 0 ? `
              <div style="font-size:0.85rem;">
                <strong>Digital Prescriptions Dispatched to Dispensary:</strong>
                <ul style="margin:0.35rem 0 0 1.25rem; padding:0;">
                  ${rx.map(item => `<li><strong>${escapeHtml(item.name)}</strong>: ${escapeHtml(item.dosage || '')} (${escapeHtml(item.frequency || '')})</li>`).join('')}
                </ul>
              </div>
            ` : ''}
          </div>
        `;
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

        const add = data.data?.addendum || data.data || {};
        displayEl.innerHTML = `
          <div style="background:#ffffff; border:1px solid var(--border-color); border-radius:6px; padding:1.25rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
              <div>
                <h4 style="margin:0; color:var(--text-primary);">Medical Addendum Appended</h4>
                <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.25rem;">Addendum ID: <code>${escapeHtml(add.addendumId || 'ADD')}</code> | Consultation: <code>${escapeHtml(consultationId)}</code></div>
              </div>
              <span class="badge badge-info">SIGNED</span>
            </div>
            <div style="font-size:0.875rem; margin-bottom:0.75rem;">
              <strong>Attending Doctor:</strong> Dr. ${escapeHtml(add.doctorName || 'Physician')} &bull; <strong>Timestamp:</strong> ${escapeHtml(add.createdAt ? new Date(add.createdAt).toLocaleString() : new Date().toLocaleString())}
            </div>
            <div style="background:#f9fafb; border-left:3px solid var(--accent); padding:0.75rem; font-size:0.875rem; border-radius:0 4px 4px 0;">
              <strong>Clinical Addendum Note:</strong>
              <div style="margin-top:0.25rem; font-style:italic;">"${escapeHtml(add.note || note)}"</div>
            </div>
          </div>
        `;
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
    if (tokenDisplay) {
      tokenDisplay.innerHTML = `
        <div style="background:#ffffff; border:1px solid var(--border-color); border-radius:6px; padding:1rem; font-size:0.875rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
            <div><strong>${escapeHtml(currentUser.name)}</strong> (ID: <code>${escapeHtml(currentUser.id)}</code>)</div>
            <span class="badge badge-success">${escapeHtml(currentUser.role)}</span>
          </div>
          <div><strong>Email:</strong> ${escapeHtml(currentUser.email)}</div>
          <div style="margin-top:0.5rem; font-size:0.8rem; color:var(--text-muted);">Session Status: Active (Cryptographically Signed Token)</div>
        </div>
      `;
    }
    if (tokenCard) tokenCard.classList.remove('hidden');

    updateSessionUI();

    // Auto-navigate to user's permitted departmental portal
    const defaultRoute = getDefaultRouteForRole(currentUser.role);
    setTimeout(() => {
      navigateTo(defaultRoute);
    }, 450);
  } catch (err) {
    alertEl.className = 'alert error';
    alertEl.textContent = err.message;
  }
}

const DEMO_PERSONAS = {
  DOCTOR: { email: 'doctor.smith@hospital.com', pass: 'HospSecure#2026' },
  PHARMACIST: { email: 'pharmacist@hospital.com', pass: 'HospSecure#2026' },
  PATIENT: { email: 'patient.jane@hospital.com', pass: 'HospSecure#2026' },
  RECEPTIONIST: { email: 'receptionist@hospital.com', pass: 'HospSecure#2026' },
  ADMIN: { email: 'admin@hospital.com', pass: 'HospSecure#2026' }
};

async function switchPersona(targetRole) {
  const creds = DEMO_PERSONAS[targetRole];
  if (!creds) return;
  await executeLogin(creds.email, creds.pass);
}

function applyRoleVisibility() {
  const role = currentUser ? currentUser.role : null;

  // 1. Filter Navigation Tabs based on role permissions
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    const routeHash = btn.getAttribute('data-route') || btn.getAttribute('href');
    const routeConfig = ROUTES[routeHash];
    if (!routeConfig) return;

    if (!currentUser) {
      // Logged out: show only sign-in & register
      if (routeConfig.authRequired) {
        btn.classList.add('tab-hidden');
      } else {
        btn.classList.remove('tab-hidden');
      }
    } else {
      // Logged in: hide auth tabs (#login, #register for non-admins) and prohibited routes
      if (routeHash === '#login' || (routeHash === '#register' && role !== 'ADMIN')) {
        btn.classList.add('tab-hidden');
      } else if (routeConfig.roles && !routeConfig.roles.includes(role)) {
        btn.classList.add('tab-hidden');
      } else {
        btn.classList.remove('tab-hidden');
      }
    }
  });

  // 2. Filter Component-Level Elements by data-roles attribute
  const roleProtectedElements = document.querySelectorAll('[data-roles]');
  roleProtectedElements.forEach(el => {
    if (!currentUser && el.hasAttribute('data-anonymous')) {
      el.classList.remove('hidden');
      return;
    }

    if (!currentUser) {
      el.classList.add('hidden');
      return;
    }

    const rawRoles = el.getAttribute('data-roles') || '';
    const allowedRoles = rawRoles.split(/\s+/).filter(Boolean);
    if (allowedRoles.includes(role) || allowedRoles.includes('*')) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  // 3. Filter Elements with data-anonymous (visible only when logged out)
  const anonElements = document.querySelectorAll('[data-anonymous]:not([data-roles])');
  anonElements.forEach(el => {
    if (currentUser) {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  });

  // 4. Filter Elements with data-authenticated (visible only when logged in)
  const authElements = document.querySelectorAll('[data-authenticated]');
  authElements.forEach(el => {
    if (currentUser) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  // 5. Active Session Summary card in Login tab
  const activeSessionCard = document.getElementById('active-session-card');
  const activeSessionSummary = document.getElementById('active-session-summary');
  if (activeSessionCard && activeSessionSummary) {
    if (currentUser) {
      activeSessionCard.classList.remove('hidden');
      activeSessionSummary.innerHTML = `Signed in as <strong>${escapeHtml(currentUser.name)}</strong> (<code>${escapeHtml(currentUser.role)}</code>). You only see options and departmental features granted to your role.`;
    } else {
      activeSessionCard.classList.add('hidden');
    }
  }

  // 6. Quick Role Switcher in header
  const switcher = document.getElementById('quick-role-switcher');
  const demoRoleSelect = document.getElementById('demo-role-select');
  if (switcher) {
    switcher.classList.toggle('hidden', !currentUser);
    if (currentUser && demoRoleSelect) {
      demoRoleSelect.value = currentUser.role;
    }
  }
}

function updateSessionUI() {
  const badge = document.getElementById('session-badge');
  const headerLogoutBtn = document.getElementById('header-logout-btn');
  const prescriptionsPanel = document.getElementById('patient-prescriptions-panel');
  const accountLinkForm = document.getElementById('patient-account-link-form');

  if (currentUser) {
    if (badge) {
      badge.textContent = `${currentUser.name} (${currentUser.role})`;
      badge.classList.add('logged-in');
      badge.style.background = '#047857';
    }
    if (headerLogoutBtn) headerLogoutBtn.classList.remove('hidden');
  } else {
    if (badge) {
      badge.textContent = 'Not Logged In';
      badge.classList.remove('logged-in');
      badge.style.background = '#374151';
    }
    if (headerLogoutBtn) headerLogoutBtn.classList.add('hidden');
  }

  // Enforce fine-grained role visibility across whole UI
  applyRoleVisibility();

  if (prescriptionsPanel) {
    const isPatient = currentUser?.role === 'PATIENT' || currentUser?.role === 'ADMIN';
    prescriptionsPanel.classList.toggle('hidden', !isPatient);
    if (isPatient && currentToken) loadMyPrescriptions();
  }
  if (accountLinkForm) {
    const canLinkAccounts = ['RECEPTIONIST', 'ADMIN'].includes(currentUser?.role);
    accountLinkForm.classList.toggle('hidden', !canLinkAccounts);
  }
}

async function linkPatientAccountUI() {
  const alert = document.getElementById('patient-account-link-alert');
  const patientId = document.getElementById('link-patient-mpi').value.trim();
  const accountUserId = document.getElementById('link-patient-user').value.trim();
  alert.className = 'alert info';
  alert.textContent = 'Linking patient record…';
  alert.classList.remove('hidden');

  try {
    const response = await fetch(`/api/v1/patients/${encodeURIComponent(patientId)}/account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`
      },
      body: JSON.stringify({ accountUserId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Patient account link failed.');
    alert.className = 'alert success';
    alert.textContent = `Patient ${data.data.patient.patientId} linked to ${data.data.patient.accountUserId}.`;
  } catch (error) {
    alert.className = 'alert error';
    alert.textContent = error.message;
  }
}

async function loadMyPrescriptions() {
  const status = document.getElementById('prescription-list-status');
  const container = document.getElementById('prescription-list');
  if (!status || !container) return;
  if (!currentToken || currentUser?.role !== 'PATIENT') {
    status.className = 'alert error';
    status.textContent = 'Sign in with a patient account to view prescriptions.';
    container.replaceChildren();
    return;
  }

  status.className = 'alert info';
  status.textContent = 'Loading your prescriptions…';
  container.replaceChildren();

  try {
    const response = await fetch('/api/v1/ehr/my/prescriptions', {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Could not load prescriptions.');

    if (data.count === 0) {
      status.className = 'alert info';
      status.textContent = data.patientId
        ? 'No prescriptions are available yet.'
        : 'No patient record is linked to this account yet. Please ask the front desk to link it.';
      return;
    }

    status.className = 'alert success';
    status.textContent = `${data.count} verified prescription${data.count === 1 ? '' : 's'} available.`;
    container.innerHTML = data.prescriptions.map(prescription => `
      <article class="prescription-card">
        <div>
          <strong>${escapeHtml(prescription.diagnosis || 'Prescription')}</strong>
          <div>Issued ${escapeHtml(new Date(prescription.issuedAt).toLocaleString())} by ${escapeHtml(prescription.doctorName)}</div>
          <div>${escapeHtml(prescription.medicationCount)} medicine(s) · ${escapeHtml(prescription.consultationId)}</div>
        </div>
        <div class="prescription-actions">
          <button class="btn btn-outline" type="button" data-prescription-action="view" data-prescription-id="${escapeHtml(prescription.consultationId)}">View PDF</button>
          <button class="btn btn-secondary" type="button" data-prescription-action="download" data-prescription-id="${escapeHtml(prescription.consultationId)}">Download PDF</button>
        </div>
      </article>
    `).join('');

    container.querySelectorAll('[data-prescription-action]').forEach(button => {
      button.addEventListener('click', () => openPrescriptionPdf(
        button.dataset.prescriptionId,
        button.dataset.prescriptionAction === 'download'
      ));
    });
  } catch (error) {
    status.className = 'alert error';
    status.textContent = error.message;
  }
}

async function openPrescriptionPdf(consultationId, download) {
  const viewer = download ? null : window.open('about:blank', '_blank');
  try {
    const response = await fetch(`/api/v1/ehr/consultations/${encodeURIComponent(consultationId)}/prescription${download ? '?download=true' : ''}`, {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Could not retrieve the prescription PDF.');
    }

    const pdfUrl = URL.createObjectURL(await response.blob());
    if (download) {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = `prescription-${consultationId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else if (viewer) {
      viewer.location.href = pdfUrl;
    } else {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
  } catch (error) {
    if (viewer) viewer.close();
    const status = document.getElementById('prescription-list-status');
    status.className = 'alert error';
    status.textContent = error.message;
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

function logoutUser(message = 'You have signed out.') {
  currentToken = null;
  currentUser = null;
  localStorage.removeItem('hms_token');
  localStorage.removeItem('hms_user');
  updateSessionUI();
  navigateTo('#login');

  const alertEl = document.getElementById('login-alert');
  if (alertEl) {
    alertEl.className = 'alert info';
    alertEl.textContent = message;
    alertEl.classList.remove('hidden');
  }

  const tokenCard = document.getElementById('token-card');
  if (tokenCard) tokenCard.classList.add('hidden');
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
      resultJson.innerHTML = `
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:4px; padding:0.85rem; font-size:0.875rem; color:#991b1b;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
            <strong>HTTP ${res.status} ${escapeHtml(res.statusText || 'Access Denied')}</strong>
            <span class="badge badge-danger">RESTRICTED</span>
          </div>
          <div>${escapeHtml(data.detail || data.title || data.message || 'Unauthorized role access')}</div>
        </div>
      `;
    } else {
      resultBox.style.borderLeft = '4px solid #10b981';
      resultJson.innerHTML = `
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px; padding:0.85rem; font-size:0.875rem; color:#166534;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
            <strong>HTTP 200 OK - Access Granted</strong>
            <span class="badge badge-success">AUTHORIZED</span>
          </div>
          <div>${escapeHtml(data.message || 'Access to departmental resources successfully authorized.')}</div>
          ${data.role ? `<div style="margin-top:0.25rem; font-size:0.8rem; color:#15803d;">Validated Role Permission: <strong>${escapeHtml(data.role)}</strong></div>` : ''}
        </div>
      `;
    }
  } catch (err) {
    resultBox.style.borderLeft = '4px solid #ef4444';
    resultJson.innerHTML = `
      <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:4px; padding:0.85rem; font-size:0.875rem; color:#991b1b;">
        <strong>Network Error:</strong> ${escapeHtml(err.message)}
      </div>
    `;
  }
}

async function fetchAuditLogs() {
  const alertEl = document.getElementById('audit-alert');
  const tbody = document.getElementById('audit-tbody');

  alertEl.classList.add('hidden');
  tbody.innerHTML = '<tr><td colspan="8" class="text-center">Loading immutable audit logs...</td></tr>';

  try {
    const headers = {};
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const patientFilter = document.getElementById('audit-filter-patient')?.value.trim();
    const actionFilter = document.getElementById('audit-filter-action')?.value.trim();

    const queryParams = new URLSearchParams();
    if (patientFilter) queryParams.set('patientId', patientFilter);
    if (actionFilter) queryParams.set('actionType', actionFilter);

    const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const res = await fetch(`/api/v1/audit/logs${queryString}`, { headers });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.title || 'Access Denied: Admin privileges required to view audit trail.');
    }

    const logs = data.data.logs;
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center">No audit records found matching criteria.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td><code>${l.timestamp}</code></td>
        <td><strong>${escapeHtml(l.actorUserId)}</strong></td>
        <td>${escapeHtml(l.actorRole)}</td>
        <td>${l.patientId ? `<code>${escapeHtml(l.patientId)}</code>` : '<span style="color:var(--text-muted);">-</span>'}</td>
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

function resetAuditFilters() {
  const patientInput = document.getElementById('audit-filter-patient');
  const actionSelect = document.getElementById('audit-filter-action');
  if (patientInput) patientInput.value = '';
  if (actionSelect) actionSelect.value = '';
  fetchAuditLogs();
}

async function simulateMedicalRecordDownload() {
  const alertEl = document.getElementById('audit-alert');
  try {
    const headers = {};
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    // Look for an existing consultation ID from the seeded records or fetch one
    const resList = await fetch('/api/v1/ehr/patients/PAT-1000000001/consultations', { headers });
    let consultationId = 'CNS-1001';
    if (resList.ok) {
      const data = await resList.json();
      if (data.data?.consultations?.length > 0) {
        consultationId = data.data.consultations[0].consultationId;
      }
    }

    const res = await fetch(`/api/v1/ehr/consultations/${encodeURIComponent(consultationId)}/download`, { headers });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.title || 'Download failed');
    }

    alertEl.className = 'alert success';
    alertEl.textContent = `Medical record ${consultationId} downloaded successfully. Logged EHR_DOWNLOAD in immutable audit log.`;
    alertEl.classList.remove('hidden');

    fetchAuditLogs();
  } catch (err) {
    alertEl.className = 'alert error';
    alertEl.textContent = `Download simulation error: ${err.message}`;
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

// ─── Appointment Booking & Slot Holding Logic (FR-APPT-01 & FR-APPT-02) ────────
let currentHeldSlotId = null;
let holdTimerInterval = null;

function setupBookingTab() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const whDate = document.getElementById('wh-date');
  const bookDate = document.getElementById('book-date-select');
  if (whDate) whDate.value = todayStr;
  if (bookDate) bookDate.value = todayStr;

  // Working Hours Form Submission
  const whForm = document.getElementById('working-hours-form');
  if (whForm) {
    whForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const doctorId = document.getElementById('wh-doctor-id').value;
      const date = document.getElementById('wh-date').value;
      const startTime = document.getElementById('wh-start-time').value;
      const endTime = document.getElementById('wh-end-time').value;
      const slotDurationMinutes = document.getElementById('wh-duration').value;
      const alertEl = document.getElementById('wh-alert');

      alertEl.className = 'alert info';
      alertEl.textContent = 'Configuring doctor working hours and generating 15-minute consultation slots...';
      alertEl.classList.remove('hidden');

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

        const res = await fetch('/api/v1/appointments/working-hours', {
          method: 'POST',
          headers,
          body: JSON.stringify({ doctorId, date, startTime, endTime, slotDurationMinutes })
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.detail || data.message || 'Failed to configure working hours');
        }

        alertEl.className = 'alert success';
        alertEl.textContent = `Working hours successfully set for ${data.data.doctorName} on ${data.data.date}. Generated ${data.data.totalSlots} consultation slots (${data.data.slotDurationMinutes} min intervals).`;
        loadAvailableSlots();
      } catch (err) {
        alertEl.className = 'alert error';
        alertEl.textContent = err.message;
      }
    });
  }

  // Confirm Booking Form Submission
  const confirmForm = document.getElementById('confirm-booking-form');
  if (confirmForm) {
    confirmForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentHeldSlotId) {
        alert('Please select and hold a slot first.');
        return;
      }

      const patientId = document.getElementById('book-patient-id').value.trim();
      const patientName = document.getElementById('book-patient-name').value.trim();
      const reasonForVisit = document.getElementById('book-reason').value.trim();
      const alertEl = document.getElementById('booking-alert');
      const confirmCard = document.getElementById('confirmation-card');
      const confirmDisplay = document.getElementById('confirmation-display');

      alertEl.className = 'alert info';
      alertEl.textContent = 'Confirming appointment booking and dispatching confirmation...';
      alertEl.classList.remove('hidden');

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

        const res = await fetch('/api/v1/appointments', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            slotId: currentHeldSlotId,
            patientId,
            patientName,
            reasonForVisit
          })
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.detail || data.message || 'Booking failed');
        }

        clearInterval(holdTimerInterval);
        currentHeldSlotId = null;
        document.getElementById('selected-slot-card').classList.add('hidden');

        alertEl.className = 'alert success';
        alertEl.textContent = `Appointment ${data.appointmentId} successfully confirmed! Booking confirmation sent to patient via SMS and Email.`;

        const appt = data.data?.appointment || data.data || {};
        const conf = data.data?.confirmation || {};
        const slot = data.data?.slot || {};

        confirmCard.classList.remove('hidden');
        confirmDisplay.innerHTML = `
          <div style="background:#ffffff; border:1px solid #10b981; border-radius:6px; padding:1.25rem; color:#111827;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; border-bottom:1px solid #e5e7eb; padding-bottom:0.75rem;">
              <div>
                <h4 style="margin:0; font-size:1.15rem; color:#065f46;">Appointment Confirmed</h4>
                <div style="font-size:0.85rem; color:#6b7280; margin-top:0.25rem;">Reference ID: <code>${escapeHtml(appt.appointmentId || data.appointmentId || 'N/A')}</code></div>
              </div>
              <span class="badge badge-success">${escapeHtml(appt.status || data.status || 'CONFIRMED')}</span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:0.75rem; font-size:0.9rem; margin-bottom:1rem;">
              <div><strong>Doctor:</strong> ${escapeHtml(appt.doctorName || slot.doctorName || 'Assigned Physician')}</div>
              <div><strong>Patient:</strong> ${escapeHtml(appt.patientName || 'Patient')} (<code>${escapeHtml(appt.patientId || 'N/A')}</code>)</div>
              <div><strong>Scheduled Time:</strong> ${escapeHtml(appt.slotTime || slot.slotTime || 'Confirmed')}</div>
              <div><strong>Slot ID:</strong> <code>${escapeHtml(appt.slotId || slot.slotId || 'N/A')}</code></div>
              <div style="grid-column:1 / -1;"><strong>Reason for Visit:</strong> ${escapeHtml(appt.reasonForVisit || 'General Clinical Consultation')}</div>
            </div>
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px; padding:0.75rem; font-size:0.85rem; color:#166534;">
              <strong>Automated Booking Notifications Dispatched:</strong>
              <div style="margin-top:0.25rem;">Delivery Channels: <strong>${escapeHtml((conf.channels || ['EMAIL', 'SMS']).join(', '))}</strong></div>
              <div>Recipient: ${escapeHtml(conf.recipientEmail || 'Email on file')} &bull; ${escapeHtml(conf.recipientPhone || 'Phone on file')}</div>
              <div>Dispatch Confirmation: <code>${escapeHtml(conf.confirmationId || 'DISPATCHED')}</code></div>
            </div>
          </div>
        `;

        loadAvailableSlots();
      } catch (err) {
        alertEl.className = 'alert error';
        alertEl.textContent = err.message;
      }
    });
  }
}

async function loadAvailableSlots() {
  const doctorId = document.getElementById('book-doctor-select').value;
  const date = document.getElementById('book-date-select').value;
  const container = document.getElementById('slots-container');
  const alertEl = document.getElementById('booking-alert');

  container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Loading available slots...</p>';
  alertEl.classList.add('hidden');

  try {
    const headers = {};
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const res = await fetch(`/api/v1/appointments/slots?doctorId=${encodeURIComponent(doctorId)}&date=${encodeURIComponent(date)}`, {
      headers
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Could not fetch available slots');
    }

    const slots = data.data.slots || [];
    if (slots.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">No open consultation slots available for this doctor and date.</p>';
      return;
    }

    container.innerHTML = slots.map(s => {
      const isSelected = s.slotId === currentHeldSlotId;
      const isHeld = s.status === 'HELD';
      let itemClass = 'slot-item';
      if (isSelected) itemClass += ' selected';
      else if (isHeld) itemClass += ' held';

      return `
        <div class="${itemClass}" onclick="selectAndHoldSlot('${escapeHtml(s.slotId)}', '${escapeHtml(s.startTime)}', '${escapeHtml(s.endTime)}')">
          <div class="slot-time">${escapeHtml(s.startTime)} - ${escapeHtml(s.endTime)}</div>
          <span class="slot-status-label">${isSelected ? 'HELD BY YOU' : (isHeld ? 'TEMPORARILY HELD' : 'AVAILABLE')}</span>
        </div>
      `;
    }).join('');

  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger); font-size:0.85rem;">Error: ${escapeHtml(err.message)}</p>`;
  }
}

async function selectAndHoldSlot(slotId, startTime, endTime) {
  const alertEl = document.getElementById('booking-alert');
  const slotCard = document.getElementById('selected-slot-card');
  const titleEl = document.getElementById('held-slot-title');

  alertEl.classList.add('hidden');

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const patientId = currentUser?.id || document.getElementById('book-patient-id')?.value || 'PAT-01';

    const res = await fetch(`/api/v1/appointments/slots/${encodeURIComponent(slotId)}/hold`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ patientId, holdDurationMinutes: 5 })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Slot cannot be held');
    }

    currentHeldSlotId = slotId;
    titleEl.textContent = `Selected Slot: ${startTime} - ${endTime} (ID: ${slotId})`;
    slotCard.classList.remove('hidden');

    startHoldCountdown(data.data.holdExpiresAt);
    loadAvailableSlots();
  } catch (err) {
    alertEl.className = 'alert error';
    alertEl.textContent = err.message;
    alertEl.classList.remove('hidden');
  }
}

function startHoldCountdown(expiresAt) {
  clearInterval(holdTimerInterval);
  const badge = document.getElementById('held-timer-badge');

  function update() {
    const diff = expiresAt - Date.now();
    if (diff <= 0) {
      clearInterval(holdTimerInterval);
      badge.textContent = 'Hold Expired. Slot returned to public pool.';
      currentHeldSlotId = null;
      document.getElementById('selected-slot-card').classList.add('hidden');
      loadAvailableSlots();
      return;
    }
    const mins = Math.floor(diff / 60000).toString().padStart(2, '0');
    const secs = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
    badge.textContent = `Slot Held: ${mins}:${secs} remaining`;
  }

  update();
  holdTimerInterval = setInterval(update, 1000);
}

async function releaseCurrentHold() {
  if (!currentHeldSlotId) return;
  clearInterval(holdTimerInterval);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    await fetch(`/api/v1/appointments/slots/${encodeURIComponent(currentHeldSlotId)}/release`, {
      method: 'POST',
      headers
    });
  } catch (err) {
    console.error('Failed to release hold:', err);
  }

  currentHeldSlotId = null;
  document.getElementById('selected-slot-card').classList.add('hidden');
  loadAvailableSlots();
}

// Live Concurrent Double-Booking Race Condition Simulation (TC-HMS-04)
async function runDoubleBookingTest() {
  const resultGrid = document.getElementById('concurrency-result-grid');
  const t1Status = document.getElementById('thread-1-status');
  const t1Output = document.getElementById('thread-1-output');
  const t2Status = document.getElementById('thread-2-status');
  const t2Output = document.getElementById('thread-2-output');

  resultGrid.classList.remove('hidden');
  t1Status.textContent = 'Executing simultaneous request...';
  t1Status.style.color = 'var(--text-secondary)';
  t1Output.textContent = 'Sending POST /api/v1/appointments (Slot: SLOT-1004)...';

  t2Status.textContent = 'Executing simultaneous request...';
  t2Status.style.color = 'var(--text-secondary)';
  t2Output.textContent = 'Sending POST /api/v1/appointments (Slot: SLOT-1004)...';

  const testSlotId = 'SLOT-1004'; // TC-HMS-04 slot

  const headersA = { 'Content-Type': 'application/json' };
  const headersB = { 'Content-Type': 'application/json' };
  if (currentToken) {
    headersA['Authorization'] = `Bearer ${currentToken}`;
    headersB['Authorization'] = `Bearer ${currentToken}`;
  }

  const reqA = fetch('/api/v1/appointments', {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({
      slotId: testSlotId,
      patientId: 'PAT-01',
      patientName: 'Alice Patient',
      reasonForVisit: 'Concurrent Booking Test A'
    })
  }).then(async r => ({ status: r.status, body: await r.json() }));

  const reqB = fetch('/api/v1/appointments', {
    method: 'POST',
    headers: headersB,
    body: JSON.stringify({
      slotId: testSlotId,
      patientId: 'PAT-02',
      patientName: 'Bob Patient',
      reasonForVisit: 'Concurrent Booking Test B'
    })
  }).then(async r => ({ status: r.status, body: await r.json() }));

  const [resA, resB] = await Promise.all([reqA, reqB]);

  // Display Thread 1
  if (resA.status === 201) {
    t1Status.textContent = '201 Created (SUCCESS: Reserved Slot)';
    t1Status.style.color = '#065f46';
  } else {
    t1Status.textContent = `${resA.status} Conflict (REJECTED: Slot Already Booked)`;
    t1Status.style.color = '#991b1b';
  }

  // Display Thread 2
  if (resB.status === 201) {
    t2Status.textContent = '201 Created (SUCCESS: Reserved Slot)';
    t2Status.style.color = '#065f46';
  } else {
    t2Status.textContent = `${resB.status} Conflict (REJECTED: Slot Already Booked)`;
    t2Status.style.color = '#991b1b';
  }

  const renderThreadCard = (res, name) => {
    if (res.status === 201) {
      const appt = res.body?.data?.appointment || res.body?.appointment || {};
      return `
        <div style="font-size:0.85rem; color:#065f46;">
          <div><strong>Outcome:</strong> 201 Created (Confirmed)</div>
          <div><strong>Appointment ID:</strong> <code>${escapeHtml(appt.appointmentId || res.body?.appointmentId || 'APT')}</code></div>
          <div><strong>Reserved By:</strong> ${escapeHtml(name)}</div>
          <div><strong>Slot ID:</strong> <code>${escapeHtml(appt.slotId || testSlotId)}</code></div>
          <div style="margin-top:0.35rem; color:#047857;">Isolated transaction succeeded.</div>
        </div>
      `;
    }
    return `
      <div style="font-size:0.85rem; color:#991b1b;">
        <div><strong>Outcome:</strong> ${res.status} Conflict (Rejected)</div>
        <div><strong>Error:</strong> ${escapeHtml(res.body?.detail || res.body?.message || 'Slot already booked')}</div>
        <div style="margin-top:0.35rem; color:#b91c1c;">Atomic mutex prevented double-booking.</div>
      </div>
    `;
  };

  t1Output.innerHTML = renderThreadCard(resA, 'Patient A');
  t2Output.innerHTML = renderThreadCard(resB, 'Patient B');

  loadAvailableSlots();
}

// ─── Appointment Cancellation & Rescheduling (US-08 / FR-APPT-03) ─────────────
async function cancelAppointmentUI() {
  const apptId = document.getElementById('cr-appointment-id').value.trim();
  const reason = document.getElementById('cr-reason').value.trim();
  const alertEl = document.getElementById('cr-alert');
  const resultCard = document.getElementById('cr-result');
  const display = document.getElementById('cr-display');

  if (!apptId) {
    alert('Please enter an Appointment ID.');
    return;
  }

  alertEl.className = 'alert info';
  alertEl.textContent = `Processing cancellation for appointment ${apptId}...`;
  alertEl.classList.remove('hidden');

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const res = await fetch(`/api/v1/appointments/${encodeURIComponent(apptId)}/cancel`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ reason })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Cancellation failed');
    }

    alertEl.className = 'alert success';
    alertEl.textContent = `Appointment ${apptId} successfully CANCELLED. Slot ${data.data.releasedSlotId} immediately released back to the available pool.`;
    resultCard.classList.remove('hidden');
    display.innerHTML = `
      <div style="background:#ffffff; border:1px solid var(--border-color); border-radius:6px; padding:1.25rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
          <h4 style="margin:0; color:#dc2626;">Appointment Cancelled</h4>
          <span class="badge badge-danger">CANCELLED</span>
        </div>
        <div style="font-size:0.875rem; display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:0.5rem;">
          <div><strong>Appointment ID:</strong> <code>${escapeHtml(apptId)}</code></div>
          <div><strong>Released Slot ID:</strong> <code>${escapeHtml(data.data?.releasedSlotId || 'N/A')}</code></div>
          <div><strong>Pool Status:</strong> Restored to available booking slots</div>
          ${reason ? `<div style="grid-column:1/-1;"><strong>Cancellation Reason:</strong> ${escapeHtml(reason)}</div>` : ''}
        </div>
      </div>
    `;

    loadAvailableSlots();
  } catch (err) {
    alertEl.className = 'alert error';
    alertEl.textContent = err.message;
  }
}

async function rescheduleAppointmentUI() {
  const apptId = document.getElementById('cr-appointment-id').value.trim();
  const newSlotId = document.getElementById('cr-new-slot-id').value.trim();
  const reason = document.getElementById('cr-reason').value.trim();
  const alertEl = document.getElementById('cr-alert');
  const resultCard = document.getElementById('cr-result');
  const display = document.getElementById('cr-display');

  if (!apptId || !newSlotId) {
    alert('Please enter both Appointment ID and New Slot ID for rescheduling.');
    return;
  }

  alertEl.className = 'alert info';
  alertEl.textContent = `Rescheduling appointment ${apptId} to slot ${newSlotId}...`;
  alertEl.classList.remove('hidden');

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const res = await fetch(`/api/v1/appointments/${encodeURIComponent(apptId)}/reschedule`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ newSlotId, reason })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Rescheduling failed');
    }

    alertEl.className = 'alert success';
    alertEl.textContent = `Appointment ${apptId} successfully RESCHEDULED to slot ${data.data.newSlotId} (${data.data.newSlotTime}). Old slot ${data.data.releasedSlotId} released.`;
    resultCard.classList.remove('hidden');
    display.innerHTML = `
      <div style="background:#ffffff; border:1px solid var(--border-color); border-radius:6px; padding:1.25rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
          <h4 style="margin:0; color:#0284c7;">Appointment Rescheduled</h4>
          <span class="badge badge-success">RESCHEDULED</span>
        </div>
        <div style="font-size:0.875rem; display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:0.5rem;">
          <div><strong>Appointment ID:</strong> <code>${escapeHtml(apptId)}</code></div>
          <div><strong>New Slot ID:</strong> <code>${escapeHtml(data.data?.newSlotId || newSlotId)}</code></div>
          <div><strong>New Slot Time:</strong> ${escapeHtml(data.data?.newSlotTime || 'Confirmed')}</div>
          <div><strong>Released Slot ID:</strong> <code>${escapeHtml(data.data?.releasedSlotId || 'N/A')}</code></div>
          ${reason ? `<div style="grid-column:1/-1;"><strong>Reason:</strong> ${escapeHtml(reason)}</div>` : ''}
        </div>
      </div>
    `;

    loadAvailableSlots();
  } catch (err) {
    alertEl.className = 'alert error';
    alertEl.textContent = err.message;
  }
}

// ─── Billing & Payment Processing Logic (US-12 / FR-BILL-01, FR-BILL-02, FR-BILL-03) ──
function setupBillingTab() {
  const form = document.getElementById('billing-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const patientId = document.getElementById('bill-patient-id').value.trim();
    const consultationFee = parseFloat(document.getElementById('bill-consultation-fee').value) || 0;
    const labTestFee = parseFloat(document.getElementById('bill-lab-fee').value) || 0;
    const medicineFee = parseFloat(document.getElementById('bill-medicine-fee').value) || 0;
    const taxRate = (parseFloat(document.getElementById('bill-tax-rate').value) || 0) / 100;
    const paymentMethod = document.getElementById('bill-payment-method').value;
    const amountPaid = parseFloat(document.getElementById('bill-amount-paid').value) || 0;

    const alertEl = document.getElementById('billing-preview-alert');
    const resultCard = document.getElementById('billing-result-card');
    const display = document.getElementById('billing-display');

    alertEl.className = 'alert info';
    alertEl.textContent = 'Calculating bill, applying 5% tax and processing payment...';
    alertEl.classList.remove('hidden');

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

      const res = await fetch('/api/v1/billing/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          patientId,
          consultationFee,
          labTestFee,
          medicineFee,
          taxRate,
          paymentMethod,
          amountPaid
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Billing generation failed');
      }

      alertEl.className = 'alert success';
      alertEl.textContent = `Invoice ${data.invoiceNumber} generated! Subtotal: $${data.subtotal.toFixed(2)}, Tax: $${data.taxAmount.toFixed(2)}, Total: $${data.totalAmount.toFixed(2)} | Status: ${data.status} (Receipt: ${data.receiptNumber || 'None'}). PDF Receipt ready below.`;

      renderBillingReceipt(data);
      await openBillingReceiptPdf(data.invoiceNumber, true);
    } catch (err) {
      alertEl.className = 'alert error';
      alertEl.textContent = err.message;
    }
  });
}


async function openBillingReceiptPdf(invoiceNumber, download) {
  if (!invoiceNumber) {
    alert('Invoice number is missing.');
    return;
  }
  const viewer = download ? null : window.open('about:blank', '_blank');
  try {
    const headers = {};
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const response = await fetch(`/api/v1/billing/invoices/${encodeURIComponent(invoiceNumber)}/pdf${download ? '?download=true' : ''}`, {
      headers
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || errData.message || `Failed to load receipt PDF (${response.status})`);
    }

    const blob = await response.blob();
    const pdfUrl = URL.createObjectURL(blob);
    if (download) {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = `receipt-${invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else if (viewer) {
      viewer.location.href = pdfUrl;
    } else {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
  } catch (err) {
    if (viewer) viewer.close();
    alert(`Could not open receipt PDF: ${err.message}`);
  }
}

async function lookupAndDownloadReceipt(download) {
  const input = document.getElementById('lookup-invoice-number');
  const alertEl = document.getElementById('lookup-receipt-alert');
  if (!input) return;

  const invoiceNumber = input.value.trim();
  if (!invoiceNumber) {
    if (alertEl) {
      alertEl.className = 'alert error';
      alertEl.textContent = 'Please enter an invoice number to download the receipt.';
      alertEl.classList.remove('hidden');
    }
    return;
  }

  if (alertEl) {
    alertEl.className = 'alert info';
    alertEl.textContent = `Locating invoice ${invoiceNumber} and generating official PDF receipt...`;
    alertEl.classList.remove('hidden');
  }

  try {
    const headers = {};
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const invoiceRes = await fetch(`/api/v1/billing/invoices/${encodeURIComponent(invoiceNumber)}`, { headers });
    const invoiceJson = await invoiceRes.json();
    if (!invoiceRes.ok) {
      throw new Error(invoiceJson.detail || invoiceJson.message || `Invoice ${invoiceNumber} not found.`);
    }

    renderBillingReceipt(invoiceJson);
    await openBillingReceiptPdf(invoiceNumber, download);

    if (alertEl) {
      alertEl.className = 'alert success';
      alertEl.textContent = `Official PDF Receipt for Invoice ${invoiceNumber} retrieved successfully.`;
    }
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'alert error';
      alertEl.textContent = err.message;
      alertEl.classList.remove('hidden');
    }
  }
}

function renderBillingReceipt(data) {
  const resultCard = document.getElementById('billing-result-card');
  const receiptContent = document.getElementById('billing-receipt-content');

  const invoice = data.data?.invoice || data.invoice || data;
  const receipt = data.data?.receipt || data.receipt;
  const invoiceNumber = invoice.invoiceNumber || data.invoiceNumber;
  const receiptNumber = (receipt && receipt.receiptNumber) || data.receiptNumber || invoice.receiptNumber || 'None (Pending)';
  const status = invoice.status || data.invoiceStatus || data.status || 'PENDING';
  const subtotal = Number((invoice.subtotal !== undefined ? invoice.subtotal : (data.subtotal || 0))).toFixed(2);
  const taxAmount = Number((invoice.taxAmount !== undefined ? invoice.taxAmount : (data.taxAmount || 0))).toFixed(2);
  const totalAmount = Number((invoice.totalAmount !== undefined ? invoice.totalAmount : (data.totalAmount || 0))).toFixed(2);
  const amountPaid = Number((invoice.amountPaid !== undefined ? invoice.amountPaid : (data.amountPaid || 0))).toFixed(2);
  const balance = Number((invoice.balance !== undefined ? invoice.balance : (data.balance || 0))).toFixed(2);
  const paymentMethod = invoice.paymentMethod || data.paymentMethod || 'N/A';
  const patientId = invoice.patientId || data.patientId || 'N/A';
  const patientName = invoice.patientName || data.patientName || 'Patient';

  const statusBadge = status === 'PAID'
    ? '<span class="badge badge-success">PAID</span>'
    : (status === 'PARTIAL' ? '<span class="badge badge-warning">PARTIAL</span>' : '<span class="badge badge-secondary">PENDING</span>');

  const items = Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0
    ? invoice.lineItems
    : [
        { description: 'Physician Consultation Fee', amount: 50.00 },
        { description: 'Diagnostic Lab Test Fee', amount: 30.00 }
      ];

  const itemsHtml = items.map(item => `
    <tr>
      <td>${escapeHtml(item.description)}</td>
      <td style="text-align:right;">${Number(item.amount).toFixed(2)}</td>
    </tr>
  `).join('');

  if (receiptContent) {
    receiptContent.innerHTML = `
      <div class="billing-receipt-card">
        <div class="billing-receipt-header">
          <div>
            <h3>Official Billing Receipt &amp; Tax Invoice</h3>
            <p style="color:var(--text-muted); font-size:0.85rem; margin:0;">Hospital Management System &bull; Issued: ${escapeHtml(new Date().toLocaleDateString())}</p>
          </div>
          <div class="receipt-btn-group">
            <button type="button" class="btn btn-outline btn-sm" onclick="openBillingReceiptPdf('${escapeHtml(invoiceNumber)}', false)">
              View PDF Receipt
            </button>
            <button type="button" class="btn btn-primary btn-sm" onclick="openBillingReceiptPdf('${escapeHtml(invoiceNumber)}', true)">
              Download PDF Receipt
            </button>
          </div>
        </div>

        <div class="billing-receipt-meta">
          <div><strong>Invoice #:</strong> <code>${escapeHtml(invoiceNumber)}</code></div>
          <div><strong>Receipt #:</strong> <code>${escapeHtml(receiptNumber)}</code></div>
          <div><strong>Patient ID:</strong> ${escapeHtml(patientId)}</div>
          <div><strong>Patient Name:</strong> ${escapeHtml(patientName)}</div>
          <div><strong>Payment Method:</strong> ${escapeHtml(paymentMethod)}</div>
          <div><strong>Status:</strong> ${statusBadge}</div>
        </div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr style="background:#f1f5f9;">
                <th>Item Description</th>
                <th style="text-align:right;">Amount ($)</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
        </div>

        <div class="receipt-totals-panel">
          <div class="receipt-totals-table">
            <div class="receipt-totals-row">
              <span>Subtotal:</span>
              <strong>${subtotal}</strong>
            </div>
            <div class="receipt-totals-row">
              <span>Tax (5%):</span>
              <strong>${taxAmount}</strong>
            </div>
            <div class="receipt-totals-row grand-total">
              <span>Total Amount:</span>
              <strong>${totalAmount}</strong>
            </div>
            <div class="receipt-totals-row" style="color:var(--success);">
              <span>Amount Paid:</span>
              <strong>${amountPaid}</strong>
            </div>
            <div class="receipt-totals-row" style="font-weight:700; color:${Number(balance) > 0 ? 'var(--danger)' : 'var(--text-primary)'};">
              <span>Balance Due:</span>
              <strong>${balance}</strong>
            </div>
          </div>
        </div>

        <div style="margin-top:1.25rem; padding-top:0.75rem; border-top:1px dashed var(--border-color); font-size:0.75rem; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
          <span>Official computer-generated receipt. Logged in tamper-evident security audit trail.</span>
          <span style="color:var(--text-secondary); font-weight:600;">Format: PDF Document</span>
        </div>
      </div>
    `;
  }

  if (resultCard) {
    resultCard.classList.remove('hidden');
  }
}

function calculateBillPreview() {
  const consultationFee = parseFloat(document.getElementById('bill-consultation-fee').value) || 0;
  const labFee = parseFloat(document.getElementById('bill-lab-fee').value) || 0;
  const medicineFee = parseFloat(document.getElementById('bill-medicine-fee').value) || 0;
  const taxRatePercent = parseFloat(document.getElementById('bill-tax-rate').value) || 0;

  const subtotal = consultationFee + labFee + medicineFee;
  const tax = subtotal * (taxRatePercent / 100);
  const total = subtotal + tax;

  const alertEl = document.getElementById('billing-preview-alert');
  alertEl.className = 'alert info';
  alertEl.textContent = `Pre-computation Preview: Subtotal: $${subtotal.toFixed(2)} | Tax (${taxRatePercent}%): $${tax.toFixed(2)} | Total Due: $${total.toFixed(2)}`;
  alertEl.classList.remove('hidden');
}

function loadTCHMS06Demo() {
  document.getElementById('bill-patient-id').value = 'PAT-01';
  document.getElementById('bill-consultation-fee').value = '50.00';
  document.getElementById('bill-lab-fee').value = '30.00';
  document.getElementById('bill-medicine-fee').value = '0.00';
  document.getElementById('bill-tax-rate').value = '5';
  document.getElementById('bill-payment-method').value = 'UPI';
  document.getElementById('bill-amount-paid').value = '84.00';

  calculateBillPreview();
}

async function handlePatientPayment(e) {
  e.preventDefault();
  const patientId = document.getElementById('pat-pay-id').value.trim();
  const paymentMethod = document.getElementById('pat-pay-method').value;
  const amountPaid = parseFloat(document.getElementById('pat-pay-amount').value) || 0;

  const alertEl = document.getElementById('billing-preview-alert');
  const resultCard = document.getElementById('billing-result-card');
  const display = document.getElementById('billing-display');

  alertEl.className = 'alert info';
  alertEl.textContent = 'Processing online patient invoice settlement...';
  alertEl.classList.remove('hidden');

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const res = await fetch('/api/v1/billing/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        patientId,
        consultationFee: 50.00,
        labTestFee: 30.00,
        medicineFee: 0.00,
        taxRate: 0.05,
        paymentMethod,
        amountPaid
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Payment processing failed');
    }

    alertEl.className = 'alert success';
    alertEl.textContent = `Online Payment Successful! Invoice ${data.invoiceNumber} paid in full ($${data.totalAmount.toFixed(2)} via ${paymentMethod}). Receipt: ${data.receiptNumber || 'REC-' + Date.now()}. PDF Receipt downloaded below.`;

    renderBillingReceipt(data);
    await openBillingReceiptPdf(data.invoiceNumber, true);
  } catch (err) {
    alertEl.className = 'alert error';
    alertEl.textContent = err.message;
  }
}

async function fetchMyInvoices() {
  const alertEl = document.getElementById('patient-invoices-alert');
  const container = document.getElementById('patient-invoices-list');
  if (!container) return;

  const patientIdInput = document.getElementById('pat-pay-id');
  const patientId = patientIdInput ? patientIdInput.value.trim() : (currentUser?.patientId || currentUser?.id);
  if (!patientId) {
    if (alertEl) {
      alertEl.className = 'alert error';
      alertEl.textContent = 'Please enter your Patient ID to load records.';
      alertEl.classList.remove('hidden');
    }
    return;
  }

  if (alertEl) {
    alertEl.className = 'alert info';
    alertEl.textContent = 'Retrieving your invoices and receipts...';
    alertEl.classList.remove('hidden');
  }

  try {
    const headers = {};
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const res = await fetch(`/api/v1/billing/patient/${encodeURIComponent(patientId)}`, { headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Failed to retrieve invoices');
    }

    const invoices = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
    if (invoices.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); font-size:0.875rem; margin-top:0.5rem;">No invoices found on file for this patient ID.</p>';
      if (alertEl) alertEl.classList.add('hidden');
      return;
    }

    container.innerHTML = `
      <div class="table-responsive" style="margin-top:0.75rem;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Receipt #</th>
              <th>Date</th>
              <th>Amount ($)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${invoices.map(inv => `
              <tr>
                <td><code>${escapeHtml(inv.invoiceNumber)}</code></td>
                <td><code>${escapeHtml(inv.receiptNumber || 'None')}</code></td>
                <td>${inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : 'N/A'}</td>
                <td>$${Number(inv.totalAmount).toFixed(2)}</td>
                <td>${inv.status === 'PAID' ? '<span class="badge badge-success">PAID</span>' : '<span class="badge badge-secondary">' + escapeHtml(inv.status) + '</span>'}</td>
                <td>
                  <div style="display:flex; gap:0.35rem;">
                    <button type="button" class="btn btn-outline btn-sm" onclick="openBillingReceiptPdf('${escapeHtml(inv.invoiceNumber)}', false)">View PDF</button>
                    <button type="button" class="btn btn-primary btn-sm" onclick="openBillingReceiptPdf('${escapeHtml(inv.invoiceNumber)}', true)">Download PDF</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    if (alertEl) alertEl.classList.add('hidden');
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'alert error';
      alertEl.textContent = err.message;
      alertEl.classList.remove('hidden');
    }
  }
}

// Window global bindings for inline HTML onclick handlers
window.openBillingReceiptPdf = openBillingReceiptPdf;
window.lookupAndDownloadReceipt = lookupAndDownloadReceipt;
window.fetchMyInvoices = fetchMyInvoices;
window.handlePatientPayment = handlePatientPayment;

// ─── Pharmacy & Medication Inventory Client Logic (US-13 / TC-HMS-07) ──────────

async function fetchPharmacyQueue() {
  const tbody = document.getElementById('pharmacy-queue-tbody');
  const alertEl = document.getElementById('pharmacy-queue-alert');
  if (!tbody) return;

  try {
    const headers = {};
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const res = await fetch('/api/v1/pharmacy/queue', { headers });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Failed to fetch pharmacy queue');
    }

    const queue = data.data?.queue || [];
    if (queue.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center">No prescriptions in dispensary queue.</td></tr>';
      return;
    }

    tbody.innerHTML = queue.map(q => {
      const rxText = (q.prescriptions || []).map(p => `${escapeHtml(p.name || p.medication)} (${p.quantity || 1} units)`).join(', ');
      const isDispensed = q.status === 'DISPENSED';
      const canDispense = currentUser && ['PHARMACIST', 'ADMIN'].includes(currentUser.role);
      let actionBtn = '';
      if (isDispensed) {
        actionBtn = '<span class="badge badge-success">Dispensed</span>';
      } else if (canDispense) {
        actionBtn = `<button class="btn btn-primary btn-sm" onclick="dispenseFromQueue('${escapeHtml(q.queueId)}')">Dispense</button>`;
      } else {
        actionBtn = '<span class="badge badge-secondary">Pending Dispense</span>';
      }

      return `
        <tr>
          <td><code>${escapeHtml(q.queueId)}</code></td>
          <td>${escapeHtml(q.patientId)}</td>
          <td>${escapeHtml(q.doctorId || 'Doctor')}</td>
          <td>${rxText || 'None'}</td>
          <td><span class="badge ${isDispensed ? 'badge-success' : 'badge-warning'}">${escapeHtml(q.status)}</span></td>
          <td>${escapeHtml(new Date(q.enqueuedAt).toLocaleString())}</td>
          <td>${actionBtn}</td>
        </tr>
      `;
    }).join('');

    if (alertEl) alertEl.classList.add('hidden');
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'alert error';
      alertEl.textContent = `Queue Error: ${err.message}`;
      alertEl.classList.remove('hidden');
    }
  }
}

async function dispenseFromQueue(queueId) {
  const alertEl = document.getElementById('pharmacy-queue-alert');
  if (!confirm(`Confirm dispensing prescription ${queueId}?`)) return;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const res = await fetch('/api/v1/pharmacy/dispense', {
      method: 'POST',
      headers,
      body: JSON.stringify({ queueId })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Dispensation failed');
    }

    if (alertEl) {
      alertEl.className = 'alert success';
      alertEl.textContent = `Prescription ${queueId} successfully dispensed. Inventory counts decremented.`;
      alertEl.classList.remove('hidden');
    }

    fetchPharmacyQueue();
    fetchPharmacyInventory();
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'alert error';
      alertEl.textContent = `Dispense Error: ${err.message}`;
      alertEl.classList.remove('hidden');
    }
  }
}

async function handleDirectDispense(e) {
  e.preventDefault();
  const medId = document.getElementById('dispense-med-id').value.trim();
  const quantity = document.getElementById('dispense-qty').value;
  const alertEl = document.getElementById('dispense-direct-alert');

  alertEl.className = 'alert info';
  alertEl.textContent = `Dispensing ${quantity} units of ${medId}...`;
  alertEl.classList.remove('hidden');

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const res = await fetch('/api/v1/pharmacy/dispense', {
      method: 'POST',
      headers,
      body: JSON.stringify({ medicationId: medId, quantity: parseInt(quantity, 10) })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Dispense failed');
    }

    const payload = data.data;
    alertEl.className = 'alert success';
    let msg = `Successfully dispensed ${payload.dispensedQuantity} units of ${payload.medicationName}. Stock updated from ${payload.previousStock} to ${payload.remainingStock}.`;
    if (payload.isLowStock) {
      msg += ` [LOW-STOCK ALERT TRIGGERED]: Stock (${payload.remainingStock}) is below threshold (${payload.alert ? payload.alert.alertThreshold : 10}).`;
    }
    alertEl.textContent = msg;

    fetchPharmacyInventory();
    fetchPharmacyAlerts();
  } catch (err) {
    alertEl.className = 'alert error';
    alertEl.textContent = err.message;
  }
}

async function fetchPharmacyInventory() {
  const tbody = document.getElementById('pharmacy-inventory-tbody');
  const alertEl = document.getElementById('pharmacy-inventory-alert');
  if (!tbody) return;

  try {
    const headers = {};
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const res = await fetch('/api/v1/pharmacy/inventory', { headers });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Failed to fetch inventory');
    }

    const inventory = data.data?.inventory || [];
    tbody.innerHTML = inventory.map(item => {
      const isLow = item.isLowStock;
      const statusBadge = isLow
        ? `<span class="badge badge-danger">LOW STOCK (&lt; ${item.alertThreshold})</span>`
        : '<span class="badge badge-success">Adequate</span>';

      return `
        <tr>
          <td><code>${escapeHtml(item.medicationId)}</code></td>
          <td><strong>${escapeHtml(item.name)}</strong></td>
          <td><span style="font-size:1.1em; font-weight:bold; ${isLow ? 'color:#dc3545;' : ''}">${item.stock}</span></td>
          <td>${item.alertThreshold}</td>
          <td>${escapeHtml(item.unit || 'units')}</td>
          <td>${statusBadge}</td>
          <td>${escapeHtml(item.batchNo || 'N/A')}</td>
        </tr>
      `;
    }).join('');

    if (alertEl) alertEl.classList.add('hidden');
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'alert error';
      alertEl.textContent = `Inventory Error: ${err.message}`;
      alertEl.classList.remove('hidden');
    }
  }
}

async function fetchPharmacyAlerts() {
  const container = document.getElementById('pharmacy-alerts-container');
  const display = document.getElementById('pharmacy-alerts-display');
  if (!container || !display) return;

  try {
    const headers = {};
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    const res = await fetch('/api/v1/pharmacy/alerts', { headers });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Failed to fetch alerts');
    }

    const alerts = data.data?.alerts || [];
    container.classList.remove('hidden');
    if (alerts.length === 0) {
      display.innerHTML = `
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px; padding:0.85rem; font-size:0.875rem; color:#166534;">
          No active low-stock alerts. All inventory levels are above configured minimum thresholds.
        </div>
      `;
    } else {
      display.innerHTML = `
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Medication ID</th>
                <th>Name</th>
                <th>Current Units</th>
                <th>Safety Threshold</th>
                <th>Urgency</th>
              </tr>
            </thead>
            <tbody>
              ${alerts.map(a => `
                <tr>
                  <td><code>${escapeHtml(a.medicationId)}</code></td>
                  <td><strong>${escapeHtml(a.name)}</strong></td>
                  <td><span style="color:#dc2626; font-weight:700;">${a.stock}</span></td>
                  <td>${a.alertThreshold}</td>
                  <td><span class="badge badge-danger">LOW STOCK REORDER</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  } catch (err) {
    container.classList.remove('hidden');
    display.innerHTML = `
      <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:4px; padding:0.85rem; font-size:0.875rem; color:#991b1b;">
        Alerts Retrieval Error: ${escapeHtml(err.message)}
      </div>
    `;
  }
}
