// DetailScreen — 施工明细（楼层×工种），工人名可点击跳工资明细
// 从工程量管理页进入某一户后显示
(function () {
  const { Panel, StatusChip } = window.DesignSystem_e3d871;

  function DetailScreen({ data, navigate, params }) {
    const p = params || {};
    const unit = p.unit || data.matrix.units[0];
    const building = p.building || data.matrix.buildings[0];
    const mx = data.matrix;
    const monthByKey = Object.fromEntries(mx.months.map(m => [m.key, m]));
    const crewName = "泥水A班";
    const projectName = "合和新城";

    const goWorker = (worker) => navigate("payrollDetail", { worker, crew: crewName, project: projectName });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink-soft)" }}>
          <button type="button" onClick={() => navigate("quantity")}
            style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}>
            ← 工程量管理
          </button>
          <span style={{ opacity: 0.4 }}>/</span>
          <span>{building}</span>
          <span style={{ opacity: 0.4 }}>/</span>
          <span style={{ color: "var(--ink)", fontWeight: 700 }}>{unit}</span>
        </div>

        {/* Summary bar */}
        <div style={{ background: "var(--brand-soft)", border: "1px solid rgba(57,118,198,0.2)", borderRadius: 8, padding: "10px 16px", display: "flex", alignItems: "center", gap: 16, fontSize: 12 }}>
          <span style={{ color: "var(--brand)", fontWeight: 700 }}>施工明细 · {building} · {unit}</span>
          <span style={{ color: "var(--brand-deep)" }}>共 {mx.floors.length} 层 · {mx.items.length} 个工种</span>
          <span style={{ marginLeft: "auto", color: "var(--brand)", opacity: 0.7 }}>点击工人姓名 → 跳转工资明细</span>
        </div>

        {/* Detail table */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "10px 16px", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", textAlign: "left", position: "sticky", top: 0 }}>楼层</th>
                {mx.items.map(item => (
                  <th key={item} style={{ padding: "10px 16px", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", textAlign: "left", position: "sticky", top: 0 }}>{item}铺贴</th>
                ))}
                <th style={{ padding: "10px 16px", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface-2)", textAlign: "center", position: "sticky", top: 0 }}>施工月份</th>
              </tr>
            </thead>
            <tbody>
              {mx.floors.map((floor, fi) => {
                const cells = mx.cells[floor + "|" + unit] || [];
                const hasAny = cells.length > 0;
                const monthKey = cells[0] ? cells[0].month : null;
                const m = monthKey ? monthByKey[monthKey] : null;
                return (
                  <tr key={floor} style={{ borderBottom: "1px solid var(--line)", background: fi % 2 === 0 ? "transparent" : "rgba(0,0,0,0.012)" }}>
                    <td style={{ padding: "10px 16px", fontSize: 13, fontFamily: "var(--font-mono)", fontWeight: 700 }}>{floor}</td>
                    {mx.items.map(item => {
                      const cell = cells.find(c => c.item === item);
                      return (
                        <td key={item} style={{ padding: "10px 16px" }}>
                          {cell ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <button type="button" onClick={() => goWorker(cell.worker)}
                                style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 700, fontSize: 13, padding: 0, textDecoration: "underline", textUnderlineOffset: 2 }}>
                                {cell.worker}
                              </button>
                              {cell.partner && (
                                <>
                                  <span style={{ color: "var(--ink-faint)", fontSize: 11 }}>/</span>
                                  <button type="button" onClick={() => goWorker(cell.partner)}
                                    style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--brand)", fontWeight: 700, fontSize: 13, padding: 0, textDecoration: "underline", textUnderlineOffset: 2 }}>
                                    {cell.partner}
                                  </button>
                                  <StatusChip tone="neutral" style={{ fontSize: 10 }}>夫妻关联</StatusChip>
                                </>
                              )}
                              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }}>{cell.qty} ㎡</span>
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ padding: "10px 16px", textAlign: "center" }}>
                      {m ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, background: m.bg, color: m.ink, borderRadius: 999, padding: "2px 10px" }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: m.dot, display: "inline-block" }} />{m.label}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--danger)", background: "var(--danger-soft)", borderRadius: 999, padding: "2px 10px" }}>未施工</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer note */}
        <div style={{ fontSize: 11, color: "var(--ink-faint)", padding: "0 4px" }}>
          工程量来源：现场测量暂定值 · 请以最终结算量为准。班组：{crewName} · 项目：{projectName}
        </div>
      </div>
    );
  }

  window.AppDetailScreen = DetailScreen;
})();
