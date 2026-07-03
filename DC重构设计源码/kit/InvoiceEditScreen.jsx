// InvoiceEditScreen — 单张发票编辑页签（反馈轮 7 · 台账「修改」呈现）
// 由台账点「编辑」经 navigate("invoiceEdit",{id}) 开应用内页签（红圈式页签导航 #40）。
// 左原图 + 右完整字段集（与识别校对一致）+ 重新识别 / 删除 / 保存；归档后修改弹二次确认；删/存后关页签回台账。
(function () {
  const { Button, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
  const I = () => window.INV;
  const backToLedger = (navigate) => { const dc = window.DC; if (dc && dc.closeActiveTab) dc.closeActiveTab(); if (navigate) navigate("invoiceLedger"); };

  function InvoiceEditScreen({ params, navigate }) {
    if (!I()) return <Panel style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>加载中…</Panel>;
    const INV = I();
    const store = INV.useStore();
    const inv = INV.get((params || {}).id);
    if (!inv || inv.discarded) return (
      <Panel style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
        <Icon name="file-x" size={32} color="var(--ink-faint)" />
        <div>该发票不存在或已删除。</div>
        <Button icon="arrow-left" onClick={() => backToLedger(navigate)}>返回台账</Button>
      </Panel>
    );

    const [f, setF] = React.useState(() => INV.blankForm(inv));
    React.useEffect(() => setF(INV.blankForm(inv)), [inv.id]);
    const onField = (k, v) => { setF((p) => ({ ...p, [k]: v })); if (INV.fieldLevel(inv, k) !== "ok") INV.update(inv.id, { confirmed: { ...(inv.confirmed || {}), [k]: true } }); };
    const onConfirm = (k) => { INV.update(inv.id, { confirmed: { ...(inv.confirmed || {}), [k]: true } }); UI().toast("已确认该字段", "ok"); };
    const st = INV.statusOf(inv);
    const posted = inv.account === "posted";

    const save = () => {
      const apply = () => { INV.update(inv.id, INV.valuePatch(f)); UI().toast("已保存修改", "ok"); backToLedger(navigate); };
      if (posted) UI().confirm({ title: "修改已归档发票", message: "该发票已归档入台账，确认保存本次修改？", confirmText: "确认修改", onConfirm: apply });
      else apply();
    };
    const del = () => UI().confirm({ title: "删除发票", message: "确定删除「" + inv.number.slice(-8) + "」？删除为软删除，可在 5 秒内撤回。", danger: true, confirmText: "删除", onConfirm: () => { INV.softDel(inv); backToLedger(navigate); } });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <style>{"@keyframes invSpin{to{transform:rotate(360deg)}}"}</style>
        <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button icon="arrow-left" onClick={() => backToLedger(navigate)}>返回台账</Button>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "var(--font-mono)" }}>{inv.number}</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{inv.seller}</span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <StatusChip tone={st.tone}>{st.text}</StatusChip>
            {posted && <StatusChip tone="ok">已在台账</StatusChip>}
          </div>
        </Panel>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
          <Panel padding={0} style={{ overflow: "hidden", height: "calc(100vh - 240px)", minHeight: 460 }}>
            <INV.OriginalPreview inv={inv} />
          </Panel>

          <Panel style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>发票字段</h2>
            <INV.FieldGrid inv={inv} f={f} onField={onField} onConfirm={onConfirm} />
            <INV.ItemsTable inv={inv} />
            <div style={{ marginTop: 6, paddingTop: 12, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <Button variant="danger" icon="trash-2" onClick={del}>删除</Button>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button icon="refresh-cw" onClick={() => { INV.update(inv.id, { status: "recognizing", progress: 0, confirmed: {} }); UI().toast("已重新排队 OCR 识别（在发票识别页查看进度）", "ok"); }}>重新识别</Button>
                <Button variant="primary" icon="save" onClick={save}>保存</Button>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  window.InvoiceEditScreen = InvoiceEditScreen;
})();
