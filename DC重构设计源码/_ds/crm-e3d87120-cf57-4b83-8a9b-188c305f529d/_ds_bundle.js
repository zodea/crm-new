/* @ds-bundle: {"format":3,"namespace":"DesignSystem_e3d871","components":[{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Field","sourcePath":"components/core/Field.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Panel","sourcePath":"components/core/Panel.jsx"},{"name":"StatCard","sourcePath":"components/core/StatCard.jsx"},{"name":"StatusChip","sourcePath":"components/core/StatusChip.jsx"},{"name":"FilterPill","sourcePath":"components/navigation/FilterPill.jsx"},{"name":"NavItem","sourcePath":"components/navigation/NavItem.jsx"},{"name":"StageTab","sourcePath":"components/navigation/StageTab.jsx"}],"sourceHashes":{"components/core/Button.jsx":"c67555a062d4","components/core/Field.jsx":"666a177a66ba","components/core/Icon.jsx":"33f6943d65fe","components/core/IconButton.jsx":"ae72c99f3652","components/core/Panel.jsx":"55bd4938b8c6","components/core/StatCard.jsx":"28731e6bc454","components/core/StatusChip.jsx":"33a4819b7d06","components/navigation/FilterPill.jsx":"1186b3fd2000","components/navigation/NavItem.jsx":"f57bc5de1a7f","components/navigation/StageTab.jsx":"13b988bf8d4b","ui_kits/scanner-assistant/AppShell.jsx":"d7772e50998e","ui_kits/scanner-assistant/CalcScreen.jsx":"b062c1c7a7f1","ui_kits/scanner-assistant/CrewDetailScreen.jsx":"507142de225d","ui_kits/scanner-assistant/CrewScreen.jsx":"e7ea7a8d0086","ui_kits/scanner-assistant/DeliveryScreen.jsx":"e3c473c16fc4","ui_kits/scanner-assistant/InvoiceScreen.jsx":"448a9222c17b","ui_kits/scanner-assistant/PayrollDetailScreen.jsx":"68cc08646791","ui_kits/scanner-assistant/PayrollScreen.jsx":"a2af69f768d5","ui_kits/scanner-assistant/PriceScreen.jsx":"4ac856bed942","ui_kits/scanner-assistant/ProjectScreen.jsx":"c508e6dee394","ui_kits/scanner-assistant/QuantityScreen.jsx":"5543be73273f","ui_kits/scanner-assistant/SettingsDialog.jsx":"b1685213e3e2","ui_kits/scanner-assistant/SupplierScreen.jsx":"c1dd6ae87fc3","ui_kits/scanner-assistant/WorkerScreen.jsx":"c441c8bae38d","ui_kits/scanner-assistant/data.js":"b398c663bf1c"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_e3d871 = window.DesignSystem_e3d871 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Field.jsx
try { (() => {
/**
 * Field — label 在上的输入字段（对应 field-label + field-input）。
 * label 小号加粗带字距；input focus 蓝框 + 蓝环。mono 用于发票号/金额/日期等财务字段。
 */
function Field({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
  colSpan,
  style = {},
  inputProps = {}
}) {
  const [focus, setFocus] = React.useState(false);
  return React.createElement("label", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 4,
      minWidth: 0,
      gridColumn: colSpan ? `span ${colSpan}` : undefined,
      ...style
    }
  }, React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: "var(--ink-soft)",
      letterSpacing: "var(--tracking-wide)"
    }
  }, label), React.createElement("input", {
    value,
    onChange,
    placeholder,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    ...inputProps,
    style: {
      width: "100%",
      minWidth: 0,
      border: "1px solid",
      borderColor: focus ? "var(--brand)" : "var(--line-strong)",
      borderRadius: "var(--radius-btn)",
      padding: "7px 10px",
      background: "#fff",
      color: "var(--ink)",
      fontFamily: mono ? "var(--font-mono)" : "inherit",
      fontSize: 13,
      fontVariantNumeric: mono ? "tabular-nums" : "normal",
      outline: "none",
      boxShadow: focus ? "0 0 0 3px rgba(37,99,235,0.18)" : "none",
      transition: "border-color var(--dur-fast) var(--ease-snappy), box-shadow var(--dur-fast) var(--ease-snappy)"
    }
  }));
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Field.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
/**
 * Icon — Lucide 图标包装。
 * 原应用通过 UnoCSS Icons preset 使用 `i-lucide-xxx`。这里在浏览器中以全局
 * `window.lucide`（lucide UMD）按需渲染同名图标，保持线宽与填充风格一致。
 * SVG 由命令式注入到 React 托管的空 <span> 里，React 不会 diff 其内部，避免冲突。
 */
function Icon({
  name = "circle",
  size = 16,
  strokeWidth = 2,
  color,
  className = "",
  style = {}
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    const lucide = typeof window !== "undefined" ? window.lucide : null;
    if (!host || !lucide) return;
    const pascal = String(name).split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
    const node = lucide.icons && lucide.icons[pascal] || lucide[pascal];
    host.innerHTML = "";
    if (!node) return;
    try {
      const svg = lucide.createElement(node);
      svg.setAttribute("width", size);
      svg.setAttribute("height", size);
      svg.setAttribute("stroke-width", strokeWidth);
      svg.style.display = "block";
      host.appendChild(svg);
    } catch (e) {
      /* lucide 未就绪时静默 */
    }
  }, [name, size, strokeWidth]);
  return React.createElement("span", {
    ref,
    className,
    "aria-hidden": "true",
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none",
      width: size,
      height: size,
      color: color || "currentColor",
      ...style
    }
  });
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
/**
 * Button — 主操作按钮。
 * 变体：secondary(默认·描边白底) / primary(浅底深字) / accent(实心蓝·核心CTA) / ghost(透明·hover 浅蓝) / danger(红字描边)。
 * 交互态贴合原应用 snappy native desktop：hover=flat color shift；active=scale(.97)。
 */
function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  fullWidth = false,
  onClick,
  type = "button",
  children,
  style = {}
}) {
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const sizes = {
    sm: {
      padding: "5px 11px",
      fontSize: 12,
      iconSize: 14,
      gap: 5
    },
    md: {
      padding: "7px 12px",
      fontSize: 13,
      iconSize: 16,
      gap: 6
    },
    lg: {
      padding: "9px 16px",
      fontSize: 14,
      iconSize: 16,
      gap: 6
    }
  };
  const s = sizes[size] || sizes.md;
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: s.gap,
    padding: s.padding,
    fontSize: s.fontSize,
    fontWeight: 600,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    border: "1px solid",
    borderRadius: "var(--radius-btn)",
    transition: "background var(--dur-fast) var(--ease-snappy), border-color var(--dur-fast) var(--ease-snappy), opacity var(--dur-fast) var(--ease-snappy), transform var(--dur-fast) var(--ease-snappy)",
    transform: active && !disabled ? "scale(0.97)" : "scale(1)",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "default" : "pointer",
    width: fullWidth ? "100%" : "auto"
  };
  const variants = {
    secondary: {
      borderColor: hover && !disabled ? "var(--ink-soft)" : "var(--line-strong)",
      background: hover && !disabled ? "#eceef1" : "#fff",
      color: "var(--ink)"
    },
    primary: {
      borderColor: "var(--brand)",
      background: hover && !disabled ? "var(--_btn-p-h, #dbeafe)" : "var(--_btn-p-bg, var(--brand-soft))",
      color: "var(--_btn-p-c, var(--brand-deep))"
    },
    accent: {
      borderColor: "var(--brand)",
      background: "var(--brand)",
      color: "#fff",
      opacity: disabled ? 0.5 : hover ? 0.9 : 1
    },
    ghost: {
      borderColor: "transparent",
      background: hover && !disabled ? "var(--brand-soft)" : "transparent",
      color: hover && !disabled ? "var(--brand)" : "var(--ink-soft)"
    },
    danger: {
      borderColor: hover && !disabled ? "var(--danger)" : "var(--line-strong)",
      background: hover && !disabled ? "rgba(220,38,38,0.05)" : "#fff",
      color: "var(--danger)"
    }
  };
  return React.createElement("button", {
    type,
    disabled,
    onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    style: {
      ...base,
      ...(variants[variant] || variants.secondary),
      ...style
    }
  }, icon ? React.createElement(__ds_scope.Icon, {
    name: icon,
    size: s.iconSize,
    key: "li"
  }) : null, children != null ? React.createElement("span", {
    key: "lb"
  }, children) : null, iconRight ? React.createElement(__ds_scope.Icon, {
    name: iconRight,
    size: s.iconSize,
    key: "ri"
  }) : null);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
/**
 * IconButton — 纯图标方形按钮（表格操作列 / 工具条）。
 * 默认 28×28 描边白底；tone="danger" 时红字、hover 红框浅红底。
 * 原应用规则：表格操作列统一纯图标 + tooltip，不混用文字。
 */
function IconButton({
  icon,
  tone = "default",
  size = 28,
  title,
  disabled = false,
  onClick,
  style = {}
}) {
  const [hover, setHover] = React.useState(false);
  const danger = tone === "danger";
  const colors = {
    color: danger ? "var(--danger)" : hover && !disabled ? "var(--brand)" : "var(--ink-soft)",
    borderColor: hover && !disabled ? danger ? "var(--danger)" : "var(--brand)" : "var(--line)",
    background: hover && !disabled && danger ? "rgba(220,38,38,0.05)" : "#fff"
  };
  return React.createElement("button", {
    type: "button",
    title,
    disabled,
    onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: size,
      height: size,
      border: "1px solid",
      borderRadius: "var(--radius-btn)",
      transition: "border-color var(--dur-fast) var(--ease-snappy), color var(--dur-fast) var(--ease-snappy), background var(--dur-fast) var(--ease-snappy)",
      opacity: disabled ? 0.5 : 1,
      cursor: disabled ? "default" : "pointer",
      ...colors,
      ...style
    }
  }, React.createElement(__ds_scope.Icon, {
    name: icon,
    size: Math.round(size * 0.57)
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Panel.jsx
try { (() => {
/**
 * Panel — L1 卡片容器（白底 + 描边 + 卡片阴影 + 12 圆角）。
 * 对应原应用 shortcut `panel`。用 padding 控制内边距；不嵌套卡片（用分隔线分区）。
 */
function Panel({
  padding = 16,
  hover = false,
  as = "div",
  children,
  style = {},
  ...rest
}) {
  const [h, setH] = React.useState(false);
  return React.createElement(as, {
    ...rest,
    onMouseEnter: hover ? () => setH(true) : rest.onMouseEnter,
    onMouseLeave: hover ? () => setH(false) : rest.onMouseLeave,
    style: {
      background: "var(--panel)",
      border: "1px solid",
      borderColor: hover && h ? "var(--brand)" : "var(--line)",
      borderRadius: "var(--radius-card)",
      boxShadow: hover && h ? "var(--shadow-pop)" : "var(--shadow-card)",
      padding,
      transition: "border-color var(--dur-fast) var(--ease-snappy), box-shadow var(--dur-fast) var(--ease-snappy)",
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Panel.jsx", error: String((e && e.message) || e) }); }

// components/core/StatCard.jsx
try { (() => {
/**
 * StatCard — 独立卡片与密排指标格共用的可变内核。
 * 两种布局保留原字号/边框/公式及点击合同，不读取或推算业务值。
 */
function StatCard({
  label,
  value,
  tone = "default",
  variant = "standalone",
  formula,
  big = false,
  status,
  cutoff,
  missingSources,
  clickable = false,
  onClick,
  style = {}
}) {
  const tones = {
    default: "var(--ink)",
    brand: "var(--brand)",
    ok: "var(--ok)",
    danger: "var(--danger-ink)",
    warn: "var(--warn-ink)",
    soft: "var(--ink-soft)"
  };
  const grid = variant === "grid";
  const contents = [React.createElement("div", {
    key: "label", style: { display: "flex", alignItems: "center", gap: 4,
      fontSize: grid ? 11 : 12, fontWeight: grid ? 600 : 700,
      color: grid ? "var(--ink-faint)" : "var(--ink-soft)" }
  }, React.createElement("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, label),
    formula && React.createElement("span", { title: formula, role: "note", tabIndex: clickable ? undefined : 0,
      "aria-label": label + "说明：" + formula, style: { display: "inline-flex", cursor: "help" } },
      React.createElement(__ds_scope.Icon, { name: "info", size: 11, color: "var(--ink-faint)" }))),
    React.createElement("div", { key: "value", title: typeof value === "string" ? value : undefined,
      style: { marginTop: grid ? 5 : 4, fontSize: grid ? big ? 17.5 : 13.5 : 24,
        fontWeight: grid ? big ? 800 : 700 : 800, lineHeight: grid ? 1.25 : 1.1,
        fontFamily: "var(--font-mono)", whiteSpace: "nowrap", letterSpacing: grid ? "-0.015em" : undefined,
        color: grid && tone === "ok" ? "var(--ok-ink)" : tones[tone] || tones.default } }, value),
    (status || cutoff || missingSources) && React.createElement("dl", { key: "source", style: { margin: "8px 0 0", paddingTop: 8, borderTop: "1px solid var(--line)", fontSize: 10, color: "var(--ink-faint)" } },
      [["状态", status], ["汇总截止", cutoff], ["缺失来源", missingSources]].filter((entry) => entry[1]).map(([name, text]) =>
        React.createElement("div", { key: name, style: { display: "flex", gap: 4, minWidth: 0 } },
          React.createElement("dt", null, name), React.createElement("dd", { style: { margin: 0, overflowWrap: "anywhere" } }, text))))];
  if (grid) return React.createElement("div", { role: "group", "aria-label": label,
    style: { padding: "12px 14px", minWidth: 0, background: "var(--panel)", ...style } }, contents);
  return React.createElement(__ds_scope.Panel, { padding: 16, hover: clickable,
    as: clickable ? "button" : "div", type: clickable ? "button" : undefined,
    "aria-description": clickable ? formula : undefined,
    onClick: clickable ? onClick : undefined,
    style: { textAlign: "left", cursor: clickable ? "pointer" : "default", ...style } }, contents);
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/core/StatusChip.jsx
try { (() => {
/**
 * StatusChip — pill 状态标签（浅底深字，非交互）。
 * tone：ok(绿) / warn(橙) / danger(红) / brand(蓝) / neutral(灰)。
 * 对应原应用 chip-ok / chip-warn / chip-danger / chip-brand。
 */
function StatusChip({
  tone = "neutral",
  children,
  style = {}
}) {
  const tones = {
    ok: {
      background: "var(--ok-soft)",
      color: "var(--ok-ink)"
    },
    warn: {
      background: "var(--warn-soft)",
      color: "var(--warn-ink)"
    },
    danger: {
      background: "var(--danger-soft)",
      color: "var(--danger-ink)"
    },
    brand: {
      background: "var(--brand-soft)",
      color: "var(--brand)"
    },
    neutral: {
      background: "var(--surface-3)",
      color: "var(--ink-soft)"
    }
  };
  return React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: "var(--radius-pill)",
      padding: "4px 10px",
      fontSize: 12,
      fontWeight: 600,
      lineHeight: 1,
      whiteSpace: "nowrap",
      ...(tones[tone] || tones.neutral),
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { StatusChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatusChip.jsx", error: String((e && e.message) || e) }); }

// components/navigation/FilterPill.jsx
try { (() => {
/**
 * FilterPill — 圆角筛选标签（处理状态/购买方/票据类型筛选条）。
 * 选中态：蓝框浅蓝底蓝字；未选白底，hover 蓝框。可带计数。
 */
function FilterPill({
  label,
  count,
  active = false,
  onClick,
  style = {}
}) {
  const [hover, setHover] = React.useState(false);
  return React.createElement("button", {
    type: "button",
    onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "4px 9px",
      borderRadius: "var(--radius-pill)",
      border: "1px solid",
      fontSize: 12,
      fontWeight: 700,
      whiteSpace: "nowrap",
      background: active ? "var(--brand-soft)" : "#fff",
      borderColor: active ? "var(--brand)" : hover ? "var(--brand)" : "var(--line)",
      color: active ? "var(--brand)" : "var(--ink)",
      transition: "all var(--dur-fast) var(--ease-snappy)",
      ...style
    }
  }, label, count != null ? React.createElement("span", {
    style: {
      opacity: 0.7
    }
  }, count) : null);
}
Object.assign(__ds_scope, { FilterPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/FilterPill.jsx", error: String((e && e.message) || e) }); }

// components/navigation/NavItem.jsx
try { (() => {
/**
 * NavItem — 侧边栏导航项（品牌签名：中文单字方块 + 名称 + 副提示）。
 * 选中态：浅蓝底 + 蓝字 + 左侧 3px 内描边蓝条；方块翻白底蓝字。
 * 这是本应用区别于其他工具的视觉标记，方块内是单个汉字（票/单/方/项/工/价）。
 */
function NavItem({
  mark,
  label,
  hint,
  active = false,
  onClick,
  style = {}
}) {
  const [hover, setHover] = React.useState(false);
  return React.createElement("button", {
    type: "button",
    onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      width: "100%",
      border: 0,
      textAlign: "left",
      padding: "10px 12px",
      borderRadius: "var(--radius-btn)",
      background: active ? "var(--brand-soft)" : hover ? "var(--surface-3)" : "transparent",
      color: active ? "var(--brand)" : "var(--ink-soft)",
      boxShadow: active ? "var(--ring-selected)" : "none",
      transition: "background var(--dur-fast) var(--ease-snappy), color var(--dur-fast) var(--ease-snappy)",
      ...style
    }
  }, React.createElement("span", {
    style: {
      display: "grid",
      placeItems: "center",
      flex: "none",
      width: 32,
      height: 32,
      borderRadius: "var(--radius-btn)",
      border: "1px solid",
      fontSize: 14,
      fontWeight: 800,
      background: active ? "#fff" : "var(--surface-2)",
      borderColor: active ? "rgba(37,99,235,0.25)" : "var(--line)",
      color: active ? "var(--brand)" : "var(--ink-soft)"
    }
  }, mark), React.createElement("span", {
    style: {
      minWidth: 0
    }
  }, React.createElement("span", {
    style: {
      display: "block",
      fontSize: 13,
      fontWeight: 800,
      lineHeight: 1.2,
      color: active ? "var(--brand)" : "var(--ink)"
    }
  }, label), hint ? React.createElement("span", {
    style: {
      display: "block",
      fontSize: 11,
      lineHeight: 1.35,
      opacity: 0.75,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, hint) : null));
}
Object.assign(__ds_scope, { NavItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/NavItem.jsx", error: String((e && e.message) || e) }); }

// components/navigation/StageTab.jsx
try { (() => {
/**
 * StageTab — 阶段切换按钮（发票页顶部 sticky tab：识别状态/校对/待入账/已入账）。
 * 选中态实心蓝白字 + 计数白底徽章；未选描边白底，hover 蓝。
 */
function StageTab({
  label,
  count,
  active = false,
  onClick,
  style = {}
}) {
  const [hover, setHover] = React.useState(false);
  return React.createElement("button", {
    type: "button",
    onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "8px 12px",
      borderRadius: "var(--radius-btn)",
      border: "1px solid",
      fontSize: 13,
      fontWeight: active ? 800 : 700,
      whiteSpace: "nowrap",
      background: active ? "var(--brand)" : "#fff",
      borderColor: active ? "var(--brand)" : hover ? "var(--brand)" : "var(--line)",
      color: active ? "#fff" : hover ? "var(--brand)" : "var(--ink)",
      boxShadow: active ? "var(--shadow-card)" : "none",
      transition: "all var(--dur-fast) var(--ease-snappy)",
      ...style
    }
  }, label, count != null ? React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 20,
      height: 20,
      padding: "0 5px",
      borderRadius: "var(--radius-pill)",
      fontSize: 11,
      fontWeight: 700,
      background: active ? "rgba(255,255,255,0.25)" : "var(--surface-3)",
      color: active ? "#fff" : "var(--ink-soft)"
    }
  }, count) : null);
}
Object.assign(__ds_scope, { StageTab });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/StageTab.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/AppShell.jsx
try { (() => {
// AppShell — 桌面壳：左侧「分组 + 可收起」侧边栏 + 顶栏 + 主内容区。
// 改版要点（design §3.1/§12.1）：扁平 tab → 分组侧边栏；支持整体收起成图标模式，分组可折叠。
(function () {
  const {
    NavItem,
    Icon
  } = window.DesignSystem_e3d871;

  // 导航树：group=可折叠分组（含子项）；item=独立顶层项。
  const NAV = [{
    type: "group",
    key: "g-invoice",
    label: "发票",
    icon: "receipt-text",
    items: [{
      key: "invoice",
      mark: "票",
      label: "发票列表",
      hint: "识别校对入账",
      title: "发票管理",
      subtitle: "识别·校对·入账"
    }, {
      key: "factor",
      mark: "因",
      label: "开票·税额工具",
      hint: "推算数量·税额大写",
      title: "开票因子推算 · 税额计算",
      subtitle: "因子推断数量 · 价税分离 · 人民币大写"
    }]
  }, {
    type: "item",
    key: "delivery",
    mark: "单",
    label: "送货单",
    hint: "扫描整理归档",
    title: "送货单",
    subtitle: "扫描·整理·归档"
  }, {
    type: "item",
    key: "supplier",
    mark: "方",
    label: "分供方",
    hint: "资料管理对账",
    title: "分供方资料库",
    subtitle: "资料管理·对账"
  }, {
    type: "group",
    key: "g-project",
    label: "项目",
    icon: "building",
    items: [{
      key: "project",
      mark: "项",
      label: "项目列表",
      hint: "工期进度",
      title: "施工项目",
      subtitle: "项目管理"
    }, {
      key: "quantity",
      mark: "量",
      label: "工程量管理",
      hint: "矩阵可视化",
      title: "工程量矩阵",
      subtitle: "楼层×户号×分项 · 按月着色"
    }]
  }, {
    type: "group",
    key: "g-crew",
    label: "班组",
    icon: "users",
    items: [{
      key: "crew",
      mark: "组",
      label: "班组管理",
      hint: "单价·配置",
      title: "班组管理",
      subtitle: "全局核算单元 · 跨项目复用"
    }, {
      key: "worker",
      mark: "工",
      label: "工人信息",
      hint: "人员证书",
      title: "工人信息库",
      subtitle: "人员管理"
    }, {
      key: "payroll",
      mark: "资",
      label: "工资管理",
      hint: "核算发放",
      title: "工资核算",
      subtitle: "班组×项目×月份 · 计件 / 计时"
    }]
  }, {
    type: "item",
    key: "price",
    mark: "价",
    label: "单价对比",
    hint: "材料价格分析",
    title: "单价对比",
    subtitle: "材料价格分析"
  }];

  // 扁平索引（查 active 项的标题）
  const FLAT = {};
  NAV.forEach(n => n.type === "group" ? n.items.forEach(it => {
    FLAT[it.key] = it;
  }) : FLAT[n.key] = n);
  FLAT["crewDetail"] = {
    title: "班组详情",
    subtitle: "基本信息 · 工人配置 · 分项单价"
  };
  FLAT["payrollDetail"] = {
    title: "工资明细",
    subtitle: "分项工程量 · 计算流程"
  };
  window.KIT_NAV = NAV;
  function GroupHeader({
    label,
    icon,
    open,
    onToggle,
    collapsed
  }) {
    const [hover, setHover] = React.useState(false);
    if (collapsed) return React.createElement("div", {
      style: {
        height: 1,
        background: "var(--line)",
        margin: "8px 6px"
      }
    });
    return /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: onToggle,
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        border: 0,
        background: hover ? "var(--surface-3)" : "transparent",
        borderRadius: "var(--radius-btn)",
        padding: "8px 10px",
        marginTop: 4,
        cursor: "pointer",
        color: "var(--ink-soft)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 15
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: "var(--tracking-wide)",
        flex: 1,
        textAlign: "left"
      }
    }, label), /*#__PURE__*/React.createElement(Icon, {
      name: open ? "chevron-down" : "chevron-right",
      size: 14
    }));
  }

  // 图标模式下的紧凑项（仅单字方块）
  function MiniItem({
    mark,
    label,
    active,
    onClick
  }) {
    const [hover, setHover] = React.useState(false);
    return /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: onClick,
      title: label,
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      style: {
        display: "grid",
        placeItems: "center",
        width: 40,
        height: 40,
        margin: "2px auto",
        border: "1px solid",
        borderRadius: "var(--radius-btn)",
        cursor: "pointer",
        fontSize: 15,
        fontWeight: 800,
        background: active ? "var(--brand-soft)" : hover ? "var(--surface-3)" : "var(--surface-2)",
        borderColor: active ? "rgba(37,99,235,0.25)" : "var(--line)",
        color: active ? "var(--brand)" : "var(--ink-soft)",
        boxShadow: active ? "var(--ring-selected)" : "none"
      }
    }, mark);
  }
  function AppShell({
    route,
    onNav,
    onSettings,
    children
  }) {
    const [collapsed, setCollapsed] = React.useState(false);
    const [open, setOpen] = React.useState({
      "g-invoice": true,
      "g-project": true,
      "g-crew": true
    });
    const active = FLAT[route] || NAV[0];
    const W = collapsed ? 68 : 248;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        minHeight: "100%",
        background: "var(--bg)",
        color: "var(--ink)"
      }
    }, /*#__PURE__*/React.createElement("aside", {
      style: {
        position: "fixed",
        insetBlock: 0,
        left: 0,
        zIndex: 30,
        width: W,
        background: "var(--panel)",
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        padding: collapsed ? "16px 8px" : "16px 12px",
        transition: "width var(--dur-base) var(--ease-snappy)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: collapsed ? "0 0 16px" : "0 8px 20px",
        justifyContent: collapsed ? "center" : "flex-start"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "grid",
        placeItems: "center",
        width: 36,
        height: 36,
        borderRadius: 8,
        background: "var(--brand)",
        color: "#fff",
        fontWeight: 800,
        fontSize: 16,
        flex: "none"
      }
    }, "\u745E"), !collapsed && /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0,
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 16,
        fontWeight: 800,
        lineHeight: 1.2
      }
    }, "\u745E\u822A CRM"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--ink-soft)",
        marginTop: 2
      }
    }, "\u5DE5\u7A0B\u8D22\u52A1\u7BA1\u7406"))), /*#__PURE__*/React.createElement("nav", {
      style: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        overflowY: "auto",
        overflowX: "hidden"
      }
    }, NAV.map(n => {
      if (n.type === "item") {
        return collapsed ? /*#__PURE__*/React.createElement(MiniItem, {
          key: n.key,
          mark: n.mark,
          label: n.label,
          active: route === n.key,
          onClick: () => onNav(n.key)
        }) : /*#__PURE__*/React.createElement(NavItem, {
          key: n.key,
          mark: n.mark,
          label: n.label,
          hint: n.hint,
          active: route === n.key,
          onClick: () => onNav(n.key)
        });
      }
      if (collapsed) {
        return /*#__PURE__*/React.createElement(React.Fragment, {
          key: n.key
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            height: 1,
            background: "var(--line)",
            margin: "8px 6px"
          }
        }), n.items.map(it => /*#__PURE__*/React.createElement(MiniItem, {
          key: it.key,
          mark: it.mark,
          label: it.label,
          active: route === it.key,
          onClick: () => onNav(it.key)
        })));
      }
      const isOpen = open[n.key];
      return /*#__PURE__*/React.createElement("div", {
        key: n.key
      }, /*#__PURE__*/React.createElement(GroupHeader, {
        label: n.label,
        icon: n.icon,
        open: isOpen,
        onToggle: () => setOpen(o => ({
          ...o,
          [n.key]: !o[n.key]
        }))
      }), isOpen && /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 2,
          paddingLeft: 8,
          marginLeft: 8,
          borderLeft: "1px solid var(--line)"
        }
      }, n.items.map(it => /*#__PURE__*/React.createElement(NavItem, {
        key: it.key,
        mark: it.mark,
        label: it.label,
        hint: it.hint,
        active: route === it.key,
        onClick: () => onNav(it.key)
      }))));
    })), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setCollapsed(c => !c),
      style: {
        marginTop: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: "100%",
        border: "1px solid var(--line)",
        background: "var(--surface-2)",
        borderRadius: "var(--radius-btn)",
        padding: "8px",
        cursor: "pointer",
        color: "var(--ink-soft)",
        fontSize: 12,
        fontWeight: 700
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: collapsed ? "panel-left-open" : "panel-left-close",
      size: 16
    }), !collapsed && /*#__PURE__*/React.createElement("span", null, "\u6536\u8D77\u4FA7\u680F")), !collapsed && /*#__PURE__*/React.createElement("div", {
      style: {
        paddingTop: 12,
        marginTop: 12,
        borderTop: "1px solid var(--line)",
        fontSize: 11,
        color: "var(--ink-soft)",
        lineHeight: 1.7
      }
    }, /*#__PURE__*/React.createElement("div", null, "\u672C\u5730\u5DE5\u5177 \xB7 \u6570\u636E\u4E0D\u4E0A\u4F20"), /*#__PURE__*/React.createElement("div", null, "v2.0 \xB7 \u5DE5\u7A0B\u91CF / \u5DE5\u8D44\u6A21\u5757"))), /*#__PURE__*/React.createElement("div", {
      style: {
        paddingLeft: W,
        minHeight: "100vh",
        transition: "padding-left var(--dur-base) var(--ease-snappy)"
      }
    }, /*#__PURE__*/React.createElement("header", {
      style: {
        position: "sticky",
        top: 0,
        zIndex: 20,
        height: "var(--header-h)",
        background: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "0 24px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 18,
        fontWeight: 800,
        lineHeight: 1.2
      }
    }, active.title || active.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)",
        marginTop: 2
      }
    }, active.subtitle)), /*#__PURE__*/React.createElement(window.DesignSystem_e3d871.Button, {
      icon: "settings",
      onClick: onSettings
    }, "\u8BBE\u7F6E")), /*#__PURE__*/React.createElement("main", {
      style: {
        maxWidth: "var(--content-max)",
        margin: "0 auto",
        padding: 16
      }
    }, children)));
  }
  window.AppShell = AppShell;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/CalcScreen.jsx
try { (() => {
// CalcScreen — 开票因子推算 + 税额计算/大写
(function () {
  const {
    Button,
    Panel,
    Icon,
    StatusChip
  } = window.DesignSystem_e3d871;
  function moneyToChinese(amount) {
    if (!amount && amount !== 0) return "";
    const digit = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
    const intUnit = ["", "拾", "佰", "仟"];
    const bigUnit = ["", "万", "亿"];
    const neg = amount < 0;
    let total = Math.round(Math.abs(amount) * 100);
    const fen = total % 10,
      jiao = Math.floor(total / 10) % 10;
    let intPart = Math.floor(total / 100),
      intStr = "";
    if (intPart === 0) {
      intStr = "零";
    } else {
      const groups = [];
      while (intPart > 0) {
        groups.push(intPart % 10000);
        intPart = Math.floor(intPart / 10000);
      }
      for (let gi = groups.length - 1; gi >= 0; gi--) {
        const g = groups[gi];
        const arr = [g % 10, Math.floor(g / 10) % 10, Math.floor(g / 100) % 10, Math.floor(g / 1000) % 10];
        let gstr = "",
          started = false,
          zeroPending = false;
        for (let pos = 3; pos >= 0; pos--) {
          const dd = arr[pos];
          if (dd === 0) {
            if (started) zeroPending = true;
          } else {
            if (zeroPending) {
              gstr += "零";
              zeroPending = false;
            }
            gstr += digit[dd] + intUnit[pos];
            started = true;
          }
        }
        if (gstr) intStr += gstr + bigUnit[gi];else if (intStr && gi > 0) intStr += "零";
      }
    }
    intStr = intStr.replace(/零+/g, "零").replace(/零+$/, "");
    let result = intStr + "元";
    if (!jiao && !fen) {
      result += "整";
    } else {
      if (jiao) result += digit[jiao] + "角";else if (fen) result += "零";
      if (fen) result += digit[fen] + "分";else result += "整";
    }
    return (neg ? "负" : "") + result;
  }
  function useCopy(val) {
    const [copied, setCopied] = React.useState(false);
    const copy = () => {
      const txt = String(val);
      if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});else {
        const t = document.createElement("textarea");
        t.value = txt;
        document.body.appendChild(t);
        t.select();
        document.execCommand("copy");
        document.body.removeChild(t);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    };
    return [copied, copy];
  }

  // 可点击复制的数值块
  function CopyValue({
    value,
    display,
    mono,
    large,
    color
  }) {
    const [copied, copy] = useCopy(value);
    return /*#__PURE__*/React.createElement("span", {
      onClick: copy,
      title: "\u70B9\u51FB\u590D\u5236",
      style: {
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: mono ? "var(--font-mono)" : "inherit",
        fontSize: large ? 22 : 14,
        fontWeight: 700,
        color: copied ? "var(--ok)" : color || "var(--ink)",
        background: copied ? "var(--ok-soft,#f0fdf4)" : "transparent",
        borderRadius: 4,
        padding: "1px 4px",
        transition: "background 0.2s"
      }
    }, copied ? /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 13
    }) : /*#__PURE__*/React.createElement(Icon, {
      name: "copy",
      size: 13,
      color: "var(--ink-faint)"
    }), display || value);
  }
  function CalcScreen({
    data
  }) {
    const [factors, setFactors] = React.useState(data.factorDefaults.map(f => ({
      ...f
    })));
    const [target, setTarget] = React.useState("128640");
    const [taxRate, setTaxRate] = React.useState("13");
    const [results, setResults] = React.useState(null);
    const [nextId, setNextId] = React.useState(100);
    const t = parseFloat(target) || 0;
    const r = (parseFloat(taxRate) || 0) / 100;
    const exTax = t > 0 ? t / (1 + r) : 0;
    const taxAmt = t - exTax;
    const addRow = () => {
      setFactors(f => [...f, {
        id: "n" + nextId,
        name: "",
        unit: "个",
        price: ""
      }]);
      setNextId(n => n + 1);
    };
    const removeRow = id => setFactors(f => f.filter(x => x.id !== id));
    const updateRow = (id, field, val) => setFactors(f => f.map(x => x.id === id ? {
      ...x,
      [field]: val
    } : x));
    const calculate = () => {
      if (t <= 0) return;
      const rows = factors.filter(f => f.name && parseFloat(f.price) > 0).map(f => {
        const p = parseFloat(f.price);
        const qtyExact = t / p;
        const qtyFloor = Math.floor(qtyExact);
        const qtyCeil = Math.ceil(qtyExact);
        const isInt = Math.abs(qtyExact - Math.round(qtyExact)) < 1e-9;
        return {
          ...f,
          p,
          qtyExact,
          qtyFloor,
          qtyCeil,
          isInt,
          qtyBest: isInt ? Math.round(qtyExact) : null,
          amtFloor: qtyFloor * p,
          amtCeil: qtyCeil * p
        };
      });
      setResults(rows);
    };
    const inp = {
      border: "1px solid var(--line-strong)",
      borderRadius: 7,
      padding: "7px 10px",
      fontSize: 13,
      fontFamily: "var(--font-mono)",
      background: "#fff",
      width: "100%"
    };
    const th = {
      padding: "9px 12px",
      fontSize: 12,
      fontWeight: 800,
      color: "var(--ink-soft)",
      background: "var(--surface-2)",
      position: "sticky",
      top: 0,
      whiteSpace: "nowrap"
    };
    const td = {
      padding: "9px 12px",
      fontSize: 13
    };
    const num = {
      ...td,
      textAlign: "right",
      fontFamily: "var(--font-mono)"
    };
    const fmt = v => v.toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "320px 1fr",
        gap: 12,
        alignItems: "start"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      padding: 16,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 800,
        color: "var(--ink-soft)",
        marginBottom: -6
      }
    }, "\u7A0E\u989D\u8BA1\u7B97"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)",
        marginBottom: 5
      }
    }, "\u76EE\u6807\u542B\u7A0E\u91D1\u989D\uFF08\u5143\uFF09"), /*#__PURE__*/React.createElement("input", {
      style: {
        ...inp,
        fontSize: 17,
        fontWeight: 700,
        padding: "10px 12px"
      },
      value: target,
      onChange: e => setTarget(e.target.value),
      placeholder: "\u5982 128640.00"
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)",
        marginBottom: 5
      }
    }, "\u7A0E\u7387 (%)"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement("input", {
      style: {
        ...inp,
        width: 80
      },
      value: taxRate,
      onChange: e => setTaxRate(e.target.value)
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 4,
        flexWrap: "wrap"
      }
    }, ["13", "9", "6", "3", "1"].map(v => /*#__PURE__*/React.createElement("button", {
      key: v,
      onClick: () => setTaxRate(v),
      style: {
        border: "1px solid",
        borderColor: taxRate === v ? "var(--brand)" : "var(--line)",
        background: taxRate === v ? "var(--brand-soft)" : "#fff",
        color: taxRate === v ? "var(--brand)" : "var(--ink)",
        borderRadius: 6,
        padding: "5px 10px",
        fontWeight: 700,
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "var(--font-mono)"
      }
    }, v, "%"))))), t > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 0,
        borderTop: "1px solid var(--line)",
        paddingTop: 12
      }
    }, [["价税合计", t, t.toFixed(2)], ["不含税金额", exTax, exTax.toFixed(2)], ["税额", taxAmt, taxAmt.toFixed(2)]].map(([label, val, raw]) => /*#__PURE__*/React.createElement("div", {
      key: label,
      style: {
        padding: "8px 0",
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)"
      }
    }, label), /*#__PURE__*/React.createElement(CopyValue, {
      value: raw,
      display: "¥" + fmt(val),
      mono: true,
      large: true,
      color: "var(--ink)"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 2
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: "var(--ink-faint)"
      }
    }, "\u5927\u5199"), /*#__PURE__*/React.createElement(CopyValue, {
      value: moneyToChinese(val),
      display: moneyToChinese(val),
      color: "var(--ink-soft)"
    })))))), /*#__PURE__*/React.createElement(Panel, {
      padding: 0,
      style: {
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "12px 14px 8px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        fontWeight: 800
      }
    }, "\u5F00\u7968\u56E0\u5B50\uFF08\u5355\u4EF7\uFF09"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      icon: "plus",
      onClick: addRow
    }, "\u6DFB\u52A0")), factors.map(f => /*#__PURE__*/React.createElement("div", {
      key: f.id,
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 56px 80px 28px",
        gap: 6,
        alignItems: "center",
        padding: "7px 10px",
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("input", {
      style: {
        ...inp,
        padding: "5px 8px"
      },
      placeholder: "\u54C1\u540D",
      value: f.name,
      onChange: e => updateRow(f.id, "name", e.target.value)
    }), /*#__PURE__*/React.createElement("input", {
      style: {
        ...inp,
        padding: "5px 6px"
      },
      placeholder: "\u5355\u4F4D",
      value: f.unit,
      onChange: e => updateRow(f.id, "unit", e.target.value)
    }), /*#__PURE__*/React.createElement("input", {
      style: {
        ...inp,
        padding: "5px 8px",
        textAlign: "right"
      },
      placeholder: "\u5355\u4EF7",
      value: f.price,
      onChange: e => updateRow(f.id, "price", e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      onClick: () => removeRow(f.id),
      style: {
        border: 0,
        background: "transparent",
        cursor: "pointer",
        color: "var(--ink-faint)",
        display: "grid",
        placeItems: "center"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "x",
      size: 14
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "10px 12px"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "calculator",
      fullWidth: true,
      onClick: calculate
    }, "\u8BA1\u7B97")))), /*#__PURE__*/React.createElement(Panel, {
      padding: 8
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "4px 6px 10px",
        fontSize: 13,
        fontWeight: 800,
        color: "var(--ink-soft)"
      }
    }, results ? `推算结果 — 含税 ¥${t.toLocaleString("zh-CN")}` : "填写因子后点击「计算」"), results && /*#__PURE__*/React.createElement("div", {
      style: {
        overflow: "auto"
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: "100%",
        borderCollapse: "collapse",
        minWidth: 560
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, ["品名", "单位", "单价", "推算数量", "开票金额", "余额", ""].map((h, i) => /*#__PURE__*/React.createElement("th", {
      key: i,
      style: {
        ...th,
        textAlign: i >= 2 ? "right" : "left"
      }
    }, h)))), /*#__PURE__*/React.createElement("tbody", null, results.map(f => /*#__PURE__*/React.createElement(React.Fragment, {
      key: f.id
    }, /*#__PURE__*/React.createElement("tr", {
      style: {
        borderBottom: f.isInt ? "2px solid var(--ok)" : "1px solid var(--line)",
        background: f.isInt ? "#f0fdf4" : "transparent"
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontWeight: 600
      }
    }, f.name), /*#__PURE__*/React.createElement("td", {
      style: td
    }, f.unit), /*#__PURE__*/React.createElement("td", {
      style: {
        ...num,
        color: "var(--ink-soft)"
      }
    }, fmt(f.p)), /*#__PURE__*/React.createElement("td", {
      style: {
        ...num,
        fontWeight: 700,
        color: f.isInt ? "var(--ok)" : "var(--ink)"
      }
    }, f.isInt ? f.qtyBest : f.qtyExact.toFixed(4)), /*#__PURE__*/React.createElement("td", {
      style: {
        ...num
      }
    }, f.isInt ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--ok)",
        fontWeight: 700
      }
    }, "\xA5", fmt(f.qtyBest * f.p)) : "—"), /*#__PURE__*/React.createElement("td", {
      style: {
        ...num,
        color: f.isInt ? "var(--ok)" : "var(--danger)"
      }
    }, f.isInt ? "¥0.00" : "¥" + (t - f.amtFloor).toFixed(2)), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: "center"
      }
    }, f.isInt ? /*#__PURE__*/React.createElement(StatusChip, {
      tone: "ok"
    }, "\u2713 \u6574\u5F00") : /*#__PURE__*/React.createElement(StatusChip, {
      tone: "warn"
    }, "\u975E\u6574"))), !f.isInt && /*#__PURE__*/React.createElement("tr", {
      style: {
        borderBottom: "1px solid var(--line)",
        background: "var(--surface-2)"
      }
    }, /*#__PURE__*/React.createElement("td", {
      colSpan: 2,
      style: {
        padding: "5px 12px",
        fontSize: 12,
        color: "var(--ink-faint)"
      }
    }, "\u8FD1\u4F3C\u65B9\u6848"), /*#__PURE__*/React.createElement("td", null), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "5px 12px",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        textAlign: "right"
      }
    }, f.qtyFloor, " / ", f.qtyCeil), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "5px 12px",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        textAlign: "right",
        color: "var(--ink-soft)"
      }
    }, "\xA5", fmt(f.amtFloor), " / \xA5", fmt(f.amtCeil)), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "5px 12px",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        textAlign: "right"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--danger)"
      }
    }, "\u2212", (t - f.amtFloor).toFixed(2)), " / ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--warn,#f59e0b)"
      }
    }, "+", (f.amtCeil - t).toFixed(2))), /*#__PURE__*/React.createElement("td", null)))), results.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      colSpan: 7,
      style: {
        padding: 32,
        textAlign: "center",
        color: "var(--ink-faint)"
      }
    }, "\u6CA1\u6709\u586B\u5199\u6709\u6548\u5355\u4EF7\u7684\u56E0\u5B50"))))), !results && /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 48,
        textAlign: "center",
        color: "var(--ink-faint)",
        fontSize: 13
      }
    }, "\u5728\u5DE6\u4FA7\u7EF4\u62A4\u5355\u4EF7\u56E0\u5B50\u5217\u8868\uFF0C\u586B\u5199\u76EE\u6807\u542B\u7A0E\u91D1\u989D\u540E\u70B9\u51FB\u300C\u8BA1\u7B97\u300D")));
  }
  window.CalcScreen = CalcScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/CalcScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/CrewDetailScreen.jsx
try { (() => {
// CrewDetailScreen — 班组详情：基本信息编辑 / 工人个人配置（内联编辑）/ 分项单价编辑
(function () {
  const {
    Button,
    Panel,
    StatusChip,
    StageTab,
    Icon,
    Field
  } = window.DesignSystem_e3d871;

  // 简易内联弹窗（编辑一项工人配置）
  function WorkerConfigModal({
    wc,
    cfg,
    onSave,
    onClose
  }) {
    const [mode, setMode] = React.useState(wc.mode);
    const [rent, setRent] = React.useState(wc.rent === null ? "default" : wc.rent === false ? "off" : "on");
    const [mgmt, setMgmt] = React.useState(wc.mgmt === null ? "default" : wc.mgmt === false ? "off" : "on");
    const [ratio, setRatio] = React.useState(wc.ratio === null ? "" : String(Math.round(wc.ratio * 100)));
    const [daily, setDaily] = React.useState(String(wc.daily || ""));
    const inp = {
      border: "1px solid var(--line-strong)",
      borderRadius: 7,
      padding: "7px 10px",
      fontSize: 13,
      fontFamily: "var(--font-mono)",
      background: "#fff",
      width: "100%"
    };
    const RadioGroup = ({
      label,
      value,
      onChange,
      opts
    }) => /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)",
        marginBottom: 6
      }
    }, label), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6
      }
    }, opts.map(([v, l]) => /*#__PURE__*/React.createElement("button", {
      key: v,
      onClick: () => onChange(v),
      style: {
        border: "1px solid",
        borderColor: value === v ? "var(--brand)" : "var(--line)",
        background: value === v ? "var(--brand-soft)" : "#fff",
        color: value === v ? "var(--brand)" : "var(--ink)",
        borderRadius: 7,
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer"
      }
    }, l))));
    return /*#__PURE__*/React.createElement("div", {
      onClick: onClose,
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(16,24,40,0.4)",
        display: "grid",
        placeItems: "center",
        padding: 24
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      onClick: e => e.stopPropagation(),
      padding: 0,
      style: {
        width: 440,
        boxShadow: "var(--shadow-pop)",
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 18px",
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 800
      }
    }, "\u7F16\u8F91 ", wc.worker, " \u914D\u7F6E"), /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      style: {
        border: 0,
        background: "transparent",
        cursor: "pointer",
        color: "var(--ink-soft)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "x",
      size: 18
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement(RadioGroup, {
      label: "\u8BA1\u85AA\u65B9\u5F0F",
      value: mode,
      onChange: setMode,
      opts: [["piece", "计件"], ["time", "计时"]]
    }), mode === "time" && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)",
        marginBottom: 5
      }
    }, "\u65E5\u5DE5\u8D44\uFF08\u5143/\u5929\uFF09"), /*#__PURE__*/React.createElement("input", {
      style: inp,
      value: daily,
      onChange: e => setDaily(e.target.value)
    })), mode === "piece" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(RadioGroup, {
      label: "\u623F\u79DF\u8865\u8D34",
      value: rent,
      onChange: setRent,
      opts: [["default", "班组默认"], ["on", "开启"], ["off", "关闭"]]
    }), /*#__PURE__*/React.createElement(RadioGroup, {
      label: "\u7BA1\u7406\u63D0\u6210",
      value: mgmt,
      onChange: setMgmt,
      opts: [["default", "班组默认"], ["on", "开启"], ["off", "关闭"]]
    }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)",
        marginBottom: 5
      }
    }, "\u53D1\u653E\u6BD4\u4F8B %\uFF08\u7559\u7A7A=\u73ED\u7EC4\u9ED8\u8BA4\uFF09"), /*#__PURE__*/React.createElement("input", {
      style: inp,
      value: ratio,
      onChange: e => setRatio(e.target.value),
      placeholder: "班组默认 " + Math.round(cfg.ratio * 100) + "%"
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "12px 18px",
        borderTop: "1px solid var(--line)",
        display: "flex",
        gap: 8,
        justifyContent: "flex-end"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      onClick: onClose
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check",
      onClick: () => onSave({
        ...wc,
        mode,
        daily: daily ? +daily : undefined,
        rent: rent === "default" ? null : rent === "on" ? true : false,
        mgmt: mgmt === "default" ? null : mgmt === "on" ? true : false,
        ratio: ratio ? +ratio / 100 : null
      })
    }, "\u4FDD\u5B58"))));
  }

  // 班组基本信息编辑弹窗
  function CrewInfoModal({
    crew,
    onSave,
    onClose
  }) {
    const [form, setForm] = React.useState({
      ...crew
    });
    const upd = (k, v) => setForm(f => ({
      ...f,
      [k]: v
    }));
    const inp = {
      border: "1px solid var(--line-strong)",
      borderRadius: 7,
      padding: "8px 10px",
      fontSize: 13,
      background: "#fff",
      width: "100%"
    };
    return /*#__PURE__*/React.createElement("div", {
      onClick: onClose,
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(16,24,40,0.4)",
        display: "grid",
        placeItems: "center",
        padding: 24
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      onClick: e => e.stopPropagation(),
      padding: 0,
      style: {
        width: 460,
        boxShadow: "var(--shadow-pop)",
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 18px",
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 800
      }
    }, "\u7F16\u8F91\u73ED\u7EC4\u57FA\u672C\u4FE1\u606F"), /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      style: {
        border: 0,
        background: "transparent",
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "x",
      size: 18
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 18,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 14
      }
    }, [["name", "班组名称"], ["trade", "工种类型"], ["contact", "负责人"], ["phone", "联系电话"]].map(([k, l]) => /*#__PURE__*/React.createElement("div", {
      key: k
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)",
        marginBottom: 5
      }
    }, l), /*#__PURE__*/React.createElement("input", {
      style: inp,
      value: form[k] || "",
      onChange: e => upd(k, e.target.value)
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        gridColumn: "1/-1"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)",
        marginBottom: 5
      }
    }, "\u5907\u6CE8"), /*#__PURE__*/React.createElement("input", {
      style: inp,
      value: form.note || "",
      onChange: e => upd("note", e.target.value)
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "12px 18px",
        borderTop: "1px solid var(--line)",
        display: "flex",
        gap: 8,
        justifyContent: "flex-end"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      onClick: onClose
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check",
      onClick: () => onSave(form)
    }, "\u4FDD\u5B58"))));
  }

  // 分项编辑弹窗
  function ItemModal({
    item,
    cfg,
    onSave,
    onClose
  }) {
    const [form, setForm] = React.useState({
      ...item
    });
    const upd = (k, v) => setForm(f => ({
      ...f,
      [k]: v
    }));
    const inp = {
      border: "1px solid var(--line-strong)",
      borderRadius: 7,
      padding: "8px 10px",
      fontSize: 13,
      background: "#fff",
      width: "100%"
    };
    return /*#__PURE__*/React.createElement("div", {
      onClick: onClose,
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(16,24,40,0.4)",
        display: "grid",
        placeItems: "center",
        padding: 24
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      onClick: e => e.stopPropagation(),
      padding: 0,
      style: {
        width: 400,
        boxShadow: "var(--shadow-pop)",
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 18px",
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 800
      }
    }, item.name ? "编辑分项" : "新增分项"), /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      style: {
        border: 0,
        background: "transparent",
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "x",
      size: 18
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, [["name", "分项名称"], ["unit", "单位"], ["price", "单价（元）"]].map(([k, l]) => /*#__PURE__*/React.createElement("div", {
      key: k
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)",
        marginBottom: 5
      }
    }, l), /*#__PURE__*/React.createElement("input", {
      style: inp,
      value: form[k] || "",
      onChange: e => upd(k, e.target.value)
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 13,
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      checked: !!form.inRent,
      onChange: e => upd("inRent", e.target.checked)
    }), "\u53C2\u4E0E\u623F\u79DF\u8865\u8D34"), /*#__PURE__*/React.createElement("label", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 13,
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      checked: !!form.inMgmt,
      onChange: e => upd("inMgmt", e.target.checked)
    }), "\u53C2\u4E0E\u7BA1\u7406\u63D0\u6210"))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "12px 18px",
        borderTop: "1px solid var(--line)",
        display: "flex",
        gap: 8,
        justifyContent: "flex-end"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      onClick: onClose
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check",
      onClick: () => onSave(form)
    }, "\u4FDD\u5B58"))));
  }
  function CrewDetailScreen({
    data,
    params,
    navigate
  }) {
    const initCrew = data.crews.find(c => c.id === (params && params.crewId)) || data.crews[0];
    const [crew, setCrew] = React.useState({
      ...initCrew
    });
    const [tab, setTab] = React.useState("workers");
    const [wcList, setWcList] = React.useState([...data.crewConfig.workerConfigs]);
    const [items, setItems] = React.useState([...data.crewConfig.items]);
    const [cfg, setCfg] = React.useState({
      ...data.crewConfig
    });
    const [editingWc, setEditingWc] = React.useState(null);
    const [editingItem, setEditingItem] = React.useState(null);
    const [editingInfo, setEditingInfo] = React.useState(false);
    const th = {
      padding: "9px 14px",
      fontSize: 12,
      fontWeight: 800,
      color: "var(--ink-soft)",
      background: "var(--surface-2)",
      textAlign: "left",
      whiteSpace: "nowrap"
    };
    const td = {
      padding: "9px 14px",
      fontSize: 13
    };
    const inp = {
      border: "1px solid var(--line-strong)",
      borderRadius: 7,
      padding: "6px 8px",
      fontSize: 13,
      fontFamily: "var(--font-mono)",
      background: "#fff"
    };
    const saveWc = updated => {
      setWcList(l => l.map(w => w.worker === updated.worker ? updated : w));
      setEditingWc(null);
    };
    const saveItem = updated => {
      if (!updated.name) return;
      setItems(l => {
        const idx = l.findIndex(x => x.name === updated.name);
        return idx >= 0 ? l.map((x, i) => i === idx ? updated : x) : [...l, updated];
      });
      setEditingItem(null);
    };
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "var(--ink-soft)"
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => navigate("crew"),
      style: {
        border: 0,
        background: "transparent",
        cursor: "pointer",
        color: "var(--brand)",
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: 4
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "chevron-left",
      size: 14
    }), "\u73ED\u7EC4\u7BA1\u7406"), /*#__PURE__*/React.createElement("span", null, "/"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--ink)",
        fontWeight: 700
      }
    }, crew.name)), /*#__PURE__*/React.createElement(Panel, {
      padding: 18
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 52,
        height: 52,
        borderRadius: 12,
        background: "var(--brand)",
        color: "#fff",
        fontWeight: 800,
        fontSize: 22,
        display: "grid",
        placeItems: "center",
        flex: "none"
      }
    }, crew.name.slice(0, 1)), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 20,
        fontWeight: 800
      }
    }, crew.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: "var(--ink-soft)",
        marginTop: 4
      }
    }, crew.trade, " \xB7 \u8D1F\u8D23\u4EBA ", crew.contact, " \xB7 ", crew.phone)), /*#__PURE__*/React.createElement(Button, {
      icon: "square-pen",
      onClick: () => setEditingInfo(true)
    }, "\u7F16\u8F91"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(StageTab, {
      label: "\u5DE5\u4EBA\u914D\u7F6E",
      active: tab === "workers",
      onClick: () => setTab("workers")
    }), /*#__PURE__*/React.createElement(StageTab, {
      label: "\u5206\u9879\u5355\u4EF7",
      active: tab === "items",
      onClick: () => setTab("items")
    }), /*#__PURE__*/React.createElement(StageTab, {
      label: "\u8865\u8D34 & \u6BD4\u4F8B",
      active: tab === "params",
      onClick: () => setTab("params")
    })), tab === "workers" && /*#__PURE__*/React.createElement(Panel, {
      padding: 0,
      style: {
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        overflow: "auto"
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: "100%",
        borderCollapse: "collapse",
        minWidth: 640
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
      style: th
    }, "\u5DE5\u4EBA"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "\u8BA1\u85AA\u65B9\u5F0F"), /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        textAlign: "center"
      }
    }, "\u623F\u79DF\u8865\u8D34"), /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        textAlign: "center"
      }
    }, "\u7BA1\u7406\u63D0\u6210"), /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        textAlign: "right"
      }
    }, "\u53D1\u653E\u6BD4\u4F8B"), /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        textAlign: "center"
      }
    }, "\u64CD\u4F5C"))), /*#__PURE__*/React.createElement("tbody", null, wcList.map((wc, i) => {
      const rentLabel = wc.rent === null ? "班组默认" : wc.rent === false ? "关闭" : "开启";
      const mgmtLabel = wc.mgmt === null ? "班组默认" : wc.mgmt === false ? "关闭" : "开启";
      const rentTone = wc.rent === null ? "neutral" : wc.rent === false ? "neutral" : "ok";
      const mgmtTone = wc.mgmt === null ? "neutral" : wc.mgmt === false ? "neutral" : "ok";
      return /*#__PURE__*/React.createElement("tr", {
        key: i,
        style: {
          borderBottom: "1px solid var(--line)"
        }
      }, /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          fontWeight: 700
        }
      }, wc.worker, wc.role && /*#__PURE__*/React.createElement(StatusChip, {
        tone: "brand",
        style: {
          marginLeft: 6,
          fontSize: 10
        }
      }, wc.role), wc.linked && /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          color: "var(--ink-faint)",
          marginLeft: 6
        }
      }, "\u2194 ", wc.linked)), /*#__PURE__*/React.createElement("td", {
        style: td
      }, /*#__PURE__*/React.createElement(StatusChip, {
        tone: wc.mode === "piece" ? "brand" : "neutral"
      }, wc.mode === "piece" ? "计件" : "计时"), wc.daily && /*#__PURE__*/React.createElement("span", {
        style: {
          marginLeft: 8,
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          color: "var(--ink-soft)"
        }
      }, wc.daily, "\u5143/\u5929")), /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          textAlign: "center"
        }
      }, /*#__PURE__*/React.createElement(StatusChip, {
        tone: rentTone
      }, rentLabel)), /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          textAlign: "center"
        }
      }, /*#__PURE__*/React.createElement(StatusChip, {
        tone: mgmtTone
      }, mgmtLabel)), /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          fontWeight: wc.ratio != null ? 700 : 400,
          color: wc.ratio != null ? "var(--ink)" : "var(--ink-faint)"
        }
      }, wc.ratio != null ? Math.round(wc.ratio * 100) + "%" : "班组默认"), /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          textAlign: "center"
        }
      }, /*#__PURE__*/React.createElement("button", {
        onClick: () => setEditingWc(wc),
        style: {
          border: "1px solid var(--line)",
          borderRadius: 6,
          padding: "4px 12px",
          fontSize: 12,
          cursor: "pointer",
          background: "#fff",
          color: "var(--brand)",
          fontWeight: 600
        }
      }, "\u7F16\u8F91")));
    }))))), tab === "items" && /*#__PURE__*/React.createElement(Panel, {
      padding: 0,
      style: {
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        padding: "10px 14px",
        borderBottom: "1px solid var(--line)",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("select", {
      style: {
        border: "1px solid var(--line-strong)",
        borderRadius: 8,
        padding: "7px 10px",
        fontSize: 13,
        background: "#fff"
      }
    }, /*#__PURE__*/React.createElement("option", null, cfg.project)), /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: "auto",
        display: "flex",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      icon: "plus",
      onClick: () => setEditingItem({
        name: "",
        unit: "㎡",
        price: "",
        inRent: true,
        inMgmt: true
      })
    }, "\u6DFB\u52A0\u5206\u9879"))), /*#__PURE__*/React.createElement("table", {
      style: {
        width: "100%",
        borderCollapse: "collapse"
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, ["分项名称", "单位", "单价（元）", "房租补贴", "管理提成", "操作"].map((h, i) => /*#__PURE__*/React.createElement("th", {
      key: h,
      style: {
        ...th,
        textAlign: i >= 2 ? "right" : "left"
      }
    }, h)))), /*#__PURE__*/React.createElement("tbody", null, items.map((it, i) => /*#__PURE__*/React.createElement("tr", {
      key: i,
      style: {
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontWeight: 600
      }
    }, it.name), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        color: "var(--ink-soft)"
      }
    }, it.unit), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        fontWeight: 700
      }
    }, it.price), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: "right"
      }
    }, /*#__PURE__*/React.createElement(StatusChip, {
      tone: it.inRent ? "ok" : "neutral"
    }, it.inRent ? "✓" : "—")), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: "right"
      }
    }, /*#__PURE__*/React.createElement(StatusChip, {
      tone: it.inMgmt ? "ok" : "neutral"
    }, it.inMgmt ? "✓" : "—")), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: "right"
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setEditingItem(it),
      style: {
        border: "1px solid var(--line)",
        borderRadius: 6,
        padding: "4px 12px",
        fontSize: 12,
        cursor: "pointer",
        background: "#fff",
        color: "var(--brand)",
        fontWeight: 600
      }
    }, "\u7F16\u8F91"))))))), tab === "params" && /*#__PURE__*/React.createElement(Panel, {
      padding: 18,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 18
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(3,1fr)",
        gap: 16
      }
    }, [{
      key: "rentEnabled",
      priceKey: "rentPrice",
      label: "房租补贴",
      unit: "元/㎡"
    }, {
      key: "mgmtEnabled",
      priceKey: "mgmtPrice",
      label: "管理提成",
      unit: "元/㎡"
    }].map(b => /*#__PURE__*/React.createElement("div", {
      key: b.key,
      style: {
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14,
        fontWeight: 700
      }
    }, b.label), /*#__PURE__*/React.createElement("label", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      checked: !!cfg[b.key],
      onChange: e => setCfg(c => ({
        ...c,
        [b.key]: e.target.checked
      }))
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        color: cfg[b.key] ? "var(--ok)" : "var(--ink-soft)"
      }
    }, cfg[b.key] ? "启用" : "关闭"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "baseline",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("input", {
      value: cfg[b.priceKey],
      onChange: e => setCfg(c => ({
        ...c,
        [b.priceKey]: e.target.value
      })),
      style: {
        width: 72,
        border: "1px solid var(--line-strong)",
        borderRadius: 6,
        padding: "6px 8px",
        fontFamily: "var(--font-mono)",
        fontSize: 14
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)"
      }
    }, b.unit)))), /*#__PURE__*/React.createElement("div", {
      style: {
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 700,
        marginBottom: 12
      }
    }, "\u9ED8\u8BA4\u53D1\u653E\u6BD4\u4F8B"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "baseline",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("input", {
      value: Math.round(cfg.ratio * 100),
      onChange: e => setCfg(c => ({
        ...c,
        ratio: +e.target.value / 100
      })),
      style: {
        width: 72,
        border: "1px solid var(--line-strong)",
        borderRadius: 6,
        padding: "6px 8px",
        fontFamily: "var(--font-mono)",
        fontSize: 14
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)"
      }
    }, "%")), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--ink-faint)",
        marginTop: 8
      }
    }, "\u5DE5\u4EBA\u914D\u7F6E\u4E2D\u53EF\u5355\u72EC\u8986\u76D6"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "flex-end"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check"
    }, "\u4FDD\u5B58\u53C2\u6570"))), editingInfo && /*#__PURE__*/React.createElement(CrewInfoModal, {
      crew: crew,
      onSave: c => {
        setCrew(c);
        setEditingInfo(false);
      },
      onClose: () => setEditingInfo(false)
    }), editingWc && /*#__PURE__*/React.createElement(WorkerConfigModal, {
      wc: editingWc,
      cfg: cfg,
      onSave: saveWc,
      onClose: () => setEditingWc(null)
    }), editingItem && /*#__PURE__*/React.createElement(ItemModal, {
      item: editingItem,
      cfg: cfg,
      onSave: saveItem,
      onClose: () => setEditingItem(null)
    }));
  }
  window.CrewDetailScreen = CrewDetailScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/CrewDetailScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/CrewScreen.jsx
try { (() => {
// CrewScreen — 班组列表（点击行进入详情）
(function () {
  const {
    Button,
    Panel,
    StatusChip
  } = window.DesignSystem_e3d871;
  function CrewScreen({
    data,
    navigate
  }) {
    const Toolbar = window.KitToolbar;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Toolbar, {
      title: "\u73ED\u7EC4\u7BA1\u7406",
      count: data.crews.length,
      unit: "\u4E2A",
      searchPh: "\u641C\u7D22\u73ED\u7EC4\u540D\u3001\u8D1F\u8D23\u4EBA\u2026",
      extra: /*#__PURE__*/React.createElement(Button, {
        icon: "plus",
        variant: "primary"
      }, "\u65B0\u5EFA\u73ED\u7EC4")
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))",
        gap: 12
      }
    }, data.crews.map(c => /*#__PURE__*/React.createElement("button", {
      key: c.id,
      onClick: () => navigate("crewDetail", {
        crewId: c.id
      }),
      style: {
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 0,
        background: "var(--panel)",
        cursor: "pointer",
        textAlign: "left",
        transition: "box-shadow 0.15s"
      },
      onMouseEnter: e => e.currentTarget.style.boxShadow = "var(--shadow-pop)",
      onMouseLeave: e => e.currentTarget.style.boxShadow = "none"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "16px 18px",
        borderBottom: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 40,
        height: 40,
        borderRadius: 10,
        background: "var(--brand-soft)",
        color: "var(--brand)",
        fontWeight: 800,
        fontSize: 16,
        display: "grid",
        placeItems: "center",
        flex: "none"
      }
    }, c.name.slice(0, 1)), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 800
      }
    }, c.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)",
        marginTop: 2
      }
    }, c.trade, " \xB7 \u8D1F\u8D23\u4EBA ", c.contact)), /*#__PURE__*/React.createElement(StatusChip, {
      tone: "brand"
    }, c.workerCount, " \u4EBA")), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "12px 18px",
        display: "flex",
        gap: 24
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--ink-faint)"
      }
    }, "\u8054\u7CFB\u7535\u8BDD"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontFamily: "var(--font-mono)",
        marginTop: 3
      }
    }, c.phone)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--ink-faint)"
      }
    }, "\u5173\u8054\u9879\u76EE"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        marginTop: 3
      }
    }, c.projectCount, " \u4E2A")), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--ink-faint)"
      }
    }, "\u5907\u6CE8"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        marginTop: 3,
        color: c.note ? "var(--ink)" : "var(--ink-faint)"
      }
    }, c.note || "—")))))));
  }
  window.CrewScreen = CrewScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/CrewScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/DeliveryScreen.jsx
try { (() => {
// DeliveryScreen — 送货单整理：OCR 警告条 + 上传区 + 分区标签栏 + 文件卡片网格 + 操作栏。
(function () {
  const {
    Button,
    Panel,
    StatusChip,
    Icon,
    IconButton
  } = window.DesignSystem_e3d871;
  function ocrChip(s) {
    if (s === "done") return /*#__PURE__*/React.createElement(StatusChip, {
      tone: "ok"
    }, "\u8BC6\u522B\u5B8C\u6210");
    if (s === "review") return /*#__PURE__*/React.createElement(StatusChip, {
      tone: "warn"
    }, "\u5F85\u590D\u6838");
    return /*#__PURE__*/React.createElement(StatusChip, {
      tone: "neutral"
    }, "\u5F85\u8BC6\u522B");
  }
  function FileCard({
    f
  }) {
    return /*#__PURE__*/React.createElement(Panel, {
      padding: 0,
      style: {
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        height: 120,
        background: "var(--surface-sink)",
        display: "grid",
        placeItems: "center",
        borderBottom: "1px solid var(--line)",
        position: "relative"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--brand)",
        fontSize: 28,
        fontWeight: 800,
        opacity: .55
      }
    }, "\u5355"), /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        top: 8,
        right: 8
      }
    }, ocrChip(f.ocr))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        fontSize: 13,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, f.name), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: f.conflict ? "var(--warn-ink)" : "var(--ink-soft)"
      }
    }, f.conflict && /*#__PURE__*/React.createElement(Icon, {
      name: "triangle-alert",
      size: 13,
      color: "var(--warn)"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, f.company)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 12,
        fontSize: 12,
        color: "var(--ink-soft)",
        fontFamily: "var(--font-mono)"
      }
    }, /*#__PURE__*/React.createElement("span", null, f.date), /*#__PURE__*/React.createElement("span", null, "No.", f.no)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)"
      }
    }, f.material), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginTop: 4,
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: "var(--ink-faint)"
      }
    }, "\u5206\u533A"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: "var(--brand)",
        background: "var(--brand-soft)",
        padding: "2px 8px",
        borderRadius: 999
      }
    }, f.partition), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        display: "inline-flex",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      icon: "scan-text",
      title: "\u8BC6\u522B"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "zoom-in",
      title: "\u653E\u5927"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "trash-2",
      tone: "danger",
      title: "\u5220\u9664"
    })))));
  }
  function DeliveryScreen({
    data
  }) {
    const [partition, setPartition] = React.useState("all");
    const files = data.deliveryFiles;
    const partitions = ["all", ...Array.from(new Set(files.map(f => f.partition)))];
    const visible = partition === "all" ? files : files.filter(f => f.partition === partition);
    const todo = files.filter(f => f.ocr !== "done").length;
    const problems = files.filter(f => f.conflict || f.ocr === "review").length;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 12,
        border: "1px solid var(--warn)",
        background: "var(--warn-soft)",
        color: "var(--warn-ink)",
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "triangle-alert",
      size: 16,
      color: "var(--warn)"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 700
      }
    }, "OCR \u672A\u914D\u7F6E\u6216\u65E0\u6CD5\u8FDE\u63A5"), /*#__PURE__*/React.createElement("span", null, "\xB7 \u8BF7\u5728\u8BBE\u7F6E\u4E2D\u586B\u5199 PaddleOCR-VL \u670D\u52A1\u5730\u5740"), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "\u53BB\u914D\u7F6E"))), /*#__PURE__*/React.createElement("div", {
      style: {
        border: "1.5px dashed var(--line-strong)",
        borderRadius: 12,
        background: "var(--panel)",
        padding: "20px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        color: "var(--ink-soft)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "folder-open",
      size: 22,
      color: "var(--brand)"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        color: "var(--ink)"
      }
    }, "\u62D6\u62FD\u5DE5\u5730\u6587\u4EF6\u5939\u5230\u6B64\u5904"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12
      }
    }, "\u6309\u5DE5\u5730 \u2192 \u5206\u4F9B\u65B9 \u2192 \u6587\u4EF6\u81EA\u52A8\u6574\u7406\u6210\u6811\u72B6\u7ED3\u6784")), /*#__PURE__*/React.createElement(Button, {
      icon: "upload"
    }, "\u9009\u62E9\u6587\u4EF6\u5939")), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "sticky",
        top: "var(--header-h)",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "8px 12px",
        boxShadow: "var(--shadow-card)"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "scan-text"
    }, "\u8BC6\u522B\u5168\u90E8(", todo, ")"), /*#__PURE__*/React.createElement(Button, {
      icon: "file-search"
    }, "\u91CD\u65B0\u6574\u7406"), problems > 0 && /*#__PURE__*/React.createElement(Button, {
      icon: "triangle-alert"
    }, "\u95EE\u9898(", problems, ")"), /*#__PURE__*/React.createElement(Button, {
      icon: "filter"
    }, "\u53EA\u770B\u672A\u5B8C\u5584"), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      icon: "download"
    }, "\u5BFC\u51FA\u5F52\u6863"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        flexWrap: "wrap"
      }
    }, partitions.map(pt => {
      const on = partition === pt;
      const n = pt === "all" ? files.length : files.filter(f => f.partition === pt).length;
      return /*#__PURE__*/React.createElement("button", {
        key: pt,
        onClick: () => setPartition(pt),
        style: {
          display: "inline-flex",
          gap: 6,
          alignItems: "center",
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid",
          borderColor: on ? "var(--brand)" : "var(--line)",
          background: on ? "var(--brand-soft)" : "#fff",
          color: on ? "var(--brand)" : "var(--ink)",
          fontWeight: 700,
          fontSize: 13,
          cursor: "pointer"
        }
      }, pt === "all" ? "全部工地" : pt, /*#__PURE__*/React.createElement("span", {
        style: {
          opacity: .7
        }
      }, n));
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
        gap: 14
      }
    }, visible.map(f => /*#__PURE__*/React.createElement(FileCard, {
      key: f.id,
      f: f
    }))), /*#__PURE__*/React.createElement("details", {
      style: {
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "12px 14px"
      }
    }, /*#__PURE__*/React.createElement("summary", {
      style: {
        cursor: "pointer",
        fontWeight: 600,
        color: "var(--brand)"
      }
    }, "\u4F7F\u7528\u8BF4\u660E / \u6CE8\u610F\u4E8B\u9879"), /*#__PURE__*/React.createElement("ul", {
      style: {
        marginTop: 10,
        paddingLeft: 18,
        color: "var(--ink)",
        lineHeight: 1.8,
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "\u516C\u53F8\u540D\u79F0\u4EE5\u7EA2\u7AE0\u4E3A\u51C6"), "\uFF1AOCR \u9884\u586B\u540E\u8BF7\u6309\u7EA2\u7AE0\u6838\u5BF9\uFF0C\u53EF\u624B\u52A8\u8986\u76D6\u3002"), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "\u5206\u533A \uFF1D \u5DE5\u5730"), "\uFF1A\u6BCF\u4E2A\u5DE5\u5730\u4E00\u4E2A Excel\uFF1B\u7528\u6587\u4EF6\u5361\u4E0A\u7684\"\u5206\u533A\"\u79FB\u52A8\u5F52\u5C5E\u3002"), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "\u5BFC\u51FA\u5F52\u6863"), "\uFF1A\u6BCF\u4E2A\u5206\u533A\u4E00\u4E2A\u5B50\u6587\u4EF6\u5939\uFF0C\u5185\u542B\u6309\u516C\u53F8\u547D\u540D\u7684 PDF + \u6C47\u603B Excel\u3002"))));
  }
  window.DeliveryScreen = DeliveryScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/DeliveryScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/InvoiceScreen.jsx
try { (() => {
// InvoiceScreen — 发票管理（首页）：四阶段 sticky tab + 状态/校对/待入账/已入账。
(function () {
  const {
    StageTab,
    Button,
    StatCard,
    FilterPill,
    StatusChip,
    IconButton,
    Field,
    Panel,
    Icon
  } = window.DesignSystem_e3d871;
  function statusOf(inv) {
    if (inv.status === "todo") return {
      tone: "neutral",
      text: "待识别"
    };
    if (inv.status === "dup") return {
      tone: "danger",
      text: "重复已排除"
    };
    if (inv.review) return {
      tone: "warn",
      text: "待人工校对"
    };
    if (inv.status === "done") return {
      tone: "ok",
      text: "识别完成"
    };
    return {
      tone: "neutral",
      text: "待识别"
    };
  }
  const money = v => v ? "¥" + Number(v).toLocaleString("zh-CN", {
    minimumFractionDigits: 2
  }) : "待补";

  // 缩略图占位：无真实扫描件时显示单字方块（与原应用一致）
  function Thumb({
    w = 28,
    h = 36,
    char = "票"
  }) {
    return /*#__PURE__*/React.createElement("span", {
      style: {
        width: w,
        height: h,
        borderRadius: 4,
        border: "1px solid var(--line)",
        background: "var(--surface-3)",
        display: "grid",
        placeItems: "center",
        flex: "none",
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--brand)",
        fontSize: 11,
        fontWeight: 800
      }
    }, char));
  }

  // A4 打印位：faux 扫描发票（白纸 + 抬头线 + 红章），仅作排版预览占位
  function PrintSlot({
    seq,
    inv,
    selected,
    onClick
  }) {
    const st = statusOf(inv);
    return /*#__PURE__*/React.createElement("div", {
      onClick: onClick,
      style: {
        position: "relative",
        aspectRatio: "0.72",
        background: "#fff",
        border: selected ? "2px solid var(--brand)" : "1px solid var(--line)",
        borderRadius: 6,
        boxShadow: selected ? "0 0 0 2px rgba(37,99,235,.22)" : "var(--shadow-card)",
        cursor: "pointer",
        overflow: "hidden",
        padding: "14px 12px"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        top: 6,
        left: 6,
        background: "var(--ink)",
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        padding: "1px 5px",
        borderRadius: 4
      }
    }, String(seq).padStart(2, "0")), inv.review && /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        top: 6,
        right: 6,
        background: "var(--warn-soft)",
        color: "var(--warn-ink)",
        fontSize: 10,
        fontWeight: 700,
        padding: "1px 6px",
        borderRadius: 999
      }
    }, "\u5F85\u590D\u6838"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 14,
        fontSize: 9,
        fontWeight: 800,
        color: "var(--ink)",
        textAlign: "center",
        letterSpacing: ".05em"
      }
    }, inv.type !== "—" ? inv.type : "增值税发票"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 8,
        display: "flex",
        flexDirection: "column",
        gap: 4
      }
    }, [70, 90, 55, 80].map((wd, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        height: 3,
        width: wd + "%",
        background: "var(--surface-3)",
        borderRadius: 2
      }
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        fontFamily: "var(--font-mono)",
        fontSize: 8,
        color: "var(--ink-soft)"
      }
    }, inv.number ? inv.number.slice(-8) : "—"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 4,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 800,
        color: "var(--ink)"
      }
    }, money(inv.total)), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        bottom: 10,
        right: 10,
        width: 34,
        height: 34,
        borderRadius: "50%",
        border: "1.5px solid rgba(220,38,38,.55)",
        display: "grid",
        placeItems: "center",
        transform: "rotate(-12deg)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 7,
        color: "rgba(220,38,38,.7)",
        fontWeight: 700,
        textAlign: "center",
        lineHeight: 1.1
      }
    }, "\u53D1\u7968", /*#__PURE__*/React.createElement("br", null), "\u4E13\u7528\u7AE0")));
  }
  function InvoiceScreen({
    data
  }) {
    const [stage, setStage] = React.useState("status");
    const [statusFilter, setStatusFilter] = React.useState("all");
    const [buyerFilter, setBuyerFilter] = React.useState("全部");
    const [selId, setSelId] = React.useState(null);
    const [perPage, setPerPage] = React.useState(2);
    const [ppOpen, setPpOpen] = React.useState(false);
    const [moreOpen, setMoreOpen] = React.useState(false);
    const invoices = data.invoices;
    const recognized = invoices.filter(i => i.status === "done");
    const pending = recognized.filter(i => i.account === "pending");
    const posted = recognized.filter(i => i.account === "posted");
    const todoCount = invoices.filter(i => i.status === "todo").length;
    const dupCount = invoices.filter(i => i.status === "dup").length;
    const sel = recognized.find(i => i.id === selId) || recognized[0];
    const statusFilters = [{
      key: "all",
      label: "全部",
      count: invoices.length
    }, {
      key: "review",
      label: "待人工校对",
      count: invoices.filter(i => i.review).length
    }, {
      key: "done",
      label: "识别完成",
      count: invoices.filter(i => i.status === "done" && !i.review).length
    }, {
      key: "todo",
      label: "待识别",
      count: todoCount
    }, {
      key: "dup",
      label: "重复/历史",
      count: dupCount
    }];
    const buyers = ["全部", ...Array.from(new Set(invoices.filter(i => i.buyer).map(i => i.buyer)))];
    const docTypes = ["全部", "增值税专用发票", "增值税普通发票"];
    const visible = invoices.filter(inv => {
      if (statusFilter === "review") return inv.review;
      if (statusFilter === "done") return inv.status === "done" && !inv.review;
      if (statusFilter === "todo") return inv.status === "todo";
      if (statusFilter === "dup") return inv.status === "dup";
      return true;
    }).filter(inv => buyerFilter === "全部" || inv.buyer === buyerFilter);
    const stageTabs = [{
      key: "status",
      label: "文档识别状态",
      count: invoices.length
    }, {
      key: "review",
      label: "发票识别与校对",
      count: recognized.length
    }, {
      key: "pending",
      label: "待入账",
      count: pending.length
    }, {
      key: "posted",
      label: "已入账",
      count: posted.length
    }];
    const pendingTotal = money(pending.reduce((s, i) => s + Number(i.total || 0), 0));
    function openReview(inv) {
      setSelId(inv.id);
      setStage("review");
    }
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "sticky",
        top: "var(--header-h)",
        zIndex: 10,
        background: "var(--bg)",
        margin: "0 -16px",
        padding: "4px 16px 8px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        flex: 1,
        minWidth: 0,
        overflowX: "auto"
      }
    }, stageTabs.map(t => /*#__PURE__*/React.createElement(StageTab, {
      key: t.key,
      label: t.label,
      count: t.count,
      active: stage === t.key,
      onClick: () => setStage(t.key)
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        position: "relative"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "scan-text",
      disabled: !todoCount
    }, "\u6279\u91CF\u8BC6\u522B"), /*#__PURE__*/React.createElement(IconButton, {
      icon: "ellipsis",
      size: 34,
      title: "\u66F4\u591A",
      onClick: () => setMoreOpen(!moreOpen)
    }), moreOpen && /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        right: 0,
        top: "100%",
        marginTop: 4,
        minWidth: 140,
        background: "#fff",
        border: "1px solid var(--line-strong)",
        borderRadius: 8,
        boxShadow: "var(--shadow-pop)",
        padding: 4,
        zIndex: 20
      },
      onClick: () => setMoreOpen(false)
    }, /*#__PURE__*/React.createElement("button", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 10px",
        fontSize: 13,
        border: 0,
        background: "transparent",
        borderRadius: 6,
        textAlign: "left",
        color: "var(--ink)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "trash-2",
      size: 16,
      color: "var(--danger)"
    }), "\u6E05\u7A7A\u5217\u8868"))))), stage === "status" && /*#__PURE__*/React.createElement(StatusStage, {
      invoices,
      todoCount,
      pending,
      posted,
      statusFilters,
      statusFilter,
      setStatusFilter,
      buyers,
      buyerFilter,
      setBuyerFilter,
      docTypes,
      visible,
      statusOf,
      openReview,
      Thumb,
      setStage
    }), stage === "review" && /*#__PURE__*/React.createElement(ReviewStage, {
      recognized,
      pending,
      sel,
      setSelId,
      statusOf,
      perPage,
      setPerPage,
      ppOpen,
      setPpOpen,
      money,
      Thumb,
      PrintSlot
    }), stage === "pending" && /*#__PURE__*/React.createElement(PendingStage, {
      pending,
      pendingTotal,
      statusOf,
      money,
      Thumb
    }), stage === "posted" && /*#__PURE__*/React.createElement(PostedStage, {
      posted,
      money,
      Thumb
    }));
  }

  // ——— 状态阶段 ———
  function StatusStage(p) {
    const {
      invoices,
      todoCount,
      pending,
      posted,
      statusFilters,
      statusFilter,
      setStatusFilter,
      buyers,
      buyerFilter,
      setBuyerFilter,
      docTypes,
      visible,
      statusOf,
      openReview,
      Thumb,
      setStage
    } = p;
    const th = {
      padding: "12px 16px",
      fontSize: 12,
      fontWeight: 800,
      color: "var(--ink-soft)",
      letterSpacing: ".02em",
      textAlign: "left"
    };
    const td = {
      padding: "12px 16px",
      fontSize: 13,
      verticalAlign: "middle"
    };
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(4,1fr)",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement(StatCard, {
      label: "\u5168\u90E8",
      value: invoices.length
    }), /*#__PURE__*/React.createElement(StatCard, {
      label: "\u5F85\u8BC6\u522B",
      value: todoCount,
      tone: "warn"
    }), /*#__PURE__*/React.createElement(StatCard, {
      label: "\u5F85\u5165\u8D26",
      value: pending.length,
      tone: "ok",
      clickable: true,
      onClick: () => setStage("pending")
    }), /*#__PURE__*/React.createElement(StatCard, {
      label: "\u5DF2\u5165\u8D26",
      value: posted.length,
      tone: "ok",
      clickable: true,
      onClick: () => setStage("posted")
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        border: "1.5px dashed var(--line-strong)",
        borderRadius: 12,
        background: "var(--panel)",
        padding: "18px 20px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        color: "var(--ink-soft)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "upload",
      size: 22,
      color: "var(--brand)"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        color: "var(--ink)"
      }
    }, "\u62D6\u62FD PDF / \u56FE\u7247 / \u6587\u4EF6\u5939\u5230\u6B64\u5904\u4E0A\u4F20"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12
      }
    }, "\u6216\u70B9\u51FB\u9009\u62E9\u6587\u4EF6\uFF0C\u4E0A\u4F20\u540E\u8FDB\u5165\u6587\u6863\u8BC6\u522B\u72B6\u6001")), /*#__PURE__*/React.createElement(Button, {
      icon: "folder-open"
    }, "\u9009\u62E9\u6587\u4EF6\u5939")), /*#__PURE__*/React.createElement(Panel, {
      padding: 0,
      style: {
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 16,
        borderBottom: "1px solid var(--line)",
        background: "var(--surface-2)",
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative",
        width: 260
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        left: 10,
        top: "50%",
        transform: "translateY(-50%)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "search",
      size: 14,
      color: "var(--ink-faint)"
    })), /*#__PURE__*/React.createElement("input", {
      placeholder: "\u641C\u7D22\u6587\u4EF6\u540D\u3001\u516C\u53F8\u2026",
      style: {
        width: "100%",
        border: "1px solid var(--line-strong)",
        borderRadius: 999,
        padding: "7px 12px 7px 30px",
        fontSize: 13,
        background: "#fff"
      }
    })), /*#__PURE__*/React.createElement(FilterRow, {
      label: "\u5904\u7406\u72B6\u6001"
    }, statusFilters.map(s => /*#__PURE__*/React.createElement(FilterPill, {
      key: s.key,
      label: s.label,
      count: s.count,
      active: statusFilter === s.key,
      onClick: () => setStatusFilter(s.key)
    }))), /*#__PURE__*/React.createElement(FilterRow, {
      label: "\u8D2D\u4E70\u65B9"
    }, buyers.map(b => /*#__PURE__*/React.createElement(FilterPill, {
      key: b,
      label: b === "全部" ? "全部" : b.replace("广州市", "").slice(0, 8),
      active: buyerFilter === b,
      onClick: () => setBuyerFilter(b)
    }))), /*#__PURE__*/React.createElement(FilterRow, {
      label: "\u7968\u636E\u7C7B\u578B"
    }, docTypes.map(t => /*#__PURE__*/React.createElement(FilterPill, {
      key: t,
      label: t,
      active: t === "全部"
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        overflowX: "auto"
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: "100%",
        minWidth: 880,
        borderCollapse: "collapse"
      }
    }, /*#__PURE__*/React.createElement("thead", {
      style: {
        background: "var(--surface-2)"
      }
    }, /*#__PURE__*/React.createElement("tr", {
      style: {
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("th", {
      style: th
    }, "#"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "\u6587\u4EF6\u540D"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "\u7C7B\u578B"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "\u5E8F\u53F7"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "\u5927\u5C0F/\u9875\u6570"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "\u72B6\u6001"), /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        textAlign: "right"
      }
    }, "\u64CD\u4F5C"))), /*#__PURE__*/React.createElement("tbody", null, visible.map((inv, i) => {
      const st = statusOf(inv);
      return /*#__PURE__*/React.createElement("tr", {
        key: inv.id,
        style: {
          borderBottom: "1px solid var(--line)",
          cursor: "pointer"
        },
        onClick: () => openReview(inv)
      }, /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          color: "var(--ink-soft)"
        }
      }, i + 1), /*#__PURE__*/React.createElement("td", {
        style: td
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 700,
          maxWidth: 240,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }
      }, inv.name)), /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          color: "var(--ink-soft)"
        }
      }, inv.type), /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          fontFamily: "var(--font-mono)",
          color: "var(--ink-soft)"
        }
      }, String(i + 1).padStart(2, "0")), /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          color: "var(--ink-soft)"
        }
      }, inv.size, " / ", inv.pages, " \u9875"), /*#__PURE__*/React.createElement("td", {
        style: td
      }, /*#__PURE__*/React.createElement(StatusChip, {
        tone: st.tone
      }, st.text)), /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          textAlign: "right",
          whiteSpace: "nowrap"
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          display: "inline-flex",
          gap: 6
        },
        onClick: e => e.stopPropagation()
      }, /*#__PURE__*/React.createElement(IconButton, {
        icon: "file-search",
        title: "\u67E5\u770B\u6821\u5BF9",
        onClick: () => openReview(inv)
      }), /*#__PURE__*/React.createElement(IconButton, {
        icon: "trash-2",
        tone: "danger",
        title: "\u5220\u9664"
      }))));
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "12px 16px",
        borderTop: "1px solid var(--line)",
        background: "var(--surface-2)",
        display: "flex",
        justifyContent: "space-between",
        fontSize: 12,
        color: "var(--ink-soft)"
      }
    }, /*#__PURE__*/React.createElement("span", null, "\u663E\u793A ", visible.length, " \u4E2A\u6587\u6863\uFF0C\u5171 ", invoices.length, " \u4E2A"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(StatusChip, {
      tone: "danger"
    }, invoices.filter(i => i.status === "dup").length, " \u5F20\u91CD\u590D")))));
  }
  function FilterRow({
    label,
    children
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 700,
        color: "var(--ink-soft)",
        width: 56,
        flex: "none"
      }
    }, label), children);
  }

  // ——— 校对阶段（三栏） ———
  function ReviewStage(p) {
    const {
      recognized,
      pending,
      sel,
      setSelId,
      statusOf,
      perPage,
      setPerPage,
      ppOpen,
      setPpOpen,
      money,
      Thumb,
      PrintSlot
    } = p;
    const cols = perPage === 1 ? 1 : 2;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "300px minmax(360px,1fr) minmax(380px,.95fr)",
        gap: 16,
        height: "calc(100vh - 200px)",
        minHeight: 560
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      padding: 0,
      style: {
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "10px 12px",
        borderBottom: "1px solid var(--line)",
        background: "var(--surface-2)",
        fontSize: 12,
        color: "var(--ink-soft)",
        fontWeight: 700
      }
    }, "\u672C\u6279\u6B21 ", recognized.length, " \u5F20 \xB7 ", /*#__PURE__*/React.createElement("b", {
      style: {
        color: "var(--brand)"
      }
    }, "\u5F85\u5165\u8D26 ", pending.length)), /*#__PURE__*/React.createElement("div", {
      style: {
        overflowY: "auto"
      }
    }, recognized.map(inv => {
      const st = statusOf(inv);
      const on = sel && sel.id === inv.id;
      return /*#__PURE__*/React.createElement("button", {
        key: inv.id,
        onClick: () => setSelId(inv.id),
        style: {
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "10px 12px",
          border: 0,
          borderBottom: "1px solid var(--line)",
          background: on ? "var(--brand-soft)" : "transparent",
          textAlign: "left",
          cursor: "pointer"
        }
      }, /*#__PURE__*/React.createElement(Thumb, null), /*#__PURE__*/React.createElement("span", {
        style: {
          minWidth: 0,
          flex: 1
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          display: "block",
          fontSize: 13,
          fontWeight: 700,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }
      }, inv.number ? inv.number.slice(-8) : inv.name), /*#__PURE__*/React.createElement("span", {
        style: {
          display: "block",
          fontSize: 12,
          color: "var(--ink-soft)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }
      }, inv.seller || inv.buyer)), /*#__PURE__*/React.createElement(StatusChip, {
        tone: st.tone
      }, st.text));
    }))), /*#__PURE__*/React.createElement(Panel, {
      padding: 0,
      style: {
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-sink)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "sticky",
        top: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px",
        background: "var(--surface-sink)",
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 800
      }
    }, "\u6253\u5370\u6392\u7248"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--ink-soft)"
      }
    }, "\u5355\u51FB\u9009\u4E2D \xB7 \u53CC\u51FB\u653E\u5927 \xB7 \u53F3\u952E\u65CB\u8F6C")), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      iconRight: "chevron-down",
      onClick: () => setPpOpen(!ppOpen)
    }, perPage, " \u5F20/\u9875"), ppOpen && /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        right: 0,
        top: "100%",
        marginTop: 4,
        background: "#fff",
        border: "1px solid var(--line-strong)",
        borderRadius: 8,
        boxShadow: "var(--shadow-pop)",
        padding: 4,
        zIndex: 5
      },
      onClick: () => setPpOpen(false)
    }, [1, 2, 4].map(n => /*#__PURE__*/React.createElement("button", {
      key: n,
      onClick: () => setPerPage(n),
      style: {
        display: "block",
        width: 90,
        padding: "6px 10px",
        fontSize: 13,
        border: 0,
        background: n === perPage ? "var(--brand-soft)" : "transparent",
        color: n === perPage ? "var(--brand)" : "var(--ink)",
        borderRadius: 6,
        textAlign: "left",
        cursor: "pointer"
      }
    }, n, " \u5F20/\u9875"))))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        overflowY: "auto",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 14
      }
    }, [0, 1].map(page => /*#__PURE__*/React.createElement("div", {
      key: page,
      style: {
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 8,
        boxShadow: "var(--shadow-card)",
        aspectRatio: "1/1.414",
        padding: 16,
        display: "grid",
        gridTemplateColumns: `repeat(${cols},1fr)`,
        gridAutoRows: "min-content",
        gap: 14,
        alignContent: "start"
      }
    }, recognized.slice(page * perPage, page * perPage + perPage).map((inv, idx) => /*#__PURE__*/React.createElement(PrintSlot, {
      key: inv.id,
      seq: page * perPage + idx + 1,
      inv: inv,
      selected: sel && sel.id === inv.id,
      onClick: () => setSelId(inv.id)
    })))))), sel ? /*#__PURE__*/React.createElement(ReviewForm, {
      sel: sel,
      statusOf: statusOf
    }) : /*#__PURE__*/React.createElement(Panel, {
      style: {
        display: "grid",
        placeItems: "center",
        color: "var(--ink-soft)"
      }
    }, "\u9009\u62E9\u4E00\u5F20\u53D1\u7968\u5F00\u59CB\u6821\u5BF9\u3002"));
  }
  function ReviewForm({
    sel,
    statusOf
  }) {
    const st = statusOf(sel);
    const [f, setF] = React.useState(sel);
    React.useEffect(() => setF(sel), [sel.id]);
    const upd = k => e => setF({
      ...f,
      [k]: e.target.value
    });
    return /*#__PURE__*/React.createElement(Panel, {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 16,
        overflowY: "auto"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("h2", {
      style: {
        margin: 0,
        fontSize: 16,
        fontWeight: 800
      }
    }, "\u8BC6\u522B\u7ED3\u679C\u63D0\u53D6"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(StatusChip, {
      tone: st.tone
    }, st.text), sel.account === "posted" && /*#__PURE__*/React.createElement(StatusChip, {
      tone: "ok"
    }, "\u5DF2\u5165\u8D26"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement(Field, {
      label: "\u5355\u636E\u7F16\u53F7",
      mono: true,
      value: f.number,
      onChange: upd("number")
    }), /*#__PURE__*/React.createElement(Field, {
      label: "\u5F00\u7968\u65E5\u671F",
      mono: true,
      value: f.date,
      onChange: upd("date"),
      placeholder: "2026-06-15"
    }), /*#__PURE__*/React.createElement(Field, {
      label: "\u8D2D\u4E70\u65B9",
      value: f.buyer,
      onChange: upd("buyer")
    }), /*#__PURE__*/React.createElement(Field, {
      label: "\u4F9B\u5E94\u5546",
      value: f.seller,
      onChange: upd("seller")
    }), /*#__PURE__*/React.createElement(Field, {
      label: "\u7968\u636E\u7C7B\u578B",
      value: f.type,
      onChange: upd("type")
    }), /*#__PURE__*/React.createElement(Field, {
      label: "\u91D1\u989D",
      mono: true,
      value: f.total,
      onChange: upd("total")
    }), /*#__PURE__*/React.createElement(Field, {
      label: "\u5BF9\u5E94\u9879\u76EE",
      colSpan: 2,
      value: f.project,
      onChange: upd("project")
    }), /*#__PURE__*/React.createElement(Field, {
      label: "\u7A0E\u989D",
      mono: true,
      value: f.tax,
      onChange: upd("tax")
    }), /*#__PURE__*/React.createElement(Field, {
      label: "\u7A0E\u70B9",
      mono: true,
      value: f.rate,
      onChange: upd("rate")
    }), /*#__PURE__*/React.createElement(Field, {
      label: "\u7968\u9762\u5907\u6CE8",
      colSpan: 2,
      value: f.remark,
      onChange: upd("remark"),
      placeholder: "\u53D1\u7968\u5907\u6CE8\u680F\u5185\u5BB9"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: "auto",
        paddingTop: 12,
        borderTop: "1px solid var(--line)",
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "danger"
    }, "\u5E9F\u5F03\u8BE5\u5355\u636E"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Button, null, "\u91CD\u65B0\u8BC6\u522B"), sel.account === "posted" ? /*#__PURE__*/React.createElement(Button, null, "\u79FB\u56DE\u5F85\u5165\u8D26") : /*#__PURE__*/React.createElement(Button, {
      variant: "primary"
    }, "\u786E\u8BA4\u5E76\u5165\u8D26"))));
  }

  // ——— 待入账阶段 ———
  function PendingStage({
    pending,
    pendingTotal,
    statusOf,
    money,
    Thumb
  }) {
    const th = {
      padding: "12px 16px",
      fontSize: 12,
      fontWeight: 800,
      color: "var(--ink-soft)",
      textAlign: "left"
    };
    const td = {
      padding: "12px 16px",
      fontSize: 13
    };
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        color: "var(--ink-soft)"
      }
    }, "\u5408\u8BA1 ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--ink)",
        fontSize: 18,
        fontWeight: 800,
        fontFamily: "var(--font-mono)"
      }
    }, pendingTotal)), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "file-check"
    }, "\u6279\u91CF\u5165\u8D26")), /*#__PURE__*/React.createElement(Panel, {
      padding: 0,
      style: {
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        overflowX: "auto"
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: "100%",
        minWidth: 1080,
        borderCollapse: "collapse"
      }
    }, /*#__PURE__*/React.createElement("thead", {
      style: {
        background: "var(--surface-2)"
      }
    }, /*#__PURE__*/React.createElement("tr", {
      style: {
        borderBottom: "1px solid var(--line)"
      }
    }, ["缩略", "单据编号", "开票日期", "购买方", "供应商", "类型", "金额", "对应项目", "操作"].map((h, i) => /*#__PURE__*/React.createElement("th", {
      key: i,
      style: {
        ...th,
        textAlign: i === 6 || i === 8 ? "right" : "left"
      }
    }, h)))), /*#__PURE__*/React.createElement("tbody", null, pending.map(inv => /*#__PURE__*/React.createElement("tr", {
      key: inv.id,
      style: {
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement(Thumb, {
      w: 40,
      h: 52
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontFamily: "var(--font-mono)",
        fontWeight: 700
      }
    }, inv.number.slice(-8)), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontFamily: "var(--font-mono)",
        color: "var(--ink-soft)"
      }
    }, inv.date), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        maxWidth: 180,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, inv.buyer), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        maxWidth: 200,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, inv.seller), /*#__PURE__*/React.createElement("td", {
      style: td
    }, inv.type), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        fontWeight: 800
      }
    }, money(inv.total)), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        color: "var(--ink-soft)"
      }
    }, inv.project), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: "right",
        whiteSpace: "nowrap"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      icon: "square-pen",
      title: "\u7F16\u8F91"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "file-check",
      title: "\u5165\u8D26"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "trash-2",
      tone: "danger",
      title: "\u5220\u9664"
    }))))))))));
  }

  // ——— 已入账阶段 ———
  function PostedStage({
    posted,
    money,
    Thumb
  }) {
    const th = {
      padding: "12px 16px",
      fontSize: 12,
      fontWeight: 800,
      color: "var(--ink-soft)",
      textAlign: "left"
    };
    const td = {
      padding: "12px 16px",
      fontSize: 13
    };
    return /*#__PURE__*/React.createElement(Panel, {
      padding: 0,
      style: {
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        overflowX: "auto"
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: "100%",
        minWidth: 1160,
        borderCollapse: "collapse"
      }
    }, /*#__PURE__*/React.createElement("thead", {
      style: {
        background: "var(--surface-2)"
      }
    }, /*#__PURE__*/React.createElement("tr", {
      style: {
        borderBottom: "1px solid var(--line)"
      }
    }, ["缩略", "单据编号", "开票日期", "购买方", "供应商", "金额", "对应项目", "入账时间", "操作"].map((h, i) => /*#__PURE__*/React.createElement("th", {
      key: i,
      style: {
        ...th,
        textAlign: i === 5 || i === 8 ? "right" : "left"
      }
    }, h)))), /*#__PURE__*/React.createElement("tbody", null, posted.map(inv => /*#__PURE__*/React.createElement("tr", {
      key: inv.id,
      style: {
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement(Thumb, {
      w: 40,
      h: 52
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontFamily: "var(--font-mono)",
        fontWeight: 700
      }
    }, inv.number.slice(-8)), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontFamily: "var(--font-mono)",
        color: "var(--ink-soft)"
      }
    }, inv.date), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        maxWidth: 180,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, inv.buyer), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        maxWidth: 200,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, inv.seller), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        fontWeight: 800
      }
    }, money(inv.total)), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        color: "var(--ink-soft)"
      }
    }, inv.project), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        color: "var(--ink-soft)",
        fontFamily: "var(--font-mono)",
        fontSize: 12
      }
    }, inv.accountedAt), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: "right",
        whiteSpace: "nowrap"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      icon: "square-pen",
      title: "\u7F16\u8F91"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "file-output",
      title: "\u79FB\u56DE\u5F85\u5165\u8D26"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "trash-2",
      tone: "danger",
      title: "\u5220\u9664"
    })))))))));
  }
  window.InvoiceScreen = InvoiceScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/InvoiceScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/PayrollDetailScreen.jsx
try { (() => {
// PayrollDetailScreen — 个人工资明细子页（墙砖计算式 + 取整基数 + 瀑布）
(function () {
  const {
    Button,
    Panel,
    StatusChip,
    Icon
  } = window.DesignSystem_e3d871;
  const yuan = n => "¥" + Math.round(n).toLocaleString("zh-CN");
  function PayrollDetailScreen({
    data,
    params,
    navigate
  }) {
    const d = data.payroll.detail;
    const worker = params && params.worker || d.worker;
    const crew = params && params.crew || data.payroll.crew;
    const project = params && params.project || data.payroll.project;
    const [expandCalc, setExpandCalc] = React.useState(false);
    const eng = d.lines.reduce((s, l) => s + l.price * l.qty, 0);
    const deduct = d.deductItems.reduce((s, x) => s + x.amt, 0);
    const gross = eng + d.rent + d.mgmt;
    const period = Math.round(gross * d.ratio);
    const net = Math.round(period - d.prevPaid - deduct);
    const steps = [{
      label: "工程金额",
      val: eng,
      op: "",
      note: "Σ 各分项工程量 × 单价"
    }, {
      label: "房租补贴",
      val: d.rent,
      op: "+",
      note: "选定分项工程量合计 × 补贴单价"
    }, {
      label: "管理提成",
      val: d.mgmt,
      op: "+",
      note: "选定分项工程量合计 × 管理单价"
    }, {
      label: "应发总额",
      val: gross,
      op: "=",
      strong: true
    }, {
      label: "发放比例 " + Math.round(d.ratio * 100) + "%",
      val: period,
      op: "×",
      note: "本期应发 = 应发总额 × 比例"
    }, {
      label: "累计已发",
      val: -d.prevPaid,
      op: "−",
      note: "之前月份累计发放"
    }, {
      label: "罚款/扣款",
      val: -deduct,
      op: "−",
      note: d.deductItems.map(x => x.reason).join("、")
    }, {
      label: "实发金额（取整）",
      val: net,
      op: "=",
      strong: true,
      accent: true
    }];
    const back = () => navigate("payroll", {
      project,
      crew
    });
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "var(--ink-soft)"
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: back,
      style: {
        border: 0,
        background: "transparent",
        cursor: "pointer",
        color: "var(--brand)",
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: 4
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "chevron-left",
      size: 14
    }), "\u5DE5\u8D44\u7BA1\u7406"), /*#__PURE__*/React.createElement("span", null, "/"), /*#__PURE__*/React.createElement("span", null, project), /*#__PURE__*/React.createElement("span", null, "/"), /*#__PURE__*/React.createElement("span", null, crew), /*#__PURE__*/React.createElement("span", null, "/"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--ink)",
        fontWeight: 700
      }
    }, worker), d.partner && worker === d.worker && /*#__PURE__*/React.createElement(StatusChip, {
      tone: "brand"
    }, "\u592B\u59BB\u5173\u8054 ", d.partner, "\uFF08\u72EC\u7ACB\u6838\u7B97\uFF09")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--brand-soft)",
        border: "1px solid rgba(37,99,235,0.2)",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 12
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "info",
      size: 14,
      color: "var(--brand)"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--brand)",
        fontWeight: 600
      }
    }, d.roundNote)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        alignItems: "start"
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      padding: 0,
      style: {
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "14px 16px",
        borderBottom: "1px solid var(--line)",
        fontSize: 14,
        fontWeight: 800
      }
    }, "\u5206\u9879\u5DE5\u7A0B\u91D1\u989D\u660E\u7EC6"), /*#__PURE__*/React.createElement("table", {
      style: {
        width: "100%",
        borderCollapse: "collapse"
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, ["分项", "单位", "单价", "暂定量", "金额"].map((h, i) => /*#__PURE__*/React.createElement("th", {
      key: h,
      style: {
        padding: "8px 12px",
        fontSize: 11,
        fontWeight: 800,
        color: "var(--ink-soft)",
        background: "var(--surface-2)",
        textAlign: i >= 2 ? "right" : "left"
      }
    }, h)))), /*#__PURE__*/React.createElement("tbody", null, d.lines.map((l, li) => /*#__PURE__*/React.createElement(React.Fragment, {
      key: li
    }, /*#__PURE__*/React.createElement("tr", {
      style: {
        borderTop: "1px solid var(--line)",
        background: l.calc ? "var(--surface-2)" : "transparent"
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "9px 12px",
        fontSize: 13,
        fontWeight: 600
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6
      }
    }, l.name, l.calc && /*#__PURE__*/React.createElement("button", {
      onClick: () => setExpandCalc(v => !v),
      style: {
        border: "1px solid var(--line)",
        borderRadius: 4,
        padding: "1px 6px",
        fontSize: 10,
        cursor: "pointer",
        background: "#fff",
        color: "var(--brand)"
      }
    }, expandCalc ? "收起" : "展开计算式"))), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "9px 12px",
        fontSize: 13,
        color: "var(--ink-soft)"
      }
    }, l.unit), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "9px 12px",
        fontSize: 13,
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        color: "var(--ink-soft)"
      }
    }, l.price), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "9px 12px",
        fontSize: 13,
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        fontWeight: 700
      }
    }, l.qty), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "9px 12px",
        fontSize: 13,
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        color: "var(--brand)"
      }
    }, yuan(l.price * l.qty))), l.calc && expandCalc && l.calc.map((row, ri) => /*#__PURE__*/React.createElement("tr", {
      key: ri,
      style: {
        borderTop: "1px dashed var(--line)",
        background: "#fafbff"
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "6px 12px 6px 24px",
        fontSize: 12,
        color: "var(--ink-soft)"
      }
    }, row.summary ? /*#__PURE__*/React.createElement("span", {
      style: {
        fontStyle: "italic"
      }
    }, row.room) : row.room), /*#__PURE__*/React.createElement("td", {
      colSpan: 2,
      style: {
        padding: "6px 12px",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--ink-soft)"
      }
    }, row.expr && /*#__PURE__*/React.createElement("span", null, row.expr)), /*#__PURE__*/React.createElement("td", {
      colSpan: 2,
      style: {
        padding: "6px 12px",
        fontSize: 12,
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        color: row.val != null ? "var(--ink)" : "var(--ink-faint)",
        fontStyle: row.summary ? "italic" : "normal"
      }
    }, row.val != null ? row.val + " " + d.lines[0].unit : ""))))), /*#__PURE__*/React.createElement("tr", {
      style: {
        borderTop: "2px solid var(--line-strong)"
      }
    }, /*#__PURE__*/React.createElement("td", {
      colSpan: 4,
      style: {
        padding: "10px 12px",
        fontSize: 13,
        fontWeight: 800
      }
    }, "\u5DE5\u7A0B\u91D1\u989D\u5408\u8BA1"), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "10px 12px",
        fontSize: 15,
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        fontWeight: 800,
        color: "var(--brand)"
      }
    }, yuan(eng))))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "12px 16px",
        borderTop: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 800,
        color: "var(--ink-soft)",
        marginBottom: 8
      }
    }, "\u6263\u6B3E\u660E\u7EC6"), d.deductItems.map((x, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        justifyContent: "space-between",
        fontSize: 13,
        marginBottom: 4
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--danger)"
      }
    }, x.reason), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        color: "var(--danger)"
      }
    }, "\u2212", yuan(x.amt)))))), /*#__PURE__*/React.createElement(Panel, {
      padding: 16
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 800,
        marginBottom: 14
      }
    }, "\u8BA1\u7B97\u6D41\u7A0B"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 4
      }
    }, steps.map((s, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: s.strong ? "10px 12px" : "7px 10px",
        borderRadius: 8,
        background: s.accent ? "var(--brand-soft)" : s.strong ? "var(--surface-2)" : "transparent",
        border: s.accent ? "1px solid var(--brand)" : "1px solid transparent"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 20,
        textAlign: "center",
        fontSize: 15,
        fontWeight: 800,
        color: s.op === "−" ? "var(--danger)" : s.op === "=" ? "var(--ink)" : "var(--ink-soft)",
        fontFamily: "var(--font-mono)"
      }
    }, s.op), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: s.strong ? 14 : 13,
        fontWeight: s.strong ? 800 : 600
      }
    }, s.label), s.note && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--ink-faint)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, s.note)), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: s.accent ? 18 : s.strong ? 15 : 13,
        fontWeight: s.strong ? 800 : 600,
        fontFamily: "var(--font-mono)",
        color: s.accent ? "var(--brand)" : s.val < 0 ? "var(--danger)" : "var(--ink)"
      }
    }, s.val < 0 ? "−" + yuan(-s.val) : yuan(s.val))))))));
  }
  window.PayrollDetailScreen = PayrollDetailScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/PayrollDetailScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/PayrollScreen.jsx
try { (() => {
// PayrollScreen — 工资管理三层钻取：项目 → 班组 → 工资总表（含矩阵 Tab）
(function () {
  const {
    Button,
    Panel,
    StatusChip,
    StatCard,
    StageTab,
    Icon
  } = window.DesignSystem_e3d871;
  const yuan = n => "¥" + Math.round(n).toLocaleString("zh-CN");
  function PayrollScreen({
    data,
    navigate
  }) {
    // 内部三层状态
    const [selProject, setSelProject] = React.useState(null);
    const [selCrew, setSelCrew] = React.useState(null);
    const [tab, setTab] = React.useState("table");
    const back = () => {
      if (selCrew) setSelCrew(null);else setSelProject(null);
    };

    // ── Level 0: 项目卡片 ──
    if (!selProject) return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: "var(--ink-soft)"
      }
    }, "\u9009\u62E9\u9879\u76EE \u2192 \u67E5\u770B\u73ED\u7EC4 \u2192 \u8FDB\u5165\u5DE5\u8D44\u603B\u8868"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
        gap: 12
      }
    }, data.projects.map(p => {
      const crews = data.projectCrews[p.name] || [];
      const total = crews.reduce((s, c) => s + c.net, 0);
      const hasAny = crews.some(c => c.hasData);
      return /*#__PURE__*/React.createElement("button", {
        key: p.id,
        onClick: () => {
          setSelProject(p.name);
          setSelCrew(null);
        },
        style: {
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: 0,
          background: "var(--panel)",
          cursor: "pointer",
          textAlign: "left"
        },
        onMouseEnter: e => e.currentTarget.style.boxShadow = "var(--shadow-pop)",
        onMouseLeave: e => e.currentTarget.style.boxShadow = "none"
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          padding: "16px 18px 12px"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 16,
          fontWeight: 800
        }
      }, p.name), /*#__PURE__*/React.createElement(StatusChip, {
        tone: p.status === "在建" ? "ok" : p.status === "收尾" ? "warn" : "neutral"
      }, p.status)), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 12,
          color: "var(--ink-soft)",
          marginTop: 4
        }
      }, p.address)), /*#__PURE__*/React.createElement("div", {
        style: {
          padding: "10px 18px 14px",
          borderTop: "1px solid var(--line)",
          display: "flex",
          gap: 20
        }
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          color: "var(--ink-faint)"
        }
      }, "\u53C2\u4E0E\u73ED\u7EC4"), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 16,
          fontWeight: 800,
          marginTop: 2
        }
      }, crews.length)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          color: "var(--ink-faint)"
        }
      }, "\u672C\u671F\u5B9E\u53D1"), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 16,
          fontWeight: 800,
          marginTop: 2,
          color: hasAny ? "var(--brand)" : "var(--ink-faint)"
        }
      }, hasAny ? yuan(total) : "—"))));
    })));

    // ── Level 1: 班组列表 ──
    const crews = data.projectCrews[selProject] || [];
    if (!selCrew) return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Breadcrumb, {
      items: [{
        label: "工资管理",
        onClick: back
      }, {
        label: selProject
      }]
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
        gap: 12
      }
    }, crews.map((c, i) => /*#__PURE__*/React.createElement("button", {
      key: i,
      onClick: () => {
        if (c.hasData) setSelCrew(c.crew);
      },
      style: {
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "16px 18px",
        background: "var(--panel)",
        cursor: c.hasData ? "pointer" : "not-allowed",
        textAlign: "left",
        opacity: c.hasData ? 1 : 0.55
      },
      onMouseEnter: e => c.hasData && (e.currentTarget.style.boxShadow = "var(--shadow-pop)"),
      onMouseLeave: e => e.currentTarget.style.boxShadow = "none"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 36,
        height: 36,
        borderRadius: 9,
        background: "var(--brand-soft)",
        color: "var(--brand)",
        fontWeight: 800,
        display: "grid",
        placeItems: "center"
      }
    }, c.crew.slice(0, 1)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 800
      }
    }, c.crew), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)"
      }
    }, c.trade, " \xB7 ", c.workers, "\u4EBA"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)"
      }
    }, "\u672C\u671F\u5B9E\u53D1"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 18,
        fontWeight: 800,
        fontFamily: "var(--font-mono)",
        color: c.hasData ? "var(--brand)" : "var(--ink-faint)"
      }
    }, c.hasData ? yuan(c.net) : "暂无数据"))))));

    // ── Level 2: 工资总表（含矩阵 Tab）──
    const p = data.payroll;
    const compute = r => {
      if (r.mode === "time") {
        const g = r.days * r.daily;
        return {
          gross: g,
          period: g,
          net: Math.round(g - r.deduct)
        };
      }
      const gross = r.engineering + r.rent + r.mgmt;
      const period = Math.round(gross * r.ratio);
      return {
        gross,
        period,
        net: Math.round(period - p.prevPaid - r.deduct)
      };
    };
    const th = {
      padding: "9px 12px",
      fontSize: 12,
      fontWeight: 800,
      color: "var(--ink-soft)",
      background: "var(--surface-2)",
      position: "sticky",
      top: 0
    };
    const td = {
      padding: "9px 12px",
      fontSize: 13
    };
    const num = {
      ...td,
      textAlign: "right",
      fontFamily: "var(--font-mono)"
    };
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Breadcrumb, {
      items: [{
        label: "工资管理",
        onClick: () => {
          setSelProject(null);
          setSelCrew(null);
        }
      }, {
        label: selProject,
        onClick: () => setSelCrew(null)
      }, {
        label: selCrew
      }]
    }), /*#__PURE__*/React.createElement(Panel, {
      padding: 14
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 800,
        color: "var(--ink-soft)",
        marginBottom: 10
      }
    }, "\u53D1\u653E\u6BD4\u4F8B \xB7 \u968F\u5B8C\u5DE5\u8FDB\u5EA6\u9012\u589E"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 0
      }
    }, p.ratioSchedule.map((s, i) => /*#__PURE__*/React.createElement(React.Fragment, {
      key: s.m
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 48,
        height: 48,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        margin: "0 auto",
        fontSize: 13,
        fontWeight: 800,
        fontFamily: "var(--font-mono)",
        border: "2px solid",
        borderColor: s.current ? "var(--brand)" : "var(--line-strong)",
        background: s.current ? "var(--brand)" : "#fff",
        color: s.current ? "#fff" : "var(--ink-soft)"
      }
    }, s.r), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        marginTop: 4,
        color: s.current ? "var(--brand)" : "var(--ink-soft)",
        fontWeight: s.current ? 800 : 600
      }
    }, s.m)), i < p.ratioSchedule.length - 1 && /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        height: 2,
        background: "var(--line)",
        marginBottom: 18
      }
    }))))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(StageTab, {
      label: "\u5DE5\u8D44\u603B\u8868",
      active: tab === "table",
      onClick: () => setTab("table")
    }), /*#__PURE__*/React.createElement(StageTab, {
      label: "\u5DE5\u7A0B\u91CF\u77E9\u9635",
      active: tab === "matrix",
      onClick: () => setTab("matrix")
    })), tab === "table" && /*#__PURE__*/React.createElement(Panel, {
      padding: 8
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        overflow: "auto",
        maxHeight: 440
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: "100%",
        minWidth: 920,
        borderCollapse: "collapse"
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        textAlign: "left"
      }
    }, "\u5DE5\u4EBA"), /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        textAlign: "left"
      }
    }, "\u65B9\u5F0F"), ["工程金额", "补贴", "提成", "应发总额", "比例", "本期应发", "累计已发", "扣款", "实发金额"].map(h => /*#__PURE__*/React.createElement("th", {
      key: h,
      style: {
        ...th,
        textAlign: "right"
      }
    }, h)), /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        textAlign: "center"
      }
    }, "\u5B89\u5168\u6559\u80B2"), /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        textAlign: "center"
      }
    }, "\u64CD\u4F5C"))), /*#__PURE__*/React.createElement("tbody", null, p.rows.map(r => {
      const c = compute(r);
      return /*#__PURE__*/React.createElement("tr", {
        key: r.worker,
        style: {
          borderBottom: "1px solid var(--line)"
        }
      }, /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          fontWeight: 700,
          color: r.mode === "piece" ? "var(--brand)" : "var(--ink)"
        }
      }, r.worker), /*#__PURE__*/React.createElement("td", {
        style: td
      }, r.mode === "piece" ? /*#__PURE__*/React.createElement(StatusChip, {
        tone: "brand"
      }, "\u8BA1\u4EF6") : /*#__PURE__*/React.createElement(StatusChip, {
        tone: "neutral"
      }, "\u8BA1\u65F6")), r.mode === "piece" ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("td", {
        style: num
      }, yuan(r.engineering)), /*#__PURE__*/React.createElement("td", {
        style: num
      }, r.rent ? yuan(r.rent) : "—"), /*#__PURE__*/React.createElement("td", {
        style: num
      }, r.mgmt ? yuan(r.mgmt) : "—"), /*#__PURE__*/React.createElement("td", {
        style: {
          ...num,
          fontWeight: 700
        }
      }, yuan(c.gross)), /*#__PURE__*/React.createElement("td", {
        style: num
      }, Math.round(r.ratio * 100), "%"), /*#__PURE__*/React.createElement("td", {
        style: num
      }, yuan(c.period)), /*#__PURE__*/React.createElement("td", {
        style: {
          ...num,
          color: "var(--ink-soft)"
        }
      }, yuan(r.prevPaid)), /*#__PURE__*/React.createElement("td", {
        style: {
          ...num,
          color: r.deduct ? "var(--danger)" : "var(--ink-faint)"
        }
      }, r.deduct ? "−" + yuan(r.deduct) : "—")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("td", {
        style: {
          ...num,
          color: "var(--ink-soft)"
        },
        colSpan: 5
      }, "\u51FA\u52E4 ", r.days, " \u5929 \xD7 ", yuan(r.daily), "/\u5929"), /*#__PURE__*/React.createElement("td", {
        style: num
      }, yuan(c.period)), /*#__PURE__*/React.createElement("td", {
        style: {
          ...num,
          color: "var(--ink-faint)"
        }
      }, "\u2014"), /*#__PURE__*/React.createElement("td", {
        style: {
          ...num,
          color: "var(--ink-faint)"
        }
      }, "\u2014")), /*#__PURE__*/React.createElement("td", {
        style: {
          ...num,
          fontWeight: 800,
          color: "var(--brand)"
        }
      }, yuan(c.net)), /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          textAlign: "center"
        }
      }, r.safety ? /*#__PURE__*/React.createElement(Icon, {
        name: "shield-check",
        size: 16,
        color: "var(--ok)"
      }) : /*#__PURE__*/React.createElement(StatusChip, {
        tone: "danger"
      }, "\u672A\u5B8C\u6210")), /*#__PURE__*/React.createElement("td", {
        style: {
          ...td,
          textAlign: "center"
        }
      }, r.mode === "piece" && /*#__PURE__*/React.createElement("button", {
        onClick: () => navigate("payrollDetail", {
          worker: r.worker,
          crew: selCrew,
          project: selProject
        }),
        style: {
          border: "1px solid var(--brand)",
          borderRadius: 6,
          padding: "4px 10px",
          fontSize: 12,
          cursor: "pointer",
          background: "var(--brand-soft)",
          color: "var(--brand)",
          fontWeight: 600
        }
      }, "\u660E\u7EC6")));
    }))))), tab === "matrix" && /*#__PURE__*/React.createElement(Panel, {
      padding: 12,
      style: {
        fontSize: 13,
        color: "var(--ink-soft)",
        textAlign: "center",
        padding: 32
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "grid-2x2",
      size: 32,
      color: "var(--ink-faint)"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 12,
        fontWeight: 700
      }
    }, "\u5DE5\u7A0B\u91CF\u77E9\u9635\u89C6\u56FE"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 6,
        fontSize: 12
      }
    }, "\u53EF\u5728\u300C\u5DE5\u7A0B\u91CF\u7BA1\u7406\u300D\u4E3B\u83DC\u5355\u67E5\u770B\u5B8C\u6574\u77E9\u9635\uFF0C\u6216\u70B9\u51FB\u77E9\u9635\u683C\u5B50\u8DF3\u8F6C\u81F3\u6B64\u5DE5\u8D44\u660E\u7EC6\u3002"), /*#__PURE__*/React.createElement("button", {
      onClick: () => navigate("quantity"),
      style: {
        marginTop: 14,
        border: "1px solid var(--brand)",
        borderRadius: 8,
        padding: "9px 20px",
        fontSize: 13,
        cursor: "pointer",
        background: "var(--brand-soft)",
        color: "var(--brand)",
        fontWeight: 700
      }
    }, "\u524D\u5F80\u5DE5\u7A0B\u91CF\u77E9\u9635 \u2192")));
  }
  function Breadcrumb({
    items
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "var(--ink-soft)"
      }
    }, items.map((item, i) => /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, i > 0 && /*#__PURE__*/React.createElement("span", null, "/"), item.onClick ? /*#__PURE__*/React.createElement("button", {
      onClick: item.onClick,
      style: {
        border: 0,
        background: "transparent",
        cursor: "pointer",
        color: "var(--brand)",
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: 4
      }
    }, i === 0 && /*#__PURE__*/React.createElement(window.DesignSystem_e3d871.Icon, {
      name: "chevron-left",
      size: 14
    }), item.label) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--ink)",
        fontWeight: 700
      }
    }, item.label))));
  }
  window.PayrollScreen = PayrollScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/PayrollScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/PriceScreen.jsx
try { (() => {
// PriceScreen — 单价对比：工具栏 + 已剔除折叠 + 横向对比表（最低价绿色 ✓）。
(function () {
  const {
    Button,
    Panel,
    Icon
  } = window.DesignSystem_e3d871;
  const th = {
    padding: "10px 12px",
    fontSize: 12,
    fontWeight: 800,
    color: "var(--ink-soft)",
    background: "var(--surface-2)",
    textAlign: "left",
    position: "sticky",
    top: 0
  };
  const td = {
    padding: "10px 12px",
    fontSize: 13,
    verticalAlign: "middle"
  };
  function PriceScreen({
    data
  }) {
    const {
      priceSuppliers,
      priceRows
    } = data;
    const fmt = c => c.min === c.max ? "" + c.recent : `${c.recent}（${c.min}~${c.max}）`;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      padding: 12,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        fontWeight: 700
      }
    }, "\u6750\u6599\u5355\u4EF7\u5BF9\u6BD4"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)"
      }
    }, "\u5BF9\u6BD4\u5404\u5206\u4F9B\u65B9\u6750\u6599\u5355\u4EF7\uFF0C\u7EFF\u8272\u4E3A\u6700\u4F4E\u4EF7")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement("select", {
      style: {
        width: 160,
        border: "1px solid var(--line-strong)",
        borderRadius: 8,
        padding: "7px 10px",
        fontSize: 13,
        background: "#fff"
      }
    }, /*#__PURE__*/React.createElement("option", null, "\u5168\u90E8\u5DE5\u5730\uFF08\u6C47\u603B\uFF09"), /*#__PURE__*/React.createElement("option", null, "\u5408\u548C\u65B0\u57CE"), /*#__PURE__*/React.createElement("option", null, "\u9526\u7EE3\u534E\u5EAD")), /*#__PURE__*/React.createElement(Button, null, "\u5E76\u7EC4\u6240\u9009"), /*#__PURE__*/React.createElement(Button, {
      icon: "download"
    }, "\u4E0B\u8F7D\u6A21\u677F"), /*#__PURE__*/React.createElement(Button, {
      icon: "upload"
    }, "\u5BFC\u5165\u5386\u53F2"), /*#__PURE__*/React.createElement(Button, {
      icon: "download"
    }, "\u5BFC\u51FA Excel"))), /*#__PURE__*/React.createElement(Panel, {
      padding: 10
    }, /*#__PURE__*/React.createElement("details", null, /*#__PURE__*/React.createElement("summary", {
      style: {
        cursor: "pointer",
        fontSize: 13,
        color: "var(--ink-soft)"
      }
    }, "\u5DF2\u4ECE\u5BF9\u6BD4\u5254\u9664 3 \u7C7B\uFF08\u8FD0\u8D39\u7C7B\u7B49\u4E0D\u53C2\u4E0E\u6700\u4F4E\u4EF7\u5BF9\u6BD4\uFF1B\u9001\u8D27\u5355\u660E\u7EC6 / \u5BFC\u51FA\u4ECD\u4FDD\u7559\uFF09"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 8,
        flexWrap: "wrap"
      }
    }, [["运费", 3], ["搬运费", 1], ["上楼费", 2]].map(([n, c]) => /*#__PURE__*/React.createElement("span", {
      key: n,
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid var(--line)",
        background: "#fff",
        borderRadius: 999,
        padding: "3px 10px",
        fontSize: 12
      }
    }, n, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--ink-soft)"
      }
    }, "\xD7", c), /*#__PURE__*/React.createElement("button", {
      style: {
        border: 0,
        background: "transparent",
        color: "var(--brand)",
        cursor: "pointer",
        fontSize: 12,
        padding: 0
      }
    }, "\u6062\u590D")))))), /*#__PURE__*/React.createElement(Panel, {
      padding: 8
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        overflow: "auto",
        maxHeight: 540
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: "100%",
        minWidth: 820,
        borderCollapse: "collapse"
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        width: 40
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox"
    })), /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        width: 36
      }
    }, "#"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "\u6750\u6599\uFF08\u5F52\u7EC4\uFF09"), /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        width: 56
      }
    }, "\u5355\u4F4D"), priceSuppliers.map(s => /*#__PURE__*/React.createElement("th", {
      key: s,
      style: {
        ...th,
        textAlign: "right"
      }
    }, s)), /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        textAlign: "right"
      }
    }, "\u6700\u4F4E\u4EF7\u4F9B\u5E94\u5546"), /*#__PURE__*/React.createElement("th", {
      style: {
        ...th,
        width: 120,
        textAlign: "right"
      }
    }, "\u64CD\u4F5C"))), /*#__PURE__*/React.createElement("tbody", null, priceRows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
      key: r.key,
      style: {
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox"
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        color: "var(--ink-soft)"
      }
    }, i + 1), /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600
      }
    }, r.name), r.names > 1 && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--ink-soft)"
      }
    }, "\u542B ", r.names, " \u79CD\u5199\u6CD5")), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        color: "var(--ink-soft)"
      }
    }, r.unit), priceSuppliers.map(s => {
      const cell = r.by[s];
      const low = r.lowest === s;
      return /*#__PURE__*/React.createElement("td", {
        key: s,
        style: {
          ...td,
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          color: low ? "var(--ok)" : cell ? "var(--ink)" : "var(--ink-faint)",
          fontWeight: low ? 700 : 400
        }
      }, cell ? fmt(cell) + (low ? " ✓" : "") : "—");
    }), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: "right",
        color: "var(--ok)",
        fontWeight: 600
      }
    }, r.lowest), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: "right"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        gap: 6,
        justifyContent: "flex-end"
      }
    }, r.names > 1 && /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "\u62C6\u5206"), /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "\u6392\u9664"))))))))));
  }
  window.PriceScreen = PriceScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/PriceScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/ProjectScreen.jsx
try { (() => {
// ProjectScreen — 施工项目列表：工具栏 + 表格（项目名蓝链 / 状态 chip）。
(function () {
  const {
    Button,
    IconButton,
    Panel,
    StatusChip
  } = window.DesignSystem_e3d871;
  const statusTone = {
    "在建": "brand",
    "收尾": "warn",
    "停工": "danger",
    "完工": "ok"
  };
  function ProjectScreen({
    data
  }) {
    const Toolbar = window.KitToolbar,
      th = window.KitTH,
      td = window.KitTD;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Toolbar, {
      title: "\u65BD\u5DE5\u9879\u76EE",
      count: data.projects.length,
      unit: "\u4E2A",
      searchPh: "\u641C\u7D22\u9879\u76EE\u540D\u3001\u5730\u5740\u2026",
      extra: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
        icon: "upload"
      }, "\u5BFC\u5165 Excel"), /*#__PURE__*/React.createElement(Button, {
        icon: "download"
      }, "\u5BFC\u51FA Excel"))
    }), /*#__PURE__*/React.createElement(Panel, {
      padding: 8
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        overflow: "auto",
        maxHeight: 560
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: "100%",
        minWidth: 900,
        borderCollapse: "collapse"
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, ["#", "项目名称", "状态", "项目地址", "开工日期", "建设单位", "项目经理", "操作"].map((h, i) => /*#__PURE__*/React.createElement("th", {
      key: i,
      style: th
    }, h)))), /*#__PURE__*/React.createElement("tbody", null, data.projects.map((p, i) => /*#__PURE__*/React.createElement("tr", {
      key: p.id,
      style: {
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        color: "var(--ink-soft)"
      }
    }, i + 1), /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement("button", {
      style: {
        border: 0,
        background: "transparent",
        padding: 0,
        color: "var(--brand)",
        fontWeight: 600,
        cursor: "pointer",
        textAlign: "left"
      }
    }, p.name)), /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement(StatusChip, {
      tone: statusTone[p.status] || "neutral"
    }, p.status)), /*#__PURE__*/React.createElement("td", {
      style: td
    }, p.address), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontFamily: "var(--font-mono)",
        color: "var(--ink-soft)"
      }
    }, p.startDate), /*#__PURE__*/React.createElement("td", {
      style: td
    }, p.developer), /*#__PURE__*/React.createElement("td", {
      style: td
    }, p.manager), /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      icon: "file-text",
      title: "\u8BE6\u60C5"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "square-pen",
      title: "\u7F16\u8F91"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "trash-2",
      tone: "danger",
      title: "\u5220\u9664"
    }))))))))));
  }
  window.ProjectScreen = ProjectScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/ProjectScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/QuantityScreen.jsx
try { (() => {
// QuantityScreen — 工程量矩阵（自定义浮动 tooltip + 丰富弹窗 + 跳工资明细）
(function () {
  const {
    Button,
    Panel,
    Icon,
    StatusChip
  } = window.DesignSystem_e3d871;
  function QuantityScreen({
    data,
    navigate
  }) {
    const mx = data.matrix;
    const [building, setBuilding] = React.useState(mx.buildings[0]);
    const [months, setMonths] = React.useState(mx.months.map(m => m.key));
    const [hlEmpty, setHlEmpty] = React.useState(true);
    const [popup, setPopup] = React.useState(null);
    const [tooltip, setTooltip] = React.useState(null); // {x,y,blk,floor,unit}
    const monthByKey = Object.fromEntries(mx.months.map(m => [m.key, m]));
    const currentMonth = "2025-04";
    const toggleMonth = k => setMonths(ms => ms.includes(k) ? ms.filter(x => x !== k) : [...ms, k]);
    const cfg = data.crewConfig;
    const priceFor = name => (cfg.items.find(it => it.name === name) || {}).price || 0;
    const showTooltip = (e, blk, floor, unit) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltip({
        x: rect.right + 8,
        y: rect.top - 8,
        blk,
        floor,
        unit
      });
    };
    const roomBreakdown = blk => {
      const rooms = blk.item === "墙砖" ? ["客厅", "主卧", "次卧", "卫生间"] : ["客厅", "厨房", "阳台"];
      let rem = blk.qty,
        out = [];
      rooms.forEach((r, i) => {
        const q = i === rooms.length - 1 ? rem : +(blk.qty / rooms.length * (0.8 + 0.4 * ((i + 1) % 2))).toFixed(2);
        rem = +(rem - q).toFixed(2);
        out.push({
          room: r,
          contract: +(q * 1.05).toFixed(2),
          field: q,
          provisional: q
        });
      });
      return out;
    };
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12,
        position: "relative"
      }
    }, tooltip && /*#__PURE__*/React.createElement("div", {
      style: {
        position: "fixed",
        left: tooltip.x,
        top: tooltip.y,
        zIndex: 100,
        width: 260,
        background: "var(--panel)",
        border: "1px solid var(--line-strong)",
        borderRadius: 10,
        boxShadow: "var(--shadow-pop)",
        padding: 14,
        pointerEvents: "none"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 800,
        marginBottom: 8
      }
    }, building, " ", tooltip.floor, " \xB7 ", tooltip.unit), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6
      }
    }, [tooltip.blk].filter(Boolean).map((b, i) => {
      const m = monthByKey[b.month];
      const price = priceFor(b.item + "铺贴");
      const subtotal = +(b.qty * price).toFixed(0);
      return /*#__PURE__*/React.createElement("div", {
        key: i,
        style: {
          background: m.bg,
          borderRadius: 7,
          padding: "8px 10px"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12,
          fontWeight: 800,
          color: m.ink
        }
      }, b.item, "\u94FA\u8D34"), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          color: m.ink
        }
      }, m.label)), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 12,
          color: m.ink
        }
      }, "\u5DE5\u4EBA ", /*#__PURE__*/React.createElement("strong", null, b.worker), b.partner && /*#__PURE__*/React.createElement("span", null, " / ", b.partner)), b.partner && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          color: m.ink,
          opacity: 0.8
        }
      }, "\u592B\u59BB\u5173\u8054\xB7\u5DE5\u7A0B\u91CF\u5404\u81EA\u72EC\u7ACB"), /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          marginTop: 5,
          fontSize: 12
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          color: m.ink
        }
      }, "\u5DE5\u7A0B\u91CF ", /*#__PURE__*/React.createElement("strong", null, b.qty, " \u33A1")), price > 0 && /*#__PURE__*/React.createElement("span", {
        style: {
          color: m.ink
        }
      }, "\u2248 ", /*#__PURE__*/React.createElement("strong", null, "\xA5", subtotal.toLocaleString("zh-CN")))));
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 8,
        fontSize: 11,
        color: "var(--ink-faint)"
      }
    }, "\u70B9\u51FB\u683C\u5B50\u67E5\u770B\u623F\u95F4\u660E\u7EC6")), /*#__PURE__*/React.createElement(Panel, {
      padding: 12,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("select", {
      style: {
        border: "1px solid var(--line-strong)",
        borderRadius: 8,
        padding: "7px 10px",
        fontSize: 13,
        background: "#fff"
      }
    }, /*#__PURE__*/React.createElement("option", null, "\u5408\u548C\u65B0\u57CE \xB7 \u6CE5\u6C34A\u73ED"), /*#__PURE__*/React.createElement("option", null, "\u9526\u7EE3\u534E\u5EAD \xB7 \u6CE5\u6C34B\u73ED")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6
      }
    }, mx.buildings.map(b => /*#__PURE__*/React.createElement("button", {
      key: b,
      onClick: () => setBuilding(b),
      style: {
        border: "1px solid",
        borderColor: building === b ? "var(--brand)" : "var(--line)",
        background: building === b ? "var(--brand)" : "#fff",
        color: building === b ? "#fff" : "var(--ink)",
        borderRadius: 8,
        padding: "7px 16px",
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer"
      }
    }, b))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: "auto",
        display: "flex",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      icon: "upload"
    }, "\u5BFC\u5165\u5DE5\u7A0B\u91CF"))), /*#__PURE__*/React.createElement(Panel, {
      padding: 12,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 800,
        color: "var(--ink-soft)"
      }
    }, "\u6708\u4EFD"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        flexWrap: "wrap"
      }
    }, mx.months.map(m => {
      const on = months.includes(m.key);
      const cur = m.key === currentMonth;
      return /*#__PURE__*/React.createElement("button", {
        key: m.key,
        onClick: () => toggleMonth(m.key),
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          border: "1px solid",
          borderColor: on ? m.dot : "var(--line)",
          background: on ? m.bg : "#fff",
          color: on ? m.ink : "var(--ink-faint)",
          borderRadius: 999,
          padding: "5px 12px",
          fontSize: 13,
          fontWeight: cur ? 800 : 600,
          cursor: "pointer",
          boxShadow: cur && on ? "0 0 0 2px " + m.dot : "none"
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          width: 10,
          height: 10,
          borderRadius: 3,
          background: m.dot,
          display: "inline-block"
        }
      }), m.label);
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: "auto",
        display: "flex",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      checked: hlEmpty,
      onChange: e => setHlEmpty(e.target.checked)
    }), "\u7A81\u51FA\u672A\u65BD\u5DE5"))), /*#__PURE__*/React.createElement(Panel, {
      padding: 10
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        overflow: "auto"
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        borderCollapse: "separate",
        borderSpacing: 0,
        width: "100%",
        minWidth: 640
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
      rowSpan: 2,
      style: {
        position: "sticky",
        left: 0,
        zIndex: 2,
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
        padding: "8px 14px",
        fontSize: 12,
        fontWeight: 800,
        color: "var(--ink-soft)",
        minWidth: 64
      }
    }, "\u697C\u5C42"), mx.units.map(u => /*#__PURE__*/React.createElement("th", {
      key: u,
      style: {
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
        padding: "8px 10px",
        fontSize: 13,
        fontWeight: 800
      }
    }, u))), /*#__PURE__*/React.createElement("tr", null, mx.units.map(u => /*#__PURE__*/React.createElement("th", {
      key: u,
      style: {
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
        padding: "4px 6px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        justifyContent: "center",
        fontSize: 11,
        color: "var(--ink-soft)",
        fontWeight: 700
      }
    }, mx.items.map(it => /*#__PURE__*/React.createElement("span", {
      key: it,
      style: {
        flex: 1
      }
    }, it))))))), /*#__PURE__*/React.createElement("tbody", null, mx.floors.map(f => /*#__PURE__*/React.createElement("tr", {
      key: f
    }, /*#__PURE__*/React.createElement("th", {
      style: {
        position: "sticky",
        left: 0,
        zIndex: 1,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        padding: "0 14px",
        fontSize: 13,
        fontWeight: 800,
        fontFamily: "var(--font-mono)",
        color: "var(--ink)"
      }
    }, f), mx.units.map(u => {
      const blocks = mx.cells[f + "|" + u] || [];
      return /*#__PURE__*/React.createElement("td", {
        key: u,
        style: {
          border: "1px solid var(--line)",
          padding: 0,
          height: 48
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          height: "100%"
        }
      }, mx.items.map((itName, bi) => {
        const blk = blocks.find(b => b.item === itName);
        const visible = blk && months.includes(blk.month);
        const m = blk ? monthByKey[blk.month] : null;
        const empty = !blk;
        const cur = blk && blk.month === currentMonth;
        return /*#__PURE__*/React.createElement("button", {
          key: itName,
          onMouseEnter: e => blk && showTooltip(e, blk, f, u),
          onMouseLeave: () => setTooltip(null),
          onClick: () => blk && setPopup({
            floor: f,
            unit: u,
            blocks
          }),
          style: {
            flex: 1,
            border: 0,
            borderLeft: bi ? "1px solid var(--line)" : 0,
            cursor: blk ? "pointer" : "default",
            background: visible ? m.bg : empty ? hlEmpty ? "repeating-linear-gradient(45deg,#fff,#fff 5px,#fef2f2 5px,#fef2f2 10px)" : "#fff" : "#f3f4f6",
            color: visible ? m.ink : "var(--ink-faint)",
            outline: cur && visible ? "2px solid " + m.dot : "none",
            outlineOffset: -2,
            boxShadow: empty && hlEmpty ? "inset 0 0 0 1px var(--danger)" : "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            fontSize: 12.5,
            fontWeight: 700,
            lineHeight: 1.1
          }
        }, blk ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", null, blk.worker.length > 3 ? blk.worker.slice(0, 2) : blk.worker, blk.partner && /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: 9,
            opacity: 0.7
          }
        }, "\xB7", blk.partner.slice(0, 1)))) : /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: 11,
            color: hlEmpty ? "var(--danger)" : "var(--ink-faint)"
          }
        }, "\u2014"));
      })));
    })))))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 16,
        marginTop: 10,
        fontSize: 12,
        color: "var(--ink-soft)",
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("span", null, "\u56FE\u4F8B\uFF1A"), mx.months.map(m => /*#__PURE__*/React.createElement("span", {
      key: m.key,
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 12,
        height: 12,
        borderRadius: 3,
        background: m.bg,
        border: "1px solid " + m.dot
      }
    }), m.label)), /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 12,
        height: 12,
        borderRadius: 3,
        background: "repeating-linear-gradient(45deg,#fff,#fff 3px,#fef2f2 3px,#fef2f2 6px)",
        border: "1px solid var(--danger)"
      }
    }), "\u672A\u65BD\u5DE5"), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto"
      }
    }, "hover \u67E5\u770B\u5DE5\u4EBA \xB7 \u70B9\u51FB\u67E5\u770B\u623F\u95F4\u660E\u7EC6"))), popup && /*#__PURE__*/React.createElement("div", {
      onClick: () => setPopup(null),
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(16,24,40,0.45)",
        display: "grid",
        placeItems: "center",
        padding: 24
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      onClick: e => e.stopPropagation(),
      padding: 0,
      style: {
        width: 580,
        maxWidth: "100%",
        maxHeight: "88vh",
        overflow: "auto",
        boxShadow: "var(--shadow-pop)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 18px",
        borderBottom: "1px solid var(--line)",
        position: "sticky",
        top: 0,
        background: "var(--panel)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 800
      }
    }, building, " \xB7 ", popup.floor, " \xB7 ", popup.unit, " ", /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)",
        fontWeight: 600
      }
    }, "\u623F\u95F4\u660E\u7EC6")), /*#__PURE__*/React.createElement("button", {
      onClick: () => setPopup(null),
      style: {
        border: 0,
        background: "transparent",
        cursor: "pointer",
        color: "var(--ink-soft)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "x",
      size: 20
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 18
      }
    }, popup.blocks.map(blk => {
      const m = monthByKey[blk.month];
      const price = priceFor(blk.item + "铺贴");
      const subtotal = +(blk.qty * price).toFixed(0);
      const rooms = roomBreakdown(blk);
      const roomTotal = rooms.reduce((s, r) => s + r.provisional, 0);
      return /*#__PURE__*/React.createElement("div", {
        key: blk.item
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 14,
          fontWeight: 800
        }
      }, blk.item, "\u94FA\u8D34"), /*#__PURE__*/React.createElement(StatusChip, {
        tone: "brand"
      }, blk.worker, blk.partner ? "／" + blk.partner : ""), /*#__PURE__*/React.createElement("span", {
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 12,
          color: "var(--ink-soft)"
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          width: 9,
          height: 9,
          borderRadius: 2,
          background: m.dot
        }
      }), m.label), price > 0 && /*#__PURE__*/React.createElement("span", {
        style: {
          marginLeft: "auto",
          fontSize: 13,
          fontWeight: 800,
          color: "var(--brand)"
        }
      }, "\u2248 \xA5", subtotal.toLocaleString("zh-CN"))), blk.partner && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          color: "var(--ink-faint)",
          marginBottom: 8
        }
      }, "\u592B\u59BB\u5173\u8054 \u2014 \u5DE5\u7A0B\u91CF\u4E0E\u5DE5\u8D44\u72EC\u7ACB\u6838\u7B97\uFF0C\u6B64\u5904\u4EC5\u663E\u793A ", blk.worker, " \u5DE5\u7A0B\u91CF"), /*#__PURE__*/React.createElement("table", {
        style: {
          width: "100%",
          borderCollapse: "collapse"
        }
      }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, ["房间", "合同量", "现场量", "暂定量", "小计"].map((h, i) => /*#__PURE__*/React.createElement("th", {
        key: h,
        style: {
          padding: "6px 10px",
          fontSize: 11,
          fontWeight: 800,
          color: "var(--ink-soft)",
          background: "var(--surface-2)",
          textAlign: i ? "right" : "left"
        }
      }, h)))), /*#__PURE__*/React.createElement("tbody", null, rooms.map(r => /*#__PURE__*/React.createElement("tr", {
        key: r.room,
        style: {
          borderBottom: "1px solid var(--line)"
        }
      }, /*#__PURE__*/React.createElement("td", {
        style: {
          padding: "7px 10px",
          fontSize: 13
        }
      }, r.room), /*#__PURE__*/React.createElement("td", {
        style: {
          padding: "7px 10px",
          fontSize: 13,
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          color: "var(--ink-soft)"
        }
      }, r.contract), /*#__PURE__*/React.createElement("td", {
        style: {
          padding: "7px 10px",
          fontSize: 13,
          textAlign: "right",
          fontFamily: "var(--font-mono)"
        }
      }, r.field), /*#__PURE__*/React.createElement("td", {
        style: {
          padding: "7px 10px",
          fontSize: 13,
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          fontWeight: 700
        }
      }, r.provisional), /*#__PURE__*/React.createElement("td", {
        style: {
          padding: "7px 10px",
          fontSize: 13,
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          color: "var(--brand)"
        }
      }, price > 0 ? "¥" + (r.provisional * price).toFixed(0) : "—"))), /*#__PURE__*/React.createElement("tr", {
        style: {
          borderTop: "2px solid var(--line-strong)"
        }
      }, /*#__PURE__*/React.createElement("td", {
        style: {
          padding: "8px 10px",
          fontWeight: 800
        }
      }, "\u5408\u8BA1"), /*#__PURE__*/React.createElement("td", {
        colSpan: 2
      }), /*#__PURE__*/React.createElement("td", {
        style: {
          padding: "8px 10px",
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          fontWeight: 800,
          color: "var(--brand)"
        }
      }, roomTotal.toFixed(2), " \u33A1"), /*#__PURE__*/React.createElement("td", {
        style: {
          padding: "8px 10px",
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          fontWeight: 800,
          color: "var(--brand)"
        }
      }, price > 0 ? "¥" + subtotal.toLocaleString("zh-CN") : "—")))));
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "10px 12px",
        background: "#fef2f2",
        borderRadius: 8,
        fontSize: 12,
        color: "var(--danger)"
      }
    }, "\u6263\u6B3E\u8BB0\u5F55\uFF1A\u7A7A\u9F13\u7F5A\u6B3E \xA5600 \xB7 \u672A\u6536\u5C3E\u6263\u6B3E \xA5600\uFF08\u5DF2\u5728\u5DE5\u8D44\u6838\u7B97\u4E2D\u4F53\u73B0\uFF09"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "flex-end",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      icon: "arrow-right",
      onClick: () => {
        setPopup(null);
        navigate("payrollDetail", {
          worker: popup.blocks[0]?.worker,
          crew: "泥水A班",
          project: "合和新城"
        });
      }
    }, "\u67E5\u770B ", popup.blocks[0]?.worker, " \u5DE5\u8D44\u660E\u7EC6"))))));
  }
  window.QuantityScreen = QuantityScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/QuantityScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/SettingsDialog.jsx
try { (() => {
// SettingsDialog — 云识别（PaddleOCR-VL）设置弹窗。
(function () {
  const {
    Button,
    Field,
    Icon,
    Panel
  } = window.DesignSystem_e3d871;
  function SettingsDialog({
    open,
    onClose
  }) {
    const [cloud, setCloud] = React.useState(true);
    if (!open) return null;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 50
      }
    }, /*#__PURE__*/React.createElement("div", {
      onClick: onClose,
      style: {
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,.4)"
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        top: "10vh",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(640px,94vw)",
        background: "var(--bg)",
        borderRadius: 12,
        boxShadow: "var(--shadow-pop)",
        padding: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 16,
        fontWeight: 700
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "settings",
      size: 20,
      color: "var(--ink-soft)"
    }), "\u8BBE\u7F6E \u2014 \u4E91\u8BC6\u522B\uFF08PaddleOCR-VL\uFF09"), /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      style: {
        marginLeft: "auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "#fff",
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "x",
      size: 16,
      color: "var(--ink-soft)"
    }))), /*#__PURE__*/React.createElement(Panel, {
      padding: 14,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: 12,
        color: "var(--ink-soft)",
        lineHeight: 1.7
      }
    }, "\u624B\u5199\u9001\u8D27\u5355\u8BC6\u522B\u9700\u8981\u4E91\u7AEF\u5927\u6A21\u578B\u3002\u5230 ", /*#__PURE__*/React.createElement("b", {
      style: {
        color: "var(--brand)"
      }
    }, "aistudio.baidu.com/paddleocr/task"), " \u767B\u5F55\u540E\uFF0C\u5728\u300CAPI \u8C03\u7528\u793A\u4F8B\u300D\u91CC\u590D\u5236\u4E0B\u9762\u4E24\u9879\u3002\u586B\u597D\u540E\u6240\u6709\u8BC6\u522B\u81EA\u52A8\u8D70\u4E91\u7AEF\uFF1B\u672A\u586B\u5219\u7528\u672C\u5730\u5C0F\u6A21\u578B\uFF08\u4EC5\u8BC6\u522B\u5370\u5237\u4F53\uFF09\u3002"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, [["cloud", "云识别"], ["local", "本地识别"]].map(([k, l]) => /*#__PURE__*/React.createElement("button", {
      key: k,
      onClick: () => setCloud(k === "cloud"),
      style: {
        flex: 1,
        padding: "10px",
        borderRadius: 8,
        border: "1px solid",
        borderColor: cloud === (k === "cloud") ? "var(--brand)" : "var(--line-strong)",
        background: cloud === (k === "cloud") ? "var(--brand-soft)" : "#fff",
        color: cloud === (k === "cloud") ? "var(--brand)" : "var(--ink)",
        fontWeight: 700,
        fontSize: 13,
        cursor: "pointer"
      }
    }, l))), /*#__PURE__*/React.createElement(Field, {
      label: "API \u5730\u5740\uFF08\u5B98\u65B9\u5F02\u6B65\u63A5\u53E3\uFF0C\u2026/api/v2/ocr/jobs\uFF09",
      value: "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
    }), /*#__PURE__*/React.createElement(Field, {
      label: "\u8BBF\u95EE\u4EE4\u724C Access Token",
      mono: true,
      placeholder: "40 \u4F4D\u5B57\u7B26"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "primary"
    }, "\u4FDD\u5B58"), /*#__PURE__*/React.createElement(Button, null, "\u6D4B\u8BD5\u8FDE\u63A5"), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 12,
        color: cloud ? "var(--ok)" : "var(--ink-soft)"
      }
    }, cloud ? "✓ 已配置：识别将走云端" : "未配置：识别走本地小模型")), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: 11,
        color: "var(--ink-soft)"
      }
    }, "\u4EE4\u724C\u53EA\u4FDD\u5B58\u5728\u672C\u673A\uFF08localStorage\uFF09\uFF0C\u4E0D\u4F1A\u5199\u5165\u6587\u4EF6\u6216\u4E0A\u4F20\uFF1B\u8BC6\u522B\u65F6\u5355\u636E\u56FE\u7247\u4F1A\u53D1\u9001\u5230\u767E\u5EA6\u661F\u6CB3\u5E73\u53F0\u5904\u7406\u3002"))));
  }
  window.SettingsDialog = SettingsDialog;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/SettingsDialog.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/SupplierScreen.jsx
try { (() => {
// SupplierScreen — 分供方列表：工具栏 + 表格（公司全称蓝链 / 操作三图标）。
(function () {
  const {
    Button,
    IconButton,
    Panel,
    Icon
  } = window.DesignSystem_e3d871;
  const th = {
    padding: "11px 14px",
    fontSize: 12,
    fontWeight: 800,
    color: "var(--ink-soft)",
    textAlign: "left",
    background: "var(--surface-2)",
    position: "sticky",
    top: 0
  };
  const td = {
    padding: "11px 14px",
    fontSize: 13,
    verticalAlign: "middle"
  };
  function Toolbar({
    title,
    count,
    unit,
    searchPh,
    extra
  }) {
    return /*#__PURE__*/React.createElement(Panel, {
      padding: 12,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        fontWeight: 700
      }
    }, title, " \xB7 \u5171 ", count, " ", unit), /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: "auto",
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        left: 10,
        top: "50%",
        transform: "translateY(-50%)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "search",
      size: 14,
      color: "var(--ink-faint)"
    })), /*#__PURE__*/React.createElement("input", {
      placeholder: searchPh,
      style: {
        width: 208,
        border: "1px solid var(--line-strong)",
        borderRadius: 8,
        padding: "7px 12px 7px 30px",
        fontSize: 13
      }
    })), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus"
    }, "\u65B0\u589E"), extra));
  }
  function SupplierScreen({
    data
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Toolbar, {
      title: "\u5206\u4F9B\u65B9\u8D44\u6599\u5E93",
      count: data.suppliers.length,
      unit: "\u5BB6",
      searchPh: "\u641C\u7D22\u516C\u53F8\u540D\u3001\u7A0E\u53F7\u2026",
      extra: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, null, "\u4ECE\u53D1\u7968\u6536\u96C6"), /*#__PURE__*/React.createElement(Button, {
        icon: "upload"
      }, "\u5BFC\u5165 Excel"), /*#__PURE__*/React.createElement(Button, {
        icon: "download"
      }, "\u5BFC\u51FA Excel"))
    }), /*#__PURE__*/React.createElement(Panel, {
      padding: 8
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        overflow: "auto",
        maxHeight: 560
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: "100%",
        minWidth: 1080,
        borderCollapse: "collapse"
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, ["#", "公司全称", "简称/别名", "税号", "开户行", "银行账号", "联系人/电话", "备注", "操作"].map((h, i) => /*#__PURE__*/React.createElement("th", {
      key: i,
      style: th
    }, h)))), /*#__PURE__*/React.createElement("tbody", null, data.suppliers.map((s, i) => /*#__PURE__*/React.createElement("tr", {
      key: s.id,
      style: {
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        color: "var(--ink-soft)"
      }
    }, i + 1), /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement("button", {
      style: {
        border: 0,
        background: "transparent",
        padding: 0,
        color: "var(--brand)",
        fontWeight: 600,
        cursor: "pointer",
        textAlign: "left"
      }
    }, s.name)), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        color: "var(--ink-soft)"
      }
    }, s.aliases.join("、")), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontFamily: "var(--font-mono)",
        fontSize: 12
      }
    }, s.taxNo), /*#__PURE__*/React.createElement("td", {
      style: td
    }, s.bank), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontFamily: "var(--font-mono)",
        fontSize: 12
      }
    }, s.account), /*#__PURE__*/React.createElement("td", {
      style: td
    }, s.contact, " / ", s.phone), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        color: "var(--ink-soft)"
      }
    }, s.note), /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      icon: "file-text",
      title: "\u8BE6\u60C5"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "square-pen",
      title: "\u7F16\u8F91"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "trash-2",
      tone: "danger",
      title: "\u5220\u9664"
    }))))))))));
  }
  window.SupplierScreen = SupplierScreen;
  window.KitToolbar = Toolbar;
  window.KitTH = th;
  window.KitTD = td;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/SupplierScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/WorkerScreen.jsx
try { (() => {
// WorkerScreen — 工人信息：精简列（姓名/班组/当前工地/电话/身份证/进退场）
(function () {
  const {
    Button,
    Panel,
    StatusChip
  } = window.DesignSystem_e3d871;
  function WorkerScreen({
    data
  }) {
    const Toolbar = window.KitToolbar,
      th = window.KitTH,
      td = window.KitTD;
    const [filter, setFilter] = React.useState("all");
    const workers = data.workers;
    const shown = filter === "all" ? workers : filter === "on" ? workers.filter(w => w.onSite) : workers.filter(w => !w.onSite);
    const onCount = workers.filter(w => w.onSite).length;
    const offCount = workers.filter(w => !w.onSite).length;
    const maskId = id => id.slice(0, 6) + "****" + id.slice(-4);
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Toolbar, {
      title: "\u5DE5\u4EBA\u4FE1\u606F",
      count: workers.length,
      unit: "\u4EBA",
      searchPh: "\u641C\u7D22\u59D3\u540D\u3001\u73ED\u7EC4\u3001\u5DE5\u5730\u2026",
      extra: /*#__PURE__*/React.createElement(Button, {
        icon: "user-plus",
        variant: "primary"
      }, "\u6DFB\u52A0\u5DE5\u4EBA")
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 12
      }
    }, [{
      label: "在场",
      count: onCount,
      tone: "ok",
      key: "on"
    }, {
      label: "已退场",
      count: offCount,
      tone: "neutral",
      key: "off"
    }, {
      label: "合计",
      count: workers.length,
      tone: "default",
      key: "all"
    }].map(c => /*#__PURE__*/React.createElement("button", {
      key: c.key,
      onClick: () => setFilter(c.key),
      style: {
        flex: 1,
        border: "1px solid",
        borderColor: filter === c.key ? "var(--brand)" : "var(--line)",
        borderRadius: 10,
        padding: "14px 16px",
        background: filter === c.key ? "var(--brand-soft)" : "var(--panel)",
        cursor: "pointer",
        textAlign: "left"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-soft)",
        marginBottom: 4
      }
    }, c.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 24,
        fontWeight: 800,
        fontFamily: "var(--font-mono)",
        color: filter === c.key ? "var(--brand)" : "var(--ink)"
      }
    }, c.count)))), /*#__PURE__*/React.createElement(Panel, {
      padding: 8
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        overflow: "auto"
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: "100%",
        borderCollapse: "collapse",
        minWidth: 720
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, ["#", "姓名", "所属班组", "当前工地", "联系电话", "身份证号", "进场日期", "退场日期", "状态", "操作"].map((h, i) => /*#__PURE__*/React.createElement("th", {
      key: i,
      style: {
        padding: "10px 12px",
        fontSize: 12,
        fontWeight: 800,
        color: "var(--ink-soft)",
        background: "var(--surface-2)",
        textAlign: i >= 4 ? "center" : "left",
        whiteSpace: "nowrap"
      }
    }, h)))), /*#__PURE__*/React.createElement("tbody", null, shown.map((w, i) => /*#__PURE__*/React.createElement("tr", {
      key: w.id,
      style: {
        borderBottom: "1px solid var(--line)"
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "10px 12px",
        fontSize: 13,
        color: "var(--ink-soft)"
      }
    }, i + 1), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "10px 12px",
        fontSize: 13,
        fontWeight: 700
      }
    }, w.name), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "10px 12px",
        fontSize: 13
      }
    }, w.team), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "10px 12px",
        fontSize: 13
      }
    }, w.project), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "10px 12px",
        fontSize: 13,
        fontFamily: "var(--font-mono)",
        textAlign: "center"
      }
    }, w.phone), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "10px 12px",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        textAlign: "center",
        letterSpacing: 0.5
      }
    }, maskId(w.idCard)), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "10px 12px",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        textAlign: "center",
        color: "var(--ink-soft)"
      }
    }, w.entryDate), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "10px 12px",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        textAlign: "center",
        color: "var(--ink-faint)"
      }
    }, w.exitDate || "—"), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "10px 12px",
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement(StatusChip, {
      tone: w.onSite ? "ok" : "neutral"
    }, w.onSite ? "在场" : "已退场")), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: "10px 12px",
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("button", {
      style: {
        border: "1px solid var(--line)",
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 12,
        cursor: "pointer",
        background: "#fff"
      }
    }, "\u7F16\u8F91")))))))));
  }
  window.WorkerScreen = WorkerScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/WorkerScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/scanner-assistant/data.js
try { (() => {
// 扫描件助手 UI Kit — 演示数据（贴近工地/财务场景，非真实企业）
// 暴露到 window 供各屏共享。
(function () {
  const invoices = [{
    id: "i1",
    name: "scan_0615_001.pdf",
    size: "1.2 MB",
    pages: 1,
    type: "增值税专用发票",
    number: "09442026000058760",
    date: "2026-06-15",
    buyer: "广州市瑞航建筑工程有限公司",
    seller: "广州市大板东建材有限公司",
    total: "128640.00",
    tax: "14798.23",
    rate: "13%",
    project: "合和新城·3 号楼",
    remark: "钢筋一批",
    status: "done",
    account: "pending",
    review: false
  }, {
    id: "i2",
    name: "scan_0615_002.pdf",
    size: "0.9 MB",
    pages: 1,
    type: "增值税普通发票",
    number: "09442026000058761",
    date: "2026-06-14",
    buyer: "广州市瑞航建筑工程有限公司",
    seller: "花城珠江电线电缆有限公司",
    total: "45200.00",
    tax: "5199.12",
    rate: "13%",
    project: "合和新城·3 号楼",
    remark: "",
    status: "done",
    account: "pending",
    review: true
  }, {
    id: "i3",
    name: "扫描件_汇丰水泥.pdf",
    size: "2.1 MB",
    pages: 2,
    type: "增值税专用发票",
    number: "09442026000058744",
    date: "2026-06-12",
    buyer: "广州市瑞航建筑工程有限公司",
    seller: "汇丰水泥制品有限公司",
    total: "86000.00",
    tax: "9893.81",
    rate: "13%",
    project: "锦绣华庭·南区",
    remark: "C30 商砼",
    status: "done",
    account: "posted",
    review: false,
    accountedAt: "2026-06-16 09:42"
  }, {
    id: "i4",
    name: "IMG_2026_0610.jpg",
    size: "3.4 MB",
    pages: 1,
    type: "增值税普通发票",
    number: "09442026000058702",
    date: "2026-06-10",
    buyer: "广州市瑞航建筑工程有限公司",
    seller: "穗建五金机电经营部",
    total: "12380.00",
    tax: "1423.89",
    rate: "13%",
    project: "锦绣华庭·南区",
    remark: "电动工具",
    status: "done",
    account: "posted",
    review: false,
    accountedAt: "2026-06-11 17:08"
  }, {
    id: "i5",
    name: "scan_0609_007.pdf",
    size: "0.7 MB",
    pages: 1,
    type: "—",
    number: "",
    date: "",
    buyer: "",
    seller: "",
    total: "",
    tax: "",
    rate: "",
    project: "",
    remark: "",
    status: "todo",
    account: "none",
    review: false
  }, {
    id: "i6",
    name: "scan_0609_008.pdf",
    size: "0.8 MB",
    pages: 1,
    type: "—",
    number: "",
    date: "",
    buyer: "",
    seller: "",
    total: "",
    tax: "",
    rate: "",
    project: "",
    remark: "",
    status: "todo",
    account: "none",
    review: false
  }, {
    id: "i7",
    name: "重复_汇丰水泥.pdf",
    size: "2.0 MB",
    pages: 2,
    type: "增值税专用发票",
    number: "09442026000058744",
    date: "2026-06-12",
    buyer: "广州市瑞航建筑工程有限公司",
    seller: "汇丰水泥制品有限公司",
    total: "86000.00",
    tax: "9893.81",
    rate: "13%",
    project: "锦绣华庭·南区",
    remark: "与 i3 重复",
    status: "dup",
    account: "none",
    review: false
  }, {
    id: "i8",
    name: "扫描件_鸿运防水.pdf",
    size: "1.1 MB",
    pages: 1,
    type: "增值税专用发票",
    number: "09442026000058690",
    date: "2026-06-08",
    buyer: "广州市瑞航建筑工程有限公司",
    seller: "鸿运建筑防水工程有限公司",
    total: "33500.00",
    tax: "3853.98",
    rate: "13%",
    project: "合和新城·3 号楼",
    remark: "屋面防水",
    status: "done",
    account: "pending",
    review: true
  }];
  const suppliers = [{
    id: "s1",
    name: "广州市大板东建材有限公司",
    aliases: ["大板东"],
    taxNo: "91440101MA5CBX1234",
    bank: "中国银行广州天河支行",
    account: "6217 8500 1234 5678",
    contact: "陈志强",
    phone: "13802201234",
    note: "钢材"
  }, {
    id: "s2",
    name: "花城珠江电线电缆有限公司",
    aliases: ["花城电缆", "珠江电缆"],
    taxNo: "91440101MA5DEF5678",
    bank: "工商银行广州越秀支行",
    account: "6222 0202 8888 4321",
    contact: "李美玲",
    phone: "13902205678",
    note: "电线电缆"
  }, {
    id: "s3",
    name: "汇丰水泥制品有限公司",
    aliases: ["汇丰水泥"],
    taxNo: "91440103MA5GHI9012",
    bank: "建设银行广州番禺支行",
    account: "6217 0001 2233 4455",
    contact: "黄国华",
    phone: "13602209012",
    note: "商砼"
  }, {
    id: "s4",
    name: "穗建五金机电经营部",
    aliases: ["穗建五金"],
    taxNo: "91440104MA5JKL3456",
    bank: "农业银行广州海珠支行",
    account: "6228 4800 5566 7788",
    contact: "周伟",
    phone: "13802203456",
    note: "五金机电"
  }, {
    id: "s5",
    name: "鸿运建筑防水工程有限公司",
    aliases: ["鸿运防水"],
    taxNo: "91440106MA5MNO7890",
    bank: "招商银行广州分行",
    account: "6225 8801 9988 7766",
    contact: "刘建军",
    phone: "13902207890",
    note: "防水"
  }];
  const projects = [{
    id: "p1",
    name: "合和新城",
    status: "在建",
    address: "广州市白云区机场路 188 号",
    startDate: "2025-09-01",
    developer: "合和地产集团",
    manager: "张工"
  }, {
    id: "p2",
    name: "锦绣华庭",
    status: "在建",
    address: "广州市番禺区市广路 66 号",
    startDate: "2026-01-15",
    developer: "锦绣置业有限公司",
    manager: "王工"
  }, {
    id: "p3",
    name: "翠湖花园",
    status: "收尾",
    address: "广州市天河区天源路 9 号",
    startDate: "2024-11-20",
    developer: "翠湖投资",
    manager: "李工"
  }, {
    id: "p4",
    name: "江湾一号",
    status: "停工",
    address: "广州市海珠区滨江东路 3 号",
    startDate: "2025-03-10",
    developer: "江湾置业",
    manager: "陈工"
  }];
  const workers = [{
    id: "w1",
    name: "虞建华",
    team: "泥水A班",
    project: "合和新城",
    onSite: true,
    phone: "13511220001",
    idCard: "330682198503117890",
    entryDate: "2024-08-15"
  }, {
    id: "w2",
    name: "王芳（虞嫂）",
    team: "泥水A班",
    project: "合和新城",
    onSite: true,
    phone: "13511220002",
    idCard: "330682198706128901",
    entryDate: "2024-08-15"
  }, {
    id: "w3",
    name: "张建国",
    team: "泥水A班",
    project: "合和新城",
    onSite: true,
    phone: "13511220003",
    idCard: "362426198712146789",
    entryDate: "2024-09-01"
  }, {
    id: "w4",
    name: "匡志强",
    team: "泥水A班",
    project: "合和新城",
    onSite: true,
    phone: "13511220004",
    idCard: "430481198905264567",
    entryDate: "2024-09-10"
  }, {
    id: "w5",
    name: "赵铁柱",
    team: "钢筋班",
    project: "合和新城",
    onSite: true,
    phone: "13511220005",
    idCard: "440181199003051234",
    entryDate: "2025-03-20"
  }, {
    id: "w6",
    name: "孙大勇",
    team: "木工一班",
    project: "合和新城",
    onSite: true,
    phone: "13511220006",
    idCard: "511325198807122345",
    entryDate: "2025-01-12"
  }, {
    id: "w7",
    name: "周伟峰",
    team: "水电班",
    project: "锦绣华庭",
    onSite: true,
    phone: "13511220007",
    idCard: "342221199211053456",
    entryDate: "2026-01-20"
  }, {
    id: "w8",
    name: "郑明",
    team: "防水班",
    project: "翠湖花园",
    onSite: false,
    phone: "13511220008",
    idCard: "452123199001025678",
    entryDate: "2024-11-05",
    exitDate: "2026-02-28"
  }];

  // 单价对比：行=材料，列=供应商
  const priceSuppliers = ["大板东", "汇丰水泥", "穗建五金"];
  const priceRows = [{
    key: "m1",
    name: "HRB400 螺纹钢 Φ12",
    unit: "吨",
    names: 3,
    by: {
      "大板东": {
        recent: 3980,
        min: 3920,
        max: 4050
      }
    },
    lowest: "大板东"
  }, {
    key: "m2",
    name: "C30 商品混凝土",
    unit: "m³",
    names: 2,
    by: {
      "汇丰水泥": {
        recent: 462,
        min: 455,
        max: 470
      }
    },
    lowest: "汇丰水泥"
  }, {
    key: "m3",
    name: "镀锌钢管 DN50",
    unit: "根",
    names: 4,
    by: {
      "大板东": {
        recent: 86,
        min: 86,
        max: 86
      },
      "穗建五金": {
        recent: 82,
        min: 80,
        max: 85
      }
    },
    lowest: "穗建五金"
  }, {
    key: "m4",
    name: "膨胀螺栓 M10",
    unit: "盒",
    names: 1,
    by: {
      "穗建五金": {
        recent: 24,
        min: 22,
        max: 26
      }
    },
    lowest: "穗建五金"
  }, {
    key: "m5",
    name: "防水卷材 SBS",
    unit: "卷",
    names: 2,
    by: {
      "大板东": {
        recent: 320,
        min: 315,
        max: 330
      },
      "汇丰水泥": {
        recent: 335,
        min: 330,
        max: 340
      }
    },
    lowest: "大板东"
  }];

  // 送货单文件卡片
  const deliveryFiles = [{
    id: "d1",
    name: "大板东-20260614.pdf",
    partition: "合和新城",
    company: "广州市大板东建材有限公司",
    ocr: "done",
    date: "2026-06-14",
    no: "0005876",
    material: "螺纹钢 Φ12 / 8.5 吨",
    conflict: false
  }, {
    id: "d2",
    name: "汇丰水泥-0612.jpg",
    partition: "锦绣华庭",
    company: "汇丰水泥制品有限公司",
    ocr: "done",
    date: "2026-06-12",
    no: "0012043",
    material: "C30 商砼 / 186 m³",
    conflict: false
  }, {
    id: "d3",
    name: "未命名扫描_07.pdf",
    partition: "合和新城",
    company: "花城珠江电线电缆有限公司",
    ocr: "review",
    date: "2026-06-11",
    no: "—",
    material: "电缆 YJV / 待复核",
    conflict: true
  }, {
    id: "d4",
    name: "穗建五金-0610.pdf",
    partition: "锦绣华庭",
    company: "穗建五金机电经营部",
    ocr: "todo",
    date: "—",
    no: "—",
    material: "—",
    conflict: false
  }];

  // ——— 班组（全局实体，跨项目复用） ———
  const crews = [{
    id: "c1",
    name: "泥水A班",
    trade: "泥水工",
    contact: "虞师傅",
    phone: "13700110001",
    workerCount: 8,
    projectCount: 2,
    note: "墙地砖主力班组"
  }, {
    id: "c2",
    name: "泥水B班",
    trade: "泥水工",
    contact: "张师傅",
    phone: "13700110002",
    workerCount: 6,
    projectCount: 1,
    note: ""
  }, {
    id: "c3",
    name: "木工一班",
    trade: "木工",
    contact: "孙师傅",
    phone: "13700110003",
    workerCount: 5,
    projectCount: 2,
    note: "模板·吊顶"
  }, {
    id: "c4",
    name: "钢筋班",
    trade: "钢筋工",
    contact: "赵师傅",
    phone: "13700110004",
    workerCount: 10,
    projectCount: 1,
    note: ""
  }, {
    id: "c5",
    name: "防水班",
    trade: "防水工",
    contact: "刘师傅",
    phone: "13700110005",
    workerCount: 4,
    projectCount: 3,
    note: "屋面·卫生间"
  }, {
    id: "c6",
    name: "水电班",
    trade: "水暖工",
    contact: "周师傅",
    phone: "13700110006",
    workerCount: 7,
    projectCount: 2,
    note: ""
  }];

  // 班组×项目 配置（详情页用）
  const crewConfig = {
    crew: "泥水A班",
    project: "合和新城",
    ratio: 0.95,
    rentEnabled: true,
    rentPrice: 3.0,
    mgmtEnabled: true,
    mgmtPrice: 1.5,
    items: [{
      name: "墙砖铺贴",
      unit: "㎡",
      price: 38,
      inRent: true,
      inMgmt: true
    }, {
      name: "地砖铺贴",
      unit: "㎡",
      price: 32,
      inRent: true,
      inMgmt: true
    }, {
      name: "脚线",
      unit: "m",
      price: 8,
      inRent: false,
      inMgmt: true
    }, {
      name: "淋浴板",
      unit: "套",
      price: 120,
      inRent: false,
      inMgmt: false
    }, {
      name: "防水",
      unit: "㎡",
      price: 25,
      inRent: false,
      inMgmt: false
    }],
    workers: ["虞师傅", "虞嫂", "张师傅", "匡师傅", "李师傅", "何嫂", "文师傅", "老陈"],
    workerConfigs: [{
      worker: "虞师傅",
      mode: "piece",
      rent: null,
      mgmt: null,
      ratio: null,
      role: "班组长"
    }, {
      worker: "虞嫂",
      mode: "piece",
      rent: null,
      mgmt: null,
      ratio: null,
      linked: "虞师傅"
    }, {
      worker: "张师傅",
      mode: "piece",
      rent: null,
      mgmt: false,
      ratio: null
    }, {
      worker: "匡师傅",
      mode: "piece",
      rent: false,
      mgmt: null,
      ratio: 0.9
    }, {
      worker: "李师傅",
      mode: "piece",
      rent: null,
      mgmt: null,
      ratio: null
    }, {
      worker: "何嫂",
      mode: "piece",
      rent: null,
      mgmt: null,
      ratio: 0.9
    }, {
      worker: "文师傅",
      mode: "piece",
      rent: false,
      mgmt: false,
      ratio: null
    }, {
      worker: "老陈",
      mode: "time",
      rent: false,
      mgmt: false,
      ratio: null,
      daily: 280
    }]
  };

  // ——— 工程量矩阵（楼层×户号×分项，按月着色） ———
  const mxMonths = [{
    key: "2024-09",
    label: "2024.9",
    bg: "#e7e9fd",
    ink: "#3730a3",
    dot: "#6366f1"
  }, {
    key: "2024-11",
    label: "2024.11",
    bg: "#d6f5e3",
    ink: "#065f46",
    dot: "#10b981"
  }, {
    key: "2025-01",
    label: "2025.1",
    bg: "#ffe1e6",
    ink: "#9f1239",
    dot: "#f43f5e"
  }, {
    key: "2025-04",
    label: "2025.4",
    bg: "#fef0cd",
    ink: "#92400e",
    dot: "#f59e0b"
  }];
  const mxFloors = ["39F", "38F", "37F", "36F", "35F", "34F", "33F"];
  const mxUnits = ["01户", "02户", "03户", "04户"];
  const mxItems = ["墙砖", "地砖"];
  // 楼层 → 完成月份（自下而上施工：底层早、顶层晚；39F 尚未施工）
  const floorMonth = {
    "33F": "2024-09",
    "34F": "2024-09",
    "35F": "2024-11",
    "36F": "2024-11",
    "37F": "2025-01",
    "38F": "2025-04",
    "39F": null
  };
  // 墙砖按户固定工人；地砖按户固定工人；01 户为夫妻关联（虞师傅/虞嫂）
  const wallWorker = {
    "01户": "虞师傅",
    "02户": "匡师傅",
    "03户": "李师傅",
    "04户": "李师傅"
  };
  const floorTileWorker = {
    "01户": "张师傅",
    "02户": "张师傅",
    "03户": "何嫂",
    "04户": "文师傅"
  };
  const mxCells = {};
  mxFloors.forEach((f, fi) => {
    const month = floorMonth[f];
    mxUnits.forEach((u, ui) => {
      // 制造部分未施工：39F 全空；38F 仅 01/02 户完成
      let done = month != null;
      if (f === "38F" && (u === "03户" || u === "04户")) done = false;
      if (!done) return;
      const wallQty = 28 + (fi * 3 + ui * 5) % 14;
      const tileQty = 18 + (fi * 2 + ui * 4) % 9;
      mxCells[f + "|" + u] = [{
        item: "墙砖",
        worker: wallWorker[u],
        partner: u === "01户" ? "虞嫂" : null,
        month,
        qty: wallQty
      }, {
        item: "地砖",
        worker: floorTileWorker[u],
        partner: null,
        month,
        qty: tileQty
      }];
    });
  });
  const matrix = {
    buildings: ["1栋", "2栋", "3栋"],
    months: mxMonths,
    floors: mxFloors,
    units: mxUnits,
    items: mxItems,
    cells: mxCells
  };

  // ——— 工资核算 ———
  const payroll = {
    crew: "泥水A班",
    project: "合和新城",
    month: "2025-04",
    ratioLabel: "95%",
    ratioSchedule: [{
      m: "2024.9",
      r: "75%"
    }, {
      m: "2024.11",
      r: "75%"
    }, {
      m: "2025.1",
      r: "85%"
    }, {
      m: "2025.4",
      r: "95%",
      current: true
    }, {
      m: "结算",
      r: "100%"
    }],
    rows: [{
      worker: "虞师傅",
      mode: "piece",
      engineering: 48260,
      rent: 3200,
      mgmt: 1800,
      ratio: 0.95,
      prevPaid: 38000,
      deduct: 1200,
      safety: true
    }, {
      worker: "张师傅",
      mode: "piece",
      engineering: 36200,
      rent: 2400,
      mgmt: 1300,
      ratio: 0.95,
      prevPaid: 29000,
      deduct: 0,
      safety: true
    }, {
      worker: "匡师傅",
      mode: "piece",
      engineering: 29800,
      rent: 0,
      mgmt: 1100,
      ratio: 0.95,
      prevPaid: 24000,
      deduct: 500,
      safety: false
    }, {
      worker: "李师傅",
      mode: "piece",
      engineering: 41200,
      rent: 2800,
      mgmt: 1500,
      ratio: 0.95,
      prevPaid: 33000,
      deduct: 0,
      safety: true
    }, {
      worker: "何嫂",
      mode: "piece",
      engineering: 22600,
      rent: 1600,
      mgmt: 800,
      ratio: 0.9,
      prevPaid: 17000,
      deduct: 0,
      safety: true
    }, {
      worker: "老陈（杂工）",
      mode: "time",
      days: 24,
      daily: 280,
      deduct: 0,
      safety: true
    }],
    detail: {
      worker: "虞师傅",
      partner: "虞嫂",
      building: "1栋",
      roundNote: "工程量按 0.01㎡ 取整 · 金额按元四舍五入取整",
      lines: [{
        name: "墙砖铺贴",
        unit: "㎡",
        price: 38,
        qty: 980.36,
        calc: [{
          room: "37F-01户 客厅",
          expr: "7.55×(3.05-0.08)-1.2×(2.4-0.08)",
          val: 19.62
        }, {
          room: "37F-01户 主卧",
          expr: "(3.6×2.65-0.9×2.1)×2",
          val: 15.30
        }, {
          room: "37F-01户 卫生间",
          expr: "(2.1+1.8)×2×2.4-0.8×2.0",
          val: 17.12
        }, {
          room: "36F-01户 客厅",
          expr: "7.55×(3.05-0.08)-1.2×(2.4-0.08)",
          val: 19.62
        }, {
          room: "…共 26 间",
          expr: "",
          val: null,
          summary: true
        }],
        calcTotal: 980.36
      }, {
        name: "脚线",
        unit: "m",
        price: 8,
        qty: 420
      }, {
        name: "淋浴板",
        unit: "套",
        price: 120,
        qty: 18
      }, {
        name: "防水",
        unit: "㎡",
        price: 25,
        qty: 220
      }],
      rent: 3200,
      mgmt: 1800,
      ratio: 0.95,
      prevPaid: 38000,
      deductItems: [{
        reason: "空鼓罚款 · 3 处",
        amt: 600
      }, {
        reason: "未收尾扣款",
        amt: 600
      }]
    }
  };
  const projectCrews = {
    "合和新城": [{
      crew: "泥水A班",
      trade: "泥水工",
      workers: 8,
      net: 47602,
      hasData: true
    }, {
      crew: "木工一班",
      trade: "木工",
      workers: 5,
      net: 0,
      hasData: false
    }, {
      crew: "钢筋班",
      trade: "钢筋工",
      workers: 10,
      net: 0,
      hasData: false
    }],
    "锦绣华庭": [{
      crew: "泥水B班",
      trade: "泥水工",
      workers: 6,
      net: 0,
      hasData: false
    }, {
      crew: "水电班",
      trade: "水暖工",
      workers: 7,
      net: 0,
      hasData: false
    }],
    "翠湖花园": [{
      crew: "防水班",
      trade: "防水工",
      workers: 4,
      net: 0,
      hasData: false
    }],
    "江湾一号": []
  };
  const factorDefaults = [{
    id: "f1",
    name: "HRB400 螺纹钢 Φ12",
    unit: "吨",
    price: 3980
  }, {
    id: "f2",
    name: "C30 商品混凝土",
    unit: "m³",
    price: 462
  }, {
    id: "f3",
    name: "镀锌钢管 DN50",
    unit: "根",
    price: 86
  }, {
    id: "f4",
    name: "防水卷材 SBS",
    unit: "卷",
    price: 320
  }];
  window.KIT_DATA = {
    invoices,
    suppliers,
    projects,
    workers,
    priceSuppliers,
    priceRows,
    deliveryFiles,
    crews,
    crewConfig,
    matrix,
    payroll,
    projectCrews,
    factorDefaults
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/scanner-assistant/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.StatusChip = __ds_scope.StatusChip;

__ds_ns.FilterPill = __ds_scope.FilterPill;

__ds_ns.NavItem = __ds_scope.NavItem;

__ds_ns.StageTab = __ds_scope.StageTab;

})();
