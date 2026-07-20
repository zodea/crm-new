# 设计进度总览 — 界面·数据结构·文档状态

> 每完成一个模块的设计文档，将状态从「待设计」改为「已确认」。  
> 最后更新: 2026-07-18（首页旧蓝本与响应式口径勘误）

---

## § 1 导航结构 — 7 个一级模块

### 1.1 首页

| 页面 | 路由 | 设计文档 | 状态 |
|---|---|---|---|
| Dashboard | `/` | `homepage-dashboard.md` / `schedule-progress.md §7.1` | ⚠️ 旧五指标四图表蓝本已废弃，按当前 app 甘特由 #7 重写 |

### 1.2 项目信息

| 页面 | 路由 | 设计文档 | 状态 |
|---|---|---|---|
| 项目列表 | `/project` | `project-info.md` | ✅ 已确认 |
| 项目详情（9Tab经营驾驶舱） | `/project/:id` | `project-info.md` | ✅ 已确认 |
| 项目×分供方详情 | `/project/:pid/supplier/:sid` | `project-supplier.md` | ✅ 已确认 |
| 项目分供方导入 | `/project/:pid/supplier/import` | `project-supplier.md` | ✅ 已确认 |

### 1.3 基础信息

| 页面 | 路由 | 设计文档 | 状态 |
|---|---|---|---|
| 分供方列表 | `/base/supplier` | `base-supplier.md` | ✅ 已确认 |
| 分供方详情（6Tab） | `/base/supplier/:id` | `base-supplier.md` | ✅ 已确认 |
| 班组管理（列表+详情+项目配置） | `/base/crew` · `/base/crew/:id` | `base-crew.md` | ✅ 已确认 |
| 工人信息（列表+详情4Tab+亲属） | `/base/worker` · `/base/worker/:id` | `base-worker.md` | ✅ 已确认 |

### 1.4 资金管理

| 页面 | 路由 | 设计文档 | 状态 |
|---|---|---|---|
| 发票识别（三阶段重构） | `/finance/invoice` | `finance-invoice.md` | ✅ 已确认（重写） |
| 开票因子计算器 | `/finance/invoice/factor` | `finance-invoice.md` | ✅ 已确认 |
| 开票申请 | `/finance/billing` | `finance-billing.md` | ⬜ 待设计 |
| 收款登记 | `/finance/receipt` | `finance-receipt.md` | ⬜ 待设计 |
| 收票登记（查已归档发票） | `/finance/ticket` | — | ⚠️ ADR 0001：并入发票台账（`invoices` 单表），不再单独建表；项目详情「收票登记」Tab = 查已归档 invoices |
| 付款申请（列表+详情） | `/finance/payment` | `finance-payment.md` | ✅ 8 类型字段与结算/发票勾稽已定稿，待 Vue/SQLite 实装 |
| 费用报销 | `/finance/reimbursement` | `finance-reimbursement.md` | ⬜ 待设计 |
| 支付记录 | `/finance/records` | `finance-records.md` | ⬜ 待设计 |

### 1.5 主合同管理

| 页面 | 路由 | 设计文档 | 状态 |
|---|---|---|---|
| 施工合同 | `/contract/construction` | `contract-construction.md` | ⬜ 待设计 |
| 甲方报量 | `/contract/measurement` | `contract-measurement.md` | ⬜ 待设计 |
| 甲方罚扣 | `/contract/penalty` | `contract-penalty.md` | ⬜ 待设计 |
| 甲方变洽签 | `/contract/change-order` | `contract-change-order.md` | ⬜ 待设计 |
| 竣工验收 | `/contract/acceptance` | `contract-acceptance.md` | ⬜ 待设计 |
| 最终结算 | `/contract/settlement` | `contract-settlement.md` | ⬜ 待设计 |
| 保修到期确认 | `/contract/warranty` | `contract-warranty.md` | ⬜ 待设计 |

### 1.6 分包及人工

| 页面 | 路由 | 设计文档 | 状态 |
|---|---|---|---|
| 分包合同 | `/subcontract/contract` | `subcontract-contract.md` | ⬜ 待设计 |
| 项目罚扣 | `/subcontract/penalty` | `subcontract-penalty.md` | ⬜ 待设计 |
| 分包结算 | `/subcontract/settlement` | `subcontract-settlement.md` | ⬜ 待设计 |
| 变洽签 | `/subcontract/change-order` | `subcontract-change-order.md` | ⬜ 待设计 |
| 工程量管理 | `/subcontract/quantity` | `subcontract-quantity.md` | ⬜ 待设计 |
| 工资核算 | `/subcontract/payroll` | `subcontract-payroll.md` | ⬜ 待设计 |
| 考勤管理 | `/subcontract/attendance` | `subcontract-attendance.md` | ⬜ 待设计 |

### 1.7 乙供材管理

| 页面 | 路由 | 设计文档 | 状态 |
|---|---|---|---|
| 采购合同（列表+详情+新建） | `/material/contract` | `material-contract.md` | 🟡 有效果图，待写文档 |
| 送货单识别 | `/material/delivery` | `material-delivery.md` | ✅ 已确认 |
| 单价对比 | `/material/price` | `material-price.md` | ✅ 已确认 |

### 1.8 统计

| 指标 | 数量 |
|---|---|
| ✅ 已确认 | 12 |
| 🟡 有效果图待写文档 | 3 |
| ⬜ 待设计 | 20 |
| **合计** | **35** |

---

## § 2 数据实体清单 — 6 大类 28 个实体

> ⛔ **本节及 §3 是早期快照，不再维护字段副本**。数据实体、外键与表名只以 `DATABASE.md` 为权威；已知废弃：`ticket_registrations`（ADR 0001）、`quantities` / `quantity_records`（ADR 0010 分层表）、`payroll_records`（工资三表）。

### 2.1 基础主数据（跨项目共享）

| 实体 | 表名 | PK | 关键字段 | 外键 | 设计文档 | 状态 |
|---|---|---|---|---|---|---|
| Project | `projects` | `id` | name, status, address, startDate, developer, manager, contractAmount | — | `project-info.md` | ✅ |
| Supplier | `suppliers` | `id` | name, aliases[], taxNo, supplierCategory, credentialStatus, approvalStatus | — | `base-supplier.md` | ✅ |
| SupplierCredential | `supplier_credentials` | `id` | category, fileName, filePath, ocrResult, ocrConfidence | → `suppliers.id` | `base-supplier.md` | ✅ |
| FileRef | `file_refs` | `id` | ownerType, ownerId, fileName, filePath, fileSize | 多态关联 | 共用 | ✅ |

### 2.2 项目关联实体

| 实体 | 表名 | PK | 关键字段 | 外键 | 设计文档 | 状态 |
|---|---|---|---|---|---|---|
| ProjectSupplier | `project_suppliers` | `id` | status(5态), reviewerId, note | → `projects.id` + `suppliers.id` | `project-supplier.md` | ✅ |
| Settlement | `settlements` | `id` | date, finalAmount, pdfFile, note | → `project_suppliers.id` | `project-supplier.md` | ✅ |
| PhaseTask | `phase_tasks` | `id` | name, status, startDate, endDate, progress | → `projects.id` | `project-info.md` | ✅ |

### 2.3 合同类

| 实体 | 表名 | PK | 关键字段 | 外键 | 设计文档 | 状态 |
|---|---|---|---|---|---|---|
| ConstructionContract | `construction_contracts` | `id` | name, contractNo, amount, taxRate, signDate, status | → `projects.id` | `contract-construction.md` | ⬜ |
| SupplementAgreement | `supplement_agreements` | `id` | name, amount, signDate | → `construction_contracts.id` | `contract-construction.md` | ⬜ |
| OwnerChangeOrder | `owner_change_orders` | `id` | changeNo, type, amount, status | → `projects.id` | `contract-construction.md` | ⬜ |
| ExpenditureContract | `expenditure_contracts` | `id` | name, contractNo, amount, taxRate, signDate, status, paymentMethod, contractType | → `projects.id` + `suppliers.id` | `contract-base.md` | ⬜ |
| ContractLineItem | `contract_line_items` | `id` | itemName, spec, brand, unit, unitPrice, quantity, taxAmount | → `expenditure_contracts.id` | `material-contract.md` | ⬜ |

### 2.4 资金管理类

| 实体 | 表名 | PK | 关键字段 | 外键 | 设计文档 | 状态 |
|---|---|---|---|---|---|---|
| InvoiceApplication | `invoice_applications` | `id` | invoiceType, amount, taxRate, taxAmount, status | → `projects.id` | `finance-billing.md` | ⬜ |
| ~~TicketRegistration~~ | ~~`ticket_registrations`~~ | — | **已废弃（ADR 0001）**：合并进 `invoices` 单表，收票登记 = 查已归档发票 | — | — | ⛔ |
| ReceiptRegistration | `receipt_registrations` | `id` | amount, receiptDate, payerName, status | → `projects.id` | `finance-receipt.md` | ⬜ |
| PaymentApplication | `payment_applications` + 两类真实分摊子表 | `id` | 以 DATABASE §2.4 与 ADR 0015 为准 | 以 DATABASE §3.3 为准 | `finance-payment.md` | ⬜ |
| CurrentReceipt | `current_receipts` | `id` | amount, date, counterparty | → `projects.id` | `finance-receipt.md` | ⬜ |
| CurrentPayment | `current_payments` | `id` | amount, date, counterparty | → `projects.id` | `finance-payment.md` | ⬜ |
| PaymentRecord | `payment_records` | `id` | amount, date, method, voucherNo | → `projects.id` | `finance-records.md` | ⬜ |

### 2.5 物资管理类

| 实体 | 表名 | PK | 关键字段 | 外键 | 设计文档 | 状态 |
|---|---|---|---|---|---|---|
| DeliveryRecord | `delivery_records` | `id` | deliveryDate, deliveryNo, items[], ocrResult | → `projects.id` + `suppliers.id` | `material-delivery.md` | ⬜ |
| PriceComparison | `price_comparisons` | `id` | materialName, unit, prices[] | → `projects.id` | `material-price.md` | ⬜ |

### 2.6 分包及人工类

| 实体 | 表名 | PK | 关键字段 | 外键 | 设计文档 | 状态 |
|---|---|---|---|---|---|---|
| Crew | `crews` | `id` | name, trade, contactName, contactPhone | — | `base-crew.md` | ✅ |
| CrewWorker | `crew_workers` | `id` | payMode, dailyWage, rentOverride, mgmtOverride, ratioOverride | → `crews.id` + `workers.id` | `base-crew.md` | ✅ |
| CrewProjectConfig | `crew_project_config` | `id` | defaultPayRatio, rentSubsidyEnabled/Price, mgmtFeeEnabled/Price | → `crews.id` + `projects.id` | `base-crew.md` | ✅ |
| CrewProjectItem | `crew_project_items` | `id` | itemName, unit, unitPrice, inRentSubsidy, inMgmtFee | → `crew_project_config.id` | `base-crew.md` | ✅ |
| Worker | `workers` | `id` | name, idCard, phone, familyGroupId, certs[], safetyEducation | — | `base-worker.md` | ✅ |
| ~~Quantity~~ | ~~`quantities` / `quantity_records`~~ | — | **已废弃（ADR 0010）**：量、户 × 工种责任、户 × 工序阶段完成分层，表名只看 DATABASE §2.6 | — | `subcontract-quantity.md` | ⛔ |
| ~~PayrollRecord~~ → 工资三表 | `wage_statements` / `wage_statement_lines` / `attendance_records`（~~旧 payroll_records~~） | `id` | 字段见 `DATABASE.md` §2.6 | → `projects.id` + `crews.id` + `workers.id` | `subcontract-payroll.md` | ⬜ |

### 2.7 统计

| 指标 | 数量 |
|---|---|
| ✅ 实体已定义 | 12 (Project, Supplier, SupplierCredential, FileRef, ProjectSupplier, Settlement, PhaseTask, Crew, CrewWorker, CrewProjectConfig, CrewProjectItem, Worker) |
| ⬜ 实体待定义 | 20 |
| **合计** | **32**（⚠️ 已过时，实体总数以 `DATABASE.md` 为准，含清单/变更/报量/送货单等已远超此数） |

---

## § 3 数据库设计 — 外键关联 + 建表顺序

> ⚠️ 以 `DATABASE.md` 为准；下方外键/建表顺序/索引仍含已废弃旧名（`ticket_registrations` / `quantity_records` / `payroll_records`），见 §2 顶部说明。

### 3.1 外键关联全景（25 条）

#### 核心关联

| 子表 | 外键字段 | 父表 | 关系 | 说明 |
|---|---|---|---|---|
| `project_suppliers` | `projectId` | `projects` | N:1 | 项目×分供方 |
| `project_suppliers` | `supplierId` | `suppliers` | N:1 | |
| `settlements` | `projectSupplierId` | `project_suppliers` | 1:1 | 每个关联最多一条结算 |
| `supplier_credentials` | `supplierId` | `suppliers` | N:1 | 分供方证照 |
| `phase_tasks` | `projectId` | `projects` | N:1 | 阶段任务 |

#### 合同关联

| 子表 | 外键字段 | 父表 | 关系 | 说明 |
|---|---|---|---|---|
| `construction_contracts` | `projectId` | `projects` | N:1 | 施工合同 → 项目 |
| `supplement_agreements` | `contractId` | `construction_contracts` | N:1 | 补充协议 → 施工合同 |
| `owner_change_orders` | `projectId` | `projects` | N:1 | 甲方变洽签 → 项目 |
| `expenditure_contracts` | `projectId` | `projects` | N:1 | 支出合同 → 项目 |
| `expenditure_contracts` | `supplierId` | `suppliers` | N:1 | 支出合同 → 分供方 |
| `contract_line_items` | `contractId` | `expenditure_contracts` | N:1 | 明细行 → 支出合同 |

#### 资金管理关联

| 子表 | 外键字段 | 父表 | 关系 | 说明 |
|---|---|---|---|---|
| `invoice_applications` | `projectId` | `projects` | N:1 | 开票 → 项目 |
| `ticket_registrations` | `projectId` | `projects` | N:1 | 收票 → 项目 |
| `ticket_registrations` | `supplierId` | `suppliers` | N:1 | 收票 → 分供方 |
| `ticket_registrations` | `contractId` | `expenditure_contracts` | N:1 | 收票 → 合同（可选） |
| `receipt_registrations` | `projectId` | `projects` | N:1 | 收款 → 项目 |
| `payment_applications` | `projectId` | `projects` | N:1 | 付款 → 项目 |
| `payment_applications` | `supplierId` | `suppliers` | N:1 | 付款 → 分供方 |
| `payment_applications` | `contractId` | `expenditure_contracts` | N:1 | 付款 → 合同（可选） |
| `current_receipts` | `projectId` | `projects` | N:1 | 往来收款 |
| `current_payments` | `projectId` | `projects` | N:1 | 往来付款 |
| `payment_records` | `projectId` | `projects` | N:1 | 支付记录 |
| `payment_records` | `paymentApplicationId` | `payment_applications` | N:1 | 支付 → 付款申请（可选） |

#### 分包人工关联

| 子表 | 外键字段 | 父表 | 关系 | 说明 |
|---|---|---|---|---|
| `workers` | `crewId` | `crews` | N:1 | 工人 → 班组 |
| `quantity_records` | `projectId` + `crewId` + `workerId` | `projects` + `crews` + `workers` | N:1 | 工程量 |
| `payroll_records` | `projectId` + `crewId` + `workerId` | `projects` + `crews` + `workers` | N:1 | 工资 |

#### 物资关联

| 子表 | 外键字段 | 父表 | 关系 | 说明 |
|---|---|---|---|---|
| `delivery_records` | `projectId` + `supplierId` | `projects` + `suppliers` | N:1 | 送货单 |
| `price_comparisons` | `projectId` | `projects` | N:1 | 单价对比 |

#### FileRef 多态关联

`file_refs` 通过 `ownerType` + `ownerId` 关联到以下实体：

| ownerType 值 | 关联实体 | 说明 |
|---|---|---|
| `phase_task` | PhaseTask | 阶段任务附件 |
| `supplier_credential` | SupplierCredential | 证照文件 |
| `project_supplier` | ProjectSupplier | 项目×分供方文件 |
| `settlement` | Settlement | 结算确认书 PDF |
| `expenditure_contract` | ExpenditureContract | 合同扫描件 |
| `payment_application` | PaymentApplication | 付款附件 |
| `ticket_registration` | TicketRegistration | 发票扫描件 |

### 3.2 SQLite 建表顺序（按外键依赖）

| 批次 | 表名 | 依赖 |
|---|---|---|
| **第1批** | `projects` · `suppliers` · `crews` | 无外键 |
| **第2批** | `supplier_credentials` · `project_suppliers` · `phase_tasks` · `construction_contracts` · `owner_change_orders` · `expenditure_contracts` · `invoice_applications` · `receipt_registrations` · `current_receipts` · `current_payments` · `payment_records` · `workers` | 依赖第1批 |
| **第3批** | `settlements` · `supplement_agreements` · `contract_line_items` · `ticket_registrations` · `payment_applications` · `delivery_records` · `price_comparisons` · `quantity_records` · `payroll_records` | 依赖第2批 |
| **第4批** | `file_refs` | 多态关联，无严格外键 |

### 3.3 索引建议

```sql
-- 按项目查单据
CREATE INDEX idx_project_suppliers_proj ON project_suppliers(projectId);
CREATE INDEX idx_project_suppliers_sup ON project_suppliers(supplierId);
CREATE INDEX idx_expenditure_contracts_proj ON expenditure_contracts(projectId);
CREATE INDEX idx_expenditure_contracts_sup ON expenditure_contracts(supplierId);
CREATE INDEX idx_payment_applications_proj ON payment_applications(projectId);
CREATE INDEX idx_payment_applications_sup ON payment_applications(supplierId);
CREATE INDEX idx_ticket_registrations_proj ON ticket_registrations(projectId);
CREATE INDEX idx_ticket_registrations_sup ON ticket_registrations(supplierId);
-- 证照/文件/合同子表
CREATE INDEX idx_supplier_credentials_sup ON supplier_credentials(supplierId);
CREATE INDEX idx_file_refs_owner ON file_refs(ownerType, ownerId);
CREATE INDEX idx_supplement_agreements_contract ON supplement_agreements(contractId);
CREATE INDEX idx_contract_line_items_contract ON contract_line_items(contractId);
CREATE INDEX idx_phase_tasks_proj ON phase_tasks(projectId);
```

---

## § 4 计算字段（不存储，实时 SQL 查询）

| 计算实体 | 用途 | 数据来源 |
|---|---|---|
| SupplierReadonlySummary | 分供方详情页跨项目汇总 | JOIN projects + project_suppliers + expenditure_contracts + payment_applications + ticket_registrations |
| ProjectSupplier.ComputedSummary | 项目×分供方合作概览 | JOIN expenditure_contracts + payment_applications + ticket_registrations + payment_records |
| Dashboard.MetricCards | ⛔ 旧首页5个指标卡片（不再属于当前首页验收） | 历史数据设想，若复用需另开功能入口 |
| Dashboard.MonthlyExpense | ⛔ 旧首页月度支出柱状图 | 历史数据设想，若复用需另开功能入口 |
| Dashboard.ExpensePie | ⛔ 旧首页支出构成饼图 | 历史数据设想，若复用需另开功能入口 |
| Dashboard.InvoiceTax | ⛔ 旧首页票据与税额 | 历史数据设想，若复用需另开功能入口 |
| Dashboard.ConstructionGantt | 首页施工进度甘特图 | GROUP BY building+floor+workType FROM quantity_records |
| Project.OperationData | 项目详情经营数据面板 | 同 Dashboard 但单项目 |

---

## § 5 已完成设计文档清单

| 文件 | 路径 | 内容 |
|---|---|---|
| 设计系统 | `DESIGN-SYSTEM.md` | 颜色·字体·组件·图标·动效 |
| 架构规范 | `ARCHITECTURE.md` | 技术栈·导航·目录·OCR |
| 数据库设计 | `DATABASE.md` | ER图·外键·建表顺序·计算字段·迁移 |
| CRM交互参考 | `CRM-PATTERNS.md` | 红圈CRM内容区布局模式（列表/详情/表单/弹窗） |
| 首页Dashboard | `pages/homepage-dashboard.md` + `pages/schedule-progress.md §7.1` | ⚠️ 当前 app 统一施工进度甘特；旧 5 指标 + 4 图表说明已废弃，#7 待重写 |
| 项目信息 | `pages/project-info.md` | 项目列表+详情(9Tab)+25子表 |
| 分供方主数据 | `pages/base-supplier.md` | 列表+详情(6Tab)+证照OCR |
| 项目×分供方 | `pages/project-supplier.md` | 工作台(6Tab)+状态机+结算 |
| 班组管理 | `pages/base-crew.md` | 列表+详情(全宽)+项目选择器+工人配置+扣罚只读 |
| 工人信息 | `pages/base-worker.md` | 列表+详情(4Tab+亲属右栏)+familyGroupId+证书 |
| 发票识别（重写） | `pages/finance-invoice.md` | 三阶段(文档管理/校对排版/台账)+Excel导入+多维导出 |

---

## § 6 待设计优先级

| 优先级 | 模块 | 目标文档 | 依赖 | 说明 |
|---|---|---|---|---|
| **P1** | 采购合同 | `material-contract.md` | ExpenditureContract, ContractLineItem | 已有效果图（列表+详情+新建），需写正式文档 |
| **P1** | 收票登记 | `finance-ticket.md` | TicketRegistration | 已有效果图，需写正式文档 |
| **P1** | 付款申请 | `finance-payment.md` | PaymentApplication, 两类分摊子表, PaymentRecord | 蓝本已定稿，待 Vue/SQLite 实装 |
| **P2** | 施工合同 | `contract-construction.md` | ConstructionContract, SupplementAgreement, OwnerChangeOrder | 主合同管理核心 |
| **P2** | 开票申请 | `finance-billing.md` | InvoiceApplication | 资金管理 |
| **P2** | 收款登记 | `finance-receipt.md` | ReceiptRegistration, CurrentReceipt | 资金管理 |
| **P3** | 分包合同 | `subcontract-contract.md` | — | 分包管理核心 |
| **P3** | 工程量管理 | `subcontract-quantity.md` | QuantityRecord | 与首页甘特图共享数据源 |
| **P3** | 工资核算 | `subcontract-payroll.md` | PayrollRecord | 已有旧版页面可参考 |
| ~~P4~~ | ~~班组 / 工人~~ | ~~`base-crew.md` / `base-worker.md`~~ | ~~Crew, Worker~~ | ✅ 已完成 |
| **P4** | 罚扣/结算/验收/保修等 | 各自独立文档 | — | 按需逐步设计 |
| **P4** | 费用报销 / 支付记录 | `finance-reimbursement.md` / `finance-records.md` | — | 按需设计 |
| **P4** | 考勤管理 | `subcontract-attendance.md` | — | 按需设计 |
