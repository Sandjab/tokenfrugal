// src/read/session.js — lit une session (fichier principal puis sous-agents) en tours et événements.
// Ne garde que des nombres, des noms de modèle et des types de ligne (spec § 5).
// Version 2 : les lignes sont coupées sur « \n » seulement (U+2028 / U+2029 ne coupent plus un enregistrement) ;
// les sessions déjà stockées sont relues une fois pour récupérer les enregistrements perdus.
export const ANALYZER_VERSION = 2;

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
    if (this.kind !== 'main' || this.sawMainTurn || this.clearStart) return;
    const c = o.message && o.message.content;
    const text = typeof c === 'string' ? c
      : Array.isArray(c) ? c.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n') : '';
    if (CLEAR_RE.test(text)) this.clearStart = true;
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
    };
    for (const x of turns) {
      if (!idx.has(x.model)) { idx.set(x.model, models.length); models.push(x.model); }
      s.t.push(x.t); s.m.push(idx.get(x.model));
      s.in.push(x.input); s.out.push(x.output); s.cr.push(x.cr); s.cw.push(x.cw); s.cw1h.push(x.cw1h);
      s.sub.push(x.sub);
    }
    return s;
  }
}
