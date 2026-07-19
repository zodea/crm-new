// PayrollDetailScreen — 个人工资 A4 进度款单（2026-07-19 工资单据化轮，grill 定稿）
// 1:1 复刻真实工资发放格式 Excel（参考文件数据/工资发放格式，亚运城C1/未来印样张）：
//   计件工三页：①工程量进度清单（每户量×完成层数=申报量×单价=金额+空鼓+房租+请款链）②工人工资表 ③考勤表；
//   时工两页：①工资表（日薪×出勤+加班−借支）②考勤表。
//   每个 sheet 独立一页 A4，打印时 page-break 逐页分割（@media print 隐藏应用壳只出单据）。
//   月份切换 = 换整套单据；「暂不支付」屏上打水印（打印不带——真实做法标注在文件名）。不加原单没有的内容。
(function () {
  const { Button, Panel, Icon, StatusChip } = window.DesignSystem_e3d871;
  const num0 = n => Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // —— 打印样式（一次注入）：打印只显 A4 页，逐 sheet 分页 ——
  if (!document.getElementById("payslip-print-css")) {
    const st = document.createElement("style");
    st.id = "payslip-print-css";
    st.textContent = [
      "@media print {",
      "  body * { visibility: hidden !important; }",
      "  #payslip-print-root, #payslip-print-root * { visibility: visible !important; }",
      "  #payslip-print-root { position: absolute !important; left: 0; top: 0; width: 100%; }",
      "  #payslip-print-root .a4-page { page-break-after: always; box-shadow: none !important; border: 0 !important; margin: 0 auto !important; }",
      "  #payslip-print-root .no-print { display: none !important; }",
      "}",
    ].join("\n");
    document.head.appendChild(st);
  }

  // —— A4 页壳（屏显白纸卡；打印独立一页）——
  const A4 = ({ children, watermark }) => (
    <div className="a4-page" style={{ position: "relative", width: 860, maxWidth: "100%", margin: "0 auto 18px",
      background: "#fff", border: "1px solid var(--line-strong)", boxShadow: "0 2px 10px rgba(16,24,40,0.10)",
      padding: "38px 42px", color: "#1a1a1a", boxSizing: "border-box" }}>
      {watermark && (
        <div className="no-print" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", overflow: "hidden" }}>
          <span style={{ fontSize: 84, fontWeight: 800, color: "rgba(197,48,48,0.10)", transform: "rotate(-24deg)", whiteSpace: "nowrap", letterSpacing: "0.2em" }}>{watermark}</span>
        </div>
      )}
      {children}
    </div>
  );

  const bd = "1px solid #8a8a8a";
  const TH = { border: bd, padding: "4px 6px", fontSize: 11.5, fontWeight: 700, background: "#f0f0f0", textAlign: "center", whiteSpace: "nowrap" };
  const TD = { border: bd, padding: "4px 6px", fontSize: 11.5 };
  const TDc = { ...TD, textAlign: "center" };
  const TDr = { ...TD, textAlign: "right", fontFamily: "var(--font-mono)" };
  const chainTD = { padding: "3px 6px", fontSize: 11.5 };

  function PayrollDetailScreen({ navigate, params }) {
    const P = window.PAYSLIP;
    const worker = params.worker;
    const crewName = params.crew;
    const project = params.project;
    const crewKey = project + "|" + crewName;
    const crew = P && P.data[crewKey];
    const defMonth = crew ? (crew.schedule.find(s => s.current) || crew.schedule[crew.schedule.length - 1]).m : "";
    const [month, setMonth] = React.useState(params.month || defMonth);
    // 同路由页签间切换（换人/换班组）组件复用不重挂：month 随 params 指纹重置，避免带着上一单的月份
    const paramFp = worker + "|" + crewKey + "|" + (params.month || "");
    React.useEffect(() => { setMonth(params.month || defMonth); }, [paramFp]);   // eslint-disable-line
    if (!crew) return <div style={{ padding: 40, color: "var(--ink-soft)" }}>未找到「{project} / {crewName}」的工资单数据。</div>;
    const w = crew.workers.find(x => x.name === worker);
    const c = w ? P.calc(crewKey, worker, month) : null;
    if (!w || !c) return <div style={{ padding: 40, color: "var(--ink-soft)" }}>「{worker}」在 {month} 无工资单。</div>;

    const isTime = crew.payType === "time";
    const noPay = w.flags.includes("暂不支付");
    const [yy, mm] = month.split("-");
    const M = parseInt(mm);
    const projFull = project + "项目户内装修工程";
    const UI = () => window.KitUI || { toast: () => {} };

    // ============ 页① 工程量进度清单（计件专属，照抄真实清单行序） ============
    const pageList = !isTime && (
      <A4 watermark={noPay ? "暂 不 支 付" : null}>
        <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800 }}>{crew.trade}班组{M}月工程量进度清单（{worker}{w.flags.includes("单独计价") ? "·单独" : ""}）</div>
        <div style={{ fontSize: 11, margin: "6px 0 8px", color: "#333" }}>工程名称：{projFull}　　　　班组：{crew.trade}　　　　时间：{yy}.{mm}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 32 }} rowSpan={2}>序号</th>
              <th style={TH} rowSpan={2}>施工项目</th>
              <th style={{ ...TH, width: 36 }} rowSpan={2}>单位</th>
              <th style={{ ...TH, width: 66 }} rowSpan={2}>每户工程量</th>
              <th style={{ ...TH, width: 66 }} rowSpan={2}>施工完成层数</th>
              <th style={TH} colSpan={3}>暂定结算数量及金额</th>
              <th style={{ ...TH, width: 56 }} rowSpan={2}>空鼓点数</th>
              <th style={{ ...TH, width: 150 }} rowSpan={2}>备注</th>
            </tr>
            <tr>
              <th style={{ ...TH, width: 72 }}>申报工程量</th>
              <th style={{ ...TH, width: 62 }}>结算单价</th>
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
              <td style={TD}></td>
              <td style={TD}></td>
              <td style={TDr}>{num0(c.rentQty)}</td>
              <td style={TDr}>{num0(crew.rentPrice)}</td>
              <td style={TDr}>{num0(c.rentAmt)}</td>
              <td style={TD}></td>
              <td style={TD}></td>
            </tr>
          </tbody>
        </table>
        {/* 请款链（照真实单行序：空鼓数据→合计→比例→逐月已领→累计→空鼓暂扣→本次→取整） */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
          <tbody>
            {c.hollowNote ? (
              <tr><td style={{ ...chainTD, width: 32 }}>{c.lines.length + 1}</td><td style={chainTD}>空鼓数据</td><td style={{ ...chainTD, color: "#333" }} colSpan={2}>{c.hollowNote}</td></tr>
            ) : null}
            <tr><td style={chainTD}></td><td style={{ ...chainTD, fontWeight: 700 }}>合计</td><td style={{ ...chainTD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, width: 110 }}>{num0(c.total)}</td><td style={{ width: 60 }}></td></tr>
            <tr><td style={chainTD}></td><td style={chainTD}>本次请款总合计{c.ratio}%</td><td style={{ ...chainTD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{num0(c.payable)}</td><td></td></tr>
            {c.prevPaid.map(pp => {
              const parts = pp.month.split("-");
              return <tr key={pp.month}><td style={chainTD}></td><td style={chainTD}>{parts[0]}年{parseInt(parts[1])}月份已申领进度款</td><td style={{ ...chainTD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{num0(pp.amount)}</td><td></td></tr>;
            })}
            <tr><td style={chainTD}></td><td style={chainTD}>累计已申领进度款</td><td style={{ ...chainTD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{num0(c.paidSum)}</td><td></td></tr>
            {c.hold > 0 && <tr><td style={chainTD}></td><td style={{ ...chainTD, color: "#8a4b08" }}>空鼓暂扣</td><td style={{ ...chainTD, textAlign: "right", fontFamily: "var(--font-mono)", color: "#8a4b08" }}>{num0(c.hold)}</td><td></td></tr>}
            <tr><td style={chainTD}></td><td style={chainTD}>本次进度请款合计</td><td style={{ ...chainTD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{num0(c.request)}</td><td></td></tr>
            <tr style={{ borderTop: "1px solid #8a8a8a" }}><td style={chainTD}></td><td style={{ ...chainTD, fontWeight: 800 }}>本次进度请款合计（取整）</td><td style={{ ...chainTD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 13 }}>{num0(c.rounded)}</td><td></td></tr>
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

    // ============ 页② 工人工资表（计件=应发取整−借支；时工=日薪×出勤+加班−借支） ============
    const wagePage = (
      <A4 watermark={noPay ? "暂 不 支 付" : null}>
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

    // ============ 页③ 考勤表（1..31 天 √） ============
    const attDays = c.att || [];
    const attCount = attDays.filter(x => x === "√").length;
    const attPage = (
      <A4 watermark={noPay ? "暂 不 支 付" : null}>
        <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800 }}>{yy} 年{M}月{crew.trade}工人考勤表</div>
        <div style={{ fontSize: 11, margin: "6px 0 8px", color: "#333" }}>工程名称：{projFull}　　　　施工单位/班组（工种）：{crew.trade}</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ ...TH, width: 32 }}>序号</th>
                <th style={{ ...TH, width: 72 }}>日期<br />姓名</th>
                <th style={{ ...TH, width: 40 }}>月份</th>
                {Array.from({ length: 31 }, (_, i) => <th key={i} style={{ ...TH, width: 18, padding: "4px 2px" }}>{i + 1}</th>)}
                <th style={{ ...TH, width: 58 }}>本月出勤天数</th>
                <th style={{ ...TH, width: 72 }}>签字确认并按手印</th>
                <th style={{ ...TH, width: 44 }}>备注</th>
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
        </div>
        <div style={{ fontSize: 10.5, marginTop: 14 }}>班组签名：　　　　　　　施工员签名：　　　　　　　安全员签名：　　　　　　　现场负责人签名：</div>
        <div style={{ fontSize: 9, color: "#555", marginTop: 10, lineHeight: 1.8 }}>
          1、该表格由班组负责编制，若由于以上收款信息有误，引起的一切经济纠纷由班组负责人承担，与付款方无关。签字都需要加按指印。本表一式三份，现场项目部、施工班组、财务部各一份。
        </div>
      </A4>
    );

    // ============ 壳：面包屑 + 操作条 + A4 页组 ============
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-soft)", flexWrap: "wrap" }}>
          <button onClick={() => navigate("payroll", {})} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="chevron-left" size={14} />工资核算</button>
          <span>/</span>
          <button onClick={() => navigate("payroll", { project })} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>{project}</button>
          <span>/</span>
          <button onClick={() => navigate("payroll", { project, crew: crewName })} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>{crewName}</button>
          <span>/</span>
          <span style={{ color: "var(--ink)", fontWeight: 700 }}>{worker} · {month} 进度款单</span>
          {noPay && <StatusChip tone="danger">暂不支付</StatusChip>}
          {w.flags.includes("单独计价") && <StatusChip tone="neutral">单独计价</StatusChip>}
        </div>

        <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)" }}>月份：</span>
          {crew.schedule.map(s => (
            <button key={s.m} onClick={() => setMonth(s.m)}
              style={{ border: "1px solid", borderColor: s.m === month ? "var(--brand)" : "var(--line)", borderRadius: 999,
                padding: "5px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono)",
                background: s.m === month ? "var(--brand)" : "var(--surface-2)", color: s.m === month ? "#fff" : "var(--ink-soft)" }}>
              {s.m}{isTime ? "" : " · " + s.r + "%"}
            </button>
          ))}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button size="sm" variant="primary" icon="printer" onClick={() => window.print()}>打印（每 sheet 一页）</Button>
            <Button size="sm" icon="file-down" onClick={() => UI().toast("正在导出 PDF（" + (isTime ? 2 : 3) + " 页：" + (isTime ? "工资表/考勤表" : "进度清单/工资表/考勤表") + "）…")}>导出 PDF</Button>
          </span>
        </Panel>

        {/* A4 页组（ADR 0013 条款5：密集 A4 预览在自身容器内滚动） */}
        <div id="payslip-print-root" style={{ overflowX: "auto", padding: "4px 0 20px" }}>
          {pageList}
          {wagePage}
          {attPage}
        </div>
      </div>
    );
  }

  window.PayrollDetailScreen = PayrollDetailScreen;
})();
