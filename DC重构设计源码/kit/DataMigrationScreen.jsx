// 设置 / 本地数据迁移。布局与状态依据 CoreIdentityMigrationScreen.vue；只演示，不读取本地库。
(function () {
  function DataMigrationScreen({ params = {}, navigate }) {
    const { Panel, Button } = window.DesignSystem_e3d871;
    const KA = window.KitAtoms;
    const Table = window.KitTable;
    const [phase, setPhase] = React.useState("idle");
    const [message, setMessage] = React.useState("");
    const state = params.previewState || "ready";
    const readOnly = state === "readonly";
    const phases = ["idle", "preflight", "backup", "dry-run", "imported", "confirmed", "rolled-back"];
    const step = phases.indexOf(phase);
    const act = (next, text) => { setPhase(next); setMessage(text + "（设计演示）"); };
    const confirm = (title, next, text) => window.KitUI.confirm({ title, message: "此操作仅切换设计预览，不读取、备份或修改实际数据。", confirmText: "预览结果", onConfirm: () => act(next, text) });
    const button = (text, enabled, onClick) => <Button disabled={!enabled || readOnly} onClick={onClick}>{text}</Button>;
    return <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12, minWidth: 0, maxWidth: 1200, margin: "0 auto" }}>
      <Panel><h1 style={{ margin: 0, fontSize: 20 }}>本地数据迁移</h1><p style={{ marginBottom: 0, color: "var(--ink-soft)", lineHeight: 1.8 }}>预检 → 不可变备份 → 试运行 → 导入 → 对账 → 确认切换。此设计稿仅预览步骤，不执行实际迁移。</p></Panel>
      {["loading", "error", "empty"].includes(state) ? <KA.StatePanel state={state} title={state === "loading" ? "正在读取迁移记录" : state === "error" ? "迁移状态读取失败" : "尚无迁移记录"} description="未完成预检、备份和对账前，不能确认切换。" actionLabel={state === "error" ? "重新读取" : undefined} onAction={() => navigate("dataMigration", { previewState: "ready" })} /> : <>
        {readOnly && <KA.StatePanel compact state="forbidden" title="仅可查看迁移记录" description="当前不能执行预检、备份、导入或切换。" />}
        {message && <p role="status" style={{ margin: 0, color: "var(--brand)" }}>{message}</p>}
        <Panel><KA.SectionHeader>来源预检与备份</KA.SectionHeader><dl className="dc-fields"><div><dt>运行模式</dt><dd>浏览器工作区</dd></div><div><dt>来源版本</dt><dd>{step > 0 ? "示例来源版本" : "待检测"}</dd></div><div><dt>不可变备份</dt><dd>{step >= 2 ? "演示备份已建立" : "尚未创建"}</dd></div></dl><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{button("运行预检", phase === "idle", () => act("preflight", "示例来源预检通过"))}{button("创建不可变备份", phase === "preflight", () => confirm("预览创建备份", "backup", "备份结果已展示"))}</div></Panel>
        <Panel><KA.SectionHeader>试运行与导入</KA.SectionHeader><p>试运行只生成映射和对账证据；导入只处理可安全映射的记录。</p><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{button("执行 dry-run", phase === "backup", () => act("dry-run", "示例映射与对账已生成"))}{button("导入可导入记录", phase === "dry-run", () => confirm("预览导入结果", "imported", "示例导入完成，等待对账确认"))}</div></Panel>
        <section><KA.SectionHeader>逐项对账</KA.SectionHeader><Table label="迁移差异对账" rows={[]} minRows={4} tableMinWidth={1160} columns={[{ key: "entity", label: "实体", width: 130 }, { key: "legacyId", label: "旧记录 ID", width: 180 }, { key: "commandId", label: "命令 ID", width: 180 }, { key: "field", label: "字段", width: 140 }, { key: "expected", label: "预期值" }, { key: "actual", label: "实际值" }, { key: "difference", label: "差异" }, { key: "reason", label: "原因与归属", width: 230 }]} empty={step < 3 ? "尚未运行对账，不能视为没有差异" : "当前演示批次无阻断差异"} /></section>
        <Panel><KA.SectionHeader>确认切换与回滚</KA.SectionHeader><p role="status">{phase === "confirmed" ? "演示已切换；实际回滚资格与截止时间应读取迁移批次。" : phase === "rolled-back" ? "演示已回滚。原库与不可变备份仍保留。" : "预检、备份与导入对账全部通过后，才可确认切换。"}</p><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{button("确认切换", phase === "imported", () => confirm("预览确认切换", "confirmed", "示例批次已确认"))}{button("回滚", phase === "confirmed", () => confirm("预览回滚结果", "rolled-back", "示例批次已回滚"))}</div></Panel>
      </>}
    </div>;
  }
  window.DataMigrationScreen = DataMigrationScreen;
})();
