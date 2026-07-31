// InvoiceShared — 发票模块共享基座（按实现端 app/components/invoice/ 校准）
// 隐藏 x-import 预加载注册 window.INV，供三个发票页面复用，实现跨页/跨页签实时联动：
//   · 发票识别页 InvoiceScreen —— 三栏工作台（队列 | 原件/排版 | 校对）+ 字段校对/打印排版子模式
//   · 发票台账页 InvoiceLedgerScreen —— 左树右表 · 表格/卡片两视图
//   · 单张编辑页签 InvoiceEditScreen —— 左原图右字段（本地缓冲一次提交）
// window.INV = { 数据 store(subscribe/update/add/softDel/get/useStore) + 置信度助手 + 共享组件 }
(function () {
  if (window.INV) { window.INVSharedScreen = window.INVSharedScreen || function () { return null; }; return; }
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), modal: () => {}, undoToast: () => {} };
  const DS = () => window.DesignSystem_e3d871 || {};

  // ===== 格式化 =====
  const money = (v) => (v || v === 0 ? "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2 }) : "待补");

  // ===== 识别字段与置信度 =====
  // 字段集与实现端 InvoiceReviewForm / finance/invoice/[id].vue 的 FIELDS 一致：
  // 不含税金额不进校对网格（由 价税合计 − 税额 派生），对应项目走项目主数据 datalist。
  const FIELD_DEFS = [
    { key: "number", label: "单据编号", mono: true },
    { key: "date", label: "开票日期", mono: true, type: "date" },
    { key: "buyer", label: "购买方" },
    { key: "buyerTaxNo", label: "购买方税号", mono: true },
    { key: "seller", label: "供应商" },
    { key: "sellerTaxNo", label: "供应商税号", mono: true },
    { key: "type", label: "票据类型", select: ["增值税专用发票", "增值税普通发票"] },
    { key: "total", label: "价税合计", mono: true },
    { key: "tax", label: "税额", mono: true },
    { key: "rate", label: "税率", mono: true },
    { key: "project", label: "对应项目", full: true, projectList: true },
    { key: "remark", label: "票面备注", full: true },
  ];
  // 实现端 CONFIDENCE_THRESHOLDS：ok ≥ 95、warn ≥ 85，其余 danger。
  // 无置信度数据（人工录入 / Excel 导入 / 对应项目·备注这类非识别字段）返回 null：不着色、不出角标。
  const CONF_THRESHOLD = { ok: 95, warn: 85 };
  const fieldConf = (inv, k) => { const c = inv.conf ? inv.conf[k] : null; return c == null ? null : c; };
  const fieldNote = (inv, k) => (inv.flags ? inv.flags[k] : null);
  const fieldLevel = (inv, k) => {
    const c = fieldConf(inv, k);
    if (c == null) return null;
    if (inv.confirmed && inv.confirmed[k]) return "ok";
    if (c >= CONF_THRESHOLD.ok) return "ok";
    if (c >= CONF_THRESHOLD.warn) return "warn";
    return "danger";
  };
  const badFields = (inv) => FIELD_DEFS.filter((d) => { const lv = fieldLevel(inv, d.key); return lv === "warn" || lv === "danger"; });
  const isAllGreen = (inv) => badFields(inv).length === 0;
  const worstOf = (inv) => {
    let w = "ok";
    FIELD_DEFS.forEach((d) => { const lv = fieldLevel(inv, d.key); if (lv === "danger") w = "danger"; else if (lv === "warn" && w === "ok") w = "warn"; });
    return w;
  };
  const CONF_OK = { number: 99, date: 99, buyer: 98, buyerTaxNo: 98, seller: 98, sellerTaxNo: 97, type: 99, total: 99, tax: 99, rate: 99, amount: 99 };

  const OWN = "个人开支"; // 归属第二类出口（CONTEXT.md）

  // 归属：实现端 ownerKind（project / personal / null）。设计稿沿用 project 字段存名称，
  // ownerKind 缺省时按名称回推，保证旧 mock 行也有归属语义。
  const ownerKindOf = (inv) => inv.ownerKind || (inv.project === OWN ? "personal" : inv.project ? "project" : null);
  /** 归档强制归属：个人开支直通；项目归属须命中项目主数据规范名，否则 null（归档按钮禁用依据）。 */
  const attributionOf = (inv) => {
    const kind = ownerKindOf(inv);
    if (kind === "personal") return { kind: "personal" };
    if (kind === "project" && inv.project && inv.project !== OWN && projectsList().indexOf(inv.project) > -1) return { kind: "project", name: inv.project };
    return null;
  };

  // 单据状态（实现端 invoiceDocStatus 派生 + 各页只映射文案/色）
  function docStatusOf(inv) {
    if (inv.status === "recognizing") return "recognizing";
    if (inv.status === "failed") return "failed";
    if (inv.status === "dup") return "duplicate";
    if (inv.status !== "done") return "pending";
    return inv.reviewed ? "reviewed" : "unreviewed";
  }
  const DOC_CHIP = {
    recognizing: { tone: "brand", text: "识别中" },
    pending: { tone: "warn", text: "待识别" },
    failed: { tone: "danger", text: "识别失败" },
    duplicate: { tone: "danger", text: "重复已排除" },
    unreviewed: { tone: "warn", text: "待校对" },
    reviewed: { tone: "ok", text: "已校对" },
  };
  const statusOf = (inv) => DOC_CHIP[docStatusOf(inv)];

  // 工作台队列行（实现端 InvoiceWorkspaceScreen 的 workspaceRows 映射）：
  // 全绿待校对票标「建议通过」——只标记，放行仍由人工点「批量通过」。
  const QUEUE_LABEL = { pending: "待识别", failed: "识别失败", duplicate: "重复", unreviewed: "待校对", reviewed: "已校对" };
  const QUEUE_TONE = { recognizing: "brand", pending: "warn", failed: "danger", duplicate: "danger", unreviewed: "warn", reviewed: "ok" };
  function queueStatusOf(inv) {
    const st = docStatusOf(inv);
    if (st === "recognizing") return { st, tone: "brand", text: "识别中 " + Math.floor(inv.progress || 0) + "%" };
    if (st === "unreviewed" && isAllGreen(inv)) return { st, tone: "ok", text: "建议通过", suggested: true };
    return { st, tone: QUEUE_TONE[st], text: QUEUE_LABEL[st] };
  }

  // ===== 演示数据（识别队列 + 台账） =====
  function seed() {
    const R = (o) => ({ size: "1.1 MB", pages: 1, source: "scan", printCount: 0, account: "", status: "done", reviewed: false, ...o });
    const review = [
      R({ id: "inv_g1", name: "扫描件_0701_01.pdf", number: "58761309", date: "2026-07-01", buyer: "广州瑞航建设工程有限公司", buyerTaxNo: "91440101MA5CUKXXXX", seller: "佛山市南海区大板东建材商行", sellerTaxNo: "92440605MA53XXXX", type: "增值税专用发票", amount: 40000, tax: 5200, total: 45200, rate: "13%", project: "车陂商业大楼", remark: "地砖 800×800", conf: { ...CONF_OK } }),
      R({ id: "inv_g2", name: "扫描件_0701_02.pdf", number: "58761415", date: "2026-07-01", buyer: "广州瑞航建设工程有限公司", buyerTaxNo: "91440101MA5CUKXXXX", seller: "广州市天河建材经营部", sellerTaxNo: "91440106MA59F1XXXX", type: "增值税普通发票", amount: 18087.38, tax: 542.62, total: 18630, rate: "3%", project: "车陂商业大楼", remark: "瓷砖胶一批", conf: { ...CONF_OK, seller: 96 } }),
      R({ id: "inv_y1", name: "扫描件_0702_01.pdf", number: "58761523", date: "2026-07-02", buyer: "广州瑞航建设工程有限公司", buyerTaxNo: "91440101MA5CUKXXXX", seller: "广州市白云区永固水泥制品厂", sellerTaxNo: "91440111MA9W3XXXX", type: "增值税普通发票", amount: 9572.82, tax: 287.18, total: 9860, rate: "3%", project: "车陂商业大楼", remark: "水泥制品", conf: { ...CONF_OK, total: 88 }, flags: { total: "识别金额与票面大写「玖仟捌佰陆拾元整」校验不符，请对照原图核对" } }),
      R({ id: "inv_r1", name: "扫描件_0702_02.pdf", number: "58761538", date: "2026-07-02", buyer: "广州瑞航建设工程有限公司", buyerTaxNo: "91440101MA5CUKXXXX", seller: "佛山市禅城区宏图五金商行", sellerTaxNo: "92440604MA52XXXX", type: "增值税普通发票", amount: 3320.39, tax: 99.61, total: 3420, rate: "3%", project: "", remark: "五金配件", conf: { ...CONF_OK, number: 62 }, flags: { number: "票面号码打印模糊，OCR 置信度低，请对照原图核对" } }),
    ];
    const P = (o) => ({ size: "1.0 MB", pages: 1, source: "scan", account: "posted", status: "done", reviewed: true, printCount: 0, conf: { ...CONF_OK }, buyerTaxNo: "91440101MA5CUKXXXX", ownerKind: "project", ...o });
    const ledger = [
      P({ id: "inv_p1", number: "58760021", date: "2026-06-28", buyer: "广州瑞航建设工程有限公司", seller: "广州市大板东建材有限公司", type: "增值税专用发票", amount: 84070.8, tax: 10929.2, total: 95000, rate: "13%", project: "车陂商业大楼", remark: "岩板一批", printCount: 2, lastPrintedAt: "2026-06-29" }),
      P({ id: "inv_p2", number: "58760544", date: "2026-06-25", buyer: "广州瑞航建设工程有限公司", seller: "广州市海珠区泰晟装饰材料", type: "增值税专用发票", amount: 49203.5, tax: 6396.5, total: 55600, rate: "13%", project: "车陂商业大楼", remark: "铝扣板" }),
      P({ id: "inv_p3", number: "58760712", date: "2026-06-20", buyer: "广州瑞航建设工程有限公司", seller: "广州荣帆照明有限公司", type: "增值税普通发票", amount: 20522.33, tax: 615.67, total: 21138, rate: "3%", project: "车陂商业大楼", remark: "灯具", printCount: 1, lastPrintedAt: "2026-06-22" }),
      P({ id: "inv_p4", number: "58761020", date: "2026-06-18", buyer: "广州瑞航建设工程有限公司", seller: "汇丰水泥制品有限公司", type: "增值税专用发票", amount: 205840.71, tax: 26759.29, total: 232600, rate: "13%", project: "合和新城", remark: "商品混凝土 C30" }),
      P({ id: "inv_p5", number: "58761180", date: "2026-06-15", buyer: "广州瑞航建设工程有限公司", seller: "花城珠江电线电缆有限公司", type: "增值税专用发票", amount: 45840.71, tax: 5959.29, total: 51800, rate: "13%", project: "合和新城", remark: "电缆 YJV" }),
      P({ id: "inv_p6", number: "58761260", date: "2026-06-12", buyer: "广州瑞航建设工程有限公司", seller: "穗建五金机电经营部", type: "增值税普通发票", amount: 12194.17, tax: 365.83, total: 12560, rate: "3%", project: "科学城人才公寓", remark: "五金机电" }),
      P({ id: "inv_o1", number: "58761301", date: "2026-06-10", buyer: "张伟", seller: "中国石化广州分公司", type: "增值税普通发票", amount: 485.44, tax: 14.56, total: 500, rate: "3%", project: "", ownerKind: "personal", remark: "加油" }),
      P({ id: "inv_o2", number: "58761333", date: "2026-06-08", buyer: "张伟", seller: "广州酒家集团利口福", type: "增值税普通发票", amount: 1165.05, tax: 34.95, total: 1200, rate: "3%", project: "", ownerKind: "personal", remark: "业务招待" }),
      // 待归档 = 已校对未归档的过渡态（#57/#69 两态模型：归档必有归属，不存在「已归档但未归项目」）
      P({ id: "inv_x1", account: "", ownerKind: null, number: "58769001", date: "2026-06-05", buyer: "广州瑞航建设工程有限公司", seller: "广州市白云区永固水泥制品厂", type: "增值税普通发票", amount: 9572.82, tax: 287.18, total: 9860, rate: "3%", project: "", remark: "水泥制品", source: "excel" }),
      P({ id: "inv_x2", account: "", ownerKind: null, number: "58769002", date: "2026-06-03", buyer: "广州瑞航建设工程有限公司", seller: "佛山市禅城区宏图五金商行", type: "增值税普通发票", amount: 3320.39, tax: 99.61, total: 3420, rate: "3%", project: "", remark: "五金配件", source: "excel" }),
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
      { id: "inv_u1_" + ts, name: "扫描件_0703_01.pdf", size: "0.8 MB", pages: 1, number: "58761677", date: "2026-07-03", buyer: "广州瑞航建设工程有限公司", buyerTaxNo: "91440101MA5CUKXXXX", seller: "广州市天河建材经营部", sellerTaxNo: "91440106MA59F1XXXX", type: "增值税普通发票", amount: 12000, tax: 360, total: 12360, rate: "3%", project: "车陂商业大楼", remark: "填缝剂/辅料", status: "recognizing", progress: 0, fresh: true, account: "", source: "scan", printCount: 0, conf: { ...CONF_OK } },
      { id: "inv_u2_" + ts, name: "扫描件_0703_02.pdf", size: "1.2 MB", pages: 1, number: "58761742", date: "2026-07-03", buyer: "广州瑞航建设工程有限公司", buyerTaxNo: "91440101MA5CUKXXXX", seller: "佛山市南海区大板东建材商行", sellerTaxNo: "92440605MA53XXXX", type: "增值税专用发票", amount: 23000, tax: 2990, total: 25990, rate: "13%", project: "车陂商业大楼", remark: "地砖补货", status: "recognizing", progress: 0, fresh: true, account: "", source: "scan", printCount: 0, conf: { ...CONF_OK, date: 84 }, flags: { date: "日期区域被印章遮挡，请确认" } },
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

  // 自适应字段网格（实现端 .invoice-review-form__fields：auto-fit minmax(min(100%,17.5rem),1fr)）。
  // 置信度只染输入框边框 + label 行右侧角标%，黄/红另出「✓确认」；无置信度字段不着色不出角标。
  // plain=true 用于编辑页签：字段只是普通表单项（本地缓冲一次提交，不做逐字段确认）。
  const FIELD_GRID_STYLE = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 17.5rem), 1fr))", gap: "10px 12px" };
  const BADGE_INK = { ok: "var(--ok-ink)", warn: "var(--warn-ink)", danger: "var(--danger-ink)" };
  const BORDER_INK = { warn: "var(--warn)", danger: "var(--danger)" };

  function FieldGrid({ inv, f, onField, onConfirm, projects, plain, projectDisabled, invalidProject }) {
    const { Icon } = DS();
    const listId = "inv-projects-" + (inv.id || "x");
    const input = (d) => {
      const level = plain ? null : fieldLevel(inv, d.key);
      // 缺归属时对应项目标红（归档强制归属的就地提示）
      const bad = d.key === "project" && invalidProject ? "var(--danger)" : (level && BORDER_INK[level]);
      const base = {
        width: "100%", boxSizing: "border-box", border: "1px solid " + (bad || "var(--line-strong)"),
        background: "#fff", borderRadius: 8, padding: "7px 9px", fontSize: 12.5,
        fontFamily: d.mono ? "var(--font-mono)" : "inherit", outline: "none",
      };
      if (d.select) {
        return React.createElement("select", { "aria-label": d.label, value: f[d.key] == null ? "" : f[d.key], onChange: (e) => onField(d.key, e.target.value), style: { ...base, cursor: "pointer" } },
          ...d.select.map((o) => React.createElement("option", { key: o, value: o }, o)));
      }
      const el = React.createElement("input", {
        "aria-label": d.label, value: f[d.key] == null ? "" : f[d.key], type: d.type || "text",
        list: d.projectList ? listId : undefined,
        disabled: d.projectList && projectDisabled,
        placeholder: d.projectList ? "从项目主数据选择…" : undefined,
        onChange: (e) => onField(d.key, e.target.value),
        style: d.projectList && projectDisabled ? { ...base, background: "var(--surface-2)", color: "var(--ink-faint)" } : base,
      });
      if (!d.projectList) return el;
      return React.createElement(React.Fragment, null, el,
        React.createElement("datalist", { id: listId }, ...(projects || projectsList()).map((p) => React.createElement("option", { key: p, value: p }))));
    };
    const cell = (d) => {
      const level = plain ? null : fieldLevel(inv, d.key);
      const conf = fieldConf(inv, d.key);
      const note = fieldNote(inv, d.key);
      return React.createElement("div", { key: d.key, style: d.full ? { gridColumn: "1 / -1" } : null },
        React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 4, marginBottom: 3, fontSize: 11, fontWeight: 600, color: "var(--ink-soft)" } },
          React.createElement("span", null, d.label),
          React.createElement("span", { style: { flex: 1 } }),
          level && React.createElement("span", { style: { fontSize: 11, fontFamily: "var(--font-mono)", lineHeight: 1, color: BADGE_INK[level] } }, conf + "%"),
          (level === "warn" || level === "danger") && React.createElement("button", {
            type: "button", onClick: () => onConfirm(d.key), title: "人工确认「" + d.label + "」识别无误",
            style: { display: "inline-flex", alignItems: "center", gap: 2, border: "1px solid " + BORDER_INK[level], background: "transparent", color: BADGE_INK[level], borderRadius: "var(--radius-sm)", padding: "1px 5px", fontSize: 11, lineHeight: 1, cursor: "pointer" },
          }, React.createElement(Icon, { name: "check", size: 11 }), "确认")
        ),
        input(d),
        note && (level === "warn" || level === "danger") && React.createElement("div", { style: { marginTop: 3, fontSize: 10.5, lineHeight: 1.5, color: BADGE_INK[level] } }, note)
      );
    };
    return React.createElement("div", { style: FIELD_GRID_STYLE }, ...FIELD_DEFS.map(cell));
  }

  // 货物明细（默认折叠，展开后独立滚动，不影响外层栏滚动）
  function ItemsTable({ inv, defaultOpen }) {
    const [open, setOpen] = React.useState(!!defaultOpen);
    const { Icon } = DS();
    const items = inv.items || [{ name: inv.remark || "货物一批", spec: "—", unit: "批", quantity: 1, unitPrice: (Number(inv.total || 0) - Number(inv.tax || 0)).toFixed(2), amount: (Number(inv.total || 0) - Number(inv.tax || 0)).toFixed(2), taxRate: inv.rate, taxAmount: inv.tax }];
    return React.createElement("div", { style: { borderTop: "1px solid var(--line)", paddingTop: 8 } },
      React.createElement("button", { onClick: () => setOpen(!open), style: { display: "flex", alignItems: "center", gap: 6, width: "100%", border: 0, background: "transparent", padding: 0, fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", cursor: "pointer" } },
        React.createElement(Icon, { name: open ? "chevron-down" : "chevron-right", size: 13 }),
        "货物明细 · " + items.length + " 行"
      ),
      open && React.createElement("div", { style: { marginTop: 8, border: "1px solid var(--line)", overflow: "auto", maxHeight: 160 } },
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

  // 表单辅助（金额铁律：不含税金额不在网格里编辑，提交时由 价税合计 − 税额 派生）
  const blankForm = (inv) => {
    const f = {};
    FIELD_DEFS.forEach((d) => { f[d.key] = inv[d.key]; });
    return f;
  };
  const valuePatch = (f) => {
    const p = {};
    FIELD_DEFS.forEach((d) => { p[d.key] = f[d.key]; });
    p.amount = Math.round((Number(f.total || 0) - Number(f.tax || 0)) * 100) / 100;
    return p;
  };

  // 打印确认（实现端：先调 window.print()，系统打印窗口关闭后再由人确认是否真的完成，
  // 确认才累计打印次数——浏览器无法可靠检测打印结果）
  function printConfirm(count, pages, total, onConfirm) {
    UI().confirm({
      title: "确认打印结果",
      message: "系统打印窗口已关闭。是否已完成打印？\n\n" + count + " 张发票 · " + pages + " 页 A4 · 金额合计 " + money(total),
      confirmText: "已打印",
      onConfirm: onConfirm,
    });
  }

  // A4 排版栏（实现端 InvoicePrintLayout.vue）：单栏面板，直接占三栏工作台的「排版」栏——
  // 队列与校对栏在排版模式下原样保留，不整页替换成排版视图。
  // 预览按当前页铺全部队列发票（含未勾选的），勾选只决定打印范围与底部合计。
  function PrintLayout({ rows, selId, onSelect, onPrint }) {
    const { Icon } = DS();
    const [perPage, setPerPage] = React.useState(2);
    const [page, setPage] = React.useState(1);
    const [sel, setSel] = React.useState({});
    const [rot, setRot] = React.useState({});
    const [menu, setMenu] = React.useState(null);
    const [zoom, setZoom] = React.useState(false);
    const ids = rows.map((i) => i.id).join(",");

    // 新进入排版的发票默认勾选，离开的清掉（实现端 watch(props.invoices) 等价）
    React.useEffect(() => {
      setSel((s) => { const n = {}; rows.forEach((i) => { n[i.id] = i.id in s ? s[i.id] : true; }); return n; });
    }, [ids]);

    const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
    const cur = Math.min(page, pageCount);
    const slots = rows.slice((cur - 1) * perPage, (cur - 1) * perPage + perPage);
    const chosen = rows.filter((i) => sel[i.id]);
    const chosenPages = Math.ceil(chosen.length / perPage);
    const chosenTotal = chosen.reduce((s, i) => s + Number(i.total || 0), 0);
    const allOn = rows.length > 0 && chosen.length === rows.length;
    const zoomInv = rows.find((i) => i.id === selId) || slots[0];

    // 队列选中票所在页优先（三栏里点队列即翻到对应 A4 页）
    React.useEffect(() => {
      const idx = rows.findIndex((i) => i.id === selId);
      if (idx > -1) setPage(Math.floor(idx / perPage) + 1);
    }, [selId, perPage, ids]);

    const toggleAll = () => { const v = !allOn; const n = {}; rows.forEach((i) => (n[i.id] = v)); setSel(n); };
    const rotatePage = () => setRot((r) => { const n = { ...r }; slots.forEach((i) => (n[i.id] = ((n[i.id] || 0) + 90) % 360)); return n; });
    const doPrint = () => {
      if (!chosen.length) return;
      printConfirm(chosen.length, chosenPages, chosenTotal, () => {
        chosen.forEach((i) => onPrint && onPrint(i));
        UI().toast("已记录 " + chosen.length + " 张发票的打印次数", "ok");
      });
    };
    const barBtn = (disabled) => ({ border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", background: "transparent", padding: "2px 8px", fontSize: 11, color: disabled ? "var(--ink-faint)" : "var(--ink-soft)", cursor: disabled ? "not-allowed" : "pointer" });
    const toolBtn = { display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--line-strong)", background: "#fff", borderRadius: "var(--radius-btn)", padding: "5px 10px", fontSize: 12, color: "var(--ink)", cursor: "pointer" };

    return React.createElement("section", { "aria-label": "发票打印排版", style: { display: "flex", flexDirection: "column", height: "100%", minWidth: 0, overflow: "hidden", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", background: "var(--panel)", boxShadow: "var(--shadow-card)" } },
      // 工具条
      React.createElement("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", flex: "none" } },
        React.createElement("strong", { style: { marginRight: "auto", fontSize: 12, color: "var(--ink)" } }, "打印排版"),
        React.createElement("button", { type: "button", disabled: !zoomInv, onClick: () => setZoom(true), style: { ...toolBtn, opacity: zoomInv ? 1 : 0.5 } }, React.createElement(Icon, { name: "zoom-in", size: 13 }), "放大"),
        React.createElement("button", { type: "button", disabled: !slots.length, onClick: rotatePage, style: { ...toolBtn, opacity: slots.length ? 1 : 0.5 } }, React.createElement(Icon, { name: "rotate-cw", size: 13 }), "整页旋转 90°"),
        React.createElement("label", { style: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--ink-soft)" } }, "每页",
          React.createElement("select", { "aria-label": "每页张数", value: perPage, onChange: (e) => { setPerPage(Number(e.target.value)); setPage(1); }, style: { border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", background: "#fff", padding: "4px 6px", fontSize: 11, cursor: "pointer" } },
            ...[1, 2, 4].map((n) => React.createElement("option", { key: n, value: n }, n + " 张")))
        )
      ),
      // 全选 + 翻页
      React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--line)", fontSize: 11, color: "var(--ink-soft)", flex: "none" } },
        React.createElement("label", { style: { display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" } },
          React.createElement("input", { type: "checkbox", "aria-label": "全选发票", checked: allOn, onChange: toggleAll, style: { cursor: "pointer" } }), "全选"),
        React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 8 } },
          React.createElement("button", { type: "button", disabled: cur <= 1, onClick: () => setPage(cur - 1), style: barBtn(cur <= 1) }, "上一页"),
          React.createElement("span", null, "第 " + (rows.length ? cur : 0) + " / " + (rows.length ? pageCount : 0) + " 页"),
          React.createElement("button", { type: "button", disabled: cur >= pageCount, onClick: () => setPage(cur + 1), style: barBtn(cur >= pageCount) }, "下一页"))
      ),
      // A4 预览
      React.createElement("div", { style: { flex: 1, minHeight: 0, overflow: "auto", background: "var(--surface-sink, var(--surface-2))", padding: 12 } },
        React.createElement("div", { style: { margin: "0 auto", maxWidth: 540, aspectRatio: "1 / 1.4142", background: "#fff", padding: 12, display: "grid", gap: 8, boxShadow: "var(--shadow-card)", gridTemplateColumns: perPage === 4 ? "1fr 1fr" : "1fr", gridTemplateRows: perPage === 1 ? "1fr" : "1fr 1fr" } },
          ...slots.map((it) => React.createElement("article", { key: it.id,
            onContextMenu: (e) => { e.preventDefault(); onSelect && onSelect(it.id); setMenu({ id: it.id, x: e.clientX, y: e.clientY }); },
            style: { position: "relative", minWidth: 0, minHeight: 0, overflow: "hidden", padding: 8, borderRadius: "var(--radius-card)", background: "var(--panel)", border: "1px solid " + (selId === it.id ? "var(--brand)" : "var(--line)"), boxShadow: selId === it.id ? "0 0 0 2px var(--brand-soft)" : "none" } },
            React.createElement("button", { type: "button", "aria-label": "查看发票 " + (it.number || it.name), onClick: () => onSelect && onSelect(it.id), style: { position: "absolute", inset: 0, zIndex: 0, border: 0, background: "transparent", cursor: "pointer" } }),
            React.createElement("input", { type: "checkbox", "aria-label": "勾选发票 " + (it.number || it.name), checked: !!sel[it.id], onClick: (e) => e.stopPropagation(), onChange: () => setSel((s) => ({ ...s, [it.id]: !s[it.id] })), style: { position: "absolute", left: 8, top: 8, zIndex: 1, cursor: "pointer" } }),
            React.createElement("span", { style: { position: "absolute", right: 8, top: 6, zIndex: 1, borderRadius: 999, background: "var(--surface-3)", padding: "1px 6px", fontSize: 9, color: "var(--ink-soft)" } }, "打印 " + (it.printCount || 0) + " 次"),
            React.createElement("button", { type: "button", "aria-label": "发票 " + (it.number || it.name) + " 旋转选项", "aria-haspopup": "menu",
              onClick: (e) => { e.stopPropagation(); onSelect && onSelect(it.id); const r = e.currentTarget.getBoundingClientRect(); setMenu({ id: it.id, x: r.left, y: r.bottom }); },
              style: { position: "absolute", right: 8, bottom: 8, zIndex: 1, display: "grid", placeItems: "center", width: 26, height: 26, border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", background: "var(--panel)", color: "var(--ink-soft)", cursor: "pointer" } },
              React.createElement(Icon, { name: "rotate-cw", size: 13 })),
            React.createElement("div", { style: { height: "100%", display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 16, pointerEvents: "none" } },
              React.createElement("div", { style: { width: "100%", transformOrigin: "center", transition: "transform .2s var(--ease-snappy)", transform: "rotate(" + (rot[it.id] || 0) + "deg) scale(" + ((rot[it.id] || 0) % 180 ? 0.7 : 1) + ")" } }, invoiceSvg(it)))
          )),
          !slots.length && React.createElement("div", { style: { gridColumn: "1 / -1", display: "grid", placeItems: "center", fontSize: 12, color: "var(--ink-faint)" } }, "暂无可打印发票")
        )
      ),
      // 底部合计 + 打印
      React.createElement("div", { style: { flex: "none", borderTop: "1px solid var(--line)", background: "var(--panel)", padding: "10px 12px" } },
        React.createElement("div", { style: { marginBottom: 8, textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--ink-soft)" } },
          "已勾 " + chosen.length + " 张 · " + chosenPages + " 页 A4 · 金额合计 " + money(chosenTotal)),
        React.createElement("button", { type: "button", disabled: !chosen.length, onClick: doPrint,
          style: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", border: 0, borderRadius: "var(--radius-btn)", background: "var(--brand)", color: "#fff", padding: "8px 0", fontSize: 13, fontWeight: 700, cursor: chosen.length ? "pointer" : "not-allowed", opacity: chosen.length ? 1 : 0.5 } },
          React.createElement(Icon, { name: "printer", size: 14 }), "打印选中")
      ),
      // 旋转菜单
      menu && React.createElement("div", { onClick: () => setMenu(null), style: { position: "fixed", inset: 0, zIndex: 80 } },
        React.createElement("div", { role: "menu", onClick: (e) => e.stopPropagation(), style: { position: "fixed", left: Math.min(menu.x, window.innerWidth - 150), top: menu.y + 4, width: 132, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius-btn)", boxShadow: "var(--shadow-pop)", padding: 4, zIndex: 81 } },
          ...[["旋转 90°", 90], ["旋转 180°", 180], ["旋转 270°", 270], ["重置旋转", 0]].map(([lbl, deg]) => React.createElement("button", { key: lbl, role: "menuitem", type: "button", onClick: () => { setRot((r) => ({ ...r, [menu.id]: deg })); setMenu(null); }, style: { display: "block", width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "7px 10px", fontSize: 13, borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--ink)" }, onMouseEnter: (e) => (e.currentTarget.style.background = "var(--brand-soft)"), onMouseLeave: (e) => (e.currentTarget.style.background = "transparent") }, lbl))
        )
      ),
      // 放大预览
      zoom && zoomInv && React.createElement("div", { onClick: () => setZoom(false), style: { position: "fixed", inset: 0, zIndex: 90, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 24 } },
        React.createElement("div", { onClick: (e) => e.stopPropagation(), style: { width: "min(900px, 92vw)", maxHeight: "86dvh", overflow: "auto", background: "var(--panel)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-pop)", padding: 20 } },
          React.createElement("div", { style: { fontSize: 15, fontWeight: 800 } }, "发票大图预览"),
          React.createElement("div", { style: { marginTop: 2, marginBottom: 12, fontSize: 12, color: "var(--ink-soft)", fontFamily: "var(--font-mono)" } }, zoomInv.number || zoomInv.name),
          React.createElement("div", { style: { background: "var(--surface-2)", padding: 16 } },
            React.createElement("div", { style: { margin: "0 auto", maxWidth: 720, background: "#fff", padding: 16 } }, invoiceSvg(zoomInv)))
        )
      )
    );
  }

  window.INV = {
    OWN, money, FIELD_DEFS, CONF_THRESHOLD, fieldConf, fieldNote, fieldLevel, badFields, isAllGreen, worstOf,
    statusOf, docStatusOf, queueStatusOf, ownerKindOf, attributionOf,
    subscribe, update, add, get, softDel, live, useStore, mockUpload, projectsList,
    OriginalPreview, FieldGrid, ItemsTable, blankForm, valuePatch, printConfirm, PrintLayout, invoiceSvg,
  };
  window.INVSharedScreen = function () { return null; };
})();
