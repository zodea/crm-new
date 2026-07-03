// SchedulePlanScreen — 施工进度排程工作台（#28）
// 左 WBS 树表（项目/楼栋分组/工序 三层）+ 右甘特（行严格对齐、FS 依赖线、today 线贯穿）。
// 数据源 window.SCHEDULE（kit/ScheduleData.jsx）：本页所有编辑经 SCHEDULE.update/notify 实时反映到首页缩略甘特。
// 蓝本：docs/rewrite/pages/schedule-progress.md §七 7.2。
(function () {
  const { Button, Panel, StatusChip, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {} };

  const PROJECTS = ["合和新城", "锦绣华庭", "翠湖花园"];
  const ROWH = 34;                    // 每行行高：左表与甘特共用，保证行对齐
  const COLS = { name: 216, dur: 42, plan: 96, act: 46, dev: 80 };
  const LEFTW = COLS.name + COLS.dur + COLS.plan + COLS.act + COLS.dev;
  const fmtS = s => s.slice(5).replace("-", ".");      // 06.13
  const fmtF = s => s.replace(/-/g, ".");

  // ── 单元格 ──
  const Cell = ({ w, children, align, pad, bold, mono, color }) => (
    <div style={{ width: w, flex: "none", padding: pad || "0 8px", display: "flex", alignItems: "center",
      justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
      fontSize: 12, fontWeight: bold ? 800 : 500, fontFamily: mono ? "var(--font-mono)" : "inherit",
      color: color || "var(--ink)", borderRight: "1px solid var(--line)", minWidth: 0, overflow: "hidden",
      whiteSpace: "nowrap", textOverflow: "ellipsis", height: "100%" }}>{children}</div>
  );

  // ── 工序编辑弹窗：改期 / 手动进度 / 删除 ──
  function TaskModal({ proj, g, t, S, navigate, onClose }) {
    const [ps, setPs] = React.useState(t.ps);
    const [pf, setPf] = React.useState(t.pf);
    const [act, setAct] = React.useState(Math.round(t.actual * 100));
    const save = () => {
      if (S.days(ps, pf) < 0) { UI().toast("计划完成不能早于计划开始", "warn"); return; }
      S.update(proj, g.id, t.id, { ps, pf, actual: Math.max(0, Math.min(100, +act || 0)) / 100 });
      // FS 依赖联动提示：以本工序为前置的后续工序，若新完成日期晚于其计划开始 → 冲突提醒
      const conflict = g.tasks.filter(x => x.id !== t.id && S.days(t.pf, x.ps) >= 0 && S.days(pf, x.ps) < 0);
      if (conflict.length) UI().toast("「" + conflict[0].name + "」等 " + conflict.length + " 道后续工序计划开始早于新完成日期，请顺延", "warn");
      else UI().toast("已保存，首页甘特已同步", "ok");
      onClose();
    };
    const del = () => {
      const i = g.tasks.findIndex(x => x.id === t.id);
      if (i >= 0) { g.tasks.splice(i, 1); S.notify(); }
      UI().toast("已删除工序「" + t.name + "」", "ok"); onClose();
    };
    const inp = { border: "1px solid var(--line-strong)", borderRadius: 6, padding: "7px 10px", fontSize: 13, background: "#fff", width: "100%" };
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 24 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: "var(--panel)", borderRadius: 12, width: 440, boxShadow: "var(--shadow-pop)", overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: t.color, flex: "none" }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>{g.name} · {t.trade} · 参考工期 {t.dur} 天</div>
            </div>
            <button onClick={onClose} style={{ marginLeft: "auto", border: 0, background: "transparent", cursor: "pointer", fontSize: 20, color: "var(--ink-soft)" }}>×</button>
          </div>
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>计划开始
                <input type="date" value={ps} onChange={e => setPs(e.target.value)} style={{ ...inp, marginTop: 4 }} /></label>
              <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>计划完成
                <input type="date" value={pf} onChange={e => setPf(e.target.value)} style={{ ...inp, marginTop: 4 }} /></label>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>当前区间 {S.days(ps, pf) + 1} 天（模板参考 {t.dur} 天）· 保存后首页/项目详情实时联动</div>
            {t.hasQty ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--brand-soft)", border: "1px solid rgba(57,118,198,0.18)", borderRadius: 8, padding: "10px 12px" }}>
                <Icon name="link" size={14} color="var(--brand)" />
                <span style={{ fontSize: 12, color: "var(--ink)" }}>实际进度 <b style={{ fontFamily: "var(--font-mono)" }}>{Math.round(t.actual * 100)}%</b> 由工程量矩阵「{t.item}」自动汇总，不在此填报</span>
                <Button size="sm" variant="secondary" onClick={() => { onClose(); navigate("quantity", { group: g.name, trade: t.trade, item: t.item, task: t.name, ps: t.ps, pf: t.pf, from: "schedule" }); }}>下钻</Button>
              </div>
            ) : (
              <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>实际进度（手动填报）
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
                  <input type="range" min={0} max={100} value={act} onChange={e => setAct(+e.target.value)} style={{ flex: 1 }} />
                  <input type="number" min={0} max={100} value={act} onChange={e => setAct(e.target.value)} style={{ ...inp, width: 72, textAlign: "right" }} />
                  <span style={{ fontSize: 13 }}>%</span>
                </div></label>
            )}
          </div>
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
            <button onClick={del} style={{ border: "1px solid var(--danger)", color: "var(--danger)", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>删除工序</button>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button onClick={onClose} style={{ border: "1px solid var(--line)", background: "var(--surface-2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
              <button onClick={save} style={{ border: 0, background: "var(--brand)", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>保存</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 向分组追加工序（从 22 道模板选）──
  function AddTaskModal({ proj, g, S, onClose }) {
    const [ti, setTi] = React.useState(0);
    const last = g.tasks[g.tasks.length - 1];
    const defPs = last ? new Date(S.D(last.pf).getTime() + 86400000).toISOString().slice(0, 10) : "2026-07-01";
    const [ps, setPs] = React.useState(defPs);
    const tpl = S.TEMPLATE[ti];
    const pf = new Date(S.D(ps).getTime() + (tpl.dur - 1) * 86400000).toISOString().slice(0, 10);
    const add = () => {
      g.tasks.push({ id: "t" + Date.now(), ...tpl, ps, pf, actual: 0, hasQty: tpl.item != null });
      S.notify(); UI().toast("已添加「" + tpl.name + "」", "ok"); onClose();
    };
    const inp = { border: "1px solid var(--line-strong)", borderRadius: 6, padding: "7px 10px", fontSize: 13, background: "#fff", width: "100%" };
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 24 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: "var(--panel)", borderRadius: 12, width: 420, boxShadow: "var(--shadow-pop)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", fontSize: 15, fontWeight: 800 }}>{g.name} · 添加工序</div>
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>工序模板
              <select value={ti} onChange={e => setTi(+e.target.value)} style={{ ...inp, marginTop: 4, cursor: "pointer" }}>
                {S.TEMPLATE.map((t, i) => <option key={i} value={i}>{t.name}（{t.trade} · {t.dur}天{t.item ? " · 联动" + t.item : ""}）</option>)}
              </select></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>计划开始
                <input type="date" value={ps} onChange={e => setPs(e.target.value)} style={{ ...inp, marginTop: 4 }} /></label>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>计划完成（按模板工期）
                <div style={{ ...inp, marginTop: 4, background: "var(--surface-2)", fontFamily: "var(--font-mono)" }}>{pf}</div></div>
            </div>
          </div>
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={onClose} style={{ border: "1px solid var(--line)", background: "var(--surface-2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
            <button onClick={add} style={{ border: 0, background: "var(--brand)", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>添加</button>
          </div>
        </div>
      </div>
    );
  }

  // ── 新建楼栋分组：套 22 道工序模板（可勾选）──
  function AddGroupModal({ proj, S, onClose }) {
    const [name, setName] = React.useState("");
    const [blds, setBlds] = React.useState("");
    const [start, setStart] = React.useState("2026-07-06");
    const [sel, setSel] = React.useState(() => S.TEMPLATE.map(() => true));
    const nSel = sel.filter(Boolean).length;
    const create = () => {
      if (!name.trim()) { UI().toast("请填写分组名称", "warn"); return; }
      if (!nSel) { UI().toast("请至少勾选一道工序", "warn"); return; }
      const tasks = []; let cur = S.D(start).getTime();
      S.TEMPLATE.forEach((tpl, i) => {
        if (!sel[i]) return;
        const ps = new Date(cur).toISOString().slice(0, 10);
        const pf = new Date(cur + (tpl.dur - 1) * 86400000).toISOString().slice(0, 10);
        tasks.push({ id: "t" + i + "-" + Date.now(), ...tpl, ps, pf, actual: 0, hasQty: tpl.item != null });
        cur += Math.round(tpl.dur * 0.5) * 86400000;   // 流水搭接：后道工序错开半个工期进场
      });
      S.state[proj].groups.push({ id: "g" + Date.now(), name: name.trim(), buildings: blds.split(/[、,，\s]+/).filter(Boolean), collapsed: false, tasks });
      S.notify(); UI().toast("已创建分组「" + name.trim() + "」（" + nSel + " 道工序，流水搭接排程）", "ok"); onClose();
    };
    const inp = { border: "1px solid var(--line-strong)", borderRadius: 6, padding: "7px 10px", fontSize: 13, background: "#fff", width: "100%" };
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 24 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: "var(--panel)", borderRadius: 12, width: 560, maxHeight: "86vh", overflow: "auto", boxShadow: "var(--shadow-pop)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--panel)", zIndex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>新建楼栋分组 · {proj}</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>套用 22 道精装修工序标准库 · 按参考工期流水搭接自动排程 · 建成后可逐道调期</div>
          </div>
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>分组名称
                <input value={name} onChange={e => setName(e.target.value)} placeholder="如：户内31栋-36栋" style={{ ...inp, marginTop: 4 }} /></label>
              <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>开始日期
                <input type="date" value={start} onChange={e => setStart(e.target.value)} style={{ ...inp, marginTop: 4 }} /></label>
            </div>
            <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>包含楼栋（顿号/逗号分隔）
              <input value={blds} onChange={e => setBlds(e.target.value)} placeholder="如：31栋、33栋、36栋" style={{ ...inp, marginTop: 4 }} /></label>
            <div>
              <div style={{ display: "flex", alignItems: "center", fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", marginBottom: 6 }}>
                工序模板（已选 {nSel}/22）
                <button onClick={() => setSel(S.TEMPLATE.map(() => nSel < 22))} style={{ marginLeft: "auto", border: 0, background: "transparent", color: "var(--brand)", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>{nSel < 22 ? "全选" : "全不选"}</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, maxHeight: 240, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>
                {S.TEMPLATE.map((t, i) => (
                  <label key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, padding: "4px 6px", borderRadius: 6, cursor: "pointer", background: sel[i] ? "var(--brand-soft)" : "transparent" }}>
                    <input type="checkbox" checked={sel[i]} onChange={() => setSel(s => s.map((v, k) => k === i ? !v : v))} />
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flex: "none" }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                    <span style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)", flex: "none" }}>{t.dur}d</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 8, position: "sticky", bottom: 0, background: "var(--panel)" }}>
            <button onClick={onClose} style={{ border: "1px solid var(--line)", background: "var(--surface-2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
            <button onClick={create} style={{ border: 0, background: "var(--brand)", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>创建分组</button>
          </div>
        </div>
      </div>
    );
  }

  // ── 主组件 ──
  function SchedulePlanScreen({ data, navigate, params }) {
    const [, force] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
      if (!window.SCHEDULE) {
        const t = setInterval(() => { if (window.SCHEDULE) { clearInterval(t); force(); } }, 50);
        return () => clearInterval(t);
      }
      return window.SCHEDULE.subscribe(force);
    }, []);
    const S = window.SCHEDULE;
    const [proj, setProj] = React.useState((params && params.project) || "合和新城");
    const [modal, setModal] = React.useState(null);   // {kind:"task"|"addTask"|"addGroup", g, t}
    if (!S) return <Panel padding={18}><div style={{ fontSize: 12, color: "var(--ink-soft)" }}>加载排程数据…</div></Panel>;

    const p = S.state[proj];
    // 时间轴（同首页：开工月首 → 完工月末）
    const axisStart = p.start.slice(0, 8) + "01";
    const endD = S.D(p.plannedEnd); const axisEnd = new Date(endD.getFullYear(), endD.getMonth() + 1, 0);
    const total = Math.max((axisEnd - S.D(axisStart)) / 86400000, 1);
    const X = d => Math.max(0, Math.min(100, S.days(axisStart, d) / total * 100));
    const todayX = X(p.today);
    const months = [];
    for (let d = S.D(axisStart); d <= axisEnd; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      months.push({ label: (d.getMonth() === 0 ? (d.getFullYear() % 100) + "年" : "") + (d.getMonth() + 1) + "月", x: X(d.toISOString().slice(0, 10)) });
    }
    const allTasks = p.groups.flatMap(g => g.tasks);
    const overall = S.rollup(allTasks, p.today);

    // 行扁平化（保证左表与甘特一一对应）
    const rows = [{ kind: "project" }];
    p.groups.forEach(g => {
      rows.push({ kind: "group", g });
      if (!g.collapsed) g.tasks.forEach(t => rows.push({ kind: "task", g, t }));
    });
    const H = rows.length * ROWH;

    // FS 依赖：前置 = 同组内 计划完成 ≤ 本工序计划开始 且最接近的工序
    const deps = [];
    rows.forEach((r, ri) => {
      if (r.kind !== "task") return;
      let pred = null, predRi = -1;
      rows.forEach((r2, ri2) => {
        if (r2.kind !== "task" || r2.g !== r.g || r2.t === r.t) return;
        if (S.days(r2.t.pf, r.t.ps) >= 0 && (!pred || S.days(pred.pf, r2.t.pf) > 0)) { pred = r2.t; predRi = ri2; }
      });
      if (pred) deps.push({ x1: X(pred.pf), y1: predRi * ROWH + ROWH / 2, x2: X(r.t.ps), y2: ri * ROWH + ROWH / 2 });
    });

    const devChip = t => {
      const st = S.status(t, p.today);
      if (st === "done") { const d = S.devDays(t, p.today); return <StatusChip tone={d >= 0 ? "ok" : "danger"}>{d > 0 ? `提前${d}天` : d < 0 ? `延后${-d}天` : "按期"}</StatusChip>; }
      if (st === "doing") { const d = S.devDays(t, p.today); return <StatusChip tone={d >= 0 ? "brand" : "warn"}>{d < 0 ? `慢${-d}天` : d > 0 ? `快${d}天` : "按期"}</StatusChip>; }
      if (st === "late-start") return <StatusChip tone="danger">应开未开</StatusChip>;
      return <StatusChip tone="neutral">待开始</StatusChip>;
    };

    const leftHead = (
      <div style={{ display: "flex", height: 26, alignItems: "stretch" }}>
        <Cell w={COLS.name} color="var(--ink-faint)" bold>WBS · 分组 / 工序</Cell>
        <Cell w={COLS.dur} align="center" color="var(--ink-faint)" bold>工期</Cell>
        <Cell w={COLS.plan} align="center" color="var(--ink-faint)" bold>计划起止</Cell>
        <Cell w={COLS.act} align="center" color="var(--ink-faint)" bold>实际</Cell>
        <Cell w={COLS.dev} align="center" color="var(--ink-faint)" bold>状态</Cell>
      </div>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 工具栏 */}
        <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {PROJECTS.map(n => (
              <button key={n} onClick={() => setProj(n)} style={{
                border: "1px solid", borderColor: proj === n ? "var(--brand)" : "var(--line)",
                background: proj === n ? "var(--brand)" : "#fff", color: proj === n ? "#fff" : "var(--ink)",
                borderRadius: "var(--radius-btn)", padding: "7px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{n}</button>
            ))}
          </div>
          <StatusChip tone={overall.dev > 0 ? "ok" : overall.dev < 0 ? "warn" : "brand"}>
            整体 {Math.round(overall.pct * 100)}%{overall.dev > 0 ? ` · 领先约${overall.dev}天` : overall.dev < 0 ? ` · 落后约${-overall.dev}天` : " · 按计划"}
          </StatusChip>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
            {fmtF(p.start)} → {fmtF(p.plannedEnd)} · 点行改期/填报 · 改动实时同步首页
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button size="sm" icon="flag" onClick={() => UI().toast("已将当前计划保存为基线（V1 写入 schedule_baselines，偏差以基线对比）", "ok")}>设为基线</Button>
            <Button size="sm" variant="primary" icon="plus" onClick={() => setModal({ kind: "addGroup" })}>新建楼栋分组</Button>
          </div>
        </Panel>

        {/* WBS + 甘特 */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 960 }}>
              {/* 表头：左列名 + 月刻度 */}
              <div style={{ display: "flex", background: "var(--surface-2)", borderBottom: "1px solid var(--line)" }}>
                <div style={{ width: LEFTW, flex: "none" }}>{leftHead}</div>
                <div style={{ flex: 1, position: "relative", height: 26 }}>
                  {months.map((m, i) => <div key={i} style={{ position: "absolute", left: m.x + "%", top: 0, bottom: 0, borderLeft: "1px dashed rgba(0,0,0,0.06)", paddingLeft: 4, fontSize: 10, fontWeight: 700, color: "var(--ink-soft)", display: "flex", alignItems: "center" }}>{m.label}</div>)}
                  <div style={{ position: "absolute", left: todayX + "%", top: 0, bottom: 0, width: 2, background: "var(--danger)" }} />
                  <div style={{ position: "absolute", left: todayX + "%", top: 2, transform: "translateX(-50%)", fontSize: 9, fontWeight: 800, color: "var(--danger)", background: "var(--danger-soft)", borderRadius: 3, padding: "0 4px" }}>今天</div>
                </div>
              </div>

              {/* 行区：背景网格 + 行 + 依赖线 overlay */}
              <div style={{ position: "relative" }}>
                {/* 背景：月网格 + today 线贯穿 */}
                <div style={{ position: "absolute", left: LEFTW, right: 0, top: 0, bottom: 0, zIndex: 0 }}>
                  {months.map((m, i) => <div key={i} style={{ position: "absolute", left: m.x + "%", top: 0, bottom: 0, borderLeft: "1px dashed rgba(0,0,0,0.05)" }} />)}
                  <div style={{ position: "absolute", left: todayX + "%", top: 0, bottom: 0, width: 2, background: "var(--danger)", opacity: 0.55 }} />
                </div>

                {rows.map((r, ri) => {
                  if (r.kind === "project") {
                    return (
                      <div key="prj" style={{ display: "flex", height: ROWH, borderBottom: "1px solid var(--line)", background: "var(--brand-soft)", position: "relative", zIndex: 1 }}>
                        <div style={{ width: LEFTW, flex: "none", display: "flex" }}>
                          <Cell w={COLS.name} bold><Icon name="building-2" size={13} style={{ marginRight: 6, color: "var(--brand)" }} />{proj} · 项目整体</Cell>
                          <Cell w={COLS.dur} align="center" mono color="var(--ink-soft)">{S.days(p.start, p.plannedEnd) + 1}d</Cell>
                          <Cell w={COLS.plan} align="center" mono color="var(--ink-soft)">{fmtS(p.start)}~{fmtS(p.plannedEnd)}</Cell>
                          <Cell w={COLS.act} align="center" mono bold>{Math.round(overall.pct * 100)}%</Cell>
                          <Cell w={COLS.dev} align="center"><span style={{ transform: "scale(0.9)" }}><StatusChip tone={overall.dev >= 0 ? "ok" : "warn"}>{overall.dev >= 0 ? "领先" : "落后"}{Math.abs(overall.dev)}天</StatusChip></span></Cell>
                        </div>
                        <div style={{ flex: 1, position: "relative" }}>
                          <div style={{ position: "absolute", left: X(p.start) + "%", width: Math.max(X(p.plannedEnd) - X(p.start), 2) + "%", top: 10, bottom: 10, background: "var(--surface-3)", border: "1px solid var(--line-strong)", borderRadius: 6, overflow: "hidden" }}>
                            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (overall.pct * 100) + "%", background: "var(--brand)", opacity: 0.8 }} />
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (r.kind === "group") {
                    const g = r.g, rr = S.rollup(g.tasks, p.today);
                    const gs = g.tasks.length ? g.tasks.reduce((m, t) => S.days(t.ps, m) > 0 ? t.ps : m, g.tasks[0].ps) : p.start;
                    const ge = g.tasks.length ? g.tasks.reduce((m, t) => S.days(m, t.pf) > 0 ? t.pf : m, g.tasks[0].pf) : p.plannedEnd;
                    return (
                      <div key={g.id} style={{ display: "flex", height: ROWH, borderBottom: "1px solid var(--line)", background: "rgba(245,246,248,0.9)", position: "relative", zIndex: 1 }}>
                        <div style={{ width: LEFTW, flex: "none", display: "flex", cursor: "pointer" }} onClick={() => { g.collapsed = !g.collapsed; S.notify(); }}>
                          <Cell w={COLS.name} bold pad="0 8px 0 18px">
                            <Icon name={g.collapsed ? "chevron-right" : "chevron-down"} size={13} style={{ marginRight: 4, flex: "none" }} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                            <span title="添加工序" onClick={e => { e.stopPropagation(); setModal({ kind: "addTask", g }); }}
                              style={{ marginLeft: 6, display: "inline-grid", placeItems: "center", width: 18, height: 18, borderRadius: 4, border: "1px solid var(--line-strong)", background: "#fff", cursor: "pointer", flex: "none" }}>
                              <Icon name="plus" size={11} /></span>
                          </Cell>
                          <Cell w={COLS.dur} align="center" mono color="var(--ink-soft)">{g.tasks.length}道</Cell>
                          <Cell w={COLS.plan} align="center" mono color="var(--ink-soft)">{g.tasks.length ? fmtS(gs) + "~" + fmtS(ge) : "—"}</Cell>
                          <Cell w={COLS.act} align="center" mono bold>{Math.round(rr.pct * 100)}%</Cell>
                          <Cell w={COLS.dev} align="center"><span style={{ transform: "scale(0.9)" }}><StatusChip tone={rr.dev >= 0 ? "ok" : "warn"}>{rr.dev >= 0 ? "领先" : "落后"}</StatusChip></span></Cell>
                        </div>
                        <div style={{ flex: 1, position: "relative" }}>
                          {g.tasks.length > 0 && (
                            <div style={{ position: "absolute", left: X(gs) + "%", width: Math.max(X(ge) - X(gs), 2) + "%", top: 10, bottom: 10, background: "var(--surface-3)", border: "1px solid var(--line-strong)", borderRadius: 6, overflow: "hidden" }}>
                              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (rr.pct * 100) + "%", background: "var(--brand)", opacity: 0.75 }} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }
                  const { g, t } = r;
                  const st = S.status(t, p.today);
                  return (
                    <div key={g.id + t.id} onClick={() => setModal({ kind: "task", g, t })}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--brand-soft)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      style={{ display: "flex", height: ROWH, borderBottom: "1px solid var(--line)", cursor: "pointer", position: "relative", zIndex: 1 }}>
                      <div style={{ width: LEFTW, flex: "none", display: "flex" }}>
                        <Cell w={COLS.name} pad="0 8px 0 38px">
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flex: "none", marginRight: 6 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", fontWeight: 600 }}>{t.name}</span>
                          {t.hasQty && <Icon name="link" size={11} style={{ color: "var(--brand)", flex: "none", marginLeft: 4 }} />}
                        </Cell>
                        <Cell w={COLS.dur} align="center" mono color="var(--ink-soft)">{S.days(t.ps, t.pf) + 1}d</Cell>
                        <Cell w={COLS.plan} align="center" mono color="var(--ink-soft)">{fmtS(t.ps)}~{fmtS(t.pf)}</Cell>
                        <Cell w={COLS.act} align="center" mono>{Math.round(t.actual * 100)}%</Cell>
                        <Cell w={COLS.dev} align="center"><span style={{ transform: "scale(0.88)" }}>{devChip(t)}</span></Cell>
                      </div>
                      <div style={{ flex: 1, position: "relative" }}>
                        <div style={{ position: "absolute", left: X(t.ps) + "%", width: Math.max(X(t.pf) - X(t.ps), 1.2) + "%", top: 10, bottom: 10, background: t.color, opacity: 0.22, borderRadius: 4, border: st === "late-start" ? "1.5px dashed var(--danger)" : "none" }}>
                          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (t.actual * 100) + "%", background: t.color, opacity: 0.95, borderRadius: 3 }} />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* FS 依赖线 overlay */}
                <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none"
                  style={{ position: "absolute", left: LEFTW, right: 0, top: 0, height: H, width: `calc(100% - ${LEFTW}px)`, zIndex: 2, pointerEvents: "none" }}>
                  {deps.map((d, i) => (
                    <path key={i} d={`M ${d.x1} ${d.y1} L ${d.x1} ${d.y2} L ${d.x2} ${d.y2}`}
                      fill="none" stroke="#7c93b5" strokeWidth={1.1} vectorEffect="non-scaling-stroke" opacity={0.55} />
                  ))}
                </svg>
              </div>
            </div>
          </div>

          {/* 图例 */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "9px 16px", borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--ink-soft)", flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#6366f1", opacity: 0.22, borderRadius: 2, display: "inline-block" }} />计划区间</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 8, background: "#6366f1", borderRadius: 2, display: "inline-block" }} />实际完成</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 2, height: 12, background: "var(--danger)", display: "inline-block" }} />今天</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 0, borderTop: "1.5px solid #7c93b5", display: "inline-block" }} />前后置依赖（FS）</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="link" size={11} style={{ color: "var(--brand)" }} />进度由工程量联动</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 8, border: "1.5px dashed var(--danger)", borderRadius: 2, display: "inline-block" }} />应开未开</span>
            <span style={{ marginLeft: "auto" }}>点击工序行 → 改期 / 手动填报 / 删除 · 分组行「+」→ 按模板添加工序</span>
          </div>
        </Panel>

        {modal && modal.kind === "task" && <TaskModal proj={proj} g={modal.g} t={modal.t} S={S} navigate={navigate} onClose={() => setModal(null)} />}
        {modal && modal.kind === "addTask" && <AddTaskModal proj={proj} g={modal.g} S={S} onClose={() => setModal(null)} />}
        {modal && modal.kind === "addGroup" && <AddGroupModal proj={proj} S={S} onClose={() => setModal(null)} />}
      </div>
    );
  }

  window.SchedulePlanScreen = SchedulePlanScreen;
})();
