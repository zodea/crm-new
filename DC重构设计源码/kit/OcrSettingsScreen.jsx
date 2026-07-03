// OcrSettingsScreen — OCR 设置页（识别中心 · 反馈轮 7 新建）
// 参考 andyhuo520/ppocrv6-studio 的单页区块式设计（非多 Tab）：每项下一行说明文案，滑块实时数值回显，
// 底部「恢复默认」(confirm) +「保存」。按单据类型分引擎；置信度仅作参考，判决权在人。
(function () {
  const { Button, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), modal: () => {} };

  const ENGINES = ["本地 PaddleOCR", "云端 PaddleOCR-VL", "大模型视觉识别"];
  const DEFAULTS = {
    engInvoice: "本地 PaddleOCR", engDelivery: "云端 PaddleOCR-VL", engBoq: "云端 PaddleOCR-VL",
    apiUrl: "https://api.example.com/v1/ocr", apiKey: "", model: "qwen-vl-max",
    tier: "标准", detThresh: 0.20, boxThresh: 0.40, unclip: 1.40, maxEdge: 960, autoRotate: true,
    greenLine: 95, warnLine: 80, fallback: "云端 → 本地 → 人工录入",
  };

  function OcrSettingsScreen() {
    const [c, setC] = React.useState({ ...DEFAULTS });
    const set = (k) => (v) => setC((s) => ({ ...s, [k]: v }));
    const reset = () => UI().confirm({ title: "恢复默认设置", message: "将全部 OCR 设置恢复为默认值？", confirmText: "恢复默认", onConfirm: () => { setC({ ...DEFAULTS }); UI().toast("已恢复默认设置", "ok"); } });
    const save = () => UI().toast("设置已保存，引擎已重载", "ok");
    const test = () => {
      if (!c.apiKey) { UI().toast("请先填写 API 密钥", "danger"); return; }
      UI().modal({ title: "连接测试", subtitle: c.model + " @ " + c.apiUrl, width: 440, bodyHTML:
        '<div style="display:flex;flex-direction:column;gap:10px;font-size:13px">' +
        '<div style="display:flex;align-items:center;gap:8px;color:var(--ok-ink)"><b>✓ 连接成功</b> · 响应 428ms</div>' +
        '<div style="padding:10px 12px;background:var(--surface-2);border-radius:8px;line-height:1.7">样例图识别结果：<br>单据编号 <b style="font-family:var(--font-mono)">58761309</b> · 金额 <b style="font-family:var(--font-mono)">¥45,200.00</b> · 置信度 <b>97%</b></div>' +
        '</div>', actions: [{ label: "关闭", primary: true }] });
    };

    return (
      <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <Section icon="scan-line" title="识别引擎" desc="按单据类型分别指定 OCR 引擎——发票版式规整本地即可，送货单/清单手写与版式多变建议云端或大模型。">
          <EngineRow label="发票识别" value={c.engInvoice} onChange={set("engInvoice")} options={ENGINES} />
          <EngineRow label="送货单识别" value={"云端 PaddleOCR-VL"} onChange={() => {}} options={["云端 PaddleOCR-VL", "大模型视觉识别"]} locked hint="送货单强制走云端（手写单据多，本地识别率不足）" />
          <EngineRow label="清单拆表" value={c.engBoq} onChange={set("engBoq")} options={ENGINES} />
        </Section>

        <Section icon="cloud" title="云端与大模型接入" desc="云端 PaddleOCR-VL 与大模型视觉识别共用此接入配置；填写后可测试连接。">
          <TextRow label="API 地址" value={c.apiUrl} onChange={set("apiUrl")} mono placeholder="https://…" />
          <TextRow label="API 密钥" value={c.apiKey} onChange={set("apiKey")} mono placeholder="sk-…（本地保存，不上传）" type="password" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "end" }}>
            <TextRow label="模型名称" value={c.model} onChange={set("model")} mono placeholder="qwen-vl-max / gpt-4o …" />
            <Button icon="plug" onClick={test}>测试连接</Button>
          </div>
        </Section>

        <Section icon="cpu" title="本地引擎参数" desc="仅本地 PaddleOCR 生效。检测参数影响文本框召回与精度；云端 VL 自带自动旋转，无需在此配置。">
          <SelectRow label="模型档位" value={c.tier} onChange={set("tier")} options={["轻量（最快）", "标准", "高精度（最准）"].map((x) => x)} hint="档位越高越准、越慢；票据识别「标准」通常足够。" />
          <Slider label="二值化阈值 det_thresh" value={c.detThresh} onChange={set("detThresh")} min={0.05} max={0.5} step={0.01} hint="越低召回越多，可能引入噪声。" />
          <Slider label="框置信度 box_thresh" value={c.boxThresh} onChange={set("boxThresh")} min={0.1} max={0.8} step={0.01} hint="低于该置信度的文本框被丢弃。" />
          <Slider label="外扩比例 unclip" value={c.unclip} onChange={set("unclip")} min={1.0} max={2.5} step={0.05} hint="文本框向外扩张的比例，过小易截断字符。" />
          <Slider label="最大边长 max_edge" value={c.maxEdge} onChange={set("maxEdge")} min={480} max={2048} step={32} int hint="超过则等比缩小后再检测，越大越清晰越慢。" />
          <ToggleRow label="识别失败自动旋转重试" value={c.autoRotate} onChange={set("autoRotate")} hint="本地识别失败时自动旋转 90°/270° 重试（本地引擎内部行为）。" />
        </Section>

        <Section icon="sliders-horizontal" title="置信度与流程" desc="置信度仅作参考着色，帮助分堆；每张单据是否通过的判决权始终在人。">
          <Slider label="绿色阈值（可信）" value={c.greenLine} onChange={set("greenLine")} min={85} max={99} step={1} int suffix="%" hint="≥ 此值标绿「可信」。" />
          <Slider label="黄色阈值（待确认）" value={c.warnLine} onChange={set("warnLine")} min={60} max={90} step={1} int suffix="%" hint="介于黄绿之间标黄「待确认」，低于此值标红「低置信」。" />
          <SelectRow label="识别降级链" value={c.fallback} onChange={set("fallback")} options={["云端 → 本地 → 人工录入", "本地 → 云端 → 人工录入", "仅本地 → 人工录入"]} hint="主引擎失败后的回落顺序。" />
        </Section>

        <div style={{ position: "sticky", bottom: 0, display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 0" }}>
          <Panel padding={10} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--ink-soft)", marginRight: 4 }}>本地保存 · 不上传</span>
            <Button icon="rotate-ccw" onClick={reset}>恢复默认</Button>
            <Button variant="primary" icon="save" onClick={save}>保存设置</Button>
          </Panel>
        </div>
      </div>
    );
  }

  function Section({ icon, title, desc, children }) {
    return (
      <Panel padding={0} style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--brand-soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name={icon} size={15} color="var(--brand)" /></span>
            <span style={{ fontSize: 15, fontWeight: 800 }}>{title}</span>
          </div>
          {desc && <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.6 }}>{desc}</div>}
        </div>
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
      </Panel>
    );
  }
  function FieldWrap({ label, hint, children }) {
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{label}</div>
        {children}
        {hint && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 5, lineHeight: 1.5 }}>{hint}</div>}
      </div>
    );
  }
  function EngineRow({ label, value, onChange, options, locked, hint }) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select value={value} disabled={locked} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, border: "1px solid var(--line-strong)", borderRadius: 8, padding: "8px 11px", fontSize: 13, background: locked ? "var(--surface-2)" : "#fff", color: locked ? "var(--ink-soft)" : "var(--ink)", cursor: locked ? "not-allowed" : "pointer" }}>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {locked && <StatusChip tone="brand">强制</StatusChip>}
          </div>
          {hint && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 5 }}>{hint}</div>}
        </div>
      </div>
    );
  }
  function TextRow({ label, value, onChange, mono, placeholder, type }) {
    return <FieldWrap label={label}><input type={type || "text"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--line-strong)", borderRadius: 8, padding: "8px 11px", fontSize: 13, fontFamily: mono ? "var(--font-mono)" : "inherit", background: "#fff", outline: "none" }} /></FieldWrap>;
  }
  function SelectRow({ label, value, onChange, options, hint }) {
    return <FieldWrap label={label} hint={hint}><select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", border: "1px solid var(--line-strong)", borderRadius: 8, padding: "8px 11px", fontSize: 13, background: "#fff", cursor: "pointer" }}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></FieldWrap>;
  }
  function ToggleRow({ label, value, onChange, hint }) {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div><div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>{hint && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 5, lineHeight: 1.5 }}>{hint}</div>}</div>
        <button onClick={() => onChange(!value)} style={{ flex: "none", width: 44, height: 24, borderRadius: 999, border: 0, background: value ? "var(--brand)" : "var(--surface-3)", position: "relative", cursor: "pointer", transition: "background .15s" }}>
          <span style={{ position: "absolute", top: 2, left: value ? 22 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)", transition: "left .15s" }} />
        </button>
      </div>
    );
  }
  function Slider({ label, value, onChange, min, max, step, hint, int, suffix }) {
    return (
      <FieldWrap label={<span style={{ display: "flex", justifyContent: "space-between" }}><span>{label}</span><span style={{ fontFamily: "var(--font-mono)", color: "var(--brand-deep)" }}>{int ? Math.round(value) : Number(value).toFixed(2)}{suffix || ""}</span></span>} hint={hint}>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(int ? parseInt(e.target.value, 10) : parseFloat(e.target.value))} style={{ width: "100%", accentColor: "var(--brand)", cursor: "pointer" }} />
      </FieldWrap>
    );
  }

  window.OcrSettingsScreen = OcrSettingsScreen;
})();
