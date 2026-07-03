// PayrollScreen — 工资核算三层钻取：项目 → 班组 → 工资总表（含矩阵 Tab）
// 按 subcontract-payroll.md：计件/计时两种模式 + 发放比例递增 + 合理性校验（安全教育未录入标红）。
// 风格对齐 STYLE-GUIDE：下划线 SegTab（替代 StageTab）+ 疏朗表格 + 统一圆角卡片。
(function () {
  const { Button, Panel, StatusChip, Icon } = window.DesignSystem_e3d871;
  const yuan = n => "¥" + Math.round(n).toLocaleString("zh-CN");

  // 最小宽度两排：窗口 <1360（内容区约 <1100）时卡片网格列数减半，等比缩放、不用 auto-fit 自动换行
  const useNarrow = () => {
    const [narrow, setNarrow] = React.useState(window.innerWidth < 1360);
    React.useEffect(() => {
      const onR = () => setNarrow(window.innerWidth < 1360);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }, []);
    return narrow;
  };

  function SegTab({ tabs, active, onChange }) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 2, borderBottom: "1px solid var(--line)" }}>
        {tabs.map((t) => {
          const on = active === t.key;
          return (
            <button key={t.key} onClick={() => onChange(t.key)} style={{
              border: 0, background: "transparent", cursor: "pointer", padding: "9px 16px", marginBottom: -1,
              fontSize: 13, fontWeight: on ? 700 : 500, color: on ? "var(--brand-deep)" : "var(--ink-soft)",
              borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent", whiteSpace: "nowrap",
            }}>{t.label}</button>
          );
        })}
      </div>
    );
  }

  function Breadcrumb({ items }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-soft)" }}>
        {items.map((item, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span>/</span>}
            {item.onClick
              ? <button onClick={item.onClick} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {i === 0 && <Icon name="chevron-left" size={14} />}{item.label}
                </button>
              : <span style={{ color: "var(--ink)", fontWeight: 700 }}>{item.label}</span>}
          </React.Fragment>
        ))}
      </div>
    );
  }

  function PayrollScreen({ data, navigate, params }) {
    const narrow = useNarrow();
    const [selProject, setSelProject] = React.useState((params && params.project) || null);
    const [selCrew, setSelCrew] = React.useState((params && params.crew) || null);
    const [tab, setTab] = React.useState("table");
    const sched = data.payroll.ratioSchedule;
    const ratioNum = (s) => parseInt(String(s).replace("%", "")) || 0;
    const curIdx = Math.max(0, sched.findIndex(s => s.current));
    const [viewIdx, setViewIdx] = React.useState(curIdx);

    const back = () => { if (selCrew) setSelCrew(null); else setSelProject(null); };

    // ── Level 0: 项目卡片 ──
    if (!selProject) return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel padding={14} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="info" size={15} color="var(--brand)" />
          <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>选择项目 → 查看班组 → 进入工资总表（计件 / 计时）</span>
        </Panel>
        {/* 项目卡：4 个项目=语义固定 4 列（窄窗切两排=2 列） */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${narrow ? 2 : 4}, 1fr)`, gap: 16 }}>
          {data.projects.map(p => {
            const crews = data.projectCrews[p.name] || [];
            const total = crews.reduce((s, c) => s + c.net, 0);
            const hasAny = crews.some(c => c.hasData);
            return (
              <button key={p.id} onClick={() => { setSelProject(p.name); setSelCrew(null); }}
                style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-card)", padding: 0, background: "var(--panel)", cursor: "pointer", textAlign: "left", boxShadow: "var(--shadow-card)", transition: "border-color var(--dur-fast)" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "var(--brand)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "var(--line)"}>
                <div style={{ padding: "16px 18px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>{p.name}</div>
                    <StatusChip tone={p.status === "在建" ? "brand" : p.status === "收尾" ? "warn" : p.status === "完工" ? "ok" : "neutral"}>{p.status}</StatusChip>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>{p.address}</div>
                </div>
                <div style={{ padding: "10px 18px 14px", borderTop: "1px solid var(--line)", display: "flex", gap: 20 }}>
                  <div><div style={{ fontSize: 11, color: "var(--ink-faint)" }}>参与班组</div><div style={{ fontSize: 16, fontWeight: 800, marginTop: 2, fontFamily: "var(--font-mono)" }}>{crews.length}</div></div>
                  <div><div style={{ fontSize: 11, color: "var(--ink-faint)" }}>本期实发</div><div style={{ fontSize: 16, fontWeight: 800, marginTop: 2, fontFamily: "var(--font-mono)", color: hasAny ? "var(--brand)" : "var(--ink-faint)" }}>{hasAny ? yuan(total) : "—"}</div></div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );

    // ── Level 1: 班组列表 ──
    const crews = data.projectCrews[selProject] || [];
    if (!selCrew) return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Breadcrumb items={[{ label: "工资核算", onClick: back }, { label: selProject }]} />
        {/* 班组卡：语义固定 3 列（每项目 1~3 个班组；窄窗 2 列） */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${narrow ? 2 : 3}, 1fr)`, gap: 16 }}>
          {crews.map((c, i) => (
            <button key={i} onClick={() => { if (c.hasData) setSelCrew(c.crew); }}
              style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-card)", padding: "16px 18px", background: "var(--panel)", cursor: c.hasData ? "pointer" : "not-allowed", textAlign: "left", opacity: c.hasData ? 1 : 0.6, boxShadow: c.hasData ? "var(--shadow-card)" : "none", transition: "border-color var(--dur-fast)" }}
              onMouseEnter={e => c.hasData && (e.currentTarget.style.borderColor = "var(--brand)")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--line)")}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ width: 36, height: 36, borderRadius: 9, background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 800, display: "grid", placeItems: "center" }}>{c.crew.slice(0, 1)}</span>
                <div><div style={{ fontSize: 15, fontWeight: 800 }}>{c.crew}</div><div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{c.trade} · {c.workers}人</div></div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>本期实发</span>
                <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "var(--font-mono)", color: c.hasData ? "var(--brand)" : "var(--ink-faint)" }}>{c.hasData ? yuan(c.net) : "暂无数据"}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );

    // ── Level 2: 工资总表 ──
    const p = data.payroll;
    const selR = ratioNum(sched[viewIdx].r) / 100;
    const prevR = viewIdx > 0 ? ratioNum(sched[viewIdx - 1].r) / 100 : 0;
    const selMonth = sched[viewIdx].m;
    const isLatest = viewIdx === curIdx;
    const compute = r => {
      if (r.mode === "time") { const g = r.days * r.daily; return { gross: g, period: g, prevCum: 0, net: Math.round(g - r.deduct) }; }
      const gross = r.engineering + r.rent + r.mgmt;
      const cum = Math.round(gross * selR);
      const prevCum = Math.round(gross * prevR);
      const period = cum - prevCum;
      return { gross, period, prevCum, net: Math.round(period - r.deduct) };
    };

    const TH = { padding: "12px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", position: "sticky", top: 0, whiteSpace: "nowrap" };
    const TD = { padding: "12px 14px", fontSize: 13 };
    const num = { ...TD, textAlign: "right", fontFamily: "var(--font-mono)" };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Breadcrumb items={[{ label: "工资核算", onClick: () => { setSelProject(null); setSelCrew(null); } }, { label: selProject, onClick: () => setSelCrew(null) }, { label: selCrew }]} />

        {/* 发放比例 · 可点选月份查看历史发放 */}
        <Panel padding={16}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)" }}>发放比例 · 随完工进度递增</span>
            <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>点击月份查看当期发放明细</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-soft)" }}>当前查看：<b style={{ color: "var(--brand-deep)", fontFamily: "var(--font-mono)" }}>{selMonth} · {Math.round(selR * 100)}%</b>{isLatest ? "（最新）" : "（历史）"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {sched.map((s, i) => {
              const on = i === viewIdx;
              const past = i < viewIdx;
              return (
                <React.Fragment key={s.m}>
                  <button onClick={() => setViewIdx(i)} style={{ textAlign: "center", flex: "none", border: 0, background: "transparent", cursor: "pointer", padding: 0 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 999, display: "grid", placeItems: "center", margin: "0 auto", fontSize: 13, fontWeight: 800, fontFamily: "var(--font-mono)", border: "2px solid", borderColor: on ? "var(--brand)" : past ? "var(--ok)" : "var(--line-strong)", background: on ? "var(--brand)" : past ? "var(--ok-soft)" : "#fff", color: on ? "#fff" : past ? "var(--ok-ink)" : "var(--ink-soft)", transition: "all var(--dur-fast)" }}>{s.r}</div>
                    <div style={{ fontSize: 11, marginTop: 4, color: on ? "var(--brand)" : "var(--ink-soft)", fontWeight: on ? 800 : 600 }}>{s.m}{s.current ? " ·本月" : ""}</div>
                  </button>
                  {i < sched.length - 1 && <div style={{ flex: 1, height: 2, background: i < viewIdx ? "var(--ok)" : "var(--line)", marginBottom: 18 }}></div>}
                </React.Fragment>
              );
            })}
          </div>
        </Panel>

        {/* Tab + 操作 */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "0 8px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ flex: 1 }}>
              <SegTab tabs={[{ key: "table", label: "工资总表" }, { key: "matrix", label: "工程量矩阵" }]} active={tab} onChange={setTab} />
            </div>
            <div style={{ display: "flex", gap: 8, padding: "8px 8px 8px 0" }}>
              <Button size="sm" icon="file-text" onClick={() => navigate("wageSlip", { crew: selCrew, project: selProject, month: selMonth })}>请款单格式</Button>
              <Button size="sm" icon="download" onClick={() => (window.KitUI || { toast: () => {} }).toast("正在导出 Excel（4 sheet：审批表/进度清单/工资表/考勤表）…")}>导出 Excel（4 sheet）</Button>
            </div>
          </div>

          {tab === "table" && (
            <div style={{ overflow: "auto", maxHeight: 460 }}>
              <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={{ ...TH, textAlign: "left" }}>工人</th>
                  <th style={{ ...TH, textAlign: "left" }}>方式</th>
                  {["工程金额", "补贴", "提成", "应发总额", "比例", "本期应发", "累计已发", "扣款", "实发金额"].map(h => <th key={h} style={{ ...TH, textAlign: "right" }}>{h}</th>)}
                  <th style={{ ...TH, textAlign: "center" }}>安全教育</th>
                  <th style={{ ...TH, textAlign: "center" }}>操作</th>
                </tr></thead>
                <tbody>
                  {p.rows.map(r => {
                    const c = compute(r);
                    return (
                      <tr key={r.worker} style={{ borderBottom: "1px solid var(--line)", transition: "background var(--dur-fast)" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--surface-3)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <td style={{ ...TD, fontWeight: 700, color: r.mode === "piece" ? "var(--brand)" : "var(--ink)" }}>{r.worker}</td>
                        <td style={TD}>{r.mode === "piece" ? <StatusChip tone="brand">计件</StatusChip> : <StatusChip tone="neutral">计时</StatusChip>}</td>
                        {r.mode === "piece" ? <>
                          <td style={num}>{yuan(r.engineering)}</td>
                          <td style={num}>{r.rent ? yuan(r.rent) : "—"}</td>
                          <td style={num}>{r.mgmt ? yuan(r.mgmt) : "—"}</td>
                          <td style={{ ...num, fontWeight: 700 }}>{yuan(c.gross)}</td>
                          <td style={num}>{Math.round(selR * 100)}%</td>
                          <td style={num}>{yuan(c.period)}</td>
                          <td style={{ ...num, color: "var(--ink-soft)" }}>{yuan(c.prevCum)}</td>
                          <td style={{ ...num, color: r.deduct ? "var(--danger)" : "var(--ink-faint)" }}>{r.deduct ? "−" + yuan(r.deduct) : "—"}</td>
                        </> : <>
                          <td style={{ ...num, color: "var(--ink-soft)" }} colSpan={5}>出勤 {r.days} 天 × {yuan(r.daily)}/天</td>
                          <td style={num}>{yuan(c.period)}</td>
                          <td style={{ ...num, color: "var(--ink-faint)" }}>—</td>
                          <td style={{ ...num, color: "var(--ink-faint)" }}>—</td>
                        </>}
                        <td style={{ ...num, fontWeight: 800, color: "var(--brand)" }}>{yuan(c.net)}</td>
                        <td style={{ ...TD, textAlign: "center" }}>{r.safety ? <Icon name="shield-check" size={16} color="var(--ok)" /> : <StatusChip tone="danger">未完成</StatusChip>}</td>
                        <td style={{ ...TD, textAlign: "center" }}>
                          {r.mode === "piece" && (
                            <button onClick={() => navigate("payrollDetail", { worker: r.worker, crew: selCrew, project: selProject, month: selMonth })}
                              style={{ border: "1px solid var(--brand)", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", background: "var(--brand-soft)", color: "var(--brand-deep)", fontWeight: 600 }}>
                              明细
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === "matrix" && (
            <div style={{ fontSize: 13, color: "var(--ink-soft)", textAlign: "center", padding: 40 }}>
              <Icon name="grid-2x2" size={32} color="var(--ink-faint)" />
              <div style={{ marginTop: 12, fontWeight: 700, color: "var(--ink)" }}>工程量矩阵视图</div>
              <div style={{ marginTop: 6, fontSize: 12 }}>可在「工程量管理」主菜单查看完整矩阵，或点击矩阵格子跳转至此工资明细。</div>
              <button onClick={() => navigate("quantity")} style={{ marginTop: 14, border: "1px solid var(--brand)", borderRadius: 8, padding: "9px 20px", fontSize: 13, cursor: "pointer", background: "var(--brand-soft)", color: "var(--brand-deep)", fontWeight: 700 }}>
                前往工程量矩阵 →
              </button>
            </div>
          )}
        </Panel>

        {/* 合理性校验提示 */}
        <Panel padding={14} style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "var(--warn-soft)", borderColor: "var(--warn)" }}>
          <Icon name="triangle-alert" size={16} color="var(--warn-ink)" />
          <div style={{ fontSize: 12, color: "var(--warn-ink)", lineHeight: 1.7 }}>
            <b>合理性校验：</b>计件工人出勤过少但工资过高 → 标红；三级安全教育未录入 → 禁止发放 / 标红；计时工人出勤×日薪与记录偏差过大 → 警告。
          </div>
        </Panel>
      </div>
    );
  }

  window.PayrollScreen = PayrollScreen;
})();
