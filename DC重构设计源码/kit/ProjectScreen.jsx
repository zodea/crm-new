// ProjectScreen — 项目信息/项目列表（按 project-info.md §一 重构为统一疏朗风格）
// 工具栏（含状态下拉筛选）+ 表格（项目名蓝链→详情、状态 chip）。已脱离 KitToolbar 兼容垫片。
(function () {
  const { Button, IconButton, Panel, StatusChip, Icon } = window.DesignSystem_e3d871;

  const TH = { padding: "13px 16px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)" };
  const TD = { padding: "13px 16px", fontSize: 13, verticalAlign: "middle" };
  const statusTone = { "在建": "brand", "施工中": "brand", "收尾": "warn", "停工": "danger", "完工": "ok", "已竣工": "ok", "已结算": "ok" };

  const STATUS_OPTS = [
    { key: "all", label: "全部状态" }, { key: "在建", label: "在建" },
    { key: "收尾", label: "收尾" }, { key: "停工", label: "停工" }, { key: "完工", label: "完工" },
  ];

  function SelectFilter({ label, options, value, onChange, minWidth = 132 }) {
    return (
      <label style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", flex: "none" }}>{label}</span>
        <span style={{ position: "relative", display: "inline-flex" }}>
          <select value={value} onChange={(e) => onChange(e.target.value)} style={{
            appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
            border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", background: "#fff",
            color: "var(--ink)", fontSize: 13, fontWeight: 600, padding: "7px 30px 7px 12px", cursor: "pointer", minWidth,
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
  const projForm = (p, title, onSave) => UI().formModal({
    title, cols: 2,
    fields: [
      { key: "name", label: "项目名称", value: p ? p.name : "", full: true },
      { key: "status", label: "状态", type: "select", options: ["在建", "收尾", "停工", "完工"], value: p ? p.status : "在建" },
      { key: "manager", label: "项目经理", value: p ? p.manager : "" },
      { key: "developer", label: "建设单位", value: p ? p.developer : "", full: true },
      { key: "address", label: "项目地址", value: p ? p.address : "", full: true },
      { key: "startDate", label: "开工日期", value: p ? p.startDate : "", placeholder: "2026-07-02" },
    ],
    onSave: (vals) => {
      if (!vals.name) { UI().toast("项目名称不能为空", "danger"); return; }
      onSave(vals);
      UI().toast(p ? "已保存修改" : "已新增项目", "ok");
    },
  });

  function ProjectScreen({ data, navigate }) {
    const [status, setStatus] = React.useState("all");
    const [q, setQ] = React.useState("");
    // 列表转 state：新增/编辑/删除实时生效（刷新恢复初始 mock）
    const [list, setList] = React.useState(() => data.projects.slice());

    const addRow = (vals) => setList((l) => [{ id: "p_" + Date.now(), ...vals }, ...l]);
    const editRow = (id) => (vals) => setList((l) => l.map((x) => (x.id === id ? { ...x, ...vals } : x)));
    const delRow = (p) => UI().confirm({
      title: "删除项目", danger: true, confirmText: "删除",
      message: "确定删除「" + p.name + "」？删除为软删除，可在 5 秒内撤回。",
      onConfirm: () => {
        const idx = list.findIndex((x) => x.id === p.id);
        setList((l) => l.filter((x) => x.id !== p.id));
        UI().undoToast("已删除「" + p.name + "」", () => setList((l) => { const n = [...l]; n.splice(Math.min(idx, n.length), 0, p); return n; }));
      },
    });

    const rows = list
      .filter((p) => status === "all" || p.status === status)
      .filter((p) => !q || ((p.name || "") + (p.address || "")).includes(q));

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 工具栏 */}
        <Panel padding={14} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flex: "none" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>施工项目</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>共 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{list.length}</b> 个</span>
          </div>
          <SelectFilter label="状态" options={STATUS_OPTS} value={status} onChange={setStatus} />
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}><Icon name="search" size={14} color="var(--ink-faint)" /></span>
              <input placeholder="搜索项目名、地址…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 210, border: "1px solid var(--line-strong)", borderRadius: 999, padding: "8px 14px 8px 32px", fontSize: 13, background: "#fff" }} />
            </div>
            <IconButton icon="refresh-cw" title="刷新" onClick={() => { setStatus("all"); setQ(""); UI().toast("已刷新"); }} />
            <Button icon="upload" onClick={() => UI().importModal({
              title: "导入项目", fileName: "施工项目台账.xlsx", rowCount: 1,
              targetFields: ["项目名称", "状态", "项目地址", "开工日期", "建设单位", "项目经理"],
              sourceCols: ["项目名称", "状态", "地址", "开工日期", "建设单位", "项目经理"],
              onDone: () => setList((l) => [
                { id: "p_i1_" + Date.now(), name: "黄埔科学城人才公寓二期", status: "在建", address: "广州市黄埔区科学大道 88 号", startDate: "2026-05-20", developer: "广州开发区建设集团", manager: "郑海峰" },
                ...l,
              ]),
            })}>导入 Excel</Button>
            <Button icon="download" onClick={(e) => UI().exportModal({
              title: "导出项目台账", count: rows.length, unit: "个", ext: ".xlsx", anchor: e.currentTarget,
              structureOptions: ["按状态", "按建设单位", "不分层"],
              nameOptions: [{ label: "项目名称", sample: "车陂商业大楼" }, { label: "状态", sample: "在建" }, { label: "导出日期", sample: "2026-07-02" }],
            })}>导出 Excel</Button>
            <Button variant="primary" icon="plus" onClick={() => projForm(null, "新增项目", addRow)}>新增</Button>
          </div>
        </Panel>

        {/* 表格 */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  {["#", "项目名称", "状态", "项目地址", "开工日期", "建设单位", "项目经理", "操作"].map((h, i) => (
                    <th key={i} style={{ ...TH, textAlign: h === "操作" ? "right" : "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--line)", transition: "background var(--dur-fast)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ ...TD, color: "var(--ink-soft)" }}>{i + 1}</td>
                    <td style={TD}>
                      <button onClick={() => navigate("projectDetail", { id: p.id })} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 700, cursor: "pointer", textAlign: "left" }}>{p.name}</button>
                    </td>
                    <td style={TD}><StatusChip tone={statusTone[p.status] || "neutral"}>{p.status}</StatusChip></td>
                    <td style={{ ...TD, color: "var(--ink-soft)" }}>{p.address}</td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{p.startDate}</td>
                    <td style={TD}>{p.developer}</td>
                    <td style={TD}>{p.manager}</td>
                    <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <IconButton icon="file-text" title="详情" onClick={() => navigate("projectDetail", { id: p.id })} />
                        <IconButton icon="square-pen" title="编辑" onClick={() => projForm(p, "编辑项目 · " + p.name, editRow(p.id))} />
                        <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => delRow(p)} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)" }}>
            显示 {rows.length} 个，共 {list.length} 个项目
          </div>
        </Panel>
      </div>
    );
  }

  window.ProjectScreen = ProjectScreen;
})();
