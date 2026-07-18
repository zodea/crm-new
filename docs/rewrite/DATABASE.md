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

### 1.2 清单与变更线（2026-07-04 grill 新增）

```
construction_contracts ─1:N→ boq_files ─1:N→ boq_lines（统一清单行模型，合同量+合同单价唯一来源）
projects ─1:N→ boq_change_orders（变更单四档：草稿→已上报→已打回→已签证，CONTEXT.md「变更单」）
              ├─1:N→ boq_change_lines ─N:1→ boq_lines（调量/调价指向原行；变更新增行反向挂 changeOrderId）
              └─已签证─自动生成→ owner_change_orders 台账行（1:1 ledgerId 追溯，ADR-0002）
projects ─1:N→ monthly_statements ─1:N→ monthly_statement_lines（月度报量：自动汇总草稿+手调）
invoices = 识别+台账单表（ADR-0001，废弃 ticket_registrations）→ 归属：projects 或 个人开支
delivery_records ─1:N→ delivery_lines（「入库」写材料明细；单价对比=聚合查询视图，无独立表）
projects ─1:N→ project_aliases（工地名归一：别名→项目，首绑人工确认、同写法后续自动，CONTEXT.md「工地」）
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
| FilePayload | `file_payloads` | `fileRefId` | 共用（附件正文，仅按需读取） |
| BankCode | `bank_codes` | `id` | `base-worker.md` §五（银行行号字典，内置 seed，无外键） |

`suppliers.external_ref TEXT DEFAULT ''` 保存 ADR 0005 的「外部旧ID / 匹配标识」，作为旧系统迁移对账、二次导入修正与去重键；非空且未软删的记录必须唯一（迁移 v11）。

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
| OwnerChangeOrder | `owner_change_orders` | `id` | `contract-construction.md`（金额台账=自动行（来源变更单）+手录纯金额签证，ADR-0002） |
| ExpenditureContract | `expenditure_contracts` | `id` | `contract-base.md` + 类型文档 |
| ContractLineItem | `contract_line_items` | `id` | `material-contract.md` |
| BoqFile | `boq_files` | `id` | `boq-import.md`（清单文件：挂施工合同一对多，未拆表/已拆表） |
| BoqLine | `boq_lines` | `id` | `boq-import.md` §二（统一清单行模型+来源追溯键） |
| BoqChangeOrder | `boq_change_orders` | `id` | CONTEXT.md「变更单」「指令单」（四档状态） |
| BoqChangeLine | `boq_change_lines` | `id` | 变更单行明细（新增/调量/调价） |
| MonthlyStatement | `monthly_statements` | `id` | CONTEXT.md「月度报量」（屏待设计，表先行） |
| MonthlyStatementLine | `monthly_statement_lines` | `id` | 同上（自动汇总+手调字段） |
| Contract | `contracts` | `id` | **合同域轻实体仓（#90 批A 新 IA，v3 迁移已落地）**：施工/分包/材采单表 `kind` 区分，对齐设计稿 `kit/data.js` contracts[]。四级金额链列（amount/changed/settled/invoiced/paid）为 seed 静态值，真聚合留后续 pass。`construction_contracts` / `expenditure_contracts` 为旧 IA 表（清单拆表/变更单线仍挂其上），迁移合并另起工序 |

```sql
-- 合同域轻实体仓（#90 批A，migrations v3 contracts-light-entity）
CREATE TABLE contracts (
  id          TEXT PRIMARY KEY,
  no          TEXT DEFAULT '',
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT '施工',   -- '施工' | '分包' | '材采'
  sub_kind    TEXT DEFAULT '',                -- '劳务' | '专业'，仅 kind='分包'
  project_id  TEXT NOT NULL,                  -- → projects.id
  supplier_id TEXT,                           -- → suppliers.id；施工合同（乙方=我方）为 NULL
  amount      REAL DEFAULT 0,                 -- 含税合同金额
  changed     REAL DEFAULT 0,                 -- 变更后合同金额
  settled     REAL DEFAULT 0,                 -- 累计结算
  invoiced    REAL DEFAULT 0,                 -- 累计收票（施工=累计开票）
  paid        REAL DEFAULT 0,                 -- 累计支付（施工=累计收款）
  sign_date   TEXT DEFAULT '',
  status      TEXT DEFAULT '履约中',          -- '履约中' | '已签订' | '已结算' | '已结清'
  note        TEXT DEFAULT '',
  created_at  TEXT, updated_at TEXT, deleted_at TEXT
);
```

```sql
CREATE TABLE boq_files (
  id          TEXT PRIMARY KEY,
  contractId  TEXT NOT NULL,          -- → construction_contracts.id（一份合同可挂多份清单文件）
  fileName    TEXT, filePath TEXT,
  formatClass TEXT,                   -- 'A'..'E'（boq-import.md §一 五类格式）
  parseStatus TEXT DEFAULT 'pending', -- 'pending' 未拆表 | 'parsed' 已拆表·N 行
  lineCount   INTEGER DEFAULT 0,
  note TEXT, createdAt TEXT, updatedAt TEXT, deleted_at TEXT
);

CREATE TABLE boq_lines (
  id          TEXT PRIMARY KEY,
  boqFileId   TEXT NOT NULL,          -- → boq_files.id
  projectId   TEXT NOT NULL,          -- 冗余 → projects.id（高频按项目查）
  -- 必有（boq-import.md §二）
  itemName    TEXT NOT NULL,          -- 分项名称
  unit TEXT, qty REAL,                -- 单套量为准（×套数=总量）
  unitPrice   REAL,                   -- 合同单价（不含税）
  amount      REAL,                   -- 合价
  traceKey    TEXT,                   -- 来源追溯键（文件·sheet·行）
  -- 常有可空
  building TEXT, unitType TEXT, multiplier REAL,  -- 楼栋/户型/套数(倍数)
  room TEXT, section TEXT, floorZone TEXT,        -- 房间(部位)/分部·章节/楼层层区
  spec TEXT,                                       -- 特征描述
  -- 可选
  taxRate REAL, ownerSupplied INTEGER DEFAULT 0,   -- 税率/甲供标记（计量计工资不计材成本）
  changeOrderId TEXT,                 -- 非空=变更新增行 → boq_change_orders.id
  sortOrder INTEGER, createdAt TEXT, deleted_at TEXT
);

CREATE TABLE boq_change_orders (
  id          TEXT PRIMARY KEY,
  projectId   TEXT NOT NULL,          -- → projects.id
  contractId  TEXT,                   -- → construction_contracts.id
  code TEXT, name TEXT,               -- 编号/名称（单项目可达 200 份，靠编号+状态筛选检索）
  changeType  TEXT,                   -- 主类型：'新增' | '调量' | '调价'（行级可混合）
  status      TEXT DEFAULT 'draft',   -- 'draft' 草稿 | 'submitted' 已上报 | 'rejected' 已打回 | 'approved' 已签证
  statusNote  TEXT,                   -- 各档详细说明（打回原因等，CONTEXT.md「变更单」）
  directiveNo   TEXT,                 -- 甲方下发指令单编号
  directiveType TEXT,                 -- 甲方指令单性质：'下发' | '变更' | '补充'
  totalAmount REAL,                   -- Σ变更行合价（冗余）
  approvedAt  TEXT,                   -- 签证完成日：该刻自动生成变洽签台账行（ADR-0002）
  ledgerId    TEXT,                   -- → owner_change_orders.id（1:1 追溯；台账自动行不可直改金额）
  note TEXT, createdAt TEXT, updatedAt TEXT, deleted_at TEXT
);
-- 附件（我方指令单/甲方指令单/报价/算量/施工照片）走 file_refs 分类挂载，见 §3.5

CREATE TABLE boq_change_lines (
  id            TEXT PRIMARY KEY,
  changeOrderId TEXT NOT NULL,        -- → boq_change_orders.id
  boqLineId     TEXT,                 -- → boq_lines.id（调量/调价指向原行；新增为 NULL）
  itemName TEXT, unit TEXT,
  deltaQty REAL,                      -- 调量差值（新增行=全量）
  newUnitPrice REAL,                  -- 调价后单价（NULL=价不变）
  amount REAL,                        -- 该行变更合价
  note TEXT, sortOrder INTEGER
);

CREATE TABLE monthly_statements (
  id        TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,            -- → projects.id
  month     TEXT NOT NULL,            -- yyyy-mm
  status    TEXT DEFAULT 'draft',     -- 'draft' 自动汇总草稿 | 'adjusted' 已手调 | 'exported' 已导出
  totalAmount REAL,
  note TEXT, createdAt TEXT, updatedAt TEXT, deleted_at TEXT
);

CREATE TABLE monthly_statement_lines (
  id          TEXT PRIMARY KEY,
  statementId TEXT NOT NULL,          -- → monthly_statements.id
  itemName TEXT, unit TEXT,
  autoQty     REAL,                   -- 自动汇总：当月完成勾选+现场量
  adjustedQty REAL,                   -- 手工调整（NULL=未调，取 autoQty）
  unitPrice   REAL,                   -- 合同单价
  amount REAL, note TEXT, sortOrder INTEGER
);
```

### 2.4 资金管理类

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| Invoice | `invoices` | `id` | `finance-invoice.md`（识别+台账**单表**，ADR-0001；归属：项目 或 个人开支） |
| InvoiceApplication | `invoice_applications` | `id` | `finance-billing.md`（待设计；销项=开票申请） |
| ReceiptRegistration | `receipt_registrations` | `id` | `finance-receipt.md`（待设计） |
| PaymentApplication | `payment_applications` | `id` | `finance-payment.md`（待设计） |
| CurrentReceipt | `current_receipts` | `id` | `finance-receipt.md`（待设计） |
| CurrentPayment | `current_payments` | `id` | `finance-payment.md`（待设计） |
| PaymentRecord | `payment_records` | `id` | `finance-records.md`（待设计） |

> ~~TicketRegistration `ticket_registrations`~~ **已废弃**（ADR-0001）：红圈式收票登记合并进 `invoices` 单表，项目详情「收票登记」Tab = 查已归档 invoices。

```sql
-- invoices 关键字段（全量以 app/lib/db/schema.ts 为基础，以下为台账/归属增量，
-- 迁移 v4「invoices-owner-kind-archive」已落地对齐，issue #57）
--   owner_kind     TEXT  'project' | 'personal'（个人开支）——归档那刻强制选定，无归属禁止归档/导入
--   project_id     TEXT  owner_kind='project' 时必填 → projects.id
--   supplier_id    TEXT  销方对应分供方（可选）→ suppliers.id
--   contract_id    TEXT  合同收票（可选，红圈式，本期不做交互）→ expenditure_contracts.id
--   account_status TEXT  'none' | 'archived'（归档=进台账；核对完成是归档唯一前置；归档后仍可改但弹二次确认；
--                        「确认」= review_status 独立字段 unreviewed→reviewed，不占用 account_status）
--   print_count    INTEGER 累计打印次数
--   archived_at    TEXT  归档时间（与 confirmed_at 对称，两者是独立阶段）
--   items            TEXT  货物明细行 JSON 数组（OCR 提取，#60，迁移 v5；对齐 suppliers.aliases JSON 文本先例）
--   field_confidence TEXT  逐字段置信度 JSON 对象 {字段名:0~1}（#60 字段校对边框色/角标/✓确认依据，迁移 v5；
--                          与全局 ocr_confidence 口径不同不合并；分档阈值见 app/lib/invoice/recognize.ts）
--   deleted_at     TEXT  软删除（§8）
```

### 2.5 物资管理类

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| DeliveryRecord | `delivery_records` | `id` | `material-delivery.md`（送货单头：处理区/归档库双区字段） |
| DeliveryLine | `delivery_lines` | `id` | `material-delivery.md`（明细行：入库=材料数据，供单价对比/分供方详情读取） |
| ProjectAlias | `project_aliases` | `id` | CONTEXT.md「工地」（工地名写法变体 → 项目归一，2026-07-06 grill 定） |

> ~~PriceComparison `price_comparisons`~~ **已移除**：单价对比是对 `delivery_lines` 的聚合查询视图（同材料跨分供方/跨时间比价），无独立存储；未来若需收藏对比方案再议。

```sql
CREATE TABLE delivery_records (
  id         TEXT PRIMARY KEY,
  projectId  TEXT NOT NULL,          -- 核对归档前强制归项目；上传时归属拦截仍是后续交互目标；工地名经 project_aliases 归一而来
  supplierId TEXT,                   -- 可空=归档库左树「⚠未区分分供方」兜底节点
  rawSiteText TEXT,                  -- OCR/文件夹推断的工地原文本，仅留痕追溯，不参与任何键（2026-07-06 定）
  orderNo TEXT, deliveryDate TEXT,   -- 去重自然键 = projectId+supplierId+orderNo（全 ID 化，见 §6 唯一索引）
  fileName TEXT, filePath TEXT,
  ocrStatus TEXT DEFAULT 'pending',  -- 待识别 | 识别中 | 待核对 | 已核对
  archived  INTEGER DEFAULT 0,       -- 核对完成即自动归档（核对是归档唯一前置）
  stored    INTEGER DEFAULT 0,       -- 已入库（写材料数据，与归档并行的两条路）
  reviewFlag TEXT,                   -- 问题标记（缺公司/缺日期/缺单号/0明细行/待复核）
  note TEXT, createdAt TEXT, updatedAt TEXT, deleted_at TEXT
);

CREATE TABLE delivery_lines (
  id               TEXT PRIMARY KEY,
  deliveryRecordId TEXT NOT NULL,    -- → delivery_records.id
  materialName TEXT, spec TEXT, unit TEXT,
  qty REAL, unitPrice REAL, amount REAL,
  amountSource TEXT DEFAULT 'manual', -- calculated | ocr | manual
  note TEXT, sortOrder INTEGER
);

> `delivery_lines.amount` 是人工复核后的独立金额，不是数据库生成列。默认可由 `qty × unitPrice` 补出；`amountSource='calculated'` 时数量/单价继续联动，`ocr` / `manual` 时冻结票面或人工金额。迁移 v9 将无法可靠反推来源的存量行标为 `manual`，避免升级后覆盖既有值。`qty × unitPrice = amount` 仅作为界面勾稽规则，不作为写入时强制重算规则。

CREATE TABLE project_aliases (
  id        TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,           -- → projects.id
  alias     TEXT NOT NULL,           -- 工地名写法变体（全局唯一，见 §6）；首次人工确认时写入，之后同写法自动绑定
  createdAt TEXT, deleted_at TEXT
);
```

> `project_aliases` 已由迁移 v8 落地：人工选定项目并完成核对时记忆 `rawSiteText`，同一归一化写法后续自动预选；若该写法已属于其他项目则拒绝静默改绑。

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
| Item | `items` | `id` | `subcontract-quantity.md`（分项定义：**项目×分部/工种**，不挂班组——分项是合同计量口径；谁做记在 `unit_assignments`，班组单价走 `crew_project_items`） |
| HouseTypeTemplate | `house_type_templates` | `id` | **ADR 0010**：户型模板（项目×户型，活链接多户） |
| HouseTypeTemplateItem | `house_type_template_items` | `id` | **ADR 0010**：模板明细/三量（房间×工种×分项，清单量/暂估量/现场量算式，户型层共享、量可手改留痕） |
| UnitAssignment | `unit_assignments` | `id` | **ADR 0010**：户级指派+完成四合一（户×工种→班组/人×月份×完成，草稿态+验收照片软卡） |
| ~~Quantity~~ | ~~`quantities`~~ | — | ⚠️ **已按 [ADR 0010](../adr/0010-quantity-matrix-and-construction-record-model.md) 重构**：原「分项×房间×工人」合一表拆为 `house_type_template_items`（量）+ `unit_assignments`（完成/施工人/月份）；`units` +`houseTypeTemplateId`、`projects` +`matrixArchivedAt`。本文下方对 `quantities` 的引用（§66 关系图 / §303·§461·§534 进度聚合 / §399-401 外键 / §547·§551 口径 / §663-666 索引）待工程量域批次 PRD 随实现改名同步，完整 schema 以 ADR 0010 为权威 |
| WageStatement | `wage_statements` | `id` | `subcontract-payroll.md` + 设计稿 WageSlipScreen（月度进度款单：项目×班组×月；「本期支付总额」直给按权重分摊；**字段细化随工资域批次 PRD**） |
| WageStatementLine | `wage_statement_lines` | `id` | 同上（工人行快照：应发/实发可直改/开户行/卡号） |
| AttendanceRecord | `attendance_records` | `id` | 考勤（工人×日期×工时，**待细化**） |

> ~~PayrollRecord `payroll_records`~~ **已细化拆分**为上述工资三表（禁用旧名）。工资单是**快照**（生成时计算应发 + 人工改实发），不是纯计算视图——反馈轮 8 定稿「实发逐人可直改」。

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
> `schedule_tasks` 预留 `baselineStart/baselineFinish`（「设为基线」= 保存当前计划快照，NULL=未设基线）。

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
| `boq_files` | `contractId` | `construction_contracts.id` | N:1 | 清单文件 → 施工合同（一对多） |
| `boq_lines` | `boqFileId` / `projectId` | `boq_files.id` / `projects.id` | N:1 | 清单行（projectId 冗余） |
| `boq_lines` | `changeOrderId` | `boq_change_orders.id` | N:1 | 变更新增行来源（可选） |
| `boq_change_orders` | `projectId` / `contractId` | `projects.id` / `construction_contracts.id` | N:1 | 变更单 |
| `boq_change_orders` | `ledgerId` | `owner_change_orders.id` | 1:1 | 已签证自动生成的台账行（ADR-0002，软删除级联） |
| `boq_change_lines` | `changeOrderId` / `boqLineId` | `boq_change_orders.id` / `boq_lines.id` | N:1 | 变更行（新增行 boqLineId 为 NULL） |
| `monthly_statements` | `projectId` | `projects.id` | N:1 | 月度报量单 |
| `monthly_statement_lines` | `statementId` | `monthly_statements.id` | N:1 | 报量行 |

### 3.3 资金管理关联

| 表 | 外键字段 | 引用 | 关系 | 说明 |
|---|---|---|---|---|
| `invoice_applications` | `projectId` | `projects.id` | N:1 | 开票申请 → 项目 |
| `invoices` | `projectId` | `projects.id` | N:1 | 发票归档归属（owner_kind='project' 时必填；'personal'=个人开支不挂项目） |
| `invoices` | `supplierId` | `suppliers.id` | N:1 | 销方对应分供方（可选） |
| `invoices` | `contractId` | `expenditure_contracts.id` | N:1 | 合同收票（可选，本期不做交互） |
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
| `items` | `projectId` | `projects.id` | N:1 | 分项定义（项目×分部/工种，**不挂班组**——合同计量口径） |
| `quantities` | `itemId` | `items.id` | N:1 | 工程量 → 分项 |
| `quantities` | `roomId` / `unitId` | `rooms.id` / `units.id` | N:1 | 工程量 → 房间（unitId 冗余，便于户级聚合） |
| `quantities` | `crewId` / `workerId` | `crews.id` / `workers.id` | N:1 | 施工班组/工人 |
| `wage_statements` | `projectId` / `crewId` | `projects.id` / `crews.id` | N:1 | 月度进度款单 |
| `wage_statement_lines` | `statementId` / `workerId` | `wage_statements.id` / `workers.id` | N:1 | 工人工资行（快照） |
| `attendance_records` | `projectId` / `workerId` | `projects.id` / `workers.id` | N:1 | 考勤（待细化） |
| `delivery_records` | `projectId` / `supplierId` | `projects.id` / `suppliers.id` | N:1 | 送货单（supplierId 可空=未区分分供方兜底） |
| `delivery_lines` | `deliveryRecordId` | `delivery_records.id` | N:1 | 送货单明细行 |
| `project_aliases` | `projectId` | `projects.id` | N:1 | 工地名别名 → 项目归一（CONTEXT.md「工地」） |

### 3.5 文件引用（多态关联）

`file_refs` 使用 `ownerType` + `ownerId` 多态关联到多种实体：

| ownerType | 关联实体 | 说明 |
|---|---|---|
| `phase_task` | PhaseTask | 阶段任务附件 |
| `supplier_credential` | SupplierCredential | 证照文件 |
| `project_supplier` | ProjectSupplier | 项目×分供方文件 |
| `settlement` | Settlement | 结算确认书 PDF |
| `construction_contract` | ConstructionContract | 施工合同文书扫描件（Tab③ 文件柜 chip 在线预览） |
| `supplement_agreement` | SupplementAgreement | 补充协议文书 |
| `boq_change_order` | BoqChangeOrder | 变更单附件，category 细分**各有放置区**：我方指令单（可多版）/ 甲方指令单 / 报价 / 算量 / 施工照片 |
| `expenditure_contract` | ExpenditureContract | 合同扫描件 |
| `payment_application` | PaymentApplication | 付款附件 |
| `invoice` | Invoice | 发票原图（原 `ticket_registration` 已随 ADR-0001 废弃） |
| `delivery_record` | DeliveryRecord | 送货单扫描件（`category=source`，每张归档记录一份当前原件） |
| `quantity` | Quantity | 验收照片（挂「户×分项」，工序卡点判据，CONTEXT.md「验收照片」） |
| `worker` | Worker | 工人证件照片/信息文件 |
| `worker_cert` | WorkerCert | 证书扫描件（身份证/特种作业证等） |
| `penalty_record` | PenaltyRecord | 罚款照片/整改前后对比照/联系单扫描件 |

```ts
interface FileRef {
  id: string
  ownerType: string               // 多态类型标识
  ownerId: string                 // 关联实体的 id
  fileName: string
  filePath: string                // 可选：Tauri 本地相对路径
  fileSize: number
  mimeType: string                // 原件 MIME，用于图片/PDF 预览
  category: string                // 文件分类（合同/送货单/发票/证照/其他）
  uploader: string                // 上传人
  uploadedAt: string
}

interface FilePayload {
  fileRefId: string               // 1:1 引用 file_refs.id
  encoding: 'base64'              // pass-1 本地 SQLite 编码
  content: string                 // 文件正文，不进入通用附件列表与操作日志
}
```

#### 送货单原件持久化约束

- 新归档送货单的结构化单头、明细行和 `file_refs(category=source)` 在同一归档动作中写入本地 SQLite；原件不上传云端。
- `file_refs` 保持轻量元数据，文件正文单独存于 `file_payloads`。归档列表不查询、不 JOIN 正文；仅详情页和编辑页按 `ownerId` 单份懒加载。
- 业务字段编辑不得清空或覆盖原件引用；补传/替换原件走独立 action，不把文件正文复制进 `operation_logs`。
- 早期归档或手工建立的记录若没有原件字节，界面显示“历史记录未保存原件”并提供补传，不从 OCR 文本伪造扫描件。

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
| 变洽签审定额 | `SELECT SUM(taxIncAmount) FROM owner_change_orders WHERE projectId = ?`（台账=变更单自动行+手录纯金额签证，ADR-0002） |
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
| 进项票额 | `SELECT SUM(amount) FROM invoices WHERE project_id = ? AND account_status = 'archived'`（ADR-0001，反馈轮 9 已在设计稿联动验证） |
| 进项税额 | `SELECT SUM(tax_amount) FROM invoices WHERE project_id = ? AND account_status = 'archived'` |
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
| invoiceTotal | `SELECT SUM(amount) FROM invoices WHERE project_id = ? AND supplier_id = ? AND account_status = 'archived'` |
| balance | contractTotal − paidTotal |

### 4.5 可复用经营聚合（旧首页 Dashboard 指标）

> 2026-07-18：当前首页已裁定以统一施工进度甘特为准，本节只保留可复用的数据聚合口径，不代表首页必须展示指标卡或固定网格；旧 UI 蓝本见 `homepage-dashboard.md` 废弃横幅。

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

### 4.7 清单量差与产值（subcontract-quantity.md · CONTEXT.md「三量」「变更单」「月度报量」）

| 字段 | 计算 |
|---|---|
| 合同量（含变更） | `boq_lines` 原始行 + **已签证**变更行增量（`boq_change_orders.status='approved'` 的 `boq_change_lines.deltaQty`）；可另开参考口径含已上报 |
| 量差（分项×楼栋） | 基准量 − 合同量，基准量可勾选 = 合同 / 暂估 / 现场（`quantities` 三字段，项目级设置） |
| 量差金额 | 量差 × 合同单价（`boq_lines.unitPrice`，调价变更取已签证新单价） |
| 产值 | Σ完成量 × 合同单价，含已签证变更（CONTEXT.md「单价双轨」：合同单价轨） |
| 分项毛利 | (合同单价 − 班组分项单价) × 量（现场量未核定用暂估量预估） |
| 月度报量草稿行 | 当月 `quantities.completedMonth = 月` 的完成量 + 现场量 × 合同单价 → `monthly_statement_lines.autoQty` |

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
  28. invoices                    → projects, suppliers, expenditure_contracts（原 ticket_registrations 已废弃，ADR-0001）
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
  38. wage_statements             → projects, crews（原 payroll_records 细化拆分）

第 5 批（依赖第 4 批）
  39. rooms                       → units
  40. quantities  ⚠️ 按 ADR 0010 拆为 house_type_templates / house_type_template_items / unit_assignments（随工程量域批次 PRD 建表）

第 6 批（多态关联，无严格外键约束）
  41. file_refs                   → ownerType + ownerId（应用层保证一致性）

2026-07-04 增补（清单/变更/报量/送货单/工资，随各自批次建表）
  42. monthly_statements          → projects                       （第 2 批档位）
  43. boq_files                   → construction_contracts          （第 3 批档位）
  44. boq_change_orders           → projects, construction_contracts, owner_change_orders（第 3 批档位）
  45. delivery_records            → projects, suppliers             （第 3 批档位）
  46. monthly_statement_lines     → monthly_statements              （第 3 批档位）
  47. boq_lines                   → boq_files, projects, boq_change_orders（第 4 批档位）
  48. delivery_lines              → delivery_records                （第 4 批档位）
  49. wage_statement_lines        → wage_statements, workers        （第 5 批档位）
  50. attendance_records          → projects, workers               （第 5 批档位）
  51. boq_change_lines            → boq_change_orders, boq_lines    （第 5 批档位）

2026-07-06 增补（送货单工地名归一，随送货单批次建表）
  52. project_aliases             → projects                        （第 3 批档位）

2026-07-17 增补（送货单归档原件本地持久化）
  53. file_payloads               → file_refs                       （1:1 正文，仅按需读取）
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
CREATE INDEX idx_invoices_project ON invoices(project_id);
CREATE INDEX idx_invoices_supplier ON invoices(supplier_id);
CREATE INDEX idx_invoices_account ON invoices(account_status);

-- 证照查询
CREATE INDEX idx_supplier_credentials_sup ON supplier_credentials(supplierId);

-- 文件多态查询
CREATE INDEX idx_file_refs_owner ON file_refs(owner_type, owner_id);
CREATE UNIQUE INDEX uq_file_refs_delivery_source
  ON file_refs(owner_type, owner_id, category)
  WHERE deleted_at IS NULL AND owner_type = 'delivery_record' AND category = 'source';

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

-- 清单与变更
CREATE INDEX idx_boq_files_contract ON boq_files(contractId);
CREATE INDEX idx_boq_lines_file ON boq_lines(boqFileId);
CREATE INDEX idx_boq_lines_proj ON boq_lines(projectId);
CREATE INDEX idx_boq_co_proj ON boq_change_orders(projectId);
CREATE INDEX idx_boq_co_status ON boq_change_orders(status);   -- 200 份量级按状态筛选
CREATE INDEX idx_boq_cl_order ON boq_change_lines(changeOrderId);

-- 月度报量
CREATE INDEX idx_ms_proj_month ON monthly_statements(projectId, month);
CREATE INDEX idx_msl_statement ON monthly_statement_lines(statementId);

-- 送货单
CREATE INDEX idx_delivery_proj ON delivery_records(projectId);
CREATE INDEX idx_delivery_sup ON delivery_records(supplierId);
CREATE INDEX idx_delivery_lines_rec ON delivery_lines(deliveryRecordId);
-- 去重自然键（2026-07-06 定：全 ID 化，不用工地原文本；supplierId 为 NULL 不参与去重，本就带「缺公司」问题标记）
CREATE UNIQUE INDEX uq_delivery_natural ON delivery_records(projectId, supplierId, orderNo) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_project_alias ON project_aliases(alias) WHERE deleted_at IS NULL;

-- 工资与考勤
CREATE INDEX idx_ws_proj ON wage_statements(projectId);
CREATE INDEX idx_wsl_statement ON wage_statement_lines(statementId);
CREATE INDEX idx_att_worker ON attendance_records(workerId);

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

## § 8 撤回机制（V1 已落地，#52）

> 所有新增/编辑/删除操作需支持撤回。V1 用软删除 + 操作日志（已由 #52 实现），后续可扩展为后台管理回退面板。

### 8.1 软删除

所有业务表增加 `deleted_at TEXT DEFAULT NULL` 字段。删除操作不执行 `DELETE`，而是 `UPDATE SET deleted_at = datetime('now')`。

查询默认过滤已删除记录：`WHERE deleted_at IS NULL`。**注意该条件只查自身**——按 [ADR 0003](../adr/0003-confirm-dialog-deletion-model.md) 级联只标记父级，所有列表查询必须带「祖先未删」过滤（一条记录被隐藏 = 自身被删 OR 任一祖先被删）。读路径指引：单表读一律走 `app/lib/db/soft-delete.ts` 的 `selectVisibleSql(table, tail)`——唯一祝福读路径，整句可见查询，防止调用方漏拼前缀或条件的其中一半；只有 JOIN/聚合查询才用裸 `hiddenCtes(table)` + `visibleCond(table)` 自行组装。任何情况都不要手写 `deleted_at IS NULL` 单条件。

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
5. **级联撤回**：见 [ADR 0003](../adr/0003-confirm-dialog-deletion-model.md) 第 5 条——级联只标父级、撤回只恢复父级、下游按「祖先是否已删」自动重现（读取过滤本体见 §8.1）。

### 8.4 实施计划

- **V1（✅ 已落地，#52）**：全部业务表补 `deleted_at`（迁移 v2，`app/lib/db/migrations.ts`）+ `operation_logs` 表；统一封装在 `app/lib/db/soft-delete.ts`，对外缝级接口四个——`createSoftDeleteActions`（store 软删三连工厂 remove/restore/undo）、`withUpdateLog`（编辑落账三明治）、`logCreate`（新增落账）、`selectVisibleSql`（唯一祝福读路径，§8.1）；中层函数（`softDelete` / `restoreRecord` / `undoOperation` / `hiddenCtes` / `visibleCond`）供封装内部与 JOIN/聚合场景使用，不作为对外接口。4 个 store（project / supplier / invoice / project-supplier）接入并暴露 `remove` / `restore` / `undo`；测试见 `tests/db/soft-delete.test.ts`
- **V2**：后台管理面板展示操作日志，支持按时间/表/操作类型筛选和批量回退

---

## § 9 维护规则

1. 新增实体时必须同步更新本文件的 § 2 实体清单、§ 3 外键索引、§ 5 建表顺序、§ 6 索引
2. 各模块设计文档只定义业务字段，实体间关系统一在本文件管理
3. 所有业务表的删除操作使用软删除（§ 8.1），并记录操作日志（§ 8.2）
4. 字段命名规范：camelCase（TypeScript 侧）→ snake_case（SQLite 列名），ORM 层自动转换
5. 所有 id 字段使用 `{表缩写}_{timestamp36}_{seq36}` 格式（如 `sup_m1abc_0`）
6. 纯派生计算字段不存储，Pinia store 中提供 computed getter，底层走 SQL 聚合查询（§ 4）；人工复核后具有审计意义的值例外，例如 `delivery_lines.amount` 必须独立存储，不能在保存时重算覆盖
7. 新增支出类实体必须定义 **costCategory 归集口径**（人工/材料/机械/其他，§ 2.8），否则成本对比（§ 4.6）会漏项
8. 排程/进度类改动必须与 `schedule-progress.md` 双向同步（§ 2.7 / § 3.6 / § 4.6）；工程量矩阵表名/结构以 **[ADR 0010](../adr/0010-quantity-matrix-and-construction-record-model.md)** 为准（`house_type_templates` / `house_type_template_items` / `unit_assignments`，取代原 `quantities`），禁用旧名 `quantity_records`
9. **禁用旧名**（2026-07-04 grill 定稿）：`ticket_registrations`（→ `invoices` 单表，ADR-0001）、`payroll_records`（→ 工资三表 `wage_statements`/`wage_statement_lines`/`attendance_records`）、`price_comparisons`（→ `delivery_lines` 聚合查询视图，无表）
