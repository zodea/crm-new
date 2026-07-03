// BoqImportScreen — 合同工程量清单拆表向导（识别中心/合同附件入口 · 反馈轮 7 新建）
// 三步向导：① 上传识别格式(A–E类) → ② 人工确认页(户型×套数/差额/镜像归并/零量取舍) → ③ 拆表结果预览 → 入库清单管理页。
// 样例 = 合和七期（B 类·章节树户内合同型，最复杂）；蓝本 boq-import.md。
(function () {
  const { Button, StatusChip, Panel, Icon } = window.DesignSystem_e3d871;
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), folderPicker: (cb) => cb && cb() };
  const money = (v) => "¥" + Number(v || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 });

  // —— 合和七期 B 类样例 ——
  const SHEETS = [{ name: "交标", rows: 1286, use: "户内清单（章节树 + 于XX房间）" }, { name: "公区", rows: 214, use: "公共区域清单" }];
  const UNITTYPES = [
    { key: "B1", label: "B1 户型", sets: 48, area: "89㎡", listQty: 4128, calcQty: 4128, mirror: false },
    { key: "B2", label: "B2 户型（镜像）", sets: 48, area: "89㎡", listQty: 4128, calcQty: 4128, mirror: true, mergeTo: "B1" },
    { key: "C1", label: "C1 户型", sets: 24, area: "116㎡", listQty: 2760, calcQty: 2784, mirror: false },
    { key: "D1", label: "D1 户型（复式）", sets: 12, area: "142㎡", listQty: 1680, calcQty: 1704, mirror: false },
  ];
  const RESULT = [
    { div: "楼地面工程", trade: "泥水", item: "客餐厅地砖铺贴 800×800", room: "客餐厅", unit: "㎡", qty: 32.6, price: 78, src: "交标!R118" },
    { div: "楼地面工程", trade: "泥水", item: "阳台地砖铺贴 300×600", room: "阳台", unit: "㎡", qty: 6.4, price: 72, src: "交标!R124" },
    { div: "楼地面工程", trade: "泥水", item: "卫生间地砖防滑 300×300", room: "主卫/次卫", unit: "㎡", qty: 9.8, price: 85, src: "交标!R131" },
    { div: "墙柱面工程", trade: "泥水", item: "厨房墙砖 300×600", room: "厨房", unit: "㎡", qty: 21.5, price: 68, src: "交标!R156" },
    { div: "墙柱面工程", trade: "泥水", item: "卫生间墙砖 300×600", room: "主卫/次卫", unit: "㎡", qty: 34.2, price: 68, src: "交标!R162" },
    { div: "墙柱面工程", trade: "油漆", item: "墙面乳胶漆两遍", room: "客餐厅/卧室", unit: "㎡", qty: 128.4, price: 26, src: "交标!R203" },
    { div: "墙柱面工程", trade: "油漆", item: "顶棚乳胶漆两遍", room: "全屋", unit: "㎡", qty: 78.9, price: 28, src: "交标!R211" },
    { div: "装饰工程", trade: "石材", item: "窗台石 大理石", room: "各窗台", unit: "m", qty: 8.2, price: 220, src: "交标!R240" },
    { div: "楼地面工程", trade: "自流平", item: "卧室自流平找平", room: "卧室", unit: "㎡", qty: 42.6, price: 32, src: "交标!R096" },
  ];

  function Stepper({ step }) {
    const steps = ["上传识别格式", "人工确认", "拆表结果"];
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {steps.map((s, i) => (
          <React.Fragment key={s}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 800, background: i < step ? "var(--ok)" : i === step ? "var(--brand)" : "var(--surface-3)", color: i <= step ? "#fff" : "var(--ink-faint)" }}>{i < step ? "✓" : i + 1}</span>
              <span style={{ fontSize: 13, fontWeight: i === step ? 800 : 600, color: i === step ? "var(--ink)" : "var(--ink-soft)" }}>{s}</span>
            </div>
            {i < steps.length - 1 && <span style={{ flex: 1, height: 2, background: i < step ? "var(--ok)" : "var(--line)", minWidth: 24, maxWidth: 80 }} />}
          </React.Fragment>
        ))}
      </div>
    );
  }

  function BoqImportScreen({ navigate, params }) {
    const p = params || {};
    const contract = p.contract || "合和七期户内合同版-清单";
    const project = p.project || "合和新城";
    const [step, setStep] = React.useState(0);
    const [uploaded, setUploaded] = React.useState(false);
    const [merge, setMerge] = React.useState({ B2: true });   // 镜像归并
    const [drop, setDrop] = React.useState({});               // 零量/补充区取舍：{key:true=丢弃}

    const doUpload = () => { setUploaded(true); UI().toast("已识别：B 类 · 章节树户内合同型 · 2 个 sheet", "ok"); };
    const finish = () => UI().confirm({ title: "入库清单", message: "确认将拆表结果（" + RESULT.length + " 条清单行）写入「" + contract + "」的工程量清单？入库后合同量/合同单价即以此为准。", confirmText: "入库", onConfirm: () => { UI().toast("已入库 " + RESULT.length + " 条清单行", "ok"); navigate("boqList", { contract, project }); } });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel padding={16} style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <Button icon="arrow-left" onClick={() => navigate("projectDetail", { id: "p1" })}>返回合同</Button>
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>清单拆表 · {contract}</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>合同工程量清单 → 拆分成表格 · 归属项目「{project}」</div>
          </div>
          <div style={{ marginLeft: "auto", minWidth: 360, flex: "1 1 360px" }}><Stepper step={step} /></div>
        </Panel>

        {step === 0 && (
          <Panel padding={0} style={{ overflow: "hidden" }}>
            {!uploaded ? (
              <div onClick={() => UI().folderPicker ? UI().folderPicker(doUpload) : doUpload()} style={{ margin: 18, border: "2px dashed var(--line-strong)", borderRadius: 12, background: "var(--surface-2)", padding: "56px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, cursor: "pointer", textAlign: "center" }}>
                <span style={{ width: 64, height: 64, borderRadius: 16, background: "var(--brand-soft)", display: "grid", placeItems: "center" }}><Icon name="file-spreadsheet" size={30} color="var(--brand)" /></span>
                <div style={{ fontSize: 16, fontWeight: 800 }}>上传合同工程量清单（Excel）</div>
                <div style={{ fontSize: 13, color: "var(--ink-soft)", maxWidth: 460, lineHeight: 1.6 }}>支持 7 份真实合同的 5 类格式（A 户型矩阵 / B 章节树 / C 结构化 / D 楼层分部 / E 单价库），上传后自动识别格式类并列出 sheet。</div>
                <Button variant="primary" icon="upload">选择清单文件</Button>
              </div>
            ) : (
              <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, background: "var(--ok-soft)", borderRadius: 10 }}>
                  <Icon name="badge-check" size={22} color="var(--ok-ink)" />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ok-ink)" }}>已识别：B 类 · 章节树户内合同型</div>
                    <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>合和七期户内合同版-清单20250729.xlsx · 房间藏于「于XX」文本 · 单户量 × 楼栋组户数系数</div>
                  </div>
                  <span style={{ marginLeft: "auto" }}><Button size="sm" onClick={() => setUploaded(false)}>重新上传</Button></span>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>识别到 {SHEETS.length} 个 sheet</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {SHEETS.map((s) => (
                      <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px" }}>
                        <Icon name="table" size={16} color="var(--brand)" />
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</span>
                        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{s.use}</span>
                        <span style={{ marginLeft: "auto", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{s.rows} 行</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Panel>
        )}

        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel padding={0} style={{ overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="list-checks" size={15} color="var(--brand)" />
                <span style={{ fontSize: 14, fontWeight: 800 }}>户型 × 套数对照</span>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>单套量 × 套数 = 系统总量；与清单总量列差额需人工确认</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ background: "var(--surface-2)" }}>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    {["户型", "面积", "套数", "清单总量", "单套量×套数", "差额", "镜像归并"].map((h, i) => <th key={h} style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: i >= 2 && i <= 5 ? "right" : "left" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {UNITTYPES.map((u) => {
                    const diff = u.listQty - u.calcQty;
                    return (
                      <tr key={u.key} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{u.label}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, color: "var(--ink-soft)" }}>{u.area}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, fontFamily: "var(--font-mono)", textAlign: "right" }}>{u.sets}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, fontFamily: "var(--font-mono)", textAlign: "right" }}>{u.listQty}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, fontFamily: "var(--font-mono)", textAlign: "right" }}>{u.calcQty}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, fontFamily: "var(--font-mono)", textAlign: "right" }}>{diff === 0 ? <span style={{ color: "var(--ok-ink)" }}>0</span> : <StatusChip tone="warn">{diff > 0 ? "+" : ""}{diff}</StatusChip>}</td>
                        <td style={{ padding: "10px 14px" }}>{u.mirror ? <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}><input type="checkbox" checked={!!merge[u.key]} onChange={() => setMerge((m) => ({ ...m, [u.key]: !m[u.key] }))} />归并到 {u.mergeTo}</label> : <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Panel padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}><Icon name="triangle-alert" size={15} color="var(--warn)" />差额行提示（2 处）</div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.7 }}>C1 户型总量差 <b style={{ color: "var(--warn-ink)" }}>+24㎡</b>、D1 户型差 <b style={{ color: "var(--warn-ink)" }}>+24㎡</b>：多为公摊墙垛/门洞归并口径不同。建议以<b>单套量为准</b>（×套数），差额忽略。</div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}><input type="checkbox" defaultChecked />以单套量为准，差额忽略</label>
              </Panel>
              <Panel padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}><Icon name="filter-x" size={15} color="var(--ink-soft)" />零量行 / 补充区取舍</div>
                {[{ k: "z1", t: "「暂不施工」备注行 · 6 行" }, { k: "z2", t: "量为 0 的占位分项 · 11 行" }].map((z) => (
                  <label key={z.k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}><input type="checkbox" checked={!!drop[z.k]} onChange={() => setDrop((d) => ({ ...d, [z.k]: !d[z.k] }))} /><span>丢弃 {z.t}</span></label>
                ))}
                <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>勾选的行不进入拆表结果。</div>
              </Panel>
            </div>
          </div>
        )}

        {step === 2 && (
          <Panel padding={0} style={{ overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Icon name="table-2" size={15} color="var(--brand)" />
              <span style={{ fontSize: 14, fontWeight: 800 }}>拆表结果 · 统一清单行</span>
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>共 {RESULT.length} 条 · 已按镜像归并（B2→B1）· 单价不含税</span>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-soft)" }}>合价合计 <b style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{money(RESULT.reduce((s, r) => s + r.qty * r.price, 0))}</b></span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
                <thead style={{ background: "var(--surface-2)" }}>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    {["分部", "工种", "分项名称", "房间", "单位", "工程量", "合同单价", "合价", "来源追溯键"].map((h, i) => <th key={h} style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: i >= 5 && i <= 7 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {RESULT.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "9px 14px", fontSize: 12.5, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{r.div}</td>
                      <td style={{ padding: "9px 14px", fontSize: 12.5 }}><StatusChip tone="neutral">{r.trade}</StatusChip></td>
                      <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 600 }}>{r.item}</td>
                      <td style={{ padding: "9px 14px", fontSize: 12.5, color: "var(--ink-soft)" }}>{r.room}</td>
                      <td style={{ padding: "9px 14px", fontSize: 12.5 }}>{r.unit}</td>
                      <td style={{ padding: "9px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right" }}>{r.qty}</td>
                      <td style={{ padding: "9px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right" }}>{money(r.price)}</td>
                      <td style={{ padding: "9px 14px", fontSize: 12.5, fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 700 }}>{money(r.qty * r.price)}</td>
                      <td style={{ padding: "9px 14px", fontSize: 11.5, fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}>{r.src}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* 底部导航 */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <Button icon="arrow-left" disabled={step === 0} onClick={() => setStep(step - 1)}>上一步</Button>
          {step < 2
            ? <Button variant="primary" iconRight="arrow-right" disabled={step === 0 && !uploaded} onClick={() => setStep(step + 1)}>{step === 0 ? "下一步 · 人工确认" : "下一步 · 查看结果"}</Button>
            : <Button variant="primary" icon="database" onClick={finish}>入库到工程量清单</Button>}
        </div>
      </div>
    );
  }

  window.BoqImportScreen = BoqImportScreen;
})();
