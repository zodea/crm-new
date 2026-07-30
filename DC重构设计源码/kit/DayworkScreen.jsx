// DayworkScreen — 逐日签工（C2 格式族；#244 设计稿回填）。
// 口径：按日录入「工人 × 工种 × 工日 × 单价」并由工人现场签字确认；
//       只有已签字的记录才参与 C2 工资单取数；未签字停留在待签字，不进核算。
(function () {
  if (window.DayworkScreen) return;

  // 演示数据：匿名虚构（ADR 0014 §9）
  const ROWS = [
    { date: "2026-06-24", worker: "陈国强", trade: "泥水", part: "3 号楼 8 层 0802", days: 1, rate: 380, signed: true },
    { date: "2026-06-24", worker: "李建华", trade: "泥水", part: "3 号楼 8 层 0803", days: 1, rate: 380, signed: true },
    { date: "2026-06-25", worker: "王志明", trade: "油漆", part: "3 号楼 9 层公区", days: 0.5, rate: 420, signed: true },
    { date: "2026-06-25", worker: "赵春林", trade: "油漆", part: "3 号楼 9 层公区", days: 1, rate: 420, signed: false },
    { date: "2026-06-26", worker: "刘德胜", trade: "水电", part: "3 号楼 10 层管井", days: 1, rate: 450, signed: false },
  ];

  function DayworkScreen({ navigate }) {
    const { Panel, Button, StatusChip, Icon } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const KT = window.KitTable;
    const UI = window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const P = Panel || "div";
    const money = (n) => "¥" + Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const signed = ROWS.filter((r) => r.signed);
    const pending = ROWS.filter((r) => !r.signed);
    const amountOf = (r) => r.days * r.rate;

    const columns = [
      { key: "date", label: "日期", width: 120, mono: true },
      { key: "worker", label: "工人", width: 110, render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
      { key: "trade", label: "工种", width: 90 },
      { key: "part", label: "施工部位", width: 200 },
      { key: "days", label: "工日", width: 90, align: "right",
        render: (v) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{v}</span> },
      { key: "rate", label: "日单价", width: 120, align: "right", money: true },
      { key: "_amount", label: "小计", width: 130, align: "right",
        render: (_v, r) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{money(amountOf(r))}</span> },
      { key: "signed", label: "签字", width: 110,
        render: (v) => (StatusChip ? <StatusChip tone={v ? "ok" : "warn"}>{v ? "已签字" : "待签字"}</StatusChip> : (v ? "已签字" : "待签字")) },
    ];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <P padding={0}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", flexWrap: "wrap" }}>
            {KA.SelectFilter ? <KA.SelectFilter label="项目" options={["合和新城·3 号楼", "锦绣园·2 期"]} value="合和新城·3 号楼" onChange={() => {}} /> : null}
            {KA.SelectFilter ? <KA.SelectFilter label="月份" options={["2026-06", "2026-05"]} value="2026-06" onChange={() => {}} /> : null}
            {KA.SearchInput ? <KA.SearchInput value="" onChange={() => {}} placeholder="搜工人 / 部位" width={220} /> : null}
            <div style={{ flex: 1 }} />
            {Button ? <Button variant="secondary" onClick={() => navigate("attendance")}>看月考勤</Button> : null}
            {Button ? <Button variant="primary" onClick={() => UI.toast("新增签工记录", "info")}>录入签工</Button> : null}
          </div>
          <div style={{ borderTop: "1px solid var(--line)", padding: "8px 14px", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)" }}>
            仅「已签字」记录参与 C2 工资单取数；待签字记录不进核算，也不计入动态成本。
          </div>
        </P>

        {pending.length ? (
          <P>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {Icon ? <Icon name="triangle-alert" size={16} color="var(--warn)" /> : null}
              <span style={{ flex: 1, fontSize: 13 }}>
                有 <b>{pending.length}</b> 条记录待工人签字确认，合计 <b>{money(pending.reduce((s, r) => s + amountOf(r), 0))}</b> 暂不参与核算。
              </span>
              {Button ? <Button variant="secondary" onClick={() => UI.toast("已生成待签字清单，打印后现场签字", "ok")}>打印待签字清单</Button> : null}
            </div>
          </P>
        ) : null}

        {KT ? (
          <KT columns={columns} data={ROWS} tableMinWidth={1080} minRows={10}
            footerLeft={
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                已签字 {signed.length} 条 · {money(signed.reduce((s, r) => s + amountOf(r), 0))}
                <span style={{ marginLeft: 12 }}>待签字 {pending.length} 条 · {money(pending.reduce((s, r) => s + amountOf(r), 0))}</span>
              </span>
            } />
        ) : null}
      </div>
    );
  }

  window.DayworkScreen = DayworkScreen;
})();
