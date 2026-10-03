/* Remove only the retired root worker/cache. The Recording Assistant owns a
   separate /assistant/ worker and mrb-record-* cache and must remain intact. */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (rs) {
    rs.forEach(function (r) { if (r.scope === location.origin + '/') r.unregister(); });
  }).catch(function () {});
}
if (window.caches && caches.keys) {
  caches.keys().then(function (ks) {
    ks.filter(function (k) { return /^mrb-v\d+$/.test(k); }).forEach(function (k) { caches.delete(k); });
  }).catch(function () {});
}
