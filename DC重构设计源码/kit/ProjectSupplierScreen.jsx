// ProjectSupplierScreen — 项目×分供方 工作台（project-supplier.md）
// 定位：某项目下某分供方的合作关系枢纽。本页只做「聚合展示 + 跳转源模块 + 结算确认」；
//   合同/请款/收票/付款的新增编辑审批都跳转各自模块，结算是本页唯一写操作（二次确认后锁定只读）。
// 状态：collecting → contracted → claiming → paid → settled（settled 为人工终态、锁定）。
//
// #245 方案定夺（原票为 needs-info，ADR 未规定，按下述口径先行定稿）：
//   状态不是可被驳回「回退」的枚举字段，而是每次从真实单据事实派生：
//     有结算 → settled（唯一人工终态）；有确认付款 → paid；有在批请款 → claiming；
//     有生效合同 → contracted；否则 collecting。
//   因此一轮请款被驳回时只是删掉该轮请款事实，状态自动回落到剩余事实的派生值 ——
//   历史已有确认付款的合作关系回落到 paid 而不是 contracted，不会把既有履约阶段藏起来。
//   多轮请款并存时取最靠后的阶段（任一轮在批即 claiming，已有付款即 paid）。
//
// #246 方案定夺（同上，先行定稿）：
//   · 不要求所有请款已付才能结算 —— 在途请款是常态，阻断会让结算做不了；
//     但未付请款必须在结算页显式列出，并在二次确认里再陈述一次。
//   · 结算金额可小于已付（形成应退尾差），也可为 0（零结算）；两者都必须填原因。
//   · 负尾差是警示 + 必填原因，不阻断 —— 多付需退回是真实业务，阻断等于否认这个事实。
//   · 结算确认书：单份、application/pdf、≤10MB。
(function () {
  const { Button, IconButton, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), formModal: () => {} };
  const KA = () => window.KitAtoms || {};

  // —— 批B 蓝链反查 helper：存量行数据存的是名称/单号字符串而非 id，按名称反查共享 store 拿 id ——
  // 项目按 name 全等；分供方按 name 全等或 aliases 含；合同按 name 全等；发票按 number 全等（window.INV）。
  const findId = {
    project: (v) => { const A = window.APP; const hit = A && v ? A.rows("projects").find((x) => x.name === v) : null; return hit ? hit.id : null; },
    supplier: (v) => { const A = window.APP; const hit = A && v ? A.rows("suppliers").find((x) => x.name === v || (x.aliases || []).includes(v)) : null; return hit ? hit.id : null; },
    contract: (v) => { const A = window.APP; const hit = A && v ? A.rows("contracts").find((x) => x.name === v) : null; return hit ? hit.id : null; },
    invoice: (v) => { const I = window.INV; const hit = I && v ? I.live().find((x) => x.number === v) : null; return hit ? hit.id : null; },
  };
  // 查到 id → EntityLink 蓝链；查不到 → 返回 fallback（保持原文本，不做死链）
  const linkOr = (type, text, fallback) => {
    const EntityLink = KA().EntityLink;
    const id = findId[type] ? findId[type](text) : null;
    if (!EntityLink || !id) return fallback !== undefined ? fallback : (text == null ? "—" : text);
    return <EntityLink type={type} id={id} label={text} />;
  };

  const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const yuan = (v) => (v == null ? "—" : "¥" + fmt(v));
  const wan = (v) => (v == null ? "—" : "¥" + (v / 10000).toFixed(1) + "万");

  // 状态机定义（label / chip 色 / 默认 Tab）
  const STATUS = {
    collecting: { label: "资料收集中", tone: "neutral", tab: "contract" },
    contracted: { label: "已签合同", tone: "brand", tab: "claim" },
    claiming: { label: "请款中", tone: "warn", tab: "claim" },
    paid: { label: "已付款", tone: "ok", tab: "payment" },
    settled: { label: "已结算", tone: "ok", tab: "settle" },
  };
  const FLOW = ["collecting", "contracted", "claiming", "paid", "settled"];

  // #245：状态由真实单据事实派生，不做被动迁移，也就不存在「驳回后回退到哪一档」的选择题。
  // 驳回 = 该轮请款事实消失 → 重新派生；历史付款仍在，状态就仍是 paid。
  function deriveStatus(facts) {
    const f = facts || {};
    if (f.settlement) return { status: "settled", reason: "已确认结算并锁定" };
    if ((f.payments || []).length) return { status: "paid", reason: (f.payments || []).length + " 笔确认付款" };
    const pending = (f.claims || []).filter((c) => c.status !== "已驳回");
    if (pending.length) return { status: "claiming", reason: pending.length + " 轮请款在批" };
    if ((f.contracts || []).some((c) => c.status === "已生效")) return { status: "contracted", reason: "已有生效合同" };
    return { status: "collecting", reason: "尚无生效合同" };
  }

  // —— 每（项目×分供方）mock：一份合理的采购合作数据（供应商名进标签，金额按名 hash 微调）——
  function mockFor(supplierName) {
    const seed = (supplierName || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0);
    const k = 1 + (seed % 5) * 0.12; // 0.x 系数，让不同分供方数字有差异
    const r = (n) => Math.round(n * k);
    const contracts = [
      { no: "CG-2026-001", name: supplierName + " · 材料采购合同", amount: r(385000), changed: r(385000), attachN: 2, status: "已生效", signDate: "2026-03-12" },
    ];
    const claims = [
      { no: "QK-2026-06", status: "已审批", apply: r(120000), approve: r(120000), attachN: 1, date: "2026-06-05" },
      { no: "QK-2026-04", status: "已审批", apply: r(100000), approve: r(96000), attachN: 1, date: "2026-04-18" },
    ];
    const invoices = [
      { no: "58760021", date: "2026-06-10", amount: r(80000), tax: r(9204), type: "专票" },
      { no: "58712205", date: "2026-04-20", amount: r(60000), tax: r(6903), type: "专票" },
    ];
    const payments = [
      { date: "2026-06-08", amount: r(100000), method: "银行转账", voucher: "PZ-0608", claim: "QK-2026-04" },
    ];
    const files = [
      { name: "材料采购合同正本.pdf", size: "1.8 MB", time: "2026-03-12", src: "合同" },
      { name: "6月请款单.pdf", size: "420 KB", time: "2026-06-05", src: "请款" },
      { name: "增值税专票-58760021.jpg", size: "1.1 MB", time: "2026-06-10", src: "收票" },
      { name: "付款凭证-PZ-0608.pdf", size: "260 KB", time: "2026-06-08", src: "付款" },
    ];
    return { contracts, claims, invoices, payments, files };
  }

  const TH = { padding: "11px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)" };

  // 状态机步进器（横向 5 段：已过=绿 / 当前=蓝 / 未来=灰）
  function StatusStepper({ status }) {
    const cur = FLOW.indexOf(status);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" }}>
        {FLOW.map((s, i) => {
          const st = i < cur ? "done" : i === cur ? "current" : "future";
          const C = st === "current" ? { bg: "var(--brand)", ink: "#fff", bd: "var(--brand)" }
            : st === "done" ? { bg: "var(--ok-soft)", ink: "var(--ok-ink)", bd: "var(--ok)" }
              : { bg: "var(--surface-2)", ink: "var(--ink-faint)", bd: "var(--line)" };
          return (
            <React.Fragment key={s}>
              {i > 0 && <span style={{ width: 18, height: 2, background: i <= cur ? "var(--ok)" : "var(--line)", flex: "none" }} />}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: C.bg, border: "1px solid " + C.bd, color: C.ink, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                {st === "done" && <Icon name="check" size={11} color={C.ink} />}
                {STATUS[s].label}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // 聚合列表：当前页只负责查看，新增/编辑/审批回到源模块。
  function ListTab({ title, moduleName, columns, rows, sum, onJump }) {
    const toolbar = (
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{title} <span style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>({rows.length})</span></span>
        <div style={{ marginLeft: "auto" }}>
          <Button size="sm" variant="primary" icon="external-link" onClick={() => onJump("new")}>去{moduleName}新建</Button>
        </div>
      </div>
    );
    if (!window.KitTable) return <Panel padding={16} style={{ color: "var(--ink-soft)" }}>表格组件加载中…</Panel>;
    return <window.KitTable toolbar={toolbar} columns={columns.map((c) => ({ width: 120, ...c }))} rows={rows}
      pageSize={10} minRows={5} sum={sum} tableMinWidth={Math.max(640, columns.length * 130)}
      onRowClick={(r) => onJump("row", r)} footerLeft={"共 " + rows.length + " 条"} empty="暂无数据" />;
  }

  function ProjectSupplierScreen({ params, navigate }) {
    const p = params || {};
    const projectName = p.project || "合和新城";
    const supplierName = p.supplier || "大板东建材";
    const pid = p.pid || "p1";
    // 合作关系必须由真实外键定位；名称只用于显示，不反查、不猜测关联。
    const projectId = window.APP && window.APP.get("projects", p.pid) ? p.pid : null;
    const supplierId = window.APP && window.APP.get("suppliers", p.sid) ? p.sid : null;

    const M = React.useMemo(() => mockFor(supplierName), [supplierName]);
    const { contracts, claims, invoices, payments, files } = M;

    // 汇总（实时计算，不存储）
    const contractTotal = contracts.reduce((s, c) => s + c.changed, 0);
    const claimedTotal = claims.filter((c) => c.status === "已审批").reduce((s, c) => s + c.approve, 0);
    const paidTotal = payments.reduce((s, c) => s + c.amount, 0);
    const invoiceTotal = invoices.reduce((s, c) => s + c.amount, 0);
    const taxTotal = invoices.reduce((s, c) => s + c.tax, 0);
    const balance = contractTotal - paidTotal;

    const [settlement, setSettlement] = React.useState(null); // {finalAmount, date, pdf, note}
    // #245：状态不落库、不做被动迁移，每次从当前真实事实派生 —— 驳回只是事实消失，状态自然回落
    const derived = deriveStatus({ settlement, payments, claims, contracts });
    const status = derived.status;
    // 未付请款 = 已批请款 − 已确认付款；#246 不因它阻断结算，但必须显式列出
    const unpaidTotal = Math.max(0, claimedTotal - paidTotal);
    const [note, setNote] = React.useState("首次合作，材料按批到货、按进度请款。");
    const [tab, setTab] = React.useState("overview");
    // 结算表单本地态
    const [settleAmt, setSettleAmt] = React.useState(String(paidTotal));
    const [settlePdf, setSettlePdf] = React.useState(false);
    const [settleNote, setSettleNote] = React.useState("");

    const locked = status === "settled";
    const nav = navigate || (window.DC && window.DC.navigate);
    const jump = (module) => (kind, row) => {
      if (module === "收票登记") { UI().toast("收票台账尚未支持真实 ID 预筛，已停止名称猜测跳转", "warn"); return; }
      if (module === "采购合同") { UI().toast("采购合同尚未支持项目×分供方复合 ID 预筛，本次不做宽范围跳转", "warn"); return; }
      const route = kind === "row" ? "payRecord" : "payApply";
      if (!projectId || !supplierId) { UI().toast("缺少项目或分供方真实 ID，无法按合作关系跳转", "danger"); return; }
      if (!nav) return;
      nav(route, { project: projectId, supplier: supplierId, projectName, supplierName, sourceNo: row && row.no, from: "projectSupplier" });
    };

    // #246：负尾差与零结算都是真实业务，不阻断；但必须填原因，并在二次确认里陈述未付请款。
    const settleAmtNum = Number(String(settleAmt).replace(/[^\d.\-]/g, "")) || 0;
    const settleDiff = settleAmtNum - paidTotal;   // < 0 表示已付超出结算额，需退回
    const needsReason = settleDiff < 0 || settleAmtNum === 0;
    const reasonMissing = needsReason && !settleNote.trim();

    const confirmSettle = () => {
      if (settleAmtNum < 0) { UI().toast("结算金额不能为负数", "danger"); return; }
      if (!settlePdf) { UI().toast("请先上传结算确认书 PDF", "danger"); return; }
      if (reasonMissing) {
        UI().toast(settleAmtNum === 0 ? "零结算必须填写原因" : "结算金额低于已付，必须填写原因", "danger");
        return;
      }
      const lines = ["结算金额 " + yuan(settleAmtNum) + "。"];
      if (unpaidTotal > 0) lines.push("注意：仍有已批未付请款 " + yuan(unpaidTotal) + "，结算后这部分不会自动作废，需在付款模块另行处理。");
      if (settleDiff < 0) lines.push("已付超出结算额 " + yuan(-settleDiff) + "，将形成应退尾差。");
      if (settleAmtNum === 0) lines.push("本次为零结算。");
      lines.push("确认后本合作关系状态置为「已结算」并锁定为只读，不可再改。");
      UI().confirm({
        title: "确认结算并锁定？", danger: true, confirmText: "确认结算",
        message: lines.join(""),
        onConfirm: () => {
          setSettlement({ finalAmount: settleAmtNum, date: "2026-07-09", pdf: "结算确认书.pdf", note: settleNote });
          setTab("settle");
          UI().toast("已结算并锁定", "ok");
        },
      });
    };

    const TABS = [
      { key: "overview", label: "合作概览" },
      { key: "contract", label: "合同", count: contracts.length },
      { key: "claim", label: "请款", count: claims.length },
      { key: "invoice", label: "收票", count: invoices.length },
      { key: "payment", label: "付款", count: payments.length },
      { key: "settle", label: "结算" },
    ];

    const SegTab = KA().SegTab, SectionHeader = KA().SectionHeader, Metric = KA().Metric, MetricGrid = KA().MetricGrid, EntityLink = KA().EntityLink;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 顶部摘要 */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <button onClick={() => window.DC.closeActiveTab()} title="关闭页签（左邻页签自动激活）" style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--line)", background: "var(--surface-2)", borderRadius: "var(--radius-btn)", padding: "7px 12px", fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", cursor: "pointer", flex: "none" }}>
              <Icon name="arrow-left" size={15} />返回项目
            </button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 17, fontWeight: 800 }}>{EntityLink && projectId ? <EntityLink type="project" id={projectId} label={projectName} /> : projectName}</span>
                <span style={{ color: "var(--ink-faint)", fontSize: 15 }}>×</span>
                <span style={{ fontSize: 17, fontWeight: 800, color: "var(--brand)" }}>{EntityLink && supplierId ? <EntityLink type="supplier" id={supplierId} label={supplierName} /> : supplierName}</span>
                <StatusChip tone={STATUS[status].tone}>{STATUS[status].label}</StatusChip>
                {locked && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--ink-faint)" }}><Icon name="lock" size={12} />已锁定只读</span>}
              </div>
              <div style={{ marginTop: 10 }}><StatusStepper status={status} /></div>
              {/* #245：显式说明当前状态是从哪些事实派生的，避免被误当成可被驳回回退的枚举字段 */}
              <div style={{ marginTop: 7, fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.7 }}>
                当前状态由真实单据事实派生：<b style={{ color: "var(--ink-soft)" }}>{derived.reason}</b>。
                请款被驳回只删除该轮请款事实并重新派生 —— 已有确认付款时仍停在「已付款」，不会退回「已签合同」。
              </div>
            </div>
            <Button icon="pencil" onClick={() => UI().formModal({ title: "编辑合作备注", fields: [{ key: "note", label: "备注", type: "textarea", value: note, full: true }], onSave: (v) => { setNote(v.note || ""); UI().toast("已保存", "ok"); } })} disabled={locked}>备注</Button>
          </div>
          <MetricGrid cols={6}>
            <Metric label="合同额（变更后）" value={yuan(contractTotal)} formula="Σ 关联合同.变更后合同额" />
            <Metric label="已批请款" value={yuan(claimedTotal)} formula="Σ 已批准请款.金额" tone="brand" />
            <Metric label="收票额（含税）" value={yuan(invoiceTotal)} formula="Σ 收票.含税金额" />
            <Metric label="收票税额" value={yuan(taxTotal)} formula="Σ 收票.税额" />
            <Metric label="已付款" value={yuan(paidTotal)} formula="Σ 付款流水.金额" tone="ok" />
            <Metric label="应付余额" value={yuan(balance)} formula="合同额 − 已付款" tone={balance > 0 ? "danger" : "ok"} big />
          </MetricGrid>
        </Panel>

        {/* 分栏：主内容 + 右侧文件栏 */}
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel padding={0} style={{ overflow: "hidden" }}>
              <div style={{ padding: "4px 8px 0" }}>{SegTab && <SegTab tabs={TABS} active={tab} onChange={setTab} />}</div>
              <div style={{ padding: 16, background: "var(--bg)" }}>

                {tab === "overview" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <Panel padding={16}>
                      {SectionHeader && <SectionHeader>合作信息</SectionHeader>}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
                        {[["项目", projectName], ["分供方", supplierName], ["当前状态", STATUS[status].label], ["合作备注", note]].map(([k, v]) => (
                          <div key={k} style={{ background: "var(--panel)", padding: "10px 14px", minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{k}</div>
                            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{v || "—"}</div>
                          </div>
                        ))}
                      </div>
                    </Panel>
                    <Panel padding={16}>
                      {SectionHeader && <SectionHeader>最近动态</SectionHeader>}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[
                          { t: "2026-06-10", d: "收到增值税专票 " + yuan(invoices[0] ? invoices[0].amount : 0), icon: "receipt" },
                          { t: "2026-06-08", d: "付款 " + yuan(paidTotal) + "（银行转账）", icon: "banknote" },
                          { t: "2026-06-05", d: "提交 6 月请款 " + yuan(claims[0] ? claims[0].approve : 0), icon: "file-text" },
                          { t: "2026-03-12", d: "签订材料采购合同 " + yuan(contractTotal), icon: "file-signature" },
                        ].map((a, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
                            <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--brand-soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name={a.icon} size={14} color="var(--brand)" /></span>
                            <span style={{ fontSize: 13, flex: 1 }}>{a.d}</span>
                            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}>{a.t}</span>
                          </div>
                        ))}
                      </div>
                    </Panel>
                  </div>
                )}

                {tab === "contract" && (
                  <ListTab title="采购合同" moduleName="采购合同" onJump={jump("采购合同")} rows={contracts}
                    columns={[
                      { key: "no", label: "合同号", mono: true },
                      { key: "name", label: "合同名称", render: (v) => linkOr("contract", v, <span style={{ color: "var(--brand)", fontWeight: 600 }}>{v}</span>) },
                      { key: "amount", label: "合同金额", align: "right", money: true },
                      { key: "changed", label: "变更后金额", align: "right", money: true },
                      { key: "attachN", label: "附件", align: "center", render: (v) => <span style={{ fontFamily: "var(--font-mono)" }}>{v} 份</span> },
                      { key: "status", label: "状态", render: (v) => <StatusChip tone="ok">{v}</StatusChip> },
                    ]} sum={{ label: "变更后合同额合计", value: contractTotal }} />
                )}

                {tab === "claim" && (
                  <ListTab title="请款申请" moduleName="付款申请" onJump={jump("付款申请")} rows={claims}
                    columns={[
                      { key: "no", label: "请款单号", mono: true, render: (v) => <span style={{ color: "var(--brand)", fontWeight: 600 }}>{v}</span> },
                      { key: "status", label: "审批状态", render: (v) => <StatusChip tone={v === "已审批" ? "ok" : "warn"}>{v}</StatusChip> },
                      { key: "apply", label: "申请金额", align: "right", money: true },
                      { key: "approve", label: "审批金额", align: "right", money: true },
                      { key: "attachN", label: "附件", align: "center", render: (v) => <span style={{ fontFamily: "var(--font-mono)" }}>{v} 份</span> },
                      { key: "date", label: "申请日期", mono: true, color: "var(--ink-soft)" },
                    ]} sum={{ label: "已批请款合计", value: claimedTotal }} />
                )}

                {tab === "invoice" && (
                  <ListTab title="收票登记" moduleName="收票登记" onJump={jump("收票登记")} rows={invoices}
                    columns={[
                      { key: "no", label: "发票号码", mono: true, color: "var(--ink-soft)", render: (v) => linkOr("invoice", v, v) },
                      { key: "date", label: "开票日期", mono: true, color: "var(--ink-soft)" },
                      { key: "amount", label: "含税金额", align: "right", money: true },
                      { key: "tax", label: "税额", align: "right", money: true },
                      { key: "type", label: "发票类型", render: (v) => <StatusChip tone="brand">{v}</StatusChip> },
                    ]} sum={{ label: "含税金额合计", value: invoiceTotal }} />
                )}

                {tab === "payment" && (
                  <ListTab title="付款流水" moduleName="付款申请" onJump={jump("付款申请")} rows={payments}
                    columns={[
                      { key: "date", label: "付款日期", mono: true, color: "var(--ink-soft)" },
                      { key: "amount", label: "付款金额", align: "right", money: true, color: "var(--danger-ink)" },
                      { key: "method", label: "支付方式" },
                      { key: "voucher", label: "凭证号", mono: true },
                      { key: "claim", label: "关联请款单", mono: true, render: (v) => <span style={{ color: "var(--brand)" }}>{v}</span> },
                    ]} sum={{ label: "已付款合计", value: paidTotal }} />
                )}

                {tab === "settle" && (
                  <Panel padding={16}>
                    {SectionHeader && <SectionHeader extra={locked ? <StatusChip tone="ok">已结算 · 锁定</StatusChip> : null}>最终结算</SectionHeader>}
                    {locked && settlement ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
                        {[
                          ["结算金额", yuan(settlement.finalAmount)],
                          ["结算日期", settlement.date],
                          ["尾款差额（结算−已付）", yuan(settlement.finalAmount - paidTotal)],
                          ["结算确认书", settlement.pdf],
                          ["结算备注", settlement.note || "—"],
                        ].map(([k, v]) => (
                          <div key={k} style={{ background: "var(--panel)", padding: "11px 14px", minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{k}</div>
                            <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 3, fontFamily: /金额|差额/.test(k) ? "var(--font-mono)" : "inherit" }}>{v}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520 }}>
                        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", background: "var(--warn-soft)", border: "1px solid var(--warn)", borderRadius: 8, padding: "9px 12px" }}>
                          结算是本页唯一写操作。填写结算金额、上传结算确认书后确认，状态置为「已结算」并锁定只读。当前已付 {yuan(paidTotal)}。
                        </div>

                        {/* #246：未付请款不阻断结算，但必须显式列出 */}
                        {unpaidTotal > 0 && (
                          <div style={{ fontSize: 12.5, border: "1px solid var(--line-strong)", background: "var(--surface-2)", borderRadius: 8, padding: "9px 12px", lineHeight: 1.75 }}>
                            <b style={{ color: "var(--ink)" }}>仍有已批未付请款 {yuan(unpaidTotal)}</b>
                            <span style={{ color: "var(--ink-soft)" }}>（已批 {yuan(claimedTotal)} − 已付 {yuan(paidTotal)}）。</span>
                            <br /><span style={{ color: "var(--ink-soft)" }}>不阻断结算 —— 在途请款是常态；但结算后这部分不会自动作废，需到付款模块另行处理。</span>
                          </div>
                        )}

                        <label style={{ fontSize: 13, fontWeight: 600 }}>结算金额（可与合同额不同，允许为 0）
                          <input value={settleAmt} onChange={(e) => setSettleAmt(e.target.value)} style={{ display: "block", marginTop: 6, width: "100%", boxSizing: "border-box", border: "1px solid var(--line-strong)", borderRadius: 8, padding: "9px 11px", fontSize: 14, fontFamily: "var(--font-mono)", outline: "none" }} />
                        </label>
                        {/* #246：尾差实时呈现。负尾差＝已付超出结算额，警示但不阻断 */}
                        <div style={{ fontSize: 12.5, borderRadius: 8, padding: "9px 12px", lineHeight: 1.75,
                          border: "1px solid " + (settleDiff < 0 ? "var(--warn)" : "var(--line-strong)"),
                          background: settleDiff < 0 ? "var(--warn-soft)" : "var(--surface-2)" }}>
                          尾差（结算 − 已付）：
                          <b style={{ fontFamily: "var(--font-mono)", color: settleDiff < 0 ? "var(--warn-ink)" : "var(--ink)" }}>{yuan(settleDiff)}</b>
                          {settleDiff < 0 && <span style={{ color: "var(--warn-ink)" }}> · 已付超出结算额，将形成应退尾差，需填写原因后方可结算（不阻断）</span>}
                          {settleDiff > 0 && <span style={{ color: "var(--ink-soft)" }}> · 尚有应付尾款，结算后转由付款模块处理</span>}
                          {settleAmtNum === 0 && <span style={{ color: "var(--warn-ink)" }}> · 零结算必须填写原因</span>}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <Button size="sm" icon={settlePdf ? "check" : "upload"} variant={settlePdf ? "secondary" : "primary"} onClick={() => { setSettlePdf(true); UI().toast("已上传结算确认书（演示）", "ok"); }}>{settlePdf ? "结算确认书.pdf 已上传" : "上传结算确认书 PDF"}</Button>
                          <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>单份 · application/pdf · ≤10MB</span>
                        </div>
                        <label style={{ fontSize: 13, fontWeight: 600 }}>
                          结算备注{needsReason && <b style={{ color: "var(--danger)" }}> · 必填原因</b>}
                          <textarea value={settleNote} onChange={(e) => setSettleNote(e.target.value)} rows={2} style={{ display: "block", marginTop: 6, width: "100%", boxSizing: "border-box", border: "1px solid var(--line-strong)", borderRadius: 8, padding: "9px 11px", fontSize: 13, outline: "none", resize: "vertical" }} />
                        </label>
                        <div><Button variant="primary" icon="badge-check" onClick={confirmSettle}>确认结算</Button></div>
                      </div>
                    )}
                  </Panel>
                )}

              </div>
            </Panel>
          </div>

          {/* 右侧文件栏：按来源分组 */}
          <div style={{ width: 280, flex: "none", position: "sticky", top: "calc(var(--header-h) + 16px)" }}>
            <Panel padding={0} style={{ overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="folder-open" size={15} color="var(--brand)" />
                <span style={{ fontSize: 14, fontWeight: 700 }}>关联文件 <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--ink-soft)" }}>({files.length})</span></span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {files.map((f, i) => (
                  <div key={i} onClick={() => UI().toast("预览「" + f.name + "」（演示）")} style={{ display: "flex", gap: 10, padding: "10px 14px", borderBottom: i < files.length - 1 ? "1px solid var(--line)" : "none", cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--brand-soft)", display: "grid", placeItems: "center", flex: "none" }}>
                      <Icon name={/\.(jpg|jpeg|png)$/i.test(f.name) ? "image" : "file-text"} size={15} color="var(--brand)" />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.name}>{f.name}</div>
                      <div style={{ marginTop: 2, fontSize: 10.5, color: "var(--ink-faint)", display: "flex", gap: 6 }}>
                        <span style={{ fontFamily: "var(--font-mono)" }}>{f.size}</span>
                        <span style={{ fontFamily: "var(--font-mono)" }}>{f.time.replace(/-/g, ".")}</span>
                      </div>
                      <span style={{ display: "inline-block", marginTop: 4, fontSize: 10, color: "var(--brand-deep)", background: "var(--brand-soft)", borderRadius: 4, padding: "1px 6px" }}>{f.src}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--ink-faint)" }}>审批时间线 / 评论 / 动态 —— V2</div>
            </Panel>
          </div>
        </div>
      </div>
    );
  }

  window.ProjectSupplierScreen = ProjectSupplierScreen;
})();
