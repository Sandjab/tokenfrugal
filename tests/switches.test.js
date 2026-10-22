import { test } from 'node:test';
import assert from 'node:assert/strict';
import { switchList, switchSummary, switchAnswer } from '../src/model/switches.js';
import { session, near } from './helpers/model.js';
import { switchAnswerText, fmtCost } from '../src/report/strings.js';

// Tokens pondérés (opus-4-6) : entrée 1, cache lu 0,1, écrit 5 min 1,25, sortie 5.
const T = 1_792_000_000;
const v5 = (s, extra = {}) => ({ ...s, analyzer: 5, project: { id: 'p' }, ...extra });
// Session A : 3 tours ; contexte du dernier 45 010. Tours 1 et 2 : 11 510 + 17 960 = 29 470.
const A_TURNS = [{ t: T, in: 10, cw: 40_000 }, { t: T + 60, in: 10, cr: 40_000, cw: 2_000, out: 1_000 }, { t: T + 120, in: 10, cr: 42_000, cw: 3_000, out: 2_000 }];
// Reprise de n tours à partir de t0 : contexte 20 010 puis +1 000 par tour.
const growing = (t0, n) => Array.from({ length: n }, (_, i) => (i === 0 ? { t: t0, in: 10, cw: 20_000 } : { t: t0 + 60 * i, in: 10, cr: 20_000 + 1_000 * (i - 1), cw: 1_000 }));
const clearB = (t0, n = 12, extra = {}) => v5(session(growing(t0, n), { clearStart: true }), extra);

test('handoff puis /clear : coût mesuré de la session précédente depuis le début du handoff, reprise et 10 tours', () => {
  const [x] = switchList([v5(session(A_TURNS), { handoff: { at: 1 } }), clearB(T + 180)]);
  assert.equal(x.mode, 'handoff');
  assert.equal(x.t, T + 180);
  assert.ok(near(x.cost.wtok, 29_470));
  assert.equal(x.before, 45_010);
  assert.equal(x.reprise, 20_010);
  // 10 tours : 25 010 + Σ(3 260 + 100 k, k = 0..8) = 57 950 ; contexte du 10e : 29 010
  assert.deepEqual([x.win.n, x.win.reread, x.win.ctxMedian], [10, 9_000, 24_510]);
  assert.ok(near(x.win.cost.wtok, 57_950));
});

test('liaison : 11 h 59 oui, 12 h 01 non, autre projet non, projet inconnu non (sinon un handoff d’ailleurs serait attribué)', () => {
  const A = v5(session(A_TURNS), { handoff: { at: 1 } });
  const mode = (b, a = A) => switchList([a, b]).find((x) => x.t === b.t[0]).mode;
  assert.equal(mode(clearB(T + 120 + 719 * 60)), 'handoff');
  assert.equal(mode(clearB(T + 120 + 721 * 60)), 'clear');
  assert.equal(mode(clearB(T + 180, 12, { project: { id: 'autre' } })), 'clear');
  assert.equal(mode(clearB(T + 180, 12, { project: {} }), { ...A, project: {} }), 'clear');
});

test('liaison : la session précédente la plus proche ; une même session ne précède qu’un /clear (handoff compté une fois)', () => {
  const A1 = v5(session(A_TURNS), { handoff: { at: 1 } });
  const A2 = v5(session([{ t: T + 600, in: 10, cw: 30_000 }]));
  assert.equal(switchList([A1, A2, clearB(T + 700)]).find((x) => x.t === T + 700).mode, 'clear');   // A2 est la plus proche
  const modes = switchList([A1, clearB(T + 300), clearB(T + 400)]).map((x) => [x.t, x.mode]);
  assert.deepEqual(modes, [[T + 300, 'handoff'], [T + 400, 'clear']]);
});

test('une session /clear d’un seul tour ne se prend pas pour sa propre précédente', () => {
  const [x] = switchList([clearB(T, 1, { handoff: { at: 0 } })]);
  assert.deepEqual([x.mode, x.before, x.win.n, x.win.reread], ['clear', null, 1, null]);
});

test('session précédente lue avant la version 5 : handoff inconnu, pas « sans handoff »', () => {
  const [x] = switchList([{ ...v5(session(A_TURNS)), analyzer: 4 }, clearB(T + 180)]);
  assert.equal(x.mode, 'unknown');
  assert.equal(x.cost.wtok, 0);
});

test('compactage : coût estimé du résumé, reprise au tour suivant ; la fenêtre s’arrête au compactage suivant', () => {
  const turns = [{ t: T, in: 10, cw: 40_000 }, { t: T + 60, in: 10, cr: 40_000, cw: 30_000 },
    { t: T + 120, in: 10, cw: 9_000 }, { t: T + 180, in: 10, cr: 9_000, cw: 1_000 },
    { t: T + 240, in: 10, cw: 8_000 }];
  const events = [{ t: T + 90, kind: 'compact', trigger: 'auto', pre: 70_010, post: 9_000 },
    { t: T + 200, kind: 'compact', trigger: 'manual', pre: 10_010, post: 8_000 }];
  const [a, m] = switchList([v5(session(turns, { events }))]);
  assert.deepEqual([a.mode, a.before, a.reprise, a.win.n, a.win.reread], ['auto', 70_010, 9_010, 2, null]);
  assert.ok(near(a.cost.wtok, 7_001 + 45_000));   // 70 010 relus à 0,1 + 9 000 écrits à 5
  assert.deepEqual([m.mode, m.t, m.reprise, m.win.n], ['manual', T + 240, 8_010, 1]);
});

test('compactage après le dernier tour : pas de bascule (aucune reprise à mesurer)', () => {
  const s = v5(session([{ t: T, in: 10, cw: 40_000 }], { events: [{ t: T + 60, kind: 'compact', trigger: 'auto', pre: 40_010, post: 5_000 }] }));
  assert.equal(switchList([s]).length, 0);
});

// Bascule fabriquée pour l'agrégat : coût de bascule c, fenêtre de n tours au coût w, relecture r.
const sw = (mode, t, c, n, w, r = n === 10 ? 1_000 : null, before = 100_000) =>
  ({ mode, t, cost: { usd: c / 1e6, wtok: c }, before, reprise: 20_000, win: { n, cost: { usd: w / 1e6, wtok: w }, ctxMedian: 25_000, reread: r } });

test('agrégat : moyennes de coût, médianes de taille, fenêtres incomplètes hors des chiffres à 10 tours ; modes dans l’ordre', () => {
  const list = [sw('handoff', T, 1_000, 10, 50_000, 2_000), sw('handoff', T + 1, 3_000, 4, 20_000), sw('auto', T + 2, 9_000, 10, 70_000)];
  const r = switchSummary(list);
  assert.deepEqual(r.map((x) => x.mode), ['auto', 'handoff']);
  const h = r[1];
  assert.deepEqual([h.n, h.n10, h.cost.wtok, h.win10.wtok, h.rereadMedian, h.repriseMedian, h.beforeMedian], [2, 1, 2_000, 50_000, 2_000, 20_000, 100_000]);
});

test('agrégat : période sur l’heure de la reprise ; sans fenêtre complète, chiffres à 10 tours absents', () => {
  const r = switchSummary([sw('clear', T, 0, 3, 9_000), sw('clear', T + 500, 0, 10, 9_000)], { from: T, to: T + 100 });
  assert.deepEqual([r[0].n, r[0].n10, r[0].win10, r[0].rereadMedian], [1, 0, null, null]);
});

test('réponse : au moins 5 fenêtres complètes de chaque côté ; compactages auto et manuels réunis ; écart signé', () => {
  const hs = Array.from({ length: 5 }, (_, i) => sw('handoff', T + i, 2_000, 10, 40_000));
  const cs = [...Array.from({ length: 3 }, (_, i) => sw('auto', T + 10 + i, 10_000, 10, 60_000, 1_000, 160_000)),
    ...Array.from({ length: 2 }, (_, i) => sw('manual', T + 20 + i, 10_000, 10, 60_000, 1_000, 160_000))];
  assert.equal(switchAnswer([...hs.slice(1), ...cs]), null);
  const a = switchAnswer([...hs, ...cs]);
  assert.deepEqual([a.handoff.total.wtok, a.compact.total.wtok, a.diff.wtok], [42_000, 70_000, -28_000]);
  assert.deepEqual([a.handoff.beforeMedian, a.compact.beforeMedian], [100_000, 160_000]);
});

test('phrase : le mode le moins cher, les deux coûts, l’écart, et les contextes avant ; sinon « pas assez »', () => {
  const a = { handoff: { total: { usd: 1, wtok: 1 }, beforeMedian: 100_000 }, compact: { total: { usd: 3, wtok: 3 }, beforeMedian: 160_000 }, diff: { usd: -2, wtok: -2 } };
  const s = switchAnswerText(a, 'usd');
  assert.match(s, /^Sur vos bascules, un handoff puis \/clear coûte le moins/);
  assert.ok(s.includes(fmtCost({ usd: 2, wtok: 2 }, 'usd')));
  assert.match(switchAnswerText(null, 'usd'), /^Pas assez de bascules pour comparer : il faut au moins 5 /);
});

test('liaison sur l’heure du /clear, pas sur le premier tour : /clear tapé juste après le handoff, première consigne 13 h plus tard', () => {
  const A = v5(session(A_TURNS), { handoff: { at: 1 } });
  const [x] = switchList([A, clearB(T + 120 + 13 * 3600, 12, { clearAt: T + 180 })]);
  assert.deepEqual([x.mode, x.t], ['handoff', T + 120 + 13 * 3600]);   // la période suit la reprise
});
