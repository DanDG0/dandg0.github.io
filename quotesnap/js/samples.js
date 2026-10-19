/*
 * Example chats so people can try QuoteSnap without pasting their own.
 * Each sample is written on the fly in the user's own currency, number style and date format,
 * so it looks like a real chat wherever they are.
 */
(function (root) {
  'use strict';

    // rough price level per currency so a ¥ or ₹ sample doesn't say "80"
  const SCALE = { JPY: 150, KRW: 1300, CNY: 7, INR: 80, PKR: 280, BDT: 120, LKR: 300, NPR: 130, IDR: 15000, VND: 25000, PHP: 55,
      THB: 35, MYR: 4.5, SGD: 1.3, HKD: 8, TWD: 30, AUD: 1.5, NZD: 1.6, CAD: 1.4, MXN: 18, BRL: 5, ARS: 1000, CLP: 900, COP: 4000,
      PEN: 3.7, UYU: 40, PYG: 7500, BOB: 7, CRC: 500, GTQ: 7.7, HNL: 25, NIO: 37, DOP: 60, JMD: 155, TTD: 7, ZAR: 18, NAD: 18,
      BWP: 13, ZMW: 25, MWK: 1700, MZN: 64, NGN: 1500, GHS: 12, KES: 130, UGX: 3700, TZS: 2600, RWF: 1300, ETB: 120, XOF: 600,
      XAF: 600, MUR: 45, EGP: 48, MAD: 10, DZD: 135, TND: 3, AED: 3.7, SAR: 3.75, QAR: 3.6, ILS: 3.7, TRY: 35, UAH: 40, KZT: 480,
      UZS: 12500, GEL: 2.7, AMD: 390, AZN: 1.7, RUB: 90, PLN: 4, CZK: 23, HUF: 350, RON: 4.6, RSD: 110, SEK: 10, NOK: 10, DKK: 7,
      ISK: 135, LBP: 89000, JOD: 0.7, KWD: 0.3, BHD: 0.38, OMR: 0.38, FJD: 2.2, BSD: 1, BBD: 2, VES: 40 };
  /** A US-dollar-ish price turned into a believable round price in another currency. */
  function nicePrice(n, code) {
      const scale = SCALE[code] || 1;
      if (scale === 1) return n;
      const v = n * scale;
      const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1)); // 2 significant figures
      return Math.round(v / p) * p;
  }

  function makeCtx(opts) {
    opts = opts || {};
    const today = opts.today ? new Date(opts.today) : new Date();
    const code = opts.currencyCode || 'USD';
    const nloc = opts.numberLocale || 'en-US';
    const us = opts.dateOrder === 'MDY';
    const pad = (n) => String(n).padStart(2, '0');
    const day = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return d; };

    // money as people type it in chats: no ".00" on whole amounts
    const money = (raw) => {
      const n = nicePrice(raw, code);
      const whole = Number.isInteger(n);
      try {
        return new Intl.NumberFormat(nloc, {
          style: 'currency', currency: code, currencyDisplay: 'narrowSymbol',
          minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
        }).format(n).replace(/ | /g, ' ');
      } catch (e) { return `${code} ${n}`; }
    };
    // WhatsApp timestamps in the user's date order (US exports are month-first with AM/PM)
    const stamp = (offset, h, m) => {
      const d = day(offset);
      const date = us
        ? `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`
        : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
      const time = us ? `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}` : `${pad(h)}:${pad(m)}`;
      return { date, time };
    };
    const android = (offset, h, m, who, text) => { const s = stamp(offset, h, m); return `${s.date}, ${s.time} - ${who}: ${text}`; };
    const ios = (offset, h, m, who, text) => { const s = stamp(offset, h, m); return `[${s.date}, ${s.time.replace(/^(\d+:\d+)/, '$1:00')}] ${who}: ${text}`; };
    const desktop = (offset, h, m, who, text) => { const s = stamp(offset, h, m); return `[${s.time}, ${s.date}] ${who}: ${text}`; };
    const longDate = (offset) => day(offset).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const time = (h) => (us ? `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}` : `${h < 12 ? h + 'am' : ((h + 11) % 12) + 1 + 'pm'}`);
    return { money, android, ios, desktop, longDate, time };
  }

  const SAMPLES = {
    plumber: {
      label: '🔧 Plumber',
      owner: "Mike's Plumbing",
      build: (c) => [
        c.android(0, 8, 2, 'Sarah Johnson', 'Morning! My water heater is leaking from the bottom and there\'s no hot water 😩'),
        c.android(0, 8, 3, 'Sarah Johnson', 'Can you come check it today or tomorrow?'),
        c.android(0, 8, 15, "Mike's Plumbing", `Morning Sarah, sounds like the element or thermostat. I can come tomorrow at ${c.time(9)}`),
        c.android(0, 8, 16, "Mike's Plumbing", `Call-out is ${c.money(80)}`),
        c.android(0, 8, 16, "Mike's Plumbing", `If it's the element it's ${c.money(120)} for the part and labour ${c.money(65)} per hour, usually 2 hours`),
        c.android(0, 8, 20, 'Sarah Johnson', 'Ok that\'s fine. I live at 42 Oak Street, Springfield'),
        c.android(0, 8, 21, 'Sarah Johnson', 'Also the kitchen tap is dripping, can you look at it too?'),
        c.android(0, 8, 25, "Mike's Plumbing", `Sure, new tap washer + fitting ${c.money(25)}`),
        c.android(0, 8, 25, "Mike's Plumbing", 'I just need 50% deposit to book'),
        c.android(0, 8, 31, 'Sarah Johnson', 'Perfect, see you tomorrow 🙏'),
      ].join('\n'),
    },
    baker: {
      label: '🧁 Baker',
      owner: 'Sweet Crumbs Bakery',
      build: (c) => [
        c.ios(-2, 19, 41, 'Emily', 'Hiii are you still taking orders for this weekend?'),
        c.ios(-2, 19, 42, 'Emily', "I need 24 cupcakes and a 2 tier cake for my daughter's 6th birthday 🎂"),
        c.ios(-2, 19, 42, 'Emily', 'Theme is unicorns, pink and gold'),
        c.ios(-2, 19, 50, 'Sweet Crumbs Bakery', 'Hi Emily! Yes I am 😊'),
        c.ios(-2, 19, 51, 'Sweet Crumbs Bakery', `2 tier unicorn cake ${c.money(180)}`),
        c.ios(-2, 19, 51, 'Sweet Crumbs Bakery', `Cupcakes are ${c.money(3.5)} each`),
        c.ios(-2, 19, 52, 'Sweet Crumbs Bakery', `Edible gold topper ${c.money(15)}`),
        c.ios(-2, 19, 55, 'Emily', 'Can it be vanilla with strawberry filling? No nuts please, one kid has an allergy'),
        c.ios(-2, 19, 56, 'Sweet Crumbs Bakery', `Yes no problem, nut free 👍 Collection Saturday at ${c.time(10)}?`),
        c.ios(-2, 19, 57, 'Emily', 'Perfect! My email is emily.carter@example.com if you need me'),
        c.ios(-2, 19, 58, 'Sweet Crumbs Bakery', 'Half upfront to secure the date please'),
      ].join('\n'),
    },
    hair: {
      label: '💇 Hair',
      owner: 'You',
      build: (c) => [
        'Jessica: Hey girl, do you have space on Friday?',
        'Jessica: I want medium knotless braids, waist length',
        `You: Hey Jessica! Yes I have Friday at ${c.time(8)}`,
        `You: Medium knotless waist length is ${c.money(160)}`,
        `You: Hair is ${c.money(25)} if you want me to bring it`,
        'Jessica: Yes please bring the hair, colour 1B',
        'Jessica: How much is the deposit?',
        `You: ${c.money(50)} deposit to book, rest on the day`,
        'Jessica: Sending now ❤️',
      ].join('\n'),
    },
    notes: {
      label: '📝 Notes',
      owner: '',
      build: (c) => [
        'Saturday market prep:',
        '- bake 3 dozen cupcakes',
        '- buy cake boxes and ribbon',
        '- charge the card machine',
        '- print the new price list',
        '',
        `Remember to call the venue tomorrow about the table fee (${c.money(25)}).`,
        'Need to email Emily her invoice by Friday!!',
        'Also order more flour, we are almost out',
      ].join('\n'),
    },
    designer: {
      label: '🎨 Freelancer',
      owner: 'Alex Designs',
      build: (c) => [
        c.desktop(-7, 9, 12, 'David (Green Leaf Café)', 'Hi Alex, we need a new logo for our café and some social media posts'),
        c.desktop(-7, 9, 13, 'David (Green Leaf Café)', 'Something fresh and green. My email is david@example.com'),
        c.desktop(-7, 9, 30, 'Alex Designs', 'Hi David! Happy to help'),
        c.desktop(-7, 9, 31, 'Alex Designs', `Logo design with 3 concepts and 2 revisions: ${c.money(600)}`),
        c.desktop(-7, 9, 31, 'Alex Designs', `6 social media post templates at ${c.money(60)} each`),
        c.desktop(-7, 9, 32, 'Alex Designs', `Brand colour & font guide ${c.money(150)}`),
        c.desktop(-7, 9, 40, 'David (Green Leaf Café)', `Great, can we have first drafts by ${c.longDate(8)}?`),
        c.desktop(-7, 9, 41, 'Alex Designs', "Yes 👍 I'll need 50% deposit to start"),
      ].join('\n'),
    },
  };

  /** Text for one sample, written for the user's settings. */
  function sampleText(key, opts) {
    const s = SAMPLES[key];
    return s ? s.build(makeCtx(opts)) : '';
  }

  const api = { SAMPLES, sampleText, nicePrice };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QSSamples = api;
})(typeof self !== 'undefined' ? self : this);
