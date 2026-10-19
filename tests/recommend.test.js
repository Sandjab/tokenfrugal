import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../src/model/recommend.js';
import { recommendationText, fmtTok, fmtCost } from '../src/report/strings.js';
import { session, near } from './helpers/model.js';

const T = 1_792_000_000;
// Contexte sous 150 k (le seuil par défaut ne joue pas), pause d'1 h avant le dernier tour.
const S = session([
  { t: T, in: 10, cw: 120_000 },
  { t: T + 60, in: 10, cr: 120_000, cw: 29_000 },
  { t: T + 3660, in: 10, cw: 149_000 },
]);

test('leviers classés par gain sur les 4 dernières semaines ; un levier sans gain est omis', () => {
  const r = recommend([S]);
  assert.deepEqual(r.map((x) => x.lever), ['socle', 'pause']);
  // socle −10 k : 12 500 + 1 000 + 12 500 ; pause : 186 260 − 87 497,5 − 89 901 (R, S de repli, P = 20 000)
  assert.ok(near(r[0].perWeek.wtok, 26_000 / 4));
  assert.ok(near(r[1].perWeek.wtok, 8_861.5 / 4));
});

test('aucune session : aucune recommandation', () => {
  assert.deepEqual(recommend([]), []);
});

test('phrase d’action : texte fixe, chiffres calculés', () => {
  const r = { lever: 'pause', params: { pauseSwitchMin: 15 }, perWeek: { usd: 12.5, wtok: 3_000 } };
  assert.equal(recommendationText(r, 'usd'), 'Basculer avant les pauses de plus de 15 min : −12,50 $ par semaine');
  assert.equal(recommendationText(r, 'wtok'), 'Basculer avant les pauses de plus de 15 min : −3 k tokens pondérés par semaine');
});

test('formats : k, M, infini, $', () => {
  assert.equal(fmtTok(150_000), '150 k');
  assert.equal(fmtTok(1_250_000), '1,3 M');
  assert.equal(fmtTok(Infinity), '∞');
  assert.equal(fmtCost({ usd: 12.5, wtok: 0 }, 'usd'), '12,50 $');
});
