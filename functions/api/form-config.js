import { json } from '../../server/forms.js';
export function onRequestGet({ env }) {
  return env.TURNSTILE_SITE_KEY ? json({ sitekey: env.TURNSTILE_SITE_KEY }) : json({ error: 'Form verification is unavailable.' }, 503);
}
