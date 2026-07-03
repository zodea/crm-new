// KitAtoms — 全局展示原子库（反馈轮 9：通用组件先生成、后统一使用）
// 与 KitUI（交互原语）/ KitTable（表格原语）并列的第三块全局底座，经隐藏 x-import 预加载注册 window.KitAtoms。
// 收录此前散落在各页面的内联副本（STYLE-GUIDE §3 的标准形态）：
//   SelectFilter  下拉筛选（§3.6）      SegTab        下划线分段 tab（§3.5）
//   SearchInput   pill 搜索框            SectionHeader 品牌竖条区块标题（§3.2）
//   Metric/MetricGrid 指标格+语义固定列数网格（两位小数由调用方保证）
//   TreeNav       左树导航（发票台账/清单页同构）
// 约定：新页面一律从 window.KitAtoms 取用；旧页面逐步替换内联副本，勿再复制。
(function () {
  if (window.KitAtoms) { window.KitAtomsScreen = window.KitAtomsScreen || function () { return null; }; return; }
  const DS = () => window.DesignSystem_e3d871 || {};
  const h = React.createElement;

  // —— 下拉筛选：label + 原生 select + 自绘 chevron（options: [{key,label}]）——
  function SelectFilter({ label, options, value, onChange, minWidth = 132 }) {
    const { Icon } = DS();
    return h("label", { style: { display: "inline-flex", alignItems: "center", gap: 7 } },
      label && h("span", { style: { fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", flex: "none" } }, label),
      h("span", { style: { position: "relative", display: "inline-flex" } },
        h("select", { value, onChange: (e) => onChange(e.target.value), style: {
          appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
          border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", background: "#fff",
          color: "var(--ink)", fontSize: 13, fontWeight: 600, padding: "7px 30px 7px 12px", cursor: "pointer", minWidth,
        } }, options.map((o) => h("option", { key: o.key, value: o.key }, o.label))),
        Icon && h("span", { style: { position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", display: "flex" } },
          h(Icon, { name: "chevron-down", size: 14, color: "var(--ink-faint)" }))
      )
    );
  }

  // —— 下划线分段 tab（tabs: [{key,label,count?}]）——
  function SegTab({ tabs, active, onChange }) {
    return h("div", { style: { display: "flex", flexWrap: "wrap", gap: 2, borderBottom: "1px solid var(--line)" } },
      ...tabs.map((t) => {
        const on = active === t.key;
        return h("button", { key: t.key, onClick: () => onChange(t.key), style: {
          border: 0, background: "transparent", cursor: "pointer", padding: "9px 14px", marginBottom: -1,
          fontSize: 13, fontWeight: on ? 700 : 500, color: on ? "var(--brand-deep)" : "var(--ink-soft)",
          borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent", whiteSpace: "nowrap",
          display: "inline-flex", alignItems: "center", gap: 6,
        } },
          t.label,
          t.count != null && h("span", { style: { fontSize: 11, fontFamily: "var(--font-mono)", padding: "1px 6px", borderRadius: 999, background: on ? "var(--brand-soft)" : "var(--surface-3)", color: on ? "var(--brand-deep)" : "var(--ink-soft)" } }, t.count));
      })
    );
  }

  // —— pill 搜索框 ——
  function SearchInput({ value, onChange, placeholder, width = 210 }) {
    const { Icon } = DS();
    return h("div", { style: { position: "relative" } },
      Icon && h("span", { style: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", display: "flex" } }, h(Icon, { name: "search", size: 14, color: "var(--ink-faint)" })),
      h("input", { placeholder, value: value == null ? "" : value, onChange: (e) => onChange(e.target.value),
        style: { width, border: "1px solid var(--line-strong)", borderRadius: 999, padding: "8px 14px 8px 32px", fontSize: 13, background: "#fff", outline: "none" } })
    );
  }

  // —— 区块标题：4×16 品牌竖条 + 标题 + 右侧扩展 ——
  function SectionHeader({ children, extra, mb = 12 }) {
    return h("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: mb } },
      h("span", { style: { width: 4, height: 16, borderRadius: 2, background: "var(--brand)", flex: "none" } }),
      h("span", { style: { fontSize: 15, fontWeight: 800 } }, children),
      extra && h("span", { style: { marginLeft: "auto" } }, extra)
    );
  }

  // —— 指标格（label+ⓘ公式+大数字；两位小数完整展示，禁省略号）——
  function Metric({ label, value, formula, tone, big }) {
    const { Icon } = DS();
    const color = tone === "ok" ? "var(--ok-ink)" : tone === "danger" ? "var(--danger-ink)" : tone === "brand" ? "var(--brand)" : "var(--ink)";
    return h("div", { style: { padding: "12px 14px", minWidth: 0 } },
      h("div", { style: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--ink-faint)", fontWeight: 600 } },
        h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, label),
        formula && Icon && h("span", { title: formula, style: { cursor: "help", display: "inline-flex" } }, h(Icon, { name: "info", size: 11, color: "var(--ink-faint)" }))),
      h("div", { title: typeof value === "string" ? value : undefined, style: { marginTop: 5, fontSize: big ? 17.5 : 13.5, fontWeight: big ? 800 : 700, fontFamily: "var(--font-mono)", color, lineHeight: 1.25, whiteSpace: "nowrap", letterSpacing: "-0.015em" } }, value)
    );
  }

  // —— 指标网格（语义固定列数，禁 auto-fit）——
  function MetricGrid({ children, cols = 5 }) {
    return h("div", { style: { display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" } },
      ...React.Children.map(children, (c) => h("div", { style: { background: "var(--panel)", minWidth: 0 } }, c)));
  }

  // —— 左树导航（items: [{key,label,icon,count,tone,children?:[{...}]}]；active/onChange）——
  function TreeNav({ title, items, active, onChange }) {
    const { Icon, Panel } = DS();
    const btn = (t, sub) => {
      const on = active === t.key;
      const ink = t.tone === "warn" && !on ? "var(--warn-ink)" : on ? "var(--brand-deep)" : "var(--ink)";
      return h("button", { key: t.key, onClick: () => onChange(t.key), style: { display: "flex", alignItems: "center", gap: 8, width: "100%", border: 0, borderRadius: 8, padding: sub ? "6px 10px" : "8px 10px", cursor: "pointer", textAlign: "left", background: on ? "var(--brand-soft)" : "transparent", marginBottom: 2 } },
        Icon && h(Icon, { name: t.icon || (sub ? "wrench" : "folder"), size: sub ? 12 : 14, color: on ? "var(--brand)" : (t.tone === "warn" ? "var(--warn)" : t.tone === "brand" ? "var(--brand)" : "var(--ink-faint)") }),
        h("span", { style: { flex: 1, fontSize: sub ? 12.5 : 13, fontWeight: on ? 800 : sub ? 500 : 600, color: ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.label),
        t.count != null && h("span", { style: { fontSize: 11, fontFamily: "var(--font-mono)", color: on ? "var(--brand)" : "var(--ink-faint)", background: on ? "#fff" : "var(--surface-3)", borderRadius: 999, padding: "1px 7px" } }, t.count));
    };
    return h(Panel || "div", { padding: 0, style: { overflow: "hidden" } },
      title && h("div", { style: { padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" } }, title),
      h("div", { style: { padding: 6 } },
        ...items.map((t) => h("div", { key: t.key },
          btn(t, false),
          t.children && h("div", { style: { paddingLeft: 14 } }, ...t.children.map((c) => btn(c, true)))))));
  }

  window.KitAtoms = { SelectFilter, SegTab, SearchInput, SectionHeader, Metric, MetricGrid, TreeNav };
  window.KitAtomsScreen = function () { return null; };
})();
