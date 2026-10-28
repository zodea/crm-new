// PayrollConfigScreen — 工资配置独立整页（/subcontract/payroll/config，#412 P2/P3/P5/P6/P7）。
// 依据：PayrollAConfigScreen / PayrollC1ConfigScreen / PayrollC2ConfigScreen 及其分区组件，
//       docs/rewrite/pages/subcontract-payroll.md 第一、五、七、八节。
// 口径：params.format 决定配置对象（缺省 A；C1、C2 由对应工资草稿的配置入口带入）；
//   A：负责人首月比例、工资基准价与个人例外、补贴与费用、独立管理关系、发放取整、空鼓扣款各自分区保存；
//      选中独立管理簿时隐藏首月比例与单价（管理簿沿自己的首月配置与上月比例）；
//   C1：档案日薪优先，工资域只保存缺档案时的兜底日薪与个人独立加班价；
//   C2：项目 × 请款负责人保存大工单价与确认规则，规则只随发放冻结，不自动执行罚扣。
//   修改只影响未发工资（须重新核对），已发快照保持原记录；空白=未配置，明确 0 保留零值。
// 以下为独立设计样本，不读写 data.js，不按显示名推断身份。
(function () {
  const PROJECTS = ["合和新城", "锦绣华庭"];
  const CREWS = ["泥水A班", "木工一班"];
  const LEADERS = ["虞建华", "孙大勇", "张建国"];
  const PRICES = [
    { id: "p1", item: "1栋 01户 墙砖", unit: "㎡", mode: "baseline", worker: null, month: "2026-05", price: 36, rev: 2 },
    { id: "p2", item: "1栋 01户 地砖", unit: "㎡", mode: "baseline", worker: null, month: "2026-05", price: 32, rev: 1 },
    { id: "p3", item: "1栋 01户 地砖", unit: "㎡", mode: "worker-exception", worker: "王芳（虞嫂）", month: "2026-06", price: 34, rev: 1 },
  ];
  const FEES = [
    { id: "f1", name: "合计工程量房补", kind: "housing", enabled: true, price: 1.3, unit: "㎡", basis: "墙砖、地砖 · 主体已证完成", rev: 1 },
    { id: "f2", name: "高空作业补贴", kind: "subsidy", enabled: false, price: null, unit: "㎡", basis: "未选分项", rev: 1 },
  ];
  const MGMT_BOOKS = [{ id: "mb1", label: "虞建华 · 独立管理费 · 2026-05" }, { id: "mb2", label: "未指定管理人 · 公司代管 · 2026-04" }];
  const HOLLOW = [{ item: "墙砖", enabled: true, amount: "30", month: "2026-06" }, { item: "地砖", enabled: null, amount: "", month: "2026-06" }];
  const C1_RATES = [
    { worker: "陈国强", profile: 480, daily: 480, ot: 60, otSource: "daily-divided-eight", fallback: "", otInput: "" },
    { worker: "李建华", profile: null, daily: 450, ot: 55, otSource: "payroll-config", fallback: "450", otInput: "55" },
    { worker: "刘德胜", profile: null, daily: null, ot: null, otSource: "missing", fallback: "", otInput: "", reason: "已离场：当前不可修改，原标准保留" },
  ];
  const KIND = { housing: "房补", subsidy: "补贴", management: "管理费" };
  const money = v => v == null || v === "" ? "未配置" : "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // 页头 + 分区 + 吸底动作条：只组合设计系统 Button / Panel，不另做导航或通用件
  function Frame({ title, subtitle, onBack, backLabel, footer, children, readOnly }) {
    const { Button, Panel } = window.DesignSystem_e3d871;
    return <div style={{ maxWidth: 1080, margin: "0 auto", minWidth: 0, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button icon="arrow-left" onClick={onBack}>{backLabel}</Button>
        <h1 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{title}</h1>
        <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{subtitle}</span>
      </div>
      {readOnly && <p role="status" style={{ margin: 0 }}>当前来源仅供查看，配置不可修改。</p>}
      <fieldset disabled={readOnly} style={{ margin: 0, padding: 0, border: 0, minWidth: 0, display: "grid", gap: 12 }}>{children}</fieldset>
      <Panel padding={12} style={{ position: "sticky", bottom: 0, zIndex: 15, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", boxShadow: "0 -4px 16px rgba(16,24,40,0.06)" }}>{footer}</Panel>
    </div>;
  }
  const Sec = ({ id, title, sub, children }) => {
    const { Panel } = window.DesignSystem_e3d871;
    return <section id={"pcfg-" + id} style={{ scrollMarginTop: 16, minWidth: 0 }}><Panel style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <window.KitAtoms.SectionHeader mb={0}>{title}</window.KitAtoms.SectionHeader>
      {sub && <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6 }}>{sub}</p>}
      {children}
    </Panel></section>;
  };
  const warn = t => <p style={{ margin: 0, fontSize: 12, color: "var(--warn-ink)" }}>{t}</p>;
  const hint = t => <p style={{ margin: 0, fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>{t}</p>;

  function PayrollConfigScreen({ navigate, params = {} }) {
    const { Button, StatusChip } = window.DesignSystem_e3d871;
    const KA = window.KitAtoms;
    const Table = window.KitTable;
    const UI = window.KitUI || { toast: () => {}, confirm: o => o.onConfirm && o.onConfirm() };
    const format = ["A", "C1", "C2"].includes(params.format) ? params.format : "A";
    const state = params.previewState || "ready";
    const readOnly = state === "readonly";
    const [scope, setScope] = React.useState({ project: params.project || PROJECTS[0], month: /^\d{4}-\d{2}$/.test(params.month || "") ? params.month : "2026-06", crew: params.crew || CREWS[0], leader: params.leader || LEADERS[0] });
    const [book, setBook] = React.useState(params.managementBookId || "");
    const [ratio, setRatio] = React.useState("75");
    const [priceDrafts, setPriceDrafts] = React.useState([]);
    const [feeDrafts, setFeeDrafts] = React.useState([]);
    const [period, setPeriod] = React.useState("monthly");
    const [rounding, setRounding] = React.useState(params.previewState === "empty" ? "" : "floor");
    const [hollow, setHollow] = React.useState(HOLLOW);
    const [rates, setRates] = React.useState(C1_RATES);
    const [c2, setC2] = React.useState({ unitRate: "350", ruleText: "1、当日用工由证明人 2 天内确认；2、半工按 0.5 工计。" });
    const [dirty, setDirty] = React.useState({});
    const mark = k => setDirty(d => ({ ...d, [k]: true }));
    const saved = (k, text) => { setDirty(d => ({ ...d, [k]: false })); UI.toast(text + "（设计演示）；未发工资需重新核对，已发快照不变", "ok"); };
    const anyDirty = Object.values(dirty).some(Boolean);
    const back = () => {
      const go = () => navigate(params.returnRoute || "payroll", params.returnParams || {});
      anyDirty ? UI.confirm({ title: "放弃未保存的配置？", message: "仍有分区未保存。离开后未保存输入不会写入配置。", confirmText: "放弃输入", onConfirm: go }) : go();
    };
    const management = format === "A" && book === "mb1";
    const title = format === "C1" ? "C1 个人工资标准" : format === "C2" ? "C2 主体配置" : "A 工资配置";
    const subtitle = format === "C1" ? "按项目、工人和生效月份保存。已发工资保持冻结，未发工资须重新核对考勤。"
      : format === "C2" ? "按项目与请款负责人保存大工单价及原规则；未发工资需重新核对，已发快照保持不变。"
      : "项目主体的比例、工资单价与费用分别保存；管理费使用独立请款簿。";
    const sel = (label, value, options, onChange, extra) => <label>{label}<select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{extra}{(value && !options.includes(value) ? [value, ...options] : options).map(o => <option key={o} value={o}>{o}</option>)}</select></label>;
    const footer = format === "A"
      ? <Button onClick={back}>返回原工资</Button>
      : <><Button onClick={back}>返回</Button>{!readOnly && <Button variant="primary" disabled={!dirty.main} onClick={() => saved("main", format === "C1" ? "已保存个人标准" : "已保存主体配置")}>{format === "C1" ? "保存个人标准" : "保存主体配置"}</Button>}</>;

    if (["loading", "error"].includes(state)) return <Frame title={title} subtitle={subtitle} onBack={back} backLabel="返回原工资" footer={footer}>
      <KA.StatePanel state={state} title={state === "loading" ? "正在核对配置范围…" : format === "A" ? "工资配置未能读取" : format === "C1" ? "标准未能读取" : "配置未能读取"} description={state === "error" ? "原范围与未保存输入保留；重新读取后再核对。" : undefined} actionLabel={state === "error" ? "重新读取" : undefined} onAction={() => navigate("payrollConfig", { ...params, previewState: "ready" })} />
    </Frame>;

    // —— 空鼓分项扣款（三种格式共用；A 另区分普通与管理簿）——
    const hollowSec = <Sec id="hollow" title="空鼓分项扣款配置" sub="配置按本项目与原请款主体保存；A 工资另区分普通和管理簿。默认单处金额 30 元，明确开启也须在具体工资单人工开始扣款。">
      {hollow.map((h, i) => <div key={h.item} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "grid", gap: 8 }}>
        <b style={{ fontSize: 12.5 }}>{h.item}</b>
        <div className="dc-fields">
          <label>是否启用<select aria-label={h.item + "空鼓是否启用"} value={h.enabled == null ? "" : String(h.enabled)} onChange={e => { const v = e.target.value; setHollow(r => r.map((x, j) => j === i ? { ...x, enabled: v === "" ? null : v === "true" } : x)); mark("hollow"); }}><option value="">未记录，须明确选择</option><option value="false">不启用</option><option value="true">启用</option></select></label>
          <label>单处金额（元/处）<input type="number" min="0" aria-label={h.item + "空鼓单处金额"} value={h.amount} onChange={e => { const v = e.target.value; setHollow(r => r.map((x, j) => j === i ? { ...x, amount: v } : x)); mark("hollow"); }} /></label>
          <label>生效月份<input type="month" aria-label={h.item + "空鼓生效月份"} value={h.month} onChange={e => { const v = e.target.value; setHollow(r => r.map((x, j) => j === i ? { ...x, month: v } : x)); mark("hollow"); }} /></label>
        </div>
        {h.amount.trim() === "" && warn("本次单处金额未填写，不会按零或默认 30 元计算。")}
      </div>)}
      <div><Button disabled={!dirty.hollow} onClick={() => saved("hollow", "已保存空鼓分项配置")}>保存空鼓分项配置</Button></div>
    </Sec>;

    if (format === "C1") return <Frame title={title} subtitle={subtitle} onBack={back} backLabel="返回" footer={footer} readOnly={readOnly}>
      <Sec id="scope" title="配置范围"><div className="dc-fields">
        {sel("项目", scope.project, PROJECTS, v => setScope(s => ({ ...s, project: v })))}
        <label>生效月份<input type="month" aria-label="生效月份" value={scope.month} onChange={e => setScope(s => ({ ...s, month: e.target.value }))} /></label>
        {sel("班组", scope.crew, CREWS, v => setScope(s => ({ ...s, crew: v })), <option value="">全部班组</option>)}
      </div></Sec>
      <section id="pcfg-rates" style={{ display: "grid", gap: 12, scrollMarginTop: 16 }} aria-label="个人工资标准">
        {state === "empty" ? <KA.StatePanel state="empty" title="当前范围没有可配置的工人" description="请核对项目、月份与班组。" /> : rates.map((r, i) => <Sec key={r.worker} id={"rate-" + i} title={r.worker}>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6 }}>档案日薪：{money(r.profile)}；当前有效日薪：{money(r.daily)}。档案有明确日薪时优先采用，下面的工资配置仅作缺档案时的兜底。</p>
          <div className="dc-fields">
            <label>缺档案时个人日薪<input type="number" min="0" aria-label={r.worker + "兜底日薪"} disabled={!!r.reason} value={r.fallback} onChange={e => { const v = e.target.value; setRates(x => x.map((y, j) => j === i ? { ...y, fallback: v } : y)); mark("main"); }} />{hint("空白表示未配置，0 为明确零价。")}</label>
            <label>个人独立加班价（元/小时）<input type="number" min="0" aria-label={r.worker + "加班价"} disabled={!!r.reason} value={r.otInput} onChange={e => { const v = e.target.value; setRates(x => x.map((y, j) => j === i ? { ...y, otInput: v } : y)); mark("main"); }} />{hint("空白沿用有效日薪 ÷ 8；当前 " + money(r.ot) + "/小时，" + (r.otSource === "payroll-config" ? "来自独立配置" : r.otSource === "daily-divided-eight" ? "按日薪默认" : "尚未提供") + "。")}</label>
          </div>
          {r.reason && warn(r.reason)}
        </Sec>)}
      </section>
      <Sec id="hollow-leader" title="空鼓扣款请款负责人">{sel("空鼓扣款请款负责人", scope.leader, LEADERS, v => setScope(s => ({ ...s, leader: v })), <option value="">请选择原请款负责人</option>)}</Sec>
      {scope.leader && hollowSec}
    </Frame>;

    if (format === "C2") return <Frame title={title} subtitle={subtitle} onBack={back} backLabel="返回" footer={footer} readOnly={readOnly}>
      <Sec id="scope" title="请款主体"><div className="dc-fields">
        {sel("项目", scope.project, PROJECTS, v => setScope(s => ({ ...s, project: v })))}
        {sel("请款负责人", scope.leader, LEADERS, v => setScope(s => ({ ...s, leader: v })))}
      </div><p style={{ margin: 0, fontSize: 12 }}>所属班组：{scope.leader ? scope.crew : "选择负责人后确定"}</p></Sec>
      <Sec id="config" title="大工单价与确认规则">
        {state === "empty" ? <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)" }}>当前主体尚无原配置，请明确填写后保存。</p> : <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)" }}>原配置：350.00 元/工 · 有效</p>}
        <div className="dc-fields">
          <label>大工单价（元/工）<input type="number" aria-label="大工单价" value={c2.unitRate} onChange={e => { setC2(c => ({ ...c, unitRate: e.target.value })); mark("main"); }} /></label>
          <label style={{ gridColumn: "1 / -1" }}>确认规则<textarea rows={4} aria-label="确认规则" value={c2.ruleText} onChange={e => { setC2(c => ({ ...c, ruleText: e.target.value })); mark("main"); }} /></label>
        </div>
        {hint("规则文字随工资发放冻结，不自动执行逾期免费、双扣或其他罚扣。")}
      </Sec>
      <Sec id="hollow-month" title="空鼓核对月份"><div className="dc-fields"><label>空鼓核对月份<input type="month" aria-label="空鼓核对月份" value={scope.month} onChange={e => setScope(s => ({ ...s, month: e.target.value }))} /></label></div></Sec>
      {scope.month && hollowSec}
    </Frame>;

    // —— A 格式 ——
    const priceCols = [
      { key: "item", label: "分项", width: 170 }, { key: "unit", label: "单位", width: 70 },
      { key: "mode", label: "适用人员", width: 170, render: (v, r) => v === "baseline" ? "负责人分项基准" : <span>{r.worker} <StatusChip tone="warn">调</StatusChip></span> },
      { key: "month", label: "生效月份", width: 100, mono: true }, { key: "price", label: "工资单价", width: 110, align: "right", render: v => money(v) },
      { key: "rev", label: "修订", width: 70, align: "right" },
      { key: "_op", label: "操作", width: 120, render: (_v, r) => <Button size="sm" disabled={readOnly || priceDrafts.some(d => d.id === r.id)} onClick={() => { setPriceDrafts(d => [...d, { ...r, month: scope.month }]); mark("prices"); }}>修订单价</Button> },
    ];
    const feeCols = [
      { key: "name", label: "费用", width: 160 }, { key: "kind", label: "类别", width: 80, render: v => KIND[v] },
      { key: "enabled", label: "状态", width: 80, render: v => v ? "启用" : "关闭" }, { key: "price", label: "单价", width: 110, align: "right", render: v => money(v) },
      { key: "unit", label: "单位", width: 60 }, { key: "basis", label: "基数范围", width: 220 }, { key: "rev", label: "修订", width: 60, align: "right" },
      { key: "_op", label: "操作", width: 110, render: (_v, r) => <Button size="sm" disabled={readOnly || dirty.subject || dirty.prices} onClick={() => { setFeeDrafts(d => d.some(x => x.id === r.id) ? d : [...d, { ...r }]); mark("fees"); }}>修订费用</Button> },
    ];
    return <Frame title={title} subtitle={subtitle} onBack={back} backLabel="返回原工资" footer={footer} readOnly={readOnly}>
      <Sec id="scope" title="配置范围"><div className="dc-fields">
        {sel("项目", scope.project, PROJECTS, v => setScope(s => ({ ...s, project: v, leader: "" })), <option value="">请选择项目</option>)}
        <label>核对月份<input type="month" aria-label="配置核对月份" value={scope.month} onChange={e => setScope(s => ({ ...s, month: e.target.value }))} /></label>
        {sel("班组", scope.crew, CREWS, v => setScope(s => ({ ...s, crew: v, leader: "" })), <option value="">未关联班组</option>)}
        {sel("负责人", scope.leader, LEADERS, v => setScope(s => ({ ...s, leader: v })), <option value="">请选择负责人</option>)}
      </div>{(dirty.hollow || dirty.rounding) && warn("取整或空鼓仍有未保存输入；保存或撤销后才能切换配置范围。")}</Sec>
      {!scope.leader ? <KA.StatePanel state="empty" title="请选择项目与月份，再读取负责人和已保存工资配置" /> : <>
        {!management && <Sec id="subject" title="负责人首月比例" sub="月度沿用上月有效月度单据保存的比例；无上月单据时使用明确首月配置，不追改已发记录。">
          <div className="dc-fields"><label>首月支付比例（%）<input type="number" min="0" max="100" step="0.01" aria-label="首月支付比例" value={ratio} onChange={e => { setRatio(e.target.value); mark("subject"); }} /></label></div>
          {hint("班组明确比例：80%，不会代替当前未保存输入。")}
          <div><Button disabled={!dirty.subject} onClick={() => saved("subject", "已保存首月比例")}>保存首月比例</Button></div>
        </Sec>}
        {!management && <Sec id="prices" title="工资基准价与个人例外" sub="统一改对应当前负责人的分项基准；单独改保留该工人的独立调价记录。">
          <Table label="工资单价" rows={state === "empty" ? [] : PRICES} columns={priceCols} empty="当前负责人尚未配置工资单价" />
          {priceDrafts.map((d, i) => <div key={d.id || "new" + i} aria-label="待保存工资单价" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><b style={{ fontSize: 12 }}>{d.id ? "修订单价" : "新增工资单价"}</b><Button size="sm" onClick={() => setPriceDrafts(x => x.filter((_, j) => j !== i))}>移除未保存项</Button></div>
            <div className="dc-fields">
              <label>分项及单位<select aria-label="单价分项及单位" disabled={!!d.id} value={d.item} onChange={e => { const v = e.target.value; setPriceDrafts(x => x.map((y, j) => j === i ? { ...y, item: v } : y)); }}><option value="">请选择稳定分项</option>{[...new Set(PRICES.map(p => p.item))].map(n => <option key={n} value={n}>{n} · ㎡</option>)}</select></label>
              <label>调整方式<select aria-label="单价调整方式" disabled={!!d.id} value={d.mode} onChange={e => { const v = e.target.value; setPriceDrafts(x => x.map((y, j) => j === i ? { ...y, mode: v } : y)); }}><option value="baseline">统一改 · 当前负责人基准价</option><option value="worker-exception">单独改 · 个人例外</option></select></label>
              {d.mode === "worker-exception" && <label>适用工人<select aria-label="单独调价工人" disabled={!!d.id} value={d.worker || ""} onChange={e => { const v = e.target.value; setPriceDrafts(x => x.map((y, j) => j === i ? { ...y, worker: v } : y)); }}><option value="">请选择工人</option>{["王芳（虞嫂）", "匡志强"].map(w => <option key={w} value={w}>{w}</option>)}</select></label>}
              <label>生效月份<input type="month" aria-label="单价生效月份" value={d.month} onChange={e => { const v = e.target.value; setPriceDrafts(x => x.map((y, j) => j === i ? { ...y, month: v } : y)); }} /></label>
              <label>工资单价<input type="number" min="0" step="0.01" aria-label="工资单价金额" value={d.price == null ? "" : d.price} onChange={e => { const v = e.target.value; setPriceDrafts(x => x.map((y, j) => j === i ? { ...y, price: v === "" ? null : v } : y)); }} /></label>
              <label>适用工作范围<select aria-label="工资单价范围" disabled={!!d.id} defaultValue="project"><option value="project">当前项目内该负责人适用分项</option><option value="cells">指定户内位置</option></select></label>
            </div>
            {hint("空白表示尚未配置；明确填写 0 会保留零单价。修改从所选月份影响未发工资，已发快照保持原记录。")}
          </div>)}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={() => { setPriceDrafts(d => [...d, { id: null, item: "", unit: "㎡", mode: "baseline", worker: null, month: scope.month, price: null }]); mark("prices"); }}>新增工资单价</Button>
            <Button variant="primary" disabled={!dirty.prices} onClick={() => { setPriceDrafts([]); saved("prices", "已保存工资单价"); }}>保存工资单价</Button>
          </div>
        </Sec>}
      </>}
      <Sec id="fees" title="项目主体费用与管理簿" sub="逐条补贴按明确分项及范围核算；管理费使用管理人自己的请款簿。">
        <div className="dc-fields"><label>当前请款簿<select aria-label="费用请款簿" value={book} disabled={dirty.subject || dirty.prices} onChange={e => setBook(e.target.value)}><option value="">普通施工工资 · 当前请款主体</option>{MGMT_BOOKS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label></div>
        {book && hint("同一人的普通工资已领与本管理簿分别核对。")}
        <Table label="费用配置" rows={state === "empty" ? [] : FEES} columns={feeCols} empty="当前请款簿尚无费用配置；未配置不会自动采用班组默认。" />
        {feeDrafts.map((d, i) => <div key={d.id || "nf" + i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}><div className="dc-fields">
          <label>费用名称<input aria-label="费用名称" defaultValue={d.name} /></label>
          <label>类别<select aria-label="费用类别" defaultValue={d.kind}><option value="housing">房补</option><option value="subsidy">补贴</option><option value="management">管理费</option></select></label>
          <label>启用<select aria-label="费用启用" defaultValue={String(d.enabled)}><option value="true">启用</option><option value="false">关闭</option></select></label>
          <label>单价<input type="number" aria-label="费用单价" defaultValue={d.price == null ? "" : d.price} /></label>
          <label>单位<input aria-label="费用单位" defaultValue={d.unit} /></label>
          <label>基数分项与范围<input aria-label="费用基数范围" defaultValue={d.basis} /></label>
        </div><div style={{ marginTop: 8 }}><Button size="sm" onClick={() => setFeeDrafts(x => x.filter((_, j) => j !== i))}>移除未保存项</Button></div></div>)}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button disabled={dirty.subject || dirty.prices} onClick={() => { setFeeDrafts(d => [...d, { id: null, name: "", kind: "subsidy", enabled: true, price: null, unit: "㎡", basis: "" }]); mark("fees"); }}>新增费用</Button>
          <Button variant="primary" disabled={!feeDrafts.length} onClick={() => { setFeeDrafts([]); saved("fees", "已保存费用配置"); }}>保存费用配置</Button>
        </div>
      </Sec>
      <Sec id="management" title="独立管理关系" sub="只管理明确的原施工责任；公司代管范围不生成管理费单，原已发记录继续保留。">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={() => UI.toast("新增班组管理范围：选择管理人与原施工责任细格（设计演示）")}>新增班组管理范围</Button>
          <Button onClick={() => UI.toast("新增公司代管范围（设计演示）")}>新增公司代管范围</Button>
          {book && <Button onClick={() => UI.toast("修订当前管理范围（设计演示）")}>修订当前管理范围</Button>}
        </div>
        {book === "mb2" ? hint("当前范围为公司代管，不生成管理费单。") : book === "mb1" ? <>
          <div className="dc-fields"><label>管理单档位<select aria-label="管理单档位" value={period} onChange={e => setPeriod(e.target.value)}><option value="monthly">月度请款</option><option value="settlement">工程结算</option><option value="retention">尾款</option></select></label></div>
          <div><Button variant="primary" disabled={anyDirty} onClick={() => navigate("payrollForm", { id: "demo-mgmt-202606", format: "A", management: "1" })}>生成或打开本期管理费草稿</Button></div>
          {anyDirty && hint("请先保存当前输入，再打开管理单。")}
        </> : hint("选择独立管理簿后可生成或打开本期管理费草稿。")}
      </Sec>
      <Sec id="rounding" title="发放取整" sub="每个负责人、请款簿和生效月份都必须明确选择；新修订不追改已发记录。">
        {!rounding && warn("当前范围尚未明确取整规则，批量资金建议会阻断。")}
        <label style={{ fontSize: 12.5 }}><input type="radio" name="pcfg-round" checked={rounding === "off"} onChange={() => { setRounding("off"); mark("rounding"); }} /> 不取整，按核算金额参与资金建议</label>
        <label style={{ fontSize: 12.5 }}><input type="radio" name="pcfg-round" checked={rounding === "floor"} onChange={() => { setRounding("floor"); mark("rounding"); }} /> 向下取整到整百元（不足 100 元部分暂不发）</label>
        <div style={{ display: "flex", gap: 8 }}><Button disabled={!dirty.rounding} onClick={() => saved("rounding", "已保存取整修订")}>保存取整修订</Button></div>
        {rounding && hint("当前为第 1 版，生效月份 2026-05。")}
      </Sec>
      {scope.leader && hollowSec}
    </Frame>;
  }

  window.PayrollConfigScreen = PayrollConfigScreen;
})();
