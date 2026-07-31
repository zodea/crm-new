// DeliveryArchiveScreen — 送货单归档库（按实现端 app/components/delivery/DeliveryArchiveScreen.vue 校准）
// 左树两级 项目 → 分供方（分供方按材采合同签订日期升序）+ 每项目 ⚠「未区分分供方」兜底节点 + 节点份数角标。
// 右表标准列表：搜索 / 分页 / 行内 详情·改归属·编辑·删除；底部只报当前筛选份数与金额合计。
// 归档不是终态：行可拖到左树节点改归属（弹二次确认），行内「改归属」按钮是它的键盘可达等价入口；
// 「新建分供方节点」可先建空节点，归档时自动落入。这两项实现端尚未落地，设计稿按目标态保留。
// 窄屏左树收成「归档范围」抽屉（一次只显示一层：先选项目，再选分供方）。
(function () {
  if (window.DeliveryArchiveScreen) return;
  const { Panel, Button, IconButton, Icon, StatusChip } = window.DesignSystem_e3d871 || {};
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), modal: () => {}, undoToast: () => {} };
  const KA = () => window.KitAtoms || {};
  const UN = "un";       // 未区分分供方 sentinel
  const PAGE_SIZE = 10;

  // 左树右表并置的下限：实现端按 60rem 容器宽切分段，设计稿侧栏约 240px，折算视口 1200px。
  const useVw = () => {
    const [vw, setVw] = React.useState(window.innerWidth);
    React.useEffect(() => {
      const onR = () => setVw(window.innerWidth);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }, []);
    return vw;
  };

  const yuan = (v) => "¥" + Number(v || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // 窄屏归档范围抽屉：一次只显示一层，先选项目再选分供方
  function ScopeSheet({ tree, sel, onSelect, labelOf }) {
    const [open, setOpen] = React.useState(false);
    const [proj, setProj] = React.useState(null);
    const row = (on) => ({ display: "flex", width: "100%", minWidth: 0, alignItems: "center", gap: 8, border: 0, borderBottom: "1px solid var(--line)", borderRadius: "var(--radius-btn)", background: on ? "var(--brand-soft)" : "transparent", color: on ? "var(--brand-deep)" : "var(--ink)", padding: "12px 10px", textAlign: "left", fontSize: 13, fontWeight: 600, cursor: "pointer" });
    const count = (n) => <span style={{ flex: "none", borderRadius: 999, background: "var(--surface-3)", padding: "1px 7px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{n}</span>;
    const pick = (k) => { onSelect(k); setOpen(false); };
    return (
      <React.Fragment>
        <button type="button" aria-label="选择归档范围" onClick={() => { setProj(null); setOpen(true); }}
          style={{ display: "flex", width: "100%", minWidth: 0, alignItems: "center", justifyContent: "flex-start", gap: 8, border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", background: "var(--panel)", padding: "7px 10px", fontSize: 13, cursor: "pointer" }}>
          <Icon name="folders" size={13} color="var(--ink-soft)" />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{labelOf(sel)}</span>
          <Icon name="chevron-right" size={13} color="var(--ink-faint)" />
        </button>
        {open && (
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 70, background: "var(--overlay, rgba(16,24,40,0.45))" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", insetBlock: 0, right: 0, width: "min(360px, calc(100vw - 24px))", display: "flex", flexDirection: "column", borderLeft: "1px solid var(--line)", background: "var(--panel)", boxShadow: "var(--shadow-pop)" }}>
              <header style={{ flex: "none", height: 64, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderBottom: "1px solid var(--line)" }}>
                {proj && <IconButton icon="arrow-left" title="返回项目列表" onClick={() => setProj(null)} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj ? proj.label : "选择项目"}</div>
                  <div style={{ marginTop: 2, fontSize: 11, color: "var(--ink-soft)" }}>{proj ? "选择分供方" : "一次只显示一层"}</div>
                </div>
                <IconButton icon="x" title="关闭归档范围" onClick={() => setOpen(false)} />
              </header>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8 }}>
                {!proj && tree.map((t) => t.key === "all"
                  ? <button key={t.key} type="button" style={row(sel === t.key)} onClick={() => pick(t.key)}><Icon name="archive" size={14} color="var(--brand)" /><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>{count(t.count)}</button>
                  : <button key={t.key} type="button" style={row(false)} onClick={() => (t.children.length ? setProj(t) : pick(t.key))}><Icon name="building" size={14} color="var(--ink-faint)" /><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>{count(t.count)}<Icon name="chevron-right" size={13} color="var(--ink-faint)" /></button>)}
                {proj && (
                  <React.Fragment>
                    <button type="button" style={row(sel === proj.key)} onClick={() => pick(proj.key)}><Icon name="users" size={14} color="var(--brand)" /><span style={{ flex: 1, minWidth: 0 }}>全部分供方</span>{count(proj.count)}</button>
                    {proj.children.map((c) => (
                      <button key={c.key} type="button" style={row(sel === c.key)} onClick={() => pick(c.key)}>
                        <Icon name={c.warn ? "triangle-alert" : "hard-hat"} size={14} color={c.warn ? "var(--warn)" : "var(--ink-faint)"} />
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>{count(c.count)}
                      </button>
                    ))}
                  </React.Fragment>
                )}
              </div>
            </div>
          </div>
        )}
      </React.Fragment>
    );
  }

  function DeliveryArchiveScreen() {
    const A = window.APP;
    if (!A || !KA().EntityLink) return null;
    A.use();
    const EL = KA().EntityLink;
    const vw = useVw();
    const narrow = vw < 1200;

    const files = A.rows("deliveryArchives");
    const [sel, setSel] = React.useState("all");
    const [search, setSearch] = React.useState("");
    const [page, setPage] = React.useState(1);
    const [extraNodes, setExtraNodes] = React.useState([]); // 手动新建的空分供方节点 [{projectId,supplierId}]

    const projects = A.rows("projects");
    const suppliers = A.rows("suppliers");
    const contracts = A.rows("contracts");
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : "未知项目"; };
    const supName = (id) => { if (!id) return "未区分分供方"; const s = A.get("suppliers", id); return s ? s.name : "未知分供方"; };

    // 分供方在某项目下的材采合同签订日期（升序排序键；无合同 → 排最后）
    const signKey = (pid, sid) => contracts
      .filter((c) => c.projectId === pid && c.supplierId === sid && c.signDate)
      .map((c) => c.signDate).sort()[0] || "￿";

    // —— 左树：全部送货单 + 项目（有归档件的才出现）→ 分供方 ——
    // extraNodes：手动新建、还没有归档件的空分供方节点（归档时自动落入）
    const tree = [{ key: "all", label: "全部送货单", icon: "archive", count: files.length }].concat(
      projects.map((p) => {
        const rows = files.filter((f) => f.projectId === p.id);
        const sids = [];
        rows.forEach((f) => { const k = f.supplierId || null; if (sids.indexOf(k) < 0) sids.push(k); });
        extraNodes.filter((n) => n.projectId === p.id).forEach((n) => { if (sids.indexOf(n.supplierId) < 0) sids.push(n.supplierId); });
        sids.sort((a, b) => (a == null ? 1 : b == null ? -1 : (signKey(p.id, a) < signKey(p.id, b) ? -1 : signKey(p.id, a) > signKey(p.id, b) ? 1 : supName(a).localeCompare(supName(b), "zh-CN"))));
        return {
          key: "project:" + p.id, label: p.name, icon: "building", count: rows.length,
          children: sids.map((sid) => ({
            key: "supplier:" + p.id + ":" + (sid || UN), label: supName(sid),
            icon: sid ? "hard-hat" : "triangle-alert", tone: sid ? undefined : "warn", warn: !sid,
            count: rows.filter((f) => (f.supplierId || null) === sid).length,
          })),
        };
      }).filter((n) => n.count > 0 || extraNodes.some((x) => x.projectId === n.key.slice(8))));

    const labelOf = (key) => {
      for (const t of tree) {
        if (t.key === key) return t.label;
        const c = (t.children || []).find((x) => x.key === key);
        if (c) return t.label + " · " + c.label;
      }
      return "全部送货单";
    };

    const nodeRows = sel === "all" ? files
      : sel.indexOf("project:") === 0 ? files.filter((f) => f.projectId === sel.slice(8))
      : (() => { const [, pid, sid] = sel.split(":"); return files.filter((f) => f.projectId === pid && (sid === UN ? !f.supplierId : f.supplierId === sid)); })();

    const kw = search.trim().toLowerCase();
    const filtered = kw
      ? nodeRows.filter((f) => [f.no, f.note, projName(f.projectId), supName(f.supplierId), f.material].some((v) => v && String(v).toLowerCase().indexOf(kw) > -1))
      : nodeRows;
    React.useEffect(() => setPage(1), [sel, search]);

    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const cur = Math.min(page, pageCount);
    const rows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
    const totalAmount = filtered.reduce((s, f) => s + (Number(f.amount) || 0), 0);

    // —— 改归属：归档不是终态，留改错通道；拖拽与「改归属」按钮走同一条确认路径 ——
    // （拖拽是纯鼠标操作，行内按钮是它的键盘可达等价入口，不是第二套逻辑）
    const reassign = (fileId, pid, sid) => {
      const f = files.find((x) => x.id === fileId);
      if (!f) return;
      const nextSid = sid === UN ? null : sid;
      if (f.projectId === pid && (f.supplierId || null) === nextSid) return;
      UI().confirm({
        title: "改归属确认", confirmText: "确认改归属",
        message: "将「" + (f.no && f.no !== "—" ? f.no : f.name || f.id) + "」改归属到\n项目：" + projName(pid)
          + "\n分供方：" + (nextSid ? supName(nextSid) : "未区分分供方") + "\n\n此修改即时生效。",
        onConfirm: () => {
          A.update("deliveryArchives", fileId, { projectId: pid, supplierId: nextSid });
          UI().toast("已改归属到「" + projName(pid) + " · " + (nextSid ? supName(nextSid) : "未区分分供方") + "」", "ok");
          setSel(nextSid ? "supplier:" + pid + ":" + nextSid : "project:" + pid);
        },
      });
    };
    // 树节点 drop：项目节点 → 只改项目；分供方节点 → 项目 + 分供方一起改
    const onNodeDrop = (nodeKey, fileId) => {
      if (nodeKey === "all") return;
      if (nodeKey.indexOf("project:") === 0) {
        const f = files.find((x) => x.id === fileId);
        reassign(fileId, nodeKey.slice(8), f ? (f.supplierId || UN) : UN);
        return;
      }
      const [, pid, sid] = nodeKey.split(":");
      reassign(fileId, pid, sid);
    };
    const editAttr = (f) => UI().formModal({
      title: "改归属 · " + (f.no && f.no !== "—" ? f.no : f.name || f.id), cols: 2, width: 560, saveText: "改归属",
      fields: [
        { key: "project", label: "项目", type: "select", options: projects.map((p) => p.name), value: projName(f.projectId), full: true },
        { key: "supplier", label: "分供方", type: "select", options: ["（未区分分供方）"].concat(suppliers.map((s) => s.name)), value: f.supplierId ? supName(f.supplierId) : "（未区分分供方）", full: true },
      ],
      onSave: (v) => {
        const pid = (projects.find((p) => p.name === v.project) || {}).id || f.projectId;
        const sid = v.supplier === "（未区分分供方）" ? UN : ((suppliers.find((s) => s.name === v.supplier) || {}).id || UN);
        reassign(f.id, pid, sid);
      },
    });
    // 手动新建空分供方节点（从分供方库选）：归档时自动落入，不必先有文件
    const addNode = () => {
      const pid = sel.indexOf("project:") === 0 ? sel.slice(8) : sel.indexOf("supplier:") === 0 ? sel.split(":")[1] : (projects[0] || {}).id;
      if (!pid) { UI().toast("请先选中一个项目节点", "danger"); return; }
      UI().formModal({
        title: "新建分供方节点 · " + projName(pid), saveText: "新建节点",
        fields: [{ key: "supplier", label: "从分供方库选择", type: "select", options: suppliers.map((s) => s.name), full: true }],
        onSave: (v) => {
          const s = suppliers.find((x) => x.name === v.supplier);
          if (!s) { UI().toast("请选择分供方", "danger"); return; }
          setExtraNodes((n) => [...n, { projectId: pid, supplierId: s.id }]);
          setSel("supplier:" + pid + ":" + s.id);
          UI().toast("已在「" + projName(pid) + "」下新建节点「" + s.name + "」，归档时自动落入", "ok");
        },
      });
    };

    const openForm = (id) => window.DC && window.DC.navigate("deliveryArchiveForm", id ? { id } : {});
    const del = (f) => UI().confirm({
      title: "删除送货单", confirmText: "删除", danger: true,
      message: "确认删除送货单「" + (f.no && f.no !== "—" ? f.no : f.name || f.id) + "」？材料明细会随送货单一同隐藏，10 秒内可撤回。",
      onConfirm: () => {
        A.softDel("deliveryArchives", f.id);
        UI().undoToast("已删除送货单「" + (f.no && f.no !== "—" ? f.no : f.name || f.id) + "」", () => A.restore("deliveryArchives", f.id));
      },
    });
    // 设计稿外壳没有独立的归档详情路由，详情用只读弹层承载（编辑仍走整页表单 deliveryArchiveForm）
    const detail = (f) => UI().modal({
      title: "送货单 " + (f.no && f.no !== "—" ? f.no : "（未编号）"), subtitle: projName(f.projectId) + " · " + supName(f.supplierId), width: 520,
      bodyHTML: '<div style="font-size:13px;line-height:2">'
        + '<div><span style="color:var(--ink-soft)">送货日期：</span><span style="font-family:var(--font-mono)">' + f.date + "</span></div>"
        + '<div><span style="color:var(--ink-soft)">材料明细：</span>' + f.material + "</div>"
        + '<div><span style="color:var(--ink-soft)">金额：</span><b style="font-family:var(--font-mono)">' + yuan(f.amount) + "</b></div>"
        + '<div><span style="color:var(--ink-soft)">原件：</span>' + (f.name ? f.name : "缺原件（手工补录）") + "</div>"
        + '<div><span style="color:var(--ink-soft)">备注：</span>' + (f.note || "—") + "</div></div>",
    });

    const TH = { padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap" };
    const TD = { padding: "10px 12px", fontSize: 13, verticalAlign: "middle" };
    const pagerBtn = (off) => ({ minWidth: 30, height: 28, border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", background: "var(--panel)", color: off ? "var(--ink-faint)" : "var(--ink-soft)", fontSize: 12, cursor: off ? "not-allowed" : "pointer" });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {/* 工具栏 */}
        <Panel padding={0} style={{ display: "flex", alignItems: narrow ? "flex-start" : "center", flexDirection: narrow ? "column" : "row", gap: 12, padding: "12px 16px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>送货单归档库</div>
            <div style={{ marginTop: 2, fontSize: 12, color: "var(--ink-faint)" }}>手工录入 · 项目 → 分供方 · 详情与材料明细</div>
          </div>
          <div style={{ marginLeft: narrow ? 0 : "auto", width: narrow ? "100%" : "auto", display: "flex", minWidth: 0, flexWrap: "wrap", alignItems: "center", justifyContent: narrow ? "flex-start" : "flex-end", gap: 12 }}>
            {KA().SearchInput && KA().SearchInput({ value: search, onChange: setSearch, placeholder: "搜索单号、项目、分供方、材料", width: narrow ? "100%" : 288 })}
            <Button icon="refresh-cw" onClick={() => UI().toast("已刷新")}>刷新</Button>
            <Button variant="primary" icon="plus" onClick={() => openForm(null)}>新增送货单</Button>
          </div>
        </Panel>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0, flexDirection: narrow ? "column" : "row" }}>
          {narrow
            ? <div style={{ width: "100%" }}><ScopeSheet tree={tree} sel={sel} onSelect={setSel} labelOf={labelOf} /></div>
            : <div style={{ width: 256, flex: "none" }}>{KA().TreeNav && KA().TreeNav({
                title: "归档库 · 项目 → 分供方", items: tree, active: sel, onChange: setSel, onNodeDrop,
                footer: <Button size="sm" icon="folder-plus" onClick={addNode} style={{ width: "100%" }}>新建分供方节点</Button>,
              })}</div>}

          <div style={{ minWidth: 0, flex: 1, width: narrow ? "100%" : "auto" }}>
            <Panel padding={0} style={{ overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 1180, borderCollapse: "collapse" }}>
                  <thead style={{ background: "var(--surface-2)" }}>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      <th style={{ ...TH, width: 48 }}>#</th>
                      <th style={{ ...TH, minWidth: 160 }}>送货单号</th>
                      <th style={{ ...TH, width: 112 }}>送货日期</th>
                      <th style={{ ...TH, width: 96, textAlign: "center" }}>原件</th>
                      <th style={{ ...TH, minWidth: 150 }}>所属项目</th>
                      <th style={{ ...TH, minWidth: 200 }}>分供方</th>
                      <th style={{ ...TH, minWidth: 220 }}>材料明细</th>
                      <th style={{ ...TH, width: 130, textAlign: "right" }}>金额</th>
                      <th style={{ ...TH, minWidth: 160 }}>备注</th>
                      <th style={{ ...TH, width: 158, textAlign: "center" }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f, i) => (
                      <tr key={f.id} draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", f.id); e.dataTransfer.effectAllowed = "move"; }}
                        style={{ borderBottom: "1px solid var(--line)", cursor: "grab" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                        <td style={{ ...TD, color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Icon name="grip-vertical" size={12} color="var(--ink-faint)" />{(cur - 1) * PAGE_SIZE + i + 1}
                          </span>
                        </td>
                        <td style={TD}><button onClick={() => detail(f)} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 600, fontFamily: "var(--font-mono)", cursor: "pointer" }}>{f.no && f.no !== "—" ? f.no : "未编号送货单"}</button></td>
                        <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{f.date}</td>
                        <td style={{ ...TD, textAlign: "center" }}>{f.name ? <StatusChip tone="ok">可核对</StatusChip> : <StatusChip tone="danger">缺原件</StatusChip>}</td>
                        <td style={TD}><EL type="project" id={f.projectId} /></td>
                        {/* 分供方列显全称（与左树节点、实现端 supplierName 同口径），不退化成 EntityLink 默认的简称 */}
                        <td style={TD}>{f.supplierId ? <EL type="supplier" id={f.supplierId} label={supName(f.supplierId)} /> : <StatusChip tone="warn">未区分分供方</StatusChip>}</td>
                        <td style={{ ...TD, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.material}>{f.material}</td>
                        <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{yuan(f.amount)}</td>
                        <td style={{ ...TD, color: "var(--ink-soft)" }}>{f.note || "—"}</td>
                        <td style={{ ...TD, textAlign: "center" }}>
                          <span style={{ display: "inline-flex", gap: 4 }}>
                            <IconButton icon="file-text" title="详情" onClick={() => detail(f)} />
                            <IconButton icon="folder-input" title="改归属" onClick={() => editAttr(f)} />
                            <IconButton icon="square-pen" title="编辑" onClick={() => openForm(f.id)} />
                            <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => del(f)} />
                          </span>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={10} style={{ ...TD, padding: 32, textAlign: "center", color: "var(--ink-soft)" }}>当前节点暂无送货单</td></tr>}
                  </tbody>
                </table>
              </div>
              {filtered.length > PAGE_SIZE && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)" }}>
                  <button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)} style={pagerBtn(cur <= 1)}>‹</button>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{cur} / {pageCount}</span>
                  <button type="button" disabled={cur >= pageCount} onClick={() => setPage(cur + 1)} style={pagerBtn(cur >= pageCount)}>›</button>
                </div>
              )}
            </Panel>

            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "8px 24px", borderRadius: "var(--radius-card)", background: "var(--surface-2)", padding: "8px 16px", fontSize: 12, color: "var(--ink-soft)" }}>
              <span>当前筛选：<b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{filtered.length}</b> 份</span>
              <span>金额合计：<b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{yuan(totalAmount)}</b></span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  window.DeliveryArchiveScreen = DeliveryArchiveScreen;
})();
