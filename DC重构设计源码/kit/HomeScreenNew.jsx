// HomeScreenNew — 首页：项目切换 + 统一施工进度甘特（计划vs实际同轴 + today线）。
// 反馈轮4：原「开工→完工总进度」里程碑卡 + 「工程量进度」楼层甘特两张割裂卡 → 合并为一张统一甘特。
// 反馈轮8：删除底部「项目级成本对比」条（口径不透明、首页用处不大，成本对比归工程量清单看毛利）；
//          删除指标卡 / 月度收支 / 支出分类模块（在项目详情页查看），首页只留 项目Tab + 甘特 + 图例。
// 数据源：kit/ScheduleData.jsx 注册的 window.SCHEDULE；项目目录来自 window.APP；工序点击 → navigate("quantity", {...}) 下钻。
(function () {
  const { Button, Panel, StatusChip, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {} };

  const fallbackProjects = [{ id: "p1", name: "合和新城" }, { id: "p2", name: "锦绣华庭" }, { id: "p3", name: "翠湖花园" }];

  function projectOptions() {
    const A = window.APP;
    const S = window.SCHEDULE;
    const rows = A && A.rows ? A.rows("projects") : [];
    const projects = rows.length ? rows : fallbackProjects;
    return projects.map((row) => ({ id: row.id, name: row.name, hasSchedule: !!(S && S.byProjectId && S.byProjectId[row.id]) }));
  }

  // ── 统一施工进度甘特 ──────────────────────────────────────
  function ScheduleGantt({ projectId, navigate }) {
    const [, force] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
      if (!window.SCHEDULE) {
        const t = setInterval(() => { if (window.SCHEDULE) { clearInterval(t); force(); } }, 50);
        return () => clearInterval(t);
      }
      return window.SCHEDULE.subscribe(force);
    }, []);
    const S = window.SCHEDULE;
    const [open, setOpen] = React.useState({});
    if (!S) return <Panel padding={18}><div style={{ fontSize: 13, color: "var(--ink-soft)" }}>施工进度加载中…</div></Panel>;

    const p = S.byProjectId && S.byProjectId[projectId];
    if (!p) return (
      <Panel padding={22}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 9, background: "var(--surface-2)" }}><Icon name="calendar-x" size={18} color="var(--ink-soft)" /></span>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>当前项目暂无施工排程</div>
            <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-soft)" }}>可先建立楼栋分组，再开始维护工序计划。</div>
          </div>
          <Button size="sm" variant="secondary" icon="external-link" onClick={() => navigate("projectDetail", { id: projectId })}>打开项目详情</Button>
        </div>
      </Panel>
    );
    const allTasks = p.groups.flatMap(g => g.tasks);
    // 时间轴：项目开工月首 → 计划完工月末
    const axisStart = p.start.slice(0, 8) + "01";
    const endD = S.D(p.plannedEnd); const axisEnd = new Date(endD.getFullYear(), endD.getMonth() + 1, 0);
    const total = Math.max((axisEnd - S.D(axisStart)) / 86400000, 1);
    const X = d => Math.max(0, Math.min(100, S.days(axisStart, d) / total * 100));
    const todayX = X(p.today);
    // 月刻度
    const months = [];
    for (let d = S.D(axisStart); d <= axisEnd; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      months.push({ label: (d.getMonth() === 0 ? (d.getFullYear() % 100) + "年" : "") + (d.getMonth() + 1) + "月", x: X(d.toISOString().slice(0, 10)) });
    }
    const overall = S.rollup(allTasks, p.today);
    const overallTone = overall.dev > 0 ? "ok" : overall.dev < 0 ? "warn" : "brand";
    const overallTxt = overall.dev > 0 ? `整体领先约 ${overall.dev} 天` : overall.dev < 0 ? `整体落后约 ${-overall.dev} 天` : "按计划推进";
    const fmt = s => s.replace(/-/g, ".");
    const isOpen = g => open[g.id] != null ? open[g.id] : !g.collapsed;

    const devChip = t => {
      const st = S.status(t, p.today);
      if (st === "done") { const d = S.devDays(t, p.today); return <StatusChip tone={d >= 0 ? "ok" : "danger"}>{d > 0 ? `提前${d}天` : d < 0 ? `延后${-d}天` : "按期"}</StatusChip>; }
      if (st === "doing") { const d = S.devDays(t, p.today); return <StatusChip tone={d >= 0 ? "brand" : "warn"}>{Math.round(t.actual * 100)}%{d < 0 ? ` 慢${-d}天` : d > 0 ? ` 快${d}天` : ""}</StatusChip>; }
      if (st === "late-start") return <StatusChip tone="danger">应开未开</StatusChip>;
      return <StatusChip tone="neutral">待开始</StatusChip>;
    };

    const clickTask = (g, t) => {
      if (t.hasQty) navigate("quantity", { projectId, group: g.name, trade: t.trade, item: t.item, task: t.name, ps: t.ps, pf: t.pf, from: "home" });
      else UI().toast("「" + t.name + "」为手动填报工序，请在施工进度页更新进度");
    };

    // 甘特左列：比例列宽（约 22%）+ 上下限，替代固定 236px，整体随窗口等比缩放
    const LEFT_W = "clamp(170px, 22%, 236px)";

    // 行渲染：左列 + 时间区
    const Row = ({ left, leftPad, bar, onClick, bg }) => (
      <div onClick={onClick} style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--line)", cursor: onClick ? "pointer" : "default", background: bg || "transparent" }}
        onMouseEnter={e => { if (onClick) e.currentTarget.style.background = "var(--brand-soft)"; }}
        onMouseLeave={e => { if (onClick) e.currentTarget.style.background = bg || "transparent"; }}>
        <div style={{ width: LEFT_W, flex: "none", padding: `6px 8px 6px ${leftPad}px`, display: "flex", alignItems: "center", gap: 6, borderRight: "1px solid var(--line)", minWidth: 0 }}>{left}</div>
        <div style={{ flex: 1, position: "relative", minHeight: 30 }}>
          {months.map((m, i) => <div key={i} style={{ position: "absolute", left: m.x + "%", top: 0, bottom: 0, borderLeft: "1px dashed rgba(0,0,0,0.05)" }} />)}
          {bar}
          <div style={{ position: "absolute", left: todayX + "%", top: 0, bottom: 0, width: 2, background: "var(--danger)", opacity: 0.55 }} />
        </div>
      </div>
    );

    return (
      <Panel padding={0}>
        {/* 头部 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px 10px", flexWrap: "wrap" }}>
          <span style={{ width: 4, height: 16, borderRadius: 2, background: "var(--brand)" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>施工进度</span>
          <StatusChip tone={overallTone}>{overallTxt}</StatusChip>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
            开工 <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{fmt(p.start)}</b>
            <span style={{ margin: "0 6px", color: "var(--ink-faint)" }}>→</span>
            计划完工 <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{fmt(p.plannedEnd)}</b>
          </span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-faint)" }}>{allTasks.length} 道工序</span>
          <Button size="sm" variant="secondary" icon="calendar-range" onClick={() => navigate("schedule", { projectId })}>打开施工进度</Button>
        </div>

        {/* 月刻度 */}
        <div style={{ display: "flex", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
          <div style={{ width: LEFT_W, flex: "none", padding: "4px 12px", fontSize: 11, fontWeight: 700, color: "var(--ink-faint)", borderRight: "1px solid var(--line)" }}>楼栋分组 / 工序</div>
          <div style={{ flex: 1, position: "relative", height: 22 }}>
            {months.map((m, i) => <div key={i} style={{ position: "absolute", left: m.x + "%", top: 0, bottom: 0, borderLeft: "1px dashed rgba(0,0,0,0.06)", paddingLeft: 4, fontSize: 10, fontWeight: 700, color: "var(--ink-soft)", display: "flex", alignItems: "center" }}>{m.label}</div>)}
            <div style={{ position: "absolute", left: todayX + "%", top: 0, bottom: 0, width: 2, background: "var(--danger)" }} />
            <div style={{ position: "absolute", left: todayX + "%", top: -1, transform: "translateX(-50%)", fontSize: 9, fontWeight: 800, color: "var(--danger)", background: "var(--danger-soft)", borderRadius: 3, padding: "0 4px" }}>今天</div>
          </div>
        </div>

        {/* 分组 + 工序行 */}
        <div>
          {p.groups.map(g => {
            const r = S.rollup(g.tasks, p.today);
            const gs = g.tasks.reduce((m, t) => S.days(t.ps, m) > 0 ? t.ps : m, g.tasks[0].ps);
            const ge = g.tasks.reduce((m, t) => S.days(m, t.pf) > 0 ? t.pf : m, g.tasks[0].pf);
            const gx = X(gs), gw = Math.max(X(ge) - gx, 2);
            const opened = isOpen(g);
            return (
              <React.Fragment key={g.id}>
                <Row bg="rgba(245,246,248,0.9)"
                  onClick={() => setOpen(o => ({ ...o, [g.id]: !opened }))}
                  left={<>
                    <Icon name={opened ? "chevron-down" : "chevron-right"} size={14} />
                    <span style={{ fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                    <span style={{ marginLeft: "auto", flex: "none" }}><StatusChip tone={r.dev >= 0 ? "ok" : "warn"}>{Math.round(r.pct * 100)}%{r.dev !== 0 ? (r.dev > 0 ? " 领先" : " 落后") : ""}</StatusChip></span>
                  </>}
                  leftPad={10}
                  bar={<div style={{ position: "absolute", left: gx + "%", width: gw + "%", top: 8, bottom: 8, background: "var(--surface-3)", border: "1px solid var(--line-strong)", borderRadius: 6, overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (r.pct * 100) + "%", background: "var(--brand)", opacity: 0.75 }} />
                  </div>}
                />
                {opened && g.tasks.map(t => {
                  const tx = X(t.ps), tw = Math.max(X(t.pf) - tx, 1.2);
                  const st = S.status(t, p.today);
                  return (
                    <Row key={t.id}
                      onClick={() => clickTask(g, t)}
                      left={<>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flex: "none" }} />
                        <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                        {t.hasQty && <Icon name="link" size={11} style={{ color: "var(--brand)", flex: "none" }} />}
                        <span style={{ marginLeft: "auto", flex: "none", transform: "scale(0.92)", transformOrigin: "right center" }}>{devChip(t)}</span>
                      </>}
                      leftPad={26}
                      bar={<div style={{ position: "absolute", left: tx + "%", width: tw + "%", top: 8, bottom: 8, background: t.color, opacity: 0.22, borderRadius: 4, border: st === "late-start" ? "1.5px dashed var(--danger)" : "none" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (t.actual * 100) + "%", background: t.color, opacity: 0.95, borderRadius: 3 }} />
                      </div>}
                    />
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>

        {/* 图例（成本对比条已删：反馈轮8，成本对比看工程量清单） */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "9px 18px 11px", fontSize: 11, color: "var(--ink-soft)", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#6366f1", opacity: 0.22, borderRadius: 2, display: "inline-block" }} />计划区间</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 8, background: "#6366f1", borderRadius: 2, display: "inline-block" }} />实际完成</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 2, height: 12, background: "var(--danger)", display: "inline-block" }} />今天</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="link" size={11} style={{ color: "var(--brand)" }} />可下钻工程量</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 8, border: "1.5px dashed var(--danger)", borderRadius: 2, display: "inline-block" }} />应开未开</span>
        </div>
      </Panel>
    );
  }

  // ── Main Component ──────────────────────────────────────
  function HomeScreenNew({ data, navigate }) {
    const options = projectOptions();
    const [selected, setSelected] = React.useState(() => options.find((x) => x.hasSchedule) || options[0]);
    const current = options.find((x) => x.id === selected?.id) || options[0];
    const projectId = current ? current.id : fallbackProjects[0].id;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* 项目切换：项目目录与实际工程数量保持一致，排程缺失时进入可恢复空态 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 10, borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <select value={current?.id || ""} onChange={(e) => setSelected(options.find((x) => String(x.id) === e.target.value) || options[0])}
            aria-label="选择项目" style={{ minWidth: 220, maxWidth: "100%", padding: "8px 34px 8px 12px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "#fff", color: "var(--ink)", fontSize: 13, fontWeight: 700 }}>
            {options.map((x) => <option key={x.id} value={x.id}>{x.name}{x.hasSchedule ? "" : " · 暂无排程"}</option>)}
          </select>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{options.length} 个项目</span>
          <button type="button" onClick={() => navigate("project")} style={{ marginLeft: "auto", padding: "8px 4px", border: 0, background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--brand)", fontWeight: 700 }}>
            查看项目列表 →
          </button>
        </div>

        {/* 统一施工进度甘特（计划 vs 实际 + today）——首页唯一主体（反馈轮8：经营指标/收支/支出分类看项目详情） */}
        <ScheduleGantt projectId={projectId} navigate={navigate} />
      </div>
    );
  }

  window.AppHomeScreen = HomeScreenNew;
})();
