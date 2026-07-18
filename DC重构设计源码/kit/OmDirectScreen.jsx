// OmDirectScreen — 甲供材直入直出（甲供材管理组；红圈06）：EntityListScreen meta 一份生成整页。
// 口径：不入库直接用到部位；供货方（甲方）→ 使用部位。
(function () {
  if (window.OmDirectScreen) return;

  function OmDirectScreen({ params, navigate }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;

    const projects = A.rows("projects");
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : id; };

    const meta = {
      entity: "omDirect", coll: "omDirects", title: "甲供材直入直出",
      formRoute: "omDirectForm",   // 整页表单（grill 决议 2026-07-18）
      columns: [
        { key: "no", label: "单据编号", width: 150, mono: true },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name), toLabel: projName, toValue: (name) => ((projects.find((p) => p.name === name)) || {}).id } },
        { key: "material", label: "甲供材料", width: 190, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "qty", label: "数量", width: 110, align: "right", render: (v, r) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{Number(v || 0).toLocaleString("zh-CN")} {r.unit}</span>, form: { type: "number" } },
        { key: "unit", label: "单位", width: 74 },
        { key: "party", label: "供货方（甲方）", width: 160 },
        { key: "useFor", label: "使用部位", width: 190 },
        { key: "date", label: "日期", width: 118, mono: true, form: { type: "date" } },
      ],
      views: [{ key: "all", label: "全部" }],
      defaultView: "all",
      filters: [{ key: "proj", label: "项目",
        options: [{ key: "all", label: "全部项目" }].concat(projects.map((p) => ({ key: p.id, label: p.name }))),
        match: (r, val) => r.projectId === val }],
      searchKeys: ["no", "material", "useFor"],
      summary: (rows) => [{ label: "直入直出单数", value: rows.length + " 单" }],
      fromParams: (p) => { if (p && p.project) { const pr = A.get("projects", p.project); return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project }; } return null; },
      tableMinWidth: 1160,
    };
    return <ELS meta={meta} params={params} navigate={navigate} />;
  }

  window.OmDirectScreen = OmDirectScreen;
})();
