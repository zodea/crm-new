// SettingsDialog — 云识别（PaddleOCR-VL）设置弹窗。
(function () {
  const { Button, Field, Icon, Panel } = window.DesignSystem_e3d871;

  function SettingsDialog({ open, onClose }) {
    const [cloud, setCloud] = React.useState(true);
    if (!open) return null;
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
        <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.4)" }} />
        <div style={{ position: "absolute", top: "10vh", left: "50%", transform: "translateX(-50%)", width: "min(640px,94vw)", background: "var(--bg)", borderRadius: 12, boxShadow: "var(--shadow-pop)", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700 }}>
              <Icon name="settings" size={20} color="var(--ink-soft)" />设置 — 云识别（PaddleOCR-VL）
            </div>
            <button onClick={onClose} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, border: "1px solid var(--line)", borderRadius: 8, background: "#fff", cursor: "pointer" }}>
              <Icon name="x" size={16} color="var(--ink-soft)" />
            </button>
          </div>
          <Panel padding={14} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.7 }}>
              手写送货单识别需要云端大模型。到 <b style={{ color: "var(--brand)" }}>aistudio.baidu.com/paddleocr/task</b> 登录后，在「API 调用示例」里复制下面两项。填好后所有识别自动走云端；未填则用本地小模型（仅识别印刷体）。
            </p>
            {/* 识别方式切换 */}
            <div style={{ display: "flex", gap: 8 }}>
              {[["cloud", "云识别"], ["local", "本地识别"]].map(([k, l]) => (
                <button key={k} onClick={() => setCloud(k === "cloud")} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid", borderColor: (cloud === (k === "cloud")) ? "var(--brand)" : "var(--line-strong)", background: (cloud === (k === "cloud")) ? "var(--brand-soft)" : "#fff", color: (cloud === (k === "cloud")) ? "var(--brand)" : "var(--ink)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
            <Field label="API 地址（官方异步接口，…/api/v2/ocr/jobs）" value="https://paddleocr.aistudio-app.com/api/v2/ocr/jobs" />
            <Field label="访问令牌 Access Token" mono placeholder="40 位字符" />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Button variant="primary">保存</Button>
              <Button>测试连接</Button>
              <span style={{ marginLeft: "auto", fontSize: 12, color: cloud ? "var(--ok)" : "var(--ink-soft)" }}>{cloud ? "✓ 已配置：识别将走云端" : "未配置：识别走本地小模型"}</span>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--ink-soft)" }}>令牌只保存在本机（localStorage），不会写入文件或上传；识别时单据图片会发送到百度星河平台处理。</p>
          </Panel>
        </div>
      </div>
    );
  }
  window.SettingsDialog = SettingsDialog;
})();
