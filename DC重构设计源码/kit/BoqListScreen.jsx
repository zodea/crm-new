// BoqListScreen — 工程量清单管理页（分包及人工 · #38 · 反馈轮 7 新建）
// 承接拆表结果：分部→工种→分项目录（左）+ 统一清单行含三量（右，合同量/暂估量/现场量）。
// 合同量/合同单价的唯一来源；变更单 / 月度报量为后续深化入口。术语见 CONTEXT.md（三量/合同工程量清单）。
(function () {
  const { Button, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {} };
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

    // 目录树：分部 → 工种
    const divs = [];
    ROWS.forEach((r) => { let d = divs.find((x) => x.name === r.div); if (!d) { d = { name: r.div, trades: [] }; divs.push(d); } if (d.trades.indexOf(r.trade) < 0) d.trades.push(r.trade); });
    const match = (r) => sel === "__all" ? true : sel.indexOf("|") > -1 ? (r.div + "|" + r.trade) === sel : r.div === sel;
    const rows = ROWS.filter(match);
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
            <Button icon="git-compare" onClick={() => UI().toast("变更单管理（后续深化）")}>变更单</Button>
            <Button icon="file-output" onClick={() => UI().toast("月度报量草稿（后续深化）")}>月度报量</Button>
            <Button icon="upload" onClick={() => navigate("boqImport", { contract, project })}>重新拆表</Button>
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
                    {["分项名称", "房间", "单位", "合同量", "暂估量", "现场量", "合同单价", "合价"].map((h, i) => <th key={h} style={{ padding: "11px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: i >= 3 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--line)" }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ padding: "10px 14px", fontSize: 13 }}><div style={{ fontWeight: 600 }}>{r.item}</div><div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>{r.div} · {r.trade}</div></td>
                      <td style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--ink-soft)" }}>{r.room}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12.5 }}>{r.unit}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: base === "con" ? 700 : 400 }}>{num(r.con)}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right", color: "var(--ink-soft)", fontWeight: base === "est" ? 700 : 400 }}>{num(r.est)}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: base === "site" ? 700 : 400 }} title={r.siteExpr}>{r.site ? num(r.site) : <span style={{ color: "var(--ink-faint)" }}>未录</span>}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right" }}>{money(r.price)}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 700 }}>{money(baseQty(r) * r.price)}</td>
                    </tr>
                  ))}
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
