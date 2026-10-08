// WorkerPrivateScreen — 工人私密资料与照片整页（路由 workerPrivate，对应实现 /base/worker/private/:id?origin=real）。
// 依据：app/components/worker/WorkerPrivateProfileScreen.vue、app/composables/useWorkerPrivateProfile.ts、
//       app/lib/worker-roster/contract.ts、docs/rewrite/pages/base-worker.md（#449）、ADR 0014。
// 规则摘要：
//   · 进入需 worker:sensitive:read，维护还需 worker:write；普通列表 / 详情继续脱敏，工资权限不隐含私密权限。
//   · 实名、银行、进退场只读来自工人主档，缺失资料去工人表单补；本页只维护「劳动合同签订事实」与两类照片原件。
//   · 劳动合同：未记录 / 已签订 / 未签订；仅「已签订」可填签订日期，不按工资发放状态推断。
//   · 照片用途（证件照 portrait / 银行卡照 bank-card）须人工明确；旧附件不按文件名推断用途，缺正文的附件不可选；
//     仅 PNG/JPEG、≤20 MB。照片替换后，已归档名册仍保留原版本。
//   · 只接受正式中央来源：独立桌面显示「请在中央工作区打开」，非 origin=real 显示「请从正式工人详情进入」。
// params：id（工人 ID）；previewState：ready | empty（无可选原件）| loading | error（无权限或读取失败）| readonly（无 worker:write）
//   | pending（上次提交待核对）| desktop（独立桌面）| origin（来源不明确）。演示数据仅在本文件内。
(function () {
  const DEMO_META = { gender: "男", hometown: "广东梅州", bankName: "中国农业银行梅州分行", bankAccount: "6228 4801 2345 6789 012", exitDate: null };
  const DEMO_ASSETS = [
    { id: "asset-1", fileName: "证件照-2026.jpg", mimeType: "image/jpeg", state: "available", legacyCategory: null },
    { id: "asset-2", fileName: "银行卡正面.png", mimeType: "image/png", state: "available", legacyCategory: null },
    { id: "asset-3", fileName: "身份证.jpg", mimeType: "image/jpeg", state: "available", legacyCategory: "身份证" },
    { id: "asset-4", fileName: "银行卡.jpg", mimeType: "image/jpeg", state: "missing", legacyCategory: "银行卡" },
    { id: "asset-5", fileName: "安全培训证.pdf", mimeType: "application/pdf", state: "available", legacyCategory: "安全培训合格证" },
  ];
  const PHOTOS = [
    { purpose: "portrait", field: "portraitId", label: "证件照" },
    { purpose: "bank-card", field: "bankCardId", label: "银行卡照" },
  ];
  const INPUT = { width: "100%", minWidth: 0, boxSizing: "border-box", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", padding: "7px 10px", fontSize: 13, background: "#fff", color: "var(--ink)" };

  function WorkerPrivateScreen({ data, navigate, params }) {
    const p = params || {};
    const { Panel, Button } = window.DesignSystem_e3d871;
    const KA = window.KitAtoms || {};
    const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const workers = (data && data.workers) || [];
    const w = workers.find((x) => x.id === p.id) || workers[0] || { id: "w1", name: "虞建华", phone: "13511220001", idCard: "330682198503117890", entryDate: "2024-08-15" };
    const state = p.previewState || "ready";
    const writable = state !== "readonly" && state !== "pending";
    const assets = state === "empty" ? [] : DEMO_ASSETS;
    const initial = state === "empty"
      ? { laborContractSigned: null, laborContractSignedOn: null, portraitId: null, bankCardId: null }
      : { laborContractSigned: true, laborContractSignedOn: "2024-08-15", portraitId: "asset-1", bankCardId: null };
    const [values, setValues] = React.useState(initial);
    const [uploads, setUploads] = React.useState({});
    const dirty = JSON.stringify(values) !== JSON.stringify(initial) || Object.keys(uploads).length > 0;
    const toWorker = () => navigate("workerDetail", { id: w.id });
    const leave = () => {
      if (state === "pending") { UI().toast("请先核对当前提交结果", "danger"); return; }
      if (dirty) UI().confirm({ title: "放弃资料修改", message: "资料和新照片尚未保存，确认放弃？", confirmText: "放弃修改", onConfirm: toWorker });
      else toWorker();
    };
    const save = () => {
      if (!writable || !dirty) return;
      setUploads({});
      UI().toast("工人资料已保存，新名册将使用这一版本", "ok");
    };
    const setSigned = (raw) => {
      const signed = raw === "unknown" ? null : raw === "true";
      setValues((v) => ({ ...v, laborContractSigned: signed, laborContractSignedOn: signed ? v.laborContractSignedOn : null }));
    };
    const choosePhoto = (purpose, file) => {
      if (!file) return;
      if (!["image/png", "image/jpeg"].includes(file.type) || file.size < 1 || file.size > 20 * 1024 * 1024) { UI().toast("请选择不超过 20 MB 的 PNG 或 JPEG 照片", "danger"); return; }
      setUploads((u) => ({ ...u, [purpose]: { fileName: file.name } }));
    };

    // —— 入口守卫：与实现 pages/base/worker/private/[id].vue 一致，直接替换整页 ——
    if (state === "desktop" || state === "origin") {
      return (
        <Panel padding={16} role={state === "origin" ? "alert" : "status"}>
          {state === "desktop" ? "此归档入口用于中央正式资料，请在中央工作区打开。" : "工人私密资料需要明确正式来源；请从正式工人详情进入。"}
        </Panel>
      );
    }

    const header = (
      <header style={{ marginBottom: 16 }}>
        <button type="button" onClick={leave} aria-label="返回工人详情" style={{ display: "inline-flex", alignItems: "center", gap: 4, border: 0, background: "transparent", padding: 0, marginBottom: 4, fontSize: 12, color: "var(--brand-deep)", cursor: "pointer" }}>← 返回工人详情</button>
        <h1 style={{ margin: 0, fontSize: 20, lineHeight: "28px", fontWeight: 800 }}>工人私密资料</h1>
        <p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: "20px", color: "var(--ink-faint)" }}>完整实名资料与照片单独授权。照片替换后，已归档名册仍保留原版本。</p>
      </header>
    );

    if (state === "loading" || state === "error") {
      return (
        <div style={{ maxWidth: 1080, margin: "0 auto", minWidth: 0 }}>
          {header}
          {KA.StatePanel && <KA.StatePanel state={state} title={state === "loading" ? "正在读取私密资料" : "私密资料未能读取"} description={state === "error" ? "当前身份没有工人私密资料读取权限（worker:sensitive:read），未返回完整字段。" : undefined} actionLabel={state === "error" ? "重新读取" : undefined} onAction={() => navigate("workerPrivate", { ...p, previewState: "ready" })} />}
        </div>
      );
    }

    const identity = [
      ["性别", DEMO_META.gender], ["籍贯", DEMO_META.hometown], ["身份证号", w.idCard], ["联系电话", w.phone],
      ["开户行", DEMO_META.bankName], ["银行账号", DEMO_META.bankAccount], ["进场日期", w.entryDate], ["退场日期", w.exitDate || DEMO_META.exitDate],
    ];

    return (
      // 实现 EntityFormShell 在宽容器为三分区（实名与银行 / 劳动合同 / 照片原件）显示左侧锚点；设计稿不自建锚点导航，单栏按分区卡片呈现。
      <div style={{ maxWidth: 1080, margin: "0 auto", minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            {header}
            {state === "pending" && (
              <Panel padding={16} role="status" style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                <span>上次提交结果待核对，核对前暂停新的保存。</span>
                <Button onClick={() => { UI().toast("已确认原提交未保存，可以继续修改", "ok"); navigate("workerPrivate", { ...p, previewState: "ready" }); }}>核对原提交</Button>
              </Panel>
            )}

            <Panel padding={16} id="wp-section-identity" style={{ marginBottom: 16 }}>
              {KA.SectionHeader ? <KA.SectionHeader mb={4}>{w.name}</KA.SectionHeader> : <b>{w.name}</b>}
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>以下来自工人主档；缺失资料在工人表单补充。</div>
              <dl style={{ margin: "16px 0 0", display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))" }}>
                {identity.map(([label, value]) => (
                  <div key={label} style={{ minWidth: 0 }}>
                    <dt style={{ fontSize: 12, color: "var(--ink-soft)" }}>{label}</dt>
                    <dd style={{ margin: "4px 0 0", fontSize: 13, wordBreak: "break-all", fontFamily: value && /号|电话|账号|日期/.test(label) ? "var(--font-mono)" : "inherit", color: value ? "var(--ink)" : "var(--ink-faint)" }}>{value || "未记录"}</dd>
                  </div>
                ))}
              </dl>
              {state !== "readonly" && <div style={{ marginTop: 16 }}><Button onClick={() => navigate("workerForm", { id: w.id })}>编辑工人主档</Button></div>}
            </Panel>

            <Panel padding={16} id="wp-section-contract" style={{ marginBottom: 16 }}>
              {KA.SectionHeader ? <KA.SectionHeader mb={4}>劳动合同签订事实</KA.SectionHeader> : <b>劳动合同签订事实</b>}
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>资料版本 7；不根据工资发放状态推断是否签订。</div>
              <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))" }}>
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>签订情况
                  <select aria-label="签订情况" style={INPUT} disabled={!writable} value={values.laborContractSigned === null ? "unknown" : String(values.laborContractSigned)} onChange={(e) => setSigned(e.target.value)}>
                    <option value="unknown">未记录</option><option value="true">已签订</option><option value="false">未签订</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>签订日期
                  <input aria-label="签订日期" type="date" style={INPUT} disabled={!writable || values.laborContractSigned !== true} value={values.laborContractSignedOn || ""} onChange={(e) => setValues((v) => ({ ...v, laborContractSignedOn: e.target.value || null }))} />
                </label>
              </div>
            </Panel>

            <Panel padding={16} id="wp-section-photos" style={{ marginBottom: 16 }}>
              {KA.SectionHeader ? <KA.SectionHeader mb={4}>两类照片原件</KA.SectionHeader> : <b>两类照片原件</b>}
              <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6 }}>用途须人工明确。旧附件不按文件名推断用途，缺正文的附件不能作为有效照片。支持 PNG/JPEG，每张不超过 20 MB。</div>
              <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 22rem), 1fr))" }}>
                {PHOTOS.map((photo) => {
                  const pending = uploads[photo.purpose];
                  return (
                    <fieldset key={photo.purpose} style={{ minWidth: 0, margin: 0, border: "1px solid var(--line)", borderRadius: 10, padding: 16 }}>
                      <legend style={{ padding: "0 4px", fontSize: 13, fontWeight: 700 }}>{photo.label}</legend>
                      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>选用已有原件
                        <select style={INPUT} disabled={!writable || !!pending} value={values[photo.field] || ""} onChange={(e) => setValues((v) => ({ ...v, [photo.field]: e.target.value || null }))}>
                          <option value="">尚未关联</option>
                          {assets.map((a) => (
                            <option key={a.id} value={a.id} disabled={a.state !== "available" || !["image/png", "image/jpeg"].includes(a.mimeType)}>
                              {a.fileName}{a.state === "missing" ? "（缺正文）" : ""}{a.legacyCategory ? " · 旧类别：" + a.legacyCategory : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ marginTop: 12, display: "grid", gap: 4, fontSize: 12 }}>上传新的{photo.label}
                        <input type="file" accept="image/png,image/jpeg" aria-label={"上传" + photo.label} disabled={!writable} onChange={(e) => choosePhoto(photo.purpose, e.target.files && e.target.files[0])} style={{ minWidth: 0, width: "100%", fontSize: 12 }} />
                      </label>
                      {pending && (
                        <p style={{ margin: "8px 0 0", fontSize: 12, wordBreak: "break-all" }}>待保存：{pending.fileName}{" "}
                          <Button size="sm" disabled={!writable} onClick={() => setUploads((u) => { const n = { ...u }; delete n[photo.purpose]; return n; })}>取消新照片</Button>
                        </p>
                      )}
                      {values[photo.field] && <div style={{ marginTop: 12 }}><Button onClick={() => UI().toast("正在下载当前原件（设计演示）")}>下载当前原件</Button></div>}
                    </fieldset>
                  );
                })}
              </div>
            </Panel>

            <div role="group" aria-label="表单操作" style={{ position: "sticky", bottom: 0, zIndex: 15, display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", boxShadow: "0 -4px 16px rgba(16,24,40,0.06)" }}>
              <Button disabled={state === "pending"} onClick={leave}>返回工人</Button>
              <Button variant="primary" disabled={!writable || !dirty} onClick={save}>保存资料与照片</Button>
            </div>
          </div>
      </div>
    );
  }

  window.WorkerPrivateScreen = WorkerPrivateScreen;
})();
