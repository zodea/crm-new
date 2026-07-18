// OwnerChangeScreen — 甲方变洽签台账（收入侧：变更/签证/洽商，四档 草稿→已上报→已打回/已签证）：EntityListScreen meta 一份生成整页。
// 口径：已签证才进变更后合同额；合同 select 只列施工合同（甲方变洽签只挂收入侧主合同）；defaultView=已签证（台账态）。
// fromParams 承接穿透：params.contract → contractId 预筛（label 带合同名）；否则 params.project → projectId 预筛。
// 2026-07-18 表单补全轮：新增/编辑改整页表单（kit/forms/OwnerDocForms.jsx），对标红圈+grill决议
(function () {
  if (window.OwnerChangeScreen) return;

  function OwnerChangeScreen({ params, navigate }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const sgContracts = A.rows("contracts").filter((c) => c.kind === "施工");
    const STATUS_TONE = { "草稿": "neutral", "已上报": "brand", "已打回": "danger", "已签证": "ok" };

    const meta = {
      entity: "ownerChange",
      title: "甲方变洽签",
      coll: "ownerChanges",
      columns: [
        { key: "no", label: "变更编号", width: 140, mono: true },
        { key: "name", label: "变更名称", width: 220, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "contractId", label: "施工合同", width: 220, render: (v) => <KA.EntityLink type="contract" id={v} />,
          form: { type: "select", options: sgContracts.map((c) => c.name),
            toLabel: (id) => { const c = A.get("contracts", id); return c ? c.name : id; },
            toValue: (name) => { const c = sgContracts.find((x) => x.name === name); return c ? c.id : name; } } },
        { key: "type", label: "类型", width: 84, form: { type: "select", options: ["变更", "签证", "洽商"] } },
        { key: "incAmount", label: "含税审定金额", money: true, align: "right", width: 130 },
        { key: "excAmount", label: "无税审定金额", money: true, align: "right", width: 130 },
        { key: "appliedAmount", label: "无税申报金额", money: true, align: "right", width: 130 },
        { key: "date", label: "审定日期", width: 108, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 92,
          render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["草稿", "已上报", "已打回", "已签证"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "signed", label: "已签证", filter: (r) => r.status === "已签证" },
        { key: "submitted", label: "已上报", filter: (r) => r.status === "已上报" },
        { key: "rejected", label: "已打回", filter: (r) => r.status === "已打回" },
        { key: "draft", label: "草稿", filter: (r) => r.status === "草稿" },
      ],
      defaultView: "signed",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
        { key: "type", label: "类型",
          options: [{ key: "all", label: "全部类型" }, { key: "变更", label: "变更" }, { key: "签证", label: "签证" }, { key: "洽商", label: "洽商" }],
          match: (r, val) => r.type === val },
      ],
      searchKeys: ["no", "name"],
      summary: (rows) => [
        { label: "含税审定金额总和", value: Math.round(rows.reduce((s, r) => s + (Number(r.incAmount) || 0), 0) * 100) / 100 },
        { label: "无税申报金额总和", value: Math.round(rows.reduce((s, r) => s + (Number(r.appliedAmount) || 0), 0) * 100) / 100 },
      ],
      fromParams: (p) => {
        if (p.contract) {
          const c = A.get("contracts", p.contract);
          return { label: "合同：" + (c ? c.name : p.contract), filter: (r) => r.contractId === p.contract };
        }
        if (p.project) {
          const pr = A.get("projects", p.project);
          return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project };
        }
        return null;
      },
      newDefaults: () => ({ status: "草稿", type: "变更", appliedAmount: 0 }),
      formRoute: "ownerChangeForm",   // 整页表单（kit/forms/OwnerDocForms.jsx，grill 决议 2026-07-18）
      statusKey: "status",
      tableMinWidth: 1620,
    };
    return <ELS meta={meta} params={params} navigate={navigate} />;
  }

  window.OwnerChangeScreen = OwnerChangeScreen;
})();
