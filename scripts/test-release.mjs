#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT } from './project-config.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mrb-release-fixture-'));
const fixtureRoot = path.join(temporaryRoot, 'repo');
const csvRow = values => values.map(v => `"${String(v).replaceAll('"','""')}"`).join(',');
const dataUri = text => `data:text/csv;charset=utf-8,${encodeURIComponent(text)}`;
const read = file => fs.readFile(path.join(fixtureRoot, file), 'utf8');
const readJson = async file => JSON.parse(await read(file));
function run(script, env, success = true) {
 const result = spawnSync(process.execPath, [script, ...(script.endsWith('audit-output.mjs') ? ['dist'] : [])], { cwd: fixtureRoot, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
 if ((result.status === 0) !== success) throw new Error(`${script} unexpected exit ${result.status}\n${result.stdout}\n${result.stderr}`);
 return result;
}
try {
 await fs.cp(ROOT, fixtureRoot, { recursive: true, filter(source) {
  const first = path.relative(ROOT, source).split(path.sep)[0];
  return !['.git','node_modules','dist'].includes(first) && !first.startsWith('.dist-stage-');
 }});
 await fs.symlink(path.join(ROOT, 'node_modules'), path.join(fixtureRoot, 'node_modules'), 'dir');
 const date = PROJECT.startDate, testDate = PROJECT.testStartDate;
 const secret = 'release-fixture-only-secret-000000000000000000000000';
 const day = 1, logged = `${date}T16:00:00.000Z`, sealed = `${date}T16:01:00.000Z`;
 const videoHash = 'b'.repeat(64), chain = 'c'.repeat(64), url = 'https://youtu.be/AAAAAAAAAAA';
 const payload = JSON.stringify(['MRB_ATTESTATION_SEAL_V2',logged,date,String(day),'capture-attested','1234','confirmation',videoHash,'','','VALID-CONSUMED',chain,'1',sealed]);
 const seal = crypto.createHmac('sha256',secret).update(payload).digest('hex');
 const fingerprint = crypto.createHash('sha256').update(`agreement-confirmation-v1\n2\n${date}\n${url}\n${seal}\n${videoHash}`).digest('hex');
 // Raw fixture input never depends on generated files in a fresh checkout.
 const testEventText = 'Daily packet documentation missing';
 const testEventMarker = 'APV1|' + testDate + '|' + crypto.createHash('sha256').update('violation-v1\n' + testDate + '\n' + testEventText).digest('hex');
 const weighins = ['date,weight_lb,note,photo_front,photo_left,photo_rear,photo_right,video,video_sec', csvRow([testDate,340,'','','','','',url,60]), csvRow([date,339,'','','','','',url,60])].join('\n') + '\n';
 for (const d of [date,testDate]) for (const angle of ['front','left','rear','right']) {
  const dir = path.join(fixtureRoot,'photos',...d.split('-'));
  await fs.mkdir(dir,{recursive:true});
  await fs.copyFile(path.join(ROOT,'photos/2026/08/31',`micheal-ray-berry-day-001-${angle}-2026-08-31.jpg`),path.join(dir,`micheal-ray-berry-day-001-${angle}-${d}.jpg`));
 }
 const env = {...process.env}; delete env.GITHUB_WORKSPACE;
 Object.assign(env, {
  WEIGHINS_CSV:dataUri(weighins),
  VIOLATION_CSV:dataUri('date,violation,status,submitted,resolved,ap_verification,corrections,recording,event_verification\n' + csvRow([testDate,testEventText,'Open','','','','','',testEventMarker]) + '\n'),
  ATTESTATION_CSV:dataUri('logged_at_server,date,day,event,code,kind,video_sha256,photo_sha256s,weight,status,chunk_chain,chunk_count,server_seal,sealed_at\n'+csvRow([logged,date,day,'capture-attested','1234','confirmation',videoHash,'','','VALID-CONSUMED',chain,1,seal,sealed])+'\n'),
  CONFIRMATIONS_CSV:dataUri('logged_at,date,version,day,url,attestation_seal\n'+csvRow([`${date}T16:02:00.000Z`,date,2,day,url,seal])+'\n'),
  SUPERVISION_CSV:dataUri('date,required,status,start,end,stream_url,note\n'+csvRow([testDate,'true','COMPLETED','18:00','22:00',url,'PRIVATE NOTE MUST NOT LEAK'])+'\n'),
  UPDATES_CSV:dataUri('date,type,title,body,link\n'), ATTESTATION_SEAL_SECRET:secret,
 });
 const state = signed => dataUri(['key,value',`start_date,${date}`,`test_start_date,${testDate}`,'test_mode,on',...(signed ? ['agreement_edition,2',`mrb_signature_verified_at,${date}`,`ap_signature_verified_at,${date}`,`agreement_confirmation_date,${date}`,`agreement_confirmation_verified_at,${date}`,`agreement_confirmation_fingerprint,${fingerprint}`] : [])].join('\n')+'\n');
 env.SITE_STATE_CSV = state(false); env.SOURCE_DATE_EPOCH = String(Date.parse(`${testDate}T20:12:10Z`)/1000);
 run('scripts/publish.mjs',env);
 assert.equal((await readJson('data/feed-manifest.json')).record_phase,'test');
 assert.ok((await read('live/index.html')).includes('player.twitch.tv/?channel=michealrayberry'));
 assert.ok((await read('agreement/index.html')).includes('TEST outcomes do not verify Edition 2 execution'));
 const priorTest = await readJson('data/testing.json');
 assert.equal(priorTest.violations.length,1);
 assert.ok(!(await read('agreement/index.html')).includes('Agreement execution is recorded as verified effective'));
 assert.equal(priorTest.records.length,1); assert.ok(Object.values(priorTest.records[0].photos).every(Boolean));
 assert.ok(!JSON.stringify(priorTest).includes('PRIVATE NOTE'));
 run('scripts/prepare-dist.mjs',env); run('scripts/audit-output.mjs',env);
 if (process.env.MRB_PREVIEW_DIR) await fs.cp(path.join(fixtureRoot, 'dist'), process.env.MRB_PREVIEW_DIR, {recursive:true});
 for (const p of ['accountable','notify','partner','testing']) await fs.access(path.join(fixtureRoot,'dist',p,'index.html'));
 assert.ok((await read('dist/observer/index.html')).includes('action="/api/observer"'));
 assert.ok(!(await read('dist/observer/index.html')).includes('data-netlify'));
 assert.ok((await read('dist/notify/index.html')).includes('data-action="subscribe"'));
 // Launch preserves tests without activating an unsigned agreement.
 env.SOURCE_DATE_EPOCH = String(Date.parse(`${date}T20:12:10Z`)/1000);
 run('scripts/publish.mjs',env);
 assert.equal((await readJson('data/feed-manifest.json')).agreement_active,false);
 assert.equal((await readJson('data/feed-manifest.json')).record_phase,'official');
 assert.deepEqual((await readJson('data/testing.json')).records[0],priorTest.records[0]);
 assert.deepEqual((await readJson('data/testing.json')).violations,priorTest.violations);
 assert.ok(!(await read('data/violations.csv')).includes(testEventText));
 assert.ok(!(await read('data/weigh-ins.csv')).includes(testDate));
 assert.ok((await read('live/index.html')).includes('player.twitch.tv/?channel=michealrayberry'));
 run('scripts/prepare-dist.mjs',env); run('scripts/audit-output.mjs',env);
 await fs.access(path.join(fixtureRoot,'dist/testing',testDate,'index.html'));
 await fs.access(path.join(fixtureRoot,'dist/photos',...testDate.split('-'),`micheal-ray-berry-day-001-front-${testDate}.jpg`));
 env.SITE_STATE_CSV = state(true); run('scripts/publish.mjs',env);
 const manifest = await readJson('data/feed-manifest.json');
 assert.equal(manifest.agreement_active,true); assert.equal(manifest.agreement_effective_date,date);
 assert.ok((await read('agreement/index.html')).includes('execution is recorded as verified effective'));
 run('scripts/prepare-dist.mjs',env); run('scripts/audit-output.mjs',env);
 env.SITE_STATE_CSV = dataUri(`key,value\nstart_date,${date}\nagreement_edition,2\n`);
 run('scripts/publish.mjs',env,false);
 env.SITE_STATE_CSV = dataUri('key,value\nstart_date,2026-08-31\n'); run('scripts/publish.mjs',env,false);
 console.log('Release integration passed: public tests, four-angle retention, launch isolation, inactive and signed activation, Twitch, forms, staging, audits, and fail-closed mismatches.');
} finally { await fs.rm(temporaryRoot,{recursive:true,force:true}); }
