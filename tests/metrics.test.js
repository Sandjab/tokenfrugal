import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekly, mergeWeeks } from '../src/model/metrics.js';
import { session, near } from './helpers/model.js';

const local = (...a) => new Date(...a).getTime() / 1000;
const T0 = local(2026, 9, 19, 10);   // lundi, semaine 2026-W43

// Valeurs en tokens pondérés (opus-4-6) : entrée 1, cache lu 0,1, écrit 1,25, sortie 5.
const S1 = session([
  { t: T0, in: 10, cw: 40_000 },                        // 50 010
  { t: T0 + 30, in: 100, out: 10, sub: 1 },             // sous-agent : 150
  { t: T0 + 60, in: 10, cr: 40_000, cw: 120_000 },      // 154 010, contexte 160 010
  { t: T0 + 660, in: 10, cw: 170_000 },                 // pause 10 min, reconstruction : 212 510
  { t: T0 + 800, in: 10, cw: 25_000 },                  // après compactage : 31 260
], { events: [{ t: T0 + 700, kind: 'compact', trigger: 'auto', pre: 170_000, post: 9_000 }] });
const S2 = session([{ t: local(2026, 9, 26, 10), in: 10, cw: 30_000 }], { clearStart: true });

test('coût, tours et contexte d’une semaine ; sous-agents dans le total et à part', () => {
  const [w] = weekly([S1]);
  assert.equal(w.week, '2026-W43');
  assert.ok(near(w.cost.wtok, 447_940));
  assert.ok(near(w.subCost.wtok, 150));
  assert.equal(w.turns, 4);
  assert.deepEqual(w.ctxBuckets, [2, 0, 0, 2, 0]);
  assert.ok(near(w.costOver150k.wtok, 154_010 + 212_510));
  assert.equal(w.maxCtx, 170_010);
});

test('reconstruction après 10 min : bon intervalle, surcoût = écriture payée au lieu d’une lecture', () => {
  const [w] = weekly([S1]);
  assert.deepEqual(w.rebuilds, { '5-15': 1, '15-60': 0, '>60': 0 });
  assert.ok(near(w.rebuildExcess.wtok, 170_000 * (1.25 - 0.1)));
});

test('compactage, premier tour après, socle des sessions neuves, sessions /clear à part', () => {
  const [w43, w44] = weekly([S1, S2]);
  assert.deepEqual(w43.compactions, { auto: 1, manual: 0, other: 0 });
  assert.deepEqual([w43.compactPre, w43.compactPost, w43.afterCompactCtx], [[170_000], [9_000], [25_010]]);
  assert.deepEqual(w43.socleFirstCtx, [40_010]);
  assert.equal(w44.week, '2026-W44');
  assert.equal(w44.clearSessions, 1);
  assert.deepEqual(w44.clearFirstCtx, [30_010]);
  assert.deepEqual(w44.socleFirstCtx, []);   // une reprise /clear ne mesure pas le socle
});

test('cache 1 h écrit puis jamais relu dans l’heure : compté et chiffré', () => {
  const unread = session([{ t: T0, cw: 10_000, cw1h: 10_000 }, { t: T0 + 4000, cw: 12_000 }]);
  const read = session([{ t: T0, cw: 10_000, cw1h: 10_000 }, { t: T0 + 1800, cr: 10_000, cw: 500 }]);
  const [w] = weekly([unread]);
  assert.equal(w.cache1hNeverRead, 10_000);
  assert.ok(near(w.cache1hNeverReadCost.wtok, 20_000));
  assert.equal(weekly([read])[0].cache1hNeverRead, 0);
});

test('modèle sans prix : compté à part, sans coût', () => {
  const [w] = weekly([session([{ t: T0, in: 10, cw: 1000 }], { model: 'gpt-x' })]);
  assert.equal(w.unpriced, 1);
  assert.equal(w.turns, 0);
  assert.equal(w.cost.usd, 0);
});

test('fusion de semaines : compteurs additionnés, listes mises bout à bout', () => {
  const m = mergeWeeks(weekly([S1, S2]));
  assert.equal(m.turns, 5);
  assert.deepEqual(m.ctxBuckets, [3, 0, 0, 2, 0]);
  assert.deepEqual(m.clearFirstCtx, [30_010]);
  assert.ok(near(m.cost.wtok, 447_940 + 37_510));
});

test('aucune session : aucune semaine, fusion vide', () => {
  assert.deepEqual(weekly([]), []);
  assert.equal(mergeWeeks([]).turns, 0);
});
