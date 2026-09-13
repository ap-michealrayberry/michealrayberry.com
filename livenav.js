/* Navigation and copy links use the existing published record. */
(function () {
  function markCurrentPage() {
    var path = location.pathname.replace(/\/+$/, '') || '/';
    var best = null, bestLength = -1;
    document.querySelectorAll('.sitenav a[href]').forEach(function (a) {
      var target;
      try { target = new URL(a.getAttribute('href'), location.origin); } catch (e) { return; }
      if (target.origin !== location.origin) return;
      var candidate = target.pathname.replace(/\/+$/, '') || '/';
      var match = path === candidate || (candidate !== '/' && path.indexOf(candidate + '/') === 0);
      if (match && candidate.length > bestLength) { best = a; bestLength = candidate.length; }
    });
    if (best) best.setAttribute('aria-current', 'page');
  }
  markCurrentPage();
  /* Report-card "Copy link": copies the permalink; falls back to following it. */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-copy]');
    if (!a || !navigator.clipboard) return;
    e.preventDefault();
    navigator.clipboard.writeText(a.getAttribute('data-copy')).then(function () {
      var t = a.textContent; a.textContent = 'Copied'; setTimeout(function () { a.textContent = t; }, 1400);
    }).catch(function () { location.href = a.href; });
  });
})();
