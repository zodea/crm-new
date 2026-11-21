// InvoiceScreen — 发票识别工作台（按实现端 app/pages/finance/invoice/_components/InvoiceWorkspaceScreen.vue 校准）
// 单一校对工作台 + 全页拖拽上传 + 两个子模式：字段校对 / 打印排版
// （子模式切换内联在工具栏那一条里，不独占一行；实现端同步走 SegTab 的 pill 变体）。
// 三栏 = 队列 | 原件（排版模式下换成 A4 排版） | 校对，与实现端 AdaptiveWorkbench 同构：
// 宽屏 minmax(12rem,18rem) minmax(18rem,.95fr) minmax(20rem,1.05fr) 并置、高度 clamp(24rem,72dvh,52rem)；
// 窄屏切分段 Tab 一次一栏（三个面板都保留，不整页替换）。
// 数据走 window.INV 共享 store，归档入账后发票流出识别中心 → 进发票台账。
(function () {
  const { Button, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), folderPicker: (cb) => cb && cb() };
  const I = () => window.INV;
  const KA = () => window.KitAtoms || {};

  // 三栏并置的下限。实现端 AdaptiveWorkbench 用容器查询在 960px 容器宽切分段；
  // 设计稿没有容器查询基础设施，按侧栏约 240px 折算为视口 1200px，取同一条界线。
  const useNarrow = () => {
    const [narrow, setNarrow] = React.useState(window.innerWidth < 1200);
    React.useEffect(() => {
      const onR = () => setNarrow(window.innerWidth < 1200);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }, []);
    return narrow;
  };

  const DOT = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", brand: "var(--brand)", neutral: "var(--ink-faint)" };
  const CHIP_INK = { ok: "var(--ok-ink)", warn: "var(--warn-ink)", danger: "var(--danger-ink)", brand: "var(--brand)" };

  function InvoiceScreen({ navigate }) {
    if (!I()) return <Panel style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>加载中…</Panel>;
    const INV = I();
    const narrow = useNarrow();
    const store = INV.useStore();
    const [mode, setMode] = React.useState("review"); // review | print
    const [pane, setPane] = React.useState("queue");  // 窄屏分段：queue | source | review
    const [selId, setSelId] = React.useState(null);
    const [filter, setFilter] = React.useState("all");
    const [search, setSearch] = React.useState("");
    const [drag, setDrag] = React.useState(false);

    // 工作台 = 全部未归档发票（含待识别/识别中/待校对/已校对/重复）；已归档的流出工作台进台账
    const workspace = store.live.filter((i) => i.account !== "posted");
    const rows = workspace.map((inv) => ({ inv, q: INV.queueStatusOf(inv) }));

    const filterOpts = [
      { key: "all", label: "全部状态", match: () => true },
      { key: "recog", label: "识别中", match: (r) => r.q.st === "recognizing" },
      { key: "green", label: "建议通过", match: (r) => !!r.q.suggested },
      { key: "warn", label: "待确认", match: (r) => !r.q.suggested && r.q.st === "unreviewed" && INV.worstOf(r.inv) === "warn" },
      { key: "danger", label: "含低置信", match: (r) => !r.q.suggested && r.q.st === "unreviewed" && INV.worstOf(r.inv) === "danger" },
    ];
    const kw = search.trim().toLowerCase();
    const shown = rows
      .filter(filterOpts.find((o) => o.key === filter).match)
      .filter(({ inv }) => !kw || [inv.number, inv.name, inv.seller, inv.buyer].some((v) => v && v.toLowerCase().indexOf(kw) > -1));
    const sel = shown.find((r) => r.inv.id === selId) || shown[0];
    const selInv = sel && sel.inv;
    React.useEffect(() => { if (sel && sel.inv.id !== selId) setSelId(sel.inv.id); if (!sel && selId) setSelId(null); }, [shown.map((r) => r.inv.id).join(",")]);

    const pendingReview = workspace.filter((i) => INV.docStatusOf(i) === "unreviewed").length;
    const pendingRecog = workspace.filter((i) => INV.docStatusOf(i) === "pending").length;

    // 识别进度推进
    const hasRecog = workspace.some((i) => i.status === "recognizing");
    React.useEffect(() => {
      if (!hasRecog) return;
      const t = setInterval(() => {
        store.live.forEach((i) => {
          if (i.status !== "recognizing") return;
          const p = (i.progress || 0) + 9 + Math.random() * 13;
          INV.update(i.id, p >= 100 ? { status: "done", progress: 100 } : { progress: p });
        });
      }, 170);
      return () => clearInterval(t);
    }, [hasRecog]);

    const doUpload = (label) => { const arr = INV.mockUpload(); INV.add(arr); setSelId(arr[0].id); UI().toast("已上传 2 个文件（" + label + "），进入 OCR 识别队列", "ok"); };
    const onDrop = (e) => { e.preventDefault(); setDrag(false); doUpload("拖拽"); };
    const batchRecognize = () => {
      const q = workspace.filter((i) => INV.docStatusOf(i) === "pending");
      if (!q.length) { UI().toast("没有待识别的发票"); return; }
      q.forEach((i) => INV.update(i.id, { status: "recognizing", progress: 0 }));
    };

    // 建议通过（全绿待校对）批量放行；缺归属排除并列清单
    const greens = rows.filter((r) => r.q.suggested).map((r) => r.inv);
    const greenReady = greens.filter((i) => INV.attributionOf(i));
    const greenNoProj = greens.filter((i) => !INV.attributionOf(i));
    const batchPass = () => {
      if (!greenReady.length) return;
      greenReady.forEach((i) => INV.update(i.id, { reviewed: true, account: "posted", fresh: false }));
      UI().toast("已通过并归档 " + greenReady.length + " 张", "ok");
      if (greenNoProj.length) {
        UI().confirm({
          title: "已排除 " + greenNoProj.length + " 张（缺归属）",
          message: greenNoProj.map((i) => "·「" + (i.number ? i.number.slice(-8) : i.name) + "」— 缺归属：填写对应项目或选个人开支").join("\n") + "\n\n补齐对应项目或选个人开支后可再次批量通过。",
          confirmText: "知道了",
        });
      }
    };

    const paneLabels = { queue: "队列", source: mode === "print" ? "排版" : "原件", review: "校对" };

    return (
      <div onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }} onDrop={onDrop}
        style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
        <style>{"@keyframes invSpin{to{transform:rotate(360deg)}}"}</style>

        {/* 顶部操作栏：子模式切换内联在这一条里，不独占一行 */}
        <Panel padding={14} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", flex: "none", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", overflow: "hidden", background: "var(--panel)" }}>
            {[["review", "字段校对", "list-checks"], ["print", "打印排版", "printer"]].map(([k, lbl, ic]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, border: 0, padding: "0 12px", fontSize: 13, cursor: "pointer",
                  fontWeight: mode === k ? 800 : 600, background: mode === k ? "var(--brand-soft)" : "var(--panel)", color: mode === k ? "var(--brand-deep)" : "var(--ink-soft)" }}>
                <Icon name={ic} size={14} />{lbl}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>识别队列 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{workspace.length}</b> 张</span>
          {!narrow && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 12, fontSize: 11, color: "var(--ink-soft)" }}>
              {/* 图例百分比与 CONF_THRESHOLD 同源，不写死——写死会跟阈值漂移 */}
              {[["ok", "≥" + INV.CONF_THRESHOLD.ok + " 可信"], ["warn", INV.CONF_THRESHOLD.warn + "–" + INV.CONF_THRESHOLD.ok + " 待确认"], ["danger", "<" + INV.CONF_THRESHOLD.warn + " 低置信"]].map(([tone, txt]) => (
                <span key={tone} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: DOT[tone], flex: "none" }} />{txt}
                </span>
              ))}
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Button icon="book-open" onClick={() => navigate && navigate("invoiceLedger")}>发票台账</Button>
            <Button icon="plus" onClick={() => UI().formModal && UI().formModal({
              title: "手动录入发票", cols: 2, width: 640, saveText: "添加",
              fields: [
                { key: "type", label: "票据类型", type: "select", options: ["增值税专用发票", "增值税普通发票"] },
                { key: "number", label: "发票号码" },
                { key: "date", label: "开票日期", placeholder: "2026-07-03" },
                { key: "rate", label: "税率", type: "select", options: ["13%", "9%", "6%", "3%", "1%", "0%"] },
                { key: "buyer", label: "购买方", value: "广州市瑞航建筑工程有限公司" },
                { key: "seller", label: "供应商（销方）" },
                { key: "amount", label: "不含税金额" },
                { key: "tax", label: "税额" },
                { key: "total", label: "价税合计" },
                { key: "project", label: "对应项目", type: "select", options: INV.projectsList() },
                { key: "owner", label: "发票归属", type: "select", options: ["暂不归属（先录入，台账页再归档）", "归属项目", "个人开支"] },
                { key: "remark", label: "票面备注", full: true },
              ],
              onSave: () => UI().toast("发票已添加，待归档后计入台账", "ok"),
            })}>手动录入</Button>
            <Button icon="scan-text" disabled={hasRecog || !pendingRecog} title={pendingRecog ? "识别 " + pendingRecog + " 张待识别发票" : "没有待识别的发票"} onClick={batchRecognize}>
              批量识别{pendingRecog ? " " + pendingRecog : ""}
            </Button>
            <Button variant="primary" icon="check-check" disabled={!greens.length} title={greens.length ? "放行 " + greens.length + " 张建议通过发票" : "没有建议通过的发票"} onClick={batchPass}>
              批量通过{greens.length ? " " + greens.length : ""}
            </Button>
          </div>
        </Panel>

        {/* 窄屏分段：三个面板都保留，一次显示一栏 */}
        {narrow && KA().SegTab && (
          <Panel padding={0} style={{ padding: "0 12px", overflow: "hidden" }}>
            {KA().SegTab({
              active: pane, onChange: setPane,
              tabs: [{ key: "queue", label: paneLabels.queue, count: shown.length }, { key: "source", label: paneLabels.source }, { key: "review", label: paneLabels.review }],
            })}
          </Panel>
        )}

        <div style={{ display: "grid", gap: 12, minWidth: 0,
          gridTemplateColumns: narrow ? "1fr" : "minmax(12rem, 18rem) minmax(18rem, 0.95fr) minmax(20rem, 1.05fr)",
          blockSize: narrow ? "auto" : "clamp(24rem, 72dvh, 52rem)" }}>

          {(!narrow || pane === "queue") && (
            <QueuePanel rows={shown} total={workspace.length} pendingReview={pendingReview} selId={selInv && selInv.id}
              filter={filter} onFilter={setFilter} search={search} onSearch={setSearch}
              onPick={setSelId} onUpload={() => (UI().folderPicker ? UI().folderPicker(() => doUpload("选择文件")) : doUpload("选择文件"))} />
          )}

          {(!narrow || pane === "source") && (
            mode === "print"
              ? <INV.PrintLayout rows={shown.map((r) => r.inv)} selId={selInv && selInv.id} onSelect={setSelId}
                  onPrint={(i) => INV.update(i.id, { printCount: (i.printCount || 0) + 1, lastPrintedAt: "2026-07-03" })} />
              : <OriginalPane inv={selInv} />
          )}

          {(!narrow || pane === "review") && <ReviewPane inv={selInv} />}
        </div>

        {drag && (
          <div style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgba(57,118,198,0.10)", backdropFilter: "blur(2px)", display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <div style={{ border: "3px dashed var(--brand)", borderRadius: 20, padding: "40px 64px", background: "rgba(255,255,255,0.95)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <Icon name="file-down" size={40} color="var(--brand)" />
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--brand-deep)" }}>松开上传发票，自动进入识别队列</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // —— 左栏：上传 + 筛选 + 搜索 + 单行队列 ——
  function QueuePanel({ rows, total, pendingReview, selId, filter, onFilter, search, onSearch, onPick, onUpload }) {
    const inp = { width: "100%", boxSizing: "border-box", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", background: "#fff", padding: "6px 9px", fontSize: 12, outline: "none" };
    return (
      <aside style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0, overflow: "hidden", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", background: "var(--panel)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderBottom: "1px solid var(--line)", background: "var(--surface-2)", flex: "none" }}>
          <Button variant="primary" icon="upload" onClick={onUpload} style={{ width: "100%" }}>上传发票</Button>
          <select aria-label="筛选识别队列" value={filter} onChange={(e) => onFilter(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
            <option value="all">全部状态（{total}）</option>
            <option value="recog">识别中</option>
            <option value="green">建议通过</option>
            <option value="warn">待确认</option>
            <option value="danger">含低置信</option>
          </select>
          <input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="搜索票号、文件、公司…" style={inp} />
        </div>
        <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", fontSize: 11, color: "var(--ink-soft)", flex: "none" }}>
          当前 {rows.length} 张 · 待校对 {pendingReview}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {rows.map(({ inv, q }) => {
            const on = selId === inv.id;
            return (
              <button key={inv.id} type="button" aria-label={"选择发票 " + (inv.number || inv.name)} onClick={() => onPick(inv.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 10px", border: 0, borderBottom: "1px solid var(--line)", background: on ? "var(--brand-soft)" : "transparent", textAlign: "left", cursor: "pointer" }}>
                {q.st === "recognizing"
                  ? <span style={{ width: 8, height: 8, borderRadius: "50%", border: "2px solid var(--brand-soft)", borderTopColor: "var(--brand)", animation: "invSpin .7s linear infinite", flex: "none" }} />
                  : <span style={{ width: 8, height: 8, borderRadius: "50%", background: DOT[q.tone], flex: "none" }} />}
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 11, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={inv.name || inv.number}>
                    {inv.number ? "…" + inv.number.slice(-8) : (inv.name || "—")}
                  </span>
                  <span style={{ display: "block", marginTop: 2, fontSize: 10, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {inv.seller || inv.buyer || inv.name || "待识别"}
                  </span>
                </span>
                <span style={{ flex: "none", fontSize: 10, fontWeight: q.st === "recognizing" ? 600 : 400, color: CHIP_INK[q.tone] || "var(--ink-soft)" }}>{q.text}</span>
              </button>
            );
          })}
          {rows.length === 0 && <div style={{ padding: 16, fontSize: 12, color: "var(--ink-faint)", textAlign: "center" }}>{total ? "当前筛选下暂无发票" : "上传发票开始识别"}</div>}
        </div>
      </aside>
    );
  }

  // —— 中栏：发票原图 ——
  function OriginalPane({ inv }) {
    const INV = window.INV;
    return (
      <section style={{ height: "100%", minWidth: 0, overflowY: "auto", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", background: "var(--surface-sink, var(--surface-2))", padding: 16, boxShadow: "var(--shadow-card)" }}>
        <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>发票原图</div>
        <div style={{ margin: "0 auto", maxWidth: 560, aspectRatio: "1 / 1.4142", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", background: "var(--panel)", padding: 16, boxShadow: "var(--shadow-card)", display: "grid", placeItems: "center" }}>
          {inv
            ? <div style={{ width: "100%" }}>{INV.invoiceSvg(inv)}</div>
            : <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>从左侧列表选择发票</span>}
        </div>
      </section>
    );
  }

  // —— 右栏：识别结果提取（进度优先于表单：重新识别时也显示识别中而非旧字段）——
  function ReviewPane({ inv }) {
    const INV = window.INV;
    return (
      <section style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0, overflow: "hidden", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", background: "var(--panel)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ flex: "none", padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>识别结果提取</div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {!inv && <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "var(--ink-faint)" }}>选择一张发票开始校对</div>}
          {inv && inv.status === "recognizing" && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12 }}>
              <span style={{ display: "block", width: 20, height: 20, margin: "0 auto 8px", borderRadius: "50%", border: "3px solid var(--brand-soft)", borderTopColor: "var(--brand)", animation: "invSpin .7s linear infinite" }} />
              <span style={{ color: "var(--brand)", fontWeight: 600 }}>识别中 {Math.floor(inv.progress || 0)}%</span>
            </div>
          )}
          {inv && inv.status === "failed" && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12 }}>
              <Icon name="circle-alert" size={20} color="var(--danger)" />
              <p style={{ margin: "8px 0 12px", color: "var(--danger)" }}>识别失败，请检查服务后重试</p>
              <Button onClick={() => INV.update(inv.id, { status: "recognizing", progress: 0 })}>重新识别</Button>
            </div>
          )}
          {inv && inv.status !== "recognizing" && inv.status !== "failed" && inv.status !== "done" && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--ink-faint)" }}>待识别——点击顶部「批量识别」开始</div>
          )}
          {inv && inv.status === "done" && <div style={{ padding: 12 }}><ReviewForm key={inv.id} sel={inv} /></div>}
        </div>
      </section>
    );
  }

  // —— 字段校对表单（改字段/点确认即时落库，不设「保存校对」）——
  function ReviewForm({ sel }) {
    const INV = window.INV;
    const [f, setF] = React.useState(() => INV.blankForm(sel));
    React.useEffect(() => setF(INV.blankForm(sel)), [sel.id]);
    const onField = (k, v) => {
      setF((p) => ({ ...p, [k]: v }));
      // 人工修正即视为确认（黄/红转绿），与实现端 store.correctField 同口径
      INV.update(sel.id, { [k]: v, confirmed: { ...(sel.confirmed || {}), [k]: true } });
    };
    const onConfirm = (k) => { INV.update(sel.id, { confirmed: { ...(sel.confirmed || {}), [k]: true } }); UI().toast("已确认该字段", "ok"); };

    const kind = INV.ownerKindOf(sel);
    const attribution = INV.attributionOf(sel);
    const dup = sel.status === "dup";
    const setKind = (k) => { if (kind !== k) INV.update(sel.id, { ownerKind: k }); };
    const chip = (on) => ({ border: 0, borderRadius: 999, padding: "2px 9px", fontSize: 11, cursor: "pointer",
      background: on ? "var(--brand-soft)" : "var(--surface-3)", color: on ? "var(--brand-deep)" : "var(--ink-soft)" });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <INV.FieldGrid inv={sel} f={f} onField={onField} onConfirm={onConfirm}
          projectDisabled={kind === "personal"} invalidProject={kind !== "personal" && !attribution} />

        <INV.ItemsTable inv={sel} />

        <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>
          OCR 置信度: {(INV.worstOf(sel) === "ok" ? 98.6 : INV.worstOf(sel) === "warn" ? 93.2 : 86.4).toFixed(1)}%（仅作参考，判决权在人）
        </div>

        {dup && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--danger-ink)" }}>
            <Icon name="copy-x" size={12} color="var(--danger)" />重复票已排除，不可确认/归档——可废弃，或重新识别后按新发票号重判
          </div>
        )}

        {!dup && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, flexWrap: "wrap" }}>
            <span style={{ color: "var(--ink-soft)", flex: "none" }}>归属</span>
            <button type="button" style={chip(kind !== "personal")} onClick={() => setKind("project")}>项目</button>
            <button type="button" style={chip(kind === "personal")} onClick={() => setKind("personal")}>个人开支</button>
            {!attribution && <span style={{ color: "var(--danger-ink)" }}>未归属：填写对应项目（须为已有项目）或选个人开支</span>}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <Button variant="danger" icon="trash-2" onClick={() => INV.softDel(sel, "废弃")}>废弃</Button>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button icon="refresh-cw" onClick={() => { INV.update(sel.id, { status: "recognizing", progress: 0, confirmed: {}, fresh: true }); UI().toast("已重新排队 OCR 识别", "ok"); }}>重新识别</Button>
            {!dup && !sel.reviewed && (
              <Button variant="primary" icon="file-check" onClick={() => { INV.update(sel.id, { ...INV.valuePatch(f), reviewed: true }); UI().toast("已确认，可归档或在台账页归档", "ok"); }}>确认</Button>
            )}
            {!dup && sel.reviewed && (
              <Button variant="primary" icon="archive" disabled={!attribution}
                title={attribution ? "归档并计入台账" : "缺归属：填写对应项目或选个人开支后方可归档"}
                onClick={() => { INV.update(sel.id, { ...INV.valuePatch(f), account: "posted", fresh: false }); UI().toast("已归档，计入台账", "ok"); }}>归档入账</Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  window.InvoiceScreen = InvoiceScreen;
})();
