// ProjectSupplierImportScreen — 项目×分供方合作关系导入向导（#192；#244 设计稿回填；#247 冲突与最小建档定稿）。
// 口径：选择文件 → 自动分类与人工确认 → 确认生成。四条硬规则必须显式呈现：
//       ① 已存在的合作关系不新建、只提示（重复关系保留原状态与历史）；
//       ② 名单里不存在的分供方必须人工确认后才新建主数据（七类归属由用户指定，不由导入猜）；
//       ③ 同名命中主数据时不强制复用、也不阻断导入，必须人工二选一；判为不同单位时
//          必须补一个区分字段（统一社会信用代码或联系电话），否则该行不可生成；
//       ④ 文件名只用于确定性分类，永远不作为单位名称的来源。
//
// #247 方案定夺（原票为 needs-info，ADR 未规定，按下述口径先行定稿）：
//   · 最小建档：允许「名称 + 人工指定类别」即建档，其余资料留空，档案显式标注
//     「最小档案 · 资料待补」。强制填全会让导入无法完成，但不标注就会被误当成已核验主数据。
//   · 同名冲突：强制复用会把同名不同实体的两家单位合并（「XX建材」重名在真实名录里很常见），
//     阻断则让整批导入卡死；因此改为人工二选一 + 判新建时必须补区分字段。
//   · 相似名：只软提示并列出候选，默认按新建，不强制处理，避免误合并。
//   · 文件名不作候选名称：文件名规则与工商注册名经常不一致，拿它当名称会污染主数据。
(function () {
  if (window.ProjectSupplierImportScreen) return;

  // 演示数据：匿名虚构（ADR 0014 §9）；kind 对齐 CONTEXT.md「分供方」七类
  // match: existing 命中唯一主数据 / conflict 同名多候选 / similar 相似名 / new 无命中
  const ROWS = [
    { id: "r1", name: "广州市大板东建材有限公司", kind: "材料供应商", match: "existing", relation: "existing", status: "已签合同" },
    { id: "r2", name: "佛山市顺祥劳务分包有限公司", kind: "劳务分包商", match: "existing", relation: "new", status: "—" },
    {
      id: "r3",
      name: "广州鑫程幕墙工程有限公司",
      kind: "专业分包商",
      match: "conflict",
      relation: "new",
      status: "—",
      candidates: [
        { id: "s-101", label: "广州鑫程幕墙工程有限公司", meta: "91440101MA5X····8T · 已合作 2 个项目" },
        { id: "s-207", label: "广州鑫程幕墙工程有限公司", meta: "统一社会信用代码缺失 · 最小档案" },
      ],
    },
    {
      id: "r4",
      name: "佛山市顺翔建材有限公司",
      kind: "材料供应商",
      match: "similar",
      relation: "new",
      status: "—",
      candidates: [{ id: "s-088", label: "佛山市顺祥建材有限公司", meta: "相似度高 · 一字之差" }],
    },
    { id: "r5", name: "李文彬", kind: "个人", match: "new", relation: "new", status: "—" },
  ];
  const KINDS = ["材料供应商", "劳务分包商", "专业分包商", "设备供应商", "检测供应商", "个人", "其他"];

  const MATCH_META = {
    existing: { label: "已存在", tone: "var(--ok-ink)" },
    conflict: { label: "同名待判", tone: "var(--danger)" },
    similar: { label: "相似名", tone: "var(--warn-ink)" },
    new: { label: "需新建", tone: "var(--warn-ink)" },
  };

  const GRID = "1.9fr 1.05fr 96px 104px 92px";

  function ProjectSupplierImportScreen({ navigate }) {
    const { Panel, Button, StatusChip, Icon } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {} };
    const P = Panel || "div";

    // 每行的人工决策：{ mode: "reuse" | "create", reuseId, distinct }
    const [decisions, setDecisions] = React.useState({});
    const decisionOf = (row) => decisions[row.id] || {};
    const patch = (id, next) => setDecisions((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...next } }));

    // 同名行必须人工二选一；判为新建时必须补区分字段，否则该行不可生成。
    const unresolved = ROWS.filter((r) => {
      if (r.match !== "conflict") return false;
      const d = decisionOf(r);
      if (!d.mode) return true;
      return d.mode === "create" && !String(d.distinct || "").trim();
    });

    const willReuse = ROWS.filter((r) => decisionOf(r).mode === "reuse");
    const dupRelations = ROWS.filter((r) => r.relation === "existing");
    const willCreateRelation = ROWS.filter((r) => r.relation === "new");
    // 需新建主数据 = 无命中 + 相似名（默认新建）+ 同名但人工判为不同单位
    const willCreateSupplier = ROWS.filter(
      (r) => r.match === "new" || r.match === "similar" || (r.match === "conflict" && decisionOf(r).mode === "create"),
    );
    const blocked = unresolved.length > 0;

    function submit() {
      if (blocked) {
        UI.toast(unresolved.length + " 行同名冲突尚未判定，无法生成", "danger");
        return;
      }
      UI.toast("已建立 " + willCreateRelation.length + " 条合作关系", "ok");
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 1080 }}>
        <P padding={0}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap" }}>
            <button type="button" onClick={() => navigate("projectSupplier")}
              style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--line-strong)", background: "var(--panel)",
                borderRadius: "var(--radius-btn)", padding: "5px 10px", cursor: "pointer", fontSize: 13 }}>
              {Icon ? <Icon name="arrow-left" size={14} /> : "←"} 返回项目·分供方工作台
            </button>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>导入合作分供方 · 合和新城·3 号楼</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>已读取「参建单位名单.xlsx」共 {ROWS.length} 行</div>
            </div>
            {StatusChip ? (
              <StatusChip tone={blocked ? "danger" : willCreateSupplier.length ? "warn" : "ok"}>
                {blocked ? unresolved.length + " 行待判定" : willCreateSupplier.length ? willCreateSupplier.length + " 家需确认新建" : "全部可匹配"}
              </StatusChip>
            ) : null}
          </div>
          <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.75 }}>
            已存在的合作关系不会被覆盖，只在下表标「已存在」并保留原状态与历史。<br />
            主数据里查不到的单位必须人工勾选类别后才新建 —— 类别不由导入猜（CONTEXT.md「分供方」七类）。<br />
            <b style={{ color: "var(--ink)" }}>同名命中多个主数据时不自动复用</b>，必须逐行判定；判为不同单位的须补区分字段。<br />
            单位名称只取自表格内容或人工输入，<b style={{ color: "var(--ink)" }}>文件名不作为名称来源</b>。
          </div>
        </P>

        <P padding={0}>
          <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, alignItems: "center",
            padding: "9px 14px", background: "var(--surface-2)", borderBottom: "1px solid var(--line)" }}>
            {["单位名称", "类别（人工指定）", "主数据", "合作关系", "本次动作"].map((h, i) => (
              <span key={h} style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textAlign: i >= 2 ? "right" : "left" }}>{h}</span>
            ))}
          </div>

          {ROWS.map((r) => {
            const d = decisionOf(r);
            const meta = MATCH_META[r.match];
            const rowUnresolved = unresolved.indexOf(r) >= 0;
            const action = r.relation === "existing" ? "跳过" : d.mode === "reuse" ? "复用建关系" : "生成";
            return (
              <div key={r.id} style={{ borderTop: "1px solid var(--line)", background: r.relation === "existing" ? "var(--surface-3)" : "transparent" }}>
                <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, alignItems: "center", padding: "9px 14px" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}>{r.name}</span>
                  {KA.SelectFilter ? <KA.SelectFilter label="" fullWidth value={r.kind} onChange={() => {}} options={KINDS} /> : <span>{r.kind}</span>}
                  <span style={{ fontSize: 11, fontWeight: 700, textAlign: "right", color: meta.tone }}>{meta.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, textAlign: "right", color: r.relation === "existing" ? "var(--ink-soft)" : "var(--brand-deep)" }}>
                    {r.relation === "existing" ? "已存在（" + r.status + "）" : "将建立"}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, textAlign: "right", color: rowUnresolved ? "var(--danger)" : r.relation === "existing" ? "var(--ink-faint)" : "var(--ink)" }}>
                    {rowUnresolved ? "待判定" : action}
                  </span>
                </div>

                {/* 同名冲突：人工二选一，判为不同单位时必须补区分字段 */}
                {r.match === "conflict" && (
                  <div style={{ margin: "0 14px 12px", border: "1px solid " + (rowUnresolved ? "var(--danger)" : "var(--line-strong)"),
                    background: rowUnresolved ? "var(--danger-soft)" : "var(--surface-2)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: rowUnresolved ? "var(--danger)" : "var(--ink)", marginBottom: 8 }}>
                      主数据中有 {r.candidates.length} 家同名单位 —— 请判定这一行是其中之一，还是另一家单位。
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {r.candidates.map((c) => (
                        <label key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", padding: "6px 8px",
                          borderRadius: 8, background: d.mode === "reuse" && d.reuseId === c.id ? "var(--brand-soft)" : "transparent" }}>
                          <input type="radio" name={"conflict-" + r.id} checked={d.mode === "reuse" && d.reuseId === c.id}
                            onChange={() => patch(r.id, { mode: "reuse", reuseId: c.id })} style={{ marginTop: 2 }} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600 }}>复用 · {c.label}</span>
                            <span style={{ display: "block", fontSize: 11, color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>{c.meta}</span>
                          </span>
                        </label>
                      ))}
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", padding: "6px 8px",
                        borderRadius: 8, background: d.mode === "create" ? "var(--brand-soft)" : "transparent" }}>
                        <input type="radio" name={"conflict-" + r.id} checked={d.mode === "create"}
                          onChange={() => patch(r.id, { mode: "create" })} style={{ marginTop: 2 }} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 600 }}>这是另一家单位，新建主数据</span>
                          <span style={{ display: "block", fontSize: 11, color: "var(--ink-faint)" }}>必须补一个区分字段，否则无法与同名档案区分</span>
                          {d.mode === "create" && (
                            <input value={d.distinct || ""} onChange={(e) => patch(r.id, { distinct: e.target.value })}
                              placeholder="统一社会信用代码 或 联系电话"
                              style={{ marginTop: 6, width: "100%", maxWidth: 320, boxSizing: "border-box", border: "1px solid " + (String(d.distinct || "").trim() ? "var(--line-strong)" : "var(--danger)"),
                                borderRadius: 8, padding: "7px 10px", fontSize: 12.5, fontFamily: "var(--font-mono)", outline: "none" }} />
                          )}
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {/* 相似名：软提示，默认新建，不强制处理 */}
                {r.match === "similar" && (
                  <div style={{ margin: "0 14px 12px", border: "1px solid var(--warn)", background: "var(--warn-soft)", borderRadius: 10, padding: "9px 12px",
                    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--ink-soft)", flex: 1, minWidth: 220 }}>
                      与既有档案「{r.candidates[0].label}」高度相似（{r.candidates[0].meta}）。默认按新单位处理；若确为同一家请改为复用。
                    </span>
                    {Button ? (
                      <Button size="sm" variant={d.mode === "reuse" ? "primary" : "secondary"}
                        onClick={() => patch(r.id, d.mode === "reuse" ? { mode: null, reuseId: null } : { mode: "reuse", reuseId: r.candidates[0].id })}>
                        {d.mode === "reuse" ? "已改为复用" : "改为复用该档案"}
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </P>

        <P>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 260, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.75 }}>
              将新建分供方主数据 <b>{willCreateSupplier.length}</b> 家 · 复用既有档案 <b>{willReuse.length}</b> 家 ·
              建立合作关系 <b>{willCreateRelation.length}</b> 条 · 跳过已存在 <b>{dupRelations.length}</b> 条。
              <br />新建档案按<b style={{ color: "var(--ink)" }}>「最小档案 · 资料待补」</b>入库：只写名称与人工指定的类别，证照、账户、联系人留空，
              在主数据列表与详情页持续显示该标记，直到资料补齐 —— 不因导入过而被当成已核验档案。
              <br />新建关系初始状态为「收集资料中」，后续状态流转仍在工作台完成。
            </span>
            {Button ? <Button variant="ghost" onClick={() => navigate("projectSupplier")}>取消</Button> : null}
            {Button ? <Button variant="primary" disabled={blocked} onClick={submit}>确认生成</Button> : null}
          </div>
          {blocked && (
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>
              还有 {unresolved.length} 行同名冲突未判定或未补区分字段，「确认生成」不可用。
            </div>
          )}
        </P>
      </div>
    );
  }

  window.ProjectSupplierImportScreen = ProjectSupplierImportScreen;
})();
