// KitGalleryScreen — 组件展示页（2026-10-07 评审 C-01 / C-02）：共享控件与表格的可操作样板，入口 kit-gallery.dc.html。
// 只演示，不写业务数据；每节标注对应台账条目与 reka-ui 对应组件，便于对照 Vue 实现。
(function () {
  const h = React.createElement;

  const PROJECTS = ["合和新城", "锦绣华庭", "翠湖花园", "车陂商业大楼", "科学城人才公寓", "江湾一号", "亚运城 C1 标段", "利丰北 1-4 号楼", "领秀海 5-6 号楼", "未来印象小区", "白云机场配套宿舍"];
  const SUPPLIERS = ["广州建机租赁", "广东裕恒工程检测", "广州鼎艺广告", "国顺保安", "粤电安装", "洁美物业"];
  const ROWS = [
    { id: 1, name: "裕恒检测费", date: "2025-12-26", type: "过程结算", project: "车陂商业大楼", supplier: "广东裕恒工程检测", amount: 71011, status: "已确认" },
    { id: 2, name: "塔吊租赁 6 月结算", date: "2026-06-30", type: "过程结算", project: "合和新城", supplier: "广州建机租赁", amount: 240000, status: "已确认" },
    { id: 3, name: "施工电梯租赁结算", date: "2026-06-28", type: "过程结算", project: "锦绣华庭", supplier: "广州建机租赁", amount: 108000, status: "已确认" },
    { id: 4, name: "临水临电维护", date: "2026-06-15", type: "过程结算", project: "翠湖花园", supplier: "粤电安装", amount: 36500, status: "待确认" },
    { id: 5, name: "围挡广告制作", date: "2026-05-30", type: "最终结算", project: "合和新城", supplier: "广州鼎艺广告", amount: 18200, status: "已确认" },
    { id: 6, name: "安保服务 5 月", date: "2026-05-31", type: "过程结算", project: "合和新城", supplier: "国顺保安", amount: 22133.33, status: "已确认" },
    { id: 7, name: "渣土外运", date: "2026-05-20", type: "过程结算", project: "江湾一号", supplier: null, amount: 64000, status: "草稿" },
    { id: 8, name: "室内空气检测", date: "2026-03-22", type: "最终结算", project: "翠湖花园", supplier: "广东裕恒工程检测", amount: 7200, status: "已确认" },
  ];
  const STATUS = { "已确认": "ok", "待确认": "warn", "草稿": "brand", "已作废": "danger" };
  const EXISTING_NOS = { "RJ-FB-202610-109": "合和新城泥水班组劳务分包合同", "RJ-FB-202609-087": "锦绣华庭木工班组劳务分包合同" };
  const link = (t) => (t ? h("span", { style: { color: "var(--brand)", cursor: "pointer" } }, t) : h("span", { style: { color: "var(--ink-faint)" } }, "—"));
  const COLS = [
    { key: "name", label: "结算名称", width: 170, fixed: "left", sortable: true, render: (v) => link(v) },
    { key: "date", label: "结算日期", width: 110, sortable: true },
    { key: "type", label: "结算类型", width: 110, filter: true },
    { key: "project", label: "项目", width: 140, filter: true, render: (v) => link(v) },
    { key: "supplier", label: "分供方", width: 170, render: (v) => link(v) },
    { key: "contract", label: "其他支出合同", width: 200 },
    { key: "amount", label: "含税结算金额", width: 140, money: true, sortable: true },
    { key: "penalty", label: "奖罚扣款", width: 110, money: true },
    { key: "paid", label: "累计已付", width: 130, money: true, sortable: true },
    { key: "status", label: "状态", width: 90, filter: true, status: STATUS },
    { key: "_ops", label: "操作", width: 72, fixed: "right", resizable: false, align: "center",
      render: () => h("span", { style: { color: "var(--brand)", cursor: "pointer" } }, "查看") },
  ];
  ROWS.forEach((r, i) => { r.contract = r.project + (r.type === "最终结算" ? "检测服务合同" : "机械租赁合同"); r.penalty = i % 3 === 0 ? -1200 : 0; r.paid = Math.round(r.amount * (r.status === "已确认" ? 0.7 : 0)); });

  function Section({ id, title, refs, children }) {
    return h("section", { id, style: { marginBottom: 28 } },
      h("div", { style: { display: "flex", alignItems: "baseline", gap: 10, margin: "0 0 10px" } },
        h("h2", { style: { margin: 0, fontSize: 16 } }, title),
        refs && h("span", { style: { fontSize: 12, color: "var(--ink-faint)" } }, refs)),
      children);
  }
  const Card = (props) => h("div", { style: { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, padding: 16, ...props.style } }, props.children);
  const Seg = ({ value, onChange, items }) => h("div", { role: "group", style: { display: "inline-flex", border: "1px solid var(--line-strong)", borderRadius: 6, overflow: "hidden" } },
    ...items.map(([k, label]) => h("button", { key: k, type: "button", "aria-pressed": value === k, onClick: () => onChange(k),
      style: { height: 28, padding: "0 10px", border: 0, borderLeft: "1px solid var(--line)", background: value === k ? "var(--surface-2)" : "var(--panel)", fontWeight: value === k ? 700 : 500, font: "inherit", fontSize: 12, cursor: "pointer", color: value === k ? "var(--ink)" : "var(--ink-soft)" } }, label)));

  // —— ① 表单控件 ——
  function ControlsDemo() {
    const KC = window.KitControls;
    const MAIN_SIGN = "2025-09-01";   // 演示：同项目施工合同（主合同）签约日期
    const TODAY = new Date().toISOString().slice(0, 10);
    const [v, setV] = React.useState({ code: "RJ-FB-202610-109", name: "", project: "", supplier: "广州建机租赁", kind: "劳务分包", price: "", date: "2026-07-02", amount: "132800", rate: "9", tax: "", net: "", note: "" });
    const [manual, setManual] = React.useState({});
    const [checked, setChecked] = React.useState(null);   // null=未校验；{ checking } | { errors }
    const [mode, setMode] = React.useState("edit");
    const set = (k) => (x) => {
      setV((s) => ({ ...s, [k]: x }));
      if (k === "tax" || k === "net") setManual((m) => ({ ...m, [k]: true }));
      if (k === "rate") setManual({});                 // 改税率 → 恢复自动计算
      if (checked && checked.errors) setChecked({ errors: { ...checked.errors, [k]: "" } });
    };
    const ro = mode === "readonly", dis = mode === "disabled";
    const r = (parseFloat(v.rate) || 0) / 100;
    const autoNet = v.amount ? (Number(v.amount) / (1 + r)).toFixed(2) : "";
    const autoTax = autoNet ? (Number(v.amount) - Number(autoNet)).toFixed(2) : "";
    const net = manual.net ? v.net : autoNet, tax = manual.tax ? v.tax : autoTax;
    // 实时校验：税额 / 无税金额不能为负、不能超过含税金额；签约日期在主合同日期与今天之间
    const within = (label, x) => (x === "" ? "" : Number(x) < 0 ? label + "不能为负数" : v.amount && Number(x) > Number(v.amount) ? label + "不能超过含税合同金额" : "");
    const dateErr = !v.date ? "" : v.date < MAIN_SIGN ? "签约日期不能早于 " + MAIN_SIGN + "（同项目施工合同签约日期）" : v.date > TODAY ? "签约日期不能晚于今天" : "";
    const live = { tax: within("税额", tax), net: within("无税金额", net), date: dateErr, rate: v.rate !== "" && (Number(v.rate) < 0 || Number(v.rate) > 100) ? "税率应在 0–100 之间" : "" };
    // 保存：先查重合同编号（演示为本地已存编号），再校验必填与上述规则
    const save = () => {
      setChecked({ checking: true });
      setTimeout(() => {
        const e = {};
        if (EXISTING_NOS[v.code.trim()]) e.code = "合同编号「" + v.code.trim() + "」已存在（" + EXISTING_NOS[v.code.trim()] + "）";
        if (!v.name) e.name = "请填写合同名称";
        if (!v.project) e.project = "请填写项目名称";
        if (!v.price) e.price = "请选择计价方式";
        setChecked({ errors: e });
        const all = Object.values(e).concat(Object.values(live)).filter(Boolean);
        window.KitUI.toast(all.length ? all[0] + (all.length > 1 ? "（等 " + all.length + " 处）" : "") : "校验通过（演示，未保存）", all.length ? "warn" : "ok");
      }, 450);
    };
    const err = (k) => (checked && checked.errors && checked.errors[k]) || live[k] || "";
    return h(Card, null,
      h("div", { style: { display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" } },
        h(Seg, { value: mode, onChange: setMode, items: [["edit", "可编辑"], ["readonly", "只读"], ["disabled", "禁用"]] }),
        h("button", { type: "button", className: "ls-btn primary", style: { borderRadius: 6 }, disabled: checked && checked.checking, onClick: save }, checked && checked.checking ? "正在校验编号…" : "保存（先查重编号再校验）"),
        h("button", { type: "button", className: "ls-btn", style: { borderRadius: 6 }, onClick: () => setChecked(null) }, "清除校验"),
        h("span", { style: { fontSize: 12, color: "var(--ink-faint)" } }, "看点：金额悬停出大写，可移入浮层选中或点复制；税额 / 无税金额超额或为负即时标红，改税率恢复自动计算；签约日期范围外置灰")),
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", columnGap: 16, rowGap: 6 } },
        h(KC.Field, { label: "合同编号", tip: "格式 RJ-项目-类别-年月序号；保存时检查是否与已有合同重复", error: err("code"), help: "演示：RJ-FB-202610-109 已被占用" },
          h(KC.Input, { value: v.code, onChange: set("code"), error: !!err("code"), readOnly: ro, disabled: dis })),
        h(KC.Field, { label: "合同名称", required: true, error: err("name") }, h(KC.Input, { value: v.name, onChange: set("name"), placeholder: "如 泥水班组劳务分包合同", error: !!err("name"), readOnly: ro, disabled: dis })),
        h(KC.Field, { label: "项目名称", required: true, error: err("project"), help: "输入即过滤，可「+」快速新建" },
          h(KC.Combobox, { value: v.project, onChange: set("project"), options: PROJECTS, onCreate: (q) => window.KitUI.toast("新建项目：" + (q || "（空）") + "（演示）"), createLabel: "新建项目", error: !!err("project"), disabled: dis || ro })),
        h(KC.Field, { label: "乙方（分供方）" }, h(KC.Combobox, { value: v.supplier, onChange: set("supplier"), options: SUPPLIERS, onCreate: () => window.KitUI.toast("新建分供方（演示）"), createLabel: "新建分供方", disabled: dis || ro })),
        h(KC.Field, { label: "分包类别" }, h(KC.Select, { value: v.kind, onChange: set("kind"), options: ["劳务分包", "专业分包", "机械租赁"], disabled: dis || ro })),
        h(KC.Field, { label: "计价方式", required: true, error: err("price"), help: "超过 8 项自动带搜索" },
          h(KC.Select, { value: v.price, onChange: set("price"), clearable: true, error: !!err("price"), disabled: dis || ro, options: ["固定总价", "固定单价", "按实结算", "包工包料", "清包工", "点工计时", "按面积包干", "按楼层包干", "按户包干"] })),
        h(KC.Field, { label: "签约日期", tip: "不早于同项目施工合同签约日期（演示 " + MAIN_SIGN + "），不晚于今天", error: err("date") },
          h(KC.DatePicker, { value: v.date, onChange: set("date"), min: MAIN_SIGN, max: TODAY, error: !!err("date"), disabled: dis, readOnly: ro })),
        h(KC.Field, { label: "含税合同金额", required: true }, h(KC.NumberInput, { value: v.amount, onChange: set("amount"), suffix: "元", capital: true, readOnly: ro, disabled: dis })),
        h(KC.Field, { label: "税率", error: err("rate") }, h(KC.Input, { value: v.rate, onChange: (x) => set("rate")(x.replace(/[^\d.]/g, "")), suffix: "%", align: "right", error: !!err("rate"), readOnly: ro, disabled: dis })),
        h(KC.Field, { label: "税额", tip: "= 含税金额 − 无税金额；可手改，改税率后恢复自动计算", error: err("tax") },
          h(KC.NumberInput, { value: tax, onChange: set("tax"), suffix: "元", capital: true, error: !!err("tax"), readOnly: ro, disabled: dis })),
        h(KC.Field, { label: "无税金额", tip: "= 含税金额 ÷ (1 + 税率)；可手改，改税率后恢复自动计算", error: err("net") },
          h(KC.NumberInput, { value: net, onChange: set("net"), suffix: "元", capital: true, error: !!err("net"), readOnly: ro, disabled: dis })),
        h(KC.Field, { label: "备注", span: "full" }, h(KC.Textarea, { value: v.note, onChange: set("note"), maxLength: 200, placeholder: "选填", readOnly: ro }))));
  }

  // —— ② 页签 ——
  function TabsDemo() {
    const KC = window.KitControls;
    const [t, setT] = React.useState("info");
    return h(Card, { style: { padding: "0 16px" } }, h(KC.Tabs, { value: t, onChange: setT, ariaLabel: "合同详情页签",
      tabs: [{ key: "info", label: "详细资料" }, { key: "change", label: "甲方变洽签", count: 0 }, { key: "report", label: "报量", count: 2 }, { key: "invoice", label: "开票记录", count: 2 }, { key: "receipt", label: "收款记录", count: 2 }] }),
      h("div", { style: { padding: "14px 0", fontSize: 12.5, color: "var(--ink-soft)" } }, "当前：", t, " · 左右方向键切换，下划线滑动 200ms"));
  }

  // —— 指标摘要条（替代 MetricGrid）——
  function MetricDemo() {
    const KC = window.KitControls;
    const items = [
      { label: "含税合同金额", value: "¥32,388,422.00" },
      { label: "变更后合同金额", value: "¥32,388,422.00", tip: "= 含税合同金额 + 已签证变更" },
      { label: "累计结算", value: "¥26,100,000.00", sub: "占合同 80.6%" },
      { label: "累计开票", value: "¥25,800,000.00" },
      { label: "累计收款", value: "¥25,367,027.00" },
      { label: "按结算应收余额", value: "¥732,973.00", tone: "danger", tip: "= 累计结算 − 累计收款" },
    ];
    return h("div", { style: { display: "grid", gap: 12 } },
      h(Card, { style: { padding: "12px 0" } }, h(KC.MetricStrip, { items })),
      h("div", { style: { display: "flex", gap: 20, alignItems: "center", fontSize: 12.5, color: "var(--ink-soft)" } }, "「?」说明方向（side）：",
        ...[["top", "上"], ["bottom", "下"], ["left", "左"], ["right", "右"]].map(([sd, t]) => h("span", { key: sd, style: { display: "inline-flex", alignItems: "center", gap: 4 } }, t, h(KC.Tip, { text: "说明出现在" + t + "方，side=\"" + sd + "\"", side: sd })))),
      h("div", { style: { display: "grid", gridTemplateColumns: "minmax(0, 420px) minmax(0, 1fr)", gap: 12, alignItems: "start" } },
        h("div", null, h("div", { style: { fontSize: 12, color: "var(--ink-faint)", margin: "0 0 6px" } }, "窄容器自动折行（仍是单条细线）"), h(KC.MetricStrip, { items: items.slice(0, 4), min: 160 })),
        h("div", null, h("div", { style: { fontSize: 12, color: "var(--ink-faint)", margin: "0 0 6px" } }, "放进详情页头卡片内"), h(Card, { style: { padding: "12px 0" } }, h(KC.MetricStrip, { items: items.slice(2) })))));
  }

  // —— ③ 表格状态 ——
  function TableDemo() {
    const [st, setSt] = React.useState("rows");
    const rows = st === "rows" ? ROWS : [];
    const empty = st === "filtered"
      ? { title: "没有符合条件的结算", description: "当前筛选：项目 = 江湾一号、状态 = 已确认", icon: "search-x", action: h("button", { type: "button", className: "ls-btn", style: { borderRadius: 6 }, onClick: () => setSt("rows") }, "清除筛选") }
      : { title: "还没有其他支出结算", description: "从其他支出合同发起结算，或从原库迁入历史结算", action: h("span", { className: "ls-split" }, h("button", { type: "button", className: "ls-btn" }, "原库迁入"), h("button", { type: "button", className: "ls-btn primary" }, "新建结算")) };
    return h("div", null,
      h("div", { style: { marginBottom: 10 } }, h(Seg, { value: st, onChange: setSt, items: [["rows", "有数据"], ["loading", "加载中"], ["never", "从未建档"], ["filtered", "筛选无结果"]] })),
      h("p", { style: { margin: "0 0 8px", fontSize: 12, color: "var(--ink-faint)" } }, "看点：拖表头右边缘调列宽、双击自适应；名称列固定左、操作列固定右，横向滚动时边缘出现阴影；表头排序 / 漏斗筛选可点；固定高度，数据少也不缩。"),
      h(window.KitTable, { columns: COLS, rows, loading: st === "loading", checkable: true, height: 420, empty,
        sum: [{ label: "合计", value: rows.length + " 份" }, { label: "含税结算金额", value: rows.reduce((s, r) => s + r.amount, 0) }],
        footerLeft: (sel) => (sel.length ? "已选 " + sel.length + " 条" : "") }));
  }

  // —— ④ 列表页骨架（ListShell + KitTable，EntityList / StdList 共用）——
  function ListDemo() {
    const [view, setView] = React.useState("all");
    const [q, setQ] = React.useState("");
    const [proj, setProj] = React.useState("");
    const [node, setNode] = React.useState("all");
    const [hf, setHf] = React.useState({});
    const views = [{ key: "all", label: "全部支出结算" }, { key: "已确认", label: "已确认" }, { key: "待确认", label: "待确认" }, { key: "草稿", label: "草稿" }];
    const base = ROWS.filter((r) => node === "all" || r.type === node);
    const shown = base.filter((r) => (view === "all" || r.status === view) && (!proj || r.project === proj) && (!q || (r.name + r.project + (r.supplier || "")).includes(q)));
    const headerChips = Object.keys(hf).filter((k) => hf[k] && hf[k].length).map((k) => ({ key: "h-" + k, label: COLS.find((c) => c.key === k).label + "：" + hf[k].join("、"), onRemove: () => setHf({ ...hf, [k]: [] }) }));
    return h("div", null,
      h("p", { style: { margin: "0 0 8px", fontSize: 12, color: "var(--ink-faint)" } }, "看点：切换视图 / 筛选 / 搜索后列表高度不变（整页列表撑满视口剩余高度，这里演示固定 520px）；表头筛选同样出现在已生效条件里；合计与分页同一行，窄屏才换行。"),
      h(window.ListShell, {
        title: "其他支出结算", count: shown.length,
        views: views.map((v) => ({ ...v, count: base.filter((r) => v.key === "all" || r.status === v.key).length })), view, onView: setView,
        search: q, onSearch: setQ, searchPlaceholder: "搜索结算名称 / 项目 / 分供方",
        filters: [{ key: "proj", label: "项目", value: proj, onChange: setProj, options: Array.from(new Set(ROWS.map((r) => r.project))).map((p) => ({ value: p, label: p })) }],
        chips: headerChips,
        onRefresh: () => window.KitUI.toast("已刷新", "ok"), onColumns: () => window.KitUI.toast("列设置（演示）"),
        onImport: () => window.KitUI.toast("导入（演示）"), onCreate: () => window.KitUI.toast("新建（演示）"),
        more: [{ key: "native", label: "原结算历史迁入", icon: "database-backup", onSelect: () => window.KitUI.toast("原库迁入（演示）") }, { key: "export", label: "导出 Excel", icon: "download", onSelect: () => window.KitUI.toast("导出（演示）") }],
        tree: { title: "全部业务类型", active: node, onChange: setNode, items: [{ key: "all", label: "全部", count: ROWS.length }, { key: "过程结算", label: "过程结算", count: ROWS.filter((r) => r.type === "过程结算").length }, { key: "最终结算", label: "最终结算", count: ROWS.filter((r) => r.type === "最终结算").length }] },
        renderTable: (toolbar) => h(window.KitTable, { toolbar, columns: COLS, rows: shown, height: 520, headerFilters: hf, onHeaderFiltersChange: setHf,
          sum: [{ label: "合计", value: shown.length + " 份" }, { label: "含税结算金额", value: shown.reduce((s, r) => s + r.amount, 0) }],
          empty: { title: "没有符合条件的结算", description: "调整或清除筛选条件后再试", icon: "search-x" } }),
      }));
  }

  // —— ⑤ 整页表单字段（KitUI.buildFormBody，FormPage / formModal 共用）——
  function FormBodyDemo() {
    const ref = React.useRef(null);
    const fb = React.useRef(null);
    const within = (label) => (val, v) => (Number(val) < 0 ? label + "不能为负数" : v.amount && Number(val) > Number(v.amount) ? label + "不能超过含税合同金额" : null);
    React.useEffect(() => {
      if (!ref.current || !window.KitUI) return;
      fb.current = window.KitUI.buildFormBody({ cols: 2, layout: "cards", fields: [
        { section: "基本信息" },
        { key: "code", label: "合同编号", value: "RJ-FB-202610-109", hint: "格式 RJ-项目-类别-年月序号（演示：该编号已被占用）",
          unique: (val) => (EXISTING_NOS[String(val).trim()] ? "合同编号「" + val + "」已存在（" + EXISTING_NOS[String(val).trim()] + "）" : null) },
        { key: "name", label: "合同名称", required: true, placeholder: "如 泥水班组劳务分包合同" },
        { key: "project", label: "项目名称", type: "lookup", required: true, options: PROJECTS },
        { key: "kind", label: "分包类别", type: "select", options: ["劳务分包", "专业分包", "机械租赁"], value: "劳务分包" },
        { key: "date", label: "签约日期", type: "date", required: true, min: "2025-09-01", minLabel: "同项目施工合同签约日期", max: new Date().toISOString().slice(0, 10), maxLabel: "不能晚于今天" },
        { key: "amount", label: "含税合同金额", type: "number", suffix: "元", required: true, value: "132800" },
        { key: "rate", label: "税率", type: "number", suffix: "%", decimals: null, value: "9" },
        { key: "tax", label: "税额", type: "number", suffix: "元", resetOn: ["rate"], check: within("税额"),
          auto: (v) => (v.amount ? Number(v.amount) - Number(v.amount) / (1 + (parseFloat(v.rate) || 0) / 100) : null) },
        { key: "net", label: "无税金额", type: "number", suffix: "元", resetOn: ["rate"], check: within("无税金额"),
          auto: (v) => (v.amount ? Number(v.amount) / (1 + (parseFloat(v.rate) || 0) / 100) : null) },
        { key: "note", label: "备注", type: "textarea", placeholder: "选填" },
      ] });
      ref.current.innerHTML = "";
      ref.current.appendChild(fb.current.node);
    }, []);
    return h("div", null,
      h("div", { style: { display: "flex", gap: 8, marginBottom: 10 } },
        h("button", { type: "button", className: "ls-btn primary", style: { borderRadius: 6 }, onClick: () => fb.current && fb.current.validate() }, "保存（触发校验）")),
      h("div", { ref }));
  }

  // —— ⑥ KitAtoms 现状（C-01 / #496）：与新控件重叠的原语并排 ——
  function AtomsDemo() {
    const KA = window.KitAtoms || {};
    const KC = window.KitControls;
    const [seg, setSeg] = React.useState("a");
    const [sel, setSel] = React.useState("all");
    const [q, setQ] = React.useState("");
    const row = (name, oldNode, newNode, note) => h("tr", null,
      h("td", { style: { fontWeight: 700, whiteSpace: "nowrap" } }, name),
      h("td", null, oldNode || h("span", { style: { color: "var(--ink-faint)" } }, "—")),
      h("td", null, newNode || h("span", { style: { color: "var(--ink-faint)" } }, "—")),
      h("td", { style: { color: "var(--ink-soft)", fontSize: 12, whiteSpace: "normal" } }, note));
    return h(Card, { style: { padding: 0, overflow: "auto" } },
      h("table", { className: "kt-table", style: { minWidth: 980 } },
        h("thead", null, h("tr", null, h("th", { style: { width: 120 } }, "原语"), h("th", null, "KitAtoms 现状"), h("th", null, "建议替代（KitControls / ListShell）"), h("th", { style: { width: 300 } }, "建议"))),
        h("tbody", null,
          row("SelectFilter", KA.SelectFilter && h(KA.SelectFilter, { label: "项目", value: sel, onChange: setSel, options: [{ key: "all", label: "全部项目" }, { key: "a", label: "合和新城" }] }),
            h("span", { style: { width: 160, display: "inline-block" } }, h(KC.Select, { value: sel === "all" ? "" : sel, onChange: (x) => setSel(x || "all"), options: [{ value: "", label: "全部项目" }, { value: "a", label: "合和新城" }] })),
            "重复：改用 KitControls.Select（reka-ui Select），删除 SelectFilter（26 处调用）"),
          row("SearchInput", KA.SearchInput && h(KA.SearchInput, { value: q, onChange: setQ, placeholder: "搜索", width: 180 }),
            h("span", { style: { width: 180, display: "inline-block" } }, h(KC.Input, { value: q, onChange: setQ, prefixIcon: "search", placeholder: "搜索" })),
            "重复：改用 Input 前缀图标（焦点环可见），删除 SearchInput（11 处）"),
          row("SegTab", KA.SegTab && h(KA.SegTab, { tabs: [{ key: "a", label: "全部", count: 3 }, { key: "b", label: "已确认", count: 2 }], active: seg, onChange: setSeg }),
            h(KC.Tabs, { value: seg, onChange: setSeg, tabs: [{ key: "a", label: "全部", count: 3 }, { key: "b", label: "已确认", count: 2 }] }),
            "重复：改用 KitControls.Tabs（reka-ui Tabs，方向键、滑动下划线），删除 SegTab（12 处）；列表业务态改走 ListShell 视图切换"),
          row("SectionHeader", KA.SectionHeader && h(KA.SectionHeader, null, "区块标题"), null, "保留（领域常用，非库组件）；另一会话已改为 h2 语义"),
          row("Metric / MetricGrid", KA.MetricGrid && KA.Metric && h("div", { style: { width: 360 } }, h(KA.MetricGrid, { cols: 2 }, h(KA.Metric, { label: "含税合同金额", value: "¥32,388,422.00" }), h(KA.Metric, { label: "应收余额", value: "¥732,973.00", tone: "danger" }))),
            h("div", { style: { width: 380 } }, h(KC.MetricStrip, { items: [{ label: "含税合同金额", value: "¥32,388,422.00" }, { label: "应收余额", value: "¥732,973.00", tone: "danger", tip: "= 累计结算 − 累计收款" }] })),
            "改用 KitControls.MetricStrip：项间单条细线、无每格外框、数值常规字体；删除 MetricGrid / Metric（5 + 8 处）"),
          row("StatePanel", KA.StatePanel && h("div", { style: { width: 320 } }, h(KA.StatePanel, { state: "empty", title: "暂无记录", description: "说明文字", compact: true })), null,
            "保留；表格内空态已由 KitTable.empty 承担，StatePanel 只用于整页 / 区块"),
          row("EntityLink / MoneyLink", h("span", null, KA.EntityLink && h(KA.EntityLink, { type: "project", id: "p1", label: "合和新城" }), "  ", KA.MoneyLink && h(KA.MoneyLink, { value: 240000, onClick: () => {} })), null, "保留（穿透铁律载体，组件库无对应）"),
          row("TreeNav", null, null, "列表左树已由 ListShell 内置；TreeNav 仅留发票台账 / 送货归档两处，统一后删除"),
          row("RowActionMenu", KA.RowActionMenu && h(KA.RowActionMenu, { items: [{ key: "e", label: "编辑", onSelect: () => {} }, { key: "d", label: "删除", danger: true, onSelect: () => {} }] }), null,
            "另一会话正在按 reka-ui DropdownMenu 语义重写（挂 body、键盘），合并后表格操作列统一用它，减少常驻红色删除图标"))));
  }

  function KitGalleryScreen() {
    const ready = window.KitControls && window.KitTable && window.ListShell && window.KitUI;
    const [, force] = React.useState(0);
    React.useEffect(() => { if (!ready) { const t = setInterval(() => { if (window.KitControls && window.KitTable && window.ListShell && window.KitUI) { clearInterval(t); force(1); } }, 50); return () => clearInterval(t); } return undefined; }, []);
    if (!ready) return h("div", { style: { padding: 24, color: "var(--ink-faint)" } }, "组件加载中…");
    const toc = [["controls", "① 表单控件"], ["tabs", "② 页签"], ["metrics", "指标摘要条"], ["table", "③ 表格状态"], ["list", "④ 列表页骨架"], ["formbody", "⑤ 整页表单字段"], ["atoms", "⑥ KitAtoms 去重"]];
    return h("div", { style: { maxWidth: 1280, margin: "0 auto", padding: "20px 24px 80px" } },
      h("h1", { style: { fontSize: 20, margin: "0 0 4px" } }, "组件展示"),
      h("p", { style: { margin: "0 0 14px", color: "var(--ink-soft)", fontSize: 13 } }, "设计稿共享组件的可操作样板。结构与键盘行为对齐 reka-ui（Vue 实现所用库），布局按红圈。"),
      h("nav", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 } }, ...toc.map(([id, label]) => h("a", { key: id, href: "#" + id, style: { padding: "4px 10px", border: "1px solid var(--line)", borderRadius: 999, background: "var(--panel)", color: "var(--ink-soft)", textDecoration: "none", fontSize: 12.5 } }, label))),
      h(Section, { id: "controls", title: "① 表单控件", refs: "V-08 / V-09 / C-03 · reka-ui Select / Combobox / DatePicker / NumberField / Tooltip" }, h(ControlsDemo)),
      h(Section, { id: "tabs", title: "② 页签", refs: "reka-ui Tabs" }, h(TabsDemo)),
      h(Section, { id: "metrics", title: "指标摘要条", refs: "评审第 5 点 · 替代 KitAtoms.MetricGrid" }, h(MetricDemo)),
      h(Section, { id: "table", title: "③ 表格状态", refs: "V-01 / V-02 / V-03 / V-07 / C-02 · KitTable" }, h(TableDemo)),
      h(Section, { id: "list", title: "④ 列表页骨架", refs: "V-04 / V-05 / V-06 / C-05 · ListShell（EntityList 20 屏 + StdList 15 屏共用）" }, h(ListDemo)),
      h(Section, { id: "formbody", title: "⑤ 整页表单字段", refs: "V-08 / V-09 · KitUI.buildFormBody（所有 FormPage / 弹窗表单）" }, h(FormBodyDemo)),
      h(Section, { id: "atoms", title: "⑥ KitAtoms 去重", refs: "C-01 / #496" }, h(AtomsDemo)));
  }

  window.KitGalleryScreen = KitGalleryScreen;
})();
