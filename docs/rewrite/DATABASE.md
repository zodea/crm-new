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
│  │ExpenditureContr. │  │InvoiceApplication│  │Invoice           │         │
│  │  支出合同          │  │  开票申请          │  │  发票单表         │         │
│  │  projectId → Proj │  │  projectId → Proj │  │  owner_kind归属  │         │
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
projects ─1:N→ construction_stages ─1:N→ unit_stage_completions ←N:1─ units
    │                  ▲                              ▲
    │                  │ stage_id                     │ unit_id
    ├─1:N→ schedule_groups ═N:M═ buildings ─1:N→ floors ─1:N→ units
    │            (schedule_group_buildings)
    ├─1:N→ house_type_templates ─1:N→ rooms（稳定模板房间）
    │                  ▲                    └─1:N→ house_type_template_items
    │                  └────────N:1──────── units（户通过模板活链接读取房间）
    ├─1:N→ schedule_tasks（工序任务；project→group→task 由 project_id/group_id 表达，引用 stage_id）
    │        ├─ N:M → task_dependencies（FS/SS/FF/SF + lag）
    │        └─ 1:N → task_item_map ─(itemName)→ items ─→ house_type_template_items
    │                  实际完成率 = 分组内该阶段已完成户数 / 该阶段应做户数
    ├─1:N→ unit_assignments（户 × 工种责任；完成不存这里）
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
| SupplierCredentialRequirement | `supplier_credential_requirements` | `id` | `base-supplier.md`（#13 目标模型，待迁移落地） |
| FileRef | `file_refs` | `id` | 共用 |
| FilePayload | `file_payloads` | `fileRefId` | 共用（附件正文，仅按需读取） |
| BankCode | `bank_codes` | `id` | `base-worker.md` §五（银行行号字典，内置 seed，无外键） |

`suppliers.external_ref TEXT DEFAULT ''` 保存 ADR 0005 的「外部旧ID / 匹配标识」，作为旧系统迁移对账、二次导入修正与去重键；非空且未软删的记录必须唯一（迁移 v11）。

#### Supplier 字段语义（Issue #13）

| 字段 | 权威语义 | 必填/状态规则 |
|---|---|---|
| `address` | 营业执照登记的住所/注册地址 | 工商信息；不得与经营地址或开票地址混用 |
| `invoice_address` | 分供方确认使用的开票资料地址 | 选填；可从注册地址一次性复制，但保存后独立维护、不永久联动 |
| `phone` | 公司电话/开票资料电话 | 选填；与联系人手机 `contact_phone` 分开，不影响资料齐全度 |
| `taxpayer_type` | 纳税人类型 | 选填，默认“未核验”；经官方查询或人工资料确认后填写，“未查到”不得自动推导为“小规模纳税人” |
| `credential_status` | 资料齐全度与人工核验结论 | `incomplete` 缺失/过期；`reviewing` 齐全待核验；`qualified` 人工合格；`rejected` 人工退回 |

Issue #13 目标字段补充 `credential_reviewed_at TEXT NULL` 与 `credential_review_note TEXT DEFAULT ''`：人工通过记录时间和可选备注，人工退回时备注必填；操作人字段待账号体系落地后补充。系统只可按资料规则自动写入 `incomplete/reviewing`，不得自动写入 `qualified/rejected`。

广东省内分供方可从应用打开[广东省电子税务局一般纳税人资格查询](https://etax.guangdong.chinatax.gov.cn:8443/xxbg/view/zhsffw/#/query/ybnsrzgcx)辅助核验。应用只负责复制税号、打开官网及记录人工确认结果；验证码由用户在官网完成，不爬取页面、不绕过验证码，也不把该页面当作稳定 API。

`supplier_credential_requirements` 用于持久化“分供方 × 证照类别”的要求，而 `supplier_credentials` 只保存实际已收到的文件。目标字段至少包含 `supplier_id`、`category`、`requirement`（`not_applicable | optional | required`）、`reason`、`updated_at`，并对 `(supplier_id, category)` 唯一。默认规则：营业执照、法人身份证、银行账户资料为 `required`；资质证书、品牌授权书/证明为 `not_applicable`；其余资料为 `optional`。只有被明确改为 `required` 的条件资料，缺失或过期时才影响资料齐全度。

“银行账户资料”是统一业务类别，兼容“银行开户许可证 / 开户许可证 / 基本存款账户信息 / 基本存款账户信息表”等历史名称；“品牌授权书 / 品牌授权证明”同样按一个类别读取，迁移不得造成附件丢失或误报缺失。

已人工合格后，如必需资料的文件、分类、有效期、要求状态或相关 OCR 确认值发生变化，原核验结论必须失效并按规则重算；只修改可选资料不撤销合格。

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
| Contract | `contracts` | `id` | **合同域轻实体仓（#90 批A 新 IA，v3 迁移已落地）**：施工/分包/材采单表 `kind` 区分，对齐设计稿 `kit/data.js` contracts[]。四级金额链列（amount/changed/settled/invoiced/paid）为 seed 静态值，真聚合留后续 pass。`construction_contracts` / `expenditure_contracts` 为旧 IA 表（清单拆表/变更单线仍挂其上），迁移合并另起工序。⚠️ [ADR 0015](../adr/0015-form-persistence-and-payment-reconciliation.md) 已确认设计稿整页表单中的用户可编辑业务字段默认持久化；合同条款/质保金/开票方/明细行等具体列与迁移仍待 [#116](https://github.com/zodea/crm-new/issues/116) 逐实体 schema 回写，本警示在该评审完成前保留 |

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
| ExpenditureSettlement | `expenditure_settlements` | `id` | 支出合同过程/完工结算统一源单；与 `project_suppliers` 终态关闭用的 `settlements` 不同 |
| PaymentApplication | `payment_applications` | `id` | `finance-payment.md`（8 类型；ADR 0015） |
| PaymentApplicationSettlementAllocation | `payment_application_settlement_allocations` | `id` | 付款申请—真实结算分摊（ADR 0015） |
| PaymentApplicationInvoiceAllocation | `payment_application_invoice_allocations` | `id` | 付款申请—真实发票分摊（ADR 0015） |
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

```sql
-- 支出结算统一源单：承接分包、材料采购和其他支出结算，供付款申请真实选择。
-- project_suppliers 的 1:1 `settlements` 只表示合作关系终态关闭，不得作为付款勾稽源单。
CREATE TABLE expenditure_settlements (
  id             TEXT PRIMARY KEY,
  no             TEXT NOT NULL,
  name           TEXT NOT NULL,
  bizType        TEXT NOT NULL,       -- '人工' | '材料' | '分包' | '其他'
  projectId      TEXT NOT NULL,       -- → projects.id
  supplierId     TEXT NOT NULL,       -- → suppliers.id
  contractId     TEXT NOT NULL,       -- → contracts.id；仅支出侧 kind（分包/材采等）
  settlementType TEXT,                -- 过程结算/完工结算/零星用工等
  totalAmount    REAL NOT NULL,       -- 含税结算金额；付款勾稽展示与额度口径
  amount         REAL,                -- 不含税结算金额
  taxAmount      REAL,
  taxRate        REAL,
  settlementDate TEXT NOT NULL,
  status         TEXT DEFAULT '草稿',
  note           TEXT,
  createdAt TEXT, updatedAt TEXT, deleted_at TEXT
);

-- 付款申请头：可编辑标量落实体列；attachFiles 走 file_refs，不存 JSON。
-- `_biz` / `_c1`..`_c4` / `isPrepay` 等 readonly+compute 展示字段不存。
CREATE TABLE payment_applications (
  id             TEXT PRIMARY KEY,
  no             TEXT NOT NULL,
  name           TEXT NOT NULL,
  bizType        TEXT NOT NULL,       -- 有合同-人工/材料/分包、无合同-零星采购、预付款、管理费、项目费用、公司付款
  projectId      TEXT,                -- 公司付款可空 → projects.id
  supplierId     TEXT,                -- → suppliers.id；类型提交规则决定是否必填
  contractId     TEXT,                -- 有合同/预付款可选或必填 → contracts.id；保存真实 lookup ID
  costName       TEXT,
  applyAmount    REAL,
  applyDate      TEXT,
  applicant      TEXT,
  invoiceState   TEXT,                -- '先票后款' | '先款后票' | '无需发票'
  payContent     TEXT,
  prepayDeduct   REAL,
  prepayNote     TEXT,
  approvedAmount REAL,
  paidAmount     REAL,
  status         TEXT DEFAULT '草稿',
  note           TEXT,
  createdAt TEXT, updatedAt TEXT, deleted_at TEXT
);

CREATE TABLE payment_application_settlement_allocations (
  id                   TEXT PRIMARY KEY,
  paymentApplicationId TEXT NOT NULL, -- → payment_applications.id
  settlementId         TEXT NOT NULL, -- → expenditure_settlements.id；单号/名称/含税结算金额均从源单读取
  allocatedAmount      REAL NOT NULL,
  note                 TEXT,
  createdAt TEXT, updatedAt TEXT, deleted_at TEXT
);

CREATE TABLE payment_application_invoice_allocations (
  id                   TEXT PRIMARY KEY,
  paymentApplicationId TEXT NOT NULL, -- → payment_applications.id
  invoiceId            TEXT NOT NULL, -- → invoices.id；票号/日期/含税金额均从源票读取
  allocatedAmount      REAL NOT NULL,
  note                 TEXT,
  createdAt TEXT, updatedAt TEXT, deleted_at TEXT
);
```

付款申请头与两类分摊行必须由同一个 store action 在事务内保存。草稿允许金额不平并显示差额；提交规则、`先款后票`待回票金额与单票全局额度见 `finance-payment.md` 和 ADR 0015。

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
| HouseTypeTemplateItem | `house_type_template_items` | `id` | **ADR 0010**：模板明细/三量（稳定模板房间×分项，工种从分项读取；清单量/暂估量/现场量算式，户型层共享、量可手改留痕） |
| ConstructionStage | `construction_stages` | `id` | **ADR 0010**：项目工序阶段目录，给 #103 完成事实与 #114 排程共享稳定 ID |
| ConstructionStageItem | `construction_stage_items` | `id` | 工序阶段 ↔ 计量分项映射，圈定应做户与下钻范围；`is_reporting_stage=1` 是该分项唯一月度报量阶段 |
| UnitAssignment | `unit_assignments` | `id` | **ADR 0010**：户 × 工种责任（只表达谁负责，不存完成） |
| UnitAssignmentScope | `unit_assignment_scopes` | `id` | 个人指派可选模板房间 × 分项下钻范围；户身份由所属指派提供 |
| UnitStageCompletion | `unit_stage_completions` | `id` | **ADR 0010**：户 × 工序阶段完成事实（状态/日期/照片软卡） |
| ~~Quantity~~ | ~~`quantities`~~ | — | **已废弃**：原“分项 × 房间 × 工人 × 完成月份”合一表拆为户型模板量、户 × 工种责任和户 × 工序阶段完成；禁用旧表和 `completedMonth` |
| WageStatement | `wage_statements` | `id` | ⚠️ 口径已随 [#117](https://github.com/zodea/crm-new/issues/117) 进度款域重构更新（2026-07-20）：单据主体=**负责人请款簿**（请款主体×月），三态生命周期（草稿/已核对/已发放固化实际金额）、单据级比例、格式族 A/B/C1/C2、全项目递增请款序号；「本期支付总额权重分摊」待 #117 未决⑥。**字段细化随工资域批次 PRD**，以 #117 定稿为权威 |
| WageStatementLine | `wage_statement_lines` | `id` | 同上（工人行快照：应发/实发可直改/开户行/卡号） |
| AttendanceRecord | `attendance_records` | `id` | 考勤（工人×日期×工时，**待细化**） |

> ~~PayrollRecord `payroll_records`~~ **已细化拆分**为上述工资三表（禁用旧名）。工资单是**快照**（生成时计算应发 + 人工改实发），不是纯计算视图——反馈轮 8 定稿「实发逐人可直改」。

以下是 #103 的目标物理模型；列名统一为 snake_case。模板房间直接落 `rooms`，但它属于户型模板而非某一户；某户的房间实例由 `(unit_id, room_id)` 组合指认，不建立逐户房间副本。

```sql
CREATE TABLE items (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  section    TEXT,
  trade      TEXT NOT NULL,
  unit       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE buildings (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE floors (
  id          TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

CREATE TABLE house_type_templates (
  id                      TEXT PRIMARY KEY,
  project_id              TEXT NOT NULL REFERENCES projects(id),
  code                    TEXT NOT NULL,
  name                    TEXT,
  copied_from_template_id TEXT REFERENCES house_type_templates(id),
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at              TEXT
);

CREATE TABLE rooms (
  id          TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES house_type_templates(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'room' CHECK (kind IN ('room', 'whole_unit')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

CREATE TABLE units (
  id                     TEXT PRIMARY KEY,
  floor_id               TEXT NOT NULL REFERENCES floors(id),
  house_type_template_id TEXT NOT NULL REFERENCES house_type_templates(id),
  code                   TEXT NOT NULL,
  name                   TEXT,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT
);

CREATE TABLE house_type_template_items (
  id                      TEXT PRIMARY KEY,
  room_id                 TEXT NOT NULL REFERENCES rooms(id),
  item_id                 TEXT NOT NULL REFERENCES items(id),
  recognized_contract_qty REAL,
  contract_qty            REAL,
  provisional_qty         REAL,
  field_formula           TEXT,
  field_qty               REAL,
  note                    TEXT,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at              TEXT
);

CREATE TABLE construction_stages (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  trade           TEXT NOT NULL,
  completion_mode TEXT NOT NULL DEFAULT 'unit' CHECK (completion_mode IN ('unit', 'manual')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

CREATE TABLE construction_stage_items (
  id                 TEXT PRIMARY KEY,
  stage_id           TEXT NOT NULL REFERENCES construction_stages(id),
  item_id            TEXT NOT NULL REFERENCES items(id),
  is_reporting_stage INTEGER NOT NULL DEFAULT 0 CHECK (is_reporting_stage IN (0, 1)),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT
);

CREATE TABLE unit_assignments (
  id         TEXT PRIMARY KEY,
  unit_id    TEXT NOT NULL REFERENCES units(id),
  trade      TEXT NOT NULL,
  crew_id    TEXT REFERENCES crews(id),
  worker_id  TEXT REFERENCES workers(id),
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  CHECK (
    (crew_id IS NOT NULL AND worker_id IS NULL)
    OR (crew_id IS NULL AND worker_id IS NOT NULL)
  )
);

CREATE TABLE unit_assignment_scopes (
  id            TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES unit_assignments(id),
  room_id       TEXT NOT NULL REFERENCES rooms(id),
  item_id       TEXT NOT NULL REFERENCES items(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE TABLE unit_stage_completions (
  id            TEXT PRIMARY KEY,
  unit_id       TEXT NOT NULL REFERENCES units(id),
  stage_id      TEXT NOT NULL REFERENCES construction_stages(id),
  assignment_id TEXT REFERENCES unit_assignments(id),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  completed_at  TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT,
  CHECK (status = 'draft' OR (completed_at IS NOT NULL AND assignment_id IS NOT NULL))
);

ALTER TABLE projects ADD COLUMN matrix_archived_at TEXT;
-- 验收照片走 file_refs(owner_type='unit_stage_completion', owner_id=完成事实 id)。

CREATE TRIGGER trg_house_type_templates_whole_unit
AFTER INSERT ON house_type_templates
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO rooms (id, template_id, code, name, kind, sort_order)
  VALUES (NEW.id || ':whole_unit', NEW.id, '__whole_unit__', '整户范围', 'whole_unit', -1);
END;

CREATE TRIGGER trg_rooms_keep_whole_unit
BEFORE UPDATE OF deleted_at ON rooms
WHEN OLD.kind = 'whole_unit' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'whole_unit room cannot be deleted');
END;
```

每个户型模板必须有且仅有一个 `kind='whole_unit'` 的稳定“整户范围”节点，承接合同清单中没有天然房间粒度的整户/分部项；v12 在模板插入时自动创建该系统节点，并禁止单独软删，模板整体软删仍由祖先可见性隐藏。普通模板房间使用 `kind='room'`。两类节点都使用稳定 ID；`rooms.code` 是模板内唯一、创建后不可修改的机器码，界面可修改的是 `rooms.name` 显示名。`house_type_template_items.room_id` 不允许为空。

同一分项可以映射多个施工阶段以分别计算进度，但月度报量只能选择其中一个活跃映射：`construction_stage_items.is_reporting_stage=1`。v13 对存量按阶段排序最末项作一次性兼容回填，并用活跃部分唯一索引保证每个 `item_id` 最多一个报量阶段；月度派生只读取该映射，避免同量重复计取。

责任人或个人范围任一变化，都采用“软删旧 `unit_assignments`（旧 scope 随父级保留并隐藏）+ 新建 assignment/scopes”，不得原地改写。`unit_stage_completions.assignment_id` 只保存完成时的执行责任审计引用，不是完成事实的可见性父级；历史施工记录可按该物理 ID 读取已软删责任、范围及责任人，仍须先保证完成事实本身及其户、阶段可见。历史只冻结责任/范围身份，房间显示名与三量仍从当前活链接模板读取；已发放工资才按 #117 固化金额快照。

下列同域约束不能只靠单列外键表达，必须由同一个 quantity store transaction 在写入前校验：

- 户经楼层、楼栋归属的项目必须与其户型模板项目相同；详情路由的 `pid` 也必须等于该项目。
- 模板明细的模板房间与分项必须属于同一项目。
- 阶段与阶段分项必须属于同一项目，且工种匹配。
- 个人范围的模板房间必须属于该户挂靠模板，分项必须匹配指派工种且存在有效模板明细。
- 阶段完成的户、阶段必须属于同一项目；完成责任必须属于同一户且工种与阶段匹配。

可见性父链刻意排除两项审计引用：`house_type_templates.copied_from_template_id` 只是一次性复制来源，删除来源不隐藏复制件；`unit_stage_completions.assignment_id` 只是完成时责任，软删旧责任不隐藏完成事实。

### 2.7 施工进度类（工期 × 工程量主线）

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| Building | `buildings` | `id` | `subcontract-quantity.md`（区域树·楼栋） |
| Floor | `floors` | `id` | `subcontract-quantity.md`（楼层） |
| Unit | `units` | `id` | `subcontract-quantity.md`（户） |
| Room | `rooms` | `id` | `subcontract-quantity.md`（户型模板内的稳定范围节点：普通房间或整户范围；不按户物化） |
| ScheduleGroup | `schedule_groups` | `id` | `schedule-progress.md`（楼栋分组） |
| ScheduleGroupBuilding | `schedule_group_buildings` | `id` | `schedule-progress.md`（分组×楼栋） |
| ScheduleTask | `schedule_tasks` | `id` | `schedule-progress.md`（工序/WBS） |
| TaskDependency | `task_dependencies` | `id` | `schedule-progress.md`（前后置依赖） |
| TaskItemMap | `task_item_map` | `id` | `schedule-progress.md`（工序↔分项） |

> `ScheduleGroup.contractId` 为必填逻辑外键，指向且只指向一份 `ConstructionContract`；`projectId` 必须与合同所属项目一致。分组候选楼栋、户型和套数由该合同下已确认的 `boq_files` / `boq_lines` 拆表结果提供，禁止跨合同混组。当前 `contracts` 轻实体与 `construction_contracts` 旧 IA 尚待 #115/#116 收口，新增迁移前必须统一到合同域 canonical ID，不能同时保存两套合同引用。
> `schedule_tasks.stage_id` 引用 `construction_stages.id`。工序 `has_qty=1` 按楼栋分组聚合 `unit_stage_completions`，`=0` 才读 `manual_progress`；墙砖/地砖、一遍/二遍腻子使用不同 `stage_id`。
> `schedule_tasks` 预留 `baseline_start/baseline_finish`（「设为基线」= 保存当前计划快照，NULL=未设基线）。

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
| `payment_applications` | `contractId` | `contracts.id` | N:1 | 付款申请 → 合同域轻实体仓中的支出侧合同（可选） |
| `expenditure_settlements` | `projectId` / `supplierId` / `contractId` | `projects.id` / `suppliers.id` / `contracts.id` | N:1 | 支出合同结算统一源单；区别于合作关系终态 `settlements` |
| `payment_application_settlement_allocations` | `paymentApplicationId` / `settlementId` | `payment_applications.id` / `expenditure_settlements.id` | N:1 | 付款申请—真实支出结算分摊；源单字段不复制 |
| `payment_application_invoice_allocations` | `paymentApplicationId` / `invoiceId` | `payment_applications.id` / `invoices.id` | N:1 | 付款申请—真实发票分摊；跨申请累计不得超票额 |
| `current_receipts` | `projectId` | `projects.id` | N:1 | 往来收款 → 项目 |
| `current_payments` | `projectId` | `projects.id` | N:1 | 往来付款 → 项目 |
| `payment_records` | `projectId` | `projects.id` | N:1 | 支付记录 → 项目 |
| `payment_records` | `paymentApplicationId` | `payment_applications.id` | N:1 | 支付记录 → 付款申请（零星支付可空） |

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
| `items` | `project_id` | `projects.id` | N:1 | 分项定义（项目×分部/工种，**不挂班组**——合同计量口径） |
| `house_type_templates` | `project_id` | `projects.id` | N:1 | 项目户型模板 |
| `rooms` | `template_id` | `house_type_templates.id` | N:1 | 稳定模板房间；显示名可改，不按户复制 |
| `house_type_template_items` | `room_id` / `item_id` | `rooms.id` / `items.id` | N:1 | 户型层三量明细；模板由房间归属唯一确定 |
| `construction_stages` | `project_id` | `projects.id` | N:1 | 项目工序阶段目录 |
| `construction_stage_items` | `stage_id` / `item_id` | `construction_stages.id` / `items.id` | N:1 | 阶段 ↔ 计量分项 |
| `unit_assignments` | `unit_id` / `crew_id` / `worker_id` | `units.id` / `crews.id` / `workers.id` | N:1 | 户 × 工种责任，不存完成；班组/个人二选一 |
| `unit_assignment_scopes` | `assignment_id` / `room_id` / `item_id` | `unit_assignments.id` / `rooms.id` / `items.id` | N:1 | 个人指派模板房间 × 分项下钻；户由 assignment 唯一确定 |
| `unit_stage_completions` | `unit_id` / `stage_id` / `assignment_id` | `units.id` / `construction_stages.id` / `unit_assignments.id` | N:1 | 户 × 工序阶段完成事实；assignment 只作完成时责任审计引用 |
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
| `expenditure_settlement` | ExpenditureSettlement | 支出过程/完工结算单及对账附件 |
| `construction_contract` | ConstructionContract | 施工合同文书扫描件（Tab③ 文件柜 chip 在线预览） |
| `supplement_agreement` | SupplementAgreement | 补充协议文书 |
| `boq_change_order` | BoqChangeOrder | 变更单附件，category 细分**各有放置区**：我方指令单（可多版）/ 甲方指令单 / 报价 / 算量 / 施工照片 |
| `expenditure_contract` | ExpenditureContract | 合同扫描件 |
| `payment_application` | PaymentApplication | 付款附件 |
| `invoice` | Invoice | 发票原图（原 `ticket_registration` 已随 ADR-0001 废弃） |
| `delivery_record` | DeliveryRecord | 送货单扫描件（`category=source`，每张归档记录一份当前原件） |
| `unit_stage_completion` | UnitStageCompletion | 验收照片（挂“户 × 工序阶段”；缺照片只允许取消/存草稿） |
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
| `buildings` | `project_id` | `projects.id` | N:1 | 楼栋 → 项目 |
| `floors` | `building_id` | `buildings.id` | N:1 | 楼层 → 楼栋 |
| `units` | `floor_id` | `floors.id` | N:1 | 户 → 楼层 |
| `units` | `house_type_template_id` | `house_type_templates.id` | N:1 | 户 → 户型模板；房间通过模板活链接派生 |
| `schedule_groups` | `projectId` | `projects.id` | N:1 | 楼栋分组 → 项目 |
| `schedule_groups` | `contractId` | `ConstructionContract` canonical ID | N:1 | 楼栋分组 → 唯一施工合同；必填、项目必须一致、禁止跨合同混组；物理目标待 #115/#116 合同实体收口后统一 |
| `schedule_group_buildings` | `groupId` | `schedule_groups.id` | N:1 | 分组×楼栋 |
| `schedule_group_buildings` | `buildingId` | `buildings.id` | N:1 | 一分组含多栋 |
| `schedule_tasks` | `projectId` | `projects.id` | N:1 | 工序 → 项目 |
| `schedule_tasks` | `groupId` | `schedule_groups.id` | N:1 | 工序 → 楼栋分组；项目/分组 summary 直接由对应实体及其子工序派生，不复制为任务行 |
| `schedule_tasks` | `parentId` | `schedule_tasks.id` | N:1 | 可选的工序任务 → 子任务扩展；当前项目→分组→工序三层由实体外键表达，普通工序为 NULL |
| `schedule_tasks` | `stage_id` | `construction_stages.id` | N:1 | 工序任务 → 稳定阶段；`has_qty=1` 必填 |
| `task_dependencies` | `predId` / `succId` | `schedule_tasks.id` | N:1 | 前后置依赖（FS/SS/FF/SF + lag） |
| `task_item_map` | `taskId` | `schedule_tasks.id` | N:1 | 工序 → 分项映射 |

> 工序实际进度不另存值：运行时按 `schedule_tasks.stage_id` + `schedule_group_buildings` 聚合 `unit_stage_completions(status='completed')`；`task_item_map` 只圈定应做户、量值和下钻范围（见 `schedule-progress.md` §五）。

> 可见性特例：`unit_stage_completions.assignment_id` 不登记为完成事实的祖先关系。普通责任列表过滤已软删指派；历史施工记录则在完成事实、户和阶段均可见的前提下，按物理 ID 直连旧指派及其班组/工人记录，避免责任替换吞掉历史完成。

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
| 付款金额 | `SELECT SUM(paidAmount) FROM payment_applications WHERE projectId = ? AND deleted_at IS NULL` |
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

### 4.2.1 付款申请勾稽（finance-payment.md · ADR 0015）

| 字段 | 计算 |
|---|---|
| 关联结算金额 | `SUM(payment_application_settlement_allocations.allocatedAmount)`，只计未软删行 |
| 结算差额 | `payment_applications.applyAmount − 关联结算金额`；有合同三类提交时必须为 0 |
| 关联发票金额 | `SUM(payment_application_invoice_allocations.allocatedAmount)`，只计未软删行 |
| 待回票金额 | `max(payment_applications.applyAmount − 关联发票金额, 0)`；仅 `invoiceState='先款后票'` 展示 |
| 单票剩余可关联金额 | `invoices.total_amount − SUM(该 invoiceId 跨全部付款申请的有效 allocatedAmount)`；写入后不得小于 0 |

### 4.3 分供方汇总（base-supplier.md）

| 字段 | SQL 计算 |
|---|---|
| 合作项目数 | `SELECT COUNT(*) FROM project_suppliers WHERE supplierId = ?` |
| 合同数 | `SELECT COUNT(*) FROM expenditure_contracts WHERE supplierId = ?` |
| 合同总额 | `SELECT SUM(taxIncTotal) FROM expenditure_contracts WHERE supplierId = ?` |
| 累计已付 | `SELECT SUM(paidAmount) FROM payment_applications WHERE supplierId = ? AND deleted_at IS NULL` |
| 应付余额 | 合同总额 − 累计已付 |

### 4.4 ProjectSupplier 汇总（project-supplier.md）

| 字段 | SQL 计算 |
|---|---|
| contractTotal | `SELECT SUM(taxIncTotal) FROM expenditure_contracts WHERE projectId = ? AND supplierId = ?` |
| claimedTotal | `SELECT SUM(amount) FROM payment_applications WHERE projectId = ? AND supplierId = ? AND approvalStatus = 'approved'` |
| paidTotal | `SELECT SUM(paidAmount) FROM payment_applications WHERE projectId = ? AND supplierId = ? AND deleted_at IS NULL` |
| invoiceTotal | `SELECT SUM(amount) FROM invoices WHERE project_id = ? AND supplier_id = ? AND account_status = 'archived'` |
| balance | contractTotal − paidTotal |

### 4.5 可复用经营聚合（旧首页 Dashboard 指标）

> 2026-07-18：当前首页已裁定以统一施工进度甘特为准，本节只保留可复用的数据聚合口径，不代表首页必须展示指标卡或固定网格；旧 UI 蓝本见 `homepage-dashboard.md` 废弃横幅。

| 字段 | SQL 计算 |
|---|---|
| 合同总额 | `SELECT SUM(amount) FROM construction_contracts WHERE projectId = ?` + 变更 |
| 累计收款 | `SELECT SUM(amount) FROM receipt_registrations WHERE projectId = ?` |
| 累计支出 | `SELECT SUM(paidAmount) FROM payment_applications WHERE projectId = ? AND deleted_at IS NULL` |
| 已开票额 | `SELECT SUM(amount) FROM invoice_applications WHERE projectId = ?` |
| 材料分供方数 | `SELECT COUNT(DISTINCT supplierId) FROM project_suppliers ps JOIN suppliers s ON ps.supplierId = s.id WHERE ps.projectId = ? AND s.supplierCategory = '材料供应商'` |
| 采购合同数 | `SELECT COUNT(*) FROM expenditure_contracts WHERE projectId = ? AND contractType = '材料采购'` |

### 4.6 施工进度与成本对比（schedule-progress.md）

| 字段 | 计算 |
|---|---|
| 工序实际完成率（`has_qty=1`） | 分组内该 `stage_id` 已完成户数 ÷ 应做户数；分子查 `unit_stage_completions.status='completed'`，分母由 `construction_stage_items` / `task_item_map` 与户型模板适用范围圈定 |
| 工序实际完成率（`has_qty=0`） | `schedule_tasks.manual_progress` |
| 工序计划应完成率 | `clamp((today − plannedStart) / (plannedFinish − plannedStart), 0, 1)` |
| 提前/延后天数 | `(实际完成率 − 计划应完成率) × durationDays`（分组/项目行按子工序工期加权） |
| 项目目标成本（按科目） | `SELECT costCategory, SUM(amount) FROM target_cost_items ti JOIN target_costs t ON ti.targetCostId=t.id WHERE t.projectId=? AND t.isBaseline=1 GROUP BY costCategory` |
| 项目实际成本（按科目） | 按 §2.8 costCategory 约定归集：人工=劳务/分包付款+工资；材料=材料合同付款+送货单；机械=设备租赁付款；其他=报销+其他支出 |
| 成本偏差率 | `(实际 − 目标) / 目标`（科目级与合计级） |

### 4.7 清单量差与产值（subcontract-quantity.md · CONTEXT.md「三量」「变更单」「月度报量」）

| 字段 | 计算 |
|---|---|
| 合同量（含变更） | `boq_lines` 原始行 + **已签证**变更行增量（`boq_change_orders.status='approved'` 的 `boq_change_lines.deltaQty`）；可另开参考口径含已上报 |
| 量差（分项×楼栋） | 基准量 − 合同量，基准量可勾选 = 合同 / 暂估 / 现场（`house_type_template_items` 三量，按挂靠户展开到楼栋） |
| 量差金额 | 量差 × 合同单价（`boq_lines.unitPrice`，调价变更取已签证新单价） |
| 产值 | Σ完成量 × 合同单价，含已签证变更（CONTEXT.md「单价双轨」：合同单价轨） |
| 分项毛利 | (合同单价 − 班组分项单价) × 量（现场量未核定用暂估量预估） |
| 月度报量草稿行 | 按报量阶段映射筛当月 `unit_stage_completions.completed_at`，连接户型模板现场量 × 合同单价 → `monthly_statement_lines.autoQty`；同一分项映射多阶段不得重复计量 |

---

## § 5 SQLite 建表顺序

按外键依赖排序，先建被引用的表；同批次内仍按下列先后执行：

```
第 1 批（无外键依赖）
  projects, suppliers, bank_codes, crews, workers

第 2 批（只依赖第 1 批）
  supplier_credentials, project_suppliers, phase_tasks
  construction_contracts, owner_change_orders, expenditure_contracts, contracts
  invoice_applications, receipt_registrations, current_receipts, current_payments
  buildings, schedule_groups, target_costs, items
  crew_workers, crew_project_config, worker_certs, penalty_records
  construction_stages, house_type_templates, monthly_statements

第 3 批（依赖第 2 批）
  settlements, supplement_agreements, contract_line_items, expenditure_settlements
  invoices, payment_applications
  floors, rooms, schedule_group_buildings, schedule_tasks, target_cost_items
  crew_project_items, construction_stage_items
  boq_files, boq_change_orders, delivery_records, project_aliases

第 4 批（依赖第 3 批）
  units, house_type_template_items, task_dependencies, task_item_map
  payment_application_settlement_allocations
  payment_application_invoice_allocations
  payment_records
  monthly_statement_lines, boq_lines, delivery_lines, wage_statements

第 5 批（依赖第 4 批）
  unit_assignments, unit_stage_completions
  wage_statement_lines, attendance_records, boq_change_lines

第 6 批（依赖模板 rooms / unit_assignments）
  unit_assignment_scopes

第 7 批（多态关联）
  file_refs → ownerType + ownerId（应用层保证一致性）
  file_payloads → file_refs（1:1 正文，仅按需读取）
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
CREATE INDEX idx_expenditure_settlements_proj ON expenditure_settlements(projectId);
CREATE INDEX idx_expenditure_settlements_sup ON expenditure_settlements(supplierId);
CREATE INDEX idx_expenditure_settlements_contract ON expenditure_settlements(contractId);
CREATE INDEX idx_pasa_application ON payment_application_settlement_allocations(paymentApplicationId);
CREATE INDEX idx_pasa_settlement ON payment_application_settlement_allocations(settlementId);
CREATE INDEX idx_paia_application ON payment_application_invoice_allocations(paymentApplicationId);
CREATE INDEX idx_paia_invoice ON payment_application_invoice_allocations(invoiceId);
CREATE UNIQUE INDEX uq_pasa_source ON payment_application_settlement_allocations(paymentApplicationId, settlementId) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_paia_source ON payment_application_invoice_allocations(paymentApplicationId, invoiceId) WHERE deleted_at IS NULL;
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
CREATE INDEX idx_buildings_project ON buildings(project_id);
CREATE UNIQUE INDEX uq_building_code ON buildings(project_id, code) WHERE deleted_at IS NULL;
CREATE INDEX idx_floors_building ON floors(building_id);
CREATE UNIQUE INDEX uq_floor_code ON floors(building_id, code) WHERE deleted_at IS NULL;
CREATE INDEX idx_units_floor ON units(floor_id);
CREATE INDEX idx_units_template ON units(house_type_template_id);
CREATE UNIQUE INDEX uq_unit_code ON units(floor_id, code) WHERE deleted_at IS NULL;
CREATE INDEX idx_rooms_template ON rooms(template_id);
CREATE UNIQUE INDEX uq_room_code ON rooms(template_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_room_whole_unit ON rooms(template_id) WHERE deleted_at IS NULL AND kind = 'whole_unit';
CREATE INDEX idx_items_project ON items(project_id);
CREATE UNIQUE INDEX uq_item_code ON items(project_id, code) WHERE deleted_at IS NULL;
CREATE INDEX idx_ht_project ON house_type_templates(project_id);
CREATE UNIQUE INDEX uq_ht_code ON house_type_templates(project_id, code) WHERE deleted_at IS NULL;
CREATE INDEX idx_hti_room ON house_type_template_items(room_id);
CREATE INDEX idx_hti_item ON house_type_template_items(item_id);
CREATE UNIQUE INDEX uq_hti_room_item ON house_type_template_items(room_id, item_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_stages_project ON construction_stages(project_id);
CREATE UNIQUE INDEX uq_stage_code ON construction_stages(project_id, code) WHERE deleted_at IS NULL;
CREATE INDEX idx_stage_items_stage ON construction_stage_items(stage_id);
CREATE UNIQUE INDEX uq_stage_item ON construction_stage_items(stage_id, item_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_stage_item_reporting ON construction_stage_items(item_id) WHERE deleted_at IS NULL AND is_reporting_stage = 1;
CREATE INDEX idx_unit_assignments_unit ON unit_assignments(unit_id);
CREATE INDEX idx_unit_assignments_crew ON unit_assignments(crew_id);
CREATE INDEX idx_unit_assignments_worker ON unit_assignments(worker_id);
CREATE INDEX idx_unit_assignments_trade ON unit_assignments(trade);
CREATE UNIQUE INDEX uq_unit_assignment_trade ON unit_assignments(unit_id, trade) WHERE deleted_at IS NULL;
CREATE INDEX idx_uas_assignment ON unit_assignment_scopes(assignment_id);
CREATE UNIQUE INDEX uq_uas_scope ON unit_assignment_scopes(assignment_id, room_id, item_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_usc_stage_date ON unit_stage_completions(stage_id, completed_at);
CREATE INDEX idx_usc_unit ON unit_stage_completions(unit_id);
CREATE INDEX idx_usc_assignment ON unit_stage_completions(assignment_id);
CREATE UNIQUE INDEX uq_usc_unit_stage ON unit_stage_completions(unit_id, stage_id) WHERE deleted_at IS NULL;

-- 软删隐藏集基础臂
CREATE INDEX idx_items_deleted ON items(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_buildings_deleted ON buildings(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_floors_deleted ON floors(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_house_type_templates_deleted ON house_type_templates(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_rooms_deleted ON rooms(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_units_deleted ON units(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_house_type_template_items_deleted ON house_type_template_items(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_construction_stages_deleted ON construction_stages(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_construction_stage_items_deleted ON construction_stage_items(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_unit_assignments_deleted ON unit_assignments(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_unit_assignment_scopes_deleted ON unit_assignment_scopes(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_unit_stage_completions_deleted ON unit_stage_completions(deleted_at) WHERE deleted_at IS NOT NULL;

-- 施工进度
CREATE INDEX idx_schedule_groups_proj ON schedule_groups(projectId);
CREATE INDEX idx_sgb_group ON schedule_group_buildings(groupId);
CREATE INDEX idx_schedule_tasks_proj ON schedule_tasks(projectId);
CREATE INDEX idx_schedule_tasks_group ON schedule_tasks(groupId);
CREATE INDEX idx_schedule_tasks_stage ON schedule_tasks(stageId);
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
6. 旧 `credential_status` 按新必需资料和有效期重新计算：缺失/过期 → `incomplete`；齐全 → `reviewing`。没有人工核验时间/备注凭证的旧自动 `qualified` 不得迁为人工合格，也应进入 `reviewing`；旧 `rejected` 仅在有明确退回凭证时保留，否则同样重算。迁移不得伪造 `credential_reviewed_at` 或核验备注。

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

新写入的 `delete` 日志同时保存 `before_data` 与含精确 `deleted_at` 的 `after_data`，供需要并发保护的严格撤回做操作后快照比对；历史 `delete` 日志的 `after_data` 允许为空，兼容路径按 `before_data` 与当前删除态判断。

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
6. 遵守 [ADR 0015](../adr/0015-form-persistence-and-payment-reconciliation.md)：用户可编辑业务字段默认持久化（标量列 / lookup 外键 / grid 子表 / file_refs）；`readonly + compute`、`_` 展示字段和纯聚合不存。人工复核后具有审计意义的值例外，例如 `delivery_lines.amount` 必须独立存储，不能在保存时重算覆盖
7. 新增支出类实体必须定义 **costCategory 归集口径**（人工/材料/机械/其他，§ 2.8），否则成本对比（§ 4.6）会漏项
8. 排程/进度类改动必须与 `schedule-progress.md` 双向同步（§ 2.7 / § 3.6 / § 4.6）；工程量矩阵以 **[ADR 0010](../adr/0010-quantity-matrix-and-construction-record-model.md)** 为准：量=`house_type_template_items`、责任=`unit_assignments`、完成=`unit_stage_completions`，稳定阶段=`construction_stages`
9. 付款申请头与结算/发票分摊必须由同一 action 事务写入；源单展示字段不得复制，提交勾稽与发票全局额度检查遵守 ADR 0015
10. **禁用旧名**：`ticket_registrations`（→ `invoices` 单表，ADR-0001）、`payroll_records`（→ 工资三表）、`price_comparisons`（→ `delivery_lines` 聚合视图）、`quantities` / `quantity_records`（→ ADR 0010 分层表）
