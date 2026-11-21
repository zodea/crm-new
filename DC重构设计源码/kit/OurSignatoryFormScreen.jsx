// OurSignatoryFormScreen — 我方签约主体新增 / 编辑整页表单（路由 ourSignatoryForm，对应实现
// /settings/our-signatories/form/:id?）。依据：app/pages/settings/our-signatories/form/_components/OurSignatoryFormPage.vue、
// app/lib/our-signatory/contract.ts、ADR 0014（实体新增/编辑一律独立整页表单）。
// 不走 KitFormPage 注册表：本表单需要「不可变核实历史」「版本冲突核对」「原提交恢复」三块
// FormPage 规格无法表达的只读区，且没有草稿/提交态；视觉沿用 FormPage 的返回 + 标题 + 分区卡片 + 吸底动作条。
// 字段（OurSignatoryDraft）：name 真实签约名称*、taxNo 纳税识别号、registeredAddress 注册地址、
//   legalRepresentative 法定代表人、verificationNote 真实核实依据说明、status 使用状态（active 可选择 / inactive 已停用）。
// 未核实资料留空（存 null），不填占位文本；主体更名保留核实历史，已签合同继续采用原签约快照。
// params：id（编辑目标，缺省=新增）；previewState：ready | loading | error | readonly | conflict（他人已保存新版本）
//   | pending（上次提交结果未知，待核对原编号）。演示数据仅在本文件内。
(function () {
  const DEMO = {
    "sig-demo-1": {
      draft: { name: "瑞航装饰工程有限公司（演示）", taxNo: "91440300MA5DEMO01X", registeredAddress: "深圳市南山区演示路 1 号", legalRepresentative: "张某（演示）", verificationNote: "依据营业执照原件及 2026-05 施工合同盖章页核实。", status: "active" },
      version: "3",
      history: [
        { id: "h3", version: "3", name: "瑞航装饰工程有限公司（演示）", status: "active", note: "依据营业执照原件及 2026-05 施工合同盖章页核实。", at: "2026-05-18 10:24" },
        { id: "h2", version: "2", name: "瑞航装饰工程有限公司（演示）", status: "active", note: "补录纳税识别号。", at: "2025-11-02 16:08" },
        { id: "h1", version: "1", name: "瑞航装饰有限公司（演示）", status: "active", note: "", at: "2024-03-12 09:30" },
      ],
    },
    "sig-demo-2": {
      draft: { name: "瑞航建设集团有限公司（演示）", taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: "", status: "active" },
      version: "1",
      history: [{ id: "h1", version: "1", name: "瑞航建设集团有限公司（演示）", status: "active", note: "", at: "2026-02-20 14:00" }],
    },
  };
  const EMPTY = { name: "", taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: "", status: "active" };
  const FIELDS = [
    { key: "name", label: "真实签约名称", required: true },
    { key: "taxNo", label: "纳税识别号" },
    { key: "registeredAddress", label: "注册地址" },
    { key: "legalRepresentative", label: "法定代表人" },
  ];
  const INPUT = { width: "100%", boxSizing: "border-box", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", padding: "8px 11px", fontSize: 13, background: "#fff", color: "var(--ink)" };

  function OurSignatoryFormScreen({ navigate, params }) {
    const p = params || {};
    const { Panel, Button, Field } = window.DesignSystem_e3d871;
    const KA = window.KitAtoms || {};
    const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const record = p.id ? (DEMO[p.id] || DEMO["sig-demo-1"]) : null;
    const state = p.previewState || "ready";
    const readOnly = state === "readonly";
    const [draft, setDraft] = React.useState(() => ({ ...(record ? record.draft : EMPTY) }));
    const [baseline, setBaseline] = React.useState(() => JSON.stringify(record ? record.draft : EMPTY));
    const [closeAfter, setCloseAfter] = React.useState(true);
    const [conflictOpen, setConflictOpen] = React.useState(state === "conflict");
    const [nameError, setNameError] = React.useState("");
    React.useEffect(() => { setConflictOpen(state === "conflict"); }, [state]);
    const dirty = JSON.stringify(draft) !== baseline;
    const title = (p.id ? "编辑" : "新增") + " · 我方签约主体";
    const writeBlocked = readOnly || state === "pending" || conflictOpen;

    const setField = (key, value) => {
      setDraft((d) => ({ ...d, [key]: key === "name" || key === "verificationNote" || key === "status" ? value : (value || null) }));
      if (key === "name" && value.trim()) setNameError("");
    };
    const toList = () => { if (window.DC && window.DC.closeActiveTab) window.DC.closeActiveTab(); navigate("ourSignatory"); };
    const leave = () => dirty
      ? UI().confirm({ title: "放弃修改", message: "当前资料还有未保存修改，确认返回？", confirmText: "放弃修改", onConfirm: toList })
      : toList();
    const save = (action) => {
      if (writeBlocked) return;
      if (!draft.name.trim()) { setNameError("请填写真实签约名称"); return; }
      UI().toast("我方主体已保存并读取确认（设计演示）", "ok");
      if (action === "saveNew") { setDraft({ ...EMPTY }); setBaseline(JSON.stringify(EMPTY)); navigate("ourSignatoryForm", {}); return; }
      setBaseline(JSON.stringify(draft));
      if (closeAfter) toList();
    };

    const header = (
      <div style={{ marginBottom: 16 }}>
        <button type="button" onClick={leave} aria-label="返回主体目录" style={{ display: "inline-flex", alignItems: "center", gap: 4, border: 0, background: "transparent", padding: 0, marginBottom: 4, fontSize: 12, color: "var(--brand-deep)", cursor: "pointer" }}>← 返回主体目录</button>
        <h1 style={{ margin: 0, fontSize: 20, lineHeight: "28px", fontWeight: 800 }}>{title}</h1>
      </div>
    );

    if (state === "loading" || state === "error") {
      return (
        <div style={{ maxWidth: 1080, margin: "0 auto", minWidth: 0 }}>
          {header}
          {KA.StatePanel && <KA.StatePanel state={state} title={state === "loading" ? "正在读取主体资料" : "主体资料暂不可用，请稍后重新核对"} actionLabel={state === "error" ? "重新核对" : undefined} onAction={() => navigate("ourSignatoryForm", { ...p, previewState: "ready" })} />}
        </div>
      );
    }

    return (
      <div style={{ maxWidth: 1080, margin: "0 auto", minWidth: 0 }}>
        {header}
        <form onSubmit={(e) => e.preventDefault()} style={{ display: "grid", gap: 16, minWidth: 0 }}>
          {state === "pending" && (
            <Panel padding={16} role="status" aria-label="原提交恢复" style={{ display: "grid", gap: 12 }}>
              <p style={{ margin: 0, fontWeight: 700 }}>原提交结果未知</p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", wordBreak: "break-all" }}>保留本页输入，先核对原编号；确认原提交未应用后才能再次保存。原提交编号：cmd-our-signatory-demo-7f3a</p>
              <div><Button onClick={() => { UI().toast("原编号已封存为未应用，可以核对输入后重新提交", "ok"); navigate("ourSignatoryForm", { ...p, previewState: "ready" }); }}>核对原提交</Button></div>
            </Panel>
          )}
          {readOnly && <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>当前身份没有主体目录维护权限，仅可查看。</p>}
          {conflictOpen && (
            <Panel padding={16} role="status" style={{ display: "grid", gap: 8, fontSize: 13 }}>
              <strong>资料已更新：版本 {Number(record ? record.version : "1") + 1} · {draft.name || "瑞航装饰工程有限公司（演示）"}</strong>
              <span>最近保存 2026-10-06 09:12。请核对已保存资料后，决定是否用当前输入继续修改。</span>
              <div><Button onClick={() => { setConflictOpen(false); UI().toast("已核对最新保存版本，当前输入仍保留；请再次明确保存。", "ok"); }}>核对最新版本并保留当前输入</Button></div>
            </Panel>
          )}

          <Panel padding={16} id="section-facts" style={{ display: "grid", gap: 16 }}>
            {KA.SectionHeader ? <KA.SectionHeader mb={0}>核实资料</KA.SectionHeader> : <b>核实资料</b>}
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>资料未核实时留空。主体更名保留核实历史，合同继续采用原签约快照。</p>
            <fieldset disabled={readOnly} style={{ margin: 0, padding: 0, border: 0, minWidth: 0, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))" }}>
              {FIELDS.map((f) => (
                <div key={f.key} style={{ display: "grid", gap: 4, minWidth: 0 }}>
                  <Field label={f.label + (f.required ? " *" : "")} value={draft[f.key] == null ? "" : draft[f.key]} mono={f.key === "taxNo"} onChange={(e) => setField(f.key, e.target.value)} inputProps={{ required: !!f.required, "aria-invalid": f.key === "name" && !!nameError ? "true" : undefined }} />
                  {f.key === "name" && nameError && <span role="alert" style={{ fontSize: 12, color: "var(--danger-ink)" }}>{nameError}</span>}
                </div>
              ))}
              <label style={{ display: "grid", gap: 8, fontSize: 13, gridColumn: "1 / -1" }}>
                <span>真实核实依据说明</span>
                <textarea rows={3} value={draft.verificationNote} onChange={(e) => setField("verificationNote", e.target.value)} style={{ ...INPUT, resize: "vertical" }} />
              </label>
              <label style={{ display: "grid", gap: 8, fontSize: 13 }}>
                <span>使用状态</span>
                <select value={draft.status} onChange={(e) => setField("status", e.target.value)} style={INPUT}>
                  <option value="active">可选择</option>
                  <option value="inactive">已停用（保留历史）</option>
                </select>
              </label>
            </fieldset>
          </Panel>

          {record && record.history.length > 0 && (
            <Panel padding={16} aria-label="主体核实历史" style={{ display: "grid", gap: 12 }}>
              {KA.SectionHeader ? <KA.SectionHeader mb={0}>不可变核实历史</KA.SectionHeader> : <b>不可变核实历史</b>}
              {record.history.map((h) => (
                <article key={h.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, fontSize: 13 }}>
                  <strong>版本 {h.version} · {h.name}</strong>
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-soft)" }}>{h.at} · {h.status === "active" ? "可选择" : "已停用"} · {h.note || "核实说明未记录"}</p>
                </article>
              ))}
            </Panel>
          )}

          {/* 吸底动作条：与实现 FormFooter 同构；本实体无草稿 / 提交态，只保留 取消 / 保存并新建 / 保存 */}
          <div role="group" aria-label="表单操作" style={{ position: "sticky", bottom: 0, zIndex: 15, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", boxShadow: "0 -4px 16px rgba(16,24,40,0.06)" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-soft)", cursor: "pointer", userSelect: "none" }}>
              <input type="checkbox" checked={closeAfter} onChange={(e) => setCloseAfter(e.target.checked)} />【保存】后关闭
            </label>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Button onClick={leave}>取消</Button>
              <Button disabled={writeBlocked} onClick={() => save("saveNew")}>保存并新建</Button>
              <Button variant="primary" disabled={writeBlocked} onClick={() => save("save")}>保存</Button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  window.OurSignatoryFormScreen = OurSignatoryFormScreen;
})();
