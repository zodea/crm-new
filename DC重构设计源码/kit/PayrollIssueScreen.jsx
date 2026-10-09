// PayrollIssueScreen — 单份工资预览与正式出具整页（/subcontract/payroll/issue/:id，#477）。
// 依据：PayrollNumberingScreen / PayrollOfficialIdentity，docs/rewrite/pages/subcontract-payroll.md 第九节。
// 口径：只读取原已发 A/C1/C2 的完整冻结工资（缺原件、未发或历史 B 不借此生成正式单）；
//   项目未启用时须人工填写下一张序号与旧纸号核对依据，登记起点不为工资占号；
//   明确「正式出具」才分配项目唯一原号；预览不占号，重复下载/打印沿用原号；
//   结果未知时只按原提交核对，不另建出具记录，不把预计号当正式号。
// 设计状态：previewState ready=项目已启用未出具 / empty=项目尚未登记起点 / readonly=已出具 / loading / error；
//   params.issueState=pending（结果待核对）| unavailable（原件不完整）补充演示。
// 以下为独立设计样本，不读写 data.js。
(function () {
  const DOC = {
    id: "demo-payroll-202606-yjh", project: "合和新城", leader: "虞建华", format: "A", month: "2026-06", period: "月度请款",
    gross: 8043.24, actual: 8000, releasedAt: "2026-07-05 16:20", note: "按 80% 月度比例发放，取整到整百元。",
    lines: [
      { id: "l1", worker: "虞建华", item: "1栋 01户 墙砖", unit: "㎡", qty: 512.4, price: 36, amount: 18446.4 },
      { id: "l2", worker: "王芳（虞嫂）", item: "1栋 01户 地砖", unit: "㎡", qty: 128, price: 34, amount: 4352 },
      { id: "l3", worker: "匡志强", item: "2栋 02户 墙砖", unit: "㎡", qty: 306.25, price: 36, amount: 11025 },
    ],
    allocations: [{ id: "a1", worker: "虞建华", amount: 6000 }, { id: "a2", worker: "王芳（虞嫂）", amount: 2000 }, { id: "a3", worker: "匡志强", amount: 0 }],
  };
  const PERIOD = { A: "月度请款", C1: "月度100%", C2: "月度100%" };

  // 页头 + 分区 + 吸底动作条：只组合设计系统 Button / Panel，不另做导航或通用件
  function Frame({ title, subtitle, onBack, footer, children }) {
    const { Button, Panel } = window.DesignSystem_e3d871;
    return <div style={{ maxWidth: 1080, margin: "0 auto", minWidth: 0, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button icon="arrow-left" onClick={onBack}>返回原工资</Button>
        <h1 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{title}</h1>
        <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{subtitle}</span>
      </div>
      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>{children}</div>
      <Panel padding={12} style={{ position: "sticky", bottom: 0, zIndex: 15, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", boxShadow: "0 -4px 16px rgba(16,24,40,0.06)" }}>{footer}</Panel>
    </div>;
  }
  const Sec = ({ id, title, sub, children }) => {
    const { Panel } = window.DesignSystem_e3d871;
    const SH = window.KitAtoms.SectionHeader;
    return <section id={"pissue-" + id} style={{ scrollMarginTop: 16, minWidth: 0 }}><Panel style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <SH mb={0}>{title}</SH>
      {sub && <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6 }}>{sub}</p>}
      {children}
    </Panel></section>;
  };

  function PayrollIssueScreen({ navigate, params = {} }) {
    const { Button } = window.DesignSystem_e3d871;
    const KA = window.KitAtoms;
    const Table = window.KitTable;
    const UI = window.KitUI || { toast: () => {}, confirm: o => o.onConfirm && o.onConfirm() };
    const state = params.previewState || "ready";
    const money = v => v == null ? "未记录" : "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const doc = { ...DOC, id: params.id || DOC.id, project: params.project || DOC.project, leader: params.leader || DOC.leader, month: params.month || DOC.month, format: ["A", "C1", "C2"].includes(params.format) ? params.format : DOC.format };
    const unavailable = params.issueState === "unavailable";
    const [settings, setSettings] = React.useState(state === "empty" ? null : { first: 1201, next: 1236, evidence: "已查 2019–2025 年纸质工资册，最后确认编号 1200；1187 缺失保持未知，不补空号。" });
    const [nextNumber, setNextNumber] = React.useState("");
    const [evidence, setEvidence] = React.useState("");
    const [pending, setPending] = React.useState(params.issueState === "pending");
    const [issue, setIssue] = React.useState(state === "readonly" ? { number: 1235, issuedAt: "2026-07-06 09:12", operator: "财务 · 林会计" } : null);
    const back = () => navigate(params.returnRoute || "payrollDetail", params.returnParams || (params.book ? { book: params.book, month: params.month, project: params.project, crew: params.crew } : {}));
    const title = "预览与正式出具工资";
    const subtitle = "核对原冻结工资后再正式出具。预览不占号，重复下载沿用原正式编号。";

    if (["loading", "error"].includes(state)) return <Frame title={title} subtitle={subtitle} onBack={back} footer={<Button onClick={back}>返回原工资</Button>}>
      <KA.StatePanel state={state} title={state === "loading" ? "正在读取原冻结工资…" : "正式出具资料未能读取"} description={state === "error" ? "未占用任何编号。请重新读取，或从原工资详情重新进入。" : undefined} actionLabel={state === "error" ? "重新读取" : undefined} onAction={() => navigate("payrollIssue", { ...params, previewState: "ready" })} />
    </Frame>;

    const reasons = [
      ...(unavailable ? ["原冻结快照缺少成员分配，不能正式出具；原工资保持只读。"] : []),
      ...(!settings ? ["项目尚未登记正式编号起点。"] : []),
    ];
    const canIssue = !unavailable && !!settings && !issue && !pending;
    const initialize = () => {
      if (!/^\d+$/.test(nextNumber.trim()) || !evidence.trim()) { UI.toast("请填写下一张正式编号（正整数）与旧纸号核对依据。", "warning"); return; }
      setSettings({ first: Number(nextNumber), next: Number(nextNumber), evidence: evidence.trim() });
      UI.toast("已登记项目起点（设计演示）；登记不为工资占号", "ok");
    };
    const doIssue = () => UI.confirm({
      title: "确认预览并正式出具？", message: "将为本份冻结工资分配项目唯一正式编号。出具后重复下载、打印沿用该编号，不能另行占号。", confirmText: "正式出具",
      onConfirm: () => { setIssue({ number: settings.next, issuedAt: "2026-07-06 09:12", operator: "当前经办人" }); setSettings(s => ({ ...s, next: s.next + 1 })); UI.toast("已正式出具，编号 " + settings.next + "（设计演示）", "ok"); },
    });
    const footer = <>
      <Button onClick={back}>返回原工资</Button>
      <Button disabled={pending} onClick={() => UI.toast("已重新核对原冻结工资与序列状态（设计演示）")}>重新核对</Button>
      <Button variant="primary" disabled={!canIssue} onClick={doIssue}>确认预览并正式出具</Button>
    </>;
    return <Frame title={title} subtitle={subtitle} onBack={back} footer={footer}>
      {pending && <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", border: "1px solid var(--warn)", background: "var(--warn-soft)", borderRadius: 12, padding: 12, fontSize: 12.5 }}>
        <span>原编号提交结果待核对；核对前不能另建出具记录。</span>
        <Button size="sm" onClick={() => { setPending(false); setIssue({ number: 1236, issuedAt: "2026-07-06 09:12", operator: "当前经办人" }); UI.toast("已按原提交核实：编号 1236 已出具（设计演示）", "ok"); }}>核对原编号提交</Button>
      </div>}
      <Sec id="numbering" title="项目正式编号" sub={doc.project}>
        {settings ? <>
          <p style={{ margin: 0, fontSize: 13 }}>已登记起点 <b style={{ fontFamily: "var(--font-mono)" }}>{settings.first}</b>；下一张可用编号 <b style={{ fontFamily: "var(--font-mono)" }}>{settings.next}</b>。此数字是当前序列状态，正式编号以出具回读为准。</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", overflowWrap: "anywhere" }}>核对依据：{settings.evidence}</p>
        </> : <>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.7 }}>先核对本项目旧纸质工资号，再明确下一张编号。遇到重复旧号先核对；缺失旧号保持未知，不猜补空号，也不按年份自动重置。</p>
          <div className="dc-fields">
            <label>下一张正式编号<input inputMode="numeric" aria-label="下一张正式编号" placeholder="人工核对后填写" value={nextNumber} onChange={e => setNextNumber(e.target.value)} /></label>
            <label>旧纸号核对依据<textarea rows={3} maxLength={2000} aria-label="旧纸号核对依据" placeholder="记录已查纸质范围、最后确认编号及缺口处理情况" value={evidence} onChange={e => setEvidence(e.target.value)} /></label>
          </div>
          <div><Button onClick={initialize}>登记项目起点</Button></div>
        </>}
      </Sec>
      <Sec id="preview" title="本份冻结工资预览" sub="只使用原发放时已保存的金额与成员，不按当前工程量或资料重新计算。">
        {unavailable ? <p style={{ margin: 0, fontSize: 13, color: "var(--warn-ink)" }}>原冻结资料尚不能支持正式出具。</p> : <>
          <dl className="dc-fields" style={{ margin: 0 }}>
            <div><dt>负责人 / 格式</dt><dd>{doc.leader} · {doc.format}</dd></div>
            <div><dt>月份 / 档位</dt><dd>{doc.month} · {PERIOD[doc.format]}</dd></div>
            <div><dt>核算应发</dt><dd style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{money(doc.gross)}</dd></div>
            <div><dt>原实际发放</dt><dd style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{money(doc.actual)}</dd></div>
          </dl>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", overflowWrap: "anywhere" }}>原工资：{doc.id} · 原发放时间：{doc.releasedAt}</p>
          {doc.note && <p style={{ margin: 0, fontSize: 13 }}>{doc.note}</p>}
          <KA.SectionHeader mb={0}>原工资明细</KA.SectionHeader>
          <Table label="原工资明细" rows={doc.lines} columns={[{ key: "worker", label: "姓名", width: 110 }, { key: "item", label: "分项", width: 200 }, { key: "unit", label: "单位", width: 60 }, { key: "qty", label: "数量", width: 90, align: "right", mono: true }, { key: "price", label: "单价", width: 90, align: "right", mono: true }, { key: "amount", label: "金额", width: 120, align: "right", money: true }]} />
          <KA.SectionHeader mb={0}>原实际收款（含零成员）</KA.SectionHeader>
          <Table label="原实际收款" rows={doc.allocations} columns={[{ key: "worker", label: "收款人", width: 160 }, { key: "amount", label: "原实际收款", width: 140, align: "right", money: true }]} />
        </>}
      </Sec>
      <Sec id="output" title="正式原件">
        {issue ? <>
          <div aria-label="正式出具身份" style={{ fontSize: 12.5, lineHeight: 1.8, overflowWrap: "anywhere" }}>
            <div><b>正式工资编号：{issue.number}</b> · {doc.format}</div>
            <div>原工资：{doc.id}</div>
            <div>正式出具：{issue.issuedAt} · 经办：{issue.operator}</div>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)" }}>重复下载、打印或找回原提交均沿用该编号。输出失败也不会重新占号。</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={() => UI.toast("下载正式工资 Excel（沿用编号 " + issue.number + "，设计演示）")}>下载正式工资 Excel</Button>
            <Button onClick={() => UI.toast("打开系统打印窗口（不改工资状态，设计演示）")}>打印正式工资</Button>
          </div>
        </> : <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>尚未正式出具，本次预览未占用编号。</p>}
        {reasons.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--warn-ink)" }}>{reasons.map(r => <li key={r}>{r}</li>)}</ul>}
      </Sec>
    </Frame>;
  }

  window.PayrollIssueScreen = PayrollIssueScreen;
})();
