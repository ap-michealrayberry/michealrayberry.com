/* Refresh only the public snapshot produced by the normal Netlify build. */
(function () {
  function refresh() {
    fetch('/data/record.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('record unavailable');
      return r.json();
    }).then(function (data) {
      if (!data || data.schema_version !== 1 || !data.counters) return;
      Object.keys(data.counters).forEach(function (key) {
        document.querySelectorAll('[data-live-key="' + key + '"]').forEach(function (node) {
          node.textContent = String(data.counters[key]);
        });
      });
    }).catch(function () { /* Keep the server-rendered record on failure. */ });
  }
  refresh(); setInterval(refresh, 5 * 60 * 1000);
})();
