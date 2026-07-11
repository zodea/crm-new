// ReceiptScreen — 收款登记列表（收入侧：甲方回款，关联施工合同）：EntityListScreen meta 一份生成整页。
// 口径：与 contracts.paid(施工=累计收款) 对齐；合同 select 只列施工合同（收款只挂收入侧主合同）；
// fromParams 承接合同详情金额穿透（params.contract → 按 contractId 预筛，label 解析合同名）。
(function () {
  if (window.ReceiptScreen) return;

  function ReceiptScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const projects = A.rows("projects");
    const contracts = A.rows("contracts").filter((c) => c.kind === "施工");

    const meta = {
      entity: "receipt",
      title: "收款登记",
      coll: "receipts",
      columns: [
        { key: "no", label: "收款单号", width: 140, mono: true },
        { key: "projectId", label: "项目名称", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "contractId", label: "施工合同", width: 220, render: (v) => <KA.EntityLink type="contract" id={v} />,
          form: { type: "select", options: contracts.map((c) => c.name),
            toLabel: (id) => { const c = A.get("contracts", id); return c ? c.name : id; },
            toValue: (name) => { const c = contracts.find((x) => x.name === name); return c ? c.id : name; } } },
        { key: "payer", label: "付款方（甲方）", width: 180 },
        { key: "amount", label: "收款金额", width: 130, money: true, align: "right" },
        { key: "method", label: "收款方式", width: 110, form: { type: "select", options: ["银行转账", "银行承兑", "现金"] } },
        { key: "date", label: "收款日期", width: 110, mono: true, form: { type: "date" } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "year", label: "本年", filter: (r) => r.date && r.date.startsWith("2026") },
        { key: "draft", label: "银行承兑", filter: (r) => r.method === "银行承兑" },
      ],
      defaultView: "all",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
      ],
      searchKeys: ["no", "payer"],
      summary: (rows) => [
        { label: "收款金额总和", value: Math.round(rows.reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100 },
      ],
      fromParams: (p) => {
        if (!p.contract) return null;
        const c = A.get("contracts", p.contract);
        return { label: "合同：" + (c ? c.name : p.contract), filter: (r) => r.contractId === p.contract };
      },
      newDefaults: () => ({ method: "银行转账" }),
      tableMinWidth: 1180,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.ReceiptScreen = ReceiptScreen;
})();
