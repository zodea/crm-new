# 架构规范 — 技术栈·目录·数据·OCR

> 重写后的技术架构唯一参考。

---

## § 1 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 框架 | Nuxt 3 | `ssr: false` SPA 模式，约定式路由+auto-import |
| 语言 | TypeScript | 全量 |
| 桌面壳 | Tauri 2 | Rust + webview，Windows NSIS 安装包 |
| UI 组件 | shadcn-vue | UnoCSS 适配方案 |
| CSS | UnoCSS | shortcuts + icons preset + attributify |
| 表格 | vxe-table | 主题对齐 DESIGN-SYSTEM.md 色彩 |
| 状态 | Pinia | SQLite 的内存缓存层 |
| 交互 | VueUse | 优先使用成熟 composable |
| 持久化 | SQLite | tauri-plugin-sql，全模块统一 |
| OCR 主 | PaddleOCR-VL | 云 API，优先使用 |
| OCR 备 | PP-OCRv6 Small | 开发期 onnxruntime-web，生产期 Rust ort |
| 图标 | Lucide | UnoCSS Icons preset + @iconify-json/lucide |

---

## § 2 导航结构（7 个一级）

```
1. 首页             /
2. 项目信息         /project
   ├ 项目列表         /project
   ├ 项目详情         /project/:id
   ├ 项目×分供方详情  /project/:pid/supplier/:sid
   └ 项目分供方导入    /project/:pid/supplier/import
3. 基础信息         /base
   ├ 分供方          /base/supplier
   │  ├ 分供方列表     /base/supplier
   │  └ 分供方详情     /base/supplier/:id
   ├ 班组            /base/crew
   └ 工人            /base/worker
4. 资金管理         /finance
   ├ 发票识别        /finance/invoice
   ├ 开票因子        /finance/invoice/factor
   ├ 开票申请        /finance/billing          (待设计)
   ├ 收款登记        /finance/receipt           (待设计)
   ├ 收票登记        /finance/ticket            (待设计)
   ├ 付款申请        /finance/payment           (待设计)
   ├ 费用报销        /finance/reimbursement     (待设计)
   └ 支付记录        /finance/records           (待设计)
5. 主合同管理       /contract
   ├ 施工合同        /contract/construction     (待设计)
   ├ 甲方报量        /contract/measurement      (待设计)
   ├ 甲方罚扣        /contract/penalty          (待设计)
   ├ 甲方变洽签      /contract/change-order     (待设计)
   ├ 竣工验收        /contract/acceptance       (待设计)
   ├ 最终结算        /contract/settlement       (待设计)
   └ 保修到期确认    /contract/warranty          (待设计)
6. 分包及人工       /subcontract
   ├ 分包合同        /subcontract/contract      (待设计)
   ├ 项目罚扣        /subcontract/penalty       (待设计)
   ├ 分包结算        /subcontract/settlement    (待设计)
   ├ 变洽签          /subcontract/change-order  (待设计)
   ├ 工程量管理      /subcontract/quantity
   ├ 工资核算        /subcontract/payroll
   └ 考勤管理        /subcontract/attendance
7. 乙供材管理       /material
   ├ 采购合同        /material/contract         (待设计)
   ├ 送货单识别      /material/delivery
   └ 单价对比        /material/price
```

分组逻辑: 按业务类型，不按合同类型。各业务域自带各自的合同。

### 2.1 页面路由集中表

| 页面 | 路由 | Nuxt 页面文件 | 页面文档 |
|---|---|---|---|
| 分供方列表 | `/base/supplier` | `pages/base/supplier/index.vue` | `docs/rewrite/pages/base-supplier.md` |
| 分供方详情 | `/base/supplier/:id` | `pages/base/supplier/[id].vue` | `docs/rewrite/pages/base-supplier.md` |
| 项目×分供方详情 | `/project/:pid/supplier/:sid` | `pages/project/[pid]/supplier/[sid].vue` | `docs/rewrite/pages/project-supplier.md` |
| 项目分供方导入 | `/project/:pid/supplier/import` | `pages/project/[pid]/supplier/import.vue` | `docs/rewrite/pages/project-supplier.md` |
| 采购合同 | `/material/contract` | `pages/material/contract.vue` | 待拆分 |
| 付款申请 | `/finance/payment` | `pages/finance/payment.vue` | 待拆分 |
| 收票登记 | `/finance/ticket` | `pages/finance/ticket.vue` | 待拆分 |

---

## § 3 目录结构

```
pages/
├── index.vue                           # 首页
├── project/
│   ├── index.vue                       # 项目列表
│   ├── [id].vue                        # 项目详情
│   └── [pid]/
│       └── supplier/
│           ├── [sid].vue               # 项目×分供方详情
│           └── import.vue              # 项目分供方导入
├── base/
│   ├── supplier/
│   │   ├── index.vue                   # 分供方列表
│   │   └── [id].vue                    # 分供方详情
│   ├── crew/ (index + [id])            # 班组
│   └── worker/ (index + [id])          # 工人
├── finance/
│   ├── invoice/ (index + [id] + factor)# 发票
│   └── (billing/receipt/ticket/payment/reimbursement/records).vue
├── contract/
│   └── (construction/measurement/penalty/change-order/acceptance/settlement/warranty).vue
├── subcontract/
│   ├── (contract/penalty/settlement/change-order).vue
│   ├── quantity/ (index + [pid]/[cid]) # 工程量
│   ├── payroll/ (index + [...slug])    # 工资
│   └── attendance.vue                  # 考勤
└── material/
    ├── contract.vue                    # 采购合同
    ├── delivery.vue                    # 送货单
    └── price.vue                       # 单价对比

components/
├── layout/     # AppSidebar, AppTopbar, MobileTabBar, StickyToolbar
├── ui/         # shadcn-vue + SearchInput, StatCard, StatusChip, FilterPill, SegTab, EntityLink, MoneyLink, IconButton, TableActions（DataListToolbar 已删 #110 阶段⑥）
├── home/       # ProjectDashboard
├── invoice/    # InvoiceUpload, InvoicePreview, InvoiceRow, FieldsTable, InvoicePrintPanel, InvoiceLedgerPanel, InvoiceLedgerViewer, ExportPanel
├── delivery/   # DeliveryTree, PartitionBar, UploadZone, FileCard, SaveToStorePanel
├── supplier/   # SupplierFormDialog, SupplierCredentialPanel, SupplierSummaryTabs, SupplierProjectSummary
├── project/    # ProjectFormDialog, ProjectCombobox, ProjectInfoCard
├── worker/     # WorkerFormDialog
├── crew/       # (待展开)
├── quantity/   # (矩阵可视化·待展开)
├── payroll/    # (待展开)
└── shared/     # OcrGateDialog, ProblemDialog, HoverZoom, SettingsDialog, ToastHost

composables/    # useDb, useOcr, useExcelIO, useListPage, useToast, useSettings, usePdf, useUpload
stores/         # app, project, supplier, project-supplier, crew, worker, invoice, delivery, recognized, quantity, payroll, attendance
lib/
├── ocr/        # ocr.ts, ocr-vl.ts, credential-ocr.ts, vl-parse.ts
├── invoice/    # invoice-parse/excel/layout/ledger/filename/dedupe/export-package/reimburse
├── delivery/   # delivery-tree.ts, parse.ts, naming.ts
├── db/         # schema.ts, supplier-db.ts, supplier-credential-db.ts, project-supplier-db.ts, project-db.ts, worker-db.ts, recognized-io.ts, posted-invoice-io.ts
├── io/         # pdf.ts, pdftext.ts, upload.ts, export.ts, excel.ts, open-external.ts, tauri.ts
└── util/       # chinese-amount.ts, price-compare.ts, print-layout.ts, format.ts
```

---

## § 4 数据持久化

全模块 SQLite（tauri-plugin-sql）。Pinia store 启动时从 SQLite 加载，变更时写回。

- **全局实体关系、外键索引、建表顺序**: → `DATABASE.md`
- **设计进度总览、数据结构汇总**: → `TODO.md`
- **红圈CRM内容区交互模式**: → `CRM-PATTERNS.md`
- 旧数据迁移: 首次启动检测 localStorage 旧数据，自动导入 SQLite → 详见 `DATABASE.md § 7`
- dev 模式: sql.js (wasm) 做 fallback，无需 Tauri 环境

---

## § 5 OCR 架构

```
useOcr() 统一接口
  ├─ 已配置 API? → PaddleOCR-VL 云端（优先）
  └─ 未配置/不可用 → PP-OCRv6 Small 本地
                      ├─ 开发期: onnxruntime-web (WebGPU/wasm)
                      └─ 生产期: Tauri Rust ort crate
```

---

## § 6 分期

**V1**: 首页 + 项目信息 + 分供方(含项目×分供方) + 发票识别(四阶段) + 开票因子 + 送货单识别 + 单价对比

页面设计文档（`docs/rewrite/pages/`）：
- `homepage-dashboard.md` — 首页
- `project-info.md` — 项目列表+详情(9Tab经营驾驶舱)
- `base-supplier.md` — 分供方主数据+证照+跨项目只读汇总
- `project-supplier.md` — 项目×分供方(状态流转+源单据跳转+结算锁定)
- `finance-invoice.md` — 发票识别(四阶段)+开票因子计算器
- `material-delivery.md` — 送货单识别(上传→整理→识别→导出)

**V2**: 班组 + 工人 + 工程量 + 工资 + 考勤 + 分包合同相关 + 采购合同 + 主合同管理 + 资金管理待设计子模块

页面设计文档：
- `base-worker.md` — 工人信息(列表+详情4Tab)
- `base-crew.md` — 班组管理(列表+详情+项目配置+模板)
- `subcontract-quantity.md` — 工程量管理(区域结构+矩阵可视化)
- `subcontract-payroll.md` — 工资核算(计件/计时)+考勤
