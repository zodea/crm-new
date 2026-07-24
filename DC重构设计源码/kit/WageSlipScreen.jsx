// ⛔ 已退役（2026-07-20，#117 定稿⑧）：「工资进度款工具」整页退役，侧栏「款」入口已移除。
// 能力去向（工具页每项能力在新链路的归宿）：
//   · 工程量清单（只读）      → 请款簿核对页清单（同一套数，定稿 D1，PayrollDetailScreen）
//   · 进度%（参考）           → 单据级支付比例（定稿⑦，核对页请款链直改）
//   · 取整 / 房补 / 管理费开关 → 请款主体建档配置（定稿④，data.js books[].config）
//   · 累计已申领（手填）      → 台账自动 = 往月实际发放值之和（定稿 D6）
//   · 实发逐人直改            → 发放登记实际金额 + 组内分配（定稿 D6/D7）
//   · 空鼓扣罚页签            → 空鼓户记录聚合 + 「开始扣款」手动启动（定稿 D5/⑥）
//   · 工资表 / 考勤表页签     → 请款簿 A4 组（负责人+组员多行）
//   · 本期支付总额权重分摊    → 工资核算「批量发放」弹窗（定稿⑧，PayrollScreen）
// 本文件保留作历史留档（完整实现见 git 历史 f89dbd26 及以前）；组件降级为跳转提示，避免旧链接白屏。
(function () {
  const DS = window.DesignSystem_e3d871 || {};
  const Panel = DS.Panel || ((p) => React.createElement("div", null, p.children));
  const Button = DS.Button || ((p) => React.createElement("button", { onClick: p.onClick }, p.children));
  const Icon = DS.Icon || (() => null);

  function WageSlipScreen({ navigate }) {
    return (
      <Panel padding={40} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
        <Icon name="archive" size={28} color="var(--ink-faint)" />
        <div style={{ fontSize: 14.5, fontWeight: 800 }}>「工资进度款工具」已退役（#117 定稿⑧）</div>
        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", maxWidth: 520, lineHeight: 1.8 }}>
          数字只有一套：清单、比例、空鼓、组内分配、实发登记全部并入「工资核算 → 请款簿」；
          「本期支付总额权重分摊」在请款簿总表的「批量发放」弹窗里。
        </div>
        <Button variant="primary" icon="arrow-right" onClick={() => navigate && navigate("payroll", {})}>前往工资核算</Button>
      </Panel>
    );
  }

  window.WageSlipScreen = WageSlipScreen;
})();
