import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BUNDLE_FILES, bundle, buildReport } from '../src/report/build.js';

test('chaque import du bundle vise un fichier placé avant lui (contrat de concaténation)', () => {
  const abs = BUNDLE_FILES.map((f) => path.resolve('src/report', f));
  abs.forEach((file, i) => {
    for (const l of readFileSync(file, 'utf8').split('\n').filter((x) => /^\s*import\b/.test(x))) {
      const m = /^import \{[^}]+\} from '(\.\.?\/[^']+)';$/.exec(l);
      assert.ok(m, `${path.basename(file)} : import hors contrat : ${l}`);
      const j = abs.indexOf(path.resolve(path.dirname(file), m[1]));
      assert.ok(j >= 0 && j < i, `${path.basename(file)} importe ${m[1]}, absent du bundle ou placé après`);
    }
  });
});

test('le bundle se compile comme un seul module (aucun nom en double)', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'tf-bundle-')), 'bundle.mjs');
  writeFileSync(file, bundle());
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
});

test('les données embarquées ne peuvent pas fermer la balise script', () => {
  const data = { analyzer: 1, sessions: [{ models: ['</script><b>x'] }] };
  const html = buildReport(data);
  assert.ok(!html.includes('</script><b>'));
  const json = /<script type="application\/json" id="tf-data">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.deepEqual(JSON.parse(json), data);
});

test('aucune ressource externe chargée par la page', () => {
  const html = buildReport({ analyzer: 1, sessions: [] });
  assert.ok(!/<(script|link|img)[^>]+(src|href)=["']?https?:/i.test(html));
});
