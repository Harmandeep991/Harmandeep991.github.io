/* Landing page JS — Scheduler */
(function () {
  'use strict';

  const API_URL = 'https://api.submitlater.co.in';
  const money = new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2,
  });

  // ── Hero dash mock animation ──
  // Simulates: job firing → log row updates → done
  const dmStatus = document.getElementById('dm-status');
  const dmjS1 = document.getElementById('dmj-s1');
  const dmJob1 = document.getElementById('dm-job-1');
  const dlTime = document.getElementById('dl-time');
  const dlTag = document.getElementById('dl-tag');
  const dlMsg = document.getElementById('dl-msg');
  const dmLog = document.getElementById('dm-log');

  function animateFire() {
    // Reset to firing state
    if (dmStatus) dmStatus.textContent = '● Firing now';
    if (dmjS1) { dmjS1.textContent = '● Firing…'; dmjS1.className = 'dmj-status dmj-firing'; }
    if (dmJob1) dmJob1.classList.add('dm-job-firing');
    if (dmLog) dmLog.style.opacity = '0';

    setTimeout(() => {
      // Show result
      const now = new Date();
      const timeStr = [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
      ].join(':') + '.' + String(now.getMilliseconds()).padStart(3, '0').slice(0, 3);

      const durations = [187, 203, 241, 195, 219, 178];
      const dur = durations[Math.floor(Math.random() * durations.length)];

      if (dlTime) dlTime.textContent = timeStr;
      if (dlTag) { dlTag.textContent = '200 OK'; dlTag.className = 'dl-tag dl-tag-ok'; }
      if (dlMsg) dlMsg.textContent = `POST weekly-report → 200 · ${dur}ms`;
      if (dmLog) { dmLog.style.opacity = '1'; dmLog.style.animation = 'none'; void dmLog.offsetWidth; dmLog.style.animation = 'slide-in .4s ease'; }
      if (dmjS1) { dmjS1.textContent = '✓ 200'; dmjS1.className = 'dmj-status dmj-ok'; }
      if (dmJob1) dmJob1.classList.remove('dm-job-firing');
      if (dmStatus) dmStatus.textContent = '● Running';
    }, 1800);
  }

  animateFire();
  setInterval(animateFire, 7000);

  // ── Annual toggle ──
  let schedulerPlans = null;
  window.toggleAnnual = function (checkbox) {
    let annual = !!checkbox.checked;
    if (schedulerPlans) {
      const wanted = annual ? schedulerPlans.annual : schedulerPlans.monthly;
      const other = annual ? schedulerPlans.monthly : schedulerPlans.annual;
      if (wanted?.active === false && other?.active !== false) {
        annual = !annual;
        checkbox.checked = annual;
      }
    }
    const amounts = document.querySelectorAll('.plan-amt[data-monthly]');
    amounts.forEach(el => {
      const selected = schedulerPlans && (annual ? schedulerPlans.annual : schedulerPlans.monthly);
      el.textContent = selected?.active === false ? 'Unavailable' : annual ? el.dataset.annual : el.dataset.monthly;
    });
    document.querySelectorAll('.plan-per[data-monthly]').forEach(el => {
      const selected = schedulerPlans && (annual ? schedulerPlans.annual : schedulerPlans.monthly);
      el.textContent = selected?.active === false ? '' : annual ? el.dataset.annual : el.dataset.monthly;
    });
    const cta = document.getElementById('scheduler-plan-cta');
    const selected = schedulerPlans && (annual ? schedulerPlans.annual : schedulerPlans.monthly);
    if (!cta) return;
    if (selected?.active === false) {
      cta.removeAttribute('href');
      cta.setAttribute('aria-disabled', 'true');
      cta.textContent = 'Scheduler purchases unavailable';
      return;
    }
    let signedIn = false;
    try { signedIn = !!JSON.parse(localStorage.getItem('sl-session'))?.refreshToken; } catch {}
    const planId = annual ? 'scheduler-annual' : 'scheduler-monthly';
    cta.href = `${signedIn ? '/account.html?buy=' : '/signup.html?plan='}${planId}`;
    cta.removeAttribute('aria-disabled');
    cta.textContent = 'Choose Scheduler Pro';
  };

  // Prices are administered by the same catalogue used for checkout. The
  // HTML values remain useful fallbacks if the API is temporarily unavailable.
  fetch(API_URL + '/plans', { headers: { Accept: 'application/json' } })
    .then(response => response.ok ? response.json() : Promise.reject(new Error('catalog unavailable')))
    .then(catalog => {
      const monthly = catalog.plans?.find(plan => plan.id === 'scheduler-monthly');
      const annual = catalog.plans?.find(plan => plan.id === 'scheduler-annual');
      const amount = document.querySelector('.plan-amt[data-monthly]');
      if (!monthly || !annual || !amount) return;
      schedulerPlans = { monthly, annual };
      amount.dataset.monthly = money.format(monthly.amount);
      amount.dataset.annual = money.format(annual.amount);
      const saving = document.getElementById('scheduler-plan-saving');
      const savedAmount = monthly.active !== false && annual.active !== false
        ? Math.max(0, monthly.amount * 12 - annual.amount)
        : 0;
      if (saving) {
        saving.textContent = savedAmount
          ? `Save ${money.format(savedAmount)}`
          : annual.active === false ? 'Not offered' : 'Annual billing';
      }
      window.toggleAnnual(document.getElementById('annual-toggle'));

      const note = document.getElementById('scheduler-pricing-note');
      if (note) {
        const offers = [monthly, annual]
          .filter(plan => plan.active !== false)
          .map(plan => `${plan.interval === 'annual' ? 'Annual' : 'Monthly'} access is ${money.format(plan.amount)} for ${plan.days} days`);
        note.textContent = offers.length
          ? `Prices are in INR. ${offers.join('; ')}. Plans do not renew automatically.`
          : 'Webhook Scheduler purchases are temporarily unavailable. Existing access is unchanged.';
      }

      const schema = document.getElementById('scheduler-schema');
      if (schema) {
        try {
          const data = JSON.parse(schema.textContent);
          data.offers = [
            { '@type': 'Offer', price: '0', priceCurrency: 'INR', name: 'Free' },
            ...[monthly, annual]
              .filter(plan => plan.active !== false)
              .map(plan => ({ '@type': 'Offer', price: String(plan.amount), priceCurrency: catalog.currency || 'INR', name: plan.name })),
          ];
          schema.textContent = JSON.stringify(data);
        } catch {}
      }
    })
    .catch(() => {});

  // ── Smooth scroll ──
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
})();
