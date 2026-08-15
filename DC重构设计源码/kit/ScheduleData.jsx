// ScheduleData — 施工进度共享数据源（window.SCHEDULE）
// 来源规范：docs/合和新城7期施工进度计划表（户内）2026.04.22.pdf（MS-Project 式 WBS：项目→楼栋分组→工序）
// 蓝本：docs/rewrite/pages/schedule-progress.md；数据模型：DATABASE.md §2.7
// 被 HomeScreenNew / SchedulePlanScreen / ProjectDetailScreen / QuantityScreenV2 复用；
// 通过 subscribe/notify 让「施工进度页」的编辑实时反映到首页缩略甘特。
(function () {
  if (window.SCHEDULE) return;

  // ── 22 道精装修工序标准库（参考工期=工作日；item=对应工程量分项，null=手动填报）──
  const TEMPLATE = [
    { name: "放线及新建墙体",       dur: 30, item: null,     trade: "泥水", color: "#8b5cf6" },
    { name: "给排水安装",           dur: 30, item: null,     trade: "水电", color: "#f59e0b" },
    { name: "卫生间回填及防水",     dur: 30, item: "防水",   trade: "泥水", color: "#06b6d4" },
    { name: "电线敷设",             dur: 30, item: null,     trade: "水电", color: "#f59e0b" },
    { name: "空调安装（天花机）",   dur: 18, item: null,     trade: "水电", color: "#f59e0b" },
    { name: "天花龙骨及封板",       dur: 30, item: "吊顶",   trade: "木工", color: "#d97706" },
    { name: "水泥沙找平",           dur: 18, item: "找平",   trade: "泥水", color: "#6366f1" },
    { name: "石膏线安装",           dur: 18, item: "石膏线", trade: "油漆", color: "#10b981" },
    { name: "墙砖粘贴",             dur: 50, item: "墙砖铺贴", trade: "泥水", color: "#6366f1" },
    { name: "地砖铺贴",             dur: 30, item: "地砖铺贴", trade: "泥水", color: "#4f46e5" },
    { name: "天花及墙身一遍腻子",   dur: 20, item: "腻子",   trade: "油漆", color: "#10b981" },
    { name: "天花及墙身二遍腻子",   dur: 20, item: "腻子",   trade: "油漆", color: "#10b981" },
    { name: "户内门安装",           dur: 18, item: null,     trade: "木工", color: "#d97706" },
    { name: "木地板安装",           dur: 25, item: "木地板", trade: "木工", color: "#d97706" },
    { name: "天花及墙身乳胶漆",     dur: 30, item: "乳胶漆", trade: "油漆", color: "#059669" },
    { name: "铝扣板安装",           dur: 20, item: "铝扣板", trade: "干挂", color: "#0ea5e9" },
    { name: "橱柜安装",             dur: 20, item: null,     trade: "木工", color: "#d97706" },
    { name: "固装柜子安装",         dur: 25, item: null,     trade: "木工", color: "#d97706" },
    { name: "收口石膏线及油漆",     dur: 10, item: null,     trade: "油漆", color: "#10b981" },
    { name: "开关插座及灯具安装",   dur: 20, item: null,     trade: "水电", color: "#f59e0b" },
    { name: "五金洁具安装",         dur: 20, item: null,     trade: "水电", color: "#f59e0b" },
    { name: "开荒保洁",             dur: 8,  item: null,     trade: "杂工", color: "#9ca3af" },
  ];

  // 工序实例：{...模板, ps 计划开始, pf 计划完成, actual 0~1（hasQty=1 自动取工程量/演示预置；null=未开始）}
  const T = (i, ps, pf, actual) => ({ id: "t" + i, ...TEMPLATE[i], ps, pf, actual: actual == null ? 0 : actual, hasQty: TEMPLATE[i].item != null });
  const systemToday = () => {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  };
  const TODAY = systemToday();

  // ── 合和新城7期（今天取系统当前日期，计划=PDF 原表）──
  const HHXC = {
    projectId: "p1", projectName: "合和新城", start: "2026-05-01", plannedEnd: "2026-10-31", today: TODAY,
    groups: [
      { id: "g1", name: "户内10栋-22栋", buildings: ["10栋", "12栋", "15栋", "18栋", "22栋"], collapsed: false,
        tasks: [
          T(0,  "2026-05-06", "2026-06-04", 1),     // 放线 完成（提前2天）
          T(1,  "2026-05-08", "2026-06-06", 1),     // 给排水 完成（延后2天）
          T(2,  "2026-05-12", "2026-06-10", 1),     // 防水 完成
          T(3,  "2026-06-07", "2026-07-06", 0.80),  // 电线 进行中（领先）
          T(4,  "2026-06-11", "2026-06-28", 1),     // 空调 完成
          T(5,  "2026-06-11", "2026-07-10", 0.62),  // 天花龙骨 按期
          T(6,  "2026-07-07", "2026-07-24", 0),
          T(7,  "2026-07-04", "2026-07-21", 0),
          T(8,  "2026-06-13", "2026-08-01", 0.42),  // 墙砖 领先
          T(9,  "2026-07-23", "2026-08-21", 0),
          T(10, "2026-06-21", "2026-07-10", 0.35),  // 一遍腻子 落后
          T(11, "2026-07-11", "2026-07-30", 0),
          T(12, "2026-07-31", "2026-08-17", 0),
          T(13, "2026-08-13", "2026-09-06", 0),
          T(14, "2026-07-31", "2026-08-29", 0),
          T(15, "2026-08-02", "2026-08-21", 0),
          T(16, "2026-08-18", "2026-09-06", 0),
          T(17, "2026-08-23", "2026-09-16", 0),
          T(18, "2026-09-27", "2026-10-06", 0),
          T(19, "2026-07-31", "2026-08-19", 0),
          T(20, "2026-09-17", "2026-10-06", 0),
          T(21, "2026-10-16", "2026-10-23", 0),
        ] },
      { id: "g2", name: "户内23栋-30栋", buildings: ["23栋", "26栋", "28栋", "30栋"], collapsed: true,
        tasks: [
          T(0,  "2026-06-05", "2026-07-04", 0.85),
          T(1,  "2026-06-07", "2026-07-06", 0.72),
          T(2,  "2026-06-11", "2026-07-10", 0.55),
          T(3,  "2026-07-07", "2026-08-05", 0),
          T(4,  "2026-06-29", "2026-07-16", 0.05),
          T(5,  "2026-07-11", "2026-08-09", 0),
          T(6,  "2026-07-25", "2026-08-11", 0),
          T(7,  "2026-08-02", "2026-08-19", 0),
          T(8,  "2026-08-02", "2026-09-20", 0),
          T(9,  "2026-08-27", "2026-09-25", 0),
          T(10, "2026-07-31", "2026-08-19", 0),
          T(11, "2026-08-20", "2026-09-08", 0),
          T(12, "2026-09-09", "2026-09-26", 0),
          T(13, "2026-09-07", "2026-10-01", 0),
          T(14, "2026-09-09", "2026-10-08", 0),
          T(15, "2026-09-21", "2026-10-10", 0),
          T(16, "2026-09-27", "2026-10-16", 0),
          T(17, "2026-10-02", "2026-10-26", 0),
          T(18, "2026-10-19", "2026-10-28", 0),
          T(19, "2026-10-09", "2026-10-28", 0),
          T(20, "2026-10-08", "2026-10-27", 0),
          T(21, "2026-10-24", "2026-10-31", 0),
        ] },
    ],
    // 项目级成本对比：目标（基线全额）/ 已发生 / 按进度应耗（=目标×整体完成率，演示预置）
    cost: [
      { cat: "人工", target: 620, actual: 226, expected: 214 },
      { cat: "材料", target: 980, actual: 318, expected: 338 },
      { cat: "机械", target: 120, actual: 46,  expected: 41 },
      { cat: "其他", target: 140, actual: 43,  expected: 48 },
    ],
  };

  // ── 锦绣华庭 / 翠湖花园（精简演示数据）──
  const JXHT = {
    projectId: "p2", projectName: "锦绣华庭", start: "2026-01-15", plannedEnd: "2027-03-15", today: TODAY,
    groups: [
      { id: "g1", name: "1-5栋", buildings: ["1栋", "3栋", "5栋"], collapsed: false,
        tasks: [
          T(0, "2026-02-01", "2026-03-02", 1),
          T(1, "2026-02-10", "2026-03-11", 1),
          T(2, "2026-03-05", "2026-04-03", 1),
          T(3, "2026-04-04", "2026-05-03", 0.95),
          T(8, "2026-05-10", "2026-06-28", 0.66),
          T(10, "2026-06-01", "2026-06-20", 0.4),
        ] },
      { id: "g2", name: "6-12栋", buildings: ["6栋", "9栋", "12栋"], collapsed: true,
        tasks: [
          T(0, "2026-05-01", "2026-05-30", 1),
          T(1, "2026-05-08", "2026-06-06", 0.9),
          T(2, "2026-06-01", "2026-06-30", 0.5),
          T(8, "2026-07-01", "2026-08-19", 0),
        ] },
    ],
    cost: [
      { cat: "人工", target: 360, actual: 118, expected: 112 },
      { cat: "材料", target: 560, actual: 176, expected: 174 },
      { cat: "机械", target: 66,  actual: 20,  expected: 21 },
      { cat: "其他", target: 80,  actual: 27,  expected: 25 },
    ],
  };
  const CHHY = {
    projectId: "p3", projectName: "翠湖花园", start: "2024-11-20", plannedEnd: "2026-08-30", today: TODAY,
    groups: [
      { id: "g1", name: "全楼 B1F-顶层", buildings: ["主楼"], collapsed: false,
        tasks: [
          T(8,  "2025-01-10", "2025-06-30", 1),
          T(9,  "2025-04-01", "2025-08-30", 1),
          T(14, "2025-09-01", "2026-01-30", 1),
          T(15, "2026-02-01", "2026-04-10", 1),
          T(18, "2026-05-01", "2026-07-10", 0.8),
          T(21, "2026-07-20", "2026-08-20", 0),
        ] },
    ],
    cost: [
      { cat: "人工", target: 880, actual: 872, expected: 850 },
      { cat: "材料", target: 1420, actual: 1355, expected: 1372 },
      { cat: "机械", target: 180, actual: 189, expected: 174 },
      { cat: "其他", target: 200, actual: 182, expected: 193 },
    ],
  };

  const state = { "合和新城": HHXC, "锦绣华庭": JXHT, "翠湖花园": CHHY };
  const byProjectId = { p1: HHXC, p2: JXHT, p3: CHHY };

  // ── 日期/进度工具 ──
  const dayMs = 86400000;
  const D = s => new Date(s + "T00:00:00");
  const days = (a, b) => Math.round((D(b) - D(a)) / dayMs);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // 计划应完成率
  const plannedPct = (t, today) => {
    const total = Math.max(days(t.ps, t.pf), 1);
    return clamp(days(t.ps, today) / total, 0, 1);
  };
  // 偏差天数（正=提前 负=延后）；未开始且未到计划期 → 0
  const devDays = (t, today) => {
    const total = Math.max(days(t.ps, t.pf), 1);
    return Math.round((t.actual - plannedPct(t, today)) * total);
  };
  // 分组/项目 完成率与偏差（按工期加权）
  const rollup = (tasks, today) => {
    let wSum = 0, aSum = 0, pSum = 0;
    tasks.forEach(t => { const w = Math.max(days(t.ps, t.pf), 1); wSum += w; aSum += t.actual * w; pSum += plannedPct(t, today) * w; });
    if (!wSum) return { pct: 0, planned: 0, dev: 0 };
    const pct = aSum / wSum, planned = pSum / wSum;
    return { pct, planned, dev: Math.round((pct - planned) * wSum / tasks.length) };
  };
  const status = (t, today) => {
    if (t.actual >= 1) return "done";
    if (t.actual > 0) return "doing";
    return days(t.ps, today) >= 0 ? "late-start" : "todo"; // 该开工未开工=late-start
  };

  // ── 订阅机制（施工进度页编辑 → 首页实时刷新）──
  const listeners = new Set();
  const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) {} });
  // 变更入口：patch 某工序（改期/进度）；insert/remove 工序；toggle 分组折叠
  const update = (proj, gid, tid, patch) => {
    const g = state[proj].groups.find(x => x.id === gid); if (!g) return;
    const t = g.tasks.find(x => x.id === tid); if (!t) return;
    Object.assign(t, patch); notify();
  };

  window.SCHEDULE = { TEMPLATE, state, byProjectId, days, D, plannedPct, devDays, rollup, status, subscribe, notify, update };

  // x-import 需要一个组件导出（隐藏预载用，不渲染任何内容）
  window.ScheduleDataScreen = function ScheduleDataScreen() { return null; };
})();
