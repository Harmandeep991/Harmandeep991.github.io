// Accounts on the website: sign up, log in, password reset, email
// verification and the account page. Talks to the Submit Later API
// (backend/). Loaded only by the account pages; site.js does the rest.

// ---- Settings --------------------------------------------------------------

const ACCOUNT = {
  // The backend's address, e.g. 'https://api.example.com'. While empty, the
  // forms explain that accounts are opening soon instead of failing.
  API_URL: 'https://api.submitlater.co.in',
  // Google Identity Services web client ID. While empty, the Google button
  // is hidden and email sign-up still works.
  GOOGLE_CLIENT_ID: '',
  // Extension IDs that may receive the sign-in: the Chrome Web Store one,
  // and the unpacked copy loaded from ~/submit-later for testing.
  EXTENSION_IDS: ['ofhnlgiipkjicedfmkeppphhjodjbohc', 'pbecnpopmckmengmakceppcpflpkhjba'],
};

// Display only; the server decides the real prices.
const PLANS = {
  monthly: { name: 'Monthly', price: 49, period: '30 days' },
  annual: { name: 'Annual', price: 399, period: '365 days' },
};

// ---- Session ---------------------------------------------------------------

const SESSION_KEY = 'sl-session';

const session = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
    } catch {
      return null;
    }
  },
  set(s) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch {
      // Private window with storage blocked; the session lasts for this page only.
    }
  },
  clear() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
  },
};

class ApiError extends Error {
  constructor(message, { status = 0, code = '', field = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

let refreshing = null;

async function refreshSession() {
  const s = session.get();
  if (!s?.refreshToken) throw new ApiError('Please log in again.', { status: 401 });
  refreshing ||= request('/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } })
    .then((r) => {
      session.set({ ...s, ...r });
      return r;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

async function request(path, { method = 'GET', body, auth = false } = {}) {
  if (!ACCOUNT.API_URL) throw new ApiError('NOT_CONFIGURED', { code: 'NOT_CONFIGURED' });
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Bearer ${session.get()?.accessToken || ''}`;
  let res;
  try {
    res = await fetch(ACCOUNT.API_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("Couldn't reach Submit Later. Check your internet connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || `Something went wrong (${res.status}). Please try again.`, {
      status: res.status,
      code: data.code,
      field: data.field,
    });
  }
  return data;
}

// Authenticated request that renews an expired access token once.
async function api(path, opts = {}) {
  try {
    return await request(path, { ...opts, auth: true });
  } catch (e) {
    if (e.status !== 401 || !session.get()?.refreshToken) throw e;
    try {
      await refreshSession();
    } catch {
      session.clear();
      throw e;
    }
    return request(path, { ...opts, auth: true });
  }
}

// ---- Helpers ---------------------------------------------------------------

const $ = (s, root = document) => root.querySelector(s);
const params = new URLSearchParams(location.search);

const NOT_READY = 'Accounts are opening in the next few days. You can already install the extension from the Chrome Web Store.';

function messageFor(err) {
  return err.code === 'NOT_CONFIGURED' ? NOT_READY : err.message;
}

// Only our own pages, so a crafted link can't send people elsewhere after login.
function safeNext(fallback = 'account.html') {
  const next = params.get('next') || '';
  return /^[a-z-]+\.html(\?[\w=&%-]*)?(#[\w-]*)?$/.test(next) ? next : fallback;
}

// Links between sign-up and login keep where the user is headed.
function carry(page) {
  const keep = new URLSearchParams();
  for (const k of ['next', 'from', 'plan']) if (params.get(k)) keep.set(k, params.get(k));
  return keep.size ? `${page}?${keep}` : page;
}

function notice(el, type, text) {
  el.className = `notice ${type}`;
  el.textContent = text;
  el.hidden = !text;
}

function fieldError(form, name, message) {
  const field = form.querySelector(`[data-field="${name}"]`);
  if (!field) return !message;
  field.classList.toggle('invalid', !!message);
  field.querySelector('.f-err').textContent = message || '';
  return !message;
}

function clearErrors(form) {
  form.querySelectorAll('[data-field]').forEach((f) => {
    f.classList.remove('invalid');
    f.querySelector('.f-err').textContent = '';
  });
}

function setBusy(btn, busy) {
  btn.disabled = busy;
  btn.classList.toggle('busy', busy);
}

// Shows the server's message under the field it's about, or at the top.
function showError(form, box, err) {
  if (err.field && fieldError(form, err.field, err.message) === false) {
    form.querySelector(`[data-field="${err.field}"] input`)?.focus();
    notice(box, 'bad', '');
  } else {
    notice(box, err.code === 'NOT_CONFIGURED' ? 'info' : 'bad', messageFor(err));
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkEmail(form, email) {
  return fieldError(form, 'email', !email ? 'Enter your email address.' : !EMAIL_RE.test(email) ? "That email address doesn't look right." : '');
}

function checkPassword(form, password, name = 'password') {
  return fieldError(form, name, password.length < 8 ? 'Use at least 8 characters.' : '');
}

// Show/hide buttons inside password fields.
function initPasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach((b) => {
    const input = b.parentElement.querySelector('input');
    b.onclick = () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.setAttribute('aria-pressed', show);
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      input.focus();
    };
  });
}

// A rough strength guide; the server only enforces the 8-character minimum.
function initStrength(input, meter) {
  if (!input || !meter) return;
  const words = ['', 'Weak', 'Okay', 'Good', 'Strong'];
  input.addEventListener('input', () => {
    const v = input.value;
    let score = 0;
    if (v.length >= 8) score++;
    if (v.length >= 12) score++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
    if (/\d/.test(v) && /[^\w\s]/.test(v)) score++;
    if (v.length < 8) score = Math.min(score, 1);
    meter.dataset.score = v ? Math.max(1, score) : 0;
    meter.querySelector('.pw-word').textContent = v ? words[Math.max(1, score)] : '';
  });
}

function signedIn(result) {
  session.set({ accessToken: result.accessToken, refreshToken: result.refreshToken, user: result.user });
  const plan = PLANS[params.get('plan')] ? `?buy=${params.get('plan')}` : '';
  location.href = safeNext(params.get('from') === 'extension' ? 'account.html?connect=1' : `account.html${plan}`);
}

// ---- Google sign-in --------------------------------------------------------

function initGoogle(box) {
  const wrap = $('.google-wrap');
  if (!ACCOUNT.GOOGLE_CLIENT_ID || !ACCOUNT.API_URL) {
    wrap?.remove();
    return;
  }
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = () => {
    google.accounts.id.initialize({
      client_id: ACCOUNT.GOOGLE_CLIENT_ID,
      callback: async ({ credential }) => {
        notice(box, 'info', 'Signing you in…');
        try {
          signedIn(await request('/auth/google', { method: 'POST', body: { credential } }));
        } catch (err) {
          notice(box, 'bad', messageFor(err));
        }
      },
    });
    const target = $('#google-btn');
    google.accounts.id.renderButton(target, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: document.body.dataset.page === 'signup' ? 'signup_with' : 'continue_with',
      width: Math.min(400, target.clientWidth || 360),
    });
  };
  s.onerror = () => wrap?.remove();
  document.head.append(s);
}

// ---- Pages -----------------------------------------------------------------

function initSignup() {
  const form = $('#signup-form');
  const box = $('#form-notice');
  const plan = params.get('plan');
  if (PLANS[plan]) {
    $('#plan-note').hidden = false;
    $('#plan-note b').textContent = `${PLANS[plan].name} plan (₹${PLANS[plan].price})`;
  }
  $('#to-login').href = carry('login.html');
  initStrength(form.password, $('.pw-meter'));
  initGoogle(box);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    notice(box, '', '');
    if (form.website.value) return; // bots fill the hidden field
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const ok = [
      fieldError(form, 'name', name ? '' : 'Enter your name.'),
      checkEmail(form, email),
      checkPassword(form, password),
      fieldError(form, 'terms', form.terms.checked ? '' : 'Please accept the terms to continue.'),
    ].every(Boolean);
    if (!ok) return form.querySelector('.invalid input')?.focus();

    const btn = form.querySelector('button[type=submit]');
    setBusy(btn, true);
    try {
      signedIn(await request('/auth/signup', { method: 'POST', body: { name, email, password } }));
    } catch (err) {
      showError(form, box, err);
      setBusy(btn, false);
    }
  });
}

function initLogin() {
  const form = $('#login-form');
  const box = $('#form-notice');
  if (params.get('reset') === '1') notice(box, 'ok', 'Your password has been changed. Log in with the new one.');
  if (params.get('expired') === '1') notice(box, 'info', 'Please log in again to continue.');
  $('#to-signup').href = carry('signup.html');
  initGoogle(box);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    notice(box, '', '');
    const email = form.email.value.trim();
    const password = form.password.value;
    const ok = [checkEmail(form, email), fieldError(form, 'password', password ? '' : 'Enter your password.')].every(Boolean);
    if (!ok) return form.querySelector('.invalid input')?.focus();

    const btn = form.querySelector('button[type=submit]');
    setBusy(btn, true);
    try {
      signedIn(await request('/auth/login', { method: 'POST', body: { email, password } }));
    } catch (err) {
      showError(form, box, err);
      setBusy(btn, false);
    }
  });
}

function initForgot() {
  const form = $('#forgot-form');
  const box = $('#form-notice');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const email = form.email.value.trim();
    if (!checkEmail(form, email)) return form.email.focus();
    const btn = form.querySelector('button[type=submit]');
    setBusy(btn, true);
    try {
      await request('/auth/forgot', { method: 'POST', body: { email } });
      form.hidden = true;
      $('#sent-to').textContent = email;
      $('#forgot-sent').hidden = false;
    } catch (err) {
      showError(form, box, err);
    } finally {
      setBusy(btn, false);
    }
  });
}

function initReset() {
  const form = $('#reset-form');
  const box = $('#form-notice');
  const token = params.get('token');
  if (!token) {
    form.hidden = true;
    notice(box, 'bad', 'This reset link is incomplete. Open the link from your email again, or ask for a new one.');
    return;
  }
  initStrength(form.password, $('.pw-meter'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const password = form.password.value;
    const ok = [
      checkPassword(form, password),
      fieldError(form, 'confirm', form.confirm.value === password ? '' : "The passwords don't match."),
    ].every(Boolean);
    if (!ok) return form.querySelector('.invalid input')?.focus();
    const btn = form.querySelector('button[type=submit]');
    setBusy(btn, true);
    try {
      await request('/auth/reset', { method: 'POST', body: { token, password } });
      session.clear(); // every session is signed out after a reset
      location.href = 'login.html?reset=1';
    } catch (err) {
      showError(form, box, err);
      setBusy(btn, false);
    }
  });
}

async function initVerify() {
  const token = params.get('token');
  const show = (id) => document.querySelectorAll('.verify-state').forEach((el) => (el.hidden = el.id !== id));
  if (!token) return show('verify-bad');
  try {
    await request('/auth/verify', { method: 'POST', body: { token } });
    const s = session.get();
    if (s?.user) session.set({ ...s, user: { ...s.user, emailVerified: true } });
    show('verify-ok');
  } catch (err) {
    $('#verify-bad-msg').textContent = messageFor(err);
    show('verify-bad');
  }
}

// ---- Account dashboard -----------------------------------------------------
// account.html: a sidebar of views (Overview, Plan & billing, Invoices,
// Extension, Profile, Security), switched by the URL hash.

const fmtDate = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const daysLeft = (ms) => Math.max(0, Math.ceil((ms - Date.now()) / 86_400_000));
const PLAN_DAYS = { monthly: 30, annual: 365 };
const RING = 2 * Math.PI * 52;

const acct = { user: null, plan: null, ext: 'checking', extEmail: null };

const VIEWS = ['overview', 'billing', 'invoices', 'extension', 'profile', 'security'];

function showView(name) {
  if (!VIEWS.includes(name)) name = 'overview';
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.dataset.view !== name));
  document.querySelectorAll('.dash-nav [data-view]').forEach((a) => {
    const on = a.dataset.view === name;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('#um-pop').hidden = true;
  $('#um-btn').setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: 0 });
}

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// Everything the views say about the plan, worked out once.
function planInfo(plan) {
  if (plan.status === 'trial') {
    const left = daysLeft(plan.trialEndsAt);
    return {
      status: 'trial',
      label: 'Pro trial',
      value: `${left} ${left === 1 ? 'day' : 'days'} left`,
      sub: `Trial ends on ${fmtDate(plan.trialEndsAt)}`,
      left,
      pct: Math.min(1, left / 30),
      planName: 'Pro trial (every feature)',
      endLabel: 'Trial ends',
      end: fmtDate(plan.trialEndsAt),
    };
  }
  if (plan.status === 'active') {
    const left = daysLeft(plan.paidUntil);
    const name = PLANS[plan.plan]?.name || 'Pro';
    return {
      status: 'active',
      label: `${name} plan`,
      value: `${left} ${left === 1 ? 'day' : 'days'} left`,
      sub: `Active until ${fmtDate(plan.paidUntil)}`,
      left,
      pct: Math.min(1, left / (PLAN_DAYS[plan.plan] || 365)),
      planName: `${name} · ₹${PLANS[plan.plan]?.price ?? ''}`,
      endLabel: 'Active until',
      end: fmtDate(plan.paidUntil),
    };
  }
  // Free plan: a monthly allowance of new schedules.
  const left = Math.max(0, (plan.freeLimit ?? 5) - (plan.freeUsed ?? 0));
  return {
    status: 'free',
    label: 'Free plan',
    value: `${left} of ${plan.freeLimit ?? 5} left`,
    sub: `Schedules this month · resets ${fmtDate(plan.freeResetsAt)}`,
    left,
    pct: left / (plan.freeLimit || 5),
    planName: `Free · ${plan.freeLimit ?? 5} schedules a month`,
    endLabel: 'Resets on',
    end: fmtDate(plan.freeResetsAt),
    unit: left === 1 ? 'schedule left' : 'schedules left',
  };
}

function renderPlan() {
  const p = planInfo(acct.plan);

  // Sidebar card
  const np = $('#nav-plan');
  np.hidden = false;
  np.dataset.status = p.status;
  $('#np-label').textContent = p.label;
  $('#np-title').textContent = p.value;
  $('#np-bar').style.width = `${p.pct * 100}%`;
  $('#np-sub').textContent =
    p.status === 'trial' ? 'Then the free plan, or Pro from ₹49 a month.' : p.status === 'active' ? "Doesn't renew automatically." : 'Go Pro for unlimited, repeats and WhatsApp.';
  $('#np-cta').textContent = p.status === 'active' ? 'Add more time' : p.status === 'trial' ? 'See Pro plans' : 'Go Pro';

  // Overview card
  $('#s-plan-value').textContent = p.value;
  $('#s-plan-sub').textContent = `${p.label} · ${p.sub}`;
  $('#s-plan-bar').classList.toggle('ok', p.status === 'active');
  $('#s-plan-bar').firstElementChild.style.width = `${p.pct * 100}%`;
  $('#s-plan-ic').className = `stat-ic${p.status === 'active' ? ' ok' : p.status === 'free' && !p.left ? ' warn' : ''}`;
  $('#s-plan-link').firstChild.textContent = p.status === 'free' ? 'Go Pro ' : 'Plan & billing ';

  // Billing
  const box = $('#plan-now');
  box.dataset.status = p.status;
  $('#ring-num').textContent = p.left;
  $('#ring-unit').textContent = p.unit || (p.left === 1 ? 'day left' : 'days left');
  requestAnimationFrame(() => ($('#ring-val').style.strokeDashoffset = String(RING * (1 - p.pct))));
  $('#pn-chip').textContent = p.label;
  $('#pn-title').textContent =
    p.status === 'trial' ? "You're on the Pro trial" : p.status === 'active' ? `Your ${p.label} is active` : "You're on the free plan";
  $('#pn-sub').textContent =
    p.status === 'trial'
      ? 'Every Pro feature is included. After the trial you move to the free plan, or buy Pro any time; it starts when your trial ends, so you lose nothing.'
      : p.status === 'active'
        ? "Your plan doesn't renew automatically. We'll email you 3 days before it ends."
        : 'Schedule up to 5 buttons a month for free. Pro adds unlimited schedules, reopen-and-press, repeats, WhatsApp messages and waiting for buttons to be ready.';
  $('#pn-plan').textContent = p.planName;
  $('#pn-end-label').textContent = p.endLabel;
  $('#pn-end').textContent = p.end;
  $('#buy-title').textContent = p.status === 'active' ? 'Add more Pro time' : 'Go Pro';
  $('#buy-sub').textContent =
    p.status === 'free'
      ? 'Unlimited schedules, reopen-and-press, repeats and WhatsApp messages. Pro starts as soon as you pay.'
      : 'Time you buy is added after your current trial or plan, so nothing is wasted.';
}

function renderUser() {
  const u = acct.user;
  const first = u.name.split(' ')[0];
  const initial = (u.name.trim()[0] || u.email[0]).toUpperCase();
  const h = new Date().getHours();
  $('#hello').textContent = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${first}`;
  for (const id of ['#um-av', '#p-av']) $(id).textContent = initial;
  $('#um-name').textContent = first;
  $('#um-full').textContent = u.name;
  $('#um-email').textContent = u.email;
  $('#vb-email').textContent = u.email;
  $('#verify-banner').hidden = u.emailVerified;

  $('#s-acc-value').textContent = u.emailVerified ? 'Verified' : 'Verify email';
  $('#s-acc-sub').textContent = `${u.email} · since ${fmtDate(u.createdAt)}`;
  $('#s-acc-ic').className = `stat-ic${u.emailVerified ? ' ok' : ' warn'}`;

  $('#p-name-big').textContent = u.name;
  $('#p-email-big').textContent = u.email;
  const v = $('#p-verified');
  v.className = `badge-v ${u.emailVerified ? 'ok' : 'warn'}`;
  v.textContent = u.emailVerified ? 'Email verified' : 'Email not verified';
  const f = $('#profile-form');
  f.name.value = u.name;
  f.email.value = u.email;
  f.phone.value = u.phone || '';
  $('#pf-since').value = fmtDate(u.createdAt);

  $('#sec-pw-text').textContent = u.hasPassword
    ? 'You can sign in with your email and password.'
    : 'No password yet. You sign in with Google; add a password to sign in with email too.';
  $('#change-pw').textContent = u.hasPassword ? 'Change password' : 'Add a password';
  $('#sec-g-text').textContent = u.google ? `Signed in with Google as ${u.email}.` : 'Not connected. Use "Continue with Google" on the login page to link it.';
  const g = $('#sec-g-badge');
  g.className = `badge-v ${u.google ? 'ok' : 'off'}`;
  g.textContent = u.google ? 'Connected' : 'Not connected';
  renderChecklist();
}

const EXT_TEXT = {
  checking: { chip: 'Checking', title: 'Looking for the extension…', text: '', value: 'Checking…', sub: '' },
  missing: {
    chip: 'Not installed',
    title: "The extension isn't installed in this browser",
    text: 'Add Submit Later from the Chrome Web Store, then come back here to connect it. (This page can only detect it in Google Chrome on a computer.)',
    value: 'Not installed',
    sub: 'Install it from the Chrome Web Store',
  },
  ready: {
    chip: 'Installed',
    title: 'Connect the extension to this account',
    text: "It's installed but not signed in yet. Connect it so it can use your trial or plan.",
    value: 'Not connected',
    sub: 'Installed · one click to connect',
  },
  other: {
    chip: 'Other account',
    title: 'The extension is signed in to another account',
    text: '',
    value: 'Other account',
    sub: '',
  },
  connected: {
    chip: 'Connected',
    title: 'The extension is connected',
    text: '',
    value: 'Connected',
    sub: '',
  },
};

function renderExt() {
  const s = acct.ext;
  const t = { ...EXT_TEXT[s] };
  if (s === 'connected') {
    t.text = `It's signed in as ${acct.user.email} and uses this account's trial or plan. You can schedule straight away.`;
    t.sub = `Signed in as ${acct.user.email}`;
  }
  if (s === 'other') {
    t.text = `It's signed in as ${acct.extEmail}. Connect it to switch to ${acct.user.email}.`;
    t.sub = `Signed in as ${acct.extEmail}`;
  }
  const hero = $('#ext-hero');
  hero.dataset.state = s;
  $('#ext-chip').textContent = t.chip;
  $('#ext-title').textContent = t.title;
  $('#ext-text').textContent = t.text;
  $('#ext-connect').hidden = !(s === 'ready' || s === 'other');
  $('#ext-connect').lastElementChild.textContent = s === 'other' ? 'Switch to this account' : 'Connect extension';
  $('#ext-install').hidden = s !== 'missing';
  $('#ext-recheck').hidden = s === 'connected' || s === 'checking';

  $('#s-ext-value').textContent = t.value;
  $('#s-ext-sub').textContent = t.sub;
  $('#s-ext-ic').className = `stat-ic${s === 'connected' ? ' ok' : s === 'missing' || s === 'other' ? ' warn' : ''}`;
  $('#nav-ext-dot').hidden = s === 'connected' || s === 'checking';
  renderChecklist();
}

function renderChecklist() {
  if (!acct.user) return;
  const done = {
    account: true,
    install: acct.ext === 'ready' || acct.ext === 'other' || acct.ext === 'connected',
    connect: acct.ext === 'connected',
    verify: acct.user.emailVerified,
  };
  let n = 0;
  for (const [step, ok] of Object.entries(done)) {
    $(`.checklist [data-step="${step}"]`).classList.toggle('done', ok);
    if (ok) n++;
  }
  // "Connect" only makes sense once it's installed.
  $('.checklist [data-step="connect"] .btn').hidden = !done.install;
  const total = Object.keys(done).length;
  $('#cl-count').textContent = n === total ? 'All done' : `${n} of ${total}`;
  $('#cl-count').classList.toggle('done', n === total);
  $('#cl-bar').classList.toggle('ok', n === total);
  $('#cl-bar').firstElementChild.style.width = `${(n / total) * 100}%`;
}

function renderPayments(list) {
  const body = $('#payments tbody');
  $('#payments-empty').hidden = list.length > 0;
  $('#payments').hidden = list.length === 0;
  body.replaceChildren(
    ...list.map((p) => {
      const tr = document.createElement('tr');
      const cells = [
        fmtDate(p.createdAt),
        `${PLANS[p.plan]?.name || p.plan} · ${PLANS[p.plan]?.period || ''}`,
        `₹${p.amount}`,
        p.status === 'success' ? 'Paid' : p.status === 'pending' ? 'Pending' : 'Failed',
        p.txnId || '-',
      ];
      cells.forEach((text, i) => {
        const td = document.createElement('td');
        if (i === 3) {
          const chip = document.createElement('span');
          chip.className = `chip ${p.status}`;
          chip.textContent = text;
          td.append(chip);
        } else {
          td.textContent = text;
        }
        tr.append(td);
      });
      return tr;
    })
  );
}

// PayU's hosted checkout is a plain form POST with fields signed by the server.
function postToPayu({ action, fields }) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

const startCheckout = (plan, phone) => api('/checkout', { method: 'POST', body: phone ? { plan, phone } : { plan } });

async function buy(planId, btn) {
  const box = $('#buy-notice');
  notice(box, '', '');
  setBusy(btn, true);
  try {
    postToPayu(await startCheckout(planId));
  } catch (err) {
    setBusy(btn, false);
    if (err.code === 'PHONE_REQUIRED') return askPhone(planId);
    notice(box, err.code === 'PAYMENTS_OFF' ? 'info' : 'bad', messageFor(err));
  }
}

// PayU needs a mobile number for the receipt; asked once, then remembered.
function askPhone(planId) {
  const dialog = $('#phone-dialog');
  const form = $('#phone-form');
  clearErrors(form);
  $('#phone-plan').textContent = `${PLANS[planId].name} plan · ₹${PLANS[planId].price}`;
  form.onsubmit = async (e) => {
    e.preventDefault();
    clearErrors(form);
    const phone = form.phone.value.trim();
    if (!/^(?:\+?91|0)?[6-9]\d{9}$/.test(phone.replace(/[\s-]/g, ''))) {
      fieldError(form, 'phone', 'Enter a valid 10-digit mobile number.');
      return form.phone.focus();
    }
    const btn = form.querySelector('button[type=submit]');
    setBusy(btn, true);
    try {
      postToPayu(await startCheckout(planId, phone));
    } catch (err) {
      fieldError(form, 'phone', messageFor(err));
      setBusy(btn, false);
    }
  };
  $('#phone-cancel').onclick = () => dialog.close();
  dialog.showModal();
  form.phone.focus();
}

// The extension accepts messages from this site (externally_connectable).
function sendTo(id, msg) {
  return new Promise((resolve) => {
    if (!globalThis.chrome?.runtime?.sendMessage) return resolve(null);
    const timer = setTimeout(() => resolve(null), 1500);
    try {
      chrome.runtime.sendMessage(id, msg, (res) => {
        clearTimeout(timer);
        resolve(chrome.runtime.lastError ? null : res || null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

// The first installed copy that answers (store or testing) gets the messages.
let extensionId = null;
async function toExtension(msg) {
  if (extensionId) return sendTo(extensionId, msg);
  for (const id of ACCOUNT.EXTENSION_IDS) {
    const res = await sendTo(id, msg);
    if (res) {
      extensionId = id;
      return res;
    }
  }
  return null;
}

async function checkExtension() {
  acct.ext = 'checking';
  renderExt();
  const ping = await toExtension({ type: 'ping' });
  if (!ping) acct.ext = 'missing';
  else if (ping.email === acct.user.email) acct.ext = 'connected';
  else if (ping.email) {
    acct.ext = 'other';
    acct.extEmail = ping.email;
  } else acct.ext = 'ready';
  renderExt();
}

async function connectExtension(btn) {
  if (btn) setBusy(btn, true);
  try {
    const { refreshToken } = await api('/auth/extension-session', { method: 'POST' });
    const res = await toExtension({ type: 'signin', refreshToken, user: acct.user });
    if (!res?.ok) throw new Error();
    acct.ext = 'connected';
    renderExt();
    toast('Extension connected. You can close this tab.');
  } catch (err) {
    toast(err instanceof ApiError ? messageFor(err) : "Couldn't reach the extension. Make sure it's installed and turned on.");
  } finally {
    if (btn) setBusy(btn, false);
  }
}

async function logout() {
  const s = session.get();
  await request('/auth/logout', { method: 'POST', body: { refreshToken: s?.refreshToken } }).catch(() => {});
  session.clear();
  location.href = 'login.html';
}

function initAccountUi() {
  // Views
  addEventListener('hashchange', () => showView(location.hash.slice(1)));
  showView(location.hash.slice(1));

  // User menu
  const btn = $('#um-btn');
  const pop = $('#um-pop');
  btn.onclick = (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    btn.setAttribute('aria-expanded', String(!pop.hidden));
  };
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !e.target.closest('.user-menu')) {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    }
  });

  document.querySelectorAll('[data-logout]').forEach((b) => (b.onclick = logout));
  document.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => buy(b.dataset.buy, b)));
  document.querySelectorAll('[data-connect]').forEach((b) => (b.onclick = () => connectExtension(b)));
  $('#ext-recheck').onclick = checkExtension;

  const resend = async (b) => {
    try {
      await api('/auth/resend-verification', { method: 'POST' });
      b.textContent = 'Sent!';
      b.disabled = true;
      toast(`Verification link sent to ${acct.user.email}`);
    } catch (err) {
      toast(messageFor(err));
    }
  };
  $('#resend').onclick = () => resend($('#resend'));
  document.querySelectorAll('[data-resend]').forEach((b) => (b.onclick = () => resend(b)));

  $('#change-pw').onclick = async () => {
    const b = $('#change-pw');
    try {
      await request('/auth/forgot', { method: 'POST', body: { email: acct.user.email } });
      b.textContent = 'Link sent';
      b.disabled = true;
      toast(`We emailed a link to ${acct.user.email} to set your password.`);
    } catch (err) {
      toast(messageFor(err));
    }
  };

  // Profile
  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    clearErrors(form);
    $('#pf-saved').hidden = true;
    const name = form.name.value.trim();
    const phone = form.phone.value.trim();
    const ok = [
      fieldError(form, 'name', name ? '' : 'Enter your name.'),
      fieldError(form, 'phone', !phone || /^(?:\+?91|0)?[6-9]\d{9}$/.test(phone.replace(/[\s-]/g, '')) ? '' : 'Enter a valid 10-digit mobile number.'),
    ].every(Boolean);
    if (!ok) return form.querySelector('.invalid input')?.focus();
    const b = form.querySelector('button[type=submit]');
    setBusy(b, true);
    try {
      const body = { name };
      if (phone) body.phone = phone;
      const { user } = await api('/me', { method: 'PATCH', body });
      acct.user = user;
      session.set({ ...session.get(), user });
      renderUser();
      $('#pf-saved').hidden = false;
      toast('Profile saved');
    } catch (err) {
      if (!(err.field && fieldError(form, err.field, err.message) === false)) toast(messageFor(err));
    } finally {
      setBusy(b, false);
    }
  });

  // Delete account
  const dialog = $('#delete-dialog');
  $('#delete-open').onclick = () => dialog.showModal();
  $('#delete-cancel').onclick = () => dialog.close();
  $('#delete-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.confirm.value.trim().toLowerCase() !== 'delete') {
      fieldError(form, 'confirm', 'Type DELETE to confirm.');
      return;
    }
    const b = form.querySelector('button[type=submit]');
    setBusy(b, true);
    try {
      await api('/me', { method: 'DELETE' });
      session.clear();
      location.href = 'index.html';
    } catch (err) {
      fieldError(form, 'confirm', messageFor(err));
      setBusy(b, false);
    }
  });
}

async function initAccount() {
  if (!session.get()) {
    location.replace(`login.html?next=${encodeURIComponent('account.html' + location.search + location.hash)}`);
    return;
  }
  initAccountUi();
  const box = $('#page-notice');
  const pay = params.get('payment');
  const PAY_MSG = {
    success: ['ok', 'Payment received, thank you! Your plan is active and a receipt is on its way to your inbox.'],
    failed: ['bad', "The payment didn't go through and you haven't been charged. You can try again below."],
    cancelled: ['info', 'Payment cancelled. You can pick a plan whenever you are ready.'],
    pending: ['info', "Your bank is still confirming the payment. Your plan switches on by itself as soon as it does, and we'll email you."],
  };

  let me;
  try {
    me = await api('/me');
  } catch (err) {
    if (err.status === 401) return location.replace('login.html?expired=1&next=account.html');
    notice(box, err.code === 'NOT_CONFIGURED' ? 'info' : 'bad', messageFor(err));
    return;
  }
  acct.user = me.user;
  acct.plan = me.plan;
  session.set({ ...session.get(), user: me.user });
  if (PAY_MSG[pay]) {
    notice(box, ...PAY_MSG[pay]);
    if (!location.hash) showView(pay === 'success' ? 'invoices' : 'billing');
  } else {
    notice(box, '', '');
  }
  renderUser();
  renderPlan();
  renderExt();

  if (PLANS[params.get('buy')] && pay !== 'success') {
    location.hash = 'billing';
    $(`[data-buy="${params.get('buy')}"]`)?.click();
  }

  api('/payments')
    .then(({ payments }) => renderPayments(payments))
    .catch(() => renderPayments([]));

  await checkExtension();
  if (params.get('connect') === '1' && (acct.ext === 'ready' || acct.ext === 'other')) {
    showView('extension');
    connectExtension($('#ext-connect'));
  }
}

// ---- Start -----------------------------------------------------------------

initPasswordToggles();
({
  signup: initSignup,
  login: initLogin,
  forgot: initForgot,
  reset: initReset,
  verify: initVerify,
  account: initAccount,
})[document.body.dataset.page]?.();
