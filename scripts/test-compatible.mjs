// Real build using the current workbook column names and legacy VALID attestation.
// No network requests, new signing keys, confirmation feed, or backend migration.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mrb-compatible-'));
const fixture = path.join(temp, 'site');
const generated = new Set(['node_modules','.git','dist','about','agreement','cards','consent','corrections','daily','data','dashboard','manifests','media','milestones','observer','penalties','positions','share','uniform','updates','violations','weeks']);
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const uri = csv => 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
const csvRow = values => values.map(v => '"' + String(v).replaceAll('"','""') + '"').join(',');
function run(script, env, okay = true) {
  const result = spawnSync(process.execPath, [script, ...(script.endsWith('check-site.mjs') ? ['dist'] : [])], { cwd: fixture, env, encoding: 'utf8' });
  if (okay && result.status !== 0) throw new Error(result.stdout + '\n' + result.stderr);
  if (!okay) assert.notEqual(result.status, 0, 'Invalid required feed must fail the build');
  else if (result.stdout) process.stdout.write(result.stdout);
}
try {
  await fs.cp(ROOT, fixture, { recursive: true, filter(source) {
    const relative = path.relative(ROOT, source);
    const first = relative.split(path.sep)[0];
    return !relative || (!generated.has(first) && !first.startsWith('.dist-stage-') && !/^photos\/\d{4}\//.test(relative));
  } });
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  const photoDir = path.join(fixture, 'photos', date.replaceAll('-', '/'));
  await fs.mkdir(photoDir, { recursive: true });
  for (const angle of ['front','left','rear','right']) await fs.copyFile(
    path.join(ROOT, 'photos/official/micheal-ray-berry-official-front-v2.jpg'),
    path.join(photoDir, `micheal-ray-berry-day-001-${angle}-${date}.jpg`));
  const env = { ...process.env,
    WEIGHINS_CSV: uri('date,weight,note,photo,left,rear,right,video,video_sec,private_extra\n' + csvRow([date,350.1,'Public note <script>alert(1)</script>','https://drive.google.com/file/d/PRIVATE_PHOTO/view','','','','https://youtu.be/AAAAAAAAAAA',60,'PRIVATE_EXTRA_SENTINEL'])),
    VIOLATION_CSV: uri('date,violation,status,submitted,resolved,ap_verification,corrections,recording\n' + csvRow([date,'Missed filing','corrected','2020-01-01 12:00','','Awaiting review','10 minutes',''])),
    ATTESTATION_CSV: uri('logged_at_server,date,day,event,code,kind,video_sha256,photo_sha256s,weight,status,chunk_chain,chunk_count,server_seal,sealed_at,private_extra\n' + csvRow([date+'T15:00:00Z',date,1,'capture-attested','1234','daily','a'.repeat(64),['b','c','d','e'].map(c=>c.repeat(64)).join(' '),350.1,'VALID — code issued 1 min before attest','f'.repeat(64),1,'PRIVATE_SEAL_SENTINEL',date+'T15:00:00Z','PRIVATE_ATTEST_SENTINEL']) + '\n' + csvRow([date+'T15:01:00Z',date,1,'capture-attested','2345','daily','9'.repeat(64),'',350.1,'INVALID','','','','',''])),
    SITE_STATE_CSV: uri('key,value\nstart_date,' + date + '\nsecret,PRIVATE_STATE_SENTINEL\n'),
    SUPERVISION_CSV: uri('date,required,status,start,end,stream_url,note\n' + csvRow([date,true,'EXCEPTION — PRIVATE_REASON_SENTINEL','','','','PRIVATE_NOTE_SENTINEL'])),
    UPDATES_CSV: uri('date,type,title,body,link\n' + csvRow([date,'official','Test update','Public update','/daily/'])),
  };
  delete env.GITHUB_WORKSPACE;
  delete env.CONFIRMATIONS_CSV;
  delete env.ATTESTATION_SEAL_SECRET;
  run('scripts/publish.mjs', env);
  run('scripts/prepare-dist.mjs', env);
  run('scripts/check-site.mjs', env);
  const data = JSON.parse(await fs.readFile(path.join(fixture, 'dist/data/record.json'), 'utf8'));
  assert.equal(data.counters.currentLabel, '350.1');
  assert.equal(data.counters.openCountLabel, '1', 'Correction remains open until the existing AP record resolves it');
  assert.match(data.counters.todayPacketLabel, /Files present/);
  const attest = JSON.parse(await fs.readFile(path.join(fixture, 'dist/data/attestations.json'), 'utf8'));
  assert.equal(attest.records.length, 1, 'Legacy VALID accepted; INVALID excluded');
  const dashboard = await fs.readFile(path.join(fixture, 'dist/dashboard/index.html'), 'utf8');
  assert.match(dashboard, /src="https:\/\/michealrayberry.com\/photos\//, 'Dashboard photo has a real src');
  assert(dashboard.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  async function inspect(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const p = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspect(p);
      else if (/\.(?:html|json|csv|xml)$/.test(entry.name)) assert(!/PRIVATE_(?:EXTRA|ATTEST|STATE|NOTE|REASON|SEAL|PHOTO)/.test(await fs.readFile(p, 'utf8')), 'Private field leaked: ' + p);
    }
  }
  await inspect(path.join(fixture, 'dist'));
  run('scripts/publish.mjs', { ...env, WEIGHINS_CSV: uri('<html>Sign in</html>') }, false);
  // A bad build leaves the last completed deployment directory intact.
  assert.equal(await fs.readFile(path.join(fixture, 'dist/data/record.json'), 'utf8'), JSON.stringify(data) + '\n');
  console.log('Legacy workbook compatibility, output privacy, and failed-build preservation passed.');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
