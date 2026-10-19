/*
 * QuoteSnap engine — turns a messy WhatsApp conversation into structured job data,
 * and generates checklist / message text from a job.
 *
 * Pure functions, no DOM. Works in the browser (window.QSEngine) and in Node (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QSEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. Splitting the chat into messages
   * ------------------------------------------------------------------ */

  const SYSTEM_PATTERNS = [
    /<media omitted>/i,
    /\b(image|video|audio|sticker|document|gif|contact card) omitted\b/i,
    /end-to-end encrypted/i,
    /this message was deleted/i,
    /you deleted this message/i,
    /missed (voice|video) call/i,
    /^null$/i,
  ];

  const DATE_PART = '(\\d{1,4}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{1,4})';
  const TIME_PART = '(\\d{1,2}[:.]\\d{2}(?:[:.]\\d{2})?\\s?(?:[ap]\\.?\\s?m\\.?)?)';

  // Each pattern returns [date, time, sender, text] via the `order` map.
  const TS_PATTERNS = [
    // iOS export:      [12/10/2026, 09:15:22] Sarah: hello
    { re: new RegExp(`^\\[${DATE_PART},?\\s+${TIME_PART}\\]\\s*([^:]{1,60}?):\\s?(.*)$`, 'i'), order: [1, 2, 3, 4] },
    // Android export:  12/10/2026, 09:15 - Sarah: hello
    { re: new RegExp(`^${DATE_PART},?\\s+${TIME_PART}\\s*[-–—]\\s*([^:]{1,60}?):\\s?(.*)$`, 'i'), order: [1, 2, 3, 4] },
    // Desktop copy:    [09:15, 12/10/2026] Sarah: hello
    { re: new RegExp(`^\\[${TIME_PART},\\s*${DATE_PART}\\]\\s*([^:]{1,60}?):\\s?(.*)$`, 'i'), order: [2, 1, 3, 4] },
  ];

  const SIMPLE_PATTERN = /^([A-Za-zÀ-ɏ+][\wÀ-ɏ .'’+()-]{0,40}?):\s+(.+)$/;

  let dateOrder = 'DMY'; // how ambiguous dates like 05/06 are read; set from the user's country

  function cleanLine(line) {
    return line
      .replace(/[‎‏‪-‮﻿]/g, '')
      .replace(/[  ]/g, ' ')
      .replace(/\s+$/, '');
  }

  function parseTimestamp(datePart, timePart, order) {
    if (!datePart) return null;
    const nums = datePart.split(/[\/.\-]/).map(Number);
    let d, m, y;
    if (String(datePart.split(/[\/.\-]/)[0]).length === 4) {
      [y, m, d] = nums;
    } else {
      const [a, b, c] = nums;
      y = c;
      if (a > 12) { d = a; m = b; }
      else if (b > 12) { m = a; d = b; }
      else if ((order || dateOrder) === 'MDY') { m = a; d = b; }
      else { d = a; m = b; }
    }
    if (y < 100) y += 2000;
    let hh = 0, mm = 0;
    if (timePart) {
      const t = timePart.toLowerCase().replace(/\s|\./g, '');
      const tm = t.match(/^(\d{1,2})[:.]?(\d{2})/);
      if (tm) {
        hh = Number(tm[1]); mm = Number(tm[2]);
        if (/pm/.test(t) && hh < 12) hh += 12;
        if (/am/.test(t) && hh === 12) hh = 0;
      }
    }
    const date = new Date(y, m - 1, d, hh, mm);
    return isNaN(date) ? null : date;
  }

  function isSystem(text) {
    return SYSTEM_PATTERNS.some((re) => re.test(text.trim()));
  }

  function splitMessages(raw) {
    const lines = String(raw || '').split(/\r?\n/).map(cleanLine);
    const tsMatches = lines.map((l) => {
      for (const p of TS_PATTERNS) {
        const m = l.match(p.re);
        if (m) return { dateRaw: m[p.order[0]], timeRaw: m[p.order[1]], sender: m[p.order[2]].trim(), text: m[p.order[3]] };
      }
      return null;
    });
    // work out day-first vs month-first from the chat itself (any 13+ settles it)
    let order = null;
    tsMatches.forEach((t) => {
      if (!t || order) return;
      const parts = t.dateRaw.split(/[\/.\-]/).map(Number);
      if (String(t.dateRaw.split(/[\/.\-]/)[0]).length === 4) return;
      if (parts[0] > 12) order = 'DMY';
      else if (parts[1] > 12) order = 'MDY';
    });
    // no proof in the timestamps? look at dates people typed, like "10/14"
    if (!order) {
      const re = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?(?![\d/])/g;
      lines.forEach((l, i) => {
        if (order) return;
        const text = tsMatches[i] ? tsMatches[i].text : l;
        let m;
        while ((m = re.exec(text)) && !order) {
          if (Number(m[1]) > 12 && Number(m[2]) <= 12) order = 'DMY';
          else if (Number(m[2]) > 12 && Number(m[1]) <= 12) order = 'MDY';
        }
      });
    }
    if (order) dateOrder = order; // also used for dates mentioned in the messages
    tsMatches.forEach((t) => { if (t) t.date = parseTimestamp(t.dateRaw, t.timeRaw, order); });
    const hasTimestamps = tsMatches.filter(Boolean).length >= 1;

    let matches = tsMatches;
    if (!hasTimestamps) {
      matches = lines.map((l) => {
        const m = l.match(SIMPLE_PATTERN);
        return m ? { date: null, sender: m[1].trim(), text: m[2] } : null;
      });
      // A "Labour: R450" line looks like a sender. If a name only appears once while
      // two or more real speakers exist, treat it as a continuation line instead.
      const counts = {};
      matches.forEach((m) => { if (m) counts[m.sender] = (counts[m.sender] || 0) + 1; });
      const realSpeakers = Object.keys(counts).filter((k) => counts[k] >= 2);
      if (realSpeakers.length >= 2) {
        matches = matches.map((m) => (m && counts[m.sender] < 2 ? null : m));
      }
    }

    const messages = [];
    lines.forEach((line, i) => {
      const m = matches[i];
      if (m) {
        messages.push({ date: m.date, sender: m.sender, text: m.text });
      } else if (line.trim()) {
        if (messages.length) messages[messages.length - 1].text += '\n' + line;
        else messages.push({ date: null, sender: '', text: line });
      }
    });

    return messages
      .map((m) => ({ ...m, text: m.text.replace(/<this message was edited>/gi, '').trim() }))
      .filter((m) => m.text && !isSystem(m.text));
  }

  /* ------------------------------------------------------------------ *
   * 2. Money — any currency, symbol before or after, any number style
   * ------------------------------------------------------------------ */

  // token → ISO currency code ('' = ambiguous, decided by the user's settings)
  const PREFIX_TOKENS = {
    'US$': 'USD', 'A$': 'AUD', 'AU$': 'AUD', 'C$': 'CAD', 'CA$': 'CAD', 'NZ$': 'NZD', 'HK$': 'HKD', 'S$': 'SGD', 'SG$': 'SGD',
    'R$': 'BRL', 'N$': 'NAD', 'MX$': 'MXN', 'NT$': 'TWD', 'J$': 'JMD', 'TT$': 'TTD', 'RD$': 'DOP', 'Bds$': 'BBD', 'FJ$': 'FJD',
    '$': '$', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '￥': 'JPY', '₹': 'INR', 'Rs.': 'INR', 'Rs': 'INR', '₨': 'PKR', '₦': 'NGN', '₱': 'PHP',
    '₩': 'KRW', '₪': 'ILS', '₺': 'TRY', '₫': 'VND', '฿': 'THB', '₴': 'UAH', '₽': 'RUB', 'GH₵': 'GHS', '₵': 'GHS', '₸': 'KZT',
    '₼': 'AZN', '₾': 'GEL', '₡': 'CRC', '₲': 'PYG', 'S/.': 'PEN', 'S/': 'PEN', 'KSh': 'KES', 'Ksh': 'KES', 'Kshs': 'KES', 'USh': 'UGX',
    'TSh': 'TZS', 'Rp': 'IDR', 'RM': 'MYR', 'R': 'ZAR', 'CHF': 'CHF', 'Fr.': 'CHF', 'E£': 'EGP', 'LE': 'EGP', 'Dhs': 'AED', 'AED': 'AED',
    'SR': 'SAR', 'QR': 'QAR', 'KD': 'KWD', 'BD': 'BHD', 'zł': 'PLN', 'kr': 'kr', 'Kr': 'kr', 'kr.': 'kr', 'Kč': 'CZK', 'Ft': 'HUF',
    'lei': 'RON', 'DH': 'MAD', 'Tk': 'BDT', '৳': 'BDT', 'K': 'ZMW', 'P': 'BWP', 'Q': 'GTQ', 'L': 'HNL', 'Bs': 'BOB', 'MT': 'MZN',
  };
  const SUFFIX_TOKENS = {
    '€': 'EUR', '£': 'GBP', '¥': 'JPY', '円': 'JPY', '元': 'CNY', '원': 'KRW', '₩': 'KRW', '₹': 'INR', '₺': 'TRY', 'TL': 'TRY',
    '₫': 'VND', 'đ': 'VND', '₽': 'RUB', '₴': 'UAH', '฿': 'THB', 'zł': 'PLN', 'kr': 'kr', 'kr.': 'kr', ',-': 'kr', 'Kč': 'CZK',
    'Ft': 'HUF', 'lei': 'RON', 'Lei': 'RON', 'DH': 'MAD', 'Dh': 'MAD', 'CHF': 'CHF', 'Fr.': 'CHF', '$': '$', '₪': 'ILS', '₦': 'NGN',
    'Rs': 'INR', '/-': 'INR',
  };
  const WORD_TOKENS = {
    dollars: '$', dollar: '$', bucks: '$', euros: 'EUR', euro: 'EUR', pounds: 'GBP', quid: 'GBP', rand: 'ZAR', naira: 'NGN',
    shillings: 'KES', shilling: 'KES', bob: 'KES', rupees: 'INR', rupee: 'INR', pesos: 'MXN', peso: 'MXN', reais: 'BRL', real: 'BRL',
    yen: 'JPY', yuan: 'CNY', rmb: 'CNY', won: 'KRW', dirhams: 'AED', dirham: 'AED', riyals: 'SAR', riyal: 'SAR', lira: 'TRY',
    zloty: 'PLN', kroner: 'kr', kronor: 'kr', krona: 'kr', krone: 'kr', francs: 'CHF', franc: 'CHF', cedis: 'GHS', cedi: 'GHS',
    kwacha: 'ZMW', pula: 'BWP', ringgit: 'MYR', rupiah: 'IDR', baht: 'THB', dong: 'VND', soles: 'PEN', sol: 'PEN', dinars: 'TND',
    quetzales: 'GTQ', colones: 'CRC', forint: 'HUF', hryvnia: 'UAH', rubles: 'RUB', roubles: 'RUB', shekels: 'ILS', shekel: 'ILS',
  };
  const ISO_CODES = ('USD EUR GBP JPY CNY INR AUD CAD NZD CHF HKD SGD SEK NOK DKK ISK PLN CZK HUF RON BGN RSD UAH TRY GEL AMD AZN KZT UZS ' +
    'ILS AED SAR QAR KWD BHD OMR JOD LBP EGP MAD DZD TND NGN GHS KES UGX TZS RWF ETB ZAR NAD BWP ZMW MWK MZN XOF XAF MUR PKR BDT ' +
    'LKR NPR TWD KRW MYR IDR PHP THB VND FJD BRL ARS CLP COP PEN VES UYU PYG BOB CRC GTQ HNL NIO DOP JMD TTD BSD BBD MXN RUB').split(' ');

  // word-ish tokens that also exist as ordinary words need a number right next to them
  const RISKY = new Set(['K', 'P', 'Q', 'L', 'R', 'MT', 'Bs', 'BD', 'LE', 'SR', 'KD', 'QR', 'Tk', 'đ', 'TL']);

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }

  // numbers: 1200 · 1,200 · 1.200 · 1 200 · 1'200 · 1,20,000 · 1,200.50 · 1.200,50 · 12,50
  const NUM = '(\\d{1,3}(?:[,.\\u00a0\\u202f\' ’]\\d{3})+(?:[.,]\\d{1,2})?|\\d{1,2}(?:,\\d{2})+,\\d{3}(?:\\.\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';

  let moneyCache = { key: null };
  let extraTokens = { symbol: '', code: '' };

  function moneyRegex() {
    const key = extraTokens.symbol + '|' + extraTokens.code;
    if (moneyCache.key === key) return moneyCache;
    const pre = Object.keys(PREFIX_TOKENS).concat(ISO_CODES);
    const suf = Object.keys(SUFFIX_TOKENS).concat(ISO_CODES);
    if (extraTokens.symbol) { pre.push(extraTokens.symbol); suf.push(extraTokens.symbol); }
    const words = Object.keys(WORD_TOKENS).flatMap((w) => [w, w.charAt(0).toUpperCase() + w.slice(1)]);
    const alt = (list) => Array.from(new Set(list)).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    // letters like R, K, P, Q, L are only money when they're the user's own currency (R350 in South Africa, K350 in Zambia)
    const isRisky = (t) => RISKY.has(t) && !(extraTokens.symbol === t);
    const own = (t) => PREFIX_TOKENS[t] === extraTokens.code || extraTokens.symbol === t;
    const preSafe = alt(pre.filter((t) => !RISKY.has(t) || own(t)));
    const riskyList = pre.filter((t) => RISKY.has(t) && (PREFIX_TOKENS[t] === extraTokens.code || extraTokens.symbol === t));
    const preRisky = riskyList.length ? alt(riskyList) : '(?!)';
    const sufAll = alt(suf.filter((t) => !isRisky(t) || SUFFIX_TOKENS[t] === extraTokens.code).concat(words));
    const src =
      // prefix: "$350", "€ 350", "USD 350", and R350 / K350 only touching the number
      `(?<![A-Za-z0-9])(?:(${preSafe})\\s?|(${preRisky}))${NUM}(\\s?k\\b|\\s?K\\b)?(?![\\d%])` +
      // suffix: "350 €", "350kr", "1.200,50 zł", "350 dollars", "350/-"
      `|(?<![\\d.,A-Za-z])${NUM}(k)?\\s?(${sufAll})(?![A-Za-z])`;
    moneyCache = { key, re: new RegExp(src, 'g') };
    return moneyCache;
  }

  /** Turn "1.200,50", "1,200.50", "1 200", "1,20,000", "12,5" into a number. */
  function parseAmount(raw) {
    if (typeof raw === 'number') return raw;
    let s = String(raw == null ? '' : raw).replace(/[\s  '’]/g, '').replace(/[^\d.,-]/g, '');
    if (!s) return NaN;
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot > -1 && lastComma > -1) {
      const dec = lastDot > lastComma ? '.' : ',';
      const thou = dec === '.' ? ',' : '.';
      s = s.split(thou).join('').replace(dec, '.');
    } else if (lastDot > -1 || lastComma > -1) {
      const sep = lastDot > -1 ? '.' : ',';
      const parts = s.split(sep);
      if (parts.length > 2 || parts[parts.length - 1].length === 3) s = parts.join(''); // thousands
      else s = parts.join('.'); // decimal
    }
    return parseFloat(s);
  }

  function findMoney(text) {
    const { re } = moneyRegex();
    re.lastIndex = 0;
    const out = [];
    let m;
    while ((m = re.exec(text))) {
      let num, k, token;
      if (m[3] !== undefined) { token = m[1] || m[2]; num = m[3]; k = m[4]; }
      else { num = m[5]; k = m[6]; token = m[7]; }
      let value = parseAmount(num);
      if (k) value *= 1000;
      if (isNaN(value)) continue;
      out.push({ value, index: m.index, length: m[0].length, raw: m[0], token: (token || '').trim() });
    }
    return out;
  }

  function tokenCode(token) {
    if (!token) return '';
    if (extraTokens.symbol && token === extraTokens.symbol) return extraTokens.code;
    if (ISO_CODES.includes(token)) return token;
    return PREFIX_TOKENS[token] || SUFFIX_TOKENS[token] || WORD_TOKENS[token.toLowerCase()] || '';
  }

  /** Most-used currency in the text, as an ISO code ('$' / 'kr' when ambiguous). */
  function detectCurrency(text) {
    const counts = {};
    findMoney(text).forEach((m) => { const c = tokenCode(m.token); if (c) counts[c] = (counts[c] || 0) + 1; });
    const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    return best || null;
  }

  /* ------------------------------------------------------------------ *
   * Formatting (Intl) — money and dates in the user's local style
   * ------------------------------------------------------------------ */

  function formatMoney(n, code, locale) {
    const v = Number(n) || 0;
    const opts = { style: 'currency', currency: code || 'USD' };
    try { return new Intl.NumberFormat(locale || 'en', { ...opts, currencyDisplay: 'narrowSymbol' }).format(v); }
    catch (e) {
      try { return new Intl.NumberFormat(locale || 'en', opts).format(v); }
      catch (_) { return `${code || ''} ${v.toFixed(2)}`.trim(); }
    }
  }

  function currencySymbol(code, locale) {
    try {
      const parts = new Intl.NumberFormat(locale || 'en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(1);
      const p = parts.find((x) => x.type === 'currency');
      return p ? p.value : code;
    } catch (e) { return code; }
  }

  /** Is the detected currency token compatible with the user's currency? ('$' fits USD, CAD, AUD…) */
  function currencyMatches(detected, code, locale) {
    if (!detected || !code) return true;
    if (detected === code) return true;
    const sym = currencySymbol(code, locale);
    if (detected === '$') return sym.includes('$');
    if (detected === 'kr') return /kr/i.test(sym);
    if (detected === 'INR') return ['INR', 'PKR', 'LKR', 'NPR', 'MUR'].includes(code); // "Rs" is shared
    if (detected === 'JPY') return ['JPY', 'CNY'].includes(code); // ¥ is shared
    return false;
  }

  function formatDate(iso, locale, opts) {
    if (!iso) return '';
    const d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d)) return String(iso);
    try { return d.toLocaleDateString(locale || 'en', opts || { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return d.toDateString(); }
  }

  /** Formatter bound to one job + the user's settings. */
  function fmt(job, settings) {
    settings = settings || {};
    const locale = settings.locale || 'en';
    const code = (job && job.currencyCode) || settings.currencyCode || 'USD';
    return {
      money: (n) => formatMoney(n, code, settings.numberLocale || locale),
      date: (iso, opts) => formatDate(iso, locale, opts),
      code,
      locale,
    };
  }

  /* ------------------------------------------------------------------ *
   * 3. Line items
   * ------------------------------------------------------------------ */

  const LEADING_FILLER = /^(?:ok(?:ay)?|cool|sure|great|perfect|alright|right|so|then|and|plus|also|but|the|a|an|for|it'?s|its|it is|it will be|it'll be|that'?s|that is|that will be|that'll be|will be|would be|is|are|they'?re|they are|those are|these are|cost(?:s|ing)?|price(?: is)?|about|around|roughly|approx\.?|just|only|i charge|i'?ll charge|i can do|can do|i do|we do|we charge|my price for|price for|for the|for your|your|yes|yeah|no problem|hi|hello|hey|my|i'll need|i need|need|=|:|-|–|—)\b[\s,:.-]*/i;
  const TRAILING_FILLER = /[\s,:.-]*\b(?:each|per (?:item|piece|one|unit|person|head|hour|hr|day|week|month|kg|m|metre|meter|page|session)|ea|apiece|a piece|for|at|is|are|will be|would be|costs?|would cost|comes to|please|then|only|just|=|@|:|-|–|—|incl(?:uding)?\.?(?: vat)?|excl(?:uding)?\.?(?: vat)?)$/i;
  const CLEAN_PUNCT = /^[\s,:;.!?()*@=+–—-]+|[\s,:;.!?(*@=+–—-]+$/g;

  function stripFiller(desc) {
    let prev;
    let s = desc.replace(/\s+/g, ' ').trim();
    do {
      prev = s;
      s = s.replace(LEADING_FILLER, '').replace(TRAILING_FILLER, '').replace(CLEAN_PUNCT, '').trim();
    } while (s !== prev);
    return s;
  }

  function capitalise(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function splitSegments(text) {
    const strong = text
      .split(/\n|;|•|·|,\s+|\.\s+(?=[A-Z0-9])|!\s+|\?\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const out = [];
    strong.forEach((seg) => {
      // only split on "and"/"plus" when every piece carries its own price
      const parts = seg.split(/\s+(?:and|plus|&|\+)\s+/i);
      if (parts.length > 1 && parts.every((p) => findMoney(p).length === 1)) out.push(...parts);
      else out.push(seg);
    });
    return out;
  }

  const SKIP_ITEM = /\b(budget|afford|too (?:much|expensive|pricey)|cheaper|last time|paid you|sent you|i (?:have|got) only|can you do it for|other guy|someone else)\b/i;
  const TOTAL_WORDS = /\b(total|altogether|all in|all-in|comes to|grand total|in total|sum of|overall)\b/i;
  const DEPOSIT_WORDS = /\b(deposit|upfront|up front|to book|booking fee|to secure)\b/i;
  const DISCOUNT_WORDS = /\b(discount|less|off)\b/i;
  const PER_UNIT = /\b(each|per|ea|apiece|a piece|a pop|a head)\b|@|\/\s?(?:hr|hour|item|unit|kg|m|day|page)\b/i;
  const HOURLY = /\b(?:per hour|an hour|p\/?h|\/\s?hr?|hourly|per hr)\b/i;

  const MEASURE_WORDS = /^(tiers?|tiered|layers?|seaters?|bedroom|bed|storey|story|plate|burner|doors?|tons?|kg|litres?|liters?|l|ml|m|metres?|meters?|inch|cm|mm|years?|months?|weeks?|days?|pages?|steps?|minutes?|mins?|sq|square|panel|way|pin|amp|watt|kw)\b/i;

  const OWE_WORDS = /\b(owe[sd]?|owing|outstanding|balance (?:of|due|is)|still due|unpaid|haven'?t paid|have not paid|not paid yet|overdue|still need to pay|pay me)\b/i;
  const MONEY_SRC_FOR_STRIP = '[$€£¥₹₦₱₩₪₺₫฿₴₽₵]\\s?[\\d.,]+|\\b[A-Z]{3}\\s?[\\d.,]+|[\\d.,]+\\s?(?:€|kr|zł|dollars|euros|pounds)';

  function parseItemSegment(seg) {
    const money = findMoney(seg);
    if (!money.length) return null;
    if (SKIP_ITEM.test(seg)) return null;

    let chosen;
    if (money.length === 1) chosen = money[0];
    else if (PER_UNIT.test(seg)) chosen = money[0];
    else chosen = money[money.length - 1];

    if (OWE_WORDS.test(seg)) {
      const f = seg.match(/\bfor (?:the |your |my |our |that |those )?(.+?)[.!?]*$/i);
      let what = f ? f[1] : '';
      what = what.replace(new RegExp(MONEY_SRC_FOR_STRIP, 'g'), '').replace(/\b(from|since|on|last|this|yesterday|ago)\b.*$/i, '').trim();
      return { kind: 'item', desc: capitalise(what || 'Outstanding balance'), qty: 1, unit: '', price: chosen.value, perUnit: false, owed: true };
    }
    if (TOTAL_WORDS.test(seg)) return { kind: 'total', value: chosen.value };
    if (DEPOSIT_WORDS.test(seg)) return { kind: 'deposit', value: chosen.value };

    // remove all money mentions from the description
    let desc = seg;
    money.slice().reverse().forEach((m) => { desc = desc.slice(0, m.index) + ' ' + desc.slice(m.index + m.length); });

    // quantity: "2 x", "2x", "24 cupcakes", "3 hours"
    let qty = null;
    let unit = '';
    const hours = desc.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/i);
    const xQty = desc.match(/(?:^|\s)(\d{1,4})\s*[x×]\s*/i) || desc.match(/\s[x×]\s*(\d{1,4})\b/i);
    const leadStripped = desc.replace(/^\s+/, '').replace(LEADING_FILLER, '').replace(LEADING_FILLER, '');
    const nounQtyM = leadStripped.match(/^(\d{1,4})\s+(?=[a-z])/i);
    const nounQty = nounQtyM && !MEASURE_WORDS.test(leadStripped.slice(nounQtyM[0].length)) ? [nounQtyM[1] + ' ', nounQtyM[1]] : null;
    if (hours) {
      qty = parseFloat(hours[1]);
      unit = 'hr';
      desc = desc.replace(hours[0], ' ');
    } else if (xQty) {
      qty = parseInt(xQty[1], 10);
      desc = desc.replace(xQty[0], ' ');
    } else if (nounQty) {
      qty = parseInt(nounQty[1], 10);
      desc = desc.replace(new RegExp('(^|\\s)' + nounQty[1] + '\\s+'), ' ');
    }
    if (!unit && HOURLY.test(seg)) unit = 'hr';

    let unitPrice;
    if (PER_UNIT.test(seg) || HOURLY.test(seg)) {
      unitPrice = chosen.value;
      qty = qty || 1;
    } else if (qty && qty > 1) {
      unitPrice = Math.round((chosen.value / qty) * 100) / 100;
    } else {
      qty = qty || 1;
      unitPrice = chosen.value;
    }

    desc = desc
      .replace(/^\s*if (?:it'?s|it is) (?:the |a |an )?(.+?) (?:it'?s|it is|it'll be|then)\b/i, '$1 ')
      .replace(/\bfor the (parts?)\b/i, '($1)')
      .replace(/\s+(?:if|when|but|unless|because|cos|since)\b.*$/i, '');
    desc = stripFiller(desc.replace(/\b(x|×)\b/gi, ' '));
    desc = desc.replace(/\b(of|the)$/i, '').trim();
    if (desc.length > 70) desc = desc.slice(0, 70).replace(/\s\S*$/, '') + '…';

    const isDiscount = DISCOUNT_WORDS.test(seg) && /\b(discount|off)\b/i.test(seg);
    return {
      kind: 'item',
      desc: capitalise(desc),
      qty,
      unit,
      price: isDiscount ? -Math.abs(unitPrice) : unitPrice,
      perUnit: PER_UNIT.test(seg),
    };
  }

  const STOP_AFTER_NOUN = /\s+(for|on|by|at|to|please|pls|and|with|from|before|this|next|tomorrow|today|asap|if|so|but|thanks|thank)\b.*$/i;
  const NOT_NOUNS = /^(hours?|hrs?|days?|weeks?|months?|years?|minutes?|mins?|pm|am|o'?clock|people|of|th|st|nd|rd|percent|%)/i;

  function findQuantityRequests(text) {
    const out = [];
    const re = /\b(\d{1,4})\s+([a-z][a-z'’-]+(?:\s+[a-z][a-z'’-]+){0,3})/gi;
    let m;
    while ((m = re.exec(text))) {
      // skip things like prices and dates
      const before = text.slice(Math.max(0, m.index - 2), m.index);
      if (/[R$£€₦]\s?$/.test(before)) continue;
      let noun = m[2].replace(STOP_AFTER_NOUN, '').trim();
      if (!noun || NOT_NOUNS.test(noun)) continue;
      out.push({ qty: parseInt(m[1], 10), noun });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 4. Dates & times
   * ------------------------------------------------------------------ */

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function findDates(text, base) {
    base = startOfDay(base || new Date());
    const found = [];
    const push = (date, index) => { if (date && !isNaN(date)) found.push({ date: startOfDay(date), index }); };
    let m;

    let re = /\b(today|tonight|this evening|this afternoon)\b/gi;
    while ((m = re.exec(text))) push(base, m.index);

    re = /\b(tomorrow|tmrw|tmr|2moro)\b/gi;
    while ((m = re.exec(text))) push(addDays(base, 1), m.index);

    re = /\b(day after tomorrow)\b/gi;
    while ((m = re.exec(text))) push(addDays(base, 2), m.index);

    re = /\b(next\s+)?(sunday|monday|tuesday|tues|wednesday|thursday|thurs|friday|saturday)\b/gi;
    while ((m = re.exec(text))) {
      const name = m[2].toLowerCase();
      const target = DAYS.findIndex((d) => d.startsWith(name.slice(0, 3)));
      let diff = (target - base.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      if (m[1] && diff < 3) diff += 7;
      push(addDays(base, diff), m.index);
    }

    re = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}\\b(?:\\s+(\\d{4}))?`, 'gi');
    while ((m = re.exec(text))) {
      const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
      let year = m[3] ? Number(m[3]) : base.getFullYear();
      let d = new Date(year, month, Number(m[1]));
      if (!m[3] && d < addDays(base, -30)) d = new Date(year + 1, month, Number(m[1]));
      push(d, m.index);
    }

    re = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'gi');
    while ((m = re.exec(text))) {
      const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      let year = m[3] ? Number(m[3]) : base.getFullYear();
      let d = new Date(year, month, Number(m[2]));
      if (!m[3] && d < addDays(base, -30)) d = new Date(year + 1, month, Number(m[2]));
      push(d, m.index);
    }

    re = /\b(?:the\s+)(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/gi;
    while ((m = re.exec(text))) {
      let d = new Date(base.getFullYear(), base.getMonth(), Number(m[1]));
      if (d < base) d = new Date(base.getFullYear(), base.getMonth() + 1, Number(m[1]));
      push(d, m.index);
    }

    re = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
    while ((m = re.exec(text))) {
      let a = Number(m[1]), b = Number(m[2]);
      let day = a, month = b;
      if (dateOrder === 'MDY') { day = b; month = a; }
      if (b > 12 && a <= 12) { day = b; month = a; }
      if (a > 12 && b <= 12) { day = a; month = b; }
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      let year = m[3] ? Number(m[3]) : base.getFullYear();
      if (year < 100) year += 2000;
      let d = new Date(year, month - 1, day);
      if (!m[3] && d < addDays(base, -30)) d = new Date(year + 1, month - 1, day);
      push(d, m.index);
    }

    return found.sort((x, y) => x.index - y.index);
  }

  function findTimes(text) {
    const out = [];
    let m;
    let re = /\b(\d{1,2})(?:[:h.](\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)/gi;
    while ((m = re.exec(text))) {
      let h = Number(m[1]);
      const min = m[2] ? Number(m[2]) : 0;
      const pm = /p/i.test(m[3]);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
      if (h < 24 && min < 60) out.push({ time: pad(h) + ':' + pad(min), index: m.index });
    }
    re = /\b(?:at|by|around|from|for|before|after)\s+(\d{1,2})[:h](\d{2})\b/gi;
    while ((m = re.exec(text))) {
      const h = Number(m[1]), min = Number(m[2]);
      if (h < 24 && min < 60) out.push({ time: pad(h) + ':' + pad(min), index: m.index });
    }
    re = /\b(?:at|by|around)\s+(\d{1,2})\b(?!\s*(?:[:h.]\d|%|x|am|pm|a\.m|p\.m|people|hours?|hrs?|days?|items?|th|st|nd|rd))/gi;
    while ((m = re.exec(text))) {
      let h = Number(m[1]);
      if (h >= 1 && h <= 12) {
        if (h <= 6) h += 12; // "at 3" almost always means 3pm for appointments
        out.push({ time: pad(h) + ':00', index: m.index });
      }
    }
    re = /\b(midday|noon)\b/gi;
    while ((m = re.exec(text))) out.push({ time: '12:00', index: m.index });
    return out.sort((a, b) => a.index - b.index);
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function isoDate(d) { return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : ''; }

  /* ------------------------------------------------------------------ *
   * 5. Contact details
   * ------------------------------------------------------------------ */

  function findPhone(text) {
    const re = /(?:\+|00|\()?\d[\d\s().-]{7,16}\d/g;
    let m;
    while ((m = re.exec(text))) {
      const raw = m[0].trim();
      const digits = raw.replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 15) continue;
      // +44…, 0044…, 07…, or a 10+ digit number like (555) 123-4567
      if (!/^(\+|00|0|\()/.test(raw) && digits.length < 10) continue;
      if (!/[\s().-]/.test(raw) && !/^(\+|0)/.test(raw) && digits.length < 10) continue;
      if (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(raw)) continue;
      return raw.replace(/\s+/g, ' ');
    }
    return '';
  }

  function findEmail(text) {
    const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    return m ? m[0].replace(/[.,]$/, '') : '';
  }

  const STREET = '(?:street|str|st|road|rd|avenue|ave|drive|dr|lane|ln|crescent|cres|close|cl|way|boulevard|blvd|place|pl|court|ct|terrace|highway|hwy|circle|cir|square|sq|parkway|pkwy|row|grove|gardens|mews|walk|hill)';
  const ADDR_RE = new RegExp(`\\b(?:(?:unit|flat|apt)[ \\t]*\\d+[a-z]?,?[ \\t]+)?\\d{1,5}[a-z]?[ \\t]+(?:[A-Za-z][\\w'’-]*[ \\t]+){1,4}${STREET}\\b\\.?(?:,[ \\t]*[A-Za-z][\\w'’-]*(?:[ \\t]+[A-Za-z][\\w'’-]*){0,2}){0,3}`, 'i');
  const ADDR_PHRASE = /\b(?:my address is|address is|address:|i stay (?:at|in)|i live (?:at|in)|we(?:'re| are) (?:at|in)|i'?m (?:at|in)|located (?:at|in)|come to|deliver to|drop (?:it )?off at)\s+([^.!?\n]{4,80})/i;

  // "Hauptstraße 12", "Keizersgracht 120", "Rue de Rivoli 5", "Calle Mayor 10", "Via Roma 3"
  const ADDR_EU = /\b(?:[A-ZÀ-Ý][\wÀ-ÿ'’-]*(?:straße|strasse|str\.|gasse|weg|platz|allee|laan|straat|gracht|plein|vej|gade|gatan|gata|veien|katu|utca|ulica|ul\.)|(?:Rue|Avenue|Boulevard|Bd|Calle|Avenida|Av\.|Carrer|Rua|Via|Viale|Piazza|Corso|Strada)\s+(?:[\wÀ-ÿ'’-]+\s+){0,4}?)[ \t]*,?[ \t]*\d{1,5}[a-z]?\b(?:,[ \t]*\d{4,6}[ \t]+[A-ZÀ-Ý][\wÀ-ÿ'’-]*|,[ \t]*[A-ZÀ-Ý][\wÀ-ÿ'’-]*){0,2}/;

  function findAddress(text) {
    const m = text.match(ADDR_RE);
    if (m) return m[0].trim().replace(/[.,]$/, '');
    const eu = text.match(ADDR_EU);
    if (eu) return eu[0].trim().replace(/[.,]$/, '');
    const p = text.match(ADDR_PHRASE);
    if (p) {
      const val = p[1].replace(/\s+(?:on|by|at|for|tomorrow|today|please|pls|thanks|before)\b.*$/i, '').trim();
      if (val && !/^(the|a|work|home|the shop|my place)$/i.test(val) && /\d|[A-Z]/.test(val)) return val.replace(/[.,]$/, '');
    }
    return '';
  }

  function findIntroducedName(text) {
    const m = text.match(/\b(?:my name is|my name's|this is|it'?s|i'?m)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b(?:\s+(?:here|from|speaking))?/);
    if (!m) return '';
    const n = m[1];
    if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Ok|Okay|Fine|Sure|Not|Just|Looking|Still|Available|Free|Busy|Me|The)$/i.test(n.split(' ')[0])) return '';
    return n;
  }

  function looksLikePhone(s) { return /^[+\d\s()-]{8,}$/.test(s) && s.replace(/\D/g, '').length >= 9; }

  /* ------------------------------------------------------------------ *
   * 6. Trade detection & request extraction
   * ------------------------------------------------------------------ */

  const TRADES = {
    plumbing: { label: 'Plumbing', words: /\b(geyser|leak\w*|pipe|tap|toilet|drain|plumb\w*|blocked|cistern|valve|water heater|boiler|faucet|shower|basin|sink|burst)\b/gi },
    electrical: { label: 'Electrical', words: /\b(plug|wiring|socket|electric\w*|db board|tripping|trips|breaker|light fitting|isolator|outlet|panel|fuse|stove point)\b/gi },
    hair: { label: 'Hair & beauty', words: /\b(braids?|knotless|cornrows?|hair\w*|haircut|cut|fade|trim|beard|relaxer|weave|wig|lashes|nails|gel|acrylics?|makeup|dreads|locs|retwist|wash and set|blow ?dry|styling)\b/gi },
    baking: { label: 'Baking & food', words: /\b(cakes?|cupcakes?|bake\w*|cookies|icing|fondant|frosting|platters?|catering|flavou?rs?|vanilla|chocolate|red velvet|tiers?|eggless|vegan|snacks|meals?|lunch packs?|muffins?|scones|pies|brownies|pastries|bread)\b/gi },
    freelance: { label: 'Freelance & creative', words: /\b(logo|website|web ?site|design\w*|revisions?|edit\w*|video|photo\w*|social media|content|copy|brand\w*|posts?|flyer|poster|shoot|deliverables?|draft|mockups?|figma|seo)\b/gi },
    cleaning: { label: 'Cleaning', words: /\b(clean\w*|carpets?|windows|deep clean|laundry|ironing|upholstery|couch|mattress|move-out|spring clean)\b/gi },
    repairs: { label: 'Repairs & handyman', words: /\b(fix|repair\w*|broken|replace\w*|screen|phone|laptop|fridge|washing machine|door|hinge|gate|motor|paint\w*|tiles?|roof|gutter|ceiling|cupboard|install\w*)\b/gi },
  };

  function detectTrade(text) {
    let best = 'general', bestScore = 0;
    for (const [key, t] of Object.entries(TRADES)) {
      const hits = (text.match(t.words) || []).length;
      // repairs words are generic, so weigh them down a little
      const score = key === 'repairs' ? hits * 0.7 : hits;
      if (score > bestScore) { best = key; bestScore = score; }
    }
    return bestScore >= 1 ? best : 'general';
  }

  const REQUEST_WORDS = /\b(need|want|wanted|looking for|can you|could you|would you|please|pls|fix|repair|replace|install|order|book|broken|leak\w*|not working|isn'?t working|stopped|quote for|would like|i'?d like|keen on|interested in|make me|do my|do a)\b/i;

  function extractRequests(customerMessages) {
    const out = [];
    customerMessages.forEach((m) => {
      m.text.split(/\n|(?<=[.!?])\s+/).forEach((s) => {
        const seg = s.trim().replace(/\s+/g, ' ');
        if (seg.length < 10 || seg.length > 160) return;
        if (!REQUEST_WORDS.test(seg)) return;
        if (findPhone(seg) || findEmail(seg)) return;
        if (/^(how much|what'?s the price|price\??|thanks?|thank you|ok|okay)\b/i.test(seg) && seg.length < 25) return;
        out.push(seg.replace(/^(hi|hello|hey|morning|good (?:morning|afternoon|evening))\b[\s,!.]*/i, '').trim());
      });
    });
    const uniq = [];
    out.forEach((s) => { if (s && !uniq.some((u) => u.toLowerCase() === s.toLowerCase())) uniq.push(capitalise(s)); });
    return uniq.slice(0, 6);
  }

  /* ------------------------------------------------------------------ *
   * 7. Main parse
   * ------------------------------------------------------------------ */

  function guessOwner(messages, senders, hints) {
    const hintList = (hints || []).filter(Boolean).map((h) => h.toLowerCase());
    for (const s of senders) {
      const low = s.toLowerCase();
      if (low === 'you' || low === 'me') return s;
      if (hintList.some((h) => h && (low.includes(h) || h.includes(low)))) return s;
    }
    // the person who mentions prices most is usually the business
    let best = null, bestScore = -1;
    senders.forEach((s) => {
      const msgs = messages.filter((m) => m.sender === s);
      const prices = msgs.reduce((n, m) => n + findMoney(m.text).length, 0);
      const asks = msgs.reduce((n, m) => n + (REQUEST_WORDS.test(m.text) ? 1 : 0), 0);
      const score = prices * 2 - asks * 0.5;
      if (score > bestScore) { best = s; bestScore = score; }
    });
    return best;
  }

  /** Tell the parser about the user's own currency so e.g. "R350" or "K200" is read as money. */
  function configure(options) {
    options = options || {};
    extraTokens = { symbol: options.currencySymbol || '', code: options.currencyCode || '' };
    dateOrder = options.dateOrder === 'MDY' ? 'MDY' : 'DMY';
  }

  function parseChat(raw, options) {
    options = options || {};
    configure(options);
    const messages = splitMessages(raw);
    const senders = [];
    messages.forEach((m) => { if (m.sender && !senders.includes(m.sender)) senders.push(m.sender); });

    let owner = options.owner && senders.includes(options.owner) ? options.owner : null;
    if (!owner && senders.length >= 2) owner = guessOwner(messages, senders, options.ownerHints);
    if (!owner && senders.length === 1) owner = null; // only the customer talks (forwarded message)

    const others = senders.filter((s) => s !== owner);
    const counts = {};
    messages.forEach((m) => { counts[m.sender] = (counts[m.sender] || 0) + 1; });
    const customerSender = others.sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0] || '';

    const ownerMsgs = owner ? messages.filter((m) => m.sender === owner) : [];
    const customerMsgs = messages.filter((m) => m.sender !== owner);
    const allText = messages.map((m) => m.text).join('\n');
    const customerText = customerMsgs.map((m) => m.text).join('\n');

    // --- customer
    const customer = { name: '', phone: '', email: '', address: '' };
    if (customerSender) {
      if (looksLikePhone(customerSender)) customer.phone = customerSender;
      else customer.name = customerSender.replace(/[~]/g, '').trim();
    }
    if (!customer.name) customer.name = findIntroducedName(customerText);
    if (!customer.name) {
      // the business usually greets the customer: "Hi Sarah", "Hey John,", "Dear Mr Smith"
      const greetIn = (ownerMsgs.length ? ownerMsgs : messages).map((m) => m.text).join('\n');
      const g = greetIn.match(/(?:^|\n)\s*(?:[Hh]i|[Hh]ey|[Hh]ello|[Hh]iya|[Dd]ear|[Mm]orning|[Gg]ood (?:morning|afternoon|evening))[ ,]+((?:Mr|Mrs|Ms|Dr)\.? )?([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/);
      if (g && !/^(There|All|Guys|Team|Everyone|Again|Sir|Madam)$/.test(g[2])) customer.name = ((g[1] || '') + g[2]).trim();
    }
    customer.phone = customer.phone || findPhone(customerText);
    customer.email = findEmail(customerText) || '';
    customer.address = findAddress(customerText) || findAddress(allText);

    // --- items: prefer what the business said; fall back to everything
    const collect = (msgs) => {
      const items = [];
      let statedTotal = null, depositAmount = null;
      msgs.forEach((m) => {
        let last = null;
        splitSegments(m.text).forEach((seg) => {
          const r = parseItemSegment(seg);
          if (!r) {
            const h = seg.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/i);
            if (h && last && last.unit === 'hr' && last.qty === 1) last.qty = parseFloat(h[1]);
            return;
          }
          if (r.kind === 'item') last = r;
          if (r.kind === 'total') statedTotal = r.value;
          else if (r.kind === 'deposit') depositAmount = r.value;
          else items.push(r);
        });
      });
      return { items, statedTotal, depositAmount };
    };
    let res = collect(ownerMsgs.length ? ownerMsgs : messages);
    if (!res.items.length && ownerMsgs.length) res = collect(messages);

    // fill in blank descriptions / quantities from what the customer asked for
    const requestsQty = [];
    customerMsgs.forEach((m) => requestsQty.push(...findQuantityRequests(m.text)));
    res.items.forEach((it) => {
      if (!it.desc || /^(they|it|them|those|that|price|item)$/i.test(it.desc)) {
        const req = requestsQty[requestsQty.length - 1];
        if (req) {
          it.desc = capitalise(req.noun);
          if (it.qty === 1) it.qty = req.qty;
        } else {
          it.desc = it.unit === 'hr' ? 'Labour' : 'Service';
        }
      } else if (it.qty === 1 && it.unit !== 'hr') {
        const req = requestsQty.find((r) => {
          const n = r.noun.toLowerCase().replace(/s\b/g, '');
          const d = it.desc.toLowerCase().replace(/s\b/g, '');
          return d.includes(n) || n.includes(d);
        });
        if (req && it.perUnit) it.qty = req.qty;
      }
    });

    // dedupe by description: later messages win (price negotiation)
    const byDesc = new Map();
    res.items.forEach((it) => byDesc.set(it.desc.toLowerCase(), it));
    let items = Array.from(byDesc.values()).map((it) => ({ desc: it.desc, qty: it.qty, unit: it.unit || '', price: it.price }));

    // nothing itemised but a total was mentioned → single line
    if (!items.length && res.statedTotal) items = [{ desc: 'Service as discussed', qty: 1, unit: '', price: res.statedTotal }];

    // --- deposit
    let deposit = { type: 'none', value: 0 };
    const pct = allText.match(/(\d{1,3})\s?%\s*(?:deposit|upfront|up front|to book|to secure)|(?:deposit|upfront|up front)\s*(?:of|is|:)?\s*(\d{1,3})\s?%/i);
    if (pct) deposit = { type: 'percent', value: Number(pct[1] || pct[2]) };
    else if (/\b(half (?:upfront|up front|deposit|now)|50\/50|fifty[- ]fifty)\b/i.test(allText)) deposit = { type: 'percent', value: 50 };
    else if (res.depositAmount) deposit = { type: 'amount', value: res.depositAmount };

    // --- schedule: last mention wins (later messages confirm the plan)
    let jobDate = '', jobTime = '';
    messages.forEach((m) => {
      const ds = findDates(m.text, m.date || options.today || new Date());
      if (ds.length) jobDate = isoDate(ds[ds.length - 1].date);
      const ts = findTimes(m.text);
      if (ts.length) jobTime = ts[ts.length - 1].time;
    });

    const trade = detectTrade(allText);
    const requests = extractRequests(customerMsgs);
    const currency = detectCurrency(allText);

    const warnings = [];
    if (!messages.length) warnings.push('No messages found — paste the chat text first.');
    if (!items.length) warnings.push("No prices found in the chat. Add your line items below.");
    if (!customer.name && !customer.phone) warnings.push("Couldn't spot the customer's name — add it below.");
    if (res.statedTotal && items.length) {
      const sum = items.reduce((n, i) => n + i.qty * i.price, 0);
      if (Math.abs(sum - res.statedTotal) > 0.5) warnings.push(`The chat mentions a total of ${res.statedTotal.toLocaleString()}, but the items add up to ${(Math.round(sum * 100) / 100).toLocaleString()}. Double-check the lines.`);
    }

    return {
      messages: messages.map((m) => ({ sender: m.sender, text: m.text, date: m.date ? m.date.toISOString() : null })),
      senders,
      owner: owner || '',
      customerSender,
      customer,
      items,
      statedTotal: res.statedTotal,
      deposit,
      jobDate,
      jobTime,
      trade,
      requests,
      currency,
      warnings,
    };
  }

  /* ------------------------------------------------------------------ *
   * 7b. To-do lists from any text (notes, chats, voice-note transcripts)
   * ------------------------------------------------------------------ */

  const ACTION_VERBS = 'buy|get|order|call|phone|ring|email|e-mail|text|message|whatsapp|dm|reply|send|post|ship|deliver|drop off|drop|pick up|collect|fetch|book|schedule|reschedule|confirm|cancel|pay|invoice|quote|charge|bill|refund|chase|follow up|remind|ask|tell|check|test|inspect|measure|fix|repair|replace|install|clean|wash|paint|bake|cook|prep|prepare|make|cut|finish|start|complete|do|draft|write|design|edit|update|upload|print|pack|load|return|renew|file|sign|submit|review|meet|visit|go to|take|bring|sort out|sort|organise|organize|plan|set up|setup|restock|stock up|top up|count|clear|tidy|fill|move|research|find|choose|decide|arrange|register|apply|backup|back up|charge|service';
  const START_VERB = new RegExp(`^(?:${ACTION_VERBS})\\b`, 'i');
  const TODO_CUES = /\b(?:need to|needs to|have to|has to|got to|gotta|must|should|remember to|don'?t forget(?: to)?|do not forget(?: to)?|make sure(?: to| that)?|to-?do|todo|task|reminder:|remind me to|i'?ll|i will|we'?ll|we will|can you|could you|please)\b/i;
  const NOT_TASK = /^(?:hi|hey|hello|thanks|thank you|ok|okay|cool|great|perfect|lol|haha|yes|no|sure|morning|good (?:morning|night|evening)|see you|bye|cheers|noted)\b[\s!.,]*$/i;
  const LEAD_CLEAN = /^(?:(?:so|and|also|then|plus|ok|okay|oh|btw|ps|p\.s\.|note|reminder|todo|to-?do|task)[:,]?\s+)*(?:(?:i|we|you)\s+(?:also\s+)?(?:need|needs|have|has|got|must|should|will|'ll)\s+(?:to\s+)?|(?:i|we)'ll\s+|need to\s+|have to\s+|got to\s+|gotta\s+|must\s+|should\s+|remember to\s+|don'?t forget(?: to)?\s+|do not forget(?: to)?\s+|make sure (?:to |that )?|remind me to\s+|please\s+|pls\s+|can you\s+|could you\s+|would you\s+)?/i;

  const GREETING = /^(?:[Hh]i|[Hh]ey|[Hh]ello|[Hh]iya|[Mm]orning|[Gg]ood (?:morning|afternoon|evening)|[Oo]k(?:ay)?|[Ss]o|[Rr]ight|[Aa]lright)\b[\s,!.:-]*(?:[A-Z][a-z]+[\s,!.:-]+)?/;
  const MID_CUE = /\b(?:i|we|you)\s+(?:also\s+)?(?:need|have|must|should|gotta|got)\s+(?:to\s+)?(?=\w)|\b(?:remember|don'?t forget)\s+to\s+/i;

  function cleanTask(t) {
    let s = t.replace(/^\s*(?:[-*•·▪◦–—>]+|\d{1,2}[.)]|\[\s?[xX ]?\s?\]|☐|☑|✅|✔️?|🔲)\s*/, '').trim();
    let prev;
    // "Ok so tomorrow I need to fix the leak" → "fix the leak" (keep the date words for the due date only)
    const mid = s.match(MID_CUE);
    if (mid && mid.index > 0 && mid.index < 50) s = s.slice(mid.index + mid[0].length);
    do { prev = s; s = s.replace(GREETING, (m) => (START_VERB.test(s.slice(m.length)) || TODO_CUES.test(s.slice(m.length)) ? '' : m)).replace(LEAD_CLEAN, '').trim(); } while (s !== prev);
    s = s.replace(/\s*(?:pls|please|thanks|thank you|asap)[\s!.]*$/i, (m) => (/asap/i.test(m) ? ' ASAP' : '')).replace(/[\s,;:.!?]+$/, '').trim();
    s = s.replace(/^(?:to\s+)/i, '');
    return capitalise(s);
  }

  /**
   * Pull a to-do list out of any text.
   * Returns [{ text, due: 'YYYY-MM-DD' | '', time: 'HH:MM' | '', urgent: bool, done: bool }]
   */
  function extractTasks(raw, options) {
    options = options || {};
    configure(options);
    const text = String(raw || '');
    const messages = splitMessages(text);
    const base = options.today || new Date();
    const candidates = [];

    const pushLines = (body, date) => {
      let sectionDue = null;
      body.split(/\r?\n/).forEach((line) => {
        const l = line.trim();
        if (!l) { sectionDue = null; return; }
        // "Things for Saturday:" / "Monday:" → a heading whose date applies to the tasks under it
        if (/:$/.test(l) && l.length < 60) {
          const d = findDates(l, date);
          sectionDue = d.length ? d[d.length - 1].date : null;
          return;
        }
        const explicit = /^\s*(?:[-*•·▪◦–—>]+|\d{1,2}[.)]|\[\s?[xX ]?\s?\]|☐|☑|✅|✔️?|🔲)\s*\S/.test(line);
        const done = /^\s*(?:\[\s?[xX]\s?\]|☑|✅|✔️?)/.test(line);
        // a long line can hold several tasks: split sentences, and "; " lists
        const parts = explicit ? [l] : l.split(/(?<=[.!?])\s+(?=[A-Z])|;\s+|\s+(?:and then|then also|also)\s+/);
        parts.forEach((p) => candidates.push({ raw: p, explicit, done, date, sectionDue }));
      });
    };
    if (messages.some((m) => m.sender)) messages.forEach((m) => pushLines(m.text, m.date ? new Date(m.date) : base));
    else pushLines(text, base);

    const out = [];
    candidates.forEach((c) => {
      const r = c.raw.trim();
      if (r.length < 3 || NOT_TASK.test(r)) return;
      if (/^\s*(?:https?:\/\/\S+)\s*$/.test(r)) return;
      const stripped = r.replace(/^\s*(?:[-*•·▪◦–—>]+|\d{1,2}[.)]|\[\s?[xX ]?\s?\]|☐|☑|✅|✔️?|🔲)\s*/, '');
      const cleaned = cleanTask(r);
      const looksLikeTask = c.explicit || TODO_CUES.test(stripped) || START_VERB.test(stripped) || START_VERB.test(cleaned);
      if (!looksLikeTask) return;
      if (/\?$/.test(r) && !/\b(?:can you|could you|would you|please)\b/i.test(r) && !c.explicit) return; // plain questions aren't tasks
      if (!cleaned || cleaned.length < 3) return;
      const dates = findDates(r, c.date);
      const times = findTimes(r);
      out.push({
        text: cleaned.length > 140 ? cleaned.slice(0, 140).replace(/\s\S*$/, '') + '…' : cleaned,
        due: dates.length ? isoDate(dates[dates.length - 1].date) : (c.sectionDue ? isoDate(c.sectionDue) : ''),
        time: times.length ? times[times.length - 1].time : '',
        urgent: /\b(asap|urgent|urgently|immediately|right away|top priority)\b|!!/i.test(r),
        done: c.done,
      });
    });

    // nothing looked like a task? then every non-trivial line is one (a plain list)
    if (!out.length) {
      candidates.forEach((c) => {
        const r = c.raw.trim();
        if (r.length < 3 || NOT_TASK.test(r) || /\?$/.test(r)) return;
        const cleaned = cleanTask(r);
        if (cleaned) out.push({ text: cleaned, due: '', time: '', urgent: false, done: c.done });
      });
    }

    const seen = new Set();
    return out.filter((t) => {
      const k = t.text.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 50);
  }

  /** A short title for a to-do list made from some text. */
  function suggestTitle(raw, tasks, customerName) {
    if (customerName) return `To-do: ${customerName}`;
    const first = String(raw || '').split(/\r?\n/).map((l) => l.trim()).find((l) => /^#|:$/.test(l) && l.length < 60);
    if (first) return capitalise(first.replace(/^#+\s*/, '').replace(/:$/, ''));
    return 'To-do list';
  }

  /* ------------------------------------------------------------------ *
   * 8. Money maths
   * ------------------------------------------------------------------ */

  function totals(job) {
    const subtotal = (job.items || []).reduce((n, i) => n + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
    const taxRate = Number(job.taxRate) || 0;
    const tax = subtotal * taxRate / 100;
    const total = subtotal + tax;
    let deposit = 0;
    if (job.deposit && job.deposit.type === 'percent') deposit = total * (Number(job.deposit.value) || 0) / 100;
    if (job.deposit && job.deposit.type === 'amount') deposit = Number(job.deposit.value) || 0;
    const r = (n) => Math.round(n * 100) / 100;
    return { subtotal: r(subtotal), tax: r(tax), taxRate, total: r(total), deposit: r(Math.min(deposit, total)) };
  }

  /* ------------------------------------------------------------------ *
   * 9. Checklist
   * ------------------------------------------------------------------ */

  const TRADE_STEPS = {
    plumbing: {
      prep: ['Check stock: fittings, thread tape, sealant', 'Pack pipe wrench, plunger and drop sheets'],
      onsite: ['Switch off water / shut off the water heater before starting', 'Test for leaks and pressure after the fix', 'Take before & after photos'],
    },
    electrical: {
      prep: ['Pack tester, insulated tools and spare breakers'],
      onsite: ['Isolate power and lock off the DB', 'Test circuit and earth after the work', 'Issue a compliance certificate if required', 'Take before & after photos'],
    },
    hair: {
      prep: ['Confirm style, length and colour with a reference photo', 'Get hair/extensions and products ready', 'Sanitise tools and station'],
      onsite: ['Ask about scalp sensitivity or allergies', 'Show the finished look and take a photo (with permission)', 'Book the next appointment'],
    },
    baking: {
      prep: ['Confirm flavours, colours, wording and allergies', 'Buy ingredients and packaging/boxes', 'Bake and decorate (allow cooling time)'],
      onsite: ['Photograph the order before handover', 'Confirm collection/delivery time the day before'],
    },
    freelance: {
      prep: ['Confirm brief, deliverables and number of revisions in writing', 'Collect assets (logos, copy, photos, logins)', 'Set milestone dates'],
      onsite: ['Send first draft for feedback', 'Apply revisions', 'Deliver final files in agreed formats'],
    },
    cleaning: {
      prep: ['Pack cleaning products, cloths and vacuum', 'Confirm access, parking and pets'],
      onsite: ['Walk through with the customer before starting', 'Take before & after photos', 'Final walk-through and sign-off'],
    },
    repairs: {
      prep: ['Confirm make/model and fault (ask for a photo)', 'Source replacement parts'],
      onsite: ['Test the repair with the customer present', 'Take before & after photos', 'Explain any warranty on parts/labour'],
    },
    general: {
      prep: ['Confirm exactly what the customer wants', 'Get materials/stock ready'],
      onsite: ['Check the customer is happy before leaving', 'Take before & after photos'],
    },
  };

  function fmtDateHuman(iso, locale) {
    return formatDate(iso, locale, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /** "14:30" → "2:30 PM" in the US, "14:30" in most other places. */
  function formatTime(hhmm, locale) {
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return hhmm || '';
    const d = new Date(2000, 0, 1, Number(m[1]), Number(m[2]));
    try { return d.toLocaleTimeString(locale || 'en', { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return hhmm; }
  }

  function buildChecklist(job, settings) {
    const t = totals(job);
    const F = fmt(job, settings);
    const money = F.money;
    const when = (iso, time) => [iso ? F.date(iso, { weekday: 'short', day: 'numeric', month: 'short' }) : '', time ? formatTime(time, F.locale) : ''].filter(Boolean).join(' at ');
    const steps = TRADE_STEPS[job.trade] || TRADE_STEPS.general;
    const name = (job.customer && job.customer.name) || 'the customer';
    const list = [];
    const add = (text, group) => list.push({ text, group, done: false });

    add(`Send quote to ${name}`, 'Before');
    if (t.deposit > 0) add(`Receive ${money(t.deposit)} deposit before starting`, 'Before');
    if (job.jobDate || job.jobTime) {
      add(`Confirm booking with ${name}: ${when(job.jobDate, job.jobTime)}`, 'Before');
    } else {
      add(`Agree a date and time with ${name}`, 'Before');
    }
    (job.requests || []).slice(0, 4).forEach((r) => add(`Customer asked: “${r}”`, 'Before'));
    steps.prep.forEach((s) => add(s, 'Before'));
    (job.items || []).forEach((i) => {
      if (!i.desc || /^(labour|labor|call[- ]?out|travel|transport|delivery|service|consultation)/i.test(i.desc) || Number(i.price) < 0) return;
      add(`Prepare: ${Number(i.qty) > 1 ? i.qty + ' × ' : ''}${i.desc}`, 'Before');
    });
    if (job.customer && job.customer.address) add(`Travel to ${job.customer.address}`, 'On the day');
    steps.onsite.forEach((s) => add(s, 'On the day'));
    add(`Send invoice (${money(t.total)})`, 'After');
    add('Follow up until paid', 'After');
    add(`Ask ${name} for a review or referral`, 'After');
    return list;
  }

  /* ------------------------------------------------------------------ *
   * 10. Messages
   * ------------------------------------------------------------------ */

  function firstName(n) { return (n || '').trim().split(/\s+/)[0] || 'there'; }

  function quoteMessage(job, settings, docNumber, validUntilHuman) {
    const F = fmt(job, settings);
    const money = F.money;
    const when = (iso, time) => [iso ? F.date(iso, { weekday: 'short', day: 'numeric', month: 'short' }) : '', time ? formatTime(time, F.locale) : ''].filter(Boolean).join(' at ');
    const t = totals(job);
    const biz = settings.businessName || 'us';
    const lines = (job.items || []).map((i) => `• ${i.desc}${Number(i.qty) !== 1 ? ` × ${i.qty}${i.unit ? ' ' + i.unit : ''}` : ''} — ${money(i.qty * i.price)}`);
    let msg = `Hi ${firstName(job.customer.name)} 👋\nHere's your quote from ${biz}${docNumber ? ` (${docNumber})` : ''}:\n\n${lines.join('\n')}\n`;
    if (t.tax) msg += `${settings.taxLabel || 'Tax'} (${t.taxRate}%): ${money(t.tax)}\n`;
    msg += `*Total: ${money(t.total)}*\n`;
    if (t.deposit) msg += `Deposit to book: ${money(t.deposit)}\n`;
    if (job.jobDate || job.jobTime) msg += `\nBooked for: ${when(job.jobDate, job.jobTime)}\n`;
    if (validUntilHuman) msg += `\nValid until ${validUntilHuman}. `;
    msg += `Reply *YES* to go ahead 🙂`;
    return msg;
  }

  function invoiceMessage(job, settings, docNumber, dueHuman) {
    const F = fmt(job, settings);
    const money = F.money;
    const when = (iso, time) => [iso ? F.date(iso, { weekday: 'short', day: 'numeric', month: 'short' }) : '', time ? formatTime(time, F.locale) : ''].filter(Boolean).join(' at ');
    const t = totals(job);
    let msg = `Hi ${firstName(job.customer.name)}, thanks for your business! 🙏\n\nInvoice ${docNumber || ''} from ${settings.businessName || 'us'}\n*Amount due: ${money(t.total)}*`;
    if (dueHuman) msg += `\nDue: ${dueHuman}`;
    if (settings.paymentDetails) msg += `\n\nPayment details:\n${settings.paymentDetails}`;
    msg += `\n\nPlease use ${docNumber || 'your name'} as the reference.`;
    return msg;
  }

  const REMINDER_TONES = {
    followup: { label: 'Quote follow-up' },
    friendly: { label: 'Friendly' },
    firm: { label: 'Firm' },
    final: { label: 'Final notice' },
  };

  function reminderMessage(job, settings, tone, opts) {
    opts = opts || {};
    const F = fmt(job, settings);
    const money = F.money;
    const when = (iso, time) => [iso ? F.date(iso, { weekday: 'short', day: 'numeric', month: 'short' }) : '', time ? formatTime(time, F.locale) : ''].filter(Boolean).join(' at ');
    const t = totals(job);
    const name = firstName(job.customer && job.customer.name);
    const biz = settings.businessName || 'me';
    const signoff = settings.ownerName ? `\n\n${settings.ownerName}${settings.businessName ? ', ' + settings.businessName : ''}` : (settings.businessName ? `\n\n${settings.businessName}` : '');
    const pay = settings.paymentDetails ? `\n\nPayment details:\n${settings.paymentDetails}` : '';
    const ref = opts.invoiceNumber || '';
    const due = opts.dueHuman || '';

    const firstItem = ((job.items || []).find((i) => i.desc) || {}).desc;
    const what = ref ? `invoice ${ref}` : `the payment${firstItem ? ` for ${firstItem.toLowerCase()}` : ''}`;
    const refLine = ref ? `\n\nReference: ${ref}` : '';

    switch (tone) {
      case 'followup':
        return `Hi ${name} 🙂 Just checking in on the quote I sent${opts.quoteNumber ? ` (${opts.quoteNumber})` : ''} for ${money(t.total)}. Would you like to go ahead? ${job.jobDate ? `I'm holding ${when(job.jobDate)} for you, ` : ''}let me know and I'll lock it in.${signoff}`;
      case 'firm':
        return `Hi ${name}, a reminder that ${what} (${money(t.total)})${due ? ` was due on ${due}` : ' is now due'} and is still outstanding. Please make payment today, or let me know when I can expect it.${pay}${refLine}${signoff}`;
      case 'final':
        return `Hi ${name}. This is a final reminder that ${what} (${money(t.total)}) is overdue${due ? ` (due ${due})` : ''}. Please settle it within 48 hours. If there's a problem, reply here so we can sort it out together.${pay}${refLine}${signoff}`;
      case 'friendly':
      default:
        return `Hi ${name} 👋 Hope you're well! Just a friendly reminder that ${what} (${money(t.total)})${due ? ` is due on ${due}` : ' is due'}. Thanks so much for choosing ${biz}!${pay}${refLine}${signoff}`;
    }
  }

  return {
    splitMessages,
    parseChat,
    findMoney,
    findDates,
    findTimes,
    findAddress,
    findPhone,
    detectTrade,
    totals,
    buildChecklist,
    quoteMessage,
    invoiceMessage,
    reminderMessage,
    REMINDER_TONES,
    TRADES,
    isoDate,
    fmtDateHuman,
    formatTime,
    formatMoney,
    formatDate,
    currencySymbol,
    currencyMatches,
    detectCurrency,
    parseAmount,
    configure,
    fmt,
    extractTasks,
    suggestTitle,
  };
});
