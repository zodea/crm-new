// PayApplyScreen — 付款申请（按实现端 app/components/finance/FinanceListScreen.vue kind=payment_application 校准）
// 标准单表列表：# / 名称对象(link) / 编号 / 项目 / 关联方类型 / 金额 / 日期 / 状态 / 操作(编辑)；底部金额合计。
// 口径（stores/finance.ts loadList payment_application）：名称=申请名称；关联方=分供方名兜底业务类型
// （SQL COALESCE(supplier.name, biz_type)）；项目空=「公司付款」；金额=申请金额 apply_amount；日期=申请日期。
(function () {
  if (window.PayApplyScreen) return;

  function PayApplyScreen({ params, navigate }) {
    const A = window.APP;
    const Std = window.StdListScreen;
    if (!A || !Std) return null;
    A.use();
    const UI = () => window.KitUI || { typeSelect: () => Promise.resolve(null) };
    const nav = navigate || (window.DC && window.DC.navigate);
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };

    // 新建三段式第一段（实现端 FinancePaymentTypeStep）：先选 10 类业务类型再进整页表单
    const BIZ_TYPES = ["有合同-合同劳务", "有合同-材料", "有合同-专业分包", "有合同-机械", "有合同-其他",
      "无合同-零星采购", "预付款", "管理费", "项目费用", "公司付款"];
    const openCreate = () => UI().typeSelect({
      title: "选择付款业务类型",
      options: BIZ_TYPES.map((t) => ({ value: t, label: t })),
      defaultValue: "有合同-材料",
    }).then((v) => { if (v != null && nav) nav("payApplyForm", { type: v }); });

    const rows = A.rows("payApplies").map((r) => ({
      id: r.id,
      name: r.name || "",                                                   // 名称=申请名称
      no: r.no || "",
      projectName: r.projectId ? projName(r.projectId) : "公司付款",        // SQL COALESCE(project.name, '公司付款')
      partyName: (A.get("suppliers", r.supplierId) || {}).name || r.bizType || "", // 关联方=分供方名兜底业务类型
      amount: Number(r.applyAmount) || 0,                                   // 金额=申请金额
      date: r.applyDate || "",
      status: r.status || "草稿",
    }));

    return (
      <Std
        title="付款申请" subtitle="10 类业务 · 真实结算/发票勾稽"
        searchPlaceholder="搜索名称、编号、项目或关联方" searchKeys={["no", "name", "projectName", "partyName", "status"]}
        createLabel="新建付款申请" onCreate={openCreate}
        onRowOpen={(r) => nav && nav("payApplyForm", { id: r.id })}
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

  window.PayApplyScreen = PayApplyScreen;
})();
