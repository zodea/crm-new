// ScheduleForms — 施工进度与工程量配置域整页表单规格（#244 设计稿回填）。
// 注册路由：processLibraryForm 标准工序库版本（ADR 0018） / quantityRegionForm 楼栋楼层户区域配置 /
//           quantityTemplateForm 户型模板（ADR 0014：实现已从大 Dialog 迁为独立路由整页表单）
// 用法与 spec 契约同 kit/forms/BaseForms.jsx，defs 复用 KitFormUtil.buildFields/coerce。
(function () {
  if (window.ScheduleFormsPreload) return;
  window.ScheduleFormsPreload = function () { return null; };
  const reg = () => {
    const KF = window.KitFormUtil;
    const A = window.APP;
    if (!KF || !A) { setTimeout(reg, 60); return; }

    const projNames = () => A.rows("projects").map((p) => p.name);
    // 工序清单存数组、表单按行文本编辑（一行一道工序，顺序即工序顺序）
    const listToText = (v) => (Array.isArray(v) ? v.join("\n") : (v || ""));
    const textToList = (s) => String(s).split(/\r?\n/).map((t) => t.trim()).filter(Boolean);

    // ============ 标准工序库版本 processLibraryForm（ADR 0018：既有版本只读，沿用原 code 新建下一版） ============
    KF.registerForm("processLibraryForm", { title: "标准工序库版本", subtitle: "不可变版本 · 沿用原 code 新建下一版 · 建组时冻结快照", listRoute: "processLibrary" }, (params) => {
      const row = params.id ? A.get("processLibraries", params.id) : null;
      const frozen = !!row;
      const source = params.sourceId ? A.get("processLibraries", params.sourceId) : null;
      const defs = [
        { key: "code", label: "库编码", form: { section: "版本身份", type: frozen || params.code ? "readonly" : "text", saveValue: true, placeholder: "如 STD-HOME", hint: "新建下一版时沿用原 code，不另起编码" } },
        { key: "name", label: "库名称", form: { type: frozen ? "readonly" : "text", placeholder: "如 户内装修标准工序库" } },
        { key: "version", label: "版本号", form: { type: frozen ? "readonly" : "number", suffix: "版", hint: "同一 code 下递增；已保存版本只读" } },
        { key: "scope", label: "适用范围", form: { type: "select", options: ["户内装修", "公区装修", "外立面", "机电安装"] } },
        { key: "taskCount", label: "工序道数", form: { section: "工序快照", type: "readonly", compute: (vals) => textToList(vals.tasks).length + " 道" } },
        {
          key: "tasks", label: "工序清单", form: {
            type: "textarea", rows: 12, readonly: frozen,
            toLabel: listToText, toValue: textToList,
            placeholder: "一行一道工序，顺序即工序顺序：\n放线\n给排水\n墙砖粘贴\n地砖铺贴\n一遍腻子\n二遍腻子",
            hint: "建组时整库快照冻结进分组，之后改库不反写已建分组（ADR 0018）",
          },
        },
        { key: "note", label: "备注", form: { section: "备注", type: "textarea" } },
      ];
      return {
        coll: "processLibraries", entity: "pl", listRoute: "processLibrary", title: "标准工序库版本", row, readOnly: frozen,
        fields: KF.buildFields(defs, row || { ...(source || {}), code: params.code || "", version: params.version || 1, scope: source ? source.scope : "户内装修" }), coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ version: 1, scope: "户内装修", tasks: [] }),
      };
    });

    // ============ 楼栋楼层户区域配置 quantityRegionForm（无合同项目也可先配区域，ADR 0017 暂估排程前置） ============
    KF.registerForm("quantityRegionForm", { title: "项目区域配置", subtitle: "楼栋 → 楼层区间 → 户号规则 · 无合同项目也可先配", listRoute: "quantity" }, (params) => {
      const row = params.id ? A.get("quantityRegions", params.id) : null;
      const defs = [
        { key: "projectName", label: "项目", form: { section: "范围", type: "select", options: projNames() } },
        { key: "building", label: "楼栋", form: { placeholder: "如 3 号楼" } },
        { key: "floorFrom", label: "起始楼层", form: { type: "number", suffix: "层" } },
        { key: "floorTo", label: "结束楼层", form: { type: "number", suffix: "层" } },
        { key: "unitsPerFloor", label: "每层户数", form: { type: "number", suffix: "户" } },
        { key: "unitCount", label: "户数合计", form: { type: "readonly", compute: (v) => (Math.max(0, (Number(v.floorTo) || 0) - (Number(v.floorFrom) || 0) + 1) * (Number(v.unitsPerFloor) || 0)) + " 户" } },
        { key: "unitRule", label: "户号规则", form: { section: "户号", type: "select", options: ["楼层+序号（如 0301）", "楼层-序号（如 3-01）", "自定义"], hint: "生成后可在工程量矩阵里逐户改名，模板房间身份不随改名变化" } },
        { key: "unitPrefix", label: "户号前缀", form: { placeholder: "留空 = 不加前缀" } },
        { key: "note", label: "备注", form: { section: "备注", type: "textarea" } },
      ];
      return {
        coll: "quantityRegions", entity: "qr", listRoute: "quantity", title: "项目区域配置", row,
        fields: KF.buildFields(defs, row), coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ floorFrom: 1, floorTo: 1, unitsPerFloor: 2, unitRule: "楼层+序号（如 0301）" }),
      };
    });

    // ============ 户型模板 quantityTemplateForm（ADR 0014 + #198 定稿：从大 Dialog 迁为独立路由整页表单） ============
    KF.registerForm("quantityTemplateForm", { title: "户型模板", subtitle: "活链接 · 改模板即改全部挂靠户 · 模板房间身份稳定", listRoute: "quantity" }, (params) => {
      const row = params.id ? A.get("houseTypeTemplates", params.id) : null;
      const defs = [
        { key: "projectName", label: "项目", form: { section: "基本信息", type: "select", options: projNames() } },
        { key: "code", label: "户型代号", form: { placeholder: "如 A / B / C" } },
        { key: "area", label: "建筑面积", form: { type: "number", suffix: "m²" } },
        { key: "borrowFrom", label: "借用模板", form: { type: "select", options: ["不借用"].concat(A.rows("houseTypeTemplates").map((t) => t.code || "")), hint: "借用 = 一次性快照复制，之后与来源模板互不影响" } },
        {
          key: "rooms", label: "模板房间", form: {
            section: "房间", type: "textarea", rows: 8,
            toLabel: listToText, toValue: textToList,
            placeholder: "一行一间：\n客厅\n主卧\n次卧\n厨房\n卫生间\n阳台",
            hint: "房间创建后拥有稳定机器码，显示名可改而不影响既有指派；无天然房间粒度的分项归入「整户范围」",
          },
        },
        { key: "roomCount", label: "房间数", form: { type: "readonly", compute: (v) => textToList(v.rooms).length + " 间" } },
        {
          key: "lines", label: "分项与三量", form: {
            section: "明细", type: "textarea", rows: 10,
            toLabel: listToText, toValue: textToList,
            placeholder: "一行一条：工种|分项|合同量|暂估量|单位\n泥水|墙砖粘贴|48.6|50|m²\n油漆|一遍腻子|92.4|95|m²",
            hint: "现场量在户详情按算式录入并保存算式本身；合同量禁止作为工人工资应付量（CONTEXT.md「三量」）",
          },
        },
        { key: "note", label: "备注", form: { section: "备注", type: "textarea" } },
      ];
      return {
        coll: "houseTypeTemplates", entity: "htt", listRoute: "quantity", title: "户型模板", row,
        fields: KF.buildFields(defs, row), coerce: (vals) => KF.coerce(defs, vals),
        newDefaults: () => ({ borrowFrom: "不借用", rooms: [], lines: [] }),
      };
    });
  };
  reg();
})();
