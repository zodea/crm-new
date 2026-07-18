// OmRequisitionScreen — 甲供材下料单（甲供材管理组；红圈06）：EntityListScreen meta 一份生成整页。
(function () {
  if (window.OmRequisitionScreen) return;

  function OmRequisitionScreen({ params, navigate }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : id; };
    const STATUS_TONE = { "已下单": "brand", "待下单": "warn", "已关闭": "neutral" };

    const meta = {
      entity: "omRequisition", coll: "omRequisitions", title: "甲供材下料单",
      formRoute: "omRequisitionForm",   // 整页表单（grill 决议 2026-07-18）
      statusKey: "status",
      columns: [
        { key: "no", label: "下料单编号", width: 150, mono: true },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name), toLabel: projName, toValue: (name) => ((projects.find((p) => p.name === name)) || {}).id } },
        { key: "material", label: "甲供材料", width: 210, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "planQty", label: "计划量", width: 120, align: "right", render: (v, r) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{Number(v || 0).toLocaleString("zh-CN")} {r.unit}</span>, form: { type: "number" } },
        { key: "unit", label: "单位", width: 74 },
        { key: "applicant", label: "申请人", width: 100 },
        { key: "date", label: "申请日期", width: 118, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 100, render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["待下单", "已下单", "已关闭"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "ordered", label: "已下单", filter: (r) => r.status === "已下单" },
        { key: "todo", label: "待下单", filter: (r) => r.status === "待下单" },
      ],
      defaultView: "all",
      filters: [{ key: "proj", label: "项目",
        options: [{ key: "all", label: "全部项目" }].concat(projects.map((p) => ({ key: p.id, label: p.name }))),
        match: (r, val) => r.projectId === val }],
      searchKeys: ["no", "material", "applicant"],
      summary: (rows) => [{ label: "下料单数", value: rows.length + " 单" }],
      fromParams: (p) => { if (p && p.project) { const pr = A.get("projects", p.project); return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project }; } return null; },
      newDefaults: () => ({ status: "待下单" }),
      tableMinWidth: 1120,
    };
    return <ELS meta={meta} params={params} navigate={navigate} />;
  }

  window.OmRequisitionScreen = OmRequisitionScreen;
})();
