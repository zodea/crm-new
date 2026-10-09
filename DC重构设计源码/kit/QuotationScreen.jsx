// QuotationScreen — 材料报价清单（route quotation ↔ 实现 /material/quotations，
// 对应 app/components/material/quotation/QuotationListScreen.vue；Q-A02-03 独立报价 owner，独立于 price 单价对比屏）。
// 口径：头部 = 标题 + 说明 + 「新增报价」（material-quotation:write）+「核验本地报价迁入」（core:migration:write）；
//       清单 = 报价方原文（蓝链进详情，下附是否已明确关联分供方）/ 报价日期 / 适用范围 / 材料行 / 版本 / 操作「编辑」。
//       实现端无搜索、筛选和删除，设计稿同样不放（表格沿用 KitTable 原语，含其分页条）；读取范围不完整时提示「不能作为全部报价数量」。
// 预览态 params.previewState：loading / error / empty / readonly（无写权限且读取范围受限）。
// 数据：kit/QuotationData.jsx（window.QUOTATION_DEMO，需隐藏预载）。
(function () {
  if (window.QuotationScreen) return;

  function QuotationScreen({ navigate, params = {} }) {
    const { Panel, Button } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const Q = window.QUOTATION_DEMO;
    if (Q) Q.use();
    if (!Panel || !KA.StatePanel) return null;
    const nav = navigate || (window.DC && window.DC.navigate);
    const state = params.previewState || "ready";
    const canWrite = state !== "readonly";
    const canMigrate = state !== "readonly";
    const records = !Q || state === "empty" ? [] : Q.rows();
    const Table = window.KitTable;
    const linkBtn = { border: 0, background: "transparent", padding: 0, color: "var(--brand)", fontWeight: 600, cursor: "pointer", textAlign: "left", font: "inherit" };

    return (
      <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
        <Panel padding={0} style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "14px 16px" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>材料报价</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-soft)" }}>独立保存报价原文、适用条件和原件。未建档报价方不会自动成为分供方。</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {canWrite && <Button variant="primary" icon="plus" onClick={() => nav && nav("quotationForm", {})}>新增报价</Button>}
            {canMigrate && <Button icon="database-backup" onClick={() => nav && nav("quotationImport", {})}>核验本地报价迁入</Button>}
          </div>
        </Panel>

        {state === "loading" ? <KA.StatePanel state="loading" title="正在读取报价" />
          : state === "error" || !Q || !Table ? <KA.StatePanel state="error" title="报价读取失败" description={Q ? "报价服务暂不可用，请稍后重试。" : "演示数据未加载（需预载 kit/QuotationData.jsx）。"} actionLabel="重试" onAction={() => nav && nav("quotation", { previewState: "ready" })} />
          : (
            <Table label="报价清单横向滚动区域" rows={records} tableMinWidth={650}
              toolbar={state === "readonly" ? <p style={{ margin: 0, padding: "10px 16px", fontSize: 13, color: "var(--ink-soft)", borderBottom: "1px solid var(--line)" }}>清单仅包含本次有权读取的报价，不能作为全部报价数量。</p> : null}
              empty="当前可读取范围内暂无报价"
              columns={[
                { key: "partyName", label: "报价方原文", width: 260, render: (v, r) => (
                  <span style={{ display: "grid", gap: 2, whiteSpace: "normal" }}>
                    <button type="button" style={linkBtn} onClick={() => nav && nav("quotationDetail", { id: r.id })}>{r.draft.partyName}</button>
                    <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{r.draft.supplierId ? "已明确关联分供方" : "未关联目录身份"}</span>
                  </span>) },
                { key: "quotationDate", label: "报价日期", width: 120, mono: true, render: (v, r) => r.draft.quotationDate || "未知" },
                { key: "scope", label: "适用范围", width: 110, render: (v, r) => Q.scopeLabel(r.draft) },
                { key: "lines", label: "材料行", width: 80, align: "right", mono: true, render: (v, r) => r.draft.lines.length },
                { key: "version", label: "版本", width: 70, align: "right", mono: true },
                { key: "_ops", label: "操作", width: 80, render: (v, r) => (canWrite ? <button type="button" style={linkBtn} onClick={() => nav && nav("quotationForm", { id: r.id })}>编辑</button> : null) },
              ]} />
          )}
      </div>
    );
  }

  window.QuotationScreen = QuotationScreen;
})();
