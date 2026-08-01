// CurrentScreen — 往来收付（按实现端 app/components/finance/FinanceListScreen.vue kind=current 校准）
// 标准单表列表：# / 名称对象(link) / 编号 / 项目 / 关联方类型 / 金额 / 日期 / 状态 / 操作(编辑)；底部金额合计。
// 口径（stores/finance.ts loadList current）：名称=往来单位 counterparty；关联方=收付方向
// （SQL CASE direction 收→「收款」/ 其余→「付款」）；演示数据 currents 无 status 字段，状态兜底「草稿」。
(function () {
  if (window.CurrentScreen) return;

  function CurrentScreen({ params, navigate }) {
    const A = window.APP;
    const Std = window.StdListScreen;
    if (!A || !Std) return null;
    A.use();
    const nav = navigate || (window.DC && window.DC.navigate);
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };

    const rows = A.rows("currents").map((r) => ({
      id: r.id,
      name: r.counterparty || "",                                           // 名称=往来单位
      no: r.no || "",
      projectName: projName(r.projectId),                                   // SQL COALESCE(project.name, '')（公司层面往来=空）
      partyName: r.direction === "收" ? "收款" : "付款",                    // 关联方=收付方向
      amount: Number(r.amount) || 0,
      date: r.date || "",
      status: r.status || "草稿",
    }));

    return (
      <Std
        title="往来收付" subtitle="非合同往来 · 收付方向统一台账"
        searchPlaceholder="搜索名称、编号、项目或关联方" searchKeys={["no", "name", "projectName", "partyName", "status"]}
        createLabel="新建往来收付" onCreate={() => nav && nav("currentForm", {})}
        onRowOpen={(r) => nav && nav("currentForm", { id: r.id })}
        columns={[
          { key: "name", label: "名称/对象", minWidth: 220, link: true },
          { key: "no", label: "编号", width: 170, mono: true },
          { key: "projectName", label: "项目", minWidth: 160 },
          { key: "partyName", label: "关联方/类型", minWidth: 180 },
          { key: "amount", label: "金额", width: 140, align: "right", money: true },
          { key: "date", label: "日期", width: 128, mono: true },
          { key: "status", label: "状态", width: 110, render: (v) => window.stdStatusChip(v) },
        ]}
        rows={rows} filters={[{key:"projectName",label:"项目"}, {key:"name",label:"往来单位"}, {key:"status",label:"状态"}]} tableMinWidth={1200}
        footerSummary={(list) => ({ label: "金额合计", value: "¥" + list.reduce((s, r) => s + r.amount, 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
      />
    );
  }

  window.CurrentScreen = CurrentScreen;
})();
