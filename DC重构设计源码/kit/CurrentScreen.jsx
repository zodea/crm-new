// CurrentScreen — 往来收付列表（资金域批B）：非合同类往来收/付并页，业务态视图=收款/付款/全部（默认收款）。
// 口径：direction 决定收付泳道（收→ok 绿 / 付→danger 红）；projectId 可为 null=公司层面往来，项目列显"—"；净额=Σ收−Σ付可为负。
// params.project 由项目详情金额穿透带入 → projectId 预筛（可一键摘除，进入时 ELS 自动切「全部」视图）。
(function () {
  if (window.CurrentScreen) return;

  function CurrentScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};
    const projects = A.rows("projects");
    const dirTone = { "收": "ok", "付": "danger" };

    const meta = {
      entity: "current",
      title: "往来收付",
      coll: "currents",
      columns: [
        { key: "no", label: "单据编号", width: 150, mono: true },
        { key: "direction", label: "方向", width: 72,
          render: (v) => (StatusChip ? <StatusChip tone={dirTone[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["收", "付"] } },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "counterparty", label: "对方单位", width: 220 },
        { key: "amount", label: "金额", width: 130, money: true, align: "right" },
        { key: "method", label: "方式", width: 110, form: { type: "select", options: ["银行转账", "内部转账", "现金"] } },
        { key: "date", label: "日期", width: 110, mono: true, form: { type: "date" } },
        { key: "note", label: "备注", width: 180 },
      ],
      views: [
        { key: "in", label: "收款", filter: (r) => r.direction === "收" },
        { key: "out", label: "付款", filter: (r) => r.direction === "付" },
        { key: "all", label: "全部" },
      ],
      defaultView: "in",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
      ],
      searchKeys: ["no", "counterparty", "note"],
      summary: (rows) => {
        const sum = (dir) => Math.round(rows.reduce((s, r) => s + (r.direction === dir ? (r.amount || 0) : 0), 0) * 100) / 100;
        const inSum = sum("收"), outSum = sum("付");
        return [
          { label: "往来收款总和", value: inSum },
          { label: "往来付款总和", value: outSum },
          { label: "净额(收-付)", value: Math.round((inSum - outSum) * 100) / 100 },
        ];
      },
      fromParams: (p) => {
        if (!p.project) return null;
        const proj = A.get("projects", p.project);
        return { label: "项目：" + ((proj && proj.name) || p.project), filter: (r) => r.projectId === p.project };
      },
      newDefaults: () => ({ direction: "收", method: "银行转账" }),
      tableMinWidth: 1320,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.CurrentScreen = CurrentScreen;
})();
