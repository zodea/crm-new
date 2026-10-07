// PayrollRosterScreen — 工资实名名册归档整页（/subcontract/payroll/roster，#449）。
// 依据：WorkerRosterArchiveScreen / WorkerRosterMemberTable，docs/rewrite/pages/subcontract-payroll.md 第八节「完整工作簿」名册口径。
// 口径：仅能选同项目、冻结资料完整的已发 A/C1/C2 工资；负责人和零分配人员均来自原冻结成员；
//   名册为独立登记日期的资料补充，不证明原工资发放时已保存这些资料，资料缺口随版本保留；
//   相同工资范围按版本递增，登记日期与实际归档时间分别保留；后来补充资料只形成新版本。
//   读取需要单独的工人私密权限（worker:sensitive:read），工资权限不含身份证、银行资料和照片。
// 设计状态：previewState ready / empty=项目无可选已发工资 / readonly=可查看不可归档 / loading / error=权限或资料不可读。
// 以下为独立设计样本（证件号、账号均为虚构），不读写 data.js。
(function () {
  const STATEMENTS = [
    { id: "demo-payroll-202605-yjh", month: "2026-05", format: "A", leader: "虞建华", crew: "泥水A班", complete: true },
    { id: "demo-payroll-202605-c1", month: "2026-05", format: "C1", leader: "陈国强", crew: "杂工组", complete: true },
    { id: "demo-payroll-202604-old", month: "2026-04", format: "A", leader: "孙大勇", crew: "泥水A班", complete: false },
  ];
  const MEMBERS = [
    { id: "w1", name: "虞建华", payrollNames: ["虞建华"], leader: true, gender: "男", hometown: "浙江绍兴", idCard: "330000199001010012", bank: "农业银行绍兴支行", account: "6228 0000 0000 0012", contract: true, contractOn: "2024-08-15", entry: "2024-08-15", exit: null, site: "在场", portrait: true, bankCard: true, gaps: [] },
    { id: "w2", name: "王芳", payrollNames: ["王芳（虞嫂）"], leader: false, gender: "女", hometown: "浙江绍兴", idCard: "330000199002020024", bank: "未记录", account: "未记录", contract: true, contractOn: null, entry: "2024-08-15", exit: null, site: "在场", portrait: true, bankCard: false, gaps: ["缺开户行与账号", "缺银行卡照原件"] },
    { id: "w3", name: "匡志强", payrollNames: ["匡志强"], leader: false, gender: "男", hometown: "江西吉安", idCard: "360000198801010036", bank: "建设银行吉安支行", account: "6217 0000 0000 0036", contract: null, contractOn: null, entry: "2025-03-01", exit: "2026-05-20", site: "已退场", portrait: false, bankCard: true, gaps: ["劳动合同签订情况未记录", "缺证件照原件"] },
  ];
  const VERSIONS = [{ id: "roster-v1", registeredOn: "2026-05-31", version: 1, members: 3, statements: 2, gaps: 3 }];

  // 页头 + 分区 + 吸底动作条：只组合设计系统 Button / Panel，不另做导航或通用件
  function Frame({ title, subtitle, onBack, footer, children }) {
    const { Button, Panel } = window.DesignSystem_e3d871;
    return <div style={{ maxWidth: 1180, margin: "0 auto", minWidth: 0, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button icon="arrow-left" onClick={onBack}>返回工资</Button>
        <h1 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{title}</h1>
        <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{subtitle}</span>
      </div>
      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>{children}</div>
      <Panel padding={12} style={{ position: "sticky", bottom: 0, zIndex: 15, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", boxShadow: "0 -4px 16px rgba(16,24,40,0.06)" }}>{footer}</Panel>
    </div>;
  }
  const Sec = ({ title, sub, children }) => {
    const { Panel } = window.DesignSystem_e3d871;
    const SH = window.KitAtoms.SectionHeader;
    return <Panel style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <SH mb={0}>{title}</SH>
      {sub && <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6 }}>{sub}</p>}
      {children}
    </Panel>;
  };

  function PayrollRosterScreen({ navigate, params = {} }) {
    const { Button, StatusChip } = window.DesignSystem_e3d871;
    const KA = window.KitAtoms;
    const Table = window.KitTable;
    const UI = window.KitUI || { toast: () => {} };
    const state = params.previewState || "ready";
    const writable = state !== "readonly";
    const preset = typeof params.statements === "string" ? params.statements.split(",").filter(id => STATEMENTS.some(s => s.id === id && s.complete)) : [];
    const [project, setProject] = React.useState(params.project || "合和新城");
    const [registeredOn, setRegisteredOn] = React.useState("2026-06-30");
    const [selected, setSelected] = React.useState(preset);
    const [preview, setPreview] = React.useState(false);
    const [opened, setOpened] = React.useState(null);
    const rows = state === "empty" ? [] : STATEMENTS;
    const back = () => navigate(params.returnRoute || "payroll", params.returnParams || { project });
    const title = "工资实名名册归档";
    const subtitle = "按已发工资的原成员建立独立日期的名册。后来补充的资料形成新版本，原工资和旧名册保持不变。";
    const save = () => { setOpened({ id: "roster-v2", version: 2, createdAt: "2026-07-06 10:20", registeredOn }); setPreview(false); UI.toast("已归档名册版本 2（设计演示）；原工资与旧版本保持不变", "ok"); };
    const footer = <><Button onClick={back}>返回工资</Button><Button variant="primary" disabled={!writable || !preview} onClick={save}>按当前预览归档新版本</Button></>;

    if (["loading", "error"].includes(state)) return <Frame title={title} subtitle={subtitle} onBack={back} footer={<Button onClick={back}>返回工资</Button>}>
      <KA.StatePanel state={state === "error" ? "forbidden" : "loading"} title={state === "loading" ? "正在读取名册资料…" : "名册权限或资料未能读取"} description={state === "error" ? "实名名册需要单独的工人私密资料权限；工资权限不包含身份证、银行资料和照片。" : undefined} actionLabel={state === "error" ? "重新读取" : undefined} onAction={() => navigate("payrollRoster", { ...params, previewState: "ready" })} />
    </Frame>;

    const doc = opened || (preview ? { registeredOn } : null);
    const memberCols = [
      { key: "name", label: "姓名 / 工资成员", width: 170, render: (v, r) => <span style={{ whiteSpace: "normal" }}><b>{v}</b><span style={{ display: "block", fontSize: 11.5 }}>原工资：{r.payrollNames.join(" / ")}</span>{r.leader && <StatusChip tone="brand">请款负责人</StatusChip>}</span> },
      { key: "gender", label: "性别 / 籍贯", width: 110, render: (v, r) => <span>{v}<span style={{ display: "block" }}>{r.hometown}</span></span> },
      { key: "idCard", label: "身份证号", width: 180, mono: true },
      { key: "bank", label: "开户行 / 账号", width: 200, render: (v, r) => <span>{v}<span style={{ display: "block", fontFamily: "var(--font-mono)" }}>{r.account}</span></span> },
      { key: "contract", label: "劳动合同", width: 130, render: (v, r) => <span>{v == null ? "未记录" : v ? "已签订" : "未签订"}<span style={{ display: "block" }}>{r.contractOn || "无签订日期记录"}</span></span> },
      { key: "entry", label: "进退场 / 登记日在场", width: 160, render: (v, r) => <span>进：{v || "未记录"}<span style={{ display: "block" }}>退：{r.exit || "未记录"}</span><StatusChip tone={r.site === "在场" ? "ok" : "neutral"}>{r.site}</StatusChip></span> },
      { key: "portrait", label: "照片", width: 130, render: (v, r) => <span>证件照：{v ? "有原件" : "缺原件"}<span style={{ display: "block" }}>银行卡照：{r.bankCard ? "有原件" : "缺原件"}</span></span> },
      { key: "gaps", label: "资料缺口", width: 220, render: v => v.length ? <span style={{ whiteSpace: "normal", color: "var(--warn-ink)" }}>{v.join("；")}</span> : "资料已记录" },
    ];
    return <Frame title={title} subtitle={subtitle} onBack={back} footer={footer}>
      {!writable && <p role="status" style={{ margin: 0 }}>当前仅可查看已有名册版本，不能归档新版本。</p>}
      <Sec title="选择工资与资料登记日期" sub="仅能选同项目的已发 A/C1/C2 工资；负责人和零分配人员均来自原冻结成员。">
        <div className="dc-fields">
          <label>项目<select aria-label="项目" value={project} onChange={e => { setProject(e.target.value); setSelected([]); setPreview(false); setOpened(null); }}><option value="">请选择项目</option>{[...new Set([project, "合和新城", "锦绣华庭"].filter(Boolean))].map(p => <option key={p}>{p}</option>)}</select></label>
          <label>资料登记日期<input type="date" aria-label="资料登记日期" value={registeredOn} onChange={e => { setRegisteredOn(e.target.value); setPreview(false); }} /></label>
        </div>
        {project && <div style={{ display: "grid", gap: 6, maxHeight: 320, overflowY: "auto" }}>
          {rows.length ? rows.map(r => <label key={r.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid var(--line)", borderRadius: 8, padding: 10, fontSize: 12.5, minWidth: 0 }}>
            <input type="checkbox" aria-label={"选择工资 " + r.id} disabled={!r.complete} checked={selected.includes(r.id)} onChange={e => { const on = e.target.checked; setSelected(s => on ? [...s, r.id] : s.filter(x => x !== r.id)); setPreview(false); }} />
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}><b>{r.month} · {r.format} · {r.leader}</b><span style={{ marginLeft: 8 }}>{r.crew}</span><span style={{ display: "block", color: "var(--ink-soft)" }}>{r.id}</span>{!r.complete && <span style={{ display: "block", color: "var(--warn-ink)" }}>冻结资料不完整，不能建立名册</span>}</span>
          </label>) : <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>此项目尚无可选的已发工资。</p>}
        </div>}
        <div><Button disabled={!project || !selected.length || !registeredOn} onClick={() => { setPreview(true); setOpened(null); }}>{"核对所选 " + selected.length + " 份工资的名册"}</Button></div>
      </Sec>
      <Sec title="实名名册">
        {doc ? <>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>本名册为独立日期的资料补充，不证明原工资发放时已保存这些资料。资料缺口随该版本保留。</p>
          {opened && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
            <div style={{ minWidth: 0 }}><b>已归档版本 {opened.version}</b><div style={{ fontSize: 12, color: "var(--ink-soft)", overflowWrap: "anywhere" }}>实际归档 {opened.createdAt} · {opened.id}</div></div>
            <Button onClick={() => UI.toast("下载名册与照片 ZIP（重新核对私密权限，设计演示）")}>下载名册与照片 ZIP</Button>
          </div>}
          <p style={{ margin: 0, fontSize: 12.5 }}><b>{project} · {MEMBERS.length} 人</b> · 登记日期 {doc.registeredOn}；在场 2，已退场 1，未进场 0，状态未知 0。</p>
          <Table label="实名名册横向滚动区域" rows={MEMBERS} minRows={3} tableMinWidth={1250} columns={memberCols} />
        </> : <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>先核对工资成员，或打开下方已归档版本。</p>}
      </Sec>
      <Sec title="已有归档版本" sub="相同工资范围按版本递增；登记日期和实际归档时间分别保留。">
        {state === "empty" ? <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>当前项目还没有名册归档。</p> : VERSIONS.map(v => <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 10, fontSize: 12 }}>
          <div style={{ minWidth: 0 }}><b>{v.registeredOn} · 版本 {v.version}</b><div>{v.members} 人 · {v.statements} 份工资 · {v.gaps} 项资料缺口</div><div style={{ color: "var(--ink-soft)", overflowWrap: "anywhere" }}>{v.id}</div></div>
          <Button size="sm" onClick={() => { setOpened({ id: v.id, version: v.version, createdAt: "2026-06-01 09:30", registeredOn: v.registeredOn }); setPreview(false); }}>打开此版本</Button>
        </div>)}
      </Sec>
    </Frame>;
  }

  window.PayrollRosterScreen = PayrollRosterScreen;
})();
