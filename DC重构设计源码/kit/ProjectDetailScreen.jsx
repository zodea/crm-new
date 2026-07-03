// ProjectDetailScreen — 项目详情·经营驾驶舱（issue #35+#36 重做）
// 布局：顶部摘要横跨全宽 → 下方分栏 = 主内容（进度成本卡/经营数据/票据/阶段时间线/Tab）+ 右侧文件栏(280px)。
// 阶段时间线：红圈「胶囊步进器 + 时间带」两层合一，节点按阶段起始日期定位；
// 施工中阶段起止实时取 window.SCHEDULE（p1=合和新城/p2=锦绣华庭/p3=翠湖花园，p4 无排程用 mock）。
// 经营数据固定 5列×2行、票据固定 6列×1行（全局布局规则：禁 auto-fit，语义固定列数）。
(function () {
  const { Button, IconButton, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;

  const TH = { padding: "11px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)" };
  const TD = { padding: "11px 14px", fontSize: 13, verticalAlign: "middle" };
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), formModal: () => {} };
  const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const yuan = (v) => (v == null ? "—" : "¥" + fmt(v));
  const statusTone = { "在建": "brand", "施工中": "brand", "收尾": "warn", "停工": "danger", "完工": "ok", "已竣工": "ok", "已结算": "ok" };

  // —— 日期工具（本地格式化，避免 toISOString 时区偏移）——
  const D = (s) => new Date(s + "T00:00:00");
  const days = (a, b) => Math.round((D(b) - D(a)) / 86400000);
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const dot = (s) => s.replace(/-/g, ".");

  // —— 每项目 mock（经营数据 / 票据 / 阶段任务已传数 / 子表样例）——
  const META = {
    p1: {
      operationType: "自营", contractor: "广州睿瑛装饰工程有限公司", developer2: "—", region: "广州·白云",
      contractName: "合和新城主体及装饰施工合同", plannedEnd: "2026-12-30", plannedDuration: 486,
      riskLevel: "中", approvalStatus: "已审批", overview: "高层住宅 3 栋，建筑面积约 4.6 万㎡，含主体结构与精装修。",
      createdBy: "陈志强", createdAt: "2025-08-18 10:22", updatedBy: "张工", updatedAt: "2026-06-28 16:40",
      biz: { main: 32388422, supplement: 0, ownerChange: 0, receipt: 25367027, payment: 0, curReceipt: 6100000, curPayment: 5950000, mgmt: 0, balance: 31467027.10 },
      tax: { outAmt: 25663629, outTax: 2119015, inAmt: 24696348, inTax: 1959703, vat: 159312, rate: 0.68 },
      phaseDone: [1, 2, 0, 0, 0, 0],
    },
    p2: {
      operationType: "自营", contractor: "广州市穗丰建筑工程有限公司", developer2: "—", region: "广州·番禺",
      contractName: "锦绣华庭南区施工合同", plannedEnd: "2027-03-15", plannedDuration: 420,
      riskLevel: "低", approvalStatus: "已审批", overview: "南区 2 栋洋房 + 地下车库。",
      createdBy: "王工", createdAt: "2026-01-12 09:05", updatedBy: "王工", updatedAt: "2026-06-20 11:10",
      biz: { main: 18600000, supplement: 320000, ownerChange: 0, receipt: 9800000, payment: 4200000, curReceipt: 0, curPayment: 0, mgmt: 0, balance: 5600000 },
      tax: { outAmt: 9650000, outTax: 796000, inAmt: 8900000, inTax: 706000, vat: 90000, rate: 0.93 },
      phaseDone: [1, 5, 1, 0, 0, 0],
    },
    p3: {
      operationType: "联营", contractor: "翠湖建设有限公司", developer2: "—", region: "广州·天河",
      contractName: "翠湖花园收尾施工合同", plannedEnd: "2026-08-30", plannedDuration: 300,
      riskLevel: "低", approvalStatus: "已审批", overview: "收尾阶段，含外立面与园林。",
      createdBy: "李工", createdAt: "2024-11-18 14:30", updatedBy: "李工", updatedAt: "2026-05-30 09:00",
      biz: { main: 9800000, supplement: 0, ownerChange: 120000, receipt: 9100000, payment: 8200000, curReceipt: 0, curPayment: 0, mgmt: 0, balance: 900000 },
      tax: { outAmt: 9020000, outTax: 744000, inAmt: 8700000, inTax: 690000, vat: 54000, rate: 0.60 },
      phaseDone: [1, 5, 3, 1, 2, 0],
    },
    p4: {
      operationType: "自营", contractor: "—", developer2: "—", region: "广州·海珠",
      contractName: "江湾一号施工合同", plannedEnd: "—", plannedDuration: null,
      riskLevel: "高", approvalStatus: "待审批", overview: "因资金问题停工。",
      createdBy: "陈工", createdAt: "2025-03-08 16:00", updatedBy: "陈工", updatedAt: "2025-11-02 10:00",
      biz: { main: 12000000, supplement: 0, ownerChange: 0, receipt: 2400000, payment: 2400000, curReceipt: 0, curPayment: 0, mgmt: 0, balance: 0 },
      tax: { outAmt: 2200000, outTax: 181000, inAmt: 2150000, inTax: 170000, vat: 11000, rate: 0.50 },
      phaseDone: [1, 1, 0, 0, 0, 0],
    },
  };

  const PHASES = [
    { name: "项目立项", tasks: [{ t: "项目立项审批表", d: "立项文件归档", r: "经营部" }] },
    { name: "施工准备", tasks: [
      { t: "施工组织设计方案", d: "资料员扫描上传并存档", r: "资料员" },
      { t: "开工报告及开工令", d: "资料员扫描上传并存档", r: "资料员" },
      { t: "材料定样板", d: "资料员照片上传，封样件存档", r: "资料员" },
      { t: "图纸会审记录", d: "设计师扫描上传并原件存档", r: "设计师" },
      { t: "施工蓝图", d: "设计师勾选不上传但原蓝图存档", r: "设计师" },
    ] },
    { name: "施工中", tasks: [
      { t: "排版图签确白图", d: "现场签认后上传", r: "项目经理" },
      { t: "隐蔽验收记录", d: "监理签认后存档", r: "质检员" },
      { t: "送检报告验收记录", d: "检测单位出具", r: "质检员" },
    ] },
    { name: "完工及验收", tasks: [{ t: "竣工验收报告/移交", d: "五方验收并移交", r: "项目经理" }] },
    { name: "交付", tasks: [
      { t: "工期一览表", d: "归档", r: "资料员" },
      { t: "工期延期说明工联单", d: "如有延期", r: "项目经理" },
      { t: "范围界面确认文件", d: "甲乙双方确认", r: "经营部" },
      { t: "无甩项确认工联单", d: "现场确认", r: "项目经理" },
      { t: "结算封板图", d: "结算用图归档", r: "预算员" },
    ] },
    { name: "保修", tasks: [] },
  ];

  // —— 六阶段起止 mock（立项→施工准备→施工中→完工验收→交付→保修）——
  // 施工中一段 p1-p3 渲染时被 window.SCHEDULE.state[项目].start/plannedEnd 覆盖，此处仅作 SCHEDULE 未就绪时的兜底。
  const PHASE_DATES = {
    p1: [["2026-01-05", "2026-02-10"], ["2026-02-11", "2026-04-30"], ["2026-05-01", "2026-10-31"], ["2026-11-01", "2026-11-30"], ["2026-12-01", "2026-12-30"], ["2026-12-31", "2027-12-30"]],
    p2: [["2025-09-01", "2025-10-20"], ["2025-10-21", "2026-01-14"], ["2026-01-15", "2027-03-15"], ["2027-03-16", "2027-04-15"], ["2027-04-16", "2027-05-15"], ["2027-05-16", "2029-05-15"]],
    p3: [["2024-08-01", "2024-09-10"], ["2024-09-11", "2024-11-19"], ["2024-11-20", "2026-08-30"], ["2026-08-31", "2026-09-30"], ["2026-10-01", "2026-10-31"], ["2026-11-01", "2028-10-31"]],
    p4: [["2025-03-08", "2025-04-20"], ["2025-04-21", "2025-08-31"], ["2025-09-01", "2026-12-31"], ["2027-01-01", "2027-01-31"], ["2027-02-01", "2027-02-28"], ["2027-03-01", "2029-02-28"]],
  };

  // —— 右侧文件栏 mock（名称/大小/上传时间/上传人 + 阶段任务关联标）——
  const FILES = {
    p1: [
      { name: "隐蔽验收记录-10栋.jpg", size: "2.8 MB", time: "2026-06-12", by: "王质检", tag: "施工中·隐蔽验收记录" },
      { name: "开工报告.pdf", size: "860 KB", time: "2026-04-28", by: "李资料", tag: "施工准备·开工报告" },
      { name: "图纸会审记录.pdf", size: "1.2 MB", time: "2026-04-22", by: "周设计", tag: "施工准备·图纸会审" },
      { name: "材料封样-墙地砖.jpg", size: "3.1 MB", time: "2026-04-20", by: "李资料", tag: "施工准备·材料定样板" },
      { name: "图纸封面.pdf", size: "2.4 MB", time: "2026-04-18", by: "周设计", tag: "施工准备·施工蓝图" },
      { name: "施工组织设计方案.pdf", size: "4.2 MB", time: "2026-03-02", by: "李资料", tag: "施工准备·施组方案" },
      { name: "项目立项审批表.pdf", size: "540 KB", time: "2026-01-08", by: "陈志强", tag: "项目立项·立项审批表" },
    ],
    p2: [
      { name: "送检报告-防水卷材.pdf", size: "1.6 MB", time: "2026-06-02", by: "何质检", tag: "施工中·送检报告" },
      { name: "施工蓝图-南区.pdf", size: "12.4 MB", time: "2026-01-10", by: "周设计", tag: "施工准备·施工蓝图" },
      { name: "开工报告及开工令.pdf", size: "920 KB", time: "2026-01-08", by: "王工", tag: "施工准备·开工报告" },
      { name: "项目立项审批表.pdf", size: "480 KB", time: "2025-09-06", by: "经营部", tag: "项目立项·立项审批表" },
    ],
    p3: [
      { name: "竣工验收报告(初稿).pdf", size: "3.4 MB", time: "2026-06-20", by: "李工", tag: "完工及验收·竣工验收" },
      { name: "外立面收口白图.jpg", size: "5.2 MB", time: "2026-05-12", by: "项目部", tag: "施工中·排版图签确白图" },
      { name: "隐蔽验收记录-主楼.pdf", size: "2.2 MB", time: "2025-08-15", by: "质检部", tag: "施工中·隐蔽验收记录" },
      { name: "施工组织设计方案.pdf", size: "3.8 MB", time: "2024-10-20", by: "李工", tag: "施工准备·施组方案" },
    ],
    p4: [
      { name: "项目立项审批表.pdf", size: "460 KB", time: "2025-03-12", by: "陈工", tag: "项目立项·立项审批表" },
      { name: "施工组织设计方案.pdf", size: "2.9 MB", time: "2025-05-06", by: "陈工", tag: "施工准备·施组方案" },
    ],
  };

  // —— 原子 ——
  function SectionHeader({ children, extra }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ width: 4, height: 16, borderRadius: 2, background: "var(--brand)", flex: "none" }} />
        <span style={{ fontSize: 15, fontWeight: 800 }}>{children}</span>
        {extra && <span style={{ marginLeft: "auto" }}>{extra}</span>}
      </div>
    );
  }

  // 指标格（带 ⓘ 公式 tooltip）
  function Metric({ label, value, formula, tone, big }) {
    const color = tone === "ok" ? "var(--ok-ink)" : tone === "danger" ? "var(--danger-ink)" : tone === "brand" ? "var(--brand)" : "var(--ink)";
    return (
      <div style={{ padding: "12px 14px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--ink-faint)", fontWeight: 600 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          {formula && <span title={formula} style={{ cursor: "help", display: "inline-flex" }}><Icon name="info" size={11} color="var(--ink-faint)" /></span>}
        </div>
        {/* 反馈轮8：金额两位小数完整展示，禁止省略号缩略（CRM 看数第一） */}
        <div title={typeof value === "string" ? value : undefined} style={{ marginTop: 5, fontSize: big ? 17.5 : 13.5, fontWeight: big ? 800 : 700, fontFamily: "var(--font-mono)", color, lineHeight: 1.25, whiteSpace: "nowrap", letterSpacing: "-0.015em" }}>{value}</div>
      </div>
    );
  }

  // 指标网格容器（语义固定列数 + 1px 分隔，禁 auto-fit）
  function MetricGrid({ children, cols = 5 }) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
        {React.Children.map(children, (c) => <div style={{ background: "var(--panel)", minWidth: 0 }}>{c}</div>)}
      </div>
    );
  }

  // SegTab 内联副本已删 → 统一用 window.KitAtoms.SegTab（反馈轮9 通用组件）
  const SegTab = (props) => { const KA = window.KitAtoms; return KA ? <KA.SegTab {...props} /> : null; };

  // 通用子表（反馈轮8：委托 KitTable，表格三件套——≥5 行高度 / 容器内横滚 / 分页；金额两位小数）
  function SubTable({ title, count, columns, rows, sum, minRows }) {
    const toolbar = (
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{title} <span style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>({count != null ? count : rows.length})</span></span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <IconButton icon="search" title="搜索" onClick={() => UI().toast("搜索 " + title + "（演示）")} />
          <IconButton icon="download" title="导出" onClick={() => UI().toast("正在导出 " + title + "…")} />
          <Button size="sm" variant="primary" icon="plus" onClick={() => UI().formModal({ title: "新增 " + title, fields: [{ key: "name", label: title + "名称", full: true }, { key: "amount", label: "金额", placeholder: "选填" }], onSave: () => UI().toast("已新增", "ok") })}>新增</Button>
        </div>
      </div>
    );
    if (window.KitTable) {
      return <window.KitTable toolbar={toolbar} columns={columns.map((c) => ({ width: 120, ...c }))} rows={rows}
        pageSize={10} minRows={minRows != null ? minRows : 5} sum={sum} tableMinWidth={Math.max(640, columns.length * 130)}
        footerLeft={"共 " + rows.length + " 条"} empty="暂无数据" />;
    }
    return <Panel padding={16} style={{ color: "var(--ink-soft)" }}>表格组件加载中…</Panel>;
  }

  // —— 进度 · 成本 驾驶舱卡（#30 原样保留）：迷你甘特（分组级，数据同首页）+ 人材机四科目 目标/实际/偏差 ——
  const SCHED_NAME = { p1: "合和新城", p2: "锦绣华庭", p3: "翠湖花园" };
  function ScheduleCostCard({ proj, navigate }) {
    const [, force] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => {
      if (!window.SCHEDULE) {
        const t = setInterval(() => { if (window.SCHEDULE) { clearInterval(t); force(); } }, 50);
        return () => clearInterval(t);
      }
      return window.SCHEDULE.subscribe(force);
    }, []);
    const S = window.SCHEDULE;
    const name = SCHED_NAME[proj.id];
    const header = (
      <SectionHeader extra={<Button size="sm" variant="secondary" icon="calendar-range" onClick={() => navigate("schedule")}>打开施工进度</Button>}>
        进度 · 成本
      </SectionHeader>
    );
    if (!name) {
      return (
        <Panel padding={16}>{header}
          <div style={{ padding: "18px 0", textAlign: "center", color: "var(--ink-faint)", fontSize: 12 }}>该项目暂无排程数据 · 可在「施工进度」新建楼栋分组套用工序模板</div>
        </Panel>
      );
    }
    if (!S) return <Panel padding={16}>{header}<div style={{ fontSize: 12, color: "var(--ink-soft)" }}>加载排程数据…</div></Panel>;

    const p = S.state[name];
    const axisStart = p.start.slice(0, 8) + "01";
    const endD = S.D(p.plannedEnd); const axisEnd = new Date(endD.getFullYear(), endD.getMonth() + 1, 0);
    const total = Math.max((axisEnd - S.D(axisStart)) / 86400000, 1);
    const X = (d) => Math.max(0, Math.min(100, S.days(axisStart, d) / total * 100));
    const todayX = X(p.today);
    const overall = S.rollup(p.groups.flatMap((g) => g.tasks), p.today);
    const fmtD = (s) => s.replace(/-/g, ".");

    const t = p.cost.reduce((s, c) => s + c.target, 0), a = p.cost.reduce((s, c) => s + c.actual, 0), e = p.cost.reduce((s, c) => s + c.expected, 0);
    const dev = a - e; const devPct = Math.round(dev / e * 1000) / 10;
    const thS = { padding: "6px 8px", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", borderBottom: "1px solid var(--line)", textAlign: "right", whiteSpace: "nowrap" };
    const tdS = { padding: "7px 8px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right", borderBottom: "1px solid var(--line)" };

    return (
      <Panel padding={16}>{header}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20 }}>
          {/* 左：迷你甘特（点击进入施工进度页） */}
          <div onClick={() => navigate("schedule")} style={{ cursor: "pointer", minWidth: 0 }} title="点击打开施工进度">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-mono)" }}>{Math.round(overall.pct * 100)}%</span>
              <StatusChip tone={overall.dev > 0 ? "ok" : overall.dev < 0 ? "warn" : "brand"}>
                {overall.dev > 0 ? `领先约${overall.dev}天` : overall.dev < 0 ? `落后约${-overall.dev}天` : "按计划"}
              </StatusChip>
              <span style={{ fontSize: 11, color: "var(--ink-soft)", marginLeft: "auto", fontFamily: "var(--font-mono)" }}>{fmtD(p.start)} → {fmtD(p.plannedEnd)}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {p.groups.map((g) => {
                const r = S.rollup(g.tasks, p.today);
                const gs = g.tasks.length ? g.tasks.reduce((m2, x) => S.days(x.ps, m2) > 0 ? x.ps : m2, g.tasks[0].ps) : p.start;
                const ge = g.tasks.length ? g.tasks.reduce((m2, x) => S.days(m2, x.pf) > 0 ? x.pf : m2, g.tasks[0].pf) : p.plannedEnd;
                return (
                  <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 104, flex: "none", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                    <div style={{ flex: 1, position: "relative", height: 14, background: "var(--surface-3)", borderRadius: 4 }}>
                      <div style={{ position: "absolute", left: X(gs) + "%", width: Math.max(X(ge) - X(gs), 2) + "%", top: 2, bottom: 2, background: "var(--brand)", opacity: 0.2, borderRadius: 3 }}>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (r.pct * 100) + "%", background: "var(--brand)", opacity: 1, borderRadius: 3 }} />
                      </div>
                      <div style={{ position: "absolute", left: todayX + "%", top: -2, bottom: -2, width: 1.5, background: "var(--danger)", opacity: 0.7 }} />
                    </div>
                    <span style={{ width: 36, flex: "none", fontSize: 11.5, fontFamily: "var(--font-mono)", fontWeight: 700, textAlign: "right", color: r.dev >= 0 ? "var(--ok-ink)" : "var(--warn-ink)" }}>{Math.round(r.pct * 100)}%</span>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--ink-faint)", display: "flex", gap: 12 }}>
              <span><span style={{ display: "inline-block", width: 10, height: 6, background: "var(--brand)", opacity: 0.2, borderRadius: 2, marginRight: 4 }} />计划</span>
              <span><span style={{ display: "inline-block", width: 10, height: 6, background: "var(--brand)", borderRadius: 2, marginRight: 4 }} />实际</span>
              <span><span style={{ display: "inline-block", width: 1.5, height: 8, background: "var(--danger)", marginRight: 4 }} />今天</span>
              <span style={{ marginLeft: "auto" }}>与首页/施工进度页同源实时联动</span>
            </div>
          </div>

          {/* 右：人材机四科目 目标 / 实际 / 偏差 */}
          <div style={{ minWidth: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={{ ...thS, textAlign: "left" }}>科目</th>
                <th style={thS}>目标</th><th style={thS}>已发生</th><th style={thS}>按进度应耗</th>
                <th style={{ ...thS, textAlign: "center" }}>偏差</th>
              </tr></thead>
              <tbody>
                {p.cost.map((c) => {
                  const d = c.actual - c.expected;
                  const tone = d > c.expected * 0.03 ? "danger" : d < -c.expected * 0.03 ? "ok" : "neutral";
                  return (
                    <tr key={c.cat}>
                      <td style={{ ...tdS, textAlign: "left", fontFamily: "inherit", fontWeight: 600 }}>{c.cat}</td>
                      <td style={tdS}>{c.target}万</td>
                      <td style={{ ...tdS, fontWeight: 700 }}>{c.actual}万</td>
                      <td style={{ ...tdS, color: "var(--ink-soft)" }}>{c.expected}万</td>
                      <td style={{ ...tdS, textAlign: "center" }}>
                        <span style={{ display: "inline-block", transform: "scale(0.88)" }}>
                          <StatusChip tone={tone}>{d > 0 ? `超 ${d}万` : d < 0 ? `省 ${-d}万` : "持平"}</StatusChip>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 10 }}>
              <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>合计 {a}万 / 目标 {t}万</span>
              <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 800, fontFamily: "var(--font-mono)", color: dev > 0 ? "var(--danger)" : "var(--ok-ink)" }}>
                {dev > 0 ? "+" : ""}{devPct}%
                <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 4 }}>{dev > 0 ? "超支" : "结余"}（按进度）</span>
              </span>
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  // —— 阶段时间线（重做核心）：红圈「胶囊步进器 + 时间带」两层合一 ——
  // 上层胶囊节点按阶段起始日期定位（percent left，不均分）；下层 14px 时间带：
  // 已过=绿实色 / 当前=绿→蓝渐变填充到 today 红线 / 未来=浅灰；月份刻度 + today 红线贯穿两层。
  function PhaseTimeline({ proj, m }) {
    const [, force] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => {
      if (!window.SCHEDULE) {
        const t = setInterval(() => { if (window.SCHEDULE) { clearInterval(t); force(); } }, 50);
        return () => clearInterval(t);
      }
      return window.SCHEDULE.subscribe(force);
    }, []);
    const S = window.SCHEDULE;
    const schedName = SCHED_NAME[proj.id];
    const sp = schedName && S ? S.state[schedName] : null;

    // 阶段起止（施工中一段取排程；其余可经节点旁编辑图标修改）
    const [dates, setDates] = React.useState(() => (PHASE_DATES[proj.id] || PHASE_DATES.p1).map((d) => ({ s: d[0], e: d[1] })));
    const eff = dates.map((d, i) => (i === 2 && sp ? { s: sp.start, e: sp.plannedEnd } : d));
    const today = sp ? sp.today : "2026-06-30";

    // 任务上传状态（初始铺底自 META.phaseDone，上传按钮真实翻转 → 节点分数联动）
    const [uploaded, setUploaded] = React.useState(() => {
      const u = {};
      PHASES.forEach((ph, pi) => ph.tasks.forEach((_, ti) => { u[pi + "-" + ti] = ti < (m.phaseDone[pi] || 0); }));
      return u;
    });
    const doneOf = (pi) => PHASES[pi].tasks.reduce((s, _, ti) => s + (uploaded[pi + "-" + ti] ? 1 : 0), 0);

    // 时间轴：立项开始 → 保修开始+90天（保修期长，右端渐隐截断并标注到期）
    const axisStart = eff[0].s;
    const axisEndD = new Date(D(eff[5].s).getTime() + 90 * 86400000);
    const total = Math.max(days(axisStart, iso(axisEndD)), 1);
    const X = (d) => clampN(days(axisStart, d) / total * 100, 0, 100);
    const todayX = X(today);

    // 月份刻度（超过 12 个自动抽稀）
    const ticks = [];
    {
      const all = [];
      let d0 = new Date(D(axisStart).getFullYear(), D(axisStart).getMonth() + 1, 1);
      while (d0 <= axisEndD) { all.push(new Date(d0)); d0 = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); }
      const step = Math.max(1, Math.ceil(all.length / 12));
      all.forEach((dd, i) => {
        if (i % step !== 0) return;
        const x = X(iso(dd));
        if (x > 2 && x < 96) ticks.push({ x, label: (dd.getMonth() === 0 ? (dd.getFullYear() % 100) + "年" : "") + (dd.getMonth() + 1) + "月" });
      });
    }

    // 阶段状态（按日期）：已过=绿 / 当前=蓝 / 未来=灰
    const stateOf = (i) => (days(eff[i].e, today) > 0 ? "done" : days(eff[i].s, today) >= 0 ? "current" : "future");
    const curIdx = eff.findIndex((_, i) => stateOf(i) === "current");
    const [openPhase, setOpenPhase] = React.useState(curIdx >= 0 ? curIdx : 1);

    // 反馈轮8：散落的小编辑图标废弃 → 模块级「编辑阶段」大修改项（一个弹窗改全部六阶段起止）
    const editAllPhases = () => UI().formModal({
      title: "编辑阶段起止 · 全部六阶段", cols: 2, width: 640,
      subtitle: sp ? "「施工中」起止取自施工进度计划，此处修改不生效（去施工进度页调整）" : null,
      fields: PHASES.flatMap((ph, i) => [
        { key: "s" + i, label: ph.name + " · 开始", type: "date", value: eff[i].s },
        { key: "e" + i, label: ph.name + " · 结束", type: "date", value: eff[i].e },
      ]),
      onSave: (v) => {
        for (let i = 0; i < PHASES.length; i++) {
          if (v["s" + i] && v["e" + i] && days(v["s" + i], v["e" + i]) < 0) { UI().toast("「" + PHASES[i].name + "」结束日期不能早于开始日期", "danger"); return; }
        }
        setDates((prev) => prev.map((x, i) => (i === 2 && sp ? x : { s: v["s" + i] || x.s, e: v["e" + i] || x.e })));
        UI().toast("阶段起止已更新", "ok");
      },
    });

    return (
      <Panel padding={16}>
        <SectionHeader extra={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>点阶段卡展开任务</span>
            <Button size="sm" icon="square-pen" onClick={editAllPhases}>编辑阶段</Button>
          </span>
        }>阶段时间线 · 任务文件</SectionHeader>

        {/* 反馈轮8：等宽六卡（每阶段有足够位置），日期比例只保留在下方时间带 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 12 }}>
          {PHASES.map((ph, i) => {
            const st = stateOf(i);
            const isOpen = openPhase === i;
            const done = doneOf(i), totalT = ph.tasks.length;
            const C = st === "current"
              ? { bd: "var(--brand)", bg: "var(--brand-soft)", ink: "var(--brand-deep)", icon: "loader" }
              : st === "done"
                ? { bd: "var(--ok)", bg: "var(--ok-soft)", ink: "var(--ok-ink)", icon: "check" }
                : { bd: "var(--line-strong)", bg: "var(--panel)", ink: "var(--ink-faint)", icon: "clock" };
            return (
              <button key={i} onClick={() => setOpenPhase(isOpen ? -1 : i)} style={{
                border: "1.5px solid " + C.bd, background: C.bg, borderRadius: 10, padding: "10px 10px 8px",
                cursor: "pointer", textAlign: "left", minWidth: 0,
                boxShadow: isOpen ? "0 0 0 3px var(--brand-soft)" : "none", transition: "box-shadow var(--dur-fast)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name={C.icon} size={13} color={C.ink} />
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ph.name}</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 15, fontWeight: 800, fontFamily: "var(--font-mono)", color: C.ink }}>{totalT ? done + "/" + totalT : "动态"}<span style={{ fontSize: 10, fontWeight: 600, marginLeft: 4, color: "var(--ink-faint)" }}>任务</span></div>
                <div style={{ marginTop: 4, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{dot(eff[i].s.slice(2))} → {dot(eff[i].e.slice(2))}</div>
              </button>
            );
          })}
        </div>

        <div style={{ position: "relative", margin: "2px 6px 0" }}>
          {/* 「今天」小标 */}
          <div style={{ position: "relative", height: 18 }}>
            <span style={{ position: "absolute", left: todayX + "%", transform: "translateX(-50%)", fontSize: 9.5, fontWeight: 800, color: "var(--danger)", background: "var(--danger-soft)", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>今天 {dot(today.slice(5))}</span>
          </div>
          {/* today 红线：贯穿时间带 */}
          <div style={{ position: "absolute", left: todayX + "%", top: 18, bottom: 19, width: 2, transform: "translateX(-50%)", background: "var(--danger)", opacity: 0.75, zIndex: 1 }} />

          {/* 下层：14px 时间带 */}
          <div style={{ position: "relative", height: 14, borderRadius: 7, background: "var(--surface-3)", overflow: "hidden", marginTop: 4 }}>
            {eff.map((d, i) => {
              const st = stateOf(i);
              const l = X(d.s), w = Math.max(X(d.e) - X(d.s), 0);
              if (st === "done") return <div key={i} style={{ position: "absolute", left: l + "%", width: w + "%", top: 0, bottom: 0, background: "var(--ok)", opacity: 0.85 }} />;
              if (st === "current") {
                const fillW = Math.max(clampN(todayX, l, l + w) - l, 0);
                return <div key={i} style={{ position: "absolute", left: l + "%", width: fillW + "%", top: 0, bottom: 0, background: "linear-gradient(90deg, var(--ok), var(--brand) 40%)" }} />;
              }
              return null;
            })}
            {/* 月刻度细线 + 阶段分界白线 + 保修尾部渐隐 */}
            {ticks.map((t, i) => <div key={"mt" + i} style={{ position: "absolute", left: t.x + "%", top: 0, bottom: 0, width: 1, background: "rgba(0,0,0,0.08)" }} />)}
            {eff.slice(1).map((d, i) => <div key={"sep" + i} style={{ position: "absolute", left: X(d.s) + "%", top: 0, bottom: 0, width: 2, background: "var(--panel)" }} />)}
            <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "5%", background: "linear-gradient(90deg, transparent, var(--panel))" }} />
          </div>

          {/* 月份刻度（小字） */}
          <div style={{ position: "relative", height: 16, marginTop: 3 }}>
            {ticks.map((t, i) => <span key={i} style={{ position: "absolute", left: t.x + "%", transform: "translateX(-50%)", fontSize: 9, color: "var(--ink-faint)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{t.label}</span>)}
            <span style={{ position: "absolute", right: 0, fontSize: 9, color: "var(--ink-faint)" }}>保修至 {dot(eff[5].e.slice(0, 7))}</span>
          </div>
        </div>

        {/* 展开：阶段任务清单（数字块 + 任务行 + 上传/查看） */}
        {openPhase >= 0 && PHASES[openPhase] && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{PHASES[openPhase].name} · 阶段任务</span>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{dot(eff[openPhase].s)} → {dot(eff[openPhase].e)}</span>
              {openPhase === 2 && sp && <StatusChip tone="brand">起止取自施工进度计划</StatusChip>}
              {PHASES[openPhase].tasks.length > 0 && <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}>已上传 {doneOf(openPhase)}/{PHASES[openPhase].tasks.length}</span>}
            </div>
            {PHASES[openPhase].tasks.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-faint)", padding: "8px 0" }}>该阶段任务动态生成，暂无固定任务。</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {PHASES[openPhase].tasks.map((tk, ti) => {
                const up = uploaded[openPhase + "-" + ti];
                return (
                  <div key={ti} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 8, background: up ? "var(--ok-soft)" : "var(--surface-2)" }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, background: up ? "var(--ok)" : "var(--surface-3)", color: up ? "#fff" : "var(--ink-soft)", fontSize: 12, fontWeight: 700, display: "grid", placeItems: "center", flex: "none" }}>{up ? "✓" : ti + 1}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{tk.t}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{tk.d}</div>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--ink-soft)", background: "#fff", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 8px", flex: "none" }}>{tk.r}</span>
                    <div style={{ display: "flex", gap: 6, flex: "none" }}>
                      <Button size="sm" icon="upload" onClick={() => {
                        if (up) { UI().toast("「" + tk.t + "」补充上传（演示）"); return; }
                        setUploaded((prev) => ({ ...prev, [openPhase + "-" + ti]: true }));
                        UI().toast("「" + tk.t + "」已上传", "ok");
                      }}>上传</Button>
                      <Button size="sm" icon="eye" disabled={!up} onClick={() => UI().toast(up ? "查看「" + tk.t + "」附件" : "")}>查看</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Panel>
    );
  }

  // —— 右侧文件栏：项目文件汇总（带阶段任务关联标）——
  function FilesCard({ proj }) {
    const files = FILES[proj.id] || FILES.p1;
    const iconOf = (n) => (/\.(jpg|jpeg|png)$/i.test(n) ? "image" : /\.(xls|xlsx)$/i.test(n) ? "table-2" : "file-text");
    return (
      <Panel padding={0} style={{ overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="folder-open" size={15} color="var(--brand)" />
          <span style={{ fontSize: 14, fontWeight: 700 }}>文件 <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--ink-soft)" }}>({files.length})</span></span>
          <span style={{ marginLeft: "auto" }}>
            <Button size="sm" variant="primary" icon="upload" onClick={() => UI().toast("选择文件上传（演示）")}>上传</Button>
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {files.map((f, i) => (
            <div key={i} onClick={() => UI().toast("预览「" + f.name + "」（演示）")} style={{ display: "flex", gap: 10, padding: "10px 14px", borderBottom: i < files.length - 1 ? "1px solid var(--line)" : "none", cursor: "pointer", transition: "background var(--dur-fast)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--brand-soft)", display: "grid", placeItems: "center", flex: "none" }}>
                <Icon name={iconOf(f.name)} size={15} color="var(--brand)" />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.name}>{f.name}</div>
                <div style={{ marginTop: 2, fontSize: 10.5, color: "var(--ink-faint)", display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{f.size}</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{dot(f.time)}</span>
                  <span>{f.by}</span>
                </div>
                <span style={{ display: "inline-block", marginTop: 4, maxWidth: "100%", fontSize: 10, color: "var(--brand-deep)", background: "var(--brand-soft)", borderRadius: 4, padding: "1px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.tag}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  function ProjectDetailScreen({ data, params, navigate }) {
    const id = (params && params.id) || "p1";
    // 反馈轮9 第二层：项目主数据走 window.APP 共享 store（与项目列表同源，编辑互通实时联动）
    const A = window.APP;
    if (A) A.use();
    // 反馈轮9 第三层（多页数据交互）：订阅发票 store —— 发票识别归档 → 本页票据信息/票税管理实时联动
    const [, forceInv] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => (window.INV ? window.INV.subscribe(forceInv) : undefined), []);
    const proj = (A && A.get("projects", id)) || data.projects.find((p) => p.id === id) || data.projects[0];
    const invRows = window.INV ? window.INV.live().filter((iv) => iv.account === "posted" && iv.project === proj.name) : null;
    const invAgg = invRows ? { amt: invRows.reduce((s, iv) => s + Number(iv.total || 0), 0), tax: invRows.reduce((s, iv) => s + Number(iv.tax || 0), 0) } : null;
    // 经营/票税等聚合仍按 id mock（META）；与 store 重叠的基础字段以 store 为准
    const m = { ...(META[proj.id] || META.p1) };
    ["contractName", "operationType", "region", "riskLevel", "overview"].forEach((k) => { if (proj[k] != null && proj[k] !== "") m[k] = proj[k]; });
    if (proj.planEnd != null && proj.planEnd !== "") m.plannedEnd = proj.planEnd;
    const [tab, setTab] = React.useState("info");

    const TABS = [
      { key: "info", label: "详细资料" }, { key: "budget", label: "成本预算" },
      { key: "conContract", label: "施工合同管理" }, { key: "expContract", label: "支出合同管理" },
      { key: "tax", label: "票税管理" }, { key: "fund", label: "资金管理" },
      { key: "current", label: "往来款" }, { key: "pay", label: "支付明细" },
      { key: "material", label: "物资管理" }, { key: "accept", label: "竣工验收及保修" },
    ];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 顶部摘要（横跨全宽） */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <button onClick={() => navigate("project")} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--line)", background: "var(--surface-2)", borderRadius: "var(--radius-btn)", padding: "7px 12px", fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", cursor: "pointer", flex: "none" }}>
              <Icon name="arrow-left" size={15} />返回列表
            </button>
            <span style={{ width: 44, height: 44, borderRadius: 10, background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 800, fontSize: 20, display: "grid", placeItems: "center", flex: "none" }}>{proj.name.slice(0, 1)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18, fontWeight: 800 }}>{proj.name}</span>
                <StatusChip tone={statusTone[proj.status] || "neutral"}>{proj.status}</StatusChip>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{m.contractName} · {m.region}</div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, flex: "none" }}>
              <Button icon="download" onClick={() => UI().toast("正在导出项目台账…")}>导出</Button>
              {/* 反馈轮8：模块级大编辑 —— 红圈「详细资料·基础信息」完整字段（前台展示+编辑弹窗，后台接权限后迁后台） */}
              <Button variant="primary" icon="square-pen" onClick={() => UI().formModal({
                title: "编辑项目 · " + proj.name, cols: 2, width: 640,
                fields: [
                  { key: "name", label: "项目名称", value: proj.name, full: true },
                  { key: "contractName", label: "项目合同名称", value: m.contractName, full: true },
                  { key: "developer", label: "客户（甲方）", value: proj.developer },
                  { key: "developer2", label: "客户2（选填）", value: m.developer2 === "—" ? "" : m.developer2 },
                  { key: "operationType", label: "经营类型", type: "select", options: ["自营", "联营", "挂靠"], value: m.operationType },
                  { key: "status", label: "业务流程阶段", type: "select", options: ["项目立项", "施工准备", "施工中", "完工及竣备", "交付", "保修", "项目完结"], value: proj.status === "在建" ? "施工中" : proj.status },
                  { key: "region", label: "工程地域", value: m.region },
                  { key: "manager", label: "项目经理", value: proj.manager },
                  { key: "contractor", label: "承包单位", value: m.contractor, full: true },
                  { key: "address", label: "工程详细地址", value: proj.address, full: true },
                  { key: "startDate", label: "计划开工日期", value: proj.startDate },
                  { key: "plannedEnd", label: "计划竣工日期", value: m.plannedEnd },
                  { key: "plannedDuration", label: "计划工期（天）", value: m.plannedDuration || "" },
                  { key: "riskLevel", label: "项目风险级别", type: "select", options: ["低", "中", "高"], value: m.riskLevel },
                  { key: "overview", label: "工程概况", type: "textarea", value: m.overview, full: true },
                ],
                // 反馈轮9：写回共享 store → 项目列表页实时联动（同名字段映射 planEnd/stage）
                onSave: (v) => {
                  if (!v.name) { UI().toast("项目名称不能为空", "danger"); return; }
                  const patch = { name: v.name, contractName: v.contractName, developer: v.developer, developer2: v.developer2 || "—",
                    operationType: v.operationType, stage: v.status, region: v.region, manager: v.manager,
                    address: v.address, startDate: v.startDate, planEnd: v.plannedEnd, riskLevel: v.riskLevel, overview: v.overview };
                  if (window.APP) window.APP.update("projects", proj.id, patch);
                  UI().toast("已保存项目信息（项目列表已同步）", "ok");
                },
              })}>编辑</Button>
            </div>
          </div>
          {/* 元数据行（语义固定 5 列） */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1, background: "var(--line)", borderTop: "1px solid var(--line)" }}>
            {[
              ["业务流程阶段", proj.status], ["经营类型", m.operationType], ["项目经理", proj.manager],
              ["客户(甲方)", proj.developer], ["承包单位", m.contractor],
            ].map(([k, v]) => (
              <div key={k} style={{ background: "var(--panel)", padding: "10px 16px", minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{k}</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v || "—"}</div>
              </div>
            ))}
          </div>
        </Panel>

        {/* 分栏：主内容 + 右侧文件栏（280px 固定） */}
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            {/* 进度 · 成本 驾驶舱（#30：数据同首页 window.SCHEDULE） */}
            <ScheduleCostCard proj={proj} navigate={navigate} />

            {/* 项目经营数据（固定 5列×2行） */}
            <Panel padding={16}>
              <SectionHeader extra={<span style={{ fontSize: 11, color: "var(--ink-faint)" }}>自动计算 · 来自下方子表聚合</span>}>项目经营数据</SectionHeader>
              <MetricGrid cols={5}>
                <Metric label="主合同金额" value={yuan(m.biz.main)} formula="Σ 施工合同.含税合同金额" />
                <Metric label="增补合同额" value={yuan(m.biz.supplement)} formula="Σ 补充协议.金额" />
                <Metric label="变洽签审定额" value={yuan(m.biz.ownerChange)} formula="Σ 甲方变洽签.审定金额" />
                <Metric label="变更后合同额" value={yuan(m.biz.main + m.biz.supplement + m.biz.ownerChange)} formula="主合同 + 增补 + 变洽签" tone="brand" />
                <Metric label="项目收款" value={yuan(m.biz.receipt)} formula="Σ 收款登记.收款金额" tone="ok" />
                <Metric label="付款金额" value={yuan(m.biz.payment)} formula="Σ 付款申请.实际支付金额" tone="danger" />
                <Metric label="往来收款" value={yuan(m.biz.curReceipt)} formula="Σ 往来收款.收款金额" tone="ok" />
                <Metric label="往来付款" value={yuan(m.biz.curPayment)} formula="Σ 往来付款.付款金额" tone="danger" />
                <Metric label="扣除管理费" value={yuan(m.biz.mgmt)} formula="按管理费费率计算" />
                <Metric label="项目可用资金余额" value={yuan(m.biz.balance)} formula="项目收款 + 往来收款 − 付款 − 往来付款 − 管理费" tone={m.biz.balance >= 0 ? "ok" : "danger"} big />
              </MetricGrid>
            </Panel>

            {/* 票据信息（固定 6列×1行；进项两格与发票台账实时联动 —— 反馈轮9 第三层） */}
            <Panel padding={16}>
              <SectionHeader extra={<span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{invRows ? "进项与发票台账实时联动（" + invRows.length + " 张归档票）" : "自动计算 · 来自票税管理"}</span>}>票据信息</SectionHeader>
              {(() => {
                const inAmt = invAgg ? invAgg.amt : m.tax.inAmt;
                const inTax = invAgg ? invAgg.tax : m.tax.inTax;
                const vat = Math.max(0, m.tax.outTax - inTax);
                const rate = m.tax.outAmt ? (vat / m.tax.outAmt * 100) : 0;
                return (
                  <MetricGrid cols={6}>
                    <Metric label="销项票额" value={yuan(m.tax.outAmt)} formula="Σ 开票申请.开票金额" />
                    <Metric label="销项税额" value={yuan(m.tax.outTax)} formula="Σ 开票申请.税额" />
                    <Metric label="进项票额" value={yuan(inAmt)} formula="Σ 发票台账(该项目归档票).价税合计 · 实时联动" tone={invAgg ? "brand" : undefined} />
                    <Metric label="进项税额" value={yuan(inTax)} formula="Σ 发票台账(该项目归档票).税额 · 实时联动" tone={invAgg ? "brand" : undefined} />
                    <Metric label="增值税" value={yuan(vat)} formula="销项税额 − 进项税额" tone="brand" />
                    <Metric label="税负率" value={rate.toFixed(2) + "%"} formula="增值税 / 销项票额" tone="brand" />
                  </MetricGrid>
                );
              })()}
            </Panel>

            {/* 阶段时间线（胶囊步进器 + 时间带；key 保证切项目重置内部状态） */}
            <PhaseTimeline key={proj.id} proj={proj} m={m} />

            {/* Tab 栏 */}
            <Panel padding={0} style={{ overflow: "hidden" }}>
              <div style={{ padding: "4px 8px 0" }}>
                <SegTab tabs={TABS} active={tab} onChange={setTab} />
              </div>
              <div style={{ padding: 16, background: "var(--bg)" }}>
                <TabContent tab={tab} proj={proj} m={m} data={data} navigate={navigate} invRows={invRows} />
              </div>
            </Panel>
          </div>

          {/* 右侧文件栏 */}
          <div style={{ width: 280, flex: "none", position: "sticky", top: "calc(var(--header-h) + 16px)" }}>
            <FilesCard proj={proj} />
          </div>
        </div>
      </div>
    );
  }

  function TabContent({ tab, proj, m, data, navigate, invRows }) {
    if (tab === "info") {
      const base = [
        ["项目名称", proj.name], ["项目合同名称", m.contractName], ["客户(甲方)", proj.developer], ["客户2", m.developer2],
        ["工程地域", m.region], ["工程详细地址", proj.address], ["经营类型", m.operationType], ["计划开工日期", proj.startDate],
        ["计划竣工日期", m.plannedEnd], ["计划工期(天)", m.plannedDuration], ["项目风险级别", m.riskLevel], ["审批状态", m.approvalStatus],
        ["业务流程阶段", proj.status], ["工程概况", m.overview],
      ];
      const sys = [
        ["负责人", proj.manager], ["创建人", m.createdBy], ["创建时间", m.createdAt], ["修改人", m.updatedBy], ["修改时间", m.updatedAt],
      ];
      const InfoCard = ({ title, rows, cols }) => (
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", fontSize: 14, fontWeight: 700 }}>{title}</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols || 4}, 1fr)`, gap: 1, background: "var(--line)" }}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ background: "var(--panel)", padding: "10px 16px", minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{k}</div>
                <div style={{ fontSize: 13, marginTop: 3 }}>{v == null || v === "" ? "—" : v}</div>
              </div>
            ))}
          </div>
        </Panel>
      );
      return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}><InfoCard title="基础信息" rows={base} cols={4} /><InfoCard title="系统信息" rows={sys} cols={5} /></div>;
    }

    if (tab === "budget") {
      const rows = [
        { subject: "人工", item: "墙地砖铺贴人工", qty: "24,600 ㎡", price: 62, amount: 1525200 },
        { subject: "材料", item: "瓷砖及辅材采购", qty: "26,800 ㎡", price: 118, amount: 3162400 },
        { subject: "材料", item: "防水涂料", qty: "8,400 ㎡", price: 36, amount: 302400 },
        { subject: "机械", item: "垂直运输机械台班", qty: "220 台班", price: 1450, amount: 319000 },
      ];
      return (
        <SubTable title="目标成本清单" columns={[
          { key: "subject", label: "科目", render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
          { key: "item", label: "分项", render: (v) => <span style={{ color: "var(--brand)", fontWeight: 600 }}>{v}</span> },
          { key: "qty", label: "预算量", align: "right", mono: true },
          { key: "price", label: "单价", align: "right", money: true },
          { key: "amount", label: "金额", align: "right", money: true },
        ]} rows={rows} sum={{ label: "预算金额合计", value: rows.reduce((s, r) => s + r.amount, 0) }} />
      );
    }

    if (tab === "conContract") {
      // 合同文书预览（纯预览留底：翻页/缩放/下载）
      const previewDoc = (doc) => UI().modal({
        title: "合同文书 · " + doc.name, subtitle: doc.pages + " 页 · 纯预览留底（不做 OCR）", width: 560,
        bodyHTML:
          '<div style="display:flex;flex-direction:column;gap:10px">' +
          '<div style="height:340px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:var(--surface-2);border-radius:8px;color:var(--ink-faint)"><div style="font-size:44px;font-weight:800;opacity:.35">PDF</div><div style="font-size:12px">第 1 / ' + doc.pages + ' 页 · 拖动或点击翻页（演示）</div></div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--ink-soft)"><span>‹ 上一页 &nbsp; 第 1 / ' + doc.pages + ' 页 &nbsp; 下一页 ›</span><span>🔍 缩放 · ⬇ 下载原件</span></div>' +
          "</div>",
        actions: [{ label: "关闭" }, { label: "下载原件", primary: true, onClick: () => UI().toast("已下载「" + doc.name + "」（演示）") }],
      });
      // 附件列：合同文书 chip + 清单附件（一对多）
      const chip = (opts) => (
        <button onClick={opts.onClick} title={opts.title} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid " + (opts.tone === "ok" ? "var(--ok)" : opts.tone === "warn" ? "var(--warn)" : "var(--line-strong)"), background: opts.tone === "ok" ? "var(--ok-soft)" : opts.tone === "warn" ? "var(--warn-soft)" : "#fff", color: opts.tone === "ok" ? "var(--ok-ink)" : opts.tone === "warn" ? "var(--warn-ink)" : "var(--ink-soft)", borderRadius: 999, padding: "3px 9px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
          <Icon name={opts.icon} size={11} />{opts.label}
        </button>
      );
      const attachCell = (v, r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--ink-faint)", width: 42 }}>文书</span>
            {r.doc ? chip({ icon: "file-text", label: r.doc.name.length > 10 ? "PDF · " + r.doc.pages + " 页" : r.doc.name, title: r.doc.name, onClick: () => previewDoc(r.doc) })
              : chip({ icon: "upload", label: "上传", onClick: () => UI().toast("上传合同文书（演示）") })}
          </div>
          {r.boqs && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--ink-faint)", width: 42 }}>清单</span>
              {r.boqs.map((b, i) => b.parsed
                ? chip({ key: i, icon: "table-2", tone: "ok", label: "已拆表 " + b.rows + " 行", title: b.name + " · 点击查看清单", onClick: () => navigate("boqList", { contract: b.name.replace(/\.xlsx$/, ""), project: proj.name }) })
                : chip({ key: i, icon: "file-spreadsheet", tone: "warn", label: "待拆表", title: b.name + " · 点击进拆表向导", onClick: () => navigate("boqImport", { contract: b.name.replace(/\.xlsx$/, ""), project: proj.name }) }))}
              {chip({ icon: "plus", label: "清单", title: "上传新清单附件并拆表", onClick: () => navigate("boqImport", { contract: m.contractName, project: proj.name }) })}
            </div>
          )}
        </div>
      );
      const rows = [{ name: m.contractName, amount: m.biz.main, status: "已生效", signDate: proj.startDate, category: "施工总包", signed: m.biz.main,
        doc: { name: "施工合同正本.pdf", pages: 32 },
        boqs: proj.id === "p1"
          ? [{ name: "合和七期户内合同版-清单.xlsx", parsed: true, rows: 1286 }, { name: "公区清单.xlsx", parsed: false }]
          : [{ name: proj.name + "-工程量清单.xlsx", parsed: false }] }];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SubTable title="施工合同" columns={[
            { key: "name", label: "合同名称", render: (v) => <span style={{ color: "var(--brand)", fontWeight: 600 }}>{v}</span> },
            { key: "amount", label: "含税合同金额", align: "right", money: true },
            { key: "status", label: "合同状态", render: (v) => <StatusChip tone="ok">{v}</StatusChip> },
            { key: "signDate", label: "签约日期", mono: true, color: "var(--ink-soft)" },
            { key: "signed", label: "含税已签金额", align: "right", money: true },
            { key: "attach", label: "附件", render: attachCell },
          ]} rows={rows} sum={{ label: "含税合同金额总计", value: m.biz.main }} />
          <SubTable title="补充协议" columns={[{ key: "name", label: "协议名称" }, { key: "amount", label: "金额", align: "right", money: true }, { key: "signDate", label: "签约日期", mono: true }, { key: "attach", label: "附件", render: (v, r) => r.doc ? chip({ icon: "file-text", label: "PDF · " + r.doc.pages + " 页", onClick: () => previewDoc(r.doc) }) : chip({ icon: "upload", label: "上传文书", onClick: () => UI().toast("上传补充协议（演示）") }) }]} rows={m.biz.supplement ? [{ name: "材料涨价补充协议", amount: m.biz.supplement, signDate: "2026-03-10", doc: { name: "补充协议.pdf", pages: 4 } }] : []} />
          <SubTable title="甲方变洽签" columns={[{ key: "no", label: "变更编号", mono: true }, { key: "name", label: "合同名称" }, { key: "inc", label: "含税审定金额", align: "right", money: true }, { key: "exc", label: "无税审定金额", align: "right", money: true }, { key: "date", label: "审定日期", mono: true }]} rows={m.biz.ownerChange ? [{ no: "BQ-001", name: m.contractName, inc: m.biz.ownerChange, exc: Math.round(m.biz.ownerChange / 1.09), date: "2026-04-02" }] : []} />
        </div>
      );
    }

    if (tab === "expContract") {
      const rows = [
        { name: "泥水班组劳务分包合同", supplier: "陈家泥水班组", type: "劳务分包", amount: 2860000, settled: 1240000, status: "履约中" },
        { name: "瓷砖采购合同", supplier: "广东宏宇陶瓷", type: "材料采购", amount: 3580000, settled: 2150000, status: "履约中" },
        { name: "铝扣板供应及安装合同", supplier: "佛山华铝装饰", type: "专业分包", amount: 920000, settled: 0, status: "已签订" },
      ];
      return (
        <SubTable title="支出合同" columns={[
          { key: "name", label: "合同名称", render: (v) => <span style={{ color: "var(--brand)", fontWeight: 600 }}>{v}</span> },
          { key: "supplier", label: "分供方" },
          { key: "type", label: "合同类型" },
          { key: "amount", label: "含税合同额", align: "right", money: true },
          { key: "settled", label: "已结算金额", align: "right", money: true },
          { key: "status", label: "状态", render: (v) => <StatusChip tone={v === "履约中" ? "brand" : v === "已签订" ? "neutral" : "ok"}>{v}</StatusChip> },
        ]} rows={rows} sum={{ label: "含税合同额总计", value: rows.reduce((s, r) => s + r.amount, 0) }} />
      );
    }

    if (tab === "tax") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SubTable title="开票申请" columns={[
            { key: "name", label: "开票申请名称", render: (v) => <span style={{ color: "var(--brand)", fontWeight: 600 }}>{v}</span> },
            { key: "amount", label: "开票金额", align: "right", money: true },
            { key: "tax", label: "税额", align: "right", money: true },
            { key: "status", label: "审核状态", render: (v) => <StatusChip tone="ok">{v}</StatusChip> },
            { key: "date", label: "开票日期", mono: true, color: "var(--ink-soft)" },
          ]} rows={[{ name: "6月进度开票申请", amount: m.tax.outAmt, tax: m.tax.outTax, status: "已审核", date: "2026-06-10" }]} sum={{ label: "合计金额", value: m.tax.outAmt }} />
          <SubTable title="收票登记" columns={[
            { key: "no", label: "发票号码", mono: true, color: "var(--ink-soft)" },
            { key: "contract", label: "合同名称" },
            { key: "amount", label: "发票金额", align: "right", money: true },
            { key: "tax", label: "税额", align: "right", money: true },
            { key: "type", label: "发票类型", render: (v) => <StatusChip tone="brand">{v}</StatusChip> },
            { key: "date", label: "开票日期", mono: true, color: "var(--ink-soft)" },
            { key: "supplier", label: "供应商" },
          ]} rows={(invRows || []).map((iv) => ({ no: (iv.number || "").slice(-8), contract: iv.remark || "材料采购", amount: Number(iv.total) || 0, tax: Number(iv.tax) || 0, type: (iv.type || "").includes("专") ? "专票" : "普票", date: iv.date, supplier: iv.seller }))} sum={{ label: "合计金额（实时联动发票台账）", value: (invRows || []).reduce((s, iv) => s + Number(iv.total || 0), 0) }} />
        </div>
      );
    }

    if (tab === "fund") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SubTable title="收款登记" columns={[
            { key: "no", label: "收款编号", mono: true }, { key: "date", label: "收款日期", mono: true, color: "var(--ink-soft)" },
            { key: "amount", label: "收款金额", align: "right", money: true, color: "var(--ok-ink)" },
            { key: "method", label: "支付方式" }, { key: "payer", label: "支付单位" },
            { key: "cum", label: "累计应收", align: "right", money: true },
          ]} rows={m.biz.receipt ? [{ no: "SK-2026-001", date: "2026-05-30", amount: m.biz.receipt, method: "银行转账", payer: proj.developer, cum: m.biz.receipt }] : []} sum={{ label: "项目收款合计", value: m.biz.receipt }} />
          <SubTable title="付款申请" columns={[
            { key: "no", label: "付款编号", mono: true }, { key: "status", label: "审批状态", render: (v) => <StatusChip tone={v === "已付款" ? "ok" : "warn"}>{v}</StatusChip> },
            { key: "applicant", label: "申请人" }, { key: "amount", label: "申请金额", align: "right", money: true },
            { key: "paid", label: "已付金额", align: "right", money: true }, { key: "actual", label: "实际支付", align: "right", money: true, color: "var(--danger-ink)" },
          ]} rows={m.biz.payment ? [{ no: "FK-2026-001", status: "已付款", applicant: proj.manager, amount: m.biz.payment, paid: m.biz.payment, actual: m.biz.payment }] : [{ no: "FK-2026-001", status: "待审批", applicant: proj.manager, amount: 200000, paid: 0, actual: 0 }]} sum={{ label: "付款金额合计", value: m.biz.payment }} />
        </div>
      );
    }

    if (tab === "current") {
      const cr = m.biz.curReceipt, cp = m.biz.curPayment;
      const rIn = cr > 0
        ? [{ no: "WL-SK-001", date: "2026-04-12", amount: Math.round(cr * 0.6), payer: proj.developer }, { no: "WL-SK-002", date: "2026-06-05", amount: cr - Math.round(cr * 0.6), payer: proj.developer }]
        : [{ no: "WL-SK-001", date: "2026-03-18", amount: 80000, payer: proj.developer }, { no: "WL-SK-002", date: "2026-05-22", amount: 45000, payer: "公司总部" }];
      const rOut = cp > 0
        ? [{ no: "WL-FK-001", status: "已付款", date: "2026-04-20", payee: "公司总部", amount: Math.round(cp * 0.7), method: "银行转账" }, { no: "WL-FK-002", status: "审批中", date: "2026-06-18", payee: "锦绣华庭项目部", amount: cp - Math.round(cp * 0.7), method: "内部划转" }]
        : [{ no: "WL-FK-001", status: "已付款", date: "2026-04-08", payee: "公司总部", amount: 60000, method: "银行转账" }, { no: "WL-FK-002", status: "审批中", date: "2026-06-10", payee: "公司总部", amount: 38000, method: "内部划转" }];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SubTable title="往来收款" columns={[
            { key: "no", label: "往来收款编号", mono: true },
            { key: "date", label: "收款日期", mono: true, color: "var(--ink-soft)" },
            { key: "amount", label: "收款金额", align: "right", money: true, color: "var(--ok-ink)" },
            { key: "payer", label: "付款人" },
          ]} rows={rIn} sum={{ label: "往来收款合计", value: rIn.reduce((s, r) => s + r.amount, 0) }} />
          <SubTable title="往来付款" columns={[
            { key: "no", label: "往来付款编号", mono: true },
            { key: "status", label: "审批状态", render: (v) => <StatusChip tone={v === "已付款" ? "ok" : "warn"}>{v}</StatusChip> },
            { key: "date", label: "付款日期", mono: true, color: "var(--ink-soft)" },
            { key: "payee", label: "收款单位" },
            { key: "amount", label: "金额", align: "right", money: true, color: "var(--danger-ink)" },
            { key: "method", label: "付款方式" },
          ]} rows={rOut} sum={{ label: "往来付款合计", value: rOut.reduce((s, r) => s + r.amount, 0) }} />
        </div>
      );
    }

    if (tab === "pay") {
      const rows = [
        { no: "ZF-2026-0601", payee: "陈家泥水班组", amount: 380000, method: "银行转账", date: "2026-06-05", by: "财务-刘会计" },
        { no: "ZF-2026-0518", payee: "广东宏宇陶瓷", amount: 652000, method: "银行承兑", date: "2026-05-18", by: "财务-刘会计" },
        { no: "ZF-2026-0430", payee: "佛山华铝装饰", amount: 120000, method: "银行转账", date: "2026-04-30", by: "财务-张出纳" },
      ];
      return (
        <SubTable title="支付记录" columns={[
          { key: "no", label: "付款单号", mono: true },
          { key: "payee", label: "收款方" },
          { key: "amount", label: "金额", align: "right", money: true, color: "var(--danger-ink)" },
          { key: "method", label: "支付方式" },
          { key: "date", label: "支付日期", mono: true, color: "var(--ink-soft)" },
          { key: "by", label: "经手人" },
        ]} rows={rows} sum={{ label: "支付金额合计", value: rows.reduce((s, r) => s + r.amount, 0) }} />
      );
    }

    if (tab === "material") {
      const arrive = [
        { no: "DH-0612", material: "瓷砖 800×800", spec: "灰色亮面", qty: "3,200 箱", supplier: "广东宏宇陶瓷", date: "2026-06-12" },
        { no: "DH-0605", material: "防水涂料", spec: "JS-Ⅱ型 20kg", qty: "460 桶", supplier: "德高建材", date: "2026-06-05" },
        { no: "DH-0528", material: "铝扣板 300×300", spec: "白色哑光", qty: "1,150 ㎡", supplier: "佛山华铝装饰", date: "2026-05-28" },
      ];
      const usage = [
        { no: "LY-0615", material: "瓷砖 800×800", qty: "420 箱", crew: "陈家泥水班组", usage: "10栋 3-5层 地砖铺贴", date: "2026-06-15" },
        { no: "LY-0608", material: "防水涂料", qty: "86 桶", crew: "陈家泥水班组", usage: "12栋 卫生间防水", date: "2026-06-08" },
      ];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SubTable title="乙供材到货" columns={[
            { key: "no", label: "单据编号", mono: true },
            { key: "material", label: "材料名称", render: (v) => <span style={{ color: "var(--brand)", fontWeight: 600 }}>{v}</span> },
            { key: "spec", label: "规格" },
            { key: "qty", label: "到货数量", align: "right", mono: true },
            { key: "supplier", label: "分供方" },
            { key: "date", label: "到货日期", mono: true, color: "var(--ink-soft)" },
          ]} rows={arrive} />
          <SubTable title="材料领用" columns={[
            { key: "no", label: "领用单号", mono: true },
            { key: "material", label: "材料名称" },
            { key: "qty", label: "领用数量", align: "right", mono: true },
            { key: "crew", label: "领用班组" },
            { key: "usage", label: "用途" },
            { key: "date", label: "领用日期", mono: true, color: "var(--ink-soft)" },
          ]} rows={usage} />
        </div>
      );
    }

    if (tab === "accept") {
      const checks = [
        { no: "YS-001", scope: "防水隐蔽工程（10栋）", date: "2026-06-10", parties: "建设/监理/施工", result: "合格" },
        { no: "YS-002", scope: "水电预埋隐蔽工程（12栋）", date: "2026-06-20", parties: "建设/监理/施工", result: "限期整改" },
      ];
      const repairs = [
        { no: "BX-001", item: "3栋2单元 卫生间渗水", date: "2026-06-18", status: "处理中", by: "王维修" },
        { no: "BX-002", item: "样板房 墙面空鼓修复", date: "2026-05-30", status: "已完成", by: "陈家泥水班组" },
      ];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SubTable title="验收记录" columns={[
            { key: "no", label: "验收编号", mono: true },
            { key: "scope", label: "验收范围", render: (v) => <span style={{ color: "var(--brand)", fontWeight: 600 }}>{v}</span> },
            { key: "date", label: "验收日期", mono: true, color: "var(--ink-soft)" },
            { key: "parties", label: "参与方" },
            { key: "result", label: "结论", render: (v) => <StatusChip tone={v === "合格" ? "ok" : "warn"}>{v}</StatusChip> },
          ]} rows={checks} />
          <SubTable title="保修事项" columns={[
            { key: "no", label: "编号", mono: true },
            { key: "item", label: "保修事项" },
            { key: "date", label: "报修日期", mono: true, color: "var(--ink-soft)" },
            { key: "status", label: "状态", render: (v) => <StatusChip tone={v === "已完成" ? "ok" : "warn"}>{v}</StatusChip> },
            { key: "by", label: "处理人" },
          ]} rows={repairs} />
        </div>
      );
    }

    return null;
  }

  window.ProjectDetailScreen = ProjectDetailScreen;
})();
