// PayrollDetailScreen — 请款簿（负责人×月）两步流：「① 核对 → ② A4 单据(打印)」（#117 进度款域重构）
// · D1 单一数据链：A 族清单行由工程量管理聚合生成（量只读，改量去工程量管理）；核对表手工项只起核对作用；
// · D4 单价弹窗双模式：统一改（分项基准价、当月起）/ 单独改（本簿单列调价「调」标）+ 去工资配置入口；
// · D5/⑥ 空鼓：从户记录聚合只读列示（自动生成「2栋6楼2处」明细文字）；进度月不扣款，「开始扣款」手动启动
//   → 按仍未整改处数×单处金额生成扣款行（请款合计后、取整前）；离职且有未整改 → 联动提示；
// · D6 三态：草稿(活算) → 已核对(指纹，上游变动→需重核) → 已发放(登记实际金额→固化只读)；暂不支付=滚存；
//   ⑤b 发放固化同时在付款管理生成支出记录（toast 呈现）；
// · D7 组内分配：取整请款额分配到组员（默认全给负责人）；工资表/考勤表 = 负责人+组员多行；
// · D8/D9 A4 格式族：A(请款链真实行序+楼层区间压缩+名册登记表页) / MGR(栋×分项汇总×费率+负价代付行) /
//   B(分组小标题+项目特征长文+一口价「项」行+简化链) / C1(工资+考勤，加班时薪=日薪÷8) / C2(零星用工记录表+可编辑脚注)；
//   ⑤ 审批表=工资表（签字按手印列+四签名栏即审批载体），不另加审批表页。
(function () {
  const { Button, Panel, Icon, StatusChip } = window.DesignSystem_e3d871;
  const num0 = n => Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), modal: () => ({ body: document.createElement("div"), close: () => {} }), formModal: () => {} };

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
  // ⚠ 不要在模块顶层写 JSX 常量：x-import 执行时 React 可能未就绪，抛错会让 _ds_bundle 里的旧同名全局失去覆盖
  const Sign = () => <div style={{ fontSize: 10.5, marginTop: 14 }}>施工班组长签名：　　　　　　　施工员签名：　　　　　　　安全员签名：　　　　　　　现场负责人签名：</div>;

  function PayrollDetailScreen({ navigate, params }) {
    const P = window.PAYSLIP;
    const W = window.WAGE;
    const A = window.APP;
    if (A && A.use) A.use();   // 订阅共享通知：工程量/单价/状态变动 → 实时联动
    const [tick, setTick] = React.useState(0);
    React.useEffect(() => {
      if (P && W) return;
      const t = setInterval(() => { if (window.PAYSLIP && window.WAGE) { clearInterval(t); setTick(v => v + 1); } }, 60);
      return () => clearInterval(t);
    }, []);

    // 参数兼容：优先 book id；旧入口只给 worker 时找其为负责人（次选组员）的簿
    // （所有 hooks 必须先于任何 early-return，保证 hook 顺序稳定）
    let book = null;
    if (window.PAYSLIP) {
      const PP = window.PAYSLIP;
      book = params.book ? PP.bookById(params.book) : null;
      if (!book && params.worker) {
        book = PP.books.find(b => b.leader === params.worker && (!params.project || b.project === params.project))
          || PP.books.find(b => b.members.indexOf(params.worker) >= 0 && (!params.project || b.project === params.project));
      }
    }
    const defMonth = book ? window.PAYSLIP.curMonth(book) : "";
    const [month, setMonth] = React.useState((params.month && book && book.months[params.month]) ? params.month : defMonth);
    const [step, setStep] = React.useState(params.step === "a4" ? "a4" : "check");
    const [orient, setOrient] = React.useState({ list: "port", wage: "land", att: "land", roster: "land", log: "port" });
    const [featOpen, setFeatOpen] = React.useState({});
    const paramFp = (params.book || params.worker || "") + "|" + (params.month || "") + "|" + (params.step || "");
    React.useEffect(() => { if (book) { setMonth((params.month && book.months[params.month]) ? params.month : defMonth); setStep(params.step === "a4" ? "a4" : "check"); } }, [paramFp, !!book]);   // eslint-disable-line
    if (!window.PAYSLIP || !window.WAGE) return <Panel padding={40} style={{ textAlign: "center", color: "var(--ink-soft)" }}>数据链加载中…</Panel>;
    if (!book) return <div style={{ padding: 40, color: "var(--ink-soft)" }}>未找到请款簿（{params.book || params.worker || "?"}）。</div>;
    if (!month) return <div style={{ padding: 40, color: "var(--ink-soft)" }}>请款簿加载中…</div>;
    const doc = P.calc(book.id, month);
    if (!doc) return <div style={{ padding: 40, color: "var(--ink-soft)" }}>「{book.leader}簿」在 {month} 无单据。</div>;

    const mo = book.months[month];
    const sealed = doc.status === "已发放";
    const future = doc.status === "未到";
    const draft = doc.status === "草稿";
    const checked = doc.status === "已核对";
    const isPiece = book.family === "A" || book.family === "MGR" || book.family === "B";
    const leaderRoster = P.rosterRow(book.leader);
    const flip = (k) => setOrient(o => ({ ...o, [k]: o[k] === "land" ? "port" : "land" }));
    const projFull = book.project + "项目户内装修工程";
    const mParts = /^\d{4}-\d{2}$/.test(month) ? month.split("-") : null;
    const yy = mParts ? mParts[0] : "2026", M = mParts ? parseInt(mParts[1]) : doc.label;

    // ================= D4 单价弹窗（双模式） =================
    const priceModal = (baseItem, cur) => {
      if (sealed || future) return;
      const ret = UI().modal({
        title: "修改单价 · " + baseItem,
        subtitle: "当月起生效，不追溯历史月（D3 快照）",
        width: 500,
        bodyHTML:
          '<div style="display:flex;flex-direction:column;gap:10px;font-size:13px">' +
          '<label style="display:flex;gap:8px;align-items:flex-start;border:1px solid var(--line);border-radius:8px;padding:10px"><input type="radio" name="pmode" value="uniform" checked style="margin-top:2px">' +
          '<span><b>统一改</b><br><span style="font-size:12px;color:var(--ink-soft)">改「' + baseItem + '」基准单价，所有做该项的人、当月起生效</span></span></label>' +
          '<label style="display:flex;gap:8px;align-items:flex-start;border:1px solid var(--line);border-radius:8px;padding:10px"><input type="radio" name="pmode" value="solo" style="margin-top:2px">' +
          '<span><b>单独改</b><br><span style="font-size:12px;color:var(--ink-soft)">在「' + book.leader + '簿」单独列一项调价（标「调」），后续只有本簿用调整价</span></span></label>' +
          '<label style="font-size:12px;color:var(--ink-soft)">新单价（元）<input id="kit-price-new" type="number" value="' + cur + '" style="width:100%;box-sizing:border-box;border:1px solid var(--line-strong);border-radius:6px;padding:7px 10px;font-size:13px;margin-top:4px;text-align:right;font-family:var(--font-mono)"></label>' +
          '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:2px">' +
          '<button id="kit-price-cfg" style="border:0;background:transparent;color:var(--brand);font-size:12px;cursor:pointer;padding:0">去该工人工资配置 →</button>' +
          '<button id="kit-price-ok" style="border:0;background:var(--brand);color:#fff;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer">确定修改</button>' +
          "</div></div>",
        actions: [{ label: "取消" }],
      });
      const body = ret.body;
      body.querySelector("#kit-price-ok").addEventListener("click", () => {
        const mode = body.querySelector('input[name="pmode"]:checked').value;
        const v = +body.querySelector("#kit-price-new").value || 0;
        if (mode === "uniform") { P.priceUniform(baseItem, v); UI().toast("已统一修改「" + baseItem + "」基准单价 → " + v + " 元（当月起、全部相关簿生效）", "success"); }
        else { P.priceSolo(book.id, baseItem, v); UI().toast("已在本簿单独调价「" + baseItem + "」→ " + v + " 元（仅 " + book.leader + " 簿，标「调」）", "success"); }
        ret.close();
      });
      body.querySelector("#kit-price-cfg").addEventListener("click", () => { ret.close(); UI().toast("打开工资配置（班组 × 项目建档：格式族/补贴/空鼓金额/管理设定/取整规则）"); });
    };
    const priceCell = (l) => {
      const clickable = !sealed && !future && !l.extra && !l.manual && l.baseItem;
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
          {l.adj && <span title="本簿单独调价" style={{ fontSize: 9.5, color: "var(--warn-ink)", background: "var(--warn-soft)", borderRadius: 3, padding: "0 3px" }}>调</span>}
          {l.locked && <Icon name="lock" size={10} color="var(--ink-faint)" />}
          {clickable
            ? <button onClick={() => priceModal(l.baseItem, l.price)} title="点击修改单价（统一改/单独改）"
                style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontFamily: "var(--font-mono)", fontSize: "inherit", fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3, padding: 0 }}>{num0(l.price)}</button>
            : <span>{num0(l.price)}</span>}
        </span>
      );
    };

    // ================= 生命周期动作（D6） =================
    const doCheck = () => UI().confirm({
      title: doc.dirty ? "重新核对该单据？" : "核对完成？",
      message: "确认「" + doc.name + "」清单与请款链无误，标记为「已核对」并记录核对指纹；此后上游工程量/单价变动会提示重核。",
      confirmText: doc.dirty ? "重新核对" : "核对完成",
      onConfirm: () => { P.check(book.id, month); UI().toast("已核对 · " + doc.name, "success"); },
    });
    const doRelease = () => UI().formModal({
      title: "登记发放 · " + doc.label,
      subtitle: "默认=取整应发，可改——以实际最终发放金额为准（D6）；保存后整体快照固化、只读",
      width: 520,
      fields: [
        { key: "actual", label: "实际最终发放金额（元）", type: "number", value: isPiece ? doc.rounded : doc.total, required: true },
        { section: "组内分配（D7：默认全给负责人，可改）" },
        ...book.members.map(m => ({ key: "alloc__" + m, label: m + (m === book.leader ? "（负责人）" : "（组员）"), type: "number", value: (doc.alloc || {})[m] != null ? (doc.alloc || {})[m] : (m === book.leader ? (isPiece ? doc.rounded : doc.total) : 0) })),
      ],
      onSave: (vals) => {
        const alloc = {}; book.members.forEach(m => { alloc[m] = +vals["alloc__" + m] || 0; });
        P.release(book.id, month, +vals.actual || 0, alloc);
        UI().toast("已发放并固化（只读快照） · 付款管理已生成支出记录：工人工资 · " + book.leader + "簿 · " + doc.label + " · ¥" + num0(+vals.actual), "success");
      },
    });
    const doDefer = () => UI().confirm({
      title: doc.deferred ? "恢复支付？" : "暂不支付？",
      message: doc.deferred ? "恢复后可正常登记发放。" : "「暂不支付」= 本月不执行发放动作，应发滚存到后月（不再取整记 0）。",
      confirmText: doc.deferred ? "恢复支付" : "暂不支付",
      danger: !doc.deferred,
      onConfirm: () => { P.defer(book.id, month, !doc.deferred); UI().toast(doc.deferred ? "已恢复支付" : "已标记暂不支付 · 应发滚存", "warning"); },
    });
    const doDeduct = () => UI().confirm({
      title: "开始空鼓扣款？",
      message: "将按当前仍未整改 " + (doc.hollow ? doc.hollow.unfixed : 0) + " 处 × " + (book.config.hollowPrice || 30) + " 元/处 生成扣款行（挂在本次进度请款合计之后、取整之前）；已整改处数销记不扣。",
      confirmText: "开始扣款", danger: true,
      onConfirm: () => { const dd = P.startDeduct(book.id, month); UI().toast("已生成空鼓扣款行：" + dd.spots + " 处 × −" + dd.price + " 元 = −" + num0(dd.spots * dd.price) + " 元", "warning"); },
    });

    // ================= 步骤 ①：核对 =================
    const cTH = { padding: "8px 10px", fontSize: 11.5, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
    const cTD = { padding: "6px 10px", fontSize: 12.5, borderBottom: "1px solid var(--line)" };
    const cNum = { ...cTD, textAlign: "right", fontFamily: "var(--font-mono)" };
    const numInput = (v, on, w) => (
      <input type="number" value={v == null ? "" : v} disabled={sealed || future} onChange={e => on(e.target.value === "" ? 0 : +e.target.value)}
        style={{ width: w || 84, boxSizing: "border-box", border: "1px solid var(--line-strong)", borderRadius: 6, padding: "5px 8px",
          fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right", background: sealed || future ? "var(--surface-2)" : "#fff" }} />
    );

    // —— 清单核对（A/MGR/B 共用，列随族微调）——
    const isB = book.family === "B";
    const isMgr = book.family === "MGR";
    const checkList = isPiece && (
      <Panel padding={0} style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>清单核对 · {doc.label}</span>
          {isB
            ? <StatusChip tone="brand">行从关联合同清单抽取 · 单价锁定</StatusChip>
            : isMgr
              ? <StatusChip tone="warn">管理费单 · 栋×分项汇总 × 费率 自动生成</StatusChip>
              : <StatusChip tone="ok">行由工程量管理聚合生成 · 量只读</StatusChip>}
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
            {isB ? "分组小标题随合同带入；改价走单价弹窗；一口价「项」行只填总价" : "同人合并 · 异人拆行 · 申报量 = 每户量 × 完成层数（勾房记录）；手工调整只起核对作用"}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {isB && <Button size="sm" icon="file-search" onClick={() => {
              const lines = (book.contractLines || []).map(l => l.group ? "▸ " + l.group : "· " + l.name + "（" + (l.lump ? "项·一口价 " + num0(l.price) : num0(l.price) + " 元/" + l.unit) + "）").join("<br>");
              UI().modal({ title: "从合同清单抽取行 · " + (book.config.contract || ""), subtitle: "④-②：单价锁定，分组小标题随合同带入；长项目特征折叠显示、A4 展开", width: 560,
                bodyHTML: '<div style="font-size:12.5px;line-height:2;color:var(--ink)">' + lines + "</div>", actions: [{ label: "关闭" }] });
            }}>合同清单抽取器</Button>}
            {!isB && !isMgr && <Button size="sm" icon="edit-3" onClick={() => navigate("quantity")}>去工程量管理改量/指派</Button>}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: isB ? 940 : 980, borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...cTH, width: 34 }}>序号</th>
              <th style={{ ...cTH, textAlign: "left" }}>{isB ? "施工项目 / 项目特征" : "施工项目（栋+户型+分项）"}</th>
              {!isB && !isMgr && <th style={{ ...cTH, textAlign: "left" }}>施工人</th>}
              <th style={{ ...cTH, width: 46 }}>单位</th>
              {!isB && <th style={{ ...cTH, width: 84, textAlign: "right" }}>{isMgr ? "完成层数" : "每户工程量"}</th>}
              {!isB && !isMgr && <th style={{ ...cTH, width: 72, textAlign: "right" }}>完成层数</th>}
              <th style={{ ...cTH, width: 92, textAlign: "right" }}>申报工程量</th>
              <th style={{ ...cTH, width: 92, textAlign: "right" }}>结算单价</th>
              <th style={{ ...cTH, width: 104, textAlign: "right" }}>金额</th>
              <th style={{ ...cTH, textAlign: "left" }}>备注{!isB ? "（楼层区间自动压缩）" : ""}</th>
            </tr></thead>
            <tbody>
              {doc.lines.map((l, i) => l.group ? (
                <tr key={"g" + i} style={{ background: "var(--surface-2)" }}>
                  <td style={cTD}></td>
                  <td colSpan={isB ? 6 : 8} style={{ ...cTD, fontWeight: 800, color: "var(--ink-soft)" }}>{l.group}（分组小标题 · 随合同带入）</td>
                </tr>
              ) : (
                <tr key={i} style={{ background: l.extra ? "var(--danger-soft)" : "transparent" }}>
                  <td style={{ ...cTD, textAlign: "center", color: "var(--ink-faint)" }}>{doc.lines.slice(0, i + 1).filter(x => !x.group).length}</td>
                  <td style={cTD}>
                    <span style={{ fontWeight: 600 }}>{l.item}</span>
                    {l.lump && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--brand-deep)", background: "var(--brand-soft)", borderRadius: 3, padding: "0 4px" }}>一口价</span>}
                    {l.extra && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--danger-ink)" }}>负价代付</span>}
                    {isB && l.feature && (
                      <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2, maxWidth: 420 }}>
                        {featOpen[i] ? l.feature : l.feature.slice(0, 26) + "…"}
                        <button onClick={() => setFeatOpen(o => ({ ...o, [i]: !o[i] }))}
                          style={{ border: 0, background: "transparent", color: "var(--brand)", cursor: "pointer", fontSize: 11, padding: "0 4px" }}>{featOpen[i] ? "收起" : "展开"}</button>
                      </div>
                    )}
                  </td>
                  {!isB && !isMgr && <td style={{ ...cTD, color: "var(--brand)", fontWeight: 600, whiteSpace: "nowrap" }}>{l.who}</td>}
                  <td style={{ ...cTD, textAlign: "center" }}>{l.unit}</td>
                  {!isB && <td style={{ ...cNum, color: "var(--ink-soft)" }}>{isMgr ? (l.floors != null ? l.floors : "—") : num0(l.perUnit)}</td>}
                  {!isB && !isMgr && <td style={{ ...cNum, color: "var(--ink-soft)" }}>{l.floors}</td>}
                  <td style={cNum}>{l.lump ? l.qty + " 项" : num0(l.qty)}</td>
                  <td style={cNum}>{priceCell(l)}</td>
                  <td style={{ ...cNum, fontWeight: 700, color: l.amount < 0 ? "var(--danger)" : "inherit" }}>{num0(l.amount)}</td>
                  <td style={{ ...cTD, fontSize: 11, color: "var(--ink-soft)" }}>{isB ? "" : (l.floorNote || "")}{!isB && !isMgr && l.rooms && l.rooms !== "整户" ? "（" + l.rooms + "）" : ""}</td>
                </tr>
              ))}
              {doc.subsidies.map((s, i) => (
                <tr key={"s" + i} style={{ background: "var(--surface-2)" }}>
                  <td style={{ ...cTD, textAlign: "center" }}>补</td>
                  <td style={cTD} colSpan={isMgr ? 1 : isB ? 1 : 2}>{s.name}<span style={{ fontSize: 10.5, color: "var(--ink-faint)", marginLeft: 6 }}>分项级「计房租」标志 · 仅墙/地砖</span></td>
                  <td style={{ ...cTD, textAlign: "center" }}>㎡</td>
                  {!isB && <td style={cNum}></td>}
                  {!isB && !isMgr && <td style={cNum}></td>}
                  <td style={cNum}>{num0(s.qty)}</td>
                  <td style={cNum}>{num0(s.price)}</td>
                  <td style={{ ...cNum, fontWeight: 700 }}>{num0(s.amount)}</td>
                  <td style={cTD}></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 空鼓（D5/⑥）：户记录聚合只读；进度月只列示；手动启动扣款 */}
        {doc.hollow && (
          <div style={{ borderTop: "1px solid var(--line)", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 800 }}>空鼓（从户记录自动聚合 · 只读）</span>
              <StatusChip tone={doc.hollow.unfixed > 0 ? "warn" : "ok"}>{doc.hollow.unfixed > 0 ? "未整改 " + doc.hollow.unfixed + " 处" : "已全部整改"}</StatusChip>
              <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>共 {doc.hollow.spots} 处 · 已整改销记 {doc.hollow.fixed} 处（不扣）</span>
              <span style={{ marginLeft: "auto" }}>
                {!doc.deduct && doc.hollow.unfixed > 0 && !sealed && !future && (
                  <Button size="sm" variant="danger" icon="circle-minus" onClick={doDeduct}>开始扣款（{doc.hollow.unfixed} 处 × {book.config.hollowPrice || 30} 元）</Button>
                )}
                {doc.deduct && !sealed && (
                  <Button size="sm" icon="undo-2" onClick={() => { P.cancelDeduct(book.id, month); UI().toast("已撤销本月空鼓扣款行"); }}>撤销扣款行</Button>
                )}
              </span>
            </div>
            {leaderRoster && leaderRoster.exit && doc.hollow.unfixed > 0 && !doc.deduct && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: 8, padding: "8px 12px" }}>
                <Icon name="user-x" size={14} color="var(--danger-ink)" />
                <span style={{ fontSize: 12, color: "var(--danger-ink)", fontWeight: 600 }}>
                  {book.leader} 已于 {leaderRoster.exit} 退场，仍有 {doc.hollow.unfixed} 处未整改空鼓（离职必扣）——是否开始扣款？
                </span>
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              明细（自动生成）：{doc.hollow.text || "暂未排查"}
              {doc.deduct
                ? <b style={{ color: "var(--danger-ink)", marginLeft: 8 }}>已启动扣款：{doc.deduct.spots} 处 × −{doc.deduct.price} 元 = −{num0(doc.deduct.spots * doc.deduct.price)} 元（挂请款合计后、取整前）</b>
                : <span style={{ marginLeft: 8, color: "var(--ink-faint)" }}>进度月仅列示、不扣款（工人在场期间自行维修；典型启动时机=离职不再回场）</span>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {doc.hollow.list.map((h, i) => (
                <span key={i} style={{ fontSize: 11, border: "1px solid var(--line)", borderRadius: 6, padding: "2px 8px", background: h.spots - h.fixed > 0 ? "var(--warn-soft)" : "var(--surface-2)", color: h.spots - h.fixed > 0 ? "var(--warn-ink)" : "var(--ink-faint)" }}>
                  {h.b}{h.f}楼{h.u} {h.item} · {h.spots}处{h.fixed ? "（已整改 " + h.fixed + "）" : ""} · {h.who}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 请款链（D8-1 行序）+ 单据级比例（⑦） */}
        <div style={{ padding: "12px 16px", background: "var(--surface-2)", borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
            <span>合计（含补贴） <b style={{ fontFamily: "var(--font-mono)" }}>{num0(doc.total)}</b></span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>× 支付比例
              {draft || (checked && !sealed)
                ? numInput(doc.ratio, v => P.setRatio(book.id, month, v), 62)
                : <b style={{ fontFamily: "var(--font-mono)" }}>{doc.ratio}</b>}%
              <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>单据级参数 · 默认沿用上月</span>
            </span>
            <span>= 应领 <b style={{ fontFamily: "var(--font-mono)" }}>{num0(doc.payable)}</b></span>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
            {doc.prevPaid.map(pp => <span key={pp.key} style={{ color: "var(--ink-soft)" }}>− {pp.label} <b style={{ fontFamily: "var(--font-mono)" }}>{num0(pp.amount)}</b></span>)}
            {!doc.prevPaid.length && <span style={{ color: "var(--ink-faint)" }}>（无往月已领{isB && doc.kind === "month" ? " · B 族进度月为当月直报简化链" : ""}）</span>}
            <span>→ 本次进度请款合计 <b style={{ fontFamily: "var(--font-mono)" }}>{num0(doc.request)}</b></span>
            {doc.deduct && <span style={{ color: "var(--danger-ink)" }}>− 空鼓扣款（{doc.deduct.spots}处×{doc.deduct.price}元） <b style={{ fontFamily: "var(--font-mono)" }}>{num0(-doc.deduct.amount)}</b></span>}
            <span style={{ marginLeft: "auto", fontWeight: 800, color: "var(--brand-deep)" }}>取整应发 <b style={{ fontFamily: "var(--font-mono)", fontSize: 15 }}>{num0(doc.rounded)}</b></span>
            {doc.actualPaid != null && <span style={{ fontWeight: 800, color: "var(--ok-ink)" }}>实际发放 <b style={{ fontFamily: "var(--font-mono)", fontSize: 15 }}>{num0(doc.actualPaid)}</b></span>}
          </div>
        </div>

        {/* 组内分配 + 借支（D7） */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>组内分配（取整请款额 → 每人应发；默认全给负责人）</div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            {book.members.map(m => {
              const alloc = (doc.alloc || {})[m] || 0;
              const borrow = (mo.borrow || {})[m] || 0;
              return (
                <div key={m} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>{m}{m === book.leader && <span style={{ fontSize: 10, color: "var(--brand-deep)", background: "var(--brand-soft)", borderRadius: 3, padding: "0 4px", marginLeft: 4 }}>负责人</span>}</span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>分配</span>
                  {sealed ? <b style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{num0(alloc)}</b>
                    : numInput(alloc, v => { const a = { ...(doc.alloc || {}) }; a[m] = v; P.setAlloc(book.id, month, a); }, 92)}
                  <span style={{ fontSize: 11.5, color: "var(--danger-ink)" }}>借支</span>
                  {sealed ? <b style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{num0(borrow)}</b>
                    : numInput(borrow, v => P.setBorrow(book.id, month, m, v), 76)}
                  <span style={{ fontSize: 11.5 }}>实发 <b style={{ fontFamily: "var(--font-mono)", color: "var(--brand)" }}>{num0(alloc - borrow)}</b></span>
                </div>
              );
            })}
            {(() => {
              const allocSum = book.members.reduce((s, m) => s + ((doc.alloc || {})[m] || 0), 0);
              const target = doc.actualPaid != null ? doc.actualPaid : doc.rounded;
              return Math.abs(allocSum - target) > 0.5
                ? <span style={{ alignSelf: "center", fontSize: 12, color: "var(--warn-ink)", fontWeight: 600 }}>Σ分配 {num0(allocSum)} ≠ {doc.actualPaid != null ? "实际发放" : "取整应发"} {num0(target)}，请核对</span>
                : null;
            })()}
          </div>
        </div>
      </Panel>
    );

    // —— C1 月薪时工核对 ——
    const checkC1 = book.family === "C1" && (
      <Panel padding={0} style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>时工核对 · {doc.label}</span>
          <StatusChip tone="ok">C1 · 100% 直付 · 无比例无取整</StatusChip>
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>加班时薪默认 = 日薪 ÷ 8（400 → 50 元/时实证），可按人另设</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 860, borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...cTH, textAlign: "left" }}>姓名</th>
              {["日薪(元)", "出勤(天)", "应发", "加班时数", "加班时薪", "加班工资", "借支", "实发"].map(h => <th key={h} style={{ ...cTH, textAlign: "right" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {doc.rows.map(r => (
                <tr key={r.name}>
                  <td style={{ ...cTD, fontWeight: 700, color: "var(--brand)" }}>{r.name}</td>
                  <td style={cNum}>{sealed ? num0(r.daily) : numInput(r.daily, v => P.update(book.id, b => { b.config.daily[r.name] = v; }), 76)}</td>
                  <td style={cNum}>{sealed ? r.days : numInput(r.days, v => P.update(book.id, b => { b.months[month].days[r.name] = v; }), 64)}</td>
                  <td style={cNum}>{num0(r.gross)}</td>
                  <td style={cNum}>{sealed ? r.otHours : numInput(r.otHours, v => P.update(book.id, b => { b.months[month].otHours = b.months[month].otHours || {}; b.months[month].otHours[r.name] = v; }), 60)}</td>
                  <td style={cNum}>{sealed ? num0(r.otRate) : numInput(r.otRate, v => P.update(book.id, b => { b.config.otRate = b.config.otRate || {}; b.config.otRate[r.name] = v; }), 64)}</td>
                  <td style={cNum}>{num0(r.otAmt)}</td>
                  <td style={cNum}>{sealed ? num0(r.borrow) : numInput(r.borrow, v => P.setBorrow(book.id, month, r.name, v), 72)}</td>
                  <td style={{ ...cNum, fontWeight: 800, color: "var(--brand)" }}>{num0(r.net)}</td>
                </tr>
              ))}
              <tr style={{ background: "var(--surface-2)" }}>
                <td style={{ ...cTD, fontWeight: 800 }}>合计</td>
                <td colSpan={7}></td>
                <td style={{ ...cNum, fontWeight: 800, color: "var(--brand)" }}>{num0(doc.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    );

    // —— C2 零星签工核对 ——
    const checkC2 = book.family === "C2" && (
      <Panel padding={0} style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>零星签工核对 · {doc.label}</span>
          <StatusChip tone="ok">C2 · 签工确认制 · 大工 {book.config.bigPrice} 元/工 · 半工=0.5 工</StatusChip>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 880, borderCollapse: "collapse" }}>
            <thead><tr>
              {["日期", "施工内容", "起止时间", "用工人", "用工数", "证明人", "确认日期"].map((h, i) => <th key={h} style={{ ...cTH, textAlign: i === 1 ? "left" : "center" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {doc.logs.map((l, i) => (
                <tr key={i}>
                  <td style={{ ...cTD, textAlign: "center", fontFamily: "var(--font-mono)" }}>{l.d}</td>
                  <td style={cTD}>{l.content}</td>
                  <td style={{ ...cTD, textAlign: "center", fontFamily: "var(--font-mono)" }}>{l.span}</td>
                  <td style={{ ...cTD, textAlign: "center", fontWeight: 700, color: "var(--brand)" }}>{l.who}</td>
                  <td style={{ ...cTD, textAlign: "center" }}>{l.units === 0.5 ? "半" : "壹"}</td>
                  <td style={{ ...cTD, textAlign: "center" }}>{l.witness}</td>
                  <td style={{ ...cTD, textAlign: "center", fontFamily: "var(--font-mono)", color: l.confirm ? "var(--ok-ink)" : "var(--danger)" }}>{l.confirm || "未确认"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 16px", background: "var(--surface-2)", borderTop: "1px solid var(--line)", display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12.5 }}>
          {doc.rows.map(r => <span key={r.name}>{r.name} <b style={{ fontFamily: "var(--font-mono)" }}>{r.units}</b> 工 × {r.price} = <b style={{ fontFamily: "var(--font-mono)" }}>{num0(r.amount)}</b></span>)}
          <span style={{ marginLeft: "auto", fontWeight: 800, color: "var(--brand-deep)" }}>合计 <b style={{ fontFamily: "var(--font-mono)", fontSize: 15 }}>{num0(doc.total)}</b></span>
        </div>
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4 }}>确认规则脚注（单据级可编辑文字）</div>
          {sealed
            ? <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.7 }}>{doc.footNote}</div>
            : <textarea value={doc.footNote} onChange={e => P.update(book.id, b => { b.months[month].footNote = e.target.value; })}
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--line-strong)", borderRadius: 6, padding: "8px 10px", fontSize: 12, minHeight: 56, lineHeight: 1.6 }} />}
        </div>
      </Panel>
    );

    // ================= 步骤 ②：A4 单据（格式族） =================
    const chainRow = (no, label, val, opts) => {
      const lead = (opts && opts.lead) || 6, tail = (opts && opts.tail) || 1;
      return (
        <tr key={"ch" + label + no}>
          <td style={TDc}>{no || ""}</td>
          <td style={{ ...TD, fontWeight: (opts && opts.bold) ? 800 : 400, color: (opts && opts.color) || "#1a1a1a" }} colSpan={lead}>{label}</td>
          <td style={{ ...TDr, fontWeight: (opts && opts.bold) ? 800 : 400, fontSize: (opts && opts.bold) ? 12.5 : 11.5, color: (opts && opts.color) || "#1a1a1a" }}>{num0(val)}</td>
          {tail > 0 && <td style={TD} colSpan={tail}></td>}
        </tr>
      );
    };
    const wm = doc.deferred ? "暂 不 支 付" : null;
    const seqLine = (
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#555", margin: "2px 0 6px" }}>
        <span>单据编号：{doc.seqNo ? "第 " + doc.seqNo + " 号（全项目递增）" : "发放时定号（下一号 " + P.nextSeq(book.project) + "）"}</span>
        <span>{doc.name}</span>
      </div>
    );

    // —— A/MGR 清单页 ——
    const pageListA = (book.family === "A" || isMgr) && (() => {
      let chainNo = (doc.lines || []).filter(l => !l.group).length + (doc.subsidies || []).length;
      const hollowRowNo = doc.hollow && !doc.deduct ? ++chainNo : null;   // 空鼓文字行占一号（D8-2 进度月仅列示）
      const chain = [];
      chain.push(chainRow(++chainNo, "合计", doc.total, { bold: true }));
      chain.push(chainRow(++chainNo, "本次请款总合计" + doc.ratio + "%", doc.payable));
      doc.prevPaid.forEach(pp => chain.push(chainRow(++chainNo, pp.label, pp.amount)));
      if (doc.prevPaid.length) chain.push(chainRow(++chainNo, "累计已申领进度款", doc.paidSum));
      chain.push(chainRow(++chainNo, "本次进度请款合计", doc.request));
      if (doc.deduct) chain.push(chainRow(++chainNo, "空鼓扣款（" + doc.deduct.spots + "处 × −" + doc.deduct.price + "元）", doc.deduct.amount, { color: "#b42318" }));
      chain.push(chainRow(++chainNo, "本次进度请款合计（取整）", doc.rounded, { bold: true }));
      if (doc.actualPaid != null) chain.push(chainRow("", "实际发放金额（以实际为准）", doc.actualPaid, { bold: true, color: "#166534" }));
      return (
        <A4 watermark={wm} orient={orient.list} onFlip={() => flip("list")} label={"第 1 页 · " + (isMgr ? "管理费单" : "工程量进度清单")}>
          <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800 }}>
            {isMgr ? book.crew + M + "月管理费单（" + book.leader + "）" : book.trade + "班组" + M + "月工程量进度清单（" + book.leader + (book.soloNote ? "·单独" : "") + "）"}
          </div>
          {seqLine}
          <div style={{ fontSize: 11, margin: "0 0 8px", color: "#333" }}>工程名称：{projFull}　　　　班组：{book.crew}　　　　时间：{mParts ? yy + "." + mParts[1] : doc.label}</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...TH, width: 32 }} rowSpan={2}>序号</th>
                <th style={TH} rowSpan={2}>施工项目</th>
                <th style={{ ...TH, width: 36 }} rowSpan={2}>单位</th>
                <th style={{ ...TH, width: 64 }} rowSpan={2}>{isMgr ? "—" : "每户工程量"}</th>
                <th style={{ ...TH, width: 64 }} rowSpan={2}>施工完成层数</th>
                <th style={TH} colSpan={3}>暂定结算数量及金额</th>
                <th style={{ ...TH, width: 158 }} rowSpan={2}>备注（楼层）</th>
              </tr>
              <tr>
                <th style={{ ...TH, width: 74 }}>申报工程量</th>
                <th style={{ ...TH, width: 58 }}>结算单价</th>
                <th style={{ ...TH, width: 82 }}>金　　额</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => (
                <tr key={i}>
                  <td style={TDc}>{i + 1}</td>
                  <td style={TD}>{l.item}</td>
                  <td style={TDc}>{l.unit}</td>
                  <td style={TDr}>{l.perUnit != null ? l.perUnit : ""}</td>
                  <td style={TDc}>{l.floors != null ? l.floors : ""}</td>
                  <td style={TDr}>{num0(l.qty)}</td>
                  <td style={{ ...TDr, color: l.price < 0 ? "#b42318" : "#1a1a1a" }}>{num0(l.price)}</td>
                  <td style={{ ...TDr, color: l.amount < 0 ? "#b42318" : "#1a1a1a" }}>{num0(l.amount)}</td>
                  <td style={{ ...TD, fontSize: 10 }}>{l.floorNote || ""}{l.extra ? "代付冲抵" : ""}</td>
                </tr>
              ))}
              {doc.subsidies.map((s, i) => (
                <tr key={"s" + i}>
                  <td style={TDc}>{"一"}</td>
                  <td style={TD}>{s.name}</td>
                  <td style={TDc}>㎡</td>
                  <td style={TD}></td><td style={TD}></td>
                  <td style={TDr}>{num0(s.qty)}</td>
                  <td style={TDr}>{num0(s.price)}</td>
                  <td style={TDr}>{num0(s.amount)}</td>
                  <td style={TD}></td>
                </tr>
              ))}
              {/* 空鼓时序（D8-2/⑥）：进度月仅列示文字行；启动扣款后才在链上出扣款行 */}
              {hollowRowNo != null && (
                <tr>
                  <td style={TDc}>{hollowRowNo}</td>
                  <td style={TD}>空鼓数据</td>
                  <td style={{ ...TD, fontSize: 10.5, color: "#333" }} colSpan={7}>{doc.hollow.text ? doc.hollow.text + "（仅列示，暂不扣款；整改销记后不扣）" : "暂未排查"}</td>
                </tr>
              )}
              {chain}
            </tbody>
          </table>
          <Sign />
          <div style={{ fontSize: 9, color: "#555", marginTop: 10, lineHeight: 1.8 }}>
            注：　1、各施工人员依据现场施工的相关约定，在申请工程进度款时，首先根据现场实际完成工程量认真准确地填写此清单（附表）<br />
            2、将填写好的清单（附表）交于现场项目组负责人处，同时可要求我司现场项目组配合确认清单（附表）内容。<br />
            3、现场空鼓由施工人在场期间自行维修，离职或启动扣款后按未整改处数扣除。<br />
            4、本人对工程单价、工资金额及银行扣税均确认无议。<br />
            5、本人在现场项目负责人处填写正表及相关内容，我司财务将根据正、附表确认签名情况，在收表审批签名后十五天内安排付款事宜。
          </div>
        </A4>
      );
    })();

    // —— B 族清单页（分组小标题 + 项目特征长文展开 + 一口价「项」行 + 简化链）——
    const pageListB = isB && (() => {
      let no = 0, cn = 0;
      const dataCnt = doc.lines.filter(l => !l.group).length;
      cn = dataCnt;
      const chain = [];
      chain.push(chainRow(++cn, "合计", doc.total, { bold: true, lead: 5, tail: 1 }));
      chain.push(chainRow(++cn, "本次请款总合计" + doc.ratio + "%", doc.payable, { lead: 5, tail: 1 }));
      doc.prevPaid.forEach(pp => chain.push(chainRow(++cn, pp.label, pp.amount, { lead: 5, tail: 1 })));
      if (doc.prevPaid.length) chain.push(chainRow(++cn, "累计已申领", doc.paidSum, { lead: 5, tail: 1 }));
      chain.push(chainRow(++cn, "本次请款合计", doc.request, { lead: 5, tail: 1 }));
      chain.push(chainRow(++cn, "本次请款合计（取整）", doc.rounded, { bold: true, lead: 5, tail: 1 }));
      if (doc.actualPaid != null) chain.push(chainRow("", "实际发放金额（以实际为准）", doc.actualPaid, { bold: true, color: "#166534", lead: 5, tail: 1 }));
      return (
        <A4 watermark={wm} orient={orient.list} onFlip={() => flip("list")} label="第 1 页 · 工程量申报清单（BOQ 直报）">
          <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800 }}>{book.trade}班组{doc.kind === "month" ? M + "月" : doc.label}工程量申报清单（{book.leader}）</div>
          {seqLine}
          <div style={{ fontSize: 11, margin: "0 0 8px", color: "#333" }}>工程名称：{projFull}　　　　关联合同：{book.config.contract}　　　　时间：{doc.kind === "month" ? yy + "." + mParts[1] : doc.label}</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...TH, width: 32 }}>序号</th>
                <th style={{ ...TH, width: 130 }}>施工项目</th>
                <th style={TH}>项目特征</th>
                <th style={{ ...TH, width: 36 }}>单位</th>
                <th style={{ ...TH, width: 70 }}>申报数量</th>
                <th style={{ ...TH, width: 58 }}>单价</th>
                <th style={{ ...TH, width: 82 }}>金　　额</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => l.group ? (
                <tr key={"g" + i}>
                  <td style={{ ...TD, background: "#f0f0f0", fontWeight: 800 }} colSpan={7}>{l.group}</td>
                </tr>
              ) : (
                <tr key={i}>
                  <td style={TDc}>{++no}</td>
                  <td style={TD}>{l.item}{l.lump ? "（一口价）" : ""}</td>
                  <td style={{ ...TD, fontSize: 10, lineHeight: 1.5 }}>{l.feature || ""}</td>
                  <td style={TDc}>{l.unit}</td>
                  <td style={TDr}>{l.lump ? l.qty + " 项" : num0(l.qty)}</td>
                  <td style={TDr}>{l.lump ? "" : num0(l.price)}</td>
                  <td style={TDr}>{num0(l.amount)}</td>
                </tr>
              ))}
              {chain}
            </tbody>
          </table>
          <Sign />
          <div style={{ fontSize: 9, color: "#555", marginTop: 10, lineHeight: 1.8 }}>
            注：1、清单行自关联分包合同清单抽取，单价按合同锁定；一口价「项」行按项计总价，不计数量单价。<br />
            2、进度月按当月完成量直报（简化链，无房租/空鼓）；结算 95% / 尾款 100% 按累计申报量与累计已领结清。
          </div>
        </A4>
      );
    })();

    // —— 工资表页（⑤ 审批载体：签字确认并按手印 + 四签名栏；D7 负责人+组员多行）——
    const isC1 = book.family === "C1";
    const wagePage = (
      <A4 watermark={wm} orient={orient.wage} onFlip={() => flip("wage")} label={"工人工资表（负责人+组员多行 · 审批载体）"}>
        <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800 }}>{mParts ? yy + " 年" + M + "月" : doc.label}{book.trade}工人工资表（{book.leader}簿）</div>
        {seqLine}
        <div style={{ fontSize: 11, margin: "0 0 8px", color: "#333" }}>工程名称：{projFull}　　　　施工单位/班组（工种）：{book.crew}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 32 }}>序号</th>
              <th style={TH}>姓名</th>
              {isC1 && <th style={{ ...TH, width: 62 }}>日/月薪资</th>}
              <th style={{ ...TH, width: 56 }}>出勤天数</th>
              <th style={{ ...TH, width: 74 }}>应发工资</th>
              {isC1 && <th style={{ ...TH, width: 62 }}>加班工资</th>}
              <th style={{ ...TH, width: 56 }}>借支</th>
              <th style={{ ...TH, width: 74 }}>实发工资</th>
              <th style={{ ...TH, width: 86 }}>签字确认并按手印</th>
              <th style={{ ...TH, width: 56 }}>户名</th>
              <th style={{ ...TH, width: 90 }}>联系电话</th>
              <th style={TH}>账号</th>
              <th style={TH}>支行名称</th>
              <th style={{ ...TH, width: 52 }}>备注</th>
            </tr>
          </thead>
          <tbody>
            {doc.wageRows.map((r, i) => {
              const c1 = isC1 ? doc.rows.find(x => x.name === r.name) : null;
              return (
                <tr key={r.name}>
                  <td style={TDc}>{i + 1}</td>
                  <td style={TDc}>{r.name}{r.name === book.leader ? "（负责人）" : ""}</td>
                  {isC1 && <td style={TDr}>{c1 ? num0(c1.daily) : ""}</td>}
                  <td style={TDc}>{r.attN}</td>
                  <td style={TDr}>{num0(isC1 ? (c1 ? c1.gross : 0) : r.amount)}</td>
                  {isC1 && <td style={TDr}>{c1 && c1.otAmt ? num0(c1.otAmt) : ""}</td>}
                  <td style={TDr}>{num0(isC1 ? (c1 ? c1.borrow : 0) : r.borrow)}</td>
                  <td style={{ ...TDr, fontWeight: 700 }}>{num0(isC1 ? (c1 ? c1.net : 0) : r.net)}</td>
                  <td style={TD}></td>
                  <td style={TDc}>{r.bank ? r.bank.holder : ""}</td>
                  <td style={{ ...TDc, fontFamily: "var(--font-mono)", fontSize: 10.5 }}>{r.bank ? r.bank.phone : ""}</td>
                  <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 10.5 }}>{r.bank ? r.bank.account : ""}</td>
                  <td style={{ ...TD, fontSize: 10.5 }}>{r.bank ? r.bank.branch : ""}</td>
                  <td style={{ ...TD, fontSize: 10 }}>{doc.deferred ? "暂不支付" : ""}</td>
                </tr>
              );
            })}
            <tr>
              <td style={{ ...TD, textAlign: "right", fontWeight: 700 }} colSpan={isC1 ? 4 : 3}>合计：</td>
              <td style={TDr}>{num0(isC1 ? doc.rows.reduce((s, x) => s + x.gross, 0) : doc.wageRows.reduce((s, x) => s + x.amount, 0))}</td>
              {isC1 && <td style={TDr}>{num0(doc.rows.reduce((s, x) => s + x.otAmt, 0))}</td>}
              <td style={TDr}>{num0(isC1 ? doc.rows.reduce((s, x) => s + x.borrow, 0) : doc.wageRows.reduce((s, x) => s + x.borrow, 0))}</td>
              <td style={{ ...TDr, fontWeight: 700 }}>{num0(isC1 ? doc.total : doc.wageTotal)}</td>
              <td style={TD} colSpan={6}></td>
            </tr>
          </tbody>
        </table>
        <Sign />
        <div style={{ fontSize: 9, color: "#555", marginTop: 10, lineHeight: 1.8 }}>
          1、该表格由班组负责编制，若由于以上收款信息有误，引起的一切经济纠纷由班组负责人承担，与付款方无关。签字都需要加按指印。本表一式三份，现场项目部、施工班组、财务部各一份。<br />
          2、本人对工程单价、工资金额及银行扣税均确认无议。{isC1 ? "　3、加班时薪默认按日薪 ÷ 8 计。" : ""}
        </div>
      </A4>
    );

    // —— 考勤表页（多行）——
    const attPage = (
      <A4 watermark={wm} orient={orient.att} onFlip={() => flip("att")} label="工人考勤表（多行）">
        <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800 }}>{mParts ? yy + " 年" + M + "月" : doc.label}{book.trade}工人考勤表（{book.leader}簿）</div>
        <div style={{ fontSize: 11, margin: "6px 0 8px", color: "#333" }}>工程名称：{projFull}　　　　施工单位/班组（工种）：{book.crew}</div>
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
            {doc.wageRows.map((r, i) => (
              <tr key={r.name}>
                <td style={TDc}>{i + 1}</td>
                <td style={TDc}>{r.name}</td>
                <td style={TDc}>{mParts ? M : doc.label}</td>
                {Array.from({ length: 31 }, (_, j) => <td key={j} style={{ ...TDc, padding: "4px 2px", fontSize: 10 }}>{r.att[j] || ""}</td>)}
                <td style={{ ...TDc, fontWeight: 700 }}>{r.attN}</td>
                <td style={TD}></td>
                <td style={TD}></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 10.5, marginTop: 14 }}>班组签名：　　　　　　　施工员签名：　　　　　　　安全员签名：　　　　　　　现场负责人签名：</div>
      </A4>
    );

    // —— 名册登记表页（D8-10，挂班组工人域）——
    const rosterRows = (P.roster[book.crew] || []);
    const rosterPage = rosterRows.length > 0 && (
      <A4 orient={orient.roster} onFlip={() => flip("roster")} label="名册登记表（D8-10 · 在班/离职统计来源）">
        <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800 }}>{book.crew}名册登记表</div>
        <div style={{ fontSize: 11, margin: "6px 0 8px", color: "#333" }}>工程名称：{projFull}　　　　在班 {rosterRows.filter(r => !r.exit).length} 人 · 离职 {rosterRows.filter(r => r.exit).length} 人</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["序号", "姓名", "性别", "籍贯", "身份证号码", "劳动合同签订", "入场日期", "退场日期", "证件照", "银行卡照"].map((h, i) => <th key={h} style={{ ...TH, width: [30, 64, 32, 72, 150, 84, 74, 74, 44, 48][i] }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rosterRows.map((r, i) => (
              <tr key={r.name}>
                <td style={TDc}>{i + 1}</td>
                <td style={TDc}>{r.name}</td>
                <td style={TDc}>{r.gender}</td>
                <td style={TDc}>{r.origin}</td>
                <td style={{ ...TDc, fontFamily: "var(--font-mono)", fontSize: 10.5 }}>{r.idNo}</td>
                <td style={{ ...TDc, fontSize: 10.5 }}>{r.contract}</td>
                <td style={{ ...TDc, fontFamily: "var(--font-mono)", fontSize: 10.5 }}>{r.entry}</td>
                <td style={{ ...TDc, fontFamily: "var(--font-mono)", fontSize: 10.5, color: r.exit ? "#b42318" : "#999" }}>{r.exit || "—"}</td>
                <td style={TDc}>{r.photo ? "☑" : "□"}</td>
                <td style={TDc}>{r.bankPhoto ? "☑" : "□"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 9, color: "#555", marginTop: 10, lineHeight: 1.8 }}>
          注：名册由班组建档时登记、进退场当日更新；「在班/离职」人数状态与工资核算瀑布卡联动；离职且有未整改空鼓时提示启动扣款。
        </div>
      </A4>
    );

    // —— C2 零星用工记录表页 ——
    const logPage = book.family === "C2" && (
      <A4 watermark={wm} orient={orient.log} onFlip={() => flip("log")} label="班组零星用工记录表（C2）">
        <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800 }}>班组零星用工记录表（{book.project} · {mParts ? M + "月" : doc.label}）</div>
        {seqLine}
        <div style={{ fontSize: 11, margin: "0 0 8px", color: "#333" }}>工程名称：{projFull}　　　　班组：{book.crew}　　　　大工单价：{book.config.bigPrice} 元/工（半工按 0.5 工计）</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>{["序号", "日期", "施工内容", "起止时间", "用工人", "用工数", "证明人", "确认日期"].map((h, i) => <th key={h} style={{ ...TH, width: [30, 52, undefined, 76, 56, 44, 52, 60][i] }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {doc.logs.map((l, i) => (
              <tr key={i}>
                <td style={TDc}>{i + 1}</td>
                <td style={{ ...TDc, fontFamily: "var(--font-mono)" }}>{l.d}</td>
                <td style={TD}>{l.content}</td>
                <td style={{ ...TDc, fontFamily: "var(--font-mono)", fontSize: 10.5 }}>{l.span}</td>
                <td style={TDc}>{l.who}</td>
                <td style={TDc}>{l.units === 0.5 ? "半" : "壹"}</td>
                <td style={TDc}>{l.witness}</td>
                <td style={{ ...TDc, fontFamily: "var(--font-mono)", fontSize: 10.5 }}>{l.confirm || ""}</td>
              </tr>
            ))}
            {doc.rows.map(r => (
              <tr key={"t" + r.name}>
                <td style={TD} colSpan={4}></td>
                <td style={{ ...TDc, fontWeight: 700 }}>{r.name}</td>
                <td style={{ ...TDr, fontWeight: 700 }} colSpan={2}>{r.units} 工 × {r.price}</td>
                <td style={{ ...TDr, fontWeight: 700 }}>{num0(r.amount)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...TD, textAlign: "right", fontWeight: 800 }} colSpan={7}>合计：</td>
              <td style={{ ...TDr, fontWeight: 800 }}>{num0(doc.total)}</td>
            </tr>
          </tbody>
        </table>
        <Sign />
        <div style={{ fontSize: 9, color: "#555", marginTop: 10, lineHeight: 1.8 }}>{doc.footNote}</div>
      </A4>
    );

    const a4Pages = book.family === "C2" ? [logPage, wagePage]
      : book.family === "C1" ? [wagePage, attPage]
      : isMgr ? [pageListA, wagePage]
      : isB ? [pageListB, wagePage, attPage]
      : [pageListA, wagePage, attPage, rosterPage];

    // ================= 壳：面包屑 + 三态 + 两步切换 + 月份 =================
    const stepBtn = (k, label) => (
      <button type="button" onClick={() => setStep(k)}
        style={{ border: "1px solid", borderColor: step === k ? "var(--brand)" : "var(--line)", borderRadius: 8,
          padding: "6px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer",
          background: step === k ? "var(--brand)" : "var(--surface-2)", color: step === k ? "#fff" : "var(--ink-soft)" }}>{label}</button>
    );
    const triNode = (label, on, done) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: on ? 800 : 600,
        color: on ? "var(--brand-deep)" : done ? "var(--ok-ink)" : "var(--ink-faint)" }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: on ? "var(--brand)" : done ? "var(--ok)" : "var(--line-strong)" }}></span>{label}
      </span>
    );
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-soft)", flexWrap: "wrap" }}>
          <button onClick={() => navigate("payroll", {})} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="chevron-left" size={14} />工资核算</button>
          <span>/</span>
          <button onClick={() => navigate("payroll", { project: book.project })} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>{book.project}</button>
          <span>/</span>
          <button onClick={() => navigate("payroll", { project: book.project, crew: book.crew, month })} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>{book.crew}</button>
          <span>/</span>
          <span style={{ color: "var(--ink)", fontWeight: 700 }}>{book.leader}簿 · {doc.label}</span>
          {doc.seqNo && <span style={{ fontSize: 11, color: "var(--ink-soft)", background: "var(--surface-3)", borderRadius: 4, padding: "1px 7px", fontFamily: "var(--font-mono)" }}>第 {doc.seqNo} 号</span>}
          {book.family === "MGR" && <StatusChip tone="warn">管理费单 · 自动生成</StatusChip>}
          {book.soloNote && <StatusChip tone="neutral">单独出单</StatusChip>}
          {doc.deferred && <StatusChip tone="danger">暂不支付 · 滚存</StatusChip>}
          {sealed && <StatusChip tone="ok">已固化 · 只读</StatusChip>}
        </div>

        {(book.soloNote || book.autoNote) && (
          <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="info" size={14} color="var(--brand)" />
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{book.soloNote || book.autoNote}</span>
          </Panel>
        )}
        {doc.dirty && (
          <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--warn-soft)", borderColor: "var(--warn)" }}>
            <Icon name="triangle-alert" size={15} color="var(--warn-ink)" />
            <span style={{ fontSize: 12.5, color: "var(--warn-ink)", fontWeight: 600 }}>核对后上游工程量/单价发生变动——有变动、需重核（D6-2）。</span>
            <span style={{ marginLeft: "auto" }}><Button size="sm" icon="rotate-ccw" onClick={doCheck}>重新核对</Button></span>
          </Panel>
        )}

        <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {stepBtn("check", "① 核对")}
          <Icon name="chevron-right" size={14} color="var(--ink-faint)" />
          {stepBtn("a4", "② A4 单据 · 打印")}
          <span style={{ width: 1, height: 20, background: "var(--line)", margin: "0 4px" }} />
          <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
            {triNode("草稿", draft, checked || sealed)}<Icon name="chevron-right" size={12} color="var(--ink-faint)" />
            {triNode("已核对", checked, sealed)}<Icon name="chevron-right" size={12} color="var(--ink-faint)" />
            {triNode("已发放·固化", sealed, false)}
          </span>
          <span style={{ width: 1, height: 20, background: "var(--line)", margin: "0 4px" }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-soft)" }}>月份：</span>
          {book.monthSeq.map(mk => {
            const m2 = book.months[mk];
            const on = mk === month;
            return (
              <button key={mk} onClick={() => setMonth(mk)}
                style={{ border: "1px solid", borderColor: on ? "var(--brand)" : "var(--line)", borderRadius: 999,
                  padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono)",
                  background: on ? "var(--brand-soft)" : m2.status === "未到" ? "var(--surface-2)" : "#fff",
                  color: on ? "var(--brand-deep)" : m2.status === "未到" ? "var(--ink-faint)" : m2.status === "已发放" ? "var(--ok-ink)" : "var(--ink-soft)" }}>
                {P.monthLabel(mk, m2)}{m2.ratio != null && !/%/.test(P.monthLabel(mk, m2)) ? " · " + m2.ratio + "%" : ""}
              </button>
            );
          })}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {step === "check" && draft && !future && <Button size="sm" variant="primary" icon="circle-check" onClick={doCheck}>核对完成 →</Button>}
            {step === "check" && checked && (<>
              <Button size="sm" variant="primary" icon="banknote" onClick={doRelease}>登记发放…</Button>
              <Button size="sm" icon={doc.deferred ? "play" : "pause"} onClick={doDefer}>{doc.deferred ? "恢复支付" : "暂不支付"}</Button>
              <Button size="sm" icon="undo-2" onClick={() => { P.backToDraft(book.id, month); UI().toast("已退回草稿"); }}>退回草稿</Button>
            </>)}
            {step === "check" && !future && <Button size="sm" icon="arrow-right" onClick={() => setStep("a4")}>查看 A4 单</Button>}
            {step === "a4" && (<>
              <Button size="sm" icon="pencil" onClick={() => setStep("check")}>返回核对</Button>
              <Button size="sm" variant="primary" icon="printer" onClick={() => window.print()}>打印（每 sheet 一页）</Button>
              <Button size="sm" icon="file-down" onClick={() => UI().toast("正在导出 PDF（" + a4Pages.filter(Boolean).length + " 页 · " + doc.name + "）…")}>导出 PDF</Button>
            </>)}
          </span>
        </Panel>

        {future && <Panel padding={30} style={{ textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>「{doc.label}」档未到：结算档默认 95%（可改，留 5% 尾款），尾款档固定 100% 收口。</Panel>}

        {step === "check" && !future && (checkList || checkC1 || checkC2)}

        {step === "a4" && !future && (
          <div id="payslip-print-root" style={{ overflowX: "auto", padding: "4px 0 20px" }}>
            {a4Pages.filter(Boolean).map((p, i) => <React.Fragment key={i}>{p}</React.Fragment>)}
          </div>
        )}
      </div>
    );
  }

  // _ds_bundle.js 内打包有旧版同名全局，且 helmet/x-import 脚本执行顺序不保证——
  // 注册后短时间内周期性重断言，确保 kit 新版最终胜出（bundle 后执行也会被覆盖回来）。
  const __reg = () => { window.PayrollDetailScreen = PayrollDetailScreen; };
  __reg();
  const __regT = setInterval(__reg, 120);
  setTimeout(() => clearInterval(__regT), 3000);
})();
