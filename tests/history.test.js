import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packHistory, unpackHistory, HISTORY_KIND } from '../src/store/history.js';

const index = { schema: 1, sessions: { k1: { stamp: 's', analyzer: 1, month: '2026-10' } } };
const months = { '2026-10': { schema: 1, sessions: { k1: { analyzer: 1, start: 1, t: [1] } } } };

test('aller-retour : l’historique relu est identique au stockage', () => {
  const h = packHistory(index, months, 123);
  assert.equal(h.kind, HISTORY_KIND);
  assert.equal(h.exported, 123);
  assert.deepEqual(unpackHistory(JSON.parse(JSON.stringify(h))), { index, months });
});

test('refusés avec un code : autre type de fichier, autre schéma, contenu abîmé', () => {
  const ok = packHistory(index, months, 1);
  assert.throws(() => unpackHistory({ kind: 'autre' }), /^Error: history-kind$/);
  assert.throws(() => unpackHistory(null), /history-kind/);
  assert.throws(() => unpackHistory({ ...ok, schema: 2 }), /history-schema/);
  assert.throws(() => unpackHistory({ ...ok, months: [] }), /history-shape/);
  assert.throws(() => unpackHistory({ ...ok, months: { 'pas-un-mois': { sessions: {} } } }), /history-shape/);
  assert.throws(() => unpackHistory({ ...ok, index: {} }), /history-shape/);
});
