// PayrollAdjustmentFormScreen — 独立工资更正整页（新建 /subcontract/payroll/adjustments/new · 编辑 /adjustments/form/:id；#412 P4）。
// 对应 app/components/payroll/PayrollAdjustmentFormPage.vue + PayrollAdjustmentBasisFields.vue + usePayrollAdjustmentForm.ts。
// 流程：核对原工资 → 对照“更正前的完整依据”修改本次依据（A 量/价/比例；C1 日薪/工时；C2 主体单价/签工）
//       → 填原因与人工核对依据 → 按当前资料核对本稿（前/后核算与有符号差额）→ 保存更正草稿 → 明确确认核算更正。
// 口径：差额只能由新旧依据算出，不能直接填负数合计；草稿无处理效力；已确认不可覆盖，再纠错从详情追加续更正；
//       实际补发或退款另行登记，不在本页发生。不用今天的名册或费率补原凭据。
// 未用 FormPage 规格表单：本页需“核对 / 保存草稿 / 确认”三段动作与依据表格，超出 KitFormPage 五按钮契约。
// params：id（编辑既有更正，缺省 = 新建）、statementId（新建时的原工资）、correctsAdjustmentId（续更正，可选）、previewState。
(function () {
  function useLedger() {
    const [L, setL] = React.useState(() => window.PAYROLL_LEDGER || null);
    const [, tick] = React.useState(0);
    React.useEffect(() => { if (L) return; const t = setInterval(() => { if (window.PAYROLL_LEDGER) { clearInterval(t); setL(window.PAYROLL_LEDGER); } }, 60); return () => clearInterval(t); }, [L]);
    React.useEffect(() => (L ? L.subscribe(() => tick((v) => v + 1)) : undefined), [L]);
    return L;
  }

  // 由路由参数取得本稿：编辑 = 既有更正；新建 = 原工资依据（续更正以前序更正的采用依据为“更正前”）
  function initDraft(L, params) {
    const row = params.id && L.adjustment(params.id);
    const stId = row ? row.statementId : params.statementId;
    const o = stId && L.original(stId);
    if (!o) return null;
    const prior = !row && params.correctsAdjustmentId && L.adjustment(params.correctsAdjustmentId);
    const before = row ? row.before : prior ? prior.after : o.basis;
    return { id: row ? row.id : null, statementId: stId, status: row ? row.status : "draft", reason: row ? row.reason : "", evidenceNote: row ? row.evidenceNote : "",
      correctsAdjustmentId: row ? row.correctsAdjustmentId : prior ? prior.id : null, before: L.clone(before), after: L.clone(row ? row.after : before) };
  }

  function PayrollAdjustmentFormScreen({ params = {}, navigate }) {
    const L = useLedger();
    const [draft, setDraft] = React.useState(() => window.PAYROLL_LEDGER ? initDraft(window.PAYROLL_LEDGER, params) : null);
    const [dirty, setDirty] = React.useState(false);
    const [previewed, setPreviewed] = React.useState(() => !!params.id);
    const [reasons, setReasons] = React.useState([]);
    const [notice, setNotice] = React.useState("");
    // 目标（编辑对象 / 原工资 / 前序更正）变化或基座迟到就绪时重新取稿；同一目标内保留未保存输入
    const targetKey = [params.id || "", params.statementId || "", params.correctsAdjustmentId || "", L ? 1 : 0].join("|");
    const loadedKey = React.useRef(targetKey);
    React.useEffect(() => {
      if (!L || loadedKey.current === targetKey) return;
      loadedKey.current = targetKey;
      setDraft(initDraft(L, params)); setDirty(false); setPreviewed(!!params.id); setReasons([]); setNotice("");
    }, [L, targetKey]);   // eslint-disable-line

    const { Panel, Button } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const state = params.previewState || "ready";
    if (!L || !Panel) return <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>数据链加载中…</div>;
    const { ui } = L;
    const o = draft && L.original(draft.statementId);
    const backTo = () => draft && draft.id ? navigate("payrollAdjustmentDetail", { id: draft.id })
      : draft && draft.correctsAdjustmentId ? navigate("payrollAdjustmentDetail", { id: draft.correctsAdjustmentId })
      : o ? L.openOriginal(navigate, o) : navigate("payroll", {});
    const leave = () => dirty ? UI.confirm({ title: "放弃未保存的更正输入？", message: "依据、原因或核对说明尚未保存；返回后本次输入不保留。", confirmText: "放弃输入", onConfirm: backTo }) : backTo();
    if (state === "loading" || state === "error") return <ui.PageState state={state} onBack={backTo}
      titles={{ loading: "正在读取原工资与更正依据…", error: "更正资料未能读取", errorDesc: "原输入与采用依据已保留，请重新读取后核对。" }}
      onRetry={() => navigate("payrollAdjustmentForm", { ...params, previewState: "ready" })} />;
    if (!draft || !o) return <ui.PageState state="empty" onBack={backTo}
      titles={{ empty: "请从原已发工资详情发起独立更正", emptyDesc: "更正固定到一张已发放的原工资；不按项目或负责人名称猜测原单。", emptyAction: "打开演示原工资（A · 合和新城 2026-08）" }}
      onRetry={() => navigate("payrollAdjustmentForm", { statementId: "st-a-0801" })} />;

    const basisMissing = state === "empty";
    const confirmed = draft.status === "confirmed";
    const editable = state !== "readonly" && !confirmed && !basisMissing;
    const pending = state === "pending";
    const before = L.calc(draft.before), after = L.calc(draft.after);
    const delta = before == null || after == null ? null : L.round2(after - before);
    const change = (patch) => { if (!editable) return; setDraft((d) => ({ ...d, ...patch })); setDirty(true); setPreviewed(false); setNotice(""); };
    const check = () => {
      const r = [];
      if (after == null) r.push("更正依据存在未填写或无效项，不能核算。");
      else if (delta === 0) r.push("更正前后核算一致，没有可确认的差额。");
      if (!draft.reason.trim()) r.push("请填写更正原因。");
      if (!draft.evidenceNote.trim()) r.push("请填写人工核对依据。");
      setReasons(r); setPreviewed(true);
      setNotice(r.length ? "" : "已按当前资料核对本稿（设计演示）；保存草稿后可确认。");
    };
    const canSave = editable && !pending && previewed && reasons.length === 0 && (dirty || !draft.id);
    const canConfirm = editable && !pending && previewed && reasons.length === 0 && !dirty && !!draft.id;
    const save = () => { const row = L.saveAdjustment(draft); setDraft((d) => ({ ...d, id: row.id })); setDirty(false); UI.toast("更正草稿已保存（设计演示）；草稿没有处理效力", "ok"); };
    const confirm = () => UI.confirm({ title: "确认核算更正？", confirmText: "确认核算更正",
      message: "确认后保留本次依据，差额 " + L.amount(delta) + " 进入待处理；原签名金额不变，确认后不能覆盖，再纠错须从详情追加。",
      onConfirm: () => { L.confirmAdjustment(draft.id); UI.toast("核算更正已确认（设计演示）", "success"); navigate("payrollAdjustmentDetail", { id: draft.id }); } });
    // 多行说明沿用 app.dc.html 既有 .dc-fields 表单栅格（同 QuantityStagesScreen），DesignSystem 无 textarea 原语
    const field = (label, key, rows) => <label>{label}<textarea aria-label={label} rows={rows} value={draft[key]} disabled={!editable} onChange={(e) => change({ [key]: e.target.value })} style={{ resize: "vertical" }} /></label>;
    const P = "adjf";
    const btn = (label, onClick, enabled, primary) => <Button variant={primary ? "primary" : "secondary"} disabled={!enabled} onClick={onClick}>{label}</Button>;

    // 分区：原工资 / 更正依据 / 原因与核对（与实现端 EntityFormShell sections 一致）
    return <ui.PayrollFormLayout title="独立工资更正" subtitle="保存更正依据后单独确认核算差额；实际补发或退款另行登记。" onBack={leave} readOnly={state === "readonly"}
      footer={state === "readonly" ? null : <>
        {btn("返回来源", leave, !pending)}
        {btn("保存更正草稿", save, canSave)}
        {btn("确认核算更正", confirm, canConfirm, true)}
      </>}>
      {pending && <ui.CommandState onRecover={() => navigate("payrollAdjustmentForm", { ...params, previewState: "ready" })} onRefresh={() => navigate("payrollAdjustmentForm", { ...params, previewState: "ready" })} />}
      <ui.OriginalWageSummary original={o} navigate={navigate} id={P + "-original"} />
      {basisMissing ? <div id={P + "-basis"}>{KA.StatePanel && <KA.StatePanel state="empty" title="原核算依据不完整，不能补造更正来源" description="历史证据不完整时先查看缺口，不能用今天的名册或费率补成原凭据。" />}</div> : <>
        <ui.BasisFields basis={draft.before} original={o} disabled title={draft.correctsAdjustmentId ? "更正前的完整依据（前序更正采用值）" : "更正前的完整依据"} />
        <ui.BasisFields id={P + "-basis"} basis={draft.after} original={o} disabled={!editable} onChange={(b) => change({ after: b })} />
      </>}
      <Panel id={P + "-reason"} style={{ display: "grid", gap: 12, minWidth: 0 }}>
        {KA.SectionHeader && <KA.SectionHeader mb={0}>原因与核对</KA.SectionHeader>}
        <div className="dc-fields">{field("更正原因", "reason", 2)}{field("人工核对依据", "evidenceNote", 3)}</div>
        {draft.correctsAdjustmentId && <p style={{ margin: 0, fontSize: 12, overflowWrap: "anywhere" }}>本次续更正关联：{ui.go("查看前序更正 " + draft.correctsAdjustmentId, () => navigate("payrollAdjustmentDetail", { id: draft.correctsAdjustmentId }))}</p>}
        <div><Button icon="scan-search" disabled={!editable || pending} onClick={check}>按当前资料核对本稿</Button></div>
        {!previewed && editable && ui.note("输入已修改，请重新核对后保存。", "warn")}
        {ui.dl([["更正前核算", ui.mono(L.amount(before))], ["更正后核算", ui.mono(L.amount(after))], ["本次有符号差额", ui.mono(L.amount(delta), true)], ["实际收付", "尚未发生；由独立处理记录确认"]])}
        {reasons.map((r) => <p key={r} role="alert" tabIndex={-1} style={{ margin: 0, fontSize: 12, color: "var(--warn-ink)" }}>{r}</p>)}
        {notice && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--brand)" }}>{notice}</p>}
        {confirmed && ui.note("这项更正已确认，不能覆盖。需要再纠错时请从详情追加独立更正。")}
      </Panel>
    </ui.PayrollFormLayout>;
  }

  window.PayrollAdjustmentFormScreen = PayrollAdjustmentFormScreen;
})();
