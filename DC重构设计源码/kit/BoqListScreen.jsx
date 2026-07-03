// BoqListScreen — 工程量清单管理页（分包及人工 · #38 · 反馈轮 7 新建）
// 承接拆表结果：分部→工种→分项目录（左）+ 统一清单行含三量（右，合同量/暂估量/现场量）。
// 合同量/合同单价的唯一来源；变更单 / 月度报量为后续深化入口。术语见 CONTEXT.md（三量/合同工程量清单）。
(function () {
  const { Button, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), formModal: () => {}, modal: () => {}, undoToast: () => {} };
  const money = (v) => "¥" + Number(v || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 });
  const num = (v) => Number(v || 0).toLocaleString("zh-CN");

  // 清单行（三量：合同量/暂估量/现场量；现场量存算式）
  const ROWS = [
    { div: "楼地面工程", trade: "泥水", item: "客餐厅地砖铺贴 800×800", room: "客餐厅", unit: "㎡", con: 1564.8, est: 1564.8, site: 1520.4, siteExpr: "32.6×46+…", price: 78 },
    { div: "楼地面工程", trade: "泥水", item: "阳台地砖铺贴 300×600", room: "阳台", unit: "㎡", con: 307.2, est: 307.2, site: 0, siteExpr: "", price: 72 },
    { div: "楼地面工程", trade: "泥水", item: "卫生间地砖防滑 300×300", room: "主卫/次卫", unit: "㎡", con: 470.4, est: 470.4, site: 458.2, siteExpr: "9.8×46+…", price: 85 },
    { div: "楼地面工程", trade: "自流平", item: "卧室自流平找平", room: "卧室", unit: "㎡", con: 2044.8, est: 2044.8, site: 0, siteExpr: "", price: 32 },
    { div: "墙柱面工程", trade: "泥水", item: "厨房墙砖 300×600", room: "厨房", unit: "㎡", con: 1032, est: 1032, site: 1008, siteExpr: "21.5×46+…", price: 68 },
    { div: "墙柱面工程", trade: "泥水", item: "卫生间墙砖 300×600", room: "主卫/次卫", unit: "㎡", con: 1641.6, est: 1641.6, site: 1620, siteExpr: "34.2×46+…", price: 68 },
    { div: "墙柱面工程", trade: "油漆", item: "墙面乳胶漆两遍", room: "客餐厅/卧室", unit: "㎡", con: 6163.2, est: 6163.2, site: 0, siteExpr: "", price: 26 },
    { div: "墙柱面工程", trade: "油漆", item: "顶棚乳胶漆两遍", room: "全屋", unit: "㎡", con: 3787.2, est: 3787.2, site: 0, siteExpr: "", price: 28 },
    { div: "装饰工程", trade: "石材", item: "窗台石 大理石", room: "各窗台", unit: "m", con: 393.6, est: 393.6, site: 393.6, siteExpr: "8.2×48", price: 220 },
  ];

  function BoqListScreen({ navigate, params }) {
    const p = params || {};
    const contract = p.contract || "合和七期户内合同版-清单";
    const project = p.project || "合和新城";
    const [sel, setSel] = React.useState("__all"); // 分部 或 分部|工种
    const [base, setBase] = React.useState("con"); // 取数基准量：con/est/site
    // 反馈轮8（七）：清单行转 state + 编辑模式（行内改单价/暂估量/现场量算式、新增分项、软删除）
    const [list, setList] = React.useState(() => ROWS.map((r, i) => ({ ...r, id: "bq" + i })));
    const [editing, setEditing] = React.useState(false);
    const updRow = (id, patch) => setList((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const delRow = (r) => UI().confirm({
      title: "删除清单行", danger: true, confirmText: "删除",
      message: "确定删除「" + r.item + "」？正式流程中调量/删行应走「变更单」留痕；此处为软删除，可 5 秒内撤回。",
      onConfirm: () => {
        const idx = list.findIndex((x) => x.id === r.id);
        setList((l) => l.filter((x) => x.id !== r.id));
        UI().undoToast("已删除「" + r.item + "」", () => setList((l) => { const n = [...l]; n.splice(Math.min(idx, n.length), 0, r); return n; }));
      },
    });
    const addRow = () => UI().formModal({
      title: "新增分项（变更）", cols: 2,
      fields: [
        { key: "div", label: "分部", type: "select", options: ["楼地面工程", "墙柱面工程", "装饰工程", "安装工程"], value: "楼地面工程" },
        { key: "trade", label: "工种", type: "select", options: ["泥水", "油漆", "石材", "自流平", "水电"], value: "泥水" },
        { key: "item", label: "分项名称", full: true },
        { key: "room", label: "房间（部位）" }, { key: "unit", label: "单位", value: "㎡" },
        { key: "con", label: "合同量" }, { key: "price", label: "合同单价（不含税）" },
      ],
      onSave: (v) => {
        if (!v.item) { UI().toast("分项名称不能为空", "danger"); return; }
        setList((l) => [...l, { id: "bq_" + Date.now(), div: v.div, trade: v.trade, item: v.item, room: v.room || "—", unit: v.unit || "㎡", con: Number(v.con) || 0, est: Number(v.con) || 0, site: 0, siteExpr: "", price: Number(v.price) || 0, changed: true }]);
        UI().toast("已新增分项（标记为变更新增，待甲方确认）", "ok");
      },
    });
    const changeLog = () => UI().modal({
      title: "变更单", subtitle: contract + " · 新增/调量/调价 + 甲方确认状态", width: 560,
      bodyHTML:
        '<table style="width:100%;border-collapse:collapse;font-size:12.5px">' +
        '<tr style="background:var(--surface-2)"><th style="padding:8px 10px;text-align:left">编号</th><th style="padding:8px 10px;text-align:left">类型</th><th style="padding:8px 10px;text-align:left">内容</th><th style="padding:8px 10px;text-align:left">甲方确认</th></tr>' +
        '<tr style="border-top:1px solid var(--line)"><td style="padding:8px 10px;font-family:var(--font-mono)">BG-001</td><td style="padding:8px 10px">调价</td><td style="padding:8px 10px">窗台石 220→235/m</td><td style="padding:8px 10px;color:var(--ok-ink)">已确认</td></tr>' +
        '<tr style="border-top:1px solid var(--line)"><td style="padding:8px 10px;font-family:var(--font-mono)">BG-002</td><td style="padding:8px 10px">新增</td><td style="padding:8px 10px">入户门槛石安装</td><td style="padding:8px 10px;color:var(--warn-ink)">待确认</td></tr>' +
        (list.filter((r) => r.changed).map((r, i) => '<tr style="border-top:1px solid var(--line)"><td style="padding:8px 10px;font-family:var(--font-mono)">BG-' + String(3 + i).padStart(3, "0") + '</td><td style="padding:8px 10px">新增</td><td style="padding:8px 10px">' + r.item + '</td><td style="padding:8px 10px;color:var(--warn-ink)">待确认</td></tr>').join("")) +
        "</table>",
      actions: [{ label: "关闭" }, { label: "新增变更", primary: true, onClick: addRow }],
    });

    // 目录树：分部 → 工种
    const divs = [];
    list.forEach((r) => { let d = divs.find((x) => x.name === r.div); if (!d) { d = { name: r.div, trades: [] }; divs.push(d); } if (d.trades.indexOf(r.trade) < 0) d.trades.push(r.trade); });
    const match = (r) => sel === "__all" ? true : sel.indexOf("|") > -1 ? (r.div + "|" + r.trade) === sel : r.div === sel;
    const rows = list.filter(match);
    const conTotal = rows.reduce((s, r) => s + r.con * r.price, 0);
    const baseQty = (r) => r[base];
    const baseTotal = rows.reduce((s, r) => s + baseQty(r) * r.price, 0);
    const diffAmt = baseTotal - conTotal;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 头部 */}
        <Panel padding={16} style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span style={{ width: 40, height: 40, borderRadius: 10, background: "var(--brand-soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name="clipboard-list" size={20} color="var(--brand)" /></span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{contract}</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>合同工程量清单 · 归属「{project}」· 合同量与合同单价唯一来源</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button icon="git-compare" onClick={changeLog}>变更单</Button>
            <Button icon="file-output" onClick={() => UI().toast("月度报量草稿（后续深化）")}>月度报量</Button>
            <Button icon="upload" onClick={() => navigate("boqImport", { contract, project })}>重新拆表</Button>
            {editing && <Button icon="plus" onClick={addRow}>新增分项</Button>}
            <Button variant={editing ? "primary" : undefined} icon={editing ? "check" : "square-pen"} onClick={() => { setEditing(!editing); if (editing) UI().toast("已保存清单修改", "ok"); }}>{editing ? "完成编辑" : "编辑清单"}</Button>
          </div>
        </Panel>

        {/* 取数基准量 + 量差 */}
        <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)" }}>取数基准量</span>
          <div style={{ display: "inline-flex", border: "1px solid var(--line-strong)", borderRadius: 8, overflow: "hidden" }}>
            {[["con", "合同量"], ["est", "暂估量"], ["site", "现场量"]].map(([k, lbl]) => (
              <button key={k} onClick={() => setBase(k)} style={{ border: 0, padding: "7px 14px", fontSize: 13, fontWeight: base === k ? 800 : 600, cursor: "pointer", background: base === k ? "var(--brand-soft)" : "#fff", color: base === k ? "var(--brand-deep)" : "var(--ink-soft)" }}>{lbl}</button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13 }}>
            <span style={{ color: "var(--ink-soft)" }}>合同量合价 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{money(conTotal)}</b></span>
            <span style={{ color: "var(--ink-soft)" }}>基准量合价 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{money(baseTotal)}</b></span>
            <span style={{ color: "var(--ink-soft)" }}>量差金额 <b style={{ color: diffAmt < 0 ? "var(--danger-ink)" : diffAmt > 0 ? "var(--ok-ink)" : "var(--ink)", fontFamily: "var(--font-mono)" }}>{diffAmt === 0 ? "¥0.00" : (diffAmt > 0 ? "+" : "") + money(diffAmt).slice(1)}</b></span>
          </div>
        </Panel>

        <div style={{ display: "grid", gridTemplateColumns: "22fr 78fr", gap: 16, alignItems: "start" }}>
          {/* 左：分部→工种目录 */}
          <Panel padding={0} style={{ overflow: "hidden" }}>
            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>分部 → 工种</div>
            <div style={{ padding: 6 }}>
              <TreeBtn label="全部分项" icon="layers" active={sel === "__all"} count={ROWS.length} onClick={() => setSel("__all")} />
              {divs.map((d) => (
                <div key={d.name}>
                  <TreeBtn label={d.name} icon="folder" active={sel === d.name} count={ROWS.filter((r) => r.div === d.name).length} onClick={() => setSel(d.name)} />
                  <div style={{ paddingLeft: 14 }}>
                    {d.trades.map((t) => (
                      <TreeBtn key={t} label={t} icon="wrench" sub active={sel === d.name + "|" + t} count={ROWS.filter((r) => r.div === d.name && r.trade === t).length} onClick={() => setSel(d.name + "|" + t)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {/* 右：清单行 + 三量 */}
          <Panel padding={0} style={{ overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 940, borderCollapse: "collapse" }}>
                <thead style={{ background: "var(--surface-2)" }}>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    {["分项名称", "房间", "单位", "合同量", "暂估量", "现场量", "合同单价", "合价"].concat(editing ? ["操作"] : []).map((h, i) => <th key={h} style={{ padding: "11px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: i >= 3 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const edInp = (val, onCh, w, ph) => <input value={val} placeholder={ph} onChange={(e) => onCh(e.target.value)} style={{ width: w || 76, textAlign: "right", border: "1px solid var(--line-strong)", borderRadius: 6, padding: "4px 7px", fontSize: 12, fontFamily: "var(--font-mono)", background: "#fff" }} />;
                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid var(--line)", background: r.changed ? "var(--warn-soft)" : "transparent" }} onMouseEnter={(e) => { if (!r.changed) e.currentTarget.style.background = "var(--surface-3)"; }} onMouseLeave={(e) => { if (!r.changed) e.currentTarget.style.background = "transparent"; }}>
                        <td style={{ padding: "10px 14px", fontSize: 13 }}><div style={{ fontWeight: 600 }}>{r.item}{r.changed && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--warn-ink)", background: "#fff", border: "1px solid var(--warn)", borderRadius: 999, padding: "1px 6px" }}>变更新增</span>}</div><div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>{r.div} · {r.trade}</div></td>
                        <td style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--ink-soft)" }}>{r.room}</td>
                        <td style={{ padding: "10px 14px", fontSize: 12.5 }}>{r.unit}</td>
                        <td style={{ padding: "10px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: base === "con" ? 700 : 400 }} title="合同量以清单/变更单为准，不在此直改">{num(r.con)}</td>
                        <td style={{ padding: "10px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right", color: "var(--ink-soft)", fontWeight: base === "est" ? 700 : 400 }}>
                          {editing ? edInp(r.est, (v) => updRow(r.id, { est: Number(v) || 0 })) : num(r.est)}
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: base === "site" ? 700 : 400 }} title={r.siteExpr}>
                          {editing ? edInp(r.siteExpr || "", (v) => {
                            // 现场量存算式本身：即时求值（仅 + - × × / 数字），失败保持原值
                            let val = 0; try { val = Function('"use strict";return (' + v.replace(/×/g, "*").replace(/[^\d+\-*/.() ]/g, "") + ")")() || 0; } catch (e) { val = r.site; }
                            updRow(r.id, { siteExpr: v, site: Math.round(val * 10) / 10 });
                          }, 120, "算式 如 5.2×2.4+…") : (r.site ? num(r.site) : <span style={{ color: "var(--ink-faint)" }}>未录</span>)}
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right" }}>
                          {editing ? edInp(r.price, (v) => updRow(r.id, { price: Number(v) || 0 })) : money(r.price)}
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 700 }}>{money(baseQty(r) * r.price)}</td>
                        {editing && <td style={{ padding: "10px 14px", textAlign: "right" }}>
                          <button onClick={() => delRow(r)} title="删除（软删除可撤回）" style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--danger)", display: "inline-flex" }}><Icon name="trash-2" size={15} /></button>
                        </td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--surface-2)", display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ink-soft)" }}>
              <span>共 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{rows.length}</b> 条清单行</span>
              <span>现场量按算式录入（hover 查看），未录以基准量回退</span>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  function TreeBtn({ label, icon, active, count, onClick, sub }) {
    return (
      <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: 0, borderRadius: 8, padding: sub ? "6px 10px" : "8px 10px", cursor: "pointer", textAlign: "left", background: active ? "var(--brand-soft)" : "transparent", marginBottom: 2 }}>
        <Icon name={icon} size={sub ? 12 : 14} color={active ? "var(--brand)" : "var(--ink-faint)"} />
        <span style={{ flex: 1, fontSize: sub ? 12.5 : 13, fontWeight: active ? 800 : sub ? 500 : 600, color: active ? "var(--brand-deep)" : "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: active ? "var(--brand)" : "var(--ink-faint)" }}>{count}</span>
      </button>
    );
  }

  window.BoqListScreen = BoqListScreen;
})();
