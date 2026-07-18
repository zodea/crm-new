// FinalSettleScreen — 最终结算列表（收入侧：与甲方的工程最终结算）：EntityListScreen meta 一份生成整页。
// 集合 finalSettles(批C 轻实体仓)；合同 select 只列施工合同（最终结算挂收入侧主合同）；
// fromParams 承接合同详情穿透（params.contract → 按 contractId 预筛）；默认视图「进行中」= 未审定。
(function () {
  if (window.FinalSettleScreen) return;

  function FinalSettleScreen({ params, navigate }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};
    const projects = A.rows("projects");
    const contracts = A.rows("contracts").filter((c) => c.kind === "施工");
    const STATUS_TONE = { "编制中": "neutral", "已报审": "brand", "已审定": "ok" };

    const meta = {
      entity: "finalSettle",
      title: "最终结算",
      coll: "finalSettles",
      formRoute: "finalSettleForm",   // 整页表单（grill 决议 2026-07-18）
      statusKey: "status",
      columns: [
        { key: "no", label: "结算编号", width: 140, mono: true },
        { key: "name", label: "结算名称", width: 240, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "contractId", label: "施工合同", width: 220, render: (v) => <KA.EntityLink type="contract" id={v} />,
          form: { type: "select", options: contracts.map((c) => c.name),
            toLabel: (id) => { const c = A.get("contracts", id); return c ? c.name : id; },
            toValue: (name) => { const c = contracts.find((x) => x.name === name); return c ? c.id : name; } } },
        { key: "amount", label: "结算金额", width: 140, money: true, align: "right" },
        { key: "date", label: "报审日期", width: 110, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 92,
          render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["编制中", "已报审", "已审定"] } },
      ],
      views: [
        { key: "doing", label: "进行中", filter: (r) => r.status !== "已审定" },
        { key: "done", label: "已审定", filter: (r) => r.status === "已审定" },
        { key: "all", label: "全部" },
      ],
      defaultView: "doing",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
      ],
      searchKeys: ["no", "name"],
      summary: (rows) => [
        { label: "结算金额总和", value: Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100 },
      ],
      fromParams: (p) => {
        if (!p.contract) return null;
        const c = A.get("contracts", p.contract);
        return { label: "合同：" + (c ? c.name : p.contract), filter: (r) => r.contractId === p.contract };
      },
      newDefaults: () => ({ status: "编制中" }),
      tableMinWidth: 1240,
    };
    return <ELS meta={meta} params={params} navigate={navigate} />;
  }

  window.FinalSettleScreen = FinalSettleScreen;
})();
