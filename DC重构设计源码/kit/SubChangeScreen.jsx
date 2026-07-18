// SubChangeScreen — 分包变洽签列表（支出侧，对分供方的增项/签证/洽商）：EntityListScreen meta 一份生成整页。
// 口径：四档状态同甲方变洽签（草稿/已上报/已打回/已签证，已签证才计入变更后合同额）；关联合同 select 只列非施工合同（分包/材采等支出侧）；
// fromParams 穿透优先级 contract > supplier（合同详情/分供方详情金额穿透落点，label 解析中文名，可一键摘除）。
(function () {
  if (window.SubChangeScreen) return;

  function SubChangeScreen({ params, navigate }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const suppliers = A.rows("suppliers");
    const contracts = A.rows("contracts").filter((c) => c.kind !== "施工");   // 支出侧合同（分包/材采等）
    const STATUS_TONE = { "草稿": "neutral", "已上报": "brand", "已打回": "danger", "已签证": "ok" };

    const meta = {
      entity: "subChange",
      title: "分包变洽签",
      coll: "subChanges",
      formRoute: "subChangeForm",   // 整页表单（grill 决议 2026-07-18）
      statusKey: "status",
      columns: [
        { key: "no", label: "变更编号", width: 140, mono: true },
        { key: "type", label: "类型", width: 84, form: { type: "select", options: ["增项", "签证", "洽商"] } },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "contractId", label: "关联合同", width: 220, render: (v) => <KA.EntityLink type="contract" id={v} />,
          form: { type: "select", options: contracts.map((c) => c.name),
            toLabel: (id) => { const c = A.get("contracts", id); return c ? c.name : id; },
            toValue: (name) => { const c = contracts.find((x) => x.name === name); return c ? c.id : name; } } },
        { key: "supplierId", label: "乙方（分供方）", width: 180, render: (v) => <KA.EntityLink type="supplier" id={v} />,
          form: { type: "select", options: suppliers.map((s) => s.name),
            toLabel: (id) => { const s = A.get("suppliers", id); return s ? s.name : id; },
            toValue: (name) => { const s = suppliers.find((x) => x.name === name); return s ? s.id : name; } } },
        { key: "amount", label: "审批金额", width: 120, money: true, align: "right" },
        { key: "area", label: "变更面积", width: 100, mono: true },
        { key: "audited", label: "实际审定价", width: 120, money: true, align: "right" },
        { key: "date", label: "日期", width: 108, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 92,
          render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["草稿", "已上报", "已打回", "已签证"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "signed", label: "已签证", filter: (r) => r.status === "已签证" },
        { key: "submitted", label: "已上报", filter: (r) => r.status === "已上报" },
        { key: "draft", label: "草稿", filter: (r) => r.status === "草稿" },
        { key: "rejected", label: "已打回", filter: (r) => r.status === "已打回" },
      ],
      defaultView: "signed",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
      ],
      searchKeys: ["no", "type"],
      summary: (rows) => [
        { label: "审批金额总和", value: Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100 },
        { label: "实际审定价总和", value: Math.round(rows.reduce((s, r) => s + (Number(r.audited) || 0), 0) * 100) / 100 },
      ],
      fromParams: (p) => {
        if (p.contract) {
          const c = A.get("contracts", p.contract);
          return { label: "合同：" + (c ? c.name : p.contract), filter: (r) => r.contractId === p.contract };
        }
        if (p.supplier) {
          const s = A.get("suppliers", p.supplier);
          return { label: "分供方：" + (s ? ((s.aliases && s.aliases[0]) || s.name) : p.supplier), filter: (r) => r.supplierId === p.supplier };
        }
        return null;
      },
      newDefaults: () => ({ status: "草稿", type: "增项", audited: 0 }),
      tableMinWidth: 1620,
    };
    return <ELS meta={meta} params={params} navigate={navigate} />;
  }

  window.SubChangeScreen = SubChangeScreen;
})();
