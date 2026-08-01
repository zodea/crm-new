// StockCheckScreen — 库存盘点（按实现端 app/components/material/MaterialListScreen.vue kind=stock_check 校准）
// 标准单表列表：# / 材料对象(link) / 编号 / 项目 / 数量 / 日期 / 状态 / 操作(编辑+删除)；底部数量合计。
// 特例（照实现端 rowFrom）：对象列取仓库名、项目列固定「仓库级」、数量=盘点项数（单位「项」）。
// 筛选/分页为 #199/#200 验收条目标态（2026-08-01 裁定：实现端待补齐，设计稿先行）；其余形态铁律见 kit/StdListScreen.jsx 头注释。
(function () {
  if (window.StockCheckScreen) return;

  function StockCheckScreen({ params, navigate }) {
    const A = window.APP;
    const Std = window.StdListScreen;
    if (!A || !Std) return null;
    A.use();
    const UI = () => window.KitUI || { confirm: (o) => o.onConfirm && o.onConfirm(), undoToast: function () {} };
    const nav = navigate || (window.DC && window.DC.navigate);

    // 盘点是仓库级动作：name 取仓库（仓库即对象），projectName 固定「仓库级」，unit 固定「项」
    const rows = A.rows("stockChecks").map((r) => ({
      id: r.id, name: r.warehouse || "库存盘点", no: r.no || "", projectName: "仓库级",
      quantity: Number(r.itemCount) || 0, unit: "项", date: r.date || "", status: r.status || "草稿",
    }));

    return (
      <Std
        title="库存盘点" subtitle="账面量实时读取 · 仅已生效盘点差影响库存"
        searchPlaceholder="搜索材料、编号或项目" searchKeys={["no", "name", "projectName", "status"]}
        createLabel="新建库存盘点" onCreate={() => nav && nav("stockCheckForm", {})}
        onRowOpen={(r) => nav && nav("stockCheckForm", { id: r.id })}
        onDelete={(r) => UI().confirm({
          title: "删除库存盘点", confirmText: "删除", danger: true,
          message: "确认删除「" + (r.no || r.name) + "」？已生效事实删除后，相关库存和累计量会立即重新派生。",
          onConfirm: () => { A.softDel("stockChecks", r.id); UI().undoToast("已删除「" + (r.no || r.name) + "」", () => A.restore("stockChecks", r.id)); },
        })}
        columns={[
          { key: "name", label: "材料/对象", minWidth: 220, link: true },
          { key: "no", label: "编号", width: 170, mono: true },
          { key: "projectName", label: "项目", minWidth: 170 },
          { key: "quantity", label: "数量", width: 130, align: "right", render: (v, r) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{Number(v).toLocaleString("zh-CN")} {r.unit}</span> },
          { key: "date", label: "日期", width: 128, mono: true },
          { key: "status", label: "状态", width: 110, render: (v) => window.stdStatusChip(v) },
        ]}
        rows={rows} filters={[{key:"name",label:"仓库"}, {key:"status",label:"状态"}]} tableMinWidth={1100}
        footerSummary={(list) => ({ label: "当前数量合计", value: list.reduce((s, r) => s + r.quantity, 0).toLocaleString("zh-CN") })}
      />
    );
  }

  window.StockCheckScreen = StockCheckScreen;
})();
