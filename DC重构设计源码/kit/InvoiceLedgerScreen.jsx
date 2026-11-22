// InvoiceLedgerScreen — 发票台账页（版式与列按实现端 app/pages/finance/_components/InvoiceLedgerScreen.vue 校准）
// 左树（按归属，只带张数角标）+ 右表 表格/卡片/打印三呈现 + 勾选浮出合计（平时无常驻金额汇总）+ 行软删撤回。
// 口径：台账 = 已归档；「待归档」= 已校对未归档的过渡态（两态模型下归档必有归属，不存在「已归档但未归项目」）。
// 打印 / 导出 / 导入是 #70 的待实现能力，实现端尚未落地——设计稿按目标态保留，不跟着实现端删。
(function () {
  const { Button, StatusChip, IconButton, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), formModal: () => {} };
  const I = () => window.INV;
  const KA = () => window.KitAtoms || {};

  // 视口宽度：左树右表并置取实现端 md:(768)，卡片视图列数取 sm:(640) / lg:(1024)。
  const useVw = () => {
    const [vw, setVw] = React.useState(window.innerWidth);
    React.useEffect(() => {
      const onR = () => setVw(window.innerWidth);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }, []);
    return vw;
  };

  // —— 名称→蓝链（批B 全站蓝链）：发票行存的是名称字符串不是 id，按名称反查共享 store
  // （项目按 name 全等；分供方按 name 全等或 aliases 含）。查不到实体 → 保持原文本，绝不做死链。
  const findIdByName = (coll, name) => {
    const A = window.APP;
    if (!name || !A) return null;
    const hit = A.rows(coll).find((x) => x.name === name || (coll === "suppliers" && (x.aliases || []).indexOf(name) >= 0));
    return hit ? hit.id : null;
  };
  const NameLink = ({ type, coll, name, fallback = null }) => {
    const EL = KA().EntityLink;
    const id = findIdByName(coll, name);
    if (!EL || !id) return fallback != null ? fallback : (name || null);
    return <EL type={type} id={id} label={name} />;
  };

  const TH = { padding: "12px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap" };
  const TD = { padding: "12px 14px", fontSize: 13, verticalAlign: "middle" };
  const FILTERABLE = ["供应商", "类型", "来源"]; // 与实现端 KitTable 列 filterable 一致
  const EXP_STRUCT = ["按归属", "按供应商", "按票据类型", "按开票月份"];
  const EXP_NAME = [{ label: "发票号后8位", sample: "58760021" }, { label: "供应商简称", sample: "大板东建材" }, { label: "开票日期", sample: "2026-06-28" }, { label: "归属名称", sample: "车陂商业大楼" }];

  function InvoiceLedgerScreen({ navigate }) {
    if (!I()) return <Panel style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>加载中…</Panel>;
    const INV = I();
    const vw = useVw();
    const narrow = vw < 768;
    const cardCols = vw < 640 ? 1 : vw < 1024 ? 2 : 3;
    const store = INV.useStore();
    const [node, setNode] = React.useState("__all");  // __all / 项目名 / __own / __pending
    const [view, setView] = React.useState("table");  // table | card | print
    const [search, setSearch] = React.useState("");
    const [checked, setChecked] = React.useState({});
    const [expOpen, setExpOpen] = React.useState(false);

    const posted = store.live.filter((i) => i.account === "posted");
    const groups = {
      project: posted.filter((i) => INV.ownerKindOf(i) === "project"),
      personal: posted.filter((i) => INV.ownerKindOf(i) === "personal"),
      pending: store.live.filter((i) => i.reviewed && i.account !== "posted"),
    };
    const all = groups.project.concat(groups.personal, groups.pending);

    const projNames = [];
    groups.project.forEach((i) => { const k = i.project || "未命名项目"; if (projNames.indexOf(k) < 0) projNames.push(k); });

    const tree = [
      { key: "__all", label: "全部", icon: "layers", count: all.length },
      ...projNames.map((n) => ({ key: n, label: n, icon: "folder", count: groups.project.filter((i) => (i.project || "未命名项目") === n).length })),
      { key: "__own", label: "个人开支", icon: "user", count: groups.personal.length, tone: "brand" },
      { key: "__pending", label: "待归档", icon: "triangle-alert", count: groups.pending.length, tone: "warn" },
    ];

    const nodeRows = node === "__own" ? groups.personal
      : node === "__pending" ? groups.pending
      : node === "__all" ? all
      : groups.project.filter((i) => (i.project || "未命名项目") === node);
    const kw = search.trim().toLowerCase();
    const rows = kw
      ? nodeRows.filter((i) => [i.number, i.seller, i.buyer, i.project, i.remark].some((v) => v && v.toLowerCase().indexOf(kw) > -1))
      : nodeRows;

    const checkedRows = rows.filter((i) => checked[i.id]);
    const checkedTotal = checkedRows.reduce((s, i) => s + Number(i.total || 0), 0);
    const openEdit = (inv) => navigate("invoiceEdit", { id: inv.id });
    const tail8 = (n) => (n ? n.slice(-8) : "—");
    const del = (inv) => UI().confirm({
      title: "删除发票", confirmText: "删除", danger: true,
      message: "确认删除发票「" + tail8(inv.number) + "」？删除后可在 10 秒内撤回。",
      onConfirm: () => { setChecked((c) => ({ ...c, [inv.id]: false })); INV.softDel(inv); },
    });

    // 归档：弹归属选择（缺归属 / 项目归属未选具体项目均拒绝）
    const archive = (inv) => UI().formModal({
      title: "归档发票", subtitle: "归档后计入台账统计", saveText: "归档", width: 480,
      fields: [
        { key: "kind", label: "归属", type: "select", options: ["归属项目", "个人开支"], value: "归属项目", full: true },
        { key: "project", label: "对应项目（归属项目时必选）", type: "select", options: INV.projectsList(), value: inv.project || "", full: true },
      ],
      onSave: (v) => {
        if (v.kind === "个人开支") { INV.update(inv.id, { ownerKind: "personal", project: "", account: "posted" }); UI().toast("已归档，计入台账", "ok"); return; }
        if (!v.project) { UI().toast("缺归属：归属项目须选择具体项目", "danger"); return; }
        INV.update(inv.id, { ownerKind: "project", project: v.project, account: "posted" });
        UI().toast("已归档，计入台账", "ok");
      },
    });

    // —— 打印 / 导出 / 导入（#70）——
    // 导出目标：有勾选就只导勾选的，没勾选导当前节点的全部。
    const exportTarget = () => (checkedRows.length ? checkedRows : rows);
    const doExport = (kind, anchor) => {
      const target = exportTarget();
      if (kind === "打印 PDF") { setView("print"); return; }
      if (kind === "导出原件") {
        const scans = target.filter((i) => i.source !== "excel");
        UI().exportModal({
          title: "导出原件", subtitle: "共 " + scans.length + " 张 · 原始扫描件按文件夹组织",
          count: scans.length, unit: "张", ext: ".pdf", anchor,
          structureOptions: EXP_STRUCT, nameOptions: EXP_NAME,
        });
        return;
      }
      UI().exportModal({
        title: "导出 Excel 台账", subtitle: "共 " + target.length + " 条结构化数据",
        count: target.length, unit: "条", ext: ".xlsx", anchor,
        structureOptions: ["不分层", "按归属", "按开票月份"],
        nameOptions: [{ label: "发票台账", sample: "发票台账" }, { label: "导出日期", sample: "2026-07-03" }],
      });
    };
    // 导入走导入映射页签（ADR 0005，不再是废弃的 importModal）；
    // 发票域叠加的行级拒绝规则：映射必含归属，缺归属的行整行拒绝并列清单，其余照常入台账。
    const doImport = () => navigate("importMapping", { entity: "invoice" });

    // 归属列：个人开支 / 项目蓝链 / 待归档
    const ownerCell = (inv) => INV.ownerKindOf(inv) === "personal"
      ? <span style={{ color: "var(--brand-deep)" }}>个人开支</span>
      : inv.project
        ? <NameLink type="project" coll="projects" name={inv.project} fallback={<span style={{ color: "var(--ink-soft)" }}>{inv.project}</span>} />
        : <StatusChip tone="warn">待归档</StatusChip>;

    // 打印呈现（#70）：整页切到打印排版，左列表快速跳对应 A4 页，「返回台账」回列表。
    // 打印范围 = 有勾选就打勾选的，没勾选打当前节点全部。
    if (view === "print") {
      return (
        <INV.PrintLayout
          rows={exportTarget()}
          selId={null}
          onSelect={() => {}}
          onPrint={(i) => INV.update(i.id, { printCount: (i.printCount || 0) + 1, lastPrintedAt: "2026-07-03" })}
          onBack={() => setView("table")}
          backLabel="返回台账"
        />
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* 工具栏 */}
        <Panel padding={14} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flex: "none" }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>发票台账</h2>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              共 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{all.length}</b> 张
              {rows.length !== all.length && " · 当前 " + rows.length + " 张"}
            </span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {KA().SearchInput && KA().SearchInput({ value: search, onChange: setSearch, placeholder: "搜索编号、供应商、归属…", width: 230 })}
            <div style={{ display: "inline-flex", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", overflow: "hidden", background: "var(--panel)" }}>
              {[["table", "table", "表格"], ["card", "layout-grid", "卡片"]].map(([k, ic, lbl]) => (
                <button key={k} type="button" aria-pressed={view === k} onClick={() => { setView(k); setChecked({}); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, minHeight: 32, border: 0, padding: "6px 10px", fontSize: 12, fontWeight: view === k ? 800 : 600, cursor: "pointer", background: view === k ? "var(--brand-soft)" : "var(--panel)", color: view === k ? "var(--brand-deep)" : "var(--ink-soft)" }}>
                  <Icon name={ic} size={13} />{lbl}
                </button>
              ))}
            </div>
            <Button icon="printer" onClick={() => setView("print")}>打印</Button>
            <div style={{ position: "relative" }}>
              <Button icon="download" iconRight="chevron-down" onClick={() => setExpOpen(!expOpen)}>导出</Button>
              {expOpen && (
                <div onClick={() => setExpOpen(false)} style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, minWidth: 150, background: "var(--panel)", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", boxShadow: "var(--shadow-pop)", padding: 4, zIndex: 20 }}>
                  {["打印 PDF", "导出原件", "导出 Excel"].map((t) => (
                    <button key={t} type="button" onClick={(e) => doExport(t, e.currentTarget)}
                      style={{ display: "block", width: "100%", padding: "7px 10px", fontSize: 13, border: 0, background: "transparent", borderRadius: "var(--radius-sm)", textAlign: "left", color: "var(--ink)", cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--brand-soft)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>{t}</button>
                  ))}
                </div>
              )}
            </div>
            <Button icon="upload" onClick={doImport}>导入</Button>
          </div>
        </Panel>

        {/* 左树右表 */}
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr)" : "220px minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
          {KA().TreeNav && KA().TreeNav({ title: "按归属", items: tree, active: node, onChange: (k) => { setNode(k); setChecked({}); } })}

          <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            <Panel padding={0} style={{ overflow: "hidden" }}>
              {view === "table" ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: 1040, borderCollapse: "collapse" }}>
                    <thead style={{ background: "var(--surface-2)" }}>
                      <tr style={{ borderBottom: "1px solid var(--line)" }}>
                        <th style={{ ...TH, width: 36 }}></th>
                        {["单据编号", "开票日期", "供应商", "价税合计", "类型", "来源", "归属", "打印", "操作"].map((h) => (
                          <th key={h} style={{ ...TH, textAlign: h === "价税合计" || h === "操作" ? "right" : "left" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{h}{FILTERABLE.indexOf(h) > -1 && <Icon name="filter" size={11} color="var(--ink-faint)" />}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((inv) => {
                        const excel = inv.source === "excel"; // 无扫描件：不可勾选（勾选服务于打印/导出原件）
                        const printed = inv.printCount || 0;
                        return (
                          <tr key={inv.id} style={{ borderBottom: "1px solid var(--line)" }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                            <td style={{ ...TD, textAlign: "center" }}><input type="checkbox" aria-label={"勾选发票 " + tail8(inv.number)} disabled={excel} checked={!!checked[inv.id]} onChange={() => setChecked((c) => ({ ...c, [inv.id]: !c[inv.id] }))} style={{ cursor: excel ? "not-allowed" : "pointer", opacity: excel ? 0.4 : 1 }} /></td>
                            <td style={TD}><button title="编辑（开页签）" onClick={() => openEdit(inv)} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 700, fontFamily: "var(--font-mono)", cursor: "pointer" }}>{tail8(inv.number)}</button></td>
                            <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{inv.date}</td>
                            <td style={{ ...TD, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><NameLink type="supplier" coll="suppliers" name={inv.seller} /></td>
                            <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{INV.money(inv.total)}</td>
                            <td style={{ ...TD, color: "var(--ink-soft)" }}>{(inv.type || "").replace("增值税", "").replace("发票", "") || "—"}</td>
                            <td style={TD}><StatusChip tone={excel ? "neutral" : "brand"}>{excel ? "导入" : "扫描"}</StatusChip></td>
                            <td style={TD}>{ownerCell(inv)}</td>
                            <td style={TD}>{printed > 0 ? <StatusChip tone="ok">{printed} 次</StatusChip> : <StatusChip tone="warn">未打印</StatusChip>}</td>
                            <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                              <span style={{ display: "inline-flex", gap: 4 }}>
                                {inv.account !== "posted" && <IconButton icon="archive" title="归档" onClick={() => archive(inv)} />}
                                <IconButton icon="square-pen" title="编辑（开页签）" onClick={() => openEdit(inv)} />
                                <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => del(inv)} />
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {rows.length === 0 && <tr><td colSpan={10} style={{ ...TD, textAlign: "center", color: "var(--ink-soft)", padding: 32 }}>该归属下暂无发票。</td></tr>}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(" + cardCols + ", minmax(0, 1fr))", gap: 12 }}>
                  {rows.map((inv) => (
                    <div key={inv.id} style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-card)", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--panel)" }}>
                      <div style={{ background: "var(--surface-2)", display: "grid", placeItems: "center", padding: 10, borderBottom: "1px solid var(--line)", cursor: "pointer" }} onClick={() => openEdit(inv)}>
                        <div style={{ width: "80%" }}>{INV.invoiceSvg(inv)}</div>
                      </div>
                      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                          <button onClick={() => openEdit(inv)} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 800, fontFamily: "var(--font-mono)", fontSize: 14, cursor: "pointer" }}>{tail8(inv.number)}</button>
                          <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "var(--font-mono)" }}>{INV.money(inv.total)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.seller}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {INV.ownerKindOf(inv) === "personal"
                            ? <StatusChip tone="brand">个人开支</StatusChip>
                            : inv.project ? <StatusChip tone="neutral">{inv.project}</StatusChip> : <StatusChip tone="warn">待归档</StatusChip>}
                          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}>{inv.date}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                          <Button size="sm" icon="square-pen" onClick={() => openEdit(inv)}>编辑</Button>
                          <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => del(inv)} />
                        </div>
                      </div>
                    </div>
                  ))}
                  {rows.length === 0 && <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--ink-soft)", padding: 32 }}>该归属下暂无发票。</div>}
                </div>
              )}
            </Panel>

            {/* 勾选才浮出合计（无常驻汇总） */}
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", background: "var(--surface-2)", padding: "10px 16px", fontSize: 13, color: "var(--ink-soft)", boxShadow: "var(--shadow-card)" }}>
              {checkedRows.length > 0
                ? <span style={{ padding: "2px 10px", borderRadius: 999, background: "var(--brand-soft)", color: "var(--brand-deep)" }}>已选 <b style={{ fontFamily: "var(--font-mono)" }}>{checkedRows.length}</b> 张 · 合计 <b style={{ fontFamily: "var(--font-mono)" }}>{INV.money(checkedTotal)}</b></span>
                : <span style={{ color: "var(--ink-faint)" }}>勾选发票后显示合计</span>}
              <span style={{ fontSize: 12 }}>共 {rows.length} 条</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  window.InvoiceLedgerScreen = InvoiceLedgerScreen;
})();
