// Colour themes for the website: the same six as the extension (settings.js
// there), plus light / dark / system. Load it in <head> (not deferred) so the
// right colours are set before the page first paints.
//
// The choice is kept in localStorage, and on your account when you're signed
// in (so it follows you to other devices), and is handed to the extension
// from the account page.

/* exported SLTheme */
var SLTheme = (() => {
  const THEMES = {
    indigo: { name: 'Indigo', light: ['#4f46e5', '#7c3aed', '#eef2ff'], dark: ['#818cf8', '#a78bfa', 'rgba(129,140,248,.12)'], brand: ['#4f46e5', '#7c3aed'],
      hero: 'radial-gradient(120% 140% at 100% 0%, rgba(255,255,255,.18), transparent 55%), linear-gradient(135deg, #4f46e5, #7c3aed)' },
    graphite: { name: 'Graphite', light: ['#ea580c', '#f97316', '#fff1e6'], dark: ['#fb923c', '#fdba74', 'rgba(251,146,60,.12)'], brand: ['#ea580c', '#f97316'],
      hero: 'radial-gradient(70% 130% at 100% 0%, rgba(249,115,22,.35), transparent 60%), linear-gradient(135deg, #111111, #262626)' },
    plum: { name: 'Plum', light: ['#be185d', '#db2777', '#fdf2f8'], dark: ['#f472b6', '#f9a8d4', 'rgba(244,114,182,.12)'], brand: ['#86198f', '#db2777'],
      hero: 'radial-gradient(70% 130% at 100% 0%, rgba(251,113,133,.35), transparent 60%), linear-gradient(135deg, #3b0764, #86198f 55%, #be185d)' },
    midnight: { name: 'Midnight', light: ['#b45309', '#d97706', '#fef3c7'], dark: ['#fbbf24', '#fcd34d', 'rgba(251,191,36,.12)'], brand: ['#312e81', '#4338ca'],
      hero: 'radial-gradient(70% 130% at 100% 0%, rgba(251,191,36,.28), transparent 60%), linear-gradient(135deg, #0b1023, #1e1b4b 60%, #312e81)' },
    ocean: { name: 'Ocean', light: ['#0f766e', '#0d9488', '#e3f3f0'], dark: ['#2dd4bf', '#5eead4', 'rgba(45,212,191,.1)'], brand: ['#0b4f4a', '#0d9488'],
      hero: 'radial-gradient(70% 130% at 100% 0%, rgba(153,246,228,.22), transparent 60%), linear-gradient(135deg, #0b3b38, #0f766e 60%, #0d9488)' },
    mono: { name: 'Mono', light: ['#18181b', '#3f3f46', '#f4f4f5'], dark: ['#e4e4e7', '#a1a1aa', 'rgba(228,228,231,.1)'], brand: ['#18181b', '#3f3f46'],
      hero: 'radial-gradient(70% 130% at 100% 0%, rgba(255,255,255,.14), transparent 60%), linear-gradient(135deg, #09090b, #27272a)' },
  };
  const APPEARANCES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
  const KEY = 'sl-site-theme';
  const media = matchMedia('(prefers-color-scheme: dark)');
  let current = { theme: 'indigo', appearance: 'system' };
  const listeners = [];

  function read() {
    try {
      return { ...current, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return current;
    }
  }

  function valid(c) {
    return { theme: THEMES[c?.theme] ? c.theme : 'indigo', appearance: ['system', 'light', 'dark'].includes(c?.appearance) ? c.appearance : 'system' };
  }

  function apply(choice) {
    current = valid(choice);
    const t = THEMES[current.theme];
    const dark = current.appearance === 'dark' || (current.appearance === 'system' && media.matches);
    const [accent, accent2, info] = dark ? t.dark : t.light;
    const root = document.documentElement;
    root.dataset.appearance = dark ? 'dark' : 'light';
    root.dataset.theme = current.theme;
    const vars = { '--accent': accent, '--accent-2': accent2, '--info': info, '--brand-1': t.brand[0], '--brand-2': t.brand[1], '--hero': t.hero };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelectorAll('.tp').forEach(sync);
    listeners.forEach((fn) => fn(current));
  }

  // Saves locally, and to the account if signed in (best effort).
  async function save(patch) {
    apply({ ...current, ...patch });
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {}
    const api = globalThis.ACCOUNT?.API_URL || 'https://api.submitlater.co.in';
    let s = null;
    try {
      s = JSON.parse(localStorage.getItem('sl-session'));
    } catch {}
    // Pages with app.js save through it instead (it renews expired sign-ins).
    if (s?.accessToken && typeof globalThis.api !== 'function') {
      fetch(`${api}/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.accessToken}` },
        body: JSON.stringify({ prefs: current }),
      }).catch(() => {});
    }
  }

  // From the account (server wins when you sign in somewhere new).
  function adopt(prefs) {
    if (!prefs?.theme) return;
    apply(prefs);
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {}
  }

  // ---- Picker (a popover next to a button) ----
  function sync(picker) {
    picker.querySelectorAll('[data-t]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.t === current.theme)));
    picker.querySelectorAll('[data-a]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.a === current.appearance)));
  }

  function picker() {
    const p = document.createElement('div');
    p.className = 'tp';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Theme');
    const head = document.createElement('div');
    head.className = 'tp-head';
    head.textContent = 'Theme';
    const sw = document.createElement('div');
    sw.className = 'tp-sw';
    sw.setAttribute('role', 'radiogroup');
    sw.setAttribute('aria-label', 'Colour');
    for (const [key, t] of Object.entries(THEMES)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.t = key;
      b.setAttribute('role', 'radio');
      b.title = t.name;
      b.innerHTML = `<span class="tp-dot" style="background:linear-gradient(135deg,${t.brand[0]},${t.brand[1]})"></span><span class="tp-name"></span>`;
      b.querySelector('.tp-name').textContent = t.name;
      b.onclick = () => save({ theme: key });
      sw.append(b);
    }
    const seg = document.createElement('div');
    seg.className = 'tp-seg';
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Appearance');
    for (const [value, label] of APPEARANCES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.a = value;
      b.setAttribute('role', 'radio');
      b.textContent = label;
      b.onclick = () => save({ appearance: value });
      seg.append(b);
    }
    const note = document.createElement('p');
    note.className = 'tp-note';
    note.textContent = 'Saved to your account when you’re logged in.';
    p.append(head, sw, seg, note);
    sync(p);
    return p;
  }

  // Wires every [data-theme-btn] on the page to its own popover.
  function mountButtons() {
    document.querySelectorAll('[data-theme-btn]').forEach((btn) => {
      if (btn.dataset.ready) return;
      btn.dataset.ready = '1';
      const wrap = document.createElement('div');
      wrap.className = 'tp-wrap';
      btn.replaceWith(wrap);
      wrap.append(btn);
      const pop = picker();
      pop.hidden = true;
      wrap.append(pop);
      btn.setAttribute('aria-expanded', 'false');
      btn.onclick = (e) => {
        e.stopPropagation();
        pop.hidden = !pop.hidden;
        btn.setAttribute('aria-expanded', String(!pop.hidden));
      };
      document.addEventListener('click', (e) => {
        if (!pop.hidden && !wrap.contains(e.target)) {
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
    });
  }

  apply(read());
  media.addEventListener('change', () => apply(current));
  addEventListener('storage', (e) => e.key === KEY && apply(read()));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButtons);
  else mountButtons();

  return { THEMES, get: () => current, save, adopt, onChange: (fn) => listeners.push(fn), mountButtons };
})();
