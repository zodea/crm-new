// PayrollPaymentDetailScreen — 工资实际补发 / 实际退款 / 错记冲销只读详情（/subcontract/payroll/payments/:eventId；#412 P4）。
// 对应 app/components/payroll/PayrollActualPaymentDetailScreen.vue：只读确认事实，保留原工资签名金额；
// 标题随事实类型变化；冲销可回看被引用原记录；依据完整的事实可继续“核实错记冲销 / 纠正这次错记冲销”。
// params：id（独立事实 eventId；原工资发放不走本页，回原工资详情）、previewState。
(function () {
  function useLedger() {
    const [L, setL] = React.useState(() => window.PAYROLL_LEDGER || null);
    const [, tick] = React.useState(0);
    React.useEffect(() => { if (L) return; const t = setInterval(() => { if (window.PAYROLL_LEDGER) { clearInterval(t); setL(window.PAYROLL_LEDGER); } }, 60); return () => clearInterval(t); }, [L]);
    React.useEffect(() => (L ? L.subscribe(() => tick((v) => v + 1)) : undefined), [L]);
    return L;
  }

  function PayrollPaymentDetailScreen({ params = {}, navigate }) {
    const L = useLedger();
    const { Panel, Button, StatusChip } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const Shell = window.DetailShell;
    const state = params.previewState || "ready";
    if (!L || !Panel || !Shell) return <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>数据链加载中…</div>;
    const { ui } = L;
    const f = L.fact(params.id || "pay-0001");
    const back = () => navigate("payrollPayments", { project: f ? f.projectId : undefined });
    if (!f || f.ref.kind !== "actual-event" || ["loading", "error", "empty"].includes(state)) return <ui.PageState state={state === "ready" || state === "readonly" ? "empty" : state} onBack={back}
      titles={{ loading: "正在读取原确认事实…", error: "原收付记录读取失败", errorDesc: "请从正式工资收付记录打开有效来源。", empty: "原收付记录不存在或身份不一致", emptyDesc: "原工资发放请从原工资详情查看。" }}
      onRetry={() => navigate("payrollPaymentDetail", { ...params, previewState: "ready" })} />;

    const readOnly = state === "readonly";
    const title = f.kind === "recording-reversal" ? "工资错记冲销详情" : f.kind === "refund" ? "工资实际退款详情" : "工资实际补发详情";
    const originals = f.originalStatementIds.map(L.original).filter(Boolean);
    const originalFact = f.originalFactId && L.fact(f.originalFactId);
    const adjIds = [...new Set(f.applications.map((a) => a.adjustmentId))];
    const canReverse = !readOnly && f.qualification === "proven";

    return <Shell title={title} code={f.identity} onBack={back}
      chips={StatusChip && <StatusChip tone={f.kind === "recording-reversal" ? "warn" : "ok"}>{L.KIND_LABEL[f.kind]} · 已确认</StatusChip>}
      headerExtra={<>
        <Button icon="refresh-cw" onClick={() => window.KitUI && window.KitUI.toast("已重新读取（演示）", "info")}>刷新</Button>
        {canReverse && <Button icon="undo-2" onClick={() => navigate("payrollReversalForm", { eventId: f.identity })}>{f.kind === "recording-reversal" ? "纠正这次错记冲销" : "核实错记冲销"}</Button>}
      </>}
      metrics={[
        { label: f.kind === "recording-reversal" ? "冲销登记效果" : "本次有符号实额", value: L.amount(f.signedAmount), big: true, tone: "brand" },
        { label: "真实发生 / 核实日期", value: f.occurredOn || "未记录" },
        { label: "处理原更正", value: L.amount(f.applications.reduce((s, a) => s + a.amount, 0)), formula: "本次对各原更正的有符号处理额合计；须等于本次实额" },
        { label: "记录资格", value: L.QUAL_LABEL[f.qualification] },
      ]}
      asideExtra={<Panel padding={14}>{KA.SectionHeader && <KA.SectionHeader mb={8}>记录口径</KA.SectionHeader>}
        {ui.note(f.kind === "recording-reversal" ? "错记冲销只抵消“原登记未真实发生”的效果，不是工人实际退款；原记录及原签名金额继续保留。" : "这里登记工资实际收付，不生成付款申请或银行支付记录；原工资签字表保持原金额。")}
        {readOnly && <p role="status" style={{ margin: "8px 0 0", fontSize: 12 }}>仅可查看。</p>}
      </Panel>}>
      {originals.map((o, i) => <ui.OriginalWageSummary key={o.statementId} original={o} navigate={navigate} id={i === 0 ? "section-original" : undefined} />)}
      <Panel style={{ display: "grid", gap: 10, minWidth: 0 }}>
        {KA.SectionHeader && <KA.SectionHeader mb={0}>本次已确认事实</KA.SectionHeader>}
        <ui.FactsTable rows={[f]} navigate={navigate} writable={false} />
        <p style={{ margin: 0, fontSize: 12.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>核对依据：{f.evidenceNote || "未记录"}</p>
        <p style={{ margin: 0, fontSize: 12.5 }}>确认人：{f.confirmedBy || "未记录"} · {f.confirmedAt || "未记录"}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {originalFact && <Button onClick={() => originalFact.ref.kind === "actual-event" ? navigate("payrollPaymentDetail", { id: originalFact.identity }) : navigate("payrollDetail", { book: originalFact.ref.book })}>查看本次冲销引用的原记录</Button>}
          {adjIds.map((id) => <Button key={id} onClick={() => navigate("payrollAdjustmentDetail", { id })}>查看关联更正 {id}</Button>)}
        </div>
      </Panel>
      <ui.ConfirmationOutput ready={f.qualification === "proven"} title={title} />
    </Shell>;
  }

  window.PayrollPaymentDetailScreen = PayrollPaymentDetailScreen;
})();
