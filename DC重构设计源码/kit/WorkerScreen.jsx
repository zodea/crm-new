// WorkerScreen — 基础信息/工人信息·列表页（按 base-worker.md §二 重构）
// 工具栏（含工种/安全教育下拉筛选）+ 可点击汇总卡（在场/已退场/证书即将过期）+ 表格 + 底部汇总。
// 筛选由 pill 行改为紧凑下拉框（SelectFilter），并入工具栏去臃肿；可点击汇总卡保留。
(function () {
  const { Button, IconButton, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;

  const TH = { padding: "13px 16px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)" };
  const TD = { padding: "13px 16px", fontSize: 13, verticalAlign: "middle" };

  // 工种映射（data.team → trade）+ mock 字段
  window.WORKER_META = window.WORKER_META || {
    w1: { trade: "泥水工", safety: true, family: "fam1", certExp: 0 },
    w2: { trade: "泥水工", safety: true, family: "fam1", certExp: 0 },
    w3: { trade: "泥水工", safety: true, family: null, certExp: 1 },
    w4: { trade: "泥水工", safety: false, family: null, certExp: 0 },
    w5: { trade: "钢筋工", safety: true, family: null, certExp: 1 },
    w6: { trade: "木工", safety: true, family: null, certExp: 0 },
    w7: { trade: "水电工", safety: false, family: null, certExp: 0 },
    w8: { trade: "防水工", safety: true, family: null, certExp: 0 },
  };
  const wmeta = (id) => window.WORKER_META[id] || { trade: "普工", safety: true, family: null, certExp: 0 };
  const maskId = (id) => id.slice(0, 6) + "********" + id.slice(-4);

  const TRADE_OPTS = [
    { key: "all", label: "全部工种" }, { key: "泥水工", label: "泥水工" }, { key: "钢筋工", label: "钢筋工" },
    { key: "木工", label: "木工" }, { key: "水电工", label: "水电工" }, { key: "防水工", label: "防水工" },
  ];
  const SAFE_OPTS = [{ key: "all", label: "全部" }, { key: "done", label: "已完成" }, { key: "undone", label: "未完成" }];

  // SelectFilter 内联副本已删 → 统一用 window.KitAtoms.SelectFilter（反馈轮9 通用组件）
  const SelectFilter = (props) => { const KA = window.KitAtoms; return KA ? <KA.SelectFilter minWidth={120} {...props} /> : null; };

  // 可点击汇总卡（选中态 border-brand + bg-brand-soft）
  function SumCard({ label, value, tone, active, onClick }) {
    const toneColor = { brand: "var(--brand)", soft: "var(--ink-soft)", warn: "var(--warn-ink)" }[tone] || "var(--ink)";
    return (
      <button onClick={onClick} style={{
        flex: 1, textAlign: "left", border: "1px solid", borderColor: active ? "var(--brand)" : "var(--line)",
        background: active ? "var(--brand-soft)" : "var(--panel)", borderRadius: "var(--radius-card)",
        boxShadow: active ? "none" : "var(--shadow-card)", padding: "16px 20px", cursor: "pointer",
        transition: "all var(--dur-fast) var(--ease-snappy)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)" }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-mono)", color: active ? "var(--brand)" : toneColor, marginTop: 4 }}>{value}</div>
      </button>
    );
  }

  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), formModal: () => {}, exportModal: () => {}, importModal: () => {}, undoToast: () => {} };
  // 2026-07-18 表单补全轮：新建/编辑改整页表单（kit/forms/BaseForms.jsx workerForm 路由），数据切共享仓 APP.workers

  function WorkerScreen({ data, navigate }) {
    const [card, setCard] = React.useState("all"); // all/on/off/cert
    const [trade, setTrade] = React.useState("all");
    const [safe, setSafe] = React.useState("all");
    const [q, setQ] = React.useState("");
    // 数据源：window.APP.workers 共享仓 + WORKER_META 补 mock 字段（行值优先，meta 兜底）
    const A = window.APP;
    if (A) A.use();
    const list = (A ? A.rows("workers") : data.workers).map((w) => ({ ...wmeta(w.id), ...w }));

    const delRow = (w) => UI().confirm({
      title: "删除工人", danger: true, confirmText: "删除",
      message: "确定删除「" + w.name + "」？删除为软删除，可在 5 秒内撤回。",
      onConfirm: () => {
        A.softDel("workers", w.id);
        UI().undoToast("已删除「" + w.name + "」", () => A.restore("workers", w.id));
      },
    });

    const workers = list;
    const onCount = workers.filter((w) => w.onSite).length;
    const offCount = workers.filter((w) => !w.onSite).length;
    const certExpCount = workers.reduce((s, w) => s + (w.certExp || 0), 0);

    const rows = workers.filter((w) => {
      if (card === "on" && !w.onSite) return false;
      if (card === "off" && w.onSite) return false;
      if (card === "cert" && w.certExp === 0) return false;
      if (trade !== "all" && w.trade !== trade) return false;
      if (safe === "done" && !w.safety) return false;
      if (safe === "undone" && w.safety) return false;
      if (q && !((w.name || "") + (w.trade || "") + (w.team || "")).includes(q)) return false;
      return true;
    });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 工具栏 */}
        <Panel padding={14} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flex: "none" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>工人信息库</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>共 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{workers.length}</b> 人</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <SelectFilter label="工种" options={TRADE_OPTS} value={trade} onChange={setTrade} />
            <SelectFilter label="安全教育" options={SAFE_OPTS} value={safe} onChange={setSafe} />
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {window.KitAtoms && <window.KitAtoms.SearchInput placeholder="搜索姓名、工种、班组…" value={q} onChange={setQ} />}
            <IconButton icon="refresh-cw" title="刷新" onClick={() => { setCard("all"); setTrade("all"); setSafe("all"); setQ(""); UI().toast("已刷新"); }} />
            <IconButton icon="columns-3" title="列设置" onClick={() => UI().toast("列设置（演示）")} />
            <Button icon="upload" onClick={() => UI().importModal({
              title: "导入工人信息", fileName: "工人花名册.xlsx", rowCount: 2,
              targetFields: ["姓名", "工种", "所属班组", "联系电话", "身份证号", "进场日期"],
              sourceCols: ["姓名", "工种", "班组", "电话", "身份证号", "进场时间"],
              onDone: () => setList((l) => [
                { id: "w_i1_" + Date.now(), name: "何建国", trade: "泥水工", team: "周维铺贴班组", project: "车陂商业大楼", onSite: true, phone: "13900004444", idCard: "440105197805124411", entryDate: "2026-06-28", exitDate: "", safety: false, family: null, certExp: 0 },
                { id: "w_i2_" + Date.now(), name: "麦志强", trade: "水电工", team: "水电一组", project: "车陂商业大楼", onSite: true, phone: "13900005555", idCard: "440683198911083322", entryDate: "2026-06-28", exitDate: "", safety: false, family: null, certExp: 0 },
                ...l,
              ]),
            })}>导入</Button>
            <Button icon="download" onClick={(e) => UI().exportModal({
              title: "导出工人信息", count: rows.length, unit: "人", ext: ".xlsx", anchor: e.currentTarget,
              structureOptions: ["按工种", "按班组", "按在场状态", "不分层"],
              nameOptions: [{ label: "姓名", sample: "杨永强" }, { label: "工种", sample: "泥水工" }, { label: "导出日期", sample: "2026-07-02" }],
            })}>导出</Button>
            <Button variant="primary" icon="user-plus" onClick={() => navigate("workerForm", {})}>添加工人</Button>
          </div>
        </Panel>

        {/* 可点击汇总卡 */}
        <div style={{ display: "flex", gap: 16 }}>
          <SumCard label="在场工人" value={onCount} tone="brand" active={card === "on"} onClick={() => setCard(card === "on" ? "all" : "on")} />
          <SumCard label="已退场" value={offCount} tone="soft" active={card === "off"} onClick={() => setCard(card === "off" ? "all" : "off")} />
          <SumCard label="证书即将过期" value={certExpCount} tone="warn" active={card === "cert"} onClick={() => setCard(card === "cert" ? "all" : "cert")} />
        </div>

        {/* 表格 */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1080, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  {["#", "姓名", "工种", "所属班组", "当前项目", "在场状态", "联系电话", "身份证号", "进场日期", "退场日期", "安全教育", "操作"].map((h, i) => (
                    <th key={i} style={{ ...TH, textAlign: i === 11 ? "right" : "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((w, i) => (
                  <tr key={w.id} style={{ borderBottom: "1px solid var(--line)", transition: "background var(--dur-fast)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ ...TD, color: "var(--ink-soft)" }}>{i + 1}</td>
                    <td style={TD}><button onClick={() => navigate("workerDetail", { id: w.id })} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 700, cursor: "pointer" }}>{w.name}</button></td>
                    <td style={TD}>{w.trade}</td>
                    <td style={TD}>{w.team}</td>
                    <td style={TD}>{w.project}</td>
                    <td style={TD}><span style={{ color: w.onSite ? "var(--ok-ink)" : "var(--ink-soft)", fontWeight: 600 }}>{w.onSite ? "在场" : "已退场"}</span></td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 12 }}>{w.phone}</td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{maskId(w.idCard)}</td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{w.entryDate}</td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-faint)" }}>{w.exitDate || "—"}</td>
                    <td style={TD}>{w.safety ? <Icon name="circle-check" size={17} color="var(--ok)" /> : <Icon name="circle-x" size={17} color="var(--danger)" />}</td>
                    <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <IconButton icon="file-text" title="详情" onClick={() => navigate("workerDetail", { id: w.id })} />
                        <IconButton icon="square-pen" title="编辑" onClick={() => navigate("workerForm", { id: w.id })} />
                        <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => delRow(w)} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 底部汇总 */}
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, fontSize: 12, color: "var(--ink-soft)" }}>
            <span>共 <b style={{ color: "var(--ink)" }}>{workers.length}</b> 人 · 在场 {onCount} 人 · 已退场 {offCount} 人</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {["‹", "1", "›"].map((p, i) => <button key={i} style={{ minWidth: 28, height: 28, border: "1px solid var(--line)", borderRadius: 8, background: p === "1" ? "var(--brand)" : "#fff", color: p === "1" ? "#fff" : "var(--ink-soft)", fontSize: 12, cursor: "pointer" }}>{p}</button>)}
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  window.WorkerScreen = WorkerScreen;
})();
