// ReimburseScreen — 费用报销列表（资金域批B）：EntityListScreen meta 一份生成整页。
// 口径：projectId=null 即「公司/个人开支」（灰字非链），项目筛选下拉专设 none 项承接；「已付款总和」只累计 status==="已付款" 的行。
// fromParams：params.project → projectId 预筛（项目详情金额穿透落点），label 解析为项目中文名。
(function () {
  if (window.ReimburseScreen) return;

  function ReimburseScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};
    const projects = A.rows("projects");
    const statusTone = { "审批中": "neutral", "已审批": "brand", "已付款": "ok" };

    const meta = {
      entity: "reimburse",
      title: "费用报销",
      coll: "reimburses",
      columns: [
        { key: "no", label: "报销单号", width: 140, mono: true },
        { key: "applicant", label: "报销人", width: 100 },
        { key: "projectId", label: "归属", width: 150,
          render: (v) => (v ? <KA.EntityLink type="project" id={v} /> : <span style={{ color: "var(--ink-faint)" }}>公司/个人开支</span>),
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "category", label: "费用类别", width: 110,
          form: { type: "select", options: ["差旅费", "办公费", "招待费", "交通费", "水电费", "零星材料"] } },
        { key: "amount", label: "报销金额", width: 120, money: true, align: "right" },
        { key: "date", label: "报销日期", width: 110, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 96,
          render: (v) => (StatusChip ? <StatusChip tone={statusTone[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["审批中", "已审批", "已付款"] } },
        { key: "note", label: "备注", width: 160 },
      ],
      views: [
        { key: "pending", label: "审批中", filter: (r) => r.status === "审批中" },
        { key: "approved", label: "已审批", filter: (r) => r.status === "已审批" },
        { key: "paid", label: "已付款", filter: (r) => r.status === "已付款" },
        { key: "all", label: "全部" },
      ],
      defaultView: "pending",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, { key: "none", label: "公司/个人" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => (val === "none" ? !r.projectId : r.projectId === val) },
      ],
      searchKeys: ["no", "applicant", "note"],
      summary: (rows) => [
        { label: "报销金额总和", value: Math.round(rows.reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100 },
        { label: "已付款总和", value: Math.round(rows.reduce((s, r) => s + (r.status === "已付款" ? (r.amount || 0) : 0), 0) * 100) / 100 },
      ],
      fromParams: (p) => {
        if (!p.project) return null;
        const proj = A.get("projects", p.project);
        return { label: "项目：" + (proj ? proj.name : p.project), filter: (r) => r.projectId === p.project };
      },
      newDefaults: () => ({ status: "审批中" }),
      tableMinWidth: 1240,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.ReimburseScreen = ReimburseScreen;
})();
