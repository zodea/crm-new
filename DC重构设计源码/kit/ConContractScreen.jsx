// ConContractScreen — 施工合同列表（收入侧，主合同管理组）：EntityListScreen meta 一份生成整页。
// 收入侧口径：invoiced=累计开票、paid=累计收款、balance=按结算应收余额（settled-paid，正数标红）；
// 甲方列从 projects.developer 反查（施工合同乙方=我方，无 supplierId 列）；meta 在 render 时构造，store 已就绪。
(function () {
  if (window.ConContractScreen) return;

  function ConContractScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};
    const projects = A.rows("projects");
    const statusTone = { "履约中": "brand", "已签订": "neutral", "已结算": "warn", "已结清": "ok" };

    const meta = {
      entity: "conContract",
      title: "施工合同",
      coll: "contracts",
      filter: (r) => r.kind === "施工",
      columns: [
        { key: "name", label: "合同名称", width: 230, render: (v, r) => <KA.EntityLink type="contract" id={r.id} label={v} /> },
        { key: "no", label: "合同编号", width: 170, mono: true },
        { key: "projectId", label: "项目名称", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "client", label: "甲方（客户）", width: 170, noForm: true, form: false,
          render: (v, r) => { const p = A.get("projects", r.projectId); return p ? p.developer : "—"; } },
        { key: "amount", label: "含税合同金额", width: 130, money: true, align: "right" },
        { key: "changed", label: "变更后合同金额", width: 130, money: true, align: "right" },
        { key: "settled", label: "累计结算", width: 130, money: true, align: "right" },
        // 金额穿透（批B 铁律④）：开票/收款聚合数字可点 → 对应单据列表带「本合同」预筛
        { key: "invoiced", label: "累计开票", width: 130, align: "right",
          render: (v, r) => <KA.MoneyLink value={v} title="查看本合同的开票申请" onClick={() => window.DC.navigate("invApply", { contract: r.id })} /> },
        { key: "paid", label: "累计收款", width: 130, align: "right",
          render: (v, r) => <KA.MoneyLink value={v} title="查看本合同的收款登记" onClick={() => window.DC.navigate("receipt", { contract: r.id })} /> },
        { key: "balance", label: "按结算应收余额", width: 130, noForm: true, form: false, align: "right",
          render: (v, r) => {
            const b = Math.round(((r.settled || 0) - (r.paid || 0)) * 100) / 100;
            return <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: b > 0 ? "var(--danger-ink)" : "var(--ink)" }}>{"¥" + b.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
          } },
        { key: "signDate", label: "签约日期", width: 110, mono: true, form: { type: "date" } },
        { key: "status", label: "合同状态", width: 96,
          render: (v) => (StatusChip ? <StatusChip tone={statusTone[v] || "neutral"}>{v}</StatusChip> : v),
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
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
      ],
      searchKeys: ["name", "no"],
      summary: (rows) => [
        { label: "变更后合同金额总和", value: Math.round(rows.reduce((s, r) => s + (r.changed || 0), 0) * 100) / 100 },
        { label: "累计结算总和", value: Math.round(rows.reduce((s, r) => s + (r.settled || 0), 0) * 100) / 100 },
        { label: "累计开票总和", value: Math.round(rows.reduce((s, r) => s + (r.invoiced || 0), 0) * 100) / 100 },
        { label: "累计收款总和", value: Math.round(rows.reduce((s, r) => s + (r.paid || 0), 0) * 100) / 100 },
      ],
      // 批C：支持项目带参预筛（穿透与反向视图共用）
      fromParams: (p) => {
        if (p && p.project) { const pr = projects.find((x) => x.id === p.project); return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project }; }
        return null;
      },
      onRowOpen: (r) => window.DC && window.DC.navigate("contractDetail", { id: r.id }),
      newDefaults: () => ({ kind: "施工", supplierId: null, settled: 0, invoiced: 0, paid: 0, doc: { name: "施工合同正本.pdf", pages: 20 } }),
      tableMinWidth: 1680,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.ConContractScreen = ConContractScreen;
})();
