// InvoiceScreen — 发票识别页（识别中心 · 反馈轮 7 重写）
// 单一校对工作台（取消独立上传 Tab）+ 全页拖拽上传 + 两个子模式：字段校对 / 打印排版。
// 数据走 window.INV 共享 store，核对完成（归档入账）后发票流出识别中心 → 进发票台账。
(function () {
  const { Button, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), folderPicker: (cb) => cb && cb() };
  const I = () => window.INV;

  function StatusDot({ tone }) {
    const c = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", brand: "var(--brand)", neutral: "var(--ink-faint)" }[tone] || "var(--ink-faint)";
    return <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, flex: "none" }} />;
  }

  function InvoiceScreen({ navigate }) {
    if (!I()) return <Panel style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>加载中…</Panel>;
    const INV = I();
    const store = INV.useStore();
    const [mode, setMode] = React.useState("review"); // review | print
    const [selId, setSelId] = React.useState(null);
    const [filter, setFilter] = React.useState("all");
    const [drag, setDrag] = React.useState(false);

    // 识别队列区（recognizing + done未归档），不含已归档/重复
    const review = store.live.filter((i) => i.review && i.account !== "posted" && i.status !== "dup");
    const sel = review.find((i) => i.id === selId) || review.find((i) => i.status === "done") || review[0];

    // 识别进度推进
    const hasRecog = review.some((i) => i.status === "recognizing");
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

    const doUpload = (label) => { INV.add(INV.mockUpload()); UI().toast("已上传 2 个文件（" + label + "），进入 OCR 识别队列", "ok"); };
    const onDrop = (e) => { e.preventDefault(); setDrag(false); doUpload("拖拽"); };

    const filterOpts = [
      { key: "all", label: "全部", match: () => true },
      { key: "recog", label: "识别中", match: (i) => i.status === "recognizing" },
      { key: "green", label: "建议通过", match: (i) => i.status === "done" && INV.worstOf(i) === "ok" },
      { key: "warn", label: "待确认", match: (i) => i.status === "done" && INV.worstOf(i) === "warn" },
      { key: "danger", label: "含低置信", match: (i) => i.status === "done" && INV.worstOf(i) === "danger" },
    ];
    const shown = review.filter(filterOpts.find((o) => o.key === filter).match);

    // 建议通过（全绿）批量放行；缺归属排除
    const greens = review.filter((i) => i.status === "done" && INV.isAllGreen(i));
    const greenReady = greens.filter((i) => i.project);
    const greenNoProj = greens.filter((i) => !i.project);
    const batchPass = () => {
      if (!greenReady.length) { UI().toast(greenNoProj.length ? "建议通过的 " + greenNoProj.length + " 张缺归属，请先在字段区选择项目/个人开支" : "暂无建议通过的发票", "danger"); return; }
      const total = greenReady.reduce((s, i) => s + Number(i.total || 0), 0);
      UI().confirm({
        title: "批量通过建议通过发票",
        message: "共 " + greenReady.length + " 张全部字段置信度达标且已选归属，金额合计 " + INV.money(total) + "。通过后归档入账、移入发票台账。" + (greenNoProj.length ? "（另有 " + greenNoProj.length + " 张缺归属未纳入）" : ""),
        confirmText: "批量通过",
        onConfirm: () => { greenReady.forEach((i) => INV.update(i.id, { review: false, account: "posted", fresh: false })); UI().toast("已归档 " + greenReady.length + " 张，移入发票台账", "ok"); },
      });
    };

    return (
      <div onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }} onDrop={onDrop}
        style={{ display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
        <style>{"@keyframes invSpin{to{transform:rotate(360deg)}}"}</style>

        {/* 顶部：子模式切换 + 主操作 */}
        <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", border: "1px solid var(--line-strong)", borderRadius: 10, overflow: "hidden" }}>
            {[["review", "字段校对", "list-checks"], ["print", "打印排版", "printer"]].map(([k, lbl, ic]) => (
              <button key={k} onClick={() => setMode(k)} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: 0, padding: "8px 16px", fontSize: 13, fontWeight: mode === k ? 800 : 600, cursor: "pointer", background: mode === k ? "var(--brand-soft)" : "#fff", color: mode === k ? "var(--brand-deep)" : "var(--ink-soft)" }}>
                <Icon name={ic} size={14} />{lbl}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>识别队列 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{review.length}</b> 张</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {mode === "review" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 12, fontSize: 12, color: "var(--ink-soft)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><StatusDot tone="ok" />≥95 可信</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><StatusDot tone="warn" />80~95 待确认</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><StatusDot tone="danger" />&lt;80 低置信</span>
              </span>
            )}
            {mode === "review" && <Button variant="primary" icon="check-check" disabled={!greenReady.length} onClick={batchPass}>批量通过 {greenReady.length} 张</Button>}
          </div>
        </Panel>

        {mode === "print"
          ? <INV.PrintLayout rows={review.filter((i) => i.status === "done")} onPrint={(i) => INV.update(i.id, { printCount: (i.printCount || 0) + 1, lastPrintedAt: "2026-07-03" })} />
          : (
            <div style={{ display: "grid", gridTemplateColumns: "18fr 40fr 42fr", gap: 14, height: "calc(100vh - 268px)", minHeight: 500 }}>
              {/* 左：上传 + 筛选 + 单行列表 */}
              <Panel padding={0} style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: 10, borderBottom: "1px solid var(--line)", background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <Button variant="primary" icon="upload" onClick={() => UI().folderPicker ? UI().folderPicker(() => doUpload("选择文件")) : doUpload("选择文件")} style={{ width: "100%" }}>上传发票</Button>
                  <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "100%", border: "1px solid var(--line-strong)", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, background: "#fff", cursor: "pointer" }}>
                    {filterOpts.map((o) => <option key={o.key} value={o.key}>{o.label}（{review.filter(o.match).length}）</option>)}
                  </select>
                </div>
                <div style={{ overflowY: "auto", flex: 1 }}>
                  {shown.map((inv) => {
                    const st = INV.statusOf(inv);
                    const on = sel && sel.id === inv.id;
                    return (
                      <button key={inv.id} onClick={() => setSelId(inv.id)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 12px", border: 0, borderBottom: "1px solid var(--line)", background: on ? "var(--brand-soft)" : "transparent", textAlign: "left", cursor: "pointer" }}>
                        {inv.status === "recognizing"
                          ? <span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--brand-soft)", borderTopColor: "var(--brand)", animation: "invSpin .7s linear infinite", flex: "none" }} />
                          : <StatusDot tone={st.tone} />}
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.number ? inv.number.slice(-8) : inv.name}</span>
                          <span style={{ display: "block", fontSize: 11, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.status === "recognizing" ? "识别中 " + Math.floor(inv.progress || 0) + "%" : (inv.seller || inv.buyer)}</span>
                        </span>
                      </button>
                    );
                  })}
                  {shown.length === 0 && <div style={{ padding: 20, fontSize: 12, color: "var(--ink-soft)", textAlign: "center" }}>该筛选下暂无发票。</div>}
                </div>
              </Panel>

              {/* 中：原图 */}
              {sel ? <Panel padding={0} style={{ overflow: "hidden" }}><INV.OriginalPreview inv={sel} /></Panel>
                : <Panel style={{ display: "grid", placeItems: "center", color: "var(--ink-soft)" }}>上传或选择一张发票开始校对</Panel>}

              {/* 右：字段校对 */}
              {sel ? <ReviewForm key={sel.id} sel={sel} navigate={navigate} /> : <Panel style={{ display: "grid", placeItems: "center", color: "var(--ink-soft)" }}>暂无待校对发票</Panel>}
            </div>
          )}

        {drag && (
          <div style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgba(57,118,198,0.10)", backdropFilter: "blur(2px)", display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <div style={{ border: "3px dashed var(--brand)", borderRadius: 20, padding: "40px 64px", background: "rgba(255,255,255,0.95)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <Icon name="upload-cloud" size={40} color="var(--brand)" />
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--brand-deep)" }}>松开鼠标上传发票</div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>支持 PDF / 图片 / 文件夹，上传后自动 OCR 识别</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function ReviewForm({ sel, navigate }) {
    const INV = window.INV;
    const st = INV.statusOf(sel);
    const [f, setF] = React.useState(() => INV.blankForm(sel));
    React.useEffect(() => setF(INV.blankForm(sel)), [sel.id]);
    const onField = (k, v) => { setF((p) => ({ ...p, [k]: v })); if (INV.fieldLevel(sel, k) !== "ok") INV.update(sel.id, { confirmed: { ...(sel.confirmed || {}), [k]: true } }); };
    const onConfirm = (k) => { INV.update(sel.id, { confirmed: { ...(sel.confirmed || {}), [k]: true } }); UI().toast("已确认该字段", "ok"); };
    const bad = INV.badFields(sel);
    const allGreen = bad.length === 0;
    const hasProj = !!f.project;
    const canArchive = allGreen && hasProj && sel.status === "done";

    if (sel.status === "recognizing") {
      return <Panel style={{ display: "grid", placeItems: "center", color: "var(--ink-soft)", gap: 10 }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", border: "3px solid var(--brand-soft)", borderTopColor: "var(--brand)", animation: "invSpin .7s linear infinite" }} />
        <div style={{ fontSize: 13 }}>识别中 {Math.floor(sel.progress || 0)}%，完成后自动进入校对</div>
      </Panel>;
    }

    return (
      <Panel style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>识别结果校对</h2>
          <StatusChip tone={st.tone}>{st.text}</StatusChip>
        </div>

        <INV.FieldGrid inv={sel} f={f} onField={onField} onConfirm={onConfirm} />

        <INV.ItemsTable inv={sel} />

        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
          {!allGreen && <div style={{ padding: "8px 11px", background: "var(--warn-soft)", color: "var(--warn-ink)", borderRadius: 8, fontSize: 12, lineHeight: 1.6 }}>还有 <b>{bad.length}</b> 个字段（{bad.map((d) => d.label).join("、")}）待确认，全部转绿后可归档。</div>}
          {allGreen && !hasProj && <div style={{ padding: "8px 11px", background: "var(--warn-soft)", color: "var(--warn-ink)", borderRadius: 8, fontSize: 12, lineHeight: 1.6 }}>请在「对应归属」选择项目或个人开支后再归档（未指定归属禁止归档）。</div>}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <Button variant="danger" onClick={() => UI().confirm({ title: "废弃发票", message: "确定废弃「" + (f.number ? String(f.number).slice(-8) : sel.name) + "」？废弃为软删除，可在 5 秒内撤回。", danger: true, confirmText: "废弃", onConfirm: () => INV.softDel(sel, "废弃") })}>废弃</Button>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button onClick={() => { INV.update(sel.id, { status: "recognizing", progress: 0, confirmed: {}, fresh: true }); UI().toast("已重新排队 OCR 识别", "ok"); }}>重新识别</Button>
              <Button onClick={() => { INV.update(sel.id, INV.valuePatch(f)); UI().toast("已保存校对结果", "ok"); }}>保存校对</Button>
              <span title={canArchive ? "校对无误后归档入台账" : "需全部字段转绿且已选归属"}>
                <Button variant="primary" icon="file-check" disabled={!canArchive} onClick={() => UI().confirm({ title: "归档入账", message: "将该发票归档入账，移入发票台账（归属：" + f.project + "）？", confirmText: "归档入账", onConfirm: () => { INV.update(sel.id, { ...INV.valuePatch(f), review: false, account: "posted", fresh: false }); UI().toast("已归档入账，移入发票台账", "ok"); } })}>归档入账</Button>
              </span>
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  window.InvoiceScreen = InvoiceScreen;
})();
