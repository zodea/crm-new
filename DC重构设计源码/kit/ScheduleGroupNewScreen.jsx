// ScheduleGroupNewScreen — 新建楼栋分组·独立子页面（反馈轮 8：原简陋弹窗废弃）
// 左：分组信息（名称/楼栋/套数/开始日期/搭接方式）；右：22 道工序模板逐条可调表格
// （勾选/工期可改/开始日期可锚定覆盖，实时级联排程预览）；底部「创建并排程」→ 写入 SCHEDULE 回施工进度页。
(function () {
  const { Button, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };

  const LAPS = [
    { key: "half", label: "流水搭接（后道错开半个工期）" },
    { key: "seq", label: "顺序衔接（前道完成后道进场）" },
    { key: "same", label: "同时开工（全部同日进场）" },
  ];

  function ScheduleGroupNewScreen({ navigate, params }) {
    const [, force] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => {
      if (!window.SCHEDULE) {
        const t = setInterval(() => { if (window.SCHEDULE) { clearInterval(t); force(); } }, 50);
        return () => clearInterval(t);
      }
    }, []);
    const S = window.SCHEDULE;
    const proj = (params && params.project) || "合和新城";

    const [name, setName] = React.useState("");
    const [blds, setBlds] = React.useState("");
    const [units, setUnits] = React.useState("");
    const [start, setStart] = React.useState("2026-07-13");
    const [lap, setLap] = React.useState("half");
    const [rows, setRows] = React.useState(null);

    if (!S) return <Panel padding={18}><div style={{ fontSize: 12, color: "var(--ink-soft)" }}>加载排程数据…</div></Panel>;
    if (!rows) { setRows(S.TEMPLATE.map(() => ({ sel: true, dur: null, anchor: "" }))); return null; }

    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    const DAY = 86400000;

    // 级联排程预览：cur 游标按搭接方式推进；anchor（手改开始日）优先并重设游标
    const plan = [];
    {
      let cur = S.D(start).getTime();
      S.TEMPLATE.forEach((tpl, i) => {
        const r = rows[i];
        if (!r.sel) { plan.push(null); return; }
        const dur = Math.max(1, Number(r.dur != null ? r.dur : tpl.dur) || tpl.dur);
        const psT = r.anchor ? S.D(r.anchor).getTime() : cur;
        const pfT = psT + (dur - 1) * DAY;
        plan.push({ ps: iso(psT), pf: iso(pfT), dur });
        cur = lap === "seq" ? pfT + DAY : lap === "same" ? S.D(start).getTime() : psT + Math.max(1, Math.round(dur * 0.5)) * DAY;
      });
    }
    const nSel = rows.filter((r) => r.sel).length;
    const lastPf = plan.reduce((m, p) => (p && (!m || S.days(m, p.pf) > 0) ? p.pf : m), null);
    const totalDays = lastPf ? S.days(start, lastPf) + 1 : 0;

    const upd = (i, patch) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    const allOn = nSel === S.TEMPLATE.length;

    const create = () => {
      if (!name.trim()) { UI().toast("请填写分组名称", "danger"); return; }
      if (!nSel) { UI().toast("请至少勾选一道工序", "danger"); return; }
      const tasks = [];
      S.TEMPLATE.forEach((tpl, i) => {
        if (!plan[i]) return;
        tasks.push({ id: "t" + i + "-" + Date.now(), ...tpl, dur: plan[i].dur, ps: plan[i].ps, pf: plan[i].pf, actual: 0, hasQty: tpl.item != null });
      });
      UI().confirm({
        title: "创建并排程",
        message: "将在「" + proj + "」下创建分组「" + name.trim() + "」：" + nSel + " 道工序，" + start.replace(/-/g, ".") + " 进场，总工期约 " + totalDays + " 天。创建后首页/施工进度实时联动。",
        confirmText: "创建分组",
        onConfirm: () => {
          S.state[proj].groups.push({ id: "g" + Date.now(), name: name.trim(), buildings: blds.split(/[、,，\s]+/).filter(Boolean), units: Number(units) || null, collapsed: false, tasks });
          S.notify();
          UI().toast("已创建分组「" + name.trim() + "」（" + nSel + " 道工序）", "ok");
          navigate("schedule", { project: proj });
        },
      });
    };

    const inp = { border: "1px solid var(--line-strong)", borderRadius: 8, padding: "8px 11px", fontSize: 13, background: "#fff", width: "100%", boxSizing: "border-box" };
    const TH = { padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)", position: "sticky", top: 0 };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 头部 */}
        <Panel padding={14} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <Button icon="arrow-left" onClick={() => navigate("schedule", { project: proj })}>返回施工进度</Button>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>新建楼栋分组 · {proj}</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>22 道精装修工序标准库逐条可调 · 排程实时预览 · 创建后仍可在施工进度页改期</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, fontSize: 13, color: "var(--ink-soft)" }}>
            <span>已选 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{nSel}</b> / {S.TEMPLATE.length} 道</span>
            <span>总工期约 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{totalDays}</b> 天</span>
            {lastPf && <span>预计完成 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{lastPf.replace(/-/g, ".")}</b></span>}
            <Button variant="primary" icon="calendar-plus" onClick={create}>创建并排程</Button>
          </div>
        </Panel>

        <div style={{ display: "grid", gridTemplateColumns: "26fr 74fr", gap: 16, alignItems: "start" }}>
          {/* 左：分组信息 */}
          <Panel padding={16} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 4, height: 15, borderRadius: 2, background: "var(--brand)" }} />分组信息
            </div>
            <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>分组名称
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：户内31栋-36栋" style={{ ...inp, marginTop: 5 }} /></label>
            <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>包含楼栋（顿号/逗号分隔）
              <input value={blds} onChange={(e) => setBlds(e.target.value)} placeholder="如：31栋、33栋、36栋" style={{ ...inp, marginTop: 5 }} /></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>套数（户）
                <input value={units} onChange={(e) => setUnits(e.target.value)} placeholder="如 96" style={{ ...inp, marginTop: 5, fontFamily: "var(--font-mono)" }} /></label>
              <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>进场日期
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ ...inp, marginTop: 5, fontFamily: "var(--font-mono)" }} /></label>
            </div>
            <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>搭接方式
              <select value={lap} onChange={(e) => setLap(e.target.value)} style={{ ...inp, marginTop: 5, cursor: "pointer" }}>
                {LAPS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select></label>
            <div style={{ padding: "10px 12px", background: "var(--surface-2)", borderRadius: 8, fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.7 }}>
              右侧表格逐条可调：改<b>工期</b>或<b>开始日期</b>（锚定）后，后续工序按搭接方式自动级联；映射了分项的工序（<Icon name="link" size={10} color="var(--brand)" />）进度将由工程量完成率驱动。
            </div>
          </Panel>

          {/* 右：工序明细表（逐条可调） */}
          <Panel padding={0} style={{ overflow: "hidden" }}>
            <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800 }}>工序明细 · 排程预览</span>
              <button onClick={() => setRows((rs) => rs.map((r) => ({ ...r, sel: !allOn })))} style={{ marginLeft: "auto", border: 0, background: "transparent", color: "var(--brand)", fontSize: 12.5, cursor: "pointer", fontWeight: 700 }}>{allOn ? "全不选" : "全选"}</button>
            </div>
            <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 330px)", overflowY: "auto" }}>
              <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["", "序", "工序", "映射分项", "工期(天)", "计划开始", "计划完成"].map((h, i) => <th key={i} style={{ ...TH, width: i === 0 ? 36 : i === 1 ? 40 : undefined, textAlign: i >= 4 ? "right" : "left" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {S.TEMPLATE.map((tpl, i) => {
                    const r = rows[i];
                    const p = plan[i];
                    return (
                      <tr key={i} style={{ borderTop: "1px solid var(--line)", opacity: r.sel ? 1 : 0.45, background: r.anchor ? "var(--warn-soft)" : "transparent" }}>
                        <td style={{ padding: "7px 12px", textAlign: "center" }}><input type="checkbox" checked={r.sel} onChange={() => upd(i, { sel: !r.sel })} style={{ cursor: "pointer" }} /></td>
                        <td style={{ padding: "7px 12px", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}>{i + 1}</td>
                        <td style={{ padding: "7px 12px", fontSize: 13 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: tpl.color, flex: "none" }} />
                            <span style={{ fontWeight: 600 }}>{tpl.name}</span>
                            {tpl.item != null && <Icon name="link" size={11} color="var(--brand)" title="进度由工程量驱动" />}
                          </span>
                        </td>
                        <td style={{ padding: "7px 12px", fontSize: 12, color: "var(--ink-soft)" }}>{tpl.item || <span style={{ color: "var(--ink-faint)" }}>手动填报</span>}</td>
                        <td style={{ padding: "7px 12px", textAlign: "right" }}>
                          <input value={r.dur != null ? r.dur : tpl.dur} disabled={!r.sel} onChange={(e) => upd(i, { dur: e.target.value.replace(/[^\d]/g, "") })}
                            style={{ width: 52, textAlign: "right", border: "1px solid var(--line-strong)", borderRadius: 6, padding: "4px 7px", fontSize: 12.5, fontFamily: "var(--font-mono)", background: r.sel ? "#fff" : "var(--surface-2)" }} />
                        </td>
                        <td style={{ padding: "7px 12px", textAlign: "right" }}>
                          <input type="date" value={r.anchor || (p ? p.ps : "")} disabled={!r.sel} onChange={(e) => upd(i, { anchor: e.target.value })}
                            title={r.anchor ? "已手动锚定（后续工序自此级联）" : "自动级联，可改为手动锚定"}
                            style={{ border: "1px solid " + (r.anchor ? "var(--warn)" : "var(--line-strong)"), borderRadius: 6, padding: "4px 7px", fontSize: 12, fontFamily: "var(--font-mono)", background: r.sel ? (r.anchor ? "var(--warn-soft)" : "#fff") : "var(--surface-2)" }} />
                        </td>
                        <td style={{ padding: "7px 12px", textAlign: "right", fontSize: 12.5, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{p ? p.pf.replace(/-/g, ".") : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)", background: "var(--surface-2)", display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "var(--ink-soft)", flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 8, background: "var(--warn-soft)", border: "1px solid var(--warn)", borderRadius: 2, display: "inline-block" }} />手动锚定的开始日</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="link" size={11} color="var(--brand)" />进度由工程量完成率驱动</span>
              <span style={{ marginLeft: "auto" }}>搭接方式：{LAPS.find((o) => o.key === lap).label}</span>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  window.ScheduleGroupNewScreen = ScheduleGroupNewScreen;
})();
