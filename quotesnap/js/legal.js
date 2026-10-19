/* Shared by privacy, terms and 404 pages. */
(function () {
  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();
  var email = (window.QS_CONFIG || {}).contactEmail;
  document.querySelectorAll('[data-contact]').forEach(function (el) {
    if (!email) { el.textContent = 'the contact link in the app'; el.removeAttribute('href'); return; }
    el.href = 'mailto:' + email + (el.dataset.contact ? '?subject=' + encodeURIComponent(el.dataset.contact) : '');
    if (!el.textContent.trim()) el.textContent = email;
  });
})();
