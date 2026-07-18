// FormPage — 整页表单壳（grill 决议 2026-07-18：全实体新建/编辑一律整页表单、独立路由新开页签）。
// 组成：
//   window.KIT_FORM_SPECS[route] = (params)=>spec   表单规格注册表（kit/forms/*.jsx 按域注册）
//   window.KIT_FORM_PAGES[route] = {title,subtitle,listRoute}  页签/头部标题表（app.dc.html PAGE 兜底）
//   window.KitFormUtil = { buildFields, coerce, registerForm } 规格辅助（与 EntityListScreen 同语义）
//   window.KitFormPage                                整页表单组件：面包屑 + 左锚点导航(≥3分区) +
//     分区圆角卡片(KitUI.buildFormBody layout:"cards") + 吸底五按钮 +「保存后关闭」勾选 + 页签切换缓存
//   window.EntityFormScreen                           分发器：按 route 查注册表渲染 KitFormPage
// spec 契约（specFn(params) 返回）：
//   { coll, entity, listRoute, title, statusKey?, row,           row=编辑目标行（null=新建）
//     fields:[KitUI.buildFormBody 字段契约], coerce(vals)->patch, newDefaults()->obj, cols? }
// 行为要点：草稿=跳过必填校验+statusKey 写「草稿」；保存并提交=statusKey 写「审批中」；
//   保存并新建=落库后原地重开空表单；页签切走自动缓存填写值（含明细行）、切回恢复（决议 8d 硬性要求）。
(function () {
  if (window.KitFormPage) { window.KitFormPagePreload = window.KitFormPagePreload || function () { return null; }; return; }

  window.KIT_FORM_SPECS = window.KIT_FORM_SPECS || {};
  window.KIT_FORM_PAGES = window.KIT_FORM_PAGES || {};
  window.KIT_FORM_CACHE = window.KIT_FORM_CACHE || {};   // 页签缓存：cacheKey -> getAllVals() 快照

  // —— 规格辅助（与 EntityListScreen buildFields/coerce 同语义，defs = [{key,label,money,form:{...}}]）——
  const buildFields = (defs, row) => {
    const out = [];
    defs.forEach((c, i) => {
      const f = c.form || {};
      if (f.section) out.push({ section: f.section });
      const fld = Object.assign({}, f, {
        section: undefined,
        key: c.key, label: c.label,
        value: row ? (f.toLabel ? f.toLabel(row[c.key], row) : row[c.key]) : (f.value !== undefined ? f.value : ""),
        full: f.full || f.type === "grid" || f.type === "textarea" || (defs.length % 2 === 1 && i === defs.length - 1),
      });
      out.push(fld);
    });
    return out;
  };
  const coerce = (defs, vals) => {
    const o = {};
    Object.keys(vals).forEach((k) => {
      if (vals[k] === "" || vals[k] == null) return;
      const col = defs.find((c) => c.key === k);
      o[k] = col && col.form && col.form.toValue ? col.form.toValue(vals[k]) : vals[k];
      if (col && col.money && !Array.isArray(o[k])) o[k] = Number(String(o[k]).replace(/[^\d.\-]/g, "")) || 0;
    });
    return o;
  };
  // registerForm：一行注册路由 + 页签标题 + 规格。page = {title, subtitle, listRoute}
  const registerForm = (route, page, specFn) => {
    window.KIT_FORM_SPECS[route] = specFn;
    window.KIT_FORM_PAGES[route] = page;
  };
  window.KitFormUtil = { buildFields, coerce, registerForm };

  // —— 整页表单组件 ——
  function KitFormPage({ route, specFn, params, navigate }) {
    const UI = window.KitUI;
    const A = window.APP;
    const hostRef = React.useRef(null);
    const fbRef = React.useRef(null);
    const dirtyRef = React.useRef(false);
    const doneRef = React.useRef(false);            // 已保存/已放弃 → 卸载时不缓存
    const [instanceKey, setInstanceKey] = React.useState(0);   // 保存并新建：+1 重开空表单
    const [editId, setEditId] = React.useState(params && params.id ? params.id : null);
    const [dirty, setDirty] = React.useState(false);
    const [anchors, setAnchors] = React.useState([]);
    const [activeAnchor, setActiveAnchor] = React.useState(0);
    const [closeAfter, setCloseAfter] = React.useState(true);
    if (!UI || !UI.buildFormBody || !A) return null;

    const paramFp = JSON.stringify(params || {});
    const spec = React.useMemo(
      () => specFn(Object.assign({}, params, editId ? { id: editId } : {})),
      [paramFp, editId, instanceKey]   // eslint-disable-line
    );
    const cacheKey = route + ":" + (editId || "new") + ":" + instanceKey;
    const isEdit = !!spec.row;
    const isDraftRow = isEdit && spec.statusKey && spec.row[spec.statusKey] === "草稿";

    // —— 挂载：buildFormBody(cards) 注入 + 恢复页签缓存；卸载：dirty 且未完结 → 缓存填写值（决议 8d）——
    React.useEffect(() => {
      const host = hostRef.current;
      if (!host) return undefined;
      const cached = window.KIT_FORM_CACHE[cacheKey];
      const fields = cached
        ? spec.fields.map((f) => (f.key && cached[f.key] !== undefined
          ? Object.assign({}, f, { value: cached[f.key], rows: Array.isArray(cached[f.key]) ? cached[f.key] : f.rows })
          : f))
        : spec.fields;
      const fb = UI.buildFormBody({ fields, cols: spec.cols || 2, layout: "cards", onDirty: () => {
        dirtyRef.current = true;
        setDirty(true);
      } });
      host.innerHTML = "";
      host.appendChild(fb.node);
      fbRef.current = fb;
      setAnchors(fb.anchors);
      setActiveAnchor(0);
      if (cached) { dirtyRef.current = true; setDirty(true); UI.toast("已恢复上次未保存的填写内容"); }
      else { dirtyRef.current = false; setDirty(false); }
      doneRef.current = false;
      fb.focusFirst();
      // 滚动联动锚点高亮（main 是滚动容器）
      const scroller = host.closest("main");
      const onScroll = () => {
        const tops = fb.anchors.map((a) => a.el.getBoundingClientRect().top);
        let idx = 0;
        tops.forEach((t, i) => { if (t < 180) idx = i; });
        setActiveAnchor(idx);
      };
      if (scroller) scroller.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        if (scroller) scroller.removeEventListener("scroll", onScroll);
        if (dirtyRef.current && !doneRef.current && fbRef.current) {
          window.KIT_FORM_CACHE[cacheKey] = fbRef.current.getAllVals();   // 切页签保值
        }
      };
    }, [cacheKey, paramFp]);   // eslint-disable-line

    const goBack = () => {
      delete window.KIT_FORM_CACHE[cacheKey];
      doneRef.current = true;
      if (window.DC && window.DC.closeActiveTab) window.DC.closeActiveTab();
      if (navigate && spec.listRoute) navigate(spec.listRoute);
    };
    const doCancel = () => {
      if (dirtyRef.current && !doneRef.current) {
        UI.confirm({ title: "放弃修改？", message: "表单内容尚未保存，离开后本次填写将丢失。", confirmText: "放弃修改", danger: true, onConfirm: goBack });
      } else goBack();
    };
    const doSave = (action) => {
      const fb = fbRef.current;
      if (!fb) return;
      if (action === "draft" && !dirtyRef.current) return;
      if (action !== "draft" && !fb.validate()) return;
      const patch = spec.coerce(fb.getVals());
      if (spec.statusKey) {
        if (action === "draft") patch[spec.statusKey] = "草稿";
        else if (action === "saveSubmit") patch[spec.statusKey] = "审批中";
        else if (isDraftRow && !patch[spec.statusKey]) patch[spec.statusKey] = "草稿";   // 草稿续存但未提交：维持草稿态
      }
      let savedId = spec.row ? spec.row.id : null;
      if (spec.row) {
        A.update(spec.coll, spec.row.id, patch);
      } else {
        const newRow = Object.assign({ id: spec.entity + "-" + Date.now().toString(36) }, spec.newDefaults ? spec.newDefaults() : {}, patch);
        A.add(spec.coll, newRow);
        savedId = newRow.id;
      }
      delete window.KIT_FORM_CACHE[cacheKey];
      doneRef.current = true;
      UI.toast(action === "draft" ? "已保存草稿（列表「草稿」视图可续填提交）"
        : action === "saveSubmit" ? "已保存并提交审批「" + spec.title + "」"
        : action === "saveNew" ? "已保存「" + spec.title + "」，已为你新开一张"
        : (spec.row ? "已保存修改" : "已新建 1 条「" + spec.title + "」"), "ok");
      if (action === "saveNew") { setEditId(null); setInstanceKey((k) => k + 1); return; }
      if (closeAfter) { goBack(); return; }
      setEditId(savedId);          // 留在页面继续编辑刚保存的这条
      setInstanceKey((k) => k + 1);
    };

    const btnStyle = (kind) => Object.assign({
      borderRadius: "var(--radius-btn)", padding: "8px 18px", cursor: "pointer", fontSize: 13, fontWeight: 700,
      border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--ink)",
    }, kind === "primary" ? { border: 0, background: "var(--brand)", color: "#fff" } : null,
       kind === "disabled" ? { opacity: 0.45, cursor: "not-allowed" } : null);

    const showNav = anchors.length >= 3;
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        {/* 面包屑 + 标题 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <button type="button" onClick={doCancel}
            style={{ border: "1px solid var(--line)", background: "var(--surface-2)", borderRadius: "var(--radius-btn)", padding: "5px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", color: "var(--ink-soft)" }}>
            ← 返回列表
          </button>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{(isEdit ? "编辑 · " : "新建 ") + spec.title + (isEdit && (spec.row.name || spec.row.no) ? " · " + (spec.row.name || spec.row.no) : "")}</span>
          {isDraftRow && (
            <span style={{ background: "var(--surface-3)", border: "1px solid var(--line)", color: "var(--ink-soft)", borderRadius: 6, padding: "1px 8px", fontSize: 11.5, fontWeight: 600 }}>草稿</span>
          )}
          {spec.headerNote && <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{spec.headerNote}</span>}
        </div>
        {/* 锚点导航 + 分区卡片 */}
        <div style={showNav ? { display: "grid", gridTemplateColumns: "180px minmax(0,1fr)", gap: 16, alignItems: "start" } : undefined}>
          {showNav && (
            <nav style={{ position: "sticky", top: 8, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 8 }}>
              {anchors.map((a, i) => (
                <button key={a.title} type="button"
                  onClick={() => { a.el.scrollIntoView({ behavior: "smooth", block: "start" }); setActiveAnchor(i); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: 0, textAlign: "left",
                    background: i === activeAnchor ? "var(--brand-soft)" : "transparent",
                    color: i === activeAnchor ? "var(--brand)" : "var(--ink-soft)",
                    borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontWeight: i === activeAnchor ? 800 : 600, cursor: "pointer" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: i === activeAnchor ? "var(--brand)" : "var(--line-strong)", flex: "none" }} />
                  {a.title}
                </button>
              ))}
            </nav>
          )}
          <div ref={hostRef} />
        </div>
        {/* 吸底动作条（红圈五件套 + 保存后关闭勾选） */}
        <div style={{ position: "sticky", bottom: 0, zIndex: 15, display: "flex", alignItems: "center", gap: 8,
          background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px",
          marginTop: 4, boxShadow: "0 -4px 16px rgba(16,24,40,0.06)" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-soft)", cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={closeAfter} onChange={(e) => setCloseAfter(e.target.checked)} />
            【保存】后关闭
          </label>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button type="button" style={btnStyle()} onClick={doCancel}>取消</button>
            <button type="button" disabled={!dirty} style={btnStyle(dirty ? "" : "disabled")} onClick={() => doSave("draft")}>保存草稿</button>
            <button type="button" style={btnStyle()} onClick={() => doSave("saveNew")}>保存并新建</button>
            <button type="button" style={btnStyle()} onClick={() => doSave("saveSubmit")}>保存并提交</button>
            <button type="button" style={btnStyle("primary")} onClick={() => doSave("save")}>保存</button>
          </div>
        </div>
      </div>
    );
  }

  // —— 分发器：app.dc.html 单条 sc-if 承接全部表单路由 ——
  function EntityFormScreen({ route, params, navigate }) {
    const specFn = window.KIT_FORM_SPECS && window.KIT_FORM_SPECS[route];
    if (!specFn) return null;
    return <KitFormPage key={route + ":" + ((params && params.id) || "new")} route={route} specFn={specFn} params={params || {}} navigate={navigate} />;
  }

  window.KitFormPage = KitFormPage;
  window.EntityFormScreen = EntityFormScreen;
  window.KitFormPagePreload = function () { return null; };
})();
