// FinanceForms — 财务域整页表单规格（按实现端 app/lib/finance/page.ts(F3_FORM_META/f3FormDefaults/validateFinanceForm)
// 与 app/components/finance/*.vue（FinanceIncomingFormFields / FinanceGeneralFormFields / FinancePaymentFormFields /
// FinanceLineGrid / FinancePaymentTypeStep）校准，2026-08-01）。
// 注册路由（保持不变）→ 实现端 kind：
//   receiptForm 收款登记(kind: receipt) / invApplyForm 开票申请(kind: invoice_application) /
//   currentForm 往来收付(kind: current) / payRecordForm 支付记录(kind: payment_record) /
//   reimburseForm 费用报销(kind: reimbursement) / payApplyForm 付款申请(kind: payment_application，typeSelect 三段式)
// 用法：window.KitFormUtil.registerForm(route, {title, subtitle, listRoute}, (params)=>spec)，
//       spec 契约见 kit/FormPage.jsx 头注释；defs 复用 KitFormUtil.buildFields/coerce。
// 校准口径：
//   ① 分区名与顺序照 F3_FORM_META.sections；label/必填/枚举照实现端组件与 validateFinanceForm。
//   ② 生命周期状态不做手选下拉：statusKey:"status" + submitLabel:"保存并提交"（草稿→「草稿」，
//      提交→submitStatus「已提交」；支付记录提交→「待核对」，对应实现端 confirmationStatus needs_review）。
//      注意：data.js 旧演示行的 status 值（已登记/已开票/已付款等）与各列表 tone 映射未改，新提交行落「已提交」由 chip 兜底。
//   ③ 存储字段名保留 data.js 现有名（否则演示数据全断）：payer=付款方客户、method=收付/支付方式、
//      draftNo/draftDue=承兑汇票号/到期日、periodLabel=收款期次、bankRef=银行流水号、buyer/buyerTaxNo=购方、
//      tax=税额、rate=税率(存"9%"字符串，表单按数字展示)、content/remark=开票内容/票面备注、date=各单据日期、
//      account/bank/bankNo=收款账户三件套、items/settleLinks/invoiceLinks=明细网格。实现端对应字段见各表单注释。
//   ④ 实现端有而 data.js 无演示值的新字段（reviewStatus、payeeName、purpose、approvalNote、allocations、
//      source、ocrPayload、fieldConfidence 等）直接补上，旧行表单留空即可。
//   ⑤ 勾稽近似：实现端关联结算/发票/付款申请分摊均为真实实体 lookup 单列 + 金额 + 备注三列网格；
//      设计稿无勾稽数据源，以「单号/名称/源单金额」多列 text 近似 lookup 信息，分摊金额列对齐 summaryKeys。
//   ⑥ 付款申请业务类型对齐实现端 PAYMENT_BIZ_TYPES 10 类（表单内可改，同实现端）；PayApplyScreen 的
//      typeSelect 与 data.js 仍是旧 8 类命名（有合同-人工/有合同-分包 等，屏文件本轮禁改），旧值经
//      startsWith("有合同") 分支兼容。实现端「关联发票」分区在 invoiceState=无需发票时整段隐藏，
//      设计稿 spec 静态生成无法联动显隐，保留网格并以空态文案提示。
//   ⑦ 支付记录的「人工确认支付/撤回确认」是实现端表单页头动作（confirm 动作写 confirmationStatus=confirmed），
//      不在吸底五按钮内，设计稿仅以只读「人工核对状态」呈现现状。
(function () {
  if (window.FinanceFormsPreload) return;
  window.FinanceFormsPreload = function () { return null; };
  const reg = () => {
    const KF = window.KitFormUtil;
    const A = window.APP;
    if (!KF || !A) { setTimeout(reg, 60); return; }

    // ============ 域内公共小工具 ============
    const num = (v) => Number(String(v == null ? "" : v).replace(/[^\d.\-]/g, "")) || 0;                    // 表单显示值 → 数值
    const thou = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("zh-CN");                 // 千分位
    const today = () => new Date().toISOString().slice(0, 10);                                             // 实现端 f3FormDefaults 各日期默认今天
    const autoNo = (prefix) => prefix + today().replace(/-/g, "") + "-" + String(Math.floor(Math.random() * 900) + 100);
    const byName = (rows, name) => rows.find((x) => x.name === name);
    const nameLookup = (coll, rows) => ({                                                                  // 实体 lookup 三件套：options/toLabel/toValue
      options: rows.map((x) => x.name),
      toLabel: (id) => { const r0 = A.get(coll, id); return r0 ? r0.name : (id || ""); },
      toValue: (name) => { const r0 = byName(rows, name); return r0 ? r0.id : name; },
    });
    // 实现端四表单共用的支付方式枚举（PAYMENT_METHOD_OPTIONS）
    const METHODS = ["银行转账", "承兑汇票", "现金", "其他"];

    // ============ 收款登记 receiptForm（kind: receipt；分区照 META：基本信息/金额与方式/凭证与备注） ============
    // 实现端字段对照：date→receiptDate、payer→customerId(存客户名)、method→paymentMethod、draftNo→acceptanceBillNo、
    //   draftDue→billDueDate、periodLabel→periodNo、bankRef→bankSerialNo。reviewStatus 为实现端手选业务字段
    //   （区别于动作驱动的生命周期 status），原「审核状态=草稿/审核中/已登记」手选下拉已按 ②③ 拆掉。
    KF.registerForm("receiptForm", { title: "收款登记", subtitle: "合同收款事实 · 真实项目/施工合同/客户", listRoute: "receipt" }, (params) => {
      const row = params.id ? A.get("receipts", params.id) : null;
      const projects = A.rows("projects");
      const contracts = A.rows("contracts").filter((c) => c.kind === "施工");
      const customers = A.rows("customers");
      // 级联：项目 → 只列该项目的施工合同（vals 里是表单显示名）
      const contractOpts = (vals) => {
        const p = byName(projects, vals.projectId);
        return contracts.filter((c) => !p || c.projectId === p.id).map((c) => c.name);
      };
      const defs = [
        { key: "no", label: "收款单号", form: { section: "基本信息", placeholder: "留空自动生成（SK-YYYYMMDD-序号）", hint: "登记后可在列表按单号检索" } },
        { key: "date", label: "收款日期", form: { type: "date", required: true } },
        { key: "projectId", label: "项目", form: Object.assign({ type: "lookup", required: true }, nameLookup("projects", projects)) },
        { key: "contractId", label: "施工合同", form: Object.assign({ type: "lookup", dependsOn: { key: "projectId", label: "项目" },
          hint: "只列所选项目下的施工合同" }, nameLookup("contracts", contracts), { options: contractOpts }) },
        { key: "payer", label: "付款方客户", form: { type: "lookup", required: true, options: customers.map((c) => c.name) } },
        { key: "payerAccount", label: "付款方账号", form: { placeholder: "对方打款账号后四位即可" } },
        { key: "amount", label: "收款金额", money: true, form: { section: "金额与方式", type: "number", required: true, suffix: "元" } },
        { key: "method", label: "收款方式", form: { type: "select", options: METHODS } },
        { key: "draftNo", label: "承兑汇票号", form: { placeholder: "收款方式为承兑时填写" } },
        { key: "draftDue", label: "汇票到期日", form: { type: "date" } },
        { key: "periodLabel", label: "收款期次", form: { placeholder: "如 2026 年 6 月进度款 / 第 5 期" } },
        { key: "bankRef", label: "银行流水号", form: {} },
        { key: "handler", label: "经办人", form: {} },
        { key: "reviewStatus", label: "审核状态", form: { type: "select", options: ["待审核", "已审核", "已驳回"], hint: "业务复核状态，独立于提交流转" } },
        { key: "receiptFiles", label: "收款回单", form: { section: "凭证与备注", type: "file", max: 9 } },
        { key: "note", label: "备注", form: { type: "textarea", placeholder: "冲销、部分回款等特殊情况在此说明" } },
      ];
      return {
        coll: "receipts", entity: "receipt", listRoute: "receipt", title: "收款登记", statusKey: "status", row,
        submitLabel: "保存并提交", submitStatus: "已提交",
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ method: "银行转账", status: "草稿", date: today(), no: autoNo("SK-") }),
      };
    });

    // ============ 开票申请 invApplyForm（kind: invoice_application；分区照 META：基本信息/金额与税率/经办与附件） ============
    // 实现端字段对照：buyer→customerId+buyerNameSnapshot（设计稿一个字段兼客户引用与名称快照，实现端选客户后
    //   自动带出两个快照）、buyerTaxNo→buyerTaxNoSnapshot、tax→taxAmount、rate→taxRate（实现端数字 9，
    //   设计稿存 data.js 的 "9%" 字符串、表单按数字展示）、content/remark→invoiceContent/invoiceRemark、
    //   date→applicationDate。税率不再是固定档位下拉：实现端是自由数字输入。
    KF.registerForm("invApplyForm", { title: "开票申请", subtitle: "收入侧开票起点 · 购方信息提交快照", listRoute: "invApply" }, (params) => {
      const row = params.id ? A.get("invApplies", params.id) : null;
      const projects = A.rows("projects");
      const contracts = A.rows("contracts").filter((c) => c.kind === "施工");
      const customers = A.rows("customers");
      // 级联：项目 → 只列该项目的施工合同（vals 里是表单显示名）
      const contractOpts = (vals) => {
        const p = byName(projects, vals.projectId);
        return contracts.filter((c) => !p || c.projectId === p.id).map((c) => c.name);
      };
      const defs = [
        { key: "no", label: "申请编号", form: { section: "基本信息", placeholder: "留空自动生成（KP-YYYYMMDD-序号）" } },
        { key: "name", label: "开票申请名称", form: { required: true, placeholder: "如 天河东路项目 6 月进度款开票" } },
        { key: "projectId", label: "项目", form: Object.assign({ type: "lookup", required: true }, nameLookup("projects", projects)) },
        { key: "contractId", label: "施工合同", form: Object.assign({ type: "lookup", dependsOn: { key: "projectId", label: "项目" }, hint: "只列所选项目下的施工合同" },
          nameLookup("contracts", contracts), { options: contractOpts }) },
        { key: "buyer", label: "购方客户", form: { type: "lookup", required: true, options: customers.map((c) => c.name),
          hint: "受票方（甲方）；实现端选客户后自动带出名称/税号快照" } },
        { key: "buyerTaxNo", label: "购方税号快照", form: { required: true, placeholder: "统一社会信用代码" } },
        { key: "invoiceType", label: "发票类型", form: { type: "select", options: ["增值税专用发票", "增值税普通发票", "电子普通发票"] } },
        { key: "amount", label: "开票金额", money: true, form: { section: "金额与税率", type: "number", required: true, suffix: "元" } },
        { key: "rate", label: "税率（%）", form: { type: "number",
          toLabel: (v) => String(v == null ? "" : v).replace("%", ""),
          toValue: (v) => (v === "" || v == null) ? v : String(v).replace("%", "") + "%" } },
        { key: "tax", label: "税额", money: true, form: { type: "number", suffix: "元" } },
        { key: "_total", label: "价税合计", form: { type: "readonly", compute: (v) => thou(num(v.amount) + num(v.tax)) } },
        { key: "content", label: "开票内容", form: { type: "textarea", placeholder: "建筑服务*工程款" } },
        { key: "remark", label: "票面备注", form: { type: "textarea", placeholder: "打印在票面的备注（合同号/项目名等）" } },
        { key: "applicant", label: "申请人", form: {} },
        { key: "date", label: "申请日期", form: { type: "date", required: true } },
        { key: "attachFiles", label: "附件", form: { section: "经办与附件", type: "file", max: 9 } },
        { key: "note", label: "备注", form: { type: "textarea" } },
      ];
      return {
        coll: "invApplies", entity: "invapply", listRoute: "invApply", title: "开票申请", statusKey: "status", row,
        submitLabel: "保存并提交", submitStatus: "已提交",
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "草稿", rate: "9%", date: today(), no: autoNo("KP-") }),
      };
    });

    // ============ 往来收付 currentForm（kind: current；分区照 META：基本信息/金额与方式/凭证与备注） ============
    // 实现端字段对照：direction 存「收/付」展示「收款/付款」（实现端存 receipt/payment）、date→transactionDate、
    //   bankRef→bankSerialNo。款项性质按实现端改为自由输入（原固定下拉删除）；实现端 current 同样走
    //   生命周期 status（data.js 旧演示行无 status 字段，新保存行才有）。
    KF.registerForm("currentForm", { title: "往来收付", subtitle: "非合同往来 · 收付方向统一台账", listRoute: "current" }, (params) => {
      const row = params.id ? A.get("currents", params.id) : null;
      const projects = A.rows("projects");
      const defs = [
        { key: "no", label: "单据编号", form: { section: "基本信息", placeholder: "留空自动生成（WL-YYYYMMDD-序号）" } },
        { key: "direction", label: "收付方向", form: { type: "select", required: true, options: ["收款", "付款"],
          toLabel: (v) => v === "收" ? "收款" : (v === "付" ? "付款" : v),
          toValue: (v) => v === "收款" ? "收" : (v === "付款" ? "付" : v) } },
        { key: "projectId", label: "项目", form: Object.assign({ type: "lookup", required: true }, nameLookup("projects", projects)) },
        { key: "counterparty", label: "往来方", form: { required: true, placeholder: "对方单位/个人名称" } },
        { key: "purpose", label: "款项性质", form: { placeholder: "如 联营往来 / 备用金 / 押金保证金" } },
        { key: "amount", label: "金额", money: true, form: { section: "金额与方式", type: "number", required: true, suffix: "元" } },
        { key: "method", label: "收付方式", form: { type: "select", options: METHODS } },
        { key: "date", label: "日期", form: { type: "date", required: true } },
        { key: "bankRef", label: "银行流水号", form: {} },
        { key: "handler", label: "经办人", form: {} },
        { key: "voucherFiles", label: "凭证附件", form: { section: "凭证与备注", type: "file", max: 9 } },
        { key: "note", label: "备注", form: { type: "textarea", placeholder: "往来事由、约定归还时间等" } },
      ];
      return {
        coll: "currents", entity: "current", listRoute: "current", title: "往来收付", statusKey: "status", row,
        submitLabel: "保存并提交", submitStatus: "已提交",
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ direction: "收", method: "银行转账", status: "草稿", date: today(), no: autoNo("WL-") }),
      };
    });

    // ============ 支付记录 payRecordForm（kind: payment_record；分区照 META：基本信息/支付与账户/付款申请分摊/识别与核对/回单与备注） ============
    // 实现端字段对照：date→paymentDate、method→paymentMethod、account/bank/bankNo→payeeAccount/payeeBank/payeeBankAccount、
    //   bankRef→bankSerialNo（新增必填）。实现端没有单值「关联付款申请」，改为多行分摊网格 allocations
    //   （实现端 applicationAllocations，付款申请为 lookup，本处按 ⑤ 以编号 text 近似；确认前分摊合计必须
    //   等于支付金额）。data.js 旧行的 payApplyId 保留给列表穿透用，不再进表单。提交=「待核对」；
    //   「人工确认支付」见头注释 ⑦。source 实现端存 manual/image_ocr/excel_import 枚举，设计稿直接存显示文案。
    KF.registerForm("payRecordForm", { title: "支付记录", subtitle: "银行实际支付 · 多付款申请分摊 · 人工确认", listRoute: "payRecord" }, (params) => {
      const row = params.id ? A.get("payRecords", params.id) : null;
      const projects = A.rows("projects");
      const suppliers = A.rows("suppliers");
      const defs = [
        { key: "no", label: "支付编号", form: { section: "基本信息", placeholder: "留空自动生成（ZF-YYYYMMDD-序号）" } },
        { key: "projectId", label: "项目（公司付款可空）", form: Object.assign({ type: "lookup" }, nameLookup("projects", projects)) },
        { key: "supplierId", label: "收款分供方", form: Object.assign({ type: "lookup" }, nameLookup("suppliers", suppliers)) },
        { key: "payeeName", label: "收款方名称", form: { required: true, placeholder: "银行回单上的收款方全称" } },
        { key: "purpose", label: "付款用途", form: {} },
        { key: "date", label: "支付日期", form: { section: "支付与账户", type: "date", required: true } },
        { key: "amount", label: "支付金额", money: true, form: { type: "number", required: true, suffix: "元" } },
        { key: "method", label: "支付方式", form: { type: "select", options: METHODS } },
        { key: "voucherNo", label: "付款凭证号", form: { required: true } },
        { key: "bankRef", label: "银行流水号", form: { required: true } },
        { key: "account", label: "收款账户名", form: {} },
        { key: "bank", label: "开户行", form: {} },
        { key: "bankNo", label: "银行账号", form: { hint: "演示环境可留空" } },
        { key: "allocations", label: "付款申请分摊", form: { section: "付款申请分摊", type: "grid", gridLabel: "付款申请分摊", minRows: 2,
          columns: [
            { key: "paNo", label: "付款申请", width: 200, type: "text", required: true, placeholder: "申请编号 · 名称" },
            { key: "allocAmt", label: "分摊金额", width: 110, type: "number", required: true },
            { key: "aNote", label: "备注", type: "text" },
          ],
          rows: (row && row.allocations) || [], summaryKeys: ["allocAmt"] } },
        { key: "source", label: "来源", form: { section: "识别与核对", type: "select", options: ["手工录入", "图片/PDF 识别", "Excel 导入"] } },
        { key: "_confirm", label: "人工核对状态", form: { type: "readonly",
          compute: () => (row && row.status) || "草稿" } },
        { key: "confirmedBy", label: "确认人", form: { hint: "人工确认支付时必填" } },
        { key: "recognitionStatus", label: "识别状态", form: { hint: "手工录入无需识别" } },
        { key: "ocrPayload", label: "OCR 原始结果（JSON）", form: { type: "textarea", placeholder: "{}" } },
        { key: "fieldConfidence", label: "字段置信度（JSON）", form: { type: "textarea", placeholder: "{}",
          hint: "OCR 只负责预填，未经人工确认不进入资金汇总" } },
        { key: "receiptFiles", label: "付款回单", form: { section: "回单与备注", type: "file", max: 9 } },
        { key: "note", label: "备注", form: { type: "textarea" } },
      ];
      return {
        coll: "payRecords", entity: "payrec", listRoute: "payRecord", title: "支付记录", statusKey: "status", row,
        submitLabel: "保存并提交", submitStatus: "待核对",
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ method: "银行转账", source: "手工录入", status: "草稿", date: today(), no: autoNo("ZF-") }),
      };
    });

    // ============ 费用报销 reimburseForm（kind: reimbursement；分区照 META：基本信息/费用明细/票据与备注） ============
    // 实现端字段对照：date→reimbursementDate、note→reason（data.js 演示值语义即报销事由，故保留 note 承载事由，
    //   不再另设备注字段）、items 列→expenseItem/expenseDate/amount/note。费用类别按实现端改为自由输入；
    //   「报销总额」输入删除（实现端头上无该字段，合计为派生值），coerce 仍 Σ明细回写 amount 供列表列显示。
    KF.registerForm("reimburseForm", { title: "费用报销", subtitle: "报销头 + 费用明细 · 公司开支允许空项目", listRoute: "reimburse" }, (params) => {
      const row = params.id ? A.get("reimburses", params.id) : null;
      const projects = A.rows("projects");
      const defs = [
        { key: "no", label: "报销单号", form: { section: "基本信息", placeholder: "留空自动生成（BX-YYYYMMDD-序号）" } },
        { key: "applicant", label: "报销人", form: { required: true } },
        { key: "projectId", label: "归属项目", form: Object.assign({ type: "lookup", hint: "留空=公司开支" }, nameLookup("projects", projects)) },
        { key: "category", label: "费用类别", form: { placeholder: "如 差旅费 / 办公费 / 招待费" } },
        { key: "date", label: "报销日期", form: { type: "date", required: true } },
        { key: "invoiceCount", label: "发票张数", form: { type: "number" } },
        { key: "note", label: "报销事由", form: { type: "textarea", placeholder: "报销事由、出差行程等" } },
        { key: "items", label: "费用明细", form: { section: "费用明细", type: "grid", gridLabel: "费用明细", minRows: 2,
          columns: [
            { key: "item", label: "费用项目", width: 140, type: "text", required: true },
            { key: "odate", label: "发生日期", width: 90, type: "text", placeholder: "2026-07-01" },
            { key: "amt", label: "金额", width: 90, type: "number", required: true },
            { key: "rnote", label: "备注", width: 140, type: "text" },
          ],
          rows: (row && row.items) || [], summaryKeys: ["amt"] } },
        { key: "ticketFiles", label: "票据附件", form: { section: "票据与备注", type: "file", max: 15 } },
      ];
      return {
        coll: "reimburses", entity: "reimb", listRoute: "reimburse", title: "费用报销", statusKey: "status", row,
        submitLabel: "保存并提交", submitStatus: "已提交",
        fields: KF.buildFields(defs, row),
        coerce: (vals) => {                                              // 明细行非空 → Σ金额 回写头字段 amount（列表列显示用）
          const o = KF.coerce(defs, vals);
          const rows = Array.isArray(o.items) ? o.items.filter((r) => r && (r.item || num(r.amt))) : [];
          if (rows.length) o.amount = Math.round(rows.reduce((s, r) => s + num(r.amt), 0) * 100) / 100;
          return o;
        },
        newDefaults: () => ({ status: "草稿", date: today(), no: autoNo("BX-") }),
      };
    });

    // ============ 付款申请 payApplyForm（kind: payment_application；本域最重：10 类业务三段式） ============
    // 分区照 META：基本信息 / 关联结算 / 关联发票 / 审批与支付 / 附件与备注。
    // 类型分支照实现端 FinancePaymentFormFields：有合同-* → 关联合同必填 + 关联结算网格（提交时 Σ分摊=申请金额）；
    //   预付款 → 关联合同必填 + 审批分区内扣除字段（实现端无独立「预付款情况」分区，原分区已并入）；
    //   公司付款 → 隐藏项目；关联发票网格全类型（实现端 invoiceState=无需发票时隐藏，见头注释 ⑥；
    //   先票后款提交时 Σ发票分摊=申请金额）。原「合同情况（带出）」分区与「已付金额」输入删除
    //   （实现端无带出分区，已付为确认支付后的派生汇总）。业务类型在表单内可改，同实现端。
    KF.registerForm("payApplyForm", { title: "付款申请", subtitle: "10 类业务 · 真实结算/发票勾稽", listRoute: "payApply" }, (params) => {
      const row = params.id ? A.get("payApplies", params.id) : null;
      // 实现端 f3FormDefaults 默认「有合同-材料」；typeSelect（PayApplyScreen，旧 8 类）经 params.type 带入
      const t = (row && row.bizType) || params.type || "有合同-材料";
      const hasContract = t.indexOf("有合同") === 0;                     // 兼容旧值 有合同-人工/有合同-分包
      const isPrepay = t === "预付款";
      const showContract = hasContract || isPrepay;                      // 实现端：有合同/预付款 → 收款单位+关联合同必填
      const noProject = t === "公司付款";                                // 公司付款：不挂项目
      const projects = A.rows("projects");
      const suppliers = A.rows("suppliers");
      const contracts = A.rows("contracts").filter((c) => c.kind !== "施工");   // 支出侧 = 非施工合同（实现端 分包/材采/其他支出）
      // 级联：项目 → 只列该项目的非施工合同
      const contractOpts = (vals) => {
        const p = byName(projects, vals.projectId);
        return contracts.filter((c) => !p || c.projectId === p.id).map((c) => c.name);
      };
      const defs = [
        // —— 分区① 基本信息 ——
        { key: "no", label: "付款申请编号", form: { section: "基本信息", placeholder: "留空自动生成（FK-YYYYMMDD-序号）" } },
        { key: "name", label: "付款申请名称", form: { required: true, placeholder: "如 泥水劳务分包 7 月进度款" } },
        // 实现端 PAYMENT_BIZ_TYPES 10 类，表单内可改；data.js 旧 8 类值经 startsWith 分支兼容
        { key: "bizType", label: "业务类型", form: { type: "select", required: true, value: t, options: [
          "有合同-合同劳务", "有合同-材料", "有合同-专业分包", "有合同-机械", "有合同-其他",
          "无合同-零星采购", "预付款", "管理费", "项目费用", "公司付款",
        ], hint: "决定合同级联、结算勾稽与回票校验；改类型后建议重新进表单" } },
      ];
      if (!noProject) defs.push({ key: "projectId", label: "项目", form: Object.assign({ type: "lookup", required: true }, nameLookup("projects", projects)) });
      defs.push({ key: "supplierId", label: "收款单位", form: Object.assign({ type: "lookup", required: showContract }, nameLookup("suppliers", suppliers)) });
      if (showContract) defs.push({ key: "contractId", label: "关联合同", form: Object.assign({ type: "lookup", required: true,
        dependsOn: { key: "projectId", label: "项目" }, hint: "只列所选项目下的非施工合同" },
        nameLookup("contracts", contracts), { options: contractOpts }) });
      defs.push(
        { key: "costName", label: "成本分类", form: { type: "select", options: ["合同劳务", "专业分包", "材料", "机械", "管理费", "项目费用", "其他"] } },
        { key: "applyAmount", label: "申请金额", money: true, form: { type: "number", required: true, suffix: "元" } },
        { key: "applyDate", label: "申请日期", form: { type: "date", required: true } },
        { key: "applicant", label: "申请人", form: { required: true } },
        { key: "invoiceState", label: "回票类型", form: { type: "select", required: true, options: ["先票后款", "先款后票", "无需发票"] } },
        { key: "payContent", label: "付款内容", form: { type: "textarea", placeholder: "付款事由、对应工程部位/批次等" } },
      );
      // —— 分区② 关联结算（网格，仅有合同类；实现端为结算单 lookup 勾稽，此处按 ⑤ 近似） ——
      if (hasContract) defs.push({ key: "settleLinks", label: "关联结算", form: { section: "关联结算", type: "grid", gridLabel: "关联结算", minRows: 2,
        columns: [
          { key: "sNo", label: "结算单号", width: 120, type: "text", required: true },
          { key: "sName", label: "结算名称", width: 150, type: "text" },
          { key: "sAmt", label: "结算金额", width: 100, type: "number" },
          { key: "sLink", label: "本次分摊金额", width: 110, type: "number", required: true },
          { key: "sNote", label: "备注", type: "text" },
        ],
        rows: (row && row.settleLinks) || [], summaryKeys: ["sLink"] } });
      // —— 分区③ 关联发票（网格；实现端 无需发票 时整段隐藏 + 先款后票允许无票提交） ——
      defs.push({ key: "invoiceLinks", label: "关联发票", form: { section: "关联发票", type: "grid", gridLabel: "关联发票", minRows: 2,
        columns: [
          { key: "iNo", label: "发票号码", width: 140, type: "text", required: true },
          { key: "iDate", label: "开票日期", width: 90, type: "text", placeholder: "2026-07-01" },
          { key: "iAmt", label: "含税金额", width: 100, type: "number" },
          { key: "iLink", label: "本次分摊金额", width: 110, type: "number", required: true },
          { key: "iNote", label: "备注", type: "text" },
        ],
        rows: (row && row.invoiceLinks) || [], summaryKeys: ["iLink"] } });
      // —— 分区④ 审批与支付（预付款扣除字段并入本分区，照实现端） ——
      if (isPrepay) defs.push(
        { key: "prepayDeduct", label: "本次扣除预付款金额", money: true, form: { section: "审批与支付", type: "number", suffix: "元" } },
        { key: "prepayNote", label: "扣除说明", form: { placeholder: "如 按进度款 10% 分期扣回" } },
        { key: "approvedAmount", label: "本期批复金额", money: true, form: { type: "number", suffix: "元", hint: "审批后回填" } },
      );
      else defs.push(
        { key: "approvedAmount", label: "本期批复金额", money: true, form: { section: "审批与支付", type: "number", suffix: "元", hint: "审批后回填" } },
      );
      defs.push(
        { key: "approvalNote", label: "审批备注", form: { type: "textarea" } },
        // —— 分区⑤ 附件与备注 ——
        { key: "attachFiles", label: "附件", form: { section: "附件与备注", type: "file", max: 15 } },
        { key: "note", label: "备注", form: { type: "textarea" } },
      );
      return {
        coll: "payApplies", entity: "pay", listRoute: "payApply", title: "付款申请", statusKey: "status", row,
        submitLabel: "保存并提交", submitStatus: "已提交",
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        // 实现端 f3FormDefaults：invoiceState 先款后票、costName 材料、approvedAmount/prepayDeduct 0；
        // paidAmount 实现端为确认支付派生值，此处置 0 仅供列表列显示
        newDefaults: () => ({ status: "草稿", invoiceState: "先款后票", bizType: t, costName: "材料",
          approvedAmount: 0, paidAmount: 0, prepayDeduct: 0, applyDate: today(), no: autoNo("FK-") }),
      };
    });
  };
  reg();
})();
