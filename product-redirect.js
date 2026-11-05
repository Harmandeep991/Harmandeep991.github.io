// Compatibility for previously shared standalone dashboard URLs. The API still
// validates any migrated session; never replace the user's current main account.
(() => {
  const product = document.body.dataset.product;
  if (!['forms', 'scheduler'].includes(product)) return;
  const isSession = value => value && !Array.isArray(value)
    && typeof value.refreshToken === 'string' && value.refreshToken.length > 0;
  const read = key => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { return null; }
  };
  let current = read('sl-session');
  try {
    if (!isSession(current)) {
      const key = product === 'forms' ? 'sl-forms-session' : 'sched_refresh';
      const legacy = product === 'forms' ? read(key) : { refreshToken: localStorage.getItem(key) };
      if (isSession(legacy)) {
        localStorage.setItem('sl-session', JSON.stringify(legacy));
        current = read('sl-session');
        if (isSession(current)) localStorage.removeItem(key);
      }
    }
  } catch {
    document.getElementById('migration-status').textContent = 'Continue to your account. You may need to log in again if browser storage is unavailable.';
  }
  const account = `/account.html#${product}`;
  const destination = !isSession(current) && new URLSearchParams(location.search).get('signup') === '1'
    ? `/signup.html?next=${encodeURIComponent(`account.html#${product}`)}` : account;
  document.getElementById('continue-product').href = destination;
  location.replace(destination);
})();
