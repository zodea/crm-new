// CustomerScreen — 客户列表（甲方档案，红圈09）：EntityListScreen meta 一份生成整页。
// 口径：客户即甲方档案；客户与项目的关联 = projects.developer 文本与客户 name 同名（name 为 developer 的实体化）；合作项目数为计算列。
(function () {
  if (window.CustomerScreen) return;

  function CustomerScreen({ params }) {
    const KA = window.KitAtoms || {};
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !KA.EntityLink || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};

    const projects = A.rows("projects");

    const meta = {
      entity: "customer", coll: "customers", title: "客户",
      columns: [
        { key: "name", label: "客户名称", width: 220, render: (v, r) => <KA.EntityLink type="customer" id={r.id} label={v} /> },
        { key: "contact", label: "联系人", width: 110 },
        { key: "phone", label: "电话", width: 140, mono: true },
        { key: "projectCount", label: "合作项目数", width: 120, align: "right", noForm: true, form: false,
          render: (v, r) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{projects.filter((p) => p.developer === r.name).length} 个</span> },
        { key: "address", label: "注册地址", width: 200 },
        { key: "taxNo", label: "统一社会信用代码", width: 190, mono: true },
        { key: "note", label: "备注", width: 150 },
      ],
      views: [
        { key: "all", label: "全部" },
      ],
      defaultView: "all",
      searchKeys: ["name", "contact", "phone"],
      summary: (rows) => [
        { label: "客户数", value: rows.length + " 家" },
        { label: "合作项目总数", value: (new Set(projects.filter((p) => rows.some((c) => c.name === p.developer)).map((p) => p.id)).size) + " 个" },
      ],
      onRowOpen: (r) => window.DC && window.DC.navigate("customerDetail", { id: r.id }),
      tableMinWidth: 1280,
    };
    return <ELS meta={meta} params={params} />;
  }

  window.CustomerScreen = CustomerScreen;
})();
