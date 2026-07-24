// OwnerPenaltyScreen — 甲方罚扣单列表（收入侧：甲方对我方罚扣，冲减收入）：EntityListScreen meta 一份生成整页。
// 罚扣金额为负向语义：render 用 danger-ink 加粗 mono 两位小数展示（仍 money 右对齐，表单正常录入正数）；
// 合同 select 只列施工合同（罚扣挂收入侧主合同）；fromParams 承接合同详情穿透（params.contract → contractId 预筛）。
(function () {
  if (window.OwnerPenaltyScreen) return;

  function OwnerPenaltyScreen({ params, navigate }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const contracts = A.rows("contracts").filter((c) => c.kind === "施工");
    const STATUS_TONE = { "已确认": "ok", "申诉中": "warn" };

    const meta = {
      entity: "ownerPenalty",
      title: "甲方罚扣单",
      coll: "ownerPenalties",
      formRoute: "ownerPenaltyForm",   // 整页表单（grill 决议 2026-07-18）
      statusKey: "status",
      columns: [
        { key: "no", label: "罚扣编号", width: 140, mono: true },
        { key: "reason", label: "罚扣事由", width: 240 },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "contractId", label: "施工合同", width: 220, render: (v) => <KA.EntityLink type="contract" id={v} />,
          form: { type: "select", options: contracts.map((c) => c.name),
            toLabel: (id) => { const c = A.get("contracts", id); return c ? c.name : id; },
            toValue: (name) => { const c = contracts.find((x) => x.name === name); return c ? c.id : name; } } },
        { key: "amount", label: "罚扣金额", width: 130, money: true, align: "right",
          render: (v) => (v == null || v === ""
            ? <span style={{ color: "var(--ink-faint)" }}>—</span>
            : <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--danger-ink)" }}>
                {"¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>) },
        { key: "date", label: "日期", width: 110, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 92,
          render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["申诉中", "已确认"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "appealing", label: "申诉中", filter: (r) => r.status === "申诉中" },
        { key: "confirmed", label: "已确认", filter: (r) => r.status === "已确认" },
      ],
      defaultView: "appealing",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
      ],
      searchKeys: ["no", "reason"],
      summary: (rows) => [
        { label: "罚扣金额总和", value: Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100 },
      ],
      fromParams: (p) => {
        if (!p.contract) return null;
        const c = A.get("contracts", p.contract);
        return { label: "合同：" + (c ? c.name : p.contract), filter: (r) => r.contractId === p.contract };
      },
      newDefaults: () => ({ status: "申诉中" }),
      tableMinWidth: 1280,
    };
    return <ELS meta={meta} params={params} navigate={navigate} />;
  }

  window.OwnerPenaltyScreen = OwnerPenaltyScreen;
})();
