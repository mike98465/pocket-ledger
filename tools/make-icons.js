// 產生 App 圖示 PNG（不需要任何套件）：藍色底＋白色錢包。
// 用法：npm run icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 圓角矩形的有號距離（負值在內）
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const cov = (d, aa) => Math.min(1, Math.max(0, 0.5 - d / aa));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

const TOP = [0x3a, 0x8b, 0xe8];
const BOTTOM = [0x1c, 0x5c, 0xab];
const WHITE = [255, 255, 255];

function pixel(x, y, size) {
  const u = x / size;
  const v = y / size;
  const aa = 1.2 / size;
  let c = mix(TOP, BOTTOM, v); // 滿版底色（iOS 自己會切圓角）
  // 錢包本體
  c = mix(c, WHITE, cov(sdRoundRect(u, v, 0.5, 0.54, 0.27, 0.2, 0.06), aa));
  // 錢包上緣的翻蓋
  c = mix(c, [0xd6, 0xe6, 0xfa], cov(sdRoundRect(u, v, 0.47, 0.335, 0.22, 0.035, 0.03), aa));
  // 扣環（藍色圓點）
  c = mix(c, [0x2a, 0x78, 0xd6], cov(Math.hypot(u - 0.66, v - 0.54) - 0.045, aa));
  return c;
}

mkdirSync('icons', { recursive: true });
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(`icons/${name}`, png(size, pixel));
  console.log('寫入', `icons/${name}`);
}
