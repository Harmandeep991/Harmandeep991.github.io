/**
 * Timed Forms account module.
 *
 * Google sign-in and Google Forms access are deliberately separate. The
 * latter grants Forms API permission so Submit Later can import questions and
 * synchronize Google's own accepting-responses setting with the time window.
 */
window.formsModule = (function () {
  'use strict';

  const SUPPORTED_TYPES = new Set(['shortText', 'paragraph', 'multipleChoice', 'checkboxes', 'dropdown']);
  const OPTION_TYPES = new Set(['multipleChoice', 'checkboxes', 'dropdown']);
  const TYPE_LABELS = {
    shortText: 'Short answer',
    paragraph: 'Paragraph',
    multipleChoice: 'Multiple choice',
    checkboxes: 'Checkboxes',
    dropdown: 'Dropdown',
    unsupported: 'Google Forms item',
  };
  const DEFAULT_BRANDING = {
    orgName: '',
    color: '#6366f1',
    backgroundColor: '#f5f7fb',
    surfaceColor: '#ffffff',
    textColor: '#111827',
    radius: 16,
    intro: '',
  };

  let initialised = false;
  let forms = [];
  let usage = null;
  let editingId = null;
  let currentId = null;
  let googleStatus = { connected: false };
  let importedGoogleForm = null;
  let importedUrl = '';
  let questions = [];

  const FORM_PUBLIC_ORIGIN = (() => {
    try { return new URL(ACCOUNT.API_URL).origin; }
    catch { return 'https://api.submitlater.co.in'; }
  })();

  const $ = id => document.getElementById(id);

  function detectedTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
  }

  function selectTimezone(select, timezone = detectedTimezone()) {
    if (!select) return 'UTC';
    const value = timezone || 'UTC';
    if (![...select.options].some(option => option.value === value)) {
      select.add(new Option(`${value} (detected)`, value), 0);
    }
    select.value = value;
    return value;
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formId(form) {
    return String(form?._id || form?.id || '');
  }

  function googleFormId(form) {
    return String(form?.googleFormId || form?.google?.formId || '');
  }

  function isManaged(form) {
    return !!googleFormId(form);
  }

  function publicLink(formOrCode) {
    if (typeof formOrCode === 'object' && formOrCode?.publicUrl) return formOrCode.publicUrl;
    const code = typeof formOrCode === 'object' ? formOrCode?.shortCode : formOrCode;
    return `${FORM_PUBLIC_ORIGIN}/f/${encodeURIComponent(code || '')}`;
  }

  function embedLink(form) {
    if (form?.embedUrl) {
      try { return new URL(form.embedUrl, FORM_PUBLIC_ORIGIN).href; }
      catch {}
    }
    return `${FORM_PUBLIC_ORIGIN}/embed/forms/${encodeURIComponent(form?.shortCode || '')}`;
  }

  function fmtDate(iso, timezone = 'UTC') {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        timeZone: timezone,
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }
  }

  function wallParts(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  }

  function fmtDateLocal(iso, timezone) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const p = wallParts(date, timezone || 'UTC');
    const pad = value => String(value).padStart(2, '0');
    return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
  }

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
    if ([p.year, p.month, p.day, p.hour, p.minute].some((valuePart, index) => valuePart !== expected[index])) {
      throw new Error('That local time does not exist in the selected timezone. Choose another time.');
    }
    return result.toISOString();
  }

  function formStatus(form) {
    const now = Date.now();
    if (!form.openAt && !form.closeAt) return { key: 'draft', label: 'Always open' };
    const open = form.openAt ? new Date(form.openAt).getTime() : null;
    const close = form.closeAt ? new Date(form.closeAt).getTime() : null;
    if (open && now < open) return { key: 'upcoming', label: 'Upcoming' };
    if (close && now >= close) return { key: 'closed', label: 'Closed' };
    return { key: 'open', label: 'Open' };
  }

  function showSub(name) {
    ['list', 'create', 'detail'].forEach(view => {
      const element = $(`fm-${view}-view`);
      if (element) element.hidden = view !== name;
    });
  }

  function showError(id, message) {
    const element = $(id);
    if (!element) return;
    element.textContent = message || '';
    element.hidden = !message;
  }

  function normalizeGoogleStatus(data) {
    const value = data?.connection || data || {};
    return {
      connected: !!(value.connected ?? value.email ?? value.accountEmail),
      configured: value.configured !== false,
      email: value.email || value.accountEmail || value.googleEmail || '',
      expiresAt: value.expiresAt || null,
      error: value.error || '',
    };
  }

  async function loadGoogleStatus() {
    try {
      googleStatus = normalizeGoogleStatus(await api('/forms/google/status'));
    } catch (error) {
      googleStatus = { connected: false, configured: false, error: error.message || 'Connection unavailable.' };
    }
    renderGoogleStatus();
    return googleStatus;
  }

  function renderGoogleStatus() {
    const status = $('fm-google-status');
    const connect = $('fm-google-connect');
    const disconnect = $('fm-google-disconnect');
    const wizardStatus = $('fm-wizard-google-status');
    const wizardConnect = $('fm-wizard-connect');
    if (status) {
      status.textContent = googleStatus.connected
        ? `Connected as ${googleStatus.email || 'your Google account'}. Imported forms can be edited and closed at Google.`
        : googleStatus.configured === false
          ? 'Google Forms connection is not configured on this server.'
          : 'Not connected. Connect the Google account that owns or edits the form.';
    }
    if (connect) connect.hidden = googleStatus.connected || googleStatus.configured === false;
    if (disconnect) disconnect.hidden = !googleStatus.connected;
    if (wizardStatus) {
      wizardStatus.textContent = googleStatus.connected
        ? `Connected as ${googleStatus.email || 'your Google account'}. Paste a form you can edit, then import it.`
        : 'Connect Google Forms to import questions and enforce the response deadline at Google.';
    }
    if (wizardConnect) {
      wizardConnect.hidden = googleStatus.connected || googleStatus.configured === false;
      wizardConnect.disabled = googleStatus.configured === false;
    }
    const importButton = $('fm-import-btn');
    if (importButton) importButton.disabled = !googleStatus.connected;
  }

  async function connectGoogle(button) {
    if (button) button.disabled = true;
    try {
      const result = await api('/forms/google/connect', { method: 'POST' });
      if (!result?.url) throw new Error('Google did not return an authorization page.');
      location.assign(result.url);
    } catch (error) {
      toast(error.message || 'Could not start Google authorization.');
      if (button) button.disabled = false;
    }
  }

  async function disconnectGoogle() {
    if (!confirm('Disconnect Google Forms? Google’s original response setting will be restored, and managed forms will become legacy links. To manage them again, reconnect Google Forms and re-import the form or create a new timed form.')) return;
    const button = $('fm-google-disconnect');
    if (button) button.disabled = true;
    try {
      await api('/forms/google/connection', { method: 'DELETE' });
      googleStatus = { connected: false, configured: true };
      renderGoogleStatus();
      await loadList();
      toast('Google Forms disconnected.');
    } catch (error) {
      toast(error.message || 'Could not disconnect Google Forms.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadList() {
    const list = $('fm-list');
    const empty = $('fm-empty');
    if (list) list.innerHTML = '<div class="fm-loading">Loading timed forms…</div>';
    if (empty) empty.hidden = true;
    try {
      const data = await api('/forms');
      forms = data.forms || [];
      usage = data.usage || null;
      if ($('fm-usage') && usage) $('fm-usage').textContent = `${usage.used} of ${usage.limit} forms used`;
      if ($('fm-new-btn') && usage) {
        $('fm-new-btn').disabled = usage.used >= usage.limit;
        $('fm-new-btn').title = $('fm-new-btn').disabled ? 'Your Timed Forms limit is reached.' : '';
      }
      renderList();
    } catch (error) {
      if (list) list.innerHTML = `<div class="fm-loading">${esc(error.message || 'Could not load your forms.')}</div>`;
    }
  }

  function renderList() {
    const list = $('fm-list');
    const empty = $('fm-empty');
    if (!list) return;
    if (!forms.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = forms.map(formCard).join('');
    list.querySelectorAll('.fm-card[data-id]').forEach(card => {
      card.addEventListener('click', event => {
        if (event.target.closest('button')) return;
        showDetail(card.dataset.id);
      });
      card.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target === card) {
          event.preventDefault();
          showDetail(card.dataset.id);
        }
      });
    });
    list.querySelectorAll('[data-fm-action]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const id = button.closest('.fm-card')?.dataset.id;
        if (button.dataset.fmAction === 'copy') copyText(publicLink(forms.find(form => formId(form) === id)), button, 'Link copied.');
        if (button.dataset.fmAction === 'edit') showCreate(id);
        if (button.dataset.fmAction === 'delete') deleteForm(id);
      });
    });
  }

  function formCard(form) {
    const status = formStatus(form);
    const managed = isManaged(form);
    const link = publicLink(form).replace(/^https?:\/\//, '');
    return `<article class="fm-card" data-id="${esc(formId(form))}" tabindex="0" role="link" aria-label="Open ${esc(form.name || 'timed form')}">
      <div class="fm-card-main">
        <div class="fm-card-head"><span class="fm-title">${esc(form.name)}</span><span class="fm-status-chip chip-${status.key}">${esc(status.label)}</span></div>
        <div class="fm-card-url"><code>${esc(link)}</code><button class="fm-copy-btn" data-fm-action="copy" type="button">Copy</button></div>
        <div class="fm-card-times">${form.openAt ? `Opens ${esc(fmtDate(form.openAt, form.timezone))}` : 'Available immediately'} · ${form.closeAt ? `Closes ${esc(fmtDate(form.closeAt, form.timezone))}` : 'No closing time'}</div>
        <div class="fm-card-meta"><span>${form.stats?.views ?? 0} link views</span><span class="fm-managed-label ${managed ? 'is-managed' : ''}">${managed ? 'Google-managed' : 'Legacy link'}</span></div>
      </div>
      <div class="fm-card-actions"><button class="fm-action-btn" data-fm-action="edit" type="button">Edit</button><button class="fm-action-btn fm-action-del" data-fm-action="delete" type="button">Delete</button></div>
    </article>`;
  }

  function resetWizard() {
    importedGoogleForm = null;
    importedUrl = '';
    $('fm-wizard-form')?.reset();
    selectTimezone($('fm-c-tz'));
    for (const [field, value] of Object.entries(DEFAULT_BRANDING)) {
      const id = {
        orgName: 'fm-c-org', color: 'fm-c-color', backgroundColor: 'fm-c-background',
        surfaceColor: 'fm-c-surface', textColor: 'fm-c-text', radius: 'fm-c-radius', intro: 'fm-c-intro',
      }[field];
      if ($(id)) $(id).value = value;
    }
    syncAllColorPairs('picker');
    if ($('fm-c-radius-output')) $('fm-c-radius-output').textContent = '16 px';
    if ($('fm-c-embed-height')) $('fm-c-embed-height').value = '820';
    if ($('fm-c-google-id')) $('fm-c-google-id').value = '';
    if ($('fm-c-url')) $('fm-c-url').readOnly = false;
    if ($('fm-import-btn')) $('fm-import-btn').hidden = false;
    if ($('fm-import-result')) $('fm-import-result').hidden = true;
    if ($('fm-import-questions')) { $('fm-import-questions').hidden = true; $('fm-import-questions').innerHTML = ''; }
    if ($('fm-embed-fields')) $('fm-embed-fields').hidden = true;
    showError('fm-wizard-error', '');
    updatePreview();
  }

  function brandingOf(form) {
    const branding = form?.branding || {};
    return {
      ...DEFAULT_BRANDING,
      ...branding,
      color: branding.color || branding.accentColor || DEFAULT_BRANDING.color,
      radius: Number.isFinite(Number(branding.radius)) ? Number(branding.radius) : DEFAULT_BRANDING.radius,
    };
  }

  function embedOf(form) {
    return form?.embed || form?.embedding || {};
  }

  function showCreate(id) {
    editingId = id || null;
    resetWizard();
    const form = forms.find(item => formId(item) === editingId);
    if (editingId && !form) return;
    $('fm-wizard-title').textContent = editingId ? 'Edit timed form' : 'New timed form';
    $('fm-wizard-submit').textContent = editingId ? 'Save changes' : 'Create form';
    if (form) {
      $('fm-c-title').value = form.name || '';
      $('fm-c-url').value = form.googleFormUrl || form.google?.responderUri || '';
      $('fm-c-google-id').value = googleFormId(form);
      importedGoogleForm = googleFormId(form) ? { googleFormId: googleFormId(form), title: form.name, questions: [] } : null;
      importedUrl = $('fm-c-url').value;
      const timezone = selectTimezone($('fm-c-tz'), form.timezone || 'UTC');
      $('fm-c-open').value = fmtDateLocal(form.openAt, timezone);
      $('fm-c-close').value = fmtDateLocal(form.closeAt, timezone);
      const branding = brandingOf(form);
      $('fm-c-org').value = branding.orgName || '';
      $('fm-c-intro').value = branding.intro || '';
      setColor('color', branding.color);
      setColor('background', branding.backgroundColor);
      setColor('surface', branding.surfaceColor);
      setColor('text', branding.textColor);
      $('fm-c-radius').value = String(branding.radius);
      $('fm-c-radius-output').textContent = `${branding.radius} px`;
      const embed = embedOf(form);
      $('fm-c-embed-enabled').checked = !!embed.enabled;
      $('fm-embed-fields').hidden = !embed.enabled;
      $('fm-c-origins').value = (embed.allowedOrigins || []).join('\n');
      $('fm-c-embed-height').value = String(embed.height || 820);
      if (isManaged(form)) showImportResult({ googleFormId: googleFormId(form), title: form.googleTitle || form.name, questions: [] }, true);
      if (isManaged(form)) {
        $('fm-c-url').readOnly = true;
        $('fm-import-btn').hidden = true;
      } else {
        $('fm-import-btn').hidden = true;
        const result = $('fm-import-result');
        result.hidden = false;
        result.className = 'fm-import-result';
        result.innerHTML = '<b>Legacy timed link</b><span>Create a new timed form to import it with Google response control and question editing.</span>';
      }
    }
    renderGoogleStatus();
    updatePreview();
    showSub('create');
    $('fm-c-url')?.focus();
  }

  function setColor(name, value) {
    const defaults = { color: 'color', background: 'backgroundColor', surface: 'surfaceColor', text: 'textColor' };
    const normalized = /^#[0-9a-f]{6}$/i.test(value || '') ? value : DEFAULT_BRANDING[defaults[name]];
    if ($(`fm-c-${name}`)) $(`fm-c-${name}`).value = normalized;
    if ($(`fm-c-${name}-text`)) $(`fm-c-${name}-text`).value = normalized;
  }

  async function previewGoogleForm() {
    const url = $('fm-c-url')?.value.trim() || '';
    showError('fm-wizard-error', '');
    if (!googleStatus.connected) {
      showError('fm-wizard-error', 'Connect Google Forms before importing. You can still create a legacy timed link without importing.');
      return;
    }
    if (!isGoogleEditUrl(url)) {
      showError('fm-wizard-error', 'Import requires the owner edit URL from Google Forms, ending in /edit. Public forms.gle and /d/e/ links can only be used in legacy link mode.');
      return;
    }
    const button = $('fm-import-btn');
    button.disabled = true;
    button.textContent = 'Importing…';
    try {
      const data = await api('/forms/google/preview', { method: 'POST', body: { googleFormUrl: url } });
      const source = data.form || data;
      const imported = {
        googleFormId: String(source.googleFormId || source.formId || source.id || ''),
        title: source.title || source.name || '',
        description: source.description || '',
        questions: source.questions || data.questions || source.items || [],
      };
      if (!imported.googleFormId) throw new Error('Google returned the form without an ID. Check that this account can edit it.');
      importedGoogleForm = imported;
      importedUrl = url;
      $('fm-c-google-id').value = imported.googleFormId;
      if (!$('fm-c-title').value.trim() && imported.title) $('fm-c-title').value = imported.title;
      showImportResult(imported, false);
      updatePreview();
    } catch (error) {
      importedGoogleForm = null;
      $('fm-c-google-id').value = '';
      showError('fm-wizard-error', error.message || 'Could not import this Google Form.');
    } finally {
      button.disabled = !googleStatus.connected;
      button.textContent = 'Import';
    }
  }

  function showImportResult(imported, existing) {
    const result = $('fm-import-result');
    if (result) {
      result.hidden = false;
      result.className = 'fm-import-result is-ok';
      result.innerHTML = `<b>${existing ? 'Managed Google Form' : 'Imported from Google'}</b><span>${esc(imported.title || 'Questions and response settings are connected.')}${imported.questions?.length ? ` · ${imported.questions.length} items` : ''}</span>`;
    }
    const list = $('fm-import-questions');
    if (!list) return;
    const normalized = (imported.questions || []).map(normalizeQuestion);
    if (!normalized.length) {
      list.hidden = true;
      list.innerHTML = '';
      return;
    }
    list.hidden = false;
    list.innerHTML = `<b>Imported items</b><ol>${normalized.slice(0, 6).map(question => `<li><span>${esc(question.title || 'Untitled item')}</span><small>${esc(TYPE_LABELS[question.type] || question.type)}</small></li>`).join('')}</ol>${normalized.length > 6 ? `<p>Plus ${normalized.length - 6} more items. Edit all questions after creating the timed form.</p>` : ''}`;
  }

  function validGoogleUrl(value) {
    return /^https:\/\/(?:docs\.google\.com\/forms\/d\/(?:e\/)?[\w-]+(?:\/|$)|forms\.gle\/[\w-]+(?:[/?#]|$))/i.test(value);
  }

  function isGoogleEditUrl(value) {
    return /^https:\/\/docs\.google\.com\/forms\/d\/(?!e\/)[\w-]+\/edit(?:[/?#]|$)/i.test(value);
  }

  function parseOrigins(value) {
    const origins = [];
    for (const line of String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
      let parsed;
      try { parsed = new URL(line); }
      catch { throw new Error(`Approved website origin is invalid: ${line}`); }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== '/')) {
        throw new Error(`Use an HTTPS origin without a path, such as https://www.example.org (${line})`);
      }
      origins.push(parsed.origin);
    }
    const unique = [...new Set(origins)];
    if (unique.length > 10) throw new Error('Add no more than 10 approved website origins.');
    return unique;
  }

  function readBranding() {
    const values = {
      orgName: $('fm-c-org').value.trim(),
      intro: $('fm-c-intro').value.trim(),
      color: $('fm-c-color-text').value.trim(),
      backgroundColor: $('fm-c-background-text').value.trim(),
      surfaceColor: $('fm-c-surface-text').value.trim(),
      textColor: $('fm-c-text-text').value.trim(),
      radius: Number($('fm-c-radius').value),
    };
    for (const field of ['color', 'backgroundColor', 'surfaceColor', 'textColor']) {
      if (!/^#[0-9a-f]{6}$/i.test(values[field])) throw new Error('Use six-digit hex values for all design colors.');
    }
    return values;
  }

  async function saveForm() {
    showError('fm-wizard-error', '');
    const name = $('fm-c-title').value.trim();
    const googleFormUrl = $('fm-c-url').value.trim();
    const timezone = $('fm-c-tz').value || 'UTC';
    if (!name) return showError('fm-wizard-error', 'Enter a display name.');
    if (!validGoogleUrl(googleFormUrl)) return showError('fm-wizard-error', 'Paste a valid Google Forms URL.');
    let openAt;
    let closeAt;
    let branding;
    let allowedOrigins;
    try {
      openAt = zonedLocalToIso($('fm-c-open').value, timezone);
      closeAt = zonedLocalToIso($('fm-c-close').value, timezone);
      branding = readBranding();
      allowedOrigins = $('fm-c-embed-enabled').checked ? parseOrigins($('fm-c-origins').value) : [];
    } catch (error) {
      return showError('fm-wizard-error', error.message);
    }
    if (openAt && closeAt && new Date(openAt) >= new Date(closeAt)) return showError('fm-wizard-error', 'Close time must be after open time.');
    if ($('fm-c-embed-enabled').checked && !allowedOrigins.length) return showError('fm-wizard-error', 'Add at least one approved website origin before enabling embedding.');
    const embedHeight = Number($('fm-c-embed-height').value || 820);
    if (!Number.isInteger(embedHeight) || embedHeight < 480 || embedHeight > 2000) return showError('fm-wizard-error', 'Embed height must be between 480 and 2,000 pixels.');

    const selectedGoogleId = importedGoogleForm?.googleFormId || $('fm-c-google-id').value;
    if (!selectedGoogleId && isGoogleEditUrl(googleFormUrl)) {
      return showError('fm-wizard-error', googleStatus.connected
        ? 'Click Import before saving this owner edit URL. To create a legacy link instead, paste the public responder URL.'
        : 'Connect Google Forms to import this owner edit URL, or paste the public responder URL for a legacy timed link.');
    }
    const body = {
      name,
      googleFormUrl,
      openAt,
      closeAt,
      timezone,
      branding,
      embed: { enabled: $('fm-c-embed-enabled').checked, allowedOrigins, height: embedHeight },
    };
    if (selectedGoogleId) body.googleFormId = selectedGoogleId;

    const submit = $('fm-wizard-submit');
    submit.disabled = true;
    submit.textContent = editingId ? 'Saving…' : 'Creating…';
    try {
      const result = await api(editingId ? `/forms/${editingId}` : '/forms', {
        method: editingId ? 'PATCH' : 'POST',
        body,
      });
      const saved = result.form || result;
      const savedId = formId(saved) || editingId;
      toast(editingId ? 'Timed form updated.' : selectedGoogleId ? 'Google Form imported and scheduled.' : 'Legacy timed link created.');
      await loadList();
      if (savedId && forms.some(form => formId(form) === savedId)) await showDetail(savedId);
      else showSub('list');
    } catch (error) {
      showError('fm-wizard-error', error.message || 'Could not save this timed form.');
    } finally {
      submit.disabled = false;
      submit.textContent = editingId ? 'Save changes' : 'Create form';
    }
  }

  async function showDetail(id) {
    currentId = id;
    let form = forms.find(item => formId(item) === id);
    if (!form) return;
    try {
      const data = await api(`/forms/${id}`);
      form = data.form || data;
      const index = forms.findIndex(item => formId(item) === id);
      if (index >= 0) forms[index] = form;
    } catch {}
    const status = formStatus(form);
    const managed = isManaged(form);
    $('fm-detail-title').textContent = form.name || 'Timed form';
    $('fm-detail-access').textContent = String(form.stats?.views ?? 0);
    $('fm-detail-status-chip').textContent = status.label;
    $('fm-detail-status-chip').className = `fm-status-chip chip-${status.key}`;
    $('fm-detail-link-text').textContent = publicLink(form);
    $('fm-detail-preview').href = publicLink(form);
    $('fm-detail-open').textContent = form.openAt ? fmtDate(form.openAt, form.timezone) : 'Available immediately';
    $('fm-detail-close').textContent = form.closeAt ? fmtDate(form.closeAt, form.timezone) : 'No closing time';
    $('fm-detail-tz').textContent = form.timezone || 'UTC';
    $('fm-detail-gform').href = managed
      ? `https://docs.google.com/forms/d/${encodeURIComponent(googleFormId(form))}/edit`
      : form.googleFormUrl || '#';
    $('fm-detail-copy').onclick = () => copyText(publicLink(form), $('fm-detail-copy'), 'Hosted link copied.');
    $('fm-detail-edit').onclick = () => showCreate(id);
    $('fm-detail-delete').onclick = () => deleteForm(id);
    $('fm-detail-sync').hidden = !managed;
    $('fm-detail-sync').onclick = () => syncGoogle(form);
    renderSyncState(form);
    renderEmbed(form);
    showSub('detail');
    if (managed) await loadQuestions(id);
    else renderLegacyQuestions();
  }

  function renderSyncState(form) {
    const managed = isManaged(form);
    const sync = form.googleSync || form.google?.sync || {};
    const status = String(sync.status || form.googleSyncStatus || (managed ? 'managed' : 'legacy')).toLowerCase();
    const chip = $('fm-detail-sync-chip');
    const note = $('fm-detail-sync-note');
    if (!managed) {
      chip.textContent = 'Legacy link';
      chip.className = 'fm-status-chip chip-draft';
      note.className = 'fm-sync-note is-warning';
      note.textContent = 'This form is not connected to Google. The hosted page follows your time window, but anyone with the original Google URL may still submit while Google accepts responses.';
      return;
    }
    const failed = ['error', 'failed', 'reauthorize', 'revoked'].includes(status) || !!sync.lastError;
    chip.textContent = failed ? 'Needs attention' : 'Managed';
    chip.className = `fm-status-chip ${failed ? 'chip-error' : 'chip-open'}`;
    note.className = `fm-sync-note ${failed ? 'is-error' : 'is-ok'}`;
    note.textContent = failed
      ? (sync.lastError || 'Google response control could not be synchronized. Reconnect Google Forms, then sync again.')
      : `Submit Later synchronizes Google's accepting-responses setting with this window${sync.lastSuccessAt || sync.lastSyncedAt ? ` · Last checked ${fmtDate(sync.lastSuccessAt || sync.lastSyncedAt, form.timezone)}` : ''}.`;
  }

  function renderEmbed(form) {
    const embed = embedOf(form);
    const enabled = !!embed.enabled;
    const code = $('fm-embed-code');
    const summary = $('fm-embed-summary');
    const copy = $('fm-copy-embed');
    if (!enabled) {
      code.value = '';
      code.disabled = true;
      copy.disabled = true;
      summary.textContent = 'Embedding is off. Edit this form to approve the website origins that may frame it.';
      return;
    }
    const height = Number(embed.height || 820);
    const snippet = `<iframe src="${embedLink(form)}" title="${escapeAttribute(form.name || 'Timed form')}" style="width:100%;height:${height}px;border:0" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    code.disabled = false;
    code.value = snippet;
    copy.disabled = false;
    summary.textContent = `${(embed.allowedOrigins || []).length} approved website ${(embed.allowedOrigins || []).length === 1 ? 'origin' : 'origins'} · ${height}px high`;
    copy.onclick = () => copyText(snippet, copy, 'Embed code copied.');
  }

  function escapeAttribute(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function syncGoogle(form) {
    const button = $('fm-detail-sync');
    button.disabled = true;
    button.textContent = 'Syncing…';
    try {
      const result = await api(`/forms/${formId(form)}/google/sync`, { method: 'POST' });
      const updated = result.form || result;
      if (formId(updated)) {
        const index = forms.findIndex(item => formId(item) === formId(form));
        if (index >= 0) forms[index] = updated;
      }
      toast('Google response settings synchronized.');
      await showDetail(formId(form));
    } catch (error) {
      toast(error.message || 'Could not synchronize with Google.');
    } finally {
      button.disabled = false;
      button.textContent = 'Sync Google';
    }
  }

  async function deleteForm(id) {
    const form = forms.find(item => formId(item) === id);
    if (!confirm(`Delete “${form?.name || 'this form'}”? The hosted and embedded links will stop working.`)) return;
    try {
      await api(`/forms/${id}`, { method: 'DELETE' });
      forms = forms.filter(item => formId(item) !== id);
      renderList();
      showSub('list');
      toast('Timed form deleted.');
    } catch (error) {
      toast(error.message || 'Could not delete this form.');
    }
  }

  function normalizeQuestion(item) {
    const rawQuestion = item?.questionItem?.question || item?.question || {};
    const rawType = item?.type || rawQuestion.type || '';
    let type = rawType;
    if (!SUPPORTED_TYPES.has(type)) {
      if (rawQuestion.textQuestion) type = rawQuestion.textQuestion.paragraph ? 'paragraph' : 'shortText';
      else if (rawQuestion.choiceQuestion) {
        const choiceType = String(rawQuestion.choiceQuestion.type || '').toUpperCase();
        type = choiceType === 'RADIO' ? 'multipleChoice' : choiceType === 'CHECKBOX' ? 'checkboxes' : choiceType === 'DROP_DOWN' ? 'dropdown' : 'unsupported';
      } else type = 'unsupported';
    }
    const rawOptions = item?.options || rawQuestion.choiceQuestion?.options || [];
    return {
      itemId: String(item?.itemId || item?.id || item?.questionId || ''),
      title: item?.title || rawQuestion.title || 'Untitled item',
      type,
      required: !!(item?.required ?? rawQuestion.required),
      options: rawOptions.map(option => String(option?.value ?? option?.text ?? option)),
      supported: item?.supported !== false && SUPPORTED_TYPES.has(type),
    };
  }

  async function loadQuestions(id) {
    const list = $('fm-question-list');
    $('fm-question-add').hidden = false;
    $('fm-question-summary').textContent = 'Question changes are written to the connected Google Form.';
    $('fm-question-status').textContent = 'Loading questions…';
    list.innerHTML = '';
    $('fm-question-form').hidden = true;
    try {
      const data = await api(`/forms/${id}/questions`);
      questions = (data.questions || data.items || (Array.isArray(data) ? data : [])).map(normalizeQuestion);
      $('fm-question-status').textContent = questions.length ? `${questions.length} ${questions.length === 1 ? 'item' : 'items'}` : 'No questions yet.';
      renderQuestions();
    } catch (error) {
      questions = [];
      $('fm-question-status').textContent = error.message || 'Could not load questions from Google.';
    }
  }

  function renderLegacyQuestions() {
    questions = [];
    $('fm-question-add').hidden = true;
    $('fm-question-form').hidden = true;
    $('fm-question-list').innerHTML = '';
    $('fm-question-summary').textContent = 'Question editing requires an imported Google Form.';
    $('fm-question-status').textContent = 'This is a legacy timed link. Connect Google Forms and import the form to manage its questions.';
  }

  function renderQuestions() {
    const list = $('fm-question-list');
    list.innerHTML = questions.map((question, index) => `<article class="fm-question-item" data-item-id="${esc(question.itemId)}">
      <div class="fm-question-number" aria-hidden="true">${index + 1}</div>
      <div class="fm-question-copy"><div><b>${esc(question.title)}</b>${question.required ? '<span class="fm-required-mark">Required</span>' : ''}</div><span>${esc(TYPE_LABELS[question.type] || 'Google Forms item')}${question.options.length ? ` · ${question.options.length} options` : ''}</span>${!question.supported ? '<small>This item type is preserved but must be edited in Google Forms.</small>' : ''}</div>
      <div class="fm-question-actions">${question.supported ? '<button type="button" data-question-action="edit">Edit</button><button type="button" class="is-danger" data-question-action="delete">Delete</button>' : ''}</div>
    </article>`).join('');
    list.querySelectorAll('[data-question-action]').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.closest('[data-item-id]').dataset.itemId;
        if (button.dataset.questionAction === 'edit') openQuestionEditor(id);
        if (button.dataset.questionAction === 'delete') deleteQuestion(id);
      });
    });
  }

  function openQuestionEditor(id = '') {
    const question = questions.find(item => item.itemId === id);
    $('fm-q-id').value = question?.itemId || '';
    $('fm-q-type').value = question?.type || 'shortText';
    $('fm-q-type').disabled = !!question;
    $('fm-q-type').title = question ? 'Question type cannot be changed safely. Delete this question and add a new one to use another type.' : '';
    $('fm-q-type-hint').hidden = !question;
    $('fm-q-title').value = question?.title || '';
    $('fm-q-required').checked = !!question?.required;
    $('fm-q-options').value = (question?.options || []).join('\n');
    $('fm-question-save').textContent = question ? 'Save question' : 'Add question';
    $('fm-question-form').hidden = false;
    showError('fm-question-error', '');
    toggleQuestionOptions();
    $('fm-q-title').focus();
  }

  function closeQuestionEditor() {
    $('fm-question-form').hidden = true;
    showError('fm-question-error', '');
  }

  function toggleQuestionOptions() {
    $('fm-q-options-group').hidden = !OPTION_TYPES.has($('fm-q-type').value);
  }

  async function saveQuestion() {
    showError('fm-question-error', '');
    const itemId = $('fm-q-id').value;
    const type = $('fm-q-type').value;
    const title = $('fm-q-title').value.trim();
    const options = $('fm-q-options').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (!title) return showError('fm-question-error', 'Enter the question text.');
    if (OPTION_TYPES.has(type) && options.length < 1) return showError('fm-question-error', 'Add at least one option. Put each option on its own line.');
    if (OPTION_TYPES.has(type) && new Set(options).size !== options.length) return showError('fm-question-error', 'Each option must be unique.');
    if (options.length > 100 || options.some(option => option.length > 200)) return showError('fm-question-error', 'Use no more than 100 options, with up to 200 characters each.');
    const body = { type, title, required: $('fm-q-required').checked, options: OPTION_TYPES.has(type) ? options : [] };
    const button = $('fm-question-save');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await api(itemId ? `/forms/${currentId}/questions/${encodeURIComponent(itemId)}` : `/forms/${currentId}/questions`, {
        method: itemId ? 'PATCH' : 'POST',
        body,
      });
      toast(itemId ? 'Question updated in Google Forms.' : 'Question added to Google Forms.');
      closeQuestionEditor();
      await loadQuestions(currentId);
    } catch (error) {
      showError('fm-question-error', error.message || 'Could not save this question.');
    } finally {
      button.disabled = false;
      button.textContent = itemId ? 'Save question' : 'Add question';
    }
  }

  async function deleteQuestion(itemId) {
    const question = questions.find(item => item.itemId === itemId);
    if (!confirm(`Delete “${question?.title || 'this question'}” from the Google Form? This cannot be undone here.`)) return;
    try {
      await api(`/forms/${currentId}/questions/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
      toast('Question deleted from Google Forms.');
      await loadQuestions(currentId);
    } catch (error) {
      toast(error.message || 'Could not delete this question.');
    }
  }

  function syncColorPair(name, source) {
    const picker = $(`fm-c-${name}`);
    const text = $(`fm-c-${name}-text`);
    if (!picker || !text) return;
    if (source === 'picker') text.value = picker.value;
    else if (/^#[0-9a-f]{6}$/i.test(text.value.trim())) picker.value = text.value.trim();
  }

  function syncAllColorPairs(source) {
    ['color', 'background', 'surface', 'text'].forEach(name => syncColorPair(name, source));
  }

  function updatePreview() {
    const canvas = $('fm-preview-canvas');
    const card = $('fm-preview-card');
    if (!canvas || !card) return;
    const accent = $('fm-c-color-text')?.value || DEFAULT_BRANDING.color;
    const background = $('fm-c-background-text')?.value || DEFAULT_BRANDING.backgroundColor;
    const surface = $('fm-c-surface-text')?.value || DEFAULT_BRANDING.surfaceColor;
    const text = $('fm-c-text-text')?.value || DEFAULT_BRANDING.textColor;
    const radius = Number($('fm-c-radius')?.value || 16);
    if (/^#[0-9a-f]{6}$/i.test(background)) canvas.style.background = background;
    if (/^#[0-9a-f]{6}$/i.test(surface)) card.style.background = surface;
    if (/^#[0-9a-f]{6}$/i.test(text)) card.style.color = text;
    if (/^#[0-9a-f]{6}$/i.test(accent)) $('fm-preview-accent').style.background = accent;
    card.style.borderRadius = `${radius}px`;
    $('fm-preview-org').textContent = ($('fm-c-org')?.value.trim() || 'Your organization').toUpperCase();
    $('fm-preview-title').textContent = $('fm-c-title')?.value.trim() || importedGoogleForm?.title || 'Your timed form';
    $('fm-preview-intro').textContent = $('fm-c-intro')?.value.trim() || 'Your introduction appears here.';
    $('fm-c-radius-output').textContent = `${radius} px`;
    const contrast = contrastRatio(text, surface);
    $('fm-contrast-warning').hidden = !Number.isFinite(contrast) || contrast >= 4.5;
  }

  function contrastRatio(foreground, background) {
    const luminance = hex => {
      if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return NaN;
      const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
        .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const a = luminance(foreground);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  async function copyText(value, button, message) {
    try {
      await navigator.clipboard.writeText(value);
      toast(message || 'Copied.');
      if (button) {
        const original = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = original; }, 1500);
      }
    } catch {
      toast('Copy failed. Select the text and copy it manually.');
    }
  }

  function attachListeners() {
    $('fm-new-btn')?.addEventListener('click', () => showCreate());
    $('fm-wizard-cancel')?.addEventListener('click', () => showSub('list'));
    $('fm-wizard-cancel-bottom')?.addEventListener('click', () => showSub('list'));
    $('fm-detail-back')?.addEventListener('click', () => showSub('list'));
    $('fm-wizard-form')?.addEventListener('submit', event => { event.preventDefault(); saveForm(); });
    $('fm-google-connect')?.addEventListener('click', event => connectGoogle(event.currentTarget));
    $('fm-wizard-connect')?.addEventListener('click', event => connectGoogle(event.currentTarget));
    $('fm-google-disconnect')?.addEventListener('click', disconnectGoogle);
    $('fm-import-btn')?.addEventListener('click', previewGoogleForm);
    $('fm-c-url')?.addEventListener('input', () => {
      if (importedGoogleForm && $('fm-c-url').value.trim() !== importedUrl) {
        importedGoogleForm = null;
        $('fm-c-google-id').value = '';
        $('fm-import-result').hidden = true;
        $('fm-import-questions').hidden = true;
      }
    });
    $('fm-c-embed-enabled')?.addEventListener('change', event => { $('fm-embed-fields').hidden = !event.target.checked; });
    ['fm-c-title', 'fm-c-org', 'fm-c-intro', 'fm-c-radius'].forEach(id => $(id)?.addEventListener('input', updatePreview));
    ['color', 'background', 'surface', 'text'].forEach(name => {
      $(`fm-c-${name}`)?.addEventListener('input', () => { syncColorPair(name, 'picker'); updatePreview(); });
      $(`fm-c-${name}-text`)?.addEventListener('input', () => { syncColorPair(name, 'text'); updatePreview(); });
    });
    $('fm-question-add')?.addEventListener('click', () => openQuestionEditor());
    $('fm-question-cancel')?.addEventListener('click', closeQuestionEditor);
    $('fm-q-type')?.addEventListener('change', toggleQuestionOptions);
    $('fm-question-form')?.addEventListener('submit', event => { event.preventDefault(); saveQuestion(); });
  }

  function handleOAuthResult() {
    const params = new URLSearchParams(location.search);
    const result = params.get('googleForms');
    if (!result) return;
    if (result === 'connected') toast('Google Forms connected. You can now import a form you own or edit.');
    else if (result === 'denied') toast('Google Forms permission was not granted. No Google access was saved.');
    else if (result === 'invalid_state') toast('The Google connection link expired. Start the connection again.');
    else toast('Google Forms could not be connected. Please try again.');
    params.delete('googleForms');
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash || '#forms'}`);
  }

  async function init() {
    if (!initialised) {
      initialised = true;
      attachListeners();
      handleOAuthResult();
    }
    await Promise.all([loadGoogleStatus(), loadList()]);
  }

  return { init, showCreate, showDetail };
})();
