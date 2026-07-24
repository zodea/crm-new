// PayRecordScreen — 支付记录列表（资金域，实付流水终点）：EntityListScreen meta 一份生成整页。
// 口径：列样=P1 项目详情⑧；payApplyId 只显示付款申请 no 的 mono 文本（付款申请无详情页，不做蓝链）；
// fromParams 穿透优先级 payApply > contract(经付款申请 contractId 间接匹配) > supplier；「本年」视图按 date 前缀 2026。
(function () {
  if (window.PayRecordScreen) return;

  function PayRecordScreen({ params, navigate }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const projects = A.rows("projects");
    const suppliers = A.rows("suppliers");
    const METHODS = ["银行转账", "银行承兑", "对公转账", "现金"];

    const meta = {
      entity: "payRecord",
      title: "支付记录",
      coll: "payRecords",
      formRoute: "payRecordForm",   // 整页表单（grill 决议 2026-07-18）
      columns: [
        { key: "no", label: "支付编号", width: 140, mono: true },
        { key: "date", label: "支付日期", width: 110, mono: true, form: { type: "date" } },
        { key: "amount", label: "支付金额", width: 130, money: true, align: "right" },
        { key: "method", label: "支付方式", width: 110, form: { type: "select", options: METHODS } },
        { key: "account", label: "收款账户", width: 200 },
        { key: "bank", label: "开户行", width: 190 },
        { key: "bankNo", label: "银行账号", width: 170, mono: true },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "supplierId", label: "分供方", width: 170, render: (v) => <KA.EntityLink type="supplier" id={v} />,
          form: { type: "select", options: suppliers.map((s) => s.name),
            toLabel: (id) => { const s = A.get("suppliers", id); return s ? s.name : id; },
            toValue: (name) => { const s = suppliers.find((x) => x.name === name); return s ? s.id : name; } } },
        { key: "payApplyId", label: "关联付款申请", width: 150, noForm: true, form: false,
          render: (v) => { const pa = v && A.get("payApplies", v); return pa
            ? <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{pa.no}</span>
            : <span style={{ color: "var(--ink-faint)" }}>—</span>; } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "year", label: "本年", filter: (r) => !!(r.date && r.date.startsWith("2026")) },
      ],
      defaultView: "all",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
        { key: "method", label: "方式",
          options: [{ key: "all", label: "全部方式" }, ...METHODS.map((m) => ({ key: m, label: m }))],
          match: (r, val) => r.method === val },
      ],
      searchKeys: ["no", "account"],
      summary: (rows) => [
        { label: "支付金额总和", value: Math.round(rows.reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100 },
      ],
      fromParams: (p) => {
        if (p.payApply) {
          const pa = A.get("payApplies", p.payApply);
          return { label: "付款申请：" + (pa ? pa.no : p.payApply), filter: (r) => r.payApplyId === p.payApply };
        }
        if (p.contract) {
          const c = A.get("contracts", p.contract);
          return { label: "合同：" + (c ? c.name : p.contract),
            filter: (r) => { const pa = A.get("payApplies", r.payApplyId); return !!pa && pa.contractId === p.contract; } };
        }
        if (p.supplier) {
          const s = A.get("suppliers", p.supplier);
          return { label: "分供方：" + (s ? ((s.aliases && s.aliases[0]) || s.name) : p.supplier), filter: (r) => r.supplierId === p.supplier };
        }
        return null;
      },
      newDefaults: () => ({ method: "银行转账" }),
      tableMinWidth: 1700,
    };
    return <ELS meta={meta} params={params} navigate={navigate} />;
  }

  window.PayRecordScreen = PayRecordScreen;
})();
