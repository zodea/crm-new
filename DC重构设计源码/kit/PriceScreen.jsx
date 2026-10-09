// PriceScreen — 材料价格分析（#207 2026-08-01 裁定：归属乙供材分组；四维度全做）。
// 四视图（KA.SegTab）：
//   ① 价差对比  = 材采合同单价 vs 送货单/到货实际均价，差异率超 +5% 标红，列来源单据数
//   ② 供应商比价 = 材料×供应商最新价矩阵（最低价绿 ✓），保留旧屏 并组/拆分/排除/剔除折叠 工具
//   ③ 价格趋势  = 材料选择器 → SVG 折线 + 月度表（环比涨跌）
//   ④ 项目汇总  = 项目×材料类目 采购额/均价，额可下钻送货单归档库
// 数据：无直接参考页（DC 独有能力，数据由送货单识别沉淀）。演示数据内置本屏（匿名虚构，
// 与 data.js 世界观同源：供应商=大板东/汇丰水泥/穗建五金，项目=合和新城系）；
// 比价矩阵仍读 KIT_DATA.priceRows / priceSuppliers。
(function () {
  if (window.PriceScreen && window.PriceScreen.__v2) return;
  const DS = () => window.DesignSystem_e3d871 || {};
  const UI = () => window.KitUI || { toast: function () {}, confirm: (o) => o.onConfirm && o.onConfirm() };

  // —— 内置演示数据（材料×合同价×月度实际价×项目采购） ——
  const DIFF_ROWS = [
    { name: "HRB400 螺纹钢", spec: "Φ12", unit: "吨", contract: 3980, actual: 3986.5, docs: 6, contractNo: "RH-CG-2026-002" },
    { name: "全抛釉瓷砖", spec: "800×800", unit: "块", contract: 42.8, actual: 42.8, docs: 9, contractNo: "RH-CG-2026-001" },
    { name: "C30 商品混凝土", spec: "泵送", unit: "m³", contract: 455, actual: 462.4, docs: 11, contractNo: "RH-CG-2026-005" },
    { name: "镀锌钢管", spec: "DN50", unit: "根", contract: 88, actual: 82.6, docs: 4, contractNo: "RH-CG-2026-007" },
    { name: "防水卷材 SBS", spec: "3mm", unit: "卷", contract: 315, actual: 331.2, docs: 5, contractNo: "RH-CG-2026-008" },
    { name: "电缆 YJV", spec: "4×35", unit: "米", contract: 96.5, actual: 96.5, docs: 2, contractNo: "RH-CG-2026-004" },
  ];
  const TREND = {
    "HRB400 螺纹钢 Φ12": { "大板东": [["2026-01", 4050], ["2026-02", 4020], ["2026-03", 3960], ["2026-04", 3920], ["2026-05", 3950], ["2026-06", 3980]] },
    "C30 商品混凝土": { "汇丰水泥": [["2026-01", 455], ["2026-02", 458], ["2026-03", 461], ["2026-04", 470], ["2026-05", 466], ["2026-06", 462]] },
    "镀锌钢管 DN50": { "大板东": [["2026-03", 86], ["2026-04", 86], ["2026-05", 86], ["2026-06", 86]], "穗建五金": [["2026-03", 85], ["2026-04", 83], ["2026-05", 80], ["2026-06", 82]] },
  };
  const PROJ_ROWS = [
    { project: "合和新城", cat: "瓷砖及辅料", amount: 226800, avg: 42.8, docs: 9 },
    { project: "合和新城", cat: "钢筋", amount: 477600, avg: 3986.5, docs: 6 },
    { project: "锦绣华庭", cat: "商品混凝土", amount: 859064, avg: 462.4, docs: 11 },
    { project: "锦绣华庭", cat: "五金机电", amount: 96520, avg: 82.6, docs: 4 },
    { project: "车陂商业大楼", cat: "防水材料", amount: 132480, avg: 331.2, docs: 5 },
  ];

  const th = { padding: "0 12px", height: 36, fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", textAlign: "left", whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 };
  const td = { padding: "0 12px", height: 36, fontSize: 13, verticalAlign: "middle", whiteSpace: "nowrap" };
  const mono = { fontFamily: "var(--font-mono)" };
  const yuan = (v) => "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function PriceScreen({ data, navigate }) {
    const { Button, Panel } = DS();
    const KA = window.KitAtoms || {};
    const nav = navigate || (window.DC && window.DC.navigate);
    const [view, setView] = React.useState("diff");
    const [proj, setProj] = React.useState("");
    const [trendMat, setTrendMat] = React.useState(Object.keys(TREND)[0]);
    const { priceSuppliers, priceRows } = data;
    if (!Panel || !KA.SegTab) return null;

    // —— 视图 ①：价差对比 ——
    const renderDiff = () => (
      <Panel padding={0} style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 920, borderCollapse: "collapse" }}>
            <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>
              <th style={{ ...th, width: 40 }}>#</th><th style={th}>材料</th><th style={{ ...th, width: 90 }}>规格</th><th style={{ ...th, width: 56 }}>单位</th>
              <th style={{ ...th, textAlign: "right" }}>合同单价</th><th style={{ ...th, textAlign: "right" }}>实际均价</th>
              <th style={{ ...th, textAlign: "right" }}>差异率</th><th style={{ ...th, width: 150 }}>合同</th><th style={{ ...th, textAlign: "right", width: 90 }}>来源单据</th>
            </tr></thead>
            <tbody>
              {DIFF_ROWS.map((r, i) => {
                const rate = (r.actual - r.contract) / r.contract * 100;
                const tone = rate > 5 ? "var(--danger)" : rate > 0.01 ? "var(--warn-ink)" : rate < -0.01 ? "var(--ok)" : "var(--ink-soft)";
                return (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ ...td, color: "var(--ink-faint)", ...mono }}>{i + 1}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                    <td style={{ ...td, color: "var(--ink-soft)" }}>{r.spec}</td>
                    <td style={{ ...td, color: "var(--ink-soft)" }}>{r.unit}</td>
                    <td style={{ ...td, textAlign: "right", ...mono }}>{yuan(r.contract)}</td>
                    <td style={{ ...td, textAlign: "right", ...mono, fontWeight: 600 }}>{yuan(r.actual)}</td>
                    <td style={{ ...td, textAlign: "right", ...mono, fontWeight: 700, color: tone }}>{(rate > 0 ? "+" : "") + rate.toFixed(1)}%</td>
                    <td style={{ ...td, ...mono, fontSize: 12, color: "var(--ink-soft)" }}>{r.contractNo}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <button type="button" onClick={() => nav && nav("deliveryArchive", {})}
                        style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-mono)" }}>{r.docs} 份</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)", padding: "8px 16px", fontSize: 12, color: "var(--ink-soft)" }}>
          差异率 = (实际均价 − 合同单价) ÷ 合同单价；超 +5% 标红。实际均价按送货单/到货明细行加权。
        </div>
      </Panel>
    );

    // —— 视图 ②：供应商比价（旧屏矩阵保留） ——
    const fmt = (c) => (c.min === c.max ? "" + c.recent : c.recent + "（" + c.min + "~" + c.max + "）");
    const renderCompare = () => (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Panel padding={10}>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--ink-soft)" }}>已从对比剔除 3 类（运费类等不参与最低价对比；送货单明细 / 导出仍保留）</summary>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {[["运费", 3], ["搬运费", 1], ["上楼费", 2]].map(([n, c]) => (
                <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--line)", background: "#fff", borderRadius: 999, padding: "3px 10px", fontSize: 12 }}>
                  {n}<span style={{ color: "var(--ink-soft)" }}>×{c}</span>
                  <button onClick={() => UI().toast("已恢复「" + n + "」参与对比")} style={{ border: 0, background: "transparent", color: "var(--brand)", cursor: "pointer", fontSize: 12, padding: 0 }}>恢复</button>
                </span>
              ))}
            </div>
          </details>
        </Panel>
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto", maxHeight: 540 }}>
            <table style={{ width: "100%", minWidth: 860, borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>
                <th style={{ ...th, width: 40 }}>#</th><th style={th}>材料（归组）</th><th style={{ ...th, width: 56 }}>单位</th>
                {priceSuppliers.map((s) => <th key={s} style={{ ...th, textAlign: "right" }}>{s}</th>)}
                <th style={{ ...th, textAlign: "right" }}>最低价供应商</th><th style={{ ...th, width: 130, textAlign: "right" }}>操作</th>
              </tr></thead>
              <tbody>
                {priceRows.map((r, i) => (
                  <tr key={r.key} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ ...td, color: "var(--ink-faint)", ...mono }}>{i + 1}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      {r.names > 1 && <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>含 {r.names} 种写法</div>}
                    </td>
                    <td style={{ ...td, color: "var(--ink-soft)" }}>{r.unit}</td>
                    {priceSuppliers.map((s) => {
                      const cell = r.by[s]; const low = r.lowest === s;
                      return <td key={s} style={{ ...td, textAlign: "right", ...mono, color: low ? "var(--ok)" : cell ? "var(--ink)" : "var(--ink-faint)", fontWeight: low ? 700 : 400 }}>{cell ? fmt(cell) + (low ? " ✓" : "") : "—"}</td>;
                    })}
                    <td style={{ ...td, textAlign: "right", color: "var(--ok)", fontWeight: 600 }}>{r.lowest}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                        {r.names > 1 && <Button size="sm" onClick={() => UI().toast("拆分「" + r.name + "」的 " + r.names + " 种写法")}>拆分</Button>}
                        <Button size="sm" onClick={() => UI().confirm({ title: "排除材料", message: "将「" + r.name + "」移出最低价对比？", confirmText: "排除", onConfirm: () => UI().toast("已排除") })}>排除</Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    );

    // —— 视图 ③：价格趋势 ——
    const renderTrend = () => {
      const series = TREND[trendMat] || {};
      const sups = Object.keys(series);
      const all = sups.reduce((a, s) => a.concat(series[s].map((p) => p[1])), []);
      const min = Math.min.apply(null, all), max = Math.max.apply(null, all);
      const months = series[sups[0]].map((p) => p[0]);
      const X = (i, n) => 40 + i * (560 / Math.max(1, n - 1));
      const Y = (v) => (max === min ? 80 : 20 + (max - v) / (max - min) * 120);
      const COLORS = ["var(--brand)", "var(--warn)", "var(--ok)"];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Panel padding={12} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <KA.SelectFilter label="材料" value={trendMat} minWidth={200}
              options={Object.keys(TREND).map((k) => ({ key: k, label: k }))} onChange={setTrendMat} />
            <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>价格点=当月送货单/到货明细加权均价；缺月不连线。</span>
          </Panel>
          <Panel padding={16}>
            <svg viewBox="0 0 620 170" style={{ width: "100%", maxWidth: 720, display: "block" }} role="img" aria-label={trendMat + " 价格趋势折线"}>
              {[0, 1, 2, 3].map((i) => <line key={i} x1={40} x2={600} y1={20 + i * 40} y2={20 + i * 40} stroke="var(--line)" strokeWidth={1} />)}
              <text x={4} y={24} fontSize={10} fill="var(--ink-faint)">{max}</text>
              <text x={4} y={144} fontSize={10} fill="var(--ink-faint)">{min}</text>
              {sups.map((s, si) => (
                <g key={s}>
                  <polyline fill="none" stroke={COLORS[si % 3]} strokeWidth={2}
                    points={series[s].map((p, i) => X(i, series[s].length) + "," + Y(p[1])).join(" ")} />
                  {series[s].map((p, i) => <circle key={i} cx={X(i, series[s].length)} cy={Y(p[1])} r={3} fill={COLORS[si % 3]} />)}
                </g>
              ))}
              {months.map((m, i) => <text key={m} x={X(i, months.length)} y={165} fontSize={10} textAnchor="middle" fill="var(--ink-faint)">{m.slice(5)}月</text>)}
            </svg>
            <div style={{ display: "flex", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
              {sups.map((s, si) => (
                <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-soft)" }}>
                  <span style={{ width: 10, height: 3, background: COLORS[si % 3], display: "inline-block" }} />{s}
                </span>
              ))}
            </div>
          </Panel>
          <Panel padding={0} style={{ overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse" }}>
                <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <th style={th}>供应商</th>
                  {months.map((m) => <th key={m} style={{ ...th, textAlign: "right" }}>{m.slice(5)}月</th>)}
                  <th style={{ ...th, textAlign: "right" }}>环比</th>
                </tr></thead>
                <tbody>
                  {sups.map((s) => {
                    const pts = series[s];
                    const last = pts[pts.length - 1][1], prev = pts.length > 1 ? pts[pts.length - 2][1] : last;
                    const delta = last - prev;
                    return (
                      <tr key={s} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ ...td, fontWeight: 600 }}>{s}</td>
                        {months.map((m) => {
                          const p = pts.find((x) => x[0] === m);
                          return <td key={m} style={{ ...td, textAlign: "right", ...mono }}>{p ? p[1] : "—"}</td>;
                        })}
                        <td style={{ ...td, textAlign: "right", ...mono, fontWeight: 700, color: delta > 0 ? "var(--danger)" : delta < 0 ? "var(--ok)" : "var(--ink-soft)" }}>
                          {delta === 0 ? "持平" : (delta > 0 ? "↑ +" : "↓ ") + delta}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      );
    };

    // —— 视图 ④：项目汇总 ——
    const projRows = proj ? PROJ_ROWS.filter((r) => r.project === proj) : PROJ_ROWS;
    const renderProject = () => (
      <Panel padding={0} style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
            <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>
              <th style={{ ...th, width: 40 }}>#</th><th style={th}>项目</th><th style={th}>材料类目</th>
              <th style={{ ...th, textAlign: "right" }}>采购额</th><th style={{ ...th, textAlign: "right" }}>均价</th><th style={{ ...th, textAlign: "right", width: 90 }}>单据数</th>
            </tr></thead>
            <tbody>
              {projRows.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ ...td, color: "var(--ink-faint)", ...mono }}>{i + 1}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{r.project}</td>
                  <td style={td}>{r.cat}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button type="button" onClick={() => nav && nav("deliveryArchive", {})}
                      style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono)" }}>{yuan(r.amount)}</button>
                  </td>
                  <td style={{ ...td, textAlign: "right", ...mono }}>{yuan(r.avg)}</td>
                  <td style={{ ...td, textAlign: "right", ...mono }}>{r.docs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)", padding: "8px 16px", textAlign: "right", fontSize: 12, color: "var(--ink-soft)" }}>
          共 {projRows.length} 条 · 采购额合计 <b style={{ marginLeft: 4, fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{yuan(projRows.reduce((s, r) => s + r.amount, 0))}</b>
        </div>
      </Panel>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <Panel padding={0} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 16px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>材料价格分析</div>
            <div style={{ marginTop: 2, fontSize: 11, color: "var(--ink-faint)" }}>送货单识别沉淀的单价数据 · 价差 / 比价 / 趋势 / 项目四维分析</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {view === "project" && <KA.SelectFilter label="项目" value={proj} minWidth={150}
              options={[{ key: "", label: "全部项目" }].concat(PROJ_ROWS.map((r) => r.project).filter((p, i, a) => a.indexOf(p) === i).map((p) => ({ key: p, label: p })))} onChange={setProj} />}
            {/* 独立报价入口（Q-A02-03）：报价清单为独立屏 quotation，不在本屏内维护报价 */}
            <Button icon="file-text" onClick={() => nav && nav("quotation", {})}>报价清单</Button>
            <Button icon="download" onClick={() => UI().toast("正在导出当前视图 Excel…")}>导出 Excel</Button>
          </div>
        </Panel>
        <KA.SegTab active={view} onChange={setView} tabs={[
          { key: "diff", label: "价差对比" }, { key: "compare", label: "供应商比价" },
          { key: "trend", label: "价格趋势" }, { key: "project", label: "项目汇总" },
        ]} />
        {view === "diff" ? renderDiff() : view === "compare" ? renderCompare() : view === "trend" ? renderTrend() : renderProject()}
      </div>
    );
  }

  PriceScreen.__v2 = true;
  window.PriceScreen = PriceScreen;
})();
