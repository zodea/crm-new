# 数据库设计 — 全局实体关系 + 外键索引 + 建表顺序

> 全模块 SQLite（tauri-plugin-sql）唯一参考。各页面文档定义业务字段，本文件管实体间关系。

---

## § 1 实体关系总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            核心实体关系图                                    │
│                                                                             │
│  ┌──────────┐    1:N    ┌─────────────────┐    N:1    ┌──────────┐         │
│  │ Project  │◄─────────│ ProjectSupplier  │─────────►│ Supplier │         │
│  └────┬─────┘           └───────┬─────────┘           └────┬─────┘         │
│       │                         │                          │               │
│       │ 1:N                     │ 1:1                      │ 1:N           │
│       ▼                         ▼                          ▼               │
│  ┌──────────┐           ┌──────────────┐           ┌────────────────┐     │
│  │PhaseTask │           │ Settlement   │           │SupplierCred.   │     │
│  └──────────┘           └──────────────┘           └────────────────┘     │
│       │                                                                     │
│       │ 1:N                                                                 │
│       ▼                                                                     │
│  ┌──────────┐                                                               │
│  │ FileRef  │ (共用文件引用，多个实体引用)                                     │
│  └──────────┘                                                               │
│                                                                             │
│  ════════════════════════════════════════════════════════════════════════    │
│                                                                             │
│       Project 1:N 以下所有业务单据（通过 projectId 关联）                      │
│       Supplier 通过 ProjectSupplier 间接关联以下单据                          │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│  │ConstructionCont. │  │SupplementAgree.  │  │OwnerChangeOrder │         │
│  │  施工合同          │  │  补充协议          │  │  甲方变洽签       │         │
│  │  projectId → Proj │  │  contractId → CC │  │  projectId → Proj│         │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘         │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│  │ExpenditureContr. │  │InvoiceApplication│  │TicketRegistration│         │
│  │  支出合同          │  │  开票申请          │  │  收票登记         │         │
│  │  projectId → Proj │  │  projectId → Proj │  │  projectId → Proj│         │
│  │  supplierId → Sup │  │                    │  │  supplierId → Sup│         │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘         │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│  │ReceiptRegistr.   │  │PaymentApplication│  │CurrentReceipt    │         │
│  │  收款登记          │  │  付款申请          │  │  往来收款         │         │
│  │  projectId → Proj │  │  projectId → Proj │  │  projectId → Proj│         │
│  └──────────────────┘  │  supplierId → Sup │  └──────────────────┘         │
│                         │  contractId → EC  │                               │
│  ┌──────────────────┐  └──────────────────┘  ┌──────────────────┐         │
│  │CurrentPayment    │                         │PaymentRecord     │         │
│  │  往来付款          │                         │  支付记录         │         │
│  │  projectId → Proj │                         │  projectId → Proj│         │
│  └──────────────────┘                         └──────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 施工进度线（工期 × 工程量，2026-07 新增）

```
projects ─1:N→ schedule_groups ═N:M═ buildings ─1:N→ floors ─1:N→ units ─1:N→ rooms
    │            (schedule_group_buildings)                                     │
    ├─1:N→ schedule_tasks（WBS: project→group→task, parentId 自关联）           │
    │        ├─ N:M → task_dependencies（FS/SS/FF/SF + lag）                    │
    │        └─ 1:N → task_item_map ─(itemName)→ items ─1:N→ quantities ────────┘
    │                  实际完成率 = 分组内该分项已完成(completedMonth非空)房间 / 总房间
    └─1:N→ target_costs ─1:N→ target_cost_items（costCategory: 人工/材料/机械/其他）
```

---

## § 2 全部实体清单

### 2.1 基础主数据（跨项目共享）

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| Project | `projects` | `id` | `project-info.md` |
| Supplier | `suppliers` | `id` | `base-supplier.md` |
| SupplierCredential | `supplier_credentials` | `id` | `base-supplier.md` |
| FileRef | `file_refs` | `id` | 共用 |
| BankCode | `bank_codes` | `id` | `base-worker.md` §五（银行行号字典，内置 seed，无外键） |

### 2.2 项目关联实体

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| ProjectSupplier | `project_suppliers` | `id` | `project-supplier.md` |
| Settlement | `settlements` | `id` | `project-supplier.md` |
| PhaseTask | `phase_tasks` | `id` | `project-info.md`（阶段资料/手续 checklist；**非排程**，排程工序见 §2.7 `schedule_tasks`） |

### 2.3 合同类（通用基础 + 类型定制）

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| ConstructionContract | `construction_contracts` | `id` | `contract-construction.md` |
| SupplementAgreement | `supplement_agreements` | `id` | `contract-construction.md` |
| OwnerChangeOrder | `owner_change_orders` | `id` | `contract-construction.md` |
| ExpenditureContract | `expenditure_contracts` | `id` | `contract-base.md` + 类型文档 |
| ContractLineItem | `contract_line_items` | `id` | `material-contract.md` |

### 2.4 资金管理类

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| InvoiceApplication | `invoice_applications` | `id` | `finance-billing.md`（待设计） |
| TicketRegistration | `ticket_registrations` | `id` | `finance-ticket.md`（待设计） |
| ReceiptRegistration | `receipt_registrations` | `id` | `finance-receipt.md`（待设计） |
| PaymentApplication | `payment_applications` | `id` | `finance-payment.md`（待设计） |
| CurrentReceipt | `current_receipts` | `id` | `finance-receipt.md`（待设计） |
| CurrentPayment | `current_payments` | `id` | `finance-payment.md`（待设计） |
| PaymentRecord | `payment_records` | `id` | `finance-records.md`（待设计） |

### 2.5 物资管理类

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| DeliveryRecord | `delivery_records` | `id` | `material-delivery.md`（待设计） |
| PriceComparison | `price_comparisons` | `id` | `material-price.md`（待设计） |

### 2.6 分包及人工类

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| Crew | `crews` | `id` | `base-crew.md` |
| CrewWorker | `crew_workers` | `id` | `base-crew.md` |
| CrewProjectConfig | `crew_project_config` | `id` | `base-crew.md` |
| CrewProjectItem | `crew_project_items` | `id` | `base-crew.md` |
| Worker | `workers` | `id` | `base-worker.md` |
| WorkerCert | `worker_certs` | `id` | `base-worker.md` |
| PenaltyRecord | `penalty_records` | `id` | `base-crew.md` / `base-worker.md` |
| Item | `items` | `id` | `subcontract-quantity.md`（分项定义：项目×班组，名称/单位） |
| Quantity | `quantities` | `id` | `subcontract-quantity.md`（工程量：分项×房间×工人，contractQty/fieldQty/provisionalQty/**completedMonth**） |
| PayrollRecord | `payroll_records` | `id` | `subcontract-payroll.md`（待细化） |

### 2.7 施工进度类（工期 × 工程量主线）

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| Building | `buildings` | `id` | `subcontract-quantity.md`（区域树·楼栋） |
| Floor | `floors` | `id` | `subcontract-quantity.md`（楼层） |
| Unit | `units` | `id` | `subcontract-quantity.md`（户） |
| Room | `rooms` | `id` | `subcontract-quantity.md`（房间） |
| ScheduleGroup | `schedule_groups` | `id` | `schedule-progress.md`（楼栋分组） |
| ScheduleGroupBuilding | `schedule_group_buildings` | `id` | `schedule-progress.md`（分组×楼栋） |
| ScheduleTask | `schedule_tasks` | `id` | `schedule-progress.md`（工序/WBS） |
| TaskDependency | `task_dependencies` | `id` | `schedule-progress.md`（前后置依赖） |
| TaskItemMap | `task_item_map` | `id` | `schedule-progress.md`（工序↔分项） |

> 进度实际完成率复用 `quantities.completedMonth`，不新增录入口；工序 `hasQty=1` 自动取工程量、`=0` 手动填。详见 `schedule-progress.md` §五、§六。

### 2.8 目标成本类（成本控制基线）

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| TargetCost | `target_costs` | `id` | `schedule-progress.md` §六（项目目标成本，isBaseline 版本化） |
| TargetCostItem | `target_cost_items` | `id` | `schedule-progress.md` §六（科目行：人工/材料/机械/其他，可细到分项） |

```sql
CREATE TABLE target_costs (
  id          TEXT PRIMARY KEY,
  projectId   TEXT NOT NULL,        -- → projects.id
  name        TEXT,                 -- 版本名（"投标预算"/"开工基线"）
  isBaseline  INTEGER DEFAULT 1,    -- 1=当前对比基线（一项目仅一条为 1）
  totalAmount REAL,                 -- 冗余合计
  note TEXT, createdAt TEXT, updatedAt TEXT, deleted_at TEXT
);

CREATE TABLE target_cost_items (
  id           TEXT PRIMARY KEY,
  targetCostId TEXT NOT NULL,       -- → target_costs.id
  costCategory TEXT NOT NULL,       -- '人工' | '材料' | '机械' | '其他'
  itemName     TEXT,                -- 可选：细到分项（墙砖/地砖…），NULL=科目级
  unit TEXT, qty REAL, unitPrice REAL,
  amount       REAL NOT NULL,
  note TEXT, sortOrder INTEGER DEFAULT 0
);
```

> **costCategory 全局归集约定**：所有支出类单据可归集到 人工/材料/机械/其他 四科目——`expenditure_contracts.contractType` 映射（劳务/专业分包→人工；材料采购→材料；**设备租赁→机械**；其他→其他），`payroll_records`→人工，`delivery_records`→材料，费用报销→其他。实际成本按此口径聚合与目标对比（§4.6）。红圈参照：目标成本 + 目标成本清单明细（树形清单，DC 简化为 科目+可选分项 两级）。

---

## § 3 外键索引

### 3.1 核心关联

| 表 | 外键字段 | 引用 | 关系 | 说明 |
|---|---|---|---|---|
| `project_suppliers` | `projectId` | `projects.id` | N:1 | 项目×分供方关联 |
| `project_suppliers` | `supplierId` | `suppliers.id` | N:1 | |
| `supplier_credentials` | `supplierId` | `suppliers.id` | N:1 | 分供方证照 |
| `settlements` | `projectSupplierId` | `project_suppliers.id` | 1:1 | 结算（每个关联最多一条） |
| `phase_tasks` | `projectId` | `projects.id` | N:1 | 阶段任务 |

### 3.2 合同关联

| 表 | 外键字段 | 引用 | 关系 | 说明 |
|---|---|---|---|---|
| `construction_contracts` | `projectId` | `projects.id` | N:1 | 施工合同 → 项目 |
| `supplement_agreements` | `contractId` | `construction_contracts.id` | N:1 | 补充协议 → 施工合同 |
| `owner_change_orders` | `projectId` | `projects.id` | N:1 | 甲方变洽签 → 项目 |
| `expenditure_contracts` | `projectId` | `projects.id` | N:1 | 支出合同 → 项目 |
| `expenditure_contracts` | `supplierId` | `suppliers.id` | N:1 | 支出合同 → 分供方 |
| `contract_line_items` | `contractId` | `expenditure_contracts.id` | N:1 | 合同明细行 → 支出合同 |

### 3.3 资金管理关联

| 表 | 外键字段 | 引用 | 关系 | 说明 |
|---|---|---|---|---|
| `invoice_applications` | `projectId` | `projects.id` | N:1 | 开票申请 → 项目 |
| `ticket_registrations` | `projectId` | `projects.id` | N:1 | 收票 → 项目 |
| `ticket_registrations` | `supplierId` | `suppliers.id` | N:1 | 收票 → 分供方 |
| `ticket_registrations` | `contractId` | `expenditure_contracts.id` | N:1 | 收票 → 合同（可选） |
| `receipt_registrations` | `projectId` | `projects.id` | N:1 | 收款 → 项目 |
| `payment_applications` | `projectId` | `projects.id` | N:1 | 付款申请 → 项目 |
| `payment_applications` | `supplierId` | `suppliers.id` | N:1 | 付款申请 → 分供方 |
| `payment_applications` | `contractId` | `expenditure_contracts.id` | N:1 | 付款申请 → 合同（可选） |
| `current_receipts` | `projectId` | `projects.id` | N:1 | 往来收款 → 项目 |
| `current_payments` | `projectId` | `projects.id` | N:1 | 往来付款 → 项目 |
| `payment_records` | `projectId` | `projects.id` | N:1 | 支付记录 → 项目 |

### 3.4 分包及人工关联

| 表 | 外键字段 | 引用 | 关系 | 说明 |
|---|---|---|---|---|
| `crew_workers` | `crewId` | `crews.id` | N:1 | 工人 → 班组 |
| `crew_workers` | `workerId` | `workers.id` | N:1 | 工人 → 班组 |
| `crew_project_config` | `crewId` | `crews.id` | N:1 | 班组项目配置 → 班组 |
| `crew_project_config` | `projectId` | `projects.id` | N:1 | 班组项目配置 → 项目 |
| `crew_project_items` | `configId` | `crew_project_config.id` | N:1 | 分项单价 → 班组项目配置 |
| `worker_certs` | `workerId` | `workers.id` | N:1 | 工人证书 → 工人 |
| `penalty_records` | `projectId` | `projects.id` | N:1 | 扣罚 → 项目 |
| `penalty_records` | `crewId` | `crews.id` | N:1 | 扣罚 → 班组（可选） |
| `penalty_records` | `workerId` | `workers.id` | N:1 | 扣罚 → 工人（可选） |
| `items` | `projectId` / `crewId` | `projects.id` / `crews.id` | N:1 | 分项定义 |
| `quantities` | `itemId` | `items.id` | N:1 | 工程量 → 分项 |
| `quantities` | `roomId` / `unitId` | `rooms.id` / `units.id` | N:1 | 工程量 → 房间（unitId 冗余，便于户级聚合） |
| `quantities` | `crewId` / `workerId` | `crews.id` / `workers.id` | N:1 | 施工班组/工人 |
| `payroll_records` | `projectId` + `crewId` + `workerId` | — | N:1 | 工资（待细化） |

### 3.5 文件引用（多态关联）

`file_refs` 使用 `ownerType` + `ownerId` 多态关联到多种实体：

| ownerType | 关联实体 | 说明 |
|---|---|---|
| `phase_task` | PhaseTask | 阶段任务附件 |
| `supplier_credential` | SupplierCredential | 证照文件 |
| `project_supplier` | ProjectSupplier | 项目×分供方文件 |
| `settlement` | Settlement | 结算确认书 PDF |
| `expenditure_contract` | ExpenditureContract | 合同扫描件 |
| `payment_application` | PaymentApplication | 付款附件 |
| `ticket_registration` | TicketRegistration | 发票扫描件 |
| `worker` | Worker | 工人证件照片/信息文件 |
| `worker_cert` | WorkerCert | 证书扫描件（身份证/特种作业证等） |
| `penalty_record` | PenaltyRecord | 罚款照片/整改前后对比照/联系单扫描件 |

```ts
interface FileRef {
  id: string
  ownerType: string               // 多态类型标识
  ownerId: string                 // 关联实体的 id
  fileName: string
  filePath: string                // Tauri 本地路径
  fileSize: number
  category: string                // 文件分类（合同/送货单/发票/证照/其他）
  uploader: string                // 上传人
  uploadedAt: string
}
```

### 3.6 施工进度关联

| 表 | 外键字段 | 引用 | 关系 | 说明 |
|---|---|---|---|---|
| `floors` | `buildingId` | `buildings.id` | N:1 | 楼层 → 楼栋 |
| `units` | `floorId` | `floors.id` | N:1 | 户 → 楼层 |
| `rooms` | `unitId` | `units.id` | N:1 | 房间 → 户 |
| `schedule_groups` | `projectId` | `projects.id` | N:1 | 楼栋分组 → 项目 |
| `schedule_group_buildings` | `groupId` | `schedule_groups.id` | N:1 | 分组×楼栋 |
| `schedule_group_buildings` | `buildingId` | `buildings.id` | N:1 | 一分组含多栋 |
| `schedule_tasks` | `projectId` | `projects.id` | N:1 | 工序 → 项目 |
| `schedule_tasks` | `groupId` | `schedule_groups.id` | N:1 | 工序 → 楼栋分组（summary 行为 NULL） |
| `schedule_tasks` | `parentId` | `schedule_tasks.id` | N:1 | WBS 自关联（项目→分组→工序） |
| `task_dependencies` | `predId` / `succId` | `schedule_tasks.id` | N:1 | 前后置依赖（FS/SS/FF/SF + lag） |
| `task_item_map` | `taskId` | `schedule_tasks.id` | N:1 | 工序 → 分项映射 |

> 工序实际进度不建外键存值，运行时按 `task_item_map.itemName` + `schedule_group_buildings` 聚合 `quantities.completedMonth` 算完成率（见 `schedule-progress.md` §五）。

### 3.7 目标成本关联

| 表 | 外键字段 | 引用 | 关系 | 说明 |
|---|---|---|---|---|
| `target_costs` | `projectId` | `projects.id` | N:1 | 目标成本 → 项目 |
| `target_cost_items` | `targetCostId` | `target_costs.id` | N:1 | 科目行 → 目标成本 |

---

## § 4 计算字段汇总（不存储，实时查询）

### 4.1 项目经营数据面板（project-info.md）

| 字段 | SQL 计算 |
|---|---|
| 主合同金额 | `SELECT SUM(amount) FROM construction_contracts WHERE projectId = ?` |
| 增补合同额 | `SELECT SUM(amount) FROM supplement_agreements WHERE contractId IN (SELECT id FROM construction_contracts WHERE projectId = ?)` |
| 变洽签审定额 | `SELECT SUM(taxIncAmount) FROM owner_change_orders WHERE projectId = ?` |
| 变更后合同额 | 主合同 + 增补 + 变洽签 |
| 项目收款 | `SELECT SUM(amount) FROM receipt_registrations WHERE projectId = ?` |
| 付款金额 | `SELECT SUM(actualPayment) FROM payment_applications WHERE projectId = ?` |
| 往来收款 | `SELECT SUM(amount) FROM current_receipts WHERE projectId = ?` |
| 往来付款 | `SELECT SUM(amount) FROM current_payments WHERE projectId = ?` |
| 项目可用资金余额 | 项目收款 + 往来收款 − 付款金额 − 往来付款 − 管理费 |

### 4.2 票据信息面板（project-info.md）

| 字段 | SQL 计算 |
|---|---|
| 销项票额 | `SELECT SUM(amount) FROM invoice_applications WHERE projectId = ?` |
| 销项税额 | `SELECT SUM(taxAmount) FROM invoice_applications WHERE projectId = ?` |
| 进项票额 | `SELECT SUM(amount) FROM ticket_registrations WHERE projectId = ?` |
| 进项税额 | `SELECT SUM(taxAmount) FROM ticket_registrations WHERE projectId = ?` |
| 增值税 | 销项税额 − 进项税额 |
| 税负率 | 增值税 / 销项票额 |

### 4.3 分供方汇总（base-supplier.md）

| 字段 | SQL 计算 |
|---|---|
| 合作项目数 | `SELECT COUNT(*) FROM project_suppliers WHERE supplierId = ?` |
| 合同数 | `SELECT COUNT(*) FROM expenditure_contracts WHERE supplierId = ?` |
| 合同总额 | `SELECT SUM(taxIncTotal) FROM expenditure_contracts WHERE supplierId = ?` |
| 累计已付 | `SELECT SUM(actualPayment) FROM payment_applications WHERE supplierId = ?` |
| 应付余额 | 合同总额 − 累计已付 |

### 4.4 ProjectSupplier 汇总（project-supplier.md）

| 字段 | SQL 计算 |
|---|---|
| contractTotal | `SELECT SUM(taxIncTotal) FROM expenditure_contracts WHERE projectId = ? AND supplierId = ?` |
| claimedTotal | `SELECT SUM(amount) FROM payment_applications WHERE projectId = ? AND supplierId = ? AND approvalStatus = 'approved'` |
| paidTotal | `SELECT SUM(actualPayment) FROM payment_applications WHERE projectId = ? AND supplierId = ?` |
| invoiceTotal | `SELECT SUM(amount) FROM ticket_registrations WHERE projectId = ? AND supplierId = ?` |
| balance | contractTotal − paidTotal |

### 4.5 首页 Dashboard 指标（homepage-dashboard.md）

| 字段 | SQL 计算 |
|---|---|
| 合同总额 | `SELECT SUM(amount) FROM construction_contracts WHERE projectId = ?` + 变更 |
| 累计收款 | `SELECT SUM(amount) FROM receipt_registrations WHERE projectId = ?` |
| 累计支出 | `SELECT SUM(actualPayment) FROM payment_applications WHERE projectId = ?` |
| 已开票额 | `SELECT SUM(amount) FROM invoice_applications WHERE projectId = ?` |
| 材料分供方数 | `SELECT COUNT(DISTINCT supplierId) FROM project_suppliers ps JOIN suppliers s ON ps.supplierId = s.id WHERE ps.projectId = ? AND s.supplierCategory = '材料供应商'` |
| 采购合同数 | `SELECT COUNT(*) FROM expenditure_contracts WHERE projectId = ? AND contractType = '材料采购'` |

### 4.6 施工进度与成本对比（schedule-progress.md）

| 字段 | 计算 |
|---|---|
| 工序实际完成率（hasQty=1） | 分组内该分项 已完成房间/总房间：`quantities.completedMonth IS NOT NULL` 计数 ÷ 总数，范围 = `task_item_map.itemName` × `schedule_group_buildings` 圈定的楼栋 |
| 工序实际完成率（hasQty=0） | `schedule_tasks.manualProgress` |
| 工序计划应完成率 | `clamp((today − plannedStart) / (plannedFinish − plannedStart), 0, 1)` |
| 提前/延后天数 | `(实际完成率 − 计划应完成率) × durationDays`（分组/项目行按子工序工期加权） |
| 项目目标成本（按科目） | `SELECT costCategory, SUM(amount) FROM target_cost_items ti JOIN target_costs t ON ti.targetCostId=t.id WHERE t.projectId=? AND t.isBaseline=1 GROUP BY costCategory` |
| 项目实际成本（按科目） | 按 §2.8 costCategory 约定归集：人工=劳务/分包付款+工资；材料=材料合同付款+送货单；机械=设备租赁付款；其他=报销+其他支出 |
| 成本偏差率 | `(实际 − 目标) / 目标`（科目级与合计级） |

---

## § 5 SQLite 建表顺序

按外键依赖排序，先建被引用的表：

```
第 1 批（无外键依赖）
  1. projects
  2. suppliers
  3. bank_codes                   （内置行号字典 seed）
  4. crews
  5. workers

第 2 批（依赖第 1 批）
  6. supplier_credentials         → suppliers
  7. project_suppliers            → projects, suppliers
  8. phase_tasks                  → projects
  9. construction_contracts       → projects
  10. owner_change_orders         → projects
  11. expenditure_contracts       → projects, suppliers
  12. invoice_applications        → projects
  13. receipt_registrations       → projects
  14. current_receipts            → projects
  15. current_payments            → projects
  16. payment_records             → projects
  17. buildings                   → projects
  18. schedule_groups             → projects
  19. target_costs                → projects
  20. items                       → projects, crews
  21. crew_workers                → crews, workers
  22. crew_project_config         → crews, projects
  23. worker_certs                → workers
  24. penalty_records             → projects, crews, workers

第 3 批（依赖第 2 批）
  25. settlements                 → project_suppliers
  26. supplement_agreements       → construction_contracts
  27. contract_line_items         → expenditure_contracts
  28. ticket_registrations        → projects, suppliers, expenditure_contracts
  29. payment_applications        → projects, suppliers, expenditure_contracts
  30. floors                      → buildings
  31. schedule_group_buildings    → schedule_groups, buildings
  32. schedule_tasks              → projects, schedule_groups（parentId 自关联）
  33. target_cost_items           → target_costs
  34. crew_project_items          → crew_project_config

第 4 批（依赖第 3 批）
  35. units                       → floors
  36. task_dependencies           → schedule_tasks
  37. task_item_map               → schedule_tasks
  38. payroll_records             → projects, crews, workers（待细化）

第 5 批（依赖第 4 批）
  39. rooms                       → units
  40. quantities                  → items, rooms, units, crews, workers

第 6 批（多态关联，无严格外键约束）
  41. file_refs                   → ownerType + ownerId（应用层保证一致性）
```

---

## § 6 索引建议

```sql
-- 高频查询：按项目查所有单据
CREATE INDEX idx_project_suppliers_proj ON project_suppliers(projectId);
CREATE INDEX idx_project_suppliers_sup ON project_suppliers(supplierId);
CREATE INDEX idx_expenditure_contracts_proj ON expenditure_contracts(projectId);
CREATE INDEX idx_expenditure_contracts_sup ON expenditure_contracts(supplierId);
CREATE INDEX idx_payment_applications_proj ON payment_applications(projectId);
CREATE INDEX idx_payment_applications_sup ON payment_applications(supplierId);
CREATE INDEX idx_ticket_registrations_proj ON ticket_registrations(projectId);
CREATE INDEX idx_ticket_registrations_sup ON ticket_registrations(supplierId);

-- 证照查询
CREATE INDEX idx_supplier_credentials_sup ON supplier_credentials(supplierId);

-- 文件多态查询
CREATE INDEX idx_file_refs_owner ON file_refs(ownerType, ownerId);

-- 合同子表
CREATE INDEX idx_supplement_agreements_contract ON supplement_agreements(contractId);
CREATE INDEX idx_contract_line_items_contract ON contract_line_items(contractId);

-- 阶段任务
CREATE INDEX idx_phase_tasks_proj ON phase_tasks(projectId);

-- 区域树与工程量
CREATE INDEX idx_floors_building ON floors(buildingId);
CREATE INDEX idx_units_floor ON units(floorId);
CREATE INDEX idx_rooms_unit ON rooms(unitId);
CREATE INDEX idx_items_project ON items(projectId);
CREATE INDEX idx_quantities_item ON quantities(itemId);
CREATE INDEX idx_quantities_room ON quantities(roomId);
CREATE INDEX idx_quantities_worker ON quantities(workerId);
CREATE INDEX idx_quantities_month ON quantities(completedMonth);

-- 施工进度
CREATE INDEX idx_schedule_groups_proj ON schedule_groups(projectId);
CREATE INDEX idx_sgb_group ON schedule_group_buildings(groupId);
CREATE INDEX idx_schedule_tasks_proj ON schedule_tasks(projectId);
CREATE INDEX idx_schedule_tasks_group ON schedule_tasks(groupId);
CREATE INDEX idx_task_deps_pred ON task_dependencies(predId);
CREATE INDEX idx_task_deps_succ ON task_dependencies(succId);
CREATE INDEX idx_task_item_map_task ON task_item_map(taskId);

-- 目标成本
CREATE INDEX idx_target_costs_proj ON target_costs(projectId);
CREATE INDEX idx_tci_target ON target_cost_items(targetCostId);

-- 银行行号（idx_bank_codes_name / idx_bank_codes_brand_city 见 base-worker.md §五）
```

---

## § 7 数据迁移策略

### 7.1 旧数据迁移（localStorage → SQLite）

首次启动检测 localStorage 中的旧数据 key：

| 旧 key | 目标表 | 说明 |
|---|---|---|
| `supplierDb.v1` | `suppliers` | 分供方主数据，附件字段拆到 `supplier_credentials` |
| `projectDb.v1` | `projects` | 项目数据 |
| `projSupplierDb.v1` | `project_suppliers` | 项目×分供方关联 |
| `recognizedStore.v1` | — | 识别明细，V1 保留在 localStorage 或另行迁移 |

### 7.2 迁移规则

1. 迁移为一次性操作，成功后标记 `migration_done` flag
2. 旧数据保留不删除（用户可手动清理）
3. 旧 `Supplier.attachments[]` 内嵌数组 → 拆为 `supplier_credentials` 多行
4. 旧 `Supplier.purchases[]` / `payments[]` → 保留在 `suppliers` 表的 JSON 字段中（兼容），新数据走独立表
5. 区域树/工程量/施工进度/目标成本等新表**无 localStorage 旧数据来源**，不参与迁移（首启建空表 + seed；工序标准库 22 道随 seed 内置）

---

## § 8 撤回机制（待实现）

> 所有新增/编辑/删除操作需支持撤回。V1 先用软删除 + 操作日志，后续可扩展为后台管理回退面板。

### 8.1 软删除

所有业务表增加 `deleted_at TEXT DEFAULT NULL` 字段。删除操作不执行 `DELETE`，而是 `UPDATE SET deleted_at = datetime('now')`。

查询默认过滤已删除记录：`WHERE deleted_at IS NULL`。

恢复操作：`UPDATE SET deleted_at = NULL WHERE id = ?`。

```sql
-- 所有业务表统一追加（后续迁移脚本）
ALTER TABLE projects ADD COLUMN deleted_at TEXT DEFAULT NULL;
ALTER TABLE suppliers ADD COLUMN deleted_at TEXT DEFAULT NULL;
-- ... 其他表同理
```

### 8.2 操作日志表

```sql
CREATE TABLE IF NOT EXISTS operation_logs (
  id          TEXT PRIMARY KEY,
  table_name  TEXT NOT NULL,        -- 操作的表名
  record_id   TEXT NOT NULL,        -- 操作的记录 id
  action      TEXT NOT NULL,        -- 'create' | 'update' | 'delete' | 'restore'
  before_data TEXT,                 -- 操作前数据快照 (JSON)
  after_data  TEXT,                 -- 操作后数据快照 (JSON)
  operator    TEXT DEFAULT '',      -- 操作人
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_operation_logs_record ON operation_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_time ON operation_logs(created_at);
```

### 8.3 撤回规则

1. **删除撤回**：从操作日志中恢复 `before_data`，或直接清除 `deleted_at`
2. **编辑撤回**：从操作日志中恢复 `before_data` 的字段值
3. **新增撤回**：标记软删除
4. **撤回时效**：V1 不限制，V2 可按天数限制（如 30 天内可撤回）
5. **级联撤回**：删除父记录时子记录一并软删除，撤回时一并恢复

### 8.4 实施计划

- **V1**：在 Pinia store 的 CRUD 方法中集成 `operation_logs` 写入和 `deleted_at` 过滤，提供 `undo()` 方法
- **V2**：后台管理面板展示操作日志，支持按时间/表/操作类型筛选和批量回退

---

## § 9 维护规则

1. 新增实体时必须同步更新本文件的 § 2 实体清单、§ 3 外键索引、§ 5 建表顺序、§ 6 索引
2. 各模块设计文档只定义业务字段，实体间关系统一在本文件管理
3. 所有业务表的删除操作使用软删除（§ 8.1），并记录操作日志（§ 8.2）
4. 字段命名规范：camelCase（TypeScript 侧）→ snake_case（SQLite 列名），ORM 层自动转换
5. 所有 id 字段使用 `{表缩写}_{timestamp36}_{seq36}` 格式（如 `sup_m1abc_0`）
6. 计算字段不存储，Pinia store 中提供 computed getter，底层走 SQL 聚合查询（§ 4）
7. 新增支出类实体必须定义 **costCategory 归集口径**（人工/材料/机械/其他，§ 2.8），否则成本对比（§ 4.6）会漏项
8. 排程/进度类改动必须与 `schedule-progress.md` 双向同步（§ 2.7 / § 3.6 / § 4.6）；工程量表名以 `subcontract-quantity.md` 的 `items` + `quantities` 为准，禁用旧名 `quantity_records`
