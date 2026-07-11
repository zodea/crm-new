// MatRequisitionScreen — 下料单（要料计划，乙供材管理组；红圈05 下料单）：EntityListScreen meta 一份生成整页。
// 口径：默认视图「未完全到货」（红圈：默认业务态）；剩余未到 = 计划量 − 已到货量（计算列，不入表单）。
(function () {
  if (window.MatRequisitionScreen) return;

  function MatRequisitionScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : id; };
    const STATUS_TONE = { "未完全到货": "warn", "已齐套": "ok", "已关闭": "neutral" };
    const qtyCell = (v, r) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{Number(v || 0).toLocaleString("zh-CN")} {r.unit}</span>;

    const meta = {
      entity: "matRequisition", coll: "matRequisitions", title: "下料单",
      columns: [
        { key: "no", label: "下料单编号", width: 150, mono: true },
        { key: "projectId", label: "项目", width: 140, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name), toLabel: projName, toValue: (name) => ((projects.find((p) => p.name === name)) || {}).id } },
        { key: "material", label: "材料名称", width: 210, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "planQty", label: "计划量", width: 120, align: "right", render: qtyCell, form: { type: "number" } },
        { key: "arrivedQty", label: "已到货量", width: 120, align: "right", render: qtyCell, form: { type: "number" } },
        { key: "remain", label: "剩余未到", width: 120, align: "right", noForm: true, form: false,
          render: (v, r) => { const d = (Number(r.planQty) || 0) - (Number(r.arrivedQty) || 0); return <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: d > 0 ? "var(--warn-ink)" : "var(--ok-ink)" }}>{d.toLocaleString("zh-CN")} {r.unit}</span>; } },
        { key: "unit", label: "单位", width: 70 },
        { key: "applicant", label: "申请人", width: 96 },
        { key: "date", label: "申请日期", width: 108, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 100, render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["未完全到货", "已齐套", "已关闭"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "open", label: "未完全到货", filter: (r) => r.status === "未完全到货" },
        { key: "full", label: "已齐套", filter: (r) => r.status === "已齐套" },
      ],
      defaultView: "open",
      filters: [{ key: "proj", label: "项目",
        options: [{ key: "all", label: "全部项目" }].concat(projects.map((p) => ({ key: p.id, label: p.name }))),
        match: (r, val) => r.projectId === val }],
      searchKeys: ["no", "material", "applicant"],
      summary: (rows) => [
        { label: "下料单数", value: rows.length + " 单" },
        { label: "未完全到货", value: rows.filter((r) => r.status === "未完全到货").length + " 单" },
      ],
      fromParams: (p) => { if (p && p.project) { const pr = A.get("projects", p.project); return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project }; } return null; },
      newDefaults: () => ({ status: "未完全到货", arrivedQty: 0 }),
      tableMinWidth: 1360,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.MatRequisitionScreen = MatRequisitionScreen;
})();
