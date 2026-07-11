// MatContractScreen — 材料采购合同列表（支出侧,乙供材管理组）：contracts 仓 kind==="材采" 切片。
// meta 必须在组件 render 内构造（项目/分供方 select 依赖 window.APP 就绪）；「按结算应付余额」为计算列不入表单。
// 红圈口径：默认视图=履约中（非"全部"）；底部汇总=变更后合同金额/累计收票/累计支付三段总和。
(function () {
  if (window.MatContractScreen) return;

  function MatContractScreen() {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const suppliers = A.rows("suppliers");
    const projName = (id) => ((projects.find((p) => p.id === id)) || {}).name;
    const supName = (id) => ((suppliers.find((s) => s.id === id)) || {}).name;
    const STATUS_TONE = { "履约中": "brand", "已签订": "neutral", "已结算": "warn", "已结清": "ok" };

    const meta = {
      entity: "matContract", coll: "contracts", title: "材料采购合同",
      filter: (r) => r.kind === "材采",
      columns: [
        { key: "name", label: "合同名称", width: 230, render: (v, r) => <KA.EntityLink type="contract" id={r.id} label={v} /> },
        { key: "no", label: "合同编号", width: 170, mono: true },
        { key: "projectId", label: "项目名称", width: 130, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name), toLabel: projName, toValue: (name) => ((projects.find((p) => p.name === name)) || {}).id } },
        { key: "supplierId", label: "乙方（分供方）", width: 190, render: (v) => <KA.EntityLink type="supplier" id={v} />,
          form: { type: "select", options: suppliers.map((s) => s.name), toLabel: supName, toValue: (name) => ((suppliers.find((s) => s.name === name)) || {}).id } },
        { key: "amount", label: "含税合同金额", money: true, align: "right" },
        { key: "changed", label: "变更后合同金额", money: true, align: "right" },
        { key: "settled", label: "累计结算", money: true, align: "right" },
        { key: "invoiced", label: "累计收票", money: true, align: "right" },
        // 金额穿透（批B 铁律④）：支付聚合数字可点 → 付款申请列表带「本合同」预筛
        { key: "paid", label: "累计支付", align: "right",
          render: (v, r) => <KA.MoneyLink value={v} title="查看本合同的付款申请" onClick={() => window.DC.navigate("payApply", { contract: r.id })} /> },
        { key: "balance", label: "按结算应付余额", noForm: true, form: false, align: "right",
          render: (v, r) => {
            const b = Math.round(((r.settled || 0) - (r.paid || 0)) * 100) / 100;
            return <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: b > 0 ? "var(--danger-ink)" : "var(--ink)" }}>{"¥" + b.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
          } },
        { key: "signDate", label: "签约日期", mono: true, form: { type: "date" } },
        { key: "status", label: "合同状态", width: 96, render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
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
      filters: [{ key: "proj", label: "项目",
        options: [{ key: "all", label: "全部项目" }].concat(projects.map((p) => ({ key: p.id, label: p.name }))),
        match: (r, val) => r.projectId === val }],
      searchKeys: ["name", "no"],
      leftNav: { title: "全部合同分类", items: [{ key: "all", label: "材料采购合同" }] },
      summary: (rows) => [
        { label: "变更后合同金额总和", value: rows.reduce((s, r) => s + (r.changed || 0), 0) },
        { label: "累计收票金额总和", value: rows.reduce((s, r) => s + (r.invoiced || 0), 0) },
        { label: "累计支付金额总和", value: rows.reduce((s, r) => s + (r.paid || 0), 0) },
      ],
      onRowOpen: (r) => window.DC && window.DC.navigate("contractDetail", { id: r.id }),
      newDefaults: () => ({ kind: "材采", settled: 0, invoiced: 0, paid: 0, doc: { name: "材料采购合同.pdf", pages: 8 } }),
      tableMinWidth: 1640,
    };
    return <ELS meta={meta} />;
  }

  window.MatContractScreen = MatContractScreen;
})();
