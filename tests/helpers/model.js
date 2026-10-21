// tests/helpers/model.js — sessions au format du stockage, écrites à la main pour tester src/model.
export function session(turns, { events = [], clearStart = false, model = 'claude-opus-4-6' } = {}) {
  return {
    analyzer: 1, start: turns[0]?.t ?? 0, clearStart, models: [model], events, ignored: {},
    t: turns.map((x) => x.t), m: turns.map(() => 0),
    in: turns.map((x) => x.in ?? 0), out: turns.map((x) => x.out ?? 0),
    cr: turns.map((x) => x.cr ?? 0), cw: turns.map((x) => x.cw ?? 0),
    cw1h: turns.map((x) => x.cw1h ?? 0), sub: turns.map((x) => x.sub ?? 0),
  };
}

// Égalité à une tolérance relative près (les coûts passent par des divisions flottantes).
export const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

// Ajoute des sorties d'outils à une session : rows = [[at, indice d'outil, tokens, image (0/1), fichier]].
export const withOutputs = (s, tools, rows) => ({
  ...s, tools,
  tr: { at: rows.map((r) => r[0]), tool: rows.map((r) => r[1]), tok: rows.map((r) => r[2]), img: rows.map((r) => r[3] ?? 0), file: rows.map((r) => r[4] ?? -1), unsized: 0 },
});
