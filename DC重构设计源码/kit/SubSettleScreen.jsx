// SubSettleScreen — 分包结算列表（支出侧，分包单据批C）：EntityListScreen meta 一份生成整页。
// 合同 select 只列非施工合同（分包/材采，结算只挂支出侧合同）；状态两档：已确认→ok / 待确认→warn；
// fromParams 承接穿透：params.contract → 按 contractId 预筛，否则 params.supplier → 按 supplierId 预筛。
(function () {
  if (window.SubSettleScreen) return;

  function SubSettleScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const suppliers = A.rows("suppliers");
    const contracts = A.rows("contracts").filter((c) => c.kind !== "施工");
    const supName = (id) => { const s = A.get("suppliers", id); return s ? ((s.aliases && s.aliases[0]) || s.name) : id; };
    const STATUS_TONE = { "已确认": "ok", "待确认": "warn" };
    const TYPES = ["进度结算", "最终结算", "到货结算"];

    const meta = {
      entity: "subSettle",
      title: "分包结算",
      coll: "subSettles",
      columns: [
        { key: "no", label: "结算编号", width: 140, mono: true },
        { key: "name", label: "结算名称", width: 240, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
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
            toLabel: (id) => supName(id),
            toValue: (name) => { const s = suppliers.find((x) => x.name === name); return s ? s.id : name; } } },
        { key: "type", label: "结算类型", width: 100, form: { type: "select", options: TYPES } },
        { key: "amount", label: "结算金额", width: 130, money: true, align: "right" },
        { key: "date", label: "结算日期", width: 110, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 96,
          render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["待确认", "已确认"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "pending", label: "待确认", filter: (r) => r.status === "待确认" },
        { key: "confirmed", label: "已确认", filter: (r) => r.status === "已确认" },
      ],
      defaultView: "pending",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
        { key: "type", label: "结算类型",
          options: [{ key: "all", label: "全部类型" }, ...TYPES.map((t) => ({ key: t, label: t }))],
          match: (r, val) => r.type === val },
      ],
      searchKeys: ["no", "name"],
      summary: (rows) => [
        { label: "结算金额总和", value: Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100 },
      ],
      fromParams: (p) => {
        if (p.contract) {
          const c = A.get("contracts", p.contract);
          return { label: "合同：" + (c ? c.name : p.contract), filter: (r) => r.contractId === p.contract };
        }
        if (p.supplier) return { label: "分供方：" + supName(p.supplier), filter: (r) => r.supplierId === p.supplier };
        return null;
      },
      newDefaults: () => ({ status: "待确认", type: "进度结算" }),
      tableMinWidth: 1660,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.SubSettleScreen = SubSettleScreen;
})();
