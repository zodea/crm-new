// InvoiceLedgerScreen — 发票台账页（资金管理 · 反馈轮 7 新建）
// 三种呈现：列表（左树右表，表格↔卡片）/ 打印（勾选驱动，共用 INV.PrintLayout）/ 修改（开应用内页签 invoiceEdit）。
// 数据走 window.INV 共享 store；无常驻金额汇总，仅勾选时底部浮出合计。
(function () {
  const { Button, StatusChip, IconButton, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), exportModal: () => {}, importModal: () => {} };
  const I = () => window.INV;

  const TH = { padding: "12px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap" };
  const TD = { padding: "12px 14px", fontSize: 13, verticalAlign: "middle" };
  const INV_STRUCT = ["按归属", "按供应商", "按票据类型", "按开票月份"];
  const INV_NAME = [{ label: "发票号后8位", sample: "58760021" }, { label: "供应商简称", sample: "大板东建材" }, { label: "开票日期", sample: "2026-06-28" }, { label: "归属名称", sample: "车陂商业大楼" }];

  function InvoiceLedgerScreen({ navigate }) {
    if (!I()) return <Panel style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>加载中…</Panel>;
    const INV = I();
    const store = INV.useStore();
    const [node, setNode] = React.useState("__all");   // 树节点：__all / 项目名 / 个人开支 / __none
    const [view, setView] = React.useState("table");    // table | card | print
    const [checked, setChecked] = React.useState({});
    const [expOpen, setExpOpen] = React.useState(false);

    const ledger = store.live.filter((i) => i.account === "posted");
    // 树：项目一级 + 个人开支 + 未归项目
    const projNames = [];
    ledger.forEach((i) => { const k = i.project || ""; if (k && k !== INV.OWN && projNames.indexOf(k) < 0) projNames.push(k); });
    const nodeMatch = (i) => node === "__all" ? true : node === "__none" ? !i.project : node === "__own" ? i.project === INV.OWN : i.project === node;
    const rows = ledger.filter(nodeMatch);
    const countOf = (fn) => ledger.filter(fn).length;

    const tree = [
      { key: "__all", label: "全部", icon: "layers", count: ledger.length },
      ...projNames.map((n) => ({ key: n, label: n, icon: "folder", count: countOf((i) => i.project === n) })),
      { key: "__own", label: "个人开支", icon: "user", count: countOf((i) => i.project === INV.OWN), tone: "brand" },
      { key: "__none", label: "未归项目", icon: "alert-triangle", count: countOf((i) => !i.project), tone: "warn" },
    ];

    const checkedRows = rows.filter((i) => checked[i.id]);
    const checkedTotal = checkedRows.reduce((s, i) => s + Number(i.total || 0), 0);
    const srcChip = { scan: { tone: "brand", text: "扫描" }, excel: { tone: "neutral", text: "导入" } };
    const openEdit = (inv) => navigate("invoiceEdit", { id: inv.id });
    const del = (inv) => UI().confirm({ title: "删除发票", message: "确定删除「" + inv.number.slice(-8) + "」？删除为软删除，可在 5 秒内撤回。", danger: true, confirmText: "删除", onConfirm: () => INV.softDel(inv) });

    const doExport = (kind, anchor) => {
      const target = checkedRows.length ? checkedRows : rows;
      if (kind === "打印 PDF") { setView("print"); }
      else if (kind === "导出原件") UI().exportModal({ title: "导出原件", subtitle: "共 " + target.filter((i) => i.source !== "excel").length + " 张 · 原始扫描件按文件夹组织", count: target.filter((i) => i.source !== "excel").length, unit: "张", ext: ".pdf", anchor, structureOptions: INV_STRUCT, nameOptions: INV_NAME });
      else UI().exportModal({ title: "导出 Excel 台账", subtitle: "共 " + target.length + " 条结构化数据", count: target.length, unit: "条", ext: ".xlsx", anchor, structureOptions: ["不分层", "按归属", "按开票月份"], nameOptions: [{ label: "发票台账", sample: "发票台账" }, { label: "导出日期", sample: "2026-07-03" }] });
    };
    const doImport = () => UI().importModal({
      title: "导入历史发票台账", subtitle: "纯数据发票 · 无扫描件不可打印 · 缺归属行将被拒绝", fileName: "发票台账_2026-06.xlsx", rowCount: 3,
      targetFields: ["单据编号", "开票日期", "购买方", "供应商", "价税合计", "税额", "票据类型", "对应归属"],
      sourceCols: ["发票号码", "开票日期", "购方名称", "销方名称", "价税合计", "税额", "发票类型", "项目"],
      onDone: () => {
        const ts = Date.now();
        INV.add([
          { id: "inv_im1_" + ts, number: "58769101" + ts % 100, date: "2026-05-28", buyer: "广州瑞航建设工程有限公司", seller: "广州市大板东建材有限公司", type: "增值税普通发票", total: 12800, tax: 372.82, amount: 12427.18, rate: "3%", project: "车陂商业大楼", remark: "导入·辅材", status: "done", review: false, account: "posted", source: "excel", printCount: 0 },
          { id: "inv_im2_" + ts, number: "58769102" + ts % 100, date: "2026-05-25", buyer: "广州瑞航建设工程有限公司", seller: "穗建五金机电经营部", type: "增值税普通发票", total: 4300, tax: 125.24, amount: 4174.76, rate: "3%", project: "合和新城", remark: "导入·五金", status: "done", review: false, account: "posted", source: "excel", printCount: 0 },
        ]);
        UI().toast("已导入 2 行（1 行缺归属被拒绝）", "ok");
      },
    });

    if (view === "print") {
      return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <INV.PrintLayout rows={checkedRows.length ? checkedRows : rows} onPrint={(i) => INV.update(i.id, { printCount: (i.printCount || 0) + 1, lastPrintedAt: "2026-07-03" })} onBack={() => setView("table")} backLabel="返回台账" />
      </div>;
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* 工具栏 */}
        <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "stretch", border: "1px solid var(--line-strong)", borderRadius: 999, overflow: "hidden", background: "#fff" }}>
            <select style={{ border: 0, borderRight: "1px solid var(--line)", background: "var(--surface-2)", padding: "0 8px", fontSize: 12, color: "var(--ink-soft)", cursor: "pointer" }}>
              {["全部字段", "单据编号", "供应商", "归属", "备注"].map((s) => <option key={s}>{s}</option>)}
            </select>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}><Icon name="search" size={14} color="var(--ink-faint)" /></span>
              <input placeholder="搜索…" style={{ width: 180, border: 0, padding: "8px 14px 8px 32px", fontSize: 13, background: "transparent", outline: "none" }} />
            </div>
          </div>
          <button onClick={() => UI().toast("选择起止日期（演示）")} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--line-strong)", background: "#fff", borderRadius: 999, padding: "7px 14px", fontSize: 13, color: "var(--ink-soft)", cursor: "pointer" }}><Icon name="calendar" size={14} />起止日期</button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* 视图切换 */}
            <div style={{ display: "inline-flex", border: "1px solid var(--line-strong)", borderRadius: 8, overflow: "hidden" }}>
              {[["table", "table", "表格"], ["card", "layout-grid", "卡片"]].map(([k, ic, lbl]) => (
                <button key={k} onClick={() => setView(k)} title={lbl} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: 0, padding: "6px 10px", fontSize: 12, fontWeight: view === k ? 800 : 600, cursor: "pointer", background: view === k ? "var(--brand-soft)" : "#fff", color: view === k ? "var(--brand-deep)" : "var(--ink-soft)" }}><Icon name={ic} size={13} />{lbl}</button>
              ))}
            </div>
            <Button icon="printer" onClick={() => setView("print")}>打印</Button>
            <div style={{ position: "relative" }}>
              <Button icon="download" iconRight="chevron-down" onClick={() => setExpOpen(!expOpen)}>导出</Button>
              {expOpen && (
                <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, minWidth: 150, background: "#fff", border: "1px solid var(--line-strong)", borderRadius: 8, boxShadow: "var(--shadow-pop)", padding: 4, zIndex: 20 }} onClick={() => setExpOpen(false)}>
                  {["打印 PDF", "导出原件", "导出 Excel"].map((t) => <button key={t} onClick={(e) => doExport(t, e.currentTarget)} style={{ display: "block", width: "100%", padding: "7px 10px", fontSize: 13, border: 0, background: "transparent", borderRadius: 6, textAlign: "left", color: "var(--ink)", cursor: "pointer" }}>{t}</button>)}
                </div>
              )}
            </div>
            <Button icon="upload" onClick={doImport}>导入</Button>
          </div>
        </Panel>

        {/* 左树右表 */}
        <div style={{ display: "grid", gridTemplateColumns: "20fr 80fr", gap: 14, alignItems: "start" }}>
          <Panel padding={0} style={{ overflow: "hidden" }}>
            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>按归属</div>
            <div style={{ padding: 6 }}>
              {tree.map((t) => {
                const on = node === t.key;
                return (
                  <button key={t.key} onClick={() => { setNode(t.key); setChecked({}); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: 0, borderRadius: 8, padding: "8px 10px", cursor: "pointer", textAlign: "left", background: on ? "var(--brand-soft)" : "transparent", color: t.tone === "warn" && !on ? "var(--warn-ink)" : "var(--ink)", marginBottom: 2 }}>
                    <Icon name={t.icon} size={14} color={on ? "var(--brand)" : (t.tone === "warn" ? "var(--warn)" : t.tone === "brand" ? "var(--brand)" : "var(--ink-faint)")} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: on ? 800 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
                    <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: on ? "var(--brand)" : "var(--ink-faint)", background: on ? "#fff" : "var(--surface-3)", borderRadius: 999, padding: "1px 7px" }}>{t.count}</span>
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel padding={0} style={{ overflow: "hidden" }}>
            {view === "table" ? (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 1040, borderCollapse: "collapse" }}>
                  <thead style={{ background: "var(--surface-2)" }}>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      <th style={{ ...TH, width: 36 }}></th>
                      {["单据编号", "开票日期", "供应商", "价税合计", "类型", "来源", "归属", "打印", "操作"].map((h) => (
                        <th key={h} style={{ ...TH, textAlign: h === "价税合计" || h === "操作" ? "right" : "left" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{h}{["供应商", "类型", "来源", "归属", "打印"].includes(h) && <Icon name="filter" size={11} color="var(--ink-faint)" />}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((inv) => {
                      const src = srcChip[inv.source || "scan"];
                      const printed = inv.printCount || 0;
                      const excel = inv.source === "excel";
                      return (
                        <tr key={inv.id} style={{ borderBottom: "1px solid var(--line)" }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                          <td style={{ ...TD, textAlign: "center" }}><input type="checkbox" disabled={excel} checked={!!checked[inv.id]} onChange={() => setChecked((c) => ({ ...c, [inv.id]: !c[inv.id] }))} style={{ cursor: excel ? "not-allowed" : "pointer", opacity: excel ? 0.4 : 1 }} /></td>
                          <td style={TD}><button onClick={() => openEdit(inv)} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 700, fontFamily: "var(--font-mono)", cursor: "pointer" }}>{inv.number.slice(-8)}</button></td>
                          <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{inv.date}</td>
                          <td style={{ ...TD, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.seller}</td>
                          <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{INV.money(inv.total)}</td>
                          <td style={{ ...TD, color: "var(--ink-soft)" }}>{(inv.type || "").replace("增值税", "").replace("发票", "")}</td>
                          <td style={TD}><StatusChip tone={src.tone}>{src.text}</StatusChip></td>
                          <td style={TD}>{inv.project ? <span style={{ color: inv.project === INV.OWN ? "var(--brand-deep)" : "var(--ink-soft)" }}>{inv.project}</span> : <StatusChip tone="warn">未归</StatusChip>}</td>
                          <td style={TD}>{printed > 0 ? <StatusChip tone="ok">{printed} 次</StatusChip> : <StatusChip tone="warn">未打印</StatusChip>}</td>
                          <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                            <span style={{ display: "inline-flex", gap: 6 }}>
                              <IconButton icon="square-pen" title="编辑（开页签）" onClick={() => openEdit(inv)} />
                              <IconButton icon="image" title={excel ? "无扫描件" : "查看原件"} disabled={excel} onClick={() => !excel && UI().modal({ title: "发票原件 · " + inv.number.slice(-8), subtitle: inv.seller, width: 520, bodyHTML: '<div style="height:320px;display:grid;place-items:center;background:var(--surface-2);border-radius:8px;color:var(--brand);font-size:40px;font-weight:800;opacity:.4">票</div>' })} />
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
              <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {rows.map((inv) => {
                  const excel = inv.source === "excel";
                  return (
                    <div key={inv.id} style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", background: "#fff" }}>
                      <div style={{ height: 132, background: "var(--surface-2)", display: "grid", placeItems: "center", padding: 10, borderBottom: "1px solid var(--line)", cursor: "pointer" }} onClick={() => openEdit(inv)}>
                        <div style={{ width: "78%" }}>{INV.invoiceSvg(inv)}</div>
                      </div>
                      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                          <button onClick={() => openEdit(inv)} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 800, fontFamily: "var(--font-mono)", fontSize: 14, cursor: "pointer" }}>{inv.number.slice(-8)}</button>
                          <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "var(--font-mono)" }}>{INV.money(inv.total)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.seller}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {inv.project ? <StatusChip tone={inv.project === INV.OWN ? "brand" : "neutral"}>{inv.project}</StatusChip> : <StatusChip tone="warn">未归项目</StatusChip>}
                          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}>{inv.date}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                          <Button size="sm" icon="square-pen" onClick={() => openEdit(inv)}>编辑</Button>
                          <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => del(inv)} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                {rows.length === 0 && <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--ink-soft)", padding: 32 }}>该归属下暂无发票。</div>}
              </div>
            )}

            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, fontSize: 13, color: "var(--ink-soft)" }}>
              <span>{checkedRows.length > 0 ? <span style={{ padding: "3px 10px", borderRadius: 999, background: "var(--brand-soft)", color: "var(--brand-deep)" }}>已选 <b style={{ fontFamily: "var(--font-mono)" }}>{checkedRows.length}</b> 张 · 合计 <b style={{ fontFamily: "var(--font-mono)" }}>{INV.money(checkedTotal)}</b></span> : <span style={{ color: "var(--ink-faint)" }}>勾选发票后显示合计</span>}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {["‹", "1", "2", "›"].map((p, i) => <button key={i} style={{ minWidth: 28, height: 28, border: "1px solid var(--line)", borderRadius: 8, background: p === "1" ? "var(--brand)" : "#fff", color: p === "1" ? "#fff" : "var(--ink-soft)", fontSize: 12, cursor: "pointer" }}>{p}</button>)}
                <span style={{ marginLeft: 6, fontSize: 12 }}>共 {rows.length} 条</span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  window.InvoiceLedgerScreen = InvoiceLedgerScreen;
})();
