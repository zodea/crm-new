// QuantityScreenV2 — 工程量矩阵（分部 → 工种 → 分项；三量 / 完成勾选 / 验收照片 / 量差总表）
// 本轮（issue #39）：户格点击由 UnitModal 弹窗改为独立户详情页 —— navigate("quantityUnit", { building, floor, unit })；
//   UnitModal / ItemBlock 迁至 kit/QuantityUnitScreen.jsx；本页初始 state 合并 window.QTY_UNIT_STATE 写穿覆盖，
//   户详情页的完成勾选/验收照片/三量/指派返回本页后保持一致（刷新恢复初始 mock）。
// 沿用（issue #33+#37）：
//  ① 矩阵格子按完成状态渲染：全部分项完成=实色 / 部分=半透明+右下进度点 / 未开始=极浅；tooltip 加分项勾选状态与现场量
//  ② 量差总表：基准量可选（合同/暂估/现场，默认现场），分项×楼栋 汇总差异量与差异金额；未录现场量回退合同量标浅灰
// 保留：分部矩阵大视图骨架、下钻参数(drill)与上下文条、楼层角标、SettingsModal
(function () {
  const { Button, IconButton, Panel, Icon, StatusChip } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {} };

  const TRADES = {
    plumb: { key: "plumb", name: "水电工", div: "机电安装", color: "#10b981", crew: "水电班",
      items: [{ n: "给排水管", u: "m", price: 18, base: 42 }, { n: "强弱电管", u: "m", price: 12, base: 36 }] },
    water: { key: "water", name: "防水工", div: "防水工程", color: "#06b6d4", crew: "防水班",
      items: [{ n: "卫生间防水", u: "㎡", price: 25, base: 8 }, { n: "厨房防水", u: "㎡", price: 25, base: 5 }] },
    mason: { key: "mason", name: "泥水工", div: "装饰装修", color: "#6366f1", crew: "泥水A班",
      items: [{ n: "墙砖铺贴", u: "㎡", price: 38, base: 28 }, { n: "地砖铺贴", u: "㎡", price: 32, base: 18 }] },
    carp: { key: "carp", name: "木工", div: "装饰装修", color: "#f59e0b", crew: "木工一班",
      items: [{ n: "吊顶", u: "㎡", price: 45, base: 16 }, { n: "门套", u: "樘", price: 120, base: 4 }] },
  };
  const TRADE_ORDER = ["plumb", "water", "mason", "carp"];
  const DIVISIONS = [
    { key: "all", name: "全部分部" }, { key: "机电安装", name: "机电安装" },
    { key: "防水工程", name: "防水工程" }, { key: "装饰装修", name: "装饰装修" },
  ];
  // 户级默认指派（按工种×户号）
  const WORKER = {
    plumb: { "01户": ["周师傅"], "02户": ["周师傅"], "03户": ["阿杰"], "04户": ["阿杰"] },
    water: { "01户": ["郑师傅"], "02户": ["郑师傅"], "03户": ["郑师傅"], "04户": ["郑师傅"] },
    mason: { "01户": ["虞师傅"], "02户": ["匡师傅"], "03户": ["李师傅"], "04户": ["李师傅"] },
    carp: { "01户": ["孙师傅"], "02户": ["孙师傅"], "03户": ["阿强"], "04户": ["阿强"] },
  };
  const ASSIGNEES = ["周师傅", "阿杰", "郑师傅", "虞师傅", "匡师傅", "李师傅", "孙师傅", "阿强"];
  const CREWS = ["泥水A班", "水电班", "木工一班"];
  const ASSIGN_OPTS = [...ASSIGNEES.map(w => ({ v: w, l: w })), ...CREWS.map(c => ({ v: c, l: c + "（班组）" }))];
  const ROOMS = ["客厅", "主卧", "次卧", "厨房", "卫生间"];

  // 工序链：TRADE_ORDER 内 items 顺序展开（量差总表按此排序；完成勾选卡点逻辑在户详情页）
  const IKEY = (tk, idx) => tk + ":" + idx;
  const CHAIN = [];
  TRADE_ORDER.forEach(tk => TRADES[tk].items.forEach((it, idx) => CHAIN.push({ tk, idx, n: it.n, u: it.u, trade: TRADES[tk] })));

  // 完工月份（按施工先后累计已完成工种数；用于初始 mock 播种 + 首页联动口径）
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

  const R1 = v => Math.round(v * 10) / 10;

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

  // —— 完成勾选 + 验收照片初始播种：低楼层按完工月份大部分完成；38F 部分完成（半透明格 + 卡点演示）——
  function seedDone(mx, fm) {
    const dm = {}, pm = {};
    mx.buildings.forEach((b, bi) => mx.floors.forEach((f, fi) => {
      const m = fm[f];
      if (!m || !MONTH_MAP[m]) return;
      if (f === "38F" && m === CUR_MONTH) return;                 // 38F 走下方部分完成特例
      const lvl = MONTH_MAP[m].level;
      mx.units.forEach((u, ui) => {
        TRADE_ORDER.slice(0, lvl).forEach((tk, ti) => TRADES[tk].items.forEach((it, idx) => {
          const k = [b, f, u, IKEY(tk, idx)].join("|");
          const h = (bi * 5 + fi * 3 + ui * 7 + ti * 2 + idx) % 19;
          dm[k] = { done: true, date: m + "-" + String(9 + h).padStart(2, "0") };
          pm[k] = 1 + (h % 3);
        }));
      });
    }));
    if (fm["38F"] === CUR_MONTH) {
      mx.buildings.forEach(b => {
        const K = (u, tk, idx) => [b, "38F", u, IKEY(tk, idx)].join("|");
        // 01户：水电全完成(有照片)；卫生间防水完成但未传照片 → 勾「厨房防水」触发卡点
        dm[K("01户", "plumb", 0)] = { done: true, date: "2025-04-08" }; pm[K("01户", "plumb", 0)] = 2;
        dm[K("01户", "plumb", 1)] = { done: true, date: "2025-04-12" }; pm[K("01户", "plumb", 1)] = 1;
        dm[K("01户", "water", 0)] = { done: true, date: "2025-04-20" };
        // 02户：强弱电管完成但未传照片 → 勾「卫生间防水」触发卡点
        dm[K("02户", "plumb", 0)] = { done: true, date: "2025-04-09" }; pm[K("02户", "plumb", 0)] = 1;
        dm[K("02户", "plumb", 1)] = { done: true, date: "2025-04-13" };
        // 03户：仅给排水管完成 → 半透明+进度点演示；04户：未开始 → 极浅色演示
        dm[K("03户", "plumb", 0)] = { done: true, date: "2025-04-11" }; pm[K("03户", "plumb", 0)] = 1;
      });
    }
    return { dm, pm };
  }

  function QuantityScreenV2({ data, navigate, params }) {
    const mx = data.matrix;
    // ── 工序下钻参数（首页/施工进度页点甘特工序 → navigate("quantity", {group,trade,item,task,ps,pf,from})）──
    const drill = params && params.task ? params : null;
    const drillTrade = (() => {
      if (!drill) return null;
      const byItem = TRADE_ORDER.find(k => TRADES[k].items.some(it => drill.item && (it.n === drill.item || it.n.includes(drill.item))));
      if (byItem) return TRADES[byItem];
      const byName = { "泥水": "mason", "水电": "plumb", "木工": "carp", "防水": "water" }[drill.trade];
      return byName ? TRADES[byName] : null;
    })();
    const [building, setBuilding] = React.useState(() => {
      if (drill && window.SCHEDULE) {
        for (const pn in window.SCHEDULE.state) {
          const g = window.SCHEDULE.state[pn].groups.find(x => x.name === drill.group);
          if (g) { const hit = (g.buildings || []).find(b => mx.buildings.includes(b)); if (hit) return hit; }
        }
      }
      return mx.buildings[0];
    });
    const [division, setDivision] = React.useState(drillTrade ? drillTrade.div : "all");
    const [hideEmptyFloors, setHideEmptyFloors] = React.useState(true);
    const [floorMonth, setFloorMonth] = React.useState(() => ({ ...DEFAULT_FLOOR_MONTH }));
    const [prices, setPrices] = React.useState(() => {
      const o = {}; TRADE_ORDER.forEach(k => TRADES[k].items.forEach((it, i) => { o[IKEY(k, i)] = { price: it.price, qty: it.base }; })); return o;
    });
    // ── 完成勾选 / 验收照片 / 三量覆盖 / 指派覆盖（组件级 state，key = 栋|层|户|工种:分项）──
    //    录入动作全部在户详情页（QuantityUnitScreen），其编辑经 window.QTY_UNIT_STATE 写穿；
    //    本页挂载时合并该覆盖层：详情页勾完成/传照片/改量/改指派 → 返回后格子颜色、tooltip、量差总表保持一致
    const extAll = (field) => {
      const o = {};
      Object.values(window.QTY_UNIT_STATE || {}).forEach(s => Object.assign(o, s[field] || {}));
      return o;
    };
    const [seed] = React.useState(() => seedDone(mx, DEFAULT_FLOOR_MONTH));
    const [doneMap, setDoneMap] = React.useState(() => {
      const m = { ...seed.dm };
      Object.entries(extAll("dm")).forEach(([k, v]) => { if (v) m[k] = v; else delete m[k]; });
      return m;
    });
    const [photoMap, setPhotoMap] = React.useState(() => ({ ...seed.pm, ...extAll("pm") }));
    const [qs] = React.useState(() => extAll("qs"));              // { key: { contract?, est?, site? } }
    const [asg] = React.useState(() => extAll("asg"));            // { key: { who, byRoom, rooms } }
    const [tooltip, setTooltip] = React.useState(null);
    const [settings, setSettings] = React.useState(false);
    const [variance, setVariance] = React.useState(false);

    const keyOf = (b, f, u, tk, idx) => b + "|" + f + "|" + u + "|" + IKEY(tk, idx);

    // ── 三量：默认值确定性生成，覆盖值存 qs ──
    const qtyOf = (b, f, u, tk, idx) => {
      const bi = mx.buildings.indexOf(b), fi = mx.floors.indexOf(f), ui = mx.units.indexOf(u), ti = TRADE_ORDER.indexOf(tk);
      const base = (prices[IKEY(tk, idx)] || {}).qty || TRADES[tk].items[idx].base;
      const raw = base + ((bi * 7 + fi * 3 + ui * 5 + idx * 2 + ti * 4) % 13);
      return TRADES[tk].items[idx].u === "樘" ? Math.round(raw / 4) + 1 : R1(raw);
    };
    const defEst = (b, f, u, tk, idx) => {
      const q = qtyOf(b, f, u, tk, idx);
      if (TRADES[tk].items[idx].u === "樘") return q;
      const d = ((mx.floors.indexOf(f) + mx.units.indexOf(u) * 2 + idx * 3 + TRADE_ORDER.indexOf(tk)) % 5) - 2;
      return R1(q + d * 0.6);
    };
    // 早期完工楼层（1栋）预填现场量计算式，演示量差；38F/未开工不预填
    const defSiteExpr = (b, f, u, tk, idx) => {
      if (b !== "1栋") return "";
      const m = DEFAULT_FLOOR_MONTH[f];
      if (!m || m === CUR_MONTH) return "";
      if (TRADE_ORDER.indexOf(tk) >= (MONTH_MAP[m] ? MONTH_MAP[m].level : 0)) return "";
      const q = qtyOf(b, f, u, tk, idx);
      if (TRADES[tk].items[idx].u === "樘") return String(q);
      const h = (mx.floors.indexOf(f) * 5 + mx.units.indexOf(u) * 3 + idx * 7 + TRADE_ORDER.indexOf(tk)) % 7;
      const w = (q + (h - 2) * 0.8) / 2.4;
      const a = R1(w * 0.58), b2 = R1(w - a);
      return a + "*2.4+" + b2 + "*2.4";
    };
    const getQB = (b, f, u, tk, idx) => {
      const o = qs[keyOf(b, f, u, tk, idx)] || {};
      const contract = o.contract != null ? o.contract : qtyOf(b, f, u, tk, idx);
      const est = o.est != null ? o.est : defEst(b, f, u, tk, idx);
      const siteExpr = o.site != null ? o.site : defSiteExpr(b, f, u, tk, idx);
      return { contract, est, siteExpr, siteVal: evalExpr(siteExpr) };
    };
    const getQ = (f, u, tk, idx) => getQB(building, f, u, tk, idx);
    const priceOf = (tk, idx) => (prices[IKEY(tk, idx)] || {}).price || TRADES[tk].items[idx].price;

    // ── 指派：默认 WORKER 户级，覆盖来自户详情页写穿的 asg ──
    const getAsg = (f, u, tk, idx) => asg[keyOf(building, f, u, tk, idx)] || { who: (WORKER[tk][u] || [""])[0] || "", byRoom: false, rooms: {} };
    const whoOf = (f, u, tk) => {
      const ws = [];
      TRADES[tk].items.forEach((it, i) => {
        const a = getAsg(f, u, tk, i);
        const w = a.byRoom ? "按房间配置" : (a.who || "未指派");
        if (!ws.includes(w)) ws.push(w);
      });
      return ws.join(" / ");
    };

    // ── 完成勾选（勾选/照片录入在户详情页，本页只读渲染）──
    const isDone = (f, u, tk, idx) => !!doneMap[keyOf(building, f, u, tk, idx)];

    // ── 完成状态聚合：格子着色 / 楼层判定 ──
    const tradeStat = (f, u, tk) => {
      const its = TRADES[tk].items;
      let dn = 0; its.forEach((it, i) => { if (isDone(f, u, tk, i)) dn++; });
      return { dn, tot: its.length };
    };
    const tradeFloorDone = (f, tk) => mx.units.every(u => TRADES[tk].items.every((it, i) => isDone(f, u, tk, i)));
    const floorStarted = (f) => !!floorMonth[f] || mx.units.some(u => TRADE_ORDER.some(tk => TRADES[tk].items.some((it, i) => isDone(f, u, tk, i))));
    const floors = hideEmptyFloors ? mx.floors.filter(floorStarted) : mx.floors;
    const hiddenCount = mx.floors.length - floors.length;
    const shownTrades = TRADE_ORDER.map(k => TRADES[k]).filter(t => division === "all" || t.div === division);

    // ── SettingsModal 改完工月份 → 重播种对应楼层的完成勾选/照片（保持「设置驱动矩阵」的闭环）──
    const applyFloorMonth = (upd) => {
      const next = typeof upd === "function" ? upd(floorMonth) : upd;
      const changed = mx.floors.filter(f => floorMonth[f] !== next[f]);
      if (changed.length) {
        const s = seedDone(mx, next);
        const merge = (m, seeded) => {
          const o = {};
          Object.keys(m).forEach(k => { if (!changed.includes(k.split("|")[1])) o[k] = m[k]; });
          Object.keys(seeded).forEach(k => { if (changed.includes(k.split("|")[1])) o[k] = seeded[k]; });
          return o;
        };
        setDoneMap(m => merge(m, s.dm));
        setPhotoMap(m => merge(m, s.pm));
      }
      setFloorMonth(next);
    };

    // ── 下钻角标：该层「计划应完成 vs 实际完成」（完成判定改走完成勾选状态）──
    const drillBadge = (floor) => {
      if (!drill || !drill.ps || !drill.pf) return null;
      const dMs = 86400000, today = new Date("2026-06-30");
      const tot = Math.max((new Date(drill.pf) - new Date(drill.ps)) / dMs, 1);
      const pct = Math.max(0, Math.min(1, (today - new Date(drill.ps)) / dMs / tot));
      const rank = mx.floors.length - mx.floors.indexOf(floor);
      const expectDone = Math.round(pct * mx.floors.length);
      const done = drillTrade ? tradeFloorDone(floor, drillTrade.key) : !!floorMonth[floor];
      if (done) return { tone: "ok", tip: floor + " " + (drillTrade ? drillTrade.name : "") + "已完成（" + MONTH_LABEL(floorMonth[floor]) + "）· 按计划" };
      if (rank <= expectDone) return { tone: "danger", tip: floor + " 计划应已完成 · 实际未完成（延后）" };
      return null;
    };

    const showTip = (e, floor, unit) => {
      if (!floorStarted(floor)) { setTooltip(null); return; }
      const rect = e.currentTarget.getBoundingClientRect();
      const trades = shownTrades.map(t => ({
        key: t.key, name: t.name, color: t.color, who: whoOf(floor, unit, t.key),
        items: t.items.map((it, i) => {
          const q = getQ(floor, unit, t.key, i);
          const valid = q.siteVal != null && !isNaN(q.siteVal);
          return { n: it.n, u: it.u, done: isDone(floor, unit, t.key, i), val: valid ? q.siteVal : q.contract, fallback: !valid };
        }),
      }));
      setTooltip({ x: rect.right + 10, y: rect.top - 6, floor, unit, trades, month: floorMonth[floor] });
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>

        {tooltip && (
          <div style={{ position: "fixed", left: Math.min(tooltip.x, window.innerWidth - 300), top: Math.max(8, Math.min(tooltip.y, window.innerHeight - 360)), zIndex: 100, width: 278, background: "var(--panel)", border: "1px solid var(--line-strong)", borderRadius: 10, boxShadow: "var(--shadow-pop)", padding: 12, pointerEvents: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>{building} · {tooltip.floor} · {tooltip.unit}</span>
              {tooltip.month && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-soft)" }}>{MONTH_LABEL(tooltip.month)}</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {tooltip.trades.map((t, i) => (
                <div key={i}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: t.color, flex: "none" }} />
                    <span style={{ fontSize: 12, fontWeight: 700, flex: "none" }}>{t.name}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-soft)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>{t.who}</span>
                  </div>
                  {t.items.map((it, k) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 16, marginTop: 2 }}>
                      <span style={{ fontSize: 11, width: 12, flex: "none", fontWeight: 800, color: it.done ? "var(--ok)" : "var(--ink-faint)" }}>{it.done ? "✓" : "○"}</span>
                      <span style={{ fontSize: 11, flex: 1, color: "var(--ink)" }}>{it.n}<span style={{ color: "var(--ink-faint)" }}>{it.done ? " 已完成" : " 未完成"}</span></span>
                      <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: it.fallback ? "var(--ink-faint)" : "var(--ink)" }}>{R1(it.val)}{it.u}{it.fallback ? "(合同)" : ""}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--ink-faint)" }}>现场量未录时回退合同量 · 点击进入户详情页（三量/指派/完成勾选）</div>
          </div>
        )}

        {/* 下钻上下文条（来自施工进度甘特） */}
        {drill && (
          <Panel padding={10} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--brand-soft)", border: "1px solid rgba(57,118,198,0.28)" }}>
            <Icon name="git-branch" size={15} color="var(--brand)" />
            <span style={{ fontSize: 13 }}>
              来自施工进度：<b>{drill.group}</b> · <b>{drill.task}</b>
              <span style={{ color: "var(--ink-soft)" }}>（计划 {drill.ps.replace(/-/g, ".")} ~ {drill.pf.replace(/-/g, ".")}）</span>
              {drillTrade && <span style={{ color: "var(--brand-deep)", fontWeight: 600 }}> · 已定位到「{drillTrade.div}」分部 / {drillTrade.name}</span>}
            </span>
            <span style={{ marginLeft: "auto" }}>
              <Button size="sm" variant="secondary" icon="arrow-left" onClick={() => navigate(drill.from === "home" ? "home" : "schedule")}>
                返回{drill.from === "home" ? "首页" : "施工进度"}
              </Button>
            </span>
          </Panel>
        )}

        {/* 头部（反馈轮8 六1：两行压一行 + 长提示条收进「图例」弹层；六2：设置弹窗废弃 → 工程量清单为配置源） */}
        <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <select onChange={() => UI().toast("已切换项目/班组")} style={{ border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", padding: "7px 10px", fontSize: 13, fontWeight: 600, background: "#fff", cursor: "pointer" }}>
            <option>合和新城</option><option>锦绣华庭</option>
          </select>
          <div style={{ display: "flex", gap: 6 }}>
            {mx.buildings.map(b => (
              <button key={b} onClick={() => setBuilding(b)} style={{
                border: "1px solid", borderColor: building === b ? "var(--brand)" : "var(--line)",
                background: building === b ? "var(--brand)" : "#fff", color: building === b ? "#fff" : "var(--ink)",
                borderRadius: "var(--radius-btn)", padding: "7px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer"
              }}>{b}</button>
            ))}
          </div>
          <span style={{ width: 1, height: 22, background: "var(--line)", margin: "0 2px" }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DIVISIONS.map(d => {
              const on = division === d.key;
              return (
                <button key={d.key} onClick={() => setDivision(d.key)} style={{
                  border: "1px solid", borderColor: on ? "var(--brand)" : "var(--line)",
                  background: on ? "var(--brand-soft)" : "#fff", color: on ? "var(--brand-deep)" : "var(--ink-soft)",
                  borderRadius: 999, padding: "5px 14px", fontSize: 13, fontWeight: on ? 700 : 500, cursor: "pointer",
                }}>{d.name}</button>
              );
            })}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", userSelect: "none", color: "var(--ink-soft)" }}>
              <input type="checkbox" checked={hideEmptyFloors} onChange={e => setHideEmptyFloors(e.target.checked)} />
              隐藏未开工楼层{hiddenCount > 0 ? "（" + hiddenCount + "）" : ""}
            </label>
            <IconButton icon="circle-help" title="图例与操作说明" onClick={() => UI().modal({
              title: "图例与操作说明", width: 460,
              bodyHTML: '<div style="font-size:13px;line-height:2;color:var(--ink)">' +
                '<div>· 格子颜色 = 该户各分项<b>完成勾选</b>状态：实色=全完成 / 半透明=部分 / 极浅=未开始</div>' +
                '<div>· 点击户格进入<b>户详情页</b>：录三量 · 指派 · 完成勾选 · 验收照片</div>' +
                '<div>· <b>量差总表</b>：合同量 vs 暂估/现场量的差异数量与金额（分项×楼栋）</div>' +
                '<div>· 分项目录与合同量来自<b>工程量清单</b>（合同附件拆表入库）；各层计划时间由施工进度自动分摊</div>' +
                "</div>",
            })} />
            <Button size="sm" icon="list-tree" onClick={() => navigate("quantityStages")}>阶段配置</Button>
            <Button size="sm" icon="table-2" onClick={() => setVariance(true)}>量差总表</Button>
            <Button size="sm" icon="download" onClick={() => UI().toast("正在导出工程量 Excel…")}>导出</Button>
            <Button size="sm" variant="primary" icon="clipboard-list" onClick={() => navigate("boqList", { project: "合和新城", contract: "合和七期户内合同版-清单" })}>工程量清单</Button>
          </div>
        </Panel>

        {/* 矩阵 */}
        <Panel padding={10}>
          <div style={{ overflow: "auto" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 420, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 80 }} />
                {mx.units.map(u => <col key={u} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, zIndex: 2, background: "var(--surface-2)", border: "1px solid var(--line)", padding: "9px 12px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>楼层</th>
                  {mx.units.map(u => (
                    <th key={u} style={{ background: "var(--surface-2)", border: "1px solid var(--line)", padding: "8px 10px", fontSize: 13, fontWeight: 700, textAlign: "center", color: "var(--ink)" }}>{u}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {floors.map(f => {
                  const fBadge = drillBadge(f);
                  const started = floorStarted(f);
                  return (
                  <tr key={f}>
                    <th style={{ position: "sticky", left: 0, zIndex: 1, background: "var(--panel)", border: "1px solid var(--line)", padding: "0 12px", fontSize: 13, fontWeight: 800, fontFamily: "var(--font-mono)", color: "var(--ink)", whiteSpace: "nowrap", textAlign: "left" }}>
                      {f}
                      {fBadge && (
                        <span title={fBadge.tip} style={{ position: "absolute", top: 0, right: 0, width: 0, height: 0, cursor: "help",
                          borderTop: "11px solid var(--" + fBadge.tone + ")", borderLeft: "11px solid transparent" }} />
                      )}
                    </th>
                    {mx.units.map(u => {
                      const cur = floorMonth[f] === CUR_MONTH && started;
                      return (
                        <td key={u} style={{ border: "1px solid var(--line)", padding: 0, height: 46, background: "var(--surface-2)" }}>
                          {started ? (
                            <button onMouseEnter={e => showTip(e, f, u)} onMouseLeave={() => setTooltip(null)}
                              onClick={() => { setTooltip(null); navigate("quantityUnit", { building, floor: f, unit: u }); }}
                              title="点击进入户详情页"
                              style={{ width: "100%", height: "100%", border: cur ? "2px solid var(--brand)" : 0, borderRadius: cur ? 6 : 0, padding: 4, cursor: "pointer", display: "flex", gap: 3, background: "transparent" }}>
                              {shownTrades.map(t => {
                                const { dn, tot } = tradeStat(f, u, t.key);
                                const full = dn === tot, part = dn > 0 && !full;
                                return (
                                  <span key={t.key} title={t.name + " " + dn + "/" + tot} style={{ flex: 1, position: "relative", borderRadius: 4 }}>
                                    <span style={{ position: "absolute", inset: 0, borderRadius: 4, background: t.color, opacity: full ? 0.92 : part ? 0.4 : 0.1 }} />
                                    {part && <span style={{ position: "absolute", right: 1, bottom: 1, width: 6, height: 6, borderRadius: "50%", background: t.color, border: "1.5px solid #fff" }} />}
                                  </span>
                                );
                              })}
                            </button>
                          ) : (
                            <div style={{ width: "100%", height: "100%", background: "#fff" }} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10, fontSize: 11, color: "var(--ink-soft)", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700 }}>工种：</span>
            {shownTrades.map(t => (
              <span key={t.key} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 14, height: 10, borderRadius: 3, background: t.color, opacity: 0.92, display: "inline-block" }} />{t.name}
              </span>
            ))}
            <span style={{ fontWeight: 700, marginLeft: 4 }}>完成度：</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 14, height: 10, borderRadius: 3, background: "#6366f1", opacity: 0.92, display: "inline-block" }} />全部分项完成
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 14, height: 10, borderRadius: 3, position: "relative", display: "inline-block" }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: 3, background: "#6366f1", opacity: 0.4 }} />
                <span style={{ position: "absolute", right: 0, bottom: 0, width: 5, height: 5, borderRadius: "50%", background: "#6366f1", border: "1px solid #fff" }} />
              </span>部分完成
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 14, height: 10, borderRadius: 3, background: "#6366f1", opacity: 0.1, border: "1px solid var(--line)", display: "inline-block" }} />未开始
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 14, height: 10, borderRadius: 3, border: "2px solid var(--brand)", display: "inline-block" }} />本月在施
            </span>
            {drill && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700 }}>计划角标：</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 0, height: 0, borderTop: "10px solid var(--ok)", borderLeft: "10px solid transparent", display: "inline-block" }} />按计划完成</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 0, height: 0, borderTop: "10px solid var(--danger)", borderLeft: "10px solid transparent", display: "inline-block" }} />计划已到未完成</span>
              </span>
            )}
            <span style={{ marginLeft: "auto" }}>每户一格 · 格内按工种分块 · hover 看分项勾选/现场量 · <b style={{ color: "var(--brand-deep)" }}>点击户格 → 户详情页（三量 / 指派 / 完成勾选 / 验收照片）</b></span>
          </div>
        </Panel>

        {variance && (
          <VarianceModal mx={mx} floorsStarted={mx.floors.filter(f => floorMonth[f])}
            getQB={getQB} priceOf={priceOf} onClose={() => setVariance(false)} />
        )}

        {settings && (
          <SettingsModal mx={mx} floorMonth={floorMonth} setFloorMonth={applyFloorMonth} prices={prices} setPrices={setPrices}
            onClose={() => setSettings(false)} onSaved={() => { setSettings(false); UI().toast("已保存设置，矩阵已更新", "ok"); }} />
        )}
      </div>
    );
  }

  // —— 户详情（UnitModal / ItemBlock）已迁至 kit/QuantityUnitScreen.jsx（issue #39 独立页）——

  // —— 量差总表（#37）：分项×楼栋 汇总，基准量可选（合同/暂估/现场，默认现场）——
  function VarianceModal({ mx, floorsStarted, getQB, priceOf, onClose }) {
    const [base, setBase] = React.useState("site");
    const BASES = [{ k: "contract", l: "合同量" }, { k: "est", l: "暂估量" }, { k: "site", l: "现场量" }];
    const rows = [];
    CHAIN.forEach(c => {
      mx.buildings.forEach((b, bi) => {
        let ct = 0, et = 0, st = 0, fb = false;
        floorsStarted.forEach(f => mx.units.forEach(u => {
          const q = getQB(b, f, u, c.tk, c.idx);
          ct += q.contract; et += q.est;
          const ok = q.siteVal != null && !isNaN(q.siteVal);
          if (ok) st += q.siteVal; else { st += q.contract; fb = true; }
        }));
        const bv = base === "contract" ? ct : base === "est" ? et : st;
        const diff = bv - ct, price = priceOf(c.tk, c.idx);
        rows.push({ c, b, first: bi === 0, ct, et, st, fb, diff, price, amt: diff * price });
      });
    });
    const totalAmt = rows.reduce((s, r) => s + r.amt, 0);
    const fq = v => R1(v).toLocaleString();
    const dCol = d => Math.abs(d) < 0.05 ? "var(--ink-soft)" : d > 0 ? "var(--danger)" : "var(--ok)";
    const fD = (d, u) => Math.abs(d) < 0.05 ? "—" : (d > 0 ? "+" : "−") + fq(Math.abs(d)) + (u || "");
    const fA = a => Math.abs(a) < 0.5 ? "—" : (a > 0 ? "+" : "−") + "¥" + Math.round(Math.abs(a)).toLocaleString();
    const th = { padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", borderBottom: "1px solid var(--line)", textAlign: "right", whiteSpace: "nowrap" };
    const td = { padding: "7px 10px", fontSize: 12, textAlign: "right", fontFamily: "var(--font-mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 24 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: "var(--panel)", borderRadius: 12, width: 860, maxWidth: "96vw", maxHeight: "88vh", overflow: "auto", boxShadow: "var(--shadow-pop)" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--panel)", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>量差总表</div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
                  分项 × 楼栋 汇总 · 统计范围：已开工楼层（{floorsStarted.length} 层 × {mx.units.length} 户）· 未录现场量的户回退合同量（现场量列浅灰）
                </div>
              </div>
              <button onClick={onClose} style={{ marginLeft: "auto", border: 0, background: "transparent", cursor: "pointer", fontSize: 22, lineHeight: 1, color: "var(--ink-soft)" }}>×</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>差异基准</span>
              {BASES.map(o => (
                <label key={o.k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, cursor: "pointer", userSelect: "none",
                  fontWeight: base === o.k ? 700 : 500, color: base === o.k ? "var(--brand-deep)" : "var(--ink-soft)" }}>
                  <input type="radio" name="qv-base" checked={base === o.k} onChange={() => setBase(o.k)} />{o.l}
                </label>
              ))}
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>差异量 = 基准量 − 合同量 · 差异金额 = 差异量 × 单价</span>
            </div>
          </div>

          <div style={{ padding: "0 0 4px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "17%" }} /><col style={{ width: "8%" }} />
                <col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} />
                <col style={{ width: "13%" }} /><col style={{ width: "9%" }} /><col style={{ width: "17%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>分项</th>
                  <th style={{ ...th, textAlign: "left" }}>楼栋</th>
                  <th style={th}>合同量</th>
                  <th style={th}>暂估量</th>
                  <th style={th}>现场量</th>
                  <th style={th}>差异量</th>
                  <th style={th}>单价</th>
                  <th style={th}>差异金额</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {r.first && (
                      <td rowSpan={mx.buildings.length} style={{ ...td, textAlign: "left", fontFamily: "inherit", verticalAlign: "top", paddingTop: 9 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: r.c.trade.color, flex: "none" }} />
                          <span style={{ fontWeight: 700 }}>{r.c.n}</span>
                          <span style={{ color: "var(--ink-faint)", fontSize: 11 }}>({r.c.u})</span>
                        </span>
                      </td>
                    )}
                    <td style={{ ...td, textAlign: "left", fontFamily: "inherit" }}>{r.b}</td>
                    <td style={td}>{fq(r.ct)}</td>
                    <td style={td}>{fq(r.et)}</td>
                    <td style={{ ...td, color: r.fb ? "var(--ink-faint)" : "var(--ink)" }} title={r.fb ? "含未录现场量的户（回退合同量）" : undefined}>{fq(r.st)}{r.fb ? "*" : ""}</td>
                    <td style={{ ...td, fontWeight: 700, color: dCol(r.diff) }}>{fD(r.diff, r.c.u)}</td>
                    <td style={td}>¥{r.price}</td>
                    <td style={{ ...td, fontWeight: 700, color: dCol(r.amt) }}>{fA(r.amt)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} style={{ ...td, textAlign: "right", fontFamily: "inherit", fontWeight: 800, background: "var(--surface-2)", borderTop: "2px solid var(--line-strong)" }}>
                    合计差异金额（基准：{BASES.find(o => o.k === base).l}）
                  </td>
                  <td style={{ ...td, fontWeight: 800, fontSize: 13, color: dCol(totalAmt), background: "var(--surface-2)", borderTop: "2px solid var(--line-strong)" }}>{fA(totalAmt)}</td>
                </tr>
              </tfoot>
            </table>
            <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--ink-faint)" }}>* 该行含未录现场量的户（已回退合同量计入）· 差异为正 = 超出合同（红）· 为负 = 少于合同（绿）</div>
          </div>
        </div>
      </div>
    );
  }

  // —— 设置：①逐楼层完工月份（实时驱动矩阵 + 重播种完成勾选）②分项单价/默认量 ——
  function SettingsModal({ mx, floorMonth, setFloorMonth, prices, setPrices, onClose, onSaved }) {
    const [seg, setSeg] = React.useState("month");
    const rows = [];
    TRADE_ORDER.forEach(k => TRADES[k].items.forEach((it, i) => rows.push({ key: IKEY(k, i), trade: TRADES[k].name, color: TRADES[k].color, item: it.n, u: it.u })));
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 24 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: "var(--panel)", borderRadius: 12, width: 580, maxHeight: "84vh", overflow: "auto", boxShadow: "var(--shadow-pop)" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, background: "var(--panel)" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>设置工程量 / 完工时间</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{mx.buildings[0]} · 修改即时反映到矩阵与首页进度</div>
            </div>
            <button onClick={onClose} style={{ marginLeft: "auto", border: 0, background: "transparent", cursor: "pointer", fontSize: 22, lineHeight: 1, color: "var(--ink-soft)" }}>×</button>
          </div>

          <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--line)", padding: "0 16px" }}>
            {[{ k: "month", l: "各楼层完工月份" }, { k: "price", l: "分项单价 / 默认量" }].map(s => (
              <button key={s.k} onClick={() => setSeg(s.k)} style={{ border: 0, background: "transparent", cursor: "pointer", padding: "10px 14px", marginBottom: -1, fontSize: 13, fontWeight: seg === s.k ? 700 : 500, color: seg === s.k ? "var(--brand-deep)" : "var(--ink-soft)", borderBottom: seg === s.k ? "2px solid var(--brand)" : "2px solid transparent" }}>{s.l}</button>
            ))}
          </div>

          <div style={{ padding: 20 }}>
            {seg === "month" && (
              <div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 12 }}>设定每层完工月份：越早的月份完成工种越多（水电→防水→泥水→木工），并按此重置该层完成勾选；选「未开工」则该层留白并可被隐藏。</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {mx.floors.map(f => (
                    <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)" }}>
                      <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "var(--font-mono)", width: 44 }}>{f}</span>
                      <select value={floorMonth[f] || ""} onChange={e => setFloorMonth(p => ({ ...p, [f]: e.target.value || null }))}
                        style={{ flex: 1, border: "1px solid var(--line-strong)", borderRadius: 6, padding: "6px 8px", fontSize: 13, background: "#fff", cursor: "pointer" }}>
                        <option value="">未开工</option>
                        {MONTHS.map(m => <option key={m.key} value={m.key}>{m.label}（{m.level} 个工种）</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {seg === "price" && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  {["工种", "分项", "单价", "默认量"].map((h, i) => <th key={h} style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, background: "var(--surface-2)", textAlign: i < 2 ? "left" : "center", borderBottom: "1px solid var(--line)" }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "9px 10px", fontSize: 13 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: r.color }} />{r.trade}</span></td>
                      <td style={{ padding: "9px 10px", fontSize: 13, fontWeight: 600 }}>{r.item}<span style={{ color: "var(--ink-faint)", fontWeight: 400 }}> ({r.u})</span></td>
                      <td style={{ padding: "9px 10px", textAlign: "center" }}>
                        <input type="number" value={prices[r.key].price} onChange={e => setPrices(p => ({ ...p, [r.key]: { ...p[r.key], price: +e.target.value } }))} style={{ width: 70, border: "1px solid var(--line-strong)", borderRadius: 6, padding: "5px 8px", fontSize: 13, textAlign: "right" }} />
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "center" }}>
                        <input type="number" value={prices[r.key].qty} onChange={e => setPrices(p => ({ ...p, [r.key]: { ...p[r.key], qty: +e.target.value } }))} style={{ width: 70, border: "1px solid var(--line-strong)", borderRadius: 6, padding: "5px 8px", fontSize: 13, textAlign: "right" }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 8, position: "sticky", bottom: 0, background: "var(--panel)" }}>
            <button onClick={onClose} style={{ border: "1px solid var(--line)", background: "var(--surface-2)", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>取消</button>
            <button onClick={onSaved} style={{ border: 0, background: "var(--brand)", color: "#fff", borderRadius: 8, padding: "8px 18px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>完成</button>
          </div>
        </div>
      </div>
    );
  }

  window.AppQuantityScreen = QuantityScreenV2;
})();
