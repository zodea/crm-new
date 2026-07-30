// ScheduleBindScreen — 暂估排程绑定施工合同复核（ADR 0017；#244 设计稿回填）。
// 口径：无合同时可先按手工楼栋范围 + 暂估量建 WBS；签约后必须显式绑定同项目施工合同，
//       并校验楼栋覆盖 / 分项映射 / 数量差异。未覆盖楼栋阻断绑定；
//       绑定后保留原分组、基线、完成事实与暂估量（暂估量不被合同量覆盖）。
(function () {
  if (window.ScheduleBindScreen) return;

  // 演示数据：值全部匿名虚构（ADR 0014 §9），仅用于表达复核版式与阻断条件
  const REVIEW = {
    group: "户内 3 号楼 1-18 层",
    project: "合和新城·3 号楼",
    contract: "SG-2026-014 户内装修施工合同",
    buildings: [
      { name: "3 号楼 1-12 层", covered: true, units: 96 },
      { name: "3 号楼 13-18 层", covered: true, units: 48 },
      { name: "3 号楼 屋面层", covered: false, units: 4 },
    ],
    lines: [
      { work: "泥水", item: "墙砖粘贴", provisional: 7020, contract: 7128, unit: "m²" },
      { work: "泥水", item: "地砖铺贴", provisional: 4180, contract: 4180, unit: "m²" },
      { work: "油漆", item: "一遍腻子", provisional: 13300, contract: 13020, unit: "m²" },
      { work: "水电", item: "线管敷设", provisional: 2640, contract: null, unit: "m" },
    ],
  };

  function ScheduleBindScreen({ navigate }) {
    const { Panel, Button, StatusChip, Icon } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {} };
    const P = Panel || "div";
    const mono = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

    const uncovered = REVIEW.buildings.filter((b) => !b.covered);
    const unmapped = REVIEW.lines.filter((l) => l.contract == null);
    const blocked = uncovered.length > 0;

    const diffOf = (l) => (l.contract == null ? null : l.contract - l.provisional);

    const row = (cells, key, tone) => (
      <div key={key} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 90px", gap: 8, alignItems: "center",
        padding: "8px 12px", borderTop: "1px solid var(--line)", background: tone === "bad" ? "var(--danger-soft)" : "transparent" }}>
        {cells}
      </div>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 顶部摘要：返回 + 分组身份 + 目标合同 */}
        <P padding={0}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap" }}>
            <button type="button" onClick={() => navigate("schedule")}
              style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--line-strong)", background: "var(--panel)",
                borderRadius: "var(--radius-btn)", padding: "5px 10px", cursor: "pointer", fontSize: 13 }}>
              {Icon ? <Icon name="arrow-left" size={14} /> : "←"} 返回施工进度
            </button>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{REVIEW.group}</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{REVIEW.project} · 内部暂估排程</div>
            </div>
            {StatusChip ? <StatusChip tone={blocked ? "danger" : "warn"}>{blocked ? "存在未覆盖楼栋" : "待绑定"}</StatusChip> : null}
          </div>
          <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px", background: "var(--surface-2)", fontSize: 13 }}>
            目标施工合同：<span style={{ fontWeight: 700 }}>{REVIEW.contract}</span>
            <span style={{ color: "var(--ink-soft)", marginLeft: 8 }}>（只能绑定同项目施工合同，跨合同混组一律禁止）</span>
          </div>
        </P>

        {/* 校验一：楼栋覆盖 —— 未覆盖即阻断 */}
        <P padding={0}>
          {KA.SectionHeader ? <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>① 楼栋覆盖校验</span>
            <span style={{ fontSize: 12, color: uncovered.length ? "var(--danger-ink)" : "var(--ok-ink)", marginLeft: 8 }}>
              {uncovered.length ? uncovered.length + " 个楼栋未被合同清单覆盖 · 阻断绑定" : "全部覆盖"}
            </span>
          </div> : null}
          {REVIEW.buildings.map((b) => (
            <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: "1px solid var(--line)",
              background: b.covered ? "transparent" : "var(--danger-soft)" }}>
              {Icon ? <Icon name={b.covered ? "circle-check-big" : "triangle-alert"} size={14}
                color={b.covered ? "var(--ok)" : "var(--danger)"} /> : null}
              <span style={{ flex: 1, fontSize: 13 }}>{b.name}</span>
              <span style={{ ...mono, fontSize: 12, color: "var(--ink-soft)" }}>{b.units} 户</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: b.covered ? "var(--ok-ink)" : "var(--danger-ink)" }}>
                {b.covered ? "已覆盖" : "未覆盖"}
              </span>
            </div>
          ))}
        </P>

        {/* 校验二 + 三：分项映射与数量差异同表呈现（暂估量保留，不被合同量覆盖） */}
        <P padding={0}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>② 分项映射与 ③ 数量差异</span>
            <span style={{ fontSize: 12, color: unmapped.length ? "var(--warn-ink)" : "var(--ok-ink)", marginLeft: 8 }}>
              {unmapped.length ? unmapped.length + " 条分项在合同清单中无对应，绑定后按暂估量继续执行" : "全部可映射"}
            </span>
          </div>
          {row([
            <span key="a" style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>工种 · 分项</span>,
            <span key="b" style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "right" }}>暂估量</span>,
            <span key="c" style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "right" }}>合同量</span>,
            <span key="d" style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: "right" }}>差异</span>,
            <span key="e" style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>映射</span>,
          ], "head")}
          {REVIEW.lines.map((l, i) => {
            const d = diffOf(l);
            return row([
              <span key="a" style={{ fontSize: 13 }}>{l.work} · <span style={{ fontWeight: 700 }}>{l.item}</span></span>,
              <span key="b" style={{ ...mono, fontSize: 13, textAlign: "right" }}>{l.provisional.toLocaleString("zh-CN") + " " + l.unit}</span>,
              <span key="c" style={{ ...mono, fontSize: 13, textAlign: "right", color: l.contract == null ? "var(--ink-faint)" : "var(--ink)" }}>
                {l.contract == null ? "—" : l.contract.toLocaleString("zh-CN") + " " + l.unit}</span>,
              <span key="d" style={{ ...mono, fontSize: 13, textAlign: "right", fontWeight: 700,
                color: d == null ? "var(--ink-faint)" : d === 0 ? "var(--ink)" : d > 0 ? "var(--ok-ink)" : "var(--danger-ink)" }}>
                {d == null ? "—" : (d > 0 ? "+" : "") + d.toLocaleString("zh-CN")}</span>,
              <span key="e" style={{ fontSize: 12, fontWeight: 700, color: l.contract == null ? "var(--warn-ink)" : "var(--ok-ink)" }}>
                {l.contract == null ? "无对应" : "已映射"}</span>,
            ], l.item + i, l.contract == null ? "bad" : null);
          })}
        </P>

        {/* 绑定动作：未覆盖楼栋时禁用；说明绑定后保留哪些事实 */}
        <P>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6 }}>
              绑定后保留：原楼栋分组、已设基线、已录完成事实、暂估量。
              <br />暂估量不被合同量覆盖 —— 两者并存以便后续量差对照。
            </div>
            <Button variant="ghost" onClick={() => navigate("schedule")}>取消</Button>
            {Button ? (
              <Button variant="primary" disabled={blocked}
                onClick={() => UI.toast(blocked ? "存在未覆盖楼栋，无法绑定" : "已绑定 " + REVIEW.contract, blocked ? "danger" : "ok")}>
                {blocked ? "存在未覆盖楼栋，无法绑定" : "确认绑定施工合同"}
              </Button>
            ) : null}
          </div>
        </P>
      </div>
    );
  }

  window.ScheduleBindScreen = ScheduleBindScreen;
})();
