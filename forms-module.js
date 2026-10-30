/**
 * forms-module.js — Forms Enforcer module for the account dashboard.
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
  let _editingId = null;  // null = create, string = editing existing form

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function fmtDateLocal(iso) {
    if (!iso) return '';
    // Convert ISO to local datetime-local input format
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formStatus(f) {
    const now = Date.now();
    if (!f.openAt && !f.closeAt) return { key: 'draft', label: 'Draft' };
    const open = f.openAt ? new Date(f.openAt).getTime() : null;
    const close = f.closeAt ? new Date(f.closeAt).getTime() : null;
    if (open && now < open) return { key: 'upcoming', label: 'Upcoming' };
    if (close && now > close) return { key: 'closed', label: 'Closed' };
    return { key: 'open', label: 'Open' };
  }

  function publicLink(code) {
    return `https://submitlater.co.in/f/${code}`;
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
      toast('Could not load forms: ' + e.message);
      return;
    }

    _forms = data.forms || [];
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
        _copyLink(publicLink(f.code), copyBtn);
      });
    });

    // Card click → detail
    listEl.querySelectorAll('.fm-card[data-id]').forEach(card => {
      card.addEventListener('click', () => showDetail(card.dataset.id));
    });
  }

  function _formCard(f) {
    const s = formStatus(f);
    const link = publicLink(f.code);
    return `
      <div class="fm-card" data-id="${esc(f._id)}">
        <div class="fm-card-main">
          <div class="fm-card-head">
            <span class="fm-title">${esc(f.title)}</span>
            <span class="fm-status-chip chip-${s.key}">${esc(s.label)}</span>
          </div>
          <div class="fm-card-url">
            <code>submitlater.co.in/f/${esc(f.code)}</code>
            <button class="fm-copy-btn" id="fm-copy-${esc(f._id)}" title="Copy link" type="button">Copy</button>
          </div>
          <div class="fm-card-times">
            ${f.openAt ? `Opens ${fmtDate(f.openAt)}` : 'No open time'} &rarr;
            ${f.closeAt ? `Closes ${fmtDate(f.closeAt)}` : 'No close time'}
          </div>
          <div class="fm-card-access">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <circle cx="6" cy="5" r="2" stroke="currentColor" stroke-width="1.2"/>
              <path d="M1 10c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            ${f.accessCount ?? 0} accesses
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
      if ($('fm-c-title')) $('fm-c-title').value = f.title || '';
      if ($('fm-c-url')) $('fm-c-url').value = f.googleFormUrl || '';
      if ($('fm-c-open')) $('fm-c-open').value = fmtDateLocal(f.openAt);
      if ($('fm-c-close')) $('fm-c-close').value = fmtDateLocal(f.closeAt);
      if ($('fm-c-tz')) $('fm-c-tz').value = f.timezone || 'Asia/Kolkata';
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
    const title = ($('fm-c-title')?.value || '').trim();
    const googleFormUrl = ($('fm-c-url')?.value || '').trim();
    const openVal = $('fm-c-open')?.value;
    const closeVal = $('fm-c-close')?.value;
    const timezone = $('fm-c-tz')?.value || 'Asia/Kolkata';

    _clearWizardError();

    if (!title) { _showWizardError('Enter a name for this form.'); return; }
    if (!googleFormUrl || !googleFormUrl.includes('docs.google.com/forms')) {
      _showWizardError('Paste a valid Google Forms URL (docs.google.com/forms/…)');
      return;
    }
    if (openVal && closeVal && new Date(openVal) >= new Date(closeVal)) {
      _showWizardError('Close time must be after open time.');
      return;
    }

    const body = {
      title,
      googleFormUrl,
      openAt: openVal ? new Date(openVal).toISOString() : null,
      closeAt: closeVal ? new Date(closeVal).toISOString() : null,
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
    const link = publicLink(f.code);

    _setDetail('fm-detail-title', f.title);
    _setDetail('fm-detail-status-label', s.label);

    const chip = $('fm-detail-status-chip');
    if (chip) chip.className = `fm-status-chip chip-${s.key}`;

    _setDetail('fm-detail-link-text', link);
    _setDetail('fm-detail-open', f.openAt ? fmtDate(f.openAt) : '—');
    _setDetail('fm-detail-close', f.closeAt ? fmtDate(f.closeAt) : '—');
    _setDetail('fm-detail-tz', f.timezone || 'UTC');
    _setDetail('fm-detail-access', String(f.accessCount ?? 0));

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
    if (!confirm(`Delete "${f?.title || 'this form'}"? The public link will stop working.`)) return;
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
