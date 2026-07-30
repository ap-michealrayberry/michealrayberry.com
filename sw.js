// Network-first service worker: the record must never be stale, but the app
// shell still opens offline / on flaky connections.
const CACHE = 'mrb-v2';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/support.js', '/recording-assistant.js'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  if (u.pathname.indexOf('/ap') === 0) return; // AP portal: always live, never cached
  e.respondWith(
    fetch(e.request).then((r) => {
      const cp = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, cp));
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match('/')))
  );
});
