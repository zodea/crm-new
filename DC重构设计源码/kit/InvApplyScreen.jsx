// InvApplyScreen — 开票申请列表（收入侧起点：我方给甲方开票）：EntityListScreen meta 一份生成整页。
// 口径：amount=开票金额(含税)、tax=税额、rate 存字符串("9%")；与 contracts.invoiced(施工=累计开票) 大体对齐。
// fromParams：params.contract → 按 contractId 预筛（施工合同「累计开票」金额穿透落点）。
(function () {
  if (window.InvApplyScreen) return;

  function InvApplyScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};
    const projects = A.rows("projects");
    const contracts = A.rows("contracts");
    const statusTone = { "审批中": "neutral", "已审批": "brand", "已开票": "ok" };

    const meta = {
      entity: "invApply",
      title: "开票申请",
      coll: "invApplies",
      columns: [
        { key: "no", label: "申请编号", width: 150, mono: true },
        { key: "projectId", label: "项目名称", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "contractId", label: "施工合同", width: 220, render: (v) => <KA.EntityLink type="contract" id={v} />,
          form: { type: "select", options: contracts.map((c) => c.name),
            toLabel: (id) => { const c = A.get("contracts", id); return c ? c.name : id; },
            toValue: (name) => { const c = contracts.find((x) => x.name === name); return c ? c.id : name; } } },
        { key: "amount", label: "开票金额", width: 130, money: true, align: "right" },
        { key: "tax", label: "税额", width: 130, money: true, align: "right" },
        { key: "rate", label: "税率", width: 80, mono: true },
        { key: "date", label: "申请日期", width: 110, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 96,
          render: (v) => (StatusChip ? <StatusChip tone={statusTone[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["审批中", "已审批", "已开票"] } },
      ],
      views: [
        { key: "pending", label: "审批中", filter: (r) => r.status === "审批中" },
        { key: "approved", label: "已审批", filter: (r) => r.status === "已审批" },
        { key: "done", label: "已开票", filter: (r) => r.status === "已开票" },
        { key: "all", label: "全部" },
      ],
      defaultView: "pending",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
      ],
      searchKeys: ["no"],
      summary: (rows) => [
        { label: "开票金额总和", value: Math.round(rows.reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100 },
        { label: "税额总和", value: Math.round(rows.reduce((s, r) => s + (r.tax || 0), 0) * 100) / 100 },
      ],
      fromParams: (p) => {
        if (!p || !p.contract) return null;
        const c = A.get("contracts", p.contract);
        return { label: "合同：" + ((c && c.name) || p.contract), filter: (r) => r.contractId === p.contract };
      },
      newDefaults: () => ({ status: "审批中", rate: "9%" }),
      tableMinWidth: 1220,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.InvApplyScreen = InvApplyScreen;
})();
