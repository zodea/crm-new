// WageSlipScreen — 工资进度款工具 = 挂在同一套数上的「调参器」（#117 D1：数字只有一套）
//   工程量只读，从 window.WAGE 按 户型×分项×施工人 聚合——与工资核算请款簿/核对表/A4 同数；
//   台账与正式单据在「工资核算」（班组瀑布卡 → 请款簿总表 → 核对两步流 + A4 格式族）；工程量修改去「工程量管理」。
// D5：空鼓页签由手填改为从户记录聚合只读（扣款启动在请款簿内）；
// 「进度%参考/本期支付总额权重分摊」等调参项去留待 grill 定稿（#117 未决⑥），暂保持现状。
// 人名与名册统一；点击人名 → 该人所在请款簿（payrollDetail）。
// 清单：同分项同人合并一行、异人拆行（房间备注）；两种归属：个人计件(管理费可按人配) / 班组整包(班组内分配)。
// 叠加：房租补贴、工资表(银行信息联动)、考勤(按出勤预填)、空鼓扣罚。
(function () {
  const { Button, Panel, StatusChip, Icon, IconButton } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
  const money = (v) => (Number.isFinite(+v) ? (+v).toFixed(2) : "0.00");
  const fmt = (v) => { const n = +v; return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };

  const BANK = {
    "虞建华": "农行 石楼支行 6212****4918", "匡志强": "工行 天河支行 6222****8890", "孙大勇": "建行 番禺支行 6217****5567",
    "张建国": "农行 海珠支行 6228****7712", "王芳（虞嫂）": "招行 广州分行 6225****9931", "赵铁柱": "农行 石楼支行 6212****4408",
    "周伟峰": "农行 广州分行 6228****1055", "刘水生": "工行 天河支行 6222****3341", "郑春明": "建行 天河支行 6217****2033",
  };
  const CREW_MEMBERS = { "泥水A班": ["虞建华", "匡志强", "孙大勇", "张建国", "王芳（虞嫂）"], "木工一班": ["周伟峰", "郑春明"], "水电班": ["刘水生", "阿杰"], "防水班": ["郑春明", "老吴"] };

  const TH = { padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid var(--line)" };
  const TD = { padding: "7px 10px", fontSize: 12, borderBottom: "1px solid var(--line)" };
  const numTD = { ...TD, textAlign: "right", fontFamily: "var(--font-mono)" };
  function Inp({ value, onChange, type, align, w, bold }) {
    const [f, setF] = React.useState(false);
    return React.createElement("input", { type: type || "text", value: value == null ? "" : value, onChange, onFocus: () => setF(true), onBlur: () => setF(false),
      style: { width: w || "100%", boxSizing: "border-box", border: 0, borderBottom: f ? "1.5px solid var(--brand)" : "1px solid transparent", background: f ? "var(--brand-soft)" : "transparent", padding: "5px 6px", fontSize: 12, fontWeight: bold ? 800 : 400, fontFamily: type === "number" ? "var(--font-mono)" : "inherit", textAlign: align || "left", outline: "none", borderRadius: 3, color: bold ? "var(--brand)" : "var(--ink)" } });
  }

  function WageSlipScreen({ data, params, navigate }) {
    const W = window.WAGE;
    const [ready, setReady] = React.useState(!!W);
    React.useEffect(() => { if (!W) { const t = setInterval(() => { if (window.WAGE) { clearInterval(t); setReady(true); } }, 60); return () => clearInterval(t); } }, []);
    if (!ready || !window.WAGE) return <Panel padding={40} style={{ textAlign: "center", color: "var(--ink-soft)" }}>配置加载中…</Panel>;

    const WA = window.WAGE;
    const [building, setBuilding] = React.useState(WA.BUILDINGS[0]);
    const [tradeKey, setTradeKey] = React.useState("mason");
    const [settings, setSettings] = React.useState({ progress: 95, roundTo: 100, prevPaid: 0, payTotal: "", rentEnabled: true, mgrEnabled: true, period: "2025年11月" });
    const [manual, setManual] = React.useState({});
    const [pay, setPay] = React.useState({}); // 班组整包分配：who -> {gross,borrow,days}
    const [hollowRate, setHollowRate] = React.useState(30);   // 单处扣款（建档默认 30 元/处，可调参）
    const [att, setAtt] = React.useState({});
    const [tab, setTab] = React.useState("list");

    const T = WA.TRADES[tradeKey];
    const cfg = WA.config;
    const rentRate = cfg.rentRate, mgrName = cfg.managerName, mgrRate = cfg.managerRate;
    const rows = WA.payrollRows(tradeKey, building);

    // —— 汇总 per 施工人 ——
    const map = {};
    const ensure = (who, mode) => map[who] || (map[who] = { who, mode, eng: 0, rentQty: 0, rent: 0, mgr: 0, adjust: 0, prev: 0, hollow: 0, hollowAmt: 0, due: 0, progressDue: 0, payable: 0, remark: "" });
    rows.forEach((r) => { const s = ensure(r.who, r.mode); s.eng += r.amount; if (r.item === "墙砖" || r.item === "地砖") s.rentQty += r.qty; });
    const noMgr = (who) => (manual[who] && manual[who].noMgr) || (cfg.managerExcluded || []).indexOf(who) >= 0;
    if (settings.mgrEnabled && T.mode === "worker") {
      let mq = 0; rows.forEach((r) => { if ((r.item === "墙砖" || r.item === "地砖") && r.who !== mgrName && !noMgr(r.who)) mq += r.qty; });
      if (mq) ensure(mgrName, "worker").mgr = Math.round(mq * mgrRate * 100) / 100;
    }
    Object.values(map).forEach((s) => {
      const m = manual[s.who] || {};
      s.rent = settings.rentEnabled ? Math.round(s.rentQty * rentRate * 100) / 100 : 0;
      s.adjust = +m.adjust || 0; s.prev = +m.prev || 0; s.remark = m.remark || "";
      s.hollow = WA.hollowAgg ? WA.hollowAgg([s.who]).unfixed : 0;   // D5：从户记录聚合（仍未整改处数），不再手填
      s.hollowAmt = s.hollow * (+hollowRate || 0);
      s.due = Math.round((s.eng + s.rent + s.mgr + s.adjust - s.hollowAmt) * 100) / 100;
      s.progressDue = Math.round(s.due * (settings.progress / 100) * 100) / 100;
      s.payable = Math.floor((s.progressDue - s.prev) / Math.max(1, settings.roundTo)) * Math.max(1, settings.roundTo);
    });
    // 反馈轮8（九）：进度比例只是参考——「本期支付总额」直接给总数时按各人(进度应发−已发)权重分摊；「实发」可逐人直改（优先级最高）
    {
      const arr = Object.values(map);
      const payTotalN = parseFloat(settings.payTotal);
      if (!isNaN(payTotalN) && payTotalN > 0) {
        const baseSum = arr.reduce((s2, r) => s2 + Math.max(0, r.progressDue - r.prev), 0) || 1;
        arr.forEach((s2) => { s2.payable = Math.floor((Math.max(0, s2.progressDue - s2.prev) / baseSum * payTotalN) / Math.max(1, settings.roundTo)) * Math.max(1, settings.roundTo); });
      }
      arr.forEach((s2) => { const mo = manual[s2.who] || {}; if (mo.payOverride !== undefined && mo.payOverride !== "") s2.payable = +mo.payOverride || 0; });
    }
    const summary = Object.values(map).sort((a, b) => (b.payable) - (a.payable));
    const totalPay = summary.reduce((s, r) => s + Math.max(0, r.payable), 0);
    const isCrewMode = T.mode === "crew";

    const setS = (k, v) => setSettings((p) => ({ ...p, [k]: v }));
    const setMan = (who, k, v) => setManual((p) => ({ ...p, [who]: { ...(p[who] || {}), [k]: v } }));

    // —— 人名统一名册：点击人名 → 该人所在请款簿（负责人簿优先，其次组员所在簿）——
    const goWorker = (name) => {
      const P = window.PAYSLIP;
      const book = P && (P.books.find((b) => b.project === "合和新城" && b.leader === name && b.family !== "MGR")
        || P.books.find((b) => b.project === "合和新城" && b.members.indexOf(name) >= 0 && b.family !== "MGR"));
      if (book) {
        window.DC.navigate("payrollDetail", { book: book.id, crew: book.crew, project: book.project, month: P.curMonth(book) });
      } else {
        UI().toast("该工人暂无请款簿（演示数据）");
      }
    };
    const workerLink = (name) => (
      <button type="button" title={"打开 " + name + " 的进度款核对表"} onClick={() => goWorker(name)}
        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
        style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", textAlign: "left", color: "var(--brand)", fontWeight: 700, fontSize: "inherit", fontFamily: "inherit" }}>{name}</button>
    );

    // 工资表工人：个人计件=各施工人；班组整包=班组成员
    const wageWorkers = isCrewMode
      ? Array.from(new Set(summary.flatMap((s) => CREW_MEMBERS[s.who] || [s.who])))
      : summary.map((s) => s.who);
    const crewPayable = summary.reduce((s, r) => s + Math.max(0, r.payable), 0);
    const getPay = (w) => pay[w] || { gross: isCrewMode ? 0 : (map[w] ? Math.max(0, map[w].payable) : 0), borrow: 0, days: 26 };
    const setPayF = (w, k, v) => setPay((p) => ({ ...p, [w]: { ...getPay(w), [k]: v } }));

    const attFor = (w) => { if (att[w]) return att[w]; const d = Math.min(30, +getPay(w).days || 26); const o = {}; for (let i = 1; i <= d; i++) o[i] = true; return o; };
    const toggleAtt = (w, d) => setAtt((p) => { const c = { ...attFor(w) }; c[d] = !c[d]; return { ...p, [w]: c }; });

    const TABS = [{ key: "list", label: "工程量清单（只读）" }, { key: "sum", label: "工资汇总" }, { key: "wage", label: "工人工资表" }, { key: "att", label: "考勤表" }];
    if (T.name === "泥水") TABS.push({ key: "hollow", label: "空鼓扣罚" });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel padding={16}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <button onClick={() => navigate("payroll", {})} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--line-strong)", background: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 13, color: "var(--ink-soft)", cursor: "pointer" }}><Icon name="arrow-left" size={15} />工资核算</button>
            <div><div style={{ fontSize: 15, fontWeight: 800 }}>工资进度款工具</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>工程量只读 · 来自「工程量管理」配置 · 本次实发合计 <b style={{ color: "var(--brand-deep)", fontFamily: "var(--font-mono)" }}>¥{money(totalPay)}</b> · 人名可点击 → 进度款核对表</div></div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <Button icon="edit-3" onClick={() => navigate("quantity")}>去工程量管理改指派</Button>
              <Button variant="primary" icon="download" onClick={(e) => UI().exportModal({
                title: "导出进度款四表", subtitle: T.name + "班组 · " + building + " · " + settings.period + " · 与真实模板同构",
                count: 4, unit: "张表", ext: ".xls", anchor: e.currentTarget,
                structureOptions: ["按月份/楼栋（真实归档结构）", "按班组", "不分层"],
                nameOptions: [
                  { label: "项目-栋-工种-月份（负责人）", sample: "亚运城C1-2栋岩板10月进度款（何先进）" },
                  { label: "进度款审批表", sample: settings.period + "进度款审批表" },
                  { label: "工程量进度清单", sample: building + "工程量进度清单" },
                  { label: "工人工资表+考勤", sample: T.name + "工工资表" },
                ],
              })}>导出</Button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>楼栋</span>
              {WA.BUILDINGS.map((b) => <button key={b} onClick={() => setBuilding(b)} style={{ border: "1px solid", borderColor: building === b ? "var(--brand)" : "var(--line)", background: building === b ? "var(--brand)" : "#fff", color: building === b ? "#fff" : "var(--ink)", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{b}</button>)}
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>完成 {WA.doneCount(building)} 层</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}><span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>工种</span>
              {Object.keys(WA.TRADES).map((tk) => { const on = tradeKey === tk; return <button key={tk} onClick={() => setTradeKey(tk)} style={{ border: "1px solid", borderColor: on ? "var(--brand)" : "var(--line)", background: on ? "var(--brand-soft)" : "#fff", color: on ? "var(--brand-deep)" : "var(--ink-soft)", borderRadius: 999, padding: "5px 14px", fontSize: 13, fontWeight: on ? 700 : 500, cursor: "pointer" }}>{WA.TRADES[tk].name}<StatusChip tone={WA.TRADES[tk].mode === "worker" ? "brand" : "neutral"}>{WA.TRADES[tk].mode === "worker" ? "个人计件" : "班组整包"}</StatusChip></button>; })}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {[["progress", "进度%（参考）"], ["roundTo", "取整"], ["prevPaid", "累计已申领"]].map(([k, label]) => (
                <label key={k} style={{ fontSize: 12, color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 5 }}>{label}<input type="number" value={settings[k]} onChange={(e) => setS(k, +e.target.value)} style={{ width: 70, border: "1px solid var(--line-strong)", borderRadius: 6, padding: "5px 7px", fontSize: 12, textAlign: "right" }} /></label>
              ))}
              <label title="直接给总数：填入后按各人（进度应发−已发）权重分摊，比例仅作参考" style={{ fontSize: 12, color: "var(--brand-deep)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>本期支付总额<input value={settings.payTotal} placeholder="自动" onChange={(e) => setS("payTotal", e.target.value)} style={{ width: 92, border: "1.5px solid var(--brand)", background: "var(--brand-soft)", borderRadius: 6, padding: "5px 7px", fontSize: 12, textAlign: "right", fontFamily: "var(--font-mono)" }} /></label>
              <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}><input type="checkbox" checked={settings.rentEnabled} onChange={(e) => setS("rentEnabled", e.target.checked)} />房补</label>
              {T.mode === "worker" && <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}><input type="checkbox" checked={settings.mgrEnabled} onChange={(e) => setS("mgrEnabled", e.target.checked)} />管理费({mgrName})</label>}
            </div>
          </div>
        </Panel>

        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", flexWrap: "wrap", borderBottom: "1px solid var(--line)", padding: "0 10px" }}>
            {TABS.map((t) => { const on = tab === t.key; return <button key={t.key} onClick={() => setTab(t.key)} style={{ border: 0, background: "transparent", cursor: "pointer", padding: "11px 14px", marginBottom: -1, fontSize: 13, fontWeight: on ? 700 : 500, color: on ? "var(--brand-deep)" : "var(--ink-soft)", borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent", whiteSpace: "nowrap" }}>{t.label}</button>; })}
          </div>

          <div style={{ padding: 16 }}>
            {/* ① 工程量清单（只读，户型×分项×施工人 聚合）*/}
            {tab === "list" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>{T.name}班组 · {building} · {settings.period}工程量进度清单</span>
                  <StatusChip tone="ok">只读 · 联动工程量管理</StatusChip>
                  <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>同人合并 · 异人拆行 · 申报量 = 每户量 × 完成层数</span>
                </div>
                <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 860 }}>
                    <thead><tr>{["#", "施工项目", "施工人", "单位", "每户量", "完成层数", "申报量", "单价", "金额", "备注(房间)"].map((h, i) => <th key={h} style={{ ...TH, textAlign: i >= 4 && i <= 8 ? "right" : "left" }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {rows.length === 0 && <tr><td colSpan={10} style={{ ...TD, textAlign: "center", color: "var(--ink-faint)", padding: 24 }}>该栋/工种暂无指派，去「工程量管理」点户格指派施工人。</td></tr>}
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td style={{ ...TD, color: "var(--ink-soft)" }}>{i + 1}</td>
                          <td style={{ ...TD, fontWeight: 600 }}>{r.unit} {r.item}</td>
                          <td style={TD}>{r.mode === "crew" ? <StatusChip tone="neutral">{r.who}</StatusChip> : <span style={{ color: "var(--brand)", fontWeight: 700 }}>{r.who}</span>}</td>
                          <td style={{ ...TD, color: "var(--ink-soft)" }}>{r.unitM}</td>
                          <td style={numTD}>{fmt(r.perUnitQty)}</td>
                          <td style={numTD}>{r.floors}</td>
                          <td style={{ ...numTD, fontWeight: 700 }}>{fmt(r.qty)}</td>
                          <td style={{ ...numTD, color: "var(--ink-soft)" }}>{money(r.price)}</td>
                          <td style={{ ...numTD, fontWeight: 700, color: "var(--brand)" }}>{money(r.amount)}</td>
                          <td style={{ ...TD, color: r.roomNote === "整户" ? "var(--ink-faint)" : "var(--warn-ink)" }}>{r.roomNote}</td>
                        </tr>
                      ))}
                      <tr style={{ background: "var(--surface-2)" }}>
                        <td colSpan={8} style={{ ...numTD, textAlign: "right", fontWeight: 800 }}>合计</td>
                        <td style={{ ...numTD, fontWeight: 800, color: "var(--brand)" }}>{money(rows.reduce((s, r) => s + r.amount, 0))}</td><td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>「备注」为整户表示该分项整户同一人；显示"客厅+厨房"等则表示该分项按房间拆给了不同人。工程量固定，改指派请去工程量管理。</div>
              </div>
            )}

            {/* ② 工资汇总 */}
            {tab === "sum" && (
              <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 940 }}>
                  <thead><tr>{["施工人", "工程金额", "房租补贴", "管理提成", (T.name === "泥水" ? "空鼓扣" : ""), "补扣调整", (T.mode === "worker" ? "免管理费" : ""), "应发合计", "本次应发", "已发/借支", "实发", "备注"].filter(Boolean).map((h, i) => <th key={h} style={{ ...TH, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {summary.map((r) => { const m = manual[r.who] || {}; return (
                      <tr key={r.who}>
                        <td style={{ ...TD, fontWeight: 700 }}>{r.mode === "crew" ? r.who : workerLink(r.who)}{r.who === mgrName && T.mode === "worker" && <StatusChip tone="brand">班组长</StatusChip>}{r.mode === "crew" && <StatusChip tone="neutral">班组</StatusChip>}</td>
                        <td style={numTD}>{money(r.eng)}</td>
                        <td style={numTD}>{money(r.rent)}</td>
                        <td style={numTD}>{r.mgr ? money(r.mgr) : "—"}</td>
                        {T.name === "泥水" && <td style={{ ...numTD, color: r.hollowAmt ? "var(--danger)" : "var(--ink-faint)" }}>{r.hollowAmt ? "−" + money(r.hollowAmt) : "—"}</td>}
                        <td style={{ ...TD, width: 84 }}><Inp type="number" value={m.adjust || 0} onChange={(e) => setMan(r.who, "adjust", +e.target.value)} align="right" /></td>
                        {T.mode === "worker" && <td style={{ ...TD, textAlign: "right", width: 64 }}>{r.who === mgrName ? "—" : <input type="checkbox" checked={!!noMgr(r.who)} onChange={(e) => setMan(r.who, "noMgr", e.target.checked)} />}</td>}
                        <td style={{ ...numTD, fontWeight: 700 }}>{money(r.due)}</td>
                        <td style={numTD}>{money(r.progressDue)}</td>
                        <td style={{ ...TD, width: 84 }}><Inp type="number" value={m.prev || 0} onChange={(e) => setMan(r.who, "prev", +e.target.value)} align="right" /></td>
                        <td style={{ ...TD, width: 100 }} title="实发可直改（清空恢复自动计算）"><Inp type="number" value={m.payOverride !== undefined && m.payOverride !== "" ? m.payOverride : r.payable} onChange={(e) => setMan(r.who, "payOverride", e.target.value)} align="right" bold /></td>
                        <td style={{ ...TD, width: 110 }}><Inp value={m.remark || ""} onChange={(e) => setMan(r.who, "remark", e.target.value)} /></td>
                      </tr>
                    ); })}
                    <tr style={{ background: "var(--surface-2)" }}>
                      <td style={{ ...TD, fontWeight: 800 }}>合计</td>
                      <td style={{ ...numTD, fontWeight: 800 }}>{money(summary.reduce((s, r) => s + r.eng, 0))}</td>
                      <td colSpan={T.name === "泥水" ? (T.mode === "worker" ? 6 : 5) : (T.mode === "worker" ? 5 : 4)}></td>
                      <td style={{ ...numTD, fontWeight: 800, color: "var(--brand)" }}>{money(totalPay)}</td><td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* ③ 工人工资表（银行信息联动）*/}
            {tab === "wage" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{isCrewMode ? "班组整包：请把班组本次实发在成员间分配（应发可改）。" : "个人计件：应发已按汇总自动带出，可录借支。"}银行信息按姓名自动联动。</div>
                <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
                    <thead><tr>{["#", "姓名", "出勤", "应发", "借支", "实发", "开户行 / 卡号"].map((h, i) => <th key={h} style={{ ...TH, textAlign: i >= 2 && i <= 5 ? "right" : "left" }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {wageWorkers.map((w, i) => { const p = getPay(w); const net = (+p.gross || 0) - (+p.borrow || 0); return (
                        <tr key={w}>
                          <td style={{ ...TD, color: "var(--ink-soft)" }}>{i + 1}</td>
                          <td style={{ ...TD, fontWeight: 700 }}>{workerLink(w)}</td>
                          <td style={{ ...TD, width: 60 }}><Inp type="number" value={p.days} onChange={(e) => setPayF(w, "days", +e.target.value)} align="right" /></td>
                          <td style={{ ...TD, width: 90 }}><Inp type="number" value={p.gross} onChange={(e) => setPayF(w, "gross", +e.target.value)} align="right" /></td>
                          <td style={{ ...TD, width: 80 }}><Inp type="number" value={p.borrow} onChange={(e) => setPayF(w, "borrow", +e.target.value)} align="right" /></td>
                          <td style={{ ...numTD, fontWeight: 800, color: "var(--brand)" }}>{money(net)}</td>
                          <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-soft)" }}>{BANK[w] || "—（未登记）"}</td>
                        </tr>
                      ); })}
                      <tr style={{ background: "var(--surface-2)" }}>
                        <td colSpan={3} style={{ ...TD, fontWeight: 800 }}>合计</td>
                        <td style={{ ...numTD, fontWeight: 800 }}>{money(wageWorkers.reduce((s, w) => s + (+getPay(w).gross || 0), 0))}</td>
                        <td style={{ ...numTD, fontWeight: 800, color: "var(--danger)" }}>{money(wageWorkers.reduce((s, w) => s + (+getPay(w).borrow || 0), 0))}</td>
                        <td style={{ ...numTD, fontWeight: 800, color: "var(--brand)" }}>{money(wageWorkers.reduce((s, w) => s + ((+getPay(w).gross || 0) - (+getPay(w).borrow || 0)), 0))}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {isCrewMode && <div style={{ fontSize: 12, color: "var(--warn-ink)" }}>班组本次实发（取整）合计 ¥{money(crewPayable)}，请分配到成员，合计应对平。</div>}
              </div>
            )}

            {/* ④ 考勤 */}
            {tab === "att" && (
              <div style={{ overflowX: "auto" }}>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 8 }}>按各工人「出勤」预填 √（工资表里改出勤会带过来），可点击调整。{settings.period} · 30 天。</div>
                <table style={{ borderCollapse: "collapse", fontSize: 11, border: "1px solid var(--line)" }}>
                  <thead><tr><th style={{ ...TH, position: "sticky", left: 0, zIndex: 1, minWidth: 60 }}>姓名</th>{Array.from({ length: 30 }, (_, i) => i + 1).map((d) => <th key={d} style={{ ...TH, padding: "6px 3px", textAlign: "center", minWidth: 20 }}>{d}</th>)}<th style={{ ...TH, textAlign: "center" }}>合计</th></tr></thead>
                  <tbody>
                    {wageWorkers.map((w) => { const a = attFor(w); let cnt = 0; return (
                      <tr key={w}><td style={{ ...TD, fontWeight: 700, position: "sticky", left: 0, background: "var(--panel)", zIndex: 1 }}>{w}</td>
                        {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => { const on = a[d]; if (on) cnt++; return <td key={d} onClick={() => toggleAtt(w, d)} style={{ padding: "5px 3px", fontSize: 11, borderBottom: "1px solid var(--line)", textAlign: "center", cursor: "pointer", color: on ? "var(--ok-ink)" : "var(--ink-faint)", background: on ? "var(--ok-soft)" : "transparent" }}>{on ? "√" : ""}</td>; })}
                        <td style={{ ...numTD, fontWeight: 800 }}>{cnt}</td></tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ⑤ 空鼓（泥水）— D5：从户记录聚合只读（不再手填）；扣款启动在请款簿内（⑥） */}
            {tab === "hollow" && T.name === "泥水" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: "var(--warn-soft)", border: "1px solid var(--warn)", borderRadius: 8, padding: "10px 14px" }}>
                  <Icon name="triangle-alert" size={16} color="var(--warn-ink)" />
                  <span style={{ fontSize: 13, color: "var(--warn-ink)", fontWeight: 600 }}>空鼓记录在对应户/楼层（现场维度，只读聚合）· 进度月仅列示，扣款在请款簿内手动启动</span>
                  <label style={{ marginLeft: "auto", fontSize: 12, color: "var(--warn-ink)", display: "inline-flex", alignItems: "center", gap: 6 }}>单处扣款（调参）<input type="number" value={hollowRate} onChange={(e) => setHollowRate(+e.target.value || 0)} style={{ width: 64, border: "1px solid var(--line-strong)", borderRadius: 6, padding: "4px 6px", fontSize: 12, textAlign: "right" }} /></label>
                  <Button size="sm" icon="edit-3" onClick={() => navigate("quantity")}>去户记录登记/销记</Button>
                </div>
                <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 680 }}>
                    <thead><tr>{["位置（栋/楼层/户）", "分项", "工人", "处数", "已整改(销记不扣)", "未整改", "预估扣款", "状态"].map((h, i) => <th key={h} style={{ ...TH, textAlign: i >= 3 && i <= 6 ? "right" : "left" }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {(WA.hollowAll ? WA.hollowAll() : []).map((h, i) => { const un = h.spots - h.fixed; return (
                        <tr key={i}>
                          <td style={{ ...TD, fontWeight: 600 }}>{h.b}{h.f}楼 {h.u}</td>
                          <td style={TD}>{h.item}</td>
                          <td style={{ ...TD, color: "var(--brand)", fontWeight: 700 }}>{workerLink(h.who)}</td>
                          <td style={numTD}>{h.spots}</td>
                          <td style={{ ...numTD, color: "var(--ok-ink)" }}>{h.fixed || "—"}</td>
                          <td style={{ ...numTD, fontWeight: 700, color: un ? "var(--warn-ink)" : "var(--ink-faint)" }}>{un || "—"}</td>
                          <td style={{ ...numTD, color: un ? "var(--danger)" : "var(--ink-faint)", fontWeight: 700 }}>{un ? "−" + money(un * hollowRate) : "—"}</td>
                          <td style={TD}>{un ? <StatusChip tone="warn">待整改</StatusChip> : <StatusChip tone="ok">已销记</StatusChip>}</td>
                        </tr>
                      ); })}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>明细文字（如「2栋6楼2处」）与扣款行由请款簿自动生成；「暂扣→返还」机制已废除（#117 ⑥）。</div>
              </div>
            )}
          </div>
        </Panel>
      </div>
    );
  }

  window.WageSlipScreen = WageSlipScreen;
})();
