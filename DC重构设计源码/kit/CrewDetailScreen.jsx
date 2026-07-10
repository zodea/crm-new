// CrewDetailScreen — 班组·详情页（按 base-crew.md §五 重构）
// 全宽（无右栏）：顶部摘要 5 格 + 4 Section 垂直堆叠（工人配置 / 项目配置 / 施工记录 / 扣罚记录只读）。
// 施工记录：全班组区域明细（含施工人列）+ 改指派替换确认，与工程量矩阵双向同步。
(function () {
  const { Button, IconButton, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), formModal: () => {} };

  const TH = { padding: "11px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)" };
  const TD = { padding: "11px 14px", fontSize: 13, verticalAlign: "middle" };

  const overrideText = (v) => v == null ? { text: "班组默认", tone: "neutral" } : v === "on" || v === true ? { text: "开启", tone: "ok" } : { text: "关闭", tone: "neutral" };

  function SectionHeader({ title, sub, right }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ width: 4, height: 16, borderRadius: 2, background: "var(--brand)" }} />
        <span style={{ fontSize: 15, fontWeight: 800 }}>{title}</span>
        {sub && <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{sub}</span>}
        {right && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>{right}</div>}
      </div>
    );
  }

  const PENALTIES = [
    { date: "2026-05-12", source: "inspection", project: "合和新城", location: "37F-01户", reason: "墙砖空鼓 3 处", amount: 600, status: "deducted" },
    { date: "2026-05-28", source: "acceptance", project: "合和新城", location: "36F-02户", reason: "阴阳角不顺直", amount: 300, status: "repaired_self" },
  ];
  const SRC_CHIP = { inspection: { tone: "brand", text: "巡检" }, owner_notice: { tone: "warn", text: "联系单" }, acceptance: { tone: "danger", text: "验收" } };
  const PEN_STATUS = { pending: { tone: "warn", text: "待处理" }, repaired_self: { tone: "ok", text: "已修复(抵消)" }, deducted: { tone: "danger", text: "已扣罚" } };
  const money = (v) => "¥" + Number(v).toLocaleString("zh-CN");

  // —— Section 3 施工记录（区域明细 mock：泥水A班多人汇总）——
  const REC_WORKERS = ["虞师傅", "虞嫂", "张师傅", "匡师傅", "李师傅", "何嫂", "文师傅", "老陈"];
  const REC_SEL = { border: "1px solid var(--line-strong)", borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "#fff", cursor: "pointer" };
  const recMoney = (v) => money(Math.round(v));
  const CREW_RECS = [
    { id: "c1", project: "合和新城", building: "1栋", floor: "12F", unit: "01户", item: "墙砖铺贴", worker: "虞师傅", contract: 42.5, site: 43.2, calc: "5.2×2.4+3.1×2.4+4.6×2.4+5.1×2.4", price: 38, date: "2026-05-06", flag: null },
    { id: "c2", project: "合和新城", building: "1栋", floor: "12F", unit: "02户", item: "墙砖铺贴", worker: "匡师傅", contract: 41.8, site: 41.5, calc: "5.0×2.4+3.2×2.4+4.4×2.4+4.7×2.4", price: 38, date: "2026-05-07", flag: null },
    { id: "c3", project: "合和新城", building: "1栋", floor: "12F", unit: "03户", item: "地砖铺贴", worker: "李师傅", contract: 38.6, site: 39.0, calc: "6.2×4.1+4.5×3.0", price: 32, date: "2026-05-09", flag: null },
    { id: "c4", project: "合和新城", building: "1栋", floor: "13F", unit: "01户", item: "防水", worker: "张师傅", contract: 12.5, site: 12.8, calc: "3.4×2.2+2.6×2.05", price: 25, date: "2026-05-10", flag: { t: "rework" } },
    { id: "c5", project: "合和新城", building: "2栋", floor: "08F", unit: "01户", item: "墙砖铺贴", worker: "李师傅", contract: 42.5, site: 42.2, calc: "5.1×2.4+3.1×2.4+4.5×2.4+4.9×2.4", price: 38, date: "2026-05-15", flag: null },
    { id: "c6", project: "合和新城", building: "2栋", floor: "08F", unit: "02户", item: "地砖铺贴", worker: "匡师傅", contract: 38.6, site: 38.9, calc: "6.3×4.1+4.4×3.0", price: 32, date: "2026-05-17", flag: { t: "fine", amt: 200 } },
    { id: "c7", project: "合和新城", building: "2栋", floor: "09F", unit: "01户", item: "地砖铺贴", worker: "虞嫂", contract: 38.6, site: 38.2, calc: "6.1×4.1+4.4×3.0", price: 32, date: "2026-05-20", flag: null },
    { id: "c8", project: "合和新城", building: "3栋", floor: "33F", unit: "01户", item: "墙砖铺贴", worker: "虞师傅", contract: 42.5, site: 43.2, calc: "5.2×2.4+3.1×2.4+4.6×2.4+5.1×2.4", price: 38, date: "2026-05-12", flag: null },
    { id: "c9", project: "合和新城", building: "3栋", floor: "34F", unit: "02户", item: "墙砖铺贴", worker: "虞师傅", contract: 41.8, site: 42.2, calc: "5.1×2.4+3.2×2.4+4.4×2.4+4.9×2.4", price: 38, date: "2026-05-23", flag: { t: "rework" } },
    { id: "c10", project: "合和新城", building: "3栋", floor: "35F", unit: "01户", item: "墙砖铺贴", worker: "虞师傅", contract: 42.5, site: 43.0, calc: "5.2×2.4+3.2×2.4+4.5×2.4+5.0×2.4", price: 38, date: "2026-06-02", flag: { t: "fine", amt: 200 } },
    { id: "c11", project: "锦绣华庭", building: "1栋", floor: "05F", unit: "01户", item: "墙砖铺贴", worker: "张师傅", contract: 40.0, site: 40.6, calc: "5.0×2.4+3.0×2.4+4.4×2.4+4.5×2.4", price: 36, date: "2026-06-10", flag: null },
    { id: "c12", project: "锦绣华庭", building: "1栋", floor: "05F", unit: "02户", item: "地砖铺贴", worker: "李师傅", contract: 36.4, site: 36.1, calc: "5.9×4.0+4.2×3.0", price: 30, date: "2026-06-12", flag: null },
  ];

  function RecFlag({ flag, onPhoto }) {
    if (!flag) return <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>—</span>;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <StatusChip tone={flag.t === "fine" ? "danger" : "warn"}>{flag.t === "fine" ? "罚单¥" + flag.amt : "整改"}</StatusChip>
        <IconButton icon="image" title="查看整改照片" onClick={onPhoto} />
      </span>
    );
  }

  function CrewRecords() {
    const [rows, setRows] = React.useState(CREW_RECS);
    const [proj, setProj] = React.useState("合和新城");
    const [bld, setBld] = React.useState("全部");
    const [item, setItem] = React.useState("全部");
    const [assigning, setAssigning] = React.useState(null);

    const list = rows.filter((r) => r.project === proj && (bld === "全部" || r.building === bld) && (item === "全部" || r.item === item));
    const sumC = list.reduce((s, r) => s + r.contract, 0);
    const sumS = list.reduce((s, r) => s + r.site, 0);
    const sumA = list.reduce((s, r) => s + r.site * r.price, 0);

    const replace = (r, next) => UI().confirm({
      title: "替换施工人",
      message: "该区域（" + r.building + "·" + r.floor + "·" + r.unit + "·" + r.item + "）已由 " + r.worker + " 施工，是否替换为 " + next + "？替换后工资将重新归属。",
      confirmText: "替换",
      onConfirm: () => { setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, worker: next, replaced: true } : x))); UI().toast("已替换并同步工程量矩阵", "ok"); },
    });

    const HEADS = ["楼栋", "楼层", "户号", "分项", "施工人", "合同量(㎡)", "现场量(㎡)", "单价(元)", "金额", "完成日期", "状态标记", "操作"];
    const RIGHT = { 5: 1, 6: 1, 7: 1, 8: 1, 11: 1 };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--brand-soft)", color: "var(--brand-deep)", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>
          <Icon name="refresh-cw" size={14} color="var(--brand)" />
          与工程量矩阵双向同步：任一侧修改指派都会提示替换确认
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select value={proj} onChange={(e) => setProj(e.target.value)} style={REC_SEL}>{["合和新城", "锦绣华庭"].map((o) => <option key={o} value={o}>{o}</option>)}</select>
          <select value={bld} onChange={(e) => setBld(e.target.value)} style={REC_SEL}>{["全部", "1栋", "2栋", "3栋"].map((o) => <option key={o} value={o}>{o === "全部" ? "全部楼栋" : o}</option>)}</select>
          <select value={item} onChange={(e) => setItem(e.target.value)} style={REC_SEL}>{["全部", "墙砖铺贴", "地砖铺贴", "防水", "吊顶"].map((o) => <option key={o} value={o}>{o === "全部" ? "全部分项" : o}</option>)}</select>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-faint)" }}>共 {list.length} 条记录</span>
        </div>
        <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>{HEADS.map((h, i) => <th key={i} style={{ ...TH, textAlign: RIGHT[i] ? "right" : "left" }}>{h}</th>)}</tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={12} style={{ ...TD, textAlign: "center", color: "var(--ink-faint)", padding: 30 }}>当前筛选条件下暂无施工记录。</td></tr>}
              {list.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={TD}>{r.building}</td>
                  <td style={{ ...TD, fontFamily: "var(--font-mono)" }}>{r.floor}</td>
                  <td style={{ ...TD, fontFamily: "var(--font-mono)" }}>{r.unit}</td>
                  <td style={{ ...TD, fontWeight: 600 }}>{r.item}</td>
                  <td style={TD}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 600 }}>{r.worker}</span>
                      {r.replaced && <StatusChip tone="brand">已替换</StatusChip>}
                    </span>
                  </td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.contract.toFixed(1)}</td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}><span title={"计算式：" + r.calc} style={{ borderBottom: "1px dashed var(--line-strong)", cursor: "help" }}>{r.site.toFixed(1)}</span></td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{r.price.toFixed(2)}</td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{recMoney(r.site * r.price)}</td>
                  <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{r.date}</td>
                  <td style={TD}><RecFlag flag={r.flag} onPhoto={() => UI().toast("查看整改照片（" + r.building + "·" + r.floor + "·" + r.unit + "）")} /></td>
                  <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                    {assigning === r.id ? (
                      <select autoFocus defaultValue="" onBlur={() => setAssigning(null)} onChange={(e) => { const v = e.target.value; setAssigning(null); if (v) replace(r, v); }} style={REC_SEL}>
                        <option value="">选择新施工人…</option>
                        {REC_WORKERS.filter((n) => n !== r.worker).map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    ) : <Button size="sm" icon="arrow-right-left" onClick={() => setAssigning(r.id)}>改指派</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
            {list.length > 0 && (
              <tfoot>
                <tr style={{ background: "var(--surface-2)", borderTop: "1px solid var(--line)" }}>
                  <td colSpan={5} style={{ ...TD, fontWeight: 700 }}>合计（{list.length} 条）</td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{sumC.toFixed(1)}</td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{sumS.toFixed(1)}</td>
                  <td style={{ ...TD, textAlign: "right", color: "var(--ink-faint)" }}>—</td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 800, color: "var(--brand-deep)" }}>{recMoney(sumA)}</td>
                  <td colSpan={3} style={TD}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    );
  }

  function CrewDetailScreen({ data, params, navigate }) {
    const crew = data.crews.find((c) => c.id === (params && params.crewId)) || data.crews[0];
    const cfg = data.crewConfig;
    const [proj, setProj] = React.useState(cfg.project);

    const itemForm = (it) => UI().formModal({ title: it ? "编辑分项 · " + it.name : "添加分项", cols: 2, fields: [
      { key: "name", label: "分项名称", value: it ? it.name : "" }, { key: "unit", label: "单位", value: it ? it.unit : "㎡" },
      { key: "price", label: "单价（元）", value: it ? it.price : "", type: "number" },
    ], onSave: () => UI().toast(it ? "已保存" : "已添加分项", "ok") });

    const SummaryCell = ({ label, value, last }) => (
      <div style={{ flex: 1, padding: "10px 16px", borderRight: last ? "none" : "1px solid var(--line)" }}>
        <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>{value}</div>
      </div>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
            <button onClick={() => window.DC.closeActiveTab()} title="关闭页签（左邻页签自动激活）" style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--line-strong)", background: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 13, color: "var(--ink-soft)", cursor: "pointer" }}>
              <Icon name="arrow-left" size={15} />班组管理
            </button>
            <span style={{ width: 44, height: 44, borderRadius: 10, background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 800, fontSize: 18, display: "grid", placeItems: "center" }}>{crew.name.slice(0, 1)}</span>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{crew.name}</div>
            <div style={{ marginLeft: "auto" }}><Button variant="primary" icon="square-pen" onClick={() => UI().formModal({ title: "编辑班组 · " + crew.name, cols: 2, fields: [{ key: "name", label: "班组名称", value: crew.name }, { key: "trade", label: "工种", value: crew.trade }, { key: "contact", label: "负责人", value: crew.contact }, { key: "phone", label: "联系电话", value: crew.phone }], onSave: () => UI().toast("已保存", "ok") })}>编辑</Button></div>
          </div>
          <div style={{ display: "flex" }}>
            <SummaryCell label="工种类型" value={crew.trade} />
            <SummaryCell label="负责人" value={crew.contact} />
            <SummaryCell label="联系电话" value={crew.phone} />
            <SummaryCell label="工人数" value={`${crew.workerCount} 人`} />
            <SummaryCell label="关联项目数" value={`${crew.projectCount} 个`} last />
          </div>
        </Panel>

        {/* Section 1 — 工人配置 */}
        <Panel padding={18}>
          <SectionHeader title="工人配置" sub={`班组级 · 共 ${cfg.workerConfigs.length} 人`} right={<><Button size="sm" icon="user-plus" onClick={() => UI().formModal({ title: "关联工人", fields: [{ key: "name", label: "工人姓名", placeholder: "搜索已有工人…", full: true }, { key: "mode", label: "计薪方式", type: "select", options: ["计件", "计时"] }], onSave: () => UI().toast("已关联", "ok") })}>关联工人</Button><Button size="sm" onClick={() => UI().toast("请在表格中勾选要移除的工人")}>移除</Button></>} />
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>{["工人", "计薪方式", "房租补贴", "管理提成", "发放比例", "操作"].map((h, i) => <th key={i} style={{ ...TH, textAlign: i === 5 ? "right" : "left" }}>{h}</th>)}</tr></thead>
              <tbody>
                {cfg.workerConfigs.map((wc, i) => {
                  const rent = overrideText(wc.rent), mgmt = overrideText(wc.mgmt);
                  return (
                    <tr key={i} style={{ borderBottom: i < cfg.workerConfigs.length - 1 ? "1px solid var(--line)" : "none" }}>
                      <td style={TD}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <button onClick={() => UI().toast("查看工人「" + wc.worker + "」")} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 700, cursor: "pointer" }}>{wc.worker}</button>
                          {wc.role === "班组长" && <StatusChip tone="brand">班组长</StatusChip>}
                          {wc.linked && <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>↔ {wc.linked}</span>}
                        </span>
                      </td>
                      <td style={TD}>
                        {wc.mode === "time"
                          ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><StatusChip tone="neutral">计时</StatusChip><span style={{ fontSize: 12, color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }}>{wc.daily}元/天</span></span>
                          : <StatusChip tone="brand">计件</StatusChip>}
                      </td>
                      <td style={TD}><StatusChip tone={rent.tone}>{rent.text}</StatusChip></td>
                      <td style={TD}><StatusChip tone={mgmt.tone}>{mgmt.text}</StatusChip></td>
                      <td style={TD}>{wc.ratio == null ? <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>班组默认</span> : <span style={{ fontWeight: 700, fontFamily: "var(--font-mono)" }}>{Math.round(wc.ratio * 100)}%</span>}</td>
                      <td style={{ ...TD, textAlign: "right" }}><IconButton icon="square-pen" title="编辑" onClick={() => UI().formModal({ title: "工人配置 · " + wc.worker, cols: 2, fields: [{ key: "mode", label: "计薪方式", type: "select", options: ["计件", "计时"], value: wc.mode === "time" ? "计时" : "计件" }, { key: "rent", label: "房租补贴", type: "select", options: ["班组默认", "开启", "关闭"] }, { key: "mgmt", label: "管理提成", type: "select", options: ["班组默认", "开启", "关闭"] }, { key: "ratio", label: "发放比例(%)", value: wc.ratio == null ? "" : Math.round(wc.ratio * 100), placeholder: "留空=班组默认" }], onSave: () => UI().toast("已保存配置", "ok") })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* Section 2 — 项目配置 */}
        <Panel padding={18}>
          <SectionHeader title="项目配置" sub="班组 × 项目级" right={
            <>
              <select value={proj} onChange={(e) => setProj(e.target.value)} style={{ border: "1px solid var(--line-strong)", borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "#fff", cursor: "pointer" }}>
                <option>{cfg.project}</option>
                <option>锦绣华庭</option>
              </select>
              <Button size="sm" icon="plus" onClick={() => UI().formModal({ title: "新增项目配置", fields: [{ key: "project", label: "项目", type: "select", options: ["合和新城", "锦绣华庭", "翠湖花园"], full: true }], onSave: () => UI().toast("已新增项目配置", "ok") })}>新增项目配置</Button>
            </>
          } />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)" }}>分项单价</span>
            <div style={{ display: "flex", gap: 8 }}><Button size="sm" icon="plus" onClick={() => itemForm(null)}>添加分项</Button><Button size="sm" icon="copy" onClick={() => UI().toast("已从模板复制分项")}>从模板复制</Button></div>
          </div>
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>{["分项名称", "单位", "单价（元）", "房租补贴", "管理提成", "操作"].map((h, i) => <th key={i} style={{ ...TH, textAlign: i === 2 ? "right" : i === 5 ? "right" : "left" }}>{h}</th>)}</tr></thead>
              <tbody>
                {cfg.items.map((it, i) => (
                  <tr key={i} style={{ borderBottom: i < cfg.items.length - 1 ? "1px solid var(--line)" : "none" }}>
                    <td style={{ ...TD, fontWeight: 600 }}>{it.name}</td>
                    <td style={{ ...TD, color: "var(--ink-soft)" }}>{it.unit}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{it.price.toFixed(2)}</td>
                    <td style={TD}>{it.inRent ? <StatusChip tone="ok">✓</StatusChip> : <span style={{ color: "var(--ink-faint)" }}>—</span>}</td>
                    <td style={TD}>{it.inMgmt ? <StatusChip tone="ok">✓</StatusChip> : <span style={{ color: "var(--ink-faint)" }}>—</span>}</td>
                    <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}><span style={{ display: "inline-flex", gap: 6 }}><IconButton icon="square-pen" title="编辑" onClick={() => itemForm(it)} /><IconButton icon="trash-2" tone="danger" title="删除" onClick={() => UI().confirm({ title: "删除分项", message: "确定删除「" + it.name + "」？", danger: true, confirmText: "删除", onConfirm: () => UI().toast("已删除", "danger") })} /></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <ParamCard title="房租补贴" enabled={cfg.rentEnabled} unit="元/㎡" value={cfg.rentPrice} />
            <ParamCard title="管理提成" enabled={cfg.mgmtEnabled} unit="元/㎡" value={cfg.mgmtPrice} />
            <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>默认发放比例</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input defaultValue={Math.round(cfg.ratio * 100)} style={{ width: 70, border: "1px solid var(--line-strong)", borderRadius: 8, padding: "7px 10px", fontSize: 14, fontFamily: "var(--font-mono)", textAlign: "right" }} />
                <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>%</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 8 }}>工人可单独覆盖</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><Button variant="primary" icon="save" onClick={() => UI().toast("已保存项目配置参数", "ok")}>保存参数</Button></div>
        </Panel>

        {/* Section 3 — 施工记录 */}
        <Panel padding={18}>
          <SectionHeader title="施工记录" sub={`区域明细 · ${crew.name} 全员汇总`} />
          <CrewRecords />
        </Panel>

        {/* Section 4 — 扣罚记录（只读）*/}
        <Panel padding={18}>
          <SectionHeader title="扣罚记录" sub="只读 · 数据来源于项目管理 / 工资核算模块" />
          {PENALTIES.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>暂无扣罚记录。</div>
          ) : (
            <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>{["日期", "来源", "项目", "位置", "原因", "金额", "状态", "操作"].map((h, i) => <th key={i} style={{ ...TH, textAlign: h === "金额" || h === "操作" ? "right" : "left" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {PENALTIES.map((p, i) => {
                    const sc = SRC_CHIP[p.source], st = PEN_STATUS[p.status];
                    return (
                      <tr key={i} style={{ borderBottom: i < PENALTIES.length - 1 ? "1px solid var(--line)" : "none" }}>
                        <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{p.date}</td>
                        <td style={TD}><StatusChip tone={sc.tone}>{sc.text}</StatusChip></td>
                        <td style={TD}>{p.project}</td>
                        <td style={{ ...TD, color: "var(--ink-soft)" }}>{p.location}</td>
                        <td style={TD}>{p.reason}</td>
                        <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--danger-ink)" }}>{money(p.amount)}</td>
                        <td style={TD}><StatusChip tone={st.tone}>{st.text}</StatusChip></td>
                        <td style={{ ...TD, textAlign: "right" }}><IconButton icon="external-link" title="查看源单据" onClick={() => UI().toast("跳转源单据（" + sc.text + "）")} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    );
  }

  function ParamCard({ title, enabled, unit, value }) {
    const [on, setOn] = React.useState(enabled);
    return (
      <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{title}</span>
          <button onClick={() => setOn(!on)} style={{ width: 40, height: 22, borderRadius: 999, border: 0, background: on ? "var(--brand)" : "var(--line-strong)", position: "relative", cursor: "pointer", transition: "background var(--dur-fast)" }}>
            <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left var(--dur-fast)" }} />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: on ? 1 : 0.4 }}>
          <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>单价</span>
          <input defaultValue={value.toFixed(1)} disabled={!on} style={{ width: 70, border: "1px solid var(--line-strong)", borderRadius: 8, padding: "7px 10px", fontSize: 14, fontFamily: "var(--font-mono)", textAlign: "right" }} />
          <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>{unit}</span>
        </div>
      </div>
    );
  }

  window.CrewDetailScreen = CrewDetailScreen;
})();
