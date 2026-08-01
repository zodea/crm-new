// InvApplyScreen — 开票申请（按实现端 app/components/finance/FinanceListScreen.vue kind=invoice_application 校准）
// 标准单表列表：# / 名称对象(link) / 编号 / 项目 / 关联方类型 / 金额 / 日期 / 状态 / 操作(编辑)；底部金额合计。
// 口径（stores/finance.ts loadList invoice_application）：名称=申请名称（演示数据仅 kp01 有 name patch，
// 其余兜底「项目名+开票」）；关联方=购方名称快照（buyer_name_snapshot，演示数据仅 kp01 有 buyer patch）；
// 金额=价税合计（amount + tax_amount）。
(function () {
  if (window.InvApplyScreen) return;

  function InvApplyScreen({ params, navigate }) {
    const A = window.APP;
    const Std = window.StdListScreen;
    if (!A || !Std) return null;
    A.use();
    const nav = navigate || (window.DC && window.DC.navigate);
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };

    const rows = A.rows("invApplies").map((r) => ({
      id: r.id,
      name: r.name || (projName(r.projectId) + "开票"),                     // 名称=申请名称，缺省兜底「项目名+开票」
      no: r.no || "",
      projectName: projName(r.projectId),                                   // SQL COALESCE(project.name, '')
      partyName: r.buyer || "",                                             // 关联方=购方名称快照
      amount: (Number(r.amount) || 0) + (Number(r.tax) || 0),               // 金额=价税合计
      date: r.date || "",
      status: r.status || "草稿",
    }));

    return (
      <Std
        title="开票申请" subtitle="收入侧开票起点 · 购方信息提交快照"
        searchPlaceholder="搜索名称、编号、项目或关联方" searchKeys={["no", "name", "projectName", "partyName", "status"]}
        createLabel="新建开票申请" onCreate={() => nav && nav("invApplyForm", {})}
        onRowOpen={(r) => nav && nav("invApplyForm", { id: r.id })}
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

  window.InvApplyScreen = InvApplyScreen;
})();
