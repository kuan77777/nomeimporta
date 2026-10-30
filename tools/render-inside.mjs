// 球场包 · 第一人称/透视渲染（带近平面裁剪），用来检查"从外往里走"有没有内部空间
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readGLB, primitives, materialTexture, imageBuffer, decodePNG } from './glb-read.mjs';
import { montage } from './render.mjs';

const ROOT = 'D:/异想天开/球场包';
const OUT = path.join(ROOT, '03_预览/内部检查');
fs.mkdirSync(OUT, { recursive: true });

const toSRGB = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

// ---- PNG 写 ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}

const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const NEAR = 0.3;

export function renderPerspective(glbFile, { eye, target, w = 960, h = 600, fovDeg = 72, cutY = null }) {
  const { json, bin } = readGLB(glbFile);
  const prims = primitives(json, bin);
  const texCache = new Map();
  const texture = (idx) => { if (!texCache.has(idx)) texCache.set(idx, decodePNG(imageBuffer(json, bin, idx))); return texCache.get(idx); };

  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const f = (h / 2) / Math.tan((fovDeg * Math.PI / 180) / 2);
  const img = Buffer.alloc(w * h * 3, 0);
  for (let i = 0; i < img.length; i += 3) { img[i] = 196; img[i + 1] = 214; img[i + 2] = 228; }
  const zbuf = new Float64Array(w * h).fill(Infinity);

  const project = (p) => [w / 2 + f * p.x / p.z, h / 2 - f * p.y / p.z, p.z];
  const lerp = (a, b, t) => ({
    x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, wy: a.wy + (b.wy - a.wy) * t,
    u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t,
    r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, bl: a.bl + (b.bl - a.bl) * t,
  });

  for (const prim of prims) {
    const texIdx = materialTexture(json, prim.material);
    const tex = texIdx === null ? null : texture(texIdx);
    const n = prim.idx ? prim.idx.length : prim.pos.length / 3;
    for (let i = 0; i < n; i += 3) {
      const poly = [];
      for (let k = 0; k < 3; k++) {
        const v = prim.idx ? prim.idx[i + k] : i + k;
        const wp = [prim.pos[v * 3], prim.pos[v * 3 + 1], prim.pos[v * 3 + 2]];
        const d = sub(wp, eye);
        const c = prim.col ? [prim.col[v * 3], prim.col[v * 3 + 1], prim.col[v * 3 + 2]] : [0.75, 0.75, 0.75];
        poly.push({
          x: dot(d, right), y: dot(d, up), z: dot(d, fwd), wy: wp[1],
          u: prim.uv ? prim.uv[v * 2] : 0, v: prim.uv ? prim.uv[v * 2 + 1] : 0,
          r: c[0], g: c[1], bl: c[2],
        });
      }
      // 水平剖切（剖切模型看内部）
      if (cutY !== null) {
        const out = [];
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k], b = poly[(k + 1) % poly.length];
          const ain = a.wy <= cutY, bin2 = b.wy <= cutY;
          if (ain) out.push(a);
          if (ain !== bin2) out.push(lerp(a, b, (cutY - a.wy) / (b.wy - a.wy)));
        }
        poly.length = 0;
        poly.push(...out);
        if (poly.length < 3) continue;
      }
      // 近平面裁剪
      let clipped = poly;
      const behind = poly.some((p) => p.z < NEAR);
      if (behind) {
        clipped = [];
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k], b = poly[(k + 1) % poly.length];
          const ain = a.z >= NEAR, bin2 = b.z >= NEAR;
          if (ain) clipped.push(a);
          if (ain !== bin2) clipped.push(lerp(a, b, (NEAR - a.z) / (b.z - a.z)));
        }
        if (clipped.length < 3) continue;
      }
      const scr = clipped.map(project);
      // 三角化（扇形）
      for (let k = 1; k + 1 < scr.length; k++) {
        drawTri(scr[0], clipped[0], scr[k], clipped[k], scr[k + 1], clipped[k + 1], tex, w, h, img, zbuf);
      }
    }
  }
  return img;
}

function drawTri(a, av, b, bv, c, cv, tex, w, h, img, zbuf) {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  if (minX > maxX || minY > maxY) return;
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  const flat = tex ? null : [
    Math.round(toSRGB(Math.min(1, (av.r + bv.r + cv.r) / 3)) * 255),
    Math.round(toSRGB(Math.min(1, (av.g + bv.g + cv.g) / 3)) * 255),
    Math.round(toSRGB(Math.min(1, (av.bl + bv.bl + cv.bl) / 3)) * 255),
  ];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = 1 / (w0 / a[2] + w1 / b[2] + w2 / c[2]);
      const idx = y * w + x;
      if (z >= zbuf[idx]) continue;
      zbuf[idx] = z;
      if (tex) {
        const iw = w0 / a[2], jw = w1 / b[2], kw = w2 / c[2];
        const s = (iw + jw + kw) || 1;
        let u = (iw * av.u + jw * bv.u + kw * cv.u) / s;
        let vv = (iw * av.v + jw * bv.v + kw * cv.v) / s;
        u -= Math.floor(u); vv -= Math.floor(vv);
        const tx = Math.min(tex.w - 1, Math.max(0, Math.round(u * (tex.w - 1))));
        const ty = Math.min(tex.h - 1, Math.max(0, Math.round(vv * (tex.h - 1))));
        const o = (ty * tex.w + tx) * 4;
        img[idx * 3] = tex.data[o]; img[idx * 3 + 1] = tex.data[o + 1]; img[idx * 3 + 2] = tex.data[o + 2];
      } else {
        img[idx * 3] = flat[0]; img[idx * 3 + 1] = flat[1]; img[idx * 3 + 2] = flat[2];
      }
    }
  }
}

const CASES = [
  ['03_BeijingGuoan', '01-outside', [0, 1.7, 165], [0, 14, 0], null],
  ['03_BeijingGuoan', '02-gate', [0, 1.7, 118], [0, 5, 94], null],
  ['03_BeijingGuoan', '03-concourse', [-56, 1.7, 86.2], [-24, 2.0, 91.8], null],
  ['03_BeijingGuoan', '04-stairs', [70, 1.9, -2], [74.5, 9, 18], null],
  ['03_BeijingGuoan', '05-upper-gallery', [73.5, 18.9, 34], [73.5, 18.9, -18], null],
  ['03_BeijingGuoan', '06-tunnel', [71, 2.0, 0], [-30, 2.0, 0], null],
  ['03_BeijingGuoan', '07-pitch', [0, 1.7, 30], [0, 10, -70], null],
  ['03_BeijingGuoan', '08-dollhouse-south', [30, 44, 150], [0, 0, 88], 6.5],
  ['03_BeijingGuoan', '09-dollhouse-rooms', [-30, 9.5, 52], [-30, 0.8, 92], 2.6],
];

const tiles = [];
for (const [dir, tag, eye, target, cutY] of CASES) {
  const d = path.join(ROOT, '02_球队球场', dir);
  const glb = path.join(d, fs.readdirSync(d).find((f) => f.endsWith('.glb')));
  const img = renderPerspective(glb, { eye, target, w: 960, h: 600, fovDeg: 72, cutY });
  writePNG(path.join(OUT, `${tag}.png`), 960, 600, img);
  tiles.push(img);
  console.log('rendered', tag);
}
montage(tiles, 2, 960, 600, path.join(OUT, '内部检查-总览.png'));
console.log('done');

