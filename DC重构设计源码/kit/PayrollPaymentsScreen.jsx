// PayrollPaymentsScreen — 工资实际收付台账（/subcontract/payroll/payments；#412 P4）。
// 对应 app/components/payroll/PayrollActualLedgerScreen.vue + PayrollActualLedgerSection.vue + PayrollActualFactsTable.vue。
// 口径：按稳定项目只读；原工资发放、真实补退及有效错记冲销同源读取，核算更正与后续处理关联不另计现金；
//       不灌入付款申请、银行流水或往来余额。可选 params.statementId 只看某张原工资范围。
// params：project（项目 id，兼容项目名）、statementId（原工资，可选）、previewState。
(function () {
  function useLedger() {
    const [L, setL] = React.useState(() => window.PAYROLL_LEDGER || null);
    const [, tick] = React.useState(0);
    React.useEffect(() => { if (L) return; const t = setInterval(() => { if (window.PAYROLL_LEDGER) { clearInterval(t); setL(window.PAYROLL_LEDGER); } }, 60); return () => clearInterval(t); }, [L]);
    React.useEffect(() => (L ? L.subscribe(() => tick((v) => v + 1)) : undefined), [L]);
    return L;
  }

  function PayrollPaymentsScreen({ params = {}, navigate }) {
    const L = useLedger();
    const { Panel, Button, StatusChip } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const state = params.previewState || "ready";
    const back = () => navigate("payroll", {});
    if (!L || !Panel) return <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>数据链加载中…</div>;
    const { ui } = L;
    if (state === "loading" || state === "error") return <ui.PageState state={state} onBack={back} backLabel="返回工资核算"
      titles={{ loading: "正在核对工资实际收付…", error: "工资实际收付暂不可用", errorDesc: "原返回范围已保留，不会改读其他项目。" }}
      onRetry={() => navigate("payrollPayments", { ...params, previewState: "ready" })} />;

    // project 接受稳定 id；兼容工资核算页以项目名传参（设计样本内一一对应，不做模糊匹配）
    const hit = L.PROJECTS.find((p) => p.id === params.project || p.name === params.project);
    const project = state === "empty" ? "" : hit ? hit.id : params.project ? "" : "p-hehe";
    const statementId = project ? params.statementId : undefined;
    const readOnly = state === "readonly";
    const rows = L.FACTS.filter((f) => f.projectId === project && (!statementId || f.originalStatementIds.includes(statementId)));
    const net = rows.reduce((s, f) => s + f.signedAmount, 0);
    const partial = rows.filter((f) => f.allocationState !== "complete" || f.qualification !== "proven");
    const pick = (value) => navigate("payrollPayments", { project: value || undefined, previewState: state === "empty" && value ? "ready" : params.previewState });
    const scopeOriginal = statementId && L.original(statementId);

    return <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>工资实际收付</h1>
        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>按项目只读；登记入口在工资详情与更正详情</span>
        <span style={{ marginLeft: "auto" }}><Button onClick={back}>返回来源</Button></span>
      </div>

      <Panel padding={0}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", flexWrap: "wrap" }}>
          {KA.SelectFilter && <KA.SelectFilter label="项目" minWidth={220} value={project}
            options={[{ key: "", label: "查找工资项目" }].concat(L.PROJECTS.map((p) => ({ key: p.id, label: p.name + " · " + p.code })))} onChange={pick} />}
          {scopeOriginal && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            {StatusChip ? <StatusChip tone="brand">仅看原工资：{scopeOriginal.month} {L.memberName(scopeOriginal, scopeOriginal.leaderWorkerId)} · {scopeOriginal.formatFamily}</StatusChip> : null}
            {L.ui.go("看全项目", () => navigate("payrollPayments", { project }))}
          </span>}
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: "8px 14px", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)" }}>
          工人、班组、项目、目标成本与付款管理的“工资实际收付”分区读取同一来源；改名、转组或停用不会把旧事实改挂给当前名册。
        </div>
      </Panel>

      {!project ? (KA.StatePanel && <KA.StatePanel state="empty" title="请选择明确项目后读取工资实际收付" description="台账按稳定项目读取，不按项目名称猜测范围。" />) : <>
        <Panel style={{ display: "grid", gap: 8 }}>
          {KA.SectionHeader && <KA.SectionHeader mb={4} extra={<Button size="sm" icon="refresh-cw" onClick={() => window.KitUI && window.KitUI.toast("已重新核对工资实际收付（演示）", "info")}>刷新工资收付</Button>}>工资实际收付</KA.SectionHeader>}
          {ui.note("工资原发放、真实补退及有效错记冲销同源读取。核算更正与后续处理关联不另计现金。")}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
            <span>工资有效实际净额：</span><span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 17 }}>{L.amount(net)}</span>
            {partial.length > 0 && StatusChip && <StatusChip tone="warn">资料部分完整</StatusChip>}
          </div>
          {partial.length > 0 && ui.note(partial.map((f) => f.occurredOn + " " + L.KIND_LABEL[f.kind] + "：" + L.QUAL_LABEL[f.qualification] + "，个人分配未知，不平摊、不补 0。").join(" "), "warn")}
          {readOnly && <p role="status" style={{ margin: 0, fontSize: 12 }}>当前账号仅可查看，不能发起错记冲销。</p>}
        </Panel>
        <ui.FactsTable rows={rows} navigate={navigate} writable={!readOnly} minRows={8} />
      </>}
    </div>;
  }

  window.PayrollPaymentsScreen = PayrollPaymentsScreen;
})();
