// HomeScreenNew — 首页仪表盘：项目Tab + 统一施工进度甘特（计划vs实际同轴+today线+成本对比）+ 指标卡 + 收支柱状图 + 支出环形图
// 反馈轮4：原「开工→完工总进度」里程碑卡 + 「工程量进度」楼层甘特两张割裂卡 → 合并为一张统一甘特。
// 数据源：kit/ScheduleData.jsx 注册的 window.SCHEDULE（22 道工序标准库 + 楼栋分组 + PDF 计划日期）；
// 工序点击 → navigate("quantity", {group, trade, item, task, from}) 下钻工程量矩阵（#29 承接）。
(function () {
  const { Button, Panel, StatusChip, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {} };

  // 最小宽度两排：窗口 <1360（内容区约 <1100）时指标网格列数减半，等比缩放、不用 auto-fit 自动换行
  const useNarrow = () => {
    const [narrow, setNarrow] = React.useState(window.innerWidth < 1360);
    React.useEffect(() => {
      const onR = () => setNarrow(window.innerWidth < 1360);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }, []);
    return narrow;
  };

  const PROJECTS = ["合和新城", "锦绣华庭", "翠湖花园"];

  const METRICS = {
    "合和新城": [
      { label: "合同总额", val: "¥2,860万", sub: "含变更 ¥260万", col: "var(--ink)" },
      { label: "累计收款", val: "¥1,720万", sub: "回款率 60.2%", col: "var(--ok)" },
      { label: "累计支出", val: "¥1,341万", sub: "材料+分包+其他", col: "var(--danger)" },
      { label: "已开票/税额", val: "¥1,580万", sub: "税额 ¥182万", col: "var(--ink)" },
    ],
    "锦绣华庭": [
      { label: "合同总额", val: "¥1,560万", sub: "含变更 ¥160万", col: "var(--ink)" },
      { label: "累计收款", val: "¥680万", sub: "回款率 43.6%", col: "var(--ok)" },
      { label: "累计支出", val: "¥524万", sub: "材料+分包+其他", col: "var(--danger)" },
      { label: "已开票/税额", val: "¥720万", sub: "税额 ¥82.8万", col: "var(--ink)" },
    ],
    "翠湖花园": [
      { label: "合同总额", val: "¥3,120万", sub: "含变更 ¥220万", col: "var(--ink)" },
      { label: "累计收款", val: "¥3,050万", sub: "回款率 97.8%", col: "var(--ok)" },
      { label: "累计支出", val: "¥2,780万", sub: "材料+分包+其他", col: "var(--danger)" },
      { label: "已开票/税额", val: "¥3,080万", sub: "税额 ¥354万", col: "var(--ink)" },
    ],
  };

  const ML = ["9月", "10月", "11月", "12月", "1月", "2月", "3月", "4月"];
  const MONTHLY = {
    "合和新城": [
      { l: "9月",  i: 280, e: 180 }, { l: "10月", i: 0,   e: 120 },
      { l: "11月", i: 320, e: 200 }, { l: "12月", i: 0,   e: 95  },
      { l: "1月",  i: 420, e: 280 }, { l: "2月",  i: 0,   e: 60  },
      { l: "3月",  i: 0,   e: 145 }, { l: "4月",  i: 350, e: 220 },
    ],
    "锦绣华庭": [
      { l: "9月",  i: 0,   e: 0   }, { l: "10月", i: 0,   e: 0   },
      { l: "11月", i: 0,   e: 0   }, { l: "12月", i: 0,   e: 0   },
      { l: "1月",  i: 200, e: 120 }, { l: "2月",  i: 0,   e: 80  },
      { l: "3月",  i: 240, e: 160 }, { l: "4月",  i: 0,   e: 96  },
    ],
    "翠湖花园": [
      { l: "9月",  i: 380, e: 310 }, { l: "10月", i: 0,   e: 220 },
      { l: "11月", i: 460, e: 380 }, { l: "12月", i: 320, e: 280 },
      { l: "1月",  i: 520, e: 420 }, { l: "2月",  i: 280, e: 230 },
      { l: "3月",  i: 0,   e: 180 }, { l: "4月",  i: 450, e: 360 },
    ],
  };

  const ECATS = {
    "合和新城": [
      { l: "材料", p: 51, c: "#3976C6" }, { l: "分包", p: 30, c: "#169D72" },
      { l: "人工", p: 13, c: "#D38A20" }, { l: "其他", p: 6,  c: "#E04E5C" },
    ],
    "锦绣华庭": [
      { l: "材料", p: 58, c: "#3976C6" }, { l: "分包", p: 25, c: "#169D72" },
      { l: "人工", p: 12, c: "#D38A20" }, { l: "其他", p: 5,  c: "#E04E5C" },
    ],
    "翠湖花园": [
      { l: "材料", p: 46, c: "#3976C6" }, { l: "分包", p: 35, c: "#169D72" },
      { l: "人工", p: 14, c: "#D38A20" }, { l: "其他", p: 5,  c: "#E04E5C" },
    ],
  };

  // ── 统一施工进度甘特 ──────────────────────────────────────
  function ScheduleGantt({ project, navigate }) {
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
    if (!S) return <Panel padding={18}><div style={{ fontSize: 12, color: "var(--ink-soft)" }}>加载排程数据…</div></Panel>;

    const p = S.state[project];
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
      if (t.hasQty) navigate("quantity", { group: g.name, trade: t.trade, item: t.item, task: t.name, ps: t.ps, pf: t.pf, from: "home" });
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
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-faint)" }}>点工序下钻工程量 · 计划编辑在施工进度页</span>
          <Button size="sm" variant="secondary" icon="calendar-range" onClick={() => navigate("schedule")}>打开施工进度</Button>
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

        {/* 图例 + 项目级成本对比 */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "8px 18px", borderBottom: "1px solid var(--line)", fontSize: 11, color: "var(--ink-soft)", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#6366f1", opacity: 0.22, borderRadius: 2, display: "inline-block" }} />计划区间</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 8, background: "#6366f1", borderRadius: 2, display: "inline-block" }} />实际完成</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 2, height: 12, background: "var(--danger)", display: "inline-block" }} />今天</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="link" size={11} style={{ color: "var(--brand)" }} />可下钻工程量</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 8, border: "1.5px dashed var(--danger)", borderRadius: 2, display: "inline-block" }} />应开未开</span>
        </div>
        <div style={{ display: "flex", alignItems: "stretch", gap: 0, padding: "10px 18px 14px", flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", paddingRight: 16, borderRight: "1px solid var(--line)" }}>项目成本<br />目标 vs 实际</div>
          {p.cost.map(c => {
            const dev = c.actual - c.expected;
            const tone = dev > c.expected * 0.03 ? "danger" : dev < -c.expected * 0.03 ? "ok" : "neutral";
            return (
              <div key={c.cat} style={{ flex: 1, minWidth: 130, padding: "0 14px", borderRight: "1px solid var(--line)" }}>
                <div style={{ fontSize: 11, color: "var(--ink-soft)", display: "flex", justifyContent: "space-between" }}>
                  <span>{c.cat}</span><span>目标 {c.target}万</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 16 }}>{c.actual}万</span>
                  <span style={{ transform: "scale(0.9)", transformOrigin: "left center" }}>
                    <StatusChip tone={tone}>{dev > 0 ? `超 ${dev}万` : dev < 0 ? `省 ${-dev}万` : "持平"}</StatusChip>
                  </span>
                </div>
                <div style={{ position: "relative", height: 5, background: "var(--surface-3)", borderRadius: 99, marginTop: 5 }}>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: Math.min(c.actual / c.target * 100, 100) + "%", background: tone === "danger" ? "var(--danger)" : "var(--brand)", borderRadius: 99 }} />
                  <div style={{ position: "absolute", left: Math.min(c.expected / c.target * 100, 100) + "%", top: -2, bottom: -2, width: 2, background: "var(--ink)", opacity: 0.5 }} title="按进度应耗" />
                </div>
              </div>
            );
          })}
          {(() => {
            const t = p.cost.reduce((s, c) => s + c.target, 0), a = p.cost.reduce((s, c) => s + c.actual, 0), e = p.cost.reduce((s, c) => s + c.expected, 0);
            const dev = a - e; const pct = Math.round(dev / e * 1000) / 10;
            return (
              <div style={{ flex: "none", paddingLeft: 16, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>合计 {a}万 / 目标 {t}万</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: dev > 0 ? "var(--danger)" : "var(--ok-ink)", fontFamily: "var(--font-mono)" }}>
                  {dev > 0 ? "+" : ""}{pct}% <span style={{ fontSize: 11, fontWeight: 600 }}>{dev > 0 ? "超支" : "结余"}（按进度）</span>
                </div>
              </div>
            );
          })()}
        </div>
      </Panel>
    );
  }

  // ── SVG Bar chart ──────────────────────────────────────
  function BarChart({ monthly }) {
    const W = 480, H = 160;
    const PAD = { l: 44, r: 12, t: 10, b: 28 };
    const iH = H - PAD.t - PAD.b, iW = W - PAD.l - PAD.r;
    const maxV = Math.max(...monthly.map(d => Math.max(d.i, d.e)), 100);
    const yS = v => PAD.t + iH - (v / maxV) * iH;
    const slotW = iW / monthly.length;
    const bW = slotW * 0.27;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(maxV * f));

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={yS(v)} x2={W - PAD.r} y2={yS(v)} stroke="#e5e7eb" strokeWidth={1} />
            {v > 0 && <text x={PAD.l - 4} y={yS(v) + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{v}万</text>}
          </g>
        ))}
        {monthly.map((d, i) => {
          const cx = PAD.l + i * slotW + slotW / 2;
          const base = PAD.t + iH;
          const iBar = d.i / maxV * iH, eBar = d.e / maxV * iH;
          return (
            <g key={i}>
              {d.i > 0 && <rect x={cx - bW - 2} y={base - iBar} width={bW} height={iBar} fill="#3976C6" rx={2} />}
              {d.e > 0 && <rect x={cx + 2} y={base - eBar} width={bW} height={eBar} fill="#E04E5C" rx={2} />}
              <text x={cx} y={H - 5} textAnchor="middle" fontSize={10} fill="#9ca3af">{d.l}</text>
            </g>
          );
        })}
        <line x1={PAD.l} y1={PAD.t + iH} x2={W - PAD.r} y2={PAD.t + iH} stroke="#d1d5db" strokeWidth={1} />
      </svg>
    );
  }

  // ── SVG Donut chart ─────────────────────────────────────
  function DonutChart({ cats }) {
    const cx = 65, cy = 65, R = 54, ri = 33;
    let angle = -Math.PI / 2;
    const paths = cats.map(d => {
      const da = d.p / 100 * Math.PI * 2;
      const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
      const x2 = cx + R * Math.cos(angle + da), y2 = cy + R * Math.sin(angle + da);
      const ix1 = cx + ri * Math.cos(angle + da), iy1 = cy + ri * Math.sin(angle + da);
      const ix2 = cx + ri * Math.cos(angle), iy2 = cy + ri * Math.sin(angle);
      const lg = da > Math.PI ? 1 : 0;
      const path = `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 ${lg} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L${ix1.toFixed(2)} ${iy1.toFixed(2)} A${ri} ${ri} 0 ${lg} 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)} Z`;
      angle += da;
      return { ...d, path };
    });
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <svg viewBox="0 0 130 130" style={{ width: "42%", maxWidth: 132, height: "auto", aspectRatio: "1 / 1", flexShrink: 0 }}>
          {paths.map((p, i) => <path key={i} d={p.path} fill={p.c} />)}
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {cats.map((c, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c.c, flexShrink: 0, display: "inline-block" }} />
              <span style={{ color: "var(--ink-soft)", flex: 1 }}>{c.l}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{c.p}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Main Component ──────────────────────────────────────
  function HomeScreenNew({ data, navigate }) {
    const narrow = useNarrow();
    const [tab, setTab] = React.useState(0);
    const project = PROJECTS[tab];
    const metrics = METRICS[project];
    const monthly = MONTHLY[project];
    const expCats = ECATS[project];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Project tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--line)", alignItems: "flex-end" }}>
          {PROJECTS.map((p, i) => (
            <button key={p} type="button" onClick={() => setTab(i)}
              style={{ padding: "10px 18px 8px", border: 0, background: "transparent", cursor: "pointer",
                borderBottom: `2px solid ${tab === i ? "var(--brand)" : "transparent"}`,
                marginBottom: -1, fontSize: 13, fontWeight: tab === i ? 700 : 500,
                color: tab === i ? "var(--brand-deep)" : "var(--ink-soft)", transition: "all 0.15s" }}>
              {p}
            </button>
          ))}
          <button type="button" onClick={() => navigate("project")} style={{ marginLeft: "auto", padding: "10px 16px 8px", border: 0, background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--brand)", fontWeight: 600, borderBottom: "2px solid transparent", marginBottom: -1 }}>
            全部项目 →
          </button>
        </div>

        {/* 统一施工进度甘特（计划 vs 实际 + today + 成本对比） */}
        <ScheduleGantt project={project} navigate={navigate} />

        {/* Metric cards：4 个指标=语义固定 4 列（窄窗切两排=2 列） */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${narrow ? 2 : 4}, 1fr)`, gap: 12 }}>
          {metrics.map((m, i) => (
            <div key={i} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", padding: "16px 20px", boxShadow: "var(--shadow-card)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", letterSpacing: "0.02em" }}>{m.label}</div>
              <div style={{ fontSize: 22, fontFamily: "var(--font-mono)", fontWeight: 700, color: m.col, margin: "6px 0 4px", lineHeight: 1.2 }}>{m.val}</div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{m.sub}</div>
            </div>
          ))}
        </div>

        {/* Charts row：比例列宽 7:3（替代固定 280px 右栏），SVG 图表 viewBox 自适应 */}
        <div style={{ display: "grid", gridTemplateColumns: "7fr 3fr", gap: 12 }}>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", padding: "16px 20px", boxShadow: "var(--shadow-card)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>月度收支对比</div>
              <div style={{ display: "flex", gap: 14, fontSize: 11 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "#3976C6", display: "inline-block" }} />收款</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "#E04E5C", display: "inline-block" }} />支出</span>
              </div>
            </div>
            <BarChart monthly={monthly} />
          </div>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", padding: "16px 20px", boxShadow: "var(--shadow-card)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>支出分类</div>
            <DonutChart cats={expCats} />
          </div>
        </div>
      </div>
    );
  }

  window.AppHomeScreen = HomeScreenNew;
})();
