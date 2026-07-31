// DeliveryScreen — 送货单整理（material-delivery.md + issue #42 识别流程完善）：
// OCR 警告条 + 上传区 + sticky 操作栏 + 分区标签栏 + 文件卡片网格
// + 逐张识别（转圈+进度）→ 左图右表核对弹层（头部字段置信度着色同发票规则 + 材料明细行可编辑表格）
// + 识别全部逐张排队（全绿自动核对通过，含黄/红停在待核对）→ 核对完成才可入库并归档到分区。
(function () {
  const { Button, Panel, StatusChip, Icon, IconButton } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), modal: () => {}, formModal: () => {}, exportModal: () => {}, undoToast: () => {}, folderPicker: (cb) => cb && cb("D:\\瑞航资料\\送货单") };

  // 识别中转圈动画 keyframes（一次性注入）
  if (!document.getElementById("dlv-spin-style")) {
    const st = document.createElement("style");
    st.id = "dlv-spin-style";
    st.textContent = "@keyframes dlvSpin{to{transform:rotate(360deg)}}";
    document.head.appendChild(st);
  }

  // 最小宽度两排：窗口 <1360（内容区约 <1100）时卡片网格列数减半，等比缩放、不用 auto-fit 自动换行
  const useNarrow = () => {
    const [narrow, setNarrow] = React.useState(window.innerWidth < 1360);
    React.useEffect(() => {
      const onR = () => setNarrow(window.innerWidth < 1360);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }, []);
    return narrow;
  };

  // —— OCR 置信度着色（同发票规则）：≥0.90 绿 / 0.70–0.90 黄(warn) / <0.70 红(danger)，黄红必须人工确认 ——
  const confTone = (c) => (c >= 0.9 ? "ok" : c >= 0.7 ? "warn" : "danger");
  const CONF_STYLE = {
    ok: { border: "var(--line-strong)", bg: "#fff", ink: "var(--ink-soft)", soft: "var(--ok-soft)", softInk: "var(--ok-ink)" },
    warn: { border: "var(--warn)", bg: "var(--warn-soft)", ink: "var(--warn-ink)", soft: "var(--warn-soft)", softInk: "var(--warn-ink)" },
    danger: { border: "var(--danger)", bg: "var(--danger-soft)", ink: "var(--danger-ink)", soft: "var(--danger-soft)", softInk: "var(--danger-ink)" },
  };
  const HEADS = [["no", "送货单号"], ["date", "送货日期"], ["supplier", "供应商"], ["site", "收货工地"]];
  const fmt = (n) => (Number(n) || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });

  // —— 预置 OCR 识别结果（design 演示 mock；c=置信度，item.conf 为明细单元格级置信度） ——
  const OCR_PRESET = {
    d1: {
      head: { no: { v: "0005876", c: 0.99 }, date: { v: "2026-06-14", c: 0.99 }, supplier: { v: "广州市大板东建材有限公司", c: 0.98 }, site: { v: "合和新城", c: 0.99 } },
      items: [{ name: "HRB400 螺纹钢 Φ12", spec: "Φ12mm", unit: "吨", qty: 8.5, price: 3980 }],
    },
    d2: {
      head: { no: { v: "0012043", c: 0.98 }, date: { v: "2026-06-12", c: 0.99 }, supplier: { v: "汇丰水泥制品有限公司", c: 0.97 }, site: { v: "锦绣华庭", c: 0.98 } },
      items: [{ name: "C30 商品混凝土", spec: "C30", unit: "m³", qty: 186, price: 462 }],
    },
    // d3：公司名冲突 → 供应商红（<0.70）、单号黄；核对确认后冲突解除
    d3: {
      head: { no: { v: "0007311", c: 0.72 }, date: { v: "2026-06-11", c: 0.95 }, supplier: { v: "花城珠江电线电缆有限公司", c: 0.45 }, site: { v: "合和新城", c: 0.96 } },
      items: [
        { name: "电缆 YJV 3×25", spec: "3×25mm²", unit: "米", qty: 300, price: 46, conf: { qty: 0.78 } },
        { name: "电缆 YJV 5×10", spec: "5×10mm²", unit: "米", qty: 200, price: 32 },
      ],
    },
    // d4：全绿样张（3 行明细）→ 识别全部时自动核对通过
    d4: {
      head: { no: { v: "S06103", c: 0.99 }, date: { v: "2026-06-10", c: 0.98 }, supplier: { v: "穗建五金机电经营部", c: 0.97 }, site: { v: "锦绣华庭", c: 0.99 } },
      items: [
        { name: "镀锌钢管 DN50", spec: "6m/根", unit: "根", qty: 40, price: 82 },
        { name: "膨胀螺栓 M10", spec: "60×10", unit: "盒", qty: 25, price: 24 },
        { name: "金属切割片", spec: "Φ100mm", unit: "盒", qty: 10, price: 35 },
      ],
    },
    // d5：含黄字段样张（4 行明细，首行数量置信度 0.74 待确认）→ 识别全部时停在待核对
    d5: {
      head: { no: { v: "0005912", c: 0.98 }, date: { v: "2026-06-18", c: 0.96 }, supplier: { v: "广州市大板东建材有限公司", c: 0.95 }, site: { v: "合和新城", c: 0.97 } },
      items: [
        { name: "防水卷材 SBS", spec: "3mm×10m", unit: "卷", qty: 32, price: 320, conf: { qty: 0.74 } },
        { name: "瓷砖胶", spec: "20kg/包", unit: "包", qty: 80, price: 28 },
        { name: "填缝剂（白）", spec: "2kg/袋", unit: "袋", qty: 40, price: 15 },
        { name: "界面剂", spec: "18kg/桶", unit: "桶", qty: 6, price: 95 },
      ],
    },
  };

  // 兜底结果（无预置时按卡片字段生成全绿结果）
  const genResult = (f) => ({
    head: {
      no: { v: f.no && f.no !== "—" ? f.no : "S" + String(Date.now()).slice(-5), c: 0.97 },
      date: { v: f.date && f.date !== "—" ? f.date : "2026-07-02", c: 0.96 },
      supplier: { v: f.company, c: 0.95 },
      site: { v: f.partition, c: 0.98 },
    },
    items: [{ name: f.material && f.material !== "—" ? f.material.split(" ·")[0].split(" /")[0] : "材料一批", spec: "—", unit: "批", qty: 1, price: 0 }],
  });
  const resultOf = (f) => f.result || OCR_PRESET[f.id] || genResult(f);
  const isAllGreen = (r) => HEADS.every(([k]) => confTone(r.head[k].c) === "ok") && r.items.every((it) => Object.values(it.conf || {}).every((c) => confTone(c) === "ok"));

  // 导入文件的预置结果：第 1 张全绿、第 2 张含黄字段（数量 0.76）
  const importResult = (part, variant) => (variant === 0 ? {
    head: { no: { v: "D07021", c: 0.99 }, date: { v: "2026-07-02", c: 0.98 }, supplier: { v: "佛山市南海区大板东建材商行", c: 0.96 }, site: { v: part, c: 0.98 } },
    items: [
      { name: "地砖 800×800", spec: "800×800mm", unit: "箱", qty: 120, price: 118 },
      { name: "地砖阳角条", spec: "2.5m/支", unit: "支", qty: 30, price: 12 },
    ],
  } : {
    head: { no: { v: "D07022", c: 0.97 }, date: { v: "2026-07-02", c: 0.98 }, supplier: { v: "广州市天河建材经营部", c: 0.95 }, site: { v: part, c: 0.97 } },
    items: [
      { name: "瓷砖胶", spec: "20kg/包", unit: "包", qty: 80, price: 28, conf: { qty: 0.76 } },
      { name: "美缝剂", spec: "400ml/支", unit: "支", qty: 24, price: 22 },
      { name: "十字卡", spec: "2mm", unit: "包", qty: 10, price: 6 },
    ],
  });

  // 整理树弹窗：工地 → 组（分供方）→ 文件（material-delivery.md）
  const showTree = (files) => {
    const byPart = {};
    files.forEach((f) => {
      byPart[f.partition] = byPart[f.partition] || {};
      const g = byPart[f.partition];
      g[f.company] = g[f.company] || [];
      g[f.company].push(f);
    });
    let html = '<div style="font-size:13px;line-height:1.9;max-height:400px;overflow:auto">';
    Object.entries(byPart).forEach(([part, comps]) => {
      const n = Object.values(comps).reduce((s, a) => s + a.length, 0);
      html += '<div style="font-weight:800;margin-top:6px">🏗️ ' + part + ' <span style="color:var(--ink-soft);font-weight:400">(' + n + ' 件)</span></div>';
      Object.entries(comps).forEach(([comp, arr]) => {
        html += '<div style="padding-left:18px;font-weight:600">📁 ' + comp + ' <span style="color:var(--ink-soft);font-weight:400">(' + arr.length + ')</span></div>';
        arr.forEach((f) => {
          html += '<div style="padding-left:38px;color:var(--ink-soft);font-family:var(--font-mono);font-size:12px">📄 ' + f.date + '_No.' + f.no + '_' + f.name + (f.conflict ? ' <span style="color:var(--warn-ink)">⚠公司名冲突</span>' : "") + "</div>";
        });
      });
    });
    html += "</div>";
    UI().modal({ title: "整理树", subtitle: "工地 → 分供方 → 文件 · 按文件夹与 OCR 自动归组", width: 560, bodyHTML: html });
  };

  function ocrChip(f) {
    if (f.stored) return <StatusChip tone="brand">已入库</StatusChip>;
    if (f.ocr === "done") return <StatusChip tone="ok">已核对</StatusChip>;
    if (f.ocr === "review") return <StatusChip tone="warn">待核对</StatusChip>;
    return <StatusChip tone="neutral">待识别</StatusChip>;
  }

  // #201 左栏：处理队列。宽屏常驻，点选即在右两栏载入原件与字段；窄屏不渲染（退化为卡片网格）。
  // 队列只承载「选哪一张」，不重复卡片网格的移动/删除动作，避免同一操作两处入口。
  function QueueList({ files, activeId, onPick }) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, border: "1px solid var(--line)",
        borderRadius: 12, background: "var(--panel)", overflow: "hidden", alignSelf: "start" }}>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)",
          fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 6 }}>
          处理队列<span style={{ fontFamily: "var(--font-mono)" }}>({files.length})</span>
        </div>
        <div style={{ overflowY: "auto", maxHeight: "calc(100dvh - var(--header-h) - 270px)" }}>
          {files.length === 0 && (
            <div style={{ padding: "26px 14px", textAlign: "center", color: "var(--ink-faint)", fontSize: 12.5, lineHeight: 1.9 }}>
              <Icon name="inbox" size={22} color="var(--line-strong)" />
              <div style={{ marginTop: 6, fontWeight: 700, color: "var(--ink-soft)" }}>当前分区没有待处理文件</div>
              <div>拖入工地文件夹或切换上方分区</div>
            </div>
          )}
          {files.map((f) => {
            const on = f.id === activeId;
            return (
              <button key={f.id} type="button" onClick={() => onPick(f)}
                style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid var(--line)",
                  borderLeft: "3px solid " + (on ? "var(--brand)" : "transparent"), cursor: "pointer",
                  background: on ? "var(--brand-soft)" : "transparent", padding: "9px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: on ? 800 : 600, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.name}>{f.name}</span>
                  {f.conflict && <span title="公司名与红章冲突" style={{ color: "var(--danger)", fontWeight: 800, flex: "none" }}>!</span>}
                </div>
                <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  {ocrChip(f)}
                  <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: "var(--ink-faint)", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.company}>{f.company}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function FileCard({ f, partitions, onOpen, onMove, onDel }) {
    return (
      <Panel padding={0} style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* 缩略图占位（送货单：单字方块） */}
        <div style={{ height: 120, background: "var(--surface-2)", display: "grid", placeItems: "center", borderBottom: "1px solid var(--line)", position: "relative" }}>
          <span style={{ color: "var(--brand)", fontSize: 28, fontWeight: 800, opacity: .55 }}>单</span>
          <span style={{ position: "absolute", top: 8, right: 8 }}>{ocrChip(f)}</span>
        </div>
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: f.conflict ? "var(--warn-ink)" : "var(--ink-soft)" }}>
            {f.conflict && <Icon name="triangle-alert" size={13} color="var(--warn)" />}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.company}</span>
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }}>
            <span>{f.date}</span><span>No.{f.no}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{f.material}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>分区</span>
            <button title="移动到其他分区" onClick={() => UI().formModal({
              title: "移动分区 · " + f.name, fields: [{ key: "partition", label: "目标分区（工地）", type: "select", options: partitions, value: f.partition, full: true }],
              saveText: "移动", onSave: (vals) => { onMove(f.id, vals.partition); UI().toast("已移动到「" + vals.partition + "」", "ok"); },
            })} style={{ border: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--brand)", background: "var(--brand-soft)", padding: "2px 8px", borderRadius: 999 }}>{f.partition}</button>
            <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
              <IconButton icon={f.ocr === "todo" ? "scan-text" : "file-check"} title={f.ocr === "todo" ? "识别" : f.ocr === "review" ? "核对" : "查看核对结果"} onClick={() => onOpen(f)} />
              <IconButton icon="zoom-in" title="放大" onClick={() => UI().modal({ title: f.name, subtitle: f.company, width: 520, bodyHTML: '<div style="height:280px;display:grid;place-items:center;background:var(--surface-2);border-radius:8px;color:var(--brand);font-size:40px;font-weight:800;opacity:.5">单</div>' })} />
              <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => UI().confirm({ title: "删除文件", message: "确定删除「" + f.name + "」？删除为软删除，可在 5 秒内撤回。", danger: true, confirmText: "删除", onConfirm: () => onDel(f) })} />
            </span>
          </div>
        </div>
      </Panel>
    );
  }

  // —— 左侧送货单占位图（灰底表格轮廓 SVG + 文件名） ——
  function DocSketch({ name }) {
    const soft = { fill: "var(--surface-3)" };
    const line = { stroke: "var(--line-strong)", strokeWidth: 1 };
    return (
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 18, minHeight: 420 }}>
        <svg viewBox="0 0 320 420" style={{ width: "100%", maxWidth: 340, height: "auto" }} xmlns="http://www.w3.org/2000/svg">
          <rect x="10" y="10" width="300" height="400" rx="8" style={{ fill: "#fff", stroke: "var(--line-strong)", strokeWidth: 1.5 }} />
          {/* 标题 + 头部字段占位 */}
          <rect x="95" y="30" width="130" height="14" rx="4" style={soft} />
          <rect x="30" y="62" width="110" height="8" rx="3" style={soft} />
          <rect x="180" y="62" width="110" height="8" rx="3" style={soft} />
          <rect x="30" y="78" width="90" height="8" rx="3" style={soft} />
          <rect x="180" y="78" width="90" height="8" rx="3" style={soft} />
          {/* 明细表格轮廓 */}
          <rect x="30" y="100" width="260" height="240" style={{ fill: "none", stroke: "var(--line-strong)", strokeWidth: 1.2 }} />
          <line x1="30" y1="128" x2="290" y2="128" style={line} />
          <line x1="130" y1="100" x2="130" y2="340" style={line} />
          <line x1="185" y1="100" x2="185" y2="340" style={line} />
          <line x1="240" y1="100" x2="240" y2="340" style={line} />
          {[158, 188, 218, 248, 278, 308].map((y) => <line key={y} x1="30" y1={y} x2="290" y2={y} style={{ stroke: "var(--line)", strokeWidth: 1 }} />)}
          <rect x="40" y="108" width="60" height="9" rx="3" style={soft} />
          <rect x="140" y="108" width="30" height="9" rx="3" style={soft} />
          <rect x="195" y="108" width="30" height="9" rx="3" style={soft} />
          <rect x="250" y="108" width="30" height="9" rx="3" style={soft} />
          {/* 合计行 + 红章 */}
          <rect x="170" y="352" width="120" height="10" rx="3" style={soft} />
          <circle cx="245" cy="382" r="24" style={{ fill: "none", stroke: "rgba(220,38,38,.55)", strokeWidth: 2 }} transform="rotate(-8 245 382)" />
          <text x="245" y="386" textAnchor="middle" style={{ fill: "rgba(220,38,38,.65)", fontSize: 9, fontWeight: 700 }}>送货专用章</text>
        </svg>
        <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--ink-soft)", wordBreak: "break-all", textAlign: "center" }}>📄 {name}</div>
        <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>原件占位图 · 实际接入后显示扫描原图</div>
      </div>
    );
  }

  // —— 左图右表核对弹层（90vw 大弹窗）：头部字段置信度着色 + 材料明细行可编辑表格 ——
  // #201：核对内容有两种承载 —— 宽屏 inline 进三栏工作台的「原件 + 字段/材料行」两栏，
  // 窄屏回落为全屏弹层（三栏在窄屏无法并置，退化为队列单列 + 弹层核对）。逻辑只此一份。
  function ReviewModal({ file, narrow, inline, onClose, onFinish }) {
    const r0 = React.useMemo(() => file.result || genResult(file), [file.id]);
    const [head, setHead] = React.useState(() => ({ no: { ...r0.head.no }, date: { ...r0.head.date }, supplier: { ...r0.head.supplier }, site: { ...r0.head.site } }));
    const [items, setItems] = React.useState(() => r0.items.map((it, i) => ({ ...it, _id: "r" + i })));
    // 已核对过的单据重开时，低置信字段视为已确认
    const [confirmed, setConfirmed] = React.useState(() => {
      if (file.ocr !== "done") return {};
      const m = {};
      HEADS.forEach(([k]) => { m["h_" + k] = true; });
      r0.items.forEach((it, i) => Object.keys(it.conf || {}).forEach((ck) => { m["i_r" + i + "_" + ck] = true; }));
      return m;
    });

    // 必须确认的低置信（黄/红）字段键
    const need = [];
    HEADS.forEach(([k]) => { const t = confTone(head[k].c); if (t !== "ok") need.push({ key: "h_" + k, tone: t }); });
    items.forEach((it) => Object.entries(it.conf || {}).forEach(([ck, c]) => { const t = confTone(c); if (t !== "ok") need.push({ key: "i_" + it._id + "_" + ck, tone: t }); }));
    const remaining = need.filter((n) => !confirmed[n.key]);
    const canFinish = remaining.length === 0;
    const hasDanger = remaining.some((n) => n.tone === "danger");

    const confirmKey = (key) => setConfirmed((c) => ({ ...c, [key]: true }));
    const updHead = (k) => (e) => { const v = e.target.value; setHead((h) => ({ ...h, [k]: { ...h[k], v } })); confirmKey("h_" + k); };
    const updItem = (id, k) => (e) => { const v = e.target.value; setItems((ls) => ls.map((x) => (x._id === id ? { ...x, [k]: v } : x))); confirmKey("i_" + id + "_" + k); };
    const delItem = (id) => setItems((ls) => ls.filter((x) => x._id !== id));
    const addItem = () => setItems((ls) => [...ls, { _id: "n" + Date.now(), name: "", spec: "", unit: "", qty: "", price: "" }]);
    const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);

    const confBadge = (c, ok) => {
      const tone = confTone(c);
      return (
        <span style={{ fontSize: 10, fontWeight: 800, fontFamily: "var(--font-mono)", padding: "1px 6px", borderRadius: 999, background: tone === "ok" ? "var(--ok-soft)" : CONF_STYLE[tone].soft, color: tone === "ok" ? "var(--ok-ink)" : CONF_STYLE[tone].softInk }}>
          {Math.round(c * 100)}%{tone !== "ok" && ok && " ✓"}
        </span>
      );
    };

    // 头部字段（置信度着色 + 低置信需确认）— 用普通函数渲染，避免内联组件重挂载丢焦点
    const headField = (k, label) => {
      const f = head[k];
      const tone = confTone(f.c);
      const key = "h_" + k;
      const low = tone !== "ok";
      const ok = !low || confirmed[key];
      return (
        <div key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: low && !confirmed[key] ? CONF_STYLE[tone].ink : "var(--ink-soft)", display: "inline-flex", gap: 6, alignItems: "center" }}>
            {label} {confBadge(f.c, ok)}
            {low && confirmed[key] && <span style={{ color: "var(--ok-ink)", fontWeight: 700 }}>已确认</span>}
            {low && !confirmed[key] && <span>待确认</span>}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={f.v} onChange={updHead(k)}
              style={{ flex: 1, minWidth: 0, border: "1px solid " + (low && !confirmed[key] ? CONF_STYLE[tone].border : confirmed[key] && low ? "var(--ok)" : "var(--line-strong)"), background: low && !confirmed[key] ? CONF_STYLE[tone].bg : "#fff", borderRadius: 8, padding: "8px 10px", fontSize: 13, outline: "none", fontFamily: k === "no" || k === "date" ? "var(--font-mono)" : "inherit" }} />
            {low && !confirmed[key] && (
              <button onClick={() => { confirmKey(key); UI().toast("已确认「" + label + "」", "ok"); }}
                style={{ border: 0, cursor: "pointer", borderRadius: 8, padding: "0 12px", fontSize: 12, fontWeight: 700, background: tone === "danger" ? "var(--danger)" : "var(--warn)", color: "#fff", flex: "none" }}>确认</button>
            )}
          </div>
        </div>
      );
    };

    // 明细单元格（数量/单价可能带低置信标记）
    const cellInput = (it, k, mono) => {
      const c = (it.conf || {})[k];
      const tone = c == null ? "ok" : confTone(c);
      const key = "i_" + it._id + "_" + k;
      const low = tone !== "ok";
      const pending = low && !confirmed[key];
      return (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input value={it[k] == null ? "" : it[k]} onChange={updItem(it._id, k)}
            title={low ? "OCR 置信度 " + Math.round(c * 100) + "%，请核对后确认" : undefined}
            style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1px solid " + (pending ? CONF_STYLE[tone].border : low && confirmed[key] ? "var(--ok)" : "var(--line)"), background: pending ? CONF_STYLE[tone].bg : "#fff", borderRadius: 6, padding: "6px 8px", fontSize: 12.5, outline: "none", fontFamily: mono ? "var(--font-mono)" : "inherit", textAlign: mono ? "right" : "left" }} />
          {pending && (
            <button title={"置信度 " + Math.round(c * 100) + "%，点击确认"} onClick={() => { confirmKey(key); UI().toast("已确认该明细字段", "ok"); }}
              style={{ border: 0, cursor: "pointer", borderRadius: 6, width: 22, height: 22, display: "grid", placeItems: "center", background: tone === "danger" ? "var(--danger)" : "var(--warn)", color: "#fff", fontSize: 12, fontWeight: 800, flex: "none" }}>✓</button>
          )}
        </div>
      );
    };

    const thStyle = (right) => ({ padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", textAlign: right ? "right" : "left", whiteSpace: "nowrap" });
    const inner = (
      <React.Fragment>
          {/* 头部 */}
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, background: "var(--panel)", zIndex: 2 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>送货单核对 · {file.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>左图右表逐字段核对 · 黄/红为低置信字段，确认或改正后才能核对完成</div>
            </div>
            <span style={{ marginLeft: "auto", flex: "none" }}>{canFinish ? <StatusChip tone="ok">字段全部就绪</StatusChip> : <StatusChip tone={hasDanger ? "danger" : "warn"}>{remaining.length} 个低置信字段待确认</StatusChip>}</span>
            {!inline && <button onClick={onClose} style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 22, lineHeight: 1, color: "var(--ink-soft)", flex: "none" }}>×</button>}
          </div>

          {/* 左图右表 */}
          <div style={{ padding: 16, display: "grid", gridTemplateColumns: narrow ? "1fr" : "minmax(0, 2fr) minmax(0, 3fr)", gap: 16, alignItems: "start" }}>
            <DocSketch name={file.name} />

            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              {/* 头部字段 2×2 */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 8 }}>票面字段（着色=OCR 置信度：绿 ≥90% / 黄 70–90% / 红 &lt;70%）</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {HEADS.map(([k, label]) => headField(k, label))}
                </div>
              </div>

              {/* 材料明细行表格 */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 6 }}>材料明细（行级可编辑 · 金额 = 数量 × 单价 自动计算）</div>
                <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse" }}>
                    <thead style={{ background: "var(--surface-2)" }}>
                      <tr>
                        <th style={{ ...thStyle(false), width: "26%" }}>材料名称</th>
                        <th style={{ ...thStyle(false), width: "17%" }}>规格</th>
                        <th style={{ ...thStyle(false), width: "9%" }}>单位</th>
                        <th style={{ ...thStyle(true), width: "13%" }}>数量</th>
                        <th style={{ ...thStyle(true), width: "13%" }}>单价</th>
                        <th style={{ ...thStyle(true), width: "14%" }}>金额</th>
                        <th style={{ ...thStyle(false), width: "8%" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it._id} style={{ borderTop: "1px solid var(--line)" }}>
                          <td style={{ padding: "6px 8px" }}>{cellInput(it, "name", false)}</td>
                          <td style={{ padding: "6px 8px" }}>{cellInput(it, "spec", false)}</td>
                          <td style={{ padding: "6px 8px" }}>{cellInput(it, "unit", false)}</td>
                          <td style={{ padding: "6px 8px" }}>{cellInput(it, "qty", true)}</td>
                          <td style={{ padding: "6px 8px" }}>{cellInput(it, "price", true)}</td>
                          <td style={{ padding: "6px 10px", fontSize: 12.5, fontFamily: "var(--font-mono)", fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>¥{fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>
                          <td style={{ padding: "6px 8px", textAlign: "center" }}>
                            <IconButton icon="trash-2" tone="danger" title="删除此行" onClick={() => { delItem(it._id); UI().toast("已删除明细行"); }} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
                        <td colSpan={5} style={{ padding: "9px 10px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "right" }}>合计（{items.length} 行）</td>
                        <td style={{ padding: "9px 10px", fontSize: 13, fontFamily: "var(--font-mono)", fontWeight: 800, textAlign: "right", whiteSpace: "nowrap" }}>¥{fmt(total)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <button onClick={addItem} style={{ marginTop: 8, width: "100%", border: "1.5px dashed var(--line-strong)", background: "transparent", color: "var(--brand)", borderRadius: 8, padding: "8px 0", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>＋ 添加一行</button>
              </div>
            </div>
          </div>

          {/* 底部操作 */}
          <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12, position: "sticky", bottom: 0, background: "var(--panel)", zIndex: 2 }}>
            <Icon name="info" size={14} color="var(--brand)" />
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{canFinish ? "全部字段就绪，可核对完成；完成后单据标记已核对、归档到收货工地分区，可入库" : "剩余 " + remaining.length + " 个黄/红低置信字段：修改字段值或点「确认」后才能核对完成"}</span>
            <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flex: "none" }}>
              <button onClick={onClose} style={{ border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--ink)", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>取消</button>
              <button onClick={() => {
                if (!canFinish) { UI().toast("还有 " + remaining.length + " 个低置信字段未确认", "danger"); return; }
                const cleanItems = items.filter((it) => String(it.name).trim() !== "").map((it) => ({ name: it.name, spec: it.spec, unit: it.unit, qty: Number(it.qty) || 0, price: Number(it.price) || 0 }));
                if (!cleanItems.length) { UI().toast("至少保留一行材料明细", "danger"); return; }
                onFinish({ head, items: cleanItems });
              }} style={{ border: 0, background: "var(--brand)", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: canFinish ? 1 : .5 }}>核对完成</button>
            </span>
          </div>
      </React.Fragment>
    );

    if (inline) {
      return (
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: "var(--panel)",
          border: "1px solid var(--line)", borderRadius: 12, overflow: "auto", maxHeight: "calc(100dvh - var(--header-h) - 220px)" }}>
          {inner}
        </div>
      );
    }
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 24 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--panel)", borderRadius: 12, width: "90vw", maxWidth: 1280, maxHeight: "90dvh", overflow: "auto", boxShadow: "var(--shadow-pop)" }}>
          {inner}
        </div>
      </div>
    );
  }

  // —— 单张识别中覆盖层（转圈 + 进度） ——
  function RecognizeOverlay({ name, pct }) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ background: "var(--panel)", borderRadius: 12, width: 380, maxWidth: "94vw", boxShadow: "var(--shadow-pop)", padding: "26px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", border: "3px solid var(--brand-soft)", borderTopColor: "var(--brand)", animation: "dlvSpin .8s linear infinite" }} />
          <div style={{ fontSize: 14, fontWeight: 800 }}>正在识别送货单…</div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)", fontFamily: "var(--font-mono)", wordBreak: "break-all", textAlign: "center" }}>{name}</div>
          <div style={{ width: "100%", height: 8, borderRadius: 999, background: "var(--surface-3)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: pct + "%", background: "var(--brand)", borderRadius: 999, transition: "width .15s linear" }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{pct}% · 正在提取票面字段与材料明细行</div>
        </div>
      </div>
    );
  }

  // —— 识别全部排队覆盖层（进度 x/N） ——
  function BatchOverlay({ batch }) {
    const pct = Math.round(batch.done / batch.total * 100);
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ background: "var(--panel)", borderRadius: 12, width: 420, maxWidth: "94vw", boxShadow: "var(--shadow-pop)", padding: "26px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", border: "3px solid var(--brand-soft)", borderTopColor: "var(--brand)", animation: "dlvSpin .8s linear infinite" }} />
          <div style={{ fontSize: 14, fontWeight: 800 }}>识别全部 · 逐张排队识别中</div>
          <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "var(--font-mono)" }}>{batch.done} / {batch.total}</div>
          <div style={{ width: "100%", height: 8, borderRadius: 999, background: "var(--surface-3)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: pct + "%", background: "var(--brand)", borderRadius: 999, transition: "width .2s linear" }} />
          </div>
          {batch.name && <div style={{ fontSize: 12, color: "var(--ink-soft)", fontFamily: "var(--font-mono)", wordBreak: "break-all", textAlign: "center" }}>正在识别：{batch.name}</div>}
          <div style={{ fontSize: 11, color: "var(--ink-faint)", textAlign: "center" }}>全绿单据自动核对通过 · 含黄/红低置信字段的停在待核对列表</div>
        </div>
      </div>
    );
  }

  function DeliveryScreen({ data }) {
    const narrow = useNarrow();
    const [partition, setPartition] = React.useState("all");
    const [onlyTodo, setOnlyTodo] = React.useState(false);
    const [extraParts, setExtraParts] = React.useState([]);
    // 文件列表转 state：识别/核对/移动/入库/删除实时生效（刷新恢复初始 mock）
    // mock 预置：d4 全绿（3 行明细）+ d5 含黄字段数量待确认（4 行明细）
    const [files, setFiles] = React.useState(() => [
      ...data.deliveryFiles.slice(),
      { id: "d5", name: "大板东-0618.jpg", partition: "合和新城", company: "广州市大板东建材有限公司", ocr: "todo", date: "—", no: "—", material: "—", conflict: false },
    ]);
    const [recog, setRecog] = React.useState(null);      // 单张识别中 { name, pct }
    const [batch, setBatch] = React.useState(null);      // 批量排队 { total, done, name }
    const [reviewId, setReviewId] = React.useState(null); // 核对弹层文件 id
    const timerRef = React.useRef(null);
    React.useEffect(() => () => { clearInterval(timerRef.current); clearTimeout(timerRef.current); }, []);

    const withResult = (x) => ({ ...x, result: resultOf(x) });
    const moveFile = (id, part) => setFiles((l) => l.map((x) => (x.id === id ? { ...x, partition: part } : x)));
    const delFile = (f) => {
      const idx = files.findIndex((x) => x.id === f.id);
      setFiles((l) => l.filter((x) => x.id !== f.id));
      UI().undoToast("已删除「" + f.name + "」", () => setFiles((l) => { const n = [...l]; n.splice(Math.min(idx, n.length), 0, f); return n; }));
    };
    const addFiles = (part) => setFiles((l) => [
      { id: "d_" + Date.now(), name: "送货单_0702_01.jpg", company: "佛山市南海区大板东建材商行", date: "2026-07-02", no: "D07021", material: "地砖 800×800 · 120 箱", partition: part, ocr: "todo", conflict: false, result: importResult(part, 0) },
      { id: "d_" + Date.now() + "b", name: "送货单_0702_02.jpg", company: "广州市天河建材经营部", date: "2026-07-02", no: "D07022", material: "瓷砖胶 · 80 包", partition: part, ocr: "todo", conflict: false, result: importResult(part, 1) },
      ...l,
    ]);

    // —— 逐张识别：识别中（转圈+进度）→ 完成后打开核对弹层；已识别的直接打开核对/查看 ——
    const openFile = (fl) => {
      if (fl.ocr !== "todo") {
        setFiles((l) => l.map((x) => (x.id === fl.id ? withResult(x) : x)));
        setReviewId(fl.id);
        return;
      }
      let pct = 5;
      setRecog({ name: fl.name, pct });
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        pct = Math.min(100, pct + 9 + Math.round(Math.random() * 9));
        setRecog({ name: fl.name, pct });
        if (pct >= 100) {
          clearInterval(timerRef.current);
          setFiles((l) => l.map((x) => (x.id === fl.id ? { ...withResult(x), ocr: "review" } : x)));
          setTimeout(() => { setRecog(null); setReviewId(fl.id); }, 320);
        }
      }, 140);
    };

    // —— 识别全部：逐张排队（进度 x/N），全绿自动核对通过，含黄/红停在待核对 ——
    const runBatchOcr = () => {
      const queue = files.filter((f) => f.ocr === "todo");
      if (!queue.length) { UI().toast("没有待识别文件"); return; }
      const pass = queue.filter((f) => isAllGreen(resultOf(f))).length;
      setBatch({ total: queue.length, done: 0, name: queue[0].name });
      const step = (i) => {
        timerRef.current = setTimeout(() => {
          const f = queue[i];
          setFiles((l) => l.map((x) => {
            if (x.id !== f.id) return x;
            const r = resultOf(x);
            return isAllGreen(r) ? { ...x, result: r, ocr: "done", conflict: false } : { ...x, result: r, ocr: "review" };
          }));
          if (i + 1 < queue.length) {
            setBatch({ total: queue.length, done: i + 1, name: queue[i + 1].name });
            step(i + 1);
          } else {
            setBatch({ total: queue.length, done: queue.length, name: "" });
            setTimeout(() => {
              setBatch(null);
              UI().toast("识别完成 " + queue.length + " 张：" + pass + " 张全绿自动核对通过，" + (queue.length - pass) + " 张待核对", pass === queue.length ? "ok" : undefined);
            }, 420);
          }
        }, 850);
      };
      step(0);
    };

    // —— 核对完成：标记已核对、回写卡片字段、归档到收货工地分区（之后可入库） ——
    const finishReview = (fl, out) => {
      setFiles((l) => l.map((x) => (x.id === fl.id ? {
        ...x, ocr: "done", conflict: false, result: out,
        no: out.head.no.v, date: out.head.date.v, company: out.head.supplier.v,
        partition: out.head.site.v || x.partition,
        material: out.items[0].name + (out.items.length > 1 ? " 等 " + out.items.length + " 项" : ""),
      } : x)));
      setReviewId(null);
      UI().toast("「" + fl.name + "」核对完成，已归档到「" + (out.head.site.v || fl.partition) + "」，可入库", "ok");
    };

    const partNames = Array.from(new Set([...files.map((f) => f.partition), ...extraParts]));
    const partitions = ["all", ...partNames];
    const visible = files
      .filter((f) => partition === "all" || f.partition === partition)
      .filter((f) => !onlyTodo || f.ocr !== "done" || f.conflict);
    const todo = files.filter((f) => f.ocr === "todo").length;
    const problemFiles = files.filter((f) => f.conflict || f.ocr === "review");
    const problems = problemFiles.length;
    const reviewFile = reviewId ? files.find((f) => f.id === reviewId) : null;

    // 问题汇总弹窗：真实文件清单 + 一键全部标记已复核
    const showProblems = () => {
      let html = '<div style="font-size:13px;line-height:1.9;max-height:360px;overflow:auto">';
      problemFiles.forEach((f) => {
        html += '<div style="display:flex;gap:8px;align-items:baseline"><span style="color:var(--warn-ink)">⚠</span><div><b>' + f.name + "</b><span style='color:var(--ink-soft)'> · " + f.company + "</span><div style='font-size:12px;color:var(--ink-soft)'>" + (f.conflict ? "公司名冲突：文件夹名与 OCR 红章识别不一致，请以红章为准核对" : "含黄/红低置信字段：打开卡片「核对」逐字段确认后完成") + "</div></div></div>";
      });
      html += "</div>";
      UI().modal({
        title: "待处理问题（" + problems + "）", subtitle: "公司名冲突 / 低置信待核对", width: 520, bodyHTML: html,
        actions: [{ label: "关闭" }, { label: "全部标记已复核", primary: true, onClick: () => { setFiles((l) => l.map((x) => ({ ...x, conflict: false, ocr: x.ocr === "review" ? "done" : x.ocr }))); UI().toast("已全部标记复核完成", "ok"); } }],
      });
    };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* OCR 未配置警告条 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 12, border: "1px solid var(--warn)", background: "var(--warn-soft)", color: "var(--warn-ink)", fontSize: 13 }}>
          <Icon name="triangle-alert" size={16} color="var(--warn)" />
          <span style={{ fontWeight: 700 }}>OCR 未配置或无法连接</span>
          <span>· 请在设置中填写 PaddleOCR-VL 服务地址</span>
          <span style={{ marginLeft: "auto" }}><Button size="sm" onClick={() => UI().formModal && UI().formModal({ title: "OCR 服务配置", fields: [{ key: "url", label: "PaddleOCR-VL 服务地址", placeholder: "http://127.0.0.1:8080", full: true }], saveText: "保存并测试", onSave: () => UI().toast("已保存配置", "ok") })}>去配置</Button></span>
        </div>

        {/* 拖拽上传区 */}
        <div style={{ border: "1.5px dashed var(--line-strong)", borderRadius: 12, background: "var(--panel)", padding: "20px", display: "flex", alignItems: "center", gap: 14, color: "var(--ink-soft)" }}>
          <Icon name="folder-open" size={22} color="var(--brand)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "var(--ink)" }}>拖拽工地文件夹到此处</div>
            <div style={{ fontSize: 12 }}>按工地 → 分供方 → 文件自动整理成树状结构</div>
          </div>
          <Button icon="upload" onClick={() => UI().folderPicker(() => { const part = partNames[0] || "未分区"; addFiles(part); UI().toast("已导入 2 个文件到「" + part + "」，待识别", "ok"); })}>选择文件夹</Button>
        </div>

        {/* sticky 操作栏 */}
        <div style={{ position: "sticky", top: 64, zIndex: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "8px 12px", boxShadow: "var(--shadow-card)" }}>
          <Button variant="primary" icon="scan-text" onClick={runBatchOcr}>识别全部({todo})</Button>
          <Button icon="file-search" onClick={() => showTree(files)}>整理树</Button>
          {problems > 0 && <Button icon="triangle-alert" onClick={showProblems}>问题({problems})</Button>}
          <Button icon="filter" onClick={() => { setOnlyTodo(!onlyTodo); UI().toast(onlyTodo ? "已显示全部文件" : "已筛选：只看未完善"); }} style={onlyTodo ? { borderColor: "var(--brand)", color: "var(--brand)" } : null}>{onlyTodo ? "显示全部" : "只看未完善"}</Button>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
            <Button icon="database" onClick={() => {
              const ready = files.filter((f) => f.ocr === "done" && !f.conflict && !f.stored).length;
              if (!ready) { UI().toast("没有可入库的已核对文件", "danger"); return; }
              UI().confirm({ title: "入库", message: "将 " + ready + " 个已核对文件写入识别库（供分供方/单价对比读取）？", confirmText: "入库", onConfirm: () => { setFiles((l) => l.map((x) => (x.ocr === "done" && !x.conflict ? { ...x, stored: true } : x))); UI().toast("已入库 " + ready + " 个文件", "ok"); } });
            }}>入库</Button>
            <Button icon="download" onClick={(e) => UI().exportModal({
              title: "导出归档", subtitle: "每个分区一个子文件夹 · 按公司命名 PDF + 汇总 Excel", count: files.length, unit: "个文件", ext: ".pdf", anchor: e.currentTarget,
              structureOptions: ["按分区（工地）", "按分供方", "按送货月份"],
              nameOptions: [{ label: "公司名称", sample: "大板东建材" }, { label: "送货日期", sample: "2026-06-21" }, { label: "单号", sample: "D06213" }],
            })}>导出归档</Button>
          </span>
        </div>

        {/* 分区标签栏 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {partitions.map((pt) => {
            const on = partition === pt;
            const n = pt === "all" ? files.length : files.filter((f) => f.partition === pt).length;
            return <button key={pt} onClick={() => setPartition(pt)} style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "6px 12px", borderRadius: 999, border: "1px solid", borderColor: on ? "var(--brand)" : "var(--line)", background: on ? "var(--brand-soft)" : "#fff", color: on ? "var(--brand-deep)" : "var(--ink-soft)", fontWeight: on ? 700 : 500, fontSize: 13, cursor: "pointer" }}>{pt === "all" ? "全部工地" : pt}<span style={{ fontFamily: "var(--font-mono)", opacity: .8 }}>{n}</span></button>;
          })}
          <span style={{ marginLeft: "auto" }}><IconButton icon="folder-plus" title="新增分区" onClick={() => UI().formModal({ title: "新增分区（工地）", fields: [{ key: "name", label: "分区名称", placeholder: "如 合和新城", full: true }], onSave: (vals) => { if (!vals.name) { UI().toast("分区名称不能为空", "danger"); return; } setExtraParts((p) => [...p, vals.name]); setPartition(vals.name); UI().toast("已新增分区「" + vals.name + "」", "ok"); } })} /></span>
        </div>

        {/* #201 处理区：宽屏三栏（队列 | 原件 | 字段与材料行），三栏各自局部滚动、不锁死高度；
            窄屏无法并置三栏，退化为卡片网格单列旅程 + 全屏弹层核对。 */}
        {narrow ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
            {visible.map((f) => <FileCard key={f.id} f={f} partitions={partNames} onOpen={openFile} onMove={moveFile} onDel={delFile} />)}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "268px minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
            <QueueList files={visible} activeId={reviewId} onPick={openFile} />
            {reviewFile ? (
              <ReviewModal key={reviewFile.id} file={reviewFile} narrow={false} inline
                onClose={() => setReviewId(null)} onFinish={(out) => finishReview(reviewFile, out)} />
            ) : (
              <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel)", padding: "48px 24px",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--ink-faint)" }}>
                <Icon name="scan-text" size={30} color="var(--line-strong)" />
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink-soft)" }}>
                  {visible.length ? "从左侧队列选择一张送货单" : "当前分区没有待处理文件"}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.8, textAlign: "center", maxWidth: 420 }}>
                  {visible.length
                    ? "待识别的单据点选后先跑 OCR，识别完成即在此处载入原件与字段；已识别的直接进入核对。"
                    : "拖入工地文件夹开始，或切换上方分区标签查看其他工地。"}
                </div>
              </div>
            )}
          </div>
        )}

        <details style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--brand)" }}>使用说明 / 注意事项</summary>
          <ul style={{ marginTop: 10, paddingLeft: 18, color: "var(--ink)", lineHeight: 1.8, fontSize: 13 }}>
            <li><b>识别 → 核对 → 入库</b>：识别完成后打开左图右表核对弹层；黄/红低置信字段确认后才能核对完成，核对完成的单据才可入库。</li>
            <li><b>识别全部</b>：逐张排队识别，全绿单据自动核对通过，含黄/红字段的停在待核对列表。</li>
            <li><b>公司名称以红章为准</b>：OCR 预填后请按红章核对，可手动覆盖。</li>
            <li><b>分区 ＝ 工地</b>：每个工地一个 Excel；用文件卡上的"分区"移动归属，核对完成按收货工地自动归档。</li>
            <li><b>导出归档</b>：每个分区一个子文件夹，内含按公司命名的 PDF + 汇总 Excel。</li>
          </ul>
        </details>

        {recog && <RecognizeOverlay name={recog.name} pct={recog.pct} />}
        {batch && <BatchOverlay batch={batch} />}
        {/* 弹层只在窄屏使用；宽屏同一组件以 inline 形态嵌在三栏右侧，不重复挂两份 */}
        {narrow && reviewFile && <ReviewModal key={reviewFile.id} file={reviewFile} narrow onClose={() => setReviewId(null)} onFinish={(out) => finishReview(reviewFile, out)} />}
      </div>
    );
  }
  window.DeliveryScreen = DeliveryScreen;
})();
