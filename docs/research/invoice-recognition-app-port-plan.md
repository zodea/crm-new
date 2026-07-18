# 移植方案：invoice-recognition-app → 新app 识别域

> 来源仓库：`zodea/invoice-recognition-app`（`songhuodan-ocr-app` v0.4.2，Vue3+Vite+Pinia+UnoCSS+vxe-table+Tauri2）
> 分析日期：2026-07-05
> 目标：把已跑通的发票+送货单识别能力（OCR 集成 + 正则结构化 + 送货单四件套）优化后移植进 新app（Nuxt4+Pinia+SQLite+KitUI），对齐识别中心蓝本（反馈轮7）与 ADR-0001。
> 本文由多 agent 拆读源码生成，供后续实装参照。**只覆盖发票和送货单相关部分。**
> ⚠️ 本文出现的固定栏宽、固定比例与桌面布局只作历史迁移参考；UI 实装统一遵循 [ADR 0013 响应式与自适应契约](../adr/0013-align-all-ui-to-online-design.md)。

> ⚠**引擎决策已更新（2026-07-05）**：本文 §1/§7/§9 关于"PP-OCRv6 vs `@paddlejs-models/ocr`"的讨论**已被 [ADR-0006](../adr/0006-ocr-paddleocr-vl-single-model.md) 取代**——引擎统一定为 **PaddleOCR-VL-1.6 单模型（本地自托管为主）**。影响：`ocr-vl.js`（VL 云端协议）成为**核心复用**（本地自托管只需把端点指向 localhost MLX/llama.cpp server）；`ocr.js`（`@paddlejs-models/ocr` 旧本地引擎）改为 **leave-behind**；§7 前置决策 1（CORS）、2（引擎选型）**已解**。本文其余部分（正则库、送货单四件套、纯函数移植、新旧UI取舍）**全部仍然有效**。

---

## 0. TL;DR 结论

- **最值钱、风险最低的资产是一批零依赖纯函数**：`invoice-parse.js` / `invoice-dedupe.js` / `invoice-filename.js`（发票）、`parse.js` / `vl-parse.js`（送货单）——**可直接 lift-as-is 搬**（JS→TS 加类型即可），连注释里的单测一起搬，先跑绿再说。这一步零 UI、零底座依赖，可立即做。
- **一条关键纠正**：源项目本地引擎是 `@paddlejs-models/ocr`（paddlejs **内置旧小模型** det+rec，输出纯文本行、无坐标无表格），**不是 PP-OCRv6**。PP-OCRv6 Studio 是另一个独立项目。蓝本 OCR 策略写的"本地 PP-OCRv6"与源码实际引擎不是一回事——**需拍板：换 PP-OCRv6 还是回写蓝本文案**。
- **源项目真实 OCR 架构 = 双引擎降级链**，不是"本地主力+云兜底"：**云端 PaddleOCR-VL 才是质量主力**（送货单明细行强依赖它的表格结构），本地 paddlejs 是断网/未配云时的兜底。这与你"离线免费不泄漏"的诉求有张力（见 §7 与 OCR 策略文档）。
- **最大落地阻塞 = 云VL 的 CORS**：本波 `ssr:false` SPA + sql.js，无 Nitro server。源项目靠 vite proxy + Node 中间件绕 CORS 的路子在 Nuxt SPA 下不成立，桌面 Tauri 代理是后续——浏览器 dev 期云VL直连大概率被 CORS 挡。**动手前必须先定代理方案。**
- **UI 层必须等底座**（KitAtoms/KitTable/页签/软删）；纯逻辑层现在就能搬。

---

## 1. OCR 架构现实（对齐蓝本前必读）

| 维度 | 源项目实况 | 蓝本/新app 期望 | 差距处置 |
|---|---|---|---|
| 本地引擎 | `@paddlejs-models/ocr`（webpack+Emscripten 内置旧小模型，WebGL，det+rec 约12MB，`public/ocr-models/`，离线，输出纯文本行 `string[]`，**无坐标无表格**） | 蓝本写"本地 PP-OCRv6" | **决策项**：换 PP-OCRv6（另接 FastAPI/ONNX）或回写蓝本 |
| 云端引擎 | `PaddleOCR-VL-1.6`（飞桨星河异步 job API：`POST /api/v2/ocr/jobs` → 轮询 `jobId` → `resultUrl.jsonUrl`，每页一段 Markdown、表格=HTML `<table>`） | 送货单强制云端 VL | 直接搬协议逻辑 |
| 调度 | `store.runOcr`：配云→优先云，云失败 toast 自动回退本地；没配云→弹拦截门 | 统一识别接口 recognize(docType, pages) | 搬成 Pinia action + `engine.ts` |
| 结构化 | 与 OCR 解耦：`parseInvoice(rawText)` / `parseVlToDocs(markdown)` 纯正则 | 第2层 规则(A)+文本LLM(B) | 规则=直搬；LLM=留空接口位 |

**统一识别接口落点**：`app/lib/recognize/engine.ts` 封装 `ocr-local` + `ocr-vl`，对上暴露 `recognize(docType, pages) → { rawText?, markdownPages?, engine, failedPages }`，内部按 OCR 设置页配置选引擎。发票走 `recognizeOne`：先探电子 PDF 文字层（`isProbablyInvoiceText`），够则跳过 OCR 直接 `parseInvoice`（最准最快），否则整页转图走引擎。

---

## 2. 可直接搬的核心资产（portable units）

优先级：P0=最高价值/最低风险，先搬；复用度：lift-as-is=纯函数直搬，lift-with-adapt=改持久化/依赖，reference-only=逻辑参考不搬形态。

| # | 源文件 | 作用 | 新app 落点 | 复用度 | 优先级 |
|---|---|---|---|---|---|
| 1 | `invoice-parse.js` | 增值税/数电发票扁平文本→字段（号码/代码/日期/购销/金额税额价税合计/税率/货物大类名称/备注/单据大类/行程单货运特判）。零依赖纯函数 | `app/lib/recognize/invoice-parse.ts` | lift-as-is | **P0** |
| 2 | `invoice-dedupe.js` | 批内去重：内容指纹+发票号精确匹配，标 `duplicateOfId/include=false`（蓝本§八） | `app/lib/recognize/invoice-dedupe.ts` | lift-as-is | **P0** |
| 3 | `invoice-filename.js` | 文件名回填空字段（3 种模式） | `app/lib/recognize/invoice-filename.ts` | lift-as-is | P1 |
| 4 | `parse.js` | 送货单散行/tokenized 明细抽取 + 公司/日期/单号（`findDate/findOrderNo/findCompany/parseItemLines/COMPANY_HINTS/UNIT_RE`） | `app/lib/recognize/delivery-parse.ts` | lift-as-is | **P0** |
| 5 | `vl-parse.js` | VL Markdown(HTML table)→多张送货单：一表一单、表头列关键词映射、续行合并、合计行过滤、行级算术校验、供货商抬头识别。"一个PDF自动拆多单"核心 | `app/lib/recognize/vl-parse.ts` | lift-as-is | **P0** |
| 6 | `ocr-vl.js` | 云端 VL 异步 job 协议（submitJob/轮询/取结果/队列满退避） | `app/lib/recognize/ocr-vl.ts` | lift-with-adapt | **P0** |
| 7 | `delivery-tree.js` | 文件夹层级→工地→组→文件 整理树；同名合并/特殊组中转/疑似建议/matchSupplier/flattenForApply | `app/lib/recognize/delivery-tree.ts` | lift-with-adapt | P1 |
| 8 | `supplier-db.js` | 分供方全称/别名/核心名匹配 + 公司名归一化 | `app/lib/recognize/supplier-match.ts` | lift-with-adapt | P1 |
| 9 | `recognized-store.js` | 送货单入库差异合并：自然键=工地+公司+单号，classifyUpsert(inserted/identical/conflicts)，docToRecord/recordsToDeliveryItems | 纯逻辑搬 + 落 SQLite `delivery_records` | lift-with-adapt | P1 |
| 10 | `price-compare.js` | 单价对比归组：规格归一化精确归组、每供应商取最近价、lowest、运费剔除、手动并组、obs 去重 | `app/lib/recognize/price-compare.ts` + 重写 `material/price.vue` 数据源 | lift-with-adapt | P2 |
| 11 | `ocr.js` | 本地 `@paddlejs-models/ocr` 引擎（Module 垫片/withTimeout/旋转重试） | `app/lib/recognize/ocr-local.ts` + `public/ocr-models/` + Nuxt plugin 垫片 | lift-with-adapt | P1 |
| 12 | `credential-ocr.js` | 分供方证照本地 OCR 抽字段（营业执照/开户许可/身份证/授权分类+税号/账号） | `app/lib/recognize/credential-ocr.ts` | lift-as-is | P2 |
| 13 | `store.js`/`invoiceStore.js` | 识别调度：runOcr 降级链、requestOcr 拦截门、公司来源三层优先级、recognizeOne、markDuplicates | 扩充 `app/stores/{delivery,invoice}.ts` actions | reference-only | **P0** |
| 14 | `FieldsTable/FileCard/DeliveryTree/HoverZoom.vue` | 送货单校对交互：明细行自动算 total+_auto、左图右表卡片、整理树拖拽、悬停放大镜 | `app/pages/material/delivery.vue` 及子组件 | lift-with-adapt | P2（等底座） |
| 15 | `app-settings.js`/`SettingsDialog/OcrGateDialog.vue` | OCR 设置持久化 + 设置弹窗 + 未配云拦截门 | `app/stores/ocr-settings.ts` + 识别中心 OCR 设置页 | reference-only | P1 |
| 16 | `invoice-ledger.js`/`posted-invoice-io.js` | 台账跨批次查重/认证/导入税局 Excel（COLUMN_ALIASES）+ 已入账持久化（不存 blob） | `app/stores/invoice.ts` + useExcelIO | lift-with-adapt | P1 |

---

## 3. 正则库精华（可直接搬）

> 完整正则见源码 `invoice-parse.js` / `parse.js` / `vl-parse.js`。以下是关键规则清单，实装时对着抄。

### 发票（invoice-parse.js）
- **预处理**：`String(rawText).normalize('NFKC')`（全角→半角）+ `RADICAL_FIX` 康熙部首修正（⻨→麦 等）+ 压空格。显著提升命中率。
- **单据分类先行**：`classifyDocType` 顺序关键——先判 `行程单` → 再 `货物运输|货拉拉|收款凭证|托运人` → 再 `发票|价税合计|开票日期|税额` → 否则未识别（行程单/货运里也含"电子发票"字样，必须先判）。
- **字符级空格版式检测**：`/[0-9](?:[^\S\n][0-9]){3,}/` 判"每个数字被单独定位、逐个空格拆开"，据此切换号码/税率/金额的容空格正则（避免 `431.13 6%` 把 `3 6` 错并成 36%）。
- **发票号码**：`/发\s*票\s*号\s*码[:：]?\s*([0-9]{8,25})/`，兜底裸 20 位 `/\b([0-9]{20})\b/`。
- **开票日期**：`/开票日期[:：]?\s*([0-9]{4})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日/` → YYYY-MM-DD。
- **购/销名称**：`/名\s*称\s*[:：][^\S\n]*([^\n]*?)(?=名\s*称\s*[:：]|统一社会|纳税人|项目名称|托运人|证照|地\s*址|开户|\n|$)/g`（第0个=buyer，第1个=seller，冒号后只吃同行水平空白不跨行）+ `cleanName`/`dedupeDoubled`（修"佛佛山山"）/`isName`（长2~40、非纯数字、含中文）。
- **价税合计**：`/价税合计[\s\S]{0,40}?[（(]?小写[）)]?\s*[¥￥]?\s*([0-9,]+\.[0-9]{2})/` 多兜底；金额兜底 `amount=round2(total-tax)`。
- **税率白名单**：`{0,1,1.5,2,3,4,5,6,9,10,11,13,16,17}`，表体收集去重，仅一种税率才填（混票留空）。
- **货物税收大类/名称**：`/\*\s*([一-龥][一-龥·]{0,23})\s*\*/`（首对星号内纯中文=category），星号后砍规格数字=service。
- **去重指纹**：`[docType,seller,buyer,amount,tax,total,rate,remark]`（各字段 NFKC+去空格）。台账主键 `ledgerKey`=发票号（去空格），无号退化 `fp|date|round2(total)|seller`。

### 送货单（parse.js / vl-parse.js）
- **列名→字段关键词表 COL_KEYS**：`name /品名|名称|材料|项目|规格|货名|产品|商品/`；`unit /单位/`；`quantity /数量|总数量/`；`unitPrice /单价/`；`total /金额|总价|小计/`；`note /备注/`。
- **无表头列序猜**：行宽≥5，首列纯数字或含"序"则 `off=1`，`header={name:off,unit:off+1,quantity:off+2,unitPrice:off+3,total:off+4}`。
- **续行合并**：品名有字但 unit/qty/price/total 全空→并入上一条 name；`数量×单价` 与金额差>1元→标"待复核"。
- **合计行过滤**：`SUM_ROW_RE /合\s*计|总\s*计|大写|应收|实收/`；备注名过滤 `NOTE_NAME_RE`。
- **票面合计**：`/[合总]\s*计[^¥￥\n]{0,12}[¥￥]\s*([0-9][0-9,]*(?:\.[0-9]+)?)/`（要求带¥避免误抓规格）。
- **供货商抬头**：排除 `BUYER_FIELD_RE`（客户/需方/收货单位/地址/电话…）+ 去尾 `DOCTYPE_TAIL_RE`（送货单/销货清单…）+ 长度 4-30、命中 `COMPANY_HINTS`。
- **单号**：优先标签后串，否则全行最长含数字 6+ 位；≥15 位纯数字疑似税号，只截尾部流水号 `/(0{2,}\d{2,})$/`，截不出留空（宁空勿错）。
- **单位白名单 UNIT_RE**：个件套张块片条支根包袋盒瓶桶罐卷捆扎台把只双副米/m/㎡/m2/立方/方/吨/kg/斤/车/次/项…
- **服务类项 SERVICE_ITEM_RE**：运费/搬运/吊装/管理费/服务费/人工/安装/维修/加工/租金/邮费/快递/配送 → 数量=1、单位=次。
- **规格归一化 normalizeMaterial**（单价对比归组）：全角转半角→去空格→`厘米→mm`→`×✕╳→*`→`5 x 6→5*6`→toLowerCase。
- **VL 行内清洗 stripInline**：去 HTML 标签、去 LaTeX `$...$`、去粗体 `**`（保留单 `*` 如 8*6）、去 `#>\`®™`、解 HTML 实体、压空格。

---

## 4. 送货单四件套映射（整理树/分区/入库/单价对比）

| 件 | 源 | 新app | 要点 |
|---|---|---|---|
| **整理树** | `delivery-tree.js` | 阶段②归属，逻辑纯搬 | 工地→组→文件三层、拖拽移动、组升降级、特殊组中转、疑似建议、同名合并全保留；唯一改造：`matchSupplier` 数据源 `localStorage supplierDb.v1` → 查 `suppliers` 表（name+alias），走 `supplier-match.ts` |
| **分区** | `partitions` | 阶段③ PartitionBar | delivery store 已有 partitions/activePartition/filteredFiles，把 mock 换真数据 + 加增删改 action |
| **入库** | `recognized-store.js` | 阶段⑥出口A + SQLite `delivery_records` | 自然键=工地+公司+单号（`classifyUpsert` 分 inserted 静默入库/identical/conflicts 勾选核对，默认不勾=保留旧值），缺公司/单号 `heldBack` 扣下。新表 `delivery_records(site,company,order_no 唯一索引; date,note,items JSON)`，`recognized-io` 双通道删掉换 useDb。**⚠对齐 CONTEXT.md「入库」**=写材料数据供单价对比，与「归档」并行两条路，`delivery_records` 就是入库落点 |
| **单价对比** | `price-compare.js` | `material/price.vue` 数据源 | 数据源=`delivery_records` 表（`obsFromDeliveryItems`）+ 可选历史 Excel。规格归一后精确归组，行=材料列=供应商，每格取最近价（按日期），lowest=最近价最小者，运费剔除。price.vue 去 mock |

**闭环**：送货单识别校对 → 入库 `delivery_records` → `price.vue` 读同一表出对比。

---

## 5. 与 新app 蓝本 / ADR 的对齐与冲突

1. **ADR-0001 发票单表**：源项目用独立 `ledger` + `posted-invoice-io` 双存，搬时**合并进 `invoices` 单表**（invoice_number 主键去重，source=excel 区分导入，account_status 状态机区分识别/归档）。⚠新app schema 里的 `ticket_registrations` 是「收票登记」另一条流（finance-ticket），别混用。
2. **归属两出口=项目/个人开支**：源项目只有 projectId，**需补「个人开支」出口** + **归档强制归属校验**（account_status→confirmed 前 project 为空则拦截）——源项目 `markAccounted` 无此校验，需新加。
3. **归档定义对齐**：源项目 `accountStatus=posted` 是手动「归档入账」，语义与 CONTEXT.md 一致；蓝本反馈轮7 倾向人工点批量通过放行（与源项目手动一致）。
4. **送货单入库/归档并行两路**：`delivery_records`=入库落点，`ExportPanel`=导出归档，两路互不替代，与 CONTEXT.md 一致。
5. **送货单必须归项目**：源项目送货单归属是**工地名（自由文本）**，新app 要把工地名对齐/绑定到 `project`（**前置决策**）。
6. **OCR 设置页**：源项目 `SettingsDialog` 只有云端 url/token + localOcrAck，需扩展成蓝本形态（按单据类型配引擎/送货单强制云端/本地参数滑块/置信度阈值仅参考）。
7. **置信度**：源项目本无置信度分数（`needsReview` 布尔派生黄橙边框），与蓝本"判决权在人、仅参考"一致，新app 置信度是可选增强。

---

## 6. 新旧 UI 取舍（旧版更好，更新太多版后变差）

### 保留（旧版更好的 UX）
1. **一屏可见、直接可操作**：旧版（提交 `31084bc` 之前）上传/识别/校对/入账尽量同屏、最少跳转。新app 发票蓝本已吸取教训定为"单一工作台"（左18%+中40%+右42%），**务必守住不再拆多阶段状态机**。
2. **左图右字段并排校对**：源项目 `InvoiceDetailView` 左原图+右字段同面板并排，最顺手。
3. **送货单左图右表 FileCard**：左预览缩略+HoverZoom 悬停放大镜 + 右明细表同屏，一文件一卡片就地校对不跳页——直接搬。
4. **明细行自动算 total + _auto 标记**：数量×单价自动补 total，用户手改后不再覆盖——体验极好，必保留。
5. **查看原始 OCR 文本 + 候选品名 chip 点击填入**：高效纠错。
6. **置信度=输入框边框色+角标百分比**（不占整行）。
7. **拦截门"仍用本地以后别再问"**（记住 ack）。
8. **问题汇总弹窗 + 只看未完善筛选**：批量收口。
9. **公司来源三层优先级 manual>ocr>folder + 来源徽章 + 冲突二选一亮牌**。

### 规避（新版重构后变差）
1. **侧边栏壳变重**（248px 固定左栏+副标题+二级 hint+独立顶栏，双层壳吃横向）——导航保持轻。
2. **多阶段 viewMode 状态机**把线性流程复杂化（"先选阶段再操作"）——发票已改回单工作台，送货单六阶段是**竖向单页流**非强制切 tab。
3. **行内编辑改成整页路由跳转**（`router.push(/invoice/:id)` 丢上下文）——新app 台账"修改"走应用内**页签**。
4. **空状态门槛页**（全屏 hero"尚未上传"多点一次）——空态直接给可用上传区。
5. **常用操作藏进 more 下拉**——常用操作平铺可见。
6. **emoji 全换 Lucide 降低亲和力**——图标克制使用。
7. **视觉令牌为设计系统而过度堆叠**（九色阶/多圆角/多按钮态，真实数据撑不起重仪表盘视觉）——识别模块**数据驱动**，按真实数据量决定复杂度，不照搬 mockup。

---

## 7. 三项前置决策（动手前拍板，否则返工）

1. **云VL 在浏览器 dev 的 CORS 方案**：临时跨域代理端点 or 直接进桌面 Tauri2 Rust 代理？（本波 SPA 无 Nitro，源项目的 vite proxy 路子不成立。送货单强依赖云VL 表格结构——**最大阻塞**。）
2. **本地引擎用现成 `@paddlejs-models/ocr` 还是换 PP-OCRv6**：二者不是同一引擎、质量/接口都不同。换 v6 要重接（FastAPI/ONNX），或回写蓝本文案对齐实际引擎。
3. **送货单工地名 → 新app `project` 的绑定规则**：源项目工地是自由文本，新app 送货单必须归 project，映射规则影响入库与归档归属。

> 这三项与"离线/隐私/成本"策略强相关，最终定案见 `docs/research/ocr-recognition-strategy.md`（待补）与 `docs/adr/0006-ocr-paddleocr-vl-single-model.md`（待写）。

---

## 8. 落地顺序（建议）

- **步骤0**：拍板 §7 三项前置决策。
- **步骤1（纯逻辑层，零UI零底座依赖，可立即做+单测）**：新建 `app/lib/recognize/`，lift-as-is 搬 `invoice-parse / invoice-dedupe / invoice-filename / delivery-parse / vl-parse / supplier-match / recognized-store(纯函数) / price-compare`，JS→TS，连注释单测搬到 `__tests__`，vitest 跑绿。**最值钱、风险最低。**
- **步骤2**：fields→Invoice mapper（number→invoiceNumber 等）+ invoice store 补 `recognizeOne`/`markDuplicates`/`importFromExcel`（COLUMN_ALIASES+ADR-0005）/归档强制归属校验+个人开支出口。落 `invoices` 单表（ADR-0001）。
- **步骤3**：`engine.ts` 统一识别接口；先接云VL（删 Tauri 分支，接步骤0 CORS 方案，onProgress→KitUI process 道 toast）；本地引擎 `ocr-local.ts`（垫片 plugin+public/ocr-models/+动态 import+超时）作降级；降级链搬进 store actions。
- **步骤4**：`ocr-settings` Pinia store（token 留 localStorage）+ 蓝本形态 OCR 设置页 + KitUI confirm 拦截门（记住 ack）。
- **步骤5**：新建 `delivery_records` 表；delivery store 从 mock 换真数据 + staging/partition/requestOcr/降级 actions；`recognized-store` upsert 改 SQL；`material/price.vue` 数据源换 `delivery_records`，单价对比闭环。
- **步骤6（等核心底座就位）**：识别 UI 组件实装——发票单工作台（左18%+中40%+右42%，字段校对/打印排版子模式）+ 台账左树右表；送货单六阶段竖向单页流（FieldsTable/FileCard/DeliveryTree/HoverZoom 换 KitTable/KitAtoms/KitUI，保留自动算total/HoverZoom/整理树拖拽），吸取 §6 保留、规避 §6 变差。
- **步骤7（收尾）**：credential-ocr（证照旁路+supplier_credentials）+ 发票打印排版子模式（invoice-layout，另议）。

---

## 9. 风险清单

1. **云VL CORS 无 Nitro 可用**（最大落地阻塞，见 §7.1）。
2. **本地引擎 ≠ 蓝本 PP-OCRv6**（见 §7.2）。
3. **本地引擎 Nuxt SSR 兼容坑**：`@paddlejs-models/ocr` 依赖 `globalThis.Module`+WebGL，即使 ssr:false 也要 `import.meta.client` 守卫+垫片+动态 import+90s 超时（模型加载失败 Promise 不落定会卡死 UI）。
4. **底座未就位**：CONTEXT.md 明确 KitUI原语→核心底座→识别域。纯逻辑层可先搬，**UI 层必须等底座**。
5. **送货单工地名 vs project 绑定**未定（见 §7.3）。
6. **token 安全**：vlToken 是凭证，绝不进 SQLite/代码/git，只 localStorage。
7. **发票"个人开支"出口 + 归档强制归属校验** 源项目缺失，需新app补写。
8. **规格归一化归组可能过粗/过细**：真实工地材料写法归组准确率需实测，手动并组是必要补丁。
9. **纯函数 JS→TS 字段名对齐**：source(number/seller/total) vs 新app Invoice(invoiceNumber/seller/totalAmount) 不一致，需 mapper，漏映射会静默丢字段。

---

## 10. 不搬的部分（leave-behind）

1. `@paddleocr/api-sdk`：声明但从未 import，只支持 Node filePath，删。
2. `isTauri()`/`tauriInvoke` 桌面分支：本波 SPA 无 Tauri 运行时，整段删，后续以新app 自己的 Tauri2 命令重接。
3. vite dev proxy(`/vl-api`)+Node 中间件(`/vl-result`)：Vite 专属，换代理方案。
4. `recognized-io.js` 双通道 I/O：换 useDb + `delivery_records`。
5. `app-settings.js` localStorage+reactive 实现：换 Pinia（仅 token 留 localStorage）。
6. `invoice-layout.js`/print-layout（pdf-lib 打印排版）：与字段抽取解耦，本波识别域先不搬，发票打印排版阶段另议。
7. reka-ui 全套弹窗原语：换 KitUI confirm/formModal + 自研，不引入 reka-ui。
8. Precision Ledger 设计系统重壳（侧边栏+多阶段状态机+独立编辑路由）："更新太多版变差"的病灶，明确不搬。
9. `invoiceStore.js`/`store.js` reactive 单例形态：逻辑参考、形态不搬，改写成 Pinia actions。
