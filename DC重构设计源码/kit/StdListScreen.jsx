// StdListScreen — 标准单表列表屏（按实现端 app/components/material/MaterialListScreen.vue 与
// app/components/finance/FinanceListScreen.vue 校准的共享底座；材料 9 屏 / 财务 6 屏薄壳复用）。
// 形态（2026-10-07 评审 C-05）：工具条 / 筛选 / 已生效条件走 ListShell，表格 / 分页 / 汇总 / 空态走 KitTable，
//   与 EntityListScreen 同一套红圈列表外观；本文件只保留 rows 驱动的数据管道（搜索、按列去重筛选、汇总口径）。
//   首列 link 打开整页表单；状态 chip 草稿=brand、待核对=warn、其余=ok；材料屏带删除、财务屏无 —— 同实现端。
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
//   pageSize=20             分页大小（KitTable 分页条）
//   tableMinWidth  容器内横滚下限（表格有几行画几行，不补空行）
(function () {
  if (window.StdListScreen) { window.StdListPreload = window.StdListPreload || function () { return null; }; return; }

  function StdListScreen(props) {
    const { IconButton } = window.DesignSystem_e3d871 || {};
    const UI = () => window.KitUI || { toast: function () {} };
    if (!window.ListShell || !window.KitTable) return null;

    const [q, setQ] = React.useState("");
    const [fsel, setFsel] = React.useState({});
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

    const distinct = (key) => {
      const seen = {};
      const out = [];
      props.rows.forEach((r) => { const v = r[key]; if (v != null && v !== "" && !seen[v]) { seen[v] = 1; out.push(String(v)); } });
      return out;
    };
    const summary = props.footerSummary ? props.footerSummary(shown) : null;

    const columns = props.columns.map((c) => (c.link ? { ...c, render: (v, r) => (
      <button type="button" onClick={(e) => { e.stopPropagation(); props.onRowOpen && props.onRowOpen(r); }}
        style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 600, cursor: "pointer", textAlign: "left", font: "inherit" }}>
        {v == null || v === "" ? "未命名记录" : v}
      </button>) } : c)).concat([{
      key: "_ops", label: "操作", width: props.onDelete ? 88 : 60, align: "center", fixed: "right", resizable: false,
      render: (v, r) => (
        <span style={{ display: "inline-flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <IconButton icon={props.rowOpenIcon || "square-pen"} title={props.rowOpenLabel || (props.onDelete ? "查看/编辑" : "编辑")} onClick={() => props.onRowOpen && props.onRowOpen(r)} />
          {props.onDelete && <IconButton icon="trash-2" tone="danger" title="删除" onClick={() => props.onDelete(r)} />}
        </span>),
    }]);

    return (
      <window.ListShell
        title={props.title} count={shown.length}
        search={q} onSearch={setQ} searchPlaceholder={props.searchPlaceholder || "搜索"}
        filters={filters.map((f) => ({ key: f.key, label: f.label, width: f.minWidth || 148,
          options: distinct(f.key).map((v) => ({ value: v, label: v })), value: fsel[f.key] || "",
          onChange: (v) => setFsel((st) => ({ ...st, [f.key]: v })) }))}
        onRefresh={() => UI().toast("已刷新")}
        onCreate={props.onCreate} createLabel={props.createLabel || ("新建" + props.title)}
        renderTable={(toolbar) => (
          <window.KitTable toolbar={toolbar} columns={columns} rows={shown} pageSize={props.pageSize || 20} height="fill"
            tableMinWidth={props.tableMinWidth || 960}
            sum={summary ? { label: summary.label, value: summary.value } : undefined}
            empty={(kw || hasActiveFilter)
              ? { title: "没有符合条件的" + props.title, description: "调整或清除筛选条件后再试", icon: "search-x" }
              : { title: props.empty || ("还没有" + props.title), description: props.onCreate ? "点击右上角「" + (props.createLabel || "新建") + "」开始录入" : undefined }} />
        )} />
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
