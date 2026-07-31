// MatRequisitionScreen — 下料单（按实现端 app/components/material/MaterialListScreen.vue kind=mat_requisition 校准）
// 标准单表列表：# / 材料对象(link) / 编号 / 项目 / 数量 / 日期 / 状态 / 操作(编辑+删除)；底部数量合计。
// 实现端没有视图 chip/下拉筛选/导入导出/列显隐 —— 一并不放（形态铁律见 kit/StdListScreen.jsx 头注释）。
(function () {
  if (window.MatRequisitionScreen) return;

  function MatRequisitionScreen({ params, navigate }) {
    const A = window.APP;
    const Std = window.StdListScreen;
    if (!A || !Std) return null;
    A.use();
    const UI = () => window.KitUI || { confirm: (o) => o.onConfirm && o.onConfirm(), undoToast: function () {} };
    const nav = navigate || (window.DC && window.DC.navigate);
    const projName = (id) => { const p = A.get("projects", id); return p ? p.name : (id || ""); };

    const rows = A.rows("matRequisitions").map((r) => ({
      id: r.id, name: r.material || "下料单", no: r.no || "", projectName: projName(r.projectId),
      quantity: Number(r.planQty) || 0, unit: r.unit || "", date: r.date || "", status: r.status || "草稿",
    }));

    return (
      <Std
        title="下料单" subtitle="乙供材要料计划 · 已到量与剩余量由到货事实派生"
        searchPlaceholder="搜索材料、编号或项目" searchKeys={["no", "name", "projectName", "status"]}
        createLabel="新建下料单" onCreate={() => nav && nav("matRequisitionForm", {})}
        onRowOpen={(r) => nav && nav("matRequisitionForm", { id: r.id })}
        onDelete={(r) => UI().confirm({
          title: "删除下料单", confirmText: "删除", danger: true,
          message: "确认删除「" + (r.no || r.name) + "」？已生效事实删除后，相关库存和累计量会立即重新派生。",
          onConfirm: () => { A.softDel("matRequisitions", r.id); UI().undoToast("已删除「" + (r.no || r.name) + "」", () => A.restore("matRequisitions", r.id)); },
        })}
        columns={[
          { key: "name", label: "材料/对象", minWidth: 220, link: true },
          { key: "no", label: "编号", width: 170, mono: true },
          { key: "projectName", label: "项目", minWidth: 170 },
          { key: "quantity", label: "数量", width: 130, align: "right", render: (v, r) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{Number(v).toLocaleString("zh-CN")} {r.unit}</span> },
          { key: "date", label: "日期", width: 128, mono: true },
          { key: "status", label: "状态", width: 110, render: (v) => window.stdStatusChip(v) },
        ]}
        rows={rows} tableMinWidth={1100}
        footerSummary={(list) => ({ label: "当前数量合计", value: list.reduce((s, r) => s + r.quantity, 0).toLocaleString("zh-CN") })}
      />
    );
  }

  window.MatRequisitionScreen = MatRequisitionScreen;
})();
