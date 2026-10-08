// PayrollFormScreen — 工资草稿整页（/subcontract/payroll/form/:id；无 id 时为新建，对应台账「新建 A/C1/C2 工资草稿」）。
// 依据：CentralPayrollFormPage 按原工资格式分发 → CentralPayrollDraftFormPage（A / 独立管理簿）、
//       CentralC1DraftFormPage、CentralC2DraftFormPage；docs/rewrite/pages/subcontract-payroll.md 第一、五节。
// 口径：A 只读已完成施工与现场量（合同量不进入取数），比例为单据参数，尾款固定 100%；
//   C1 只按真实逐日考勤与个人标准（正常工时÷8×日薪，加班工时×加班价，到分）；
//   C2 只按已确认签工与主体单价（固定 100%）；B 已退役，不提供新建或编辑。
//   改范围或成员后须重新核对来源才能保存；保存草稿不发放，核对与实际发放在工资详情办理。
// 以下为独立设计样本，不读写 data.js。
(function () {
  const MEMBERS = ["虞建华", "王芳（虞嫂）", "匡志强", "孙大勇"];
  const A_LINES = [
    { id: "l1", where: "1栋 01户 墙砖", who: "虞建华", unit: "㎡", qty: 512.4, price: 36 },
    { id: "l2", where: "1栋 01户 地砖", who: "王芳（虞嫂）", unit: "㎡", qty: 128.0, price: 34, adj: true },
    { id: "l3", where: "2栋 02户 墙砖", who: "匡志强", unit: "㎡", qty: 306.25, price: 36 },
  ];
  const A_GAPS = ["2栋 03户 地砖：已指派但当月未登记完成，不计入应付。"];
  const FEES = [{ name: "合计工程量房补", basis: "墙砖、地砖 · 主体已证完成 946.65 ㎡", price: 1.3, amount: 1230.65 }];
  const NEG = [{ id: "n1", item: "代付班组生活费", qty: 1, unit: "项", price: -600, reason: "现场经办确认 · 2026-06-18" }];
  const C1_ROWS = [
    { worker: "陈国强", kind: "正常", hours: 7.5, rate: "480 元/日 ÷ 8", amount: 450 },
    { worker: "陈国强", kind: "加班", hours: 0, rate: "60 元/小时", amount: 0 },
    { worker: "李建华", kind: "正常", hours: 8, rate: "481 元/日 ÷ 8", amount: 481 },
    { worker: "李建华", kind: "加班", hours: 2, rate: "55 元/小时（独立加班价）", amount: 110 },
    { worker: "刘德胜", kind: "正常", hours: 0, rate: "450 元/日 ÷ 8", amount: 0, note: "本月无考勤，保留零数量与本人标准" },
    { worker: "刘德胜", kind: "加班", hours: 0, rate: "56.25 元/小时", amount: 0 },
  ];
  const C2_ROWS = [
    { worker: "陈国强", date: "2026-06-24", content: "3 号楼 8 层 0802 补砖", time: "08:00–17:00 · 1 工", proof: "周伟峰 · 06-25 确认", used: "本单采用" },
    { worker: "陈国强", date: "2026-06-25", content: "3 号楼 9 层公区清理", time: "08:00–12:00 · 0.5 工", proof: "周伟峰 · 06-26 确认", used: "本单采用" },
    { worker: "李建华", date: "2026-06-25", content: "3 号楼 9 层公区清理", time: "13:00–17:00 · 0.5 工", proof: "未确认", used: "待确认，不进入工资" },
  ];
  const money = v => v == null ? "未记录" : "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const round2 = v => Math.round(v * 100) / 100;

  // 页头 + 分区 + 吸底动作条：只组合设计系统 Button / Panel，不另做导航或通用件
  function Frame({ title, subtitle, onBack, footer, children, readOnly }) {
    const { Button, Panel } = window.DesignSystem_e3d871;
    return <div style={{ maxWidth: 1080, margin: "0 auto", minWidth: 0, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button icon="arrow-left" onClick={onBack}>返回工资台账</Button>
        <h1 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{title}</h1>
        <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{subtitle}</span>
      </div>
      {readOnly && <p role="status" style={{ margin: 0 }}>当前工资已核对或来源只读，草稿不可修改；请到工资详情办理。</p>}
      <fieldset disabled={readOnly} style={{ margin: 0, padding: 0, border: 0, minWidth: 0, display: "grid", gap: 12 }}>{children}</fieldset>
      <Panel padding={12} style={{ position: "sticky", bottom: 0, zIndex: 15, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", boxShadow: "0 -4px 16px rgba(16,24,40,0.06)" }}>{footer}</Panel>
    </div>;
  }
  const Sec = ({ id, title, sub, children }) => {
    const { Panel } = window.DesignSystem_e3d871;
    const SH = window.KitAtoms.SectionHeader;
    return <section id={"pform-" + id} style={{ scrollMarginTop: 16, minWidth: 0 }}><Panel style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <SH mb={0}>{title}</SH>
      {sub && <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6 }}>{sub}</p>}
      {children}
    </Panel></section>;
  };

  function PayrollFormScreen({ navigate, params = {} }) {
    const { Button, StatusChip } = window.DesignSystem_e3d871;
    const KA = window.KitAtoms;
    const Table = window.KitTable;
    const UI = window.KitUI || { toast: () => {}, confirm: o => o.onConfirm && o.onConfirm() };
    const state = params.previewState || "ready";
    const readOnly = state === "readonly";
    const id = params.id || null;
    const format = ["A", "C1", "C2"].includes(params.format) ? params.format : "A";
    const management = format === "A" && params.management === "1";
    const [draft, setDraft] = React.useState({ project: params.project || "合和新城", month: /^\d{4}-\d{2}$/.test(params.month || "") ? params.month : "2026-06", period: "monthly", crew: params.crew || "泥水A班", leader: id ? "虞建华" : "", members: id ? ["虞建华", "王芳（虞嫂）", "匡志强"] : [], ratio: "80", note: "" });
    const [previewed, setPreviewed] = React.useState(!!id);
    const [dirty, setDirty] = React.useState(false);
    const [neg, setNeg] = React.useState(NEG);
    const patch = (v, scopeChanged) => { setDraft(d => ({ ...d, ...v })); setDirty(true); if (scopeChanged) setPreviewed(false); };
    const back = () => {
      const go = () => navigate("payroll", { project: draft.project, crew: draft.crew, month: draft.month });
      dirty ? UI.confirm({ title: "放弃未保存的工资草稿？", message: "当前输入尚未保存。", confirmText: "放弃输入", onConfirm: go }) : go();
    };
    const recheck = () => { setPreviewed(true); UI.toast("已按当前请款范围重新读取来源（设计演示）", "ok"); };
    const save = () => {
      if (!draft.project || !draft.month || !draft.leader) { UI.toast("请填写项目、工资月份和请款负责人。", "warning"); return; }
      if (!previewed) { UI.toast("请先按当前请款范围重新核对来源，再保存草稿。", "warning"); return; }
      setDirty(false); UI.toast("已保存工资草稿（设计演示）；核对与实际发放在工资详情办理", "ok");
    };
    const title = management ? "编辑独立管理费草稿" : (id ? "编辑 " : "新建 ") + format + " 工资草稿";
    const subtitle = format === "C1" ? "按真实逐日考勤与个人标准核算，保存后核对并确认实际发放。"
      : format === "C2" ? "按真实逐条签工与主体配置核算，保存后核对并确认实际发放。"
      : "按明确请款簿与原施工责任核对组成；负价清单独立保存，再重新核对实际发放。";
    const footer = <><Button onClick={back}>取消</Button>{!readOnly && <Button variant="primary" onClick={save}>保存工资草稿</Button>}</>;

    if (["loading", "error", "empty"].includes(state)) return <Frame title={title} subtitle={subtitle} onBack={back} footer={<Button onClick={back}>取消</Button>}>
      <KA.StatePanel state={state === "empty" ? "error" : state} title={state === "loading" ? "正在核对工资格式…" : state === "empty" ? "该工资格式目前只支持原资料查看" : "工资草稿未能读取"} description={state === "empty" ? "B 类历史或隔离记录请从台账打开其历史详情，不在此编辑。" : state === "error" ? "原输入保留；重新读取后请重新核对来源。" : undefined} actionLabel={state === "error" ? "重新读取" : undefined} onAction={() => navigate("payrollForm", { ...params, previewState: "ready" })} />
    </Frame>;

    const configBtn = <Button onClick={() => navigate("payrollConfig", { format, project: draft.project, month: draft.month, crew: draft.crew, leader: draft.leader, ...(management ? { managementBookId: "mb1" } : {}) })}>{format === "C1" ? "个人工资标准" : format === "C2" ? "C2 主体配置" : "工资配置"}</Button>;
    const lockScope = readOnly || management;
    const basic = <Sec id="basic" title="请款范围">
      <div className="dc-fields">
        <label>项目<select aria-label="工资项目" disabled={lockScope} value={draft.project} onChange={e => patch({ project: e.target.value, leader: "", members: [] }, true)}><option value="">请选择项目</option>{[...new Set([draft.project, "合和新城", "锦绣华庭"].filter(Boolean))].map(p => <option key={p}>{p}</option>)}</select></label>
        <label>工资月份<input type="month" aria-label="工资月份" disabled={lockScope} value={draft.month} onChange={e => patch({ month: e.target.value }, true)} /></label>
        {format === "A" && <label>工资档位<select aria-label="工资档位" disabled={lockScope} value={draft.period} onChange={e => patch({ period: e.target.value, ...(e.target.value === "retention" ? { ratio: "100" } : e.target.value === "settlement" ? { ratio: "95" } : {}) }, true)}><option value="monthly">月度请款</option><option value="settlement">工程结算</option><option value="retention">尾款</option></select></label>}
        <label>{format === "A" ? "班组" : "所属班组"}<select aria-label="请款班组" disabled={lockScope} value={draft.crew} onChange={e => patch({ crew: e.target.value, leader: "", members: [] }, true)}><option value="">未关联班组</option>{[...new Set([draft.crew, "泥水A班", "木工一班"].filter(Boolean))].map(c => <option key={c}>{c}</option>)}</select></label>
        <label>{format === "A" ? "请款负责人" : "负责人"}<select aria-label="请款负责人" disabled={lockScope} value={draft.leader} onChange={e => { const v = e.target.value; patch({ leader: v, members: v ? [...new Set([v, ...draft.members])] : draft.members }, true); }}><option value="">请选择负责人</option>{MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}<option disabled>周伟峰 · 当前项目资格未证明</option></select></label>
        {format === "A" && <label>本次支付比例（%）<input type="number" min="0" max="100" step="0.01" aria-label="本次支付比例" disabled={lockScope || draft.period === "retention"} value={draft.ratio} onChange={e => patch({ ratio: e.target.value })} />
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{draft.period === "retention" ? "尾款档固定 100%。" : draft.period === "settlement" ? "结算档默认 95%，可改。" : "沿用同簿上月有效月度单据保存的比例 80%；上月结算单不覆盖月度比例。"}</span>
          {draft.period === "monthly" && draft.ratio !== "80" && <span><Button size="sm" variant="ghost" onClick={() => patch({ ratio: "80" })}>采用建议比例 80%</Button></span>}
        </label>}
      </div>
      <fieldset disabled={lockScope} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <legend style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>本次请款成员（包括负责人）</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6 }}>
          {draft.crew ? MEMBERS.map(m => <label key={m} style={{ display: "flex", gap: 6, fontSize: 12.5, alignItems: "center" }}><input type="checkbox" checked={draft.members.includes(m)} disabled={m === draft.leader} onChange={e => patch({ members: e.target.checked ? [...draft.members, m] : draft.members.filter(x => x !== m) }, true)} />{m}{m === draft.leader ? "（负责人）" : ""}</label>)
            : <p style={{ margin: 0, fontSize: 12, color: "var(--ink-faint)" }}>当前范围没有可选工人。核对项目与班组后读取候选，不自动代选负责人。</p>}
        </div>
      </fieldset>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button onClick={recheck}>{format === "C1" ? "核对考勤与个人标准" : format === "C2" ? "核对签工与主体配置" : "核对完成量与单价"}</Button>{draft.project && draft.month && configBtn}</div>
      {!previewed && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--warn-ink)" }}>{format === "A" ? "请先按当前请款范围重新核对来源，再保存草稿。" : "范围或成员已改变，请按当前稿重新核对来源后保存。"}</p>}
    </Sec>;
    const note = <Sec id="note" title="备注"><textarea rows={3} aria-label="工资备注" value={draft.note} onChange={e => patch({ note: e.target.value })} style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", padding: "6px 8px", font: "inherit" }} /></Sec>;

    if (format === "C1") {
      const total = C1_ROWS.reduce((s, r) => s + r.amount, 0);
      return <Frame title={title} subtitle={subtitle} onBack={back} footer={footer} readOnly={readOnly}>
        {basic}
        <Sec id="source" title="本月考勤与个人标准" sub="全成员各自保留正常和加班两行；无考勤成员保留本人零数量与标准。原工时与费率不提前舍入，金额到分。">
          <Table label="C1 工资考勤与个人标准" rows={previewed ? C1_ROWS : []} empty="请先核对考勤与个人标准" columns={[
            { key: "worker", label: "工人", width: 110 }, { key: "kind", label: "核算项目", width: 90 },
            { key: "hours", label: "工时", width: 80, align: "right", mono: true }, { key: "rate", label: "每小时标准", width: 200 },
            { key: "amount", label: "金额", width: 120, align: "right", money: true }, { key: "note", label: "来源", width: 240, render: v => v || "真实考勤" },
          ]} footerLeft={<span style={{ fontSize: 12 }}>本月核算应发 <b style={{ fontFamily: "var(--font-mono)" }}>{money(total)}</b></span>} />
        </Sec>
        {note}
      </Frame>;
    }
    if (format === "C2") {
      return <Frame title={title} subtitle={subtitle} onBack={back} footer={footer} readOnly={readOnly}>
        {basic}
        <Sec id="source" title="本月签工与主体标准" sub="只有已确认签工计薪；待确认记录保留在签工台账但不进入工资。C2 固定按已确认工数 100% 核算。">
          <p style={{ margin: 0, fontSize: 12.5 }}>当前主体签工标准：<b style={{ fontFamily: "var(--font-mono)" }}>350.00</b> 元/工 · 规则随发放冻结</p>
          <Table label="C2 签工来源" rows={previewed ? C2_ROWS : []} empty="请先核对签工与主体配置" columns={[
            { key: "worker", label: "工人 / 日期", width: 170, render: (v, r) => v + " · " + r.date }, { key: "content", label: "施工内容", width: 200 },
            { key: "time", label: "时段 / 工", width: 160 }, { key: "proof", label: "证明 / 确认", width: 150 },
            { key: "used", label: "本单采用", width: 150, render: v => <StatusChip tone={v === "本单采用" ? "ok" : "warn"}>{v}</StatusChip> },
          ]} footerLeft={<span style={{ fontSize: 12 }}>陈国强 1.5 工 × 350.00 = ¥525.00 · 本月核算应发 <b style={{ fontFamily: "var(--font-mono)" }}>{money(525)}</b></span>} />
        </Sec>
        {note}
      </Frame>;
    }

    // —— A / 独立管理簿 ——
    const ratio = Number(draft.ratio) / 100;
    const lineSum = round2(A_LINES.reduce((s, l) => s + l.qty * l.price, 0));
    const negSum = round2(neg.reduce((s, n) => s + n.qty * n.price, 0));
    return <Frame title={title} subtitle={subtitle} onBack={back} footer={footer} readOnly={readOnly}>
      {management && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)" }}>管理簿请款范围由工资配置中的独立管理关系决定，此处只读；同人普通工资不计入本簿此前已领。</p>}
      {basic}
      {!management && <Sec id="source" title="核对实际完成与现场量" sub="只统计工资当月及以前已经完成的报量工序；合同量不进入工资取数。缺少所选量口径时整单报错，不允许部分行静默通过。">
        <Table label="工资行来源" rows={previewed ? A_LINES : []} empty="当前没有已证明的完成工资行" columns={[
          { key: "where", label: "栋 / 户型 / 分项", width: 170 }, { key: "who", label: "工人", width: 110 }, { key: "unit", label: "单位", width: 60 },
          { key: "qty", label: "已完成现场量", width: 120, align: "right", mono: true },
          { key: "price", label: "工资单价", width: 110, align: "right", render: (v, r) => <span>{money(v)}{r.adj && <StatusChip tone="warn">调</StatusChip>}</span> },
          { key: "_amt", label: "金额", width: 130, align: "right", render: (_v, r) => <b style={{ fontFamily: "var(--font-mono)" }}>{money(round2(r.qty * r.price))}</b> },
        ]} footerLeft={<span style={{ fontSize: 12 }}>清单合计 <b style={{ fontFamily: "var(--font-mono)" }}>{money(lineSum)}</b></span>} />
        {previewed && A_GAPS.map(g => <p key={g} style={{ margin: 0, fontSize: 12, color: "var(--warn-ink)" }}>{g}</p>)}
      </Sec>}
      <Sec id="fees" title={management ? "管理费进度款 · 独立管理簿" : "普通施工工资 · 补贴组成"} sub={management ? "正负行先合计再按比例核算，再扣本簿此前实际已领。" : "逐条补贴按明确分项及范围核算；空鼓列示在工资详情人工开始扣款。"}>
        {management ? <div style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          <span>管理费组成：1栋 墙砖/地砖 已证完成 600 ㎡ × 2.50 元 = <b style={{ fontFamily: "var(--font-mono)" }}>¥1,500.00</b></span>
          <span>负价代付清单合计：<b style={{ fontFamily: "var(--font-mono)" }}>{money(negSum)}</b></span>
          <span>（1,500.00 {negSum < 0 ? "− " + Math.abs(negSum).toFixed(2) : "+ " + negSum.toFixed(2)}）× 80% − 本簿此前实际已领 200.00 = 本次 <b style={{ fontFamily: "var(--font-mono)" }}>{money(round2((1500 + negSum) * 0.8 - 200))}</b></span>
        </div> : <>
          <Table label="工资费用组成" rows={previewed ? FEES : []} empty="当前请款簿没有启用的费用" columns={[{ key: "name", label: "费用", width: 150 }, { key: "basis", label: "基数", width: 280 }, { key: "price", label: "单价", width: 90, align: "right" }, { key: "amount", label: "金额", width: 120, align: "right", money: true }]} />
          {previewed && <p style={{ margin: 0, fontSize: 12.5 }}>（清单 {money(lineSum)} + 费用 {money(FEES[0].amount)}）× {Number.isFinite(ratio) ? draft.ratio : "—"}% − 本簿此前实际已领 ¥20,000.00 = 本次请款 <b style={{ fontFamily: "var(--font-mono)" }}>{money(round2((lineSum + FEES[0].amount) * ratio - 20000))}</b></p>}
        </>}
      </Sec>
      {management && <Sec id="negative" title="负价代付清单" sub="数量乘负单价进入本管理单清单合计；实际收付另行留证。">
        <Table label="负价代付核算组成" rows={neg} empty="暂无负价行" columns={[
          { key: "item", label: "清单", width: 160 }, { key: "qty", label: "数量", width: 70, align: "right", mono: true }, { key: "unit", label: "单位", width: 60 },
          { key: "price", label: "负单价", width: 100, align: "right", mono: true }, { key: "_amt", label: "有符号金额", width: 120, align: "right", render: (_v, r) => money(r.qty * r.price) },
          { key: "reason", label: "事由 / 确认依据", width: 220 },
        ]} />
        <div><Button onClick={() => { setNeg(n => [...n, { id: "n" + (n.length + 1), item: "新增负价行", qty: 1, unit: "项", price: -100, reason: "待填写事由与经办依据" }]); setDirty(true); setPreviewed(false); }}>新增负价行</Button></div>
      </Sec>}
      {note}
    </Frame>;
  }

  window.PayrollFormScreen = PayrollFormScreen;
})();
