// OtherSettleScreen — 其他支出结算（其他支出合同的结算单）：EntityListScreen meta 一份生成整页。
// 口径：其他支出合同无详情路由 → 合同列纯文本；默认视图=已确认；金额穿透。
// fromParams 承接穿透：params.contract → contractId 预筛（label 带合同名）；否则 params.project → projectId 预筛。
(function () {
  if (window.OtherSettleScreen) return;

  function OtherSettleScreen({ params, navigate }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : id; };
    const otherExps = A.rows("otherExps");
    const expName = (id) => { const c = otherExps.find((x) => x.id === id); return c ? c.name : id; };
    const STATUS_TONE = { "已确认": "ok", "待确认": "warn" };

    const meta = {
      entity: "otherSettle", coll: "otherSettles", title: "其他支出结算",
      formRoute: "otherSettleForm",   // 整页表单（grill 决议 2026-07-18）
      statusKey: "status",
      columns: [
        { key: "no", label: "结算单号", width: 160, mono: true },
        { key: "name", label: "结算名称", width: 210, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "projectId", label: "项目", width: 130, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name), toLabel: projName, toValue: (name) => ((projects.find((p) => p.name === name)) || {}).id } },
        { key: "contractId", label: "其他支出合同", width: 190, render: (v) => <span>{expName(v)}</span>,
          form: { type: "select", options: otherExps.map((c) => c.name), toLabel: expName, toValue: (name) => ((otherExps.find((c) => c.name === name)) || {}).id } },
        { key: "amount", label: "结算金额", width: 150, money: true, align: "right" },
        { key: "date", label: "结算日期", width: 110, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 96, render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["已确认", "待确认"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "confirmed", label: "已确认", filter: (r) => r.status === "已确认" },
        { key: "pending", label: "待确认", filter: (r) => r.status === "待确认" },
      ],
      defaultView: "confirmed",
      filters: [{ key: "proj", label: "项目",
        options: [{ key: "all", label: "全部项目" }].concat(projects.map((p) => ({ key: p.id, label: p.name }))),
        match: (r, val) => r.projectId === val }],
      searchKeys: ["no", "name"],
      summary: (rows) => [
        { label: "结算数", value: rows.length + " 份" },
        { label: "结算金额总和", value: rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) },
      ],
      fromParams: (p) => {
        if (p && p.contract) { const c = otherExps.find((x) => x.id === p.contract); return { label: "合同：" + (c ? c.name : p.contract), filter: (r) => r.contractId === p.contract }; }
        if (p && p.project) { const pr = A.get("projects", p.project); return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project }; }
        return null;
      },
      newDefaults: () => ({ status: "待确认", amount: 0 }),
      tableMinWidth: 1380,
    };
    // 完整原库迁入入口（Q-A03-02，实现端列表头「原结算历史迁入」，需结算写入 + 迁入权限）
    const nav = navigate || (window.DC && window.DC.navigate);
    const { Button } = window.DesignSystem_e3d871 || {};
    return (
      <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
        {Button && <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button size="sm" icon="database-backup" onClick={() => nav && nav("otherSettleImport", {})}>原结算历史迁入</Button>
        </div>}
        <ELS meta={meta} params={params} navigate={navigate} />
      </div>
    );
  }

  window.OtherSettleScreen = OtherSettleScreen;
})();
