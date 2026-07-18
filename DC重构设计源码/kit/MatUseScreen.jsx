// MatUseScreen — 材料领用（出库，乙供材管理组；红圈05 材料领用）：EntityListScreen meta 一份生成整页。
// 口径：项目/仓库/领用人/用途；无金额链（出库按数量），底部汇总=领用单数。
(function () {
  if (window.MatUseScreen) return;

  function MatUseScreen({ params, navigate }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;

    const projects = A.rows("projects");
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : id; };

    const meta = {
      entity: "matUse", coll: "matUses", title: "材料领用",
      formRoute: "matUseForm",   // 整页表单（grill 决议 2026-07-18）
      columns: [
        { key: "no", label: "领用单号", width: 150, mono: true },
        { key: "projectId", label: "项目", width: 140, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name), toLabel: projName, toValue: (name) => ((projects.find((p) => p.name === name)) || {}).id } },
        { key: "warehouse", label: "领用仓库", width: 140, form: { type: "select", options: ["中心仓", "合和新城现场仓"] } },
        { key: "material", label: "材料名称", width: 200, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "qty", label: "领用数量", width: 120, align: "right", render: (v, r) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{Number(v || 0).toLocaleString("zh-CN")} {r.unit}</span>, form: { type: "number" } },
        { key: "unit", label: "单位", width: 70 },
        { key: "receiver", label: "领用人", width: 96 },
        { key: "useFor", label: "用途/部位", width: 180 },
        { key: "date", label: "领用日期", width: 108, mono: true, form: { type: "date" } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "center", label: "中心仓", filter: (r) => r.warehouse === "中心仓" },
        { key: "site", label: "现场仓", filter: (r) => r.warehouse !== "中心仓" },
      ],
      defaultView: "all",
      filters: [{ key: "proj", label: "项目",
        options: [{ key: "all", label: "全部项目" }].concat(projects.map((p) => ({ key: p.id, label: p.name }))),
        match: (r, val) => r.projectId === val }],
      searchKeys: ["no", "material", "receiver", "useFor"],
      summary: (rows) => [{ label: "领用单数", value: rows.length + " 单" }],
      fromParams: (p) => { if (p && p.project) { const pr = A.get("projects", p.project); return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project }; } return null; },
      newDefaults: () => ({ warehouse: "中心仓" }),
      tableMinWidth: 1360,
    };
    return <ELS meta={meta} params={params} navigate={navigate} />;
  }

  window.MatUseScreen = MatUseScreen;
})();
