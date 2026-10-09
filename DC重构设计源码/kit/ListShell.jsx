// ListShell — 列表页工具条与骨架（2026-10-07 评审 V-04 / V-06 / C-05），注册 window.ListShell，经隐藏 x-import 预加载。
// 按红圈标准列表模板：视图切换「全部XX ▾」(带计数) + 工具条（搜索 / 刷新 / 漏斗筛选 / ⚙列设置 / 更多 / 导入｜新建）
//   + 可收起的筛选行（下拉筛选 + 已生效筛选标签 + 清除全部）+ 可收起左树；表格本体由 KitTable 承担。
// EntityListScreen（meta 驱动）与 StdListScreen（rows 驱动）共用本工具条，不再各写一套。
// props:
//   title, count                     视图按钮文案（无 views 时显示 title）
//   views [{key,label,count}], view, onView
//   chips [{key,label,onRemove}]     额外已生效条件（如穿透预筛）
//   search, onSearch, searchPlaceholder
//   filters [{key,label,options:[{value,label}],value,onChange}]  value 为 "" 表示不过滤
//   onRefresh, onColumns, onCreate, createLabel, onImport, more:[{key,label,icon,onSelect}]
//   tree {title, items:[{key,label,count}], active, onChange}  左侧分类（可收起）
//   children                         表格（通常为 <KitTable toolbar={…}/> 之外的其余内容）
(function () {
  if (window.ListShell) { window.ListShellPreload = window.ListShellPreload || function () { return null; }; return; }
  const h = React.createElement;
  const DS = () => window.DesignSystem_e3d871 || {};
  const KC = () => window.KitControls || {};

  if (!document.getElementById("list-shell-css")) {
    const st = document.createElement("style");
    st.id = "list-shell-css";
    st.textContent = [
      ".ls-bar { display:flex; align-items:center; gap:8px; padding:10px 12px; flex-wrap:wrap; }",
      ".ls-view { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 8px; margin-left:-4px; border:0; border-radius:6px; background:transparent; font:inherit; font-size:14px; font-weight:700; color:var(--ink); cursor:pointer; }",
      ".ls-view:hover, .ls-view[aria-expanded=true] { background:var(--surface-2); }",
      ".ls-view small { font-size:12px; font-weight:500; color:var(--ink-faint); font-variant-numeric:tabular-nums; }",
      ".ls-ib { width:32px; height:32px; display:grid; place-items:center; border:1px solid var(--line-strong); border-radius:6px; background:var(--panel); color:var(--ink-soft); cursor:pointer; transition:border-color .12s, color .12s, background .12s; }",
      ".ls-ib:hover { border-color:var(--brand); color:var(--brand); }",
      ".ls-ib[aria-pressed=true] { border-color:var(--brand); color:var(--brand); background:var(--brand-soft); }",
      ".ls-btn { height:32px; padding:0 12px; display:inline-flex; align-items:center; gap:6px; border:1px solid var(--line-strong); background:var(--panel); color:var(--ink); font:inherit; font-size:13px; font-weight:600; cursor:pointer; transition:background .12s, border-color .12s, color .12s; }",
      ".ls-btn:hover { border-color:var(--brand); color:var(--brand); }",
      ".ls-btn.primary { background:var(--brand); border-color:var(--brand); color:#fff; }",
      ".ls-btn.primary:hover { background:var(--brand-deep); color:#fff; }",
      ".ls-split { display:inline-flex; }",
      ".ls-split .ls-btn { border-radius:0; } .ls-split .ls-btn:first-child { border-radius:6px 0 0 6px; } .ls-split .ls-btn:last-child { border-radius:0 6px 6px 0; } .ls-split .ls-btn:only-child { border-radius:6px; }",
      ".ls-split .ls-btn + .ls-btn { margin-left:-1px; }",
      ".ls-filters { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:0 12px 10px; }",
      ".ls-filter { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-soft); }",
      ".ls-chip { display:inline-flex; align-items:center; gap:2px; height:24px; padding:0 2px 0 8px; border-radius:6px; background:var(--brand-soft); color:var(--brand-deep); font-size:12px; animation:ls-in .14s ease-out; }",
      ".ls-chip button { display:grid; place-items:center; width:20px; height:20px; border:0; border-radius:4px; background:transparent; color:inherit; cursor:pointer; }",
      ".ls-chip button:hover { background:rgb(0 0 0 / 8%); }",
      ".ls-clear { border:0; background:none; font:inherit; font-size:12px; color:var(--ink-soft); cursor:pointer; }",
      ".ls-clear:hover { color:var(--brand); }",
      "@keyframes ls-in { from { opacity:0; transform:scale(.96); } to { opacity:1; transform:none; } }",
      ".ls-menu { position:fixed; z-index:10050; min-width:180px; padding:4px; background:var(--panel); border:1px solid var(--line); border-radius:8px; box-shadow:var(--shadow-pop); animation:kc-in .14s ease-out; }",
      ".ls-menu button { display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; padding:7px 8px; border:0; border-radius:5px; background:transparent; font:inherit; font-size:13px; color:var(--ink); cursor:pointer; text-align:left; }",
      ".ls-menu button:hover, .ls-menu button:focus-visible { background:var(--surface-2); outline:0; }",
      ".ls-menu button[aria-checked=true] { color:var(--brand); font-weight:700; }",
      ".ls-menu small { color:var(--ink-faint); font-variant-numeric:tabular-nums; }",
      ".ls-layout { display:grid; grid-template-columns:200px minmax(0,1fr); gap:12px; align-items:start; }",
      ".ls-layout.collapsed { grid-template-columns:minmax(0,1fr); }",
      ".ls-tree { position:sticky; top:8px; padding:8px; background:var(--panel); border:1px solid var(--line); border-radius:8px; max-height:calc(100vh - 140px); overflow:auto; }",
      ".ls-tree-h { display:flex; align-items:center; justify-content:space-between; padding:2px 4px 8px 6px; font-weight:700; }",
      ".ls-node { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; padding:6px 8px; border:0; border-radius:6px; background:transparent; font:inherit; font-size:13px; color:var(--ink-soft); cursor:pointer; text-align:left; }",
      ".ls-node:hover { background:var(--surface-2); }",
      ".ls-node[aria-current=true] { background:var(--brand-soft); color:var(--brand-deep); font-weight:700; }",
      ".ls-node small { color:var(--ink-faint); font-variant-numeric:tabular-nums; }",
      "@media (max-width: 1023px) { .ls-layout { grid-template-columns:minmax(0,1fr); } .ls-tree { position:static; max-height:none; } }",
      "@media (prefers-reduced-motion: reduce) { .ls-chip, .ls-menu { animation:none; } }",
    ].join("\n");
    document.head.appendChild(st);
  }

  const Ico = (name, size = 15) => { const { Icon } = DS(); return Icon ? h(Icon, { name, size }) : null; };

  // 视图 / 更多 共用的下拉菜单（挂 body，fixed，Esc / 外部点击关闭，方向键移动）
  function Menu({ anchor, items, onClose, role = "menu" }) {
    const ref = React.useRef(null);
    const [pos, setPos] = React.useState(null);
    React.useLayoutEffect(() => {
      const r = anchor.getBoundingClientRect();
      const w = ref.current ? ref.current.offsetWidth : 180;
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + 4 });
      const first = ref.current && ref.current.querySelector("button");
      if (first) first.focus();
      const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor.contains(e.target)) onClose(); };
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }, []);
    const onKey = (e) => {
      const btns = Array.from(ref.current.querySelectorAll("button"));
      const i = btns.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); (btns[i + 1] || btns[0]).focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1]).focus(); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); anchor.focus(); }
    };
    return ReactDOM.createPortal(h("div", { ref, className: "ls-menu", role, onKeyDown: onKey, style: pos || { visibility: "hidden" } },
      ...items.map((it) => h("button", { key: it.key, type: "button", role: role === "menu" ? "menuitem" : "menuitemradio", "aria-checked": it.checked ? "true" : undefined,
        onClick: () => { onClose(); it.onSelect(); } },
        h("span", { style: { display: "inline-flex", alignItems: "center", gap: 8 } }, it.icon ? Ico(it.icon, 14) : null, it.label),
        it.count != null ? h("small", null, it.count) : (it.checked ? Ico("check", 14) : null)))), document.body);
  }

  function ListToolbar(p) {
    const K = KC();
    const [menu, setMenu] = React.useState(null);       // "view" | "more"
    const [showFilters, setShowFilters] = React.useState(true);
    const viewRef = React.useRef(null), moreRef = React.useRef(null);
    const views = p.views || [];
    const curView = views.find((v) => v.key === p.view);
    const filters = p.filters || [];
    const active = filters.filter((f) => f.value !== "" && f.value != null && f.value !== "all");
    const chips = (p.chips || []).concat(
      active.map((f) => ({ key: "f-" + f.key, label: f.label + "：" + (((f.options || []).find((o) => String(o.value) === String(f.value)) || {}).label || f.value), onRemove: () => f.onChange("") })),
      p.search ? [{ key: "q", label: "搜索：" + p.search, onRemove: () => p.onSearch("") }] : []);
    const clearAll = () => { chips.forEach((c) => c.onRemove()); };

    return h("div", { style: { borderBottom: "1px solid var(--line)" } },
      h("div", { className: "ls-bar" },
        p.tree && p.treeCollapsed && h("button", { type: "button", className: "ls-ib", title: "展开" + (p.tree.title || "分类"), "aria-label": "展开分类", onClick: p.onTreeToggle }, Ico("panel-left-open")),
        views.length
          ? h("button", { ref: viewRef, type: "button", className: "ls-view", "aria-haspopup": "menu", "aria-expanded": menu === "view", onClick: () => setMenu(menu === "view" ? null : "view") },
              (curView ? curView.label : p.title), h("small", null, (p.count != null ? p.count : "") + " 条"), Ico("chevron-down", 14))
          : h("span", { className: "ls-view", style: { cursor: "default" } }, p.title, p.count != null && h("small", null, p.count + " 条")),
        h("span", { style: { flex: 1 } }),
        p.onSearch && h("span", { style: { width: 240 } }, K.Input ? h(K.Input, { value: p.search || "", onChange: p.onSearch, placeholder: p.searchPlaceholder || "搜索关键字", prefixIcon: "search", ariaLabel: "搜索" }) : null),
        p.onRefresh && h("button", { type: "button", className: "ls-ib", title: "刷新", "aria-label": "刷新", onClick: p.onRefresh }, Ico("rotate-cw")),
        filters.length > 0 && h("button", { type: "button", className: "ls-ib", title: showFilters ? "收起筛选" : "展开筛选", "aria-label": "筛选", "aria-pressed": showFilters || active.length > 0, onClick: () => setShowFilters(!showFilters) }, Ico("filter")),
        p.onColumns && h("button", { type: "button", className: "ls-ib", title: "列设置", "aria-label": "列设置", onClick: p.onColumns }, Ico("settings-2")),
        p.more && p.more.length > 0 && h("button", { ref: moreRef, type: "button", className: "ls-ib", title: "更多", "aria-label": "更多操作", "aria-haspopup": "menu", "aria-expanded": menu === "more", onClick: () => setMenu(menu === "more" ? null : "more") }, Ico("ellipsis")),
        (p.onImport || p.onCreate) && h("span", { className: "ls-split" },
          p.onImport && h("button", { type: "button", className: "ls-btn" + (p.onCreate ? "" : " primary"), onClick: p.onImport }, Ico("upload", 14), "导入"),
          p.onCreate && h("button", { type: "button", className: "ls-btn primary", onClick: p.onCreate }, Ico("plus", 14), p.createLabel || "新建"))),
      ((showFilters && filters.length > 0) || chips.length > 0) && h("div", { className: "ls-filters" },
        showFilters && filters.map((f) => h("label", { key: f.key, className: "ls-filter" }, f.label,
          h("span", { style: { width: f.width || 140 } }, K.Select ? h(K.Select, { value: f.value === "all" ? "" : f.value, onChange: f.onChange, options: [{ value: "", label: "全部" }].concat(f.options || []), ariaLabel: f.label }) : null))),
        showFilters && filters.length > 0 && chips.length > 0 && h("span", { style: { width: 1, height: 18, background: "var(--line)" } }),
        ...chips.map((c) => h("span", { key: c.key, className: "ls-chip" }, c.label, h("button", { type: "button", "aria-label": "移除 " + c.label, onClick: c.onRemove }, Ico("x", 12)))),
        chips.length > 1 && h("button", { type: "button", className: "ls-clear", onClick: clearAll }, "清除全部")),
      menu === "view" && viewRef.current && h(Menu, { anchor: viewRef.current, role: "menu", onClose: () => setMenu(null),
        items: views.map((v) => ({ key: v.key, label: v.label, count: v.count, checked: v.key === p.view, onSelect: () => p.onView(v.key) })) }),
      menu === "more" && moreRef.current && h(Menu, { anchor: moreRef.current, onClose: () => setMenu(null), items: p.more }));
  }

  function ListTree({ tree, onCollapse }) {
    return h("nav", { className: "ls-tree", "aria-label": tree.title || "分类" },
      h("div", { className: "ls-tree-h" }, tree.title || "分类",
        h("button", { type: "button", className: "ls-ib", style: { width: 24, height: 24 }, title: "收起", "aria-label": "收起分类", onClick: onCollapse }, Ico("panel-left-close", 14))),
      ...tree.items.map((it) => h("button", { key: it.key, type: "button", className: "ls-node", "aria-current": it.key === tree.active ? "true" : undefined, onClick: () => tree.onChange(it.key) },
        h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.label), it.count != null && h("small", null, it.count))));
  }

  // 整页列表：左树（可收起）+ 表格（工具条经 renderTable(toolbar) 交给 KitTable.toolbar，保证同一张卡片）
  function ListShell(p) {
    const [collapsed, setCollapsed] = React.useState(false);
    const toolbar = h(ListToolbar, { ...p, treeCollapsed: collapsed, onTreeToggle: () => setCollapsed(false) });
    const table = p.renderTable(toolbar);
    if (!p.tree) return table;
    return h("div", { className: "ls-layout" + (collapsed ? " collapsed" : "") },
      !collapsed && h(ListTree, { tree: p.tree, onCollapse: () => setCollapsed(true) }),
      h("div", { style: { minWidth: 0 } }, table));
  }

  window.ListShell = ListShell;
  window.ListToolbar = ListToolbar;
  window.ListShellPreload = function () { return null; };
})();
