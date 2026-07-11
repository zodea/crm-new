// OmArrivalScreen — 甲供材到货（甲供材管理组；红圈06）：EntityListScreen meta 一份生成整页。
(function () {
  if (window.OmArrivalScreen) return;

  function OmArrivalScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : id; };
    const STATUS_TONE = { "已入库": "ok", "待入库": "warn" };

    const meta = {
      entity: "omArrival", coll: "omArrivals", title: "甲供材到货",
      columns: [
        { key: "no", label: "到货单号", width: 150, mono: true },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name), toLabel: projName, toValue: (name) => ((projects.find((p) => p.name === name)) || {}).id } },
        { key: "material", label: "甲供材料", width: 200, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "qty", label: "到货数量", width: 120, align: "right", render: (v, r) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{Number(v || 0).toLocaleString("zh-CN")} {r.unit}</span>, form: { type: "number" } },
        { key: "unit", label: "单位", width: 74 },
        { key: "warehouse", label: "仓库", width: 140, form: { type: "select", options: ["中心仓", "合和新城现场仓"] } },
        { key: "date", label: "到货日期", width: 118, mono: true, form: { type: "date" } },
        { key: "receiver", label: "收货人", width: 100 },
        { key: "status", label: "入库状态", width: 100, render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["已入库", "待入库"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "stored", label: "已入库", filter: (r) => r.status === "已入库" },
        { key: "pending", label: "待入库", filter: (r) => r.status === "待入库" },
      ],
      defaultView: "stored",
      filters: [{ key: "proj", label: "项目",
        options: [{ key: "all", label: "全部项目" }].concat(projects.map((p) => ({ key: p.id, label: p.name }))),
        match: (r, val) => r.projectId === val }],
      searchKeys: ["no", "material", "receiver"],
      summary: (rows) => [{ label: "到货单数", value: rows.length + " 单" }],
      fromParams: (p) => { if (p && p.project) { const pr = A.get("projects", p.project); return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project }; } return null; },
      newDefaults: () => ({ status: "待入库", warehouse: "中心仓" }),
      tableMinWidth: 1220,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.OmArrivalScreen = OmArrivalScreen;
})();
