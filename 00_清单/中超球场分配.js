// 中超 16 队球场分配表（给项目用的可选数据文件；不依赖本包的任何工具也能读）
// 由 tools/build.mjs 生成的数据源是 00_清单/stadiums.json，这里只是薄封装 + 注释。
// 用法（接进现有 app 时）：
//   import { CSL_STADIUMS } from './00_清单/中超球场分配.js';
//   const s = CSL_STADIUMS[clubId];        // clubId 形如 'C232'
//   const kind = s.tier === 'S' ? 'oval' : s.form.decks >= 2 ? 'bowl' : s.form.rows >= 5 ? 'athletics' : 'community';
//
// 注意：现有 dist/js/fw3d/stadium-kinds.js 的 pickKind(capacity) 会让
//   上海申花 72,000 / 北京国安 68,000 / 大连英博 63,000 三队都拿到『oval（顶级）』——
//   这正是"顶级球场反复出现"。本表按需求把顶级只留给一座（上海申花），其余全部用不同形制。

export const CSL_STADIUMS = {
  C231: { no: 1, team: '上海海港', venue: '上海浦东足球场', capacity: 37000, tier: 'B', glb: '02_球队球场/01_ShanghaiPort/ShanghaiPort_stadium.glb' },
  C232: { no: 2, team: '上海申花', venue: '上海体育场', capacity: 72000, tier: 'S', glb: '02_球队球场/02_ShanghaiShenhua/ShanghaiShenhua_stadium.glb' },
  C234: { no: 3, team: '北京国安', venue: '北京工人体育场', capacity: 68000, tier: 'A+', glb: '02_球队球场/03_BeijingGuoan/BeijingGuoan_stadium.glb' },
  C233: { no: 4, team: '成都蓉城', venue: '成都凤凰山体育公园', capacity: 50000, tier: 'A', glb: '02_球队球场/04_ChengduRongcheng/ChengduRongcheng_stadium.glb' },
  C235: { no: 5, team: '山东泰山', venue: '济南奥体中心', capacity: 56808, tier: 'A', glb: '02_球队球场/05_ShandongTaishan/ShandongTaishan_stadium.glb' },
  C237: { no: 6, team: '浙江', venue: '杭州黄龙体育中心', capacity: 52672, tier: 'A', glb: '02_球队球场/06_Zhejiang/Zhejiang_stadium.glb' },
  C236: { no: 7, team: '天津津门虎', venue: '天津团泊足球场', capacity: 37000, tier: 'B', glb: '02_球队球场/07_TianjinJinmenTiger/TianjinJinmenTiger_stadium.glb' },
  C242: { no: 8, team: '云南玉昆', venue: '玉溪高原体育运动中心', capacity: 30300, tier: 'B', glb: '02_球队球场/08_YunnanYukun/YunnanYukun_stadium.glb' },
  C238: { no: 9, team: '青岛西海岸', venue: '青岛西海岸大学城体育场', capacity: 30000, tier: 'B', glb: '02_球队球场/09_QingdaoWestCoast/QingdaoWestCoast_stadium.glb' },
  C240: { no: 10, team: '河南', venue: '郑州航海体育场', capacity: 29860, tier: 'B', glb: '02_球队球场/10_Henan/Henan_stadium.glb' },
  C243: { no: 11, team: '大连英博', venue: '大连梭鱼湾足球场', capacity: 63000, tier: 'A+', glb: '02_球队球场/11_DalianYingbo/DalianYingbo_stadium.glb' },
  C241: { no: 12, team: '深圳新鹏城', venue: '深圳宝安体育场', capacity: 45000, tier: 'A', glb: '02_球队球场/12_ShenzhenPengCity/ShenzhenPengCity_stadium.glb' },
  C244: { no: 13, team: '青岛海牛', venue: '青岛天泰体育场', capacity: 50000, tier: 'A', glb: '02_球队球场/13_QingdaoHainiu/QingdaoHainiu_stadium.glb' },
  C239: { no: 14, team: '武汉三镇', venue: '武汉体育中心', capacity: 56201, tier: 'A', glb: '02_球队球场/14_WuhanThreeTowns/WuhanThreeTowns_stadium.glb' },
  C247: { no: 15, team: '辽宁铁人', venue: '沈阳奥体中心', capacity: 19600, tier: 'C', glb: '02_球队球场/15_LiaoningTieren/LiaoningTieren_stadium.glb' },
  C248: { no: 16, team: '重庆铜梁龙', venue: '重庆奥体中心', capacity: 20000, tier: 'C', glb: '02_球队球场/16_ChongqingTonglianglong/ChongqingTonglianglong_stadium.glb' },
};
