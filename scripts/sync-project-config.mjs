import { readFile, writeFile } from 'node:fs/promises';
import { PROJECT } from './project-config.mjs';

const fileToolUrl = new URL('../assistant/file/file.js', import.meta.url);
let fileTool = await readFile(fileToolUrl, 'utf8');
const toolFacts = 'var PROJECT = ' + JSON.stringify(PROJECT) + ';';
const toolPattern = /var PROJECT = .*?;/;
if (process.argv.includes('--check')) {
  if (!fileTool.includes(toolFacts)) throw new Error('File tool project facts are stale; run npm run sync-config.');
} else {
  fileTool = toolPattern.test(fileTool) ? fileTool.replace(toolPattern, toolFacts) : toolFacts + '\n' + fileTool;
  await writeFile(fileToolUrl, fileTool);
}
const scriptUrl = new URL('../apps-script/Code.gs', import.meta.url);
const source = await readFile(scriptUrl, 'utf8');
const block = `/* PROJECT_CONFIG:BEGIN — generated; edit project-config-v2.json, then npm run sync-config. */\nvar PROJECT_FACTS = ${JSON.stringify(PROJECT, null, 2)};\n/* PROJECT_CONFIG:END */`;
const pattern = /\/\* PROJECT_CONFIG:BEGIN[\s\S]*?\/\* PROJECT_CONFIG:END \*\//;
if (process.argv.includes('--check')) {
  if (!source.includes(block)) throw new Error('Apps Script project facts are stale; run npm run sync-config.');
  const assistant = await readFile(new URL('../assistant/js/01-config.js', import.meta.url), 'utf8');
  if (!assistant.includes('var PROJECT = ' + JSON.stringify(PROJECT) + ';')) throw new Error('Recording Assistant facts are stale; run npm run sync-config.');
  console.log('Versioned project facts match Apps Script and Recording Assistant.');
} else {
  await writeFile(scriptUrl, pattern.test(source) ? source.replace(pattern, block) : block + '\n\n' + source);
  console.log('Synchronized Apps Script project facts.');
}
