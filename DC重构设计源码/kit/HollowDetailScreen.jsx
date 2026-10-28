// HollowDetailScreen — 户级空鼓检查与整改详情（#412 P6，补齐 design-pending）。
// 路由：hollowDetail，params = { building, floor, unit, id, revisionId? }（与 quantityUnit 的 { building, floor, unit } 衔接，id = 空鼓记录）。
// 对应：/subcontract/quantity/:pid/:uid/hollow/:id → app/components/quantity/QuantityHollowDetailScreen.vue、
//       QuantityHollowRecordSummary / QuantityHollowHistory / QuantityHollowRectification.vue；
//       规格 docs/rewrite/pages/subcontract-quantity.md「户级空鼓来源」、docs/guides/payroll-hollow.md。
// 口径：检查归原户、房间分项和原施工责任；修订另开整页并保留原检查历史；整改在原记录中追加本次已修复处数，
//       不得超过当前未整改余量，不删除原记录，也不在户页自动生成工资扣款或退款（扣款在具体工资单另行明确开始）。
// 本文件同时播种 window.HollowDemo（户详情空鼓分区 QuantityUnitScreen、表单 HollowFormScreen 共用）。演示数据为虚构样本。
(function () {
  if (window.HollowDetailScreen) return;

  // —— 空鼓演示仓：按「栋|层|户」惰性播种；写穿保留到刷新 ——
  window.HollowDemo = window.HollowDemo || (function () {
    // 原施工责任（与 QuantityUnitScreen 泥水工默认指派一致；04户为班组整包）
    const PARTY = {
      "01户": { kind: "worker", name: "虞建华" }, "02户": { kind: "worker", name: "匡志强" },
      "03户": { kind: "worker", name: "张建国" }, "04户": { kind: "crew", name: "泥水A班" },
    };
    // 可检查范围 = 户型模板中的「房间 × 分项」且原责任可证明
    const LINES = [["厨房", "墙砖铺贴"], ["卫生间", "墙砖铺贴"], ["客厅", "地砖铺贴"], ["主卧", "地砖铺贴"], ["卫生间", "地砖铺贴"]];
    const store = {};
    const kOf = (b, f, u) => [b, f, u].join("|");
    const idOf = (b, f, u, n) => "hollow-" + [b, f, u].join("-") + "-" + n;

    function seed(b, f, u) {
      const party = PARTY[u] || { kind: "crew", name: "泥水A班" };
      const targets = LINES.map(([room, item], i) => ({
        key: kOf(b, f, u) + "#" + i, room, item, unitName: u,
        locationLabel: [b, f, u, room, item].join(" / "), originalParty: party,
      }));
      // 原责任不能证明的范围不进入可选目标，单列诊断（不按同名人或相似位置补）
      const unavailable = [{ message: [b, f, u, "阳台", "墙砖铺贴"].join(" / ") + "：原责任范围不能证明，暂不能记录空鼓。" }];
      const records = [];
      if (u === "01户") records.push({
        id: idOf(b, f, u, 1), target: targets[1],
        revisions: [
          { revisionId: idOf(b, f, u, 1) + "-r0", inspectedOn: "2025-04-22", count: 21, reason: "", note: "卫生间墙面敲击检查，标记空鼓 21 处。", actor: "张工（质检）", createdAt: "2025-04-22 16:20" },
          { revisionId: idOf(b, f, u, 1) + "-r1", inspectedOn: "2025-04-22", count: 19, reason: "复核时发现 2 处为同一空鼓区域重复计数。", note: "按复核结果更正为 19 处。", actor: "张工（质检）", createdAt: "2025-04-23 09:05" },
        ],
        rectifications: [{ id: idOf(b, f, u, 1) + "-x0", rectifiedOn: "2025-05-06", count: 4, note: "切割重贴 4 处，现场复敲无空响。", actor: "李工（生产）", createdAt: "2025-05-06 17:40" }],
      });
      if (u === "02户") records.push({
        id: idOf(b, f, u, 1), target: targets[2],
        revisions: [{ revisionId: idOf(b, f, u, 1) + "-r0", inspectedOn: "2025-04-24", count: 0, reason: "", note: "客厅地砖全数敲击，未发现空鼓。", actor: "张工（质检）", createdAt: "2025-04-24 10:12" }],
        rectifications: [],
      });
      return { targets, records, unavailable, seq: records.length };
    }
    function forUnit(b, f, u) { const k = kOf(b, f, u); return (store[k] = store[k] || seed(b, f, u)); }
    // 派生：当前检查 = 最新修订处数；已整改 = 逐次销记合计；未整改 = 二者之差
    function view(rec) {
      const inspection = rec.revisions[rec.revisions.length - 1];
      const rectified = rec.rectifications.reduce((s, x) => s + x.count, 0);
      return { ...rec, inspection, rectified, remaining: inspection.count - rectified };
    }
    function find(b, f, u, id) { const r = forUnit(b, f, u).records.find((x) => x.id === id); return r ? view(r) : null; }
    const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");
    function create(b, f, u, v) {
      const slot = forUnit(b, f, u);
      const id = idOf(b, f, u, ++slot.seq);
      slot.records.push({ id, target: slot.targets.find((t) => t.key === v.targetKey),
        revisions: [{ revisionId: id + "-r0", inspectedOn: v.inspectedOn, count: v.count, reason: "", note: v.note, actor: "当前经办人", createdAt: stamp() }], rectifications: [] });
      return id;
    }
    function revise(b, f, u, id, v) {
      const r = forUnit(b, f, u).records.find((x) => x.id === id);
      r.revisions.push({ revisionId: id + "-r" + r.revisions.length, inspectedOn: v.inspectedOn, count: v.count, reason: v.reason, note: v.note, actor: "当前经办人", createdAt: stamp() });
    }
    function rectify(b, f, u, id, v) {
      const r = forUnit(b, f, u).records.find((x) => x.id === id);
      r.rectifications.push({ id: id + "-x" + r.rectifications.length, rectifiedOn: v.rectifiedOn, count: v.count, note: v.note, actor: "当前经办人", createdAt: stamp() });
    }
    return { forUnit, view, find, create, revise, rectify };
  })();

  function HollowDetailScreen({ data, navigate, params }) {
    const { Panel, Button, StatusChip, Field, StatCard } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const UI = window.KitUI || { toast: () => {}, confirm: (o) => o.onConfirm && o.onConfirm() };
    const P = Panel || "div";
    const H = window.HollowDemo;
    const p = params || {};
    const mx = (data && data.matrix) || { buildings: ["1栋"], floors: ["38F"], units: ["01户"] };
    const building = p.building || mx.buildings[0];
    const floor = p.floor || (mx.floors.includes("38F") ? "38F" : mx.floors[0]);
    const unit = p.unit || mx.units[0];
    const preview = p.previewState || "ready";
    const writable = preview !== "readonly";

    const [, bump] = React.useState(0);
    const [fields, setFields] = React.useState({ rectifiedOn: "", count: "", note: "" });
    const [errors, setErrors] = React.useState({});

    const unitSlot = H.forUnit(building, floor, unit);
    const recordId = p.id || (unitSlot.records[0] && unitSlot.records[0].id);
    const record = recordId ? H.find(building, floor, unit, recordId) : null;
    const revisionId = p.revisionId || null;
    const revisionUnavailable = !!revisionId && !(record && record.revisions.some((r) => r.revisionId === revisionId));
    const historical = !!revisionId && !!record && revisionId !== record.inspection.revisionId;
    const backToUnit = () => navigate("quantityUnit", { building, floor, unit });

    const header = (
      <P padding={16} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
          <button type="button" onClick={backToUnit} style={{ justifySelf: "start", border: 0, background: "transparent", padding: 0, color: "var(--brand-deep)", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>返回原户施工详情</button>
          <span style={{ fontSize: 18, fontWeight: 800 }}>空鼓检查与整改</span>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{building} · {floor} · {unit}</span>
        </div>
        <div style={{ marginLeft: "auto" }}>
          {Button && record && writable && !revisionUnavailable && preview === "ready"
            ? <Button variant="secondary" icon="square-pen" onClick={() => navigate("hollowForm", { building, floor, unit, id: record.id })}>修订检查记录</Button> : null}
        </div>
      </P>
    );

    if (preview === "loading" || preview === "error" || preview === "empty" || !record || revisionUnavailable) {
      const loading = preview === "loading";
      return (
        <div style={{ display: "grid", gap: 12, maxWidth: 1080, margin: "0 auto" }}>
          {header}
          {KA.StatePanel ? <KA.StatePanel state={loading ? "loading" : "error"}
            title={loading ? "正在核对原户空鼓记录" : revisionUnavailable ? "指定的原检查修订尚未获证明，不能以当前版本代替。" : "这份原户空鼓记录尚未获证明，请保留原引用重新核对。"}
            description={loading ? undefined : (unitSlot.unavailable[0] || {}).message}
            actionLabel={loading ? undefined : "重新读取原户"}
            onAction={() => navigate("hollowDetail", { ...p, revisionId: undefined, previewState: "ready" })} /> : null}
        </div>
      );
    }

    const party = record.target.originalParty;
    const zero = record.inspection.count === 0;
    const rectifyReasons = !writable ? ["当前身份没有空鼓来源写入权限"] : record.remaining > 0 ? [] : ["本次检查已全部整改，无可继续销记处数"];
    const canRectify = !rectifyReasons.length && !historical;
    const patch = (k, v) => { setFields((f) => ({ ...f, [k]: v })); setErrors({}); };

    const submit = () => {
      const n = Number(fields.count);
      const e = {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.rectifiedOn) || fields.rectifiedOn < record.inspection.inspectedOn) e.rectifiedOn = "整改日期须为真实日期，且不早于检查日";
      if (fields.count === "" || !Number.isInteger(n) || n < 1) e.count = "整改必须为正整数";
      else if (n > record.remaining) e.count = "整改数量超过未整改余量（当前 " + record.remaining + " 处）";
      if (Object.keys(e).length) { setErrors(e); return; }
      UI.confirm({
        title: "确认本次整改销记", confirmText: "确认整改销记",
        message: "原记录目前未整改 " + record.remaining + " 处，本次登记整改 " + n + " 处。保存后保留原检查和本次销记。",
        onConfirm: () => {
          H.rectify(building, floor, unit, record.id, { rectifiedOn: fields.rectifiedOn, count: n, note: fields.note });
          setFields({ rectifiedOn: "", count: "", note: "" });
          bump((x) => x + 1);
          UI.toast("整改销记已保存并核对。", "ok");
        },
      });
    };

    // 三项余量用设计系统 StatCard（未整改 > 0 用 warn，= 0 用 ok）
    const metric = (label, value, tone) => StatCard ? <StatCard label={label} value={value + " 处"} tone={tone || "default"} /> : null;
    const card = (active) => ({ display: "grid", gap: 6, border: "1px solid " + (active ? "var(--brand)" : "var(--line)"), background: active ? "var(--brand-soft)" : "transparent", borderRadius: 8, padding: 12, fontSize: 12, minWidth: 0 });
    const lbl = { display: "grid", gap: 6, minWidth: 0, fontSize: 12 };
    const err = (k) => errors[k] ? <span style={{ color: "var(--danger)", fontSize: 12 }}>{errors[k]}</span> : null;
    // 日期 / 数量输入统一用设计系统 Field；校验错误在其下方以文字列出
    const fld = (key, label, type, value, extra) => (
      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        {Field ? <Field label={label} value={value} onChange={(e) => patch(key, e.target.value)} mono
          inputProps={{ type, "aria-label": label, "aria-invalid": !!errors[key], "data-hollow-field": key, ...(extra || {}) }} /> : null}
        {err(key)}
      </div>
    );

    return (
      <div style={{ display: "grid", gap: 12, maxWidth: 1080, margin: "0 auto", minWidth: 0 }}>
        {header}
        {preview === "readonly" && <div role="status" style={{ fontSize: 12, color: "var(--ink-soft)" }}>当前身份只能阅读空鼓记录。</div>}
        {revisionId && <P padding={12}><span style={{ fontSize: 12, lineHeight: 1.7 }}>此页定位原检查版本。下方当前余量单独反映后来记录，不回填原工资冻结依据。</span></P>}

        {/* 当前原责任与余量 */}
        <P padding={16}>
          <div style={{ fontSize: 15, fontWeight: 700, overflowWrap: "anywhere" }}>{record.target.locationLabel}</div>
          <div style={{ marginTop: 6, fontSize: 12 }}>原{party.kind === "worker" ? "施工人" : "班组责任"}：{party.name}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
            {metric("当前检查", record.inspection.count)}
            {metric("已整改", record.rectified)}
            {metric("未整改", record.remaining, record.remaining ? "warn" : "ok")}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 12, lineHeight: 1.7, color: "var(--ink-soft)" }}>
            {zero ? "已明确检查为零处；原检查记录保留。" : record.remaining === 0 ? "已登记的空鼓全部整改；原检查及销记历史保留。" : "数量来自原检查与追加整改，工资是否扣款由经办人在对应工资单另行确认。"}
          </p>
        </P>

        {/* 检查与整改记录（修订历史 + 逐次销记） */}
        <P padding={16}>
          {KA.SectionHeader ? <KA.SectionHeader>检查与整改记录</KA.SectionHeader> : null}
          <div style={{ display: "grid", gap: 10 }}>
            {record.revisions.map((r, i) => (
              <article key={r.revisionId} tabIndex={-1} style={card(revisionId === r.revisionId)}>
                <div style={{ fontWeight: 700 }}>{i === 0 ? "原检查" : "检查修订 " + i} · {r.inspectedOn} · 发现 {r.count} 处</div>
                {r.reason ? <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>修订原因：{r.reason}</div> : null}
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{r.note || "检查说明未填写"}</div>
                <div style={{ color: "var(--ink-faint)" }}>经办 {r.actor} · {r.createdAt}</div>
              </article>
            ))}
          </div>
          <div aria-label="已登记整改" style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {!record.rectifications.length && <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>尚无整改销记。</div>}
            {record.rectifications.map((x) => (
              <article key={x.id} style={card(false)}>
                <div style={{ fontWeight: 700 }}>{x.rectifiedOn} · 本次整改 {x.count} 处</div>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{x.note || "整改说明未填写"}</div>
                <div style={{ color: "var(--ink-faint)" }}>经办 {x.actor} · {x.createdAt}</div>
              </article>
            ))}
          </div>
        </P>

        {/* 追加整改销记（当前版本且有余量、可写时） */}
        {canRectify ? (
          <P padding={16}>
            {KA.SectionHeader ? <KA.SectionHeader>本次整改销记</KA.SectionHeader> : null}
            <div className="dc-fields dc-form-fields">
              {fld("rectifiedOn", "整改日期", "date", fields.rectifiedOn)}
              {fld("count", "本次整改处数", "number", fields.count, { step: 1, min: 1 })}
            </div>
            <p style={{ margin: "10px 0", fontSize: 12, lineHeight: 1.6, color: "var(--ink-soft)" }}>当前未整改 {record.remaining} 处。本次销记不得超过原记录余量，原检查不会删除。</p>
            <label style={lbl}>整改说明
              <textarea rows={3} aria-label="整改说明" value={fields.note} onChange={(e) => patch("note", e.target.value)} /></label>
            <div style={{ marginTop: 12 }}>{Button ? <Button variant="primary" onClick={submit}>登记本次整改</Button> : null}</div>
          </P>
        ) : null}
        {rectifyReasons.map((t) => <div key={t} style={{ fontSize: 12, color: "var(--warn-ink)" }}>{t}</div>)}
        {StatusChip && historical ? <div><StatusChip tone="neutral">定位历史版本时不登记整改</StatusChip></div> : null}
      </div>
    );
  }

  window.HollowDetailScreen = HollowDetailScreen;
  // 预加载占位：app.dc.html 以 hint-size="0,0" x-import 本文件时只播种 HollowDemo（户详情空鼓分区、hollowForm 直开依赖）
  window.HollowDemoPreload = function () { return null; };
})();
