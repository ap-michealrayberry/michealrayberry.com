/* /share/ copy buttons. Shows "Link copied" only after a successful copy;
   on failure, selects the text so it can be copied by hand. */
(function () {
  function flash(btn, ok) { var t = btn.textContent; btn.textContent = ok ? 'Copied' : 'Select and copy'; setTimeout(function () { btn.textContent = t; }, 1800); }
  document.querySelectorAll('[data-copy],[data-copy-from]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var src = btn.getAttribute('data-copy-from');
      var text = src ? (document.getElementById(src) || {}).textContent || '' : btn.getAttribute('data-copy');
      text = String(text).replace(/\s+/g, ' ').trim();
      var done = function (ok) { flash(btn, ok); if (!ok && src) { var r = document.createRange(); r.selectNodeContents(document.getElementById(src)); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      else done(false);
    });
  });
})();
