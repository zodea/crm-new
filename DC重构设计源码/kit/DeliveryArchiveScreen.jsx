// DeliveryArchiveScreen — 送货单归档库（批D §3，原 P3；乙供材管理组，route=deliveryArchive）。
// 与「送货单识别」（DeliveryScreen 处理区）双区拆分：处理区放待识别/待核对，归档库放核对完成后归档件。
// 左树两级 项目→分供方（分供方按合同签订日期升序）+ 每项目 ⚠「未区分分供方」兜底节点 + 节点文件数量角标（只数量不金额）。
// 归档不是终态：文件可拖拽改归属 / 「改归属」按钮，任何修改弹二次确认（CONTEXT「归档」）；未区分分供方给分供方库模糊纠错一键替换。
(function () {
  if (window.DeliveryArchiveScreen) return;
  const { Panel, Button, IconButton, Icon, StatusChip } = window.DesignSystem_e3d871 || {};
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), formModal: () => {}, undoToast: () => {} };
  const UN = "un";  // 未区分分供方 sentinel

  function DeliveryArchiveScreen({ data }) {
    const A = window.APP;
    const KA = window.KitAtoms || {};
    if (!A || !KA.EntityLink) return null;
    A.use();

    const [files, setFiles] = React.useState(() => (data.deliveryArchives || []).slice());
    const [sel, setSel] = React.useState("p1");
    const [dropHot, setDropHot] = React.useState(null);   // 拖拽悬停高亮节点
    const [extraNodes, setExtraNodes] = React.useState([]); // 手动新建的空分供方节点 [{projectId,supplierId}]

    const projects = A.rows("projects");
    const suppliers = A.rows("suppliers");
    const contracts = A.rows("contracts");
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : id; };
    const supName = (id) => { const s = A.get("suppliers", id); return s ? ((s.aliases && s.aliases[0]) || s.name) : id; };
    const supFull = (id) => { const s = A.get("suppliers", id); return s ? s.name : id; };

    // 分供方在某项目下的合同签订日期（升序排序键；无合同 → 排最后）
    const signKey = (pid, sid) => {
      const list = contracts.filter((c) => c.projectId === pid && c.supplierId === sid && c.signDate);
      if (!list.length) return "9999-99-99";
      return list.reduce((m, c) => (c.signDate < m ? c.signDate : m), list[0].signDate);
    };

    // —— 建树：项目 → 分供方(按合同签订日期升序) + ⚠未区分分供方兜底 ——
    const byProj = {};
    files.forEach((f) => {
      const g = (byProj[f.projectId] = byProj[f.projectId] || {});
      const k = f.supplierId || UN;
      (g[k] = g[k] || []).push(f);
    });
    extraNodes.forEach((n) => { const g = (byProj[n.projectId] = byProj[n.projectId] || {}); g[n.supplierId] = g[n.supplierId] || []; });
    const projIds = projects.map((p) => p.id).filter((pid) => byProj[pid]);
    const tree = projIds.map((pid) => {
      const g = byProj[pid];
      const supKeys = Object.keys(g).filter((k) => k !== UN).sort((a, b) => (signKey(pid, a) < signKey(pid, b) ? -1 : 1));
      const children = supKeys.map((sk) => ({ key: pid + "__" + sk, sid: sk, label: supName(sk), count: g[sk].length, sign: signKey(pid, sk) }));
      if (g[UN]) children.push({ key: pid + "__" + UN, sid: UN, label: "⚠ 未区分分供方", count: g[UN].length, warn: true });
      return { key: pid, pid, label: projName(pid), count: Object.values(g).reduce((s, a) => s + a.length, 0), children };
    });

    // —— 选中节点 → 文件列表 ——
    const parse = (key) => (key.indexOf("__") > -1 ? { pid: key.split("__")[0], sid: key.split("__")[1] } : { pid: key, sid: null });
    const cur = parse(sel);
    const shown = files.filter((f) => {
      if (f.projectId !== cur.pid) return false;
      if (cur.sid == null) return true;                       // 项目根：全部
      if (cur.sid === UN) return !f.supplierId;               // 未区分
      return f.supplierId === cur.sid;
    });

    // —— 改归属（拖拽 / 按钮）：二次确认 ——
    const reassign = (fileId, pid, sid) => {
      const f = files.find((x) => x.id === fileId);
      if (!f) return;
      const toSup = sid === UN || sid == null ? "未区分分供方" : supFull(sid);
      if (f.projectId === pid && (f.supplierId || null) === (sid === UN ? null : sid)) return;
      UI().confirm({
        title: "改归属确认", confirmText: "确认改归属",
        message: "将「" + f.name + "」改归属到\n项目：" + projName(pid) + "\n分供方：" + toSup + "\n\n归档库为可改错通道，此修改会即时生效。",
        onConfirm: () => {
          setFiles((l) => l.map((x) => (x.id === fileId ? { ...x, projectId: pid, supplierId: sid === UN ? null : sid } : x)));
          UI().toast("已改归属到「" + projName(pid) + " · " + toSup + "」", "ok");
          setSel(pid + (sid == null ? "" : "__" + sid));
        },
      });
    };
    const editAttr = (f) => UI().formModal({
      title: "改归属 · " + f.name, cols: 2, width: 560,
      fields: [
        { key: "projectId", label: "项目", type: "select", options: projects.map((p) => p.name), value: projName(f.projectId), full: true },
        { key: "supplierId", label: "分供方", type: "select", options: ["（未区分分供方）"].concat(suppliers.map((s) => s.name)), value: f.supplierId ? supFull(f.supplierId) : "（未区分分供方）", full: true },
      ],
      saveText: "改归属",
      onSave: (v) => {
        const pid = (projects.find((p) => p.name === v.projectId) || {}).id || f.projectId;
        const sid = v.supplierId === "（未区分分供方）" ? UN : ((suppliers.find((s) => s.name === v.supplierId) || {}).id || UN);
        reassign(f.id, pid, sid);
      },
    });

    // —— 分供方名模糊纠错：OCR 名在分供方库模糊匹配 → 建议 + 一键替换（二次确认） ——
    const fuzzy = (ocrName) => {
      if (!ocrName) return null;
      return suppliers.find((s) => (s.aliases || []).some((a) => ocrName.includes(a) || a.includes(ocrName.slice(0, 3)))
        || ocrName.includes(s.name.slice(0, 4)) || s.name.includes(ocrName.slice(0, 4))) || null;
    };

    // —— 手动新建分供方节点（从分供方库选） ——
    const addNode = () => UI().formModal({
      title: "新建分供方节点 · " + projName(cur.pid),
      fields: [{ key: "sid", label: "从分供方库选择", type: "select", options: suppliers.map((s) => s.name), full: true }],
      saveText: "新建节点",
      onSave: (v) => {
        const s = suppliers.find((x) => x.name === v.sid);
        if (!s) { UI().toast("请选择分供方", "danger"); return; }
        setExtraNodes((n) => [...n, { projectId: cur.pid, supplierId: s.id }]);
        setSel(cur.pid + "__" + s.id);
        UI().toast("已在「" + projName(cur.pid) + "」下新建节点「" + s.name + "」（归档时自动落入）", "ok");
      },
    });

    // —— 树节点渲染（自带拖放目标） ——
    const nodeStyle = (on, warn, hot, sub) => ({
      display: "flex", alignItems: "center", gap: 8, width: "100%", border: hot ? "1px dashed var(--brand)" : "1px solid transparent",
      borderRadius: 8, padding: sub ? "6px 10px" : "8px 10px", cursor: "pointer", textAlign: "left", marginBottom: 2,
      background: on ? "var(--brand-soft)" : hot ? "var(--brand-soft)" : "transparent",
    });
    const treeNode = (t, sub, dropTarget) => {
      const on = sel === t.key;
      const ink = t.warn && !on ? "var(--warn-ink)" : on ? "var(--brand-deep)" : "var(--ink)";
      return (
        <button key={t.key} onClick={() => setSel(t.key)}
          onDragOver={(e) => { e.preventDefault(); setDropHot(t.key); }}
          onDragLeave={() => setDropHot((h) => (h === t.key ? null : h))}
          onDrop={(e) => { e.preventDefault(); setDropHot(null); const id = e.dataTransfer.getData("text/plain"); if (id) reassign(id, dropTarget.pid, dropTarget.sid); }}
          style={nodeStyle(on, t.warn, dropHot === t.key, sub)}>
          {Icon && <Icon name={t.warn ? "triangle-alert" : sub ? "hard-hat" : "building"} size={sub ? 12 : 14} color={on ? "var(--brand)" : t.warn ? "var(--warn)" : "var(--ink-faint)"} />}
          <span style={{ flex: 1, fontSize: sub ? 12.5 : 13, fontWeight: on ? 800 : sub ? 500 : 700, color: ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: on ? "var(--brand)" : "var(--ink-faint)", background: on ? "#fff" : "var(--surface-3)", borderRadius: 999, padding: "1px 7px" }}>{t.count}</span>
        </button>
      );
    };

    return (
      <div style={{ display: "grid", gridTemplateColumns: "252px minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        {/* 左树 */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", display: "flex", alignItems: "center" }}>
            归档库 · 项目 → 分供方
            <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{files.length}</span>
          </div>
          <div style={{ padding: 6, maxHeight: 560, overflow: "auto" }}>
            {tree.map((p) => (
              <div key={p.key}>
                {treeNode(p, false, { pid: p.pid, sid: null })}
                <div style={{ paddingLeft: 14 }}>
                  {p.children.map((c) => treeNode(c, true, { pid: p.pid, sid: c.sid }))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: "8px 10px", borderTop: "1px solid var(--line)" }}>
            <Button size="sm" icon="folder-plus" onClick={addNode} style={{ width: "100%" }}>新建分供方节点</Button>
          </div>
        </Panel>

        {/* 右列表 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 800 }}>
              {cur.sid == null ? <KA.EntityLink type="project" id={cur.pid} /> : <span><KA.EntityLink type="project" id={cur.pid} />{" · "}{cur.sid === UN ? <span style={{ color: "var(--warn-ink)" }}>未区分分供方</span> : <KA.EntityLink type="supplier" id={cur.sid} />}</span>}
              <span style={{ marginLeft: 6, color: "var(--ink-soft)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>（{shown.length}）</span>
            </span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-soft)" }}>拖拽文件到左树节点即可改归属（弹二次确认）</span>
          </div>

          <Panel padding={0} style={{ overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) 110px 96px minmax(0,2fr) 120px 130px", gap: 0, padding: "9px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 11.5, fontWeight: 700, color: "var(--ink-soft)" }}>
              <span>文件 / OCR 识别公司名</span><span>单号</span><span>日期</span><span>材料明细</span><span style={{ textAlign: "right" }}>金额</span><span style={{ textAlign: "center" }}>操作</span>
            </div>
            {shown.length === 0 && <div style={{ padding: "28px 0", textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>该节点暂无归档文件</div>}
            {shown.map((f) => {
              const misMatch = !f.supplierId;
              const sug = misMatch ? fuzzy(f.ocrCompany) : null;
              return (
                <div key={f.id} draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", f.id); e.dataTransfer.effectAllowed = "move"; }}
                  style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) 110px 96px minmax(0,2fr) 120px 130px", gap: 0, padding: "10px 14px", borderBottom: "1px solid var(--line)", alignItems: "center", cursor: "grab" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Icon name="grip-vertical" size={13} color="var(--ink-faint)" />
                      <span style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: misMatch ? "var(--warn-ink)" : "var(--ink-soft)", paddingLeft: 19, marginTop: 2 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>OCR：{f.ocrCompany}</span>
                    </div>
                    {sug && (
                      <div style={{ paddingLeft: 19, marginTop: 4 }}>
                        <button onClick={() => UI().confirm({ title: "分供方模糊匹配", confirmText: "替换归并",
                          message: "OCR 识别名「" + f.ocrCompany + "」\n模糊匹配到分供方库：" + sug.name + "\n\n替换后该文件归入此分供方节点。",
                          onConfirm: () => { setFiles((l) => l.map((x) => (x.id === f.id ? { ...x, supplierId: sug.id } : x))); UI().toast("已归并到「" + sug.name + "」", "ok"); } })}
                          style={{ border: "1px solid var(--brand)", background: "var(--brand-soft)", color: "var(--brand-deep)", borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Icon name="wand-sparkles" size={11} color="var(--brand)" />建议归并到「{(sug.aliases && sug.aliases[0]) || sug.name}」
                        </button>
                      </div>
                    )}
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{f.no}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{f.date}</span>
                  <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.material}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 700, textAlign: "right" }}>¥{Number(f.amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span style={{ display: "inline-flex", gap: 4, justifyContent: "center" }}>
                    <IconButton icon="folder-input" title="改归属" onClick={() => editAttr(f)} />
                    <IconButton icon="zoom-in" title="预览原件" onClick={() => UI().modal && UI().modal({ title: f.name, subtitle: f.ocrCompany, width: 520, bodyHTML: '<div style="height:280px;display:grid;place-items:center;background:var(--surface-2);border-radius:8px;color:var(--brand);font-size:40px;font-weight:800;opacity:.5">单</div>' })} />
                  </span>
                </div>
              );
            })}
            <div style={{ padding: "9px 14px", background: "var(--surface-2)", fontSize: 12.5, color: "var(--ink-soft)", display: "flex", gap: 22 }}>
              <span>本节点文件：<b style={{ fontFamily: "var(--font-mono)" }}>{shown.length}</b> 份</span>
              <span>金额合计：<b style={{ fontFamily: "var(--font-mono)" }}>¥{shown.reduce((s, f) => s + (Number(f.amount) || 0), 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></span>
            </div>
          </Panel>

          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-soft)" }}>
            <Icon name="info" size={13} color="var(--brand)" />
            归档规则：核对完成即自动归档，核对是归档唯一前置；未指定项目禁止导入。归档不是终态，改归属/字段一律弹二次确认（留改错通道）。
          </div>
        </div>
      </div>
    );
  }

  window.DeliveryArchiveScreen = DeliveryArchiveScreen;
})();
