// PayrollLedgerShared — 工资独立更正与实际收付（#412 P4）共享基座，隐藏 x-import 预加载注册 window.PAYROLL_LEDGER。
// 供六个界面复用：更正详情 / 更正整页（新建·编辑）/ 实际收付台账 / 收付详情 / 实际补退整页 / 错记冲销整页。
// 口径对齐 app/components/payroll/PayrollAdjustment*、PayrollActual*、PayrollRecordingReversalFormPage.vue
// 与 docs/rewrite/pages/subcontract-payroll.md §六、docs/guides/payroll-adjustments.md：
//   · 原工资签名金额、原成员永不改写；核算更正、实际补退、错记冲销各自是独立记录；
//   · 更正只确认“有符号差额”，钱是否真的收付由实际补退或后续工资实际发放另行处理；
//   · 错记冲销只用于“原登记的收付实际没有发生”，不是工人退款；冲销记错须引用原冲销追加纠错；
//   · 工资收付不生成付款申请或银行流水；缺个人分配显示未知，不平摊、不补 0。
// 演示数据为匿名虚构（ADR 0014 §9），只活在本文件的内存 store，刷新页面即复原。
(function () {
  if (window.PAYROLL_LEDGER) { window.PayrollLedgerSharedPreload = window.PayrollLedgerSharedPreload || function () { return null; }; return; }
  const DS = () => window.DesignSystem_e3d871 || {};
  const KA = () => window.KitAtoms || {};
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };

  // ===== 金额（对齐 payrollAmount：null → 未记录；保留符号与两位小数）=====
  const round2 = (n) => Math.round(n * 100) / 100;
  const amount = (v) => v == null || !Number.isFinite(Number(v)) ? "未记录"
    : (Number(v) < 0 ? "-¥" : "¥") + Math.abs(Number(v)).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (s) => { const t = String(s == null ? "" : s).trim(); if (t === "") return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ===== 演示原工资（已发放；book 对应 kit/data.js PAYSLIP 簿，供“查看原工资”跳 payrollDetail）=====
  const ORIGINALS = [
    { statementId: "st-a-0801", book: "B1", projectId: "p-hehe", projectName: "合和新城", crew: "泥水A班", month: "2026-08", formatFamily: "A",
      leaderWorkerId: "w-yu", members: [{ workerId: "w-yu", workerName: "虞建华" }, { workerId: "w-wang", workerName: "王芳（虞嫂）" }],
      basis: { formatFamily: "A", periodKind: "monthly", payRatio: 0.8, components: [
        { key: "c1", location: "3 号楼 / 8 层 / 0802 / 卫生间", item: "墙砖", unit: "m²", worker: "虞建华", quantity: 42.5, unitPrice: 45, price: { mode: "baseline", revision: 2, unitPrice: 45, unit: "m²", effectiveMonth: "2026-06" } },
        { key: "c2", location: "3 号楼 / 8 层 / 0803 / 厨房", item: "墙砖", unit: "m²", worker: "虞建华", quantity: 38, unitPrice: 45, price: { mode: "baseline", revision: 2, unitPrice: 45, unit: "m²", effectiveMonth: "2026-06" } },
        { key: "c3", location: "3 号楼 / 8 层 / 0802 / 客厅", item: "地砖", unit: "m²", worker: "王芳（虞嫂）", quantity: 96, unitPrice: 40, price: { mode: "personal", revision: 1, unitPrice: 40, unit: "m²", effectiveMonth: "2026-07" } },
        { key: "c4", location: "3 号楼 / 8 层 / 0803 / 客厅", item: "地砖", unit: "m²", worker: "王芳（虞嫂）", quantity: 92, unitPrice: 40, price: { mode: "personal", revision: 1, unitPrice: 40, unit: "m²", effectiveMonth: "2026-07" } },
      ] } },
    { statementId: "st-c1-0801", book: "B7", projectId: "p-hehe", projectName: "合和新城", crew: "杂工班", month: "2026-08", formatFamily: "C1",
      leaderWorkerId: "w-yang", members: [{ workerId: "w-yang", workerName: "杨红彬" }, { workerId: "w-cai", workerName: "蔡燕琼" }],
      basis: { formatFamily: "C1",
        rates: [{ workerId: "w-yang", dailyWage: 300, overtimeRule: "eighth", overtimeRate: null }, { workerId: "w-cai", dailyWage: 280, overtimeRule: "explicit", overtimeRate: 40 }],
        records: [
          { recordId: "r1", workerId: "w-yang", workDate: "2026-08-11", hours: 8, overtimeHours: 2, workContent: "3 号楼 8 层清运建渣" },
          { recordId: "r2", workerId: "w-cai", workDate: "2026-08-11", hours: 8, overtimeHours: 0, workContent: "3 号楼 8 层清运建渣" },
          { recordId: "r3", workerId: "w-yang", workDate: "2026-08-12", hours: 8, overtimeHours: 0, workContent: "材料倒运" },
          { recordId: "r4", workerId: "w-cai", workDate: "2026-08-12", hours: 8, overtimeHours: 0, workContent: "材料倒运" },
          { recordId: "r5", workerId: "w-yang", workDate: "2026-08-13", hours: 4, overtimeHours: 0, workContent: "公区清扫" },
        ] } },
    { statementId: "st-c2-0901", book: "B9", projectId: "p-weilai", projectName: "未来印象小区", crew: "泥水时工组", month: "2026-09", formatFamily: "C2",
      leaderWorkerId: "w-zhou", members: [{ workerId: "w-zhou", workerName: "周维" }, { workerId: "w-huang", workerName: "黄伟荣" }],
      basis: { formatFamily: "C2", unitRate: 350, records: [
        { recordId: "d1", workerId: "w-zhou", workDate: "2026-09-03", laborUnits: 1, startTime: "08:00", endTime: "17:30", workContent: "2 号楼 5 层卫生间找平", witness: "刘工", confirmedOn: "2026-09-04" },
        { recordId: "d2", workerId: "w-huang", workDate: "2026-09-03", laborUnits: 1, startTime: "08:00", endTime: "17:30", workContent: "2 号楼 5 层卫生间找平", witness: "刘工", confirmedOn: "2026-09-04" },
        { recordId: "d3", workerId: "w-zhou", workDate: "2026-09-04", laborUnits: 0.5, startTime: "08:00", endTime: "12:00", workContent: "2 号楼 5 层墙面修补", witness: "刘工", confirmedOn: "2026-09-05" },
        { recordId: "d4", workerId: "w-huang", workDate: "2026-09-04", laborUnits: 1, startTime: "08:00", endTime: "17:30", workContent: "2 号楼 5 层墙面修补", witness: "刘工", confirmedOn: "2026-09-05" },
      ] } },
  ];
  const PROJECTS = [{ id: "p-hehe", name: "合和新城", code: "HH-2026-01" }, { id: "p-weilai", name: "未来印象小区", code: "WL-2025-03" }, { id: "p-jinxiu", name: "锦绣园·2 期", code: "JX-2026-02" }];

  // ===== 核算（与实现端 central-adjustment-calculation 同一口径：任一依据缺失 → 未知，不补 0）=====
  function calc(basis) {
    if (!basis) return null;
    if (basis.formatFamily === "A") {
      if (basis.payRatio == null || basis.payRatio < 0 || basis.payRatio > 1) return null;
      let s = 0;
      for (const c of basis.components) { if (c.quantity == null || c.unitPrice == null) return null; s += round2(c.quantity * c.unitPrice); }
      return round2(s * basis.payRatio);
    }
    if (basis.formatFamily === "C1") {
      let s = 0;
      for (const r of basis.records) {
        const rate = basis.rates.find((x) => x.workerId === r.workerId);
        if (!rate || rate.dailyWage == null || r.hours == null || r.overtimeHours == null) return null;
        const ot = rate.overtimeRule === "explicit" ? rate.overtimeRate : rate.dailyWage / 8;
        if (ot == null) return null;
        s += round2(r.hours / 8 * rate.dailyWage + r.overtimeHours * ot);
      }
      return round2(s);
    }
    if (basis.unitRate == null) return null;
    let units = 0;
    for (const r of basis.records) { if (r.laborUnits == null) return null; units += r.laborUnits; }
    return round2(units * basis.unitRate);
  }
  ORIGINALS.forEach((o) => { o.originalGrossAmount = calc(o.basis); o.originalSignatureAmount = o.originalGrossAmount; });
  const original = (id) => ORIGINALS.find((o) => o.statementId === id) || null;
  const memberName = (o, wid) => ((o && o.members.find((m) => m.workerId === wid)) || {}).workerName || "姓名未记录";

  // ===== 演示更正（confirmed 带 snapshot；draft 仅草稿，无处理效力）=====
  const withAfter = (stId, mutate) => { const b = clone(original(stId).basis); mutate(b); return b; };
  const ADJUSTMENTS = [
    { id: "adj-0001", statementId: "st-a-0801", status: "confirmed", correctsAdjustmentId: null,
      reason: "0802 卫生间墙砖复尺面积由 42.5 m² 更正为 40.0 m²",
      evidenceNote: "2026-09-05 项目部与班组联合复尺，复尺单 FC-0905-02 双方签字；现场照片 6 张已归档。",
      after: withAfter("st-a-0801", (b) => { b.components[0].quantity = 40; }), confirmedBy: "林晓", confirmedAt: "2026-09-06 10:24" },
    { id: "adj-0002", statementId: "st-c1-0801", status: "draft", correctsAdjustmentId: null,
      reason: "8 月 12 日蔡燕琼加班 2 小时漏记", evidenceNote: "",
      after: withAfter("st-c1-0801", (b) => { b.records[3].overtimeHours = 2; }), confirmedBy: null, confirmedAt: null },
    { id: "adj-0003", statementId: "st-c2-0901", status: "confirmed", correctsAdjustmentId: null,
      reason: "9 月 3 日黄伟荣实际为半工（下午请假）",
      evidenceNote: "证明人刘工 2026-10-08 书面说明；原签工表下午签退栏空白。",
      after: withAfter("st-c2-0901", (b) => { b.records[1].laborUnits = 0.5; b.records[1].endTime = "12:00"; }), confirmedBy: "林晓", confirmedAt: "2026-10-09 15:10" },
  ];
  ADJUSTMENTS.forEach((a) => { a.before = clone(original(a.statementId).basis); });
  const adjustment = (id) => ADJUSTMENTS.find((a) => a.id === id) || null;
  const deltaOf = (a) => { const b = calc(a.before), f = calc(a.after); return b == null || f == null ? null : round2(f - b); };

  // ===== 演示实际收付事实（kind: initial-release 原工资发放 / supplement 实际补发 / refund 实际退款 / recording-reversal 错记冲销）=====
  // ref：released-statement（原工资发放，详情回原工资）或 actual-event（独立事实，详情 = payrollPaymentDetail）
  // applications：本事实对原更正的有符号处理额；later=true 表示“后续工资实际发放时关联处理”，不另算现金。
  const FACTS = [
    { identity: "rel-a-0701", kind: "initial-release", ref: { kind: "released-statement", statementId: "st-a-0701", book: "B1" }, projectId: "p-hehe", originalStatementIds: ["st-a-0701"],
      occurredOn: "2026-08-05", signedAmount: 7650, allocations: [], allocationState: "unknown", qualification: "historical-amount-proven", applications: [],
      label: "2026-07 虞建华 普通施工簿（迁移历史）" },
    { identity: "rel-a-0801", kind: "initial-release", ref: { kind: "released-statement", statementId: "st-a-0801", book: "B1" }, projectId: "p-hehe", originalStatementIds: ["st-a-0801"],
      occurredOn: "2026-09-02", signedAmount: 8914, allocations: [{ workerId: "w-yu", workerName: "虞建华", amount: 5914 }, { workerId: "w-wang", workerName: "王芳（虞嫂）", amount: 3000 }], allocationState: "complete", qualification: "proven", applications: [] },
    { identity: "rel-c1-0801", kind: "initial-release", ref: { kind: "released-statement", statementId: "st-c1-0801", book: "B7" }, projectId: "p-hehe", originalStatementIds: ["st-c1-0801"],
      occurredOn: "2026-09-03", signedAmount: 1385, allocations: [{ workerId: "w-yang", workerName: "杨红彬", amount: 825 }, { workerId: "w-cai", workerName: "蔡燕琼", amount: 560 }], allocationState: "complete", qualification: "proven", applications: [] },
    { identity: "pay-0001", kind: "refund", ref: { kind: "actual-event", eventId: "pay-0001" }, projectId: "p-hehe", originalStatementIds: ["st-a-0801"],
      occurredOn: "2026-09-12", signedAmount: -40, allocations: [{ workerId: "w-yu", workerName: "虞建华", amount: -40 }], allocationState: "complete", qualification: "proven",
      applications: [{ adjustmentId: "adj-0001", amount: -40 }], evidenceNote: "虞建华现金退回 40 元，项目部出纳林晓收讫，收条 SJ-0912-01。", confirmedBy: "林晓", confirmedAt: "2026-09-12 16:05" },
    { identity: "pay-0002", kind: "refund", ref: { kind: "actual-event", eventId: "pay-0002" }, projectId: "p-hehe", originalStatementIds: ["st-a-0801"],
      occurredOn: "2026-09-14", signedAmount: -30, allocations: [{ workerId: "w-wang", workerName: "王芳（虞嫂）", amount: -30 }], allocationState: "complete", qualification: "proven",
      applications: [{ adjustmentId: "adj-0001", amount: -30 }], evidenceNote: "王芳口头答应退回 30 元，经办人先行登记。", confirmedBy: "林晓", confirmedAt: "2026-09-14 09:40" },
    { identity: "pay-0003", kind: "recording-reversal", ref: { kind: "actual-event", eventId: "pay-0003" }, projectId: "p-hehe", originalStatementIds: ["st-a-0801"], originalFactId: "pay-0002",
      occurredOn: "2026-09-16", signedAmount: 30, allocations: [{ workerId: "w-wang", workerName: "王芳（虞嫂）", amount: 30 }], allocationState: "complete", qualification: "proven",
      applications: [{ adjustmentId: "adj-0001", amount: 30 }], evidenceNote: "核实王芳当日未交回现金，收条未签字；原登记的退款未发生。", confirmedBy: "林晓", confirmedAt: "2026-09-16 11:20" },
    { identity: "rel-a-0901", kind: "initial-release", ref: { kind: "released-statement", statementId: "st-a-0901", book: "B1" }, projectId: "p-hehe", originalStatementIds: ["st-a-0901"],
      occurredOn: "2026-10-03", signedAmount: 8460, allocations: [{ workerId: "w-yu", workerName: "虞建华", amount: 5460 }, { workerId: "w-wang", workerName: "王芳（虞嫂）", amount: 3000 }], allocationState: "complete", qualification: "proven",
      applications: [{ adjustmentId: "adj-0001", amount: -20, later: true }], label: "2026-09 虞建华 普通施工簿（核算 8,480，关联处理 -20）" },
    { identity: "rel-c2-0901", kind: "initial-release", ref: { kind: "released-statement", statementId: "st-c2-0901", book: "B9" }, projectId: "p-weilai", originalStatementIds: ["st-c2-0901"],
      occurredOn: "2026-10-02", signedAmount: 1225, allocations: [{ workerId: "w-zhou", workerName: "周维", amount: 525 }, { workerId: "w-huang", workerName: "黄伟荣", amount: 700 }], allocationState: "complete", qualification: "proven", applications: [] },
  ];
  const fact = (id) => FACTS.find((f) => f.identity === id) || null;
  const factByRef = (p) => p.eventId ? fact(p.eventId) : p.statementId ? FACTS.find((f) => f.ref.kind === "released-statement" && f.ref.statementId === p.statementId) || null : null;
  const reversedBy = (f) => FACTS.find((x) => x.kind === "recording-reversal" && x.originalFactId === f.identity) || null;

  // ===== 余额：确认差额 / 已处理 / 待处理（含续更正链；草稿不计）=====
  function chainOf(id) {
    let root = adjustment(id); while (root && root.correctsAdjustmentId) root = adjustment(root.correctsAdjustmentId);
    if (!root) return [];
    const out = [root]; let grown = true;
    while (grown) { grown = false; ADJUSTMENTS.forEach((a) => { if (a.correctsAdjustmentId && out.some((x) => x.id === a.correctsAdjustmentId) && !out.includes(a)) { out.push(a); grown = true; } }); }
    return out;
  }
  function balanceOf(id) {
    const chain = chainOf(id).filter((a) => a.status === "confirmed");
    const ids = chain.map((a) => a.id);
    const confirmedDelta = chain.reduce((s, a) => s + (deltaOf(a) || 0), 0);
    const appliedDelta = FACTS.reduce((s, f) => s + f.applications.filter((x) => ids.includes(x.adjustmentId)).reduce((t, x) => t + x.amount, 0), 0);
    return { confirmedDelta: round2(confirmedDelta), appliedDelta: round2(appliedDelta), remainingDelta: round2(confirmedDelta - appliedDelta) };
  }
  function applicationsOf(id) {
    const ids = chainOf(id).map((a) => a.id);
    return FACTS.flatMap((f) => f.applications.filter((x) => ids.includes(x.adjustmentId)).map((x, i) => ({
      id: f.identity + ":" + i, kind: f.kind === "recording-reversal" ? "recording-reversal" : x.later ? "later-release" : "actual", appliedDelta: x.amount, fact: f,
    })));
  }

  // ===== 订阅（演示写入后各页签实时刷新）=====
  const listeners = new Set();
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = () => listeners.forEach((fn) => fn());
  let seq = 4, adjSeq = 4;
  function saveAdjustment(draft) {
    let row = draft.id && adjustment(draft.id);
    if (!row) { row = { id: "adj-" + String(adjSeq++).padStart(4, "0"), statementId: draft.statementId, status: "draft", before: clone(draft.before || original(draft.statementId).basis) }; ADJUSTMENTS.push(row); }
    Object.assign(row, { reason: draft.reason, evidenceNote: draft.evidenceNote, after: clone(draft.after), correctsAdjustmentId: draft.correctsAdjustmentId || null });
    emit(); return row;
  }
  function confirmAdjustment(id) { const row = adjustment(id); Object.assign(row, { status: "confirmed", confirmedBy: "林晓（演示）", confirmedAt: "2026-10-06 14:30" }); emit(); return row; }
  function addFact(row) { const id = "pay-" + String(seq++).padStart(4, "0"); const f = { ...row, identity: id, ref: { kind: "actual-event", eventId: id }, qualification: "proven", allocationState: "complete", confirmedBy: "林晓（演示）", confirmedAt: "2026-10-06 14:30" }; FACTS.push(f); emit(); return f; }

  const KIND_LABEL = { "initial-release": "原工资发放", supplement: "实际补发", refund: "实际退款", "recording-reversal": "错记冲销" };
  const QUAL_LABEL = { proven: "依据完整", "scoped-amount-proven": "按原工资范围计入", "historical-amount-proven": "仅历史整单金额可证明", unproven: "待核实" };

  // ===== 领域界面件（仅本组工资 P4 页面使用，均由 DesignSystem / KitAtoms / KitTable 现有原语组合，不作通用件）=====
  // 字段清单沿用 app.dc.html 既有 .dc-fields 栅格类（同 PayApplyDetailScreen）
  const dl = (items) => <dl className="dc-fields" style={{ margin: 0, fontSize: 12.5 }}>
    {items.filter(Boolean).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>;
  const sh = (text, mb) => { const SH = KA().SectionHeader; return SH ? <SH mb={mb}>{text}</SH> : <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{text}</h2>; };
  const mono = (v, strong) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: strong ? 800 : 600 }}>{v}</span>;
  const note = (text, tone) => <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: tone === "warn" ? "var(--warn-ink)" : tone === "danger" ? "var(--danger-ink)" : "var(--ink-soft)" }} role={tone === "warn" || tone === "danger" ? "alert" : undefined}>{text}</p>;
  // 页内跳转统一用 DesignSystem Button ghost 档，不另造链接按钮
  const go = (label, onClick, icon) => { const { Button } = DS(); return Button ? <Button variant="ghost" size="sm" icon={icon} onClick={onClick}>{label}</Button> : null; };
  const openOriginal = (navigate, o) => navigate("payrollDetail", { book: o.book, project: o.projectName, crew: o.crew, month: o.month });
  const openFact = (navigate, f) => f.ref.kind === "released-statement" ? navigate("payrollDetail", { book: f.ref.book }) : navigate("payrollPaymentDetail", { id: f.ref.eventId });

  // 原签名工资事实（对应 PayrollOriginalWageSummary.vue）
  function OriginalWageSummary({ original: o, navigate, id }) {
    const { Panel } = DS();
    return <Panel id={id} style={{ display: "grid", gap: 10 }}>
      {sh("原签名工资事实", 0)}
      {dl([["项目 / 月份 / 格式", o.projectName + " · " + o.month + " · " + o.formatFamily], ["原负责人", memberName(o, o.leaderWorkerId)], ["原核算金额", mono(amount(o.originalGrossAmount))], ["原签名实发金额", mono(amount(o.originalSignatureAmount), true)]])}
      {note("原签名金额与原成员保留。核算更正、实际补退和错记冲销分别形成独立记录。")}
      <div>{go("查看原工资与冻结输出", () => openOriginal(navigate, o), "file-text")}</div>
    </Panel>;
  }

  // 更正依据（对应 PayrollAdjustmentBasisFields.vue；disabled=只读回看）。行固定为原依据行：只改值，不增删行、不换原责任。
  function BasisFields({ basis, original: o, disabled, onChange, id, title }) {
    const { Panel, Field } = DS();
    const KT = window.KitTable;
    const set = (fn) => { if (disabled || !onChange) return; const b = clone(basis); fn(b); onChange(b); };
    // 单元格输入：DesignSystem Field（表格内不显示可见标签，aria-label 承担可达名称）
    const inp = (value, aria, apply, type, width, extra) => <Field label={null} value={value == null ? "" : value} mono={type === "number"} style={{ width: width || 110 }}
      onChange={(e) => set((b) => apply(b, type === "number" ? num(e.target.value) : e.target.value))}
      inputProps={{ "aria-label": aria, type: type || "text", disabled, ...(extra || {}) }} />;
    const table = (label, minWidth, columns, rows) => KT ? <KT label={label} columns={columns} rows={rows} pageSize={50} tableMinWidth={minWidth} footerLeft={"共 " + rows.length + " 条原依据（固定行）"} /> : null;
    const wrap = (node) => <span style={{ display: "grid", gap: 2, whiteSpace: "normal" }}>{node}</span>;
    const body = !basis ? note("原核算依据不完整，不能补造更正来源。", "warn")
      : basis.formatFamily === "A" ? <>
        <Field label="本次更正采用比例（0 至 1）" mono value={basis.payRatio == null ? "" : basis.payRatio} style={{ maxWidth: 360 }}
          onChange={(e) => set((b) => { b.payRatio = num(e.target.value); })} inputProps={{ type: "number", min: 0, max: 1, step: "any", disabled: disabled || basis.periodKind === "retention" }} />
        {table("A 原责任量价更正表", 720, [
          { key: "location", label: "原责任范围", width: 260, render: (_v, c) => wrap(<><span>{c.location}</span><b>{c.item} · {c.unit}</b><span style={{ color: "var(--ink-soft)" }}>原施工：{c.worker}</span></>) },
          { key: "quantity", label: "更正现场量", width: 130, render: (v, c) => inp(v, "第" + (c._i + 1) + "项更正现场量", (b, x) => { b.components[c._i].quantity = x; }, "number", 110, { min: 0, step: "any" }) },
          { key: "unitPrice", label: "更正单价", width: 130, render: (v, c) => inp(v, "第" + (c._i + 1) + "项更正单价", (b, x) => { b.components[c._i].unitPrice = x; }, "number", 110, { step: "0.01" }) },
          { key: "price", label: "原价格依据", width: 180, render: (p) => wrap(<><span>{p.mode === "baseline" ? "基准单价" : "个人例外单价"} · 修订 {p.revision}</span>{mono(amount(p.unitPrice) + " / " + p.unit)}<span style={{ color: "var(--ink-soft)" }}>{p.effectiveMonth} 起生效</span></>) },
        ], basis.components.map((c, i) => ({ ...c, id: c.key, _i: i })))}
      </> : basis.formatFamily === "C1" ? <>
        {table("原成员更正标准", 620, [
          { key: "workerId", label: "原成员", width: 140, render: (v) => memberName(o, v) },
          { key: "dailyWage", label: "日薪", width: 130, render: (v, r) => inp(v, memberName(o, r.workerId) + "更正日薪", (b, x) => { b.rates[r._i].dailyWage = x; }, "number", 110, { min: 0, step: "any" }) },
          { key: "overtimeRule", label: "加班规则", width: 130, render: (v) => v === "explicit" ? "独立标准" : "日薪的八分之一" },
          { key: "overtimeRate", label: "独立加班标准", width: 140, render: (v, r) => r.overtimeRule === "explicit" ? inp(v, memberName(o, r.workerId) + "更正加班标准", (b, x) => { b.rates[r._i].overtimeRate = x; }, "number", 110, { min: 0, step: "any" }) : "按原规则计算" },
        ], basis.rates.map((r, i) => ({ ...r, id: r.workerId, _i: i })))}
        {table("原逐日考勤更正", 680, [
          { key: "workDate", label: "原成员 / 日期", width: 170, render: (v, r) => memberName(o, r.workerId) + " · " + v },
          { key: "hours", label: "正常工时", width: 110, render: (v, r) => inp(v, "第" + (r._i + 1) + "条正常工时", (b, x) => { b.records[r._i].hours = x; }, "number", 90, { min: 0, max: 8, step: "any" }) },
          { key: "overtimeHours", label: "加班工时", width: 110, render: (v, r) => inp(v, "第" + (r._i + 1) + "条加班工时", (b, x) => { b.records[r._i].overtimeHours = x; }, "number", 90, { min: 0, max: 24, step: "any" }) },
          { key: "workContent", label: "工作内容", width: 220, render: (v, r) => inp(v, "第" + (r._i + 1) + "条工作内容", (b, x) => { b.records[r._i].workContent = x; }, "text", 200) },
        ], basis.records.map((r, i) => ({ ...r, id: r.recordId, _i: i })))}
      </> : <>
        <Field label="更正主体单价（元 / 工）" mono value={basis.unitRate == null ? "" : basis.unitRate} style={{ maxWidth: 360 }}
          onChange={(e) => set((b) => { b.unitRate = num(e.target.value); })} inputProps={{ type: "number", min: 0, step: "any", disabled }} />
        {table("原逐条签工更正", 1120, [
          { key: "workDate", label: "原成员 / 日期", width: 160, render: (v, r) => memberName(o, r.workerId) + " · " + v },
          { key: "laborUnits", label: "工数", width: 110, render: (v, r) => <select className="dc-state-select" aria-label={"第" + (r._i + 1) + "条更正工数"} value={v == null ? "" : String(v)} disabled={disabled} onChange={(e) => set((b) => { b.records[r._i].laborUnits = num(e.target.value); })}><option value="">未填写</option><option value="0.5">半工</option><option value="1">整工</option></select> },
          { key: "startTime", label: "开始", width: 120, render: (v, r) => inp(v, "第" + (r._i + 1) + "条开始时间", (b, x) => { b.records[r._i].startTime = x; }, "time", 104) },
          { key: "endTime", label: "结束", width: 120, render: (v, r) => inp(v, "第" + (r._i + 1) + "条结束时间", (b, x) => { b.records[r._i].endTime = x; }, "time", 104) },
          { key: "workContent", label: "工作内容", width: 210, render: (v, r) => inp(v, "第" + (r._i + 1) + "条更正工作内容", (b, x) => { b.records[r._i].workContent = x; }, "text", 190) },
          { key: "witness", label: "证明人", width: 120, render: (v, r) => inp(v, "第" + (r._i + 1) + "条更正证明人", (b, x) => { b.records[r._i].witness = x; }, "text", 100) },
          { key: "confirmedOn", label: "确认日期", width: 160, render: (v, r) => inp(v, "第" + (r._i + 1) + "条更正确认日期", (b, x) => { b.records[r._i].confirmedOn = x; }, "date", 140) },
        ], basis.records.map((r, i) => ({ ...r, id: r.recordId, _i: i })))}
      </>;
    return <Panel id={id} aria-label={disabled ? "只读更正依据" : "独立更正依据"} style={{ display: "grid", gap: 12, minWidth: 0 }}>
      {sh(title || "独立更正依据", 0)}
      {body}
    </Panel>;
  }

  // 实际收付明细表（对应 PayrollActualFactsTable.vue；writable=可从依据完整的事实发起错记冲销）
  function FactsTable({ rows, navigate, writable, minRows }) {
    const KT = window.KitTable;
    const { StatusChip } = DS();
    const columns = [
      { key: "kind", label: "实际来源", width: 200, render: (v, f) => <span style={{ display: "grid", gap: 2, whiteSpace: "normal", justifyItems: "start" }}>{go(KIND_LABEL[v], () => openFact(navigate, f))}{f.label && <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{f.label}</span>}{v === "recording-reversal" && <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>不是工人实际退款</span>}</span> },
      { key: "occurredOn", label: "发生日期", width: 110, mono: true },
      { key: "signedAmount", label: "有符号实额", width: 130, align: "right", render: (v) => mono(amount(v), true) },
      { key: "allocations", label: "个人分配", width: 220, render: (v, f) => <span style={{ display: "grid", gap: 2, whiteSpace: "normal" }}>{v.map((a) => <span key={a.workerId}>{a.workerName || "姓名未记录"}：{mono(amount(a.amount))}</span>)}{f.allocationState !== "complete" && <span style={{ color: "var(--warn-ink)" }}>原个人分配未完整记录</span>}</span> },
      { key: "qualification", label: "记录资格", width: 170, render: (v) => StatusChip ? <StatusChip tone={v === "proven" ? "ok" : v === "unproven" ? "danger" : "warn"}>{QUAL_LABEL[v]}</StatusChip> : QUAL_LABEL[v] },
      { key: "_op", label: "操作", width: 160, render: (_v, f) => writable && f.qualification === "proven"
        ? go(f.kind === "recording-reversal" ? "纠正这次错记冲销" : "核实错记冲销", () => navigate("payrollReversalForm", f.ref.kind === "released-statement" ? { statementId: f.ref.statementId } : { eventId: f.ref.eventId }))
        : <span style={{ color: "var(--ink-faint)" }}>只读</span> },
    ];
    return KT ? <KT label="工资实际收付明细表" columns={columns} rows={rows.map((f) => ({ ...f, id: f.identity }))} tableMinWidth={1000} empty="当前范围没有工资实际收付记录。" /> : null;
  }

  // 逐次处理历史（对应 PayrollAdjustmentApplications.vue）
  function ApplicationsTable({ rows, navigate }) {
    const KT = window.KitTable;
    const kindText = (k) => k === "later-release" ? "后续工资处理" : k === "recording-reversal" ? "错记冲销" : "实际补退";
    const factText = (f) => f.kind === "initial-release" ? "后续工资原发放" : KIND_LABEL[f.kind];
    const limit = (k) => k === "later-release" ? "处理关联不另算一次现金收付" : k === "recording-reversal" ? "冲销登记效果，不是实际退款" : "仅按真实收付来源计一次";
    return KT ? <KT label="更正处理历史表" rows={rows} tableMinWidth={720} empty="尚未记录实际补退或后续工资处理。" columns={[
      { key: "kind", label: "处理方式", width: 130, render: (v) => kindText(v) },
      { key: "appliedDelta", label: "处理差额", width: 120, align: "right", render: (v) => mono(amount(v), true) },
      { key: "fact", label: "真实事实 / 日期", width: 190, render: (f) => <span style={{ display: "grid", gap: 2, justifyItems: "start" }}>{go("查看" + factText(f), () => openFact(navigate, f))}<span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{f.occurredOn || "日期未记录"}</span></span> },
      { key: "_limit", label: "依据与限制", width: 240, render: (_v, r) => <span style={{ whiteSpace: "normal", color: "var(--ink-soft)" }}>{limit(r.kind)}</span> },
    ]} /> : null;
  }

  // 独立确认记录输出（对应 PayrollConfirmationOutput.vue；设计稿用 toast 示意打印/下载）
  function ConfirmationOutput({ ready, title }) {
    const { Panel, Button } = DS();
    return <Panel style={{ display: "grid", gap: 10 }}>
      {sh("独立确认记录", 0)}
      {ready ? <>
        {note("原单签名金额、本次事实及后来处理分别呈现。原工资表仍从原单读取。")}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button icon="printer" onClick={() => UI().toast("打印「" + title + "」确认记录（演示）", "info")}>打印确认记录</Button>
          <Button icon="file-down" onClick={() => UI().toast("已开始下载「" + title + "」确认记录.xlsx（演示）", "ok")}>下载确认记录</Button>
        </div>
      </> : note("完整确认依据尚未核实，不能生成独立确认记录。", "warn")}
    </Panel>;
  }

  // 提交结果待核对（对应 PayrollACommandState.vue；previewState=pending 时演示）
  function CommandState({ onRecover, onRefresh }) {
    const { Panel, Button } = DS();
    return <Panel role="status" aria-label="工资提交核对" style={{ display: "grid", gap: 8, background: "var(--warn-soft)", borderColor: "var(--warn)" }}>
      {note("上次提交结果尚未确认，原输入已保留。请核对原提交，再继续修改。", "warn")}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button size="sm" onClick={onRecover}>核对原提交</Button><Button size="sm" onClick={onRefresh}>重新读取资料</Button></div>
    </Panel>;
  }

  // P4 三张整页表单的版式：返回 + 标题 + 说明、分区卡片纵排、吸底动作条（视觉对齐 KitFormPage）。
  // 未直接用 KitFormPage：其 buildFormBody 为 DOM 字段契约、吸底固定五按钮且 grid 明细可增删行，
  // 无法表达“核对 → 保存草稿 → 确认”分步动作与固定原依据行；分区锚点导航因此暂不提供（见汇报缺口）。
  function PayrollFormLayout({ title, subtitle, onBack, footer, children, readOnly }) {
    const { Button } = DS();
    return <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button size="sm" icon="arrow-left" onClick={onBack}>返回来源</Button>
        <h1 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{title}</h1>
      </div>
      {subtitle && <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-soft)" }}>{subtitle}</p>}
      {readOnly && <p role="status" style={{ margin: 0, fontSize: 12.5 }}>仅可查看，当前账号不能登记或确认。</p>}
      {children}
      {footer && <div style={{ position: "sticky", bottom: 0, zIndex: 15, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", boxShadow: "0 -4px 16px rgba(16,24,40,0.06)" }}>{footer}</div>}
    </div>;
  }

  // 页面级状态：返回按钮 + KitAtoms.StatePanel（loading / error / empty）
  function PageState({ state, titles, onBack, backLabel, onRetry }) {
    const { Button } = DS();
    const SP = KA().StatePanel;
    return <div style={{ display: "grid", gap: 12, maxWidth: 1080, margin: "0 auto" }}>
      <div><Button icon="arrow-left" onClick={onBack}>{backLabel || "返回来源"}</Button></div>
      {SP && <SP state={state} title={titles[state]} description={titles[state + "Desc"]} actionLabel={state === "error" ? "重新读取" : state === "empty" ? titles.emptyAction : undefined} onAction={onRetry} />}
    </div>;
  }

  window.PAYROLL_LEDGER = {
    amount, num, round2, clone, calc, deltaOf, memberName, PROJECTS, ORIGINALS, ADJUSTMENTS, FACTS, KIND_LABEL, QUAL_LABEL,
    original, adjustment, fact, factByRef, reversedBy, balanceOf, applicationsOf, chainOf, subscribe, saveAdjustment, confirmAdjustment, addFact, openOriginal, openFact,
    ui: { dl, sh, mono, note, go, OriginalWageSummary, BasisFields, FactsTable, ApplicationsTable, ConfirmationOutput, CommandState, PayrollFormLayout, PageState },
  };
  window.PayrollLedgerSharedPreload = function () { return null; };
})();
