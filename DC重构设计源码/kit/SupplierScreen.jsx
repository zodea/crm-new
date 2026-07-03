// SupplierScreen — 基础信息/分供方·列表页（按 base-supplier.md §三 重构）
// 跨项目共享主数据：工具栏（含下拉筛选）+ 表格（名称蓝链→详情、资料状态 chip、只读汇总列）。
// 风格：统一疏朗版式。筛选由 pill 行改为紧凑下拉框（SelectFilter），并入工具栏去臃肿。
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

  // md 字段 data.js 暂缺 —— 组件内按 id 补 mock（类别/资料状态/只读汇总）
  const META = {
    s1: { category: "材料供应商", cred: "qualified", parent: "", projectCount: 2, contractTotal: 1860000, paidTotal: 1200000 },
    s2: { category: "材料供应商", cred: "reviewing", parent: "", projectCount: 1, contractTotal: 720000, paidTotal: 400000 },
    s3: { category: "材料供应商", cred: "qualified", parent: "", projectCount: 2, contractTotal: 1340000, paidTotal: 980000 },
    s4: { category: "设备供应商", cred: "incomplete", parent: "", projectCount: 1, contractTotal: 230000, paidTotal: 80000 },
    s5: { category: "劳务分包商", cred: "qualified", parent: "", projectCount: 3, contractTotal: 560000, paidTotal: 560000 },
  };
  const meta = (id, i) => META[id] || { category: "其他", cred: "incomplete", parent: "", projectCount: 0, contractTotal: 0, paidTotal: 0 };

  const CAT_OPTS = [
    { key: "all", label: "全部类别" }, { key: "材料供应商", label: "材料供应商" },
    { key: "劳务分包商", label: "劳务分包商" }, { key: "设备供应商", label: "设备供应商" }, { key: "其他", label: "其他" },
  ];
  const CRED_OPTS = [
    { key: "all", label: "全部状态" }, { key: "incomplete", label: "证照缺失" },
    { key: "reviewing", label: "审核中" }, { key: "qualified", label: "合格" }, { key: "rejected", label: "退回" },
  ];

  // 紧凑下拉筛选（替代 pill 行）：label + 原生 select（自绘 chevron）
  function SelectFilter({ label, options, value, onChange, minWidth = 132 }) {
    return (
      <label style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", flex: "none" }}>{label}</span>
        <span style={{ position: "relative", display: "inline-flex" }}>
          <select value={value} onChange={(e) => onChange(e.target.value)} style={{
            appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
            border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", background: "#fff",
            color: "var(--ink)", fontSize: 13, fontWeight: 600, padding: "7px 30px 7px 12px", cursor: "pointer",
            minWidth, transition: "border-color var(--dur-fast)",
          }}>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", display: "flex" }}>
            <Icon name="chevron-down" size={14} color="var(--ink-faint)" />
          </span>
        </span>
      </label>
    );
  }

  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), formModal: () => {}, exportModal: () => {}, importModal: () => {}, undoToast: () => {} };
  const supForm = (s, title, onSave) => UI().formModal({
    title, cols: 2,
    fields: [
      { key: "name", label: "公司名称", value: s ? s.name : "", full: true },
      { key: "category", label: "类别", type: "select", options: ["材料供应商", "劳务分包商", "设备供应商", "其他"], value: s ? s.category : "材料供应商" },
      { key: "taxNo", label: "税号", value: s ? s.taxNo : "" },
      { key: "contact", label: "联系人", value: s ? s.contact : "" },
      { key: "phone", label: "电话", value: s ? s.phone : "" },
    ],
    onSave: (vals) => {
      if (!vals.name) { UI().toast("公司名称不能为空", "danger"); return; }
      onSave(vals);
      UI().toast(s ? "已保存修改" : "已新建分供方", "ok");
    },
  });

  function SupplierScreen({ data, navigate }) {
    const [cat, setCat] = React.useState("all");
    const [cred, setCred] = React.useState("all");
    const [q, setQ] = React.useState("");
    // 列表转 state：新增/编辑/删除实时生效（刷新恢复初始 mock）
    const [list, setList] = React.useState(() => data.suppliers.map((s, i) => ({ ...s, ...meta(s.id, i) })));

    const addRow = (vals) => setList((l) => [
      { id: "s_" + Date.now(), aliases: [], ...vals, cred: "reviewing", projectCount: 0, contractTotal: 0, paidTotal: 0 },
      ...l,
    ]);
    const editRow = (id) => (vals) => setList((l) => l.map((x) => (x.id === id ? { ...x, ...vals } : x)));
    const delRow = (s) => UI().confirm({
      title: "删除分供方", danger: true, confirmText: "删除",
      message: "确定删除「" + s.name + "」？删除为软删除，可在 5 秒内撤回。",
      onConfirm: () => {
        const idx = list.findIndex((x) => x.id === s.id);
        setList((l) => l.filter((x) => x.id !== s.id));
        UI().undoToast("已删除「" + s.name + "」", () => setList((l) => { const n = [...l]; n.splice(Math.min(idx, n.length), 0, s); return n; }));
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
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}><Icon name="search" size={14} color="var(--ink-faint)" /></span>
              <input placeholder="搜索公司名、税号、简称…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 210, border: "1px solid var(--line-strong)", borderRadius: 999, padding: "8px 14px 8px 32px", fontSize: 13, background: "#fff" }} />
            </div>
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
              onDone: () => setList((l) => [
                { id: "s_i1_" + Date.now(), name: "广州恒益建材有限公司", category: "材料供应商", taxNo: "91440101MA5AXK21XX", aliases: ["恒益"], contact: "刘恒", phone: "13800001111", cred: "reviewing", projectCount: 0, contractTotal: 0, paidTotal: 0 },
                { id: "s_i2_" + Date.now(), name: "佛山市南海区隆达劳务队", category: "劳务分包商", taxNo: "92440605MA53TT8XXX", aliases: ["隆达"], contact: "赵隆", phone: "13800002222", cred: "incomplete", projectCount: 0, contractTotal: 0, paidTotal: 0 },
                { id: "s_i3_" + Date.now(), name: "东莞市威腾机械租赁部", category: "设备供应商", taxNo: "92441900MA4W99KXXX", aliases: ["威腾"], contact: "陈威", phone: "13800003333", cred: "reviewing", projectCount: 0, contractTotal: 0, paidTotal: 0 },
                ...l,
              ]),
            })}>导入</Button>
            <Button variant="primary" icon="plus" onClick={() => supForm(null, "新建分供方", addRow)}>新建</Button>
          </div>
        </Panel>

        {/* 表格卡 */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1120, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <th style={TH}>#</th>
                  <th style={TH}>分供方名称</th>
                  <th style={TH}>类别</th>
                  <th style={TH}>税号</th>
                  <th style={TH}>简称</th>
                  <th style={TH}>联系人 / 电话</th>
                  <th style={TH}>资料状态</th>
                  <th style={{ ...TH, textAlign: "right" }}>项目数</th>
                  <th style={{ ...TH, textAlign: "right" }}>累计合同额</th>
                  <th style={{ ...TH, textAlign: "right" }}>累计已付</th>
                  <th style={{ ...TH, textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => {
                  const c = CRED[s.cred] || CRED.incomplete;
                  return (
                    <tr key={s.id} style={{ borderBottom: "1px solid var(--line)", transition: "background var(--dur-fast)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ ...TD, color: "var(--ink-soft)" }}>{i + 1}</td>
                      <td style={TD}>
                        <button onClick={() => navigate("supplierDetail", { id: s.id })} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 700, cursor: "pointer", textAlign: "left" }}>{s.name}</button>
                      </td>
                      <td style={{ ...TD, color: "var(--ink-soft)" }}>{s.category}</td>
                      <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{s.taxNo}</td>
                      <td style={{ ...TD, color: "var(--ink-soft)" }}>{s.aliases.join("、")}</td>
                      <td style={TD}>{s.contact} <span style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)", fontSize: 12 }}>/ {s.phone}</span></td>
                      <td style={TD}><StatusChip tone={c.tone}>{c.text}</StatusChip></td>
                      <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{s.projectCount}</td>
                      <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(s.contractTotal)}</td>
                      <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--ok-ink)" }}>{money(s.paidTotal)}</td>
                      <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <IconButton icon="file-text" title="详情" onClick={() => navigate("supplierDetail", { id: s.id })} />
                          <IconButton icon="pencil" title="编辑" onClick={() => supForm(s, "编辑分供方", editRow(s.id))} />
                          <IconButton icon="upload" title="上传证照" onClick={() => UI().toast("打开证照上传…")} />
                          <IconButton icon="trash-2" title="删除" onClick={() => delRow(s)} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)" }}>
            显示 {rows.length} 家，共 {list.length} 家
          </div>
        </Panel>
      </div>
    );
  }

  window.SupplierScreen = SupplierScreen;
})();
