// WorkerDetailScreen — 工人·详情页（按 base-worker.md §四 重构）
// 顶部摘要 + 条件亲属右栏（有 familyGroupId→70:30，无→全宽）+ 5 Tab（Tab1 个人信息/三级安全教育/证书档案；Tab2 施工记录：区域明细 + 改指派替换确认，与工程量矩阵双向同步）。
(function () {
  const { Button, IconButton, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), modal: () => {}, formModal: () => {} };

  const TH = { padding: "11px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)" };
  const TD = { padding: "11px 14px", fontSize: 13, verticalAlign: "middle" };
  const wmeta = (id) => (window.WORKER_META && window.WORKER_META[id]) || { trade: "普工", safety: true, family: null, certExp: 0 };
  // 普通详情敏感字段脱敏（对齐 app/lib/util/privacy.ts maskMiddle：保留前缀/后缀，中间 ****）；
  // 完整实名、银行与照片只在「私密资料与照片」整页（workerPrivate，需 worker:sensitive:read）展示。
  const maskMiddle = (value, prefix, suffix) => {
    const text = String(value || "").trim();
    if (!text) return "";
    if (text.length <= 2) return "*".repeat(text.length);
    const pre = Math.min(prefix, text.length - 2);
    const suf = Math.min(suffix, text.length - pre - 1);
    return text.slice(0, pre) + " **** " + text.slice(-suf);
  };
  const maskPhone = (v) => maskMiddle(v, 3, 4);
  const maskIdentifier = (v) => maskMiddle(v, 4, 4);

  function InfoGrid({ title, fields }) {
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{title}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "var(--panel)" }}>
          {fields.map((f, i) => (
            <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", borderRight: (i % 3 !== 2) ? "1px solid var(--line)" : "none", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{f[0]}</span>
              <span style={{ fontSize: 13, color: "var(--ink)", fontFamily: f[2] ? "var(--font-mono)" : "inherit" }}>{f[1] || "—"}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function SegTab({ label, active, onClick, disabled }) {
    return (
      <button type="button" onClick={disabled ? undefined : onClick} style={{
        padding: "10px 2px", marginRight: 24, border: 0, background: "transparent", cursor: disabled ? "not-allowed" : "pointer",
        borderBottom: `2px solid ${active ? "var(--brand)" : "transparent"}`, marginBottom: -1,
        fontSize: 14, fontWeight: active ? 700 : 500, color: disabled ? "var(--ink-faint)" : active ? "var(--brand-deep)" : "var(--ink-soft)",
        whiteSpace: "nowrap", opacity: disabled ? 0.6 : 1,
      }}>{label}</button>
    );
  }

  function ExpiryCell({ date }) {
    if (!date) return <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>无有效期</span>;
    const days = (new Date(date) - new Date("2026-06-30")) / 86400000;
    const sty = days < 0 ? { bg: "var(--danger-soft)", c: "var(--danger-ink)", t: "已过期" }
      : days < 30 ? { bg: "var(--warn-soft)", c: "var(--warn-ink)", t: "即将过期" }
      : { bg: "var(--ok-soft)", c: "var(--ok-ink)", t: "有效" };
    return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: sty.bg, color: sty.c, borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}><span style={{ fontFamily: "var(--font-mono)" }}>{date}</span>· {sty.t}</span>;
  }

  // —— Tab2 施工记录（区域明细 mock：虞师傅 · 3栋 33F-35F 各户墙砖）——
  const REC_WORKERS = ["虞师傅", "虞嫂", "张师傅", "匡师傅", "李师傅", "何嫂", "文师傅", "老陈"];
  const REC_SEL = { border: "1px solid var(--line-strong)", borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "#fff", cursor: "pointer" };
  const recMoney = (v) => "¥" + Math.round(v).toLocaleString("zh-CN");
  const WORKER_RECS = [
    { id: "r1", project: "合和新城", building: "3栋", floor: "33F", unit: "01户", item: "墙砖铺贴", contract: 42.5, site: 43.2, calc: "5.2×2.4+3.1×2.4+4.6×2.4+5.1×2.4", price: 38, date: "2026-05-12", flag: null },
    { id: "r2", project: "合和新城", building: "3栋", floor: "33F", unit: "02户", item: "墙砖铺贴", contract: 41.8, site: 41.8, calc: "5.0×2.4+3.2×2.4+4.4×2.4+4.8×2.4", price: 38, date: "2026-05-14", flag: null },
    { id: "r3", project: "合和新城", building: "3栋", floor: "33F", unit: "03户", item: "墙砖铺贴", contract: 40.2, site: 39.6, calc: "4.8×2.4+3.0×2.4+4.2×2.4+4.5×2.4", price: 38, date: "2026-05-16", flag: null },
    { id: "r4", project: "合和新城", building: "3栋", floor: "33F", unit: "04户", item: "墙砖铺贴", contract: 42.5, site: 42.9, calc: "5.2×2.4+3.1×2.4+4.6×2.4+5.0×2.4", price: 38, date: "2026-05-18", flag: null },
    { id: "r5", project: "合和新城", building: "3栋", floor: "34F", unit: "01户", item: "墙砖铺贴", contract: 42.5, site: 43.5, calc: "5.3×2.4+3.2×2.4+4.6×2.4+5.0×2.4", price: 38, date: "2026-05-21", flag: null },
    { id: "r6", project: "合和新城", building: "3栋", floor: "34F", unit: "02户", item: "墙砖铺贴", contract: 41.8, site: 42.2, calc: "5.1×2.4+3.2×2.4+4.4×2.4+4.9×2.4", price: 38, date: "2026-05-23", flag: { t: "rework" } },
    { id: "r7", project: "合和新城", building: "3栋", floor: "34F", unit: "03户", item: "墙砖铺贴", contract: 40.2, site: 40.8, calc: "4.9×2.4+3.1×2.4+4.3×2.4+4.7×2.4", price: 38, date: "2026-05-26", flag: null },
    { id: "r8", project: "合和新城", building: "3栋", floor: "34F", unit: "04户", item: "墙砖铺贴", contract: 42.5, site: 42.1, calc: "5.1×2.4+3.0×2.4+4.5×2.4+4.9×2.4", price: 38, date: "2026-05-28", flag: null },
    { id: "r9", project: "合和新城", building: "3栋", floor: "35F", unit: "01户", item: "墙砖铺贴", contract: 42.5, site: 43.0, calc: "5.2×2.4+3.2×2.4+4.5×2.4+5.0×2.4", price: 38, date: "2026-06-02", flag: { t: "fine", amt: 200 } },
    { id: "r10", project: "合和新城", building: "3栋", floor: "35F", unit: "02户", item: "墙砖铺贴", contract: 41.8, site: 42.4, calc: "5.1×2.4+3.1×2.4+4.5×2.4+4.9×2.4", price: 38, date: "2026-06-05", flag: null },
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

  function WorkerRecords({ workerName }) {
    const [rows, setRows] = React.useState(WORKER_RECS);
    const [proj, setProj] = React.useState("合和新城");
    const [bld, setBld] = React.useState("全部");
    const [item, setItem] = React.useState("全部");
    const [assigning, setAssigning] = React.useState(null);

    const list = rows.filter((r) => r.project === proj && (bld === "全部" || r.building === bld) && (item === "全部" || r.item === item));
    const kept = list.filter((r) => !r.movedTo);
    const sumC = kept.reduce((s, r) => s + r.contract, 0);
    const sumS = kept.reduce((s, r) => s + r.site, 0);
    const sumA = kept.reduce((s, r) => s + r.site * r.price, 0);

    const replace = (r, next) => UI().confirm({
      title: "替换施工人",
      message: "该区域（" + r.building + "·" + r.floor + "·" + r.unit + "·" + r.item + "）已由 " + workerName + " 施工，是否替换为 " + next + "？替换后工资将重新归属。",
      confirmText: "替换",
      onConfirm: () => { setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, movedTo: next } : x))); UI().toast("已替换并同步工程量矩阵", "ok"); },
    });

    const HEADS = ["楼栋", "楼层", "户号", "分项", "合同量(㎡)", "现场量(㎡)", "单价(元)", "金额", "完成日期", "状态标记", "操作"];
    const RIGHT = { 4: 1, 5: 1, 6: 1, 7: 1, 10: 1 };

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
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>{HEADS.map((h, i) => <th key={i} style={{ ...TH, textAlign: RIGHT[i] ? "right" : "left" }}>{h}</th>)}</tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={11} style={{ ...TD, textAlign: "center", color: "var(--ink-faint)", padding: 30 }}>当前筛选条件下暂无施工记录。</td></tr>}
              {list.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--line)", opacity: r.movedTo ? 0.55 : 1 }}>
                  <td style={TD}>{r.building}</td>
                  <td style={{ ...TD, fontFamily: "var(--font-mono)" }}>{r.floor}</td>
                  <td style={{ ...TD, fontFamily: "var(--font-mono)" }}>{r.unit}</td>
                  <td style={{ ...TD, fontWeight: 600 }}>{r.item}</td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.contract.toFixed(1)}</td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}><span title={"计算式：" + r.calc} style={{ borderBottom: "1px dashed var(--line-strong)", cursor: "help" }}>{r.site.toFixed(1)}</span></td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{r.price.toFixed(2)}</td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, textDecoration: r.movedTo ? "line-through" : "none" }}>{recMoney(r.site * r.price)}</td>
                  <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{r.date}</td>
                  <td style={TD}><RecFlag flag={r.flag} onPhoto={() => UI().toast("查看整改照片（" + r.building + "·" + r.floor + "·" + r.unit + "）")} /></td>
                  <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                    {r.movedTo ? <StatusChip tone="neutral">已转 {r.movedTo}</StatusChip>
                      : assigning === r.id ? (
                        <select autoFocus defaultValue="" onBlur={() => setAssigning(null)} onChange={(e) => { const v = e.target.value; setAssigning(null); if (v) replace(r, v); }} style={REC_SEL}>
                          <option value="">选择新施工人…</option>
                          {REC_WORKERS.filter((n) => n !== workerName).map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      ) : <Button size="sm" icon="arrow-right-left" onClick={() => setAssigning(r.id)}>改指派</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
            {kept.length > 0 && (
              <tfoot>
                <tr style={{ background: "var(--surface-2)" }}>
                  <td colSpan={4} style={{ ...TD, fontWeight: 700 }}>合计（{kept.length} 条）</td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{sumC.toFixed(1)}</td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{sumS.toFixed(1)}</td>
                  <td style={{ ...TD, textAlign: "right", color: "var(--ink-faint)" }}>—</td>
                  <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 800, color: "var(--brand-deep)" }}>{recMoney(sumA)}</td>
                  <td colSpan={3} style={TD}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </Panel>
      </div>
    );
  }

  function WorkerDetailScreen({ data, params, navigate }) {
    const w = data.workers.find((x) => x.id === (params && params.id)) || data.workers[0];
    const m = wmeta(w.id);
    const [tab, setTab] = React.useState("info");

    const family = m.family ? data.workers.filter((x) => wmeta(x.id).family === m.family) : [];
    const hasFamily = family.length > 1;

    // 2026-07-18 表单补全轮：编辑改整页表单（kit/forms/BaseForms.jsx workerForm，5 分区含银行/紧急联系人/证书附件）
    const editWorker = () => navigate("workerForm", { id: w.id });

    const openPrivate = () => navigate("workerPrivate", { id: w.id });

    // 证件照 / 银行卡照属于私密资料，须在私密整页按用途明确关联（#449），不再作为普通证书类别上传或展示。
    const certs = [
      { category: "安全培训合格证", subType: "", file: "安全培训证.pdf", expiry: "2026-12-20", added: "2025-01-10" },
    ];
    if (m.trade === "水电工" || m.certExp > 0) certs.push({ category: "特种作业操作证", subType: m.trade === "水电工" ? "电工" : "高空", file: "特种作业证.pdf", expiry: "2026-07-15", added: "2024-09-01" });

    const tabs = [
      { key: "info", label: "基本信息" },
      { key: "area", label: "施工记录" },
      { key: "wage", label: "工资发放历史", dep: true },
      { key: "att", label: "考勤记录", dep: true },
      { key: "penalty", label: "扣罚记录", dep: true },
    ];

    const SummaryCell = ({ label, value, color }) => (
      <div style={{ flex: 1, padding: "10px 16px", borderRight: "1px solid var(--line)" }}>
        <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3, color: color || "var(--ink)" }}>{value}</div>
      </div>
    );

    const mainCol = (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
          {tabs.map((t) => <SegTab key={t.key} label={t.label} active={tab === t.key} onClick={() => setTab(t.key)} />)}
        </div>

        {tab === "info" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <InfoGrid title="个人信息" fields={[
              ["姓名", w.name], ["性别", "男"], ["身份证号", maskIdentifier(w.idCard), true],
              ["联系电话", maskPhone(w.phone), true], ["籍贯", "广东 / 梅州"], ["紧急联系人", "—"],
              ["工种", m.trade], ["技能等级", "中级"], ["参考日工资", "¥280"],
              ["所属班组", w.team], ["当前项目", w.project], ["在场状态", w.onSite ? "在场" : "已退场"],
              ["进场日期", w.entryDate, true], ["退场日期", w.exitDate || "—", true], ["来源", "手动录入"],
            ]} />

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>三级安全教育</div>
              {m.safety ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--ok-soft)", background: "var(--ok-soft)", borderRadius: 10, padding: "12px 16px" }}>
                  <Icon name="circle-check" size={20} color="var(--ok)" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ok-ink)" }}>已完成三级安全教育</span>
                  <Button size="sm" style={{ marginLeft: "auto" }} onClick={() => UI().toast("查看安全教育记录")}>查看记录</Button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--danger)", background: "var(--danger-soft)", borderRadius: 10, padding: "12px 16px" }}>
                  <Icon name="triangle-alert" size={20} color="var(--danger)" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--danger-ink)" }}>该工人尚未完成三级安全教育，发放工资时将标红警告。</span>
                  <Button size="sm" variant="primary" style={{ marginLeft: "auto" }} onClick={() => UI().toast("登记三级安全教育…", "ok")}>登记</Button>
                </div>
              )}
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>证书档案</span>
                <Button size="sm" variant="primary" icon="upload" onClick={() => UI().formModal({ title: "上传证书", fields: [{ key: "cat", label: "证书类别", type: "select", options: ["安全培训合格证", "特种作业操作证"], full: true }, { key: "expiry", label: "有效期（选填）" }, { key: "file", label: "选择文件", placeholder: "点击选择…" }], saveText: "上传", onSave: () => UI().toast("已上传证书", "ok") })}>上传证书</Button>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 8 }}>
                证件照与银行卡照属于私密资料，请在
                <button type="button" onClick={openPrivate} style={{ border: 0, background: "transparent", padding: "0 2px", color: "var(--brand)", cursor: "pointer", fontSize: 12 }}>私密资料与照片</button>
                中按用途明确关联；旧附件不按文件名推断用途。
              </div>
              <Panel padding={0} style={{ overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>{["证书类别", "细分", "文件名", "有效期", "添加日期", "操作"].map((h, i) => <th key={i} style={{ ...TH, textAlign: i === 5 ? "right" : "left" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {certs.map((c, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ ...TD, fontWeight: 600 }}>{c.category}</td>
                        <td style={{ ...TD, color: "var(--ink-soft)" }}>{c.subType || "—"}</td>
                        <td style={TD}><button onClick={() => UI().modal({ title: c.category, subtitle: c.file, width: 520, bodyHTML: '<div style="height:300px;display:grid;place-items:center;background:var(--surface-2);border-radius:8px;color:var(--ink-faint)">证书预览（演示）</div>' })} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", cursor: "pointer" }}>{c.file}</button></td>
                        <td style={TD}><ExpiryCell date={c.expiry} /></td>
                        <td style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{c.added}</td>
                        <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                          <span style={{ display: "inline-flex", gap: 6 }}>
                            <IconButton icon="eye" title="查看" onClick={() => UI().modal({ title: c.category, subtitle: c.file, width: 520, bodyHTML: '<div style="height:300px;display:grid;place-items:center;background:var(--surface-2);border-radius:8px;color:var(--ink-faint)">证书预览（演示）</div>' })} />
                            <IconButton icon="download" title="下载" onClick={() => UI().toast("正在下载 " + c.file + "…")} />
                            <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => UI().confirm({ title: "删除证书", message: "确定删除「" + c.category + "」？", danger: true, confirmText: "删除", onConfirm: () => UI().toast("已删除", "danger") })} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>
          </div>
        )}

        {tab === "area" && <WorkerRecords workerName={w.name} />}

        {tab !== "info" && tab !== "area" && (
          <Panel padding={40} style={{ textAlign: "center", color: "var(--ink-faint)" }}>
            <Icon name="clock" size={28} color="var(--ink-faint)" />
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-soft)", marginTop: 10 }}>{tabs.find((t) => t.key === tab).label}</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>数据结构已定义，待 {tab === "wage" ? "工资核算" : tab === "att" ? "考勤" : "扣罚来源"} 模块完成后启用（V1）。</div>
          </Panel>
        )}
      </div>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
            <button onClick={() => window.DC.closeActiveTab()} title="关闭页签（左邻页签自动激活）" style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--line-strong)", background: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 13, color: "var(--ink-soft)", cursor: "pointer" }}>
              <Icon name="arrow-left" size={15} />工人信息
            </button>
            <span style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 800, fontSize: 17, display: "grid", placeItems: "center" }}>{w.name.slice(0, 1)}</span>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{w.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{m.trade} · {w.team}</div>
            </div>
            {/* 对齐实现 CrewWorkerCentralDetailScreen：正式档案且具 worker:sensitive:read 才显示私密入口（次按钮，位于编辑前） */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button icon="lock" onClick={openPrivate}>私密资料与照片</Button>
              <Button variant="primary" icon="square-pen" onClick={editWorker}>编辑</Button>
            </div>
          </div>
          <div style={{ display: "flex" }}>
            <SummaryCell label="工种" value={m.trade} />
            <SummaryCell label="所属班组" value={w.team} />
            <SummaryCell label="当前项目" value={w.project} />
            <SummaryCell label="在场状态" value={w.onSite ? "在场" : "已退场"} color={w.onSite ? "var(--ok-ink)" : "var(--ink-soft)"} />
            <div style={{ flex: 1, padding: "10px 16px" }}>
              <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>进场日期</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3, fontFamily: "var(--font-mono)" }}>{w.entryDate}</div>
            </div>
          </div>
        </Panel>

        {hasFamily ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
            {mainCol}
            <Panel padding={16}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><Icon name="users" size={15} color="var(--brand)" />亲属关联</div>
              {family.map((p, i) => {
                const self = p.id === w.id;
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                    <span style={{ width: 32, height: 32, borderRadius: "50%", background: self ? "var(--brand)" : "var(--surface-3)", color: self ? "#fff" : "var(--ink-soft)", fontWeight: 700, fontSize: 13, display: "grid", placeItems: "center" }}>{p.name.slice(0, 1)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}{self && <span style={{ color: "var(--ink-faint)", fontWeight: 400 }}>（本人）</span>}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{p.team}</div>
                    </div>
                    {!self && <button onClick={() => navigate("workerDetail", { id: p.id })} style={{ border: 0, background: "transparent", color: "var(--brand)", fontSize: 12, cursor: "pointer" }}>查看</button>}
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <Button size="sm" icon="user-plus" onClick={() => UI().formModal({ title: "关联亲属", fields: [{ key: "name", label: "工人姓名", placeholder: "搜索已有工人…", full: true }, { key: "relation", label: "关系", type: "select", options: ["夫妻", "父子", "兄弟", "其他"] }], onSave: () => UI().toast("已关联", "ok") })}>关联亲属</Button>
              </div>
            </Panel>
          </div>
        ) : mainCol}
      </div>
    );
  }

  window.WorkerDetailScreen = WorkerDetailScreen;
})();
