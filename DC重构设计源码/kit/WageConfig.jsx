// WageConfig — 工程量/工资 共享配置源（window.WAGE），工程量管理写、工资域读
// 模型：楼栋 → 楼层 → 户型 → 分项 → 房间；工程量固定(房间加总)；房间级指派 工人/班组；单价；完成楼层(勾房记录)
// 通过隐藏 x-import 预加载；localStorage 持久化。导出 no-op 组件 WageConfigScreen 供挂载。
// 2026-07-20 进度款域重构（#117）：
//  · 空鼓户记录（D5 归户）：记录挂 栋|楼层|户|分项（现场维度），工资侧只读聚合（hollowAgg），整改销记不扣；
//  · 楼层区间压缩（D8-6）：从勾房记录自动生成「1-9,11-14,16楼」（compressFloors）；
//  · 请款簿行聚合（D1 单一数据链）：subjectRows(工种, 名单) 跨楼栋聚合出清单行，行名=栋+户型+分项。
(function () {
  if (window.WAGE) { window.WageConfigScreen = window.WageConfigScreen || function () { return null; }; return; }
  const LKEY = "wage.config.v3";   // v3：楼层扩至 24 层 + 空鼓户记录（#117），废旧档

  const BUILDINGS = ["1栋", "2栋"];
  const UNITS = ["01户", "02户", "03户", "04户"]; // 户型
  const FLOORS = Array.from({ length: 24 }, (_, i) => i + 1); // 每栋楼层（用于完成层数）
  // 已完工楼层（勾房记录，决定完成层数；1栋故意留 10/15 层缺口演示区间压缩）
  const DONE = { "1栋": [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 16], "2栋": [1, 2, 3, 4, 5, 6] };

  // 工种 → 分项
  const TRADES = {
    mason: { name: "泥水", color: "#6366f1", crew: "泥水A班", mode: "worker", items: ["墙砖", "地砖"] },
    carp: { name: "木工", color: "#f59e0b", crew: "木工一班", mode: "crew", items: ["吊顶"] },
    mep: { name: "水电", color: "#10b981", crew: "水电班", mode: "crew", items: ["强弱电"] },
    water: { name: "防水", color: "#06b6d4", crew: "防水班", mode: "crew", items: ["卫生间防水"] },
  };
  const ITEM_TRADE = {}; Object.keys(TRADES).forEach((k) => TRADES[k].items.forEach((it) => (ITEM_TRADE[it] = k)));
  const PRICE = { "墙砖": 36, "地砖": 32, "吊顶": 45, "强弱电": 12, "卫生间防水": 25 };
  const UNIT_M = { "墙砖": "㎡", "地砖": "㎡", "吊顶": "㎡", "强弱电": "m", "卫生间防水": "㎡" };
  // 分项 → 房间
  const ROOMS = {
    "墙砖": ["客厅", "主卧", "次卧", "卫生间"], "地砖": ["客厅", "厨房", "阳台", "卫生间"],
    "吊顶": ["整户"], "强弱电": ["整户"], "卫生间防水": ["卫生间"],
  };
  // 固定房间工程量（每户型每分项每房间，同户型各层一致）
  function roomQty(unit, item, room) {
    const ui = UNITS.indexOf(unit), ri = ROOMS[item].indexOf(room);
    const base = { "墙砖": 9, "地砖": 8, "吊顶": 16, "强弱电": 35, "卫生间防水": 8 }[item] || 5;
    const v = base + ((ui * 2 + ri * 3) % 7) + ri * 0.5;
    return Math.round(v * 100) / 100;
  }

  // 可指派对象
  const WORKERS = ["虞建华", "匡志强", "孙大勇", "张建国", "王芳（虞嫂）", "赵铁柱", "周伟峰", "郑春明", "刘水生"];
  const CREWS = ["泥水A班", "木工一班", "水电班", "防水班"];

  // —— 默认指派：key = 栋|户型|分项|房间 → {mode:"worker"|"crew", who} ——
  function seedAssign() {
    const a = {};
    BUILDINGS.forEach((b) => UNITS.forEach((u, ui) => {
      Object.keys(TRADES).forEach((tk) => {
        const t = TRADES[tk];
        t.items.forEach((item) => {
          ROOMS[item].forEach((room, ri) => {
            const key = [b, u, item, room].join("|");
            if (t.mode === "crew") { a[key] = { mode: "crew", who: t.crew }; return; }
            // 泥水个人：每户每分项默认一个工人；示例：01户地砖 阳台 由另一人做（异人拆行）
            let who = WORKERS[(ui + (item === "地砖" ? 3 : 0)) % 6];
            if (u === "01户" && item === "地砖" && room === "阳台") who = "王芳（虞嫂）";
            a[key] = { mode: "worker", who };
          });
        });
      });
    }));
    return a;
  }

  // —— 空鼓户记录（D5 归户：现场排查按 栋|楼层|户|分项 登记；spots=处数、fixed=已整改销记数）——
  // 工资侧只读聚合；⑥ 进度月只列示、扣款手动启动、按「仍未整改处数」计扣。
  const HOLLOW_SEED = [
    { b: "2栋", f: 6, u: "01户", item: "墙砖", who: "虞建华", spots: 4, fixed: 2 },
    { b: "2栋", f: 4, u: "01户", item: "墙砖", who: "虞建华", spots: 3, fixed: 0 },
    { b: "1栋", f: 2, u: "04户", item: "地砖", who: "虞建华", spots: 2, fixed: 2 },
    { b: "1栋", f: 3, u: "03户", item: "地砖", who: "赵铁柱", spots: 3, fixed: 0 },
    { b: "1栋", f: 5, u: "03户", item: "地砖", who: "赵铁柱", spots: 2, fixed: 0 },
    { b: "2栋", f: 5, u: "03户", item: "墙砖", who: "孙大勇", spots: 2, fixed: 1 },
    { b: "2栋", f: 3, u: "02户", item: "地砖", who: "王芳（虞嫂）", spots: 2, fixed: 0 },
  ];

  let data = { assign: seedAssign(), price: { ...PRICE }, done: JSON.parse(JSON.stringify(DONE)),
    hollow: JSON.parse(JSON.stringify(HOLLOW_SEED)),
    managerExcluded: ["赵铁柱"], managerName: "虞建华", managerRate: 2.5, rentRate: 1.3 };
  try { const s = JSON.parse(localStorage.getItem(LKEY) || "null"); if (s) data = { ...data, ...s, assign: { ...seedAssign(), ...(s.assign || {}) } }; } catch (e) {}

  function save() { localStorage.setItem(LKEY, JSON.stringify(data)); }

  // —— 楼层区间压缩（D8-6）：[1,2,3,4,9,11,12] → "1-4,9,11,12楼"（连续≥3层折叠为区间）——
  function compressFloors(list) {
    const a = [...new Set(list || [])].map(Number).sort((x, y) => x - y);
    if (!a.length) return "";
    const seg = [];
    let s = a[0], p = a[0];
    for (let i = 1; i <= a.length; i++) {
      const v = a[i];
      if (v === p + 1) { p = v; continue; }
      seg.push(s === p ? String(s) : (p - s === 1 ? s + "," + p : s + "-" + p));
      s = p = v;
    }
    return seg.join(",") + "楼";
  }

  // —— 空鼓聚合（工资侧只读，D5/⑥）：names=请款簿成员；unfixed=仍未整改（扣款基数）——
  // text 自动生成「2栋6楼2处、2栋4楼3处」类明细文字（仅列未整改）。
  function hollowAgg(names) {
    const list = data.hollow.filter((h) => names.indexOf(h.who) >= 0);
    const spots = list.reduce((s, h) => s + h.spots, 0);
    const fixed = list.reduce((s, h) => s + h.fixed, 0);
    const byFloor = [];
    list.forEach((h) => {
      const un = h.spots - h.fixed;
      if (un <= 0) return;
      const k = h.b + h.f + "楼";
      const hit = byFloor.find((x) => x.k === k);
      if (hit) hit.n += un; else byFloor.push({ k, n: un });
    });
    return { list, spots, fixed, unfixed: spots - fixed,
      text: byFloor.map((x) => x.k + x.n + "处").join("、") };
  }

  window.WAGE = {
    BUILDINGS, UNITS, FLOORS, TRADES, ITEM_TRADE, ROOMS, UNIT_M, WORKERS, CREWS,
    price: (item) => data.price[item] != null ? data.price[item] : (PRICE[item] || 0),
    setPrice: (item, v) => { data.price[item] = +v || 0; save(); },
    roomQty,
    unitItemQty: (unit, item) => Math.round(ROOMS[item].reduce((s, r) => s + roomQty(unit, item, r), 0) * 100) / 100,
    getAssign: (b, u, item, room) => data.assign[[b, u, item, room].join("|")] || null,
    setAssign: (b, u, item, room, val) => { data.assign[[b, u, item, room].join("|")] = val; },
    doneFloors: (b) => data.done[b] || [],
    doneCount: (b) => (data.done[b] || []).length,
    setDone: (b, floors) => { data.done[b] = floors; },
    compressFloors, hollowAgg,
    hollowAll: () => data.hollow,
    config: data, save,
    // 供工资域：某工种在某栋，按 户型×分项×施工人 聚合的清单行（带 b=楼栋）
    payrollRows: (tradeKey, building) => {
      const t = TRADES[tradeKey]; const rows = {}; const doneN = (data.done[building] || []).length;
      UNITS.forEach((u) => t.items.forEach((item) => {
        ROOMS[item].forEach((room) => {
          const a = data.assign[[building, u, item, room].join("|")]; if (!a) return;
          const key = [u, item, a.who].join("|");
          if (!rows[key]) rows[key] = { b: building, unit: u, item, who: a.who, mode: a.mode, rooms: [], perUnitQty: 0, price: window.WAGE.price(item), unitM: UNIT_M[item] };
          rows[key].rooms.push(room); rows[key].perUnitQty += roomQty(u, item, room);
        });
      }));
      return Object.values(rows).map((r) => {
        const per = Math.round(r.perUnitQty * 100) / 100;
        const qty = Math.round(per * doneN * 100) / 100;
        return { ...r, perUnitQty: per, floors: doneN, qty, amount: Math.round(qty * r.price * 100) / 100,
          roomNote: r.rooms.length === ROOMS[r.item].length ? "整户" : r.rooms.join("+") };
      });
    },
    // 请款簿行聚合（D1）：跨楼栋取 names（成员或整包班组名）名下的行；floorsMap 可指定各栋楼层快照（历史月固化用）
    subjectRows: (tradeKey, names, floorsMap) => {
      const out = [];
      BUILDINGS.forEach((b) => {
        const doneList = floorsMap ? (floorsMap[b] || []) : (data.done[b] || []);
        const doneN = doneList.length;
        window.WAGE.payrollRows(tradeKey, b).forEach((r) => {
          if (names.indexOf(r.who) < 0) return;
          const qty = Math.round(r.perUnitQty * doneN * 100) / 100;
          out.push({ ...r, floors: doneN, floorNote: compressFloors(doneList), qty,
            amount: Math.round(qty * r.price * 100) / 100 });
        });
      });
      return out;
    },
  };
  window.WageConfigScreen = function () { return null; };
})();
