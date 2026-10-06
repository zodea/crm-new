// 不可变版本详情；依据 docs/rewrite/pages/schedule-progress.md 和 #443 当前实现。
(function () {
  function ScheduleProcessLibraryDetailScreen({ params = {}, navigate }) {
    const A = window.APP;
    const KA = window.KitAtoms;
    const { Button, Panel } = window.DesignSystem_e3d871;
    const Shell = window.DetailShell;
    const Table = window.KitTable;
    const row = A.get("processLibraries", params.id);
    const state = params.previewState || "ready";
    const back = () => navigate("processLibrary");
    if (!row || ["loading", "error", "empty"].includes(state)) return <div style={{ display: "grid", gap: 12 }}><Button onClick={back}>返回工序库</Button><KA.StatePanel state={state === "ready" ? "empty" : state} title={state === "loading" ? "正在读取工序库版本" : state === "error" ? "工序库版本读取失败" : "工序库版本不存在或不可见"} actionLabel={state === "error" ? "重新读取" : undefined} onAction={() => navigate("processLibraryDetail", { ...params, previewState: "ready" })} /></div>;
    const tasks = (row.tasks || []).map((task, i) => typeof task === "string" ? { id: i, name: task } : { ...task, id: task.id || task.key || i });
    return <Shell title={row.name} code={row.code + " · v" + row.version} onBack={back} chips={<span style={{ color: "var(--ink-soft)", fontSize: 12 }}>只读版本</span>}
      headerExtra={state !== "readonly" && <Button onClick={() => navigate("processLibraryForm", { sourceId: row.id, code: row.code, version: Math.max(...A.rows("processLibraries").filter(r => r.code === row.code).map(r => Number(r.version) || 0)) + 1 })}>基于此版本新建</Button>}
      metrics={[{ label: "适用范围", value: row.scope || "—" }, { label: "工序数量", value: tasks.length + " 道" }, { label: "当前可见引用", value: row.usedByGroups == null ? "未知" : row.usedByGroups + " 组" }]}>
      <Panel><p role="status" style={{ margin: 0, fontSize: 13, lineHeight: 1.8 }}>此页仅查看版本快照。已保存版本不能修改；基于旧版调整会新建版本，不反写已建楼栋分组。</p></Panel>
      <Table label="工序定义快照" rows={tasks} tableMinWidth={1120} columns={[
        { key: "name", label: "工序名称", width: 210 }, { key: "trade", label: "工种", width: 130 },
        { key: "durationDays", label: "默认工期（天）", width: 140 }, { key: "stageCode", label: "阶段编码", width: 150 },
        { key: "itemCodes", label: "分项编码", width: 220, render: v => Array.isArray(v) ? v.join("、") || "—" : v || "—" },
        { key: "predecessorKey", label: "前置关系", width: 220, render: (v, task) => v ? ((tasks.find(t => t.key === v) || {}).name || v) + (task.predecessorDisabled ? "（已置灰保留）" : "") : "—" },
      ]} empty="本版本没有工序快照" />
      <Panel><KA.SectionHeader>备注</KA.SectionHeader>{row.note || "—"}</Panel>
    </Shell>;
  }
  window.ScheduleProcessLibraryDetailScreen = ScheduleProcessLibraryDetailScreen;
})();
