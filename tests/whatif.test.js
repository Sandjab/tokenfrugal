import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatIf, measuredDefaults, NEUTRAL, FALLBACK, DEFAULTS, PAUSE_SWITCH_MIN_1H } from '../src/model/whatif.js';
import { session, near, withOutputs } from './helpers/model.js';

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
  assert.deepEqual(d.measured, { R: 3, S: 2, cache1hShare: 0 });
});

test('rien à mesurer : valeurs de repli, signalées par measured = 0', () => {
  assert.deepEqual(measuredDefaults([]), { ...FALLBACK, pauseSwitchMin: DEFAULTS.pauseSwitchMin, measured: { R: 0, S: 0, cache1hShare: 0 } });
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

test('seuil puis pause sur deux tours différents : deux bascules', () => {
  const r = whatIf([PAUSE], { ...HYP, pauseSwitchMin: 15, threshold: 60_000 });
  assert.equal(r.switches, 2);   // seuil avant t1, pause avant t2
});

// Un seul tour où les deux leviers s'appliquent : 20 min de pause avant lui ET contexte au-dessus du
// seuil. La pause passe d'abord et inscrit son résumé à la fin du tour précédent (T) ; le seuil
// l'aurait inscrit au tour lui-même (T + 1 200). Un intervalle qui commence à T + 1 distingue les deux.
test('pause et seuil sur le même tour : une seule bascule, celle de la pause, datée du tour précédent', () => {
  const s = session([{ t: T, in: 10, cw: 40_000 }, { t: T + 1_200, in: 10, cw: 80_000 }]);
  const p = { ...HYP, pauseSwitchMin: 15, threshold: 60_000 };
  assert.equal(whatIf([s], p).switches, 1);
  assert.equal(whatIf([s], p, { from: T + 1 }).switches, 0);
});

// R + P = 55 000 juste sous N = 60 000, contexte qui grossit de 10 000 par tour : après une bascule le
// contexte simulé (65 000) repasse aussitôt au-dessus de N. Sans réarmement, le seuil basculerait à
// chaque tour (et coûterait un résumé et une réécriture à chaque fois) ; il attend que le contexte
// simulé soit revenu sous N.
test('seuil juste au-dessus de R + P : une seule bascule, pas une par tour (réarmement)', () => {
  const turns = [];
  for (let i = 0, ctx = 20_000; i < 20; i++, ctx += 10_000) turns.push({ t: T + i * 60, in: 10, cr: ctx, cw: 10_000 });
  const r = whatIf([session(turns)], { R: 50_000, P: 5_000, S: 1_000, threshold: 60_000 });
  assert.equal(r.switches, 1);
});

test('seuil réarmé par un compactage réel : une nouvelle bascule redevient possible', () => {
  const turns = [];
  for (let i = 0, ctx = 20_000; i < 10; i++, ctx += 10_000) turns.push({ t: T + i * 60, in: 10, cr: ctx, cw: 10_000 });
  for (let i = 0, ctx = 20_000; i < 10; i++, ctx += 10_000) turns.push({ t: T + 1_000 + i * 60, in: 10, cr: ctx, cw: 10_000 });
  const s = session(turns, { events: [{ t: T + 900, kind: 'compact', trigger: 'auto', pre: 120_000, post: 8_000 }] });
  assert.equal(whatIf([s], { R: 50_000, P: 5_000, S: 1_000, threshold: 60_000 }).switches, 2);
});

// Référence indépendante du saut : chaque session est rejouée en entière, donc une semaine entièrement
// dans l'intervalle a le même coût qu'avec un rejeu sans intervalle. Les sessions démarrent le soir et
// passent minuit : certaines chevauchent les bornes (lundis 00:00, changement d'heure compris).
test('intervalle : sauter les sessions hors de l’intervalle ne change aucun chiffre', () => {
  const all = randomSessions(30, 11);   // une session par jour, du 15 oct. au 13 nov. 2026
  const local = (...a) => new Date(...a).getTime() / 1000;
  const range = { from: local(2026, 9, 19), to: local(2026, 10, 2) };   // semaines 43 et 44
  const p = { R: 30_000, P: 5_000, S: 2_000, socleCut: 5_000, threshold: 120_000, pauseSwitchMin: 20 };
  const r = whatIf(all, p, range), full = whatIf(all, p);
  assert.deepEqual(r.byWeek, full.byWeek.filter((w) => w.week === '2026-W43' || w.week === '2026-W44'));
  assert.ok(near(r.sim.wtok, r.byWeek.reduce((a, w) => a + w.sim.wtok, 0)));
  const inside = all.filter((s) => s.t.some((t) => t >= range.from && t < range.to) || s.events.some((e) => e.t >= range.from && e.t < range.to));
  assert.ok(inside.length > 0 && inside.length < all.length);
  assert.deepEqual(r, whatIf(inside, p, range));   // les sessions lointaines n'y changent rien
});

test('intervalle : une session dont seul un compactage tombe dedans est rejouée (son résumé compte)', () => {
  const s = session([{ t: T, in: 10, cw: 100_000 }], { events: [{ t: T + 100, kind: 'compact', trigger: 'manual', pre: 100_000, post: 8_000 }] });
  assert.ok(near(whatIf([s], NEUTRAL, { from: T + 50 }).real.wtok, 10_000 + 40_000));
});

// T du levier pause : une pause de 15 à 60 min ne casse pas un cache 1 h, basculer avant elle ne sert à
// rien. T se déduit donc de la part des écritures en cache 1 h (tours principaux, 4 dernières semaines).
const DAY = 86_400;
const ttl = (...turns) => measuredDefaults([session(turns)]);
test('T mesuré : cache 1 h majoritaire → 60 min, cache 5 min → 15 min', () => {
  const all1h = ttl({ t: T, cw: 40_000, cw1h: 40_000 }, { t: T + 60, cr: 40_000, cw: 10_000, cw1h: 10_000 });
  assert.equal(all1h.measured.cache1hShare, 1);
  assert.equal(all1h.pauseSwitchMin, PAUSE_SWITCH_MIN_1H);
  assert.equal(PAUSE_SWITCH_MIN_1H, 60);
  const all5m = ttl({ t: T, cw: 40_000 }, { t: T + 60, cr: 40_000, cw: 10_000 });
  assert.equal(all5m.measured.cache1hShare, 0);
  assert.equal(all5m.pauseSwitchMin, 15);
});

test('T mesuré : exactement 50 % d’écritures 1 h → 60 min', () => {
  const half = ttl({ t: T, cw: 30_000, cw1h: 30_000 }, { t: T + 60, cr: 30_000, cw: 30_000 });
  assert.equal(half.measured.cache1hShare, 0.5);
  assert.equal(half.pauseSwitchMin, 60);
});

test('T mesuré : tours hors des 4 semaines avant le dernier tour, et sous-agents, ignorés', () => {
  // ancien tour en cache 1 h, 28 jours + 1 s avant le dernier : hors fenêtre ; à 28 jours pile : dedans
  const old = ttl({ t: T - 28 * DAY - 1, cw: 900_000, cw1h: 900_000 }, { t: T, cw: 10_000 });
  assert.equal(old.measured.cache1hShare, 0);
  assert.equal(old.pauseSwitchMin, 15);
  const edge = ttl({ t: T - 28 * DAY, cw: 900_000, cw1h: 900_000 }, { t: T, cw: 10_000 });
  assert.equal(edge.pauseSwitchMin, 60);
  const sub = ttl({ t: T, cw: 10_000 }, { t: T + 30, cw: 900_000, cw1h: 900_000, sub: 1 });
  assert.equal(sub.measured.cache1hShare, 0);
  assert.equal(sub.pauseSwitchMin, 15);
});

test('T mesuré : cw1h plafonné à cw ; aucune écriture → part 0, T = 15', () => {
  assert.equal(ttl({ t: T, cw: 10_000, cw1h: 30_000 }, { t: T + 60, cw: 10_000 }).measured.cache1hShare, 0.5);
  const none = ttl({ t: T, in: 10 });
  assert.deepEqual([none.measured.cache1hShare, none.pauseSwitchMin], [0, 15]);
});

test('plafond texte : une sortie de 20 000 tokens plafonnée à 5 000 retire 15 000 du contexte des tours suivants', () => {
  const s = withOutputs(A, ['Bash'], [[1, 0, 20_000]]);
  const r = whatIf([s], { textCap: 5_000 });
  // t1 : 15 000 retirés du cache lu → 10 + 2 500 + 37 500 = 40 010 ; t2 : 10 + 5 500 + 12 500 = 18 010
  assert.ok(near(r.sim.wtok, 50_010 + 40_010 + 18_010));
  assert.equal(whatIf([s], { imageCap: 1_000 }).sim.wtok, r.real.wtok);   // une sortie texte ignore le plafond des images
});

test('plafond images : une image de 4 784 tokens ramenée à 1 568 retire 3 216 tokens des tours suivants', () => {
  const r = whatIf([withOutputs(A, ['Read'], [[1, 0, 4_784, 1]])], { imageCap: 1_568 });
  assert.ok(near(r.real.wtok - r.sim.wtok, 2 * 321.6));   // 3 216 de cache lu en moins, deux tours
});

test('plafonds neutres sur une session avec sorties : simulé = réel corrigé (sinon le what-if ment)', () => {
  const r = whatIf([withOutputs(A, ['Bash', 'Read'], [[1, 0, 20_000], [2, 1, 4_000, 1]])], NEUTRAL);
  assert.equal(r.sim.wtok, r.real.wtok);
  assert.equal(r.sim.usd, r.real.usd);
});

test('plafond et bascule au seuil sur le même tour : la bascule repart de R + P et garde la réduction', () => {
  const r = whatIf([withOutputs(A, ['Bash'], [[1, 0, 12_000]])], { ...HYP, threshold: 60_000, textCap: 5_000 });
  // t1 : 70 010 − 7 000 = 63 010 > 60 000 → bascule (résumé 9 001), contexte 20 000 − 7 000 retirés de plus :
  // 43 000 tout réécrits (53 747,5) ; t2 : 80 010 − 27 010 = 53 000, dont 42 990 lus (16 809)
  assert.equal(r.switches, 1);
  assert.ok(near(r.sim.wtok, 50_010 + 9_001 + 53_747.5 + 16_809));
});
