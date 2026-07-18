// OwnerDocForms — 主合同/分包单据域整页表单规格（grill 决议 2026-07-18）。
// 注册路由：ownerChangeForm 甲方变洽签(变更行网格) / ownerReportForm 甲方报量(报量行网格) /
//           acceptanceForm 竣工验收·保修 / finalSettleForm 最终结算 / ownerPenaltyForm 甲方罚扣单 /
//           subChangeForm 分包变洽签 / subSettleForm 分包结算 / projPenaltyForm 项目罚扣
// 口径：收入侧（甲方变洽签/报量/验收/最终结算/甲方罚扣）合同级联只列该项目施工合同；
//       分包侧（分包变洽签/分包结算/项目罚扣）合同级联只列该项目非施工合同（分包/材采等支出侧）。
// 用法：window.KitFormUtil.registerForm(route, {title, subtitle, listRoute}, (params)=>spec)，
//       spec 契约见 kit/FormPage.jsx 头注释；defs 复用 KitFormUtil.buildFields/coerce。
(function () {
  if (window.OwnerDocFormsPreload) return;
  window.OwnerDocFormsPreload = function () { return null; };
  const reg = () => {
    const KF = window.KitFormUtil;
    const A = window.APP;
    if (!KF || !A) { setTimeout(reg, 60); return; }

    // —— 共用小工具（specFn 内取最新数据，这里只放纯函数）——
    const byName = (rows, name) => rows.find((x) => x.name === name);
    const num = (x) => Number(String(x == null ? "" : x).replace(/[^\d.\-]/g, "")) || 0;
    const fmt = (n) => Number(n || 0).toLocaleString("zh-CN");
    const autoNo = (prefix) => prefix + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + String(Math.floor(Math.random() * 900) + 100);
    const pName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };
    const cName = (id) => { const c = A.get("contracts", id); return c ? c.name : (id || ""); };
    const sName = (id) => { const s = A.get("suppliers", id); return s ? s.name : (id || ""); };
    const crName = (id) => { const c = A.get("crews", id); return c ? c.name : (id || ""); };
    // 项目 lookup（必填）字段 def
    const projDef = (projects) => ({ key: "projectId", label: "项目名称", form: {
      type: "lookup", required: true, options: projects.map((p) => p.name),
      toLabel: (id) => pName(id), toValue: (name) => { const p = byName(projects, name); return p ? p.id : name; },
    } });
    // 合同 lookup（项目级联）字段 def：contracts 已按侧别过滤好
    const contractDef = (projects, contracts, label, hint, extraForm) => ({ key: "contractId", label: label, form: Object.assign({
      type: "lookup", options: (vals) => { const p = byName(projects, vals.projectId); return contracts.filter((c) => !p || c.projectId === p.id).map((c) => c.name); },
      dependsOn: { key: "projectId", label: "项目名称" }, hint: hint,
      toLabel: (id) => cName(id), toValue: (name) => { const c = byName(contracts, name); return c ? c.id : name; },
    }, extraForm || {}) });
    // 分供方 lookup 字段 def
    const supDef = (suppliers, required) => ({ key: "supplierId", label: "乙方（分供方）", form: {
      type: "lookup", required: !!required, options: suppliers.map((s) => s.name),
      toLabel: (id) => sName(id), toValue: (name) => { const s = byName(suppliers, name); return s ? s.id : name; },
    } });

    // ============ 甲方变洽签 ownerChangeForm（收入侧，变更行网格 + 已签证才计入变更后合同额） ============
    KF.registerForm("ownerChangeForm", { title: "甲方变洽签", subtitle: "收入侧变更/签证/洽商 · 已签证计入变更后合同额", listRoute: "ownerChange" }, (params) => {
      const row = params.id ? A.get("ownerChanges", params.id) : null;
      const projects = A.rows("projects");
      const contracts = A.rows("contracts").filter((c) => c.kind === "施工");
      const defs = [
        { key: "no", label: "变更编号", form: { section: "基本信息", placeholder: "留空自动生成（BQ-YYYYMMDD-序号）" } },
        { key: "name", label: "变更名称", form: { required: true, placeholder: "如 3F 样板层墙砖改岩板" } },
        projDef(projects),
        contractDef(projects, contracts, "施工合同", "只列所选项目下的施工合同"),
        { key: "type", label: "类型", form: { type: "select", options: ["变更洽商", "现场签证", "索赔", "材料认价"] } },
        { key: "directiveNo", label: "甲方指令单编号", form: { placeholder: "甲方下发的指令/联系单编号" } },
        { key: "directiveType", label: "指令类型", form: { type: "select", options: ["下发", "变更", "补充"] } },
        { key: "date", label: "申报日期", form: { type: "date", required: true } },
        { key: "incAmount", label: "含税审定金额", money: true, form: { section: "金额", type: "number", required: true, suffix: "元" } },
        { key: "excAmount", label: "无税审定金额", money: true, form: { type: "number", suffix: "元" } },
        { key: "appliedAmount", label: "无税申报金额", money: true, form: { type: "number", suffix: "元" } },
        { key: "lines", label: "变更行明细", form: { section: "变更明细", type: "grid", gridLabel: "变更行明细", summaryKeys: ["amount"], columns: [
          { key: "name", label: "分项名称", width: 130, required: true },
          { key: "unit", label: "单位", width: 60 },
          { key: "qtyDiff", label: "调量差值", width: 90, type: "number" },
          { key: "price", label: "调价后单价", width: 90, type: "number" },
          { key: "amount", label: "变更合价", width: 100, type: "number" },
          { key: "note", label: "备注" },
        ] } },
        { key: "reason", label: "变更事由", form: { section: "事由与流转", type: "textarea", required: true, placeholder: "变更起因、涉及部位与口径说明" } },
        { key: "statusNote", label: "状态说明", form: { type: "textarea", hint: "打回原因等" } },
        { key: "status", label: "状态", form: { type: "select", options: ["草稿", "已上报", "已打回", "已签证"] } },
        { key: "ourDirective", label: "我方指令单", form: { section: "附件", type: "file", max: 9 } },
        { key: "ownerDirective", label: "甲方指令单", form: { type: "file", max: 9 } },
        { key: "quoteFiles", label: "报价与算量", form: { type: "file", max: 15 } },
        { key: "photoFiles", label: "施工照片", form: { type: "file", max: 15 } },
      ];
      return {
        coll: "ownerChanges", entity: "ownerChange", listRoute: "ownerChange", title: "甲方变洽签", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "草稿", type: "变更洽商", directiveType: "下发", appliedAmount: 0, no: autoNo("BQ-") }),
      };
    });

    // ============ 甲方报量 ownerReportForm（收入侧，报量行网格 · 合价派生 = 量 × 价） ============
    KF.registerForm("ownerReportForm", { title: "甲方报量", subtitle: "月度申报产值 · 甲方审定 · 报量行明细", listRoute: "ownerReport" }, (params) => {
      const row = params.id ? A.get("ownerReports", params.id) : null;
      const projects = A.rows("projects");
      const contracts = A.rows("contracts").filter((c) => c.kind === "施工");
      const defs = [
        { key: "no", label: "报量编号", form: { section: "基本信息", placeholder: "留空自动生成（BL-YYYYMMDD-序号）" } },
        projDef(projects),
        contractDef(projects, contracts, "施工合同", "只列所选项目下的施工合同"),
        { key: "period", label: "报量期次", form: { required: true, placeholder: "2026-06" } },
        { key: "date", label: "申报日期", form: { type: "date" } },
        { key: "reportedAmount", label: "申报产值", money: true, form: { section: "金额", type: "number", required: true, suffix: "元" } },
        { key: "auditedAmount", label: "审定产值", money: true, form: { type: "number", suffix: "元", hint: "甲方审定后回填" } },
        { key: "_diff", label: "审定差额", form: { type: "readonly", hint: "审定产值 − 申报产值",
          compute: (v) => { if (!v.auditedAmount) return ""; return fmt(Math.round((num(v.auditedAmount) - num(v.reportedAmount)) * 100) / 100); } } },
        { key: "lines", label: "报量行明细", form: { section: "报量明细", type: "grid", gridLabel: "报量行明细", summaryKeys: ["amount"], columns: [
          { key: "name", label: "分项名称", width: 130, required: true },
          { key: "unit", label: "单位", width: 60 },
          { key: "qty", label: "完成量", width: 90, type: "number" },
          { key: "price", label: "合同单价", width: 90, type: "number" },
          { key: "amount", label: "合价", width: 100, derive: (r) => { const q = num(r.qty), p = num(r.price); return q && p ? Math.round(q * p * 100) / 100 : ""; } },
        ] } },
        { key: "status", label: "状态", form: { section: "经办与备注", type: "select", options: ["草稿", "已申报", "已审定"] } },
        { key: "note", label: "备注", form: { type: "textarea" } },
        { key: "scanFile", label: "报量单扫描件", form: { type: "file", max: 9 } },
      ];
      return {
        coll: "ownerReports", entity: "ownerReport", listRoute: "ownerReport", title: "甲方报量", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "已申报", auditedAmount: 0, no: autoNo("BL-") }),
      };
    });

    // ============ 竣工验收·保修 acceptanceForm（阶段流转触发器：竣工验收单 + 保修到期确认单） ============
    KF.registerForm("acceptanceForm", { title: "竣工验收·保修", subtitle: "竣工验收单 / 保修到期确认 · 阶段流转触发", listRoute: "acceptance" }, (params) => {
      const row = params.id ? A.get("acceptances", params.id) : null;
      const projects = A.rows("projects");
      const contracts = A.rows("contracts").filter((c) => c.kind === "施工");
      const defs = [
        { key: "no", label: "单据编号", form: { section: "基本信息", placeholder: "留空自动生成（YS-YYYYMMDD-序号）" } },
        { key: "type", label: "类型", form: { type: "select", options: ["竣工验收", "保修到期确认"] } },
        { key: "name", label: "名称", form: { required: true, placeholder: "如 XX 项目样板层竣工验收" } },
        projDef(projects),
        contractDef(projects, contracts, "施工合同", "只列所选项目下的施工合同"),
        { key: "date", label: "日期", form: { type: "date", required: true } },
        { key: "estimate", label: "合同估价", money: true, form: { section: "金额与人员", type: "number", suffix: "元" } },
        { key: "acceptor", label: "验收人", form: {} },
        { key: "warrantyOwner", label: "保修负责人", form: {} },
        { key: "conclusion", label: "验收结论", form: { section: "结论与流转", type: "textarea", placeholder: "验收结论 / 保修到期确认意见" } },
        { key: "status", label: "状态", form: { type: "select", options: ["草稿", "验收中", "已验收", "保修中", "已到期"] } },
        { key: "note", label: "备注", form: { type: "textarea" } },
        { key: "files", label: "验收资料", form: { section: "附件", type: "file", max: 15 } },
      ];
      return {
        coll: "acceptances", entity: "acceptance", listRoute: "acceptance", title: "竣工验收·保修", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ type: "竣工验收", status: "验收中", no: autoNo("YS-") }),
      };
    });

    // ============ 最终结算 finalSettleForm（收入侧，与甲方最终结算 · 合同情况带出） ============
    KF.registerForm("finalSettleForm", { title: "最终结算", subtitle: "与甲方最终结算 · 关联施工合同", listRoute: "finalSettle" }, (params) => {
      const row = params.id ? A.get("finalSettles", params.id) : null;
      const projects = A.rows("projects");
      const contracts = A.rows("contracts").filter((c) => c.kind === "施工");
      const picked = (vals) => byName(contracts, vals.contractId);
      const defs = [
        { key: "no", label: "结算编号", form: { section: "基本信息", placeholder: "留空自动生成（JS-YYYYMMDD-序号）" } },
        { key: "name", label: "结算名称", form: { required: true, placeholder: "如 XX 项目工程最终结算" } },
        projDef(projects),
        contractDef(projects, contracts, "施工合同", "只列所选项目下的施工合同"),
        { key: "amount", label: "结算金额", money: true, form: { type: "number", required: true, suffix: "元" } },
        { key: "date", label: "报审日期", form: { type: "date", required: true } },
        { key: "_changed", label: "变更后合同金额", form: { section: "合同情况（带出）", type: "readonly",
          compute: (v) => { const c = picked(v); return c ? fmt(c.changed || c.amount || 0) : ""; } } },
        { key: "_paid", label: "累计收款", form: { type: "readonly",
          compute: (v) => { const c = picked(v); return c ? fmt(c.paid || 0) : ""; } } },
        { key: "_gap", label: "结算 − 收款差额", form: { type: "readonly", hint: "本单结算金额 − 合同累计收款",
          compute: (v) => { const c = picked(v); if (!c) return ""; return fmt(Math.round((num(v.amount) - (c.paid || 0)) * 100) / 100); } } },
        { key: "basis", label: "结算依据", form: { section: "结算说明", type: "textarea", placeholder: "合同条款、变更签证、报量审定等依据" } },
        { key: "diffNote", label: "差异说明", form: { type: "textarea", placeholder: "结算与合同/申报差异的说明" } },
        { key: "status", label: "状态", form: { section: "经办与备注", type: "select", options: ["草稿", "编制中", "已报审", "已审定"] } },
        { key: "note", label: "备注", form: { type: "textarea" } },
        { key: "files", label: "结算书", form: { type: "file", max: 15 } },
      ];
      return {
        coll: "finalSettles", entity: "finalSettle", listRoute: "finalSettle", title: "最终结算", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "编制中", no: autoNo("JS-") }),
      };
    });

    // ============ 甲方罚扣单 ownerPenaltyForm（收入侧，甲方对我方罚扣 · 冲减收入） ============
    KF.registerForm("ownerPenaltyForm", { title: "甲方罚扣单", subtitle: "甲方对我方罚扣 · 冲减收入", listRoute: "ownerPenalty" }, (params) => {
      const row = params.id ? A.get("ownerPenalties", params.id) : null;
      const projects = A.rows("projects");
      const contracts = A.rows("contracts").filter((c) => c.kind === "施工");
      const defs = [
        { key: "no", label: "罚扣编号", form: { section: "基本信息", placeholder: "留空自动生成（FK-YYYYMMDD-序号）" } },
        projDef(projects),
        contractDef(projects, contracts, "施工合同", "只列所选项目下的施工合同"),
        { key: "noticeNo", label: "联系单编号", form: { placeholder: "甲方罚扣联系单编号" } },
        { key: "amount", label: "罚扣金额", money: true, form: { type: "number", required: true, suffix: "元" } },
        { key: "date", label: "日期", form: { type: "date", required: true } },
        { key: "reason", label: "罚扣事由", form: { type: "textarea", required: true, placeholder: "罚扣起因、涉及部位与责任说明" } },
        { key: "appealNote", label: "申诉说明", form: { section: "申诉与流转", type: "textarea", placeholder: "对罚扣有异议时的申诉理由与进展" } },
        { key: "status", label: "状态", form: { type: "select", options: ["草稿", "申诉中", "已确认"] } },
        { key: "note", label: "备注", form: { type: "textarea" } },
        { key: "noticeFile", label: "联系单扫描件", form: { section: "附件", type: "file", max: 9 } },
      ];
      return {
        coll: "ownerPenalties", entity: "ownerPenalty", listRoute: "ownerPenalty", title: "甲方罚扣单", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "申诉中", no: autoNo("FK-") }),
      };
    });

    // ============ 分包变洽签 subChangeForm（支出侧，对分供方的增项/签证/洽商） ============
    KF.registerForm("subChangeForm", { title: "分包变洽签", subtitle: "支出侧增项/签证/洽商 · 关联分包合同", listRoute: "subChange" }, (params) => {
      const row = params.id ? A.get("subChanges", params.id) : null;
      const projects = A.rows("projects");
      const suppliers = A.rows("suppliers");
      const contracts = A.rows("contracts").filter((c) => c.kind !== "施工");   // 支出侧合同（分包/材采等）
      const defs = [
        { key: "no", label: "变更编号", form: { section: "基本信息", placeholder: "留空自动生成（FBBQ-YYYYMMDD-序号）" } },
        { key: "type", label: "类型", form: { type: "select", options: ["增项", "签证", "洽商"] } },
        projDef(projects),
        supDef(suppliers, true),
        contractDef(projects, contracts, "关联合同", "只列所选项目下的非施工合同（分包/材采等）"),
        { key: "date", label: "日期", form: { type: "date", required: true } },
        { key: "amount", label: "审批金额", money: true, form: { section: "金额", type: "number", required: true, suffix: "元" } },
        { key: "area", label: "变更面积", form: { type: "number", suffix: "㎡" } },
        { key: "audited", label: "实际审定价", money: true, form: { type: "number", suffix: "元", hint: "审定后回填" } },
        { key: "reason", label: "事由", form: { section: "事由与流转", type: "textarea", required: true, placeholder: "变更起因、涉及部位与口径说明" } },
        { key: "status", label: "状态", form: { type: "select", options: ["草稿", "已上报", "已打回", "已签证"] } },
        { key: "note", label: "备注", form: { type: "textarea" } },
        { key: "signFile", label: "签证单扫描件", form: { section: "附件", type: "file", max: 9 } },
      ];
      return {
        coll: "subChanges", entity: "subChange", listRoute: "subChange", title: "分包变洽签", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "草稿", type: "增项", audited: 0, no: autoNo("FBBQ-") }),
      };
    });

    // ============ 分包结算 subSettleForm（支出侧，付款依据 · 结算情况带出） ============
    KF.registerForm("subSettleForm", { title: "分包结算", subtitle: "分包结算台账 · 付款依据 · 关联分包合同", listRoute: "subSettle" }, (params) => {
      const row = params.id ? A.get("subSettles", params.id) : null;
      const projects = A.rows("projects");
      const suppliers = A.rows("suppliers");
      const contracts = A.rows("contracts").filter((c) => c.kind !== "施工");
      const picked = (vals) => byName(contracts, vals.contractId);
      // 往期已结算：同合同下其他结算单金额合计（编辑时剔除本单）
      const priorSettled = (c) => A.rows("subSettles").filter((s) => s.contractId === c.id && (!row || s.id !== row.id)).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
      const defs = [
        { key: "no", label: "结算编号", form: { section: "基本信息", placeholder: "留空自动生成（FBJS-YYYYMMDD-序号）" } },
        { key: "name", label: "结算名称", form: { required: true, placeholder: "如 泥水A班 6 月过程结算" } },
        projDef(projects),
        supDef(suppliers, true),
        contractDef(projects, contracts, "关联合同", "只列所选项目下的非施工合同（分包/材采等）"),
        { key: "type", label: "结算类型", form: { type: "select", options: ["过程结算", "完工结算", "零星用工"] } },
        { key: "amount", label: "结算金额", money: true, form: { section: "金额", type: "number", required: true, suffix: "元" } },
        { key: "date", label: "结算日期", form: { type: "date", required: true } },
        { key: "_changed", label: "变更后合同金额", form: { section: "结算情况（带出）", type: "readonly",
          compute: (v) => { const c = picked(v); return c ? fmt(c.changed || c.amount || 0) : ""; } } },
        { key: "_settled", label: "往期已结算", form: { type: "readonly", hint: "同合同下其他结算单合计",
          compute: (v) => { const c = picked(v); return c ? fmt(Math.round(priorSettled(c) * 100) / 100) : ""; } } },
        { key: "_ratio", label: "结算合同占比", form: { type: "readonly", hint: "（往期已结算 + 本单金额）/ 变更后合同金额",
          compute: (v) => { const c = picked(v); if (!c) return ""; const base = c.changed || c.amount || 0; return base ? Math.round(((priorSettled(c) + num(v.amount)) / base) * 1000) / 10 + "%" : "—"; } } },
        { key: "deductNote", label: "扣款说明", form: { section: "经办与备注", type: "textarea", placeholder: "罚扣抵减、水电分摊等扣款说明" } },
        { key: "status", label: "状态", form: { type: "select", options: ["草稿", "待确认", "已确认"] } },
        { key: "note", label: "备注", form: { type: "textarea" } },
        { key: "settleFile", label: "结算单", form: { type: "file", max: 9 } },
      ];
      return {
        coll: "subSettles", entity: "subSettle", listRoute: "subSettle", title: "分包结算", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "待确认", type: "过程结算", no: autoNo("FBJS-") }),
      };
    });

    // ============ 项目罚扣 projPenaltyForm（支出侧，对分供方罚款/扣款 · 结算抵扣） ============
    KF.registerForm("projPenaltyForm", { title: "项目罚扣", subtitle: "对分供方罚款/扣款 · 结算时抵扣", listRoute: "projPenalty" }, (params) => {
      const row = params.id ? A.get("projPenalties", params.id) : null;
      const projects = A.rows("projects");
      const suppliers = A.rows("suppliers");
      const crews = A.rows("crews");
      const contracts = A.rows("contracts").filter((c) => c.kind !== "施工");
      const defs = [
        { key: "no", label: "罚扣编号", form: { section: "基本信息", placeholder: "留空自动生成（XMFK-YYYYMMDD-序号）" } },
        projDef(projects),
        { key: "supplierId", label: "乙方（分供方）", form: { type: "lookup", options: suppliers.map((s) => s.name),
          toLabel: (id) => sName(id), toValue: (name) => { const s = byName(suppliers, name); return s ? s.id : name; } } },
        contractDef(projects, contracts, "关联合同", "只列所选项目下的非施工合同（分包/材采等）"),
        { key: "crewId", label: "班组", form: { type: "lookup", options: crews.map((c) => c.name), hint: "罚扣到班组时选填",
          toLabel: (id) => crName(id), toValue: (name) => { const c = byName(crews, name); return c ? c.id : name; } } },
        { key: "date", label: "日期", form: { type: "date", required: true } },
        { key: "reason", label: "罚扣事由", form: { type: "textarea", required: true, placeholder: "违规事项、涉及部位与责任认定" } },
        { key: "amount", label: "罚扣金额", money: true, form: { section: "罚扣方式", type: "number", required: true, suffix: "元" } },
        { key: "chargeMethod", label: "扣除方式", form: { type: "select", options: ["按面积扣除", "按项扣除", "按金额扣除"] } },
        { key: "deadline", label: "整改期限", form: { type: "date" } },
        { key: "rectifyNote", label: "整改说明", form: { section: "整改与流转", type: "textarea", placeholder: "整改要求、复查结果" } },
        { key: "status", label: "状态", form: { type: "select", options: ["草稿", "待抵扣", "已抵扣"] } },
        { key: "note", label: "备注", form: { type: "textarea" } },
        { key: "photoFiles", label: "罚款照片", form: { section: "附件", type: "file", max: 15 } },
      ];
      return {
        coll: "projPenalties", entity: "projPenalty", listRoute: "projPenalty", title: "项目罚扣", statusKey: "status", row,
        fields: KF.buildFields(defs, row),
        coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "待抵扣", chargeMethod: "按金额扣除", no: autoNo("XMFK-") }),
      };
    });
  };
  reg();
})();
