// 工程量原库接管设计预览；只展示合成示例，不读取或修改文件。
(function () {
  function QuantityImportScreen({ params = {}, navigate }) {
    const { Panel, Button } = window.DesignSystem_e3d871;
    const KA = window.KitAtoms;
    const state = params.previewState || "ready";
    const [inspected, setInspected] = React.useState(false);
    const [project, setProject] = React.useState("");
    const [person, setPerson] = React.useState("");
    const readOnly = state === "readonly";
    const pending = state === "pending";
    const confirm = (title, message) => window.KitUI.confirm({ title, message, confirmText: "预览", onConfirm: () => {} });
    return <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
      <div><h1 style={{ margin: 0, fontSize: 20 }}>工程量原库接管</h1><p style={{ marginBottom: 0, color: "var(--ink-soft)" }}>明确选择项目和责任身份，核对完整原库后采用本领域资料。</p></div>
      <button type="button" onClick={() => navigate("quantity", {})} style={{ justifySelf: "start", border: 0, background: "none", color: "var(--brand)", padding: 0 }}>返回工程量矩阵</button>
      {state === "loading" && <KA.StatePanel state="loading" title="正在读取接管权限" />}
      {state === "error" && <KA.StatePanel state="error" title="接管权限读取失败" description="请重新读取后核对。" actionLabel="重新读取" onAction={() => navigate("quantityImport", { previewState: "ready" })} />}
      {!['loading', 'error'].includes(state) && <>
        {readOnly && <KA.StatePanel compact state="forbidden" title="仅可查看" description="当前没有接管权限。" />}
        {pending && <Panel><strong>原命令结果待核对</strong><p>保留原编号，核对结果后再继续操作。</p><Button onClick={() => confirm("核对原命令", "仅预览结果恢复，不访问实际数据。")}>核对原结果</Button></Panel>}
        <Panel><p style={{ color: "var(--ink-soft)", lineHeight: 1.7 }}>原 SQLite 文件保持在你保存的位置。系统保全本域未知扩展、历史冻结及真实零；历史合同清单引用只供原链保全。</p>
          <div className="dc-fields"><label>工程量 SQLite 原库<input type="file" disabled={readOnly || pending} accept=".sqlite,.sqlite3,.db" onChange={() => setInspected(true)} /></label></div>
          {state === "empty" && <p>原库没有可采用的工程量图，不会生成空模板或施工记录。</p>}
          {inspected && state !== "empty" && <><div className="dc-fields" style={{ marginTop: 16 }}><label>原项目：示例工程<select value={project} onChange={e => setProject(e.target.value)} disabled={readOnly || pending}><option value="">明确选择正式项目</option><option value="project">示例正式项目</option></select></label><label>原班组：示例班组<select value={person} onChange={e => setPerson(e.target.value)} disabled={readOnly || pending}><option value="">明确选择正式身份</option><option value="crew">示例正式班组</option></select></label></div><div style={{ marginTop: 16 }}><Button disabled={!project || !person || readOnly || pending} onClick={() => confirm("采用完整工程量", "目标已有工程量时整批拒绝。原 SQLite 文件继续由你保留。")}>核对并采用完整工程量</Button></div></>}
        </Panel>
        <Panel><KA.SectionHeader>采用历史</KA.SectionHeader><p>示例批次 · 已采用</p><Button disabled={readOnly || pending} onClick={() => confirm("恢复本批工程量采用", "系统先核对整批依赖，存在后续引用时拒绝恢复；原件、审计与回执保留。")}>核对并恢复本批采用</Button></Panel>
      </>}
    </div>;
  }
  window.QuantityImportScreen = QuantityImportScreen;
})();
