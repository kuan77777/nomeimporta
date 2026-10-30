// 球场包 · 极简 GLB 读写（纯 Node，无依赖）
// 只处理本项目用得到的子集：POSITION / NORMAL / COLOR_0 / indices，TRS 节点树，flat 着色。
import fs from 'node:fs';

const COMP = {
  5120: { size: 1, get: (dv, o) => dv.getInt8(o), norm: 127 },
  5121: { size: 1, get: (dv, o) => dv.getUint8(o), norm: 255 },
  5122: { size: 2, get: (dv, o) => dv.getInt16(o), norm: 32767 },
  5123: { size: 2, get: (dv, o) => dv.getUint16(o), norm: 65535 },
  5125: { size: 4, get: (dv, o) => dv.getUint32(o), norm: 4294967295 },
  5126: { size: 4, get: (dv, o) => dv.getFloat32(o), norm: 1 },
};
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export function readGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`not glb: ${file}`);
  const total = buf.readUInt32LE(8);
  let off = 12, json = null, bin = null;
  while (off < total) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  return { json, bin: bin ?? Buffer.alloc(0), source: file };
}

function accessorData(gltf, bin, index) {
  const acc = gltf.accessors[index];
  const nc = NCOMP[acc.type];
  const c = COMP[acc.componentType];
  if (!c) throw new Error(`unsupported componentType ${acc.componentType}`);
  const bv = gltf.bufferViews[acc.bufferView];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = bv.byteStride ?? c.size * nc;
  const out = new Float32Array(acc.count * nc);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < nc; k++) {
      const raw = c.get(dv, base + i * stride + k * c.size);
      out[i * nc + k] = acc.normalized ? (acc.componentType === 5126 ? raw : Math.max(raw / c.norm, -1)) : raw;
    }
  }
  return out;
}

// ---- mat4 (column-major, 与 glTF 一致) ----
export const mat4 = {
  identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  fromTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
    const [x, y, z, w] = q;
    const m = [
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
      0, 0, 0, 1,
    ];
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= s[c];
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
    return m;
  },
  apply(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
  },
  // 法线：inverse-transpose 的 3x3 部分（只处理仿射）
  applyNormal(m, n) {
    const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-12) return n.slice();
    const inv = [
      (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
      (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
      (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
    ];
    const x = inv[0] * n[0] + inv[3] * n[1] + inv[6] * n[2];
    const y = inv[1] * n[0] + inv[4] * n[1] + inv[7] * n[2];
    const z = inv[2] * n[0] + inv[5] * n[1] + inv[8] * n[2];
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  },
};

export function worldMatrices(gltf) {
  const mats = new Array(gltf.nodes.length);
  const walk = (idx, parent) => {
    const n = gltf.nodes[idx];
    const local = n.matrix ? n.matrix.slice() : mat4.fromTRS(n.translation, n.rotation, n.scale);
    mats[idx] = parent ? mat4.mul(parent, local) : local;
    for (const c of n.children ?? []) walk(c, mats[idx]);
  };
  for (const r of gltf.scenes[gltf.scene ?? 0].nodes) walk(r, null);
  return mats;
}

export function materialColor(gltf, index) {
  const m = gltf.materials?.[index];
  const f = m?.pbrMetallicRoughness?.baseColorFactor ?? [0.8, 0.8, 0.8, 1];
  return f.slice(0, 3);
}

// 把整个文件烘成世界坐标三角形
export function flatten(gltf, bin) {
  const mats = worldMatrices(gltf);
  const tris = [];
  const visit = (idx) => {
    const n = gltf.nodes[idx];
    if (n.mesh !== undefined) {
      const M = mats[idx];
      for (const prim of gltf.meshes[n.mesh].primitives) {
        const pos = accessorData(gltf, bin, prim.attributes.POSITION);
        const nrm = prim.attributes.NORMAL !== undefined ? accessorData(gltf, bin, prim.attributes.NORMAL) : null;
        const col = materialColor(gltf, prim.material);
        const idxs = prim.indices !== undefined
          ? Array.from(accessorData(gltf, bin, prim.indices)).map(Number)
          : [...Array(pos.length / 3).keys()];
        for (let t = 0; t < idxs.length; t += 3) {
          const v = [0, 1, 2].map(k => {
            const i = idxs[t + k];
            return {
              p: mat4.apply(M, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]),
              n: nrm ? mat4.applyNormal(M, [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]]) : null,
              c: col,
            };
          });
          tris.push(v);
        }
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  for (const r of gltf.scenes[gltf.scene ?? 0].nodes) visit(r);
  return tris;
}

// ---- 写出 ----
// tris: 顶点色三角形（主网格，1 个 primitive / 1 个材质）
// quads: 贴图牌匾 [{ key, image: Buffer(png), corners: [[x,y,z]×4], uv: [[u,v]×4], unlit?: true }]
//        同一 key 的牌匾合并成一个 primitive（各自一个材质/贴图）
export function writeGLB(file, { tris, quads = [], name = 'stadium', materialName = 'stadium' }) {
  const verts = [];
  const index = [];
  const keyMap = new Map();
  const push = (p, n, c) => {
    const key = `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}|${n[0].toFixed(3)},${n[1].toFixed(3)},${n[2].toFixed(3)}|${c[0].toFixed(3)},${c[1].toFixed(3)},${c[2].toFixed(3)}`;
    const hit = keyMap.get(key);
    if (hit !== undefined) return hit;
    const id = verts.length / 9;
    verts.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2]);
    keyMap.set(key, id);
    return id;
  };
  for (const tri of tris) {
    const [a, b, c] = tri;
    const ax = b.p[0] - a.p[0], ay = b.p[1] - a.p[1], az = b.p[2] - a.p[2];
    const bx = c.p[0] - a.p[0], by = c.p[1] - a.p[1], bz = c.p[2] - a.p[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    if (nx === 0 && ny === 0 && nz === 0) continue;
    // 顶点法线：源法线若存在则用（软边），否则用面法线
    for (const v of tri) {
      const n = v.n ?? [nx, ny, nz];
      index.push(push(v.p, n, v.c));
    }
  }
  const count = verts.length / 9;
  const idx = new Uint32Array(index);
  const posBuf = new Float32Array(count * 3);
  const nrmBuf = new Float32Array(count * 3);
  const colBuf = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    posBuf.set(verts.slice(i * 9, i * 9 + 3), i * 3);
    nrmBuf.set(verts.slice(i * 9 + 3, i * 9 + 6), i * 3);
    colBuf.set(verts.slice(i * 9 + 6, i * 9 + 9), i * 3);
  }

  // ---- 统一分块 ----
  const views = [];
  const binParts = [];
  let offset = 0;
  const addView = (buf, target) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { binParts.push(Buffer.alloc(pad)); offset += pad; }
    const at = offset;
    binParts.push(buf); offset += buf.length;
    const v = { buffer: 0, byteOffset: at, byteLength: buf.length };
    if (target) v.target = target;
    views.push(v);
    return views.length - 1;
  };
  const accessors = [];
  const acc = (o) => { accessors.push(o); return accessors.length - 1; };
  const f32buf = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);

  const vPos = addView(f32buf(posBuf), 34962);
  const vNrm = addView(f32buf(nrmBuf), 34962);
  const vCol = addView(f32buf(colBuf), 34962);
  const vIdx = addView(f32buf(idx), 34963);
  const aPos = acc({ bufferView: vPos, componentType: 5126, count, type: 'VEC3', min: min3(posBuf), max: max3(posBuf) });
  const aNrm = acc({ bufferView: vNrm, componentType: 5126, count, type: 'VEC3' });
  const aCol = acc({ bufferView: vCol, componentType: 5126, count, type: 'VEC3' });
  const aIdx = acc({ bufferView: vIdx, componentType: 5125, count: idx.length, type: 'SCALAR' });

  const primitives = [{ attributes: { POSITION: aPos, NORMAL: aNrm, COLOR_0: aCol }, indices: aIdx, material: 0, mode: 4 }];
  const materials = [{
    name: materialName,
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 },
  }];
  const textures = [];
  const images = [];
  const samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];

  if (quads.length) {
    const groups = new Map();
    for (const q of quads) {
      if (!groups.has(q.key)) groups.set(q.key, { image: q.image, items: [], unlit: q.unlit !== false });
      groups.get(q.key).items.push(q);
    }
    for (const [key, g] of groups) {
      const pos = [], uv = [], ind = [];
      let base = 0;
      for (const q of g.items) {
        for (let i = 0; i < 4; i++) { pos.push(...q.corners[i]); uv.push(...q.uv[i]); }
        ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
      }
      const P = new Float32Array(pos), U = new Float32Array(uv), I = new Uint32Array(ind);
      const bvP = addView(f32buf(P), 34962);
      const bvU = addView(f32buf(U), 34962);
      const bvI = addView(f32buf(I), 34963);
      const aP = acc({ bufferView: bvP, componentType: 5126, count: P.length / 3, type: 'VEC3', min: min3(P), max: max3(P) });
      const aU = acc({ bufferView: bvU, componentType: 5126, count: U.length / 2, type: 'VEC2' });
      const aI = acc({ bufferView: bvI, componentType: 5125, count: I.length, type: 'SCALAR' });
      const bvImg = addView(g.image);
      images.push({ bufferView: bvImg, mimeType: 'image/png', name: key });
      textures.push({ sampler: 0, source: images.length - 1 });
      materials.push({
        name: key,
        pbrMetallicRoughness: { baseColorTexture: { index: textures.length - 1 }, metallicFactor: 0, roughnessFactor: 1 },
        doubleSided: true,
        ...(g.unlit ? { extensions: { KHR_materials_unlit: {} } } : {}),
      });
      primitives.push({ attributes: { POSITION: aP, TEXCOORD_0: aU }, indices: aI, material: materials.length - 1, mode: 4 });
    }
  }

  const bin = Buffer.concat(binParts);
  const pad = (4 - (bin.length % 4)) % 4;
  const binChunk = pad ? Buffer.concat([bin, Buffer.alloc(pad)]) : bin;

  const json = {
    asset: { version: '2.0', generator: 'dsh stadium composer' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives }],
    materials,
    textures: textures.length ? textures : undefined,
    images: images.length ? images : undefined,
    samplers: textures.length ? samplers : undefined,
    extensionsUsed: quads.length ? ['KHR_materials_unlit'] : undefined,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: binChunk.length }],
  };
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binChunkPadded = pad4(binChunk, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunkPadded.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonChunk.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binChunkPadded.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, jh, jsonChunk, bh, binChunkPadded]));
  return { vertices: count, triangles: idx.length / 3, bytes: 12 + 8 + jsonChunk.length + 8 + binChunkPadded.length };
}

function pad4(buf, fill) {
  const pad = (4 - (buf.length % 4)) % 4;
  return pad ? Buffer.concat([buf, Buffer.alloc(pad, fill)]) : buf;
}
function min3(a) { const m = [Infinity, Infinity, Infinity]; for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) m[k] = Math.min(m[k], a[i + k]); return m; }
function max3(a) { const m = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) m[k] = Math.max(m[k], a[i + k]); return m; }
