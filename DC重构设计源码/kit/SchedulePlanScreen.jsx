// SchedulePlanScreen — 施工进度排程工作台（#28）
// 左 WBS 树表（项目/楼栋分组/工序 三层）+ 右甘特（行严格对齐、FS 依赖线、today 线贯穿）。
// 数据源 window.SCHEDULE（kit/ScheduleData.jsx）：本页所有编辑经 SCHEDULE.update/notify 实时反映到首页缩略甘特。
// 蓝本：docs/rewrite/pages/schedule-progress.md §七 7.2。
(function () {
  const { Button, Panel, StatusChip, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {} };

  const FALLBACK_PROJECTS = ["合和新城", "锦绣华庭", "翠湖花园"];
  const ROWH = 34;                    // 每行行高：左表与甘特共用，保证行对齐
  const COLS = { name: 216, dur: 42, plan: 96, act: 46, dev: 80 };
  const LEFTW = COLS.name + COLS.dur + COLS.plan + COLS.act + COLS.dev;
  const fmtS = s => s.slice(5).replace("-", ".");      // 06.13
  const fmtF = s => s.replace(/-/g, ".");

  const projectNames = (S) => {
    const scheduleNames = S && S.state ? Object.keys(S.state) : [];
    return scheduleNames.length ? scheduleNames : FALLBACK_PROJECTS;
  };

  // ── 单元格 ──
  const Cell = ({ w, children, align, pad, bold, mono, color }) => (
    <div style={{ width: w, flex: "none", padding: pad || "0 8px", display: "flex", alignItems: "center",
      justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
      fontSize: 12, fontWeight: bold ? 800 : 500, fontFamily: mono ? "var(--font-mono)" : "inherit",
      color: color || "var(--ink)", borderRight: "1px solid var(--line)", minWidth: 0, overflow: "hidden",
      whiteSpace: "nowrap", textOverflow: "ellipsis", height: "100%" }}>{children}</div>
  );

  // ── 依赖模型（#244 回填生产形态；规格见 docs/rewrite/pages/schedule-progress.md）──
  // 显式关系存在工序上：t.dep = { predId, lag, disabled?, disabledReason?, disabledAt? }
  // 首期固定 FS（完成→开始），一道后续工序只编辑一条前置依赖。
  const addDays = (S, s, n) => new Date(S.D(s).getTime() + n * 86400000).toISOString().slice(0, 10);
  const taskById = (g, id) => g.tasks.find(x => x.id === id) || null;

  /** 候选前置：同一楼栋分组、计划开始早于当前工序、非自身、且不形成环。 */
  const predCandidates = (S, g, t) => g.tasks.filter((x) => {
    if (x.id === t.id || S.days(x.ps, t.ps) <= 0) return false;
    // 环检测：沿 x 的前置链上溯，若回到 t 则成环
    let cur = x, hops = 0;
    while (cur && cur.dep && cur.dep.predId && hops++ < 64) {
      if (cur.dep.predId === t.id) return false;
      cur = taskById(g, cur.dep.predId);
    }
    return true;
  });

  /** 最早允许开始 = 前置计划完成 + lag + 1 天（FS）。 */
  const earliestStart = (S, g, dep) => {
    const pred = dep && dep.predId ? taskById(g, dep.predId) : null;
    return pred ? addDays(S, pred.pf, (Number(dep.lag) || 0) + 1) : null;
  };

  /** 自然语言摘要：优先人话，FS·lag 只作次级技术标识。 */
  const depPhrase = (g, dep, selfName) => {
    const pred = dep && dep.predId ? taskById(g, dep.predId) : null;
    if (!pred) return null;
    const lag = Number(dep.lag) || 0;
    if (lag === 0) return pred.name + "完成后立即开始";
    if (lag > 0) return pred.name + "完成后等待 " + lag + " 天，" + selfName + "才可开始";
    return pred.name + "完成前 " + (-lag) + " 天即可开始";
  };

  // ── 依赖设置视图（brief §6–§10）：与工序详情共用同一个模态外壳，不叠第二层 Dialog ──
  function DependencyView({ S, g, t, cands, onBack, onClose }) {
    const dep0 = t.dep || null;
    const [predId, setPredId] = React.useState(dep0 ? dep0.predId : (cands[0] ? cands[0].id : ""));
    const [lagText, setLagText] = React.useState(String(dep0 ? (Number(dep0.lag) || 0) : 0));
    const [saving, setSaving] = React.useState(false);
    const dirty = !dep0
      ? !!predId
      : (predId !== dep0.predId || String(Number(dep0.lag) || 0) !== lagText.trim());

    const lagNum = Number(lagText);
    const lagValid = lagText.trim() !== "" && Number.isInteger(lagNum) && lagNum >= -365 && lagNum <= 365;
    const pred = predId ? taskById(g, predId) : null;
    const errors = [];
    if (!predId) errors.push({ field: "pred", msg: "请选择前置工序" });
    if (predId && predId === t.id) errors.push({ field: "pred", msg: "前置工序不能是当前工序" });
    if (!lagValid) errors.push({ field: "lag", msg: "间隔天数须为 -365…365 的整数" });
    const errOf = f => (errors.find(e => e.field === f) || {}).msg;

    const draft = { predId, lag: lagValid ? lagNum : 0 };
    const earliest = pred && lagValid ? earliestStart(S, g, draft) : null;
    const gapDays = earliest ? S.days(earliest, t.ps) : null;   // <0 = 当前计划早于允许日期
    const conflict = gapDays != null && gapDays < 0;
    const phrase = pred && lagValid ? depPhrase(g, draft, t.name) : null;

    const leave = (fn) => {
      if (!dirty) { fn(); return; }
      UI().confirm({
        variant: "simple", title: "放弃修改？", message: "依赖设置尚未保存，关闭后本次改动将丢失。",
        confirmLabel: "放弃修改", onConfirm: fn,
      });
    };
    const commit = () => {
      if (errors.length) return;
      setSaving(true);
      t.dep = { predId, lag: lagNum };   // 主动保存即视为有效关系，不进「已禁用」区
      S.notify();
      UI().toast(conflict
        ? "已保存依赖；当前计划早于允许日期 " + (-gapDays) + " 天，请继续调整工序日期（本期不自动顺延）"
        : "已保存依赖关系", conflict ? "warn" : "ok");
      setSaving(false);
      onBack();
    };
    const remove = () => UI().confirm({
      variant: "simple", title: "移除前置依赖？",
      message: "移除后甘特上该连线一并消失，工序日期不变。",
      confirmLabel: "移除依赖",
      onConfirm: () => { delete t.dep; S.notify(); UI().toast("已移除前置依赖", "ok"); onBack(); },
    });
    const restore = () => {
      const e = earliestStart(S, g, t.dep);
      if (e && S.days(e, t.ps) < 0) { UI().toast("当前计划仍早于允许日期，先调整工序日期再恢复", "warn"); return; }
      delete t.dep.disabled; delete t.dep.disabledReason; delete t.dep.disabledAt;
      S.notify(); UI().toast("已恢复依赖关系", "ok");
    };

    const inp = { border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", padding: "7px 10px", fontSize: 13, background: "#fff", width: "100%" };
    const lab = { fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 };
    const errStyle = { fontSize: 11, color: "var(--danger-ink)", marginTop: 4 };
    const mono = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

    return (
      <React.Fragment>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <button type="button" onClick={() => leave(onBack)} title="返回工序详情"
            style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0, marginTop: 2, color: "var(--ink-soft)" }}>
            <Icon name="arrow-left" size={15} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>依赖设置 · {t.name}</div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>{g.name} · 当前仅支持完成后开始（FS）</div>
          </div>
          <button onClick={() => leave(onClose)} style={{ marginLeft: "auto", border: 0, background: "transparent", cursor: "pointer", fontSize: 20, color: "var(--ink-soft)" }}>×</button>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={lab}>前置工序
            <select value={predId} disabled={!cands.length} onChange={e => setPredId(e.target.value)}
              style={{ ...inp, marginTop: 4, cursor: cands.length ? "pointer" : "not-allowed",
                borderColor: errOf("pred") ? "var(--danger)" : "var(--line-strong)" }}>
              <option value="">（未选择）</option>
              {cands.map(x => <option key={x.id} value={x.id}>{x.name}（计划 {fmtS(x.ps)}~{fmtS(x.pf)}）</option>)}
            </select>
            {!cands.length ? <div style={{ ...errStyle, color: "var(--ink-soft)" }}>当前没有可作为前置的工序（同分组内无计划开始更早者）</div> : null}
            {errOf("pred") ? <div style={errStyle}>{errOf("pred")}</div> : null}
          </label>

          {/* 关系类型只读 + 间隔天数；390px 下自动降为单列 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <div style={lab}>关系类型
              <div style={{ ...inp, marginTop: 4, background: "var(--surface-2)", color: "var(--ink)" }}>完成 → 开始（FS）</div>
            </div>
            <label style={lab}>间隔天数
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <input type="number" step={1} min={-365} max={365} value={lagText} onChange={e => setLagText(e.target.value)}
                  style={{ ...inp, ...mono, textAlign: "right", borderColor: errOf("lag") ? "var(--danger)" : "var(--line-strong)" }} />
                <span style={{ fontSize: 13, flex: "none" }}>天</span>
              </div>
              {errOf("lag") ? <div style={errStyle}>{errOf("lag")}</div> : null}
            </label>
          </div>

          {/* 即时预览：自然语言 + 日期，不等保存 */}
          {phrase ? <div style={{ fontSize: 12, color: "var(--ink)", lineHeight: 1.6 }}>{phrase}。</div> : null}

          {earliest ? (
            <div style={{ border: "1px solid " + (conflict ? "var(--warn)" : "var(--line)"),
              background: conflict ? "var(--warn-soft)" : "var(--surface-2)",
              borderRadius: "var(--radius-btn)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", fontSize: 12 }}>
                <span style={{ flex: 1, color: "var(--ink-soft)" }}>前置计划完成</span>
                <span style={mono}>{fmtF(pred.pf)}</span>
              </div>
              <div style={{ display: "flex", fontSize: 12 }}>
                <span style={{ flex: 1, color: "var(--ink-soft)" }}>间隔天数</span>
                <span style={mono}>{lagNum > 0 ? "+" : ""}{lagNum} 天</span>
              </div>
              <div style={{ display: "flex", fontSize: 12 }}>
                <span style={{ flex: 1, color: "var(--ink-soft)" }}>最早允许开始</span>
                <span style={{ ...mono, fontWeight: 700 }}>{fmtF(earliest)}</span>
              </div>
              <div style={{ display: "flex", fontSize: 12 }}>
                <span style={{ flex: 1, color: "var(--ink-soft)" }}>当前计划开始</span>
                <span style={{ ...mono, fontWeight: 700, color: conflict ? "var(--warn-ink)" : "var(--ink)" }}>{fmtF(t.ps)}</span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, fontWeight: 600,
                color: conflict ? "var(--warn-ink)" : "var(--ok-ink)", marginTop: 2 }}>
                <Icon name={conflict ? "triangle-alert" : "circle-check-big"} size={13} style={{ flex: "none", marginTop: 1 }} />
                <span>{conflict
                  ? "当前计划早于允许日期 " + (-gapDays) + " 天；保存依赖不会自动修改工序日期。"
                  : "当前计划满足依赖关系。"}</span>
              </div>
            </div>
          ) : null}

          {/* 已禁用的冲突关系：只收甘特调期确认产生的禁用，带原因与审计信息 */}
          {dep0 && dep0.disabled ? (
            <div style={{ border: "1px dashed var(--line-strong)", background: "var(--surface-3)", borderRadius: "var(--radius-btn)", padding: "10px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>该关系已被置灰保留</div>
              <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4, lineHeight: 1.6 }}>
                原因：{dep0.disabledReason || "调期后开工早于依赖允许日期"}
                {dep0.disabledAt ? <span> · 禁用于 <span style={mono}>{fmtF(dep0.disabledAt)}</span></span> : null}
                <br />甘特上以灰色虚线保留，不物理删除，便于审计与恢复。
              </div>
              <button type="button" onClick={restore}
                style={{ marginTop: 8, border: "1px solid var(--line-strong)", background: "var(--panel)", borderRadius: "var(--radius-sm)",
                  padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>恢复关系</button>
            </div>
          ) : null}
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {dep0 && dep0.predId ? (
            <button onClick={remove} style={{ border: "1px solid var(--danger)", color: "var(--danger)", background: "#fff",
              borderRadius: "var(--radius-btn)", padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>移除依赖</button>
          ) : null}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={() => leave(onBack)} style={{ border: "1px solid var(--line)", background: "var(--surface-2)",
              borderRadius: "var(--radius-btn)", padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
            <button onClick={commit} disabled={!!errors.length || saving}
              style={{ border: 0, background: errors.length || saving ? "var(--line-strong)" : "var(--brand)", color: "#fff",
                borderRadius: "var(--radius-btn)", padding: "8px 18px", fontSize: 13, fontWeight: 700,
                cursor: errors.length || saving ? "not-allowed" : "pointer" }}>{saving ? "保存中…" : "保存"}</button>
          </div>
        </div>
      </React.Fragment>
    );
  }

  // ── 工序弹窗：单层模态、两视图（详情 ⇄ 依赖设置）──
  // brief §4：不叠两层 Dialog —— 视觉上内容替换，同一时间只存在一个模态层。
  function TaskModal({ proj, g, t, S, navigate, onClose }) {
    const [view, setView] = React.useState("detail");   // detail | dep
    const [ps, setPs] = React.useState(t.ps);
    const [pf, setPf] = React.useState(t.pf);
    const [act, setAct] = React.useState(Math.round(t.actual * 100));
    const save = () => {
      if (S.days(ps, pf) < 0) { UI().toast("计划完成不能早于计划开始", "warn"); return; }
      S.update(proj, g.id, t.id, { ps, pf, actual: Math.max(0, Math.min(100, +act || 0)) / 100 });
      // 调期后依赖冲突：以本工序为前置的后续工序若开工早于新的最早允许日 → 冲突软禁用（保留关系、灰虚线）
      const affected = g.tasks.filter(x => x.dep && x.dep.predId === t.id && !x.dep.disabled
        && S.days(addDays(S, pf, (Number(x.dep.lag) || 0) + 1), x.ps) < 0);
      if (affected.length) {
        affected.forEach((x) => {
          x.dep.disabled = true;
          x.dep.disabledReason = "调期后开工早于依赖允许日期";
          x.dep.disabledAt = (S.state[proj] || {}).today || "";
        });
        S.notify();
        UI().toast("「" + affected[0].name + "」等 " + affected.length + " 道后续工序开工早于新允许日期，关系已置灰保留，可在依赖设置里恢复", "warn");
      }
      else UI().toast("已保存，首页甘特已同步", "ok");
      onClose();
    };
    const del = () => {
      const i = g.tasks.findIndex(x => x.id === t.id);
      if (i >= 0) { g.tasks.splice(i, 1); S.notify(); }
      UI().toast("已删除工序「" + t.name + "」", "ok"); onClose();
    };
    const inp = { border: "1px solid var(--line-strong)", borderRadius: 6, padding: "7px 10px", fontSize: 13, background: "#fff", width: "100%" };
    const dep = t.dep || null;
    const phrase = depPhrase(g, dep, t.name);
    const cands = predCandidates(S, g, t);
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 24 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: "var(--panel)", borderRadius: "var(--radius-card)", width: 440, maxWidth: "calc(100dvw - 24px)", boxShadow: "var(--shadow-pop)", overflow: "hidden" }}>
          {view === "dep" ? (
            <DependencyView S={S} g={g} t={t} cands={cands} onBack={() => setView("detail")} onClose={onClose} />
          ) : (
          <React.Fragment>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: t.color, flex: "none" }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>{g.name} · {t.trade} · 参考工期 {t.dur} 天</div>
            </div>
            <button onClick={onClose} style={{ marginLeft: "auto", border: 0, background: "transparent", cursor: "pointer", fontSize: 20, color: "var(--ink-soft)" }}>×</button>
          </div>
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>计划开始
                <input type="date" value={ps} onChange={e => setPs(e.target.value)} style={{ ...inp, marginTop: 4 }} /></label>
              <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>计划完成
                <input type="date" value={pf} onChange={e => setPf(e.target.value)} style={{ ...inp, marginTop: 4 }} /></label>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>当前区间 {S.days(ps, pf) + 1} 天（模板参考 {t.dur} 天）· 保存后首页/项目详情实时联动</div>

            {/* 依赖摘要行（brief §5）：紧凑一行，不比实际进度区抢眼；完整表单在独立视图 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-2)", border: "1px solid var(--line)",
              borderRadius: "var(--radius-btn)", padding: "8px 10px", minWidth: 0 }}>
              <Icon name="corner-left-up" size={13} style={{ color: "var(--ink-soft)", flex: "none" }} />
              <span title={phrase || undefined} style={{ flex: 1, minWidth: 0, fontSize: 12, color: phrase ? "var(--ink)" : "var(--ink-soft)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {phrase || (cands.length ? "尚未设置前置工序" : "当前没有可作为前置的工序")}
              </span>
              {dep && dep.predId ? (
                <span style={{ flex: "none", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700,
                  color: dep.disabled ? "var(--ink-faint)" : "var(--ink-soft)" }}>
                  FS · {(Number(dep.lag) || 0) > 0 ? "+" : ""}{Number(dep.lag) || 0}天{dep.disabled ? " · 已禁用" : ""}
                </span>
              ) : null}
              <button type="button" disabled={!cands.length && !(dep && dep.predId)}
                title={!cands.length && !(dep && dep.predId) ? "同一楼栋分组内没有计划开始更早的工序，无法设置前置" : undefined}
                onClick={() => setView("dep")}
                style={{ flex: "none", border: "1px solid var(--line-strong)", background: "var(--panel)", borderRadius: "var(--radius-sm)",
                  padding: "4px 9px", fontSize: 12, fontWeight: 600,
                  color: (!cands.length && !(dep && dep.predId)) ? "var(--ink-faint)" : "var(--ink)",
                  cursor: (!cands.length && !(dep && dep.predId)) ? "not-allowed" : "pointer" }}>
                {dep && dep.predId ? "修改 ›" : "设置依赖 ›"}
              </button>
            </div>

            {t.hasQty ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--brand-soft)", border: "1px solid rgba(57,118,198,0.18)", borderRadius: 8, padding: "10px 12px" }}>
                <Icon name="link" size={14} color="var(--brand)" />
                <span style={{ fontSize: 12, color: "var(--ink)" }}>实际进度 <b style={{ fontFamily: "var(--font-mono)" }}>{Math.round(t.actual * 100)}%</b> 由工程量矩阵「{t.item}」自动汇总，不在此填报</span>
                <Button size="sm" variant="secondary" onClick={() => { onClose(); navigate("quantity", { group: g.name, trade: t.trade, item: t.item, task: t.name, ps: t.ps, pf: t.pf, from: "schedule" }); }}>下钻</Button>
              </div>
            ) : (
              <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>实际进度（手动填报）
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
                  <input type="range" min={0} max={100} value={act} onChange={e => setAct(+e.target.value)} style={{ flex: 1 }} />
                  <input type="number" min={0} max={100} value={act} onChange={e => setAct(e.target.value)} style={{ ...inp, width: 72, textAlign: "right" }} />
                  <span style={{ fontSize: 13 }}>%</span>
                </div></label>
            )}
          </div>
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
            <button onClick={del} style={{ border: "1px solid var(--danger)", color: "var(--danger)", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>删除工序</button>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button onClick={onClose} style={{ border: "1px solid var(--line)", background: "var(--surface-2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
              <button onClick={save} style={{ border: 0, background: "var(--brand)", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>保存</button>
            </div>
          </div>
          </React.Fragment>
          )}
        </div>
      </div>
    );
  }

  // ── 向分组追加工序（从 22 道模板选）──
  function AddTaskModal({ proj, g, S, onClose }) {
    const [ti, setTi] = React.useState(0);
    const last = g.tasks[g.tasks.length - 1];
    const defPs = last ? new Date(S.D(last.pf).getTime() + 86400000).toISOString().slice(0, 10) : "2026-07-01";
    const [ps, setPs] = React.useState(defPs);
    const tpl = S.TEMPLATE[ti];
    const pf = new Date(S.D(ps).getTime() + (tpl.dur - 1) * 86400000).toISOString().slice(0, 10);
    const add = () => {
      g.tasks.push({ id: "t" + Date.now(), ...tpl, ps, pf, actual: 0, hasQty: tpl.item != null });
      S.notify(); UI().toast("已添加「" + tpl.name + "」", "ok"); onClose();
    };
    const inp = { border: "1px solid var(--line-strong)", borderRadius: 6, padding: "7px 10px", fontSize: 13, background: "#fff", width: "100%" };
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 24 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: "var(--panel)", borderRadius: 12, width: 420, boxShadow: "var(--shadow-pop)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", fontSize: 15, fontWeight: 800 }}>{g.name} · 添加工序</div>
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>工序模板
              <select value={ti} onChange={e => setTi(+e.target.value)} style={{ ...inp, marginTop: 4, cursor: "pointer" }}>
                {S.TEMPLATE.map((t, i) => <option key={i} value={i}>{t.name}（{t.trade} · {t.dur}天{t.item ? " · 联动" + t.item : ""}）</option>)}
              </select></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>计划开始
                <input type="date" value={ps} onChange={e => setPs(e.target.value)} style={{ ...inp, marginTop: 4 }} /></label>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>计划完成（按模板工期）
                <div style={{ ...inp, marginTop: 4, background: "var(--surface-2)", fontFamily: "var(--font-mono)" }}>{pf}</div></div>
            </div>
          </div>
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={onClose} style={{ border: "1px solid var(--line)", background: "var(--surface-2)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
            <button onClick={add} style={{ border: 0, background: "var(--brand)", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>添加</button>
          </div>
        </div>
      </div>
    );
  }


  // ── 主组件 ──
  function SchedulePlanScreen({ data, navigate, params }) {
    const [, force] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
      if (!window.SCHEDULE) {
        const t = setInterval(() => { if (window.SCHEDULE) { clearInterval(t); force(); } }, 50);
        return () => clearInterval(t);
      }
      return window.SCHEDULE.subscribe(force);
    }, []);
    const S = window.SCHEDULE;
    const options = projectNames(S);
    const [proj, setProj] = React.useState(() => {
      const requestedById = params && params.projectId && S && S.byProjectId ? S.byProjectId[params.projectId] : null;
      const requested = requestedById ? requestedById.projectName : params && params.project;
      if (requested && options.indexOf(requested) >= 0) return requested;
      return options.find((name) => S && S.state && S.state[name]) || options[0] || FALLBACK_PROJECTS[0];
    });
    const [modal, setModal] = React.useState(null);   // {kind:"task"|"addTask"|"addGroup", g, t}
    if (!S) return <Panel padding={18}><div style={{ fontSize: 12, color: "var(--ink-soft)" }}>加载排程数据…</div></Panel>;

    const p = S.state[proj];
    if (!p) return (
      <Panel padding={22}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 9, background: "var(--surface-2)" }}><Icon name="calendar-x" size={18} color="var(--ink-soft)" /></span>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>当前项目暂无施工排程</div>
            <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-soft)" }}>先建立楼栋分组，再维护工序计划。</div>
          </div>
          <Button variant="primary" icon="plus" onClick={() => navigate("scheduleGroupNew", { project: proj })}>新建排程</Button>
        </div>
      </Panel>
    );

    // #244 回填：首次进入把隐式 FS 关系固化为显式依赖（对齐生产 task_dependencies 的 FS + lag），
    // 并把楼栋分组默认收敛为「只展开第一个」，与实现侧 ScheduleTimeline 的默认一致。
    if (!p._depNormalized) {
      p.groups.forEach((g, gi) => {
        g.collapsed = gi > 0;
        g.tasks.forEach((t) => {
          if (t.dep) return;
          let pred = null;
          g.tasks.forEach((x) => {
            if (x.id === t.id || S.days(x.ps, t.ps) <= 0) return;
            if (!pred || S.days(pred.pf, x.pf) > 0) pred = x;
          });
          // lag = 计划开始 − 前置完成 − 1（FS：最早允许开始 = 前置完成 + lag + 1）
          if (pred) t.dep = { predId: pred.id, lag: Math.max(0, S.days(pred.pf, t.ps) - 1) };
        });
      });
      p._depNormalized = true;
    }

    // 时间轴（同首页：开工月首 → 完工月末）
    const axisStart = p.start.slice(0, 8) + "01";
    const endD = S.D(p.plannedEnd); const axisEnd = new Date(endD.getFullYear(), endD.getMonth() + 1, 0);
    const total = Math.max((axisEnd - S.D(axisStart)) / 86400000, 1);
    const X = d => Math.max(0, Math.min(100, S.days(axisStart, d) / total * 100));
    const todayX = X(p.today);
    const months = [];
    for (let d = S.D(axisStart); d <= axisEnd; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      months.push({ label: (d.getMonth() === 0 ? (d.getFullYear() % 100) + "年" : "") + (d.getMonth() + 1) + "月", x: X(d.toISOString().slice(0, 10)) });
    }
    const allTasks = p.groups.flatMap(g => g.tasks);
    const overall = S.rollup(allTasks, p.today);

    // 行扁平化（保证左表与甘特一一对应）
    const rows = [{ kind: "project" }];
    p.groups.forEach(g => {
      rows.push({ kind: "group", g });
      if (!g.collapsed) g.tasks.forEach(t => rows.push({ kind: "task", g, t }));
    });
    const H = rows.length * ROWH;

    // FS 依赖连线：读显式 t.dep（预先归一化），禁用关系以灰色虚线保留、不物理删除
    const rowIndex = {};
    rows.forEach((r, ri) => { if (r.kind === "task") rowIndex[r.g.id + "/" + r.t.id] = ri; });
    const deps = [];
    rows.forEach((r, ri) => {
      if (r.kind !== "task" || !r.t.dep || !r.t.dep.predId) return;
      const pred = taskById(r.g, r.t.dep.predId);
      const pri = pred ? rowIndex[r.g.id + "/" + pred.id] : undefined;
      if (!pred || pri == null) return;   // 分组收起时前置行不在视图内，跳过
      deps.push({
        x1: X(pred.pf), y1: pri * ROWH + ROWH / 2,
        x2: X(r.t.ps), y2: ri * ROWH + ROWH / 2,
        disabled: !!r.t.dep.disabled,
      });
    });

    const devChip = t => {
      const st = S.status(t, p.today);
      if (st === "done") { const d = S.devDays(t, p.today); return <StatusChip tone={d >= 0 ? "ok" : "danger"}>{d > 0 ? `提前${d}天` : d < 0 ? `延后${-d}天` : "按期"}</StatusChip>; }
      if (st === "doing") { const d = S.devDays(t, p.today); return <StatusChip tone={d >= 0 ? "brand" : "warn"}>{d < 0 ? `慢${-d}天` : d > 0 ? `快${d}天` : "按期"}</StatusChip>; }
      if (st === "late-start") return <StatusChip tone="danger">应开未开</StatusChip>;
      return <StatusChip tone="neutral">待开始</StatusChip>;
    };

    const leftHead = (
      <div style={{ display: "flex", height: 26, alignItems: "stretch" }}>
        <Cell w={COLS.name} color="var(--ink-faint)" bold>WBS · 分组 / 工序</Cell>
        <Cell w={COLS.dur} align="center" color="var(--ink-faint)" bold>工期</Cell>
        <Cell w={COLS.plan} align="center" color="var(--ink-faint)" bold>计划起止</Cell>
        <Cell w={COLS.act} align="center" color="var(--ink-faint)" bold>实际</Cell>
        <Cell w={COLS.dev} align="center" color="var(--ink-faint)" bold>状态</Cell>
      </div>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 工具栏 */}
        <Panel padding={12} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 240 }}>
            <span style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 700, flex: "none" }}>项目</span>
            <select aria-label="选择项目" value={proj} onChange={(e) => setProj(e.target.value)} style={{ minWidth: 220, maxWidth: "100%", height: 34, padding: "0 30px 0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "#fff", color: "var(--ink)", fontSize: 13, fontWeight: 700 }}>
              {options.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <StatusChip tone={overall.dev > 0 ? "ok" : overall.dev < 0 ? "warn" : "brand"}>
            整体 {Math.round(overall.pct * 100)}%{overall.dev > 0 ? ` · 领先约${overall.dev}天` : overall.dev < 0 ? ` · 落后约${-overall.dev}天` : " · 按计划"}
          </StatusChip>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{fmtF(p.start)} → {fmtF(p.plannedEnd)}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button size="sm" icon="flag" onClick={() => UI().toast("已将当前计划保存为基线（V1 写入 schedule_baselines，偏差以基线对比）", "ok")}>设为基线</Button>
            <Button size="sm" icon="library" onClick={() => navigate("processLibrary")}>标准工序库</Button>
            <Button size="sm" variant="primary" icon="plus" onClick={() => navigate("scheduleGroupNew", { project: proj })}>新建楼栋分组</Button>
          </div>
        </Panel>

        {/* WBS + 甘特 */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 960 }}>
              {/* 表头：左列名 + 月刻度 */}
              <div style={{ display: "flex", background: "var(--surface-2)", borderBottom: "1px solid var(--line)" }}>
                <div style={{ width: LEFTW, flex: "none" }}>{leftHead}</div>
                <div style={{ flex: 1, position: "relative", height: 26 }}>
                  {months.map((m, i) => <div key={i} style={{ position: "absolute", left: m.x + "%", top: 0, bottom: 0, borderLeft: "1px dashed rgba(0,0,0,0.06)", paddingLeft: 4, fontSize: 10, fontWeight: 700, color: "var(--ink-soft)", display: "flex", alignItems: "center" }}>{m.label}</div>)}
                  <div style={{ position: "absolute", left: todayX + "%", top: 0, bottom: 0, width: 2, background: "var(--danger)" }} />
                  <div style={{ position: "absolute", left: todayX + "%", top: 2, transform: "translateX(-50%)", fontSize: 9, fontWeight: 800, color: "var(--danger)", background: "var(--danger-soft)", borderRadius: 3, padding: "0 4px" }}>今天</div>
                </div>
              </div>

              {/* 行区：背景网格 + 行 + 依赖线 overlay */}
              <div style={{ position: "relative" }}>
                {/* 背景：月网格 + today 线贯穿 */}
                <div style={{ position: "absolute", left: LEFTW, right: 0, top: 0, bottom: 0, zIndex: 0 }}>
                  {months.map((m, i) => <div key={i} style={{ position: "absolute", left: m.x + "%", top: 0, bottom: 0, borderLeft: "1px dashed rgba(0,0,0,0.05)" }} />)}
                  <div style={{ position: "absolute", left: todayX + "%", top: 0, bottom: 0, width: 2, background: "var(--danger)", opacity: 0.55 }} />
                </div>

                {rows.map((r, ri) => {
                  if (r.kind === "project") {
                    return (
                      <div key="prj" style={{ display: "flex", height: ROWH, borderBottom: "1px solid var(--line)", background: "var(--brand-soft)", position: "relative", zIndex: 1 }}>
                        <div style={{ width: LEFTW, flex: "none", display: "flex" }}>
                          <Cell w={COLS.name} bold><Icon name="building-2" size={13} style={{ marginRight: 6, color: "var(--brand)" }} />{proj} · 项目整体</Cell>
                          <Cell w={COLS.dur} align="center" mono color="var(--ink-soft)">{S.days(p.start, p.plannedEnd) + 1}d</Cell>
                          <Cell w={COLS.plan} align="center" mono color="var(--ink-soft)">{fmtS(p.start)}~{fmtS(p.plannedEnd)}</Cell>
                          <Cell w={COLS.act} align="center" mono bold>{Math.round(overall.pct * 100)}%</Cell>
                          <Cell w={COLS.dev} align="center"><span style={{ transform: "scale(0.9)" }}><StatusChip tone={overall.dev >= 0 ? "ok" : "warn"}>{overall.dev >= 0 ? "领先" : "落后"}{Math.abs(overall.dev)}天</StatusChip></span></Cell>
                        </div>
                        <div style={{ flex: 1, position: "relative" }}>
                          <div style={{ position: "absolute", left: X(p.start) + "%", width: Math.max(X(p.plannedEnd) - X(p.start), 2) + "%", top: 10, bottom: 10, background: "var(--surface-3)", border: "1px solid var(--line-strong)", borderRadius: 6, overflow: "hidden" }}>
                            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (overall.pct * 100) + "%", background: "var(--brand)", opacity: 0.8 }} />
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (r.kind === "group") {
                    const g = r.g, rr = S.rollup(g.tasks, p.today);
                    const gs = g.tasks.length ? g.tasks.reduce((m, t) => S.days(t.ps, m) > 0 ? t.ps : m, g.tasks[0].ps) : p.start;
                    const ge = g.tasks.length ? g.tasks.reduce((m, t) => S.days(m, t.pf) > 0 ? t.pf : m, g.tasks[0].pf) : p.plannedEnd;
                    return (
                      <div key={g.id} style={{ display: "flex", height: ROWH, borderBottom: "1px solid var(--line)", background: "rgba(245,246,248,0.9)", position: "relative", zIndex: 1 }}>
                        <div style={{ width: LEFTW, flex: "none", display: "flex", cursor: "pointer" }} onClick={() => { g.collapsed = !g.collapsed; S.notify(); }}>
                          <Cell w={COLS.name} bold pad="0 8px 0 18px">
                            <Icon name={g.collapsed ? "chevron-right" : "chevron-down"} size={13} style={{ marginRight: 4, flex: "none" }} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                            <span title="添加工序" onClick={e => { e.stopPropagation(); setModal({ kind: "addTask", g }); }}
                              style={{ marginLeft: 6, display: "inline-grid", placeItems: "center", width: 18, height: 18, borderRadius: 4, border: "1px solid var(--line-strong)", background: "#fff", cursor: "pointer", flex: "none" }}>
                              <Icon name="plus" size={11} /></span>
                          </Cell>
                          <Cell w={COLS.dur} align="center" mono color="var(--ink-soft)">{g.tasks.length}道</Cell>
                          <Cell w={COLS.plan} align="center" mono color="var(--ink-soft)">{g.tasks.length ? fmtS(gs) + "~" + fmtS(ge) : "—"}</Cell>
                          <Cell w={COLS.act} align="center" mono bold>{Math.round(rr.pct * 100)}%</Cell>
                          <Cell w={COLS.dev} align="center"><span style={{ transform: "scale(0.9)" }}><StatusChip tone={rr.dev >= 0 ? "ok" : "warn"}>{rr.dev >= 0 ? "领先" : "落后"}</StatusChip></span></Cell>
                        </div>
                        <div style={{ flex: 1, position: "relative" }}>
                          {g.tasks.length > 0 && (
                            <div style={{ position: "absolute", left: X(gs) + "%", width: Math.max(X(ge) - X(gs), 2) + "%", top: 10, bottom: 10, background: "var(--surface-3)", border: "1px solid var(--line-strong)", borderRadius: 6, overflow: "hidden" }}>
                              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (rr.pct * 100) + "%", background: "var(--brand)", opacity: 0.75 }} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }
                  const { g, t } = r;
                  const st = S.status(t, p.today);
                  return (
                    <div key={g.id + t.id} onClick={() => setModal({ kind: "task", g, t })}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--brand-soft)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      style={{ display: "flex", height: ROWH, borderBottom: "1px solid var(--line)", cursor: "pointer", position: "relative", zIndex: 1 }}>
                      <div style={{ width: LEFTW, flex: "none", display: "flex" }}>
                        <Cell w={COLS.name} pad="0 8px 0 38px">
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flex: "none", marginRight: 6 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", fontWeight: 600 }}>{t.name}</span>
                          {t.hasQty && <Icon name="link" size={11} style={{ color: "var(--brand)", flex: "none", marginLeft: 4 }} />}
                        </Cell>
                        <Cell w={COLS.dur} align="center" mono color="var(--ink-soft)">{S.days(t.ps, t.pf) + 1}d</Cell>
                        <Cell w={COLS.plan} align="center" mono color="var(--ink-soft)">{fmtS(t.ps)}~{fmtS(t.pf)}</Cell>
                        <Cell w={COLS.act} align="center" mono>{Math.round(t.actual * 100)}%</Cell>
                        <Cell w={COLS.dev} align="center"><span style={{ transform: "scale(0.88)" }}>{devChip(t)}</span></Cell>
                      </div>
                      <div style={{ flex: 1, position: "relative" }}>
                        <div style={{ position: "absolute", left: X(t.ps) + "%", width: Math.max(X(t.pf) - X(t.ps), 1.2) + "%", top: 10, bottom: 10, background: t.color, opacity: 0.22, borderRadius: 4, border: st === "late-start" ? "1.5px dashed var(--danger)" : "none" }}>
                          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (t.actual * 100) + "%", background: t.color, opacity: 0.95, borderRadius: 3 }} />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* FS 依赖线 overlay：肘形折线；禁用关系以灰色虚线保留，不物理删除 */}
                <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none"
                  style={{ position: "absolute", left: LEFTW, right: 0, top: 0, height: H, width: `calc(100% - ${LEFTW}px)`, zIndex: 2, pointerEvents: "none" }}>
                  {deps.map((d, i) => (
                    <path key={i} d={`M ${d.x1} ${d.y1} L ${d.x1} ${d.y2} L ${d.x2} ${d.y2}`}
                      fill="none" stroke={d.disabled ? "var(--ink-faint)" : "#7c93b5"} strokeWidth={1.1}
                      strokeDasharray={d.disabled ? "3 3" : undefined}
                      vectorEffect="non-scaling-stroke" opacity={d.disabled ? 0.5 : 0.55} />
                  ))}
                </svg>
                {/* 箭头用 CSS 三角形定位：本 SVG 为非等比缩放（preserveAspectRatio=none），marker 会被横向拉扁 */}
                <div style={{ position: "absolute", left: LEFTW, right: 0, top: 0, height: H, zIndex: 2, pointerEvents: "none" }}>
                  {deps.map((d, i) => (
                    <span key={i} style={{ position: "absolute", left: d.x2 + "%", top: d.y2,
                      transform: "translate(-5px, -50%)", width: 0, height: 0,
                      borderTop: "3.5px solid transparent", borderBottom: "3.5px solid transparent",
                      borderLeft: "5px solid " + (d.disabled ? "var(--ink-faint)" : "#7c93b5"),
                      opacity: d.disabled ? 0.5 : 0.7 }} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 图例 */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "9px 16px", borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--ink-soft)", flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#6366f1", opacity: 0.22, borderRadius: 2, display: "inline-block" }} />计划区间</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 8, background: "#6366f1", borderRadius: 2, display: "inline-block" }} />实际完成</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 2, height: 12, background: "var(--danger)", display: "inline-block" }} />今天</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 0, borderTop: "1.5px solid #7c93b5", display: "inline-block" }} />前后置依赖（FS + lag）</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 0, borderTop: "1.5px dashed var(--ink-faint)", display: "inline-block" }} />已禁用依赖（保留可恢复）</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="link" size={11} style={{ color: "var(--brand)" }} />进度由工程量联动</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 8, border: "1.5px dashed var(--danger)", borderRadius: 2, display: "inline-block" }} />应开未开</span>
          </div>
        </Panel>

        {modal && modal.kind === "task" && <TaskModal proj={proj} g={modal.g} t={modal.t} S={S} navigate={navigate} onClose={() => setModal(null)} />}
        {modal && modal.kind === "addTask" && <AddTaskModal proj={proj} g={modal.g} S={S} onClose={() => setModal(null)} />}
        {/* 反馈轮8：新建楼栋分组改为独立子页面 scheduleGroupNew（原 AddGroupModal 弹窗废弃） */}
      </div>
    );
  }

  window.SchedulePlanScreen = SchedulePlanScreen;
})();
