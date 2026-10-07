// DayworkScreen — 零星签工台账（C2 来源；#244 设计稿回填，#412 按现行实现修正）。
// 依据：app/components/payroll/CentralSignedDayworkScreen.vue、PayrollDayworkTable.vue、
//       PayrollDayworkConfirmDialog.vue、PayrollDayworkLocks.vue 与 docs/rewrite/pages/subcontract-payroll.md「C2 零星签工」。
// 口径：按项目 × 月份 × 班组维护逐日签工；每条含日期、施工内容、起止时间、用工人、整工/半工、证明人和确认日期。
//       待确认（draft）保留在台账但不计薪；补齐证明人与确认日期后「人工确认」转为已确认（confirmed），已确认才是 C2 唯一计薪来源。
//       签工记录不保存单价与金额（C2 单价归「项目 × 负责人」主体配置），台账不显示金额；整工/半工不按时段折算。
// 新增/编辑走独立整页 dayworkForm（kit/DayworkFormScreen.jsx），人工确认为轻量弹窗。
// 演示数据：匿名虚构（ADR 0014 §9），经 window.DAYWORK_DEMO 写穿，整页保存后回台账可见；刷新恢复。
(function () {
  if (window.DayworkScreen) return;

  // —— 演示数据（签工整页 DayworkFormScreen 共用同一份；只在本文件播种）——
  window.DAYWORK_DEMO = window.DAYWORK_DEMO || {
    projects: [
      { id: "demo-p-hehe", name: "合和新城·3 号楼" },
      { id: "demo-p-jinxiu", name: "锦绣园·2 期" },
    ],
    crews: [
      { id: "demo-c-ns", name: "泥水二班" },
      { id: "demo-c-yq", name: "油漆一班" },
      { id: "demo-c-sd", name: "水电三班" },
    ],
    // eligible=false 表示当前名册资格不可用（离场/转组），不能再被选为用工人
    workers: [
      { id: "demo-w-1", name: "陈国强", crewId: "demo-c-ns", eligible: true },
      { id: "demo-w-2", name: "李建华", crewId: "demo-c-ns", eligible: true },
      { id: "demo-w-3", name: "王志明", crewId: "demo-c-yq", eligible: true },
      { id: "demo-w-4", name: "赵春林", crewId: "demo-c-yq", eligible: true },
      { id: "demo-w-5", name: "刘德胜", crewId: "demo-c-sd", eligible: true },
      { id: "demo-w-6", name: "周小勇", crewId: null, eligible: true },
      { id: "demo-w-7", name: "吴海波", crewId: "demo-c-sd", eligible: false },
    ],
    // availability：available 可用 / pending 待确认 / occupied 已由其他工资领用 / invalid 原资料只读 / deleted 已删除
    // reasons 取自后台 eligibility 原文（server/utils/payroll-daywork-service.ts），有原因即不可编辑、不可确认
    records: [
      { id: "demo-dw-001", projectId: "demo-p-hehe", crewId: "demo-c-ns", workerId: "demo-w-1", workDate: "2026-06-24", startTime: "08:00", endTime: "17:30", laborUnits: 1,
        workContent: "8 层 0802 卫生间地面返工找平", witness: "林工（甲方现场）", confirmedOn: "2026-06-24", status: "confirmed", note: "", availability: "available", reasons: [] },
      { id: "demo-dw-002", projectId: "demo-p-hehe", crewId: "demo-c-ns", workerId: "demo-w-2", workDate: "2026-06-24", startTime: "08:00", endTime: "12:00", laborUnits: 0.5,
        workContent: "8 层 0803 阳台地漏修补", witness: "林工（甲方现场）", confirmedOn: "2026-06-25", status: "confirmed", note: "", availability: "occupied",
        reasons: ["该人员月份已有考勤链或已发工资，原签工不可修改"] },
      { id: "demo-dw-003", projectId: "demo-p-hehe", crewId: "demo-c-yq", workerId: "demo-w-3", workDate: "2026-06-25", startTime: "13:30", endTime: "17:30", laborUnits: 0.5,
        workContent: "9 层公区墙面裂缝修补", witness: "", confirmedOn: null, status: "draft", note: "", availability: "pending", reasons: [] },
      { id: "demo-dw-004", projectId: "demo-p-hehe", crewId: "demo-c-yq", workerId: "demo-w-4", workDate: "2026-06-25", startTime: "08:00", endTime: "17:30", laborUnits: 1,
        workContent: "9 层公区腻子打磨", witness: "", confirmedOn: null, status: "draft", note: "等候甲方现场签认", availability: "pending", reasons: [] },
      { id: "demo-dw-005", projectId: "demo-p-hehe", crewId: "demo-c-sd", workerId: "demo-w-5", workDate: "2026-06-26", startTime: "08:00", endTime: "17:30", laborUnits: 1,
        workContent: "10 层管井封堵", witness: "黄主管", confirmedOn: "2026-06-26", status: "confirmed", note: "", availability: "available",
        reasons: ["这条签工已发工资，后续更正需引用原发放"] },
      { id: "demo-dw-006", projectId: "demo-p-hehe", crewId: "demo-c-sd", workerId: "demo-w-7", workDate: "2026-06-27", startTime: "08:00", endTime: "12:00", laborUnits: 0.5,
        workContent: "10 层强电井线槽调整", witness: "", confirmedOn: null, status: "draft", note: "", availability: "invalid",
        reasons: ["原签工的项目、人员或班组资格不可用"] },
    ],
    // 人员与月份占用（PayrollDayworkLocks）：已发工资整月锁定 / 原签工占用 / 原工资格式占用
    locks: [
      { workerId: "demo-w-2", month: "2026-06", formatFamily: "C2", kind: "daywork-occupation" },
      { workerId: "demo-w-5", month: "2026-06", formatFamily: "C2", kind: "released-month" },
    ],
  };

  const MONTHS = ["2026-06", "2026-05"];
  const STATE_LABEL = (v) => v === "confirmed" ? "已确认" : v === "draft" ? "待确认" : v == null ? "状态未记录" : "原状态：" + v;
  const LOCK_LABEL = (k) => k === "released-month" ? "已发工资整月锁定" : k === "format-exclusion" ? "原工资格式占用" : "原签工占用";
  const units = (n) => n == null ? "未记录" : String(n);

  function DayworkScreen({ navigate, params }) {
    const { Panel, Button, StatusChip, Icon, FilterPill } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const KT = window.KitTable;
    const UI = window.KitUI || { toast: () => {} };
    const P = Panel || "div";
    const D = window.DAYWORK_DEMO;
    const p = params || {};
    const preview = p.previewState || "ready";
    const writable = preview !== "readonly";

    // 筛选 = 来源上下文 project / month / crew / dayworkStatus（只恢复筛选，不参与记录身份）
    const [projectId, setProjectId] = React.useState(p.project || D.projects[0].id);
    const [month, setMonth] = React.useState(p.month || "2026-06");
    const [crewId, setCrewId] = React.useState(p.crew || "");
    const [statuses, setStatuses] = React.useState(p.dayworkStatus || []);
    const [, bump] = React.useState(0);

    const crewName = (id) => (D.crews.find((x) => x.id === id) || {}).name || "";
    const worker = (id) => D.workers.find((x) => x.id === id) || {};
    const scope = { project: projectId, month, crew: crewId, dayworkStatus: statuses };

    // 状态 pill 计数按项目 × 月份 × 班组范围；两项都不选 = 不按确认状态筛选
    const scoped = D.records
      .filter((r) => r.projectId === projectId && r.workDate.slice(0, 7) === month)
      .filter((r) => !crewId || r.crewId === crewId);
    const rows = scoped
      .filter((r) => !statuses.length || statuses.includes(r.status))
      .sort((a, b) => (a.workDate + a.startTime).localeCompare(b.workDate + b.startTime));
    const locks = D.locks.filter((l) => l.month === month && rows.some((r) => r.workerId === l.workerId));
    const sumUnits = (list) => list.reduce((s, r) => s + (Number(r.laborUnits) || 0), 0);
    const drafts = rows.filter((r) => r.status === "draft");
    const confirmed = rows.filter((r) => r.status === "confirmed");

    const toggleStatus = (v, on) => setStatuses((cur) => on ? [...new Set([...cur, v])] : cur.filter((x) => x !== v));

    // 人工确认（PayrollDayworkConfirmDialog）：只录真实证明人与确认日期，确认后转已确认；规则不自动扣款
    const confirmRow = (r) => {
      if (!UI.formModal) return;
      UI.formModal({
        title: "人工确认签工",
        subtitle: (worker(r.workerId).name || "姓名未记录") + " · " + r.workDate + " · " + units(r.laborUnits) + " 工。确认只记录本次真实证明信息。",
        width: 540,
        fields: [
          { key: "witness", label: "证明人", value: r.witness || "", required: true, full: true },
          { key: "confirmedOn", label: "确认日期", type: "date", value: r.confirmedOn || "", required: true, full: true },
        ],
        saveText: "确认签工",
        onSave: (vals) => {
          Object.assign(r, { witness: vals.witness, confirmedOn: vals.confirmedOn, status: "confirmed", availability: "available" });
          bump((n) => n + 1);
          UI.toast("签工已人工确认。", "ok");
        },
      });
    };

    const chip = (tone, text) => StatusChip ? <StatusChip tone={tone}>{text}</StatusChip> : text;
    const soft = { fontSize: 12, color: "var(--ink-soft)" };
    const warn = { fontSize: 12, color: "var(--warn-ink)", marginTop: 4 };
    const linkBtn = { border: 0, background: "transparent", color: "var(--brand-deep)", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 0 };

    const columns = [
      { key: "workDate", label: "用工人 / 日期", width: 150,
        render: (_v, r) => <div><div style={{ fontWeight: 700 }}>{worker(r.workerId).name || "姓名未记录"}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{r.workDate}</div>
          <div style={soft}>{r.crewId ? crewName(r.crewId) || "原班组名称未记录" : "未记录班组"}</div></div> },
      { key: "startTime", label: "时间 / 工数", width: 130,
        render: (_v, r) => <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
          <div>{(r.startTime || "未记录") + "–" + (r.endTime || "未记录")}</div>
          <div style={{ fontWeight: 700 }}>{units(r.laborUnits)} 工</div></div> },
      { key: "workContent", label: "施工内容", width: 240,
        render: (v) => <span style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{v || "内容未记录"}</span> },
      { key: "witness", label: "证明信息", width: 170,
        render: (_v, r) => <div style={{ whiteSpace: "normal" }}>
          <div>{r.witness || <span style={{ color: "var(--ink-faint)" }}>证明人未记录</span>}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{r.confirmedOn || <span style={{ color: "var(--ink-faint)" }}>确认日期未记录</span>}</div></div> },
      { key: "status", label: "确认与占用", width: 230,
        render: (v, r) => <div style={{ whiteSpace: "normal" }}>
          {chip(v === "confirmed" ? "ok" : v === "draft" ? "warn" : "neutral", STATE_LABEL(v))}
          {r.availability === "occupied" && <div style={soft}>已由其他工资领用</div>}
          {(r.availability === "invalid" || r.availability === "deleted") && <div style={soft}>原资料只读</div>}
          {(r.reasons || []).map((t) => <div key={t} style={warn}>{t}</div>)}
        </div> },
      { key: "_ops", label: "操作", width: 170,
        render: (_v, r) => {
          const canEdit = writable && !(r.reasons || []).length;
          const canConfirm = canEdit && r.status === "draft";
          return <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {canEdit && <button type="button" style={linkBtn} onClick={() => navigate("dayworkForm", { id: r.id, returnParams: scope })}>编辑签工</button>}
            {canConfirm && Button && <Button size="sm" variant="secondary" onClick={() => confirmRow(r)}>人工确认</Button>}
            {!canEdit && <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>只读</span>}
          </div>;
        } },
    ];

    const filterBar = (
      <P padding={0}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", flexWrap: "wrap" }}>
          {KA.SelectFilter ? <KA.SelectFilter label="项目" value={projectId} onChange={setProjectId} minWidth={168}
            options={D.projects.map((x) => ({ key: x.id, label: x.name }))} /> : null}
          {KA.SelectFilter ? <KA.SelectFilter label="月份" value={month} onChange={setMonth}
            options={MONTHS.map((m) => ({ key: m, label: m }))} /> : null}
          {KA.SelectFilter ? <KA.SelectFilter label="班组" value={crewId} onChange={setCrewId}
            options={[{ key: "", label: "全部班组" }, ...D.crews.map((x) => ({ key: x.id, label: x.name }))]} /> : null}
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>签工确认状态</span>
          {FilterPill ? <FilterPill label="待确认" count={scoped.filter((r) => r.status === "draft").length} active={statuses.includes("draft")} onClick={() => toggleStatus("draft", !statuses.includes("draft"))} /> : null}
          {FilterPill ? <FilterPill label="已确认" count={scoped.filter((r) => r.status === "confirmed").length} active={statuses.includes("confirmed")} onClick={() => toggleStatus("confirmed", !statuses.includes("confirmed"))} /> : null}
          <div style={{ flex: 1 }} />
          {Button && writable ? <Button variant="primary" icon="plus" onClick={() => navigate("dayworkForm", { project: projectId, crew: crewId, returnParams: scope })}>新增签工记录</Button> : null}
          {Button && writable ? <Button variant="secondary" onClick={() => { UI.toast("C2 工资草稿在工资核算整页建单，项目、月份与班组随来源带入", "info"); navigate("payroll", scope); }}>新建 C2 工资草稿</Button> : null}
          {Button ? <Button variant="secondary" onClick={() => navigate("payroll", scope)}>返回工资核算</Button> : null}
          {Button ? <Button variant="secondary" onClick={() => navigate("attendance", scope)}>打开考勤</Button> : null}
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: "8px 14px", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)" }}>
          逐日用工记录与真实证明；待确认不计薪，人工确认后才是 C2 唯一计薪来源；已发来源不能改写。整工/半工由经办人明确选择，不按时段折算。
        </div>
      </P>
    );

    let body;
    if (preview === "loading") body = KA.StatePanel ? <KA.StatePanel state="loading" title="正在读取签工原资料…" /> : null;
    else if (preview === "error") body = KA.StatePanel ? <KA.StatePanel state="error" title="签工未能读取" description="原筛选与输入保留，请重新读取。" actionLabel="重新读取" onAction={() => navigate("daywork", { ...p, previewState: "ready" })} /> : null;
    else if (!projectId || !month) body = <P><span style={{ fontSize: 13 }}>请选择项目和月份，查看该范围的签工；不会自动选择其他项目。</span></P>;
    else if (preview === "empty" || !rows.length) body = KA.StatePanel ? <KA.StatePanel state="empty" title="当前筛选没有签工记录" description="尚未登记不等于已经完成或确认。" actionLabel={writable ? "新增签工记录" : undefined} onAction={() => navigate("dayworkForm", { project: projectId, crew: crewId, returnParams: scope })} /> : null;
    else body = (
      <React.Fragment>
        {!writable && <div role="status" style={{ fontSize: 12, color: "var(--ink-soft)" }}>当前来源或身份仅供只读核对。</div>}
        {drafts.length ? (
          <P>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {Icon ? <Icon name="triangle-alert" size={16} color="var(--warn)" /> : null}
              <span style={{ flex: 1, fontSize: 13 }}>
                有 <b>{drafts.length}</b> 条签工待确认，共 <b>{sumUnits(drafts)}</b> 工，补齐证明人和确认日期并人工确认前不进入 C2 工资。
              </span>
            </div>
          </P>
        ) : null}
        {KT ? (
          <KT columns={columns} rows={rows} tableMinWidth={1090} minRows={6} empty="当前筛选没有签工记录"
            footerLeft={
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                已确认 {confirmed.length} 条 · {sumUnits(confirmed)} 工
                <span style={{ marginLeft: 12 }}>待确认 {drafts.length} 条 · {sumUnits(drafts)} 工（不计薪）</span>
              </span>
            } />
        ) : null}
        {locks.length ? (
          <P>
            {KA.SectionHeader ? <KA.SectionHeader>人员与月份占用</KA.SectionHeader> : null}
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.7 }}>
              真实已发工资按原全部成员保留整月占用，零收款或无签工成员也包含在内。旧来源证据缺项不解除已经确认的占用。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 10 }}>
              {locks.map((l, i) => (
                <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, fontSize: 12 }}>
                  <div style={{ fontWeight: 700 }}>{worker(l.workerId).name || "原工人姓名未记录"} · {l.month}</div>
                  <div style={{ marginTop: 4 }}>{l.formatFamily} · {LOCK_LABEL(l.kind)}</div>
                </div>
              ))}
            </div>
          </P>
        ) : null}
      </React.Fragment>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        {filterBar}
        {body}
      </div>
    );
  }

  window.DayworkScreen = DayworkScreen;
  // 预加载占位：app.dc.html 以 hint-size="0,0" x-import 本文件时只播种 DAYWORK_DEMO，不渲染台账（dayworkForm 直开也有数据）
  window.DayworkDemoPreload = function () { return null; };
})();
