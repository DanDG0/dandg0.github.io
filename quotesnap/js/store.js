/*
 * QuoteSnap store — everything lives in this browser's localStorage.
 * Swap this file for API calls when you add accounts / a backend.
 */
(function (root) {
  'use strict';

  const KEY = 'quotesnap:v1';
  const FREE_DOC_LIMIT = 5; // quotes + invoices per calendar month on the Free plan
  const PRO_PRICE = { amount: 5, currency: 'USD', label: '$5' }; // shown on the upgrade screens
  const R = root.QSRegions;
  const T = root.QSTeam;
  const SESSION_KEY = 'quotesnap:session';   // who is signed in in this tab
  const REMEMBER_KEY = 'quotesnap:remember'; // "keep me signed in" on this device

  const DEFAULT_SETTINGS = {
    businessName: '',
    ownerName: '',
    phone: '',
    email: '',
    address: '',
    country: '',        // ISO country, e.g. "US", "DE", "IN"
    currencyCode: '',   // ISO currency, e.g. "USD"
    countryCode: '',    // dialling code without +, e.g. "1", "44"
    dateOrder: 'DMY',   // how dates in pasted chats are written: DMY or MDY
    taxRate: 0,
    taxLabel: 'Tax',
    taxNumber: '',
    paymentDetails: '',
    quotePrefix: 'Q-',
    invoicePrefix: 'INV-',
    quoteValidDays: 14,
    invoiceDueDays: 7,
    footerNote: 'Thank you for your business!',
    brandColor: '#1f6f4a',
    logo: null,
    autoReminders: true,
  };

  /** Fill in region-based settings (first run, or older saved data) and the derived locales. */
  function withRegion(settings) {
    const s = { ...settings };
    if (!s.country && !s.currencyCode) {
      const guess = R.defaultsFor(R.guessCountry());
      Object.assign(s, guess);
    }
    if (!s.currencyCode) s.currencyCode = R.info(s.country).currency;
    delete s.currency; // old field from the first version
    s.locale = R.localeFor(s.country);
    s.numberLocale = R.numberLocaleFor(s.country);
    return s;
  }

  function fresh() {
    return {
      version: 2,
      plan: 'free',
      settings: withRegion({ ...DEFAULT_SETTINGS }),
      counters: { quote: 0, invoice: 0 },
      usage: {},
      jobs: [],
      lists: [], // standalone to-do lists
      teamAddon: false, // Teams add-on bought
      team: T.emptyTeam(),
      onboarded: false,
    };
  }

  /** Older saves: PINs → accounts. Anyone without a password gets an invite code to set one. */
  function migrateTeam(team) {
    if (!Array.isArray(team.roles) || !team.roles.length) team.roles = T.defaultRoles();
    if (!team.roles.some((r) => r.id === 'owner')) team.roles.unshift(T.defaultRoles()[0]);
    (team.members || []).forEach((m) => {
      delete m.pin;
      if (m.login === undefined) m.login = T.normalizeLogin(m.contact);
      if (!m.passHash && m.roleId !== 'owner' && !m.inviteCode) m.inviteCode = T.inviteCode();
    });
    return team;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return {
          ...fresh(),
          ...s,
          settings: withRegion({ ...DEFAULT_SETTINGS, ...(s.settings || {}) }),
          counters: { quote: 0, invoice: 0, ...(s.counters || {}) },
          team: migrateTeam({ ...T.emptyTeam(), ...(s.team || {}) }),
        };
      }
    } catch (e) { /* storage blocked or corrupt — start fresh */ }
    return fresh();
  }

  let state = load();
  const listeners = [];

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      listeners.forEach((fn) => fn('save-error', e));
      return false;
    }
  }

  function monthKey(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function usageThisMonth() {
    const u = state.usage[monthKey()] || { quotes: 0, invoices: 0 };
    return { quotes: u.quotes || 0, invoices: u.invoices || 0, total: (u.quotes || 0) + (u.invoices || 0) };
  }

  function isPro() { return state.plan === 'pro'; }

  function docsLeft() {
    if (isPro()) return Infinity;
    return Math.max(0, FREE_DOC_LIMIT - usageThisMonth().total);
  }

  function recordUsage(kind) {
    const k = monthKey();
    state.usage[k] = state.usage[k] || { quotes: 0, invoices: 0 };
    state.usage[k][kind === 'quote' ? 'quotes' : 'invoices'] += 1;
  }

  function nextNumber(kind) {
    state.counters[kind] = (state.counters[kind] || 0) + 1;
    const prefix = kind === 'quote' ? state.settings.quotePrefix : state.settings.invoicePrefix;
    return prefix + String(state.counters[kind]).padStart(4, '0');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function getJob(id) { return state.jobs.find((j) => j.id === id); }

  function addJob(job) {
    job.id = job.id || uid();
    job.createdAt = job.createdAt || new Date().toISOString();
    state.jobs.unshift(job);
    save();
    return job;
  }

  function getList(id) { return (state.lists || []).find((l) => l.id === id); }
  function addList(list) {
    state.lists = state.lists || [];
    list.id = list.id || uid();
    list.createdAt = list.createdAt || new Date().toISOString();
    state.lists.unshift(list);
    save();
    return list;
  }
  function deleteList(id) {
    state.lists = (state.lists || []).filter((l) => l.id !== id);
    save();
  }

  function deleteJob(id) {
    state.jobs = state.jobs.filter((j) => j.id !== id);
    save();
  }

  function replaceAll(next) {
    state = { ...fresh(), ...next, settings: withRegion({ ...DEFAULT_SETTINGS, ...(next.settings || {}) }) };
    save();
  }

  /** Re-read from storage (another tab changed something, e.g. sent a chat message). */
  function reload() { state = load(); }

  /* ---- signed-in account (per tab; "keep me signed in" remembers it on this device) ---- */
  let memSession = null;
  // A new tab starts as the remembered person, then keeps its own sign-in
  // (so another tab logging in as someone else doesn't change who this tab is).
  try {
    if (!sessionStorage.getItem(SESSION_KEY) && localStorage.getItem(REMEMBER_KEY)) sessionStorage.setItem(SESSION_KEY, localStorage.getItem(REMEMBER_KEY));
  } catch (e) { /* private mode */ }
  try { memSession = sessionStorage.getItem(SESSION_KEY) || (localStorage.getItem(REMEMBER_KEY) || null); } catch (e) { /* ignore */ }
  function sessionId() {
    try { return sessionStorage.getItem(SESSION_KEY) || memSession; }
    catch (e) { return memSession; }
  }
  function signIn(id, remember) {
    memSession = id;
    try {
      sessionStorage.setItem(SESSION_KEY, id);
      if (remember) localStorage.setItem(REMEMBER_KEY, id); else if (localStorage.getItem(REMEMBER_KEY) !== id) localStorage.removeItem(REMEMBER_KEY);
    } catch (e) { /* private mode: memory only */ }
  }
  function signOut() {
    const id = sessionId();
    memSession = null;
    try {
      sessionStorage.removeItem(SESSION_KEY);
      if (localStorage.getItem(REMEMBER_KEY) === id) localStorage.removeItem(REMEMBER_KEY);
    } catch (e) { /* ignore */ }
  }
  /** The signed-in account, or null (then the app shows sign-in / sign-up). */
  function account() {
    const id = sessionId();
    if (!id) return null;
    const m = T.member(state.team, id);
    if (!m || !m.passHash) return null;
    // other people can only sign in while the Teams add-on is on
    if (m.roleId !== 'owner' && !(state.teamAddon && state.team.enabled)) return null;
    return m;
  }
  /** The team member whose permissions apply (only when Teams is on). */
  function currentUser() {
    const t = state.team;
    if (!t || !t.enabled) return null;
    return account();
  }

  function reset() {
    state = fresh();
    save();
  }

  root.QSStore = {
    get state() { return state; },
    FREE_DOC_LIMIT,
    PRO_PRICE,
    withRegion,
    DEFAULT_SETTINGS,
    save,
    isPro,
    docsLeft,
    usageThisMonth,
    recordUsage,
    nextNumber,
    uid,
    getJob,
    addJob,
    getList,
    addList,
    deleteList,
    deleteJob,
    replaceAll,
    reset,
    reload,
    currentUser,
    account,
    signIn,
    signOut,
    KEY,
    monthKey,
    on(fn) { listeners.push(fn); },
  };
})(typeof self !== 'undefined' ? self : this);
