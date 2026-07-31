// InvoiceEditScreen — 单张发票编辑页签（按实现端 app/pages/finance/invoice/[id].vue 校准）
// 由台账点「编辑」经 navigate("invoiceEdit",{id}) 开应用内页签。左原图 + 右完整字段集（与识别校对同一字段序）。
// 字段走本地缓冲、保存一次提交（区别于工作台改一格即落库）；已归档发票保存前弹二次确认；删/存后关页签回台账。
(function () {
  const { Button, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
  const I = () => window.INV;
  const KA = () => window.KitAtoms || {};
  const backToLedger = (navigate) => { const dc = window.DC; if (dc && dc.closeActiveTab) dc.closeActiveTab(); if (navigate) navigate("invoiceLedger"); };

  // 左右并置的下限，取实现端 .invoice-edit-layout 的容器查询断点 64rem（1024px）。
  const useNarrow = () => {
    const [narrow, setNarrow] = React.useState(window.innerWidth < 1024);
    React.useEffect(() => {
      const onR = () => setNarrow(window.innerWidth < 1024);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }, []);
    return narrow;
  };

  // 名称→蓝链：发票行存的是名称字符串不是 id，按名称反查共享 store；查不到实体 → 保持原文本，绝不做死链。
  const NameText = ({ type, coll, name }) => {
    const A = window.APP;
    const EL = KA().EntityLink;
    const hit = A && name ? A.rows(coll).find((x) => x.name === name || (coll === "suppliers" && (x.aliases || []).indexOf(name) >= 0)) : null;
    if (!EL || !hit) return name || null;
    return <EL type={type} id={hit.id} label={name} />;
  };

  function InvoiceEditScreen({ params, navigate }) {
    if (!I()) return <Panel style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>加载中…</Panel>;
    const INV = I();
    const narrow = useNarrow();
    INV.useStore(); // 订阅共享 store：识别进度 / 台账改动实时回流本页签
    const inv = INV.get((params || {}).id);

    if (!inv || inv.discarded) return (
      <Panel style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
        <Icon name="file-x" size={32} color="var(--ink-faint)" />
        <div>该发票不存在或已删除。</div>
        <Button icon="arrow-left" onClick={() => backToLedger(navigate)}>返回台账</Button>
      </Panel>
    );

    // 本地缓冲：改字段不落库，保存时一次提交
    const [f, setF] = React.useState(() => INV.blankForm(inv));
    const [kind, setKind] = React.useState(() => INV.ownerKindOf(inv));
    React.useEffect(() => { setF(INV.blankForm(inv)); setKind(INV.ownerKindOf(inv)); }, [inv.id]);
    // 重新识别完成后刷新缓冲区（不在编辑中途随意重置）
    const recognizing = inv.status === "recognizing";
    const wasRecog = React.useRef(recognizing);
    React.useEffect(() => {
      if (wasRecog.current && !recognizing) { setF(INV.blankForm(inv)); UI().toast("识别完成，字段已刷新", "ok"); }
      wasRecog.current = recognizing;
    }, [recognizing]);

    const onField = (k, v) => setF((p) => ({ ...p, [k]: v }));
    const st = INV.statusOf(inv);
    const posted = inv.account === "posted";
    const tail8 = (n) => (n ? n.slice(-8) : "—");

    const save = () => {
      const patch = { ...INV.valuePatch(f), ownerKind: kind };
      if (kind === "personal") patch.project = "";
      // 已归档发票的项目归属必须命中项目主数据（保护台账口径）
      if (posted && kind === "project" && INV.projectsList().indexOf(String(patch.project || "").trim()) < 0) {
        UI().toast("已归档发票的项目归属必须命中项目主数据，请从下拉中选择", "danger");
        return;
      }
      const apply = () => { INV.update(inv.id, patch); UI().toast("已保存修改", "ok"); backToLedger(navigate); };
      if (posted) UI().confirm({ title: "修改已归档发票", confirmText: "确认修改", message: "该发票已归档入台账，保存将同步更新台账统计。确认保存本次修改？", onConfirm: apply });
      else apply();
    };
    const del = () => UI().confirm({
      title: "删除发票", confirmText: "删除", danger: true,
      message: "确认删除发票「" + tail8(inv.number) + "」？删除后可在 10 秒内撤回。",
      onConfirm: () => { INV.softDel(inv); backToLedger(navigate); },
    });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <style>{"@keyframes invSpin{to{transform:rotate(360deg)}}"}</style>

        {/* 顶条：返回 + 号码/卖方 + 状态 */}
        <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button icon="arrow-left" onClick={() => backToLedger(navigate)}>返回台账</Button>
          <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "var(--font-mono)" }}>{inv.number || "—"}</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}><NameText type="supplier" coll="suppliers" name={inv.seller} /></span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <StatusChip tone={st.tone}>{st.text}</StatusChip>
            {posted && <StatusChip tone="ok">已在台账</StatusChip>}
          </div>
        </Panel>

        <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr)" : "repeat(2, minmax(0, 1fr))", gap: 12, alignItems: "start" }}>
          {/* 左：原件 */}
          <Panel padding={0} style={{ overflow: "hidden", minHeight: 420, display: "flex", flexDirection: "column" }}>
            <div style={{ flex: "none", padding: "8px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>
              发票原件 · {inv.name || "无扫描件"}
            </div>
            <div style={{ flex: 1, display: "grid", placeItems: "center", background: "var(--surface-sink, var(--surface-2))", padding: 24 }}>
              <div style={{ width: "100%", maxWidth: 560 }}>{INV.invoiceSvg(inv)}</div>
            </div>
          </Panel>

          {/* 右：字段（本地缓冲）+ 明细 + 动作 */}
          <Panel style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>发票字段</h2>

            {/* 归属（与校对表单一致：项目 / 个人开支） */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)" }}>归属</span>
              <div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: "var(--radius-btn)", overflow: "hidden" }}>
                {[["project", "归属项目"], ["personal", "个人开支"]].map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => setKind(k)}
                    style={{ border: 0, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: kind === k ? 800 : 600, background: kind === k ? "var(--brand-soft)" : "var(--panel)", color: kind === k ? "var(--brand-deep)" : "var(--ink-soft)" }}>{lbl}</button>
                ))}
              </div>
              {!kind && <StatusChip tone="warn">未归属</StatusChip>}
            </div>

            <INV.FieldGrid inv={inv} f={f} onField={onField} plain projectDisabled={kind === "personal"} />

            <INV.ItemsTable inv={inv} />

            {/* 动作：删除 ｜ 重新识别 + 保存 */}
            <div style={{ marginTop: 4, paddingTop: 12, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <Button variant="danger" icon="trash-2" onClick={del}>删除</Button>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button icon="refresh-cw" disabled={recognizing} onClick={() => { INV.update(inv.id, { status: "recognizing", progress: 0, confirmed: {} }); UI().toast("已重新排队 OCR 识别", "ok"); }}>
                  {recognizing ? "识别中…" : "重新识别"}
                </Button>
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
