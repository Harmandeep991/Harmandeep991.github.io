/* Landing page JS — Scheduler */
(function () {
  'use strict';

  // ── Hero fire counter animation ──
  let fireCount = 3847;
  const fireEl = document.getElementById('fire-count');
  setInterval(() => {
    fireCount += Math.floor(Math.random() * 3) + 1;
    if (fireEl) fireEl.textContent = fireCount.toLocaleString();
  }, 4000);

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
  window.toggleAnnual = function (checkbox) {
    const amounts = document.querySelectorAll('.plan-amt[data-monthly]');
    amounts.forEach(el => {
      el.textContent = checkbox.checked ? el.dataset.annual : el.dataset.monthly;
    });
  };

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
