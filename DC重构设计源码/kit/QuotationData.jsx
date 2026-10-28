// QuotationData — 材料报价演示数据仓（隐藏预载，供 quotation / quotationDetail / quotationForm / price 四屏共用）。
// 口径对齐实现端 app/lib/material-quotation/contract.ts 与 DATABASE「独立报价（物资 owner）」：
//   报价头 = 原报价方名称 partyName + 可空已核验分供方 supplierId + 适用范围 scope(general/project/unknown)
//            + 项目 projectId（仅 scope=project 时非空）+ 原报价日期（未知为 null）+ 备注 + 原件；
//   报价行 = 名称/规格/等级/品牌/原计价单位 + 原单价、数量、含税口径、本行税率（未知一律 null，不补默认）
//            + 运费/数量/付款/有效条件原文（未明确为 null）；行不另存项目或报价方归属；
//   每次保存追加一个不可变冻结版本（history），原价格点不被后来的报价覆盖；未建档报价方不自动建分供方。
// 数据均为匿名虚构演示样本（与 data.js 世界观同源：s1 大板东 / s3 汇丰水泥 / p1 合和新城 …）。
(function () {
  if (window.QUOTATION_DEMO) { window.QuotationDataPreload = window.QuotationDataPreload || function () { return null; }; return; }

  const listeners = new Set();
  const notify = () => listeners.forEach((f) => { try { f(); } catch (e) { /* 演示仓不抛出 */ } });

  const line = (id, name, spec, grade, brand, unit, unitPrice, extra) => Object.assign({
    id, name, spec, grade, brand, unit, unitPrice,
    quantity: null, taxIncluded: null, taxRate: null,
    freight: null, quantityCondition: null, paymentCondition: null, validity: null,
  }, extra || {});
  const file = (id, fileName, fileSize, mime) => ({ id, fileName, fileSize, mime, deletedAt: null });

  // —— 演示报价：覆盖 已关联分供方 / 未建档报价方 / 通用报价 / 明确项目 / 范围未知 / 多版本 / 迁入关联 ——
  const v1Lines = [
    line("quotation-line-a1", "HRB400 螺纹钢", "Φ12", "HRB400", "韶钢", "吨", 4020, { quantity: 120, taxIncluded: true, taxRate: 13, freight: "含运至项目现场", paymentCondition: "月结 30 天", validity: "报价日起 15 天" }),
    line("quotation-line-a2", "镀锌钢管", "DN50", "", "", "根", 88, { taxIncluded: true, taxRate: 13, freight: "不含运费，另计", validity: "报价日起 15 天" }),
  ];
  const v2Lines = [
    line("quotation-line-a1", "HRB400 螺纹钢", "Φ12", "HRB400", "韶钢", "吨", 3980, { quantity: 120, taxIncluded: true, taxRate: 13, freight: "含运至项目现场", paymentCondition: "月结 30 天", validity: "报价日起 15 天" }),
    line("quotation-line-a2", "镀锌钢管", "DN50", "", "", "根", 86, { taxIncluded: true, taxRate: 13, freight: "不含运费，另计", validity: "报价日起 15 天" }),
  ];
  const records = [
    {
      id: "quotation-7f3a21", version: "2", createdAt: "2026-05-12 09:20", updatedAt: "2026-05-20 16:05",
      draft: { partyName: "广州市大板东建材有限公司", supplierId: "s1", scope: "general", projectId: null, quotationDate: "2026-05-20", note: "二次报价：钢筋与钢管单价下调，其余条件不变。", lines: v2Lines },
      attachments: [file("qfile-a1", "大板东报价单-0512.pdf", 238114, "application/pdf"), file("qfile-a2", "大板东报价单-0520.pdf", 241960, "application/pdf")],
      history: [
        { version: "1", occurredAt: "2026-05-12 09:20", actorId: "user-zhanggong", commandId: "cmd-q-6c1e90",
          draft: { partyName: "广州市大板东建材有限公司", supplierId: "s1", scope: "general", projectId: null, quotationDate: "2026-05-12", note: "首次报价。", lines: v1Lines },
          files: [file("qfile-a1", "大板东报价单-0512.pdf", 238114, "application/pdf")] },
        { version: "2", occurredAt: "2026-05-20 16:05", actorId: "user-zhanggong", commandId: "cmd-q-81d4b2",
          draft: { partyName: "广州市大板东建材有限公司", supplierId: "s1", scope: "general", projectId: null, quotationDate: "2026-05-20", note: "二次报价：钢筋与钢管单价下调，其余条件不变。", lines: v2Lines },
          files: [file("qfile-a1", "大板东报价单-0512.pdf", 238114, "application/pdf"), file("qfile-a2", "大板东报价单-0520.pdf", 241960, "application/pdf")] },
      ],
    },
    (function () {
      const draft = { partyName: "佛山顺鑫瓷砖商行（未建档）", supplierId: null, scope: "project", projectId: "p1", quotationDate: null, note: "现场微信报价截图，报价日期未写明。",
        lines: [line("quotation-line-b1", "全抛釉瓷砖", "800×800", "优等品", "", "块", 41.5, { taxIncluded: null, freight: "送货上楼另议" })] };
      return { id: "quotation-2b9c04", version: "1", createdAt: "2026-06-03 11:42", updatedAt: "2026-06-03 11:42", draft,
        attachments: [file("qfile-b1", "顺鑫瓷砖报价截图.png", 512330, "image/png")],
        history: [{ version: "1", occurredAt: "2026-06-03 11:42", actorId: "user-wanggong", commandId: "cmd-q-3e77aa", draft, files: [file("qfile-b1", "顺鑫瓷砖报价截图.png", 512330, "image/png")] }] };
    })(),
    (function () {
      const draft = { partyName: "汇丰水泥制品", supplierId: null, scope: "unknown", projectId: null, quotationDate: "2025-11-18", note: "",
        lines: [line("quotation-line-c1", "C30 商品混凝土", "泵送", "C30", "", "m³", 455, { taxIncluded: false, taxRate: 3, quantityCondition: "单次不少于 30 m³" })] };
      return { id: "quotation-c41d88", version: "1", createdAt: "2026-07-02 10:15", updatedAt: "2026-07-02 10:15", draft,
        attachments: [],
        history: [{ version: "1", occurredAt: "2025-11-18 15:30", actorId: "native-user-07", commandId: "native-cmd-0091", draft, files: [] }],
        // 迁入后逐条确认的当前关联：原始冻结资料保持原文，仅作读取投影
        relations: [{ version: "1", projectId: null, supplierId: "s3", importBatchId: "quotation-import-5a20e1" }] };
    })(),
  ];

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const rows = () => records;
  const get = (id) => records.find((r) => r.id === id) || null;
  const now = () => new Date().toISOString().slice(0, 16).replace("T", " ");
  const rid = (p) => p + Math.random().toString(16).slice(2, 8);

  // 保存 = 追加一个冻结版本（编辑）或新建报价头（新增）；返回 { id, version }
  const save = ({ id, draft, files }) => {
    const at = now();
    const version = id && get(id) ? String(Number(get(id).version) + 1) : "1";
    const entry = { version, occurredAt: at, actorId: "user-design-demo", commandId: rid("cmd-q-"), draft: clone(draft), files: clone(files || []) };
    if (id && get(id)) {
      const r = get(id);
      r.version = version; r.updatedAt = at; r.draft = clone(draft); r.attachments = clone(files || []);
      r.history = r.history.concat([entry]);
    } else {
      id = rid("quotation-");
      records.unshift({ id, version, createdAt: at, updatedAt: at, draft: clone(draft), attachments: clone(files || []), history: [entry] });
    }
    notify();
    return { id, version };
  };

  const use = () => {
    const [, force] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => { listeners.add(force); return () => listeners.delete(force); }, []);
  };

  const newLine = () => line("quotation-line-" + Math.random().toString(16).slice(2, 10), "", "", "", "", "", null);
  const newDraft = () => ({ partyName: "", supplierId: null, scope: "unknown", projectId: null, quotationDate: null, note: "", lines: [newLine()] });

  // 展示助手（与实现端文案一致）
  const scopeLabel = (d) => (d.scope === "general" ? "通用报价" : d.scope === "project" ? "明确项目" : "范围未知");
  const unknown = (v) => (v === null || v === undefined || v === "" ? "未知" : v);

  window.QUOTATION_DEMO = { rows, get, save, use, newLine, newDraft, scopeLabel, unknown, clone };
  window.QuotationDataPreload = function () { return null; };
})();
