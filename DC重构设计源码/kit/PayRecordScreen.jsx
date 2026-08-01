// PayRecordScreen — 支付记录（按实现端 app/components/finance/FinanceListScreen.vue kind=payment_record 校准）
// 标准单表列表：# / 名称对象(link) / 编号 / 项目 / 关联方类型 / 金额 / 日期 / 状态 / 操作(编辑)；底部金额合计。
// 口径（stores/finance.ts loadList payment_record）：名称=收款方 payee_name（演示数据取 account 收款账户名）；
// 关联方=用途 purpose（演示数据演绎为关联付款申请名）；项目空=「公司付款」；
// 状态=确认状态（已确认/待核对/草稿）——演示数据全为已完成支付、无 status 字段，兜底显示「已确认」。
(function () {
  if (window.PayRecordScreen) return;

  function PayRecordScreen({ params, navigate }) {
    const A = window.APP;
    const Std = window.StdListScreen;
    if (!A || !Std) return null;
    A.use();
    const nav = navigate || (window.DC && window.DC.navigate);
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };

    const rows = A.rows("payRecords").map((r) => ({
      id: r.id,
      name: r.account || "",                                                // 名称=收款方
      no: r.no || "",
      projectName: r.projectId ? projName(r.projectId) : "公司付款",        // SQL COALESCE(project.name, '公司付款')
      partyName: (A.get("payApplies", r.payApplyId) || {}).name || "—",     // 关联方=用途（关联付款申请名）
      amount: Number(r.amount) || 0,
      date: r.date || "",
      status: r.status || "已确认",                                         // 确认状态兜底「已确认」
    }));

    return (
      <Std
        title="支付记录" subtitle="银行实际支付 · 多付款申请分摊 · 人工确认"
        searchPlaceholder="搜索名称、编号、项目或关联方" searchKeys={["no", "name", "projectName", "partyName", "status"]}
        createLabel="新建支付记录" onCreate={() => nav && nav("payRecordForm", {})}
        onRowOpen={(r) => nav && nav("payRecordForm", { id: r.id })}
        columns={[
          { key: "name", label: "名称/对象", minWidth: 220, link: true },
          { key: "no", label: "编号", width: 170, mono: true },
          { key: "projectName", label: "项目", minWidth: 160 },
          { key: "partyName", label: "关联方/类型", minWidth: 180 },
          { key: "amount", label: "金额", width: 140, align: "right", money: true },
          { key: "date", label: "日期", width: 128, mono: true },
          { key: "status", label: "状态", width: 110, render: (v) => window.stdStatusChip(v) },
        ]}
        rows={rows} filters={[{key:"projectName",label:"项目"}, {key:"status",label:"状态"}]} tableMinWidth={1200}
        footerSummary={(list) => ({ label: "金额合计", value: "¥" + list.reduce((s, r) => s + r.amount, 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
      />
    );
  }

  window.PayRecordScreen = PayRecordScreen;
})();
