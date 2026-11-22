// BoqBuildingEvidenceScreen — 原合同清单楼栋证据更正 / 只读来源整页（路由 boqBuildingEvidence，
// 对应实现 /contract/boq/building-evidence?project&contract&origin=real&line&mode=read&returnTo）。
// 依据：app/pages/contract/boq/_components/BoqBuildingEvidenceScreen.vue、app/composables/useBoqBuildingEvidence.ts、
//       app/lib/boq/central-building-contract.ts、app/lib/schedule/binding-navigation.ts、ADR 0014（独立整页表单）、
//       ADR 0017（暂估排程绑定合同）、docs/design/runtime-reference-audit.md（#445 行）。
// 入口（实现）：排程「绑定施工合同」复核的阻断区「补齐合同楼栋证据」（未绑定 → 更正态）；
//       已绑定分组从绑定页或排程楼层视图「返回合同清单来源」进入 → 只读态（mode=read）。不从合同清单页直接进入。
// 规则：只有「已确认导入」基准行可更正，且只改显式楼栋；签证新增行、来源待核行只读。
//       数量、单价、签证审批与历史快照保持不变；保存或取消后回到原绑定分组重新预览。
//       只读态展示绑定时保存的原楼层计划链接；旧缺失明细不由当前模板补造。写权限 owner-document:write。
// params：project、contract、line（清单行 ID）、mode（"read" = 只读来源）；
//   previewState：ready | empty（未选清单行）| loading | error（上下文不匹配）| readonly（= mode=read 只读来源）
//   | pending（上次提交待核对）。演示数据仅在本文件内，不播种正式清单。
(function () {
  const DEMO = {
    contractName: "SG-2026-014 户内装修施工合同（演示）",
    sourceVersion: "boq-src-v12 · 2026-09-28T08:14:03Z",
    buildings: [
      { id: "b3", code: "B3", name: "3 号楼" },
      { id: "b3r", code: "B3-R", name: "3 号楼 屋面层" },
      { id: "b5", code: "B5", name: "5 号楼" },
    ],
    lines: [
      { id: "l1", itemName: "墙砖粘贴", unit: "m²", building: "3号楼", qty: 7128, unitPrice: 68, effectiveQty: 7128, effectiveUnitPrice: 68, sourceKind: "confirmed-import", readOnlyReason: null },
      { id: "l2", itemName: "屋面防水卷材", unit: "m²", building: null, qty: 1240.5, unitPrice: 46, effectiveQty: 1240.5, effectiveUnitPrice: 46, sourceKind: "confirmed-import", readOnlyReason: null },
      { id: "l3", itemName: "入户门槛石安装", unit: "m", building: "3号楼", qty: 96, unitPrice: 120, effectiveQty: 96, effectiveUnitPrice: 120, sourceKind: "change-addition", readOnlyReason: "签证新增行由签证确认生成，不能在此更正楼栋。" },
      { id: "l4", itemName: "线管敷设", unit: "m", building: "3栋?", qty: null, unitPrice: 12.5, effectiveQty: null, effectiveUnitPrice: 12.5, sourceKind: "unknown", readOnlyReason: null },
    ],
    audit: [
      { id: "a1", occurredAt: "2026-09-28 16:40", beforeBuilding: null, building: "3 号楼", reason: "原件第 4 页「3#楼」手写标注，按合同附件二核对。" },
    ],
  };
  const kindLabel = (k) => (k === "confirmed-import" ? "已确认导入" : k === "change-addition" ? "签证新增，只读" : "来源待核，只读");
  const qtyText = (v) => (v == null ? "—" : String(Math.round(v * 100) / 100));
  const SELECT = { width: "100%", minWidth: 0, boxSizing: "border-box", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", padding: "8px 11px", fontSize: 13, background: "#fff", color: "var(--ink)" };

  function BoqBuildingEvidenceScreen({ navigate, params }) {
    const p = params || {};
    const { Panel, Button, Icon } = window.DesignSystem_e3d871;
    const KA = window.KitAtoms || {};
    const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const state = p.previewState || "ready";
    const readonlyMode = p.mode === "read" || state === "readonly";
    const pending = state === "pending";
    const [lineId, setLineId] = React.useState(state === "empty" ? "" : (p.line || "l2"));
    const [buildingId, setBuildingId] = React.useState("");
    const [reason, setReason] = React.useState("");
    const selectedLine = DEMO.lines.find((l) => l.id === lineId) || null;
    const dirty = !readonlyMode && Boolean(buildingId || reason.trim());
    const canEdit = !readonlyMode && !pending && !!selectedLine && selectedLine.sourceKind === "confirmed-import" && !selectedLine.readOnlyReason;

    const back = () => { if (window.DC && window.DC.closeActiveTab) window.DC.closeActiveTab(); navigate("scheduleBind"); };
    const guard = (action) => {
      if (pending) return;
      if (!dirty) { action(); return; }
      UI().confirm({ title: "放弃本次楼栋更正？", message: "楼栋选择和更正理由尚未保存，合同清单保持不变。", confirmText: "放弃更正", onConfirm: action });
    };
    const selectLine = (next) => {
      if (!next || next === lineId) return;
      guard(() => { setLineId(next); setBuildingId(""); setReason(""); });
    };
    const save = () => {
      if (!canEdit || !buildingId || !reason.trim()) return;
      UI().confirm({
        title: "更正合同清单的楼栋证据？",
        message: "仅更正所选清单行的显式楼栋，数量、单价、签证审批和历史快照保持不变。返回绑定页后需重新预览。",
        confirmText: "保存楼栋证据",
        onConfirm: () => { UI().toast("合同楼栋证据已更正，请重新核对绑定差异", "ok"); back(); },
      });
    };

    const header = (
      <Panel padding={16} style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
        <button type="button" aria-label="返回合同绑定" disabled={pending} onClick={() => guard(back)} style={{ flex: "none", width: 32, height: 32, display: "grid", placeItems: "center", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", background: "var(--panel)", cursor: pending ? "not-allowed" : "pointer", opacity: pending ? 0.5 : 1 }}>
          {Icon ? <Icon name="arrow-left" size={15} /> : "←"}
        </button>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "var(--brand)" }}>合同清单 · 来源更正</p>
          <h1 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 850 }}>{readonlyMode ? "合同清单来源" : "更正楼栋证据"}</h1>
          <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: "24px", color: "var(--ink-soft)" }}>
            {readonlyMode ? "只读核对合同来源与绑定时保存的楼层关系，原计划和数量快照保持不变。" : "核对已确认导入的原清单行，仅更正明确的楼栋归属。保存或取消后回到原分组重新预览。"}
          </p>
        </div>
      </Panel>
    );

    if (state === "loading" || state === "error") {
      return (
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          {header}
          {state === "loading" && KA.StatePanel && <KA.StatePanel state="loading" title="正在核对合同清单来源" compact />}
          {state === "error" && (
            <div role="alert" style={{ display: "grid", gap: 8, padding: 12, border: "1px solid var(--danger)", borderRadius: "var(--radius-card)", background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 12 }}>
              <p style={{ margin: 0 }}>项目、合同或返回分组不匹配，请从原绑定页重新打开</p>
              <div><Button onClick={() => navigate("boqBuildingEvidence", { ...p, previewState: "ready" })}>重新核对资料</Button></div>
            </div>
          )}
        </div>
      );
    }

    const facts = selectedLine ? [
      ["当前楼栋证据", selectedLine.building || "未提供"],
      ["合同量 / 单位", qtyText(selectedLine.qty) + " / " + (selectedLine.unit || "未提供")],
      ["原单价", qtyText(selectedLine.unitPrice)],
      ["生效量 / 生效单价", qtyText(selectedLine.effectiveQty) + " / " + qtyText(selectedLine.effectiveUnitPrice)],
    ] : [];
    const floorLinks = readonlyMode && selectedLine && selectedLine.sourceKind === "confirmed-import" && selectedLine.id !== "l2"
      ? [{ id: "fp-1", label: "查看原楼层计划 1" }, { id: "fp-2", label: "查看原楼层计划 2" }]
      : [];

    return (
      <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
        {header}
        {pending && (
          <section role="alert" style={{ display: "grid", gap: 8, padding: 12, border: "1px solid var(--warn)", borderRadius: 10, background: "var(--warn-soft)", fontSize: 12 }}>
            <p style={{ margin: 0 }}>上次提交结果尚未确认，输入已保留。请核对原提交后继续修改。</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Button variant="primary" onClick={() => { UI().toast("合同楼栋证据已更正，请重新核对绑定差异", "ok"); back(); }}>核对原提交</Button>
              <Button onClick={() => navigate("boqBuildingEvidence", { ...p, previewState: "ready" })}>重新核对权限与资料</Button>
            </div>
          </section>
        )}
        <Panel as="form" padding={16} onSubmit={(e) => { e.preventDefault(); save(); }} style={{ display: "grid", gap: 16, minWidth: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, wordBreak: "break-word" }}>{DEMO.contractName}</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-soft)" }}>只有已确认导入基准行可更正。签证新增行和来源待核行只读。</p>
          </div>
          <label style={{ display: "grid", gap: 4, maxWidth: 768, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>合同清单行</span>
            <select aria-label="合同清单行" value={lineId} disabled={pending} onChange={(e) => selectLine(e.target.value)} style={SELECT}>
              <option value="" disabled>选择需要核对的清单行</option>
              {DEMO.lines.map((l) => <option key={l.id} value={l.id}>{l.itemName + " · " + (l.unit || "单位未提供") + " · " + (l.building || "楼栋未提供") + " · 原量 " + (l.qty == null ? "未提供" : l.qty) + " · " + kindLabel(l.sourceKind)}</option>)}
            </select>
          </label>

          {selectedLine && (
            <>
              <section aria-label="清单原始依据" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 10rem), 1fr))", padding: 12, borderRadius: 8, background: "var(--surface-2)", fontSize: 12, minWidth: 0 }}>
                {facts.map(([label, value]) => (
                  <div key={label}><span style={{ display: "block", color: "var(--ink-faint)" }}>{label}</span><strong style={{ display: "block", marginTop: 4, wordBreak: "break-word", fontFamily: label === "当前楼栋证据" ? "inherit" : "var(--font-mono)" }}>{value}</strong></div>
                ))}
              </section>
              {(selectedLine.readOnlyReason || selectedLine.sourceKind !== "confirmed-import") && (
                <p role="status" style={{ margin: 0, padding: 12, border: "1px solid var(--warn)", borderRadius: 8, background: "var(--warn-soft)", color: "var(--warn-ink)", fontSize: 12, lineHeight: "24px" }}>
                  {selectedLine.readOnlyReason || "此行没有可更正的已确认导入基准，仅可读取。"}
                </p>
              )}
              {!readonlyMode && (
                <div style={{ display: "grid", gap: 16, maxWidth: 768, minWidth: 0 }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>实际覆盖楼栋</span>
                    <select aria-label="实际覆盖楼栋" value={buildingId} disabled={!canEdit} onChange={(e) => setBuildingId(e.target.value)} style={SELECT}>
                      <option value="" disabled>选择同项目的实际楼栋</option>
                      {DEMO.buildings.map((b) => <option key={b.id} value={b.id}>{b.name + (b.code ? " · " + b.code : "")}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 700 }}>更正理由
                    <textarea value={reason} disabled={!canEdit} maxLength={1000} placeholder="填写所核对的原件位置及更正原因" onChange={(e) => setReason(e.target.value)} style={{ ...SELECT, minHeight: 96, resize: "vertical", padding: 12, fontWeight: 400 }} />
                  </label>
                </div>
              )}
            </>
          )}
          {!selectedLine && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--ink-faint)" }}>请先选择需要核对的合同清单行。</p>}

          {readonlyMode && selectedLine && (
            <section aria-label="绑定时的原楼层计划" style={{ display: "grid", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>绑定时的原楼层计划</h3>
              {floorLinks.map((f) => (
                <button key={f.id} type="button" onClick={() => navigate("schedule", { floorPlan: f.id, bindingLine: selectedLine.id })} style={{ justifySelf: "start", border: 0, background: "transparent", padding: 0, color: "var(--brand)", textDecoration: "underline", fontSize: 12, cursor: "pointer" }}>{f.label}</button>
              ))}
              {floorLinks.length === 0 && <p style={{ margin: 0, fontSize: 12, color: "var(--warn-ink)" }}>该清单行没有可读取的绑定楼层关系；旧缺失明细不会由当前模板补造。</p>}
            </section>
          )}

          <details style={{ minWidth: 0, fontSize: 11, color: "var(--ink-faint)" }}>
            <summary style={{ cursor: "pointer" }}>查看来源版本与更正记录</summary>
            <p style={{ margin: "8px 0 0", wordBreak: "break-all" }}>{DEMO.sourceVersion}</p>
            <ul style={{ margin: "8px 0 0", paddingLeft: 16, display: "grid", gap: 8 }}>
              {DEMO.audit.map((a) => <li key={a.id} style={{ wordBreak: "break-word" }}>{a.occurredAt} · {a.beforeBuilding || "未提供"} → {a.building} · {a.reason}</li>)}
            </ul>
          </details>

          <footer style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <Button disabled={pending} onClick={() => guard(back)}>{readonlyMode ? "返回绑定依据" : "取消并返回绑定"}</Button>
            {!readonlyMode && <Button variant="primary" disabled={!canEdit || !buildingId || !reason.trim()} onClick={save}>保存楼栋证据</Button>}
          </footer>
        </Panel>
      </div>
    );
  }

  window.BoqBuildingEvidenceScreen = BoqBuildingEvidenceScreen;
})();
