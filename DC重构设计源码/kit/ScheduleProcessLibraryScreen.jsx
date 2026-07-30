// ScheduleProcessLibraryScreen — 标准工序库（ADR 0018；#244 设计稿回填）：EntityListScreen meta 一份生成整页。
// 口径：库编码 + 版本号构成版本身份；已发布版本只读，只能沿用原 code 新建下一版；
//       建组时整库快照冻结进楼栋分组，之后改库不反写已建分组。
(function () {
  if (window.ScheduleProcessLibraryScreen) return;

  function ScheduleProcessLibraryScreen({ params, navigate }) {
    const ELS = window.EntityListScreen;
    const A = window.APP;
    if (!ELS || !A) return null;
    const { StatusChip } = window.DesignSystem_e3d871 || {};
    const TONE = { "已发布": "ok", "草稿": "neutral" };

    const meta = {
      entity: "processLibrary", coll: "processLibraries", title: "标准工序库",
      formRoute: "processLibraryForm",
      statusKey: "status",
      columns: [
        { key: "code", label: "库编码", width: 140, mono: true },
        { key: "name", label: "库名称", width: 220, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
        { key: "version", label: "版本", width: 80, align: "right",
          render: (v) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{"v" + (v || 1)}</span> },
        { key: "scope", label: "适用范围", width: 130 },
        { key: "taskCount", label: "工序道数", width: 110, align: "right",
          render: (_v, r) => <span style={{ fontFamily: "var(--font-mono)" }}>{(r.tasks || []).length + " 道"}</span> },
        { key: "usedByGroups", label: "已冻结分组", width: 130, align: "right",
          render: (v) => <span style={{ fontFamily: "var(--font-mono)", color: Number(v) ? "var(--ink)" : "var(--ink-faint)" }}>{Number(v || 0) + " 组"}</span> },
        { key: "status", label: "状态", width: 100,
          render: (v) => (StatusChip ? <StatusChip tone={TONE[v] || "neutral"}>{v}</StatusChip> : v) },
        { key: "updatedAt", label: "更新日期", width: 120, mono: true },
      ],
      views: [
        { key: "published", label: "已发布", filter: (r) => r.status === "已发布" },
        { key: "draft", label: "草稿", filter: (r) => r.status === "草稿" },
        { key: "all", label: "全部" },
      ],
      defaultView: "published",
      filters: [{ key: "scope", label: "适用范围",
        options: [{ key: "all", label: "全部范围" }, { key: "户内装修", label: "户内装修" }, { key: "公区装修", label: "公区装修" },
          { key: "外立面", label: "外立面" }, { key: "机电安装", label: "机电安装" }],
        match: (r, val) => r.scope === val }],
      searchKeys: ["code", "name", "scope"],
      summary: (rows) => [
        { label: "版本数", value: rows.length + " 版" },
        { label: "已发布", value: rows.filter((r) => r.status === "已发布").length + " 版" },
        { label: "被分组冻结引用", value: rows.reduce((s, r) => s + (Number(r.usedByGroups) || 0), 0) + " 组" },
      ],
      // 已发布版本只读：行操作只留「沿用此 code 新建下一版」，不给编辑
      rowActions: (r) => (r.status === "已发布"
        ? [{ key: "next", label: "沿用 " + r.code + " 新建下一版", onSelect: () => navigate("processLibraryForm", { code: r.code, version: (Number(r.version) || 1) + 1 }) }]
        : [{ key: "edit", label: "编辑草稿", onSelect: () => navigate("processLibraryForm", { id: r.id }) }]),
      newDefaults: () => ({ status: "草稿", version: 1, scope: "户内装修", tasks: [], usedByGroups: 0 }),
      tableMinWidth: 1120,
    };
    return <ELS meta={meta} params={params} navigate={navigate} />;
  }

  window.ScheduleProcessLibraryScreen = ScheduleProcessLibraryScreen;
})();
