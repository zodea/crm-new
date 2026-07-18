# 数据库设计 — 全局实体关系 + 外键索引 + 建表顺序

> ⛔ 本文件为设计源码中的历史副本，不再作为数据模型权威源。当前唯一权威源为 `docs/rewrite/DATABASE.md`；本文件保留作历史查阅，不复制后续字段与实体变更。

> 历史说明：本文件曾用于记录全模块 SQLite（tauri-plugin-sql）实体关系，现已由上述权威源取代。

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

---

## § 2 全部实体清单

### 2.1 基础主数据（跨项目共享）

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| Project | `projects` | `id` | `project-info.md` |
| Supplier | `suppliers` | `id` | `base-supplier.md` |
| SupplierCredential | `supplier_credentials` | `id` | `base-supplier.md` |
| FileRef | `file_refs` | `id` | 共用 |

### 2.2 项目关联实体

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| ProjectSupplier | `project_suppliers` | `id` | `project-supplier.md` |
| Settlement | `settlements` | `id` | `project-supplier.md` |
| PhaseTask | `phase_tasks` | `id` | `project-info.md` |

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
| QuantityRecord | `quantity_records` | `id` | `subcontract-quantity.md`（待设计） |
| PayrollRecord | `payroll_records` | `id` | `subcontract-payroll.md`（待设计） |

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
| `quantity_records` | `projectId` + `crewId` + `workerId` | — | N:1 | 工程量 |
| `payroll_records` | `projectId` + `crewId` + `workerId` | — | N:1 | 工资 |

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

---

## § 5 SQLite 建表顺序

按外键依赖排序，先建被引用的表：

```
第 1 批（无外键依赖）
  1. projects
  2. suppliers

第 2 批（依赖第 1 批）
  3. supplier_credentials         → suppliers
  4. project_suppliers            → projects, suppliers
  5. phase_tasks                  → projects
  6. construction_contracts       → projects
  7. owner_change_orders          → projects
  8. expenditure_contracts        → projects, suppliers
  9. invoice_applications         → projects
  10. receipt_registrations       → projects
  11. current_receipts            → projects
  12. current_payments            → projects
  13. payment_records             → projects
  14. crews                       → (待设计)
  15. workers                     → (待设计)

第 3 批（依赖第 2 批）
  16. settlements                 → project_suppliers
  17. supplement_agreements       → construction_contracts
  18. contract_line_items         → expenditure_contracts
  19. ticket_registrations        → projects, suppliers, expenditure_contracts
  20. payment_applications        → projects, suppliers, expenditure_contracts

第 4 批（多态关联，无严格外键约束）
  21. file_refs                   → ownerType + ownerId（应用层保证一致性）
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

1. 新增实体时必须同步更新本文件的 § 2 实体清单和 § 3 外键索引
2. 各模块设计文档只定义业务字段，实体间关系统一在本文件管理
3. 所有业务表的删除操作使用软删除（§ 8.1），并记录操作日志（§ 8.2）
3. 字段命名规范：camelCase（TypeScript 侧）→ snake_case（SQLite 列名），ORM 层自动转换
4. 所有 id 字段使用 `{表缩写}_{timestamp36}_{seq36}` 格式（如 `sup_m1abc_0`）
5. 计算字段不存储，Pinia store 中提供 computed getter，底层走 SQL 聚合查询
