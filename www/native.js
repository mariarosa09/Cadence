/* Cadence — device layer
 * On-device storage (Android SharedPreferences through Capacitor Preferences) and the bridge to the
 * native side: home-screen widgets, alarms, system notifications and Do Not Disturb.
 * Everything stays on the device; nothing is sent anywhere.
 */
(function () {
  'use strict';

  const Cap = window.Capacitor;
  const isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  const plugin = (name) => (isNative && typeof Cap.registerPlugin === 'function' ? Cap.registerPlugin(name) : null);
  const Preferences = plugin('Preferences');
  const App = plugin('App');
  const Native = plugin('CadenceNative');

  const PREFIX = 'cadence.v1.';
  const THEME_KEY = PREFIX + 'settings'; // mirrored to localStorage so the theme applies before first paint
  const mem = new Map();

  /* ---------- storage ---------- */
  let chain = Promise.resolve();
  function mirror(key, value) {
    if (Preferences && key !== THEME_KEY) return;
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* quota or disabled */ }
  }
  function persist(key, value) {
    mirror(key, value);
    if (!Preferences) return;
    chain = chain
      .then(() => (value == null ? Preferences.remove({ key }) : Preferences.set({ key, value })))
      .catch((e) => console.warn('[Cadence] Could not save', key, e));
  }

  async function load() {
    if (Preferences) {
      try {
        const { keys } = await Preferences.keys();
        const ours = keys.filter((k) => k.startsWith(PREFIX));
        const vals = await Promise.all(ours.map((key) => Preferences.get({ key })));
        ours.forEach((k, i) => { if (vals[i] && vals[i].value != null) mem.set(k, vals[i].value); });
        if (ours.length) return;
      } catch (e) {
        console.warn('[Cadence] Could not read device storage', e);
      }
    }
    // Nothing in device storage yet: carry over data kept by earlier versions in WebView storage.
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) mem.set(k, localStorage.getItem(k));
      }
      if (Preferences) mem.forEach((v, k) => persist(k, v));
    } catch (e) { /* storage unavailable */ }
  }

  const store = {
    get: (k) => (mem.has(k) ? mem.get(k) : null),
    set: (k, v) => { v = String(v); mem.set(k, v); persist(k, v); },
    remove: (k) => { mem.delete(k); persist(k, null); },
    keys: () => Array.from(mem.keys()),
    /** Resolves once every queued write has reached device storage. */
    flushed: () => chain,
    ready: null,
  };
  store.ready = load();

  /* ---------- native bridge ---------- */
  const OFF = { notifications: 'unavailable', exactAlarms: true, dndAccess: false, dndActive: false };
  const quiet = (p, fallback) => Promise.resolve(p).catch((e) => { console.warn('[Cadence]', e); return fallback; });

  const device = {
    isNative,
    /** Publishes app state for widgets, alarms, notifications and Do Not Disturb. */
    sync: (state) => (Native ? quiet(Native.sync({ state })) : Promise.resolve()),
    /** Actions taken from widgets and notifications while the app was in the background. */
    takeActions: () => (Native ? quiet(Native.takeActions().then((r) => (r && r.actions) || []), []) : Promise.resolve([])),
    status: () => (Native ? quiet(Native.status(), OFF) : Promise.resolve(OFF)),
    requestNotifications: () => (Native ? quiet(Native.requestNotifications(), OFF) : Promise.resolve(OFF)),
    openSettings: (which) => (Native ? quiet(Native.openSettings({ which })) : Promise.resolve()),
    shareFile: (filename, text, mimeType = 'application/json') => (Native ? Native.shareFile({ filename, text, mimeType }) : Promise.reject(new Error('Not available'))),
    onActions: (fn) => { if (Native) Native.addListener('actions', fn); },
    onBack: (fn) => { if (App) App.addListener('backButton', fn); },
    onResume: (fn) => { if (App) App.addListener('resume', fn); },
    onPause: (fn) => { if (App) App.addListener('pause', fn); },
    leave: () => { if (App) quiet(App.minimizeApp()); },
  };

  window.CadenceStore = store;
  window.CadenceDevice = device;
})();
