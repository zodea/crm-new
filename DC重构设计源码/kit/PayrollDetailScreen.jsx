// PayrollDetailScreen — 个人工资明细子页（墙砖计算式 + 取整基数 + 瀑布）
// 面包屑可逐级回退：工资核算 / 项目 / 班组 / 工人（班组级可点回到工资总表对应层级）。
(function () {
  const { Button, Panel, StatusChip, Icon } = window.DesignSystem_e3d871;
  const yuan = n => "¥" + Math.round(n).toLocaleString("zh-CN");

  function PayrollDetailScreen({ data, params, navigate }) {
    const d = data.payroll.detail;
    const worker = (params && params.worker) || d.worker;
    const crew = (params && params.crew) || data.payroll.crew;
    const project = (params && params.project) || data.payroll.project;
    const month = (params && params.month) || data.payroll.month;
    const [expandCalc, setExpandCalc] = React.useState(false);

    const eng = d.lines.reduce((s, l) => s + l.price * l.qty, 0);
    const deduct = d.deductItems.reduce((s, x) => s + x.amt, 0);
    const gross = eng + d.rent + d.mgmt;
    const period = Math.round(gross * d.ratio);
    const net = Math.round(period - d.prevPaid - deduct);

    const steps = [
      { label: "工程金额", val: eng, op: "", note: "Σ 各分项工程量 × 单价" },
      { label: "房租补贴", val: d.rent, op: "+", note: "选定分项工程量合计 × 补贴单价" },
      { label: "管理提成", val: d.mgmt, op: "+", note: "选定分项工程量合计 × 管理单价" },
      { label: "应发总额", val: gross, op: "=", strong: true },
      { label: "发放比例 " + Math.round(d.ratio * 100) + "%", val: period, op: "×", note: "本期应发 = 应发总额 × 比例" },
      { label: "累计已发", val: -d.prevPaid, op: "−", note: "之前月份累计发放" },
      { label: "罚款/扣款", val: -deduct, op: "−", note: d.deductItems.map(x => x.reason).join("、") },
      { label: "实发金额（取整）", val: net, op: "=", strong: true, accent: true },
    ];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 面包屑（逐级可回退）*/}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-soft)", flexWrap: "wrap" }}>
          <button onClick={() => window.DC.closeActiveTab()} title="关闭页签（左邻页签自动激活）" style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="chevron-left" size={14} />工资核算
          </button>
          <span style={{ opacity: 0.4 }}>/</span>
          <button onClick={() => navigate("payroll", { project })} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>{project}</button>
          <span style={{ opacity: 0.4 }}>/</span>
          <button onClick={() => navigate("payroll", { project, crew })} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>{crew}</button>
          <span style={{ opacity: 0.4 }}>/</span>
          <span style={{ color: "var(--ink)", fontWeight: 700 }}>{worker}</span>
          {month && <StatusChip tone="neutral">{month} 当期</StatusChip>}
          {d.partner && worker === d.worker && <StatusChip tone="brand">夫妻关联 {d.partner}（独立核算）</StatusChip>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--brand-soft)", border: "1px solid rgba(37,99,235,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
          <Icon name="info" size={14} color="var(--brand)" />
          <span style={{ color: "var(--brand)", fontWeight: 600 }}>{d.roundNote}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
          <Panel padding={0} style={{ overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", fontSize: 14, fontWeight: 800 }}>分项工程金额明细</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                {["分项", "单位", "单价", "暂定量", "金额"].map((h, i) => (
                  <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 800, color: "var(--ink-soft)", background: "var(--surface-2)", textAlign: i >= 2 ? "right" : "left" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {d.lines.map((l, li) => (
                  <React.Fragment key={li}>
                    <tr style={{ borderTop: "1px solid var(--line)", background: l.calc ? "var(--surface-2)" : "transparent" }}>
                      <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {l.name}
                          {l.calc && (
                            <button onClick={() => setExpandCalc(v => !v)}
                              style={{ border: "1px solid var(--line)", borderRadius: 4, padding: "1px 6px", fontSize: 10, cursor: "pointer", background: "#fff", color: "var(--brand)" }}>
                              {expandCalc ? "收起" : "展开计算式"}
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "9px 12px", fontSize: 13, color: "var(--ink-soft)" }}>{l.unit}</td>
                      <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{l.price}</td>
                      <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{l.qty}</td>
                      <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--brand)" }}>{yuan(l.price * l.qty)}</td>
                    </tr>
                    {l.calc && expandCalc && l.calc.map((row, ri) => (
                      <tr key={ri} style={{ borderTop: "1px dashed var(--line)", background: "#fafbff" }}>
                        <td style={{ padding: "6px 12px 6px 24px", fontSize: 12, color: "var(--ink-soft)" }}>
                          {row.summary ? <span style={{ fontStyle: "italic" }}>{row.room}</span> : row.room}
                        </td>
                        <td colSpan={2} style={{ padding: "6px 12px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>
                          {row.expr && <span>{row.expr}</span>}
                        </td>
                        <td colSpan={2} style={{ padding: "6px 12px", fontSize: 12, textAlign: "right", fontFamily: "var(--font-mono)", color: row.val != null ? "var(--ink)" : "var(--ink-faint)", fontStyle: row.summary ? "italic" : "normal" }}>
                          {row.val != null ? row.val + " " + d.lines[0].unit : ""}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr style={{ borderTop: "2px solid var(--line-strong)" }}>
                  <td colSpan={4} style={{ padding: "10px 12px", fontSize: 13, fontWeight: 800 }}>工程金额合计</td>
                  <td style={{ padding: "10px 12px", fontSize: 15, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 800, color: "var(--brand)" }}>{yuan(eng)}</td>
                </tr>
              </tbody>
            </table>

            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-soft)", marginBottom: 8 }}>扣款明细</div>
              {d.deductItems.map((x, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: "var(--danger)" }}>{x.reason}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--danger)" }}>−{yuan(x.amt)}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel padding={16}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>计算流程</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {steps.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: s.strong ? "10px 12px" : "7px 10px", borderRadius: 8, background: s.accent ? "var(--brand-soft)" : s.strong ? "var(--surface-2)" : "transparent", border: s.accent ? "1px solid var(--brand)" : "1px solid transparent" }}>
                  <span style={{ width: 20, textAlign: "center", fontSize: 15, fontWeight: 800, color: s.op === "−" ? "var(--danger)" : s.op === "=" ? "var(--ink)" : "var(--ink-soft)", fontFamily: "var(--font-mono)" }}>{s.op}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: s.strong ? 14 : 13, fontWeight: s.strong ? 800 : 600 }}>{s.label}</div>
                    {s.note && <div style={{ fontSize: 11, color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.note}</div>}
                  </div>
                  <span style={{ fontSize: s.accent ? 18 : s.strong ? 15 : 13, fontWeight: s.strong ? 800 : 600, fontFamily: "var(--font-mono)", color: s.accent ? "var(--brand)" : s.val < 0 ? "var(--danger)" : "var(--ink)" }}>
                    {s.val < 0 ? "−" + yuan(-s.val) : yuan(s.val)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    );
  }
  window.PayrollDetailScreen = PayrollDetailScreen;
})();
