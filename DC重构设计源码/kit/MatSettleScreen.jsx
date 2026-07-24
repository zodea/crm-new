// MatSettleScreen — 材料采购结算（乙供材管理组；红圈05）：EntityListScreen meta 一份生成整页。
// 口径：关联采购合同/分供方/结算金额；默认视图=已确认；金额穿透合同（累计结算）。
(function () {
  if (window.MatSettleScreen) return;

  function MatSettleScreen({ params, navigate }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const suppliers = A.rows("suppliers");
    const matContracts = A.rows("contracts").filter((c) => c.kind === "材采");
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : id; };
    const supName = (id) => { const s = A.get("suppliers", id); return s ? s.name : id; };
    const conName = (id) => { const c = A.get("contracts", id); return c ? c.name : id; };
    const STATUS_TONE = { "已确认": "ok", "待确认": "warn" };

    const meta = {
      entity: "matSettle", coll: "matSettles", title: "材料采购结算",
      formRoute: "matSettleForm",   // 整页表单（grill 决议 2026-07-18）
      statusKey: "status",
      columns: [
        { key: "no", label: "结算单号", width: 160, mono: true },
        { key: "name", label: "结算名称", width: 210, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "projectId", label: "项目", width: 130, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name), toLabel: projName, toValue: (name) => ((projects.find((p) => p.name === name)) || {}).id } },
        { key: "supplierId", label: "分供方", width: 170, render: (v) => <KA.EntityLink type="supplier" id={v} />,
          form: { type: "select", options: suppliers.map((s) => s.name), toLabel: supName, toValue: (name) => ((suppliers.find((s) => s.name === name)) || {}).id } },
        { key: "contractId", label: "采购合同", width: 180, render: (v) => <KA.EntityLink type="contract" id={v} />,
          form: { type: "select", options: matContracts.map((c) => c.name), toLabel: conName, toValue: (name) => ((matContracts.find((c) => c.name === name)) || {}).id } },
        { key: "amount", label: "结算金额", width: 150, money: true, align: "right" },
        { key: "date", label: "结算日期", width: 108, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 96, render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["已确认", "待确认"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "confirmed", label: "已确认", filter: (r) => r.status === "已确认" },
        { key: "pending", label: "待确认", filter: (r) => r.status === "待确认" },
      ],
      defaultView: "confirmed",
      filters: [{ key: "proj", label: "项目",
        options: [{ key: "all", label: "全部项目" }].concat(projects.map((p) => ({ key: p.id, label: p.name }))),
        match: (r, val) => r.projectId === val }],
      searchKeys: ["no", "name"],
      summary: (rows) => [
        { label: "结算单数", value: rows.length + " 单" },
        { label: "结算金额总和", value: rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) },
      ],
      fromParams: (p) => {
        if (p && p.contract) { const c = A.get("contracts", p.contract); return { label: "合同：" + (c ? c.name : p.contract), filter: (r) => r.contractId === p.contract }; }
        if (p && p.project) { const pr = A.get("projects", p.project); return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project }; }
        if (p && p.supplier) { const s = A.get("suppliers", p.supplier); return { label: "分供方：" + (s ? s.name : p.supplier), filter: (r) => r.supplierId === p.supplier }; }
        return null;
      },
      newDefaults: () => ({ status: "待确认", amount: 0 }),
      tableMinWidth: 1420,
    };
    return <ELS meta={meta} params={params} navigate={navigate} />;
  }

  window.MatSettleScreen = MatSettleScreen;
})();
