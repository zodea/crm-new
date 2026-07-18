// FinanceForms — 资金域整页表单规格（grill 决议 2026-07-18；字段对标红圈截图 + docs/pages 文档）。
// 注册路由：receiptForm 收款登记 / invApplyForm 开票申请 / currentForm 往来收付 /
//           payRecordForm 支付记录 / reimburseForm 费用报销 / payApplyForm 付款申请(8类型三段式)
// 用法：window.KitFormUtil.registerForm(route, {title, subtitle, listRoute}, (params)=>spec)，
//       spec 契约见 kit/FormPage.jsx 头注释；defs 复用 KitFormUtil.buildFields/coerce。
(function () {
  if (window.FinanceFormsPreload) return;
  window.FinanceFormsPreload = function () { return null; };
  const reg = () => {
    const KF = window.KitFormUtil;
    const A = window.APP;
    if (!KF || !A) { setTimeout(reg, 60); return; }

    // ============ 收款登记 receiptForm（参照实现：分区/必填/级联 lookup/带出/附件/经办四件套） ============
    KF.registerForm("receiptForm", { title: "收款登记", subtitle: "甲方回款 · 关联施工合同 · 收款凭证", listRoute: "receipt" }, (params) => {
      const row = params.id ? A.get("receipts", params.id) : null;
      const projects = A.rows("projects");
      const contracts = A.rows("contracts").filter((c) => c.kind === "施工");
      const customers = A.rows("customers");
      const pName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };
      const cName = (id) => { const c = A.get("contracts", id); return c ? c.name : (id || ""); };
      const byName = (rows, name) => rows.find((x) => x.name === name);
      // 级联：项目 → 只列该项目的施工合同（vals 里是表单显示名）
      const contractOpts = (vals) => {
        const p = byName(projects, vals.projectId);
        return contracts.filter((c) => !p || c.projectId === p.id).map((c) => c.name);
      };
      const pickedContract = (vals) => byName(contracts, vals.contractId);
      const defs = [
        { key: "no", label: "收款单号", form: { section: "基本信息", placeholder: "留空自动生成（SKD-YYYYMMDD-序号）", hint: "登记后可在列表按单号检索" } },
        { key: "date", label: "收款日期", form: { type: "date", required: true } },
        { key: "projectId", label: "项目名称", form: { type: "lookup", required: true, options: projects.map((p) => p.name),
          toLabel: (id) => pName(id), toValue: (name) => { const p = byName(projects, name); return p ? p.id : name; } } },
        { key: "contractId", label: "施工合同", form: { type: "lookup", options: contractOpts, dependsOn: { key: "projectId", label: "项目名称" },
          toLabel: (id) => cName(id), toValue: (name) => { const c = byName(contracts, name); return c ? c.id : name; },
          hint: "只列所选项目下的施工合同" } },
        { key: "payer", label: "付款方（甲方）", form: { type: "lookup", required: true, options: customers.map((c) => c.name) } },
        { key: "payerAccount", label: "付款方账号", form: { placeholder: "对方打款账号后四位即可" } },
        { key: "amount", label: "收款金额", money: true, form: { section: "金额与方式", type: "number", required: true, suffix: "元" } },
        { key: "method", label: "收款方式", form: { type: "select", options: ["银行转账", "银行承兑", "商业承兑", "现金", "抵扣"] } },
        { key: "draftNo", label: "承兑汇票号", form: { placeholder: "收款方式为承兑时填写" } },
        { key: "draftDue", label: "汇票到期日", form: { type: "date" } },
        { key: "periodLabel", label: "收款期次", form: { placeholder: "如 2026 年 6 月进度款 / 第 5 期" } },
        { key: "bankRef", label: "银行流水号", form: {} },
        { key: "_c1", label: "变更后合同金额", form: { section: "合同情况（带出）", type: "readonly",
          compute: (v) => { const c = pickedContract(v); return c ? (c.changed || c.amount || 0).toLocaleString("zh-CN") : ""; } } },
        { key: "_c2", label: "合同累计收款", form: { type: "readonly",
          compute: (v) => { const c = pickedContract(v); return c ? (c.paid || 0).toLocaleString("zh-CN") : ""; } } },
        { key: "_c3", label: "收款 / 合同占比", form: { type: "readonly",
          compute: (v) => { const c = pickedContract(v); if (!c) return ""; const base = c.changed || c.amount || 0; return base ? Math.round(((c.paid || 0) / base) * 1000) / 10 + "%" : "—"; } } },
        { key: "_c4", label: "开票未收款", form: { type: "readonly",
          compute: (v) => { const c = pickedContract(v); return c ? Math.max(0, (c.invoiced || 0) - (c.paid || 0)).toLocaleString("zh-CN") : ""; } } },
        { key: "receiptFiles", label: "收款回单", form: { section: "凭证附件", type: "file", max: 9 } },
        { key: "attachFiles", label: "其他附件", form: { type: "file", max: 9 } },
        { key: "handler", label: "经办人", form: { section: "经办与备注" } },
        { key: "status", label: "审核状态", form: { type: "select", options: ["草稿", "审核中", "已登记"] } },
        { key: "note", label: "备注", form: { type: "textarea", placeholder: "冲销、部分回款等特殊情况在此说明" } },
      ];
      return {
        coll: "receipts", entity: "receipt", listRoute: "receipt", title: "收款登记", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ method: "银行转账", status: "已登记", no: "SKD-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + String(Math.floor(Math.random() * 900) + 100) }),
      };
    });

    // ============ 域内公共小工具（后续 5 个表单复用） ============
    const num = (v) => Number(String(v == null ? "" : v).replace(/[^\d.\-]/g, "")) || 0;                    // 表单显示值 → 数值
    const thou = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("zh-CN");                 // 千分位
    const autoNo = (prefix) => prefix + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + String(Math.floor(Math.random() * 900) + 100);
    const byName = (rows, name) => rows.find((x) => x.name === name);
    const nameLookup = (coll, rows) => ({                                                                  // 实体 lookup 三件套：options/toLabel/toValue
      options: rows.map((x) => x.name),
      toLabel: (id) => { const r0 = A.get(coll, id); return r0 ? r0.name : (id || ""); },
      toValue: (name) => { const r0 = byName(rows, name); return r0 ? r0.id : name; },
    });

    // ============ 开票申请 invApplyForm（收入侧：我方给甲方开票，级联施工合同） ============
    KF.registerForm("invApplyForm", { title: "开票申请", subtitle: "我方给甲方开票 · 关联施工合同", listRoute: "invApply" }, (params) => {
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
        { key: "no", label: "申请编号", form: { section: "基本信息", placeholder: "留空自动生成（KPSQ-YYYYMMDD-序号）" } },
        { key: "name", label: "开票申请名称", form: { required: true, placeholder: "如 天河东路项目 6 月进度款开票" } },
        { key: "projectId", label: "项目名称", form: Object.assign({ type: "lookup", required: true }, nameLookup("projects", projects)) },
        { key: "contractId", label: "施工合同", form: Object.assign({ type: "lookup", dependsOn: { key: "projectId", label: "项目名称" }, hint: "只列所选项目下的施工合同" },
          nameLookup("contracts", contracts), { options: contractOpts }) },
        { key: "invoiceType", label: "发票类型", form: { type: "select", options: ["增值税专用发票", "增值税普通发票"] } },
        { key: "buyer", label: "购方名称", form: { type: "lookup", options: customers.map((c) => c.name), hint: "受票方（甲方）" } },
        { key: "buyerTaxNo", label: "购方税号", form: { placeholder: "统一社会信用代码" } },
        { key: "amount", label: "开票金额", money: true, form: { section: "金额与税率", type: "number", required: true, suffix: "元" } },
        { key: "rate", label: "税率", form: { type: "select", options: ["9%", "13%", "6%", "3%", "1%"] } },
        { key: "tax", label: "税额", money: true, form: { type: "number", suffix: "元" } },
        { key: "_total", label: "价税合计", form: { type: "readonly", compute: (v) => thou(num(v.amount) + num(v.tax)) } },
        { key: "content", label: "开票内容", form: { section: "开票内容", type: "textarea", placeholder: "建筑服务*工程款" } },
        { key: "remark", label: "票面备注", form: { type: "textarea", placeholder: "打印在票面的备注（合同号/项目名等）" } },
        { key: "applicant", label: "申请人", form: { section: "经办与审批" } },
        { key: "date", label: "申请日期", form: { type: "date", required: true } },
        { key: "status", label: "状态", form: { type: "select", options: ["草稿", "审批中", "已审批", "已开票"] } },
        { key: "attachFiles", label: "附件", form: { type: "file", max: 9 } },
      ];
      return {
        coll: "invApplies", entity: "invapply", listRoute: "invApply", title: "开票申请", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "审批中", rate: "9%", no: autoNo("KPSQ-") }),
      };
    });

    // ============ 往来收付 currentForm（非合同类往来，收付双向，无 statusKey） ============
    KF.registerForm("currentForm", { title: "往来收付", subtitle: "非合同类往来收付 · 收付双向", listRoute: "current" }, (params) => {
      const row = params.id ? A.get("currents", params.id) : null;
      const projects = A.rows("projects");
      const defs = [
        { key: "no", label: "单据编号", form: { section: "基本信息", placeholder: "留空自动生成（WL-YYYYMMDD-序号）" } },
        { key: "direction", label: "收付方向", form: { type: "select", required: true, options: ["收", "付"] } },
        { key: "projectId", label: "项目名称", form: Object.assign({ type: "lookup", required: true }, nameLookup("projects", projects)) },
        { key: "counterparty", label: "往来方", form: { required: true, placeholder: "对方单位/个人名称" } },
        { key: "purpose", label: "款项性质", form: { type: "select", options: ["联营往来", "备用金", "押金保证金", "代付代收", "其他"] } },
        { key: "amount", label: "金额", money: true, form: { section: "金额与方式", type: "number", required: true, suffix: "元" } },
        { key: "method", label: "收付方式", form: { type: "select", options: ["银行转账", "银行承兑", "现金"] } },
        { key: "date", label: "日期", form: { type: "date", required: true } },
        { key: "bankRef", label: "银行流水号", form: {} },
        { key: "handler", label: "经办人", form: { section: "经办与备注" } },
        { key: "note", label: "备注", form: { type: "textarea", placeholder: "往来事由、约定归还时间等" } },
        { key: "voucherFiles", label: "凭证附件", form: { type: "file", max: 9 } },
      ];
      return {
        coll: "currents", entity: "current", listRoute: "current", title: "往来收付", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ direction: "收", method: "银行转账", no: autoNo("WL-") }),
      };
    });

    // ============ 支付记录 payRecordForm（实付流水终点，关联付款申请，无 statusKey） ============
    KF.registerForm("payRecordForm", { title: "支付记录", subtitle: "实付流水 · 关联付款申请", listRoute: "payRecord" }, (params) => {
      const row = params.id ? A.get("payRecords", params.id) : null;
      const projects = A.rows("projects");
      const suppliers = A.rows("suppliers");
      const payApplies = A.rows("payApplies");
      const paLabel = (pa) => pa.no + " · " + (pa.name || "");           // 申请单显示名 = 编号 + 名称拼接
      const defs = [
        { key: "no", label: "支付编号", form: { section: "基本信息", placeholder: "留空自动生成（ZF-YYYYMMDD-序号）" } },
        { key: "payApplyId", label: "关联付款申请", form: { type: "lookup", options: payApplies.map(paLabel),
          toLabel: (id) => { const pa = A.get("payApplies", id); return pa ? paLabel(pa) : (id || ""); },
          toValue: (label) => { const pa = payApplies.find((x) => paLabel(x) === label); return pa ? pa.id : label; },
          hint: "按申请单付款时选择，零星支付可留空" } },
        { key: "projectId", label: "项目名称", form: Object.assign({ type: "lookup" }, nameLookup("projects", projects)) },
        { key: "supplierId", label: "收款单位", form: Object.assign({ type: "lookup" }, nameLookup("suppliers", suppliers)) },
        { key: "date", label: "支付日期", form: { section: "支付信息", type: "date", required: true } },
        { key: "amount", label: "支付金额", money: true, form: { type: "number", required: true, suffix: "元" } },
        { key: "method", label: "支付方式", form: { type: "select", options: ["银行转账", "银行承兑", "商业承兑", "现金"] } },
        { key: "voucherNo", label: "付款凭证号", form: {} },
        { key: "account", label: "收款账户名", form: { section: "收款账户" } },
        { key: "bank", label: "开户行", form: {} },
        { key: "bankNo", label: "银行账号", form: { hint: "演示环境可留空" } },
        { key: "handler", label: "经办人", form: { section: "经办与备注" } },
        { key: "note", label: "备注", form: { type: "textarea" } },
        { key: "receiptFiles", label: "付款回单", form: { type: "file", max: 9 } },
      ];
      return {
        coll: "payRecords", entity: "payrec", listRoute: "payRecord", title: "支付记录", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ method: "银行转账", no: autoNo("ZF-") }),
      };
    });

    // ============ 费用报销 reimburseForm（明细网格 Σ金额 回写头字段 amount） ============
    KF.registerForm("reimburseForm", { title: "费用报销", subtitle: "差旅/办公等费用报销 · 明细网格", listRoute: "reimburse" }, (params) => {
      const row = params.id ? A.get("reimburses", params.id) : null;
      const projects = A.rows("projects");
      const defs = [
        { key: "no", label: "报销单号", form: { section: "基本信息", placeholder: "留空自动生成（BX-YYYYMMDD-序号）" } },
        { key: "applicant", label: "报销人", form: { required: true } },
        { key: "projectId", label: "归属项目", form: Object.assign({ type: "lookup", hint: "留空=公司开支" }, nameLookup("projects", projects)) },
        { key: "category", label: "费用类别", form: { type: "select", options: ["差旅费", "办公费", "招待费", "交通费", "水电费", "零星材料"] } },
        { key: "date", label: "报销日期", form: { type: "date", required: true } },
        { key: "items", label: "报销明细", form: { section: "报销明细", type: "grid", gridLabel: "报销明细", minRows: 2,
          columns: [
            { key: "item", label: "费用项目", width: 140, type: "text", required: true },
            { key: "odate", label: "发生日期", width: 90, type: "text", placeholder: "2026-07-01" },
            { key: "amt", label: "金额", width: 90, type: "number", required: true },
            { key: "rnote", label: "备注", width: 140, type: "text" },
          ],
          rows: (row && row.items) || [], summaryKeys: ["amt"] } },
        { key: "amount", label: "报销总额", money: true, form: { type: "number", suffix: "元", hint: "留空则按明细 Σ金额 自动合计" } },
        { key: "status", label: "状态", form: { section: "审批与备注", type: "select", options: ["草稿", "审批中", "已审批", "已付款"] } },
        { key: "invoiceCount", label: "发票张数", form: { type: "number" } },
        { key: "note", label: "报销事由", form: { type: "textarea", placeholder: "报销事由、出差行程等" } },
        { key: "ticketFiles", label: "票据附件", form: { type: "file", max: 15 } },
      ];
      return {
        coll: "reimburses", entity: "reimb", listRoute: "reimburse", title: "费用报销", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => {                                              // 明细行非空 → Σ金额 回写头字段 amount（列表列显示用）
          const o = KF.coerce(defs, vals);
          const rows = Array.isArray(o.items) ? o.items.filter((r) => r && (r.item || num(r.amt))) : [];
          if (rows.length) o.amount = Math.round(rows.reduce((s, r) => s + num(r.amt), 0) * 100) / 100;
          return o;
        },
        newDefaults: () => ({ status: "审批中", no: autoNo("BX-") }),
      };
    });

    // ============ 付款申请 payApplyForm（本域最重：8 业务类型三段式，红圈 6 分区对标） ============
    // 类型分支：有合同-* 3 类 → 合同级联 + 合同情况带出 + 关联结算网格；预付款 → 合同级联 + 预付款情况；
    //           公司付款 → 隐藏项目；关联发票网格全类型通用。type 存入 bizType。
    KF.registerForm("payApplyForm", { title: "付款申请", subtitle: "支出侧起点 · 按业务类型出表单", listRoute: "payApply" }, (params) => {
      const row = params.id ? A.get("payApplies", params.id) : null;
      const t = (row && row.bizType) || params.type || "有合同-人工";
      const hasContract = t.indexOf("有合同") === 0;                     // 有合同 3 类：合同级联 + 带出 + 关联结算
      const isPrepay = t === "预付款";                                   // 预付款：合同级联 + 预付款情况分区
      const showContract = hasContract || isPrepay;
      const noProject = t === "公司付款";                                // 公司付款：不挂项目
      const projects = A.rows("projects");
      const suppliers = A.rows("suppliers");
      const contracts = A.rows("contracts").filter((c) => c.kind !== "施工");   // 支出侧 = 非施工合同
      // 级联：项目 → 只列该项目的非施工合同
      const contractOpts = (vals) => {
        const p = byName(projects, vals.projectId);
        return contracts.filter((c) => !p || c.projectId === p.id).map((c) => c.name);
      };
      const pickedContract = (vals) => byName(contracts, vals.contractId);
      const defs = [
        // —— 分区① 基本信息 ——
        { key: "no", label: "付款申请编号", form: { section: "基本信息", placeholder: "留空自动生成（FKD-YYYYMMDD-序号）" } },
        { key: "name", label: "付款申请名称", form: { required: true, placeholder: "如 泥水劳务分包 7 月进度款" } },
        { key: "_biz", label: "业务类型", form: { type: "readonly", compute: () => t } },
      ];
      if (!noProject) defs.push({ key: "projectId", label: "项目名称", form: Object.assign({ type: "lookup", required: true }, nameLookup("projects", projects)) });
      defs.push({ key: "supplierId", label: "收款单位", form: Object.assign({ type: "lookup", required: true }, nameLookup("suppliers", suppliers)) });
      if (showContract) defs.push({ key: "contractId", label: "关联合同", form: Object.assign({ type: "lookup", dependsOn: { key: "projectId", label: "项目名称" },
        hint: "只列所选项目下的非施工合同" }, nameLookup("contracts", contracts), { options: contractOpts }) });
      defs.push(
        { key: "costName", label: "成本分类", form: { type: "select", options: ["乙供材料", "劳务分包", "专业分包", "机械租赁", "管理费", "项目费用", "其他"] } },
        { key: "applyAmount", label: "申请金额", money: true, form: { type: "number", required: true, suffix: "元" } },
        { key: "applyDate", label: "申请日期", form: { type: "date", required: true } },
        { key: "applicant", label: "申请人", form: {} },
        { key: "invoiceState", label: "回票类型", form: { type: "select", options: ["先票后款", "先款后票", "无需发票"] } },
        { key: "payContent", label: "付款内容", form: { type: "textarea", placeholder: "付款事由、对应工程部位/批次等" } },
        { key: "attachFiles", label: "附件", form: { type: "file", max: 15 } },
      );
      // —— 分区② 合同情况（带出，仅有合同/预付款类） ——
      if (showContract) defs.push(
        { key: "_c1", label: "变更后合同金额", form: { section: "合同情况（带出）", type: "readonly",
          compute: (v) => { const c = pickedContract(v); return c ? thou(c.changed || c.amount || 0) : ""; } } },
        { key: "_c2", label: "往期已结算", form: { type: "readonly",
          compute: (v) => { const c = pickedContract(v); return c ? thou(c.settled || 0) : ""; } } },
        { key: "_c3", label: "往期已付款", form: { type: "readonly",
          compute: (v) => { const c = pickedContract(v); return c ? thou(c.paid || 0) : ""; } } },
        { key: "_c4", label: "付款合同占比", form: { type: "readonly",
          compute: (v) => { const c = pickedContract(v); if (!c) return ""; const base = c.changed || c.amount || 0; return base ? Math.round(((c.paid || 0) / base) * 1000) / 10 + "%" : "—"; } } },
      );
      // —— 分区③ 预付款情况（仅预付款类） ——
      if (isPrepay) defs.push(
        { key: "isPrepay", label: "是否预付款", form: { section: "预付款情况", type: "readonly", compute: () => "预付款" } },
        { key: "prepayDeduct", label: "本次扣除预付款金额", money: true, form: { type: "number", suffix: "元" } },
        { key: "prepayNote", label: "扣除说明", form: { placeholder: "如 按进度款 10% 分期扣回" } },
      );
      // —— 分区④ 关联结算（网格，仅有合同 3 类） ——
      if (hasContract) defs.push({ key: "settleLinks", label: "关联结算", form: { section: "关联结算", type: "grid", gridLabel: "关联结算", minRows: 2,
        columns: [
          { key: "sNo", label: "结算单号", width: 120, type: "text" },
          { key: "sName", label: "结算名称", width: 150, type: "text" },
          { key: "sAmt", label: "结算金额", width: 100, type: "number" },
          { key: "sLink", label: "本次关联金额", width: 110, type: "number", required: true },
          { key: "sNote", label: "备注", type: "text" },
        ],
        rows: (row && row.settleLinks) || [], summaryKeys: ["sLink"] } });
      // —— 分区⑤ 关联发票（网格，全类型） ——
      defs.push({ key: "invoiceLinks", label: "关联发票", form: { section: "关联发票", type: "grid", gridLabel: "关联发票", minRows: 2,
        columns: [
          { key: "iNo", label: "发票号码", width: 140, type: "text" },
          { key: "iDate", label: "开票日期", width: 90, type: "text", placeholder: "2026-07-01" },
          { key: "iAmt", label: "含税金额", width: 100, type: "number" },
          { key: "iLink", label: "本次关联金额", width: 110, type: "number", required: true },
        ],
        rows: (row && row.invoiceLinks) || [], summaryKeys: ["iLink"] } });
      // —— 分区⑥ 审批与支付 ——
      defs.push(
        { key: "approvedAmount", label: "本期批复金额", money: true, form: { section: "审批与支付", type: "number", suffix: "元", hint: "审批后回填" } },
        { key: "paidAmount", label: "已付金额", money: true, form: { type: "number", suffix: "元", hint: "出纳回填" } },
        { key: "status", label: "支付状态", form: { type: "select", options: ["草稿", "审批中", "已审批", "已驳回"] } },
        { key: "note", label: "备注", form: { type: "textarea" } },
      );
      return {
        coll: "payApplies", entity: "pay", listRoute: "payApply", title: "付款申请", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "审批中", invoiceState: "先票后款", bizType: t, approvedAmount: 0, paidAmount: 0, no: autoNo("FKD-") }),
      };
    });
  };
  reg();
})();
