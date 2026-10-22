import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceFor } from '../src/model/pricing.js';
import { partsOf, costOf } from '../src/model/cost.js';
import { near } from './helpers/model.js';

test('un modèle daté retrouve sa grille, le préfixe le plus long gagne', () => {
  assert.deepEqual(priceFor('claude-opus-4-6-20260101'), { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
  assert.equal(priceFor('claude-opus-4-1').input, 15);   // pas confondu avec la famille claude-opus-4
});

test('modèle hors grille : pas de prix plutôt qu’un prix inventé', () => {
  assert.equal(priceFor('gpt-5'), null);
  assert.equal(costOf(partsOf(1, 1, 1, 1, 0), 'gpt-5'), null);
});

test('coût d’un tour en $ et en tokens pondérés, cache 5 min et 1 h distingués', () => {
  // opus-4-6 : entrée 5, sortie 25, cache lu 0,5, écrit 5 min 6,25, écrit 1 h 10 ($/M)
  const c = costOf(partsOf(100, 10, 1000, 2000, 500), 'claude-opus-4-6');
  assert.ok(near(c.usd, (100 * 5 + 10 * 25 + 1000 * 0.5 + 1500 * 6.25 + 500 * 10) / 1e6));
  // pondéré : 100 + 10×5 + 1000×0,1 + 1500×1,25 + 500×2
  assert.ok(near(c.wtok, 3125));
});

test('la part 1 h ne peut dépasser le cache écrit', () => {
  assert.deepEqual(partsOf(0, 0, 0, 100, 500), { input: 0, output: 0, cr: 0, cw5: 0, cw1h: 100 });
});

// Haiku 5.5 ($/M) : jusqu'à 100 000 tokens de prompt 0,1 / 0,5 / 0,01 / 0,125 (1 h : 0,2) ;
// au-delà 0,5 / 2,5 / 0,05 / 0,625 (1 h : 1). Le prompt compte entrée, cache lu et cache écrit.
const HAIKU_BASE = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };
const HAIKU_LONG = { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 };

test('Haiku 5.5 : seuil strict à 100 000 tokens de prompt, modèle daté compris', () => {
  assert.deepEqual(priceFor('claude-haiku-5-5'), HAIKU_BASE);
  assert.deepEqual(priceFor('claude-haiku-5-5', 100_000), HAIKU_BASE);
  assert.deepEqual(priceFor('claude-haiku-5-5', 100_001), HAIKU_LONG);
  assert.deepEqual(priceFor('claude-haiku-5-5-20261001', 200_000), HAIKU_LONG);
  assert.ok(near(costOf(partsOf(100_000, 0, 0, 0, 0), 'claude-haiku-5-5').usd, 100_000 * 0.1 / 1e6));
  assert.ok(near(costOf(partsOf(100_001, 0, 0, 0, 0), 'claude-haiku-5-5').usd, 100_001 * 0.5 / 1e6));
});

test('Haiku 5.5 au-delà du seuil : le cache compte dans le prompt, toutes les parts au prix du palier', () => {
  // prompt = 10 + 60 000 lus + 40 000 écrits = 100 010 ; dont 10 000 écrits en 1 h
  const c = costOf(partsOf(10, 1000, 60_000, 40_000, 10_000), 'claude-haiku-5-5');
  assert.ok(near(c.usd, (10 * 0.5 + 1000 * 2.5 + 60_000 * 0.05 + 30_000 * 0.625 + 10_000 * 1) / 1e6));
  // tokens pondérés rapportés au prix d'entrée de base (0,1) : le surcoût du palier s'y voit
  assert.ok(near(c.wtok, 342_550));
});

test('prompt explicite : il l’emporte sur la somme des parts (appel partiel)', () => {
  const part1h = { input: 0, output: 0, cr: 0, cw5: 0, cw1h: 1000 };
  assert.ok(near(costOf(part1h, 'claude-haiku-5-5', 150_000).wtok, 10_000));   // 1000 × 1 / 0,1
  assert.ok(near(costOf(part1h, 'claude-haiku-5-5').wtok, 2000));              // 1000 × 0,2 / 0,1
});

test('palier propre à Haiku 5.5 : Haiku 4.5 et le repli de famille inchangés', () => {
  assert.equal(priceFor('claude-haiku-4-5', 200_000).input, 1);
  assert.equal(priceFor('claude-haiku-9', 200_000).input, 1);
  const c = costOf(partsOf(200_000, 0, 0, 0, 0), 'claude-haiku-4-5');
  assert.ok(near(c.usd, 0.2));
  assert.ok(near(c.wtok, 200_000));
});
