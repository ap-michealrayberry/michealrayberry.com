import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

for (const file of await fs.readdir('scripts')) {
  if (!file.endsWith('.mjs')) continue;
  const result = spawnSync(process.execPath, ['--check', 'scripts/' + file], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}
for (const file of ['live.js','live/overlay.js','livenav.js','record.js','share.js','unsw.js',
  'verify/verify.js','assistant/app.js','assistant/file/file.js','assistant/sw.js','apps-script/Code.gs']) {
  new vm.Script(await fs.readFile(file, 'utf8'), { filename: file });
}
console.log('Build scripts, public scripts, and existing backend syntax passed.');
