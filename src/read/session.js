// src/read/session.js — lit une session (fichier principal puis sous-agents) en tours et événements.
// Ne garde que des nombres, des noms de modèle, des types de ligne et le nom du dossier du projet (spec § 5).
// Version 2 : les lignes sont coupées sur « \n » seulement (U+2028 / U+2029 ne coupent plus un enregistrement).
// Version 3 : nom du projet (dossier du cwd), spec projets § 3. Chaque changement de version fait relire
// une fois les sessions dont les journaux existent encore.
// Version 4 : sorties d'outils (outil, tokens estimés, image, fichier relu), spec sorties d'outils § 3.
import { imageSize, imageTier, imageTokens } from './image.js';

export const ANALYZER_VERSION = 4;

// Types connus que le relevé n'utilise pas : ignorés sans être comptés (relevé du 19 oct. 2026).
// Un type absent de cette liste est compté : c'est le signe d'un format qui a changé.
const UNUSED_TYPES = new Set([
  'attachment', 'file-history-snapshot', 'file-history-delta', 'last-prompt', 'permission-mode', 'mode',
  'custom-title', 'ai-title', 'agent-name', 'atis-latch', 'bridge-session', 'queue-operation',
  'artifact-comment-monitor', 'artifact-autoreact-ledger', 'cost-state', 'frame-link', 'pr-link',
  'api-request', 'api-request-shape', 'api-request-blob', 'continued-in', 'summary',
]);
// Noms de modèle et de type : format strict, pour qu'aucun texte libre n'entre dans le stockage.
const MODEL_RE = /^[\w.:@\-[\]]{1,80}$/;
const TYPE_RE = /^[a-z0-9_-]{1,40}$/i;
const CLEAR_RE = /<command-name>\/clear<\/command-name>/;
const FIELDS = ['input', 'output', 'cr', 'cw', 'cw1h'];
// Nom de projet : même exigence de format que les noms de modèle, mais un dossier peut contenir des
// espaces ou de la ponctuation ; seuls les séparateurs et les caractères de contrôle sont exclus.
const PROJECT_RE = /^[^\/\\\u0000-\u001f\u007f]{1,80}$/;

// Nom du projet : dernier segment du cwd ; un worktree de Claude Code (<projet>/.claude/worktrees/<x>)
// est rattaché à <projet>. Seul ce nom sort du lecteur, jamais le chemin (spec projets § 3.1).
export function projectNameOf(cwd) {
  const segs = cwd.split(/[\\/]/).filter(Boolean);
  const w = segs.findIndex((x, i) => x === '.claude' && segs[i + 1] === 'worktrees');
  const name = w > 0 ? segs[w - 1] : segs.at(-1);
  return name && PROJECT_RE.test(name) ? name : '?';
}

// Nom d'outil : format strict (aucun texte libre) ; un outil MCP est regroupé par serveur.
const TOOL_RE = /^[A-Za-z0-9_.-]{1,80}$/;
export function toolNameOf(name) {
  if (typeof name !== 'string') return '?';
  const n = name.startsWith('mcp__') ? `mcp__${name.split('__')[1]}` : name;
  return TOOL_RE.test(n) ? n : 'other';
}

const num = (x) => (Number.isFinite(x) && x > 0 ? Math.round(x) : 0);

export class SessionReader {
  constructor() {
    this.turns = [];
    this.events = [];
    this.ignored = {};
    this.clearStart = false;
    this.sawMainTurn = false;
    this.kind = 'main';
    this.byKey = new Map();
    this.projectName = undefined;   // premier cwd du fichier principal (spec projets § 3.1)
    // Sorties d'outils du fichier principal (spec sorties d'outils § 3) ; chemins gardés en mémoire seulement.
    this.toolNames = new Map();   // id de tool_use → nom d'outil
    this.toolFiles = new Map();   // id d'un Read → numéro de fichier
    this.files = new Map();       // chemin → numéro de fichier, jamais stocké
    this.outputs = [];            // { next, tool, file, chars } ou { next, tool, file, size }
  }

  beginFile(kind) {
    this.kind = kind;
    this.byKey = new Map();   // la déduplication se fait par fichier
  }

  #ignore(k) { this.ignored[k] = (this.ignored[k] || 0) + 1; }

  feedLine(line) {
    if (typeof line !== 'string' || !line.trim()) return;
    let o;
    try { o = JSON.parse(line); } catch { this.#ignore('corrupt'); return; }
    if (!o || typeof o !== 'object') { this.#ignore('corrupt'); return; }
    if (this.kind === 'main' && this.projectName === undefined && typeof o.cwd === 'string' && o.cwd) this.projectName = projectNameOf(o.cwd);
    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
    switch (o.type) {
      case 'assistant': this.#assistant(o, ts); return;
      case 'user': this.#user(o); return;
      case 'system': if (o.subtype === 'compact_boundary') this.#compact(o, ts); return;
      default:
        if (!UNUSED_TYPES.has(o.type)) this.#ignore(typeof o.type === 'string' && TYPE_RE.test(o.type) ? o.type : 'other');
    }
  }

  // /clear ouvre un nouveau fichier ; la commande précède le premier tour (brief, formats observés).
  #user(o) {
    if (this.kind !== 'main') return;
    const c = o.message && o.message.content;
    if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result') this.#toolResult(b);
    if (this.sawMainTurn || this.clearStart) return;
    const text = typeof c === 'string' ? c
      : Array.isArray(c) ? c.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n') : '';
    if (CLEAR_RE.test(text)) this.clearStart = true;
  }

  // Sortie rattachée au prochain tour lu (next), pas à l'heure : le tour qui l'a demandée peut porter la
  // même seconde. Un tool_result mêlé donne une sortie texte (somme des textes) et une sortie par image.
  #toolResult(b) {
    const tool = this.toolNames.get(b.tool_use_id) ?? '?';
    const file = this.toolFiles.get(b.tool_use_id) ?? -1;
    const next = this.turns.length;
    const parts = typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : Array.isArray(b.content) ? b.content : [];
    let chars = 0, text = false;
    for (const p of parts) {
      if (p && p.type === 'text' && typeof p.text === 'string') { chars += p.text.length; text = true; }
      else if (p && p.type === 'image') this.outputs.push({ next, tool, file, size: imageSize(p.source && p.source.data) });
    }
    if (text) this.outputs.push({ next, tool, file, chars });
  }

  #toolUses(content) {
    for (const b of content) {
      if (!b || b.type !== 'tool_use' || typeof b.id !== 'string') continue;
      this.toolNames.set(b.id, toolNameOf(b.name));
      const fp = b.name === 'Read' && b.input && typeof b.input.file_path === 'string' ? b.input.file_path : '';
      if (!fp) continue;
      if (!this.files.has(fp)) this.files.set(fp, this.files.size);
      this.toolFiles.set(b.id, this.files.get(fp));
    }
  }

  #compact(o, ts) {
    if (this.kind !== 'main') return;
    if (Number.isNaN(ts)) { this.#ignore('no-timestamp'); return; }
    const m = o.compactMetadata && typeof o.compactMetadata === 'object' ? o.compactMetadata : {};
    const trigger = m.trigger === 'auto' || m.trigger === 'manual' ? m.trigger : 'other';
    this.events.push({ t: Math.floor(ts / 1000), kind: 'compact', trigger, pre: num(m.preTokens), post: num(m.postTokens) });
  }

  #assistant(o, ts) {
    const m = o.message;
    if (!m || typeof m !== 'object') { this.#ignore('assistant-no-message'); return; }
    if (m.model === '<synthetic>') return;   // écrit par Claude Code, pas par un modèle
    if (this.kind === 'main' && Array.isArray(m.content)) this.#toolUses(m.content);
    if (!m.usage || typeof m.usage !== 'object') { this.#ignore('assistant-no-usage'); return; }
    if (Number.isNaN(ts)) { this.#ignore('no-timestamp'); return; }
    if (this.kind === 'main') this.sawMainTurn = true;
    const u = m.usage;
    const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : {};
    const usage = {
      input: num(u.input_tokens), output: num(u.output_tokens), cr: num(u.cache_read_input_tokens),
      cw: num(u.cache_creation_input_tokens), cw1h: num(cc.ephemeral_1h_input_tokens),
    };
    // Un tour peut s'étaler sur plusieurs lignes (même message.id + requestId) et son usage y
    // croît : on le compte une fois et on garde, champ par champ, la plus grande valeur vue.
    const key = typeof m.id === 'string' ? `${m.id}:${o.requestId || ''}` : null;
    let turn = key ? this.byKey.get(key) : null;
    if (!turn) {
      const model = typeof m.model === 'string' && MODEL_RE.test(m.model) ? m.model : 'unknown';
      turn = { t: Math.floor(ts / 1000), model, input: 0, output: 0, cr: 0, cw: 0, cw1h: 0, sub: this.kind === 'sub' ? 1 : 0 };
      this.turns.push(turn);
      if (key) this.byKey.set(key, turn);
    }
    for (const k of FIELDS) if (usage[k] > turn[k]) turn[k] = usage[k];
  }

  // Session en colonnes, tours triés par heure (tri stable : l'ordre de lecture départage).
  result() {
    if (!this.turns.length) return null;
    const turns = [...this.turns].sort((a, b) => a.t - b.t);
    const models = [], idx = new Map();
    const s = {
      analyzer: ANALYZER_VERSION, start: turns[0].t, clearStart: this.clearStart, models,
      t: [], m: [], in: [], out: [], cr: [], cw: [], cw1h: [], sub: [],
      events: [...this.events].sort((a, b) => a.t - b.t), ignored: { ...this.ignored },
      project: this.projectName === undefined ? {} : { name: this.projectName },
    };
    for (const x of turns) {
      if (!idx.has(x.model)) { idx.set(x.model, models.length); models.push(x.model); }
      s.t.push(x.t); s.m.push(idx.get(x.model));
      s.in.push(x.input); s.out.push(x.output); s.cr.push(x.cr); s.cw.push(x.cw); s.cw1h.push(x.cw1h);
      s.sub.push(x.sub);
    }
    // Sorties : le tour « next » est un tour principal lu après elles ; sans lui, aucun tour ne la repaie.
    const order = new Map(turns.map((x, i) => [x, i]));
    const tools = [], tIdx = new Map(), tr = { at: [], tool: [], tok: [], img: [], file: [], unsized: 0 };
    for (const o of this.outputs) {
      const turn = this.turns[o.next];
      if (!turn || turn.sub) continue;
      let tok;
      if (o.chars !== undefined) tok = Math.ceil(o.chars / 4);
      else if (o.size) tok = imageTokens(o.size.w, o.size.h, turn.model);
      else { tok = imageTier(turn.model).cap; tr.unsized++; }
      if (!tIdx.has(o.tool)) { tIdx.set(o.tool, tools.length); tools.push(o.tool); }
      tr.at.push(order.get(turn)); tr.tool.push(tIdx.get(o.tool)); tr.tok.push(tok);
      tr.img.push(o.chars === undefined ? 1 : 0); tr.file.push(o.file);
    }
    if (tr.at.length) { s.tools = tools; s.tr = tr; }
    return s;
  }
}
