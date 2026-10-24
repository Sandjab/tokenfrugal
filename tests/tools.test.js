import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolCosts } from '../src/model/tools.js';
import { session, near, withOutputs } from './helpers/model.js';

const T = 1_792_000_000;
const BASE = [{ t: T, in: 10, cw: 40_000 }, { t: T + 60, in: 10, cr: 40_000, cw: 30_000 }, { t: T + 120, in: 10, cr: 70_000, cw: 10_000 }];
// Coût du contexte en tokens pondérés (opus-4-6) : t1 = 10 + 4 000 + 37 500 = 41 510 pour 70 010 tokens ;
// t2 = 10 + 7 000 + 12 500 = 19 510 pour 80 010 tokens.

test('coût reporté : chaque tour cède à une sortie sa part du contexte, jusqu’à la fin de la session', () => {
  const r = toolCosts([withOutputs(session(BASE), ['Bash'], [[1, 0, 20_000]])]);
  assert.deepEqual(r.tools.map((x) => [x.tool, x.n, x.tok]), [['Bash', 1, 20_000]]);
  assert.ok(near(r.tools[0].cost.wtok, (20_000 / 70_010) * 41_510 + (20_000 / 80_010) * 19_510));
});

test('compactage : la sortie sort du contexte, elle ne coûte plus rien ensuite', () => {
  const s = withOutputs(session(BASE, { events: [{ t: T + 90, kind: 'compact', trigger: 'auto', pre: 70_010, post: 9_000 }] }), ['Bash'], [[1, 0, 20_000]]);
  assert.ok(near(toolCosts([s]).tools[0].cost.wtok, (20_000 / 70_010) * 41_510));
});

test('estimation plus grosse que le contexte : ramenée à lui, jamais plus que le coût du tour', () => {
  const r = toolCosts([withOutputs(session(BASE), ['Read', 'Bash'], [[1, 0, 100_000], [1, 1, 40_000]])]);
  assert.ok(near(r.tools.reduce((a, x) => a + x.cost.wtok, 0), 41_510 + 19_510));
  assert.ok(near(r.tools[0].cost.wtok / r.tools[1].cost.wtok, 100_000 / 40_000));
});

test('« dont images » et « dont relectures » : sous-ensembles ; une relecture est un fichier déjà lu dans la session', () => {
  const s = withOutputs(session(BASE), ['Read'], [[1, 0, 1_000, 0, 0], [1, 0, 1_560, 1, 1], [2, 0, 1_000, 0, 0]]);
  const r = toolCosts([s]);
  assert.deepEqual([r.images.n, r.images.tok, r.rereads.n, r.rereads.tok], [1, 1_560, 1, 1_000]);
  assert.ok(near(r.rereads.cost.wtok, (1_000 / 80_010) * 19_510));
});

test('grosses sorties : texte de plus de 9 000 tokens (≈ 20 000 caractères, seuil du brief) ; une image n’en est jamais une', () => {
  const s = withOutputs(session(BASE), ['Bash'], [[1, 0, 9_001], [1, 0, 9_000], [1, 0, 12_000, 1]]);
  assert.equal(toolCosts([s]).tools[0].big, 1);
});

test('fenêtre : sorties comptées au tour qui les fait entrer, coût au tour qui le paie, dans la période seulement', () => {
  const r = toolCosts([withOutputs(session(BASE), ['Bash'], [[1, 0, 20_000]])], { from: T + 100, to: T + 200 });
  assert.equal(r.tools[0].n, 0);
  assert.ok(near(r.tools[0].cost.wtok, (20_000 / 80_010) * 19_510));
});

test('session sans sorties (lue avant cette version) : rien', () => {
  const r = toolCosts([session(BASE)]);
  assert.deepEqual([r.tools.length, r.images.n, r.rereads.n], [0, 0, 0]);
});

test('un seul Read qui rend une image et du texte n’est pas une relecture de lui-même', () => {
  const s = withOutputs(session(BASE), ['Read'], [[1, 0, 1_560, 1, 0], [1, 0, 1_000, 0, 0]]);
  assert.equal(toolCosts([s]).rereads.n, 0);
});

test('skills : sous-ensemble de la ligne Skill, au prorata de leurs tokens, jamais plus que la ligne Skill', () => {
  const s = withOutputs(session(BASE), ['Skill', 'Bash'],
    [[1, 0, 15], [1, 0, 8_000, 0, -1, 0], [1, 1, 10_000], [2, 0, 4_000, 0, -1, 1]], ['brainstorming', 'handoff']);
  const r = toolCosts([s]);
  const skill = r.tools.find((x) => x.tool === 'Skill');
  assert.deepEqual(r.skills.map((x) => [x.skill, x.n, x.tok]), [['brainstorming', 1, 8_000], ['handoff', 1, 4_000]]);
  assert.ok(near(r.skills[0].cost.wtok, (8_000 / 70_010) * 41_510 + (8_000 / 80_010) * 19_510));
  assert.ok(near(r.skills[1].cost.wtok, (4_000 / 80_010) * 19_510));
  assert.deepEqual([skill.n, skill.tok], [3, 12_015]);
  assert.ok(r.skills.reduce((a, x) => a + x.cost.wtok, 0) < skill.cost.wtok);   // la ligne Skill compte aussi « Launching skill »
});

test('skills : même skill chargé deux fois → deux chargements, chacun repayé depuis son tour', () => {
  const s = withOutputs(session(BASE), ['Skill'], [[1, 0, 8_000, 0, -1, 0], [2, 0, 8_000, 0, -1, 0]], ['brainstorming']);
  const r = toolCosts([s]);
  assert.deepEqual([r.skills[0].n, r.skills[0].tok], [2, 16_000]);
  assert.ok(near(r.skills[0].cost.wtok, (8_000 / 70_010) * 41_510 + (16_000 / 80_010) * 19_510));
});

test('skills : compactage → le texte sort du contexte, il ne coûte plus rien ensuite', () => {
  const s = withOutputs(session(BASE, { events: [{ t: T + 90, kind: 'compact', trigger: 'auto', pre: 70_010, post: 9_000 }] }),
    ['Skill'], [[1, 0, 8_000, 0, -1, 0]], ['brainstorming']);
  assert.ok(near(toolCosts([s]).skills[0].cost.wtok, (8_000 / 70_010) * 41_510));
});

test('grosses sorties : un texte de skill n’en est pas une (aucun head ne le tronque) ; une sortie d’outil de même taille l’est', () => {
  const s = withOutputs(session(BASE), ['Skill'], [[1, 0, 12_000, 0, -1, 0], [1, 0, 12_000]], ['gros-skill']);
  assert.equal(toolCosts([s]).tools[0].big, 1);
});

test('session lue en version 5 (tr sans skill) : aucun skill, ligne Skill inchangée, sans erreur', () => {
  const s = withOutputs(session(BASE), ['Skill'], [[1, 0, 8_000]]);
  delete s.tr.skill;
  const r = toolCosts([s]);
  assert.deepEqual(r.skills, []);
  assert.deepEqual([r.tools[0].n, r.tools[0].tok], [1, 8_000]);
});
