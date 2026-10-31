/* Scheduler dashboard SPA */
'use strict';

const API = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://localhost:8080'
  : 'https://api.submitlater.co.in';
let token = null;
let currentUser = null;
let currentJobId = null;
let newJobId = null;
let currentSchedType = 'once';

// ── Auth ──────────────────────────────────────────────────────────────────────

async function api(method, path, body, retry = true) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  };
  let res = await fetch(API + path, opts);
  if (res.status === 401 && retry) {
    const ok = await refreshToken();
    if (ok) return api(method, path, body, false);
    showAuth();
    return null;
  }
  return res;
}

async function refreshToken() {
  try {
    const stored = localStorage.getItem('sched_refresh');
    if (!stored) return false;
    const res = await fetch(API + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored }),
    });
    if (!res.ok) return false;
    const d = await res.json();
    token = d.accessToken;
    if (!token) return false;
    try {
      localStorage.setItem('sched_refresh', d.refreshToken);
      const main = JSON.parse(localStorage.getItem('sl-session'));
      if (main) localStorage.setItem('sl-session', JSON.stringify({ ...main, ...d }));
    } catch {}
    return true;
  } catch {
    return false;
  }
}

async function submitLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return toast('Enter email and password', 'err');
  const res = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await res.json();
  if (!res.ok) return toast(d.error || 'Login failed', 'err');
  token = d.accessToken;
  currentUser = d.user;
  try { localStorage.setItem('sched_refresh', d.refreshToken); } catch {}
  showApp();
}

async function submitSignup() {
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  if (!name || !email || !password) return toast('Fill all fields', 'err');
  if (password.length < 8) return toast('Password must be at least 8 characters', 'err');
  const res = await fetch(API + '/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const d = await res.json();
  if (!res.ok) return toast(d.error || 'Signup failed', 'err');
  token = d.accessToken;
  currentUser = d.user;
  try { localStorage.setItem('sched_refresh', d.refreshToken); } catch {}
  showApp();
}

function signOut() {
  token = null;
  currentUser = null;
  try { localStorage.removeItem('sched_refresh'); } catch {}
  showAuth();
}

function showForm(which) {
  document.getElementById('form-login').style.display = which === 'login' ? '' : 'none';
  document.getElementById('form-signup').style.display = which === 'signup' ? '' : 'none';
}

function showAuth() {
  document.getElementById('auth-screen').style.display = '';
  document.getElementById('app-shell').style.display = 'none';
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = '';
  if (currentUser) {
    document.getElementById('sb-uname').textContent = currentUser.name || 'User';
    document.getElementById('sb-uemail').textContent = currentUser.email || '';
    document.getElementById('sb-avatar').textContent = (currentUser.name || 'U')[0].toUpperCase();
    document.getElementById('sb-plan').textContent = (currentUser.plan || 'Free') + ' plan';
  }
  api('GET', '/scheduler/usage').then(async res => {
    if (!res?.ok) return;
    const usage = await res.json();
    const name = usage.plan?.name || 'free';
    document.getElementById('sb-plan').textContent = (name === 'trial' ? 'Trial' : name.replace(/^scheduler-/, 'Scheduler ')) + ' plan';
  }).catch(() => {});
  switchView('jobs');
}

// ── Views ─────────────────────────────────────────────────────────────────────

function switchView(name, linkEl) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  if (view) view.style.display = '';
  if (linkEl) linkEl.classList.add('active');
  else {
    const matching = document.querySelector(`.sb-link[data-view="${name}"]`);
    if (matching) matching.classList.add('active');
  }
  if (name === 'jobs') loadJobs();
  if (name === 'logs') loadGlobalLogs();
  if (name === 'settings') loadSettings();
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

async function loadJobs() {
  const res = await api('GET', '/scheduler/jobs');
  if (!res) return;
  const { jobs } = await res.json();
  const list = document.getElementById('job-list');
  const empty = document.getElementById('jobs-empty');
  if (!jobs || jobs.length === 0) {
    list.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  list.innerHTML = jobs.map(j => `
    <div class="job-card" onclick="openJobDetail('${j._id}')">
      <span class="jc-method jc-${(j.method||'post').toLowerCase()}">${j.method || 'POST'}</span>
      <div class="jc-main">
        <div class="jc-name">${esc(j.name)}</div>
        <div class="jc-url">${esc(j.url)}</div>
      </div>
      <div class="jc-right">
        <span class="status-chip status-${j.status || 'active'}">${j.status || 'active'}</span>
        <span class="jc-schedule">${schedLabel(j.schedule)}</span>
      </div>
    </div>
  `).join('');
}

function schedLabel(s) {
  if (!s) return '—';
  if (s.type === 'once') return 'Once · ' + (s.runAt ? new Date(s.runAt).toLocaleDateString() : '—');
  if (s.type === 'daily') return `Daily ${s.clockTime || ''}`;
  if (s.type === 'weekly') return `Weekly ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][s.dayOfWeek] || ''}`;
  if (s.type === 'interval') return `Every ${s.intervalMinutes >= 60 ? (s.intervalMinutes / 60) + 'h' : s.intervalMinutes + 'm'}`;
  return '—';
}

// ── Create wizard ─────────────────────────────────────────────────────────────

function showCreate() {
  document.querySelectorAll('.wiz-pane').forEach(p => p.style.display = 'none');
  document.getElementById('wiz-pane-1').style.display = '';
  setWizStep(1);
  document.getElementById('view-jobs').style.display = 'none';
  document.getElementById('view-create').style.display = '';
  document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
}

function cancelCreate() { switchView('jobs'); }

function setWizStep(n) {
  [1, 2, 3].forEach(i => {
    const el = document.getElementById('ws-' + i);
    if (!el) return;
    el.classList.remove('wiz-active', 'wiz-done');
    if (i < n) el.classList.add('wiz-done');
    if (i === n) el.classList.add('wiz-active');
  });
}

function wizBack() {
  document.getElementById('wiz-pane-2').style.display = 'none';
  document.getElementById('wiz-pane-1').style.display = '';
  setWizStep(1);
}

function wizStep1Next() {
  const name = document.getElementById('c-name').value.trim();
  const url = document.getElementById('c-url').value.trim();
  if (!name) return toast('Enter a job name', 'err');
  if (!url || !url.startsWith('https://')) return toast('Enter an HTTPS URL', 'err');
  document.getElementById('wiz-pane-1').style.display = 'none';
  document.getElementById('wiz-pane-2').style.display = '';
  setWizStep(2);
}

function pickSchedType(btn, type) {
  document.querySelectorAll('.stt-btn').forEach(b => b.classList.remove('stt-active'));
  btn.classList.add('stt-active');
  currentSchedType = type;
  ['once', 'daily', 'weekly', 'interval'].forEach(t => {
    const el = document.getElementById('sched-' + t);
    if (el) el.style.display = t === type ? '' : 'none';
  });
}

function buildSchedule() {
  if (currentSchedType === 'once') {
    const date = document.getElementById('c-once-date').value;
    const time = document.getElementById('c-once-time').value;
    const tz = document.getElementById('c-once-tz').value;
    if (!date || !time) return null;
    return { type: 'once', localDate: date, clockTime: time, timezone: tz };
  }
  if (currentSchedType === 'daily') {
    const time = document.getElementById('c-daily-time').value;
    const tz = document.getElementById('c-daily-tz').value;
    if (!time) return null;
    return { type: 'daily', clockTime: time, timezone: tz };
  }
  if (currentSchedType === 'weekly') {
    const day = document.getElementById('c-weekly-day').value;
    const time = document.getElementById('c-weekly-time').value;
    const tz = document.getElementById('c-weekly-tz').value;
    if (!time) return null;
    return { type: 'weekly', dayOfWeek: parseInt(day, 10), clockTime: time, timezone: tz };
  }
  if (currentSchedType === 'interval') {
    const val = parseInt(document.getElementById('c-interval-val').value, 10);
    const unit = document.getElementById('c-interval-unit').value;
    if (!val || val < 1) return null;
    const mins = unit === 'days' ? val * 1440 : (unit === 'hours' ? val * 60 : val);
    return { type: 'interval', intervalMinutes: mins };
  }
  return null;
}

function parseHeaders(raw) {
  if (!raw.trim()) return {};
  const out = {};
  raw.split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx < 0) return;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

async function wizStep2Submit() {
  const schedule = buildSchedule();
  if (!schedule) return toast('Set the schedule', 'err');
  const body = {
    name: document.getElementById('c-name').value.trim(),
    url: document.getElementById('c-url').value.trim(),
    method: document.getElementById('c-method').value,
    headers: parseHeaders(document.getElementById('c-headers').value),
    body: document.getElementById('c-body').value.trim() || undefined,
    schedule,
  };
  const res = await api('POST', '/scheduler/jobs', body);
  if (!res) return;
  const d = await res.json();
  if (!res.ok) return toast(d.error || 'Failed to create job', 'err');
  newJobId = d.job._id;
  document.getElementById('done-job-card').innerHTML = `
    <div style="font-family:var(--mono);font-size:12px;color:var(--fg2)">
      <strong style="color:var(--fg);font-size:14px">${esc(d.job.name)}</strong><br>
      ${esc(d.job.method)} ${esc(d.job.url)}<br>
      <span style="color:var(--accent-2)">${schedLabel(d.job.schedule)}</span>
    </div>
  `;
  document.getElementById('wiz-pane-2').style.display = 'none';
  document.getElementById('wiz-pane-3').style.display = '';
  setWizStep(3);
  toast('Job created', 'ok');
}

function goToJobDetail() {
  if (!newJobId) return switchView('jobs');
  currentJobId = newJobId;
  switchView('jobs');
  openJobDetail(currentJobId);
}

// ── Job detail ────────────────────────────────────────────────────────────────

async function openJobDetail(id) {
  currentJobId = id;
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.getElementById('view-detail').style.display = '';

  const res = await api('GET', `/scheduler/jobs/${id}`);
  if (!res) return;
  const { job } = await res.json();
  if (!job) return toast('Job not found', 'err');

  document.getElementById('detail-name').textContent = job.name;
  document.getElementById('detail-method-url').textContent = `${job.method} ${job.url}`;
  document.getElementById('detail-schedule').textContent = schedLabel(job.schedule);
  document.getElementById('detail-created').textContent = job.createdAt ? new Date(job.createdAt).toLocaleString() : '—';
  document.getElementById('detail-last-run').textContent = job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : 'Never';

  const chip = document.getElementById('detail-status-chip');
  chip.textContent = job.status || 'active';
  chip.className = `status-chip status-${job.status || 'active'}`;

  const btn = document.getElementById('detail-pause-btn');
  btn.textContent = job.status === 'paused' ? 'Resume' : 'Pause';

  const nextEl = document.getElementById('detail-next-run');
  nextEl.textContent = job.nextRunAt ? 'Next run: ' + new Date(job.nextRunAt).toLocaleString() : (job.status === 'completed' ? 'Completed' : '—');

  loadDetailLogs();
}

async function loadDetailLogs() {
  if (!currentJobId) return;
  const res = await api('GET', `/scheduler/jobs/${currentJobId}/logs`);
  if (!res) return;
  const { logs, stats } = await res.json();

  const logsEl = document.getElementById('detail-logs');
  const emptyEl = document.getElementById('detail-logs-empty');

  if (stats) {
    document.getElementById('ds-total').textContent = stats.total || 0;
    document.getElementById('ds-ok').textContent = stats.ok || 0;
    document.getElementById('ds-fail').textContent = stats.fail || 0;
    document.getElementById('ds-avg').textContent = stats.avgMs ? stats.avgMs + 'ms' : '—';
  }

  if (!logs || logs.length === 0) {
    logsEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  logsEl.innerHTML = logs.map(l => logRow(l)).join('');
}

// ── Global logs ───────────────────────────────────────────────────────────────

async function loadGlobalLogs() {
  const jobFilter = document.getElementById('log-filter-job')?.value || '';
  const statusFilter = document.getElementById('log-filter-status')?.value || '';
  let path = '/scheduler/logs?limit=50';
  if (jobFilter) path += `&jobId=${encodeURIComponent(jobFilter)}`;
  if (statusFilter) path += `&status=${statusFilter}`;
  const res = await api('GET', path);
  if (!res) return;
  const { logs } = await res.json();
  const el = document.getElementById('global-logs');
  const empty = document.getElementById('global-logs-empty');
  if (!logs || logs.length === 0) {
    if (el) el.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (el) el.innerHTML = logs.map(l => logRow(l, true)).join('');
}

function logRow(l, showJob = false) {
  const statusCode = l.statusCode;
  const ok = statusCode >= 200 && statusCode < 300;
  const timeout = l.error?.includes('timeout');
  const cls = timeout ? 'lrs-timeout' : (ok ? 'lrs-ok' : 'lrs-err');
  const label = timeout ? 'Timeout' : (statusCode || (l.error ? 'Error' : '—'));
  const time = l.firedAt ? new Date(l.firedAt).toLocaleString() : '—';
  const msg = showJob ? (l.jobName || '—') : (l.error || '—');
  return `
    <div class="log-row">
      <span class="lr-time">${esc(time)}</span>
      <span class="lr-status"><span class="lr-status-chip ${cls}">${label}</span></span>
      <span class="lr-dur">${l.durationMs != null ? l.durationMs + 'ms' : '—'}</span>
      <span class="lr-msg">${esc(msg)}</span>
    </div>
  `;
}

// ── Job actions ───────────────────────────────────────────────────────────────

async function runJobNow() {
  if (!currentJobId) return;
  const res = await api('POST', `/scheduler/jobs/${currentJobId}/run`);
  if (!res) return;
  const d = await res.json();
  if (!res.ok) return toast(d.error || 'Failed to run', 'err');
  toast('Fired — check logs in a moment', 'ok');
  setTimeout(() => loadDetailLogs(), 3000);
}

async function toggleJobPause() {
  if (!currentJobId) return;
  const chip = document.getElementById('detail-status-chip');
  const isPaused = chip.textContent.trim() === 'paused';
  const action = isPaused ? 'resume' : 'pause';
  const res = await api('PATCH', `/scheduler/jobs/${currentJobId}`, { status: isPaused ? 'active' : 'paused' });
  if (!res) return;
  if (!res.ok) { const d = await res.json(); return toast(d.error || 'Failed', 'err'); }
  toast(`Job ${action}d`, 'ok');
  openJobDetail(currentJobId);
}

async function deleteJob() {
  if (!currentJobId) return;
  if (!confirm('Delete this job and all its logs? This cannot be undone.')) return;
  const res = await api('DELETE', `/scheduler/jobs/${currentJobId}`);
  if (!res) return;
  if (!res.ok) { const d = await res.json(); return toast(d.error || 'Failed', 'err'); }
  toast('Job deleted', 'ok');
  switchView('jobs');
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  if (!currentUser) return;
  document.getElementById('s-name').value = currentUser.name || '';
  document.getElementById('s-email').value = currentUser.email || '';

  const res = await api('GET', '/scheduler/usage');
  if (!res) return;
  const d = await res.json();
  const plan = d.plan || {};
  document.getElementById('pic-name').textContent = plan.name || 'Free';
  document.getElementById('pic-jobs').textContent = d.jobCount ?? 0;
  document.getElementById('pic-max-jobs').textContent = plan.maxJobs ?? 5;
  document.getElementById('pic-runs').textContent = d.runsThisMonth ?? 0;
  document.getElementById('pic-max-runs').textContent = plan.maxRunsPerMonth ?? 200;
}

async function saveProfile() {
  const name = document.getElementById('s-name').value.trim();
  if (!name) return toast('Enter a name', 'err');
  const res = await api('PATCH', '/me', { name });
  if (!res) return;
  if (!res.ok) { const d = await res.json(); return toast(d.error || 'Failed', 'err'); }
  if (currentUser) currentUser.name = name;
  document.getElementById('sb-uname').textContent = name;
  document.getElementById('sb-avatar').textContent = name[0].toUpperCase();
  toast('Profile saved', 'ok');
}

async function confirmDeleteAll() {
  if (!confirm('Delete ALL jobs and logs? This cannot be undone.')) return;
  const res = await api('DELETE', '/scheduler/jobs');
  if (!res) return;
  if (!res.ok) { const d = await res.json(); return toast(d.error || 'Failed', 'err'); }
  toast('All jobs deleted', 'ok');
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type}`;
  el.style.display = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ── Init ──────────────────────────────────────────────────────────────────────

(function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('signup')) showForm('signup');

  // 1. Try main-site session (user navigated here from account.html already logged in)
  try {
    const mainSession = JSON.parse(localStorage.getItem('sl-session'));
    if (mainSession?.refreshToken) {
      token = mainSession.accessToken;
      // Store the refresh token under our own key for future reloads
      try { localStorage.setItem('sched_refresh', mainSession.refreshToken); } catch {}
    }
  } catch {}

  // 2. Fall back to our own stored refresh token
  const storedRefresh = (() => {
    try { return localStorage.getItem('sched_refresh'); } catch { return null; }
  })();

  if (token || storedRefresh) {
    refreshToken().then(ok => {
      if (ok && token) {
        api('GET', '/me').then(async res => {
          if (res && res.ok) {
            const d = await res.json();
            currentUser = d.user || d;
            showApp();
          } else { showAuth(); }
        });
      } else { showAuth(); }
    });
  } else {
    showAuth();
  }
})();
