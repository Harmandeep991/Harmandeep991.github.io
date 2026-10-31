// Chrome Web Store page for Submit Later, used by every "Add to Chrome"
// button ([data-store-link]). The pages also have the link written in, so
// the buttons work before this script runs. Keep the two in sync.
const STORE_URL = 'https://chromewebstore.google.com/detail/ofhnlgiipkjicedfmkeppphhjodjbohc?utm_source=website';
const PLAN_CATALOG_URL = 'https://api.submitlater.co.in/plans';

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

// Prices in the HTML are useful fallbacks for visitors on a slow or offline
// connection. Once loaded, the public catalogue replaces those values with
// the same admin-managed prices used by checkout.
const formatInr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

async function hydratePlanCatalogue() {
  if (!document.querySelector('[data-plan-price], [data-plan-saving], [data-plan-effective]')) return;
  try {
    const response = await fetch(PLAN_CATALOG_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const data = await response.json();
    const plans = new Map((data.plans || []).map((plan) => [plan.id, plan]));
    const signedIn = (() => {
      try { return !!JSON.parse(localStorage.getItem('sl-session'))?.refreshToken; } catch { return false; }
    })();

    const syncPlanLink = (link, planId) => {
      const plan = plans.get(planId);
      if (!plan) return;
      link.dataset.availableLabel ||= link.textContent.trim();
      if (plan.active === false) {
        link.removeAttribute('href');
        link.setAttribute('aria-disabled', 'true');
        link.setAttribute('tabindex', '-1');
        link.classList.add('is-disabled');
        link.textContent = 'Currently unavailable';
        return;
      }
      link.href = `${signedIn ? 'account.html?buy=' : 'signup.html?plan='}${encodeURIComponent(planId)}`;
      link.removeAttribute('aria-disabled');
      link.removeAttribute('tabindex');
      link.classList.remove('is-disabled');
      link.textContent = link.dataset.availableLabel;
    };

    globalThis.SLPlanCatalogue = { data, plans, syncPlanLink };

    document.querySelectorAll('[data-plan-price]').forEach((element) => {
      const plan = plans.get(element.dataset.planPrice);
      if (!plan) return;
      element.textContent = plan.active === false ? 'Unavailable' : Number.isFinite(Number(plan.amount)) ? formatInr.format(Number(plan.amount)) : element.textContent;
    });

    document.querySelectorAll('[data-plan-effective]').forEach((element) => {
      const plan = plans.get(element.dataset.planEffective);
      if (plan?.active === false) {
        element.textContent = 'Not currently offered';
      } else if (plan && Number.isFinite(Number(plan.amount))) {
        element.textContent = `${formatInr.format(Math.round(Number(plan.amount) / 12))}/month when paid yearly`;
      }
    });

    document.querySelectorAll('[data-plan-saving]').forEach((element) => {
      const requested = element.dataset.planSaving;
      const products = requested === 'max' ? ['extension', 'forms', 'scheduler'] : [requested];
      const savings = products.map((product) => {
        const monthlyId = product === 'extension' ? 'monthly' : `${product}-monthly`;
        const annualId = product === 'extension' ? 'annual' : `${product}-annual`;
        const monthlyPlan = plans.get(monthlyId);
        const annualPlan = plans.get(annualId);
        const monthly = Number(monthlyPlan?.amount);
        const annual = Number(annualPlan?.amount);
        return monthlyPlan?.active !== false && annualPlan?.active !== false && monthly > 0 && annual > 0
          ? Math.max(0, Math.round((1 - annual / (monthly * 12)) * 100))
          : 0;
      });
      const saving = Math.max(...savings);
      element.textContent = saving ? `${requested === 'max' ? 'Save up to' : 'Save'} ${saving}%` : 'See available plans';
    });

    document.querySelectorAll('[data-plan-link]').forEach((link) => {
      const billing = document.body.dataset.billing || 'annual';
      const planId = link.dataset.planAnnual
        ? billing === 'monthly' ? link.dataset.planMonthly : link.dataset.planAnnual
        : new URL(link.getAttribute('href'), location.href).searchParams.get('plan');
      if (planId) syncPlanLink(link, planId);
    });

    const structured = document.getElementById('site-structured-data');
    if (structured) {
      try {
        const schema = JSON.parse(structured.textContent);
        schema.offers = [...plans.values()]
          .filter((plan) => plan.active !== false)
          .map((plan) => ({
            '@type': 'Offer',
            name: plan.name,
            price: String(plan.amount),
            priceCurrency: data.currency || 'INR',
          }));
        structured.textContent = JSON.stringify(schema);
      } catch {}
    }

    document.dispatchEvent(new CustomEvent('sl:plans-loaded', { detail: data }));
  } catch {
    // Keep the truthful fallback prices rendered in the page.
  }
}

hydratePlanCatalogue();

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

// Theme-aware GIFs: swap src when the appearance changes between light and dark.
// Each <img> carries data-gif-light and data-gif-dark attributes.
// Dark variants (e.g. how-it-works-dark.gif) are placed alongside the light
// ones; until a dark version exists, both attributes can point to the same file.
function swapGifs() {
  const dark = document.documentElement.dataset.appearance === 'dark';
  document.querySelectorAll('img[data-gif-light]').forEach((img) => {
    const want = dark ? img.dataset.gifDark : img.dataset.gifLight;
    if (want) img.src = want;
  });
}
swapGifs();
new MutationObserver(swapGifs).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-appearance'],
});
