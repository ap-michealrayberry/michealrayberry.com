/* MRB Recording Assistant — minimal offline shell for PWA install */
var CACHE = "mrb-record-v2";
var ASSETS = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) {
          return k !== CACHE;
        }).map(function (k) {
          return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  // Network-first: a new deploy reaches the phone on the next load; the
  // cache is only the offline fallback. (Cache-first had pinned stale app.js.)
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && new URL(req.url).origin === self.location.origin) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cached) { return cached || caches.match("index.html"); });
    })
  );
});
