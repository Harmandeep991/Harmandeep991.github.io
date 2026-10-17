// Loads approved reviews onto the home page from the Submit Later backend
// (server/report-mailer.gs). Paste the same Web app URL as REPORT_URL in the
// extension's config.js. While empty, the reviews section stays hidden.
const BACKEND_URL = '';

(async () => {
  if (!BACKEND_URL) return;
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
