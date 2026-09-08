# 数据库设计 — 全局实体关系 + 外键索引 + 建表顺序

> 本文件是现有 SQLite 迁移来源（tauri-plugin-sql / sql.js）的实体与外键权威。浏览器中央权威与本地快照隔离由 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md) 裁定；后台物理库结构待迁移切片落地，不能把本文件中的本地 seed 策略解释为正式工作区初始化。

当前落地事实（#279、#294、#320、#321）：浏览器 `production` 快照只运行迁移、不 seed；只有服务端授予 `demo:read` 后，`demo` 快照才运行现有 JSON、工程量、BOQ 与排程 seed，并在初始化后以只允许 `SELECT` 的驱动暴露。Tauri 不消费浏览器演示偏好，仍只连接原有 `sqlite:crm.db`。`dataOrigin` 是 Repository/DTO 的来源属性，不写进业务名称、编号或金额，也不允许用 `*_demo_*` 字符串前缀反推。既有本地数据中六类核心身份与 canonical 施工/分包合同的一次性分类、ID 映射、导入、对账和回滚使用同一受控迁移；其余领域仍由后续迁移票完成。

当前落地事实（#293）：浏览器的正式项目新增/编辑已改由中央命令分配不透明 `projects.id`、记录递增 `version` 并生成最终更新时间。网络失败时的 `project-draft-*` 只是浏览器暂存意图，不是 `projects.id`、不得作外键。详细信封、幂等与冲突语义见 [`COMMANDS.md`](./COMMANDS.md)。

当前落地事实（#294、#315、#316、#317、#320、#321）：浏览器可把 `production` 快照中的客户、分供方、班组、项目、canonical 施工合同、canonical 分包合同、工人、项目分供方按此顺序迁入中央契约。确认切换后六类身份与施工/分包合同的旧库普通读写均阻断，旧库只作为受保护备份的恢复来源。#317 未改变 SQLite 物理 schema；项目分供方工作台经中央 Repository 以同来源项目 ID 与分供方 ID 验证关系，并聚合有效合同及补充协议、有效请款、已归档发票、已确认支付分摊、确认支出结算与文件元数据。不得读取 `contracts.settled/invoiced/paid` 旧累计列，不得把项目分供方名称或金额作为关系键，也不得为浏览器保留本地 SQL 工作台旁路。当前中央端仍是可重置测试实例，不得被描述为生产持久化业务库。

当前落地事实（#318）：浏览器材料采购合同按 `(dataOrigin, contractId)` 从中央 Repository 读取，只有 `kind='材采'` 才进入该详情；项目、分供方、明细、发票、付款、结算、罚扣、下料、到货和文件均以稳定 ID/外键归属，零记录保持空集合。正式新增/编辑只走中央材料合同命令，服务端分配合同与明细 ID、执行幂等和乐观锁并复算明细金额；演示来源只读。该切片不改变 SQLite schema，也不授权按名称、项目或金额补关系。

当前落地事实（#320、#321、#324—#327）：浏览器施工/分包合同都按 `(dataOrigin, contractId, kind)` 从各自中央 Repository 读取，关联事实只按稳定合同外键归属。正式新增/编辑只走对应中央命令；演示来源只读。SQLite v42 增加可空 `actual_completion_date`；v43 增加可空 `settlement_status` 与 `clearance_status`；v44 为同一 `project_acceptances` 记录增加验收/保修专属事实与追加式生命周期事件表；v45 为 `owner_final_settlements` 增加可空 `audited_amount` 和 `audited_date`。甲方罚扣与分包变洽签已有完整物理字段，#326/#327 不另建表或新增列；所有迁移均不猜测存量的日期、金额、状态、结论或审计历史。

当前落地事实（#322）：受控迁移拓扑在 canonical 施工合同、canonical 分包合同之后追加 `contract_supplements`，再迁移工人和项目分供方。补充协议的旧 `contract_id` 必须唯一映射到施工或分包主合同的中央 ID；缺失或跨类型歧义均阻断，不猜父合同。详情按服务端稳定补充协议 ID 聚焦，并在读取层验证该记录存在且 `contractId` 与当前主合同一致；不存在与父子错配使用不同问题语义。正式迁移确认后，两类详情从同一中央命令事实源读取补充协议；本切片不改变 SQLite 物理 schema。

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
│  │ReceiptRegistr.   │  │PaymentApplication│  │CurrentTransaction│         │
│  │  收款登记          │  │  付款申请          │  │  往来收付         │         │
│  │  projectId → Proj │  │  projectId → Proj │  │  projectId → Proj│         │
│  └──────────────────┘  │  supplierId → Sup │  └──────────────────┘         │
│                         │  contractId → EC  │                               │
│                         └──────────────────┘  ┌──────────────────┐         │
│                                               │PaymentRecord     │         │
│                                               │  支付记录         │         │
│                                               │  projectId → Proj│         │
│                                               └──────────────────┘         │
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
    │        ├─ 1:N → task_item_map ─(itemName)→ items ─→ house_type_template_items
    │        └─ 1:N → schedule_task_floor_plans ─→ floors / boq_lines
    │                  实际完成率 = 分组内该阶段已完成户数 / 该阶段应做户数
    ├─1:N→ unit_assignments（户 × 工种责任；完成不存这里）
    └─1:N→ target_costs ─1:N→ target_cost_items（costCategory: 专业分包/合同劳务/材料/机械/工人工资/费用报销/其他）
```

### 1.2 清单与变更线（2026-07-04 grill 新增）

```
contracts(kind='施工') ─1:N→ boq_files ─1:N→ boq_lines（统一清单行模型，合同量+合同单价唯一来源）
projects ─1:N→ boq_change_orders（变更单四档：草稿→已上报→已打回→已签证，CONTEXT.md「变更单」）
              ├─1:N→ boq_change_lines ─N:1→ boq_lines（调量/调价指向原行；变更新增行反向挂 change_order_id）
              └─已签证─自动生成→ owner_change_orders 台账行（1:1 ledgerId 追溯，ADR-0002）
projects ─1:N→ monthly_statements ─1:N→ monthly_statement_lines（月度报量：自动汇总草稿+手调）
invoices = 识别+台账单表（ADR-0001，废弃 ticket_registrations）→ 归属：projects 或 个人开支
delivery_records ─1:N→ delivery_lines（送货单归档即写入材料台账；单价对比=聚合查询视图，无独立表）
projects ─1:N→ project_aliases（工地名归一：别名→项目，首绑人工确认、同写法后续自动，CONTEXT.md「工地」）
```

---

## § 2 全部实体清单

### 2.1 基础主数据（跨项目共享）

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| Project | `projects` | `id` | `project-info.md` |
| Customer | `customers` | `id` | `base-customer.md` |
| Supplier | `suppliers` | `id` | `base-supplier.md` |
| SupplierCredential | `supplier_credentials` | `id` | `base-supplier.md` |
| SupplierCredentialRequirement | `supplier_credential_requirements` | `id` | `base-supplier.md`（迁移 v36） |
| SupplierCredentialAudit | `supplier_credential_audits` | `id` | `base-supplier.md`（迁移 v36，脱敏审计） |
| SupplierAudit | `supplier_audits` | `id` | `base-supplier.md`（迁移 v36，脱敏审计） |
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

`credential_reviewed_at TEXT NULL` 与 `credential_review_note TEXT DEFAULT ''` 是供应商级人工核验凭证：人工通过记录时间和可选备注，人工退回时备注必填；操作人字段待账号体系落地后补充。系统只可按资料规则自动写入 `incomplete/reviewing`，不得自动写入 `qualified/rejected`。迁移 v36 会把没有该级凭证的旧 `qualified` / `rejected` 按真实文件重新计算，不用单份证照的 `verified_at` 冒充整户审核。

广东省内分供方可从应用打开[广东省电子税务局一般纳税人资格查询](https://etax.guangdong.chinatax.gov.cn:8443/xxbg/view/zhsffw/#/query/ybnsrzgcx)辅助核验。应用只负责复制税号、打开官网及记录人工确认结果；验证码由用户在官网完成，不爬取页面、不绕过验证码，也不把该页面当作稳定 API。

`supplier_credential_requirements` 用于持久化“分供方 × 证照类别”的要求，而 `supplier_credentials` 只保存实际已收到的文件。前者保存 `supplier_id`、canonical `category`、`requirement`（`not_applicable | optional | required`）、`reason`、`updated_at`、`deleted_at`，并对活跃 `(supplier_id, category)` 唯一。默认规则：营业执照、法人身份证、银行账户资料为 `required`；签约代表身份证、资质证书、品牌授权书为 `not_applicable`；其余资料为 `optional`。只有被明确改为 `required` 的条件资料，缺失或过期时才影响资料齐全度。

迁移 v36 为 `supplier_credentials` 增加 `file_ref_id`、`valid_from`、`expires_at`、`long_term`、`ocr_confirmed_result`、`ocr_confirmed_at`、`ocr_review_status`。真实原件以有效的 `file_refs(owner_type='supplier_credential', owner_id=credential.id)` + `file_payloads` 保存，`file_ref_id` 是证照元数据到该原件的唯一活跃关联。迁移会把 legacy 非空 `supplier_credentials.file_path` 回填为 `file_ref` 以保留迁移线索，但路径本身不授予读取权限、也不计入齐全度；旧记录必须由用户重新选择原件上传，只有持久化正文存在时才算“已收到”。`ocr_result` 与置信度在识别成功时立即保存并标记 `pending`；“稍后核对”或重启不丢失。最终确认另存于 `ocr_confirmed_result` / `ocr_confirmed_at` 并标记 `confirmed`，不得覆盖原始候选或上一次确认痕迹。

有效期的“已过期 / 30 天内临期”统一按 `Asia/Shanghai` 业务日期判断，避免 UTC 日界线造成提前或延后一天。证照新增、OCR 核对、独立有效期编辑、删除和撤回写入 `supplier_credential_audits`：该表只保存动作、分类变化、变更字段名、有效期前后值与置信度，不保存 OCR 原文或人工确认正文；删除/撤回按明确的证照 ID 与 `deleted_at` 在同一事务恢复。上述动作不得使用通用 `operation_logs` 对 `supplier_credentials` 或 `suppliers` 做整行前后快照，避免复制 OCR 原文、税号和银行账号。

供应商新增、编辑、导入、删除/撤回、人工资料核验与纳税人核验统一写 `supplier_audits`。该表只保存 `action`、规范化 `outcome`、`source_category`、变更字段名、备注是否存在和时间，不保存税号、银行账号、核验备注正文或外部来源原文。供应商与证照即使误走通用日志，快照也必须先按安全字段白名单脱敏；迁移 v36 会逐行清洗历史 `operation_logs` 中 `suppliers` / `supplier_credentials` 的敏感快照，坏 JSON 安全置空而不阻断升级。

迁移 v36 创建严格限定关键列的 `AFTER UPDATE OF name, unique_code, tax_no, legal_rep, address, bank, bank_account` 触发器。只有这些字段的 `OLD/NEW` 实际不同且旧状态为人工 `qualified/rejected` 时，才清除人工凭证并按真实原件、逐类别要求和上海业务日回算 `incomplete/reviewing`；纳税人核验、备注和 `updated_at` 更新不得误触发。列表每次加载前还会按当前上海业务日批量检查人工结论，只让已经缺失/过期或无有效凭证的历史人工态失效，仍有效的人工结论保持不变。除 `reviewCredentials` 外，表单、store 和导入入口均不得写入 `qualified/rejected` 或伪造审核时间/备注。

同一迁移为纳税人辅助核验增加 `taxpayer_verification_status`（`not_checked | confirmed_general | not_found | manually_confirmed`）、`taxpayer_verification_source`、`taxpayer_verified_at`、`taxpayer_verification_note`；`not_found` 必须保持 `taxpayer_type='未核验'`，不得推导为小规模纳税人。

“银行账户资料”是统一业务类别，兼容“银行开户许可证 / 开户许可证 / 基本存款账户信息 / 基本存款账户信息表”等历史名称；“品牌授权书 / 品牌授权证明”同样按一个类别读取，迁移不得造成附件丢失或误报缺失。

已人工合格后，仅当必需资料的文件、最终分类、有效期、要求状态或确认后采用的相关主数据实际发生变化时，原核验结论才失效并按规则重算；重新识别得到待核对候选、置信度变化和重复保存相同规范化值不得单独撤销合格。

### 2.2 项目关联实体

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| ProjectSupplier | `project_suppliers` | `id` | `project-supplier.md` |
| Settlement | `settlements` | `id` | `project-supplier.md` |
| PhaseTask | `phase_tasks` | `id` | `project-info.md`（阶段资料/手续 checklist；**非排程**，排程工序见 §2.7 `schedule_tasks`） |

### 2.3 合同类（通用基础 + 类型定制）

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| ConstructionContract | `construction_contracts` | `id` | `contract-construction.md`（旧 IA 兼容表；v15 起 BOQ/变更/报量新关系统一引用 `contracts.id`） |
| SupplementAgreement | `supplement_agreements` | `id` | `contract-construction.md` |
| OwnerChangeOrder | `owner_change_orders` | `id` | `contract-construction.md`（金额台账=自动行（来源变更单）+手录纯金额签证，ADR-0002） |
| ExpenditureContract | `expenditure_contracts` | `id` | `contract-base.md` + 类型文档 |
| ContractLineItem | `contract_line_items` | `id` | `material-contract.md` |
| BoqFile | `boq_files` | `id` | `boq-import.md`（清单文件：挂 `contracts(kind='施工')` 一对多，未拆表/已拆表） |
| BoqLine | `boq_lines` | `id` | `boq-import.md` §二（统一清单行模型+来源追溯键；已确认导入行或已签证变更新增行二选一） |
| BoqChangeOrder | `boq_change_orders` | `id` | CONTEXT.md「变更单」「指令单」（四档状态） |
| BoqChangeLine | `boq_change_lines` | `id` | 变更单行明细（新增/调量/调价） |
| MonthlyStatement | `monthly_statements` | `id` | `owner-documents.md` + CONTEXT.md「月度报量」 |
| MonthlyStatementLine | `monthly_statement_lines` | `id` | 同上（自动汇总+手调字段） |
| Contract | `contracts` | `id` | **合同域 canonical ID（#90 批A 新 IA，v3；BOQ v15 收口）**：施工/分包/材采/其他支出单表 `kind` 区分。BOQ 文件、清单行、变更单、月度报量和进度分组统一引用这里的施工合同；旧 `construction_contracts` / `expenditure_contracts` 只作迁移兼容，不接受新表单写入 |
| ContractSupplement | `contract_supplements` | `id` | canonical 合同补充协议；施工/支出侧均引用 `contracts.id`，见 §10.1 |
| CompanyExpenseContract | `company_expense_contracts` | `id` | `contract-forms.md`（公司支出，不挂虚拟项目） |
| ProjectAcceptance | `project_acceptances` | `id` | `owner-documents.md`（竣工验收/保修） |
| OwnerFinalSettlement | `owner_final_settlements` | `id` | `owner-documents.md`（甲方最终结算） |
| OwnerPenalty | `owner_penalties` | `id` | `owner-documents.md`（甲方罚扣） |
| SubcontractChangeOrder | `subcontract_change_orders` | `id` | `owner-documents.md`（分包变更） |

```sql
-- 合同域轻实体仓（#90 批A，migrations v3 contracts-light-entity）
CREATE TABLE contracts (
  id          TEXT PRIMARY KEY,
  no          TEXT DEFAULT '',
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT '施工',   -- '施工' | '分包' | '材采' | '其他支出'
  sub_kind    TEXT DEFAULT '',                -- '劳务' | '专业'，仅 kind='分包'
  cost_category TEXT DEFAULT '',              -- '专业分包' | '合同劳务' | '材料' | '机械' | '其他'
  legacy_type TEXT DEFAULT '',                -- 迁移源原始细类
  classification_state TEXT DEFAULT 'classified', -- 'classified' | 'unclassified' | 'no_contract'
  project_id  TEXT NOT NULL,                  -- → projects.id
  supplier_id TEXT,                           -- → suppliers.id；施工合同（乙方=我方）为 NULL
  amount      REAL DEFAULT 0,                 -- 含税合同金额
  changed     REAL DEFAULT 0,                 -- 变更后合同金额
  settled     REAL DEFAULT 0,                 -- 累计结算
  invoiced    REAL DEFAULT 0,                 -- 累计收票（施工=累计开票）
  paid        REAL DEFAULT 0,                 -- 累计支付（施工=累计收款）
  signer_name TEXT DEFAULT '',                -- 签约人
  contact_phone TEXT DEFAULT '',              -- 合同联系人电话，按文本保存
  tax_rate    REAL,                           -- 合同税率；不据此推算发票金额
  sign_date   TEXT DEFAULT '',
  actual_completion_date TEXT NULL,           -- v42，仅施工合同实际竣工事实；未知保持 NULL
  settlement_status TEXT NULL,                -- v43，分包结算独立事实；未记录保持 NULL
  clearance_status TEXT NULL,                 -- v43，分包清账独立事实；不从余额推断
  status      TEXT DEFAULT '履约中',          -- '履约中' | '已签订' | '已结算' | '已结清'
  note        TEXT DEFAULT '',
  created_at  TEXT, updated_at TEXT, deleted_at TEXT
);
```

```sql
-- v15 `boq-change-monthly-foundation`：下列关系全部使用 snake_case。
boq_files(
  id, contract_id -> contracts.id, file_name, file_path, format_class,
  parse_status ['pending'|'parsed'], line_count, note, created_at, updated_at, deleted_at
)

boq_lines(
  id, boq_file_id -> boq_files.id NULL, project_id -> projects.id,
  contract_id -> contracts.id, item_id -> items.id NULL,
  section, trade, item_name, unit, qty, unit_price, amount,
  trace_key, source_sheet, source_row, recognized_qty, recognized_unit_price,
  building, unit_type, multiplier, room, floor_zone, spec, tax_rate, owner_supplied,
  change_order_id -> boq_change_orders.id NULL, sort_order, created_at, updated_at, deleted_at
)
-- 活跃行必须二选一：导入行有 boq_file_id；变更新增行有 change_order_id。
-- (boq_file_id, trace_key) 对活跃导入行唯一。

boq_change_orders(
  id, project_id -> projects.id, contract_id -> contracts.id, code, name,
  change_type ['add'|'qty'|'price'|'mixed'],
  status ['draft'|'submitted'|'rejected'|'approved'], status_note,
  directive_no, directive_type [''|'issued'|'changed'|'supplemented'],
  total_amount, approved_at, ledger_id -> owner_change_orders.id,
  note, created_at, updated_at, deleted_at
)
-- approved 必须同时有 approved_at、ledger_id；ledger_id 对活跃变更单唯一。

boq_change_lines(
  id, change_order_id -> boq_change_orders.id, boq_line_id -> boq_lines.id NULL,
  result_boq_line_id -> boq_lines.id NULL, item_id -> items.id NULL,
  operation ['add'|'qty'|'price'], section, trade, item_name, unit, spec,
  delta_qty, new_unit_price, amount, note, sort_order,
  created_at, updated_at, deleted_at
)
-- add 不指向原行；qty/price 必须指向原行。签证后的新增结果通过 result_boq_line_id 追溯。
-- v16 `boq-change-added-line-metadata` 为已发布 v15 的存量库补齐 item_id/section/trade/spec。

monthly_statements(
  id, project_id -> projects.id, contract_id -> contracts.id, month,
  status ['draft'|'adjusted'|'exported'], total_amount,
  quantity_basis ['contract'|'provisional'|'field'],
  source_version, source_updated_at, operator_name, submitted_at, note,
  created_at, updated_at, deleted_at
)
-- (contract_id, month) 对活跃报量单唯一。
-- 状态沿用存量值：draft=草稿，adjusted=已有真实申报金额，exported=已有真实审定金额。
-- 清单工作台手调/导出不推进状态；v37 仅以 audited_amount 保留“已审定”，其余旧 adjusted/exported 保守回草稿。
-- v39 `quantity_basis` 记录本单选定的取数基准，缺省 field。基准归每次报量单，不做项目全局唯一。
-- 派生只读所选基准自己的列，缺量报错阻断生成，不跨口径回退，也不按 0 静默计入。
-- draft 期可经换基准重算改写 quantity_basis 与全部行（旧行软删、手调量随之失效）；
-- 一旦进入 adjusted/exported 即冻结，改口径必须走重新申报，不静默改写历史金额。
-- 甲方报量单（owner_report）与本表是同一条记录，自动完成量必须读同一个 quantity_basis。
-- v40 `source_version` / `source_updated_at` 在生成与换基准重算时写入：版本指纹覆盖基准、量与单价，
-- 用于证明一张已申报报量单依据的是哪一版事实，不必事后回比源表。
-- `operator_name` / `submitted_at` 只在申报（action=submit）时冻结；草稿期保持空，
-- 不拿生成时间或 application_date（用户手填的申报日期）冒充系统提交证据。

monthly_statement_lines(
  id, statement_id -> monthly_statements.id, boq_line_id -> boq_lines.id,
  item_name, unit, auto_qty, adjusted_qty, unit_price, amount, note, sort_order,
  created_at, updated_at, deleted_at
)
```

Issue #323—#327 的核心迁移拓扑使用逻辑实体名 `owner_documents`，它不是新 SQLite 表。本地 adapter 按以下规则只读投影现有权威表，并将行与附件作为同一 canonical 单据的嵌套属性受控导入：

- `boq_change_orders` + `boq_change_lines`：量价变更头/行；已生成 `ledger_id` 的锁定 `owner_change_orders` 行不重复导入。
- `owner_change_orders`：只投影手录纯金额签证或没有 BOQ 源的兼容记录。
- `monthly_statements` + `monthly_statement_lines`：作为甲方报量的唯一头/行事实，保留自动量、申报量、审定量、单价与两档金额。
- `project_acceptances` + `project_acceptance_lifecycle_events`：作为验收—保修同 ID 生命周期的唯一主记录与追加事件。
- `owner_final_settlements`：作为甲方最终结算唯一头事实；报审/审定金额分字段读取，审定事实缺失保持 `null`。
- `owner_penalties`：作为甲方罚扣唯一头事实；保留联系单号、罚扣金额/日期/事由、申诉说明、状态与备注，不拆成项目罚扣或分包抵扣记录。
- `subcontract_change_orders`：作为分包变洽签唯一头事实；保留项目、分供方、分包合同、审批金额、变更面积、实际审定价、日期、事由、状态与备注，不拆成分包结算或项目罚扣记录。
- `receipt_registrations`：在 `owner_documents` 之前作为一等迁移实体，按稳定项目/合同/客户外键归属，供最终结算查询时聚合与收款详情下钻。
- canonical 施工合同迁移嵌套快照：同步完整、未软删除的 `boq_lines` 目录，以及按期次与稳定 BOQ 行派生的 field 完成量事实。它们不另建业务表，但不得只从旧变洽签/旧月报量明细反推，否则从未成单的 BOQ 行和新期次事实会在切换后消失。历史单据行是冻结时点证据：同一稳定 BOQ ID 已在完整目录中时只校验项目—合同归属，不用历史名称、数量或单价覆盖当前 canonical 目录；只有目录缺行时才以历史行兜底。
- `file_refs`：按真实 `owner_type + owner_id` 取有效文件引用，不复制文件正文。

逻辑投影同时保留申报日期与签证日期，以及报量的 `quantity_basis` / `source_version` / `source_updated_at` / `operator_name` / `submitted_at`。SQLite `datetime('now')` 产生的 UTC 空格时间必须由本地 adapter 规范化为带 `Z` 的 ISO-8601 后才可进入中央契约；单据、报量取数事实和附件时间均适用。申报日期、签证日期、创建/更新时间和签证执行时间在迁移确认边界都作真实日历/ISO 校验，非法值必须阻断切换。中央签证 action 另写不可变 `approval_sequence_at` 作为同日量价链顺序事实，通用 `updated_at` 与附件维护不得改写它；历史迁移没有该字段时只在导入边界校验并以当时合法 `updated_at` 初始化一次。这些是同一 canonical 单据的审计证据，不能在中央读模型中丢弃或用其中一个字段覆盖另一个。

迁移时甲方单据的 `project_id` 与 `contract_id` 必须唯一映射已导入项目和 canonical 施工合同；分包变洽签还必须把 `supplier_id` 与 `contract_id` 唯一映射到同一项目和分供方下的 canonical 分包合同。缺失、错配或指向其他合同类型均作为阻断孤儿。确认后中央命令源接管五类甲方单据与分包变洽签的日常读写；回滚按批次撤销接管并从不可变备份恢复原 SQLite 权威，不在两端同时提供正式写入。

变更附件复用 `file_refs(owner_type='boq_change_order', owner_id, category)`；我方指令单、甲方指令单、报价、算量和施工照片的展示分类不改变 `boq_change_orders` 的状态职责。已签证时自动生成且锁定一条 `owner_change_orders` 来源行，来源键为 `source_type='boq_change_order' + source_id`（ADR-0002）。其中“新增”明细必须在签证后物化为带稳定 ID 的 `boq_lines` 结果行，后续变更和月度报量从结果行及时序量价链派生有效数据，不重放原始合同量价。单明细已签证变更允许在明确的二次确认后受控更正，并在同一事务内同步变更明细、变更新增结果行和锁定台账且写操作日志；若同一目标清单行已有后续签证，或原签证含多明细/混合操作，则禁止原地改写，必须新增更正变更单以保持金额链可追溯。

### 2.4 资金管理类

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| Invoice | `invoices` | `id` | `finance-invoice.md`（识别+台账**单表**，ADR-0001；归属：项目 或 个人开支） |
| InvoiceExportSetting | `invoice_export_settings` | `id='default'`（本机单例设置表例外） | ADR 0004（发票 XLSX 默认样式，本机单例） |
| InvoiceApplication | `invoice_applications` | `id` | `finance-billing.md`（销项=开票申请） |
| ReceiptRegistration | `receipt_registrations` | `id` | `finance-receipt.md` |
| ExpenditureSettlement | `expenditure_settlements` | `id` | 支出合同过程/完工结算统一源单；与 `project_suppliers` 终态关闭用的 `settlements` 不同 |
| PaymentApplication | `payment_applications` | `id` | `finance-payment.md`（10 类型；ADR 0015） |
| PaymentApplicationSettlementAllocation | `payment_application_settlement_allocations` | `id` | 付款申请—真实结算分摊（ADR 0015） |
| PaymentApplicationInvoiceAllocation | `payment_application_invoice_allocations` | `id` | 付款申请—真实发票分摊（ADR 0015） |
| CurrentTransaction | `current_transactions` | `id` | `finance-receipt.md`（收/付共表，`direction` 区分） |
| PaymentRecord | `payment_records` | `id` | `finance-records.md` |
| PaymentRecordApplicationAllocation | `payment_record_application_allocations` | `id` | 支付记录—付款申请多对多分摊（ADR 0015、§10.2） |
| ExpenseReimbursement | `expense_reimbursements` | `id` | `finance-reimbursement.md`（已确认费用进入动态成本） |
| ExpenseReimbursementLine | `expense_reimbursement_lines` | `id` | `finance-reimbursement.md`（费用事实明细） |

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

归档当前值仍写回 `invoices` 并作为台账、价格分析和打印的唯一事实。归档 action 同一事务另向 `operation_logs(table_name='invoice_archive_provenance')` 写不可变审计快照，分开保存来源信息、原始 OCR、逐字段人工修订和归档时人工确认的当前值；读取审计不得反向覆盖 `invoices` 当前值。

`invoice_export_settings` 是发票领域的本机单例配置表（迁移 v41），`settings_json` 保存发票台账 XLSX 的行列尺寸、字体、边框、格式、冻结与合并默认值。业务预览只保留本次草稿；保存和加载必须经 invoice store action 进入 SQLite，浏览器开发态随数据库 snapshot fallback 持久化，不再另写 `localStorage`，也不得复用只属于 OCR 的 `ocr_settings`。

Issue #328 将分包 `expenditure_settlements` 作为逻辑 `owner_documents` 迁移节点的 `sub_settlement` kind 接管，正式 ID 由中央分配，不新增分包结算主表；兼容旧 `biz_type=分包` 及专业分包/合同劳务分类。项目、分供方与 canonical 分包合同必须唯一映射且一致。附件继续使用 `owner_type=expenditure_settlement`。金额与扣款说明来自原结算；确认状态只有 `draft → confirmed`。累计金额只在查询时派生，项目分供方终态 `settlements` 和材料冲销不在本票范围。

```sql
-- 支出结算统一源单：承接分包、材料采购和其他支出结算，供付款申请真实选择。
-- project_suppliers 的 1:1 `settlements` 只表示合作关系终态关闭，不得作为付款勾稽源单。
CREATE TABLE expenditure_settlements (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL,
  name              TEXT NOT NULL,
  biz_type          TEXT NOT NULL,       -- '专业分包' | '合同劳务' | '材料' | '机械' | '其他'
  project_id        TEXT NOT NULL,       -- → projects.id
  supplier_id       TEXT NOT NULL,       -- → suppliers.id
  contract_id       TEXT NOT NULL,       -- → contracts.id；仅支出侧 kind（分包/材采等）
  settlement_type   TEXT,                -- 过程结算/完工结算/零星用工等
  total_amount      REAL NOT NULL,       -- 含税结算金额；付款勾稽展示与额度口径
  amount            REAL,                -- 不含税结算金额
  tax_amount        REAL,
  tax_rate          REAL,
  settlement_date   TEXT NOT NULL,
  settlement_period TEXT DEFAULT '',
  deduction_note    TEXT DEFAULT '',
  status            TEXT DEFAULT 'draft',
  note              TEXT DEFAULT '',
  created_at TEXT, updated_at TEXT, deleted_at TEXT
);

-- 付款申请头：可编辑标量落实体列；attachFiles 走 file_refs，不存 JSON。
-- `_biz` / `_c1`..`_c4` / `isPrepay` 等 readonly+compute 展示字段不存。
CREATE TABLE payment_applications (
  id              TEXT PRIMARY KEY,
  no              TEXT NOT NULL,
  name            TEXT NOT NULL,
  biz_type        TEXT NOT NULL,       -- 有合同-合同劳务/材料/专业分包/机械/其他、无合同-零星采购、预付款、管理费、项目费用、公司付款
  project_id      TEXT,                -- 公司付款可空 → projects.id
  supplier_id     TEXT,                -- → suppliers.id；类型提交规则决定是否必填
  contract_id     TEXT,                -- 有合同/预付款可选或必填 → contracts.id；保存真实 lookup ID
  cost_name       TEXT,
  apply_amount    REAL,
  apply_date      TEXT,
  applicant       TEXT,
  invoice_state   TEXT,                -- '先票后款' | '先款后票' | '无需发票'
  pay_content     TEXT,
  prepay_deduct   REAL,
  prepay_note     TEXT,
  approved_amount REAL,
  paid_amount     REAL,                -- 兼容旧列，只读；新值由已确认支付记录分摊派生（§10.2）
  external_ref    TEXT DEFAULT '',      -- 外部业务键；导入时用于幂等和来源关联
  status          TEXT DEFAULT 'draft',
  note            TEXT DEFAULT '',
  created_at TEXT, updated_at TEXT, deleted_at TEXT
);

CREATE TABLE payment_application_settlement_allocations (
  id                     TEXT PRIMARY KEY,
  payment_application_id TEXT NOT NULL REFERENCES payment_applications(id),
  settlement_id          TEXT NOT NULL REFERENCES expenditure_settlements(id),
  allocated_amount       REAL NOT NULL CHECK (allocated_amount > 0),
  note                   TEXT DEFAULT '',
  created_at TEXT, updated_at TEXT, deleted_at TEXT
);

CREATE TABLE payment_application_invoice_allocations (
  id                     TEXT PRIMARY KEY,
  payment_application_id TEXT NOT NULL REFERENCES payment_applications(id),
  invoice_id              TEXT NOT NULL REFERENCES invoices(id),
  allocated_amount        REAL NOT NULL CHECK (allocated_amount > 0),
  note                    TEXT DEFAULT '',
  created_at TEXT, updated_at TEXT, deleted_at TEXT
);
```

付款申请头与两类分摊行必须由同一个 store action 在事务内保存。草稿允许金额不平并显示差额；提交规则、`先款后票`待回票金额与单票全局额度见 `finance-payment.md` 和 ADR 0015。

### 2.5 物资管理类

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| MaterialRequisition | `material_requisitions` | `id` | `material-management.md`（乙供材下料） |
| MaterialArrival | `material_arrivals` | `id` | `material-management.md`（乙供材到货头） |
| MaterialArrivalLine | `material_arrival_lines` | `id` | `material-management.md`（乙供材到货明细） |
| MaterialUse | `material_uses` | `id` | `material-management.md`（乙供材领用） |
| StockCheck | `stock_checks` | `id` | `material-management.md`（库存盘点头） |
| StockCheckLine | `stock_check_lines` | `id` | `material-management.md`（库存盘点明细） |
| OwnerMaterialControl | `owner_material_controls` | `id` | `material-management.md`（甲供材总控量） |
| OwnerMaterialRequisition | `owner_material_requisitions` | `id` | `material-management.md`（甲供材下料） |
| OwnerMaterialArrival | `owner_material_arrivals` | `id` | `material-management.md`（甲供材到货） |
| OwnerMaterialUse | `owner_material_uses` | `id` | `material-management.md`（甲供材领用） |
| OwnerMaterialDirect | `owner_material_directs` | `id` | `material-management.md`（甲供材直入直出） |
| DeliveryRecord | `delivery_records` | `id` | `material-delivery.md`（送货单头：处理区/归档库双区字段） |
| DeliveryLine | `delivery_lines` | `id` | `material-delivery.md`（归档明细即材料数据，供单价对比/分供方详情读取） |
| ProjectAlias | `project_aliases` | `id` | CONTEXT.md「工地」（工地名写法变体 → 项目归一，2026-07-06 grill 定） |

> ~~PriceComparison `price_comparisons`~~ **已移除**：单价对比是对 `delivery_lines` 的聚合查询视图（同材料跨分供方/跨时间比价），无独立存储；未来若需收藏对比方案再议。

```sql
CREATE TABLE delivery_records (
  id         TEXT PRIMARY KEY,
  projectId  TEXT NOT NULL,          -- 写入持久化记录前强制归项目；工地名经 project_aliases 归一而来
  supplierId TEXT,                   -- 可空=归档库左树「⚠未区分分供方」兜底节点
  rawSiteText TEXT,                  -- OCR/文件夹推断的工地原文本，仅留痕追溯，不参与任何键（2026-07-06 定）
  orderNo TEXT, deliveryDate TEXT,   -- 去重自然键 = projectId+supplierId+orderNo（全 ID 化，见 §6 唯一索引）
  fileName TEXT, filePath TEXT,
  ocrStatus TEXT DEFAULT 'pending',  -- 待识别 | 识别中 | 待核对 | 已核对
  archived  INTEGER DEFAULT 0,       -- 归属齐全并由用户触发归档后置 1；送货单 archived=1 即已入库/可供单价分析
  stored    INTEGER DEFAULT 0,       -- v25 起只作存量兼容镜像，归档记录统一回填 1；禁止作为独立业务资格判断
  printBatchId TEXT DEFAULT '',      -- v32：同一上传原件拆出的多张送货单共享；跨刷新按批次恢复一个打印任务
  printDisposition TEXT DEFAULT 'excluded', -- pending | printed | excluded；新归档由 store 显式写 pending
  printedAt TEXT,                    -- 仅真实打印完成后的用户回执写入；打开打印窗口不得写
  printExcludedAt TEXT,              -- 明确排除打印范围的时间；排除不写 printedAt
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

> 迁移 v25 将所有存量 `archived=1` 记录的 `stored` 兼容镜像回填为 1，并把存量打印处置初始化为 `excluded`：历史数据无法可靠反推是否打印，升级时不得伪造 `printedAt`，也不得突然形成大批待打印任务。此后新归档由 store 显式写 `printDisposition='pending'`；只有“打印成功回执”写 `printed`，手动排除只写 `excluded`。
>
> 迁移 v32 增加 `printBatchId`：存量按记录 ID 一单一批回填，新上传的同一原件拆成多张送货单时共享批次 ID。打印/排除只能把整批从 `pending` 原子推进到 `printed` / `excluded`；任一记录已终结时整批拒绝并回滚，禁止旧页面把两个终态互相覆盖。

项目详情的到货视图只查询 `delivery_records.archived=1` 且头/项目/分供方祖先未软删的记录，并聚合未软删 `delivery_lines`。原件正文继续归属 `file_refs(owner_type='delivery_record', owner_id=delivery_records.id, category='source')`；`delivery_records.file_name` 仅作兼容显示，不建立详情附件副本。

CREATE TABLE project_aliases (
  id        TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,           -- → projects.id
  alias     TEXT NOT NULL,           -- 工地名写法变体（全局唯一，见 §6）；首次人工确认时写入，之后同写法自动绑定
  createdAt TEXT, deleted_at TEXT
);
```

> `project_aliases` 已由迁移 v8 落地：人工选定项目并完成核对时记忆 `rawSiteText`，同一归一化写法后续自动预选；若该写法已属于其他项目则拒绝静默改绑。

`ocr_settings` 是不参与通用软删除和操作日志的本机基础设施表（迁移 v33）。固定单例 `id='default'`，`settings_json` 只保存 PaddleOCR-VL 已接线的非敏感识别能力、请求/轮询超时和暂未接线的只读人工校对阈值；Access Token、API 地址和模型名禁止进入该表。

### 2.6 分包及人工类

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| Crew | `crews` | `id` | `base-crew.md` |
| Worker | `workers` | `id` | `base-worker.md` |
| PenaltyRecord | `penalty_records` | `id` | `base-crew.md` / `base-worker.md` |
| Item | `items` | `id` | `subcontract-quantity.md`（分项定义：**项目×分部/工种**，不挂班组——分项是合同计量口径；谁做记在 `unit_assignments`，当前物理模型没有“班组×项目×分项单价”表） |
| ItemUnitPrice | `item_unit_prices` | `id` | `boq-import.md`（E 类零星维修分项单价库；不进入合同工程量/合同价轨） |
| HouseTypeTemplate | `house_type_templates` | `id` | **ADR 0010**：户型模板（项目×户型，活链接多户） |
| HouseTypeTemplateItem | `house_type_template_items` | `id` | **ADR 0010**：模板明细/三量（稳定模板房间×分项，工种从分项读取；清单量/暂估量/现场量算式，户型层共享、量可手改留痕） |
| ConstructionStage | `construction_stages` | `id` | **ADR 0010**：项目工序阶段目录，给 #103 完成事实与 #114 排程共享稳定 ID |
| ConstructionStageItem | `construction_stage_items` | `id` | 工序阶段 ↔ 计量分项映射，圈定应做户与下钻范围；`is_reporting_stage=1` 是该分项唯一月度报量阶段 |
| UnitAssignment | `unit_assignments` | `id` | **ADR 0010**：户 × 工种责任（只表达谁负责，不存完成） |
| UnitAssignmentScope | `unit_assignment_scopes` | `id` | 个人指派可选模板房间 × 分项下钻范围；户身份由所属指派提供 |
| UnitStageCompletion | `unit_stage_completions` | `id` | **ADR 0010**：户 × 工序阶段完成事实（状态/日期/照片软卡） |
| ~~Quantity~~ | ~~`quantities`~~ | — | **已废弃**：原“分项 × 房间 × 工人 × 完成月份”合一表拆为户型模板量、户 × 工种责任和户 × 工序阶段完成；禁用旧表和 `completedMonth` |
| PayrollSubjectConfig | `payroll_subject_configs` | `id` | C2 请款主体×项目配置；保存负责人、班组、默认大工单价和可编辑签工确认规则，活跃自然键为项目×负责人×格式族 |
| WageStatement | `wage_statements` | `id` | 负责人请款簿（请款主体×月×格式族×档位）；`format_family=A/B/C1/C2`（当前开放 A/C1/C2，B 待真实合同清单），`period_kind=monthly/settlement/retention`，`purpose=advance/final`，`quantity_source=provisional/field`，`status=draft/checked/released`；C2 通过 `subject_config_id` 关联主体配置；保存累计应付、此前已发、来源版本/时间与操作者；`released` 冻结 `snapshot_json` 和实际发放金额 |
| WageStatementMember | `wage_statement_members` | `id` | 请款簿成员归属；同一请款簿包含一名负责人和零至多名成员，负责人同时记入成员表 |
| WageStatementAllocation | `wage_statement_allocations` | `id` | 已发工资单的组内实际收款分配；按整数分保存，成员集合必须与请款簿成员完全一致，零金额保留且分配合计必须严格等于实际发放金额 |
| WageStatementLine | `wage_statement_lines` | `id` | 月度分项快照：工人、分项、单位、工程量、工资单价、金额；核对时按现场量/考勤替换，发放后只读 |
| AttendanceRecord | `attendance_records` | `id` | 工人×日期唯一；正常工时、加班工时、施工内容，重复录入覆盖同一工作日；日期必须真实存在，正常+加班总工时不得超过 24 小时，C2 签工成员不得录考勤 |
| SignedDayworkRecord | `signed_daywork_records` | `id` | C2 逐日签工事实；项目、班组、人员、日期、施工内容、起止时间、整工/半工、证明人与确认日期；只有 `confirmed` 记录计薪；同人同日时段不重叠且合计不超过 1 工 |
| WageStatementDayworkRecord | `wage_statement_daywork_records` | `id` | C2 工资单与本次核对签工记录的显式关联；每条有效签工只能归属一张有效工资单，发放时完整记录与主体费率/规则另入 `snapshot_json` |

> ~~PayrollRecord `payroll_records`~~ **已细化拆分**为上述工资与考勤表（禁用旧名）。工资单不是纯计算视图：草稿可活算，核对强制刷新现场复核量，发放时冻结量、价、比例、明细及实际发放金额。合同量禁止进入应付取数。

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
| ScheduleProcessLibrary | `schedule_process_libraries` | `id` | `schedule-progress.md`（可复用标准工序库版本） |
| ScheduleProcessLibraryTask | `schedule_process_library_tasks` | `id` | `schedule-progress.md`（标准库工序定义） |
| ScheduleGroup | `schedule_groups` | `id` | `schedule-progress.md`（楼栋分组） |
| ScheduleGroupBuilding | `schedule_group_buildings` | `id` | `schedule-progress.md`（分组×楼栋） |
| ScheduleTask | `schedule_tasks` | `id` | `schedule-progress.md`（工序/WBS） |
| TaskDependency | `task_dependencies` | `id` | `schedule-progress.md`（前后置依赖） |
| TaskItemMap | `task_item_map` | `id` | `schedule-progress.md`（工序↔分项） |
| ScheduleTaskFloorPlan | `schedule_task_floor_plans` | `id` | `schedule-progress.md`（分项×楼层自动计划及个别微调） |

> [ADR 0017](../adr/0017-provisional-schedule-before-contract.md) 将楼栋分组范围依据扩为 `scope_basis IN ('contract','provisional')`。`scope_basis='contract'` 时 `schedule_groups.contract_id` 必填，且只能指向一份同项目的 `contracts(kind='施工')`；分组候选楼栋、户型和套数由该合同下已确认的 `boq_files` / `boq_lines` 拆表结果提供，只有清单行的显式楼栋字段才可证明合同覆盖。`scope_basis='provisional'` 时 `contract_id` 必须为 NULL，候选楼栋来自项目手工区域树，量值来自户型模板的手工分项与暂估量。两种依据不能在同一分组混用，合同分组禁止跨合同混组；`construction_contracts` 仅作旧 IA 兼容，不得再保存新的 BOQ/进度引用。
>
> 目标约束为 `CHECK ((scope_basis='contract' AND contract_id IS NOT NULL) OR (scope_basis='provisional' AND contract_id IS NULL))`，并增加 `contract_bound_at TEXT NULL`。v27 为兼容历史 seed/测试夹具，暂容许旧写路径省略 `scope_basis`；新建组 action 必须显式写入，读取旧空值时只按 `contract_id` 回退判定。内部暂估绑定合同必须走领域 action：校验同项目施工合同、显式楼栋覆盖、分项映射和数量差异；分组内任一楼栋缺合同覆盖证据时整个事务失败。成功时只更新范围依据与合同引用并记录审计日志，不重建分组、任务、依赖、基线或完成事实，也不覆盖户型模板中的暂估量。既有 `contract_id IS NOT NULL` 分组迁移为 `scope_basis='contract'`；无法证明合同来源的旧分组迁移为 `provisional` 并持续提示待绑定。
> 标准工序库按 [ADR 0018](../adr/0018-versioned-schedule-process-library.md) 保存全局不可变版本。基于旧版只能沿用相同 `code` 新建下一版本；`schedule_process_library_tasks.predecessor_task_key` 保存前置身份，`predecessor_disabled=1` 表示因顺序冲突已置灰但未删除。建组时 `schedule_groups` 冻结库名/版本，`schedule_tasks` 同时保存来源工序 ID、来源版本和 `template_snapshot_json`；任务名称、工种、颜色、应用工期、阶段码、分项码及前置状态均以创建时快照为准。禁用关系仍创建 `task_dependencies` 后按 `schedule:conflict-reschedule` 软删除，之后全局库变化不会追溯改写既有项目 WBS。迁移历史冻结为：v34 只增加并回填 `predecessor_task_key`，v35 再通过 `addColumnIfMissing` 增加 `predecessor_disabled` 并把空值或非法值回填为 `0`，以覆盖已经登记 v34 的存量数据库。
> `schedule_tasks.stage_id` 引用 `construction_stages.id`。工序 `has_qty=1` 按楼栋分组聚合 `unit_stage_completions`，`=0` 才读 `manual_progress`；墙砖/地砖、一遍/二遍腻子使用不同 `stage_id`。
> `schedule_tasks` 预留 `baseline_start/baseline_finish`（「设为基线」= 保存当前计划快照，NULL=未设基线）。
> `schedule_task_floor_plans` 由排程域拥有，并以 `source_basis` 区分来源。合同清单行保存 `item_id + boq_line_id`，唯一范围为 `task_id + floor_id + boq_line_id`；内部暂估行保存 `item_id + provisional_qty`、`boq_line_id=NULL`，唯一范围为 `task_id + floor_id + item_id`。两种来源均从工序窗口自动分摊，个别楼层调期后 `is_manual=1`。v38 只从真实 `boq_lines.item_id` 回填存量合同计划；缺少可验证分项的旧行会阻断迁移，不伪造 BOQ。`boq_line_id` 是来源追溯引用，不是该排程行的可见性祖先：BOQ 行后续软删除不能隐藏已冻结的楼层计划。内部暂估后补合同时仅改变分组依据，预览与写入统一聚合分组内有效 `provisional_qty` 快照；既有暂估计划行继续保持 `source_basis='provisional'`，不被户型模板后续修改或合同量覆盖。

### 2.8 目标成本类（成本控制基线）

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| TargetCost | `target_costs` | `id` | `target-cost.md`（项目目标成本，`is_baseline` 版本化） |
| TargetCostItem | `target_cost_items` | `id` | `schedule-progress.md` §六（科目行：专业分包/合同劳务/材料/机械/工人工资/费用报销/其他，可细到分项） |

```sql
CREATE TABLE target_costs (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT,                 -- → projects.id；仅 draft 可空，提交时应用层强制必填
  name                TEXT NOT NULL,        -- 版本名（“投标预算”/“开工基线”）
  is_baseline         INTEGER DEFAULT 0,    -- 1=当前对比基线；部分唯一索引保证一项目一条
  contract_revenue    REAL DEFAULT 0 CHECK (contract_revenue >= 0),
  planned_profit      REAL DEFAULT 0 CHECK (planned_profit >= 0),
  signed_contract_sum REAL DEFAULT 0 CHECK (signed_contract_sum >= 0),
  tax_inclusive_total REAL DEFAULT 0 CHECK (tax_inclusive_total >= 0),
  tax_exclusive_total REAL DEFAULT 0 CHECK (tax_exclusive_total >= 0),
  tax_amount          REAL DEFAULT 0 CHECK (tax_amount >= 0),
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | submitted
  note TEXT DEFAULT '',
  created_at TEXT, updated_at TEXT, deleted_at TEXT
);

CREATE TABLE target_cost_items (
  id           TEXT PRIMARY KEY,
  target_cost_id TEXT NOT NULL,     -- → target_costs.id
  cost_category TEXT NOT NULL,      -- '专业分包' | '合同劳务' | '材料' | '机械' | '工人工资' | '费用报销' | '其他'
  item_name     TEXT,               -- 可选：细到分项（墙砖/地砖…），NULL=科目级
  unit TEXT, qty REAL, unit_price REAL,
  amount       REAL NOT NULL,
  note TEXT, sort_order INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT, deleted_at TEXT
);
```

> 迁移 v20 `target-cost-incomplete-drafts` 将已落过 v19 的存量库安全重建为 `project_id` 草稿可空，并原样保留目标成本头、科目明细、软删除状态和索引；非草稿保存仍必须校验真实项目 ID。

> **costCategory 全局归集约定（2026-07-23 修订）**：合同成本按专业分包、合同劳务、材料、机械、其他五类；直接工人工资和费用报销分别作为独立成本来源。**合同劳务与工人工资不得合并为“人工”**。动态成本以已确认支出结算、已发放工资和已确认费用报销归集；付款申请、支付记录和送货单分别代表审批、现金流和收货事实，不与结算重复计入成本。红圈参照：目标成本 + 目标成本清单明细。

### 2.9 导入与对账审计类

| 实体 | 表名 | PK | 说明 |
|---|---|---|---|
| ImportBatch | `import_batches` | `id` | 一次源文件实体迁移批次 |
| ImportSourceRef | `import_source_refs` | `id` | 系统实体到源文件/工作表/行的追溯 |
| ReconciliationIssue | `reconciliation_issues` | `id` | Excel 与系统聚合差异及项目/Excel/映射/缺源归因 |

### 2.10 ADR 0014 整页表单目标 schema（Issue #116 定稿）

本节是 37 条整页表单的目标字段权威；与前文旧建表快照冲突时，以本节为准，后续迁移按批次逐步合并回基线 schema。页面蓝本只规定业务字段和可观察行为，不复制数据库列。

统一约束：

- 列名统一 `snake_case`；日期/时间使用 ISO-8601 `TEXT`，金额使用 `REAL`，布尔值使用 `INTEGER CHECK (... IN (0, 1))`。
- 所有业务头表均有 `id TEXT PRIMARY KEY`、`status TEXT`、`note TEXT DEFAULT ''`、`created_at`、`updated_at`、`deleted_at`；下文不重复列出。
- `*` 表示提交/确认动作必填，不等同于数据库 `NOT NULL`。草稿必须可保存不完整字段；关系、正金额、勾稽和状态条件由同一领域 action 在提交事务内校验。
- lookup 一律保存真实外键 ID；名称、合同额、累计量等只读带出字段不复制。只有税号、购方名称等具有业务时点证据意义的字段才保存快照。
- 可编辑网格进入子表；附件进入 `file_refs`；不得在业务头保存文件数组或明细 JSON。
- `_` 前缀展示字段、`readonly + compute` 字段及纯聚合不持久化。

#### 2.10.1 路由覆盖与迁移批次

| 批次 | 表单蓝本（合计 37） | 目标表 |
|---|---|---|
| F1 基础主数据 | `supplierForm`、`customerForm`、`crewForm`、`workerForm`、`projectForm`、`targetCostForm`（6） | `suppliers`、`customers`、`crews`、`workers`、`projects`、`target_costs` |
| F2 合同与结算 | `conContractForm`、`subContractForm`、`matContractForm`、`companyExpForm`、`otherExpForm`、`otherSettleForm`（6） | `contracts`、`contract_supplements`、`contract_line_items`、`company_expense_contracts`、`expenditure_settlements` |
| F3 资金 | `receiptForm`、`invApplyForm`、`currentForm`、`payRecordForm`、`reimburseForm`、`payApplyForm`（6） | `receipt_registrations`、`invoice_applications`、`current_transactions`、`payment_records`、`payment_record_application_allocations`、`expense_reimbursements`、`expense_reimbursement_lines`、`payment_applications` 及两类真实源单分摊 |
| F4 物资 | `matRequisitionForm`、`matArrivalForm`、`matUseForm`、`matSettleForm`、`stockCheckForm`、`omTotalForm`、`omRequisitionForm`、`omArrivalForm`、`omUseForm`、`omDirectForm`、`deliveryArchiveForm`（11） | §2.5 物资实体；材料结算复用 `expenditure_settlements`，送货归档复用 `delivery_records` / `delivery_lines` |
| F5 甲方/分包单据 | `ownerChangeForm`、`ownerReportForm`、`acceptanceForm`、`finalSettleForm`、`ownerPenaltyForm`、`subChangeForm`、`subSettleForm`、`projPenaltyForm`（8） | `boq_change_orders` / `boq_change_lines`、`monthly_statements` / `monthly_statement_lines`、`project_acceptances`、`owner_final_settlements`、`owner_penalties`、`subcontract_change_orders`、`expenditure_settlements`、`penalty_records` |

#### 2.10.2 F1 基础主数据

```sql
-- customers：客户/甲方主数据；aliases 是检索别名，不是业务明细。
customers(
  id, name TEXT NOT NULL, aliases TEXT DEFAULT '[]',
  tax_no TEXT DEFAULT '', legal_rep TEXT DEFAULT '',
  registered_address TEXT DEFAULT '',
  invoice_name TEXT DEFAULT '', bank TEXT DEFAULT '', bank_account TEXT DEFAULT '',
  contact TEXT DEFAULT '', contact_phone TEXT DEFAULT '',
  note, created_at, updated_at, deleted_at
)

-- suppliers 在既有列上补齐；parent_supplier_id 不属于领域模型。
suppliers += (
  contact_title TEXT DEFAULT '',
  credential_reviewed_at TEXT,
  credential_review_note TEXT DEFAULT '',
  deleted_at TEXT
)
-- parent_supplier_id：停止写入；F1 迁移确认无有效层级数据后删除。

crews += (
  default_pay_ratio REAL DEFAULT 0.95 CHECK (default_pay_ratio BETWEEN 0 AND 1),
  rent_subsidy_enabled INTEGER DEFAULT 0 CHECK (rent_subsidy_enabled IN (0, 1)),
  rent_subsidy_price REAL,
  mgmt_fee_enabled INTEGER DEFAULT 0 CHECK (mgmt_fee_enabled IN (0, 1)),
  mgmt_fee_price REAL,
  assignment_level TEXT DEFAULT 'crew'
    CHECK (assignment_level IN ('crew', 'worker')),
  status TEXT DEFAULT 'draft',
  updated_at TEXT, deleted_at TEXT
)

workers += (
  bank_name TEXT DEFAULT '', bank_account TEXT DEFAULT '', bank_code TEXT DEFAULT '',
  current_project_id TEXT REFERENCES projects(id),
  family_group_id TEXT,
  safety_education INTEGER DEFAULT 0 CHECK (safety_education IN (0, 1)),
  deleted_at TEXT
)
-- current_project（名称文本）停止写入；迁移能唯一匹配时写 current_project_id，
-- 无法唯一匹配的记录进入 reconciliation_issues。

projects += (
  customer_id TEXT REFERENCES customers(id),
  secondary_customer_id TEXT REFERENCES customers(id),
  contract_name TEXT DEFAULT '', region TEXT DEFAULT '', overview TEXT DEFAULT '',
  operation_type TEXT DEFAULT '', planned_duration INTEGER,
  developer_supervisor TEXT DEFAULT '', designer TEXT DEFAULT '',
  contractor TEXT DEFAULT '', manager TEXT DEFAULT '', manager_phone TEXT DEFAULT '',
  exec_manager TEXT DEFAULT '', builder TEXT DEFAULT '',
  site_leader TEXT DEFAULT '', site_leader_phone TEXT DEFAULT '',
  risk_level TEXT DEFAULT '', approval_status TEXT DEFAULT '',
  acceptance_date TEXT DEFAULT '', filing_date TEXT DEFAULT '',
  deleted_at TEXT
)
-- developer/developer2（客户名称文本）停止写入；只作为 F1 迁移匹配输入。
```

`supplierForm` 的资料类别、条件必需和人工核验状态继续由 Issue #13 规则约束；`credential_status` 不是普通下拉字段。`target_costs` / `target_cost_items` 的完整目标列见 §2.8。

> F1 表结构由迁移 v19 落地。旧客户名、工人当前项目名仅在唯一匹配时转为真实 ID；分供方旧层级及歧义/缺失映射写入 `reconciliation_issues` 后删除停止写入的旧列。迁移对账可能尚无可确认的项目，因此该表的 `project_id` 允许为空，并以实体定位列保存来源。

> 分供方证照审核底座由迁移 v36 补齐；其新增列与要求表见 §2.1，不能从 v19 的 F1 通用表单批次反推证照闭环。

#### 2.10.3 F2 合同与支出结算

```sql
contracts += (
  customer_id TEXT REFERENCES customers(id),
  content TEXT DEFAULT '', invoice_type TEXT DEFAULT '',
  contact_name TEXT DEFAULT '', contact_phone TEXT DEFAULT '',
  main_terms TEXT DEFAULT '', payment_terms TEXT DEFAULT '',
  brand_quality_terms TEXT DEFAULT '', schedule_terms TEXT DEFAULT '',
  warranty_terms TEXT DEFAULT '', special_terms TEXT DEFAULT '',
  retention_ratio REAL, retention_amount REAL, retention_days INTEGER,
  invoice_name TEXT DEFAULT '', invoice_tax_no TEXT DEFAULT '',
  invoice_address_phone TEXT DEFAULT '', invoice_bank TEXT DEFAULT '',
  invoice_bank_account TEXT DEFAULT '',
  other_expense_kind TEXT DEFAULT '', service_period TEXT DEFAULT '',
  payment_cycle TEXT DEFAULT '', deleted_at TEXT
)
-- amount 是用户确认的含税合同额；tax_exclusive_amount / tax_amount 为实时派生。
-- changed / settled / invoiced / paid 退出写表单路径，后续由变更、结算、票、资金事实聚合。

contract_supplements(
  id, contract_id TEXT NOT NULL REFERENCES contracts(id),
  no TEXT DEFAULT '', name TEXT NOT NULL, content TEXT DEFAULT '',
  amount REAL DEFAULT 0 CHECK (amount >= 0), sign_date TEXT DEFAULT '',
  status, note, created_at, updated_at, deleted_at
)

contract_line_items(
  id, contract_id TEXT NOT NULL REFERENCES contracts(id),
  material_name TEXT NOT NULL, spec TEXT DEFAULT '', brand TEXT DEFAULT '',
  unit TEXT DEFAULT '', qty REAL NOT NULL CHECK (qty > 0),
  tax_inclusive_unit_price REAL NOT NULL CHECK (tax_inclusive_unit_price >= 0),
  planned_arrival_date TEXT DEFAULT '', note TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0, created_at, updated_at, deleted_at
)
-- 行含税金额 = qty × tax_inclusive_unit_price，纯计算不存。

company_expense_contracts(
  id, no TEXT DEFAULT '', name TEXT NOT NULL,
  category TEXT DEFAULT '', counterparty TEXT NOT NULL,
  sign_date TEXT DEFAULT '', service_period TEXT DEFAULT '',
  amount REAL DEFAULT 0 CHECK (amount >= 0), payment_cycle TEXT DEFAULT '',
  main_terms TEXT DEFAULT '', status, note,
  created_at, updated_at, deleted_at
)
-- 公司支出合同没有 project_id；禁止建立“公司”虚拟项目。

expenditure_settlements += (
  settlement_period TEXT DEFAULT '',
  deduction_note TEXT DEFAULT '',
  updated_at TEXT, deleted_at TEXT
)
```

施工/分包/材采/其他支出主合同的新写路径只使用 `contracts`；`construction_contracts`、`expenditure_contracts` 和只挂旧施工合同的 `supplement_agreements` 是迁移兼容源，不再承接整页表单。`otherSettleForm`、`matSettleForm`、`subSettleForm` 均写 `expenditure_settlements`，不得各建结算副本。

#### 2.10.4 F3 资金

```sql
receipt_registrations(
  id, no TEXT DEFAULT '', receipt_date TEXT,
  project_id TEXT REFERENCES projects(id),
  contract_id TEXT REFERENCES contracts(id),
  customer_id TEXT REFERENCES customers(id),
  payer_account TEXT DEFAULT '',
  amount REAL DEFAULT 0 CHECK (amount >= 0),
  payment_method TEXT DEFAULT '', acceptance_bill_no TEXT DEFAULT '',
  bill_due_date TEXT DEFAULT '', period_no TEXT DEFAULT '',
  bank_serial_no TEXT DEFAULT '', handler TEXT DEFAULT '',
  review_status TEXT DEFAULT 'draft', status, note,
  created_at, updated_at, deleted_at
)

invoice_applications(
  id, no TEXT DEFAULT '', name TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  contract_id TEXT REFERENCES contracts(id),
  customer_id TEXT REFERENCES customers(id),
  buyer_name_snapshot TEXT DEFAULT '', buyer_tax_no_snapshot TEXT DEFAULT '',
  invoice_type TEXT DEFAULT '', amount REAL DEFAULT 0 CHECK (amount >= 0),
  tax_rate REAL, tax_amount REAL DEFAULT 0 CHECK (tax_amount >= 0),
  invoice_content TEXT DEFAULT '', invoice_remark TEXT DEFAULT '',
  applicant TEXT DEFAULT '', application_date TEXT DEFAULT '',
  status, note, created_at, updated_at, deleted_at
)
-- 价税合计由 amount + tax_amount 派生；客户名称/税号是提交时业务快照。

current_transactions(
  id, no TEXT DEFAULT '',
  direction TEXT NOT NULL CHECK (direction IN ('receipt', 'payment')),
  project_id TEXT REFERENCES projects(id),
  counterparty TEXT NOT NULL, purpose TEXT DEFAULT '',
  amount REAL DEFAULT 0 CHECK (amount >= 0),
  payment_method TEXT DEFAULT '', transaction_date TEXT DEFAULT '',
  bank_serial_no TEXT DEFAULT '', handler TEXT DEFAULT '',
  status, note, created_at, updated_at, deleted_at
)
-- current_receipts/current_payments 仅作 F3 迁移源，迁移后退出查询和写入。

payment_records += (
  supplier_id TEXT REFERENCES suppliers(id),
  payee_name TEXT DEFAULT '', purpose TEXT DEFAULT '',
  bank_serial_no TEXT DEFAULT '', handler TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  recognition_status TEXT DEFAULT 'manual',
  field_confidence TEXT DEFAULT '{}',
  confirmation_status TEXT DEFAULT 'draft',
  confirmed_at TEXT, updated_at TEXT, deleted_at TEXT
)
-- F3 以重建表迁移将既有 project_id 改为可空；公司付款的支付事实不挂虚拟项目。

expense_reimbursements(
  id, project_id TEXT REFERENCES projects(id),
  no TEXT DEFAULT '', applicant TEXT DEFAULT '', category TEXT DEFAULT '',
  reimbursement_date TEXT DEFAULT '', invoice_count INTEGER DEFAULT 0,
  reason TEXT DEFAULT '', status TEXT DEFAULT 'draft', note TEXT DEFAULT '',
  external_ref TEXT DEFAULT '',
  created_at, updated_at, deleted_at
)
-- project_id 可空=公司开支；报销总额只从有效 expense_reimbursement_lines 聚合。
-- 旧 amount 列停止写入并在 F3 重建表时移除。

expense_reimbursement_lines(
  id, reimbursement_id TEXT NOT NULL REFERENCES expense_reimbursements(id),
  expense_item TEXT NOT NULL, expense_date TEXT DEFAULT '',
  amount REAL NOT NULL CHECK (amount > 0), note TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0, created_at, updated_at, deleted_at
)
```

支付记录的申请分摊继续以 §10.2 为准：`payment_application_id` 旧单外键停止写入，确认时要求有效分摊合计等于支付金额，只有 `confirmation_status='confirmed'` 进入资金聚合。付款申请及真实结算/发票分摊以 §2.4 和 ADR 0015 为准，不存设计稿 `_biz` / `_c1..._c4` 展示字段。

#### 2.10.5 F4 物资

```sql
material_requisitions(
  id, no TEXT DEFAULT '', project_id TEXT REFERENCES projects(id),
  contract_id TEXT REFERENCES contracts(id), applicant TEXT DEFAULT '',
  requisition_date TEXT DEFAULT '', required_date TEXT DEFAULT '',
  material_name TEXT NOT NULL, spec TEXT DEFAULT '', unit TEXT DEFAULT '',
  planned_qty REAL DEFAULT 0 CHECK (planned_qty >= 0),
  warehouse TEXT DEFAULT '', purpose TEXT DEFAULT '',
  status, note, created_at, updated_at, deleted_at
)

material_arrivals(
  id, no TEXT DEFAULT '', project_id TEXT REFERENCES projects(id),
  supplier_id TEXT REFERENCES suppliers(id), contract_id TEXT REFERENCES contracts(id),
  requisition_id TEXT REFERENCES material_requisitions(id),
  warehouse TEXT DEFAULT '', arrival_date TEXT DEFAULT '', receiver TEXT DEFAULT '',
  quality_result TEXT DEFAULT '', stock_status TEXT DEFAULT '',
  status, note, created_at, updated_at, deleted_at
)
material_arrival_lines(
  id, arrival_id TEXT NOT NULL REFERENCES material_arrivals(id),
  material_name TEXT NOT NULL, spec TEXT DEFAULT '', unit TEXT DEFAULT '',
  qty REAL NOT NULL CHECK (qty > 0), unit_price REAL,
  note TEXT DEFAULT '', sort_order INTEGER DEFAULT 0,
  created_at, updated_at, deleted_at
)
-- 已到量、到货头材料摘要/数量/金额均从有效到货明细聚合。

material_uses(
  id, no TEXT DEFAULT '', project_id TEXT REFERENCES projects(id),
  warehouse TEXT DEFAULT '', use_date TEXT DEFAULT '',
  material_name TEXT NOT NULL, spec TEXT DEFAULT '', unit TEXT DEFAULT '',
  qty REAL DEFAULT 0 CHECK (qty >= 0), receiver TEXT DEFAULT '',
  crew_id TEXT REFERENCES crews(id), purpose TEXT DEFAULT '',
  status, note, created_at, updated_at, deleted_at
)

stock_checks(
  id, no TEXT DEFAULT '', warehouse TEXT NOT NULL,
  checker TEXT NOT NULL, check_date TEXT DEFAULT '',
  status, note, created_at, updated_at, deleted_at
)
stock_check_lines(
  id, stock_check_id TEXT NOT NULL REFERENCES stock_checks(id),
  material_name TEXT NOT NULL, spec TEXT DEFAULT '', unit TEXT DEFAULT '',
  book_qty REAL DEFAULT 0, actual_qty REAL DEFAULT 0,
  variance_amount REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0, created_at, updated_at, deleted_at
)
-- variance_qty = actual_qty - book_qty；仅 status='effective' 的盘点影响库存。

owner_material_controls(
  id, no TEXT DEFAULT '', project_id TEXT REFERENCES projects(id),
  customer_id TEXT REFERENCES customers(id),
  material_name TEXT NOT NULL, spec TEXT DEFAULT '', unit TEXT DEFAULT '',
  control_qty REAL DEFAULT 0 CHECK (control_qty >= 0),
  status, note, created_at, updated_at, deleted_at
)
owner_material_requisitions(
  id, no TEXT DEFAULT '', project_id TEXT REFERENCES projects(id),
  applicant TEXT DEFAULT '', application_date TEXT DEFAULT '', required_date TEXT DEFAULT '',
  material_name TEXT NOT NULL, spec TEXT DEFAULT '', unit TEXT DEFAULT '',
  planned_qty REAL DEFAULT 0 CHECK (planned_qty >= 0),
  status, note, created_at, updated_at, deleted_at
)
owner_material_arrivals(
  id, no TEXT DEFAULT '', project_id TEXT REFERENCES projects(id),
  warehouse TEXT DEFAULT '', arrival_date TEXT DEFAULT '', receiver TEXT DEFAULT '',
  material_name TEXT NOT NULL, spec TEXT DEFAULT '', unit TEXT DEFAULT '',
  qty REAL DEFAULT 0 CHECK (qty >= 0), quality_result TEXT DEFAULT '',
  stock_status TEXT DEFAULT '', status, note, created_at, updated_at, deleted_at
)
owner_material_uses(
  id, no TEXT DEFAULT '', project_id TEXT REFERENCES projects(id),
  use_date TEXT DEFAULT '', material_name TEXT NOT NULL, unit TEXT DEFAULT '',
  qty REAL DEFAULT 0 CHECK (qty >= 0), receiver TEXT DEFAULT '',
  crew_id TEXT REFERENCES crews(id), purpose TEXT DEFAULT '',
  status, note, created_at, updated_at, deleted_at
)
owner_material_directs(
  id, no TEXT DEFAULT '', project_id TEXT REFERENCES projects(id),
  customer_id TEXT REFERENCES customers(id), transaction_date TEXT DEFAULT '',
  material_name TEXT NOT NULL, unit TEXT DEFAULT '',
  qty REAL DEFAULT 0 CHECK (qty >= 0),
  purpose TEXT DEFAULT '', use_location TEXT DEFAULT '',
  status, note, created_at, updated_at, deleted_at
)
```

甲供材累计到货、累计领用和剩余可用从甲供材事实聚合，不在 `owner_material_controls` 保存可编辑累计列。`deliveryArchiveForm` 更新 §2.5 的 `delivery_records`，其中材料摘要、数量与单据金额只作 `delivery_lines` 聚合展示；原件仍由 `file_refs(owner_type='delivery_record')` 保存。

2026-08-13 运行态走查确认甲供材列表读模型还包含总计划头/可能的二级明细、供货分供方、源单、送货单、仓库、采购类型、班组合同及结算/付款快照；这些可观察列不等于已裁定写模型。当前 `customer_id` 只表示项目甲方，不得冒充供货分供方；现有五张甲供材表也没有证明总计划头/行、下料—到货、到货—送货归档或供货单位关系。关系未迁移前，读 DTO 对这些字段返回明确 `null`/未配置状态，项目档案目录继续使用“甲供材供货单位待配置”；禁止按名称、单号或金额猜外键。后续迁移必须先裁定供货单位实体身份和总计划头/明细边界，再建立真实外键或桥表。页面字段与可空 DTO 见 [`material-management.md`](./pages/material-management.md)。

#### 2.10.6 F5 甲方/分包单据

```sql
boq_change_orders += (
  document_type TEXT DEFAULT 'change_negotiation'
    CHECK (document_type IN ('change_negotiation', 'site_visa', 'claim', 'material_price_approval')),
  application_date TEXT DEFAULT '', reason TEXT DEFAULT '',
  approved_tax_inclusive_amount REAL,
  approved_tax_exclusive_amount REAL,
  applied_tax_exclusive_amount REAL,
  updated_at TEXT, deleted_at TEXT
)
-- document_type 保存表单“变更洽商/现场签证/索赔/材料认价”；
-- change_type 继续只表示行操作汇总 add/qty/price/mixed，二者不得复用。
-- 指令编号/类型复用既有 directive_no / directive_type。
-- 量、价、合价明细继续写 boq_change_lines；已签证金额链规则见 §2.3。

owner_change_orders += (
  contract_id TEXT REFERENCES contracts(id),
  name TEXT DEFAULT '',
  document_type TEXT DEFAULT 'change_negotiation'
    CHECK (document_type IN ('change_negotiation', 'site_visa', 'claim', 'material_price_approval')),
  directive_no TEXT DEFAULT '', directive_type TEXT DEFAULT '',
  application_date TEXT DEFAULT '', reason TEXT DEFAULT '',
  status TEXT DEFAULT 'draft', status_note TEXT DEFAULT '',
  note TEXT DEFAULT '', updated_at TEXT
)
-- 上述扩展只服务“不含量价明细的纯金额签证”直写台账；
-- 量价变更仍由 boq_change_orders 生成 source_locked=1 的一对一锁定行。
-- v24 同时将 owner_change_orders.project_id 收窄前的 NOT NULL 去除：
-- 不完整草稿先保存为 manual 草稿，补齐量价明细后原 ID 转入 BOQ 变更实体。

monthly_statements += (
  project_id TEXT NULL, contract_id TEXT NULL, month TEXT DEFAULT '',
  no TEXT DEFAULT '', period_no TEXT DEFAULT '',
  application_date TEXT DEFAULT '',
  reported_amount REAL, audited_amount REAL,
  status TEXT DEFAULT 'draft', note TEXT DEFAULT '',
  updated_at TEXT, deleted_at TEXT
)
monthly_statement_lines += (
  reported_qty REAL, audited_qty REAL, audited_amount REAL,
  updated_at TEXT, deleted_at TEXT
)
-- 审定差额为 audited_amount - reported_amount，纯计算不存。
-- 自动完成量在每次保存时按 project+contract+period 从阶段完成事实重新派生，
-- 客户端 auto_qty 不进入信任边界；空项目/合同/期次只允许草稿且不落明细。

project_acceptances(
  id, no TEXT DEFAULT '', type TEXT DEFAULT 'acceptance',
  name TEXT NOT NULL, project_id TEXT REFERENCES projects(id),
  contract_id TEXT REFERENCES contracts(id), document_date TEXT DEFAULT '',
  contract_estimate REAL, acceptor TEXT DEFAULT '',
  warranty_owner TEXT DEFAULT '', conclusion TEXT DEFAULT '',
  acceptance_organization TEXT NOT NULL DEFAULT '',
  acceptance_date TEXT NULL,
  acceptance_conclusion TEXT NOT NULL DEFAULT '',
  warranty_start_date TEXT NULL, warranty_end_date TEXT NULL,
  warranty_confirmation_organization TEXT NULL,
  warranty_confirmation_date TEXT NULL,
  warranty_confirmation_note TEXT NOT NULL DEFAULT '',
  status TEXT DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'accepted', 'warranty', 'expired')),
  note, created_at, updated_at, deleted_at
)
project_acceptance_lifecycle_events(
  id TEXT PRIMARY KEY,
  acceptance_id TEXT NOT NULL REFERENCES project_acceptances(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('submit', 'accept', 'start-warranty', 'confirm-expiry')),
  from_status TEXT NOT NULL, to_status TEXT NOT NULL,
  actor_id TEXT NOT NULL, actor_name TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  UNIQUE (acceptance_id, to_status)
)
-- 生命周期：draft -> submitted -> accepted -> warranty -> expired；同一 acceptance ID
-- 同时支撑 acceptance / warranty 两个 canonical 投影，不复制保修单据。
-- 状态只能由 submit / accept / start-warranty / confirm-expiry command 单向推进，
-- 每次转换追加事件；迁移不根据 type/status 伪造历史日期或事件。
-- 项目、合同和中央详情原样读取持久化状态与事件；附件继续使用
-- file_refs(owner_type='project_acceptance', owner_id=project_acceptances.id)，并按
-- acceptance-report / warranty-confirmation 分类进入对应视图。

owner_final_settlements(
  id, no TEXT DEFAULT '', name TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id), contract_id TEXT REFERENCES contracts(id),
  settlement_amount REAL DEFAULT 0 CHECK (settlement_amount >= 0),
  audited_amount REAL NULL CHECK (audited_amount IS NULL OR audited_amount >= 0),
  audited_date TEXT NULL,
  submission_date TEXT DEFAULT '', basis TEXT DEFAULT '',
  difference_note TEXT DEFAULT '',
  status, note, created_at, updated_at, deleted_at
)

owner_penalties(
  id, no TEXT DEFAULT '', project_id TEXT REFERENCES projects(id),
  contract_id TEXT REFERENCES contracts(id), notice_no TEXT DEFAULT '',
  amount REAL DEFAULT 0 CHECK (amount >= 0), penalty_date TEXT DEFAULT '',
  reason TEXT NOT NULL, appeal_note TEXT DEFAULT '',
  status, note, created_at, updated_at, deleted_at
)

subcontract_change_orders(
  id, no TEXT DEFAULT '', change_type TEXT DEFAULT '',
  project_id TEXT REFERENCES projects(id),
  supplier_id TEXT REFERENCES suppliers(id),
  contract_id TEXT REFERENCES contracts(id),
  change_date TEXT DEFAULT '', approved_amount REAL DEFAULT 0,
  changed_area REAL, actual_approved_price REAL,
  reason TEXT NOT NULL, status, note,
  created_at, updated_at, deleted_at
)

penalty_records += (
  projectId TEXT NULL, reason TEXT DEFAULT '',
  supplier_id TEXT REFERENCES suppliers(id),
  contract_id TEXT REFERENCES contracts(id),
  deduction_method TEXT DEFAULT '', rectification_note TEXT DEFAULT '',
  updated_at TEXT, deleted_at TEXT
)

penalty_settlement_deductions(
  id,
  penalty_id TEXT REFERENCES penalty_records(id),
  settlement_id TEXT REFERENCES expenditure_settlements(id),
  amount REAL CHECK (amount > 0),
  note TEXT DEFAULT '',
  created_at TEXT, updated_at TEXT, deleted_at TEXT
)
-- (penalty_id, settlement_id) 对活跃关系唯一；累计已抵扣金额从活跃关系行聚合，
-- 不回写 penalty_records 头表。
```

`ownerChangeForm` 复用 BOQ 变更模型；只有不含量价明细的纯金额签证直接写 `owner_change_orders`。`subSettleForm` 复用 `expenditure_settlements`。项目罚扣抵扣结算时由独立 action 写真实结算引用/操作日志，不在罚扣头维护“已扣金额”副本。

最终结算只读口径不读 `contracts.changed/paid`：变更后合同金额取
`contracts.amount + Σ非草稿 contract_supplements.amount`，累计收款取同合同的活跃
`receipt_registrations.amount`，两者均为查询时聚合、不回写最终结算头。结算申报金额取 `settlement_amount`；审定金额/日期只取 `audited_amount` / `audited_date`，任一未记录都返回 `null`，不用申报值、状态或 `0` 代填。

甲方罚扣只读口径直接读取 `owner_penalties` 的金额、日期、事由、联系单号、申诉说明、状态和备注；附件只读取 `owner_type='owner_penalty'` 且 `owner_id` 匹配的有效 `file_refs`。罚扣金额以负向业务含义展示，但存储保持正数金额；申诉说明只是事实字段，不派生“申诉中/已确认”等未定义审批状态。

> v24 实装核对：v1-v23 物理库并未创建蓝本已声明的 `penalty_records`，因此 F5 迁移按本节与 `pages/base-crew.md` 的既有字段一次性建表，并同时加入 F5 外键和软删除列；不另建项目罚扣头表。

---

## § 3 外键索引

### 3.1 核心关联

| 表 | 外键字段 | 引用 | 关系 | 说明 |
|---|---|---|---|---|
| `projects` | `customer_id` / `secondary_customer_id` | `customers.id` | N:1 | 项目 → 主/次客户；名称文本列只作迁移输入 |
| `workers` | `crew_id` | `crews.id` | N:1 | 工人 → 所属班组；班组是主档归属父级 |
| `workers` | `current_project_id` | `projects.id` | N:1 | 工人当前项目引用；仅表示当前分配，不是工人主档的删除父级，项目不可见时工人仍保留 |
| `project_suppliers` | `projectId` | `projects.id` | N:1 | 项目×分供方关联 |
| `project_suppliers` | `supplierId` | `suppliers.id` | N:1 | |
| `supplier_credentials` | `supplierId` | `suppliers.id` | N:1 | 分供方证照 |
| `supplier_credentials` | `file_ref_id` | `file_refs.id` | 0..1:1 | 证照元数据 → 唯一活跃原件 |
| `supplier_credential_requirements` | `supplier_id` | `suppliers.id` | N:1 | 分供方逐类别要求覆盖 |
| `supplier_credential_audits` | `supplier_id` / `credential_id` | `suppliers.id` / `supplier_credentials.id` | N:1 | 不含 OCR 正文的证照动作审计 |
| `supplier_audits` | `supplier_id` | `suppliers.id` | N:1 | 不含敏感字段正文的供应商动作审计 |
| `settlements` | `projectSupplierId` | `project_suppliers.id` | 1:1 | 结算（每个关联最多一条） |
| `phase_tasks` | `projectId` | `projects.id` | N:1 | 阶段任务 |

### 3.2 合同关联

| 表 | 外键字段 | 引用 | 关系 | 说明 |
|---|---|---|---|---|
| `construction_contracts` | `projectId` | `projects.id` | N:1 | 旧施工合同 → 项目（迁移兼容，只读） |
| `supplement_agreements` | `contractId` | `construction_contracts.id` | N:1 | 旧补充协议 → 旧施工合同（迁移兼容，只读） |
| `owner_change_orders` | `projectId` | `projects.id` | N:1 | 甲方变洽签 → 项目 |
| `expenditure_contracts` | `projectId` | `projects.id` | N:1 | 支出合同 → 项目 |
| `expenditure_contracts` | `supplierId` | `suppliers.id` | N:1 | 支出合同 → 分供方 |
| `contract_line_items` | `contract_id` | `contracts.id` | N:1 | 材采明细行 → canonical 合同 |
| `boq_files` | `contract_id` | `contracts.id` | N:1 | 清单文件 → canonical 施工合同（一对多） |
| `boq_lines` | `boq_file_id` / `project_id` / `contract_id` / `item_id` | `boq_files.id` / `projects.id` / `contracts.id` / `items.id` | N:1 | 清单行；项目、合同为高频查询冗余，标准分项映射可空 |
| `boq_lines` | `change_order_id` | `boq_change_orders.id` | N:1 | 已签证变更新增行来源（可选） |
| `item_unit_prices` | `project_id` / `item_id` / `boq_file_id` | `projects.id` / `items.id` / `boq_files.id` | N:1 | E 类单价库行；保存标准分项匹配与来源追溯，不生成 `boq_lines` |
| `boq_change_orders` | `project_id` / `contract_id` | `projects.id` / `contracts.id` | N:1 | 变更单 |
| `boq_change_orders` | `ledger_id` | `owner_change_orders.id` | 1:1 | 已签证自动生成的台账行（ADR-0002，软删除级联） |
| `boq_change_lines` | `change_order_id` / `boq_line_id` / `result_boq_line_id` / `item_id` | `boq_change_orders.id` / `boq_lines.id` / `items.id` | N:1 | 变更行原始目标、签证结果与新增标准分项追溯 |
| `monthly_statements` | `project_id` / `contract_id` | `projects.id` / `contracts.id` | N:1 | 月度报量单 |
| `monthly_statement_lines` | `statement_id` / `boq_line_id` | `monthly_statements.id` / `boq_lines.id` | N:1 | 报量行 |
| `house_type_template_items` | `boq_line_id` | `boq_lines.id` | N:1 | 户型分项从已确认 BOQ 行带出工程量；NULL 表示人工兜底 |
| `schedule_groups` | `contract_id` | `contracts.id` | N:1 | 条件外键；合同清单模式必填，内部暂估模式为空 |
| `task_item_map` | `boq_line_id` | `boq_lines.id` | N:1 | 计划分解只引用 BOQ，不复制合同量/合同价 |
| `contracts` | `project_id` / `customer_id` / `supplier_id` | `projects.id` / `customers.id` / `suppliers.id` | N:1 | canonical 项目合同仓；施工侧引用客户，支出侧引用分供方 |
| `contract_supplements` | `contract_id` | `contracts.id` | N:1 | canonical 合同补充协议（施工/支出侧共用） |
| `project_acceptances` | `project_id` / `contract_id` | `projects.id` / `contracts.id` | N:1 | 竣工验收/保修单 |
| `owner_final_settlements` | `project_id` / `contract_id` | `projects.id` / `contracts.id` | N:1 | 甲方最终结算 |
| `owner_penalties` | `project_id` / `contract_id` | `projects.id` / `contracts.id` | N:1 | 甲方罚扣 |
| `subcontract_change_orders` | `project_id` / `supplier_id` / `contract_id` | `projects.id` / `suppliers.id` / `contracts.id` | N:1 | 分包变更 |

### 3.3 资金管理关联

| 表 | 外键字段 | 引用 | 关系 | 说明 |
|---|---|---|---|---|
| `invoice_applications` | `project_id` / `contract_id` / `customer_id` | `projects.id` / `contracts.id` / `customers.id` | N:1 | 开票申请 → 项目/施工合同/购方 |
| `invoices` | `project_id` | `projects.id` | N:1 | 发票归档归属（owner_kind='project' 时必填；'personal'=个人开支不挂项目） |
| `invoices` | `supplier_id` | `suppliers.id` | N:1 | 销方对应分供方（可选） |
| `invoices` | `contract_id` | `contracts.id` | N:1 | 合同收票（可选）；旧 `expenditure_contracts` ID 在 F2/F3 迁移时映射到 canonical 合同 |
| `receipt_registrations` | `project_id` / `contract_id` / `customer_id` | `projects.id` / `contracts.id` / `customers.id` | N:1 | 收款 → 项目/施工合同/付款客户 |
| `payment_applications` | `project_id` | `projects.id` | N:1 | 付款申请 → 项目 |
| `payment_applications` | `supplier_id` | `suppliers.id` | N:1 | 付款申请 → 分供方 |
| `payment_applications` | `contract_id` | `contracts.id` | N:1 | 付款申请 → 合同域轻实体仓中的支出侧合同（可选） |
| `expenditure_settlements` | `project_id` / `supplier_id` / `contract_id` | `projects.id` / `suppliers.id` / `contracts.id` | N:1 | 支出合同结算统一源单；区别于合作关系终态 `settlements` |
| `payment_application_settlement_allocations` | `payment_application_id` / `settlement_id` | `payment_applications.id` / `expenditure_settlements.id` | N:1 | 付款申请—真实支出结算分摊；源单字段不复制 |
| `payment_application_invoice_allocations` | `payment_application_id` / `invoice_id` | `payment_applications.id` / `invoices.id` | N:1 | 付款申请—真实发票分摊；跨申请累计不得超票额 |
| `current_transactions` | `project_id` | `projects.id` | N:1 | 往来收付 → 项目；`direction` 区分收/付 |
| `payment_records` | `project_id` | `projects.id` | N:1 | 支付记录 → 项目 |
| `payment_records` | `supplier_id` | `suppliers.id` | N:1 | 支付记录 → 收款分供方（可空） |
| `payment_record_application_allocations` | `payment_record_id` / `payment_application_id` | `payment_records.id` / `payment_applications.id` | N:1 | 支付记录—付款申请多对多分摊；旧单外键退出写路径 |
| `expense_reimbursements` | `project_id` | `projects.id` | N:1 | 费用报销 → 项目 |
| `expense_reimbursement_lines` | `reimbursement_id` | `expense_reimbursements.id` | N:1 | 报销费用明细 |

`invoice_export_settings` 是无外键的本机单例配置表；它只保存发票 XLSX 默认样式，不引用项目、发票或用户业务实体。

### 3.4 分包及人工关联

当前物理 schema 不存在独立的 `crew_workers`、`crew_project_config`、`crew_project_items` 或 `worker_certs`。班组成员以 `workers.crew_id` 表达（见 §3.1）；班组参与项目从成员当前项目、`unit_assignments` 与 `wage_statements` 的真实事实聚合；班组和工人附件走 §4 的多态 `file_refs`。不得恢复蓝本中的幽灵表名，若要新增班组项目单价或证件有效期能力，必须先完成领域决策与迁移设计。

| 表 | 外键字段 | 引用 | 关系 | 说明 |
|---|---|---|---|---|
| `penalty_records` | `projectId` | `projects.id` | N:1 | 扣罚 → 项目 |
| `penalty_records` | `crewId` | `crews.id` | N:1 | 扣罚 → 班组（可选） |
| `penalty_records` | `workerId` | `workers.id` | N:1 | 扣罚 → 工人（可选） |
| `penalty_records` | `supplier_id` / `contract_id` | `suppliers.id` / `contracts.id` | N:1 | 项目罚扣 → 分供方/支出合同（可选） |
| `penalty_settlement_deductions` | `penalty_id` / `settlement_id` | `penalty_records.id` / `expenditure_settlements.id` | N:1 | 项目罚扣 → 真实支出结算抵扣关系 |
| `items` | `project_id` | `projects.id` | N:1 | 分项定义（项目×分部/工种，**不挂班组**——合同计量口径） |
| `house_type_templates` | `project_id` | `projects.id` | N:1 | 项目户型模板 |
| `rooms` | `template_id` | `house_type_templates.id` | N:1 | 稳定模板房间；显示名可改，不按户复制 |
| `house_type_template_items` | `room_id` / `item_id` | `rooms.id` / `items.id` | N:1 | 户型层三量明细；模板由房间归属唯一确定 |
| `construction_stages` | `project_id` | `projects.id` | N:1 | 项目工序阶段目录 |
| `construction_stage_items` | `stage_id` / `item_id` | `construction_stages.id` / `items.id` | N:1 | 阶段 ↔ 计量分项 |
| `unit_assignments` | `unit_id` / `crew_id` / `worker_id` | `units.id` / `crews.id` / `workers.id` | N:1 | 户 × 工种责任，不存完成；班组/个人二选一 |
| `unit_assignment_scopes` | `assignment_id` / `room_id` / `item_id` | `unit_assignments.id` / `rooms.id` / `items.id` | N:1 | 个人指派模板房间 × 分项下钻；户由 assignment 唯一确定 |
| `unit_stage_completions` | `unit_id` / `stage_id` / `assignment_id` | `units.id` / `construction_stages.id` / `unit_assignments.id` | N:1 | 户 × 工序阶段完成事实；assignment 只作完成时责任审计引用 |
| `payroll_subject_configs` | `project_id` / `crew_id` / `leader_worker_id` | `projects.id` / `crews.id` / `workers.id` | N:1 | C2 请款主体×项目费率与规则配置 |
| `wage_statements` | `project_id` / `crew_id` / `subject_config_id` | `projects.id` / `crews.id` / `payroll_subject_configs.id` | N:1 | 负责人请款簿头；项目、负责人、月份、格式族、档位为活跃自然键 |
| `wage_statement_members` | `statement_id` / `worker_id` | `wage_statements.id` / `workers.id` | N:1 | 请款簿负责人及成员归属 |
| `wage_statement_allocations` | `statement_id` / `worker_id` | `wage_statements.id` / `workers.id` | N:1 | 发放时组内实际收款分配；数据库保存整数分，显示名、负责人标识和金额同时进入发放快照 |
| `wage_statement_lines` | `statement_id` / `worker_id` | `wage_statements.id` / `workers.id` | N:1 | 工人工资行（快照） |
| `attendance_records` | `project_id` / `worker_id` | `projects.id` / `workers.id` | N:1 | C1 日工/加班来源；工人×日期唯一 |
| `signed_daywork_records` | `project_id` / `crew_id` / `worker_id` | `projects.id` / `crews.id` / `workers.id` | N:1 | C2 逐日签工来源；整工 1 / 半工 0.5 |
| `wage_statement_daywork_records` | `statement_id` / `daywork_record_id` | `wage_statements.id` / `signed_daywork_records.id` | N:1 | C2 核对来源关联；活跃 `daywork_record_id` 全局唯一，禁止重复计薪 |
| `delivery_records` | `projectId` / `supplierId` | `projects.id` / `suppliers.id` | N:1 | 送货单（supplierId 可空=未区分分供方兜底） |
| `delivery_lines` | `deliveryRecordId` | `delivery_records.id` | N:1 | 送货单明细行 |
| `project_aliases` | `projectId` | `projects.id` | N:1 | 工地名别名 → 项目归一（CONTEXT.md「工地」） |
| `material_requisitions` | `project_id` / `contract_id` | `projects.id` / `contracts.id` | N:1 | 乙供材下料 → 项目/材采合同 |
| `material_arrivals` | `project_id` / `supplier_id` / `contract_id` / `requisition_id` | `projects.id` / `suppliers.id` / `contracts.id` / `material_requisitions.id` | N:1 | 乙供材到货头 |
| `material_arrival_lines` | `arrival_id` | `material_arrivals.id` | N:1 | 到货明细 |
| `material_uses` | `project_id` / `crew_id` | `projects.id` / `crews.id` | N:1 | 乙供材领用 |
| `stock_check_lines` | `stock_check_id` | `stock_checks.id` | N:1 | 库存盘点明细 |
| `owner_material_controls` | `project_id` / `customer_id` | `projects.id` / `customers.id` | N:1 | 甲供材项目总控量 |
| `owner_material_requisitions` | `project_id` | `projects.id` | N:1 | 甲供材下料 |
| `owner_material_arrivals` | `project_id` | `projects.id` | N:1 | 甲供材到货 |
| `owner_material_uses` | `project_id` / `crew_id` | `projects.id` / `crews.id` | N:1 | 甲供材领用 |
| `owner_material_directs` | `project_id` / `customer_id` | `projects.id` / `customers.id` | N:1 | 甲供材直入直出 |

### 3.4.1 导入与对账审计关联

| 表 | 外键字段 | 引用 | 关系 | 说明 |
|---|---|---|---|---|
| `import_batches` | `project_id` | `projects.id` | N:1 | 项目迁移批次（通用主数据导入可空） |
| `import_source_refs` | `import_batch_id` | `import_batches.id` | N:1 | 逐实体来源追溯 |
| `reconciliation_issues` | `import_batch_id` / `project_id` | `import_batches.id` / `projects.id` | N:1 | 迁移差异与归因 |

### 3.5 文件引用（多态关联）

`file_refs` 使用 `ownerType` + `ownerId` 多态关联到多种实体：

| ownerType | 关联实体 | 说明 |
|---|---|---|
| `phase_task` | PhaseTask | 阶段任务附件 |
| `supplier_credential` | SupplierCredential | 证照文件 |
| `customer` | Customer | 开票资料附件 |
| `project` | Project | 立项及项目资料 |
| `crew` | Crew | 合作协议 |
| `project_supplier` | ProjectSupplier | 项目×分供方文件 |
| `settlement` | Settlement | 结算确认书 PDF |
| `expenditure_settlement` | ExpenditureSettlement | 支出过程/完工结算单及对账附件 |
| `construction_contract` | ConstructionContract | 施工合同文书扫描件（Tab③ 文件柜 chip 在线预览） |
| `contract_supplement` | ContractSupplement | 支出合同补充协议附件 |
| `contract` | Contract | 审批稿、正式合同扫描件 |
| `company_expense_contract` | CompanyExpenseContract | 公司支出合同 |
| `receipt_registration` | ReceiptRegistration | 收款回单及其他凭证 |
| `invoice_application` | InvoiceApplication | 申请及开票结果附件 |
| `current_transaction` | CurrentTransaction | 往来收付凭证 |
| `payment_record` | PaymentRecord | 银行回单原图/PDF；OCR 与人工确认同一支付事实 |
| `expense_reimbursement` | ExpenseReimbursement | 报销票据和审批附件 |
| `supplement_agreement` | SupplementAgreement | 补充协议文书 |
| `boq_change_order` | BoqChangeOrder | 变更单附件，category 细分**各有放置区**：我方指令单（可多版）/ 甲方指令单 / 报价 / 算量 / 施工照片 |
| `expenditure_contract` | ExpenditureContract | 合同扫描件 |
| `payment_application` | PaymentApplication | 付款附件 |
| `invoice` | Invoice | 发票原图（原 `ticket_registration` 已随 ADR-0001 废弃） |
| `delivery_record` | DeliveryRecord | 送货单扫描件（`category=source`，每张归档记录一份当前原件） |
| `material_requisition` | MaterialRequisition | 乙供材下料计划 |
| `material_arrival` | MaterialArrival | 乙供材送货单 |
| `material_use` | MaterialUse | 乙供材领料单 |
| `stock_check` | StockCheck | 库存盘点表 |
| `owner_material_requisition` | OwnerMaterialRequisition | 甲供材下料计划 |
| `owner_material_arrival` | OwnerMaterialArrival | 甲供材送货单 |
| `owner_material_direct` | OwnerMaterialDirect | 甲供材签收单 |
| `monthly_statement` | MonthlyStatement | 月度报量扫描件 |
| `project_acceptance` | ProjectAcceptance | 验收/保修资料 |
| `owner_final_settlement` | OwnerFinalSettlement | 甲方结算书 |
| `owner_penalty` | OwnerPenalty | 甲方联系单 |
| `subcontract_change_order` | SubcontractChangeOrder | 分包签证单 |
| `unit_stage_completion` | UnitStageCompletion | 验收照片（挂“户 × 工序阶段”；缺照片只允许取消/存草稿） |
| `crew` | Crew | 班组合作协议及其他班组档案附件 |
| `worker` | Worker | 工人证件照片/信息文件 |
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
| `schedule_process_library_tasks` | `library_id` | `schedule_process_libraries.id` | N:1 | 标准工序定义 → 不可变标准工序库版本；前置 key 与 disabled 状态随版本保存 |
| `schedule_groups` | `projectId` | `projects.id` | N:1 | 楼栋分组 → 项目 |
| `schedule_groups` | `contract_id` | `contracts.id`（`kind='施工'`） | N:1 | 条件外键；`scope_basis='contract'` 时必填且项目必须一致，`provisional` 时必须为空；合同分组禁止跨合同混组 |
| `schedule_group_buildings` | `groupId` | `schedule_groups.id` | N:1 | 分组×楼栋 |
| `schedule_group_buildings` | `buildingId` | `buildings.id` | N:1 | 一分组含多栋 |
| `schedule_tasks` | `projectId` | `projects.id` | N:1 | 工序 → 项目 |
| `schedule_tasks` | `groupId` | `schedule_groups.id` | N:1 | 工序 → 楼栋分组；项目/分组 summary 直接由对应实体及其子工序派生，不复制为任务行 |
| `schedule_tasks` | `parentId` | `schedule_tasks.id` | N:1 | 可选的工序任务 → 子任务扩展；当前项目→分组→工序三层由实体外键表达，普通工序为 NULL |
| `schedule_tasks` | `stage_id` | `construction_stages.id` | N:1 | 工序任务 → 稳定阶段；`has_qty=1` 必填 |
| `task_dependencies` | `predId` / `succId` | `schedule_tasks.id` | N:1 | 前后置依赖（FS/SS/FF/SF + lag） |
| `task_item_map` | `taskId` | `schedule_tasks.id` | N:1 | 工序 → 分项映射 |
| `schedule_task_floor_plans` | `task_id` / `floor_id` / `item_id` / `boq_line_id` | `schedule_tasks.id` / `floors.id` / `items.id` / `boq_lines.id` | N:1 | 排程域拥有的分项×楼层计划；`source_basis=contract` 必须有 BOQ，`provisional` 只保留暂估量且 BOQ 为空 |

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
| 主合同金额 | `SELECT SUM(amount) FROM contracts WHERE project_id = ? AND kind = '施工' AND status NOT IN ('draft','草稿')`；草稿仍可在详情子表查看，但不进入正式合计 |
| 增补合同额 | `SELECT SUM(s.amount) FROM contract_supplements s JOIN contracts c ON c.id = s.contract_id WHERE c.project_id = ? AND c.kind = '施工' AND c.status NOT IN ('draft','草稿') AND s.status NOT IN ('draft','草稿')` |
| 变洽签审定额 | `SELECT SUM(tax_inc_amount) FROM owner_change_orders WHERE project_id = ? AND (source_locked = 1 OR status = 'approved' OR approval_date <> '')`（锁定的 BOQ 自动台账、已签证记录及迁移前有审定日期的历史记录；提交未审定不计） |
| 变更后合同额 | 主合同 + 增补 + 变洽签 |
| 项目收款 | `SELECT SUM(amount) FROM receipt_registrations WHERE project_id = ? AND status NOT IN ('draft','草稿')` |
| 确认支付 | `SELECT SUM(amount) FROM payment_records WHERE project_id = ? AND confirmation_status = 'confirmed'`；是否分摊到付款申请另由 §4.2.1 的勾稽差额表达 |
| 工人工资支付 | `SUM(wage_statements.actual_amount)`，仅 `status='released'`（界面“已发放”） |
| 动态成本 | 五类已确认 `expenditure_settlements.totalAmount` + 已发放工资 + 已确认费用报销（§10.4） |
| 往来收款 | `SELECT SUM(amount) FROM current_transactions WHERE project_id = ? AND direction = 'receipt' AND status NOT IN ('draft','草稿') AND deleted_at IS NULL` |
| 往来付款 | `SELECT SUM(amount) FROM current_transactions WHERE project_id = ? AND direction = 'payment' AND status NOT IN ('draft','草稿') AND deleted_at IS NULL` |
| 收支差额 | 全部已确认资金流入 − 全部已确认资金流出（§10.6） |
| 工程款余缺 | 项目合同收款 − 确认支付 |
| 管理费 | 当前未接入权威来源，界面显示 `—`，不得以 `0` 冒充已知事实 |
| 已知资金余额 | 项目收款 + 往来收款 − 确认支付 − 往来付款；当前明确不含尚未接入的管理费，不能命名为完整“可用资金余额” |

### 4.2 票据信息面板（project-info.md）

| 字段 | SQL 计算 |
|---|---|
| 销项票额 | `SELECT SUM(amount) FROM invoice_applications WHERE project_id = ? AND status NOT IN ('draft','草稿')` |
| 销项税额 | `SELECT SUM(tax_amount) FROM invoice_applications WHERE project_id = ? AND status NOT IN ('draft','草稿')` |
| 进项票额 | `SELECT SUM(amount) FROM invoices WHERE project_id = ? AND account_status = 'archived'`（ADR-0001，反馈轮 9 已在设计稿联动验证） |
| 进项税额 | `SELECT SUM(tax_amount) FROM invoices WHERE project_id = ? AND account_status = 'archived'` |
| 增值税 | 销项税额 − 进项税额 |
| 税负率 | 增值税 / 销项票额；销项票额为 0 时不可计算，界面显示 `—` 而不是 `0%` |

### 4.2.1 付款申请勾稽（finance-payment.md · ADR 0015）

| 字段 | 计算 |
|---|---|
| 关联结算金额 | `SUM(payment_application_settlement_allocations.allocatedAmount)`，只计未软删行 |
| 结算差额 | `payment_applications.applyAmount − 关联结算金额`；有合同五类提交时必须为 0 |
| 关联发票金额 | `SUM(payment_application_invoice_allocations.allocatedAmount)`，只计未软删行 |
| 待回票金额 | `max(payment_applications.applyAmount − 关联发票金额, 0)`；仅 `invoiceState='先款后票'` 展示 |
| 单票剩余可关联金额 | `invoices.total_amount − SUM(该 invoiceId 跨全部付款申请的有效 allocatedAmount)`；写入后不得小于 0 |
| 已付金额 | `SUM(payment_record_application_allocations.allocated_amount)`，只连接 `payment_records.confirmation_status='confirmed'` |
| 支付分摊差额 | `payment_records.amount − SUM(该支付记录有效 allocated_amount)`；确认支付时必须为 0 |

### 4.3 分供方汇总（base-supplier.md）

| 字段 | SQL 计算 |
|---|---|
| 合作项目数 | `SELECT COUNT(*) FROM project_suppliers WHERE supplierId = ?` |
| 合同数 | `SELECT COUNT(*) FROM contracts WHERE supplier_id = ? AND kind <> '施工'` |
| 合同总额 | `Σ contracts.amount + Σ有效 contract_supplements.amount`，按 `supplier_id` 过滤 |
| 累计已付 | 按分供方连接已确认 `payment_records` 与 `payment_record_application_allocations` 求和 |
| 应付余额 | 合同总额 − 累计已付 |

### 4.4 ProjectSupplier 汇总（project-supplier.md）

| 字段 | SQL 计算 |
|---|---|
| contractTotal | `Σ contracts.amount + Σ有效 contract_supplements.amount`，按 `project_id + supplier_id` 过滤 |
| claimedTotal | `SELECT SUM(amount) FROM payment_applications WHERE projectId = ? AND supplierId = ? AND approvalStatus = 'approved'` |
| paidTotal | 按 `project_id + supplier_id` 连接已确认支付记录分摊求和 |
| invoiceTotal | `SELECT SUM(amount) FROM invoices WHERE project_id = ? AND supplier_id = ? AND account_status = 'archived'` |
| balance | contractTotal − paidTotal |

### 4.5 可复用经营聚合（旧首页 Dashboard 指标）

> 2026-07-18：当前首页已裁定以统一施工进度甘特为准，本节只保留可复用的数据聚合口径，不代表首页必须展示指标卡或固定网格；旧 UI 蓝本见 `homepage-dashboard.md` 废弃横幅。

| 字段 | SQL 计算 |
|---|---|
| 合同总额 | `SELECT SUM(amount) FROM contracts WHERE project_id = ? AND kind = '施工'` + `contract_supplements` 有效补充协议 + 变更 |
| 累计收款 | `SELECT SUM(amount) FROM receipt_registrations WHERE projectId = ?` |
| 累计支出 | 已确认支付记录 + 已确认工资发放 + 已确认往来/保证金/备用金等其他资金流出；禁止读取付款申请头手写已付值 |
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
| 项目目标成本（按科目） | `SELECT cost_category, SUM(amount) FROM target_cost_items ti JOIN target_costs t ON ti.target_cost_id=t.id WHERE t.project_id=? AND t.is_baseline=1 AND t.status='submitted' AND t.deleted_at IS NULL AND ti.deleted_at IS NULL GROUP BY cost_category`；草稿基线不进入正式控制 |
| 项目实际成本（按科目） | 专业分包/合同劳务/材料/机械/其他=对应已确认支出结算；工人工资=已发放工资快照；费用报销=已确认报销。付款和送货单不重复计入成本 |
| 项目已签/已付（按科目） | 已签=正式支出合同主额 + 非草稿补充协议；已付=已确认 `payment_records` 经付款申请分摊到合同后按 `contracts.cost_category` 聚合。无合同归属的支付不得按用途文本猜入成本分类 |
| 项目支出合同关系 | 主合同、`contract_supplements`、`subcontract_change_orders`、`expenditure_settlements` 与确认支付均以 canonical `contracts.id` 串联，并同时校验 `project_id`；详情页不按名称、金额或分供方文本补关系 |
| 成本偏差率 | `(实际 − 目标) / 目标`（科目级与合计级） |

### 4.7 清单量差与产值（subcontract-quantity.md · CONTEXT.md「三量」「变更单」「月度报量」）

| 字段 | 计算 |
|---|---|
| 合同量（含变更） | `boq_lines` 原始行 + **已签证**变更行增量（`boq_change_orders.status='approved'` 的 `boq_change_lines.deltaQty`）；可另开参考口径含已上报 |
| 量差（分项×楼栋） | 基准量 − 合同量，基准量可勾选 = 合同 / 暂估 / 现场（`house_type_template_items` 三量，按挂靠户展开到楼栋） |
| 量差金额 | 量差 × 合同单价（`boq_lines.unit_price`，调价变更取已签证新单价） |
| 产值 | Σ完成量 × 合同单价，含已签证变更（CONTEXT.md「单价双轨」：合同单价轨） |
| 分项毛利 | (合同单价 − 班组分项单价) × 量（现场量未核定用暂估量预估） |
| 月度报量草稿行 | 按报量阶段映射筛当月 `unit_stage_completions.completed_at`，连接户型模板现场量 × 合同单价 → `monthly_statement_lines.auto_qty`；同一分项映射多阶段不得重复计量 |

---

## § 5 SQLite 建表顺序

按外键依赖排序，先建被引用的表；同批次内仍按下列先后执行：

```
第 1 批（无外键依赖）
  customers, suppliers, bank_codes, crews
  company_expense_contracts, stock_checks, import_batches
  schedule_process_libraries, invoice_export_settings

第 2 批（只依赖第 1 批）
  projects
  supplier_credentials, supplier_credential_requirements
  stock_check_lines, schedule_process_library_tasks

第 3 批（依赖第 2 批）
  workers, project_suppliers, phase_tasks
  construction_contracts, owner_change_orders, expenditure_contracts, contracts
  settlements, supplement_agreements, contract_supplements, contract_line_items
  expenditure_settlements, project_acceptances, owner_final_settlements, owner_penalties
  subcontract_change_orders
  invoice_applications, receipt_registrations, current_transactions
  invoices, payment_applications, payment_records, expense_reimbursements
  material_requisitions, material_arrivals, material_uses
  owner_material_controls, owner_material_requisitions, owner_material_arrivals
  owner_material_uses, owner_material_directs, delivery_records, project_aliases
  import_source_refs, reconciliation_issues
  buildings, schedule_groups, target_costs, items
  penalty_records
  construction_stages, house_type_templates, monthly_statements

第 4 批（头表子表/分摊）
  material_arrival_lines, expense_reimbursement_lines
  floors, rooms, schedule_group_buildings, schedule_tasks, target_cost_items
  construction_stage_items
  boq_files, boq_change_orders
  payment_application_settlement_allocations
  payment_application_invoice_allocations
  delivery_lines, wage_statements

第 5 批（依赖第 4 批）
  units, task_dependencies, item_unit_prices
  boq_lines
  payment_record_application_allocations

第 6 批（依赖第 5 批）
  house_type_template_items, task_item_map
  unit_assignments, unit_stage_completions
  wage_statement_lines, attendance_records, boq_change_lines
  monthly_statement_lines, schedule_task_floor_plans

第 7 批（依赖模板 rooms / unit_assignments）
  unit_assignment_scopes

第 8 批（多态关联）
  file_refs → ownerType + ownerId（应用层保证一致性）
  file_payloads → file_refs（1:1 正文，仅按需读取）
```

Issue #116 的实现迁移分成 F1→F5 五个可独立验收批次（§2.10.1）。这里的数字批次表示最终建表依赖，不等同于发布批次；每个发布批次必须先建新表/新列和索引，再迁数据、双读核对，最后停写旧列/旧表，禁止先删旧数据。

---

## § 6 索引建议

```sql
-- 高频查询：按项目查所有单据
CREATE INDEX idx_project_suppliers_proj ON project_suppliers(projectId);
CREATE INDEX idx_project_suppliers_sup ON project_suppliers(supplierId);
CREATE INDEX idx_expenditure_contracts_proj ON expenditure_contracts(projectId);
CREATE INDEX idx_expenditure_contracts_sup ON expenditure_contracts(supplierId);
CREATE INDEX idx_payment_applications_proj ON payment_applications(project_id);
CREATE INDEX idx_payment_applications_sup ON payment_applications(supplier_id);
CREATE INDEX idx_contract_supplements_contract ON contract_supplements(contract_id);
CREATE INDEX idx_expenditure_settlements_proj ON expenditure_settlements(project_id);
CREATE INDEX idx_expenditure_settlements_sup ON expenditure_settlements(supplier_id);
CREATE INDEX idx_expenditure_settlements_contract ON expenditure_settlements(contract_id);
CREATE INDEX idx_pasa_application ON payment_application_settlement_allocations(payment_application_id);
CREATE INDEX idx_pasa_settlement ON payment_application_settlement_allocations(settlement_id);
CREATE INDEX idx_paia_application ON payment_application_invoice_allocations(payment_application_id);
CREATE INDEX idx_paia_invoice ON payment_application_invoice_allocations(invoice_id);
CREATE INDEX idx_payment_records_project ON payment_records(project_id);
CREATE INDEX idx_payment_records_supplier ON payment_records(supplier_id);
CREATE INDEX idx_praa_record ON payment_record_application_allocations(payment_record_id);
CREATE INDEX idx_praa_application ON payment_record_application_allocations(payment_application_id);
CREATE INDEX idx_expense_reimbursements_project ON expense_reimbursements(project_id, status);
CREATE INDEX idx_import_batches_project ON import_batches(project_id);
CREATE INDEX idx_import_source_refs_batch ON import_source_refs(import_batch_id);
CREATE INDEX idx_reconciliation_issues_batch ON reconciliation_issues(import_batch_id, status);
CREATE UNIQUE INDEX uq_pasa_source ON payment_application_settlement_allocations(payment_application_id, settlement_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_paia_source ON payment_application_invoice_allocations(payment_application_id, invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_project ON invoices(project_id);
CREATE INDEX idx_invoices_supplier ON invoices(supplier_id);
CREATE INDEX idx_invoices_account ON invoices(account_status);
-- invoice_export_settings 只有固定单例主键，无外键和列表查询，不需要二级索引。

-- ADR 0014 整页表单目标索引（F1-F5 迁移创建）
CREATE UNIQUE INDEX uq_customers_tax_no
  ON customers(tax_no) WHERE deleted_at IS NULL AND tax_no <> '';
CREATE INDEX idx_projects_customer ON projects(customer_id);
CREATE INDEX idx_projects_secondary_customer ON projects(secondary_customer_id);
CREATE INDEX idx_workers_current_project ON workers(current_project_id);
CREATE INDEX idx_contracts_project ON contracts(project_id);
CREATE INDEX idx_contracts_customer ON contracts(customer_id);
CREATE INDEX idx_contracts_supplier ON contracts(supplier_id);
CREATE INDEX idx_contract_line_items_contract ON contract_line_items(contract_id);
CREATE INDEX idx_current_transactions_project_direction
  ON current_transactions(project_id, direction, transaction_date);
CREATE UNIQUE INDEX uq_payment_records_bank_serial
  ON payment_records(bank_serial_no)
  WHERE deleted_at IS NULL
    AND confirmation_status = 'confirmed'
    AND bank_serial_no <> '';
CREATE INDEX idx_expense_reimbursement_lines_head
  ON expense_reimbursement_lines(reimbursement_id);
CREATE INDEX idx_material_requisitions_project ON material_requisitions(project_id);
CREATE INDEX idx_material_arrivals_project ON material_arrivals(project_id);
CREATE INDEX idx_material_arrivals_requisition ON material_arrivals(requisition_id);
CREATE INDEX idx_material_arrival_lines_head ON material_arrival_lines(arrival_id);
CREATE INDEX idx_material_uses_project ON material_uses(project_id);
CREATE INDEX idx_stock_check_lines_head ON stock_check_lines(stock_check_id);
CREATE INDEX idx_owner_material_controls_project ON owner_material_controls(project_id);
CREATE INDEX idx_owner_material_requisitions_project ON owner_material_requisitions(project_id);
CREATE INDEX idx_owner_material_arrivals_project ON owner_material_arrivals(project_id);
CREATE INDEX idx_owner_material_uses_project ON owner_material_uses(project_id);
CREATE INDEX idx_owner_material_directs_project ON owner_material_directs(project_id);
CREATE INDEX idx_project_acceptances_project ON project_acceptances(project_id);
CREATE INDEX idx_owner_final_settlements_project ON owner_final_settlements(project_id);
CREATE INDEX idx_owner_penalties_project ON owner_penalties(project_id);
CREATE INDEX idx_subcontract_changes_project ON subcontract_change_orders(project_id);

-- 证照查询
CREATE INDEX idx_supplier_credentials_sup ON supplier_credentials(supplierId);
CREATE INDEX idx_supplier_credential_requirements_supplier
  ON supplier_credential_requirements(supplier_id);
CREATE UNIQUE INDEX uq_supplier_credential_requirement
  ON supplier_credential_requirements(supplier_id, category)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_supplier_credential_file_ref
  ON supplier_credentials(file_ref_id)
  WHERE file_ref_id IS NOT NULL AND deleted_at IS NULL;

-- 文件多态查询
CREATE INDEX idx_file_refs_owner ON file_refs(owner_type, owner_id);
CREATE UNIQUE INDEX uq_file_refs_delivery_source
  ON file_refs(owner_type, owner_id, category)
  WHERE deleted_at IS NULL AND owner_type = 'delivery_record' AND category = 'source';

-- 合同子表
CREATE INDEX idx_supplement_agreements_contract ON supplement_agreements(contractId);

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
CREATE INDEX idx_schedule_floor_plans_task ON schedule_task_floor_plans(task_id);
CREATE INDEX idx_schedule_floor_plans_floor ON schedule_task_floor_plans(floor_id);
CREATE INDEX idx_schedule_floor_plans_item ON schedule_task_floor_plans(item_id);
CREATE INDEX idx_schedule_floor_plans_boq ON schedule_task_floor_plans(boq_line_id);
CREATE UNIQUE INDEX uq_schedule_floor_plan_contract_scope
  ON schedule_task_floor_plans(task_id, floor_id, boq_line_id)
  WHERE deleted_at IS NULL AND source_basis = 'contract' AND boq_line_id IS NOT NULL;
CREATE UNIQUE INDEX uq_schedule_floor_plan_provisional_scope
  ON schedule_task_floor_plans(task_id, floor_id, item_id)
  WHERE deleted_at IS NULL AND source_basis = 'provisional';

-- 基础主数据
CREATE UNIQUE INDEX uq_crews_name_active
  ON crews(name) WHERE deleted_at IS NULL AND name <> '';

-- 目标成本
CREATE INDEX idx_target_costs_proj ON target_costs(project_id);
CREATE UNIQUE INDEX uq_target_costs_baseline
  ON target_costs(project_id) WHERE deleted_at IS NULL AND is_baseline = 1;
CREATE INDEX idx_tci_target ON target_cost_items(target_cost_id);

-- 清单与变更
CREATE INDEX idx_boq_files_contract ON boq_files(contract_id);
CREATE INDEX idx_boq_lines_file ON boq_lines(boq_file_id);
CREATE INDEX idx_boq_lines_project ON boq_lines(project_id);
CREATE INDEX idx_boq_lines_contract ON boq_lines(contract_id);
CREATE INDEX idx_boq_lines_item ON boq_lines(item_id);
CREATE INDEX idx_boq_change_orders_project ON boq_change_orders(project_id);
CREATE INDEX idx_boq_change_orders_contract ON boq_change_orders(contract_id);
CREATE INDEX idx_boq_change_orders_status ON boq_change_orders(status); -- 200 份量级按状态筛选
CREATE INDEX idx_boq_change_lines_order ON boq_change_lines(change_order_id);
CREATE INDEX idx_boq_change_lines_item ON boq_change_lines(item_id);
CREATE INDEX idx_item_unit_prices_project ON item_unit_prices(project_id);
CREATE INDEX idx_item_unit_prices_item ON item_unit_prices(item_id);
CREATE INDEX idx_item_unit_prices_file ON item_unit_prices(boq_file_id);
CREATE UNIQUE INDEX uq_boq_line_trace ON boq_lines(boq_file_id, trace_key)
  WHERE deleted_at IS NULL AND boq_file_id IS NOT NULL AND trace_key <> '';
CREATE UNIQUE INDEX uq_boq_change_order_ledger ON boq_change_orders(ledger_id)
  WHERE deleted_at IS NULL AND ledger_id IS NOT NULL;

-- 月度报量
CREATE INDEX idx_monthly_statements_project_period ON monthly_statements(project_id, period_no);
CREATE INDEX idx_monthly_statement_lines_statement ON monthly_statement_lines(statement_id);
CREATE UNIQUE INDEX uq_monthly_statement_contract_period ON monthly_statements(contract_id, period_no)
  WHERE deleted_at IS NULL;

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
5. 所有业务实体 id 使用 `{表缩写}_{timestamp36}_{seq36}` 格式（如 `sup_m1abc_0`）；不参与业务关联的本机单例设置表可在 §2 明确登记例外并使用固定主键 `default`（当前仅 `ocr_settings`、`invoice_export_settings`）
6. 遵守 [ADR 0015](../adr/0015-form-persistence-and-payment-reconciliation.md)：用户可编辑业务字段默认持久化（标量列 / lookup 外键 / grid 子表 / file_refs）；`readonly + compute`、`_` 展示字段和纯聚合不存。人工复核后具有审计意义的值例外，例如 `delivery_lines.amount` 必须独立存储，不能在保存时重算覆盖
7. 新增支出类实体必须定义 **costCategory 归集口径**（专业分包/合同劳务/材料/机械/工人工资/费用报销/其他，§ 2.8），否则成本对比（§ 4.6）会漏项
8. 排程/进度类改动必须与 `schedule-progress.md` 双向同步（§ 2.7 / § 3.6 / § 4.6）；工程量矩阵以 **[ADR 0010](../adr/0010-quantity-matrix-and-construction-record-model.md)** 为准：量=`house_type_template_items`、责任=`unit_assignments`、完成=`unit_stage_completions`，稳定阶段=`construction_stages`
9. 付款申请头与结算/发票分摊必须由同一 action 事务写入；源单展示字段不得复制，提交勾稽与发票全局额度检查遵守 ADR 0015
10. **禁用旧名**：`ticket_registrations`（→ `invoices` 单表，ADR-0001）、`payroll_records`（→ 工资三表）、`price_comparisons`（→ `delivery_lines` 聚合视图）、`quantities` / `quantity_records`（→ ADR 0010 分层表）
11. 页面读模型、DTO 标量、关系引用、空错权限和 adapter 边界统一看 [`READ-MODELS.md`](./READ-MODELS.md)；DTO 中出现可观察字段不等于授权新增数据库列，写模型和 canonical 外键仍须先在本文件裁定

---

## § 10 通用项目经营汇总增补（2026-07-23）

> 来源：车陂商业大楼项目迁移分析。该项目只是首个验收样本，以下模型是通用规则。与前文冲突时，本节及 ADR 0015 的较新决策优先。

### 10.1 合同分类与补充协议

`contracts.kind/sub_kind` 继续承担界面分组，新增稳定经营维度和迁移留痕：

```sql
ALTER TABLE contracts ADD COLUMN cost_category TEXT DEFAULT '';
-- '专业分包' | '合同劳务' | '材料' | '机械' | '其他'

ALTER TABLE contracts ADD COLUMN legacy_type TEXT DEFAULT '';
ALTER TABLE contracts ADD COLUMN classification_state TEXT DEFAULT 'classified';
-- 'classified' | 'unclassified' | 'no_contract'
ALTER TABLE contracts ADD COLUMN signer_name TEXT DEFAULT '';
ALTER TABLE contracts ADD COLUMN contact_phone TEXT DEFAULT '';
ALTER TABLE contracts ADD COLUMN tax_rate REAL;
```

`kind` 目标值扩展为 `'施工' | '分包' | '材采' | '其他支出'`。映射：

- 专业分包：`kind='分包', sub_kind='专业'`
- 合同劳务：`kind='分包', sub_kind='劳务'`
- 材料：`kind='材采'`
- 机械、其他：`kind='其他支出'`

施工和支出合同的新补充协议均不得继续复用只挂 `construction_contracts` 的旧 `supplement_agreements`；统一引用 canonical `contracts`：

```sql
CREATE TABLE contract_supplements (
  id             TEXT PRIMARY KEY,
  contract_id    TEXT NOT NULL REFERENCES contracts(id),
  no             TEXT DEFAULT '',
  name           TEXT NOT NULL,
  content        TEXT DEFAULT '',
  amount         REAL NOT NULL DEFAULT 0,
  sign_date      TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT '有效',
  external_ref   TEXT DEFAULT '',
  note           TEXT DEFAULT '',
  created_at     TEXT,
  updated_at     TEXT,
  deleted_at     TEXT
);

CREATE INDEX idx_contract_supplements_contract
  ON contract_supplements(contract_id, deleted_at);
```

合同有效金额=`contracts.amount + Σ有效 contract_supplements.amount`；支出合同经营汇总使用同一口径。`contracts.changed/settled/invoiced/paid` 的存量静态值只能用于迁移对账；新读路径分别从补充协议、变更/结算、发票和支付分摊聚合。

### 10.2 支付记录及付款申请分摊

普通合同付款的权威金额只保存于 `payment_records.amount`。目标表补齐识别、审核和银行流水字段：

```sql
-- 现有表按 SQLite 重建表迁移补齐；此处列出目标增量
ALTER TABLE payment_records ADD COLUMN supplier_id TEXT REFERENCES suppliers(id);
ALTER TABLE payment_records ADD COLUMN payee_name TEXT DEFAULT '';
ALTER TABLE payment_records ADD COLUMN purpose TEXT DEFAULT '';
ALTER TABLE payment_records ADD COLUMN source TEXT DEFAULT 'manual';
-- 'image_ocr' | 'manual' | 'excel_import'
ALTER TABLE payment_records ADD COLUMN recognition_status TEXT DEFAULT 'manual';
ALTER TABLE payment_records ADD COLUMN confirmation_status TEXT DEFAULT 'draft';
-- 'draft' | 'needs_review' | 'confirmed'
ALTER TABLE payment_records ADD COLUMN bank_serial_no TEXT DEFAULT '';
ALTER TABLE payment_records ADD COLUMN ocr_payload TEXT DEFAULT '';
ALTER TABLE payment_records ADD COLUMN field_confidence TEXT DEFAULT '';
ALTER TABLE payment_records ADD COLUMN confirmed_by TEXT DEFAULT '';
ALTER TABLE payment_records ADD COLUMN confirmed_at TEXT;
ALTER TABLE payment_records ADD COLUMN external_ref TEXT DEFAULT '';
ALTER TABLE payment_records ADD COLUMN updated_at TEXT;
ALTER TABLE payment_records ADD COLUMN deleted_at TEXT;
ALTER TABLE payment_applications ADD COLUMN external_ref TEXT DEFAULT '';
```

旧 `payment_records.payment_application_id` 退出写入路径，改用分摊表：

```sql
CREATE TABLE payment_record_application_allocations (
  id                     TEXT PRIMARY KEY,
  payment_record_id      TEXT NOT NULL REFERENCES payment_records(id),
  payment_application_id TEXT NOT NULL REFERENCES payment_applications(id),
  allocated_amount       REAL NOT NULL CHECK (allocated_amount > 0),
  note                   TEXT DEFAULT '',
  created_at             TEXT,
  updated_at             TEXT,
  deleted_at             TEXT
);

CREATE UNIQUE INDEX uq_payment_record_application_allocation
  ON payment_record_application_allocations(payment_record_id, payment_application_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_praa_record
  ON payment_record_application_allocations(payment_record_id, deleted_at);
CREATE INDEX idx_praa_application
  ON payment_record_application_allocations(payment_application_id, deleted_at);
```

确认支付记录的事务约束：

1. 金额、日期、收款方和凭证均已人工核对；
2. `Σ该支付有效分摊.allocated_amount = payment_records.amount`；
3. 同一 `bank_serial_no` 在有效记录中不得重复；
4. OCR 置信度不替代人工确认；
5. 未确认支付不进入已付、合同付款或现金流汇总。

付款申请派生字段：

```text
paid_amount =
  Σ payment_record_application_allocations.allocated_amount
  WHERE payment_record.confirmation_status = 'confirmed'

actual_payment = paid_amount
unpaid_amount = max(COALESCE(approved_amount, apply_amount) - paid_amount, 0)
```

`payment_applications.paid_amount/actual_payment` 旧列在兼容期只读；迁移完成后移除。分摊金额写入、支付确认、撤回及操作日志必须在同一事务内。

### 10.3 工人工资与费用报销

工人工资按 #117 的负责人请款簿管理。工资单通过“确认发放”动作进入“已发放”状态时，同时确认成本和已支付事实，不生成逐工人支付记录或合同付款申请：

```text
工资动态成本 = Σ wage_statements.actual_amount
WHERE status = 'released'

工资资金流出 = 同一集合
```

工资金额必须保存发放时快照；工程量或人员资料后改不追溯历史发放。

费用报销的目标头表与明细表见 §2.10.4。`project_id` 可空，空值明确表示公司开支；总额始终由有效 `expense_reimbursement_lines.amount` 聚合，头表不保存第二份可编辑金额。

F3 迁移将旧 `expense_reimbursements.amount > 0` 的记录转换为一条 `expense_item='迁移汇总'` 的明细并记录来源追溯；旧金额为空或资料不完整时写 `reconciliation_issues`，不得补 0。只有 `status='confirmed'` 的报销进入动态成本。

### 10.4 动态成本与合同付款

```text
动态成本 =
  Σ已确认支出结算.total_amount（按合同 cost_category 五类）
  + Σ已发放工资.actual_amount
  + Σ费用报销明细.amount（仅头 status='confirmed' 且头/明细均未软删）

动态效益 = 客户已确认收入 - 动态成本
动态效益率 = 动态效益 / 客户已确认收入
```

客户确认收入尚未取得时，动态效益和动态效益率返回 `pending`，不得用施工合同额、项目收款或支出金额代替；客户确认收入为 0 时，动态效益率不做除法并按完整性契约返回状态。

合同付款只统计：

```text
Σ已确认 payment_record 分摊
WHERE payment_application.contract_id IS NOT NULL
GROUP BY contract.cost_category
```

禁止：

- 用合同金额补空结算；
- 用付款申请金额或支付记录金额补动态成本；
- 用送货单金额与材料结算重复计成本；
- 根据付款用途文本推断合同分类。

### 10.5 经营汇总完整性

经营汇总 API 的每个指标返回：

```ts
interface OperatingMetric {
  value: number | null
  status: 'complete' | 'partial' | 'pending' | 'not_applicable' | 'undefined'
  missingSources: string[]
  asOf: string
  drilldown: { entity: string, filter: Record<string, string> } | null
}
```

含义：

- `complete`：所需来源均已纳入；
- `partial`：已有部分金额，但至少一个组成来源缺失；
- `pending`：应有来源尚未取得，不返回伪造 0；
- `not_applicable`：本期明确不统计，例如库存；
- `undefined`：业务公式尚未定义，例如资金效能。

### 10.6 资金计算

```text
总流入 =
  已确认项目收款 + 其他收款 + 往来收款
  + 保证金退回 + 备用金退回

总流出 =
  已确认支付记录 + 已确认工资发放 + 往来付款
  + 保证金缴纳 + 备用金申请

收支差额 = 总流入 - 总流出
工程款余缺 = 项目合同收款 - 合同类支付记录
```

首个样本的迁移前显示值只在[睿璟验收清单](../migration/ruijing-acceptance.md)维护。系统按实体重新派生；差异进入对账，不反写静态值。

### 10.7 导入追溯与差异表

```sql
CREATE TABLE import_batches (
  id             TEXT PRIMARY KEY,
  project_id     TEXT REFERENCES projects(id),
  source_file    TEXT NOT NULL,
  source_hash    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft',
  created_at     TEXT,
  completed_at   TEXT
);

CREATE TABLE import_source_refs (
  id              TEXT PRIMARY KEY,
  import_batch_id TEXT NOT NULL REFERENCES import_batches(id),
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  source_sheet    TEXT NOT NULL,
  source_row      INTEGER NOT NULL,
  source_key      TEXT DEFAULT '',
  raw_snapshot    TEXT DEFAULT ''      -- JSON 对象；保留未进入业务表的源列及原始文本
);

CREATE TABLE reconciliation_issues (
  id              TEXT PRIMARY KEY,
  import_batch_id TEXT NOT NULL REFERENCES import_batches(id),
  project_id      TEXT REFERENCES projects(id), -- 允许为空：实体映射失败时可能尚无合法项目
  entity_type     TEXT DEFAULT '',
  entity_id       TEXT DEFAULT '',
  field_name      TEXT DEFAULT '',
  source_value    TEXT DEFAULT '',
  metric_key      TEXT NOT NULL,
  source_ref      TEXT DEFAULT '',
  excel_value     REAL,
  system_value    REAL,
  difference      REAL,
  attribution     TEXT NOT NULL,
  -- 'project' | 'excel' | 'mapping' | 'missing_source'
  status          TEXT NOT NULL DEFAULT 'open',
  resolution      TEXT DEFAULT '',
  created_at      TEXT,
  resolved_at     TEXT
);
```

`entity_type + entity_id + field_name + source_value` 定位无法进入真实外键的源值；`project_id` 只在已有合法项目归属时填写，不创建“公司”或“待核对”等虚拟项目补空。

导入有效行以业务字段判断，不以 Excel `usedRange`、序号或公式存在判断。所有金额在应用边界统一 `round2`；在全库迁移为整数分之前，禁止直接比较浮点绝对相等。

### AX03 中央项目罚扣与独立抵扣事实

`project_penalty` 接管 `penalty_records.source='project'`；现有巡检/验收等其他来源不改归属。浏览器正式头事实、整改及抵扣由同一中央 command 权威管理，旧 SQLite 只用于受控备份/迁移；不增加平行罚扣主表。中央实例部署边界见 ADR 0020。

- 罚扣头保留项目、可空分供方/分包合同/班组、日期、金额、事由、扣除方式、最新整改期限/说明、状态及附件身份。迁移保留草稿、待抵扣、整改中、自行/委托整改完成和已抵扣状态；缺失历史不伪造。
- 中央抵扣是独立追加事实：`id, penaltyId, settlementId, amount, actorId, occurredAt, commandId, note`。同一罚扣可向同一结算分次追加；旧 SQLite 活跃关系对唯一约束仅为历史表约束，不限制中央审计。旧 ID、时间与金额按原事实映射；经办或命令未记录保持空值。
- 中央整改事件独立保存 `id, penaltyId, actorId, occurredAt, deadline, note`，读面只投影当前罚扣的历史。
- 候选必须是已确认真实分包结算，项目 ID 相同，罚扣已填写的合同和分供方 ID 都必须相同。罚扣至少具备合同或分供方证据；仅项目、班组、名称、金额均不能猜接。合同已填时仍验证合同所属项目和分供方。
- 罚扣已抵扣额为独立关系金额合计，剩余为罚扣额减已抵扣额；结算抵扣同样按 `settlementId` 聚合。金额正数且最多两位小数，同时不能超过双方余额，不回写罚扣已扣金额副本，也不改结算原金额。写入以双方版本和幂等命令保护。
- 受控迁移先映射真实结算 ID，再接管抵扣事实；缺失、歧义、归属不符、金额超额或状态矛盾阻断确认。中央读回复用同一事实；回滚按迁移边界撤销接管。甲方罚扣不进入此链。

### AX04 辅助合同中央事实

物理来源保持 `contracts(kind='其他支出')` 与独立 `company_expense_contracts`；不建第二套正式合同表。SQLite v46 为两表补充可空 `party_a / created_by / updated_by / responsible / department`，为公司合同补充可空 `tax_rate / invoice_type`。未知审计、税率、结算或结清状态不反推、不补零。

`invoices` 与 `payment_applications` 新增可空外键 `company_expense_contract_id`，指向公司合同；有该外键时，`contract_id` 和 `project_id` 必须为空，由插入、更新约束共同保证。存量不回填，不以名称、编号、金额或“个人开支”分类猜关联。项目其他支出票款继续使用原 `contract_id`。

中央传输身份为 `(dataOrigin, id, kind)`，`kind` 为 `other_expense / company_expense`。迁移旧键为 `kind:legacyId`，避免两表同 ID 冲突；项目与分供方引用先经核心身份映射。公司合同只保留甲乙方事实文本，项目与分供方 EntityRef 为 null。

- 中央合同头保存专属资料、版本、创建/修改审计；新增和修改操作者取可信业务会话。普通保存保留既有状态，提交草稿进入审批中；不提供虚构审批或结清命令。
- 金额用 MoneyDTO 表达。含税金额及税率均存在时计算无税额和税额；无税额按两位小数舍入，税额取差。缺失金额或税率保持 null，真实零值保持零。
- 关联投影按明确外键读取：已归档发票金额、已确认支付的分摊金额、同项目同分供方的已确认支出结算、有效合同增补。增补属于其他支出合同时随辅助合同接管，不再重复进入施工/分包补充协议节点。
- 累计收票、累计支付、累计结算分别求和；按票应付为收票减支付，按结算应付为结算减支付。其他支出变更后金额为原合同加有效增补；公司合同没有项目结算与增补口径。存在未记录金额的聚合保持 null。
- 附件仍来自 `file_refs` 的 `contract / company_expense_contract` 所属关系，保留文件 ID、分类、上传人、时间及软删除事实；接管后统一由同一中央命令维护元数据。当前不接管文件字节，不保存本机路径。
- 受控迁移确认前不接管，准备阶段校验全部候选，任何无效附件或事实使整次准备失败；确认后同源回读，回滚撤销该批接管和相关命令重放缓存。普通正式新建不因迁移回滚被误删。

本切片不创建合同分项、项目其他收入合同或虚拟项目。端到端验证与部署边界见 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md#ax04-辅助合同接管)。

### AX05 其他支出结算中央事实

物理来源仍为 `expenditure_settlements` 的其他支出种类，不新建结算主表或明细表。SQLite v47 仅补充可空 `created_by / updated_by / responsible / department`，旧审计不反推。浏览器通过 `other-settlements` Repository/HTTP/command 接入，中央测试实例不声明生产持久化能力。

- 受控迁移新增 `other_settlements` 节点，位于 `auxiliary_contracts` 后；合同旧 ID 用 `other_expense:` 命名空间映射。试跑重验合同类型、非草稿状态及项目、分供方一致性，错误关系阻断导入。
- 结算头只保存资料、含税金额、税率和状态；金额链实时投影，有效抵扣来自 `penalty_settlement_deductions`，申请来自 `payment_application_settlement_allocations`，支付来自 `payment_record_application_allocations` 及已确认 `payment_records`。明确旧外键与来源 ID 随关系保留，不按名称或金额猜接。
- 本次金额为含税金额减有效抵扣；可申请为本次金额减有效申请；未付为本次金额减已确认且精确归属的支付。草稿、无效、已删除事实不计入。涉及多结算但无结算级支付分摊时已付/未付为 null，不按比例分配。无有效记录的真实空集合为零；未知集合、未知金额或身份失效保持 null。无税额复用整数分及税率基点舍入。
- 同一合同的累计结算仅纳入已确认、同项目同分供方结算。前期金额仅纳入早于本单结算日期的记录；日期缺失或同日先后不明时保持未知。合同详情不再持有独立结算快照，而由同一结算源投影。中央身份被移除时关联不继续显示可用。
- 附件仍归 `file_refs(owner_type='expenditure_settlement')`；中央只保存元数据，不公开本地路径。保存使用服务端 ID、版本与 commandId，重试幂等，旧版本拒绝覆盖；确认后锁定。未知事实或已有下游事实的结算禁止改挂关系，历史空审计在编辑后仍为空。

专属页面与当前源单下钻边界见[页面蓝本](./pages/contract-forms.md#ax05-当前浏览器实现331)，环境边界见 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md#ax05-其他支出结算接管)。材料到货分摊、冲销和虚构结算明细均未引入。
