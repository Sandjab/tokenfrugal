import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, median, isRebuild, weekStart, prevWeek } from '../src/model/util.js';
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

test('début de semaine : lundi 00:00 local, y compris en reculant par-dessus un changement d’heure', () => {
  assert.equal(weekStart(local(2026, 9, 21, 15)), local(2026, 9, 19));       // mercredi → lundi 19 oct.
  assert.equal(weekStart(local(2026, 9, 19, 0)), local(2026, 9, 19));        // lundi 00:00 : lui-même
  assert.equal(weekStart(local(2026, 9, 25, 23, 59)), local(2026, 9, 19));   // dimanche soir
  // 1er nov. → 26 oct., puis trois semaines avant : 5 oct. (le passage à l'heure d'hiver du 25 oct. est
  // entre les deux en Europe ; un recul de 3 × 7 × 86 400 s tomberait à 23:00 ou 01:00)
  assert.equal(weekStart(local(2026, 10, 1, 12), 3), local(2026, 9, 5));
  assert.equal(isoWeek(weekStart(local(2026, 10, 1, 12), 3)), '2026-W41');
});

test('semaine précédente : calendaire, passage d’année compris (W01 ↔ W52/W53)', () => {
  assert.equal(prevWeek('2026-W43'), '2026-W42');
  assert.equal(prevWeek('2026-W10'), '2026-W09');
  assert.equal(prevWeek('2027-W01'), '2026-W53');   // 2026 a 53 semaines
  assert.equal(prevWeek('2026-W01'), '2025-W52');   // 2025 en a 52
  assert.equal(prevWeek('2026-W53'), '2026-W52');
});
