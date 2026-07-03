// InvoiceShared — 发票模块共享基座（反馈轮 7）
// 隐藏 x-import 预加载注册 window.INV，供三个发票页面复用，实现跨页/跨页签实时联动：
//   · 发票识别页 InvoiceScreen（识别中心）—— 单一工作台 + 字段校对/打印排版子模式
//   · 发票台账页 InvoiceLedgerScreen（资金管理）—— 左树右表 · 列表/打印/修改三呈现
//   · 单张编辑页签 InvoiceEditScreen —— 左原图右字段
// window.INV = { 数据 store(subscribe/update/add/softDel/get/useStore) + 置信度助手 + 共享组件 }
(function () {
  if (window.INV) { window.INVSharedScreen = window.INVSharedScreen || function () { return null; }; return; }
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), modal: () => {}, undoToast: () => {} };
  const DS = () => window.DesignSystem_e3d871 || {};

  // ===== 格式化 =====
  const money = (v) => (v || v === 0 ? "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2 }) : "待补");

  // ===== 识别字段与置信度 =====
  const FIELD_DEFS = [
    { key: "number", label: "单据编号", mono: true },
    { key: "date", label: "开票日期", mono: true },
    { key: "buyer", label: "购买方" },
    { key: "seller", label: "供应商" },
    { key: "type", label: "票据类型" },
    { key: "total", label: "价税合计", mono: true },
    { key: "tax", label: "税额", mono: true },
    { key: "rate", label: "税率", mono: true },
    { key: "amount", label: "不含税金额", mono: true },
  ];
  const fieldConf = (inv, k) => { const c = inv.conf ? inv.conf[k] : null; return c == null ? 99 : c; };
  const fieldNote = (inv, k) => (inv.flags ? inv.flags[k] : null);
  const fieldLevel = (inv, k) => {
    if (inv.confirmed && inv.confirmed[k]) return "ok";
    const c = fieldConf(inv, k);
    if (c < 80) return "danger";
    if (c < 95 || fieldNote(inv, k)) return "warn";
    return "ok";
  };
  const badFields = (inv) => FIELD_DEFS.filter((d) => fieldLevel(inv, d.key) !== "ok");
  const isAllGreen = (inv) => badFields(inv).length === 0;
  const worstOf = (inv) => {
    let w = "ok";
    FIELD_DEFS.forEach((d) => { const lv = fieldLevel(inv, d.key); if (lv === "danger") w = "danger"; else if (lv === "warn" && w === "ok") w = "warn"; });
    return w;
  };
  const CONF_OK = { number: 99, date: 99, buyer: 98, seller: 98, type: 99, total: 99, tax: 99, rate: 99, amount: 99 };

  function statusOf(inv) {
    if (inv.status === "recognizing") return { tone: "brand", text: "识别中 " + Math.floor(inv.progress || 0) + "%" };
    if (inv.status === "dup") return { tone: "danger", text: "重复已排除" };
    if (inv.status === "done") {
      if (inv.account === "posted") return { tone: "ok", text: "已归档" };
      const w = worstOf(inv);
      if (w === "danger") return { tone: "danger", text: "含低置信" };
      if (w === "warn") return { tone: "warn", text: "待确认" };
      return { tone: "ok", text: "建议通过" };
    }
    return { tone: "neutral", text: "待识别" };
  }

  const OWN = "个人开支"; // 归属第二类出口（CONTEXT.md）

  // ===== 演示数据（识别队列 + 台账） =====
  function seed() {
    const R = (o) => ({ size: "1.1 MB", pages: 1, source: "scan", printCount: 0, review: true, account: "", status: "done", ...o });
    const review = [
      R({ id: "inv_g1", name: "扫描件_0701_01.pdf", number: "58761309", date: "2026-07-01", buyer: "广州瑞航建设工程有限公司", buyerTaxNo: "91440101MA5CUKXXXX", seller: "佛山市南海区大板东建材商行", sellerTaxNo: "92440605MA53XXXX", type: "增值税专用发票", amount: 40000, tax: 5200, total: 45200, rate: "13%", project: "车陂商业大楼", remark: "地砖 800×800", conf: { ...CONF_OK } }),
      R({ id: "inv_g2", name: "扫描件_0701_02.pdf", number: "58761415", date: "2026-07-01", buyer: "广州瑞航建设工程有限公司", buyerTaxNo: "91440101MA5CUKXXXX", seller: "广州市天河建材经营部", sellerTaxNo: "91440106MA59F1XXXX", type: "增值税普通发票", amount: 18087.38, tax: 542.62, total: 18630, rate: "3%", project: "车陂商业大楼", remark: "瓷砖胶一批", conf: { ...CONF_OK, seller: 96 } }),
      R({ id: "inv_y1", name: "扫描件_0702_01.pdf", number: "58761523", date: "2026-07-02", buyer: "广州瑞航建设工程有限公司", buyerTaxNo: "91440101MA5CUKXXXX", seller: "广州市白云区永固水泥制品厂", sellerTaxNo: "91440111MA9W3XXXX", type: "增值税普通发票", amount: 9572.82, tax: 287.18, total: 9860, rate: "3%", project: "车陂商业大楼", remark: "水泥制品", conf: { ...CONF_OK, total: 88 }, flags: { total: "识别金额与票面大写「玖仟捌佰陆拾元整」校验不符，请对照原图核对" } }),
      R({ id: "inv_r1", name: "扫描件_0702_02.pdf", number: "58761538", date: "2026-07-02", buyer: "广州瑞航建设工程有限公司", buyerTaxNo: "91440101MA5CUKXXXX", seller: "佛山市禅城区宏图五金商行", sellerTaxNo: "92440604MA52XXXX", type: "增值税普通发票", amount: 3320.39, tax: 99.61, total: 3420, rate: "3%", project: "", remark: "五金配件", conf: { ...CONF_OK, number: 62 }, flags: { number: "票面号码打印模糊，OCR 置信度低，请对照原图核对" } }),
    ];
    const P = (o) => ({ size: "1.0 MB", pages: 1, source: "scan", review: false, account: "posted", status: "done", printCount: 0, conf: { ...CONF_OK }, ...o });
    const ledger = [
      P({ id: "inv_p1", number: "58760021", date: "2026-06-28", buyer: "广州瑞航建设工程有限公司", seller: "广州市大板东建材有限公司", type: "增值税专用发票", amount: 84070.8, tax: 10929.2, total: 95000, rate: "13%", project: "车陂商业大楼", remark: "岩板一批", printCount: 2, lastPrintedAt: "2026-06-29" }),
      P({ id: "inv_p2", number: "58760544", date: "2026-06-25", buyer: "广州瑞航建设工程有限公司", seller: "广州市海珠区泰晟装饰材料", type: "增值税专用发票", amount: 49203.5, tax: 6396.5, total: 55600, rate: "13%", project: "车陂商业大楼", remark: "铝扣板" }),
      P({ id: "inv_p3", number: "58760712", date: "2026-06-20", buyer: "广州瑞航建设工程有限公司", seller: "广州荣帆照明有限公司", type: "增值税普通发票", amount: 20522.33, tax: 615.67, total: 21138, rate: "3%", project: "车陂商业大楼", remark: "灯具", printCount: 1, lastPrintedAt: "2026-06-22" }),
      P({ id: "inv_p4", number: "58761020", date: "2026-06-18", buyer: "广州瑞航建设工程有限公司", seller: "汇丰水泥制品有限公司", type: "增值税专用发票", amount: 205840.71, tax: 26759.29, total: 232600, rate: "13%", project: "合和新城", remark: "商品混凝土 C30" }),
      P({ id: "inv_p5", number: "58761180", date: "2026-06-15", buyer: "广州瑞航建设工程有限公司", seller: "花城珠江电线电缆有限公司", type: "增值税专用发票", amount: 45840.71, tax: 5959.29, total: 51800, rate: "13%", project: "合和新城", remark: "电缆 YJV" }),
      P({ id: "inv_p6", number: "58761260", date: "2026-06-12", buyer: "广州瑞航建设工程有限公司", seller: "穗建五金机电经营部", type: "增值税普通发票", amount: 12194.17, tax: 365.83, total: 12560, rate: "3%", project: "科学城人才公寓", remark: "五金机电" }),
      P({ id: "inv_o1", number: "58761301", date: "2026-06-10", buyer: "张伟", seller: "中国石化广州分公司", type: "增值税普通发票", amount: 485.44, tax: 14.56, total: 500, rate: "3%", project: OWN, remark: "加油" }),
      P({ id: "inv_o2", number: "58761333", date: "2026-06-08", buyer: "张伟", seller: "广州酒家集团利口福", type: "增值税普通发票", amount: 1165.05, tax: 34.95, total: 1200, rate: "3%", project: OWN, remark: "业务招待" }),
      P({ id: "inv_x1", number: "58769001", date: "2026-06-05", buyer: "广州瑞航建设工程有限公司", seller: "广州市白云区永固水泥制品厂", type: "增值税普通发票", amount: 9572.82, tax: 287.18, total: 9860, rate: "3%", project: "", remark: "水泥制品", source: "excel" }),
      P({ id: "inv_x2", number: "58769002", date: "2026-06-03", buyer: "广州瑞航建设工程有限公司", seller: "佛山市禅城区宏图五金商行", type: "增值税普通发票", amount: 3320.39, tax: 99.61, total: 3420, rate: "3%", project: "", remark: "五金配件", source: "excel" }),
    ];
    return review.concat(ledger);
  }

  // ===== 数据 store =====
  const listeners = new Set();
  let invoices = seed();
  const notify = () => listeners.forEach((f) => f());
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const update = (id, patch) => { invoices = invoices.map((x) => (x.id === id ? { ...x, ...patch } : x)); notify(); };
  const add = (arr) => { invoices = [...arr, ...invoices]; notify(); };
  const get = (id) => invoices.find((x) => x.id === id);
  const softDel = (inv, verb) => {
    update(inv.id, { discarded: true });
    UI().undoToast("已" + (verb || "删除") + "「" + (inv.number ? inv.number.slice(-8) : inv.name) + "」", () => update(inv.id, { discarded: false }));
  };
  const live = () => invoices.filter((i) => !i.discarded);
  const projectsList = () => { const d = window.KIT_DATA || {}; return (d.projects || []).map((p) => p.name); };

  function useStore() {
    const [, f] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => subscribe(f), []);
    return { all: invoices, live: live(), update, add, get, softDel };
  }

  // 上传 mock：2 个文件进「识别中」，定时推进完成
  function mockUpload() {
    const ts = Date.now();
    return [
      { id: "inv_u1_" + ts, name: "扫描件_0703_01.pdf", size: "0.8 MB", pages: 1, number: "58761677", date: "2026-07-03", buyer: "广州瑞航建设工程有限公司", buyerTaxNo: "91440101MA5CUKXXXX", seller: "广州市天河建材经营部", sellerTaxNo: "91440106MA59F1XXXX", type: "增值税普通发票", amount: 12000, tax: 360, total: 12360, rate: "3%", project: "车陂商业大楼", remark: "填缝剂/辅料", status: "recognizing", progress: 0, fresh: true, review: true, account: "", source: "scan", printCount: 0, conf: { ...CONF_OK } },
      { id: "inv_u2_" + ts, name: "扫描件_0703_02.pdf", size: "1.2 MB", pages: 1, number: "58761742", date: "2026-07-03", buyer: "广州瑞航建设工程有限公司", buyerTaxNo: "91440101MA5CUKXXXX", seller: "佛山市南海区大板东建材商行", sellerTaxNo: "92440605MA53XXXX", type: "增值税专用发票", amount: 23000, tax: 2990, total: 25990, rate: "13%", project: "车陂商业大楼", remark: "地砖补货", status: "recognizing", progress: 0, fresh: true, review: true, account: "", source: "scan", printCount: 0, conf: { ...CONF_OK, date: 84 }, flags: { date: "日期区域被印章遮挡，请确认" } },
    ];
  }

  // ===== 共享组件 =====

  // 发票原图占位（SVG 示意，rotation 支持）
  function OriginalPreview({ inv, rotation = 0, height, showBar = true }) {
    const { IconButton } = DS();
    const [rot, setRot] = React.useState(rotation);
    React.useEffect(() => setRot(rotation), [inv && inv.id]);
    return (
      React.createElement("div", { style: { display: "flex", flexDirection: "column", height: height || "100%", minHeight: 0 } },
        showBar && React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", flex: "none" } },
          React.createElement("div", { style: { fontSize: 13, fontWeight: 800 } }, "发票原图"),
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
            React.createElement(IconButton, { icon: "zoom-in", title: "放大预览", onClick: () => UI().modal({ title: "原图放大 · " + (inv.number ? inv.number.slice(-8) : ""), width: 560, bodyHTML: '<div style="height:360px;display:grid;place-items:center;background:var(--surface-2);border-radius:8px;color:var(--brand);font-size:52px;font-weight:800;opacity:.35">票</div>' }) }),
            React.createElement(IconButton, { icon: "rotate-cw", title: "旋转 90°", onClick: () => setRot((r) => (r + 90) % 360) })
          )
        ),
        React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "var(--surface-2)", padding: 20, overflow: "hidden" } },
          React.createElement("div", { style: { transform: "rotate(" + rot + "deg)", transition: "transform .25s var(--ease-snappy)", width: "86%", maxWidth: 460 } },
            invoiceSvg(inv)
          ),
          showBar && React.createElement("div", { style: { fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" } }, inv.name || (inv.number || "")),
          showBar && React.createElement("div", { style: { fontSize: 11, color: "var(--ink-faint)" } }, "灰底占位示意 · 实际接入后显示扫描原件")
        )
      )
    );
  }
  function invoiceSvg(inv) {
    return React.createElement("svg", { viewBox: "0 0 440 300", style: { width: "100%", filter: "drop-shadow(0 2px 6px rgba(31,35,41,.10))" }, xmlns: "http://www.w3.org/2000/svg" },
      React.createElement("rect", { x: 4, y: 4, width: 432, height: 292, rx: 8, fill: "#fff", stroke: "var(--line-strong)" }),
      React.createElement("text", { x: 220, y: 40, textAnchor: "middle", fontSize: 17, fontWeight: 800, fill: "var(--ink-faint)", letterSpacing: 8 }, inv.type && inv.type !== "—" ? inv.type : "增值税发票"),
      React.createElement("text", { x: 416, y: 26, textAnchor: "end", fontSize: 9, fill: "var(--ink-faint)", fontFamily: "var(--font-mono)" }, "No." + (inv.number || "————")),
      React.createElement("rect", { x: 24, y: 60, width: 188, height: 46, rx: 4, fill: "var(--surface-3)" }),
      React.createElement("rect", { x: 228, y: 60, width: 188, height: 46, rx: 4, fill: "var(--surface-3)" }),
      React.createElement("text", { x: 34, y: 79, fontSize: 9, fill: "var(--ink-faint)" }, "购买方"),
      React.createElement("text", { x: 34, y: 96, fontSize: 8, fill: "var(--ink-soft)" }, (inv.buyer || "").slice(0, 16)),
      React.createElement("text", { x: 238, y: 79, fontSize: 9, fill: "var(--ink-faint)" }, "销售方"),
      React.createElement("text", { x: 238, y: 96, fontSize: 8, fill: "var(--ink-soft)" }, (inv.seller || "").slice(0, 16)),
      React.createElement("rect", { x: 24, y: 120, width: 392, height: 96, fill: "none", stroke: "var(--line)" }),
      React.createElement("line", { x1: 24, y1: 142, x2: 416, y2: 142, stroke: "var(--line)" }),
      React.createElement("text", { x: 34, y: 236, fontSize: 10, fill: "var(--ink-faint)" }, "价税合计"),
      React.createElement("text", { x: 406, y: 236, textAnchor: "end", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", fill: "var(--ink-soft)" }, money(inv.total)),
      React.createElement("text", { x: 34, y: 262, fontSize: 9, fill: "var(--ink-faint)" }, "备注：" + (inv.remark || "—")),
      React.createElement("g", { transform: "rotate(-12 372 250)" },
        React.createElement("circle", { cx: 372, cy: 250, r: 28, fill: "none", stroke: "rgba(220,38,38,.4)", strokeWidth: 1.5 }),
        React.createElement("text", { x: 372, y: 254, textAnchor: "middle", fontSize: 8, fill: "rgba(220,38,38,.55)", fontWeight: 700 }, "发票专用章")
      )
    );
  }

  // 两列紧凑字段网格（置信度=边框色+角标%，黄/红出「确认」）
  function FieldGrid({ inv, f, onField, onConfirm, projects }) {
    const { Icon } = DS();
    const cell = (d, full) => {
      const level = fieldLevel(inv, d.key);
      const confirmed = !!(inv.confirmed && inv.confirmed[d.key]);
      const conf = fieldConf(inv, d.key);
      const note = fieldNote(inv, d.key);
      const C = {
        ok: { bd: "var(--line-strong)", bg: "#fff", chipBg: "var(--ok-soft)", chipInk: "var(--ok-ink)" },
        warn: { bd: "var(--warn)", bg: "var(--warn-soft)", chipBg: "var(--warn-soft)", chipInk: "var(--warn-ink)" },
        danger: { bd: "var(--danger)", bg: "var(--danger-soft)", chipBg: "var(--danger-soft)", chipInk: "var(--danger-ink)" },
      }[level];
      return React.createElement("div", { key: d.key, style: full ? { gridColumn: "1 / -1" } : null },
        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 } },
          React.createElement("span", { style: { fontSize: 11, fontWeight: 600, color: "var(--ink-soft)" } }, d.label),
          level === "ok"
            ? React.createElement("span", { style: { fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--ink-faint)" } }, confirmed ? "已确认" : conf + "%")
            : React.createElement("button", { onClick: () => onConfirm(d.key), title: "人工确认该字段无误", style: { display: "inline-flex", alignItems: "center", gap: 3, border: 0, background: C.chipBg, color: C.chipInk, borderRadius: 999, padding: "2px 7px", fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", cursor: "pointer" } },
                React.createElement(Icon, { name: "check", size: 10 }), conf + "% 确认")
        ),
        React.createElement("input", { value: f[d.key] == null ? "" : f[d.key], onChange: (e) => onField(d.key, e.target.value), style: { width: "100%", boxSizing: "border-box", border: "1.5px solid " + C.bd, background: C.bg, borderRadius: 8, padding: "7px 9px", fontSize: 12.5, fontFamily: d.mono ? "var(--font-mono)" : "inherit", outline: "none" } }),
        note && level !== "ok" && React.createElement("div", { style: { marginTop: 3, fontSize: 10.5, lineHeight: 1.5, color: level === "danger" ? "var(--danger-ink)" : "var(--warn-ink)" } }, note)
      );
    };
    const plain = (key, label, opts) => {
      const warn = key === "buyerTaxNo" && !f[key];
      return React.createElement("div", { key: key, style: opts && opts.full ? { gridColumn: "1 / -1" } : null },
        React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: "var(--ink-soft)", marginBottom: 3 } }, label, warn && React.createElement("span", { style: { color: "var(--warn-ink)", marginLeft: 4 } }, "⚠ 缺税号")),
        opts && opts.select
          ? React.createElement("select", { value: f[key] || "", onChange: (e) => onField(key, e.target.value), style: { width: "100%", boxSizing: "border-box", border: "1.5px solid " + (warn ? "var(--warn)" : (opts.accent ? "var(--brand)" : "var(--line-strong)")), background: warn ? "var(--warn-soft)" : (opts.accent ? "var(--brand-soft)" : "#fff"), borderRadius: 8, padding: "7px 9px", fontSize: 12.5, cursor: "pointer" } },
              React.createElement("option", { value: "" }, opts.placeholder || "— 请选择 —"),
              (opts.options || []).map((o) => React.createElement("option", { key: o, value: o }, o)))
          : React.createElement("input", { value: f[key] || "", onChange: (e) => onField(key, e.target.value), placeholder: opts && opts.placeholder, style: { width: "100%", boxSizing: "border-box", border: "1.5px solid " + (warn ? "var(--warn)" : "var(--line-strong)"), background: warn ? "var(--warn-soft)" : "#fff", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, fontFamily: opts && opts.mono ? "var(--font-mono)" : "inherit", outline: "none" } })
      );
    };
    return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px" } },
        ...FIELD_DEFS.map((d) => cell(d, false))
      ),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px" } },
        plain("buyerTaxNo", "购买方税号", { mono: true, placeholder: "税号为空，请补充" }),
        plain("sellerTaxNo", "供应商税号", { mono: true }),
        plain("project", "对应归属", { select: true, accent: true, options: [OWN].concat(projects || projectsList()), placeholder: "— 选择项目 或 个人开支 —", full: true }),
        plain("remark", "票面备注", { full: true })
      )
    );
  }

  // 货物明细（可折叠）
  function ItemsTable({ inv, defaultOpen }) {
    const [open, setOpen] = React.useState(!!defaultOpen);
    const { Icon } = DS();
    const items = inv.items || [{ name: inv.remark || "货物一批", spec: "—", unit: "批", quantity: 1, unitPrice: (Number(inv.total || 0) - Number(inv.tax || 0)).toFixed(2), amount: (Number(inv.total || 0) - Number(inv.tax || 0)).toFixed(2), taxRate: inv.rate, taxAmount: inv.tax }];
    return React.createElement("div", null,
      React.createElement("button", { onClick: () => setOpen(!open), style: { display: "flex", alignItems: "center", gap: 6, width: "100%", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)", padding: "8px 10px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", cursor: "pointer" } },
        React.createElement(Icon, { name: open ? "chevron-down" : "chevron-right", size: 14 }),
        "货物明细", React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--ink-faint)" } }, items.length + " 行")
      ),
      open && React.createElement("div", { style: { border: "1px solid var(--line)", borderTop: 0, borderRadius: "0 0 8px 8px", overflow: "auto", maxHeight: 160 } },
        React.createElement("table", { style: { width: "100%", minWidth: 520, borderCollapse: "collapse" } },
          React.createElement("thead", { style: { background: "var(--surface-2)", position: "sticky", top: 0 } },
            React.createElement("tr", null, ...["货物名称", "规格", "单位", "数量", "单价", "金额", "税率", "税额"].map((h, i) => React.createElement("th", { key: i, style: { padding: "7px 10px", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", textAlign: i >= 3 ? "right" : "left", whiteSpace: "nowrap" } }, h)))),
          React.createElement("tbody", null, ...items.map((it, i) => React.createElement("tr", { key: i, style: { borderTop: "1px solid var(--line)" } },
            React.createElement("td", { style: { padding: "7px 10px", fontSize: 12 } }, it.name),
            React.createElement("td", { style: { padding: "7px 10px", fontSize: 12, color: "var(--ink-soft)" } }, it.spec),
            React.createElement("td", { style: { padding: "7px 10px", fontSize: 12 } }, it.unit),
            ...["quantity", "unitPrice", "amount", "taxRate", "taxAmount"].map((k) => React.createElement("td", { key: k, style: { padding: "7px 10px", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "right", color: k === "taxRate" ? "var(--ink-soft)" : "var(--ink)" } }, it[k]))
          )))
        )
      )
    );
  }

  // 表单辅助
  const blankForm = (inv) => {
    const f = {};
    FIELD_DEFS.forEach((d) => { f[d.key] = inv[d.key]; });
    ["buyerTaxNo", "sellerTaxNo", "project", "remark"].forEach((k) => { f[k] = inv[k]; });
    return f;
  };
  const valuePatch = (f) => {
    const p = {};
    FIELD_DEFS.forEach((d) => { p[d.key] = f[d.key]; });
    ["buyerTaxNo", "sellerTaxNo", "project", "remark"].forEach((k) => { p[k] = f[k]; });
    return p;
  };

  // 打印确认弹窗
  function printConfirm(rows, perPage, onConfirm) {
    if (!rows.length) { UI().toast("请先勾选要打印的发票", "danger"); return; }
    const pages = Math.ceil(rows.length / perPage);
    const total = rows.reduce((s, i) => s + Number(i.total || 0), 0);
    UI().modal({
      title: "打印确认", subtitle: "A4 排版 · 每页 " + perPage + " 张", width: 420,
      bodyHTML:
        '<div style="display:flex;flex-direction:column;gap:10px;font-size:13px">' +
        '<div style="display:flex;justify-content:space-between"><span style="color:var(--ink-soft)">发票张数</span><b style="font-family:var(--font-mono)">' + rows.length + ' 张</b></div>' +
        '<div style="display:flex;justify-content:space-between"><span style="color:var(--ink-soft)">排版页数</span><b style="font-family:var(--font-mono)">' + pages + ' 页 A4</b></div>' +
        '<div style="display:flex;justify-content:space-between"><span style="color:var(--ink-soft)">金额合计</span><b style="font-family:var(--font-mono)">¥' + total.toLocaleString("zh-CN", { minimumFractionDigits: 2 }) + '</b></div>' +
        '<div style="padding:10px 12px;background:var(--warn-soft);color:var(--warn-ink);border-radius:8px;font-size:12px">系统无法可靠检测是否真的完成打印，确认后累计打印次数；Excel 导入的纯数据发票不参与打印。</div>' +
        "</div>",
      actions: [{ label: "取消" }, { label: "已完成打印", primary: true, onClick: onConfirm }],
    });
  }

  // A4 排版预览（左发票列表 + 右 A4 页 + 工具栏），识别页排版子模式与台账打印呈现共用
  function PrintLayout({ rows, onPrint, onBack, backLabel }) {
    const { Button, Icon, StatusChip } = DS();
    const printable = rows.filter((i) => i.source !== "excel");
    const [perPage, setPerPage] = React.useState(2);
    const [sel, setSel] = React.useState(() => { const s = {}; printable.forEach((i) => (s[i.id] = true)); return s; });
    const [rot, setRot] = React.useState({});
    const [page, setPage] = React.useState(0);
    const [menu, setMenu] = React.useState(null);
    const chosen = printable.filter((i) => sel[i.id]);
    const pages = Math.max(1, Math.ceil(chosen.length / perPage));
    const curPage = Math.min(page, pages - 1);
    const pageItems = chosen.slice(curPage * perPage, curPage * perPage + perPage);
    const allOn = printable.length > 0 && printable.every((i) => sel[i.id]);
    const toggleAll = () => { const v = !allOn; const s = {}; printable.forEach((i) => (s[i.id] = v)); setSel(s); };
    const rotateAll = () => setRot((r) => { const n = { ...r }; pageItems.forEach((it) => (n[it.id] = ((n[it.id] || 0) + 90) % 360)); return n; });
    const doPrint = () => printConfirm(chosen, perPage, () => { chosen.forEach((i) => onPrint && onPrint(i)); UI().toast("已发送 " + chosen.length + " 张发票打印任务", "ok"); });

    return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
        onBack && React.createElement(Button, { icon: "arrow-left", onClick: onBack }, backLabel || "返回"),
        React.createElement("div", { style: { fontSize: 13, color: "var(--ink-soft)" } }, "打印排版 · 每页 ", React.createElement("b", { style: { color: "var(--ink)", fontFamily: "var(--font-mono)" } }, perPage), " 张 · 共 ", React.createElement("b", { style: { color: "var(--ink)", fontFamily: "var(--font-mono)" } }, pages), " 页"),
        React.createElement("div", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          React.createElement(Button, { size: "sm", icon: allOn ? "square-check" : "square", onClick: toggleAll }, allOn ? "取消全选" : "全选"),
          React.createElement(Button, { size: "sm", icon: "rotate-cw", onClick: rotateAll }, "整页旋转"),
          React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--line-strong)", borderRadius: 8, padding: "4px 8px", background: "#fff" } },
            React.createElement("span", { style: { fontSize: 12, color: "var(--ink-soft)" } }, "每页"),
            React.createElement("select", { value: perPage, onChange: (e) => { setPerPage(Number(e.target.value)); setPage(0); }, style: { border: 0, background: "transparent", fontSize: 13, fontWeight: 700, cursor: "pointer", outline: "none" } },
              [1, 2, 4].map((n) => React.createElement("option", { key: n, value: n }, n + " 张")))),
          React.createElement(Button, { variant: "primary", icon: "printer", disabled: !chosen.length, onClick: doPrint }, "打印选中 " + chosen.length + " 张")
        )
      ),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "22fr 78fr", gap: 14, height: "calc(100vh - 300px)", minHeight: 480 } },
        // 左：发票列表
        React.createElement(DS().Panel, { padding: 0, style: { overflow: "hidden", display: "flex", flexDirection: "column" } },
          React.createElement("div", { style: { padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" } }, "发票列表 · 勾选打印范围"),
          React.createElement("div", { style: { overflowY: "auto" } },
            ...printable.map((inv) => {
              const idx = chosen.findIndex((c) => c.id === inv.id);
              const onPage = idx > -1 ? Math.floor(idx / perPage) : -1;
              return React.createElement("div", { key: inv.id, onClick: () => { if (onPage > -1) setPage(onPage); }, style: { display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid var(--line)", cursor: "pointer", background: onPage === curPage && sel[inv.id] ? "var(--brand-soft)" : "transparent" } },
                React.createElement("input", { type: "checkbox", checked: !!sel[inv.id], onChange: (e) => { e.stopPropagation(); setSel((s) => ({ ...s, [inv.id]: !s[inv.id] })); }, onClick: (e) => e.stopPropagation(), style: { cursor: "pointer" } }),
                React.createElement("div", { style: { minWidth: 0, flex: 1 } },
                  React.createElement("div", { style: { fontSize: 12.5, fontWeight: 700, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, inv.number ? inv.number.slice(-8) : inv.name),
                  React.createElement("div", { style: { fontSize: 11, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, inv.seller || inv.buyer)
                ),
                sel[inv.id] && onPage > -1 && React.createElement("span", { style: { fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-faint)" } }, "P" + (onPage + 1))
              );
            }),
            printable.length === 0 && React.createElement("div", { style: { padding: 20, fontSize: 12, color: "var(--ink-soft)", textAlign: "center" } }, "无可打印发票（Excel 导入的纯数据发票不参与打印）。")
          )
        ),
        // 右：A4 预览
        React.createElement(DS().Panel, { padding: 0, style: { overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--surface-2)" } },
          React.createElement("div", { style: { flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", padding: 20 } },
            React.createElement("div", { style: { width: "100%", maxWidth: 520, aspectRatio: "1 / 1.4142", background: "#fff", borderRadius: 4, boxShadow: "var(--shadow-pop)", border: "1px solid var(--line)", padding: 16, display: "grid", gridTemplateColumns: perPage === 4 ? "1fr 1fr" : "1fr", gridTemplateRows: perPage === 1 ? "1fr" : perPage === 2 ? "1fr 1fr" : "1fr 1fr", gap: 12 } },
              ...pageItems.map((it) => React.createElement("div", { key: it.id, onContextMenu: (e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, id: it.id }); }, style: { border: "1px dashed var(--line-strong)", borderRadius: 4, padding: 8, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" } },
                React.createElement("div", { style: { transform: "rotate(" + (rot[it.id] || 0) + "deg)", transition: "transform .2s", width: perPage === 4 ? "90%" : "68%" } }, invoiceSvg(it)),
                React.createElement("span", { style: { position: "absolute", top: 6, left: 6, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-faint)" } }, it.number ? it.number.slice(-8) : "")
              )),
              ...Array.from({ length: Math.max(0, perPage - pageItems.length) }).map((_, i) => React.createElement("div", { key: "e" + i, style: { border: "1px dashed var(--line)", borderRadius: 4, display: "grid", placeItems: "center", color: "var(--ink-faint)", fontSize: 11 } }, "空位"))
            )
          ),
          React.createElement("div", { style: { flex: "none", borderTop: "1px solid var(--line)", background: "var(--panel)", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 } },
            React.createElement("span", { style: { fontSize: 12, color: "var(--ink-soft)" } }, "右键单张缩略可旋转 90°/180°/270°"),
            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
              React.createElement("button", { onClick: () => setPage(Math.max(0, curPage - 1)), disabled: curPage === 0, style: pagerBtn(curPage === 0) }, "‹"),
              React.createElement("span", { style: { fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--ink)" } }, "第 " + (curPage + 1) + " / " + pages + " 页"),
              React.createElement("button", { onClick: () => setPage(Math.min(pages - 1, curPage + 1)), disabled: curPage >= pages - 1, style: pagerBtn(curPage >= pages - 1) }, "›")
            ),
            React.createElement("span", { style: { fontSize: 12, color: "var(--ink-soft)" } }, "已勾 ", React.createElement("b", { style: { color: "var(--ink)", fontFamily: "var(--font-mono)" } }, chosen.length), " 张 · ", React.createElement("b", { style: { color: "var(--ink)", fontFamily: "var(--font-mono)" } }, pages), " 页 A4 · 合计 ", React.createElement("b", { style: { color: "var(--ink)", fontFamily: "var(--font-mono)" } }, money(chosen.reduce((s, i) => s + Number(i.total || 0), 0))))
          )
        )
      ),
      menu && React.createElement("div", { onClick: () => setMenu(null), style: { position: "fixed", inset: 0, zIndex: 80 } },
        React.createElement("div", { onClick: (e) => e.stopPropagation(), style: { position: "fixed", left: Math.min(menu.x, window.innerWidth - 150), top: menu.y + 4, width: 132, background: "var(--panel)", border: "1px solid var(--line-strong)", borderRadius: 10, boxShadow: "var(--shadow-pop)", padding: 6, zIndex: 81 } },
          ...[["旋转 90°", 90], ["旋转 180°", 180], ["旋转 270°", 270], ["重置", 0]].map(([lbl, deg]) => React.createElement("button", { key: lbl, onClick: () => { setRot((r) => ({ ...r, [menu.id]: deg })); setMenu(null); }, style: { display: "block", width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "7px 10px", fontSize: 13, borderRadius: 6, cursor: "pointer", color: "var(--ink)" }, onMouseEnter: (e) => (e.currentTarget.style.background = "var(--brand-soft)"), onMouseLeave: (e) => (e.currentTarget.style.background = "transparent") }, lbl))
        )
      )
    );
  }
  function pagerBtn(disabled) { return { minWidth: 30, height: 28, border: "1px solid var(--line-strong)", borderRadius: 8, background: "#fff", color: disabled ? "var(--ink-faint)" : "var(--ink)", fontSize: 14, cursor: disabled ? "not-allowed" : "pointer" }; }

  window.INV = {
    OWN, money, FIELD_DEFS, fieldConf, fieldNote, fieldLevel, badFields, isAllGreen, worstOf, statusOf,
    subscribe, update, add, get, softDel, live, useStore, mockUpload, projectsList,
    OriginalPreview, FieldGrid, ItemsTable, blankForm, valuePatch, printConfirm, PrintLayout, invoiceSvg,
  };
  window.INVSharedScreen = function () { return null; };
})();
