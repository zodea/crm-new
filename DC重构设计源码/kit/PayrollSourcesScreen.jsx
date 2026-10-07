// PayrollSourcesScreen — 工资来源只读整页（/subcontract/payroll/sources，#412）。
// 依据：CentralPayrollSourcesScreen / PayrollReadFilters(source) / PayrollEvidenceTable，
//       docs/rewrite/pages/subcontract-payroll.md「浏览器中央接管阶段」与第二节来源上下文。
// 口径：工资配置、考勤、签工与月份/签工占用可独立查询，无须先建工资单；
//   签工确认状态（待确认/已确认）只筛签工记录，与工资状态分开；软删记录按「记录范围」分别查看；
//   零金额成员、无工资行成员同样占用月份；缺历史姓名时不以当前名册补写。
// 设计状态：previewState empty=未选项目 / loading / error；其余为 ready。params.tab 可指定初始视图。
// 以下为独立设计样本，不读写 data.js。
(function () {
  const CONFIGS = [
    { id: "c1", format: "C2", enabled: "有效", updatedAt: "2026-06-02 10:15", rate: 350, rule: "1、当日用工由证明人 2 天内确认；2、半工按 0.5 工计。", deletedAt: null },
    { id: "c2", format: "C1", enabled: "有效", updatedAt: "2026-05-28 09:40", rate: null, rule: "—", deletedAt: null },
    { id: "c3", format: "C2", enabled: "已停用", updatedAt: "2026-03-11 14:02", rate: 320, rule: "原规则未记录", deletedAt: "2026-04-01 08:00" },
  ];
  const ATTENDANCE = [
    { id: "t1", worker: "陈国强", date: "2026-06-03", hours: 8, ot: 0, content: "3 号楼 8 层找平", note: "", deletedAt: null },
    { id: "t2", worker: "陈国强", date: "2026-06-04", hours: 7.5, ot: 2, content: "3 号楼 8 层铺贴", note: "", deletedAt: null },
    { id: "t3", worker: "李建华", date: "2026-06-04", hours: 0, ot: 0, content: "雨停工", note: "已登记零工时", deletedAt: null },
    { id: "t4", worker: "刘德胜", date: "2026-06-05", hours: 8, ot: 0, content: "重复登记", note: "", deletedAt: "2026-06-06 09:00" },
  ];
  const DAYWORK = [
    { id: "d1", worker: "王志明", date: "2026-06-24", start: "08:00", end: "17:00", units: 1, status: "confirmed", content: "3 号楼 9 层公区清理", witness: "周伟峰", confirmedOn: "2026-06-25", deletedAt: null },
    { id: "d2", worker: "赵春林", date: "2026-06-25", start: "13:00", end: "17:00", units: 0.5, status: "draft", content: "3 号楼 9 层补洞", witness: "", confirmedOn: "", deletedAt: null },
  ];
  const LOCKS = [
    { id: "k1", month: "2026-05", format: "C1", meaning: "当月已有发放记录", worker: "worker-chen-guoqiang", statement: "demo-payroll-202605-c1", daywork: "—" },
    { id: "k2", month: "2026-06", format: "C2", meaning: "签工已被工资单领用", worker: "worker-wang-zhiming", statement: "demo-payroll-202606-c2", daywork: "d1" },
    { id: "k3", month: "2026-06", format: "C2", meaning: "当月工资格式已被占用", worker: "worker-zhao-chunlin", statement: "demo-payroll-202606-c2", daywork: "—" },
  ];
  const TABS = [{ key: "configs", label: "工资配置" }, { key: "attendance", label: "考勤记录" }, { key: "daywork", label: "签工记录" }, { key: "locks", label: "月份与签工占用" }];
  const STATUS = { draft: "待确认", confirmed: "已确认" };

  function PayrollSourcesScreen({ navigate, params = {} }) {
    const { Panel, Button, StatusChip, StageTab } = window.DesignSystem_e3d871;
    const KA = window.KitAtoms;
    const Table = window.KitTable;
    const UI = window.KitUI || { toast: () => {} };
    const state = params.previewState || "ready";
    const [scope, setScope] = React.useState({ project: state === "empty" ? "" : (params.project || "合和新城"), month: /^\d{4}-\d{2}$/.test(params.month || "") ? params.month : "2026-06", crew: params.crew || "", deleted: params.deleted || "", dayworkStatus: params.dayworkStatus || "" });
    const [tab, setTab] = React.useState(TABS.some(t => t.key === params.tab) ? params.tab : "configs");
    React.useEffect(() => { if (state === "empty") setScope(s => ({ ...s, project: "" })); }, [state]);
    const change = v => setScope(s => ({ ...s, ...v }));
    const show = r => !scope.deleted || (!!r.deletedAt) === (scope.deleted === "deleted");
    const recordState = v => v ? <StatusChip tone="neutral">已删除 · {v.slice(0, 10)}</StatusChip> : "有效";
    const back = () => navigate(params.returnRoute || "payroll", params.returnParams || { project: scope.project, month: scope.month, crew: scope.crew });
    const opt = (list, empty) => [{ key: "", label: empty }, ...list.map(x => typeof x === "string" ? { key: x, label: x } : x)];

    const counts = { configs: CONFIGS.filter(show).length, attendance: ATTENDANCE.filter(show).length, daywork: DAYWORK.filter(r => show(r) && (!scope.dayworkStatus || r.status === scope.dayworkStatus)).length, locks: LOCKS.length };
    const tables = {
      configs: <Table label="工资配置" rows={CONFIGS.filter(show)} minRows={3} empty="当前范围没有已保存的工资配置" columns={[
        { key: "format", label: "工资格式", width: 90 }, { key: "enabled", label: "启用状态", width: 90 }, { key: "updatedAt", label: "最近修改", width: 150, mono: true },
        { key: "rate", label: "费率", width: 110, align: "right", money: true }, { key: "rule", label: "确认规则", width: 320 }, { key: "deletedAt", label: "记录状态", width: 140, render: recordState },
      ]} />,
      attendance: <Table label="独立考勤记录" rows={ATTENDANCE.filter(show)} minRows={4} empty="当前范围没有考勤记录" columns={[
        { key: "worker", label: "姓名", width: 100 }, { key: "date", label: "日期", width: 110, mono: true }, { key: "hours", label: "正常工时", width: 90, align: "right", mono: true },
        { key: "ot", label: "加班工时", width: 90, align: "right", mono: true }, { key: "content", label: "工作内容", width: 260 }, { key: "note", label: "备注", width: 200 }, { key: "deletedAt", label: "记录状态", width: 140, render: recordState },
      ]} />,
      daywork: <Table label="独立签工记录" rows={DAYWORK.filter(r => show(r) && (!scope.dayworkStatus || r.status === scope.dayworkStatus))} minRows={3} empty="当前范围没有签工记录" columns={[
        { key: "worker", label: "姓名", width: 100 }, { key: "date", label: "日期", width: 110, mono: true }, { key: "start", label: "开始", width: 70, mono: true }, { key: "end", label: "结束", width: 70, mono: true },
        { key: "units", label: "工数", width: 70, align: "right", mono: true }, { key: "status", label: "签工确认状态", width: 120, render: v => <StatusChip tone={v === "confirmed" ? "ok" : "warn"}>{STATUS[v]}</StatusChip> },
        { key: "content", label: "工作内容", width: 240 }, { key: "witness", label: "证明人", width: 90, render: v => v || "未记录" }, { key: "confirmedOn", label: "确认日期", width: 110, render: v => v || "未确认" }, { key: "deletedAt", label: "记录状态", width: 120, render: recordState },
      ]} />,
      locks: <div style={{ display: "grid", gap: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)" }}>零金额成员、没有工资明细的成员仍可能占用月份；签工确认状态与工资单发放状态分别记录。</p>
        <Table label="已保存的月份与签工占用" rows={LOCKS} minRows={3} empty="当前范围没有月份或签工占用" columns={[
          { key: "month", label: "月份", width: 90, mono: true }, { key: "format", label: "工资格式", width: 90 }, { key: "meaning", label: "占用说明", width: 200 },
          { key: "worker", label: "成员原身份", width: 220, mono: true }, { key: "statement", label: "关联工资身份", width: 220, mono: true }, { key: "daywork", label: "关联签工身份", width: 140, mono: true },
        ]} />
      </div>,
    };

    return <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div><h1 style={{ fontSize: 20, margin: 0 }}>工资来源</h1><p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-faint)" }}>工资配置、考勤与签工可独立查询，无须先建立工资单。</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button onClick={back}>返回工资记录</Button><Button onClick={() => UI.toast("已重新读取工资来源（设计演示）")}>刷新</Button></div>
      </div>
      <Panel style={{ background: "var(--brand-soft)", fontSize: 12, lineHeight: 1.7, color: "var(--ink-soft)" }}>
        <b style={{ color: "var(--ink)" }}>可处理 A 完成量工资、C1 考勤工资与 C2 签工工资。</b> A 按完成责任和现场量核算；C1 按逐日考勤与每人标准核算；C2 按人工确认的签工与主体标准核算。旧资料缺项仍保留原文供核对。
      </Panel>
      <Panel padding={0}><div role="group" aria-label="工资资料筛选" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px" }}>
        <KA.SelectFilter label="项目" value={scope.project} onChange={v => change({ project: v, crew: "" })} options={opt([...new Set([scope.project, "合和新城", "锦绣华庭"].filter(Boolean))], "选择来源项目")} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-soft)" }}>月份<input type="month" className="dc-state-select" aria-label="来源月份" value={scope.month} onChange={e => change({ month: e.target.value })} /></label>
        <KA.SelectFilter label="班组" value={scope.crew} onChange={v => change({ crew: v })} options={opt([...new Set([scope.crew, "泥水A班", "油漆二组"].filter(Boolean))], "全部班组")} />
        <KA.SelectFilter label="记录范围" value={scope.deleted} onChange={v => change({ deleted: v })} options={[{ key: "", label: "全部历史" }, { key: "active", label: "未删除" }, { key: "deleted", label: "已删除" }]} />
        <KA.SelectFilter label="签工确认状态" value={scope.dayworkStatus} onChange={v => change({ dayworkStatus: v })} options={[{ key: "", label: "全部确认状态" }, { key: "draft", label: "待确认" }, { key: "confirmed", label: "已确认" }]} />
      </div></Panel>
      {state === "loading" || state === "error" ? <KA.StatePanel state={state} title={state === "loading" ? "正在读取工资来源…" : "来源项目与当前选择不一致，请重新打开。"} actionLabel={state === "error" ? "重新读取" : undefined} onAction={() => navigate("payrollSources", { ...params, previewState: "ready" })} />
        : !scope.project ? <KA.StatePanel state="empty" title="请选择项目查看独立来源" description="没有工资单的项目仍可查询已经保存的配置、考勤和签工。" />
        : <>
          <Panel style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <b>原资料需核对</b>
            <span style={{ color: "var(--warn-ink)" }}>刘德胜 2026-06-05 考勤为已删除记录，原占用关系保留追溯，不凭当前同名人补关系。</span>
          </Panel>
          <nav aria-label="工资来源视图" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {TABS.map(t => <StageTab key={t.key} label={t.label} count={counts[t.key]} active={tab === t.key} onClick={() => setTab(t.key)} />)}
          </nav>
          {tables[tab]}
          <Panel><details><summary style={{ cursor: "pointer", fontSize: 12.5 }}>查看来源记录身份</summary>
            <p style={{ fontSize: 12, color: "var(--ink-soft)" }}>配置与占用资料没有保存历史姓名时，不以当前名册补写。</p>
            <pre tabIndex={0} style={{ maxHeight: 200, overflow: "auto", fontSize: 11.5, whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>{JSON.stringify({ configs: CONFIGS.map(c => ({ id: c.id, crewId: "crew-ni-shui-a", leaderWorkerId: "worker-yu-jianhua" })) }, null, 2)}</pre>
          </details></Panel>
          <Panel style={{ fontSize: 12, color: "var(--ink-soft)" }}>来源版本 v18 · 读取于 2026-07-06 09:30 · 工作区来源：正式资料</Panel>
        </>}
    </div>;
  }

  window.PayrollSourcesScreen = PayrollSourcesScreen;
})();
