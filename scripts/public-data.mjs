// Public output is projected from the existing workbook during the normal build.
// No new service, sheet columns, signing keys, or Apps Script deployment.
export const SITE_STATE_KEYS = new Set([
  'start_date', 'prior_attempt_note', 'intro_video_url', 'wait_still_url',
  'demo_video_url', 'demo_url', 'ytfiled',
]);

export function publicUrl(value, origin = 'https://michealrayberry.com') {
  const raw = String(value || '').trim();
  if (!raw || /[\u0000-\u0020<>"\\]/.test(raw)) return '';
  try {
    const url = new URL(raw, origin);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    // Drive evidence and workbook exports are operational inputs, not public assets.
    if (/(^|\.)(?:drive|docs|script)\.google\.com$/i.test(url.hostname)
      || /(^|\.)googleusercontent\.com$/i.test(url.hostname)) return '';
    if (!raw.startsWith('/') && !raw.startsWith('https://')) return '';
    return url.href;
  } catch { return ''; }
}

export function csvDocument(headers, rows) {
  const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return [headers, ...rows].map(row => row.map(cell).join(',')).join('\n') + '\n';
}

export function acceptedAttestations(rows, normalizeDate) {
  const head = (rows[0] || []).map(value => String(value).trim().toLowerCase());
  const get = (row, key) => String(row[head.indexOf(key)] || '').trim();
  const hashes = value => (String(value).toLowerCase().match(/\b[a-f0-9]{64}\b/g) || []);
  return rows.slice(1).filter(row => get(row, 'event') === 'capture-attested'
    && /^VALID(?:\b|[- —])/i.test(get(row, 'status')))
    .map(row => ({
      received_at: get(row, 'logged_at_server') || get(row, 'logged_at'),
      date: normalizeDate(get(row, 'date')),
      day: Number(get(row, 'day')) || null,
      event: 'capture-attested',
      kind: get(row, 'kind'),
      status: 'VALID',
      video_sha256: hashes(get(row, 'video_sha256'))[0] || '',
      photo_sha256s: hashes(get(row, 'photo_sha256s')),
    }))
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      && (row.video_sha256 || row.photo_sha256s.length));
}
