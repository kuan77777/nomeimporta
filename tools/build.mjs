// 球场包 · 16 队球场构建器（Node + three + 自写 GLB 写出）
// 素材：01_源模型/3dassets_club_grounds（CC0）里的草皮/球门/角旗/替补席/记分牌
// 形制：看台为参数化盒体（层数 × 排数 × 进深 × 罩棚），每队一份独立 spec，几何两两不同。
import fs from 'node:fs';
import path from 'node:path';
import { writeGLB } from './glb-lib.mjs';
import { encodePNG } from './glb-read.mjs';
import * as THREE from './three/three.module.min.js';
import { GLTFLoader } from './three/loaders/GLTFLoader.js';
import { OBJLoader } from './three/obj-loader.mjs';

const GAME = 'D:/异想天开/nomeimporta/dist';
const objLoader = new OBJLoader();
const objCache = new Map();
/** 直接调用游戏里的 OBJ 道具（家具/食物/生存物品），按统一色调烘进 GLB */
function bakeOBJ(rel, { x = 0, y = 0, z = 0, rotY = 0, scale = 1, tint = null } = {}) {
  const file = path.join(GAME, 'assets/models', rel + '.obj');
  if (!objCache.has(file)) objCache.set(file, objLoader.parse(fs.readFileSync(file, 'utf8')));
  const src = objCache.get(file);
  const V = new THREE.Vector3();
  const M = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    new THREE.Vector3(scale, scale, scale),
  );
  const col = tint ?? C('#6b5a48');
  const cl = [col.r, col.g, col.b];
  src.traverse((o) => {
    if (!o.isMesh) return;
    o.updateMatrixWorld(true);
    const g = o.geometry;
    const pos = g.attributes.position;
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : pos.count;
    const mm = new THREE.Matrix4().multiplyMatrices(M, o.matrixWorld);
    const nm = new THREE.Matrix3().getNormalMatrix(mm);
    const N = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      const tri = [];
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx[i + k] : i + k;
        V.fromBufferAttribute(pos, vi).applyMatrix4(mm);
        tri.push({ p: [V.x, V.y, V.z], n: [0, 1, 0], c: cl });
      }
      // 用面法线（OBJ 常没有法线）
      const a = tri[0].p, b = tri[1].p, c2 = tri[2].p;
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]];
      let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const L = Math.hypot(nx, ny, nz) || 1;
      for (const v of tri) v.n = [nx / L, ny / L, nz / L];
      tris.push(tri);
    }
  });
}

const loader = new GLTFLoader();
const glbCache = new Map();
async function preloadGLB(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
  glbCache.set(file, gltf.scene);
}
function loadGLBScene(file) {
  const s = glbCache.get(file);
  if (!s) throw new Error('未预载: ' + file);
  return s.clone(true);
}

const ROOT = 'D:/异想天开/球场包';
const SRC = path.join(ROOT, '01_源模型/3dassets_club_grounds');
const OUT = path.join(ROOT, '02_球队球场');
const TEX = path.join(ROOT, '04_队徽与标语');

/** 座席贴图：一个 0.6 m 宽的座位（竖直贴在看台前沿），用 REPEAT 平铺 */
function makeSeatTile(primary) {
  const TW = 64, TH = 64;
  const rgba = new Uint8Array(TW * TH * 4);
  const to255 = (v) => Math.round(Math.min(1, Math.max(0, v)) ** (1 / 2.4) * 255);
  const seat = [to255(primary.r), to255(primary.g), to255(primary.b), 255];
  const dark = [Math.round(seat[0] * 0.55), Math.round(seat[1] * 0.55), Math.round(seat[2] * 0.55), 255];
  const light = [Math.min(255, Math.round(seat[0] * 1.22)), Math.min(255, Math.round(seat[1] * 1.22)), Math.min(255, Math.round(seat[2] * 1.22)), 255];
  const base = [38, 40, 42, 255];
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      let px = base;
      const ix = x - 5, iy = y - 7, iw = TW - 10, ih = TH - 12, r = 7;
      if (ix >= 0 && iy >= 0 && ix < iw && iy < ih) {
        const cx = Math.min(ix, iw - 1 - ix), cy = Math.min(iy, ih - 1 - iy);
        const round = cx < r && cy < r && (r - cx) ** 2 + (r - cy) ** 2 > r * r;
        if (!round) {
          px = seat;
          if (iy < 3) px = light;
          else if (iy > ih - 4) px = dark;
        }
      }
      rgba.set(px, (y * TW + x) * 4);
    }
  }
  return encodePNG(TW, TH, rgba);
}

/** 竖牌匾：给出中心/尺寸/朝向，返回 4 角（观察者视角 左下→右下→右上→左上）与 UV */
function quadFacing(cx, cy, cz, w, h, facing, uRepeat = 1) {
  const y0 = cy - h / 2, y1 = cy + h / 2;
  let corners;
  if (facing === '+z') corners = [[cx - w / 2, y0, cz], [cx + w / 2, y0, cz], [cx + w / 2, y1, cz], [cx - w / 2, y1, cz]];
  else if (facing === '-z') corners = [[cx + w / 2, y0, cz], [cx - w / 2, y0, cz], [cx - w / 2, y1, cz], [cx + w / 2, y1, cz]];
  else if (facing === '+x') corners = [[cx, y0, cz + w / 2], [cx, y0, cz - w / 2], [cx, y1, cz - w / 2], [cx, y1, cz + w / 2]];
  else corners = [[cx, y0, cz - w / 2], [cx, y0, cz + w / 2], [cx, y1, cz + w / 2], [cx, y1, cz - w / 2]];
  return { corners, uv: [[0, 1], [uRepeat, 1], [uRepeat, 0], [0, 0]] };
}

const W = 68, L = 105;          // 场地
const ROW_DEPTH = 1.3;
const ROW_RISE = 1.0;

/**
 * 可进入模式的外壳：四面外墙（南面留门洞）+ 门厅 + 环廊 + 球员通道 + 罩棚桁架 + 广场。
 * 与看台同一套坐标：场地中心为原点，X 横穿（68 m），Z 纵向（105 m），Y 向上。
 */
function addShell(t, pal, d) {
  const { W, L, inset0, decks, rows, tierGap, tierH, topH, backInset } = d;
  const wallT = 1.2;
  const wallH = topH + 3.5;
  const face = pal.stand.clone().lerp(pal.concrete, 0.18).multiplyScalar(1.12);
  const fin = pal.stand.clone().multiplyScalar(0.82);
  const gap = 10;                                  // 环廊进深
  const fx = W / 2 + backInset + gap;              // 外墙中心线（x）
  const fz = L / 2 + backInset + gap;              // 外墙中心线（z）
  const hx = fx + wallT / 2, hz = fz + wallT / 2;
  const gateW = 9.2, gateH = 5.4, half = gateW / 2;

  // 广场（比外墙再往外 20 m）
  box(0, -0.09, 0, 2 * hx + 40, 0.12, 2 * hz + 40, pal.plaza);

  // 南立面：留门洞 —— 左 / 右 / 门楣
  const sideW = hx - half;
  box(-(half + sideW / 2), wallH / 2, fz, sideW, wallH, wallT, face);
  box(half + sideW / 2, wallH / 2, fz, sideW, wallH, wallT, face);
  box(0, (gateH + wallH) / 2, fz, gateW, wallH - gateH, wallT, face);
  // 门洞包边（辅色）
  box(0, gateH + 0.35, fz + wallT / 2 + 0.18, gateW + 2.6, 0.8, 0.6, pal.trim);
  // 北 / 东 / 西 整面
  box(0, wallH / 2, -fz, 2 * hx, wallH, wallT, face);
  box(-fx, wallH / 2, 0, wallT, wallH, 2 * fz, face);
  box(fx, wallH / 2, 0, wallT, wallH, 2 * fz, face);

  // 立面竖向分格（每 8 m 一道）+ 墙裙 + 压顶：让外墙不是一整块平板
  for (let x = -hx + 8; x <= hx - 8; x += 8) {
    for (const sz of [-1, 1]) box(x, wallH / 2, sz * (fz + wallT / 2 + 0.35), 1.1, wallH, 0.55, fin);
  }
  for (let z = -hz + 8; z <= hz - 8; z += 8) {
    for (const sx of [-1, 1]) box(sx * (fx + wallT / 2 + 0.35), wallH / 2, z, 0.55, wallH, 1.1, fin);
  }
  for (const sz of [-1, 1]) {
    box(0, 0.8, sz * (hz - 0.12), 2 * hx + 0.5, 1.6, 0.45, pal.trim);
    box(0, wallH - 0.7, sz * (hz - 0.15), 2 * hx + 0.9, 1.4, 0.7, pal.trim);
  }
  for (const sx of [-1, 1]) {
    box(sx * (hx - 0.12), 0.8, 0, 0.45, 1.6, 2 * hz + 0.5, pal.trim);
    box(sx * (hx - 0.15), wallH - 0.7, 0, 0.7, 1.4, 2 * hz + 0.9, pal.trim);
  }

  // 环廊：地面 + 顶棚（看台外沿 → 外墙）
  const cw = gap + 0.6;
  for (const sz of [-1, 1]) {
    box(0, 0.06, sz * (L / 2 + backInset + gap / 2), 2 * hx - 2 * wallT, 0.12, gap, pal.floor);
    box(0, tierH + 0.15, sz * (L / 2 + backInset + gap / 2), 2 * hx - 2 * wallT, 0.3, cw, pal.concrete);
  }
  for (const sx of [-1, 1]) {
    box(sx * (W / 2 + backInset + gap / 2), 0.06, 0, gap, 0.12, 2 * hz - 2 * wallT, pal.floor);
    box(sx * (W / 2 + backInset + gap / 2), tierH + 0.15, 0, cw, 0.3, 2 * hz - 2 * wallT, pal.concrete);
  }
  // 环廊柱
  for (const sz of [-1, 1]) {
    for (let x = -hx + 7; x <= hx - 7; x += 14) box(x, tierH / 2, sz * (fz - 2.4), 0.7, tierH, 0.7, pal.stand);
  }
  for (const sx of [-1, 1]) {
    for (let z = -hz + 7; z <= hz - 7; z += 14) box(sx * (fx - 2.4), tierH / 2, z, 0.7, tierH, 0.7, pal.stand);
  }

  // 球员通道（西/东各一条）：地面 + 两侧墙 + 顶板，尺寸对齐 roam.js（净宽 5.2 / 净高 4.4）
  for (const sx of [-1, 1]) {
    const x0 = sx * (W / 2 - 0.6), x1 = sx * (W / 2 + backInset + 0.4);
    const cx = (x0 + x1) / 2, len = Math.abs(x1 - x0);
    box(cx, 0.05, 0, len, 0.12, 5.2, pal.floor);
    box(cx, 2.6, -2.85, len, 5.2, 0.4, pal.concrete);
    box(cx, 2.6, 2.85, len, 5.2, 0.4, pal.concrete);
    box(cx, 5.1, 0, len, 0.5, 6.1, pal.concrete);
    // 洞口包边
    box(cx, 2.6, 0, 0.5, 5.4, 6.4, pal.trim);
  }

  // 门厅：两侧墙 + 顶板
  const hallZ0 = L / 2 + backInset, hallZ1 = fz;
  const hallLen = hallZ1 - hallZ0;
  for (const sx of [-1, 1]) {
    box(sx * (half + 0.5), gateH / 2, (hallZ0 + hallZ1) / 2, 0.8, gateH, hallLen, pal.stand);
  }
  box(0, gateH + 0.3, (hallZ0 + hallZ1) / 2, gateW + 1.8, 0.6, hallLen, pal.concrete);

  // 闸机（下载素材）+ 售票亭（下载素材）
  for (const x of [-3.4, -1.1, 1.1, 3.4]) {
    bakeGLB(path.join(SRC, 'tripod-turnstile-b2daf4d7.glb'), { x, y: 0.02, z: fz - 3.2, scale: 1.35 });
  }
  for (const sx of [-1, 1]) {
    bakeGLB(path.join(SRC, 'ticket-booth-e23acd9f.glb'), { x: sx * 10.5, y: 0, z: fz + 7, rotY: Math.PI, scale: 1.3 });
  }
  // 闸机旁的隔离栏
  for (const sx of [-1, 1]) box(sx * 4.6, 0.55, fz - 3.2, 0.12, 1.1, 6.0, pal.steel);

  // 罩棚桁架（把"悬空的板"变成有结构的屋盖）
  if (t.roof !== 'none') {
    const isShell = t.roof === 'shell';
    const roofInner = Math.max(2, inset0 + (decks - 1) * tierGap - 4.5);
    const roofOuter = inset0 + decks * tierGap + 2;
    const roofDepth = isShell ? Math.max(12, roofOuter - roofInner) : Math.max(10, (roofOuter - roofInner) * 0.58);
    const yBeam = topH + 1.35;
    for (const sz of [-1, 1]) {
      for (let x = -W / 2 - roofInner; x <= W / 2 + roofInner; x += 12) {
        box(x, yBeam, sz * (L / 2 + roofInner + roofDepth / 2), 0.7, 0.8, roofDepth, pal.steel);
      }
      box(0, yBeam - 0.6, sz * (L / 2 + roofInner + roofDepth), W + (roofInner + roofDepth) * 2, 0.6, 0.6, pal.steel);
    }
    for (const sx of [-1, 1]) {
      for (let z = -L / 2 - roofInner; z <= L / 2 + roofInner; z += 12) {
        box(sx * (W / 2 + roofInner + roofDepth / 2), yBeam, z, roofDepth, 0.8, 0.7, pal.steel);
      }
      box(sx * (W / 2 + roofInner + roofDepth), yBeam - 0.6, 0, 0.6, 0.6, L + (roofInner + roofDepth) * 2, pal.steel);
    }
  }

  // ---------- 上二层的楼梯 + 上层环廊 + 上层入口（只有两层以上的看台才有） ----------
  const hasUpper = decks >= 2;
  const galY = decks * tierH + 0.35;
  const galW = 3.2;
  const nStep = Math.ceil(galY / 0.5);
  const rise = galY / nStep, going = 0.68;
  const stairLen = hasUpper ? nStep * going : 0;
  if (hasUpper) {
    for (const sz of [-1, 1]) {
      box(0, galY, sz * (fz - galW / 2 - 0.3), 2 * hx - 2 * wallT, 0.3, galW, pal.floor);
      box(0, galY + 0.75, sz * (fz - galW - 0.35), 2 * hx - 2 * wallT, 1.1, 0.12, pal.steel);
    }
    for (const sx of [-1, 1]) {
      box(sx * (fx - galW / 2 - 0.3), galY, 0, galW, 0.3, 2 * hz - 2 * wallT, pal.floor);
      box(sx * (fx - galW - 0.35), galY + 0.75, 0, 0.12, 1.1, 2 * hz - 2 * wallT, pal.steel);
    }
    for (const sx of [-1, 1]) {
      const xC = sx * (fx - 1.7);
      const z0 = 4;
      for (let i = 0; i < nStep; i++) {
        box(xC, ((i + 1) * rise) / 2, z0 + i * going + going / 2, 2.4, (i + 1) * rise, going, pal.concrete);
      }
      box(xC - 1.25 * sx, rise * nStep / 2, z0 + (nStep * going) / 2, 0.1, 1.05, nStep * going, pal.steel);
      addCollider(`stair-${sx > 0 ? 'east' : 'west'}`, [xC - 1.2, 0, z0], [xC + 1.2, galY, z0 + nStep * going], 'stair');
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const zc = sz * 12;
        const xIn = W / 2 + backInset - 1.0, xOut = fx - galW + 0.4;
        box((xIn + xOut) / 2, galY - 0.15, zc, Math.abs(xOut - xIn), 0.3, 3.4, pal.floor);
        box((xIn + xOut) / 2, galY + 0.65, zc - sz * 1.75, Math.abs(xOut - xIn), 1.0, 0.1, pal.steel);
        addCollider(`upper-walk-${sx > 0 ? 'E' : 'W'}${sz > 0 ? 'S' : 'N'}`, [Math.min(xIn, xOut), galY - 0.3, zc - 1.7], [Math.max(xIn, xOut), galY, zc + 1.7], 'walkway');
      }
    }
  }

  // ---------- 门厅闸机 / 售票亭（这些在房间里没有，留在门厅） ----------
  for (const x of [-3.4, -1.1, 1.1, 3.4]) {
    bakeGLB(path.join(SRC, 'tripod-turnstile-b2daf4d7.glb'), { x, y: 0.02, z: fz - 3.2, scale: 1.35 });
  }
  for (const sx of [-1, 1]) {
    bakeGLB(path.join(SRC, 'ticket-booth-e23acd9f.glb'), { x: sx * 10.5, y: 0, z: fz + 7, rotY: Math.PI, scale: 1.3 });
  }

  // ---------- 环廊 / 门厅灯带 ----------
  const led = C('#eaf6ff');
  for (const sz of [-1, 1]) box(0, tierH - 0.4, sz * (L / 2 + backInset + gap - 0.7), 2 * hx - 2 * wallT, 0.18, 0.22, led);
  for (const sx of [-1, 1]) box(sx * (W / 2 + backInset + gap - 0.7), tierH - 0.4, 0, 0.22, 0.18, 2 * hz - 2 * wallT, led);
  box(0, gateH - 0.2, (L / 2 + backInset + fz) / 2, gateW - 1.6, 0.16, 0.22, led);

  // ---------- 碰撞盒 ----------
  addCollider('wall-south', [-hx, 0, fz - wallT / 2], [hx, wallH, fz + wallT / 2], 'wall');
  addCollider('wall-north', [-hx, 0, -fz - wallT / 2], [hx, wallH, -fz + wallT / 2], 'wall');
  addCollider('wall-east', [fx - wallT / 2, 0, -fz], [fx + wallT / 2, wallH, fz], 'wall');
  addCollider('wall-west', [-fx - wallT / 2, 0, -fz], [-fx + wallT / 2, wallH, fz], 'wall');
  addCollider('hall-east', [half, 0, L / 2 + backInset], [half + 0.8, gateH, fz], 'wall');
  addCollider('hall-west', [-half - 0.8, 0, L / 2 + backInset], [-half, gateH, fz], 'wall');
  addCollider('turnstiles', [-4.8, 0, fz - 4.2], [4.8, 1.2, fz - 2.2], 'prop');
  // 看台（四面；东西两侧按通道豁口分段）
  addCollider('stand-south', [-W / 2 - backInset, 0, L / 2 + inset0], [W / 2 + backInset, topH, L / 2 + backInset], 'stand');
  addCollider('stand-north', [-W / 2 - backInset, 0, -L / 2 - backInset], [W / 2 + backInset, topH, -L / 2 - inset0], 'stand');
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? W / 2 + inset0 : -W / 2 - backInset;
    const x1 = sx > 0 ? W / 2 + backInset : -W / 2 - inset0;
    const cuts = [[5.0, 15.0], [-15.0, -5.0]].sort((a, b) => b[0] - a[0]);
    const segs = [[-L / 2 - backInset, cuts[0][0]], [cuts[0][1], cuts[1][0]], [cuts[1][1], L / 2 + backInset]];
    segs.forEach(([a, b], i) => addCollider(`stand-${sx > 0 ? 'east' : 'west'}-${i}`, [x0, 0, a], [x1, topH, b], 'stand'));
  }
  // 环廊地面 / 顶棚
  for (const sz of [-1, 1]) addCollider(`concourse-floor-${sz > 0 ? 'S' : 'N'}`, [-hx, -0.1, sz * (L / 2 + backInset + gap) - (sz > 0 ? gap : 0)], [hx, 0.1, sz * (L / 2 + backInset + gap) + (sz > 0 ? 0 : gap)], 'walkway');
  for (const sx of [-1, 1]) addCollider(`concourse-floor-${sx > 0 ? 'E' : 'W'}`, [sx * (W / 2 + backInset + gap) - (sx > 0 ? gap : 0), -0.1, -hz], [sx * (W / 2 + backInset + gap) + (sx > 0 ? 0 : gap), 0.1, hz], 'walkway');
  // 通道口（在通道所在位置把看台碰撞盒"挖开"的参考）
  for (const sx of [-1, 1]) {
    addCollider(`tunnel-${sx > 0 ? 'E' : 'W'}`, [sx * (W / 2 - 0.6) - (sx > 0 ? 0 : 0), 0, -2.6], [sx * (W / 2 + backInset + 0.4), 4.85, 2.6], 'opening');
  }

  // ---------- 吊顶：把 9 m 高的"仓库"压成 4.8 m 的环廊 ----------
  const ceilY = Math.min(4.8, tierH - 0.6);
  const ceilT = 0.28;
  const soffit = (x0, x1, z0, z1) => {
    box((x0 + x1) / 2, ceilY, (z0 + z1) / 2, Math.abs(x1 - x0), ceilT, Math.abs(z1 - z0), pal.ceiling);
  };
  const inS = L / 2 + backInset, inN = -(L / 2 + backInset);
  soffit(-hx + wallT, hx - wallT, inS, fz - wallT / 2);
  soffit(-hx + wallT, hx - wallT, -fz + wallT / 2, inN);
  for (const sx of [-1, 1]) {
    const xa = sx * (W / 2 + backInset), xb = sx * (fx - wallT / 2);
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
    soffit(lo, hi, 2.5, fz - wallT / 2);
    soffit(lo, hi, -fz + wallT / 2, -34);
    soffit(lo, hi, 32.5, fz - wallT / 2);
  }
  // 吊顶梁 + 灯具
  for (let x = -hx + 10; x <= hx - 10; x += 8) {
    for (const sz of [-1, 1]) {
      box(x, ceilY - 0.25, sz * (L / 2 + backInset + gap / 2), 0.35, 0.5, gap + 0.6, pal.steel);
      box(x, ceilY - 0.34, sz * (L / 2 + backInset + gap / 2), 0.9, 0.06, 0.9, C('#f2f8ff'));
    }
  }
  for (let z = -hz + 10; z <= hz - 10; z += 8) {
    for (const sx of [-1, 1]) {
      box(sx * (W / 2 + backInset + gap / 2), ceilY - 0.25, z, gap + 0.6, 0.5, 0.35, pal.steel);
      box(sx * (W / 2 + backInset + gap / 2), ceilY - 0.34, z, 0.9, 0.06, 0.9, C('#f2f8ff'));
    }
  }

  // ---------- 真房间：四壁 + 门洞 + 吊顶 + 招牌 + 家具 ----------
  const signDir = path.join(ROOT, '04_队徽与标语/signs');
  const signTex = {};
  for (const s of ['toilet', 'changing', 'media', 'kiosk', 'exit', 'security', 'stand', 'firstaid',
    'ticket', 'shop', 'vip', 'press', 'doping', 'storage', 'family', 'home', 'away', 'kitchen']) {
    const f = path.join(signDir, `${s}.png`);
    if (fs.existsSync(f)) signTex[s] = fs.readFileSync(f);
  }

  /** 房间局部坐标 → 世界坐标：u 沿墙宽（-w/2..w/2），v 从门口(0)到后墙(d) */
  const roomFrame = (cx, cz, d, facing) => {
    if (facing === '-z') return { toWorld: (u, v) => [cx + u, cz + d / 2 - v], rotY: 0, axis: 'z' };
    if (facing === '+z') return { toWorld: (u, v) => [cx - u, cz - d / 2 + v], rotY: Math.PI, axis: 'z' };
    if (facing === '-x') return { toWorld: (u, v) => [cx + d / 2 - v, cz + u], rotY: Math.PI / 2, axis: 'x' };
    return { toWorld: (u, v) => [cx - d / 2 + v, cz - u], rotY: -Math.PI / 2, axis: 'x' };
  };

  const ROOM_H = 3.4, WALL_T = 0.2, DOOR_W = 1.8, DOOR_H = 2.35;

  function addRoom(cx, cz, w, d, facing, signName, furnish) {
    const fr = roomFrame(cx, cz, d, facing);
    const along = facing === '+z' || facing === '-z';
    const [bx, bz] = fr.toWorld(0, 0);   // 门口中心
    const [bx2, bz2] = fr.toWorld(0, d); // 后墙中心
    const wall = pal.shopWall, ceil = pal.ceiling, floorC = pal.floor;

    // 后墙 + 两侧墙
    box(...(along ? [bx2, ROOM_H / 2, bz2, w + WALL_T, ROOM_H, WALL_T] : [bx2, ROOM_H / 2, bz2, WALL_T, ROOM_H, w + WALL_T]), wall);
    for (const sgn of [-1, 1]) {
      const [sx2, sz2] = fr.toWorld(sgn * (w / 2), d / 2);
      box(...(along ? [sx2, ROOM_H / 2, sz2, WALL_T, ROOM_H, d] : [sx2, ROOM_H / 2, sz2, d, ROOM_H, WALL_T]), wall);
    }
    // 前墙：左右两段 + 门楣
    const sideW = (w - DOOR_W) / 2;
    for (const sgn of [-1, 1]) {
      const [fx2, fz2] = fr.toWorld(sgn * (DOOR_W / 2 + sideW / 2), 0);
      box(...(along ? [fx2, ROOM_H / 2, fz2, sideW, ROOM_H, WALL_T] : [fx2, ROOM_H / 2, fz2, WALL_T, ROOM_H, sideW]), wall);
    }
    box(...(along ? [bx, (DOOR_H + ROOM_H) / 2, bz, DOOR_W, ROOM_H - DOOR_H, WALL_T] : [bx, (DOOR_H + ROOM_H) / 2, bz, WALL_T, ROOM_H - DOOR_H, DOOR_W]), wall);
    // 地面 + 吊顶
    box(...(along ? [cx, 0.04, cz, w - WALL_T, 0.08, d - WALL_T] : [cx, 0.04, cz, d - WALL_T, 0.08, w - WALL_T]), floorC);
    box(...(along ? [cx, ROOM_H, cz, w + WALL_T, 0.16, d + WALL_T] : [cx, ROOM_H, cz, d + WALL_T, 0.16, w + WALL_T]), ceil);
    // 门框（辅色）+ 门扇（半开）+ 室内灯
    for (const sgn of [-1, 1]) {
      const [px, pz] = fr.toWorld(sgn * (DOOR_W / 2 + 0.1), 0);
      box(...(along ? [px, DOOR_H / 2, pz, 0.2, DOOR_H, WALL_T + 0.1] : [px, DOOR_H / 2, pz, WALL_T + 0.1, DOOR_H, 0.2]), pal.trim);
    }
    box(...(along ? [bx, DOOR_H + 0.1, bz, DOOR_W + 0.4, 0.2, WALL_T + 0.1] : [bx, DOOR_H + 0.1, bz, WALL_T + 0.1, 0.2, DOOR_W + 0.4]), pal.trim);
    {
      const hinge = fr.toWorld(-DOOR_W / 2 + 0.05, 0.03);
      const th = (fr.rotY || 0) + (34 * Math.PI) / 180;
      const lx = hinge[0] + Math.cos(th) * (DOOR_W / 2);
      const lz = hinge[1] - Math.sin(th) * (DOOR_W / 2);
      box(lx, DOOR_H / 2, lz, DOOR_W, DOOR_H, 0.06, pal.door, th);
    }
    {
      const [lx, lz] = fr.toWorld(0, d * 0.55);
      box(lx, ROOM_H - 0.14, lz, 1.5, 0.1, 1.5, C('#eef7ff'));
    }
    const tex = signTex[signName];
    if (tex) {
      const sinW = Math.min(3.4, w * 0.62), sinH = sinW * 160 / 512;
      const [sgx, sgz] = fr.toWorld(0, -0.06);
      const sgY = ROOM_H - 0.55;
      quads.push({ key: `sign_${signName}`, image: tex, ...quadFacing(sgx, sgY, sgz, sinW, sinH, facing) });
    }
    // 家具
    if (furnish) furnish((u, v, prop, opts = {}) => {
      const [px, pz] = fr.toWorld(u, v);
      const rot = (fr.rotY || 0) + (opts.rot || 0);
      if (prop === 'box') {
        box(px, (opts.h || 1) / 2 + (opts.y || 0), pz, opts.w, opts.h, opts.d, opts.color || C('#6d7075'), rot);
        return;
      }
      if (prop.endsWith('.glb')) bakeGLB(path.join(SRC, prop), { x: px, y: 0, z: pz, rotY: rot, scale: opts.scale || 1 });
      else bakeOBJ(prop, { x: px, y: opts.y || 0, z: pz, rotY: rot, scale: opts.scale || 1, tint: opts.tint || C('#5f4f3f') });
    });
    // 房间碰撞（四面墙一个盒，门洞那一面单独留口）
    const [cx1, cz1] = fr.toWorld(-w / 2 - WALL_T, 0);
    const [cx2, cz2] = fr.toWorld(w / 2 + WALL_T, d + WALL_T);
    addCollider(`room-${signName}`, [Math.min(cx1, cx2), 0, Math.min(cz1, cz2)], [Math.max(cx1, cx2), ROOM_H, Math.max(cz1, cz2)], 'room');
  }

  // 房间类型与家具（源包构件 + 现场生成的简单家具；重面数的游戏家具只留给媒体/贵宾两间）
  const WOOD = C('#5f4f3f'), GREY = C('#6d7075'), WHITE = C('#d8d8d2'), DARK = C('#26292d'), STEEL = C('#9aa6b4'), SCREEN = C('#8fb7d8');
  const b = (p, u, v, w, h, d, color = GREY, y = 0, rot = 0) => p(u, v, 'box', { w, h, d, color, y, rot });
  const chair = (p, u, v, rot = 0) => { b(p, u, v, 0.5, 0.45, 0.5, DARK, 0, rot); b(p, u, v, 0.5, 0.5, 0.08, DARK, 0.45, rot); };
  const desk = (p, u, v, w = 1.6, rot = 0) => { b(p, u, v, w, 0.06, 0.8, WOOD, 0.72, rot); b(p, u - w / 2 + 0.08, v, 0.08, 0.72, 0.7, STEEL, 0, rot); b(p, u + w / 2 - 0.08, v, 0.08, 0.72, 0.7, STEEL, 0, rot); };
  const shelf = (p, u, v, w = 1.8, rot = 0) => { for (let i = 0; i < 4; i++) b(p, u, v, w, 0.05, 0.45, WOOD, 0.35 + i * 0.45, rot); b(p, u - w / 2, v, 0.06, 1.9, 0.45, WOOD, 0, rot); b(p, u + w / 2, v, 0.06, 1.9, 0.45, WOOD, 0, rot); };
  const counter = (p, u, v, w = 3.0, rot = 0) => { b(p, u, v, w, 0.95, 0.7, WOOD, 0, rot); b(p, u, v, w, 0.06, 0.78, GREY, 0.95, rot); };
  const tv = (p, u, v, rot = 0) => b(p, u, v, 1.2, 0.7, 0.08, DARK, 1.9, rot);
  const fridge = (p, u, v, rot = 0) => { b(p, u, v, 0.7, 1.8, 0.7, WHITE, 0, rot); b(p, u, v, 0.66, 0.04, 0.72, GREY, 1.0, rot); };
  const sofa = (p, u, v, rot = 0) => { b(p, u, v, 2.0, 0.42, 0.85, C('#3a4048'), 0, rot); b(p, u, v, 2.0, 0.5, 0.2, C('#3a4048'), 0.42, rot); };
  const monitors = (p, u, v) => { for (let i = 0; i < 3; i++) b(p, u + (i - 1) * 0.85, v, 0.75, 0.45, 0.08, SCREEN, 1.85); };

  const FURN = {
    toilet: (p) => {
      p(-1.8, 3.4, 'toilet-stall-4d622ba7.glb'); p(0, 3.4, 'toilet-stall-4d622ba7.glb'); p(1.8, 3.4, 'toilet-stall-4d622ba7.glb');
      p(-2.6, 1.0, 'wash-basin-3be77db0.glb'); p(-2.6, 1.9, 'wash-basin-3be77db0.glb');
      b(p, 2.4, 1.2, 1.2, 0.9, 0.05, C('#dfe6ea'), 1.1);   // 镜子
    },
    changing: (p) => {
      for (let i = 0; i < 4; i++) p(-2.6, 0.9 + i * 0.8, 'open-kit-locker-d10c9b5a.glb');
      p(0.4, 2.4, 'changing-bench-912e20bc.glb'); p(2.6, 3.5, 'shower-column-2aeb12a4.glb');
      b(p, 2.2, 1.2, 1.0, 0.05, 0.6, WOOD, 0.8);
    },
    kiosk: (p) => { counter(p, 0, 3.5, 4.4); p(0, 2.2, 'concession-kiosk-fc162fe3.glb'); fridge(p, -2.5, 3.6); fridge(p, 2.5, 3.6); },
    media: (p) => { p(-1.4, 2.9, 'furniture/Desk'); p(1.4, 2.9, 'furniture/Desk'); chair(p, -1.4, 1.9); chair(p, 1.4, 1.9); b(p, 0, 3.9, 2.6, 1.4, 0.08, WHITE, 1.4); },
    press: (p) => { p(0, 3.0, 'press-desk-54242480.glb'); chair(p, -1.2, 2.0); chair(p, 0, 2.0); chair(p, 1.2, 2.0); b(p, 0, 3.9, 3.4, 2.2, 0.1, C('#2f3a2f'), 1.0); },
    vip: (p) => { p(-0.8, 2.9, 'furniture/Sofa'); p(1.6, 3.0, 'furniture/Table'); tv(p, 1.6, 2.2); b(p, -2.4, 3.6, 1.0, 1.6, 0.4, WOOD, 0); },
    shop: (p) => { shelf(p, -2.0, 3.4); shelf(p, 0, 3.4); shelf(p, 2.0, 3.4); counter(p, 0, 1.4, 3.2); },
    firstaid: (p) => { b(p, 0, 3.2, 2.0, 0.7, 0.9, WHITE); p(-2.3, 1.0, 'first-aid-cabinet-feff73ae.glb'); b(p, 2.6, 3.4, 0.6, 1.6, 0.45, WHITE); chair(p, 1.2, 1.6); },
    security: (p) => { b(p, 0, 2.9, 2.8, 0.9, 0.8, GREY); chair(p, 0, 1.9); monitors(p, 0, 3.9); b(p, -2.6, 3.6, 1.2, 2.0, 0.4, DARK); b(p, 2.6, 3.6, 1.2, 2.0, 0.4, DARK); },
    ticket: (p) => { p(-1.6, 3.0, 'ticket-booth-e23acd9f.glb'); p(1.6, 3.0, 'ticket-booth-e23acd9f.glb'); counter(p, 0, 1.5, 3.6); },
    storage: (p) => { shelf(p, -2.0, 3.5); shelf(p, 0.2, 3.5); shelf(p, 2.4, 3.5); b(p, -1.0, 1.2, 1.0, 0.8, 0.8, C('#8a7a5a')); b(p, 0.6, 1.2, 0.8, 0.6, 0.6, C('#8a7a5a')); },
    doping: (p) => { b(p, 0, 3.2, 2.0, 0.7, 0.9, WHITE); desk(p, -2.2, 1.4, 1.6); chair(p, -2.2, 0.6); fridge(p, 2.6, 3.6); },
    family: (p) => { b(p, -1.0, 2.9, 2.4, 0.85, 0.9, WOOD); chair(p, -2.2, 2.0); chair(p, 0.2, 2.0); tv(p, 2.2, 2.6); },
    kitchen: (p) => { b(p, -1.2, 3.5, 3.0, 0.95, 0.7, GREY); b(p, -1.2, 3.5, 3.0, 0.06, 0.78, STEEL, 0.95); fridge(p, 2.6, 3.6); shelf(p, 2.6, 1.6, 1.2, 0); },
    doctor: (p) => { b(p, 0, 3.2, 2.0, 0.7, 0.9, WHITE); desk(p, -2.2, 1.5, 1.4); chair(p, -1.0, 1.5); b(p, 2.6, 3.4, 0.6, 1.8, 0.45, WHITE); },
    office: (p) => { desk(p, 0, 3.2, 2.2); chair(p, 0, 2.2); shelf(p, -2.6, 3.6, 1.2); chair(p, 2.4, 1.4); },
  };

  const place = (facing, slots) => {
    for (const [p0, typeName] of slots) {
      const cx2 = facing === '-z' || facing === '+z' ? p0 : (facing === '-x' ? fx - wallT / 2 - 0.1 - 2.1 : -fx + wallT / 2 + 0.1 + 2.1);
      const cz2 = facing === '-z' ? fz - wallT / 2 - 0.1 - 2.1 : facing === '+z' ? -fz + wallT / 2 + 0.1 + 2.1 : p0;
      addRoom(cx2, cz2, 6.4, 4.2, facing, typeName, FURN[typeName]);
    }
  };

  // 房间沿周长自动排布：可用长度按 stadium 大小算，楼梯段留空，类型按循环表分配
  const S_TYPES = ['ticket', 'security', 'shop', 'media', 'kiosk', 'toilet', 'firstaid', 'storage', 'shop', 'kiosk', 'toilet', 'security'];
  const N_TYPES = ['family', 'storage', 'vip', 'press', 'office', 'kiosk', 'family', 'shop', 'doctor', 'kitchen', 'storage', 'office'];
  const E_TYPES = ['home', 'doping', 'changing', 'storage', 'kiosk', 'toilet', 'firstaid', 'security', 'office', 'doctor'];
  const W_TYPES = ['away', 'doping', 'changing', 'storage', 'kiosk', 'toilet', 'doctor', 'kitchen', 'shop', 'office'];
  const pitch = 8, halfRoom = 3.2;
  const maxX = hx - 10, maxZ = hz - 10;
  const xs = [];
  for (let x = 16; x + halfRoom <= maxX; x += pitch) xs.push(x);
  const zs = [];
  for (let z = 16; z + halfRoom <= maxZ; z += pitch) zs.push(z);
  // 楼梯占用的东/西段（z 从 4 到 4+stairLen）
  const zsFree = zs.filter((z) => !hasUpper || z > 4 + stairLen + 3);

  const south = [];
  xs.forEach((x, i) => { south.push([x, S_TYPES[i % S_TYPES.length]]); south.push([-x, S_TYPES[(i + 6) % S_TYPES.length]]); });
  const north = [];
  xs.forEach((x, i) => { north.push([x, N_TYPES[i % N_TYPES.length]]); north.push([-x, N_TYPES[(i + 5) % N_TYPES.length]]); });
  const east = zsFree.map((z, i) => [z, E_TYPES[i % E_TYPES.length]]);
  const west = zsFree.map((z, i) => [z, W_TYPES[i % W_TYPES.length]]);
  east.forEach(([z]) => { /* 南侧对称也排 */ });
  const eastAll = [...east, ...east.map(([z, tp]) => [-z, tp])];
  const westAll = [...west, ...west.map(([z, tp]) => [-z, tp])];

  place('-z', south);
  place('+z', north);
  place('-x', eastAll);
  place('+x', westAll);
  // 通道口标识（朝环廊一侧，走进来就能看到）
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tex = signTex.stand;
      if (tex) quads.push({ key: 'sign_stand', image: tex, ...quadFacing(sx * (W / 2 + backInset + 1.2), 4.0, sz * 12, 2.6, 0.75, sz > 0 ? '+z' : '-z') });
    }
    const tex = signTex.stand;
    if (tex) quads.push({ key: 'sign_stand', image: tex, ...quadFacing(sx * (W / 2 + backInset + 1.2), 4.2, 0, 3.0, 0.85, sx > 0 ? '+x' : '-x') });
  }
  // 出口标识（门厅）
  if (signTex.exit) {
    quads.push({ key: 'sign_exit', image: signTex.exit, ...quadFacing(0, gateH - 1.0, fz - 0.8, 3.0, 0.9, '-z') });
  }

  // 家具：垃圾桶 / 长椅 / 排队栏杆
  for (let x = -hx + 12; x <= hx - 12; x += 7) {
    box(x, 0.45, fz - 3.2, 0.45, 0.9, 0.45, pal.steel);
    box(x + 3.5, 0.24, fz - 3.6, 1.9, 0.42, 0.5, pal.shopWall);
  }
  for (const sx of [-1, 1]) {
    for (let z = -hz + 12; z <= hz - 12; z += 7) {
      box(sx * (fx - 3.2), 0.45, z, 0.45, 0.9, 0.45, pal.steel);
      box(sx * (fx - 3.6), 0.24, z + 3.5, 0.5, 0.42, 1.9, pal.shopWall);
    }
  }
  // 闸机前后排队栏杆
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = fz - 6 - i * 2.2;
      box(sx * 4.8, 0.5, z, 0.08, 1.0, 0.08, pal.steel);
    }
  }

  // ---------- 场边广告板 ----------
  const adH = 0.95, adT = 0.16, adOff = 1.6;
  const seg = 4;
  for (let x = -(W / 2 + adOff); x < W / 2 + adOff; x += seg) {
    const c = (Math.floor((x + 100) / seg) % 2) ? pal.seat : pal.trim;
    for (const sz of [-1, 1]) box(x + seg / 2, adH / 2, sz * (L / 2 + adOff), seg * 0.96, adH, adT, c);
  }
  for (let z = -(L / 2 + adOff); z < L / 2 + adOff; z += seg) {
    const c = (Math.floor((z + 100) / seg) % 2) ? pal.seat : pal.trim;
    for (const sx of [-1, 1]) box(sx * (W / 2 + adOff), adH / 2, z + seg / 2, adT, adH, seg * 0.96, c);
  }

  // ---------- 观众（低模块） ----------
  if (crowdRows.length) {
    const shirt = [pal.seat, pal.trim, C('#20242a'), C('#3a4048'), C('#5a4a4a'), C('#c8ccd0')];
    let placed = 0;
    const target = 620;
    let guard = 0;
    while (placed < target && guard < target * 12) {
      guard++;
      const row = crowdRows[(Math.random() * crowdRows.length) | 0];
      const t = row.from + Math.random() * (row.to - row.from);
      const c = shirt[(Math.random() * shirt.length) | 0];
      const s = 0.9 + Math.random() * 0.25;
      if (row.axis === 'z') box(t, row.y, row.at, 0.38 * s, 0.62 * s, 0.34, c);
      else box(row.at, row.y, t, 0.34, 0.62 * s, 0.38 * s, c);
      placed++;
    }
  }

  // 队名 / 队徽 在立面上的位置（门洞上方）
  const nameW = Math.min(38, 2 * hx * 0.42);
  const nameH = nameW * 320 / 2048;
  const nameY = gateH + 2.6 + nameH / 2;
  const emSize = 10;
  const emY = nameY + nameH / 2 + 1.6 + emSize / 2;
  // 队徽底板：白底 + 队色边框（游戏里的 kit 徽章是白底 PNG，垫一块白板才像门头招牌）
  box(0, emY, fz + wallT / 2 + 0.62, emSize + 1.5, emSize + 1.5, 0.16, C('#f2f1ea'));
  for (const s2 of [-1, 1]) {
    box(0, emY + s2 * (emSize / 2 + 0.75), fz + wallT / 2 + 0.72, emSize + 1.9, 0.28, 0.2, pal.trim);
    box(s2 * (emSize / 2 + 0.75), emY, fz + wallT / 2 + 0.72, 0.28, emSize + 1.9, 0.2, pal.trim);
  }
  return {
    name: { y: nameY, z: fz + wallT / 2 + 0.8, w: nameW, h: nameH },
    emblem: { y: emY, z: fz + wallT / 2 + 0.8, size: emSize },
    gate: { w: gateW, h: gateH, z: fz },
  };
}

// ── 工具：颜色（THREE.Color 内部是 linear-sRGB，写入 COLOR_0 一致）
const C = (hex) => new THREE.Color(hex);
const shade = (c, dl, ds = 0) => {
  const o = c.clone();
  const hsl = { h: 0, s: 0, l: 0 };
  o.getHSL(hsl);
  o.setHSL(hsl.h, Math.max(0.02, Math.min(0.98, hsl.s + ds)), Math.max(0.02, Math.min(0.98, hsl.l + dl)));
  return o;
};

const tris = [];
const quads = [];
const colliders = [];
const crowdRows = [];
const addCollider = (name, min, max, kind) => colliders.push({ name, kind, min, max });
function pushTri(a, b, c, color) {
  const p0 = new THREE.Vector3(...a), p1 = new THREE.Vector3(...b), p2 = new THREE.Vector3(...c);
  const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
  if (n.lengthSq() < 1e-12) return;
  n.normalize();
  const nr = [n.x, n.y, n.z], cl = [color.r, color.g, color.b];
  tris.push([{ p: a, n: nr, c: cl }, { p: b, n: nr, c: cl }, { p: c, n: nr, c: cl }]);
}

/** 轴对齐盒子：中心 (x,y,z)，尺寸 (w,h,d)，可绕 Y 旋转 rotY */
function box(x, y, z, w, h, d, color, rotY = 0) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const corners = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz],
    [-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz],
  ].map(([a, b, c]) => {
    const ca = Math.cos(rotY), sa = Math.sin(rotY);
    return [x + a * ca + c * sa, y + b, z - a * sa + c * ca];
  });
  const q = [
    [0, 1, 2, 3], [4, 7, 6, 5],
    [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0],
  ];
  for (const [a, b, c, d] of q) {
    pushTri(corners[a], corners[b], corners[c], color);
    pushTri(corners[a], corners[c], corners[d], color);
  }
}

function cyl(x, y, z, r, h, color, seg = 8) {
  const top = [], bot = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    top.push([x + Math.cos(a) * r, y + h, z + Math.sin(a) * r]);
    bot.push([x + Math.cos(a) * r, y, z + Math.sin(a) * r]);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    pushTri(bot[i], bot[j], top[j], color);
    pushTri(bot[i], top[j], top[i], color);
  }
}

/** 把下载的 GLB 摊平成三角形，可整体平移/旋转/缩放 */
function bakeGLB(file, { x = 0, y = 0, z = 0, rotY = 0, scale = 1, tint = null } = {}) {
  const scene = loadGLBScene(file);
  scene.updateMatrixWorld(true);
  const M = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    new THREE.Vector3(scale, scale, scale),
  );
  const V = new THREE.Vector3();
  const N = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const pos = g.attributes.position, nrm = g.attributes.normal;
    const col = (tint ?? o.material.color).clone();
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : pos.count;
    // 注意：源 GLB 是 KHR_mesh_quantization（Int16 normalized），
    // 不能对 geometry 直接 applyMatrix4（会写回 Int16 截断），必须逐顶点做矩阵变换。
    const mm = new THREE.Matrix4().multiplyMatrices(M, o.matrixWorld);
    const nm = new THREE.Matrix3().getNormalMatrix(mm);
    const cl = [col.r, col.g, col.b];
    for (let i = 0; i < n; i += 3) {
      const tri = [];
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx[i + k] : i + k;
        V.fromBufferAttribute(pos, vi).applyMatrix4(mm);
        let nn;
        if (nrm) { N.fromBufferAttribute(nrm, vi).applyMatrix3(nm).normalize(); nn = [N.x, N.y, N.z]; }
        else nn = [0, 1, 0];
        tri.push({ p: [V.x, V.y, V.z], n: nn, c: cl });
      }
      tris.push(tri);
    }
  });
}

// ── 16 队（容量/配色取自 dist/game/data/football-index.js；主场取自球衣包 Teams.csv）
export const TEAMS = [
  { no: 1, cn: '上海海港', en: 'ShanghaiPort', club: 'C231', cap: 37000, primary: '#C8102E', secondary: '#FFFFFF', venue: '上海浦东足球场', tier: 'B', decks: 1, rows: 6, inset: 8, roof: 'none', lights: 4, towers: 1 },
  { no: 2, cn: '上海申花', en: 'ShanghaiShenhua', club: 'C232', cap: 72000, primary: '#003DA5', secondary: '#FFFFFF', venue: '上海体育场', tier: 'S', decks: 3, rows: 9, inset: 8, roof: 'shell', lights: 4, towers: 1 },
  { no: 3, cn: '北京国安', en: 'BeijingGuoan', club: 'C234', cap: 68000, primary: '#00703C', secondary: '#FFFFFF', venue: '北京工人体育场', tier: 'A+', decks: 2, rows: 9, inset: 8.5, roof: 'partial', lights: 4, towers: 1, interior: true },
  { no: 4, cn: '成都蓉城', en: 'ChengduRongcheng', club: 'C233', cap: 50000, primary: '#E4002B', secondary: '#FFFFFF', venue: '成都凤凰山体育公园', tier: 'A', decks: 2, rows: 7, inset: 11, roof: 'partial', lights: 4, towers: 1 },
  { no: 5, cn: '山东泰山', en: 'ShandongTaishan', club: 'C235', cap: 56808, primary: '#E86A10', secondary: '#FFFFFF', venue: '济南奥体中心', tier: 'A', decks: 2, rows: 8, inset: 9.5, roof: 'partial', lights: 4, towers: 0 },
  { no: 6, cn: '浙江', en: 'Zhejiang', club: 'C237', cap: 52672, primary: '#1B4F9C', secondary: '#FFFFFF', venue: '杭州黄龙体育中心', tier: 'A', decks: 2, rows: 7, inset: 10.5, roof: 'partial', lights: 4, towers: 0 },
  { no: 7, cn: '天津津门虎', en: 'TianjinJinmenTiger', club: 'C236', cap: 37000, primary: '#1B3F8B', secondary: '#FFFFFF', venue: '天津团泊足球场', tier: 'B', decks: 1, rows: 6, inset: 8.5, roof: 'none', lights: 4, towers: 0 },
  { no: 8, cn: '云南玉昆', en: 'YunnanYukun', club: 'C242', cap: 30300, primary: '#CE1126', secondary: '#F2C200', venue: '玉溪高原体育运动中心', tier: 'B', decks: 1, rows: 5, inset: 9, roof: 'none', lights: 4, towers: 1 },
  { no: 9, cn: '青岛西海岸', en: 'QingdaoWestCoast', club: 'C238', cap: 30000, primary: '#0E4C92', secondary: '#FFD100', venue: '青岛西海岸大学城体育场', tier: 'B', decks: 1, rows: 5, inset: 9.5, roof: 'none', lights: 2, towers: 0 },
  { no: 10, cn: '河南', en: 'Henan', club: 'C240', cap: 29860, primary: '#D71920', secondary: '#0E7A3C', venue: '郑州航海体育场', tier: 'B', decks: 1, rows: 5, inset: 10, roof: 'none', lights: 2, towers: 0 },
  { no: 11, cn: '大连英博', en: 'DalianYingbo', club: 'C243', cap: 63000, primary: '#1D4E9E', secondary: '#FFFFFF', venue: '大连梭鱼湾足球场', tier: 'A+', decks: 2, rows: 8, inset: 9, roof: 'partial', lights: 4, towers: 1 },
  { no: 12, cn: '深圳新鹏城', en: 'ShenzhenPengCity', club: 'C241', cap: 45000, primary: '#C8102E', secondary: '#FFFFFF', venue: '深圳宝安体育场', tier: 'A', decks: 2, rows: 6, inset: 12, roof: 'partial', lights: 4, towers: 0 },
  { no: 13, cn: '青岛海牛', en: 'QingdaoHainiu', club: 'C244', cap: 50000, primary: '#0B4EA2', secondary: '#F2C200', venue: '青岛天泰体育场', tier: 'A', decks: 2, rows: 6, inset: 11.5, roof: 'none', lights: 4, towers: 0 },
  { no: 14, cn: '武汉三镇', en: 'WuhanThreeTowns', club: 'C239', cap: 56201, primary: '#0047A0', secondary: '#FFFFFF', venue: '武汉体育中心', tier: 'A', decks: 2, rows: 7, inset: 10, roof: 'partial', lights: 4, towers: 0 },
  { no: 15, cn: '辽宁铁人', en: 'LiaoningTieren', club: 'C247', cap: 19600, primary: '#B02E2E', secondary: '#F4F5F7', venue: '沈阳奥体中心', tier: 'C', decks: 1, rows: 4, inset: 7, roof: 'none', lights: 2, towers: 1 },
  { no: 16, cn: '重庆铜梁龙', en: 'ChongqingTonglianglong', club: 'C248', cap: 20000, primary: '#B02E2E', secondary: '#F4F5F7', venue: '重庆奥体中心', tier: 'C', decks: 1, rows: 4, inset: 7.5, roof: 'none', lights: 2, towers: 0 },
];

for (const t of TEAMS) t.interior = true;   // 16 队全部开室内

function buildOne(t) {
  tris.length = 0;
  colliders.length = 0;
  crowdRows.length = 0;
  quads.length = 0;
  const primary = C(t.primary), secondary = C(t.secondary);
  const isNearWhite = secondary.getHSL({ h: 0, s: 0, l: 0 }).l > 0.86;
  const accent = isNearWhite ? secondary.clone().lerp(primary, 0.45) : secondary.clone();
  const pal = {
    seat: shade(primary, 0.12, -0.05),
    stand: shade(primary, -0.18, -0.05),
    roof: t.roof === 'shell' ? shade(accent, -0.26, -0.05) : shade(primary, -0.32, -0.02),
    trim: accent.clone(),
    concrete: C('#8f9188'),
    steel: C('#9aa6b4'),
    asphalt: C('#4a4f55'),
    floor: C('#a8a89e'),
    plaza: C('#7c7f80'),
    ceiling: C('#3f4347'),
    shopWall: C('#8b8d88'),
    door: C('#2a2d31'),
  };

  const rows = t.rows, decks = t.decks, inset0 = t.inset;
  const tierGap = rows * ROW_DEPTH;
  const tierH = rows * ROW_RISE;

  // 场地底板（广场）
  box(0, -0.08, 0, W + 2 * inset0 + decks * tierGap * 2 + 14, 0.12, L + 2 * inset0 + decks * tierGap * 2 + 14, pal.asphalt);

  // 下载素材：草皮 + 球门 + 角旗 + 替补席 + 记分牌
  bakeGLB(path.join(SRC, 'full-marked-pitch-6ecdec76.glb'));
  bakeGLB(path.join(SRC, 'full-size-goal-08c07f03.glb'), { z: -52.5 });
  bakeGLB(path.join(SRC, 'full-size-goal-08c07f03.glb'), { z: 52.5, rotY: Math.PI });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    bakeGLB(path.join(SRC, 'corner-flag-65953ad0.glb'), { x: sx * 34, z: sz * 52.5 });
  }
  for (const sx of [-1, 1]) {
    bakeGLB(path.join(SRC, 'dugout-shelter-ea708920.glb'), { x: sx * (W / 2 + 4.5), z: sx * 10, rotY: sx > 0 ? -Math.PI / 2 : Math.PI / 2, scale: 1.6 });
  }

  // 看台：每层若干排盒体 + 座席条
  // 可进入模式：在西/东看台下方挖两条通道（vomitory），低处的排要断开
  const TUNNELS = t.interior
    ? [
      { side: -1, z: 0, half: 2.6, y0: -1, y1: 4.85 },
      { side: 1, z: 0, half: 2.6, y0: -1, y1: 4.85 },
      { side: -1, z: 12, half: 1.7, y0: 15.4, y1: 18.6 },
      { side: 1, z: 12, half: 1.7, y0: 15.4, y1: 18.6 },
      { side: -1, z: -12, half: 1.7, y0: 15.4, y1: 18.6 },
      { side: 1, z: -12, half: 1.7, y0: 15.4, y1: 18.6 },
    ]
    : [];
  const seatTile = t.interior ? makeSeatTile(pal.seat) : null;
  for (let d = 0; d < decks; d++) {
    const inset = inset0 + d * tierGap;
    const baseY = d * tierH;
    for (let r = 0; r < rows; r++) {
      const insetR = inset + r * ROW_DEPTH;
      const y = baseY + (r + 0.5) * ROW_RISE;
      const rowY0 = baseY + r * ROW_RISE;
      const rowY1 = rowY0 + ROW_RISE;
      const wEnd = W + insetR * 2;
      const dSide = L + insetR * 2;
      const seatH = t.interior ? 0.55 : 0.14;
      const seatY = t.interior ? y + ROW_RISE / 2 + seatH / 2 : y + ROW_RISE / 2 - 0.07;
      const standColor = t.interior ? pal.concrete : pal.stand;
      for (const sz of [-1, 1]) {
        box(0, y, sz * (L / 2 + insetR), wEnd, ROW_RISE, ROW_DEPTH, standColor);
        box(0, seatY, sz * (L / 2 + insetR), wEnd * 0.985, seatH, ROW_DEPTH * 0.8, pal.seat);
        if (seatTile) {
          const zFace = sz * (L / 2 + insetR) - sz * ROW_DEPTH * 0.4;
          quads.push({ key: `seat_${t.en}`, image: seatTile, ...quadFacing(0, seatY, zFace, wEnd * 0.985, seatH, sz > 0 ? '-z' : '+z', wEnd / 0.6) });
        }
        if (t.interior && d === 0) crowdRows.push({ axis: 'z', at: sz * (L / 2 + insetR), from: -wEnd / 2 + 1, to: wEnd / 2 - 1, y: seatY + 0.32 });
      }
      for (const sx of [-1, 1]) {
        // 把这一排上所有"通道豁口"减掉（下层通道 + 上层入口）
        let segs = [[-(L / 2 + insetR), L / 2 + insetR]];
        for (const tn of TUNNELS) {
          if (tn.side !== sx) continue;
          if (!(rowY1 > tn.y0 && rowY0 < tn.y1)) continue;
          const next = [];
          for (const [a, b] of segs) {
            const c = Math.max(a, tn.z - tn.half), d2 = Math.min(b, tn.z + tn.half);
            if (d2 <= c) { next.push([a, b]); continue; }
            if (c - a > 0.2) next.push([a, c]);
            if (b - d2 > 0.2) next.push([d2, b]);
          }
          segs = next;
        }
        for (const [a, b] of segs) {
          const cx = sx * (W / 2 + insetR), cz = (a + b) / 2, len = b - a;
          box(cx, y, cz, ROW_DEPTH, ROW_RISE, len, standColor);
          box(cx, seatY, cz, ROW_DEPTH * 0.8, seatH, len * 0.985, pal.seat);
          if (seatTile) {
            const xFace = cx - sx * ROW_DEPTH * 0.4;
            quads.push({ key: `seat_${t.en}`, image: seatTile, ...quadFacing(xFace, seatY, cz, len * 0.985, seatH, sx > 0 ? '-x' : '+x', len / 0.6) });
          }
          if (t.interior && d === 0 && b - a > 2) crowdRows.push({ axis: 'x', at: cx, from: a + 1, to: b - 1, y: seatY + 0.32 });
        }
      }
    }
    // 层间环廊 + 灯带
    const ringInset = inset + rows * ROW_DEPTH;
    const ringW = W + ringInset * 2, ringD = L + ringInset * 2;
    for (const sz of [-1, 1]) box(0, baseY + tierH + 0.9, sz * (L / 2 + ringInset), ringW, 1.8, 2.4, pal.stand);
    for (const sx of [-1, 1]) box(sx * (W / 2 + ringInset), baseY + tierH + 0.9, 0, 2.4, 1.8, ringD, pal.stand);
    if (d > 0) {
      for (const sz of [-1, 1]) box(0, baseY + tierH + 1.9, sz * (L / 2 + ringInset + 1.0), ringW * 0.995, 0.85, 0.24, pal.trim);
      for (const sx of [-1, 1]) box(sx * (W / 2 + ringInset + 1.0), baseY + tierH + 1.9, 0, 0.24, 0.85, ringD * 0.995, pal.trim);
    }
  }

  const topH = decks * tierH + 0.6;
  const topInset = inset0 + (decks - 1) * tierGap;
  const roofOuter = inset0 + decks * tierGap + 2;
  const roofInner = Math.max(2, topInset - 4.5);

  if (t.roof === 'shell' || t.roof === 'partial') {
    const isShell = t.roof === 'shell';
    const depth = isShell ? Math.max(12, roofOuter - roofInner) : Math.max(10, (roofOuter - roofInner) * 0.58);
    const y = topH + 2.0;
    const thick = isShell ? 1.2 : 0.6;
    for (const sz of [-1, 1]) {
      box(0, y, sz * (L / 2 + roofInner + depth / 2), W + (roofInner + depth) * 2, thick, depth, pal.roof);
    }
    for (const sx of [-1, 1]) {
      box(sx * (W / 2 + roofInner + depth / 2), y, 0, depth, thick, L + (roofInner + depth) * 2, pal.roof);
    }
    // 罩棚外沿压边
    for (const sz of [-1, 1]) box(0, y - 0.5, sz * (L / 2 + roofInner + depth), W + (roofInner + depth) * 2 + 1.2, 0.9, 0.9, pal.trim);
    for (const sx of [-1, 1]) box(sx * (W / 2 + roofInner + depth), y - 0.5, 0, 0.9, 0.9, L + (roofInner + depth) * 2 + 1.2, pal.trim);
    if (isShell) {
      // 壳顶内环灯带
      const rIn = L / 2 + roofInner + 2.2;
      for (const sz of [-1, 1]) box(0, y - 0.35, sz * rIn, W + (roofInner + 2.2) * 2, 0.5, 0.35, pal.trim);
      for (const sx of [-1, 1]) box(sx * (W / 2 + roofInner + 2.2), y - 0.35, 0, 0.35, 0.5, L + (roofInner + 2.2) * 2, pal.trim);
    }
  }

  // 灯塔
  const mastOuter = inset0 + decks * tierGap + 8;
  const corners = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx, sz]);
  const mastList = t.lights >= 4 ? corners : corners.slice(0, 2);
  for (const [sx, sz] of mastList) {
    const mx = sx * (t.interior ? W / 2 + mastOuter + 18 : W / 2 + mastOuter);
    const mz = sz * (t.interior ? L / 2 + mastOuter + 18 : L / 2 + mastOuter);
    cyl(mx, 0, mz, 0.45, 30, pal.steel, 8);
    box(mx, 30.6, mz, 7, 2.2, 1.2, C('#f2f6ff'), Math.atan2(-mx, -mz));
  }

  // 四角塔楼（形制变体）
  if (t.towers) {
    for (const [sx, sz] of corners) {
      const off = t.interior ? inset0 + decks * tierGap + 16 : inset0 + decks * tierGap + 3;
      const tx = sx * (W / 2 + off), tz = sz * (L / 2 + off);
      box(tx, (topH + 6) / 2, tz, 4.2, topH + 6, 4.2, pal.stand);
      box(tx, topH + 6.6, tz, 5.0, 1.4, 5.0, pal.trim);
    }
  }

  const imgName = fs.readFileSync(path.join(TEX, `${t.en}_name.png`));
  const imgSlogan = fs.readFileSync(path.join(TEX, `${t.en}_slogan.png`));
  const imgEmblem = fs.readFileSync(path.join(TEX, `${t.en}_emblem.png`));
  // 队徽优先用游戏里现成的 kit 徽章（dist/assets/kits/*_crest.png），没有才退回自制圆徽
  const snake = t.en.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  const crestPath = path.join(GAME, 'assets/kits', `${snake}_crest.png`);
  const imgCrest = fs.existsSync(crestPath) ? fs.readFileSync(crestPath) : imgEmblem;

  if (t.interior) {
    // 可进入模式：四面外墙 + 门厅 + 环廊 + 通道 + 桁架 + 广场
    const shell = addShell(t, pal, { W, L, inset0, decks, rows, tierGap, tierH, topH, backInset: inset0 + decks * tierGap });
    quads.push({ key: `${t.en}_name`, image: imgName, ...quadFacing(0, shell.name.y, shell.name.z, shell.name.w, shell.name.h, '+z') });
    quads.push({ key: `${t.en}_crest`, image: imgCrest, ...quadFacing(0, shell.emblem.y, shell.emblem.z, shell.emblem.size, shell.emblem.size, '+z') });
  } else {
    // 外景模式：只有南面一块立面（原来的做法）
    const gateZ = L / 2 + roofOuter + 6;
    const backInset0 = inset0 + decks * tierGap;
    const facadeW = Math.min(72, (W + 2 * backInset0) * 0.5);
    const facadeH = topH + 8;
    box(0, facadeH / 2, gateZ + 0.5, facadeW, facadeH, 1.2, pal.stand);
    box(-3.4, 3.2, gateZ - 0.9, 1.6, 6.4, 1.6, pal.stand);
    box(3.4, 3.2, gateZ - 0.9, 1.6, 6.4, 1.6, pal.stand);
    box(0, 6.9, gateZ - 0.9, 8.8, 1.6, 2.0, pal.trim);
    const nameW = facadeW - 6;
    const nameH = nameW * 320 / 2048;
    quads.push({ key: `${t.en}_name`, image: imgName, ...quadFacing(0, facadeH * 0.30, gateZ + 1.15, nameW, nameH, '+z') });
    const emW = Math.min(26, Math.max(10, facadeH * 0.5));
    quads.push({ key: `${t.en}_crest`, image: imgCrest, ...quadFacing(0, facadeH * 0.74, gateZ + 1.15, emW, emW, '+z') });
  }

  // ② 场内北端：队名 + 队徽（贴在上层看台背后的墙面上，正对场内）
  const backInset = inset0 + decks * tierGap;
  const innerZ = -(L / 2 + backInset + 0.5);
  const innerW = Math.min(42, W + 2 * backInset - 8);
  const innerH = innerW * 320 / 2048;
  const emIn = Math.min(22, W * 0.3);
  const stackH = innerH + emIn + 1.2;
  const roofed = t.roof !== 'none';
  let yName, yEmblem, wallBot, wallTop2;
  if (roofed) {
    // 有罩棚：整块牌匾放在棚下（不然会从屋顶上支出来像漂浮的广告牌）
    wallBot = topH - stackH - 0.4;
    wallTop2 = topH - 0.2;
    yName = wallBot + 0.4 + innerH / 2;
    yEmblem = yName + innerH / 2 + emIn / 2 + 0.4;
  } else {
    yName = topH + innerH * 0.35;
    yEmblem = yName + innerH / 2 + emIn / 2 + 0.8;
    wallBot = topH - 0.6;
    wallTop2 = yEmblem + emIn / 2 + 0.6;
  }
  // 可进入模式：背墙别垂到环廊里（环廊顶棚在 tierH 高），从棚顶以上开始
  if (t.interior) wallBot = Math.max(wallBot, tierH + 1.2);
  box(0, (wallBot + wallTop2) / 2, innerZ - 0.45, Math.max(innerW, emIn) + 1.2, wallTop2 - wallBot, 0.5, pal.stand);
  quads.push({ key: `${t.en}_name`, image: imgName, ...quadFacing(0, yName, innerZ, innerW, innerH, '+z') });
  quads.push({ key: `${t.en}_crest`, image: imgCrest, ...quadFacing(0, yEmblem, innerZ, emIn, emIn, '+z') });

  // ③ 场内东西两侧：口号带
  const slW = Math.min(34, L * 0.34);
  const slH = slW * 256 / 2048;
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 + backInset + 0.5);
    box(x + sx * 0.35, topH + 0.7, 0, 0.5, slH + 0.8, slW + 0.8, pal.stand);
    quads.push({ key: `${t.en}_slogan`, image: imgSlogan, ...quadFacing(x, topH + 0.7, 0, slW, slH, sx > 0 ? '+x' : '-x') });
  }

  // 记分牌（下载素材，立在北侧看台外沿、朝场内）
  bakeGLB(path.join(SRC, 'scoreboard-e12a4ed5.glb'), {
    x: 0, y: topH + 1.0, z: -(L / 2 + roofOuter - 2.5), scale: 2.2, rotY: 0,
  });

  return { tris: tris.slice(), quads };
}

// ── 主流程
fs.mkdirSync(OUT, { recursive: true });
for (const f of ['full-marked-pitch-6ecdec76.glb', 'full-size-goal-08c07f03.glb', 'corner-flag-65953ad0.glb', 'dugout-shelter-ea708920.glb', 'scoreboard-e12a4ed5.glb', 'tripod-turnstile-b2daf4d7.glb', 'ticket-booth-e23acd9f.glb',
  'toilet-stall-4d622ba7.glb', 'concession-kiosk-fc162fe3.glb', 'first-aid-cabinet-feff73ae.glb', 'press-desk-54242480.glb',
  'changing-bench-912e20bc.glb', 'open-kit-locker-d10c9b5a.glb', 'shower-column-2aeb12a4.glb', 'camera-platform-81d16afb.glb',
  'wash-basin-3be77db0.glb']) {
  await preloadGLB(path.join(SRC, f));
}
const manifest = [];
for (const t of TEAMS) {
  const { tris: out, quads } = buildOne(t);
  const dir = path.join(OUT, `${String(t.no).padStart(2, '0')}_${t.en}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${t.en}_stadium.glb`);
  const stats = writeGLB(file, { tris: out, quads, name: `${t.cn} ${t.venue}`, materialName: 'stadium' });
  const spec = {
    no: t.no, team: t.cn, en: t.en, clubId: t.club, venue: t.venue, tier: t.tier,
    capacity: t.cap, colors: { primary: t.primary, secondary: t.secondary },
    form: { decks: t.decks, rows: t.rows, inset: t.inset, roof: t.roof, floodlights: t.lights, cornerTowers: t.towers, interior: !!t.interior },
    signage: { name: `${t.en}_name.png`, slogan: `${t.en}_slogan.png`, emblem: `${t.en}_emblem.png` },
    file: path.relative(ROOT, file).replace(/\\/g, '/'),
    bytes: stats.bytes, triangles: stats.triangles, vertices: stats.vertices,
  };
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 2), 'utf8');
  if (colliders.length) {
    fs.writeFileSync(path.join(dir, 'colliders.json'), JSON.stringify({
      model: path.basename(file), units: 'metre', yUp: true,
      note: 'kind: wall 外墙 / stand 看台 / walkway 可走面 / stair 楼梯 / prop 设施 / opening 通道口（看台碰撞盒在这些位置要挖开）',
      count: colliders.length,
      boxes: colliders.map((c) => ({ name: c.name, kind: c.kind, min: c.min.map((v) => +v.toFixed(2)), max: c.max.map((v) => +v.toFixed(2)) })),
    }, null, 2), 'utf8');
  }
  manifest.push(spec);
  console.log(`${String(t.no).padStart(2, '0')} ${t.cn.padEnd(6, ' ')} ${t.tier.padEnd(2)} tris=${String(stats.triangles).padStart(6)} ${(stats.bytes / 1024).toFixed(0)}KB decks=${t.decks} rows=${t.rows} roof=${t.roof}`);
}
fs.writeFileSync(path.join(ROOT, '00_清单/stadiums.json'), JSON.stringify({ generatedAt: new Date().toISOString(), teams: manifest }, null, 2), 'utf8');
console.log('done', manifest.length);
