// KitTable — 全局红圈式表格原语（反馈轮 8 铁律载体，注册 window.KitTable，经隐藏 x-import 预加载）
// 三件套：① 默认 ≥10 行展示高度（不足补空行）② 横向滚动只发生在表格容器内 ③ 分页条（真实切片 + 每页条数）。
// columns: [{ key, label, width, align, mono, money, color, filter, render(v,row) }]
// props: rows, pageSize=10, minRows=10, checkable, checkDisabled(row), onCheckChange(rows), sum:{label,value},
//        footerLeft(node|fn(checkedRows)), onRowClick(row), empty, tableMinWidth
(function () {
  if (window.KitTable) { window.KitTableScreen = window.KitTableScreen || function () { return null; }; return; }
  const DS = () => window.DesignSystem_e3d871 || {};
  const yuan2 = (v) => (v == null || v === "" ? "—" : "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  const ROW_H = 45;
  const TH = { padding: "12px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)", position: "sticky", top: 0, zIndex: 1 };
  const TD = { padding: "12px 14px", fontSize: 13, verticalAlign: "middle", whiteSpace: "nowrap" };

  function KitTable(props) {
    const { Icon, Panel } = DS();
    const columns = props.columns || [];
    const rows = props.rows || [];
    const pageSizes = [10, 20, 50];
    const [pageSize, setPageSize] = React.useState(props.pageSize || 10);
    const [page, setPage] = React.useState(0);
    const [checked, setChecked] = React.useState({});
    const minRows = props.minRows != null ? props.minRows : 10;

    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const cur = Math.min(page, pages - 1);
    const view = rows.slice(cur * pageSize, cur * pageSize + pageSize);
    const fill = Math.max(0, Math.min(minRows, pageSize) - view.length);
    const checkedRows = rows.filter((r, i) => checked[r.id != null ? r.id : rows.indexOf(r)]);
    const rid = (r, i) => (r.id != null ? r.id : "i" + i);
    const checkableRows = view.filter((r) => !(props.checkDisabled && props.checkDisabled(r)));
    const allOn = checkableRows.length > 0 && checkableRows.every((r, i) => checked[rid(r, i)]);
    const emit = (next) => { setChecked(next); if (props.onCheckChange) props.onCheckChange(rows.filter((r, i) => next[rid(r, i)])); };

    const totalW = (props.tableMinWidth != null) ? props.tableMinWidth : columns.reduce((s, c) => s + (c.width || 120), 0) + (props.checkable ? 40 : 0) + 48;

    const pagerBtn = (label, target, disabled) => (
      React.createElement("button", { key: label + target, disabled, onClick: () => setPage(target), style: { minWidth: 28, height: 28, border: "1px solid var(--line)", borderRadius: 8, background: target === cur && typeof label === "number" ? "var(--brand)" : "#fff", color: target === cur && typeof label === "number" ? "#fff" : disabled ? "var(--ink-faint)" : "var(--ink-soft)", fontSize: 12, cursor: disabled ? "not-allowed" : "pointer", padding: "0 6px" } }, String(typeof label === "number" ? label + 1 : label))
    );
    const pageBtns = [];
    for (let i = 0; i < pages && i < 7; i++) pageBtns.push(pagerBtn(i, i, false));

    return React.createElement(Panel, { padding: 0, style: { overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0, maxWidth: "100%" } },
      props.toolbar || null,
      React.createElement("div", { tabIndex: 0, role: "region", "aria-label": props.label || "数据表格，可横向滚动", style: { overflowX: "auto", overflowY: "hidden", minWidth: 0 } },
        React.createElement("table", { style: { width: "100%", minWidth: totalW, borderCollapse: "collapse" } },
          React.createElement("thead", null,
            React.createElement("tr", { style: { borderBottom: "1px solid var(--line)" } },
              props.checkable && React.createElement("th", { style: { ...TH, width: 40, textAlign: "center" } },
                React.createElement("input", { type: "checkbox", checked: allOn, onChange: () => { const next = { ...checked }; checkableRows.forEach((r, i) => { next[rid(r, i)] = !allOn; }); emit(next); }, style: { cursor: "pointer" } })),
              React.createElement("th", { style: { ...TH, width: 44 } }, "#"),
              ...columns.map((c) => React.createElement("th", { key: c.key, style: { ...TH, width: c.width, textAlign: c.align || "left" } },
                React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 } }, c.label, c.filter && Icon && React.createElement(Icon, { name: "filter", size: 11, color: "var(--ink-faint)" }))))
            )
          ),
          React.createElement("tbody", null,
            ...view.map((r, i) => React.createElement("tr", {
              key: rid(r, i), style: { borderBottom: "1px solid var(--line)", cursor: props.onRowClick ? "pointer" : "default", height: ROW_H },
              onClick: props.onRowClick ? () => props.onRowClick(r) : undefined,
              tabIndex: props.onRowClick ? 0 : undefined,
              onKeyDown: props.onRowClick ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); props.onRowClick(r); } } : undefined,
              onMouseEnter: (e) => (e.currentTarget.style.background = "var(--surface-3)"),
              onMouseLeave: (e) => (e.currentTarget.style.background = "transparent"),
            },
              props.checkable && React.createElement("td", { style: { ...TD, textAlign: "center" }, onClick: (e) => e.stopPropagation() },
                React.createElement("input", { type: "checkbox", disabled: props.checkDisabled ? props.checkDisabled(r) : false, checked: !!checked[rid(r, i)], onChange: () => emit({ ...checked, [rid(r, i)]: !checked[rid(r, i)] }), style: { cursor: "pointer" } })),
              React.createElement("td", { style: { ...TD, color: "var(--ink-soft)", fontFamily: "var(--font-mono)" } }, cur * pageSize + i + 1),
              ...columns.map((c) => {
                const v = r[c.key];
                let content;
                if (c.render) content = c.render(v, r);
                else if (c.money) content = React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontWeight: 600 } }, yuan2(v));
                else content = (v == null || v === "" ? "—" : v);
                return React.createElement("td", { key: c.key, style: { ...TD, textAlign: c.align || "left", fontFamily: c.mono ? "var(--font-mono)" : undefined, color: c.color || undefined, maxWidth: c.maxWidth, overflow: c.maxWidth ? "hidden" : undefined, textOverflow: c.maxWidth ? "ellipsis" : undefined } }, content);
              })
            )),
            ...Array.from({ length: fill }).map((_, i) => React.createElement("tr", { key: "fill" + i, style: { borderBottom: "1px solid var(--line)", height: ROW_H } },
              React.createElement("td", { colSpan: columns.length + 1 + (props.checkable ? 1 : 0), style: { padding: 0 } }))),
            rows.length === 0 && React.createElement("tr", { style: { height: 0 } },
              React.createElement("td", { colSpan: columns.length + 1 + (props.checkable ? 1 : 0), style: { padding: 0, position: "relative" } },
                React.createElement("div", { style: { position: "absolute", left: 0, right: 0, top: -minRows * ROW_H, height: minRows * ROW_H, display: "grid", placeItems: "center", color: "var(--ink-faint)", fontSize: 13 } }, props.empty || "暂无数据")))
          ),
          props.sum && rows.length > 0 && React.createElement("tfoot", null,
            React.createElement("tr", { style: { background: "var(--surface-2)", borderTop: "1px solid var(--line)" } },
              React.createElement("td", { colSpan: columns.length + 1 + (props.checkable ? 1 : 0), style: { padding: "11px 16px", fontSize: 13 } },
                // sum 支持数组（批A 红圈式多段汇总行：变更后金额总和 / 累计收票总和 / 累计支付总和 …）
                ...(Array.isArray(props.sum) ? props.sum : [props.sum]).map((s, i) => React.createElement("span", { key: i, style: { marginRight: 22, whiteSpace: "nowrap" } },
                  React.createElement("span", { style: { color: "var(--ink-soft)" } }, s.label + "："),
                  React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, typeof s.value === "number" ? yuan2(s.value) : s.value))))))
        )
      ),
      React.createElement("div", { style: { marginTop: "auto", padding: "10px 16px", borderTop: "1px solid var(--line)", background: "var(--surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, fontSize: 12.5, color: "var(--ink-soft)" } },
        React.createElement("span", null, typeof props.footerLeft === "function" ? props.footerLeft(checkedRows) : (props.footerLeft || "共 " + rows.length + " 条")),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
          pagerBtn("‹", Math.max(0, cur - 1), cur === 0),
          ...pageBtns,
          pagerBtn("›", Math.min(pages - 1, cur + 1), cur >= pages - 1),
          React.createElement("select", { value: pageSize, onChange: (e) => { setPageSize(Number(e.target.value)); setPage(0); }, style: { marginLeft: 6, border: "1px solid var(--line-strong)", borderRadius: 6, padding: "4px 6px", fontSize: 12, background: "#fff", cursor: "pointer" } },
            pageSizes.map((n) => React.createElement("option", { key: n, value: n }, n + " 条/页"))),
          React.createElement("span", { style: { marginLeft: 4 } }, "共 " + rows.length + " 条")
        )
      )
    );
  }

  window.KitTable = KitTable;
  window.KitTableScreen = function () { return null; };
})();
