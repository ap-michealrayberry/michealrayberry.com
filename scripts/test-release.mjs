#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mrb-release-fixture-'));
const fixtureRoot = path.join(temporaryRoot, 'repo');

function dataUri(value) {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(value)}`;
}

function csvRow(values) {
  return values.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',');
}

function runNode(script, environment) {
  const result = spawnSync(process.execPath, [script], {
    cwd: fixtureRoot,
    env: environment,
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${script} exited with status ${result.status}`);
}

try {
  await fs.cp(ROOT, fixtureRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(ROOT, source);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return first !== '.git' && first !== 'node_modules' && first !== 'dist'
        && !first.startsWith('.dist-stage-');
    },
  });
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(fixtureRoot, 'node_modules'), 'dir');

  const secret = 'release-fixture-only-secret-000000000000000000000000';
  const date = '2026-09-13';
  const day = 14;
  const loggedAt = '2026-09-13T16:00:00.000Z';
  const sealedAt = '2026-09-13T16:01:00.000Z';
  const confirmationUrl = 'https://youtu.be/AAAAAAAAAAA';
  const videoHash = 'b'.repeat(64);
  const chunkChain = 'c'.repeat(64);
  const sealPayload = JSON.stringify([
    'MRB_ATTESTATION_SEAL_V2', loggedAt, date, String(day), 'capture-attested',
    '1234', 'confirmation', videoHash, '', '', 'VALID-CONSUMED', chunkChain, '1', sealedAt,
  ]);
  const seal = crypto.createHmac('sha256', secret).update(sealPayload, 'utf8').digest('hex');
  const fingerprint = crypto.createHash('sha256').update(
    `agreement-confirmation-v1\n2\n${date}\n${confirmationUrl}\n${seal}\n${videoHash}`,
    'utf8',
  ).digest('hex');

  const weighInSource = await fs.readFile(path.join(fixtureRoot, 'data', 'weigh-ins.csv'), 'utf8');
  const weighInLines = weighInSource.split('\n');
  if (!weighInLines[0].includes('"published_at"')) {
    throw new Error('release fixture expected the generated public Weigh-ins schema');
  }
  weighInLines[0] = weighInLines[0].replace('"published_at"', '"video_sec"');
  for (let index = 1; index < weighInLines.length; index += 1) {
    if (weighInLines[index].trim()) {
      weighInLines[index] = weighInLines[index].replace(/,"[^"]*"\r?$/, ',""');
    }
  }

  const environment = { ...process.env };
  delete environment.GITHUB_WORKSPACE;
  Object.assign(environment, {
    WEIGHINS_CSV: dataUri(weighInLines.join('\n')),
    VIOLATION_CSV: dataUri('date,violation,status,submitted,resolved,ap_verification,corrections,recording,event_verification\n'),
    ATTESTATION_CSV: dataUri([
      'logged_at_server,date,day,event,code,kind,video_sha256,photo_sha256s,weight,status,chunk_chain,chunk_count,server_seal,sealed_at',
      csvRow([loggedAt, date, day, 'capture-attested', '1234', 'confirmation', videoHash, '', '', 'VALID-CONSUMED', chunkChain, 1, seal, sealedAt]),
    ].join('\n') + '\n'),
    CONFIRMATIONS_CSV: dataUri([
      'logged_at,date,version,day,url,attestation_seal',
      csvRow(['2026-09-13T16:02:00.000Z', date, 2, day, confirmationUrl, seal]),
    ].join('\n') + '\n'),
    SUPERVISION_CSV: dataUri('date,required,status,start,end,stream_url,note\n'),
    UPDATES_CSV: dataUri('date,type,title,body,link\n'),
    SITE_STATE_CSV: dataUri([
      'key,value',
      'start_date,2026-08-31',
      'agreement_edition,2',
      'mrb_signature_verified_at,2026-09-13',
      'ap_signature_verified_at,2026-09-13',
      'agreement_confirmation_date,2026-09-13',
      'agreement_confirmation_verified_at,2026-09-13',
      `agreement_confirmation_fingerprint,${fingerprint}`,
    ].join('\n') + '\n'),
    ATTESTATION_SEAL_SECRET: secret,
    SOURCE_DATE_EPOCH: String(Math.floor(Date.parse('2026-09-13T20:12:10.000Z') / 1000)),
  });

  runNode('scripts/publish.mjs', environment);
  const manifest = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'data', 'feed-manifest.json'), 'utf8'));
  const agreement = await fs.readFile(path.join(fixtureRoot, 'agreement', 'index.html'), 'utf8');
  if (manifest.agreement_active !== true || manifest.agreement_effective_date !== date ||
      !agreement.includes('Agreement execution is recorded as verified effective')) {
    throw new Error('signed activation fixture did not produce the exact verified agreement state');
  }

  runNode('scripts/prepare-dist.mjs', environment);
  const audit = spawnSync(process.execPath, ['scripts/audit-output.mjs', 'dist'], {
    cwd: fixtureRoot,
    env: environment,
    encoding: 'utf8',
  });
  if (audit.stdout) process.stdout.write(audit.stdout);
  if (audit.stderr) process.stderr.write(audit.stderr);
  if (audit.status !== 0) throw new Error(`dist audit exited with status ${audit.status}`);
  console.log('Release integration passed: signed active publish, allowlisted dist, and full output audit.');
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
