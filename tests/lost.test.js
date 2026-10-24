import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lostCosts } from '../src/model/lost.js';
import { weekly, mergeWeeks } from '../src/model/metrics.js';
import { session, near } from './helpers/model.js';

const T = 1_792_000_000;
// Tokens pondérés (opus-4-6) : entrée 1, sortie 5, cache lu 0,1, écrit 5 min 1,25.
// t0 : 10 + 500 + 25 000 = 25 510 ; t1 : 10 + 1 000 + 2 000 = 3 010 ; t2 : 10 + 250 + 2 000 + 1 250 = 3 510 ;
// t3 : 10 + 2 000 + 2 100 = 4 110 ; t4 : 10 + 500 + 2 100 = 2 610.
const BASE = [
  { t: T, in: 10, out: 100, cw: 20_000 }, { t: T + 60, in: 10, out: 200, cr: 20_000 },
  { t: T + 120, in: 10, out: 50, cr: 20_000, cw: 1_000 }, { t: T + 180, in: 10, out: 400, cr: 21_000 },
  { t: T + 240, in: 10, out: 100, cr: 21_000 },
];
const withLost = (s, at, cause, series) => ({ ...s, lost: { at, cause, series } });

test('coût complet de chaque tour perdu, par cause, la plus chère d’abord', () => {
  const r = lostCosts([withLost(session(BASE), [1, 2, 4], ['exit', 'not-read', 'exit'], [0, 0, 1])]);
  assert.deepEqual(r.causes.map((x) => [x.cause, x.n]), [['exit', 2], ['not-read', 1]]);
  assert.ok(near(r.causes[0].cost.wtok, 3_010 + 2_610));
  assert.ok(near(r.causes[1].cost.wtok, 3_510));
  assert.equal(r.total.n, 3);
  assert.ok(near(r.total.cost.wtok, 3_010 + 3_510 + 2_610));
  assert.deepEqual([r.series.n, r.series.turns], [0, 0]);   // séries de 2 et de 1 : pas des boucles
});

test('séries : 3 tours ou plus forment une boucle ; à cheval sur la période, longueur comptée sur toute la série', () => {
  const s = withLost(session(BASE), [1, 2, 3], ['exit', 'exit', 'exit'], [0, 0, 0]);
  const all = lostCosts([s]);
  assert.deepEqual([all.series.n, all.series.turns], [1, 3]);
  assert.ok(near(all.series.cost.wtok, 3_010 + 3_510 + 4_110));
  const part = lostCosts([s], { from: T + 150, to: T + 300 });
  assert.deepEqual([part.total.n, part.series.n, part.series.turns], [1, 1, 1]);
  assert.ok(near(part.series.cost.wtok, 4_110));
});

test('tour sans prix connu : compté en nombre, coût nul (sinon le nombre de tours perdus serait faux)', () => {
  const r = lostCosts([withLost(session(BASE, { model: 'modele-sans-prix' }), [1], ['exit'], [0])]);
  assert.deepEqual([r.total.n, r.total.cost.usd, r.total.cost.wtok], [1, 0, 0]);
});

test('session sans lost (lue avant la version 8, ou sans échec) : rien, sans erreur', () => {
  const r = lostCosts([session(BASE)]);
  assert.deepEqual([r.causes.length, r.total.n, r.series.n], [0, 0, 0]);
});

test('sous-agents compris ; total jamais au-dessus du coût total de la période', () => {
  const turns = BASE.map((x, i) => (i === 2 ? { ...x, sub: 1 } : x));
  const s = withLost(session(turns), [0, 1, 2, 3, 4], ['exit', 'exit', 'exit', 'exit', 'other'], [0, 0, 1, 2, 2]);
  const r = lostCosts([s]);
  assert.equal(r.total.n, 5);
  assert.ok(r.total.cost.wtok <= mergeWeeks(weekly([s])).cost.wtok + 1e-6);
});
