// PriceScreen — 单价对比：工具栏 + 已剔除折叠 + 横向对比表（最低价绿色 ✓）。
(function () {
  const { Button, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
  const th = { padding: "10px 12px", fontSize: 12, fontWeight: 800, color: "var(--ink-soft)", background: "var(--surface-2)", textAlign: "left", position: "sticky", top: 0 };
  const td = { padding: "10px 12px", fontSize: 13, verticalAlign: "middle" };

  function PriceScreen({ data }) {
    const { priceSuppliers, priceRows } = data;
    const fmt = (c) => (c.min === c.max ? "" + c.recent : `${c.recent}（${c.min}~${c.max}）`);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Panel padding={12} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>材料单价对比</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>对比各分供方材料单价，绿色为最低价</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select onChange={() => UI().toast("已切换工地")} style={{ width: 160, border: "1px solid var(--line-strong)", borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "#fff" }}>
              <option>全部工地（汇总）</option><option>合和新城</option><option>锦绣华庭</option>
            </select>
            <Button onClick={() => UI().toast("已并组所选材料")}>并组所选</Button>
            <Button icon="download" onClick={() => UI().toast("正在下载导入模板…")}>下载模板</Button>
            <Button icon="upload" onClick={() => UI().toast("正在导入历史价格…")}>导入历史</Button>
            <Button icon="download" onClick={() => UI().toast("正在导出对比表 Excel…")}>导出 Excel</Button>
          </div>
        </Panel>

        <Panel padding={10}>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--ink-soft)" }}>已从对比剔除 3 类（运费类等不参与最低价对比；送货单明细 / 导出仍保留）</summary>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {[["运费", 3], ["搬运费", 1], ["上楼费", 2]].map(([n, c]) => (
                <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--line)", background: "#fff", borderRadius: 999, padding: "3px 10px", fontSize: 12 }}>
                  {n}<span style={{ color: "var(--ink-soft)" }}>×{c}</span><button onClick={() => UI().toast("已恢复「" + n + "」参与对比")} style={{ border: 0, background: "transparent", color: "var(--brand)", cursor: "pointer", fontSize: 12, padding: 0 }}>恢复</button>
                </span>
              ))}
            </div>
          </details>
        </Panel>

        <Panel padding={8}>
          <div style={{ overflow: "auto", maxHeight: 540 }}>
            <table style={{ width: "100%", minWidth: 820, borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={{ ...th, width: 40 }}><input type="checkbox" /></th>
                <th style={{ ...th, width: 36 }}>#</th>
                <th style={th}>材料（归组）</th>
                <th style={{ ...th, width: 56 }}>单位</th>
                {priceSuppliers.map((s) => <th key={s} style={{ ...th, textAlign: "right" }}>{s}</th>)}
                <th style={{ ...th, textAlign: "right" }}>最低价供应商</th>
                <th style={{ ...th, width: 120, textAlign: "right" }}>操作</th>
              </tr></thead>
              <tbody>
                {priceRows.map((r, i) => (
                  <tr key={r.key} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={td}><input type="checkbox" /></td>
                    <td style={{ ...td, color: "var(--ink-soft)" }}>{i + 1}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      {r.names > 1 && <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>含 {r.names} 种写法</div>}
                    </td>
                    <td style={{ ...td, color: "var(--ink-soft)" }}>{r.unit}</td>
                    {priceSuppliers.map((s) => {
                      const cell = r.by[s];
                      const low = r.lowest === s;
                      return <td key={s} style={{ ...td, textAlign: "right", fontFamily: "var(--font-mono)", color: low ? "var(--ok)" : cell ? "var(--ink)" : "var(--ink-faint)", fontWeight: low ? 700 : 400 }}>{cell ? fmt(cell) + (low ? " ✓" : "") : "—"}</td>;
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
  }
  window.PriceScreen = PriceScreen;
})();
