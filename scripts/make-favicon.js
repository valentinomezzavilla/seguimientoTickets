// Genera los iconos de la pestana a partir de la geometria del logo.
// Rasteriza a mano (supersampling 4x) y codifica PNG/ICO con zlib de Node,
// para no sumar dependencias solo por esto.
// Uso: npm run favicon   (la fuente vectorial es public/favicon.svg)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 64;               // viewBox del SVG
const R = 1.5;                 // radio de las esquinas redondeadas
const BG_RADIUS = 12;
const NAVY = [0x23, 0x2c, 0x6b];
const GREEN = [0x8c, 0xc6, 0x3f];
const WHITE = [0xff, 0xff, 0xff];

// Mismos poligonos que public/favicon.svg
const SHAPES = [
  { pts: [[29, 5.5], [29, 58.5], [5.5, 32]],     color: NAVY },
  { pts: [[34, 5.5], [34, 23.5], [53, 14]],      color: GREEN },
  { pts: [[34, 40.5], [34, 58.5], [53, 50]],     color: GREEN },
  { pts: [[40.5, 25.5], [40.5, 38.5], [53, 32]], color: NAVY },
];

function insidePolygon(px, py, pts) {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// El poligono "redondeado" es la dilatacion del poligono base por R, que es
// exactamente lo que hace stroke-linejoin=round en el SVG.
function inRoundedPolygon(px, py, pts) {
  if (insidePolygon(px, py, pts)) return true;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    if (distToSegment(px, py, ax, ay, bx, by) <= R) return true;
  }
  return false;
}

function inRoundedRect(px, py, size, radius) {
  if (px < 0 || py < 0 || px > size || py > size) return false;
  const cx = Math.min(Math.max(px, radius), size - radius);
  const cy = Math.min(Math.max(py, radius), size - radius);
  return Math.hypot(px - cx, py - cy) <= radius + 1e-9;
}

// Devuelve RGBA no premultiplicado con alfa por cobertura (supersampling).
function render(px) {
  const SS = 4;
  const scale = SIZE / px;
  const bgRadius = BG_RADIUS;
  const buf = Buffer.alloc(px * px * 4);

  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      let cov = 0;
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS) * scale;
          const uy = (y + (sy + 0.5) / SS) * scale;
          if (!inRoundedRect(ux, uy, SIZE, bgRadius)) continue;
          let color = WHITE;
          for (const s of SHAPES) {
            if (inRoundedPolygon(ux, uy, s.pts)) color = s.color;
          }
          cov++;
          acc[0] += color[0]; acc[1] += color[1]; acc[2] += color[2];
        }
      }
      const i = (y * px + x) * 4;
      const total = SS * SS;
      if (cov === 0) { buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0; continue; }
      buf[i]     = Math.round(acc[0] / cov);
      buf[i + 1] = Math.round(acc[1] / cov);
      buf[i + 2] = Math.round(acc[2] / cov);
      buf[i + 3] = Math.round((cov / total) * 255);
    }
  }
  return buf;
}

// ---- PNG ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, px) {
  const raw = Buffer.alloc(px * (px * 4 + 1));
  for (let y = 0; y < px; y++) {
    raw[y * (px * 4 + 1)] = 0; // filtro None
    rgba.copy(raw, y * (px * 4 + 1) + 1, y * px * 4, (y + 1) * px * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- ICO (entradas PNG, soportado desde Vista) ----
function encodeIco(entries) {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach((e, i) => {
    const o = 6 + i * 16;
    header[o] = e.size >= 256 ? 0 : e.size;
    header[o + 1] = e.size >= 256 ? 0 : e.size;
    header.writeUInt16LE(1, o + 4);   // planos
    header.writeUInt16LE(32, o + 6);  // bpp
    header.writeUInt32LE(e.png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, ...entries.map(e => e.png)]);
}

const out = path.join(__dirname, '..', 'public');
const png = (size) => encodePng(render(size), size);

const targets = { 'favicon-16.png': 16, 'favicon-32.png': 32, 'apple-touch-icon.png': 180 };
for (const [name, size] of Object.entries(targets)) {
  const data = png(size);
  fs.writeFileSync(path.join(out, name), data);
  console.log(`${name.padEnd(22)} ${size}x${size}  ${data.length} bytes`);
}

const ico = encodeIco([16, 32, 48].map(size => ({ size, png: png(size) })));
fs.writeFileSync(path.join(out, 'favicon.ico'), ico);
console.log(`${'favicon.ico'.padEnd(22)} 16/32/48  ${ico.length} bytes`);
