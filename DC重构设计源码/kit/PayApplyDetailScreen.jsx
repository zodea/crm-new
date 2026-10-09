// 付款申请独立只读详情：对应 app/components/finance/PaymentApplicationDetailScreen.vue。
// 只消费设计样本已存在的事实；缺少分摊/批复来源时保留未知，不从申请金额猜支付资格。
(function () {
  function PayApplyDetailScreen({ params = {}, navigate }) {
    const A = window.APP;
    const KA = window.KitAtoms;
    const { Panel, Button } = window.DesignSystem_e3d871;
    const Shell = window.DetailShell;
    const Table = window.KitTable;
    const row = A.get("payApplies", params.id);
    const state = params.previewState || "ready";
    const back = () => navigate("payApply", params.returnParams || {});
    const money = v => v == null || v === "" ? "—" : "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!row || ["loading", "error", "empty"].includes(state)) return <div style={{ display: "grid", gap: 12 }}>
      <Button onClick={back}>返回付款申请</Button>
      <KA.StatePanel state={state === "ready" ? "empty" : state} title={state === "loading" ? "正在加载付款申请" : state === "error" ? "付款申请详情加载失败" : "付款申请不存在或已删除"}
        actionLabel={state === "error" ? "重新加载" : undefined} onAction={() => navigate("payApplyDetail", { ...params, previewState: "ready" })} />
    </div>;
    const project = row.projectId && A.get("projects", row.projectId);
    const supplier = row.supplierId && A.get("suppliers", row.supplierId);
    const contract = row.contractId && A.get("contracts", row.contractId);
    const allocated = (rows, key) => Array.isArray(rows) && rows.every(r => r[key] != null && r[key] !== "" && Number.isFinite(Number(r[key]))) ? rows.reduce((sum, r) => sum + Number(r[key]), 0) : null;
    const paid = Array.isArray(row.payments) ? allocated(row.payments.filter(r => r.confirmationStatus === "confirmed"), "allocatedAmount") : null;
    const invoiced = row.invoiceAllocated == null ? allocated(row.invoiceLinks, "iLink") : row.invoiceAllocated;
    const fields = [["申请编号", row.no], ["项目", project ? project.name : row.projectId ? "来源待核验" : "公司付款"], ["收款单位", supplier && supplier.name], ["申请人", row.applicant], ["申请日期", row.applyDate], ["业务类型", row.bizType], ["成本分类", row.costName], ["回票类型", row.invoiceState], ["付款内容", row.payContent]];
    const table = (title, rows, columns, empty) => <section>
      <KA.SectionHeader>{title}</KA.SectionHeader>
      <Table label={title} rows={rows || []} columns={columns} empty={empty} />
    </section>;
    return <Shell title={row.name || "付款申请详情"} code={row.no} onBack={back} chips={window.stdStatusChip(row.status)}
      headerExtra={state !== "readonly" && <Button icon="square-pen" onClick={() => navigate("payApplyForm", { id: row.id })}>编辑申请</Button>}
      metrics={[
        { label: "申请金额", value: money(row.applyAmount) }, { label: "本期批复金额", value: money(row.approvedAmount) },
        { label: "已确认支付", value: money(paid) }, { label: "待支付", value: money(row.unpaidAmount) },
        { label: "已关联发票", value: money(invoiced) }, { label: "待回票", value: money(row.pendingInvoiceAmount) },
      ]}
      asideExtra={<Panel><KA.SectionHeader>智能业务洞察</KA.SectionHeader><p style={{ margin: 0, fontSize: 13, lineHeight: 1.8 }}>仅展示已记录的申请与关联事实。批复、支付及回票金额缺少核验来源时显示“—”，不据此生成可支付金额。</p>{state === "readonly" && <p role="status">仅可查看，不能编辑申请。</p>}</Panel>}>
      <Panel><KA.SectionHeader>申请资料</KA.SectionHeader><dl className="dc-fields" style={{ margin: 0 }}>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value == null || value === "" ? "—" : value}</dd></div>)}</dl></Panel>
      {row.contractId && <Panel><KA.SectionHeader>合同付款情况</KA.SectionHeader>{contract ? <KA.EntityLink type="contract" id={contract.id} label={contract.name} navigate={navigate} /> : <KA.StatePanel compact state="empty" title="关联合同来源待核验" />}</Panel>}
      {table("付款关联结算", row.settleLinks, [{ key: "sNo", label: "结算单", width: 180 }, { key: "sName", label: "结算名称", width: 200 }, { key: "sAmt", label: "结算金额", money: true }, { key: "sLink", label: "本次关联", money: true }], "当前样本未记录结算分摊")}
      {table("付款关联发票", row.invoiceLinks, [{ key: "iNo", label: "发票号码", width: 220 }, { key: "iDate", label: "开票日期" }, { key: "iAmt", label: "含税金额", money: true }, { key: "iLink", label: "本次关联", money: true }], row.invoiceState === "无需发票" ? "本申请无需发票" : "当前样本未记录发票分摊")}
      {table("支付明细", row.payments, [{ key: "no", label: "支付记录", width: 180 }, { key: "paymentDate", label: "支付日期" }, { key: "amount", label: "支付金额", money: true }, { key: "allocatedAmount", label: "本申请分摊", money: true }, { key: "confirmationStatus", label: "确认状态", render: v => window.stdStatusChip(({ confirmed: "已确认", needs_review: "待核对", draft: "草稿" })[v] || v) }], "当前样本未提供可核验的支付分摊明细")}
    </Shell>;
  }
  window.PayApplyDetailScreen = PayApplyDetailScreen;
})();
