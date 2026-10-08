// KitTable — 全局红圈式表格原语（注册 window.KitTable，经隐藏 x-import 预加载）
// 设计稿只表达视觉与交互；Vue 实现为 app/components/ui/KitTable.vue（vxe-table 封装），每项能力须映射到 vxe-table 现成配置，见规格 §12：
//   拖拽列宽 / 双击自适应 → resizable + resize-config；固定列 → column.fixed；排序 → sortable + sort-config；
//   表头筛选面板 → filters + filter-config；固定高度表体内滚 → height；空态 → #empty；合计 + 分页同行 → vxe-pager #left。
// 视觉（2026-10-07 评审 V-01~V-07）：有几行画几行、不补空行；紧凑行 36px（同红圈）；数字右对齐等宽数字，不换等宽字体；
//   列头漏斗 / 排序常态显示（规格 §12 可操作表头）；横向可滚时左右边缘出现阴影提示；状态用 KitControls.StatusTag（规格 §16）。
// columns: [{ key, label, width, minWidth, align, money, fixed:"left"|"right", sortable, filter(true|[{value,label}]),
//             status:{值: tone}, resizable(默认 true), render(v,row) }]
// props: rows, pageSize=20, checkable, checkDisabled(row), onCheckChange(rows), sum:{label,value}|[...],
//        footerLeft(node|fn(checkedRows)), onRowClick(row), empty(string|{title,description,icon,action}), tableMinWidth,
//        loading（骨架行）, height（数字 | "fill" 撑满视口剩余高度，表体内滚、底栏固定）, toolbar,
//        headerFilters / onHeaderFiltersChange（受控表头筛选 {colKey:[value]}，供 ListShell 显示已生效条件）, remote（不在本地筛选排序）
(function () {
  if (window.KitTable) { window.KitTableScreen = window.KitTableScreen || function () { return null; }; return; }
  const DS = () => window.DesignSystem_e3d871 || {};
  const h = React.createElement;
  const yuan2 = (v) => (v == null || v === "" ? "—" : (Number(v) < 0 ? "-¥" : "¥") + Math.abs(Number(v)).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const SEQ_W = 44, CHK_W = 36;

  if (!document.getElementById("kit-table-css")) {
    const st = document.createElement("style");
    st.id = "kit-table-css";
    st.textContent = [
      ".kt-scroll { position:relative; overflow:auto; min-width:0; scrollbar-width:thin; scrollbar-color:#c3cbd8 transparent; }",
      ".kt-scroll::-webkit-scrollbar { height:8px; width:8px; } .kt-scroll::-webkit-scrollbar-thumb { background:#c3cbd8; border-radius:4px; } .kt-scroll::-webkit-scrollbar-track { background:transparent; }",
      ".kt-table { border-collapse:separate; border-spacing:0; table-layout:fixed; font-size:13px; font-variant-numeric:tabular-nums; }",
      ".kt-table th { position:sticky; top:0; z-index:2; height:34px; padding:0 10px; background:var(--surface-2); border-bottom:1px solid var(--line); color:var(--ink-soft); font-weight:600; font-size:12.5px; text-align:left; white-space:nowrap; overflow:visible; }",
      ".kt-table td { height:36px; padding:0 10px; border-bottom:1px solid var(--line); background:var(--panel); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; vertical-align:middle; transition:background .1s; }",
      ".kt-table tbody tr:hover td { background:#f6f8fc; }",
      ".kt-table tbody tr.kt-click { cursor:pointer; }",
      ".kt-table tbody tr.kt-checked td { background:var(--brand-soft); }",
      ".kt-table tbody tr:focus-visible { outline:2px solid var(--brand); outline-offset:-2px; }",
      ".kt-table .kt-fix-l, .kt-table .kt-fix-r { position:sticky; z-index:1; }",
      ".kt-table .kt-chk, .kt-table .kt-seq { padding:0; text-align:center; text-overflow:clip; }",
      ".kt-table th.kt-fix-l, .kt-table th.kt-fix-r { z-index:3; }",
      ".kt-scroll[data-sl=true] .kt-edge-l { box-shadow:6px 0 6px -4px rgb(15 23 42 / 14%); }",
      ".kt-scroll[data-sr=true] .kt-edge-r { box-shadow:-6px 0 6px -4px rgb(15 23 42 / 14%); }",
      ".kt-th { display:flex; align-items:center; gap:2px; min-width:0; }",
      ".kt-th-label { overflow:hidden; text-overflow:ellipsis; }",
      ".kt-hbtn { display:inline-grid; place-items:center; width:20px; height:20px; flex:none; border:0; border-radius:4px; background:transparent; color:var(--ink-faint); cursor:pointer; padding:0; }",
      ".kt-hbtn:hover { background:var(--surface-3); color:var(--ink); }",
      ".kt-hbtn.on { color:var(--brand); }",
      ".kt-hbtn:focus-visible { outline:1px solid var(--brand); }",
      ".kt-sort { display:inline-flex; flex-direction:column; line-height:0; gap:1px; }",
      ".kt-sort i { width:0; height:0; border-left:3.5px solid transparent; border-right:3.5px solid transparent; }",
      ".kt-sort i.up { border-bottom:4px solid #b4bdca; } .kt-sort i.dn { border-top:4px solid #b4bdca; }",
      ".kt-sort[data-dir=asc] i.up { border-bottom-color:var(--brand); } .kt-sort[data-dir=desc] i.dn { border-top-color:var(--brand); }",
      ".kt-resize { position:absolute; top:0; right:-4px; width:7px; height:100%; cursor:col-resize; z-index:4; }",
      ".kt-resize::after { content:''; position:absolute; left:3px; top:8px; bottom:8px; width:1px; background:var(--line-strong); }",
      ".kt-resize:hover::after, .kt-resize.on::after { top:0; bottom:0; width:2px; left:2px; background:var(--brand); }",
      ".kt-skel span { display:block; height:10px; border-radius:4px; background:linear-gradient(90deg,var(--surface-2) 25%,var(--surface-3) 37%,var(--surface-2) 63%); background-size:400% 100%; animation:kt-sh 1.2s ease infinite; }",
      "@keyframes kt-sh { from { background-position:100% 0; } to { background-position:0 0; } }",
      ".kt-foot { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px 16px; padding:8px 12px; border-top:1px solid var(--line); font-size:12.5px; color:var(--ink-soft); flex:none; }",
      ".kt-sum { display:flex; flex-wrap:wrap; gap:4px 20px; } .kt-sum b { color:var(--ink); font-weight:700; }",
      ".kt-pg { display:flex; align-items:center; gap:4px; margin-left:auto; }",
      ".kt-pg button { min-width:26px; height:26px; padding:0 6px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink-soft); font:inherit; font-size:12px; cursor:pointer; transition:border-color .12s,color .12s; }",
      ".kt-pg button:hover:not(:disabled) { border-color:var(--brand); color:var(--brand); }",
      ".kt-pg button.on { border-color:var(--brand); color:var(--brand); font-weight:700; }",
      ".kt-pg button:disabled { color:var(--ink-faint); cursor:not-allowed; }",
      ".kt-fpop { position:fixed; z-index:10050; width:220px; padding:8px; background:var(--panel); border:1px solid var(--line); border-radius:8px; box-shadow:var(--shadow-pop); animation:kc-in .14s ease-out; font-size:13px; }",
      ".kt-fpop .list { max-height:220px; overflow:auto; margin:6px 0; }",
      ".kt-fpop label { display:flex; align-items:center; gap:8px; padding:5px 6px; border-radius:5px; cursor:pointer; }",
      ".kt-fpop label:hover { background:var(--surface-2); }",
      ".kt-fpop input[type=checkbox] { accent-color:var(--brand); }",
      ".kt-fpop .bar { display:flex; justify-content:space-between; align-items:center; gap:6px; padding-top:8px; border-top:1px solid var(--line); }",
      ".kt-fpop .bar button { height:26px; padding:0 10px; border:1px solid var(--line-strong); border-radius:6px; background:var(--panel); font:inherit; font-size:12px; cursor:pointer; }",
      ".kt-fpop .bar button.primary { background:var(--brand); border-color:var(--brand); color:#fff; }",
      ".kt-fpop .link { border:0 !important; padding:0 !important; color:var(--ink-soft); background:none !important; }",
      ".kt-fpop .link:hover { color:var(--brand); }",
      "@media (prefers-reduced-motion: reduce) { .kt-table td { transition:none; } .kt-skel span, .kt-fpop { animation:none; } }",
    ].join("\n");
    document.head.appendChild(st);
  }

  // 空态：字符串兼容旧调用；对象 {title, description, icon, action} 对齐规格 §09
  function EmptyState({ empty, Icon }) {
    const spec = typeof empty === "object" && empty ? empty : { title: empty || "暂无数据" };
    return h("div", { role: "status", style: { display: "grid", placeItems: "center", alignContent: "center", gap: 8, padding: "44px 16px", textAlign: "center", color: "var(--ink-soft)", flex: 1 } },
      h("div", { style: { width: 44, height: 44, borderRadius: 12, background: "var(--surface-2)", display: "grid", placeItems: "center" } },
        Icon ? h(Icon, { name: spec.icon || "inbox", size: 20, color: "var(--ink-faint)" }) : null),
      h("b", { style: { color: "var(--ink)", fontSize: 14 } }, spec.title),
      spec.description ? h("span", { style: { fontSize: 12.5, maxWidth: 420 } }, spec.description) : null,
      spec.action || null);
  }

  // 表头筛选面板：打开时复制条件为草稿，「应用」提交，「清除」立即恢复不限；Esc / 外部点击取消（规格 §12）
  function FilterPop({ anchor, column, options, value, onApply, onClose }) {
    const ref = React.useRef(null);
    const [draft, setDraft] = React.useState(value || []);
    const [q, setQ] = React.useState("");
    const [pos, setPos] = React.useState(null);
    React.useLayoutEffect(() => {
      const r = anchor.getBoundingClientRect();
      setPos({ left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 228)), top: Math.min(r.bottom + 4, window.innerHeight - 320) });
      const first = ref.current && ref.current.querySelector("input");
      if (first) first.focus();
      const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor.contains(e.target)) onClose(); };
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }, []);
    const list = options.filter((o) => !q || String(o.label).includes(q));
    const toggle = (v) => setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : d.concat([v])));
    return ReactDOM.createPortal(h("div", { ref, className: "kt-fpop", role: "dialog", "aria-label": "筛选" + column.label, style: pos || { visibility: "hidden" },
      onKeyDown: (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); anchor.focus(); } } },
      options.length > 8 && h("label", { className: "kc-ctl sm", style: { padding: 0, cursor: "text" } }, h("input", { value: q, placeholder: "搜索" + column.label, onChange: (e) => setQ(e.target.value) })),
      h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink-faint)", padding: "2px 6px" } },
        h("span", null, draft.length ? "已选 " + draft.length + " 项" : "不限"),
        h("button", { type: "button", className: "link", style: { border: 0, background: "none", cursor: "pointer", font: "inherit", color: "var(--brand)" }, onClick: () => setDraft(draft.length === options.length ? [] : options.map((o) => o.value)) }, draft.length === options.length ? "全不选" : "全选")),
      h("div", { className: "list" }, list.length ? list.map((o) => h("label", { key: String(o.value) },
        h("input", { type: "checkbox", checked: draft.includes(o.value), onChange: () => toggle(o.value) }), h("span", null, o.label),
        o.count != null && h("span", { style: { marginLeft: "auto", color: "var(--ink-faint)", fontSize: 12 } }, o.count)))
        : h("div", { style: { padding: 8, color: "var(--ink-faint)", fontSize: 12.5 } }, options.length ? "无匹配项" : "当前没有可筛选的值")),
      h("div", { className: "bar" },
        h("button", { type: "button", className: "link", onClick: () => { onApply([]); onClose(); anchor.focus(); } }, "清除"),
        h("span", { style: { display: "flex", gap: 6 } },
          h("button", { type: "button", onClick: () => { onClose(); anchor.focus(); } }, "取消"),
          h("button", { type: "button", className: "primary", onClick: () => { onApply(draft); onClose(); anchor.focus(); } }, "应用")))), document.body);
  }

  function KitTable(props) {
    const { Icon, Panel } = DS();
    const KC = window.KitControls || {};
    const columns = props.columns || [];
    const rows0 = props.rows || [];
    const [pageSize, setPageSize] = React.useState(props.pageSize || 20);
    const [page, setPage] = React.useState(0);
    const [checked, setChecked] = React.useState({});
    const [widths, setWidths] = React.useState({});
    const [sort, setSort] = React.useState(null);              // {key, dir:"asc"|"desc"}
    const [innerFilters, setInnerFilters] = React.useState({});
    const [openFilter, setOpenFilter] = React.useState(null);  // {key, anchor}
    const [dragKey, setDragKey] = React.useState(null);
    const [edges, setEdges] = React.useState({ l: false, r: false });
    const [fillH, setFillH] = React.useState(null);
    const scrollRef = React.useRef(null), rootRef = React.useRef(null), tableRef = React.useRef(null);
    const hf = props.headerFilters || innerFilters;
    const setHf = (next) => { if (props.onHeaderFiltersChange) props.onHeaderFiltersChange(next); else setInnerFilters(next); setPage(0); };

    // —— 本地筛选 / 排序（remote 时交给调用方，表格只回传条件）——
    const optionsOf = (c) => {
      if (Array.isArray(c.filter)) return c.filter;
      const counts = {};
      rows0.forEach((r) => { const v = r[c.key]; if (v != null && v !== "") counts[v] = (counts[v] || 0) + 1; });
      return Object.keys(counts).map((v) => ({ value: v, label: v, count: counts[v] }));
    };
    let rows = props.remote ? rows0 : rows0.filter((r) => Object.keys(hf).every((k) => !hf[k] || !hf[k].length || hf[k].includes(String(r[k]))));
    if (sort && !props.remote) {
      const dir = sort.dir === "asc" ? 1 : -1;
      rows = rows.slice().sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        if (x == null || x === "") return 1; if (y == null || y === "") return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "zh-CN")) * dir;
      });
    }

    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const cur = Math.min(page, pages - 1);
    const view = rows.slice(cur * pageSize, cur * pageSize + pageSize);
    const keyOf = (r, absIndex) => (r.id != null ? r.id : "i" + absIndex);
    const rid = (r, i) => keyOf(r, rows0.indexOf(r) > -1 ? rows0.indexOf(r) : cur * pageSize + i);
    const checkedRows = rows0.filter((r, i) => checked[keyOf(r, i)]);
    const checkableRows = view.filter((r) => !(props.checkDisabled && props.checkDisabled(r)));
    const allOn = checkableRows.length > 0 && checkableRows.every((r, i) => checked[rid(r, i)]);
    const emit = (next) => { setChecked(next); if (props.onCheckChange) props.onCheckChange(rows0.filter((r, i) => next[keyOf(r, i)])); };
    const alignOf = (c) => c.align || (c.money ? "right" : "left");
    const wOf = (c) => widths[c.key] || c.width || 120;
    const totalW = (props.checkable ? CHK_W : 0) + SEQ_W + columns.reduce((s, c) => s + wOf(c), 0);

    // —— 固定列偏移：勾选 + 序号 + fixed:left 依次贴左；fixed:right 自右向左贴 ——
    const leftCols = columns.filter((c) => c.fixed === "left");
    const rightCols = columns.filter((c) => c.fixed === "right");
    const base = (props.checkable ? CHK_W : 0) + SEQ_W;
    const offL = {}; let accL = base; leftCols.forEach((c) => { offL[c.key] = accL; accL += wOf(c); });
    const offR = {}; let accR = 0; rightCols.slice().reverse().forEach((c) => { offR[c.key] = accR; accR += wOf(c); });
    const fixStyle = (c) => (c.fixed === "left" ? { left: offL[c.key] } : c.fixed === "right" ? { right: offR[c.key] } : null);
    const fixCls = (c) => (c.fixed === "left" ? "kt-fix-l" + (c === leftCols[leftCols.length - 1] ? " kt-edge-l" : "") : c.fixed === "right" ? "kt-fix-r" + (c === rightCols[0] ? " kt-edge-r" : "") : "");
    const anyLeft = leftCols.length > 0;

    // —— 横向可滚提示：左右边缘阴影 ——
    const syncEdges = () => {
      const el = scrollRef.current;
      if (!el) return;
      const l = el.scrollLeft > 1, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      if (l !== edges.l || r !== edges.r) setEdges({ l, r });
    };
    React.useLayoutEffect(syncEdges);
    React.useEffect(() => { window.addEventListener("resize", syncEdges); return () => window.removeEventListener("resize", syncEdges); });

    // —— height="fill"：撑满视口剩余高度，筛选后高度不跳动 ——
    React.useLayoutEffect(() => {
      if (props.height !== "fill") return undefined;
      const fit = () => { if (rootRef.current) setFillH(Math.max(360, window.innerHeight - rootRef.current.getBoundingClientRect().top - 16)); };
      fit();
      window.addEventListener("resize", fit);
      return () => window.removeEventListener("resize", fit);
    }, [props.height]);
    const height = props.height === "fill" ? fillH : props.height;

    // —— 列宽拖拽 / 双击自适应（resizable + resize-config：48~480px）——
    const startResize = (c, e) => {
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX, w0 = wOf(c);
      setDragKey(c.key);
      const move = (ev) => setWidths((w) => ({ ...w, [c.key]: Math.max(c.minWidth || 48, Math.min(480, w0 + ev.clientX - x0)) }));
      const up = () => { setDragKey(null); window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
    const autoFit = (c) => {
      const cells = tableRef.current ? tableRef.current.querySelectorAll('[data-col="' + c.key + '"]') : [];
      let max = 60;
      cells.forEach((td) => { const inner = td.firstElementChild || td; const range = document.createRange(); range.selectNodeContents(inner); max = Math.max(max, range.getBoundingClientRect().width + 28); });
      setWidths((w) => ({ ...w, [c.key]: Math.min(480, Math.ceil(max)) }));
    };

    const cell = (c, r) => {
      const v = r[c.key];
      if (c.render) return c.render(v, r);
      if (c.status && KC.StatusTag) return v == null || v === "" ? h("span", { style: { color: "var(--ink-faint)" } }, "—") : h(KC.StatusTag, { tone: c.status[v] || "neutral" }, v);
      if (c.money) return yuan2(v);
      return v == null || v === "" ? h("span", { style: { color: "var(--ink-faint)" } }, "—") : v;
    };

    const header = (c) => {
      const dir = sort && sort.key === c.key ? sort.dir : null;
      const fv = hf[c.key] || [];
      return h("th", { key: c.key, "data-col": c.key, className: fixCls(c), "aria-sort": dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined,
        style: { position: "sticky", textAlign: alignOf(c), ...fixStyle(c) } },
        h("div", { className: "kt-th", style: { justifyContent: alignOf(c) === "right" ? "flex-end" : alignOf(c) === "center" ? "center" : "flex-start" } },
          h("span", { className: "kt-th-label", title: c.label }, c.label),
          c.sortable && h("button", { type: "button", className: "kt-hbtn" + (dir ? " on" : ""), "aria-label": c.label + (dir === "asc" ? " 已升序，切换为降序" : dir === "desc" ? " 已降序，取消排序" : " 排序"),
            onClick: () => setSort(dir === "asc" ? { key: c.key, dir: "desc" } : dir === "desc" ? null : { key: c.key, dir: "asc" }) },
            h("span", { className: "kt-sort", "data-dir": dir || "" }, h("i", { className: "up" }), h("i", { className: "dn" }))),
          c.filter && Icon && h("button", { type: "button", className: "kt-hbtn" + (fv.length ? " on" : ""), "aria-label": "筛选" + c.label + (fv.length ? "（已选 " + fv.length + " 项）" : ""), "aria-haspopup": "dialog",
            onClick: (e) => setOpenFilter(openFilter && openFilter.key === c.key ? null : { key: c.key, anchor: e.currentTarget }) },
            h(Icon, { name: "filter", size: 12, color: fv.length ? "var(--brand)" : "currentColor" }))),
        c.resizable !== false && c.fixed !== "right" && h("span", { className: "kt-resize" + (dragKey === c.key ? " on" : ""), role: "separator", "aria-label": "调整" + c.label + "列宽，双击自适应",
          onMouseDown: (e) => startResize(c, e), onDoubleClick: () => autoFit(c) }));
    };

    const chkTd = (style) => ({ width: CHK_W, left: 0, ...style });
    const seqLeft = props.checkable ? CHK_W : 0;
    const bodyRows = props.loading
      ? Array.from({ length: Math.min(pageSize, 6) }).map((_, i) => h("tr", { key: "sk" + i, className: "kt-skel" },
          props.checkable && h("td", null), h("td", null, h("span", { style: { width: 14 } })),
          ...columns.map((c, j) => h("td", { key: c.key }, h("span", { style: { width: [70, 50, 60, 40, 55][j % 5] + "%", marginLeft: alignOf(c) === "right" ? "auto" : 0 } })))))
      : view.map((r, i) => {
          const id = rid(r, i);
          return h("tr", {
            key: id, className: (props.onRowClick ? "kt-click" : "") + (checked[id] ? " kt-checked" : ""),
            onClick: props.onRowClick ? () => props.onRowClick(r) : undefined,
            tabIndex: props.onRowClick ? 0 : undefined,
            onKeyDown: props.onRowClick ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); props.onRowClick(r); } } : undefined,
          },
            props.checkable && h("td", { className: "kt-chk" + (anyLeft ? " kt-fix-l" : ""), style: chkTd(), onClick: (e) => e.stopPropagation() },
              h("input", { type: "checkbox", "aria-label": "选择第 " + (cur * pageSize + i + 1) + " 行", disabled: props.checkDisabled ? props.checkDisabled(r) : false, checked: !!checked[id], onChange: () => emit({ ...checked, [id]: !checked[id] }), style: { cursor: "pointer", accentColor: "var(--brand)" } })),
            h("td", { className: "kt-seq" + (anyLeft ? " kt-fix-l" : ""), style: { color: "var(--ink-faint)", left: seqLeft } }, cur * pageSize + i + 1),
            ...columns.map((c) => h("td", { key: c.key, "data-col": c.key, className: fixCls(c), style: { textAlign: alignOf(c), ...fixStyle(c) } }, h("span", null, cell(c, r)))));
        });

    const sums = props.sum ? (Array.isArray(props.sum) ? props.sum : [props.sum]) : [];
    const showFoot = rows0.length > 0 && !props.loading;
    const openCol = openFilter && columns.find((c) => c.key === openFilter.key);

    return h("div", { ref: rootRef, style: { minWidth: 0 } }, h(Panel, { padding: 0, style: { overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0, maxWidth: "100%", height: height || undefined } },
      props.toolbar || null,
      h("div", { ref: scrollRef, className: "kt-scroll", tabIndex: 0, role: "region", "aria-label": props.label || "数据表格，可横向滚动", "data-sl": edges.l, "data-sr": edges.r, onScroll: syncEdges,
        style: { flex: height ? "1 1 auto" : undefined, maxHeight: height ? undefined : props.maxHeight, display: "flex", flexDirection: "column" } },
        h("table", { ref: tableRef, className: "kt-table", style: { width: Math.max(totalW, props.tableMinWidth || 0), minWidth: "100%" } },
          h("colgroup", null,
            props.checkable && h("col", { style: { width: CHK_W } }), h("col", { style: { width: SEQ_W } }),
            ...columns.map((c) => h("col", { key: c.key, style: { width: wOf(c) } }))),
          h("thead", null, h("tr", null,
            props.checkable && h("th", { className: "kt-chk" + (anyLeft ? " kt-fix-l" : ""), style: chkTd({ position: "sticky" }) },
              h("input", { type: "checkbox", "aria-label": "全选本页", checked: allOn, onChange: () => { const next = { ...checked }; checkableRows.forEach((r, i) => { next[rid(r, i)] = !allOn; }); emit(next); }, style: { cursor: "pointer", accentColor: "var(--brand)" } })),
            h("th", { className: "kt-seq" + (anyLeft ? " kt-fix-l" : ""), style: { left: seqLeft, position: "sticky" } }, "#"),
            ...columns.map(header))),
          h("tbody", null, ...bodyRows)),
        !props.loading && rows.length === 0 && h(EmptyState, { empty: rows0.length && !props.remote ? { title: "没有符合表头筛选条件的记录", description: "调整或清除表头筛选后再试", icon: "search-x", action: h("button", { type: "button", className: "ls-btn", style: { borderRadius: 6 }, onClick: () => setHf({}) }, "清除表头筛选") } : props.empty, Icon })),
      showFoot && h("div", { className: "kt-foot" },
        h("div", { className: "kt-sum" },
          typeof props.footerLeft === "function" ? props.footerLeft(checkedRows) : (props.footerLeft || null),
          ...sums.map((s, i) => h("span", { key: i, style: { whiteSpace: "nowrap" } }, s.label + "：", h("b", null, typeof s.value === "number" ? yuan2(s.value) : s.value)))),
        h("div", { className: "kt-pg" },
          h("span", { style: { marginRight: 6 } }, "共 " + rows.length + " 条"),
          h("button", { type: "button", "aria-label": "上一页", disabled: cur === 0, onClick: () => setPage(cur - 1) }, "‹"),
          ...Array.from({ length: Math.min(pages, 7) }).map((_, i) => h("button", { key: i, type: "button", className: i === cur ? "on" : "", "aria-current": i === cur ? "page" : undefined, onClick: () => setPage(i) }, i + 1)),
          h("button", { type: "button", "aria-label": "下一页", disabled: cur >= pages - 1, onClick: () => setPage(cur + 1) }, "›"),
          KC.Select && h("span", { style: { marginLeft: 6, width: 96 } }, h(KC.Select, { size: "sm", value: pageSize, options: [10, 20, 50].map((n) => ({ value: n, label: n + " 条/页" })), onChange: (n) => { setPageSize(Number(n)); setPage(0); }, ariaLabel: "每页条数" })))),
      openCol && h(FilterPop, { anchor: openFilter.anchor, column: openCol, options: optionsOf(openCol), value: hf[openCol.key] || [],
        onApply: (vals) => setHf({ ...hf, [openCol.key]: vals.map(String) }), onClose: () => setOpenFilter(null) })));
  }

  window.KitTable = KitTable;
  window.KitTableScreen = function () { return null; };
})();
