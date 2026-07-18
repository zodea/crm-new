// StockCheckScreen — 库存盘点（乙供材管理组；红圈05 库存盘点）：EntityListScreen meta 一份生成整页。
// 口径：仓库/盘点人/盘点项数/盈亏金额/生效状态（草稿→已生效）；盈亏金额红负绿正。
(function () {
  if (window.StockCheckScreen) return;

  function StockCheckScreen({ params, navigate }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};
    const STATUS_TONE = { "已生效": "ok", "草稿": "neutral" };

    const meta = {
      entity: "stockCheck", coll: "stockChecks", title: "库存盘点",
      formRoute: "stockCheckForm",   // 整页表单（grill 决议 2026-07-18）
      statusKey: "status",
      columns: [
        { key: "no", label: "盘点编号", width: 170, mono: true },
        { key: "warehouse", label: "仓库", width: 160, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span>, form: { type: "select", options: ["中心仓", "合和新城现场仓"] } },
        { key: "checker", label: "盘点人", width: 110 },
        { key: "itemCount", label: "盘点项数", width: 110, align: "right", render: (v) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{Number(v || 0)}</span>, form: { type: "number" } },
        { key: "diffAmount", label: "盘盈/盘亏金额", width: 150, align: "right", form: { type: "number" },
          render: (v) => { const n = Number(v) || 0; return <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: n < 0 ? "var(--danger-ink)" : n > 0 ? "var(--ok-ink)" : "var(--ink)" }}>{(n > 0 ? "+¥" : n < 0 ? "-¥" : "¥") + Math.abs(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>; } },
        { key: "date", label: "盘点日期", width: 120, mono: true, form: { type: "date" } },
        { key: "status", label: "状态", width: 100, render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["草稿", "已生效"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "effective", label: "已生效", filter: (r) => r.status === "已生效" },
        { key: "draft", label: "草稿", filter: (r) => r.status === "草稿" },
      ],
      defaultView: "effective",
      filters: [{ key: "wh", label: "仓库",
        options: [{ key: "all", label: "全部仓库" }, { key: "中心仓", label: "中心仓" }, { key: "合和新城现场仓", label: "合和新城现场仓" }],
        match: (r, val) => r.warehouse === val }],
      searchKeys: ["no", "warehouse", "checker"],
      summary: (rows) => [
        { label: "盘点单数", value: rows.length + " 单" },
        { label: "累计盘盈/盘亏", value: rows.reduce((s, r) => s + (Number(r.diffAmount) || 0), 0) },
      ],
      newDefaults: () => ({ status: "草稿", itemCount: 0, diffAmount: 0, warehouse: "中心仓" }),
      tableMinWidth: 1080,
    };
    return <ELS meta={meta} params={params} navigate={navigate} />;
  }

  window.StockCheckScreen = StockCheckScreen;
})();
