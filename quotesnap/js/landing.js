/* Landing page: local prices, contact links. */
(function () {
    document.getElementById('yr').textContent = new Date().getFullYear();
    // show the demo prices in the visitor's own currency and number style
    try {
      const country = QSRegions.guessCountry();
      const code = QSRegions.info(country).currency;
      const loc = QSRegions.numberLocaleFor(country);
      document.querySelectorAll('[data-money]').forEach((el) => {
        const p = (n) => QSSamples.nicePrice(n, code);
        // keep the maths adding up after rounding: total = 80 + 120 + 2×65, deposit = half
        const map = { 80: p(80), 120: p(120), 65: p(65), 130: p(65) * 2, 330: p(80) + p(120) + p(65) * 2, 165: (p(80) + p(120) + p(65) * 2) / 2 };
        let txt = QSEngine.formatMoney(map[el.dataset.money] ?? p(Number(el.dataset.money)), code, loc);
        if (el.hasAttribute('data-short')) txt = txt.replace(/[.,]00(?=\D*$)/, '');
        el.textContent = txt;
      });
      // Teams add-on in the visitor's local price
      const tp = QSTeam.teamPrice(code);
      const whole = Number.isInteger(tp.amount);
      const label = new Intl.NumberFormat(loc, { style: 'currency', currency: tp.currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(tp.amount);
      document.querySelectorAll('[data-team-price]').forEach((el) => { el.textContent = label; });
    } catch (e) { /* keep the defaults */ }

  // contact links
  const email = (window.QS_CONFIG || {}).contactEmail;
  document.querySelectorAll('[data-contact]').forEach((el) => {
    if (!email) { el.hidden = true; return; }
    el.href = 'mailto:' + email + (el.dataset.contact ? '?subject=' + encodeURIComponent(el.dataset.contact) : '');
    if (!el.textContent.trim()) el.textContent = email;
  });
})();
