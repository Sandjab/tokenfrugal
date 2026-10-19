#!/usr/bin/env node
// bin/tokenfrugal.mjs — relève les sessions et génère la page (spec § 4).
import { parseArgs } from 'node:util';
import { stat, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { collect, loadSessions } from '../src/store/store.js';
import { buildReport } from '../src/report/build.js';
import { recommend } from '../src/model/recommend.js';
import { ANALYZER_VERSION } from '../src/read/session.js';
import { T, recommendationText } from '../src/report/strings.js';

const USAGE = 'usage : tokenfrugal <collect|report> [--projects <dossier>] [--store <dossier>] [--no-collect] [--open]';

async function main(argv) {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv, allowPositionals: true,
      options: {
        projects: { type: 'string', default: path.join(os.homedir(), '.claude', 'projects') },
        store: { type: 'string', default: path.join(os.homedir(), '.tokenfrugal') },
        'no-collect': { type: 'boolean', default: false },
        open: { type: 'boolean', default: false },
      },
    }));
  } catch { console.error(USAGE); return 2; }
  const cmd = positionals[0];
  if (cmd !== 'collect' && cmd !== 'report') { console.error(USAGE); return 2; }

  if (cmd === 'collect' || !values['no-collect']) {
    let isDir = false;
    try { isDir = (await stat(values.projects)).isDirectory(); } catch { /* absent */ }
    if (!isDir) { console.error(T.cli.noProjects(values.projects)); return 1; }
    const r = await collect({
      projectsDir: values.projects, storeDir: values.store,
      onProgress: ({ done, total }) => process.stderr.write(`\r${done}/${total}`),
    });
    process.stderr.write('\n');
    console.log(T.cli.collected(r));
  }

  if (cmd === 'report') {
    const sessions = await loadSessions(values.store);
    await mkdir(values.store, { recursive: true });
    const file = path.join(values.store, 'report.html');
    await writeFile(file, buildReport({ analyzer: ANALYZER_VERSION, sessions }));
    const recos = recommend(sessions).slice(0, 3);
    console.log(T.cli.recommendations);
    if (!recos.length) console.log(`  ${T.cli.noRecommendation}`);
    for (const [i, r] of recos.entries()) console.log(`  ${i + 1}. ${recommendationText(r, 'usd')}`);
    console.log(T.cli.reportWritten(file));
    if (values.open) openFile(file);
  }
  return 0;
}

function openFile(file) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [file]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : ['xdg-open', [file]];
  execFile(cmd, args, (err) => { if (err) console.error(T.cli.openFailed); });
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => { console.error(e.stack || String(e)); process.exitCode = 1; },
);
