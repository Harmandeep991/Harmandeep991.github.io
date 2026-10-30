/* Webhook Scheduler module for Submit Later dashboard.
 * Loaded by account.html. Relies on globals from app.js:
 *   api(path, opts)  — authenticated fetch, returns parsed JSON, throws ApiError
 *   toast(text)      — show a toast notification
 * All DOM IDs are prefixed sc- to avoid collisions.
 */
window.schedulerModule = (function () {
  'use strict';

  let _initialised = false;
  let _currentJobId = null;
  let _newJobId = null;
  let _schedType = 'once';

  // ── DOM helpers ──────────────────────────────────────────────────────────────

  function $id(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Sub-view switcher ────────────────────────────────────────────────────────

  function _showSub(name) {
    ['list', 'create', 'detail'].forEach(function (n) {
      var el = $id('sc-subview-' + n);
      if (el) el.hidden = (n !== name);
    });
  }

  // ── Schedule helpers ─────────────────────────────────────────────────────────

  var SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function _tzShort(tz) {
    var map = {
      'Asia/Kolkata': 'IST',
      'UTC': 'UTC',
      'America/New_York': 'ET',
      'America/Los_Angeles': 'PT',
      'Europe/London': 'GMT',
      'Asia/Singapore': 'SGT',
    };
    return map[tz] || (tz || '');
  }

  function schedLabel(s) {
    if (!s) return '—';
    if (s.type === 'once') {
      if (!s.at) return 'Once';
      try {
        return 'Once on ' + new Date(s.at).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric',
        });
      } catch (_) { return 'Once on ' + s.at; }
    }
    if (s.type === 'interval') {
      var n = s.interval || 0;
      var u = s.intervalUnit || 'minutes';
      return 'Every ' + n + ' ' + (n === 1 ? u.replace(/s$/, '') : u);
    }
    if (s.type === 'daily') {
      var tz = _tzShort(s.timezone);
      return 'Every day at ' + (s.at || '') + (tz ? ' ' + tz : '');
    }
    if (s.type === 'weekly') {
      var tz = _tzShort(s.timezone);
      var day = SHORT_DAYS[s.dayOfWeek] || '';
      return 'Every ' + day + ' at ' + (s.at || '') + (tz ? ' ' + tz : '');
    }
    return '—';
  }

  function _relTime(iso) {
    if (!iso) return '—';
    var diff = new Date(iso) - Date.now();
    var abs = Math.abs(diff);
    var past = diff < 0;
    if (abs < 60000) return past ? 'just now' : 'in a moment';
    if (abs < 3600000) {
      var m = Math.round(abs / 60000);
      return past ? m + 'm ago' : 'in ' + m + 'm';
    }
    if (abs < 86400000) {
      var h = Math.round(abs / 3600000);
      return past ? h + 'h ago' : 'in ' + h + 'h';
    }
    var d = Math.round(abs / 86400000);
    return past ? d + 'd ago' : 'in ' + d + 'd';
  }

  function _statusCls(s) {
    return { active: 'sc-active', paused: 'sc-paused', completed: 'sc-completed', failed: 'sc-failed' }[s] || 'sc-active';
  }

  // ── Usage bar ────────────────────────────────────────────────────────────────

  async function _loadUsage() {
    try {
      var d = await api('/scheduler/usage');
      var wrap = $id('sc-usage-wrap');
      if (!wrap) return;
      var jobUsed = (d.used && d.used.jobs != null) ? d.used.jobs : 0;
      var jobMax  = (d.limits && d.limits.maxJobs)  ? d.limits.maxJobs : 5;
      var runUsed = (d.used && d.used.runsThisMonth != null) ? d.used.runsThisMonth : 0;
      var runMax  = (d.limits && d.limits.maxRunsPerMonth)   ? d.limits.maxRunsPerMonth : 200;
      var jp = Math.min(100, jobMax > 0 ? Math.round(jobUsed / jobMax * 100) : 0);
      var rp = Math.min(100, runMax > 0 ? Math.round(runUsed / runMax * 100) : 0);
      var jWarn = jp >= 80 ? ' sc-usage-warn' : '';
      var rWarn = rp >= 80 ? ' sc-usage-warn' : '';
      wrap.innerHTML =
        '<div class="sc-usage-bar-wrap">' +
          '<div class="sc-usage-item">' +
            '<span class="sc-usage-label">Jobs <strong>' + jobUsed + ' / ' + jobMax + '</strong></span>' +
            '<div class="sc-usage-track"><div class="sc-usage-fill' + jWarn + '" style="width:' + jp + '%"></div></div>' +
          '</div>' +
          '<div class="sc-usage-item">' +
            '<span class="sc-usage-label">Runs this month <strong>' + runUsed + ' / ' + runMax + '</strong></span>' +
            '<div class="sc-usage-track"><div class="sc-usage-fill' + rWarn + '" style="width:' + rp + '%"></div></div>' +
          '</div>' +
        '</div>';
    } catch (_) {
      // Non-critical — silently ignore
    }
  }

  // ── Job list ─────────────────────────────────────────────────────────────────

  async function _loadJobs() {
    var list  = $id('sc-list');
    var empty = $id('sc-empty');
    if (list) list.innerHTML = '<div class="sc-loading">Loading jobs…</div>';
    try {
      var data = await api('/scheduler/jobs');
      var jobs = data.jobs || [];
      if (!list) return;
      if (jobs.length === 0) {
        list.innerHTML = '';
        if (empty) empty.hidden = false;
        return;
      }
      if (empty) empty.hidden = true;
      list.innerHTML = jobs.map(_jobCardHTML).join('');
    } catch (e) {
      if (list) list.innerHTML = '<p class="sc-load-err">Could not load jobs — ' + esc(e.message) + '</p>';
    }
  }

  function _jobCardHTML(j) {
    var method = (j.method || 'POST').toUpperCase();
    var mMap = { GET: 'sc-get', POST: 'sc-post', PUT: 'sc-put', PATCH: 'sc-patch', DELETE: 'sc-delete' };
    var mCls = mMap[method] || 'sc-post';
    var status = j.status || 'active';
    var isPaused = status === 'paused';
    var nextRun = j.nextRunAt
      ? _relTime(j.nextRunAt)
      : (status === 'completed' ? 'Completed' : '—');
    var runCount = j.runCount != null ? j.runCount : 0;
    var id = esc(j._id);

    var pauseIcon = isPaused
      ? '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 3l9 5-9 5z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor"/></svg>';

    return (
      '<div class="sc-job-card" onclick="schedulerModule.showDetail(\'' + id + '\')">' +
        '<div class="sc-card-head">' +
          '<span class="sc-method ' + mCls + '">' + method + '</span>' +
          '<span class="sc-status ' + _statusCls(status) + '">' + status + '</span>' +
        '</div>' +
        '<div class="sc-card-name">' + esc(j.name) + '</div>' +
        '<div class="sc-card-url">' + esc(j.url) + '</div>' +
        '<div class="sc-card-meta">' +
          '<span class="sc-card-sched">' + esc(schedLabel(j.schedule)) + '</span>' +
          '<span class="sc-card-next">Next: ' + esc(nextRun) + '</span>' +
        '</div>' +
        '<div class="sc-card-footer">' +
          '<span class="sc-run-count">' + runCount + ' run' + (runCount === 1 ? '' : 's') + '</span>' +
          '<div class="sc-card-actions" onclick="event.stopPropagation()">' +
            '<button class="sc-icon-btn sc-btn-run" title="Run now" aria-label="Run now"' +
              ' onclick="schedulerModule._runNow(\'' + id + '\')">' +
              '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 2l10 6-10 6z" fill="currentColor"/></svg>' +
            '</button>' +
            '<button class="sc-icon-btn sc-btn-pause" title="' + (isPaused ? 'Resume' : 'Pause') + '"' +
              ' aria-label="' + (isPaused ? 'Resume' : 'Pause') + '"' +
              ' onclick="schedulerModule._togglePause(\'' + id + '\',\'' + esc(status) + '\')">' +
              pauseIcon +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  // ── Create wizard ────────────────────────────────────────────────────────────

  function showCreate(jobId) {
    _currentJobId = jobId || null;
    _schedType = 'once';

    // Reset form fields
    ['sc-c-name', 'sc-c-url', 'sc-c-headers', 'sc-c-body'].forEach(function (id) {
      var el = $id(id); if (el) el.value = '';
    });
    var methodEl = $id('sc-c-method');
    if (methodEl) methodEl.value = 'POST';

    // Reset wizard panes
    var p1 = $id('sc-wiz-pane-1'); if (p1) p1.hidden = false;
    var p2 = $id('sc-wiz-pane-2'); if (p2) p2.hidden = true;
    var p3 = $id('sc-wiz-pane-3'); if (p3) p3.hidden = true;
    _setWizStep(1);
    _pickSchedType('once');

    // Reset submit button
    var btn = $id('sc-wiz-submit-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'Create job'; }

    _showSub('create');
  }

  function _setWizStep(n) {
    for (var i = 1; i <= 3; i++) {
      var el = $id('sc-ws-' + i);
      if (!el) continue;
      el.classList.remove('sc-wiz-active', 'sc-wiz-done');
      if (i < n) el.classList.add('sc-wiz-done');
      if (i === n) el.classList.add('sc-wiz-active');
    }
  }

  function _pickSchedType(type) {
    _schedType = type;
    document.querySelectorAll('#sc-subview-create .sc-stt-btn').forEach(function (b) {
      b.classList.toggle('sc-stt-active', b.dataset.type === type);
    });
    ['once', 'interval', 'daily', 'weekly'].forEach(function (t) {
      var el = $id('sc-sched-' + t);
      if (el) el.hidden = (t !== type);
    });
  }

  function _wizStep1Next() {
    var name = ($id('sc-c-name') ? $id('sc-c-name').value : '').trim();
    var url  = ($id('sc-c-url')  ? $id('sc-c-url').value  : '').trim();
    if (!name) { toast('Enter a job name'); return; }
    if (!url || !url.startsWith('https://')) { toast('Enter a valid HTTPS URL'); return; }
    var p1 = $id('sc-wiz-pane-1'); if (p1) p1.hidden = true;
    var p2 = $id('sc-wiz-pane-2'); if (p2) p2.hidden = false;
    _setWizStep(2);
  }

  function _wizBack() {
    var p2 = $id('sc-wiz-pane-2'); if (p2) p2.hidden = true;
    var p1 = $id('sc-wiz-pane-1'); if (p1) p1.hidden = false;
    _setWizStep(1);
  }

  function _buildSchedule() {
    if (_schedType === 'once') {
      var date = $id('sc-c-once-date') ? $id('sc-c-once-date').value : '';
      var time = $id('sc-c-once-time') ? $id('sc-c-once-time').value : '';
      var tz   = $id('sc-c-once-tz')   ? $id('sc-c-once-tz').value   : 'Asia/Kolkata';
      if (!date || !time) return null;
      return { type: 'once', at: new Date(date + 'T' + time).toISOString(), timezone: tz };
    }
    if (_schedType === 'daily') {
      var t  = $id('sc-c-daily-time') ? $id('sc-c-daily-time').value : '';
      var tz = $id('sc-c-daily-tz')   ? $id('sc-c-daily-tz').value   : 'Asia/Kolkata';
      if (!t) return null;
      return { type: 'daily', at: t, timezone: tz };
    }
    if (_schedType === 'weekly') {
      var day = parseInt(($id('sc-c-weekly-day') ? $id('sc-c-weekly-day').value : '1'), 10);
      var t   = $id('sc-c-weekly-time') ? $id('sc-c-weekly-time').value : '';
      var tz  = $id('sc-c-weekly-tz')   ? $id('sc-c-weekly-tz').value   : 'Asia/Kolkata';
      if (!t) return null;
      return { type: 'weekly', at: t, dayOfWeek: day, timezone: tz };
    }
    if (_schedType === 'interval') {
      var val  = parseInt(($id('sc-c-interval-val')  ? $id('sc-c-interval-val').value  : '0'), 10);
      var unit = $id('sc-c-interval-unit') ? $id('sc-c-interval-unit').value : 'hours';
      if (!val || val < 1) return null;
      return { type: 'interval', interval: val, intervalUnit: unit };
    }
    return null;
  }

  function _parseHeaders(raw) {
    if (!raw || !raw.trim()) return {};
    var out = {};
    raw.split('\n').forEach(function (line) {
      var idx = line.indexOf(':');
      if (idx < 0) return;
      var k = line.slice(0, idx).trim();
      var v = line.slice(idx + 1).trim();
      if (k) out[k] = v;
    });
    return out;
  }

  async function _wizStep2Submit() {
    var schedule = _buildSchedule();
    if (!schedule) { toast('Complete the schedule settings'); return; }
    var bodyRaw = ($id('sc-c-body') ? $id('sc-c-body').value : '').trim();
    var payload = {
      name:     ($id('sc-c-name')   ? $id('sc-c-name').value   : '').trim(),
      url:      ($id('sc-c-url')    ? $id('sc-c-url').value     : '').trim(),
      method:   ($id('sc-c-method') ? $id('sc-c-method').value  : 'POST'),
      headers:  _parseHeaders($id('sc-c-headers') ? $id('sc-c-headers').value : ''),
      schedule: schedule,
    };
    if (bodyRaw) payload.body = bodyRaw;

    var btn = $id('sc-wiz-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
    try {
      var d = _currentJobId
        ? await api('/scheduler/jobs/' + _currentJobId, { method: 'PATCH', body: payload })
        : await api('/scheduler/jobs', { method: 'POST', body: payload });
      _newJobId = (d.job && d.job._id) ? d.job._id : _currentJobId;
      var doneCard = $id('sc-done-card');
      if (doneCard) {
        var mMap = { GET: 'sc-get', POST: 'sc-post', PUT: 'sc-put', PATCH: 'sc-patch', DELETE: 'sc-delete' };
        var m = (payload.method || 'POST').toUpperCase();
        doneCard.innerHTML =
          '<span class="sc-method ' + (mMap[m] || 'sc-post') + '">' + esc(m) + '</span> ' +
          '<strong>' + esc(payload.name) + '</strong><br>' +
          '<span class="sc-done-url">' + esc(payload.url) + '</span><br>' +
          '<span class="sc-done-sched">' + esc(schedLabel(schedule)) + '</span>';
      }
      var p2 = $id('sc-wiz-pane-2'); if (p2) p2.hidden = true;
      var p3 = $id('sc-wiz-pane-3'); if (p3) p3.hidden = false;
      _setWizStep(3);
      toast(_currentJobId ? 'Job updated' : 'Job created');
    } catch (e) {
      toast(e.message || 'Failed to save job');
      if (btn) { btn.disabled = false; btn.textContent = 'Create job'; }
    }
  }

  // ── Job detail ────────────────────────────────────────────────────────────────

  async function showDetail(id) {
    _currentJobId = id;
    _showSub('detail');
    var nameEl = $id('sc-detail-name');
    if (nameEl) nameEl.textContent = 'Loading…';
    try {
      var data = await api('/scheduler/jobs/' + id);
      var job = data.job;
      if (!job) { toast('Job not found'); _showSub('list'); return; }

      _setText('sc-detail-name',       job.name);
      _setText('sc-detail-endpoint',   (job.method || 'POST') + ' ' + job.url);
      _setText('sc-detail-sched',      schedLabel(job.schedule));
      _setText('sc-detail-last-run',   job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : 'Never');
      _setText('sc-detail-next-run',   job.nextRunAt ? 'Next run: ' + new Date(job.nextRunAt).toLocaleString() : (job.status === 'completed' ? 'Completed' : '—'));

      var chip = $id('sc-detail-status');
      if (chip) { chip.textContent = job.status || 'active'; chip.className = 'sc-status ' + _statusCls(job.status || 'active'); }

      var pauseBtn = $id('sc-detail-pause-btn');
      if (pauseBtn) pauseBtn.textContent = job.status === 'paused' ? 'Resume' : 'Pause';

      _loadDetailLogs(id);
    } catch (e) {
      toast(e.message || 'Failed to load job');
    }
  }

  function _setText(id, text) {
    var el = $id(id); if (el) el.textContent = text != null ? text : '—';
  }

  async function _loadDetailLogs(id) {
    try {
      var data = await api('/scheduler/jobs/' + (id || _currentJobId) + '/logs');
      var logs  = data.logs  || [];
      var stats = data.stats || {};

      _setText('sc-ds-total', stats.totalRuns   != null ? stats.totalRuns   : 0);
      _setText('sc-ds-ok',    stats.successRuns != null ? stats.successRuns : 0);
      _setText('sc-ds-fail',  stats.failRuns    != null ? stats.failRuns    : 0);
      _setText('sc-ds-avg',   stats.avgDurationMs != null ? stats.avgDurationMs + 'ms' : '—');

      var logsEl  = $id('sc-detail-logs');
      var emptyEl = $id('sc-detail-logs-empty');
      if (logs.length === 0) {
        if (logsEl) logsEl.innerHTML = '';
        if (emptyEl) emptyEl.hidden = false;
        return;
      }
      if (emptyEl) emptyEl.hidden = true;
      if (logsEl) logsEl.innerHTML = _renderLogs(logs);
    } catch (_) {
      // Non-critical — logs may be empty on a brand-new job
    }
  }

  function _renderLogs(logs) {
    return logs.map(function (l) {
      var code = l.statusCode;
      var ok = code >= 200 && code < 300;
      var timeout = l.error && l.error.indexOf('timeout') >= 0;
      var cls   = timeout ? 'sc-lrs-timeout' : (ok ? 'sc-lrs-ok' : 'sc-lrs-err');
      var label = timeout ? 'Timeout' : (code || (l.error ? 'Error' : '—'));
      var time  = l.firedAt ? new Date(l.firedAt).toLocaleString() : '—';
      var snippet = l.error || (l.responseBody ? String(l.responseBody).slice(0, 80) : '—');
      return (
        '<div class="sc-log-row">' +
          '<span class="sc-lr-dot ' + cls + '"></span>' +
          '<span class="sc-lr-time">' + esc(time) + '</span>' +
          '<span class="sc-lr-code"><span class="sc-lr-chip ' + cls + '">' + esc(String(label)) + '</span></span>' +
          '<span class="sc-lr-dur">' + (l.durationMs != null ? l.durationMs + 'ms' : '—') + '</span>' +
          '<span class="sc-lr-msg">' + esc(snippet) + '</span>' +
        '</div>'
      );
    }).join('');
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function _runNow(id) {
    try {
      await api('/scheduler/jobs/' + id + '/run', { method: 'POST' });
      toast('Fired — check logs in a moment');
      var detailVisible = $id('sc-subview-detail') && !$id('sc-subview-detail').hidden;
      if (id === _currentJobId && detailVisible) {
        setTimeout(function () { _loadDetailLogs(id); }, 3000);
      } else {
        _loadJobs();
      }
    } catch (e) {
      toast(e.message || 'Failed to run job');
    }
  }

  async function _togglePause(id, currentStatus) {
    var isPaused = currentStatus === 'paused';
    try {
      await api('/scheduler/jobs/' + id, { method: 'PATCH', body: { status: isPaused ? 'active' : 'paused' } });
      toast(isPaused ? 'Job resumed' : 'Job paused');
      var detailVisible = $id('sc-subview-detail') && !$id('sc-subview-detail').hidden;
      if (id === _currentJobId && detailVisible) {
        showDetail(id);
      } else {
        _loadJobs();
      }
    } catch (e) {
      toast(e.message || 'Failed to update job');
    }
  }

  async function _deleteJob(id) {
    var target = id || _currentJobId;
    if (!target) return;
    if (!confirm('Delete this job and all its logs? This cannot be undone.')) return;
    try {
      await api('/scheduler/jobs/' + target, { method: 'DELETE' });
      toast('Job deleted');
      _currentJobId = null;
      _showSub('list');
      _loadJobs();
      _loadUsage();
    } catch (e) {
      toast(e.message || 'Failed to delete job');
    }
  }

  // ── Public init ───────────────────────────────────────────────────────────────

  function init() {
    if (_initialised) { _loadJobs(); return; }
    _initialised = true;

    var newBtn = $id('sc-new-btn');
    if (newBtn) newBtn.addEventListener('click', function () { showCreate(); });

    _loadJobs();
    _loadUsage();
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  return {
    init:           init,
    showCreate:     showCreate,
    showDetail:     showDetail,

    // Exposed for inline onclick handlers in rendered HTML
    _runNow:        _runNow,
    _togglePause:   _togglePause,
    _deleteJob:     _deleteJob,
    _pickSchedType: _pickSchedType,
    _wizStep1Next:  _wizStep1Next,
    _wizBack:       _wizBack,
    _wizStep2Submit: _wizStep2Submit,
    _backToList: function () { _showSub('list'); _loadJobs(); _loadUsage(); },
    _goToNewJob: function () { if (_newJobId) showDetail(_newJobId); else _showSub('list'); },
    _refreshLogs: function () { _loadDetailLogs(_currentJobId); },
    _currentJobId: function () { return _currentJobId; },
  };
})();
