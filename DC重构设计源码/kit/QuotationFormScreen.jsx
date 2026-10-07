// QuotationFormScreen — 材料报价整页表单（route quotationForm ↔ 实现 /material/quotations/form/:id?，
// 对应 app/components/material/quotation/QuotationFormPage.vue；ADR 0014 整页表单）。
// 不走 kit/forms 的 registerForm：KitFormPage 写 window.APP 集合，报价属独立 material-quotations owner
// （本稿 window.QUOTATION_DEMO），且材料明细是逐行卡片（13 个原文字段）；因此本屏未复用 FormPage 的左侧分区锚点
// （实现端 EntityFormShell 有 报价资料/材料明细/原件与备注 三分区锚点），以分区卡片顺序呈现。
// 口径（与实现端一致）：
//   ① 报价资料：报价方原文*（未建档可直接保存，不自动建分供方）/ 已核验分供方（可空）/ 实际适用范围
//      （范围未知 · 通用报价（明确无项目）· 明确项目）/ 已核验项目*（仅明确项目时出现）/ 原报价日期（未知留空）；
//   ② 材料原始明细：名称* 规格 等级 品牌 原计价单位* 原报价单价 报价数量 含税口径（未知/含税/不含税）
//      原适用税率% 运费/数量/付款/有效条件；数字留空=未知、0=原件明确为零；可移除行（历史版本保留）；
//   ③ 附件与备注：选择真实报价原件（单份 ≤10 MiB），正文与报价同次保存；已有原件可删除/恢复；
//   保存 = 追加不可变冻结版本；吸底 取消 / 保存并新建 / 保存 +「【保存】后关闭」（无草稿、无提交）。
//   结果未知 → 原提交恢复面板（核对原编号）；版本冲突 → 展示最新版本并「核对最新版本并保留当前输入」。
// params：{ id?, previewState? }；previewState：loading / error / readonly（当前会话仅可读取报价）/
//         recovery（原提交结果未知）/ conflict（报价已被他人更新）。
(function () {
  if (window.QuotationFormScreen) return;

  const CONDITIONS = [{ key: "freight", label: "运费条件" }, { key: "quantityCondition", label: "数量条件" }, { key: "paymentCondition", label: "付款条件" }, { key: "validity", label: "有效条件" }];
  const TEXTS = [{ key: "name", label: "名称 *" }, { key: "spec", label: "规格" }, { key: "grade", label: "等级" }, { key: "brand", label: "品牌" }, { key: "unit", label: "原计价单位 *" }];
  const GRID = { gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" };

  function QuotationFormScreen({ navigate, params = {} }) {
    const { Panel, Button } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const A = window.APP;
    const Q = window.QUOTATION_DEMO;
    const UI = window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const nav = navigate || (window.DC && window.DC.navigate);
    const state = params.previewState || "ready";
    const record = Q && params.id ? Q.get(params.id) : null;
    const initDraft = () => (record ? Q.clone(record.draft) : Q ? Q.newDraft() : null);
    const [draft, setDraft] = React.useState(initDraft);
    const [baseline, setBaseline] = React.useState(() => JSON.stringify(initDraft()));
    const [pending, setPending] = React.useState([]);
    const [removeIds, setRemoveIds] = React.useState([]);
    const [closeAfter, setCloseAfter] = React.useState(true);
    const [errors, setErrors] = React.useState({});
    const [conflictOpen, setConflictOpen] = React.useState(state === "conflict");
    const [recovery, setRecovery] = React.useState(state === "recovery" ? { commandId: "cmd-q-9d0e57", saved: false } : null);
    if (!Panel || !KA.StatePanel) return null;

    const title = (record ? "编辑" : "新增") + " · 材料报价";
    const attachments = record ? record.attachments : [];
    const dirty = !!draft && (baseline !== JSON.stringify(draft) || pending.length > 0 || removeIds.length > 0);
    const locked = !!recovery;

    const leave = () => {
      const go = () => { if (window.DC && window.DC.closeActiveTab) window.DC.closeActiveTab(); if (nav) nav("quotation", {}); };
      if (!dirty) return go();
      UI.confirm({ title: "放弃修改", message: "报价或原件尚未保存，确认返回？", confirmText: "放弃修改", danger: true, onConfirm: go });
    };

    const shell = (content) => (
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 14, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Button icon="arrow-left" onClick={leave}>返回报价清单</Button>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{title}</span>
        </div>
        {content}
      </div>
    );

    if (state === "loading") return shell(<KA.StatePanel state="loading" title="正在读取报价" />);
    if (state === "error" || !Q) return shell(<KA.StatePanel state="error" title={Q ? "报价读取失败，请重新核对原身份" : "演示数据未加载（需预载 kit/QuotationData.jsx）"} actionLabel="重新核对" onAction={() => nav && nav("quotationForm", { ...params, previewState: "ready" })} />);
    if (state === "readonly") return shell(<KA.StatePanel state="forbidden" title="当前会话仅可读取报价" actionLabel="重新核对" onAction={() => nav && nav("quotationForm", { ...params, previewState: "ready" })} />);
    if (params.id && !record) return shell(<KA.StatePanel state="error" title="报价不存在或没有关联来源的读取权限" actionLabel="重新核对" onAction={() => nav && nav("quotation", {})} />);

    // —— 修改助手（统一走 setDraft，保留其余字段） ——
    const patch = (p) => setDraft((d) => Object.assign({}, d, p));
    const patchLine = (idx, p) => setDraft((d) => Object.assign({}, d, { lines: d.lines.map((l, i) => (i === idx ? Object.assign({}, l, p) : l)) }));
    const numOrNull = (v) => (String(v).trim() === "" ? null : Number(v));
    const setScope = (scope) => patch({ scope, projectId: scope === "project" ? draft.projectId : null });

    const validate = () => {
      const e = {};
      if (!draft.partyName.trim()) e.partyName = "请填写报价方原文";
      if (draft.scope === "project" && !draft.projectId) e.projectId = "明确项目时须选择已核验项目";
      draft.lines.forEach((l, i) => {
        if (!l.name.trim()) e["l" + i + "name"] = "请填写名称";
        if (!l.unit.trim()) e["l" + i + "unit"] = "请填写原计价单位";
        if (l.taxRate !== null && (l.taxRate < 0 || l.taxRate > 100)) e["l" + i + "taxRate"] = "税率应在 0–100 之间";
        ["unitPrice", "quantity"].forEach((k) => { if (l[k] !== null && (!Number.isFinite(l[k]) || l[k] < 0)) e["l" + i + k] = "请输入非负数，未知请留空"; });
      });
      setErrors(e);
      return Object.keys(e).length === 0;
    };

    const save = (action) => {
      if (locked) return;
      if (!validate()) { UI.toast("报价方、适用范围、日期或材料明细不完整", "warn"); return; }
      const kept = attachments.filter((f) => removeIds.indexOf(f.id) < 0).concat(pending.map((p) => ({ id: "qfile-" + p.localId, fileName: p.fileName, fileSize: p.fileSize, mime: p.mime, deletedAt: null })));
      const result = Q.save({ id: record ? record.id : null, draft, files: kept });
      UI.toast("报价已保存并读取确认", "ok");
      setPending([]); setRemoveIds([]); setBaseline(JSON.stringify(draft));
      const reopen = (route, p) => { if (window.DC && window.DC.closeActiveTab) window.DC.closeActiveTab(); if (nav) nav(route, p); };
      if (action === "saveNew") {
        if (record) { reopen("quotationForm", {}); return; }   // 编辑页保存并新建：转到空白新增页
        const fresh = Q.newDraft();
        setDraft(fresh); setBaseline(JSON.stringify(fresh));
        return;
      }
      if (closeAfter) { reopen("quotationDetail", { id: result.id }); return; }
      if (!record) reopen("quotationForm", { id: result.id });   // 不关闭：新建保存后切到该报价的编辑地址（实现端 canonicalFormTarget）
    };

    const pickFiles = () => {
      // 设计稿模拟选择一份原件；实现端逐份校验 ≤10 MiB，正文随本次保存提交
      const n = pending.length + 1;
      setPending((p) => p.concat([{ localId: Math.random().toString(16).slice(2, 8), fileName: "报价原件-" + n + ".pdf", fileSize: 180000 + n * 1024, mime: "application/pdf" }]));
    };

    const err = (k) => errors[k] && <span style={{ fontSize: 11, color: "var(--danger)" }}>{errors[k]}</span>;
    const projects = A ? A.rows("projects") : [];
    const suppliers = A ? A.rows("suppliers") : [];
    const card = (id, children) => <Panel padding={16} id={"quotation-section-" + id} style={{ display: "grid", gap: 14, minWidth: 0, scrollMarginTop: 120 }}>{children}</Panel>;
    const sectionTitle = (t, extra) => <KA.SectionHeader mb={0} extra={extra}>{t}</KA.SectionHeader>;
    const latest = record || null;

    const form = (
      <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
        {recovery && (
          <Panel padding={16} role="status" aria-label="原提交恢复" style={{ display: "grid", gap: 10 }}>
            <b>{recovery.saved ? "已保存待刷新" : "原提交结果未知"}</b>
            <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", overflowWrap: "anywhere" }}>
              {recovery.saved ? "保留本页输入，重新读取同一记录确认保存。" : "保留本页输入，先核对原编号；确认原提交未应用后才能再次保存。"}原提交编号：{recovery.commandId}
            </p>
            <div><Button onClick={() => { setRecovery(null); UI.toast("原编号已封存为未应用，当前输入可重新明确提交", "ok"); }}>{recovery.saved ? "重新读取已保存记录" : "核对原提交"}</Button></div>
          </Panel>
        )}
        {conflictOpen && latest && (
          <Panel padding={16} role="status" style={{ display: "grid", gap: 8, fontSize: 13 }}>
            <b>最新报价版本 {latest.version} · {latest.draft.partyName}</b>
            <pre style={{ margin: 0, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 12, background: "var(--surface-2)", borderRadius: 8, padding: 10 }}>{JSON.stringify(latest.draft, null, 2)}</pre>
            <div><Button disabled={locked} onClick={() => { setConflictOpen(false); UI.toast("已核对最新版本，当前输入和原件仍保留", "ok"); }}>核对最新版本并保留当前输入</Button></div>
          </Panel>
        )}

        {card("facts", <>
          {sectionTitle("报价资料")}
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>按原文录入。未建档报价方可直接保存；项目不明确请选择“范围未知”。数字留空表示未知，0表示原件明确为零。</p>
          <fieldset disabled={locked} className="dc-fields dc-form-fields" style={{ margin: 0, padding: 0, border: 0, minWidth: 0 }}>
            <label>报价方原文 *<input value={draft.partyName} onChange={(e) => patch({ partyName: e.target.value })} aria-invalid={!!errors.partyName} />{err("partyName")}</label>
            <label>已核验分供方（可空）
              <select value={draft.supplierId || ""} onChange={(e) => patch({ supplierId: e.target.value || null })}>
                <option value="">未关联</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.id}</option>)}
              </select>
            </label>
            <label>实际适用范围
              <select value={draft.scope} onChange={(e) => setScope(e.target.value)}>
                <option value="unknown">范围未知</option><option value="general">通用报价（明确无项目）</option><option value="project">明确项目</option>
              </select>
            </label>
            {draft.scope === "project" && (
              <label>已核验项目 *
                <select value={draft.projectId || ""} onChange={(e) => patch({ projectId: e.target.value || null })} aria-invalid={!!errors.projectId}>
                  <option value="">请选择项目</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}
                </select>{err("projectId")}
              </label>
            )}
            <label>原报价日期（未知留空）<input type="date" value={draft.quotationDate || ""} onChange={(e) => patch({ quotationDate: e.target.value || null })} /></label>
          </fieldset>
        </>)}

        {card("lines", <>
          {sectionTitle("材料原始明细", <Button size="sm" icon="plus" disabled={locked} onClick={() => patch({ lines: draft.lines.concat([Q.newLine()]) })}>添加材料</Button>)}
          {draft.lines.map((l, i) => (
            <fieldset key={l.id} disabled={locked} style={{ margin: 0, border: "1px solid var(--line)", borderRadius: 8, padding: 12, minWidth: 0, display: "grid", gap: 10 }}>
              <legend style={{ padding: "0 4px", fontSize: 13, fontWeight: 600 }}>材料 {i + 1}</legend>
              <div className="dc-fields" style={GRID}>
                {TEXTS.map((f) => <label key={f.key}>{f.label}<input value={l[f.key]} onChange={(e) => patchLine(i, { [f.key]: e.target.value })} aria-invalid={!!errors["l" + i + f.key]} />{err("l" + i + f.key)}</label>)}
                <label>原报价单价<input type="number" min="0" step="any" value={l.unitPrice == null ? "" : l.unitPrice} onChange={(e) => patchLine(i, { unitPrice: numOrNull(e.target.value) })} />{err("l" + i + "unitPrice")}</label>
                <label>报价数量<input type="number" min="0" step="any" value={l.quantity == null ? "" : l.quantity} onChange={(e) => patchLine(i, { quantity: numOrNull(e.target.value) })} />{err("l" + i + "quantity")}</label>
                <label>含税口径
                  <select value={l.taxIncluded === null ? "" : String(l.taxIncluded)} onChange={(e) => patchLine(i, { taxIncluded: e.target.value === "" ? null : e.target.value === "true" })}>
                    <option value="">未知</option><option value="true">含税</option><option value="false">不含税</option>
                  </select>
                </label>
                <label>原适用税率（%）<input type="number" min="0" max="100" step="any" value={l.taxRate == null ? "" : l.taxRate} onChange={(e) => patchLine(i, { taxRate: numOrNull(e.target.value) })} />{err("l" + i + "taxRate")}</label>
                {CONDITIONS.map((f) => <label key={f.key}>{f.label}<input value={l[f.key] || ""} placeholder="原件未明确请留空" onChange={(e) => patchLine(i, { [f.key]: e.target.value || null })} /></label>)}
              </div>
              <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)", wordBreak: "break-all" }}>明细身份 {l.id}</p>
              {draft.lines.length > 1 && <div><Button size="sm" onClick={() => patch({ lines: draft.lines.filter((_, j) => j !== i) })}><span style={{ color: "var(--danger)" }}>移除此行（历史版本保留）</span></Button></div>}
            </fieldset>
          ))}
        </>)}

        {card("attachments", <>
          {sectionTitle("附件与备注")}
          {!locked && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Button icon="upload" onClick={pickFiles}>选择报价原件</Button>
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>选择真实报价原件，正文与报价同次保存（单份不超过 10 MiB）</span>
            </div>
          )}
          {(attachments.length > 0 || pending.length > 0) && (
            <div style={{ display: "grid", gap: 8 }}>
              {attachments.map((f) => {
                const removing = removeIds.indexOf(f.id) >= 0;
                return (
                  <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", background: removing ? "var(--danger-soft)" : "var(--panel)", opacity: removing ? 0.65 : 1 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.fileName}</span>
                    {!locked && <Button size="sm" onClick={() => setRemoveIds((ids) => (removing ? ids.filter((x) => x !== f.id) : ids.concat([f.id])))}>{removing ? "撤销删除" : "删除"}</Button>}
                  </div>
                );
              })}
              {pending.map((f) => (
                <div key={f.localId} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--brand)", borderRadius: 8, padding: "8px 12px", background: "var(--brand-soft)" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>{f.fileName}（待随本次保存）</span>
                  {!locked && <Button size="sm" onClick={() => setPending((p) => p.filter((x) => x.localId !== f.localId))}>移除</Button>}
                </div>
              ))}
            </div>
          )}
          <label className="dc-fields" style={{ display: "grid" }}>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>备注</span>
            <textarea rows={4} value={draft.note} disabled={locked} placeholder="补充说明" onChange={(e) => patch({ note: e.target.value })} />
          </label>
        </>)}

        {record && record.history.length > 0 && <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>已保留 {record.history.length} 个不可变报价版本，可在报价详情查看历史原价与原件。</p>}

        <div style={{ position: "sticky", bottom: 0, zIndex: 15, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", boxShadow: "0 -4px 16px rgba(16,24,40,0.06)" }} aria-label="表单操作">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-soft)", cursor: "pointer" }}>
            <input type="checkbox" checked={closeAfter} onChange={(e) => setCloseAfter(e.target.checked)} />【保存】后关闭
          </label>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={leave}>取消</Button>
            <Button disabled={locked} onClick={() => save("saveNew")}>保存并新建</Button>
            <Button variant="primary" disabled={locked} onClick={() => save("save")}>保存</Button>
          </div>
        </div>
      </div>
    );

    return shell(form);
  }

  window.QuotationFormScreen = QuotationFormScreen;
})();
