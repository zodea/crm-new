// QuotationDetailScreen — 材料报价详情（route quotationDetail ↔ 实现 /material/quotations/:id?version=…，
// 对应 app/components/material/quotation/QuotationDetailScreen.vue + QuotationOriginalFiles.vue）。
// 口径：头部「材料报价」+ 返回清单 / 编辑报价（material-quotation:write）；
//       主体 = 冻结版本下拉（版本 N · 时间）→ 该版本的报价方原文、原报价日期、适用范围、分供方关联，
//       迁入记录另示「已确认当前关联」（原始编号和冻结资料保持原文）、报价身份与原命令；
//       材料原价表（KitTable；名称/规格/等级/品牌、单位、原报价单价、数量、税口径、适用税率、运费/数量/付款/有效条件，未知写「未知」）；
//       备注；「此版本报价原件」逐份 预览（图片/PDF）/ 下载原件，无原件提示「此版本没有原件」。
// params：{ id, version?, previewState? }；previewState：loading / error / empty / readonly。
(function () {
  if (window.QuotationDetailScreen) return;

  function QuotationDetailScreen({ navigate, params = {} }) {
    const { Panel, Button } = window.DesignSystem_e3d871 || {};
    const KA = window.KitAtoms || {};
    const A = window.APP;
    const Q = window.QUOTATION_DEMO;
    if (Q) Q.use();
    const [picked, setPicked] = React.useState(params.version || "");
    const Table = window.KitTable;
    if (!Panel || !KA.StatePanel || !Table) return null;
    const nav = navigate || (window.DC && window.DC.navigate);
    const state = params.previewState || "ready";
    const record = Q && state !== "empty" ? Q.get(params.id) : null;
    const version = picked || (record ? record.version : "");
    const selected = record ? record.history.find((h) => h.version === version) || null : null;
    const relation = record && record.relations ? record.relations.find((r) => r.version === version) || null : null;
    const canWrite = state !== "readonly";
    const pName = (id) => { const p = A && A.get("projects", id); return p ? p.name + "（" + id + "）" : id; };
    const sName = (id) => { const s = A && A.get("suppliers", id); return s ? s.name + "（" + id + "）" : id; };

    const header = (
      <Panel padding={0} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "14px 16px" }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>材料报价</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button icon="arrow-left" onClick={() => nav && nav("quotation", {})}>返回清单</Button>
          {record && canWrite && state === "ready" && <Button variant="primary" icon="square-pen" onClick={() => nav && nav("quotationForm", { id: record.id })}>编辑报价</Button>}
        </div>
      </Panel>
    );

    let body;
    if (state === "loading") body = <KA.StatePanel state="loading" title="正在读取报价" />;
    else if (state === "error" || !Q) body = <KA.StatePanel state="error" title="报价读取失败" description={Q ? "报价服务暂不可用，请重试。" : "演示数据未加载（需预载 kit/QuotationData.jsx）。"} actionLabel="重试" onAction={() => nav && nav("quotationDetail", { ...params, previewState: "ready" })} />;
    else if (!record) body = <KA.StatePanel state="error" title="报价读取失败" description="报价不存在或没有关联来源的读取权限" actionLabel="重试" onAction={() => nav && nav("quotationDetail", { ...params, previewState: "ready" })} />;
    else if (!selected) body = <KA.StatePanel state="error" title="报价读取失败" description="报价来源版本不存在" actionLabel="重试" onAction={() => { setPicked(""); }} />;
    else {
      const d = selected.draft;
      const scopeText = d.scope === "general" ? "明确通用报价" : d.scope === "project" ? "项目 " + pName(d.projectId) : "适用范围未知";
      const files = (selected.files || []).filter((f) => f.deletedAt === null);
      const preview = (f) => (window.DetailShell && window.DetailShell.previewDoc
        ? window.DetailShell.previewDoc({ name: f.fileName + " · 报价版本原件只读预览", pages: 1 })
        : window.KitUI && window.KitUI.toast("预览 " + f.fileName + "（演示）"));
      const download = (f) => window.KitUI && window.KitUI.toast("已开始下载原件 " + f.fileName + "（演示）", "ok");
      const canPreview = (f) => /^image\//.test(f.mime) || f.mime === "application/pdf";
      body = (
        <>
          <Panel padding={16} style={{ display: "grid", gap: 12, minWidth: 0 }}>
            <div><KA.SelectFilter label="查看冻结版本" value={version} minWidth={220} onChange={setPicked}
              options={record.history.map((h) => ({ key: h.version, label: "版本 " + h.version + " · " + h.occurredAt }))} /></div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, overflowWrap: "anywhere" }}>{d.partyName}</h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>
              原报价日期 {d.quotationDate || "未知"} · {scopeText} · {d.supplierId ? "明确分供方 " + sName(d.supplierId) : "未关联分供方目录"}
            </p>
            {relation && (
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)", overflowWrap: "anywhere" }}>
                已确认当前关联：{relation.projectId ? "项目 " + pName(relation.projectId) : "无项目"} · {relation.supplierId ? "分供方 " + sName(relation.supplierId) : "未关联分供方"} · 迁入批次 {relation.importBatchId}。上方原始编号和冻结资料保持原文。
              </p>
            )}
            <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)", wordBreak: "break-all" }}>报价身份 {record.id} · 原命令 {selected.commandId}</p>
          </Panel>
          <Table label="报价原价横向滚动区域" rows={d.lines} tableMinWidth={900}
            toolbar={<div style={{ padding: "12px 16px 0" }}><KA.SectionHeader>材料原价</KA.SectionHeader></div>}
            columns={[
              { key: "name", label: "名称 / 规格 / 等级 / 品牌", width: 240, render: (v, l) => [l.name, l.spec, l.grade, l.brand].filter(Boolean).join(" / ") },
              { key: "unit", label: "单位", width: 70 },
              { key: "unitPrice", label: "原报价单价", width: 110, align: "right", mono: true, render: (v) => (v === null ? "未知" : v.toLocaleString()) },
              { key: "quantity", label: "数量", width: 80, align: "right", mono: true, render: (v) => (v === null ? "未知" : v) },
              { key: "taxIncluded", label: "税口径", width: 80, render: (v) => (v === null ? "未知" : v ? "含税" : "不含税") },
              { key: "taxRate", label: "适用税率", width: 90, render: (v) => (v === null ? "未知" : v + "%") },
              { key: "conditions", label: "运费 / 数量 / 付款 / 有效条件", width: 320, render: (v, l) => <span style={{ whiteSpace: "normal" }}>{[l.freight, l.quantityCondition, l.paymentCondition, l.validity].map((x) => (x == null ? "未知" : x)).join(" / ")}</span> },
            ]} />
          <Panel padding={16} style={{ minWidth: 0 }}>
            <KA.SectionHeader>备注</KA.SectionHeader>
            <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{d.note || "此版本无备注"}</p>
          </Panel>
          <Panel padding={16} style={{ display: "grid", gap: 8, minWidth: 0 }}>
            <KA.SectionHeader>此版本报价原件</KA.SectionHeader>
            {files.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>此版本没有原件</p>}
            {files.map((f) => (
              <div key={f.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, border: "1px solid var(--line)", borderRadius: 8, padding: 12, fontSize: 13 }}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{f.fileName} · {f.fileSize} 字节</span>
                {canPreview(f) && <Button size="sm" icon="eye" onClick={() => preview(f)}>预览</Button>}
                <Button size="sm" icon="download" onClick={() => download(f)}>下载原件</Button>
              </div>
            ))}
          </Panel>
        </>
      );
    }

    return <div style={{ display: "grid", gap: 16, minWidth: 0 }}>{header}{body}</div>;
  }

  window.QuotationDetailScreen = QuotationDetailScreen;
})();
