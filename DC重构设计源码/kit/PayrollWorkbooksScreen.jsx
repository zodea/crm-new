// PayrollWorkbooksScreen — 完整工资工作簿整页（/subcontract/payroll/workbooks，#479 / P7）。
// 依据：PayrollWorkbookScreen / Selection / Preview / History，docs/rewrite/pages/subcontract-payroll.md 第八节末段。
// 口径：先选同项目已发原单与输出方式（负责人全周期一册 / 项目按月 ZIP），再明确选一份同范围、有登记日期的名册版本；
//   预览后保存不可变目录。正式编号沿用已出具原号，未出具标缺口并返回原单出具，保存不自动发号；
//   保存与下载分开；XLSX/工资 ZIP 不含私密附件；完整包每次下载重核名册权限与原件摘要；
//   之后退款、改名、换照片只进入新版本。未知输出只进缺口清单，不补零表。
// 设计状态：previewState ready / empty=项目无已发工资 / readonly=仅工资权限（无工人私密读取）/ loading / error。
// 以下为独立设计样本，不读写 data.js。
(function () {
  const STATEMENTS = [
    { id: "demo-payroll-202604-yjh", month: "2026-04", format: "A", leader: "虞建华", book: "普通工资", gross: 9620.5, actual: 9600, number: 1231 },
    { id: "demo-payroll-202605-yjh", month: "2026-05", format: "A", leader: "虞建华", book: "普通工资", gross: 10310.1, actual: 10300, number: 1233 },
    { id: "demo-payroll-202605-mgmt", month: "2026-05", format: "A", leader: "虞建华", book: "独立管理费簿", gross: 520, actual: 520, number: null },
    { id: "demo-payroll-202605-c1", month: "2026-05", format: "C1", leader: "陈国强", book: "普通工资", gross: 11230, actual: 11230, number: 1234 },
  ];
  const SUBJECTS = [{ key: "yjh-A-normal", label: "虞建华 · A · 普通工资" }, { key: "yjh-A-mgmt", label: "虞建华 · A · 独立管理费簿" }, { key: "cgq-C1", label: "陈国强 · C1" }];
  const ROSTERS = [{ id: "roster-v2", label: "2026-06-30 · 版本 2 · 6 人 · 1 项缺口" }, { id: "roster-v1", label: "2026-05-31 · 版本 1 · 5 人 · 2 项缺口" }];
  const VERSIONS = [{ id: "wb-202606-v1", mode: "负责人全周期", version: 1, count: 2, completeness: "部分资料", createdAt: "2026-06-02 15:40" }];

  // 页头 + 分区 + 吸底动作条：只组合设计系统 Button / Panel，不另做导航或通用件
  function Frame({ title, subtitle, onBack, footer, children }) {
    const { Button, Panel } = window.DesignSystem_e3d871;
    return <div style={{ maxWidth: 1080, margin: "0 auto", minWidth: 0, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button icon="arrow-left" onClick={onBack}>返回工资</Button>
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
    return <section id={"pwb-" + id} style={{ scrollMarginTop: 16, minWidth: 0 }}><Panel style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <SH mb={0}>{title}</SH>
      {sub && <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6 }}>{sub}</p>}
      {children}
    </Panel></section>;
  };

  function PayrollWorkbooksScreen({ navigate, params = {} }) {
    const { Button, StatusChip } = window.DesignSystem_e3d871;
    const KA = window.KitAtoms;
    const Table = window.KitTable;
    const UI = window.KitUI || { toast: () => {} };
    const state = params.previewState || "ready";
    const privateReadable = state !== "readonly";
    const money = v => v == null ? "未记录" : "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const [project, setProject] = React.useState(params.project || "合和新城");
    const [mode, setMode] = React.useState("leader-cycle");
    const [subject, setSubject] = React.useState("yjh-A-normal");
    const [roster, setRoster] = React.useState("");
    const [preview, setPreview] = React.useState(false);
    const [opened, setOpened] = React.useState(null);
    const selected = state === "empty" ? [] : mode === "project-month" ? STATEMENTS : STATEMENTS.filter(s => subject === "yjh-A-normal" ? s.leader === "虞建华" && s.book === "普通工资" : subject === "yjh-A-mgmt" ? s.book === "独立管理费簿" : s.format === "C1");
    const reset = () => { setPreview(false); setOpened(null); };
    const back = () => navigate("payroll", params.returnParams || { project });
    const canSave = preview && selected.length > 0 && !opened;
    const save = () => { setOpened({ id: "wb-202607-v2", version: 2, createdAt: "2026-07-06 10:05", mode, rosterRef: roster && privateReadable }); UI.toast("已保存当前目录版本 2（设计演示）；保存目录不会自动发放、占号或另建名册", "ok"); };
    const footer = <><Button onClick={back}>返回工资</Button><Button onClick={() => UI.toast("已重新读取工资目录（设计演示）")}>重新读取</Button><Button variant="primary" disabled={!canSave} onClick={save}>保存当前目录版本</Button></>;
    const title = "完整工资工作簿";
    const subtitle = "固定原工资、正式编号和独立名册版本，再下载可复核的工资文件。";

    if (["loading", "error"].includes(state)) return <Frame title={title} subtitle={subtitle} onBack={back} footer={<Button onClick={back}>返回工资</Button>}>
      <KA.StatePanel state={state} title={state === "loading" ? "正在读取工资目录…" : "工资目录未能读取"} actionLabel={state === "error" ? "重新读取" : undefined} onAction={() => navigate("payrollWorkbooks", { ...params, previewState: "ready" })} />
    </Frame>;

    const gaps = selected.filter(s => s.number == null);
    return <Frame title={title} subtitle={subtitle} onBack={back} footer={footer}>
      <Sec id="scope" title="固定工资范围与名册版本" sub="工资取原冻结资料；实际收付按保存目录时点保留。后续补退与新资料进入新版本。">
        <div className="dc-fields">
          <label>项目<select aria-label="归档项目" value={project} onChange={e => { setProject(e.target.value); reset(); }}><option value="">请选择项目</option>{[...new Set([project, "合和新城", "锦绣华庭"].filter(Boolean))].map(p => <option key={p}>{p}</option>)}</select></label>
          <label>输出方式<select aria-label="输出方式" value={mode} onChange={e => { setMode(e.target.value); reset(); }}><option value="leader-cycle">负责人全周期一册</option><option value="project-month">项目按月 ZIP</option></select></label>
          {mode === "leader-cycle" && <label>负责人 / 格式 / 请款簿<select aria-label="负责人请款簿" value={subject} onChange={e => { setSubject(e.target.value); reset(); }}><option value="">请选择负责人请款簿</option>{SUBJECTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>}
          <label>独立名册归档版本<select aria-label="名册归档版本" value={roster} disabled={!privateReadable} onChange={e => { setRoster(e.target.value); reset(); }}><option value="">请选择与工资范围一致的版本</option>{ROSTERS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        </div>
        {!privateReadable && <p style={{ margin: 0, fontSize: 12, color: "var(--warn-ink)" }}>当前可阅读工资目录；工人私密资料需单独授权，工资权限不包含身份证、银行资料和照片。</p>}
        {privateReadable && selected.length > 0 && <div><Button size="sm" onClick={() => navigate("payrollRoster", { project, statements: selected.map(s => s.id).join(",") })}>为当前工资范围准备实名名册版本</Button></div>}
        <div tabIndex={0} aria-label="所选原工资" style={{ maxHeight: 220, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
          <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 600 }}>本次范围 {selected.length} 份原工资</p>
          {selected.length ? selected.map(s => <p key={s.id} style={{ margin: 0, padding: "6px 0", borderTop: "1px solid var(--line)", fontSize: 12, overflowWrap: "anywhere" }}>{s.month} · {s.format} · {s.leader} · {s.book}<span style={{ display: "block", color: "var(--ink-soft)" }}>{s.id}</span></p>)
            : <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)" }}>此项目尚无已发 A/C1/C2 原工资，不生成补零表。</p>}
        </div>
        <div><Button disabled={!project || !selected.length} onClick={() => { setPreview(true); setOpened(null); }}>核对当前范围与固定版本</Button></div>
      </Sec>
      <Sec id="preview" title={opened ? "已保存目录 · 版本 " + opened.version : "待保存目录预览"} sub="普通工资、独立管理费簿、考勤与签工原表分别保留；部分资料不会伪称附件齐全。">
        {!preview ? <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-soft)" }}>先核对当前工资范围，或打开下方已保存版本。</p> : <>
          {opened && <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", overflowWrap: "anywhere" }}>保存时点 {opened.createdAt} · {opened.id} · {gaps.length ? "目录资料部分" : "目录资料完整"}。保存目录不代表文件已下载。</p>}
          {roster && privateReadable && <p style={{ margin: 0, fontSize: 12 }}>固定名册：{ROSTERS.find(r => r.id === roster).label}。此为独立日期的资料补充，不冒充工资发放时原件。</p>}
          <Table label="目录工资明细" rows={selected} tableMinWidth={760} columns={[
            { key: "month", label: "月份 / 原工资", width: 200, render: (v, r) => <span style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{v}<span style={{ display: "block", fontSize: 11, color: "var(--ink-soft)" }}>{r.id}</span></span> },
            { key: "leader", label: "负责人 / 格式", width: 160, render: (v, r) => <span>{v} · {r.format}{r.book === "独立管理费簿" && <span style={{ display: "block", fontSize: 11 }}>独立管理费簿</span>}</span> },
            { key: "number", label: "正式编号", width: 110, render: v => v == null ? <StatusChip tone="warn">尚未正式出具</StatusChip> : <span style={{ fontFamily: "var(--font-mono)" }}>{v}</span> },
            { key: "gross", label: "本单应发", width: 110, align: "right", money: true }, { key: "actual", label: "冻结实发", width: 110, align: "right", money: true },
            { key: "_link", label: "原件", width: 120, render: (_v, r) => <Button size="sm" variant="ghost" onClick={() => navigate("payrollIssue", { id: r.id, project, leader: r.leader, month: r.month, format: r.format, returnRoute: "payrollWorkbooks", returnParams: { project } })}>{r.number == null ? "核对正式出具" : "查看正式原件"}</Button> },
          ]} />
          {(gaps.length > 0 || !roster) && <div role="status" style={{ border: "1px solid var(--warn)", background: "var(--warn-soft)", borderRadius: 8, padding: 10, fontSize: 12, display: "grid", gap: 4 }}>
            <b>保留的资料缺口</b>
            {gaps.map(g => <span key={g.id} style={{ overflowWrap: "anywhere" }}>{g.month} · {g.id}：原单尚未正式出具，保存不自动发号。</span>)}
            {!roster && <span>{privateReadable ? "未选择名册版本：完整包缺少实名附件。" : "无工人私密读取权限：只能输出工资部分，明确缺少实名附件。"}</span>}
          </div>}
        </>}
        {opened && <div aria-label="已保存目录下载" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {opened.mode === "leader-cycle" && <Button onClick={() => UI.toast("下载工资 XLSX（设计演示）")}>下载工资 XLSX</Button>}
          <Button onClick={() => UI.toast("下载工资 ZIP（不含实名附件，设计演示）")}>下载工资 ZIP（不含实名附件）</Button>
          {privateReadable && opened.rosterRef && <Button variant="primary" onClick={() => UI.toast("重新核对名册权限与原件摘要后下载（设计演示）")}>下载工资、名册与照片 ZIP</Button>}
          <p style={{ margin: 0, width: "100%", fontSize: 12, color: "var(--ink-soft)" }}>XLSX 和工资 ZIP 不含私密附件。完整包每次下载重新核对名册权限与原件摘要；保存目录不会自动发放、占号或另建名册。</p>
        </div>}
      </Sec>
      <Sec id="history" title="已保存的工资目录" sub="重新打开保持原编号、名册版本和保存时点的实际收付。后来资料变化不会改写旧目录。">
        {state === "empty" ? <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>当前项目还没有保存工资目录。</p> : VERSIONS.map(v => <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 10, fontSize: 12 }}>
          <div style={{ minWidth: 0 }}><b>{v.mode} · 版本 {v.version}</b><div>{v.count} 份工资 · {v.completeness} · {v.createdAt}</div><div style={{ color: "var(--ink-soft)", overflowWrap: "anywhere" }}>{v.id}</div></div>
          <Button size="sm" onClick={() => { setMode("leader-cycle"); setSubject("yjh-A-normal"); setPreview(true); setOpened({ id: v.id, version: v.version, createdAt: v.createdAt, mode: "leader-cycle", rosterRef: false }); }}>打开原目录</Button>
        </div>)}
      </Sec>
    </Frame>;
  }

  window.PayrollWorkbooksScreen = PayrollWorkbooksScreen;
})();
