// ReceiptScreen — 收款登记（按实现端 app/components/finance/FinanceListScreen.vue kind=receipt 校准）
// 标准单表列表：# / 名称对象(link) / 编号 / 项目 / 关联方类型 / 金额 / 日期 / 状态 / 操作(编辑)；底部金额合计。
// 口径（stores/finance.ts loadList receipt）：名称=客户名（SQL COALESCE(customer.name, payer_account)，
// 演示数据取 payer 快照）；关联方=施工合同名；演示数据 receipts 无 status 字段，状态兜底「草稿」。
(function () {
  if (window.ReceiptScreen) return;

  function ReceiptScreen({ params, navigate }) {
    const A = window.APP;
    const Std = window.StdListScreen;
    if (!A || !Std) return null;
    A.use();
    const nav = navigate || (window.DC && window.DC.navigate);
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };

    const rows = A.rows("receipts").map((r) => ({
      id: r.id,
      name: r.payer || "",                                                  // 名称=客户名（甲方付款方）
      no: r.no || "",
      projectName: projName(r.projectId),                                   // SQL COALESCE(project.name, '')
      partyName: (A.get("contracts", r.contractId) || {}).name || "",       // 关联方=施工合同名
      amount: Number(r.amount) || 0,
      date: r.date || "",
      status: r.status || "草稿",
    }));

    return (
      <Std
        title="收款登记" subtitle="合同收款事实 · 真实项目/施工合同/客户"
        searchPlaceholder="搜索名称、编号、项目或关联方" searchKeys={["no", "name", "projectName", "partyName", "status"]}
        createLabel="新建收款登记" onCreate={() => nav && nav("receiptForm", {})}
        onRowOpen={(r) => nav && nav("receiptForm", { id: r.id })}
        columns={[
          { key: "name", label: "名称/对象", minWidth: 220, link: true },
          { key: "no", label: "编号", width: 170, mono: true },
          { key: "projectName", label: "项目", minWidth: 160 },
          { key: "partyName", label: "关联方/类型", minWidth: 180 },
          { key: "amount", label: "金额", width: 140, align: "right", money: true },
          { key: "date", label: "日期", width: 128, mono: true },
          { key: "status", label: "状态", width: 110, render: (v) => window.stdStatusChip(v) },
        ]}
        rows={rows} filters={[{key:"projectName",label:"项目"}, {key:"name",label:"客户"}, {key:"status",label:"状态"}]} tableMinWidth={1200}
        footerSummary={(list) => ({ label: "金额合计", value: "¥" + list.reduce((s, r) => s + r.amount, 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
      />
    );
  }

  window.ReceiptScreen = ReceiptScreen;
})();
