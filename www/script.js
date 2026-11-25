/* ===========================================================
   Cadence — application logic
   All data lives on the device (see native.js). The Android/iOS side
   mirrors the timer, reminders and screen breaks so widgets and
   notifications keep working while the app is closed.
   Sections:
     1. Utilities          6. Notifications & reminders
     2. Storage & state    7. Pomodoro timer & Focus Mode
     3. UI primitives      8. Screen Break Reminder
     4. Tasks model        9. Music player UI
     5. Stats & rewards   10. Views, router, device sync, init
   =========================================================== */
window.CadenceStore.ready.then(() => {
  'use strict';
  const Store = window.CadenceStore;
  const Device = window.CadenceDevice;

  /* ============ 1. Utilities ============ */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const toLocalInput = (d) => { d = new Date(d); return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const tms = (s) => (s ? new Date(s).getTime() : NaN);
  const icon = (id, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  function fmtTime(d) {
    d = new Date(d);
    if (S.settings.general.timeFormat === '24') return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const h = d.getHours() % 12 || 12;
    return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  }
  const fmtDay = (d, o) => new Date(d).toLocaleDateString(undefined, o || { weekday: 'short', month: 'short', day: 'numeric' });
  function relDay(d, ref) {
    const k = dayKey(d), now = ref ? new Date(ref) : new Date();
    if (k === dayKey(now)) return 'Today';
    if (k === dayKey(addDays(now, 1))) return 'Tomorrow';
    if (k === dayKey(addDays(now, -1))) return 'Yesterday';
    return fmtDay(d);
  }
  const fmtWhen = (d, ref) => `${relDay(d, ref)}, ${fmtTime(d)}`;
  function fmtDur(ms) {
    const m = Math.round(ms / MIN);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000)); const m = Math.floor(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}:${pad(m % 60)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
  }
  const fmtSec = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
  function fmtRange(a, b, ref) {
    const A = new Date(a), B = new Date(b);
    return dayKey(A) === dayKey(B) ? `${relDay(A, ref)}, ${fmtTime(A)} – ${fmtTime(B)}` : `${fmtWhen(A, ref)} → ${fmtWhen(B, ref)}`;
  }
  function weekStartOf(d) {
    const x = startOfDay(d); const ws = S.settings.general.weekStart;
    const diff = (x.getDay() - ws + 7) % 7; return addDays(x, -diff);
  }

  /* ============ 2. Storage & state ============ */
  const NS = 'cadence.v1.';
  const corrupted = [];
  // What still gets through while Do Not Disturb is on during focus (alarms and media always do).
  const DND_ALLOW = [
    { id: 'calls', name: 'Calls', icon: 'i-phone' },
    { id: 'repeatCallers', name: 'Repeat callers', icon: 'i-repeat' },
    { id: 'messages', name: 'Messages', icon: 'i-msg' },
    { id: 'events', name: 'Calendar events', icon: 'i-cal' },
  ];
  const DEFAULT_SUGGESTIONS = [
    'Stand up and stretch your arms, back and legs.',
    'Drink a glass of water.',
    'Take a short walk — even around the room helps.',
    'Rest your eyes: look out a window at something far away.',
    'Try box breathing: in 4, hold 4, out 4, hold 4.',
    'Relax without your phone for a few minutes.',
  ];
  const DEFAULTS = {
    settings: {
      general: { theme: 'system', timeFormat: '12', weekStart: 0, sounds: true, timerSound: true, chimeVolume: 0.5, vibrate: true },
      pomodoro: { focus: 25, short: 5, long: 15, interval: 4, autoTransition: true },
      focusMode: { defaultDuration: 25, dnd: false, dndAuto: false, allow: { calls: true, repeatCallers: true, messages: false, events: true }, lockApps: false, allowedApps: [], allowedIosCount: 0, autoMusic: true, trackWork: true },
      screenBreak: { enabled: true, interval: 20, duration: 20, applyTo: 'both', pauseTimer: true, postponeMin: 5 },
      notifications: { categories: { upcoming: true, start: true, endApproach: true, overdue: true, deadline: true, pomodoro: true, breakDone: true, screenBreak: true, daily: true, achievements: true }, defaultReminder: 10, endLead: 10, deadlineLead: 60, dailyTime: '09:00', sound: true },
      music: { category: 'lofi', volume: 0.6, pauseOnBreak: true },
      goals: { dailyFocusMin: 100, weeklyFocusHours: 10, weeklyTasks: 10 },
      breakSuggestions: DEFAULT_SUGGESTIONS.slice(),
    },
    tasks: [], sessions: [], eyeLog: [], notifs: [], ach: {},
    // A fresh install starts with an empty dashboard; widgets are added from Customize.
    widgets: { order: [], hidden: ['pomodoro', 'today', 'upnext', 'progress', 'deadlines', 'weekly', 'streak', 'music', 'minical', 'screenbreak', 'quote'] },
    timer: { phase: 'focus', status: 'idle', endAt: 0, remaining: 0, total: 0, cycle: 0, taskId: null, awaiting: null, phaseStartedAt: 0 },
    focus: { active: false, taskId: null, duration: 25, music: 'lofi', dnd: false, lockApps: false, allow: null, resumeAfterBreak: true, startedAt: 0 },
    eye: { accum: 0, lastTick: 0, snoozeUntil: 0, active: null },
    music: { category: 'lofi', trackId: null, repeat: false, shuffle: false, favorites: [], volume: 0.6, uploads: [] },
    sent: {},
    ui: { screen: 'home', taskView: 'all', calView: 'month', sort: 'scheduled' },
  };
  const ALL_WIDGETS = {
    pomodoro: 'Pomodoro Timer', today: "Today's Tasks", upnext: 'Upcoming Schedule', progress: 'Daily Progress', deadlines: 'Upcoming Deadlines',
    weekly: 'Weekly Productivity', streak: 'Focus Streak', music: 'Focus Music Player', minical: 'Mini Calendar', screenbreak: 'Screen Break Status', quote: 'Daily Motivational Quote',
  };

  // Deep-merge loaded data onto defaults, keeping only well-typed known keys.
  function mergeDefaults(def, val) {
    if (Array.isArray(def)) return Array.isArray(val) ? val : clone(def);
    if (def && typeof def === 'object') {
      const out = {}; const v = val && typeof val === 'object' && !Array.isArray(val) ? val : {};
      for (const k of Object.keys(def)) out[k] = def[k] === null ? (k in v ? v[k] : null) : mergeDefaults(def[k], v[k]);
      for (const k of Object.keys(v)) if (!(k in def) && def.constructor === Object && Object.keys(def).length === 0) out[k] = v[k];
      return out;
    }
    if (typeof def === typeof val) return val;
    return def;
  }
  function load(key) {
    const def = DEFAULTS[key];
    try {
      const raw = Store.get(NS + key);
      if (raw == null) return clone(def);
      const v = JSON.parse(raw);
      if (Array.isArray(def) && !Array.isArray(v)) throw new Error('expected array');
      return mergeDefaults(def, v);
    } catch (e) {
      console.warn('[Cadence] Recovered from missing/corrupted storage key:', key, e.message);
      corrupted.push(key); return clone(def);
    }
  }
  const S = {};
  Object.keys(DEFAULTS).forEach((k) => { S[k] = load(k); });
  // Free-form maps (ach, sent) are preserved as-is.
  ['ach', 'sent'].forEach((k) => { try { const r = JSON.parse(Store.get(NS + k) || '{}'); S[k] = r && typeof r === 'object' && !Array.isArray(r) ? r : {}; } catch (e) { S[k] = {}; } });

  function normalizeTask(t) {
    if (!t || typeof t !== 'object' || !t.title) return null;
    const pr = ['low', 'medium', 'high'].includes(t.priority) ? t.priority : 'medium';
    const st = ['pending', 'inprogress', 'completed'].includes(t.status) ? t.status : 'pending';
    const okDate = (s) => (typeof s === 'string' && !isNaN(tms(s)) ? s : '');
    return {
      id: String(t.id || uid()), title: String(t.title).slice(0, 200), description: String(t.description || ''),
      start: okDate(t.start), end: okDate(t.end), due: okDate(t.due), priority: pr, category: String(t.category || 'Personal'),
      estimate: isNum(+t.estimate) && +t.estimate > 0 ? +t.estimate : 0,
      reminder: { start: t.reminder && (t.reminder.start === null || isNum(t.reminder.start)) ? t.reminder.start : 10, end: !!(t.reminder ? t.reminder.end : true) },
      subtasks: Array.isArray(t.subtasks) ? t.subtasks.filter((s) => s && s.text).map((s) => ({ id: String(s.id || uid()), text: String(s.text), done: !!s.done })) : [],
      status: st, createdAt: isNum(t.createdAt) ? t.createdAt : Date.now(), completedAt: isNum(t.completedAt) ? t.completedAt : null,
      actualMs: isNum(t.actualMs) ? t.actualMs : 0, focusMs: isNum(t.focusMs) ? t.focusMs : 0,
      workingSince: isNum(t.workingSince) ? t.workingSince : null, workSource: t.workSource || null,
    };
  }
  S.tasks = S.tasks.map(normalizeTask).filter(Boolean);
  S.sessions = S.sessions.filter((s) => s && isNum(s.end) && isNum(s.ms) && ['focus', 'short', 'long'].includes(s.type));
  S.eyeLog = S.eyeLog.filter((e) => e && isNum(e.ts) && ['completed', 'skipped', 'postponed'].includes(e.action));
  S.notifs = S.notifs.filter((n) => n && n.id && isNum(n.ts));
  S.widgets.order = S.widgets.order.filter((w) => ALL_WIDGETS[w]);
  S.widgets.hidden = S.widgets.hidden.filter((w, i, a) => ALL_WIDGETS[w] && a.indexOf(w) === i);
  // Every widget is either on the dashboard (order) or available to add (hidden).
  Object.keys(ALL_WIDGETS).forEach((w) => { if (!S.widgets.order.includes(w) && !S.widgets.hidden.includes(w)) S.widgets.hidden.push(w); });
  S.widgets.order = S.widgets.order.filter((w) => !S.widgets.hidden.includes(w));
  if (!['focus', 'short', 'long'].includes(S.timer.phase)) S.timer = clone(DEFAULTS.timer);
  if (!['idle', 'running', 'paused'].includes(S.timer.status)) S.timer.status = 'idle';
  if (!S.focus.allow) S.focus.allow = clone(S.settings.focusMode.allow);

  const dirty = new Set(); let saveTimer = null;
  function save(...keys) {
    keys.forEach((k) => dirty.add(k));
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 120);
  }
  let storageWarned = false;
  function flush() {
    clearTimeout(saveTimer);
    if (!dirty.size) return;
    dirty.forEach((k) => {
      try { Store.set(NS + k, JSON.stringify(S[k])); } catch (e) {
        if (!storageWarned) { storageWarned = true; toast('Could not save', 'Device storage is full or unavailable — recent changes may not be kept.', 'err'); }
      }
    });
    dirty.clear();
    scheduleSync();
  }
  window.addEventListener('pagehide', flush);
  // Reloads the app without writing the in-memory state back (after a reset or restore).
  function reloadClean() {
    dirty.clear(); clearTimeout(saveTimer); window.removeEventListener('pagehide', flush);
    Store.flushed().then(() => location.reload());
  }

  const ui = { screen: S.ui.screen || 'home', filters: { priority: '', category: '', status: '' }, search: '', calCursor: new Date(), calSelected: dayKey(new Date()), statRange: 'week', editingWidgets: false, charts: {} };

  /* ============ 3. UI primitives ============ */
  function toast(title, msg = '', kind = '', opts = {}) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`; el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    el.innerHTML = `<div class="b"><b>${esc(title)}</b>${msg ? `<span>${esc(msg)}</span>` : ''}${opts.actions ? `<div class="acts">${opts.actions.map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div><button class="x" aria-label="Dismiss">${icon('i-x')}</button>`;
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
    el.querySelector('.x').onclick = close;
    if (opts.actions) $$('.acts button', el).forEach((b) => { b.onclick = () => { close(); opts.actions[+b.dataset.i].fn(); }; });
    $('#toasts').appendChild(el);
    while ($('#toasts').children.length > 2) $('#toasts').firstChild.remove();
    setTimeout(close, opts.timeout || (opts.actions ? 9000 : 3800));
  }

  const modalStack = [];
  function openModal({ title, body, foot = '', size = '', onClose, id, dismissible = true }) {
    if (id) { const ex = modalStack.find((m) => m.id === id); if (ex) ex.close(true); }
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2>${dismissible ? `<button class="icon-btn" data-close aria-label="Close">${icon('i-x')}</button>` : ''}</div>
      <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
    const prevFocus = document.activeElement;
    const m = { id, el: wrap, dismissible, close(silent) {
      const i = modalStack.indexOf(m); if (i < 0) return; modalStack.splice(i, 1); wrap.remove();
      if (!modalStack.length) document.body.classList.remove('no-scroll');
      if (!silent && onClose) onClose(); if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) {}
    } };
    wrap.addEventListener('click', (e) => { if ((e.target === wrap && dismissible) || e.target.closest('[data-close]')) m.close(); });
    $('#modalHost').appendChild(wrap); modalStack.push(m); document.body.classList.add('no-scroll');
    setTimeout(() => { const f = wrap.querySelector('input:not([type=hidden]),select,textarea,button.btn-primary'); if (f) f.focus(); }, 30);
    return m;
  }
  function confirmDialog({ title, message, confirmText = 'Confirm', danger = false, cancelText = 'Cancel' }) {
    return new Promise((res) => {
      let done = false;
      const m = openModal({ title, size: 'sm', body: `<p>${message}</p>`,
        foot: `<button class="btn btn-ghost" data-c="0">${esc(cancelText)}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-c="1">${esc(confirmText)}</button>`,
        onClose: () => { if (!done) res(false); } });
      $$('[data-c]', m.el).forEach((b) => b.onclick = () => { done = true; m.close(true); res(b.dataset.c === '1'); });
    });
  }
  function promptText({ title, label, placeholder = '', value = '', max = 60 }) {
    return new Promise((res) => {
      let done = false;
      const m = openModal({ title, size: 'sm', onClose: () => { if (!done) res(null); },
        body: `<label class="field"><span>${esc(label)}</span><input class="input" id="promptIn" maxlength="${max}" placeholder="${esc(placeholder)}" value="${esc(value)}"></label>`,
        foot: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-ok>Add</button>' });
      const inp = m.el.querySelector('#promptIn');
      const ok = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } done = true; m.close(true); res(v); };
      m.el.querySelector('[data-ok]').onclick = ok;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    });
  }
  function choiceDialog({ title, message, choices, id, dismissible = true }) {
    return new Promise((res) => {
      let done = false;
      const m = openModal({ title, size: 'sm', id, dismissible, body: `<div>${message}</div>`,
        foot: choices.map((c, i) => `<button class="btn ${c.kind || 'btn-ghost'}" data-ch="${i}">${esc(c.label)}</button>`).join(''),
        onClose: () => { if (!done) res(null); } });
      $$('[data-ch]', m.el).forEach((b) => b.onclick = () => { done = true; m.close(true); res(choices[+b.dataset.ch].value); });
    });
  }
  /* --- App-styled dropdowns and date/time pickers (instead of the system pop-ups) --- */
  // Each <select> and date/time input gets an invisible tap layer that opens an in-app sheet.
  // The real control keeps its value and fires the usual change event, so forms work unchanged.
  const DT_SEL = 'input[type="datetime-local"], input[type="date"], input[type="time"]';
  function enhanceControls(root) {
    if (!root || !root.querySelectorAll) return;
    const list = Array.from(root.querySelectorAll(`select:not([data-enh]), ${DT_SEL.split(', ').map((x) => x + ':not([data-enh])').join(', ')}`));
    if (root.matches && root.matches(`select, ${DT_SEL}`) && !root.dataset.enh) list.push(root);
    list.forEach((el) => {
      el.dataset.enh = '1';
      const isDt = el.tagName === 'INPUT';
      const wrap = document.createElement('span');
      const block = !el.closest('.ctl') || el.closest('.mini-select');
      wrap.className = `enh-wrap${block ? ' block' : ''}${isDt ? ' dt' : ''}`;
      el.parentNode.insertBefore(wrap, el); wrap.appendChild(el);
      const hit = document.createElement('span'); hit.className = 'enh-hit'; wrap.appendChild(hit);
      if (isDt) { hit.classList.add('dt-label'); el.tabIndex = -1; }
    });
    refreshDtLabels();
  }
  function dtText(el) {
    const v = el.value;
    if (!v) return `<span class="ph">${el.type === 'time' ? 'Set time' : 'Not set'}</span>`;
    if (el.type === 'time') { const [h, m] = v.split(':').map(Number); return esc(fmtTime(new Date(2000, 0, 1, h, m))); }
    if (el.type === 'date') return esc(fmtDay(v + 'T00:00', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
    return esc(`${fmtDay(v, { month: 'short', day: 'numeric' })}, ${fmtTime(v)}`);
  }
  function refreshDtLabels() {
    $$('.enh-wrap.dt').forEach((w) => {
      const el = w.querySelector('input'); const h = w.querySelector('.dt-label'); if (!el || !h) return;
      const key = `${el.value}|${S.settings.general.timeFormat}`;
      if (h.dataset.v !== key) { h.dataset.v = key; h.innerHTML = dtText(el) + icon(el.type === 'time' ? 'i-clock' : 'i-cal'); }
    });
  }
  new MutationObserver((muts) => {
    for (const mu of muts) {
      if (mu.target.closest && mu.target.closest('.enh-hit')) continue; // our own label updates
      mu.addedNodes.forEach((n) => { if (n.nodeType === 1 && !n.classList.contains('enh-wrap') && !n.classList.contains('enh-hit')) enhanceControls(n); });
    }
  })
    .observe(document.body, { childList: true, subtree: true });
  // Values set from code (quick buttons, resets) have no event: refresh labels after every interaction.
  ['click', 'input', 'change'].forEach((t) => document.addEventListener(t, () => requestAnimationFrame(refreshDtLabels)));
  document.addEventListener('click', (e) => {
    const hit = e.target.closest('.enh-hit'); if (!hit) return;
    e.preventDefault(); e.stopPropagation();
    const el = hit.parentNode.querySelector('select, input'); if (!el || el.disabled) return;
    if (el.tagName === 'SELECT') openSelectSheet(el); else openDateTimeSheet(el);
  }, true);
  function controlTitle(el) {
    const f = el.closest('.field, .mini-select'); const r = el.closest('.set-row');
    const t = (f && f.querySelector(':scope > span')) || (r && r.querySelector('.lbl b'));
    return (t && t.textContent.replace(/^\d+\.\s*/, '').replace(/\*$/, '').trim()) || el.getAttribute('aria-label') || 'Choose';
  }
  function commit(el, value) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function openSelectSheet(el) {
    const opts = Array.from(el.options);
    const m = openModal({ title: controlTitle(el), id: 'select-sheet', size: 'sheet', body: `<div class="opt-list" role="listbox">${opts.map((o, i) => `<button type="button" class="opt ${o.selected ? 'on' : ''} ${o.dataset.new ? 'opt-new' : ''}" data-i="${i}" role="option" aria-selected="${o.selected}" ${o.disabled ? 'disabled' : ''}><span class="opt-l">${o.dataset.color ? `<i class="opt-dot" style="background:${o.dataset.color}"></i>` : ''}${o.dataset.new ? icon('i-plus') : ''}${esc(o.text)}</span>${o.selected ? icon('i-check') : ''}</button>`).join('')}</div>` });
    const on = m.el.querySelector('.opt.on'); if (on) setTimeout(() => on.scrollIntoView({ block: 'center' }), 20);
    m.el.querySelector('.opt-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      m.close(true); el.selectedIndex = +b.dataset.i; commit(el, el.value);
    });
  }
  function openDateTimeSheet(el) {
    const type = el.type; const hasDate = type !== 'time'; const hasTime = type !== 'date';
    const h24 = S.settings.general.timeFormat === '24';
    let cur;
    if (el.value) cur = type === 'time' ? new Date(`2000-01-01T${el.value}`) : new Date(type === 'date' ? el.value + 'T09:00' : el.value);
    else { cur = new Date(); cur.setSeconds(0, 0); cur.setMinutes(Math.ceil(cur.getMinutes() / 5) * 5); }
    let view = new Date(cur.getFullYear(), cur.getMonth(), 1);
    let tab = hasDate ? 'date' : 'time';
    const m = openModal({ title: controlTitle(el), id: 'dt-sheet', size: 'sheet', body: '<div class="dtp"></div>',
      foot: `${type !== 'time' && !el.required ? '<button class="btn btn-ghost" data-clear>Clear</button><span class="spacer"></span>' : ''}<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-done>Done</button>` });
    const root = m.el.querySelector('.dtp');
    const ITEM = 44; // px per wheel row (matches .wheel button height)
    const hourVals = h24 ? Array.from({ length: 24 }, (_, i) => i) : Array.from({ length: 12 }, (_, i) => i + 1);
    const minVals = Array.from({ length: 60 }, (_, i) => i);
    const wheel = (name, vals, sel, fmt) => `<div class="wheel" data-wheel="${name}"><div class="wheel-pad"></div>${vals.map((v) => `<button type="button" data-v="${v}" class="${v === sel ? 'on' : ''}">${fmt(v)}</button>`).join('')}<div class="wheel-pad"></div></div>`;
    const header = () => `<div class="dtp-head">${hasDate ? `<button type="button" class="dtp-chip ${tab === 'date' ? 'on' : ''}" data-tab="date">${icon('i-cal')}<span>${esc(fmtDay(cur, { weekday: 'short', month: 'short', day: 'numeric', year: cur.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }))}</span></button>` : ''}
      ${hasTime ? `<button type="button" class="dtp-chip ${tab === 'time' ? 'on' : ''}" data-tab="time">${icon('i-clock')}<span>${esc(fmtTime(cur))}</span></button>` : ''}</div>`;
    const dateView = () => {
      const start = weekStartOf(view); const today = dayKey(new Date());
      return `<div class="dtp-nav"><button type="button" class="cal-arrow" data-nav="-1" aria-label="Previous month">${icon('i-left')}</button><b>${esc(view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</b><button type="button" class="cal-arrow" data-nav="1" aria-label="Next month">${icon('i-right')}</button></div>
        <div class="dtp-grid">${Array.from({ length: 7 }, (_, i) => `<span class="dow">${addDays(start, i).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>`).join('')}
        ${Array.from({ length: 42 }, (_, i) => { const x = addDays(start, i); const k = dayKey(x); return `<button type="button" class="dd ${x.getMonth() !== view.getMonth() ? 'other' : ''} ${k === today ? 'today' : ''} ${k === dayKey(cur) ? 'on' : ''}" data-day="${k}">${x.getDate()}</button>`; }).join('')}</div>
        <div class="dtp-quick"><button type="button" class="pill" data-q="0">Today</button><button type="button" class="pill" data-q="1">Tomorrow</button><button type="button" class="pill" data-q="7">Next week</button></div>`;
    };
    const timeView = () => {
      const hr = cur.getHours(); const shownH = h24 ? hr : (hr % 12 || 12);
      return `<div class="tpick"><div class="tpick-band" aria-hidden="true"></div>
        ${wheel('h', hourVals, shownH, (v) => (h24 ? pad(v) : String(v)))}<span class="tpick-colon">:</span>${wheel('m', minVals, cur.getMinutes(), pad)}
</div>
        ${h24 ? '' : `<div class="tpick-ampm"><button type="button" data-ap="am" class="${hr < 12 ? 'on' : ''}">AM</button><button type="button" data-ap="pm" class="${hr >= 12 ? 'on' : ''}">PM</button></div>`}
        <div class="dtp-quick">${[5, 15, 30].map((x) => `<button type="button" class="pill" data-step="${x}">+${x} min</button>`).join('')}<button type="button" class="pill" data-step="60">+1 hour</button></div>`;
    };
    const centerWheels = (smooth) => root.querySelectorAll('.wheel').forEach((w) => { const on = w.querySelector('.on'); if (on) w.scrollTo({ top: on.offsetTop - w.clientHeight / 2 + ITEM / 2, behavior: smooth ? 'smooth' : 'auto' }); });
    const draw = () => {
      root.innerHTML = header() + `<div class="dtp-body">${tab === 'date' ? dateView() : timeView()}</div>`;
      if (tab === 'time') { centerWheels(false); bindWheels(); }
    };
    const setFromWheel = (name, v) => {
      if (name === 'h') cur.setHours(h24 ? v : (v % 12) + (cur.getHours() >= 12 ? 12 : 0));
      else cur.setMinutes(v);
      const chip = root.querySelector('[data-tab="time"] span'); if (chip) chip.textContent = fmtTime(cur);
    };
    function bindWheels() {
      root.querySelectorAll('.wheel').forEach((w) => {
        let t = null;
        w.addEventListener('scroll', () => {
          clearTimeout(t);
          t = setTimeout(() => {
            const idx = Math.round(w.scrollTop / ITEM); const btns = w.querySelectorAll('button'); const b = btns[Math.max(0, Math.min(btns.length - 1, idx))];
            if (!b || b.classList.contains('on')) return;
            btns.forEach((x) => x.classList.toggle('on', x === b)); setFromWheel(w.dataset.wheel, +b.dataset.v);
          }, 90);
        }, { passive: true });
      });
    }
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tab) { tab = b.dataset.tab; draw(); return; }
      if (b.dataset.nav) { view = new Date(view.getFullYear(), view.getMonth() + +b.dataset.nav, 1); draw(); return; }
      if (b.dataset.day) {
        const [y, mo, da] = b.dataset.day.split('-').map(Number); cur.setFullYear(y, mo - 1, da);
        if (cur.getMonth() !== view.getMonth()) view = new Date(y, mo - 1, 1);
        if (hasTime) tab = 'time'; draw(); return; // after picking a day, go straight to the time
      }
      if (b.dataset.q != null) { const t = addDays(startOfDay(new Date()), +b.dataset.q); cur.setFullYear(t.getFullYear(), t.getMonth(), t.getDate()); view = new Date(t.getFullYear(), t.getMonth(), 1); draw(); return; }
      if (b.dataset.step) { cur = new Date(cur.getTime() + +b.dataset.step * MIN); view = new Date(cur.getFullYear(), cur.getMonth(), 1); draw(); return; }
      if (b.dataset.ap) { const h = cur.getHours(); if (b.dataset.ap === 'am' && h >= 12) cur.setHours(h - 12); if (b.dataset.ap === 'pm' && h < 12) cur.setHours(h + 12); draw(); return; }
      if (b.dataset.v != null) { const w = b.closest('.wheel'); w.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); setFromWheel(w.dataset.wheel, +b.dataset.v); centerWheels(true); }
    });
    m.el.querySelector('[data-done]').onclick = () => {
      const date = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`; const time = `${pad(cur.getHours())}:${pad(cur.getMinutes())}`;
      m.close(true); commit(el, type === 'time' ? time : type === 'date' ? date : `${date}T${time}`);
    };
    const clr = m.el.querySelector('[data-clear]'); if (clr) clr.onclick = () => { m.close(true); commit(el, ''); };
    draw();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#notifDrawer').hidden) { closeDrawer(); return; }
    const top = modalStack[modalStack.length - 1]; if (top && top.dismissible) top.close();
  });
  function emptyState(ic, title, text, action = '') {
    return `<div class="empty"><div class="empty-art">${icon(ic)}</div><h4>${esc(title)}</h4><p class="small">${esc(text)}</p>${action ? `<div style="margin-top:12px">${action}</div>` : ''}</div>`;
  }
  const sw = (attrs, checked) => `<label class="switch"><input type="checkbox" ${attrs} ${checked ? 'checked' : ''}><span class="sw-track"></span></label>`;

  /* ============ 4. Tasks model ============ */
  const CAT_COLORS = { Work: '#7A5BE6', Study: '#4F7FD9', Personal: '#E0884A', Health: '#3FA07A', Errands: '#C46BD6', Other: '#8A8399' };
  const EXTRA_COLORS = ['#2F8FA8', '#D6455D', '#8C9A3A', '#B57BE8', '#C77A3C', '#5A6FE0'];
  function catColor(c) {
    if (CAT_COLORS[c]) return CAT_COLORS[c];
    let h = 0; for (const ch of String(c)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return EXTRA_COLORS[h % EXTRA_COLORS.length];
  }
  const PRI_COLOR = { high: '#D6455D', medium: '#D18F1F', low: '#3FA07A' };
  const PRI_RANK = { high: 0, medium: 1, low: 2 };
  const categories = () => Array.from(new Set(Object.keys(CAT_COLORS).concat(S.tasks.map((t) => t.category)))).filter(Boolean);
  const getTask = (id) => S.tasks.find((t) => t.id === id);
  const isScheduled = (t) => !!(t.start && t.end);
  const deadlineOf = (t) => (t.due ? tms(t.due) : t.end ? tms(t.end) : NaN);
  const isOverdue = (t, now = Date.now()) => t.status !== 'completed' && isFinite(deadlineOf(t)) && deadlineOf(t) < now;
  function workedMs(t, now = Date.now()) { return t.actualMs + (t.workingSince ? now - t.workingSince : 0); }
  function touchesDay(t, day) {
    const a = startOfDay(day).getTime(), b = a + DAY;
    if (isScheduled(t) && tms(t.start) < b && tms(t.end) > a) return true;
    if (t.due && tms(t.due) >= a && tms(t.due) < b) return true;
    return false;
  }
  function overlapsFor(task, excludeId) {
    if (!isScheduled(task)) return [];
    const a = tms(task.start), b = tms(task.end);
    return S.tasks.filter((o) => o.id !== excludeId && o.status !== 'completed' && isScheduled(o) && tms(o.start) < b && tms(o.end) > a);
  }

  function upsertTask(data) {
    const existing = data.id && getTask(data.id);
    if (existing) {
      const scheduleChanged = existing.start !== data.start || existing.end !== data.end || existing.due !== data.due;
      Object.assign(existing, data);
      if (scheduleChanged) clearSentFor(existing.id);
      if (existing.status === 'completed' && !existing.completedAt) existing.completedAt = Date.now();
      if (existing.status !== 'completed') existing.completedAt = null;
    } else {
      const t = normalizeTask(Object.assign({ id: uid(), createdAt: Date.now() }, data));
      if (t.status === 'completed') t.completedAt = Date.now();
      S.tasks.push(t);
    }
    save('tasks'); checkAchievements(); renderAll();
  }
  function clearSentFor(id) { Object.keys(S.sent).forEach((k) => { if (k.includes(':' + id + ':')) delete S.sent[k]; }); save('sent'); }
  function setStatus(t, status, opts = {}) {
    const now = opts.at || Date.now();
    if (status === 'completed') {
      stopWork(t, now, true); t.status = 'completed'; t.completedAt = now;
      t.subtasks.forEach((s) => (s.done = true));
      if (!opts.quiet) {
        buzz(30);
        toast('Task completed', t.title, 'ok', { actions: [{ label: 'Undo', fn: () => { t.status = 'pending'; t.completedAt = null; save('tasks'); renderAll(); } }] });
      }
    } else { t.status = status; t.completedAt = null; }
    save('tasks'); checkAchievements(); renderAll();
  }
  function startWork(t, source = 'manual', at = Date.now()) {
    if (!t || t.status === 'completed') return;
    if (!t.workingSince) { t.workingSince = at; t.workSource = source; }
    if (t.status === 'pending') t.status = 'inprogress';
    save('tasks');
  }
  function stopWork(t, at = Date.now(), force = false, source = null) {
    if (!t || !t.workingSince) return;
    if (!force && source && t.workSource !== source) return;
    t.actualMs += Math.max(0, at - t.workingSince); t.workingSince = null; t.workSource = null; save('tasks');
  }
  async function deleteTask(id) {
    const t = getTask(id); if (!t) return;
    const ok = await confirmDialog({ title: 'Delete task?', message: `"${esc(t.title)}" will be permanently removed.`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    S.tasks = S.tasks.filter((x) => x.id !== id);
    if (S.timer.taskId === id) S.timer.taskId = null;
    if (S.focus.taskId === id) S.focus.taskId = null;
    save('tasks', 'timer', 'focus'); modalStack.slice().forEach((m) => m.id === 'task-form' && m.close(true));
    toast('Task deleted', '', ''); renderAll();
  }

  function filteredTasks() {
    const now = Date.now(); const today = new Date(); const eod = startOfDay(today).getTime() + DAY;
    const v = S.ui.taskView; const f = ui.filters; const q = ui.search.trim().toLowerCase();
    let list = S.tasks.filter((t) => {
      if (v === 'today' && !(touchesDay(t, today) || t.status === 'inprogress')) return false;
      if (v === 'upcoming' && !(t.status !== 'completed' && ((isScheduled(t) && tms(t.start) >= eod) || (t.due && tms(t.due) >= eod)) && !isOverdue(t, now))) return false;
      if (v === 'overdue' && !isOverdue(t, now)) return false;
      if (v === 'completed' && t.status !== 'completed') return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.category && t.category !== f.category) return false;
      if (f.status && t.status !== f.status) return false;
      if (q && !(`${t.title} ${t.description} ${t.category} ${t.subtasks.map((s) => s.text).join(' ')}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const far = 8.64e15; const by = S.ui.sort;
    const st = { inprogress: 0, pending: 1, completed: 2 };
    list.sort((a, b) => {
      if (by === 'priority') return PRI_RANK[a.priority] - PRI_RANK[b.priority] || (tms(a.due) || far) - (tms(b.due) || far);
      if (by === 'due') return (tms(a.due) || far) - (tms(b.due) || far);
      if (by === 'status') return st[a.status] - st[b.status];
      if (by === 'category') return a.category.localeCompare(b.category);
      if (by === 'created') return b.createdAt - a.createdAt;
      return (tms(a.start) || far) - (tms(b.start) || far) || (tms(a.due) || far) - (tms(b.due) || far);
    });
    if (v !== 'completed' && by !== 'status') list.sort((a, b) => (a.status === 'completed') - (b.status === 'completed'));
    return list;
  }

  /* --- task form --- */
  function openTaskForm(id, preset = {}) {
    const t = id ? getTask(id) : null;
    const d = t ? clone(t) : Object.assign({ title: '', description: '', start: '', end: '', due: '', priority: 'medium', category: 'Work', estimate: 0, reminder: { start: S.settings.notifications.defaultReminder, end: true }, subtasks: [], status: 'pending' }, preset);
    const remOpts = [[null, 'No reminder'], [0, 'At start time'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before'], [1440, '1 day before']];
    const body = `
      <form id="taskForm" class="stack" novalidate>
        <label class="field"><span>Title *</span><input class="input" name="title" maxlength="200" required value="${esc(d.title)}" placeholder="What do you need to do?"></label>
        <label class="field"><span>Description</span><textarea class="textarea" name="description" placeholder="Notes, links, context">${esc(d.description)}</textarea></label>
        <div class="grid-2">
          <label class="field"><span>Priority</span><select class="select" name="priority">${['low', 'medium', 'high'].map((p) => `<option value="${p}" ${d.priority === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}</select></label>
          <label class="field"><span>Category</span><select class="select" name="category">${Array.from(new Set(categories().concat(d.category ? [d.category] : []))).map((c) => `<option value="${esc(c)}" data-color="${catColor(c)}" ${c === d.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new" data-new="1">New category…</option></select></label>
        </div>
        <div class="form-section"><h4>Schedule</h4>
          <div class="grid-2">
            <label class="field"><span>Start</span><input class="input" type="datetime-local" name="start" value="${esc(d.start)}"></label>
            <label class="field"><span>End</span><input class="input" type="datetime-local" name="end" value="${esc(d.end)}"></label>
          </div>
          <div class="field-error" id="schedErr" hidden></div>
          <div class="row wrap" style="margin-top:8px">
            <button type="button" class="btn btn-ghost btn-sm" data-quick="now">Start now (+1h)</button>
            <button type="button" class="btn btn-ghost btn-sm" data-quick="tomorrow">Tomorrow 9:00</button>
            <button type="button" class="btn btn-ghost btn-sm" data-quick="clear">Clear schedule</button>
          </div>
          <div class="grid-2" style="margin-top:12px">
            <label class="field"><span>Due date</span><input class="input" type="datetime-local" name="due" value="${esc(d.due)}"></label>
            <label class="field"><span>Estimated duration (min)</span><input class="input" type="number" min="0" max="1440" step="5" name="estimate" value="${d.estimate || ''}" placeholder="e.g. 50"></label>
          </div>
        </div>
        <div class="form-section"><h4>Reminders</h4>
          <div class="grid-2">
            <label class="field"><span>Before start</span><select class="select" name="remStart">${remOpts.map(([v, l]) => `<option value="${v === null ? '' : v}" ${d.reminder.start === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>End-time alerts</span><select class="select" name="remEnd"><option value="1" ${d.reminder.end ? 'selected' : ''}>Notify near & at end</option><option value="0" ${!d.reminder.end ? 'selected' : ''}>Off</option></select></label>
          </div>
        </div>
        <div class="form-section"><h4>Checklist</h4>
          <div class="subtask-editor" id="subEditor">${d.subtasks.map(subRow).join('')}</div>
          <div class="row" style="margin-top:6px"><input class="input" id="subNew" placeholder="Add a subtask and press Enter"><button type="button" class="btn btn-soft" id="subAdd">${icon('i-plus')}</button></div>
        </div>
        <div class="form-section"><h4>Status</h4>
          <div class="pill-group" id="statusPills">${[['pending', 'Pending'], ['inprogress', 'In progress'], ['completed', 'Completed']].map(([v, l]) => `<button type="button" class="pill" data-status="${v}" aria-pressed="${d.status === v}">${l}</button>`).join('')}</div>
          ${t && (t.actualMs || t.workingSince || t.focusMs) ? `<p class="small muted" style="margin-top:8px">Actual time worked: <b>${fmtDur(workedMs(t))}</b>${t.focusMs ? ` · in focus sessions: ${fmtDur(t.focusMs)}` : ''}${isScheduled(t) ? ` · scheduled: ${fmtDur(tms(t.end) - tms(t.start))}` : ''}</p>` : ''}
        </div>
      </form>`;
    const foot = `${t ? `<button class="btn btn-danger-ghost" data-act="del">${icon('i-trash')}Delete</button><span class="spacer"></span>` : ''}<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-act="save">${t ? 'Save changes' : 'Create task'}</button>`;
    const m = openModal({ title: t ? 'Edit task' : 'New task', body, foot, id: 'task-form' });
    const form = $('#taskForm', m.el);
    let status = d.status;
    function subRow(s) { return `<div class="subtask-row" data-sid="${esc(s.id)}"><input type="checkbox" ${s.done ? 'checked' : ''} aria-label="Done"><input class="input" value="${esc(s.text)}" aria-label="Subtask"><button type="button" class="icon-btn sm" data-rm aria-label="Remove subtask">${icon('i-x')}</button></div>`; }
    const addSub = () => { const v = $('#subNew', m.el).value.trim(); if (!v) return; $('#subEditor', m.el).insertAdjacentHTML('beforeend', subRow({ id: uid(), text: v, done: false })); $('#subNew', m.el).value = ''; $('#subNew', m.el).focus(); };
    $('#subAdd', m.el).onclick = addSub;
    $('#subNew', m.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });
    $('#subEditor', m.el).addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.subtask-row').remove(); });
    $('#statusPills', m.el).addEventListener('click', (e) => { const b = e.target.closest('[data-status]'); if (!b) return; status = b.dataset.status; $$('[data-status]', m.el).forEach((x) => x.setAttribute('aria-pressed', x === b)); });
    let lastCat = form.category.value;
    form.category.addEventListener('change', async () => {
      if (form.category.value !== '__new') { lastCat = form.category.value; return; }
      form.category.value = lastCat;
      const name = await promptText({ title: 'New category', label: 'Category name', placeholder: 'e.g. Side project', max: 40 });
      if (!name) return;
      if (!Array.from(form.category.options).some((o) => o.value === name)) {
        const o = document.createElement('option'); o.value = name; o.textContent = name; o.dataset.color = catColor(name);
        form.category.insertBefore(o, form.category.querySelector('[value="__new"]'));
      }
      form.category.value = name; lastCat = name;
    });
    const fStart = form.start, fEnd = form.end;
    m.el.addEventListener('click', (e) => {
      const q = e.target.closest('[data-quick]'); if (!q) return;
      const now = new Date(); now.setSeconds(0, 0); now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5);
      if (q.dataset.quick === 'now') { fStart.value = toLocalInput(now); fEnd.value = toLocalInput(now.getTime() + HOUR); }
      if (q.dataset.quick === 'tomorrow') { const a = addDays(startOfDay(now), 1); a.setHours(9); fStart.value = toLocalInput(a); fEnd.value = toLocalInput(a.getTime() + HOUR); }
      if (q.dataset.quick === 'clear') { fStart.value = ''; fEnd.value = ''; }
      validateSched();
    });
    fStart.addEventListener('change', () => {
      if (fStart.value && (!fEnd.value || tms(fEnd.value) <= tms(fStart.value))) {
        const mins = +form.estimate.value || 60; fEnd.value = toLocalInput(tms(fStart.value) + mins * MIN);
      }
      validateSched();
    });
    fEnd.addEventListener('change', () => { validateSched(); if (fStart.value && fEnd.value && !form.estimate.value && tms(fEnd.value) > tms(fStart.value)) form.estimate.value = Math.round((tms(fEnd.value) - tms(fStart.value)) / MIN); });
    function validateSched() {
      const err = $('#schedErr', m.el); let msg = '';
      if ((fStart.value && !fEnd.value) || (!fStart.value && fEnd.value)) msg = 'Set both a start and an end time to schedule this task.';
      else if (fStart.value && fEnd.value && tms(fEnd.value) <= tms(fStart.value)) msg = 'End must be later than start.';
      err.textContent = msg; err.hidden = !msg; fEnd.classList.toggle('invalid', !!msg);
      return !msg;
    }
    m.el.querySelector('[data-act="save"]').onclick = async () => {
      const title = form.title.value.trim();
      form.title.classList.toggle('invalid', !title);
      if (!title) { form.title.focus(); toast('Title is required', '', 'err'); return; }
      if (!validateSched()) { toast('Check the schedule', $('#schedErr', m.el).textContent, 'err'); return; }
      const subtasks = $$('.subtask-row', m.el).map((r) => ({ id: r.dataset.sid, text: r.querySelector('.input').value.trim(), done: r.querySelector('input[type=checkbox]').checked })).filter((s) => s.text);
      const data = {
        id: t ? t.id : undefined, title, description: form.description.value.trim(), start: fStart.value, end: fEnd.value, due: form.due.value,
        priority: form.priority.value, category: form.category.value.trim() || 'Other', estimate: Math.max(0, +form.estimate.value || 0),
        reminder: { start: form.remStart.value === '' ? null : +form.remStart.value, end: form.remEnd.value === '1' }, subtasks, status,
      };
      const ov = data.status !== 'completed' ? overlapsFor(data, t && t.id) : [];
      if (ov.length) {
        const go = await confirmDialog({ title: 'Schedule overlap', confirmText: 'Save anyway', cancelText: 'Go back',
          message: `<div class="warn-box">This time overlaps with:<ul>${ov.map((o) => `<li><b>${esc(o.title)}</b> — ${esc(fmtRange(o.start, o.end))}</li>`).join('')}</ul></div>` });
        if (!go) return;
      }
      if (t && status !== 'completed' && t.status === 'completed') { t.completedAt = null; }
      if (t && status === 'completed' && t.status !== 'completed') stopWork(t, Date.now(), true);
      upsertTask(data); m.close(true);
      toast(t ? 'Task updated' : 'Task created', title, 'ok');
    };
    const del = m.el.querySelector('[data-act="del"]'); if (del) del.onclick = () => deleteTask(t.id);
  }

  function openPostpone(id) {
    const t = getTask(id); if (!t) return;
    const opts = [[15 * MIN, '15 minutes'], [HOUR, '1 hour'], [3 * HOUR, '3 hours'], ['tomorrow', 'Tomorrow'], [7 * DAY, '1 week']];
    const m = openModal({ title: 'Postpone task', size: 'sm', body: `<p class="small muted">${esc(t.title)}${isScheduled(t) ? ` · ${esc(fmtRange(t.start, t.end))}` : ''}${t.due ? ` · due ${esc(fmtWhen(t.due))}` : ''}</p>
      <div class="pill-group">${opts.map(([v, l], i) => `<button class="pill" data-p="${i}">${l}</button>`).join('')}</div>
      ${t.due && isScheduled(t) ? `<label class="row small"><input type="checkbox" id="ppDue" checked style="accent-color:var(--accent)"> Also move the due date</label>` : ''}
      <button class="btn btn-ghost btn-sm" data-p="custom">Pick a new time…</button>`, foot: '' });
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      if (b.dataset.p === 'custom') { m.close(true); openTaskForm(id); return; }
      let delta = opts[+b.dataset.p][0];
      const base = isScheduled(t) ? tms(t.start) : t.due ? tms(t.due) : Date.now();
      if (delta === 'tomorrow') delta = addDays(new Date(base), 1).getTime() - base;
      const moveDue = !isScheduled(t) || !t.due || ($('#ppDue', m.el) && $('#ppDue', m.el).checked);
      if (isScheduled(t)) { t.start = toLocalInput(tms(t.start) + delta); t.end = toLocalInput(tms(t.end) + delta); }
      if (t.due && moveDue) t.due = toLocalInput(tms(t.due) + delta);
      clearSentFor(t.id); save('tasks'); m.close(true); renderAll();
      toast('Postponed', `${t.title} → ${isScheduled(t) ? fmtWhen(t.start) : fmtWhen(t.due)}`, 'ok');
    });
  }

  /* ============ 5. Stats, streaks & rewards ============ */
  const focusSessions = () => S.sessions.filter((s) => s.type === 'focus');
  function focusMsBetween(a, b) { return focusSessions().reduce((sum, s) => (s.end >= a && s.end < b ? sum + s.ms : sum), 0); }
  function sessionsBetween(a, b, completedOnly = true) { return focusSessions().filter((s) => s.end >= a && s.end < b && (!completedOnly || s.completed)).length; }
  function tasksDoneBetween(a, b) { return S.tasks.filter((t) => t.status === 'completed' && t.completedAt >= a && t.completedAt < b).length; }
  function focusDays() { const set = new Set(); focusSessions().forEach((s) => s.completed && set.add(dayKey(s.end))); return set; }
  function streak() {
    const days = focusDays(); let d = startOfDay(new Date());
    if (!days.has(dayKey(d))) d = addDays(d, -1);
    let n = 0; while (days.has(dayKey(d))) { n++; d = addDays(d, -1); }
    return n;
  }
  function bestStreak() {
    const keys = Array.from(focusDays()).sort(); let best = 0, cur = 0, prev = null;
    keys.forEach((k) => { const dt = new Date(k + 'T00:00'); cur = prev && Math.round((dt - prev) / DAY) === 1 ? cur + 1 : 1; best = Math.max(best, cur); prev = dt; });
    return best;
  }
  function rangeBounds(r) {
    const now = new Date(); const sod = startOfDay(now).getTime();
    if (r === 'day') return [sod, sod + DAY];
    if (r === 'week') { const ws = weekStartOf(now).getTime(); return [ws, ws + 7 * DAY]; }
    if (r === 'month') { const a = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); return [a, new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()]; }
    const first = Math.min(sod, ...S.sessions.map((s) => s.end), ...S.tasks.map((t) => t.createdAt)); return [startOfDay(first).getTime(), sod + DAY];
  }

  const ACH = [
    { id: 'focus-1', name: 'First focus', desc: 'Complete a focus session', icon: 'i-focus', test: (m) => m.sessions >= 1 },
    { id: 'focus-10', name: 'Getting into rhythm', desc: '10 focus sessions', icon: 'i-focus', test: (m) => m.sessions >= 10 },
    { id: 'focus-25', name: 'Steady cadence', desc: '25 focus sessions', icon: 'i-focus', test: (m) => m.sessions >= 25 },
    { id: 'focus-100', name: 'Deep worker', desc: '100 focus sessions', icon: 'i-focus', test: (m) => m.sessions >= 100 },
    { id: 'hours-10', name: 'Ten hours', desc: '10 hours of focus time', icon: 'i-clock', test: (m) => m.focusMs >= 10 * HOUR },
    { id: 'task-1', name: 'First tick', desc: 'Complete a task', icon: 'i-check', test: (m) => m.tasks >= 1 },
    { id: 'task-10', name: 'Momentum', desc: 'Complete 10 tasks', icon: 'i-check', test: (m) => m.tasks >= 10 },
    { id: 'task-50', name: 'Finisher', desc: 'Complete 50 tasks', icon: 'i-check', test: (m) => m.tasks >= 50 },
    { id: 'streak-3', name: 'Three in a row', desc: '3-day focus streak', icon: 'i-flame', test: (m) => m.best >= 3 },
    { id: 'streak-7', name: 'A full week', desc: '7-day focus streak', icon: 'i-flame', test: (m) => m.best >= 7 },
    { id: 'goal-day', name: 'Goal reached', desc: 'Hit your daily focus goal', icon: 'i-trophy', test: (m) => m.dayGoal },
    { id: 'goal-week', name: 'Weekly goal', desc: 'Hit your weekly focus goal', icon: 'i-trophy', test: (m) => m.weekGoal },
    { id: 'eye-10', name: 'Kind to your eyes', desc: '10 screen breaks completed', icon: 'i-eye', test: (m) => m.eye >= 10 },
  ];
  function metrics() {
    const fs = focusSessions(); const [ws, we] = rangeBounds('week'); const sod = startOfDay(new Date()).getTime();
    return {
      sessions: fs.filter((s) => s.completed).length, focusMs: fs.reduce((a, s) => a + s.ms, 0),
      tasks: S.tasks.filter((t) => t.status === 'completed').length, best: bestStreak(),
      dayGoal: focusMsBetween(sod, sod + DAY) >= S.settings.goals.dailyFocusMin * MIN,
      weekGoal: focusMsBetween(ws, we) >= S.settings.goals.weeklyFocusHours * HOUR,
      eye: S.eyeLog.filter((e) => e.action === 'completed').length,
    };
  }
  function checkAchievements() {
    const m = metrics(); let changed = false;
    ACH.forEach((a) => {
      if (!S.ach[a.id] && a.test(m)) { S.ach[a.id] = Date.now(); changed = true; }
    });
    // daily goal notification (once per day)
    const k = 'goal:' + dayKey(new Date());
    if (m.dayGoal && !S.sent[k]) { S.sent[k] = 1; save('sent'); notify('achievements', 'Daily focus goal reached', `You've focused ${S.settings.goals.dailyFocusMin}+ minutes today. Nice pacing.`); }
    if (changed) save('ach');
  }

  /* ============ 6. Notifications & reminders ============ */
  const NOTIF_CATS = {
    upcoming: ['Upcoming scheduled tasks', 'i-cal'], start: ['Task start times', 'i-play'], endApproach: ['Task end times', 'i-clock'],
    overdue: ['Overdue tasks', 'i-flag'], deadline: ['Task deadlines', 'i-flag'], pomodoro: ['Pomodoro session completed', 'i-focus'],
    breakDone: ['Break completed', 'i-moon'], screenBreak: ['Screen Break Reminders', 'i-eye'], daily: ['Daily productivity reminder', 'i-tasks'], achievements: ['Daily focus goal reached', 'i-trophy'],
  };
  const DND_BYPASS = ['pomodoro', 'breakDone', 'screenBreak'];
  // System permission state, refreshed from the device on start and whenever the app returns.
  let devStatus = { notifications: Device.isNative ? 'prompt' : 'unavailable', exactAlarms: true, dndAccess: false, dndActive: false };
  async function refreshDeviceStatus() { devStatus = await Device.status(); return devStatus; }
  const notifPerm = () => devStatus.notifications;

  // In-app alert + history. System notifications are posted by the device layer while Cadence is
  // in the background, so nothing is shown twice.
  function notify(cat, title, body = '', opts = {}) {
    if (!S.settings.notifications.categories[cat]) return;
    const n = { id: uid(), ts: Date.now(), cat, title, body, read: false };
    S.notifs.unshift(n); S.notifs = S.notifs.slice(0, 150); save('notifs'); updateBell();
    if (dndActive() && !DND_BYPASS.includes(cat)) return; // focusing with Do Not Disturb: kept quietly in history
    if (document.visibilityState === 'hidden') return;
    const sounds = S.settings.general.sounds && S.settings.notifications.sound;
    if (sounds && !opts.silent) CadenceAudio.chime(opts.soundKind || 'notify', S.settings.general.chimeVolume);
    if (opts.noToast) return;
    toast(title, body, cat === 'overdue' ? 'err' : '', { actions: opts.actions });
  }
  function updateBell() {
    const n = S.notifs.filter((x) => !x.read).length; const b = $('#bellBadge');
    b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
  }
  function openDrawer() {
    renderNotifs(); $('#notifDrawer').hidden = false; $('#scrim').hidden = false; $('#notifClose').focus();
  }
  function closeDrawer() { $('#notifDrawer').hidden = true; $('#scrim').hidden = true; }
  function renderNotifs() {
    const p = notifPerm(); const note = $('#notifPermissionNote');
    note.innerHTML = p === 'prompt' ? 'Allow notifications so reminders and session alerts reach you when Cadence is closed. <button class="widget-link" data-action="askNotif">Allow</button>'
      : p === 'denied' ? 'Notifications are turned off for Cadence, so alerts only appear while the app is open. <button class="widget-link" data-action="openNotifSettings">Turn on</button>'
      : '';
    note.hidden = !note.innerHTML;
    $('#notifList').innerHTML = S.notifs.length ? S.notifs.map((n) => `
      <div class="notif ${n.read ? 'read' : 'unread'}" data-action="readNotif" data-id="${n.id}">
        <div class="ic">${icon((NOTIF_CATS[n.cat] || ['', 'i-bell'])[1])}</div>
        <div class="b"><div class="t">${esc(n.title)}</div>${n.body ? `<div class="m">${esc(n.body)}</div>` : ''}<div class="w">${esc(fmtWhen(n.ts))}${n.read ? '' : ' · unread'}</div></div>
        <button class="icon-btn sm" data-action="delNotif" data-id="${n.id}" aria-label="Remove">${icon('i-x')}</button>
      </div>`).join('') : emptyState('i-bell', 'All caught up', 'Reminders and session alerts will appear here.');
  }
  async function askNotifPermission(silent) {
    const before = notifPerm();
    devStatus = await Device.requestNotifications();
    const p = notifPerm();
    if (silent !== true && p !== before) toast(p === 'granted' ? 'Notifications on' : 'Notifications off', p === 'granted' ? 'Reminders and session alerts will reach you when Cadence is closed.' : 'Alerts will only appear while Cadence is open.', p === 'granted' ? 'ok' : '');
    renderAll(); if (!$('#notifDrawer').hidden) renderNotifs();
  }

  function onceKey(k) { if (S.sent[k]) return false; S.sent[k] = Date.now(); save('sent'); return true; }
  // Every reminder a task can produce. `title`/`body` take the time the alert is shown, so the
  // same plan drives in-app alerts and the notifications scheduled on the device.
  function taskReminders(t) {
    const ns = S.settings.notifications; const out = [];
    if (t.status === 'completed') return out;
    if (isScheduled(t)) {
      const st = tms(t.start), en = tms(t.end);
      if (t.reminder.start != null && t.reminder.start > 0) {
        const lead = t.reminder.start;
        out.push({ key: `up:${t.id}:${t.start}`, cat: 'upcoming', at: st - lead * MIN, until: st,
          title: (now) => `Starting ${lead >= 60 ? 'in ' + fmtDur(st - now) : 'in ' + Math.max(1, Math.round((st - now) / MIN)) + ' min'}`,
          body: (now) => `${t.title} · ${fmtRange(t.start, t.end, now)}` });
      }
      if (t.reminder.start != null) {
        out.push({ key: `st:${t.id}:${t.start}`, cat: 'start', at: st, until: Math.min(en, st + 30 * MIN), title: () => 'Task starting now', body: () => t.title,
          actions: [{ label: 'Start Focus Mode', fn: () => openFocusSetup(t.id) }, { label: 'Open task', fn: () => openTaskForm(t.id) }] });
      }
      if (t.reminder.end) {
        if (ns.endLead > 0) out.push({ key: `en:${t.id}:${t.end}`, cat: 'endApproach', at: Math.max(en - ns.endLead * MIN, st + 1), until: en,
          title: (now) => `Ending in ${Math.max(1, Math.round((en - now) / MIN))} min`, body: () => `${t.title} is scheduled to end at ${fmtTime(en)}.` });
        out.push({ key: `ep:${t.id}:${t.end}`, cat: 'endApproach', at: en, until: en + 2 * HOUR, title: () => 'Scheduled time has ended',
          body: () => `${t.title} — mark it done, or keep working (it won't be completed automatically).`,
          actions: [{ label: 'Mark done', fn: () => setStatus(t, 'completed') }, { label: 'Postpone', fn: () => openPostpone(t.id) }] });
      }
    }
    if (t.due) {
      const du = tms(t.due);
      out.push({ key: `dl:${t.id}:${t.due}`, cat: 'deadline', at: du - S.settings.notifications.deadlineLead * MIN, until: du,
        title: (now) => `Due ${fmtDur(du - now) === '0m' ? 'now' : 'in ' + fmtDur(du - now)}`, body: () => t.title });
    }
    return out;
  }
  function dailyAt(day) { const [hh, mm] = (S.settings.notifications.dailyTime || '09:00').split(':').map(Number); const at = startOfDay(day); at.setHours(hh || 0, mm || 0); return at.getTime(); }
  function dailyBody(day) {
    const n = S.tasks.filter((t) => t.status !== 'completed' && touchesDay(t, day)).length;
    return n ? `You have ${n} task${n > 1 ? 's' : ''} today. Pick one to start with.` : 'No tasks scheduled today yet — add one to set your intention.';
  }
  function checkReminders() {
    const now = Date.now(); const overdueBatch = [];
    S.tasks.forEach((t) => {
      taskReminders(t).forEach((r) => { if (now >= r.at && now < r.until && onceKey(r.key)) notify(r.cat, r.title(now), r.body(now), { actions: r.actions }); });
      if (isOverdue(t, now) && !S.sent[`od:${t.id}:${t.due || t.end}`]) { S.sent[`od:${t.id}:${t.due || t.end}`] = now; overdueBatch.push(t); }
    });
    if (overdueBatch.length) {
      save('sent');
      if (overdueBatch.length <= 2) overdueBatch.forEach((t) => notify('overdue', 'Task overdue', `${t.title} was due ${fmtWhen(deadlineOf(t))}.`, { actions: [{ label: 'Postpone', fn: () => openPostpone(t.id) }] }));
      else notify('overdue', `${overdueBatch.length} tasks are overdue`, overdueBatch.slice(0, 3).map((t) => t.title).join(', ') + (overdueBatch.length > 3 ? '…' : ''), { actions: [{ label: 'Review', fn: () => { S.ui.taskView = 'overdue'; go('tasks'); } }] });
    }
    // daily productivity reminder
    const at = dailyAt(new Date());
    if (now >= at && now < at + 3 * HOUR && onceKey('daily:' + dayKey(now))) notify('daily', 'Plan your day', dailyBody(new Date()));
    // prune old sent keys
    const cutoff = now - 30 * DAY; let pruned = false;
    Object.keys(S.sent).forEach((k) => { if (S.sent[k] < cutoff) { delete S.sent[k]; pruned = true; } }); if (pruned) save('sent');
  }
  // The coming week's reminders, handed to the device so they fire while Cadence is closed.
  function scheduledReminders(now) {
    const cats = S.settings.notifications.categories; const horizon = now + 8 * DAY; const out = [];
    S.tasks.forEach((t) => {
      taskReminders(t).forEach((r) => {
        if (cats[r.cat] && r.at > now && r.at < horizon && !S.sent[r.key]) out.push({ key: r.key, cat: r.cat, at: Math.round(r.at), title: r.title(r.at), body: r.body(r.at), taskId: t.id });
      });
      const k = `od:${t.id}:${t.due}`;
      if (cats.overdue && t.status !== 'completed' && t.due && tms(t.due) > now && tms(t.due) < horizon && !S.sent[k]) {
        out.push({ key: k, cat: 'overdue', at: tms(t.due) + 1000, title: 'Task overdue', body: `${t.title} was due at ${fmtTime(t.due)}.`, taskId: t.id });
      }
    });
    if (cats.daily) {
      [0, 1].forEach((i) => {
        const day = addDays(new Date(now), i); const at = dailyAt(day); const k = 'daily:' + dayKey(day);
        if (at > now && !S.sent[k]) out.push({ key: k, cat: 'daily', at, title: 'Plan your day', body: dailyBody(day) });
      });
    }
    return out.sort((a, b) => a.at - b.at).slice(0, 200);
  }

  /* ============ 7. Pomodoro timer & Focus Mode ============ */
  const PHASE_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };
  function phaseTotal(phase) {
    const p = S.settings.pomodoro;
    if (phase === 'focus') return (S.focus.active ? S.focus.duration : p.focus) * MIN;
    return (phase === 'short' ? p.short : p.long) * MIN;
  }
  function remaining(now = Date.now()) {
    const t = S.timer;
    if (t.status === 'running') return Math.max(0, t.endAt - now);
    if (t.status === 'paused') return t.remaining;
    return phaseTotal(t.phase);
  }
  const totalMs = () => (S.timer.status === 'idle' ? phaseTotal(S.timer.phase) : S.timer.total);
  const timerTask = () => (S.timer.taskId ? getTask(S.timer.taskId) : null);
  // Focus-tab switches apply to every focus session: Focus Mode runs use their own copy.
  const focusPref = (k) => (S.focus.active ? S.focus[k] : S.settings.focusMode[k]);
  // DND and app lock apply only while focus is running; pausing or ending it lifts them.
  const restrictionsActive = () => S.timer.phase === 'focus' && S.timer.status === 'running';
  // Do Not Disturb and app lock only count as on when the phone has granted the access they need.
  // iOS doesn't let apps switch Focus / Do Not Disturb, so there it's guidance instead of a switch.
  const DND_SUPPORTED = !Device.isIOS;
  const dndOn = (v) => DND_SUPPORTED && !!v && (!Device.isNative || devStatus.dndAccess);
  const lockReady = () => Device.isNative && devStatus.usageAccess && devStatus.overlay;
  const lockOn = (v) => !!v && lockReady();
  const dndActive = () => restrictionsActive() && dndOn(focusPref('dnd'));
  const pendingPerm = { dnd: false, lock: false };
  async function needDndAccess() {
    if (!Device.isNative) return;
    if (Device.isIOS) { iosFocusHelp(); return; }
    const ok = await confirmDialog({ title: 'Allow Do Not Disturb access', confirmText: 'Open settings', cancelText: 'Not now',
      message: 'To silence calls and notifications while you focus, Cadence needs permission to manage Do Not Disturb. In the list that opens, switch Cadence on, then come back.' });
    if (ok) { pendingPerm.dnd = true; Device.openSettings('dnd'); }
  }
  function iosFocusHelp() {
    openModal({ title: 'Quiet your iPhone', size: 'sm', body: `<p>iPhone doesn't let apps turn on Do Not Disturb or a Focus for you.</p>
      <p class="small muted" style="margin-top:8px">Swipe down from the top-right corner to open Control Center, tap <b>Focus</b>, then choose <b>Do Not Disturb</b> or a Focus you've set up. Cadence's timer and screen-break alerts are time-sensitive, so they still reach you.</p>`,
      foot: '<button class="btn btn-primary" data-close>Got it</button>' });
  }
  async function needLockAccess() {
    if (!Device.isNative) return;
    if (Device.isIOS) {
      const ok = await confirmDialog({ title: 'Allow Screen Time access', confirmText: 'Continue', cancelText: 'Not now',
        message: 'Cadence uses Screen Time to lock other apps during focus. iPhone will ask you to confirm with Face ID or your passcode.' });
      if (!ok) return;
      const r = await Device.requestScreenTime(); await refreshDeviceStatus();
      if (r && r.granted) { S.settings.focusMode.lockApps = true; S.focus.lockApps = true; save('settings', 'focus'); renderAll(); toast('App lock on', 'Choose which apps stay usable during focus.', 'ok', { actions: [{ label: 'Choose', fn: () => chooseApps() }] }); }
      return;
    }
    const next = !devStatus.usageAccess ? 'usage' : !devStatus.overlay ? 'overlay' : null;
    if (!next) return;
    const ok = await confirmDialog({ title: next === 'usage' ? 'Allow usage access' : 'Allow display over other apps', confirmText: 'Open settings', cancelText: 'Not now',
      message: next === 'usage'
        ? 'To lock other apps during focus, Cadence needs to see which app is open. In the list that opens, choose Cadence and allow usage access, then come back.'
        : 'To show the lock screen over other apps, Cadence needs “Display over other apps”. Switch it on for Cadence, then come back.' });
    if (ok) { pendingPerm.lock = true; Device.openSettings(next); }
  }
  // After returning from system settings: turn on what the user was trying to turn on.
  function applyPermissionDefaults() {
    const fm = S.settings.focusMode; let changed = false;
    if (Device.isNative && devStatus.dndAccess && !fm.dndAuto) { fm.dndAuto = true; fm.dnd = true; if (!S.focus.active) S.focus.dnd = true; changed = true; }
    if (pendingPerm.dnd && devStatus.dndAccess) { pendingPerm.dnd = false; fm.dnd = true; S.focus.dnd = true; changed = true; toast('Do Not Disturb on', 'Your phone will stay quiet during focus sessions.', 'ok'); }
    if (pendingPerm.lock) {
      if (lockReady()) { pendingPerm.lock = false; fm.lockApps = true; S.focus.lockApps = true; changed = true; toast('App lock on', 'Apps you haven’t allowed are locked while you focus.', 'ok'); }
      else if (devStatus.usageAccess || devStatus.overlay) setTimeout(needLockAccess, 400);
      else pendingPerm.lock = false;
    }
    if (changed) save('settings', 'focus');
  }
  // Allowed-apps chooser (apps not chosen are locked during focus).
  let appListCache = null;
  async function chooseApps() {
    if (!Device.isNative) return;
    if (Device.isIOS) {
      if (!devStatus.usageAccess) { needLockAccess(); return; }
      const r = await Device.pickApps();
      if (r && r.saved) { S.settings.focusMode.allowedIosCount = r.count || 0; save('settings'); renderAll(); toast('Allowed apps saved', `${r.count || 0} app${r.count === 1 ? '' : 's'} stay usable during focus.`, 'ok'); }
      return;
    }
    const m = openModal({ title: 'Allowed during focus', id: 'apps', body: `<p class="small muted">Checked apps stay usable while you focus. Every other app shows a lock screen until your break. Phone calls, Settings and Cadence are always allowed.</p>
      <div class="search-box"><svg><use href="#i-search"/></svg><input type="search" id="appSearch" placeholder="Search apps" aria-label="Search apps"></div>
      <div class="app-pick-list" id="appPick"><div class="empty"><p class="small muted">Loading your apps…</p></div></div>`,
      foot: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-save>Save</button>' });
    const chosen = new Set(S.settings.focusMode.allowedApps);
    if (!appListCache) appListCache = await Device.listApps();
    const draw = () => {
      const q = ($('#appSearch', m.el).value || '').trim().toLowerCase();
      const list = appListCache.filter((a) => !q || a.label.toLowerCase().includes(q));
      $('#appPick', m.el).innerHTML = list.length ? list.map((a) => `<label class="app-pick"><img src="${a.icon}" alt=""><span>${esc(a.label)}</span><input type="checkbox" value="${esc(a.pkg)}" ${chosen.has(a.pkg) ? 'checked' : ''}><i class="tick"></i></label>`).join('') : '<p class="small muted" style="padding:12px">No apps match.</p>';
    };
    draw();
    $('#appSearch', m.el).addEventListener('input', draw);
    $('#appPick', m.el).addEventListener('change', (e) => { if (e.target.checked) chosen.add(e.target.value); else chosen.delete(e.target.value); });
    m.el.querySelector('[data-save]').onclick = () => { S.settings.focusMode.allowedApps = Array.from(chosen); save('settings'); m.close(true); renderAll(); toast('Allowed apps saved', `${chosen.size} app${chosen.size === 1 ? '' : 's'} stay usable during focus.`, 'ok'); };
  }
  const allowedCount = () => (Device.isIOS ? S.settings.focusMode.allowedIosCount || 0 : S.settings.focusMode.allowedApps.length);

  function startTimer(at = Date.now()) {
    const t = S.timer; t.total = phaseTotal(t.phase); t.endAt = at + t.total; t.status = 'running'; t.phaseStartedAt = at; t.awaiting = null;
    if (t.phase === 'focus') { if (S.settings.focusMode.trackWork) startWork(timerTask(), 'timer', at); musicForPhase('focus'); }
    else musicForPhase('break');
    save('timer'); renderLive(true);
  }
  function pauseTimer(at = Date.now()) {
    const t = S.timer; if (t.status !== 'running') return;
    t.remaining = Math.max(0, t.endAt - at); t.status = 'paused';
    if (t.phase === 'focus') stopWork(timerTask(), at, false, 'timer');
    save('timer'); renderLive(true);
  }
  function resumeTimer(at = Date.now()) {
    const t = S.timer; if (t.status !== 'paused') return;
    t.endAt = at + t.remaining; t.status = 'running';
    if (t.phase === 'focus' && S.settings.focusMode.trackWork) startWork(timerTask(), 'timer', at);
    save('timer'); renderLive(true);
  }
  function recordSession(type, ms, at, completed) {
    S.sessions.push({ id: uid(), type, taskId: S.timer.taskId || null, start: at - ms, end: at, ms: Math.round(ms), completed });
    if (type === 'focus') { const tk = timerTask(); if (tk) { tk.focusMs += ms; save('tasks'); } }
    save('sessions');
  }
  function elapsedMs(now = Date.now()) { const t = S.timer; return t.status === 'idle' ? 0 : t.total - remaining(now); }
  function resetTimer(silent) {
    const t = S.timer; const el = elapsedMs();
    if (t.phase === 'focus' && t.status !== 'idle' && el >= MIN) recordSession('focus', el, Date.now(), false);
    if (t.phase === 'focus') stopWork(timerTask(), Date.now(), false, 'timer');
    t.status = 'idle'; t.awaiting = null; save('timer'); renderLive(true);
    if (!silent && el >= MIN && t.phase === 'focus') toast('Session reset', `${fmtDur(el)} of focus time was still counted.`);
  }
  function setPhase(phase) { if (S.timer.status !== 'idle') resetTimer(true); S.timer.phase = phase; save('timer'); renderLive(true); }
  function skipPhase(at = Date.now()) {
    const t = S.timer;
    if (t.phase === 'focus') {
      const el = elapsedMs(at); if (el >= MIN) recordSession('focus', el, at, false);
      stopWork(timerTask(), at, false, 'timer');
      t.phase = (t.cycle + 1) % S.settings.pomodoro.interval === 0 ? 'long' : 'short'; t.status = 'idle';
      save('timer'); renderLive(true); promptBreak();
    } else {
      if (t.phase === 'long') t.cycle = 0;
      t.phase = 'focus'; t.status = 'idle'; save('timer'); renderLive(true);
      if (S.focus.active) promptNextFocus();
    }
  }
  function completePhase(at) {
    const t = S.timer; const phase = t.phase;
    // A phase that ended while Cadence was closed was already announced by a system notification.
    const live = Date.now() - at < MIN && document.visibilityState === 'visible';
    const sounds = live && S.settings.general.sounds && S.settings.general.timerSound;
    if (phase === 'focus') {
      recordSession('focus', t.total, at, true);
      stopWork(timerTask(), at, false, 'timer');
      t.cycle = (t.cycle || 0) + 1;
      const next = t.cycle % S.settings.pomodoro.interval === 0 ? 'long' : 'short';
      const tk = timerTask();
      notify('pomodoro', 'Focus session complete', `${tk ? tk.title + ' · ' : ''}${fmtDur(t.total)} focused. Time for a ${next === 'long' ? 'long' : 'short'} break.`, { silent: true, noToast: !live });
      if (sounds) CadenceAudio.chime('focusEnd', S.settings.general.chimeVolume);
      if (live) buzz([180, 90, 180]);
      t.phase = next; t.status = 'idle';
      if (S.settings.pomodoro.autoTransition) { startTimer(at); if (live) breakToast(); }
      else { t.awaiting = 'break'; save('timer'); promptBreak(); }
    } else {
      recordSession(phase, t.total, at, true);
      if (phase === 'long') t.cycle = 0;
      notify('breakDone', 'Break finished', S.focus.active ? 'Ready to resume Focus Mode?' : 'Ready for another focus session?', { silent: true, noToast: !live });
      if (sounds) CadenceAudio.chime('breakEnd', S.settings.general.chimeVolume);
      if (live) buzz([120, 80, 120]);
      t.phase = 'focus'; t.status = 'idle'; t.awaiting = 'focus'; save('timer');
      promptNextFocus();
    }
    checkAchievements(); save('timer'); renderLive(true);
  }
  function randomSuggestion() { const l = S.settings.breakSuggestions; return l.length ? l[Math.floor(Math.random() * l.length)] : 'Take a moment to rest.'; }
  function breakToast() {
    toast(`${PHASE_LABEL[S.timer.phase]} started`, `${randomSuggestion()}${S.focus.active && S.focus.dnd ? ' Do Not Disturb is off for the break.' : ''}`, 'ok', { actions: [{ label: 'Skip break', fn: () => skipPhase() }] });
  }
  async function promptBreak() {
    const ph = S.timer.phase; const len = fmtDur(phaseTotal(ph));
    const v = await choiceDialog({ id: 'prompt', title: 'Focus session complete', message: `<p>Nice work. Take a ${len} ${ph === 'long' ? 'long' : 'short'} break?</p><div class="break-suggest" style="margin-top:12px">${icon('i-moon')}<div><b>Suggestion</b>${esc(randomSuggestion())}</div></div>`,
      choices: [{ label: 'Skip break', value: 'skip' }, { label: `Start ${ph === 'long' ? 'long' : 'short'} break`, value: 'start', kind: 'btn-warm' }] });
    if (S.timer.status !== 'idle' || S.timer.phase === 'focus') return;
    if (v === 'start') { startTimer(); breakToast(); }
    else if (v === 'skip') { if (ph === 'long') S.timer.cycle = 0; S.timer.phase = 'focus'; S.timer.awaiting = null; save('timer'); renderLive(true); if (S.focus.active) promptNextFocus(); }
    else { S.timer.awaiting = null; save('timer'); }
  }
  async function promptNextFocus() {
    const fm = S.focus.active;
    const choices = fm
      ? [{ label: 'End Focus Mode', value: 'end' }, { label: 'Change settings', value: 'change' }, { label: 'Resume Focus Mode', value: 'resume', kind: 'btn-primary' }]
      : [{ label: 'Not now', value: 'no' }, { label: 'Focus Mode…', value: 'setup' }, { label: 'Start focus session', value: 'start', kind: 'btn-primary' }];
    const tk = timerTask();
    const v = await choiceDialog({ id: 'prompt', title: 'Break is over', message: fm
      ? `<p>Resume Focus Mode with your previous settings?</p><p class="small muted" style="margin-top:6px">${tk ? esc(tk.title) + ' · ' : ''}${S.focus.duration} min · Do Not Disturb ${S.focus.dnd ? 'on' : 'off'}</p>`
      : '<p>Want to start another focus session?</p>', choices });
    if (S.timer.status !== 'idle') return;
    S.timer.awaiting = null; save('timer');
    if (v === 'resume' || v === 'start') startTimer();
    else if (v === 'change' || v === 'setup') openFocusSetup(S.focus.taskId || S.timer.taskId, true);
    else if (v === 'end') endFocusMode(true);
  }

  function musicForPhase(kind) {
    if (kind === 'focus') {
      if (S.focus.active && S.focus.music && S.focus.music !== 'none' && S.settings.focusMode.autoMusic) {
        const cur = CadenceAudio.current;
        if (!cur || cur.category !== S.focus.music) playCategory(S.focus.music); else if (!CadenceAudio.playing) musicResume();
      } else if (music.pausedForBreak) musicResume();
      music.pausedForBreak = false;
    } else if (S.settings.music.pauseOnBreak && CadenceAudio.playing) { CadenceAudio.pause(); music.pausedForBreak = true; }
  }

  function openFocusSetup(taskId, isResume) {
    const editing = S.focus.active && S.timer.status !== 'idle';
    const cfg = S.focus.active ? clone(S.focus) : { taskId: taskId || S.timer.taskId || null, duration: S.settings.focusMode.defaultDuration, music: S.settings.music.category, dnd: S.settings.focusMode.dnd, lockApps: S.settings.focusMode.lockApps, allow: clone(S.focus.allow || S.settings.focusMode.allow) };
    if (taskId) cfg.taskId = taskId;
    const open = S.tasks.filter((t) => t.status !== 'completed');
    const musicOpts = [['none', 'No music']].concat(CadenceAudio.library.map((c) => [c.id, c.name]));
    const body = `
      <label class="field"><span>1. Task</span><select class="select" name="task"><option value="">No specific task</option>${open.map((t) => `<option value="${t.id}" ${cfg.taskId === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></label>
      <div class="field"><span class="field-label">2. Focus duration</span>
        <div class="pill-group" id="durPills">${[15, 25, 45, 50, 60, 90].map((m) => `<button type="button" class="pill" data-dur="${m}" aria-pressed="${cfg.duration === m}">${m} min</button>`).join('')}</div>
        <div class="input-suffix"><input class="input" type="number" inputmode="numeric" min="1" max="240" name="duration" value="${cfg.duration}" aria-label="Focus minutes"><span>min</span></div>
        ${editing ? '<span class="field-hint">Changing the duration adjusts the session that is running now.</span>' : ''}</div>
      <label class="field"><span>3. Background music</span><select class="select" name="music">${musicOpts.map(([v, l]) => `<option value="${v}" ${cfg.music === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${DND_SUPPORTED ? `<div class="set-row" style="padding:4px 0;border:0"><div class="lbl"><b>4. Do Not Disturb</b><span>Silences your phone while you focus and turns off again for breaks.</span></div><div class="ctl">${sw('name="dnd"', dndOn(cfg.dnd))}</div></div>`
        : `<div class="set-row" style="padding:4px 0;border:0"><div class="lbl"><b>4. Quiet your iPhone</b><span>Turn on a Focus from Control Center. <button type="button" class="widget-link" data-action="iosFocusHelp">How</button></span></div><div class="ctl"><input type="checkbox" name="dnd" hidden></div></div>`}
      <div class="set-row" style="padding:4px 0;border:0"><div class="lbl"><b>5. Lock other apps</b><span>${allowedCount()} allowed app${allowedCount() === 1 ? '' : 's'} · <button type="button" class="widget-link" data-action="chooseApps">Choose</button></span></div><div class="ctl">${sw('name="lock"', lockOn(cfg.lockApps))}</div></div>`;
    const m = openModal({ title: editing ? 'Focus settings' : isResume ? 'Next focus session' : 'Set up Focus Mode', body, id: 'focus-setup',
      foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-go>${editing ? 'Apply changes' : icon('i-play') + 'Start focusing'}</button>` });
    const durIn = m.el.querySelector('[name=duration]');
    $('#durPills', m.el).addEventListener('click', (e) => { const b = e.target.closest('[data-dur]'); if (!b) return; durIn.value = b.dataset.dur; $$('[data-dur]', m.el).forEach((x) => x.setAttribute('aria-pressed', x === b)); });
    durIn.addEventListener('input', () => $$('[data-dur]', m.el).forEach((x) => x.setAttribute('aria-pressed', x.dataset.dur === durIn.value)));
    m.el.querySelector('[name=dnd]').addEventListener('change', (e) => { if (e.target.checked && Device.isNative && !devStatus.dndAccess) { e.target.checked = false; needDndAccess(); } });
    m.el.querySelector('[name=lock]').addEventListener('change', (e) => { if (e.target.checked && !lockReady()) { e.target.checked = false; needLockAccess(); } });
    m.el.querySelector('[data-go]').onclick = () => {
      const dur = clamp(Math.round(+durIn.value || 25), 1, 240);
      const next = { taskId: m.el.querySelector('[name=task]').value || null, duration: dur, music: m.el.querySelector('[name=music]').value, dnd: m.el.querySelector('[name=dnd]').checked, lockApps: m.el.querySelector('[name=lock]').checked, allow: clone(cfg.allow) };
      m.close(true);
      if (editing) applyFocusChanges(next); else startFocusMode(next);
    };
  }
  function startFocusMode(cfg) {
    if (S.timer.status !== 'idle') resetTimer(true);
    if (S.timer.taskId && S.timer.taskId !== cfg.taskId) stopWork(timerTask(), Date.now(), false, 'timer');
    Object.assign(S.focus, cfg, { active: true, startedAt: Date.now(), resumeAfterBreak: true });
    S.timer.taskId = cfg.taskId; S.timer.phase = 'focus';
    save('focus'); startTimer();
    go('focus');
    toast('Focus Mode on', `${cfg.duration} min${dndOn(cfg.dnd) ? ' · Do Not Disturb on' : ''}${lockOn(cfg.lockApps) ? ' · apps locked' : ''}`, 'ok');
  }
  function applyFocusChanges(cfg) {
    const t = S.timer; const prevTask = t.taskId;
    if (prevTask !== cfg.taskId && t.phase === 'focus') { stopWork(timerTask(), Date.now(), false, 'timer'); t.taskId = cfg.taskId; if (t.status === 'running' && S.settings.focusMode.trackWork) startWork(timerTask(), 'timer'); }
    const durChanged = cfg.duration !== S.focus.duration;
    const musicChanged = cfg.music !== S.focus.music;
    Object.assign(S.focus, cfg);
    if (durChanged && t.phase === 'focus' && t.status !== 'idle') {
      const el = elapsedMs(); t.total = cfg.duration * MIN;
      if (t.status === 'running') t.endAt = Date.now() + Math.max(0, t.total - el); else t.remaining = Math.max(0, t.total - el);
    }
    if (musicChanged && t.phase === 'focus' && t.status === 'running') { if (cfg.music === 'none') CadenceAudio.pause(); else playCategory(cfg.music); }
    save('focus', 'timer', 'settings'); renderLive(true); renderAll();
    toast('Focus settings updated', '', 'ok');
  }
  async function endFocusMode(skipConfirm) {
    if (!skipConfirm && S.timer.status !== 'idle') {
      const ok = await confirmDialog({ title: 'End focus session?', message: `You've focused for ${fmtDur(S.timer.phase === 'focus' ? elapsedMs() : 0)} this session. Time already focused will still be counted.`, confirmText: 'End session' });
      if (!ok) return;
    }
    const focusMs = S.sessions.filter((s) => s.type === 'focus' && s.end >= S.focus.startedAt).reduce((a, s) => a + s.ms, 0) + (S.timer.phase === 'focus' ? elapsedMs() : 0);
    resetTimer(true); S.timer.phase = 'focus'; S.focus.active = false; save('focus', 'timer');
    if (S.settings.music.pauseOnBreak && CadenceAudio.playing) CadenceAudio.pause();
    renderAll(); toast('Focus Mode ended', `Total this run: ${fmtDur(focusMs)}.`, 'ok');
  }

  /* --- timer display helpers --- */
  function ringHTML(size, stroke) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return `<div class="ring js-ring" style="width:${size}px;height:${size}px" data-c="${c}">
      <svg viewBox="0 0 ${size} ${size}"><circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c}"/></svg>
      <div class="ring-center"><div class="label js-t-label"></div><div class="time js-t-time" style="font-size:${Math.round(size / 4.6)}px"></div><div class="tiny muted js-t-sub"></div></div></div>`;
  }
  function timerControlsHTML() {
    const t = S.timer; const b = [];
    if (t.status === 'idle') b.push(`<button class="btn btn-primary" data-action="timerStart">${icon('i-play')}Start${t.phase !== 'focus' ? ' break' : ''}</button>`);
    if (t.status === 'running') b.push(`<button class="btn btn-soft" data-action="timerPause">${icon('i-pause')}Pause</button>`);
    if (t.status === 'paused') b.push(`<button class="btn btn-primary" data-action="timerResume">${icon('i-play')}Resume</button>`);
    if (t.status !== 'idle') b.push(`<button class="btn btn-ghost" data-action="timerReset" aria-label="Reset">${icon('i-reset')}Reset</button>`);
    b.push(`<button class="btn btn-ghost" data-action="timerSkip" aria-label="${t.phase === 'focus' ? 'End focus early, go to break' : 'Skip break'}" title="${t.phase === 'focus' ? 'End early → break' : 'Skip break'}">${icon('i-skip')}</button>`);
    return b.join('');
  }
  function dotsHTML() {
    const n = S.settings.pomodoro.interval; const c = S.timer.cycle % n || (S.timer.cycle && S.timer.phase === 'long' ? n : 0);
    return Array.from({ length: n }, (_, i) => `<i class="${i < c ? 'done' : ''}"></i>`).join('');
  }
  let lastCtrlSig = '';
  function renderLive(force) {
    const t = S.timer; const rem = remaining(); const tot = totalMs() || 1; const prog = clamp(1 - rem / tot, 0, 1);
    const isBreak = t.phase !== 'focus';
    $$('.js-ring').forEach((r) => { const c = +r.dataset.c; r.querySelector('.ring-fg').style.strokeDashoffset = c * (1 - prog); r.classList.toggle('break', isBreak); });
    $$('.js-t-time').forEach((e) => (e.textContent = fmtClock(rem)));
    $$('.js-t-label').forEach((e) => (e.textContent = PHASE_LABEL[t.phase] + (t.status === 'paused' ? ' · paused' : '')));
    $$('.js-t-sub').forEach((e) => (e.textContent = t.status === 'running' ? `ends ${fmtTime(t.endAt)}` : t.status === 'paused' ? 'paused' : `${Math.round(tot / MIN)} min`));
    const sig = `${t.status}|${t.phase}|${t.cycle}|${S.focus.active}|${S.settings.pomodoro.interval}`;
    if (force || sig !== lastCtrlSig) {
      lastCtrlSig = sig;
      $$('.js-t-ctrl').forEach((e) => (e.innerHTML = timerControlsHTML()));
      $$('.js-t-dots').forEach((e) => (e.innerHTML = dotsHTML()));
      if (force) { if (ui.screen === 'focus') renderFocus(); if (ui.screen === 'home') renderActiveCard(); }
    }
    const ac = $('.js-active-time'); if (ac) ac.textContent = fmtClock(rem);
  }

  /* ============ 8. Screen Break Reminder ============ */
  let eyeTimerId = null;
  function eyeEligible() {
    const mode = S.settings.screenBreak.applyTo; const visible = document.visibilityState === 'visible';
    if (Device.isNative && !visible) return false; // the device sends screen-break notifications instead
    const focusing = S.timer.status === 'running' && S.timer.phase === 'focus';
    if (mode === 'focus') return focusing;
    if (mode === 'general') return visible && !focusing;
    return visible || focusing;
  }
  function eyeTick(now) {
    const e = S.eye; const cfg = S.settings.screenBreak;
    if (e.active) { if (now >= e.active.endAt) completeEye(false); return; }
    const dt = e.lastTick ? clamp(now - e.lastTick, 0, 2 * MIN) : 0; e.lastTick = now;
    if (!cfg.enabled || now < e.snoozeUntil) return;
    if (eyeEligible()) e.accum += dt;
    if (e.accum >= cfg.interval * MIN) triggerEye(now);
    if (Math.random() < 0.1) save('eye');
  }
  function triggerEye(now = Date.now()) {
    const cfg = S.settings.screenBreak; const e = S.eye;
    e.active = { startedAt: now, endAt: now + cfg.duration * 1000, duration: cfg.duration, pausedTimer: false };
    if (cfg.pauseTimer && S.timer.status === 'running') { pauseTimer(); e.active.pausedTimer = true; }
    buzz(250);
    save('eye');
    notify('screenBreak', 'Screen break', `Look at something about 20 feet away for ${cfg.duration >= 60 ? fmtDur(cfg.duration * 1000) : cfg.duration + ' seconds'}.`, { soundKind: 'screen', noToast: true });
    showEyeOverlay();
  }
  function endEye(action, extra = {}) {
    const e = S.eye; if (!e.active) return;
    const a = e.active; const now = Date.now();
    S.eyeLog.push(Object.assign({ ts: now, action, ms: Math.min(now - a.startedAt, a.duration * 1000), planned: a.duration * 1000 }, extra)); S.eyeLog = S.eyeLog.slice(-1000);
    e.active = null; e.lastTick = now;
    if (action !== 'postponed') e.accum = 0;
    if (a.pausedTimer && S.timer.status === 'paused') resumeTimer();
    save('eye', 'eyeLog'); hideEyeOverlay(); checkAchievements(); if (ui.screen !== 'focus') renderAll(); else renderLive(true);
  }
  function completeEye(early) { if (!S.eye.active) return; endEye('completed', { early }); toast('Screen break done', S.timer.status === 'running' ? 'Your focus session continues.' : 'Welcome back.', 'ok'); }
  function skipEye() { endEye('skipped'); }
  function postponeEye(min) { const cfg = S.settings.screenBreak; min = min || cfg.postponeMin; S.eye.accum = Math.max(0, cfg.interval * MIN - min * MIN); endEye('postponed', { minutes: min }); toast('Screen break postponed', `Reminding you again in about ${min} min of screen time.`); }
  function snoozeEye(ms, label) { S.eye.snoozeUntil = Date.now() + ms; if (S.eye.active) endEye('skipped'); save('eye'); renderAll(); toast('Screen Break Reminders paused', label); }
  function showEyeOverlay() {
    const o = $('#eyeOverlay'); const a = S.eye.active; if (!a) return;
    o.innerHTML = `
      <p class="eyebrow" style="color:#9FD3CB">Screen break</p>
      <h2 id="eyeTitle">Rest your eyes</h2>
      <div class="breath" aria-hidden="true"><div class="cd js-eye-cd"></div><div class="phase js-eye-phase">Breathe in</div></div>
      <div class="eye-progress" style="margin-top:22px"><span class="js-eye-bar"></span></div>
      <ol class="eye-steps">
        <li><b>1</b>Look away from the screen.</li>
        <li><b>2</b>Focus on something about 20 feet (6 m) away.</li>
        <li><b>3</b>Blink slowly and relax your eyes.</li>
        <li><b>4</b>Stretch your neck and shoulders.</li>
      </ol>
      <p class="small" style="opacity:.7">${a.pausedTimer ? 'Your Pomodoro timer is paused and resumes after this break.' : S.timer.status === 'running' ? 'Your Pomodoro timer keeps running.' : ''} This is a screen break, separate from Pomodoro breaks.</p>
      <div class="eye-actions">
        <button class="btn btn-primary" data-action="eyeDone">${icon('i-check')}Complete break</button>
        <button class="btn" data-action="eyePostpone">Postpone ${S.settings.screenBreak.postponeMin} min</button>
        <button class="btn" data-action="eyeSkip">Skip</button>
        <button class="btn" data-action="eyeSettings">${icon('i-settings')}Adjust settings</button>
      </div>`;
    o.hidden = false; document.body.classList.add('no-scroll');
    setTimeout(() => { const b = o.querySelector('[data-action=eyeDone]'); if (b) b.focus(); }, 50);
    clearInterval(eyeTimerId); eyeTimerId = setInterval(updateEyeOverlay, 250); updateEyeOverlay();
  }
  function updateEyeOverlay() {
    const a = S.eye.active; if (!a) return;
    const left = Math.max(0, a.endAt - Date.now()); const s = Math.ceil(left / 1000);
    const cd = $('.js-eye-cd'); if (cd) cd.textContent = s >= 60 ? fmtSec(s) : s;
    const bar = $('.js-eye-bar'); if (bar) bar.style.width = `${(1 - left / (a.duration * 1000)) * 100}%`;
    const ph = $('.js-eye-phase'); if (ph) ph.textContent = ((Date.now() - a.startedAt) % 8000) < 4000 ? 'Breathe in' : 'Breathe out';
    if (left <= 0) completeEye(false);
  }
  function hideEyeOverlay() { clearInterval(eyeTimerId); $('#eyeOverlay').hidden = true; $('#eyeOverlay').innerHTML = ''; if (!modalStack.length) document.body.classList.remove('no-scroll'); }
  function eyeStatus() {
    const cfg = S.settings.screenBreak; const now = Date.now();
    if (!cfg.enabled) return { state: 'off', text: 'Turned off' };
    if (now < S.eye.snoozeUntil) return { state: 'snoozed', text: `Paused until ${fmtTime(S.eye.snoozeUntil)}${dayKey(S.eye.snoozeUntil) !== dayKey(now) ? ' ' + relDay(S.eye.snoozeUntil).toLowerCase() : ''}` };
    const left = Math.max(0, cfg.interval * MIN - S.eye.accum);
    return { state: eyeEligible() ? 'counting' : 'waiting', text: `Next in ~${Math.max(1, Math.ceil(left / MIN))} min of ${cfg.applyTo === 'focus' ? 'focus' : 'screen'} time`, left };
  }

  /* ============ 9. Music player ============ */
  const music = { pausedForBreak: false };
  S.music.uploads = (S.music.uploads || []).filter((u) => u && u.id && u.path);
  function registerUploads() {
    CadenceAudio.setCustom(S.music.uploads.map((u) => ({ id: u.id, title: u.title, category: u.category, src: Device.fileSrc(u.path), length: u.length || 0 })));
  }
  registerUploads();
  // Lets the user pick a category in an app-styled sheet; resolves to its id (or null).
  function pickCategory(title, current) {
    return new Promise((res) => {
      let done = false;
      const m = openModal({ title, size: 'sheet', id: 'cat-sheet', onClose: () => { if (!done) res(null); },
        body: `<p class="small muted" style="margin-bottom:6px">Your tracks are added to this category in the player.</p><div class="opt-list">${CadenceAudio.library.map((c) => `<button type="button" class="opt ${c.id === current ? 'on' : ''}" data-id="${c.id}"><span>${esc(c.name)}</span>${c.id === current ? icon('i-check') : ''}</button>`).join('')}</div>` });
      m.el.querySelector('.opt-list').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (!b) return; done = true; m.close(true); res(b.dataset.id); });
    });
  }
  function audioLength(src) {
    return new Promise((res) => {
      const el = new Audio(); let settled = false; const fin = (v) => { if (!settled) { settled = true; res(v); } };
      el.preload = 'metadata'; el.onloadedmetadata = () => fin(isFinite(el.duration) ? Math.round(el.duration) : 0); el.onerror = () => fin(0);
      setTimeout(() => fin(0), 5000); el.src = src;
    });
  }
  async function uploadMusic() {
    if (!Device.isNative) { toast('Not available here', 'Uploading music works in the Cadence app.', 'err'); return; }
    const files = await Device.pickAudio();
    if (!files.length) return;
    const cat = await pickCategory(files.length > 1 ? `Add ${files.length} tracks to…` : 'Add track to…', S.music.category !== 'fav' ? S.music.category : 'lofi');
    if (!cat) { files.forEach((f) => Device.deleteAudio(f.path)); return; }
    for (const f of files) {
      const length = await audioLength(Device.fileSrc(f.path));
      S.music.uploads.push({ id: 'up-' + uid(), title: String(f.name || 'Track').slice(0, 120), category: cat, path: f.path, length });
    }
    S.music.category = cat; save('music'); registerUploads(); renderMusic();
    if (ui.screen === 'settings') renderSettingsKeepScroll();
    toast(files.length > 1 ? `${files.length} tracks added` : 'Track added', `In ${(CadenceAudio.library.find((c) => c.id === cat) || {}).name || 'your music'}.`, 'ok');
  }
  async function removeUpload(id) {
    const u = S.music.uploads.find((x) => x.id === id); if (!u) return;
    if (!(await confirmDialog({ title: 'Remove track?', message: `“${esc(u.title)}” will be deleted from Cadence.`, confirmText: 'Remove', danger: true }))) return;
    if (CadenceAudio.current && CadenceAudio.current.id === id) CadenceAudio.stop();
    S.music.uploads = S.music.uploads.filter((x) => x.id !== id); S.music.favorites = S.music.favorites.filter((x) => x !== id);
    Device.deleteAudio(u.path); save('music'); registerUploads(); renderMusic();
    if (ui.screen === 'settings') renderSettingsKeepScroll();
  }
  const CAT_ART = { lofi: 'linear-gradient(135deg,#d397fa,#8364e8)', ambient: 'linear-gradient(135deg,#8FB8F0,#6A4BD8)', rain: 'linear-gradient(135deg,#7EA6E0,#4F5FC4)', nature: 'linear-gradient(135deg,#8DD3B0,#3FA07A)', white: 'linear-gradient(135deg,#B9B2CC,#6B6383)', instrumental: 'linear-gradient(135deg,#F2B37A,#C46BD6)', piano: 'linear-gradient(135deg,#4A3F6B,#1D1730)', cafe: 'linear-gradient(135deg,#D9A273,#8A5A3C)', ocean: 'linear-gradient(135deg,#6FC3E0,#2F6FB8)', forest: 'linear-gradient(135deg,#7CC48F,#2E6B45)', fav: 'linear-gradient(135deg,#F59AC0,#d397fa)' };
  function musicList(cat) {
    if (cat === 'fav') return S.music.favorites.map((id) => CadenceAudio.findTrack(id)).filter(Boolean);
    const c = CadenceAudio.library.find((x) => x.id === cat); return c ? c.tracks : [];
  }
  async function playTrack(id) {
    const ok = await CadenceAudio.play(id);
    if (!ok) { toast('Audio unavailable', 'Music could not start on this device.', 'err'); return; }
    S.music.trackId = id; save('music'); renderMusic();
  }
  function playCategory(cat) {
    S.music.category = cat; const list = musicList(cat); if (!list.length) return;
    const fav = list.find((t) => S.music.favorites.includes(t.id));
    playTrack((S.music.shuffle ? list[Math.floor(Math.random() * list.length)] : fav || list[0]).id);
  }
  async function musicResume() {
    if (CadenceAudio.current) { await CadenceAudio.resume(); renderMusic(); }
    else if (S.music.trackId && CadenceAudio.findTrack(S.music.trackId)) playTrack(S.music.trackId);
    else playCategory(S.music.category || S.settings.music.category);
  }
  function musicToggle() { if (CadenceAudio.playing) { CadenceAudio.pause(); music.pausedForBreak = false; renderMusic(); } else musicResume(); }
  function musicStep(dir) {
    const cur = CadenceAudio.current || CadenceAudio.findTrack(S.music.trackId);
    let list = musicList(S.music.category); if (!list.length) list = cur ? musicList(cur.category) : [];
    if (!list.length) return;
    if (S.music.shuffle && list.length > 1) { let n; do n = list[Math.floor(Math.random() * list.length)]; while (cur && n.id === cur.id); playTrack(n.id); return; }
    const i = cur ? list.findIndex((t) => t.id === cur.id) : -1;
    playTrack(list[(i + dir + list.length) % list.length].id);
  }
  CadenceAudio.on((ev) => {
    if (ev.type === 'ended') { if (S.music.repeat) playTrack(ev.track.id); else musicStep(1); }
    else { renderMusic(); scheduleSync(); }
  });
  function toggleFav(id) {
    const f = S.music.favorites; const i = f.indexOf(id); if (i >= 0) f.splice(i, 1); else f.push(id);
    save('music'); renderMusic();
  }
  function playerHTML(compact) {
    const cur = CadenceAudio.current || CadenceAudio.findTrack(S.music.trackId);
    const playing = CadenceAudio.playing; const cat = S.music.category;
    const list = musicList(cat);
    const cats = [['fav', '♥ Favorites']].concat(CadenceAudio.library.map((c) => [c.id, c.name]));
    if (!CadenceAudio.supported) return emptyState('i-music', 'Audio not available', 'Focus music is not available on this device.');
    return `<div class="player">
      <div class="player-now">
        <div class="art ${playing ? 'playing' : ''}" style="background:${CAT_ART[cur ? cur.category : cat] || CAT_ART.lofi}">${icon('i-music')}</div>
        <div style="flex:1;min-width:0"><div class="t">${cur ? esc(cur.title) : 'Nothing playing'}</div><div class="c">${cur ? esc(cur.categoryName) + (playing ? ' · playing' : ' · paused') : 'Pick a category below'}</div></div>
        ${cur ? `<button class="icon-btn ${S.music.favorites.includes(cur.id) ? 'on' : ''}" data-action="musicFav" data-id="${cur.id}" aria-label="${S.music.favorites.includes(cur.id) ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${S.music.favorites.includes(cur.id)}">${icon(S.music.favorites.includes(cur.id) ? 'i-heart-fill' : 'i-heart')}</button>` : ''}
      </div>
      <div class="prog-row"><span class="js-mp-time">${fmtSec(CadenceAudio.position())}</span><input type="range" class="range js-mp-seek" min="0" max="${cur ? cur.length : 1}" value="${Math.floor(CadenceAudio.position())}" aria-label="Track progress" ${cur ? '' : 'disabled'}><span>${cur ? fmtSec(cur.length) : '0:00'}</span></div>
      <div class="player-controls">
        <button class="icon-btn ${S.music.shuffle ? 'on' : ''}" data-action="musicShuffle" aria-label="Shuffle" aria-pressed="${S.music.shuffle}">${icon('i-shuffle')}</button>
        <button class="icon-btn" data-action="musicPrev" aria-label="Previous track">${icon('i-prev')}</button>
        <button class="play-btn" data-action="musicToggle" aria-label="${playing ? 'Pause' : 'Play'}">${icon(playing ? 'i-pause' : 'i-play')}</button>
        <button class="icon-btn" data-action="musicNext" aria-label="Next track">${icon('i-next')}</button>
        <button class="icon-btn ${S.music.repeat ? 'on' : ''}" data-action="musicRepeat" aria-label="Repeat track" aria-pressed="${S.music.repeat}">${icon('i-repeat')}</button>
      </div>
      <div class="prog-row">${icon('i-volume')}<input type="range" class="range js-mp-vol" min="0" max="100" value="${Math.round(S.music.volume * 100)}" aria-label="Volume"><span class="js-mp-volv">${Math.round(S.music.volume * 100)}%</span></div>
      ${compact ? `<label class="field"><span class="sr-only">Category</span><select class="select" data-action-change="musicCat">${cats.map(([v, l]) => `<option value="${v}" ${cat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
        : `<div class="cat-scroll">${cats.map(([v, l]) => `<button class="pill" data-action="musicCat" data-id="${v}" aria-pressed="${cat === v}">${l}</button>`).join('')}</div>
      <div class="track-list">${list.length ? list.map((t) => `<div class="track-row"><button class="track ${cur && cur.id === t.id ? 'active' : ''}" data-action="musicPlay" data-id="${t.id}"><span class="tn">${esc(t.title)}${t.file ? ' <span class="chip">yours</span>' : ''}</span>${S.music.favorites.includes(t.id) ? `<span class="fav">${icon('i-heart-fill')}</span>` : ''}<span class="tl">${t.length ? fmtSec(t.length) : ''}</span></button>${t.file ? `<button class="icon-btn sm" data-action="removeUpload" data-id="${t.id}" aria-label="Remove ${esc(t.title)}">${icon('i-trash')}</button>` : ''}</div>`).join('') : `<p class="small muted" style="padding:8px">${cat === 'fav' ? 'No favorites yet — tap the heart on a track you like.' : 'No tracks here yet — upload your own music below.'}</p>`}</div>
      <button class="btn btn-soft btn-sm" data-action="uploadMusic" style="align-self:flex-start">${icon('i-plus')}Upload music</button>`}
      <p class="tiny muted">Built-in tracks are generated on your device. Music keeps playing when you leave the app, with controls in your notifications.</p>
    </div>`;
  }
  function renderMusic() {
    $$('.js-music').forEach((e) => (e.innerHTML = playerHTML(e.dataset.compact === '1')));
    const cur = CadenceAudio.current; const playing = CadenceAudio.playing;
    const mini = (cls) => cur ? `<div class="art ${playing ? 'playing' : ''}" style="background:${CAT_ART[cur.category]}">${icon('i-music')}</div>
      <div class="meta"><div class="t">${esc(cur.title)}</div><div class="c">${esc(cur.categoryName)}</div></div>
      <button class="icon-btn" data-action="musicToggle" aria-label="${playing ? 'Pause' : 'Play'}">${icon(playing ? 'i-pause' : 'i-play')}</button>
      <button class="icon-btn" data-action="musicNext" aria-label="Next">${icon('i-next')}</button>${cls}` : '';
    const mp = $('#miniPlayer');
    mp.hidden = !cur || ui.screen === 'focus';
    mp.innerHTML = mini('<button class="icon-btn" data-action="musicStop" aria-label="Close player">' + icon('i-x') + '</button><div class="mp-bar"><span class="js-mp-bar"></span></div>');
    document.body.classList.toggle('mini-on', !mp.hidden);
  }
  function updateMusicProgress() {
    const cur = CadenceAudio.current; if (!cur) return;
    const p = CadenceAudio.position();
    $$('.js-mp-time').forEach((e) => (e.textContent = fmtSec(p)));
    $$('.js-mp-seek').forEach((e) => { if (document.activeElement !== e) e.value = Math.floor(p); });
    $$('.js-mp-bar').forEach((e) => (e.style.width = `${(p / cur.length) * 100}%`));
  }
  document.addEventListener('input', (e) => {
    if (e.target.matches('.js-mp-vol')) {
      S.music.volume = +e.target.value / 100; CadenceAudio.setVolume(S.music.volume); save('music');
      $$('.js-mp-volv').forEach((x) => (x.textContent = e.target.value + '%')); $$('.js-mp-vol').forEach((x) => x !== e.target && (x.value = e.target.value));
    }
    if (e.target.matches('.js-mp-seek')) CadenceAudio.seek(+e.target.value);
  });

  /* ============ 10. Views ============ */
  const QUOTES = [
    ['It does not matter how slowly you go as long as you do not stop.', 'Confucius'],
    ['Well begun is half done.', 'Aristotle'],
    ['The journey of a thousand miles begins with a single step.', 'Lao Tzu'],
    ['While we are postponing, life speeds by.', 'Seneca'],
    ['Nothing will work unless you do.', 'Maya Angelou'],
    ['Small deeds done are better than great deeds planned.', 'Peter Marshall'],
    ['Do one thing at a time, and do it well.', 'Proverb'],
    ['You don’t have to see the whole staircase, just take the first step.', 'Martin Luther King Jr.'],
    ['Rest is not idleness.', 'John Lubbock'],
    ['Focus on being productive instead of busy.', 'Tim Ferriss'],
    ['Little by little, one travels far.', 'J. R. R. Tolkien'],
    ['What we do every day matters more than what we do once in a while.', 'Gretchen Rubin'],
    ['Begin anywhere.', 'John Cage'],
    ['Energy flows where attention goes.', 'Proverb'],
  ];
  function greeting() { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening'; }
  // Focus time today including the session running now (the phone widgets count it the same way).
  const liveFocusMs = () => (S.timer.phase === 'focus' && S.timer.status !== 'idle' ? Math.max(0, elapsedMs()) : 0);
  const focusToday = () => { const sod = startOfDay(new Date()).getTime(); return focusMsBetween(sod, sod + DAY) + liveFocusMs(); };

  function taskMiniHTML(t, showWhen = 'schedule') {
    const when = showWhen === 'due' && t.due ? `Due ${fmtWhen(t.due)}` : isScheduled(t) ? fmtRange(t.start, t.end) : t.due ? `Due ${fmtWhen(t.due)}` : t.category;
    return `<div class="mini-item" data-action="editTask" data-id="${t.id}" role="button" tabindex="0">
      <span class="bar" style="background:${catColor(t.category)}"></span>
      <div class="tt"><div class="n ${t.status === 'completed' ? 'done' : ''}">${esc(t.title)}</div><div class="m">${esc(when)}${isOverdue(t) ? ' · <span style="color:var(--danger);font-weight:600">overdue</span>' : ''}</div></div>
      <span class="chip chip-${t.priority}">${t.priority[0].toUpperCase()}</span></div>`;
  }

  const WIDGETS = {
    pomodoro: () => ({ title: 'Pomodoro Timer', icon: 'i-focus', link: ['Focus Mode', 'openFocus'], body: `
      <div class="row" style="justify-content:center">${ringHTML(168, 10)}</div>
      <div class="session-dots js-t-dots"></div>
      <select class="select" data-action-change="timerTask" aria-label="Task for this session" ${S.focus.active ? 'disabled' : ''}><option value="">No task selected</option>${S.tasks.filter((t) => t.status !== 'completed').map((t) => `<option value="${t.id}" ${S.timer.taskId === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select>
      <div class="timer-controls js-t-ctrl"></div>
      <div class="pill-group" style="justify-content:center">${['focus', 'short', 'long'].map((p) => `<button class="pill" data-action="setPhase" data-id="${p}" aria-pressed="${S.timer.phase === p}">${PHASE_LABEL[p]}</button>`).join('')}</div>` }),
    today: () => {
      const list = S.tasks.filter((t) => touchesDay(t, new Date()) || t.status === 'inprogress').sort((a, b) => (a.status === 'completed') - (b.status === 'completed') || (tms(a.start) || 9e15) - (tms(b.start) || 9e15));
      return { title: "Today's Tasks", icon: 'i-tasks', link: ['View all', 'goTodayTasks'], body: list.length ? `<div class="mini-list">${list.slice(0, 6).map((t) => taskMiniHTML(t)).join('')}</div>${list.length > 6 ? `<p class="small muted">+${list.length - 6} more</p>` : ''}` : emptyState('i-tasks', 'Nothing for today', 'Schedule a task or give one a due date today.', '<button class="btn btn-soft btn-sm" data-action="newTask">Add task</button>') };
    },
    upnext: () => {
      const now = Date.now(); const list = S.tasks.filter((t) => t.status !== 'completed' && isScheduled(t) && tms(t.end) > now).sort((a, b) => tms(a.start) - tms(b.start)).slice(0, 5);
      return { title: 'Upcoming Schedule', icon: 'i-cal', link: ['Calendar', 'goCalendar'], body: list.length ? `<div class="mini-list">${list.map((t) => taskMiniHTML(t)).join('')}</div>` : emptyState('i-cal', 'No scheduled tasks', 'Give a task a start and end time to see it here.') };
    },
    deadlines: () => {
      const list = S.tasks.filter((t) => t.status !== 'completed' && t.due).sort((a, b) => tms(a.due) - tms(b.due)).slice(0, 5);
      return { title: 'Upcoming Deadlines', icon: 'i-flag', body: list.length ? `<div class="mini-list">${list.map((t) => taskMiniHTML(t, 'due')).join('')}</div>` : emptyState('i-flag', 'No deadlines', 'Tasks with due dates will be listed here.') };
    },
    progress: () => {
      const today = new Date(); const sod = startOfDay(today).getTime();
      const list = S.tasks.filter((t) => touchesDay(t, today) || (t.completedAt && t.completedAt >= sod));
      const done = list.filter((t) => t.status === 'completed');
      const fm = focusToday(); const goal = S.settings.goals.dailyFocusMin;
      const pct = list.length ? Math.round((done.length / list.length) * 100) : 0;
      return { title: 'Daily Progress', icon: 'i-check', body: `
        <div><div class="row between small"><span>Tasks done</span><b>${done.length} / ${list.length}</b></div><div class="progress" style="margin-top:6px"><span style="width:${pct}%"></span></div></div>
        <div><div class="row between small"><span>Focus goal</span><b>${fmtDur(fm)} / ${fmtDur(goal * MIN)}</b></div><div class="progress warm" style="margin-top:6px"><span style="width:${clamp((fm / (goal * MIN)) * 100, 0, 100)}%"></span></div></div>
        ${done.length ? `<div><p class="tiny muted" style="margin-bottom:4px">Completed today</p><div class="mini-list">${done.slice(0, 4).map((t) => taskMiniHTML(t)).join('')}</div></div>` : '<p class="small muted">Completed tasks will show up here.</p>'}` };
    },
    weekly: () => {
      const ws = weekStartOf(new Date()); const goal = S.settings.goals.dailyFocusMin * MIN;
      const days = Array.from({ length: 7 }, (_, i) => { const d = addDays(ws, i); const a = d.getTime(); const today = dayKey(d) === dayKey(new Date()); return { d, ms: focusMsBetween(a, a + DAY) + (today ? liveFocusMs() : 0), today }; });
      const total = days.reduce((a, x) => a + x.ms, 0); const tasks = tasksDoneBetween(ws.getTime(), ws.getTime() + 7 * DAY);
      const max = Math.max(goal, ...days.map((x) => x.ms));
      return { title: 'Weekly Productivity', icon: 'i-stats', link: ['Insights', 'goInsights'], body: `
        <div class="row between"><div><b style="font-size:22px">${fmtDur(total)}</b><span class="small muted"> focused</span></div><div class="small muted">${tasks} task${tasks === 1 ? '' : 's'} done</div></div>
        <div class="week-bars">${days.map((x) => `<div title="${fmtDay(x.d)}: ${fmtDur(x.ms)}">
          <div class="b ${x.ms >= goal ? 'hit' : x.ms ? 'part' : ''}" style="height:${Math.max(4, (x.ms / max) * 70)}px"></div>
          <span class="tiny ${x.today ? '' : 'muted'}" style="${x.today ? 'font-weight:700' : ''}">${x.d.toLocaleDateString(undefined, { weekday: 'narrow' })}</span></div>`).join('')}</div>
        <div><div class="row between small"><span>Weekly goal</span><b>${fmtDur(total)} / ${S.settings.goals.weeklyFocusHours}h</b></div><div class="progress" style="margin-top:6px"><span style="width:${clamp((total / (S.settings.goals.weeklyFocusHours * HOUR)) * 100, 0, 100)}%"></span></div></div>` };
    },
    streak: () => {
      const s = streak(); const best = bestStreak(); const days = focusDays(); const ws = weekStartOf(new Date());
      return { title: 'Focus Streak', icon: 'i-flame', body: `
        <div class="streak-big"><b>${s}</b><span class="muted">day${s === 1 ? '' : 's'} in a row</span></div>
        <div class="week-dots">${Array.from({ length: 7 }, (_, i) => { const d = addDays(ws, i); return `<span class="${dayKey(d) === dayKey(new Date()) ? 'today' : ''}"><i class="${days.has(dayKey(d)) ? 'hit' : ''}"></i>${d.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>`; }).join('')}</div>
        <p class="small muted">${s ? `Best streak: ${best} day${best === 1 ? '' : 's'}. Complete one focus session a day to keep it going.` : 'Complete a focus session today to start a streak.'}</p>` };
    },
    music: () => ({ title: 'Focus Music', icon: 'i-music', body: `<div class="js-music" data-compact="1"></div>` }),
    minical: () => {
      const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth(), 1); const start = weekStartOf(first);
      const has = new Set(); S.tasks.forEach((t) => { if (t.status === 'completed') return; if (t.start) has.add(dayKey(t.start)); if (t.due) has.add(dayKey(t.due)); });
      const dows = Array.from({ length: 7 }, (_, i) => addDays(start, i).toLocaleDateString(undefined, { weekday: 'narrow' }));
      let cells = ''; for (let i = 0; i < 42; i++) { const d = addDays(start, i); const k = dayKey(d); const other = d.getMonth() !== now.getMonth();
        cells += `<button class="mc-cell ${other ? 'other' : ''} ${k === dayKey(now) ? 'today' : ''}" data-action="calDay" data-id="${k}" aria-label="${fmtDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}">${d.getDate()}${has.has(k) ? '<i></i>' : ''}</button>`; }
      return { title: now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), icon: 'i-cal', link: ['Open', 'goCalendar'], body: `<div class="mc">${dows.map((d) => `<span class="mc-dow">${d}</span>`).join('')}${cells}</div>` };
    },
    quote: () => { const q = QUOTES[Math.floor(startOfDay(new Date()).getTime() / DAY) % QUOTES.length]; return { title: 'Daily Quote', icon: 'i-quote', body: `<div><p class="quote">“${esc(q[0])}”</p><p class="quote-by">— ${esc(q[1])}</p></div>` }; },
    screenbreak: () => {
      const st = eyeStatus(); const cfg = S.settings.screenBreak; const sod = startOfDay(new Date()).getTime();
      const today = S.eyeLog.filter((e) => e.ts >= sod); const done = today.filter((e) => e.action === 'completed').length;
      const pct = st.left != null ? clamp((1 - st.left / (cfg.interval * MIN)) * 100, 0, 100) : 0;
      return { title: 'Screen Break Reminder', icon: 'i-eye', link: ['Settings', 'goEyeSettings'], body: `
        <div class="row between"><span class="chip ${st.state === 'off' ? '' : st.state === 'snoozed' ? 'chip-warn' : 'chip-ok'}">${st.state === 'off' ? 'Off' : st.state === 'snoozed' ? 'Paused' : st.state === 'counting' ? 'Active' : 'Waiting'}</span><span class="small muted">Every ${cfg.interval} min · ${cfg.duration >= 60 ? fmtDur(cfg.duration * 1000) : cfg.duration + 's'}</span></div>
        <p class="small">${esc(st.text)}</p>
        ${st.left != null ? `<div class="progress"><span class="js-eye-widget-bar" style="width:${pct}%"></span></div>` : ''}
        <p class="small muted">Today: ${done} completed · ${today.filter((e) => e.action === 'skipped').length} skipped · ${today.filter((e) => e.action === 'postponed').length} postponed</p>
        <div class="row wrap">${cfg.enabled ? `<button class="btn btn-soft btn-sm" data-action="eyeNow">Take one now</button>${st.state === 'snoozed' ? '<button class="btn btn-ghost btn-sm" data-action="eyeUnsnooze">Resume reminders</button>' : '<button class="btn btn-ghost btn-sm" data-action="eyeSnooze" data-id="60">Pause 1 hour</button>'}` : '<button class="btn btn-soft btn-sm" data-action="eyeEnable">Turn on</button>'}</div>` };
    },
  };

  // Descriptions shown in the widget gallery (and which of them exist as phone home-screen widgets).
  const WIDGET_INFO = {
    pomodoro: ['i-focus', 'Start, pause and skip sessions', 'timer'], today: ['i-tasks', 'What’s on today, tick tasks off', 'today'],
    upnext: ['i-cal', 'Your next scheduled tasks', 'upcoming'], progress: ['i-check', 'Tasks done and daily focus goal', 'progress'],
    deadlines: ['i-flag', 'Due dates, soonest first', 'deadlines'], weekly: ['i-stats', 'Focus time for each day this week', 'weekly'],
    streak: ['i-flame', 'Days in a row with a focus session', 'streak'], music: ['i-music', 'Play and switch focus music', 'music'],
    minical: ['i-cal', 'This month at a glance', 'calendar'], screenbreak: ['i-eye', 'When your next screen break is due', 'screen'],
    quote: ['i-quote', 'A new quote every day', 'quote'],
  };
  function openWidgetGallery() {
    const draw = () => Object.keys(ALL_WIDGETS).map((id) => {
      const on = !S.widgets.hidden.includes(id) && S.widgets.order.includes(id); const [ic, desc] = WIDGET_INFO[id];
      return `<div class="wg-item"><span class="wg-ic">${icon(ic)}</span><div class="wg-meta"><b>${esc(ALL_WIDGETS[id])}</b><span>${esc(desc)}</span></div>
        <div class="wg-acts"><button class="btn btn-sm ${on ? 'btn-ghost' : 'btn-primary'}" data-wg="${on ? 'remove' : 'add'}" data-id="${id}">${on ? icon('i-check') + 'Added' : icon('i-plus') + 'Add'}</button>
        ${Device.isNative ? `<button class="btn btn-sm btn-soft" data-wg="pin" data-id="${id}">Add to phone</button>` : ''}</div></div>`;
    }).join('');
    const m = openModal({ title: 'Widgets', id: 'widget-gallery', body: `<p class="small muted">Add widgets to your Cadence home, or put them on your phone’s home screen.</p><div class="wg-list">${draw()}</div>`,
      foot: '<button class="btn btn-primary" data-close>Done</button>' });
    m.el.querySelector('.wg-list').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-wg]'); if (!b) return; const id = b.dataset.id;
      if (b.dataset.wg === 'add') { S.widgets.hidden = S.widgets.hidden.filter((w) => w !== id); S.widgets.order = S.widgets.order.filter((w) => w !== id).concat(id); save('widgets'); }
      else if (b.dataset.wg === 'remove') { S.widgets.hidden.push(id); S.widgets.order = S.widgets.order.filter((w) => w !== id); save('widgets'); }
      else if (b.dataset.wg === 'pin') {
        const r = await Device.pinWidget(WIDGET_INFO[id][2]);
        if (!r || !r.supported) toast('Add it from your Home Screen', Device.isIOS ? 'Touch and hold an empty spot on your Home Screen, tap Edit → Add Widget, then search for Cadence.' : 'Touch and hold an empty spot on your home screen, tap Widgets, then find Cadence.', '', { timeout: 7000 });
        return;
      }
      m.el.querySelector('.wg-list').innerHTML = draw(); renderHome();
    });
  }
  function renderHome() {
    const now = new Date(); const sod = startOfDay(now).getTime();
    $('#heroDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    { const g = greeting().split(' '); $('#heroGreet').innerHTML = `${esc(g[0])} <span>${esc(g.slice(1).join(' '))}</span>`; }
    const todays = S.tasks.filter((t) => touchesDay(t, now) && t.status !== 'completed');
    const next = S.tasks.filter((t) => t.status !== 'completed' && isScheduled(t) && tms(t.start) > Date.now()).sort((a, b) => tms(a.start) - tms(b.start))[0];
    $('#heroSummary').textContent = todays.length ? `${todays.length} task${todays.length > 1 ? 's' : ''} on today's plan${next && dayKey(next.start) === dayKey(now) ? ` — next up: ${next.title} at ${fmtTime(next.start)}` : ''}.` : 'A clear day. Add a task or start a focus session when you are ready.';
    const fm = focusToday(); const doneToday = tasksDoneBetween(sod, sod + DAY);
    $('#summaryRow').innerHTML = [
      ['Focus today', fmtDur(fm), `/ ${S.settings.goals.dailyFocusMin}m`], ['Sessions', sessionsBetween(sod, sod + DAY), ''], ['Tasks done', doneToday, `/ ${doneToday + todays.length}`], ['Streak', streak(), streak() === 1 ? 'day' : 'days'],
    ].map(([l, v, s]) => `<div class="summary-tile"><div class="label">${l}</div><div class="value">${v}<small>${s}</small></div></div>`).join('');
    $('#homePerm').innerHTML = permissionCardHTML();
    renderActiveCard();
    const grid = $('#widgetGrid'); grid.classList.toggle('editing', ui.editingWidgets);
    $('#customizeBtn').innerHTML = ui.editingWidgets ? `${icon('i-check')}Done` : `${icon('i-sliders')}Customize`;
    const visible = S.widgets.order.filter((w) => !S.widgets.hidden.includes(w));
    grid.innerHTML = visible.map((id, i) => {
      const w = WIDGETS[id]();
      return `<div class="card widget ${['weekly'].includes(id) ? '' : ''}" data-widget="${id}" ${ui.editingWidgets ? 'draggable="true"' : ''}>
        ${ui.editingWidgets ? `<div class="widget-edit-bar"><button class="icon-btn sm" data-action="wMove" data-id="${id}" data-dir="-1" aria-label="Move ${ALL_WIDGETS[id]} up" ${i === 0 ? 'disabled' : ''}>${icon('i-up')}</button><button class="icon-btn sm" data-action="wMove" data-id="${id}" data-dir="1" aria-label="Move ${ALL_WIDGETS[id]} down" ${i === visible.length - 1 ? 'disabled' : ''}>${icon('i-down')}</button><button class="icon-btn sm" data-action="wHide" data-id="${id}" aria-label="Remove ${ALL_WIDGETS[id]}">${icon('i-x')}</button></div>` : ''}
        <div class="widget-head"><h3>${icon(w.icon)}${esc(w.title)}</h3>${w.link && !ui.editingWidgets ? `<button class="widget-link" data-action="${w.link[1]}">${esc(w.link[0])}</button>` : ''}</div>${w.body}</div>`;
    }).join('') + (ui.editingWidgets ? `<div class="card widget" style="grid-column:1/-1;min-height:0"><div class="widget-head"><h3>${icon('i-grid')}Arrange your dashboard</h3></div>
      <p class="small muted">Reorder with the arrows, remove with ✕, or add more widgets.</p>
      <button class="btn btn-primary btn-sm" data-action="openWidgetGallery" style="align-self:flex-start">${icon('i-plus')}Add widgets</button>
      <button class="btn btn-ghost btn-sm" data-action="wReset" style="align-self:flex-start">Reset layout</button></div>` : '')
      + (!visible.length && !ui.editingWidgets ? `<div class="card widgets-empty" style="grid-column:1/-1">${emptyState('i-grid', 'Make this space yours', 'Add the widgets you want here — timer, today’s tasks, progress, music and more.', `<button class="btn btn-primary btn-sm" data-action="customizeWidgets">${icon('i-plus')}Add widgets</button>`)}</div>` : '');
    renderMusic(); renderLive(false); lastCtrlSig = ''; renderLive(false);
  }
  function renderActiveCard() {
    const t = S.timer; const tk = timerTask(); const el = $('#activeCard'); if (!el) return;
    const working = S.tasks.filter((x) => x.workingSince && x.workSource === 'manual');
    if (t.status === 'idle' && !working.length) {
      el.innerHTML = `<div class="active-inner idle"><div class="meta"><div class="t">No active focus session</div><div class="s muted">${tk ? `Selected task: ${esc(tk.title)}` : 'Pick a task and start a session when you are ready.'}</div></div><button class="btn btn-primary btn-sm" data-action="openFocusSetup">${icon('i-focus')}Focus</button></div>`;
      return;
    }
    if (t.status === 'idle') {
      const w = working[0];
      el.innerHTML = `<div class="active-inner"><div class="meta"><div class="t">Working on: ${esc(w.title)}</div><div class="s">Tracking actual time · ${fmtDur(workedMs(w))} so far</div></div><button class="btn btn-sm btn-on-dark" data-action="stopWork" data-id="${w.id}">Stop</button><button class="btn btn-sm btn-on-dark" data-action="openFocusSetup" data-id="${w.id}">Focus</button></div>`;
      return;
    }
    el.innerHTML = `<div class="active-inner ${t.phase !== 'focus' ? 'break' : ''}">
      <div class="meta"><div class="t">${PHASE_LABEL[t.phase]}${t.status === 'paused' ? ' · paused' : ''}${S.focus.active ? ' · Focus Mode' : ''}</div><div class="s">${tk ? esc(tk.title) : 'No task selected'}${dndActive() ? ' · Do Not Disturb on' : ''}</div></div>
      <div class="big js-active-time">${fmtClock(remaining())}</div>
      <button class="btn btn-sm btn-on-dark" data-action="${t.status === 'running' ? 'timerPause' : 'timerResume'}" aria-label="${t.status === 'running' ? 'Pause' : 'Resume'}">${icon(t.status === 'running' ? 'i-pause' : 'i-play')}</button>
      <button class="btn btn-sm btn-on-dark" data-action="openFocus">Open</button></div>`;
  }

  function renderTasks() {
    $$('#taskViews button').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === S.ui.taskView));
    const counts = { overdue: S.tasks.filter((t) => isOverdue(t)).length };
    const ob = $('#taskViews [data-view=overdue]'); ob.textContent = counts.overdue ? `Overdue (${counts.overdue})` : 'Overdue';
    const cs = $('#fCategory'); const cur = ui.filters.category;
    cs.innerHTML = '<option value="">Any</option>' + categories().map((c) => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('#fPriority').value = ui.filters.priority; $('#fStatus').value = ui.filters.status; $('#fSort').value = S.ui.sort;
    const list = filteredTasks(); const now = Date.now();
    if (!list.length) {
      const msgs = { all: ['No tasks yet', 'Create your first task to start planning your day.'], today: ['Nothing for today', 'Tasks scheduled or due today appear here.'], upcoming: ['Nothing upcoming', 'Future scheduled or due tasks appear here.'], overdue: ['Nothing overdue', 'You are on top of things.'], completed: ['No completed tasks', 'Finished tasks will collect here.'] };
      const [h, p] = ui.search || ui.filters.priority || ui.filters.category || ui.filters.status ? ['No matches', 'Try a different search or clear filters.'] : msgs[S.ui.taskView];
      $('#taskList').innerHTML = `<div class="card">${emptyState('i-tasks', h, p, S.ui.taskView === 'all' && !ui.search ? '<button class="btn btn-primary btn-sm" data-action="newTask">Create a task</button>' : '')}</div>`;
      return;
    }
    $('#taskList').innerHTML = list.map((t) => {
      const sub = t.subtasks; const subDone = sub.filter((s) => s.done).length; const od = isOverdue(t, now);
      const worked = workedMs(t, now);
      return `<article class="task-card ${t.status}" style="--cat:${catColor(t.category)}">
        <button class="check ${t.status === 'completed' ? 'on' : ''}" data-action="toggleDone" data-id="${t.id}" aria-label="${t.status === 'completed' ? 'Mark as not completed' : 'Mark as completed'}">${icon('i-check')}</button>
        <div class="task-body">
          <div class="task-title">${esc(t.title)}</div>
          ${t.description ? `<div class="task-desc">${esc(t.description)}</div>` : ''}
          <div class="task-meta">
            ${isScheduled(t) ? `<span class="when">${icon('i-clock')}${esc(fmtRange(t.start, t.end))}</span>` : ''}
            ${t.due ? `<span class="chip ${od ? 'chip-danger' : 'chip-warn'}">${icon('i-flag')}${od ? 'Overdue · ' : 'Due '}${esc(fmtWhen(t.due))}</span>` : od ? '<span class="chip chip-danger">Past scheduled end</span>' : ''}
            <span class="chip chip-${t.priority}">${t.priority[0].toUpperCase() + t.priority.slice(1)}</span>
            <span class="chip"><span class="dot" style="background:${catColor(t.category)}"></span>${esc(t.category)}</span>
            ${t.status === 'inprogress' ? '<span class="chip chip-accent">In progress</span>' : ''}
            ${sub.length ? `<span class="chip">${subDone}/${sub.length} subtasks</span>` : ''}
            ${worked || t.estimate ? `<span class="chip" title="Actual time worked vs estimate">${icon('i-clock')}${fmtDur(worked)}${t.estimate ? ` / ${fmtDur(t.estimate * MIN)} est.` : ' worked'}</span>` : ''}
            ${t.workingSince ? '<span class="chip chip-ok">● Tracking</span>' : ''}
          </div>
          ${sub.length && t.status !== 'completed' ? `<div class="subtasks-mini">${sub.map((s) => `<label><input type="checkbox" data-action-change="toggleSub" data-id="${t.id}" data-sid="${s.id}" ${s.done ? 'checked' : ''}><span class="${s.done ? 'done' : ''}">${esc(s.text)}</span></label>`).join('')}</div>` : ''}
          <div class="task-actions">
            ${t.status !== 'completed' ? `<button class="btn btn-soft btn-sm" data-action="openFocusSetup" data-id="${t.id}">${icon('i-focus')}Focus</button>
            ${t.workingSince ? `<button class="btn btn-ghost btn-sm" data-action="stopWork" data-id="${t.id}">${icon('i-pause')}Stop work</button>` : `<button class="btn btn-ghost btn-sm" data-action="startWork" data-id="${t.id}">${icon('i-play')}${isScheduled(t) && tms(t.start) > now ? 'Start early' : isScheduled(t) && tms(t.end) < now ? 'Keep working' : 'Start work'}</button>`}
            ${isScheduled(t) || t.due ? `<button class="btn btn-ghost btn-sm" data-action="postpone" data-id="${t.id}">Postpone</button>` : ''}` : ''}
            <button class="btn btn-ghost btn-sm" data-action="editTask" data-id="${t.id}">${icon('i-edit')}Edit</button>
            <button class="btn btn-danger-ghost btn-sm" data-action="deleteTask" data-id="${t.id}" aria-label="Delete ${esc(t.title)}">${icon('i-trash')}</button>
          </div>
        </div></article>`;
    }).join('');
  }

  /* --- calendar --- */
  const CAL_HOUR = 42; // px per hour in week/day view (matches .tg-hour in style.css)
  function calEventsForDay(day) {
    const a = startOfDay(day).getTime(), b = a + DAY;
    return S.tasks.filter((t) => isScheduled(t) && tms(t.start) < b && tms(t.end) > a).sort((x, y) => tms(x.start) - tms(y.start));
  }
  const calDeadlinesForDay = (day) => { const a = startOfDay(day).getTime(); return S.tasks.filter((t) => t.due && tms(t.due) >= a && tms(t.due) < a + DAY); };
  function renderCalendar() {
    const v = S.ui.calView; const cur = ui.calCursor;
    $$('#calViews button').forEach((b) => b.setAttribute('aria-selected', b.dataset.cview === v));
    $('#calTitle').classList.toggle('off-today', v === 'month' ? (cur.getMonth() !== new Date().getMonth() || cur.getFullYear() !== new Date().getFullYear()) : dayKey(v === 'week' ? weekStartOf(cur) : cur) !== dayKey(v === 'week' ? weekStartOf(new Date()) : new Date()));
    if (v === 'month') {
      $('#calTitle').textContent = cur.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const first = new Date(cur.getFullYear(), cur.getMonth(), 1); const start = weekStartOf(first);
      // Only as many weeks as the month needs (5 or 6 rows) keeps the grid compact.
      const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      const cellsN = Math.ceil((Math.round((startOfDay(last) - start) / DAY) + 1) / 7) * 7;
      let html = '<div class="month-grid">' + Array.from({ length: 7 }, (_, i) => `<div class="month-dow">${addDays(start, i).toLocaleDateString(undefined, { weekday: 'narrow' })}</div>`).join('');
      for (let i = 0; i < cellsN; i++) {
        const d = addDays(start, i); const k = dayKey(d); const evs = calEventsForDay(d); const dls = calDeadlinesForDay(d);
        const items = evs.map((t) => `<span class="ev ${t.status === 'completed' ? 'done' : ''}" style="background:${catColor(t.category)}" title="${esc(t.title)}"></span>`)
          .concat(dls.map((t) => `<span class="ev deadline" title="Due: ${esc(t.title)}"></span>`));
        html += `<button class="month-cell ${d.getMonth() !== cur.getMonth() ? 'other' : ''} ${k === dayKey(new Date()) ? 'today' : ''} ${k === ui.calSelected ? 'selected' : ''}" data-action="calSelect" data-id="${k}" aria-label="${fmtDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}: ${evs.length} scheduled, ${dls.length} deadlines">
          <span class="d">${d.getDate()}</span><span class="evs">${items.slice(0, 3).join('')}</span></button>`;
      }
      $('#calBody').innerHTML = html + '</div>';
    } else {
      const days = v === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(weekStartOf(cur), i)) : [startOfDay(cur)];
      $('#calTitle').textContent = v === 'week' ? `${fmtDay(days[0], { month: 'short', day: 'numeric' })} – ${fmtDay(days[6], { month: 'short', day: 'numeric' })}` : fmtDay(cur, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      const cols = `40px repeat(${days.length}, minmax(${v === 'week' ? 44 : 0}px, 1fr))`;
      const HH = CAL_HOUR; const nowD = new Date();
      let head = `<div class="timegrid-head" style="grid-template-columns:${cols}"><div></div>${days.map((d) => `<button class="tg-dayhead ${dayKey(d) === dayKey(nowD) ? 'today' : ''}" data-action="calDayView" data-id="${dayKey(d)}">${d.toLocaleDateString(undefined, { weekday: 'short' })}<b>${d.getDate()}</b></button>`).join('')}
        <div class="tg-deadlines" style="grid-template-columns:${cols}"><div class="tiny muted" style="border:0;justify-content:center;align-items:flex-end;padding-right:6px">due</div>${days.map((d) => `<div>${calDeadlinesForDay(d).map((t) => `<button class="tg-dl" data-action="editTask" data-id="${t.id}">⚑ ${esc(fmtTime(t.due))} ${esc(t.title)}</button>`).join('')}</div>`).join('')}</div></div>`;
      let body = `<div class="tg-scroll" id="tgScroll"><div class="tg-body" style="grid-template-columns:${cols}"><div class="tg-hours">${Array.from({ length: 24 }, (_, h) => `<div class="tg-hour">${h ? fmtTime(new Date(2000, 0, 1, h)).replace(':00', '') : ''}</div>`).join('')}</div>`;
      days.forEach((d) => {
        const a = d.getTime(); const evs = calEventsForDay(d).map((t) => ({ t, s: Math.max(tms(t.start), a), e: Math.min(tms(t.end), a + DAY) }));
        // overlap layout: clusters + greedy columns
        const placed = []; let cluster = []; let clusterEnd = -1;
        const flushCluster = () => { const colsN = Math.max(1, ...cluster.map((x) => x.col + 1)); cluster.forEach((x) => (x.cols = colsN)); placed.push(...cluster); cluster = []; };
        evs.forEach((ev) => {
          if (ev.s >= clusterEnd && cluster.length) flushCluster();
          const used = new Set(cluster.filter((x) => x.e > ev.s).map((x) => x.col)); let c = 0; while (used.has(c)) c++;
          ev.col = c; cluster.push(ev); clusterEnd = Math.max(clusterEnd, ev.e);
        });
        if (cluster.length) flushCluster();
        const isToday = dayKey(d) === dayKey(nowD);
        body += `<div class="tg-col ${isToday ? 'today' : ''}" data-day="${dayKey(d)}" style="height:${24 * HH}px">
          ${placed.map((x) => { const top = ((x.s - a) / HOUR) * HH; const h = Math.max(20, ((x.e - x.s) / HOUR) * HH - 2); const w = 100 / x.cols;
            return `<button class="tg-ev ${x.t.status === 'completed' ? 'done' : ''} ${x.cols > 1 ? 'overlap' : ''}" data-action="editTask" data-id="${x.t.id}" style="top:${top}px;height:${h}px;left:calc(${x.col * w}% + 2px);width:calc(${w}% - 4px);background:${catColor(x.t.category)};border-left:4px solid ${PRI_COLOR[x.t.priority]}" title="${esc(x.t.title)} · ${esc(fmtRange(x.t.start, x.t.end))}${x.cols > 1 ? ' · overlaps another task' : ''}"><b>${esc(x.t.title)}</b>${h > 30 ? `<span class="tm">${esc(fmtTime(x.t.start))} – ${esc(fmtTime(x.t.end))}</span>` : ''}</button>`; }).join('')}
          ${isToday ? `<div class="tg-now" style="top:${((Date.now() - a) / HOUR) * HH}px"></div>` : ''}</div>`;
      });
      body += '</div></div>';
      $('#calBody').innerHTML = `<div class="timegrid ${v}">${head}${body}</div>`;
      const sc = $('#tgScroll'); if (sc) sc.scrollTop = (ui.calScrollTop != null ? ui.calScrollTop : Math.max(0, (new Date().getHours() - 1)) * HH);
      sc.addEventListener('scroll', () => (ui.calScrollTop = sc.scrollTop));
    }
    // agenda for selected date
    const sel = new Date(ui.calSelected + 'T00:00'); const evs = calEventsForDay(sel); const dls = calDeadlinesForDay(sel).filter((t) => !evs.includes(t));
    const ov = new Set(); evs.forEach((x) => evs.forEach((y) => { if (x !== y && x.status !== 'completed' && y.status !== 'completed' && tms(x.start) < tms(y.end) && tms(y.start) < tms(x.end)) { ov.add(x.id); ov.add(y.id); } }));
    $('#calAgenda').innerHTML = `<div class="card"><h3><span>${esc(fmtDay(sel, { weekday: 'long', month: 'long', day: 'numeric' }))}</span><button class="btn btn-soft btn-sm" data-action="calAdd" data-id="${ui.calSelected}">${icon('i-plus')}Add</button></h3>
      ${evs.length || dls.length ? `<div class="mini-list">${evs.map((t) => taskMiniHTML(t) + (ov.has(t.id) ? `<p class="tiny" style="color:var(--danger);margin:-4px 0 4px 20px">Overlaps another scheduled task</p>` : '')).join('')}${dls.map((t) => taskMiniHTML(t, 'due')).join('')}</div>` : emptyState('i-cal', 'Nothing on this day', 'Tap Add, or click an empty time slot in Week/Day view.')}</div>`;
  }
  // click empty slot in time grid → create task
  document.addEventListener('click', (e) => {
    const col = e.target.closest('.tg-col'); if (!col || e.target.closest('.tg-ev')) return;
    const rect = col.getBoundingClientRect(); const y = e.clientY - rect.top; const mins = Math.floor((y / CAL_HOUR) * 2) * 30;
    const d = new Date(col.dataset.day + 'T00:00'); d.setMinutes(clamp(mins, 0, 23 * 60 + 30));
    ui.calSelected = col.dataset.day;
    openTaskForm(null, { start: toLocalInput(d), end: toLocalInput(d.getTime() + HOUR), estimate: 60 });
  });

  /* --- focus screen --- */
  function renderFocus() {
    const t = S.timer; const tk = timerTask(); const fm = S.focus.active; const isBreak = t.phase !== 'focus';
    const dnd = dndActive();
    $('#focusMain').innerHTML = `
      <div class="focus-status">
        <span class="chip ${fm ? 'chip-accent' : ''}">${fm ? '● Focus Mode on' : 'Focus Mode off'}</span>
        <span class="chip ${isBreak ? 'chip-warn' : ''}">${PHASE_LABEL[t.phase]}${t.status === 'paused' ? ' · paused' : t.status === 'idle' ? ' · ready' : ''}</span>
      </div>
      <div class="focus-task"><div class="k">Current task</div><div class="v">${tk ? esc(tk.title) : 'No task selected'}</div>${tk && (tk.focusMs || tk.actualMs) ? `<div class="small muted">${fmtDur(tk.focusMs)} focused on this task${tk.estimate ? ` · est. ${fmtDur(tk.estimate * MIN)}` : ''}</div>` : ''}</div>
      <div class="row" style="justify-content:center">${ringHTML(Math.min(200, Math.min(window.innerWidth, 480) - 150), 11)}</div>
      <div class="session-dots js-t-dots" aria-label="Sessions in this cycle"></div>
      <p class="small muted" style="text-align:center">Session ${(t.cycle % S.settings.pomodoro.interval) + (t.phase === 'focus' ? 1 : 0) || S.settings.pomodoro.interval} of ${S.settings.pomodoro.interval} · long break after every ${S.settings.pomodoro.interval} · ${sessionsBetween(startOfDay(new Date()).getTime(), Date.now() + 1)} completed today</p>
      <div class="timer-controls js-t-ctrl"></div>
      <div class="focus-toggles">
        ${DND_SUPPORTED ? `<div class="set-row"><div class="lbl"><b>${icon('i-moon')}Do Not Disturb</b><span>${dnd ? 'On — your phone is silenced' : isBreak && fm && dndOn(S.focus.dnd) ? 'Off for the break' : 'Silences your phone during focus'}</span></div><div class="ctl">${sw('data-action-change="focusDnd"', dndOn(fm ? S.focus.dnd : S.settings.focusMode.dnd))}</div></div>`
          : `<div class="set-row"><div class="lbl"><b>${icon('i-moon')}Quiet your iPhone</b><span>Turn on a Focus in Control Center while you work</span></div><div class="ctl"><button class="btn btn-ghost btn-sm" data-action="iosFocusHelp">How</button></div></div>`}
        <div class="set-row"><div class="lbl"><b>${icon('i-lock')}Lock other apps</b><span>${allowedCount()} allowed app${allowedCount() === 1 ? '' : 's'} · <button type="button" class="widget-link" data-action="chooseApps">Choose</button></span></div><div class="ctl">${sw('data-action-change="focusLock"', lockOn(fm ? S.focus.lockApps : S.settings.focusMode.lockApps))}</div></div>
      </div>
      ${isBreak && t.status !== 'idle' ? `<div class="break-suggest">${icon('i-moon')}<div><b>Break time — rest away from the screen</b>${esc(randomSuggestion())}${fm && S.focus.dnd ? '<br><span class="small">Do Not Disturb is off during the break.</span>' : ''}</div></div>` : ''}
      ${fm && isBreak ? `<div class="set-row" style="padding:0;border:0"><div class="lbl"><b>Resume Focus Mode after the break?</b><span>We will ask when the break ends; your previous settings are kept.</span></div><div class="ctl">${sw('data-action-change="resumeAfterBreak"', S.focus.resumeAfterBreak)}</div></div>` : ''}
      <div class="row wrap" style="justify-content:center">
        ${fm ? `<button class="btn btn-ghost" data-action="openFocusSetup">${icon('i-sliders')}Modify focus settings</button><button class="btn btn-danger-ghost" data-action="endFocus">End focus session</button>`
          : `<button class="btn btn-primary btn-lg" data-action="openFocusSetup">${icon('i-focus')}Set up Focus Mode</button>`}
      </div>
      ${!fm ? '<p class="small muted" style="text-align:center">Focus Mode adds a task, music, Do Not Disturb and app lock on top of the Pomodoro timer. You can also just press Start to run a plain Pomodoro.</p>' : ''}`;
    $('#focusDevice').hidden = true;
    $('#focusMusicCard').innerHTML = `<div class="widget-head" style="margin-bottom:10px"><h3>${icon('i-music')}Focus music</h3></div><div class="js-music"></div>`;
    renderMusic(); lastCtrlSig = ''; renderLive(false);
  }

  /* --- insights --- */
  function renderInsights() {
    $$('#statRange button').forEach((b) => b.setAttribute('aria-selected', b.dataset.range === ui.statRange));
    const [a, b] = rangeBounds(ui.statRange); const now = Date.now();
    const fs = focusSessions().filter((s) => s.end >= a && s.end < b);
    const completed = fs.filter((s) => s.completed);
    const focusMs = fs.reduce((x, s) => x + s.ms, 0);
    const doneTasks = tasksDoneBetween(a, b);
    const pending = S.tasks.filter((t) => t.status !== 'completed').length; const overdue = S.tasks.filter((t) => isOverdue(t, now)).length;
    const totalTasks = S.tasks.length; const rate = totalTasks ? Math.round((S.tasks.filter((t) => t.status === 'completed').length / totalTasks) * 100) : 0;
    const eyeDone = S.eyeLog.filter((e) => e.action === 'completed' && e.ts >= a && e.ts < b).length;
    const avgSession = fs.length ? focusMs / fs.length : 0;
    const daysElapsed = Math.max(1, Math.ceil((Math.min(b, startOfDay(now).getTime() + DAY) - a) / DAY));
    $('#statGrid').innerHTML = [
      ['Focus time', fmtDur(focusMs)], ['Tasks completed', doneTasks], ['Pending tasks', pending], ['Overdue tasks', overdue],
      ['Avg. session', fs.length ? fmtDur(avgSession) : '—'], ['Focus streak', `${streak()} d`], ['Completion rate', totalTasks ? rate + '%' : '—'], ['Avg. daily focus', fmtDur(focusMs / daysElapsed)],
    ].map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
    // insights from real activity
    const allFs = focusSessions();
    const byDow = Array(7).fill(0); const byPart = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 };
    allFs.forEach((s) => { const d = new Date(s.start); byDow[d.getDay()] += s.ms; const h = d.getHours(); byPart[h >= 5 && h < 12 ? 'Morning' : h < 17 && h >= 12 ? 'Afternoon' : h >= 17 && h < 22 ? 'Evening' : 'Night'] += s.ms; });
    const bestDow = byDow.indexOf(Math.max(...byDow)); const bestPart = Object.entries(byPart).sort((x, y) => y[1] - x[1])[0];
    const [ws, we] = rangeBounds('week');
    const has = allFs.length > 0;
    const ins = [
      ['i-cal', 'Most productive day', has ? new Date(2024, 0, 7 + bestDow).toLocaleDateString(undefined, { weekday: 'long' }) + ` · ${fmtDur(byDow[bestDow])}` : 'Not enough activity yet'],
      ['i-clock', 'Most productive time', has ? `${bestPart[0]} · ${fmtDur(bestPart[1])}` : 'Not enough activity yet'],
      ['i-focus', 'Focus this week', fmtDur(focusMsBetween(ws, we))],
      ['i-check', 'Tasks completed', `${S.tasks.filter((t) => t.status === 'completed').length} all time · ${tasksDoneBetween(ws, we)} this week`],
      ['i-stats', 'Average daily focus', has ? `${fmtDur(focusMs / daysElapsed)} (${{ day: 'today', week: 'this week', month: 'this month', all: 'all time' }[ui.statRange]})` : 'Not enough activity yet'],
    ];
    $('#insightList').innerHTML = `<div class="widget-head" style="margin-bottom:10px"><h3>${icon('i-stats')}Insights</h3><span class="tiny muted">Based only on your recorded activity</span></div><div class="insight-list">${ins.map(([ic, k, v]) => `<div class="insight"><div class="ic">${icon(ic)}</div><div><div class="k">${k}</div><div class="v">${esc(v)}</div></div></div>`).join('')}</div>`;
    renderCharts();
    // goals
    const sod = startOfDay(new Date()).getTime(); const g = S.settings.goals;
    const dayMs = focusMsBetween(sod, sod + DAY); const weekMs = focusMsBetween(ws, we); const weekTasks = tasksDoneBetween(ws, we);
    const goalRow = (label, cur, target, txt) => `<div style="margin-top:12px"><div class="row between small"><span>${label}</span><b>${txt}</b></div><div class="progress" style="margin-top:6px"><span style="width:${clamp((cur / target) * 100, 0, 100)}%"></span></div></div>`;
    $('#goalsCard').innerHTML = `<div class="widget-head"><h3>${icon('i-trophy')}Goals</h3><button class="widget-link" data-action="goGoalSettings">Edit goals</button></div>
      ${goalRow('Daily focus goal', dayMs, g.dailyFocusMin * MIN, `${fmtDur(dayMs)} / ${fmtDur(g.dailyFocusMin * MIN)}`)}
      ${goalRow('Weekly focus goal', weekMs, g.weeklyFocusHours * HOUR, `${fmtDur(weekMs)} / ${g.weeklyFocusHours}h`)}
      ${goalRow('Weekly tasks goal', weekTasks, g.weeklyTasks, `${weekTasks} / ${g.weeklyTasks}`)}`;
  }
  function renderCharts() {
    if (!window.Chart) { $$('.chart-wrap').forEach((w) => (w.innerHTML = '<div class="chart-empty">Charts could not load (Chart.js missing).</div>')); return; }
    const css = getComputedStyle(document.documentElement); const cv = (n) => css.getPropertyValue(n).trim();
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily; Chart.defaults.color = cv('--muted'); Chart.defaults.borderColor = cv('--line-2');
    Object.values(ui.charts).forEach((c) => c.destroy()); ui.charts = {};
    const accent = cv('--ring-focus'), accent2 = '#d397fa', warm = cv('--p-med'), pendingC = cv('--line'), dangerC = cv('--p-high'), surfaceC = cv('--surface');
    const days14 = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(new Date()), i - 13));
    const has = focusSessions().length > 0;
    const mk = (id, cfg, empty, msg) => {
      const cv = document.getElementById(id); const wrap = cv.parentElement; const ex = wrap.querySelector('.chart-empty'); if (ex) ex.remove();
      cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, plugins: { legend: { display: cfg.type === 'doughnut' || (cfg.data.datasets.length > 1), position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } } } }, cfg.options || {});
      ui.charts[id] = new Chart(cv, cfg);
      if (empty) wrap.insertAdjacentHTML('beforeend', `<div class="chart-empty">${msg}</div>`);
    };
    const yMin = { scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } };
    mk('chDaily', { type: 'bar', data: { labels: days14.map((d) => d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })), datasets: [{ label: 'Focus minutes', data: days14.map((d) => Math.round(focusMsBetween(d.getTime(), d.getTime() + DAY) / MIN)), backgroundColor: accent, borderRadius: 6, maxBarThickness: 28 }] }, options: yMin }, !has, 'No focus sessions recorded yet. Complete a Pomodoro to see your daily focus time.');
    const weeks = Array.from({ length: 8 }, (_, i) => addDays(weekStartOf(new Date()), (i - 7) * 7));
    const anyTasks = S.tasks.some((t) => t.status === 'completed');
    mk('chWeekly', { type: 'bar', data: { labels: weeks.map((w) => w.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })), datasets: [
      { label: 'Focus hours', data: weeks.map((w) => +(focusMsBetween(w.getTime(), w.getTime() + 7 * DAY) / HOUR).toFixed(2)), backgroundColor: accent, borderRadius: 6, yAxisID: 'y', maxBarThickness: 26 },
      { label: 'Tasks completed', data: weeks.map((w) => tasksDoneBetween(w.getTime(), w.getTime() + 7 * DAY)), type: 'line', borderColor: warm, backgroundColor: warm, tension: 0.3, yAxisID: 'y1', pointRadius: 3 },
    ] }, options: { scales: { y: { beginAtZero: true, title: { display: true, text: 'hours' } }, y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { precision: 0 }, title: { display: true, text: 'tasks' } }, x: { grid: { display: false } } } } }, !has && !anyTasks, 'Weekly totals will appear once you focus or complete tasks.');
    const done = S.tasks.filter((t) => t.status === 'completed').length, od = S.tasks.filter((t) => isOverdue(t)).length, inp = S.tasks.filter((t) => t.status === 'inprogress' && !isOverdue(t)).length, pend = S.tasks.length - done - od - inp;
    mk('chTasks', { type: 'doughnut', data: { labels: ['Completed', 'In progress', 'Pending', 'Overdue'], datasets: [{ data: [done, inp, pend, od], backgroundColor: [accent, accent2, pendingC, dangerC], borderWidth: 2, borderColor: surfaceC }] }, options: { cutout: '62%' } }, !S.tasks.length, 'No tasks yet. Create tasks to see how they are progressing.');
    const last = focusSessions().slice(-20);
    mk('chSessions', { type: 'bar', data: { labels: last.map((s) => `${fmtDay(s.end, { month: 'numeric', day: 'numeric' })} ${fmtTime(s.end)}`), datasets: [{ label: 'Minutes', data: last.map((s) => +(s.ms / MIN).toFixed(1)), backgroundColor: last.map((s) => (s.completed ? accent : accent2)), borderRadius: 5, maxBarThickness: 22 }] }, options: Object.assign({}, yMin, { plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => (last[c.dataIndex].completed ? 'completed' : 'ended early') } } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false }, ticks: { display: last.length < 12 } } } }) }, !last.length, 'Each focus session you run will appear here (lighter bars ended early).');
    const d30 = Array.from({ length: 30 }, (_, i) => addDays(startOfDay(new Date()), i - 29));
    const vals = d30.map((d) => Math.round(focusMsBetween(d.getTime(), d.getTime() + DAY) / MIN));
    const avg = vals.map((_, i) => { const w = vals.slice(Math.max(0, i - 6), i + 1); return +(w.reduce((a, b) => a + b, 0) / w.length).toFixed(1); });
    mk('chTrend', { type: 'line', data: { labels: d30.map((d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })), datasets: [
      { label: 'Focus minutes', data: vals, borderColor: accent2, backgroundColor: 'rgba(211,151,250,.22)', fill: true, tension: 0.3, pointRadius: 2 },
      { label: '7-day average', data: avg, borderColor: accent, borderWidth: 2.5, tension: 0.35, pointRadius: 0 },
    ] }, options: { scales: { y: { beginAtZero: true }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } } } }, !has, 'Your 30-day trend builds up as you record focus sessions.');
  }

  /* --- settings --- */
  function getPath(p) { return p.split('.').reduce((o, k) => (o ? o[k] : undefined), S.settings); }
  function setPath(p, v) { const ks = p.split('.'); const last = ks.pop(); const o = ks.reduce((x, k) => x[k], S.settings); o[last] = v; }
  const row = (title, desc, ctl, cls = '') => `<div class="set-row ${cls}"><div class="lbl"><b>${title}</b>${desc ? `<span>${desc}</span>` : ''}</div><div class="ctl">${ctl}</div></div>`;
  const tog = (path) => sw(`data-setting="${path}"`, getPath(path));
  const num = (path, min, max, step = 1) => `<div class="stepper"><button type="button" data-step="${path}" data-d="-${step}" aria-label="Decrease">−</button><input type="number" inputmode="numeric" data-setting="${path}" data-num min="${min}" max="${max}" step="${step}" value="${getPath(path)}" aria-label="${path.split('.').pop()}"><button type="button" data-step="${path}" data-d="${step}" aria-label="Increase">+</button></div>`;
  const sel = (path, opts, isNumVal) => `<select class="select" data-setting="${path}" ${isNumVal ? 'data-num' : ''}>${opts.map(([v, l]) => `<option value="${v}" ${String(getPath(path)) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const SETTINGS_SECTIONS = [
    { group: 'Personalize', id: 'appearance', title: 'Appearance', icon: 'i-moon', color: '#6A4BD8', sum: () => ({ system: 'Match device', light: 'Light', dark: 'Dark' }[S.settings.general.theme]) },
    { group: 'Personalize', id: 'general', title: 'General', icon: 'i-settings', color: '#8364E8', sum: () => `${S.settings.general.timeFormat}-hour · week starts ${['Sunday', 'Monday', '', '', '', '', 'Saturday'][S.settings.general.weekStart]} · sounds ${S.settings.general.sounds ? 'on' : 'off'}` },
    { group: 'Focus', id: 'pomodoro', title: 'Pomodoro timer', icon: 'i-clock', color: '#6A4BD8', sum: () => { const p = S.settings.pomodoro; return `${p.focus} / ${p.short} / ${p.long} min · long break every ${p.interval}`; } },
    { group: 'Focus', id: 'focus', title: 'Focus Mode', icon: 'i-lock', color: '#8364E8', sum: () => `Do Not Disturb ${dndOn(S.settings.focusMode.dnd) ? 'on' : 'off'} · app lock ${lockOn(S.settings.focusMode.lockApps) ? 'on' : 'off'}` },
    { group: 'Focus', id: 'screen', title: 'Screen breaks', icon: 'i-eye', color: '#9B6BE8', sum: () => S.settings.screenBreak.enabled ? `Every ${S.settings.screenBreak.interval} min · ${S.settings.screenBreak.duration >= 60 ? fmtDur(S.settings.screenBreak.duration * 1000) : S.settings.screenBreak.duration + ' s'}` : 'Off' },
    { group: 'Focus', id: 'breaks', title: 'Break suggestions', icon: 'i-quote', color: '#B07FEF', sum: () => `${S.settings.breakSuggestions.length} ideas` },
    { group: 'Focus', id: 'music', title: 'Music', icon: 'i-music', color: '#C68CF5', sum: () => { const c = CadenceAudio.library.find((x) => x.id === S.settings.music.category); return `${c ? c.name : ''} · ${Math.round(S.settings.music.volume * 100)}%`; } },
    { group: 'Alerts & goals', id: 'permissions', title: 'Permissions', icon: 'i-lock', color: '#5E3FD0', sum: () => { const n = permList().filter((p) => p.on).length; return `${n} of ${permList().length} allowed`; } },
    { group: 'Alerts & goals', id: 'notifications', title: 'Notifications', icon: 'i-bell', color: '#6A4BD8', sum: () => `${Object.values(S.settings.notifications.categories).filter(Boolean).length} of ${Object.keys(NOTIF_CATS).length} types on${notifPerm() === 'granted' || notifPerm() === 'unavailable' ? '' : ' · blocked by system'}` },
    { group: 'Alerts & goals', id: 'goals', title: 'Goals', icon: 'i-trophy', color: '#8364E8', sum: () => `${S.settings.goals.dailyFocusMin} min a day · ${S.settings.goals.weeklyFocusHours} h a week` },
    { group: 'Data', id: 'data', title: 'Data & storage', icon: 'i-grid', color: '#5E3FD0', sum: () => `${S.tasks.length} tasks · ${S.sessions.length} sessions` },
    { group: 'Data', id: 'about', title: 'About Cadence', icon: 'i-focus', color: '#441C72', sum: () => 'Widgets, privacy, version' },
  ];
  const sectionById = (id) => SETTINGS_SECTIONS.find((x) => x.id === id);
  // System permissions, each shown as a switch that asks for it or opens the matching settings page.
  const permList = () => Device.isIOS ? [
    { id: 'notifications', title: 'Notifications', desc: 'Reminders, timers and screen breaks when Cadence is closed', on: notifPerm() === 'granted' },
    { id: 'usage', title: 'Screen Time', desc: 'Lock other apps during focus sessions', on: !!devStatus.usageAccess },
    ...(devStatus.alarmsSupported ? [{ id: 'fullScreen', title: 'Alarms', desc: 'Full-screen alert with sound when a session or break ends', on: !!devStatus.fullScreen }] : []),
  ] : [
    { id: 'notifications', title: 'Notifications', desc: 'Reminders, timers and screen breaks when Cadence is closed', on: notifPerm() === 'granted' },
    { id: 'fullScreen', title: 'Full-screen alerts', desc: 'Wake the screen when a focus session or break ends', on: !!devStatus.fullScreen },
    { id: 'overlay', title: 'Display over other apps', desc: 'Show alerts and the app lock over whatever is open', on: !!devStatus.overlay },
    { id: 'usage', title: 'Usage access', desc: 'See which app is open, to lock apps during focus', on: !!devStatus.usageAccess },
    { id: 'dnd', title: 'Do Not Disturb access', desc: 'Silence your phone during focus sessions', on: !!devStatus.dndAccess },
  ];
  function openSettingsSection(id) {
    if (ui.screen !== 'settings') go('settings');
    ui.settingsSection = id; pushNav(); applyChrome(); renderSettings(true); window.scrollTo(0, 0);
  }
  function renderSettings(animate) {
    const root = $('#settingsRoot');
    const scr = root.parentElement; scr.classList.remove('push'); if (animate) { void scr.offsetWidth; scr.classList.add('push'); }
    if (!ui.settingsSection) {
      const groups = [];
      SETTINGS_SECTIONS.forEach((s) => { let g = groups.find((x) => x.name === s.group); if (!g) groups.push((g = { name: s.group, items: [] })); g.items.push(s); });
      root.innerHTML = `
        <div class="set-profile"><span class="brand-mark"></span><div><b>Cadence</b><span>Everything is stored on this device only.</span></div></div>
        ${permissionCardHTML()}
        ${groups.map((g) => `<div class="set-group-label">${esc(g.name)}</div><div class="set-group">${g.items.map((s) => `
          <button class="set-nav" data-action="openSection" data-id="${s.id}">
            <span class="ic" style="background:${s.color}">${icon(s.icon)}</span>
            <span class="lbl"><b>${esc(s.title)}</b><span>${esc(s.sum())}</span></span>${icon('i-right', 'chev')}
          </button>`).join('')}</div>`).join('')}`;
      return;
    }
    root.innerHTML = sectionHTML(ui.settingsSection);
  }
  // Shown on the settings home when something blocks alerts from working outside the app.
  function permissionCardHTML() {
    if (!Device.isNative) return '';
    if (notifPerm() !== 'granted') return `<div class="card perm-card">${icon('i-bell')}<div class="meta"><b>Notifications are off</b><span class="small muted">Reminders, timers and screen breaks can’t reach you when Cadence is closed.</span></div><button class="btn btn-primary btn-sm" data-action="${notifPerm() === 'prompt' ? 'askNotif' : 'openNotifSettings'}">Turn on</button></div>`;
    if (!devStatus.exactAlarms) return `<div class="card perm-card">${icon('i-clock')}<div class="meta"><b>Alerts may run late</b><span class="small muted">Allow alarms & reminders so sessions and reminders end exactly on time.</span></div><button class="btn btn-primary btn-sm" data-action="exactAlarms">Allow</button></div>`;
    return '';
  }
  function sectionHTML(id) {
    const s = S.settings; const sb = s.screenBreak; const p = notifPerm(); const st = eyeStatus();
    switch (id) {
      case 'appearance': return `
        <div class="set-group"><h3>Theme</h3>
          <div class="theme-picker">${[['system', 'Device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `
            <button class="theme-opt" data-action="setTheme" data-id="${v}" aria-pressed="${s.general.theme === v}"><span class="theme-prev tp-${v}"><i class="a"></i><i></i><span class="ring-mini"></span><i></i></span>${l}</button>`).join('')}</div>
          <div class="set-row"><div class="lbl"><span>“Device” follows your phone’s light or dark setting automatically.</span></div></div>
        </div>`;
      case 'general': return `
        <div class="set-group">
          ${row('Time format', '', sel('general.timeFormat', [['12', '12-hour'], ['24', '24-hour']]))}
          ${row('First day of the week', 'Calendar, weekly stats and streaks', sel('general.weekStart', [[0, 'Sunday'], [1, 'Monday'], [6, 'Saturday']], true))}
        </div>
        <div class="set-group"><h3>Sound & haptics</h3>
          ${row('Sounds', 'Master switch for all Cadence sounds', tog('general.sounds'))}
          ${row('Timer end sound', 'Chime when sessions and breaks end', tog('general.timerSound'))}
          ${row('Chime volume', '', `<input type="range" class="range" style="width:120px" min="0" max="1" step="0.05" data-setting="general.chimeVolume" data-num value="${s.general.chimeVolume}" aria-label="Chime volume"><button class="btn btn-ghost btn-sm" data-action="testChime">Test</button>`)}
          ${row('Vibration', 'On phones that support it', tog('general.vibrate'))}
        </div>`;
      case 'pomodoro': return `
        <div class="set-group"><h3>Durations</h3>
          ${row('Focus session', 'Default 25 min', num('pomodoro.focus', 1, 180, 1))}
          ${row('Short break', 'Default 5 min', num('pomodoro.short', 1, 60, 1))}
          ${row('Long break', 'Default 15 min', num('pomodoro.long', 1, 90, 1))}
          ${row('Long break after', 'Focus sessions per cycle', num('pomodoro.interval', 2, 10, 1))}
        </div>
        <div class="set-group"><h3>Behaviour</h3>
          ${row('Automatic transitions', 'Start breaks automatically. When off, Cadence asks first. You are always asked before the next focus session.', tog('pomodoro.autoTransition'))}
        </div>`;
      case 'focus': return `
        <div class="set-group">
          ${row('Default focus duration', 'Minutes', num('focusMode.defaultDuration', 1, 240, 5))}
          ${row('Start music with Focus Mode', '', tog('focusMode.autoMusic'))}
          ${row('Track working time', 'Focus sessions count toward a task’s actual time', tog('focusMode.trackWork'))}
        </div>
        <div class="set-group"><h3>App lock</h3>
          ${row('Lock other apps during focus', 'Apps you haven’t allowed show a lock screen until your break', sw('data-action-change="lockDefault"', lockOn(s.focusMode.lockApps)))}
          ${row('Allowed apps', `${allowedCount()} app${allowedCount() === 1 ? '' : 's'} stay usable · ${Device.isIOS ? 'Phone, Settings and Cadence are never locked' : 'calls, Settings and Cadence always do'}`, '<button class="btn btn-soft btn-sm" data-action="chooseApps">Choose</button>')}
        </div>
        ${!DND_SUPPORTED ? `<div class="set-group"><h3>Do Not Disturb</h3>${row('Quiet your iPhone', 'iPhone doesn’t let apps switch Focus. Turn one on in Control Center; Cadence’s alerts are time-sensitive so they still come through.', '<button class="btn btn-ghost btn-sm" data-action="iosFocusHelp">How</button>')}</div>` : `<div class="set-group"><h3>Do Not Disturb</h3>
          ${row('Do Not Disturb during focus', 'Silences your phone while a focus session runs and turns off for breaks', sw('data-action-change="dndDefault"', dndOn(s.focusMode.dnd)))}
          <div class="set-row col"><span class="small muted">Still allowed through Do Not Disturb</span><div class="app-toggle-list">${DND_ALLOW.map((a) => `<label class="app-toggle"><input type="checkbox" data-setting="focusMode.allow.${a.id}" ${s.focusMode.allow[a.id] ? 'checked' : ''}>${icon(a.icon)}${a.name}</label>`).join('')}</div>
          <span class="small muted">Alarms and media always play.</span></div>
        </div>`}`;
      case 'permissions': return `
        <div class="set-group"><h3>Phone permissions</h3>
          ${permList().map((p) => row(p.title, p.desc, sw(`data-action-change="perm" data-id="${p.id}"`, p.on))).join('')}
        </div>
        <p class="small muted" style="padding:0 6px">${Device.isIOS ? 'Each switch asks iPhone for permission. To turn one off later, go to Settings → Cadence (Screen Time: Settings → Screen Time).' : 'Each switch opens the matching page in your phone’s settings. Turn it back off there if you change your mind.'}</p>`;
      case 'screen': return `
        <div class="set-group">
          ${row('Screen break reminders', `Separate from Pomodoro breaks. ${esc(st.text)}.`, tog('screenBreak.enabled'))}
          <div class="set-row"><div class="lbl"><b>20-20-20 rule</b><span>Every 20 min, look ~20 ft away for 20 s</span></div><div class="ctl"><button class="btn btn-soft btn-sm" data-action="preset202020">${sb.interval === 20 && sb.duration === 20 ? icon('i-check') + 'On' : 'Use'}</button></div></div>
        </div>
        <div class="set-group"><h3>Remind me every</h3>
          <div class="set-row col"><div class="pill-group">${[20, 30, 45, 60].map((m) => `<button class="pill" data-action="eyeInterval" data-id="${m}" aria-pressed="${sb.interval === m}">${m} min</button>`).join('')}</div></div>
          ${row('Custom interval', 'Minutes', num('screenBreak.interval', 1, 240, 1))}
        </div>
        <div class="set-group"><h3>Break length</h3>
          <div class="set-row col"><div class="pill-group">${[[20, '20 sec'], [60, '1 min'], [300, '5 min']].map(([v, l]) => `<button class="pill" data-action="eyeDuration" data-id="${v}" aria-pressed="${sb.duration === v}">${l}</button>`).join('')}</div></div>
          ${row('Custom length', 'Seconds', num('screenBreak.duration', 5, 1800, 5))}
        </div>
        <div class="set-group"><h3>Behaviour</h3>
          ${row('Apply during', '', sel('screenBreak.applyTo', [['both', 'Focus & general use'], ['focus', 'Focus sessions only'], ['general', 'General use only']]))}
          ${row('Pause Pomodoro during screen breaks', 'When off, the timer keeps running', tog('screenBreak.pauseTimer'))}
          ${row('Postpone by', 'Minutes', num('screenBreak.postponeMin', 1, 60, 1))}
        </div>
        <div class="set-group"><h3>Pause reminders</h3>
          <div class="set-row col"><span class="small muted">${S.eye.snoozeUntil > Date.now() ? 'Paused until ' + esc(fmtWhen(S.eye.snoozeUntil)) : 'Reminders are active'}</span>
            <div class="ctl">${[[30, '30 min'], [60, '1 hour'], [120, '2 hours']].map(([m, l]) => `<button class="btn btn-ghost btn-sm" data-action="eyeSnooze" data-id="${m}">${l}</button>`).join('')}<button class="btn btn-ghost btn-sm" data-action="eyeSnoozeTomorrow">Until tomorrow</button>${S.eye.snoozeUntil > Date.now() ? '<button class="btn btn-soft btn-sm" data-action="eyeUnsnooze">Resume now</button>' : ''}</div></div>
          <div class="set-row"><button class="btn btn-soft btn-block" data-action="eyeNow">${icon('i-eye')}Try a screen break now</button></div>
        </div>
        <div class="info-note">${icon('i-eye')}<div>While Cadence is open you get a guided full-screen break. When it’s closed, a notification reminds you while your screen is on — turning the screen off counts as a rest.</div></div>`;
      case 'breaks': return `
        <div class="set-group"><h3>Shown during Pomodoro breaks</h3>
          ${s.breakSuggestions.map((x, i) => `<div class="set-row"><div class="lbl"><span style="color:var(--ink)">${esc(x)}</span></div><div class="ctl"><button class="icon-btn sm" data-action="rmSuggestion" data-id="${i}" aria-label="Remove suggestion">${icon('i-trash')}</button></div></div>`).join('') || '<div class="set-row"><span class="small muted">No suggestions — add your own below.</span></div>'}
          <div class="set-row col"><div class="row"><input class="input" id="newSuggestion" placeholder="Add a break idea" maxlength="120"><button class="btn btn-soft" data-action="addSuggestion">Add</button></div>
          <button class="btn btn-ghost btn-sm" data-action="resetSuggestions" style="align-self:flex-start">Restore defaults</button></div>
        </div>`;
      case 'music': return `
        <div class="set-group">
          ${row('Default category', 'For Focus Mode and the player', sel('music.category', CadenceAudio.library.map((c) => [c.id, c.name])))}
          ${row('Default volume', '', `<input type="range" class="range" style="width:140px" min="0" max="1" step="0.05" data-setting="music.volume" data-num value="${s.music.volume}" aria-label="Default volume">`)}
          ${row('Pause during breaks', 'Resumes with the next focus session', tog('music.pauseOnBreak'))}
        </div>
        <div class="set-group"><h3>Your music</h3>
          ${S.music.uploads.length ? S.music.uploads.map((u) => row(esc(u.title), esc(((CadenceAudio.library.find((c) => c.id === u.category) || {}).name || 'My music') + (u.length ? ' · ' + fmtSec(u.length) : '')), `<button class="icon-btn sm" data-action="removeUpload" data-id="${u.id}" aria-label="Remove ${esc(u.title)}">${icon('i-trash')}</button>`)).join('') : '<div class="set-row"><span class="small muted">Upload your own tracks and pick the category they belong to.</span></div>'}
          <div class="set-row"><button class="btn btn-soft" data-action="uploadMusic">${icon('i-plus')}Upload music</button></div>
        </div>
        <p class="small muted" style="padding:0 6px">Built-in tracks are generated on your device, royalty-free and offline. Music keeps playing when you leave the app.</p>`;
      case 'notifications': return `
        <div class="set-group"><h3>System notifications</h3>
          ${Device.isNative ? row('Notifications', p === 'granted' ? 'Alerts reach you even when Cadence is closed' : 'Off — alerts only appear while Cadence is open', sw('data-action-change="perm" data-id="notifications"', p === 'granted')) : ''}
          ${row('In-app sounds', 'Chimes while Cadence is open', tog('notifications.sound'))}
          ${Device.isNative ? row('Sound, vibration & channels', 'Fine-tune each kind of alert in system settings', '<button class="btn btn-ghost btn-sm" data-action="openNotifSettings">Open</button>') : ''}
        </div>
        <div class="set-group"><h3>Notify me about</h3>${Object.entries(NOTIF_CATS).map(([k, [l]]) => row(l, '', tog('notifications.categories.' + k))).join('')}</div>
        <div class="set-group"><h3>Timing</h3>
          ${row('Default task reminder', 'For new tasks', sel('notifications.defaultReminder', [[0, 'At start'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before']], true))}
          ${row('End-time warning', 'Minutes before a scheduled end', num('notifications.endLead', 0, 120, 5))}
          ${row('Deadline warning', 'Minutes before a due date', num('notifications.deadlineLead', 5, 1440, 5))}
          ${row('Daily planning reminder', '', `<input class="input" type="time" data-setting="notifications.dailyTime" value="${esc(s.notifications.dailyTime)}">`)}
        </div>`;
      case 'goals': return `
        <div class="set-group">
          ${row('Daily focus goal', 'Minutes', num('goals.dailyFocusMin', 10, 720, 10))}
          ${row('Weekly focus goal', 'Hours', num('goals.weeklyFocusHours', 1, 80, 1))}
          ${row('Weekly tasks goal', 'Tasks', num('goals.weeklyTasks', 1, 200, 1))}
        </div>
        <p class="small muted" style="padding:0 6px">Goals are just gentle markers — progress shows on the dashboard and in Insights.</p>`;
      case 'data': {
        return `
        <div class="set-group"><h3>Backup</h3>
          <div class="set-row"><button class="btn btn-ghost" style="flex:1" data-action="viewData">View data</button><button class="btn btn-ghost" style="flex:1" data-action="exportData">Back up</button><button class="btn btn-ghost" style="flex:1" data-action="importData">Restore</button></div>
          <div class="set-row"><span class="small muted">Back up saves everything to a file you can keep in Files, Drive or email. Restore replaces the data on this device with a backup.</span></div>
        </div>
        <div class="set-group"><h3>Danger zone</h3>
          ${row(`<span class="danger-ic">${icon('i-reset')}</span>Clear activity history`, 'Removes sessions, screen-break history and notifications. Keeps tasks and settings.', `<button class="btn btn-danger-ghost btn-sm" data-action="clearHistory">${icon('i-reset')}Clear</button>`)}
          ${row(`<span class="danger-ic">${icon('i-trash')}</span>Reset application data`, 'Deletes everything Cadence stored on this device', `<button class="btn btn-danger btn-sm" data-action="resetAll">${icon('i-trash')}Reset</button>`)}
        </div>`;
      }
      case 'about': return `
        <div class="set-group">
          ${row('Version', '', '<span class="small muted">1.0</span>')}
          ${row('Works offline', 'Cadence needs no internet connection.', '')}
        </div>
        <div class="set-group"><h3>Home-screen widgets</h3>
          <div class="set-row col"><span class="small">${Device.isIOS ? 'Touch and hold your Home Screen, tap <b>Edit → Add Widget</b>, search for Cadence, then add any widget:' : 'Touch and hold your home screen, tap <b>Widgets</b>, then add any Cadence widget:'} Focus timer, Today, Upcoming schedule, Deadlines, Daily progress, Weekly focus, Focus streak, Mini calendar, Focus music, Screen breaks or Daily quote. They update as soon as anything changes in the app.${Device.isIOS ? ' While a session runs, the countdown also shows on your Lock Screen and in the Dynamic Island.' : ''}</span></div>
        </div>
        <div class="set-group"><h3>Privacy</h3>
          <div class="set-row col"><span class="small muted">No account, no server, no tracking. Tasks, sessions and settings are stored only on this device. Use Back up in Data & storage to keep a copy.</span></div>
        </div>`;
    }
    return '';
  }
  function onSettingChanged(path) {
    if (path === 'music.volume') { S.music.volume = S.settings.music.volume; CadenceAudio.setVolume(S.music.volume); save('music'); }
    if (path === 'music.category' && !CadenceAudio.current) { S.music.category = S.settings.music.category; save('music'); }
    if (path.startsWith('focusMode.allow')) { S.focus.allow = clone(S.settings.focusMode.allow); save('focus'); }
    if (path === 'focusMode.defaultDuration' && !S.focus.active) S.focus.duration = S.settings.focusMode.defaultDuration;
    if (path.startsWith('screenBreak.interval') && S.eye.accum > S.settings.screenBreak.interval * MIN) S.eye.accum = S.settings.screenBreak.interval * MIN - 5000;
    if (path === 'screenBreak.enabled') { S.eye.lastTick = Date.now(); if (!S.settings.screenBreak.enabled && S.eye.active) endEye('skipped'); }
    if (path.startsWith('pomodoro') && S.timer.status === 'idle') renderLive(true);
    save('settings', 'eye');
  }
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-setting]'); if (!el) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.hasAttribute('data-num')) { v = +v; if (!isFinite(v)) return; if (el.min !== '') v = Math.max(+el.min, v); if (el.max !== '') v = Math.min(+el.max, v); el.value = v; }
    setPath(el.dataset.setting, v); onSettingChanged(el.dataset.setting);
    if (el.type !== 'range') { renderSettingsKeepScroll(); }
    toastSaved();
  });
  let savedT = 0; function toastSaved() { if (Date.now() - savedT > 2500) { savedT = Date.now(); toast('Settings saved', '', 'ok', { timeout: 1500 }); } }
  function renderSettingsKeepScroll() { const y = window.scrollY; renderSettings(); window.scrollTo(0, y); }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]'); if (!b) return;
    const path = b.dataset.step; const inp = document.querySelector(`input[data-setting="${path}"]`); if (!inp) return;
    inp.value = clamp((+inp.value || 0) + +b.dataset.d, +inp.min, +inp.max); inp.dispatchEvent(new Event('change', { bubbles: true }));
  });

  /* --- data management --- */
  function exportJSON() {
    flush(); const out = {}; Object.keys(DEFAULTS).forEach((k) => (out[k] = S[k]));
    return JSON.stringify({ app: 'Cadence', version: 1, exportedAt: new Date().toISOString(), data: out }, null, 2);
  }
  function viewData() {
    flush();
    const keys = Object.keys(DEFAULTS);
    const m = openModal({ title: 'Stored application data', body: `
      <table class="data-table">${keys.map((k) => `<tr><td><code>${k}</code></td><td>${((Store.get(NS + k) || '').length / 1024).toFixed(1)} KB</td></tr>`).join('')}</table>
      <label class="field"><span>Inspect</span><select class="select" id="dataKey">${keys.map((k) => `<option>${k}</option>`).join('')}</select></label>
      <pre class="json-view" id="dataView"></pre>`, foot: '<button class="btn btn-ghost" data-close>Close</button><button class="btn btn-primary" data-action="exportData">Back up</button>' });
    const show = () => { const k = $('#dataKey', m.el).value; $('#dataView', m.el).textContent = JSON.stringify(S[k], null, 2); };
    $('#dataKey', m.el).onchange = show; show();
  }

  /* ============ Router, theme & app shell ============ */
  let navDepth = 0;
  const navState = () => ({ screen: ui.screen, section: ui.settingsSection || null, depth: navDepth });
  function pushNav() { navDepth++; try { history.pushState(navState(), ''); } catch (e) {} }
  function replaceNav() { try { history.replaceState(navState(), ''); } catch (e) {} }
  function applyChrome() {
    const sec = ui.screen === 'settings' && ui.settingsSection ? sectionById(ui.settingsSection) : null;
    $('#topbarTitle').textContent = sec ? sec.title : $('#screen-' + ui.screen).dataset.title;
    $('#backBtn').hidden = !(sec || ui.screen === 'insights');
    $('#topInsightsBtn').hidden = ui.screen === 'insights';
    $('#fab').hidden = !['tasks', 'calendar'].includes(ui.screen);
    $$('.nav-item').forEach((n) => { if (n.dataset.screen === ui.screen) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); });
  }
  function go(screen, opts = {}) {
    if (!document.getElementById('screen-' + screen)) screen = 'home';
    if (screen !== ui.screen) ui.prevScreen = ui.screen;
    ui.screen = screen; S.ui.screen = screen === 'insights' ? (ui.prevScreen || 'home') : screen; save('ui');
    ui.settingsSection = screen === 'settings' ? (opts.section || null) : null;
    $$('.screen').forEach((s) => { s.hidden = s.id !== 'screen-' + screen; s.classList.toggle('push', !!opts.push); });
    if (opts.push) pushNav(); else if (!opts.fromPop) replaceNav();
    applyChrome(); renderAll(); window.scrollTo(0, 0);
  }
  function goBack() {
    if (navDepth > 0) { try { history.back(); return; } catch (e) {} }
    if (ui.settingsSection) { ui.settingsSection = null; replaceNav(); applyChrome(); renderSettings(); window.scrollTo(0, 0); }
    else go(ui.prevScreen && ui.prevScreen !== ui.screen ? ui.prevScreen : 'home');
  }
  window.addEventListener('popstate', (e) => {
    const st = e.state || { screen: 'home', section: null, depth: 0 };
    navDepth = st.depth || 0;
    modalStack.slice().forEach((m) => m.dismissible && m.close());
    if (!$('#notifDrawer').hidden) closeDrawer();
    go(st.screen, { fromPop: true, section: st.section });
  });
  function renderAll() {
    const s = ui.screen;
    if (s === 'home') renderHome(); else if (s === 'tasks') renderTasks(); else if (s === 'calendar') renderCalendar();
    else if (s === 'focus') renderFocus(); else if (s === 'insights') renderInsights(); else if (s === 'settings') renderSettings();
    renderMusic(); updateBell();
  }
  const darkMQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    const t = S.settings.general.theme;
    const dark = t === 'dark' || (t === 'system' && darkMQ && darkMQ.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const m = $('meta[name="theme-color"]'); if (m) m.content = dark ? '#110E19' : '#F6F3FC';
    Device.setAppearance(dark, dark ? '#110E19' : '#F6F3FC');
    if (ui.screen === 'insights') renderCharts();
  }
  if (darkMQ) { if (darkMQ.addEventListener) darkMQ.addEventListener('change', applyTheme); else if (darkMQ.addListener) darkMQ.addListener(applyTheme); }
  function buzz(pattern) {
    if (!S.settings.general.vibrate) return;
    const p = Array.isArray(pattern) ? pattern : [pattern];
    if (Device.isNative) { Device.vibrate(p); return; }
    if (navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} }
  }
  // Android back button: close the top layer first, then step back, then leave the app.
  Device.onBack(() => {
    if (!$('#eyeOverlay').hidden) { postponeEye(); return; }
    const top = modalStack[modalStack.length - 1];
    if (top) { if (top.dismissible) top.close(); return; }
    if (!$('#notifDrawer').hidden) { closeDrawer(); return; }
    if (ui.settingsSection || ui.screen === 'insights') { goBack(); return; }
    if (ui.screen !== 'home') { go('home'); return; }
    Device.leave();
  });

  const A = {
    newTask: () => openTaskForm(), editTask: (el) => openTaskForm(el.dataset.id), deleteTask: (el) => deleteTask(el.dataset.id),
    toggleDone: (el) => { const t = getTask(el.dataset.id); if (t) setStatus(t, t.status === 'completed' ? 'pending' : 'completed'); },
    startWork: (el) => { const t = getTask(el.dataset.id); startWork(t, 'manual'); if (t) toast('Tracking time', `${t.title}${isScheduled(t) && tms(t.start) > Date.now() ? ' — started early' : ''}`, 'ok'); renderAll(); },
    stopWork: (el) => { const t = getTask(el.dataset.id); if (t) { stopWork(t, Date.now(), true); toast('Stopped tracking', `${fmtDur(t.actualMs)} worked in total`); } renderAll(); },
    postpone: (el) => openPostpone(el.dataset.id),
    openFocusSetup: (el) => openFocusSetup(el.dataset.id || null), openFocus: () => go('focus'), endFocus: () => endFocusMode(),
    timerStart: () => { if (S.focus.active && S.timer.phase === 'focus') { startTimer(); return; } startTimer(); if (S.timer.phase !== 'focus') breakToast(); },
    timerPause: () => pauseTimer(), timerResume: () => resumeTimer(), timerReset: () => resetTimer(), timerSkip: () => skipPhase(),
    setPhase: (el) => setPhase(el.dataset.id),
    goTodayTasks: () => { S.ui.taskView = 'today'; save('ui'); go('tasks'); }, goCalendar: () => go('calendar'), goInsights: () => go('insights', { push: true }),
    goEyeSettings: () => openSettingsSection('screen'), goGoalSettings: () => openSettingsSection('goals'),
    openSection: (el) => openSettingsSection(el.dataset.id),
    setTheme: (el) => { S.settings.general.theme = el.dataset.id; save('settings'); applyTheme(); renderSettingsKeepScroll(); },
    calDay: (el) => { ui.calSelected = el.dataset.id; ui.calCursor = new Date(el.dataset.id + 'T00:00'); S.ui.calView = 'day'; go('calendar'); },
    calSelect: (el) => { ui.calSelected = el.dataset.id; const d = new Date(el.dataset.id + 'T00:00'); if (d.getMonth() !== ui.calCursor.getMonth()) ui.calCursor = d; renderCalendar(); $('#calAgenda').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); },
    calDayView: (el) => { ui.calSelected = el.dataset.id; ui.calCursor = new Date(el.dataset.id + 'T00:00'); S.ui.calView = 'day'; save('ui'); renderCalendar(); },
    calAdd: (el) => { const d = new Date(el.dataset.id + 'T09:00'); openTaskForm(null, { start: toLocalInput(d), end: toLocalInput(d.getTime() + HOUR), estimate: 60 }); },
    musicToggle, musicNext: () => musicStep(1), musicPrev: () => musicStep(-1), musicPlay: (el) => playTrack(el.dataset.id), musicFav: (el) => toggleFav(el.dataset.id),
    musicCat: (el) => { S.music.category = el.dataset.id; save('music'); renderMusic(); },
    musicShuffle: () => { S.music.shuffle = !S.music.shuffle; save('music'); renderMusic(); }, musicRepeat: () => { S.music.repeat = !S.music.repeat; save('music'); renderMusic(); },
    musicStop: () => { CadenceAudio.stop(); renderMusic(); },
    uploadMusic: () => uploadMusic(), removeUpload: (el) => removeUpload(el.dataset.id),
    dndAccess: () => needDndAccess(), iosFocusHelp: () => iosFocusHelp(), chooseApps: () => chooseApps(), customizeWidgets: () => openWidgetGallery(), openWidgetGallery: () => openWidgetGallery(), exactAlarms: () => Device.openSettings('exactAlarms'), openNotifSettings: () => Device.openSettings('notifications'),
    eyeDone: () => completeEye(true), eyeSkip: () => skipEye(), eyePostpone: () => postponeEye(),
    eyeSettings: () => { postponeEye(); openSettingsSection('screen'); },
    eyeNow: () => { if (!S.settings.screenBreak.enabled || S.eye.active) return; triggerEye(); },
    eyeSnooze: (el) => snoozeEye(+el.dataset.id * MIN, `For ${fmtDur(+el.dataset.id * MIN)}.`),
    eyeSnoozeTomorrow: () => { const t = addDays(startOfDay(new Date()), 1); t.setHours(8); snoozeEye(t.getTime() - Date.now(), `Until ${fmtWhen(t)}.`); },
    eyeUnsnooze: () => { S.eye.snoozeUntil = 0; save('eye'); renderAll(); toast('Screen Break Reminders resumed'); },
    eyeEnable: () => { S.settings.screenBreak.enabled = true; S.eye.lastTick = Date.now(); save('settings', 'eye'); renderAll(); },
    eyeInterval: (el) => { S.settings.screenBreak.interval = +el.dataset.id; onSettingChanged('screenBreak.interval'); renderSettingsKeepScroll(); toastSaved(); },
    eyeDuration: (el) => { S.settings.screenBreak.duration = +el.dataset.id; onSettingChanged('screenBreak.duration'); renderSettingsKeepScroll(); toastSaved(); },
    preset202020: () => { Object.assign(S.settings.screenBreak, { interval: 20, duration: 20, enabled: true }); onSettingChanged('screenBreak.interval'); renderSettingsKeepScroll(); toast('20-20-20 rule applied', 'Every 20 min, look ~20 ft away for 20 s.', 'ok'); },
    askNotif: () => askNotifPermission(),
    readNotif: (el, e) => { if (e.target.closest('[data-action=delNotif]')) return; const n = S.notifs.find((x) => x.id === el.dataset.id); if (n) { n.read = true; save('notifs'); renderNotifs(); updateBell(); } },
    delNotif: (el) => { S.notifs = S.notifs.filter((x) => x.id !== el.dataset.id); save('notifs'); renderNotifs(); updateBell(); },
    testChime: () => CadenceAudio.chime('focusEnd', S.settings.general.chimeVolume),
    addSuggestion: () => { const i = $('#newSuggestion'); const v = i.value.trim(); if (!v) return; S.settings.breakSuggestions.push(v); save('settings'); renderSettingsKeepScroll(); toast('Suggestion added', '', 'ok'); },
    rmSuggestion: (el) => { S.settings.breakSuggestions.splice(+el.dataset.id, 1); save('settings'); renderSettingsKeepScroll(); },
    resetSuggestions: () => { S.settings.breakSuggestions = DEFAULT_SUGGESTIONS.slice(); save('settings'); renderSettingsKeepScroll(); },
    viewData,
    exportData: async () => {
      const name = `cadence-backup-${dayKey(new Date())}.json`; const text = exportJSON();
      if (Device.isNative) {
        try { await Device.shareFile(name, text); } catch (e) { toast('Back up failed', (e && e.message) || 'The file could not be created.', 'err'); }
        return;
      }
      const blob = new Blob([text], { type: 'application/json' }); const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    importData: () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        let parsed = null; try { parsed = JSON.parse(await f.text()); } catch (e) { /* handled below */ }
        const data = parsed && parsed.app === 'Cadence' && parsed.data && typeof parsed.data === 'object' ? parsed.data : null;
        if (!data) { toast('Not a Cadence backup', 'Choose a file made with Back up.', 'err'); return; }
        const when = parsed.exportedAt && !isNaN(tms(parsed.exportedAt)) ? ` from ${esc(fmtWhen(parsed.exportedAt))}` : '';
        if (!(await confirmDialog({ title: 'Restore backup?', message: `Everything on this device will be replaced with the backup${when}.`, confirmText: 'Restore', danger: true }))) return;
        CadenceAudio.stop();
        Object.keys(DEFAULTS).forEach((k) => { if (k in data) Store.set(NS + k, JSON.stringify(data[k])); else Store.remove(NS + k); });
        reloadClean();
      };
      inp.click();
    },
    clearHistory: async () => {
      if (!(await confirmDialog({ title: 'Clear activity history?', message: 'Focus sessions, screen-break history, notifications and achievements will be deleted. Tasks and settings stay.', confirmText: 'Clear history', danger: true }))) return;
      S.sessions = []; S.eyeLog = []; S.notifs = []; S.ach = {}; S.tasks.forEach((t) => { t.focusMs = 0; }); save('sessions', 'eyeLog', 'notifs', 'ach', 'tasks'); renderAll(); toast('Activity history cleared', '', 'ok');
    },
    resetAll: async () => {
      if (!(await confirmDialog({ title: 'Reset all data?', message: 'This permanently deletes every task, setting and record Cadence stored on this device.', confirmText: 'Reset everything', danger: true }))) return;
      CadenceAudio.stop(); Store.keys().filter((k) => k.startsWith(NS)).forEach((k) => Store.remove(k));
      reloadClean();
    },
    wMove: (el) => { const o = S.widgets.order.filter((w) => !S.widgets.hidden.includes(w)); const i = o.indexOf(el.dataset.id); const j = i + +el.dataset.dir; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; S.widgets.order = o.concat(S.widgets.hidden); save('widgets'); renderHome(); },
    wHide: (el) => { S.widgets.hidden.push(el.dataset.id); save('widgets'); renderHome(); },
    wShow: (el) => { S.widgets.hidden = S.widgets.hidden.filter((w) => w !== el.dataset.id); S.widgets.order = S.widgets.order.filter((w) => w !== el.dataset.id).concat(el.dataset.id); S.widgets.order = S.widgets.order.filter((w) => !S.widgets.hidden.includes(w)).concat(S.widgets.hidden); save('widgets'); renderHome(); },
    wReset: () => { S.widgets = clone(DEFAULTS.widgets); save('widgets'); renderHome(); },
  };
  const CHANGE = {
    timerTask: (el) => { const prev = timerTask(); if (S.timer.phase === 'focus' && S.timer.status === 'running') stopWork(prev, Date.now(), false, 'timer'); S.timer.taskId = el.value || null; if (S.timer.phase === 'focus' && S.timer.status === 'running' && S.settings.focusMode.trackWork) startWork(timerTask(), 'timer'); save('timer'); renderActiveCard(); },
    toggleSub: (el) => { const t = getTask(el.dataset.id); const s = t && t.subtasks.find((x) => x.id === el.dataset.sid); if (s) { s.done = el.checked; if (t.status === 'pending' && s.done) t.status = 'inprogress'; save('tasks'); renderAll(); } },
    musicCat: (el) => { S.music.category = el.value; save('music'); if (CadenceAudio.playing || el.value !== 'fav') playCategory(el.value); else renderMusic(); },
    dndDefault: (el) => { if (el.checked && Device.isNative && !devStatus.dndAccess) { el.checked = false; needDndAccess(); return; } S.settings.focusMode.dnd = el.checked; if (!S.focus.active) S.focus.dnd = el.checked; save('settings', 'focus'); toastSaved(); },
    lockDefault: (el) => { if (el.checked && !lockReady()) { el.checked = false; needLockAccess(); return; } S.settings.focusMode.lockApps = el.checked; if (!S.focus.active) S.focus.lockApps = el.checked; save('settings', 'focus'); toastSaved(); },
    focusDnd: (el) => { if (el.checked && Device.isNative && !devStatus.dndAccess) { el.checked = false; needDndAccess(); return; } if (S.focus.active) S.focus.dnd = el.checked; else { S.settings.focusMode.dnd = el.checked; S.focus.dnd = el.checked; } save('focus', 'settings'); renderFocus(); toast(el.checked ? 'Do Not Disturb on' : 'Do Not Disturb off', el.checked ? 'Your phone stays quiet during focus sessions.' : '', 'ok', { timeout: 1800 }); },
    focusLock: (el) => { if (el.checked && !lockReady()) { el.checked = false; needLockAccess(); return; } if (S.focus.active) S.focus.lockApps = el.checked; else { S.settings.focusMode.lockApps = el.checked; S.focus.lockApps = el.checked; } save('focus', 'settings'); renderFocus(); toast(el.checked ? 'App lock on' : 'App lock off', el.checked ? 'Apps you haven’t allowed are locked during focus sessions.' : '', 'ok', { timeout: 1800 }); },
    perm: async (el) => {
      const id = el.dataset.id; const cur = permList().find((p) => p.id === id); el.checked = !!(cur && cur.on);
      if (id === 'notifications' && notifPerm() === 'prompt') { askNotifPermission(); return; }
      if (Device.isIOS && id === 'usage' && !devStatus.usageAccess) { needLockAccess(); return; }
      if (Device.isIOS && id === 'fullScreen' && !devStatus.fullScreen) { await Device.requestAlarms(); await refreshDeviceStatus(); renderSettingsKeepScroll(); return; }
      if (id === 'dnd' && !devStatus.dndAccess) pendingPerm.dnd = true;
      Device.openSettings(id);
    },
    allowToggle: (el) => { S.focus.allow[el.dataset.id] = el.checked; S.settings.focusMode.allow = clone(S.focus.allow); save('focus', 'settings'); },
    resumeAfterBreak: (el) => { S.focus.resumeAfterBreak = el.checked; save('focus'); },
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]'); if (!el || el.disabled) return;
    const fn = A[el.dataset.action]; if (!fn) return;
    if (el.tagName === 'A') e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-action]')) { e.preventDefault(); e.target.click(); }
    if (e.key === 'Enter' && e.target.id === 'newSuggestion') A.addSuggestion();
  });
  document.addEventListener('change', (e) => { const el = e.target.closest('[data-action-change]'); if (el && CHANGE[el.dataset.actionChange]) CHANGE[el.dataset.actionChange](el, e); });

  // static wiring
  $$('.nav-item').forEach((n) => n.addEventListener('click', () => go(n.dataset.screen)));
  $('#topInsightsBtn').onclick = () => go('insights', { push: true });
  $('#backBtn').onclick = goBack;
  $('#fab').onclick = () => { if (ui.screen === 'calendar') A.calAdd({ dataset: { id: ui.calSelected } }); else openTaskForm(); };
  $('#filtersToggle').onclick = () => { const f = $('#taskFilters'); f.hidden = !f.hidden; $('#filtersToggle').setAttribute('aria-expanded', String(!f.hidden)); $('#filtersToggle').classList.toggle('btn-soft', !f.hidden); };
  $('#bellBtn').onclick = openDrawer; $('#notifClose').onclick = closeDrawer; $('#scrim').onclick = closeDrawer;
  $('#notifReadAll').onclick = () => { S.notifs.forEach((n) => (n.read = true)); save('notifs'); renderNotifs(); updateBell(); };
  $('#notifClear').onclick = async () => { if (!S.notifs.length) return; if (await confirmDialog({ title: 'Clear notifications?', message: 'Your notification history will be removed.', confirmText: 'Clear', danger: true })) { S.notifs = []; save('notifs'); renderNotifs(); updateBell(); } };
  $('#qaNewTask').onclick = () => openTaskForm();
  $('#qaFocus').onclick = () => openFocusSetup(); $('#qaCalendar').onclick = () => go('calendar');
  $('#customizeBtn').onclick = () => {
    const visible = S.widgets.order.filter((w) => !S.widgets.hidden.includes(w));
    if (!visible.length && !ui.editingWidgets) { openWidgetGallery(); return; }
    ui.editingWidgets = !ui.editingWidgets; renderHome();
  };
  $('#taskViews').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (!b) return; S.ui.taskView = b.dataset.view; save('ui'); renderTasks(); });
  $('#taskSearch').addEventListener('input', (e) => { ui.search = e.target.value; renderTasks(); });
  $('#fPriority').onchange = (e) => { ui.filters.priority = e.target.value; renderTasks(); };
  $('#fCategory').onchange = (e) => { ui.filters.category = e.target.value; renderTasks(); };
  $('#fStatus').onchange = (e) => { ui.filters.status = e.target.value; renderTasks(); };
  $('#fSort').onchange = (e) => { S.ui.sort = e.target.value; save('ui'); renderTasks(); };
  $('#calViews').addEventListener('click', (e) => { const b = e.target.closest('[data-cview]'); if (!b) return; S.ui.calView = b.dataset.cview; ui.calCursor = new Date(ui.calSelected + 'T00:00'); save('ui'); renderCalendar(); });
  const calShift = (dir) => { const v = S.ui.calView; const c = ui.calCursor;
    ui.calCursor = v === 'month' ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : addDays(c, dir * (v === 'week' ? 7 : 1));
    if (v !== 'month') ui.calSelected = dayKey(v === 'day' ? ui.calCursor : weekStartOf(ui.calCursor)); renderCalendar(); };
  $('#calPrev').onclick = () => calShift(-1); $('#calNext').onclick = () => calShift(1);
  $('#calTitle').onclick = () => { ui.calCursor = new Date(); ui.calSelected = dayKey(new Date()); renderCalendar(); };
  $('#statRange').addEventListener('click', (e) => { const b = e.target.closest('[data-range]'); if (!b) return; ui.statRange = b.dataset.range; renderInsights(); });

  // widget drag & drop (desktop) — arrows provide the accessible alternative
  let dragId = null;
  $('#widgetGrid').addEventListener('dragstart', (e) => { const w = e.target.closest('[data-widget]'); if (!w || !ui.editingWidgets) return; dragId = w.dataset.widget; w.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (er) {} });
  $('#widgetGrid').addEventListener('dragover', (e) => { if (!dragId) return; const w = e.target.closest('[data-widget]'); if (!w) return; e.preventDefault(); $$('.drop-target').forEach((x) => x.classList.remove('drop-target')); if (w.dataset.widget !== dragId) w.classList.add('drop-target'); });
  $('#widgetGrid').addEventListener('drop', (e) => {
    const w = e.target.closest('[data-widget]'); if (!w || !dragId) return; e.preventDefault();
    const o = S.widgets.order.filter((x) => !S.widgets.hidden.includes(x)); const from = o.indexOf(dragId), to = o.indexOf(w.dataset.widget);
    if (from >= 0 && to >= 0 && from !== to) { o.splice(to, 0, o.splice(from, 1)[0]); S.widgets.order = o.concat(S.widgets.hidden); save('widgets'); }
    dragId = null; renderHome();
  });
  $('#widgetGrid').addEventListener('dragend', () => { dragId = null; $$('.dragging,.drop-target').forEach((x) => x.classList.remove('dragging', 'drop-target')); });

  /* ============ Device sync: widgets, alarms, notifications, DND ============ */
  // Everything the native side (Android or iOS) needs to keep working while Cadence is closed.
  function deviceSnapshot() {
    const now = Date.now(); const sod = startOfDay(new Date()).getTime(); const t = S.timer; const tk = timerTask();
    const p = S.settings.pomodoro; const cats = S.settings.notifications.categories; const sb = S.settings.screenBreak;
    const cur = CadenceAudio.current; const ms = (v) => (v ? tms(v) : 0);
    const recent = now - 2 * DAY; const soon = (x) => Math.min(ms(x.start) || Infinity, ms(x.due) || Infinity);
    const tasks = S.tasks.filter((x) => x.status !== 'completed' || x.completedAt >= recent).sort((a, b) => soon(a) - soon(b)).slice(0, 150);
    const since = dayKey(now - 400 * DAY);
    return {
      use24h: S.settings.general.timeFormat === '24',
      timer: { phase: t.phase, status: t.status, endAt: t.endAt, remaining: t.remaining, total: t.total, cycle: t.cycle || 0 },
      timerConfig: { focusMs: phaseTotal('focus'), shortMs: p.short * MIN, longMs: p.long * MIN, interval: p.interval, autoTransition: p.autoTransition, taskTitle: tk ? tk.title : '' },
      notif: { pomodoro: !!cats.pomodoro, breakDone: !!cats.breakDone, screenBreak: !!cats.screenBreak },
      music: { has: !!cur, playing: CadenceAudio.playing, title: cur ? cur.title : '', category: cur ? cur.categoryName : '' },
      dnd: { enabled: dndOn(focusPref('dnd')), allow: S.focus.active ? S.focus.allow : S.settings.focusMode.allow },
      lock: { enabled: lockOn(focusPref('lockApps')), allowed: S.settings.focusMode.allowedApps },
      alerts: { sound: !!(S.settings.general.sounds && S.settings.notifications.sound), vibrate: !!S.settings.general.vibrate },
      weekStart: S.settings.general.weekStart,
      goals: { dailyMin: S.settings.goals.dailyFocusMin, weeklyHours: S.settings.goals.weeklyFocusHours, weeklyTasks: S.settings.goals.weeklyTasks },
      quotes: QUOTES,
      eye: { enabled: !!sb.enabled, intervalMs: sb.interval * MIN, durationSec: sb.duration, postponeMin: sb.postponeMin, snoozeUntil: S.eye.snoozeUntil || 0, accumMs: Math.round(S.eye.accum || 0), applyTo: sb.applyTo },
      reminders: scheduledReminders(now),
      today: {
        tasks: tasks.map((x) => ({ id: x.id, title: x.title, status: x.status, start: ms(x.start), end: ms(x.end), due: ms(x.due), completedAt: x.completedAt || 0, color: catColor(x.category) })),
        focusDays: Array.from(focusDays()).filter((k) => k >= since),
        focusToday: { day: dayKey(now), ms: Math.round(focusMsBetween(sod, sod + DAY)) },
        focusByDay: perDay(now, (a, b) => Math.round(focusMsBetween(a, b))),
        doneByDay: perDay(now, (a, b) => tasksDoneBetween(a, b)),
        goalMin: S.settings.goals.dailyFocusMin,
      },
    };
  }
  // { 'YYYY-MM-DD': value } for the last 6 weeks, for the home-screen widgets.
  function perDay(now, fn) {
    const out = {}; let d = startOfDay(new Date(now));
    for (let i = 0; i < 42; i++) { const a = d.getTime(); const v = fn(a, addDays(d, 1).getTime()); if (v) out[dayKey(a)] = v; d = addDays(d, -1); }
    return out;
  }
  let syncTimer = null; let draining = false;
  function scheduleSync(now) {
    if (!Device.isNative) return;
    clearTimeout(syncTimer);
    const run = () => { if (draining) { syncTimer = setTimeout(run, 200); return; } Device.sync(deviceSnapshot()); };
    if (now) run(); else syncTimer = setTimeout(run, 400);
  }

  // Replays what happened from widgets and notifications while Cadence was in the background.
  function catchUp(at) { let g = 0; while (S.timer.status === 'running' && at >= S.timer.endAt && g++ < 12) completePhase(S.timer.endAt); }
  function closePrompt() { const m = modalStack.find((x) => x.id === 'prompt'); if (m) m.close(); }
  function applyAction(a) {
    const at = isNum(a.at) ? a.at : Date.now();
    switch (a.type) {
      case 'start': catchUp(at); if (S.timer.status === 'idle') { closePrompt(); S.timer.awaiting = null; startTimer(at); } break;
      case 'pause': catchUp(at); pauseTimer(at); break;
      case 'resume': catchUp(at); resumeTimer(at); break;
      case 'skip': catchUp(at); closePrompt(); skipPhase(at); break;
      case 'focusTask': catchUp(at); if (S.timer.status === 'idle' && getTask(a.id)) { closePrompt(); S.timer.taskId = a.id; S.timer.phase = 'focus'; S.timer.awaiting = null; startTimer(at); } break;
      case 'task': {
        const t = getTask(a.id); if (!t) break;
        if (a.done && t.status !== 'completed') setStatus(t, 'completed', { at, quiet: true });
        else if (!a.done && t.status === 'completed') setStatus(t, 'pending', { quiet: true });
        break;
      }
      case 'eye':
        S.eyeLog.push({ ts: at, action: a.action, ms: a.ms || 0, planned: S.settings.screenBreak.duration * 1000, minutes: a.minutes });
        S.eyeLog = S.eyeLog.slice(-1000); if (a.action === 'completed') S.eye.accum = 0;
        save('eyeLog', 'eye'); checkAchievements(); break;
      case 'eyeFired': S.eye.accum = 0; save('eye'); break;
      case 'delivered':
        if (!S.sent[a.key]) {
          S.sent[a.key] = at; save('sent');
          S.notifs.unshift({ id: uid(), ts: at, cat: a.cat, title: a.title, body: a.body, read: false }); S.notifs = S.notifs.slice(0, 150); save('notifs');
        }
        break;
      case 'music':
        if (Date.now() - at > 30000) break; // only act on fresh taps
        if (a.cmd === 'musicNext') musicStep(1);
        else if (a.cmd === 'musicPrev') musicStep(-1);
        else if (a.cmd === 'musicStop') { CadenceAudio.stop(); renderMusic(); }
        else musicToggle();
        break;
      case 'open': openFromOutside(a.screen); break;
    }
  }
  function openFromOutside(screen) {
    if (screen === 'newTask') { go('tasks'); openTaskForm(); }
    else if (screen === 'screenBreak') { if (S.settings.screenBreak.enabled && !S.eye.active) triggerEye(); }
    else if (screen === 'playMusic') { go('focus'); musicResume(); }
    else if (screen === 'insights') go('insights', { push: true });
    else if (['home', 'tasks', 'calendar', 'focus', 'settings'].includes(screen)) go(screen);
  }
  async function drainActions() {
    if (draining || !Device.isNative) return;
    draining = true;
    try {
      const list = await Device.takeActions();
      list.sort((x, y) => (x.at || 0) - (y.at || 0)).forEach((a) => { try { applyAction(a); } catch (e) { console.error('[Cadence] action failed', a, e); } });
      if (list.length) { save('timer'); updateBell(); renderAll(); }
    } finally { draining = false; }
    scheduleSync(true);
  }
  Device.onActions(() => drainActions());
  Device.onResume(() => { drainActions(); refreshDeviceStatus().then(() => { applyPermissionDefaults(); if (['settings', 'focus', 'home'].includes(ui.screen)) renderAll(); }); });
  Device.onPause(() => { flush(); scheduleSync(true); });

  /* ============ Main loop (timestamp based) ============ */
  let lastSlow = 0, lastMinute = new Date().getMinutes(), lastSync = Date.now();
  function tick() {
    const now = Date.now();
    let guard = 0;
    while (S.timer.status === 'running' && now >= S.timer.endAt && guard++ < 12) completePhase(S.timer.endAt);
    eyeTick(now);
    renderLive(false); updateMusicProgress();
    const bar = $('.js-eye-widget-bar'); if (bar) { const st = eyeStatus(); if (st.left != null) bar.style.width = `${clamp((1 - st.left / (S.settings.screenBreak.interval * MIN)) * 100, 0, 100)}%`; }
    if (now - lastSlow > 15000) { lastSlow = now; checkReminders(); save('eye'); }
    if (now - lastSync > 5 * MIN) { lastSync = now; scheduleSync(); }
    const m = new Date().getMinutes();
    if (m !== lastMinute) { lastMinute = m; if (!modalStack.length && !ui.editingWidgets && ['home', 'calendar', 'focus'].includes(ui.screen) && !document.activeElement.closest('select,input')) renderAll(); }
  }
  document.addEventListener('visibilitychange', () => {
    tick();
    if (document.visibilityState === 'visible') { S.eye.lastTick = Date.now(); renderAll(); }
    else { flush(); scheduleSync(true); }
  });

  // init
  (async function init() {
    applyTheme();
    if (ui.screen === 'insights') ui.screen = 'home';
    S.music.volume = isNum(S.music.volume) ? S.music.volume : S.settings.music.volume;
    S.eye.lastTick = Date.now(); // time while Cadence was closed is handled by the device
    const startScreen = ui.screen; ui.screen = null; go(startScreen);
    enhanceControls(document.body);
    // Apply what was done from widgets and notifications before catching the timer up to now.
    await drainActions();
    await refreshDeviceStatus();
    applyPermissionDefaults();
    if (S.eye.active) { if (Date.now() >= S.eye.active.endAt) completeEye(false); else showEyeOverlay(); }
    let guard = 0; while (S.timer.status === 'running' && Date.now() >= S.timer.endAt && guard++ < 12) completePhase(S.timer.endAt);
    if (S.timer.status === 'idle' && S.timer.awaiting === 'break') promptBreak();
    else if (S.timer.status === 'idle' && S.timer.awaiting === 'focus') promptNextFocus();
    checkReminders(); updateBell(); renderAll(); scheduleSync(true);
    if (corrupted.length) toast('Some saved data was reset', `Unreadable data for: ${corrupted.join(', ')}. Defaults were restored.`, 'err', { timeout: 7000 });
    setInterval(tick, 500);
    // first run
    if (!Store.get(NS + 'seen')) {
      Store.set(NS + 'seen', '1');
      setTimeout(() => toast('Welcome to Cadence', 'Add a task, then press Focus to start your first session. Everything stays on this device.', 'ok', { timeout: 7000 }), 600);
    }
    // Reminders, timers and screen breaks can only reach you outside the app with notifications on.
    if (Device.isNative && notifPerm() === 'prompt') setTimeout(() => askNotifPermission(true), 1500);
  })();
});
