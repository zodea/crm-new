// SubContractScreen — 分包合同列表（支出侧，分包及人工组）：EntityListScreen meta 一份生成整页。
// 圈定 contracts 中 kind==="分包"；左侧分类=劳务/专业真过滤；「按结算应付余额」为派生列(settled-paid)不进表单；
// meta 必须在组件 render 时构造（项目/乙方 select 依赖 window.APP store 就绪后的 rows()）。
(function () {
  if (window.SubContractScreen) return;

  function SubContractScreen() {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const suppliers = A.rows("suppliers");
    const projName = (id) => ((A.get("projects", id) || {}).name) || id;
    const supName = (id) => ((A.get("suppliers", id) || {}).name) || id;
    const STATUS_TONE = { "履约中": "brand", "已签订": "neutral", "已结算": "warn", "已结清": "ok" };

    const meta = {
      entity: "subContract",
      title: "分包合同",
      coll: "contracts",
      filter: (r) => r.kind === "分包",
      columns: [
        { key: "name", label: "合同名称", width: 230, render: (v, r) => <KA.EntityLink type="contract" id={r.id} label={v} /> },
        { key: "no", label: "合同编号", width: 170, mono: true },
        { key: "projectId", label: "项目名称", width: 150,
          render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => projName(id),
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "supplierId", label: "乙方（分供方）", width: 190,
          render: (v) => <KA.EntityLink type="supplier" id={v} />,
          form: { type: "select", options: suppliers.map((s) => s.name),
            toLabel: (id) => supName(id),
            toValue: (name) => { const s = suppliers.find((x) => x.name === name); return s ? s.id : name; } } },
        { key: "subKind", label: "类别", width: 84, form: { type: "select", options: ["劳务", "专业"] } },
        { key: "amount", label: "含税合价", money: true, align: "right" },
        { key: "changed", label: "变更后合同金额", money: true, align: "right", width: 130 },
        { key: "settled", label: "累计结算", money: true, align: "right" },
        { key: "invoiced", label: "累计收票", money: true, align: "right" },
        { key: "paid", label: "累计支付", money: true, align: "right" },
        { key: "balance", label: "按结算应付余额", noForm: true, form: false, align: "right", width: 130,
          render: (v, r) => { const b = Math.round(((r.settled || 0) - (r.paid || 0)) * 100) / 100;
            return <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: b > 0 ? "var(--danger-ink)" : "var(--ink)" }}>{"¥" + b.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>; } },
        { key: "signDate", label: "签约日期", mono: true, width: 108, form: { type: "date" } },
        { key: "status", label: "合同状态", width: 92,
          render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["履约中", "已签订", "已结算", "已结清"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "active", label: "履约中", filter: (r) => r.status === "履约中" },
        { key: "signed", label: "已签订", filter: (r) => r.status === "已签订" },
        { key: "settled", label: "已结算", filter: (r) => r.status === "已结算" },
        { key: "closed", label: "已结清", filter: (r) => r.status === "已结清" },
      ],
      defaultView: "active",
      leftNav: { title: "分包合同分类", items: [
        { key: "all", label: "全部分包合同" },
        { key: "labor", label: "劳务分包", filter: (r) => r.subKind === "劳务" },
        { key: "pro", label: "专业分包", filter: (r) => r.subKind === "专业" },
      ] },
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
      ],
      searchKeys: ["name", "no"],
      summary: (rows) => [
        { label: "变更后合同金额", value: rows.reduce((s, r) => s + (Number(r.changed) || 0), 0) },
        { label: "累计结算", value: rows.reduce((s, r) => s + (Number(r.settled) || 0), 0) },
        { label: "累计收票", value: rows.reduce((s, r) => s + (Number(r.invoiced) || 0), 0) },
        { label: "累计支付", value: rows.reduce((s, r) => s + (Number(r.paid) || 0), 0) },
      ],
      onRowOpen: (r) => window.DC && window.DC.navigate("contractDetail", { id: r.id }),
      newDefaults: () => ({ kind: "分包", subKind: "劳务", settled: 0, invoiced: 0, paid: 0, doc: { name: "分包合同.pdf", pages: 14 } }),
      tableMinWidth: 1760,
    };
    return <ELS meta={meta} />;
  }

  window.SubContractScreen = SubContractScreen;
})();
