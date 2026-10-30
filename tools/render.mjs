// 球场包 · 纯 Node 软件渲染（z-buffer + 顶点色 + PNG 贴图采样），输出 PNG
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readGLB, primitives, materialTexture, imageBuffer, decodePNG } from './glb-read.mjs';

const ROOT = 'D:/异想天开/球场包';
const OUT = path.join(ROOT, '03_预览');
fs.mkdirSync(OUT, { recursive: true });

// ---------- PNG 写 ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const toSRGB = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

export function renderScene(glbFile, w, h, eyeDir = [1.15, 0.78, 1.5]) {
  const { json, bin } = readGLB(glbFile);
  const prims = primitives(json, bin);
  // 贴图缓存必须按文件隔离：texIndex 只在单个 GLB 内唯一
  const texCache = new Map();
  const texture = (idx) => {
    if (!texCache.has(idx)) texCache.set(idx, decodePNG(imageBuffer(json, bin, idx)));
    return texCache.get(idx);
  };

  // 世界范围
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], p.pos[i + k]); max[k] = Math.max(max[k], p.pos[i + k]);
  }
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 0.62;

  const eye = norm(eyeDir);
  const up = [0, 1, 0];
  const right = norm(cross(up, eye));
  const camUp = norm(cross(eye, right));
  const scale = (Math.min(w, h) * 0.5) / (radius * 1.02);

  const img = Buffer.alloc(w * h * 3, 0);
  for (let i = 0; i < img.length; i += 3) { img[i] = 214; img[i + 1] = 226; img[i + 2] = 236; }
  const zbuf = new Float64Array(w * h).fill(Infinity);
  const light = norm([0.45, 0.82, 0.35]);

  const P = [], C = [], UV = [], TEX = [];
  for (const p of prims) {
    const tex = materialTexture(json, p.material);
    const texImg = tex === null ? null : texture(tex);
    const n = p.idx ? p.idx.length : p.pos.length / 3;
    for (let i = 0; i < n; i += 3) {
      const tri = [];
      const vc = [0, 0, 0];
      const uvs = [];
      for (let k = 0; k < 3; k++) {
        const v = p.idx ? p.idx[i + k] : i + k;
        tri.push([p.pos[v * 3] - center[0], p.pos[v * 3 + 1] - center[1], p.pos[v * 3 + 2] - center[2]]);
        if (texImg) {
          uvs.push([p.uv[v * 2], p.uv[v * 2 + 1]]);
        } else if (p.col) {
          vc[0] += p.col[v * 3]; vc[1] += p.col[v * 3 + 1]; vc[2] += p.col[v * 3 + 2];
        } else {
          vc[0] += 0.8; vc[1] += 0.8; vc[2] += 0.8;
        }
      }
      const nv = norm(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])));
      // 牌匾按 unlit 处理（和 GLB 里的 KHR_materials_unlit 一致），其余按单向光
      const lam = texImg ? 1.0 : Math.abs(dot(nv, light)) * 0.72 + 0.38;
      P.push(tri); C.push([(vc[0] / 3) * lam, (vc[1] / 3) * lam, (vc[2] / 3) * lam]);
      UV.push(uvs); TEX.push(texImg);
    }
  }

  for (let t = 0; t < P.length; t++) {
    const tri = P[t];
    const scr = tri.map((p) => {
      const d = [p[0], p[1], p[2]];
      return [w / 2 + dot(d, right) * scale, h / 2 - dot(d, camUp) * scale, -dot(d, eye)];
    });
    const [a, b, c] = scr;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    if (minX > maxX || minY > maxY) continue;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    const col = C[t];
    const tex = TEX[t];
    const uvs = UV[t];
    let r = 0, gg = 0, bb = 0;
    if (!tex) {
      r = Math.min(255, Math.max(0, Math.round(toSRGB(Math.min(1, col[0])) * 255)));
      gg = Math.min(255, Math.max(0, Math.round(toSRGB(Math.min(1, col[1])) * 255)));
      bb = Math.min(255, Math.max(0, Math.round(toSRGB(Math.min(1, col[2])) * 255)));
    }
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
        const i = y * w + x;
        if (z >= zbuf[i]) continue;
        zbuf[i] = z;
        if (tex) {
          // 逐像素双线性插值 UV + 最近邻采样
          const u = w0 * uvs[0][0] + w1 * uvs[1][0] + w2 * uvs[2][0];
          const vv = w0 * uvs[0][1] + w1 * uvs[1][1] + w2 * uvs[2][1];
          const tx = Math.min(tex.w - 1, Math.max(0, Math.round(u * (tex.w - 1))));
          const ty = Math.min(tex.h - 1, Math.max(0, Math.round(vv * (tex.h - 1))));
          const o = (ty * tex.w + tx) * 4;
          img[i * 3] = tex.data[o]; img[i * 3 + 1] = tex.data[o + 1]; img[i * 3 + 2] = tex.data[o + 2];
        } else {
          img[i * 3] = r; img[i * 3 + 1] = gg; img[i * 3 + 2] = bb;
        }
      }
    }
  }
  return img;
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

export function montage(tiles, cols, tw, th, outFile) {
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * tw, H = rows * th;
  const out = Buffer.alloc(W * H * 3, 250);
  tiles.forEach((t, i) => {
    const ox = (i % cols) * tw, oy = Math.floor(i / cols) * th;
    for (let y = 0; y < th; y++) t.copy(out, ((oy + y) * W + ox) * 3, y * tw * 3, (y + 1) * tw * 3);
  });
  writePNG(outFile, W, H, out);
}

const names = [
  '01_ShanghaiPort', '02_ShanghaiShenhua', '03_BeijingGuoan', '04_ChengduRongcheng',
  '05_ShandongTaishan', '06_Zhejiang', '07_TianjinJinmenTiger', '08_YunnanYukun',
  '09_QingdaoWestCoast', '10_Henan', '11_DalianYingbo', '12_ShenzhenPengCity',
  '13_QingdaoHainiu', '14_WuhanThreeTowns', '15_LiaoningTieren', '16_ChongqingTonglianglong',
];

if (process.argv[1] && process.argv[1].endsWith('render.mjs')) {
  const tiles = [];
  const TW = 520, TH = 380;
  for (const dir of names) {
    const d = path.join(ROOT, '02_球队球场', dir);
    const glb = path.join(d, fs.readdirSync(d).find((f) => f.endsWith('.glb')));
    tiles.push(renderScene(glb, TW, TH));
    console.log('rendered', dir);
  }
  montage(tiles, 4, TW, TH, path.join(OUT, '16队球场-总览.png'));

  for (const dir of ['02_ShanghaiShenhua', '03_BeijingGuoan', '04_ChengduRongcheng', '16_ChongqingTonglianglong']) {
    const d = path.join(ROOT, '02_球队球场', dir);
    const glb = path.join(d, fs.readdirSync(d).find((f) => f.endsWith('.glb')));
    writePNG(path.join(OUT, `${dir.split('_')[1]}-大图.png`), 1100, 760, renderScene(glb, 1100, 760));
  }
  console.log('done');
}
