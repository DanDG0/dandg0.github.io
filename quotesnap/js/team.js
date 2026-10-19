/*
 * QuoteSnap Teams — members, roles, permissions, chat data and regional pricing.
 * Pure logic, no DOM. Works in the browser (window.QSTeam) and in Node (require).
 *
 * Today the whole team lives on one device (see README → Teams). The data shapes here are
 * what a backend would store, so moving to real multi-device accounts is a storage swap.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QSTeam = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Pricing: base $3/month, priced locally so it's fair everywhere
   * ------------------------------------------------------------------ */

  // Local monthly price per currency (roughly purchasing-power adjusted, rounded to friendly numbers).
  const TEAM_PRICES = {
    USD: 3, EUR: 3, GBP: 3, CHF: 3, CAD: 4, AUD: 5, NZD: 5, SGD: 4, HKD: 25, JPY: 450, KRW: 3900, TWD: 69, ILS: 11,
    AED: 11, SAR: 11, QAR: 11, KWD: 1, BHD: 1, OMR: 1, SEK: 35, NOK: 35, DKK: 22, ISK: 420,
    PLN: 10, CZK: 49, HUF: 790, RON: 10, RSD: 249, TRY: 69, UAH: 69, GEL: 5, AMD: 790, AZN: 3, KZT: 790, UZS: 19900,
    ZAR: 39, NAD: 39, BWP: 25, BRL: 12, MXN: 39, ARS: 1999, CLP: 1990, COP: 7900, PEN: 7.9, UYU: 79, PYG: 9900, BOB: 12,
    CRC: 990, GTQ: 15, HNL: 49, NIO: 69, DOP: 119, JMD: 299, TTD: 15, BSD: 3, BBD: 6, FJD: 5,
    CNY: 15, MYR: 9.9, THB: 69, PHP: 99, IDR: 24900, VND: 39000, INR: 99, PKR: 399, BDT: 199, LKR: 599, NPR: 299,
    NGN: 1500, GHS: 19, KES: 149, UGX: 4900, TZS: 3900, RWF: 1900, ETB: 99, ZMW: 39, MWK: 1990, MZN: 99,
    XOF: 990, XAF: 990, MUR: 99, EGP: 79, MAD: 19, DZD: 299, TND: 6, JOD: 2, LBP: 99000,
  };
  const BASE = { amount: 3, currency: 'USD' };

  /** Teams price for a currency: { amount, currency, local: true/false } */
  function teamPrice(currencyCode) {
    if (currencyCode && TEAM_PRICES[currencyCode] != null) return { amount: TEAM_PRICES[currencyCode], currency: currencyCode, local: true };
    return { ...BASE, local: false };
  }

  /* ------------------------------------------------------------------ *
   * Permissions & roles
   * ------------------------------------------------------------------ */

  const PERMS = [
    { key: 'paste', label: 'Paste & make', desc: 'Turn chats and notes into drafts and to-dos' },
    { key: 'jobs', label: 'Jobs', desc: 'See jobs and job checklists', levels: [['none', 'No access'], ['assigned', 'Only jobs assigned to them'], ['all', 'All jobs']] },
    { key: 'todos', label: 'To-do lists', desc: 'Team to-do lists' },
    { key: 'quotes', label: 'Quotes & prices', desc: 'Create, see and send quotes. Without this, prices are hidden' },
    { key: 'invoices', label: 'Invoices & payments', desc: 'Invoices, mark as paid, money totals' },
    { key: 'reminders', label: 'Payment reminders', desc: 'Chase customers for payment' },
    { key: 'customers', label: 'Customer history', desc: 'Every customer and what they owe' },
    { key: 'chat', label: 'Team chat', desc: 'Can be added to chats' },
    { key: 'settings', label: 'Business settings', desc: 'Business details, branding, country' },
    { key: 'team', label: 'Manage team', desc: 'People, roles, chats and billing' },
  ];

  const ALL = { paste: true, jobs: 'all', todos: true, quotes: true, invoices: true, reminders: true, customers: true, chat: true, settings: true, team: true };

  function defaultRoles() {
    return [
      { id: 'owner', name: 'Owner', locked: true, color: '#16201a', perms: { ...ALL } },
      { id: 'manager', name: 'Manager', color: '#1f6f4a', perms: { ...ALL } },
      { id: 'finance', name: 'Finance', color: '#2a5aa0', perms: { paste: true, jobs: 'all', todos: true, quotes: true, invoices: true, reminders: true, customers: true, chat: true, settings: false, team: false } },
      { id: 'sales', name: 'Sales', color: '#8a5a00', perms: { paste: true, jobs: 'all', todos: true, quotes: true, invoices: false, reminders: false, customers: true, chat: true, settings: false, team: false } },
      { id: 'field', name: 'Field staff', color: '#b4400f', perms: { paste: false, jobs: 'assigned', todos: true, quotes: false, invoices: false, reminders: false, customers: false, chat: true, settings: false, team: false } },
    ];
  }

  const COLORS = ['#1f6f4a', '#2a5aa0', '#b4400f', '#8a5a00', '#7a3fa0', '#0f7d7d', '#a0306a', '#4a5a20'];

  function emptyTeam() {
    return { enabled: false, members: [], roles: defaultRoles(), channels: [], messages: [], lastRead: {} };
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /** Turn Teams on: the business owner becomes the first member. */
  function enable(team, ownerName) {
    team.enabled = true;
    if (!team.roles || !team.roles.length) team.roles = defaultRoles();
    if (!team.members.some((m) => m.roleId === 'owner')) {
      team.members.unshift({ id: 'owner', name: ownerName || 'Owner', contact: '', login: '', roleId: 'owner', color: COLORS[0], createdAt: new Date().toISOString() });
    }
    if (!team.channels.length) {
      team.channels.push({ id: uid(), name: 'Everyone', memberIds: team.members.map((m) => m.id), everyone: true, createdBy: 'owner', createdAt: new Date().toISOString() });
    }
    return team;
  }

  function addMember(team, { name, contact, roleId }) {
    const m = { id: uid(), name: name.trim(), contact: (contact || '').trim(), login: normalizeLogin(contact), roleId: roleId || 'field', color: COLORS[team.members.length % COLORS.length], createdAt: new Date().toISOString(), passHash: null, inviteCode: inviteCode() };
    team.members.push(m);
    // "Everyone" chats grow automatically (only people whose role allows chat can read them)
    team.channels.forEach((c) => { if (c.everyone && !c.memberIds.includes(m.id)) c.memberIds.push(m.id); });
    return m;
  }

  function removeMember(team, id) {
    const m = team.members.find((x) => x.id === id);
    if (!m || m.roleId === 'owner') return false;
    team.members = team.members.filter((x) => x.id !== id);
    team.channels.forEach((c) => { c.memberIds = c.memberIds.filter((x) => x !== id); });
    return true;
  }

  function roleOf(team, member) {
    if (!member) return null;
    return (team.roles || []).find((r) => r.id === member.roleId) || (team.roles || []).find((r) => r.id === 'field') || null;
  }

  function member(team, id) { return (team.members || []).find((m) => m.id === id) || null; }

  /**
   * Can this person use a feature? With Teams off (a one-person business) everything is allowed.
   * perm 'prices' = can see money at all (quotes or invoices).
   */
  function can(team, user, perm) {
    if (!team || !team.enabled) return true;
    if (user && user.roleId === 'owner') return true; // the owner can always do everything
    const role = roleOf(team, user);
    if (!role) return false;
    const p = role.perms || {};
    if (perm === 'prices') return !!(p.quotes || p.invoices);
    if (perm === 'jobs') return p.jobs === 'all' || p.jobs === 'assigned';
    return !!p[perm];
  }

  function jobsScope(team, user) {
    if (!team || !team.enabled) return 'all';
    if (user && user.roleId === 'owner') return 'all';
    const role = roleOf(team, user);
    if (!role) return 'none';
    if (role.id === 'owner') return 'all';
    return (role.perms && role.perms.jobs) || 'none';
  }

  function canSeeJob(team, user, job) {
    const scope = jobsScope(team, user);
    if (scope === 'all') return true;
    if (scope === 'assigned') return !!job && job.assignee === (user && user.id);
    return false;
  }

  function addRole(team, name) {
    const r = { id: uid(), name: name.trim() || 'New role', color: COLORS[team.roles.length % COLORS.length], perms: { paste: true, jobs: 'assigned', todos: true, quotes: false, invoices: false, reminders: false, customers: false, chat: true, settings: false, team: false } };
    team.roles.push(r);
    return r;
  }

  function removeRole(team, id) {
    const r = team.roles.find((x) => x.id === id);
    if (!r || r.locked) return false;
    if (team.members.some((m) => m.roleId === id)) return false; // reassign people first
    team.roles = team.roles.filter((x) => x.id !== id);
    return true;
  }

  /** There must always be someone who can manage the team. */
  function wouldLockOut(team, changes) {
    const roles = team.roles.map((r) => (changes.roleId === r.id ? { ...r, perms: { ...r.perms, ...changes.perms } } : r));
    const members = team.members.map((m) => (changes.memberId === m.id ? { ...m, roleId: changes.newRoleId } : m));
    return !members.some((m) => {
      const r = roles.find((x) => x.id === m.roleId);
      return r && (r.id === 'owner' || r.perms.team);
    });
  }

  /* ------------------------------------------------------------------ *
   * Chat
   * ------------------------------------------------------------------ */

  function addChannel(team, { name, memberIds, createdBy }) {
    const ids = Array.from(new Set([...(memberIds || []), createdBy].filter(Boolean)));
    const c = { id: uid(), name: (name || '').trim(), memberIds: ids, everyone: false, createdBy, createdAt: new Date().toISOString() };
    team.channels.push(c);
    return c;
  }

  /** Chats this person can open: they're a member and their role allows chat. */
  function channelsFor(team, user) {
    if (!team || !team.enabled || !user) return [];
    if (!can(team, user, 'chat')) return [];
    return team.channels.filter((c) => c.memberIds.includes(user.id));
  }

  function channelTitle(team, channel, user) {
    if (channel.name) return channel.name;
    const others = channel.memberIds.filter((id) => id !== (user && user.id)).map((id) => (member(team, id) || {}).name).filter(Boolean);
    return others.length ? others.join(', ') : 'Just you';
  }

  function postMessage(team, { channelId, from, text, jobId }) {
    const c = team.channels.find((x) => x.id === channelId);
    const sender = member(team, from);
    if (!c || !sender || !c.memberIds.includes(from) || !can(team, sender, 'chat')) return null;
    const msg = { id: uid(), channelId, from, text: String(text || '').slice(0, 4000), jobId: jobId || null, at: new Date().toISOString() };
    if (!msg.text.trim() && !msg.jobId) return null;
    team.messages.push(msg);
    markRead(team, from, channelId, msg.at);
    return msg;
  }

  function messagesIn(team, channelId) {
    return team.messages.filter((m) => m.channelId === channelId).sort((a, b) => a.at.localeCompare(b.at));
  }

  function markRead(team, userId, channelId, at) {
    team.lastRead = team.lastRead || {};
    team.lastRead[userId] = team.lastRead[userId] || {};
    team.lastRead[userId][channelId] = at || new Date().toISOString();
  }

  function unreadCount(team, user, channelId) {
    if (!user) return 0;
    const seen = ((team.lastRead || {})[user.id] || {})[channelId] || '';
    return team.messages.filter((m) => m.channelId === channelId && m.from !== user.id && m.at > seen).length;
  }

  function totalUnread(team, user) {
    return channelsFor(team, user).reduce((n, c) => n + unreadCount(team, user, c.id), 0);
  }

  /* ------------------------------------------------------------------ *
   * Accounts: passwords, sign-in names, invite codes, recovery
   * ------------------------------------------------------------------ */

  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L mix-ups
  function randomCode(len) {
    const out = [];
    const bytes = new Uint8Array(len);
    try { (globalThis.crypto || {}).getRandomValues(bytes); } catch (e) { for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256); }
    for (let i = 0; i < len; i++) out.push(CODE_CHARS[bytes[i] % CODE_CHARS.length]);
    return out.join('');
  }
  function inviteCode() { return randomCode(6); }
  function recoveryCode() { const c = randomCode(16); return c.match(/.{4}/g).join('-'); }

  /** Email (lower-case) or phone number (digits, keeping a leading +). */
  function normalizeLogin(s) {
    const v = String(s || '').trim();
    if (!v) return '';
    if (v.includes('@')) return v.toLowerCase();
    const digits = v.replace(/[^\d+]/g, '');
    return digits.replace(/(?!^)\+/g, '');
  }

  function findByLogin(team, login) {
    const key = normalizeLogin(login);
    if (!key) return null;
    const members = team.members || [];
    const exact = members.find((m) => m.login && m.login === key);
    if (exact || key.includes('@')) return exact || null;
    // phones: "082 555 1234" and "+27 82 555 1234" are the same person → compare the last 9 digits
    const tail = key.replace(/\D/g, '').slice(-9);
    if (tail.length < 9) return null;
    return members.find((m) => m.login && !m.login.includes('@') && m.login.replace(/\D/g, '').slice(-9) === tail) || null;
  }

  function findByInvite(team, code) {
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length < 6) return null;
    return (team.members || []).find((m) => m.inviteCode && m.inviteCode === c && !m.passHash) || null;
  }

  function passwordProblem(pw) {
    if (!pw || pw.length < 8) return 'Use at least 8 characters.';
    if (/^\d+$/.test(pw)) return 'Use some letters too, not only numbers.';
    if (/^(password|12345678|qwerty|quotesnap)/i.test(pw)) return 'That password is too easy to guess.';
    return '';
  }

  /* ---- hashing: PBKDF2-SHA256 via WebCrypto, with a pure-JS fallback ---- */

  function hex(buf) { return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''); }
  function utf8(s) { return new TextEncoder().encode(s); }

  // Compact SHA-256 (for browsers that block WebCrypto on file:// pages)
  function sha256(bytes) {
    const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
    const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const l = bytes.length, bitLen = l * 8;
    const padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
    padded.set(bytes); padded[l] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 4, bitLen >>> 0); dv.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
    const W = new Uint32Array(64);
    const r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < padded.length; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32); const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
    return out;
  }

  const ITER = 120000;
  const FALLBACK_ITER = 20000;

  async function hashSecret(secret, salt, algo) {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if ((algo || 'pbkdf2') === 'pbkdf2' && subtle) {
      const key = await subtle.importKey('raw', utf8(secret), 'PBKDF2', false, ['deriveBits']);
      const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: utf8(salt), iterations: ITER }, key, 256);
      return { algo: 'pbkdf2', hash: hex(bits) };
    }
    // fallback: iterated salted SHA-256
    let h = sha256(utf8(salt + ':' + secret));
    for (let i = 0; i < FALLBACK_ITER; i++) { const buf = new Uint8Array(h.length + salt.length); buf.set(h); buf.set(utf8(salt), h.length); h = sha256(buf); }
    return { algo: 'sha256x', hash: hex(h) };
  }

  /** Store a new password on a member (never the password itself). */
  async function setPassword(m, password) {
    m.salt = randomCode(16);
    const r = await hashSecret(password, m.salt);
    m.passHash = r.hash; m.passAlgo = r.algo;
    m.inviteCode = null;
    m.joinedAt = m.joinedAt || new Date().toISOString();
    return m;
  }

  async function checkPassword(m, password) {
    if (!m || !m.passHash || !m.salt) return false;
    const r = await hashSecret(password, m.salt, m.passAlgo);
    return r.hash === m.passHash;
  }

  async function setRecovery(m) {
    const code = recoveryCode();
    m.recSalt = randomCode(12);
    const r = await hashSecret(code.replace(/-/g, ''), m.recSalt);
    m.recHash = r.hash; m.recAlgo = r.algo;
    return code; // shown once
  }

  async function checkRecovery(m, code) {
    if (!m || !m.recHash) return false;
    const r = await hashSecret(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), m.recSalt, m.recAlgo);
    return r.hash === m.recHash;
  }

  /** Manager resets someone's password: they get a fresh invite code to choose a new one. */
  function resetPassword(m) {
    m.passHash = null; m.salt = null; m.passAlgo = null;
    m.inviteCode = inviteCode();
    return m.inviteCode;
  }

  // too many wrong passwords → short pause (per member, in memory)
  const fails = {};
  function lockedFor(id) { const f = fails[id]; return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; }
  function noteFailure(id) {
    const f = fails[id] || (fails[id] = { n: 0, until: 0 });
    f.n += 1;
    if (f.n >= 5) { f.until = Date.now() + 30000 * Math.min(4, f.n - 4); }
  }
  function noteSuccess(id) { delete fails[id]; }

  function ownerAccount(team) { return (team.members || []).find((m) => m.roleId === 'owner') || null; }
  function hasOwnerAccount(team) { const o = ownerAccount(team); return !!(o && o.passHash); }

  /** Only someone who manages the team may change roles, and never their own. */
  function canChangeRole(team, actor, target) {
    if (!actor || !target) return false;
    if (target.roleId === 'owner') return false;
    if (actor.id === target.id) return false;
    return can(team, actor, 'team');
  }

  /** Profiles (name, sign-in, role, password reset) are for managers only. */
  function canOpenProfile(team, actor) {
    if (!actor) return false;
    if (actor.roleId === 'owner') return true;
    return !!(team && team.enabled && can(team, actor, 'team'));
  }

  return {
    TEAM_PRICES, teamPrice, PERMS, defaultRoles, emptyTeam, enable, addMember, removeMember, roleOf, member,
    can, jobsScope, canSeeJob, addRole, removeRole, wouldLockOut,
    addChannel, channelsFor, channelTitle, postMessage, messagesIn, markRead, unreadCount, totalUnread, uid, COLORS,
    inviteCode, normalizeLogin, findByLogin, findByInvite, passwordProblem, setPassword, checkPassword, setRecovery, checkRecovery,
    resetPassword, lockedFor, noteFailure, noteSuccess, ownerAccount, hasOwnerAccount, canChangeRole, canOpenProfile, sha256, hashSecret,
  };
});
