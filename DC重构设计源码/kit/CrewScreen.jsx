// CrewScreen — 基础信息/班组管理·列表页（按 base-crew.md §三 重构）
// 工具栏（含工种下拉筛选）+ 表格（班组名蓝链→详情、工人数/关联项目数计算列）+ 底部汇总。
// 筛选由 pill 行改为紧凑下拉框（SelectFilter），并入工具栏去臃肿。
(function () {
  const { Button, IconButton, Panel, Icon } = window.DesignSystem_e3d871;

  const TH = { padding: "13px 16px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)" };
  const TD = { padding: "13px 16px", fontSize: 13, verticalAlign: "middle" };

  const TRADE_OPTS = [
    { key: "all", label: "全部工种" }, { key: "泥水工", label: "泥水工" }, { key: "木工", label: "木工" },
    { key: "钢筋工", label: "钢筋工" }, { key: "水暖工", label: "水暖工" }, { key: "防水工", label: "防水工" },
  ];

  // SelectFilter 内联副本已删 → 统一用 window.KitAtoms.SelectFilter（反馈轮9 通用组件）
  const SelectFilter = (props) => { const KA = window.KitAtoms; return KA ? <KA.SelectFilter {...props} /> : null; };

  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), formModal: () => {}, exportModal: () => {}, undoToast: () => {} };
  const crewForm = (c, title, onSave) => UI().formModal({
    title, cols: 2,
    fields: [
      { key: "name", label: "班组名称", value: c ? c.name : "" },
      { key: "trade", label: "工种", type: "select", options: ["泥水工", "木工", "钢筋工", "水暖工", "防水工"], value: c ? c.trade : "泥水工" },
      { key: "contact", label: "负责人", value: c ? c.contact : "" },
      { key: "phone", label: "联系电话", value: c ? c.phone : "" },
      { key: "note", label: "备注", value: c ? c.note : "", full: true },
    ],
    onSave: (vals) => {
      if (!vals.name) { UI().toast("班组名称不能为空", "danger"); return; }
      onSave(vals);
      UI().toast(c ? "已保存修改" : "已新建班组", "ok");
    },
  });

  function CrewScreen({ data, navigate }) {
    const [trade, setTrade] = React.useState("all");
    const [q, setQ] = React.useState("");
    // 列表转 state：新增/编辑/删除实时生效（刷新恢复初始 mock）
    const [list, setList] = React.useState(() => data.crews.slice());

    const addRow = (vals) => setList((l) => [{ id: "c_" + Date.now(), workerCount: 0, projectCount: 0, ...vals }, ...l]);
    const editRow = (id) => (vals) => setList((l) => l.map((x) => (x.id === id ? { ...x, ...vals } : x)));
    const delRow = (c) => UI().confirm({
      title: "删除班组", danger: true, confirmText: "删除",
      message: "确定删除「" + c.name + "」？删除为软删除，可在 5 秒内撤回。",
      onConfirm: () => {
        const idx = list.findIndex((x) => x.id === c.id);
        setList((l) => l.filter((x) => x.id !== c.id));
        UI().undoToast("已删除「" + c.name + "」", () => setList((l) => { const n = [...l]; n.splice(Math.min(idx, n.length), 0, c); return n; }));
      },
    });

    const crews = list;
    const rows = crews
      .filter((c) => trade === "all" || c.trade === trade)
      .filter((c) => !q || ((c.name || "") + (c.contact || "")).includes(q));
    const totalWorkers = crews.reduce((s, c) => s + (c.workerCount || 0), 0);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 工具栏 */}
        <Panel padding={14} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flex: "none" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>班组管理</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>共 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{crews.length}</b> 个</span>
          </div>
          <SelectFilter label="工种" options={TRADE_OPTS} value={trade} onChange={setTrade} />
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {window.KitAtoms && <window.KitAtoms.SearchInput placeholder="搜索班组名、负责人…" value={q} onChange={setQ} />}
            <IconButton icon="refresh-cw" title="刷新" onClick={() => { setTrade("all"); setQ(""); UI().toast("已刷新"); }} />
            <IconButton icon="columns-3" title="列设置" onClick={() => UI().toast("列设置（演示）")} />
            <Button icon="download" onClick={(e) => UI().exportModal({
              title: "导出班组清单", count: rows.length, unit: "个", ext: ".xlsx", anchor: e.currentTarget,
              structureOptions: ["按工种", "不分层"],
              nameOptions: [{ label: "班组名称", sample: "周维铺贴班组" }, { label: "工种", sample: "泥水工" }, { label: "导出日期", sample: "2026-07-02" }],
            })}>导出</Button>
            <Button variant="primary" icon="plus" onClick={() => crewForm(null, "新建班组", addRow)}>新建班组</Button>
          </div>
        </Panel>

        {/* 表格 */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 920, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  {["#", "班组名称", "工种", "负责人", "联系电话", "工人数", "关联项目数", "备注", "操作"].map((h, i) => (
                    <th key={i} style={{ ...TH, textAlign: h === "工人数" || h === "关联项目数" ? "right" : h === "操作" ? "right" : "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c.id} style={{ borderBottom: "1px solid var(--line)", transition: "background var(--dur-fast)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ ...TD, color: "var(--ink-soft)" }}>{i + 1}</td>
                    <td style={TD}>
                      <button onClick={() => navigate("crewDetail", { crewId: c.id })} style={{ display: "inline-flex", alignItems: "center", gap: 8, border: 0, background: "transparent", padding: 0, cursor: "pointer" }}>
                        <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 800, fontSize: 13, display: "grid", placeItems: "center" }}>{c.name.slice(0, 1)}</span>
                        <span style={{ color: "var(--brand)", fontWeight: 700 }}>{c.name}</span>
                      </button>
                    </td>
                    <td style={TD}>{c.trade}</td>
                    <td style={TD}>{c.contact}</td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 12 }}>{c.phone}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{c.workerCount}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{c.projectCount}</td>
                    <td style={{ ...TD, color: c.note ? "var(--ink-soft)" : "var(--ink-faint)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.note || "—"}</td>
                    <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <IconButton icon="file-text" title="详情" onClick={() => navigate("crewDetail", { crewId: c.id })} />
                        <IconButton icon="square-pen" title="编辑" onClick={() => crewForm(c, "编辑班组 · " + c.name, editRow(c.id))} />
                        <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => delRow(c)} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)" }}>
            共 <b style={{ color: "var(--ink)" }}>{crews.length}</b> 个班组 · 在场工人 {totalWorkers} 人
          </div>
        </Panel>
      </div>
    );
  }

  window.CrewScreen = CrewScreen;
})();
