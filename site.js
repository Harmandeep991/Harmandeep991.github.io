// Chrome Web Store page for Submit Later, used by every "Add to Chrome"
// button ([data-store-link]). The pages also have the link written in, so
// the buttons work before this script runs. Keep the two in sync.
const STORE_URL = 'https://chromewebstore.google.com/detail/ofhnlgiipkjicedfmkeppphhjodjbohc?utm_source=website';

// Submit Later backend (server/report-mailer.gs): the same Web app URL as
// REPORT_URL in the extension's config.js. Loads approved reviews onto the
// home page. While empty, the reviews section stays hidden.
const BACKEND_URL = '';

if (STORE_URL) {
  document.querySelectorAll('[data-store-link]').forEach((a) => {
    a.href = STORE_URL;
    a.hidden = false;
  });
}

// Signed in (see app.js)? Show "Account" instead of "Log in", and send the
// pricing buttons straight to checkout instead of sign-up.
let hasSession = false;
try {
  hasSession = !!JSON.parse(localStorage.getItem('sl-session'))?.refreshToken;
} catch {}
if (hasSession) {
  document.querySelectorAll('.nav-login').forEach((a) => {
    a.href = 'account.html';
    a.textContent = 'Account';
  });
  document.querySelectorAll('[data-plan-link]').forEach((a) => {
    const plan = new URL(a.href).searchParams.get('plan');
    a.href = plan ? `account.html?buy=${plan}` : 'account.html';
  });
}

// Header: highlight the current page, and the menu button on small screens.
const here = location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.main-nav a').forEach((a) => {
  if (a.getAttribute('href') === here) a.classList.add('on');
});
const menuBtn = document.querySelector('.menu-btn');
const mainNav = document.getElementById('main-nav');
if (menuBtn && mainNav) {
  const setOpen = (open) => {
    mainNav.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!mainNav.classList.contains('open'));
  });
  mainNav.addEventListener('click', (e) => e.target.closest('a') && setOpen(false));
  document.addEventListener('click', (e) => !e.target.closest('.top') && setOpen(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));
}

// Use-case filter on the home page. Without JS every card simply shows.
const filters = document.querySelector('.filters');
if (filters) {
  filters.hidden = false;
  filters.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    filters.querySelectorAll('[data-filter]').forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', x === b);
    });
    document.querySelectorAll('.case').forEach((c) => {
      c.hidden = b.dataset.filter !== 'all' && c.dataset.cat !== b.dataset.filter;
    });
  });
}

(async () => {
  if (!BACKEND_URL || !document.getElementById('testimonials')) return;
  try {
    const res = await fetch(`${BACKEND_URL}?action=testimonials`);
    const data = await res.json();
    const list = (data.testimonials || []).slice(0, 6);
    if (!list.length) return;
    const box = document.getElementById('testimonials');
    for (const t of list) {
      const card = document.createElement('figure');
      card.className = 'testimonial';
      const stars = document.createElement('div');
      stars.className = 't-stars';
      stars.textContent = '★'.repeat(t.rating) + '☆'.repeat(5 - t.rating);
      stars.setAttribute('aria-label', `${t.rating} out of 5 stars`);
      const quote = document.createElement('blockquote');
      quote.textContent = `"${t.comment}"`;
      const who = document.createElement('figcaption');
      who.textContent = t.name;
      const date = document.createElement('small');
      date.textContent = new Date(t.date).toLocaleDateString([], { month: 'short', year: 'numeric' });
      who.append(' · ', date);
      card.append(stars, quote, who);
      box.append(card);
    }
    document.getElementById('reviews').hidden = false;
  } catch {
    // Leave the section hidden if the backend can't be reached.
  }
})();
