// ProjPenaltyScreen — 项目罚扣列表（支出侧：对分供方罚款/扣款，结算时抵扣）：EntityListScreen meta 一份生成整页。
// 口径：合同 select 只列非施工合同（罚扣挂分包/采购等支出侧合同，kind!=="施工"）；状态两档 已抵扣→ok / 待抵扣→warn。
// fromParams 穿透优先级 contract > supplier（合同/分供方详情金额穿透落点，label 解析中文名，可一键摘除）。
(function () {
  if (window.ProjPenaltyScreen) return;

  function ProjPenaltyScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const suppliers = A.rows("suppliers");
    const contracts = A.rows("contracts").filter((c) => c.kind !== "施工");
    const supName = (id) => { const s = A.get("suppliers", id); return s ? ((s.aliases && s.aliases[0]) || s.name) : id; };
    const STATUS_TONE = { "已抵扣": "ok", "待抵扣": "warn" };

    const meta = {
      entity: "projPenalty",
      title: "项目罚扣",
      coll: "projPenalties",
      columns: [
        { key: "no", label: "罚扣编号", width: 140, mono: true },
        { key: "reason", label: "罚扣事由", width: 220 },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "contractId", label: "关联合同", width: 220, render: (v) => <KA.EntityLink type="contract" id={v} />,
          form: { type: "select", options: contracts.map((c) => c.name),
            toLabel: (id) => { const c = A.get("contracts", id); return c ? c.name : id; },
            toValue: (name) => { const c = contracts.find((x) => x.name === name); return c ? c.id : name; } } },
        { key: "supplierId", label: "乙方", width: 180, render: (v) => <KA.EntityLink type="supplier" id={v} />,
          form: { type: "select", options: suppliers.map((s) => s.name),
            toLabel: (id) => supName(id),
            toValue: (name) => { const s = suppliers.find((x) => x.name === name); return s ? s.id : name; } } },
        { key: "amount", label: "罚扣金额", width: 130, money: true, align: "right" },
        { key: "date", label: "日期", width: 110, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 92,
          render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["待抵扣", "已抵扣"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "pending", label: "待抵扣", filter: (r) => r.status === "待抵扣" },
        { key: "done", label: "已抵扣", filter: (r) => r.status === "已抵扣" },
      ],
      defaultView: "pending",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
      ],
      searchKeys: ["no", "reason"],
      summary: (rows) => [
        { label: "罚扣金额总和", value: Math.round(rows.reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100 },
        { label: "待抵扣合计", value: Math.round(rows.reduce((s, r) => s + (r.status === "待抵扣" ? (r.amount || 0) : 0), 0) * 100) / 100 },
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
      newDefaults: () => ({ status: "待抵扣" }),
      tableMinWidth: 1440,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.ProjPenaltyScreen = ProjPenaltyScreen;
})();
