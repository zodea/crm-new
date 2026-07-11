// MatArrivalScreen — 材料到货（入库，乙供材管理组；红圈05 材料到货）：EntityListScreen meta 一份生成整页。
// 口径：默认视图=已入库；关联下料单/采购合同/仓库；金额四级链（含税到货金额）；蓝链 项目/分供方/合同。
(function () {
  if (window.MatArrivalScreen) return;

  function MatArrivalScreen({ params }) {
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
    const STATUS_TONE = { "已入库": "ok", "待入库": "warn" };

    const meta = {
      entity: "matArrival", coll: "matArrivals", title: "材料到货",
      columns: [
        { key: "no", label: "到货单号", width: 150, mono: true },
        { key: "projectId", label: "项目", width: 130, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name), toLabel: projName, toValue: (name) => ((projects.find((p) => p.name === name)) || {}).id } },
        { key: "material", label: "材料名称", width: 190, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "supplierId", label: "分供方", width: 170, render: (v) => <KA.EntityLink type="supplier" id={v} />,
          form: { type: "select", options: suppliers.map((s) => s.name), toLabel: supName, toValue: (name) => ((suppliers.find((s) => s.name === name)) || {}).id } },
        { key: "contractId", label: "采购合同", width: 180, render: (v) => <KA.EntityLink type="contract" id={v} />,
          form: { type: "select", options: matContracts.map((c) => c.name), toLabel: conName, toValue: (name) => ((matContracts.find((c) => c.name === name)) || {}).id } },
        { key: "qty", label: "到货数量", width: 110, align: "right", render: (v, r) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{Number(v || 0).toLocaleString("zh-CN")} {r.unit}</span>, form: { type: "number" } },
        { key: "unit", label: "单位", width: 66 },
        { key: "amount", label: "含税到货金额", width: 140, money: true, align: "right" },
        { key: "warehouse", label: "仓库", width: 130, form: { type: "select", options: ["中心仓", "合和新城现场仓"] } },
        { key: "date", label: "到货日期", width: 108, mono: true, form: { type: "date" } },
        { key: "receiver", label: "收货人", width: 90 },
        { key: "status", label: "入库状态", width: 96, render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["已入库", "待入库"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "stored", label: "已入库", filter: (r) => r.status === "已入库" },
        { key: "pending", label: "待入库", filter: (r) => r.status === "待入库" },
      ],
      defaultView: "stored",
      filters: [
        { key: "proj", label: "项目", options: [{ key: "all", label: "全部项目" }].concat(projects.map((p) => ({ key: p.id, label: p.name }))), match: (r, val) => r.projectId === val },
        { key: "wh", label: "仓库", options: [{ key: "all", label: "全部仓库" }, { key: "中心仓", label: "中心仓" }, { key: "合和新城现场仓", label: "合和新城现场仓" }], match: (r, val) => r.warehouse === val },
      ],
      searchKeys: ["no", "material"],
      summary: (rows) => [
        { label: "到货单数", value: rows.length + " 单" },
        { label: "含税到货金额总和", value: rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) },
      ],
      fromParams: (p) => {
        if (p && p.project) { const pr = A.get("projects", p.project); return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project }; }
        if (p && p.contract) { const c = A.get("contracts", p.contract); return { label: "合同：" + (c ? c.name : p.contract), filter: (r) => r.contractId === p.contract }; }
        if (p && p.supplier) { const s = A.get("suppliers", p.supplier); return { label: "分供方：" + (s ? s.name : p.supplier), filter: (r) => r.supplierId === p.supplier }; }
        return null;
      },
      newDefaults: () => ({ status: "待入库", amount: 0, warehouse: "中心仓" }),
      tableMinWidth: 1720,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.MatArrivalScreen = MatArrivalScreen;
})();
