// Boot script for the record shell.
// Extracted from the index.html helmet so the record's Content-Security-Policy
// script-src can drop 'unsafe-inline' (these two were the only inline scripts).

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
