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
