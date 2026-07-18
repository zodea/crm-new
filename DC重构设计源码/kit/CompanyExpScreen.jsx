// CompanyExpScreen — 公司支出合同（公司层面合同；红圈11 · 房租/软件/其他）：EntityListScreen meta 一份生成整页。
// 口径：不挂项目（公司层面，无项目列、无 fromParams）；金额穿透合同金额；defaultView=履约中。
(function () {
  if (window.CompanyExpScreen) return;

  function CompanyExpScreen({ params, navigate }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const STATUS_TONE = { "履约中": "brand", "已结清": "ok" };

    const meta = {
      entity: "companyExp", coll: "companyExps", title: "公司支出合同",
      formRoute: "companyExpForm",   // 整页表单（grill 决议 2026-07-18）
      statusKey: "status",
      columns: [
        { key: "no", label: "合同编号", width: 150, mono: true },
        { key: "name", label: "合同名称", width: 220, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "category", label: "类别", width: 110, form: { type: "select", options: ["房租", "软件", "其他"] } },
        { key: "counterparty", label: "对方单位", width: 180 },
        { key: "amount", label: "合同金额", width: 140, money: true, align: "right" },
        { key: "signDate", label: "签订日期", width: 110, mono: true, form: { type: "date" } },
        { key: "period", label: "合同期", width: 130 },
        { key: "status", label: "状态", width: 96, render: (v) => (StatusChip ? <StatusChip tone={STATUS_TONE[v] || "neutral"}>{v}</StatusChip> : v),
          form: { type: "select", options: ["履约中", "已结清"] } },
      ],
      views: [
        { key: "all", label: "全部" },
        { key: "active", label: "履约中", filter: (r) => r.status === "履约中" },
        { key: "closed", label: "已结清", filter: (r) => r.status === "已结清" },
      ],
      defaultView: "active",
      filters: [
        { key: "cat", label: "类别",
          options: [
            { key: "all", label: "全部类别" },
            { key: "房租", label: "房租" },
            { key: "软件", label: "软件" },
            { key: "其他", label: "其他" },
          ],
          match: (r, val) => r.category === val },
      ],
      searchKeys: ["no", "name", "counterparty"],
      summary: (rows) => [
        { label: "合同数", value: rows.length + " 份" },
        { label: "合同金额总和", value: rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) },
      ],
      newDefaults: () => ({ status: "履约中", amount: 0 }),
      tableMinWidth: 1160,
    };
    return <ELS meta={meta} params={params} navigate={navigate} />;
  }

  window.CompanyExpScreen = CompanyExpScreen;
})();
