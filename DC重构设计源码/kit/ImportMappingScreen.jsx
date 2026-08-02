// ImportMappingScreen — 通用导入字段映射（ADR 0005；#244 设计稿回填）。
// 口径：模板驱动 + 实体入口触发 + 独立页签三步：选文件 → 字段匹配 → 预览确认。
//       未知字段与校验失败行一律显式列出并可下载拒绝清单，绝不静默丢弃。
// 此前设计稿只有 KitUI.importModal 弹窗，与 ADR 0005 冲突。
(function () {
  if (window.ImportMappingScreen) return;

  const STEPS = ["选择文件", "字段匹配", "预览确认"];

  // 实体入口配置（ADR 0005：模板驱动 + 实体列表触发 + 独立页签）。
  // 各实体的必填字段与拒绝理由是自己的业务约束，不共用一套演示数据。
  const ENTITIES = {
    material: {
      title: "导入 · 材料采购合同明细", back: "matContract", backLabel: "返回来源列表",
      file: "采购明细-合和新城.xlsx", total: 42,
      options: ["（不导入）", "材料名称", "规格型号", "单位", "数量", "单价", "税率", "备注"],
      mapping: [
        { src: "材料名称", target: "name", label: "材料名称", required: true, auto: true },
        { src: "规格型号", target: "spec", label: "规格型号", required: true, auto: true },
        { src: "单位", target: "unit", label: "单位", required: true, auto: true },
        { src: "数量", target: "qty", label: "数量", required: true, auto: true },
        { src: "含税单价", target: "price", label: "单价", required: true, auto: false },
        { src: "备注说明", target: "", label: "", required: false, auto: false },
      ],
      rejected: [
        { row: 14, reason: "单价为空且无法由金额÷数量推出" },
        { row: 27, reason: "单位「吨/袋」不在字典内，需人工归一" },
      ],
    },
    // 发票域行级拒绝（#70 / PRD US45）：映射必含归属，缺归属的行整行拒绝并列清单，
    // 其余行照常入台账 —— 区别于通用映射的「整列不导入」。
    invoice: {
      title: "导入 · 历史发票台账", back: "invoiceLedger", backLabel: "返回台账",
      file: "发票台账_2026-06.xlsx", total: 38,
      options: ["（不导入）", "单据编号", "开票日期", "购买方", "供应商", "价税合计", "税额", "票据类型", "对应归属"],
      note: "导入的是纯数据发票：无扫描件，不参与打印排版。",
      mapping: [
        { src: "发票号码", target: "number", label: "单据编号", required: true, auto: true },
        { src: "开票日期", target: "date", label: "开票日期", required: true, auto: true },
        { src: "购方名称", target: "buyer", label: "购买方", required: true, auto: true },
        { src: "销方名称", target: "seller", label: "供应商", required: true, auto: true },
        { src: "价税合计", target: "total", label: "价税合计", required: true, auto: true },
        { src: "税额", target: "tax", label: "税额", required: true, auto: true },
        { src: "发票类型", target: "type", label: "票据类型", required: false, auto: true },
        { src: "项目", target: "project", label: "对应归属", required: true, auto: false },
        { src: "经办人", target: "", label: "", required: false, auto: false },
      ],
      rejected: [
        { row: 9, reason: "缺归属：「项目」列为空，且不是个人开支" },
        { row: 23, reason: "缺归属：项目名「合和新城二期」不在项目主数据里" },
        { row: 31, reason: "价税合计 ≠ 不含税金额 + 税额，金额铁律不成立" },
      ],
    },
  };

  function ImportMappingScreen({ navigate, params }) {
    const cfg = ENTITIES[(params || {}).entity] || ENTITIES.material;
    const MAPPING = cfg.mapping;
    const REJECTED = cfg.rejected;
    const { Panel, Button, Icon, StatusChip } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {} };
    const P = Panel || "div";
    const [step, setStep] = React.useState(1);
    const unmapped = MAPPING.filter((m) => !m.target);
    const total = cfg.total;

    const stepper = (
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <button type="button" onClick={() => setStep(i + 1)}
              style={{ display: "flex", alignItems: "center", gap: 8, border: 0, background: "transparent", cursor: "pointer" }}>
              <span style={{ display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: 999, fontSize: 11, fontWeight: 800,
                border: "1px solid " + (step > i + 1 ? "var(--ok)" : step === i + 1 ? "var(--brand)" : "var(--line-strong)"),
                background: step > i + 1 ? "var(--ok)" : "transparent",
                color: step > i + 1 ? "#fff" : step === i + 1 ? "var(--brand)" : "var(--ink-faint)" }}>
                {step > i + 1 ? "✓" : i + 1}</span>
              <span style={{ fontSize: 13, fontWeight: step === i + 1 ? 700 : 500, color: step === i + 1 ? "var(--ink)" : "var(--ink-soft)" }}>{s}</span>
            </button>
            {i < STEPS.length - 1 ? <span style={{ width: 40, height: 1, background: step > i + 1 ? "var(--ok)" : "var(--line)", margin: "0 12px" }} /> : null}
          </React.Fragment>
        ))}
      </div>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 1080 }}>
        <P padding={0}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap" }}>
            <button type="button" onClick={() => navigate(cfg.back)}
              style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--line-strong)", background: "var(--panel)",
                borderRadius: "var(--radius-btn)", padding: "5px 10px", cursor: "pointer", fontSize: 13 }}>
              {Icon ? <Icon name="arrow-left" size={14} /> : "←"} {cfg.backLabel}
            </button>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{cfg.title}</div>
              {cfg.note ? <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{cfg.note}</div> : null}
            </div>
            {StatusChip ? <StatusChip tone={unmapped.length ? "warn" : "ok"}>{unmapped.length ? unmapped.length + " 个字段未匹配" : "字段已全部匹配"}</StatusChip> : null}
          </div>
          <div style={{ borderTop: "1px solid var(--line)", padding: "12px 16px", background: "var(--surface-2)" }}>{stepper}</div>
        </P>

        {step === 1 ? (
          <P>
            <div style={{ display: "grid", placeItems: "center", gap: 10, padding: "36px 20px", border: "1px dashed var(--line-strong)",
              borderRadius: "var(--radius-card)", background: "var(--surface-2)", textAlign: "center" }}>
              {Icon ? <Icon name="upload" size={22} color="var(--ink-faint)" /> : null}
              <div style={{ fontSize: 13, fontWeight: 700 }}>拖入 Excel，或点击选择文件</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>支持 .xlsx / .xls；首行须为表头。已读取「{cfg.file}」共 {total} 行</div>
              {Button ? <Button variant="secondary" onClick={() => setStep(2)}>下一步：字段匹配</Button> : null}
            </div>
          </P>
        ) : null}

        {step === 2 ? (
          <P padding={0}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)" }}>
              左列为 Excel 表头，右列为系统字段。未匹配字段不会静默丢弃 —— 保持为空即在导入报告中列为「已忽略列」。
            </div>
            {MAPPING.map((m) => (
              <div key={m.src} style={{ display: "grid", gridTemplateColumns: "1fr 28px 1.2fr 110px", gap: 10, alignItems: "center",
                padding: "9px 14px", borderTop: "1px solid var(--line)" }}>
                <span style={{ fontSize: 13, fontFamily: "var(--font-mono)" }}>{m.src}</span>
                {Icon ? <Icon name="arrow-right" size={13} color="var(--ink-faint)" /> : <span>→</span>}
                {KA.SelectFilter ? (
                  <KA.SelectFilter label="" fullWidth value={m.label || "（不导入）"} onChange={() => {}}
                    options={cfg.options} />
                ) : null}
                <span style={{ fontSize: 11, fontWeight: 700, textAlign: "right",
                  color: !m.target ? "var(--warn-ink)" : m.auto ? "var(--ok-ink)" : "var(--brand-deep)" }}>
                  {!m.target ? "未匹配" : m.auto ? "自动匹配" : "人工指定"}
                  {m.required ? <span style={{ color: "var(--danger)" }}> *</span> : null}
                </span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "12px 14px", borderTop: "1px solid var(--line)" }}>
              {Button ? <Button variant="ghost" onClick={() => setStep(1)}>上一步</Button> : null}
              {Button ? <Button variant="primary" onClick={() => setStep(3)}>下一步：预览确认</Button> : null}
            </div>
          </P>
        ) : null}

        {step === 3 ? (
          <React.Fragment>
            <P>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                {[["可导入", total - REJECTED.length, "var(--ok-ink)"], ["需人工处理", REJECTED.length, "var(--danger-ink)"], ["已忽略列", unmapped.length, "var(--ink-soft)"]].map(([l, v, c]) => (
                  <div key={l}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-soft)" }}>{l}</div>
                    <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-mono)", color: c }}>{v}</div>
                  </div>
                ))}
              </div>
            </P>
            <P padding={0}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", background: "var(--danger-soft)",
                fontSize: 12, fontWeight: 700, color: "var(--danger-ink)" }}>
                行级拒绝清单（不静默丢弃，可下载后修正重导）
              </div>
              {REJECTED.map((r) => (
                <div key={r.row} style={{ display: "flex", gap: 12, padding: "9px 14px", borderTop: "1px solid var(--line)", fontSize: 13 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, minWidth: 64 }}>第 {r.row} 行</span>
                  <span style={{ color: "var(--ink-soft)" }}>{r.reason}</span>
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "12px 14px", borderTop: "1px solid var(--line)" }}>
                {Button ? <Button variant="secondary" onClick={() => UI.toast("已导出拒绝清单", "ok")}>下载拒绝清单</Button> : null}
                {Button ? <Button variant="ghost" onClick={() => setStep(2)}>上一步</Button> : null}
                {Button ? <Button variant="primary" onClick={() => UI.toast("已导入 " + (total - REJECTED.length) + " 行", "ok")}>确认导入</Button> : null}
              </div>
            </P>
          </React.Fragment>
        ) : null}
      </div>
    );
  }

  window.ImportMappingScreen = ImportMappingScreen;
})();
