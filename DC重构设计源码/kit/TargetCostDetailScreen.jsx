// TargetCostDetailScreen — 批C 重点页：目标成本详情 = 多级清单树表（红圈04 详情）。
// 树数据 KIT_DATA.targetCostTrees[costId]：叶子 {no,name,unit,q,p,a,sq,sa,ra,pa,leaf}，分类 {no,name,children}。
// 交互（验收线：真能用，不是摆样子）：序号级别筛选（一级/二级/全部）+ 单节点展开收起 + 展开/收起全部；
//   分类行=小计（聚合现算，底色加粗）；多级列组双行表头（目标成本 预算量/单价/合价 · 合同已签 数量/合价 · 实际成本 · 实际支付 · 执行偏差）；
//   单价只在叶子行；横滚只发生在表格容器内；金额两位小数。
(function () {
  if (window.TargetCostDetailScreen) return;
  const UI = () => window.KitUI || { toast: () => {}, importModal: () => {} };
  const yuan = (v) => (v == null ? "—" : "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const num = (v) => (v == null ? "—" : Number(v).toLocaleString("zh-CN", { maximumFractionDigits: 2 }));

  // 聚合：分类行金额 = 叶子后代求和（现算，树很小无需缓存）
  const agg = (node) => {
    if (node.leaf) return { a: node.a || 0, sa: node.sa || 0, ra: node.ra || 0, pa: node.pa || 0 };
    return (node.children || []).reduce((s, c) => {
      const x = agg(c);
      return { a: s.a + x.a, sa: s.sa + x.sa, ra: s.ra + x.ra, pa: s.pa + x.pa };
    }, { a: 0, sa: 0, ra: 0, pa: 0 });
  };
  const walkAll = (nodes, depth, out) => {
    (nodes || []).forEach((n) => { out.push({ n, depth }); if (!n.leaf) walkAll(n.children, depth + 1, out); });
    return out;
  };

  function TargetCostDetailScreen({ params }) {
    const A = window.APP;
    const KA = window.KitAtoms || {};
    const { Panel, Icon, Button } = window.DesignSystem_e3d871 || {};
    if (!A || !window.DetailShell || !Panel || !KA.SegTab) return null;
    A.use();
    const tc = A.get("targetCosts", params && params.id);
    const tree = ((window.KIT_DATA || {}).targetCostTrees || {})[params && params.id] || [];

    // 展开态：Set<no>；级别筛选=把「深度 < k 的分类」全展开、其余收起（k=99 即全部层级）
    const allCats = React.useMemo(() => walkAll(tree, 1, []).filter((x) => !x.n.leaf), [tree]);
    const expandTo = (k) => new Set(allCats.filter((x) => x.depth < k).map((x) => x.n.no));
    const [lvl, setLvl] = React.useState("2");
    const [expanded, setExpanded] = React.useState(() => expandTo(2));
    const setLevel = (k) => { setLvl(k); setExpanded(expandTo(k === "all" ? 99 : Number(k) )); };
    const toggle = (no) => setExpanded((s) => { const n = new Set(s); if (n.has(no)) n.delete(no); else n.add(no); return n; });

    if (!tc) return <Panel padding={24} style={{ color: "var(--ink-soft)" }}>未找到该目标成本（可能已被删除）。</Panel>;
    const total = tree.reduce((s, n) => { const x = agg(n); return { a: s.a + x.a, sa: s.sa + x.sa, ra: s.ra + x.ra, pa: s.pa + x.pa }; }, { a: 0, sa: 0, ra: 0, pa: 0 });

    // 可见行：按展开态深度优先展开
    const rows = [];
    const walk = (nodes, depth) => (nodes || []).forEach((n) => {
      rows.push({ n, depth });
      if (!n.leaf && expanded.has(n.no)) walk(n.children, depth + 1);
    });
    walk(tree, 1);

    const TH = { padding: "9px 12px", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", whiteSpace: "nowrap", background: "var(--surface-2)", border: "1px solid var(--line)", textAlign: "center" };
    const TD = { padding: "9px 12px", fontSize: 12.5, whiteSpace: "nowrap", borderBottom: "1px solid var(--line)", verticalAlign: "middle" };
    const money = (v, bold) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: bold ? 700 : 600 }}>{yuan(v)}</span>;

    const bodyRow = ({ n, depth }, i) => {
      const isCat = !n.leaf;
      const x = isCat ? agg(n) : { a: n.a, sa: n.sa, ra: n.ra, pa: n.pa };
      const dev = Math.round(((x.a || 0) - (x.ra || 0)) * 100) / 100;   // 执行偏差 = 预算合价 − 实际成本
      return (
        <tr key={n.no + "-" + i} style={{ background: isCat ? "var(--surface-2)" : "transparent" }}>
          <td style={{ ...TD, fontFamily: "var(--font-mono)", color: "var(--ink-soft)", width: 76 }}>{n.no}</td>
          <td style={{ ...TD, minWidth: 240 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, paddingLeft: (depth - 1) * 18 }}>
              {isCat ? (
                <button type="button" onClick={() => toggle(n.no)} title={expanded.has(n.no) ? "收起" : "展开"}
                  style={{ display: "grid", placeItems: "center", width: 18, height: 18, border: "1px solid var(--line-strong)", borderRadius: 4, background: "#fff", cursor: "pointer", padding: 0, flex: "none" }}>
                  {Icon && <Icon name={expanded.has(n.no) ? "chevron-down" : "chevron-right"} size={12} color="var(--ink-soft)" />}
                </button>
              ) : (
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--brand)", flex: "none", marginLeft: 6, marginRight: 7 }} />
              )}
              <span style={{ fontWeight: isCat ? 800 : 500 }}>{n.name}{isCat ? "（小计）" : ""}</span>
            </span>
          </td>
          <td style={{ ...TD, textAlign: "center", width: 56, color: "var(--ink-soft)" }}>{n.leaf ? n.unit : "—"}</td>
          <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{n.leaf ? num(n.q) : "—"}</td>
          <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{n.leaf ? yuan(n.p) : "—"}</td>
          <td style={{ ...TD, textAlign: "right" }}>{money(x.a, isCat)}</td>
          <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{n.leaf ? num(n.sq) : "—"}</td>
          <td style={{ ...TD, textAlign: "right" }}>{money(x.sa, isCat)}</td>
          <td style={{ ...TD, textAlign: "right" }}>{money(x.ra, isCat)}</td>
          <td style={{ ...TD, textAlign: "right" }}>{money(x.pa, isCat)}</td>
          <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: dev >= 0 ? "var(--ok-ink)" : "var(--danger-ink)" }}>
            {dev >= 0 ? "省 " : "超 "}{yuan(Math.abs(dev))}
          </td>
        </tr>
      );
    };

    return (
      <window.DetailShell
        title={tc.name} code={"目标成本 · " + ((A.get("projects", tc.projectId) || {}).name || "")}
        chips={<KA.EntityLink type="project" id={tc.projectId} />}
        headerExtra={Button && <Button size="sm" icon="upload" onClick={() => UI().importModal({
          title: "导入目标成本清单", subtitle: "Excel → 多级清单树（ADR 0005 字段映射）",
          targetFields: ["序号", "名称", "单位", "预算量", "预算单价"], sourceCols: ["序号", "名称", "单位", "工程量", "综合单价"],
          fileName: tc.name + "-清单.xlsx", rowCount: 128,
          onDone: (n2) => UI().toast("已导入 " + n2 + " 行清单（演示）", "ok"),
        })}>导入清单</Button>}
        metrics={[
          { label: "收入合同金额", value: yuan(tc.incomeAmount), formula: "本项目施工合同含税金额" },
          { label: "计划利润", value: yuan(tc.plannedProfit), formula: "收入合同金额 − 目标成本含税合价", tone: "ok" },
          { label: "目标成本 · 含税合价", value: yuan(tc.incTotal), formula: "Σ 清单叶子行 预算合价", tone: "brand", big: true },
          { label: "已签合同金额", value: yuan(tc.signedAmount), formula: "Σ 关联支出合同（已签）" },
          { label: "实际成本", value: yuan(total.ra), formula: "Σ 清单叶子行 实际成本" },
          { label: "实际支付", value: yuan(total.pa), formula: "Σ 清单叶子行 实际支付", tone: "danger" },
        ]}
        docs={[{ name: "目标成本编制说明.pdf", pages: 6 }]}
      >
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ padding: "10px 16px 0", display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <KA.SegTab tabs={[{ key: "1", label: "一级（分部）" }, { key: "2", label: "二级" }, { key: "all", label: "全部层级" }]}
                active={lvl} onChange={setLevel} />
            </div>
            <div style={{ display: "flex", gap: 8, padding: "0 0 8px", flex: "none" }}>
              <Button size="sm" icon="chevrons-down" onClick={() => setLevel("all")}>展开全部</Button>
              <Button size="sm" icon="chevrons-up" onClick={() => setLevel("1")}>收起全部</Button>
            </div>
          </div>
          {tree.length === 0 ? (
            <div style={{ padding: "48px 0", display: "grid", placeItems: "center", gap: 10, color: "var(--ink-faint)", fontSize: 13 }}>
              <span>该目标成本暂未导入清单明细</span>
              <span style={{ fontSize: 12 }}>点右上「导入清单」上传 Excel 拆入多级树（演示）</span>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 1280, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={TH} rowSpan={2}>序号</th>
                    <th style={{ ...TH, textAlign: "left" }} rowSpan={2}>清单名称</th>
                    <th style={TH} rowSpan={2}>单位</th>
                    <th style={{ ...TH, background: "var(--brand-soft)", color: "var(--brand-deep)" }} colSpan={3}>目标成本（预算）</th>
                    <th style={{ ...TH, background: "var(--ok-soft)", color: "var(--ok-ink)" }} colSpan={2}>合同已签</th>
                    <th style={TH} rowSpan={2}>实际成本</th>
                    <th style={TH} rowSpan={2}>实际支付</th>
                    <th style={TH} rowSpan={2}>执行偏差</th>
                  </tr>
                  <tr>
                    <th style={TH}>预算量</th><th style={TH}>单价</th><th style={TH}>合价</th>
                    <th style={TH}>数量</th><th style={TH}>合价</th>
                  </tr>
                </thead>
                <tbody>{rows.map(bodyRow)}</tbody>
                <tfoot>
                  <tr style={{ background: "var(--surface-3)" }}>
                    <td style={{ ...TD, fontWeight: 800 }} colSpan={5}>总计</td>
                    <td style={{ ...TD, textAlign: "right" }}>{money(total.a, true)}</td>
                    <td style={TD}></td>
                    <td style={{ ...TD, textAlign: "right" }}>{money(total.sa, true)}</td>
                    <td style={{ ...TD, textAlign: "right" }}>{money(total.ra, true)}</td>
                    <td style={{ ...TD, textAlign: "right" }}>{money(total.pa, true)}</td>
                    <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 800, color: total.a - total.ra >= 0 ? "var(--ok-ink)" : "var(--danger-ink)" }}>
                      {(total.a - total.ra >= 0 ? "省 " : "超 ") + yuan(Math.abs(total.a - total.ra))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <div style={{ padding: "9px 16px", borderTop: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, color: "var(--ink-soft)" }}>
            共 {rows.length} 行（分类小计随展开层级现算）· 单价双轨：预算单价=编制口径，合同单价见对应支出合同
          </div>
        </Panel>
      </window.DetailShell>
    );
  }

  window.TargetCostDetailScreen = TargetCostDetailScreen;
})();
