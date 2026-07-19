// PayrollDetailScreen — 个人进度款：两步流「① 工程量核对(可编辑) → ② A4 单据(打印)」（2026-07-19 反馈轮）
// · 核对表：Excel 同构行内直改（每户量/单价全月生效；完成层数/空鼓/暂扣/借支当月），写 window.PAYSLIP.update
//   实时联动瀑布卡/工资总表；可加行删行。核对无误再进 A4 看排版打印（A4 纯只读）。
// · A4 1:1 复刻真实 Excel：进度清单请款链并入带边框主表格；每 sheet 独立一页打印；
//   工资表/考勤表默认横向（超宽自动横排+每页手动 纵/横 切换，打印按方向缩放适配不错位）。
// · 时工两页（工资表/考勤表）；「暂不支付」屏显水印（打印不带，真实做法标注在文件名）。
(function () {
  const { Button, Panel, Icon, StatusChip } = window.DesignSystem_e3d871;
  const num0 = n => Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };

  // —— 打印样式：只出 A4 页；纵向页缩放 0.85、横向页命名 @page landscape 缩放 0.94（等比缩放不错位）——
  if (!document.getElementById("payslip-print-css")) {
    const st = document.createElement("style");
    st.id = "payslip-print-css";
    st.textContent = [
      "@page { size: A4; margin: 8mm; }",
      "@page kit-land { size: A4 landscape; margin: 8mm; }",
      "@media print {",
      "  body * { visibility: hidden !important; }",
      "  #payslip-print-root, #payslip-print-root * { visibility: visible !important; }",
      "  #payslip-print-root { position: absolute !important; left: 0; top: 0; width: 100%; }",
      "  #payslip-print-root .a4-page { page-break-after: always; box-shadow: none !important; border: 0 !important; margin: 0 auto !important; }",
      "  #payslip-print-root .a4-page.orient-land { page: kit-land; }",
      "  #payslip-print-root .a4-page.orient-port .a4-fit { zoom: 0.85; }",
      "  #payslip-print-root .a4-page.orient-land .a4-fit { zoom: 0.94; }",
      "  #payslip-print-root .no-print { display: none !important; }",
      "}",
    ].join("\n");
    document.head.appendChild(st);
  }

  // —— A4 页壳：orient 纵/横（横=1123 宽），右上角手动转向按钮（no-print）——
  const A4 = ({ children, watermark, orient, onFlip, label }) => (
    <div className={"a4-page " + (orient === "land" ? "orient-land" : "orient-port")}
      style={{ position: "relative", width: orient === "land" ? 1123 : 860, maxWidth: "none", margin: "0 auto 18px",
        background: "#fff", border: "1px solid var(--line-strong)", boxShadow: "0 2px 10px rgba(16,24,40,0.10)",
        padding: "34px 40px", color: "#1a1a1a", boxSizing: "border-box" }}>
      {watermark && (
        <div className="no-print" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", overflow: "hidden", zIndex: 1 }}>
          <span style={{ fontSize: 84, fontWeight: 800, color: "rgba(197,48,48,0.10)", transform: "rotate(-24deg)", whiteSpace: "nowrap", letterSpacing: "0.2em" }}>{watermark}</span>
        </div>
      )}
      <button className="no-print" type="button" onClick={onFlip} title={"切换纵/横打印（当前：" + (orient === "land" ? "横向" : "纵向") + "）"}
        style={{ position: "absolute", top: 8, right: 8, zIndex: 2, display: "inline-flex", alignItems: "center", gap: 4,
          border: "1px solid var(--line-strong)", background: "var(--surface-2)", borderRadius: 6, padding: "3px 8px",
          fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", cursor: "pointer" }}>
        <Icon name={orient === "land" ? "rectangle-horizontal" : "rectangle-vertical"} size={12} />{orient === "land" ? "横向" : "纵向"}
      </button>
      <div className="a4-fit">{children}</div>
      {label && <div className="no-print" style={{ position: "absolute", left: 10, bottom: 6, fontSize: 10, color: "var(--ink-faint)" }}>{label}</div>}
    </div>
  );

  const bd = "1px solid #8a8a8a";
  const TH = { border: bd, padding: "4px 6px", fontSize: 11.5, fontWeight: 700, background: "#f0f0f0", textAlign: "center", whiteSpace: "nowrap" };
  const TD = { border: bd, padding: "4px 6px", fontSize: 11.5 };
  const TDc = { ...TD, textAlign: "center" };
  const TDr = { ...TD, textAlign: "right", fontFamily: "var(--font-mono)" };

  function PayrollDetailScreen({ navigate, params }) {
    const P = window.PAYSLIP;
    const A = window.APP;
    if (A) A.use();                      // 订阅共享通知：核对表直改 → 本组件与列表/瀑布卡同步重算
    const worker = params.worker;
    const crewName = params.crew;
    const project = params.project;
    const crewKey = project + "|" + crewName;
    const crew = P && P.data[crewKey];
    const defMonth = crew ? (crew.schedule.find(s => s.current) || crew.schedule[crew.schedule.length - 1]).m : "";
    const [month, setMonth] = React.useState(params.month || defMonth);
    const [step, setStep] = React.useState(params.step === "a4" ? "a4" : "check");   // 先核对，后 A4（grill 定稿）
    const [orient, setOrient] = React.useState({ list: "port", wage: "land", att: "land" });   // 超宽表默认横向
    // 同路由页签复用不重挂：month/step 随 params 指纹重置
    const paramFp = worker + "|" + crewKey + "|" + (params.month || "") + "|" + (params.step || "");
    React.useEffect(() => { setMonth(params.month || defMonth); setStep(params.step === "a4" ? "a4" : "check"); }, [paramFp]);   // eslint-disable-line
    if (!crew) return <div style={{ padding: 40, color: "var(--ink-soft)" }}>未找到「{project} / {crewName}」的工资单数据。</div>;
    const w = crew.workers.find(x => x.name === worker);
    const c = w ? P.calc(crewKey, worker, month) : null;
    if (!w || !c) return <div style={{ padding: 40, color: "var(--ink-soft)" }}>「{worker}」在 {month} 无工资单。</div>;

    const isTime = crew.payType === "time";
    const noPay = w.flags.includes("暂不支付");
    const [yy, mm] = month.split("-");
    const M = parseInt(mm);
    const projFull = project + "项目户内装修工程";
    const flip = (k) => setOrient(o => ({ ...o, [k]: o[k] === "land" ? "port" : "land" }));
    const upd = (fn) => P.update(crewKey, worker, fn);   // 直改写回（P.update 内部 APP.notify → 全域联动）

    // ================= 步骤 ①：工程量核对表（Excel 同构，行内直改实时联动） =================
    const inp = (v, on, opt) => (
      <input type={(opt && opt.type) || "text"} value={v == null ? "" : v}
        onChange={e => on((opt && opt.type) === "number" ? (e.target.value === "" ? 0 : +e.target.value) : e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid transparent", background: "transparent",
          padding: "4px 5px", fontSize: 12, borderRadius: 4, textAlign: (opt && opt.align) || "left",
          fontFamily: (opt && opt.type) === "number" ? "var(--font-mono)" : "inherit", outline: "none" }}
        onFocus={e => { e.target.style.borderColor = "var(--brand)"; e.target.style.background = "#fff"; }}
        onBlur={e => { e.target.style.borderColor = "transparent"; e.target.style.background = "transparent"; }} />
    );
    const cTH = { padding: "8px 10px", fontSize: 11.5, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
    const cTD = { padding: "3px 6px", fontSize: 12.5, borderBottom: "1px solid var(--line)" };
    const cNum = { ...cTD, textAlign: "right", fontFamily: "var(--font-mono)" };

    const checkPiece = !isTime && (
      <Panel padding={0} style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>工程量核对 · {month}</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>行内直改即保存并全局联动；每户工程量/单价改动对全部月份生效，完成层数/空鼓按当月记</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button size="sm" icon="plus" onClick={() => upd((wk, cr) => {
              wk.units.push({ item: "新分项", unit: "㎡", perUnit: 0, price: 0 });
              cr.schedule.forEach(s => { const mo = wk.byMonth[s.m]; if (mo) { mo.floors.push(0); mo.notes.push(""); mo.hollow.push(0); } });
            })}>添加行</Button>
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 880, borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...cTH, width: 34 }}>序号</th>
              <th style={{ ...cTH, textAlign: "left" }}>施工项目</th>
              <th style={{ ...cTH, width: 52 }}>单位</th>
              <th style={{ ...cTH, width: 88, textAlign: "right" }}>每户工程量</th>
              <th style={{ ...cTH, width: 80, textAlign: "right" }}>完成层数</th>
              <th style={{ ...cTH, width: 92, textAlign: "right" }}>申报工程量</th>
              <th style={{ ...cTH, width: 84, textAlign: "right" }}>结算单价</th>
              <th style={{ ...cTH, width: 100, textAlign: "right" }}>金额</th>
              <th style={{ ...cTH, width: 72, textAlign: "right" }}>空鼓点数</th>
              <th style={{ ...cTH, textAlign: "left" }}>备注（楼层）</th>
              <th style={{ ...cTH, width: 40 }}></th>
            </tr></thead>
            <tbody>
              {c.lines.map((l, i) => (
                <tr key={i}>
                  <td style={{ ...cTD, textAlign: "center", color: "var(--ink-faint)" }}>{i + 1}</td>
                  <td style={cTD}>{inp(w.units[i].item, v => upd(wk => { wk.units[i].item = v; }))}</td>
                  <td style={cTD}>{inp(w.units[i].unit, v => upd(wk => { wk.units[i].unit = v; }))}</td>
                  <td style={cNum}>{inp(w.units[i].perUnit, v => upd(wk => { wk.units[i].perUnit = v; }), { type: "number", align: "right" })}</td>
                  <td style={cNum}>{inp(w.byMonth[month].floors[i], v => upd(wk => { wk.byMonth[month].floors[i] = v; }), { type: "number", align: "right" })}</td>
                  <td style={{ ...cNum, color: "var(--ink-soft)" }}>{num0(l.qty)}</td>
                  <td style={cNum}>{inp(w.units[i].price, v => upd(wk => { wk.units[i].price = v; }), { type: "number", align: "right" })}</td>
                  <td style={{ ...cNum, fontWeight: 700 }}>{num0(l.amount)}</td>
                  <td style={cNum}>{inp(w.byMonth[month].hollow[i], v => upd(wk => { wk.byMonth[month].hollow[i] = v; }), { type: "number", align: "right" })}</td>
                  <td style={cTD}>{inp(w.byMonth[month].notes[i], v => upd(wk => { wk.byMonth[month].notes[i] = v; }))}</td>
                  <td style={{ ...cTD, textAlign: "center" }}>
                    <button type="button" title="删除该行" onClick={() => UI().confirm({ title: "删除该分项行？", message: "「" + l.item + "」将从该工人全部月份的清单中移除。", danger: true, confirmText: "删除",
                      onConfirm: () => upd((wk, cr) => { wk.units.splice(i, 1); cr.schedule.forEach(s => { const mo = wk.byMonth[s.m]; if (mo) { mo.floors.splice(i, 1); mo.notes.splice(i, 1); mo.hollow.splice(i, 1); } }); }) })}
                      style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--ink-faint)" }}><Icon name="trash-2" size={13} /></button>
                  </td>
                </tr>
              ))}
              <tr style={{ background: "var(--surface-2)" }}>
                <td style={{ ...cTD, textAlign: "center" }}>一</td>
                <td style={cTD}>合计工程量房租</td>
                <td style={{ ...cTD, textAlign: "center" }}>㎡</td>
                <td style={cNum}></td><td style={cNum}></td>
                <td style={cNum}>{num0(c.rentQty)}</td>
                <td style={cNum}>{num0(crew.rentPrice)}</td>
                <td style={{ ...cNum, fontWeight: 700 }}>{num0(c.rentAmt)}</td>
                <td colSpan={3} style={cTD}></td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* 请款链核对（空鼓明细/暂扣/借支可改，其余实时算） */}
        <div style={{ padding: "12px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, borderTop: "1px solid var(--line)" }}>
          <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "flex", flexDirection: "column", gap: 4 }}>空鼓明细（文字）
            <input value={c.hollowNote || ""} onChange={e => upd(wk => { wk.byMonth[month].hollowNote = e.target.value; })}
              style={{ border: "1px solid var(--line-strong)", borderRadius: 6, padding: "6px 9px", fontSize: 12.5 }} />
          </label>
          <label style={{ fontSize: 12, color: "var(--warn-ink)", display: "flex", flexDirection: "column", gap: 4 }}>空鼓暂扣（元）
            <input type="number" value={c.hold} onChange={e => upd(wk => { wk.byMonth[month].hold = +e.target.value || 0; })}
              style={{ border: "1px solid var(--line-strong)", borderRadius: 6, padding: "6px 9px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right" }} />
          </label>
          <label style={{ fontSize: 12, color: "var(--danger-ink)", display: "flex", flexDirection: "column", gap: 4 }}>借支（元，工资表实发扣）
            <input type="number" value={c.borrow} onChange={e => upd(wk => { wk.byMonth[month].borrow = +e.target.value || 0; })}
              style={{ border: "1px solid var(--line-strong)", borderRadius: 6, padding: "6px 9px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right" }} />
          </label>
        </div>
        <div style={{ padding: "10px 16px", background: "var(--surface-2)", borderTop: "1px solid var(--line)", display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12.5 }}>
          <span>合计 <b style={{ fontFamily: "var(--font-mono)" }}>{num0(c.total)}</b></span>
          <span>× {c.ratio}% = <b style={{ fontFamily: "var(--font-mono)" }}>{num0(c.payable)}</b></span>
          <span style={{ color: "var(--ink-soft)" }}>累计已领 <b style={{ fontFamily: "var(--font-mono)" }}>{num0(c.paidSum)}</b></span>
          {c.hold > 0 && <span style={{ color: "var(--warn-ink)" }}>空鼓暂扣 <b style={{ fontFamily: "var(--font-mono)" }}>{num0(c.hold)}</b></span>}
          <span>本次请款 <b style={{ fontFamily: "var(--font-mono)" }}>{num0(c.request)}</b></span>
          <span style={{ marginLeft: "auto", fontWeight: 800, color: "var(--brand-deep)" }}>取整应发 <b style={{ fontFamily: "var(--font-mono)", fontSize: 15 }}>{num0(c.rounded)}</b></span>
        </div>
      </Panel>
    );

    const checkTime = isTime && (
      <Panel padding={0} style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", fontSize: 13.5, fontWeight: 800 }}>时工核对 · {month}</div>
        <div style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          {[["daily", "日薪（元/天）"], ["days", "出勤天数"], ["overtime", "加班工资（元）"], ["borrow", "借支（元）"]].map(([k, lb]) => (
            <label key={k} style={{ fontSize: 12, color: "var(--ink-soft)", display: "flex", flexDirection: "column", gap: 4 }}>{lb}
              <input type="number" value={c[k]} onChange={e => upd(wk => { wk.byMonth[month][k] = +e.target.value || 0; })}
                style={{ border: "1px solid var(--line-strong)", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "var(--font-mono)", textAlign: "right" }} />
            </label>
          ))}
        </div>
        <div style={{ padding: "10px 16px", background: "var(--surface-2)", borderTop: "1px solid var(--line)", display: "flex", gap: 18, fontSize: 12.5 }}>
          <span>应发 = {num0(c.daily)} × {c.days} 天 = <b style={{ fontFamily: "var(--font-mono)" }}>{num0(c.gross)}</b></span>
          <span>+ 加班 <b style={{ fontFamily: "var(--font-mono)" }}>{num0(c.overtime)}</b></span>
          <span>− 借支 <b style={{ fontFamily: "var(--font-mono)" }}>{num0(c.borrow)}</b></span>
          <span style={{ marginLeft: "auto", fontWeight: 800, color: "var(--brand-deep)" }}>实发 <b style={{ fontFamily: "var(--font-mono)", fontSize: 15 }}>{num0(c.net)}</b></span>
        </div>
      </Panel>
    );

    // ================= 步骤 ②：A4 单据（1:1 复刻，请款链并入带边框主表格） =================
    const chainRow = (no, label, val, opts) => (
      <tr key={label}>
        <td style={TDc}>{no || ""}</td>
        <td style={{ ...TD, fontWeight: (opts && opts.bold) ? 800 : 400, color: (opts && opts.color) || "#1a1a1a" }} colSpan={6}>{label}</td>
        <td style={{ ...TDr, fontWeight: (opts && opts.bold) ? 800 : 400, fontSize: (opts && opts.bold) ? 12.5 : 11.5, color: (opts && opts.color) || "#1a1a1a" }}>{num0(val)}</td>
        <td style={TD} colSpan={2}></td>
      </tr>
    );
    let chainNo = c.lines.length + 1;
    const pageList = !isTime && (
      <A4 watermark={noPay ? "暂 不 支 付" : null} orient={orient.list} onFlip={() => flip("list")} label="第 1 页 · 工程量进度清单">
        <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800 }}>{crew.trade}班组{M}月工程量进度清单（{worker}{w.flags.includes("单独计价") ? "·单独" : ""}）</div>
        <div style={{ fontSize: 11, margin: "6px 0 8px", color: "#333" }}>工程名称：{projFull}　　　　班组：{crew.trade}　　　　时间：{yy}.{mm}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 32 }} rowSpan={2}>序号</th>
              <th style={TH} rowSpan={2}>施工项目</th>
              <th style={{ ...TH, width: 36 }} rowSpan={2}>单位</th>
              <th style={{ ...TH, width: 64 }} rowSpan={2}>每户工程量</th>
              <th style={{ ...TH, width: 64 }} rowSpan={2}>施工完成层数</th>
              <th style={TH} colSpan={3}>暂定结算数量及金额</th>
              <th style={{ ...TH, width: 52 }} rowSpan={2}>空鼓点数</th>
              <th style={{ ...TH, width: 148 }} rowSpan={2}>备注</th>
            </tr>
            <tr>
              <th style={{ ...TH, width: 70 }}>申报工程量</th>
              <th style={{ ...TH, width: 60 }}>结算单价</th>
              <th style={{ ...TH, width: 78 }}>金　　额</th>
            </tr>
          </thead>
          <tbody>
            {c.lines.map((l, i) => (
              <tr key={i}>
                <td style={TDc}>{i + 1}</td>
                <td style={TD}>{l.item}</td>
                <td style={TDc}>{l.unit}</td>
                <td style={TDr}>{l.perUnit}</td>
                <td style={TDc}>{l.floors}</td>
                <td style={TDr}>{num0(l.qty)}</td>
                <td style={TDr}>{num0(l.price)}</td>
                <td style={TDr}>{num0(l.amount)}</td>
                <td style={TDc}>{l.hollow || ""}</td>
                <td style={{ ...TD, fontSize: 10 }}>{l.note}</td>
              </tr>
            ))}
            <tr>
              <td style={TDc}>一</td>
              <td style={TD}>合计工程量房租</td>
              <td style={TDc}>㎡</td>
              <td style={TD}></td><td style={TD}></td>
              <td style={TDr}>{num0(c.rentQty)}</td>
              <td style={TDr}>{num0(crew.rentPrice)}</td>
              <td style={TDr}>{num0(c.rentAmt)}</td>
              <td style={TD}></td><td style={TD}></td>
            </tr>
            {/* 请款链并入主表格（与真实 Excel 同为连片边框网格） */}
            {c.hollowNote ? (
              <tr>
                <td style={TDc}>{chainNo++}</td>
                <td style={TD}>空鼓数据</td>
                <td style={{ ...TD, fontSize: 10.5, color: "#333" }} colSpan={8}>{c.hollowNote}</td>
              </tr>
            ) : null}
            {chainRow(chainNo++, "合计", c.total, { bold: true })}
            {chainRow(chainNo++, "本次请款总合计" + c.ratio + "%", c.payable)}
            {c.prevPaid.map(pp => {
              const parts = pp.month.split("-");
              return chainRow(chainNo++, parts[0] + "年" + parseInt(parts[1]) + "月份已申领进度款", pp.amount);
            })}
            {chainRow(chainNo++, "累计已申领进度款", c.paidSum)}
            {c.hold > 0 && chainRow(chainNo++, "空鼓暂扣", c.hold, { color: "#8a4b08" })}
            {chainRow(chainNo++, "本次进度请款合计", c.request)}
            {chainRow(chainNo++, "本次进度请款合计（取整）", c.rounded, { bold: true })}
          </tbody>
        </table>
        <div style={{ fontSize: 10.5, marginTop: 14 }}>施工班组长签名：　　　　　　　施工员签名：　　　　　　　安全员签名：　　　　　　　现场负责人签名：</div>
        <div style={{ fontSize: 9, color: "#555", marginTop: 10, lineHeight: 1.8 }}>
          注：　1、各施工人员依据现场施工的相关约定，在申请工程进度款时，首先根据现场实际完成工程量认真准确地填写此清单（附表）<br />
          2、将填写好的清单（附表）交于现场项目组负责人处，同时可要求我司现场项目组配合确认清单（附表）内容。<br />
          3、现场空鼓未处理，后续维修费用相应扣除。<br />
          4、本人对工程单价、工资金额及银行扣税均确认无议。<br />
          5、本人在现场项目负责人处填写正表及相关内容，我司财务将根据正、附表确认签名情况，在收表审批签名后十五天内安排付款事宜。
        </div>
      </A4>
    );

    const wagePage = (
      <A4 watermark={noPay ? "暂 不 支 付" : null} orient={orient.wage} onFlip={() => flip("wage")} label={"第 " + (isTime ? 1 : 2) + " 页 · 工人工资表"}>
        <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800 }}>{yy} 年{M}月{crew.trade}工人工资表</div>
        <div style={{ fontSize: 11, margin: "6px 0 8px", color: "#333" }}>工程名称：{projFull}　　　　施工单位/班组（工种）：{crew.trade}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 32 }}>序号</th>
              <th style={TH}>姓名</th>
              <th style={{ ...TH, width: 64 }}>日/月薪资</th>
              <th style={{ ...TH, width: 56 }}>出勤天数</th>
              <th style={{ ...TH, width: 74 }}>应发工资</th>
              {isTime && <th style={{ ...TH, width: 62 }}>加班工资</th>}
              <th style={{ ...TH, width: 56 }}>借支</th>
              <th style={{ ...TH, width: 74 }}>实发工资</th>
              <th style={{ ...TH, width: 86 }}>签字确认并按手印</th>
              <th style={{ ...TH, width: 56 }}>户名</th>
              <th style={{ ...TH, width: 90 }}>联系电话</th>
              <th style={TH}>账号</th>
              <th style={TH}>支行名称</th>
              <th style={{ ...TH, width: 44 }}>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={TDc}>1</td>
              <td style={TDc}>{w.name}</td>
              <td style={TDr}>{isTime ? num0(c.daily) : ""}</td>
              <td style={TDc}>{isTime ? c.days : ""}</td>
              <td style={TDr}>{isTime ? num0(c.gross) : num0(c.rounded)}</td>
              {isTime && <td style={TDr}>{c.overtime ? num0(c.overtime) : ""}</td>}
              <td style={TDr}>{c.borrow ? num0(c.borrow) : "0.00"}</td>
              <td style={{ ...TDr, fontWeight: 700 }}>{num0(c.net)}</td>
              <td style={TD}></td>
              <td style={TDc}>{w.bank.holder}</td>
              <td style={{ ...TDc, fontFamily: "var(--font-mono)", fontSize: 10.5 }}>{w.bank.phone}</td>
              <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 10.5 }}>{w.bank.account}</td>
              <td style={{ ...TD, fontSize: 10.5 }}>{w.bank.branch}</td>
              <td style={{ ...TD, fontSize: 10 }}>{noPay ? "暂不支付" : ""}</td>
            </tr>
            <tr>
              <td style={{ ...TD, textAlign: "right", fontWeight: 700 }} colSpan={4}>合计：</td>
              <td style={TDr}>{isTime ? num0(c.gross) : num0(c.rounded)}</td>
              {isTime && <td style={TDr}>{c.overtime ? num0(c.overtime) : ""}</td>}
              <td style={TDr}>{c.borrow ? num0(c.borrow) : "0.00"}</td>
              <td style={{ ...TDr, fontWeight: 700 }}>{num0(c.net)}</td>
              <td style={TD} colSpan={6}></td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 10.5, marginTop: 14 }}>施工班组长签名：　　　　　　　施工员签名：　　　　　　　安全员签名：　　　　　　　现场负责人签名：</div>
        <div style={{ fontSize: 9, color: "#555", marginTop: 10, lineHeight: 1.8 }}>
          1、该表格由班组负责编制，若由于以上收款信息有误，引起的一切经济纠纷由班组负责人承担，与付款方无关。签字都需要加按指印。本表一式三份，现场项目部、施工班组、财务部各一份。<br />
          2、本人对工程单价、工资金额及银行扣税均确认无议。
        </div>
      </A4>
    );

    const attDays = c.att || [];
    const attCount = attDays.filter(x => x === "√").length;
    const attPage = (
      <A4 watermark={noPay ? "暂 不 支 付" : null} orient={orient.att} onFlip={() => flip("att")} label={"第 " + (isTime ? 2 : 3) + " 页 · 考勤表"}>
        <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800 }}>{yy} 年{M}月{crew.trade}工人考勤表</div>
        <div style={{ fontSize: 11, margin: "6px 0 8px", color: "#333" }}>工程名称：{projFull}　　　　施工单位/班组（工种）：{crew.trade}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 30 }}>序号</th>
              <th style={{ ...TH, width: 64 }}>日期<br />姓名</th>
              <th style={{ ...TH, width: 36 }}>月份</th>
              {Array.from({ length: 31 }, (_, i) => <th key={i} style={{ ...TH, padding: "4px 2px", fontSize: 10 }}>{i + 1}</th>)}
              <th style={{ ...TH, width: 52 }}>本月出勤天数</th>
              <th style={{ ...TH, width: 64 }}>签字确认并按手印</th>
              <th style={{ ...TH, width: 40 }}>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={TDc}>1</td>
              <td style={TDc}>{w.name}</td>
              <td style={TDc}>{M}</td>
              {Array.from({ length: 31 }, (_, i) => <td key={i} style={{ ...TDc, padding: "4px 2px", fontSize: 10 }}>{attDays[i] || ""}</td>)}
              <td style={{ ...TDc, fontWeight: 700 }}>{attCount}</td>
              <td style={TD}></td>
              <td style={TD}></td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 10.5, marginTop: 14 }}>班组签名：　　　　　　　施工员签名：　　　　　　　安全员签名：　　　　　　　现场负责人签名：</div>
        <div style={{ fontSize: 9, color: "#555", marginTop: 10, lineHeight: 1.8 }}>
          1、该表格由班组负责编制，若由于以上收款信息有误，引起的一切经济纠纷由班组负责人承担，与付款方无关。签字都需要加按指印。本表一式三份，现场项目部、施工班组、财务部各一份。
        </div>
      </A4>
    );

    // ================= 壳：面包屑 + 两步切换 + 月份 + 操作 =================
    const stepBtn = (k, label) => (
      <button type="button" onClick={() => setStep(k)}
        style={{ border: "1px solid", borderColor: step === k ? "var(--brand)" : "var(--line)", borderRadius: 8,
          padding: "6px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer",
          background: step === k ? "var(--brand)" : "var(--surface-2)", color: step === k ? "#fff" : "var(--ink-soft)" }}>{label}</button>
    );
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-soft)", flexWrap: "wrap" }}>
          <button onClick={() => navigate("payroll", {})} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="chevron-left" size={14} />工资核算</button>
          <span>/</span>
          <button onClick={() => navigate("payroll", { project })} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>{project}</button>
          <span>/</span>
          <button onClick={() => navigate("payroll", { project, crew: crewName })} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>{crewName}</button>
          <span>/</span>
          <span style={{ color: "var(--ink)", fontWeight: 700 }}>{worker} · {month} 进度款</span>
          {noPay && <StatusChip tone="danger">暂不支付</StatusChip>}
          {w.flags.includes("单独计价") && <StatusChip tone="neutral">单独计价</StatusChip>}
        </div>

        <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {stepBtn("check", "① 工程量核对")}
          <Icon name="chevron-right" size={14} color="var(--ink-faint)" />
          {stepBtn("a4", "② A4 单据 · 打印")}
          <span style={{ width: 1, height: 20, background: "var(--line)", margin: "0 4px" }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-soft)" }}>月份：</span>
          {crew.schedule.map(s => (
            <button key={s.m} onClick={() => setMonth(s.m)}
              style={{ border: "1px solid", borderColor: s.m === month ? "var(--brand)" : "var(--line)", borderRadius: 999,
                padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono)",
                background: s.m === month ? "var(--brand-soft)" : "var(--surface-2)", color: s.m === month ? "var(--brand-deep)" : "var(--ink-soft)" }}>
              {s.m}{isTime ? "" : " · " + s.r + "%"}
            </button>
          ))}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {step === "check"
              ? <Button size="sm" variant="primary" icon="arrow-right" onClick={() => setStep("a4")}>核对无误，生成 A4 单</Button>
              : (<>
                <Button size="sm" icon="pencil" onClick={() => setStep("check")}>返回核对</Button>
                <Button size="sm" variant="primary" icon="printer" onClick={() => window.print()}>打印（每 sheet 一页）</Button>
                <Button size="sm" icon="file-down" onClick={() => UI().toast("正在导出 PDF（" + (isTime ? 2 : 3) + " 页）…")}>导出 PDF</Button>
              </>)}
          </span>
        </Panel>

        {step === "check" && (checkPiece || checkTime)}

        {step === "a4" && (
          <div id="payslip-print-root" style={{ overflowX: "auto", padding: "4px 0 20px" }}>
            {pageList}
            {wagePage}
            {attPage}
          </div>
        )}
      </div>
    );
  }

  window.PayrollDetailScreen = PayrollDetailScreen;
})();
