// MaterialForms — 材料域整页表单规格（按实现端 app/lib/material/page.ts MATERIAL_FORM_META、
// app/components/material/MaterialFormFields.vue / MaterialLineGrid.vue、MaterialFormPage.vue 校准）。
// 校准要点：
//   分区与字段 = 实现端 META.sections + FormFields 字段集；必填 = MaterialFormPage.validateRequired；
//   状态不做手选（由动作决定）：submitLabel/submitStatus 对齐实现端 postLabel（保存并提交/入库/出库/生效/确认）；
//   新建默认 status「草稿」；甲供材总控量的累计到货/累计领用为只读派生（实现端不可手工修改）。
// 注册路由：matRequisitionForm / matArrivalForm / matUseForm / matSettleForm / stockCheckForm /
//           omTotalForm / omRequisitionForm / omArrivalForm / omUseForm / omDirectForm / deliveryArchiveForm
// 用法：window.KitFormUtil.registerForm(route, {title, subtitle, listRoute}, (params)=>spec)，
//       spec 契约见 kit/FormPage.jsx 头注释；defs 复用 KitFormUtil.buildFields/coerce。
(function () {
  if (window.MaterialFormsPreload) return;
  window.MaterialFormsPreload = function () { return null; };
  const reg = () => {
    const KF = window.KitFormUtil;
    const A = window.APP;
    if (!KF || !A) { setTimeout(reg, 60); return; }

    // —— 公共助手（specFn 调用时取最新行集；仓库枚举与实现端 defaults 一致） ——
    const WAREHOUSES = ["中心仓", "合和新城现场仓"];
    const genNo = (prefix) => prefix + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + String(Math.floor(Math.random() * 900) + 100);
    const fmt = (n) => Number(n || 0).toLocaleString("zh-CN");
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const num = (v) => Number(String(v == null ? "" : v).replace(/[^\d.\-]/g, "")) || 0;
    const H = () => {
      const projects = A.rows("projects");
      const suppliers = A.rows("suppliers");
      const customers = A.rows("customers");
      const crews = (window.KIT_DATA && window.KIT_DATA.crews) || [];   // 班组仍在 KIT_DATA（未入 APP 仓），只读取名
      const matContracts = A.rows("contracts").filter((c) => c.kind === "材采");
      const byName = (rows, name) => rows.find((x) => x.name === name);
      const pName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };
      const sName = (id) => { const s = A.get("suppliers", id); return s ? s.name : (id || ""); };
      const cName = (id) => { const c = A.get("contracts", id); return c ? c.name : (id || ""); };
      // 项目 lookup（必填，id↔名称）
      const projLookup = (extra) => Object.assign({ type: "lookup", required: true, options: projects.map((p) => p.name),
        toLabel: (id) => pName(id), toValue: (name) => { const p = byName(projects, name); return p ? p.id : name; } }, extra);
      // 分供方 lookup（id↔名称）
      const supLookup = (extra) => Object.assign({ type: "lookup", options: suppliers.map((s) => s.name),
        toLabel: (id) => sName(id), toValue: (name) => { const s = byName(suppliers, name); return s ? s.id : name; } }, extra);
      // 甲供单位 lookup（客户库；实现端 customerId 必填口径）
      const custLookup = (extra) => Object.assign({ type: "lookup", options: customers.map((c) => c.name), hint: "供货甲方（客户库）" }, extra);
      // 材采合同 lookup：级联所选项目，依赖项目未填聚焦拦截（实现端 fetchContracts 按 projectId 过滤同口径）
      const matConLookup = (extra) => Object.assign({ type: "lookup",
        options: (vals) => { const p = byName(projects, vals.projectId); return matContracts.filter((c) => !p || c.projectId === p.id).map((c) => c.name); },
        dependsOn: { key: "projectId", label: "项目" },
        toLabel: (id) => cName(id), toValue: (name) => { const c = byName(matContracts, name); return c ? c.id : name; },
        hint: "只列所选项目下的材料采购合同" }, extra);
      const pickedMatCon = (vals) => byName(matContracts, vals.contractId);
      const crewLookup = (extra) => Object.assign({ type: "lookup", options: crews.map((c) => c.name), hint: "从班组库选择（可留空）" }, extra);
      return { projects, suppliers, customers, crews, matContracts, byName, pName, sName, cName, projLookup, supLookup, custLookup, matConLookup, pickedMatCon, crewLookup };
    };

    // ============ 1. 下料单 matRequisitionForm（kind=mat_requisition：要料计划；已到量/剩余量由到货事实派生，只读） ============
    KF.registerForm("matRequisitionForm", { title: "下料单", subtitle: "乙供材要料计划 · 已到量与剩余量由到货事实派生", listRoute: "matRequisition" }, (params) => {
      const row = params.id ? A.get("matRequisitions", params.id) : null;
      const h = H();
      const defs = [
        { key: "no", label: "下料单编号", form: { section: "基本信息", placeholder: "留空自动生成（XL-YYYYMMDD-序号）" } },
        { key: "projectId", label: "项目", form: h.projLookup() },
        { key: "contractId", label: "材料采购合同", form: h.matConLookup() },
        { key: "applicant", label: "申请人", form: { required: true } },
        { key: "date", label: "下料日期", form: { type: "date", required: true } },
        { key: "warehouse", label: "到货仓库", form: { type: "select", options: WAREHOUSES } },
        { key: "material", label: "材料名称", form: { section: "材料与计划", required: true, placeholder: "如 HRB400 螺纹钢 Φ12" } },
        { key: "spec", label: "规格型号", form: {} },
        { key: "unit", label: "单位", form: { required: true, placeholder: "吨 / ㎡ / m³ / 件" } },
        { key: "planQty", label: "计划量", form: { type: "number", required: true } },
        { key: "_arrived", label: "已到量（派生）", form: { type: "readonly", compute: (v) => fmt(row ? row.arrivedQty : 0), hint: "到货过账后自动回写，不可手工修改" } },
        { key: "_remain", label: "剩余未到（派生）", form: { type: "readonly", compute: (v) => fmt(num(v.planQty) - (row ? num(row.arrivedQty) : 0)) } },
        { key: "purpose", label: "用途", form: { type: "textarea", placeholder: "如 3 号楼主体钢筋" } },
        { key: "note", label: "备注", form: { section: "计划附件", type: "textarea" } },
        { key: "planFiles", label: "下料计划表", form: { type: "file", max: 9 } },
      ];
      return { coll: "matRequisitions", entity: "matRequisition", listRoute: "matRequisition", title: "下料单", statusKey: "status", row,
        submitLabel: "保存并提交", submitStatus: "已提交",
        fields: KF.buildFields(defs, row), coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "草稿", arrivedQty: 0, warehouse: "中心仓", no: genNo("XL-") }) };
    });

    // ============ 2. 材料到货 matArrivalForm（kind=mat_arrival：到货明细网格；coerce 聚合回写头字段） ============
    KF.registerForm("matArrivalForm", { title: "材料到货", subtitle: "乙供材入库事实 · 数量和金额从明细行聚合", listRoute: "matArrival" }, (params) => {
      const row = params.id ? A.get("matArrivals", params.id) : null;
      const h = H();
      const reqs = A.rows("matRequisitions");
      const reqLabel = (r) => (r.no || "") + " · " + (r.material || "");
      // 旧扁平行（无 lines）编辑时按头字段还原 1 行明细
      const seedLines = (r) => {
        if (!r) return [];
        if (Array.isArray(r.lines) && r.lines.length) return r.lines;
        if (!r.material) return [];
        return [{ material: r.material, spec: r.spec || "", unit: r.unit || "", qty: r.qty || "", price: r.qty ? r2((r.amount || 0) / r.qty) : "", note: "" }];
      };
      const defs = [
        { key: "no", label: "到货单号", form: { section: "基本信息", placeholder: "留空自动生成（DH-YYYYMMDD-序号）" } },
        { key: "projectId", label: "项目", form: h.projLookup() },
        { key: "supplierId", label: "分供方", form: h.supLookup({ required: true }) },
        { key: "contractId", label: "采购合同", form: h.matConLookup() },
        { key: "requisitionId", label: "关联下料单", form: { type: "lookup",
          options: (vals) => { const p = h.byName(h.projects, vals.projectId); return reqs.filter((r) => !p || r.projectId === p.id).map(reqLabel); },
          toLabel: (id) => { const r = reqs.find((x) => x.id === id); return r ? reqLabel(r) : (id || ""); },
          toValue: (label) => { const r = reqs.find((x) => reqLabel(x) === label); return r ? r.id : label; },
          hint: "到货对应的下料计划（过账后回写其已到量）" } },
        { key: "warehouse", label: "到货仓库", form: { type: "select", options: WAREHOUSES, required: true } },
        { key: "date", label: "到货日期", form: { type: "date", required: true } },
        { key: "receiver", label: "收货人", form: {} },
        // 明细网格列 = 实现端 MaterialLineGrid mat_arrival：材料名称/规格型号/单位/数量/含税单价/含税金额/备注
        { key: "lines", label: "到货明细", form: { section: "到货明细", type: "grid", gridLabel: "到货明细", minRows: 2,
          rows: seedLines(row), summaryKeys: ["amount"],
          columns: [
            { key: "material", label: "材料名称", width: 150, type: "text", required: true },
            { key: "spec", label: "规格型号", width: 110, type: "text" },
            { key: "unit", label: "单位", width: 66, type: "text" },
            { key: "qty", label: "数量", width: 90, type: "number", required: true },
            { key: "price", label: "含税单价", width: 96, type: "number" },
            { key: "amount", label: "含税金额", width: 110, derive: (r) => r2((Number(r.qty) || 0) * (Number(r.price) || 0)) },
            { key: "note", label: "备注", type: "text" },
          ] } },
        { key: "quality", label: "质检结论", form: { section: "质检信息", type: "select", options: ["合格", "待检"] } },
        { key: "note", label: "备注", form: { section: "送货单附件", type: "textarea" } },
        { key: "deliveryFiles", label: "送货单扫描件", form: { type: "file", max: 9 } },
      ];
      return { coll: "matArrivals", entity: "matArrival", listRoute: "matArrival", title: "材料到货", statusKey: "status", row,
        submitLabel: "保存并入库", submitStatus: "已过账",
        fields: KF.buildFields(defs, row),
        // 聚合回写：列表头字段 material（顿号拼接截断）/ qty（Σ数量）/ amount（Σ金额）由明细行推出
        coerce: (vals) => {
          const patch = KF.coerce(defs, vals);
          const lines = Array.isArray(patch.lines) ? patch.lines : null;
          if (lines && lines.length) {
            const names = lines.map((l) => l.material).filter(Boolean);
            if (names.length) patch.material = names.join("、").slice(0, 30);
            patch.qty = r2(lines.reduce((s, l) => s + (Number(l.qty) || 0), 0));
            patch.amount = r2(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0));
            if (lines[0] && lines[0].unit) patch.unit = lines[0].unit;
          }
          return patch;
        },
        newDefaults: () => ({ status: "草稿", quality: "合格", warehouse: "中心仓", amount: 0, no: genNo("DH-") }) };
    });

    // ============ 3. 材料领用 matUseForm（kind=mat_use：出库；过账前校验实时可用库存） ============
    KF.registerForm("matUseForm", { title: "材料领用", subtitle: "乙供材出库事实 · 过账前校验实时可用库存", listRoute: "matUse" }, (params) => {
      const row = params.id ? A.get("matUses", params.id) : null;
      const h = H();
      const defs = [
        { key: "no", label: "领用单号", form: { section: "基本信息", placeholder: "留空自动生成（LY-YYYYMMDD-序号）" } },
        { key: "projectId", label: "项目", form: h.projLookup() },
        { key: "warehouse", label: "领用仓库", form: { type: "select", options: WAREHOUSES, required: true } },
        { key: "date", label: "领用日期", form: { type: "date", required: true } },
        { key: "material", label: "材料名称", form: { section: "材料与领用", required: true } },
        { key: "spec", label: "规格型号", form: {} },
        { key: "unit", label: "单位", form: { required: true, placeholder: "吨 / ㎡ / m³ / 件" } },
        { key: "qty", label: "领用数量", form: { type: "number", required: true, hint: "出库过账前按仓库+材料校验实时可用库存" } },
        { key: "receiver", label: "领用人", form: { required: true } },
        { key: "crew", label: "领用班组", form: h.crewLookup() },
        { key: "useFor", label: "用途", form: { type: "textarea", placeholder: "如 3 号楼主体钢筋绑扎" } },
        { key: "note", label: "备注", form: { section: "领料单附件", type: "textarea" } },
        { key: "useFiles", label: "领料单", form: { type: "file", max: 9 } },
      ];
      return { coll: "matUses", entity: "matUse", listRoute: "matUse", title: "材料领用", statusKey: "status", row,
        submitLabel: "保存并出库", submitStatus: "已过账",
        fields: KF.buildFields(defs, row), coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "草稿", warehouse: "中心仓", no: genNo("LY-") }) };
    });

    // ============ 4. 材料采购结算 matSettleForm（合同辅助单据，实现端走 ContractAuxListScreen；不在 #199 校准范围，维持原状） ============
    KF.registerForm("matSettleForm", { title: "材料采购结算", subtitle: "按采购合同对账结算 · 扣款留痕", listRoute: "matSettle" }, (params) => {
      const row = params.id ? A.get("matSettles", params.id) : null;
      const h = H();
      const defs = [
        { key: "no", label: "结算单号", form: { section: "基本信息", placeholder: "留空自动生成（CGJS-YYYYMMDD-序号）" } },
        { key: "name", label: "结算名称", form: { required: true, placeholder: "如 钢筋采购 6 月结算" } },
        { key: "projectId", label: "项目", form: h.projLookup() },
        { key: "supplierId", label: "分供方", form: h.supLookup({ required: true }) },
        { key: "contractId", label: "采购合同", form: h.matConLookup() },
        { key: "date", label: "结算日期", form: { type: "date", required: true } },
        { key: "period", label: "结算期间", form: { placeholder: "2026-05 至 2026-06" } },
        { key: "amount", label: "结算金额", money: true, form: { section: "金额与扣款", type: "number", required: true, suffix: "元" } },
        { key: "deductNote", label: "扣款说明", form: { type: "textarea", placeholder: "质量扣款、逾期扣款等在此说明" } },
        { key: "_camount", label: "合同金额", form: { section: "合同情况（带出）", type: "readonly",
          compute: (v) => { const c = h.pickedMatCon(v); return c ? fmt(c.changed || c.amount || 0) : ""; } } },
        { key: "_paid", label: "合同累计支付", form: { type: "readonly",
          compute: (v) => { const c = h.pickedMatCon(v); return c ? fmt(c.paid || 0) : ""; } } },
        { key: "status", label: "状态", form: { section: "经办与备注", type: "select", options: ["草稿", "待确认", "已确认"] } },
        { key: "note", label: "备注", form: { type: "textarea" } },
        { key: "stmtFiles", label: "对账单", form: { type: "file", max: 9 } },
      ];
      return { coll: "matSettles", entity: "matSettle", listRoute: "matSettle", title: "材料采购结算", statusKey: "status", row,
        fields: KF.buildFields(defs, row), coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "待确认", no: genNo("CGJS-") }) };
    });

    // ============ 5. 库存盘点 stockCheckForm（kind=stock_check：盘点明细网格；账面量自动带出口径） ============
    KF.registerForm("stockCheckForm", { title: "库存盘点", subtitle: "账面量实时读取 · 仅已生效盘点差影响库存", listRoute: "stockCheck" }, (params) => {
      const row = params.id ? A.get("stockChecks", params.id) : null;
      const defs = [
        { key: "no", label: "盘点编号", form: { section: "基本信息", placeholder: "留空自动生成（PD-YYYYMMDD-序号）" } },
        { key: "warehouse", label: "仓库", form: { type: "select", options: WAREHOUSES, required: true } },
        { key: "checker", label: "盘点人", form: { required: true } },
        { key: "date", label: "盘点日期", form: { type: "date", required: true } },
        // 明细网格列 = 实现端 MaterialLineGrid stock_check：材料名称/规格型号/单位/账面量/实盘量/盈亏量/盈亏金额
        { key: "lines", label: "盘点明细", form: { section: "盘点明细", type: "grid", gridLabel: "盘点明细", minRows: 3,
          rows: (row && Array.isArray(row.lines)) ? row.lines : [], summaryKeys: ["diffAmount"],
          columns: [
            { key: "material", label: "材料名称", width: 150, type: "text", required: true },
            { key: "spec", label: "规格型号", width: 110, type: "text" },
            { key: "unit", label: "单位", width: 66, type: "text" },
            { key: "bookQty", label: "账面量", width: 90, type: "number", hint: "实现端按 仓库+材料+规格 实时读取，只读带出" },
            { key: "actualQty", label: "实盘量", width: 90, type: "number", required: true },
            { key: "diffQty", label: "盈亏量", width: 90, derive: (r) => r2((Number(r.actualQty) || 0) - (Number(r.bookQty) || 0)) },
            { key: "diffAmount", label: "盈亏金额", width: 100, type: "number" },
          ] } },
        { key: "note", label: "备注", form: { section: "盘点附件", type: "textarea" } },
        { key: "checkFiles", label: "盘点表扫描件", form: { type: "file", max: 9 } },
      ];
      return { coll: "stockChecks", entity: "stockCheck", listRoute: "stockCheck", title: "库存盘点", statusKey: "status", row,
        submitLabel: "保存并生效", submitStatus: "已生效",
        fields: KF.buildFields(defs, row),
        // 聚合回写：itemCount=有名称的明细行数、diffAmount=Σ盈亏金额（列表列显示口径）
        coerce: (vals) => {
          const patch = KF.coerce(defs, vals);
          const lines = Array.isArray(patch.lines) ? patch.lines : null;
          if (lines) {
            patch.itemCount = lines.filter((l) => l.material).length;
            patch.diffAmount = r2(lines.reduce((s, l) => s + (Number(l.diffAmount) || 0), 0));
          }
          return patch;
        },
        newDefaults: () => ({ status: "草稿", warehouse: "中心仓", itemCount: 0, diffAmount: 0, no: genNo("PD-") }) };
    });

    // ============ 6. 甲供材总控量 omTotalForm（kind=owner_control：累计到货/累计领用只读派生，不可手工修改） ============
    KF.registerForm("omTotalForm", { title: "甲供材总控量", subtitle: "总控、到货、领用三量对账 · 累计值不可手工修改", listRoute: "omTotal" }, (params) => {
      const row = params.id ? A.get("omTotals", params.id) : null;
      const h = H();
      const defs = [
        { key: "no", label: "总控编号", form: { section: "基本信息", placeholder: "留空自动生成（JGZK-YYYYMMDD-序号）" } },
        { key: "projectId", label: "项目", form: h.projLookup() },
        { key: "party", label: "甲供单位", form: h.custLookup({ required: true }) },
        { key: "material", label: "甲供材料", form: { section: "控制量", required: true } },
        { key: "spec", label: "规格型号", form: {} },
        { key: "unit", label: "单位", form: { required: true, placeholder: "台 / ㎡ / m³" } },
        { key: "totalQty", label: "总控量", form: { type: "number", required: true } },
        { key: "_arrived", label: "累计到货（派生）", form: { type: "readonly", compute: () => fmt(row ? row.arrivedQty : 0), hint: "到货过账后自动累计，不可手工修改" } },
        { key: "_used", label: "累计领用（派生）", form: { type: "readonly", compute: () => fmt(row ? row.usedQty : 0), hint: "领用过账后自动累计，不可手工修改" } },
        { key: "_remain", label: "剩余可用（派生）", form: { type: "readonly",
          compute: (v) => fmt(num(v.totalQty) - (row ? num(row.usedQty) : 0)), hint: "剩余 = 总控量 − 累计领用" } },
        { key: "note", label: "备注", form: { section: "备注", type: "textarea" } },
      ];
      return { coll: "omTotals", entity: "omTotal", listRoute: "omTotal", title: "甲供材总控量", statusKey: "status", row,
        submitLabel: "保存并生效", submitStatus: "已生效",
        fields: KF.buildFields(defs, row), coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "草稿", arrivedQty: 0, usedQty: 0, no: genNo("JGZK-") }) };
    });

    // ============ 7. 甲供材下料单 omRequisitionForm（kind=owner_requisition） ============
    KF.registerForm("omRequisitionForm", { title: "甲供材下料单", subtitle: "向甲方要料 · 项目与材料计划", listRoute: "omRequisition" }, (params) => {
      const row = params.id ? A.get("omRequisitions", params.id) : null;
      const h = H();
      const defs = [
        { key: "no", label: "下料单编号", form: { section: "基本信息", placeholder: "留空自动生成（JGXL-YYYYMMDD-序号）" } },
        { key: "projectId", label: "项目", form: h.projLookup() },
        { key: "applicant", label: "申请人", form: { required: true } },
        { key: "date", label: "申请日期", form: { type: "date", required: true } },
        { key: "material", label: "甲供材料", form: { section: "材料与计划", required: true } },
        { key: "spec", label: "规格型号", form: {} },
        { key: "unit", label: "单位", form: { required: true, placeholder: "台 / ㎡ / m³" } },
        { key: "planQty", label: "计划量", form: { type: "number", required: true } },
        { key: "note", label: "备注", form: { section: "计划附件", type: "textarea" } },
        { key: "planFiles", label: "下料计划表", form: { type: "file", max: 9 } },
      ];
      return { coll: "omRequisitions", entity: "omRequisition", listRoute: "omRequisition", title: "甲供材下料单", statusKey: "status", row,
        submitLabel: "保存并提交", submitStatus: "已提交",
        fields: KF.buildFields(defs, row), coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "草稿", no: genNo("JGXL-") }) };
    });

    // ============ 8. 甲供材到货 omArrivalForm（kind=owner_arrival：到货量不得超过总控量） ============
    KF.registerForm("omArrivalForm", { title: "甲供材到货", subtitle: "甲供入库 · 到货量不得超过总控量", listRoute: "omArrival" }, (params) => {
      const row = params.id ? A.get("omArrivals", params.id) : null;
      const h = H();
      const defs = [
        { key: "no", label: "到货单号", form: { section: "基本信息", placeholder: "留空自动生成（JGDH-YYYYMMDD-序号）" } },
        { key: "projectId", label: "项目", form: h.projLookup() },
        { key: "warehouse", label: "仓库", form: { type: "select", options: WAREHOUSES, required: true } },
        { key: "date", label: "到货日期", form: { type: "date", required: true } },
        { key: "receiver", label: "收货人", form: {} },
        { key: "material", label: "甲供材料", form: { section: "材料与质检", required: true } },
        { key: "spec", label: "规格型号", form: {} },
        { key: "unit", label: "单位", form: { required: true, placeholder: "台 / ㎡ / m³" } },
        { key: "qty", label: "到货数量", form: { type: "number", required: true, hint: "入库过账时校验不得超过该材料总控量" } },
        { key: "quality", label: "质检结论", form: { type: "select", options: ["合格", "待检"] } },
        { key: "note", label: "备注", form: { section: "送货单附件", type: "textarea" } },
        { key: "deliveryFiles", label: "送货单", form: { type: "file", max: 9 } },
      ];
      return { coll: "omArrivals", entity: "omArrival", listRoute: "omArrival", title: "甲供材到货", statusKey: "status", row,
        submitLabel: "保存并入库", submitStatus: "已过账",
        fields: KF.buildFields(defs, row), coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "草稿", quality: "合格", warehouse: "中心仓", no: genNo("JGDH-") }) };
    });

    // ============ 9. 甲供材领用 omUseForm（kind=owner_use：同时校验库存与总控余量） ============
    KF.registerForm("omUseForm", { title: "甲供材领用", subtitle: "甲供出库 · 同时校验库存与总控余量", listRoute: "omUse" }, (params) => {
      const row = params.id ? A.get("omUses", params.id) : null;
      const h = H();
      const defs = [
        { key: "no", label: "领用单号", form: { section: "基本信息", placeholder: "留空自动生成（JGLY-YYYYMMDD-序号）" } },
        { key: "projectId", label: "项目", form: h.projLookup() },
        { key: "date", label: "领用日期", form: { type: "date", required: true } },
        { key: "material", label: "甲供材料", form: { section: "材料与领用", required: true } },
        { key: "unit", label: "单位", form: { required: true, placeholder: "台 / ㎡ / m³" } },
        { key: "qty", label: "领用数量", form: { type: "number", required: true, hint: "出库过账时同时校验库存与总控余量" } },
        { key: "receiver", label: "领用人", form: { required: true } },
        { key: "crew", label: "领用班组", form: h.crewLookup() },
        { key: "useFor", label: "用途", form: { type: "textarea", placeholder: "如 1-2 号楼门窗安装" } },
        { key: "note", label: "备注", form: { section: "备注", type: "textarea" } },
      ];
      return { coll: "omUses", entity: "omUse", listRoute: "omUse", title: "甲供材领用", statusKey: "status", row,
        submitLabel: "保存并出库", submitStatus: "已过账",
        fields: KF.buildFields(defs, row), coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "草稿", no: genNo("JGLY-") }) };
    });

    // ============ 10. 直入直出 omDirectForm（kind=owner_direct：到货与领用同时留事实，不入库） ============
    KF.registerForm("omDirectForm", { title: "甲供材直入直出", subtitle: "不入库直供直用 · 到货与领用同时留事实", listRoute: "omDirect" }, (params) => {
      const row = params.id ? A.get("omDirects", params.id) : null;
      const h = H();
      const defs = [
        { key: "no", label: "单据编号", form: { section: "基本信息", placeholder: "留空自动生成（JGZR-YYYYMMDD-序号）" } },
        { key: "projectId", label: "项目", form: h.projLookup() },
        { key: "party", label: "甲供单位", form: h.custLookup({ required: true }) },
        { key: "date", label: "日期", form: { type: "date", required: true } },
        { key: "material", label: "甲供材料", form: { section: "材料与去向", required: true } },
        { key: "unit", label: "单位", form: { required: true, placeholder: "m³ / 桶 / 套" } },
        { key: "qty", label: "数量", form: { type: "number", required: true, hint: "确认后同时计入累计到货与累计领用，不进仓库库存" } },
        { key: "useFor", label: "用途", form: { placeholder: "如 3 号楼直供直浇" } },
        { key: "usePlace", label: "使用部位", form: { required: true, placeholder: "如 3 号楼梁板 / 南区卫生间" } },
        { key: "note", label: "备注", form: { section: "签收附件", type: "textarea" } },
        { key: "signFiles", label: "签收单", form: { type: "file", max: 9 } },
      ];
      return { coll: "omDirects", entity: "omDirect", listRoute: "omDirect", title: "甲供材直入直出", statusKey: "status", row,
        submitLabel: "保存并确认", submitStatus: "已确认",
        fields: KF.buildFields(defs, row), coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ status: "草稿", no: genNo("JGZR-") }) };
    });

    // ============ 11. 送货单归档行 deliveryArchiveForm（#201 已校准：归档不是终态，归属+单据字段全量可改，文件名/OCR 只读留痕） ============
    KF.registerForm("deliveryArchiveForm", { title: "送货单归档", subtitle: "归档行编辑 · 改归属与单据字段（弹二次确认口径的整页版）", listRoute: "deliveryArchive" }, (params) => {
      const row = params.id ? A.get("deliveryArchives", params.id) : null;
      const h = H();
      const defs = [
        { key: "_name", label: "文件名", form: { section: "档案信息", type: "readonly", compute: () => (row ? row.name : "—") } },
        { key: "_ocr", label: "OCR 识别公司", form: { type: "readonly", compute: () => (row ? row.ocrCompany : "—"), hint: "识别原文仅留痕，不随归属修改" } },
        { key: "projectId", label: "项目", form: Object.assign(h.projLookup(), { section: "归属" }) },
        { key: "supplierId", label: "分供方", form: h.supLookup({ hint: "留空 = 未区分分供方（左树 ⚠ 兜底节点）" }) },
        { key: "no", label: "送货单号", form: { section: "单据字段" } },
        { key: "date", label: "送货日期", form: { type: "date" } },
        { key: "material", label: "材料摘要", form: { placeholder: "如 HRB400 螺纹钢 Φ12 / 120 吨" } },
        { key: "amount", label: "金额", money: true, form: { type: "number", suffix: "元" } },
        { key: "note", label: "备注", form: { section: "备注", type: "textarea" } },
      ];
      return { coll: "deliveryArchives", entity: "da", listRoute: "deliveryArchive", title: "送货单归档", row,
        fields: KF.buildFields(defs, row), coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({}) };
    });
  };
  reg();
})();
