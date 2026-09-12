/* The public shell is static now. Any service worker left over from the
   client-rendered version is unregistered so no visitor is served a cached
   copy of the old template. */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }).catch(function () {});
}
if (window.caches && caches.keys) { caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); }).catch(function () {}); }
