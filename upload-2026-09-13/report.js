/* Report a Record Issue: the date/Project Day field becomes required when a
   compliance or record type is chosen. Server side accepts either way. */
(function () {
  var form = document.querySelector('form[name="observer"]'); if (!form) return;
  var ref = form.querySelector('[name="record_ref"]'); if (!ref) return;
  var need = (ref.getAttribute('data-required-for') || '').split('|');
  function sync() { var t = form.querySelector('[name="type"]:checked'); ref.required = !!(t && need.indexOf(t.value) !== -1); }
  try { var q = new URLSearchParams(location.search).get('ref'); if (q && !ref.value) ref.value = q.slice(0, 40); } catch (e) {}
  form.addEventListener('change', sync); sync();
})();
