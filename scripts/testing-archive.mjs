import { promises as fs } from 'node:fs';

/* Regenerate from the same validated operational inputs, independently of
   the current attempt's date filter. No private notes, keys, seals, or names
   of third parties are included. Keep test rows in the operations workbook. */
export async function testingArchive(ctx) {
  const { ROOT, SITE_ORIGIN, TEST_START, LAUNCH_DATE, today, rows, violations, supervision, photoFiles, findPhoto, relUrl, publicVideoUrl, synPage, htmlEscape: esc, writeIfChanged } = ctx;
  const span = Math.round((Date.parse(`${LAUNCH_DATE}T12:00:00Z`) - Date.parse(`${TEST_START}T12:00:00Z`)) / 864e5);
  const label = date => `T-${span - Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${TEST_START}T12:00:00Z`)) / 864e5)}`;
  const records = [];
  const existing = new Map();
  for (const row of rows.slice(1)) {
    const date = String(row[0] || '').trim();
    if (date < TEST_START || date >= LAUNCH_DATE || date > today || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (existing.has(date)) throw new Error(`Duplicate public test date: ${date}`);
    existing.set(date, row);
  }
  for (let d = new Date(`${TEST_START}T12:00:00Z`); d.toISOString().slice(0, 10) < LAUNCH_DATE && d.toISOString().slice(0, 10) <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10), row = existing.get(date);
    const day = Math.round((d - new Date(`${TEST_START}T12:00:00Z`)) / 864e5) + 1;
    const photos = {};
    for (const angle of ['front','left','rear','right']) {
      const photo = findPhoto(photoFiles, date, day, angle);
      photos[angle] = photo ? `${SITE_ORIGIN}${relUrl(photo)}` : null;
    }
    const weight = row && Number.parseFloat(row[1]);
    const video = row ? publicVideoUrl(row[7]) : '';
    records.push({ date, label: label(date), weight_lb: Number.isFinite(weight) ? weight : null, video_url: video || null, photos });
  }
  const sessions = supervision.filter(s => s.date >= TEST_START && s.date < LAUNCH_DATE && s.date <= today)
    .map(s => ({ date: s.date, required: s.required, status: /^(COMPLETED|MISSED|SUBMITTED)$/.test(s.status) ? s.status : /^EXCEPTION/.test(s.status) ? 'EXCEPTION' : 'PENDING', video_url: s.url || null }));
  const events = violations.map(v => ({ date: v.date, public_id: v.id, description: v.what, state: v.state, verified_at: v.eventVerifiedAt, recording_url: v.recording || null }));
  const archive = { schema_version: 1, phase: 'prelaunch-test', test_start_date: TEST_START, official_start_date: LAUNCH_DATE, records, violations: events, supervision: sessions };
  await writeIfChanged(`${ROOT}/data/testing.json`, JSON.stringify(archive, null, 2) + '\n');
  // Clear stale generated pages to honor corrections and lawful takedowns.
  await fs.mkdir(`${ROOT}/testing`, { recursive: true });
  const notice = '<p class="lede"><strong>Public prelaunch test archive.</strong> These records exercise the live system. They do not establish agreement execution or count toward official progress, milestone verification, or completion.</p>';
  const indexBody = `<p class="crumb"><a href="/">Record</a> · Public testing</p><h1>Public Test Archive</h1>${notice}<p>Test period: ${esc(TEST_START)} through the day before ${esc(LAUNCH_DATE)}. Livestreams, submissions, AP review, and notifications remain part of public testing. Test emails carry [TEST]. This archive remains available after launch, subject to the same privacy, consent, safety, and lawful takedown rules as the official record.</p>${records.length ? `<ul>${records.map(r => `<li><a href="/testing/${r.date}/">${r.label} · ${r.date}</a> · ${r.weight_lb == null ? 'No measured weight filed' : `${r.weight_lb.toFixed(1)} lb`}</li>`).join('')}</ul>` : '<p>No test dates have begun yet.</p>'}<p><a href="/live/">Twitch supervision</a> · <a href="/daily/">Current record</a> · <a href="/data/testing.json">Public test data</a></p>`;
  await writeIfChanged(`${ROOT}/testing/index.html`, synPage({ title: 'Public Test Archive — Micheal Ray Berry', desc: 'Dated public prelaunch test evidence, outcomes, and supervision; preserved after launch and excluded from official progress.', canonical: `${SITE_ORIGIN}/testing/`, body: indexBody }));
  for (const record of records) {
    const session = sessions.find(s => s.date === record.date);
    const dayEvents = events.filter(v => v.date === record.date);
    const body = `<p class="crumb"><a href="/testing/">Public test archive</a> · ${record.date}</p><h1>${record.label} · ${record.date}</h1>${notice}<h2>Test evidence</h2><p>Recorded weight: <strong>${record.weight_lb == null ? 'Not filed' : `${record.weight_lb.toFixed(1)} lb`}</strong>.</p><p>${record.video_url ? `<a href="${esc(record.video_url)}">View recorded test inspection</a>` : 'No public test inspection video filed.'}</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px">${Object.entries(record.photos).map(([angle,url]) => `<figure style="margin:0">${url ? `<img src="${esc(url)}" alt="Micheal Ray Berry, ${record.label} public test photograph, ${angle} view" style="width:100%;height:auto" loading="lazy">` : `<p>No ${angle} photograph filed.</p>`}<figcaption>${esc(angle)} · TEST</figcaption></figure>`).join('')}</div><h2>Test supervision</h2><p>${session ? `${esc(session.status)}${session.video_url ? ` · <a href="${esc(session.video_url)}">Public recording</a>` : ''}` : 'No test supervision ruling recorded.'}</p><h2>AP-verified test events</h2>${dayEvents.length ? `<ul>${dayEvents.map(v => `<li>${esc(v.public_id)} · ${esc(v.description)} · ${esc(v.state)} · verified ${esc(v.verified_at)}${v.recording_url ? ` · <a href="${esc(v.recording_url)}">Test correction recording</a>` : ''}</li>`).join('')}</ul>` : '<p>No AP-verified test event recorded for this date.</p>'}<p><a href="/testing/">All public tests</a></p>`;
    await writeIfChanged(`${ROOT}/testing/${record.date}/index.html`, synPage({ title: `${record.label} · ${record.date} — Public Test — Micheal Ray Berry`, desc: `Public prelaunch test evidence and AP-reviewed outcomes for ${record.date}; excluded from the official record totals.`, canonical: `${SITE_ORIGIN}/testing/${record.date}/`, body }));
  }
}
