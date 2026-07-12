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
  const CRED_CHIP = { incomplete: { tone: "warn", text: "证照缺失" }, reviewing: { tone: "brand", text: "审核中" }, qualified: { tone: "ok", text: "合格" }, rejected: { tone: "danger", text: "退回" } };

  function SupplierDetailScreen({ data, params, navigate }) {
    // 反馈轮9 第二层：分供方主数据走 window.APP 共享 store（与列表页同源，编辑互通实时联动）
    const A = window.APP;
    if (A) A.use();
    const sup = (A && A.get("suppliers", params && params.id)) || data.suppliers.find((s) => s.id === (params && params.id)) || data.suppliers[0];
    const KA = window.KitAtoms || {};
    const [tab, setTab] = React.useState("info");
    const d = DETAIL;

    // 反向 Tab（红圈铁律③）：该分供方名下所有单据按 supplierId 从共享 store 真实过滤聚合（不再硬编码 mock）
    const supContracts = A ? A.rows("contracts").filter((c) => c.supplierId === sup.id) : [];
    const supPayApplies = A ? A.rows("payApplies").filter((p) => p.supplierId === sup.id) : [];
    const supPayRecords = A ? A.rows("payRecords").filter((r) => r.supplierId === sup.id) : [];
    const supSettles = A ? A.rows("subSettles").filter((s) => s.supplierId === sup.id).concat(A.rows("matSettles").filter((s) => s.supplierId === sup.id)) : [];
    // 收票登记 = 我方收到该分供方开来的发票（按 seller 名/别名模糊匹配 data.invoices）
    const supInvoices = (data.invoices || []).filter((iv) => iv.seller && (iv.seller === sup.name || (sup.aliases || []).some((a) => iv.seller.includes(a))));
    // 合作项目：由该分供方合同按 projectId 归组，合同额/已付合计
    const projAgg = {};
    supContracts.forEach((c) => { const g = (projAgg[c.projectId] = projAgg[c.projectId] || { contract: 0, paid: 0 }); g.contract += Number(c.amount) || 0; g.paid += Number(c.paid) || 0; });
    const supProjects = Object.keys(projAgg).map((pid) => ({ pid, contract: projAgg[pid].contract, paid: projAgg[pid].paid, name: (A.get("projects", pid) || {}).name || pid, status: (A.get("projects", pid) || {}).status || "—" }));
    const payRows = supPayApplies.map((p) => ({ no: p.no, type: "付款申请", amount: p.applyAmount, date: p.applyDate, status: p.status }))
      .concat(supPayRecords.map((r) => ({ no: r.no, type: "支付记录", amount: r.amount, date: r.date, status: "已付款" })));
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
      { key: "proj", label: "合作项目 (" + supProjects.length + ")" },
      { key: "contract", label: "支出合同 (" + supContracts.length + ")" },
      { key: "settle", label: "支出结算 (" + supSettles.length + ")" },
      { key: "pay", label: "付款管理 (" + payRows.length + ")" },
      { key: "ticket", label: "收票登记 (" + supInvoices.length + ")" },
    ];

    const sumContract = supContracts.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const sumPaid = supContracts.reduce((s, c) => s + (Number(c.paid) || 0), 0);

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
              <SummaryTable head={["项目", "状态", "合同额", "已付", "应付余额"]} note={"按 supplierId 反向聚合 · 该分供方参与 " + supProjects.length + " 个项目 · 项目名可跳详情"}>
                {supProjects.length === 0 && <tr><td colSpan={5} style={{ ...TD, textAlign: "center", color: "var(--ink-faint)" }}>暂无合作项目</td></tr>}
                {supProjects.map((p, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={TD}>{KA.EntityLink ? <KA.EntityLink type="project" id={p.pid} /> : p.name}</td>
                    <td style={TD}><StatusChip tone="brand">{p.status}</StatusChip></td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(p.contract)}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--ok-ink)" }}>{money(p.paid)}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", color: (p.contract - p.paid) > 0 ? "var(--danger-ink)" : "var(--ink)" }}>{money(p.contract - p.paid)}</td>
                  </tr>
                ))}
              </SummaryTable>
            )}

            {tab === "contract" && (
              <SummaryTable head={["合同名称", "类型", "含税金额", "累计支付", "签订日期", "项目"]} note="该分供方名下支出合同（分包 / 材采）· 合同名/项目名可跳详情">
                {supContracts.length === 0 && <tr><td colSpan={6} style={{ ...TD, textAlign: "center", color: "var(--ink-faint)" }}>暂无支出合同</td></tr>}
                {supContracts.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={TD}>{KA.EntityLink ? <KA.EntityLink type="contract" id={c.id} /> : c.name}</td>
                    <td style={TD}>{c.kind}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(c.amount)}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--ok-ink)" }}>{money(c.paid)}</td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{c.signDate}</td>
                    <td style={TD}>{KA.EntityLink ? <KA.EntityLink type="project" id={c.projectId} /> : c.projectId}</td>
                  </tr>
                ))}
              </SummaryTable>
            )}

            {tab === "settle" && (
              <SummaryTable head={["结算单号", "结算名称", "金额", "日期", "状态"]} note="该分供方名下 分包结算 / 材料采购结算 汇总">
                {supSettles.length === 0 && <tr><td colSpan={5} style={{ ...TD, textAlign: "center", color: "var(--ink-faint)" }}>暂无结算单</td></tr>}
                {supSettles.map((s, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{s.no}</td>
                    <td style={{ ...TD, fontWeight: 600 }}>{s.name}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(s.amount)}</td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{s.date}</td>
                    <td style={TD}><StatusChip tone={s.status === "已确认" ? "ok" : "warn"}>{s.status}</StatusChip></td>
                  </tr>
                ))}
              </SummaryTable>
            )}

            {tab === "pay" && (
              <SummaryTable head={["单据编号", "类型", "金额", "日期", "状态"]} note="该分供方名下 付款申请 + 支付记录（付款管理反向视图）">
                {payRows.length === 0 && <tr><td colSpan={5} style={{ ...TD, textAlign: "center", color: "var(--ink-faint)" }}>暂无付款单据</td></tr>}
                {payRows.map((p, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)", fontWeight: 600 }}>{p.no}</td>
                    <td style={TD}>{p.type}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(p.amount)}</td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{p.date}</td>
                    <td style={TD}><StatusChip tone={p.status === "已付款" ? "ok" : p.status === "审批中" ? "brand" : "warn"}>{p.status}</StatusChip></td>
                  </tr>
                ))}
              </SummaryTable>
            )}

            {tab === "ticket" && (
              <SummaryTable head={["发票号", "金额", "税额", "开票日期", "项目"]} note="收票登记 = 我方收到该分供方开来的发票（按 seller 名/别名匹配）">
                {supInvoices.length === 0 && <tr><td colSpan={5} style={{ ...TD, textAlign: "center", color: "var(--ink-faint)" }}>暂无收票记录</td></tr>}
                {supInvoices.map((t, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)", fontWeight: 600 }}>…{String(t.number || "").slice(-8)}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(Number(String(t.total).replace(/[^\d.]/g, "")) || 0)}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{money(Number(String(t.tax).replace(/[^\d.]/g, "")) || 0)}</td>
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
              {[["合作项目数", supProjects.length + " 个"], ["合同总额", money(sumContract)], ["累计已付", money(sumPaid)], ["应付余额", money(sumContract - sumPaid)]].map((r, i) => (
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
