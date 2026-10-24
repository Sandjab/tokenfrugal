import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byProject, projectLabels } from '../src/model/projects.js';
import { weekly, mergeWeeks, weeksIn } from '../src/model/metrics.js';
import { weekStart } from '../src/model/util.js';
import { session, near } from './helpers/model.js';

const T = 1_792_000_000, WEEK = 7 * 86_400;
const inProject = (s, id, name) => ({ ...s, project: name === undefined ? { id } : { id, name } });
const A1 = inProject(session([{ t: T, in: 10, cw: 200_000 }, { t: T + 60, in: 10, cr: 200_000, cw: 1_000 }]), 'aaaa1111', 'alpha');
const A2 = inProject(session([{ t: T + 3600, in: 10, cw: 160_000 }]), 'aaaa1111', 'alpha');
const B = inProject(session([{ t: T + 7200, in: 10, cw: 30_000 }]), 'bbbb2222', 'beta');
const OLD = session([{ t: T + 10_800, in: 10, cw: 20_000 }]);   // lue avant la version 3 : pas de projet

test('la somme des projets égale le total : aucune session perdue ni comptée deux fois', () => {
  const rows = byProject([A1, A2, B, OLD]);
  const total = mergeWeeks(weekly([A1, A2, B, OLD])).cost;
  assert.ok(near(rows.reduce((a, r) => a + r.cost.usd, 0), total.usd));
  assert.ok(near(rows.reduce((a, r) => a + r.cost.wtok, 0), total.wtok));
});

test('une ligne par projet, la plus chère d’abord ; sessions sans projet dans la ligne null', () => {
  const rows = byProject([B, OLD, A1, A2]);
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.sessions]), [['aaaa1111', 'alpha', 2], ['bbbb2222', 'beta', 1], [null, undefined, 1]]);
  assert.equal(rows[0].turns, 3);
  assert.equal(rows[0].socleMedian, (200_010 + 160_010) / 2);   // premier tour de chaque session
});

test('fenêtre : un projet sans tour dans la période n’a pas de ligne ; seules les semaines de la période comptent', () => {
  const late = inProject(session([{ t: T + 5 * WEEK, in: 10, cw: 50_000 }]), 'cccc3333', 'gamma');
  const range = { from: weekStart(T + 5 * WEEK), to: T + 5 * WEEK + 1 };
  const rows = byProject([A1, A2, B, late], range);
  assert.deepEqual(rows.map((r) => r.id), ['cccc3333']);
  assert.ok(near(rows[0].cost.usd, mergeWeeks(weeksIn(weekly([late]), range)).cost.usd));
});

test('libellés : nom, sinon id court ; un nom porté par deux dossiers (deux clones) est suivi de l’id court', () => {
  const rows = [{ id: 'aaaa1111', name: 'app' }, { id: 'bbbb2222', name: 'app' }, { id: 'cccc3333' }, { id: 'dddd4444', name: 'solo' }, { id: null }];
  assert.deepEqual([...projectLabels(rows)], [['aaaa1111', 'app (#aaaa)'], ['bbbb2222', 'app (#bbbb)'], ['cccc3333', '#cccc'], ['dddd4444', 'solo']]);
});

test('weeksIn : sans début, toutes les semaines ; avec, celles à partir de la semaine du début', () => {
  const ws = weekly([A1, inProject(session([{ t: T + 3 * WEEK, in: 10, cw: 1_000 }]), 'x', 'x')]);
  assert.equal(weeksIn(ws).length, 2);
  assert.equal(weeksIn(ws, { from: weekStart(T + 3 * WEEK) }).length, 1);
});

test('nom d’un projet : celui de sa session nommée la plus récente (une session purgée garde le nom d’une version antérieure)', () => {
  const old = inProject(session([{ t: T, in: 10, cw: 1_000 }]), 'hhhh0000', 'jdupont');
  const recent = inProject(session([{ t: T + 3600, in: 10, cw: 1_000 }]), 'hhhh0000', '~');
  const unnamed = inProject(session([{ t: T + 7200, in: 10, cw: 1_000 }]), 'hhhh0000');
  assert.equal(byProject([old, recent, unnamed])[0].name, '~');
  assert.equal(byProject([unnamed, recent, old])[0].name, '~');
});
