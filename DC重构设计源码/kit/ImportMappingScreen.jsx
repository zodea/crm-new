// ImportMappingScreen — 通用导入映射（按实现端 app/pages/import/mapping/[entity].vue 校准，#205）。
// 关键结构（与实现端逐块对应）：
//   页头        ：Import workflow 眉标 + 「导入映射」标题 + 「{实体} · 模板驱动，源列映射到系统字段」副标
//                 + 右侧「独立页签 · 完成后自动关闭」chip；没有返回按钮 —— 离开只走「取消」（关闭页签）。
//   步骤条      ：ProcessStepper（app/components/ui/ProcessStepper.vue 复刻）三步 上传 / 映射 / 预览导入，
//                 含「处理进度」细进度条与每步状态副标（等待中/进行中/已完成/失败）；纯展示，不可点击跳步。
//   上传步      ：ImportUploadStep.vue —— 虚线拖放区 + 「正在解析文件…」状态行；右下仅「取消」。
//   映射步      ：ImportMappingStep.vue —— 以模板字段为主轴的四列清单（字段 / 源列下拉 / 三色态 chip / 待确认「确认」），
//                 表下「同一源列被多个字段使用」与「未使用的源列」提示；页脚必填门控 + 取消/重新上传/下一步。
//   预览导入步  ：ImportPreviewStep.vue —— 前 200 行预览表 + 行级「删除」剔除异实体行（导入开始后锁定）+
//                 「导入进度」done/total 条 + 失败面板「重试失败行」续导（已成功行不重复）+ 页脚 取消/上一步/开始导入。
//   未登记实体  ：路由参数不在注册表 → 警示空态「导入实体未登记」+「关闭此页签」。
// 与 2026-07-30 文字规格版的差异：实现端没有「可导入统计卡 / 返回来源列表按钮 / 自动匹配·人工指定标注 /
// 源列在左版式」，一律删除；三色态、必填门控、失败续导、页脚门控文案按实现端补齐。
// 行级拒绝清单为 #70 US45 目标态（2026-08-01 裁定：确认需要，实现端 useImportRunner 待补逐行校验）：
//   validateRow 逐行校验，不过 → 整行拒绝进清单并继续（不阻断）；完成后有拒绝行则不自动关页签，
//   展示 行号/关键值/拒绝原因 清单 + 下载拒绝清单。瞬时故障（FAIL 前缀）仍走「失败停+续导」，两者语义并存。
// 演示数据内置于本屏（匿名虚构），不改 data.js：
//   - supplier 实体字段取实现端 import-entities.ts SUPPLIER_FIELDS 的匿名子集；末行公司全称为空 → 行级拒绝；
//   - invoice 实体在实现端注册表尚未登记（#70 US45 待开发），按同一通用结构预演；末行缺归属 → 整行拒绝；
//   - 「匹配标识」以 FAIL 开头的行首次写入失败、重试成功 —— 对应实现端 demo-supplier 的失败续导旅程。
// 设计稿运行时：取消/导入完成后 navigate 回来源列表，模拟实现端「关闭页签并回到上一页签」。
(function () {
  if (window.ImportMappingScreen) return;

  // —— 视口宽 hook：折算实现端 36rem 容器查询（侧栏约 260px + 版心留白 → 视口 960px 以下折叠映射行）——
  const useVw = () => {
    const [vw, setVw] = React.useState(window.innerWidth);
    React.useEffect(() => {
      const onR = () => setVw(window.innerWidth);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }, []);
    return vw;
  };

  // —— 演示实体注册表（实现端 app/lib/kit/import-entities.ts 的匿名投影；键即路由参数）——
  const ENTITIES = {
    // 分供方：实现端已登记实体（SUPPLIER_FIELDS 子集 + 预留「外部旧ID / 匹配标识」对账列）
    supplier: {
      key: "supplier", label: "分供方", back: "supplier",
      file: "分供方台账-旧系统导出.xlsx",
      fields: [
        { key: "name", label: "公司全称", required: true, aliases: ["分供方名称", "供应商名称", "名称"] },
        { key: "supplierCategory", label: "分供方类别", aliases: ["类别", "合作类别"] },
        { key: "aliases", label: "简称/别名", aliases: ["简称", "别名"] },
        { key: "uniqueCode", label: "统一社会信用代码", aliases: ["信用代码"] },
        { key: "legalRep", label: "法定代表人", aliases: ["法人"] },
        { key: "contact", label: "主要联系人", aliases: ["联系人"] },
        { key: "contactPhone", label: "联系方式", aliases: ["联系电话", "手机号"] },
        { key: "note", label: "备注" },
        { key: "externalRef", label: "外部旧ID / 匹配标识", aliases: ["匹配标识", "外部旧ID", "旧ID"] },
      ],
      // 「供应商」列只能包含匹配到「供应商名称」→ 待确认；「开票资料」无对应字段 → 未使用源列
      columns: ["供应商", "类别", "简称", "信用代码", "法人", "联系人", "联系电话", "开票资料", "匹配标识"],
      rows: [
        { "供应商": "晟华建材有限公司", "类别": "材料供应", "简称": "晟华", "信用代码": "913100000000000101", "法人": "陈志明", "联系人": "陈志明", "联系电话": "13800000101", "开票资料": "增值税专用发票", "匹配标识": "LG-S01" },
        { "供应商": "恒瑞劳务有限公司", "类别": "劳务分包", "简称": "恒瑞", "信用代码": "913100000000000102", "法人": "李国强", "联系人": "李强", "联系电话": "13800000102", "开票资料": "增值税专用发票", "匹配标识": "LG-S02" },
        { "供应商": "广达机电设备租赁部", "类别": "机械租赁", "简称": "广达机电", "信用代码": "913100000000000103", "法人": "王建军", "联系人": "王军", "联系电话": "13800000103", "开票资料": "普通发票", "匹配标识": "LG-S03" },
        { "供应商": "明诚检测技术有限公司", "类别": "检测服务", "简称": "明诚检测", "信用代码": "913100000000000104", "法人": "赵敏", "联系人": "赵敏", "联系电话": "13800000104", "开票资料": "增值税专用发票", "匹配标识": "LG-S04" },
        { "供应商": "宏图钢结构工程有限公司", "类别": "专业分包", "简称": "宏图钢构", "信用代码": "913100000000000105", "法人": "孙立", "联系人": "孙立", "联系电话": "13800000105", "开票资料": "增值税专用发票", "匹配标识": "LG-S05" },
        { "供应商": "泰安商品混凝土有限公司", "类别": "材料供应", "简称": "泰安商砼", "信用代码": "913100000000000106", "法人": "刘泰", "联系人": "刘泰", "联系电话": "13800000106", "开票资料": "增值税专用发票", "匹配标识": "LG-S06" },
        // FAIL 前缀：首次写入失败、重试成功（对应实现端 demo-supplier 的演示瞬时故障）
        { "供应商": "众邦装饰工程有限公司", "类别": "专业分包", "简称": "众邦装饰", "信用代码": "913100000000000107", "法人": "周奕", "联系人": "周奕", "联系电话": "13800000107", "开票资料": "普通发票", "匹配标识": "FAIL-S07" },
        { "供应商": "川南幕墙科技有限公司", "类别": "专业分包", "简称": "川南幕墙", "信用代码": "913100000000000108", "法人": "吴刚", "联系人": "吴刚", "联系电话": "13800000108", "开票资料": "增值税专用发票", "匹配标识": "LG-S08" },
        // 行级拒绝演示（#70 US45 目标态）：必填「公司全称」为空 → 整行拒绝进清单，不阻断其余行
        { "供应商": "", "类别": "材料供应", "简称": "未名建材", "信用代码": "913100000000000109", "法人": "钱枫", "联系人": "钱枫", "联系电话": "13800000109", "开票资料": "普通发票", "匹配标识": "LG-S09" },
      ],
      // 逐行校验（实现端 useImportRunner 待补的行级拒绝口径；返回 null=通过 / 字符串=拒绝原因）
      validateRow: (r) => (!r.name ? "必填字段「公司全称」为空，整行拒绝" : null),
    },
    // 发票台账：实现端注册表尚未登记（#70 US45 待开发），按目标态预演同一通用结构；
    // 「缺归属整行拒绝」以 validateRow 演示（2026-08-01 裁定：行级拒绝确认需要，实现端补齐）。
    invoice: {
      key: "invoice", label: "发票台账", back: "invoiceLedger",
      file: "发票台账_2026-06.xlsx",
      fields: [
        { key: "number", label: "单据编号", required: true, aliases: ["发票号码", "票号"] },
        { key: "date", label: "开票日期", required: true, aliases: ["日期"] },
        { key: "buyer", label: "购买方", required: true, aliases: ["购方"] },
        { key: "seller", label: "供应商", required: true, aliases: ["销方名称", "销售方"] },
        { key: "total", label: "价税合计", required: true },
        { key: "tax", label: "税额", required: true },
        { key: "type", label: "票据类型", aliases: ["发票类型"] },
        { key: "project", label: "对应归属", required: true, aliases: ["项目", "归属"] },
        { key: "externalRef", label: "外部旧ID / 匹配标识", aliases: ["匹配标识", "外部旧ID", "旧ID"] },
      ],
      // 「购方名称」只能包含匹配到「购方」→ 待确认；「经办人」无对应字段 → 未使用源列
      columns: ["发票号码", "开票日期", "购方名称", "销方名称", "价税合计", "税额", "发票类型", "项目", "经办人"],
      rows: [
        { "发票号码": "04400000011", "开票日期": "2026-06-03", "购方名称": "瑞航建设集团有限公司", "销方名称": "晟华建材有限公司", "价税合计": "56500.00", "税额": "6500.00", "发票类型": "增值税专用发票", "项目": "云悦府一期", "经办人": "何静" },
        { "发票号码": "04400000012", "开票日期": "2026-06-05", "购方名称": "瑞航建设集团有限公司", "销方名称": "恒瑞劳务有限公司", "价税合计": "103000.00", "税额": "3000.00", "发票类型": "增值税专用发票", "项目": "云悦府一期", "经办人": "何静" },
        { "发票号码": "04400000013", "开票日期": "2026-06-11", "购方名称": "瑞航建设集团有限公司", "销方名称": "广达机电设备租赁部", "价税合计": "20600.00", "税额": "600.00", "发票类型": "普通发票", "项目": "临江商务楼", "经办人": "郑一鸣" },
        { "发票号码": "04400000014", "开票日期": "2026-06-16", "购方名称": "瑞航建设集团有限公司", "销方名称": "明诚检测技术有限公司", "价税合计": "10600.00", "税额": "600.00", "发票类型": "增值税专用发票", "项目": "临江商务楼", "经办人": "郑一鸣" },
        { "发票号码": "04400000015", "开票日期": "2026-06-21", "购方名称": "瑞航建设集团有限公司", "销方名称": "泰安商品混凝土有限公司", "价税合计": "226000.00", "税额": "26000.00", "发票类型": "增值税专用发票", "项目": "云悦府一期", "经办人": "何静" },
        { "发票号码": "04400000016", "开票日期": "2026-06-28", "购方名称": "瑞航建设集团有限公司", "销方名称": "宏图钢结构工程有限公司", "价税合计": "339000.00", "税额": "39000.00", "发票类型": "增值税专用发票", "项目": "临江商务楼", "经办人": "郑一鸣" },
        // 缺归属整行拒绝演示（#70 US45）：「项目」为空 → 该行拒绝进清单，其余行照常写入
        { "发票号码": "04400000017", "开票日期": "2026-06-30", "购方名称": "瑞航建设集团有限公司", "销方名称": "众邦装饰工程有限公司", "价税合计": "41200.00", "税额": "1200.00", "发票类型": "普通发票", "项目": "", "经办人": "何静" },
      ],
      validateRow: (r) => (!r.project ? "缺归属：未指定对应项目，整行拒绝" : null),
    },
  };

  // —— 智能预匹配（实现端 import-mapping.ts autoMatchColumns 同构）：
  //    先按标签/别名精确认领（confirmed=已匹配），再按包含关系给建议（suggested=待确认）；同一源列只认领一次。
  const norm = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, "");
  const namesOf = (f) => [f.label].concat(f.aliases || []).map(norm);
  function autoMatch(columns, fields) {
    const mapping = {}; const claimed = {};
    fields.forEach((f) => {
      const names = namesOf(f);
      const col = columns.find((c) => !claimed[c] && names.indexOf(norm(c)) > -1);
      if (col) { mapping[f.key] = { column: col, confidence: "confirmed" }; claimed[col] = 1; }
    });
    fields.forEach((f) => {
      if (mapping[f.key]) return;
      const names = namesOf(f);
      const col = columns.find((c) => {
        if (claimed[c]) return false;
        const n = norm(c);
        return names.some((m) => m.length >= 2 && n.length >= 2 && (n.indexOf(m) > -1 || m.indexOf(n) > -1));
      });
      if (col) { mapping[f.key] = { column: col, confidence: "suggested" }; claimed[col] = 1; }
    });
    return mapping;
  }

  // —— 三色态（ADR 0005 / 实现端 computeFieldStatus）：--brand 已匹配 / --warn 待确认 / --danger 必填缺失；未映射为中性 ——
  const STATUS_CHIP = {
    "matched": { label: "已匹配", bg: "var(--brand-soft)", color: "var(--brand-deep)" },
    "pending": { label: "待确认", bg: "var(--warn-soft)", color: "var(--warn-ink)" },
    "required-missing": { label: "必填缺失", bg: "var(--danger-soft)", color: "var(--danger-ink)" },
    "unmapped": { label: "未映射", bg: "var(--surface-3)", color: "var(--ink-faint)" },
  };
  const fieldStatus = (mapping, f) => {
    const m = mapping[f.key];
    if (m) return m.confidence === "confirmed" ? "matched" : "pending";
    return f.required ? "required-missing" : "unmapped";
  };

  // —— ProcessStepper 复刻（实现端 app/components/ui/ProcessStepper.vue）：
  //    「处理进度」细进度条（active 记半步）+ 每步圆标（✓/✗/脉冲点/序号）+ 状态副标；纯展示不可点击。
  //    ExportConfigScreen.jsx 内有同构副本 —— 设计稿运行时无共享模块，各屏自带。
  const STEP_STYLE = {
    pending: { label: "等待中", border: "var(--line)", bg: "var(--panel)", text: "var(--ink-faint)", weight: 500, bar: "var(--line)" },
    active: { label: "进行中", border: "var(--brand)", bg: "var(--brand-soft)", text: "var(--brand-deep)", weight: 700, bar: "var(--brand)" },
    completed: { label: "已完成", border: "var(--ok)", bg: "var(--ok-soft)", text: "var(--ok-ink)", weight: 600, bar: "var(--ok)" },
    failed: { label: "失败", border: "var(--danger)", bg: "var(--danger-soft)", text: "var(--danger-ink)", weight: 600, bar: "var(--danger)" },
  };
  // 细进度条原子（实现端 ProgressBar.vue：6px 圆角轨道，brand/ok/danger 三色）
  function Track({ percent, tone }) {
    const color = tone === "danger" ? "var(--danger)" : tone === "ok" ? "var(--ok)" : "var(--brand)";
    return (
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
        style={{ height: 6, borderRadius: 999, background: "var(--surface-3)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: percent + "%", borderRadius: 999, background: color, transition: "width var(--dur-fast) var(--ease-snappy)" }} />
      </div>
    );
  }
  function ProcessStepper({ steps }) {
    const { Icon } = window.DesignSystem_e3d871 || {};
    const done = steps.filter((s) => s.status === "completed").length;
    const active = steps.find((s) => s.status === "active");
    const failed = steps.find((s) => s.status === "failed");
    const percent = steps.length ? Math.round(Math.min((done + (failed || !active ? 0 : 0.5)) / steps.length, 1) * 100) : 0;
    const tone = failed ? "danger" : steps.length && done === steps.length ? "ok" : "brand";
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6, fontSize: 12 }}>
          <span style={{ fontWeight: 600, color: "var(--ink-soft)" }}>处理进度</span>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }} aria-live="polite">{percent}%</span>
        </div>
        <Track percent={percent} tone={tone} />
        <ol style={{ display: "flex", alignItems: "flex-start", listStyle: "none", margin: "16px 0 0", padding: 0 }} aria-label="处理步骤">
          {steps.map((s, i) => {
            const st = STEP_STYLE[s.status] || STEP_STYLE.pending;
            return (
              <li key={s.id} data-state={s.status} aria-current={s.status === "active" ? "step" : undefined}
                style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center" }}>
                {i > 0 ? (
                  <span aria-hidden="true" style={{ position: "absolute", right: "50%", top: 12, height: 2, width: "100%", transform: "translateY(-50%)", background: st.bar }} />
                ) : null}
                <span aria-hidden="true" style={{ position: "relative", zIndex: 1, display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: 999, border: "1px solid " + st.border, background: st.bg, fontSize: 11, fontWeight: 700, color: st.text }}>
                  {s.status === "completed" && Icon ? <Icon name="check" size={14} color="var(--ok)" />
                    : s.status === "failed" && Icon ? <Icon name="x" size={14} color="var(--danger)" />
                    : s.status === "active" ? <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--brand)" }} />
                    : i + 1}
                </span>
                <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: st.weight, color: st.text }}>{s.label}</span>
                <span style={{ fontSize: 10, color: st.text }}>{st.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  // —— 向导步态投影（实现端 importStepperSteps）：导入执行只发生在第三步 ——
  const IMPORT_STEPS = [
    { id: "upload", label: "上传" },
    { id: "mapping", label: "映射" },
    { id: "preview-import", label: "预览导入" },
  ];
  function importSteps(current, runPhase) {
    const idx = IMPORT_STEPS.findIndex((s) => s.id === current);
    return IMPORT_STEPS.map((s, i) => {
      if (i < idx) return { id: s.id, label: s.label, status: "completed" };
      if (i > idx) return { id: s.id, label: s.label, status: "pending" };
      if (s.id !== "preview-import" || runPhase === "idle") return { id: s.id, label: s.label, status: "active" };
      return { id: s.id, label: s.label, status: runPhase === "running" ? "active" : runPhase };
    });
  }

  // 原生下拉复刻实现端 field-input（映射步源列选择与其同款）
  const SEL = {
    width: "100%", minWidth: 0, height: 32, padding: "0 10px", fontSize: 13,
    border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)",
    background: "var(--panel)", color: "var(--ink)", cursor: "pointer",
  };

  function ImportMappingScreen({ navigate, params }) {
    const { Panel, Button, Icon } = window.DesignSystem_e3d871 || {};
    const UI = window.KitUI || { toast: function () {} };
    const P = Panel || "div";
    const vw = useVw();
    const narrow = vw < 960;

    // 实现端在页签创建时捕获实体身份；无参直开（侧栏演示入口）用分供方，未知键走「未登记」空态
    const entityKey = (params || {}).entity;
    const cfg = entityKey == null ? ENTITIES.supplier : ENTITIES[entityKey];

    const [step, setStep] = React.useState("upload");
    const [parsing, setParsing] = React.useState(false);
    const [sheet, setSheet] = React.useState(null);          // { columns, rows }
    const [mapping, setMapping] = React.useState({});        // 字段 key → { column, confidence }
    const [excluded, setExcluded] = React.useState({});      // 原始行号 → true（删除按它记账，不随过滤位移）
    const [run, setRun] = React.useState({ phase: "idle", done: 0, total: 0, error: null });
    const [rejected, setRejected] = React.useState([]);      // 行级拒绝清单（#70 US45 目标态）
    const rt = React.useRef({ rows: [], done: 0, rejected: [] }); // 运行游标（重试从失败行续导）
    const failedOnce = React.useRef({});                     // FAIL 行首次失败记账（重试成功）
    const timer = React.useRef(null);
    // 对应实现端 onUnmounted → runner.cancel()：离开本屏即停止推进
    React.useEffect(() => () => clearTimeout(timer.current), []);

    // —— 未登记实体空态（实现端 getImportEntity 未命中分支，文案逐字一致）——
    if (!cfg) {
      return (
        <div style={{ maxWidth: 896, margin: "0 auto", minWidth: 0 }}>
          <P role="alert" style={{ padding: 24, textAlign: "center", borderColor: "rgba(217,119,6,0.4)", background: "var(--warn-soft)" }}>
            {Icon ? <Icon name="file-warning" size={28} color="var(--warn)" style={{ margin: "0 auto 8px" }} /> : null}
            <h1 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--warn-ink)" }}>导入实体未登记</h1>
            <p style={{ maxWidth: 480, margin: "8px auto 0", fontSize: 12, color: "var(--ink-soft)" }}>
              「{String(entityKey)}」不在导入实体注册表中，请从对应实体的列表页重新发起导入。
            </p>
            {Button ? <Button style={{ marginTop: 16 }} onClick={() => navigate("home")}>关闭此页签</Button> : null}
          </P>
        </div>
      );
    }

    const fields = cfg.fields;

    // —— 派生态（实现端 computeFieldStatus / listMissingRequiredFields / buildImportRows 同构）——
    const missingRequired = fields.filter((f) => f.required && !mapping[f.key]);
    const allRows = (sheet ? sheet.rows : []).map((row) => {
      const mapped = {};
      fields.forEach((f) => {
        const m = mapping[f.key];
        if (m && Object.prototype.hasOwnProperty.call(row, m.column)) mapped[f.key] = row[m.column];
      });
      return mapped;
    });
    const kept = allRows.map((row, index) => ({ index, row })).filter((e) => !excluded[e.index]);
    const removedCount = Object.keys(excluded).length;
    // 手动映射允许同列供多个字段使用，但需显式提示避免误映（实现端 duplicatedColumns）
    const colCount = {};
    Object.keys(mapping).forEach((k) => { const c = mapping[k].column; colCount[c] = (colCount[c] || 0) + 1; });
    const duplicated = Object.keys(colCount).filter((c) => colCount[c] > 1);
    const unused = (sheet ? sheet.columns : []).filter((c) => !colCount[c]);
    const progressPercent = run.total === 0 ? 0 : Math.round((run.done / run.total) * 100);
    const locked = run.phase !== "idle"; // 已开始导入（含失败半途）锁定回改映射与删行，避免重复入库已成功行

    // —— 动作 ——
    const cancelTab = () => navigate(cfg.back); // 模拟「关闭页签，回到来源列表」
    const onPickFile = () => {
      if (parsing) return;
      setParsing(true);
      // 演示：600ms 模拟实现端 parseSheetForMapping 解析内置示例文件
      timer.current = setTimeout(() => {
        setParsing(false);
        setSheet({ columns: cfg.columns, rows: cfg.rows });
        setMapping(autoMatch(cfg.columns, cfg.fields));
        setExcluded({});
        failedOnce.current = {};
        setRun({ phase: "idle", done: 0, total: 0, error: null });
        setStep("mapping");
      }, 600);
    };
    const selectColumn = (fieldKey, column) => setMapping((m) => {
      const next = Object.assign({}, m);
      if (column) next[fieldKey] = { column: column, confidence: "confirmed" };
      else delete next[fieldKey];
      return next;
    });
    const confirmSuggestion = (fieldKey) => setMapping((m) => (
      m[fieldKey] ? Object.assign({}, m, { [fieldKey]: { column: m[fieldKey].column, confidence: "confirmed" } }) : m
    ));
    const removeRow = (index) => {
      if (locked) return;
      setExcluded((e) => Object.assign({}, e, { [index]: true }));
    };
    // 逐行入库模拟（实现端 useImportRunner：失败停在当前行，重试从失败行续导，不重复已成功行）
    const tick = () => {
      const rows = rt.current.rows; const i = rt.current.done;
      if (i >= rows.length) {
        const rej = rt.current.rejected;
        const okCount = i - rej.length;
        setRun({ phase: "completed", done: i, total: rows.length, error: null });
        if (rej.length) {
          // 有行级拒绝：不自动关页签，留在本页展示拒绝清单（#70 US45）
          UI.toast("已导入 " + okCount + " 行，" + rej.length + " 行被拒绝：" + cfg.label, "warn");
        } else {
          UI.toast("已导入 " + okCount + " 行：" + cfg.label, "ok");
          // 成功只发一条 system toast，然后自动关闭页签（此处以回来源列表模拟）
          timer.current = setTimeout(() => navigate(cfg.back), 800);
        }
        return;
      }
      timer.current = setTimeout(() => {
        // 行级校验（#70 US45 目标态）：不通过 → 整行拒绝进清单，跳过继续，不阻断导入
        const vErr = cfg.validateRow ? cfg.validateRow(rows[i]) : null;
        if (vErr) {
          const keyField = cfg.fields[0];
          const keyVal = rows[i][keyField.key];
          rt.current.rejected.push({ rowNo: i + 1, keyLabel: keyField.label, keyVal: keyVal == null || keyVal === "" ? "—" : String(keyVal), reason: vErr });
          rt.current.done = i + 1;
          setRejected(rt.current.rejected.slice());
          setRun({ phase: "running", done: i + 1, total: rows.length, error: null });
          tick();
          return;
        }
        const ref = String(rows[i].externalRef == null ? "" : rows[i].externalRef);
        if (ref.indexOf("FAIL") === 0 && !failedOnce.current[ref]) {
          failedOnce.current[ref] = 1;
          setRun({ phase: "failed", done: i, total: rows.length, error: "演示写入失败：" + ref });
          return;
        }
        rt.current.done = i + 1;
        setRun({ phase: "running", done: i + 1, total: rows.length, error: null });
        tick();
      }, 110);
    };
    const startImport = () => {
      if (run.phase === "running" || run.phase === "completed" || !kept.length) return;
      rt.current = { rows: kept.map((e) => e.row), done: 0, rejected: [] };
      setRejected([]);
      setRun({ phase: "running", done: 0, total: kept.length, error: null });
      tick();
    };
    const retryImport = () => {
      if (run.phase !== "failed") return;
      setRun((r) => ({ phase: "running", done: r.done, total: r.total, error: null }));
      tick();
    };

    const chip = (status) => {
      const c = STATUS_CHIP[status] || STATUS_CHIP.unmapped;
      return (
        <span style={{ display: "inline-flex", borderRadius: 999, padding: "3px 8px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", background: c.bg, color: c.color }}>
          {c.label}
        </span>
      );
    };

    return (
      <div style={{ maxWidth: 896, margin: "0 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 页头：眉标 + 标题 + 副标 + chip（实现端无返回按钮，离开只走「取消」） */}
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--brand)", marginBottom: 4 }}>
              {Icon ? <Icon name="file-input" size={14} /> : null}
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Import workflow</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--ink)" }}>导入映射</h1>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-soft)" }}>{cfg.label} · 模板驱动，源列映射到系统字段</p>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", background: "var(--brand-soft)", color: "var(--brand-deep)" }}>
            独立页签 · 完成后自动关闭
          </span>
        </header>

        {/* 步骤条：ProcessStepper 三步（纯展示，不可点击跳步） */}
        <P style={{ padding: 16 }}>
          <ProcessStepper steps={importSteps(step, run.phase)} />
        </P>

        {/* 第一步：上传（ImportUploadStep.vue） */}
        {step === "upload" ? (
          <section aria-label="第一步：上传">
            <div role="button" tabIndex={0} onClick={onPickFile}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPickFile(); }}
              style={{ display: "grid", placeItems: "center", gap: 8, padding: "36px 20px", textAlign: "center", cursor: "pointer",
                border: "2px dashed var(--line-strong)", borderRadius: "var(--radius-card)", background: "var(--panel)" }}>
              {Icon ? <Icon name="file-up" size={28} color="var(--brand)" /> : null}
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>拖入 Excel / CSV 文件，或点击选择</div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>第一行须为表头；支持 .xlsx / .xls / .csv</div>
              {/* 演示脚本：设计稿无真实文件系统，点击即读入内置示例 */}
              <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>演示环境：点击后读入内置示例「{cfg.file}」（{cfg.rows.length} 行）</div>
            </div>
            {parsing ? <p role="status" style={{ margin: "12px 0 0", fontSize: 12, color: "var(--ink-soft)" }}>正在解析文件…</p> : null}
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              {Button ? <Button variant="ghost" onClick={cancelTab}>取消</Button> : null}
            </div>
          </section>
        ) : null}

        {/* 第二步：映射（ImportMappingStep.vue —— 模板字段为主轴，ADR 0005） */}
        {step === "mapping" ? (
          <section aria-label="第二步：映射">
            <P padding={0} style={{ overflow: "hidden" }}>
              {!narrow ? (
                <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) 84px 64px", gap: 12, alignItems: "center",
                  padding: "8px 14px", borderBottom: "1px solid var(--line)", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ink-faint)" }}>
                  <span>系统模板字段</span><span>源列</span><span>状态</span><span />
                </div>
              ) : null}
              {fields.map((f, fi) => {
                const status = fieldStatus(mapping, f);
                const select = (
                  <select value={mapping[f.key] ? mapping[f.key].column : ""} aria-label={f.label + "的源列"} style={SEL}
                    onChange={(e) => selectColumn(f.key, e.target.value || null)}>
                    <option value="">不导入此字段</option>
                    {(sheet ? sheet.columns : []).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                );
                const confirmBtn = status === "pending" ? (
                  <button type="button" aria-label={"确认" + f.label + "的匹配"} onClick={() => confirmSuggestion(f.key)}
                    style={{ border: "1px solid rgba(217,119,6,0.5)", borderRadius: "var(--radius-btn)", background: "transparent",
                      padding: "4px 10px", fontSize: 11, fontWeight: 600, color: "var(--warn-ink)", cursor: "pointer", whiteSpace: "nowrap" }}>
                    确认
                  </button>
                ) : null;
                const label = (
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, color: "var(--ink)" }}>
                    {f.label}{f.required ? <span aria-label="必填" style={{ color: "var(--danger)" }}> *</span> : null}
                  </span>
                );
                if (narrow) {
                  // 折叠版式（实现端 36rem 容器查询）：字段+状态一行，源列下拉整行，待确认「确认」靠右
                  return (
                    <div key={f.key} style={{ padding: "10px 14px", borderTop: fi ? "1px solid var(--line)" : 0, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>{label}{chip(status)}</div>
                      {select}
                      {confirmBtn ? <div style={{ display: "flex", justifyContent: "flex-end" }}>{confirmBtn}</div> : null}
                    </div>
                  );
                }
                return (
                  <div key={f.key} data-status={status}
                    style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) 84px 64px", gap: 12, alignItems: "center", padding: "10px 14px", borderTop: fi ? "1px solid var(--line)" : 0 }}>
                    {label}
                    {select}
                    <span>{chip(status)}</span>
                    <span style={{ display: "flex", justifyContent: "flex-end" }}>{confirmBtn}</span>
                  </div>
                );
              })}
            </P>

            {duplicated.length ? (
              <p style={{ margin: "12px 0 0", fontSize: 11, fontWeight: 600, color: "var(--warn-ink)" }}>
                同一源列被多个字段使用：{duplicated.join("、")}，请确认是否有意。
              </p>
            ) : null}
            {unused.length ? (
              <p style={{ margin: "12px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>
                未使用的源列：
                {unused.map((c) => (
                  <span key={c} style={{ display: "inline-block", margin: "0 2px", borderRadius: 999, background: "var(--surface-3)", padding: "2px 8px" }}>{c}</span>
                ))}
              </p>
            ) : null}

            {/* 页脚：必填门控（未映上必填字段拦住不进导入步） */}
            <P style={{ marginTop: 16, padding: 12, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              {missingRequired.length ? (
                <span role="alert" style={{ fontSize: 11, fontWeight: 600, color: "var(--danger-ink)" }}>
                  必填字段未映射：{missingRequired.map((f) => f.label).join("、")}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>必填字段已全部映上，可进入预览。</span>
              )}
              <span style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                {Button ? <Button variant="ghost" onClick={cancelTab}>取消</Button> : null}
                {Button ? <Button variant="secondary" onClick={() => setStep("upload")}>重新上传</Button> : null}
                {Button ? <Button variant="primary" disabled={missingRequired.length > 0} onClick={() => { if (!missingRequired.length) setStep("preview-import"); }}>下一步</Button> : null}
              </span>
            </P>
          </section>
        ) : null}

        {/* 第三步：预览与导入（ImportPreviewStep.vue + 进度/失败面板） */}
        {step === "preview-import" ? (
          <section aria-label="第三步：预览与导入">
            <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--ink-faint)" }}>
              {removedCount ? "共 " + kept.length + " 行待导入，已删除 " + removedCount + " 行" : "共 " + kept.length + " 行待导入"}；不属于该实体的行可在此删除。
            </p>
            <P padding={0} style={{ overflow: "hidden" }}>
              {/* 密集表格只在自身容器横滚（窄屏不得让整页横向溢出） */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: Math.max(640, 96 + fields.length * 118), borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left" }}>
                      <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--ink-faint)" }}>#</th>
                      {fields.map((f) => (
                        <th key={f.key} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--ink-faint)", whiteSpace: "nowrap" }}>{f.label}</th>
                      ))}
                      <th style={{ padding: "8px 12px" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {kept.map((entry, order) => (
                      <tr key={entry.index} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}>{order + 1}</td>
                        {fields.map((f) => {
                          const v = entry.row[f.key];
                          const text = v == null || v === "" ? "—" : String(v);
                          return (
                            <td key={f.key} title={text} style={{ padding: "8px 12px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink)" }}>{text}</td>
                          );
                        })}
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>
                          <button type="button" disabled={locked} aria-label={"删除第 " + (order + 1) + " 行"} onClick={() => removeRow(entry.index)}
                            style={{ border: "1px solid transparent", borderRadius: "var(--radius-btn)", background: "transparent", padding: "4px 8px",
                              fontSize: 11, fontWeight: 600, color: "var(--danger)", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1 }}>
                            删除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!kept.length ? (
                  <p style={{ margin: 0, padding: "24px 12px", textAlign: "center", fontSize: 12, color: "var(--ink-faint)" }}>
                    没有待导入的行（可能已全部删除），请返回上一步调整。
                  </p>
                ) : null}
              </div>
            </P>

            {/* 导入进度（开始后出现；失败红 / 完成绿 / 进行蓝） */}
            {run.phase !== "idle" ? (
              <P style={{ marginTop: 16, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: "var(--ink-soft)" }}>导入进度</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }} aria-live="polite">{run.done}/{run.total} 行</span>
                </div>
                <Track percent={progressPercent} tone={run.phase === "failed" ? "danger" : run.phase === "completed" ? "ok" : "brand"} />
              </P>
            ) : null}

            {/* 行级拒绝清单（#70 US45 目标态；2026-08-01 裁定确认需要，实现端 useImportRunner 待补逐行校验） */}
            {run.phase === "completed" && rejected.length ? (
              <div role="alert" style={{ marginTop: 16, border: "1px solid rgba(217,119,6,0.4)", borderRadius: "var(--radius-btn)", background: "var(--warn-soft)", overflow: "hidden" }}>
                <div style={{ padding: 12 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--warn-ink)" }}>行级拒绝清单 · {rejected.length} 行未写入</p>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--ink-soft)" }}>
                    被拒绝的行未写入台账，已导入的 {run.done - rejected.length} 行不受影响；修正源文件后可重新发起导入。
                  </p>
                </div>
                <div style={{ overflowX: "auto", background: "#fff" }}>
                  <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", textAlign: "left" }}>
                        <th style={{ padding: "7px 12px", fontSize: 11, fontWeight: 700, color: "var(--ink-faint)", width: 54 }}>行号</th>
                        <th style={{ padding: "7px 12px", fontSize: 11, fontWeight: 700, color: "var(--ink-faint)" }}>{rejected[0].keyLabel}</th>
                        <th style={{ padding: "7px 12px", fontSize: 11, fontWeight: 700, color: "var(--ink-faint)" }}>拒绝原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rejected.map((r) => (
                        <tr key={r.rowNo} style={{ borderBottom: "1px solid var(--line)" }}>
                          <td style={{ padding: "7px 12px", fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}>{r.rowNo}</td>
                          <td style={{ padding: "7px 12px", color: "var(--ink)" }}>{r.keyVal}</td>
                          <td style={{ padding: "7px 12px", color: "var(--danger-ink)", fontWeight: 600 }}>{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {Button ? <Button icon="download" onClick={() => UI.toast("已下载拒绝清单（演示）：" + rejected.length + " 行", "ok")}>下载拒绝清单</Button> : null}
                  {Button ? <Button variant="ghost" onClick={cancelTab}>关闭页签</Button> : null}
                </div>
              </div>
            ) : null}

            {run.phase === "failed" ? (
              /* 失败面板：保留页签、从失败行续导（已成功行不重复入库） */
              <div role="alert" style={{ marginTop: 16, padding: 12, border: "1px solid rgba(220,38,38,0.35)", borderRadius: "var(--radius-btn)", background: "var(--danger-soft)" }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--danger-ink)" }}>{run.error || "导入失败，请重试"}</p>
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--ink-soft)" }}>已成功的 {run.done} 行不会重复导入，重试将从失败行继续。</p>
                <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {Button ? <Button variant="danger" onClick={retryImport}>重试失败行</Button> : null}
                  {Button ? <Button variant="ghost" onClick={cancelTab}>取消</Button> : null}
                </div>
              </div>
            ) : (
              <P style={{ marginTop: 16, padding: 12, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>开始后逐行写入，本页显示进度；失败保留页签并可从失败行续导。</span>
                <span style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                  {Button ? <Button variant="ghost" disabled={run.phase === "running"} onClick={cancelTab}>取消</Button> : null}
                  {Button ? <Button variant="secondary" disabled={locked} onClick={() => { if (!locked) setStep("mapping"); }}>上一步</Button> : null}
                  {Button ? (
                    <Button variant="accent" icon={run.phase === "running" ? "loader-circle" : undefined}
                      disabled={!kept.length || run.phase === "running" || run.phase === "completed"} onClick={startImport}>
                      开始导入
                    </Button>
                  ) : null}
                </span>
              </P>
            )}
          </section>
        ) : null}
      </div>
    );
  }

  window.ImportMappingScreen = ImportMappingScreen;
})();
