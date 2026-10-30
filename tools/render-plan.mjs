// 球场包 · 平面剖切图（在 y=1.5 m 处切一刀，把交线画成建筑平面图）
// 用途：核对房间位置/门洞朝向，也给不出"室内截图"时一个能看的东西
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readGLB, primitives } from './glb-read.mjs';

const ROOT = 'D:/异想天开/球场包';
const OUT = path.join(ROOT, '03_预览/平面图');
fs.mkdirSync(OUT, { recursive: true });

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}

const toSRGB = (v) => Math.round(Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)) * 255);

export function renderPlan(glbFile, collidersFile, { xmin, xmax, zmin, zmax, ppm = 10, yCut = 1.5 }) {
  const { json, bin } = readGLB(glbFile);
  const prims = primitives(json, bin);
  const W = Math.round((xmax - xmin) * ppm), H = Math.round((zmax - zmin) * ppm);
  const img = Buffer.alloc(W * H * 3, 255);
  const X = (x) => Math.round((x - xmin) * ppm);
  const Z = (z) => Math.round((z - zmin) * ppm);
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    img[i] = r; img[i + 1] = g; img[i + 2] = b;
  };
  const line = (x0, y0, x1, y1, r, g, b) => {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const n = Math.max(1, Math.max(dx, dy));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      put(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), r, g, b);
      put(Math.round(x0 + (x1 - x0) * t) + 1, Math.round(y0 + (y1 - y0) * t), r, g, b);
    }
  };

  // 1) 几何在 yCut 处的剖切线
  for (const prim of prims) {
    const col = prim.col;
    const n = prim.idx ? prim.idx.length : prim.pos.length / 3;
    for (let i = 0; i < n; i += 3) {
      const v = [0, 1, 2].map((k) => (prim.idx ? prim.idx[i + k] : i + k));
      const P = v.map((k) => [prim.pos[k * 3], prim.pos[k * 3 + 1], prim.pos[k * 3 + 2]]);
      const seg = [];
      for (let e = 0; e < 3; e++) {
        const a = P[e], b = P[(e + 1) % 3];
        const da = a[1] - yCut, db = b[1] - yCut;
        if ((da > 0) !== (db > 0)) {
          const t = da / (da - db);
          seg.push([a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t]);
        }
      }
      if (seg.length === 2) {
        const c = col ? [col[v[0] * 3], col[v[0] * 3 + 1], col[v[0] * 3 + 2]] : [0.5, 0.5, 0.5];
        const r = toSRGB(c[0]), g = toSRGB(c[1]), b = toSRGB(c[2]);
        line(X(seg[0][0]), Z(seg[0][1]), X(seg[1][0]), Z(seg[1][1]), Math.min(200, r), Math.min(200, g), Math.min(200, b));
      }
    }
  }

  // 2) 碰撞盒轮廓（红色），核对几何与碰撞是否一致
  if (collidersFile && fs.existsSync(collidersFile)) {
    const { boxes } = JSON.parse(fs.readFileSync(collidersFile, 'utf8'));
    for (const b of boxes) {
      if (b.kind === 'walkway' || b.kind === 'opening') continue;
      const x0 = X(b.min[0]), x1 = X(b.max[0]), z0 = Z(b.min[2]), z1 = Z(b.max[2]);
      const rr = b.kind === 'room' ? [200, 40, 40] : [235, 150, 150];
      line(x0, z0, x1, z0, ...rr); line(x1, z0, x1, z1, ...rr);
      line(x1, z1, x0, z1, ...rr); line(x0, z1, x0, z0, ...rr);
    }
  }
  return { img, W, H };
}

const TEAMS = [
  ['03_BeijingGuoan', '北京国安'],
  ['15_LiaoningTieren', '辽宁铁人'],
  ['02_ShanghaiShenhua', '上海申花'],
];
for (const [dir, name] of TEAMS) {
  const base = path.join(ROOT, '02_球队球场', dir);
  const glb = path.join(base, fs.readdirSync(base).find((f) => f.endsWith('.glb')));
  const col = path.join(base, 'colliders.json');
  const c = { tag: name + '-全场', xmin: -130, xmax: 130, zmin: -150, zmax: 150, ppm: 5 };
  const { img, W, H } = renderPlan(glb, col, c);
  writePNG(path.join(OUT, c.tag + '.png'), W, H, img);
  console.log('plan', c.tag, W, 'x', H);
}
