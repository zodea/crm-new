// AttendanceScreen — 工资考勤（C1 月考勤；#244 设计稿回填）。
// 口径：工人 × 当月日期矩阵；单元格 出勤/半天/缺勤三态；已发放月份的工人被封锁（不可改，标锁）。
// 密集矩阵只在自身容器横滚（ADR 0013 滚动边界），不撑破页面。
(function () {
  if (window.AttendanceScreen) return;

  // 演示数据：匿名虚构（ADR 0014 §9）
  const DAYS = 30;
  const WORKERS = [
    { name: "陈国强", trade: "泥水", crew: "泥水一组", locked: true },
    { name: "李建华", trade: "泥水", crew: "泥水一组", locked: true },
    { name: "王志明", trade: "油漆", crew: "油漆二组", locked: false },
    { name: "赵春林", trade: "油漆", crew: "油漆二组", locked: false },
    { name: "刘德胜", trade: "水电", crew: "水电组", locked: false },
  ];
  // 0=缺勤 1=出勤 0.5=半天（用工号与日期派生固定图案，避免随机导致不可复现）
  const cell = (wi, d) => (d % 7 === 0 ? 0 : (wi + d) % 11 === 0 ? 0.5 : 1);
  const TONE = {
    1: { bg: "var(--ok-soft)", ink: "var(--ok-ink)", txt: "√" },
    0.5: { bg: "var(--warn-soft)", ink: "var(--warn-ink)", txt: "半" },
    0: { bg: "var(--surface-3)", ink: "var(--ink-faint)", txt: "—" },
  };

  function AttendanceScreen({ navigate }) {
    const { Panel, Button, Icon, StatusChip } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {} };
    const P = Panel || "div";
    const mono = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
    const days = Array.from({ length: DAYS }, (_, i) => i + 1);
    const total = (wi) => days.reduce((s, d) => s + cell(wi, d), 0);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <P padding={0}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", flexWrap: "wrap" }}>
            {KA.SelectFilter ? <KA.SelectFilter label="项目" options={["合和新城·3 号楼", "锦绣园·2 期"]} value="合和新城·3 号楼" onChange={() => {}} /> : null}
            {KA.SelectFilter ? <KA.SelectFilter label="月份" options={["2026-06", "2026-05"]} value="2026-06" onChange={() => {}} /> : null}
            {KA.SelectFilter ? <KA.SelectFilter label="班组" options={["全部班组", "泥水一组", "油漆二组", "水电组"]} value="全部班组" onChange={() => {}} /> : null}
            <div style={{ flex: 1 }} />
            {StatusChip ? <StatusChip tone="warn">{WORKERS.filter((w) => w.locked).length + " 人已封锁"}</StatusChip> : null}
            {Button ? <Button variant="secondary" onClick={() => navigate("payroll")}>回工资核算</Button> : null}
            {Button ? <Button variant="primary" onClick={() => UI.toast("本月考勤已保存", "ok")}>保存考勤</Button> : null}
          </div>
          <div style={{ borderTop: "1px solid var(--line)", padding: "8px 14px", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)" }}>
            已发放工资的月份自动封锁该工人考勤，防重复发放；需更正请先撤销发放。
          </div>
        </P>

        {/* 矩阵：容器内横滚，左侧工人列固定 */}
        <P padding={0}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 180 + DAYS * 30 + 90 }}>
              <div style={{ display: "grid", gridTemplateColumns: `180px repeat(${DAYS}, 30px) 90px`, alignItems: "center",
                background: "var(--surface-2)", borderBottom: "1px solid var(--line)", height: 36 }}>
                <div style={{ position: "sticky", left: 0, background: "var(--surface-2)", padding: "0 10px", fontSize: 13, fontWeight: 700 }}>工人 · 工种</div>
                {days.map((d) => (
                  <div key={d} style={{ ...mono, textAlign: "center", fontSize: 11, fontWeight: 700,
                    color: d % 7 === 0 ? "var(--danger-ink)" : "var(--ink-soft)" }}>{d}</div>
                ))}
                <div style={{ ...mono, textAlign: "right", padding: "0 10px", fontSize: 12, fontWeight: 700 }}>工天</div>
              </div>
              {WORKERS.map((w, wi) => (
                <div key={w.name} style={{ display: "grid", gridTemplateColumns: `180px repeat(${DAYS}, 30px) 90px`, alignItems: "center",
                  borderBottom: "1px solid var(--line)", height: 36, opacity: w.locked ? 0.72 : 1 }}>
                  <div style={{ position: "sticky", left: 0, background: "var(--panel)", padding: "0 10px", display: "flex", alignItems: "center", gap: 6 }}>
                    {w.locked && Icon ? <Icon name="lock" size={12} color="var(--warn)" /> : null}
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{w.name}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{w.trade}</span>
                  </div>
                  {days.map((d) => {
                    const v = cell(wi, d);
                    const t = TONE[v];
                    return (
                      <button key={d} type="button" disabled={w.locked}
                        title={w.locked ? w.name + " · 已发放封锁" : w.name + " · " + d + " 日"}
                        onClick={() => UI.toast("切换 " + w.name + " " + d + " 日出勤", "info")}
                        style={{ ...mono, height: 28, margin: "0 1px", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)",
                          background: t.bg, color: t.ink, fontSize: 11, fontWeight: 700,
                          cursor: w.locked ? "not-allowed" : "pointer" }}>{t.txt}</button>
                    );
                  })}
                  <div style={{ ...mono, textAlign: "right", padding: "0 10px", fontSize: 13, fontWeight: 700 }}>{total(wi)}</div>
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: `180px repeat(${DAYS}, 30px) 90px`, alignItems: "center",
                background: "var(--surface-2)", height: 36 }}>
                <div style={{ position: "sticky", left: 0, background: "var(--surface-2)", padding: "0 10px", fontSize: 12, fontWeight: 700 }}>合计</div>
                {days.map((d) => (
                  <div key={d} style={{ ...mono, textAlign: "center", fontSize: 11, color: "var(--ink-soft)" }}>
                    {WORKERS.reduce((s, _w, wi) => s + cell(wi, d), 0)}
                  </div>
                ))}
                <div style={{ ...mono, textAlign: "right", padding: "0 10px", fontSize: 13, fontWeight: 800 }}>
                  {WORKERS.reduce((s, _w, wi) => s + total(wi), 0)}
                </div>
              </div>
            </div>
          </div>
        </P>
      </div>
    );
  }

  window.AttendanceScreen = AttendanceScreen;
})();
