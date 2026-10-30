'use strict';

const API = '/api';
let token = null;
let refreshTok = null;
let currentUser = null;
let currentFormId = null;
let detailCountdownTimer = null;

// ── API ───────────────────────────────────────────────────────────────────────

async function api(method, path, body, retry = true) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401 && retry) {
    const ok = await doRefresh();
    if (ok) return api(method, path, body, false);
    showAuth();
    return null;
  }
  return res;
}

async function doRefresh() {
  if (!refreshTok) return false;
  try {
    const res = await fetch(API + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshTok }),
    });
    if (!res.ok) return false;
    const d = await res.json();
    token = d.token ?? d.accessToken;
    if (d.refreshToken) { refreshTok = d.refreshToken; saveRefresh(refreshTok); }
    return !!token;
  } catch { return false; }
}

function saveRefresh(rt) {
  try { localStorage.setItem('forms_refresh', rt); } catch {}
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function submitLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return toast('Enter email and password', 'err');
  const res = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await res.json();
  if (!res.ok) return toast(d.error || 'Login failed', 'err');
  token = d.token ?? d.accessToken;
  refreshTok = d.refreshToken;
  currentUser = d.user;
  saveRefresh(refreshTok);
  showApp();
}

async function submitSignup() {
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  if (!name || !email || !password) return toast('Fill all fields', 'err');
  if (password.length < 8) return toast('Password must be at least 8 characters', 'err');
  const res = await fetch(API + '/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const d = await res.json();
  if (!res.ok) return toast(d.error || 'Signup failed', 'err');
  token = d.token ?? d.accessToken;
  refreshTok = d.refreshToken;
  currentUser = d.user;
  saveRefresh(refreshTok);
  showApp();
}

function signOut() {
  token = null; refreshTok = null; currentUser = null;
  try { localStorage.removeItem('forms_refresh'); } catch {}
  showAuth();
}

function showForm(which) {
  const login = document.getElementById('form-login');
  const signup = document.getElementById('form-signup');
  if (login) login.style.display = which === 'login' ? '' : 'none';
  if (signup) signup.style.display = which === 'signup' ? '' : 'none';
}

function showAuth() {
  const auth = document.getElementById('auth-screen');
  const app = document.getElementById('app-shell');
  if (auth) auth.style.display = '';
  if (app) app.style.display = 'none';
}

function showApp() {
  const auth = document.getElementById('auth-screen');
  const app = document.getElementById('app-shell');
  if (auth) auth.style.display = 'none';
  if (app) app.style.display = '';
  if (currentUser) {
    const name = currentUser.name || 'User';
    el('sb-uname', name);
    el('sb-uemail', currentUser.email || '');
    el('sb-avatar', name[0].toUpperCase());
    el('sb-plan', (currentUser.plan || 'Free') + ' plan');
  }
  switchView('forms');
}

// ── Views ─────────────────────────────────────────────────────────────────────

function switchView(name, linkEl) {
  document.querySelectorAll('.view').forEach(v => { v.style.display = 'none'; });
  document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  if (view) view.style.display = '';
  const target = linkEl || document.querySelector(`.sb-link[data-view="${name}"]`);
  if (target) target.classList.add('active');
  if (name === 'forms') loadForms();
  if (name === 'settings') loadSettings();
}

// ── Forms list ────────────────────────────────────────────────────────────────

async function loadForms() {
  const res = await api('GET', '/forms');
  if (!res) return;
  const d = await res.json();
  const list = document.getElementById('form-list');
  const empty = document.getElementById('forms-empty');
  const forms = d.forms || [];
  if (!forms.length) {
    if (list) list.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (list) list.innerHTML = forms.map(f => {
    const s = formStatus(f);
    const link = `${location.origin}/f/${f.shortCode}`;
    return `<div class="form-card" onclick="openFormDetail('${f._id}')">
      <div class="fc-main">
        <div class="fc-name">${esc(f.name)}</div>
        <div class="fc-url">${esc(link)}</div>
      </div>
      <div class="fc-right">
        <span class="status-chip ${s.cls}">${s.label}</span>
      </div>
    </div>`;
  }).join('');
}

function formStatus(f) {
  const now = Date.now();
  if (!f.openAt) return { label: 'Draft', cls: 'status-draft' };
  if (now < new Date(f.openAt).getTime()) return { label: 'Upcoming', cls: 'status-upcoming' };
  if (f.closeAt && now > new Date(f.closeAt).getTime()) return { label: 'Closed', cls: 'status-closed' };
  return { label: 'Live', cls: 'status-live' };
}

// ── Create wizard ─────────────────────────────────────────────────────────────

function showCreate() {
  document.querySelectorAll('.wiz-pane').forEach(p => { p.style.display = 'none'; });
  const p1 = document.getElementById('wiz-pane-1');
  if (p1) p1.style.display = '';
  setWizStep(1);
  document.querySelectorAll('.view').forEach(v => { v.style.display = 'none'; });
  const cv = document.getElementById('view-create');
  if (cv) cv.style.display = '';
  document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
}

function cancelCreate() { switchView('forms'); }

function setWizStep(n) {
  [1, 2, 3].forEach(i => {
    const e = document.getElementById('ws-' + i);
    if (!e) return;
    e.classList.remove('wiz-active', 'wiz-done');
    if (i < n) e.classList.add('wiz-done');
    if (i === n) e.classList.add('wiz-active');
  });
}

function wizardStep1Next() {
  const name = (document.getElementById('c-name')?.value || '').trim();
  const url = (document.getElementById('c-url')?.value || '').trim();
  if (!name) return toast('Enter a form name', 'err');
  if (!url.includes('docs.google.com/forms')) return toast('Enter a valid Google Forms URL', 'err');
  document.getElementById('wiz-pane-1').style.display = 'none';
  document.getElementById('wiz-pane-2').style.display = '';
  setWizStep(2);
}

async function wizardStep2Next() {
  const openDate = document.getElementById('c-open-date')?.value;
  const openTime = document.getElementById('c-open-time')?.value;
  const closeDate = document.getElementById('c-close-date')?.value;
  const closeTime = document.getElementById('c-close-time')?.value;
  const tz = document.getElementById('c-tz')?.value || 'Asia/Kolkata';
  const openAt = openDate && openTime ? new Date(`${openDate}T${openTime}`).toISOString() : undefined;
  const closeAt = closeDate && closeTime ? new Date(`${closeDate}T${closeTime}`).toISOString() : undefined;
  if (!openAt) return toast('Set an open date and time', 'err');

  const body = {
    name: document.getElementById('c-name').value.trim(),
    googleFormUrl: document.getElementById('c-url').value.trim(),
    openAt, closeAt, timezone: tz,
  };
  const res = await api('POST', '/forms', body);
  if (!res) return;
  const d = await res.json();
  if (!res.ok) return toast(d.error || 'Failed to create form', 'err');

  const doneCard = document.getElementById('done-form-card');
  if (doneCard) doneCard.innerHTML = `<strong>${esc(d.form.name)}</strong><br>
    <span style="font-size:12px;color:var(--fg2)">${location.origin}/f/${esc(d.form.shortCode)}</span>`;
  document.getElementById('wiz-pane-2').style.display = 'none';
  document.getElementById('wiz-pane-3').style.display = '';
  setWizStep(3);
  toast('Form created', 'ok');
}

function goToFormDetail() {
  switchView('forms');
}

// ── Form detail ───────────────────────────────────────────────────────────────

async function openFormDetail(id) {
  currentFormId = id;
  clearInterval(detailCountdownTimer);
  document.querySelectorAll('.view').forEach(v => { v.style.display = 'none'; });
  document.getElementById('view-detail').style.display = '';

  const res = await api('GET', `/forms/${id}`);
  if (!res) return;
  const { form } = await res.json();
  if (!form) return toast('Form not found', 'err');

  el('detail-name', form.name);
  el('detail-url', `${location.origin}/f/${form.shortCode}`);
  el('detail-google-url', form.googleFormUrl);
  el('detail-views', form.stats?.views ?? 0);

  const s = formStatus(form);
  const chip = document.getElementById('detail-status-chip');
  if (chip) { chip.textContent = s.label; chip.className = `status-chip ${s.cls}`; }

  if (s.cls === 'status-upcoming' && form.openAt) {
    startDetailCountdown(new Date(form.openAt).getTime());
  } else {
    el('detail-countdown', s.label === 'Live' ? 'Open now' : '');
  }
}

function startDetailCountdown(targetMs) {
  function tick() {
    const diff = targetMs - Date.now();
    if (diff <= 0) { el('detail-countdown', 'Opening…'); clearInterval(detailCountdownTimer); return; }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el('detail-countdown', `Opens in ${h}h ${m}m ${s}s`);
  }
  tick();
  detailCountdownTimer = setInterval(tick, 1000);
}

async function copyFormLink() {
  const url = document.getElementById('detail-url')?.textContent;
  if (!url) return;
  try { await navigator.clipboard.writeText(url); toast('Link copied', 'ok'); }
  catch { toast('Copy: ' + url, 'ok'); }
}

async function deleteForm() {
  if (!currentFormId) return;
  if (!confirm('Delete this form? This cannot be undone.')) return;
  const res = await api('DELETE', `/forms/${currentFormId}`);
  if (!res) return;
  if (!res.ok) { const d = await res.json(); return toast(d.error || 'Failed', 'err'); }
  toast('Form deleted', 'ok');
  switchView('forms');
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const res = await api('GET', '/account');
  if (!res) return;
  const d = await res.json();
  const user = d.user || d;
  const nameEl = document.getElementById('s-name');
  const emailEl = document.getElementById('s-email');
  if (nameEl) nameEl.value = user.name || '';
  if (emailEl) emailEl.value = user.email || '';
}

async function saveProfile() {
  const name = (document.getElementById('s-name')?.value || '').trim();
  if (!name) return toast('Enter a name', 'err');
  const res = await api('PATCH', '/account', { name });
  if (!res) return;
  if (!res.ok) { const d = await res.json(); return toast(d.error || 'Failed', 'err'); }
  if (currentUser) currentUser.name = name;
  el('sb-uname', name);
  el('sb-avatar', name[0].toUpperCase());
  toast('Saved', 'ok');
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function el(id, text) {
  const e = document.getElementById(id);
  if (e) e.textContent = text;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function toast(msg, type = 'ok') {
  const e = document.getElementById('toast');
  if (!e) return;
  e.textContent = msg;
  e.className = `toast toast-${type}`;
  e.style.display = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { e.style.display = 'none'; }, 3000);
}

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('signup')) showForm('signup');
  else showForm('login');

  // 1. Try main site session (sl-session)
  try {
    const slSession = JSON.parse(localStorage.getItem('sl-session') || 'null');
    if (slSession?.accessToken && slSession?.refreshToken) {
      token = slSession.accessToken;
      refreshTok = slSession.refreshToken;
      const res = await fetch(API + '/account', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        currentUser = d.user || d;
        showApp();
        return;
      }
      // Access token expired — try refresh
      const ok = await doRefresh();
      if (ok) {
        const res2 = await fetch(API + '/account', { headers: { Authorization: `Bearer ${token}` } });
        if (res2.ok) { const d = await res2.json(); currentUser = d.user || d; showApp(); return; }
      }
    }
  } catch {}

  // 2. Try forms-specific refresh token
  try {
    const stored = localStorage.getItem('forms_refresh');
    if (stored) {
      refreshTok = stored;
      const ok = await doRefresh();
      if (ok) {
        const res = await fetch(API + '/account', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) { const d = await res.json(); currentUser = d.user || d; showApp(); return; }
      }
    }
  } catch {}

  showAuth();
})();
