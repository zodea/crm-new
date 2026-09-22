# 数据库设计 — 全局实体关系 + 外键索引 + 建表顺序

> 本文件是现有 SQLite 迁移来源（tauri-plugin-sql / sql.js）的实体与外键权威。浏览器中央权威与本地快照隔离由 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md) 裁定；生产持久库方案由[后置生产关口](https://github.com/zodea/crm-new/issues/416)承接。下文同时保留当前来源结构和明确标注的目标增量；不能把历史本地 seed 策略解释为正式工作区初始化，也不能把中央测试实例当作已落地的生产库。

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
| `unique_code` | 分供方内部唯一识别码；中央字段 `uniqueCode` | 与税号独立维护，非空时按 [COMMANDS.md](./COMMANDS.md) 的身份校验分别判重 |
| `tax_no` | 统一社会信用代码/纳税人识别号；中央字段 `taxNo` | 与内部编码独立维护，不以旧 OCR 或导出标签推断二者等义 |
| `external_ref` | 外部旧 ID / 匹配标识 | 迁移、二次导入与对账身份，唯一性沿本节上方既有规则，不替代内部编码或税号 |
| `business_type` | 经营类型，分供方业务描述的可选自由文本 | 保留原值，不推导成第二套类别；分供方类别仍使用 CONTEXT.md 的权威七类 |
| `labor_scope` | 劳务承包范围；中央字段 `laborScope`，词义见 [CONTEXT.md](../../CONTEXT.md#业务) | 可选自由文本，默认空字符串；独立于 `main_business`，不按类别强制必填，也不从既有主营业务自动回填；修改不改变资料齐全度或既有人工作出的核验结论 |
| `address` | 营业执照登记的住所/注册地址 | 工商信息；不得与经营地址或开票地址混用 |
| `invoice_address` | 分供方确认使用的开票资料地址 | 选填；可从注册地址一次性复制，但保存后独立维护、不永久联动 |
| `phone` | 公司电话/开票资料电话 | 选填；与联系人手机 `contact_phone` 分开，不影响资料齐全度 |
| `taxpayer_type` | 纳税人类型 | 选填，默认“未核验”；经官方查询或人工资料确认后填写，“未查到”不得自动推导为“小规模纳税人” |
| `credential_status` | 资料齐全度与人工核验结论 | `incomplete` 缺失/过期；`reviewing` 齐全待核验；`qualified` 人工合格；`rejected` 人工退回 |

2026-09-08 已将 `labor_scope` 接入本地迁移 v48、中央源模型/读写 DTO/解码及表单映射。存量留空，读取旧载荷缺字段时按空值兼容。显式清空保存为空字符串，更新载荷未提供该字段则保留原值；不制造工种枚举或独立关联实体。状态、审计和写入权限沿现有分供方主档契约；审计只记字段名等既定元信息。当前存在旧编码标签混写时保留原始值，按来源核对后更正，不按长度自动将内部编码迁为税号。

`credential_reviewed_at TEXT NULL` 与 `credential_review_note TEXT DEFAULT ''` 是旧 SQLite 的供应商级人工核验凭证：人工通过记录时间和可选备注，人工退回时备注必填；该历史物理 schema 没有操作人字段。#446 中央凭证另外使用当前服务端会话的 `actorId`，历史没有操作者时保持 `null`，不补成迁入人。系统只可按资料规则自动写入 `incomplete/reviewing`，不得自动写入 `qualified/rejected`。迁移 v36 会把没有该级凭证的旧 `qualified` / `rejected` 按真实文件重新计算，不用单份证照的 `verified_at` 冒充整户审核。

广东省内分供方可从应用打开[广东省电子税务局一般纳税人资格查询](https://etax.guangdong.chinatax.gov.cn:8443/xxbg/view/zhsffw/#/query/ybnsrzgcx)辅助核验。应用只负责复制税号、打开官网及记录人工确认结果；验证码由用户在官网完成，不爬取页面、不绕过验证码，也不把该页面当作稳定 API。

`supplier_credential_requirements` 用于持久化“分供方 × 证照类别”的要求，而 `supplier_credentials` 只保存实际已收到的文件。前者保存 `supplier_id`、canonical `category`、`requirement`（`not_applicable | optional | required`）、`reason`、`updated_at`、`deleted_at`，并对活跃 `(supplier_id, category)` 唯一。默认规则：营业执照、法人身份证、银行账户资料为 `required`；签约代表身份证、资质证书、品牌授权书为 `not_applicable`；其余资料为 `optional`。只有被明确改为 `required` 的条件资料，缺失或过期时才影响资料齐全度。

迁移 v36 为 `supplier_credentials` 增加 `file_ref_id`、`valid_from`、`expires_at`、`long_term`、`ocr_confirmed_result`、`ocr_confirmed_at`、`ocr_review_status`。真实原件以有效的 `file_refs(owner_type='supplier_credential', owner_id=credential.id)` + `file_payloads` 保存，`file_ref_id` 是证照元数据到该原件的唯一活跃关联。迁移会把 legacy 非空 `supplier_credentials.file_path` 回填为 `file_ref` 以保留迁移线索，但路径本身不授予读取权限、也不计入齐全度；旧记录必须由用户重新选择原件上传，只有持久化正文存在时才算“已收到”。`ocr_result` 与置信度在识别成功时立即保存并标记 `pending`；“稍后核对”或重启不丢失。最终确认另存于 `ocr_confirmed_result` / `ocr_confirmed_at` 并标记 `confirmed`，不得覆盖原始候选或上一次确认痕迹。

有效期的“已过期 / 30 天内临期”统一按 `Asia/Shanghai` 业务日期判断，避免 UTC 日界线造成提前或延后一天。证照新增、OCR 核对、独立有效期编辑、删除和撤回写入 `supplier_credential_audits`：该表只保存动作、分类变化、变更字段名、有效期前后值与置信度，不保存 OCR 原文或人工确认正文；删除/撤回按明确的证照 ID 与 `deleted_at` 在同一事务恢复。上述动作不得使用通用 `operation_logs` 对 `supplier_credentials` 或 `suppliers` 做整行前后快照，避免复制 OCR 原文、税号和银行账号。

供应商新增、编辑、导入、删除/撤回、人工资料核验与纳税人核验统一写 `supplier_audits`。该表只保存 `action`、规范化 `outcome`、`source_category`、变更字段名、备注是否存在和时间，不保存税号、银行账号、核验备注正文或外部来源原文。供应商与证照即使误走通用日志，快照也必须先按安全字段白名单脱敏；迁移 v36 会逐行清洗历史 `operation_logs` 中 `suppliers` / `supplier_credentials` 的敏感快照，坏 JSON 安全置空而不阻断升级。

### 分供方证照中央事实（#446）

浏览器证照以中央 `(dataOrigin, supplierId)` 为唯一所有者，主档、列表与证照页共用当前资料状态和原件投影。证照专用领域保存稳定证照身份、文件关系与正文、类别要求、有效期、整体人工凭证、原始及已确认 OCR 事实和专用审计；普通主档附件集合仍为空。#447 在 #446 保全历史的基础上接通日常 OCR 识别与人工回填，上传和迁移均不自动重新识别。Tauri 历史 schema 与本地适配不被中央接管改写。

资料状态从当前有效必需原件、类别要求及上海业务日期派生；人工结论只在整体凭证仍有效时保留。中央主档关键字段真实变化和影响必需资料的命令与凭证失效原子协调，字段范围及可见行为只见[分供方蓝本](./pages/base-supplier.md#credentialstatus-流转)。无关可选资料、无变化的要求值或普通非关键字段不误撤销结论；普通表单与导入不能伪造人工态。

受控迁移读取 `suppliers`、`supplier_credentials`、`supplier_credential_requirements`、所属 `file_refs` 及 `file_payloads`、`supplier_credential_audits` 和 `supplier_audits` 的完整关联图，保留软删除、旧 ID 映射、原始与人工确认 OCR、整体核验凭证及审计原义。文件引用必须属于对应证照；缺关系或歧义阻断，不按名称合并。只有路径而无正文时保留线索，不能据路径读取文件或计入齐全度。历史没有整体人工凭证的合格/退回按当前资料重算，内部码与税号保持原义，敏感原文不进入动作审计。

#447 的识别快照关联当前原件 ID、正文摘要、识别时间、原始服务结果与已解析候选；候选有稳定身份，同一目标字段的矛盾值不得合并成一个隐式结果。新识别的信用代码/纳税人识别号指向 `taxNo`，不写内部码 `uniqueCode`。人工确认单独保存所依据的识别身份、逐字段决定、实际确认值、类别、有效期及确认时间，也保存类别和长期有效各自的采用方式；再次识别仅更新待核对事实，保留上次人工确认。可解释的历史候选沿原字段含义受控投影为续核对来源，读取不改写旧事实；不可识别格式保留历史并提示重新识别。

人工税务核验沿主档既有五字段保存结果及来源，服务端生成时间，专用审计只含元信息。普通主档保存、导入和 OCR 回填不能采用来稿中的核验凭证：当前税号与纳税人类型均未变时保留已有凭证，实际变化时清除不再适用的凭证。专用核验和 OCR 确认复用主档与证照的同步事务，主档重复校验失败时不发布部分确认。

迁移候选在统一协调器中准备、核对后原子发布；二次确认不覆盖已接管后的日常更正。回滚仅撤回未发生日常更正的本批证照图，独立中央记录保留；若本批证照已有日常更正，或独立记录仍依赖待撤回的主档或图，先整体拒绝，任何参与领域都不提前撤回。操作入口与失败恢复见[迁移指南](../guides/local-data-migration.md#分供方证照迁移范围)，当前实例的部署边界仍按 ADR 0020。

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
- `receipt_registrations`：在 `owner_documents` 之前作为一等迁移实体，按稳定项目、主客户及可选施工合同外键归属。#436 携带该表全部已存字段、审计时间及 `file_refs` / `file_payloads` 的元数据与正文；缺字段、缺正文不猜测补齐。确认后接管到普通收款同一命令事实源，客户、合同、项目和最终结算查询聚合；同批再次同步保留中央更正，回滚仅撤销该批记录及附件，独立新建记录不串批次。字段和关联仍以下方表定义为准，当前测试实例不代表生产持久化完成。
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
  approved_amount REAL DEFAULT NULL CHECK (approved_amount IS NULL OR approved_amount >= 0),
  approved_amount_origin TEXT NOT NULL DEFAULT 'legacy' CHECK (approved_amount_origin IN ('legacy', 'user-entry')),
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

本节 SQLite 表仍是现有来源结构。[材料到货与送货归档基数决定](https://github.com/zodea/crm-new/issues/284)、[甲供材供货身份与计划决定](https://github.com/zodea/crm-new/issues/285)及[已确认材料结算冲销决定](https://github.com/zodea/crm-new/issues/291)已经采纳；不能因为下文尚保留旧表而重新讨论单一明细、Party/计划行或整张冲销。目标结构、旧表退役和迁移的实际完成度按[物资模块复核](https://github.com/zodea/crm-new/issues/411)与[合同及材料结算复核](https://github.com/zodea/crm-new/issues/409)逐项核验，不由本段宣告完成。缺价格可保留归档到货事实，价格分析排除缺价格行；归档标记本身不证明有效到货、库存与结算门禁全部满足。

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
  archived  INTEGER DEFAULT 0,       -- 已人工核对、归属齐全并触发归档后置 1；有效到货与价格分析另按本节现行门禁判断
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
| WageStatement | `wage_statements` | `id` | 负责人请款簿（请款主体×月×格式族×档位）；现有来源 schema 的 `format_family=A/B/C1/C2` 保留历史 B 编码，现行业务只允许 A/C1/C2，B 类合同/BOQ 清单直报工资已退役，其遗留入口与数据须隔离而非等待清单补齐后启用；`period_kind=monthly/settlement/retention`，`purpose=advance/final`，`quantity_source=provisional/field`，`status=draft/checked/released`；C2 通过 `subject_config_id` 关联主体配置；保存累计应付、此前已发、来源版本/时间与操作者；`released` 冻结 `snapshot_json` 和实际发放金额 |
| WageStatementMember | `wage_statement_members` | `id` | 请款簿成员归属；同一请款簿包含一名负责人和零至多名成员，负责人同时记入成员表 |
| WageStatementAllocation | `wage_statement_allocations` | `id` | 已发工资单的组内实际收款分配；按整数分保存，成员集合必须与请款簿成员完全一致，零金额保留且分配合计必须严格等于实际发放金额 |
| WageStatementLine | `wage_statement_lines` | `id` | 月度分项快照：工人、分项、单位、工程量、工资单价、金额；核对时按现场量/考勤替换，发放后只读 |
| AttendanceRecord | `attendance_records` | `id` | 项目×工人×日期唯一；正常工时、加班工时、施工内容，同日合法重存保留物理 ID 和原班组；日期必须真实存在，正常+加班总工时不得超过 24 小时，同项目同人同月的 C2 签工与考勤互斥 |
| SignedDayworkRecord | `signed_daywork_records` | `id` | C2 逐日签工事实；项目、班组、人员、日期、施工内容、起止时间、整工/半工、证明人与确认日期；只有 `confirmed` 记录计薪；同人同日时段不重叠且合计不超过 1 工 |
| WageStatementDayworkRecord | `wage_statement_daywork_records` | `id` | C2 工资单与本次核对签工记录的显式关联；每条有效签工只能归属一张有效工资单，发放时完整记录与主体费率/规则另入 `snapshot_json` |

> ~~PayrollRecord `payroll_records`~~ **已细化拆分**为上述工资与考勤表（禁用旧名）。工资单不是纯计算视图：草稿可活算，核对强制刷新现场复核量，发放时冻结量、价、比例、明细及实际发放金额。合同量禁止进入应付取数。

### 工资完整资料中央接管（#412）

工资接管按真实项目组织，包含上表八类工资/来源实体和可证明归属的操作历史。项目即使没有工资头，其主体配置、考勤和待确认/已确认签工也属于完整图；禁止仅从工资头向下取关联。四类来源根的 `project_id` 必须映射到真实项目，不能使用预算的空项目草稿规则。缺项目身份阻断接管；其他缺关系保留明确隔离原因，不凭名称或相同金额猜接。

同一工作区 SQL 保留映射后的关系和 `payroll_migration_evidence` 中不可变的原图、原始快照、映射及诊断；`payroll_revision` 提供中央读取版本。`snapshot_json` 全文与未知扩展字段保留，不能经过旧输出 DTO 重建。已发呈现只使用原冻结资料；原表和原快照金额分别可追溯，缺实际金额、缺分配、坏快照和真实零不合并为同一种情况。冻结行缺显示名时，只能在同一快照中按明确成员 ID 解释，不能回填当前工人档案。

旧 A 汇总没有保存完整施工责任/完成 ID，旧 C1 也没有逐考勤行外键；保存原值不证明它们具有新的计薪资格，`source_version` 不能反解成关系。B 类历史保原格式、状态和金额，持续隔离，不进入新工资或成本。未知附件归属不生成工资文件；班组/工人原件仍由其原身份领域管理。

不存在可由金额反推的独立月锁表。C1/C2 已发月份锁使用原工资状态、负责人及全部相关成员，包括零分配、无工资行和无工时成员；C2 另有明确签工关联占用。软删历史及快照不一致不能让锁无声消失，原关系应保留供恢复复验。

迁移准备与实际确认复用同一候选和稳定映射，与工程量、WBS、预算共用工作区事务；持锁时不再调用普通入队读取。重复确认保留后来更正。任何后来独立工资、配置、考勤、签工、关联或可识别历史占用，必须在删除前使危险恢复整批失败，其他领域也不部分回退。本阶段只读不赋予旧单新的发放、更正或输出资格。

### A 工资中央来源、配置与发放（#412）

A 日常核算仍写既有工资头、明细、全体成员和整数分分配；新增下列工资域事实，不把施工完成、合同价或班组表复制成第二套工资来源。P1 本地限定验收见[A 工资证据](../design/evidence/issue-412-payroll-a/README.md)，该范围不能外推到 C1/C2 或生产保存。

| 表 | 身份与主要字段 | 约束 |
| --- | --- | --- |
| `payroll_a_subject_configs` | `id`，`project_id / crew_id / leader_worker_id`，可空 `initial_pay_ratio`，`revision / updated_at / deleted_at` | 项目与负责人唯一；班组是显式归属。未配置为 null，明确 0 为真实配置 |
| `payroll_a_price_revisions` | `id / price_id`，项目、班组、负责人、分项、单位，`mode / worker_id / effective_month / unit_price / scope_json`，修订号、操作者和时间 | `price_id + revision` 唯一；基准与个人例外分开。范围为明确全项目或稳定户×房间×分项集合；空集合不作通配 |
| `payroll_a_statement_sources` | `statement_id`，项目、负责人，`source_json` | 每单一份已采用来源；封闭结构包含完整主体成员、原完成责任事实和价格修订。与头、行、成员及核对结果同事务保存 |
| `payroll_command_receipts` | `command_id`，操作者、项目、工资单或配置作用域，动作、正文指纹、原结果及 `command_json` 原命令规范化正文 | 同键同文重放原结果，同键异文拒绝；回执不能与工资事实部分提交。旧表新增正文列保留 null，不反推补造；无配置作用域时保存 SQL NULL |

工程量按原物理完成记录、原责任及其细分范围、报量阶段与模板现场量读取。同一工作区事务内加载，不再次进入队列。来源缺链、缺单位、缺现场量分别保留诊断；真实零保行，不跨单位相加。责任换人、工人转组、相同名称或重建完成记录不能把旧施工量转成另一请款主体的新可领额度。原责任领取身份由项目、户、原 assignment、房间及分项组成，不以可重建的完成 ID 或工资月作为新身份。

工资价格独立于合同价和 E 类维修单价库。每个稳定价格先选目标月份适用的最新修订，再判范围；缩小范围后不能使旧修订复活。不同价格身份在同主体、分项、单位、模式及生效条件重叠时须明确拒绝，不按数组顺序猜价。原班组比例只有真实录入或迁入来源可证明时才作为默认依据；界面初始化产生的 0.95 不能伪装已配置事实。月份比例沿用规则只见[工资页面](./pages/subcontract-payroll.md#工资核算)。

本期发放按同主体 A 的真实此前已付核算，不叠加成员分配，不混入 B/C 类或另一负责人。已知实际少发使用实际值，历史实际未知令此前已付及本次应发保持未知；软删不能让已经发生的工资支付消失。发放事务重新校验量、价、身份、来源及此前已付，变化时保存需重核状态。成功冻结原事实 ID、显示名称、量与单位、价格修订、比例、累计/此前已付/本次应发与实发、全成员含零分配、操作者及时间；已发不提供普通编辑、删除或撤销。

新中央 A 的来源资格由已采用来源、完整冻结内容和相同工资/项目的正式发放回执共同证明；来源主体、原事实、成员、实际使用价格、回执正文指纹及操作者必须一致。实际重算原命令正文的 SHA-256，并比对其中实发及全成员分配；仅指纹格式正确不能证明正文一致。冻结价格须按原完整主体、月份、数量、单位和范围复算出同一工资行；相同价格 ID 不代替内容核对。旧回执缺原文时保持未证，同键恢复原结果不能自动补造来源资格。历史区与冻结输出共用这项核验，不能仅凭 `format_family='A'` 或某个同名快照字段升级资格。签工正文是 C2 的适用完整性要求，A 不因缺少不适用的签工字段被误判；真实历史缺损继续按原格式保留。

### C1 逐日考勤、个人费率与冻结来源（#412，P2）

本节为 P2 已接通的中央合同；实际开放及限定验收见[工资页面](./pages/subcontract-payroll.md)。考勤复用 `attendance_records`，工资复用现有头、明细、成员和整数分分配；新增两类工资域事实：

| 表 | 关键数据 | 约束 |
| --- | --- | --- |
| `payroll_c1_rate_revisions` | `id / project_id / worker_id / effective_month`，可空 `daily_wage / overtime_rate`，`revision / operator_id / created_at` | 项目、工人、生效月份的不可变修订；日薪为档案缺值时的明确兜底，加班价独立保存，null 和明确 0 分开 |
| `payroll_c1_statement_sources` | `statement_id / project_id / leader_worker_id / source_json` | 每单采用的完整主体与成员、月份、逐日考勤和个人费率；与草稿或核对事实同事务写入 |

人员 owner 提供真实日薪及其缺字段、NULL、明确值状态，连同当前项目、班组和内容版本用于资格与核算。受控迁入保留这些差别，重复迁入不覆盖后来改价；工资配置不反写工人档案。合法档案日薪优先；只有未配置独立加班价才用该人有效日薪÷8，不提前把 60.125 舍入为两位。最终工资金额按现有到分规则保存，原工时和费率保完整精度。

逐日来源保存物理 ID、项目、工人、原班组、真实日期、正常/加班工时、施工内容、备注及原时间与删除信息；来源版本覆盖逐行内容，不能以合计或最大更新时间代替。当前资格与历史阅读分别判断，改名、转组或离场不抹除原记录。同项目、工人、日期已有原组记录时，新组请求不能改挂该行或另建第二条；原记录与不可写原因仍可见。

一条真实全零考勤也属于来源；完全没有记录不能建 C1。全体成员各自保存正常和加班两行，含无工时和零分配成员。C1 固定当月、100%，不采用 A 累计、档位、取整或前月实付扣减。核算与状态动作见[工资页面](./pages/subcontract-payroll.md#工资核算)。

互斥按同项目、人员和月份验证，不以当前班组筛选隐藏冲突。对侧有效工资主体的全部成员、C2 独立待确认/已确认签工及可证明的隔离证据均纳入；已发 C1/C2 软删头、成员或关联不解除整月锁。A 与 C1 可以同人同月并存。旧迁入图已存在冲突时保留双方与诊断，不能自动删除一方；日常写入及会破坏后来合法事实的恢复仍需事务内拒绝。

新 C1 发放冻结当时的完整逐日考勤、每人费率及来源、人员名称、明细和全成员实分配。采用来源、冻结事实及正式原发放回执共同证明新输出资格；历史详情与工资/考勤配对输出使用同一完整性核验，旧 C1 缺逐行事实仍保留部分证据状态，不由当前矩阵补齐。

考勤、C1 与 A 共用命令回执表，正文及结果按明确动作封闭解析。恢复引用必须包含回执里实际保存的考勤记录 ID、费率物理修订 ID 和已采用来源；坏正文或未知动作不能跳过，旧 SQL NULL 不补造。候选、复验、来源锁及回执与工作区其它领域共用一次事务，持锁后不再次进入同一队列。

完整恢复保护扩展至上述四表及独立发放，包含软删配置、只在回执中引用的主体、来源中的原施工身份和零成员。仅解析已定义的关系字段，不递归猜测旧快照的未知扩展；任何危险引用在删除前拒绝整批恢复。更正、实际补退与跨域工资实际由下文 P4 接续，费用由 P5 接续，均不能通过重写原发放实现。

### C2 签工、主体配置与冻结来源（#412，P3）

本节为已接通的 P3 中央合同；本期实际开放与限定验收见[工资页面](./pages/subcontract-payroll.md)。C2 复用 `payroll_subject_configs`、`signed_daywork_records`、工资头/明细/全成员/分配及 `wage_statement_daywork_records`；不建立第二套主体价、签工或工资业务表。

新增 `payroll_c2_statement_sources` 保存每单采用的来源：`statement_id` 为指向工资头的主键，`project_id / leader_worker_id` 分别关联项目和工人，`source_json` 为完整主体与成员、月份、实际采用的逐条签工、主体配置及资格版本。来源与草稿/核对同事务保存；新发放在原 `snapshot_json` 中保存专属 `c2Source / c2Document` 和同源通用字段，不从裁剪后的通用详情反推完整来源。

主体配置固定项目×负责人，保存实际班组、有限正数大工单价及规则原文；不增加按月生效政策。历史缺价、明确 0、停用、软删、空规则和 NULL 分别保留，非法原文不会变成合法可用配置。重核采用当前有效配置，冻结输出保发放时采用的配置，不解析规则脚注触发自动处罚。

签工保存原稳定 ID、项目/人员/班组、日期与时段、整工/半工、施工内容、证明人、确认日期、状态、备注及原时间/删除信息。正规字段服务合法性判断，完整可表达的数据库原行另保原文；未知状态或坏字段只读诊断，不自动转成待确认。逐行来源版本包含正文和关系，不能以合计工数或最大更新时间代替。

逐条领用与人员月锁分别判断：有效工资的原签工关联不可被另一工资抢走；已发头/关联即使软删，以及可证明的原冻结或专属来源独存，仍保护原领用。待确认签工不计薪但参与日内冲突和 C1/C2 月互斥；未发原签工可以合法修正，受影响旧核对必须失效。已发负责人及全部成员整月锁定，包括无签工、无工资行或零分配成员；A 与 C2 可以同人同月并存。

日常保存、核对、发放与迁入恢复共享同一工作区事务。恢复引用显式解析原配置、原记录、原/新作用域、实际回执中的记录和关联 ID、来源/冻结及对应审计；不遍历未知 `original` 或备注猜 ID。混合 A/C1/考勤/C2/签工回执按动作闭集分派，坏非空正文不能静默跳过，历史 SQL NULL 继续保真。危险恢复在删除前整批拒绝，不因不相关项目存在工资而笼统阻断。

新输出需同时核实采用来源、专属冻结及原发放回执，保完整签工和配置、明细、实发及全员到分分配；旧缺损 C2 不从当前名册或单价补全。真实工资与零星用工记录表配对，不生成考勤表，不代替 P4 更正和 P5–P7 完整费用工作簿。

### 工资更正、实际补退与后月处理（#412，P4）

原已发 `wage_statements`、全员分配和 `snapshot_json` 始终不可变。更正与实际收付使用同一工资工作区事务、版本、审计及命令回执，新增以下五张工资域表；具体列约束由 `app/lib/payroll/central-adjustment-schema.ts` 落地。

| 表 | 身份与归属 | 保存内容 |
| --- | --- | --- |
| `payroll_adjustments` | 原工资、项目、格式族；根更正及可选前次更正 ID | 草稿/已确认、新旧核算依据、原因、证据说明、有符号整数分差额、不可变确认快照、经办人与时间 |
| `payroll_actual_events` | 项目、稳定事件 ID；错记冲销指向原工资发放或原事件 | 补发/退款/错记冲销、发生日、有符号整数分实额、证据、确认快照与经办人；同一原事实只允许一个直接冲销 |
| `payroll_actual_allocations` | 实际事件×稳定工人唯一 | 有符号整数分收付额及当时人员关系依据；全员分配合计等于本次实额，真实零保留 |
| `payroll_adjustment_applications` | 更正及其根，关联独立实际事件或后续已发工资，两者互斥 | 本次处理的整数分差额、当时余额版本、处理种类与证据；错记冲销另引用被冲销的处理关系 |
| `payroll_a_adjustment_coverage` | A 工资×更正×稳定计薪组件唯一 | 原施工责任/范围、量、价、比例与真实修订沿革，记录本次累计已经包含的差额及确认命令 |

更正的确认差额、成功处理差额和剩余差额分别派生。草稿、预览及未发工资上的处理选择没有结清效力。补发/退款精确到分、方向一致且不得超过同根剩余余额；核对、余额、人员分配、引用、审计、版本和同键回执一次提交。后续发放失败或来源需重核时不写入处理关系。

工资实际 facts 的初始身份为 `real:payroll:released:<statementId>`，独立事件身份为 `real:payroll:actual:<eventId>`；原发放不复制成事件行。核算更正与后月处理关系不进入现金集合。原 1000 核减 100 后实际仍 1000；退 40 后实际 960、待处理 -60；后月核算 1000、实际发 940 并处理 -60 后，实际合计 1900、待处理 0，原两张签名仍为 1000 和 940。

A 的有效累计依据与实际净额分开：后台逐责任、数量、单价、比例及修订历史证明更正是否已包含，不按月份、总额或整图 hash 猜测。已包含差额不再扣一次；实际退款不直接减少原 `previouslyPaid` 而重新形成同额可领。核增在后续正常发放中得到处理时也关联该唯一发放，不能再生成待补余额。缺组件或沿革证据时保持不可继续核算的具体原因。

错记冲销只用于有明确核对依据证明原记账未实际发生，保留原记录与操作者。错误退款被冲销后，对应处理关系反向恢复原余额；它不是工人再次付款。继续纠错仍追加有原引用的记录，不删除或编辑已确认事实。

工资动态成本与工资已付读取同一有效实际事实集合，两个指标不可相加；工人只取已证个人分配，班组与项目不再把个人行叠加到整单。整单金额可证但缺个人分配时，整单与个人分别声明完整度。转组、停用或工资软删不抹去真实已发生，历史 B 或缺来源资格持续隔离。合同劳务仍取合格合同结算，不按姓名或项目猜 worker 与 supplier 映射。

预算在已有事务中调用纯工资 facts loader；人员与项目在各自受控读面加载同一事实，`facts()/identities()` 的同步上游接口不二次入队。目的页面和工资来源权限均须满足，最后异步等待后再次核对身份与权限。工资完整不提升材料、报销等未接来源，项目总预算剩余仍须全部来源完整。

受控迁入、重复确认和恢复必须保留这五表、原快照、审计、回执及可证明引用。恢复前检查完整图、日常新增与软删历史，任何会移除实际事实或其依据的操作整批拒绝；无关项目不因存在合法 P4 记录而一律阻断。实施及验收范围见[工资页面](./pages/subcontract-payroll.md)，P4 不替代 P5–P7 或生产保存验收。

### A 工资费用、独立管理簿与负价清单（#412，P5）

P5 沿原 A 工资、P4 实际事实、命令回执和工作区事务扩展，不新增工资格式族。物理白名单及约束由 `app/lib/payroll/central-a-fees-schema.ts` 实现。

| 表 | 稳定身份与关系 | 保存内容与约束 |
| --- | --- | --- |
| `payroll_a_management_books` | 项目×独立管理簿 ID，真实管理人 ID | 创建人、创建时间与软删；管理人不替代原施工执行人 |
| `payroll_a_management_book_revisions` | 管理簿×递增修订唯一 | 生效月、班组管理/公司代管、原责任及细格范围、明确首月比例、确认依据与来源版本；追加修订，不改旧正文 |
| `payroll_a_fee_revisions` | 稳定费项 ID×递增修订唯一，固定项目、负责人、班组和用途簿 | 类别、名称、启用状态、非负单价、单位、明确基数、生效月、明确采用的默认依据及移除标记；禁用、移除和真实零分别保留 |
| `payroll_a_statement_books` | 原工资 ID 唯一，归属项目/负责人/用途/月份/档位 | 普通簿按项目×负责人×期间唯一，管理簿按管理簿×期间唯一；同人同月两种用途可并存，已发或软删占用不重新释放 |
| `payroll_a_negative_lines` | 稳定负价行 ID×递增修订唯一，固定原工资与管理簿 | 名称、非负数量、单位、严格负单价、有符号整数分金额、原管理修订与责任范围、事由、经办依据、可选已证实际引用及移除标记 |
| `payroll_a_management_ownership` | 项目×原施工责任用途身份唯一 | 首次发放工资、管理簿及完整原责任证明；不因管理人、费项、月份、完成记录重建、退款或软删生成第二次领取资格 |

管理范围保留原 `assignmentId / workerId / crewId / scopeIds` 与明确细格；细格使用原户、房间、分项及单位身份，不能将下标或显示名作为关系。尚未完成的原责任可用于管理关系及负价说明，但不进入正向已完成费用量。公司代管不生成管理费工资。普通簿只能含房补/其他补贴，管理簿只能含管理费和有依据的负价；负价实际引用只作同项目已证事实参考，不形成另一笔收付。

同一费项按楼栋、分项、单位、修订及价格分组后到分；不同费用不合并，组成行的分金额仅供追溯，不把逐格舍入结果再相加。清单合计先含正负费用，再乘本簿比例、扣本簿此前已证实际。管理费 1500、负价 -600、比例 80%、此前已领 200 得 520；同人普通工资 1000 不参与相减。同簿历史实付或来源不可证明时保留未知并阻止核算，不能当成 0。

新 A 单在 `payroll_a_statement_sources.source_json` 保存来源 V2，冻结用途、费用各修订、原量组成、管理关系、负价与此前本簿实付。旧 V1 原字符串、指纹和快照不补 `book/fees`；只对可证明原关系作受控读取投影。已发 V2 原头、全部适用负价、冻结来源与原发放回执必须一致；冻结后不能通过在旧头下追加或替换行改变后月累计。

P4 新 V2 更正追加同簿费用依据，保留原费项、组件及负价行身份。逐量、价、比例与真实修订证明后月是否已包含更正；核算更正、真实补退和后月处理仍分别记账。普通簿与管理簿不合并补退，退款不重开原领取。旧 P4 无费用字段正文保持原字节和解析语义。

迁移外层图 V3 承接 `fees: { schemaVersion: 1, tables }` 六表扩展；旧外层 V1/V2 及原中央十二表合同保持兼容，无费用表的旧图不伪造空扩展。所有原 JSON 文本及摘要逐字保留，SQL 身份列单独映射；映射后的类型投影须与原物理证据一致，无法证明即不可用。重复确认保留日常更正；恢复同时检查费用、管理关系、负价、领取归属、P4 引用、审计与回执，含零、软删、跨批次与独立新增，在删除前整批拒绝危险恢复。班组旧默认按物理列存在性区分未记录、空值与零，不能从旧表单默认回填。

命令与读取见 [COMMANDS](./COMMANDS.md#a-工资费用与独立管理簿命令412p5)、[READ-MODELS](./READ-MODELS.md#a-工资费用与独立管理簿读取412p5)；操作及实际验收进度见[费用指南](../guides/payroll-fees.md)。P6 扣款、P7 整册和 #416 生产保存继续单独验收。

### 户级空鼓、整改与工资采用（#412，P6）

P6 在既有工程量和工资中央事务中增加以下追加事实。五张来源表与三张工资表均不保存可编辑余额，也不使用 `deleted_at` 隐藏已处理的来源。当前实施与验收进度独立见 [P6 实施票](../research/issue-review-2026-09-11/payroll-tickets/06-central-hollow-and-deductions.md)，不代表 #416 生产部署完成。

| 表 | 事实与字段 |
| --- | --- |
| `quantity_hollow_records` | 原检查稳定头：`id, project_id, unit_id, assignment_id, room_id, item_id, ownership_key`；检查时 `original_party_json, location_json, responsibility_proof_json, responsibility_fingerprint`；`created_at, created_by, command_receipt_id`。原责任和房间分项范围必须在创建时可证，不能借当前姓名重建。 |
| `quantity_hollow_revisions` | 检查修订：`id, record_id, previous_revision_id, inspected_on, count, note, reason, created_at, created_by, command_receipt_id`。首条与后继各自唯一；数量为非负安全整数，修订有原因。 |
| `quantity_hollow_rectifications` | 独立整改事件：`id, record_id, revision_id, rectified_on, count, note, created_at, created_by, command_receipt_id`。处数为正安全整数，不能超过当前未整改余量。 |
| `quantity_hollow_logs` | 连续历史：`id, project_id, record_id, previous_log_id, kind, revision_id, rectification_id, payload_json, payload_fingerprint, created_at, actor_id, command_receipt_id`；首条与后继各自唯一，与具体动作及原回执互证。 |
| `quantity_hollow_command_receipts` | 来源回执：`id, workspace_id, actor_id, command_id, project_id, unit_id, record_id, kind, request_json, request_fingerprint, result_json, result_fingerprint, created_at`；`workspace_id + actor_id + command_id` 唯一。 |
| `payroll_hollow_policy_revisions` | 逐分项配置：`id, policy_id, project_id, crew_id, leader_worker_id, format_family, book_purpose, management_book_id, item_id, previous_revision_id, effective_month, enabled, unit_amount, command_id, revision_json, created_by, created_at`。同系列首条与后继唯一；A 区分普通/管理簿，C1/C2 无用途簿。开启、关闭、未填金额及明确 0 保留原含义。 |
| `payroll_hollow_starts` | 具体工资上的人工开始：`id, project_id, statement_id, previous_start_id, command_id, start_json, created_by, created_at`。原单唯一首条，后继唯一；正文冻结当前原检查证明、余量、配置及合计。 |
| `payroll_hollow_adoptions` | 实际发放采用：`id, project_id, statement_id, start_id, record_id, command_id, adoption_json, created_by, created_at`。`record_id` 唯一，绑定完整原检查采用行；当前不提供按金额猜测部分采用的入口。 |

工资配置、开始、采用复用 `payroll_command_receipts` 与 `operation_logs`，与工资写入处于同一事务。`revision_json / start_json / adoption_json` 逐字段对应各自物理列和完整命令产生集合；缺同次命令的其他行、缺开始对工资的需重核日志、缺发放冻结日志或无回执的额外采用，均不能判为完整原件。

当前未整改为最新可证检查数减累计整改事件，零与未知不同。工资来源按原责任及该工资成员匹配；A 管理簿还需明确原责任覆盖。后期转组、改名、换责任、整改不改原采用。A 累计式工资按同簿已处理扣款避免后月重新领取；C1/C2 逐期来源不将该累计金额再次相减。当前工资的此前处理依据只包含不晚于本单月份的采用，补录早月不能引用未来月份扣款；原记录是否已采用仍核全历史，以免早月补录后重复处理。

发放前来源快照与发放后输出快照共同包含范围、月份、原检查、配置、人工开始、此前处理及金额完整度；输出在此基础上增加本次实际采用集合。A 源版本 V3 承接 P5 V2 费用，C1/C2 源版本 V2 承接各自 V1；原 V1/V2 文字保留，不补造新字段。完整扣款正好抵完可领额时，显式实发 0 可以冻结采用；不产生正数现金。超额及部分实际处理保持规则缺口。

P4 更正依据增加可选 `hollow`：原冻结采用集合与对应 `adoptionId / recordId / count / unitAmount` 组件。只允许改量价与经办依据，不能替换原户、采用身份或工资簿。有效更正链产生当前已处理金额；冻结工资保留当时采用的链端及处理额。核算差额、真正补退和后月处理关系仍沿 P4 分离，原件不会因整改或确认更正自动改变实际现金。

迁入保留所有原 JSON 和摘要，物理身份列与原证明的类型投影分开。工程量外层 V2 承接五表；工资外层 V4 承接三表及其原工程量证明闭包，旧中央十二表和费用六表合同不变。多次迁入的原图证明为最多 64 个节点的平面、可达且无环关系，不得嵌套证明包或携带整个运行库；重复接管保留日常追加。恢复在删除前检查原责任、整改、启动、采用、更正、回执和跨批次引用，软删与零余量不能解除引用，失败整批不变。最终迁移验证状态以本票证据为准。

操作步骤见[空鼓指南](../guides/payroll-hollow.md)，接口与读取分别见 [COMMANDS](./COMMANDS.md#户级空鼓和人工扣款命令412p6)、[READ-MODELS](./READ-MODELS.md#户级空鼓和工资扣款读取412p6)。

### 批量工资计划与逐单协调（#412，P7）

P7 的批量协调不建立第二套工资或现金账。`payroll_batch_plans` 保存经办人确认的项目、月份、用途、资金输入、逐项依据、人工金额和完整成员分配；计划正文及摘要不可变，`state / next_item_index / expected_payroll_revision / revision` 只表示协调进度。暂缓项不生成工资命令，也不形成零元发放。

`payroll_batch_attempts` 在每项首次发送前保存完整 A/C1/C2 原命令正文、摘要、原命令 ID、准备/执行命令 ID、确认依据及发送前工资修订。同一计划至多一项处于 `prepared`。原工资是否成功只认既有 `payroll_command_receipts`；尝试表中的结果是协调引用，不能独立证明核对或现金。原事务已成功而协调响应丢失时，仍以相同原命令 ID 和正文恢复；已成功项不再换键发送。

`payroll_batch_command_receipts` 保存 `confirm-batch / prepare-batch-item / execute-batch-original` 的同键同文结果，并绑定工作区、经办人、项目和计划。批次确认不推进工资修订；准备只保留资金与命令且不改工资；执行调用原格式服务后，必须读到匹配原命令的正式回执才推进下一项。只有原服务明确返回 `commandOutcome=not-applied` 才可结束本次尝试并回到重新准备；未知结果保持 `prepared`。本批前项带来的唯一预期修订可继续，其他修订、依据变化、错回执或异常版本增量均停止为 `needs-recheck`。

`payroll_a_rounding_revisions` 按项目、负责人、普通/管理工资簿及生效月追加保存 A 的 `off` 或向下整百规则；未配置与明确关闭不同。C1/C2 不读取 A 取整。本表保存初分配置，批次最终自动用尽资金可突破整百，规则见[工资页面](./pages/subcontract-payroll.md)；建议不生成现金。排序使用既有簿身份，不改已固定批次正文，不借本表分配正式编号或保存名册。

### 工程量物理模型（#103）

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

#442 浏览器中央工程量适配中的 `quantity_boq_references` 仅存 `id + project_id + contract_id` 外部身份索引，模板行的 BOQ 外键指向此索引；量价与已签证增减仍读取中央施工合同/变洽签。该索引不是第二份 BOQ 业务表，也不改变显式桌面 SQLite 的物理 schema。迁移使用完整数据库候选准备，在外键、祖先及跨域对账通过后原子切换；月报自动完成量与有效 BOQ 来源在同一串行窗口重验后固化，具体读写契约见 [READ-MODELS](./READ-MODELS.md#工程量中央读取与甲方月报442) 与 [COMMANDS](./COMMANDS.md#工程量中央命令与迁移接管442)。

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
> `schedule_task_floor_plans` 由排程域拥有，并以 `source_basis` 区分来源。合同清单行保存 `item_id + boq_line_id`，唯一范围为 `task_id + floor_id + boq_line_id`；内部暂估行保存 `item_id + provisional_qty`、`boq_line_id=NULL`，唯一范围为 `task_id + floor_id + item_id`。两种来源均从工序窗口自动分摊，个别楼层调期后 `is_manual=1`。v38 只从真实 `boq_lines.item_id` 回填存量合同计划；缺少可验证分项的旧行会阻断迁移，不伪造 BOQ。`item_id` 与 `boq_line_id` 是冻结来源追溯引用，不是该排程行的可见性祖先：分项或 BOQ 行后续软删除不能隐藏排程自己保存的楼层计划；工序、楼层及其语义祖先仍决定当前可见性。稳定来源身份、物理外键与迁移/恢复引用保护仍须保留，当前模板适用范围不因此扩大。内部暂估后补合同时仅改变分组依据，预览与写入统一聚合分组内有效 `provisional_qty` 快照；既有暂估计划行继续保持 `source_basis='provisional'`，不被户型模板后续修改或合同量覆盖。

#### 标准工序库中央版本（#443）

工序库头与其工序作为完整版本进入同一中央事实源。稳定版本 ID 区分同编码的每一版；复制来源记录为版本引用，下一版编号按同编码全部既有版本计算，包含已删除版本，禁止回收编号。任何可见旧版均可作为同编码新版的来源，原版和旧项目创建时的快照保持不变。目录单独返回授权范围内的系列最高编号基准，删除版本的正文不因此可见。

`stageCode` / `itemCodes` 是可复用模板定义，不是某项目的外键；全局工序库本身不持有项目、楼栋或完成事实。项目建组时才按当前项目解析成稳定阶段和分项身份并冻结。版本使用项目及数量由当前中央 WBS 投影，不另存本地关联副本；读取不可用时为 `null`（未知），不得把未获取的关联事实计成零。

受控迁移追加库头与工序图，保留旧稳定 ID、版本、工序 key、前置 key/禁用状态、映射、排序、创建/更新时间及软删除边界。重复版本、断裂前置、自依赖、循环和无可解释身份阻断预检；不得按名称补造或清空关系。源 v27/v34/v35 等已应用迁移保持不变。准备、确认、对账和恢复沿既有核心协调器执行，一次确认原子接管完整图，回滚保留独立中央新版本并核验下游依赖。旧 WBS 图及既有合同绑定身份由 #444 接管，新绑定动作由 #445 接通；本票不迁出第二份项目排程。

#### 中央 WBS 事实与整图接管（#444）

浏览器正式 WBS 复用本节六类排程表，并与中央工程量处于同一候选数据库和串行事务；不把旧浏览器整库作为正式读写的第二源。中央验证实例另保存项目修订、命令回执和楼层冻结数量的完整性说明，分别用于陈旧来源检查、原命令恢复及历史缺口展示。项目、合同/清单和全局工序库保持原领域权威，只消费稳定身份及来源版本，不另建可独立改写的合同量价或库版本。

新建暂估快照保留有效分项及逐户来源、计量单位、已知数量和缺失情况。真实 `0` 与 `null` 分开，单位不同不混算，不能以全组正数掩盖某栋缺少有效范围。当前模板后来变化不改写冻结快照。自动进度读取当前阶段的适用应做户与完成户交集，责任配置和其他阶段不进入分子；具体显示计算以[排程页面](./pages/schedule-progress.md)为准。

受控迁移追加每项目一个 `wbs_projects` 完整图节点，位于工程量和工序库之后。包含六表的物理记录、可识别操作日志、软删除边界、无分组旧任务、计划日期、基线、进度方式、库快照、禁用依赖、楼层人工标记和已有合同绑定关系。项目、合同、楼栋、楼层、户、分项、阶段、库版本及快照内明确身份逐项映射；日志只按已知身份字段改映射，不按名字匹配，也不对原 JSON 全文替换 ID。

旧分组已绑定合同、其楼层计划仍保存暂估来源属于合法历史，两者一起保留；新绑定仍由 #445 实施。旧冻结来源没有记录单位或逐户完整性时，保留实际值与原始快照并登记历史缺口，不从当前模板反推旧值、不用合同量填补。缺失或歧义身份、非法关系、日期或依赖阻断试跑。

完整候选准备、对账、确认和恢复复用现有核心迁移协调器；对账检查关系和事实，不只比较行数。重复确认保留接管后的日常更正，不回放历史通知。恢复只处理本批所属图；独立中央 WBS 仍引用待撤的项目、合同、区域、阶段、分项或库版本时，整批拒绝恢复，各领域保持当前状态，不删除独立 WBS 来强行满足回滚，也不旁路修改工程量完成。实际验证及当前实例边界见 [#444 证据](../design/evidence/issue-444/README.md) 和 ADR 0020。

#### 中央暂估绑定与楼栋证据（#445）

暂估绑定复用原 `schedule_groups`、楼层冻结来源和操作日志，不另建平行 WBS 图。新命令在原组保存合同依据及绑定时间，操作日志同时冻结所选合同、楼栋覆盖、按稳定分项与单位组织的数量比较、来源版本和操作身份。原任务、依赖、楼层计划、基线和完成事实不变；原暂估楼层行继续保留暂估来源。旧记录没有完整比较时显示明确缺口，不能从当前模板或合同反推历史。

完整冻结快照的逐户来源与单位负责数量完整性：同一户及模板行被多个阶段引用时不重复相加；来源缺失保持未知，真实零保留，异单位分别比较。原 `provisional_qty` 只保留旧数值，缺少单位或逐户证据时不能单独用来制造完整差异。

合同楼栋证据更正仍由原施工合同清单中央来源拥有。受控来源保全导入文件、签证新增来源、确认状态及可用的原表追溯；只有可证明属于已确认导入基准的行允许更正。保存只更新原行楼栋并追加不可变审计，原项目、合同、分项、行 ID、量价及签证事实保留。签证新增结果和资格未知的历史行不提供独立改写入口，不另建覆盖表代替原行证据。

迁移与日常命令遵守同一互斥边界。重复确认保留接管后新增的绑定与楼栋更正；移除或替换已有更正的来源须整体拒绝。WBS 恢复在删除日志前，对比受控接管时保存的原分组合同关系与当前关系；迁入后新增绑定即使审计或回执缺失，也不能被旧批次恢复吞掉。原本已绑定的迁入历史与迁入后新增动作分别判断，不能把显示用操作人字符串作为唯一保护依据。读取和写入契约分别见 [READ-MODELS](./READ-MODELS.md#中央暂估绑定与楼栋证据读取445)、[COMMANDS](./COMMANDS.md#中央暂估绑定与合同楼栋证据更正445)，运行范围见 [#445 证据](../design/evidence/issue-445/README.md)。

### 2.8 目标成本类（成本控制基线）

| 实体 | 表名 | PK | 设计文档 |
|---|---|---|---|
| TargetCost | `target_costs` | `id` | `target-cost.md`（项目目标成本，`is_baseline` 版本化） |
| TargetCostItem | `target_cost_items` | `id` | `target-cost.md`（科目行：专业分包/合同劳务/材料/机械/工人工资/费用报销/其他，可细到分项） |

```sql
CREATE TABLE target_costs (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT REFERENCES projects(id), -- 仅 draft 可空，提交时应用层强制必填
  name                TEXT NOT NULL,        -- 版本名（“投标预算”/“开工基线”）
  is_baseline         INTEGER NOT NULL DEFAULT 0 CHECK (is_baseline IN (0, 1)), -- 部分唯一索引保证一项目一条
  contract_revenue    REAL DEFAULT 0 CHECK (contract_revenue >= 0),
  planned_profit      REAL DEFAULT 0 CHECK (planned_profit >= 0),
  signed_contract_sum REAL DEFAULT 0 CHECK (signed_contract_sum >= 0),
  tax_inclusive_total REAL DEFAULT 0 CHECK (tax_inclusive_total >= 0),
  tax_exclusive_total REAL DEFAULT 0 CHECK (tax_exclusive_total >= 0),
  tax_amount          REAL DEFAULT 0 CHECK (tax_amount >= 0),
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | submitted
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
);

CREATE TABLE target_cost_items (
  id           TEXT PRIMARY KEY,
  target_cost_id TEXT NOT NULL REFERENCES target_costs(id),
  cost_category TEXT NOT NULL CHECK (cost_category IN ('专业分包', '合同劳务', '材料', '机械', '工人工资', '费用报销', '其他')),
  item_name     TEXT,               -- 可选：细到分项（墙砖/地砖…），NULL=科目级
  unit TEXT DEFAULT '',
  qty REAL CHECK (qty IS NULL OR qty >= 0),
  unit_price REAL CHECK (unit_price IS NULL OR unit_price >= 0),
  amount REAL NOT NULL CHECK (amount >= 0),
  note TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
);
```

> 迁移 v20 `target-cost-incomplete-drafts` 将已落过 v19 的存量库安全重建为 `project_id` 草稿可空，并原样保留目标成本头、科目明细、软删除状态和索引；非草稿保存仍必须校验真实项目 ID。

> **costCategory 全局归集约定（2026-07-23 修订）**：合同成本按专业分包、合同劳务、材料、机械、其他五类；直接工人工资和费用报销分别作为独立成本来源。**合同劳务与工人工资不得合并为“人工”**。动态成本以已确认支出结算、已发放工资和已确认费用报销归集；付款申请、支付记录和送货单分别代表审批、现金流和收货事实，不与结算重复计入成本。红圈参照：目标成本 + 目标成本清单明细。

#### 目标成本中央版本与完整接管（#412）

预算头、科目明细和文件仍使用上述业务表；中央读写不创建另一套预算金额或成本快照。`target_cost_revision(singleton, revision)` 保存工作区预算版本，`target_cost_command_receipts(command_id, actor_id, target_cost_id, action, fingerprint, result_json)` 记录已提交命令及原回执；工作区隔离沿共享中央实例。预算与当前项目来源共同决定保存依据，版本头、基线旧新变更、附件与审计在同一工作区事务核对。命令和读面见 [COMMANDS](./COMMANDS.md#目标成本中央命令412)及 [READ-MODELS](./READ-MODELS.md#目标成本中央读取412)，实际验收状态见 [#412 预算证据](../design/evidence/issue-412-target-cost/README.md)。

受控迁移节点为 `target_cost_versions`，每个版本携带完整 `budgetGraphJson`：版本头、科目、`file_refs` 中 `owner_type='target_cost'` 的附件、按文件稳定 ID 取得的真实 `file_payloads` 及可识别的 `operation_logs`。项目只按显式迁入映射归属；项目没有工程量不阻止预算接管，无项目草稿原样保留。迁入图金额、空值、真实零、排序、删除时间、旧空分项名和合法空附件元数据均按原表约束核对，不套新建表单必填规则改写历史。完整图所用头与明细非空约束以上述现行 v20 schema 为准。

文件正文缺失保留缺件；存在正文时验证编码及已知长度，不从旧路径补读。日志原实体已不存在，但前后快照明确指向该预算时仍保留并可追溯；不得按同名对象补接。确认前先在候选实例逐列对账再整体发布，重复确认不覆盖日常变化。恢复依据可信迁入基准、命令回执和实际引用阻断预算日常变更、独立版本及当前/历史项目引用的丢失，软删除不解除这种保护。

实际成本为当前真实来源投影，预算头的手录已签金额不替代正式合同。同一支付在不同读面出现时只计一次，独立分摊按稳定支付/分摊身份核对；归属或金额冲突保留未知。合法已知部分、真实零、无权、缺源和不可用不混淆；来源未齐时不生成完整余额或偏差。此扩展仍为 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md) 的可重置中央验证实例，完整工资、材料、财务来源及 #416 生产关口不因预算接管而完成。

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
| `attendance_records` | `project_id` / `worker_id` | `projects.id` / `workers.id` | N:1 | C1 日工/加班来源；项目×工人×日期唯一，原班组证据不随转组改写 |
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

- #441 的浏览器送货头、材料行、打印状态、修订和原件由同一中央领域保存；Repository/HTTP/command 是当前浏览器入口，失败不回落旧 SQLite。当前服务是可重置中央验证实例，尚不声明生产重启持久化或云端上线；部署边界见 ADR 0020。
- 旧 `delivery_records` / `delivery_lines` / `file_refs(category=source)` / `file_payloads` 保留为受控迁移输入及显式 Tauri 适配。它们的旧本地归档行为不再是已接管浏览器的日常正式写源。
- 上传批次与不可变资产分别保留稳定 ID。资产保存文件名、MIME、真实长度、完整字节、SHA-256、建立者和时间；同一明确批次且字节一致才复用资产。逻辑送货保存稳定 ID、当前项目/分供方、资产引用、结构化版本和唯一材料行事实。一份资产可供多条逻辑送货显式引用。
- 新归档和人工修订必须选择当前有效项目、分供方并人工填写日期；缺失分供方、日期的历史记录保持原缺失与待核验，不能匹配同名主档或补当天日期。历史核对标记只有在当前必需事实完整时才有效；缺价格经人工确认可归档并标记价格待补录。
- 结构化修订保存版本、原因、服务端操作者/时间和前后变化；业务字段编辑不改变原件字节。补传/替换建立新资产与修订引用，旧资产保留。列表和结构化审计不含正文，当前及历史正文均按需重验当前权限、逻辑 owner、来源和可证实祖先。
- 缺原件保持明确缺失，不从 OCR 文本或同名本机文件补齐；价格分析不因价格有效而忽略缺原件。资产长度、MIME、摘要或 owner 错配阻断读取/保存，不静默合并。
- 受控迁移保留稳定头/行映射、原件、打印处置及可解析历史；孤儿和批次/字节冲突阻断。可证明逻辑 owner 的软删除原件按字节与摘要保全；未能证明其历史版本/祖先时只作受保护历史事实，不进入公共原件集合。缺正文及无法解析审计明确登记，不伪造版本。
- 旧 `project_aliases` 尚未迁入。当前项目建议仅从已人工确认送货的 `rawSiteText + projectId` 派生，仍需人工选定；完整旧别名迁移继续由 #411 承接，不能计为已迁。打印按当前资产关系分组，同一上传批次后续产生不同资产或缺失引用时分别处置，不能借相邻资产打印。
- 本切片不建立有效到货头、库存或材料结算资格，也不退役旧到货明细；这些后续关系继续由 #411/#409 承接。

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

本节的 localStorage → SQLite 内容是旧本地版本的来源映射，不是当前浏览器中央切换流程或自动启动命令。当前中央迁移的预检、不可变备份、拓扑导入、对账、确认与回滚以 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md) 和 [`COMMANDS.md`](./COMMANDS.md) 为准；未迁移领域仍保持其明确现有边界，不新增静默迁移或正式数据 seed。

### 7.1 旧数据迁移（localStorage → SQLite）

旧本地版本曾使用的 localStorage 数据 key 与目标映射如下，是否存在与是否已迁移须先核对实际来源，不能在当前浏览器启动时自动执行：

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
5. 区域树/工程量/施工进度/目标成本等表**无上述 localStorage 旧数据来源**，不参与这条旧 key 映射；这不等于它们不参与后续 SQLite → 中央迁移。浏览器正式 `production` 不 seed，确定性工程量、排程和工序样本只允许在授权演示来源使用。
6. 旧 `credential_status` 按新必需资料和有效期重新计算：缺失/过期 → `incomplete`；齐全 → `reviewing`。没有人工核验时间/备注凭证的旧自动 `qualified` 不得迁为人工合格，也应进入 `reviewing`；旧 `rejected` 仅在有明确退回凭证时保留，否则同样重算。迁移不得伪造 `credential_reviewed_at` 或核验备注。

---

## § 8 撤回机制（V1 已落地，#52）

> 本节记录 #52 的本地软删除与操作日志基础，不表示每个实体当前都开放删除或任意撤回。可用命令、受保护状态和更正方式分别以 [`COMMANDS.md`](./COMMANDS.md) 及页面领域契约为准；已确认材料结算、已发工资等必须沿用各自冲销/调整规则，不能用通用撤回覆盖历史事实。后台管理回退面板不因此进入本轮范围。

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
4. **撤回时效**：通用日志基础能力不代表页面允许无限期撤回；用户可见的单条/批量删除撤回按 ADR 0003 的 10 秒窗口，级联采用提交前取消，各实体的受保护状态和更正方式仍优先。
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

付款申请批复来源（[#439 / PAY-07](https://github.com/zodea/crm-new/issues/439)）：

- `approved_amount = NULL` 表示未填写，明确录入 `0` 表示批复零元；只有未填写时才回退申请金额作为可付上限。新申请默认保存 `NULL`，不得经过 `|| 0` 或默认值压成零。
- `approved_amount_origin` 由保存域维护：新建及明确编辑批复后为 `user-entry`，迁移前存量为 `legacy`。修改批复必须携带与金额一致的明确输入意图；仅改备注、整单保存或客户端声称来源已确认，不会升级存量来源。金额、来源、分摊和附件沿用同一保存事务，取消或保存失败不留下来源变更。
- v21/v22 曾把空值、缺列和非法负值压成零，无法从零值、状态、备注或时间戳恢复当时批复事实。v49 仅改为可空列并给旧记录添加来源标记，原始金额、银行记录、三类分摊、索引及约束保持；不批量猜测旧零的含义。
- `legacy + 0` 读为“历史批复待核验”，批复金额、依赖它的余额及完整合计为未知；原存储零仍保留。旧非零批复仍按已有金额读取，已确认银行实付独立显示，不为对平批复而修改。
- 历史未知批复的新支付确认政策仍由 [PAY-08 待裁定项](https://github.com/zodea/crm-new/issues/413#issuecomment-5616431545) 决定。PAY-07 保留既有登记与确认操作的申请额兼容上限，并在读侧显示未知；该技术兼容不构成批准申请全额的业务裁定。明确重填后使用新金额语义。

付款申请派生字段（批复来源已明确，或批复为未填写时）：

```text
paid_amount =
  Σ payment_record_application_allocations.allocated_amount
  WHERE payment_record.confirmation_status = 'confirmed'

actual_payment = paid_amount
unpaid_amount = max(COALESCE(approved_amount, apply_amount) - paid_amount, 0)
```

历史待核验批复的 `unpaid_amount` 为 `NULL`，不能使用上式回退申请额并将结果冒充已知余额；登记动作的兼容回填与读侧金额事实分开。当前实现覆盖本地付款表单、详情、付款管理、分供方/项目分供方读投影及其他支出结算关联源单，不代表通用付款中央写命令或生产持久化已经接管。

`payment_applications.paid_amount/actual_payment` 旧列在兼容期只读；迁移完成后移除。分摊金额写入、支付确认、撤回及操作日志必须在同一事务内。

### 10.3 工人工资与费用报销

工人工资按 #117 的负责人请款簿管理。工资单通过“确认发放”动作进入“已发放”状态时，同时确认成本和已支付事实，不生成逐工人支付记录或合同付款申请：

```text
工资动态成本 = Σ 工资有效实际事实的有符号金额（稳定身份去重）

工资资金流出 = 同一集合
```

工资金额必须保存发放时快照；工程量或人员资料后改不追溯历史发放。

费用报销的目标头表与明细表见 §2.10.4。`project_id` 可空，空值明确表示公司开支；总额始终由有效 `expense_reimbursement_lines.amount` 聚合，头表不保存第二份可编辑金额。

F3 迁移将旧 `expense_reimbursements.amount > 0` 的记录转换为一条 `expense_item='迁移汇总'` 的明细并记录来源追溯；旧金额为空或资料不完整时写 `reconciliation_issues`，不得补 0。只有 `status='confirmed'` 的报销进入动态成本。

### 10.4 动态成本与合同付款

```text
动态成本 =
  Σ已确认支出结算.total_amount（按合同 cost_category 五类）
  + Σ工资有效实际事实.有符号金额（原发放、真实补退及有效错记冲销）
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

#423 项目 Excel 切片在同一中央项目事实内保存 `importSource` 回执，命令和表单回读共享它；不向浏览器 SQLite 写正式项目，也不新增平行业务表。当前为可重置内存实例中的映射：`fileName → source_file`、`fileDigest → source_hash`（原文件字节 SHA-256）、`sheetName → source_sheet`、`rowNumber → source_row`（原 Sheet 的 1 起始行号）、`externalRef → source_key`、`rawSnapshot → raw_snapshot`（包含未映射源列的解析值）。项目 ID 为中央分配的稳定 ID；客户关系使用中央正式客户 ID。

原 Excel 文件字节仅在当前浏览器解析，不作为中央附件上传；文件名、摘要、Sheet、行号和源行快照随成功行保留。下载的拒绝清单携来源定位与原因，未成功行不冒充正式项目。当前回执仅对本 Excel 链路已保存行去重，不解释既有受控迁移的 `legacyId → serverId` 映射；处理历史整库身份必须沿既有迁移边界。防重与冲突契约见 [COMMANDS 项目 Excel 导入](./COMMANDS.md#项目-excel-导入423)。下列持久化表的实际部署、唯一约束、重启与备份恢复仍由 #416 验收，本切片没有执行迁移。

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

- 受控迁移新增 `other_settlements` 与 `other_settlement_sources` 节点，位于 `auxiliary_contracts` 后；后者为真实关联付款申请与支付记录的独立中央源单，使用 `application:旧ID / payment:旧ID` 映射。罚扣沿用 `owner_documents.project_penalty`，其其他支出合同旧 ID 同样使用 `other_expense:` 命名空间，抵扣目标支持统一结算的准确类型。试跑重验合同类型、非草稿状态及项目、分供方一致性，错误关系阻断导入。
- 结算头只保存资料、含税金额、税率和状态；金额链实时投影，有效抵扣来自 `penalty_settlement_deductions`，申请来自 `payment_application_settlement_allocations`，支付来自 `payment_record_application_allocations` 及已确认 `payment_records`。源单 ID、支付来源申请 ID 均映射中央身份，事实 ID 按结算与种类命名空间保持稳定。金额及有效状态重新读取中央源单及其分配记录，罚扣复用既有中央源，不以迁移时事实副本继续充当正式来源。源单详情通过独立只读 HTTP 请求获取资料、分配、审计及文件元数据。
- 对明确抵扣其他支出结算的巡检、甲方通知和验收来源罚扣，同样接管到既有中央罚扣实体；`penaltyFacts.origin` 保留原始来源并在源单展示，不改造成手工项目罚扣，也不按名称补接原始来源业务页。
- 本次金额为含税金额减有效抵扣；可申请为本次金额减有效申请；未付为本次金额减已确认且精确归属的支付。草稿、无效、已删除事实不计入。涉及多结算但无结算级支付分摊时已付/未付为 null，不按比例分配。无有效记录的真实空集合为零；未知集合、未知金额或身份失效保持 null。无税额复用整数分及税率基点舍入。
- 同一合同的累计结算仅纳入已确认、同项目同分供方结算。前期金额仅纳入早于本单结算日期的记录；日期缺失或同日先后不明时保持未知。合同详情不再持有独立结算快照，而由同一结算源投影。中央身份被移除时关联不继续显示可用。
- 附件仍归 `file_refs(owner_type='expenditure_settlement')`；中央只保存元数据，不公开本地路径。保存使用服务端 ID、版本与 commandId，重试幂等，旧版本拒绝覆盖；确认后锁定。未知事实或已有下游事实的结算禁止改挂关系，历史空审计在编辑后仍为空。

专属页面与当前源单下钻边界见[页面蓝本](./pages/contract-forms.md#ax05-当前浏览器实现331)，环境边界见 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md#ax05-其他支出结算接管)。材料到货分摊、冲销和虚构结算明细均未引入。
