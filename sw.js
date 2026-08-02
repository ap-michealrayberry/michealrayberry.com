// Network-first service worker: the record must never be stale, but the app
// shell still opens offline / on flaky connections.
const CACHE = 'mrb-v5';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/support.js'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  // Private surfaces are never cached: a console served from cache still
  // renders after the AP rotates a key, and its cached copy outlives the
  // revocation it is supposed to respect.
  if (u.pathname.indexOf('/ap') === 0) return;
  if (u.pathname.indexOf('/mrb') === 0) return;
  if (u.pathname.indexOf('/verify') === 0) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      const cp = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, cp));
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match('/')))
  );
});
