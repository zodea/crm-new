// TargetCostListScreen — 目标成本列表（预算档案，四级金额链源头）：EntityListScreen meta 一份生成整页。
// 每项目 1 份目标成本；「已签合同金额」为金额穿透链 → 分包合同列表带本项目预筛（批B 铁律④）；
// 计划利润率为派生列(plannedProfit/incomeAmount)不进表单；名称列蓝链 → targetCostDetail 树表明细。
(function () {
  if (window.TargetCostListScreen) return;

  function TargetCostListScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;

    const projects = A.rows("projects");
    const projName = (id) => ((A.get("projects", id) || {}).name) || id;

    const meta = {
      entity: "targetCost",
      title: "目标成本",
      coll: "targetCosts",
      columns: [
        { key: "name", label: "目标成本名称", width: 230,
          render: (v, r) => (
            <button type="button" title={"打开 " + (v || "目标成本")}
              onClick={(e) => { e.stopPropagation(); if (window.DC) window.DC.navigate("targetCostDetail", { id: r.id }); }}
              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
              style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", textAlign: "left",
                color: "var(--brand)", fontWeight: 600, fontSize: "inherit", fontFamily: "inherit" }}>{v}</button>
          ) },
        { key: "projectId", label: "项目名称", width: 150,
          render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => projName(id),
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "incomeAmount", label: "收入合同金额", money: true, align: "right", width: 130 },
        { key: "plannedProfit", label: "计划利润", money: true, align: "right", width: 120 },
        // 金额穿透（批B 铁律④）：已签合同金额可点 → 分包合同列表带「本项目」预筛
        { key: "signedAmount", label: "已签合同金额", money: true, align: "right", width: 130,
          render: (v, r) => <KA.MoneyLink value={v} title="查看本项目支出合同" onClick={() => window.DC.navigate("subContract", { project: r.projectId })} /> },
        { key: "incTotal", label: "目标成本·含税合价", money: true, align: "right", width: 150 },
        { key: "excTotal", label: "不含税", money: true, align: "right", width: 130 },
        { key: "tax", label: "税金", money: true, align: "right", width: 120 },
        { key: "profitRate", label: "计划利润率", noForm: true, form: false, align: "right", width: 100,
          render: (v, r) => {
            const inc = Number(r.incomeAmount) || 0;
            return (
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                {inc ? ((Number(r.plannedProfit) || 0) / inc * 100).toFixed(1) + "%" : "—"}
              </span>
            );
          } },
      ],
      views: [{ key: "all", label: "全部" }],
      defaultView: "all",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
      ],
      searchKeys: ["name"],
      summary: (rows) => [
        { label: "目标成本含税合价总和", value: rows.reduce((s, r) => s + (Number(r.incTotal) || 0), 0) },
        { label: "已签合同金额总和", value: rows.reduce((s, r) => s + (Number(r.signedAmount) || 0), 0) },
        { label: "计划利润总和", value: rows.reduce((s, r) => s + (Number(r.plannedProfit) || 0), 0) },
      ],
      onRowOpen: (r) => window.DC && window.DC.navigate("targetCostDetail", { id: r.id }),
      newDefaults: () => ({ incomeAmount: 0, plannedProfit: 0, signedAmount: 0, incTotal: 0, excTotal: 0, tax: 0 }),
      tableMinWidth: 1560,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.TargetCostListScreen = TargetCostListScreen;
})();
