/* CSP conformance: every external origin the code fetches, imports, or spawns
   a worker from must be permitted by the directive that will actually govern
   it in _headers. This is the mechanical check for the "removed an origin the
   code still needs" class of bug: the header edit deploys, the tool breaks,
   and nothing points back at the header. */

export const SELF_ORIGIN = 'https://michealrayberry.com';

// The Content-Security-Policy line out of a Cloudflare Pages _headers file.
export function extractCsp(headersText) {
  const m = headersText.match(/^\s*Content-Security-Policy:\s*(.+)$/m);
  if (!m) throw new Error('_headers has no Content-Security-Policy line');
  return m[1].trim();
}

export function parseCsp(cspText) {
  const map = new Map();
  for (const part of cspText.split(';')) {
    const toks = part.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    map.set(toks[0], toks.slice(1));
  }
  return map;
}

function sourceMatches(source, url) {
  const s = source.replace(/^'|'$/g, '');
  if (s === 'self') return url.startsWith(SELF_ORIGIN + '/') || url === SELF_ORIGIN;
  if (s === 'unsafe-inline' || s === 'unsafe-eval' || s === 'none' || s === 'upgrade-insecure-requests') return false;
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return url.startsWith(s); // scheme source: blob:, data:, https:
  let origin;
  try { origin = new URL(url).origin; } catch (e) { return false; }
  if (s.includes('*')) {
    const re = new RegExp('^' + s.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
    return re.test(origin);
  }
  return s === origin;
}

/* Directive fallback per CSP3 (only the chains this site uses). */
const FALLBACK = {
  'script-src': ['default-src'],
  'worker-src': ['child-src', 'script-src', 'default-src'],
  'connect-src': ['default-src'],
  'media-src': ['default-src'],
  'img-src': ['default-src'],
  'frame-src': ['child-src', 'default-src'],
};

export function cspAllows(map, directive, url) {
  let sources = map.get(directive);
  if (!sources) {
    for (const fb of FALLBACK[directive] || []) {
      if (map.has(fb)) { sources = map.get(fb); break; }
    }
  }
  if (!sources) return false;
  return sources.some((s) => sourceMatches(s, url));
}

/* needs: [{ url, directive, why }] → list of human-readable violations. */
export function checkNetworkNeeds(map, needs) {
  const out = [];
  for (const n of needs) {
    if (!cspAllows(map, n.directive, n.url)) {
      out.push(n.directive + ' does not permit ' + n.url + ' — needed for: ' + n.why);
    }
  }
  return out;
}

// Every absolute https:// literal in a source string (deduped by origin).
export function httpsLiterals(jsSource) {
  const out = new Set();
  for (const m of jsSource.matchAll(/https:\/\/[^\s'"`\\)]+/g)) out.add(m[0]);
  return out;
}
