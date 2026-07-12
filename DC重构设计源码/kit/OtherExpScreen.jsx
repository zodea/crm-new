// OtherExpScreen — 其他支出合同（红圈11 · 项目上非分包/材料的杂项支出，如机械租赁/检测服务）：EntityListScreen meta 一份生成整页。
// 口径：挂项目；类别机械租赁/检测服务/其他；两档状态 履约中→已结清；defaultView=履约中。
(function () {
  if (window.OtherExpScreen) return;

  function OtherExpScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : id; };
    const STATUS_TONE = { "履约中": "brand", "已结清": "ok" };

    const meta = {
      entity: "otherExp", coll: "otherExps", title: "其他支出合同",
      columns: [
        { key: "no", label: "合同编号", width: 150, mono: true },
        { key: "name", label: "合同名称", width: 210, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "projectId", label: "项目", width: 130, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name), toLabel: projName, toValue: (name) => ((projects.find((p) => p.name === name)) || {}).id } },
        { key: "category", label: "类别", width: 110, form: { type: "select", options: ["机械租赁", "检测服务", "其他"] } },
        { key: "counterparty", label: "对方单位", width: 150 },
        { key: "amount", label: "合同金额", width: 140, money: true, align: "right" },
        { key: "signDate", label: "签订日期", width: 110, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 96, render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["履约中", "已结清"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "active", label: "履约中", filter: (r) => r.status === "履约中" },
        { key: "closed", label: "已结清", filter: (r) => r.status === "已结清" },
      ],
      defaultView: "active",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }].concat(projects.map((p) => ({ key: p.id, label: p.name }))),
          match: (r, val) => r.projectId === val },
        { key: "cat", label: "类别",
          options: [{ key: "all", label: "全部类别" }, { key: "机械租赁", label: "机械租赁" }, { key: "检测服务", label: "检测服务" }, { key: "其他", label: "其他" }],
          match: (r, val) => r.category === val },
      ],
      searchKeys: ["no", "name", "counterparty"],
      summary: (rows) => [
        { label: "合同数", value: rows.length + " 份" },
        { label: "合同金额总和", value: rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) },
      ],
      fromParams: (p) => {
        if (p && p.project) { const pr = A.get("projects", p.project); return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project }; }
        return null;
      },
      newDefaults: () => ({ status: "履约中", amount: 0 }),
      tableMinWidth: 1320,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.OtherExpScreen = OtherExpScreen;
})();
