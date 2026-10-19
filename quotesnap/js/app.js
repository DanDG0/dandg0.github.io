/*
 * QuoteSnap app — hash-routed single page app. No build step, no server.
 */
(function () {
  'use strict';

  const E = window.QSEngine;
  const S = window.QSStore;
  const SAMPLES = window.QSSamples.SAMPLES;
  const R = window.QSRegions;
  const view = document.getElementById('view');
  const DEFAULT_BRAND = '#1f6f4a';

  /* ================================================================ *
   * Helpers
   * ================================================================ */

  const settings = () => S.state.settings;
  const CFG = window.QS_CONFIG || {};
  const BETA = !!CFG.beta;
  function contactHref(subject) { return CFG.contactEmail ? `mailto:${CFG.contactEmail}?subject=${encodeURIComponent(subject || 'QuoteSnap feedback')}` : ''; }
  const T = window.QSTeam;

  /* ---- Teams: who is signed in and what they may do ---- */
  const team = () => S.state.team;
  const teamOn = () => !!(S.state.teamAddon && S.state.team && S.state.team.enabled);
  const me = () => (teamOn() ? S.currentUser() : null);
  /** Can the signed-in person use this feature? Always yes for a one-person business. */
  function can(perm) { return teamOn() ? T.can(team(), me(), perm) : true; }
  function seeJob(job) { return teamOn() ? T.canSeeJob(team(), me(), job) : true; }
  function visibleJobs() { return S.state.jobs.filter(seeJob); }
  function memberName(id) { const m = teamOn() && T.member(team(), id); return m ? m.name : ''; }
  function avatarHTML(m, size) {
    if (!m) return '';
    const initials = (m.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return `<span class="avatar ${size || ''}" style="background:${m.color || '#1f6f4a'};color:#fff" aria-hidden="true">${esc(initials)}</span>`;
  }
  function roleBadge(m) {
    const r = T.roleOf(team(), m);
    return r ? `<span class="role-badge" style="--rc:${esc(r.color || '#16201a')}">${esc(r.name)}</span>` : '';
  }
  /** A local price as people expect to see it: $3, €3, R39, ₹99 (no ".00" on whole amounts). */
  function priceLabel(amount, code) {
    try {
      const whole = Number.isInteger(amount);
      return new Intl.NumberFormat(settings().numberLocale || 'en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(amount);
    } catch (e) { return `${code} ${amount}`; }
  }
  function teamPriceLabel() { const p = T.teamPrice(settings().currencyCode); return priceLabel(p.amount, p.currency); }
  const isPro = () => S.isPro();

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Format money in the job's currency (or a given ISO code), in the user's local number style. */
  function money(n, jobOrCode) {
    const code = typeof jobOrCode === 'string' ? jobOrCode : (jobOrCode && jobOrCode.currencyCode) || settings().currencyCode;
    return E.formatMoney(n, code, settings().numberLocale);
  }
  /** Add up job amounts per currency: "$1,200.00 + €300.00". */
  function moneySum(jobs, amountOf) {
    const by = {};
    jobs.forEach((j) => { const c = j.currencyCode || settings().currencyCode; by[c] = (by[c] || 0) + amountOf(j); });
    const keys = Object.keys(by);
    if (!keys.length) return money(0);
    return keys.map((c) => money(by[c], c)).join(' + ');
  }
  function fmtTime(t) { return t ? E.formatTime(t, settings().locale) : ''; }
  function currencySym(code) { return E.currencySymbol(code || settings().currencyCode, settings().numberLocale); }
  /** Parse a number typed in any style: 1,200.50 · 1.200,50 · 12,5 */
  function num(v) { const n = E.parseAmount(v); return isNaN(n) ? 0 : n; }

  function todayISO() { return E.isoDate(new Date()); }
  function addDaysISO(iso, n) {
    const d = new Date((iso || todayISO()) + 'T00:00:00');
    d.setDate(d.getDate() + Number(n || 0));
    return E.isoDate(d);
  }
  function fmtDate(iso, opts) { return E.formatDate(iso, settings().locale, opts); }
  function daysBetween(aISO, bISO) {
    const a = new Date(aISO + 'T00:00:00'), b = new Date(bISO + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }
  function relDay(iso) {
    const diff = daysBetween(todayISO(), iso);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    if (diff > 1) return `in ${diff} days`;
    return `${-diff} days ago`;
  }

  /** Any local or international number → digits for wa.me (country code first, no +). */
  function normalisePhone(phone) {
    let d = String(phone || '').replace(/[^\d+]/g, '');
    if (!d) return '';
    if (d.startsWith('+')) return d.slice(1);
    if (d.startsWith('00')) return d.slice(2);
    const cc = String(settings().countryCode || '').replace(/\D/g, '');
    if (!cc) return d;
    // already has the country code (e.g. 4479… or 15551234567)
    if (d.startsWith(cc) && d.length >= 11) return d;
    // Italy keeps its leading 0; everywhere else the 0 is a local trunk prefix
    if (d.startsWith('0') && settings().country !== 'IT') d = d.slice(1);
    return cc + d;
  }
  function waLink(phone, text) {
    const p = normalisePhone(phone);
    return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) { /* ignore */ }
      ta.remove();
    }
    toast('Copied to clipboard');
  }

  let toastTimer;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function modal(html) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.id = 'modal';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="modal-x" data-action="close-modal" aria-label="Close">×</button>${html}</div>`;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeModal(); });
    document.body.appendChild(wrap);
    const focusable = wrap.querySelector('button.btn, a.btn, input');
    if (focusable) focusable.focus();
  }
  function closeModal() { const m = document.getElementById('modal'); if (m) m.remove(); }

  const UPSELL = {
    limit: { icon: '📄', title: "You've used your 5 free documents this month", body: 'Pro gives you unlimited quotes and invoices, so you never have to wait for next month to send a quote.' },
    branding: { icon: '🎨', title: 'Put your own brand on every document', body: 'Add your logo and brand colour, and remove the “Made with QuoteSnap” footer.' },
    customers: { icon: '👥', title: 'Remember every customer', body: 'See every job, quote and payment per customer, and who still owes you.' },
    reminders: { icon: '⏰', title: 'Let QuoteSnap chase payments for you', body: 'Pro schedules reminders before and after the due date, nudges you when one is due and writes the message. You just tap send.' },
  };
  function upsell(kind) {
    const u = UPSELL[kind] || UPSELL.limit;
    if (teamOn() && !can('team')) {
      modal(`<div class="upsell"><div class="upsell-icon">${u.icon}</div><h3>${esc(u.title)}</h3><p>${esc(u.body)}</p><p class="muted">Ask your manager to turn this on for the team.</p><button class="btn btn-primary btn-block" data-action="close-modal">OK</button></div>`);
      return;
    }
    modal(`
      <div class="upsell">
        <div class="upsell-icon">${u.icon}</div>
        <h3>${esc(u.title)}</h3>
        <p>${esc(u.body)}</p>
        <ul class="ticks">
          <li>Unlimited quotes &amp; invoices</li>
          <li>Your logo &amp; brand colour</li>
          <li>Customer history</li>
          <li>Automatic payment reminders</li>
        </ul>
        <a class="btn btn-primary btn-block" href="#/upgrade" data-action="close-modal">See Pro: ${S.PRO_PRICE.label}/month</a>
        <button class="btn btn-ghost btn-block" data-action="close-modal">Maybe later</button>
      </div>`);
  }

  function lockBadge() { return '<span class="pro-badge" title="Pro feature">PRO</span>'; }

  function tradeLabel(key) {
    return (E.TRADES[key] && E.TRADES[key].label) || 'General';
  }

  const STATUS = {
    draft: { label: 'Draft', cls: 'st-draft' },
    quoted: { label: 'Quote sent', cls: 'st-quoted' },
    invoiced: { label: 'Awaiting payment', cls: 'st-invoiced' },
    paid: { label: 'Paid', cls: 'st-paid' },
  };
  function statusPill(job) {
    let st = STATUS[job.status] || STATUS.draft;
    if (job.status === 'invoiced' && job.invoice && job.invoice.dueDate < todayISO()) st = { label: 'Overdue', cls: 'st-overdue' };
    return `<span class="pill ${st.cls}">${st.label}</span>`;
  }

  /* ================================================================ *
   * Job model
   * ================================================================ */

  function jobFromChat(raw, ownerOverride) {
    const s = settings();
    const parsed = E.parseChat(raw, {
      owner: ownerOverride,
      ownerHints: [s.businessName, s.ownerName],
      currencyCode: s.currencyCode,
      currencySymbol: currencySym(s.currencyCode),
      dateOrder: s.dateOrder,
    });
    // the chat may be in another currency (e.g. a freelancer billing a client abroad)
    let currencyCode = s.currencyCode;
    const det = parsed.currency;
    if (det && !E.currencyMatches(det, s.currencyCode, s.numberLocale) && /^[A-Z]{3}$/.test(det)) {
      currencyCode = det;
      parsed.warnings.push(`Prices in this chat look like ${det}, so this job uses ${det}. Change it under Line items if that's wrong.`);
    }
    const job = {
      chat: raw,
      senders: parsed.senders,
      owner: parsed.owner,
      messages: parsed.messages,
      warnings: parsed.warnings,
      detectedCurrency: parsed.currency,
      currencyCode,
      customer: parsed.customer,
      items: parsed.items.length ? parsed.items : [{ desc: '', qty: 1, unit: '', price: 0 }],
      trade: parsed.trade,
      jobDate: parsed.jobDate,
      jobTime: parsed.jobTime,
      requests: parsed.requests,
      notes: '',
      deposit: parsed.deposit,
      taxRate: Number(s.taxRate) || 0,
      status: 'draft',
      quote: null,
      invoice: null,
      reminders: [],
      checklist: [],
    };
    job.checklist = E.buildChecklist(job, s);
    return job;
  }

  function reparse(job, owner) {
    const fresh = jobFromChat(job.chat, owner);
    ['senders', 'owner', 'messages', 'warnings', 'customer', 'items', 'trade', 'jobDate', 'jobTime', 'requests', 'deposit', 'checklist', 'detectedCurrency', 'currencyCode'].forEach((k) => { job[k] = fresh[k]; });
  }

  function customerKey(c) {
    const p = normalisePhone(c && c.phone);
    if (p) return 'p:' + p;
    const n = ((c && c.name) || '').trim().toLowerCase();
    return n ? 'n:' + n : '';
  }

  function scheduleReminders(job) {
    if (!job.invoice) return;
    const due = job.invoice.dueDate;
    const plan = [
      { offset: -2, tone: 'friendly', label: '2 days before due' },
      { offset: 0, tone: 'friendly', label: 'On the due date' },
      { offset: 3, tone: 'firm', label: '3 days overdue' },
      { offset: 7, tone: 'final', label: '1 week overdue' },
    ];
    const existing = job.reminders || [];
    job.reminders = plan.map((p) => {
      const date = addDaysISO(due, p.offset);
      const prev = existing.find((r) => r.label === p.label);
      return { id: prev ? prev.id : S.uid(), date, tone: p.tone, label: p.label, sentAt: prev ? prev.sentAt : null, notified: prev ? prev.notified : false };
    });
  }

  function reminderState(job, r) {
    if (job.status === 'paid') return 'cancelled';
    if (r.sentAt) return 'sent';
    if (r.date <= todayISO()) return 'due';
    return 'upcoming';
  }

  function allReminders() {
    const out = [];
    visibleJobs().forEach((job) => {
      if (!job.invoice) return;
      (job.reminders || []).forEach((r) => out.push({ job, r, state: reminderState(job, r) }));
    });
    return out.sort((a, b) => a.r.date.localeCompare(b.r.date));
  }

  function dueReminderCount() {
    if (!isPro()) return 0;
    return allReminders().filter((x) => x.state === 'due').length;
  }

  function reminderText(job, tone) {
    const s = settings();
    return E.reminderMessage(job, s, tone, {
      invoiceNumber: job.invoice && job.invoice.number,
      quoteNumber: job.quote && job.quote.number,
      dueHuman: job.invoice ? fmtDate(job.invoice.dueDate, { day: 'numeric', month: 'long' }) : '',
    });
  }

  /* ================================================================ *
   * Shell (nav, plan badge)
   * ================================================================ */

  function renderShell(route) {
    const usage = S.usageThisMonth();
    const badge = document.getElementById('plan-chip');
    if (badge) {
      badge.innerHTML = isPro()
        ? '<span class="plan pro">Pro</span><span class="plan-sub">Unlimited</span>'
        : `<span class="plan">Free</span><span class="plan-sub">${usage.total}/${S.FREE_DOC_LIMIT} docs this month</span>`;
    }
    const navPerm = { home: null, new: 'paste', jobs: 'jobs', todos: 'todos', customers: 'customers', reminders: 'reminders', settings: 'settings', upgrade: 'team', team: 'team', chat: 'chat' };
    document.querySelectorAll('[data-nav]').forEach((a) => {
      const perm = navPerm[a.dataset.nav];
      let show = !perm || can(perm);
      if (a.dataset.nav === 'chat') show = teamOn() && can('chat');
      a.hidden = !show;
    });
    document.querySelectorAll('.nav-cta').forEach((b) => { b.hidden = !can('paste'); });
    const chip = document.getElementById('user-chip');
    const acc = account();
    if (chip) {
      chip.hidden = !acc;
      chip.dataset.action = 'account-menu';
      if (acc) chip.innerHTML = `${avatarHTML(acc)}<span class="uc-text"><b>${esc(acc.name)}</b>${teamOn() ? roleBadge(acc) : '<span class="muted small">Account</span>'}</span><span class="uc-switch">${teamOn() ? 'Switch' : '⋯'}</span>`;
    }
    const mchip = document.getElementById('plan-chip-m');
    if (mchip) mchip.innerHTML = acc ? `${avatarHTML(acc, 'sm')} ☰` : '☰ Menu';
    const unread = teamOn() ? T.totalUnread(team(), me()) : 0;
    document.querySelectorAll('[data-badge="chat"]').forEach((b) => { b.textContent = unread; b.hidden = !unread; });
    renderBottomNav(route);
    document.querySelectorAll('[data-nav]').forEach((a) => {
      const active = a.dataset.nav === route || (a.dataset.nav === 'jobs' && route === 'job');
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const due = can('reminders') ? dueReminderCount() : 0;
    document.querySelectorAll('[data-badge="reminders"]').forEach((b) => {
      b.textContent = due;
      b.hidden = !due;
    });
  }

  /** Phone bottom bar: the 5 most useful places this person can open. */
  function renderBottomNav() {
    const nav = document.querySelector('.bottom-nav');
    if (!nav) return;
    const items = [
      ['home', '#/', '🏠', 'Home', null],
      ['jobs', '#/jobs', '📋', 'Jobs', 'jobs'],
      ['new', '#/new', '⚡', 'Paste', 'paste'],
      ['todos', '#/todos', '✅', 'To-dos', 'todos'],
      ['chat', '#/chat', '💬', 'Chat', 'chat'],
      ['settings', '#/settings', '⚙️', 'Settings', 'settings'],
      ['team', '#/team', '👥', 'Team', 'team'],
    ].filter(([key, , , , perm]) => (key === 'chat' ? teamOn() && can('chat') : !perm || can(perm))).slice(0, 5);
    const html = items.map(([key, href, ico, label]) => `<a href="${href}" data-nav="${key}" class="${key === 'new' ? 'snap' : ''}"><span class="ico" aria-hidden="true">${ico}</span>${label}${key === 'home' ? '<span class="badge" data-badge="reminders" hidden></span>' : ''}${key === 'chat' ? '<span class="badge" data-badge="chat" hidden></span>' : ''}</a>`).join('');
    if (nav.dataset.sig !== html) { nav.innerHTML = html; nav.dataset.sig = html; }
    nav.style.gridTemplateColumns = `repeat(${items.length}, 1fr)`;
  }

  function pageNoAccess(what) {
    return `<div class="empty big no-access">
      <div class="empty-art" aria-hidden="true">🔒</div>
      <h1>You don't have access to ${esc(what)}</h1>
      <p class="muted">Your role${me() ? ` (${esc((T.roleOf(team(), me()) || {}).name || '')})` : ''} doesn't include this. Ask your manager if you need it.</p>
      <a class="btn" href="#/">Back to Home</a>
    </div>`;
  }

  /* ================================================================ *
   * Pages
   * ================================================================ */

  function pageDashboard() {
    const s = settings();
    const jobs = visibleJobs();
    const usage = S.usageThisMonth();
    const outstanding = moneySum(jobs.filter((j) => j.status === 'invoiced'), (j) => E.totals(j).total);
    const overdue = jobs.filter((j) => j.status === 'invoiced' && j.invoice.dueDate < todayISO());
    const awaiting = jobs.filter((j) => j.status === 'quoted');
    const month = S.monthKey();
    const paidMonth = moneySum(jobs.filter((j) => j.status === 'paid' && j.invoice && j.invoice.paidAt && j.invoice.paidAt.slice(0, 7) === month), (j) => E.totals(j).total);
    const upcoming = jobs.filter((j) => j.jobDate && j.jobDate >= todayISO() && j.status !== 'paid')
      .sort((a, b) => (a.jobDate + a.jobTime).localeCompare(b.jobDate + b.jobTime)).slice(0, 4);
    const dueRem = isPro() ? allReminders().filter((x) => x.state === 'due') : [];
    const pct = Math.min(100, (usage.total / S.FREE_DOC_LIMIT) * 100);

    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    return `
      <div class="page-head">
        <div>
          <p class="eyebrow">${greet}${me() ? ', ' + esc(me().name.split(' ')[0]) : s.ownerName ? ', ' + esc(s.ownerName.split(' ')[0]) : ''}</p>
          <h1>${s.businessName ? esc(s.businessName) : 'Your business, sorted.'}</h1>
        </div>
        ${can('paste') ? '<a class="btn btn-primary btn-lg" href="#/new"><span aria-hidden="true">⚡</span> Paste &amp; make</a>' : ''}
      </div>

      ${!s.businessName && can('settings') ? `
        <div class="card setup-card">
          <div>
            <h3>Set up your business details (2 minutes)</h3>
            <p class="muted">Your name, number and payment details go on every quote and invoice. We've set you up for <b>${esc(R.countryName(s.country))}</b> (${esc(s.currencyCode)}); change it any time.</p>
          </div>
          <a class="btn" href="#/settings">Set up now →</a>
        </div>` : ''}

      ${backupReminderHTML()}

      ${!can('paste') ? '' : `<section class="card quick-paste">
        <div class="qp-text">
          <h2>Paste anything</h2>
          <p class="muted small">A chat, your notes, an email… then choose a to-do list, quote, invoice or reminder.</p>
        </div>
        <textarea id="quick-paste" rows="2" placeholder="e.g. “Need to call Sarah tomorrow, buy paint, and invoice John for the fence repair”" aria-label="Paste text"></textarea>
        <button class="btn btn-primary" data-action="quick-paste">Continue →</button>
      </section>`}

      ${statsHTML([can('invoices') ? `<a class="stat" href="#/jobs?f=invoiced">
          <span class="stat-label">Waiting to be paid</span>
          <span class="stat-value">${outstanding}</span>
          <span class="stat-foot ${overdue.length ? 'warn' : ''}">${overdue.length ? `${overdue.length} overdue` : 'Nothing overdue 👌'}</span>
        </a>` : '', can('quotes') ? `<a class="stat" href="#/jobs?f=quoted">
          <span class="stat-label">Quotes awaiting reply</span>
          <span class="stat-value">${awaiting.length}</span>
          <span class="stat-foot">${awaiting.length ? 'Follow up to win them' : 'All caught up'}</span>
        </a>` : '', can('invoices') ? `<div class="stat">
          <span class="stat-label">Paid this month</span>
          <span class="stat-value">${paidMonth}</span>
          <span class="stat-foot">${fmtDate(todayISO(), { month: 'long', year: 'numeric' })}</span>
        </div>` : '', can('team') ? `<div class="stat">
          <span class="stat-label">Documents this month</span>
          ${isPro()
            ? `<span class="stat-value">${usage.total}</span><span class="stat-foot">Unlimited on Pro ✨</span>`
            : `<span class="stat-value">${usage.total}<small>/${S.FREE_DOC_LIMIT}</small></span>
               <span class="meter" aria-hidden="true"><span style="width:${pct}%"></span></span>
               <span class="stat-foot">${S.docsLeft()} left · <a href="#/upgrade">go unlimited</a></span>`}
        </div>` : ''])}

      ${pairCards([can('jobs') ? `<section class="card">
          <div class="card-head"><h2>${teamOn() && T.jobsScope(team(), me()) === 'assigned' ? 'Your upcoming jobs' : 'Coming up'}</h2><a href="#/jobs" class="link">All jobs</a></div>
          ${upcoming.length ? `<ul class="list">${upcoming.map((j) => `
            <li><a href="#/job/${j.id}/checklist" class="row">
              <span class="date-chip"><b>${fmtDate(j.jobDate, { day: 'numeric' })}</b>${fmtDate(j.jobDate, { month: 'short' })}</span>
              <span class="row-main"><b>${esc(j.customer.name || 'Customer')}</b><span class="muted">${esc(tradeLabel(j.trade))}${j.jobTime ? ' · ' + fmtTime(j.jobTime) : ''} · ${checklistProgress(j)}</span></span>
              ${statusPill(j)}
            </a></li>`).join('')}</ul>`
            : `<div class="empty"><p>No upcoming jobs.</p><p class="muted">${teamOn() && T.jobsScope(team(), me()) === 'assigned' ? 'Jobs your manager assigns to you show up here.' : 'Paste a WhatsApp chat and QuoteSnap will pick up the date.'}</p></div>`}
        </section>` : '', can('reminders') ? `<section class="card">
          <div class="card-head"><h2>Payment reminders</h2><a href="#/reminders" class="link">Open</a></div>
          ${isPro()
            ? (dueRem.length ? `<ul class="list">${dueRem.slice(0, 4).map(({ job, r }) => `
                <li class="row">
                  <span class="row-main"><b>${esc(job.customer.name || 'Customer')}</b><span class="muted">${esc(r.label)} · ${money(E.totals(job).total, job)}</span></span>
                  <a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="${esc(waLink(job.customer.phone, reminderText(job, r.tone)))}" data-action="mark-reminder-sent" data-job="${job.id}" data-rem="${r.id}">Send</a>
                </li>`).join('')}</ul>`
              : `<div class="empty"><p>No reminders due today.</p><p class="muted">They're scheduled automatically when you issue an invoice.</p></div>`)
            : `<div class="locked-mini">
                 <p><b>Stop chasing payments by hand.</b> Pro schedules polite reminders and tells you when to send each one.</p>
                 <button class="btn btn-sm" data-action="upsell" data-kind="reminders">Unlock with Pro</button>
               </div>`}
        </section>` : '', teamOn() && can('chat') ? chatCardHTML() : ''])}

      ${can('todos') ? todoCardHTML() : ''}

      ${!can('jobs') ? '' : `<section class="card">
        <div class="card-head"><h2>${teamOn() && T.jobsScope(team(), me()) === 'assigned' ? 'Your jobs' : 'Recent jobs'}</h2><a href="#/jobs" class="link">See all</a></div>
        ${jobs.length ? jobTable(jobs.slice(0, 5)) : `
          <div class="empty big">
            <div class="empty-art" aria-hidden="true">💬 → 📄</div>
            <p><b>No jobs yet.</b> ${can('paste') ? 'Start with a chat, or try one of ours.' : ''}</p>
            ${can('paste') ? '<a class="btn btn-primary" href="#/new">Paste your first chat</a>' : ''}
          </div>`}
      </section>`}`;
  }

  /** Data only lives on this device: nudge the owner to download a backup every 2 weeks. */
  function backupReminderHTML() {
    if (!can('settings')) return '';
    const hasData = S.state.jobs.length + (S.state.lists || []).length >= 3;
    if (!hasData) return '';
    const last = S.state.lastBackupAt;
    if (last && daysBetween(last.slice(0, 10), todayISO()) < 14) return '';
    const snoozed = S.state.backupSnoozeUntil && S.state.backupSnoozeUntil > todayISO();
    if (snoozed) return '';
    return `<section class="card backup-card">
      <div><b>💾 Back up your work</b><p class="muted small">${last ? `Last backup ${esc(relDay(last.slice(0, 10)))}.` : "You haven't made a backup yet."} During the beta your data lives only in this browser, so clearing it would erase your jobs.</p></div>
      <div class="doc-actions" style="margin:0"><button class="btn btn-primary btn-sm" data-action="export">Download backup</button><button class="btn btn-ghost btn-sm" data-action="snooze-backup">Later</button></div>
    </section>`;
  }

  function statsHTML(cards) {
    const c = cards.filter(Boolean);
    return c.length ? `<div class="stats" style="--cols:${c.length}">${c.join('')}</div>` : '';
  }
  function pairCards(cards) {
    const c = cards.filter(Boolean);
    if (!c.length) return '';
    let out = '';
    for (let i = 0; i < c.length; i += 2) out += c[i + 1] ? `<div class="grid-2">${c[i]}${c[i + 1]}</div>` : c[i];
    return out;
  }
  function chatCardHTML() {
    const chans = T.channelsFor(team(), me());
    const latest = team().messages.filter((m) => chans.some((c) => c.id === m.channelId)).slice(-3).reverse();
    const unread = T.totalUnread(team(), me());
    return `<section class="card">
      <div class="card-head"><h2>Team chat ${unread ? `<small class="count">${unread}</small>` : ''}</h2><a href="#/chat" class="link">Open</a></div>
      ${latest.length ? `<ul class="list">${latest.map((m) => { const who = T.member(team(), m.from); const c = chans.find((x) => x.id === m.channelId); return `<li><a class="row" href="#/chat/${c.id}">${avatarHTML(who, 'sm')}<span class="row-main"><b>${esc(who ? who.name : 'Someone')} · <span class="muted">${esc(T.channelTitle(team(), c, me()))}</span></b><span class="muted">${esc(m.text || (m.jobId ? '📋 Shared a job' : ''))}</span></span></a></li>`; }).join('')}</ul>`
        : `<div class="empty"><p>${chans.length ? 'No messages yet.' : "You're not in any chats yet."}</p></div>`}
    </section>`;
  }

  function todoCardHTML() {
    const lists = S.state.lists || [];
    const open = [];
    lists.forEach((l) => (l.items || []).forEach((i, idx) => { if (!i.done && i.text) open.push({ l, i, idx }); }));
    open.sort((a, b) => (b.i.urgent - a.i.urgent) || (a.i.due || '9999').localeCompare(b.i.due || '9999'));
    return `
      <section class="card">
        <div class="card-head"><h2>To-do</h2><a href="#/todos" class="link">All lists${lists.length ? ` (${lists.length})` : ''}</a></div>
        ${open.length ? `<ul class="checklist dash-todos">${open.slice(0, 5).map(({ l, i, idx }) => `
          <li>
            <label class="cbox"><input type="checkbox" data-dash-check="${l.id}:${idx}" aria-label="Done"><span aria-hidden="true"></span></label>
            <a class="row-main" href="#/todo/${l.id}"><b>${i.urgent ? '❗ ' : ''}${esc(i.text)}</b><span class="muted">${esc(l.title || 'To-do list')}${i.due ? ` · <span class="due ${dueClass(i)}">${esc(dueLabel(i))}</span>` : ''}</span></a>
          </li>`).join('')}</ul>${open.length > 5 ? `<p class="muted small">+ ${open.length - 5} more</p>` : ''}`
          : `<div class="empty"><p>Nothing to do. 🙌</p>${can('paste') ? '<p class="muted">Paste notes or a chat above and choose “To-do list”.</p>' : '<p class="muted"><a href="#/todos">Start a to-do list</a></p>'}</div>`}
      </section>`;
  }

  function checklistProgress(job) {
    const list = job.checklist || [];
    if (!list.length) return 'no checklist';
    const done = list.filter((c) => c.done).length;
    return `${done}/${list.length} tasks done`;
  }

  function jobTable(jobs) {
    return `<ul class="list">${jobs.map((j) => {
      const t = E.totals(j);
      const doc = j.invoice ? j.invoice.number : j.quote ? j.quote.number : 'Not issued';
      return `<li><a class="row" href="#/job/${j.id}">
        <span class="avatar" aria-hidden="true">${esc((j.customer.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>
        <span class="row-main"><b>${esc(j.customer.name || j.customer.phone || 'Unnamed customer')}</b><span class="muted">${esc(tradeLabel(j.trade))} · ${esc(doc)} · ${fmtDate(j.createdAt.slice(0, 10))}</span></span>
        ${teamOn() && j.assignee && T.member(team(), j.assignee) ? avatarHTML(T.member(team(), j.assignee), 'sm') : ''}
        ${can('prices') ? `<span class="row-amt">${money(t.total, j)}</span>` : ''}
        ${statusPill(j)}
      </a></li>`;
    }).join('')}</ul>`;
  }

  /* ---------------- New snap ---------------- */

  function pageNew() {
    const short = (n) => money(window.QSSamples.nicePrice(n, settings().currencyCode)).replace(/[.,]00(?=\D*$)/, '');
    return `
      <div class="page-head">
        <div>
          <p class="eyebrow">Paste anything</p>
          <h1>What have you got?</h1>
          <p class="muted lead">A WhatsApp chat, an email, your notes or a quick list. Paste it and pick what to make: a to-do list, a quote, an invoice or a payment reminder.</p>
        </div>
      </div>

      <div class="snap-grid">
        <div class="snap-main">
        <section class="card snap-card">
          <label for="chat-input" class="sr-only">Text to turn into documents</label>
          <textarea id="chat-input" class="chat-input" placeholder="${esc(chatPlaceholder())}" spellcheck="false">${esc(pendingPaste || '')}</textarea>
          <div class="snap-actions">
            <label class="btn btn-ghost file-btn">
              <input type="file" accept=".txt,text/plain" data-action="upload-chat" hidden>
              📎 Upload a .txt (e.g. exported chat)
            </label>
            <button class="btn btn-ghost btn-sm" data-action="clear-paste">Clear</button>
          </div>
          <div class="samples">
            <span class="muted">Nothing handy? Try one:</span>
            ${Object.entries(SAMPLES).map(([k, v]) => `<button class="chip" data-action="sample" data-key="${k}">${esc(v.label)}</button>`).join('')}
          </div>
        </section>

        <section class="make" aria-live="polite">
          <h2>What do you want to make?</h2>
          <div id="make-options" class="make-grid">${makeOptionsHTML(null)}</div>
        </section>
        </div>

        <aside class="card tips">
          <h3>Works with</h3>
          <ul class="tips-list">
            <li>💬 <b>WhatsApp chats:</b> long-press messages → <i>Copy</i>, or <i>Export chat → Without media</i> and upload the .txt.</li>
            <li>📝 <b>Notes &amp; lists:</b> bullet points, “need to…”, “don't forget…”. Dates like <i>tomorrow</i> or <i>Friday</i> become due dates.</li>
            <li>✉️ <b>Emails &amp; texts:</b> prices like <code>Labour ${esc(short(65))}/hr</code> or <code>24 cupcakes ${esc(short(3.5))} each</code> become line items.</li>
            <li>💸 <b>“You still owe me…”</b> turns into a polite payment reminder.</li>
          </ul>
          <p class="muted small">🔒 Your text never leaves this device. QuoteSnap reads it right here in your browser.</p>
          ${!isPro() ? `<p class="small">To-do lists are always free. You have <b>${S.docsLeft()}</b> free quotes/invoices left this month (only <i>issuing</i> one uses it up).</p>` : ''}
        </aside>
      </div>`;
  }

  /* ---------------- Reading pasted text & offering outputs ---------------- */

  let pendingPaste = '';
  let lastAnalysis = null;

  function parseOptions() {
    const s = settings();
    return {
      ownerHints: [s.businessName, s.ownerName],
      currencyCode: s.currencyCode,
      currencySymbol: currencySym(s.currencyCode),
      dateOrder: s.dateOrder,
    };
  }

  function analyse(text) {
    text = (text || '').trim();
    if (!text) return null;
    const parsed = E.parseChat(text, parseOptions());
    const tasks = E.extractTasks(text, parseOptions());
    const pseudo = { items: parsed.items, deposit: parsed.deposit, taxRate: settings().taxRate, currencyCode: settings().currencyCode };
    const t = E.totals(pseudo);
    const owed = /\b(owe[sd]?|owing|outstanding|unpaid|overdue|haven'?t paid|still due|pay me|balance (?:of|due|is))\b/i.test(text);
    const hasMoney = parsed.items.length > 0 && t.total > 0;
    const who = parsed.customer.name || parsed.customer.phone || '';
    // mostly tasks with the odd price in passing (e.g. notes) → a to-do list
    const taskHeavy = tasks.length >= 3 && tasks.length >= parsed.items.length * 2;
    let rec = 'todo';
    if (owed && hasMoney) rec = 'reminder';
    else if (taskHeavy && !parsed.customerSender) rec = 'todo';
    else if (hasMoney && who) rec = 'all';
    else if (hasMoney) rec = 'quote';
    return { text, parsed, tasks, total: t.total, hasMoney, owed, who, rec, pseudo };
  }

  function makeOptionsHTML(a) {
    const empty = !a;
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const docDetail = a && a.hasMoney
      ? `${a.who ? esc(a.who) + ' · ' : ''}${plural(a.parsed.items.length, 'item')} · ${esc(money(a.total, a.pseudo))}`
      : 'No prices spotted. You can add them next.';
    const opts = [
      { key: 'todo', icon: '✅', title: 'To-do list', detail: a ? (a.tasks.length ? `${plural(a.tasks.length, 'task')} found${a.tasks.some((x) => x.due) ? ', with due dates' : ''}` : 'Turn each line into a task') : 'Tasks, with due dates' },
      { key: 'quote', icon: '📝', title: 'Quote', detail: a ? docDetail : 'Prices become line items' },
      { key: 'invoice', icon: '🧾', title: 'Invoice', detail: a ? docDetail : 'Ready to send for payment' },
      { key: 'reminder', icon: '⏰', title: 'Payment reminder', detail: a ? (a.hasMoney ? `Ask ${a.who ? esc(a.who.split(' ')[0]) : 'them'} for ${esc(money(a.total, a.pseudo))}, politely` : 'A polite “please pay” message') : 'Friendly, firm or final' },
      { key: 'all', icon: '⚡', title: 'Everything', detail: 'Quote, invoice, job checklist and reminder in one job' },
    ];
    const need = { todo: ['todos'], quote: ['quotes'], invoice: ['invoices'], reminder: ['reminders'], all: ['quotes', 'invoices'] };
    return opts.map((o) => ({ ...o, locked: !need[o.key].every((p) => can(p)) })).map((o) => `
      <button class="make-card ${a && a.rec === o.key && !o.locked ? 'rec' : ''} ${o.locked ? 'locked-card' : ''}" data-action="make" data-kind="${o.key}" ${empty || o.locked ? 'disabled' : ''} ${o.locked ? 'title="Not included in your role"' : ''}>
        ${o.locked ? '<span class="rec-tag lock-tag">🔒 Not in your role</span>' : ''}
        ${a && a.rec === o.key ? '<span class="rec-tag">Suggested</span>' : ''}
        <span class="make-icon" aria-hidden="true">${o.icon}</span>
        <span class="make-title">${o.title}</span>
        <span class="make-detail">${o.detail}</span>
      </button>`).join('') + (empty ? '<p class="muted small make-hint">Paste or type something above and the options light up.</p>' : '');
  }

  let analyseTimer;
  function refreshMakeOptions(immediate) {
    clearTimeout(analyseTimer);
    const run = () => {
      const ta = document.getElementById('chat-input');
      const box = document.getElementById('make-options');
      if (!ta || !box) return;
      lastAnalysis = analyse(ta.value);
      box.innerHTML = makeOptionsHTML(lastAnalysis);
    };
    if (immediate) run(); else analyseTimer = setTimeout(run, 250);
  }

  function make(kind) {
    const ta = document.getElementById('chat-input');
    const text = (ta ? ta.value : pendingPaste || '').trim();
    if (!text) { toast('Paste something first'); return; }
    pendingPaste = '';
    if (kind === 'todo') {
      const a = lastAnalysis && lastAnalysis.text === text ? lastAnalysis : analyse(text);
      const items = a.tasks.map((t) => ({ id: S.uid(), text: t.text, due: t.due, time: t.time, urgent: t.urgent, done: t.done }));
      const list = S.addList({ title: E.suggestTitle(text, a.tasks, ''), source: text, items: items.length ? items : [{ id: S.uid(), text: '', due: '', time: '', urgent: false, done: false }] });
      location.hash = `#/todo/${list.id}`;
      return;
    }
    const job = jobFromChat(text);
    job.purpose = kind;
    if (teamOn() && me()) {
      job.createdBy = me().id;
      if (T.jobsScope(team(), me()) === 'assigned') job.assignee = me().id;
    }
    if (kind === 'reminder') job._tone = 'friendly';
    S.addJob(job);
    const tab = { quote: 'quote', invoice: 'invoice', reminder: 'reminder', all: 'quote' }[kind] || 'quote';
    location.hash = `#/job/${job.id}/${tab}`;
  }

  /* ---------------- To-do lists ---------------- */

  function listProgress(l) {
    const items = l.items || [];
    const done = items.filter((i) => i.done).length;
    return { done, total: items.length, pct: items.length ? Math.round((done / items.length) * 100) : 0 };
  }

  function dueLabel(item) {
    if (!item.due) return '';
    const d = daysBetween(todayISO(), item.due);
    const txt = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : fmtDate(item.due, { weekday: 'short', day: 'numeric', month: 'short' });
    return `${txt}${item.time ? ' · ' + fmtTime(item.time) : ''}`;
  }
  function dueClass(item) {
    if (!item.due || item.done) return '';
    const d = daysBetween(todayISO(), item.due);
    return d < 0 ? 'late' : d === 0 ? 'today' : '';
  }

  function pageTodos() {
    const lists = S.state.lists || [];
    return `
      <div class="page-head">
        <div><h1>To-do lists</h1><p class="muted">Made from your notes, chats and lists. Always free.</p></div>
        <div class="head-actions">
          <button class="btn" data-action="new-empty-list">+ Blank list</button>
          <a class="btn btn-primary" href="#/new">⚡ Paste to make one</a>
        </div>
      </div>
      ${lists.length ? `<div class="list-grid">${lists.map((l) => {
        const p = listProgress(l);
        const next = (l.items || []).filter((i) => !i.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 3);
        return `<a class="card list-card" href="#/todo/${l.id}">
          <div class="card-head"><h2>${esc(l.title || 'To-do list')}</h2><span class="muted small">${p.done}/${p.total}</span></div>
          <span class="meter" aria-hidden="true"><span style="width:${p.pct}%"></span></span>
          <ul class="mini-tasks">${next.map((i) => `<li>${i.urgent ? '❗ ' : ''}${esc(i.text || 'Untitled task')}${i.due ? ` <span class="due ${dueClass(i)}">${esc(dueLabel(i))}</span>` : ''}</li>`).join('') || '<li class="muted">All done 🎉</li>'}</ul>
        </a>`;
      }).join('')}</div>`
        : `<section class="card"><div class="empty big"><div class="empty-art" aria-hidden="true">📝 → ✅</div><p><b>No to-do lists yet.</b> Paste your notes or a chat and pick “To-do list”.</p><a class="btn btn-primary" href="#/new">Paste something</a></div></section>`}`;
  }

  function todoText(l) {
    const line = (i) => `${i.done ? '☑' : '☐'} ${i.text}${i.due ? ` (${dueLabel(i)})` : ''}${i.urgent ? ' ❗' : ''}`;
    return `*${l.title || 'To-do list'}*\n` + (l.items || []).filter((i) => i.text).map(line).join('\n');
  }

  function pageTodo(id) {
    const l = S.getList(id);
    if (!l) return `<div class="empty big"><p>That list doesn't exist anymore.</p><a class="btn" href="#/todos">Back to to-dos</a></div>`;
    const p = listProgress(l);
    const rows = (items) => items.map(({ i, idx }) => `
      <li class="${i.done ? 'done' : ''} ${i.urgent ? 'urgent' : ''}">
        <label class="cbox"><input type="checkbox" data-todo-check="${idx}" ${i.done ? 'checked' : ''} aria-label="Done"><span aria-hidden="true"></span></label>
        <textarea class="cl-text" rows="1" data-todo-text="${idx}" aria-label="Task" placeholder="Task">${esc(i.text)}</textarea>
        <span class="todo-meta">
          ${i.due ? `<span class="due ${dueClass(i)}">${esc(dueLabel(i))}</span>` : ''}
          <label class="date-pick" title="Due date"><span aria-hidden="true">📅</span><input type="date" value="${esc(i.due || '')}" data-todo-due="${idx}" aria-label="Due date"></label>
          <button class="icon-btn flag ${i.urgent ? 'on' : ''}" data-action="todo-urgent" data-i="${idx}" aria-pressed="${!!i.urgent}" aria-label="Mark urgent" title="Urgent">!</button>
          <button class="icon-btn" data-action="todo-remove" data-i="${idx}" aria-label="Remove task">×</button>
        </span>
      </li>`).join('');
    const withIdx = (l.items || []).map((i, idx) => ({ i, idx }));
    const open = withIdx.filter((x) => !x.i.done).sort((a, b) => (b.i.urgent - a.i.urgent) || (a.i.due || '9999').localeCompare(b.i.due || '9999'));
    const done = withIdx.filter((x) => x.i.done);
    return `
      <div class="job-head">
        <a href="#/todos" class="back">← To-dos</a>
        <div class="job-title"><input class="title-input" data-todo-title value="${esc(l.title || '')}" placeholder="List name" aria-label="List name"></div>
        <button class="btn btn-ghost btn-sm danger" data-action="todo-delete-list" data-id="${l.id}">Delete</button>
      </div>
      <div class="doc-actions">
        <div class="progress" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p.pct}%"></span><b>${p.done}/${p.total} done</b></div>
        <a class="btn btn-wa" id="todo-share" target="_blank" rel="noopener" href="${esc(waLink('', todoText(l)))}">Share on WhatsApp</a>
        <button class="btn btn-ghost" data-action="todo-copy">Copy</button>
        <button class="btn btn-ghost" data-action="print">Print</button>
      </div>
      <div class="paper-wrap">
        <article class="doc checklist-doc" style="--brand:${esc(brandColor())}">
          <header class="cl-head"><p class="eyebrow">To-do list · ${fmtDate(l.createdAt.slice(0, 10))}</p><h2>${esc(l.title || 'To-do list')}</h2></header>
          <form class="todo-add" data-action-submit="todo-add">
            <input id="todo-new" placeholder="Add a task, e.g. “call Sarah tomorrow at 3pm”" aria-label="New task" autocomplete="off">
            <button class="btn btn-primary btn-sm" type="submit">Add</button>
          </form>
          <section class="cl-group"><h3>To do · ${open.length}</h3><ul class="checklist todo-list">${rows(open) || '<li class="muted empty-row">Nothing left. Nice work! 🎉</li>'}</ul></section>
          ${done.length ? `<section class="cl-group"><h3>Done · ${done.length}</h3><ul class="checklist todo-list">${rows(done)}</ul></section>` : ''}
        </article>
      </div>
      ${l.source ? `<details class="card fold source"><summary><h2>Original text</h2><span class="muted">What this list was made from</span></summary><pre class="source-text">${esc(l.source)}</pre>
        <div class="doc-actions"><button class="btn btn-ghost btn-sm" data-action="todo-to-job">Make a quote / invoice from this text instead</button></div></details>` : ''}`;
  }

  function currentList() { return current.todoId ? S.getList(current.todoId) : null; }
  function redrawTodo() {
    const y = window.scrollY;
    const focusIdx = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.todoText : undefined;
    view.innerHTML = pageTodo(current.todoId);
    window.scrollTo(0, y);
    if (focusIdx !== undefined) { const el = view.querySelector(`[data-todo-text="${focusIdx}"]`); if (el) el.focus(); }
  }


  function phonePlaceholder() {
    const cc = settings().countryCode;
    return cc ? `+${cc} …` : '+1 555 123 4567';
  }

  function chatPlaceholder() {
    const st = settings();
    const lines = window.QSSamples.sampleText('plumber', { currencyCode: st.currencyCode, numberLocale: st.numberLocale, dateOrder: st.dateOrder }).split('\n');
    return [lines[0], lines[3], lines[4], '…'].join('\n');
  }

  /* ---------------- Job ---------------- */

  /** Tabs on a job, filtered by what the signed-in person may see. */
  function jobTabs() {
    return [['quote', 'Quote', '📝', 'quotes'], ['invoice', 'Invoice', '🧾', 'invoices'], ['checklist', 'Checklist', '✅', 'jobs'], ['reminder', 'Reminder', '⏰', 'reminders']]
      .filter((t) => can(t[3]));
  }

  function assignHTML(job) {
    if (!teamOn()) return '';
    const canAssign = T.jobsScope(team(), me()) === 'all';
    const who = T.member(team(), job.assignee);
    if (!canAssign) return who ? `<span class="assignee">${avatarHTML(who, 'sm')} ${esc(who.name)}</span>` : '';
    return `<label class="assign-pick">Assigned to
      <select data-action-change="assign">
        <option value="">Nobody yet</option>
        ${team().members.map((m) => `<option value="${m.id}" ${m.id === job.assignee ? 'selected' : ''}>${esc(m.name)} · ${esc((T.roleOf(team(), m) || {}).name || '')}</option>`).join('')}
      </select></label>`;
  }

  function pageJob(id, tab) {
    const job = S.getJob(id);
    if (!job) return `<div class="empty big"><p>That job doesn't exist anymore.</p><a class="btn" href="#/jobs">Back to jobs</a></div>`;
    tab = tab || 'quote';
    return `
      <div class="job-head">
        <a href="#/jobs" class="back">← Jobs</a>
        <div class="job-title">
          <h1>${esc(job.customer.name || 'New job')}</h1>
          ${statusPill(job)}
        </div>
        ${assignHTML(job)}
        <a class="btn btn-sm jump" href="#panel" data-action="jump">Documents ↓</a>
        ${!teamOn() || T.jobsScope(team(), me()) === 'all' ? `<button class="btn btn-ghost btn-sm danger" data-action="delete-job" data-id="${job.id}">Delete</button>` : ''}
      </div>

      ${(job.warnings || []).length ? `<div class="notice">${job.warnings.map((w) => `<p>⚠️ ${esc(w)}</p>`).join('')}</div>` : ''}

      <div class="job-grid">
        <section class="editor" id="editor">${editorHTML(job)}</section>
        <section class="output">
          <nav class="tabs" role="tablist" aria-label="Documents">
            ${jobTabs()
              .map(([k, label, icon]) => `<a role="tab" aria-selected="${k === tab}" class="tab ${k === tab ? 'active' : ''}" href="#/job/${job.id}/${k}"><span aria-hidden="true">${icon}</span> ${label}</a>`).join('')}
          </nav>
          <div id="panel" data-tab="${tab}">${panelHTML(job, tab)}</div>
        </section>
      </div>`;
  }

  function editorHTML(job) {
    const t = E.totals(job);
    const s = settings();
    const tradeOptions = Object.entries(E.TRADES).map(([k, v]) => `<option value="${k}" ${job.trade === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')
      + `<option value="general" ${job.trade === 'general' ? 'selected' : ''}>General</option>`;
    return `
      <details class="card fold" ${job.quote ? '' : 'open'}>
        <summary><h2>Customer</h2><span class="muted">${esc([job.customer.name, job.customer.phone].filter(Boolean).join(' · ') || 'Add details')}</span></summary>
        <div class="form-grid">
          <label>Name<input data-bind="customer.name" value="${esc(job.customer.name)}" placeholder="Customer name" autocomplete="off"></label>
          <label>WhatsApp number<input data-bind="customer.phone" value="${esc(job.customer.phone)}" placeholder="${esc(phonePlaceholder())}" inputmode="tel" autocomplete="off"></label>
          <label>Email<input data-bind="customer.email" value="${esc(job.customer.email)}" placeholder="optional" inputmode="email" autocomplete="off"></label>
          <label>Address<input data-bind="customer.address" value="${esc(job.customer.address)}" placeholder="optional" autocomplete="off"></label>
        </div>
      </details>

      <details class="card fold" open>
        <summary><h2>Job</h2><span class="muted">${esc(tradeLabel(job.trade))}${job.jobDate ? ' · ' + fmtDate(job.jobDate) : ''}</span></summary>
        <div class="form-grid">
          <label>Type of work<select data-bind="trade">${tradeOptions}</select></label>
          <label>Date<input type="date" data-bind="jobDate" value="${esc(job.jobDate)}"></label>
          <label>Time<input type="time" data-bind="jobTime" value="${esc(job.jobTime)}"></label>
        </div>
        ${(job.requests || []).length ? `
          <div class="asked">
            <span class="muted small">What the customer asked for:</span>
            <ul>${job.requests.map((r) => `<li>“${esc(r)}”</li>`).join('')}</ul>
          </div>` : ''}
      </details>

      ${!can('prices') ? workListHTML(job) : `<section class="card">
        <div class="card-head"><h2>Line items</h2>
          <label class="cur-pick">Currency
            <select data-bind="currencyCode" aria-label="Currency for this job">
              ${R.currencies().map((c) => `<option value="${c.code}" ${c.code === (job.currencyCode || s.currencyCode) ? 'selected' : ''}>${c.code} · ${esc(c.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="items" id="items">
          <div class="items-head" aria-hidden="true"><span>Description</span><span>Qty</span><span>Price (${esc(currencySym(job.currencyCode))})</span><span>Amount</span><span></span></div>
          ${job.items.map((it, i) => `
            <div class="item-row">
              <input class="it-desc" data-item="${i}" data-field="desc" value="${esc(it.desc)}" placeholder="What you're charging for" aria-label="Description">
              <input class="it-qty" data-item="${i}" data-field="qty" value="${esc(it.qty)}" inputmode="decimal" aria-label="Quantity">
              <input class="it-price" data-item="${i}" data-field="price" value="${esc(it.price)}" inputmode="decimal" aria-label="Unit price">
              <span class="it-amt" data-amt="${i}">${money((Number(it.qty) || 0) * (Number(it.price) || 0), job)}</span>
              <button class="icon-btn" data-action="remove-item" data-i="${i}" aria-label="Remove line">×</button>
            </div>`).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" data-action="add-item">+ Add line</button>

        <div class="money-grid">
          <label>Deposit
            <span class="inline">
              <select data-bind="deposit.type">
                <option value="none" ${job.deposit.type === 'none' ? 'selected' : ''}>None</option>
                <option value="percent" ${job.deposit.type === 'percent' ? 'selected' : ''}>% of total</option>
                <option value="amount" ${job.deposit.type === 'amount' ? 'selected' : ''}>Fixed amount</option>
              </select>
              <input data-bind="deposit.value" data-type="number" value="${esc(job.deposit.value)}" inputmode="decimal" ${job.deposit.type === 'none' ? 'disabled' : ''} aria-label="Deposit value">
            </span>
          </label>
          <label>${esc(s.taxLabel || 'Tax')} %<input data-bind="taxRate" data-type="number" value="${esc(job.taxRate)}" inputmode="decimal"></label>
        </div>

        <div class="totals" id="editor-totals">${editorTotalsHTML(t, job)}</div>
      </section>`}

      <details class="card fold">
        <summary><h2>Notes on the document</h2><span class="muted">${job.notes ? 'Added' : 'Optional'}</span></summary>
        <textarea data-bind="notes" rows="3" placeholder="e.g. Includes 3-month warranty on parts. Price excludes any extra parts needed.">${esc(job.notes)}</textarea>
      </details>

      ${can('prices') ? `<details class="card fold">
        <summary><h2>Original chat</h2><span class="muted">${(job.messages || []).length} messages</span></summary>
        ${(job.senders || []).length > 1 ? `
          <label class="who">Which one is you?
            <select data-action-change="set-owner">
              ${job.senders.map((s2) => `<option ${s2 === job.owner ? 'selected' : ''}>${esc(s2)}</option>`).join('')}
            </select>
          </label>` : ''}
        <div class="chat-view">
          ${(job.messages || []).map((m) => `
            <div class="bubble ${m.sender === job.owner ? 'me' : 'them'}">
              ${m.sender ? `<b>${esc(m.sender)}</b>` : ''}${esc(m.text).replace(/\n/g, '<br>')}
            </div>`).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" data-action="reread">↻ Read the chat again</button>
      </details>` : ''}`;
  }

  /** What field staff see instead of prices: just the work. */
  function workListHTML(job) {
    return `<section class="card">
      <div class="card-head"><h2>Work to do</h2><span class="muted small">Prices are hidden for your role</span></div>
      <ul class="work-list">${job.items.filter((i) => i.desc).map((i) => `<li><b>${esc(i.desc)}</b>${Number(i.qty) !== 1 ? ` <span class="muted">× ${esc(i.qty)}${i.unit ? ' ' + esc(i.unit) : ''}</span>` : ''}</li>`).join('') || '<li class="muted">Nothing listed yet</li>'}</ul>
    </section>`;
  }

  function editorTotalsHTML(t, job) {
    return `
      <div><span>Subtotal</span><span>${money(t.subtotal, job)}</span></div>
      ${t.tax ? `<div><span>${esc(settings().taxLabel || 'Tax')} (${t.taxRate}%)</span><span>${money(t.tax, job)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${money(t.total, job)}</span></div>
      ${t.deposit ? `<div class="muted"><span>Deposit</span><span>${money(t.deposit, job)}</span></div>` : ''}`;
  }

  /* ---------------- Output panels ---------------- */

  function panelHTML(job, tab) {
    if (tab === 'invoice') return invoicePanel(job);
    if (tab === 'checklist') return checklistPanel(job);
    if (tab === 'reminder') return reminderPanel(job);
    return quotePanel(job);
  }

  function quotePanel(job) {
    const s = settings();
    const q = job.quote;
    const validHuman = q ? fmtDate(q.validUntil, { day: 'numeric', month: 'long' }) : fmtDate(addDaysISO(todayISO(), s.quoteValidDays), { day: 'numeric', month: 'long' });
    const msg = E.quoteMessage(job, s, q && q.number, validHuman);
    return `
      <div class="doc-actions">
        ${q
          ? `<span class="issued">✓ ${esc(q.number)} issued ${fmtDate(q.date)}</span>`
          : `<button class="btn btn-primary" data-action="issue-quote">Issue quote${isPro() ? '' : ` <small>(${S.docsLeft()} left)</small>`}</button>`}
        <a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(waLink(job.customer.phone, msg))}" ${q ? '' : 'data-action="needs-issue" data-kind="quote"'}>Send on WhatsApp</a>
        <button class="btn btn-ghost" data-action="print">Print / PDF</button>
        <button class="btn btn-ghost" data-action="copy" data-text="${esc(msg)}">Copy text</button>
        ${q && job.status === 'quoted' ? `<button class="btn btn-ghost" data-action="goto-invoice">Customer said yes → Invoice</button>` : ''}
      </div>
      <div class="paper-wrap">${docHTML(job, 'quote')}</div>`;
  }

  function invoicePanel(job) {
    const s = settings();
    const inv = job.invoice;
    const msg = E.invoiceMessage(job, s, inv && inv.number, inv ? fmtDate(inv.dueDate, { day: 'numeric', month: 'long' }) : '');
    return `
      <div class="doc-actions">
        ${inv
          ? `<span class="issued">✓ ${esc(inv.number)} issued ${fmtDate(inv.date)}</span>
             <label class="due-edit">Due <input type="date" value="${esc(inv.dueDate)}" data-action-change="set-due"></label>
             ${inv.paidAt
               ? `<button class="btn btn-ghost" data-action="unpay">Paid ${fmtDate(inv.paidAt.slice(0, 10))} · undo</button>`
               : `<button class="btn btn-primary" data-action="mark-paid">Mark as paid</button>`}`
          : `<button class="btn btn-primary" data-action="issue-invoice">Issue invoice${isPro() ? '' : ` <small>(${S.docsLeft()} left)</small>`}</button>`}
        <a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(waLink(job.customer.phone, msg))}" ${inv ? '' : 'data-action="needs-issue" data-kind="invoice"'}>Send on WhatsApp</a>
        <button class="btn btn-ghost" data-action="print">Print / PDF</button>
        <button class="btn btn-ghost" data-action="copy" data-text="${esc(msg)}">Copy text</button>
      </div>
      ${!s.paymentDetails ? `<div class="notice small">💡 Add your banking / payment details in <a href="#/settings">Settings</a> so they show on invoices.</div>` : ''}
      <div class="paper-wrap">${docHTML(job, 'invoice')}</div>`;
  }

  /** For people who mustn't see prices: drop amounts from a line of text. */
  function hasMoney(text) {
    E.configure({ currencyCode: settings().currencyCode, currencySymbol: currencySym(settings().currencyCode), dateOrder: settings().dateOrder });
    return E.findMoney(String(text || '')).length > 0;
  }
  function maskMoney(text) {
    E.configure({ currencyCode: settings().currencyCode, currencySymbol: currencySym(settings().currencyCode), dateOrder: settings().dateOrder });
    let out = String(text || '');
    E.findMoney(out).reverse().forEach((m) => { out = out.slice(0, m.index) + out.slice(m.index + m.length); });
    return out.replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  }

  function checklistPanel(job) {
    const list = job.checklist || [];
    const done = list.filter((c) => c.done).length;
    const pct = list.length ? Math.round((done / list.length) * 100) : 0;
    const groups = ['Before', 'On the day', 'After'];
    const asText = groups.map((g) => {
      const items = list.filter((c) => (c.group || 'Before') === g);
      return items.length ? `*${g}*\n` + items.map((c) => `${c.done ? '☑' : '☐'} ${can('prices') ? c.text : maskMoney(c.text)}`).join('\n') : '';
    }).filter(Boolean).join('\n\n');
    const header = `Job: ${job.customer.name || 'Customer'}${job.jobDate ? ' · ' + fmtDate(job.jobDate) : ''}${job.jobTime ? ' ' + fmtTime(job.jobTime) : ''}\n${job.customer.address || ''}\n\n`;
    return `
      <div class="doc-actions">
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span><b>${done}/${list.length} done</b></div>
        <button class="btn btn-ghost" data-action="regen-checklist">↻ Rebuild from job</button>
        <a class="btn btn-ghost" target="_blank" rel="noopener" href="${esc(waLink(settings().phone, header + asText))}">Send to my WhatsApp</a>
        <button class="btn btn-ghost" data-action="print">Print</button>
      </div>
      <div class="paper-wrap">
        <article class="doc checklist-doc" style="--brand:${esc(brandColor())}">
          <header class="cl-head">
            <div><p class="eyebrow">Job checklist · ${esc(tradeLabel(job.trade))}</p>
            <h2>${esc(job.customer.name || 'Customer')}</h2>
            <p class="muted">${esc([job.jobDate ? fmtDate(job.jobDate, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Date to be agreed', fmtTime(job.jobTime)].filter(Boolean).join(' at '))}${job.customer.address ? ' · ' + esc(job.customer.address) : ''}${job.customer.phone ? ' · ' + esc(job.customer.phone) : ''}</p></div>
          </header>
          ${groups.map((g) => {
            const items = list.map((c, i) => ({ c, i })).filter(({ c }) => (c.group || 'Before') === g);
            return `<section class="cl-group"><h3>${g}</h3><ul class="checklist">
              ${items.map(({ c, i }) => `
                <li class="${c.done ? 'done' : ''}">
                  <label class="cbox"><input type="checkbox" data-check="${i}" ${c.done ? 'checked' : ''}><span aria-hidden="true"></span></label>
                  ${!can('prices') && hasMoney(c.text) ? `<span class="cl-locked">${esc(maskMoney(c.text))}</span>` : `<textarea class="cl-text" rows="1" data-check-text="${i}" aria-label="Task">${esc(c.text)}</textarea>`}
                  <button class="icon-btn" data-action="remove-check" data-i="${i}" aria-label="Remove task">×</button>
                </li>`).join('')}
              <li class="cl-add"><button class="btn btn-ghost btn-sm" data-action="add-check" data-group="${g}">+ Add task</button></li>
            </ul></section>`;
          }).join('')}
        </article>
      </div>`;
  }

  function reminderPanel(job) {
    // invoiced → payment tones; made from a "you owe me" text → payment tones; otherwise follow up the quote first
    const tones = job.invoice || job.purpose === 'reminder' ? ['friendly', 'firm', 'final'] : ['followup', 'friendly', 'firm', 'final'];
    const current = tones.includes(job._tone) ? job._tone : tones[0];
    const text = job._reminderDraft && job._reminderTone === current ? job._reminderDraft : reminderText(job, current);
    const paid = job.status === 'paid';

    let schedule = '';
    if (job.invoice && !paid) {
      if (isPro()) {
        if (!job.reminders || !job.reminders.length) scheduleReminders(job);
        schedule = `
          <section class="card">
            <div class="card-head"><h3>Automatic reminders</h3><span class="pill st-paid">On</span></div>
            <p class="muted small">QuoteSnap nudges you on these days with the message ready. Tap <b>Send</b> to open WhatsApp.</p>
            <ul class="timeline">
              ${job.reminders.map((r) => {
                const st = reminderState(job, r);
                return `<li class="tl-${st}">
                  <span class="tl-dot" aria-hidden="true"></span>
                  <span class="row-main"><b>${esc(r.label)}</b><span class="muted">${fmtDate(r.date)} · ${relDay(r.date)} · ${E.REMINDER_TONES[r.tone].label}</span></span>
                  ${st === 'sent' ? `<span class="pill st-paid">Sent</span>`
                    : `<a class="btn btn-sm ${st === 'due' ? 'btn-wa' : 'btn-ghost'}" target="_blank" rel="noopener" href="${esc(waLink(job.customer.phone, reminderText(job, r.tone)))}" data-action="mark-reminder-sent" data-job="${job.id}" data-rem="${r.id}">${st === 'due' ? 'Send now' : 'Send early'}</a>`}
                </li>`;
              }).join('')}
            </ul>
          </section>`;
      } else {
        schedule = `
          <section class="card locked">
            <div class="card-head"><h3>Automatic reminders ${lockBadge()}</h3></div>
            <p class="muted">With Pro, QuoteSnap schedules four reminders (2 days before, on the day, 3 and 7 days late) and tells you when each is due.</p>
            <button class="btn" data-action="upsell" data-kind="reminders">Unlock automatic reminders</button>
          </section>`;
      }
    }

    return `
      ${paid ? `<div class="notice ok">🎉 This invoice is paid. No reminders needed.</div>` : ''}
      ${!job.invoice && job.purpose !== 'reminder' && !job.quote ? `<div class="notice small">Tip: issue an invoice and the reminder will include its number and due date${isPro() ? ', and Pro schedules the reminders for you' : ''}.</div>` : ''}
      <section class="card">
        <div class="card-head"><h3>${current === 'followup' ? 'Quote follow-up' : 'Payment reminder'}</h3>
          <div class="seg" role="radiogroup" aria-label="Tone">
            ${tones.map((t) => `<button role="radio" aria-checked="${t === current}" class="${t === current ? 'on' : ''}" data-action="tone" data-tone="${t}">${E.REMINDER_TONES[t].label}</button>`).join('')}
          </div>
        </div>
        <div class="wa-preview">
          <textarea id="reminder-text" rows="10" data-reminder-tone="${current}">${esc(text)}</textarea>
        </div>
        <div class="doc-actions">
          <a class="btn btn-wa" id="reminder-send" target="_blank" rel="noopener" href="${esc(waLink(job.customer.phone, text))}">Send on WhatsApp</a>
          <button class="btn btn-ghost" data-action="copy-reminder">Copy text</button>
          ${job._reminderDraft ? `<button class="btn btn-ghost" data-action="reset-reminder">Reset wording</button>` : ''}
        </div>
      </section>
      ${schedule}`;
  }

  function brandColor() {
    const c = settings().brandColor;
    return isPro() && /^#[0-9a-f]{6}$/i.test(c || '') ? c : DEFAULT_BRAND;
  }

  function docHTML(job, kind) {
    const s = settings();
    const t = E.totals(job);
    const pro = isPro();
    const meta = kind === 'quote' ? job.quote : job.invoice;
    const title = kind === 'quote' ? 'Quote' : 'Invoice';
    const issued = meta ? meta.date : todayISO();
    const second = kind === 'quote'
      ? ['Valid until', meta ? meta.validUntil : addDaysISO(todayISO(), s.quoteValidDays)]
      : ['Due date', meta ? meta.dueDate : addDaysISO(todayISO(), s.invoiceDueDays)];
    const c = job.customer;
    const paid = kind === 'invoice' && job.invoice && job.invoice.paidAt;
    const fromLines = [s.ownerName, s.phone, s.email, s.address].filter(Boolean).map(esc).join('<br>');
    const whenLine = [job.jobDate ? fmtDate(job.jobDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '', fmtTime(job.jobTime)].filter(Boolean).join(' at ');

    return `
      <article class="doc ${meta ? '' : 'is-draft'} ${paid ? 'is-paid' : ''}" style="--brand:${esc(brandColor())}">
        ${!meta ? '<div class="watermark" aria-hidden="true">DRAFT</div>' : ''}
        ${paid ? '<div class="stamp" aria-hidden="true">PAID</div>' : ''}
        <header class="doc-head">
          <div class="doc-from">
            ${pro && s.logo ? `<img class="doc-logo" src="${esc(s.logo)}" alt="${esc(s.businessName)} logo">` : ''}
            <div class="doc-biz">${esc(s.businessName || 'Your Business Name')}</div>
            <div class="doc-small">${fromLines || '<span class="hint">Add your details in Settings</span>'}</div>
            ${s.taxNumber ? `<div class="doc-small">${esc(s.taxLabel)} no. ${esc(s.taxNumber)}</div>` : ''}
          </div>
          <div class="doc-title">
            <h2>${title}</h2>
            <dl>
              <dt>Number</dt><dd>${esc(meta ? meta.number : 'Draft')}</dd>
              <dt>Date</dt><dd>${fmtDate(issued)}</dd>
              <dt>${second[0]}</dt><dd>${fmtDate(second[1])}</dd>
            </dl>
          </div>
        </header>

        <section class="doc-parties">
          <div>
            <h4>${kind === 'quote' ? 'Prepared for' : 'Bill to'}</h4>
            <p><b>${esc(c.name || 'Customer')}</b>${[c.phone, c.email, c.address].filter(Boolean).map((x) => '<br>' + esc(x)).join('')}</p>
          </div>
          <div>
            <h4>Job</h4>
            <p><b>${esc(tradeLabel(job.trade))}</b>${whenLine ? '<br>' + esc(whenLine) : ''}</p>
          </div>
        </section>

        <table class="doc-items">
          <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${job.items.filter((i) => i.desc || Number(i.price)).map((i) => `
              <tr><td>${esc(i.desc || 'Item')}</td><td class="num">${esc(i.qty)}${i.unit ? ' ' + esc(i.unit) : ''}</td><td class="num">${money(i.price, job)}</td><td class="num">${money((Number(i.qty) || 0) * (Number(i.price) || 0), job)}</td></tr>`).join('')
              || '<tr><td colspan="4" class="hint">Add line items on the left</td></tr>'}
          </tbody>
        </table>

        <div class="doc-totals">
          <div><span>Subtotal</span><span>${money(t.subtotal, job)}</span></div>
          ${t.tax ? `<div><span>${esc(s.taxLabel || 'Tax')} (${t.taxRate}%)</span><span>${money(t.tax, job)}</span></div>` : ''}
          <div class="grand"><span>${kind === 'invoice' ? (paid ? 'Total paid' : 'Amount due') : 'Total'}</span><span>${money(t.total, job)}</span></div>
          ${kind === 'quote' && t.deposit ? `<div class="dep"><span>Deposit to book</span><span>${money(t.deposit, job)}</span></div>` : ''}
        </div>

        ${kind === 'quote'
          ? `<section class="doc-note"><h4>To accept</h4><p>Reply “YES” on WhatsApp${t.deposit ? ` and pay the ${money(t.deposit, job)} deposit to secure your booking` : ''}. This quote is valid until ${fmtDate(second[1], { day: 'numeric', month: 'long', year: 'numeric' })}.</p></section>`
          : (s.paymentDetails ? `<section class="doc-note"><h4>How to pay</h4><p>${esc(s.paymentDetails).replace(/\n/g, '<br>')}<br><b>Reference:</b> ${esc(meta ? meta.number : 'invoice number')}</p></section>` : '')}
        ${job.notes ? `<section class="doc-note"><h4>Notes</h4><p>${esc(job.notes).replace(/\n/g, '<br>')}</p></section>` : ''}

        <footer class="doc-foot">
          <span>${esc(s.footerNote || '')}</span>
          ${!pro ? '<span class="brandmark">Made with <b>QuoteSnap</b></span>' : ''}
        </footer>
      </article>`;
  }

  /* ---------------- Jobs ---------------- */

  function pageJobs(params) {
    const f = params.get('f') || 'all';
    const q = (params.get('q') || '').toLowerCase();
    let jobs = visibleJobs();
    if (f !== 'all') jobs = jobs.filter((j) => j.status === f);
    if (q) jobs = jobs.filter((j) => JSON.stringify([j.customer, j.items, j.quote, j.invoice]).toLowerCase().includes(q));
    const counts = { all: visibleJobs().length };
    Object.keys(STATUS).forEach((k) => { counts[k] = visibleJobs().filter((j) => j.status === k).length; });
    return `
      <div class="page-head">
        <div><h1>Jobs</h1><p class="muted">Every chat you've snapped, with its documents.</p></div>
        <a class="btn btn-primary" href="#/new">⚡ New snap</a>
      </div>
      <div class="filters">
        <div class="seg">
          ${[['all', 'All'], ['draft', 'Drafts'], ['quoted', 'Quoted'], ['invoiced', 'Unpaid'], ['paid', 'Paid']]
            .map(([k, l]) => `<a class="${f === k ? 'on' : ''}" href="#/jobs?f=${k}${q ? '&q=' + encodeURIComponent(q) : ''}">${l} <small>${counts[k]}</small></a>`).join('')}
        </div>
        <input type="search" class="search" placeholder="Search customer, item, number…" value="${esc(q)}" data-action-input="search-jobs" aria-label="Search jobs">
        <a href="#/customers" class="link">Customers ${isPro() ? '' : lockBadge()}</a>
      </div>
      <section class="card">${jobs.length ? jobTable(jobs) : `<div class="empty"><p>No jobs here.</p></div>`}</section>`;
  }

  /* ---------------- Customers ---------------- */

  function customersData() {
    const map = new Map();
    visibleJobs().forEach((j) => {
      const key = customerKey(j.customer);
      if (!key) return;
      const c = map.get(key) || { name: '', phone: '', email: '', address: '', jobs: [], last: '' };
      c.name = c.name || j.customer.name; c.phone = c.phone || j.customer.phone;
      c.email = c.email || j.customer.email; c.address = c.address || j.customer.address;
      c.jobs.push(j);
      if (j.createdAt > c.last) c.last = j.createdAt;
      map.set(key, c);
    });
    const total = (j) => E.totals(j).total;
    return Array.from(map.values()).map((c) => {
      const billedJobs = c.jobs.filter((j) => j.invoice);
      const owingJobs = c.jobs.filter((j) => j.status === 'invoiced');
      const paidJobs = c.jobs.filter((j) => j.status === 'paid');
      return { ...c, billed: moneySum(billedJobs, total), owing: owingJobs.length ? moneySum(owingJobs, total) : '', paid: moneySum(paidJobs, total) };
    }).sort((a, b) => b.last.localeCompare(a.last));
  }

  function pageCustomers(params) {
    const sel = params.get('c');
    if (!isPro()) {
      return `
        <div class="page-head"><div><h1>Customers ${lockBadge()}</h1><p class="muted">Every customer's jobs, quotes and payments in one place.</p></div></div>
        <section class="card locked-preview">
          <div class="blurred" aria-hidden="true">
            ${['Sarah J.', 'Emily C.', 'Jessica M.', 'David L.'].map((n, i) => `<div class="row"><span class="avatar">${n[0]}</span><span class="row-main"><b>${n}</b><span class="muted">${3 - (i % 3)} jobs · last ${i + 2} days ago</span></span><span class="row-amt">${money(window.QSSamples.nicePrice(300 + i * 210, settings().currencyCode))}</span></div>`).join('')}
          </div>
          <div class="locked-over">
            <h3>Know your regulars</h3>
            <p>See who your best customers are, what they ordered last time, and who still owes you, all built from the jobs you already snap.</p>
            <button class="btn btn-primary" data-action="upsell" data-kind="customers">Unlock customer history</button>
          </div>
        </section>`;
    }
    const list = customersData();
    const chosen = sel ? list.find((c) => customerKey(c) === sel) : null;
    return `
      <div class="page-head"><div><h1>Customers</h1><p class="muted">${list.length} customer${list.length === 1 ? '' : 's'}, built from your jobs.</p></div></div>
      <div class="grid-2 cust-grid">
        <section class="card">
          ${list.length ? `<ul class="list">${list.map((c) => `
            <li><a class="row ${chosen && customerKey(chosen) === customerKey(c) ? 'sel' : ''}" href="#/customers?c=${encodeURIComponent(customerKey(c))}">
              <span class="avatar">${esc((c.name || '?').charAt(0).toUpperCase())}</span>
              <span class="row-main"><b>${esc(c.name || c.phone)}</b><span class="muted">${c.jobs.length} job${c.jobs.length === 1 ? '' : 's'} · last ${fmtDate(c.last.slice(0, 10))}</span></span>
              ${c.owing ? `<span class="pill st-overdue">Owes ${c.owing}</span>` : `<span class="row-amt">${c.billed}</span>`}
            </a></li>`).join('')}</ul>` : '<div class="empty"><p>Customers appear here after your first snap.</p></div>'}
        </section>
        <section class="card">
          ${chosen ? `
            <div class="cust-head">
              <span class="avatar lg">${esc((chosen.name || '?').charAt(0).toUpperCase())}</span>
              <div><h2>${esc(chosen.name || chosen.phone)}</h2><p class="muted">${esc([chosen.phone, chosen.email, chosen.address].filter(Boolean).join(' · '))}</p></div>
            </div>
            <div class="mini-stats">
              <div><span>Billed</span><b>${chosen.billed}</b></div>
              <div><span>Paid</span><b>${chosen.paid}</b></div>
              <div><span>Owing</span><b class="${chosen.owing ? 'warn' : ''}">${chosen.owing || money(0)}</b></div>
            </div>
            <div class="doc-actions">
              ${chosen.phone ? `<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${esc(waLink(chosen.phone, `Hi ${(chosen.name || '').split(' ')[0]} 👋`))}">Message on WhatsApp</a>` : ''}
            </div>
            <h3>History</h3>
            ${jobTable(chosen.jobs)}`
            : '<div class="empty"><p>Pick a customer to see their history.</p></div>'}
        </section>
      </div>`;
  }

  /* ---------------- Reminders ---------------- */

  function pageReminders() {
    const unpaid = visibleJobs().filter((j) => j.status === 'invoiced');
    const quoted = visibleJobs().filter((j) => j.status === 'quoted');
    const notifState = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;

    const manualList = (jobs, tone, label) => jobs.length ? `<ul class="list">${jobs.map((j) => `
      <li class="row">
        <span class="row-main"><b>${esc(j.customer.name || 'Customer')}</b>
          <span class="muted">${j.invoice ? `${esc(j.invoice.number)} · due ${fmtDate(j.invoice.dueDate)} (${relDay(j.invoice.dueDate)})` : `${esc(j.quote.number)} · sent ${fmtDate(j.quote.date)}`} · ${money(E.totals(j).total, j)}</span></span>
        <a class="btn btn-sm btn-ghost" href="#/job/${j.id}/reminder">Edit</a>
        <a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="${esc(waLink(j.customer.phone, reminderText(j, j.invoice && j.invoice.dueDate < todayISO() ? 'firm' : tone)))}">${label}</a>
      </li>`).join('')}</ul>` : '<div class="empty"><p>Nothing here 🎉</p></div>';

    if (!isPro()) {
      return `
        <div class="page-head"><div><h1>Reminders</h1><p class="muted">Get paid without the awkward chasing.</p></div></div>
        <section class="card locked">
          <div class="card-head"><h2>Automatic reminders ${lockBadge()}</h2></div>
          <p>Pro schedules reminders for every invoice (2 days before, on the day, 3 and 7 days late), sends you a notification when one is due, and writes the message in the right tone.</p>
          <button class="btn btn-primary" data-action="upsell" data-kind="reminders">Unlock automatic reminders</button>
        </section>
        <section class="card"><div class="card-head"><h2>Unpaid invoices</h2></div>${manualList(unpaid, 'friendly', 'Remind')}</section>
        <section class="card"><div class="card-head"><h2>Quotes awaiting reply</h2></div>${manualList(quoted, 'followup', 'Follow up')}</section>`;
    }

    const all = allReminders();
    const due = all.filter((x) => x.state === 'due');
    const upcoming = all.filter((x) => x.state === 'upcoming');
    const sent = all.filter((x) => x.state === 'sent').slice(-10).reverse();
    const row = ({ job, r, state }) => `
      <li class="row">
        <span class="row-main"><b>${esc(job.customer.name || 'Customer')} · ${money(E.totals(job).total, job)}</b>
          <span class="muted">${esc(r.label)} · ${fmtDate(r.date)} (${relDay(r.date)}) · ${E.REMINDER_TONES[r.tone].label} · ${esc(job.invoice.number)}</span></span>
        <a class="btn btn-sm btn-ghost" href="#/job/${job.id}/reminder">View</a>
        ${state === 'sent' ? `<span class="pill st-paid">Sent ${fmtDate(r.sentAt.slice(0, 10))}</span>`
          : `<a class="btn btn-sm ${state === 'due' ? 'btn-wa' : 'btn-ghost'}" target="_blank" rel="noopener" href="${esc(waLink(job.customer.phone, reminderText(job, r.tone)))}" data-action="mark-reminder-sent" data-job="${job.id}" data-rem="${r.id}">${state === 'due' ? 'Send now' : 'Send early'}</a>`}
      </li>`;

    return `
      <div class="page-head"><div><h1>Reminders</h1><p class="muted">Scheduled automatically for every unpaid invoice.</p></div>
        ${notifState === 'default' ? `<button class="btn" data-action="enable-notifications">🔔 Turn on notifications</button>`
          : notifState === 'granted' ? `<span class="pill st-paid">🔔 Notifications on</span>` : ''}
      </div>
      <section class="card"><div class="card-head"><h2>Due now ${due.length ? `<small class="count">${due.length}</small>` : ''}</h2></div>
        ${due.length ? `<ul class="list">${due.map(row).join('')}</ul>` : '<div class="empty"><p>No reminders due. Nice. 🙌</p></div>'}</section>
      <section class="card"><div class="card-head"><h2>Coming up</h2></div>
        ${upcoming.length ? `<ul class="list">${upcoming.map(row).join('')}</ul>` : '<div class="empty"><p>Issue an invoice and its reminders appear here.</p></div>'}</section>
      <section class="card"><div class="card-head"><h2>Quotes awaiting reply</h2></div>${manualList(quoted, 'followup', 'Follow up')}</section>
      ${sent.length ? `<section class="card"><div class="card-head"><h2>Recently sent</h2></div><ul class="list">${sent.map(row).join('')}</ul></section>` : ''}`;
  }

  /* ---------------- Settings ---------------- */

  function pageSettings() {
    const s = settings();
    const pro = isPro();
    const f = (key, label, attrs) => `<label>${label}<input data-setting="${key}" value="${esc(s[key])}" ${attrs || ''}></label>`;
    return `
      <div class="page-head"><div><h1>Settings</h1><p class="muted">These details appear on every quote and invoice. Changes save automatically.</p></div></div>

      <section class="card">
        <h2>Your business</h2>
        <div class="form-grid">
          ${f('businessName', 'Business name', 'placeholder="e.g. Mike&#39;s Plumbing"')}
          ${f('ownerName', 'Your name', 'placeholder="e.g. Mike Thompson"')}
          ${f('phone', 'WhatsApp number', `placeholder="${esc(phonePlaceholder())}" inputmode="tel"`)}
          ${f('email', 'Email', 'placeholder="optional" inputmode="email"')}
          <label class="span-2">Address<input data-setting="address" value="${esc(s.address)}" placeholder="optional"></label>
        </div>
      </section>

      <section class="card">
        <h2>Country &amp; currency</h2>
        <div class="form-grid">
          <label>Country
            <select data-region="country">
              ${R.countries().map((c) => `<option value="${c.code}" ${c.code === s.country ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              <option value="" ${!s.country ? 'selected' : ''}>Other / not listed</option>
            </select>
          </label>
          <label>Currency
            <select data-setting="currencyCode">
              ${R.currencies().map((c) => `<option value="${c.code}" ${c.code === s.currencyCode ? 'selected' : ''}>${c.code} · ${esc(c.name)}</option>`).join('')}
            </select>
          </label>
          <label>Phone country code
            <span class="prefix-input"><span>+</span><input data-setting="countryCode" value="${esc(s.countryCode)}" inputmode="numeric" placeholder="1"></span>
          </label>
          <label>Dates in your chats look like
            <select data-setting="dateOrder">
              <option value="DMY" ${s.dateOrder !== 'MDY' ? 'selected' : ''}>Day first (31/12)</option>
              <option value="MDY" ${s.dateOrder === 'MDY' ? 'selected' : ''}>Month first (12/31)</option>
            </select>
          </label>
        </div>
        <p class="muted small region-preview">On your documents: <b>${esc(money(1234.5))}</b> · <b>${esc(fmtDate(todayISO()))}</b> · <b>${esc(fmtTime('14:30'))}</b></p>
      </section>

      <section class="card">
        <h2>Getting paid</h2>
        <div class="form-grid">
          <label class="span-2">Payment details (bank transfer, card link, PayPal, mobile money, etc.)
            <textarea data-setting="paymentDetails" rows="4" placeholder="Bank: Example Bank · Account name: Your Business
Account / IBAN: 0000 0000 0000
Or pay online: paypal.me/yourbusiness">${esc(s.paymentDetails)}</textarea></label>
          ${f('taxLabel', 'Tax name', 'placeholder="VAT, GST, Sales tax…"')}
          ${f('taxRate', 'Default tax %', 'inputmode="decimal" data-type="number"')}
          ${f('taxNumber', 'Tax registration number', 'placeholder="optional"')}
          ${f('invoiceDueDays', 'Invoices due after (days)', 'inputmode="numeric" data-type="number"')}
          ${f('quoteValidDays', 'Quotes valid for (days)', 'inputmode="numeric" data-type="number"')}
          ${f('quotePrefix', 'Quote number prefix')}
          ${f('invoicePrefix', 'Invoice number prefix')}
          <label class="span-2">Footer message${'<input data-setting="footerNote" value="' + esc(s.footerNote) + '">'}</label>
        </div>
      </section>

      <section class="card ${pro ? '' : 'locked'}">
        <div class="card-head"><h2>Branding ${pro ? '' : lockBadge()}</h2>${pro ? '' : '<button class="btn btn-sm" data-action="upsell" data-kind="branding">Unlock</button>'}</div>
        <div class="brand-row">
          <div class="logo-drop">
            ${s.logo ? `<img src="${esc(s.logo)}" alt="Your logo">` : '<span class="muted">No logo</span>'}
          </div>
          <div class="brand-controls">
            <label class="btn btn-ghost ${pro ? '' : 'disabled'}">Upload logo<input type="file" accept="image/*" data-action="upload-logo" hidden ${pro ? '' : 'disabled'}></label>
            ${s.logo ? `<button class="btn btn-ghost btn-sm" data-action="remove-logo" ${pro ? '' : 'disabled'}>Remove</button>` : ''}
            <label class="color-label">Brand colour <input type="color" data-setting="brandColor" value="${esc(/^#[0-9a-f]{6}$/i.test(s.brandColor) ? s.brandColor : DEFAULT_BRAND)}" ${pro ? '' : 'disabled'}></label>
          </div>
        </div>
        ${pro ? '' : '<p class="muted small">Free documents use the QuoteSnap look and show a small “Made with QuoteSnap” footer.</p>'}
      </section>

      <section class="card">
        <h2>Your data</h2>
        <p class="muted small">Everything is stored in this browser on this device. Back it up now and then, or move it to another device.</p>
        <div class="doc-actions">
          <button class="btn btn-ghost" data-action="export">⬇ Download backup</button>
          <label class="btn btn-ghost">⬆ Restore backup<input type="file" accept="application/json,.json" data-action="import" hidden></label>
          <button class="btn btn-ghost danger" data-action="reset">Erase everything</button>
        </div>
      </section>`;
  }

  /* ---------------- Upgrade ---------------- */

  function pageUpgrade() {
    const pro = isPro();
    const usage = S.usageThisMonth();
    const row = (label, free, paid) => `<tr><th scope="row">${label}</th><td>${free}</td><td>${paid}</td></tr>`;
    return `
      <div class="page-head center">
        <div>
          <p class="eyebrow">Plans</p>
          <h1>Look professional. Get paid faster.</h1>
          <p class="muted lead">One extra job won from a quick, tidy quote pays for a year of Pro.</p>
        </div>
      </div>
      ${BETA ? `<div class="beta-banner"><b>🎉 Beta:</b> everything is free while we test. The prices below start after the beta, and we'll tell you well before anything changes.</div>` : ''}
      <div class="plans">
        <section class="plan-card ${pro ? '' : 'current'}">
          <h2>Free</h2>
          <p class="price">Free <small>forever</small></p>
          <ul class="ticks">
            <li>${S.FREE_DOC_LIMIT} quotes or invoices a month</li>
            <li>Unlimited chat snaps &amp; job checklists</li>
            <li>WhatsApp sharing &amp; PDF download</li>
            <li>Manual payment reminders</li>
          </ul>
          ${pro ? '<button class="btn btn-ghost btn-block" data-action="downgrade">Switch to Free</button>' : `<p class="muted small center">You've used ${usage.total} of ${S.FREE_DOC_LIMIT} this month</p>`}
        </section>
        <section class="plan-card featured ${pro ? 'current' : ''}">
          <span class="ribbon">Most popular</span>
          <h2>Pro</h2>
          <p class="price">${S.PRO_PRICE.label} <small>/ month</small></p>
          <ul class="ticks">
            <li><b>Unlimited</b> quotes &amp; invoices</li>
            <li>Your <b>logo &amp; brand colour</b>, no QuoteSnap footer</li>
            <li><b>Customer history</b>: jobs, totals, who owes you</li>
            <li><b>Automatic reminders</b> before and after due dates</li>
          </ul>
          ${pro ? '<p class="center"><span class="pill st-paid">✓ You\'re on Pro</span></p>'
            : (BETA ? '<button class="btn btn-primary btn-block btn-lg" data-action="upgrade">Turn on Pro free (beta)</button><p class="muted small center">No card needed during the beta.</p>' : '<button class="btn btn-primary btn-block btn-lg" data-action="upgrade">Start Pro</button><p class="muted small center">Cancel any time.</p>')}
        </section>
      </div>
      <section class="card team-upsell">
        <div>
          <p class="eyebrow">Add-on · works with Free or Pro</p>
          <h2>Teams: ${esc(teamPriceLabel())} / month</h2>
          <p class="muted">Add your employees, give them roles (Finance, Sales, Field staff or your own), control what each role can see, assign jobs, and chat with the people you choose.</p>
        </div>
        ${teamOn() ? '<a class="btn" href="#/team">Manage team</a>' : '<a class="btn btn-primary" href="#/team">See Teams</a>'}
      </section>
      <section class="card compare">
        <table>
          <thead><tr><th></th><th>Free</th><th>Pro</th></tr></thead>
          <tbody>
            ${row('Quotes & invoices', `${S.FREE_DOC_LIMIT} / month`, 'Unlimited')}
            ${row('Read WhatsApp chats', '✓', '✓')}
            ${row('Job checklists', '✓', '✓')}
            ${row('Send via WhatsApp & PDF', '✓', '✓')}
            ${row('Custom logo & colour', '—', '✓')}
            ${row('Customer history', '—', '✓')}
            ${row('Automatic payment reminders', '—', '✓')}
          </tbody>
        </table>
      </section>`;
  }

  /* ================================================================ *
   * Teams: team page, switching person, chat
   * ================================================================ */

  function pageTeam(params) {
    if (!teamOn()) return teamPromoHTML();
    const tab = params.get('tab') || 'people';
    const tabs = [['people', 'People'], ['roles', 'Roles & access'], ['chats', 'Chats'], ['billing', 'Billing']];
    const body = tab === 'roles' ? teamRolesHTML() : tab === 'chats' ? teamChatsHTML() : tab === 'billing' ? teamBillingHTML() : teamPeopleHTML();
    return `
      <div class="page-head">
        <div><h1>Team</h1><p class="muted">Add your people, decide what each role can see, and choose who chats with whom.</p></div>
      </div>
      <nav class="seg team-tabs" aria-label="Team sections">
        ${tabs.map(([k, l]) => `<a class="${k === tab ? 'on' : ''}" href="#/team?tab=${k}">${l}</a>`).join('')}
      </nav>
      ${body}`;
  }

  function teamPromoHTML() {
    const p = T.teamPrice(settings().currencyCode);
    return `
      <div class="page-head center"><div>
        <p class="eyebrow">Teams add-on</p>
        <h1>Bring your whole team in</h1>
        <p class="muted lead">Add your employees, give each one a role, and they only see what their job needs. Plus a team chat that you control.</p>
      </div></div>
      <div class="team-promo">
        <section class="card">
          <ul class="ticks big-ticks">
            <li><b>Everyone in one place:</b> add as many people as you need.</li>
            <li><b>Roles you control:</b> Finance sees quotes and invoices, field staff only see the jobs you assign them (no prices).</li>
            <li><b>Your own roles:</b> tick exactly which features each role can use.</li>
            <li><b>Team chat:</b> you pick who is in each chat, and can share jobs in it.</li>
            <li><b>Assign jobs</b> to people and they show up on their Home screen.</li>
          </ul>
        </section>
        <section class="plan-card featured">
          <span class="ribbon">Add-on</span>
          <h2>Teams</h2>
          <p class="price">${esc(teamPriceLabel())} <small>/ month</small></p>
          <p class="muted small">${p.local ? `Priced for ${esc(R.countryName(settings().country))}.` : 'Billed in US dollars.'} Works with Free or Pro. One price for the whole team.</p>
          <button class="btn btn-primary btn-block btn-lg" data-action="team-add">${BETA ? 'Add Teams free (beta)' : 'Add Teams'}</button>
        </section>
      </div>`;
  }

  function teamPeopleHTML() {
    const t = team();
    const actor = account();
    const roleOptions = (sel) => t.roles.filter((r) => r.id !== 'owner').map((r) => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
    return `
      <section class="card">
        <div class="card-head"><h2>People · ${t.members.length}</h2><span class="muted small">Tap a name to open their profile</span></div>
        <ul class="list members">
          ${t.members.map((m) => {
            const self = m.id === actor.id;
            return `<li class="row member-row">
              ${avatarHTML(m)}
              <a class="row-main member-link" href="#/team/member/${m.id}"><b>${esc(m.name)}${self ? ' <span class="muted small">(you)</span>' : ''}</b><span class="muted">${esc(m.contact || 'No email or phone yet')}</span></a>
              ${m.passHash ? '<span class="pill st-paid">Signed up</span>' : `<span class="pill st-invoiced" title="Invite code ${esc(m.inviteCode || '')}">Invite pending</span>`}
              ${T.canChangeRole(t, actor, m) ? `<select class="role-select" data-member-role="${m.id}" aria-label="Role for ${esc(m.name)}">${roleOptions(m.roleId)}</select>` : roleBadge(m)}
              <span class="member-actions">
                ${!m.passHash && m.inviteCode ? `<button class="btn btn-sm btn-wa" data-action="invite" data-id="${m.id}">Invite</button>` : ''}
                <a class="btn btn-ghost btn-sm" href="#/team/member/${m.id}">Profile</a>
              </span>
            </li>`;
          }).join('')}
        </ul>
        <p class="muted small">Everyone logs in with their own password. Only managers can change roles, and nobody can change their own.</p>
      </section>
      <section class="card">
        <h2>Add a person</h2>
        <form class="form-grid add-member" data-action-submit="add-member" novalidate>
          <label>Name<input name="name" required placeholder="e.g. Sam Carter" autocomplete="off"></label>
          <label>Their email or phone<input name="contact" placeholder="used to log in" autocomplete="off"></label>
          <label>Role<select name="role">${roleOptions('field')}</select></label>
          <div class="add-member-btn"><button class="btn btn-primary" type="submit">Add to team</button></div>
        </form>
        <p class="muted small">They get an invite code to create their password. Not sure which role? See <a href="#/team?tab=roles">Roles &amp; access</a>.</p>
      </section>`;
  }

  function teamRolesHTML() {
    const t = team();
    const count = (r) => t.members.filter((m) => m.roleId === r.id).length;
    const cell = (r, p) => {
      const locked = r.locked;
      if (p.levels) {
        const v = locked ? 'all' : (r.perms[p.key] || 'none');
        return `<td><select data-role-perm="${r.id}:${p.key}" ${locked ? 'disabled' : ''} aria-label="${esc(p.label)} for ${esc(r.name)}">${p.levels.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>`;
      }
      const on = locked || !!r.perms[p.key];
      return `<td><label class="cbox"><input type="checkbox" data-role-perm="${r.id}:${p.key}" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="${esc(p.label)} for ${esc(r.name)}"><span aria-hidden="true"></span></label></td>`;
    };
    return `
      <section class="card">
        <div class="card-head"><h2>Roles &amp; access</h2><span class="muted small">Changes apply straight away to everyone with that role</span></div>
        <div class="perm-wrap">
          <table class="perm-table">
            <thead><tr><th scope="col">Feature</th>${t.roles.map((r) => `
              <th scope="col">
                <span class="role-dot" style="background:${esc(r.color)}"></span>
                ${r.locked ? `<b>${esc(r.name)}</b>` : `<input class="role-name" data-role-name="${r.id}" value="${esc(r.name)}" aria-label="Role name">`}
                <small>${count(r)} ${count(r) === 1 ? 'person' : 'people'}</small>
                ${!r.locked ? `<button class="icon-btn" data-action="remove-role" data-id="${r.id}" aria-label="Delete role ${esc(r.name)}" title="Delete role">×</button>` : ''}
              </th>`).join('')}</tr></thead>
            <tbody>${T.PERMS.map((p) => `<tr><th scope="row">${esc(p.label)}<small>${esc(p.desc)}</small></th>${t.roles.map((r) => cell(r, p)).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
        <form class="inline-form" data-action-submit="add-role">
          <input name="name" placeholder="New role, e.g. Receptionist" aria-label="New role name" required>
          <button class="btn" type="submit">+ Add role</button>
        </form>
        <p class="muted small">The Owner always has full access. Without “Quotes &amp; prices” or “Invoices”, a person never sees any money: prices are hidden on jobs too.</p>
      </section>`;
  }

  function teamChatsHTML() {
    const t = team();
    const memberBoxes = (c, prefix) => t.members.map((m) => {
      const chatOk = T.can(t, m, 'chat');
      const checked = c ? c.memberIds.includes(m.id) : m.id === (me() || {}).id;
      return `<label class="pick ${chatOk ? '' : 'pick-off'}" title="${chatOk ? '' : 'Their role does not include Team chat'}">
        <input type="checkbox" ${prefix}="${c ? c.id + ':' : ''}${m.id}" ${checked ? 'checked' : ''} ${chatOk ? '' : 'disabled'}>
        ${avatarHTML(m, 'sm')}<span>${esc(m.name)}${chatOk ? '' : ' <small>(role can’t chat)</small>'}</span></label>`;
    }).join('');
    return `
      <section class="card">
        <div class="card-head"><h2>Chats · ${t.channels.length}</h2><span class="muted small">Only the people you tick can read and post</span></div>
        ${t.channels.length ? t.channels.map((c) => `
          <div class="chan-edit">
            <div class="chan-edit-head">
              <input class="chan-name" data-chan-name="${c.id}" value="${esc(c.name)}" placeholder="${esc(T.channelTitle(t, c, me()))}" aria-label="Chat name">
              ${c.everyone ? '<span class="pill st-quoted" title="New people are added automatically">Everyone</span>' : ''}
              <a class="btn btn-ghost btn-sm" href="#/chat/${c.id}">Open</a>
              <button class="icon-btn" data-action="remove-chat" data-id="${c.id}" aria-label="Delete chat">×</button>
            </div>
            <div class="picks">${memberBoxes(c, 'data-chan-member')}</div>
          </div>`).join('') : '<div class="empty"><p>No chats yet.</p></div>'}
      </section>
      <section class="card">
        <h2>New chat</h2>
        <form data-action-submit="add-chat">
          <label>Name<input name="name" placeholder="e.g. Field team, Finance, Sam & you" autocomplete="off"></label>
          <p class="small muted" style="margin:12px 0 6px">Who's in it?</p>
          <div class="picks">${memberBoxes(null, 'data-new-chat-member')}</div>
          <button class="btn btn-primary" type="submit" style="margin-top:12px">Create chat</button>
        </form>
      </section>`;
  }

  function teamBillingHTML() {
    const p = T.teamPrice(settings().currencyCode);
    return `
      <section class="card billing">
        <div class="card-head"><h2>Teams add-on</h2><span class="pill st-paid">Active</span></div>
        <p class="price">${esc(teamPriceLabel())} <small>/ month</small></p>
        <p class="muted">${p.local ? `Local price for ${esc(R.countryName(settings().country))}.` : 'Billed in US dollars.'} One price for the whole team · ${team().members.length} ${team().members.length === 1 ? 'person' : 'people'} now.</p>
        <p class="muted small">On top of your ${isPro() ? 'Pro' : 'Free'} plan. ${isPro() ? '' : 'With Pro the whole team gets unlimited documents.'}</p>
        <div class="doc-actions">
          ${isPro() ? '' : '<a class="btn" href="#/upgrade">See Pro</a>'}
          <button class="btn btn-ghost danger" data-action="team-remove">Remove Teams</button>
        </div>
      </section>`;
  }

  /* ---------------- Accounts: sign up, log in, join, recover ---------------- */

  const AUTH_PATHS = ['/signup', '/login', '/join', '/recover'];
  const account = () => S.account();

  function authShell(inner) {
    return `<div class="auth-wrap">
      <a class="brand auth-brand" href="index.html"><span class="brand-mark">Q</span><span class="brand-name">QuoteSnap</span></a>
      <section class="card auth-card">${inner}</section>
      <p class="muted small auth-foot">🔒 Your account and data stay on this device. · <a href="privacy.html">Privacy</a> · <a href="terms.html">Terms</a>${BETA ? ' · Beta' : ''}</p>
    </div>`;
  }
  const authError = '<p class="auth-error warn small" role="alert" hidden></p>';
  const rememberBox = '<label class="remember"><input type="checkbox" name="remember" checked> Keep me signed in on this device</label>';

  function pageAuth(path, params) {
    const ownerReady = T.hasOwnerAccount(team());
    if (!ownerReady && path !== '/recover') path = '/signup';
    if (ownerReady && path === '/signup') path = '/login';
    if (!AUTH_PATHS.includes(path)) path = '/login';
    const s = settings();

    if (path === '/signup') {
      const hasData = S.state.jobs.length || (S.state.lists || []).length;
      return authShell(`
        <h1>Create your account</h1>
        <p class="muted">${hasData ? 'Your jobs are safe. Set a password so only you can open them.' : 'Takes a minute. You can add your team later.'}</p>
        <form data-action-submit="auth-signup" class="auth-form" novalidate>
          <label>Your name<input name="name" required autocomplete="name" value="${esc(s.ownerName || '')}"></label>
          <label>Business name<input name="business" autocomplete="organization" value="${esc(s.businessName || '')}" placeholder="optional"></label>
          <label>Email or phone number<input name="login" required autocomplete="username" placeholder="you@example.com"></label>
          <label>Password<input name="password" type="password" required autocomplete="new-password" minlength="8"><small class="muted">At least 8 characters.</small></label>
          <label>Confirm password<input name="confirm" type="password" required autocomplete="new-password"></label>
          ${rememberBox}
          ${authError}
          <button class="btn btn-primary btn-block btn-lg" type="submit">Create account</button>
        </form>
        <p class="auth-alt">Joining someone's team? <a href="#/join">Use your invite code</a></p>`);
    }

    if (path === '/join') {
      const pending = params.get('code') ? T.findByInvite(team(), params.get('code')) : null;
      if (pending) {
        return authShell(`
          <h1>Hi ${esc(pending.name.split(' ')[0])} 👋</h1>
          <p class="muted">You're joining <b>${esc(s.businessName || 'the team')}</b> as <b>${esc((T.roleOf(team(), pending) || {}).name || 'team member')}</b>. Set up your sign-in.</p>
          <form data-action-submit="auth-join" data-id="${pending.id}" class="auth-form" novalidate>
            <label>Email or phone number<input name="login" required autocomplete="username" value="${esc(pending.contact || '')}"></label>
            <label>Choose a password<input name="password" type="password" required autocomplete="new-password" minlength="8"><small class="muted">At least 8 characters.</small></label>
            <label>Confirm password<input name="confirm" type="password" required autocomplete="new-password"></label>
            ${rememberBox}
            ${authError}
            <button class="btn btn-primary btn-block btn-lg" type="submit">Finish sign-up</button>
          </form>`);
      }
      return authShell(`
        <h1>Join your team</h1>
        <p class="muted">Enter the 6-character invite code your manager sent you.</p>
        <form data-action-submit="auth-join-code" class="auth-form" novalidate>
          <label>Invite code<input name="code" required autocomplete="one-time-code" class="code-input" maxlength="7" placeholder="ABC123" value="${esc(params.get('code') || '')}"></label>
          ${authError}
          <button class="btn btn-primary btn-block btn-lg" type="submit">Continue</button>
        </form>
        <p class="auth-alt">Already signed up? <a href="#/login">Log in</a></p>`);
    }

    if (path === '/recover') {
      return authShell(`
        <h1>Forgot your password?</h1>
        <p class="muted"><b>Team members:</b> ask your manager to reset it. They'll give you a new invite code.</p>
        <p class="muted"><b>Business owner:</b> use the recovery code you saved when you signed up.</p>
        <form data-action-submit="auth-recover" class="auth-form" novalidate>
          <label>Email or phone number<input name="login" required autocomplete="username"></label>
          <label>Recovery code<input name="code" required class="code-input" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off"></label>
          <label>New password<input name="password" type="password" required autocomplete="new-password" minlength="8"></label>
          <label>Confirm new password<input name="confirm" type="password" required autocomplete="new-password"></label>
          ${authError}
          <button class="btn btn-primary btn-block btn-lg" type="submit">Set new password</button>
        </form>
        <p class="auth-alt"><a href="#/login">Back to log in</a></p>`);
    }

    const switching = params.get('switch');
    return authShell(`
      <h1>${switching ? 'Switch user' : 'Welcome back'}</h1>
      <p class="muted">${switching ? 'Log in as the next person. Everyone needs their own password.' : `Log in to ${esc(s.businessName || 'QuoteSnap')}.`}</p>
      <form data-action-submit="auth-login" class="auth-form" novalidate>
        <label>Email or phone number<input name="login" required autocomplete="username"></label>
        <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
        ${rememberBox}
        ${authError}
        <button class="btn btn-primary btn-block btn-lg" type="submit">Log in</button>
      </form>
      <p class="auth-alt"><a href="#/recover">Forgot password?</a> · New to the team? <a href="#/join">Use your invite code</a></p>`);
  }

  function showAuthError(form, msg) {
    const el = form.querySelector('.auth-error');
    if (el) { el.textContent = msg; el.hidden = !msg; }
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = false;
  }

  function checkNewPassword(form) {
    const pw = form.elements.password.value;
    const problem = T.passwordProblem(pw);
    if (problem) return problem;
    if (pw !== form.elements.confirm.value) return "The two passwords don't match.";
    return '';
  }

  function loginTaken(login, exceptId) {
    const other = T.findByLogin(team(), login);
    return other && other.id !== exceptId;
  }

  function showRecoveryCode(code) {
    modal(`
      <div class="upsell">
        <div class="upsell-icon">🔑</div>
        <h3>Save your recovery code</h3>
        <p class="muted">If you ever forget your password, this is the only way back into your account on this device. Write it down or keep it somewhere safe.</p>
        <p class="recovery-code">${esc(code)}</p>
        <button class="btn btn-ghost btn-block" data-action="copy" data-text="${esc(code)}">Copy code</button>
        <button class="btn btn-primary btn-block" data-action="close-modal">I've saved it</button>
      </div>`);
  }

  /** Go to a page, then run `after` once it has rendered (e.g. open a pop-up). */
  let afterNav = null;
  function go(hash, after) {
    afterNav = after || null;
    if (location.hash === hash) rerender(); else location.hash = hash;
  }

  function enterApp(m, remember, msg, after) {
    T.noteSuccess(m.id);
    S.signIn(m.id, remember);
    go('#/', after);
    toast(msg || `Welcome, ${m.name.split(' ')[0]}`);
  }

  async function handleAuth(kind, form) {
    const f = form.elements;
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    const remember = f.remember ? f.remember.checked : false;
    const t = team();

    if (kind === 'auth-signup') {
      const name = f.name.value.trim();
      const login = T.normalizeLogin(f.login.value);
      if (!name) return showAuthError(form, 'Please enter your name.');
      if (!login || (!login.includes('@') && login.replace(/\D/g, '').length < 7)) return showAuthError(form, 'Enter an email address or phone number.');
      const problem = checkNewPassword(form);
      if (problem) return showAuthError(form, problem);
      let owner = T.ownerAccount(t);
      if (!owner) {
        owner = { id: 'owner', roleId: 'owner', color: T.COLORS[0], createdAt: new Date().toISOString() };
        t.members.unshift(owner);
        t.channels.forEach((c) => { if (c.everyone && !c.memberIds.includes('owner')) c.memberIds.push('owner'); });
      }
      Object.assign(owner, { name, contact: f.login.value.trim(), login });
      await T.setPassword(owner, f.password.value);
      const code = await T.setRecovery(owner);
      const s = settings();
      if (!s.ownerName) s.ownerName = name;
      if (!s.businessName && f.business.value.trim()) s.businessName = f.business.value.trim();
      S.save();
      enterApp(owner, remember, 'Account created 🎉', () => showRecoveryCode(code));
      return;
    }

    if (kind === 'auth-login') {
      const m = T.findByLogin(t, f.login.value);
      if (!m) return showAuthError(form, "We couldn't find an account with that email or phone number.");
      if (!m.passHash) return showAuthError(form, "You haven't finished signing up yet. Use “Use your invite code” below.");
      if (m.roleId !== 'owner' && !(S.state.teamAddon && t.enabled)) return showAuthError(form, "Your team's access is switched off. Ask the business owner.");
      const wait = T.lockedFor(m.id);
      if (wait) return showAuthError(form, `Too many wrong tries. Try again in ${wait} seconds.`);
      if (!(await T.checkPassword(m, f.password.value))) {
        T.noteFailure(m.id);
        f.password.value = '';
        return showAuthError(form, "That password isn't right.");
      }
      enterApp(m, remember);
      return;
    }

    if (kind === 'auth-join-code') {
      const m = T.findByInvite(t, f.code.value);
      if (!m) return showAuthError(form, "That code doesn't match an invite. Check it with your manager.");
      if (!(S.state.teamAddon && t.enabled)) return showAuthError(form, "This team isn't active right now. Ask the business owner.");
      location.hash = `#/join?code=${encodeURIComponent(m.inviteCode)}`;
      return;
    }

    if (kind === 'auth-join') {
      const m = T.member(t, form.dataset.id);
      if (!m || m.passHash) return showAuthError(form, 'This invite has already been used.');
      const login = T.normalizeLogin(f.login.value);
      if (!login || (!login.includes('@') && login.replace(/\D/g, '').length < 7)) return showAuthError(form, 'Enter an email address or phone number.');
      if (loginTaken(login, m.id)) return showAuthError(form, 'Someone on the team already uses that email or phone number.');
      const problem = checkNewPassword(form);
      if (problem) return showAuthError(form, problem);
      Object.assign(m, { contact: f.login.value.trim(), login });
      await T.setPassword(m, f.password.value);
      S.save();
      enterApp(m, remember, `You're in, ${m.name.split(' ')[0]} 🎉`);
      return;
    }

    if (kind === 'auth-recover') {
      const m = T.findByLogin(t, f.login.value);
      const wait = m ? T.lockedFor(m.id) : 0;
      if (wait) return showAuthError(form, `Too many wrong tries. Try again in ${wait} seconds.`);
      if (!m || !(await T.checkRecovery(m, f.code.value))) {
        if (m) T.noteFailure(m.id);
        return showAuthError(form, "That recovery code doesn't match. Team members: ask your manager to reset your password.");
      }
      const problem = checkNewPassword(form);
      if (problem) return showAuthError(form, problem);
      await T.setPassword(m, f.password.value);
      const code = await T.setRecovery(m);
      S.save();
      enterApp(m, false, 'Password changed', () => showRecoveryCode(code));
    }
  }

  /* ---------------- Account menu & profiles (managers only) ---------------- */

  function accountMenu(withLinks) {
    const a = account();
    const links = withLinks ? [
      ['#/', '🏠 Home', null], ['#/new', '⚡ Paste & make', 'paste'], ['#/jobs', '📋 Jobs', 'jobs'], ['#/todos', '✅ To-dos', 'todos'],
      ['#/chat', '💬 Chat', 'chat'], ['#/customers', '🗂️ Customers', 'customers'], ['#/reminders', '⏰ Reminders', 'reminders'],
      ['#/team', '👥 Team', 'team'], ['#/settings', '⚙️ Settings', 'settings'], ['#/upgrade', '✨ Plans', 'team'],
    ].filter(([href, , perm]) => (href === '#/chat' ? teamOn() && can('chat') : !perm || can(perm))) : [];
    const profileOk = T.canOpenProfile(team(), a);
    modal(`
      <div class="menu-me">${avatarHTML(a)}<div><b>${esc(a.name)}</b><br>${teamOn() || a.roleId === 'owner' ? roleBadge(a) : ''}<br><span class="muted small">${esc(a.contact || '')}</span></div></div>
      ${profileOk ? `<a class="btn btn-ghost btn-block" href="#/profile" data-action="close-modal">My profile &amp; password</a>`
        : '<p class="muted small">Your manager looks after your profile. Ask them to change your details or reset your password.</p>'}
      ${teamOn() ? '<button class="btn btn-block" data-action="switch-user">Switch user</button>' : ''}
      <button class="btn btn-ghost btn-block" data-action="sign-out">Sign out</button>
      <p class="menu-foot small">${contactHref() ? `<a href="${esc(contactHref())}">💬 Send feedback</a> · ` : ''}<a href="privacy.html">Privacy</a> · <a href="terms.html">Terms</a>${BETA ? ' · <span class="muted">Beta</span>' : ''}</p>
      ${links.length ? `<nav class="menu-links">${links.map(([href, label]) => `<a href="${href}" data-action="close-modal">${label}</a>`).join('')}</nav>` : ''}`);
  }

  function inviteText(m) {
    const biz = settings().businessName || 'our business';
    const r = T.roleOf(team(), m);
    const link = /^https?:/.test(location.protocol) ? `\n${location.origin}${location.pathname}#/join?code=${m.inviteCode}` : '';
    return `Hi ${m.name.split(' ')[0]}! You've been added to ${biz} on QuoteSnap as ${r ? r.name : 'a team member'}.\n\nOpen QuoteSnap, tap “Use your invite code” and enter:\n*${m.inviteCode}*\n\nThen choose your own password.${link}`;
  }

  function pageProfile(id) {
    const actor = account();
    if (!T.canOpenProfile(team(), actor)) return pageNoAccess('profiles');
    const t = team();
    const m = T.member(t, id || actor.id);
    if (!m) return `<div class="empty big"><p>That person isn't on the team anymore.</p><a class="btn" href="#/team">Back to team</a></div>`;
    const self = m.id === actor.id;
    const role = T.roleOf(t, m);
    const roleCtl = T.canChangeRole(t, actor, m)
      ? `<select data-member-role="${m.id}" aria-label="Role">${t.roles.filter((r) => r.id !== 'owner').map((r) => `<option value="${r.id}" ${r.id === m.roleId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`
      : `<p>${roleBadge(m)}</p><p class="muted small">${m.roleId === 'owner' ? "The owner's role can't change." : self ? "You can't change your own role. Another manager can." : 'Only a manager can change roles.'}</p>`;
    return `
      <div class="job-head">
        ${teamOn() ? '<a href="#/team" class="back">← Team</a>' : '<a href="#/" class="back">← Home</a>'}
        <div class="job-title">${avatarHTML(m, 'lg')}<h1>${esc(m.name)}${self ? ' <span class="muted small">(you)</span>' : ''}</h1></div>
      </div>
      <div class="grid-2 profile-grid">
        <section class="card">
          <h2>Details</h2>
          <form class="auth-form" data-action-submit="profile-save" data-id="${m.id}" novalidate>
            <label>Name<input name="name" value="${esc(m.name)}" required></label>
            <label>Email or phone (used to log in)<input name="login" value="${esc(m.contact || '')}" ${m.passHash || self ? 'required' : ''}></label>
            ${authError}
            <button class="btn btn-primary" type="submit">Save details</button>
          </form>
        </section>
        <section class="card">
          <h2>Role</h2>
          ${roleCtl}
          ${role ? `<p class="muted small">Can use: ${T.PERMS.filter((p) => T.can(t, m, p.key)).map((p) => esc(p.label)).join(', ') || 'nothing yet'}.</p>` : ''}
        </section>
        <section class="card">
          <h2>Password</h2>
          ${self ? `
            <form class="auth-form" data-action-submit="profile-password" novalidate>
              <label>Current password<input name="current" type="password" autocomplete="current-password" required></label>
              <label>New password<input name="password" type="password" autocomplete="new-password" required></label>
              <label>Confirm new password<input name="confirm" type="password" autocomplete="new-password" required></label>
              ${authError}
              <button class="btn" type="submit">Change password</button>
            </form>`
          : m.passHash ? `
            <p><span class="pill st-paid">Signed up</span> ${m.joinedAt ? `<span class="muted small">since ${esc(fmtDate(m.joinedAt.slice(0, 10)))}</span>` : ''}</p>
            <p class="muted small">Forgot their password? Resetting signs them out and gives them a new invite code to choose a new one.</p>
            <button class="btn" data-action="reset-password" data-id="${m.id}">Reset password</button>`
          : `
            <p><span class="pill st-invoiced">Invite pending</span></p>
            <p>Invite code: <b class="code">${esc(m.inviteCode || '')}</b></p>
            <div class="doc-actions">
              <button class="btn btn-wa" data-action="invite" data-id="${m.id}">Send invite</button>
              <button class="btn btn-ghost" data-action="copy" data-text="${esc(inviteText(m))}">Copy invite</button>
              <button class="btn btn-ghost" data-action="new-invite" data-id="${m.id}">New code</button>
            </div>`}
        </section>
        ${self && m.roleId === 'owner' ? `
        <section class="card">
          <h2>Recovery code</h2>
          <p class="muted small">Lost your recovery code? Make a new one. The old one stops working.</p>
          <form class="auth-form" data-action-submit="profile-recovery" novalidate>
            <label>Current password<input name="current" type="password" autocomplete="current-password" required></label>
            ${authError}
            <button class="btn" type="submit">Make a new recovery code</button>
          </form>
        </section>` : ''}
        ${!self && m.roleId !== 'owner' ? `
        <section class="card">
          <h2>Remove from team</h2>
          <p class="muted small">They'll be signed out and taken out of all chats. Their jobs stay.</p>
          <button class="btn btn-ghost danger" data-action="remove-member" data-id="${m.id}">Remove ${esc(m.name.split(' ')[0])}</button>
        </section>` : ''}
      </div>`;
  }

  async function handleProfile(kind, form) {
    const t = team();
    const actor = account();
    if (!T.canOpenProfile(t, actor)) return;
    const f = form.elements;
    if (kind === 'profile-save') {
      const m = T.member(t, form.dataset.id);
      const name = f.name.value.trim();
      const login = T.normalizeLogin(f.login.value);
      if (!name) return showAuthError(form, 'Please enter a name.');
      if ((m.passHash || m.id === actor.id) && !login) return showAuthError(form, 'An email or phone number is needed to log in.');
      if (login && loginTaken(login, m.id)) return showAuthError(form, 'Someone on the team already uses that email or phone number.');
      Object.assign(m, { name, contact: f.login.value.trim(), login });
      S.save(); rerender(); toast('Saved');
    } else if (kind === 'profile-password') {
      if (!(await T.checkPassword(actor, f.current.value))) return showAuthError(form, "Your current password isn't right.");
      const problem = checkNewPassword(form);
      if (problem) return showAuthError(form, problem);
      await T.setPassword(actor, f.password.value);
      S.save(); form.reset(); showAuthError(form, ''); toast('Password changed');
    } else if (kind === 'profile-recovery') {
      if (!(await T.checkPassword(actor, f.current.value))) return showAuthError(form, "Your current password isn't right.");
      const code = await T.setRecovery(actor);
      S.save(); form.reset(); showRecoveryCode(code);
    }
  }

  /* ---------------- Chat ---------------- */

  function pageChat(chatId) {
    const t = team();
    const user = me();
    const chans = T.channelsFor(t, user).slice().sort((a, b) => {
      const la = (T.messagesIn(t, a.id).slice(-1)[0] || {}).at || a.createdAt;
      const lb = (T.messagesIn(t, b.id).slice(-1)[0] || {}).at || b.createdAt;
      return lb.localeCompare(la);
    });
    if (!chatId && chans.length && window.innerWidth > 860) chatId = chans[0].id;
    const c = chatId ? chans.find((x) => x.id === chatId) : null;
    if (chatId && !c) return pageNoAccess('this chat');
    current.chatId = c ? c.id : null;

    const listHTML = chans.length ? `<ul class="chan-list">${chans.map((ch) => {
      const last = T.messagesIn(t, ch.id).slice(-1)[0];
      const n = T.unreadCount(t, user, ch.id);
      return `<li><a class="row chan-row ${c && c.id === ch.id ? 'sel' : ''}" href="#/chat/${ch.id}">
        <span class="avatar chan-av" aria-hidden="true">${ch.everyone ? '📣' : '💬'}</span>
        <span class="row-main"><b>${esc(T.channelTitle(t, ch, user))}</b><span class="muted">${last ? esc(`${(T.member(t, last.from) || {}).name || ''}: ${last.text || '📋 Shared a job'}`) : `${ch.memberIds.length} people`}</span></span>
        ${n ? `<span class="count">${n}</span>` : ''}
      </a></li>`;
    }).join('')}</ul>`
      : `<div class="empty"><p>${can('team') ? 'No chats yet.' : "Your manager hasn't added you to a chat yet."}</p>${can('team') ? '<a class="btn btn-primary btn-sm" href="#/team?tab=chats">Create a chat</a>' : ''}</div>`;

    return `
      <div class="page-head"><div><h1>Team chat</h1></div>${can('team') ? '<a class="btn btn-ghost" href="#/team?tab=chats">Manage chats</a>' : ''}</div>
      <div class="chat-layout ${c ? 'has-thread' : ''}">
        <aside class="card chat-side">${listHTML}</aside>
        <section class="card chat-thread">${c ? threadHTML(c) : '<div class="empty big"><p>Pick a chat on the left.</p></div>'}</section>
      </div>`;
  }

  function threadHTML(c) {
    const t = team();
    const user = me();
    const msgs = T.messagesIn(t, c.id);
    let lastDay = '';
    const jobsICanShare = visibleJobs().slice(0, 30);
    return `
      <header class="thread-head">
        <a class="back chat-back" href="#/chat">←</a>
        <div class="row-main"><b>${esc(T.channelTitle(t, c, user))}</b>
          <span class="muted small">${c.memberIds.map((id) => esc((T.member(t, id) || {}).name || '')).filter(Boolean).join(', ')}</span></div>
        <span class="thread-avatars">${c.memberIds.slice(0, 5).map((id) => avatarHTML(T.member(t, id), 'sm')).join('')}</span>
      </header>
      <div class="msgs" id="msgs" aria-live="polite">
        ${msgs.length ? msgs.map((m) => {
          const day = m.at.slice(0, 10);
          const sep = day !== lastDay ? `<div class="day-sep"><span>${esc(relDayLabel(day))}</span></div>` : '';
          lastDay = day;
          const who = T.member(t, m.from);
          const mine = m.from === user.id;
          const job = m.jobId ? S.getJob(m.jobId) : null;
          const jobCard = m.jobId ? (job && can('jobs') && seeJob(job)
            ? `<a class="msg-job" href="#/job/${job.id}">📋 <b>${esc(job.customer.name || 'Job')}</b> · ${esc(tradeLabel(job.trade))}${job.jobDate ? ' · ' + esc(fmtDate(job.jobDate)) : ''}</a>`
            : '<span class="msg-job muted">📋 A job you don’t have access to</span>') : '';
          return `${sep}<div class="msg ${mine ? 'mine' : ''}">
            ${mine ? '' : avatarHTML(who, 'sm')}
            <div class="bubble-msg">${mine ? '' : `<b style="color:${esc((who || {}).color || '#1f6f4a')}">${esc((who || {}).name || 'Removed member')}</b>`}${m.text ? `<p>${esc(m.text).replace(/\n/g, '<br>')}</p>` : ''}${jobCard}<time>${esc(fmtTime(new Date(m.at).toTimeString().slice(0, 5)))}</time></div>
          </div>`;
        }).join('') : '<div class="empty"><p>No messages yet. Say hi 👋</p></div>'}
      </div>
      <form class="composer" data-action-submit="send-chat">
        ${jobsICanShare.length ? `<select id="chat-job" aria-label="Attach a job"><option value="">📋 Job</option>${jobsICanShare.map((j) => `<option value="${j.id}">${esc(j.customer.name || 'Job')} · ${esc(tradeLabel(j.trade))}</option>`).join('')}</select>` : ''}
        <textarea id="chat-text" rows="1" placeholder="Message" aria-label="Message"></textarea>
        <button class="btn btn-primary" type="submit" aria-label="Send">Send</button>
      </form>`;
  }

  function relDayLabel(iso) {
    const d = daysBetween(iso, todayISO());
    if (d === 0) return 'Today';
    if (d === 1) return 'Yesterday';
    return fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function afterChatRender() {
    const box = document.getElementById('msgs');
    if (box) box.scrollTop = box.scrollHeight;
    if (current.chatId && me()) {
      const last = T.messagesIn(team(), current.chatId).slice(-1)[0];
      T.markRead(team(), me().id, current.chatId, last ? last.at : undefined);
      S.save();
    }
  }

  /** Re-draw the chat after a message arrives, keeping what the person was typing. */
  function refreshChat() {
    const ta = document.getElementById('chat-text');
    const draft = ta ? ta.value : '';
    const focused = document.activeElement === ta;
    view.innerHTML = pageChat(current.chatId);
    afterChatRender();
    const ta2 = document.getElementById('chat-text');
    if (ta2) { ta2.value = draft; if (focused) ta2.focus(); }
    renderShell('chat');
  }

  /* ================================================================ *
   * Router
   * ================================================================ */

  let current = { route: '', jobId: null, tab: null };

  function router() {
    closeModal();
    const hash = location.hash || '#/';
    const [path, query] = hash.slice(1).split('?');
    const params = new URLSearchParams(query || '');
    let html, route;
    let m;
    // nobody gets in without an account
    const acct = account();
    document.body.classList.toggle('auth-mode', !acct);
    if (!acct) {
      current.route = 'auth'; current.jobId = null; current.todoId = null; current.chatId = null;
      view.innerHTML = pageAuth(path, params);
      window.scrollTo(0, 0);
      const first = view.querySelector('input');
      if (first) first.focus({ preventScroll: true });
      return;
    }
    if (AUTH_PATHS.includes(path)) { location.replace('#/'); return; }

    const guard = (perm, what, page) => (can(perm) ? page() : pageNoAccess(what));
    if (path === '/' || path === '') { route = 'home'; html = pageDashboard(); }
    else if (path === '/new') { route = 'new'; html = guard('paste', 'Paste & make', pageNew); }
    else if (path === '/todos') { route = 'todos'; html = guard('todos', 'to-do lists', pageTodos); }
    else if ((m = path.match(/^\/todo\/([\w-]+)$/))) { route = 'todos'; current.todoId = m[1]; html = guard('todos', 'to-do lists', () => pageTodo(m[1])); }
    else if ((m = path.match(/^\/job\/([\w-]+)(?:\/(quote|invoice|checklist|reminder))?$/))) {
      route = 'job';
      const job = S.getJob(m[1]);
      if (job && (!can('jobs') || !seeJob(job))) { current.jobId = null; html = pageNoAccess('this job'); }
      else {
        // pick a tab this person is allowed to see
        const allowedTabs = jobTabs().map((t) => t[0]);
        let tab = m[2] || allowedTabs[0];
        if (!allowedTabs.includes(tab)) tab = allowedTabs[0];
        // switching tabs on the same job: only swap the panel so the editor keeps its state
        if (current.route === 'job' && current.jobId === m[1] && document.getElementById('panel')) {
          current.tab = tab;
          document.getElementById('panel').innerHTML = panelHTML(job, current.tab);
          document.getElementById('panel').dataset.tab = current.tab;
          document.querySelectorAll('.tab').forEach((t) => {
            const on = t.getAttribute('href').endsWith('/' + current.tab);
            t.classList.toggle('active', on); t.setAttribute('aria-selected', on);
          });
          renderShell(route);
          return;
        }
        current.jobId = m[1]; current.tab = tab;
        html = pageJob(m[1], tab);
      }
    }
    else if (path === '/jobs') { route = 'jobs'; html = guard('jobs', 'jobs', () => pageJobs(params)); }
    else if (path === '/customers') { route = 'customers'; html = guard('customers', 'customer history', () => pageCustomers(params)); }
    else if (path === '/reminders') { route = 'reminders'; html = guard('reminders', 'payment reminders', pageReminders); }
    else if (path === '/settings') { route = 'settings'; html = guard('settings', 'business settings', pageSettings); }
    else if (path === '/upgrade') { route = 'upgrade'; html = guard('team', 'plans and billing', pageUpgrade); }
    else if (path === '/team') { route = 'team'; html = guard('team', 'team management', () => pageTeam(params)); }
    else if (path === '/profile') { route = 'team'; html = pageProfile(acct.id); }
    else if ((m = path.match(/^\/team\/member\/([\w-]+)$/))) { route = 'team'; html = pageProfile(m[1]); }
    else if (path === '/chat' || (m = path.match(/^\/chat\/([\w-]+)$/))) {
      route = 'chat';
      current.chatId = m && m[1] ? m[1] : null;
      html = teamOn() ? guard('chat', 'team chat', () => pageChat(current.chatId)) : pageNoAccess('team chat');
    }
    else { route = 'home'; html = pageDashboard(); }

    current.route = route;
    if (route !== 'job') current.jobId = null;
    if (route !== 'chat') current.chatId = null;
    if (!path.startsWith('/todo/')) current.todoId = null;
    view.innerHTML = html;
    if (route === 'new' && pendingPaste) refreshMakeOptions(true);
    if (route === 'chat') afterChatRender();
    renderShell(route);
    window.scrollTo(0, 0);
    const h1 = view.querySelector('h1');
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    if (afterNav) { const f = afterNav; afterNav = null; f(); }
  }

  function rerender() {
    // full re-render of current route but keep scroll position
    const y = window.scrollY;
    current.route = '';
    router();
    window.scrollTo(0, y);
  }

  function refreshJobPanel(job) {
    const panel = document.getElementById('panel');
    if (!panel) return;
    if (panel.dataset.tab === 'reminder' && document.activeElement && document.activeElement.id === 'reminder-text') return;
    panel.innerHTML = panelHTML(job, current.tab || 'quote');
    panel.dataset.tab = current.tab || 'quote';
  }

  /* ================================================================ *
   * Actions
   * ================================================================ */

  let saveTimer;
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(() => S.save(), 300); }

  function currentJob() { return current.jobId ? S.getJob(current.jobId) : null; }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; });
    o[keys[keys.length - 1]] = value;
  }

  function snap(raw) {
    raw = (raw || '').trim();
    if (!raw) { toast('Paste a chat first'); return; }
    const job = jobFromChat(raw);
    S.addJob(job);
    location.hash = `#/job/${job.id}/quote`;
  }

  function issue(kind) {
    const job = currentJob();
    if (!job) return;
    if (S.docsLeft() <= 0) { upsell('limit'); return; }
    const s = settings();
    const date = todayISO();
    if (kind === 'quote') {
      job.quote = { number: S.nextNumber('quote'), date, validUntil: addDaysISO(date, s.quoteValidDays) };
      if (job.status === 'draft') job.status = 'quoted';
    } else {
      job.invoice = { number: S.nextNumber('invoice'), date, dueDate: addDaysISO(date, s.invoiceDueDays), paidAt: null };
      job.status = 'invoiced';
      if (isPro() && s.autoReminders) scheduleReminders(job);
    }
    (job.checklist || []).forEach((c) => { if (c.text.toLowerCase().startsWith(kind === 'quote' ? 'send quote' : 'send invoice')) c.done = true; });
    S.recordUsage(kind);
    S.save();
    toast(`${kind === 'quote' ? 'Quote' : 'Invoice'} ${kind === 'quote' ? job.quote.number : job.invoice.number} issued`);
    rerender();
  }

  const actions = {
    'close-modal': () => closeModal(),
    upsell: (el) => upsell(el.dataset.kind),
    sample: (el) => {
      const ta = document.getElementById('chat-input');
      const st = settings();
      const text = window.QSSamples.sampleText(el.dataset.key, { currencyCode: st.currencyCode, numberLocale: st.numberLocale, dateOrder: st.dateOrder });
      if (text && ta) { ta.value = text; ta.focus(); refreshMakeOptions(true); toast('Sample loaded. Pick what to make below'); }
    },
    snap: () => make((lastAnalysis && lastAnalysis.rec) || 'all'),
    make: (el) => make(el.dataset.kind),
    'clear-paste': () => { const ta = document.getElementById('chat-input'); if (ta) { ta.value = ''; ta.focus(); } pendingPaste = ''; refreshMakeOptions(true); },
    'quick-paste': () => {
      const ta = document.getElementById('quick-paste');
      pendingPaste = ta ? ta.value : '';
      location.hash = '#/new';
    },
    'new-empty-list': () => {
      const list = S.addList({ title: 'To-do list', source: '', items: [] });
      location.hash = `#/todo/${list.id}`;
      setTimeout(() => { const i = document.getElementById('todo-new'); if (i) i.focus(); }, 50);
    },
    'todo-urgent': (el) => { const l = currentList(); const it = l.items[Number(el.dataset.i)]; it.urgent = !it.urgent; S.save(); redrawTodo(); },
    'todo-remove': (el) => { const l = currentList(); l.items.splice(Number(el.dataset.i), 1); S.save(); redrawTodo(); },
    'todo-delete-list': (el) => {
      if (!confirm('Delete this to-do list?')) return;
      S.deleteList(el.dataset.id); location.hash = '#/todos';
    },
    'todo-copy': () => copyText(todoText(currentList())),
    'todo-to-job': () => { pendingPaste = currentList().source || ''; location.hash = '#/new'; },
    'issue-quote': () => issue('quote'),
    'issue-invoice': () => issue('invoice'),
    'needs-issue': (el, e) => {
      e.preventDefault();
      toast(`Issue the ${el.dataset.kind} first so it has a number`);
    },
    jump: (el, e) => { e.preventDefault(); document.querySelector('.output').scrollIntoView({ behavior: 'smooth' }); },
    'goto-invoice': () => { location.hash = `#/job/${current.jobId}/invoice`; },
    'mark-paid': () => {
      const job = currentJob();
      job.invoice.paidAt = new Date().toISOString();
      job.status = 'paid';
      S.save(); toast('Marked as paid 🎉'); rerender();
    },
    unpay: () => {
      const job = currentJob();
      job.invoice.paidAt = null; job.status = 'invoiced';
      S.save(); rerender();
    },
    print: () => window.print(),
    copy: (el) => copyText(el.dataset.text),
    'copy-reminder': () => copyText(document.getElementById('reminder-text').value),
    'reset-reminder': () => {
      const job = currentJob();
      delete job._reminderDraft; delete job._reminderTone;
      S.save(); refreshJobPanel(job);
    },
    tone: (el) => {
      const job = currentJob();
      job._tone = el.dataset.tone;
      delete job._reminderDraft; delete job._reminderTone;
      S.save(); refreshJobPanel(job);
    },
    'add-item': () => {
      const job = currentJob();
      job.items.push({ desc: '', qty: 1, unit: '', price: 0 });
      S.save();
      document.getElementById('editor').innerHTML = editorHTML(job);
      const rows = document.querySelectorAll('.it-desc');
      if (rows.length) rows[rows.length - 1].focus();
      refreshJobPanel(job);
    },
    'remove-item': (el) => {
      const job = currentJob();
      job.items.splice(Number(el.dataset.i), 1);
      if (!job.items.length) job.items.push({ desc: '', qty: 1, unit: '', price: 0 });
      S.save();
      document.getElementById('editor').innerHTML = editorHTML(job);
      refreshJobPanel(job);
    },
    reread: () => {
      const job = currentJob();
      if (!confirm('Read the chat again? This replaces the customer, items and checklist with what QuoteSnap finds.')) return;
      reparse(job, job.owner);
      S.save(); rerender(); toast('Chat re-read');
    },
    'delete-job': (el) => {
      if (!confirm('Delete this job and its documents? This can’t be undone.')) return;
      S.deleteJob(el.dataset.id);
      location.hash = '#/jobs';
    },
    'regen-checklist': () => {
      const job = currentJob();
      job.checklist = E.buildChecklist(job, settings());
      S.save(); refreshJobPanel(job); toast('Checklist rebuilt');
    },
    'add-check': (el) => {
      const job = currentJob();
      job.checklist.push({ text: '', group: el.dataset.group, done: false });
      S.save(); refreshJobPanel(job);
      const inputs = document.querySelectorAll('.cl-text');
      const idx = job.checklist.length - 1;
      const target = Array.from(inputs).find((i) => i.dataset.checkText === String(idx));
      if (target) target.focus();
    },
    'remove-check': (el) => {
      const job = currentJob();
      job.checklist.splice(Number(el.dataset.i), 1);
      S.save(); refreshJobPanel(job);
    },
    'mark-reminder-sent': (el) => {
      // the link itself opens WhatsApp; we just record that it was sent
      const job = S.getJob(el.dataset.job);
      const r = job && (job.reminders || []).find((x) => x.id === el.dataset.rem);
      if (r) { r.sentAt = new Date().toISOString(); S.save(); setTimeout(rerender, 300); }
    },
    'enable-notifications': async () => {
      if (typeof Notification === 'undefined') return;
      await Notification.requestPermission();
      rerender(); checkDueReminders();
    },
    upgrade: () => {
      modal(`
        <div class="upsell">
          <div class="upsell-icon">✨</div>
          <h3>${BETA ? 'Pro is free during the beta' : 'Start QuoteSnap Pro'}</h3>
          <p>${BETA ? `Turn on every Pro feature now at no cost. After the beta, Pro will be ${esc(S.PRO_PRICE.label)}/month. We'll tell you well before anything changes, and nothing is charged automatically.` : "Payments aren't connected in this version yet. This switches Pro on for this device so you can try every feature."}</p>
          <button class="btn btn-primary btn-block" data-action="confirm-upgrade">${BETA ? 'Turn on Pro for free' : 'Turn on Pro'}</button>
          <button class="btn btn-ghost btn-block" data-action="close-modal">Cancel</button>
        </div>`);
    },
    'confirm-upgrade': () => {
      S.state.plan = 'pro';
      // schedule reminders for invoices that already exist
      S.state.jobs.forEach((j) => { if (j.invoice && j.status === 'invoiced' && !(j.reminders || []).length) scheduleReminders(j); });
      S.save(); closeModal(); toast('Welcome to Pro ✨'); rerender();
    },
    downgrade: () => {
      if (!confirm('Switch back to the Free plan?')) return;
      S.state.plan = 'free'; S.save(); rerender();
    },
    'remove-logo': () => { settings().logo = null; S.save(); rerender(); },
    export: () => {
      const blob = new Blob([JSON.stringify(S.state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `quotesnap-backup-${todayISO()}.json`;
      S.state.lastBackupAt = new Date().toISOString();
      S.save();
      if (current.route === 'home') setTimeout(rerender, 300);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    reset: () => {
      if (!confirm('Erase ALL jobs, customers and settings on this device?')) return;
      if (!confirm('Really erase everything? Download a backup first if you might need it.')) return;
      S.reset(); location.hash = '#/'; rerender();
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const fn = actions[el.dataset.action];
    if (fn) {
      if (el.tagName === 'BUTTON') e.preventDefault();
      fn(el, e);
    }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form.dataset.actionSubmit !== 'todo-add') return;
    e.preventDefault();
    const input = document.getElementById('todo-new');
    const list = currentList();
    const val = (input.value || '').trim();
    if (!val || !list) return;
    const found = E.extractTasks(val, parseOptions())[0] || { text: val, due: '', time: '', urgent: false };
    list.items.push({ id: S.uid(), text: found.text || val, due: found.due, time: found.time, urgent: found.urgent, done: false });
    S.save(); redrawTodo();
    const again = document.getElementById('todo-new'); if (again) again.focus();
  });

  function updateTodoShare() {
    const a = document.getElementById('todo-share');
    const l = currentList();
    if (a && l) a.href = waLink('', todoText(l));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target.id === 'chat-input') { refreshMakeOptions(true); make((lastAnalysis && lastAnalysis.rec) || 'all'); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target.id === 'quick-paste') actions['quick-paste']();
    // Enter in a to-do task box moves on instead of adding a newline
    if (e.key === 'Enter' && !e.shiftKey && e.target.dataset && e.target.dataset.todoText !== undefined) { e.preventDefault(); const n = document.getElementById('todo-new'); if (n) n.focus(); }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    const job = currentJob();

    if (el.id === 'chat-input') { refreshMakeOptions(); return; }
    const list = currentList();
    if (list && el.dataset.todoTitle !== undefined) { list.title = el.value; saveSoon(); updateTodoShare(); return; }
    if (list && el.dataset.todoText !== undefined) { list.items[Number(el.dataset.todoText)].text = el.value; saveSoon(); updateTodoShare(); return; }

    if (el.dataset.bind && job) {
      let v = el.value;
      if (el.dataset.type === 'number') v = num(v);
      setPath(job, el.dataset.bind, v);
      saveSoon();
      const t = E.totals(job);
      const tot = document.getElementById('editor-totals');
      if (tot) tot.innerHTML = editorTotalsHTML(t, job);
      if (el.dataset.bind === 'customer.name') {
        const h1 = view.querySelector('.job-title h1');
        if (h1) h1.textContent = v || 'New job';
      }
      refreshJobPanel(job);
      return;
    }

    if (el.dataset.item !== undefined && job) {
      const i = Number(el.dataset.item);
      const field = el.dataset.field;
      let v = el.value;
      if (field === 'qty' || field === 'price') v = num(v);
      job.items[i][field] = v;
      saveSoon();
      const amt = document.querySelector(`[data-amt="${i}"]`);
      if (amt) amt.textContent = money((Number(job.items[i].qty) || 0) * (Number(job.items[i].price) || 0), job);
      const tot = document.getElementById('editor-totals');
      if (tot) tot.innerHTML = editorTotalsHTML(E.totals(job), job);
      refreshJobPanel(job);
      return;
    }

    if (el.dataset.checkText !== undefined && job) {
      job.checklist[Number(el.dataset.checkText)].text = el.value;
      saveSoon();
      return;
    }

    if (el.id === 'reminder-text' && job) {
      job._reminderDraft = el.value;
      job._reminderTone = el.dataset.reminderTone;
      saveSoon();
      const send = document.getElementById('reminder-send');
      if (send) send.href = waLink(job.customer.phone, el.value);
      return;
    }

    if (el.dataset.setting) {
      let v = el.value;
      if (el.dataset.type === 'number') v = num(v);
      settings()[el.dataset.setting] = v;
      saveSoon();
      renderShell(current.route);
      return;
    }

    if (el.dataset.actionInput === 'search-jobs') {
      clearTimeout(el._t);
      el._t = setTimeout(() => {
        const params = new URLSearchParams((location.hash.split('?')[1]) || '');
        if (el.value) params.set('q', el.value); else params.delete('q');
        history.replaceState(null, '', '#/jobs?' + params.toString());
        const pos = el.selectionStart;
        rerender();
        const s2 = view.querySelector('.search');
        if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); }
      }, 250);
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    const job = currentJob();
    if (el.dataset.dashCheck) {
      const [lid, idx] = el.dataset.dashCheck.split(':');
      const l = S.getList(lid);
      if (l && l.items[Number(idx)]) { l.items[Number(idx)].done = el.checked; S.save(); toast('Done ✓'); setTimeout(rerender, 350); }
      return;
    }
    const list = currentList();
    if (list && el.dataset.todoCheck !== undefined) { list.items[Number(el.dataset.todoCheck)].done = el.checked; S.save(); setTimeout(redrawTodo, 180); return; }
    if (list && el.dataset.todoDue !== undefined) { list.items[Number(el.dataset.todoDue)].due = el.value; S.save(); redrawTodo(); return; }

    if (el.dataset.check !== undefined && job) {
      job.checklist[Number(el.dataset.check)].done = el.checked;
      S.save(); refreshJobPanel(job);
      return;
    }
    if (el.dataset.bind === 'deposit.type' || el.dataset.bind === 'trade' || el.dataset.bind === 'currencyCode') {
      // structural change: redraw editor
      S.save();
      document.getElementById('editor').innerHTML = editorHTML(job);
      refreshJobPanel(job);
      return;
    }
    if (el.dataset.actionChange === 'assign' && job) {
      job.assignee = el.value || null;
      S.save();
      const who = T.member(team(), job.assignee);
      toast(who ? `Assigned to ${who.name}` : 'Unassigned');
      return;
    }
    if (el.dataset.actionChange === 'set-owner' && job) {
      reparse(job, el.value);
      S.save(); rerender(); toast(`Got it, you're “${el.value}”`);
      return;
    }
    if (el.dataset.actionChange === 'set-due' && job && el.value) {
      job.invoice.dueDate = el.value;
      if (isPro()) scheduleReminders(job);
      S.save(); refreshJobPanel(job);
      return;
    }
    if (el.dataset.region === 'country') {
      const st = settings();
      Object.assign(st, R.defaultsFor(el.value));
      Object.assign(st, S.withRegion(st));
      S.save(); rerender();
      toast(el.value ? `Set up for ${R.countryName(el.value)}` : 'Pick your currency and phone code below');
      return;
    }
    if (el.dataset.setting) {
      if (['currencyCode', 'dateOrder'].includes(el.dataset.setting)) {
        settings()[el.dataset.setting] = el.value;
        S.save(); rerender();
        return;
      }
      S.save();
      return;
    }

    if (el.dataset.action === 'upload-chat' && el.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        const ta = document.getElementById('chat-input');
        if (ta) ta.value = String(reader.result);
        refreshMakeOptions(true);
        toast('Loaded. Pick what to make below');
      };
      reader.readAsText(el.files[0]);
      return;
    }
    if (el.dataset.action === 'upload-logo' && el.files[0]) {
      resizeImage(el.files[0], 360).then((url) => {
        settings().logo = url;
        if (!S.save()) { settings().logo = null; toast('That image is too big, try a smaller one'); }
        rerender();
      }).catch(() => toast("Couldn't read that image"));
      return;
    }
    if (el.dataset.action === 'import' && el.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result));
          if (!data || !Array.isArray(data.jobs)) throw new Error('bad');
          if (!confirm(`Restore ${data.jobs.length} jobs from this backup? Your current data on this device will be replaced.`)) return;
          S.replaceAll(data); toast('Backup restored'); rerender();
        } catch (err) { toast("That doesn't look like a QuoteSnap backup"); }
      };
      reader.readAsText(el.files[0]);
    }
  });

  /* ---------------- Team & chat events ---------------- */

  Object.assign(actions, {
    'mobile-menu': () => accountMenu(true),
    'snooze-backup': () => { S.state.backupSnoozeUntil = addDaysISO(todayISO(), 3); S.save(); rerender(); },
    'account-menu': () => accountMenu(false),
    'switch-user': () => {
      // switching always means the next person logs in with their own password
      S.signOut(); closeModal();
      go('#/login?switch=1');
    },
    'sign-out': () => { S.signOut(); closeModal(); go('#/login'); toast('Signed out'); },
    'reset-password': (el) => {
      const m = T.member(team(), el.dataset.id);
      if (!m || !T.canOpenProfile(team(), account()) || m.id === account().id || m.roleId === 'owner') return;
      if (!confirm(`Reset ${m.name}'s password? They'll be signed out and need a new invite code to choose a new password.`)) return;
      T.resetPassword(m); S.save(); rerender(); toast('Password reset. Send them the new invite code');
    },
    'new-invite': (el) => {
      const m = T.member(team(), el.dataset.id);
      if (!m || m.passHash) return;
      m.inviteCode = T.inviteCode(); S.save(); rerender(); toast('New invite code made. The old one no longer works');
    },
    'team-add': () => {
      modal(`
        <div class="upsell">
          <div class="upsell-icon">👥</div>
          <h3>${BETA ? 'Teams is free during the beta' : `Add Teams for ${esc(teamPriceLabel())}/month`}</h3>
          <p>${BETA ? `Set up your team now at no cost. After the beta, Teams will be ${esc(teamPriceLabel())}/month. We'll tell you before anything changes, and nothing is charged automatically.` : "Payments aren't connected in this version yet. This turns Teams on for this device so you can set it up and try it."}</p>
          <button class="btn btn-primary btn-block" data-action="team-confirm">${BETA ? 'Turn on Teams for free' : 'Turn on Teams'}</button>
          <button class="btn btn-ghost btn-block" data-action="close-modal">Cancel</button>
        </div>`);
    },
    'team-confirm': () => {
      S.state.teamAddon = true;
      T.enable(team(), settings().ownerName || settings().businessName || 'Owner');
      S.save(); closeModal(); toast('Teams is on 🎉 Add your first person');
      location.hash = '#/team';
      rerender();
    },
    'team-remove': () => {
      if (!confirm('Remove the Teams add-on? Your people, roles and chats are kept, so you can turn it back on later.')) return;
      S.state.teamAddon = false;
      team().enabled = false;
      if (account() && account().roleId !== 'owner') S.signOut();
      S.save(); location.hash = '#/'; rerender();
    },
    'remove-member': (el) => {
      const m = T.member(team(), el.dataset.id);
      if (!m || !can('team') || m.id === account().id || !confirm(`Remove ${m.name} from the team?`)) return;
      if (T.wouldLockOut(team(), { memberId: m.id, newRoleId: 'field' }) && T.can(team(), m, 'team')) { toast('Someone must still be able to manage the team'); return; }
      T.removeMember(team(), m.id);
      S.save();
      if (location.hash.startsWith('#/team/member/')) location.hash = '#/team'; else rerender();
    },
    invite: (el) => {
      const m = T.member(team(), el.dataset.id);
      if (!m) return;
      if (!m.inviteCode) { toast(`${m.name} has already signed up`); return; }
      const biz = settings().businessName || 'our business';
      const msg = inviteText(m);
      const isEmail = /@/.test(m.contact || '');
      const href = isEmail ? `mailto:${encodeURIComponent(m.contact)}?subject=${encodeURIComponent('Join ' + biz + ' on QuoteSnap')}&body=${encodeURIComponent(msg)}` : waLink(m.contact || '', msg);
      window.open(href, '_blank', 'noopener');
    },
    'remove-role': (el) => {
      const r = team().roles.find((x) => x.id === el.dataset.id);
      if (!r) return;
      if (team().members.some((m) => m.roleId === r.id)) { toast(`Move everyone off “${r.name}” first`); return; }
      if (!confirm(`Delete the role “${r.name}”?`)) return;
      T.removeRole(team(), r.id); S.save(); rerender();
    },
    'remove-chat': (el) => {
      const c = team().channels.find((x) => x.id === el.dataset.id);
      if (!c || !confirm(`Delete the chat “${T.channelTitle(team(), c, me())}” and its messages?`)) return;
      team().channels = team().channels.filter((x) => x.id !== c.id);
      team().messages = team().messages.filter((x) => x.channelId !== c.id);
      S.save(); rerender();
    },
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target;
    const kind = form.dataset.actionSubmit;
    if (!kind || kind === 'todo-add') return;
    e.preventDefault();
    if (kind.startsWith('auth-')) { await handleAuth(kind, form); return; }
    if (kind.startsWith('profile-')) { await handleProfile(kind, form); return; }
    const t = team();
    if (kind === 'add-member') {
      if (!can('team')) return;
      const name = form.elements.name.value.trim();
      if (!name) { toast('Add their name'); return; }
      const contact = form.elements.contact.value.trim();
      if (contact && loginTaken(T.normalizeLogin(contact), null)) { toast('Someone on the team already uses that email or phone'); return; }
      const m = T.addMember(t, { name, contact, roleId: form.elements.role.value });
      S.save(); rerender();
      setTimeout(() => {
        modal(`<div class="upsell"><div class="upsell-icon">📨</div><h3>${esc(m.name.split(' ')[0])} needs to sign up</h3>
          <p class="muted">Their invite code:</p><p class="recovery-code">${esc(m.inviteCode)}</p>
          <p class="muted small">They open QuoteSnap, tap <b>Use your invite code</b>, and choose their own password.</p>
          <button class="btn btn-wa btn-block" data-action="invite" data-id="${m.id}">Send invite</button>
          <button class="btn btn-ghost btn-block" data-action="copy" data-text="${esc(inviteText(m))}">Copy invite</button>
          <button class="btn btn-ghost btn-block" data-action="close-modal">Done</button></div>`);
      }, 50);
    } else if (kind === 'add-role') {
      const r = T.addRole(t, form.elements.name.value);
      S.save(); rerender(); toast(`Role “${r.name}” added. Tick what it can do`);
    } else if (kind === 'add-chat') {
      const ids = Array.from(form.querySelectorAll('[data-new-chat-member]:checked')).map((i) => i.dataset.newChatMember);
      const c = T.addChannel(t, { name: form.elements.name.value, memberIds: ids, createdBy: me().id });
      S.save(); toast('Chat created'); location.hash = `#/chat/${c.id}`;
    } else if (kind === 'send-chat') {
      const ta = document.getElementById('chat-text');
      const jobSel = document.getElementById('chat-job');
      const msg = T.postMessage(t, { channelId: current.chatId, from: me().id, text: ta.value, jobId: jobSel ? jobSel.value : '' });
      if (!msg) return;
      ta.value = '';
      S.save();
      refreshChat();
      const again = document.getElementById('chat-text'); if (again) again.focus();
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!teamOn()) return;
    const t = team();
    if (el.dataset.memberRole) {
      const m = T.member(t, el.dataset.memberRole);
      if (!T.canChangeRole(t, account(), m)) { toast('Only a manager can change roles, and not their own'); rerender(); return; }
      if (T.wouldLockOut(t, { memberId: m.id, newRoleId: el.value })) { toast('Someone must still be able to manage the team'); el.value = m.roleId; return; }
      m.roleId = el.value;
      S.save(); toast(`${m.name} is now ${(T.roleOf(t, m) || {}).name}`); rerender();
    } else if (el.dataset.rolePerm) {
      const [roleId, key] = el.dataset.rolePerm.split(':');
      const r = t.roles.find((x) => x.id === roleId);
      const val = el.type === 'checkbox' ? el.checked : el.value;
      if (key === 'team' && !val && T.wouldLockOut(t, { roleId, perms: { team: false } })) { toast('Someone must still be able to manage the team'); el.checked = true; return; }
      r.perms[key] = val;
      S.save(); renderShell(current.route);
    } else if (el.dataset.chanMember) {
      const [cid, mid] = el.dataset.chanMember.split(':');
      const c = t.channels.find((x) => x.id === cid);
      if (el.checked && !c.memberIds.includes(mid)) c.memberIds.push(mid);
      if (!el.checked) c.memberIds = c.memberIds.filter((x) => x !== mid);
      S.save(); renderShell(current.route);
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!teamOn()) return;
    if (el.dataset.roleName) { const r = team().roles.find((x) => x.id === el.dataset.roleName); if (r) { r.name = el.value; saveSoon(); } }
    if (el.dataset.memberName) { const m = T.member(team(), el.dataset.memberName); if (m && el.value.trim()) { m.name = el.value; saveSoon(); renderShell(current.route); } }
    if (el.dataset.chanName) { const c = team().channels.find((x) => x.id === el.dataset.chanName); if (c) { c.name = el.value; saveSoon(); } }
    if (el.id === 'chat-text') { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'chat-text' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });

  // Another tab (another team member) changed something: pick it up — this is what makes chat live.
  window.addEventListener('storage', (e) => {
    if (e.key !== S.KEY) return;
    S.reload();
    if (current.route === 'chat') refreshChat();
    else if (!/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) rerender();
    else renderShell(current.route);
  });

  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // allow pasting a chat anywhere on the New page
  document.addEventListener('paste', (e) => {
    if (current.route !== 'new') return;
    const ta = document.getElementById('chat-input');
    if (!ta || e.target === ta || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    ta.value = e.clipboardData.getData('text');
    ta.focus();
    e.preventDefault();
    refreshMakeOptions(true);
  });

  /* ================================================================ *
   * Reminder notifications (Pro)
   * ================================================================ */

  function checkDueReminders() {
    if (!isPro()) return;
    let changed = false;
    allReminders().forEach(({ job, r, state }) => {
      if (state !== 'due' || r.notified) return;
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const n = new Notification('Payment reminder due', {
            body: `${job.customer.name || 'Customer'} · ${job.invoice.number} · ${money(E.totals(job).total, job)}`,
            tag: r.id,
          });
          n.onclick = () => { window.focus(); location.hash = `#/job/${job.id}/reminder`; };
        } catch (e) { /* some browsers need a service worker; the in-app badge still shows */ }
      }
      r.notified = true; changed = true;
    });
    if (changed) S.save();
    renderShell(current.route);
  }

  S.on((type) => { if (type === 'save-error') toast('Storage is full. Download a backup and remove your logo.'); });

  // Works offline and can be installed on phones (only when served from a website, not a local file)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ }); });
  }

  window.addEventListener('hashchange', router);
  router();
  checkDueReminders();
  setInterval(checkDueReminders, 60 * 1000);
})();
