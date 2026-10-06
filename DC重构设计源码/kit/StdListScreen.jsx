// StdListScreen — 标准单表列表屏（按实现端 app/components/material/MaterialListScreen.vue 与
// app/components/finance/FinanceListScreen.vue 校准的共享底座；材料 9 屏 / 财务 6 屏薄壳复用）。
// 实现端形态铁律：
//   工具栏 = Panel（标题 17px/800；右侧 搜索 272px + 刷新 + 新建）
//   表格   = 36px 紧凑行高、# 序号列、首列实体 link（点击进整页表单）、状态 chip（草稿=brand，其余=ok）、
//            操作列 icon 按钮；横滚只发生在表格容器内；空态 = inbox 图标 + 标题 + 说明
//   底部   = 「共 N 条 · <合计口径> <值>」右对齐合计条（材料=数量合计，财务=金额合计）
//   筛选   = 工具栏第二行 SelectFilter 序列（#199–#203 验收条要求的目标态；2026-08-01 裁定:
//            实现端标准列表尚未做筛选/分页,设计稿先行给出基准,实现端按此补齐,不再反向删除）
//   分页   = 底部合计条左侧「第 x / y 页 ‹ ›」,pageSize 默认 10;搜索/筛选变化回到第 1 页
//   实现端标准列表【没有】业务态视图 chip、导入导出、列显隐 —— 设计稿一并不放。
// props 契约：
//   title/subtitle          工具栏标题；subtitle 保留兼容调用方但不在界面重复展示
//   searchPlaceholder       搜索占位（材料/财务各自照抄实现端文案）
//   searchKeys              搜索命中字段（按 row 展示值匹配）
//   columns [{key,label,width,minWidth,align,mono,money,link,render(v,row)}]  不含 #/操作（自动补）
//   rows                    展示行（调用方已把 store 行映射成展示行）
//   onCreate/createLabel    新建按钮；onRowOpen(row) 首列 link 与「编辑」按钮共用
//   onDelete(row)           传入则操作列带删除（材料屏有、财务屏无 —— 同实现端）
//   footerSummary(rows) -> {label, value}   底部合计条口径（基于筛选后全集，不是当前页）
//   filters [{key,label,minWidth}]  下拉筛选;options 自动取 rows[key] 的去重值,首项「全部」
//   pageSize=10             分页大小;传 0 关闭分页
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
    const [fsel, setFsel] = React.useState({});
    const [page, setPage] = React.useState(1);
    const filters = props.filters || [];
    const kw = q.trim().toLowerCase();
    let shown = kw
      ? props.rows.filter((r) => (props.searchKeys || props.columns.map((c) => c.key))
          .some((k) => String(r[k] == null ? "" : r[k]).toLowerCase().includes(kw)))
      : props.rows;
    filters.forEach((f) => {
      const v = fsel[f.key];
      if (v) shown = shown.filter((r) => String(r[f.key] == null ? "" : r[f.key]) === v);
    });
    const hasActiveFilter = filters.some((f) => fsel[f.key]);

    // 分页（#199–#203 验收条目标态；footerSummary 与「共 N 条」基于筛选后全集）
    const pageSize = props.pageSize != null ? props.pageSize : 10;
    const pages = pageSize > 0 ? Math.max(1, Math.ceil(shown.length / pageSize)) : 1;
    const cur = Math.min(page, pages);
    const paged = pageSize > 0 ? shown.slice((cur - 1) * pageSize, cur * pageSize) : shown;
    const idxBase = pageSize > 0 ? (cur - 1) * pageSize : 0;

    const distinct = (key) => {
      const seen = {};
      const out = [];
      props.rows.forEach((r) => { const v = r[key]; if (v != null && v !== "" && !seen[v]) { seen[v] = 1; out.push(String(v)); } });
      return out;
    };

    const minRows = props.minRows != null ? props.minRows : 10;
    const fill = Math.max(0, minRows - paged.length);
    const yuan2 = (v) => (v == null || v === "" ? "—" : "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

    const TH = { padding: "0 12px", height: ROW_H, fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)", position: "sticky", top: 0, zIndex: 1 };
    const TD = { padding: "0 12px", height: ROW_H, fontSize: 13, verticalAlign: "middle", whiteSpace: "nowrap" };

    const colSpan = props.columns.length + 2;
    const summary = props.footerSummary ? props.footerSummary(shown) : null;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {/* 工具栏（实现端：panel header，标题 / 搜索+刷新+新建） */}
        <Panel padding={0} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 16px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{props.title}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <KA.SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={props.searchPlaceholder || "搜索"} width={272} />
            <Button icon="refresh-cw" onClick={() => UI().toast("已刷新")}>刷新</Button>
            <Button variant="primary" icon="plus" onClick={props.onCreate}>{props.createLabel || ("新建" + props.title)}</Button>
          </div>
          {/* 筛选行（#199–#203 验收条目标态；实现端待补齐，见头注释） */}
          {filters.length > 0 && (
            <div style={{ width: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, paddingTop: 10, borderTop: "1px dashed var(--line)" }}>
              {filters.map((f) => (
                <KA.SelectFilter key={f.key} label={f.label} value={fsel[f.key] || ""} minWidth={f.minWidth || 148}
                  options={[{ key: "", label: "全部" }].concat(distinct(f.key).map((v) => ({ key: v, label: v })))}
                  onChange={(v) => { setFsel((s) => ({ ...s, [f.key]: v })); setPage(1); }} />
              ))}
              {hasActiveFilter && (
                <Button icon="x" onClick={() => { setFsel({}); setPage(1); }}>清除筛选</Button>
              )}
            </div>
          )}
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
                {paged.map((r, i) => (
                  <tr key={r.id || i} style={{ borderBottom: "1px solid var(--line)", height: ROW_H }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ ...TD, color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>{idxBase + i + 1}</td>
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
                        <IconButton icon={props.rowOpenIcon || "square-pen"} title={props.rowOpenLabel || (props.onDelete ? "查看/编辑" : "编辑")} onClick={() => props.onRowOpen && props.onRowOpen(r)} />
                        {props.onDelete && <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => props.onDelete(r)} />}
                      </span>
                    </td>
                  </tr>
                ))}
                {/* 空态（实现端 KitTable：inbox 图标 + 标题 + 说明） */}
                {paged.length === 0 && (
                  <tr style={{ height: ROW_H * minRows }}>
                    <td colSpan={colSpan} style={{ padding: "40px 24px", textAlign: "center" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                        <Icon name="inbox" size={28} color="var(--ink-faint)" />
                        <b style={{ fontSize: 14, color: "var(--ink)" }}>{props.empty || "暂无数据"}</b>
                      </div>
                    </td>
                  </tr>
                )}
                {paged.length > 0 && Array.from({ length: fill }).map((_, i) => (
                  <tr key={"fill" + i} style={{ borderBottom: "1px solid var(--line)", height: ROW_H }}>
                    <td colSpan={colSpan} style={{ padding: 0 }} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 底部条：左分页（验收条目标态）/ 右合计（合计基于筛选后全集） */}
          <div style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)", padding: "6px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-soft)" }}>
            {pageSize > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconButton icon="chevron-left" title="上一页" onClick={() => setPage(Math.max(1, cur - 1))} />
                <span style={{ fontFamily: "var(--font-mono)" }}>第 {cur} / {pages} 页</span>
                <IconButton icon="chevron-right" title="下一页" onClick={() => setPage(Math.min(pages, cur + 1))} />
              </span>
            )}
            <span style={{ marginLeft: "auto" }}>
              共 {shown.length} 条{summary && (
                <span> · {summary.label}
                  <b style={{ marginLeft: 4, fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{summary.value}</b>
                </span>
              )}
            </span>
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
