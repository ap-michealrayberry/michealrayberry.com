/* Only the public widget key is read by the browser; secrets stay on the server. */
(async function () {
  'use strict';
  var host = document.querySelector('[data-turnstile]');
  if (!host) return;
  var form = host.closest('form'), button = form.querySelector('button[type="submit"]');
  var status = form.querySelector('[data-form-status]');
  button.disabled = true;
  var error = new URLSearchParams(location.search).get('error');
  if (error) status.textContent = error === 'verify' ? 'Verification failed or expired. Please verify again and resubmit.' : 'Your submission was not delivered. Please try again or email the Accountability Partner.';
  try {
    var response = await fetch('/api/form-config', { cache: 'no-store' });
    var config = await response.json();
    if (!response.ok || !config.sitekey) throw new Error('Unavailable');
    var script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onerror = function () { status.textContent = 'Verification could not load. Reload this page or email ap@michealrayberry.com.'; };
    script.onload = function () {
      window.turnstile.render(host, {
        sitekey: config.sitekey, action: host.dataset.action,
        callback: function () { button.disabled = false; },
        'expired-callback': function () { button.disabled = true; status.textContent = 'Verification expired. Please verify again.'; },
        'error-callback': function () { button.disabled = true; status.textContent = 'Verification failed. Please reload this page.'; },
      });
    };
    document.head.appendChild(script);
  } catch { status.textContent = 'This form is unavailable. Contact ap@michealrayberry.com.'; }
})();
