// StdListScreen — 标准单表列表屏（按实现端 app/components/material/MaterialListScreen.vue 与
// app/components/finance/FinanceListScreen.vue 校准的共享底座；材料 9 屏 / 财务 6 屏薄壳复用）。
// 实现端形态铁律：
//   工具栏 = Panel（标题 17px/800 + 副标题 11px faint；右侧 搜索 272px + 刷新 + 新建）
//   表格   = 36px 紧凑行高、# 序号列、首列实体 link（点击进整页表单）、状态 chip（草稿=brand，其余=ok）、
//            操作列 icon 按钮；横滚只发生在表格容器内；空态 = inbox 图标 + 标题 + 说明
//   底部   = 「共 N 条 · <合计口径> <值>」右对齐合计条（材料=数量合计，财务=金额合计）
//   实现端标准列表【没有】业务态视图 chip、下拉筛选、导入导出、列显隐、分页条 —— 设计稿一并不放。
// props 契约：
//   title/subtitle          工具栏标题与副标题（照抄实现端 *_FORM_META label/subtitle）
//   searchPlaceholder       搜索占位（材料/财务各自照抄实现端文案）
//   searchKeys              搜索命中字段（按 row 展示值匹配）
//   columns [{key,label,width,minWidth,align,mono,money,link,render(v,row)}]  不含 #/操作（自动补）
//   rows                    展示行（调用方已把 store 行映射成展示行）
//   onCreate/createLabel    新建按钮；onRowOpen(row) 首列 link 与「编辑」按钮共用
//   onDelete(row)           传入则操作列带删除（材料屏有、财务屏无 —— 同实现端）
//   footerSummary(rows) -> {label, value}   底部合计条口径
//   minRows=10 tableMinWidth  表格展示行数下限 / 容器内横滚下限
(function () {
  if (window.StdListScreen) { window.StdListPreload = window.StdListPreload || function () { return null; }; return; }

  const ROW_H = 36;

  function StdListScreen(props) {
    const DS = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const { Panel, Button, IconButton, Icon, StatusChip } = DS;
    const UI = () => window.KitUI || { toast: function () {} };
    if (!Panel || !KA.SearchInput) return null;

    const [q, setQ] = React.useState("");
    const kw = q.trim().toLowerCase();
    const shown = kw
      ? props.rows.filter((r) => (props.searchKeys || props.columns.map((c) => c.key))
          .some((k) => String(r[k] == null ? "" : r[k]).toLowerCase().includes(kw)))
      : props.rows;

    const minRows = props.minRows != null ? props.minRows : 10;
    const fill = Math.max(0, minRows - shown.length);
    const yuan2 = (v) => (v == null || v === "" ? "—" : "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

    const TH = { padding: "0 12px", height: ROW_H, fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)", position: "sticky", top: 0, zIndex: 1 };
    const TD = { padding: "0 12px", height: ROW_H, fontSize: 13, verticalAlign: "middle", whiteSpace: "nowrap" };

    const colSpan = props.columns.length + 2;
    const summary = props.footerSummary ? props.footerSummary(shown) : null;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {/* 工具栏（实现端：panel header，标题+副标题 / 搜索+刷新+新建） */}
        <Panel padding={0} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 16px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{props.title}</div>
            <div style={{ marginTop: 2, fontSize: 11, color: "var(--ink-faint)" }}>{props.subtitle}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <KA.SearchInput value={q} onChange={setQ} placeholder={props.searchPlaceholder || "搜索"} width={272} />
            <Button icon="refresh-cw" onClick={() => UI().toast("已刷新")}>刷新</Button>
            <Button variant="primary" icon="plus" onClick={props.onCreate}>{props.createLabel || ("新建" + props.title)}</Button>
          </div>
        </Panel>

        {/* 表格（36px 紧凑行高；横滚只在本容器内） */}
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: props.tableMinWidth || 960, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <th style={{ ...TH, width: 54 }}>#</th>
                  {props.columns.map((c) => (
                    <th key={c.key} style={{ ...TH, width: c.width, minWidth: c.minWidth, textAlign: c.align || "left" }}>{c.label}</th>
                  ))}
                  <th style={{ ...TH, width: props.onDelete ? 104 : 72, textAlign: "center" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.id || i} style={{ borderBottom: "1px solid var(--line)", height: ROW_H }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ ...TD, color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>{i + 1}</td>
                    {props.columns.map((c) => {
                      const v = r[c.key];
                      let content;
                      if (c.render) content = c.render(v, r);
                      else if (c.link) content = (
                        <button type="button" onClick={() => props.onRowOpen && props.onRowOpen(r)}
                          style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                          {v == null || v === "" ? "未命名记录" : v}
                        </button>
                      );
                      else if (c.money) content = <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{yuan2(v)}</span>;
                      else content = (v == null || v === "" ? "—" : v);
                      return (
                        <td key={c.key} style={{ ...TD, textAlign: c.align || "left", fontFamily: c.mono ? "var(--font-mono)" : undefined,
                          maxWidth: c.maxWidth, overflow: c.maxWidth ? "hidden" : undefined, textOverflow: c.maxWidth ? "ellipsis" : undefined }}>{content}</td>
                      );
                    })}
                    <td style={{ ...TD, textAlign: "center" }}>
                      <span style={{ display: "inline-flex", gap: 4 }}>
                        <IconButton icon="square-pen" title={props.onDelete ? "查看/编辑" : "编辑"} onClick={() => props.onRowOpen && props.onRowOpen(r)} />
                        {props.onDelete && <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => props.onDelete(r)} />}
                      </span>
                    </td>
                  </tr>
                ))}
                {/* 空态（实现端 KitTable：inbox 图标 + 标题 + 说明） */}
                {shown.length === 0 && (
                  <tr style={{ height: ROW_H * minRows }}>
                    <td colSpan={colSpan} style={{ padding: "40px 24px", textAlign: "center" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                        <Icon name="inbox" size={28} color="var(--ink-faint)" />
                        <b style={{ fontSize: 14, color: "var(--ink)" }}>{props.empty || "暂无数据"}</b>
                        <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>请调整筛选条件，或检查当前业务范围。</span>
                      </div>
                    </td>
                  </tr>
                )}
                {shown.length > 0 && Array.from({ length: fill }).map((_, i) => (
                  <tr key={"fill" + i} style={{ borderBottom: "1px solid var(--line)", height: ROW_H }}>
                    <td colSpan={colSpan} style={{ padding: 0 }} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 底部合计条（实现端：border-t bg-surface-2 右对齐） */}
          <div style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)", padding: "8px 16px", textAlign: "right", fontSize: 12, color: "var(--ink-soft)" }}>
            共 {shown.length} 条{summary && (
              <span> · {summary.label}
                <b style={{ marginLeft: 4, fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{summary.value}</b>
              </span>
            )}
          </div>
        </Panel>
      </div>
    );
  }

  // 状态 chip：实现端口径 —— 草稿 = chip-brand，其余（已提交/已过账/已生效/已确认…）= chip-ok；
  // 支付记录的「待核对」单独给 warn（实现端 needs_review 态在核对工作流里以 warn 呈现）。
  function stdStatusChip(v) {
    const { StatusChip } = window.DesignSystem_e3d871 || {};
    if (!StatusChip) return v;
    const tone = v === "草稿" ? "brand" : v === "待核对" ? "warn" : "ok";
    return <StatusChip tone={tone}>{v || "草稿"}</StatusChip>;
  }

  window.StdListScreen = StdListScreen;
  window.stdStatusChip = stdStatusChip;
  window.StdListPreload = function () { return null; };
})();
