// PayApplyScreen — 付款申请列表（资金域，支出侧）：EntityListScreen meta 一份生成整页，接收 params 供金额穿透预筛。
// 口径：默认视图=待追回发票（invoiceState 驱动，红圈）；实际支付金额>0 时蓝色可点穿透支付记录（payRecord?payApply=行id），0 显示 ¥0.00 普通色但仍可表单编辑。
// 新建流：先选 8 业务类型再出表单（mock 级显隐：公司付款不含项目；管理费/项目费用/公司付款不含收款单位；仅 有合同-* 与 预付款 含关联合同）。
(function () {
  if (window.PayApplyScreen) return;

  const BIZ_TYPES = ["有合同-人工", "有合同-材料", "有合同-分包", "无合同-零星采购", "预付款", "管理费", "项目费用", "公司付款"];

  function PayApplyScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};
    const projects = A.rows("projects");
    const suppliers = A.rows("suppliers");
    const contracts = A.rows("contracts");
    const invTone = { "已收票": "ok", "待追回": "warn" };
    const statusTone = { "审批中": "neutral", "已审批": "brand", "已付款": "ok" };
    const yuan2 = (n) => "¥" + (Number(n) || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sum2 = (rows, k) => Math.round(rows.reduce((s, r) => s + (r[k] || 0), 0) * 100) / 100;
    const supName = (s) => (s ? ((s.aliases && s.aliases[0]) || s.name) : null);

    const meta = {
      entity: "payApply",
      title: "付款申请",
      coll: "payApplies",
      columns: [
        { key: "no", label: "付款申请编号", width: 150, mono: true, form: { placeholder: "FKSQ-2026-xxxx" } },
        { key: "name", label: "付款申请名称", width: 210 },
        { key: "projectId", label: "项目名称", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "supplierId", label: "收款单位", width: 180, render: (v) => <KA.EntityLink type="supplier" id={v} />,
          form: { type: "select", options: suppliers.map((s) => s.name),
            toLabel: (id) => { const s = A.get("suppliers", id); return s ? s.name : id; },
            toValue: (name) => { const s = suppliers.find((x) => x.name === name); return s ? s.id : name; } } },
        { key: "contractId", label: "关联合同", width: 200, render: (v) => <KA.EntityLink type="contract" id={v} />,
          form: { type: "select", options: contracts.map((c) => c.name),
            toLabel: (id) => { const c = A.get("contracts", id); return c ? c.name : id; },
            toValue: (name) => { const c = contracts.find((x) => x.name === name); return c ? c.id : name; } } },   // 重名取第一个
        { key: "applyAmount", label: "申请金额", width: 130, money: true, align: "right" },
        { key: "approvedAmount", label: "本期批复金额", width: 130, money: true, align: "right" },
        { key: "paidAmount", label: "实际支付金额", width: 130, money: true, align: "right",
          render: (v, r) => {
            const n = Number(v) || 0;
            if (n <= 0) return <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{yuan2(0)}</span>;
            return (
              <button type="button" title="查看支付记录"
                onClick={(e) => { e.stopPropagation(); if (window.DC) window.DC.navigate("payRecord", { payApply: r.id }); }}
                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer",
                  color: "var(--brand)", fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: "inherit" }}>{yuan2(n)}</button>
            );
          } },
        { key: "invoiceState", label: "发票状态", width: 100,
          render: (v) => (StatusChip ? <StatusChip tone={invTone[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["已收票", "待追回"] } },
        { key: "status", label: "支付状态", width: 100,
          render: (v) => (StatusChip ? <StatusChip tone={statusTone[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["审批中", "已审批", "已付款"] } },
        { key: "bizType", label: "业务类型", width: 120, form: false },
        { key: "costName", label: "成本预算", width: 140 },
        { key: "applicant", label: "申请人", width: 90 },
        { key: "applyDate", label: "申请日期", width: 110, mono: true, form: { type: "date" } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "pending", label: "待追回发票", filter: (r) => r.invoiceState === "待追回" },
        { key: "approving", label: "审批中", filter: (r) => r.status === "审批中" },
        { key: "approved", label: "已审批", filter: (r) => r.status === "已审批" },
        { key: "paid", label: "已付款", filter: (r) => r.status === "已付款" },
      ],
      defaultView: "pending",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
        { key: "biz", label: "业务类型",
          options: [{ key: "all", label: "全部类型" }, ...BIZ_TYPES.map((t) => ({ key: t, label: t }))],
          match: (r, val) => r.bizType === val },
      ],
      searchKeys: ["no", "name"],
      summary: (rows) => [
        { label: "申请金额总和", value: sum2(rows, "applyAmount") },
        { label: "本期批复金额总和", value: sum2(rows, "approvedAmount") },
        { label: "实际支付金额总和", value: sum2(rows, "paidAmount") },
      ],
      // 金额穿透落点：合同/分供方详情四级金额链 → 带参预筛（label 解析中文名，可一键摘除）
      fromParams: (p) => {
        if (p && p.contract) {
          const c = A.get("contracts", p.contract);
          return { label: "合同：" + (c ? c.name : p.contract), filter: (r) => r.contractId === p.contract };
        }
        if (p && p.supplier) {
          const s = A.get("suppliers", p.supplier);
          return { label: "分供方：" + (supName(s) || p.supplier), filter: (r) => r.supplierId === p.supplier };
        }
        return null;
      },
      // 新建流：先选业务类型（8 宫格）→ 再按类型出字段表单（mock 级显隐）
      addFlow: ({ UI, coerce, saveNew }) => {
        const toId = (rows, name) => { const r0 = rows.find((x) => x.name === name); return r0 ? r0.id : name; };
        const openForm = (t) => {
          const hasContract = t.indexOf("有合同") === 0 || t === "预付款";
          const noProject = t === "公司付款";
          const noSupplier = t === "管理费" || t === "项目费用" || t === "公司付款";
          const fields = [
            { key: "no", label: "付款申请编号", placeholder: "FKSQ-2026-xxxx" },
            { key: "name", label: "付款申请名称" },
          ];
          if (!noProject) fields.push({ key: "projectId", label: "项目名称", type: "select", options: projects.map((p) => p.name) });
          if (!noSupplier) fields.push({ key: "supplierId", label: "收款单位", type: "select", options: suppliers.map((s) => s.name) });
          if (hasContract) fields.push({ key: "contractId", label: "关联合同", type: "select", options: contracts.map((c) => c.name) });
          fields.push(
            { key: "applyAmount", label: "申请金额", placeholder: "0.00" },
            { key: "costName", label: "成本预算", placeholder: "如 材料费/瓷砖" },
            { key: "applicant", label: "申请人" },
            { key: "applyDate", label: "申请日期", type: "date" },
          );
          UI.formModal({ title: "新建付款申请 · " + t, cols: 2, width: 620, fields,
            onSave: (v) => {
              const o = coerce(v);   // 空值剔除 + money 数值化 + 列 toValue(名→id)
              if (v.projectId) o.projectId = toId(projects, v.projectId);
              if (v.supplierId) o.supplierId = toId(suppliers, v.supplierId);
              if (v.contractId) o.contractId = toId(contracts, v.contractId);
              o.applyAmount = Number(String(v.applyAmount == null ? "" : v.applyAmount).replace(/[^\d.\-]/g, "")) || 0;   // coerce 只认列 money 键，手动兜底更稳
              saveNew({ ...o, bizType: t, status: "审批中", invoiceState: "待追回", approvedAmount: 0, paidAmount: 0 });
            } });
        };
        const m = UI.modal({ title: "新建付款申请 · 选择业务类型", subtitle: "业务类型决定表单字段与后续流转", bodyHTML: "", actions: [{ label: "取消" }] });
        if (!m || !m.body) return;
        const grid = document.createElement("div");
        Object.assign(grid.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" });
        BIZ_TYPES.forEach((t) => {
          const b = document.createElement("button");
          b.type = "button"; b.textContent = t;
          Object.assign(b.style, { border: "1px solid var(--line-strong)", background: "var(--surface-2)", borderRadius: "10px",
            padding: "12px 10px", fontSize: "13px", fontWeight: "600", color: "var(--ink)", cursor: "pointer", textAlign: "center" });
          b.addEventListener("mouseenter", () => { b.style.borderColor = "var(--brand)"; b.style.color = "var(--brand-deep)"; b.style.background = "var(--brand-soft)"; });
          b.addEventListener("mouseleave", () => { b.style.borderColor = "var(--line-strong)"; b.style.color = "var(--ink)"; b.style.background = "var(--surface-2)"; });
          b.addEventListener("click", () => { m.close(); openForm(t); });
          grid.appendChild(b);
        });
        m.body.appendChild(grid);
      },
      newDefaults: () => ({ status: "审批中", invoiceState: "待追回", approvedAmount: 0, paidAmount: 0 }),
      tableMinWidth: 2000,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.PayApplyScreen = PayApplyScreen;
})();
