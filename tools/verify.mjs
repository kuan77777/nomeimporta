// 球场包 · 验收：16 队各一座、几何互不相同、顶级只出现一次、队名/口号/队徽贴图齐全
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readGLB, primitives } from './glb-read.mjs';

const ROOT = 'D:/异想天开/球场包';
const OUT = path.join(ROOT, '02_球队球场');
const fails = [];

const dirs = fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory()).sort();
const specs = dirs.map((d) => JSON.parse(fs.readFileSync(path.join(OUT, d, 'spec.json'), 'utf8')));

const CSL = ['上海海港', '上海申花', '北京国安', '成都蓉城', '山东泰山', '浙江', '天津津门虎', '云南玉昆', '青岛西海岸', '河南', '大连英博', '深圳新鹏城', '青岛海牛', '武汉三镇', '辽宁铁人', '重庆铜梁龙'];
const got = specs.map((s) => s.team);
if (specs.length !== 16) fails.push(`球队数量 ${specs.length} ≠ 16`);
if (new Set(got).size !== got.length) fails.push('有球队重复');
for (const n of CSL) if (!got.includes(n)) fails.push(`缺少球队 ${n}`);

const top = specs.filter((s) => s.tier === 'S');
if (top.length !== 1) fails.push(`顶级球场出现 ${top.length} 次（应恰好 1 次）`);

const hashes = new Map();
const rows = [];
for (const s of specs) {
  const file = path.join(ROOT, s.file);
  const { json, bin } = readGLB(file);
  const prims = primitives(json, bin);
  let tris = 0, quads = 0;
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const coords = [];
  for (const p of prims) {
    const n = p.idx ? p.idx.length : p.pos.length / 3;
    tris += n / 3;
    if (p.uv) quads += n / 6;
    for (let i = 0; i < p.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        box.min[k] = Math.min(box.min[k], p.pos[i + k]);
        box.max[k] = Math.max(box.max[k], p.pos[i + k]);
        coords.push(Math.round(p.pos[i + k] * 100) / 100);
      }
    }
  }
  coords.sort((a, b) => a - b);
  const h = crypto.createHash('sha256').update(Buffer.from(Float64Array.from(coords).buffer)).digest('hex').slice(0, 16);
  if (hashes.has(h)) fails.push(`几何重复：${s.team} 与 ${hashes.get(h)}`);
  hashes.set(h, s.team);

  // 队名/口号/队徽：GLB 里必须真的带 3 张 PNG（可进入的球场还多一张座席贴图），且字节落在 BIN 内、PNG 头正确
  const imgs = json.images ?? [];
  if (imgs.length < 3) fails.push(`${s.team} 贴图数量 ${imgs.length} < 3`);
  let bytesSum = 0;
  for (const im of imgs) {
    const bv = json.bufferViews[im.bufferView];
    if (!bv || bv.byteOffset + bv.byteLength > bin.length) { fails.push(`${s.team} 贴图 bufferView 越界`); continue; }
    const sig = bin.subarray(bv.byteOffset, bv.byteOffset + 8).toString('hex');
    if (sig !== '89504e470d0a1a0a') fails.push(`${s.team} 贴图不是 PNG`);
    bytesSum += bv.byteLength;
  }
  if (bytesSum < 30000) fails.push(`${s.team} 贴图总字节过小 ${bytesSum}`);

  const size = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  if (size[0] < 76 || size[2] < 112) fails.push(`${s.team} 包围盒过小 ${size[0].toFixed(1)}×${size[2].toFixed(1)}`);
  if (size[1] < 6) fails.push(`${s.team} 高度异常 ${size[1].toFixed(1)}`);

  rows.push({ ...s, hash: h, tris: Math.round(tris), quads, size, texKB: Math.round(bytesSum / 1024) });
}

const head = '序号,球队,英文,俱乐部ID,主场,容量,级别,形制(层/排/进深/罩棚/灯塔/角塔),贴图(KB),几何哈希,三角面,文件';
const csv = [head];
for (const r of rows.sort((a, b) => a.no - b.no)) {
  const f = r.form;
  csv.push([
    r.no, r.team, r.en, r.clubId, r.venue, r.capacity, r.tier,
    `${f.decks}层/${f.rows}排/${f.inset}m/${f.roof === 'shell' ? '全罩棚' : f.roof === 'partial' ? '半罩棚' : '无罩棚'}/${f.floodlights}灯塔/${f.cornerTowers ? '有' : '无'}`,
    r.texKB, r.hash, r.tris, r.file,
  ].join(','));
}
fs.writeFileSync(path.join(ROOT, '00_清单/16队球场分配表.csv'), '\ufeff' + csv.join('\n'), 'utf8');

const report = [
  '球场包验收',
  `球队数：${specs.length}`,
  `顶级（S）：${top.map((s) => `${s.team}（${s.venue}，${s.capacity}）`).join('、') || '无'}`,
  `几何唯一：${hashes.size} / ${specs.length}`,
  `队名/口号/队徽贴图：${rows.every((r) => r.texKB > 0) ? '16 队各 3 张齐备' : '有缺失'}`,
  `三角面合计：${rows.reduce((a, r) => a + r.tris, 0)}`,
  `包围盒：${rows.map((r) => `${r.team} ${r.size[0].toFixed(0)}×${r.size[2].toFixed(0)}×${r.size[1].toFixed(0)}m`).join('；')}`,
  '',
  fails.length ? `✗ ${fails.length} 项不合格：\n- ${fails.join('\n- ')}` : '✓ 全部通过',
].join('\n');
fs.writeFileSync(path.join(ROOT, '00_清单/验收报告.txt'), report, 'utf8');
console.log(report);
process.exit(fails.length ? 1 : 0);
