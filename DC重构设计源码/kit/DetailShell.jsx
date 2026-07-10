// DetailShell — 批A 底座件③：实体详情通用外壳（红圈式）。
// 结构：摘要条（返回=关页签 + 标题/编号/状态 chip + 右上操作 + 四级对账 MetricGrid）
//       + 主列（SegTab 关联单据 Tab 壳，内容由调用方 children 渲染）
//       + 右侧栏（文书预览 chip + 文件列表）。**审批流不挂**（grilling 决议③：详情只留状态 chip）。
// props: { title, code, chips(node), headerExtra(node), onBack(缺省=window.DC.closeActiveTab),
//          metrics:[{label,value,formula,tone,big}], metricCols,
//          tabs:[{key,label,count}], activeTab, onTabChange,
//          docs:[{name,pages}], files:[{name,size}], asideExtra(node), children }
// 各实体详情（合同/后续批次单据）一律套此壳，不适用段传空即隐藏。
(function () {
  if (window.DetailShell) { window.DetailShellPreload = window.DetailShellPreload || function () { return null; }; return; }
  const UI = () => window.KitUI || { toast: () => {}, modal: () => {} };

  // 文书预览：mock 页面渲染（P1 previewDoc 同构：灰底纸张 + 行占位），真渲染留 Nuxt
  function previewDoc(doc) {
    const m = UI().modal({ title: doc.name, subtitle: "文书预览 · 共 " + (doc.pages || 1) + " 页（演示渲染）", width: 640,
      bodyHTML: "", actions: [{ label: "下载原件", onClick: () => UI().toast("已开始下载 " + doc.name + "（演示）", "ok") }, { label: "关闭", primary: true }] });
    if (!m || !m.body) return;
    const page = document.createElement("div");
    Object.assign(page.style, { background: "#fff", border: "1px solid var(--line)", borderRadius: "6px",
      boxShadow: "0 1px 4px rgba(16,24,40,0.08)", padding: "36px 32px", minHeight: "420px" });
    const mkLine = (w, h, mb) => { const d = document.createElement("div"); Object.assign(d.style, { width: w, height: h || "10px", background: "var(--surface-3)", borderRadius: "3px", marginBottom: mb || "10px" }); return d; };
    page.appendChild(mkLine("52%", "16px", "22px"));
    for (let i = 0; i < 12; i++) page.appendChild(mkLine((62 + ((i * 13) % 32)) + "%"));
    page.appendChild(mkLine("38%", "10px", "0"));
    const hint = document.createElement("div");
    Object.assign(hint.style, { textAlign: "center", fontSize: "12px", color: "var(--ink-faint)", marginTop: "10px" });
    hint.textContent = "第 1 / " + (doc.pages || 1) + " 页 · 设计稿为示意渲染";
    m.body.appendChild(page); m.body.appendChild(hint);
  }

  function DetailShell(props) {
    const { Panel, Icon, IconButton, Button } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    if (!Panel || !KA.Metric) return null;
    const onBack = props.onBack || (() => window.DC && window.DC.closeActiveTab());
    const docs = props.docs || [];
    const files = props.files || [];
    const hasAside = docs.length > 0 || files.length > 0 || props.asideExtra;

    const chip = (icon, label, onClick, key) => (
      <button key={key} type="button" onClick={onClick} title={label}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--line-strong)",
          background: "var(--surface-2)", borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: 600,
          color: "var(--ink)", cursor: "pointer", maxWidth: "100%" }}>
        {Icon && <Icon name={icon} size={13} color="var(--brand)" />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </button>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* —— 摘要条 —— */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderBottom: props.metrics ? "1px solid var(--line)" : "none" }}>
            <IconButton icon="arrow-left" title="返回（关闭页签）" onClick={onBack} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 17, fontWeight: 800 }}>{props.title}</span>
                {props.chips}
              </div>
              {props.code && <div style={{ fontSize: 12, color: "var(--ink-soft)", fontFamily: "var(--font-mono)", marginTop: 2 }}>{props.code}</div>}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>{props.headerExtra}</div>
          </div>
          {props.metrics && props.metrics.length > 0 && (
            <div style={{ padding: "12px 16px" }}>
              <KA.MetricGrid cols={props.metricCols || Math.min(6, props.metrics.length)}>
                {props.metrics.map((mt, i) => <KA.Metric key={i} {...mt} />)}
              </KA.MetricGrid>
            </div>
          )}
        </Panel>

        {/* —— 主列 + 右侧文书/文件栏 —— */}
        <div style={{ display: "grid", gridTemplateColumns: hasAside ? "minmax(0,1fr) 264px" : "minmax(0,1fr)", gap: 16, alignItems: "start" }}>
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {props.tabs && props.tabs.length > 0 && (
              <KA.SegTab tabs={props.tabs} active={props.activeTab} onChange={props.onTabChange} />
            )}
            {props.children}
          </div>
          {hasAside && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {docs.length > 0 && (
                <Panel padding={14}>
                  <KA.SectionHeader mb={10}>合同文书</KA.SectionHeader>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                    {docs.map((d, i) => chip("file-text", d.name + " · " + (d.pages || 1) + " 页", () => previewDoc(d), i))}
                  </div>
                </Panel>
              )}
              {(files.length > 0 || docs.length > 0) && (
                <Panel padding={14}>
                  <KA.SectionHeader mb={10} extra={Button && <Button size="sm" icon="upload" onClick={() => UI().toast("上传附件（演示）")}>上传</Button>}>附件</KA.SectionHeader>
                  {files.length === 0
                    ? <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>暂无附件</div>
                    : <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                        {files.map((f, i) => chip("paperclip", f.name + (f.size ? " · " + f.size : ""), () => previewDoc(f), i))}
                      </div>}
                </Panel>
              )}
              {props.asideExtra}
            </div>
          )}
        </div>
      </div>
    );
  }

  DetailShell.previewDoc = previewDoc;
  window.DetailShell = DetailShell;
  window.DetailShellPreload = function () { return null; };
})();
