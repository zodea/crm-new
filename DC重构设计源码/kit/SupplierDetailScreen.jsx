// SupplierDetailScreen — 分供方·详情页（按 base-supplier.md §五 重构）
// 顶部摘要 + 6 Tab（详细资料/证照附件/合作项目/合同汇总/请款付款汇总/收票汇总）+ 右侧文件管理区。
// 跨项目汇总为只读，指标可跳转源单据。证照/汇总 data.js 暂缺，组件内 mock。
(function () {
  const { Button, IconButton, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), modal: () => {}, formModal: () => {} };

  const TH = { padding: "11px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)" };
  const TD = { padding: "11px 14px", fontSize: 13, verticalAlign: "middle" };
  const money = (v) => (v ? "¥" + Number(v).toLocaleString("zh-CN") : "—");

  function SegTab({ label, active, onClick }) {
    return (
      <button type="button" onClick={onClick} style={{
        padding: "10px 2px", marginRight: 24, border: 0, background: "transparent", cursor: "pointer",
        borderBottom: `2px solid ${active ? "var(--brand)" : "transparent"}`, marginBottom: -1,
        fontSize: 14, fontWeight: active ? 700 : 500, color: active ? "var(--brand-deep)" : "var(--ink-soft)", whiteSpace: "nowrap",
      }}>{label}</button>
    );
  }

  function InfoGrid({ title, fields }) {
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--ink)" }}>{title}</div>
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

  const DETAIL = {
    category: "材料供应商", rating: "A", credentialStatus: "qualified", legalRep: "陈志强",
    registeredCapital: "500 万元", registeredDate: "2015-03-12", address: "广州市白云区机场路 188 号 3 栋",
    taxpayerType: "一般纳税人", mainBusiness: "建筑钢材、金属制品销售", invoiceName: "广州市大板东建材有限公司",
    parentSupplier: "", uniqueCode: "MA5CBX1234",
  };
  const CREDS = [
    { category: "营业执照", required: true, file: "营业执照.pdf", verified: "2026-05-10" },
    { category: "法人身份证", required: true, file: "法人身份证.jpg", verified: "2026-05-10" },
    { category: "银行开户许可证", required: true, file: "开户许可证.pdf", verified: "2026-05-11" },
    { category: "签约代表身份证", required: false, file: "", verified: null },
    { category: "完税证明", required: false, file: "完税证明_2025.pdf", verified: "2026-05-12" },
  ];
  const PROJECTS = [
    { project: "合和新城", status: "在建", contract: 1280000, paid: 820000, settle: "进行中" },
    { project: "锦绣华庭", status: "在建", contract: 580000, paid: 380000, settle: "进行中" },
  ];
  const CONTRACTS = [
    { no: "HT-2025-014", type: "材料采购", amount: 1280000, date: "2025-09-10", project: "合和新城" },
    { no: "HT-2026-003", type: "材料采购", amount: 580000, date: "2026-01-20", project: "锦绣华庭" },
  ];
  const PAYMENTS = [
    { no: "FK-2026-051", type: "请款", amount: 320000, date: "2026-05-18", status: "已审批" },
    { no: "LS-2026-088", type: "付款流水", amount: 320000, date: "2026-05-20", status: "已付" },
  ];
  const TICKETS = [
    { number: "...58760", amount: 128640, tax: 14798.23, date: "2026-06-15", project: "合和新城" },
    { number: "...58744", amount: 86000, tax: 9893.81, date: "2026-06-12", project: "锦绣华庭" },
  ];

  const CRED_CHIP = { incomplete: { tone: "warn", text: "证照缺失" }, reviewing: { tone: "brand", text: "审核中" }, qualified: { tone: "ok", text: "合格" }, rejected: { tone: "danger", text: "退回" } };

  function SupplierDetailScreen({ data, params, navigate }) {
    // 反馈轮9 第二层：分供方主数据走 window.APP 共享 store（与列表页同源，编辑互通实时联动）
    const A = window.APP;
    if (A) A.use();
    const sup = (A && A.get("suppliers", params && params.id)) || data.suppliers.find((s) => s.id === (params && params.id)) || data.suppliers[0];
    const [tab, setTab] = React.useState("info");
    const d = DETAIL;
    const cc = CRED_CHIP[sup.cred || d.credentialStatus] || CRED_CHIP.incomplete;

    const editSupplier = () => UI().formModal({ title: "编辑分供方 · " + sup.name, cols: 2, fields: [
      { key: "name", label: "公司全称", value: sup.name, full: true },
      { key: "category", label: "类别", type: "select", options: ["材料供应商", "劳务分包商", "设备供应商", "其他"], value: sup.category },
      { key: "cred", label: "资料状态", type: "select", options: ["incomplete", "reviewing", "qualified", "rejected"], value: sup.cred || "incomplete" },
      { key: "contact", label: "联系人", value: sup.contact },
      { key: "phone", label: "电话", value: sup.phone },
      { key: "taxNo", label: "税号", value: sup.taxNo, full: true },
    ], onSave: (v) => {
      if (!v.name) { UI().toast("公司全称不能为空", "danger"); return; }
      if (window.APP) window.APP.update("suppliers", sup.id, v);
      UI().toast("已保存（分供方列表已同步）", "ok");
    } });

    const tabs = [
      { key: "info", label: "详细资料" },
      { key: "cred", label: "证照附件" },
      { key: "proj", label: "合作项目" },
      { key: "contract", label: "合同汇总" },
      { key: "pay", label: "请款 / 付款汇总" },
      { key: "ticket", label: "收票汇总" },
    ];

    const sumContract = PROJECTS.reduce((s, p) => s + p.contract, 0);
    const sumPaid = PROJECTS.reduce((s, p) => s + p.paid, 0);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel padding={18}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button onClick={() => window.DC.closeActiveTab()} title="关闭页签（左邻页签自动激活）" style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--line-strong)", background: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 13, color: "var(--ink-soft)", cursor: "pointer" }}>
              <Icon name="arrow-left" size={15} />返回列表
            </button>
            <span style={{ width: 44, height: 44, borderRadius: 10, background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 800, fontSize: 18, display: "grid", placeItems: "center" }}>{sup.name.slice(0, 1)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>{sup.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>{d.category} · 评价 {d.rating} · 联系人 {sup.contact} · <span style={{ fontFamily: "var(--font-mono)" }}>{sup.phone}</span></div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <StatusChip tone={cc.tone}>资料{cc.text}</StatusChip>
              <Button icon="search-check" onClick={() => UI().toast("正在查询「" + sup.name + "」工商信息…")}>爱企查</Button>
              <Button variant="primary" icon="square-pen" onClick={editSupplier}>编辑</Button>
            </div>
          </div>
        </Panel>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
              {tabs.map((t) => <SegTab key={t.key} label={t.label} active={tab === t.key} onClick={() => setTab(t.key)} />)}
            </div>

            {tab === "info" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <InfoGrid title="基础信息" fields={[
                  ["公司全称", sup.name], ["分供方类别", d.category], ["统一社会信用代码", sup.taxNo, true],
                  ["唯一识别码", d.uniqueCode, true], ["法定代表人", d.legalRep], ["注册资金", d.registeredCapital],
                  ["注册日期", d.registeredDate, true], ["纳税人类型", d.taxpayerType], ["评价等级", d.rating],
                  ["注册地址", sup.note ? sup.name + "地址" : d.address], ["主营业务", d.mainBusiness], ["上级供应商", d.parentSupplier],
                ]} />
                <InfoGrid title="开票 / 银行信息" fields={[
                  ["开票名称", d.invoiceName], ["开户行", sup.bank], ["银行账号", sup.account, true],
                  ["电话", sup.phone, true], ["开票地址", d.address], ["纳税人类型", d.taxpayerType],
                ]} />
                <InfoGrid title="联系人信息" fields={[
                  ["主要联系人", sup.contact], ["联系方式", sup.phone, true], ["简称 / 别名", sup.aliases.join("、")],
                ]} />
              </div>
            )}

            {tab === "cred" && (
              <Panel padding={0} style={{ overflow: "hidden" }}>
                <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>证照清单</span>
                  <div style={{ display: "flex", gap: 8 }}><Button size="sm" icon="download" onClick={() => UI().toast("正在打包下载全部证照…")}>批量下载</Button><Button size="sm" variant="primary" icon="upload" onClick={() => UI().formModal({ title: "上传证照", fields: [{ key: "cat", label: "证照类别", type: "select", options: ["营业执照", "法人身份证", "银行开户许可证", "完税证明"], full: true }, { key: "file", label: "选择文件", placeholder: "点击选择…", full: true }], saveText: "上传", onSave: () => UI().toast("已上传，OCR 识别中…", "ok") })}>上传证照</Button></div>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>{["证照类别", "是否必需", "文件", "审核", "操作"].map((h, i) => <th key={i} style={{ ...TH, textAlign: i === 4 ? "right" : "left" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {CREDS.map((c, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ ...TD, fontWeight: 600 }}>{c.category}</td>
                        <td style={TD}>{c.required ? <StatusChip tone="brand">必需</StatusChip> : <span style={{ color: "var(--ink-faint)" }}>可选</span>}</td>
                        <td style={{ ...TD, color: c.file ? "var(--ink)" : "var(--ink-faint)" }}>{c.file || "未上传"}</td>
                        <td style={TD}>{c.verified ? <StatusChip tone="ok">已审核</StatusChip> : <StatusChip tone="warn">待补充</StatusChip>}</td>
                        <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                          <span style={{ display: "inline-flex", gap: 6 }}>
                            <IconButton icon="scan-text" title="OCR 重新识别" onClick={() => UI().toast("正在 OCR 识别「" + c.category + "」…")} />
                            <IconButton icon="eye" title="预览" onClick={() => c.file ? UI().modal({ title: c.category, subtitle: c.file, width: 520, bodyHTML: '<div style="height:300px;display:grid;place-items:center;background:var(--surface-2);border-radius:8px;color:var(--ink-faint)">证照预览（演示）</div>' }) : UI().toast("尚未上传", "danger")} />
                            <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => UI().confirm({ title: "删除证照", message: "确定删除「" + c.category + "」？", danger: true, confirmText: "删除", onConfirm: () => UI().toast("已删除", "danger") })} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            )}

            {tab === "proj" && (
              <SummaryTable head={["项目", "状态", "合同额", "已付", "应付", "结算状态"]} note="按项目维度 · 点击跳转 ProjectSupplier 详情">
                {PROJECTS.map((p, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)", cursor: "pointer" }} onClick={() => navigate("project")}>
                    <td style={{ ...TD, color: "var(--brand)", fontWeight: 600 }}>{p.project}</td>
                    <td style={TD}><StatusChip tone="brand">{p.status}</StatusChip></td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(p.contract)}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--ok-ink)" }}>{money(p.paid)}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--danger-ink)" }}>{money(p.contract - p.paid)}</td>
                    <td style={TD}><StatusChip tone="warn">{p.settle}</StatusChip></td>
                  </tr>
                ))}
              </SummaryTable>
            )}

            {tab === "contract" && (
              <SummaryTable head={["合同编号", "类型", "金额", "签订日期", "项目"]} note="跨项目只读 · 点击跳转采购合同详情">
                {CONTRACTS.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ ...TD, color: "var(--brand)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{c.no}</td>
                    <td style={TD}>{c.type}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(c.amount)}</td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{c.date}</td>
                    <td style={{ ...TD, color: "var(--ink-soft)" }}>{c.project}</td>
                  </tr>
                ))}
              </SummaryTable>
            )}

            {tab === "pay" && (
              <SummaryTable head={["单据编号", "类型", "金额", "日期", "状态"]} note="跨项目只读 · 点击跳转付款申请详情">
                {PAYMENTS.map((p, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ ...TD, color: "var(--brand)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{p.no}</td>
                    <td style={TD}>{p.type}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(p.amount)}</td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{p.date}</td>
                    <td style={TD}><StatusChip tone={p.status === "已付" ? "ok" : "brand"}>{p.status}</StatusChip></td>
                  </tr>
                ))}
              </SummaryTable>
            )}

            {tab === "ticket" && (
              <SummaryTable head={["发票号", "金额", "税额", "开票日期", "项目"]} note="跨项目只读 · 点击跳转收票登记详情">
                {TICKETS.map((t, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ ...TD, color: "var(--brand)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{t.number}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(t.amount)}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{money(t.tax)}</td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{t.date}</td>
                    <td style={{ ...TD, color: "var(--ink-soft)" }}>{t.project}</td>
                  </tr>
                ))}
              </SummaryTable>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel padding={16}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>跨项目汇总</div>
              {[["合作项目数", PROJECTS.length + " 个"], ["合同总额", money(sumContract)], ["累计已付", money(sumPaid)], ["应付余额", money(sumContract - sumPaid)]].map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                  <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{r[0]}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)", color: i === 3 ? "var(--danger-ink)" : "var(--ink)" }}>{r[1]}</span>
                </div>
              ))}
            </Panel>

            <Panel padding={16}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>文件管理</span>
                <IconButton icon="upload" title="上传" onClick={() => UI().toast("打开文件上传…")} />
              </div>
              {CREDS.filter((c) => c.file).map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                  <Icon name="file" size={15} color="var(--ink-faint)" />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.file}</span>
                  <IconButton icon="download" title="下载" onClick={() => UI().toast("正在下载 " + c.file + "…")} />
                </div>
              ))}
            </Panel>

            <Panel padding={16} style={{ color: "var(--ink-faint)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--ink-soft)" }}>审批 · 评论 · 动态</div>
              <div style={{ fontSize: 12 }}>V2 接入后台后启用</div>
            </Panel>
          </div>
        </div>
      </div>
    );
  }

  function SummaryTable({ head, note, children }) {
    return (
      <Panel padding={0} style={{ overflow: "hidden" }}>
        {note && <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)" }}>{note}</div>}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 600, borderCollapse: "collapse" }}>
            <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>{head.map((h, i) => <th key={i} style={{ ...TH, textAlign: i >= 2 && i <= 4 ? "right" : "left" }}>{h}</th>)}</tr></thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      </Panel>
    );
  }

  window.SupplierDetailScreen = SupplierDetailScreen;
})();
