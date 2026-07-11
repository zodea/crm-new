// OmTotalScreen — 甲供材总控量（甲供材管理组；红圈06）：EntityListScreen meta 一份生成整页。
// 口径：甲方供货、无采购合同；总控量/已到货/已用/剩余（剩余=总控−已用，计算列）；供货方=项目甲方。
(function () {
  if (window.OmTotalScreen) return;

  function OmTotalScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;

    const projects = A.rows("projects");
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : id; };
    const qtyCell = (v, r) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{Number(v || 0).toLocaleString("zh-CN")} {r.unit}</span>;

    const meta = {
      entity: "omTotal", coll: "omTotals", title: "甲供材总控量",
      columns: [
        { key: "no", label: "总控编号", width: 140, mono: true },
        { key: "projectId", label: "项目", width: 140, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name), toLabel: projName, toValue: (name) => ((projects.find((p) => p.name === name)) || {}).id } },
        { key: "material", label: "甲供材料", width: 200, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "totalQty", label: "总控量", width: 110, align: "right", render: qtyCell, form: { type: "number" } },
        { key: "arrivedQty", label: "已到货", width: 110, align: "right", render: qtyCell, form: { type: "number" } },
        { key: "usedQty", label: "已领用", width: 110, align: "right", render: qtyCell, form: { type: "number" } },
        { key: "remain", label: "剩余可用", width: 110, align: "right", noForm: true, form: false,
          render: (v, r) => { const d = (Number(r.totalQty) || 0) - (Number(r.usedQty) || 0); return <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: d <= 0 ? "var(--danger-ink)" : "var(--ink)" }}>{d.toLocaleString("zh-CN")} {r.unit}</span>; } },
        { key: "unit", label: "单位", width: 70 },
        { key: "party", label: "供货方（甲方）", width: 160 },
      ],
      views: [{ key: "all", label: "全部" }],
      defaultView: "all",
      filters: [{ key: "proj", label: "项目",
        options: [{ key: "all", label: "全部项目" }].concat(projects.map((p) => ({ key: p.id, label: p.name }))),
        match: (r, val) => r.projectId === val }],
      searchKeys: ["no", "material", "party"],
      summary: (rows) => [{ label: "甲供材料项数", value: rows.length + " 项" }],
      fromParams: (p) => { if (p && p.project) { const pr = A.get("projects", p.project); return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project }; } return null; },
      newDefaults: () => ({ arrivedQty: 0, usedQty: 0 }),
      tableMinWidth: 1260,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.OmTotalScreen = OmTotalScreen;
})();
