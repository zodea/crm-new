// ProjectArchiveExport — 项目完整档案包导出·多选树（issue #248 设计稿侧）
// 树结构照统一目录合同：00 档案说明与清单 / 01 项目信息与工程档案(七子目录) / 02 分供方(甲供材·乙供材两组)
//   / 03 班组与工人(班组→工人→子目录) / 99 待归类。
// 三态勾选(勾/半/不勾)父子联动；默认勾选「核心档案」= 00+01 全部 + 02/03 的非敏感子目录；99 默认不选。
// 敏感资料三原则(#248)：默认排除 → 显式勾选弹 danger 二次警示 → 开始导出前再次汇总警示并在清单留痕。
// 树层级演绎真实数据：window.APP 的 projects/suppliers/contracts/omTotals/workers + KIT_DATA.crews；
//   文件份数/容量为匿名虚构数(按节点 key 稳定散列生成，重复打开一致)。
// 宿主：ProjectDetailScreen 直接渲染 <window.ProjectArchiveExport proj meta onClose/>；
//   本组件自带全屏遮罩(z 2500，低于 KitUI 的 3000，保证 confirm/exportModal 叠在其上)。
(function () {
  if (window.ProjectArchiveExport) { window.ProjectArchiveExportPreload = window.ProjectArchiveExportPreload || function () { return null; }; return; }
  // 预加载占位组件：app.dc.html 预加载区挂它以触发本文件加载（同 EntityListPreload 模式）
  window.ProjectArchiveExportPreload = function () { return null; };

  const DS = () => window.DesignSystem_e3d871 || {};
  const UI = () => window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm(), exportModal: () => {}, modal: () => {} };

  // —— 稳定散列 → 匿名虚构文件数/容量（同一目录每次打开份数一致，演示「稳定排序/稳定结构」）——
  const h32 = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  const nf = (key, min, span) => min + (h32(key) % Math.max(1, span));            // 文件数
  const mb = (key, files) => files === 0 ? 0 : Math.round(files * (5 + (h32(key + "sz") % 14))) / 10;  // 容量 MB(每份约 0.5~1.8MB)

  // —— 阶段子目录(与 ProjectDetailScreen 的 PHASES 同名同序；档案导出读真实阶段任务，不硬编码份数)——
  // taskTotal 用于展示「应归档任务数」；实际份数 = meta.phaseDone(已上传任务数)，缺口在树上以 0/暂无资料呈现。
  const STAGE_DIRS = [
    { dir: "02_项目立项", phase: "项目立项", taskTotal: 1 },
    { dir: "03_施工准备", phase: "施工准备", taskTotal: 5 },
    { dir: "04_施工中", phase: "施工中", taskTotal: 3 },
    { dir: "05_完工及验收", phase: "完工及验收", taskTotal: 1 },
    { dir: "06_交付", phase: "交付", taskTotal: 5 },
    { dir: "07_保修", phase: "保修", taskTotal: 0 },   // 保修任务动态生成
  ];

  // —— 叶子/分组节点构造 ——
  const L = (key, label, files, opts) => Object.assign({ key, label, files, size: mb(key, files) }, opts || {});
  const G = (key, label, icon, children, opts) => Object.assign({ key, label, icon, children }, opts || {});

  // —— 按统一目录合同构建整棵树（proj: APP 项目行；meta: ProjectDetailScreen 的 META 合成对象，可缺省）——
  function buildTree(proj, meta) {
    const A = window.APP;
    const rows = (c) => (A ? A.rows(c) : (window.KIT_DATA && window.KIT_DATA[c]) || []);
    const phaseDone = (meta && meta.phaseDone) || [];

    // 00 档案说明与清单：三份固定文件（导出器生成，树上可整组反选）
    const n00 = G("00", "00_档案说明与清单", "list-checks", [
      L("00/1", "项目档案目录.xlsx", 1), L("00/2", "文件清单.xlsx", 1), L("00/3", "导出说明.txt", 1),
    ]);

    // 01 项目信息与工程档案：基本信息 + 七阶段子目录(份数=该阶段已上传任务数，缺失=0 → 暂无资料)
    const n01 = G("01", "01_项目信息与工程档案", "building-2",
      [L("01/00", "01_项目基本信息", 4)].concat(STAGE_DIRS.map((s, i) =>
        L("01/" + s.dir, s.dir, phaseDone[i] != null ? phaseDone[i] : nf("01/" + s.dir + proj.id, 0, 3),
          { taskTotal: s.taskTotal }))));

    // 02 分供方：01_甲供材(供货单位) / 02_乙供材(来源=本项目 分包+材采 合同的乙方)
    // 甲供材供货单位：数据仓暂无独立供货商实体（omTotals.party 是甲方），按 #248 2026-08-01 裁定
    // 先以固定虚构供货商名对齐演示世界观；正式建模后把这里换成真实供货商数据源即可。
    const OM_SUPPLIERS = ["广州粤建钢材贸易有限公司", "广州珠联水泥制品有限公司"];
    const jgParties = []; const seenP = {};
    rows("omTotals").forEach((o) => {
      if (o.projectId === proj.id && o.party && !seenP[o.party]) {
        seenP[o.party] = 1;
        jgParties.push(OM_SUPPLIERS[jgParties.length % OM_SUPPLIERS.length]);
      }
    });
    const nJg = G("02/jg", "01_甲供材", "package", jgParties.map((p) => {
      const k = "02/jg/" + p;
      return G(k, p, "truck", [
        L(k + "/01", "01_报审表与品牌", nf(k + "a", 1, 4)), L(k + "/02", "02_物料表与清单", nf(k + "b", 1, 3)),
        L(k + "/03", "03_收货照片", nf(k + "c", 2, 6)), L(k + "/04", "04_送货单", nf(k + "d", 1, 5)),
      ]);
    }), jgParties.length ? null : { empty: true });

    const ybMap = {};   // supplierId → { sup, contracts: n }
    rows("contracts").forEach((c) => {
      if (c.projectId !== proj.id || (c.kind !== "分包" && c.kind !== "材采") || !c.supplierId) return;
      if (!ybMap[c.supplierId]) ybMap[c.supplierId] = { sup: A ? A.get("suppliers", c.supplierId) : null, n: 0 };
      ybMap[c.supplierId].n += 1;
    });
    const nYb = G("02/yb", "02_乙供材", "factory", Object.keys(ybMap).map((sid) => {
      const it = ybMap[sid]; const name = it.sup ? it.sup.name : sid; const k = "02/yb/" + sid;
      return G(k, name, "building", [
        L(k + "/01", "01_公司信息", nf(k + "a", 1, 3)), L(k + "/02", "02_合同", it.n),
        L(k + "/03", "03_付款申请及发票", nf(k + "c", 0, 5)), L(k + "/04", "04_付款回执", nf(k + "d", 0, 4)),
        L(k + "/05", "05_结算", nf(k + "e", 0, 3)),
      ]);
    }), Object.keys(ybMap).length ? null : { empty: true });
    const n02 = G("02", "02_分供方", "handshake", [nJg, nYb]);

    // 03 班组与工人：本项目在册工人按 team 归组；班组实体名对齐 KIT_DATA.crews；
    //   工人子目录 03_敏感原件(身份证/银行卡/证照原件) 标记 sensitive → 默认排除 + 显式勾选二次警示。
    const crews = rows("crews");
    const teamMap = {};
    rows("workers").forEach((w) => {
      if (w.project !== proj.name) return;
      (teamMap[w.team] = teamMap[w.team] || []).push(w);
    });
    const n03 = G("03", "03_班组与工人", "hard-hat", Object.keys(teamMap).map((team) => {
      const crew = crews.find((c) => c.name === team);
      const k = "03/" + (crew ? crew.id : team);
      return G(k, team + (crew && crew.trade ? "（" + crew.trade + "）" : ""), "users",
        [L(k + "/00", "00_班组汇总", 2, { hint: "脱敏花名册·已审核工资汇总" })].concat(teamMap[team].map((w) => {
          const wk = k + "/" + w.id;
          return G(wk, w.name + "_" + String(w.id).toUpperCase(), "user", [
            L(wk + "/01", "01_基础档案", 2),
            L(wk + "/02", "02_工资资料", nf(wk + "b", 1, 3)),
            L(wk + "/03", "03_敏感原件", 3, { sensitive: true, hint: "身份证·银行卡·证照原件" }),
          ]);
        })));
    }), Object.keys(teamMap).length ? null : { empty: true });

    // 99 待归类：只接纳无法确定业务归属的文件，清单标注原因；不属于核心档案 → 默认不选
    const n99 = G("99", "99_待归类", "inbox", [L("99/1", "无法确定归属的文件", nf("99" + proj.id, 0, 3), { hint: "清单中逐条标注待归类原因" })]);

    return [n00, n01, n02, n03, n99];
  }

  // —— 树遍历工具 ——
  const leavesOf = (node, acc) => {
    acc = acc || [];
    if (node.children) node.children.forEach((c) => leavesOf(c, acc)); else acc.push(node);
    return acc;
  };
  const walkGroups = (nodes, fn) => nodes.forEach((n) => { if (n.children) { fn(n); walkGroups(n.children, fn); } });

  // —— 三态复选框（勾/半/不勾）——
  function TriBox({ st, disabled, onClick, label }) {
    const on = st === "on", part = st === "part";
    return (
      <button type="button" role="checkbox" aria-checked={part ? "mixed" : on} aria-label={label} disabled={disabled}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        style={{ width: 17, height: 17, flex: "none", borderRadius: 4, cursor: disabled ? "default" : "pointer", display: "grid", placeItems: "center", padding: 0,
          border: "1.5px solid " + (on || part ? "var(--brand)" : "var(--line-strong)"),
          background: on ? "var(--brand)" : part ? "var(--brand-soft)" : "#fff", opacity: disabled ? 0.4 : 1 }}>
        {on && <span style={{ color: "#fff", fontSize: 11, fontWeight: 800, lineHeight: 1 }}>✓</span>}
        {part && <span style={{ width: 8, height: 2.5, borderRadius: 2, background: "var(--brand)" }} />}
      </button>
    );
  }

  // —— 主组件：props = { proj, meta, onClose } ——
  function ProjectArchiveExport({ proj, meta, onClose }) {
    const { Button, IconButton, Icon, StatusChip } = DS();
    const A = window.APP;
    if (A) A.use();

    const tree = React.useMemo(() => buildTree(proj, meta), [proj && proj.id]);
    const allLeaves = React.useMemo(() => { const acc = []; tree.forEach((n) => leavesOf(n, acc)); return acc; }, [tree]);

    // 默认「核心档案」：非敏感 + 非 99_待归类 全选；敏感/待归类默认排除
    const coreDefault = React.useCallback(() => {
      const m = {};
      allLeaves.forEach((l) => { m[l.key] = !l.sensitive && l.key.indexOf("99") !== 0; });
      return m;
    }, [allLeaves]);
    const [checked, setChecked] = React.useState(coreDefault);

    // 展开态：默认展开五个顶层组 + 02 的两个类型组；搜索时全展开
    const [expanded, setExpanded] = React.useState(() => ({ "00": 1, "01": 1, "02": 1, "02/jg": 1, "02/yb": 1, "03": 1, "99": 1 }));
    const [q, setQ] = React.useState("");
    const ql = q.trim().toLowerCase();

    // Esc 关闭 + 锁定背景滚动
    React.useEffect(() => {
      const onKey = (e) => { if (e.key === "Escape") onClose(); };
      document.addEventListener("keydown", onKey);
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
    }, [onClose]);

    // 窄屏(<760px 视口)整屏铺开；宽屏为 ≥720px 大弹层
    const [vw, setVw] = React.useState(window.innerWidth);
    React.useEffect(() => {
      const onR = () => setVw(window.innerWidth);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }, []);
    const narrow = vw < 760;

    // —— 三态推导：叶=checked；组=全选 on / 全不选 off / 其余 part ——
    const stateOf = (node) => {
      if (!node.children) return checked[node.key] ? "on" : "off";
      const ls = leavesOf(node);
      if (!ls.length) return "off";
      const onN = ls.reduce((s, l) => s + (checked[l.key] ? 1 : 0), 0);
      return onN === 0 ? "off" : onN === ls.length ? "on" : "part";
    };
    // 组内是否已勾选敏感后代（节点与祖先显示敏感标识，#248 敏感留痕规则①）
    const hasSensOn = (node) => leavesOf(node).some((l) => l.sensitive && checked[l.key]);

    // 敏感叶显式勾选 → danger 二次警示（三原则第 2/3 条）
    const askSensitive = (leaf) => UI().confirm({
      title: "勾选敏感目录？", danger: true, confirmText: "确认勾选",
      message: "「" + leaf.label + "」包含 <b>" + leaf.files + " 个敏感文件</b>（" + (leaf.hint || "身份证、银行卡、证照原件") + "）。<br/>" +
        "敏感资料默认排除在核心档案外；确认勾选后：<br/>① 该节点与祖先显示敏感标识；② 开始导出前将再次汇总警示；③ 导出清单记录「包含敏感资料」。",
      onConfirm: () => { setChecked((m) => Object.assign({}, m, { [leaf.key]: true })); UI().toast("已显式勾选敏感目录，导出前将再次警示", "warn"); },
    });

    // 勾选联动：勾父级只带非敏感后代（敏感不随父勾选，需逐项显式勾选）；取消父级则连敏感一并取消
    const toggle = (node) => {
      const st = stateOf(node);
      const want = st !== "on";
      if (!node.children) {
        if (want && node.sensitive) return askSensitive(node);
        setChecked((m) => Object.assign({}, m, { [node.key]: want }));
        return;
      }
      const ls = leavesOf(node);
      setChecked((m) => {
        const n = Object.assign({}, m);
        let skipped = 0;
        ls.forEach((l) => {
          if (want && l.sensitive) { if (!n[l.key]) skipped += 1; return; }   // 敏感叶保持原状，不随父勾选
          n[l.key] = want;
        });
        if (want && skipped > 0) UI().toast("敏感目录不随父级勾选（共跳过 " + skipped + " 处），需逐项显式勾选", "warn");
        return n;
      });
    };

    // —— 底部实时统计（演示数据）——
    const stat = React.useMemo(() => {
      let dirs = 0, files = 0, sens = 0, sensDirs = 0, size = 0;
      allLeaves.forEach((l) => {
        if (!checked[l.key]) return;
        dirs += 1; files += l.files; size += l.size || 0;
        if (l.sensitive) { sens += l.files; sensDirs += 1; }
      });
      return { dirs, files, sens, sensDirs, size: Math.round(size * 10) / 10 };
    }, [checked, allLeaves]);

    // —— 开始导出：敏感汇总二次警示 → KitUI.exportModal(写盘进度) → 「写盘 ≠ 业务完成」提示 ——
    const startExport = () => {
      if (!stat.dirs) { UI().toast("尚未勾选任何目录", "warn"); return; }
      const run = () => UI().exportModal({
        title: "导出项目档案包", goText: "开始导出",
        subtitle: proj.name + " · 统一目录合同 · " + stat.dirs + " 个目录 / 约 " + stat.size + " MB" + (stat.sens ? " · 含敏感 " + stat.sens + " 件" : ""),
        count: stat.files, unit: "个文件", ext: ".zip",
        structureOptions: ["统一目录合同（固定结构）"],
        nameOptions: [
          { label: "项目名称_项目编号_导出日期", sample: proj.name + "_" + String(proj.id || "P").toUpperCase() + "_2026-08-01" },
          { label: "项目档案包", sample: "项目档案包" },
        ],
        onDone: () => {
          // 写盘 ≠ 业务完成：ZIP 落盘只是导出动作完成，档案是否齐套要回看清单缺失/异常标注
          UI().toast("写盘完成 ≠ 业务完成：请按「00_档案说明与清单」核对缺失与敏感留痕", "warn");
          onClose();
        },
      });
      if (stat.sens > 0) {
        UI().confirm({
          title: "导出包含敏感资料", danger: true, confirmText: "仍要导出",
          message: "本次导出包含 <b>" + stat.sensDirs + " 个敏感目录 / " + stat.sens + " 个敏感文件</b>（身份证、银行卡、证照原件）。<br/>" +
            "导出清单将记录「包含敏感资料」；敏感资料不混入核心档案默认模板。确认继续？",
          onConfirm: run,
        });
      } else run();
    };

    // —— 搜索命中：节点自身或后代命中即可见；命中时按路径自动展开 ——
    const hit = (node) => {
      if (!ql) return true;
      if (node.label.toLowerCase().indexOf(ql) > -1) return true;
      return !!(node.children && node.children.some(hit));
    };

    // —— 单行渲染（递归）——
    const renderNode = (node, depth) => {
      if (!hit(node)) return null;
      const isGroup = !!node.children;
      const open = ql ? true : !!expanded[node.key];
      const st = stateOf(node);
      const sensOn = isGroup ? hasSensOn(node) : (node.sensitive && checked[node.key]);
      const rowKids = isGroup && open
        ? (node.children.length
          ? node.children.map((c) => renderNode(c, depth + 1))
          : [<div key="empty" style={{ padding: "6px 10px 6px " + (34 + (depth + 1) * 18) + "px", fontSize: 12, color: "var(--ink-faint)" }}>暂无资料</div>])
        : null;
      return (
        <React.Fragment key={node.key}>
          <div onClick={() => (isGroup ? setExpanded((m) => Object.assign({}, m, { [node.key]: open ? 0 : 1 })) : toggle(node))}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", paddingLeft: 10 + depth * 18,
              borderRadius: 8, cursor: "pointer", minWidth: 0,
              background: st !== "off" && !isGroup ? "var(--brand-soft)" : "transparent" }}
            onMouseEnter={(e) => { if (isGroup || st === "off") e.currentTarget.style.background = "var(--surface-3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = st !== "off" && !isGroup ? "var(--brand-soft)" : "transparent"; }}>
            {isGroup
              ? <Icon name={open ? "chevron-down" : "chevron-right"} size={13} color="var(--ink-faint)" />
              : <span style={{ width: 13, flex: "none" }} />}
            <TriBox st={st} label={"勾选 " + node.label} disabled={isGroup && !node.children.length} onClick={() => toggle(node)} />
            {node.icon && <Icon name={node.icon} size={14} color={depth === 0 ? "var(--brand)" : "var(--ink-soft)"} />}
            {!node.icon && !isGroup && <Icon name={node.sensitive ? "shield-alert" : "folder"} size={14} color={node.sensitive ? "var(--danger)" : "var(--ink-faint)"} />}
            <span style={{ fontSize: depth === 0 ? 13 : 12.5, fontWeight: depth === 0 ? 800 : isGroup ? 700 : 500,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{node.label}</span>
            {node.sensitive && <StatusChip tone="danger">敏感</StatusChip>}
            {sensOn && isGroup && (
              <span title="该分支已显式勾选敏感目录" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, color: "var(--danger-ink)", background: "var(--danger-soft)", borderRadius: 999, padding: "1px 7px", flex: "none" }}>
                <Icon name="shield-alert" size={10} color="var(--danger-ink)" />含敏感已选
              </span>
            )}
            {node.hint && <span style={{ fontSize: 10.5, color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.hint}</span>}
            <span style={{ marginLeft: "auto", flex: "none", fontSize: 11, fontFamily: "var(--font-mono)" }}>
              {!isGroup && (node.files === 0
                ? <span style={{ color: "var(--warn-ink)" }}>暂无资料</span>
                : <span style={{ color: "var(--ink-soft)" }}>{node.files} 个文件</span>)}
              {isGroup && node.children.length > 0 && <span style={{ color: "var(--ink-faint)" }}>{leavesOf(node).reduce((s, l) => s + (checked[l.key] ? l.files : 0), 0)}/{leavesOf(node).reduce((s, l) => s + l.files, 0)}</span>}
            </span>
          </div>
          {rowKids}
        </React.Fragment>
      );
    };

    const setAllExpanded = (open) => {
      const m = {};
      walkGroups(tree, (g) => { m[g.key] = open ? 1 : 0; });
      setExpanded(m);
    };

    // —— 布局：遮罩 + 面板（宽屏 min(940px,96vw)；窄屏全屏）——
    const panelStyle = narrow
      ? { position: "fixed", inset: 0, borderRadius: 0, width: "auto", height: "100%" }
      : { width: "min(940px, 96vw)", maxHeight: "88vh", borderRadius: 14 };
    return (
      <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: narrow ? 0 : 24 }}>
        <div onClick={(e) => e.stopPropagation()} style={Object.assign({ background: "var(--panel)", boxShadow: "var(--shadow-pop)", display: "flex", flexDirection: "column", overflow: "hidden" }, panelStyle)}>
          {/* 头部：标题 + 项目 + 关闭 */}
          <header style={{ flex: "none", padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="archive" size={17} color="var(--brand)" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>导出项目档案包 · 选择范围</div>
              <div style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {proj.name} · 目录照「统一目录合同」生成 · 默认勾选核心档案（敏感资料默认排除）
              </div>
            </div>
            <IconButton icon="x" title="关闭（Esc）" onClick={onClose} />
          </header>

          {/* 工具行：搜索 + 展开/收起 + 恢复默认/全不选 */}
          <div style={{ flex: "none", padding: "10px 18px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索目录 / 分供方 / 班组 / 工人"
                style={{ width: narrow ? 200 : 250, border: "1px solid var(--line-strong)", borderRadius: 999, padding: "6px 12px 6px 28px", fontSize: 12.5, background: "#fff", outline: "none" }} />
              <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", display: "inline-flex" }}><Icon name="search" size={13} color="var(--ink-faint)" /></span>
            </div>
            <Button size="sm" icon="chevrons-down" onClick={() => setAllExpanded(true)}>展开全部</Button>
            <Button size="sm" icon="chevrons-up" onClick={() => setAllExpanded(false)}>收起</Button>
            <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
              <Button size="sm" icon="rotate-ccw" onClick={() => { setChecked(coreDefault()); UI().toast("已恢复核心档案默认勾选", "ok"); }}>恢复核心默认</Button>
              <Button size="sm" onClick={() => { const m = {}; allLeaves.forEach((l) => { m[l.key] = false; }); setChecked(m); }}>全不选</Button>
            </span>
          </div>

          {/* 树主体（独立滚动；窄屏树区自身横向滚动，不引起页面级横滚） */}
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto", padding: "8px 12px" }}>
            <div style={{ minWidth: 560 }}>
              {tree.map((n) => renderNode(n, 0))}
              {ql && !tree.some(hit) && <div style={{ padding: "28px 0", textAlign: "center", fontSize: 12.5, color: "var(--ink-faint)" }}>没有匹配「{q}」的目录</div>}
            </div>
          </div>

          {/* 敏感三原则说明（常显，不随滚动走） */}
          <div style={{ flex: "none", padding: "8px 18px", borderTop: "1px solid var(--line)", background: "var(--surface-2)", display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-soft)", flexWrap: "wrap" }}>
            <Icon name="shield-alert" size={12} color="var(--danger)" />
            <span>敏感资料（身份证、银行卡、证照原件）三原则：<b>默认排除 · 显式勾选 · 二次警示</b>；勾选后导出清单将记录「包含敏感资料」。</span>
          </div>

          {/* 底栏：实时统计 + 操作 */}
          <footer style={{ flex: "none", padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontFamily: "var(--font-mono)", fontWeight: 700 }}>
              已选 <span style={{ color: "var(--brand)" }}>{stat.dirs}</span> 个目录
              <span style={{ color: "var(--ink-faint)", fontWeight: 600 }}> · </span>预计 <span style={{ color: "var(--brand)" }}>{stat.files}</span> 个文件
              <span style={{ color: "var(--ink-faint)", fontWeight: 600 }}> · </span>约 {stat.size} MB
            </span>
            {stat.sens > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: "var(--danger-ink)", background: "var(--danger-soft)", borderRadius: 999, padding: "2px 9px" }}>
                <Icon name="shield-alert" size={11} color="var(--danger-ink)" />含敏感 {stat.sens} 件
              </span>
            )}
            <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
              <Button onClick={onClose}>取消</Button>
              <Button variant="primary" icon="download" onClick={startExport}>开始导出</Button>
            </span>
          </footer>
        </div>
      </div>
    );
  }

  window.ProjectArchiveExport = ProjectArchiveExport;
})();
