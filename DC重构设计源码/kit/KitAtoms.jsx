// KitAtoms — 全局展示原子库（反馈轮 9：通用组件先生成、后统一使用）
// 与 KitUI（交互原语）/ KitTable（表格原语）并列的第三块全局底座，经隐藏 x-import 预加载注册 window.KitAtoms。
// 收录此前散落在各页面的内联副本（STYLE-GUIDE §3 的标准形态）：
//   SelectFilter  下拉筛选（§3.6）      SegTab        下划线分段 tab（§3.5）
//   SearchInput   pill 搜索框            SectionHeader 品牌竖条区块标题（§3.2）
//   Metric/MetricGrid 指标格+语义固定列数网格（两位小数由调用方保证）
//   TreeNav       左树导航（发票台账/清单页同构）
//   EntityLink    实体蓝链（批A：type→route 映射唯一处，全站实体名跳转一律走它）
//   MoneyLink     金额穿透链（批B 铁律④：聚合金额可点 → 单据列表带预筛参数）
// 约定：新页面一律从 window.KitAtoms 取用；旧页面逐步替换内联副本，勿再复制。
(function () {
  if (window.KitAtoms) { window.KitAtomsScreen = window.KitAtomsScreen || function () { return null; }; return; }
  const DS = () => window.DesignSystem_e3d871 || {};
  const h = React.createElement;
  const ROW_MENU_LAYER = 10001; // DC KitUI 模态层（10000）之上的所属行操作面板。

  // —— 下拉筛选：label + 原生 select + 自绘 chevron（options: [{key,label}]）——
  function SelectFilter({ label, options, value, onChange, minWidth = 132 }) {
    const { Icon } = DS();
    return h("label", { style: { display: "inline-flex", alignItems: "center", gap: 7 } },
      label && h("span", { style: { fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", flex: "none" } }, label),
      h("span", { style: { position: "relative", display: "inline-flex" } },
        h("select", { value, onChange: (e) => onChange(e.target.value), style: {
          appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
          border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", background: "#fff",
          color: "var(--ink)", fontSize: 13, fontWeight: 600, padding: "7px 30px 7px 12px", cursor: "pointer", minWidth,
        } }, options.map((o) => h("option", { key: o.key, value: o.key }, o.label))),
        Icon && h("span", { style: { position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", display: "flex" } },
          h(Icon, { name: "chevron-down", size: 14, color: "var(--ink-faint)" }))
      )
    );
  }

  // —— 下划线分段 tab（tabs: [{key,label,count?}]）——
  function SegTab({ tabs, active, onChange }) {
    return h("div", { style: { display: "flex", flexWrap: "wrap", gap: 2, borderBottom: "1px solid var(--line)" } },
      ...tabs.map((t) => {
        const on = active === t.key;
        return h("button", { key: t.key, onClick: () => onChange(t.key), style: {
          border: 0, background: "transparent", cursor: "pointer", padding: "9px 14px", marginBottom: -1,
          fontSize: 13, fontWeight: on ? 700 : 500, color: on ? "var(--brand-deep)" : "var(--ink-soft)",
          borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent", whiteSpace: "nowrap",
          display: "inline-flex", alignItems: "center", gap: 6,
        } },
          t.label,
          t.count != null && h("span", { style: { fontSize: 11, fontFamily: "var(--font-mono)", padding: "1px 6px", borderRadius: 999, background: on ? "var(--brand-soft)" : "var(--surface-3)", color: on ? "var(--brand-deep)" : "var(--ink-soft)" } }, t.count));
      })
    );
  }

  // —— pill 搜索框 ——
  function SearchInput({ value, onChange, placeholder, width = 210 }) {
    const { Icon } = DS();
    return h("div", { style: { position: "relative" } },
      Icon && h("span", { style: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", display: "flex" } }, h(Icon, { name: "search", size: 14, color: "var(--ink-faint)" })),
      h("input", { placeholder, value: value == null ? "" : value, onChange: (e) => onChange(e.target.value),
        style: { width, border: "1px solid var(--line-strong)", borderRadius: 999, padding: "8px 14px 8px 32px", fontSize: 13, background: "#fff", outline: "none" } })
    );
  }

  // —— 区块标题：4×16 品牌竖条 + 标题 + 右侧扩展 ——
  function SectionHeader({ children, extra, mb = 12 }) {
    return h("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: mb } },
      h("span", { style: { width: 4, height: 16, borderRadius: 2, background: "var(--brand)", flex: "none" } }),
      h("h2", { style: { margin: 0, fontSize: 15, fontWeight: 800 } }, children),
      extra && h("span", { style: { marginLeft: "auto" } }, extra)
    );
  }

  // —— 指标格（label+ⓘ公式+大数字；两位小数完整展示，禁省略号）——
  function Metric({ label, value, formula, tone, big, status, cutoff, missingSources }) {
    // 外部是无 Hook 的纯工厂；两卡共用 StatCard 的可变内核。
    const { StatCard } = DS();
    return StatCard ? h(StatCard, { label, value, formula, tone, big, status, cutoff, missingSources, variant: "grid" }) : h("div", null, label, "：", value);
  }

  // —— 指标网格：cols 为宽屏上限，窄容器自动降列（ADR 0013）——
  function MetricGrid({ children, cols = 5 }) {
    const count = Math.max(1, Math.trunc(cols));
    return h("div", { style: { display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(160px, calc((100% - ${count - 1}px) / ${count}))), 1fr))`, gap: 1, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", overflow: "hidden" } },
      React.Children.map(children, (c) => h("div", { style: { background: "var(--panel)", minWidth: 0, boxShadow: "0 0 0 1px var(--line)" } }, c)));
  }

  // —— 实体蓝链（批A 底座件①）：全站实体名一律蓝色可点，type→route 映射只写这一处 ——
  // 用法：<EntityLink type="contract" id="fb01" /> 或 <EntityLink type="supplier" id="s6" label="陈家班" />
  // label 缺省时按 type 从共享 store / KIT_DATA best-effort 解析；无 id 或查无实体 → 退化为纯文本（不做死链）。
  const ENTITY_ROUTES = {
    project:  { route: "projectDetail",  params: (id) => ({ id }),     name: (id) => ((window.APP && window.APP.get("projects", id)) || {}).name },
    supplier: { route: "supplierDetail", params: (id) => ({ id }),     name: (id) => { const s = window.APP && window.APP.get("suppliers", id); return s ? ((s.aliases && s.aliases[0]) || s.name) : null; } },
    contract: { route: "contractDetail", params: (id) => ({ id }),     name: (id) => ((window.APP && window.APP.get("contracts", id)) || {}).name },
    crew:     { route: "crewDetail",     params: (id) => ({ crewId: id }), name: (id) => (((window.KIT_DATA || {}).crews || []).find((c) => c.id === id) || {}).name },
    worker:   { route: "workerDetail",   params: (id) => ({ id }),     name: (id) => (((window.KIT_DATA || {}).workers || []).find((w) => w.id === id) || {}).name },
    invoice:  { route: "invoiceEdit",    params: (id) => ({ id }),     name: (id) => { const iv = window.INV && window.INV.get(id); return iv && iv.number ? "票 " + iv.number.slice(-8) : null; } },
    customer: { route: "customerDetail", params: (id) => ({ id }),     name: (id) => ((window.APP && window.APP.get("customers", id)) || {}).name },
  };
  function EntityLink({ type, id, label, bold = true, title }) {
    const conf = ENTITY_ROUTES[type];
    const text = label != null ? label : (conf && id != null ? conf.name(id) : null);
    if (text == null || text === "") return h("span", { style: { color: "var(--ink-faint)" } }, "—");
    if (!conf || id == null) return h("span", null, text);
    return h("button", {
      type: "button", title: title || ("打开 " + text),
      onClick: (e) => { e.stopPropagation(); if (window.DC) window.DC.navigate(conf.route, conf.params(id)); },
      onMouseEnter: (e) => { e.currentTarget.style.textDecoration = "underline"; },
      onMouseLeave: (e) => { e.currentTarget.style.textDecoration = "none"; },
      style: { border: 0, background: "transparent", padding: 0, cursor: "pointer", textAlign: "left",
        color: "var(--brand)", fontWeight: bold ? 600 : 500, fontSize: "inherit", fontFamily: "inherit" },
    }, text);
  }

  // —— 金额穿透链（批B 铁律④）：列表里的聚合金额可点 → 跳对应单据列表并带预筛参数 ——
  // 值为 0/空 或未给 onClick 时退化为普通等宽金额文本（不做死链）。
  function MoneyLink({ value, onClick, title }) {
    const txt = value == null || value === "" ? "—" : "¥" + Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!onClick || !Number(value)) return h("span", { style: { fontFamily: "var(--font-mono)", fontWeight: 600 } }, txt);
    return h("button", {
      type: "button", title: title || "查看对应单据",
      onClick: (e) => { e.stopPropagation(); onClick(); },
      onMouseEnter: (e) => { e.currentTarget.style.textDecoration = "underline"; },
      onMouseLeave: (e) => { e.currentTarget.style.textDecoration = "none"; },
      style: { border: 0, background: "transparent", padding: 0, cursor: "pointer",
        fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "inherit", color: "var(--brand)" },
    }, txt);
  }

  // —— 左树导航（items: [{key,label,icon,count,tone,children?:[{...}]}]；active/onChange）——
  // 可选 onNodeDrop(nodeKey, payload)：把树节点变成拖放目标（如把归档文件拖到节点上改归属）。
  // 不传就是纯导航树，行为与原来完全一致。footer 挂节点级动作（如「新建分供方节点」）。
  // ⚠ KitAtoms 各件是被「直接当函数调用」的（KA().TreeNav({...})），hooks 会记到调用方头上，
  //   而调用点普遍写成 `KA().TreeNav && KA().TreeNav(...)` 的条件调用 —— 所以这里一律不许用 hook。
  //   拖放高亮走原生事件直接改 style，不进 React state。
  function TreeNav({ title, items, active, onChange, onNodeDrop, footer }) {
    const { Icon, Panel } = DS();
    const btn = (t, sub) => {
      const on = active === t.key;
      const ink = t.tone === "warn" && !on ? "var(--warn-ink)" : on ? "var(--brand-deep)" : "var(--ink)";
      const rest = (el) => { el.style.background = on ? "var(--brand-soft)" : "transparent"; el.style.borderColor = "transparent"; };
      const drop = onNodeDrop ? {
        onDragOver: (e) => { e.preventDefault(); e.currentTarget.style.background = "var(--brand-soft)"; e.currentTarget.style.borderColor = "var(--brand)"; },
        onDragLeave: (e) => rest(e.currentTarget),
        onDrop: (e) => { e.preventDefault(); rest(e.currentTarget); const payload = e.dataTransfer.getData("text/plain"); if (payload) onNodeDrop(t.key, payload); },
      } : null;
      // 边框常驻占位（透明），拖拽高亮只换颜色，不让节点在悬停时跳动
      return h("button", { key: t.key, onClick: () => onChange(t.key), ...drop, style: { display: "flex", alignItems: "center", gap: 8, width: "100%", border: "1px dashed transparent", borderRadius: 8, padding: sub ? "6px 10px" : "8px 10px", cursor: "pointer", textAlign: "left", background: on ? "var(--brand-soft)" : "transparent", marginBottom: 2 } },
        Icon && h(Icon, { name: t.icon || (sub ? "wrench" : "folder"), size: sub ? 12 : 14, color: on ? "var(--brand)" : (t.tone === "warn" ? "var(--warn)" : t.tone === "brand" ? "var(--brand)" : "var(--ink-faint)") }),
        h("span", { style: { flex: 1, fontSize: sub ? 12.5 : 13, fontWeight: on ? 800 : sub ? 500 : 600, color: ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.label),
        t.count != null && h("span", { style: { fontSize: 11, fontFamily: "var(--font-mono)", color: on ? "var(--brand)" : "var(--ink-faint)", background: on ? "#fff" : "var(--surface-3)", borderRadius: 999, padding: "1px 7px" } }, t.count));
    };
    return h(Panel || "div", { padding: 0, style: { overflow: "hidden" } },
      title && h("div", { style: { padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" } }, title),
      h("div", { style: { padding: 6 } },
        ...items.map((t) => h("div", { key: t.key },
          btn(t, false),
          t.children && h("div", { style: { paddingLeft: 14 } }, ...t.children.map((c) => btn(c, true)))))),
      footer && h("div", { style: { padding: "8px 10px", borderTop: "1px solid var(--line)" } }, footer));
  }

  // —— 页面状态面板（state: loading|empty|error|forbidden；compact 只缩高度不改语义）——
  // 契约见 docs/design/kit-ui-component-specs.md §09；页面级禁用巨型 spinner，
  // error 走 role=alert，「筛选无结果」与「从未建档」必须给不同文案。
  function StatePanel({ state, title, description, actionLabel, onAction, compact }) {
    const { Button, Icon } = DS();
    const SPEC = {
      loading: { icon: "loader", tone: "var(--ink-faint)", role: "status", live: "polite" },
      empty: { icon: "inbox", tone: "var(--ink-faint)", role: "status", live: "polite" },
      error: { icon: "triangle-alert", tone: "var(--danger)", role: "alert", live: "assertive" },
      forbidden: { icon: "lock", tone: "var(--warn)", role: "status", live: "polite" },
    };
    const spec = SPEC[state] || SPEC.empty;
    return h("div", {
      role: spec.role, "aria-live": spec.live, "aria-busy": state === "loading" ? "true" : undefined,
      style: { display: "grid", placeItems: "center", gap: 8, textAlign: "center",
        padding: compact ? "16px 12px" : "40px 24px", border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)", background: "var(--panel)" } },
      Icon && h(Icon, { name: spec.icon, size: compact ? 18 : 24, color: spec.tone }),
      h("div", { style: { fontSize: 13, fontWeight: 700, color: "var(--ink)" } }, title),
      description && h("div", { style: { fontSize: 12, color: "var(--ink-soft)", maxWidth: 420 } }, description),
      actionLabel && onAction && Button && h(Button, { variant: "secondary", size: "sm", onClick: onAction }, actionLabel));
  }

  // —— 行操作下拉菜单（items: [{key,label,danger,disabled,onSelect}]）——
  // 表格操作列统一「纯图标触发 + 下拉」，不把多个文字按钮平铺进窄列。
  // 工厂可被条件或函数式调用；Hook 始终由 React 调用内部组件，不能挂到调用者。
  function RowActionMenu(props) {
    return h(RowActionMenuView, props);
  }
  function RowActionMenuView({ items, label = "更多操作" }) {
    const { Icon } = DS();
    const [open, setOpen] = React.useState(false);
    const [position, setPosition] = React.useState(null);
    const [triggerFocused, setTriggerFocused] = React.useState(false);
    const [triggerHovered, setTriggerHovered] = React.useState(false);
    const [focusedKey, setFocusedKey] = React.useState(null);
    const [hoveredKey, setHoveredKey] = React.useState(null);
    const trigger = React.useRef(null);
    const menu = React.useRef(null);
    const firstFocus = React.useRef("first");
    const id = React.useId();
    const close = (focus = true) => {
      setOpen(false);
      if (focus && trigger.current && trigger.current.isConnected) trigger.current.focus();
    };
    const enabled = () => menu.current ? Array.from(menu.current.querySelectorAll("[role=menuitem]:not(:disabled)")) : [];
    const focusItem = (edge) => {
      const nodes = enabled();
      (nodes.length ? nodes[edge === "last" ? nodes.length - 1 : 0] : menu.current)?.focus();
    };
    const show = (edge = "first") => {
      firstFocus.current = edge;
      setPosition(null);
      setOpen(true);
    };
    React.useLayoutEffect(() => {
      if (!open) return;
      const update = () => {
        const anchor = trigger.current;
        const panel = menu.current;
        if (!anchor || !panel || !anchor.isConnected) return close(false);
        const rect = anchor.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return close(false);
        const width = Math.min(panel.offsetWidth || 148, Math.max(0, window.innerWidth - 24));
        const height = (panel.querySelector("[data-menu-scroll]") || panel).scrollHeight + 2;
        const below = window.innerHeight - rect.bottom - 18;
        const above = rect.top - 18;
        const side = height > below && above > below ? "top" : "bottom";
        const available = Math.max(1, side === "top" ? above : below);
        const visibleHeight = Math.min(height, available);
        const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
        const top = side === "top" ? Math.max(12, rect.top - visibleHeight - 6) : rect.bottom + 6;
        setPosition({ left, top, maxHeight: available, width, side, arrowLeft: Math.max(8, Math.min(rect.left + rect.width / 2 - left - 5, width - 18)) });
      };
      update();
      const outside = (event) => {
        if (!menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(false);
      };
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("scroll", update, true);
      window.addEventListener("resize", update);
      return () => {
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("scroll", update, true);
        window.removeEventListener("resize", update);
      };
    }, [open]);
    React.useLayoutEffect(() => {
      if (open && position) focusItem(firstFocus.current);
    }, [open, !!position]);
    const keyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); close(); return;
      }
      if (event.key === "Tab") { close(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nodes = enabled();
      if (!nodes.length) return;
      const current = nodes.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? nodes.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + nodes.length) % nodes.length;
      nodes[next].focus();
    };
    const panel = open && h("div", {
      ref: menu, id, role: "menu", "aria-label": label, tabIndex: -1,
      "data-side": position?.side || "bottom", className: "dc-row-menu", onKeyDown: keyDown,
      onClick: event => event.stopPropagation(),
      style: { position: "fixed", left: position?.left || 12, top: position?.top || 12,
        visibility: position ? "visible" : "hidden", zIndex: ROW_MENU_LAYER, width: position?.width || 148,
        maxWidth: "calc(100vw - 24px)", borderRadius: "var(--radius-card)",
        background: "var(--panel)", border: "1px solid var(--line)", boxShadow: "var(--shadow-pop)", outline: "none" }
    },
      h("span", { "aria-hidden": true, style: { position: "absolute", width: 8, height: 8,
        left: position?.arrowLeft || 10, top: position?.side === "top" ? undefined : -5,
        bottom: position?.side === "top" ? -5 : undefined,
        background: "var(--panel)", borderTop: position?.side === "top" ? undefined : "1px solid var(--line)",
        borderLeft: position?.side === "top" ? undefined : "1px solid var(--line)",
        borderRight: position?.side === "top" ? "1px solid var(--line)" : undefined,
        borderBottom: position?.side === "top" ? "1px solid var(--line)" : undefined, transform: "rotate(45deg)" } }),
      h("div", { "data-menu-scroll": true, style: { padding: 4, maxHeight: position?.maxHeight || "calc(100dvh - 24px)", overflowY: "auto", overscrollBehavior: "contain" } },
        !items.length && h("p", { style: { margin: 0, padding: "7px 10px", color: "var(--ink-faint)", fontSize: 12 } }, "无可用操作"),
        items.map(it => h("button", {
          key: it.key, role: "menuitem", type: "button", tabIndex: -1, disabled: !!it.disabled,
          onClick: () => { close(); it.onSelect && it.onSelect(); },
          onFocus: () => setFocusedKey(it.key), onBlur: () => setFocusedKey(null),
          onMouseEnter: () => { if (!it.disabled) setHoveredKey(it.key); }, onMouseLeave: () => setHoveredKey(null),
          className: "dc-row-menu-item",
          style: { display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", border: 0, padding: "7px 10px",
            fontSize: 12, borderRadius: "var(--radius-sm)", background: focusedKey === it.key || hoveredKey === it.key ? "var(--surface-2)" : "transparent",
            outline: focusedKey === it.key ? "2px solid var(--brand)" : "none", outlineOffset: -2,
            cursor: it.disabled ? "not-allowed" : "pointer",
            color: it.disabled ? "var(--ink-faint)" : it.danger ? "var(--danger-ink)" : "var(--ink)" }
        }, it.icon && Icon && h(Icon, { name: it.icon, size: 14 }), it.label))));
    return h(React.Fragment, null,
      h("button", {
        ref: trigger, type: "button", "aria-label": label, "aria-haspopup": "menu", "aria-expanded": open ? "true" : "false", "aria-controls": open ? id : undefined, title: label,
        className: "dc-row-menu-trigger",
        onFocus: () => setTriggerFocused(true), onBlur: () => setTriggerFocused(false),
        onMouseEnter: () => setTriggerHovered(true), onMouseLeave: () => setTriggerHovered(false),
        onClick: event => { event.stopPropagation(); if (open) close(); else show(); },
        onKeyDown: event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); event.stopPropagation(); show(event.key === "ArrowUp" ? "last" : "first");
          }
        },
        style: { display: "inline-grid", placeItems: "center", width: 28, height: 28, cursor: "pointer",
          border: 0, borderRadius: "var(--radius-sm)", background: open || triggerHovered ? "var(--surface-2)" : "transparent",
          outline: triggerFocused ? "2px solid var(--brand)" : undefined, outlineOffset: 2,
          color: "var(--ink-soft)" } },
        Icon ? h(Icon, { name: "ellipsis", size: 14 }) : "···"),
      panel && ReactDOM.createPortal(panel, document.body));
  }

  window.KitAtoms = { SelectFilter, SegTab, SearchInput, SectionHeader, Metric, MetricGrid, TreeNav, EntityLink, MoneyLink, StatePanel, RowActionMenu };
  window.KitAtomsScreen = function () { return null; };
})();
