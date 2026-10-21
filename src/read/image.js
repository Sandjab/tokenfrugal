// src/read/image.js — dimensions d'une image en base64 (en-tête PNG, JPEG, GIF, WebP) et ses tokens selon la
// doc Vision d'Anthropic, vérifiée le 21 oct. 2026 (spec sorties d'outils § 3.3). Pur : Node et worker.

// Base64 décodé pour lire l'en-tête : assez pour sauter les segments EXIF d'un JPEG (multiple de 4).
const HEAD_CHARS = 262_144;
const PATCH = 28;   // une image se facture par carrés de 28 × 28 px
export const TIERS = { high: { edge: 2576, cap: 4784 }, standard: { edge: 1568, cap: 1568 } };

// { w, h }, ou null si l'en-tête est illisible.
export function imageSize(b64) {
  if (typeof b64 !== 'string' || !b64) return null;
  let s;
  try { s = atob(b64.slice(0, HEAD_CHARS)); } catch { return null; }
  const b = (i) => (i < s.length ? s.charCodeAt(i) : -1);
  const ok = (w, h) => (w > 0 && h > 0 ? { w, h } : null);
  if (s.startsWith('\x89PNG\r\n\x1a\n') && s.slice(12, 16) === 'IHDR') {
    return ok(((b(16) << 24) | (b(17) << 16) | (b(18) << 8) | b(19)) >>> 0, ((b(20) << 24) | (b(21) << 16) | (b(22) << 8) | b(23)) >>> 0);
  }
  if (s.startsWith('GIF8') && s.length >= 10) return ok(b(6) | (b(7) << 8), b(8) | (b(9) << 8));
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') {
    const chunk = s.slice(12, 16);
    if (chunk === 'VP8 ' && s.length >= 30) return ok((b(26) | (b(27) << 8)) & 0x3fff, (b(28) | (b(29) << 8)) & 0x3fff);
    if (chunk === 'VP8L' && s.length >= 25) return ok(1 + (b(21) | ((b(22) & 0x3f) << 8)), 1 + ((b(22) >> 6) | (b(23) << 2) | ((b(24) & 0x0f) << 10)));
    if (chunk === 'VP8X' && s.length >= 30) return ok(1 + (b(24) | (b(25) << 8) | (b(26) << 16)), 1 + (b(27) | (b(28) << 8) | (b(29) << 16)));
    return null;
  }
  if (b(0) === 0xff && b(1) === 0xd8) {
    // Segments JPEG : le premier SOF (C0 à CF, hors C4 DHT, C8 JPG, CC DAC) donne hauteur puis largeur.
    let i = 2;
    while (i + 3 < s.length) {
      if (b(i) !== 0xff) return null;
      const m = b(i + 1);
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return i + 8 < s.length ? ok((b(i + 7) << 8) | b(i + 8), (b(i + 5) << 8) | b(i + 6)) : null;
      }
      i += 2 + ((b(i + 2) << 8) | b(i + 3));
    }
    return null;
  }
  return null;
}

// Palier haute résolution : Claude 4.7 et suivants, Fable et Mythos compris. Version lue dans l'identifiant
// (« claude-opus-4-7 », « claude-sonnet-5 ») ; une date (« -20250514 ») n'est pas une version mineure.
export function imageTier(model) {
  const m = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(String(model ?? ''));
  if (!m) return TIERS.standard;
  if (m[1] === 'fable' || m[1] === 'mythos') return TIERS.high;
  return Number(m[2]) + Number(m[3] ?? 0) / 10 >= 4.7 ? TIERS.high : TIERS.standard;
}

const patches = (w, h) => Math.ceil(w / PATCH) * Math.ceil(h / PATCH);

// Réduction : grand côté ramené au maximum du palier, puis proportions gardées jusqu'à tenir sous le
// plafond de tokens. Redonne les tokens du tableau d'exemples de la doc.
export function imageTokens(w, h, model) {
  const { edge, cap } = imageTier(model);
  let k = Math.min(1, edge / Math.max(w, h));
  let W = Math.round(w * k), H = Math.round(h * k);
  while (patches(W, H) > cap) { k *= 0.999; W = Math.round(w * k); H = Math.round(h * k); }
  return patches(W, H);
}
