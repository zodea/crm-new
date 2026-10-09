// CustomerDetailScreen — 批E：客户(甲方)详情，套 DetailShell 通用外壳。
// 客户 = 项目 developer 的实体化（customers.name 与 projects.developer 严格同名）。
// 反向聚合：合作项目(developer 反查) → 施工合同(施工 kind + 项目集) → 收款登记(receipts 项目集)。
// 四级对账口径（收入侧）：合作项目数 / 施工合同额Σ / 累计收款Σ / 应收余额=合同额−收款。
// 数据从 window.APP 读（与客户列表 / 项目详情「客户(甲方)」蓝链同源）；审批流不挂，只留状态 chip。
(function () {
  if (window.CustomerDetailScreen) return;
  const yuan = (v) => (v == null ? "—" : "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const STATUS_TONE = { "履约中": "brand", "已签订": "neutral", "已结算": "warn", "已结清": "ok" };

  function CustomerDetailScreen({ params, navigate }) {
    const A = window.APP;
    const KA = window.KitAtoms;
    const DetailShell = window.DetailShell;
    const { StatusChip, Button } = window.DesignSystem_e3d871 || {};
    if (!A || !DetailShell || !KA || !window.KitTable) return null;
    A.use();

    const cust = A.get("customers", params && params.id) || A.rows("customers")[0];
    if (!cust) return null;

    const custProjects = A.rows("projects").filter((p) => p.developer === cust.name);
    const pidSet = new Set(custProjects.map((p) => p.id));
    const sgContracts = A.rows("contracts").filter((c) => c.kind === "施工" && pidSet.has(c.projectId));
    const receipts = A.rows("receipts").filter((r) => pidSet.has(r.projectId));

    const [tab, setTab] = React.useState("proj");

    const contractSum = sgContracts.reduce((s, c) => s + (c.amount || 0), 0);
    const receiptSum = receipts.reduce((s, r) => s + (r.amount || 0), 0);
    const due = Math.round((contractSum - receiptSum) * 100) / 100;

    // 2026-07-18 表单补全轮：编辑改整页表单（kit/forms/BaseForms.jsx customerForm）
    const editCustomer = () => navigate("customerForm", { id: cust.id });

    // —— Tab 表格：合作项目 / 施工合同 / 收款登记 ——
    const projCols = [
      { key: "name", label: "项目名称", width: 200, render: (v, r) => React.createElement(KA.EntityLink, { type: "project", id: r.id }) },
      { key: "status", label: "状态", width: 90, render: (v) => (StatusChip ? React.createElement(StatusChip, { tone: "brand" }, v) : v) },
      { key: "income", label: "合同额", align: "right", money: true, width: 150 },
      { key: "planEnd", label: "计划竣工", mono: true, width: 120 },
    ];
    const contractCols = [
      { key: "name", label: "合同名称", width: 240, render: (v, r) => React.createElement(KA.EntityLink, { type: "contract", id: r.id }) },
      { key: "amount", label: "含税金额", align: "right", money: true, width: 150 },
      { key: "paid", label: "累计收款", align: "right", money: true, width: 150 },
      { key: "signDate", label: "签约", mono: true, width: 110 },
      { key: "status", label: "状态", width: 90, render: (v) => (StatusChip ? React.createElement(StatusChip, { tone: STATUS_TONE[v] || "neutral" }, v) : v) },
    ];
    const receiptCols = [
      { key: "no", label: "收款单号", mono: true, width: 130 },
      { key: "projectId", label: "项目", width: 160, render: (v) => React.createElement(KA.EntityLink, { type: "project", id: v }) },
      { key: "amount", label: "金额", align: "right", money: true, width: 150 },
      { key: "method", label: "收款方式", width: 110 },
      { key: "date", label: "日期", mono: true, width: 110 },
    ];

    const body = (() => {
      if (tab === "contract") return (
        <window.KitTable columns={contractCols} rows={sgContracts} pageSize={8} tableMinWidth={780}
          sum={[{ label: "施工合同额合计", value: contractSum }, { label: "累计收款合计", value: receiptSum }]}
          empty="该客户暂无施工合同" />
      );
      if (tab === "receipt") return (
        <window.KitTable columns={receiptCols} rows={receipts} pageSize={8} tableMinWidth={700}
          sum={[{ label: "累计收款", value: receiptSum }]} empty="该客户暂无收款登记" />
      );
      return (
        <window.KitTable columns={projCols} rows={custProjects} pageSize={8} tableMinWidth={620}
          empty="该客户暂无在册项目" />
      );
    })();

    return (
      <DetailShell
        title={cust.name} code={cust.taxNo}
        chips={StatusChip ? <StatusChip tone="brand">{custProjects.length} 个在册项目</StatusChip> : null}
        headerExtra={Button && <Button variant="primary" icon="square-pen" onClick={editCustomer}>编辑</Button>}
        metrics={[
          { label: "合作项目", value: custProjects.length + " 个" },
          { label: "施工合同额", value: yuan(contractSum), big: true },
          { label: "累计收款", value: yuan(receiptSum), tone: "ok" },
          { label: "应收余额", value: yuan(due), tone: due > 0 ? "warn" : "ok", formula: "合同额 − 累计收款" },
        ]}
        metricCols={4}
        tabs={[
          { key: "proj", label: "合作项目", count: custProjects.length },
          { key: "contract", label: "施工合同", count: sgContracts.length },
          { key: "receipt", label: "收款登记", count: receipts.length },
        ]}
        activeTab={tab} onTabChange={setTab}
      >{body}</DetailShell>
    );
  }

  window.CustomerDetailScreen = CustomerDetailScreen;
})();
