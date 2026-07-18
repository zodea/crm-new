// ContractForms — 合同域整页表单规格（grill 决议 2026-07-18；字段对标红圈支出合同新建表单实拍 5 分区 33 字段 + 明细网格）。
// 注册路由：conContractForm 施工合同 / subContractForm 分包合同 / matContractForm 材料采购合同(含采购明细网格) /
//           companyExpForm 公司支出合同 / otherExpForm 其他支出合同 / otherSettleForm 其他支出结算
// 三类合同共用 contractSpec(kind) 内部 builder：施工=甲方(客户) lookup、分包=乙方+分包类别、材采=乙方+明细网格。
// 用法：window.KitFormUtil.registerForm(route, {title, subtitle, listRoute}, (params)=>spec)，
//       spec 契约见 kit/FormPage.jsx 头注释；defs 复用 KitFormUtil.buildFields/coerce。
(function () {
  if (window.ContractFormsPreload) return;
  window.ContractFormsPreload = function () { return null; };
  const reg = () => {
    const KF = window.KitFormUtil;
    const A = window.APP;
    if (!KF || !A) { setTimeout(reg, 60); return; }

    // —— 公共小工具 ——
    const num = (v) => Number(String(v == null ? "" : v).replace(/[^\d.\-]/g, "")) || 0;
    const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
    const ymd = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const rand3 = () => String(Math.floor(Math.random() * 900) + 100);
    const byName = (rows, name) => rows.find((x) => x.name === name);

    // ============ 三类合同共用 builder（红圈支出合同实拍：基本信息/合同金额/合同条款/质保金/开票方 + 材采明细网格 + 附件备注） ============
    const KIND_CFG = {
      "施工": { title: "施工合同", listRoute: "conContract", code: "SG", invLabel: "累计开票", payLabel: "累计收款",
        taxRate: "9%", doc: { name: "施工合同正本.pdf", pages: 20 } },
      "分包": { title: "分包合同", listRoute: "subContract", code: "FB", invLabel: "累计收票", payLabel: "累计支付",
        taxRate: "9%", doc: { name: "分包合同.pdf", pages: 14 } },
      "材采": { title: "材料采购合同", listRoute: "matContract", code: "CG", invLabel: "累计收票", payLabel: "累计支付",
        taxRate: "13%", doc: { name: "材料采购合同.pdf", pages: 8 } },
    };
    const contractSpec = (kind, params) => {
      const cfg = KIND_CFG[kind];
      const row = params.id ? A.get("contracts", params.id) : null;
      const projects = A.rows("projects");
      const suppliers = A.rows("suppliers");
      const customers = A.rows("customers");
      const pName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };
      const sName = (id) => { const s = A.get("suppliers", id); return s ? s.name : (id || ""); };
      const cuName = (id) => { const c = customers.find((x) => x.id === id); return c ? c.name : (id || ""); };
      // 无税金额 = 含税金额 ÷ (1 + 税率)；税额 = 含税 − 无税（税率取自 select「9%」等）
      const excOf = (v) => { const a = num(v.amount); const r = parseFloat(v.taxRate) / 100 || 0; return a ? a / (1 + r) : 0; };
      const defs = [
        // ① 基本信息
        { key: "no", label: "合同编号", form: { section: "基本信息", placeholder: "留空自动生成",
          hint: "格式 RJ-项目-类别-年月序号，如 RJ-HHXC-" + cfg.code + "-2026001" } },
        { key: "name", label: "合同名称", form: { required: true,
          placeholder: kind === "材采" ? "如 合和新城铝单板采购合同" : kind === "分包" ? "如 泥水班组劳务分包合同" : "如 合和新城施工总承包合同" } },
        { key: "projectId", label: "项目名称", form: { type: "lookup", required: true, options: projects.map((p) => p.name),
          toLabel: (id) => pName(id), toValue: (name) => { const p = byName(projects, name); return p ? p.id : name; } } },
        kind === "施工"
          ? { key: "client", label: "甲方（客户）", form: { type: "lookup", required: true, options: customers.map((c) => c.name),
            toLabel: (id) => cuName(id), toValue: (name) => { const c = byName(customers, name); return c ? c.id : name; },
            hint: "乙方 = 我方（广州市瑞航建筑工程有限公司）" } }
          : { key: "supplierId", label: "乙方（分供方）", form: { type: "lookup", required: true, options: suppliers.map((s) => s.name),
            toLabel: (id) => sName(id), toValue: (name) => { const s = byName(suppliers, name); return s ? s.id : name; } } },
        kind === "分包" && { key: "subKind", label: "分包类别", form: { type: "select", options: ["劳务", "专业"] } },
        { key: "isSupplement", label: "是否补充协议", form: { type: "select", options: ["否", "是-补充协议"] } },
        { key: "content", label: "合同内容简述", form: { required: true, placeholder: "如 铝单板供货" } },
        { key: "signDate", label: "签约日期", form: { type: "date", required: true } },
        { key: "status", label: "合同状态", form: { type: "select", options: ["草稿", "履约中", "已签订", "已结算", "已结清"] } },
        { key: "invoiceType", label: "发票类型", form: { type: "select", options: ["增值税专用发票", "增值税普通发票"] } },
        { key: "contact", label: "履约联系人", form: {} },
        { key: "contactPhone", label: "联系方式", form: { placeholder: "手机号或座机" } },
        // ② 合同金额
        { key: "amount", label: "含税合同金额", money: true, form: { section: "合同金额", type: "number", required: true, suffix: "元" } },
        { key: "taxRate", label: "税率", form: { type: "select", options: ["13%", "9%", "6%", "3%", "1%"] } },
        { key: "_exc", label: "无税金额", form: { type: "readonly", hint: "无税金额 = 含税金额 ÷ (1 + 税率)",
          compute: (v) => { const e = excOf(v); return e ? fmt(e) : ""; } } },
        { key: "_tax", label: "税额", form: { type: "readonly",
          compute: (v) => { const a = num(v.amount); return a ? fmt(a - excOf(v)) : ""; } } },
        { key: "changed", label: "变更后合同金额", money: true, form: { type: "number", suffix: "元", hint: "由变更单驱动，演示可直填" } },
        { key: "_settled", label: "累计结算", form: { type: "readonly", hint: "编辑时显示，新建为 —",
          compute: () => (row ? fmt(row.settled || 0) : "—") } },
        { key: "_invoiced", label: cfg.invLabel, form: { type: "readonly", compute: () => (row ? fmt(row.invoiced || 0) : "—") } },
        { key: "_paid", label: cfg.payLabel, form: { type: "readonly", compute: () => (row ? fmt(row.paid || 0) : "—") } },
        // ③ 合同条款（红圈六段，全部非必填）
        { key: "terms", label: "主要条款", form: { section: "合同条款", type: "textarea" } },
        { key: "termPay", label: "一、支付及结算方式", form: { type: "textarea" } },
        { key: "termBrand", label: "二、品牌及质量标准", form: { type: "textarea" } },
        { key: "termTime", label: "三、工期或交付时间", form: { type: "textarea" } },
        { key: "termWarranty", label: "四、质量保修责任", form: { type: "textarea" } },
        { key: "termSpecial", label: "五、特别约定", form: { type: "textarea" } },
        // ④ 质保金信息
        { key: "warrantyRate", label: "质保金比例", money: true, form: { section: "质保金信息", type: "number", suffix: "%" } },
        { key: "warrantyAmount", label: "质保金", money: true, form: { type: "number", suffix: "元" } },
        { key: "warrantyDays", label: "质保期", money: true, form: { type: "number", suffix: "天" } },
        // ⑤ 开票方信息
        { key: "invoiceName", label: "开票名称", form: { section: "开票方信息" } },
        { key: "invoiceTaxNo", label: "纳税人识别号", form: {} },
        { key: "invoiceAddr", label: "开票地址及电话", form: {} },
        { key: "invoiceBank", label: "开户行", form: {} },
        { key: "invoiceAccount", label: "银行账号", form: {} },
        // ⑥（仅材采）采购合同明细网格
        kind === "材采" && { key: "lines", label: "采购合同明细", form: { section: "采购合同明细", type: "grid",
          gridLabel: "采购合同明细", gridImport: true, minRows: 3, summaryKeys: ["amount"],
          columns: [
            { key: "name", label: "物资名称", width: 130, type: "text", required: true },
            { key: "spec", label: "规格型号", width: 110, type: "text" },
            { key: "brand", label: "品牌", width: 80, type: "text" },
            { key: "unit", label: "单位", width: 70, type: "select", options: ["㎡", "m", "块", "套", "吨", "包", "桶", "樘", "个"] },
            { key: "qty", label: "数量", width: 80, type: "number", required: true },
            { key: "price", label: "含税单价", width: 90, type: "number", required: true },
            { key: "amount", label: "含税金额", width: 100,
              derive: (r) => { const q = Number(r.qty) || 0; const p = Number(r.price) || 0; return q && p ? Math.round(q * p * 100) / 100 : ""; } },
            { key: "needDate", label: "计划到货日期", width: 100, type: "text", placeholder: "2026-08-01" },
            { key: "note", label: "备注", type: "text" },
          ] } },
        // ⑦ 附件与备注
        { key: "draftFiles", label: "合同审批稿", form: { section: "附件与备注", type: "file", max: 15 } },
        { key: "scanFiles", label: "正式合同扫描件", form: { type: "file", max: 9 } },
        { key: "note", label: "备注", form: { type: "textarea" } },
      ].filter(Boolean);
      return {
        coll: "contracts", entity: "ct", listRoute: cfg.listRoute, title: cfg.title, statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => Object.assign(
          { kind: kind, settled: 0, invoiced: 0, paid: 0, doc: cfg.doc,
            status: "履约中", isSupplement: "否", taxRate: cfg.taxRate, invoiceType: "增值税专用发票",
            no: "RJ-" + cfg.code + "-" + ymd().slice(0, 6) + "-" + rand3() },
          kind === "施工" ? { supplierId: null } : null,
          kind === "分包" ? { subKind: "劳务" } : null
        ),
      };
    };
    KF.registerForm("conContractForm", { title: "施工合同", subtitle: "收入侧主合同 · 甲方(客户) · 乙方=我方", listRoute: "conContract" },
      (params) => contractSpec("施工", params));
    KF.registerForm("subContractForm", { title: "分包合同", subtitle: "支出侧 · 劳务/专业分包 · 乙方(分供方)", listRoute: "subContract" },
      (params) => contractSpec("分包", params));
    KF.registerForm("matContractForm", { title: "材料采购合同", subtitle: "支出侧 · 乙供材 · 采购合同明细网格", listRoute: "matContract" },
      (params) => contractSpec("材采", params));

    // ============ 公司支出合同 companyExpForm（公司层面：房租/软件/其他，不挂项目） ============
    KF.registerForm("companyExpForm", { title: "公司支出合同", subtitle: "公司层面 · 房租/软件/其他", listRoute: "companyExp" }, (params) => {
      const row = params.id ? A.get("companyExps", params.id) : null;
      const defs = [
        { key: "no", label: "合同编号", form: { section: "基本信息", placeholder: "留空自动生成（GS-YYYYMMDD-序号）" } },
        { key: "name", label: "合同名称", form: { required: true, placeholder: "如 公司办公室租赁合同" } },
        { key: "category", label: "类别", form: { type: "select", options: ["房租", "软件", "其他"] } },
        { key: "counterparty", label: "对方单位", form: { required: true } },
        { key: "signDate", label: "签订日期", form: { type: "date", required: true } },
        { key: "period", label: "租期或服务期", form: { placeholder: "如 2026-01 至 2026-12" } },
        { key: "amount", label: "合同金额", money: true, form: { section: "合同金额", type: "number", required: true, suffix: "元" } },
        { key: "payCycle", label: "付款周期", form: { type: "select", options: ["月付", "季付", "年付", "一次性"] } },
        { key: "terms", label: "主要条款", form: { section: "条款与附件", type: "textarea" } },
        { key: "contractFiles", label: "合同附件", form: { type: "file", max: 9 } },
        { key: "status", label: "状态", form: { section: "经办与备注", type: "select", options: ["草稿", "履约中", "已结清"] } },
        { key: "note", label: "备注", form: { type: "textarea" } },
      ];
      return {
        coll: "companyExps", entity: "cexp", listRoute: "companyExp", title: "公司支出合同", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ category: "其他", payCycle: "月付", status: "履约中", no: "GS-" + ymd() + "-" + rand3() }),
      };
    });

    // ============ 其他支出合同 otherExpForm（项目上杂项支出：机械租赁/检测服务/其他） ============
    KF.registerForm("otherExpForm", { title: "其他支出合同", subtitle: "项目杂项支出 · 机械租赁/检测服务", listRoute: "otherExp" }, (params) => {
      const row = params.id ? A.get("otherExps", params.id) : null;
      const projects = A.rows("projects");
      const pName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };
      const defs = [
        { key: "no", label: "合同编号", form: { section: "基本信息", placeholder: "留空自动生成（QT-YYYYMMDD-序号）" } },
        { key: "name", label: "合同名称", form: { required: true, placeholder: "如 合和新城塔吊租赁合同" } },
        { key: "projectId", label: "项目名称", form: { type: "lookup", required: true, options: projects.map((p) => p.name),
          toLabel: (id) => pName(id), toValue: (name) => { const p = byName(projects, name); return p ? p.id : name; } } },
        { key: "category", label: "类别", form: { type: "select", options: ["机械租赁", "检测服务", "其他"] } },
        { key: "counterparty", label: "对方单位", form: { required: true } },
        { key: "signDate", label: "签订日期", form: { type: "date", required: true } },
        { key: "period", label: "租期或服务期", form: { placeholder: "如 2026-01 至 2026-12" } },
        { key: "amount", label: "合同金额", money: true, form: { section: "合同金额", type: "number", required: true, suffix: "元" } },
        { key: "payCycle", label: "付款周期", form: { type: "select", options: ["月付", "季付", "年付", "一次性"] } },
        { key: "terms", label: "主要条款", form: { section: "条款与附件", type: "textarea" } },
        { key: "contractFiles", label: "合同附件", form: { type: "file", max: 9 } },
        { key: "status", label: "状态", form: { section: "经办与备注", type: "select", options: ["草稿", "履约中", "已结清"] } },
        { key: "note", label: "备注", form: { type: "textarea" } },
      ];
      return {
        coll: "otherExps", entity: "oexp", listRoute: "otherExp", title: "其他支出合同", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ category: "机械租赁", payCycle: "月付", status: "履约中", no: "QT-" + ymd() + "-" + rand3() }),
      };
    });

    // ============ 其他支出结算 otherSettleForm（其他支出合同的结算单：项目→合同级联 + 合同金额带出） ============
    KF.registerForm("otherSettleForm", { title: "其他支出结算", subtitle: "其他支出合同结算单 · 项目级联", listRoute: "otherSettle" }, (params) => {
      const row = params.id ? A.get("otherSettles", params.id) : null;
      const projects = A.rows("projects");
      const otherExps = A.rows("otherExps");
      const pName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };
      const cName = (id) => { const c = otherExps.find((x) => x.id === id); return c ? c.name : (id || ""); };
      // 级联：项目 → 只列该项目的其他支出合同（vals 里是表单显示名）
      const contractOpts = (vals) => {
        const p = byName(projects, vals.projectId);
        return otherExps.filter((c) => !p || c.projectId === p.id).map((c) => c.name);
      };
      const pickedContract = (vals) => byName(otherExps, vals.contractId);
      const defs = [
        { key: "no", label: "结算单号", form: { section: "基本信息", placeholder: "留空自动生成（QTJS-YYYYMMDD-序号）" } },
        { key: "name", label: "结算名称", form: { required: true, placeholder: "如 塔吊租赁 6 月结算" } },
        { key: "projectId", label: "项目名称", form: { type: "lookup", required: true, options: projects.map((p) => p.name),
          toLabel: (id) => pName(id), toValue: (name) => { const p = byName(projects, name); return p ? p.id : name; } } },
        { key: "contractId", label: "其他支出合同", form: { type: "lookup", options: contractOpts, dependsOn: { key: "projectId", label: "项目名称" },
          toLabel: (id) => cName(id), toValue: (name) => { const c = byName(otherExps, name); return c ? c.id : name; },
          hint: "只列所选项目下的其他支出合同" } },
        { key: "amount", label: "结算金额", money: true, form: { section: "结算金额", type: "number", required: true, suffix: "元" } },
        { key: "date", label: "结算日期", form: { type: "date", required: true } },
        { key: "_camount", label: "合同金额", form: { section: "合同情况（带出）", type: "readonly",
          compute: (v) => { const c = pickedContract(v); return c ? fmt(c.amount || 0) : ""; } } },
        { key: "status", label: "状态", form: { section: "经办与备注", type: "select", options: ["草稿", "待确认", "已确认"] } },
        { key: "note", label: "备注", form: { type: "textarea" } },
        { key: "settleFiles", label: "结算单扫描件", form: { type: "file", max: 9 } },
      ];
      return {
        coll: "otherSettles", entity: "oset", listRoute: "otherSettle", title: "其他支出结算", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "待确认", no: "QTJS-" + ymd() + "-" + rand3() }),
      };
    });
  };
  reg();
})();
