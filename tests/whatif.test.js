import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatIf, measuredDefaults, NEUTRAL, FALLBACK } from '../src/model/whatif.js';
import { session, near } from './helpers/model.js';

// Valeurs en tokens pondérés (opus-4-6) : entrée 1, cache lu 0,1, écrit 5 min 1,25, écrit 1 h 2, sortie 5.
const T = 1_792_000_000;
const A = session([
  { t: T, in: 10, cw: 40_000 },                  // réel 50 010
  { t: T + 60, in: 10, cr: 40_000, cw: 30_000 }, // réel 41 510
  { t: T + 120, in: 10, cr: 70_000, cw: 10_000 },// réel 19 510
]);

function lcg(seed) { let x = seed; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; }
function randomSessions(n, seed) {
  const rnd = lcg(seed), out = [];
  for (let k = 0; k < n; k++) {
    const s = { analyzer: 1, start: 0, clearStart: false, models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'gpt-x'], events: [], ignored: {}, t: [], m: [], in: [], out: [], cr: [], cw: [], cw1h: [], sub: [] };
    let t = T + k * 86_400, ctx = 20_000;
    for (let i = 0; i < 60; i++) {
      t += rnd() < 0.15 ? Math.floor(rnd() * 7200) : 30 + Math.floor(rnd() * 120);
      const grow = Math.floor(rnd() * 15_000), rebuild = rnd() < 0.2;
      const cw = rebuild ? ctx + grow : grow, cr = rebuild ? 0 : ctx;
      s.t.push(t); s.m.push(rnd() < 0.05 ? 2 : rnd() < 0.3 ? 1 : 0);
      s.in.push(5 + Math.floor(rnd() * 50)); s.out.push(Math.floor(rnd() * 3000));
      s.cr.push(cr); s.cw.push(cw); s.cw1h.push(rnd() < 0.3 ? Math.floor(cw / 2) : 0); s.sub.push(rnd() < 0.2 ? 1 : 0);
      ctx = cr + cw;
      if (rnd() < 0.03) { s.events.push({ t: t + 1, kind: 'compact', trigger: 'auto', pre: ctx, post: 9_000 }); ctx = 20_000; }
    }
    s.start = s.t[0];
    out.push(s);
  }
  return out;
}

test('tous leviers neutres : le simulé égale exactement le réel corrigé (sinon le what-if ment)', () => {
  const r = whatIf(randomSessions(30, 7), NEUTRAL);
  assert.equal(r.sim.usd, r.real.usd);
  assert.equal(r.sim.wtok, r.real.wtok);
  assert.equal(r.switches, 0);
  assert.ok(r.unpriced > 0);   // le modèle gpt-x est compté à part
});

test('compactage réel : le résumé absent des journaux est estimé et ajouté au réel corrigé', () => {
  const s = session([{ t: T, in: 10, cw: 100_000 }, { t: T + 200, in: 10, cw: 20_000 }],
    { events: [{ t: T + 100, kind: 'compact', trigger: 'auto', pre: 100_000, post: 8_000 }] });
  const r = whatIf([s], NEUTRAL);
  assert.ok(near(r.measured.wtok, 125_010 + 25_010));
  // résumé : 100 000 lus en cache (×0,1) + 8 000 de sortie (×5)
  assert.ok(near(r.real.wtok, 150_020 + 10_000 + 40_000));
  assert.ok(near(r.sim.wtok, r.real.wtok));
});

test('socle −X : retiré d’abord du cache lu, puis du cache écrit, à chaque tour', () => {
  const r = whatIf([A], { socleCut: 5_000 });
  assert.ok(near(r.real.wtok, 111_030));
  // t0 : 0 lu → 35 000 écrits (43 760) ; t1 : 35 000 lus (41 010) ; t2 : 65 000 lus (19 010)
  assert.ok(near(r.sim.wtok, 103_780));
});

test('sous-agents : comptés pareil des deux côtés, sans effet sur le gain', () => {
  const withSub = session([...[0, 1, 2].map((i) => ({ t: A.t[i], in: A.in[i], cr: A.cr[i], cw: A.cw[i] })), { t: T + 130, in: 100, cw: 50_000, sub: 1 }]);
  const a = whatIf([A], { socleCut: 5_000 }), b = whatIf([withSub], { socleCut: 5_000 });
  assert.ok(near(b.real.wtok - b.sim.wtok, a.real.wtok - a.sim.wtok));
  assert.ok(b.real.wtok > a.real.wtok);
});

test('intervalle : seuls les coûts datés dedans comptent, la session est rejouée en entier', () => {
  const r = whatIf([A], { socleCut: 5_000 }, { from: T + 60 });
  assert.ok(near(r.real.wtok, 41_510 + 19_510));
  assert.ok(near(r.sim.wtok, 41_010 + 19_010));
});

test('par semaine : la somme des semaines égale le total', () => {
  const r = whatIf(randomSessions(10, 3), { socleCut: 5_000 });
  const sum = r.byWeek.reduce((a, w) => a + w.sim.wtok, 0);
  assert.ok(near(sum, r.sim.wtok));
});

test('R et S mesurés : reprises après compactage et /clear, taille des résumés', () => {
  const clear = session([{ t: T, in: 10, cw: 29_990 }], { clearStart: true });
  const comp = session([{ t: T, cw: 1 }, { t: T + 20, in: 10, cw: 20_990 }, { t: T + 40, in: 10, cw: 24_990 }], {
    events: [{ t: T + 10, kind: 'compact', trigger: 'auto', pre: 1, post: 8_000 }, { t: T + 30, kind: 'compact', trigger: 'auto', pre: 1, post: 12_000 }],
  });
  const d = measuredDefaults([clear, comp]);
  assert.equal(d.R, 25_000);   // médiane de 30 000, 21 000, 25 000
  assert.equal(d.S, 10_000);
  assert.deepEqual(d.measured, { R: 3, S: 2 });
});

test('rien à mesurer : valeurs de repli, signalées par measured = 0', () => {
  assert.deepEqual(measuredDefaults([]), { ...FALLBACK, measured: { R: 0, S: 0 } });
});

test('aucune session : tout à zéro', () => {
  const r = whatIf([], NEUTRAL);
  assert.deepEqual([r.real.usd, r.sim.usd, r.byWeek.length], [0, 0, 0]);
});

test('seuil ≤ R + P : aucune bascule (elle ne ramènerait pas sous le seuil)', () => {
  const r = whatIf([A], { R: 50_000, P: 20_000, S: 1_000, threshold: 60_000 });
  assert.equal(r.switches, 0);
  assert.equal(r.sim.wtok, r.real.wtok);
});

test('compactage après le dernier tour : son résumé est compté', () => {
  const s = session([{ t: T, in: 10, cw: 100_000 }], { events: [{ t: T + 100, kind: 'compact', trigger: 'manual', pre: 100_000, post: 8_000 }] });
  const r = whatIf([s], NEUTRAL);
  assert.ok(near(r.real.wtok, 125_010 + 50_000));
  assert.equal(r.sim.wtok, r.real.wtok);
});

test('compactage avant le premier tour : résumé compté, au modèle du premier tour', () => {
  const s = session([{ t: T, in: 10, cw: 20_000 }], { events: [{ t: T - 10, kind: 'compact', trigger: 'auto', pre: 30_000, post: 2_000 }] });
  assert.ok(near(whatIf([s], NEUTRAL).real.wtok, 25_010 + 3_000 + 10_000));
});

test('tour inconnu entre deux tours : deux pauses de 10 min ne font pas une pause de 20', () => {
  const s = session([{ t: T, in: 10, cw: 40_000 }, { t: T + 600 }, { t: T + 1200, in: 10, cw: 80_000 }]);
  s.models.push('gpt-x'); s.m[1] = 1;
  assert.equal(whatIf([s], { R: 20_000, P: 0, S: 1_000, pauseSwitchMin: 15 }).switches, 0);
});

test('socle appliqué aussi au résumé simulé d’un compactage réel', () => {
  const s = session([{ t: T, in: 10, cw: 100_000 }, { t: T + 200, in: 10, cw: 20_000 }],
    { events: [{ t: T + 100, kind: 'compact', trigger: 'auto', pre: 100_000, post: 8_000 }] });
  const r = whatIf([s], { socleCut: 5_000 });
  assert.ok(near(r.real.wtok - r.sim.wtok, 6_250 + 500 + 6_250));
});

test('paramètre undefined : le défaut s’applique', () => {
  assert.equal(whatIf([A], { R: undefined, P: 0, S: 1_000, threshold: 60_000 }).switches, 1);
});

// Session avec pause de 20 min avant le dernier tour, qui doit alors tout réécrire en cache.
const PAUSE = session([
  { t: T, in: 10, cw: 40_000 },                    // 50 010
  { t: T + 60, in: 10, cr: 40_000, cw: 30_000 },   // 41 510
  { t: T + 1260, in: 10, cw: 80_000 },             // 100 010 (reconstruction)
]);
const HYP = { R: 20_000, P: 0, S: 1_000 };

test('seuil : une bascule coûte un résumé et une réécriture avant de rapporter', () => {
  const r = whatIf([A], { ...HYP, threshold: 60_000 });
  // t1 dépasse 60 000 : résumé (40 010 lus + 1 000 de sortie = 9 001), contexte ramené à 50 000,
  // tout réécrit (62 497,5) ; t2 : 60 000, dont 49 990 lus (17 509)
  assert.equal(r.switches, 1);
  assert.ok(near(r.sim.wtok, 50_010 + 9_001 + 62_497.5 + 17_509));
  assert.ok(r.sim.wtok > r.real.wtok);   // session trop courte pour amortir la bascule
});

// Contexte réel de 30 000 à 820 000 : chaque bascule coûte ≈ 150 000 de plus et rapporte ≈ 72 000 × son rang,
// donc le cumul ne devient favorable qu'après la 3e. À 40 tours simulé − réel = +196 927 (perte) ; à 80, −990 670,5.
test('seuil : sur une longue session qui grossit, la bascule rapporte', () => {
  const turns = [];
  for (let i = 0, ctx = 20_000; i < 80; i++, ctx += 10_000) turns.push({ t: T + i * 60, in: 10, cr: ctx, cw: 10_000 });
  const r = whatIf([session(turns)], { R: 50_000, P: 20_000, S: 15_000, threshold: 150_000 });
  assert.ok(r.switches >= 1);
  assert.ok(r.sim.wtok < r.real.wtok);
});

test('seuil : pas de bascule tant que le contexte n’excède pas R + P (pas de boucle)', () => {
  const r = whatIf([A], { R: 50_000, P: 0, S: 1_000, threshold: 60_000 });
  assert.equal(r.switches, 1);   // t1 : 40 010 ≤ R, pas de bascule ; t2 : 70 010 > R, une seule
});

test('pause : basculer avant une pause de plus de T min évite de tout réécrire', () => {
  const r = whatIf([PAUSE], { ...HYP, pauseSwitchMin: 15 });
  // bascule à la fin de t1 : 70 010 lus + 1 000 de sortie = 12 001 ; t2 ne réécrit que 30 000 (37 497,5)
  assert.equal(r.switches, 1);
  assert.ok(near(r.sim.wtok, 50_010 + 41_510 + 12_001 + 37_497.5));
  assert.ok(near(r.real.wtok - r.sim.wtok, 50_511.5));
});

test('pause plus courte que T : aucune bascule, simulé = réel', () => {
  const r = whatIf([PAUSE], { ...HYP, pauseSwitchMin: 30 });
  assert.equal(r.switches, 0);
  assert.equal(r.sim.wtok, r.real.wtok);
});

test('cache 1 h : écritures plus chères, mais une pause de 20 min ne casse plus le cache', () => {
  const r = whatIf([PAUSE], { cache1h: true });
  // t0 : 40 000 écrits ×2 ; t1 : 40 000 lus + 30 000 écrits ×2 ; t2 : 70 010 relus + 9 990 écrits ×2
  assert.ok(near(r.sim.wtok, 80_010 + 64_010 + 26_991));
  assert.ok(r.sim.wtok < r.real.wtok);
});

test('pause et seuil sur le même tour : une seule bascule, la pause passe d’abord', () => {
  const r = whatIf([PAUSE], { ...HYP, pauseSwitchMin: 15, threshold: 60_000 });
  assert.equal(r.switches, 2);   // seuil sur t1, pause avant t2, jamais deux sur le même tour
});
