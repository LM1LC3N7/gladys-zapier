// Generates cover.png (800x534) for gladys-zapier: plain Node, no dependency.
// A house and a chain of steps joined by two arrows, both ways, with a bolt
// on the steps: an event going to a Zap and coming back (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W) * 0.6 + (y / H) * 0.4;
    set(x, y, [20 + 30 * t, 40 + 50 * t, 80 + 60 * t]);
  }
}
/** A rounded rectangle, anti-aliased on its corners. */
const box = (x0, y0, w, h, r, color, alpha = 1) => {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const cx = Math.min(Math.max(x + 0.5, x0 + r), x0 + w - r);
      const cy = Math.min(Math.max(y + 0.5, y0 + r), y0 + h - r);
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = Math.max(0, Math.min(1, r - d + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const white = [255, 255, 255];
const orange = [255, 122, 60];
const deep = [16, 32, 64];
const grey = [175, 186, 204];
// The house on the left.
box(96, 168, 220, 210, 20, [0, 0, 0], 0.25);
box(90, 160, 220, 210, 20, white);
for (let i = 0; i < 90; i += 1) {
  for (let x = 200 - i * 1.2; x <= 200 + i * 1.2; x += 1) set(Math.round(x), 190 + i, deep);
}
box(150, 280, 100, 70, 6, deep);
box(185, 300, 30, 50, 4, grey);
// The steps of a Zap on the right: three blocks, the first with a bolt.
for (const [y, w] of [
  [140, 230],
  [240, 200],
  [340, 170],
]) {
  box(496, y + 6, w, 70, 16, [0, 0, 0], 0.25);
  box(490, y, w, 70, 16, y === 140 ? orange : white);
}
for (let i = 0; i < 26; i += 1) {
  box(525 + Math.round(i * 0.4), 150 + i, 14, 2, 1, white);
  box(519 + Math.round(i * 0.4), 176 + i, 14, 2, 1, white);
}
box(570, 168, 120, 12, 6, white);
box(520, 268, 150, 12, 6, grey);
box(520, 368, 120, 12, 6, grey);
// Two arrows between them: to the Zap (top), back to the house (bottom).
box(340, 222, 100, 14, 7, white);
for (let i = 0; i < 24; i += 1) {
  for (let j = -i; j <= i; j += 1) set(462 - i, 229 + j, white);
}
box(360, 312, 100, 14, 7, orange);
for (let i = 0; i < 24; i += 1) {
  for (let j = -i; j <= i; j += 1) set(338 + i, 319 + j, orange);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
