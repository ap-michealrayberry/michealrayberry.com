/* Outbound email through Postmark, sent as ap@michealrayberry.com (README §2.7).
   Wording and sign-offs are ported from Code.gs (mailMRB, mailAP,
   notifySubscribers). Every send — and every failure — is written to the
   audit log; subscriber addresses are not. Subscriber messages go on
   Postmark's broadcast stream and always carry an unsubscribe link. */
import { appendEvent } from './events';

export type Audience = 'ap' | 'mrb' | 'subscriber' | 'person';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  audience: Audience;
  /** Subscriber messages only: the per-address unsubscribe URL. */
  unsubscribeUrl?: string;
  tag?: string;
}

export async function sendMail(env: Env, mail: Mail): Promise<boolean> {
  const stream = mail.audience === 'subscriber' ? 'broadcast' : 'outbound';
  const headers: { Name: string; Value: string }[] = [];
  if (mail.audience === 'subscriber') {
    if (!mail.unsubscribeUrl) throw new Error('subscriber mail needs an unsubscribe link');
    headers.push({ Name: 'List-Unsubscribe', Value: `<${mail.unsubscribeUrl}>` });
    headers.push({ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' });
  }
  let ok = false;
  let detail = '';
  if (!env.POSTMARK_TOKEN) {
    detail = 'POSTMARK_TOKEN not set';
  } else {
    try {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': env.POSTMARK_TOKEN },
        body: JSON.stringify({
          From: `Micheal Ray Berry — Accountability Record <${env.AP_EMAIL}>`,
          To: mail.to,
          ReplyTo: env.AP_EMAIL,
          Subject: mail.subject,
          TextBody: mail.text,
          MessageStream: stream,
          Tag: mail.tag,
          Headers: headers,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json<{ ErrorCode?: number; Message?: string; MessageID?: string }>().catch(() => ({} as { ErrorCode?: number; Message?: string; MessageID?: string }));
      ok = res.ok && body.ErrorCode === 0;
      detail = ok ? String(body.MessageID) : `${res.status} ${body.Message ?? ''}`.trim();
    } catch (error) {
      detail = String(error);
    }
  }
  await appendEvent(env.DB, {
    actor: 'system', action: ok ? 'mail.sent' : 'mail.failed', subject: mail.tag ?? null,
    payload: { audience: mail.audience, to: mail.audience === 'ap' || mail.audience === 'mrb' ? mail.to : undefined, subject: mail.subject, detail },
  });
  return ok;
}

const PORTAL = (env: Env) => `${env.SITE_ORIGIN}/mrb/`;
export const ASSISTANT = (env: Env) => `${env.SITE_ORIGIN}/assistant/`;
export const AP_CONSOLE = (env: Env) => `${env.SITE_ORIGIN}/ap/`;

/* Code.gs mrbSign() / apSign(), with the Worker's addresses. */
const mrbSign = (env: Env) => `\n\n—\nAutomated from the record. Nothing in this message is published.\nPortal: ${PORTAL(env)}\nRecord: ${env.SITE_ORIGIN}/daily/`;
const apSign = (env: Env) => `\n\n—\nAutomated from the record.\nConsole: ${AP_CONSOLE(env)}`;

/** Micheal's private notice address (contract §12: the private contact on the signature page). */
export const mailMRB = (env: Env, subject: string, body: string, tag: string) =>
  sendMail(env, { to: env.MRB_NOTICE_EMAIL, subject, text: body + mrbSign(env), audience: 'mrb', tag });
export const mailAP = (env: Env, subject: string, body: string, tag: string) =>
  sendMail(env, { to: env.AP_EMAIL, subject, text: body + apSign(env), audience: 'ap', tag });

/** Code.gs notifySubscribers: "Ray Berry — " subject prefix and the unsubscribe footer. */
export async function notifySubscribers(env: Env, subject: string, body: string, tag: string): Promise<number> {
  const { results } = await env.DB.prepare("SELECT email, token FROM subscribers WHERE status = 'ACTIVE'").all<{ email: string; token: string }>();
  let sent = 0;
  for (const s of results) {
    const unsubscribeUrl = `${env.SITE_ORIGIN}/api/subscribe?unsubscribe=${s.token}`;
    const text = `${body}\n—\nYou subscribed at michealrayberry.com/notify/. Unsubscribe: ${unsubscribeUrl}\nAdministered by the Accountability Partner · ${env.AP_EMAIL}`;
    if (await sendMail(env, { to: s.email, subject: `Ray Berry — ${subject}`, text, audience: 'subscriber', unsubscribeUrl, tag })) sent++;
  }
  return sent;
}
