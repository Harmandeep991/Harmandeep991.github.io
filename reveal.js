/* Scroll-reveal: add .reveal / .reveal-up / .reveal-scale to elements.
   They animate in when they enter the viewport. */
(function () {
  var sel = '.reveal, .reveal-up, .reveal-scale';
  var els = document.querySelectorAll(sel);
  if (!els.length) return;
  if (!window.IntersectionObserver) {
    els.forEach(function (e) { e.classList.add('is-visible'); });
    return;
  }
  var obs = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -36px 0px' });
  els.forEach(function (el) { obs.observe(el); });
})();
