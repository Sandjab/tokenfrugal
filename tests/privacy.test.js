// tests/privacy.test.js — ni texte de conversation ni chemin dans le stockage et la page (spec § 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { T0, writeProjects, tmpStore, assistant, user, toolResult, compact } from './helpers/logs.js';

test('aucune chaîne-témoin, ni dossier personnel, ni chemin des journaux dans le stockage et la page', () => {
  const projects = writeProjects({
    'Sentinelle-Projet-Slug': {
      'sentinelle-session-id': {
        main: [
          user({ t: T0, text: 'SENTINELLE-TEXTE-HUMAIN', cwd: '/home/sentinelle-cwd/projet' }),
          assistant({ t: T0 + 5, input: 10, cw: 20_000, text: 'SENTINELLE-TEXTE-MODELE' }),
          toolResult({ t: T0 + 6, content: 'SENTINELLE-SORTIE-OUTIL' }),
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
});
