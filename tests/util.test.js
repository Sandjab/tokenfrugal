import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, median, isRebuild } from '../src/model/util.js';
import { session } from './helpers/model.js';

const local = (...a) => new Date(...a).getTime() / 1000;   // heure locale : test indépendant du fuseau

test('semaine ISO en heure locale, y compris la 53e semaine et le passage du dimanche au lundi', () => {
  assert.equal(isoWeek(local(2026, 9, 19, 12)), '2026-W43');
  assert.equal(isoWeek(local(2026, 9, 25, 23)), '2026-W43');   // dimanche soir
  assert.equal(isoWeek(local(2026, 9, 26, 0, 30)), '2026-W44'); // lundi, jour du changement d'heure passé
  assert.equal(isoWeek(local(2027, 0, 1, 12)), '2026-W53');
});

test('médiane : impair, pair, vide', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

test('reconstruction : plus de 5 min de pause, ≥ 10 k écrits, moins lus qu’écrits', () => {
  const s = session([{ t: 0 }, { t: 0, cw: 10_000 }, { t: 0, cw: 9_999 }, { t: 0, cr: 10_000, cw: 10_000 }]);
  assert.equal(isRebuild(s, 1, 301), true);
  assert.equal(isRebuild(s, 1, 300), false);   // cache 5 min encore valable
  assert.equal(isRebuild(s, 2, 301), false);   // trop petit pour compter
  assert.equal(isRebuild(s, 3, 301), false);   // le cache a servi
});
