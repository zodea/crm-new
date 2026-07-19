// QuantityUnitScreen — 户详情独立页（issue #39）
// 入口：工程量矩阵点户格 → navigate("quantityUnit", { building, floor, unit })
// 结构：红圈式页内左侧导航（200px：分部→工种→分项，状态点+照片角标，锚点定位）+ 右侧分项区块流
//  · 每分项区块 = 户级指派(默认) + 「房间级详细配置」(表格加指派列) + 房间行表格(合同量|现场计算式实时求值|现场量)
//    + 分项小计行(合同量小计/现场量小计/毛利=（合同单价−班组单价mock）×现场量) + 完成勾选/日期/验收照片/工序链卡点
//  · 页尾全户合计卡：合同量金额 / 现场量金额 / 毛利合计
// 业务逻辑照搬原 QuantityScreenV2 UnitModal：勾完成需上一道工序已传验收照片；量到房间、完成勾到户（CONTEXT.md）
// 编辑经 window.QTY_UNIT_STATE 写穿（key=栋|层|户|工种:分项），返回矩阵页保持一致；刷新恢复初始 mock。
// 2026-07-19 反馈轮：指派复选树(班组分组可下钻)/验收照片按分项可配/房间行默认收起/左导航 sticky 修复
(function () {
  const { Button, Panel, StatusChip, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {} };

  // —— 与 QuantityScreenV2 对齐的 mock 基础数据（新增 cprice=班组分项单价，毛利=单价双轨差×现场量；photo:false=该分项无需验收照片）——
  const TRADES = {
    plumb: { key: "plumb", name: "水电工", div: "机电安装", color: "#10b981", crew: "水电班",
      items: [{ n: "给排水管", u: "m", price: 18, cprice: 13, base: 42 }, { n: "强弱电管", u: "m", price: 12, cprice: 8.5, base: 36, photo: false }] },
    water: { key: "water", name: "防水工", div: "防水工程", color: "#06b6d4", crew: "防水班",
      items: [{ n: "卫生间防水", u: "㎡", price: 25, cprice: 17, base: 8 }, { n: "厨房防水", u: "㎡", price: 25, cprice: 17, base: 5 }] },
    mason: { key: "mason", name: "泥水工", div: "装饰装修", color: "#6366f1", crew: "泥水A班",
      items: [{ n: "墙砖铺贴", u: "㎡", price: 38, cprice: 26, base: 28 }, { n: "地砖铺贴", u: "㎡", price: 32, cprice: 22, base: 18 }] },
    carp: { key: "carp", name: "木工", div: "装饰装修", color: "#f59e0b", crew: "木工一班",
      items: [{ n: "吊顶", u: "㎡", price: 45, cprice: 32, base: 16 }, { n: "门套", u: "樘", price: 120, cprice: 85, base: 4, photo: false }] },
  };
  const TRADE_ORDER = ["plumb", "water", "mason", "carp"];
  const DIV_ORDER = ["机电安装", "防水工程", "装饰装修"];
  // 默认指派与名册统一为 KIT_DATA.workers 真名（2026-07-19 反馈轮，与工资核算 PAYSLIP 名册一致）
  const WORKER = {
    plumb: { "01户": ["周伟峰"], "02户": ["周伟峰"], "03户": ["周伟峰"], "04户": ["水电班"] },
    water: { "01户": ["郑明"], "02户": ["郑明"], "03户": ["防水班"], "04户": ["防水班"] },
    mason: { "01户": ["虞建华"], "02户": ["匡志强"], "03户": ["张建国"], "04户": ["王芳（虞嫂）"] },
    carp: { "01户": ["孙大勇"], "02户": ["孙大勇"], "03户": ["木工一班"], "04户": ["木工一班"] },
  };
  const ASSIGNEES = ["虞建华", "匡志强", "张建国", "王芳（虞嫂）", "孙大勇", "周伟峰", "郑明"];
  const CREWS = ["泥水A班", "水电班", "木工一班"];
  const ASSIGN_OPTS = [...ASSIGNEES.map(w => ({ v: w, l: w })), ...CREWS.map(c => ({ v: c, l: c + "（班组）" }))];

  // 全户 6 房间；合同工程量清单细分到房间 → 各分项只涉及部分房间（mask）
  const ROOMS = ["客厅", "主卧", "次卧", "厨房", "卫生间", "阳台"];
  const IKEY = (tk, idx) => tk + ":" + idx;
  const ROOM_MASK = {
    "plumb:0": ["厨房", "卫生间", "阳台"],
    "plumb:1": ROOMS,
    "water:0": ["卫生间"],
    "water:1": ["厨房"],
    "mason:0": ["厨房", "卫生间", "阳台"],
    "mason:1": ROOMS,
    "carp:0": ["客厅", "厨房", "卫生间"],
    "carp:1": ["主卧", "次卧", "厨房", "卫生间"],
  };
  const W_ROOM = { "客厅": 0.30, "主卧": 0.22, "次卧": 0.17, "厨房": 0.12, "卫生间": 0.11, "阳台": 0.08 };

  // 工序链（完成勾选卡点按此顺序判定前一道）
  const CHAIN = [];
  TRADE_ORDER.forEach(tk => TRADES[tk].items.forEach((it, idx) => CHAIN.push({ tk, idx, n: it.n, u: it.u, trade: TRADES[tk] })));
  const CHAIN_POS = Object.fromEntries(CHAIN.map((c, i) => [IKEY(c.tk, c.idx), i]));

  // 完工月份口径（与 QuantityScreenV2 一致，用于初始播种）
  const MONTHS = [
    { key: "2024-09", label: "2024.9", level: 4 },
    { key: "2024-11", label: "2024.11", level: 3 },
    { key: "2025-01", label: "2025.1", level: 3 },
    { key: "2025-04", label: "2025.4", level: 2 },
  ];
  const MONTH_MAP = Object.fromEntries(MONTHS.map(m => [m.key, m]));
  const MONTH_LABEL = (k) => (k && MONTH_MAP[k] ? MONTH_MAP[k].label : "未开工");
  const CUR_MONTH = "2025-04";
  const DEFAULT_FLOOR_MONTH = { "39F": null, "38F": "2025-04", "37F": "2025-01", "36F": "2024-11", "35F": "2024-11", "34F": "2024-09", "33F": "2024-09" };

  const TODAY = () => new Date().toISOString().slice(0, 10);
  const R1 = v => Math.round(v * 10) / 10;
  const fq = v => R1(v).toLocaleString();
  const fM = v => "¥" + Math.round(v).toLocaleString();

  // —— 现场量计算式求值：空 → null（未录）；非法 → NaN；合法 → number ——
  function evalExpr(expr) {
    if (expr == null) return null;
    const s = String(expr).replace(/×/g, "*").replace(/÷/g, "/").trim();
    if (!s) return null;
    if (!/^[0-9+\-*/().\s]+$/.test(s)) return NaN;
    try {
      const v = Function('"use strict";return (' + s + ")")();
      return typeof v === "number" && isFinite(v) ? v : NaN;
    } catch (e) { return NaN; }
  }

  // —— 分项户级合同量 → 房间拆分（确定性权重，行合计恒等于户级总量）——
  function roomSplit(tk, idx, total, isCount) {
    const mask = ROOM_MASK[IKEY(tk, idx)] || ROOMS;
    const ti = TRADE_ORDER.indexOf(tk);
    const ws = mask.map(r => {
      const ri = ROOMS.indexOf(r);
      return W_ROOM[r] * (1 + (((ri * 7 + idx * 5 + ti * 3) % 5) - 2) * 0.07);
    });
    const wsum = ws.reduce((a, b) => a + b, 0);
    const out = {};
    if (isCount) {
      let left = total;
      mask.forEach((r, i) => {
        if (i === mask.length - 1) { out[r] = Math.max(0, left); return; }
        const v = Math.max(0, Math.min(Math.round(total * ws[i] / wsum), left));
        out[r] = v; left -= v;
      });
    } else {
      let acc = 0;
      mask.forEach((r, i) => {
        if (i === mask.length - 1) { out[r] = R1(total - acc); return; }
        const v = R1(total * ws[i] / wsum);
        out[r] = v; acc += v;
      });
    }
    return out;
  }

  // —— 完成勾选 + 验收照片初始播种（单户版，口径与 QuantityScreenV2.seedDone 一致）——
  function seedUnit(mx, b, f, u) {
    const dm = {}, pm = {};
    const bi = mx.buildings.indexOf(b), fi = mx.floors.indexOf(f), ui = mx.units.indexOf(u);
    const K = (tk, idx) => [b, f, u, IKEY(tk, idx)].join("|");
    const m = DEFAULT_FLOOR_MONTH[f];
    if (m && MONTH_MAP[m] && !(f === "38F" && m === CUR_MONTH)) {
      const lvl = MONTH_MAP[m].level;
      TRADE_ORDER.slice(0, lvl).forEach((tk, ti) => TRADES[tk].items.forEach((it, idx) => {
        const h = (bi * 5 + fi * 3 + ui * 7 + ti * 2 + idx) % 19;
        dm[K(tk, idx)] = { done: true, date: m + "-" + String(9 + h).padStart(2, "0") };
        pm[K(tk, idx)] = 1 + (h % 3);
      }));
    }
    if (f === "38F" && DEFAULT_FLOOR_MONTH["38F"] === CUR_MONTH) {
      if (u === "01户") {
        dm[K("plumb", 0)] = { done: true, date: "2025-04-08" }; pm[K("plumb", 0)] = 2;
        dm[K("plumb", 1)] = { done: true, date: "2025-04-12" }; pm[K("plumb", 1)] = 1;
        dm[K("water", 0)] = { done: true, date: "2025-04-20" };
      }
      if (u === "02户") {
        dm[K("plumb", 0)] = { done: true, date: "2025-04-09" }; pm[K("plumb", 0)] = 1;
        dm[K("plumb", 1)] = { done: true, date: "2025-04-13" };
      }
      if (u === "03户") {
        dm[K("plumb", 0)] = { done: true, date: "2025-04-11" }; pm[K("plumb", 0)] = 1;
      }
    }
    return { dm, pm };
  }

  function QuantityUnitScreen({ data, navigate, params }) {
    const mx = data.matrix;
    const p = params || {};
    const building = p.building && mx.buildings.includes(p.building) ? p.building : mx.buildings[0];
    const floor = p.floor && mx.floors.includes(p.floor) ? p.floor : (mx.floors.includes("38F") ? "38F" : mx.floors[0]);
    const unit = p.unit && mx.units.includes(p.unit) ? p.unit : mx.units[0];
    const bi = mx.buildings.indexOf(building), fi = mx.floors.indexOf(floor), ui = mx.units.indexOf(unit);
    const roomNo = floor.replace(/F$/, "") + unit;
    const monthLabel = MONTH_LABEL(DEFAULT_FLOOR_MONTH[floor]);

    // —— 写穿存储：本户编辑跨页面保留（矩阵页读取），刷新恢复初始 mock ——
    const STORE = (window.QTY_UNIT_STATE = window.QTY_UNIT_STATE || {});
    const skey = building + "|" + floor + "|" + unit;
    const slot = (STORE[skey] = STORE[skey] || { dm: {}, pm: {}, qs: {}, asg: {}, rq: {}, est: {} });
    const keyOf = (tk, idx) => [building, floor, unit, IKEY(tk, idx)].join("|");

    const [seed] = React.useState(() => seedUnit(mx, building, floor, unit));
    const [doneMap, setDoneMap] = React.useState(() => {
      const m = { ...seed.dm };
      Object.entries(slot.dm).forEach(([k, v]) => { if (v) m[k] = v; else delete m[k]; });
      return m;
    });
    const [photoMap, setPhotoMap] = React.useState(() => ({ ...seed.pm, ...slot.pm }));
    const [rq, setRq] = React.useState(() => ({ ...slot.rq }));           // { key: { 房间: { contract?, site? } } }
    const [estOv, setEstOv] = React.useState(() => ({ ...slot.est }));    // { key: number } 暂估量（户级）
    const [asg, setAsg] = React.useState(() => ({ ...slot.asg }));        // { key: { who, byRoom, rooms } }
    const [active, setActive] = React.useState(null);

    // —— 三量默认值（确定性，口径与矩阵页一致）——
    const qtyOf = (tk, idx) => {
      const ti = TRADE_ORDER.indexOf(tk), it = TRADES[tk].items[idx];
      const raw = it.base + ((bi * 7 + fi * 3 + ui * 5 + idx * 2 + ti * 4) % 13);
      return it.u === "樘" ? Math.round(raw / 4) + 1 : R1(raw);
    };
    const defEst = (tk, idx) => {
      const q = qtyOf(tk, idx);
      if (TRADES[tk].items[idx].u === "樘") return q;
      const d = ((fi + ui * 2 + idx * 3 + TRADE_ORDER.indexOf(tk)) % 5) - 2;
      return R1(q + d * 0.6);
    };
    // 早期完工楼层（1栋）预填房间级现场计算式；38F/未开工不预填
    const defRoomSite = (tk, idx, room, qc) => {
      if (building !== "1栋") return "";
      const m = DEFAULT_FLOOR_MONTH[floor];
      if (!m || m === CUR_MONTH) return "";
      if (TRADE_ORDER.indexOf(tk) >= (MONTH_MAP[m] ? MONTH_MAP[m].level : 0)) return "";
      if (TRADES[tk].items[idx].u === "樘") return String(qc);
      const ri = ROOMS.indexOf(room);
      const h = (fi * 5 + ui * 3 + ri * 4 + idx * 7 + TRADE_ORDER.indexOf(tk)) % 7;
      const w = Math.max(0.6, (qc + (h - 3) * 0.35) / 2.4);
      const a = R1(w * 0.55), b2 = R1(w - a);
      return a + "*2.4+" + b2 + "*2.4";
    };

    // —— 分项汇总计算（房间行 + 小计 + 状态）——
    const calc = (tk, idx, rqAll) => {
      const R = rqAll || rq;
      const k = keyOf(tk, idx);
      const it = TRADES[tk].items[idx];
      const split = roomSplit(tk, idx, qtyOf(tk, idx), it.u === "樘");
      const mask = ROOM_MASK[IKEY(tk, idx)] || ROOMS;
      let cSub = 0, sSub = 0, fb = false, hasSite = false;
      const rooms = mask.map(r => {
        const ov = (R[k] || {})[r] || {};
        const contract = ov.contract != null ? ov.contract : split[r];
        const expr = ov.site != null ? ov.site : defRoomSite(tk, idx, r, contract);
        const val = evalExpr(expr);
        const valid = val != null && !isNaN(val);
        if (expr !== "") hasSite = true;
        cSub += contract;
        if (valid) sSub += val; else { sSub += contract; fb = true; }
        return { room: r, contract, expr, val, valid, invalid: expr !== "" && val != null && isNaN(val) };
      });
      return {
        k, it, mask, rooms, cSub: R1(cSub), sSub: R1(sSub), fb, hasSite,
        done: !!doneMap[k], date: (doneMap[k] || {}).date || TODAY(), photos: photoMap[k] || 0,
        price: it.price, cprice: it.cprice, profit: (it.price - it.cprice) * sSub,
      };
    };

    // —— 写穿：房间量/暂估量编辑同步聚合到 slot.qs（矩阵页 getQB 直接读同名 key）——
    const syncAgg = (tk, idx, rqAll) => {
      const info = calc(tk, idx, rqAll);
      const parts = info.rooms.map(r => (r.valid && r.expr !== "") ? "(" + r.expr + ")" : String(R1(r.contract)));
      slot.qs[info.k] = { ...(slot.qs[info.k] || {}), contract: info.cSub, site: parts.join("+") };
    };
    const patchRoom = (tk, idx, room, patch) => {
      const k = keyOf(tk, idx);
      const next = { ...rq, [k]: { ...(rq[k] || {}), [room]: { ...((rq[k] || {})[room] || {}), ...patch } } };
      setRq(next); slot.rq = next; syncAgg(tk, idx, next);
    };
    const estOf = (tk, idx) => { const k = keyOf(tk, idx); return estOv[k] != null ? estOv[k] : defEst(tk, idx); };
    const patchEst = (tk, idx, v) => {
      const k = keyOf(tk, idx);
      const next = { ...estOv, [k]: v };
      setEstOv(next); slot.est = next;
      slot.qs[k] = { ...(slot.qs[k] || {}), est: v };
    };

    // —— 指派（户级默认，房间级为可选细化；who/rooms[r] 值模型 = string[] 多选，旧 string 值读取处经 toWhoList 兼容）——
    const getAsg = (tk, idx) => asg[keyOf(tk, idx)] || { who: (WORKER[tk][unit] || []).slice(), byRoom: false, rooms: {} };
    const patchAsg = (tk, idx, patch) => {
      const k = keyOf(tk, idx);
      const next = { ...asg, [k]: { ...getAsg(tk, idx), ...patch } };
      setAsg(next); slot.asg = next;
    };

    // —— 完成勾选（工序链卡点）/ 完成日期 / 验收照片 —— 照搬 UnitModal 逻辑
    const toggleDone = (tk, idx) => {
      const k = keyOf(tk, idx), it = TRADES[tk].items[idx];
      if (doneMap[k]) {
        setDoneMap(m => { const o = { ...m }; delete o[k]; return o; });
        slot.dm[k] = null;
        UI().toast("已取消「" + it.n + "」完成勾选");
        return;
      }
      const pos = CHAIN_POS[IKEY(tk, idx)];
      if (pos > 0) {
        const prev = CHAIN[pos - 1];
        const pk = keyOf(prev.tk, prev.idx);
        const prevNeedPhoto = TRADES[prev.tk].items[prev.idx].photo !== false;
        if (prevNeedPhoto && doneMap[pk] && !(photoMap[pk] > 0)) { UI().toast("上一道工序『" + prev.n + "』未上传验收照片", "warn"); return; }
      }
      const v = { done: true, date: TODAY() };
      setDoneMap(m => ({ ...m, [k]: v })); slot.dm[k] = v;
      UI().toast("已勾选「" + it.n + "」本户完成", "ok");
    };
    const setDoneDate = (tk, idx, d) => {
      const k = keyOf(tk, idx);
      if (!doneMap[k]) return;
      const v = { ...doneMap[k], date: d };
      setDoneMap(m => ({ ...m, [k]: v })); slot.dm[k] = v;
    };
    const addPhoto = (tk, idx) => {
      const k = keyOf(tk, idx);
      const n = (photoMap[k] || 0) + 1;
      setPhotoMap(m => ({ ...m, [k]: n })); slot.pm[k] = n;
      UI().toast("已添加验收照片（占位）", "ok");
    };

    // —— 全部分项一次算好（左导航状态点 + 区块 + 合计卡共用）——
    const all = CHAIN.map((c, ci) => ({ c, ci, ...calc(c.tk, c.idx) }));
    const doneCount = all.filter(x => x.done).length;
    const pct = Math.round(doneCount / CHAIN.length * 100);
    const cAmt = all.reduce((s, x) => s + x.cSub * x.price, 0);
    const sAmt = all.reduce((s, x) => s + x.sSub * x.price, 0);
    const profitSum = all.reduce((s, x) => s + x.profit, 0);
    const anyFb = all.some(x => x.fb);
    const diffAmt = sAmt - cAmt;
    const navColor = x => x.done ? "var(--ok)" : (x.photos > 0 || x.hasSite) ? "var(--brand)" : "var(--ink-faint)";

    const jump = (tk, idx) => {
      setActive(IKEY(tk, idx));
      const el = document.getElementById("quBlk-" + tk + "-" + idx);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const S = { getAsg, patchAsg, estOf, patchEst, patchRoom, toggleDone, setDoneDate, addPhoto };

    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>

        {/* ── 左侧页内导航（红圈式）：分部 → 工种 → 分项，状态点 + 照片角标，点击锚点定位；滚动在 document 层，top 需让过 104px 吸顶头部 ── */}
        <div style={{ width: 200, flex: "none", position: "sticky", top: 116 }}>
          <Panel padding={10} style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "calc(100vh - 132px)", overflowY: "auto" }}>
            <Button size="sm" variant="secondary" icon="arrow-left" onClick={() => window.DC.closeActiveTab()}>返回工程量矩阵</Button>
            {DIV_ORDER.map(dv => (
              <div key={dv} style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-faint)", letterSpacing: 1, padding: "0 6px 3px" }}>{dv}</div>
                {TRADE_ORDER.filter(tk => TRADES[tk].div === dv).map(tk => (
                  <div key={tk} style={{ marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: TRADES[tk].color, flex: "none" }} />
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{TRADES[tk].name}</span>
                      <span style={{ fontSize: 10, color: "var(--ink-faint)", marginLeft: "auto" }}>{TRADES[tk].crew}</span>
                    </div>
                    {TRADES[tk].items.map((it, idx) => {
                      const x = all[CHAIN_POS[IKEY(tk, idx)]];
                      const on = active === IKEY(tk, idx);
                      return (
                        <button key={idx} onClick={() => jump(tk, idx)} style={{
                          display: "flex", alignItems: "center", gap: 7, width: "100%", border: 0, textAlign: "left",
                          background: on ? "var(--brand-soft)" : "transparent", borderRadius: 6,
                          padding: "5px 6px 5px 16px", cursor: "pointer",
                        }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: navColor(x), flex: "none" }} />
                          <span style={{ fontSize: 12, color: on ? "var(--brand-deep)" : "var(--ink)", fontWeight: on ? 700 : 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.n}</span>
                          {it.photo !== false && x.photos > 0 && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-soft)", background: "var(--surface-3)", borderRadius: 999, padding: "1px 6px", flex: "none" }}>
                              <Icon name="image" size={9} />{x.photos}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
            <div style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {[["var(--ok)", "已完成"], ["var(--brand)", "进行中"], ["var(--ink-faint)", "未开始"]].map(([cl, tx]) => (
                <span key={tx} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-soft)", padding: "0 6px" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: cl }} />{tx}
                </span>
              ))}
              <span style={{ fontSize: 10, color: "var(--ink-faint)", padding: "0 6px" }}>角标 = 验收照片张数</span>
            </div>
          </Panel>
        </div>

        {/* ── 右侧内容区 ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>

          {/* 页头：栋·层·户 + 整户完成度 + 全户合同额 */}
          <Panel padding={16} style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 20, fontWeight: 800 }}>{building} · {floor} · {unit}</span>
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--brand-deep)", background: "var(--brand-soft)", borderRadius: 6, padding: "2px 8px" }}>{roomNo}</span>
                <StatusChip tone={DEFAULT_FLOOR_MONTH[floor] ? (DEFAULT_FLOOR_MONTH[floor] === CUR_MONTH ? "brand" : "ok") : "neutral"}>{monthLabel}</StatusChip>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>分项按工序链排列 · 量到房间、完成勾到户 · 勾完成需上一道工序已传验收照片</div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
              <div style={{ minWidth: 190 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)" }}>整户完成度</span>
                  <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "var(--font-mono)" }}>{doneCount}/{CHAIN.length}</span>
                  <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>分项 · {pct}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: "var(--surface-3)", overflow: "hidden" }}>
                  <div style={{ width: pct + "%", height: "100%", borderRadius: 999, background: pct === 100 ? "var(--ok)" : "var(--brand)", transition: "width 0.25s ease" }} />
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)" }}>全户合同额</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-mono)", marginTop: 2 }}>{fM(cAmt)}</div>
              </div>
            </div>
          </Panel>

          {/* 分项区块流（工序链顺序） */}
          {all.map(x => <ItemSection key={x.k} x={x} S={S} />)}

          {/* 页尾：全户合计卡 */}
          <Panel padding={18}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <Icon name="wallet" size={15} color="var(--brand)" />
              <span style={{ fontSize: 13, fontWeight: 800 }}>全户合计 · {building} {roomNo}</span>
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>金额 = 分项小计 × 合同单价 · 毛利 =（合同单价 − 班组单价）× 现场量{anyFb ? " · * 含未录现场量回退合同量" : ""}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>合同量金额</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-mono)", marginTop: 6 }}>{fM(cAmt)}</div>
                <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 4 }}>按合同工程量清单（房间加总）</div>
              </div>
              <div style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>现场量金额</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-mono)", marginTop: 6 }}>{fM(sAmt)}{anyFb ? "*" : ""}</div>
                <div style={{ fontSize: 11, marginTop: 4, fontWeight: 700, color: Math.abs(diffAmt) < 0.5 ? "var(--ink-faint)" : diffAmt > 0 ? "var(--danger)" : "var(--ok)" }}>
                  与合同差 {Math.abs(diffAmt) < 0.5 ? "—" : (diffAmt > 0 ? "+" : "−") + fM(Math.abs(diffAmt))}
                </div>
              </div>
              <div style={{ background: "var(--ok-soft)", border: "1px solid var(--ok)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ok-ink)" }}>毛利合计</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-mono)", marginTop: 6, color: profitSum >= 0 ? "var(--ok-ink)" : "var(--danger)" }}>{fM(profitSum)}</div>
                <div style={{ fontSize: 11, color: "var(--ok-ink)", marginTop: 4 }}>单价双轨差 × 现场量（逐分项累加）</div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  // —— 指派值模型 = string[]（多选：人名/班组名混排）；兼容旧 string 写穿值统一经此转换 ——
  const toWhoList = (v) => Array.isArray(v) ? v : (v ? [v] : []);

  // —— AssignPicker：按班组分组的复选框树浮层（户级/房间级指派共用）——
  //  · 组头复选框 = 整组指派（值=班组名）；assignLevel==="个人" 的班组组头下缩进列出成员复选框（可下钻）
  //  · 勾组头清掉该班组已勾成员；勾任一成员取消该班组组头；assignLevel==="班组" 只有组头不展开
  //  · 存量班组行无 assignLevel 字段时兜底：泥水类默认「个人」（与 crewForm「指派粒度」hint 口径一致）
  function AssignPicker({ value, onChange, style }) {
    const [open, setOpen] = React.useState(false);
    const list = toWhoList(value);
    React.useEffect(() => {
      if (!open) return;
      const close = () => setOpen(false);
      document.addEventListener("mousedown", close);
      return () => document.removeEventListener("mousedown", close);
    }, [open]);
    const crews = (window.APP ? window.APP.rows("crews") : window.KIT_DATA.crews) || [];
    const workers = (window.KIT_DATA && window.KIT_DATA.workers) || [];
    const crewNames = crews.map(c => c.name);
    const levelOf = (crew) => crew.assignLevel || (String(crew.trade || "").indexOf("泥水") >= 0 ? "个人" : "班组");
    const membersOf = (crew) => workers.filter(w => w.team === crew.name).map(w => w.name);
    const toggleCrew = (crew) => {
      const members = membersOf(crew);
      onChange(list.includes(crew.name)
        ? list.filter(v => v !== crew.name)
        : [...list.filter(v => !members.includes(v)), crew.name]);
    };
    const toggleMember = (crew, name) => {
      onChange(list.includes(name)
        ? list.filter(v => v !== name)
        : [...list.filter(v => v !== crew.name), name]);
    };
    const summary = list.map(v => crewNames.includes(v) ? v + "（班组）" : v).join("、");
    const rowLbl = { display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", userSelect: "none", padding: "3px 4px", borderRadius: 4 };
    return (
      <span style={{ position: "relative", display: "inline-block", ...(style || {}) }} onMouseDown={e => e.stopPropagation()}>
        <button onClick={() => setOpen(o => !o)} title={summary || "未指派"} style={{
          border: "1px solid var(--line-strong)", borderRadius: 6, padding: "5px 8px", fontSize: 12,
          background: "#fff", cursor: "pointer", width: "100%", textAlign: "left",
          color: list.length ? "var(--ink)" : "var(--ink-faint)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{summary || "未指派"}</button>
        {open && (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 40, minWidth: 210, maxHeight: 280, overflowY: "auto",
            background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, boxShadow: "var(--shadow-pop)", padding: 8,
          }}>
            {crews.map(crew => {
              const canDrill = levelOf(crew) === "个人";
              const members = canDrill ? membersOf(crew) : [];
              return (
                <div key={crew.id || crew.name} style={{ marginBottom: 2 }}>
                  <label style={{ ...rowLbl, fontWeight: 700 }}>
                    <input type="checkbox" checked={list.includes(crew.name)} onChange={() => toggleCrew(crew)} />
                    <span style={{ flex: 1, minWidth: 0 }}>{crew.name}</span>
                    {canDrill
                      ? <span style={{ fontSize: 10, fontWeight: 700, color: "var(--brand-deep)", background: "var(--brand-soft)", borderRadius: 999, padding: "1px 6px", flex: "none" }}>可下钻</span>
                      : <span style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-3)", borderRadius: 999, padding: "1px 6px", flex: "none" }}>整包</span>}
                  </label>
                  {members.map(name => (
                    <label key={name} style={{ ...rowLbl, paddingLeft: 26 }}>
                      <input type="checkbox" checked={list.includes(name)} onChange={() => toggleMember(crew, name)} />
                      <span>{name}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </span>
    );
  }

  // —— 单个分项区块：户级指派 + 房间行表格 + 小计行 + 完成勾选/验收照片 ——
  function ItemSection({ x, S }) {
    const [expanded, setExpanded] = React.useState(false);
    const { c, ci, it, mask, rooms, cSub, sSub, fb, hasSite, done, date, photos, price, cprice, profit } = x;
    const a = S.getAsg(c.tk, c.idx);
    const est = S.estOf(c.tk, c.idx);
    const needPhoto = it.photo !== false;
    // 房间行默认收起：已按房间配置的默认展开；点「房间级详细配置」强制展开
    const [showRooms, setShowRooms] = React.useState(a.byRoom === true);
    const toggleExpanded = () => { if (!expanded) setShowRooms(true); setExpanded(e => !e); };
    const linkBtn = { border: 0, background: "transparent", color: "var(--brand-deep)", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 0 };
    const inp = { border: "1px solid var(--line-strong)", borderRadius: 6, padding: "5px 8px", fontSize: 12, background: "#fff", width: "100%" };
    const sel = { border: "1px solid var(--line-strong)", borderRadius: 6, padding: "5px 8px", fontSize: 12, background: "#fff", cursor: "pointer", width: "100%" };
    const lbl = { fontSize: 11, fontWeight: 700, color: "var(--ink-soft)" };
    const th = { padding: "7px 10px", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", borderBottom: "1px solid var(--line)", textAlign: "left", whiteSpace: "nowrap" };
    const td = { padding: "6px 10px", fontSize: 12, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", verticalAlign: "middle" };
    return (
      <div id={"quBlk-" + c.tk + "-" + c.idx} style={{ scrollMarginTop: 12 }}>
        <Panel padding={0} style={{ overflow: "hidden" }}>
          {/* 区块头 */}
          <div style={{ padding: "11px 16px", display: "flex", alignItems: "center", gap: 9, background: "var(--surface-2)", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 800, fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}>{String(ci + 1).padStart(2, "0")}</span>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: c.trade.color, flex: "none" }} />
            <span style={{ fontSize: 14, fontWeight: 800 }}>{c.n}</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              {c.trade.name} · 合同 ¥{price}/{c.u} · 班组 ¥{cprice}/{c.u}
              <span style={{ color: "var(--ok-ink)", fontWeight: 700 }}> · 差 ¥{R1(price - cprice)}</span>
              <span style={{ color: "var(--ink-faint)" }}> · 涉及 {mask.length} 个房间</span>
            </span>
            <span style={{ marginLeft: "auto", flex: "none" }}>
              {done
                ? <StatusChip tone="ok">已完成 {date.slice(5).replace("-", ".")}</StatusChip>
                : (photos > 0 || hasSite)
                  ? <StatusChip tone="brand">进行中</StatusChip>
                  : <StatusChip tone="neutral">未开始</StatusChip>}
            </span>
          </div>

          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {/* 户级指派（默认） + 房间级详细配置 + 暂估量（户级） */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ ...lbl, width: 56, flex: "none" }}>施工指派</span>
              {a.byRoom && !expanded ? (
                <React.Fragment>
                  <StatusChip tone="brand">已按房间配置</StatusChip>
                  <button onClick={() => S.patchAsg(c.tk, c.idx, { byRoom: false, rooms: {} })}
                    style={{ border: 0, background: "transparent", color: "var(--ink-faint)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>恢复户级指派</button>
                </React.Fragment>
              ) : (
                <AssignPicker value={a.who} onChange={list => S.patchAsg(c.tk, c.idx, { who: list })} style={{ width: 200 }} />
              )}
              <button onClick={toggleExpanded}
                style={{ border: "1px solid var(--line-strong)", background: "#fff", color: "var(--brand-deep)", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {expanded ? "收起房间配置" : "房间级详细配置"}
              </button>
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={lbl}>暂估量（户级，{c.u}）</span>
                <input type="number" step="0.1" value={est} onChange={e => S.patchEst(c.tk, c.idx, +e.target.value || 0)}
                  style={{ ...inp, width: 88, textAlign: "right", fontFamily: "var(--font-mono)" }} />
              </span>
            </div>

            {/* 房间行明细：默认收起为小计摘要行（已按房间配置默认展开）；展开 = 合同量 | 现场计算式（实时求值） | 现场量（+ 房间指派列） */}
            {!showRooms ? (
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>合同量小计 <span style={{ fontWeight: 800, fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{fq(cSub)}{c.u}</span></span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>现场量小计 <span style={{ fontWeight: 800, fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{fq(sSub)}{c.u}{fb ? "*" : ""}</span></span>
                <span style={{ fontSize: 12, fontWeight: 800, color: profit >= 0 ? "var(--ok-ink)" : "var(--danger)" }}>毛利 {fM(profit)}</span>
                <button onClick={() => setShowRooms(true)} style={{ ...linkBtn, marginLeft: "auto" }}>展开房间明细（{mask.length} 间）</button>
              </div>
            ) : (
            <React.Fragment>
            <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 84 }} />
                  <col style={{ width: 116 }} />
                  <col />
                  <col style={{ width: 128 }} />
                  {expanded && <col style={{ width: 168 }} />}
                </colgroup>
                <thead>
                  <tr>
                    <th style={th}>房间</th>
                    <th style={{ ...th, textAlign: "right" }}>合同量（{c.u}）</th>
                    <th style={th}>现场计算式（实时求值）</th>
                    <th style={{ ...th, textAlign: "right" }}>现场量（{c.u}）</th>
                    {expanded && <th style={th}>房间指派</th>}
                  </tr>
                </thead>
                <tbody>
                  {ROOMS.map((r, ri) => {
                    const row = rooms.find(v => v.room === r);
                    const zebra = ri % 2 ? "var(--surface-2)" : "transparent";
                    if (!row) return (
                      <tr key={r} style={{ background: zebra }}>
                        <td style={{ ...td, color: "var(--ink-faint)" }}>{r}</td>
                        <td style={{ ...td, textAlign: "right", color: "var(--ink-faint)" }}>—</td>
                        <td style={{ ...td, color: "var(--ink-faint)", fontSize: 11 }}>不涉及该分项</td>
                        <td style={{ ...td, textAlign: "right", color: "var(--ink-faint)" }}>—</td>
                        {expanded && <td style={{ ...td, color: "var(--ink-faint)" }}>—</td>}
                      </tr>
                    );
                    return (
                      <tr key={r} style={{ background: zebra }}>
                        <td style={{ ...td, fontWeight: 600 }}>{r}</td>
                        <td style={{ ...td, textAlign: "right" }}>
                          <input type="number" step="0.1" value={row.contract}
                            onChange={e => S.patchRoom(c.tk, c.idx, r, { contract: +e.target.value || 0 })}
                            style={{ ...inp, textAlign: "right", fontFamily: "var(--font-mono)" }} />
                        </td>
                        <td style={td}>
                          <input value={row.expr} placeholder="如 2.6*2.4+1.8*2.4"
                            onChange={e => S.patchRoom(c.tk, c.idx, r, { site: e.target.value })}
                            style={{ ...inp, fontFamily: "var(--font-mono)", borderColor: row.invalid ? "var(--danger)" : "var(--line-strong)" }} />
                        </td>
                        <td style={{ ...td, textAlign: "right", fontFamily: "var(--font-mono)" }}>
                          {row.invalid
                            ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>算式无效</span>
                            : row.valid
                              ? <span style={{ color: "var(--brand-deep)", fontWeight: 700 }}>= {Math.round(row.val * 100) / 100}</span>
                              : <span style={{ color: "var(--ink-faint)" }}>回退 {fq(row.contract)}</span>}
                        </td>
                        {expanded && (
                          <td style={td}>
                            <AssignPicker
                              value={(a.rooms && a.rooms[r] != null && a.rooms[r] !== "") ? a.rooms[r] : a.who}
                              onChange={list => S.patchAsg(c.tk, c.idx, { byRoom: true, rooms: { ...(a.rooms || {}), [r]: list } })}
                              style={{ width: "100%" }} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ ...td, fontWeight: 800, background: "var(--surface-2)", borderTop: "1px solid var(--line-strong)", borderBottom: 0 }}>小计</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 800, fontFamily: "var(--font-mono)", background: "var(--surface-2)", borderTop: "1px solid var(--line-strong)", borderBottom: 0 }}>{fq(cSub)}{c.u}</td>
                    <td style={{ ...td, background: "var(--surface-2)", borderTop: "1px solid var(--line-strong)", borderBottom: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: profit >= 0 ? "var(--ok-ink)" : "var(--danger)" }}>毛利 {fM(profit)}</span>
                      <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>　=（¥{price} − ¥{cprice}）× {fq(sSub)}{c.u}</span>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 800, fontFamily: "var(--font-mono)", background: "var(--surface-2)", borderTop: "1px solid var(--line-strong)", borderBottom: 0 }}>{fq(sSub)}{c.u}{fb ? "*" : ""}</td>
                    {expanded && <td style={{ ...td, background: "var(--surface-2)", borderTop: "1px solid var(--line-strong)", borderBottom: 0 }} />}
                  </tr>
                </tfoot>
              </table>
            </div>
            {fb && <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: -6 }}>* 未录现场量（或算式无效）的房间按合同量回退计入小计</div>}
            {!expanded && <button onClick={() => setShowRooms(false)} style={{ ...linkBtn, alignSelf: "flex-start", marginTop: -4 }}>收起房间明细</button>}
            </React.Fragment>
            )}

            {/* 完成勾选（户级） + 验收照片 + 工序链卡点提示 */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", userSelect: "none" }}>
                <input type="checkbox" checked={done} onChange={() => S.toggleDone(c.tk, c.idx)} />
                本户完成
              </label>
              {done && (
                <input type="date" value={date} onChange={e => S.setDoneDate(c.tk, c.idx, e.target.value)}
                  style={{ border: "1px solid var(--line-strong)", borderRadius: 6, padding: "4px 8px", fontSize: 12, background: "#fff" }} />
              )}
              <span style={{ width: 1, height: 18, background: "var(--line)", margin: "0 2px" }} />
              <span style={lbl}>验收照片</span>
              {!needPhoto ? (
                <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>本分项无需验收照片</span>
              ) : (
                <React.Fragment>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    {Array.from({ length: photos }).map((_, i) => (
                      <span key={i} title={"验收照片 " + (i + 1)} style={{ width: 34, height: 34, borderRadius: 6, background: "var(--surface-3)", border: "1px solid var(--line)", display: "inline-grid", placeItems: "center" }}>
                        <Icon name="image" size={14} color="var(--ink-faint)" />
                      </span>
                    ))}
                    <button onClick={() => S.addPhoto(c.tk, c.idx)} title="上传验收照片"
                      style={{ width: 34, height: 34, borderRadius: 6, border: "1.5px dashed var(--line-strong)", background: "transparent", cursor: "pointer", display: "inline-grid", placeItems: "center", color: "var(--ink-soft)" }}>
                      <Icon name="plus" size={14} />
                    </button>
                  </span>
                  <span style={{ fontSize: 11, color: photos > 0 ? "var(--ink-soft)" : "var(--ink-faint)" }}>{photos > 0 ? "已传 " + photos + " 张" : "未传"}</span>
                  {done && photos === 0 && (
                    <span style={{ fontSize: 11, color: "var(--warn-ink)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Icon name="alert-triangle" size={12} color="var(--warn-ink)" />未传验收照片，下一道工序无法勾选完成
                    </span>
                  )}
                </React.Fragment>
              )}
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  window.QuantityUnitScreen = QuantityUnitScreen;
})();
