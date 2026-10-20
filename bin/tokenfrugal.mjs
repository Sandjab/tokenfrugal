#!/usr/bin/env node
// bin/tokenfrugal.mjs — relève les sessions et génère la page (spec § 4).
import { parseArgs } from 'node:util';
import { stat, writeFile, mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { collect, loadSessions, exportHistory, importHistory } from '../src/store/store.js';
import { buildReport } from '../src/report/build.js';
import { recommend } from '../src/model/recommend.js';
import { ANALYZER_VERSION } from '../src/read/session.js';
import { T, recommendationText } from '../src/report/strings.js';

const USAGE = 'usage : tokenfrugal <collect|report|history> [--projects <dossier>] [--store <dossier>] [--no-collect] [--open] [--export <fichier> | --import <fichier>]';
const HISTORY_ERRORS = {
  'history-json': 'Fichier d’historique illisible', 'history-kind': 'Ce fichier n’est pas un historique tokenfrugal',
  'history-schema': 'Historique d’une version incompatible', 'history-shape': 'Historique incomplet ou abîmé',
};

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
        export: { type: 'string' },
        import: { type: 'string' },
      },
    }));
  } catch { console.error(USAGE); return 2; }
  const cmd = positionals[0];
  if (cmd === 'history') return history(values);
  if (cmd !== 'collect' && cmd !== 'report') { console.error(USAGE); return 2; }

  if (cmd === 'collect' || !values['no-collect']) {
    let isDir = false;
    try { isDir = (await stat(values.projects)).isDirectory(); } catch { /* absent */ }
    if (!isDir) { console.error(T.cli.noProjects(values.projects)); return 1; }
    const r = await collect({
      projectsDir: values.projects, storeDir: values.store,
      onProgress: ({ done, total }) => { if (done % 50 === 0 || done === total) process.stderr.write(`\r${done}/${total}`); },
    });
    process.stderr.write('\n');
    console.log(T.cli.collected(r));
  }

  if (cmd === 'report') {
    const sessions = await loadSessions(values.store);
    await mkdir(values.store, { recursive: true });
    const file = path.join(values.store, 'report.html');
    await writeFile(file, buildReport({ analyzer: ANALYZER_VERSION, generated: Math.floor(Date.now() / 1000), sessions }));
    const recos = recommend(sessions).slice(0, 3);
    console.log(T.cli.recommendations);
    if (!recos.length) console.log(`  ${T.cli.noRecommendation}`);
    for (const [i, r] of recos.entries()) console.log(`  ${i + 1}. ${recommendationText(r, 'usd')}`);
    console.log(T.cli.reportWritten(file));
    if (values.open) openFile(file);
  }
  return 0;
}

// Exactement une des deux options : --export écrit le fichier, --import l'ajoute au stockage.
async function history(values) {
  if (!values.export === !values.import) { console.error(USAGE); return 2; }
  if (values.export) {
    const h = await exportHistory(values.store);
    await writeFile(values.export, JSON.stringify(h));
    const n = Object.values(h.months).reduce((a, m) => a + Object.keys(m.sessions).length, 0);
    console.log(`Historique exporté (${n} sessions) : ${values.export}`);
    return 0;
  }
  let obj;
  try { obj = JSON.parse(await readFile(values.import, 'utf8')); }
  catch { console.error(`${HISTORY_ERRORS['history-json']}.`); return 1; }
  try {
    const { added } = await importHistory(values.store, obj);
    console.log(`${added} session${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} depuis l’historique.`);
    return 0;
  } catch (e) {
    if (HISTORY_ERRORS[e.message]) { console.error(`${HISTORY_ERRORS[e.message]}.`); return 1; }
    throw e;
  }
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
