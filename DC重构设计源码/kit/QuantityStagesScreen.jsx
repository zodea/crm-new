// 阶段配置独立整页；依据 QuantityStageFormPage / Fields / Reporting 与 subcontract-quantity.md。
// 以下为独立设计样本，不播种正式项目，不按显示名推断项目、分项或报量身份。
(function () {
  const ITEMS = [{ id: "demo-wall", code: "WALL", name: "墙面腻子", trade: "油漆", unit: "m²" }, { id: "demo-floor", code: "FLOOR", name: "地砖铺贴", trade: "泥水", unit: "m²" }];
  const INITIAL = [{ id: "demo-stage-1", code: "PUTTY-01", name: "第一遍腻子", trade: "油漆", completionMode: "unit", sortOrder: 1, itemIds: ["demo-wall"] }, { id: "demo-stage-2", code: "PUTTY-02", name: "第二遍腻子", trade: "油漆", completionMode: "unit", sortOrder: 2, itemIds: ["demo-wall"] }];
  const blank = () => ({ id: "", code: "", name: "", trade: "", completionMode: "unit", sortOrder: 0, itemIds: [] });
  function QuantityStagesScreen({ params = {}, navigate }) {
    const KA = window.KitAtoms;
    const { Panel, Button } = window.DesignSystem_e3d871;
    const [stages, setStages] = React.useState(INITIAL);
    const [draft, setDraft] = React.useState({ ...INITIAL[0] });
    const [dirty, setDirty] = React.useState(false);
    const [reporting, setReporting] = React.useState({});
    const [selections, setSelections] = React.useState({});
    const [error, setError] = React.useState("");
    const [notice, setNotice] = React.useState("");
    const state = params.previewState || "ready";
    const readOnly = state === "readonly";
    const reportingDirty = ITEMS.some(i => (selections[i.id] || "") !== (reporting[i.id] || ""));
    const patch = value => { setDraft(d => ({ ...d, ...value })); setDirty(true); setNotice(""); };
    const leave = action => dirty || reportingDirty ? window.KitUI.confirm({ title: "放弃未保存的阶段输入？", message: "阶段字段或报量选择尚未保存。", confirmText: "放弃输入", onConfirm: action }) : action();
    const select = id => leave(() => { setDraft({ ...(stages.find(s => s.id === id) || blank()) }); setDirty(false); setSelections({ ...reporting }); setError(""); });
    const save = () => {
      if (!draft.code.trim() || !draft.name.trim() || !draft.trade.trim()) { setError("请填写阶段编码、阶段名称和工种。"); return; }
      if (stages.some(s => s.code === draft.code && s.id !== draft.id)) { setError("阶段编码已存在，请使用不同编码。"); return; }
      const saved = { ...draft, id: draft.id || "demo-stage-" + Date.now(), itemIds: draft.completionMode === "manual" ? [] : draft.itemIds };
      setReporting(current => Object.fromEntries(Object.entries(current).filter(([itemId, stageId]) => stageId !== saved.id || saved.itemIds.includes(itemId))));
      setSelections(current => Object.fromEntries(Object.entries(current).filter(([itemId, stageId]) => stageId !== saved.id || saved.itemIds.includes(itemId))));
      setStages(rows => [...rows.filter(s => s.id !== saved.id), saved]); setDraft(saved); setDirty(false); setError(""); setNotice("阶段已保存（设计演示）；新关联分项未自动指定报量阶段。");
    };
    return <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12, minWidth: 0, maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><Button onClick={() => leave(() => navigate("quantity"))}>返回工程量矩阵</Button><h1 style={{ fontSize: 20, margin: 0 }}>施工阶段配置</h1><span style={{ color: "var(--ink-soft)", fontSize: 12 }}>独立演示样本</span></div>
      {["loading", "error", "empty"].includes(state) ? <KA.StatePanel state={state} title={state === "loading" ? "正在读取阶段配置" : state === "error" ? "阶段配置暂不可用" : "本项目还没有施工阶段或计量分项"} description="先建立户型模板中的分项，再关联施工阶段。" actionLabel={state === "error" ? "重新读取" : undefined} onAction={() => navigate("quantityStages", { ...params, previewState: "ready" })} /> : <>
        {readOnly && <p role="status">仅可查看当前阶段与报量选择。</p>}
        {error && <p role="alert" style={{ color: "var(--danger-ink)" }}>{error} 未保存输入仍保留。</p>}
        {notice && <p role="status" style={{ color: "var(--brand)" }}>{notice}</p>}
        <Panel style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><label>当前阶段 <select className="dc-state-select" aria-label="当前施工阶段" value={draft.id} onChange={e => select(e.target.value)}><option value="">新建阶段</option>{stages.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>{!readOnly && <Button onClick={() => select("")}>新建阶段</Button>}</Panel>
        <Panel><KA.SectionHeader>阶段信息</KA.SectionHeader><fieldset disabled={readOnly || reportingDirty} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}><div className="dc-fields dc-form-fields">
          <label>阶段编码 *<input aria-label="阶段编码" value={draft.code} readOnly={!!draft.id} onChange={e => patch({ code: e.target.value })} /></label>
          <label>阶段名称 *<input aria-label="阶段名称" value={draft.name} onChange={e => patch({ name: e.target.value })} /></label>
          <label>工种 *<input aria-label="阶段工种" value={draft.trade} readOnly={!!draft.id} onChange={e => patch({ trade: e.target.value, itemIds: [] })} /></label>
          <label>完成方式 *<select aria-label="完成方式" value={draft.completionMode} disabled={!!draft.id} onChange={e => patch({ completionMode: e.target.value, itemIds: [] })}><option value="unit">逐户登记阶段完成</option><option value="manual">排程中手动填写进度</option></select></label>
          <label>显示顺序<input aria-label="阶段显示顺序" type="number" step="1" value={draft.sortOrder} onChange={e => patch({ sortOrder: Number(e.target.value) })} /></label>
        </div></fieldset></Panel>
        <Panel><KA.SectionHeader>关联计量分项</KA.SectionHeader><p>新关联默认不参与月度报量，请在下方单独指定。</p><fieldset disabled={readOnly || reportingDirty} style={{ border: 0, margin: 0, padding: 0 }}>
          {draft.completionMode === "manual" ? <p>手动进度阶段不关联计量分项，在排程中填写进度。</p> : ITEMS.filter(i => i.trade === draft.trade).length ? ITEMS.filter(i => i.trade === draft.trade).map(i => <label key={i.id} style={{ display: "block", marginBottom: 8 }}><input type="checkbox" checked={draft.itemIds.includes(i.id)} onChange={e => patch({ itemIds: e.target.checked ? [...draft.itemIds, i.id] : draft.itemIds.filter(id => id !== i.id) })} /> {i.name} · {i.code} · {i.unit}</label>) : <p>当前工种没有可关联分项，请先建立户型模板中的分项。</p>}
        </fieldset>{!readOnly && <Button disabled={reportingDirty} onClick={save}>保存阶段</Button>}</Panel>
        <Panel><KA.SectionHeader>月度报量阶段</KA.SectionHeader><p>同一分项可参与多阶段进度；月度报量只读取明确选定的一个阶段，也可保持未指定。</p>{dirty && <p role="status">请先保存或撤销阶段输入。</p>}
          {ITEMS.map(item => <div key={item.id} className="dc-fields" style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}><div>{item.name} · {item.unit}<p style={{ fontSize: 12, color: "var(--ink-soft)" }}>当前：{(stages.find(s => s.id === reporting[item.id]) || {}).name || "未指定"}</p></div><label>报量阶段<select aria-label={item.name + "的报量阶段"} disabled={readOnly || dirty} value={selections[item.id] || ""} onChange={e => setSelections(s => ({ ...s, [item.id]: e.target.value }))}><option value="">未指定</option>{stages.filter(s => s.completionMode === "unit" && s.itemIds.includes(item.id)).map(s => <option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}</select></label><Button disabled={readOnly || dirty || (selections[item.id] || "") === (reporting[item.id] || "")} onClick={() => { setReporting(r => ({ ...r, [item.id]: selections[item.id] || "" })); setNotice(item.name + "的报量选择已保存（设计演示）"); }}>保存选择</Button></div>)}
          {reportingDirty && <Button onClick={() => setSelections({ ...reporting })}>撤销未保存的报量选择</Button>}
        </Panel>
      </>}
    </div>;
  }
  window.QuantityStagesScreen = QuantityStagesScreen;
})();
