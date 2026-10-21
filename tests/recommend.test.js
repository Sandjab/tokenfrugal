import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../src/model/recommend.js';
import { measuredDefaults } from '../src/model/whatif.js';
import { recommendationText, fmtTok, fmtCost } from '../src/report/strings.js';
import { session, near, withOutputs } from './helpers/model.js';

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

test('une session antérieure aux 4 semaines qui précèdent le dernier tour n’influe pas sur les recommandations', () => {
  // grosse session ancienne, très sensible au socle et à la pause, 5 semaines avant S ; sans compactage
  // ni /clear, elle ne change pas R et S (mesurés, eux, sur tout l'historique, spec § 7.4)
  const old = session([
    { t: T - 35 * 86_400, in: 10, cw: 140_000 },
    { t: T - 35 * 86_400 + 3_600, in: 10, cw: 149_000 },
  ]);
  assert.deepEqual(recommend([old, S]), recommend([S]));
});

test('cache 1 h : le levier pause est recommandé avec T = 60 min mesuré', () => {
  // mêmes tours que S, en cache 1 h, avec 2 h de pause (une pause de 1 h exactement n'excède pas 60 min)
  const s1h = session([
    { t: T, in: 10, cw: 120_000, cw1h: 120_000 },
    { t: T + 60, in: 10, cr: 120_000, cw: 29_000, cw1h: 29_000 },
    { t: T + 7_260, in: 10, cw: 149_000, cw1h: 149_000 },
  ]);
  const pause = recommend([s1h]).find((x) => x.lever === 'pause');
  assert.ok(pause, 'levier pause absent');
  assert.deepEqual(pause.params, { pauseSwitchMin: 60 });
  assert.match(recommendationText(pause, 'usd'), /pauses de plus de 60 min/);
});

test('cache 5 min (fixture S) : T reste 15 min', () => {
  assert.deepEqual(recommend([S]).find((x) => x.lever === 'pause').params, { pauseSwitchMin: 15 });
});

test('fenêtre ancrée sur le dernier tour donné : un projet inactif depuis 10 semaines n’a pas de recommandation', () => {
  assert.deepEqual(recommend([S], T + 3660 + 10 * 7 * 86_400), []);
  assert.deepEqual(recommend([S], T + 3660), recommend([S]));
});

test('hypothèses données (habitudes de toutes les sessions) : la recommandation d’un projet suit le T global, pas celui du projet', () => {
  // T global de 120 min : la pause d'1 h de S n'est plus visée, le levier pause disparaît
  const hyp = { ...measuredDefaults([S]), pauseSwitchMin: 120 };
  assert.deepEqual(recommend([S], undefined, hyp).map((x) => x.lever), ['socle']);
});

test('plafond des sorties : recommandé quand une grosse sortie reste dans le contexte ; sans image, pas de levier image', () => {
  const r = recommend([withOutputs(S, ['Bash'], [[1, 0, 20_000]])]);
  const cap = r.find((x) => x.lever === 'textCap');
  // plafond par défaut 9 000 (≈ 20 000 caractères, seuil du brief) : 11 000 retirés, t1 du cache lu (1 100),
  // t2 du cache écrit après la pause (13 750)
  assert.ok(near(cap.perWeek.wtok, 14_850 / 4));
  assert.deepEqual(cap.params, { textCap: 9_000 });
  assert.ok(!r.some((x) => x.lever === 'imageCap'));
});

test('phrases des plafonds : chiffres calculés, gain dit optimiste', () => {
  const pw = { usd: 3, wtok: 1 };
  assert.equal(recommendationText({ lever: 'textCap', params: { textCap: 5_000 }, perWeek: pw }, 'usd'),
    `Plafonner les sorties d’outils à ${fmtTok(5_000)} tokens (head, plages de lignes, filtres), gain optimiste : −${fmtCost(pw, 'usd')} par semaine`);
  assert.match(recommendationText({ lever: 'imageCap', params: { imageCap: 1_568 }, perWeek: pw }, 'usd'), /^Réduire ou recadrer les captures d’écran \(≤ 1\s568 tokens/);
});
