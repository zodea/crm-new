// QuotationImportScreen — 报价来源迁入（route quotationImport ↔ 实现 /material/quotations/import，
// 对应 app/components/material/quotation/QuotationImportPage.vue；Q-A02-03 报价图显式迁入）。
// 口径：
//   ① 核验本地报价来源：说明（保留原报价身份、材料行、版本、原件和原命令；本地报价完整核验迁入后才能切换平台；
//      中央已有报价时拒绝覆盖）+「从桌面设置导出完整一致快照」+ 选择完整 SQLite 来源快照（Native v58–v60）+ 清除当前来源包；
//   ② 结果未知 → 原提交恢复面板（只核对原迁入编号）；
//   ③ 来源包待核验内容：报价/冻结版本/原件/原命令计数 + 报价头清单；原项目、原分供方逐条选择当前正式记录
//      （名称相同不代表同一实体）+「我已逐条核对…」勾选（改选即取消勾选）+ SQLite 实际摘要与来源摘要；
//      「核验并迁入报价」需 material-quotation:write 与 core:migration:write；
//   ④ 完成：报价迁入已保存并核验读取 · 原报价身份数 · 批次 +「重新运行本地数据迁移预检」。
//   离开页面：未迁入来源或原编号待核对时二次确认。
// params.previewState：empty（尚未选择来源，初始态）/ ready（演示来源已读取）/ loading / error / readonly（缺迁入权限）/ recovery。
(function () {
  if (window.QuotationImportScreen) return;

  // —— 演示来源图（匿名虚构；与 kit/QuotationData.jsx 世界观同源） ——
  const GRAPH = {
    heads: [
      { id: "native-q-0007", party: "汇丰水泥制品" },
      { id: "native-q-0012", party: "穗建五金机电经营部" },
      { id: "native-q-0015", party: "佛山顺鑫瓷砖商行" },
    ],
    counts: { quotations: 3, history: 5, originals: 4, commands: 5 },
    references: [
      { entityType: "projects", legacyId: "native-project-03" },
      { entityType: "suppliers", legacyId: "native-supplier-11" },
      { entityType: "suppliers", legacyId: "native-supplier-14" },
    ],
    sqliteSha: "9f2c4be1d07a63e58c11f4a2b9d0e7c5a83f61d2c4e9b0a7f15d6c38e2a4b901",
    graphHash: "sha256:4e1a77c09b3d25f6e8a0c4d19b7e52a3f60c8d1e2b9a4f75c3d06e18a9b2c4d7",
  };
  // 当前正式记录候选：渲染时读取 window.APP 的项目/分供方，版本号为演示值；名称缺失显示「名称未填写」
  const demoVersion = (id) => String((id.replace(/\D/g, "") * 3) % 17 + 1);

  function QuotationImportScreen({ navigate, params = {} }) {
    const { Panel, Button } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const nav = navigate || (window.DC && window.DC.navigate);
    const state = params.previewState || "ready";
    const [loaded, setLoaded] = React.useState(state === "ready" || state === "readonly");
    const [targets, setTargets] = React.useState({});
    const [confirmed, setConfirmed] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [pending, setPending] = React.useState(state === "recovery" ? { commandId: "3b7f2a90-1c4e-4d8a-9e21-6f0b5c7d8e14", saved: false } : null);
    const [done, setDone] = React.useState(null);
    if (!Panel || !KA.StatePanel) return null;

    const A = window.APP;
    const TARGETS = {
      projects: A ? A.rows("projects").map((p) => ({ id: p.id, label: p.name, version: demoVersion(p.id) })) : [],
      suppliers: A ? A.rows("suppliers").map((x) => ({ id: x.id, label: x.name, version: demoVersion(x.id) })) : [],
    };
    const canMigrate = state !== "readonly";
    const refs = loaded ? GRAPH.references : [];
    const keyOf = (r) => r.entityType + ":" + r.legacyId;
    const bound = refs.filter((r) => targets[keyOf(r)]).length;
    const ready = loaded && bound === refs.length && (!refs.length || confirmed);
    const pick = (k, v) => { setTargets((t) => Object.assign({}, t, { [k]: v })); setConfirmed(false); };
    const linkStyle = { border: 0, background: "transparent", padding: 0, color: "var(--brand)", textDecoration: "underline", cursor: "pointer", fontSize: 13 };

    const leave = () => {
      const go = () => nav && nav("quotation", {});
      if (!pending && (!loaded || done)) return go();
      UI.confirm({ title: "离开报价迁入", message: pending ? "原迁入仍需核对；编号已保留，重新打开后请继续核对原编号。确认离开？" : "来源包与逐条关系尚未迁入，确认离开？", confirmText: "离开", onConfirm: go });
    };
    const selectSource = () => { setBusy(true); setTimeout(() => { setBusy(false); setLoaded(true); setTargets({}); setConfirmed(false); setDone(null); }, 400); };
    const clearSource = () => { if (pending || busy) return; setLoaded(false); setTargets({}); setConfirmed(false); };
    const execute = () => {
      if (!ready || pending || busy || !canMigrate) return;
      setBusy(true);
      setTimeout(() => { setBusy(false); setDone({ count: GRAPH.heads.length, batchId: "quotation-import-" + Math.random().toString(16).slice(2, 10) }); UI.toast("报价迁入已保存并核验读取（演示）", "ok"); }, 500);
    };
    const recover = () => { setPending(null); UI.toast("原迁入编号已核对：未应用，可重新明确提交（演示）", "ok"); };

    const head = (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button icon="arrow-left" onClick={leave}>返回报价清单</Button>
        <span style={{ fontSize: 16, fontWeight: 800 }}>报价来源迁入</span>
      </div>
    );
    const wrap = (children) => <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 14, minWidth: 0 }}>{head}{children}</div>;
    if (state === "loading") return wrap(<KA.StatePanel state="loading" title="正在核对迁入会话" />);

    return wrap(<>
      <Panel padding={16} style={{ display: "grid", gap: 10 }}>
        <KA.SectionHeader>核验本地报价来源</KA.SectionHeader>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.7 }}>保留原报价身份、材料行、版本、原件和原命令。本地报价必须完整核验迁入后，才能切换平台。当前中央已有报价时会拒绝覆盖，原本地库和备份仍可恢复。</p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <button type="button" style={linkStyle} onClick={() => nav && nav("dataMigration", {})}>从桌面设置导出完整一致快照</button>
          <Button icon="folder-open" disabled={busy || !!pending || state === "error"} onClick={selectSource}>{busy && !loaded ? "正在只读核验来源…" : "选择完整 SQLite 来源快照"}</Button>
          {loaded && <Button disabled={busy || !!pending} onClick={clearSource}>清除当前来源包</Button>}
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>来源快照只读打开；原库版本须在已核验的 Native v58–v60 范围内，否则保留原库不迁入。</p>
      </Panel>

      {pending && (
        <Panel padding={16} role="status" aria-label="原提交恢复" style={{ display: "grid", gap: 10 }}>
          <b>{pending.saved ? "已保存待刷新" : "原提交结果未知"}</b>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", overflowWrap: "anywhere" }}>{pending.saved ? "保留本页输入，重新读取同一记录确认保存。" : "保留本页输入，先核对原编号；确认原提交未应用后才能再次保存。"}原提交编号：{pending.commandId}</p>
          <div><Button onClick={recover}>{pending.saved ? "重新读取已保存记录" : "核对原提交"}</Button></div>
        </Panel>
      )}

      {state === "error" && <KA.StatePanel compact state="error" title="报价迁入仍需核对" description="身份或来源变化，请恢复原会话后核对原迁入编号" />}
      {state === "readonly" && <KA.StatePanel compact state="forbidden" title="当前会话缺少报价写入或迁入权限" description="可查看来源核验内容，不能执行迁入。" />}

      {loaded && state !== "error" && (
        <Panel padding={16} style={{ display: "grid", gap: 12, minWidth: 0 }}>
          <KA.SectionHeader>来源包待核验内容</KA.SectionHeader>
          <p style={{ margin: 0, fontSize: 13 }}>报价 {GRAPH.counts.quotations} 份 · 冻结版本 {GRAPH.counts.history} 个 · 原件 {GRAPH.counts.originals} 份 · 原命令 {GRAPH.counts.commands} 条</p>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
            {GRAPH.heads.map((h) => <li key={h.id}>{h.party} · 原身份 {h.id}</li>)}
          </ul>
          {refs.length > 0 && (
            <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>逐条确认原库身份对应的当前正式记录；名称相同不代表同一实体，原编号及冻结历史不会被改写。</p>
              <div className="dc-fields">
                {refs.map((r) => (
                  <label key={keyOf(r)}>{(r.entityType === "projects" ? "原项目 " : "原分供方 ") + r.legacyId}
                    <select value={targets[keyOf(r)] || ""} disabled={busy || !!pending} onChange={(e) => pick(keyOf(r), e.target.value)}>
                      <option value="">请选择实际对应记录</option>
                      {TARGETS[r.entityType].map((t) => <option key={t.id} value={t.id}>{(t.label || "名称未填写") + " · " + t.id + " · 版本 " + t.version}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={confirmed} disabled={busy || !!pending || bound !== refs.length} onChange={(e) => setConfirmed(e.target.checked)} />
                我已逐条核对原身份与目标记录的对应关系
              </label>
            </div>
          )}
          <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)", wordBreak: "break-all" }}>完整 SQLite 实际摘要 {GRAPH.sqliteSha}</p>
          <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)", wordBreak: "break-all" }}>完整来源摘要 {GRAPH.graphHash}</p>
          <div><Button variant="primary" icon="database-backup" disabled={busy || !!pending || !ready || !canMigrate || !!done} onClick={execute}>{busy ? "正在核验并迁入…" : "核验并迁入报价"}</Button></div>
        </Panel>
      )}

      {done && (
        <Panel padding={16} role="status" style={{ display: "grid", gap: 8, fontSize: 13 }}>
          <b>报价迁入已保存并核验读取</b>
          <span>原报价身份 {done.count} 个 · 批次 {done.batchId}</span>
          <div><button type="button" style={linkStyle} onClick={() => nav && nav("dataMigration", {})}>重新运行本地数据迁移预检</button></div>
        </Panel>
      )}
    </>);
  }

  window.QuotationImportScreen = QuotationImportScreen;
})();
