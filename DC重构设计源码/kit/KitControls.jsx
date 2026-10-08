// KitControls — 表单控件原语（2026-10-07 评审 V-08 / V-09 / C-03），注册 window.KitControls，经隐藏 x-import 预加载。
// 结构对齐 reka-ui（Vue 实现所用库；其 React 原型为 Radix）：Select / Combobox / DatePicker / Tooltip / Tabs 的
//   部件划分与键盘行为同 reka-ui，设计稿控件可一一映射到 Vue 侧 reka-ui 组件，不另立交互。
// 共同约定：
//   - 弹层一律挂到 document.body、fixed 定位，不被表格 / 卡片的 overflow 裁切；Esc 关闭并把焦点还给触发器。
//   - Field：标签行固定高度、说明与错误占用预留行，校验出错不会让同行输入框错位（V-09）。
//   - 尺寸：默认 32px，size="sm" 26px（分页、表格内）。
// 导出：Field, Input, NumberInput(capital 悬停大写), Textarea, Select, Combobox, DatePicker, Tip, Tabs,
//   StatusTag（规格 §16，对应 KitStatusTag.vue）, HoverHint（可复制浮层，side 定方向）, Tip（side 定方向）, MetricStrip（指标摘要条，替代 MetricGrid）, toCapital（人民币大写）
(function () {
  if (window.KitControls) { window.KitControlsPreload = window.KitControlsPreload || function () { return null; }; return; }
  const h = React.createElement;
  const DS = () => window.DesignSystem_e3d871 || {};
  const Ico = (name, size = 14, color) => { const { Icon } = DS(); return Icon ? h(Icon, { name, size, color }) : null; };

  if (!document.getElementById("kit-controls-css")) {
    const st = document.createElement("style");
    st.id = "kit-controls-css";
    st.textContent = [
      ".kc-field { display:grid; grid-template-rows:20px auto 18px; row-gap:4px; min-width:0; }",
      ".kc-label { display:flex; align-items:center; gap:4px; font-size:12px; font-weight:600; color:var(--ink-soft); white-space:nowrap; overflow:hidden; }",
      ".kc-label i { color:var(--danger); font-style:normal; }",
      ".kc-msg { font-size:11.5px; line-height:18px; color:var(--ink-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }",
      ".kc-msg.err { color:var(--danger-ink); }",
      ".kc-ctl { position:relative; display:flex; align-items:center; height:32px; min-width:0; border:1px solid var(--line-strong); border-radius:6px; background:var(--panel); color:var(--ink); font-size:13px; transition:border-color .12s, box-shadow .12s; }",
      ".kc-ctl.sm { height:26px; font-size:12px; }",
      ".kc-ctl:hover { border-color:#9aa6b8; }",
      ".kc-ctl:focus-within, .kc-ctl[data-open=true] { border-color:var(--brand); box-shadow:0 0 0 3px var(--brand-soft); }",
      ".kc-ctl.err { border-color:var(--danger); box-shadow:0 0 0 3px var(--danger-soft); }",
      ".kc-ctl.ro { background:var(--surface-2); color:var(--ink-soft); border-style:dashed; }",
      ".kc-ctl.dis { background:var(--surface-2); color:var(--ink-faint); cursor:not-allowed; }",
      ".kc-ctl input, .kc-ctl textarea { flex:1; min-width:0; height:100%; padding:0 10px; border:0; outline:0; background:transparent; color:inherit; font:inherit; }",
      ".kc-ctl input::placeholder, .kc-ctl textarea::placeholder { color:var(--ink-faint); }",
      ".kc-ctl.area { height:auto; align-items:stretch; }",
      ".kc-ctl.area textarea { padding:8px 10px; min-height:64px; resize:vertical; line-height:1.6; }",
      ".kc-count { position:absolute; right:8px; bottom:4px; font-size:11px; color:var(--ink-faint); pointer-events:none; }",
      ".kc-pre { padding-left:10px; color:var(--ink-faint); display:grid; place-items:center; }",
      ".kc-sfx { height:100%; padding:0 10px; display:grid; place-items:center; color:var(--ink-faint); border-left:1px solid var(--line); background:var(--surface-2); border-radius:0 5px 5px 0; }",
      ".kc-add { height:100%; width:32px; display:grid; place-items:center; border:0; border-left:1px solid var(--line); background:transparent; color:var(--ink-soft); cursor:pointer; border-radius:0 5px 5px 0; }",
      ".kc-add:hover { color:var(--brand); background:var(--brand-soft); }",
      ".kc-trigger { width:100%; height:100%; display:flex; align-items:center; justify-content:space-between; gap:6px; padding:0 8px 0 10px; border:0; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; outline:0; }",
      ".kc-trigger .ph { color:var(--ink-faint); }",
      ".kc-trigger .val { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
      ".kc-chev { display:grid; color:var(--ink-faint); transition:transform .15s; flex:none; }",
      "[data-open=true] .kc-chev { transform:rotate(180deg); }",
      ".kc-clear { display:grid; place-items:center; width:18px; height:18px; border:0; border-radius:4px; background:transparent; color:var(--ink-faint); cursor:pointer; }",
      ".kc-clear:hover { background:var(--surface-3); color:var(--ink); }",
      ".kc-pop { position:fixed; z-index:10050; min-width:160px; max-height:300px; overflow:auto; padding:4px; background:var(--panel); border:1px solid var(--line); border-radius:8px; box-shadow:var(--shadow-pop); animation:kc-in .14s ease-out; transform-origin:top; }",
      "@keyframes kc-in { from { opacity:0; transform:translateY(-4px) scale(.98); } to { opacity:1; transform:none; } }",
      ".kc-search { display:flex; align-items:center; gap:6px; height:28px; margin:2px 2px 6px; padding:0 8px; border:1px solid var(--line-strong); border-radius:6px; }",
      ".kc-search input { flex:1; min-width:0; border:0; outline:0; font:inherit; font-size:12.5px; background:transparent; }",
      ".kc-opt { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 8px; border-radius:5px; cursor:pointer; font-size:13px; }",
      ".kc-opt[data-hl=true] { background:var(--surface-2); }",
      ".kc-opt[aria-selected=true] { color:var(--brand); font-weight:700; }",
      ".kc-opt[aria-disabled=true] { color:var(--ink-faint); cursor:not-allowed; }",
      ".kc-opt .hint { color:var(--ink-faint); font-size:12px; font-weight:400; }",
      ".kc-opt mark { background:var(--warn-soft); color:inherit; border-radius:2px; }",
      ".kc-empty { padding:10px 8px; color:var(--ink-faint); font-size:12.5px; }",
      ".kc-create { border-top:1px solid var(--line); margin-top:4px; padding-top:4px; }",
      ".kc-cal { width:252px; padding:8px; }",
      ".kc-cal-h { display:flex; align-items:center; justify-content:space-between; padding:2px 2px 8px; font-weight:700; }",
      ".kc-cal-h button { width:26px; height:26px; border:0; border-radius:6px; background:transparent; cursor:pointer; color:var(--ink-soft); display:grid; place-items:center; }",
      ".kc-cal-h button:hover { background:var(--surface-2); }",
      ".kc-cal-g { display:grid; grid-template-columns:repeat(7, 1fr); gap:2px; text-align:center; }",
      ".kc-cal-title { width:auto !important; padding:0 8px !important; display:inline-flex !important; align-items:center; gap:4px; font:inherit; font-weight:700; color:var(--ink) !important; }",
      ".kc-cal-mg { display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; padding:4px 0; }",
      ".kc-cal-mg button { height:40px; border:0; border-radius:6px; background:transparent; font:inherit; font-size:13px; cursor:pointer; color:var(--ink); font-variant-numeric:tabular-nums; }",
      ".kc-cal-mg button:hover { background:var(--surface-2); }",
      ".kc-cal-mg button.today { box-shadow:inset 0 0 0 1px var(--brand); }",
      ".kc-cal-mg button.sel { background:var(--brand); color:#fff; font-weight:700; }",
      ".kc-cal-mg button:disabled { color:#c3cbd8; background:transparent; cursor:not-allowed; }",
      ".kc-cal-g .wd { font-size:11.5px; color:var(--ink-faint); padding:4px 0; }",
      ".kc-cal-g button { height:30px; border:0; border-radius:6px; background:transparent; font:inherit; font-size:12.5px; cursor:pointer; color:var(--ink); font-variant-numeric:tabular-nums; }",
      ".kc-cal-g button:hover { background:var(--surface-2); }",
      ".kc-cal-g button.out { color:var(--ink-faint); }",
      ".kc-cal-g button.today { box-shadow:inset 0 0 0 1px var(--brand); }",
      ".kc-cal-g button.sel { background:var(--brand); color:#fff; font-weight:700; }",
      ".kc-cal-g button:disabled { color:#c3cbd8; background:transparent; cursor:not-allowed; text-decoration:line-through; }",
      ".kc-cal-f button:disabled { color:var(--ink-faint); cursor:not-allowed; }",
      ".kc-cal-g button[data-hl=true] { outline:2px solid var(--brand-soft); }",
      ".kc-cal-f { display:flex; justify-content:space-between; padding-top:8px; margin-top:6px; border-top:1px solid var(--line); }",
      ".kc-cal-f button { border:0; background:transparent; color:var(--brand); cursor:pointer; font:inherit; font-size:12.5px; }",
      ".kc-tip { display:inline-grid; place-items:center; width:14px; height:14px; flex:none; border-radius:50%; border:1px solid var(--ink-faint); color:var(--ink-faint); font-size:10px; font-weight:700; line-height:1; cursor:help; background:transparent; padding:0; }",
      ".kc-tip:hover, .kc-tip:focus-visible { border-color:var(--brand); color:var(--brand); }",
      "@keyframes kc-fade { from { opacity:0; } to { opacity:1; } }",
      ".kc-hint-pop { position:fixed; z-index:10060; display:flex; align-items:center; gap:6px; max-width:420px; padding:5px 6px 5px 10px; border-radius:6px; background:#1f2937; color:#fff; font-size:13px; line-height:1.5; box-shadow:var(--shadow-pop); animation:kc-fade .12s ease-out; user-select:text; cursor:text; }",
      ".kc-hint-text { user-select:text; letter-spacing:.02em; }",
      ".kc-hint-copy { display:grid; place-items:center; width:24px; height:24px; flex:none; border:0; border-radius:4px; background:rgb(255 255 255 / 10%); color:#fff; cursor:pointer; }",
      ".kc-hint-copy:hover { background:rgb(255 255 255 / 22%); }",
      ".kc-tip-pop { position:fixed; z-index:10060; max-width:280px; padding:6px 9px; border-radius:6px; background:#1f2937; color:#fff; font-size:12px; line-height:1.55; box-shadow:var(--shadow-pop); animation:kc-fade .12s ease-out; }",
      ".kc-tabs { position:relative; display:flex; gap:20px; border-bottom:1px solid var(--line); overflow-x:auto; overflow-y:hidden; scrollbar-width:none; }",
      ".kc-tabs::-webkit-scrollbar { display:none; }",
      ".kc-tabs button { flex:none; border:0; background:none; padding:10px 0; font:inherit; font-size:13px; color:var(--ink-soft); cursor:pointer; display:inline-flex; align-items:center; gap:6px; }",
      ".kc-tabs button:hover { color:var(--ink); }",
      ".kc-tabs button[aria-selected=true] { color:var(--brand); font-weight:700; }",
      ".kc-tabs .cnt { font-size:11px; padding:0 6px; border-radius:999px; background:var(--surface-3); color:var(--ink-soft); font-weight:600; font-variant-numeric:tabular-nums; }",
      ".kc-tabs button[aria-selected=true] .cnt { background:var(--brand-soft); color:var(--brand-deep); }",
      ".kc-ink { position:absolute; bottom:0; height:2px; background:var(--brand); border-radius:1px; transition:left .2s ease, width .2s ease; }",
      ".kc-metrics { display:grid; overflow:hidden; row-gap:8px; }",
      ".kc-metric { position:relative; padding:2px 16px; min-width:0; }",
      ".kc-metric::before { content:''; position:absolute; left:-1px; top:20%; height:60%; width:1px; background:var(--line-strong); }",
      ".kc-metric-l { display:flex; align-items:center; gap:4px; font-size:12px; color:var(--ink-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }",
      ".kc-metric-v { margin-top:4px; font-size:16px; font-weight:700; color:var(--ink); font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }",
      ".kc-metric-s { margin-top:2px; font-size:11.5px; color:var(--ink-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }",
      ".kc-tag { display:inline-block; max-width:100%; padding:1px 4px; border-radius:2px; font-size:11px; line-height:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; vertical-align:middle; }",
      ".kc-tag.ok { background:var(--ok-soft); color:var(--ok-ink); } .kc-tag.warn { background:var(--warn-soft); color:var(--warn-ink); }",
      ".kc-tag.brand { background:var(--brand-soft); color:var(--brand-deep); } .kc-tag.danger { background:var(--danger-soft); color:var(--danger-ink); }",
      ".kc-tag.neutral { background:var(--surface-3); color:var(--ink-soft); }",
      "@media (prefers-reduced-motion: reduce) { .kc-pop, .kc-tip-pop { animation:none; } .kc-ink, .kc-chev, .kc-ctl { transition:none; } }",
    ].join("\n");
    document.head.appendChild(st);
  }

  // —— 就近浮层定位：对应 reka-ui Tooltip / HoverCard 的 side + sideOffset。按方向用 CSS 锚定
  //   （top 用 bottom、left 用 right，左右方向垂直居中），不测量浮层尺寸；滚动 / 缩放时跟随 ——
  function sideStyle(anchor, side = "top", offset = 6) {
    if (!anchor) return { visibility: "hidden" };
    const r = anchor.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
    const x = Math.max(8, Math.min(r.left, W - 8 - 280));
    if (side === "bottom") return { left: x, top: r.bottom + offset };
    if (side === "left") return { right: W - r.left + offset, top: r.top + r.height / 2, transform: "translateY(-50%)" };
    if (side === "right") return { left: r.right + offset, top: r.top + r.height / 2, transform: "translateY(-50%)" };
    return { left: x, bottom: H - r.top + offset };
  }
  function useSide(open, anchorRef, side, offset) {
    const [, tick] = React.useState(0);
    React.useEffect(() => {
      if (!open) return undefined;
      const f = () => tick((n) => n + 1);
      window.addEventListener("scroll", f, true);
      window.addEventListener("resize", f);
      return () => { window.removeEventListener("scroll", f, true); window.removeEventListener("resize", f); };
    }, [open]);
    return open ? sideStyle(anchorRef.current, side, offset) : null;
  }

  // —— 弹层定位：贴触发器下沿，空间不足翻到上方；滚动 / 缩放时跟随 ——
  function usePopover(open, anchorRef, popRef, onClose, opts = {}) {
    const [pos, setPos] = React.useState(null);
    React.useLayoutEffect(() => {
      if (!open) { setPos(null); return undefined; }
      const place = () => {
        const a = anchorRef.current;
        if (!a) return;
        const r = a.getBoundingClientRect();
        const p = popRef.current;
        const ph = p ? p.offsetHeight : 240;
        const below = window.innerHeight - r.bottom;
        const up = below < ph + 8 && r.top > below;
        const width = opts.matchWidth === false ? undefined : Math.max(r.width, opts.minWidth || 0);
        const left = Math.min(r.left, window.innerWidth - (width || (p ? p.offsetWidth : 200)) - 8);
        setPos({ left: Math.max(8, left), top: up ? r.top - ph - 4 : r.bottom + 4, width });
      };
      place();
      const onDoc = (e) => { if (!popRef.current || popRef.current.contains(e.target) || (anchorRef.current && anchorRef.current.contains(e.target))) return; onClose(false); };
      window.addEventListener("scroll", place, true);
      window.addEventListener("resize", place);
      document.addEventListener("mousedown", onDoc);
      return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); document.removeEventListener("mousedown", onDoc); };
    }, [open]);
    return pos;
  }
  const portal = (node) => ReactDOM.createPortal(node, document.body);
  const norm = (options) => (options || []).map((o) => (typeof o === "object" && o !== null ? o : { value: o, label: String(o) }));
  const hilite = (text, q) => {
    if (!q) return text;
    const i = String(text).toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? text : [String(text).slice(0, i), h("mark", { key: "m" }, String(text).slice(i, i + q.length)), String(text).slice(i + q.length)];
  };

  // —— 人民币金额大写（悬停金额输入时显示，防止多一位 / 少一位）——
  function toCapital(n) {
    const v = Number(String(n == null ? "" : n).replace(/[^\d.-]/g, ""));
    if (!isFinite(v) || String(n).trim() === "") return "";
    if (Math.abs(v) >= 1e15) return "金额过大";
    const D = "零壹贰叁肆伍陆柒捌玖", U = ["", "拾", "佰", "仟"], B = ["", "万", "亿", "万亿"];
    const neg = v < 0, fen = Math.round(Math.abs(v) * 100), int = Math.floor(fen / 100), jiao = Math.floor(fen / 10) % 10, f = fen % 10;
    let out = "";
    if (int === 0) out = "零";
    else {
      const s = String(int); let zero = false;
      for (let i = 0; i < s.length; i++) {
        const d = +s[i], p = s.length - 1 - i, u = p % 4, b = p / 4 | 0;
        if (d === 0) zero = true;
        else { if (zero) out += "零"; zero = false; out += D[d] + U[u]; }
        if (u === 0 && b > 0 && s.slice(Math.max(0, i - 3), i + 1) !== "0000") out += B[b];
      }
    }
    if (!jiao && !f) return (neg ? "负" : "") + out + "元整";
    out = int ? out + "元" : "";
    out += (jiao ? D[jiao] + "角" : (int ? "零" : "")) + (f ? D[f] + "分" : "");
    return (neg ? "负" : "") + out;
  }

  // HoverHint：对应 reka-ui HoverCard（Vue 侧用 HoverCardRoot :open-delay=120 :close-delay=200）。
  //   悬停 / 聚焦触发器后出现；内容可移入、选中复制，带复制按钮；离开触发器与内容后延迟关闭；Esc 关闭。
  function HoverHint({ text, children, side = "top", openDelay = 120, closeDelay = 200 }) {
    const ref = React.useRef(null), timer = React.useRef(null);
    const [open, setOpen] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const style = useSide(open && !!text, ref, side);
    const schedule = (next, ms) => { clearTimeout(timer.current); timer.current = setTimeout(() => { setOpen(next); if (!next) setCopied(false); }, ms); };
    React.useEffect(() => () => clearTimeout(timer.current), []);
    const copy = () => {
      const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done); else done();
    };
    return h("div", { ref, style: { minWidth: 0 },
      onMouseEnter: () => schedule(true, openDelay), onMouseLeave: () => schedule(false, closeDelay),
      onFocus: () => schedule(true, 0), onBlur: () => schedule(false, closeDelay),
      onKeyDown: (e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } } },
      children,
      open && text && portal(h("div", { className: "kc-hint-pop", role: "dialog", "aria-label": "金额大写", style,
        onMouseEnter: () => clearTimeout(timer.current), onMouseLeave: () => schedule(false, closeDelay), onMouseDown: (e) => e.stopPropagation() },
        h("span", { className: "kc-hint-text" }, text),
        h("button", { type: "button", className: "kc-hint-copy", "aria-label": copied ? "已复制" : "复制", title: copied ? "已复制" : "复制", onMouseDown: (e) => e.preventDefault(), onClick: copy }, Ico(copied ? "check" : "copy", 13)))));
  }

  // MetricStrip：指标摘要条（替代 KitAtoms.MetricGrid）。items:[{label, value, tone:"danger"|"ok"|"warn"|"brand", tip, sub}]
  //   无外框、无圆角，项间一条短竖线分隔（每行首项的竖线被裁掉）；宽屏一行等分，窄容器自动折行。数值常规字体 + 等宽数字。
  function MetricStrip({ items, min = 150 }) {
    const color = { danger: "var(--danger-ink)", ok: "var(--ok-ink)", warn: "var(--warn-ink)", brand: "var(--brand)" };
    return h("div", { className: "kc-metrics", style: { gridTemplateColumns: "repeat(auto-fit, minmax(" + min + "px, 1fr))" } },
      ...(items || []).map((it, i) => h("div", { key: it.key || i, className: "kc-metric" },
        h("div", { className: "kc-metric-l" }, it.label, it.tip && h(Tip, { text: it.tip })),
        h("div", { className: "kc-metric-v", style: { color: color[it.tone] } }, it.value == null || it.value === "" ? "—" : it.value),
        it.sub && h("div", { className: "kc-metric-s" }, it.sub))));
  }

  function StatusTag({ tone = "neutral", children }) {
    return h("span", { className: "kc-tag " + tone, title: typeof children === "string" ? children : undefined }, children);
  }

  // —— Field：标签 + 控件 + 说明/错误（预留行，不挤动同行）——
  function Field({ label, required, tip, help, error, children, span, style }) {
    return h("div", { className: "kc-field", style: { gridColumn: span === "full" ? "1 / -1" : undefined, ...style } },
      h("div", { className: "kc-label" }, label, required && h("i", null, "*"), tip && h(Tip, { text: tip })),
      children,
      h("div", { className: "kc-msg" + (error ? " err" : ""), role: error ? "alert" : undefined, title: error || help || undefined }, error || help || ""));
  }

  // —— Input：前缀图标 / 单位后缀 / 「+」快速新建 / 错误 / 只读 ——
  function Input({ value, onChange, placeholder, prefixIcon, suffix, onCreate, createLabel = "新建", error, readOnly, disabled, size, align, type = "text", ariaLabel, style }) {
    return h("label", { className: "kc-ctl" + (size === "sm" ? " sm" : "") + (error ? " err" : "") + (readOnly ? " ro" : "") + (disabled ? " dis" : ""), style },
      prefixIcon && h("span", { className: "kc-pre" }, Ico(prefixIcon, 14)),
      h("input", { type, value: value == null ? "" : value, placeholder, readOnly, disabled, "aria-label": ariaLabel, "aria-invalid": error ? "true" : undefined,
        onChange: (e) => onChange && onChange(e.target.value), style: { textAlign: align, fontVariantNumeric: align === "right" ? "tabular-nums" : undefined } }),
      suffix && h("span", { className: "kc-sfx" }, suffix),
      onCreate && h("button", { type: "button", className: "kc-add", title: createLabel, "aria-label": createLabel, onClick: onCreate }, Ico("plus", 15)));
  }

  // —— NumberInput：右对齐、失焦千分位、单位后缀；值为数字或 "" ——
  function NumberInput({ value, onChange, decimals = 2, suffix, capital, ...rest }) {
    const [focus, setFocus] = React.useState(false);
    const shown = focus || value === "" || value == null ? (value == null ? "" : String(value))
      : Number(value).toLocaleString("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const input = h("span", { onFocus: () => setFocus(true), onBlur: () => setFocus(false), style: { display: "contents" } },
      h(Input, { ...rest, suffix, align: "right", value: shown, onChange: (t) => { const s = t.replace(/[^\d.-]/g, ""); onChange && onChange(s === "" ? "" : s); } }));
    return capital ? h(HoverHint, { text: value !== "" && value != null ? toCapital(value) : "" }, input) : input;
  }

  function Textarea({ value, onChange, placeholder, maxLength, error, readOnly, rows = 3, ariaLabel }) {
    const v = value == null ? "" : value;
    return h("label", { className: "kc-ctl area" + (error ? " err" : "") + (readOnly ? " ro" : "") },
      h("textarea", { value: v, rows, placeholder, maxLength, readOnly, "aria-label": ariaLabel, "aria-invalid": error ? "true" : undefined, onChange: (e) => onChange && onChange(e.target.value), style: { paddingBottom: maxLength ? 18 : undefined } }),
      maxLength && h("span", { className: "kc-count" }, v.length + "/" + maxLength));
  }

  // —— 列表弹层（Select / Combobox 共用）——
  function ListPop({ popRef, pos, items, value, hl, setHl, onPick, query, emptyText, footer, search }) {
    return portal(h("div", { ref: popRef, className: "kc-pop", role: "listbox", style: pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: "hidden", left: 0, top: 0 } },
      search || null,
      items.length ? items.map((o, i) => h("div", {
        key: String(o.value), role: "option", className: "kc-opt", "aria-selected": String(o.value) === String(value), "aria-disabled": o.disabled ? "true" : undefined, "data-hl": i === hl,
        onMouseEnter: () => setHl(i), onMouseDown: (e) => e.preventDefault(), onClick: () => !o.disabled && onPick(o),
      }, h("span", null, hilite(o.label, query), o.hint ? h("span", { className: "hint" }, "  " + o.hint) : null), String(o.value) === String(value) ? Ico("check", 14) : null))
        : h("div", { className: "kc-empty" }, emptyText || "无匹配项"),
      footer || null));
  }

  // —— Select（reka-ui SelectRoot/Trigger/Content/Item）：选项 > 8 自动带搜索 ——
  function Select({ value, onChange, options, placeholder = "请选择", searchable, clearable, error, disabled, size, ariaLabel }) {
    const opts = norm(options);
    const [open, setOpen] = React.useState(false);
    const [q, setQ] = React.useState("");
    const [hl, setHl] = React.useState(0);
    const anchor = React.useRef(null), pop = React.useRef(null), searchRef = React.useRef(null), trig = React.useRef(null);
    const close = (focus = true) => { setOpen(false); setQ(""); if (focus && trig.current) trig.current.focus(); };
    const pos = usePopover(open, anchor, pop, close);
    const withSearch = searchable != null ? searchable : opts.length > 8;
    const list = opts.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
    const cur = opts.find((o) => String(o.value) === String(value));
    const openList = () => { if (disabled) return; setHl(Math.max(0, opts.findIndex((o) => String(o.value) === String(value)))); setOpen(true); };
    React.useEffect(() => { if (open && withSearch && searchRef.current) searchRef.current.focus(); }, [open]);
    const pick = (o) => { onChange && onChange(o.value); close(); };
    const onKey = (e) => {
      if (!open) { if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); openList(); } return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setHl((i) => Math.min(list.length - 1, i + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHl((i) => Math.max(0, i - 1)); }
      else if (e.key === "Home") { e.preventDefault(); setHl(0); }
      else if (e.key === "End") { e.preventDefault(); setHl(list.length - 1); }
      else if (e.key === "Enter") { e.preventDefault(); if (list[hl]) pick(list[hl]); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") close(false);
    };
    return h("div", { ref: anchor, className: "kc-ctl" + (size === "sm" ? " sm" : "") + (error ? " err" : "") + (disabled ? " dis" : ""), "data-open": open, onKeyDown: onKey },
      h("button", { ref: trig, type: "button", className: "kc-trigger", role: "combobox", "aria-haspopup": "listbox", "aria-expanded": open, "aria-label": ariaLabel, disabled, onClick: () => (open ? close() : openList()) },
        h("span", { className: cur ? "val" : "ph" }, cur ? cur.label : placeholder),
        h("span", { style: { display: "flex", alignItems: "center", gap: 2 } },
          clearable && cur && h("span", { className: "kc-clear", role: "button", "aria-label": "清除", onClick: (e) => { e.stopPropagation(); onChange && onChange(""); } }, Ico("x", 12)),
          h("span", { className: "kc-chev" }, Ico("chevron-down", size === "sm" ? 12 : 14)))),
      open && h(ListPop, { popRef: pop, pos, items: list, value, hl, setHl, onPick: pick, query: q,
        search: withSearch ? h("label", { className: "kc-search" }, Ico("search", 13, "var(--ink-faint)"), h("input", { ref: searchRef, value: q, placeholder: "搜索", "aria-label": "搜索选项", onChange: (e) => { setQ(e.target.value); setHl(0); } })) : null }));
  }

  // —— Combobox（reka-ui Combobox）：输入即过滤、命中高亮；可带「+ 新建 xxx」——
  function Combobox({ value, onChange, options, placeholder = "输入关键词检索", onCreate, createLabel = "新建", error, disabled, ariaLabel }) {
    const opts = norm(options);
    const cur = opts.find((o) => String(o.value) === String(value));
    const [text, setText] = React.useState(cur ? cur.label : "");
    const [open, setOpen] = React.useState(false);
    const [hl, setHl] = React.useState(0);
    const anchor = React.useRef(null), pop = React.useRef(null), inp = React.useRef(null);
    React.useEffect(() => { setText(cur ? cur.label : ""); }, [value]);
    const close = () => { setOpen(false); setText(cur ? cur.label : ""); };
    const pos = usePopover(open, anchor, pop, close);
    const q = cur && text === cur.label ? "" : text;
    const list = opts.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
    const pick = (o) => { onChange && onChange(o.value); setText(o.label); setOpen(false); };
    const onKey = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else setHl((i) => Math.min(list.length - 1, i + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHl((i) => Math.max(0, i - 1)); }
      else if (e.key === "Enter" && open) { e.preventDefault(); if (list[hl]) pick(list[hl]); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    };
    return h("div", { ref: anchor, className: "kc-ctl" + (error ? " err" : "") + (disabled ? " dis" : ""), "data-open": open },
      h("span", { className: "kc-pre" }, Ico("search", 14)),
      h("input", { ref: inp, role: "combobox", "aria-expanded": open, "aria-autocomplete": "list", "aria-label": ariaLabel, value: text, placeholder, disabled,
        onFocus: () => setOpen(true), onChange: (e) => { setText(e.target.value); setOpen(true); setHl(0); }, onKeyDown: onKey }),
      cur && !disabled && h("button", { type: "button", className: "kc-clear", style: { marginRight: 6 }, "aria-label": "清除", onClick: () => { onChange && onChange(""); setText(""); inp.current && inp.current.focus(); } }, Ico("x", 12)),
      onCreate && h("button", { type: "button", className: "kc-add", title: createLabel, "aria-label": createLabel, onClick: () => onCreate(q) }, Ico("plus", 15)),
      open && h(ListPop, { popRef: pop, pos, items: list, value, hl, setHl, onPick: pick, query: q, emptyText: "没有匹配「" + q + "」的记录",
        footer: onCreate && q ? h("div", { className: "kc-create" }, h("div", { className: "kc-opt", onMouseDown: (e) => e.preventDefault(), onClick: () => { setOpen(false); onCreate(q); } }, h("span", { style: { color: "var(--brand)" } }, "+ " + createLabel + "「" + q + "」"))) : null }));
  }

  // —— DatePicker（reka-ui DatePicker）：可直接输入 YYYY-MM-DD，或从日历选；方向键在日历内移动 ——
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parse = (s) => { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || "").trim()); if (!m) return null; const d = new Date(+m[1], +m[2] - 1, +m[3]); return d.getMonth() === +m[2] - 1 ? d : null; };
  function DatePicker({ value, onChange, placeholder = "YYYY-MM-DD", error, disabled, readOnly, ariaLabel, min, max }) {
    const outOfRange = (d) => (min && fmt(d) < min) || (max && fmt(d) > max);
    const [open, setOpen] = React.useState(false);
    const [text, setText] = React.useState(value || "");
    const sel = parse(value);
    const [view, setView] = React.useState(sel || new Date());
    const [hl, setHl] = React.useState(sel || new Date());
    const [mode, setMode] = React.useState("day");   // day | month | year
    const ym = (y, m) => y + "-" + pad(m + 1);
    const monthOut = (y, m) => (min && ym(y, m) < min.slice(0, 7)) || (max && ym(y, m) > max.slice(0, 7));
    const yearOut = (y) => (min && String(y) < min.slice(0, 4)) || (max && String(y) > max.slice(0, 4));
    const anchor = React.useRef(null), pop = React.useRef(null), inp = React.useRef(null);
    React.useEffect(() => { setText(value || ""); }, [value]);
    const close = (focus) => { setOpen(false); if (focus && inp.current) inp.current.focus(); };
    const pos = usePopover(open, anchor, pop, close, { matchWidth: false });
    const commit = (d) => { if (outOfRange(d)) return; onChange && onChange(fmt(d)); setText(fmt(d)); close(true); };
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const today = fmt(new Date());
    const move = (n) => { const d = new Date(hl); d.setDate(d.getDate() + n); setHl(d); setView(d); };
    const onKey = (e) => {
      if (!open) { if (e.key === "ArrowDown" && e.altKey) { e.preventDefault(); setOpen(true); } return; }
      const map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (map[e.key] != null) { e.preventDefault(); move(map[e.key]); }
      else if (e.key === "Enter") { e.preventDefault(); commit(hl); }
      else if (e.key === "Escape") { e.preventDefault(); close(true); }
    };
    const invalid = text && (!parse(text) || outOfRange(parse(text)));
    return h("div", { ref: anchor, className: "kc-ctl" + (error || invalid ? " err" : "") + (disabled ? " dis" : "") + (readOnly ? " ro" : ""), "data-open": open, onKeyDown: onKey },
      h("input", { ref: inp, value: text, placeholder, disabled, readOnly, "aria-label": ariaLabel, "aria-invalid": error || invalid ? "true" : undefined, style: { fontVariantNumeric: "tabular-nums" },
        onChange: (e) => { setText(e.target.value); const d = parse(e.target.value); if (d) { setView(d); setHl(d); onChange && onChange(fmt(d)); } else if (!e.target.value) onChange && onChange(""); } }),
      h("button", { type: "button", className: "kc-add", "aria-label": "打开日历", disabled: disabled || readOnly, onClick: () => { setHl(sel || new Date()); setView(sel || new Date()); setMode("day"); setOpen(!open); } }, Ico("calendar", 15)),
      open && portal(h("div", { ref: pop, className: "kc-pop kc-cal", role: "dialog", "aria-label": "选择日期", style: pos ? { left: pos.left, top: pos.top } : { visibility: "hidden", left: 0, top: 0 } },
        h("div", { className: "kc-cal-h" },
          h("button", { type: "button", "aria-label": mode === "day" ? "上个月" : mode === "month" ? "上一年" : "前 12 年",
            onClick: () => setView(new Date(view.getFullYear() - (mode === "month" ? 1 : mode === "year" ? 12 : 0), view.getMonth() - (mode === "day" ? 1 : 0), 1)) }, Ico("chevron-left", 15)),
          h("button", { type: "button", className: "kc-cal-title", "aria-label": mode === "day" ? "选择月份" : mode === "month" ? "选择年份" : "返回日期",
            onClick: () => setMode(mode === "day" ? "month" : mode === "month" ? "year" : "day") },
            mode === "day" ? view.getFullYear() + " 年 " + (view.getMonth() + 1) + " 月" : mode === "month" ? view.getFullYear() + " 年" : (view.getFullYear() - 5) + " – " + (view.getFullYear() + 6),
            Ico(mode === "year" ? "chevron-up" : "chevron-down", 13)),
          h("button", { type: "button", "aria-label": mode === "day" ? "下个月" : mode === "month" ? "下一年" : "后 12 年",
            onClick: () => setView(new Date(view.getFullYear() + (mode === "month" ? 1 : mode === "year" ? 12 : 0), view.getMonth() + (mode === "day" ? 1 : 0), 1)) }, Ico("chevron-right", 15))),
        mode === "month" && h("div", { className: "kc-cal-mg" },
          ...Array.from({ length: 12 }, (_, m) => h("button", { key: m, type: "button", disabled: !!monthOut(view.getFullYear(), m),
            className: (sel && sel.getFullYear() === view.getFullYear() && sel.getMonth() === m ? "sel" : "") + (new Date().getFullYear() === view.getFullYear() && new Date().getMonth() === m ? " today" : ""),
            onClick: () => { setView(new Date(view.getFullYear(), m, 1)); setMode("day"); } }, (m + 1) + " 月"))),
        mode === "year" && h("div", { className: "kc-cal-mg" },
          ...Array.from({ length: 12 }, (_, i) => view.getFullYear() - 5 + i).map((y) => h("button", { key: y, type: "button", disabled: !!yearOut(y),
            className: (sel && sel.getFullYear() === y ? "sel" : "") + (new Date().getFullYear() === y ? " today" : ""),
            onClick: () => { setView(new Date(y, view.getMonth(), 1)); setMode("month"); } }, y))),
        mode === "day" && h("div", { className: "kc-cal-g", role: "grid" },
          ...["一", "二", "三", "四", "五", "六", "日"].map((w) => h("span", { key: w, className: "wd" }, w)),
          ...days.map((d) => h("button", { key: fmt(d), type: "button", "data-hl": fmt(d) === fmt(hl), disabled: !!outOfRange(d), title: outOfRange(d) ? (min && fmt(d) < min ? "不能早于 " + min : "不能晚于 " + max) : undefined,
            className: [d.getMonth() !== view.getMonth() ? "out" : "", fmt(d) === today ? "today" : "", sel && fmt(d) === fmt(sel) ? "sel" : ""].join(" "),
            onClick: () => commit(d) }, d.getDate()))),
        h("div", { className: "kc-cal-f" },
          h("button", { type: "button", onClick: () => { onChange && onChange(""); setText(""); close(true); } }, "清除"),
          h("button", { type: "button", disabled: !!outOfRange(new Date()), onClick: () => commit(new Date()) }, "今天")))));
  }

  // —— Tip「?」：对应 reka-ui Tooltip（Vue 侧 ContextHelp）。悬停 / 键盘聚焦打开，内容可悬停继续阅读，
  //   点按切换（触摸），Esc 关闭且不因焦点仍在入口而立即重开；不搬走焦点（规格 §17）——
  function Tip({ text, label = "说明", side = "top", openDelay = 150, closeDelay = 120 }) {
    const ref = React.useRef(null), timer = React.useRef(null);
    const [open, setOpen] = React.useState(false);
    const dismissed = React.useRef(false);
    const style = useSide(open, ref, side);
    const schedule = (next, ms) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(next), ms); };
    React.useEffect(() => () => clearTimeout(timer.current), []);
    return h(React.Fragment, null,
      h("button", { ref, type: "button", className: "kc-tip", "aria-label": "查看" + label + "：" + text, "aria-expanded": open,
        onMouseEnter: () => schedule(true, openDelay), onMouseLeave: () => schedule(false, closeDelay),
        onFocus: () => { if (!dismissed.current) schedule(true, 0); }, onBlur: () => { dismissed.current = false; schedule(false, closeDelay); },
        onKeyDown: (e) => { if (e.key === "Escape" && open) { e.stopPropagation(); dismissed.current = true; setOpen(false); } },
        onClick: (e) => { e.preventDefault(); e.stopPropagation(); clearTimeout(timer.current); setOpen((o) => !o); } }, "?"),
      open && portal(h("div", { className: "kc-tip-pop", role: "tooltip", style,
        onMouseEnter: () => clearTimeout(timer.current), onMouseLeave: () => schedule(false, closeDelay) }, text)));
  }

  // —— Tabs（reka-ui Tabs）：下划线滑动、可带计数、方向键切换 ——
  function Tabs({ tabs, value, onChange, ariaLabel }) {
    const ref = React.useRef(null);
    const [ink, setInk] = React.useState(null);
    React.useLayoutEffect(() => {
      const el = ref.current && ref.current.querySelector("[aria-selected=true]");
      if (el) setInk({ left: el.offsetLeft, width: el.offsetWidth });
    }, [value, tabs.length]);
    const onKey = (e) => {
      const i = tabs.findIndex((t) => t.key === value);
      const n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!n) return;
      e.preventDefault();
      const next = tabs[(i + n + tabs.length) % tabs.length];
      onChange(next.key);
      setTimeout(() => { const b = ref.current && ref.current.querySelector("[aria-selected=true]"); if (b) b.focus(); });
    };
    return h("div", { ref, className: "kc-tabs", role: "tablist", "aria-label": ariaLabel, onKeyDown: onKey },
      ...tabs.map((t) => h("button", { key: t.key, type: "button", role: "tab", "aria-selected": t.key === value, tabIndex: t.key === value ? 0 : -1, onClick: () => onChange(t.key) },
        t.label, t.count != null && h("span", { className: "cnt" }, t.count))),
      ink && h("span", { className: "kc-ink", style: ink }));
  }

  window.KitControls = { Field, Input, NumberInput, Textarea, Select, Combobox, DatePicker, Tip, Tabs, StatusTag, HoverHint, MetricStrip, toCapital };
  window.KitControlsPreload = function () { return null; };
})();
