// AcceptanceScreen — 竣工验收·保修列表（阶段流转触发器：竣工验收单 + 保修到期确认单）：EntityListScreen meta 一份生成整页。
// 合同 select 只列施工合同（验收/保修挂收入侧主合同）；fromParams 承接项目详情穿透（params.project → 按 projectId 预筛）。
(function () {
  if (window.AcceptanceScreen) return;

  function AcceptanceScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};
    const projects = A.rows("projects");
    const contracts = A.rows("contracts").filter((c) => c.kind === "施工");
    const TYPE_TONE = { "竣工验收": "brand", "保修到期确认": "neutral" };
    const STATUS_TONE = { "验收中": "warn", "已验收": "ok", "保修中": "brand", "已到期": "neutral" };

    const meta = {
      entity: "acceptance",
      title: "竣工验收·保修",
      coll: "acceptances",
      columns: [
        { key: "no", label: "单据编号", width: 140, mono: true },
        { key: "type", label: "类型", width: 110,
          render: (v) => (StatusChip ? <StatusChip tone={TYPE_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["竣工验收", "保修到期确认"] } },
        { key: "name", label: "名称", width: 230, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "projectId", label: "项目", width: 150, render: (v) => <KA.EntityLink type="project" id={v} />,
          form: { type: "select", options: projects.map((p) => p.name),
            toLabel: (id) => { const p = A.get("projects", id); return p ? p.name : id; },
            toValue: (name) => { const p = projects.find((x) => x.name === name); return p ? p.id : name; } } },
        { key: "contractId", label: "施工合同", width: 220, render: (v) => <KA.EntityLink type="contract" id={v} />,
          form: { type: "select", options: contracts.map((c) => c.name),
            toLabel: (id) => { const c = A.get("contracts", id); return c ? c.name : id; },
            toValue: (name) => { const c = contracts.find((x) => x.name === name); return c ? c.id : name; } } },
        { key: "date", label: "日期", width: 110, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 96,
          render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["验收中", "已验收", "保修中", "已到期"] } },
        { key: "estimate", label: "涉及金额", width: 130, money: true, align: "right" },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "checking", label: "验收中", filter: (r) => r.status === "验收中" },
        { key: "warranty", label: "保修中", filter: (r) => r.status === "保修中" },
        { key: "done", label: "已验收", filter: (r) => r.status === "已验收" },
      ],
      defaultView: "checking",
      filters: [
        { key: "proj", label: "项目",
          options: [{ key: "all", label: "全部项目" }, ...projects.map((p) => ({ key: p.id, label: p.name }))],
          match: (r, val) => r.projectId === val },
        { key: "type", label: "类型",
          options: [{ key: "all", label: "全部类型" }, { key: "竣工验收", label: "竣工验收" }, { key: "保修到期确认", label: "保修到期确认" }],
          match: (r, val) => r.type === val },
      ],
      searchKeys: ["no", "name"],
      summary: (rows) => [
        { label: "涉及金额总和", value: Math.round(rows.reduce((s, r) => s + (Number(r.estimate) || 0), 0) * 100) / 100 },
      ],
      fromParams: (p) => {
        if (!p.project) return null;
        const pr = A.get("projects", p.project);
        return { label: "项目：" + (pr ? pr.name : p.project), filter: (r) => r.projectId === p.project };
      },
      newDefaults: () => ({ type: "竣工验收", status: "验收中" }),
      tableMinWidth: 1460,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.AcceptanceScreen = AcceptanceScreen;
})();
