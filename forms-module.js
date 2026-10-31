/**
 * forms-module.js — Timed Forms module for the account dashboard.
 *
 * Loaded by account.html after app.js. Depends on:
 *   api(path, opts)  — authenticated fetch helper from app.js
 *   toast(text)      — notification helper from app.js
 *
 * All DOM IDs are prefixed `fm-` to avoid collisions with other views.
 */

window.formsModule = (function () {
  'use strict';

  let _initialised = false;
  let _forms = [];
  let _usage = null;
  let _editingId = null;  // null = create, string = editing existing form
  const FORM_PUBLIC_ORIGIN = (() => {
    try { return new URL(ACCOUNT.API_URL).origin; }
    catch { return 'https://api.submitlater.co.in'; }
  })();

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso, timezone = 'UTC') {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-US', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    }
  }

  function wallParts(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  }

  function fmtDateLocal(iso, timezone) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = wallParts(d, timezone || 'UTC');
    const pad = n => String(n).padStart(2, '0');
    return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
  }

  // Convert a datetime-local value in the selected IANA timezone to an instant.
  function zonedLocalToIso(value, timezone) {
    if (!value) return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) throw new Error('Enter a valid date and time.');
    const desired = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], 0);
    let instant = desired;
    for (let i = 0; i < 4; i++) {
      const p = wallParts(new Date(instant), timezone);
      const shownAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second || 0);
      const next = desired - (shownAsUtc - instant);
      if (next === instant) break;
      instant = next;
    }
    const result = new Date(instant);
    const p = wallParts(result, timezone);
    const expected = match.slice(1).map(Number);
    if ([p.year, p.month, p.day, p.hour, p.minute].some((n, i) => n !== expected[i])) {
      throw new Error('That local time does not exist in the selected timezone. Choose another time.');
    }
    return result.toISOString();
  }

  function formStatus(f) {
    const now = Date.now();
    if (!f.openAt && !f.closeAt) return { key: 'draft', label: 'Draft' };
    const open = f.openAt ? new Date(f.openAt).getTime() : null;
    const close = f.closeAt ? new Date(f.closeAt).getTime() : null;
    if (open && now < open) return { key: 'upcoming', label: 'Upcoming' };
    if (close && now >= close) return { key: 'closed', label: 'Closed' };
    return { key: 'open', label: 'Open' };
  }

  function publicLink(code) {
    return `${FORM_PUBLIC_ORIGIN}/f/${encodeURIComponent(code)}`;
  }

  function showSub(name) {
    ['fm-list-view', 'fm-create-view', 'fm-detail-view'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.hidden = id !== 'fm-' + name + '-view';
    });
  }

  function $(id) { return document.getElementById(id); }

  // ── List view ─────────────────────────────────────────────────────────────

  async function _loadList() {
    const listEl = $('fm-list');
    const emptyEl = $('fm-empty');
    if (listEl) listEl.innerHTML = '<div class="fm-loading">Loading…</div>';
    if (emptyEl) emptyEl.hidden = true;

    let data;
    try {
      data = await api('/forms');
    } catch (e) {
      if (listEl) listEl.innerHTML = `<div class="fm-loading">${esc(e.message || 'Could not load your forms.')}</div>`;
      toast('Could not load forms: ' + e.message);
      return;
    }

    _forms = data.forms || [];
    _usage = data.usage || null;
    const usageEl = $('fm-usage');
    if (usageEl && _usage) usageEl.textContent = `${_usage.used} of ${_usage.limit} links used`;
    const newBtn = $('fm-new-btn');
    if (newBtn && _usage) {
      newBtn.disabled = _usage.used >= _usage.limit;
      newBtn.title = newBtn.disabled ? 'Your Timed Forms limit is reached. Delete a link or choose a plan.' : '';
    }
    _renderList();
  }

  function _renderList() {
    const listEl = $('fm-list');
    const emptyEl = $('fm-empty');
    if (!listEl) return;

    if (_forms.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    listEl.innerHTML = _forms.map(f => _formCard(f)).join('');

    // Attach per-card button handlers
    _forms.forEach(f => {
      const editBtn = document.getElementById(`fm-edit-${f._id}`);
      const delBtn = document.getElementById(`fm-del-${f._id}`);
      const copyBtn = document.getElementById(`fm-copy-${f._id}`);
      if (editBtn) editBtn.addEventListener('click', e => { e.stopPropagation(); showCreate(f._id); });
      if (delBtn) delBtn.addEventListener('click', e => { e.stopPropagation(); _deleteForm(f._id); });
      if (copyBtn) copyBtn.addEventListener('click', e => {
        e.stopPropagation();
        _copyLink(publicLink(f.shortCode), copyBtn);
      });
    });

    // Card click → detail
    listEl.querySelectorAll('.fm-card[data-id]').forEach(card => {
      card.addEventListener('click', () => showDetail(card.dataset.id));
    });
  }

  function _formCard(f) {
    const s = formStatus(f);
    const link = publicLink(f.shortCode);
    const linkLabel = link.replace(/^https?:\/\//, '');
    return `
      <div class="fm-card" data-id="${esc(f._id)}">
        <div class="fm-card-main">
          <div class="fm-card-head">
            <span class="fm-title">${esc(f.name)}</span>
            <span class="fm-status-chip chip-${s.key}">${esc(s.label)}</span>
          </div>
          <div class="fm-card-url">
            <code>${esc(linkLabel)}</code>
            <button class="fm-copy-btn" id="fm-copy-${esc(f._id)}" title="Copy link" type="button">Copy</button>
          </div>
          <div class="fm-card-times">
            ${f.openAt ? `Opens ${fmtDate(f.openAt, f.timezone)}` : 'Available immediately'} &rarr;
            ${f.closeAt ? `Closes ${fmtDate(f.closeAt, f.timezone)}` : 'No closing time'}
          </div>
          <div class="fm-card-access">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <circle cx="6" cy="5" r="2" stroke="currentColor" stroke-width="1.2"/>
              <path d="M1 10c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            ${f.stats?.views ?? 0} link views
          </div>
        </div>
        <div class="fm-card-actions">
          <button class="fm-action-btn" id="fm-edit-${esc(f._id)}" type="button">Edit</button>
          <button class="fm-action-btn fm-action-del" id="fm-del-${esc(f._id)}" type="button">Delete</button>
        </div>
      </div>`;
  }

  // ── Create / Edit wizard ──────────────────────────────────────────────────

  function showCreate(editId) {
    _editingId = editId || null;
    const titleEl = $('fm-wizard-title');
    const submitEl = $('fm-wizard-submit');

    if (_editingId) {
      const f = _forms.find(x => x._id === _editingId);
      if (!f) return;
      if (titleEl) titleEl.textContent = 'Edit gated form';
      if (submitEl) submitEl.textContent = 'Save changes';
      if ($('fm-c-title')) $('fm-c-title').value = f.name || '';
      if ($('fm-c-url')) $('fm-c-url').value = f.googleFormUrl || '';
      if ($('fm-c-tz')) $('fm-c-tz').value = f.timezone || 'Asia/Kolkata';
      if ($('fm-c-open')) $('fm-c-open').value = fmtDateLocal(f.openAt, f.timezone);
      if ($('fm-c-close')) $('fm-c-close').value = fmtDateLocal(f.closeAt, f.timezone);
    } else {
      if (titleEl) titleEl.textContent = 'New gated form';
      if (submitEl) submitEl.textContent = 'Create form';
      if ($('fm-c-title')) $('fm-c-title').value = '';
      if ($('fm-c-url')) $('fm-c-url').value = '';
      if ($('fm-c-open')) $('fm-c-open').value = '';
      if ($('fm-c-close')) $('fm-c-close').value = '';
      if ($('fm-c-tz')) $('fm-c-tz').value = 'Asia/Kolkata';
    }

    _clearWizardError();
    showSub('create');
  }

  function _clearWizardError() {
    const errEl = $('fm-wizard-error');
    if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
  }

  function _showWizardError(msg) {
    const errEl = $('fm-wizard-error');
    if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
  }

  async function _saveForm() {
    const name = ($('fm-c-title')?.value || '').trim();
    const googleFormUrl = ($('fm-c-url')?.value || '').trim();
    const openVal = $('fm-c-open')?.value;
    const closeVal = $('fm-c-close')?.value;
    const timezone = $('fm-c-tz')?.value || 'Asia/Kolkata';

    _clearWizardError();

    if (!name) { _showWizardError('Enter a name for this form.'); return; }
    if (!/^https:\/\/(?:docs\.google\.com\/forms\/d\/(?:e\/)?[\w-]+(?:\/|$)|forms\.gle\/[\w-]+(?:[/?#]|$))/i.test(googleFormUrl)) {
      _showWizardError('Paste a valid Google Forms URL (docs.google.com/forms/… or forms.gle/…)');
      return;
    }

    let openAt;
    let closeAt;
    try {
      openAt = zonedLocalToIso(openVal, timezone);
      closeAt = zonedLocalToIso(closeVal, timezone);
    } catch (e) {
      _showWizardError(e.message || 'Check the dates and timezone.');
      return;
    }
    if (openAt && closeAt && new Date(openAt) >= new Date(closeAt)) {
      _showWizardError('Close time must be after open time.');
      return;
    }

    const body = {
      name,
      googleFormUrl,
      openAt,
      closeAt,
      timezone,
    };

    const submitBtn = $('fm-wizard-submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = _editingId ? 'Saving…' : 'Creating…'; }

    try {
      if (_editingId) {
        await api(`/forms/${_editingId}`, { method: 'PATCH', body });
        toast('Form updated.');
      } else {
        await api('/forms', { method: 'POST', body });
        toast('Form created.');
      }
      await _loadList();
      showSub('list');
    } catch (e) {
      _showWizardError(e.message || 'Something went wrong. Please try again.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = _editingId ? 'Save changes' : 'Create form';
      }
    }
  }

  // ── Detail view ───────────────────────────────────────────────────────────

  async function showDetail(id) {
    const f = _forms.find(x => x._id === id);
    if (!f) return;

    const s = formStatus(f);
    const link = publicLink(f.shortCode);

    _setDetail('fm-detail-title', f.name);
    _setDetail('fm-detail-status-label', s.label);

    const chip = $('fm-detail-status-chip');
    if (chip) chip.className = `fm-status-chip chip-${s.key}`;

    _setDetail('fm-detail-link-text', link);
    _setDetail('fm-detail-open', f.openAt ? fmtDate(f.openAt, f.timezone) : 'Available immediately');
    _setDetail('fm-detail-close', f.closeAt ? fmtDate(f.closeAt, f.timezone) : 'No closing time');
    _setDetail('fm-detail-tz', f.timezone || 'UTC');
    _setDetail('fm-detail-access', String(f.stats?.views ?? 0));

    const gLink = $('fm-detail-gform');
    if (gLink) { gLink.href = f.googleFormUrl; }

    const editBtn = $('fm-detail-edit');
    if (editBtn) editBtn.onclick = () => showCreate(id);

    const delBtn = $('fm-detail-delete');
    if (delBtn) delBtn.onclick = () => _deleteForm(id);

    const copyBtn = $('fm-detail-copy');
    if (copyBtn) copyBtn.onclick = () => _copyLink(link, copyBtn);

    showSub('detail');
  }

  function _setDetail(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function _deleteForm(id) {
    const f = _forms.find(x => x._id === id);
    if (!confirm(`Delete "${f?.name || 'this form'}"? The public link will stop working.`)) return;
    try {
      await api(`/forms/${id}`, { method: 'DELETE' });
      _forms = _forms.filter(x => x._id !== id);
      _renderList();
      showSub('list');
      toast('Form deleted.');
    } catch (e) {
      toast('Could not delete: ' + e.message);
    }
  }

  // ── Copy link ─────────────────────────────────────────────────────────────

  function _copyLink(url, btn) {
    navigator.clipboard.writeText(url).then(() => {
      toast('Link copied!');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1800);
      }
    }).catch(() => {
      toast('Copy failed. Link: ' + url);
    });
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  function _attachListeners() {
    // New form button
    const newBtn = $('fm-new-btn');
    if (newBtn) newBtn.addEventListener('click', () => showCreate());

    // Wizard: cancel
    const cancelBtn = $('fm-wizard-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { showSub('list'); });

    // Wizard: submit
    const wizardForm = $('fm-wizard-form');
    if (wizardForm) wizardForm.addEventListener('submit', e => { e.preventDefault(); _saveForm(); });

    // Detail: back
    const backBtn = $('fm-detail-back');
    if (backBtn) backBtn.addEventListener('click', () => showSub('list'));
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function init() {
    if (_initialised) {
      _loadList();
      return;
    }
    _initialised = true;
    _attachListeners();
    _loadList();
  }

  return { init, showCreate, showDetail };
})();
