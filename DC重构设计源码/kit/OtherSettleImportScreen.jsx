// OtherSettleImportScreen — 支出结算历史迁入（route otherSettleImport ↔ 实现 /contract/other-settlement/import，
// 对应 app/components/other-settlement/OtherSettlementImportPage.vue；Q-A03-02 既有结算原图显式迁入中央事务）。
// 口径：
//   ① 完整 Native 原库：保留原稳定 ID、原文、原件、旧审计及原命令；旧回执只作历史证据，当前付款来源仍须真实费用
//      与当前可核实的结算净额；选择完整 SQLite 原库（≤64 MiB）+「从桌面设置导出完整一致快照」+ 明确清除来源包；
//      读取后显示 SHA-256、实际现行结算条数与冻结原图摘要；
//   ② 逐条确认实际主档：原项目 / 原工人 / 原分供方 → 当前真实目标 + 身份核对依据（必填，不按同名推断）；
//      勾选「已核对每条真实关系…未核实的旧付款或奖罚净额保持未知」（改动任一关系即取消勾选）；
//   ③ 吸底「确认迁入原结算图」：来源、全部关系与依据、勾选齐备才可用（需 other-settlement:write + core:migration:write）；
//   结果未知 → 「提交结果未知，请核对原编号」+ 核对原迁入；完成 → 原图已保存并读取核验 + 查看原结算 链接。
//   离开页面：未迁入来源或原编号待核对时二次确认。
// params.previewState：empty（尚未选择原库，初始态）/ ready（演示原库已核验）/ loading / error / readonly（缺迁入权限）/ recovery。
(function () {
  if (window.OtherSettleImportScreen) return;

  // —— 演示原库核验结果（匿名虚构；与 data.js 其他支出合同 qt1–qt3 世界观同源） ——
  const PREVIEW = {
    sha256: "c7a41e09f3b2d5a86e1f0c94b7d23a5e8f60b1c2d9e4a7f35b0c68d12e9f4a07",
    graphHash: "sha256:51b0e7d2a94c3f86e1a0d5b27c9f48e3a6d10b5c2e7f94a8d3b06c15e2f7a9d4",
    heads: 3,
    references: [
      { entityType: "projects", legacyId: "native-project-01", label: "合和新城" },
      { entityType: "suppliers", legacyId: "native-supplier-21", label: "广州建机租赁" },
      { entityType: "workers", legacyId: "native-worker-08", label: "张师傅（垫付人）" },
    ],
    // 候选主档在渲染时读取 window.APP（项目/分供方）与 KIT_DATA.workers，不按原名称预选
  };
  const ENTITY_LABEL = { projects: "项目", workers: "工人", suppliers: "分供方" };

  function OtherSettleImportScreen({ navigate, params = {} }) {
    const { Panel, Button } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const nav = navigate || (window.DC && window.DC.navigate);
    const state = params.previewState || "ready";
    const [loaded, setLoaded] = React.useState(state === "ready" || state === "readonly");
    const [targets, setTargets] = React.useState({});
    const [reasons, setReasons] = React.useState({});
    const [confirmed, setConfirmed] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [pending, setPending] = React.useState(state === "recovery" ? { commandId: "8e5d1c2a-4b7f-4e90-a3d6-0f9b2c7e1a58", saved: false } : null);
    const [done, setDone] = React.useState(null);
    if (!Panel || !KA.StatePanel) return null;

    const A = window.APP;
    const candidates = {
      projects: A ? A.rows("projects").map((p) => ({ id: p.id, label: p.name })) : [],
      suppliers: A ? A.rows("suppliers").map((x) => ({ id: x.id, label: x.name })) : [],
      workers: ((window.KIT_DATA || {}).workers || []).map((w) => ({ id: w.id, label: w.name })),
    };
    const canMigrate = state !== "readonly";
    const refs = loaded ? PREVIEW.references : [];
    const keyOf = (r) => r.entityType + ":" + r.legacyId;
    const mapped = refs.filter((r) => targets[keyOf(r)] && String(reasons[keyOf(r)] || "").trim()).length;
    const ready = loaded && confirmed && mapped === refs.length && !pending && !busy && canMigrate && !done;
    const setT = (k, v) => { setTargets((t) => Object.assign({}, t, { [k]: v })); setConfirmed(false); };
    const setR = (k, v) => { setReasons((t) => Object.assign({}, t, { [k]: v })); setConfirmed(false); };
    const linkStyle = { border: 0, background: "transparent", padding: 0, color: "var(--brand)", textDecoration: "underline", cursor: "pointer", fontSize: 13 };

    const leave = () => {
      const go = () => nav && nav("otherSettle", {});
      if (!pending && (!loaded || done)) return go();
      UI.confirm({ title: "离开迁入核验", message: pending ? "原迁入仍需核对；编号已保留，重新打开后请继续核对原编号。确认离开？" : "来源包与逐条关系尚未迁入，确认离开？", confirmText: "离开", onConfirm: go });
    };
    const selectSource = () => { setBusy(true); setTimeout(() => { setBusy(false); setLoaded(true); setTargets({}); setReasons({}); setConfirmed(false); setDone(null); }, 400); };
    const clearSource = () => { if (pending) return; setLoaded(false); setTargets({}); setReasons({}); setConfirmed(false); };
    const importSource = () => {
      if (!ready) return;
      setBusy(true);
      setTimeout(() => { setBusy(false); setDone({ ids: ["other-settlement-3f0a91", "other-settlement-7c22b4", "other-settlement-e81d05"] }); UI.toast("原图已保存并读取核验（演示）", "ok"); }, 500);
    };

    const head = (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button icon="arrow-left" onClick={leave}>返回结算</Button>
        <span style={{ fontSize: 16, fontWeight: 800 }}>支出结算历史迁入</span>
      </div>
    );
    const wrap = (children) => <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 14, minWidth: 0 }}>{head}{children}</div>;
    if (state === "loading") return wrap(<KA.StatePanel state="loading" title="正在核对迁入会话" />);
    if (state === "error") return wrap(<KA.StatePanel state="error" title="身份或来源变化，请恢复原会话并核对原迁入编号" actionLabel="重新核对会话" onAction={() => nav && nav("otherSettleImport", { previewState: "ready" })} />);

    return wrap(<>
      {state === "readonly" && <KA.StatePanel compact state="forbidden" title="当前会话缺少结算写入或迁入权限" description="可查看原库核验结果，不能确认迁入。" />}
      {pending && (
        <Panel padding={14} role="status" style={{ display: "grid", gap: 8, fontSize: 13 }}>
          <p style={{ margin: 0, wordBreak: "break-all" }}>{pending.saved ? "已保存待刷新，只重试读取" : "提交结果未知，请核对原编号"} · {pending.commandId}</p>
          <div><Button onClick={() => { setPending(null); UI.toast("原迁入编号已核对：未应用，可重新明确提交（演示）", "ok"); }}>核对原迁入</Button></div>
        </Panel>
      )}

      <Panel padding={16} style={{ display: "grid", gap: 10, minWidth: 0 }}>
        <KA.SectionHeader>完整 Native 原库</KA.SectionHeader>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.8 }}>保留原稳定ID、原文、原件、旧审计及原命令。旧回执作为历史证据保存；当前付款来源仍须真实费用与当前可核实的结算净额。</p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Button icon="folder-open" disabled={!!pending || busy} onClick={selectSource}>{busy && !loaded ? "正在核验完整原库…" : "选择完整 SQLite 原库"}</Button>
          <button type="button" style={linkStyle} onClick={() => nav && nav("dataMigration", {})}>从桌面设置导出完整一致快照</button>
          <Button disabled={!!pending || busy || !loaded} onClick={clearSource}>明确清除来源包</Button>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>单个完整原库不超过 64 MiB；超出时保留原库，不截取迁入。</p>
        {loaded && <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", wordBreak: "break-all" }}>完整原库 SHA-256 {PREVIEW.sha256}</p>}
        {loaded && <p style={{ margin: 0, fontSize: 13, wordBreak: "break-all" }}>实际现行结算 {PREVIEW.heads} 条；冻结原图摘要 {PREVIEW.graphHash}</p>}
      </Panel>

      {loaded && (
        <Panel padding={16} style={{ display: "grid", gap: 12, minWidth: 0 }}>
          <KA.SectionHeader>逐条确认实际主档</KA.SectionHeader>
          {refs.map((r) => {
            const k = keyOf(r);
            return (
              <div key={k} className="dc-fields" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
                <p style={{ margin: 0, fontSize: 13, wordBreak: "break-all", alignSelf: "center" }}>原{ENTITY_LABEL[r.entityType]} {r.label} · {r.legacyId}</p>
                <label>当前真实目标
                  <select value={targets[k] || ""} disabled={!!pending || busy} onChange={(e) => setT(k, e.target.value)}>
                    <option value="">请选择实际主档</option>
                    {candidates[r.entityType].map((t) => <option key={t.id} value={t.id}>{t.label} · {t.id}</option>)}
                  </select>
                </label>
                <label style={{ gridColumn: "1 / -1" }}>身份核对依据
                  <input value={reasons[k] || ""} disabled={!!pending || busy} placeholder="根据原件与实际主档逐条核对，不按同名推断" onChange={(e) => setR(k, e.target.value)} />
                </label>
              </div>
            );
          })}
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={confirmed} disabled={!!pending || busy} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>已核对每条真实关系，确认迁入冻结原图与原件；未核实的旧付款或奖罚净额保持未知。</span>
          </label>
        </Panel>
      )}

      {done && (
        <Panel padding={16} role="status" style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13 }}>原图已保存并读取核验。</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {/* 实现端链到 /contract/other-settlement/:id?origin=real；DC 暂无其他支出结算详情落点，回到结算列表 */}
            {done.ids.map((id) => <button key={id} type="button" style={linkStyle} onClick={() => nav && nav("otherSettle", {})}>查看原结算 {id}</button>)}
          </div>
        </Panel>
      )}

      <div style={{ position: "sticky", bottom: 0, zIndex: 15, display: "flex", justifyContent: "flex-end", gap: 8, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", boxShadow: "0 -4px 16px rgba(16,24,40,0.06)" }}>
        <Button variant="primary" icon="database-backup" disabled={!ready} onClick={importSource}>{busy && loaded ? "正在迁入…" : "确认迁入原结算图"}</Button>
      </div>
    </>);
  }

  window.OtherSettleImportScreen = OtherSettleImportScreen;
})();
