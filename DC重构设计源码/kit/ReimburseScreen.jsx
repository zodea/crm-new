// ReimburseScreen — 费用报销（按实现端 app/components/finance/FinanceListScreen.vue kind=reimbursement 校准）
// 标准单表列表：# / 名称对象(link) / 编号 / 项目 / 关联方类型 / 金额 / 日期 / 状态 / 操作(编辑)；底部金额合计。
// 口径（stores/finance.ts loadList reimbursement）：名称=报销人 applicant；关联方=费用类别 category；
// 项目空=「公司开支」（SQL COALESCE(project.name, '公司开支')）；金额=Σ费用明细（演示数据取头字段 amount）。
(function () {
  if (window.ReimburseScreen) return;

  function ReimburseScreen({ params, navigate }) {
    const A = window.APP;
    const Std = window.StdListScreen;
    if (!A || !Std) return null;
    A.use();
    const nav = navigate || (window.DC && window.DC.navigate);
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };

    const rows = A.rows("reimburses").map((r) => ({
      id: r.id,
      name: r.applicant || "",                                              // 名称=报销人
      no: r.no || "",
      projectName: r.projectId ? projName(r.projectId) : "公司开支",        // SQL COALESCE(project.name, '公司开支')
      partyName: r.category || "",                                          // 关联方=费用类别
      amount: Number(r.amount) || 0,                                        // 金额=报销总额（明细 Σ金额 回写）
      date: r.date || "",
      status: r.status || "草稿",
    }));

    return (
      <Std
        title="费用报销" subtitle="报销头 + 费用明细 · 公司开支允许空项目"
        searchPlaceholder="搜索名称、编号、项目或关联方" searchKeys={["no", "name", "projectName", "partyName", "status"]}
        createLabel="新建费用报销" onCreate={() => nav && nav("reimburseForm", {})}
        onRowOpen={(r) => nav && nav("reimburseForm", { id: r.id })}
        columns={[
          { key: "name", label: "名称/对象", minWidth: 220, link: true },
          { key: "no", label: "编号", width: 170, mono: true },
          { key: "projectName", label: "项目", minWidth: 160 },
          { key: "partyName", label: "关联方/类型", minWidth: 180 },
          { key: "amount", label: "金额", width: 140, align: "right", money: true },
          { key: "date", label: "日期", width: 128, mono: true },
          { key: "status", label: "状态", width: 110, render: (v) => window.stdStatusChip(v) },
        ]}
        rows={rows} filters={[{key:"projectName",label:"项目"}, {key:"name",label:"报销人"}, {key:"status",label:"状态"}]} tableMinWidth={1200}
        footerSummary={(list) => ({ label: "金额合计", value: "¥" + list.reduce((s, r) => s + r.amount, 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
      />
    );
  }

  window.ReimburseScreen = ReimburseScreen;
})();
