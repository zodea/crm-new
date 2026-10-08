// PayrollReversalFormScreen — 工资错记冲销 / 纠正工资错记冲销整页（/subcontract/payroll/payments/reversal/new；#412 P4）。
// 对应 app/components/payroll/PayrollRecordingReversalFormPage.vue + usePayrollRecordingReversalForm。
// 流程：从具体收付事实进入 → 核对原事实与原工资 → 填核实日期与依据 → 勾选“原登记的收付实际没有发生”
//       → 核对错记事实与处理关系 → 确认错记冲销（原事实若本身是冲销，则为“确认冲销纠错”）。
// 口径：只有确认钱未发生才登记错记冲销；钱已付出后收回属于实际退款，不能用冲销消除已发生的支付。
//       系统保存独立反向记录、原引用及对应处理关系，原记录仍可追溯；冲销记错须引用原冲销追加纠错。
// params：statementId（原工资发放）或 eventId（独立收付事实），二选一；previewState（另支持 pending）。
(function () {
  function useLedger() {
    const [L, setL] = React.useState(() => window.PAYROLL_LEDGER || null);
    const [, tick] = React.useState(0);
    React.useEffect(() => { if (L) return; const t = setInterval(() => { if (window.PAYROLL_LEDGER) { clearInterval(t); setL(window.PAYROLL_LEDGER); } }, 60); return () => clearInterval(t); }, [L]);
    React.useEffect(() => (L ? L.subscribe(() => tick((v) => v + 1)) : undefined), [L]);
    return L;
  }
  const blank = () => ({ confirmedOn: "", evidenceNote: "", confirmedNotOccurred: false });

  function PayrollReversalFormScreen({ params = {}, navigate }) {
    const L = useLedger();
    const [draft, setDraft] = React.useState(blank);
    const [dirty, setDirty] = React.useState(false);
    const [previewed, setPreviewed] = React.useState(false);
    const [reasons, setReasons] = React.useState([]);
    const targetKey = (params.statementId || "") + "|" + (params.eventId || "");
    React.useEffect(() => { setDraft(blank()); setDirty(false); setPreviewed(false); setReasons([]); }, [targetKey]);

    const { Panel, Button, Field } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const state = params.previewState || "ready";
    if (!L || !Panel) return <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>数据链加载中…</div>;
    const { ui } = L;
    const f = state === "empty" ? null : L.factByRef(params);
    const backTo = () => f ? (f.ref.kind === "actual-event" ? navigate("payrollPaymentDetail", { id: f.identity }) : navigate("payrollPayments", { project: f.projectId })) : navigate("payrollPayments", {});
    const leave = () => dirty ? UI.confirm({ title: "放弃未确认的冲销输入？", message: "核实日期、依据或确认勾选尚未提交；返回后不保留。", confirmText: "放弃输入", onConfirm: backTo }) : backTo();
    if (state === "loading" || state === "error") return <ui.PageState state={state} onBack={backTo}
      titles={{ loading: "正在读取原收付事实…", error: "原收付事实未能核实", errorDesc: "原依据已保留，请重新读取后核对。" }}
      onRetry={() => navigate("payrollReversalForm", { ...params, previewState: "ready" })} />;
    if (!f) return <ui.PageState state="empty" onBack={backTo}
      titles={{ empty: "请从具体工资收付事实进入错记冲销", emptyDesc: "冲销必须明确引用一条原登记；不按金额或日期猜测原事实。", emptyAction: "打开演示原事实（pay-0001 实际退款）" }}
      onRetry={() => navigate("payrollReversalForm", { eventId: "pay-0001" })} />;

    const correcting = f.kind === "recording-reversal";
    const title = correcting ? "纠正工资错记冲销" : "工资错记冲销";
    const originals = f.originalStatementIds.map(L.original).filter(Boolean);
    const editable = state !== "readonly";
    const pending = state === "pending";
    const reversalAmount = L.round2(-f.signedAmount);
    const patch = (p) => { if (!editable) return; setDraft((d) => ({ ...d, ...p })); setDirty(true); setPreviewed(false); };
    const check = () => {
      const r = [];
      if (f.qualification !== "proven") r.push("原事实依据不完整，不能登记冲销。");
      if (L.reversedBy(f)) r.push("这笔登记已有有效冲销；如冲销本身有误，请从该冲销追加纠错。");
      if (!draft.confirmedOn) r.push("请填写核实日期。");
      if (!draft.evidenceNote.trim()) r.push(correcting ? "请填写纠正原冲销的核对依据。" : "请填写确认未发生的核对依据。");
      if (!draft.confirmedNotOccurred) r.push("请明确确认原登记的收付实际没有发生。");
      setReasons(r); setPreviewed(true);
    };
    const canConfirm = editable && !pending && previewed && reasons.length === 0;
    const confirm = () => UI.confirm({ title: correcting ? "确认冲销纠错？" : "确认错记冲销？", confirmText: correcting ? "确认冲销纠错" : "确认错记冲销",
      message: "将追加独立反向记录 " + L.amount(reversalAmount) + "，引用原记录 " + f.identity + "；原记录及原签名金额继续保留。",
      onConfirm: () => {
        const row = L.addFact({ kind: "recording-reversal", projectId: f.projectId, originalStatementIds: f.originalStatementIds, originalFactId: f.identity, occurredOn: draft.confirmedOn, signedAmount: reversalAmount, evidenceNote: draft.evidenceNote,
          allocations: f.allocations.map((a) => ({ ...a, amount: a.amount == null ? null : L.round2(-a.amount) })), applications: f.applications.map((a) => ({ adjustmentId: a.adjustmentId, amount: L.round2(-a.amount), later: a.later })) });
        UI.toast((correcting ? "冲销纠错" : "错记冲销") + "已确认（设计演示）", "success"); navigate("payrollPaymentDetail", { id: row.identity });
      } });

    return <ui.PayrollFormLayout title={title} onBack={leave} readOnly={!editable}
      subtitle={correcting ? "核实原冲销有误后引用该记录追加独立纠错，原记录继续保留。" : "核实某笔登记未真实发生后追加冲销。不能把实际已付的核减当成错记。"}
      footer={!editable ? null : <>
        <Button disabled={pending} onClick={leave}>返回来源</Button>
        <Button variant="primary" disabled={!canConfirm} onClick={confirm}>{correcting ? "确认冲销纠错" : "确认错记冲销"}</Button>
      </>}>
      {pending && <ui.CommandState onRecover={() => navigate("payrollReversalForm", { ...params, previewState: "ready" })} onRefresh={() => navigate("payrollReversalForm", { ...params, previewState: "ready" })} />}
      {originals.length ? originals.map((o) => <ui.OriginalWageSummary key={o.statementId} original={o} navigate={navigate} />)
        : (KA.StatePanel && <KA.StatePanel compact state="empty" title="原工资资料未读取" description="历史迁移记录仅保留整单金额，原工资明细不在本次范围。" />)}
      <Panel style={{ display: "grid", gap: 10, minWidth: 0 }}>
        {KA.SectionHeader && <KA.SectionHeader mb={0}>被引用的原事实</KA.SectionHeader>}
        <ui.FactsTable rows={[f]} navigate={navigate} writable={false} />
      </Panel>
      <Panel style={{ display: "grid", gap: 12, minWidth: 0 }}>
        {KA.SectionHeader && <KA.SectionHeader mb={0}>具体错记事实与核实依据</KA.SectionHeader>}
        <p style={{ margin: 0, fontSize: 12.5 }}>原登记实额 {ui.mono(L.amount(f.signedAmount))}；本次冲销登记效果 {ui.mono(L.amount(reversalAmount), true)}。</p>
        {ui.note(correcting ? "本次仅纠正被引用冲销的登记效果，不代表新的实际补发或退款；原冲销及原签名金额继续保留。" : "本次不是工人实际退款；原记录及原签名金额继续保留。", "warn")}
        <Field label="核实日期" value={draft.confirmedOn} style={{ maxWidth: 360 }} onChange={(e) => patch({ confirmedOn: e.target.value })} inputProps={{ type: "date", disabled: !editable }} />
        <div className="dc-fields"><label>{correcting ? "纠正原冲销的核对依据" : "确认未发生的核对依据"}<textarea aria-label="核对依据" rows={4} value={draft.evidenceNote} disabled={!editable} onChange={(e) => patch({ evidenceNote: e.target.value })} style={{ resize: "vertical" }} /></label></div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5 }}>
          <input type="checkbox" checked={draft.confirmedNotOccurred} disabled={!editable} onChange={(e) => patch({ confirmedNotOccurred: e.target.checked })} style={{ marginTop: 3 }} />
          <span>{correcting ? "已核实这次冲销所称的事实不成立，需引用该冲销追加纠错，并保留可回读依据。" : "已核实这笔登记的收付未真实发生，并保留可回读的核对依据。"}</span>
        </label>
        <div><Button icon="scan-search" disabled={!editable || pending} onClick={check}>核对错记事实与处理关系</Button></div>
        {!previewed && editable && ui.note("依据已修改，请重新核对。", "warn")}
        {previewed && !reasons.length && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--brand)" }}>已核对：将同时反向原事实对各更正的处理关系（设计演示）。</p>}
        {reasons.map((r) => <p key={r} role="alert" tabIndex={-1} style={{ margin: 0, fontSize: 12, color: "var(--warn-ink)" }}>{r}</p>)}
      </Panel>
    </ui.PayrollFormLayout>;
  }

  window.PayrollReversalFormScreen = PayrollReversalFormScreen;
})();
