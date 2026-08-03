/* Endpoint calls (challenge code, attestation, packet filing) and the pure
   parsers for what the record sends back. The endpoints are owned by the
   Accountability Partner and are fixed — treat them as given. Only the
   low-privilege device key is ever sent; the tools never touch the AP key. */

export async function sha256Blob(blob) {
  const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* cfg: { endpoint, deviceKey(), isoStr, dayNum, fetchFn } */
export function createRecordClient(cfg) {
  const fetchFn = cfg.fetchFn || ((...a) => fetch(...a));

  async function fetchChallenge(kind) {
    try {
      const r = await fetchFn(cfg.endpoint + '?action=challenge&kind=' + kind + '&key=' + encodeURIComponent(cfg.deviceKey()));
      const j = await r.json();
      return j && j.ok && j.code ? j : null;
    } catch (e) { return null; }
  }

  async function attestPost(payload) {
    try {
      const r = await fetchFn(cfg.endpoint, { method: 'POST', body: JSON.stringify(Object.assign({ action: 'attest', date: cfg.isoStr, day: cfg.dayNum, key: cfg.deviceKey() }, payload)) });
      const j = await r.json();
      return !!(j && j.ok);
    } catch (e) { return false; }
  }

  async function postPacket(payload) {
    try {
      const r = await fetchFn(cfg.endpoint, { method: 'POST', body: JSON.stringify(Object.assign({ action: 'packet', date: cfg.isoStr, day: cfg.dayNum, key: cfg.deviceKey() }, payload)) });
      return !!(await r.json()).ok;
    } catch (e) { return false; }
  }

  return { fetchChallenge, attestPost, postPacket };
}

// ---- Pure parsers for the tracker's gviz CSV exports ----

// Packet checklist: today's row → which parts are already on the record.
export function parseChecklist(text, isoStr) {
  const line = text.split(/\r?\n/).find((l) => l.indexOf('"' + isoStr + '"') === 0);
  const cols = line ? line.split('","').map((s) => s.replace(/^"|"$/g, '')) : [];
  return {
    weight: !!parseFloat(cols[1]),
    photos: !!(cols[3] || '').trim(),
    video: !!(cols[7] || '').trim(),
  };
}

// Weight prefill: today's logged weight if present, else the most recent one.
export function parseWeightPrefill(text, isoStr) {
  const rows = text.trim().split(/\r?\n/);
  let todayWeight = null, lastLogged = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const cols = rows[i].split(',');
    const dateStr = (cols[0] || '').replace(/"/g, '').trim();
    const w = parseFloat((cols[1] || '').replace(/"/g, ''));
    if (isNaN(w)) continue;
    if (lastLogged === null) lastLogged = w;              // most recent non-empty (from bottom)
    if (dateStr === isoStr && todayWeight === null) todayWeight = w;
  }
  return { todayWeight, lastLogged };
}

// Health tab: today's scale-synced weight (column 7), or null if not synced yet.
export function parseHealthWeight(text, isoStr) {
  const rows = text.trim().split(/\r?\n/);
  for (let i = rows.length - 1; i >= 1; i--) {
    const cols = rows[i].split(',').map((c) => c.replace(/"/g, '').trim());
    if (cols[0] === isoStr && parseFloat(cols[7])) return parseFloat(cols[7]);
  }
  return null;
}

// Optional 'Meal Plan' tab: today's assigned meal, or null.
export function parseMealPlan(text, isoStr) {
  const lines = text.trim().split(/\r?\n/).map((l) => l.split('","').map((s) => s.replace(/^"|"$/g, '')));
  if (!lines[0] || String(lines[0][1]).toLowerCase() !== 'meal') return null; // gviz fell back to another tab
  const row = lines.find((l) => (l[0] || '').trim() === isoStr);
  if (row && (row[1] || '').trim()) {
    return { meal: row[1].trim(), labels: (row[2] || '').split(',').map((x) => x.trim()).filter(Boolean) };
  }
  return null;
}

// Minutes left to the 22:00 ET packet deadline (negative = past).
export function minutesToDeadline(now) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: 'numeric', minute: 'numeric' }).formatToParts(now);
  return (22 * 60) - ((+p.find((x) => x.type === 'hour').value) * 60 + (+p.find((x) => x.type === 'minute').value));
}
