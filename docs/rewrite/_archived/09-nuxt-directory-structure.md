---
decision: 09
status: draft
date: 2026-06-26
updated: 2026-06-26
---

# 决策 09：Nuxt 目录结构 — 按 V4 导航结构更新

## 组织原则

- `pages/` 只做路由映射和布局，不写业务逻辑
- `components/` 按业务域分子目录，Nuxt auto-import 自动注册
- `lib/` 保持零 Vue 依赖，纯函数/类，方便测试
- `composables/` 放 Vue 响应式逻辑
- `stores/` Pinia store 作为 SQLite 的内存缓存层

---

## 导航菜单（7 个一级）

```
1. 首页               → /
2. 项目信息           → /project
3. 基础信息           → /base
   ├ 分供方            → /base/supplier
   ├ 班组              → /base/crew
   └ 工人              → /base/worker
4. 资金管理           → /finance
   ├ 发票识别          → /finance/invoice
   ├ 开票因子          → /finance/invoice/factor
   ├ 开票申请          → /finance/billing         (待设计)
   ├ 收款登记          → /finance/receipt          (待设计)
   ├ 收票登记          → /finance/ticket           (待设计)
   ├ 付款申请          → /finance/payment          (待设计)
   ├ 费用报销          → /finance/reimbursement    (待设计)
   └ 支付记录          → /finance/records          (待设计)
5. 主合同管理         → /contract
   ├ 施工合同          → /contract/construction    (待设计)
   ├ 甲方报量          → /contract/measurement     (待设计)
   ├ 甲方罚扣          → /contract/penalty         (待设计)
   ├ 甲方变洽签        → /contract/change-order    (待设计)
   ├ 竣工验收          → /contract/acceptance       (待设计)
   ├ 最终结算          → /contract/settlement       (待设计)
   └ 保修到期确认      → /contract/warranty         (待设计)
6. 分包及人工         → /subcontract
   ├ 分包合同          → /subcontract/contract     (待设计)
   ├ 项目罚扣          → /subcontract/penalty      (待设计)
   ├ 分包结算          → /subcontract/settlement   (待设计)
   ├ 变洽签            → /subcontract/change-order (待设计)
   ├ 工程量管理        → /subcontract/quantity
   ├ 工资核算          → /subcontract/payroll
   └ 考勤管理          → /subcontract/attendance
7. 乙供材管理         → /material
   ├ 采购合同          → /material/contract        (待设计)
   ├ 送货单识别        → /material/delivery
   └ 单价对比          → /material/price
```

---

## pages/

```
pages/
├── index.vue                                   # 首页 — 在建工程总览面板

├── project/
│   ├── index.vue                               # 项目列表
│   └── [id].vue                                # 项目详情

├── base/
│   ├── supplier/
│   │   ├── index.vue                           # 分供方列表
│   │   └── [id].vue                            # 分供方详情/对账
│   ├── crew/
│   │   ├── index.vue                           # 班组列表
│   │   └── [id].vue                            # 班组详情（配置/单价/工人）
│   └── worker/
│       ├── index.vue                           # 工人列表
│       └── [id].vue                            # 工人详情（证书/区域/工资/考勤）

├── finance/
│   ├── invoice/
│   │   ├── index.vue                           # 发票识别（四阶段）
│   │   ├── [id].vue                            # 发票详情编辑
│   │   └── factor.vue                          # 开票因子计算器
│   ├── billing.vue                             # 开票申请 (待设计)
│   ├── receipt.vue                             # 收款登记 (待设计)
│   ├── ticket.vue                              # 收票登记 (待设计)
│   ├── payment.vue                             # 付款申请 (待设计)
│   ├── reimbursement.vue                       # 费用报销 (待设计)
│   └── records.vue                             # 支付记录 (待设计)

├── contract/
│   ├── construction.vue                        # 施工合同 (待设计)
│   ├── measurement.vue                         # 甲方报量 (待设计)
│   ├── penalty.vue                             # 甲方罚扣 (待设计)
│   ├── change-order.vue                        # 甲方变洽签 (待设计)
│   ├── acceptance.vue                          # 竣工验收 (待设计)
│   ├── settlement.vue                          # 最终结算 (待设计)
│   └── warranty.vue                            # 保修到期确认 (待设计)

├── subcontract/
│   ├── contract.vue                            # 分包合同 (待设计)
│   ├── penalty.vue                             # 项目罚扣 (待设计)
│   ├── settlement.vue                          # 分包结算 (待设计)
│   ├── change-order.vue                        # 变洽签 (待设计)
│   ├── quantity/
│   │   ├── index.vue                           # 工程量管理（矩阵）
│   │   └── [projectId]/
│   │       └── [crewId].vue                    # 班组工程量明细
│   ├── payroll/
│   │   ├── index.vue                           # 工资管理
│   │   └── [projectId]/
│   │       └── [...slug].vue                   # 工资明细（项目/班组/工人）
│   └── attendance.vue                          # 考勤管理

└── material/
    ├── contract.vue                            # 采购合同 (待设计)
    ├── delivery.vue                            # 送货单识别
    └── price.vue                               # 单价对比
```

---

## components/

### layout/ — 布局组件

```
components/layout/
├── AppSidebar.vue              # 侧边栏（7个一级菜单+分组折叠）
├── AppTopbar.vue               # 顶栏
├── MobileTabBar.vue            # 手机端底部 tab bar
└── StickyToolbar.vue           # 通用 sticky 操作栏
```

### ui/ — shadcn-vue 基础 + 业务通用

```
components/ui/
├── (shadcn-vue CLI 生成的基础组件)
├── DataListToolbar.vue
├── SearchInput.vue
├── StatCard.vue
├── StatusChip.vue
├── FilterPill.vue
├── StageTab.vue
├── Panel.vue
├── IconButton.vue
└── TableActions.vue
```

### 业务域组件

```
components/
├── home/                       # 首页面板
│   └── ProjectDashboard.vue    # 项目状况面板（收付款/工程量/税额）
├── invoice/                    # 发票
│   ├── InvoiceUpload.vue
│   ├── InvoicePreview.vue
│   ├── InvoiceRow.vue
│   ├── FieldsTable.vue
│   ├── InvoicePrintPanel.vue
│   ├── InvoiceLedgerPanel.vue
│   ├── InvoiceLedgerViewer.vue
│   └── ExportPanel.vue
├── delivery/                   # 送货单
│   ├── DeliveryTree.vue
│   ├── PartitionBar.vue
│   ├── UploadZone.vue
│   ├── FileCard.vue
│   └── SaveToStorePanel.vue
├── supplier/                   # 分供方
│   └── SupplierFormDialog.vue
├── project/                    # 项目
│   ├── ProjectFormDialog.vue
│   └── ProjectCombobox.vue
├── worker/                     # 工人
│   └── WorkerFormDialog.vue
├── crew/                       # 班组
│   └── (班组表单/配置/单价编辑)
├── quantity/                   # 工程量
│   └── (矩阵可视化/区域树/分项管理)
├── payroll/                    # 工资
│   └── (计算/发放确认/考勤核对)
└── shared/                     # 跨域
    ├── OcrGateDialog.vue
    ├── ProblemDialog.vue
    ├── HoverZoom.vue
    ├── SettingsDialog.vue
    └── ToastHost.vue
```

---

## composables/

```
composables/
├── useDb.ts                    # SQLite 统一封装
├── useOcr.ts                   # OCR 调用（云VL + 本地）
├── useExcelIO.ts               # Excel 导入导出
├── useListPage.ts              # CRUD + 搜索 + 分页
├── useToast.ts                 # Toast 通知
├── useSettings.ts              # 设置读写
├── usePdf.ts                   # PDF 渲染/文本/旋转
└── useUpload.ts                # 文件上传
```

---

## stores/ — Pinia

```
stores/
├── app.ts                      # 全局 UI 状态
├── project.ts                  # 施工项目
├── supplier.ts                 # 分供方
├── crew.ts                     # 班组
├── worker.ts                   # 工人
├── invoice.ts                  # 发票
├── delivery.ts                 # 送货单
├── recognized.ts               # 识别明细库
├── quantity.ts                 # 工程量
├── payroll.ts                  # 工资
├── attendance.ts               # 考勤
└── (待设计: contract, subcontract, finance 相关 stores)
```

---

## lib/ — 纯逻辑

```
lib/
├── ocr/                        # OCR 引擎
│   ├── ocr.ts                  # PP-OCRv6 本地推理
│   ├── ocr-vl.ts               # 云 API
│   ├── credential-ocr.ts       # 证照 OCR
│   └── vl-parse.ts             # VL 结果解析
├── invoice/                    # 发票逻辑
│   ├── invoice-parse.ts
│   ├── invoice-excel.ts
│   ├── invoice-layout.ts
│   ├── invoice-ledger.ts
│   ├── invoice-filename.ts
│   ├── invoice-dedupe.ts
│   ├── invoice-export-package.ts
│   └── invoice-reimburse.ts
├── delivery/                   # 送货单逻辑
│   ├── delivery-tree.ts
│   ├── parse.ts
│   └── naming.ts
├── db/                         # 数据库
│   ├── schema.ts               # SQLite 建表+迁移
│   ├── supplier-db.ts
│   ├── project-db.ts
│   ├── worker-db.ts
│   ├── recognized-io.ts
│   └── posted-invoice-io.ts
├── io/                         # I/O
│   ├── pdf.ts
│   ├── pdftext.ts
│   ├── upload.ts
│   ├── export.ts
│   ├── excel.ts
│   ├── open-external.ts
│   └── tauri.ts
└── util/                       # 工具
    ├── chinese-amount.ts
    ├── price-compare.ts
    ├── print-layout.ts
    └── format.ts
```

---

## 其他顶层

```
public/
├── ocr-models-v6/              # PP-OCRv6 ONNX 模型
├── ort/                        # onnxruntime-web wasm (开发期)
├── pdf.worker.min.mjs
└── cmaps/

src-tauri/                      # Tauri Rust 后端
├── tauri.conf.json
├── src/main.rs
└── Cargo.toml

nuxt.config.ts                  # Nuxt SPA + UnoCSS + Pinia + vxe-table
uno.config.ts                   # Claude Design 令牌 + shortcuts + icons
```

---

## 待补充

- [ ] 首页面板具体内容
- [ ] 资金管理各子模块详细设计
- [ ] 主合同管理各子模块详细设计
- [ ] 分包合同/罚扣/结算/变洽签详细设计
- [ ] 采购合同详细设计
- [ ] 工程量管理界面完善
- [ ] 中间件 / 插件 / 测试目录
