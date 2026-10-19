// Accounts on the website: sign up, log in, password reset, email
// verification and the account page. Talks to the Submit Later API
// (backend/). Loaded only by the account pages; site.js does the rest.

// ---- Settings --------------------------------------------------------------

const ACCOUNT = {
  // The backend's address, e.g. 'https://api.example.com'. While empty, the
  // forms explain that accounts are opening soon instead of failing.
  API_URL: '',
  // Google Identity Services web client ID. While empty, the Google button
  // is hidden and email sign-up still works.
  GOOGLE_CLIENT_ID: '',
  // Chrome Web Store ID of the extension, for handing the sign-in over to it.
  EXTENSION_ID: 'ofhnlgiipkjicedfmkeppphhjodjbohc',
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

// ---- Account page ----------------------------------------------------------

const fmtDate = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const daysLeft = (ms) => Math.max(0, Math.ceil((ms - Date.now()) / 86_400_000));

function renderPlan(plan) {
  const card = $('#plan-card');
  card.dataset.status = plan.status;
  const status = $('#plan-status');
  const title = $('#plan-title');
  const sub = $('#plan-sub');
  const bar = $('#plan-bar');
  if (plan.status === 'trial') {
    const left = daysLeft(plan.trialEndsAt);
    status.textContent = 'Free trial';
    title.textContent = `${left} ${left === 1 ? 'day' : 'days'} left`;
    sub.textContent = `Your trial ends on ${fmtDate(plan.trialEndsAt)}. Every feature is included until then.`;
    bar.hidden = false;
    bar.firstElementChild.style.width = `${Math.min(100, ((30 - left) / 30) * 100)}%`;
    $('#buy-title').textContent = 'Keep it going after your trial';
  } else if (plan.status === 'active') {
    const left = daysLeft(plan.paidUntil);
    status.textContent = `${PLANS[plan.plan]?.name || 'Pro'} plan`;
    title.textContent = `Active until ${fmtDate(plan.paidUntil)}`;
    sub.textContent = `${left} ${left === 1 ? 'day' : 'days'} left. Plans don't renew automatically; we'll email you before it ends.`;
    bar.hidden = true;
    $('#buy-title').textContent = 'Add more time';
  } else {
    status.textContent = plan.paidUntil ? 'Plan ended' : 'Trial ended';
    title.textContent = 'Choose a plan to keep scheduling';
    sub.textContent = 'Your scheduled history is safe. Pick a plan below and you can schedule again straight away.';
    bar.hidden = true;
    $('#buy-title').textContent = 'Choose a plan';
  }
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
function toExtension(msg) {
  return new Promise((resolve) => {
    const send = globalThis.chrome?.runtime?.sendMessage;
    if (!send) return resolve(null);
    const timer = setTimeout(() => resolve(null), 1500);
    try {
      chrome.runtime.sendMessage(ACCOUNT.EXTENSION_ID, msg, (res) => {
        clearTimeout(timer);
        resolve(chrome.runtime.lastError ? null : res || null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

async function connectExtension(user) {
  const state = $('#ext-state');
  const btn = $('#ext-connect');
  setBusy(btn, true);
  try {
    const { refreshToken } = await api('/auth/extension-session', { method: 'POST' });
    const res = await toExtension({ type: 'signin', refreshToken, user });
    if (!res?.ok) throw new Error();
    state.dataset.state = 'connected';
    $('#ext-text').textContent = `Signed in as ${user.email}. You can close this tab and use the extension.`;
    btn.hidden = true;
  } catch (err) {
    $('#ext-text').textContent =
      err instanceof ApiError ? messageFor(err) : "Couldn't reach the extension. Make sure Submit Later is installed and enabled, then try again.";
  } finally {
    setBusy(btn, false);
  }
}

async function initExtensionCard(user) {
  const state = $('#ext-state');
  const ping = await toExtension({ type: 'ping' });
  if (!ping) {
    state.dataset.state = 'missing';
    $('#ext-text').textContent = 'Install Submit Later from the Chrome Web Store, then come back here to connect it.';
    $('#ext-install').hidden = false;
    return;
  }
  if (ping.email === user.email) {
    state.dataset.state = 'connected';
    $('#ext-text').textContent = `Connected. The extension is signed in as ${user.email}.`;
    return;
  }
  state.dataset.state = 'ready';
  $('#ext-text').textContent = 'The extension is installed. Connect it to this account to start scheduling.';
  const btn = $('#ext-connect');
  btn.hidden = false;
  btn.onclick = () => connectExtension(user);
  if (params.get('connect') === '1') connectExtension(user);
}

async function initAccount() {
  if (!session.get()) {
    location.replace(`login.html?next=${encodeURIComponent('account.html' + location.search)}`);
    return;
  }
  const box = $('#page-notice');
  const pay = params.get('payment');
  if (pay === 'success') notice(box, 'ok', 'Payment received, thank you! Your plan is active and a receipt is on its way to your inbox.');
  if (pay === 'failed') notice(box, 'bad', "The payment didn't go through and you haven't been charged. You can try again below.");
  if (pay === 'cancelled') notice(box, 'info', 'Payment cancelled. You can pick a plan whenever you are ready.');
  if (pay === 'pending') notice(box, 'info', "Your bank is still confirming the payment. Your plan switches on by itself as soon as it does, and we'll email you.");

  let me;
  try {
    me = await api('/me');
  } catch (err) {
    if (err.status === 401) return location.replace('login.html?expired=1&next=account.html');
    notice(box, err.code === 'NOT_CONFIGURED' ? 'info' : 'bad', messageFor(err));
    $('#account-main').hidden = true;
    return;
  }
  const { user, plan } = me;
  session.set({ ...session.get(), user });
  if (!pay) notice(box, '', '');
  $('#account-main').hidden = false;
  $('#hello').textContent = `Hi, ${user.name.split(' ')[0]}`;
  $('#p-name').textContent = user.name;
  $('#p-email').textContent = user.email;
  $('#p-since').textContent = fmtDate(user.createdAt);
  $('#verify-banner').hidden = user.emailVerified;
  $('#resend').onclick = async () => {
    try {
      await api('/auth/resend-verification', { method: 'POST' });
      $('#resend').textContent = 'Sent! Check your inbox';
      $('#resend').disabled = true;
    } catch (err) {
      notice(box, 'bad', messageFor(err));
    }
  };
  renderPlan(plan);

  document.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => buy(b.dataset.buy, b)));
  if (PLANS[params.get('buy')] && pay !== 'success') $(`[data-buy="${params.get('buy')}"]`)?.click();

  api('/payments')
    .then(({ payments }) => renderPayments(payments))
    .catch(() => renderPayments([]));
  initExtensionCard(user);

  $('#logout').onclick = async () => {
    const s = session.get();
    await request('/auth/logout', { method: 'POST', body: { refreshToken: s?.refreshToken } }).catch(() => {});
    session.clear();
    location.href = 'login.html';
  };
  $('#change-pw').onclick = async () => {
    try {
      await request('/auth/forgot', { method: 'POST', body: { email: user.email } });
      $('#change-pw').textContent = 'Reset link sent to your email';
      $('#change-pw').disabled = true;
    } catch (err) {
      notice(box, 'bad', messageFor(err));
    }
  };

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
    const btn = form.querySelector('button[type=submit]');
    setBusy(btn, true);
    try {
      await api('/me', { method: 'DELETE' });
      session.clear();
      location.href = 'index.html';
    } catch (err) {
      fieldError(form, 'confirm', messageFor(err));
      setBusy(btn, false);
    }
  });
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
