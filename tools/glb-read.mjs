// 球场包 · 读自己写出的 GLB（float32 / vertex color / png texture），零依赖
import fs from 'node:fs';
import zlib from 'node:zlib';

const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const CTYPE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

export function readGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not glb: ' + file);
  const total = buf.readUInt32LE(8);
  let off = 12, json = null, bin = Buffer.alloc(0);
  while (off < total) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  return { json, bin };
}

export function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  const nc = NCOMP[acc.type];
  const size = CTYPE[acc.componentType];
  const bv = json.bufferViews[acc.bufferView];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = bv.byteStride ?? size * nc;
  const out = new Float32Array(acc.count * nc);
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < nc; k++) {
      const p = base + i * stride + k * size;
      let v;
      if (acc.componentType === 5126) v = bin.readFloatLE(p);
      else if (acc.componentType === 5125) v = bin.readUInt32LE(p);
      else if (acc.componentType === 5123) v = bin.readUInt16LE(p);
      else if (acc.componentType === 5121) v = bin.readUInt8(p);
      else if (acc.componentType === 5122) v = bin.readInt16LE(p);
      else if (acc.componentType === 5120) v = bin.readInt8(p);
      else throw new Error('ctype ' + acc.componentType);
      out[i * nc + k] = acc.normalized ? v / (acc.componentType === 5126 ? 1 : (2 ** (size * 8 - 1))) : v;
    }
  }
  return out;
}

export function primitives(json, bin) {
  const out = [];
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const pos = readAccessor(json, bin, prim.attributes.POSITION);
      const nrm = prim.attributes.NORMAL !== undefined ? readAccessor(json, bin, prim.attributes.NORMAL) : null;
      const col = prim.attributes.COLOR_0 !== undefined ? readAccessor(json, bin, prim.attributes.COLOR_0) : null;
      const uv = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(json, bin, prim.attributes.TEXCOORD_0) : null;
      const idx = prim.indices !== undefined ? readAccessor(json, bin, prim.indices) : null;
      out.push({ pos, nrm, col, uv, idx, material: prim.material ?? 0 });
    }
  }
  return out;
}

export function materialTexture(json, matIndex) {
  const m = json.materials?.[matIndex];
  const t = m?.pbrMetallicRoughness?.baseColorTexture?.index;
  return t === undefined ? null : t;
}

export function imageBuffer(json, bin, texIndex) {
  const tex = json.textures[texIndex];
  const img = json.images[tex.source];
  const bv = json.bufferViews[img.bufferView];
  return bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
}

// ---------- PNG ----------
export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function decodePNG(buf) {
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`png unsupported depth=${bitDepth} interlace=${interlace}`);
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!ch) throw new Error('png colortype ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ch;
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    raw.copy(cur, 0, p, p + stride); p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = cur[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
    for (let x = 0; x < w; x++) {
      const s = x * bpp, d = (y * w + x) * 4;
      out[d] = cur[s];
      out[d + 1] = ch >= 3 ? cur[s + 1] : cur[s];
      out[d + 2] = ch >= 3 ? cur[s + 2] : cur[s];
      out[d + 3] = ch === 4 ? cur[s + 3] : 255;
    }
    prev.set(cur);
  }
  return { w, h, data: out };
}
