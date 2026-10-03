import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { accessIdentity, type AccessEnv } from '../../src/auth/access';

const TEAM = 'mrb-test.cloudflareaccess.com';
const env: AccessEnv = {
  ACCESS_TEAM_DOMAIN: TEAM,
  MRB_EMAIL: 'michealrayberry@gmail.com',
  AP_EMAIL: 'ap@michealrayberry.com',
  ACCESS_AUD_ASSISTANT: 'aud-assistant',
  ACCESS_AUD_MRB: 'aud-mrb',
  ACCESS_AUD_AP: 'aud-ap',
};

let keys: CryptoKeyPair;
let jwk: JsonWebKey;
const KID = 'test-kid';

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (obj: unknown) => b64u(new TextEncoder().encode(JSON.stringify(obj)));

async function token(claims: Record<string, unknown>, signer = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: KID });
  const body = enc({ iss: `https://${TEAM}`, exp: now + 600, iat: now, ...claims });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(new Uint8Array(sig))}`;
}

const req = (jwt?: string, url = 'https://michealrayberry.com/api/me') =>
  new Request(url, { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} });

beforeAll(async () => {
  keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey('jwk', keys.publicKey) as JsonWebKey;
});

function mockCerts() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    expect(String(input instanceof Request ? input.url : input)).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
    return Response.json({ keys: [{ ...jwk, kid: KID }] });
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Access JWT → role', () => {
  it('maps Micheal on the assistant or portal app to mrb', async () => {
    mockCerts();
    for (const aud of ['aud-assistant', 'aud-mrb']) {
      const who = await accessIdentity(req(await token({ aud: [aud], email: 'MichealRayBerry@gmail.com' })), env);
      expect(who).toEqual({ ok: true, email: 'michealrayberry@gmail.com', role: 'mrb' });
    }
  });

  it('maps the AP on the AP app to ap', async () => {
    mockCerts();
    const who = await accessIdentity(req(await token({ aud: ['aud-ap'], email: 'ap@michealrayberry.com' })), env);
    expect(who).toEqual({ ok: true, email: 'ap@michealrayberry.com', role: 'ap' });
  });

  it('reads the CF_Authorization cookie when the header is absent', async () => {
    mockCerts();
    const jwt = await token({ aud: ['aud-mrb'], email: 'michealrayberry@gmail.com' });
    const r = new Request('https://michealrayberry.com/api/me', { headers: { Cookie: `x=1; CF_Authorization=${jwt}` } });
    expect(await accessIdentity(r, env)).toMatchObject({ ok: true, role: 'mrb' });
  });

  it('does not let a token from one app act as another role', async () => {
    mockCerts();
    expect(await accessIdentity(req(await token({ aud: ['aud-ap'], email: 'michealrayberry@gmail.com' })), env))
      .toMatchObject({ ok: false, status: 403 });
    expect(await accessIdentity(req(await token({ aud: ['aud-mrb'], email: 'ap@michealrayberry.com' })), env))
      .toMatchObject({ ok: false, status: 403 });
  });

  it('rejects other addresses', async () => {
    mockCerts();
    expect(await accessIdentity(req(await token({ aud: ['aud-mrb'], email: 'someone@example.com' })), env))
      .toMatchObject({ ok: false, status: 403 });
  });

  it('rejects expired, wrong-issuer, wrong-audience and forged tokens', async () => {
    mockCerts();
    const now = Math.floor(Date.now() / 1000);
    const base = { aud: ['aud-mrb'], email: 'michealrayberry@gmail.com' };
    expect(await accessIdentity(req(await token({ ...base, exp: now - 1 })), env)).toMatchObject({ ok: false, status: 401 });
    expect(await accessIdentity(req(await token({ ...base, iss: 'https://evil.cloudflareaccess.com' })), env)).toMatchObject({ ok: false, status: 401 });
    expect(await accessIdentity(req(await token({ ...base, aud: ['other'] })), env)).toMatchObject({ ok: false, status: 401 });
    const other = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['sign', 'verify'],
    ) as CryptoKeyPair;
    expect(await accessIdentity(req(await token(base, other.privateKey)), env)).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects missing and malformed tokens', async () => {
    expect(await accessIdentity(req(), env)).toMatchObject({ ok: false, status: 401 });
    expect(await accessIdentity(req('a.b'), env)).toMatchObject({ ok: false, status: 401 });
  });

  it('fails closed when Access is not configured', async () => {
    expect(await accessIdentity(req('x.y.z'), { ...env, ACCESS_TEAM_DOMAIN: '' })).toMatchObject({ ok: false, status: 500 });
  });

  it('honours DEV_ACCESS_EMAIL only for localhost', async () => {
    const dev = { ...env, DEV_ACCESS_EMAIL: 'michealrayberry@gmail.com' };
    expect(await accessIdentity(req(undefined, 'http://localhost:8787/api/me'), dev)).toMatchObject({ ok: true, role: 'mrb' });
    expect(await accessIdentity(req(undefined, 'https://michealrayberry.com/api/me'), dev)).toMatchObject({ ok: false, status: 401 });
  });
});
