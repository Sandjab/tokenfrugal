// src/read/session.js — lit une session (fichier principal puis sous-agents) en tours et événements.
// Ne garde que des nombres, des noms de modèle, des types de ligne et le nom du dossier du projet (spec § 5).
// Version 2 : les lignes sont coupées sur « \n » seulement (U+2028 / U+2029 ne coupent plus un enregistrement).
// Version 3 : nom du projet (dossier du cwd), spec projets § 3. Chaque changement de version fait relire
// une fois les sessions dont les journaux existent encore.
// Version 4 : sorties d'outils (outil, tokens estimés, image, fichier relu), spec sorties d'outils § 3.
// Version 5 : début du handoff (spec bascules § 3).
// Version 6 : textes de skill (sorties Skill avec nom de skill), spec skills § 3.
// Version 7 : session lancée dans le dossier personnel → projet « ~ » (le login ne sort pas du lecteur).
// Version 8 : tours perdus (tous les appels d'outil du tour en échec), spec tours perdus § 3.
import { imageSize, imageTier, imageTokens, isClaude47Plus } from './image.js';

export const ANALYZER_VERSION = 8;

// Types connus que le relevé n'utilise pas : ignorés sans être comptés (relevé du 19 oct. 2026).
// Un type absent de cette liste est compté : c'est le signe d'un format qui a changé.
const UNUSED_TYPES = new Set([
  'file-history-snapshot', 'file-history-delta', 'last-prompt', 'permission-mode', 'mode',
  'custom-title', 'ai-title', 'agent-name', 'atis-latch', 'bridge-session', 'queue-operation',
  'artifact-comment-monitor', 'artifact-autoreact-ledger', 'cost-state', 'frame-link', 'pr-link',
  'api-request', 'api-request-shape', 'api-request-blob', 'continued-in', 'summary',
]);
// Noms de modèle et de type : format strict, pour qu'aucun texte libre n'entre dans le stockage.
const MODEL_RE = /^[\w.:@\-[\]]{1,80}$/;
const TYPE_RE = /^[a-z0-9_-]{1,40}$/i;
const CLEAR_RE = /<command-name>\/clear<\/command-name>/;
// Commande slash ; signal de handoff (spec bascules § 3.1) : mots cherchés sans casse, aucun nom n'est gardé.
const COMMAND_RE = /<command-name>\/([^<]*)<\/command-name>/g;
const HANDOFF_RE = /handoff|handover|passation/i;
// Une écriture ne compte que pour un document : éditer HandoverService.java n'est pas écrire un handoff.
const DOC_RE = /\.(md|txt)$/i;
const FIELDS = ['input', 'output', 'cr', 'cw', 'cw1h'];
// Nom de projet : même exigence de format que les noms de modèle, mais un dossier peut contenir des
// espaces ou de la ponctuation ; seuls les séparateurs et les caractères de contrôle sont exclus.
const PROJECT_RE = /^[^\/\\\u0000-\u001f\u007f]{1,80}$/;

// Nom du projet : dernier segment du cwd ; un worktree de Claude Code (<projet>/.claude/worktrees/<x>)
// est rattaché à <projet>. Seul ce nom sort du lecteur, jamais le chemin (spec projets § 3.1). Le dossier
// personnel lui-même (/Users/x, /home/x, C:\Users\x, /root) s'appelle « ~ » : son nom serait le login.
export function projectNameOf(cwd) {
  const segs = cwd.split(/[\\/]/).filter(Boolean);
  if (/^(\/(Users|home)\/[^\\/]+|[A-Za-z]:\\Users\\[^\\/]+|\/root)[\\/]?$/.test(cwd)) return '~';
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

// Texte d'un skill chargé : ligne user isMeta qui commence par ce préfixe (spec skills § 3.1).
const SKILL_PREFIX = 'Base directory for this skill:';
// Nom de skill : format strict ; les deux-points des skills de plugin (plugin:skill) sont admis.
const SKILL_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
export function skillNameOf(name) {
  if (typeof name !== 'string' || !name) return '?';
  return SKILL_RE.test(name) ? name : 'other';
}

// Cause d'un échec d'outil (spec tours perdus § 3.3) : début du message, préfixe <tool_use_error> retiré ; la première
// règle qui s'applique l'emporte. Seul le code sort du lecteur, jamais le message.
const CAUSE_RULES = [
  ['refused', /^The user doesn't want to proceed/],
  ['cancelled', /^Cancelled/],
  ['permission', /^(Permission for this action was denied|Permission to use .* has been denied|Permission denied by user|Blocked|File is in a directory that is denied|Claude requested permissions to)|File access denied/],
  ['not-read', /^File has not been read yet/],
  ['stale', /^File has been modified since read/],
  ['replace-miss', /^(String to replace not found|Found \d+ matches of the string to replace)/],
  ['not-found', /^(File does not exist|EISDIR)/],
  ['too-big', /exceeds maximum allowed tokens/],
  ['input', /^(InputValidationError|Missing required parameter|Output does not match required schema)/],
  ['hook', /^\w+:[\w.-]+ hook error/],
  ['exit', /^Exit code \d+/],
];
export function errorCause(content) {
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('') : '';
  const t = text.replace(/^<tool_use_error>/, '');
  for (const [code, re] of CAUSE_RULES) if (re.test(t)) return code;
  return 'other';
}

// Tokens d'un texte : caractères par token calibrés sur des journaux réels (sorties de plus de 1 000 tokens,
// 21 oct. 2026) : 2,2 dès Claude 4.7 (nouveau tokenizer), 2,8 avant. En dixièmes, pour un calcul exact.
const textTokens = (chars, model) => Math.ceil((chars * 10) / (isClaude47Plus(model) ? 22 : 28));

const num = (x) => (Number.isFinite(x) && x > 0 ? Math.round(x) : 0);

export class SessionReader {
  constructor() {
    this.turns = [];
    this.events = [];
    this.ignored = {};
    this.clearStart = false;
    this.clearAt = undefined;   // heure de la commande /clear : la liaison à la session précédente se fait sur elle
    this.sawMainTurn = false;
    this.kind = 'main';
    this.byKey = new Map();
    this.projectName = undefined;   // premier cwd du fichier principal (spec projets § 3.1)
    // Sorties d'outils du fichier principal (spec sorties d'outils § 3) ; chemins gardés en mémoire seulement.
    this.toolNames = new Map();   // id de tool_use → nom d'outil
    this.toolFiles = new Map();   // id d'un Read → numéro de plage lue
    this.files = new Map();       // plage lue (chemin, offset, limit, pages) → numéro, jamais stockée
    this.outputs = [];            // { next, tool, file, chars } ou { next, tool, file, size }
    // Textes de skill (spec skills § 3.1) : id d'un tool_use Skill → nom demandé ; commande de la dernière ligne user.
    this.skillUses = new Map();
    this.lastCommand = null;
    // Tours perdus (spec tours perdus § 3), fichier principal et sous-agents : id de tool_use → tour ; id → résultat
    // { cause (null : succès), seq (ordre de lecture) } ; numéro du fichier lu (une série ne passe pas d'un fichier à l'autre).
    this.useTurn = new Map();
    this.useResult = new Map();
    this.resultSeq = 0;
    this.fileNo = -1;
    // Signaux de handoff du fichier principal (spec bascules § 3.2) : un tour (objet), ou pour une commande
    // l'indice du prochain tour lu ; le dernier signal de chaque sorte l'emporte.
    this.handoffCmd = null;      // skill ou commande
    this.handoffWrite = null;    // écriture d'un fichier handoff
  }

  beginFile(kind) {
    this.kind = kind;
    this.byKey = new Map();   // la déduplication se fait par fichier
    this.fileNo++;
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
      case 'user': this.#user(o, ts); return;
      case 'system': if (o.subtype === 'compact_boundary') this.#compact(o, ts); return;
      case 'attachment': if (o.attachment && o.attachment.type === 'invoked_skills') this.#invokedSkills(o); return;
      default:
        if (!UNUSED_TYPES.has(o.type)) this.#ignore(typeof o.type === 'string' && TYPE_RE.test(o.type) ? o.type : 'other');
    }
  }

  // /clear ouvre un nouveau fichier ; la commande précède le premier tour (brief, formats observés).
  #user(o, ts) {
    const c = o.message && o.message.content;
    // Résultat de chaque appel connu, dans tous les fichiers (spec tours perdus § 3.1).
    if (Array.isArray(c)) for (const b of c) {
      if (b && b.type === 'tool_result' && this.useTurn.has(b.tool_use_id)) {
        this.useResult.set(b.tool_use_id, { cause: b.is_error === true ? errorCause(b.content) : null, seq: this.resultSeq++ });
      }
    }
    if (this.kind !== 'main') return;
    if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result') this.#toolResult(b);
    const text = typeof c === 'string' ? c
      : Array.isArray(c) ? c.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n') : '';
    // Texte d'un skill : lancé par le modèle (sourceToolUseID → tool_use Skill) ou par la commande de la ligne user
    // précédente (spec skills § 3.1).
    const isSkill = o.isMeta === true && text.startsWith(SKILL_PREFIX);
    if (isSkill) {
      const name = typeof o.sourceToolUseID === 'string' ? this.skillUses.get(o.sourceToolUseID) : this.lastCommand;
      this.outputs.push({ next: this.turns.length, tool: 'Skill', file: -1, chars: text.length, skill: skillNameOf(name) });
    }
    let command = null;
    for (const m of text.matchAll(COMMAND_RE)) {
      command ??= m[1];
      if (HANDOFF_RE.test(m[1])) this.handoffCmd = this.turns.length;
    }
    this.lastCommand = isSkill ? null : command;
    if (!this.sawMainTurn && !this.clearStart && CLEAR_RE.test(text)) {
      this.clearStart = true;
      if (!Number.isNaN(ts)) this.clearAt = Math.floor(ts / 1000);
    }
  }

  // Skills rechargés après un compactage : chaque élément est un texte de skill (spec skills § 3.1, cas 3).
  #invokedSkills(o) {
    if (this.kind !== 'main' || !Array.isArray(o.attachment.skills)) return;
    for (const x of o.attachment.skills) {
      if (!x || typeof x.content !== 'string') continue;
      this.outputs.push({ next: this.turns.length, tool: 'Skill', file: -1, chars: x.content.length, skill: skillNameOf(x.name) });
    }
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
      if (b.name === 'Skill' && b.input) this.skillUses.set(b.id, b.input.skill);
      const fp = b.name === 'Read' && b.input && typeof b.input.file_path === 'string' ? b.input.file_path : '';
      if (!fp) continue;
      // Une autre plage du même fichier est une lecture neuve (pagination), pas une relecture.
      const key = JSON.stringify([fp, b.input.offset ?? null, b.input.limit ?? null, b.input.pages ?? null]);
      if (!this.files.has(key)) this.files.set(key, this.files.size);
      this.toolFiles.set(b.id, this.files.get(key));
    }
  }

  // Skill handoff, ou écriture d'un document (.md, .txt) dont le nom (pas le dossier) contient un des mots : le
  // signal porte sur le tour qui contient le tool_use.
  #handoffUses(content, turn) {
    for (const b of content) {
      if (!b || b.type !== 'tool_use' || !b.input) continue;
      if (b.name === 'Skill' && typeof b.input.skill === 'string' && HANDOFF_RE.test(b.input.skill)) this.handoffCmd = turn;
      const name = (b.name === 'Write' || b.name === 'Edit') && typeof b.input.file_path === 'string' ? b.input.file_path.split(/[\\/]/).pop() : '';
      if (HANDOFF_RE.test(name) && DOC_RE.test(name)) this.handoffWrite = turn;
    }
  }

  #compact(o, ts) {
    if (this.kind !== 'main') return;
    if (Number.isNaN(ts)) { this.#ignore('no-timestamp'); return; }
    // Sorties pas encore suivies d'un tour : le résumé les remplace, aucun tour ne les repaie.
    this.outputs = this.outputs.filter((x) => x.next < this.turns.length);
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
      turn = { t: Math.floor(ts / 1000), model, input: 0, output: 0, cr: 0, cw: 0, cw1h: 0, sub: this.kind === 'sub' ? 1 : 0, file: this.fileNo };
      this.turns.push(turn);
      if (key) this.byKey.set(key, turn);
    }
    for (const k of FIELDS) if (usage[k] > turn[k]) turn[k] = usage[k];
    // Appels du tour, sur toutes ses lignes (spec tours perdus § 3.1).
    if (Array.isArray(m.content)) for (const b of m.content) {
      if (b && b.type === 'tool_use' && typeof b.id === 'string') { this.useTurn.set(b.id, turn); (turn.uses ??= new Set()).add(b.id); }
    }
    if (this.kind === 'main' && Array.isArray(m.content)) this.#handoffUses(m.content, turn);
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
    if (this.clearAt !== undefined) s.clearAt = this.clearAt;
    for (const x of turns) {
      if (!idx.has(x.model)) { idx.set(x.model, models.length); models.push(x.model); }
      s.t.push(x.t); s.m.push(idx.get(x.model));
      s.in.push(x.input); s.out.push(x.output); s.cr.push(x.cr); s.cw.push(x.cw); s.cw1h.push(x.cw1h);
      s.sub.push(x.sub);
    }
    // Sorties : le tour « next » est un tour principal lu après elles ; sans lui, aucun tour ne la repaie.
    const order = new Map(turns.map((x, i) => [x, i]));
    const tools = [], tIdx = new Map(), tr = { at: [], tool: [], tok: [], img: [], file: [], skill: [], unsized: 0 };
    const skills = [], kIdx = new Map();
    for (const o of this.outputs) {
      const turn = this.turns[o.next];
      if (!turn || turn.sub) continue;
      let tok;
      if (o.chars !== undefined) tok = textTokens(o.chars, turn.model);
      else if (o.size) tok = imageTokens(o.size.w, o.size.h, turn.model);
      else { tok = imageTier(turn.model).cap; tr.unsized++; }
      if (!tIdx.has(o.tool)) { tIdx.set(o.tool, tools.length); tools.push(o.tool); }
      if (o.skill !== undefined && !kIdx.has(o.skill)) { kIdx.set(o.skill, skills.length); skills.push(o.skill); }
      tr.at.push(order.get(turn)); tr.tool.push(tIdx.get(o.tool)); tr.tok.push(tok);
      tr.img.push(o.chars === undefined ? 1 : 0); tr.file.push(o.file);
      tr.skill.push(o.skill === undefined ? -1 : kIdx.get(o.skill));
    }
    // Début du handoff : dernier skill ou commande, à défaut dernière écriture ; un signal qui ne désigne pas
    // un tour principal est ignoré (spec bascules § 3.2).
    const mainTurn = (x) => { const u = typeof x === 'number' ? this.turns[x] : x; return u && !u.sub ? u : null; };
    const h = mainTurn(this.handoffCmd) ?? mainTurn(this.handoffWrite);
    if (h) s.handoff = { at: order.get(h) };
    // Tours perdus (spec tours perdus § 3.2 à 3.4), dans l'ordre de lecture, fichier par fichier.
    const lost = { at: [], cause: [], series: [] };
    let series = -1, lastFile = null, lastLost = false;
    for (const turn of this.turns) {
      if (turn.file !== lastFile) { lastFile = turn.file; lastLost = false; }
      const res = turn.uses ? [...turn.uses].map((id) => this.useResult.get(id)) : [];
      if (!res.length || !res.every((r) => r && r.cause !== null)) { lastLost = false; continue; }
      const first = res.filter((r) => r.cause !== 'cancelled').sort((a, b) => a.seq - b.seq)[0];
      if (!lastLost) series++;
      lastLost = true;
      lost.at.push(order.get(turn)); lost.cause.push(first ? first.cause : 'cancelled'); lost.series.push(series);
    }
    if (lost.at.length) s.lost = lost;
    if (tr.at.length) { s.tools = tools; s.tr = tr; if (skills.length) s.skills = skills; }
    return s;
  }
}
