// DayworkFormScreen — 签工记录独立整页（新增 / 编辑；#412 C2 来源，补齐 design-pending）。
// 路由：dayworkForm；params.id 缺省 = 新建（对应 /subcontract/daywork/new），有 id = 编辑（/subcontract/daywork/form/:id）。
// 依据：app/components/payroll/CentralDayworkFormPage.vue、PayrollDayworkFormFields.vue、
//       server/utils/payroll-daywork-service.ts 校验原文，docs/rewrite/pages/subcontract-payroll.md「C2 零星签工」。
// 结构 = EntityFormShell（不另建锚点导航）：头部（返回 + 标题/副标题）+ 分区卡片 + 吸底「返回 / 保存待确认 / 保存并确认」。
// 口径：整工/半工由经办人明确选择，不按时段折算；保存待确认不计薪；填写证明信息后「保存并确认」才表示本次人工确认；
//       签工不录单价与金额；已发、已被考勤链/工资占用或资格不可用的原记录只读并列出原因。
// 演示数据读写 window.DAYWORK_DEMO（在 DayworkScreen.jsx 播种），保存后回台账可见；刷新恢复。
(function () {
  if (window.DayworkFormScreen) return;

  const blank = (p) => ({ projectId: p.project || "", crewId: p.crew || null, workerId: "", workDate: "", startTime: "", endTime: "",
    laborUnits: null, workContent: "", witness: "", confirmedOn: null, note: "" });
  const pick = (r) => ({ projectId: r.projectId, crewId: r.crewId, workerId: r.workerId, workDate: r.workDate, startTime: r.startTime || "", endTime: r.endTime || "",
    laborUnits: r.laborUnits, workContent: r.workContent || "", witness: r.witness || "", confirmedOn: r.confirmedOn || null, note: r.note || "" });
  const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const overlap = (a, b) => a.startTime < b.endTime && b.startTime < a.endTime;

  // 与后台 validatePayrollDayworkRecord / 同日规则同一口径（设计稿演示用，前端不替代后台核对）
  function validate(d, status, D, selfId) {
    const e = {};
    if (!d.projectId) e.projectId = "请选择签工项目";
    if (!d.workerId) e.workerId = "签工必须使用当前项目的真实人员和班组";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.workDate)) e.workDate = "签工日期必须是真实日期";
    if (!HHMM.test(d.startTime)) e.startTime = "开始时间须为 HH:mm";
    if (!HHMM.test(d.endTime) || d.endTime <= d.startTime) e.endTime = "结束时间须晚于开始时间，且在同一日";
    if (d.laborUnits !== 0.5 && d.laborUnits !== 1) e.laborUnits = "用工数只允许整工 1 或半工 0.5";
    if (!d.workContent.trim()) e.workContent = "必须填写施工内容";
    if (status === "confirmed" && !d.witness.trim()) e.witness = "人工确认必须填写证明人";
    if ((status === "confirmed" && !d.confirmedOn) || (d.confirmedOn && d.confirmedOn < d.workDate)) e.confirmedOn = "确认日期须为真实日期且不能早于签工日期";
    if (Object.keys(e).length) return e;
    const sameDay = D.records.filter((r) => r.id !== selfId && r.workerId === d.workerId && r.workDate === d.workDate);
    if (sameDay.some((r) => overlap(r, d))) return { startTime: "同一人员同日签工时段重叠，请核对同日其他记录" };
    if (sameDay.reduce((s, r) => s + (Number(r.laborUnits) || 0), 0) + d.laborUnits > 1) return { laborUnits: "同一人员同日用工数不能超过 1 工（待确认记录也计入日上限）" };
    if (D.locks.some((l) => l.workerId === d.workerId && l.month === d.workDate.slice(0, 7))) return { workerId: "原或目标月份已有考勤链或已发工资，不能移动或修改签工" };
    return null;
  }

  function DayworkFormScreen({ navigate, params }) {
    const { Panel, Button, StatusChip, Field } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const P = Panel || "div";
    const D = window.DAYWORK_DEMO || { projects: [], crews: [], workers: [], records: [], locks: [] };
    const p = params || {};
    const preview = p.previewState || "ready";
    const recordId = p.id || null;
    const record = recordId ? D.records.find((r) => r.id === recordId) : null;
    const title = recordId ? "编辑签工记录" : "新增签工记录";

    const [draft, setDraft] = React.useState(() => record ? pick(record) : blank(p));
    const [original] = React.useState(() => JSON.stringify(record ? pick(record) : blank(p)));
    const [errors, setErrors] = React.useState({});
    const [error, setError] = React.useState("");
    const dirty = JSON.stringify(draft) !== original;
    const reasons = record ? (record.reasons || []) : [];
    const editable = preview !== "readonly" && !reasons.length;

    const worker = (id) => D.workers.find((x) => x.id === id) || null;
    const crewName = (id) => (D.crews.find((x) => x.id === id) || {}).name;
    const projectWorkers = D.workers.filter((w) => w.eligible);
    const change = (patch) => { if (!editable) return; setDraft((d) => ({ ...d, ...patch })); setErrors({}); setError(""); };

    const leave = () => {
      const go = () => { if (window.DC && window.DC.closeActiveTab) window.DC.closeActiveTab(); navigate("daywork", p.returnParams || { project: draft.projectId }); };
      if (dirty) UI.confirm({ title: "放弃签工修改", message: "原输入尚未保存，确认放弃？", confirmText: "放弃修改", danger: true, onConfirm: go });
      else go();
    };
    const save = (status) => {
      if (!editable) return;
      const errs = validate(draft, status, D, recordId);
      if (errs) {
        setErrors(errs); setError(Object.values(errs)[0] + "。原输入已保留。");
        const el = document.querySelector('[data-daywork-field="' + Object.keys(errs)[0] + '"]');
        if (el) el.focus();
        return;
      }
      const next = { ...draft, status, availability: status === "draft" ? "pending" : "available", reasons: [] };
      if (record) Object.assign(record, next);
      else D.records.push({ id: "demo-dw-" + Date.now(), ...next });
      UI.toast(status === "confirmed" ? "签工已保存并确认。" : "待确认签工已保存，尚未计薪。", "ok");
      if (window.DC && window.DC.closeActiveTab) window.DC.closeActiveTab();
      navigate("daywork", p.returnParams || { project: draft.projectId, month: draft.workDate.slice(0, 7) });
    };

    // —— 状态预览：加载 / 读取失败 / 原记录不存在 ——
    const notFound = recordId && !record;
    if (preview === "loading" || preview === "error" || preview === "empty" || notFound) {
      return (
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 12 }}>
          <div>{Button ? <Button variant="secondary" icon="arrow-left" onClick={leave}>返回签工台账</Button> : null}</div>
          {KA.StatePanel ? <KA.StatePanel state={preview === "loading" ? "loading" : "error"}
            title={preview === "loading" ? "正在读取签工记录…" : "签工未能读取"}
            description={preview === "loading" ? undefined : "请从正式签工台账打开有效记录。"}
            actionLabel={preview === "loading" ? undefined : "重新读取"}
            onAction={() => navigate("dayworkForm", { ...p, previewState: "ready" })} /> : null}
        </div>
      );
    }

    const lbl = { display: "grid", gap: 6, minWidth: 0, fontSize: 12 };
    const err = (k) => errors[k] ? <span style={{ color: "var(--danger)", fontSize: 12 }}>{errors[k]}</span> : null;
    const inv = (k) => errors[k] ? { borderColor: "var(--danger)" } : undefined;
    // 文本 / 日期 / 时间输入统一用设计系统 Field；校验错误在其下方以文字列出
    const fld = (key, label, type, value, onInput) => (
      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        {Field ? <Field label={label} value={value} onChange={(e) => onInput(e.target.value)} mono={type !== "text"}
          inputProps={{ type, "aria-label": label.replace(" *", ""), "aria-invalid": !!errors[key], "data-daywork-field": key }} /> : null}
        {err(key)}
      </div>
    );
    const w = worker(draft.workerId);
    const crewText = draft.crewId ? (crewName(draft.crewId) || "原班组名称未记录") : draft.workerId ? "用工人实际无班组" : "选择用工人后确定";

    return (
      <div className="kfp-root" style={{ maxWidth: 1080, margin: "0 auto" }}>
        {/* 头部：返回 + 标题 + 副标题（EntityFormShell） */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {Button ? <Button size="sm" variant="secondary" icon="arrow-left" onClick={leave}>返回</Button> : null}
          <span style={{ fontSize: 16, fontWeight: 800 }}>{title}</span>
          {record && StatusChip ? <StatusChip tone={record.status === "confirmed" ? "ok" : "warn"}>{record.status === "confirmed" ? "已确认" : "待确认"}</StatusChip> : null}
          <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>保存逐日用工事实；有真实证明信息时可明确保存并确认。</span>
        </div>

        {preview === "readonly" && <div role="status" style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 10 }}>当前身份只能阅读签工。</div>}
        {reasons.map((t) => <p key={t} style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.6, color: "var(--warn-ink)" }}>{t}</p>)}
        {error && <div role="alert" style={{ marginBottom: 10, fontSize: 12, color: "var(--danger)", background: "var(--danger-soft)", borderRadius: 8, padding: "8px 12px" }}>{error}</div>}

        <div>

          <fieldset disabled={!editable} style={{ margin: 0, padding: 0, border: 0, minWidth: 0, display: "grid", gap: 12 }}>
            {/* 分区一：原用工事实 */}
            <P padding={16}>
              <div id="dwf-section-record" style={{ scrollMarginTop: 120 }}>
                {KA.SectionHeader ? <KA.SectionHeader>原用工事实</KA.SectionHeader> : null}
                <div className="dc-fields dc-form-fields">
                  <label style={lbl}>项目 *
                    <select data-daywork-field="projectId" aria-label="签工项目" value={draft.projectId} style={inv("projectId")}
                      onChange={(e) => change({ projectId: e.target.value, workerId: "", crewId: null })}>
                      <option value="">请选择签工项目</option>
                      {D.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>{err("projectId")}</label>
                  <label style={lbl}>用工人 *
                    <select data-daywork-field="workerId" aria-label="签工用工人" value={draft.workerId} style={inv("workerId")} disabled={!draft.projectId}
                      onChange={(e) => { const x = worker(e.target.value); change({ workerId: e.target.value, crewId: x ? x.crewId : null }); }}>
                      <option value="">{draft.projectId ? "请选择用工人" : "先选择项目"}</option>
                      {projectWorkers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      {w && !w.eligible ? <option value={w.id}>{w.name}（当前资格不可用）</option> : null}
                    </select>{err("workerId")}</label>
                  <div style={{ ...lbl, alignContent: "end" }}>
                    <span style={{ color: "var(--ink-soft)" }}>所属班组</span>
                    <span style={{ fontSize: 13 }}>{crewText}</span>
                  </div>
                  {fld("workDate", "用工日期 *", "date", draft.workDate, (v) => change({ workDate: v }))}
                  {fld("startTime", "开始时间 *", "time", draft.startTime, (v) => change({ startTime: v }))}
                  {fld("endTime", "结束时间 *", "time", draft.endTime, (v) => change({ endTime: v }))}
                  <label style={lbl}>用工数 *
                    <select data-daywork-field="laborUnits" aria-label="用工数" value={draft.laborUnits == null ? "" : String(draft.laborUnits)} style={inv("laborUnits")}
                      onChange={(e) => change({ laborUnits: e.target.value === "" ? null : Number(e.target.value) })}>
                      <option value="">请选择整工或半工</option>
                      <option value="1">整工 · 1 工</option>
                      <option value="0.5">半工 · 0.5 工</option>
                    </select>{err("laborUnits")}</label>
                </div>
                <label style={{ ...lbl, marginTop: 12 }}>施工内容 *
                  <textarea data-daywork-field="workContent" rows={4} aria-label="施工内容" value={draft.workContent} style={inv("workContent")} onChange={(e) => change({ workContent: e.target.value })} />{err("workContent")}</label>
                <p style={{ margin: "10px 0 0", fontSize: 12, lineHeight: 1.6, color: "var(--ink-soft)" }}>
                  整工与半工由经办人明确选择，不按时段自动折算。保存待确认记录不计薪；人工确认后方可核算。
                </p>
              </div>
            </P>

            {/* 分区二：证明与确认 */}
            <P padding={16}>
              <div id="dwf-section-confirm" style={{ scrollMarginTop: 120 }}>
                {KA.SectionHeader ? <KA.SectionHeader>证明与确认</KA.SectionHeader> : null}
                <div className="dc-fields dc-form-fields">
                  {fld("witness", "证明人", "text", draft.witness, (v) => change({ witness: v }))}
                  {fld("confirmedOn", "确认日期", "date", draft.confirmedOn || "", (v) => change({ confirmedOn: v || null }))}
                </div>
                <p style={{ margin: "10px 0 12px", fontSize: 12, lineHeight: 1.6, color: "var(--ink-soft)" }}>
                  填写证明信息后选择“保存并确认”才表示本次人工确认；待确认可暂不填写。确认规则不自动扣款。
                </p>
                <label style={lbl}>备注
                  <textarea rows={3} aria-label="签工备注" value={draft.note} onChange={(e) => change({ note: e.target.value })} /></label>
              </div>
            </P>

            {record ? (
              <details style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 12, fontSize: 12 }}>
                <summary style={{ cursor: "pointer" }}>原记录与诊断</summary>
                <pre style={{ marginTop: 10, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 11 }}>{JSON.stringify({ id: record.id, ...pick(record), status: record.status }, null, 2)}</pre>
              </details>
            ) : null}
          </fieldset>
        </div>

        {/* 吸底动作条：返回 / 保存待确认 / 保存并确认 */}
        <div style={{ position: "sticky", bottom: 0, zIndex: 15, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap",
          marginTop: 12, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", boxShadow: "0 -4px 16px rgba(16,24,40,0.06)" }}>
          {Button ? <Button variant="secondary" onClick={leave}>返回</Button> : null}
          {Button ? <Button variant="secondary" disabled={!editable} onClick={() => save("draft")}>保存待确认</Button> : null}
          {Button ? <Button variant="primary" disabled={!editable} onClick={() => save("confirmed")}>保存并确认</Button> : null}
        </div>
      </div>
    );
  }

  window.DayworkFormScreen = DayworkFormScreen;
})();
