// PayManageScreen — 付款管理（按实现端 app/components/finance/payment-management/* 校准的待支付工作台）
// 校准依据：PaymentManagementScreen.vue 四段构图（工具栏 / 5 指标汇总 / 待支付·已付清·全部 SegTab / 分页表格）
// + stores/payment-management.ts 口径：
//   范围     = 只看已批复申请（实现端 status IN approved/已审批/已批复 白名单；设计稿词表加「已付款」——
//              该词表付款后状态改写为已付款，实现端付款后仍是 approved 故无此项）
//   已支付   = Σ 已确认支付记录的申请分摊（仅计 status=已确认，对应实现端 confirmation_status='confirmed'）
//   应付余额 = max(批复金额 − 已支付, 0)，正数标红
//   支付状态 = 批复为 0 / 待支付 / 部分支付 / 已付清 / 超额支付（推导列，非存储字段）
//   回票状态 = 待回票 / 部分回票 / 已回票 / 无需发票（按发票分摊 Σ invoiceLinks.iLink 对批复金额推导；
//              invoiceState 是回票类型输入字段，仅「无需发票」直接决定状态）
// 本页不新建申请（工具栏无新建按钮，同实现端）；行操作=查看付款申请 / 登记支付记录。
// 简化点：实现端「登记支付记录」带申请/金额/项目/分供方预填参数跳新建；设计稿 payRecordForm 暂不消费
// 预填参数（仍原样传 payApplyId 以备表单侧接入），效果等于进入空白新建。
(function () {
  if (window.PayManageScreen) return;

  function PayManageScreen({ params, navigate }) {
    const A = window.APP;
    const DS = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const KitTable = window.KitTable;
    const { Panel, Button, StatusChip } = DS;
    if (!A || !Panel || !KitTable || !KA.SegTab) return null;
    A.use();
    const nav = navigate || (window.DC && window.DC.navigate);
    const UI = () => window.KitUI || { toast: function () {} };

    const [q, setQ] = React.useState("");
    const [proj, setProj] = React.useState("all");
    const [view, setView] = React.useState("due");   // 默认「待支付」（同实现端）

    const r2 = (n) => Math.round(n * 100) / 100;
    const yuan2 = (v) => "¥" + Number(v || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // —— 行口径推导（对齐 stores/payment-management.ts 的 mapRow）——
    const payRecords = A.rows("payRecords");
    const paidOf = (id) => r2(payRecords.filter((z) => z.payApplyId === id && z.status === "已确认").reduce((s, z) => s + (Number(z.amount) || 0), 0));
    const payStatus = (approved, paid) => approved <= 0 ? "批复为 0"
      : paid <= 0 ? "待支付" : paid < approved ? "部分支付" : paid > approved ? "超额支付" : "已付清";
    // 回票状态按发票分摊推导（payment-management.ts 口径）；invoiceState 只有「无需发票」直接决定状态
    const invStatus = (r, approved) => {
      if (r.invoiceState === "无需发票") return "无需发票";
      const linked = r2((r.invoiceLinks || []).reduce((s, l) => s + (Number(l.iLink) || 0), 0));
      return linked <= 0 ? "待回票" : approved > 0 && linked < approved ? "部分回票" : "已回票";
    };

    const base = A.rows("payApplies")
      .filter((r) => ["已审批", "已批复", "已付款"].includes(r.status))   // 只看已批复（白名单，表单新写入的 草稿/已提交 不进本工作台）
      .map((r) => {
        const approved = r2(Number(r.approvedAmount) || 0);
        const paid = paidOf(r.id);
        const p = r.projectId ? A.get("projects", r.projectId) : null;
        const s = r.supplierId ? A.get("suppliers", r.supplierId) : null;
        return {
          id: r.id, no: r.no || "", name: r.name || "", bizType: r.bizType || "",
          projectId: r.projectId || null, projectName: p ? p.name : "公司付款",
          supplierId: r.supplierId || null, supplierName: s ? s.name : "未指定收款单位",
          approvedAmount: approved, paidAmount: paid,
          dueAmount: r2(Math.max(approved - paid, 0)),
          paymentStatus: payStatus(approved, paid),
          invoiceStatus: invStatus(r, approved),
          applyDate: r.applyDate || "",
        };
      });

    // —— 项目筛选选项（从范围内行收集，中文排序，同实现端 projectOptions）——
    const projOptions = [{ key: "all", label: "全部项目" }].concat(
      base.filter((r) => r.projectId)
        .reduce((acc, r) => (acc.some((o) => o.key === r.projectId) ? acc : acc.concat({ key: r.projectId, label: r.projectName })), [])
        .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")));

    // —— 项目 + 关键字过滤（搜索键=名称/编号/项目/收款单位/业务类型，同实现端 scopedRows）——
    const kw = q.trim().toLowerCase();
    const scoped = base.filter((r) => {
      if (proj !== "all" && r.projectId !== proj) return false;
      if (!kw) return true;
      return [r.no, r.name, r.projectName, r.supplierName, r.bizType]
        .some((v) => String(v || "").toLowerCase().includes(kw));
    });

    // —— 业务态视图（带计数，同实现端 viewTabs / filteredRows）——
    const tabs = [
      { key: "due", label: "待支付", count: scoped.filter((r) => r.dueAmount > 0).length },
      { key: "paid", label: "已付清", count: scoped.filter((r) => r.paymentStatus === "已付清").length },
      { key: "all", label: "全部", count: scoped.length },
    ];
    const shown = view === "due" ? scoped.filter((r) => r.dueAmount > 0)
      : view === "paid" ? scoped.filter((r) => r.paymentStatus === "已付清")
      : scoped;

    // —— 汇总（按当前视图行计算，同实现端 summary）——
    const sum = shown.reduce((acc, r) => ({
      count: acc.count + 1,
      approved: r2(acc.approved + r.approvedAmount),
      paid: r2(acc.paid + r.paidAmount),
      due: r2(acc.due + r.dueAmount),
      dueCount: acc.dueCount + (r.dueAmount > 0 ? 1 : 0),
    }), { count: 0, approved: 0, paid: 0, due: 0, dueCount: 0 });

    // —— chip 色调（同实现端 paymentStatusClass / invoiceStatusClass）——
    const payTone = (v) => v === "已付清" ? "ok" : v === "部分支付" ? "brand" : v === "超额支付" ? "danger" : "warn";
    const invTone = (v) => (v === "已回票" || v === "无需发票") ? "ok" : v === "部分回票" ? "brand" : "warn";
    const chip = (v, tone) => (StatusChip ? <StatusChip tone={tone}>{v}</StatusChip> : v);

    const columns = [
      { key: "name", label: "付款申请", width: 230, render: (v, r) => (
        // 两行单元：申请名称(link) + mono 编号（同实现端 #application 插槽）
        <button type="button" onClick={() => nav && nav("payApplyForm", { id: r.id })}
          style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", textAlign: "left", display: "block" }}>
          <span style={{ display: "block", color: "var(--brand)", fontWeight: 700 }}>{v || "未命名申请"}</span>
          <span style={{ display: "block", marginTop: 2, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-faint)" }}>{r.no || "未编号"}</span>
        </button>
      ) },
      { key: "projectName", label: "项目", width: 160, render: (v, r) => (
        r.projectId ? <KA.EntityLink type="project" id={r.projectId} label={v} /> : <span>{v}</span>) },
      { key: "supplierName", label: "收款单位", width: 190, render: (v, r) => (
        r.supplierId ? <KA.EntityLink type="supplier" id={r.supplierId} label={v} /> : <span>{v}</span>) },
      { key: "bizType", label: "业务类型", width: 150 },
      { key: "approvedAmount", label: "批复金额", width: 136, align: "right", money: true },
      { key: "paidAmount", label: "已支付", width: 136, align: "right", money: true },
      { key: "dueAmount", label: "应付余额", width: 136, align: "right", render: (v) => (
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: v > 0 ? "var(--danger-ink)" : "var(--ink)" }}>{yuan2(v)}</span>) },
      { key: "invoiceStatus", label: "回票状态", width: 104, render: (v) => chip(v, invTone(v)) },
      { key: "paymentStatus", label: "支付状态", width: 104, render: (v) => chip(v, payTone(v)) },
      { key: "applyDate", label: "申请日期", width: 116, mono: true },
      { key: "act", label: "操作", width: 56, align: "center", render: (v, r) => (
        KA.RowActionMenu ? <KA.RowActionMenu label={(r.name || r.no) + "付款操作"} items={[
          { key: "application", label: "查看付款申请", onSelect: () => nav && nav("payApplyForm", { id: r.id }) },
          { key: "payment", label: "登记支付记录", onSelect: () => nav && nav("payRecordForm", { payApplyId: r.id }) },
        ]} /> : null) },
    ];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {/* 工具栏（实现端：标题+副标题 / 项目筛选 / 搜索 / 刷新 / 「支付记录」入口；本页不放新建） */}
        <Panel padding={0} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 16px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>付款管理</div>
            <div style={{ marginTop: 2, fontSize: 11, color: "var(--ink-faint)" }}>待支付工作台 · 批复金额与银行实际支付分开核对</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {KA.SelectFilter && <KA.SelectFilter label="项目" options={projOptions} value={proj} onChange={setProj} minWidth={160} />}
            {KA.SearchInput && <KA.SearchInput value={q} onChange={setQ} placeholder="搜索申请名称、编号或收款单位" width={240} />}
            <Button icon="refresh-cw" onClick={() => UI().toast("已刷新")}>刷新</Button>
            <Button variant="primary" icon="list-checks" onClick={() => nav && nav("payRecord", {})}>支付记录</Button>
          </div>
        </Panel>

        {/* 5 指标汇总（同实现端 PaymentManagementSummary，公式挂 ⓘ 提示） */}
        {KA.MetricGrid && KA.Metric && (
          <KA.MetricGrid cols={5}>
            <KA.Metric label="已批复申请" value={sum.count + " 笔"} formula="当前筛选范围内的已批复付款申请数量" />
            <KA.Metric label="批复金额" value={yuan2(sum.approved)} formula="Σ 付款申请.批复金额" />
            <KA.Metric label="已支付" value={yuan2(sum.paid)} tone="ok" formula="Σ 已确认支付记录的申请分摊金额" />
            <KA.Metric label="应付余额" value={yuan2(sum.due)} tone="danger" formula="Σ max(批复金额 − 已确认支付分摊, 0)" />
            <KA.Metric label="待支付笔数" value={sum.dueCount + " 笔"} tone="brand" formula="应付余额大于 0 的申请数量" />
          </KA.MetricGrid>
        )}

        {/* 付款状态视图（待支付 / 已付清 / 全部，带计数） */}
        <Panel padding={0} style={{ padding: "0 12px" }}>
          <KA.SegTab tabs={tabs} active={view} onChange={setView} />
        </Panel>

        {/* 分页表格（KitTable 自带分页条，同实现端 10 条/页） */}
        <KitTable
          columns={columns} rows={shown} pageSize={10} minRows={10} tableMinWidth={1560}
          empty={(
            <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <b style={{ fontSize: 14, color: "var(--ink)" }}>当前范围没有付款申请</b>
              <span>本工作台只展示已批复申请；审批中的申请请到付款申请页面处理。</span>
            </span>
          )}
        />
      </div>
    );
  }

  window.PayManageScreen = PayManageScreen;
})();
