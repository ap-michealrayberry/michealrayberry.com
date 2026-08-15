// Boot script for the record shell.
// Extracted from the index.html helmet so the record's Content-Security-Policy
// script-src can drop 'unsafe-inline' (these two were the only inline scripts).

// 0) Retired ?day=N URLs → the permanent daily page (before the SPA boots).
(function () {
  var m = String(location.search || '').match(/[?&]day=(\d+)/);
  if (!m) return;
  var n = parseInt(m[1], 10);
  if (!(n >= 1)) return;
  var start = Date.parse('2026-08-13T12:00:00Z');
  var iso = new Date(start + (n - 1) * 86400000).toISOString().slice(0, 10);
  var pad = String(n).padStart(3, '0');
  location.replace('/daily/' + iso + '-day-' + pad + '/');
})();

// 1) Register the service worker (skip on the static .html archive routes).
if ('serviceWorker' in navigator && !/\.html/i.test(location.pathname)) {
  try { navigator.serviceWorker.register('/sw.js'); } catch (e) {}
}

// 2) Load the IBM Plex font stylesheet.
(function () {
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = [
    'https:/', '/fonts.googleapis',
    '.com/css2?family=IBM+Plex+Mono:wght@400;600;700',
    '&family=IBM+Plex+Sans:wght@400;600',
    '&family=IBM+Plex+Sans+Condensed:wght@700',
    '&display=swap'
  ].join('');
  document.head.appendChild(l);
})();
