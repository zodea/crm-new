// PayrollPaymentFormScreen — 登记工资实际补退整页（/subcontract/payroll/payments/new；#412 P4）。
// 对应 app/components/payroll/PayrollActualPaymentFormPage.vue + PayrollActualPaymentFields.vue + usePayrollActualPaymentForm.ts。
// 流程：核对原工资 → 选方向（补发正数 / 退款负数）、真实发生日期、有符号实额、核对依据 → 按实际填写原成员收付
//       （未参与留空，真实零填 0）→ 填本次对各原更正的处理额（可分次，合计 = 本次实额，不超剩余）→ 核对 → 确认真实收付。
// 口径：只登记已经真实发生的钱；不生成付款申请或银行支付记录，不要求编造银行流水号；原工资签字表保持原金额。
// params：adjustmentIds（原更正 id 数组；兼容单个 adjustmentId）、previewState（另支持 pending 演示“结果未知待核对”）。
(function () {
  function useLedger() {
    const [L, setL] = React.useState(() => window.PAYROLL_LEDGER || null);
    const [, tick] = React.useState(0);
    React.useEffect(() => { if (L) return; const t = setInterval(() => { if (window.PAYROLL_LEDGER) { clearInterval(t); setL(window.PAYROLL_LEDGER); } }, 60); return () => clearInterval(t); }, [L]);
    React.useEffect(() => (L ? L.subscribe(() => tick((v) => v + 1)) : undefined), [L]);
    return L;
  }
  const blank = () => ({ kind: "refund", occurredOn: "", amount: "", evidenceNote: "", allocations: {}, applications: {} });

  function PayrollPaymentFormScreen({ params = {}, navigate }) {
    const L = useLedger();
    const ids = [].concat(params.adjustmentIds || params.adjustmentId || []);
    const targetKey = ids.join(",");
    const [draft, setDraft] = React.useState(blank);
    const [dirty, setDirty] = React.useState(false);
    const [previewed, setPreviewed] = React.useState(false);
    const [reasons, setReasons] = React.useState([]);
    React.useEffect(() => {
      if (!L) return;
      // 方向默认跟随待处理差额：核减待退 → 实际退款；核增待补 → 实际补发
      const due = ids.reduce((s, id) => s + (L.adjustment(id) ? L.balanceOf(id).remainingDelta : 0), 0);
      setDraft({ ...blank(), kind: due > 0 ? "supplement" : "refund" }); setDirty(false); setPreviewed(false); setReasons([]);
    }, [L, targetKey]);   // eslint-disable-line

    const { Panel, Button, Field } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const KT = window.KitTable;
    const UI = window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const state = params.previewState || "ready";
    if (!L || !Panel) return <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>数据链加载中…</div>;
    const { ui } = L;
    const adjs = ids.map(L.adjustment).filter((a) => a && a.status === "confirmed");
    const backTo = () => adjs[0] ? navigate("payrollAdjustmentDetail", { id: adjs[0].id }) : navigate("payrollPayments", {});
    const leave = () => dirty ? UI.confirm({ title: "放弃未确认的收付输入？", message: "本次方向、金额、成员分配或处理额尚未确认；返回后不保留。", confirmText: "放弃输入", onConfirm: backTo }) : backTo();
    if (state === "loading" || state === "error") return <ui.PageState state={state} onBack={backTo}
      titles={{ loading: "正在读取原更正与剩余额度…", error: "实际补退资料未能读取", errorDesc: "原金额与采用余额已保留，请重新读取后核对。" }}
      onRetry={() => navigate("payrollPaymentForm", { ...params, previewState: "ready" })} />;
    if (!ids.length) return <ui.PageState state="empty" onBack={backTo}
      titles={{ empty: "请从已确认更正发起实际补退", emptyDesc: "实际补退必须处理明确的原更正；不能凭空登记收付。", emptyAction: "打开演示更正（adj-0001）" }}
      onRetry={() => navigate("payrollPaymentForm", { adjustmentIds: ["adj-0001"] })} />;

    const balances = state === "empty" ? [] : adjs.map((a) => ({ adj: a, bal: L.balanceOf(a.id) })).filter((x) => x.bal.remainingDelta !== 0);
    if (!balances.length) return <ui.PageState state="empty" onBack={backTo}
      titles={{ empty: "所选更正已无待处理差额", emptyDesc: "剩余额度为 0 或更正尚未确认；已处理部分请在更正详情的逐次处理历史中查看。" }} />;

    const originals = [...new Set(balances.map((x) => x.adj.statementId))].map(L.original).filter(Boolean);
    const members = [...new Map(originals.flatMap((o) => o.members).map((m) => [m.workerId, m])).values()];
    const editable = state !== "readonly";
    const pending = state === "pending";
    const amt = L.num(draft.amount);
    const patch = (p) => { if (!editable) return; setDraft((d) => ({ ...d, ...p })); setDirty(true); setPreviewed(false); };
    const setMap = (key, id, value) => patch({ [key]: { ...draft[key], [id]: value } });
    const filled = (m) => Object.entries(m).filter(([, v]) => String(v).trim() !== "").map(([k, v]) => [k, L.num(v)]);
    const check = () => {
      const r = [];
      const allocs = filled(draft.allocations), apps = filled(draft.applications);
      if (!draft.occurredOn) r.push("请填写真实发生日期。");
      if (amt == null || amt === 0) r.push("请填写本次有符号实额。");
      else if ((draft.kind === "refund") !== (amt < 0)) r.push("收付方向与实额符号不一致：实际退款填负数，实际补发填正数。");
      if (!draft.evidenceNote.trim()) r.push("请填写实际发生与核对依据。");
      if (!allocs.length) r.push("请按实际填写本次收付成员；未参与的人留空。");
      if (allocs.some(([, v]) => v == null)) r.push("成员收付金额存在无效数字。");
      else if (amt != null && allocs.some(([, v]) => v !== 0 && (v < 0) !== (amt < 0))) r.push("成员分配方向须与本次实额一致。");
      else if (amt != null && allocs.length && L.round2(allocs.reduce((s, [, v]) => s + v, 0)) !== L.round2(amt)) r.push("成员收付合计 " + L.amount(allocs.reduce((s, [, v]) => s + v, 0)) + " 与本次实额 " + L.amount(amt) + " 不一致（精确到分）。");
      apps.forEach(([id, v]) => {
        const b = balances.find((x) => x.adj.id === id);
        if (v == null) r.push(id + " 的处理额无效。");
        else if (v !== 0 && (v < 0) !== (b.bal.remainingDelta < 0)) r.push(id + " 的处理方向与待处理差额相反。");
        else if (Math.abs(v) > Math.abs(b.bal.remainingDelta)) r.push(id + " 的处理额超过当前剩余额度 " + L.amount(b.bal.remainingDelta) + "。");
      });
      if (amt != null && L.round2(apps.reduce((s, [, v]) => s + (v || 0), 0)) !== L.round2(amt)) r.push("各项原更正处理额合计须等于本次实额 " + L.amount(amt) + "。");
      setReasons(r); setPreviewed(true);
    };
    const canConfirm = editable && !pending && previewed && reasons.length === 0;
    const confirm = () => UI.confirm({ title: "确认真实收付？", confirmText: "确认真实收付",
      message: (draft.kind === "refund" ? "实际退款 " : "实际补发 ") + L.amount(amt) + "，发生于 " + draft.occurredOn + "。确认后形成独立收付记录，原工资签字表保持原金额。",
      onConfirm: () => {
        const f = L.addFact({ kind: draft.kind, projectId: originals[0].projectId, originalStatementIds: originals.map((o) => o.statementId), occurredOn: draft.occurredOn, signedAmount: amt, evidenceNote: draft.evidenceNote,
          allocations: filled(draft.allocations).map(([workerId, amount]) => ({ workerId, workerName: (members.find((m) => m.workerId === workerId) || {}).workerName || null, amount })),
          applications: filled(draft.applications).filter(([, v]) => v).map(([adjustmentId, amount]) => ({ adjustmentId, amount })) });
        UI.toast("实际收付已确认（设计演示）", "success"); navigate("payrollPaymentDetail", { id: f.identity });
      } });
    const section = (title, children) => <Panel style={{ display: "grid", gap: 12, minWidth: 0 }}>{KA.SectionHeader && <KA.SectionHeader mb={0}>{title}</KA.SectionHeader>}{children}</Panel>;
    const cell = (value, aria, onChange) => <Field label={null} mono value={value || ""} style={{ width: 160 }} onChange={(e) => onChange(e.target.value)} inputProps={{ "aria-label": aria, type: "number", step: "0.01", disabled: !editable }} />;

    return <ui.PayrollFormLayout title="登记工资实际补退" subtitle="仅登记已经真实发生的补发或退款。差额与实际发生金额分别核对。" onBack={leave} readOnly={!editable}
      footer={!editable ? null : <>
        <Button disabled={pending} onClick={leave}>返回来源</Button>
        <Button variant="primary" disabled={!canConfirm} onClick={confirm}>确认真实收付</Button>
      </>}>
      {pending && <ui.CommandState onRecover={() => navigate("payrollPaymentForm", { ...params, previewState: "ready" })} onRefresh={() => navigate("payrollPaymentForm", { ...params, previewState: "ready" })} />}
      {originals.map((o) => <ui.OriginalWageSummary key={o.statementId} original={o} navigate={navigate} />)}
      {section("本次真实收付", <>
        <div className="dc-fields dc-form-fields">
          <label>收付方向<select aria-label="收付方向" value={draft.kind} disabled={!editable} onChange={(e) => patch({ kind: e.target.value })}><option value="refund">实际退款（负数）</option><option value="supplement">实际补发（正数）</option></select></label>
          <Field label="真实发生日期" value={draft.occurredOn} onChange={(e) => patch({ occurredOn: e.target.value })} inputProps={{ type: "date", disabled: !editable }} />
          <Field label="本次有符号实额" mono value={draft.amount} onChange={(e) => patch({ amount: e.target.value })} inputProps={{ type: "number", step: "0.01", disabled: !editable }} />
        </div>
        <div className="dc-fields"><label>实际发生与核对依据<textarea aria-label="实际发生与核对依据" rows={3} value={draft.evidenceNote} disabled={!editable} onChange={(e) => patch({ evidenceNote: e.target.value })} style={{ resize: "vertical" }} /></label></div>
        {ui.note("这里登记工资实际收付，不生成普通付款申请或银行支付记录，也不要求编造银行流水号。")}
      </>)}
      {section("本次实际收付人", <>
        {ui.note("按实际填写原成员。本次未参与留空；真实零填写 0。每项符号应与总额方向一致。")}
        {KT && <KT label="本次实际收付分配" minRows={0} tableMinWidth={480} rows={members.map((m) => ({ ...m, id: m.workerId }))} columns={[
          { key: "workerName", label: "原成员", width: 200, render: (v) => v || "姓名未记录" },
          { key: "_amount", label: "本次有符号收付金额", width: 200, render: (_v, m) => cell(draft.allocations[m.workerId], (m.workerName || "原成员") + "本次收付金额", (v) => setMap("allocations", m.workerId, v)) },
        ]} footerLeft={"已填 " + filled(draft.allocations).length + " 人 · 合计 " + L.amount(filled(draft.allocations).reduce((s, [, v]) => s + (v || 0), 0))} />}
      </>)}
      {section("本次处理的原更正", <>
        {ui.note("可以分次处理；各项合计须等于本次实额，且不能超过各项剩余额度。")}
        {KT && <KT label="本次更正处理分摊" minRows={0} tableMinWidth={680} rows={balances.map((x) => ({ id: x.adj.id, adj: x.adj, remaining: x.bal.remainingDelta }))} columns={[
          { key: "adj", label: "原更正", width: 280, render: (a) => <span style={{ display: "grid", gap: 2, whiteSpace: "normal", justifyItems: "start" }}>{ui.go(a.id, () => navigate("payrollAdjustmentDetail", { id: a.id }))}<span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{a.reason}</span></span> },
          { key: "remaining", label: "当前待处理差额", width: 150, align: "right", render: (v) => ui.mono(L.amount(v), true) },
          { key: "_apply", label: "本次有符号处理额", width: 200, render: (_v, r) => cell(draft.applications[r.id], r.id + "本次处理额", (v) => setMap("applications", r.id, v)) },
        ]} />}
      </>)}
      <Panel style={{ display: "grid", gap: 8 }}>
        <div><Button icon="scan-search" disabled={!editable || pending} onClick={check}>核对本次金额与剩余</Button></div>
        {!previewed && editable && ui.note("输入已修改，请按当前资料重新核对。", "warn")}
        {previewed && !reasons.length && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--brand)" }}>已核对：方向、成员合计与处理额均与本次实额一致（设计演示）。</p>}
        {reasons.map((r) => <p key={r} role="alert" tabIndex={-1} style={{ margin: 0, fontSize: 12, color: "var(--warn-ink)" }}>{r}</p>)}
      </Panel>
    </ui.PayrollFormLayout>;
  }

  window.PayrollPaymentFormScreen = PayrollPaymentFormScreen;
})();
