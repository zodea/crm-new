// CalcScreen — 开票因子推算 + 税额计算/大写（finance-invoice.md §9）
// 风格对齐 STYLE-GUIDE：疏朗表格 + pill 税率快选 + 统一圆角；点击数值复制。
(function () {
  const { Button, Panel, Icon, StatusChip } = window.DesignSystem_e3d871;

  function moneyToChinese(amount) {
    if (!amount && amount !== 0) return "";
    const digit = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
    const intUnit = ["", "拾", "佰", "仟"];
    const bigUnit = ["", "万", "亿"];
    const neg = amount < 0;
    let total = Math.round(Math.abs(amount) * 100);
    const fen = total % 10, jiao = Math.floor(total / 10) % 10;
    let intPart = Math.floor(total / 100), intStr = "";
    if (intPart === 0) { intStr = "零"; } else {
      const groups = [];
      while (intPart > 0) { groups.push(intPart % 10000); intPart = Math.floor(intPart / 10000); }
      for (let gi = groups.length - 1; gi >= 0; gi--) {
        const g = groups[gi];
        const arr = [g % 10, Math.floor(g / 10) % 10, Math.floor(g / 100) % 10, Math.floor(g / 1000) % 10];
        let gstr = "", started = false, zeroPending = false;
        for (let pos = 3; pos >= 0; pos--) {
          const dd = arr[pos];
          if (dd === 0) { if (started) zeroPending = true; }
          else { if (zeroPending) { gstr += "零"; zeroPending = false; } gstr += digit[dd] + intUnit[pos]; started = true; }
        }
        if (gstr) intStr += gstr + bigUnit[gi]; else if (intStr && gi > 0) intStr += "零";
      }
    }
    intStr = intStr.replace(/零+/g, "零").replace(/零+$/, "");
    let result = intStr + "元";
    if (!jiao && !fen) { result += "整"; }
    else { if (jiao) result += digit[jiao] + "角"; else if (fen) result += "零"; if (fen) result += digit[fen] + "分"; else result += "整"; }
    return (neg ? "负" : "") + result;
  }

  function useCopy(val) {
    const [copied, setCopied] = React.useState(false);
    const copy = () => {
      const txt = String(val);
      if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
      else { const t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select(); document.execCommand("copy"); document.body.removeChild(t); }
      setCopied(true); setTimeout(() => setCopied(false), 1400);
    };
    return [copied, copy];
  }

  function CopyValue({ value, display, mono, large, color }) {
    const [copied, copy] = useCopy(value);
    return (
      <span onClick={copy} title="点击复制"
        style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
          fontFamily: mono ? "var(--font-mono)" : "inherit",
          fontSize: large ? 22 : 14, fontWeight: 700,
          color: copied ? "var(--ok)" : color || "var(--ink)",
          background: copied ? "var(--ok-soft)" : "transparent",
          borderRadius: 4, padding: "1px 4px", transition: "background 0.2s" }}>
        {copied ? <Icon name="check" size={13} /> : <Icon name="copy" size={13} color="var(--ink-faint)" />}
        {display || value}
      </span>
    );
  }

  function CalcScreen({ data }) {
    const [factors, setFactors] = React.useState(data.factorDefaults.map(f => ({ ...f })));
    const [target, setTarget] = React.useState("128640");
    const [taxRate, setTaxRate] = React.useState("13");
    const [results, setResults] = React.useState(null);
    const [nextId, setNextId] = React.useState(100);

    const t = parseFloat(target) || 0;
    const r = (parseFloat(taxRate) || 0) / 100;
    const exTax = t > 0 ? t / (1 + r) : 0;
    const taxAmt = t - exTax;

    const addRow = () => { setFactors(f => [...f, { id: "n" + nextId, name: "", unit: "个", price: "" }]); setNextId(n => n + 1); };
    const removeRow = id => setFactors(f => f.filter(x => x.id !== id));
    const updateRow = (id, field, val) => setFactors(f => f.map(x => x.id === id ? { ...x, [field]: val } : x));

    const calculate = () => {
      if (t <= 0) return;
      const rows = factors.filter(f => f.name && parseFloat(f.price) > 0).map(f => {
        const p = parseFloat(f.price);
        const qtyExact = t / p;
        const qtyFloor = Math.floor(qtyExact);
        const qtyCeil = Math.ceil(qtyExact);
        const isInt = Math.abs(qtyExact - Math.round(qtyExact)) < 1e-9;
        return { ...f, p, qtyExact, qtyFloor, qtyCeil, isInt,
          qtyBest: isInt ? Math.round(qtyExact) : null,
          amtFloor: qtyFloor * p, amtCeil: qtyCeil * p };
      });
      setResults(rows);
    };

    const inp = { border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", padding: "8px 11px", fontSize: 13, fontFamily: "var(--font-mono)", background: "#fff", width: "100%" };
    const TH = { padding: "12px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", position: "sticky", top: 0, whiteSpace: "nowrap" };
    const TD = { padding: "12px 14px", fontSize: 13 };
    const num = { ...TD, textAlign: "right", fontFamily: "var(--font-mono)" };
    const fmt = v => v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return (
      <div style={{ display: "grid", gridTemplateColumns: "330px 1fr", gap: 16, alignItems: "start" }}>

        {/* ── 左列 ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* 税额计算 */}
          <Panel padding={16} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)", marginBottom: -6 }}>税额计算</div>

            <div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 5 }}>目标含税金额（元）</div>
              <input style={{ ...inp, fontSize: 17, fontWeight: 700, padding: "11px 12px" }} value={target}
                onChange={e => setTarget(e.target.value)} placeholder="如 128640.00" />
            </div>

            <div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 5 }}>税率 (%)</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input style={{ ...inp, width: 80 }} value={taxRate} onChange={e => setTaxRate(e.target.value)} />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {["13", "9", "6", "3", "1"].map(v => (
                    <button key={v} onClick={() => setTaxRate(v)} style={{ border: "1px solid", borderColor: taxRate === v ? "var(--brand)" : "var(--line)", background: taxRate === v ? "var(--brand-soft)" : "#fff", color: taxRate === v ? "var(--brand-deep)" : "var(--ink-soft)", borderRadius: 999, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-mono)" }}>{v}%</button>
                  ))}
                </div>
              </div>
            </div>

            {/* 结果——点击复制 */}
            {t > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 0, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                {[
                  ["价税合计", t, t.toFixed(2)],
                  ["不含税金额", exTax, exTax.toFixed(2)],
                  ["税额", taxAmt, taxAmt.toFixed(2)],
                ].map(([label, val, raw]) => (
                  <div key={label} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{label}</span>
                      <CopyValue value={raw} display={"¥" + fmt(val)} mono large color="var(--ink)" />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                      <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>大写</span>
                      <CopyValue value={moneyToChinese(val)} display={moneyToChinese(val)} color="var(--ink-soft)" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* 因子列表 */}
          <Panel padding={0} style={{ overflow: "hidden" }}>
            <div style={{ padding: "12px 14px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>开票因子（单价）</span>
              <Button size="sm" icon="plus" onClick={addRow}>添加</Button>
            </div>
            {factors.map(f => (
              <div key={f.id} style={{ display: "grid", gridTemplateColumns: "1fr 56px 80px 28px", gap: 6, alignItems: "center", padding: "7px 10px", borderBottom: "1px solid var(--line)" }}>
                <input style={{ ...inp, padding: "6px 9px" }} placeholder="品名" value={f.name} onChange={e => updateRow(f.id, "name", e.target.value)} />
                <input style={{ ...inp, padding: "6px 7px" }} placeholder="单位" value={f.unit} onChange={e => updateRow(f.id, "unit", e.target.value)} />
                <input style={{ ...inp, padding: "6px 9px", textAlign: "right" }} placeholder="单价" value={f.price} onChange={e => updateRow(f.id, "price", e.target.value)} />
                <button onClick={() => removeRow(f.id)} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--ink-faint)", display: "grid", placeItems: "center" }}><Icon name="x" size={14} /></button>
              </div>
            ))}
            <div style={{ padding: "12px" }}>
              <Button variant="primary" icon="calculator" fullWidth onClick={calculate}>计算</Button>
            </div>
          </Panel>
        </div>

        {/* ── 右：结果表 ── */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", fontSize: 13, fontWeight: 700, color: "var(--ink-soft)", borderBottom: "1px solid var(--line)" }}>
            {results ? `推算结果 — 含税 ¥${t.toLocaleString("zh-CN")}` : "填写因子后点击「计算」"}
          </div>
          {results && (
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead><tr>
                  {["品名", "单位", "单价", "推算数量", "开票金额", "余额", ""].map((h, i) => (
                    <th key={i} style={{ ...TH, textAlign: i >= 2 ? "right" : "left" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {results.map(f => (
                    <React.Fragment key={f.id}>
                      <tr style={{ borderBottom: f.isInt ? "2px solid var(--ok)" : "1px solid var(--line)", background: f.isInt ? "var(--ok-soft)" : "transparent" }}>
                        <td style={{ ...TD, fontWeight: 600 }}>{f.name}</td>
                        <td style={TD}>{f.unit}</td>
                        <td style={{ ...num, color: "var(--ink-soft)" }}>{fmt(f.p)}</td>
                        <td style={{ ...num, fontWeight: 700, color: f.isInt ? "var(--ok-ink)" : "var(--ink)" }}>
                          {f.isInt ? f.qtyBest : f.qtyExact.toFixed(4)}
                        </td>
                        <td style={num}>
                          {f.isInt ? <span style={{ color: "var(--ok-ink)", fontWeight: 700 }}>¥{fmt(f.qtyBest * f.p)}</span> : "—"}
                        </td>
                        <td style={{ ...num, color: f.isInt ? "var(--ok-ink)" : "var(--danger)" }}>
                          {f.isInt ? "¥0.00" : "¥" + (t - f.amtFloor).toFixed(2)}
                        </td>
                        <td style={{ ...TD, textAlign: "center" }}>
                          {f.isInt ? <StatusChip tone="ok">✓ 整开</StatusChip> : <StatusChip tone="warn">非整</StatusChip>}
                        </td>
                      </tr>
                      {!f.isInt && (
                        <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
                          <td colSpan={2} style={{ padding: "6px 14px", fontSize: 12, color: "var(--ink-faint)" }}>近似方案</td>
                          <td></td>
                          <td style={{ padding: "6px 14px", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "right" }}>{f.qtyFloor} / {f.qtyCeil}</td>
                          <td style={{ padding: "6px 14px", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "right", color: "var(--ink-soft)" }}>¥{fmt(f.amtFloor)} / ¥{fmt(f.amtCeil)}</td>
                          <td style={{ padding: "6px 14px", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "right" }}>
                            <span style={{ color: "var(--danger)" }}>−{(t - f.amtFloor).toFixed(2)}</span> / <span style={{ color: "var(--warn-ink)" }}>+{(f.amtCeil - t).toFixed(2)}</span>
                          </td>
                          <td></td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {results.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: "var(--ink-faint)" }}>没有填写有效单价的因子</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {!results && (
            <div style={{ padding: 48, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>
              在左侧维护单价因子列表，填写目标含税金额后点击「计算」
            </div>
          )}
        </Panel>
      </div>
    );
  }
  window.CalcScreen = CalcScreen;
})();
