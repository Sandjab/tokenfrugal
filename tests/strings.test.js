import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, T, setLang, getLang, pickLang, fmtTok, fmtCost, fmtPct, fmtAxis, recommendationText } from '../src/report/strings.js';

// Même forme dans les deux langues : mêmes clés, même nombre de paramètres, même longueur de liste.
function shape(x) {
  if (typeof x === 'function') return `fn/${x.length}`;
  if (Array.isArray(x)) return `array/${x.length}`;
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, shape(x[k])]));
  return typeof x;
}

test('français et anglais ont exactement les mêmes clés (aucun texte manquant dans une langue)', () => {
  assert.deepEqual(shape(STRINGS.en), shape(STRINGS.fr));
});

test('choix de la langue : choix enregistré, puis langue des données, puis du navigateur, anglais par défaut', () => {
  assert.equal(pickLang('en', 'fr', 'fr-FR'), 'en');
  assert.equal(pickLang(null, 'fr', 'en-US'), 'fr');
  assert.equal(pickLang('xx', null, 'fr-CA'), 'fr');
  assert.equal(pickLang(null, null, 'de-DE'), 'en');
  assert.equal(pickLang(null, null, undefined), 'en');
});

test('formats et phrases suivent la langue', () => {
  const r = { lever: 'pause', params: { pauseSwitchMin: 60 }, perWeek: { usd: 12.5, wtok: 3_000 } };
  setLang('en');
  assert.equal(getLang(), 'en');
  assert.equal(fmtTok(150_000), '150k');
  assert.equal(fmtCost({ usd: 1234.5, wtok: 0 }, 'usd'), '$1,234.50');
  assert.equal(fmtPct(0.12), '+12%');
  assert.equal(recommendationText(r, 'usd'), 'Switch before breaks longer than 60 min: −$12.50 per week');
  assert.equal(T.summary, 'Summary');
  setLang('fr');
  assert.equal(fmtTok(150_000), '150 k');
  assert.equal(recommendationText(r, 'usd'), 'Basculer avant les pauses de plus de 60 min : −12,50 $ par semaine');
  assert.equal(T.summary, 'Résumé');
});

test('axes des graphiques : séparateur de milliers visible (l’espace fine U+202F ne fait que 1,7 px dans le canvas)', () => {
  setLang('fr');
  assert.equal(fmtAxis(42_500, 'usd'), '42 500,00 $');
  assert.equal(fmtAxis(9_000_000_000, 'wtok'), '9 000,0 M');
  setLang('en');
  assert.equal(fmtAxis(42_500, 'usd'), '$42,500.00');
  setLang('fr');
});
