// PayrollAdjustmentDetailScreen — 工资更正详情（/subcontract/payroll/adjustments/:id；#412 P4）。
// 对应 app/components/payroll/PayrollAdjustmentDetailScreen.vue：
//   原签名工资事实 → 本次已确认核算更正（原因/依据/前后核算/差额/确认人，可展开前后完整依据）或草稿 →
//   原更正链当前余额（确认差额 / 已处理 / 待处理）与后续动作 → 逐次处理历史 → 独立确认记录。
// 口径：确认核减只代表“待退或待抵扣”，未真实退款或后续工资处理前原实际支出不变；再纠错走“追加有依据的纠错”。
// params：id（更正 id）、previewState。
(function () {
  function useLedger() {
    const [L, setL] = React.useState(() => window.PAYROLL_LEDGER || null);
    const [, tick] = React.useState(0);
    React.useEffect(() => { if (L) return; const t = setInterval(() => { if (window.PAYROLL_LEDGER) { clearInterval(t); setL(window.PAYROLL_LEDGER); } }, 60); return () => clearInterval(t); }, [L]);
    React.useEffect(() => (L ? L.subscribe(() => tick((v) => v + 1)) : undefined), [L]);
    return L;
  }

  function PayrollAdjustmentDetailScreen({ params = {}, navigate }) {
    const L = useLedger();
    const [open, setOpen] = React.useState({ before: false, after: false });
    const { Panel, Button, StatusChip } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const Shell = window.DetailShell;
    const state = params.previewState || "ready";
    if (!L || !Panel || !Shell) return <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>数据链加载中…</div>;
    const { ui } = L;
    const adj = L.adjustment(params.id || "adj-0001");
    const o = adj && L.original(adj.statementId);
    const back = () => o ? navigate("payrollDetail", { book: o.book, project: o.projectName, crew: o.crew, month: o.month }) : navigate("payroll", {});
    if (!adj || !o || ["loading", "error", "empty"].includes(state)) return <ui.PageState state={state === "ready" || state === "readonly" ? "empty" : state} onBack={back}
      titles={{ loading: "正在读取更正确认与当前处理…", error: "更正记录读取失败", errorDesc: "请从正式工资打开有效更正记录。", empty: "更正记录不存在或身份不一致", emptyDesc: "不按当前名册或同名记录补找原更正。" }}
      onRetry={() => navigate("payrollAdjustmentDetail", { ...params, previewState: "ready" })} />;

    const writable = state !== "readonly";
    const confirmed = adj.status === "confirmed";
    const before = L.calc(adj.before), after = L.calc(adj.after), delta = L.deltaOf(adj);
    const bal = L.balanceOf(adj.id);
    const history = L.applicationsOf(adj.id);
    const toggle = (k) => setOpen((s) => ({ ...s, [k]: !s[k] }));
    const disclosure = (k, label, basis) => <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <div>{ui.go(label, () => toggle(k), open[k] ? "chevron-down" : "chevron-right")}</div>
      {open[k] && <ui.BasisFields basis={basis} original={o} disabled title={label.replace("查看", "")} />}
    </div>;

    return <Shell title="工资更正详情" code={adj.id} onBack={back}
      chips={StatusChip && <StatusChip tone={confirmed ? "ok" : "neutral"}>{confirmed ? "已确认" : "草稿"}</StatusChip>}
      headerExtra={<Button icon="refresh-cw" onClick={() => window.KitUI && window.KitUI.toast("已重新读取更正与当前处理（演示）", "info")}>刷新</Button>}
      metrics={[
        { label: "本次更正前核算", value: L.amount(before) },
        { label: "本次更正后核算", value: L.amount(after) },
        { label: confirmed ? "本次确认差额" : "草稿差额（未生效）", value: L.amount(delta), big: true, tone: "brand", formula: "更正后核算 − 更正前核算；按新旧依据计算，不能直接填写" },
        { label: "原更正链待处理差额", value: L.amount(bal.remainingDelta), big: true, tone: bal.remainingDelta ? "danger" : "ok", formula: "当前已确认差额 − 已处理差额" },
      ]}
      asideExtra={<Panel padding={14}>{KA.SectionHeader && <KA.SectionHeader mb={8}>处理口径</KA.SectionHeader>}
        {ui.note("确认核减 100 元，只表示待退或待抵扣 100 元；未真正退钱或在后续工资中处理前，原实际支出仍保留。")}
        {!writable && <p role="status" style={{ margin: "8px 0 0", fontSize: 12 }}>仅可查看，不能编辑或登记处理。</p>}
      </Panel>}>
      <ui.OriginalWageSummary original={o} navigate={navigate} id="section-original" />

      {confirmed ? <Panel aria-label="本次更正确认" style={{ display: "grid", gap: 10, minWidth: 0 }}>
        {KA.SectionHeader && <KA.SectionHeader mb={0}>本次已确认核算更正</KA.SectionHeader>}
        <p style={{ margin: 0, fontSize: 13, overflowWrap: "anywhere" }}>{adj.reason}</p>
        <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{adj.evidenceNote}</p>
        {ui.dl([["本次更正前核算", ui.mono(L.amount(before))], ["本次更正后核算", ui.mono(L.amount(after))], ["本次确认差额", ui.mono(L.amount(delta), true)], ["原确认人", adj.confirmedBy], ["原确认时间", adj.confirmedAt]], 180)}
        {adj.correctsAdjustmentId && <span style={{ fontSize: 12 }}>{ui.go("查看本次纠正的前序更正", () => navigate("payrollAdjustmentDetail", { id: adj.correctsAdjustmentId }))}</span>}
        {disclosure("before", "查看本次更正前依据", adj.before)}
        {disclosure("after", "查看本次采用依据", adj.after)}
      </Panel> : <Panel aria-label="独立更正草稿" style={{ display: "grid", gap: 8 }}>
        {KA.SectionHeader && <KA.SectionHeader mb={0}>独立更正草稿</KA.SectionHeader>}
        <p style={{ margin: 0, fontSize: 13 }}>{adj.reason || "原因尚未填写"}</p>
        <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", whiteSpace: "pre-wrap" }}>{adj.evidenceNote || "依据尚未填写"}</p>
        {ui.note("草稿没有处理效力，确认核算更正后才形成待处理差额。")}
      </Panel>}

      <Panel aria-label="原更正链当前余额" style={{ display: "grid", gap: 10 }}>
        {KA.SectionHeader && <KA.SectionHeader mb={0}>原更正链当前余额</KA.SectionHeader>}
        {ui.note("包含原更正及后来追加的确认与处理；本次确认事实保留在上方。")}
        {ui.dl([["当前已确认差额", ui.mono(L.amount(bal.confirmedDelta))], ["已处理差额", ui.mono(L.amount(bal.appliedDelta))], ["待处理差额", ui.mono(L.amount(bal.remainingDelta), true)]], 180)}
        {writable && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!confirmed ? <Button variant="primary" icon="square-pen" onClick={() => navigate("payrollAdjustmentForm", { id: adj.id })}>编辑并确认更正</Button> : <>
            {bal.remainingDelta !== 0 && <Button variant="primary" icon="banknote" onClick={() => navigate("payrollPaymentForm", { adjustmentIds: [adj.id] })}>登记实际补发或退款</Button>}
            <Button icon="git-branch" onClick={() => navigate("payrollAdjustmentForm", { statementId: adj.statementId, correctsAdjustmentId: adj.id })}>追加有依据的纠错</Button>
            <Button icon="calendar" onClick={() => navigate("payroll", { project: o.projectName, crew: o.crew })}>到后续工资关联处理</Button>
          </>}
        </div>}
        {ui.note("尚待处理时，原实际收付不变。后续工资只在真实发放成功后处理原余额。")}
      </Panel>

      <section style={{ display: "grid", gap: 8, minWidth: 0 }}>
        {KA.SectionHeader && <KA.SectionHeader mb={0}>逐次处理历史</KA.SectionHeader>}
        <ui.ApplicationsTable rows={history} navigate={navigate} />
      </section>
      <ui.ConfirmationOutput ready={confirmed} title={"工资更正 " + adj.id} />
    </Shell>;
  }

  window.PayrollAdjustmentDetailScreen = PayrollAdjustmentDetailScreen;
})();
