// ProjectScreen — 项目信息/项目列表（反馈轮 8：红圈化）
// 红圈 03-项目信息 列表页对齐：多列（阶段/累计收入/预算/计划竣工/经理/执行经理/合同名/客户/施工员）+
// 表格三件套（≥10 行高度 / 容器内横滚 / 分页，KitTable 承载）+ 完整编辑表单（红圈详细资料·基础信息分组）。
(function () {
  const { Button, IconButton, Panel, StatusChip, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), formModal: () => {}, exportModal: () => {}, importModal: () => {}, undoToast: () => {} };
  const KT = () => window.KitTable;

  const stageTone = { "项目立项": "neutral", "施工准备": "neutral", "施工中": "brand", "停工": "danger", "完工及竣备": "warn", "交付": "ok", "保修": "ok", "项目完结": "ok" };
  // 数据源：window.APP.projects（AppData.jsx 共享 store，红圈扩展字段已在 store 内合并）——
  // 反馈轮9 第二层：列表页与项目详情共用同一份数据，任一处编辑另一处实时可见。

  const STAGE_OPTS = [
    { key: "all", label: "全部业务流程阶段" }, { key: "项目立项", label: "项目立项" }, { key: "施工准备", label: "施工准备" },
    { key: "施工中", label: "施工中" }, { key: "停工", label: "停工" }, { key: "完工及竣备", label: "完工及竣备" },
    { key: "交付", label: "交付" }, { key: "保修", label: "保修" }, { key: "项目完结", label: "项目完结" },
  ];

  // SelectFilter 内联副本已删 → 统一用 window.KitAtoms.SelectFilter（反馈轮9 通用组件）
  const SelectFilter = (props) => { const KA = window.KitAtoms; return KA ? <KA.SelectFilter minWidth={150} {...props} /> : null; };

  // 完整编辑表单：红圈「详细资料 · 基础信息」分组字段
  const projForm = (p, title, onSave) => UI().formModal({
    title, cols: 2, width: 640,
    fields: [
      { key: "name", label: "项目名称", value: p ? p.name : "", full: true },
      { key: "contractName", label: "项目合同名称", value: p ? p.contractName : "", full: true },
      { key: "developer", label: "客户（甲方）", value: p ? p.developer : "" },
      { key: "developer2", label: "客户2（选填）", value: p ? p.developer2 || "" : "" },
      { key: "operationType", label: "经营类型", type: "select", options: ["自营", "联营", "挂靠"], value: p ? p.operationType || "自营" : "自营" },
      { key: "stage", label: "业务流程阶段", type: "select", options: STAGE_OPTS.slice(1).map((o) => o.label), value: p ? p.stage : "施工中" },
      { key: "region", label: "工程地域", value: p ? p.region || "" : "", placeholder: "广州·白云" },
      { key: "manager", label: "项目经理", value: p ? p.manager : "" },
      { key: "execManager", label: "执行经理", value: p ? p.execManager : "" },
      { key: "builder", label: "施工员", value: p ? p.builder : "" },
      { key: "address", label: "工程详细地址", value: p ? p.address : "", full: true },
      { key: "startDate", label: "计划开工日期", value: p ? p.startDate : "", placeholder: "2026-07-04" },
      { key: "planEnd", label: "计划竣工日期", value: p ? p.planEnd : "", placeholder: "2027-06-30" },
      { key: "planDays", label: "计划工期（天）", value: p ? p.planDays || "" : "", placeholder: "360" },
      { key: "riskLevel", label: "项目风险级别", type: "select", options: ["低", "中", "高"], value: p ? p.riskLevel || "低" : "低" },
      { key: "overview", label: "工程概况", type: "textarea", value: p ? p.overview || "" : "", full: true, placeholder: "楼栋数 / 层数 / 建筑面积 / 装修标准…" },
      { key: "note", label: "备注", type: "textarea", value: p ? p.note || "" : "", full: true },
    ],
    onSave: (vals) => {
      if (!vals.name) { UI().toast("项目名称不能为空", "danger"); return; }
      onSave(vals);
      UI().toast(p ? "已保存修改" : "已新增项目", "ok");
    },
  });

  function ProjectScreen({ data, navigate }) {
    const [stage, setStage] = React.useState("all");
    const [q, setQ] = React.useState("");
    const A = window.APP;
    if (A) A.use();                                   // 订阅共享 store：详情页编辑 → 本列表实时刷新
    const KitTable = KT();
    const list = A ? A.rows("projects") : [];

    const addRow = (vals) => A.add("projects", { id: "p_" + Date.now(), status: "在建", ...vals });
    const editRow = (id) => (vals) => A.update("projects", id, vals);
    const delRow = (p) => UI().confirm({
      title: "删除项目", danger: true, confirmText: "删除",
      message: "确定删除「" + p.name + "」？删除为软删除，可在 5 秒内撤回。",
      onConfirm: () => {
        A.softDel("projects", p.id);
        UI().undoToast("已删除「" + p.name + "」", () => A.restore("projects", p.id));
      },
    });

    const rows = list
      .filter((p) => stage === "all" || p.stage === stage)
      .filter((p) => !q || ((p.name || "") + (p.address || "") + (p.developer || "") + (p.manager || "")).includes(q));

    const link = (label, onClick) => <button onClick={onClick} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 700, cursor: "pointer", textAlign: "left" }}>{label}</button>;

    const columns = [
      { key: "name", label: "项目名称", width: 170, maxWidth: 200, render: (v, p) => link(v, () => navigate("projectDetail", { id: p.id })) },
      { key: "stage", label: "业务流程阶段", width: 118, filter: true, render: (v) => <StatusChip tone={stageTone[v] || "neutral"}>{v}</StatusChip> },
      { key: "income", label: "累计收入", width: 130, align: "right", money: true },
      { key: "budget", label: "预算总额", width: 130, align: "right", money: true },
      { key: "startDate", label: "计划开工", width: 104, mono: true, color: "var(--ink-soft)" },
      { key: "planEnd", label: "计划竣工日期", width: 112, mono: true, color: "var(--ink-soft)", filter: true },
      { key: "manager", label: "项目经理", width: 88, filter: true },
      { key: "actualEnd", label: "实际竣工日期", width: 112, mono: true, color: "var(--ink-soft)" },
      { key: "execManager", label: "执行经理", width: 88 },
      { key: "contractName", label: "项目合同名称", width: 210, maxWidth: 220, color: "var(--ink-soft)" },
      { key: "developer", label: "客户", width: 140, maxWidth: 160, filter: true, render: (v) => <span style={{ color: "var(--brand)", fontWeight: 600 }}>{v}</span> },
      { key: "builder", label: "施工员", width: 84 },
      { key: "op", label: "操作", width: 116, align: "right", render: (v, p) => (
        <span style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
          <IconButton icon="file-text" title="详情" onClick={() => navigate("projectDetail", { id: p.id })} />
          <IconButton icon="square-pen" title="编辑" onClick={() => projForm(p, "编辑项目 · " + p.name, editRow(p.id))} />
          <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => delRow(p)} />
        </span>
      ) },
    ];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 工具栏 */}
        <Panel padding={14} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flex: "none" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>施工项目</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>共 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{list.length}</b> 个</span>
          </div>
          <SelectFilter label="阶段" options={STAGE_OPTS} value={stage} onChange={setStage} />
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {window.KitAtoms && <window.KitAtoms.SearchInput placeholder="搜索项目、客户、经理…" value={q} onChange={setQ} />}
            <IconButton icon="refresh-cw" title="刷新" onClick={() => { setStage("all"); setQ(""); UI().toast("已刷新"); }} />
            <Button icon="upload" onClick={() => UI().importModal({
              title: "导入项目", fileName: "施工项目台账.xlsx", rowCount: 1,
              targetFields: ["项目名称", "业务流程阶段", "项目地址", "计划开工日期", "客户", "项目经理"],
              sourceCols: ["项目名称", "阶段", "地址", "开工日期", "建设单位", "项目经理"],
              onDone: () => A.add("projects", { id: "p_i1_" + Date.now(), name: "黄埔科学城人才公寓二期", status: "在建", address: "广州市黄埔区科学大道 88 号", startDate: "2026-05-20", developer: "广州开发区建设集团", manager: "郑海峰" }),
            })}>导入 Excel</Button>
            <Button icon="download" onClick={(e) => UI().exportModal({
              title: "导出项目台账", count: rows.length, unit: "个", ext: ".xlsx", anchor: e.currentTarget,
              structureOptions: ["按业务流程阶段", "按客户", "不分层"],
              nameOptions: [{ label: "项目名称", sample: "车陂商业大楼" }, { label: "阶段", sample: "施工中" }, { label: "导出日期", sample: "2026-07-04" }],
            })}>导出 Excel</Button>
            <Button variant="primary" icon="plus" onClick={() => projForm(null, "新增项目", addRow)}>新增</Button>
          </div>
        </Panel>

        {/* 红圈式表格（KitTable：≥10 行 / 容器内横滚 / 分页） */}
        {KitTable
          ? <KitTable columns={columns} rows={rows} checkable pageSize={10} minRows={10}
              footerLeft={(cks) => cks.length ? ("已选 " + cks.length + " 个项目") : ("显示 " + rows.length + " 个，共 " + list.length + " 个项目")}
              empty="没有符合筛选条件的项目" />
          : <Panel padding={20} style={{ color: "var(--ink-soft)" }}>表格组件加载中…</Panel>}
      </div>
    );
  }

  window.ProjectScreen = ProjectScreen;
})();
