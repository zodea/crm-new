// ExportConfigScreen — 导出配置页签（按实现端 app/pages/export/config/[jobId].vue 校准，#205）。
// 关键结构（与实现端逐块对应）：
//   页头      ：Export workflow 眉标 + 「导出配置」标题 + 「{来源} · N 个文件」副标
//               + 右侧「独立页签 · 完成后自动关闭」chip；没有返回按钮 —— 离开只走「取消」（关闭页签）。
//   配置视图  ：ExportConfigForm.vue —— 「文件夹结构」（最多两级目录字段，二级依赖一级）/
//               「文件命名规则」（两段命名字段 + 分隔符 + 扩展名，第二段依赖第一段）/
//               「相对路径预览」（首个文件实时预览完整相对路径）/
//               页脚「开始后将在本页显示读数据、生成、写盘三步进度。」+ 取消 / 开始导出。
//   进度视图  ：开始后配置锁定，原地切换为 ProcessStepper 三步 读数据 / 生成 / 写盘；
//               目标目录在「写盘」步才经目录选择器选取（实现端 pickDirectory），取消选择 = 整单取消回配置；
//               失败面板只重启失败步（「重试失败步骤」），「返回修改配置」reset 回配置视图；
//               成功只发一条 system toast「已导出到 X 文件夹」并自动关闭页签 —— 写盘完成≠业务完成，不另设完成页。
//   失效空态  ：上下文失效（刷新/历史直达）→ 警示空态「导出上下文已失效」+「关闭此页签」
//               （演示入口：navigate("exportConfig", { invalid: true })）。
// 与 2026-07-30 文字规格版的差异：实现端没有「导出范围 / 文件格式 / 保存目标输入框 / 重新导出按钮 /
// 已写入 N 目录 M 文件汇总」，一律删除 —— 范围与格式由发起方在来源列表决定后注册进 workflow context，
// 目录在写盘步经系统目录选择器选取；两级目录 + 两段命名 + 分隔符 + 扩展名 + 路径预览按实现端补齐。
// 演示数据内置于本屏（匿名虚构），形状对应实现端真实调用 ProjectListScreen.exportByCategory 的「项目台账」源。
(function () {
  if (window.ExportConfigScreen) return;

  // —— 视口宽 hook：窄屏配置表单降为单列 ——
  const useVw = () => {
    const [vw, setVw] = React.useState(window.innerWidth);
    React.useEffect(() => {
      const onR = () => setVw(window.innerWidth);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }, []);
    return vw;
  };

  // —— 演示 workflow context（实现端由发起方注册进 useExportWorkflowsStore，页签只携带 jobId）——
  const SOURCE = {
    label: "项目台账", back: "project",
    fields: [
      { key: "developer", label: "客户" },
      { key: "status", label: "业务流程阶段" },
      { key: "name", label: "项目名称" },
      { key: "region", label: "工程地域" },
    ],
    files: [
      { row: { developer: "宏远置业", status: "在建", name: "宏远云著一期", region: "华东" } },
      { row: { developer: "宏远置业", status: "收尾", name: "宏远云著二期", region: "华东" } },
      { row: { developer: "泽信地产", status: "在建", name: "泽信璟园", region: "华南" } },
      { row: { developer: "明州城投", status: "结算", name: "明州人才公寓", region: "华东" } },
      { row: { developer: "", status: "在建", name: "老旧片区改造试点", region: "华北" } }, // 空客户 → 预览演示 fallback「未分类客户」
    ],
  };
  // 空值兜底（实现端由 structure/naming 规则的 fallback 字段携带）
  const FALLBACK = { developer: "未分类客户", status: "未分阶段", name: "未命名项目" };

  // —— ProcessStepper 复刻（实现端 app/components/ui/ProcessStepper.vue）：
  //    「处理进度」细进度条（active 记半步）+ 每步圆标（✓/✗/脉冲点/序号）+ 状态副标；纯展示不可点击。
  //    ImportMappingScreen.jsx 内有同构副本 —— 设计稿运行时无共享模块，各屏自带。
  const STEP_STYLE = {
    pending: { label: "等待中", border: "var(--line)", bg: "var(--panel)", text: "var(--ink-faint)", weight: 500, bar: "var(--line)" },
    active: { label: "进行中", border: "var(--brand)", bg: "var(--brand-soft)", text: "var(--brand-deep)", weight: 700, bar: "var(--brand)" },
    completed: { label: "已完成", border: "var(--ok)", bg: "var(--ok-soft)", text: "var(--ok-ink)", weight: 600, bar: "var(--ok)" },
    failed: { label: "失败", border: "var(--danger)", bg: "var(--danger-soft)", text: "var(--danger-ink)", weight: 600, bar: "var(--danger)" },
  };
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

  // 导出三步（实现端 lib/kit/export.ts EXPORT_STEPS：读数据 / 生成 / 写盘）
  const STEP_DEFS = [
    { id: "read-data", label: "读数据" },
    { id: "generate-files", label: "生成" },
    { id: "write-disk", label: "写盘" },
  ];

  // field-label / field-input 复刻（与实现端 ExportConfigForm 表单控件同款）
  const LBL = { fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", marginBottom: 4 };
  const SEL = (disabled) => ({
    width: "100%", minWidth: 0, height: 32, padding: "0 10px", fontSize: 13,
    border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)",
    background: disabled ? "var(--surface-2)" : "var(--panel)", color: "var(--ink)",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
  });
  const INP = {
    width: "100%", minWidth: 0, height: 32, padding: "0 10px", fontSize: 13, fontFamily: "var(--font-mono)",
    border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", background: "var(--panel)", color: "var(--ink)", outline: "none",
  };

  function ExportConfigScreen({ navigate, params }) {
    const { Panel, Button, Icon } = window.DesignSystem_e3d871 || {};
    const UI = window.KitUI || { toast: function () {}, folderPicker: function () {} };
    const P = Panel || "div";
    const vw = useVw();
    const narrow = vw < 960;

    // 配置：levels/parts 存字段 key（最多两项，实现端进入页签即截断到两级/两段）
    const [settings, setSettings] = React.useState({ levels: ["developer", "status"], parts: ["name"], separator: "-", extension: "xlsx" });
    // 进度状态机（实现端 useConfiguredExportRunner + transitionExportStepper 的演示投影）
    const [st, setSt] = React.useState({ phase: "idle", statuses: ["pending", "pending", "pending"], error: null, waiting: false });
    const timer = React.useRef(null);
    // 对应实现端 onUnmounted → workflowsStore.remove(jobId)：离开本屏即停
    React.useEffect(() => () => clearTimeout(timer.current), []);

    // —— 上下文失效空态（实现端 workflow 不存在分支，文案逐字一致；演示经 params.invalid 进入）——
    if ((params || {}).invalid) {
      return (
        <div style={{ maxWidth: 896, margin: "0 auto", minWidth: 0 }}>
          <P role="alert" style={{ padding: 24, textAlign: "center", borderColor: "rgba(217,119,6,0.4)", background: "var(--warn-soft)" }}>
            {Icon ? <Icon name="file-warning" size={28} color="var(--warn)" style={{ margin: "0 auto 8px" }} /> : null}
            <h1 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--warn-ink)" }}>导出上下文已失效</h1>
            <p style={{ maxWidth: 480, margin: "8px auto 0", fontSize: 12, color: "var(--ink-soft)" }}>
              该配置页可能来自刷新或历史记录，内存中的导出数据已释放。请回到来源页面重新发起导出。
            </p>
            {Button ? <Button style={{ marginTop: 16 }} onClick={() => navigate(SOURCE.back)}>关闭此页签</Button> : null}
          </P>
        </div>
      );
    }

    const running = st.phase === "running";
    const view = st.phase === "idle" ? "config" : "progress";
    const steps = STEP_DEFS.map((s, i) => ({ id: s.id, label: s.label, status: st.statuses[i] }));

    // —— 两级/两段字段规则（实现端 updateFieldPair：清一级连带清二级，二级依赖一级）——
    const setPair = (kind, pos, value) => setSettings((s) => {
      const cur = s[kind];
      let next;
      if (pos === 0) next = value ? [value].concat(cur[1] ? [cur[1]] : []) : [];
      else next = !cur[0] ? [] : value ? [cur[0], value] : [cur[0]];
      const out = Object.assign({}, s);
      out[kind] = next;
      return out;
    });

    // —— 相对路径预览（实现端 resolveTwoLevelFolderPath + renderNamePreview；
    //    实现端另有 Windows 非法字符/保留名/超长清洗，演示数据保证干净，此处只做空值兜底）——
    const segOf = (k, row) => {
      const v = String(row[k] == null ? "" : row[k]).trim();
      return v || FALLBACK[k] || "未分类";
    };
    const previewFile = SOURCE.files[0];
    const previewPath = (() => {
      if (!previewFile) return "暂无可预览文件";
      const folders = settings.levels.map((k) => segOf(k, previewFile.row));
      const ext = String(settings.extension || "").replace(/^\.+/, "");
      const name = (settings.parts.map((k) => segOf(k, previewFile.row)).join(settings.separator || "-") || "未命名") + (ext ? "." + ext : "");
      return folders.concat([name]).join("/");
    })();

    // —— 运行剧本：读数据 → 生成 → 写盘（目录在写盘步才选择；失败只重启失败步）——
    const openPicker = () => {
      UI.folderPicker((path) => {
        setSt((s) => Object.assign({}, s, { waiting: false }));
        timer.current = setTimeout(() => {
          // 演示剧本：选 C 盘路径模拟「目标目录不可写」→ 写盘步失败可重试；其余路径写盘成功
          if (/^C:/i.test(path)) {
            setSt({ phase: "failed", statuses: ["completed", "completed", "failed"], error: "写盘失败：目标目录不可写", waiting: false });
            return;
          }
          setSt({ phase: "completed", statuses: ["completed", "completed", "completed"], error: null, waiting: false });
          // 成功只发一条 system toast，然后自动关闭页签（此处以回来源列表模拟）
          UI.toast("已导出到 " + path + " 文件夹", "ok");
          timer.current = setTimeout(() => navigate(SOURCE.back), 800);
        }, 700);
      });
    };
    const startExport = () => {
      if (running || !SOURCE.files.length || !settings.parts.length) return;
      setSt({ phase: "running", statuses: ["active", "pending", "pending"], error: null, waiting: false });
      timer.current = setTimeout(() => { // 读数据完成 → 生成
        setSt((s) => Object.assign({}, s, { statuses: ["completed", "active", "pending"] }));
        timer.current = setTimeout(() => { // 生成完成 → 写盘（先选目录）
          setSt((s) => Object.assign({}, s, { statuses: ["completed", "completed", "active"], waiting: true }));
          openPicker();
        }, 500);
      }, 400);
    };
    const retryExport = () => {
      if (st.phase !== "failed") return;
      // 重试只重启失败步：读数据、生成保持已完成
      setSt({ phase: "running", statuses: ["completed", "completed", "active"], error: null, waiting: true });
      openPicker();
    };
    const backToConfig = () => { // 实现端 runner.reset()：回配置视图（取消目录选择同样走 cancelled → reset）
      clearTimeout(timer.current);
      setSt({ phase: "idle", statuses: ["pending", "pending", "pending"], error: null, waiting: false });
    };
    const cancelTab = () => navigate(SOURCE.back); // 模拟「关闭页签，回到来源列表」

    const fieldOptions = SOURCE.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>);

    return (
      <div style={{ maxWidth: 896, margin: "0 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 页头：眉标 + 标题 + 副标 + chip（实现端无返回按钮，离开只走「取消」） */}
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--brand)", marginBottom: 4 }}>
              {Icon ? <Icon name="folder-cog" size={14} /> : null}
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Export workflow</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--ink)" }}>导出配置</h1>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-soft)" }}>{SOURCE.label} · {SOURCE.files.length} 个文件</p>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", background: "var(--brand-soft)", color: "var(--brand-deep)" }}>
            独立页签 · 完成后自动关闭
          </span>
        </header>

        {view === "config" ? (
          /* —— 配置视图（ExportConfigForm.vue） —— */
          <section aria-label="导出规则配置" style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <P>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>文件夹结构</div>
              <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--ink-faint)" }}>最多按两个字段分级，导出时会为每条数据生成对应目录。</p>
              <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={LBL}>一级目录字段</span>
                  <select value={settings.levels[0] || ""} style={SEL(false)} onChange={(e) => setPair("levels", 0, e.target.value)}>
                    <option value="">不创建分级目录</option>
                    {fieldOptions}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={LBL}>二级目录字段</span>
                  <select value={settings.levels[1] || ""} disabled={!settings.levels[0]} style={SEL(!settings.levels[0])} onChange={(e) => setPair("levels", 1, e.target.value)}>
                    <option value="">不创建二级目录</option>
                    {fieldOptions}
                  </select>
                </label>
              </div>
            </P>

            <P>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>文件命名规则</div>
              <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--ink-faint)" }}>按顺序组合最多两段数据，分隔符和扩展名会立即反映到预览。</p>
              <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={LBL}>命名字段·第一段</span>
                  <select value={settings.parts[0] || ""} style={SEL(false)} onChange={(e) => setPair("parts", 0, e.target.value)}>
                    <option value="">不使用数据字段</option>
                    {fieldOptions}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={LBL}>命名字段·第二段</span>
                  <select value={settings.parts[1] || ""} disabled={!settings.parts[0]} style={SEL(!settings.parts[0])} onChange={(e) => setPair("parts", 1, e.target.value)}>
                    <option value="">不添加第二段</option>
                    {fieldOptions}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={LBL}>分隔符</span>
                  <input value={settings.separator} autoComplete="off" spellCheck={false} style={INP}
                    onChange={(e) => setSettings((s) => Object.assign({}, s, { separator: e.target.value }))} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={LBL}>扩展名</span>
                  <input value={settings.extension} placeholder="例如 pdf 或 .pdf" autoComplete="off" spellCheck={false} style={INP}
                    onChange={(e) => setSettings((s) => Object.assign({}, s, { extension: e.target.value }))} />
                </label>
              </div>
            </P>

            {/* 相对路径预览：首个文件实时预览（brand 浅底面板） */}
            <section aria-label="相对路径预览" style={{ border: "1px solid rgba(37,99,235,0.25)", borderRadius: "var(--radius-card)", background: "var(--brand-soft)", padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--brand-deep)" }}>相对路径预览</h3>
                <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{SOURCE.label}</span>
              </div>
              <output aria-live="polite" style={{ display: "block", wordBreak: "break-all", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", background: "var(--panel)", padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink)" }}>
                {previewPath}
              </output>
            </section>

            <P style={{ padding: 12, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>开始后将在本页显示读数据、生成、写盘三步进度。</span>
              <span style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                {Button ? <Button variant="ghost" onClick={cancelTab}>取消</Button> : null}
                {Button ? (
                  <Button variant="accent" disabled={!SOURCE.files.length || !settings.parts.length} onClick={startExport}>开始导出</Button>
                ) : null}
              </span>
            </P>
          </section>
        ) : (
          /* —— 进度视图：配置锁定，三步 stepper 原地推进 —— */
          <P style={{ padding: 20 }} aria-label="导出进度">
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>
                {st.phase === "failed" ? "导出未完成" : "正在导出"}
              </h2>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-soft)" }}>配置已锁定；失败时页签会保留，可从失败步骤重试。</p>
            </div>

            <ProcessStepper steps={steps} />

            {/* 写盘前的目录选择等待位：实现端此处是系统目录对话框（取消选择 = 整单取消回配置）；
                设计稿用 KitUI.folderPicker 模拟，选择器被关闭后可在此重开或取消 */}
            {st.waiting ? (
              <div style={{ marginTop: 20, padding: 12, border: "1px dashed var(--line-strong)", borderRadius: "var(--radius-btn)", background: "var(--surface-2)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                <span style={{ flex: 1, minWidth: 200, fontSize: 12, color: "var(--ink-soft)" }}>
                  写盘前需选择目标目录；取消选择即取消本次导出并返回配置。
                </span>
                {Button ? <Button variant="secondary" onClick={openPicker}>重新打开目录选择器</Button> : null}
                {Button ? <Button variant="ghost" onClick={backToConfig}>取消导出</Button> : null}
              </div>
            ) : null}

            {st.phase === "failed" ? (
              <div role="alert" style={{ marginTop: 20, padding: 12, border: "1px solid rgba(220,38,38,0.35)", borderRadius: "var(--radius-btn)", background: "var(--danger-soft)" }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--danger-ink)" }}>{st.error || "导出失败，请重试"}</p>
                <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {Button ? <Button variant="danger" onClick={retryExport}>重试失败步骤</Button> : null}
                  {Button ? <Button variant="ghost" onClick={backToConfig}>返回修改配置</Button> : null}
                </div>
              </div>
            ) : null}

            {/* 演示脚本提示（非实现端 UI）：目录选择器中选 C 盘路径模拟「目标目录不可写」失败，其余路径写盘成功 */}
            <p style={{ margin: "16px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>
              演示脚本：目录选择器中选 C 盘路径模拟写盘失败，其余路径写盘成功。
            </p>
          </P>
        )}
      </div>
    );
  }

  window.ExportConfigScreen = ExportConfigScreen;
})();
