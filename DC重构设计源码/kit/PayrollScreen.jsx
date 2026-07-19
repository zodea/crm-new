// PayrollScreen — 工资核算三层钻取：项目 → 班组(瀑布卡) → 请款簿总表（负责人制，#117 进度款域重构）
// · 第二层班组卡 = 资金瀑布（工程量总额 → ×比例 → −累计已领(实际) → 本期应发合计）；
//   D2：去掉按人速览，卡片底部显示「在班 X 人 · 离职 Y 人」（数据来自名册登记表进/退场日期）；
// · 第三层 = 请款簿总表（D7 单据主体=负责人）：一行一本请款簿（负责人+组员），三态状态列（D6），
//   班组层面批量核对/批量发放；月份轴含 结算95%/尾款100% 档并显示各月实际用过的比例（⑦）；
// · 打开请款簿 → PayrollDetailScreen（核对两步流 + A4 格式族）。
(function () {
  const { Button, Panel, StatusChip, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
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
  // WAGE/PAYSLIP 就绪轮询（x-import 预加载时序保护）
  const useReady = () => {
    const [ready, setReady] = React.useState(!!(window.WAGE && window.PAYSLIP));
    React.useEffect(() => {
      if (ready) return;
      const t = setInterval(() => { if (window.WAGE && window.PAYSLIP) { clearInterval(t); setReady(true); } }, 60);
      return () => clearInterval(t);
    }, []);
    return ready;
  };

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

  // 三态状态 chip（D6）
  const StatusTri = ({ doc }) => {
    if (!doc) return <StatusChip tone="neutral">—</StatusChip>;
    if (doc.status === "已发放") return <StatusChip tone="ok">已发放 · 已固化</StatusChip>;
    if (doc.status === "已核对") return doc.dirty
      ? <StatusChip tone="warn">有变动 · 需重核</StatusChip>
      : <StatusChip tone="brand">已核对</StatusChip>;
    if (doc.status === "未到") return <StatusChip tone="neutral">未到</StatusChip>;
    return <StatusChip tone="neutral">草稿</StatusChip>;
  };
  const FamilyChip = ({ book }) => {
    const map = { A: ["A · 户型派生", "brand"], B: ["B · BOQ直报", "neutral"], C1: ["C1 · 月薪时工", "neutral"], C2: ["C2 · 零星签工", "neutral"], MGR: ["管理费单 · 自动", "warn"] };
    const [label, tone] = map[book.family] || [book.family, "neutral"];
    return <StatusChip tone={tone}>{label}</StatusChip>;
  };

  function PayrollScreen({ data, navigate, params }) {
    const narrow = useNarrow();
    const ready = useReady();
    const A = window.APP;
    if (A && A.use) A.use();   // 订阅共享仓：请款簿状态/工程量变动 → 全层联动
    const [selProject, setSelProject] = React.useState((params && params.project) || null);
    const [selCrew, setSelCrew] = React.useState((params && params.crew) || null);
    const [selMonth, setSelMonth] = React.useState((params && params.month) || null);
    const P = window.PAYSLIP;

    if (!ready) return <Panel padding={40} style={{ textAlign: "center", color: "var(--ink-soft)" }}>数据链加载中…</Panel>;

    const back = () => { if (selCrew) { setSelCrew(null); setSelMonth(null); } else setSelProject(null); };

    // ── Level 0: 项目卡片 ──
    if (!selProject) return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel padding={14} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="info" size={15} color="var(--brand)" />
          <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>选择项目 → 班组资金瀑布 → 请款簿总表（负责人制）→ 核对两步流与 A4 单据（格式族 A/B/C1/C2）</span>
        </Panel>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${narrow ? 2 : 4}, 1fr)`, gap: 16 }}>
          {data.projects.map(p => {
            const crews = data.projectCrews[p.name] || [];
            const sums = crews.map(c => P.crewSummary(p.name, c.crew)).filter(Boolean);
            const request = sums.reduce((s, x) => s + (x.timeLike ? x.total : x.rounded), 0);
            const bookCnt = P.booksOf(p.name).length;
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
                  <div><div style={{ fontSize: 11, color: "var(--ink-faint)" }}>请款簿</div><div style={{ fontSize: 16, fontWeight: 800, marginTop: 2, fontFamily: "var(--font-mono)" }}>{bookCnt || "—"}</div></div>
                  <div><div style={{ fontSize: 11, color: "var(--ink-faint)" }}>本期应发</div><div style={{ fontSize: 16, fontWeight: 800, marginTop: 2, fontFamily: "var(--font-mono)", color: sums.length ? "var(--brand)" : "var(--ink-faint)" }}>{sums.length ? yuan(request) : "—"}</div></div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );

    // ── Level 1: 班组瀑布卡（D2 人数状态版）──
    const crews = data.projectCrews[selProject] || [];
    if (!selCrew) return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Breadcrumb items={[{ label: "工资核算", onClick: back }, { label: selProject }]} />
        {/* 瀑布流布局：CSS columns，卡片高度随内容错落（grill 定稿：不做方方正正统一格子） */}
        <div style={{ columnCount: narrow ? 2 : 3, columnGap: 16 }}>
          {crews.map((c, i) => {
            const S = P.crewSummary(selProject, c.crew);
            const clickable = !!S;
            const ro = S ? S.roster : P.rosterOf(c.crew);
            const dirtyCnt = S && !S.timeLike ? S.rows.filter(x => x.doc.dirty).length : 0;
            const exitHollow = !S || S.timeLike ? 0 : S.rows.filter(x => {
              const r = P.rosterRow(x.book.leader);
              return r && r.exit && x.doc.hollow && x.doc.hollow.unfixed > 0 && !x.doc.deduct;
            }).length;
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
                    <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{c.trade}{S ? " · " + S.rows.length + " 本请款簿" : ""}</div>
                  </div>
                  <span style={{ marginLeft: "auto", flex: "none" }}>
                    {!S ? <StatusChip tone="neutral">未生成</StatusChip>
                      : S.timeLike ? <StatusChip tone="ok">100% 直付</StatusChip>
                      : dirtyCnt > 0 ? <StatusChip tone="warn">需重核 {dirtyCnt}</StatusChip>
                      : <StatusChip tone="brand">{(S.statusCount["草稿"] || 0) + " 草稿 · " + (S.statusCount["已发放"] || 0) + " 已发放"}</StatusChip>}
                  </span>
                </div>
                {!S && (
                  <div style={{ fontSize: 12, color: "var(--ink-faint)", padding: "6px 0 2px" }}>暂无请款簿 · 建档后由工程量聚合自动生成单据行</div>
                )}
                {S && S.timeLike && (<>
                  <FlowRow first label="本月直付合计（时工）" value={S.total} strong />
                  <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6 }}>无比例、无取整，按实发全额支付</div>
                </>)}
                {S && !S.timeLike && (<>
                  <FlowRow first label="工程量总额（含补贴）" value={S.total} />
                  <FlowRow label="× 支付比例（各簿单据级）" value={S.payable} />
                  <FlowRow label="− 累计已领（实际发放值）" value={S.paid} tone="ok" />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 7,
                    background: S.rounded > 0 ? "var(--danger-soft)" : "var(--ok-soft)", borderRadius: 8, padding: "7px 10px" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: S.rounded > 0 ? "var(--danger-ink)" : "var(--ok-ink)" }}>本期应发（取整合计）</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 800, color: S.rounded > 0 ? "var(--danger-ink)" : "var(--ok-ink)" }}>{num0(S.rounded)}</span>
                  </div>
                </>)}
                {/* D2：人数状态（替代按人速览；人名明细在点进去的请款簿总表里看） */}
                <div style={{ marginTop: 9, paddingTop: 8, borderTop: "1px dashed var(--line)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Icon name="users" size={13} color="var(--ink-soft)" />
                  <span style={{ fontSize: 12, color: "var(--ink)", fontWeight: 700 }}>在班 {ro.active} 人</span>
                  <span style={{ fontSize: 12, color: ro.exited ? "var(--warn-ink)" : "var(--ink-faint)", fontWeight: ro.exited ? 700 : 500 }}>离职 {ro.exited} 人</span>
                  {exitHollow > 0 && <span style={{ fontSize: 10.5, color: "var(--danger-ink)", background: "var(--danger-soft)", borderRadius: 4, padding: "1px 6px" }}>离职未整改空鼓 · 待启动扣款</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );

    // ── Level 2: 请款簿总表（D7 负责人制 + D6 三态 + ⑦ 月份轴）──
    const crewBooks = P.booksOf(selProject, selCrew);
    if (!crewBooks.length) return <Breadcrumb items={[{ label: "工资核算", onClick: () => { setSelProject(null); setSelCrew(null); } }, { label: selProject, onClick: back }, { label: selCrew + "（无请款簿）" }]} />;
    const axisBook = crewBooks.reduce((a, b) => (b.monthSeq.length > a.monthSeq.length ? b : a), crewBooks[0]);
    const axis = axisBook.monthSeq;
    const defMonth = P.curMonth(axisBook);
    const month = selMonth && axis.indexOf(selMonth) >= 0 ? selMonth : defMonth;
    const timeLike = crewBooks.every(b => b.family === "C1" || b.family === "C2");
    const rows = crewBooks.map(b => ({ book: b, doc: b.months[month] ? P.calc(b.id, month) : null }));
    const ro = P.rosterOf(selCrew);

    const TH = { padding: "12px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", position: "sticky", top: 0, whiteSpace: "nowrap" };
    const TD = { padding: "12px 14px", fontSize: 13 };
    const num = { ...TD, textAlign: "right", fontFamily: "var(--font-mono)" };
    const sum = (f) => rows.reduce((s, x) => s + (x.doc ? (f(x.doc) || 0) : 0), 0);

    const openBook = (b) => navigate("payrollDetail", { book: b.id, project: selProject, crew: selCrew, month });
    // 批量核对 / 批量发放（D6：班组层面批量操作）
    const draftRows = rows.filter(x => x.doc && x.doc.status === "草稿");
    const checkedRows = rows.filter(x => x.doc && x.doc.status === "已核对" && !x.doc.deferred);
    const batchCheck = () => UI().confirm({
      title: "批量核对 " + month + " 请款单？",
      message: "将把 " + draftRows.length + " 本草稿请款簿标记为「已核对」并记录核对指纹；此后上游工程量/单价再变动会提示「有变动、需重核」。",
      confirmText: "全部核对",
      onConfirm: () => { draftRows.forEach(x => P.check(x.book.id, month)); UI().toast("已核对 " + draftRows.length + " 本请款簿", "success"); },
    });
    const batchRelease = () => UI().confirm({
      title: "批量登记发放？",
      message: "将按「取整应发」默认金额登记 " + checkedRows.length + " 本已核对请款簿的实际发放并整体固化（只读快照）；同时在付款管理域逐簿生成支出记录（类别=工人工资）。",
      confirmText: "登记发放",
      onConfirm: () => {
        checkedRows.forEach(x => P.release(x.book.id, month));
        UI().toast("已发放并固化 " + checkedRows.length + " 本 · 已在付款管理生成 " + checkedRows.length + " 条支出记录", "success");
      },
    });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Breadcrumb items={[{ label: "工资核算", onClick: () => { setSelProject(null); setSelCrew(null); setSelMonth(null); } }, { label: selProject, onClick: back }, { label: selCrew }]} />

        {/* ⑦ 月份轴：单据级比例（默认沿用上月），无预排计划；含 结算95%（可改）/ 尾款100% 档；显示各月实际用过的比例 */}
        <Panel padding={16}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)" }}>{timeLike ? "月份 · 时工按月 100% 直付" : "月份轴 · 比例为单据级参数（管理员按现场实际拍，默认沿用上月）"}</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-soft)" }}>当前查看：<b style={{ color: "var(--brand-deep)", fontFamily: "var(--font-mono)" }}>{P.monthLabel(month, axisBook.months[month])}</b>{month === defMonth ? "（本期）" : ""}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {axis.map((mk, i) => {
              const mo = axisBook.months[mk];
              const on = mk === month;
              const done = mo.status === "已发放";
              const future = mo.status === "未到";
              const ratios = [...new Set(crewBooks.filter(b => b.months[mk]).map(b => b.months[mk].ratio).filter(v => v != null))];
              const rLabel = timeLike ? "100" : (ratios.length === 1 ? ratios[0] : ratios.join("/"));
              return (
                <React.Fragment key={mk}>
                  <button onClick={() => setSelMonth(mk)} style={{ textAlign: "center", flex: "none", border: 0, background: "transparent", cursor: "pointer", padding: 0 }}>
                    <div style={{ minWidth: 48, height: 48, borderRadius: 999, display: "grid", placeItems: "center", margin: "0 auto", padding: "0 6px", fontSize: 12, fontWeight: 800, fontFamily: "var(--font-mono)", border: "2px solid",
                      borderColor: on ? "var(--brand)" : done ? "var(--ok)" : "var(--line-strong)",
                      background: on ? "var(--brand)" : done ? "var(--ok-soft)" : "#fff",
                      color: on ? "#fff" : done ? "var(--ok-ink)" : future ? "var(--ink-faint)" : "var(--ink-soft)" }}>{rLabel}%</div>
                    <div style={{ fontSize: 11, marginTop: 4, color: on ? "var(--brand)" : future ? "var(--ink-faint)" : "var(--ink-soft)", fontWeight: on ? 800 : 600 }}>
                      {mo.kind === "settle" ? "结算" : mo.kind === "final" ? "尾款" : mk}{mk === defMonth ? " ·本期" : ""}
                    </div>
                  </button>
                  {i < axis.length - 1 && <div style={{ flex: 1, height: 2, background: done ? "var(--ok)" : "var(--line)", marginBottom: 18 }}></div>}
                </React.Fragment>
              );
            })}
          </div>
        </Panel>

        {/* 请款簿总表 */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--line)", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 800 }}>请款簿总表 · {P.monthLabel(month, axisBook.months[month])}</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>一个负责人一本请款簿 · 数字由工程量管理聚合生成（单一数据链）</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {!timeLike && <Button size="sm" icon="circle-check" disabled={!draftRows.length} onClick={batchCheck}>批量核对（{draftRows.length}）</Button>}
              <Button size="sm" variant="primary" icon="banknote" disabled={!checkedRows.length} onClick={batchRelease}>批量发放（{checkedRows.length}）</Button>
              <Button size="sm" icon="sliders-horizontal" onClick={() => navigate("wageSlip", { crew: selCrew, project: selProject, month })}>进度款工具</Button>
              <Button size="sm" icon="download" onClick={() => UI().toast("正在导出 Excel（请款簿 × " + rows.length + " 本，含清单/工资表/考勤表）…")}>导出 Excel</Button>
            </span>
          </div>

          <div style={{ overflow: "auto", maxHeight: 520 }}>
            <table style={{ width: "100%", minWidth: timeLike ? 900 : 1280, borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={{ ...TH, textAlign: "left" }}>请款簿（负责人 + 组员）</th>
                <th style={{ ...TH, textAlign: "left" }}>格式族</th>
                <th style={{ ...TH, textAlign: "left" }}>状态</th>
                {timeLike
                  ? ["人数", "本月合计", "实际发放"].map(h => <th key={h} style={{ ...TH, textAlign: "right" }}>{h}</th>)
                  : ["合计(含补贴)", "比例", "应领", "累计已领(实际)", "本次请款", "取整应发", "实际发放"].map(h => <th key={h} style={{ ...TH, textAlign: "right" }}>{h}</th>)}
                <th style={{ ...TH, textAlign: "center" }}>操作</th>
              </tr></thead>
              <tbody>
                {rows.map(({ book: b, doc }) => (
                  <tr key={b.id} style={{ borderBottom: "1px solid var(--line)", transition: "background var(--dur-fast)", cursor: doc ? "pointer" : "default" }}
                    onClick={() => doc && openBook(b)}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface-3)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ ...TD, whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 800, color: "var(--brand)" }}>{b.leader}</span>
                        {doc && doc.seqNo && <span style={{ fontSize: 10.5, color: "var(--ink-soft)", background: "var(--surface-3)", borderRadius: 4, padding: "1px 6px", fontFamily: "var(--font-mono)" }}>第 {doc.seqNo} 号</span>}
                        {b.soloNote && <StatusChip tone="neutral">单独出单</StatusChip>}
                        {(() => { const r = P.rosterRow(b.leader); return r && r.exit ? <StatusChip tone="warn">已离职 {r.exit.slice(5)}</StatusChip> : null; })()}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 3 }}>
                        {b.scopeLabel} · 组员：{b.members.filter(m => m !== b.leader).join("、") || "—"}
                      </div>
                    </td>
                    <td style={TD}><FamilyChip book={b} /></td>
                    <td style={{ ...TD, whiteSpace: "nowrap" }}>
                      <StatusTri doc={doc} />
                      {doc && doc.deferred && <div style={{ marginTop: 3 }}><StatusChip tone="danger">暂不支付 · 滚存</StatusChip></div>}
                    </td>
                    {timeLike ? (<>
                      <td style={num}>{b.members.length}</td>
                      <td style={{ ...num, fontWeight: 700 }}>{doc ? num0(doc.total) : "—"}</td>
                      <td style={{ ...num, fontWeight: 800, color: "var(--brand)" }}>{doc && doc.actualPaid != null ? num0(doc.actualPaid) : "—"}</td>
                    </>) : (<>
                      <td style={num}>{doc ? num0(doc.total) : "—"}</td>
                      <td style={num}>{doc ? doc.ratio + "%" : "—"}</td>
                      <td style={num}>{doc ? num0(doc.payable) : "—"}</td>
                      <td style={{ ...num, color: "var(--ink-soft)" }}>{doc ? num0(doc.paidSum) : "—"}</td>
                      <td style={num}>{doc ? num0(doc.request) : "—"}</td>
                      <td style={{ ...num, fontWeight: 700 }}>{doc ? num0(doc.rounded) : "—"}</td>
                      <td style={{ ...num, fontWeight: 800, color: doc && doc.actualPaid != null ? "var(--brand)" : "var(--ink-faint)" }}>{doc && doc.actualPaid != null ? num0(doc.actualPaid) : "—"}</td>
                    </>)}
                    <td style={{ ...TD, textAlign: "center", whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => doc && openBook(b)} disabled={!doc}
                        style={{ border: "1px solid var(--brand)", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: doc ? "pointer" : "not-allowed", background: "var(--brand-soft)", color: "var(--brand-deep)", fontWeight: 600, opacity: doc ? 1 : 0.5 }}>
                        打开请款簿
                      </button>
                    </td>
                  </tr>
                ))}
                {!timeLike && (
                  <tr style={{ background: "var(--surface-2)", borderTop: "1px solid var(--line-strong)" }}>
                    <td style={{ ...TD, fontWeight: 800 }}>合计（{rows.filter(x => x.doc).length} 本）</td>
                    <td colSpan={2}></td>
                    <td style={{ ...num, fontWeight: 800 }}>{num0(sum(d => d.total))}</td>
                    <td></td>
                    <td style={{ ...num, fontWeight: 800 }}>{num0(sum(d => d.payable))}</td>
                    <td style={{ ...num, fontWeight: 800 }}>{num0(sum(d => d.paidSum))}</td>
                    <td style={{ ...num, fontWeight: 800 }}>{num0(sum(d => d.request))}</td>
                    <td style={{ ...num, fontWeight: 800 }}>{num0(sum(d => d.rounded))}</td>
                    <td style={{ ...num, fontWeight: 800, color: "var(--brand)" }}>{num0(sum(d => d.actualPaid))}</td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* 人数状态 + 校验提示（D6/⑥ 口径） */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Panel padding={14} style={{ flex: "1 1 260px", display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="users" size={16} color="var(--brand)" />
            <span style={{ fontSize: 12.5 }}>名册：<b>在班 {ro.active} 人</b> · <b style={{ color: ro.exited ? "var(--warn-ink)" : "inherit" }}>离职 {ro.exited} 人</b></span>
            <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>名册登记表在请款簿 A4 组内（D8-10）</span>
          </Panel>
          <Panel padding={14} style={{ flex: "3 1 420px", display: "flex", alignItems: "flex-start", gap: 10, background: "var(--warn-soft)", borderColor: "var(--warn)" }}>
            <Icon name="triangle-alert" size={16} color="var(--warn-ink)" />
            <div style={{ fontSize: 12, color: "var(--warn-ink)", lineHeight: 1.7 }}>
              <b>口径提示：</b>三级安全教育未录入 → 禁止发放；「暂不支付」= 不执行发放动作，应发滚存到后月；
              空鼓进度月只列示不扣款，离职或人工点「开始扣款」后按仍未整改处数 × 单处金额生成扣款行；已发放月份为固化快照，改量改价不追溯。
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  // _ds_bundle.js 内打包有旧版同名全局，且 helmet/x-import 脚本执行顺序不保证——
  // 注册后短时间内周期性重断言，确保 kit 新版最终胜出（bundle 后执行也会被覆盖回来）。
  const __reg = () => { window.PayrollScreen = PayrollScreen; };
  __reg();
  const __regT = setInterval(__reg, 120);
  setTimeout(() => clearInterval(__regT), 3000);
})();
