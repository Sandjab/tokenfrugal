import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageSize, imageTier, imageTokens, TIERS } from '../src/read/image.js';
import { png, gif, jpeg, webpVP8, webpVP8L, webpVP8X } from './helpers/images.js';

test('dimensions lues dans l’en-tête de chaque format (une image se facture selon sa taille, pas son base64)', () => {
  for (const [name, f] of Object.entries({ png, gif, jpeg, webpVP8, webpVP8L, webpVP8X })) {
    assert.deepEqual(imageSize(f(1920, 1080)), { w: 1920, h: 1080 }, name);
  }
});

test('en-tête illisible : null, jamais d’exception (base64 invalide, autre format, vide)', () => {
  for (const x of ['pas-une-image', '', 'QUJDRA==', undefined, 42]) assert.equal(imageSize(x), null, String(x));
});

test('palier selon le modèle : haute résolution à partir de Claude 4.7, Fable et Mythos compris', () => {
  for (const m of ['claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-mythos-5', 'claude-opus-4-7[1m]']) {
    assert.equal(imageTier(m), TIERS.high, m);
  }
  for (const m of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-20250514', 'claude-sonnet-4-5-20250929', 'unknown', undefined]) {
    assert.equal(imageTier(m), TIERS.standard, String(m));
  }
});

test('tokens : les six exemples du tableau de la doc Vision d’Anthropic, sur les deux paliers', () => {
  const rows = [[200, 200, 64, 64], [1000, 1000, 1296, 1296], [1092, 1092, 1521, 1521],
    [1920, 1080, 1560, 2691], [2000, 1500, 1564, 3888], [3840, 2160, 1560, 4784]];
  for (const [w, h, std, high] of rows) {
    assert.equal(imageTokens(w, h, 'claude-opus-4-6'), std, `${w}x${h} standard`);
    assert.equal(imageTokens(w, h, 'claude-opus-5-5'), high, `${w}x${h} haute résolution`);
  }
});

test('en-tête PNG tronqué : null (compté au plafond), pas une hauteur de 4 milliards de pixels', () => {
  const cut = Buffer.from(png(100, 200), 'base64').subarray(0, 20).toString('base64');
  assert.equal(imageSize(cut), null);
});

test('image très allongée : au moins une rangée de carrés, jamais 0 token', () => {
  assert.ok(imageTokens(10_000, 1, 'claude-opus-4-6') >= 1);
});
