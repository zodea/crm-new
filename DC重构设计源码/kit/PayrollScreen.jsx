// PayrollScreen — 工资核算三层钻取：项目 → 班组(瀑布卡) → 工资总表（单据口径）
// 2026-07-19 工资单据化轮（grill 定稿）：数据源切 window.PAYSLIP（1:1 对应真实工资发放格式 Excel）：
//   · 第二层班组卡 = 资金瀑布：工程量总额 → ×支付比例 → −累计已付 → −空鼓暂扣/借支 → 剩余待付清；
//     100% 直付班组(时工)只显工程量总额一行；瀑布流布局(CSS columns)，卡片高度随内容错落。
//   · 第三层工资总表 = 单据列口径：合计(含房租)/比例/应领/累计已领/暂扣/借支/本次请款/取整/特殊情况；
//     「明细」进 A4 进度款单（PayrollDetailScreen，每 sheet 独立一页可打印）。
(function () {
  const { Button, Panel, StatusChip, Icon } = window.DesignSystem_e3d871;
  const yuan = n => "¥" + Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num0 = n => Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // 最小宽度两排：窗口 <1360（内容区约 <1100）时卡片列数减半
  const useNarrow = () => {
    const [narrow, setNarrow] = React.useState(window.innerWidth < 1360);
    React.useEffect(() => {
      const onR = () => setNarrow(window.innerWidth < 1360);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }, []);
    return narrow;
  };

  const SegTab = (props) => { const KA = window.KitAtoms; return KA ? <KA.SegTab {...props} /> : null; };

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

  // —— 瀑布卡内的一行（label ↔ 金额，可着色）——
  const FlowRow = ({ label, value, tone, strong, first }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10,
      padding: "5px 0", borderTop: first ? "none" : "1px dashed var(--line)" }}>
      <span style={{ fontSize: 12, color: tone === "warn" ? "var(--warn-ink)" : tone === "danger" ? "var(--danger-ink)" : "var(--ink-soft)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: strong ? 14 : 12.5, fontWeight: strong ? 800 : 600,
        color: tone === "warn" ? "var(--warn-ink)" : tone === "danger" ? "var(--danger-ink)" : tone === "ok" ? "var(--ok-ink)" : "var(--ink)" }}>{num0(value)}</span>
    </div>
  );

  function PayrollScreen({ data, navigate, params }) {
    const narrow = useNarrow();
    const [selProject, setSelProject] = React.useState((params && params.project) || null);
    const [selCrew, setSelCrew] = React.useState((params && params.crew) || null);
    const [tab, setTab] = React.useState("table");
    const [viewIdx, setViewIdx] = React.useState(null);   // null=当前月（进班组后按其 schedule 解析）
    const P = window.PAYSLIP;

    const back = () => { if (selCrew) { setSelCrew(null); setViewIdx(null); } else setSelProject(null); };

    // ── Level 0: 项目卡片（不动）──
    if (!selProject) return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel padding={14} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="info" size={15} color="var(--brand)" />
          <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>选择项目 → 班组资金瀑布 → 工资总表 → A4 进度款单（可打印）</span>
        </Panel>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${narrow ? 2 : 4}, 1fr)`, gap: 16 }}>
          {data.projects.map(p => {
            const crews = data.projectCrews[p.name] || [];
            const sums = crews.map(c => P && P.crewSummary(p.name + "|" + c.crew)).filter(Boolean);
            const request = sums.reduce((s, x) => s + (x.payType === "time" ? x.total : x.request), 0);
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
                  <div><div style={{ fontSize: 11, color: "var(--ink-faint)" }}>本期待付</div><div style={{ fontSize: 16, fontWeight: 800, marginTop: 2, fontFamily: "var(--font-mono)", color: sums.length ? "var(--brand)" : "var(--ink-faint)" }}>{sums.length ? yuan(request) : "—"}</div></div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );

    // ── Level 1: 班组瀑布卡（工程量总额 → 比例 → 已付 → 扣罚 → 剩余；100% 直付简版）──
    const crews = data.projectCrews[selProject] || [];
    if (!selCrew) return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Breadcrumb items={[{ label: "工资核算", onClick: back }, { label: selProject }]} />
        {/* 瀑布流布局：CSS columns，卡片高度随内容错落（grill 定稿：不做方方正正统一格子） */}
        <div style={{ columnCount: narrow ? 2 : 3, columnGap: 16 }}>
          {crews.map((c, i) => {
            const key = selProject + "|" + c.crew;
            const S = P && P.crewSummary(key);
            const clickable = !!S;
            const hollowCnt = S && S.payType === "piece" ? S.rows.reduce((s, x) => s + x.c.hollowSum, 0) : 0;
            return (
              <div key={i} role="button" tabIndex={0} onClick={() => { if (clickable) setSelCrew(c.crew); }}
                style={{ display: "block", width: "100%", boxSizing: "border-box", breakInside: "avoid", marginBottom: 16,
                  border: "1px solid var(--line)", borderRadius: "var(--radius-card)", padding: "14px 16px",
                  background: "var(--panel)", cursor: clickable ? "pointer" : "not-allowed", textAlign: "left",
                  opacity: clickable ? 1 : 0.62, boxShadow: clickable ? "var(--shadow-card)" : "none", transition: "border-color var(--dur-fast)" }}
                onMouseEnter={e => clickable && (e.currentTarget.style.borderColor = "var(--brand)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--line)")}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 800, display: "grid", placeItems: "center", flex: "none" }}>{c.crew.slice(0, 1)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 800 }}>{c.crew}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{c.trade} · {c.workers}人{S && S.payType === "piece" ? " · " + S.month : ""}</div>
                  </div>
                  <span style={{ marginLeft: "auto", flex: "none" }}>
                    {!S ? <StatusChip tone="neutral">未生成</StatusChip>
                      : S.payType === "time" ? <StatusChip tone="ok">100% 直付</StatusChip>
                      : S.hold > 0 ? <StatusChip tone="warn">空鼓暂扣</StatusChip>
                      : <StatusChip tone="brand">{S.ratio}%</StatusChip>}
                  </span>
                </div>
                {!S && (
                  <div style={{ fontSize: 12, color: "var(--ink-faint)", padding: "6px 0 2px" }}>暂无数据 · 本月工资表未生成</div>
                )}
                {S && S.payType === "time" && (<>
                  <FlowRow first label="工程量总额（工天）" value={S.total} strong />
                  <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6 }}>无比例、无扣罚，按实发全额支付</div>
                </>)}
                {S && S.payType === "piece" && (<>
                  <FlowRow first label="工程量总额（含房租）" value={S.total} />
                  <FlowRow label={"× 支付比例 " + S.ratio + "%"} value={S.payable} />
                  <FlowRow label="− 累计已付" value={S.paid} tone="ok" />
                  {S.hold > 0 && <FlowRow label={"− 空鼓暂扣（" + hollowCnt + "处）"} value={S.hold} tone="warn" />}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 7,
                    background: S.request > 0 ? "var(--danger-soft)" : "var(--ok-soft)", borderRadius: 8, padding: "7px 10px" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: S.request > 0 ? "var(--danger-ink)" : "var(--ok-ink)" }}>剩余待付清</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 800, color: S.request > 0 ? "var(--danger-ink)" : "var(--ok-ink)" }}>{num0(S.request)}</span>
                  </div>
                  {S.borrow > 0 && <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 5 }}>另有借支 ¥{num0(S.borrow)}，于工资表实发时扣回</div>}
                </>)}
                {/* 按人速览：泥水等按个人分发的班组，点名字直达该工人进度款核对表（grill 2026-07-19） */}
                {S && (
                  <div style={{ marginTop: 9, paddingTop: 8, borderTop: "1px dashed var(--line)", display: "flex", flexDirection: "column", gap: 3 }}>
                    {S.rows.map(({ w, c: wc }) => (
                      <div key={w.name} role="button" tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); navigate("payrollDetail", { worker: w.name, crew: c.crew, project: selProject, month: S.month }); }}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", borderRadius: 6, cursor: "pointer" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--brand-soft)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--brand)" }}>{w.name}</span>
                        {w.flags.includes("暂不支付") && <span style={{ fontSize: 10, color: "var(--danger-ink)", background: "var(--danger-soft)", borderRadius: 4, padding: "0 4px" }}>暂不支付</span>}
                        {w.flags.includes("单独计价") && <span style={{ fontSize: 10, color: "var(--ink-soft)", background: "var(--surface-3)", borderRadius: 4, padding: "0 4px" }}>单独</span>}
                        {!c.trade.includes("时工") && wc.hollowSum > 0 && <span style={{ fontSize: 10, color: "var(--warn-ink)", background: "var(--warn-soft)", borderRadius: 4, padding: "0 4px" }}>空鼓{wc.hollowSum}</span>}
                        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>{num0(S.payType === "time" ? wc.net : wc.rounded)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );

    // ── Level 2: 工资总表（单据口径，数据源 = PAYSLIP）──
    const crewKey = selProject + "|" + selCrew;
    const crewData = P && P.data[crewKey];
    if (!crewData) return <Breadcrumb items={[{ label: "工资核算", onClick: () => { setSelProject(null); setSelCrew(null); } }, { label: selProject, onClick: back }, { label: selCrew + "（无数据）" }]} />;
    const sched = crewData.schedule;
    const curIdx = Math.max(0, sched.findIndex(s => s.current));
    const idx = viewIdx == null ? curIdx : viewIdx;
    const selMonth = sched[idx].m;
    const isTime = crewData.payType === "time";
    const S = P.crewSummary(crewKey, selMonth);

    const TH = { padding: "12px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", position: "sticky", top: 0, whiteSpace: "nowrap" };
    const TD = { padding: "12px 14px", fontSize: 13 };
    const num = { ...TD, textAlign: "right", fontFamily: "var(--font-mono)" };
    const flagChips = (w, c) => {
      const chips = [];
      if (w.flags.includes("暂不支付")) chips.push(<StatusChip key="z" tone="danger">暂不支付</StatusChip>);
      if (w.flags.includes("单独计价")) chips.push(<StatusChip key="d" tone="neutral">单独计价</StatusChip>);
      if (!isTime && c.hollowSum > 0) chips.push(<StatusChip key="k" tone="warn">空鼓{c.hollowSum}处</StatusChip>);
      return chips.length ? <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{chips}</span> : <span style={{ color: "var(--ink-faint)" }}>—</span>;
    };
    const detailBtn = (w) => (
      <button onClick={() => navigate("payrollDetail", { worker: w.name, crew: selCrew, project: selProject, month: selMonth })}
        style={{ border: "1px solid var(--brand)", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", background: "var(--brand-soft)", color: "var(--brand-deep)", fontWeight: 600, whiteSpace: "nowrap" }}>
        A4 单
      </button>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Breadcrumb items={[{ label: "工资核算", onClick: () => { setSelProject(null); setSelCrew(null); setViewIdx(null); } }, { label: selProject, onClick: back }, { label: selCrew }]} />

        {/* 发放比例 · 点选月份查看当期单据（时工无比例，仅月份切换） */}
        <Panel padding={16}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)" }}>{isTime ? "月份 · 时工按月 100% 直付" : "发放比例 · 随完工进度递增"}</span>
            <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>点击月份查看当期工资单</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-soft)" }}>当前查看：<b style={{ color: "var(--brand-deep)", fontFamily: "var(--font-mono)" }}>{selMonth}{isTime ? "" : " · " + sched[idx].r + "%"}</b>{idx === curIdx ? "（最新）" : "（历史）"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {sched.map((s, i) => {
              const on = i === idx;
              const past = i < idx;
              return (
                <React.Fragment key={s.m}>
                  <button onClick={() => setViewIdx(i)} style={{ textAlign: "center", flex: "none", border: 0, background: "transparent", cursor: "pointer", padding: 0 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 999, display: "grid", placeItems: "center", margin: "0 auto", fontSize: 13, fontWeight: 800, fontFamily: "var(--font-mono)", border: "2px solid", borderColor: on ? "var(--brand)" : past ? "var(--ok)" : "var(--line-strong)", background: on ? "var(--brand)" : past ? "var(--ok-soft)" : "#fff", color: on ? "#fff" : past ? "var(--ok-ink)" : "var(--ink-soft)", transition: "all var(--dur-fast)" }}>{s.r}%</div>
                    <div style={{ fontSize: 11, marginTop: 4, color: on ? "var(--brand)" : "var(--ink-soft)", fontWeight: on ? 800 : 600 }}>{s.m}{s.current ? " ·本月" : ""}</div>
                  </button>
                  {i < sched.length - 1 && <div style={{ flex: 1, height: 2, background: i < idx ? "var(--ok)" : "var(--line)", marginBottom: 18 }}></div>}
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
              <Button size="sm" icon="download" onClick={() => (window.KitUI || { toast: () => {} }).toast("正在导出 Excel（进度清单/工资表/考勤表 各一 sheet × " + S.rows.length + " 人）…")}>导出 Excel</Button>
            </div>
          </div>

          {tab === "table" && !isTime && (
            <div style={{ overflow: "auto", maxHeight: 480 }}>
              <table style={{ width: "100%", minWidth: 1220, borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={{ ...TH, textAlign: "left" }}>工人</th>
                  {["工程量金额(含房租)", "比例", "应领金额", "累计已领", "空鼓暂扣", "本次请款", "取整(应发)", "借支", "实发"].map(h => <th key={h} style={{ ...TH, textAlign: "right" }}>{h}</th>)}
                  <th style={{ ...TH, textAlign: "left" }}>开户行 / 卡号</th>
                  <th style={{ ...TH, textAlign: "center" }}>安全教育</th>
                  <th style={{ ...TH, textAlign: "left" }}>特殊情况</th>
                  <th style={{ ...TH, textAlign: "center" }}>操作</th>
                </tr></thead>
                <tbody>
                  {S.rows.map(({ w, c }) => (
                    <tr key={w.name} style={{ borderBottom: "1px solid var(--line)", transition: "background var(--dur-fast)" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--surface-3)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <td style={{ ...TD, fontWeight: 700, color: "var(--brand)", whiteSpace: "nowrap" }}>{w.name}</td>
                      <td style={num}>{num0(c.total)}</td>
                      <td style={num}>{c.ratio}%</td>
                      <td style={num}>{num0(c.payable)}</td>
                      <td style={{ ...num, color: "var(--ink-soft)" }}>{num0(c.paidSum)}</td>
                      <td style={{ ...num, color: c.hold ? "var(--warn-ink)" : "var(--ink-faint)" }}>{c.hold ? "−" + num0(c.hold) : "—"}</td>
                      <td style={{ ...num, fontWeight: 700 }}>{num0(c.request)}</td>
                      <td style={num}>{w.flags.includes("暂不支付") ? "0.00" : num0(c.rounded)}</td>
                      <td style={{ ...num, color: c.borrow ? "var(--danger)" : "var(--ink-faint)" }}>{c.borrow ? "−" + num0(c.borrow) : "—"}</td>
                      <td style={{ ...num, fontWeight: 800, color: w.flags.includes("暂不支付") ? "var(--danger)" : "var(--brand)" }}>{num0(c.net)}</td>
                      <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{w.bank.branch}<br />{w.bank.account}</td>
                      <td style={{ ...TD, textAlign: "center" }}>{w.safety ? <Icon name="shield-check" size={16} color="var(--ok)" /> : <StatusChip tone="danger">未完成</StatusChip>}</td>
                      <td style={TD}>{flagChips(w, c)}</td>
                      <td style={{ ...TD, textAlign: "center" }}>{detailBtn(w)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: "var(--surface-2)", borderTop: "1px solid var(--line-strong)" }}>
                    <td style={{ ...TD, fontWeight: 800 }}>合计</td>
                    <td style={{ ...num, fontWeight: 800 }}>{num0(S.total)}</td>
                    <td></td>
                    <td style={{ ...num, fontWeight: 800 }}>{num0(S.payable)}</td>
                    <td style={{ ...num, fontWeight: 800 }}>{num0(S.paid)}</td>
                    <td style={{ ...num, fontWeight: 800, color: "var(--warn-ink)" }}>{S.hold ? "−" + num0(S.hold) : "—"}</td>
                    <td style={{ ...num, fontWeight: 800 }}>{num0(S.request)}</td>
                    <td style={{ ...num, fontWeight: 800 }}>{num0(S.rounded)}</td>
                    <td style={{ ...num, fontWeight: 800, color: "var(--danger)" }}>{S.borrow ? "−" + num0(S.borrow) : "—"}</td>
                    <td style={{ ...num, fontWeight: 800, color: "var(--brand)" }}>{num0(S.net)}</td>
                    <td colSpan={4}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {tab === "table" && isTime && (
            <div style={{ overflow: "auto", maxHeight: 480 }}>
              <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={{ ...TH, textAlign: "left" }}>工人</th>
                  {["日/月薪资", "出勤天数", "应发工资", "加班工资", "借支", "实发工资"].map(h => <th key={h} style={{ ...TH, textAlign: "right" }}>{h}</th>)}
                  <th style={{ ...TH, textAlign: "left" }}>开户行 / 卡号</th>
                  <th style={{ ...TH, textAlign: "center" }}>安全教育</th>
                  <th style={{ ...TH, textAlign: "left" }}>特殊情况</th>
                  <th style={{ ...TH, textAlign: "center" }}>操作</th>
                </tr></thead>
                <tbody>
                  {S.rows.map(({ w, c }) => (
                    <tr key={w.name} style={{ borderBottom: "1px solid var(--line)" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--surface-3)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <td style={{ ...TD, fontWeight: 700, color: "var(--brand)" }}>{w.name}</td>
                      <td style={num}>{num0(c.daily)}</td>
                      <td style={num}>{c.days}</td>
                      <td style={num}>{num0(c.gross)}</td>
                      <td style={num}>{c.overtime ? num0(c.overtime) : "—"}</td>
                      <td style={{ ...num, color: c.borrow ? "var(--danger)" : "var(--ink-faint)" }}>{c.borrow ? "−" + num0(c.borrow) : "—"}</td>
                      <td style={{ ...num, fontWeight: 800, color: "var(--brand)" }}>{num0(c.net)}</td>
                      <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{w.bank.branch}<br />{w.bank.account}</td>
                      <td style={{ ...TD, textAlign: "center" }}>{w.safety ? <Icon name="shield-check" size={16} color="var(--ok)" /> : <StatusChip tone="danger">未完成</StatusChip>}</td>
                      <td style={TD}>{flagChips(w, c)}</td>
                      <td style={{ ...TD, textAlign: "center" }}>{detailBtn(w)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: "var(--surface-2)", borderTop: "1px solid var(--line-strong)" }}>
                    <td style={{ ...TD, fontWeight: 800 }}>合计</td>
                    <td colSpan={2}></td>
                    <td style={{ ...num, fontWeight: 800 }}>{num0(S.rows.reduce((s, x) => s + x.c.gross, 0))}</td>
                    <td style={{ ...num, fontWeight: 800 }}>{num0(S.rows.reduce((s, x) => s + x.c.overtime, 0))}</td>
                    <td style={{ ...num, fontWeight: 800, color: "var(--danger)" }}>{num0(S.rows.reduce((s, x) => s + x.c.borrow, 0))}</td>
                    <td style={{ ...num, fontWeight: 800, color: "var(--brand)" }}>{num0(S.total)}</td>
                    <td colSpan={4}></td>
                  </tr>
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
            <b>合理性校验：</b>三级安全教育未录入 → 禁止发放 / 标红；「暂不支付」工人取整金额记 0，恢复支付后按台账补发；空鼓暂扣在整改核验后随下期返还或转扣。
          </div>
        </Panel>
      </div>
    );
  }

  window.PayrollScreen = PayrollScreen;
})();
