// BaseForms — 基础档案域整页表单规格（grill 决议 2026-07-18；分供方对标红圈新建表单实拍 4 分区 29 字段+7 附件位）。
// 注册路由：supplierForm 分供方(七类 typeSelect 三段式) / customerForm 客户 / crewForm 班组 /
//           workerForm 工人 / projectForm 项目 / targetCostForm 目标成本
// 用法：window.KitFormUtil.registerForm(route, {title, subtitle, listRoute}, (params)=>spec)，
//       spec 契约见 kit/FormPage.jsx 头注释；defs 复用 KitFormUtil.buildFields/coerce。
// 2026-07-19 反馈轮：crewForm「计薪与提成」新增指派粒度 assignLevel（班组整包/可下钻到个人，存储="班组"|"个人"，工程量指派复选树读取）
(function () {
  if (window.BaseFormsPreload) return;
  window.BaseFormsPreload = function () { return null; };
  const reg = () => {
    const KF = window.KitFormUtil;
    const A = window.APP;
    if (!KF || !A) { setTimeout(reg, 60); return; }

    // —— 通用小工具 ——
    const byName = (rows, name) => rows.find((x) => x.name === name);
    // 简称别名：存储=数组，表单=逗号分隔文本（中英文逗号/顿号均可）
    const aliasesToLabel = (v) => (Array.isArray(v) ? v.join(",") : (v || ""));
    const aliasesToValue = (s) => String(s).split(/[,，、]/).map((t) => t.trim()).filter(Boolean);

    // ============ 分供方 supplierForm（红圈实拍对标：5 分区 30 字段 + 7 附件位；新建三段式 params.type 带入类别） ============
    KF.registerForm("supplierForm", { title: "分供方", subtitle: "跨项目共享主数据 · 证照齐全后方可下单", listRoute: "supplier" }, (params) => {
      const row = params.id ? A.get("suppliers", params.id) : null;
      // 资料状态：存储 = 英文枚举（与列表 CRED chip 一致），表单显示中文
      const CRED_LABEL = { incomplete: "证照缺失", reviewing: "审核中", qualified: "合格", rejected: "退回" };
      const CRED_VALUE = { "证照缺失": "incomplete", "审核中": "reviewing", "合格": "qualified", "退回": "rejected" };
      const defs = [
        { key: "name", label: "公司全称", form: { section: "基础信息", required: true, placeholder: "营业执照上的公司全称" } },
        { key: "aliases", label: "简称别名", form: { hint: "逗号分隔多个，列表检索与发票匹配使用", toLabel: aliasesToLabel, toValue: aliasesToValue } },
        { key: "category", label: "分供方类别", form: { type: "select", required: true,
          options: ["材料供应商", "劳务分包商", "专业分包商", "设备供应商", "检测供应商", "个人", "其他"],
          value: params.type || "材料供应商" } },
        { key: "businessType", label: "经营类型", form: { type: "select", options: ["公司分供方", "零星供应商"] } },
        { key: "uniqueCode", label: "唯一识别码", form: { placeholder: "如 MA5CBX1234" } },
        { key: "taxNo", label: "统一社会信用代码", form: { placeholder: "91 开头 18 位" } },
        { key: "legalRep", label: "法定代表人", form: {} },
        { key: "registeredCapital", label: "注册资金", form: { type: "number", suffix: "万元" } },
        { key: "registeredDate", label: "注册日期", form: { type: "date" } },
        { key: "address", label: "详细地址", form: { placeholder: "注册地址 / 经营地址" } },
        { key: "taxpayerType", label: "纳税人类型", form: { type: "select", options: ["一般纳税人", "小规模纳税人"] } },
        { key: "rating", label: "评价等级", form: { type: "select", options: ["A", "B", "C", "D"] } },
        { key: "mainBusiness", label: "主营业务", form: { type: "textarea", placeholder: "如 建筑钢材、金属制品销售" } },
        { key: "contact", label: "主要联系人", form: { section: "联系人信息", required: true } },
        { key: "contactPhone", label: "联系人电话", form: {} },
        { key: "contactTitle", label: "职务", form: { placeholder: "如 销售经理" } },
        { key: "phone", label: "公司电话", form: {} },
        { key: "invoiceName", label: "开票名称", form: { section: "开票信息", placeholder: "默认与公司全称一致" } },
        { key: "bank", label: "开户行", form: {} },
        { key: "account", label: "银行账号", form: {} },
        { key: "invoiceAddr", label: "开票地址及电话", form: {} },
        { key: "licenseFiles", label: "营业执照", form: { section: "证照附件", type: "file", max: 3 } },
        { key: "legalIdFiles", label: "法人身份证", form: { type: "file", max: 3 } },
        { key: "bankPermitFiles", label: "银行开户许可证", form: { type: "file", max: 3 } },
        { key: "qualFiles", label: "资质证书", form: { type: "file", max: 9 } },
        { key: "historyFiles", label: "过往业绩合同", form: { type: "file", max: 15 } },
        { key: "brandFiles", label: "品牌授权书", form: { type: "file", max: 9 } },
        { key: "taxCreditFiles", label: "完税证明", form: { type: "file", max: 9 } },
        { key: "cred", label: "资料状态", form: { section: "状态与备注", type: "select",
          options: ["证照缺失", "审核中", "合格", "退回"],
          toLabel: (v) => CRED_LABEL[v] || v || "", toValue: (s) => CRED_VALUE[s] || s } },
        { key: "note", label: "备注", form: { type: "textarea", placeholder: "供货范围、账期等特殊约定在此说明" } },
      ];
      return {
        coll: "suppliers", entity: "sup", listRoute: "supplier", title: "分供方", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ aliases: [], category: params.type || "材料供应商", businessType: "公司分供方",
          taxpayerType: "一般纳税人", cred: "reviewing", projectCount: 0, contractTotal: 0, paidTotal: 0 }),
      };
    });

    // ============ 客户 customerForm（甲方档案：3 分区 11 字段 + 开票资料附件） ============
    KF.registerForm("customerForm", { title: "客户", subtitle: "甲方档案 · 与项目按名称关联", listRoute: "customer" }, (params) => {
      const row = params.id ? A.get("customers", params.id) : null;
      const defs = [
        { key: "name", label: "客户名称", form: { section: "基础信息", required: true, hint: "与项目「客户(甲方)」按名称关联，保持一致" } },
        { key: "aliases", label: "简称", form: { hint: "逗号分隔多个", toLabel: aliasesToLabel, toValue: aliasesToValue } },
        { key: "taxNo", label: "统一社会信用代码", form: { placeholder: "91 开头 18 位" } },
        { key: "legalRep", label: "法定代表人", form: {} },
        { key: "address", label: "注册地址", form: {} },
        { key: "invoiceName", label: "开票名称", form: { section: "开票与银行", placeholder: "默认与客户名称一致" } },
        { key: "bank", label: "开户行", form: {} },
        { key: "bankAccount", label: "银行账号", form: {} },
        { key: "contact", label: "联系人", form: { section: "联系与备注", required: true } },
        { key: "phone", label: "联系电话", form: {} },
        { key: "note", label: "备注", form: { type: "textarea" } },
        { key: "invoiceFiles", label: "开票资料", form: { type: "file", max: 9 } },
      ];
      return {
        coll: "customers", entity: "cus", listRoute: "customer", title: "客户", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ aliases: [] }),
      };
    });

    // ============ 班组 crewForm（3 分区 11 字段：计薪与提成参数为班组级默认，项目级可在详情覆盖） ============
    KF.registerForm("crewForm", { title: "班组", subtitle: "全局实体 · 跨项目复用 · 计薪参数班组级默认", listRoute: "crew" }, (params) => {
      const row = params.id ? A.get("crews", params.id) : null;
      const defs = [
        { key: "name", label: "班组名称", form: { section: "基本信息", required: true, hint: "如 泥水A班" } },
        { key: "trade", label: "工种", form: { type: "select", required: true, options: ["泥水工", "木工", "钢筋工", "水暖工", "防水工"] } },
        { key: "contact", label: "负责人", form: { required: true } },
        { key: "phone", label: "联系电话", form: { required: true } },
        { key: "payRatio", label: "默认发放比例", form: { section: "计薪与提成", type: "number", suffix: "%", hint: "默认95，工人可单独覆盖" } },
        { key: "rentSubsidy", label: "房租补贴", form: { type: "select", options: ["开启", "关闭"] } },
        { key: "rentPrice", label: "房租补贴单价", form: { type: "number", suffix: "元每㎡" } },
        { key: "mgmtFee", label: "管理提成", form: { type: "select", options: ["开启", "关闭"] } },
        { key: "mgmtPrice", label: "提成单价", form: { type: "number", suffix: "元每㎡" } },
        { key: "assignLevel", label: "指派粒度", form: { type: "select", options: ["班组整包", "可下钻到个人"],
          toLabel: (v) => v === "个人" ? "可下钻到个人" : (v === "班组" ? "班组整包" : (v || "")),
          toValue: (s) => s === "可下钻到个人" ? "个人" : "班组",
          hint: "决定工程量指派能否勾选到组内工人；泥水类默认可下钻" } },
        { key: "note", label: "备注", form: { section: "备注", type: "textarea" } },
        { key: "agreementFiles", label: "合作协议", form: { type: "file", max: 9 } },
      ];
      return {
        coll: "crews", entity: "crew", listRoute: "crew", title: "班组", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ trade: "泥水工", payRatio: 95, rentSubsidy: "关闭", mgmtFee: "关闭", assignLevel: "班组", workerCount: 0, projectCount: 0 }),
      };
    });

    // ============ 工人 workerForm（docs base-worker.md 对标：5 分区 21 字段 + 证书/证件附件） ============
    KF.registerForm("workerForm", { title: "工人", subtitle: "个人/银行/工作信息 · 三级安全教育未完成发工资标红", listRoute: "worker" }, (params) => {
      const row = params.id ? A.get("workers", params.id) : null;
      const crews = A.rows("crews");
      const projects = A.rows("projects");
      // onSite / safety：存储 = 布尔（与列表列一致），表单显示中文
      const onSiteToLabel = (v) => (v === false ? "已退场" : v === true ? "在场" : (v || ""));
      const onSiteToValue = (s) => s === "在场";
      const safetyToLabel = (v) => (v === false ? "未完成" : v === true ? "已完成" : (v || ""));
      const safetyToValue = (s) => s === "已完成";
      const defs = [
        { key: "name", label: "姓名", form: { section: "个人信息", required: true } },
        { key: "gender", label: "性别", form: { type: "select", options: ["男", "女"] } },
        { key: "idCard", label: "身份证号", form: { hint: "18位，列表脱敏显示" } },
        { key: "phone", label: "联系电话", form: { required: true } },
        { key: "hometown", label: "籍贯", form: { placeholder: "如 广东 / 梅州" } },
        { key: "emergencyContact", label: "紧急联系人", form: {} },
        { key: "emergencyPhone", label: "紧急联系电话", form: {} },
        { key: "bankName", label: "开户银行", form: { section: "银行信息", required: true, placeholder: "如 中国建设银行广州天河支行" } },
        { key: "bankAccount", label: "银行卡号", form: { required: true } },
        { key: "bankCode", label: "联行号", form: { hint: "正式版按开户行自动匹配" } },
        { key: "trade", label: "工种", form: { section: "工作信息", type: "select", required: true,
          options: ["木工", "泥工", "钢筋工", "电工", "焊工", "架子工", "油漆工", "防水工", "水暖工", "测量工", "普工", "机械操作工", "其他"] } },
        { key: "skillLevel", label: "技能等级", form: { type: "select", options: ["初级", "中级", "高级", "技师"] } },
        { key: "team", label: "所属班组", form: { type: "lookup", options: crews.map((c) => c.name) } },
        { key: "dailyWage", label: "参考日工资", form: { type: "number", suffix: "元" } },
        { key: "project", label: "当前项目", form: { section: "项目分配", type: "lookup", options: projects.map((p) => p.name) } },
        { key: "onSite", label: "在场状态", form: { type: "select", options: ["在场", "已退场"], toLabel: onSiteToLabel, toValue: onSiteToValue } },
        { key: "entryDate", label: "进场日期", form: { type: "date" } },
        { key: "exitDate", label: "退场日期", form: { type: "date" } },
        { key: "safety", label: "三级安全教育", form: { type: "select", options: ["已完成", "未完成"], hint: "未完成发工资标红",
          toLabel: safetyToLabel, toValue: safetyToValue } },
        { key: "certFiles", label: "证书扫描件", form: { section: "证书与备注", type: "file", max: 9 } },
        { key: "idFiles", label: "证件照片", form: { type: "file", max: 3 } },
        { key: "note", label: "备注", form: { type: "textarea" } },
      ];
      return {
        coll: "workers", entity: "wk", listRoute: "worker", title: "工人", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ gender: "男", trade: "普工", skillLevel: "初级", onSite: true, safety: false,
          project: "—", exitDate: "", certExp: 0, family: null }),
      };
    });

    // ============ 项目 projectForm（原 projForm 17 字段全保留 + project-info.md 增量：5 分区 25 字段） ============
    KF.registerForm("projectForm", { title: "项目", subtitle: "项目主数据 · 客户/阶段/参建单位/风控立项", listRoute: "project" }, (params) => {
      const row = params.id ? A.get("projects", params.id) : null;
      const customers = A.rows("customers");
      // 客户(甲方) = 文本名称关联（projects.developer 与 customers.name 严格同名），lookup 存名称本身
      const defs = [
        { key: "name", label: "项目名称", form: { section: "基本信息", required: true } },
        { key: "contractName", label: "项目合同名称", form: { placeholder: "如 合和新城施工总承包合同" } },
        { key: "code", label: "项目编号", form: { placeholder: "留空可后补" } },
        { key: "developer", label: "客户(甲方)", form: { type: "lookup", required: true, options: customers.map((c) => c.name),
          hint: "与客户档案按名称关联" } },
        { key: "developer2", label: "客户2", form: { type: "lookup", options: customers.map((c) => c.name) } },
        { key: "region", label: "工程地域", form: { placeholder: "广州·白云" } },
        { key: "address", label: "详细地址", form: {} },
        { key: "operationType", label: "经营类型", form: { type: "select", options: ["自营", "联营", "挂靠"] } },
        { key: "area", label: "建筑面积", form: { type: "number", suffix: "㎡" } },
        { key: "overview", label: "工程概况", form: { type: "textarea", placeholder: "楼栋数 / 层数 / 建筑面积 / 装修标准…" } },
        { key: "stage", label: "业务流程阶段", form: { section: "工期与阶段", type: "select",
          options: ["项目立项", "施工准备", "施工中", "停工", "完工及竣备", "交付", "保修", "项目完结"] } },
        { key: "startDate", label: "计划开工", form: { type: "date" } },
        { key: "planEnd", label: "计划竣工", form: { type: "date" } },
        { key: "planDays", label: "计划工期", form: { type: "number", suffix: "天" } },
        { key: "actualEnd", label: "实际竣工", form: { type: "date" } },
        { key: "manager", label: "项目经理", form: { section: "参建单位", required: true } },
        { key: "managerPhone", label: "项目经理电话", form: {} },
        { key: "execManager", label: "执行经理", form: {} },
        { key: "builder", label: "承包单位", form: {} },
        { key: "supervisor", label: "监理单位", form: {} },
        { key: "designer", label: "设计单位", form: {} },
        { key: "siteLeader", label: "现场负责人", form: {} },
        { key: "siteLeaderPhone", label: "现场负责人电话", form: {} },
        { key: "riskLevel", label: "项目风险级别", form: { section: "风控与立项", type: "select", options: ["低", "中", "高"] } },
        { key: "filingDate", label: "立项文件时间", form: { type: "date" } },
        { key: "approvalFiles", label: "立项文件", form: { type: "file", max: 9 } },
        { key: "renderFiles", label: "效果图", form: { type: "file", max: 9 } },
        { key: "note", label: "备注", form: { section: "备注", type: "textarea" } },
      ];
      return {
        coll: "projects", entity: "p", listRoute: "project", title: "项目", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "在建", stage: "施工中", operationType: "自营", riskLevel: "低" }),
      };
    });

    // ============ 目标成本 targetCostForm（3 分区 9 字段：金额基准手填，科目明细在详情页树表维护） ============
    KF.registerForm("targetCostForm", { title: "目标成本", subtitle: "预算档案 · 四级金额链源头 · 每项目一份基线", listRoute: "targetCost" }, (params) => {
      const row = params.id ? A.get("targetCosts", params.id) : null;
      const projects = A.rows("projects");
      const pName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };
      const defs = [
        { key: "name", label: "版本名", form: { section: "基本信息", required: true, placeholder: "如 开工基线" } },
        { key: "projectId", label: "项目名称", form: { type: "lookup", required: true, options: projects.map((p) => p.name),
          toLabel: (id) => pName(id), toValue: (name) => { const p = byName(projects, name); return p ? p.id : name; } } },
        { key: "isBaseline", label: "当前对比基线", form: { type: "select", options: ["是", "否"], hint: "一项目仅一条为是" } },
        { key: "incomeAmount", label: "合同收入", money: true, form: { section: "金额基准", type: "number", suffix: "元" } },
        { key: "plannedProfit", label: "计划利润", money: true, form: { type: "number", suffix: "元" } },
        { key: "signedAmount", label: "已签合同额", money: true, form: { type: "number", suffix: "元" } },
        { key: "incTotal", label: "含税合价", money: true, form: { type: "number", suffix: "元" } },
        { key: "excTotal", label: "无税合价", money: true, form: { type: "number", suffix: "元" } },
        { key: "tax", label: "税额", money: true, form: { type: "number", suffix: "元" } },
        { key: "note", label: "备注", form: { section: "备注", type: "textarea", hint: "科目明细在详情页树表维护" } },
      ];
      return {
        coll: "targetCosts", entity: "tc", listRoute: "targetCost", title: "目标成本", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ isBaseline: "是", incomeAmount: 0, plannedProfit: 0, signedAmount: 0, incTotal: 0, excTotal: 0, tax: 0 }),
      };
    });
  };
  reg();
})();
