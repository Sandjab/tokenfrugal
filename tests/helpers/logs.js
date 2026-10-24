// tests/helpers/logs.js — fabrique des journaux Claude Code minimaux (format relevé le 19 oct. 2026).
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const T0 = Date.UTC(2026, 9, 12, 9) / 1000;   // lundi 12 oct. 2026, 9 h UTC
export const iso = (sec) => new Date(sec * 1000).toISOString();

export function assistant({ t, id = `msg_${t}`, req = `req_${t}`, model = 'claude-opus-4-6', input = 0, output = 0, cr = 0, cw = 0, cw1h = 0, text = 'ok' }) {
  return JSON.stringify({
    type: 'assistant', timestamp: iso(t), requestId: req,
    message: {
      id, model, role: 'assistant', content: [{ type: 'text', text }],
      usage: {
        input_tokens: input, output_tokens: output, cache_read_input_tokens: cr, cache_creation_input_tokens: cw,
        cache_creation: { ephemeral_1h_input_tokens: cw1h, ephemeral_5m_input_tokens: cw - cw1h },
      },
    },
  });
}
export const user = ({ t, text = 'bonjour', cwd = '/tmp/projet' }) =>
  JSON.stringify({ type: 'user', timestamp: iso(t), cwd, message: { role: 'user', content: text } });
export const toolResult = ({ t, content }) =>
  JSON.stringify({ type: 'user', timestamp: iso(t), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content }] } });
// Tour qui appelle des outils : uses = [[id, nom, entrée]].
export function assistantTool({ uses, ...turn }) {
  const o = JSON.parse(assistant(turn));
  o.message.content = uses.map(([id, name, input = {}]) => ({ type: 'tool_use', id, name, input }));
  return JSON.stringify(o);
}
// Sorties d'outils sur une ligne user : results = [[tool_use_id, contenu (chaîne ou blocs), en échec (is_error)]].
export const toolResults = ({ t, results }) => JSON.stringify({
  type: 'user', timestamp: iso(t),
  message: { role: 'user', content: results.map(([id, content, isError]) => ({ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) })) },
});
// Texte d'un skill chargé (format relevé le 24 oct. 2026) : ligne user isMeta qui commence par SKILL_HEAD ; src =
// sourceToolUseID quand le modèle l'a lancé par l'outil Skill, absent quand une commande l'a lancé.
export const SKILL_HEAD = 'Base directory for this skill: /p/skills/x\n\n';
const skillText = (chars) => SKILL_HEAD + 'x'.repeat(Math.max(0, chars - SKILL_HEAD.length));
export const skillBody = ({ t, src, chars = 2_800, text = skillText(chars), asString = false }) => JSON.stringify({
  type: 'user', isMeta: true, timestamp: iso(t), ...(src ? { sourceToolUseID: src } : {}),
  message: { role: 'user', content: asString ? text : [{ type: 'text', text }] },
});
// Skills rechargés après un compactage : skills = [[nom, nombre de caractères ou contenu]].
export const invokedSkills = ({ t, skills }) => JSON.stringify({
  type: 'attachment', timestamp: iso(t),
  attachment: { type: 'invoked_skills', skills: skills.map(([name, c]) => ({ name, path: `plugin:${name}`, content: typeof c === 'string' ? c : skillText(c) })) },
});
export const compact = ({ t, trigger = 'auto', pre, post }) =>
  JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: iso(t), compactMetadata: { trigger, preTokens: pre, postTokens: post, durationMs: 80_000 } });
export const clearLines = (t) => [
  JSON.stringify({ type: 'user', isMeta: true, timestamp: iso(t), message: { role: 'user', content: '<local-command-caveat>Caveat: …</local-command-caveat>' } }),
  JSON.stringify({ type: 'user', timestamp: iso(t), message: { role: 'user', content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>' } }),
  JSON.stringify({ type: 'system', subtype: 'local_command', timestamp: iso(t), content: '' }),
];

// layout : { <projet>: { <session>: { main: [lignes], subs: { 'chemin/agent-x.jsonl': [lignes] } } } }
export function writeProjects(layout, root = mkdtempSync(path.join(tmpdir(), 'tf-projects-'))) {
  for (const [slug, sessions] of Object.entries(layout)) {
    for (const [id, { main = [], subs = {} }] of Object.entries(sessions)) {
      mkdirSync(path.join(root, slug), { recursive: true });
      writeFileSync(path.join(root, slug, `${id}.jsonl`), main.join('\n') + '\n');
      for (const [name, lines] of Object.entries(subs)) {
        const file = path.join(root, slug, id, 'subagents', name);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, lines.join('\n') + '\n');
      }
    }
  }
  return root;
}
export const tmpStore = () => mkdtempSync(path.join(tmpdir(), 'tf-store-'));
