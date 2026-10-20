// src/read/group.js — regroupe des descripteurs de fichiers en sessions (spec web § 4-5). Pur : le CLI
// (disque) et la page (dossier choisi ou déposé) l'utilisent tous deux, d'où les mêmes empreintes.

// Chemin relatif au dossier projects, séparateur « / ». Le chemin reçu part du dossier choisi : on
// recadre sur le premier segment « projects » s'il existe, sinon on retire ce premier segment.
export function toRel(p) {
  const segs = String(p).split(/[\\/]/).filter(Boolean);
  const i = segs.indexOf('projects');
  return (i >= 0 ? segs.slice(i + 1) : segs.slice(1)).join('/');
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// descs : [{ rel, size, mtimeMs }]. Une entrée par fichier principal <projet>/<session>.jsonl, suivie de
// ses sous-agents <projet>/<session>/subagents/**/*.jsonl ; projets, sessions et sous-agents par nom.
export function groupSessions(descs) {
  const mains = [], subs = new Map();
  for (const x of descs) {
    if (!x.rel.endsWith('.jsonl')) continue;
    const segs = x.rel.split('/');
    if (segs.length === 2) mains.push({ slug: segs[0], id: segs[1].slice(0, -'.jsonl'.length), file: x });
    else if (segs.length >= 4 && segs[2] === 'subagents') {
      const k = `${segs[0]}/${segs[1]}`;
      if (!subs.has(k)) subs.set(k, []);
      subs.get(k).push({ under: segs.slice(3).join('/'), file: x });
    }
  }
  const keep = ({ rel, size, mtimeMs }) => ({ rel, size, mtimeMs });
  return mains
    .sort((a, b) => cmp(a.slug, b.slug) || cmp(a.file.rel, b.file.rel))
    .map((m) => {
      const s = (subs.get(`${m.slug}/${m.id}`) || []).sort((a, b) => cmp(a.under, b.under));
      return { slug: m.slug, id: m.id, files: [m.file, ...s.map((x) => x.file)].map(keep) };
    });
}
