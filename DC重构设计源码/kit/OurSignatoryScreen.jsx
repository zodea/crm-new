// OurSignatoryScreen — 设置 · 我方签约主体目录（路由 ourSignatory，对应实现 /settings/our-signatories）。
// 依据：app/components/settings/OurSignatorySettingsScreen.vue、app/lib/our-signatory/contract.ts、
//       docs/rewrite/NAVIGATION.md（our-signatory:read 才展示目录；our-signatory:write 才可新增/编辑）。
// 构图：头部 Panel（标题 + 职责说明 + 「新增主体」）→ 目录表（签约名称 / 纳税识别号 / 状态 / 版本 / 操作）。
// 规则：停用保留稳定身份不删除；合同保留签约时采用的主体快照，主体更名不回写旧合同；
//       名称不是导航 ID，合同里不按同名自由文本建立关系。独立桌面路径未接一致目录时显示明确不可用。
// params.previewState：ready | empty | loading | error | readonly（无写权限）| desktop（独立桌面不可用）。
// 以下为独立设计演示样本，不播种正式主体，也不进入 kit/data.js。
(function () {
  const DEMO_SIGNATORIES = [
    { id: "sig-demo-1", name: "瑞航装饰工程有限公司（演示）", taxNo: "91440300MA5DEMO01X", status: "active", version: "3" },
    { id: "sig-demo-2", name: "瑞航建设集团有限公司（演示）", taxNo: null, status: "active", version: "1" },
    { id: "sig-demo-3", name: "瑞航幕墙工程有限公司（演示·已更名）", taxNo: "91440300MA5DEMO03Y", status: "inactive", version: "4" },
  ];

  const TH = { padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "left", whiteSpace: "nowrap", background: "var(--surface-2)" };
  const TD = { padding: "11px 12px", fontSize: 13, verticalAlign: "middle", borderTop: "1px solid var(--line)" };

  function OurSignatoryScreen({ navigate, params }) {
    const p = params || {};
    const { Panel, Button, StatusChip } = window.DesignSystem_e3d871;
    const KA = window.KitAtoms || {};
    const state = p.previewState || "ready";
    const canWrite = state !== "readonly";
    const rows = state === "empty" ? [] : DEMO_SIGNATORIES;
    const openForm = (id) => navigate("ourSignatoryForm", id ? { id } : {});

    let body;
    if (state === "loading") {
      body = KA.StatePanel ? <KA.StatePanel state="loading" title="正在读取我方主体目录" compact /> : null;
    } else if (state === "error" || state === "desktop") {
      const message = state === "desktop"
        ? "独立桌面路径尚未接入一致主体目录。请使用已开放的中央入口维护；旧合同原文仍保留。"
        : "目录读取失败：服务暂不可用，请稍后重新读取。";
      body = KA.StatePanel
        ? <KA.StatePanel state={state === "desktop" ? "forbidden" : "error"} title={message} actionLabel={state === "error" ? "重新读取" : undefined} onAction={() => navigate("ourSignatory", { ...p, previewState: "ready" })} />
        : null;
    } else {
      body = (
        <Panel padding={16} style={{ minWidth: 0, overflowX: "auto" }} aria-label="签约主体目录">
          {rows.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>尚未录入主体。按真实文书核实后新增，再在合同中明确选择。</p>
          ) : (
            <table style={{ width: "100%", minWidth: 600, borderCollapse: "collapse" }}>
              <thead><tr>{["签约名称", "纳税识别号", "状态", "版本", "操作"].map((h) => <th key={h} scope="col" style={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...TD, fontWeight: 600 }}>{r.name}</td>
                    <td style={{ ...TD, fontFamily: r.taxNo ? "var(--font-mono)" : "inherit", color: r.taxNo ? "var(--ink)" : "var(--ink-faint)" }}>{r.taxNo || "未核实"}</td>
                    <td style={TD}><StatusChip tone={r.status === "active" ? "ok" : "neutral"}>{r.status === "active" ? "可选择" : "已停用"}</StatusChip></td>
                    <td style={{ ...TD, fontFamily: "var(--font-mono)" }}>{r.version}</td>
                    <td style={TD}>
                      {canWrite && <button type="button" onClick={() => openForm(r.id)} style={{ border: 0, background: "transparent", padding: 0, color: "var(--brand)", cursor: "pointer", fontSize: 13 }}>编辑</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      );
    }

    return (
      <div style={{ display: "grid", gap: 16, minWidth: 0 }} data-testid="our-signatory-settings">
        <Panel padding={16} style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>我方签约主体</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-soft)" }}>维护真实签约名称和核实资料。停用保留稳定身份；合同保留签约时采用的快照。</p>
          </div>
          {canWrite && state !== "loading" && state !== "error" && state !== "desktop" && (
            <Button variant="primary" onClick={() => openForm(null)}>新增主体</Button>
          )}
        </Panel>
        {body}
      </div>
    );
  }

  window.OurSignatoryScreen = OurSignatoryScreen;
})();
