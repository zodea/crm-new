// ExportConfigScreen — 导出配置页签（ADR 0004；#244 设计稿回填）。
// 口径：以「导出前是否需要配置目录结构」为唯一分流键 —— 不需要则直接保存（process 道 loading），
//       需要则进本独立页签。步骤条 读数据 → 生成 → 写盘；下载完成不等于业务完成，成功只发一条 system toast。
// 此前设计稿只有 KitUI.exportModal 弹窗，与 ADR 0004 冲突。
(function () {
  if (window.ExportConfigScreen) return;

  const STEPS = ["读数据", "生成文件", "写入磁盘"];

  function ExportConfigScreen({ navigate }) {
    const { Panel, Button, Icon, StatusChip } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {}, folderPicker: () => {} };
    const P = Panel || "div";
    const [step, setStep] = React.useState(0);
    const [dir, setDir] = React.useState("D:\\导出\\合和新城");
    const [group, setGroup] = React.useState("按项目 → 分供方");

    const run = () => {
      setStep(1);
      setTimeout(() => setStep(2), 400);
      setTimeout(() => { setStep(3); UI.toast("已写入 3 个目录 · 42 个文件", "ok"); }, 900);
    };

    const stepper = (
      <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" }}>
        {STEPS.map((s, i) => {
          const done = step > i + 0;
          const active = step === i + 1 || (step === 0 && i === 0);
          const tone = step > i ? "var(--ok)" : active ? "var(--brand)" : "var(--line-strong)";
          return (
            <React.Fragment key={s}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: 999,
                  border: "1px solid " + tone, color: step > i ? "#fff" : tone, background: step > i ? "var(--ok)" : "transparent",
                  fontSize: 11, fontWeight: 800 }}>{step > i ? "✓" : i + 1}</span>
                <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "var(--ink)" : "var(--ink-soft)" }}>{s}</span>
              </div>
              {i < STEPS.length - 1 ? <span style={{ width: 40, height: 1, background: step > i ? "var(--ok)" : "var(--line)", margin: "0 12px" }} /> : null}
            </React.Fragment>
          );
        })}
      </div>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 1080 }}>
        <P padding={0}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap" }}>
            <button type="button" onClick={() => navigate("deliveryArchive")}
              style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--line-strong)", background: "var(--panel)",
                borderRadius: "var(--radius-btn)", padding: "5px 10px", cursor: "pointer", fontSize: 13 }}>
              {Icon ? <Icon name="arrow-left" size={14} /> : "←"} 返回来源列表
            </button>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>导出配置 · 送货单归档库</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>需要目录分类，因此走独立页签（ADR 0004）</div>
            </div>
            {StatusChip ? <StatusChip tone={step >= 3 ? "ok" : "neutral"}>{step >= 3 ? "已写盘" : "待执行"}</StatusChip> : null}
          </div>
          <div style={{ borderTop: "1px solid var(--line)", padding: "12px 16px", background: "var(--surface-2)" }}>{stepper}</div>
        </P>

        <P>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 6 }}>导出范围</div>
              {KA.SelectFilter ? <KA.SelectFilter label="" fullWidth options={["当前筛选结果（42 条）", "本项目全部（186 条）", "勾选的 8 条"]} value="当前筛选结果（42 条）" onChange={() => {}} /> : null}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 6 }}>目录分类</div>
              {KA.SelectFilter ? <KA.SelectFilter label="" fullWidth options={["按项目 → 分供方", "按项目 → 月份", "按分供方 → 月份", "不分目录（平铺）"]} value={group} onChange={setGroup} /> : null}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 6 }}>文件格式</div>
              {KA.SelectFilter ? <KA.SelectFilter label="" fullWidth options={["PDF + Excel 台账", "仅 PDF", "仅 Excel 台账"]} value="PDF + Excel 台账" onChange={() => {}} /> : null}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 6 }}>保存目标</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input readOnly value={dir}
                  style={{ flex: 1, minWidth: 0, height: 32, padding: "0 10px", fontSize: 13, fontFamily: "var(--font-mono)",
                    border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", background: "var(--surface-2)", color: "var(--ink)" }} />
                {Button ? <Button variant="secondary" onClick={() => UI.folderPicker({ onPick: setDir })}>选择目录</Button> : null}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 14, padding: "10px 12px", border: "1px dashed var(--line-strong)", borderRadius: "var(--radius-card)",
            background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.7 }}>
            将生成目录：<span style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{dir}\\{group === "按项目 → 分供方" ? "合和新城·3 号楼\\广州市大板东建材有限公司\\" : "…\\"}</span>
            <br />写盘完成只代表文件已落地，不代表业务已完成 —— 归档与打印状态各自独立。
          </div>
        </P>

        <P>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 200, fontSize: 12, color: "var(--ink-soft)" }}>
              {step >= 3 ? "已写入 3 个目录 · 42 个文件。" : "执行期间可切走页签，回来仍看到进度。"}
            </span>
            {Button ? <Button variant="ghost" onClick={() => navigate("deliveryArchive")}>取消</Button> : null}
            {Button ? <Button variant="primary" disabled={step > 0 && step < 3} onClick={run}>{step >= 3 ? "重新导出" : "开始导出"}</Button> : null}
          </div>
        </P>
      </div>
    );
  }

  window.ExportConfigScreen = ExportConfigScreen;
})();
