// ProjectSupplierImportScreen — 项目×分供方合作关系导入向导（#192；#244 设计稿回填）。
// 口径：选择文件 → 自动分类与人工调整 → 确认生成。两条硬规则必须显式呈现：
//       ① 已存在的合作关系不新建、只提示（重复关系保留原状态与历史）；
//       ② 名单里不存在的分供方必须人工确认后才新建主数据（七类归属由用户指定，不由导入猜）。
(function () {
  if (window.ProjectSupplierImportScreen) return;

  // 演示数据：匿名虚构（ADR 0014 §9）；kind 对齐 CONTEXT.md「分供方」七类
  const ROWS = [
    { name: "广州市大板东建材有限公司", kind: "材料供应商", match: "existing", relation: "existing", status: "已签合同" },
    { name: "佛山市顺祥劳务分包有限公司", kind: "劳务分包商", match: "existing", relation: "new", status: "—" },
    { name: "广州鑫程幕墙工程有限公司", kind: "专业分包商", match: "new", relation: "new", status: "—" },
    { name: "李文彬", kind: "个人", match: "new", relation: "new", status: "—" },
  ];
  const KINDS = ["材料供应商", "劳务分包商", "专业分包商", "设备供应商", "检测供应商", "个人", "其他"];

  function ProjectSupplierImportScreen({ navigate }) {
    const { Panel, Button, StatusChip, Icon } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {} };
    const P = Panel || "div";

    const newSuppliers = ROWS.filter((r) => r.match === "new");
    const dupRelations = ROWS.filter((r) => r.relation === "existing");
    const willCreate = ROWS.filter((r) => r.relation === "new");

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 1080 }}>
        <P padding={0}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap" }}>
            <button type="button" onClick={() => navigate("projectSupplier")}
              style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--line-strong)", background: "var(--panel)",
                borderRadius: "var(--radius-btn)", padding: "5px 10px", cursor: "pointer", fontSize: 13 }}>
              {Icon ? <Icon name="arrow-left" size={14} /> : "←"} 返回项目·分供方工作台
            </button>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>导入合作分供方 · 合和新城·3 号楼</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>已读取「参建单位名单.xlsx」共 {ROWS.length} 行</div>
            </div>
            {StatusChip ? <StatusChip tone={newSuppliers.length ? "warn" : "ok"}>{newSuppliers.length ? newSuppliers.length + " 家需确认新建" : "全部可匹配"}</StatusChip> : null}
          </div>
          <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.7 }}>
            已存在的合作关系不会被覆盖，只在下表标「已存在」并保留原状态与历史。<br />
            分供方主数据库里查不到的单位必须人工勾选类别后才新建 —— 类别不由导入猜（CONTEXT.md「分供方」七类）。
          </div>
        </P>

        <P padding={0}>
          <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1.1fr 110px 110px 100px", gap: 10, alignItems: "center",
            padding: "9px 14px", background: "var(--surface-2)", borderBottom: "1px solid var(--line)" }}>
            {["单位名称", "类别（人工指定）", "主数据", "合作关系", "本次动作"].map((h, i) => (
              <span key={h} style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: i >= 2 ? "right" : "left" }}>{h}</span>
            ))}
          </div>
          {ROWS.map((r) => (
            <div key={r.name} style={{ display: "grid", gridTemplateColumns: "1.8fr 1.1fr 110px 110px 100px", gap: 10, alignItems: "center",
              padding: "9px 14px", borderTop: "1px solid var(--line)",
              background: r.relation === "existing" ? "var(--surface-3)" : "transparent" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</span>
              {KA.SelectFilter ? <KA.SelectFilter label="" fullWidth value={r.kind} onChange={() => {}} options={KINDS} /> : <span>{r.kind}</span>}
              <span style={{ fontSize: 11, fontWeight: 700, textAlign: "right", color: r.match === "new" ? "var(--warn-ink)" : "var(--ok-ink)" }}>
                {r.match === "new" ? "需新建" : "已存在"}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, textAlign: "right", color: r.relation === "existing" ? "var(--ink-soft)" : "var(--brand-deep)" }}>
                {r.relation === "existing" ? "已存在（" + r.status + "）" : "将建立"}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, textAlign: "right", color: r.relation === "existing" ? "var(--ink-faint)" : "var(--ink)" }}>
                {r.relation === "existing" ? "跳过" : "生成"}
              </span>
            </div>
          ))}
        </P>

        <P>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 240, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.7 }}>
              将新建分供方主数据 <b>{newSuppliers.length}</b> 家 · 建立合作关系 <b>{willCreate.length}</b> 条 · 跳过已存在 <b>{dupRelations.length}</b> 条。
              <br />新建关系初始状态为「收集资料中」，后续状态流转仍在工作台完成。
            </span>
            {Button ? <Button variant="ghost" onClick={() => navigate("projectSupplier")}>取消</Button> : null}
            {Button ? <Button variant="primary" onClick={() => UI.toast("已建立 " + willCreate.length + " 条合作关系", "ok")}>确认生成</Button> : null}
          </div>
        </P>
      </div>
    );
  }

  window.ProjectSupplierImportScreen = ProjectSupplierImportScreen;
})();
