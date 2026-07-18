# 扫描件助手 — 重写设计文档

> ⛔ **已归档**：本文“唯一基准”声明已经失效。现行视觉/布局与响应式契约见 [ADR 0013](../../adr/0013-align-all-ui-to-online-design.md)；下文固定比例、列数和画布尺寸仅作历史参考。
> 日期：2026-06-26　状态：初稿  
> 从旧版 Vue 3 + Vite + Tauri 重写为 Nuxt + TypeScript + Tauri 桌面系统。  
> 本文曾作为早期重写实施参考，现仅保留历史上下文。

---

## § 1 产品定位

### 1.1 核心定义

工地记账员的桌面工具——本地运行、数据不上传，覆盖施工项目从合同签订到竣工结算的全流程管理。

### 1.2 业务范围

| 域 | 说明 |
|---|---|
| 项目信息 | 在建工程项目的基础资料与详情 |
| 基础信息 | 分供方（材料商/劳务公司）、班组、工人的档案管理 |
| 资金管理 | 发票识别校对、开票申请、收付款、费用报销 |
| 主合同管理 | 与甲方签订的工程合同及履约全流程 |
| 分包及人工 | 劳务分包合同、工程量矩阵、工资核算、考勤 |
| 乙供材管理 | 材料采购合同、送货单OCR识别归档、单价对比 |

### 1.3 产品承诺

- 纯本地运行，数据不上传（OCR 云引擎为可选项，用户自行配置 API）
- 离线可用（本地 PP-OCRv6 兜底）
- Windows 桌面端为主，通过 Tauri webview 渲染

---

## § 2 技术栈

### 2.1 核心选型

| 层 | 技术 | 决策编号 |
|---|---|---|
| 框架 | **Nuxt 3**，`ssr: false` SPA 模式 | #01 |
| 语言 | **TypeScript** 全量 | — |
| 桌面壳 | **Tauri 2** (Rust + webview) | — |
| UI 组件库 | **shadcn-vue** (UnoCSS 适配方案) | #02 |
| CSS 引擎 | **UnoCSS** (shortcuts + icons preset + attributify) | #08 |
| 表格 | **vxe-table**，主题对齐 Claude Design 视觉语言 | #05 |
| 状态管理 | **Pinia**，作为 SQLite 的内存缓存层 | — |
| 交互工具 | **VueUse** 优先使用成熟 composable | — |
| 数据持久化 | **SQLite** (tauri-plugin-sql)，全模块统一 | #06 |
| OCR 主引擎 | **PaddleOCR-VL** 云 API（优先） | #07 |
| OCR 本地 | **PP-OCRv6 Small** (开发期 onnxruntime-web，生产期 Rust ort) | #07 |
| 图标 | UnoCSS Icons preset + `@iconify-json/lucide` | — |

### 2.2 Nuxt SPA 模式（决策 #01）

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  ssr: false,
  // Tauri file:// 协议兼容
  // 约定式路由 + auto-import + composable 目录
})
```

- 打包产物为纯静态 HTML/JS/CSS，Tauri webview 直接加载
- 不需要 Node sidecar，不需要 SSR 服务
- 排除 SSG 方案（动态路由回退处理复杂）

### 2.3 设计语言（决策 #02）

以 Claude Design 原型（方案 5 明亮通透版）为设计基准，不沿用旧代码的 UI 体系。shadcn-vue 做组件底层，样式层向 Claude Design 视觉语言靠拢。具体视觉方案通过效果图逐步确认。

### 2.4 数据持久化（决策 #06）

全部模块统一 SQLite，不再使用 localStorage。

- Pinia store 作为内存缓存层，启动时从 SQLite 加载，变更时写回
- 旧数据迁移：首次启动检测 localStorage 旧数据，自动导入 SQLite
- dev 模式：Nuxt dev 没有 Tauri 环境，用 sql.js (wasm 版 SQLite) 做 fallback

### 2.5 OCR 架构（决策 #07）

```
用户操作 → useOcr() 统一接口
                ├─ 已配置 API? → PaddleOCR-VL 云端（优先）
                └─ 未配置/不可用 → PP-OCRv6 Small 本地
                                    ├─ 开发期: onnxruntime-web (WebGPU/wasm)
                                    └─ 生产期: Tauri Rust ort crate
```

- 云 VL 擅长手写体/表格/多单拆分
- 本地 PP-OCRv6 Small ~30MB，印刷体+简单手写可用
- 前端 `useOcr()` composable 封装统一接口，屏蔽引擎差异

---

## § 3 导航结构

### 3.1 一级菜单（7 项）

```
┌──────────────────────────────────┐
│  侧边栏                          │
│                                  │
│  ┌────┐                         │
│  │ 首 │ 首页                     │
│  ├────┤                         │
│  │ 项 │ 项目信息                 │
│  ├────┤                         │
│  │ 基 │ 基础信息                 │
│  │    │  ├ 分供方                │
│  │    │  ├ 班组                  │
│  │    │  └ 工人                  │
│  ├────┤                         │
│  │ 资 │ 资金管理                 │
│  │    │  ├ 发票识别              │
│  │    │  ├ 开票因子              │
│  │    │  ├ 开票申请    (待设计)   │
│  │    │  ├ 收款登记    (待设计)   │
│  │    │  ├ 收票登记    (待设计)   │
│  │    │  ├ 付款申请    (待设计)   │
│  │    │  ├ 费用报销    (待设计)   │
│  │    │  └ 支付记录    (待设计)   │
│  ├────┤                         │
│  │ 合 │ 主合同管理               │
│  │    │  ├ 施工合同    (待设计)   │
│  │    │  ├ 甲方报量    (待设计)   │
│  │    │  ├ 甲方罚扣    (待设计)   │
│  │    │  ├ 甲方变洽签  (待设计)   │
│  │    │  ├ 竣工验收    (待设计)   │
│  │    │  ├ 最终结算    (待设计)   │
│  │    │  └ 保修到期确认(待设计)   │
│  ├────┤                         │
│  │ 包 │ 分包及人工               │
│  │    │  ├ 分包合同    (待设计)   │
│  │    │  ├ 项目罚扣    (待设计)   │
│  │    │  ├ 分包结算    (待设计)   │
│  │    │  ├ 变洽签      (待设计)   │
│  │    │  ├ 工程量管理             │
│  │    │  ├ 工资核算               │
│  │    │  └ 考勤管理               │
│  ├────┤                         │
│  │ 材 │ 乙供材管理               │
│  │    │  ├ 采购合同    (待设计)   │
│  │    │  ├ 送货单识别             │
│  │    │  └ 单价对比               │
│  └────┘                         │
└──────────────────────────────────┘
```

### 3.2 分组逻辑

按**业务类型**分组，不按文档类型。各业务域自带各自的合同：

| 一级菜单 | 合同类型 | 签订对象 |
|---------|---------|---------|
| 主合同管理 | 工程合同 | 甲方（建设单位） |
| 分包及人工 | 分包合同 | 劳务分供方 |
| 乙供材管理 | 采购合同 | 材料分供方 |

### 3.3 跨域数据流

```
① 送货单识别(乙供材) → 识别明细库 → 分供方详情(基础信息) + 单价对比
② 发票入账(资金管理) → 销售方收集 → 分供方资料库(基础信息)
③ 分包合同(分包及人工) → 关联劳务分供方(基础信息)
④ 采购合同(乙供材) → 关联材料分供方(基础信息)
⑤ 工程量管理(分包及人工) → 按班组区分(基础信息/班组)
⑥ 首页面板 → 点击项目名 → 项目详情(项目信息)
```

---

## § 4 路由设计

### 4.1 完整路由表

```
/                                       → 首页（在建工程总览）

/project                                → 项目列表
/project/:id                            → 项目详情

/base/supplier                          → 分供方列表
/base/supplier/:id                      → 分供方详情/对账
/base/crew                              → 班组列表
/base/crew/:id                          → 班组详情（配置/单价/工人）
/base/worker                            → 工人列表
/base/worker/:id                        → 工人详情（证书/区域/工资/考勤）

/finance/invoice                        → 发票识别（四阶段工作流）
/finance/invoice/:id                    → 发票详情编辑
/finance/invoice/factor                 → 开票因子计算器
/finance/billing                        → 开票申请 (待设计)
/finance/receipt                        → 收款登记 (待设计)
/finance/ticket                         → 收票登记 (待设计)
/finance/payment                        → 付款申请 (待设计)
/finance/reimbursement                  → 费用报销 (待设计)
/finance/records                        → 支付记录 (待设计)

/contract/construction                  → 施工合同 (待设计)
/contract/measurement                   → 甲方报量 (待设计)
/contract/penalty                       → 甲方罚扣 (待设计)
/contract/change-order                  → 甲方变洽签 (待设计)
/contract/acceptance                    → 竣工验收 (待设计)
/contract/settlement                    → 最终结算 (待设计)
/contract/warranty                      → 保修到期确认 (待设计)

/subcontract/contract                   → 分包合同 (待设计)
/subcontract/penalty                    → 项目罚扣 (待设计)
/subcontract/settlement                 → 分包结算 (待设计)
/subcontract/change-order               → 变洽签 (待设计)
/subcontract/quantity                   → 工程量管理（矩阵）
/subcontract/quantity/:pid/:cid         → 班组工程量明细
/subcontract/payroll                    → 工资管理
/subcontract/payroll/:pid/...           → 工资明细
/subcontract/attendance                 → 考勤管理

/material/contract                      → 采购合同 (待设计)
/material/delivery                      → 送货单识别
/material/price                         → 单价对比

/:pathMatch(.*)*                        → redirect /
```

---

## § 5 目录结构

### 5.1 pages/

```
pages/
├── index.vue                           # 首页
├── project/
│   ├── index.vue
│   └── [id].vue
├── base/
│   ├── supplier/
│   │   ├── index.vue
│   │   └── [id].vue
│   ├── crew/
│   │   ├── index.vue
│   │   └── [id].vue
│   └── worker/
│       ├── index.vue
│       └── [id].vue
├── finance/
│   ├── invoice/
│   │   ├── index.vue
│   │   ├── [id].vue
│   │   └── factor.vue
│   ├── billing.vue                     # 待设计
│   ├── receipt.vue                     # 待设计
│   ├── ticket.vue                      # 待设计
│   ├── payment.vue                     # 待设计
│   ├── reimbursement.vue               # 待设计
│   └── records.vue                     # 待设计
├── contract/
│   ├── construction.vue                # 待设计
│   ├── measurement.vue                 # 待设计
│   ├── penalty.vue                     # 待设计
│   ├── change-order.vue                # 待设计
│   ├── acceptance.vue                  # 待设计
│   ├── settlement.vue                  # 待设计
│   └── warranty.vue                    # 待设计
├── subcontract/
│   ├── contract.vue                    # 待设计
│   ├── penalty.vue                     # 待设计
│   ├── settlement.vue                  # 待设计
│   ├── change-order.vue                # 待设计
│   ├── quantity/
│   │   ├── index.vue
│   │   └── [projectId]/
│   │       └── [crewId].vue
│   ├── payroll/
│   │   ├── index.vue
│   │   └── [projectId]/
│   │       └── [...slug].vue
│   └── attendance.vue
└── material/
    ├── contract.vue                    # 待设计
    ├── delivery.vue
    └── price.vue
```

### 5.2 components/

```
components/
├── layout/
│   ├── AppSidebar.vue                  # 侧边栏（7级菜单+分组折叠）
│   ├── AppTopbar.vue                   # 顶栏
│   ├── MobileTabBar.vue                # 手机端底部 tab bar
│   └── StickyToolbar.vue               # 通用 sticky 操作栏
├── ui/
│   ├── (shadcn-vue CLI 生成)
│   ├── DataListToolbar.vue
│   ├── SearchInput.vue
│   ├── StatCard.vue
│   ├── StatusChip.vue
│   ├── FilterPill.vue
│   ├── StageTab.vue
│   ├── Panel.vue
│   ├── IconButton.vue
│   └── TableActions.vue
├── home/
│   └── ProjectDashboard.vue            # 首页项目面板
├── invoice/
│   ├── InvoiceUpload.vue
│   ├── InvoicePreview.vue
│   ├── InvoiceRow.vue
│   ├── FieldsTable.vue
│   ├── InvoicePrintPanel.vue
│   ├── InvoiceLedgerPanel.vue
│   ├── InvoiceLedgerViewer.vue
│   └── ExportPanel.vue
├── delivery/
│   ├── DeliveryTree.vue
│   ├── PartitionBar.vue
│   ├── UploadZone.vue
│   ├── FileCard.vue
│   └── SaveToStorePanel.vue
├── supplier/
│   └── SupplierFormDialog.vue
├── project/
│   ├── ProjectFormDialog.vue
│   └── ProjectCombobox.vue
├── worker/
│   └── WorkerFormDialog.vue
├── crew/
│   └── (待展开)
├── quantity/
│   └── (矩阵可视化·待展开)
├── payroll/
│   └── (待展开)
└── shared/
    ├── OcrGateDialog.vue
    ├── ProblemDialog.vue
    ├── HoverZoom.vue
    ├── SettingsDialog.vue
    └── ToastHost.vue
```

### 5.3 composables/

```
composables/
├── useDb.ts                            # SQLite 统一封装（dev: sql.js fallback）
├── useOcr.ts                           # OCR 统一接口（云VL + 本地）
├── useExcelIO.ts                       # Excel 导入导出 + Tauri 保存对话框
├── useListPage.ts                      # CRUD + 搜索 + 分页（列表页复用）
├── useToast.ts                         # Toast 通知
├── useSettings.ts                      # 设置读写（VL API 配置等）
├── usePdf.ts                           # PDF 渲染/文本提取/旋转
└── useUpload.ts                        # 文件上传处理
```

### 5.4 stores/ — Pinia

```
stores/
├── app.ts                              # 全局 UI 状态（侧边栏折叠等）
├── project.ts                          # 施工项目
├── supplier.ts                         # 分供方
├── crew.ts                             # 班组
├── worker.ts                           # 工人
├── invoice.ts                          # 发票
├── delivery.ts                         # 送货单
├── recognized.ts                       # 识别明细库
├── quantity.ts                         # 工程量
├── payroll.ts                          # 工资
├── attendance.ts                       # 考勤
└── (待设计: contract, finance 相关)
```

### 5.5 lib/ — 纯逻辑（零 Vue 依赖）

```
lib/
├── ocr/
│   ├── ocr.ts                          # PP-OCRv6 本地推理
│   ├── ocr-vl.ts                       # PaddleOCR-VL 云 API
│   ├── credential-ocr.ts              # 证照 OCR
│   └── vl-parse.ts                     # VL 结果解析
├── invoice/
│   ├── invoice-parse.ts                # OCR → 13字段结构
│   ├── invoice-excel.ts                # Excel 导入导出
│   ├── invoice-layout.ts               # A4 打印排版
│   ├── invoice-ledger.ts               # 已入账持久化
│   ├── invoice-filename.ts             # 文件名兜底
│   ├── invoice-dedupe.ts               # 内容指纹去重
│   ├── invoice-export-package.ts       # 批量导出
│   └── invoice-reimburse.ts            # 费用报销格式
├── delivery/
│   ├── delivery-tree.ts                # 文件夹层级
│   ├── parse.ts                        # 日期/单号/公司提取
│   └── naming.ts                       # 命名规范
├── db/
│   ├── schema.ts                       # SQLite 建表 + 迁移
│   ├── supplier-db.ts
│   ├── project-db.ts
│   ├── worker-db.ts
│   ├── recognized-io.ts
│   └── posted-invoice-io.ts
├── io/
│   ├── pdf.ts                          # PDF → 页面图片
│   ├── pdftext.ts                      # PDF 文本提取
│   ├── upload.ts                       # 文件上传
│   ├── export.ts                       # 通用导出
│   ├── excel.ts                        # Excel 读写
│   ├── open-external.ts               # 外部链接
│   └── tauri.ts                        # Tauri API 封装
└── util/
    ├── chinese-amount.ts               # 中文大写金额
    ├── price-compare.ts                # 单价对比逻辑
    ├── print-layout.ts                 # 打印排版计算
    └── format.ts                       # 日期/金额/公司名格式化
```

### 5.6 其他顶层

```
public/
├── ocr-models-v6/                      # PP-OCRv6 ONNX 模型 (~30MB)
├── ort/                                # onnxruntime-web wasm (开发期)
├── pdf.worker.min.mjs                  # PDF.js worker
└── cmaps/                              # PDF CMap 资源

src-tauri/
├── tauri.conf.json                     # 窗口/安装/CSP 配置
├── src/main.rs                         # Tauri commands
└── Cargo.toml                          # Rust 依赖 (ort, tauri-plugin-sql)

nuxt.config.ts                          # Nuxt 配置（SPA + UnoCSS + Pinia + vxe-table）
uno.config.ts                           # UnoCSS 配置（Claude Design 令牌 + shortcuts）
```

---

## § 6 已有模块业务规范

> 以下为从现有代码和 CONTEXT.md 提取的已验证业务规则，重写时必须保留。

### 6.1 发票识别与校对（四阶段工作流）

**四阶段 Tab**（数据互斥）：

| Tab | 过滤条件 | 用途 |
|-----|---------|------|
| 文档识别状态 | `accountStatus ≠ posted` | 上传、识别、文件管理 |
| 发票识别与校对 | `status = done && accountStatus ≠ posted` | 三栏逐张校对 |
| 待入账 | 同上（不同 UI） | 批量入账 |
| 已入账 | `status = done && accountStatus = posted` | 归档查阅 |

**校对三栏**：左列表(300px) + 中A4预览(flex) + 右校对表单(flex)

**13字段结构**：发票号码、开票日期、购/销方、金额、税额、价税合计、税点、票据类型、票种(专用/普通)、单据类型、对应项目、票面备注

**去重规则**：内容指纹（类型+销售方+购买方+金额+税额+总价+税点+备注），日期相同+指纹相同 → 重复

**旋转粒度**：按页独立旋转，`pageRotations = { [pageIndex]: deg }`

### 6.2 送货单识别与整理

**双引擎 OCR**：云 VL 优先 → 本地 PP-OCRv6 回退

**解析流程**：
1. 图片 → OCR → 原始文本/表格
2. 提取公司名（红章优先）、单号、日期
3. 解析材料明细行（名称、单位、数量、单价、总价）
4. 多单判别：单号不同=两单，单号相同=多联副本

**公司来源三层**：文件夹预填 < OCR识别 < 手动输入（高不被低覆盖，不一致亮色标注）

**整理树**：工地 → 组(分供方/特殊组) → 文件，可拖拽调整

**两个去向**：入库(写识别明细库) vs 导出归档(PDF+Excel)，互不替代

### 6.3 分供方资料库

**字段**：公司全称、简称/别名(数组)、税号、法人、注册地址、开户行、银行账号、联系人、电话、备注、来源、附件档案

**名称归一化**：去全/半角差异、连续空格、标点变体，再精确比对

**详情对账**：送货单合计(自动) + 手记采购合计 − 已支付合计 = 差额(应付)

**数据来源**：识别明细库(自动) + 手动采购/支付记录 + 从发票收集

### 6.4 单价对比

**观测点**：`{ supplier, site, name, normKey, unit, price, date }`

**规格归一化**：全角→半角、去空格、"厘/厘米"→"mm"、乘号统一、小写化

**排除集**：运费类关键词默认剔除，用户可增减，仅作用于对比不影响明细

### 6.5 开票因子计算器

**两行两列布局**：Row1(输入+税额卡片) + Row2(因子表+组合方案)

**因子表精简列**：名称、单位、含税单价、上限、删除

**粘贴导入**：Ctrl+V 或按钮弹 textarea，Tab 分隔解析

---

## § 7 待设计模块清单

### 7.1 首页 — 在建工程总览

- Tab 页切换不同项目
- 面板：收付款状况、施工工程量进度、税额
- 点击项目名 → 跳转项目详情
- 具体面板内容和布局待定

### 7.2 资金管理（除发票外）

| 子模块 | 说明 | 状态 |
|--------|------|------|
| 开票申请 | 待设计 | — |
| 收款登记 | 待设计 | — |
| 收票登记 | 待设计 | — |
| 付款申请 | 待设计 | — |
| 费用报销 | 现有导出可整合 | — |
| 支付记录 | 待设计 | — |

### 7.3 主合同管理

参照红圈CRM系统，与甲方签订的工程合同全流程：

| 子模块 | 说明 |
|--------|------|
| 施工合同 | 合同基础信息、条款、明细 |
| 甲方报量 | 收入结算：清单、变洽签清单、扣款与奖励 |
| 甲方罚扣 | 甲方罚扣单管理 |
| 甲方变洽签 | 合同金额调整 |
| 竣工验收 | 竣工验收流程 |
| 最终结算 | 工程最终结算 |
| 保修到期确认 | 保修期管理 |

### 7.4 分包及人工

| 子模块 | 说明 | 设计状态 |
|--------|------|---------|
| 分包合同 | 与劳务分供方签订 | 待设计 |
| 项目罚扣 | 分包项目罚扣 | 待设计 |
| 分包结算 | 分包结算流程 | 待设计 |
| 变洽签 | 分包合同金额调整 | 待设计 |
| 工程量管理 | 矩阵可视化，按班组区分 | 有设计文档，界面需完善 |
| 工资核算 | 计件/计时，发放确认 | 有设计文档，计算逻辑需细化 |
| 考勤管理 | 与工资挂钩 | 有设计文档 |

### 7.5 乙供材管理

| 子模块 | 说明 | 设计状态 |
|--------|------|---------|
| 采购合同 | 与材料分供方签订 | 待设计 |
| 送货单识别 | OCR 识别整理 | 已完成 |
| 单价对比 | 跨供应商比价 | 已完成 |

---

## § 8 分供方状态流转（待调整）

> 原五阶段设计需重构为完整审批链，每个节点有审核人员。

### 8.1 新流程

```
资料提交 → 分供方确认(审核) → 合同确认(审核) → 请款(多轮·审核)
                                                    ├→ 发票流程
                                                    └→ 付款流程
全部请款完结 → 结算(终态·数据锁定)
```

### 8.2 合同确认环节字段

- 关联项目
- 甲方
- 分供方
- 合同类型
- 合同金额
- 税额
- 开票产品明细（清单格式，支持 Excel 粘贴）
- 押金

### 8.3 待补充

- [ ] 审核人员角色定义
- [ ] 财务专属界面具体内容
- [ ] 各审批节点驳回规则
- [ ] 发票+付款子流程详细拆解

---

## § 9 施工管理补充事项

### 9.1 区域结构

四层树 + 部位细化：楼栋 → 楼层 → 户 → 房间（客厅/厨房/阳台/厕所等）

### 9.2 工人文件存储

现有数据模型缺少实际文件保存字段，需补充：身份证扫描件、证书原件、合同扫描件、其他附件的存储路径。

### 9.3 工资发放确认

计算完成后需要确认/审批步骤，具体流程待补充。

### 9.4 考勤与工资挂钩

发放工资前必须核对考勤天数，考勤数据作为工资计算输入依据。

### 9.5 工资计算细化

用户后续提供实际工资表 Excel 样本，届时按真实表格结构调整数据模型和计算逻辑。

---

## § 10 实施分期

### V1 — 核心流程

| 模块 | 菜单归属 |
|------|---------|
| 首页（总览面板） | 首页 |
| 项目列表+详情 | 项目信息 |
| 分供方资料库 | 基础信息 |
| 发票识别+校对（四阶段） | 资金管理 |
| 开票因子计算器 | 资金管理 |
| 送货单识别 | 乙供材管理 |
| 单价对比 | 乙供材管理 |

### V2 — 施工管理 + 合同 + 财务

| 模块 | 菜单归属 |
|------|---------|
| 班组管理 | 基础信息 |
| 工人信息 | 基础信息 |
| 工程量矩阵 | 分包及人工 |
| 工资核算 | 分包及人工 |
| 考勤管理 | 分包及人工 |
| 分包合同/罚扣/结算/变洽签 | 分包及人工 |
| 采购合同 | 乙供材管理 |
| 主合同管理全部子模块 | 主合同管理 |
| 资金管理待设计子模块 | 资金管理 |

> 暂定分期，后续大框架敲定后调整。

---

## § 11 决策索引

| # | 决策 | 结论 | 状态 |
|---|------|------|------|
| 01 | Nuxt 渲染模式 | `ssr: false` SPA | ✅ |
| 02 | 设计语言方向 | Claude Design 为基准 | ✅ |
| 03 | 模块分期 | V1 核心流程 / V2 施工管理 | ✅ |
| 04 | 待调整项 | 分供方流转/区域/工人/工资 | 待补充 |
| 05 | 表格方案 | vxe-table | ✅ |
| 06 | 数据持久化 | 全部 SQLite | ✅ |
| 07 | OCR 架构 | 云VL优先 + 本地双轨 | ✅ |
| 08 | CSS 方案 | UnoCSS | ✅ |
| 09 | 目录结构 | 按 V4 导航更新 | 草稿 |
| 10 | 导航结构 | 7个一级菜单 | ✅ |
| 11 | 导航细化 | 基础信息含分供方+班组+工人 | ✅ |
