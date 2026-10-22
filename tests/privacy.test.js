// tests/privacy.test.js — ni texte de conversation ni chemin dans le stockage et la page (spec § 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { T0, writeProjects, tmpStore, assistant, user, toolResult, compact, assistantTool, toolResults } from './helpers/logs.js';
import { png } from './helpers/images.js';

test('aucune chaîne-témoin, ni dossier personnel, ni chemin des journaux dans le stockage et la page', () => {
  const projects = writeProjects({
    'Sentinelle-Projet-Slug': {
      'sentinelle-session-id': {
        main: [
          user({ t: T0, text: 'SENTINELLE-TEXTE-HUMAIN', cwd: '/home/sentinelle-cwd/Projet-Permis' }),
          assistant({ t: T0 + 5, input: 10, cw: 20_000, text: 'SENTINELLE-TEXTE-MODELE' }),
          toolResult({ t: T0 + 6, content: 'SENTINELLE-SORTIE-OUTIL' }),
          assistantTool({ t: T0 + 8, id: 'msg_lu', input: 10, cr: 20_000, uses: [['lu1', 'Read', { file_path: '/home/sentinelle-fichier/lu.png' }]] }),
          toolResults({ t: T0 + 9, results: [['lu1', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: `${png(10, 10)}SENTINELLEAA` } }]]] }),
          assistantTool({ t: T0 + 9, id: 'msg_ho', input: 10, cr: 20_000, uses: [['ho1', 'Skill', { skill: 'SENTINELLE-handoff' }], ['ho2', 'Write', { file_path: '/home/sentinelle-ho/handoff-SENTINELLE.md', content: 'x' }]] }),
          assistant({ t: T0 + 10, input: 10, cr: 20_000, cw: 500, model: 'sentinelle modèle avec espaces' }),
          JSON.stringify({ type: 'sentinelle-type avec espaces' }),
          compact({ t: T0 + 20, pre: 20_510, post: 3_000 }),
        ],
        subs: { 'agent-sentinelle-agent.jsonl': [assistant({ t: T0 + 7, input: 5, cw: 12_000, text: 'SENTINELLE-SOUS-AGENT' })] },
      },
    },
  });
  const store = tmpStore();
  execFileSync(process.execPath, ['bin/tokenfrugal.mjs', 'report', '--projects', projects, '--store', store], { stdio: 'pipe' });
  execFileSync(process.execPath, ['bin/tokenfrugal.mjs', 'history', '--export', path.join(store, 'history-export.json'), '--store', store], { stdio: 'pipe' });
  const files = readdirSync(store);
  assert.ok(files.includes('report.html') && files.some((f) => f.startsWith('turns-')));
  for (const f of files) {
    const body = readFileSync(path.join(store, f), 'utf8');
    assert.ok(!/sentinelle/i.test(body), `${f} contient une chaîne-témoin`);
    assert.ok(!body.includes(homedir()), `${f} contient le dossier personnel`);
    assert.ok(!body.includes(projects), `${f} contient le chemin des journaux`);
  }
  // Le nom du dossier du projet est la seule partie du chemin permise (spec projets § 6) : il doit
  // figurer là où on l'attend, sinon l'absence des chaînes-témoins ne prouverait rien.
  for (const f of ['report.html', 'history-export.json', files.find((x) => x.startsWith('turns-'))]) {
    assert.ok(readFileSync(path.join(store, f), 'utf8').includes('Projet-Permis'), `${f} ne contient pas le nom du projet`);
  }
  // Les sorties sont bien relevées (le nom d'outil est stocké) : sans cela, l'absence du chemin et du base64 ne prouverait rien.
  const turns = readFileSync(path.join(store, files.find((x) => x.startsWith('turns-'))), 'utf8');
  assert.ok(turns.includes('"Read"'), 'la sortie Read n’a pas été relevée');
  // Le début du handoff est bien relevé : sans cela, l'absence du nom de skill et du nom de fichier ne prouverait rien.
  assert.ok(turns.includes('"handoff"'), 'le handoff n’a pas été relevé');
});
