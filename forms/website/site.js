// SubmitLater Forms — landing page JS

// Countdown demo in hero (animates a fake "2 hours" countdown)
(function heroCountdown() {
  let total = 2 * 3600 + 14 * 60 + 37; // seconds

  function tick() {
    if (total <= 0) { total = 2 * 3600 + 14 * 60 + 37; }
    total--;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = n => String(n).padStart(2, '0');
    const ht = document.getElementById('t-h');
    const mt = document.getElementById('t-m');
    const st = document.getElementById('t-s');
    if (ht) ht.textContent = pad(h);
    if (mt) mt.textContent = pad(m);
    if (st) st.textContent = pad(s);
    // Pre-queue sidebar timer
    const pq = document.getElementById('pq-timer');
    if (pq) pq.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  tick();
  setInterval(tick, 1000);
})();

// Annual pricing toggle
function toggleAnnual(checkbox) {
  const amts = document.querySelectorAll('.plan-amt[data-monthly]');
  amts.forEach(el => {
    el.textContent = checkbox.checked ? el.dataset.annual : el.dataset.monthly;
  });
}

// "Copy link" demo button
document.addEventListener('click', e => {
  if (e.target.classList.contains('sv-copy')) {
    const el = e.target;
    const original = el.textContent;
    el.textContent = 'Copied!';
    el.style.color = 'var(--green)';
    setTimeout(() => { el.textContent = original; el.style.color = ''; }, 1500);
  }
});

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// Sticky nav appearance on scroll
const nav = document.querySelector('.nav');
window.addEventListener('scroll', () => {
  nav?.classList.toggle('nav-scrolled', window.scrollY > 20);
}, { passive: true });
