import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PAGE_FILES, WORKER_FILES, bundle, buildReport, buildWeb } from '../src/report/build.js';

for (const [name, files] of [['page', PAGE_FILES], ['worker', WORKER_FILES]]) {
  test(`bundle ${name} : chaque import vise un fichier placé avant lui (contrat de concaténation)`, () => {
    const abs = files.map((f) => path.resolve('src/report', f));
    abs.forEach((file, i) => {
      for (const l of readFileSync(file, 'utf8').split('\n').filter((x) => /^\s*import\b/.test(x))) {
        const m = /^import \{[^}]+\} from '(\.\.?\/[^']+)';$/.exec(l);
        assert.ok(m, `${path.basename(file)} : import hors contrat : ${l}`);
        const j = abs.indexOf(path.resolve(path.dirname(file), m[1]));
        assert.ok(j >= 0 && j < i, `${path.basename(file)} importe ${m[1]}, absent du bundle ou placé après`);
      }
    });
  });

  test(`bundle ${name} : se compile comme un seul module, sans export restant ni nom en double`, () => {
    const code = bundle(files);
    assert.ok(!/^export /m.test(code));
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tf-bundle-')), 'bundle.mjs');
    writeFileSync(file, code);
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  });
}

test('page web : CSP, code du worker non exécuté, aucune donnée embarquée', () => {
  const html = buildWeb();
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]*connect-src 'none'/);
  assert.match(html, /<script type="text\/plain" id="tf-worker">/);
  assert.ok(!html.includes('id="tf-data"'));
  assert.ok(html.includes('id="landing"'));
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

test('CSP : chaque script exécutable embarqué est autorisé par son empreinte, aucune connexion réseau', () => {
  const html = buildReport({ analyzer: 1, sessions: [] });
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  for (const d of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", 'worker-src blob:']) assert.ok(policy.includes(d), d);
  const scripts = [...html.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  for (const s of scripts) assert.ok(policy.includes(`'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`));
});

test('<html lang> suit la langue des données, français par défaut', () => {
  assert.match(buildReport({ analyzer: 1, sessions: [] }), /^<!doctype html>\n<html lang="fr">/);
  assert.match(buildReport({ analyzer: 1, sessions: [], lang: 'en' }), /^<!doctype html>\n<html lang="en">/);
});
