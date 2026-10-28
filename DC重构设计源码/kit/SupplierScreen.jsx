// SupplierScreen — 基础信息/分供方·列表页（按 base-supplier.md §三 重构）
// 跨项目共享主数据：工具栏（含下拉筛选）+ 表格（名称蓝链→详情、资料状态 chip、只读汇总列）。
// 风格：统一疏朗版式。筛选由 pill 行改为紧凑下拉框（SelectFilter），并入工具栏去臃肿。
// 2026-07-18 表单补全轮：新建/编辑改整页表单（kit/forms/BaseForms.jsx），对标红圈+grill决议
(function () {
  const { Button, IconButton, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;

  const TH = { padding: "13px 16px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", letterSpacing: ".02em", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)" };
  const TD = { padding: "13px 16px", fontSize: 13, verticalAlign: "middle" };
  const money = (v) => (v ? "¥" + Number(v).toLocaleString("zh-CN") : "—");

  // 资料状态（credentialStatus）→ chip
  const CRED = {
    incomplete: { tone: "warn", text: "证照缺失" },
    reviewing: { tone: "brand", text: "审核中" },
    qualified: { tone: "ok", text: "合格" },
    rejected: { tone: "danger", text: "退回" },
  };

  // 扩展字段 mock 已上移 AppData.jsx（window.APP.suppliers），列表/详情共用同一份数据（反馈轮9 第二层）

  const CAT_OPTS = [
    { key: "all", label: "全部类别" }, { key: "材料供应商", label: "材料供应商" },
    { key: "劳务分包商", label: "劳务分包商" }, { key: "专业分包商", label: "专业分包商" },
    { key: "设备供应商", label: "设备供应商" }, { key: "检测供应商", label: "检测供应商" },
    { key: "个人", label: "个人" }, { key: "其他", label: "其他" },
  ];
  const CRED_OPTS = [
    { key: "all", label: "全部状态" }, { key: "incomplete", label: "证照缺失" },
    { key: "reviewing", label: "审核中" }, { key: "qualified", label: "合格" }, { key: "rejected", label: "退回" },
  ];

  // SelectFilter 内联副本已删 → 统一用 window.KitAtoms.SelectFilter（反馈轮9 通用组件）
  const SelectFilter = (props) => { const KA = window.KitAtoms; return KA ? <KA.SelectFilter {...props} /> : null; };

  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), formModal: () => {}, typeSelect: () => Promise.resolve(null), exportModal: () => {}, importModal: () => {}, undoToast: () => {} };
  // 新建三段式第一段：分供方七类类别选择 → 带 type 进整页表单（kit/forms/BaseForms.jsx supplierForm）
  const SUP_TYPES = [
    { value: "材料供应商", label: "材料供应商", hint: "钢材、瓷砖、水泥等材料采购" },
    { value: "劳务分包商", label: "劳务分包商", hint: "泥水、油漆等劳务班组分包" },
    { value: "专业分包商", label: "专业分包商", hint: "防水、幕墙等专业工程分包" },
    { value: "设备供应商", label: "设备供应商", hint: "机械设备租赁与采购" },
    { value: "检测供应商", label: "检测供应商", hint: "检测、试验与鉴定服务" },
    { value: "个人", label: "个人", hint: "个人供应商或零星用工" },
    { value: "其他", label: "其他", hint: "其他类型分供方" },
  ];

  function SupplierScreen({ data, navigate }) {
    const [cat, setCat] = React.useState("all");
    const [cred, setCred] = React.useState("all");
    const [q, setQ] = React.useState("");
    // 数据源：window.APP.suppliers 共享 store（与分供方详情同源，编辑互通实时联动）
    const A = window.APP;
    if (A) A.use();
    const list = A ? A.rows("suppliers") : [];

    const delRow = (s) => UI().confirm({
      title: "删除分供方", danger: true, confirmText: "删除",
      message: "确定删除「" + s.name + "」？删除为软删除，可在 5 秒内撤回。",
      onConfirm: () => {
        A.softDel("suppliers", s.id);
        UI().undoToast("已删除「" + s.name + "」", () => A.restore("suppliers", s.id));
      },
    });

    const rows = list
      .filter((s) => (cat === "all" || s.category === cat) && (cred === "all" || s.cred === cred))
      .filter((s) => !q || (s.name + (s.taxNo || "") + (s.aliases || []).join("")).includes(q));

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 工具栏（标题 + 下拉筛选 + 搜索/操作） */}
        <Panel padding={14} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flex: "none" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>分供方资料库</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>共 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{list.length}</b> 家</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <SelectFilter label="类别" options={CAT_OPTS} value={cat} onChange={setCat} />
            <SelectFilter label="资料" options={CRED_OPTS} value={cred} onChange={setCred} />
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {window.KitAtoms && <window.KitAtoms.SearchInput placeholder="搜索公司名、税号、简称…" value={q} onChange={setQ} />}
            <IconButton icon="refresh-cw" title="刷新" onClick={() => { setCat("all"); setCred("all"); setQ(""); UI().toast("已刷新"); }} />
            <IconButton icon="columns-3" title="列设置" onClick={() => UI().toast("列设置（演示）")} />
            <Button icon="download" onClick={(e) => UI().exportModal({
              title: "导出分供方资料", count: rows.length, unit: "家", ext: ".xlsx", anchor: e.currentTarget,
              structureOptions: ["按类别", "按资料状态", "不分层"],
              nameOptions: [{ label: "公司名称", sample: "大板东建材" }, { label: "税号后6位", sample: "580216" }, { label: "导出日期", sample: "2026-07-02" }],
            })}>导出</Button>
            <Button icon="upload" onClick={() => UI().importModal({
              title: "导入分供方", fileName: "分供方台账.xlsx", rowCount: 3,
              targetFields: ["公司名称", "类别", "税号", "简称", "联系人", "电话"],
              sourceCols: ["公司名称", "类别", "税号", "联系人", "电话", "备注"],
              onDone: () => {
                A.add("suppliers", { id: "s_i1_" + Date.now(), name: "广州恒益建材有限公司", category: "材料供应商", taxNo: "91440101MA5AXK21XX", aliases: ["恒益"], contact: "刘恒", phone: "13800001111", cred: "reviewing", projectCount: 0, contractTotal: 0, paidTotal: 0 });
                A.add("suppliers", { id: "s_i2_" + Date.now(), name: "佛山市南海区隆达劳务队", category: "劳务分包商", taxNo: "92440605MA53TT8XXX", aliases: ["隆达"], contact: "赵隆", phone: "13800002222", cred: "incomplete", projectCount: 0, contractTotal: 0, paidTotal: 0 });
                A.add("suppliers", { id: "s_i3_" + Date.now(), name: "东莞市威腾机械租赁部", category: "设备供应商", taxNo: "92441900MA4W99KXXX", aliases: ["威腾"], contact: "陈威", phone: "13800003333", cred: "reviewing", projectCount: 0, contractTotal: 0, paidTotal: 0 });
              },
            })}>导入</Button>
            <Button variant="primary" icon="plus" onClick={() => UI().typeSelect({
              title: "新建分供方 · 选择类别", options: SUP_TYPES, defaultValue: "材料供应商",
            }).then((v) => { if (v != null) navigate("supplierForm", { type: v }); })}>新建</Button>
          </div>
        </Panel>

        {/* 红圈式表格（KitTable：≥10 行 / 容器内横滚不撑破页面 / 分页）——反馈轮 8 */}
        {window.KitTable
          ? <window.KitTable
              rows={rows} checkable pageSize={10}
              footerLeft={(cks) => cks.length ? ("已选 " + cks.length + " 家") : ("显示 " + rows.length + " 家，共 " + list.length + " 家")}
              empty="没有符合筛选条件的分供方"
              columns={[
                { key: "name", label: "分供方名称", width: 220, maxWidth: 240, render: (v, s) => <button onClick={() => navigate("supplierDetail", { id: s.id })} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 700, cursor: "pointer", textAlign: "left" }}>{v}</button> },
                { key: "category", label: "类别", width: 108, filter: true, color: "var(--ink-soft)" },
                { key: "taxNo", label: "税号", width: 172, mono: true, color: "var(--ink-soft)" },
                { key: "aliases", label: "简称", width: 100, color: "var(--ink-soft)", render: (v) => (v || []).join("、") || "—" },
                { key: "contact", label: "联系人 / 电话", width: 168, render: (v, s) => <span>{v} <span style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)", fontSize: 12 }}>/ {s.phone}</span></span> },
                { key: "cred", label: "资料状态", width: 96, filter: true, render: (v) => { const c = CRED[v] || CRED.incomplete; return <StatusChip tone={c.tone}>{c.text}</StatusChip>; } },
                { key: "projectCount", label: "项目数", width: 76, align: "right", mono: true },
                { key: "contractTotal", label: "累计合同额", width: 134, align: "right", money: true },
                { key: "paidTotal", label: "累计已付", width: 134, align: "right", money: true },
                { key: "op", label: "操作", width: 138, align: "right", render: (v, s) => (
                  <span style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <IconButton icon="file-text" title="详情" onClick={() => navigate("supplierDetail", { id: s.id })} />
                    <IconButton icon="pencil" title="编辑" onClick={() => navigate("supplierForm", { id: s.id })} />
                    <IconButton icon="upload" title="上传证照" onClick={() => UI().toast("打开证照上传…")} />
                    <IconButton icon="trash-2" title="删除" onClick={() => delRow(s)} />
                  </span>
                ) },
              ]} />
          : <Panel padding={20} style={{ color: "var(--ink-soft)" }}>表格组件加载中…</Panel>}
      </div>
    );
  }

  window.SupplierScreen = SupplierScreen;
})();
