/* Protected operational pages must not survive sign-out in an offline cache. */
var ASSETS = [];
self.addEventListener('install', function (event) { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return /^mrb-record-/.test(key); }).map(function (key) { return caches.delete(key); }));
  }).then(function () { return self.clients.claim(); }));
});
// Requests always reach the authenticated origin. Captures remain in IndexedDB.
