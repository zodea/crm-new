// ContractDetailScreen — 批A 底座件④：通用合同详情（1 个组件吃 3 类合同）。
// kind ∈ {施工, 分包, 材采} 决定显隐：摘要四级对账口径（施工=开票/收款，支出侧=收票/支付）、
// 关联单据 Tab（变洽签 仅施工/分包）、基本信息里 甲方(项目 developer)/乙方(EntityLink 分供方)。
// 数据从 window.APP contracts 读（与三张列表/项目详情 Tab 同源）；关联单据行为演示派生 mock（真聚合留 Nuxt）。
// 审批流不挂——只留合同状态 chip（grilling 决议③）。文书预览走 DetailShell.previewDoc。
(function () {
  if (window.ContractDetailScreen) return;
  const UI = () => window.KitUI || { toast: () => {}, formModal: () => {} };
  const yuan = (v) => (v == null ? "—" : "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const STATUS_TONE = { "履约中": "brand", "已签订": "neutral", "已结算": "warn", "已结清": "ok" };

  // 关联单据演示行：按合同累计额确定性拆分（60/40），id 稳定、金额与摘要条对得上
  const split = (total, mk) => {
    if (!total) return [];
    const a = Math.round(total * 0.6 * 100) / 100;
    return [mk(1, a), mk(2, Math.round((total - a) * 100) / 100)];
  };

  function ContractDetailScreen({ params, navigate }) {
    const A = window.APP;
    const KA = window.KitAtoms || {};
    const { StatusChip, Button, Panel } = window.DesignSystem_e3d871 || {};
    if (!A || !window.DetailShell || !window.KitTable || !KA.EntityLink) return null;
    A.use();
    const c = A.get("contracts", params && params.id);
    const [tab, setTab] = React.useState("info");
    if (!c) return <Panel padding={24} style={{ color: "var(--ink-soft)" }}>未找到该合同（可能已被删除）。</Panel>;

    const isCon = c.kind === "施工";
    const proj = A.get("projects", c.projectId);
    const sup = c.supplierId ? A.get("suppliers", c.supplierId) : null;
    const kindLabel = c.kind === "施工" ? "施工合同" : c.kind === "分包" ? "分包合同 · " + (c.subKind || "") : "材料采购合同";
    const invoiceLabel = isCon ? "累计开票" : "累计收票";
    const payLabel = isCon ? "累计收款" : "累计支付";
    const balance = Math.round(((c.settled || 0) - (c.paid || 0)) * 100) / 100;

    const tabs = [
      { key: "info", label: "基本信息" },
      (isCon || c.kind === "分包") && { key: "changes", label: isCon ? "甲方变洽签" : "分包变洽签", count: c.changed > c.amount ? 1 : 0 },
      { key: "settle", label: isCon ? "报量 · 进度结算" : "结算", count: split(c.settled, () => 0).length },
      { key: "invoice", label: isCon ? "开票记录" : "收票登记", count: split(c.invoiced, () => 0).length },
      { key: "pay", label: isCon ? "收款记录" : "付款记录", count: split(c.paid, () => 0).length },
    ].filter(Boolean);

    // 2026-07-18 表单补全轮：编辑改整页表单（kit/forms/ContractForms.jsx，按 kind 分流三条表单路由，红圈 5 分区全字段）
    const editContract = () => {
      const route = { "施工": "conContractForm", "分包": "subContractForm", "材采": "matContractForm" }[c.kind] || "conContractForm";
      navigate(route, { id: c.id });
    };

    // —— Tab 内容 ——
    const infoRow = (label, val) => (
      <div key={label} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: "1px dashed var(--line)", fontSize: 13 }}>
        <span style={{ width: 96, flex: "none", color: "var(--ink-soft)" }}>{label}</span>
        <span style={{ minWidth: 0, fontWeight: 600 }}>{val}</span>
      </div>
    );
    const boqChip = (b, i) => (
      <button key={i} type="button"
        onClick={() => navigate(b.parsed ? "boqList" : "boqImport", { contract: c.name, project: proj ? proj.name : "" })}
        title={b.parsed ? "已拆表 · 打开工程量清单" : "待拆表 · 进入拆表向导"}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--line-strong)", borderRadius: 999,
          padding: "5px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
          background: b.parsed ? "var(--ok-soft)" : "var(--warn-soft)", color: b.parsed ? "var(--ok-ink)" : "var(--warn-ink)" }}>
        {b.name}{b.parsed ? " · 已拆 " + (b.rows || 0) + " 行" : " · 待拆表"}
      </button>
    );
    const body = (() => {
      if (tab === "info") return (
        <Panel padding={18}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 28 }}>
            {infoRow("合同编号", <span style={{ fontFamily: "var(--font-mono)" }}>{c.no}</span>)}
            {infoRow("合同类别", kindLabel)}
            {infoRow("所属项目", <KA.EntityLink type="project" id={c.projectId} />)}
            {isCon
              ? infoRow("甲方（客户）", proj ? proj.developer : "—")
              : infoRow("乙方（分供方）", <KA.EntityLink type="supplier" id={c.supplierId} label={sup ? sup.name : null} />)}
            {infoRow("签约日期", <span style={{ fontFamily: "var(--font-mono)" }}>{c.signDate}</span>)}
            {infoRow("合同状态", StatusChip ? <StatusChip tone={STATUS_TONE[c.status] || "neutral"}>{c.status}</StatusChip> : c.status)}
          </div>
          {isCon && (
            <div style={{ marginTop: 16 }}>
              <KA.SectionHeader mb={8}>工程量清单（清单拆表）</KA.SectionHeader>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(c.boqs || []).map(boqChip)}
                <button type="button" onClick={() => navigate("boqImport", { contract: c.name, project: proj ? proj.name : "" })}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px dashed var(--line-strong)", borderRadius: 999,
                    padding: "5px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: "var(--surface-2)", color: "var(--ink-soft)" }}>
                  ＋ 上传清单并拆表
                </button>
              </div>
            </div>
          )}
        </Panel>
      );
      if (tab === "changes") {
        const delta = Math.round(((c.changed || 0) - (c.amount || 0)) * 100) / 100;
        const rows = delta ? [{ id: c.id + "-bq1", no: (isCon ? "BQ" : "FBQ") + "-001", name: c.name + (isCon ? "变更签证" : "增项洽商"), inc: delta, exc: Math.round(delta / 1.09), date: "2026-04-02", status: "已签证" }] : [];
        return <window.KitTable columns={[
          { key: "no", label: "变更编号", mono: true, width: 110 },
          { key: "name", label: "变更名称", width: 220 },
          { key: "inc", label: "含税审定金额", align: "right", money: true, width: 140 },
          { key: "exc", label: "无税审定金额", align: "right", money: true, width: 140 },
          { key: "date", label: "审定日期", mono: true, width: 110 },
          { key: "status", label: "状态", width: 90, render: (v) => StatusChip ? <StatusChip tone="ok">{v}</StatusChip> : v },
        ]} rows={rows} minRows={5} sum={rows.length ? [{ label: "含税审定金额合计", value: delta }] : undefined}
          footerLeft={"共 " + rows.length + " 条"} empty="暂无变洽签" />;
      }
      if (tab === "settle") {
        const rows = split(c.settled, (i, amt) => ({ id: c.id + "-js" + i, no: "JS-2026-0" + i, period: "第 " + i + " 期", amount: amt, date: i === 1 ? "2026-04-20" : "2026-06-15", status: "已确认" }));
        return <window.KitTable columns={[
          { key: "no", label: "结算编号", mono: true, width: 120 },
          { key: "period", label: "期数", width: 90 },
          { key: "amount", label: "结算金额", align: "right", money: true, width: 140 },
          { key: "date", label: "结算日期", mono: true, width: 110 },
          { key: "status", label: "状态", width: 90, render: (v) => StatusChip ? <StatusChip tone="ok">{v}</StatusChip> : v },
        ]} rows={rows} minRows={5} sum={[{ label: "累计结算", value: c.settled || 0 }]}
          footerLeft={"共 " + rows.length + " 条"} empty="暂无结算记录" />;
      }
      if (tab === "invoice") {
        const rows = split(c.invoiced, (i, amt) => ({ id: c.id + "-fp" + i, no: "0944202600005" + (8700 + i * 37), type: "增值税专用发票", amount: amt, tax: Math.round(amt / 1.13 * 0.13 * 100) / 100, date: i === 1 ? "2026-04-25" : "2026-06-18" }));
        return <window.KitTable columns={[
          { key: "no", label: "发票号码", mono: true, width: 170, render: (v) => <span style={{ fontFamily: "var(--font-mono)", color: "var(--brand)", fontWeight: 600 }}>{v}</span> },
          { key: "type", label: "发票类型", width: 140 },
          { key: "amount", label: "价税合计", align: "right", money: true, width: 140 },
          { key: "tax", label: "税额", align: "right", money: true, width: 120 },
          { key: "date", label: "开票日期", mono: true, width: 110 },
        ]} rows={rows} minRows={5} sum={[{ label: invoiceLabel, value: c.invoiced || 0 }]}
          footerLeft={"共 " + rows.length + " 条"} empty={"暂无" + invoiceLabel.slice(2) + "记录"} />;
      }
      // pay
      const rows = split(c.paid, (i, amt) => ({ id: c.id + "-zf" + i, no: (isCon ? "SK" : "FK") + "-2026-00" + i, amount: amt, method: "银行转账", date: i === 1 ? "2026-05-08" : "2026-06-22", payer: isCon ? (proj ? proj.developer : "甲方") : "广州市瑞航建筑工程有限公司" }));
      return <window.KitTable columns={[
        { key: "no", label: isCon ? "收款单号" : "付款单号", mono: true, width: 130 },
        { key: "amount", label: isCon ? "收款金额" : "支付金额", align: "right", money: true, width: 140 },
        { key: "method", label: "支付方式", width: 100 },
        { key: "payer", label: isCon ? "付款方（甲方）" : "付款方（我方）", width: 220 },
        { key: "date", label: isCon ? "收款日期" : "支付日期", mono: true, width: 110 },
      ]} rows={rows} minRows={5} sum={[{ label: payLabel, value: c.paid || 0 }]}
        footerLeft={"共 " + rows.length + " 条"} empty={"暂无" + payLabel.slice(2) + "记录"} />;
    })();

    return (
      <window.DetailShell
        title={c.name} code={c.no + " · " + kindLabel}
        chips={StatusChip ? <StatusChip tone={STATUS_TONE[c.status] || "neutral"}>{c.status}</StatusChip> : null}
        headerExtra={Button && <Button size="sm" icon="square-pen" onClick={editContract}>编辑</Button>}
        metrics={[
          { label: "含税合同金额", value: yuan(c.amount), formula: "签订时含税合价" },
          { label: "变更后合同金额", value: yuan(c.changed), formula: "合同金额 + Σ 变洽签审定额", tone: "brand" },
          { label: "累计结算", value: yuan(c.settled), formula: isCon ? "Σ 报量/进度结算" : "Σ 结算单金额" },
          { label: invoiceLabel, value: yuan(c.invoiced), formula: isCon ? "Σ 我方开出发票" : "Σ 收到发票价税合计" },
          { label: payLabel, value: yuan(c.paid), formula: isCon ? "Σ 甲方回款" : "Σ 实际支付", tone: isCon ? "ok" : "danger" },
          { label: isCon ? "按结算应收余额" : "按结算应付余额", value: yuan(balance), formula: "累计结算 − " + payLabel, tone: balance > 0 ? "danger" : "ok", big: true },
        ]}
        tabs={tabs} activeTab={tab} onTabChange={setTab}
        docs={c.doc ? [c.doc] : []} files={[]}
      >{body}</window.DetailShell>
    );
  }

  window.ContractDetailScreen = ContractDetailScreen;
})();
