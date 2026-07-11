// OwnerReportScreen — 甲方报量列表（收入侧：月度申报产值→甲方审定，累计收入来源）：EntityListScreen meta 一份生成整页。
// 合同 select 只列施工合同（报量只挂收入侧主合同）；审减额=派生列(reportedAmount-auditedAmount，仅已审定行)不进表单；
// fromParams 承接穿透：params.contract→按合同预筛，否则 params.project→按项目预筛。默认视图=已申报（待审工作队列）。
(function () {
  if (window.OwnerReportScreen) return;

  function OwnerReportScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const contracts = A.rows("contracts").filter((c) => c.kind === "施工");
    const STATUS_TONE = { "已申报": "brand", "已审定": "ok" };
    const fmt = (n) => "¥" + Number(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const meta = {
      entity: "ownerReport",
      title: "甲方报量",
      coll: "ownerReports",
      columns: [
        { key: "no", label: "报量编号", width: 150, mono: true },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "contractId", label: "施工合同", width: 220, render: (v) => <KA.EntityLink type="contract" id={v} />,
          form: { type: "select", options: contracts.map((c) => c.name),
            toLabel: (id) => { const c = A.get("contracts", id); return c ? c.name : id; },
            toValue: (name) => { const c = contracts.find((x) => x.name === name); return c ? c.id : name; } } },
        { key: "period", label: "期数", width: 90, mono: true },
        { key: "reportedAmount", label: "申报产值", money: true, align: "right" },
        { key: "auditedAmount", label: "审定金额", money: true, align: "right" },
        { key: "diff", label: "审减额", noForm: true, form: false, align: "right", width: 120,
          render: (v, r) => {
            const d = (r.auditedAmount || 0) > 0 ? Math.round(((r.reportedAmount || 0) - (r.auditedAmount || 0)) * 100) / 100 : null;
            if (d == null) return <span style={{ color: "var(--ink-faint)" }}>—</span>;
            return <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: d > 0 ? "var(--danger-ink)" : "var(--ink)" }}>{fmt(d)}</span>;
          } },
        { key: "date", label: "申报日期", width: 108, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 92,
          render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["已申报", "已审定"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "pending", label: "已申报", filter: (r) => r.status === "已申报" },
        { key: "audited", label: "已审定", filter: (r) => r.status === "已审定" },
      ],
      defaultView: "pending",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
      ],
      searchKeys: ["no", "period"],
      summary: (rows) => [
        { label: "申报产值总和", value: Math.round(rows.reduce((s, r) => s + (Number(r.reportedAmount) || 0), 0) * 100) / 100 },
        { label: "审定金额总和", value: Math.round(rows.reduce((s, r) => s + (Number(r.auditedAmount) || 0), 0) * 100) / 100 },
      ],
      fromParams: (p) => {
        if (p.contract) {
          const c = A.get("contracts", p.contract);
          return { label: "合同：" + (c ? c.name : p.contract), filter: (r) => r.contractId === p.contract };
        }
        if (p.project) {
          const pj = A.get("projects", p.project);
          return { label: "项目：" + (pj ? pj.name : p.project), filter: (r) => r.projectId === p.project };
        }
        return null;
      },
      newDefaults: () => ({ status: "已申报", auditedAmount: 0 }),
      tableMinWidth: 1380,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.OwnerReportScreen = OwnerReportScreen;
})();
