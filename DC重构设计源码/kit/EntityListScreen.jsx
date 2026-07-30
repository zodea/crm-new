// EntityListScreen — 批A 底座件②：列表工厂。一份 meta 生成整页红圈式列表：
//   红圈四件：四级金额链列 + 底部业务汇总行(多段) + 业务态默认视图(非"全部") + 左侧分类(可选)
//   交互闭环照抄 P1 SubTable 范式并升级为共享 store 写路径：新增/编辑 formModal 由列自动生成、
//   删除软删 undoToast(APP.softDel/restore)、搜索、下拉筛选、⚙列显隐、导入(ADR 0005 importModal)、
//   导出(数据表走 Excel 列/范围选择，ADR 0004 文件夹规范只用于文件原件)。
// meta 契约（新列表 = 新 meta，勿再手写整页）：
//   entity   实体 key（新增行 id 前缀/导出文件名）        coll     window.APP 集合名（CRUD 唯一写路径）
//   title    列表标题                                    filter(row)   本列表基础过滤（如 kind==="施工"）
//   columns  KitTable 列 + 表单提示：{ key,label,width,align,mono,money,color,render(v,row),
//            form:{type:"select"|"textarea"|"date"|"number"|"lookup"|"readonly"|"grid",options,placeholder,
//                  section:"分组标题",required,hint,suffix,dependsOn,compute,columns,rows,summaryKeys,
//                  toLabel(存储值)→表单显示,toValue(表单值)→存储值}|false, noForm }   // toX 用于 id↔名称 select
//   formOnly [{key,label,money,form:{...}}] 仅表单字段（新增/编辑弹窗出现，不占表格列）——
//            红圈对标：表单字段数 ≫ 列表列数，完整单据字段全走这里（差距清单 2026-07-11 §1）
//   formWidth/formCols/formSubtitle/formActions 表单弹窗配置（actions=["draft","saveNew","saveSubmit"] 保存动作组）
//   formRoute  整页表单路由（grill 决议 2026-07-18：设则新建/编辑跳 kit/forms/* 注册的整页表单页签，弹窗仅兜底）
//   typeSelect {title,options:[{value,label,hint}],defaultValue} 新建三段式第一段（类型 → params.type 带进表单）
//   statusKey  状态字段名 → 自动补「草稿」视图 chip + 草稿行点击直进表单续填（草稿三入口，决议 8c）
//   views    [{key,label,filter(row)}] 业务态视图        defaultView  默认视图 key（红圈：默认业务态）
//   filters  [{key,label,options:[{key,label}],match(row,val)}] 下拉筛选（key"all"=不过滤）
//   searchKeys 搜索命中字段                              leftNav  {title,items:[{key,label,filter(row)}]} 左侧分类
//   summary(rows) → [{label,value}] 底部业务汇总行        newDefaults() 新增行隐藏字段（kind/subKind 等）
//   importOpts {targetFields,sourceCols,fileName,rowCount}  onRowOpen(row) 行点击（一般=打开详情）
//   pageSize / tableMinWidth 透传 KitTable
(function () {
  if (window.EntityListScreen) { window.EntityListPreload = window.EntityListPreload || function () { return null; }; return; }
  const DS = () => window.DesignSystem_e3d871 || {};
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), formModal: () => {}, modal: () => {}, undoToast: () => {}, importModal: () => {} };

  function EntityListScreen({ meta, params, navigate }) {
    const { Button, IconButton, Icon } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const A = window.APP;
    if (!A || !window.KitTable || !KA.SegTab) return null;
    A.use();
    // 整页表单路由（grill 决议 2026-07-18 #3）：meta.formRoute 存在时新建/编辑跳整页表单页签；
    // meta.typeSelect 存在时新建先弹类型选择（三段式第一段）。navigate 优先取 prop，兜底 window.DC。
    const nav = navigate || (window.DC && window.DC.navigate);

    // meta.statusKey：状态字段名 → 自动补「草稿」视图 chip（0 条也显示，草稿三入口②，决议 8c）
    const views = (meta.views || []).concat(
      meta.statusKey && !(meta.views || []).some((v) => v.key === "__draft")
        ? [{ key: "__draft", label: "草稿", filter: (r) => r[meta.statusKey] === "草稿" }] : []
    );
    const [view, setView] = React.useState(meta.defaultView || (views[0] && views[0].key));
    const [navKey, setNavKey] = React.useState(meta.leftNav ? meta.leftNav.items[0].key : null);
    const [q, setQ] = React.useState("");
    const [filterVals, setFilterVals] = React.useState({});
    const [hidden, setHidden] = React.useState({});   // ⚙ 列显隐：{colKey:true}=隐藏

    // —— 带参预筛（批B 金额穿透铁律④）：meta.fromParams(params)→{label,filter}，可一键摘除 ——
    // 同 route 复用页签时 params 会变，按 params 指纹重置摘除态与预筛计算
    const paramFp = JSON.stringify(params || {});
    const [paramOffAt, setParamOffAt] = React.useState(null);      // 记录被摘除时的指纹
    const paramPre = React.useMemo(() => (meta.fromParams && params ? meta.fromParams(params) : null), [paramFp]);  // eslint-disable-line
    const paramActive = paramPre && paramOffAt !== paramFp;

    // —— 数据管道：store → 基础过滤 → 带参预筛 → 左侧分类 → 业务态视图 → 下拉筛选 → 搜索 ——
    const baseRows0 = A.rows(meta.coll).filter((r) => (meta.filter ? meta.filter(r) : true));
    const baseRows = paramActive ? baseRows0.filter(paramPre.filter) : baseRows0;
    const navItem = meta.leftNav && meta.leftNav.items.find((it) => it.key === navKey);
    const navRows = navItem && navItem.filter ? baseRows.filter(navItem.filter) : baseRows;
    const viewDef = views.find((v) => v.key === view);
    const viewRows = viewDef && viewDef.filter ? navRows.filter(viewDef.filter) : navRows;
    const filtered = (meta.filters || []).reduce((rows, f) => {
      const val = filterVals[f.key] || "all";
      return val === "all" ? rows : rows.filter((r) => f.match(r, val));
    }, viewRows);
    const ql = q.trim().toLowerCase();
    const shown = ql
      ? filtered.filter((r) => (meta.searchKeys || meta.columns.map((c) => c.key)).some((k) => String(r[k] == null ? "" : r[k]).toLowerCase().includes(ql)))
      : filtered;

    // —— CRUD（唯一写路径 = window.APP）——
    // 表单字段 = 表格列(带 form) + meta.formOnly（仅表单字段，不占表格列，shape 同 columns：{key,label,money,form:{...}}）。
    // c.form 全量透传给 KitUI.formModal（新能力契约见其头注释）：section 分组标题 / required 必填 / hint 说明 /
    //   suffix 单位 / type:"lookup" 检索下拉(options 可为 fn(vals) 级联) / dependsOn 依赖拦截 /
    //   type:"readonly"+compute(vals) 带出区块 / type:"grid"+columns/rows/summaryKeys 明细网格。
    // meta.formWidth / formCols / formSubtitle / formActions(["draft","saveNew","saveSubmit"]) 透传弹窗配置。
    const formDefs = meta.columns.filter((c) => c.form !== false && !c.noForm && c.key).concat(meta.formOnly || []);
    const moneyKeys = new Set(formDefs.filter((c) => c.money).map((c) => c.key));
    // 空值不覆盖 newDefaults；money 转数值；form.toValue 支持「表单显示名 → 存储 id」（如 项目/乙方 select）
    const coerce = (v) => {
      const o = {};
      Object.keys(v).forEach((k) => {
        if (v[k] === "" || v[k] == null) return;
        const col = formDefs.find((c) => c.key === k);
        o[k] = col && col.form && col.form.toValue ? col.form.toValue(v[k]) : v[k];
        if (moneyKeys.has(k) && !Array.isArray(o[k])) o[k] = Number(String(o[k]).replace(/[^\d.\-]/g, "")) || 0;
      });
      return o;
    };
    const buildFields = (row) => {
      const out = [];
      formDefs.forEach((c, i) => {
        const f = c.form || {};
        if (f.section) out.push({ section: f.section });
        const fld = Object.assign({}, f, {
          section: undefined,
          key: c.key, label: c.label,
          value: row ? (f.toLabel ? f.toLabel(row[c.key], row) : row[c.key]) : (f.value !== undefined ? f.value : ""),
          full: f.full || f.type === "grid" || f.type === "textarea" || (formDefs.length % 2 === 1 && i === formDefs.length - 1),
        });
        out.push(fld);
      });
      return out;
    };
    // meta.addFlow({ A, UI, buildFields, coerce, saveNew })：整表新建流自定义（如 付款申请「先选业务类型再出表单」）
    const saveNew = (patch, action) => {
      const row = { id: meta.entity + "-" + Date.now().toString(36), ...(meta.newDefaults ? meta.newDefaults() : {}), ...patch };
      A.add(meta.coll, row);
      UI().toast(action === "draft" ? "已保存草稿「" + meta.title + "」（可稍后补全提交）"
        : action === "saveSubmit" ? "已保存并提交 1 条「" + meta.title + "」"
        : "已新建 1 条「" + meta.title + "」", "ok");
    };
    const formOpts = (row) => ({
      title: row ? "编辑 · " + (row.name || row.no || meta.title) : "新建 " + meta.title,
      subtitle: meta.formSubtitle, cols: meta.formCols || 2, width: meta.formWidth || 620,
      actions: meta.formActions, fields: buildFields(row),
    });
    const addRow = () => {
      if (meta.formRoute && nav) {
        if (meta.typeSelect) {   // 新建三段式第一段：业务类型选择 → 带 type 进整页表单
          UI().typeSelect(meta.typeSelect).then((v) => { if (v != null) nav(meta.formRoute, { type: v }); });
          return;
        }
        nav(meta.formRoute, {});
        return;
      }
      return meta.addFlow ? meta.addFlow({ A, UI: UI(), buildFields, coerce, saveNew }) : UI().formModal({ ...formOpts(null),
        onSave: (v, action) => {
          saveNew(coerce(v), action);
          if (action === "saveNew") setTimeout(addRow, 120);   // 保存并新建：落库后原样再开一张空表单
        } });
    };
    const editRow = (row) => {
      // editFormRoute：仅编辑走整页表单（新建仍走 addFlow 拦截，如 付款管理 编辑跳 payApplyForm）
      if ((meta.formRoute || meta.editFormRoute) && nav) return nav(meta.formRoute || meta.editFormRoute, { id: row.id });
      return UI().formModal({ ...formOpts(row),
        onSave: (v) => { A.update(meta.coll, row.id, coerce(v)); UI().toast("已保存", "ok"); } });
    };
    const delRow = (row) => UI().confirm({ title: "删除该" + meta.title + "？", danger: true, confirmText: "删除",
      message: "确定删除「" + (row.name || row.no || "该行") + "」？删除为软删除，可在 5 秒内撤回。",
      onConfirm: () => { A.softDel(meta.coll, row.id); UI().undoToast("已删除「" + (row.name || meta.title) + "」", () => A.restore(meta.coll, row.id)); } });

    // —— 导入（ADR 0005：字段映射 + 行数 + 进度）——
    const doImport = () => UI().importModal(Object.assign({
      title: "导入 " + meta.title, subtitle: "Excel → 字段映射 → 校验入库",
      targetFields: formCols.map((c) => c.label), sourceCols: formCols.map((c) => c.label),
      fileName: meta.entity + "-import.xlsx", rowCount: 26,
      onDone: (n) => UI().toast("已导入 " + n + " 行「" + meta.title + "」（演示）", "ok"),
    }, meta.importOpts || {}));

    // —— 导出（数据表 → Excel：列选择 + 范围选择；文件/原件类才走 exportModal 文件夹规范）——
    const doExport = () => {
      const m = UI().modal({ title: "导出 " + meta.title + " · Excel", subtitle: "选择导出列与数据范围", width: 520, bodyHTML: "",
        actions: [{ label: "取消" }, { label: "导出 Excel", primary: true, onClick: () => {
          const n = rangeAll.checked ? baseRows.length : shown.length;
          const colN = boxes.filter((b) => b.input.checked).length;
          UI().toast("正在生成 Excel（" + n + " 行 × " + colN + " 列）…");
          setTimeout(() => UI().toast("已导出 " + meta.entity + ".xlsx（" + n + " 行）", "ok"), 700);
        } }] });
      if (!m || !m.body) return;
      const mk = (tag, css, text) => { const d = document.createElement(tag); if (css) Object.assign(d.style, css); if (text) d.textContent = text; return d; };
      const secTitle = (t) => mk("div", { fontSize: "12px", fontWeight: "700", color: "var(--ink-soft)", margin: "0 0 8px" }, t);
      // 范围
      m.body.appendChild(secTitle("数据范围"));
      const rangeWrap = mk("div", { display: "flex", gap: "18px", marginBottom: "14px", fontSize: "13px" });
      const mkRadio = (label, checked) => { const lab = mk("label", { display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }); const r = document.createElement("input"); r.type = "radio"; r.name = "elx-range"; r.checked = checked; lab.appendChild(r); lab.appendChild(mk("span", null, label)); rangeWrap.appendChild(lab); return r; };
      const rangeCur = mkRadio("当前筛选结果（" + shown.length + " 条）", true);
      const rangeAll = mkRadio("全部（" + baseRows.length + " 条）", false);
      m.body.appendChild(rangeWrap);
      // 列
      m.body.appendChild(secTitle("导出列"));
      const colWrap = mk("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "13px" });
      const boxes = meta.columns.filter((c) => c.key !== "_ops").map((c) => {
        const lab = mk("label", { display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" });
        const input = document.createElement("input"); input.type = "checkbox"; input.checked = !hidden[c.key];
        lab.appendChild(input); lab.appendChild(mk("span", null, c.label)); colWrap.appendChild(lab);
        return { key: c.key, input };
      });
      m.body.appendChild(colWrap);
      void rangeCur;
    };

    // —— ⚙ 列显隐 ——
    const doColumns = () => {
      const m = UI().modal({ title: "列设置", subtitle: "勾选要显示的列", width: 420, bodyHTML: "",
        actions: [{ label: "取消" }, { label: "应用", primary: true, onClick: () => {
          const next = {}; boxes.forEach((b) => { if (!b.input.checked) next[b.key] = true; });
          setHidden(next); UI().toast("列设置已应用", "ok");
        } }] });
      if (!m || !m.body) return;
      const wrap = document.createElement("div");
      Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "13px" });
      const boxes = meta.columns.map((c) => {
        const lab = document.createElement("label");
        Object.assign(lab.style, { display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" });
        const input = document.createElement("input"); input.type = "checkbox"; input.checked = !hidden[c.key];
        const span = document.createElement("span"); span.textContent = c.label;
        lab.appendChild(input); lab.appendChild(span); wrap.appendChild(lab);
        return { key: c.key, input };
      });
      m.body.appendChild(wrap);
    };

    // —— 列 = meta 列（应用显隐）+ 操作列 ——
    const cols = meta.columns.filter((c) => !hidden[c.key]).concat([{
      key: "_ops", label: "操作", width: 92, align: "center", noForm: true,
      render: (v, r) => (
        <span style={{ display: "inline-flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <IconButton icon="square-pen" title="编辑" onClick={() => editRow(r)} />
          <IconButton icon="trash-2" title="删除" onClick={() => delRow(r)} />
        </span>
      ),
    }]);

    // 穿透进入时切到「全部」视图（预筛已圈定范围，业务态默认视图会再砍一刀反而看不全）
    React.useEffect(() => { if (paramPre && views.some((v) => v.key === "all")) setView("all"); }, [paramFp]);  // eslint-disable-line

    const toolbar = (
      <div style={{ borderBottom: "1px solid var(--line)" }}>
        <div style={{ padding: "12px 16px 10px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{meta.title}
            <span style={{ marginLeft: 6, color: "var(--ink-soft)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>({shown.length})</span>
          </span>
          {paramActive && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--brand-soft)", color: "var(--brand-deep)",
              border: "1px solid rgba(57,118,198,0.25)", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
              {paramPre.label}
              <button type="button" title="移除该筛选" onClick={() => setParamOffAt(paramFp)}
                style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <KA.SearchInput value={q} onChange={setQ} placeholder={"搜索" + meta.title} width={190} />
            {(meta.filters || []).map((f) => (
              <KA.SelectFilter key={f.key} label={f.label} options={f.options} value={filterVals[f.key] || "all"}
                onChange={(val) => setFilterVals((s) => ({ ...s, [f.key]: val }))} />
            ))}
            <IconButton icon="settings-2" title="列设置" onClick={doColumns} />
          </div>
        </div>
        <div style={{ padding: "0 16px", display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {views.length > 0 && <KA.SegTab tabs={views.map((v) => ({ key: v.key, label: v.label, count: (v.filter ? navRows.filter(v.filter) : navRows).length }))} active={view} onChange={setView} />}
          </div>
          <div style={{ display: "flex", gap: 8, padding: "0 0 8px", flex: "none" }}>
            <Button size="sm" icon="upload" onClick={doImport}>导入</Button>
            <Button size="sm" icon="download" onClick={doExport}>导出</Button>
            <Button size="sm" variant="primary" icon="plus" onClick={addRow}>新建</Button>
          </div>
        </div>
      </div>
    );

    const table = (
      <window.KitTable toolbar={toolbar} columns={cols.map((c) => ({ width: 120, ...c }))} rows={shown}
        pageSize={meta.pageSize || 10} minRows={10}
        sum={meta.summary ? meta.summary(shown) : undefined}
        tableMinWidth={meta.tableMinWidth != null ? meta.tableMinWidth : Math.max(720, cols.length * 128)}
        onRowClick={(meta.onRowOpen || (meta.statusKey && meta.formRoute)) ? (r) => {
          // 草稿行整行点击直接进整页表单续填（草稿三入口③，决议 8c）；普通行走原 onRowOpen
          if (meta.statusKey && meta.formRoute && nav && r[meta.statusKey] === "草稿") return nav(meta.formRoute, { id: r.id });
          if (meta.onRowOpen) meta.onRowOpen(r);
        } : undefined}
        footerLeft={"共 " + shown.length + " 条"} empty="暂无数据" />
    );

    if (!meta.leftNav) return table;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "216px minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        {/* 左树 sticky：应用滚动在 document 层，116 = 吸顶 header(64)+页签栏(40)+呼吸位（2026-07-19 反馈轮） */}
        <div style={{ position: "sticky", top: 116, alignSelf: "start", maxHeight: "calc(100vh - 132px)", overflowY: "auto" }}>
          <KA.TreeNav title={meta.leftNav.title} active={navKey} onChange={setNavKey}
            items={meta.leftNav.items.map((it) => ({ key: it.key, label: it.label, icon: it.icon,
              count: (it.filter ? baseRows.filter(it.filter) : baseRows).length }))} />
        </div>
        {table}
      </div>
    );
  }

  void DS;
  window.EntityListScreen = EntityListScreen;
  window.EntityListPreload = function () { return null; };
})();
