// HollowFormScreen — 记录 / 修订空鼓检查独立整页（#412 P6，补齐 design-pending）。
// 路由：hollowForm，params = { building, floor, unit, id? }；id 缺省 = 新建（/subcontract/quantity/:pid/:uid/hollow/new），
//       有 id = 修订（/subcontract/quantity/:pid/:uid/hollow/form/:id）。
// 对应：app/components/quantity/QuantityHollowFormPage.vue、QuantityHollowInspectionFields.vue；
//       规格 docs/rewrite/pages/subcontract-quantity.md「户级空鼓来源」、docs/guides/payroll-hollow.md §1。
// 结构 = EntityFormShell（不另建锚点导航）：头部（返回原户记录 + 标题/副标题）+ 分区卡片 + 吸底「取消 / 保存」。
// 口径：检查固定真实房间分项及原施工责任（新建从可证明范围中选；修订保留原身份不可改）；
//       检查日期 + 非负整数处数（空值不作为零提交，明确 0 保留真实零）+ 说明；修订另填原因；整改不在本页，在详情追加。
// 数据读写 window.HollowDemo（在 HollowDetailScreen.jsx 播种）。
(function () {
  if (window.HollowFormScreen) return;

  function HollowFormScreen({ data, navigate, params }) {
    const { Panel, Button, Field } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const P = Panel || "div";
    const H = window.HollowDemo;
    const p = params || {};
    const mx = (data && data.matrix) || { buildings: ["1栋"], floors: ["38F"], units: ["01户"] };
    const building = p.building || mx.buildings[0];
    const floor = p.floor || (mx.floors.includes("38F") ? "38F" : mx.floors[0]);
    const unit = p.unit || mx.units[0];
    const preview = p.previewState || "ready";
    const mode = p.id ? "revise" : "create";
    const title = mode === "revise" ? "修订空鼓检查" : "记录空鼓检查";

    const slot = H ? H.forUnit(building, floor, unit) : { targets: [], records: [], unavailable: [] };
    const record = mode === "revise" && H ? H.find(building, floor, unit, p.id) : null;
    const init = () => record
      ? { target: record.target.key, inspectedOn: record.inspection.inspectedOn, count: String(record.inspection.count), note: record.inspection.note || "", reason: "" }
      : { target: "", inspectedOn: "", count: "", note: "", reason: "" };
    const [fields, setFields] = React.useState(init);
    const [original] = React.useState(() => JSON.stringify(init()));
    const [errors, setErrors] = React.useState({});
    const dirty = JSON.stringify(fields) !== original;
    const editable = preview !== "readonly";
    const selected = slot.targets.find((t) => t.key === fields.target);

    const go = (to, id) => {
      if (window.DC && window.DC.closeActiveTab) window.DC.closeActiveTab();
      if (to === "detail") navigate("hollowDetail", { building, floor, unit, id });
      else navigate("quantityUnit", { building, floor, unit });
    };
    const cancel = () => {
      const back = () => go(p.id ? "detail" : "unit", p.id);
      if (dirty) UI.confirm({ title: "放弃未保存的空鼓输入", message: "确认放弃当前检查或整改输入？", confirmText: "放弃输入", danger: true, onConfirm: back });
      else back();
    };
    const patch = (k, v) => { if (!editable) return; setFields((f) => ({ ...f, [k]: v })); setErrors({}); };

    const submit = () => {
      if (!editable) return;
      const e = {};
      const n = Number(fields.count);
      if (mode === "create" && !selected) e.target = "请选择原户分项与责任";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.inspectedOn)) e.inspectedOn = "请填写真实检查日期";
      if (fields.count === "" || !Number.isInteger(n) || n < 0) e.count = "按处记录非负整数；空值不会作为零提交";
      if (mode === "revise" && !fields.reason.trim()) e.reason = "修订须说明依据";
      // 后台同口径（quantity-hollow-service）：修订总发现数不能低于已整改数，检查日不能晚于已有整改日
      if (mode === "revise" && record && Number.isInteger(n) && n < record.rectified) e.count = "修订总发现数不能低于已整改数（已整改 " + record.rectified + " 处）";
      if (mode === "revise" && record && !e.inspectedOn && record.rectifications.some((x) => x.rectifiedOn < fields.inspectedOn)) e.inspectedOn = "检查日不能晚于已有整改日";
      if (Object.keys(e).length) {
        setErrors(e);
        const el = document.querySelector('[data-hollow-field="' + Object.keys(e)[0] + '"]');
        if (el) el.focus();
        return;
      }
      let id = p.id;
      if (mode === "create") id = H.create(building, floor, unit, { targetKey: fields.target, inspectedOn: fields.inspectedOn, count: n, note: fields.note });
      else H.revise(building, floor, unit, p.id, { inspectedOn: fields.inspectedOn, count: n, note: fields.note, reason: fields.reason });
      UI.toast("空鼓检查已保存并核对。", "ok");
      go("detail", id);
    };

    // —— 状态预览：加载 / 读取失败 / 原记录不存在 ——
    if (preview === "loading" || preview === "error" || preview === "empty" || (mode === "revise" && !record)) {
      const loading = preview === "loading";
      return (
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 12 }}>
          <div>{Button ? <Button variant="secondary" icon="arrow-left" onClick={cancel}>返回原户记录</Button> : null}</div>
          {KA.StatePanel ? <KA.StatePanel state={loading ? "loading" : "error"}
            title={loading ? "正在读取原户检查资料…" : "原户检查资料未能读取"}
            description={loading ? undefined : mode === "revise" ? "这份空鼓原记录尚未获证明，不能修订或登记整改。" : "原输入已保留，重新核对来源后再决定继续。"}
            actionLabel={loading ? undefined : "重新读取原户"}
            onAction={() => navigate("hollowForm", { ...p, previewState: "ready" })} /> : null}
        </div>
      );
    }

    const lbl = { display: "grid", gap: 6, minWidth: 0, fontSize: 12 };
    const err = (k) => errors[k] ? <span style={{ color: "var(--danger)", fontSize: 12 }}>{errors[k]}</span> : null;
    const inv = (k) => errors[k] ? { borderColor: "var(--danger)" } : undefined;
    // 日期 / 数量输入统一用设计系统 Field；校验错误在其下方以文字列出
    const fld = (key, label, type, value, extra) => (
      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        {Field ? <Field label={label} value={value} onChange={(e) => patch(key, e.target.value)} mono
          inputProps={{ type, "aria-label": label, "aria-invalid": !!errors[key], "data-hollow-field": key, ...(extra || {}) }} /> : null}
        {err(key)}
      </div>
    );
    const partyText = (t) => "原" + (t.originalParty.kind === "worker" ? "施工人" : "班组") + " " + t.originalParty.name;
    const usable = slot.targets.length > 0;

    return (
      <div className="kfp-root" style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {Button ? <Button size="sm" variant="secondary" icon="arrow-left" onClick={cancel}>返回原户记录</Button> : null}
          <span style={{ fontSize: 16, fontWeight: 800 }}>{title}</span>
          <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>记录真实户、分项和原责任下的检查；后续修订与整改均保留原记录。</span>
        </div>
        {preview === "readonly" && <div role="status" style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 10 }}>当前身份没有空鼓来源写入权限。</div>}

        <div>

          <fieldset disabled={!editable} style={{ margin: 0, padding: 0, border: 0, minWidth: 0, display: "grid", gap: 12 }}>
            {/* 原位置与施工责任 */}
            <P padding={16}>
              <div id="hf-section-responsibility" style={{ scrollMarginTop: 120 }}>
                {KA.SectionHeader ? <KA.SectionHeader>原位置与施工责任</KA.SectionHeader> : null}
                {mode === "create" ? (
                  <label style={lbl}>检查范围
                    <select data-hollow-field="target" className="dc-state-select" aria-label="空鼓检查范围" value={fields.target} style={inv("target")} onChange={(e) => patch("target", e.target.value)}>
                      <option value="">{usable ? "请选择原户分项与责任" : "当前没有可用的原责任检查范围"}</option>
                      {slot.targets.map((t) => <option key={t.key} value={t.key}>{t.locationLabel + " · " + partyText(t)}</option>)}
                    </select>{err("target")}</label>
                ) : null}
                {record ? <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.6, overflowWrap: "anywhere" }}>{record.target.locationLabel} · 原责任 {record.target.originalParty.name}。本次修订保留此原身份。</p>
                  : selected ? <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.6, overflowWrap: "anywhere" }}>{selected.locationLabel} · 原责任 {selected.originalParty.name}</p> : null}
                {slot.unavailable.map((d, i) => <p key={i} role="alert" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--warn-ink)", overflowWrap: "anywhere" }}>{d.message}</p>)}
              </div>
            </P>

            {/* 检查内容 */}
            <P padding={16}>
              <div id="hf-section-inspection" style={{ scrollMarginTop: 120 }}>
                {KA.SectionHeader ? <KA.SectionHeader>检查内容</KA.SectionHeader> : null}
                <div className="dc-fields dc-form-fields">
                  {fld("inspectedOn", "检查日期", "date", fields.inspectedOn)}
                  {fld("count", "检查发现总处数", "number", fields.count, { step: 1, min: 0 })}
                </div>
                <p style={{ margin: "10px 0 0", fontSize: 12, lineHeight: 1.6, color: "var(--ink-soft)" }}>
                  按处记录整数。没有检查记录与明确检查为零不同；请按真实检查填写，空值不会作为零提交。
                  {record && record.rectified ? " 原记录已登记整改 " + record.rectified + " 处，修订总发现数不能低于已整改数，检查日不能晚于已有整改日。" : ""}
                </p>
              </div>
            </P>

            {/* 依据与说明 */}
            <P padding={16}>
              <div id="hf-section-evidence" style={{ scrollMarginTop: 120, display: "grid", gap: 12 }}>
                {KA.SectionHeader ? <KA.SectionHeader>依据与说明</KA.SectionHeader> : null}
                {mode === "revise" ? (
                  <label style={lbl}>修订原因
                    <textarea data-hollow-field="reason" rows={3} aria-label="检查修订原因" value={fields.reason} style={inv("reason")} onChange={(e) => patch("reason", e.target.value)} />{err("reason")}</label>
                ) : null}
                <label style={lbl}>检查说明
                  <textarea rows={3} aria-label="检查说明" value={fields.note} onChange={(e) => patch("note", e.target.value)} /></label>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--ink-soft)" }}>
                  空鼓检查不自动生成工资扣款或退款；工资页读取同一记录，由经办人在具体工资单明确开始扣款。
                </p>
              </div>
            </P>
          </fieldset>
        </div>

        <div style={{ position: "sticky", bottom: 0, zIndex: 15, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap",
          marginTop: 12, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", boxShadow: "0 -4px 16px rgba(16,24,40,0.06)" }}>
          {Button ? <Button variant="secondary" onClick={cancel}>取消</Button> : null}
          {Button ? <Button variant="primary" disabled={!editable || (mode === "create" && !usable)} onClick={submit}>{mode === "revise" ? "保存检查修订" : "保存空鼓检查"}</Button> : null}
        </div>
      </div>
    );
  }

  window.HollowFormScreen = HollowFormScreen;
})();
