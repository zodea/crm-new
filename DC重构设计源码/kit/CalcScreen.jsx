// CalcScreen — 开票因子测算。版式沿用原设计稿：顶部税额计算单行横排（输入 + 四格结果，点格即复制），
// 下面 330px 左栏「开票因子」+ 右栏结果表。
// 算法按实现端 app/pages/finance/invoice/factor.vue 校准：不是「目标金额 ÷ 单价 = 推算数量 + 近似方案」，
// 而是精确加法组合 —— 全程按分整数搜索，只返回恰好等于目标值的组合，不给近似解。
// 顶部含税金额一值两用：既是税额计算的输入，也是组合求解的目标值（算完税额直接拿去凑组合）。
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
    const narrow = vw < 1000;   // 两栏并置下限；以下左右栏改上下叠

    // 顶部含税金额既是税额计算的输入，也是因子组合的目标值 —— 算完税额直接拿这个数去凑组合，
    // 不在两处各填一遍（这条联动是原设计稿的做法，实现端拆成了两个独立输入）。
    const [target, setTarget] = React.useState("128640");
    const [rate, setRate] = React.useState(13);
    const [maxResults, setMaxResults] = React.useState(100);
    // 默认因子取开票场景的量级（材料单价），不是教学用的 2/4——那样解的数量级会大到没有参考价值
    const [factors, setFactors] = React.useState([
      { id: 1, value: 640, maxQuantity: null, allowDecimal: false },
      { id: 2, value: 960, maxQuantity: null, allowDecimal: false },
    ]);
    const [include, setInclude] = React.useState("");
    const [exclude, setExclude] = React.useState("");
    const [result, setResult] = React.useState(null);
    const [status, setStatus] = React.useState("填写因子后点击「计算」");

    // —— 税额：全部按分整数运算，不含税 + 税额 == 含税 恒成立 ——
    const totalFen = target === "" ? null : toFen(target);
    const rateOk = Number.isInteger(Number(rate)) && Number(rate) >= 1 && Number(rate) <= 13;
    const tax = totalFen != null && totalFen > 0 && rateOk
      ? (() => { const noTax = Math.round(totalFen / (1 + Number(rate) / 100)); return { totalFen, noTaxFen: noTax, taxFen: totalFen - noTax }; })()
      : null;

    const addFactor = () => setFactors((l) => [...l, { id: l.reduce((m, f) => Math.max(m, f.id), 0) + 1, value: null, maxQuantity: null, allowDecimal: false }]);
    const removeFactor = (id) => setFactors((l) => l.filter((f) => f.id !== id));
    const patchFactor = (id, k, v) => setFactors((l) => l.map((f) => (f.id === id ? { ...f, [k]: v } : f)));

    const run = React.useCallback((tgt, fs, inc, exc, cap) => {
      const t = Number(tgt);
      if (!Number.isFinite(t) || t <= 0) { setStatus("请输入有效的目标值"); setResult(null); return; }
      const valid = fs.filter((f) => Number.isFinite(Number(f.value)) && Number(f.value) > 0);
      if (!valid.length) { setStatus("请至少添加一个有效因子"); setResult(null); return; }
      setResult(solve(valid, toFen(t), {
        maxResults: cap,
        includeFactor: inc === "" || inc == null ? null : Number(inc),
        excludeFactor: exc === "" || exc == null ? null : Number(exc),
      }));
      setStatus("");
    }, []);
    const calculate = () => run(target, factors, include, exclude, maxResults);
    // 必须包含 / 排除因子改动后自动重算（已算过才重算，避免首屏空跑）
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

    // 顶排结果格：点格即复制
    const cell = (label, raw, display) => (
      <div key={label} onClick={() => { copy(raw); }} title="点击复制"
        style={{ flex: 1, minWidth: 0, padding: "6px 14px", borderLeft: "1px solid var(--line)", cursor: "copy" }}>
        <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{label}</div>
        <div style={{ marginTop: 2, fontSize: label === "大写" ? 12.5 : 15, fontWeight: 700, fontFamily: label === "大写" ? "inherit" : "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--ink)" }}>{display}</div>
      </div>
    );

    const TH = { padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", position: "sticky", top: 0, whiteSpace: "nowrap", textAlign: "left" };
    const TD = { padding: "10px 12px", fontSize: 13, verticalAlign: "middle" };
    const miniInp = { ...inp, padding: "6px 9px", fontSize: 12.5, ...mono };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* 税额计算 —— 单行横排：输入 + 四格结果，点任一格即复制 */}
        <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingRight: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 800, flex: "none" }}>税额计算</span>
            <input aria-label="含税金额" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="含税金额"
              style={{ ...inp, ...mono, width: 150, fontSize: 15, fontWeight: 700 }} />
            <label style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 12, color: "var(--ink-soft)", flex: "none" }}>税率%</span>
              <input aria-label="税率" type="number" min="1" max="13" step="1" value={rate} onChange={(e) => setRate(e.target.value === "" ? "" : Number(e.target.value))} placeholder="13"
                style={{ ...inp, ...mono, width: 56, textAlign: "center", borderColor: rateOk ? "var(--line-strong)" : "var(--danger)" }} />
            </label>
          </div>
          {tax
            ? [cell("价税合计", (tax.totalFen / 100).toFixed(2), "¥" + fmtFen(tax.totalFen)),
               cell("不含税金额", (tax.noTaxFen / 100).toFixed(2), "¥" + fmtFen(tax.noTaxFen)),
               cell("税额", (tax.taxFen / 100).toFixed(2), "¥" + fmtFen(tax.taxFen)),
               cell("大写", moneyToChinese(tax.totalFen / 100), moneyToChinese(tax.totalFen / 100))]
            : <div style={{ flex: 1, minWidth: 200, padding: "6px 14px", borderLeft: "1px solid var(--line)", fontSize: 12, color: rateOk ? "var(--ink-faint)" : "var(--danger)" }}>
                {rateOk ? "输入含税金额后，此排显示 价税合计 / 不含税 / 税额 / 大写，点击任一格即复制" : "税率请输入 1-13 的正整数"}
              </div>}
        </Panel>

        <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr)" : "330px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>

          {/* ── 左：开票因子 + 求解参数 ── */}
          <Panel padding={0} style={{ overflow: "hidden" }}>
            <div style={{ padding: "12px 14px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>开票因子（单价）</span>
              <Button size="sm" icon="plus" onClick={addFactor}>添加</Button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 40px 26px", gap: 6, alignItems: "center", padding: "7px 10px", background: "var(--surface-2)", fontSize: 10.5, fontWeight: 700, color: "var(--ink-faint)" }}>
              <span>因子值</span><span style={{ textAlign: "right" }}>最大次数</span><span style={{ textAlign: "center" }}>小数</span><span />
            </div>
            {factors.map((f) => (
              <div key={f.id} style={{ display: "grid", gridTemplateColumns: "1fr 72px 40px 26px", gap: 6, alignItems: "center", padding: "7px 10px", borderTop: "1px solid var(--line)" }}>
                <input type="number" min="0" step="any" aria-label={"因子 " + f.id + " 的数值"} placeholder="单价"
                  value={f.value == null ? "" : f.value} onChange={(e) => patchFactor(f.id, "value", e.target.value === "" ? null : Number(e.target.value))}
                  style={{ ...miniInp, minWidth: 0 }} />
                <input type="number" min="0" step="any" aria-label={"因子 " + f.id + " 的最大次数"} placeholder="不限"
                  value={f.maxQuantity == null ? "" : f.maxQuantity} onChange={(e) => patchFactor(f.id, "maxQuantity", e.target.value === "" ? null : Number(e.target.value))}
                  style={{ ...miniInp, minWidth: 0, textAlign: "right" }} />
                <label title="允许小数数量：只生成单价×数量恰为整分的组合" style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={f.allowDecimal} onChange={(e) => patchFactor(f.id, "allowDecimal", e.target.checked)} style={{ accentColor: "var(--brand)" }} />
                </label>
                <button type="button" aria-label={"删除因子 " + f.id} onClick={() => removeFactor(f.id)}
                  style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--ink-faint)", display: "grid", placeItems: "center" }}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            {!factors.length && <div style={{ padding: "26px 12px", textAlign: "center", fontSize: 12, color: "var(--ink-faint)", borderTop: "1px solid var(--line)" }}>暂无因子，点「添加」开始配置</div>}

            {/* 求解参数：只在这一处出现，不与因子行混排 */}
            <div style={{ borderTop: "1px solid var(--line)", padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label htmlFor="calc-include" style={label}>必须包含因子</label>
                <input id="calc-include" type="number" step="any" placeholder="例如 4" value={include} onChange={(e) => setInclude(e.target.value)} style={miniInp} />
              </div>
              <div>
                <label htmlFor="calc-exclude" style={label}>排除因子</label>
                <input id="calc-exclude" type="number" step="any" placeholder="例如 2" value={exclude} onChange={(e) => setExclude(e.target.value)} style={miniInp} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="calc-max" style={label}>返回解数量（上限 {MAX_RESULTS.toLocaleString("zh-CN")}）</label>
                <input id="calc-max" type="number" min="1" max={MAX_RESULTS} placeholder="默认 100" value={maxResults} onChange={(e) => setMaxResults(e.target.value)} style={miniInp} />
              </div>
            </div>
            <div style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
              <Button variant="primary" icon="calculator" fullWidth disabled={!factors.length} onClick={calculate} style={{ width: "100%" }}>计算</Button>
            </div>
          </Panel>

          {/* ── 右：结果表 ── */}
          <Panel padding={0} style={{ overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)" }}>
                {result ? "推算结果 — 目标 " + Number(target).toLocaleString("zh-CN") : "填写因子后点击「计算」"}
              </span>
              {result && result.mode && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "var(--ink-faint)" }}>{result.mode === "light" ? "轻量搜索" : "可达性剪枝"}</span>}
            </div>

            {/* 汇总条：总解数 / 展示条数 / 耗时；截断与超时都如实说明。
                未算过时不出这条——空态区已经在说同一件事，不重复一遍。 */}
            {(result || /^请/.test(status)) && (
              <div aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, color: /^请/.test(status) ? "var(--danger)" : "var(--ink-soft)" }}>
                <Icon name="info" size={13} color={/^请/.test(status) ? "var(--danger)" : "var(--brand)"} />
                <span>{summary}</span>
              </div>
            )}

            {result && result.solutions.length ? (
              <div style={{ overflow: "auto", maxHeight: "clamp(20rem, 60dvh, 44rem)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                  <thead>
                    <tr>
                      <th style={{ ...TH, width: 52 }}>#</th>
                      <th style={TH}>表达式（点击复制）</th>
                      <th style={TH}>使用项（单项可点）</th>
                      <th style={{ ...TH, width: 72, textAlign: "right" }}>总数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.solutions.map((s, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={{ ...TD, color: "var(--ink-faint)", ...mono }}>{i + 1}</td>
                        <td style={TD}>
                          <button type="button" title="复制整条表达式" onClick={() => copy(expr(s))} style={{ ...linkBtn, ...mono, fontWeight: 700 }}>{expr(s)}</button>
                        </td>
                        <td style={TD}>
                          <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px" }}>
                            {s.map((it) => (
                              <button key={it.factorId + "-" + it.quantity} type="button" title="复制该使用项" onClick={() => copy(fmtPart(it))} style={{ ...linkBtn, ...mono, color: "var(--ink-soft)" }}>{fmtPart(it)}</button>
                            ))}
                          </span>
                        </td>
                        <td style={{ ...TD, ...mono, textAlign: "right", fontWeight: 700 }}>{fmtQty(s.reduce((n, it) => n + it.quantity, 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 48, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>
                <Icon name="sigma" size={30} color="var(--ink-faint)" />
                <div style={{ marginTop: 8 }}>在左侧维护因子单价，填好目标含税金额后点击「计算」</div>
                <div style={{ marginTop: 4, fontSize: 12 }}>只返回恰好等于目标值的组合，不给近似解</div>
              </div>
            )}
          </Panel>
        </div>
      </div>
    );
  }

  window.CalcScreen = CalcScreen;
})();