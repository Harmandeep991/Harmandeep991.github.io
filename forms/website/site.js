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
  }
  tick();
  setInterval(tick, 1000);
})();

// Annual pricing toggle. The API can disable either offer; in that case the
// page selects the remaining offer or removes the purchase action entirely.
let formsCatalogPlans = null;
function toggleAnnual(checkbox) {
  let annual = !!checkbox?.checked;
  if (formsCatalogPlans) {
    const wanted = annual ? formsCatalogPlans.annual : formsCatalogPlans.monthly;
    const other = annual ? formsCatalogPlans.monthly : formsCatalogPlans.annual;
    if (wanted?.active === false && other?.active !== false) {
      annual = !annual;
      if (checkbox) checkbox.checked = annual;
    }
  }
  const amts = document.querySelectorAll('.plan-amt[data-monthly]');
  amts.forEach(el => {
    const selected = formsCatalogPlans && (annual ? formsCatalogPlans.annual : formsCatalogPlans.monthly);
    const unavailable = selected?.active === false;
    el.textContent = unavailable ? 'Unavailable' : annual ? el.dataset.annual : el.dataset.monthly;
    const period = el.parentElement?.querySelector('.plan-per');
    if (period) period.textContent = unavailable ? '' : annual ? '/365 days' : '/30 days';
  });
  const cta = document.getElementById('forms-plan-cta');
  if (cta) {
    const selected = formsCatalogPlans && (annual ? formsCatalogPlans.annual : formsCatalogPlans.monthly);
    if (selected?.active === false) {
      cta.removeAttribute('href');
      cta.setAttribute('aria-disabled', 'true');
      cta.textContent = 'Timed Forms purchases unavailable';
    } else {
      let signedIn = false;
      try { signedIn = !!JSON.parse(localStorage.getItem('sl-session'))?.refreshToken; } catch {}
      const planId = annual ? 'forms-annual' : 'forms-monthly';
      cta.href = `${signedIn ? '/account.html?buy=' : '/signup.html?plan='}${planId}`;
      cta.removeAttribute('aria-disabled');
      cta.textContent = 'Choose Timed Forms';
    }
  }
}

// Keep this static page aligned with the admin-managed checkout catalogue.
// The HTML values remain as a safe fallback when the API is unavailable.
(async function loadFormsPricing() {
  try {
    const response = await fetch('https://api.submitlater.co.in/plans', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const catalog = await response.json();
    const monthly = catalog.plans?.find(plan => plan.id === 'forms-monthly');
    const annual = catalog.plans?.find(plan => plan.id === 'forms-annual');
    if (!monthly || !annual) return;
    formsCatalogPlans = { monthly, annual };
    const money = amount => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amount)}`;
    const amount = document.getElementById('forms-plan-amt');
    if (amount) {
      amount.dataset.monthly = money(monthly.amount);
      amount.dataset.annual = money(annual.amount);
    }
    const note = document.getElementById('forms-pricing-note');
    if (note) {
      const offers = [monthly, annual]
        .filter(plan => plan.active !== false)
        .map(plan => `${plan.interval === 'annual' ? 'Annual' : 'Monthly'} access is ${money(plan.amount)} for ${plan.days} days`);
      note.textContent = offers.length
        ? `Prices are in INR. ${offers.join('; ')}. Checkout shows the final amount before payment.`
        : 'Timed Forms purchases are temporarily unavailable. Existing access is unchanged.';
    }
    const saving = document.getElementById('forms-plan-saving');
    const savedAmount = monthly.active !== false && annual.active !== false ? Math.max(0, monthly.amount * 12 - annual.amount) : 0;
    if (saving) saving.textContent = savedAmount ? `Save ${money(savedAmount)}` : annual.active === false ? 'Not offered' : 'Annual billing';
    const structured = document.getElementById('forms-structured-data');
    if (structured) {
      const data = JSON.parse(structured.textContent);
      data.offers = [
        { '@type': 'Offer', name: monthly.name, price: String(monthly.amount), priceCurrency: catalog.currency || 'INR' },
        { '@type': 'Offer', name: annual.name, price: String(annual.amount), priceCurrency: catalog.currency || 'INR' },
      ].filter((_, index) => [monthly, annual][index].active !== false);
      structured.textContent = JSON.stringify(data);
    }
    toggleAnnual(document.getElementById('annual-toggle'));
  } catch {}
})();

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
