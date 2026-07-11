// PayManageScreen — 付款管理（资金域，出纳工作台）：核对「应该付多少钱」并执行支付。
// 口径：只看已批复的（filter status!=="审批中"）；应付余额=approvedAmount-paidAmount（正数标红）；
// 本页不新建申请（addFlow 拦截提示去「付款申请」），数据同 payApplies 一仓两视图。
(function () {
  if (window.PayManageScreen) return;

  function PayManageScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};
    const projects = A.rows("projects");
    const suppliers = A.rows("suppliers");
    const supplierName = (s) => (s.aliases && s.aliases[0]) || s.name;
    const invTone = { "已收票": "ok", "待追回": "warn" };
    const fmt = (n) => "¥" + (Math.round(n * 100) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const meta = {
      entity: "payManage",
      title: "付款管理",
      coll: "payApplies",
      filter: (r) => r.status !== "审批中",
      columns: [
        { key: "no", label: "编号", width: 150, mono: true },
        { key: "name", label: "名称", width: 210 },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "supplierId", label: "收款单位", width: 180, render: (v) => <KA.EntityLink type="supplier" id={v} />,
          form: { type: "select", options: suppliers.map(supplierName),
            toLabel: (id) => { const s = A.get("suppliers", id); return s ? supplierName(s) : id; },
            toValue: (name) => { const s = suppliers.find((x) => supplierName(x) === name || x.name === name); return s ? s.id : name; } } },
        { key: "approvedAmount", label: "批复金额", width: 130, money: true, align: "right" },
        { key: "paidAmount", label: "已支付", width: 130, money: true, align: "right" },
        { key: "due", label: "应付余额", width: 130, noForm: true, form: false, align: "right",
          render: (v, r) => {
            const d = Math.round(((r.approvedAmount || 0) - (r.paidAmount || 0)) * 100) / 100;
            return <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: d > 0 ? "var(--danger-ink)" : "var(--ink)" }}>{fmt(d)}</span>;
          } },
        { key: "invoiceState", label: "发票状态", width: 96,
          render: (v) => (StatusChip ? <StatusChip tone={invTone[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["已收票", "待追回"] } },
        { key: "applyDate", label: "申请日期", width: 110, mono: true, form: { type: "date" } },
      ],
      views: [
        { key: "due", label: "待支付", filter: (r) => (r.approvedAmount || 0) > (r.paidAmount || 0) },
        { key: "done", label: "已付清", filter: (r) => r.paidAmount > 0 && r.paidAmount >= r.approvedAmount },
        { key: "all", label: "全部" },
      ],
      defaultView: "due",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
      ],
      searchKeys: ["no", "name"],
      summary: (rows) => [
        { label: "批复金额总和", value: Math.round(rows.reduce((s, r) => s + (r.approvedAmount || 0), 0) * 100) / 100 },
        { label: "已支付总和", value: Math.round(rows.reduce((s, r) => s + (r.paidAmount || 0), 0) * 100) / 100 },
        { label: "应付余额合计", value: Math.round(rows.reduce((s, r) => s + Math.max(0, (r.approvedAmount || 0) - (r.paidAmount || 0)), 0) * 100) / 100 },
      ],
      // 金额穿透落点（同付款申请）：合同/分供方维度带参预筛
      fromParams: (p) => {
        if (p.contractId) { const c = A.get("contracts", p.contractId); return { label: "合同：" + (c ? c.name : p.contractId), filter: (r) => r.contractId === p.contractId }; }
        if (p.supplierId) { const s = A.get("suppliers", p.supplierId); return { label: "分供方：" + (s ? supplierName(s) : p.supplierId), filter: (r) => r.supplierId === p.supplierId }; }
        return null;
      },
      newDefaults: () => ({ bizType: "有合同-分包", contractId: null, applyAmount: 0, approvedAmount: 0, paidAmount: 0, invoiceState: "待追回", status: "已审批", costName: "", applicant: "", payDate: "" }),
      addFlow: ({ UI }) => UI.toast("请到「付款申请」新建；本页只核对与执行支付", "warn"),
      tableMinWidth: 1500,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.PayManageScreen = PayManageScreen;
})();
