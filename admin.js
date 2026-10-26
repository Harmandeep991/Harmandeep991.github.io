// Admin panel (admin.html). Uses app.js for the session and the API (api()).
// The server only answers admins (ADMIN_EMAILS); everyone else sees "Not found".
(() => {
  const q = (s, root = document) => root.querySelector(s);
  const qa = (s, root = document) => [...root.querySelectorAll(s)];
  const VIEWS = ['overview', 'users', 'user', 'payments', 'requests', 'installs', 'errors', 'emails', 'audit', 'settings'];
  const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const d = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
  const dt = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '–');
  const ago = (ms) => {
    if (!ms) return '–';
    const s = (Date.now() - ms) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };
  // Builds an element: h('td', { class: 'x' }, 'text', child)
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el[k] = v;
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
    return el;
  }
  const table = (el, head, rows, empty = 'Nothing here yet.') => {
    el.replaceChildren(h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: head.length, class: 'muted' }, empty))));
  };
  const badge = (text, kind = '') => h('span', { class: `badge-v ${kind}` }, text);
  const planBadge = (p) =>
    p.status === 'active' ? badge(`Pro · until ${d(p.paidUntil)}`, 'ok') : p.status === 'trial' ? badge(`Trial · until ${d(p.trialEndsAt)}`, 'warn') : badge(`Free · ${p.freeUsed}/${p.freeLimit} used`, 'off');
  const planName = (p) => (p.plan === 'custom' ? `Custom · ${p.days} days` : p.plan === 'comp' ? 'Complimentary' : p.plan);
  const STATUS = { success: ['Paid', 'ok'], pending: ['Pending', 'warn'], failed: ['Failed', 'bad'], cancelled: ['Cancelled', 'off'], abandoned: ['Abandoned', 'off'] };

  function stats(el, items) {
    el.replaceChildren(
      ...items.map(([label, value, sub]) =>
        h('div', { class: 'card stat' }, h('div', { class: 'stat-label' }, label), h('div', {}, h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'stat-sub' }, sub) : null))
      )
    );
  }

  // A small bar chart (inline SVG), one bar per day; two series side by side.
  function chart(el, series, keys, fmt = (v) => v) {
    const W = 600, H = 170, pad = 22;
    const max = Math.max(1, ...series.flatMap((s) => keys.map((k) => s[k.key])));
    const bw = (W - pad) / series.length;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H + 20}`);
    svg.setAttribute('class', 'adm-svg');
    const ns = (tag, a) => {
      const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(a)) e.setAttribute(k, v);
      return e;
    };
    svg.append(ns('line', { x1: pad, x2: W, y1: H, y2: H, class: 'axis' }));
    const text = (a, t) => {
      const e = ns('text', a);
      e.textContent = t;
      svg.append(e);
    };
    text({ x: 0, y: 10, class: 'lbl' }, fmt(max));
    series.forEach((s, i) => {
      keys.forEach((k, j) => {
        const v = s[k.key];
        const bh = (v / max) * (H - 14);
        const w = (bw - 3) / keys.length;
        const rect = ns('rect', { x: pad + i * bw + j * w, y: H - bh, width: Math.max(1, w), height: bh, rx: 2, class: k.cls });
        const t = ns('title', {});
        t.textContent = `${s.day}: ${k.label} ${fmt(v)}`;
        rect.append(t);
        svg.append(rect);
      });
      if (i % 7 === 0) text({ x: pad + i * bw, y: H + 15, class: 'lbl' }, s.day.slice(5));
    });
    const legend = keys.length > 1 ? h('div', { class: 'adm-legend' }, keys.map((k) => h('span', {}, h('i', { class: k.cls }), k.label))) : null;
    el.replaceChildren(svg, legend || '');
  }

  // ---- Views ---------------------------------------------------------------------
  const load = {
    async overview() {
      const o = await api('/admin/overview');
      stats(q('#ov-stats'), [
        ['Users', o.users.total.toLocaleString('en-IN'), `+${o.users.d1} today · +${o.users.d7} this week`],
        ['Paying', o.users.paying, `${o.conversion}% of all users`],
        ['On trial', o.users.trials, `${o.users.free} on the free plan`],
        ['Revenue, 30 days', inr(o.revenue.month), `${o.revenue.monthCount} payments · ${inr(o.revenue.all)} all time`],
        ['Open requests', o.openRequests, h('a', { href: '#requests' }, 'Answer them →')],
        ['Active installs', o.installs.active7, `seen this week · ${o.errors7} errors reported`],
      ]);
      chart(q('#ov-signups'), o.series, [{ key: 'signups', label: 'Sign-ups', cls: 'b1' }]);
      chart(q('#ov-revenue'), o.series, [{ key: 'revenue', label: 'Revenue', cls: 'b2' }], inr);
      table(q('#ov-expiring'), ['User', 'Plan', ''], o.expiring.map((u) => h('tr', {}, h('td', {}, h('b', {}, u.name), h('br'), h('small', { class: 'muted' }, u.email)), h('td', {}, planBadge(u.plan)), h('td', {}, h('a', { href: `#user/${u.id}` }, 'Open →')))), 'Nothing ends soon.');
      setReqBadge(o.openRequests);
    },

    async users() {
      const params = new URLSearchParams({ q: q('#u-q').value, status: q('#u-status').value, page: state.page });
      const r = await api(`/admin/users?${params}`);
      q('#u-count').textContent = `${r.count.toLocaleString('en-IN')} users`;
      q('#u-prev').disabled = state.page === 0;
      q('#u-next').disabled = (state.page + 1) * 50 >= r.count;
      table(
        q('#u-table'),
        ['User', 'Plan', 'Email', 'Extension', 'Joined', ''],
        r.users.map((u) =>
          h('tr', {},
            h('td', {}, h('b', {}, u.name), h('br'), h('small', { class: 'muted' }, u.email)),
            h('td', {}, planBadge(u.plan)),
            h('td', {}, u.emailVerified ? badge('Verified', 'ok') : badge('Not verified', 'off')),
            h('td', {}, u.extension ? badge('Connected', 'ok') : badge('–', 'off')),
            h('td', {}, d(u.createdAt)),
            h('td', {}, h('a', { href: `#user/${u.id}` }, 'Open →'))
          )
        ),
        'No users match.'
      );
    },

    async user(id) {
      const r = await api(`/admin/users/${id}`);
      state.user = r.user;
      const u = r.user;
      q('#ud-name').textContent = u.name;
      q('#ud-sub').replaceChildren(`${u.email} · joined ${d(u.createdAt)} · `, u.emailVerified ? 'verified' : 'not verified', u.phone ? ` · ${u.phone}` : '');
      const paid = r.payments.filter((p) => p.status === 'success');
      stats(q('#ud-stats'), [
        ['Plan', planBadge(u.plan)],
        ['Paid in total', inr(paid.reduce((s, p) => s + p.amount, 0)), `${paid.length} payments`],
        ['This month', `${u.plan.freeUsed} of ${u.plan.freeLimit}`, 'free schedules used'],
        ['Extension', u.extension ? 'Connected' : 'Not connected', `${r.sessions.length} active sign-ins`],
      ]);
      table(q('#ud-pay'), ['Transaction', 'Plan', 'Amount', 'Status', 'Date'], r.payments.map((p) => h('tr', {}, h('td', {}, p.txnId), h('td', {}, planName(p)), h('td', {}, inr(p.amount)), h('td', {}, badge(...(STATUS[p.status] || [p.status]))), h('td', {}, dt(p.createdAt)))), 'No payments.');
      const OFFER = { open: ['Waiting for payment', 'warn'], paid: ['Paid', 'ok'], cancelled: ['Cancelled', 'off'] };
      table(
        q('#ud-offers'),
        ['Offer', 'Price', 'Status', 'Made', ''],
        (r.offers || []).map((o) => {
          const expired = o.status === 'open' && o.expiresAt < Date.now();
          const cancel = o.status === 'open' && !expired
            ? h('button', { type: 'button', class: 'btn sm soft', onclick: (e) => window.confirm('Cancel this offer? The customer can no longer pay it.') && act(e.target, () => api(`/admin/offers/${o.id}`, { method: 'DELETE' }), 'Offer cancelled', () => load.user(state.user.id)) }, 'Cancel')
            : null;
          return h('tr', {},
            h('td', {}, `${o.days} days`, o.note ? h('br') : null, o.note ? h('small', { class: 'muted' }, o.note) : null),
            h('td', {}, inr(o.amount)),
            h('td', {}, expired ? badge('Expired', 'off') : badge(...(OFFER[o.status] || [o.status]))),
            h('td', {}, d(o.createdAt)),
            h('td', {}, cancel));
        }),
        'No custom offers yet.'
      );
      q('#ud-req').replaceChildren(...(r.requests.length ? r.requests.map((x) => h('p', {}, h('b', {}, x.kind), ` · ${x.status} · ${d(x.createdAt)}`, h('br'), h('small', { class: 'muted' }, x.message))) : [h('p', { class: 'muted' }, 'No requests.')]));
      table(q('#ud-mail'), ['Email', 'Sent', ''], r.emails.map((m) => h('tr', {}, h('td', {}, m.subject), h('td', {}, dt(m.at)), h('td', {}, m.ok ? badge('Sent', 'ok') : badge('Failed', 'bad')))), 'No emails logged yet.');
      table(q('#ud-sess'), ['Where', 'Signed in', 'Last used'], r.sessions.map((s) => h('tr', {}, h('td', {}, s.kind === 'extension' ? 'Extension' : 'Website', h('br'), h('small', { class: 'muted' }, (s.userAgent || '').slice(0, 70))), h('td', {}, dt(s.createdAt)), h('td', {}, ago(s.lastUsedAt)))), 'Not signed in anywhere.');
    },

    async payments() {
      const params = new URLSearchParams({ status: q('#p-status').value, from: q('#p-from').value, to: q('#p-to').value });
      const r = await api(`/admin/payments?${params}`);
      q('#p-total').textContent = `${r.count} paid · ${inr(r.total)}${r.matching > r.shown ? ` · showing the latest ${r.shown} of ${r.matching} (export has all)` : ''}`;
      table(
        q('#p-table'),
        ['Transaction', 'Customer', 'Plan', 'Amount', 'Status', 'Mode', 'Created', ''],
        r.payments.map((p) => {
          const recheck = p.status === 'pending' || p.status === 'abandoned' || p.status === 'failed'
            ? h('button', { type: 'button', class: 'btn sm soft', onclick: (e) => act(e.target, () => api(`/admin/payments/${p.txnId}/recheck`, { method: 'POST' }), (o) => `${p.provider === 'cashfree' ? 'Cashfree' : 'PayU'} says: ${o.status}${o.changed ? ' (updated)' : ''}`, load.payments) }, 'Re-check')
            : null;
          return h('tr', {},
            h('td', {}, p.txnId, p.reason ? h('br') : null, p.reason ? h('small', { class: 'muted' }, p.reason) : null),
            h('td', {}, p.userId ? h('a', { href: `#user/${p.userId}` }, p.email) : p.email),
            h('td', {}, planName(p), h('br'), h('small', { class: 'muted' }, p.provider === 'cashfree' ? 'Cashfree' : 'PayU')), h('td', {}, inr(p.amount)), h('td', {}, badge(...(STATUS[p.status] || [p.status]))), h('td', {}, p.mode || '–'), h('td', {}, dt(p.createdAt)), h('td', {}, recheck));
        }),
        'No payments yet.'
      );
    },

    async requests() {
      const r = await api(`/admin/requests?status=${q('#r-status').value}`);
      if (q('#r-status').value === 'open') setReqBadge(r.requests.length);
      q('#r-list').replaceChildren(
        ...(r.requests.length
          ? r.requests.map((x) => {
              const reply = h('textarea', { rows: 2, placeholder: 'Reply the customer will see on their account page' });
              reply.value = x.reply;
              const note = h('input', { placeholder: 'Private note (optional)' });
              const save = (status) => act(null, () => api(`/admin/requests/${x.id}`, { method: 'PATCH', body: { status, reply: reply.value, note: note.value } }), () => (status === 'done' ? 'Marked done' : 'Saved'), load.requests);
              return h('div', { class: 'card adm-req' },
                h('div', { class: 'adm-req-top' }, h('b', {}, x.kindLabel || x.kind), badge(x.status === 'open' ? 'Open' : 'Done', x.status === 'open' ? 'warn' : 'ok'), h('span', { class: 'muted' }, dt(x.createdAt))),
                h('p', {}, h('a', { href: `#user/${x.userId}` }, `${x.name} · ${x.email}`)),
                h('p', { class: 'adm-msg' }, x.message),
                (x.notes || []).length ? h('ul', { class: 'adm-notes' }, x.notes.map((n) => h('li', {}, `${n.text} — ${n.by}, ${dt(new Date(n.at).getTime())}`))) : null,
                reply, note,
                h('div', { class: 'adm-actions' },
                  x.kind === 'extend' ? h('a', { class: 'btn sm soft', href: `#user/${x.userId}` }, 'Extend their plan →') : null,
                  h('button', { type: 'button', class: 'btn sm soft', onclick: () => save(x.status) }, 'Save'),
                  x.status === 'open' ? h('button', { type: 'button', class: 'btn sm primary', onclick: () => save('done') }, 'Mark done') : h('button', { type: 'button', class: 'btn sm soft', onclick: () => save('open') }, 'Reopen')));
            })
          : [h('p', { class: 'muted' }, 'No requests here.')])
      );
    },

    async installs() {
      const r = await api('/admin/installs');
      stats(q('#i-stats'), [
        ['Active today', r.active1], ['Active this week', r.active7], ['Active this month', r.active30],
        ['Ever installed', r.total, `${r.uninstalled} uninstalled`],
      ]);
      chart(q('#i-chart'), r.series, [{ key: 'installs', label: 'Installs', cls: 'b1' }, { key: 'uninstalls', label: 'Uninstalls', cls: 'b3' }]);
      const total = r.versions.reduce((s, v) => s + v.count, 0) || 1;
      q('#i-versions').replaceChildren(...(r.versions.length ? r.versions.map((v) => h('div', { class: 'adm-vrow' }, h('b', {}, v.version), h('span', { class: 'adm-vbar' }, h('i', { style: `width:${(v.count / total) * 100}%` })), h('span', { class: 'muted' }, v.count))) : [h('p', { class: 'muted' }, 'No check-ins yet. They start with extension 0.7.0.')]));
    },

    async errors() {
      const r = await api(`/admin/errors?days=${q('#e-days').value}`);
      table(
        q('#e-table'),
        ['Error', 'Times', 'Installs', 'Versions', 'Sites', 'Last seen'],
        r.errors.map((e) => h('tr', {}, h('td', { class: 'adm-wrap' }, h('b', {}, e.kind), h('br'), h('small', {}, e.message)), h('td', {}, e.count), h('td', {}, e.users), h('td', {}, e.versions.join(', ') || '–'), h('td', { class: 'adm-wrap' }, e.hosts.join(', ') || '–'), h('td', {}, ago(e.last)))),
        'No errors reported. 🎉'
      );
    },

    async emails() {
      const r = await api(`/admin/emails?q=${encodeURIComponent(q('#m-q').value)}&failed=${q('#m-failed').checked ? 1 : 0}`);
      table(q('#m-table'), ['To', 'Subject', 'Sent', 'Result'], r.emails.map((m) => h('tr', {}, h('td', {}, m.to), h('td', { class: 'adm-wrap' }, m.subject), h('td', {}, dt(m.at)), h('td', { class: 'adm-wrap' }, m.ok ? badge('Sent', 'ok') : [badge('Failed', 'bad'), h('br'), h('small', { class: 'muted' }, m.error)]))), 'No emails logged yet.');
    },

    async audit() {
      const r = await api('/admin/audit');
      table(q('#a-table'), ['When', 'Admin', 'Action', 'On', 'Details'], r.audit.map((a) => h('tr', {}, h('td', {}, dt(a.at)), h('td', {}, a.admin), h('td', {}, a.action), h('td', {}, a.target), h('td', { class: 'adm-wrap' }, JSON.stringify(a.details || {})))), 'Nothing changed yet.');
    },

    async settings() {
      const c = await api('/admin/config');
      const yes = (v, good = 'Set') => (v ? badge(good, 'ok') : badge('Not set', 'off'));
      const rows = [
        ['API', c.apiUrl], ['Website', c.webUrl],
        ['Email provider', c.mail.provider], ['Email from', c.mail.from], ['Replies to', c.mail.replyTo], ['Email API key', yes(c.mail.keySet)],
        ['Payments go through', c.payments === 'cashfree' ? 'Cashfree' : 'PayU'],
        ...(c.cashfree ? [['Cashfree mode', badge(c.cashfree.mode === 'live' ? 'Live' : 'Test', c.cashfree.mode === 'live' ? 'ok' : 'warn')], ['Cashfree App ID', yes(c.cashfree.appIdSet)], ['Cashfree secret', yes(c.cashfree.secretSet)]] : []),
        ['PayU mode', badge(c.payu.mode === 'live' ? 'Live' : 'Test', c.payu.mode === 'live' ? 'ok' : 'warn')], ['PayU key', yes(c.payu.keySet)], ['PayU salt', yes(c.payu.saltSet)],
        ['Google sign-in', yes(c.google, 'On')], ['Keep awake (free Render)', yes(c.keepAwake, 'On')], ['Background jobs', yes(c.runJobs, 'On')],
        ['Plans', c.plans.map((p) => `${p.id}: ₹${p.amount} for ${p.days} days`).join(' · ')], ['Free plan', `${c.freeMonthlyLimit} schedules a month`],
        ['Admins', c.admins.join(', ')],
      ];
      q('#s-list').replaceChildren(...rows.map(([k, v]) => h('div', { class: 'adm-kvrow' }, h('span', { class: 'muted' }, k), h('span', {}, v))));
    },
  };

  const state = { page: 0, user: null };

  // Runs an admin action: shows a toast with the result, then reloads the view.
  async function act(btn, fn, okText, after) {
    if (btn) btn.disabled = true;
    try {
      const out = await fn();
      toast(typeof okText === 'function' ? okText(out) : okText);
      await after?.();
    } catch (e) {
      toast(e.message || 'That didn’t work.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  const setReqBadge = (n) => {
    q('#req-badge').hidden = !n;
    q('#req-badge').textContent = n;
  };

  async function show() {
    const [name, arg] = location.hash.slice(1).split('/');
    const view = VIEWS.includes(name) ? name : 'overview';
    qa('.view').forEach((v) => (v.hidden = v.dataset.view !== view));
    qa('.dash-nav [data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === (view === 'user' ? 'users' : view)));
    try {
      await load[view](arg);
      if (view !== 'overview' && view !== 'requests') api('/admin/requests?status=open').then((r) => setReqBadge(r.requests.length)).catch(() => {});
      q('#page-notice').hidden = true;
    } catch (e) {
      q('#page-notice').hidden = false;
      q('#page-notice').className = 'notice bad';
      q('#page-notice').textContent = e.message || 'Couldn’t load this section.';
    }
  }

  function wire() {
    let t;
    q('#u-q').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => ((state.page = 0), load.users()), 300);
    });
    q('#u-status').onchange = () => ((state.page = 0), load.users());
    q('#u-prev').onclick = () => (state.page--, load.users());
    q('#u-next').onclick = () => (state.page++, load.users());
    ['#p-status', '#p-from', '#p-to'].forEach((s) => (q(s).onchange = load.payments));
    q('#p-csv').onclick = async () => {
      // Fetch with the session, then save as a file.
      const params = new URLSearchParams({ status: q('#p-status').value, from: q('#p-from').value, to: q('#p-to').value });
      await api('/admin/me').catch(() => {}); // renews the sign-in if it has expired
      const res = await fetch(`${ACCOUNT.API_URL}/admin/payments.csv?${params}`, { headers: { Authorization: `Bearer ${session.get()?.accessToken}` } });
      if (!res.ok) return toast('Export failed. Reload the page and try again.');
      const a = h('a', { href: URL.createObjectURL(await res.blob()), download: `submit-later-payments-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    q('#r-status').onchange = load.requests;
    q('#e-days').onchange = load.errors;
    q('#m-q').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(load.emails, 300);
    });
    q('#m-failed').onchange = load.emails;
    q('#ud-offer').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const body = { amount: Number(f.amount.value), days: Number(f.days.value), note: f.note.value };
      if (!window.confirm(`Email ${state.user.email} an offer of ₹${body.amount} for ${body.days} days?`)) return;
      act(f.querySelector('button'), () => api(`/admin/users/${state.user.id}/offers`, { method: 'POST', body }), 'Offer sent', () => {
        f.reset();
        load.user(state.user.id);
      });
    });
    q('#ud-extend').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const body = { days: Number(f.days.value), target: f.target.value, note: f.note.value };
      act(f.querySelector('button'), () => api(`/admin/users/${state.user.id}/extend`, { method: 'POST', body }), `Added ${body.days} days`, () => load.user(state.user.id));
    });
    qa('[data-act]').forEach((b) =>
      (b.onclick = () => {
        const id = state.user?.id;
        if (!id) return;
        const a = b.dataset.act;
        if (a === 'delete') {
          const confirm = prompt(`This deletes ${state.user.email} for good. Type their email to confirm:`);
          if (confirm !== state.user.email) return;
          return act(b, () => api(`/admin/users/${id}`, { method: 'DELETE', body: { confirm } }), 'Account deleted', () => (location.hash = 'users'));
        }
        if (a === 'signout' && !window.confirm(`Sign ${state.user.email} out of the website and the extension?`)) return;
        const text = {
          'reset-usage': 'Free usage reset',
          'resend-verification': (o) => (o.already ? 'Already verified' : o.ok ? 'Verification email sent' : 'The email failed (see Emails)'),
          signout: 'Signed out everywhere',
        }[a];
        act(b, () => api(`/admin/users/${id}/${a}`, { method: 'POST' }), text, () => load.user(id));
      })
    );
  }

  async function start() {
    if (!session.get()) {
      location.replace(`login.html?next=${encodeURIComponent('admin.html' + location.hash)}`);
      return;
    }
    try {
      const me = await api('/admin/me');
      q('#adm-who').textContent = me.email;
    } catch (e) {
      q('#page-notice').className = 'notice bad';
      q('#page-notice').textContent = e.status === 401 ? 'Please log in again.' : 'This page isn’t available for your account.';
      if (e.status === 401) location.replace(`login.html?expired=1&next=${encodeURIComponent('admin.html')}`);
      return;
    }
    wire();
    addEventListener('hashchange', show);
    await show();
  }
  start();
})();
