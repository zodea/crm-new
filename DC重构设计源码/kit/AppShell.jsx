// AppShell — 桌面壳：左侧「分组 + 可收起」侧边栏 + 顶栏 + 主内容区。
// 改版要点（design §3.1/§12.1）：扁平 tab → 分组侧边栏；支持整体收起成图标模式，分组可折叠。
(function () {
  const { NavItem, Icon } = window.DesignSystem_e3d871;

  // 导航树：group=可折叠分组（含子项）；item=独立顶层项。
  const NAV = [
    { type: "group", key: "g-invoice", label: "发票", icon: "receipt-text", items: [
      { key: "invoice", mark: "票", label: "发票列表", hint: "识别校对入账", title: "发票管理", subtitle: "识别·校对·入账" },
      { key: "factor", mark: "因", label: "开票·税额工具", hint: "推算数量·税额大写", title: "开票因子推算 · 税额计算", subtitle: "因子推断数量 · 价税分离 · 人民币大写" },
    ] },
    { type: "item", key: "delivery", mark: "单", label: "送货单", hint: "扫描整理归档", title: "送货单", subtitle: "扫描·整理·归档" },
    { type: "item", key: "supplier", mark: "方", label: "分供方", hint: "资料管理对账", title: "分供方资料库", subtitle: "资料管理·对账" },
    { type: "group", key: "g-project", label: "项目", icon: "building", items: [
      { key: "project", mark: "项", label: "项目列表", hint: "工期进度", title: "施工项目", subtitle: "项目管理" },
      { key: "quantity", mark: "量", label: "工程量管理", hint: "矩阵可视化", title: "工程量矩阵", subtitle: "楼层×户号×分项 · 按月着色" },
    ] },
    { type: "group", key: "g-crew", label: "班组", icon: "users", items: [
      { key: "crew", mark: "组", label: "班组管理", hint: "单价·配置", title: "班组管理", subtitle: "全局核算单元 · 跨项目复用" },
      { key: "worker", mark: "工", label: "工人信息", hint: "人员证书", title: "工人信息库", subtitle: "人员管理" },
      { key: "payroll", mark: "资", label: "工资管理", hint: "核算发放", title: "工资核算", subtitle: "班组×项目×月份 · 计件 / 计时" },
    ] },
    { type: "item", key: "price", mark: "价", label: "单价对比", hint: "材料价格分析", title: "单价对比", subtitle: "材料价格分析" },
  ];

  // 扁平索引（查 active 项的标题）
  const FLAT = {};
  NAV.forEach((n) => n.type === "group" ? n.items.forEach((it) => { FLAT[it.key] = it; }) : (FLAT[n.key] = n));
  FLAT["crewDetail"] = { title: "班组详情", subtitle: "基本信息 · 工人配置 · 分项单价" };
  FLAT["payrollDetail"] = { title: "工资明细", subtitle: "分项工程量 · 计算流程" };
  window.KIT_NAV = NAV;

  function GroupHeader({ label, icon, open, onToggle, collapsed }) {
    const [hover, setHover] = React.useState(false);
    if (collapsed) return React.createElement("div", { style: { height: 1, background: "var(--line)", margin: "8px 6px" } });
    return (
      <button type="button" onClick={onToggle}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: 0, background: hover ? "var(--surface-3)" : "transparent", borderRadius: "var(--radius-btn)", padding: "8px 10px", marginTop: 4, cursor: "pointer", color: "var(--ink-soft)" }}>
        <Icon name={icon} size={15} />
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "var(--tracking-wide)", flex: 1, textAlign: "left" }}>{label}</span>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
      </button>
    );
  }

  // 图标模式下的紧凑项（仅单字方块）
  function MiniItem({ mark, label, active, onClick }) {
    const [hover, setHover] = React.useState(false);
    return (
      <button type="button" onClick={onClick} title={label}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{ display: "grid", placeItems: "center", width: 40, height: 40, margin: "2px auto", border: "1px solid",
          borderRadius: "var(--radius-btn)", cursor: "pointer", fontSize: 15, fontWeight: 800,
          background: active ? "var(--brand-soft)" : hover ? "var(--surface-3)" : "var(--surface-2)",
          borderColor: active ? "rgba(37,99,235,0.25)" : "var(--line)",
          color: active ? "var(--brand)" : "var(--ink-soft)",
          boxShadow: active ? "var(--ring-selected)" : "none" }}>
        {mark}
      </button>
    );
  }

  function AppShell({ route, onNav, onSettings, children }) {
    const [collapsed, setCollapsed] = React.useState(false);
    const [open, setOpen] = React.useState({ "g-invoice": true, "g-project": true, "g-crew": true });
    const active = FLAT[route] || NAV[0];
    const W = collapsed ? 68 : 248;

    return (
      <div style={{ minHeight: "100%", background: "var(--bg)", color: "var(--ink)" }}>
        <aside style={{ position: "fixed", insetBlock: 0, left: 0, zIndex: 30, width: W,
          background: "var(--panel)", borderRight: "1px solid var(--line)",
          display: "flex", flexDirection: "column", padding: collapsed ? "16px 8px" : "16px 12px",
          transition: "width var(--dur-base) var(--ease-snappy)" }}>

          {/* 品牌 + 收起按钮 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: collapsed ? "0 0 16px" : "0 8px 20px", justifyContent: collapsed ? "center" : "flex-start" }}>
            <span style={{ display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 8, background: "var(--brand)", color: "#fff", fontWeight: 800, fontSize: 16, flex: "none" }}>瑞</span>
            {!collapsed && (
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>瑞航 CRM</div>
                <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>工程财务管理</div>
              </div>
            )}
          </div>

          <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", overflowX: "hidden" }}>
            {NAV.map((n) => {
              if (n.type === "item") {
                return collapsed
                  ? <MiniItem key={n.key} mark={n.mark} label={n.label} active={route === n.key} onClick={() => onNav(n.key)} />
                  : <NavItem key={n.key} mark={n.mark} label={n.label} hint={n.hint} active={route === n.key} onClick={() => onNav(n.key)} />;
              }
              if (collapsed) {
                return (
                  <React.Fragment key={n.key}>
                    <div style={{ height: 1, background: "var(--line)", margin: "8px 6px" }}></div>
                    {n.items.map((it) => <MiniItem key={it.key} mark={it.mark} label={it.label} active={route === it.key} onClick={() => onNav(it.key)} />)}
                  </React.Fragment>
                );
              }
              const isOpen = open[n.key];
              return (
                <div key={n.key}>
                  <GroupHeader label={n.label} icon={n.icon} open={isOpen} onToggle={() => setOpen((o) => ({ ...o, [n.key]: !o[n.key] }))} />
                  {isOpen && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 8, marginLeft: 8, borderLeft: "1px solid var(--line)" }}>
                      {n.items.map((it) => <NavItem key={it.key} mark={it.mark} label={it.label} hint={it.hint} active={route === it.key} onClick={() => onNav(it.key)} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <button type="button" onClick={() => setCollapsed((c) => !c)}
            style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", border: "1px solid var(--line)", background: "var(--surface-2)", borderRadius: "var(--radius-btn)", padding: "8px", cursor: "pointer", color: "var(--ink-soft)", fontSize: 12, fontWeight: 700 }}>
            <Icon name={collapsed ? "panel-left-open" : "panel-left-close"} size={16} />
            {!collapsed && <span>收起侧栏</span>}
          </button>
          {!collapsed && (
            <div style={{ paddingTop: 12, marginTop: 12, borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.7 }}>
              <div>本地工具 · 数据不上传</div>
              <div>v2.0 · 工程量 / 工资模块</div>
            </div>
          )}
        </aside>

        {/* 主区 */}
        <div style={{ paddingLeft: W, minHeight: "100vh", transition: "padding-left var(--dur-base) var(--ease-snappy)" }}>
          <header style={{ position: "sticky", top: 0, zIndex: 20, height: "var(--header-h)",
            background: "rgba(255,255,255,0.95)", backdropFilter: "blur(8px)",
            borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 16, padding: "0 24px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>{active.title || active.label}</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{active.subtitle}</div>
            </div>
            <window.DesignSystem_e3d871.Button icon="settings" onClick={onSettings}>设置</window.DesignSystem_e3d871.Button>
          </header>
          <main style={{ maxWidth: "var(--content-max)", margin: "0 auto", padding: 16 }}>
            {children}
          </main>
        </div>
      </div>
    );
  }

  window.AppShell = AppShell;
})();
