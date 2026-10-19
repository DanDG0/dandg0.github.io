/*
 * QuoteSnap regions — country → currency, dialling code, date order and tax name.
 * Country and currency names come from the browser (Intl.DisplayNames), so this stays small.
 * Works in the browser (window.QSRegions) and in Node (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QSRegions = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // code: currency, dial code, date order in chats (DMY / MDY), tax name
  const RAW = `
US USD 1 MDY Sales tax|CA CAD 1 DMY GST|MX MXN 52 DMY VAT|GB GBP 44 DMY VAT|IE EUR 353 DMY VAT|FR EUR 33 DMY VAT|DE EUR 49 DMY VAT
ES EUR 34 DMY VAT|IT EUR 39 DMY VAT|PT EUR 351 DMY VAT|NL EUR 31 DMY VAT|BE EUR 32 DMY VAT|LU EUR 352 DMY VAT|AT EUR 43 DMY VAT
CH CHF 41 DMY VAT|SE SEK 46 DMY VAT|NO NOK 47 DMY VAT|DK DKK 45 DMY VAT|FI EUR 358 DMY VAT|IS ISK 354 DMY VAT|PL PLN 48 DMY VAT
CZ CZK 420 DMY VAT|SK EUR 421 DMY VAT|HU HUF 36 DMY VAT|RO RON 40 DMY VAT|BG EUR 359 DMY VAT|HR EUR 385 DMY VAT|SI EUR 386 DMY VAT
RS RSD 381 DMY VAT|GR EUR 30 DMY VAT|CY EUR 357 DMY VAT|MT EUR 356 DMY VAT|EE EUR 372 DMY VAT|LV EUR 371 DMY VAT|LT EUR 370 DMY VAT
UA UAH 380 DMY VAT|TR TRY 90 DMY VAT|GE GEL 995 DMY VAT|AM AMD 374 DMY VAT|AZ AZN 994 DMY VAT|KZ KZT 7 DMY VAT|UZ UZS 998 DMY VAT
IL ILS 972 DMY VAT|AE AED 971 DMY VAT|SA SAR 966 DMY VAT|QA QAR 974 DMY Tax|KW KWD 965 DMY Tax|BH BHD 973 DMY VAT|OM OMR 968 DMY VAT
JO JOD 962 DMY Sales tax|LB LBP 961 DMY VAT|EG EGP 20 DMY VAT|MA MAD 212 DMY VAT|DZ DZD 213 DMY VAT|TN TND 216 DMY VAT
NG NGN 234 DMY VAT|GH GHS 233 DMY VAT|KE KES 254 DMY VAT|UG UGX 256 DMY VAT|TZ TZS 255 DMY VAT|RW RWF 250 DMY VAT|ET ETB 251 DMY VAT
ZA ZAR 27 DMY VAT|NA NAD 264 DMY VAT|BW BWP 267 DMY VAT|ZM ZMW 260 DMY VAT|ZW USD 263 DMY VAT|MW MWK 265 DMY VAT|MZ MZN 258 DMY VAT
SN XOF 221 DMY VAT|CI XOF 225 DMY VAT|CM XAF 237 DMY VAT|MU MUR 230 DMY VAT|IN INR 91 DMY GST|PK PKR 92 DMY Sales tax
BD BDT 880 DMY VAT|LK LKR 94 DMY VAT|NP NPR 977 DMY VAT|CN CNY 86 DMY VAT|HK HKD 852 DMY Tax|TW TWD 886 DMY Tax|JP JPY 81 DMY Consumption tax
KR KRW 82 DMY VAT|SG SGD 65 DMY GST|MY MYR 60 DMY SST|ID IDR 62 DMY VAT|PH PHP 63 MDY VAT|TH THB 66 DMY VAT|VN VND 84 DMY VAT
AU AUD 61 DMY GST|NZ NZD 64 DMY GST|FJ FJD 679 DMY VAT|BR BRL 55 DMY Tax|AR ARS 54 DMY VAT|CL CLP 56 DMY VAT|CO COP 57 DMY VAT
PE PEN 51 DMY VAT|VE VES 58 DMY VAT|EC USD 593 DMY VAT|UY UYU 598 DMY VAT|PY PYG 595 DMY VAT|BO BOB 591 DMY VAT|CR CRC 506 DMY VAT
PA USD 507 DMY Tax|GT GTQ 502 DMY VAT|HN HNL 504 DMY Sales tax|SV USD 503 DMY VAT|NI NIO 505 DMY VAT|DO DOP 1 DMY Tax
JM JMD 1 DMY GCT|TT TTD 1 DMY VAT|PR USD 1 MDY Sales tax|BS BSD 1 DMY VAT|BB BBD 1 DMY VAT`;

  const REGIONS = {};
  RAW.trim().split(/\||\n/).forEach((row) => {
    const [code, currency, dial, dateOrder, ...tax] = row.trim().split(/\s+/);
    if (code) REGIONS[code] = { code, currency, dial, dateOrder, taxLabel: tax.join(' ') };
  });

  const FALLBACK = { code: '', currency: 'USD', dial: '', dateOrder: 'DMY', taxLabel: 'Tax' };

  let regionNames, currencyNames;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { regionNames = null; }
  try { currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' }); } catch (e) { currencyNames = null; }

  function countryName(code) {
    if (!code) return 'Other / not listed';
    try { return (regionNames && regionNames.of(code)) || code; } catch (e) { return code; }
  }
  function currencyName(code) {
    try { return (currencyNames && currencyNames.of(code)) || code; } catch (e) { return code; }
  }

  function info(code) { return REGIONS[code] || { ...FALLBACK, code: code || '' }; }

  function countries() {
    return Object.keys(REGIONS).map((c) => ({ code: c, name: countryName(c) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function currencies() {
    let list = [];
    try { list = Intl.supportedValuesOf('currency'); } catch (e) { /* older browsers */ }
    const set = new Set(list.length ? list : Object.values(REGIONS).map((r) => r.currency));
    ['USD', 'EUR', 'GBP'].forEach((c) => set.add(c));
    return Array.from(set).map((c) => ({ code: c, name: currencyName(c) }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Best guess at the user's country from the browser language, e.g. "en-AU" → AU. */
  function guessCountry() {
    const langs = [];
    try {
      if (typeof navigator !== 'undefined') langs.push(...(navigator.languages || []), navigator.language);
      langs.push(Intl.DateTimeFormat().resolvedOptions().locale);
    } catch (e) { /* ignore */ }
    for (const l of langs) {
      if (!l) continue;
      const m = String(l).match(/[-_]([A-Z]{2})\b/i);
      if (m && REGIONS[m[1].toUpperCase()]) return m[1].toUpperCase();
    }
    // language without region: a few sensible defaults
    const base = (langs[0] || 'en').slice(0, 2).toLowerCase();
    const byLang = { de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pt: 'BR', nl: 'NL', pl: 'PL', sv: 'SE', nb: 'NO', da: 'DK', fi: 'FI', ja: 'JP', ko: 'KR', zh: 'CN', tr: 'TR', hi: 'IN', id: 'ID', th: 'TH', vi: 'VN', he: 'IL', ar: 'AE', ru: 'KZ', uk: 'UA', el: 'GR', cs: 'CZ', hu: 'HU', ro: 'RO' };
    return byLang[base] || 'US';
  }

  /** Locale used for formatting money and dates on documents (English text, local style). */
  function localeFor(country) {
    const fallback = info(country).dateOrder === 'MDY' || !country ? 'en-US' : 'en-GB';
    if (!country) return fallback;
    try {
      const tag = `en-${country}`;
      // only use en-XX when the browser really has data for it; otherwise English with the right day/month order
      const got = new Intl.DateTimeFormat(tag).resolvedOptions().locale;
      return got === tag ? tag : fallback;
    } catch (e) { return fallback; }
  }

  /** Locale for numbers/money: the country's own style (1.234,50 € in Germany), always with Western digits. */
  function numberLocaleFor(country) {
    if (!country) return 'en';
    let lang = 'en';
    try {
      const loc = new Intl.Locale('und-' + country).maximize();
      // only borrow the local language's style when it uses Latin script; otherwise English for this country
      lang = loc.script === 'Latn' ? loc.language : 'en';
    } catch (e) { /* old browser */ }
    const tag = `${lang}-${country}-u-nu-latn`;
    try { return Intl.NumberFormat.supportedLocalesOf([tag])[0] || localeFor(country); } catch (e) { return localeFor(country); }
  }

  /** Settings for a country, used on first run and when the user changes country. */
  function defaultsFor(country) {
    const r = info(country);
    return { country: r.code, currencyCode: r.currency, countryCode: r.dial, dateOrder: r.dateOrder, taxLabel: r.taxLabel };
  }

  return { REGIONS, numberLocaleFor, info, countries, currencies, countryName, currencyName, guessCountry, localeFor, defaultsFor };
});
