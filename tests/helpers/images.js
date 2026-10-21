// tests/helpers/images.js — en-têtes d'images minimaux (assez pour lire les dimensions), en base64.
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n) => [n & 255, (n >>> 8) & 255];
const le24 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

// 24 octets → 32 caractères sans « = » : on peut y coller d'autres caractères base64.
export const png = (w, h) => b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IHDR'), ...be32(w), ...be32(h)]);
export const gif = (w, h) => b64([...ascii('GIF89a'), ...le16(w), ...le16(h)]);
// APP0 (JFIF), DHT, puis SOF0 : le lecteur doit sauter les segments qui précèdent.
export const jpeg = (w, h) => b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  0xff, 0xc4, 0, 3, 0, 0xff, 0xc0, 0, 11, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 1, 1, 0x11, 0]);
const riff = (chunk, body) => b64([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), ...le32(body.length), ...body]);
export const webpVP8 = (w, h) => riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h)]);
export const webpVP8L = (w, h) => riff('VP8L', [0x2f, ...le32((w - 1) | ((h - 1) << 14))]);
export const webpVP8X = (w, h) => riff('VP8X', [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
