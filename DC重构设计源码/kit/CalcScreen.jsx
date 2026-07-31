// CalcScreen — 开票因子测算（按实现端 app/pages/finance/invoice/factor.vue 及
// app/components/finance/invoice/factor/ 三个组件校准）。
// 两件事装在一张卡里：上半「精确加法组合」——给定目标值，穷举恰好等于它的因子×数量组合；
// 下半「税额计算」——含税金额 + 税率 → 不含税/税额/大写，全部按分计算。
// 原「目标金额 ÷ 单价 = 推算数量」的因子推算已不是实现端的算法，整块替换。
(function () {
  const { Button, Panel, Icon, IconButton } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {} };

  const MAX_RESULTS = 5000;      // 实现端 FACTOR_SOLVER_MAX_RESULTS
  const TIME_LIMIT_MS = 10000;   // 实现端 FACTOR_SOLVER_TIME_LIMIT_MS

  // 视口断点：卡片三段与左右分栏取 xl(1280)，输入排布取 md(768)，筛选两列取 sm(640)。
  const useVw = () => {
    const [vw, setVw] = React.useState(window.innerWidth);
    React.useEffect(() => {
      const onR = () => setVw(window.innerWidth);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }, []);
    return vw;
  };

  // ===== 金额与大写（全部按「分」整数运算，避免浮点误差）=====
  const toFen = (yuan) => Math.round(Number(yuan) * 100);
  const fmtFen = (fen) => (fen / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  function moneyToChinese(amount) {
    if (!amount && amount !== 0) return "";
    const digit = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
    const intUnit = ["", "拾", "佰", "仟"];
    const bigUnit = ["", "万", "亿"];
    const neg = amount < 0;
    const total = Math.round(Math.abs(amount) * 100);
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

  const copy = (text) => {
    if (navigator.clipboard) navigator.clipboard.writeText(String(text)).catch(() => {});
    UI().toast("已复制", "ok");
  };

  // ===== 精确加法组合求解 =====
  // 只返回「恰好等于目标值」的组合：全程按分整数搜索，不做四舍五入近似。
  // 小数数量只允许落在「单价 × 数量 恰为整分」的格点上（步长由单价的分值与 100 的最大公约数决定）。
  function solve(factors, targetFen, opts) {
    const t0 = performance.now();
    const maxResults = Math.min(MAX_RESULTS, Math.max(1, opts.maxResults || 100));
    const list = factors.map((f) => {
      const valueFen = toFen(f.value);
      const stepUnits = f.allowDecimal ? 100 / gcd(valueFen, 100) : 100; // 数量的最小步长（单位：1/100）
      return { id: f.id, valueFen, value: Number(f.value), allowDecimal: f.allowDecimal, stepUnits,
        stepFen: valueFen * stepUnits / 100,
        maxSteps: f.maxQuantity == null ? Infinity : Math.floor(Number(f.maxQuantity) * 100 / stepUnits) };
    }).sort((a, b) => b.stepFen - a.stepFen);

    // 可达性剪枝的 DP 规模（实现端按表格 cell 数分 u8 / bit / light 三挡，UI 只区分 light 与否）
    const cells = list.length * (targetFen + 1);
    const mode = cells <= 64e6 ? "u8" : cells <= 2.4e9 ? "bit" : "light";

    const solutions = [];
    let timeUp = false, totalCount = 0, countable = true;
    const pick = [];
    const dfs = (i, rest) => {
      if (timeUp) return;
      if (performance.now() - t0 > TIME_LIMIT_MS) { timeUp = true; return; }
      if (rest === 0) {
        totalCount++;
        if (solutions.length < maxResults) solutions.push(pick.filter((p) => p.steps > 0).map((p) => ({
          factorId: p.f.id, factorValue: p.f.value, allowDecimal: p.f.allowDecimal,
          quantity: p.steps * p.f.stepUnits / 100, amount: p.steps * p.f.stepFen,
        })));
        return;
      }
      if (i >= list.length) return;
      const f = list[i];
      const cap = Math.min(f.maxSteps, Math.floor(rest / f.stepFen));
      for (let n = cap; n >= 0; n--) {
        pick.push({ f, steps: n });
        dfs(i + 1, rest - n * f.stepFen);
        pick.pop();
        if (timeUp) return;
      }
    };

    const include = opts.includeFactor == null ? null : Number(opts.includeFactor);
    const exclude = opts.excludeFactor == null ? null : Number(opts.excludeFactor);
    if (include != null && !list.some((f) => f.value === include)) {
      return { solutions: [], totalCount: 0, truncated: false, timeUp: false, note: "“必须包含”的因子不在因子列表中", mode, elapsedMs: 0 };
    }
    dfs(0, targetFen);

    let out = solutions;
    if (exclude != null) out = out.filter((s) => !s.some((it) => it.factorValue === exclude));
    if (include != null) out = out.filter((s) => s.some((it) => it.factorValue === include));
    if (exclude != null || include != null) { countable = false; }
    if (timeUp) countable = false;

    return {
      solutions: out, mode, elapsedMs: Math.round(performance.now() - t0),
      totalCount: countable ? totalCount : null,
      truncated: countable ? totalCount > out.length : solutions.length >= maxResults,
      timeUp, note: "",
    };
  }

  const fmtFactor = (v) => String(v.toFixed(2).replace(/\.?0+$/, ""));
  const fmtQty = (q) => (Number.isInteger(q) ? String(q) : String(Number(q.toFixed(2))));
  const fmtPart = (it) => fmtFactor(it.factorValue) + "×" + fmtQty(it.quantity) + (it.allowDecimal && !Number.isInteger(it.quantity) ? "(=" + (it.amount / 100).toFixed(2) + ")" : "");
  const expr = (s) => s.map(fmtPart).join(" + ");

  // ===== 界面 =====
  const inp = { width: "100%", boxSizing: "border-box", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", background: "#fff", padding: "7px 10px", fontSize: 13, outline: "none" };
  const mono = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
  const label = { display: "block", marginBottom: 3, fontSize: 11, fontWeight: 600, color: "var(--ink-soft)" };
  const linkBtn = { border: 0, background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", color: "var(--brand)" };

  function CalcScreen() {
    const vw = useVw();
    const wide = vw >= 1280;   // xl
    const md = vw >= 768;
    const sm = vw >= 640;

    const [target, setTarget] = React.useState(10);
    const [maxResults, setMaxResults] = React.useState(100);
    const [factors, setFactors] = React.useState([
      { id: 1, value: 2, maxQuantity: null, allowDecimal: false },
      { id: 2, value: 4, maxQuantity: 5, allowDecimal: false },
    ]);
    const [include, setInclude] = React.useState("");
    const [exclude, setExclude] = React.useState("");
    const [result, setResult] = React.useState(null);
    const [status, setStatus] = React.useState("配置目标值和因子后开始计算");
    const [mask, setMask] = React.useState(null); // { ms }

    const addFactor = () => setFactors((l) => [...l, { id: l.reduce((m, f) => Math.max(m, f.id), 0) + 1, value: null, maxQuantity: null, allowDecimal: false }]);
    const removeFactor = (id) => setFactors((l) => l.filter((f) => f.id !== id));
    const patchFactor = (id, k, v) => setFactors((l) => l.map((f) => (f.id === id ? { ...f, [k]: v } : f)));

    const run = React.useCallback((tgt, fs, inc, exc, cap) => {
      const t = Number(tgt);
      if (!Number.isFinite(t) || t <= 0) { setStatus("请输入有效的目标值"); setResult(null); return; }
      const valid = fs.filter((f) => Number.isFinite(Number(f.value)) && Number(f.value) > 0);
      if (!valid.length) { setStatus("请至少添加一个有效因子"); setResult(null); return; }
      const t0 = performance.now();
      const r = solve(valid, toFen(t), {
        maxResults: cap,
        includeFactor: inc === "" || inc == null ? null : Number(inc),
        excludeFactor: exc === "" || exc == null ? null : Number(exc),
      });
      // 实现端把求解放 Worker，>150ms 才浮出遮罩；设计稿同步求解，按实测耗时补一帧遮罩示意
      if (performance.now() - t0 > 150) { setMask({ ms: r.elapsedMs }); setTimeout(() => setMask(null), 260); }
      setResult(r); setStatus("");
    }, []);

    const calculate = () => run(target, factors, include, exclude, maxResults);
    // 筛选条件变化后自动重算（实现端 300ms 防抖）
    React.useEffect(() => {
      if (!result) return;
      const t = setTimeout(() => run(target, factors, include, exclude, maxResults), 300);
      return () => clearTimeout(t);
    }, [include, exclude]);

    const summary = (() => {
      if (!result || status) return status;
      const shown = result.solutions.length;
      if (result.note) return result.note + "，用时 " + result.elapsedMs + " ms";
      if (result.timeUp) return "超过 " + TIME_LIMIT_MS / 1000 + " 秒时限已中止，找到 " + shown + " 条（可能不完整），用时 " + result.elapsedMs + " ms";
      if (result.totalCount != null) {
        const c = result.totalCount.toLocaleString("zh-CN");
        return result.totalCount > shown ? "共 " + c + " 条解，已展示前 " + shown + " 条，用时 " + result.elapsedMs + " ms"
          : "共 " + c + " 条解，用时 " + result.elapsedMs + " ms";
      }
      return result.truncated ? "已找到 " + shown + " 条（达到返回上限，总数未统计），用时 " + result.elapsedMs + " ms"
        : "共 " + shown + " 条解（总数未统计），用时 " + result.elapsedMs + " ms";
    })();

    const splitCols = wide ? "360px minmax(0, 1fr)" : "minmax(0, 1fr)";
    const th = { height: 40, padding: "0 6px", fontSize: 13, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left" };
    const td = { height: 40, padding: "0 6px", fontSize: 14 };

    return (
      <div style={{ position: "relative", overflow: "hidden", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", background: "var(--panel)", boxShadow: "var(--shadow-card)",
        display: wide ? "grid" : "block", gridTemplateRows: wide ? "auto minmax(0, 1fr) auto" : null,
        // 实现端整卡 h-full 撑满 h-svh 外壳；设计稿外壳是普通滚动页，用同族 clamp 给等价高度
        blockSize: wide ? "clamp(28rem, 76dvh, 56rem)" : "auto" }}>

        {/* 头部：标题 + 目标值 / 返回解数量 / 开始计算 */}
        <header style={{ display: "grid", gridTemplateColumns: splitCols, borderBottom: "1px solid var(--line)" }}>
          <div style={{ alignSelf: "center", padding: 16 }}>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>精确加法组合</h1>
            <p style={{ margin: "4px 0 0", maxWidth: "42ch", fontSize: 11, lineHeight: 1.5, color: "var(--ink-faint)" }}>金额按分精确计算，仅返回恰好等于目标值的组合</p>
          </div>
          <div style={{ display: "grid", alignItems: "end", gap: 12, padding: 16,
            gridTemplateColumns: md ? "minmax(220px, 1fr) 140px 160px" : "minmax(0, 1fr)",
            borderTop: wide ? 0 : "1px solid var(--line)", borderLeft: wide ? "1px solid var(--line)" : 0 }}>
            <div>
              <label htmlFor="factor-target" style={label}>目标值</label>
              <input id="factor-target" type="number" min="0" step="any" value={target} placeholder="请输入目标值"
                onChange={(e) => setTarget(e.target.value)} style={{ ...inp, ...mono, fontSize: 16, fontWeight: 700 }} />
            </div>
            <div>
              <label htmlFor="factor-max" style={label}>返回解数量</label>
              <input id="factor-max" type="number" min="1" max="5000" value={maxResults} placeholder="默认 100"
                onChange={(e) => setMaxResults(e.target.value)} style={{ ...inp, ...mono }} />
            </div>
            <Button variant="primary" icon="calculator" disabled={!factors.length} onClick={calculate} style={{ width: "100%", height: 34 }}>开始计算</Button>
          </div>
        </header>

        {/* 主体：因子配置 | 精确组合结果 */}
        <div style={{ display: "grid", gridTemplateColumns: splitCols, minHeight: 0, overflow: wide ? "hidden" : "visible" }}>
          {/* 左：因子配置 */}
          <section style={{ minWidth: 0, padding: 16, minHeight: wide ? 0 : null, overflowY: wide ? "auto" : "visible", borderRight: wide ? "1px solid var(--line)" : 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>因子配置</h2>
                <p style={{ margin: "2px 0 0", fontSize: 10, lineHeight: 1.5, color: "var(--ink-faint)" }}>小数数量仅生成单价乘数量恰为整分的组合</p>
              </div>
              <Button size="sm" icon="plus" onClick={addFactor}>添加因子</Button>
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-btn)", overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(86px,1fr) 106px 46px 28px", alignItems: "center", gap: 6, padding: "8px 10px", background: "var(--surface-2)", fontSize: 10, fontWeight: 700, color: "var(--ink-faint)" }}>
                <span>因子值</span><span style={{ textAlign: "right" }}>最大次数/数量</span><span style={{ textAlign: "center" }}>小数</span><span />
              </div>
              {factors.map((f) => (
                <div key={f.id} style={{ display: "grid", gridTemplateColumns: "minmax(86px,1fr) 106px 46px 28px", alignItems: "center", gap: 6, padding: "8px 10px", borderTop: "1px solid var(--line)" }}>
                  <input type="number" min="0" step="any" aria-label={"因子 " + f.id + " 的数值"} placeholder="数值"
                    value={f.value == null ? "" : f.value} onChange={(e) => patchFactor(f.id, "value", e.target.value === "" ? null : Number(e.target.value))}
                    style={{ ...inp, ...mono, padding: "4px 8px", fontSize: 12, minWidth: 0 }} />
                  <input type="number" min="0" step="any" aria-label={"因子 " + f.id + " 的最大数量"} placeholder="不限"
                    value={f.maxQuantity == null ? "" : f.maxQuantity} onChange={(e) => patchFactor(f.id, "maxQuantity", e.target.value === "" ? null : Number(e.target.value))}
                    style={{ ...inp, ...mono, padding: "4px 8px", fontSize: 12, textAlign: "right", minWidth: 0 }} />
                  <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 11, color: "var(--ink-soft)", cursor: "pointer" }}>
                    <input type="checkbox" checked={f.allowDecimal} onChange={(e) => patchFactor(f.id, "allowDecimal", e.target.checked)} style={{ accentColor: "var(--brand)" }} />
                    <span>是</span>
                  </label>
                  <IconButton icon="x" tone="danger" title={"删除因子 " + f.id} onClick={() => removeFactor(f.id)} />
                </div>
              ))}
              {!factors.length && <div style={{ padding: "32px 12px", textAlign: "center", fontSize: 12, color: "var(--ink-faint)" }}>暂无因子，点击“添加因子”开始配置</div>}
            </div>
          </section>

          {/* 右：精确组合结果 */}
          <section style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: wide ? 0 : null }}>
            <div style={{ flex: "none", padding: 16, borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>精确组合结果</h2>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>筛选条件变化后自动重算，保证展示结果完整准确</p>
                </div>
                {result && result.mode && <span style={{ flex: "none", fontSize: 11, fontWeight: 600, color: "var(--ink-faint)" }}>{result.mode === "light" ? "轻量搜索" : "可达性剪枝"}</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: sm ? "1fr 1fr" : "1fr", gap: 8 }}>
                <div>
                  <label htmlFor="factor-include" style={label}>必须包含因子</label>
                  <input id="factor-include" type="number" step="any" placeholder="例如 4" value={include} onChange={(e) => setInclude(e.target.value)} style={{ ...inp, ...mono }} />
                </div>
                <div>
                  <label htmlFor="factor-exclude" style={label}>排除因子</label>
                  <input id="factor-exclude" type="number" step="any" placeholder="例如 2" value={exclude} onChange={(e) => setExclude(e.target.value)} style={{ ...inp, ...mono }} />
                </div>
              </div>
              <div aria-live="polite" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, borderRadius: "var(--radius-btn)", background: "var(--surface-2)", padding: "8px 12px", fontSize: 12, color: "var(--ink-soft)" }}>
                <Icon name="info" size={13} color="var(--brand)" />
                <span>{summary}</span>
              </div>
            </div>

            {result && result.solutions.length ? (
              <div style={{ flex: wide ? 1 : "none", minHeight: 0, maxHeight: wide ? "none" : 520, overflow: "auto" }}>
                <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse" }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--surface-2)" }}>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      <th style={{ ...th, width: 56 }}>#</th>
                      <th style={th}>表达式（点击复制）</th>
                      <th style={th}>使用项（单项可点）</th>
                      <th style={{ ...th, width: 80, textAlign: "right" }}>总数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.solutions.map((s, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ ...td, color: "var(--ink-faint)" }}>{i + 1}</td>
                        <td style={td}>
                          <button type="button" title="复制整条表达式" onClick={() => copy(expr(s))} style={{ ...linkBtn, ...mono, fontWeight: 700 }}>{expr(s)}</button>
                        </td>
                        <td style={td}>
                          <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px" }}>
                            {s.map((it) => (
                              <button key={it.factorId + "-" + it.quantity} type="button" title="复制该使用项" onClick={() => copy(fmtPart(it))} style={{ ...linkBtn, ...mono, color: "var(--ink-soft)" }}>{fmtPart(it)}</button>
                            ))}
                          </span>
                        </td>
                        <td style={{ ...td, ...mono, textAlign: "right", fontWeight: 700 }}>{fmtQty(s.reduce((n, it) => n + it.quantity, 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ flex: 1, display: "grid", placeItems: "center", minHeight: 256, padding: 32, textAlign: "center" }}>
                <div>
                  <Icon name="sigma" size={32} color="var(--ink-faint)" />
                  <p style={{ margin: "8px 0 0", fontSize: 13, fontWeight: 600, color: "var(--ink-soft)" }}>暂无组合结果</p>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>配置目标值和因子后点击“开始计算”</p>
                </div>
              </div>
            )}
          </section>
        </div>

        <TaxCalculator wide={wide} md={md} splitCols={splitCols} />

        {mask && (
          <div role="status" aria-live="polite" style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.88)", backdropFilter: "blur(2px)" }}>
            <div style={{ width: 256, padding: 24, textAlign: "center", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", background: "var(--panel)", boxShadow: "var(--shadow-pop)" }}>
              <Icon name="hourglass" size={28} color="var(--brand)" />
              <div style={{ marginTop: 8, fontSize: 14, fontWeight: 700 }}>计算中…</div>
              <div style={{ marginTop: 4, fontSize: 12, ...mono, color: "var(--ink-faint)" }}>{mask.ms} ms</div>
              <Button onClick={() => setMask(null)} style={{ marginTop: 16, padding: "0 24px" }}>取消</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // —— 税额计算（含税金额 + 税率 → 不含税 / 税额 / 大写，按分计算并自动勾稽）——
  function TaxCalculator({ wide, md, splitCols }) {
    const [total, setTotal] = React.useState("");
    const [rate, setRate] = React.useState(13);
    const [res, setRes] = React.useState(null);
    const [err, setErr] = React.useState("");

    const calc = () => {
      const totalFen = total === "" ? null : toFen(total);
      const r = Number(rate);
      if (totalFen == null || !Number.isFinite(totalFen) || totalFen < 0) { setErr("请输入有效的含税金额"); setRes(null); return; }
      if (!Number.isInteger(r) || r < 1 || r > 13) { setErr("税率请输入 1-13 的正整数"); setRes(null); return; }
      const noTaxFen = Math.round(totalFen / (1 + r / 100));
      setRes({ totalFen, noTaxFen, taxFen: totalFen - noTaxFen });
      setErr("");
    };

    const cellBtnMoney = { ...linkBtn, ...mono, display: "block", marginTop: 4, fontSize: 14, fontWeight: 700 };
    const cellBtnCn = { ...linkBtn, display: "block", marginTop: 4, width: "100%", fontSize: 12, lineHeight: 1.5, color: "var(--ink-soft)", overflowWrap: "anywhere" };
    const cell = (title, fen, borderRight, borderTop) => (
      <div key={title} style={{ minWidth: 0, padding: "12px 16px", borderRight: borderRight ? "1px solid var(--line)" : 0, borderTop: borderTop ? "1px solid var(--line)" : 0 }}>
        <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--ink-faint)" }}>{title}</span>
        <button type="button" onClick={() => copy((fen / 100).toFixed(2))} style={cellBtnMoney}>{fmtFen(fen)}</button>
        <button type="button" onClick={() => copy(moneyToChinese(fen / 100))} style={cellBtnCn}>{moneyToChinese(fen / 100)}</button>
      </div>
    );

    return (
      <section style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
        <div style={{ display: "grid", gridTemplateColumns: splitCols }}>
          <div style={{ alignSelf: "center", padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="receipt-text" size={15} color="var(--brand)" />
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>税额计算</h2>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--ink-faint)" }}>金额按分计算，结果自动勾稽</p>
          </div>
          <div style={{ display: "grid", alignItems: "end", gap: 12, padding: "12px 16px",
            gridTemplateColumns: md ? "minmax(220px, 1fr) 104px 190px" : "minmax(0, 1fr)",
            borderTop: wide ? 0 : "1px solid var(--line)", borderLeft: wide ? "1px solid var(--line)" : 0 }}>
            <div>
              <label htmlFor="tax-total" style={label}>含税合同金额</label>
              <input id="tax-total" type="number" min="0" step="0.01" placeholder="597140.00" value={total} onChange={(e) => setTotal(e.target.value)} style={{ ...inp, ...mono }} />
            </div>
            <div>
              <label htmlFor="tax-rate" style={label}>税率（%）</label>
              <input id="tax-rate" type="number" min="1" max="13" step="1" inputMode="numeric" placeholder="13" value={rate} onChange={(e) => setRate(e.target.value === "" ? "" : Number(e.target.value))} style={{ ...inp, ...mono }} />
            </div>
            <Button variant="primary" onClick={calc} style={{ width: "100%", height: 34 }}>计算税额和不含税金额</Button>
          </div>
        </div>

        {err && <p role="alert" style={{ margin: 0, borderTop: "1px solid var(--line)", padding: "8px 16px", fontSize: 12, color: "var(--danger)" }}>{err}</p>}

        {res && (
          <div style={{ display: "grid", gridTemplateColumns: md ? "repeat(3, minmax(0,1fr))" : "minmax(0,1fr)", borderTop: "1px solid var(--line)", fontSize: 12 }}>
            {cell("不含税金额", res.noTaxFen, md, false)}
            {cell("税额", res.taxFen, md, !md)}
            {cell("含税金额", res.totalFen, false, !md)}
            <div style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--line)", padding: "8px 16px", fontSize: 10, ...mono, color: "var(--ink-faint)" }}>
              校验：{fmtFen(res.noTaxFen)} + {fmtFen(res.taxFen)} = {fmtFen(res.totalFen)}
            </div>
          </div>
        )}
      </section>
    );
  }

  window.CalcScreen = CalcScreen;
})();
