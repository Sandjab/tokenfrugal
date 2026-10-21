import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionReader, projectNameOf, toolNameOf } from '../src/read/session.js';
import { T0, assistant, user, compact, clearLines, assistantTool, toolResults } from './helpers/logs.js';
import { png } from './helpers/images.js';

function read(main, subs = []) {
  const r = new SessionReader();
  r.beginFile('main');
  for (const l of main) r.feedLine(l);
  for (const lines of subs) { r.beginFile('sub'); for (const l of lines) r.feedLine(l); }
  return r.result();
}

test('un tour écrit sur plusieurs lignes est compté une fois, au maximum de chaque champ', () => {
  const s = read([
    assistant({ t: T0, id: 'm1', req: 'r1', input: 10, output: 5, cr: 1000, cw: 200 }),
    assistant({ t: T0 + 1, id: 'm1', req: 'r1', input: 10, output: 300, cr: 1000, cw: 200 }),
  ]);
  assert.equal(s.t.length, 1);
  assert.deepEqual([s.in[0], s.out[0], s.cr[0], s.cw[0]], [10, 300, 1000, 200]);
});

test('lignes sans identifiant : un tour chacune ; <synthetic> ignoré', () => {
  const noId = (t) => JSON.stringify({ type: 'assistant', timestamp: new Date(t * 1000).toISOString(), message: { model: 'claude-opus-4-6', usage: { input_tokens: 1 } } });
  const s = read([noId(T0), noId(T0 + 1), assistant({ t: T0 + 2, model: '<synthetic>' })]);
  assert.equal(s.t.length, 2);
});

test('sous-agents marqués, tous les tours triés par heure (fichiers lus dans le désordre)', () => {
  const s = read([assistant({ t: T0 + 10, input: 1 }), assistant({ t: T0 + 30, input: 3 })], [[assistant({ t: T0 + 20, input: 2 })]]);
  assert.deepEqual(s.in, [1, 2, 3]);
  assert.deepEqual(s.sub, [0, 1, 0]);
  assert.equal(s.start, T0 + 10);
});

test('compactage : déclencheur, avant, après ; ceux d’un sous-agent ignorés', () => {
  const s = read([assistant({ t: T0, input: 1 }), compact({ t: T0 + 60, pre: 170_000, post: 9_000 })],
    [[compact({ t: T0 + 70, pre: 1, post: 1 }), assistant({ t: T0 + 80, input: 1 })]]);
  assert.deepEqual(s.events, [{ t: T0 + 60, kind: 'compact', trigger: 'auto', pre: 170_000, post: 9_000 }]);
});

test('session ouverte par /clear reconnue, session normale non', () => {
  assert.equal(read([...clearLines(T0), assistant({ t: T0 + 5, input: 1 })]).clearStart, true);
  assert.equal(read([user({ t: T0 }), assistant({ t: T0 + 5, input: 1 })]).clearStart, false);
});

test('lignes non comprises : comptées par type, sans compter les types connus inutilisés', () => {
  const s = read([
    assistant({ t: T0, input: 1 }),
    '{pas du json',
    JSON.stringify({ type: 'attachment' }),
    JSON.stringify({ type: 'nouveau-type' }),
    JSON.stringify({ type: 'type avec espaces et texte libre' }),
  ]);
  assert.deepEqual(s.ignored, { corrupt: 1, 'nouveau-type': 1, other: 1 });
});

test('dernière ligne tronquée (session en cours d’écriture) : comptée corrupt, tours complets gardés', () => {
  const s = read([assistant({ t: T0, input: 1 }), assistant({ t: T0 + 5, input: 2 }), '{"type":"assistant","timest']);
  assert.equal(s.t.length, 2);
  assert.equal(s.ignored.corrupt, 1);
});

test('nom de modèle hors format remplacé par unknown (aucun texte libre gardé)', () => {
  const s = read([assistant({ t: T0, input: 1, model: 'un texte libre avec espaces' })]);
  assert.deepEqual(s.models, ['unknown']);
});

test('aucun texte de conversation dans le résultat', () => {
  const s = read([user({ t: T0, text: 'SECRET-HUMAIN' }), assistant({ t: T0 + 1, input: 1, text: 'SECRET-MODELE' })]);
  assert.ok(!JSON.stringify(s).includes('SECRET'));
});

test('session sans tour : null', () => {
  assert.equal(read([...clearLines(T0)]), null);
});

test('projet : nom du dossier du premier cwd du fichier principal, jamais le chemin (on ne garde que le nom)', () => {
  const s = read([user({ t: T0, cwd: '/home/x/alpha' }), user({ t: T0 + 1, cwd: '/home/x/beta' }), assistant({ t: T0 + 2, input: 1 })]);
  assert.deepEqual(s.project, { name: 'alpha' });
  assert.ok(!JSON.stringify(s).includes('/home/x'));
});

test('projet : le cwd d’un sous-agent ne compte pas ; aucun cwd → pas de nom', () => {
  const s = read([assistant({ t: T0, input: 1 })], [[user({ t: T0 + 1, cwd: '/x/sous-agent' }), assistant({ t: T0 + 2, input: 1 })]]);
  assert.deepEqual(s.project, {});
});

test('projet : un worktree de Claude Code est rattaché à son projet, pas compté comme un projet à part', () => {
  assert.equal(projectNameOf('/home/x/alpha/.claude/worktrees/feat-1'), 'alpha');
  assert.equal(projectNameOf('/home/x/alpha/.claude/worktrees/feat-1/sous-dossier'), 'alpha');
});

test('projet : chemins Windows ; racine, nom trop long ou caractère de contrôle → « ? » (format strict)', () => {
  assert.equal(projectNameOf('C:\\dev\\gamma'), 'gamma');
  assert.equal(projectNameOf('/home/x/gamma/'), 'gamma');
  assert.equal(projectNameOf('/'), '?');
  assert.equal(projectNameOf(`/x/${'a'.repeat(81)}`), '?');
  assert.equal(projectNameOf('/x/a\u0007b'), '?');
  assert.equal(projectNameOf('/x/a<b>&"c'), 'a<b>&"c');   // permis : la page échappe à l'affichage
});

test('sorties : chacune à son outil, rattachée au tour suivant même dans la même seconde (sinon payée un tour trop tôt)', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm1', req: 'r1', input: 10, cw: 5_000, uses: [['u1', 'Bash'], ['u2', 'mcp__playwright__browser_click']] }),
    toolResults({ t: T0, results: [['u1', 'x'.repeat(4_000)], ['u2', 'ok']] }),
    assistant({ t: T0, id: 'm2', req: 'r2', input: 10, cr: 5_000, cw: 1_000 }),
    toolResults({ t: T0 + 1, results: [['inconnu', 'abc']] }),
    assistant({ t: T0 + 2, id: 'm3', req: 'r3', input: 10, cr: 6_000 }),
  ]);
  assert.deepEqual(s.tools, ['Bash', 'mcp__playwright', '?']);
  assert.deepEqual(s.tr.at, [1, 1, 2]);
  assert.deepEqual(s.tr.tool, [0, 1, 2]);
  assert.deepEqual(s.tr.tok, [1_000, 1, 1]);
  assert.deepEqual(s.tr.img, [0, 0, 0]);
});

test('relectures : un numéro de fichier propre à la session ; le chemin n’est jamais gardé', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm1', input: 10, cw: 5_000, uses: [['r1', 'Read', { file_path: '/secret/a.js' }], ['r2', 'Read', { file_path: '/secret/b.js' }]] }),
    toolResults({ t: T0 + 1, results: [['r1', 'aaaa'], ['r2', 'bbbb']] }),
    assistantTool({ t: T0 + 2, id: 'm2', input: 10, cr: 5_000, uses: [['r3', 'Read', { file_path: '/secret/a.js' }], ['b1', 'Bash', { command: 'ls' }]] }),
    toolResults({ t: T0 + 3, results: [['r3', 'aaaa'], ['b1', 'x']] }),
    assistant({ t: T0 + 4, id: 'm3', input: 10, cr: 5_000 }),
  ]);
  assert.deepEqual(s.tr.file, [0, 1, 0, -1]);
  assert.ok(!JSON.stringify(s).includes('secret'));
});

test('images : tokens d’après les dimensions et le modèle du tour suivant ; illisible → plafond, compté', () => {
  const img = (data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
  const s = read([
    assistantTool({ t: T0, id: 'm1', input: 10, cw: 5_000, uses: [['s1', 'Read', { file_path: '/x.png' }]] }),
    toolResults({ t: T0 + 1, results: [['s1', [img(png(1920, 1080)), { type: 'text', text: 'abcd' }, img('pas-une-image')]]] }),
    assistant({ t: T0 + 2, id: 'm2', model: 'claude-opus-4-6', input: 10, cr: 5_000 }),
  ]);
  assert.deepEqual(s.tr.img, [1, 1, 0]);
  assert.deepEqual(s.tr.tok, [1_560, 1_568, 1]);   // palier standard ; l'illisible compte au plafond
  assert.deepEqual(s.tr.file, [0, 0, 0]);
  assert.equal(s.tr.unsized, 1);
});

test('sorties d’un sous-agent, et sortie après le dernier tour principal : ignorées (aucun tour principal ne les repaie)', () => {
  const s = read([
    assistantTool({ t: T0, id: 'm1', input: 10, cw: 5_000, uses: [['u1', 'Bash']] }),
    toolResults({ t: T0 + 1, results: [['u1', 'fin']] }),
  ], [[
    assistantTool({ t: T0 + 2, id: 'a1', input: 10, cw: 1_000, uses: [['u2', 'Bash']] }),
    toolResults({ t: T0 + 3, results: [['u2', 'sous-agent']] }),
    assistant({ t: T0 + 4, id: 'a2', input: 10, cr: 1_000 }),
  ]]);
  assert.equal(s.tr, undefined);
  assert.equal(s.tools, undefined);
});

test('noms d’outil : MCP regroupé par serveur ; hors format → other (aucun texte libre stocké)', () => {
  assert.equal(toolNameOf('mcp__plugin_playwright_playwright__browser_click'), 'mcp__plugin_playwright_playwright');
  assert.equal(toolNameOf('Bash'), 'Bash');
  assert.equal(toolNameOf('nom avec espaces'), 'other');
  assert.equal(toolNameOf(undefined), '?');
});
