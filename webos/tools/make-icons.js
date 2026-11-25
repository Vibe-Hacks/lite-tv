// Generates the launcher icons (PNG) with no dependencies: a rounded dark tile, a blue "screen" and a
// white play triangle, drawn with 4x supersampling for smooth edges.  node webos/tools/make-icons.js
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Shapes in unit space [0,1]
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inTriangle = (x, y, [ax, ay], [bx, by], [cx, cy]) => {
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = s(x, y, ax, ay, bx, by), d2 = s(x, y, bx, by, cx, cy), d3 = s(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

function draw(size) {
  const SS = 4, buf = Buffer.alloc(size * size * 4);
  const BG = [16, 20, 24], SCREEN = [47, 111, 176], STAND = [79, 163, 255], WHITE = [255, 255, 255];
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
      let c = null;
      if (inRoundRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.2)) c = BG;
      if (inRoundRect(x, y, 0.14, 0.2, 0.86, 0.68, 0.06)) c = SCREEN;
      if (inTriangle(x, y, [0.43, 0.32], [0.43, 0.56], [0.62, 0.44])) c = WHITE;
      if (inRoundRect(x, y, 0.34, 0.75, 0.66, 0.8, 0.02)) c = STAND;
      if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
    }
    const n = SS * SS, i = (py * size + px) * 4, cov = a / n;
    // un-premultiply so partially covered edge pixels keep the right colour
    buf[i] = cov ? Math.round(r / (a / 255)) : 0; buf[i + 1] = cov ? Math.round(g / (a / 255)) : 0;
    buf[i + 2] = cov ? Math.round(b / (a / 255)) : 0; buf[i + 3] = Math.round(cov);
  }
  return png(size, size, buf);
}

const out = path.join(__dirname, '..', 'app');
fs.writeFileSync(path.join(out, 'icon.png'), draw(80));
fs.writeFileSync(path.join(out, 'largeIcon.png'), draw(130));
console.log('wrote icon.png (80) and largeIcon.png (130)');
