# 前后端读模型与 DTO 语义基线

本文是浏览器业务页面的读模型与后台 DTO 语义权威源。数据库表、字段和外键仍以 [`DATABASE.md`](./DATABASE.md) 为准，页面字段和业务流程仍以 [`pages/`](./pages/) 为准，蓝色入口及返回路由由 [`NAVIGATION.md`](./NAVIGATION.md) 裁定。本文不复制参考站接口名、私有 URL、认证参数或业务数据。

当前实现已有九类中央主链：项目、客户、分供方、班组、工人、项目分供方、材料采购合同、施工合同与分包合同均经 Repository、HTTP adapter 和对应 `/api/read/*` operation 读取。合同 canonical 导航意图使用 `filters.contractKind`，Target Registry 映射为 `contractKind=material|construction|subcontract`；缺失 marker 的深链不会改道中央详情。演示夹具只有在 `includeDemo=true` 且会话拥有 `demo:read` 时可读，三类合同都按稳定来源、ID 和类型返回专属七组详情。#281 已联合验收客户、分供方、班组、工人、项目与项目分供方的中央身份往返；#317、#318、#320 与 #321 已分别闭合工作台、材采、施工与分包的 HTTP/Repository/受限返回链。旧 production SQLite 不再作为这些浏览器普通读 adapter。当前中央端为可重置测试实例，不是生产持久化库。

## 1. 边界与分级

每个页面族按以下分级标记：

- `A`：已有稳定 ID、SQLite 外键或确定性读模型，可直接成为后台读 DTO 基线。HTTP 未实现时由类型化本地 adapter 返回同一语义。
- `B`：页面需要该字段或下钻，但 canonical 外键、身份或聚合来源尚未建立。DTO 必须保留显式缺口，关系落库前不得按名称、同项目、金额近似或文本用途猜接线。
- `C`：文件、OCR、导入导出或桌面能力。继续走专用本地/Nitro adapter，不塞进通用业务列表接口；凭证、原始文件和私有地址不得进入普通 DTO。

`A` 不等于已经有在线接口，`B` 不等于可以先返回假数据，`C` 也不等于 Mock。三类都必须展示真实加载、空、错误和权限状态。

## 2. 共享语义类型

### 2.1 标量

```ts
type OpaqueIdDTO = string
type BusinessCodeDTO = string
type ISODateDTO = string       // YYYY-MM-DD
type ISODateTimeDTO = string   // ISO-8601，带时区或明确为 UTC
type YearMonthDTO = string     // YYYY-MM

// JSON 传输固定使用十进制定点字符串；禁止科学计数法和货币符号。
type MoneyDTO = string         // 例："1234.50"，固定两位小数
type QuantityDTO = string      // 最多六位小数，保留 0 与 null 的区别
type RatioDTO = string         // 0..1，最多六位小数

type CountDTO = number         // 非负安全整数
type BoolDTO = boolean
type DataOriginDTO = 'real' | 'demo'
```

SQLite 现阶段仍按 `REAL` 保存多数金额，工资分配按整数分保存。SQLite adapter 在 DTO 边界统一 `round2` 并编码为 `MoneyDTO`；写 adapter 在领域事务内转换和勾稽。Vue 页面可以在展示 adapter 后使用 `number` 计算布局和格式化，但不得把格式化字符串、浮点绝对相等或 `Number(value) || 0` 带回领域判断。全库是否迁移为整数分不在本票决定。

编号、税号、银行账号、电话和外部键始终是字符串，保留前导零；计数才使用整数。日期缺失为 `null`，不是空日期或 `1970-01-01`。

枚举传 `DATABASE.md` 或页面蓝本已经定义的 canonical code。现有合同状态等字段若以中文值作为当前 canonical code，可以原值传输，但不得另用显示标签、颜色或按钮文案发明第二套身份；未来改为英文 code 时必须做显式版本迁移和双向 adapter，不能逐页临时翻译。

### 2.2 关系引用

```ts
type EntityKindDTO
  = 'project' | 'customer' | 'supplier' | 'crew' | 'worker'
    | 'contract' | 'settlement' | 'owner-document' | 'subcontract-document'
    | 'invoice-application' | 'invoice' | 'receipt' | 'current-transaction'
    | 'payment-application' | 'payment-record' | 'expense-reimbursement'
    | 'material' | 'material-document' | 'delivery-record' | 'warehouse'
    | 'wage-statement' | 'attendance' | 'schedule-group' | 'schedule-task'
    | 'quantity-unit' | 'target-cost' | 'file'

type EntityRefDTO =
  | {
      state: 'resolved'
      entity: EntityKindDTO
      id: OpaqueIdDTO
      label: string
      no: BusinessCodeDTO | null
    }
  | {
      state: 'missing'
      entity: EntityKindDTO
      id: null
      label: null
      reason: 'not-configured' | 'not-recorded' | 'not-applicable'
    }
  | {
      state: 'forbidden'
      entity: EntityKindDTO
      id: OpaqueIdDTO | null
      label: null
      reason: 'permission-denied'
    }
```

DTO 不下发前端路由字符串。前端根据 `entity + id` 与 [`NAVIGATION.md`](./NAVIGATION.md) 的 `NavigationIntentDTO`，经 `app/lib/nav/target-registry.ts` 这一个 Target Registry 生成目标；甲方/分包/材料等多态单据必须再带 canonical variant，不能按名称或编号猜路由。项目列表行的意图还携带后台判定的 `filters.dataOrigin`，decoder 必须验证 subject、variant 与来源一致后才交给界面。无有效目标或无权限时显示普通文本/明确状态，不伪装蓝色链接。关系对象存在但其子集合为 0 条时返回 `state='resolved'` 和空数组，不能降格成 `missing`；聚合值为 0 时是否可点由明确 drilldown 决定，不由数值猜测。

### 2.3 分页、筛选、排序与汇总

```ts
interface SortDTO {
  field: string
  direction: 'asc' | 'desc'
}

interface PaginationDTO {
  page: number       // 从 1 开始
  pageSize: number
  total: CountDTO    // 同一筛选条件下的总行数
}

interface EmptyDTO {
  reason: 'no-records' | 'no-filter-match' | 'missing-relation'
  missingRelations: EntityKindDTO[]
}

interface PageDTO<T, S = null> {
  items: T[]
  pagination: PaginationDTO
  summary: S
  empty: EmptyDTO | null
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}
```

- 每个 operation 定义自己的强类型筛选键；项目、客户、分供方、合同、班组、工人等筛选只接收稳定 ID。
- `pageSize` 先支持现有控件实际使用的 10、20、50、100；非法页码/排序字段返回参数错误，不静默换成其他字段。
- 排序必须带稳定的 `id` 次序，避免翻页重复或漏行。状态 code、金额和日期按原始类型排序，不按中文标签或格式化文本排序。
- `summary` 使用与 `items` 相同的完整筛选集，但在分页之前聚合；不能只汇总当前页。
- `includeDemo` 默认 `false`，只改变读查询。开启时每行返回服务器判定的 `dataOrigin`，`summary.origins.real/demo` 分别计算数量、金额、完整度和缺失来源；不提供混合业务总额，也不让演示关系补齐正式关系。
- 初始无业务记录用 `no-records`，有数据但筛选无命中用 `no-filter-match`，必需关系未配置导致无法查询用 `missing-relation`。

### 2.4 可空值与聚合完整性

```ts
type CompletenessDTO
  = 'complete' | 'partial' | 'pending' | 'not-applicable' | 'undefined'

interface MetricDTO {
  value: MoneyDTO | QuantityDTO | RatioDTO | CountDTO | null
  unit: 'CNY' | 'quantity' | 'ratio' | 'count'
  status: CompletenessDTO
  missingSources: string[]
  asOf: ISODateTimeDTO
  drilldown: {
    entity: EntityKindDTO
    filters: Record<string, string>
  } | null
}
```

- `null` 表示事实缺失、尚不可算或该字段未知；`0` 只表示已知为零。
- 付款批复读取同时返回可空金额和状态 `not-entered / known / legacy-unknown`，区分未填写、明确金额与历史含义待核验。付款详情、付款管理、分供方及项目分供方、其他结算关联源单使用相同语义；批复合计含未知时保持不完整，已确认银行实付独立聚合。来源标记、余额公式与历史操作兼容边界只见 [DATABASE §10.2](./DATABASE.md#102-支付记录及付款申请分摊)。
- 成功读取且确实没有子记录返回 `[]`；未读取、无权限或父关系缺失不能返回假空数组。
- 字段“不适用于该变体”应在变体 schema 中省略；字段适用但尚无事实必须显式返回 `null`。
- 工程量三量各自保留缺失，现场量缺失必须保持 `null`；阶段/全户及月度合计按明确计量单位分别计算，只有所有参与行都有该量时才是 `complete`，不能用 `?? 0` 消除缺失。返回完整值、已知部分、参与项数、缺项数与缺单位标记；缺单位时完整值和已知部分均未知，部分缺量的已知部分不冒充完整合计。具体分组与全户去重见[工程量蓝本](./pages/subcontract-quantity.md#六详情与施工记录)。
- 税负率、动态效益率等除法指标在分母为 0 或来源未取得时返回 `null + status`，不显示伪造 `0%`。

### 2.5 错误、权限和并发

```ts
interface ProblemDTO {
  code:
    | 'invalid-query' | 'forbidden' | 'not-found'
    | 'relationship-mismatch' | 'validation-failed'
    | 'stale-source' | 'conflict' | 'unavailable' | 'internal-error'
  message: string
  retryable: boolean
  fieldErrors: Record<string, string[]>
  traceId: string | null
}

type ReadState<T> =
  | { kind: 'idle' }
  | { kind: 'loading', previous: T | null }
  | { kind: 'ready', data: T }
  | { kind: 'partial', data: T, missingRelations: EntityKindDTO[] }
  | { kind: 'empty', data: T, empty: EmptyDTO }
  | { kind: 'forbidden', problem: ProblemDTO }
  | { kind: 'not-found', problem: ProblemDTO }
  | { kind: 'mismatch', problem: ProblemDTO }
  | { kind: 'error', problem: ProblemDTO, previous: T | null }
```

- 整个页面族无读取权限返回 `forbidden`，不返回 200 + 空列表。单个关系不可见使用 `EntityRefDTO.state='forbidden'`，并按权限策略隐藏 label。
- 父实体不存在返回 `not-found`；路径中的项目/合同/户等身份不匹配返回 `relationship-mismatch`，不得按同名对象回退。
- 本地加载错误和 HTTP 错误都归一为 `ProblemDTO`；页面保留重试入口和原筛选，不把错误当空态。
- 需要源版本保护的工程量、工资、排程、OCR 校对和导入结果带 `sourceVersion`；陈旧提交返回 `stale-source`，不覆盖新事实。
- HTTP adapter 使用 400 表示查询格式错误、403 表示无权限、404 表示不存在或错配、409 表示冲突/陈旧来源、422 表示字段校验失败、503 表示可重试不可用、500 表示未分类内部错误；SQLite adapter 映射到相同 `ProblemDTO.code`。

## 3. 页面域的 DTO 映射

下表按页面域索引读模型，不维护会漂移的路由数量，也不以路由数作为功能分母。当前对象、动态 kind、状态和公共能力由[复核基线](https://github.com/zodea/crm-new/issues/403)核对，并与 [`runtime-reference-audit.md`](../design/runtime-reference-audit.md) 对应；字段细节只链接页面蓝本。

| 代码 | 运行证据域 | 页面族与核心读形态 | 当前数据来源 | 分级与后台缺口 |
| --- | --- | --- | --- | --- |
| `home` | 首页 | 当前项目引用、排程分组/任务、计划与实际进度、空排程状态 | `projects`、施工进度读模型、首页聚合 | `A`；不增加参考站待办/公告等无本地路由模块，见 [`homepage-dashboard.md`](./pages/homepage-dashboard.md) |
| `project` | 项目 | 项目列表/详情/表单；项目身份、客户关系、阶段、十个资料页签、经营 `MetricDTO` | 列表、只读详情与正式新增/编辑表单已走中央 HTTP；SQLite 迁移 adapter 读取 `projects`、`customers`、`receipt_registrations`、`target_costs` | `A+B`；列表与基础详情读切片已实现，经理/执行经理/设计/仓管等仍为名称文本，建立人员主数据 ID 前只显示不可下钻文本；管理费等未知指标保持 `pending`，见 [`project-info.md`](./pages/project-info.md) |
| `master-data` | 基础主数据 | 客户、班组、工人列表/详情/表单；联系方式脱敏、项目/责任/考勤/工资/扣罚关系 | 客户中央 Repository；班组—工人中央 `CrewWorkerReadRepository` / `CrewWorkerCommandRepository`；Tauri 保留本地 SQLite adapter | `A+B`；客户与班组—工人浏览器链均按来源稳定 ID 读取和写回，missing、forbidden、来源错配分别呈现，测试数据只读。班组成员、当前项目、责任单元、工资单和扣罚可穿透；无个人工资分配不反推。班组合同、公司人员角色等缺稳定关系时不得用姓名拼接，见 [`base-customer.md`](./pages/base-customer.md)、[`base-crew.md`](./pages/base-crew.md)、[`base-worker.md`](./pages/base-worker.md) |
| `supplier` | 分供方 | 分供方主数据、独立证照文件/审核页、资料状态、联系人/开户资料、跨项目合同/结算/收票/付款摘要 | 中央 Supplier Repository；既有证照/要求/审计专用边界；跨域事实聚合 | `A+B+C`；敏感字段按 capability 脱敏，资料状态与业务审批分开；查询、金额完整度和已接/未接来源见[分供方读取契约](#33-分供方列表查询与跨域事实)，字段与交互只见 [`base-supplier.md`](./pages/base-supplier.md) |
| `project-supplier` | 项目分供方 | 项目×分供方详情、六类事实集合、合作文件与汇总；本地文件选择/分类草稿，确认后中央原子导入 | 中央 `ProjectSupplierReadRepository` 与导入命令；浏览器本地 adapter 只负责待导入文件选择、分类和正文读取 | `A+C`；#317 已闭合双 ID 关系校验、正式/演示六类事实 DTO 与 HTTP，#281 闭合正式分供方/合作关系/文件正文的中央原子写入与反向读回；#438 为合作档案 owner 接入惰性正文与摘要校验，按当前祖先/关系/权限读取，其他 owner 正文和终态结算写入仍未接入，见 [`project-supplier.md`](./pages/project-supplier.md) |
| `core-contract` | 核心合同 | 三类合同列表/详情/表单、关联单据、材料明细、BOQ 文件/行/变更/月报量与汇总 | 材采、施工与分包分别经中央领域 Repository；BOQ 按 canonical `contracts` 及下游单据 | `A+B`；#318/#320/#321 分别闭合材采、施工、分包专属列表—七分区详情—正式中央写入—读回；#322 闭合施工/分包补充协议稳定聚焦、父子校验、正式迁移与列表来源恢复；演示须显式授权且只读，未闭合稳定目标返回 `unverified-target` |
| `aux-contract` | 辅助合同与结算 | 公司/其他支出合同、其他支出结算的专属列表/只读详情/表单，以及材料结算列表和表单；项目/分供方/合同引用、金额链与状态 | 两类辅助合同与其他支出结算经各自中央 Repository；`expenditure_settlements`、真实分摊与独立中央源单 | `A+B`；#330 已闭合两类辅助合同中央链，#331 已闭合其他支出结算及奖罚/申请/支付源单往返；未知付款归属仍保持 null。没有业务明细实体的类型不得返回虚构 lineItems；材料结算—有效到货关系已定，#409 核验实际迁移与实现，见 [`contract-forms.md`](./pages/contract-forms.md) |
| `owner-document` | 甲方单据 | 六类单据变体的专属列表、只读详情投影与表单；项目/施工合同/客户、金额、分视图附件与审计事件 | 甲方单据表、月报量、BOQ 变更、`project_acceptances`、`project_acceptance_lifecycle_events`、`owner_final_settlements`、`owner_penalties`、`contract_supplements`、`receipt_registrations` 和 `file_refs` | `A+B`；#323 已闭合甲方变洽签/月度报量，#324 已闭合验收/保修 canonical 双视图，#325 已闭合最终结算，#326 已闭合甲方罚扣专属只读详情、中央表单命令、真实联系单附件与施工合同来源往返。罚扣金额、联系单、事由、申诉说明与状态来自同一 canonical 事实，申诉说明不推导审批流，见 [`owner-documents.md`](./pages/owner-documents.md) |
| `subcontract-document` | 分包单据 | 分包变更、分包结算、项目罚扣专属列表/详情投影/表单；合同/分供方/班组与抵扣关系 | 分包变洽签、分包结算与项目罚扣经中央 owner-document Repository；`penalty_records`、独立抵扣与整改事实 | `A+B`；#327 已闭合分包变洽签专属只读链；#328 已闭合分包结算的中央列表、详情、保存确认、附件与迁移，并恢复全局/项目/合同来源；#329 已闭合项目罚扣中央详情、抵扣/整改与审计。分包结算付款来源未接入或精确归属未知时仍保持 partial，不用表单记录冒充详情，见 [`owner-documents.md`](./pages/owner-documents.md) |
| `material` | 自购材 | 下料、到货、领用、盘点列表/详情投影/表单；材料行、来源单据、库存与结算付款状态 | 乙供材头/行表、合同/项目/分供方外键 | `A+B`；warehouse 仍为文本，到货—归档、结算分摊、领用批次和调拨两端缺稳定 ID，必须返回 missing-relation，见 [`material-management.md`](./pages/material-management.md) |
| `owner-material` | 甲供材 | 总控、下料、到货、领用、直入直出五类专属列表/详情投影/表单 | 五类甲供材实体、项目/客户/班组引用和三量派生 | `A+B`；供货单位不得冒用项目客户，总计划头/行、仓库、送货单和班组合同身份待建；无 seed 时返回真实 0 条，见 [`material-management.md`](./pages/material-management.md) |
| `delivery` | 送货单闭环 | 处理区、归档库、当前/历史详情与整页表单；单头、材料行、归属、核对/归档/打印状态 | #441 中央逻辑记录、不可变原件与修订；旧 SQLite 仅迁移输入或显式 Tauri 适配 | `A+C`；浏览器经专用 Repository 读同一当前上下文与事实，正文按 owner/祖先/来源/当前权限懒读取并验长度和摘要；上传/OCR/打印保留专用 adapter。缺源不回落本地，见 [`material-delivery.md`](./pages/material-delivery.md) |
| `material-price` | 材料价格 | 材料×规格×单位×分供方×项目×时间的价格事实、序列、对比和来源下钻 | 同一中央已归档送货行及当前材采合同的确定性聚合，无独立价格表 | `A`；项目、分供方、送货和完整材采合同分页共同组成同来源读取；任一来源失败不发布部分分析。缺原件、未确认或缺价格的行不参与，来源下钻保留 origin。reviewed/done 由 adapter 归一，不保存第二份价格，见 [`material-management.md`](./pages/material-management.md) |
| `finance-income` | 收入财务 | 开票申请、普通收款专属列表/详情/整页表单、往来列表/详情投影；项目/客户、金额/税额、方向、状态、来源 | `invoice_applications`、`receipt_registrations`、`current_transactions` | 普通收款 `A+B`：#436 接通中央读写、完整迁移与附件正文；开票和往来仍按实际接入范围为 `A`，不得由收款通过推定完成。保证金/备用金无本地路由不扩张，见 [`finance-billing.md`](./pages/finance-billing.md)、[`finance-receipt.md`](./pages/finance-receipt.md) |
| `finance-expense` | 支出财务 | 付款申请、付款管理、支付记录、费用报销列表/详情/表单；结算/发票/申请分摊、支付状态及付款申请只读洞察 | F3 头/行/分摊表和确认支付聚合 | `A+B`；项目/分供方/合同/来源 ID 必须进入读 DTO；付款洞察除当前源单外还含跨项目/跨供应商聚合，不能挂在单个项目 store；部门/经办人员身份和部分参考专属列无 canonical 来源时保持 null，见 [`finance-payment.md`](./pages/finance-payment.md)、[`finance-records.md`](./pages/finance-records.md)、[`finance-reimbursement.md`](./pages/finance-reimbursement.md) |
| `invoice` | 发票台账 | 上传识别工作台、单票校对、归档台账与因子计算；票面字段、归属、状态、明细、置信度 | `invoices` 单表、明细/置信度 JSON、OCR 专用服务 | `A+C`；归档读模型可后台化，原件、Token、识别请求和打印能力走专用 adapter；`reviewStatus` 与 `accountStatus` 不能合并，见 [`finance-invoice.md`](./pages/finance-invoice.md) |
| `quantity-payroll` | 工程量与工资 | 区域/模板/三量、责任/阶段完成、矩阵/户详情，工资单/成员/分配/行、考勤和 C2 签工 | 工程量、工资、考勤、签工实体及读模型 | `A+B`；现场量 null 不得汇总成 0；工资/考勤/签工无 seed 保持空；B 类合同/BOQ 清单直报工资已决议退役；仅保留 A/C1/C2 的既定现场工资来源，遗留入口/编码/数据隔离待逐项核验，不因补齐合同关系而重开，见 [`subcontract-quantity.md`](./pages/subcontract-quantity.md)、[`subcontract-payroll.md`](./pages/subcontract-payroll.md) |
| `schedule-target-cost` | 项目进度成本 | WBS 分组/任务/依赖/楼层计划、标准库版本、合同绑定预览，目标成本列表/版本/科目与偏差指标 | 排程和目标成本读模型、工程量完成事实、合同/暂估快照 | `A`；排程以创建/绑定时 sourceVersion 和快照为准，目标/实际/已签/已付分别取真实源，不按用途文本归类，见 [`schedule-progress.md`](./pages/schedule-progress.md)、[`target-cost.md`](./pages/target-cost.md) |
| `import-export` | 导入导出 | 实体映射候选、逐行错误、批次进度、导出配置、迁移对账与结果引用 | 本地 Excel/SQLite 快照 adapter、`import_batches/source_refs/reconciliation_issues` 与中央迁移快照 | `A+C`；审计元数据可后台化，文件解析/生成与整库备份保留本地 adapter；原始文件值和整库字节只进受控追溯，不进普通列表 DTO 或中央接口，见 [`boq-import.md`](./pages/boq-import.md)、[`real-ticket-excel-reference.md`](./pages/real-ticket-excel-reference.md)、[迁移指南](../guides/local-data-migration.md) |
| `ocr-settings` | 系统设置 | OCR 非敏感能力、超时、只读阈值和保存结果 | 本机 `ocr_settings`、三个 Nitro OCR operation | `C`；Token、API 地址和模型私有配置永不返回前端；桌面静态构建不能假定 Nitro 永久在线，见 [`finance-invoice.md`](./pages/finance-invoice.md)、[`material-delivery.md`](./pages/material-delivery.md) |

### 3.1 当前实现落点

后台接入时先在下列既有领域边界内增加 repository port，不创建全站万能 repository，也不让页面直接替换 Pinia：

| 页面域 | 当前 Pinia / 领域读模型落点 |
| --- | --- |
| 首页、项目 | 项目列表与来源感知基础详情：`app/stores/project-list.ts`、`app/lib/project/repository.ts`、`http-repository.ts`、`sqlite-repository.ts`、`server/api/read/projects.get.ts`、`server/api/read/projects/[id].get.ts`；首页项目目录与只读排程可用性：`app/stores/home-dashboard.ts`、`app/lib/home/project-source.ts`，来源边界见[首页蓝本](./pages/homepage-dashboard.md#3-数据与状态)；项目详情语义目标统一经 `app/lib/nav/target-registry.ts` 解析；正式项目表单与写入：`app/stores/project-command.ts`、`app/lib/project/command-contract.ts`、`command-http-repository.ts`、`server/api/read/projects/[id]/form.get.ts`、`server/api/commands/projects[/:id]`。详情尚未接入的页签仍在 `project-detail.ts`、`phase-task.ts` 与既有 `app/lib/project/` |
| 客户、班组、工人、分供方 | 客户中央链位于 `app/lib/customer/`；分供方中央链位于 `app/lib/supplier/`；班组—工人中央链位于 `app/lib/crew-worker/`、`app/stores/crew-worker-read.ts`、`crew-worker-command.ts` 与 `server/api/read/crews*`、`server/api/read/workers*`、`server/api/commands/crews*`、`server/api/commands/workers*`。浏览器页面不得回退旧详情 store / SQLite；班组/工人关系只按同来源稳定 ID 汇总。Tauri 仍使用 `master-data-read.ts`、`crew-detail.ts`、`worker-detail.ts` 与本地附件边界。 |
| 核心/辅助合同、BOQ、甲方/分包单据 | 材采、施工与分包浏览器中央读写分别位于 `app/lib/material-contract/`、`app/lib/construction-contract/`、`app/lib/subcontract-contract/`；两类辅助合同与其他支出结算分别位于 `app/lib/auxiliary-contract/`、`app/lib/other-settlement/`。五类甲方单据、分包变洽签、分包结算与项目罚扣共用 `app/lib/owner-document/central-*`、`app/stores/owner-commercial-document-read.ts`、`/api/read/owner-documents*` 与 `/api/commands/owner-documents*` 的中央边界，但以独立 kind、capability 和投影隔离。分包变洽签只从 canonical `subcontract_change_orders` 读取项目、分供方、分包合同、审批金额、变更面积、实际审定价、状态与签证单附件，并进入分包合同 `changes` 事实行；列表和项目卡片分别消费分包专属审批金额、实际审定价汇总，不复用甲方申报额或含税额字段。BOQ 物理事实仍由原领域存储；已迁移的八类 canonical 单据不再由浏览器日常读写本地 SQLite；`sub_settlement` 使用专属金额/证据投影，`project_penalty` 使用中央独立抵扣与整改审计。目标不存在或关系错配时不回退到其他本地记录。 |
| 项目×分供方 | 中央读取：`app/stores/project-supplier-read.ts`、`app/lib/project-supplier/repository.ts`、`http-repository.ts`、`server/api/read/project-suppliers/[projectId]/[supplierId].get.ts`；项目详情同一 DTO 返回 ProjectSupplier 反向关系。导入只把文件选择、本地文件名分类留在专用 adapter；确认后的分供方、ProjectSupplier、文件元数据与正文经 `app/stores/project-supplier-command.ts`、`command-http-repository.ts`、`GET /api/read/project-suppliers/:projectId/import-context` 和 `POST /api/commands/project-suppliers/import` 一次性提交中央 |
| 自购材、甲供材、送货归档、材料价格 | `app/stores/material.ts`、`delivery.ts`、`delivery-record.ts`；`app/lib/material/`、`delivery/` |
| 收入/支出财务、发票 | `app/stores/finance.ts`、`payment-management.ts`、`invoice.ts`；`app/lib/finance/`、`invoice/` |
| 付款洞察、应用消息 | `app/lib/finance/payment-detail.ts`、`app/components/finance/PaymentApplicationInsightPanel.vue`、`app/stores/notifications.ts`；当前静态通知只在服务端授权后的演示模式展示；正式消息源仍待接入，不能把演示通知当成后台业务事件 |
| 工程量、工资、考勤、签工 | `app/stores/quantity.ts`、`payroll.ts`、`payroll-statement-detail.ts`、`attendance.ts`、`signed-daywork.ts`；`app/lib/quantity/`、`payroll/` |
| 排程、标准库、目标成本 | `app/stores/schedule.ts`、`schedule-process-library.ts`、`target-cost-list.ts`、`target-cost-detail.ts`；`app/lib/schedule/`、`target-cost/` |
| 导入、导出、OCR 设置 | `app/stores/export-workflows.ts`、`ocr-settings.ts` 及领域导入模块；`server/api/ocr/` 只承载 OCR 专用 operation |

这些文件是当前实现入口，不是网络 schema 权威；共享 DTO 仍只在本文定义，数据库列只在 `DATABASE.md` 定义。

分包变洽签的来源页只有同时具备 `subcontract-document:read` 才生成专属详情目标。实际审定价汇总独立返回 nullable value 与 `complete|partial|missing` 完整度，不复用甲方审定金额，也不把缺失值折算为完整零值。

### 工程量中央读取与甲方月报（#442）

浏览器正式工程量由专用中央 Repository 读取区域、模板、三量、阶段及报量映射、当前责任、阶段完成、照片和量差。请求绑定当前会话、项目、来源及权限；分页候选必须完整读取后才能成为选择或导出依据。同 ID 的演示与正式来源不能共享草稿或读取结果；离页及切换来源后的迟到响应必须丢弃。显式桌面 SQLite 适配和受控迁移输入保留独立边界，不作为浏览器读取失败的回退源。

合同清单由中央施工合同与已签证变洽签提供稳定 BOQ 身份、有效量价与来源版本；工程量库仅保存外部身份索引，不复制一套合同量价。首次明确关联清单行才更新模板的认定合同量；后续普通编辑保持已有认定值，量差中的已签证增减量只计一次。合同量、暂估量、现场复核量各自允许 `null` 和显式 `0`，汇总同时返回已知小计和缺失项数，不跨基准补值。

甲方月报按所选期次、户的有效模板及分项唯一报量阶段读取已完成事实。候选读取与申报使用同一中央来源；申报在工程量串行执行窗口内读取当前完成量、重验 BOQ 来源版本并冻结三量基准、自动量、申报量、有效单价与来源版本。草稿切换基准须确认清除旧手工量后全量重算；缺量未明确填写时保持待核对，已提交快照不随模板或清单的新版本漂移。实际证明范围见 [#442 验收证据](../design/evidence/issue-442/)；中央实例仍可重置，生产持久化归 #416。

活跃户的模板明细已经关联当前 BOQ、却没有可见同项目同工种报量映射时，自动取数与申报必须明确报错并引导先配置阶段，不返回一个可被解释为完整零量的空事实。未挂接实际户的候选模板不触发此阻断；映射有效但所选月份确无完成记录时仍为真实零。

### 标准工序库中央读取（#443）

`GET /api/read/process-libraries` 与 `GET /api/read/process-libraries/:id` 读取同一授权工作区内的版本目录与指定不可变版本。列表、整页来源及 WBS 工序库候选沿同一 Repository 消费；正式空态不以演示模板填补，失败撤下旧来源事实和写入资格。目录带当前身份、能力、来源与同编码系列保存基准；已删除版本不作为可使用正文返回，但其版本号不能被重新分配。

版本使用项目及数量读取当前中央 WBS，创建、迁入和合法移除后随事实更新；不可读取时保持 `null` 和未知说明，不能当作“尚未引用”。库名、库版本、工序 key 与前置禁用状态保持原身份；阶段码/分项码只解释全局定义，不从显示名猜某项目映射。本读取不生成排程完成事实。

### 中央 WBS 读取（#444）

`GET /api/read/schedule/catalog` 提供授权项目目录，`GET /api/read/schedule/workspace` 提供指定项目排程、合同与楼栋候选，`GET /api/read/schedule/scope` 提供逐栋内部暂估范围核验。请求明确项目、来源及适用筛选；后台使用 `schedule:read` 和当前会话复验项目及来源身份。返回包含当前身份、来源、能力和 `sourceVersion`；来源版本共同覆盖工程量、WBS、项目/合同清单及工序库事实。字段定义以领域契约为准，不把显示名称用作关联。

独立排程与首页投影读取同一份正式 WBS。显式 `from=home` 保持只读来源入口；仅带 `origin` 的独立排程地址不能因此退化为首页入口。正式空项目返回确实未建计划，无权、错配或失败均单独说明，不退回本地首个项目。演示读取须已获服务端授权并明确开启，沿隔离只读适配，不进入正式命令源。

客户端把用户本机运行日作为 `today` 传入，后台严格校验真实日历日期；首页与独立页按同一运行日计算时间轴及工期加权偏差，不以部署服务器 UTC 日期替换用户日期。自动进度只计算当前任务阶段、组内楼栋和有效模板适用范围内应做户与已完成户的交集；最早完成日为实际开始，全部应做户完成后才有实际完成日。无计量来源任务使用手工进度，不能生成虚假的自动完成入口。

暂估预览分别返回有效范围、已知小计和缺失情况，按单位汇总；楼层读取保留冻结来源、人工计划和已有合同绑定历史，当前模板或失效 BOQ 不覆盖历史快照。排程、矩阵及户详情往返使用同一来源链并保留有效筛选；冷刷新或关系失效时重验稳定身份，不扩大成全部范围。写入与迁移见 [COMMANDS](./COMMANDS.md#中央-wbs-命令444) 及 [DATABASE](./DATABASE.md#中央-wbs-事实与整图接管444)，实际验证见 [#444 证据](../design/evidence/issue-444/README.md)。

### 中央暂估绑定与楼栋证据读取（#445）

`GET /api/read/schedule/binding` 使用当前项目、分组、合同选择与来源，返回未绑定预览或已绑定的真实记录。预览按显式楼栋与稳定分项关系读取当前合同清单，逐栋区分覆盖、缺覆盖与额外范围；暂估依据来自已有楼层冻结快照，不读取当前模板回填。分项按单位分别呈现合同量、冻结暂估量、完整度和可计算差异；缺量保留已知部分，真实零仍是确定值。

已绑定时只读合同依据、绑定时间及可识别的绑定时比较。旧历史缺少比较或单位/逐户证据时明确历史不足，不用当前清单重造旧差异。读取核验项目、来源和当前能力；合同或分组错配不按同名关系回退。

`GET /api/read/boq/building-context` 提供同项目合同的当前清单行、合法楼栋候选和楼栋更正审计；原始与已签证生效量价分别保持原有意义。行来源区分已确认导入基准、签证新增和未知，并给出只读原因。绑定页进入独立更正整页，返回恢复原项目、分组、合同选择与有效排程来源；保存后必须重新生成预览。写态不登记为刷新自动恢复的只读页签，页面切换后的迟到结果不能替换新目标。命令与历史保护见 [COMMANDS](./COMMANDS.md#中央暂估绑定与合同楼栋证据更正445) 及 [DATABASE](./DATABASE.md#中央暂估绑定与楼栋证据445)。

### 3.2 跨路由公共读模型

跨路由公共能力不增加生产路由计数，但必须使用与 20 个页面域相同的身份、金额、权限和完整度语义。参考站当前直接证据只证明付款申请详情挂载智能业务洞察；付款申请列表、付款管理/支付记录列表、材料采购合同详情和开票申请详情均未挂载。最终挂载、消息扇出和页签恢复矩阵见 [`PUBLIC-SURFACES.md`](./PUBLIC-SURFACES.md)，蓝色报表行目标见 [`NAVIGATION.md`](./NAVIGATION.md)。

#### 智能业务洞察

洞察以当前单据为上下文，但不等于单项目数据。参考侧栏同时包含当前合同付款、结算/发票勾稽和跨项目/跨供应商应付报表；打开侧栏可观察到“记录上下文 → 规则/报表定义 → 聚合结果”的分层读取。后台不复制参考站配置对象，而提供瑞航自己的稳定读模型：

```ts
type InsightScopeLevelDTO =
  | 'record'
  | 'contract'
  | 'project'
  | 'supplier'
  | 'cross-project'
  | 'enterprise-visible'

interface InsightScopeDTO {
  level: InsightScopeLevelDTO
  anchor: EntityRefDTO
  visibility: 'complete' | 'permission-filtered' | 'unknown'
}

interface InsightAvailabilityDTO {
  key: string
  metadataKey: string
  position: 'detail'
  subject: EntityRefDTO
  availability: 'available' | 'unavailable' | 'forbidden'
  suiteVersion: string | null
  asOf: string
}

interface InsightCheckDTO {
  key: string
  ruleKey: string | null
  ruleVersion: string | null
  result: 'passed' | 'failed' | 'no-rule' | 'not-applicable' | 'pending'
  severity: 'info' | 'warning' | 'error'
  title: string
  summary: string
  metrics: MetricDTO[]
}

interface InsightReportDTO<Row> {
  key: string
  title: string
  scope: InsightScopeDTO
  columns: Array<{ key: string, label: string, valueType: 'text' | 'money' | 'count' | 'ratio' | 'entity-ref' }>
  rows: PageDTO<Row>
}

interface InsightSectionDTO<Row> {
  key: string
  kind: 'rule-checks' | 'current-metrics' | 'report'
  state: ReadState<InsightCheckDTO[] | MetricDTO[] | InsightReportDTO<Row>>
}

interface InsightDTO<Row = Record<string, unknown>> {
  key: string
  subject: EntityRefDTO
  scope: InsightScopeDTO
  attentionCount: number
  sections: InsightSectionDTO<Row>[]
  asOf: string
  sourceVersion: string | null
  completeness: CompletenessDTO
}
```

- `no-rule` 与 `passed` 不同：页面显示“无匹配规则”时不能算检查通过，也不能算业务失败。
- 页面先用 `metadataKey + position + subject.id` 读取 `InsightAvailabilityDTO`；只有 `available` 才挂载入口并允许读取内容。`unavailable` 不能显示空洞察抽屉，`forbidden` 不能泄露规则或报表存在性以外的数据。
- `permission-filtered` 与真正空表不同；跨项目报表只覆盖当前用户可见范围，汇总和行必须使用同一 capability 过滤。
- `asOf` 是聚合统计时点，`sourceVersion` 是规则/报表定义或来源快照版本；两者都不能用组件挂载时间代替。
- L2-7/L2-6 等参考标签只作为运行证据，不成为瑞航接口身份；本地使用稳定 `key`、维度和度量定义。
- 当前 `PaymentApplicationInsightPanel` 的四类检查及“其他项目数量/已付总额”可作为 SQLite adapter 的首版来源；缺少的跨供应商行、规则版本和权限范围返回 `partial`，不得补静态行。
- 缓存必须按作用域拆开：`record/contract` 指标以 `subject.id + sourceVersion` 为键并随付款单切换重算；`cross-project/enterprise-visible` 报表以 `report.key + 可见范围 + asOf + sourceVersion` 为键复用。不得把整个侧栏按项目或上一张付款单缓存，也不得为每张付款单重复获取同一全局报表。

#### 全局通知与抄送事件

全局 toast、顶栏未读角标和消息抽屉必须消费同一个事件读模型。通知点击的目标只返回实体身份和意图，前端通过 [`NAVIGATION.md`](./NAVIGATION.md) 的 target registry 解析；后端不发送 Vue 路由字符串。

```ts
interface NotificationDTO {
  eventId: OpaqueIdDTO
  eventType: string
  kind: 'todo' | 'notice'
  title: string
  summary: string
  subject: EntityRefDTO | null
  actor: EntityRefDTO | null
  result: 'pending' | 'approved' | 'rejected' | 'completed' | 'failed' | 'informational'
  occurredAt: string
  readAt: string | null
  target: NavigationIntentDTO
  permissionState: 'resolved' | 'forbidden' | 'missing'
  deliveryState: 'queued' | 'delivered' | 'failed'
}

interface NotificationOpenResultDTO {
  eventId: OpaqueIdDTO
  readAt: string
  target:
    | { state: 'resolved', intent: NavigationIntentDTO }
    | { state: 'forbidden', subject: EntityRefDTO | null }
    | { state: 'missing', subject: EntityRefDTO | null }
}
```

- `NavigationIntentDTO` 以 [`NAVIGATION.md`](./NAVIGATION.md) 为唯一契约；通知 adapter 不返回前端路由字符串。
- 同一 `eventId` 在 toast、未读数和消息抽屉中幂等；重复投递不能增加两次未读数。
- toast 自动消失、手动关闭和打开消息抽屉都只改变呈现，不等于已读。
- 用户激活单条消息时调用 `openNotification(eventId)`；adapter 在同一事务内按当前权限解析目标并首次写入 `readAt`，返回 `NotificationOpenResultDTO`。`forbidden` / `missing` 仍保留消息记录，重复打开保持幂等。
- 目标 resolved 后的前端渲染失败不回滚 `readAt`；消息仍可从抽屉重试目标。全部已读只能由显式批量命令写入。
- 目标无权限时仍可保留经过脱敏的消息事实，并将目标解析为 forbidden；不能删除消息或把它伪装成无目标。
- `app/stores/notifications.ts` 当前静态样本只在授权后的演示模式可见，正式来源保持真实空态。后台事件接入时按来源隔离提供事件，不将样本作为正式运行 fallback；演示 fixture 的可见性仍服从 ADR 0020。
- 参考刷新时可观察到持续实时通道，同时待办查询单独返回 `ccTotalCount`、`todoTotalCount`、`delayTodoTotalCount`、`totalCount` 和 `records`。当前证据不能把某条 toast 与具体传输帧强绑定，因此 DTO 保持传输无关；adapter 可用实时增量触发，再以分页查询对账未读数。

### 3.3 分供方列表查询与跨域事实

分供方列表、详情和表单预载沿同一 `dataOrigin + supplierId` 读取主档；新增 `laborScope` 进入同一读取和查询投影，旧载荷缺少该字段时归一为空文本。字段词义、持久化及界面列序分别只见 [CONTEXT.md](../../CONTEXT.md)、[DATABASE.md](./DATABASE.md) 和[页面蓝本](./pages/base-supplier.md)，不在此复制字段表。可执行类型与查询白名单位于 [`read-contract.ts`](../../app/lib/supplier/read-contract.ts)，边界解码位于 [`read-decoder.ts`](../../app/lib/supplier/read-decoder.ts)。

- 查询保留原有关键词、类别、资料状态、排序、分页和来源开关；`columnFilters` 在 HTTP 查询参数中传 JSON，按 [`read-query.ts`](../../app/lib/supplier/read-query.ts) 归一。文本使用包含匹配，枚举允许单值或多值精确匹配（同字段 OR、跨字段 AND），数值范围包含两端；空条件不产生约束，未知字段、非法枚举载荷、非有限数值及反向区间返回 `invalid-query`。类别与资料状态兼容旧单值参数，多值使用 JSON 数组；详情返回保存同一语义。敏感列先按当前 capability 形成可见值，再参与关键词和列条件匹配，不允许通过筛选探测隐藏原值。
- 搜索、列条件、排序、总数及金额汇总处理同一完整结果集后分页。枚举 facet 保留其他条件、仅去除自身选中条件，不能从当前页推算选项。分供方缺失或非法页码归一到第一页；合法页码超过结果末页时回到末页，空结果为第一页。数值排序把未知值放在末尾，以稳定身份处理同值；隐藏列不清除已生效条件，返回列表时保留同一查询语义。
- 列表合同金额、累计合同金额、累计结算金额及对应详情金额允许 `MoneyDTO | null`，不能在 decoder 或展示层把 `null` 变为 `0.00`。参与汇总的源金额缺失时，列表值及该来源汇总保持 `null`，详情 `MetricDTO` 返回 `value=null + status=partial + missingSources`，保留可用的源记录核对入口。只有已读取且确实为空的集合可以计算为零；草稿、失效记录和确认条件按[页面蓝本的金额口径](./pages/base-supplier.md#七跨项目只读汇总)执行，累计指标不另存为主档余额。
- 当前中央测试实例通过 [`supplier-fact-source.ts`](../../server/utils/supplier-fact-source.ts) 组合各领域未分页读源：材料采购合同及其结算 feed、分包合同有效增补及中央 `sub_settlement`、其他支出合同有效增补及其他支出结算。关系仅按同来源的稳定分供方、项目和合同身份连接；有工作区/会话边界的来源保留原隔离，来源版本随组合读源返回。合同的 canonical kind 和导航意图不因中文类别显示而改写。
- 接上读源不代表该领域全部业务事实已经迁入：正式材料结算 feed 当前尚无记录，正式发票及确认付款仍缺统一供应商归属/申请分摊来源；不能从合同旧累计字段、付款申请金额或其他票款摘要推造事实。当前已接来源及后续缺口继续由[页面蓝本](./pages/base-supplier.md)和[实现状态](../design/ui-implementation-status.md)维护，本段不宣称生产持久化已经完成。
- 营业执照使用 #446 中央证照专用文件来源。列表普通 DTO 只允许受控文件 ID 与状态，不能返回本地路径或正文；当前读取无权限或无法取得资料时返回 `unavailable`，计数为 `null`、ID 集合为空，不能等同于“未上传”。只有成功读取并查明无原件时才是 `missing`；非空真实正文引用才是 `available`。证照、主档详情和列表查询按同一业务日及当前凭证生成资料状态，再执行筛选与分页，不能从主档旧状态副本筛选。

### 3.4 分供方证照专用读取（#446）

`GET /api/read/supplier-credentials/:supplierId` 要求明确 `origin`，返回当前稳定分供方、主档版本、证照事实版本、服务端会话与能力、上海业务日、资料状态、有效整体核验凭证、证照文件元数据、逐类别要求及可公开的专用审计。演示来源还必须显式 `includeDemo=true` 并具备后台 `demo:read`；返回只读能力，不能进入正式命令。当前原件与历史 OCR 正文仅在专用受控边界使用，不放入普通主档 DTO。

`GET /api/read/supplier-credentials/:supplierId/files/:fileId` 另携明确 `credentialId` 和来源，重验当前主档、活跃证照及对应文件的所有权。正文可用时返回原字节及 SHA-256，客户端在预览/下载前核对长度与摘要；只有历史元数据而无正文时明确 `missing-payload`。已删除证照、错父记录、错原件或无权均拒绝，文件名、旧路径和猜测 ID 不授予读取权。

实际空集合、无原件、暂时不可用、无权、来源错配与记录失效分别表达；失败不降格为空态，正式读取不回旧浏览器 SQLite。专用 Repository 校验响应身份、字段和重复关系；页面请求绑定当前身份与读取代次，切换或取消后的迟到结果不显示、不下载、不覆盖输入。数据保全与状态依据见 [DATABASE](./DATABASE.md#分供方证照中央事实446)，写入与并发恢复见 [COMMANDS](./COMMANDS.md#分供方证照与人工核验命令446)。

#447 在同一专用响应中返回当前识别快照、原始候选、置信度、待核对状态及独立的上次确认事实，供稍后核对和冷刷新恢复。正式来源且具备 `supplier:write` 时才额外提供用于人工比对的 `masterValues`，沿已有整页表单读取权限；普通列表与只读主档的敏感遮罩规则不变。可解析的历史待核对来源按旧字段原义投影，不能将旧 `uniqueCode` 静默解释为 `taxNo`；无法确认的旧格式与缺原件分别提示，不生成虚假确认入口。税务专用命令返回服务端核验五字段和提交版本，重新进入表单仍由同一中央主档读取。

## 4. 页面族响应最低字段

### 4.1 列表

每条列表行至少包含：

- `id`；有业务编号时包含字符串 `no`；名称与状态用未格式化值。
- 所有可点击实体的 `EntityRefDTO`，而不只有 `projectName/supplierName`。
- 所有可点击目标的 `NavigationIntentDTO`；后端只给语义和稳定筛选 ID，不给 route 字符串。
- 该页面判断所需的日期、枚举、金额、数量、附件计数和更新时间。
- 只读聚合使用 `MetricDTO` 或等价完整性结构；可下钻聚合必须给出稳定 filters。
- `PageDTO` 的 pagination、同筛选 summary、empty、asOf、sourceVersion、capabilities。

### 4.2 详情

详情响应至少包含：

- `entity`：列表同一稳定 ID 和版本；不存在/错配使用明确问题码。
- `summary`：关键字段与完整性，不复制可从 children 聚合的第二份可编辑余额。
- `sections`：带稳定 `key` 的业务分区；每个分区含 `items`、`empty`、`asOf`，权限不可见不伪装 0 条。
- `relations`：项目、客户、分供方、合同、班组、工人、来源单据等关系引用。
- `files`：只返回文件元数据、capability 和受控 file id；不返回本地路径、认证 URL 或无授权 payload。
- `capabilities`：查看、编辑、提交、审批、下载等分别声明；前端不从中文状态猜动作权限。

### 4.3 表单预载与工作台

- 表单预载将可编辑 draft、只读 lookup 和 sourceVersion 分开；只读名称不回写为外键。
- 工作台共享同一实体/筛选上下文，分区状态不各自复制。队列项和详情都使用稳定 ID。
- 上传、识别、核对、归档、确认支付、工资发放等是独立命令；读 DTO 只报告已持久化状态，不以 toast 或本地临时布尔值证明成功。
- 项目新增/编辑的写命令、幂等键、乐观锁和失败本地草稿已由 [`COMMANDS.md`](./COMMANDS.md) 裁定；其他领域不得从这一实现自动推导通用 outbox 或合并策略。

## 5. 本地 adapter 与后台迁移规则

### 客户关联项目

`CustomerDetailReadDTO.projects` 从中央项目原始事实快照投影，不经项目列表/详情的客户名称富化回调；客户列表本身不依赖项目聚合，避免两端递归。项目主读与客户投影共享命令、已确认迁移、测试会话、来源版本和服务可用性边界，未创建本地正式镜像或第二张关系表。

`summary.projectCount` 等于可读 `projects.length`。受限单记录从集合排除；关联引用的 forbidden 身份置空。整个项目源无权/暂不可用时返回 `projectsProblem`（`forbidden` / `unavailable`），`projects=[]`、`projectCount=null`，前端须以问题状态解释，不能呈现空关系或真实 0；恢复后重新读取集合。DTO 解码验证数量、状态与集合一致。关系更正和匹配规则见[客户页面](./pages/base-customer.md#详情)。

中央可重置内存实例的通过只证明本切片，生产持久化仍由 #416 验收。合同、收款等其他客户关联的正式写源接入不由项目切片的通过推定完成。

### 客户关联施工合同

#425 的 `CustomerDetailReadDTO.contracts` 复用施工合同中央主读事实，按合同自身客户 ID/来源投影；合同、有效补充协议和累计收款字段均来自该主读源，版本随合同命令及其既有事实来源变化。有效补充金额的状态判定与施工合同主读共享；客户有效额与合同变更后金额的区别见[客户页](./pages/base-customer.md#详情)。客户列表与客户原始身份 facts 不读取合同/项目聚合，避免候选、命令校验和客户详情互相递归。

`summary.contractCount=contracts.length`；合同导航必须含同一 `dataOrigin`、`contractKind=施工` 与父 `customerId`，解码器拒绝来源/类型/客户错配。项目引用仍检查实际可读项目和合同源的关系权限。

整个合同源无权/不可用返回 `contractsProblem`（`forbidden` / `unavailable`），`contracts=[]`，摘要合同数/有效合同额/待收差额与项目行合同数/有效合同额为 `null`，保持独立可读的客户和项目。解码验证问题态、未知值、集合及计数一致，不将失败转换为真实零。前端对合同页签给出明确反馈和适用重试；未接入的新收款写源不由本票推定完成。

### 普通收款及客户关联来源

#436 将普通收款接入单一中央命令事实源，取代 #426 依赖最终结算文档的临时投影边界。列表、详情、表单、客户关系、施工合同累计、项目收入和最终结算共用原始收款，按 `(dataOrigin, id)` 去重；没有最终结算的普通收款仍进入关系，多张结算不重复累计。原始 `facts` 不读取消费方的聚合，避免客户—合同—收款相互递归。读取版本随收款和合同事实变化，普通读取不导入正式样例。

普通收款读取使用 `receipt:read`；详情按稳定 ID 与 `dataOrigin` 独立读取，客户上下文不是必需身份。项目、客户和合同引用分别复验对应读权，受限引用不返回 ID/名称，包含受限关联的记录撤下 `receipt:write`。列表分页和汇总使用同一完整筛选集，正式与演示分别汇总。金额缺失为 `null`，已知零为两位小数字符串；未知历史账号、分类与类型不从其他字段推断。字段展示及状态口径见[收款页面契约](./pages/finance-receipt.md)。

整个来源无权/不可用时返回 `receiptsProblem`，收款集合为空；摘要收款数、草稿数、有效收款、待收差额，项目行收款数/金额，以及合同行累计收款/余额为 `null`，不得用其他摘要泄露受限金额。客户主数据、列表和其他可读关系仍可使用；收款详情返回同一问题，前端支持适用重试。解码同时检查问题状态、集合、计数和未知金额。

施工合同、最终结算和项目收入对同一收款源故障同样返回未知金额与来源问题，保留独立可读主档。中央列表和详情重读时撤下旧事实，权限恢复后才再次显示。收款附件正文经当前记录、来源、归属和哈希校验，历史本机路径不暴露为读取入口。完整迁移仍经显式准备、确认与回滚接管；该可重置实例不构成 #416 的生产持久化证明。

### 适配边界

1. Pinia store 只依赖领域 repository port；SQLite adapter 与 HTTP adapter 返回同一 DTO 语义。页面不得直接拼 HTTP URL、SQL 或领域 route map。项目列表的搜索、阶段与表头筛选都进入强类型 Repository 查询，分页、汇总和导出读取同一完整筛选集；表头筛选选项来自全量服务端 facet，不从当前页反推。可点击目标统一交给 Target Registry，未登记目标保持不可达。
2. 项目列表与来源感知基础详情已经使用中央 HTTP 读 adapter，正式项目表单使用中央命令 adapter；其非生产重置端点只接受显式测试请求，不是用户写接口。迁移页经 `/api/migrations/core/*` 获取预检、批次、问题、映射和中央快照；只有中央 `authority='central'` 且活动批次与本机持久标记一致时，已迁移项目与施工/分包合同才作为正式数据读回。其他页面域在通用业务 API 接入前继续使用 SQLite adapter；但任何已经接入中央的领域均不得借此绕过中央或回退读取旧 production；具体已接入范围见本文件当前落点与 ADR 0020。禁止新增 MockJS、随机工厂、静态成功记录或名称匹配伪外键。
3. 按上表页面域逐个迁移读路径。同一页面切换 adapter 前，用相同确定性夹具验证列表、详情、空态、错误、权限、分页汇总和 sourceVersion 等价。
4. 不做本地与在线静默双写。项目在线命令失败时只保留明确的本地草稿，不改正式投影、不自动回放；其他领域在全局决策前保持各自单一现有写路径。
5. OCR、文件和 Excel adapter 与普通业务 DTO 分离。普通 DTO 只引用受控 file id；二进制上传/下载使用专用能力和短期授权，不保存私有地址。
6. 后台首批可从 `A` 域读取 operation 开始：项目/主数据、合同、项目分供方、财务台账、工程量/排程。任何含 `B` 字段的页面先返回明确 missing/partial，再另票补 canonical 关系。

## 6. 验收

- 当前运行证据矩阵中的业务对象、动态 kind、页面状态及公共入口均有明确页面域归属；新增、删除或改域时同一工作单元更新相关映射，不沿用历史固定路由总数作为验收。
- `id/no/外部键` 为字符串；金额为两位十进制定点字符串；日期为 ISO；布尔为 JSON boolean；枚举传稳定 code，不传样式类名或中文标签作为唯一身份。
- 真实 0、未知 null、空集合、缺关系、无权限、加载失败和筛选无结果均可区分。
- 汇总与列表使用同一筛选；分页排序稳定；关系只按 ID；错配与 not-found 不回退名称。
- 当前无实体数据的页面保持真实空态；项目列表、语义目标、来源感知基础详情与新增/编辑命令，以及受控迁移的批次快照，由可重置中央实例证明 HTTP 链。其余后台未接入页面使用类型化 SQLite adapter，不引入 MockJS；所有已接入中央的领域除外，不能以 SQLite adapter 作为正式回退路径。
- 本文件与 `DATABASE.md`、页面蓝本或实现冲突时先在对应 Issue 留证，再在同一工作单元消除冲突；不得静默让页面 DTO 成为第二份数据库 schema。

### AX02 分包结算

`ownerCommercialDocumentRead` 的 `sub_settlement` 列表/详情使用专属 `SubcontractSettlementAmounts`，项目/合同/分供方与附件按真实 ID 读取。金额和空错权限语义见[页面蓝本](./pages/owner-documents.md#issue-328-分包结算中央只读链)，累计事实不复制到头记录。

## AX04 辅助合同中央读面

#330 的两类合同列表、专属只读详情、项目/分供方来源入口使用同一中央 Repository/HTTP。列表遵循 PageDTO，详情与空、部分关系、错误和权限状态遵循 ReadState；主链接不进入编辑。字段和金额口径仅见 [DATABASE](./DATABASE.md#ax04-辅助合同中央事实)，交互仅见 [页面蓝本](./pages/contract-forms.md#ax04-当前浏览器实现330)。

## 目标成本中央读取（#412）

预算使用 `/api/read/target-costs`、`/api/read/target-costs/form`、`/api/read/target-costs/:id` 及所属版本文件读取端点。Repository 校验来源、会话、目标身份、金额/数量边界及语义导航；浏览器正式读取失败不退回旧库。列表在同一完整授权结果集内筛选和分页；版本头表单和明细页各保存独立读取依据。

预算读取权限与工程量权限分开。内部项目完整事实只用于复验身份及关联；公开项目 lookup 仍要求项目读取能力，不暴露内部目录。已授权预算可显示自身关联项目名称，项目及成本来源入口须核对目标能力并经 Target Registry 解析。来源返回使用受控项目、预算版本及 origin，不接受任意站内路径作为业务授权。

详情只读取指定版本的科目、附件及明确归属的历史；实际成本按该版本项目读取当前已接管事实，并有独立来源指纹。预算头录入金额、正式合同承诺、结算成本与支付分别显示，历史版本不换成当前基线科目。完整度、已知部分、缺源及真实零的含义遵循本文件通用契约与 [DATABASE](./DATABASE.md#目标成本中央版本与完整接管412)，不得用未接入空集合伪造已知零。

原件只通过所属预算和文件身份读取，正文验证真实长度及摘要；历史未知大小仍保持空值，缺件与损坏分别说明。读态、多页签、异常恢复和五档视口的验收以 [#412 预算证据](../design/evidence/issue-412-target-cost/README.md)为准。本节不表示完整工资、材料、财务来源或生产持久化已经通过。

## 工资中央历史与独立来源读取（#412）

`/api/read/payroll`、`/api/read/payroll/:id` 和 `/api/read/payroll/sources` 分别提供台账、指定单据及指定项目的独立来源。Repository 固定 `workspaceId / actorId / origin / sourceVersion` 与 `payroll:read`，不借用工程量或排程权限。正式来源失败不回落本地；演示必须由后台授权且只读，同 ID 也与正式缓存隔离。读取结果不含可执行工资命令。

项目来源目录必须涵盖没有工资头、只有配置/考勤/签工的已接管项目；不以工资行集合证明项目资料不存在。台账在同一完整授权集合内组合筛选，来源查询固定项目并保留月份、班组；工资状态与签工确认状态各自恢复。未知项目深链明确失败，不自动换项目。当前资格在异步等待后重新核实，旧来源/目标的迟到结果不覆盖新页面。

已发详情分为冻结呈现与保存的原关系证据。冻结数据、原快照全文及未知扩展字段保留；缺/坏/部分和原表不一致分别诊断。历史量价、姓名、实际金额或分配缺失不得用当前档案补齐；合法零仍为零。原工资头和软删子表可追溯，避免把发放呈现中的未知误解为原记录也不存在。完整性的字段与关系规则见 [DATABASE](./DATABASE.md#工资完整资料中央接管412)。

独立来源提供主体配置、考勤、签工、可识别历史、月锁和签工占用。锁由工资状态及全体相关成员投影，不用正数金额、工时或明细行数替代成员存在性。B 类和缺证据的旧来源保持隔离，不给新核算、发放、输出或成本资格；接管只读本身不证明这些后续能力已完成。

## A 工资草稿、配置与冻结输出读取（#412，P1）

工资 Repository 扩展 `aForm / aConfig / aOutput`：`POST /api/read/payroll/a-form` 只读预览请求正文中的 `query + input`，避免完整草稿放入长 URL；`GET /api/read/payroll/a-config` 读取指定 `scope`；`GET /api/read/payroll/a-output` 按稳定 `statementId` 读取冻结输出。读取本身不保存草稿、改价或核对。P0 台账/历史与独立来源继续只读，不能由 A 的写能力反推全部工资来源可编辑。

草稿预览返回固定上下文、完整成员、原施工事实、按工资价格拆分的明细、比例默认值出处、各金额完整度、逐项阻断及允许动作。新建使用独立 `draftKey` 并允许逐步填写，已存工资始终按路径身份读取；输入、当前读取结果和保存依据分别保留。配置读取绑定项目、月份、班组与负责人，返回首月配置、可证明班组比例、工资价格修订及历史，不以当前全局筛选替代原读取目标。

新建尚未选择或明确清空项目、负责人、月份时仍可读取空预览及授权候选，保存保持阻断，不自动选取首项。项目候选由新建读取提供，不以历史工资台账是否已有记录决定首张工资可达性。缺损来源即使没有可核算行，也保留可证明的位置和原身份；只有目标项目、可见链及读取能力均通过时才提供原户链接，否则显示不可用原因。多户聚合行的每个来源保留自己的完成身份，返回后恢复对应楼层和焦点。

数值传输沿既有金额定点字符串规范，数量及比例使用明确十进制字符串；领域和页面解码后保留 null 与真实零。金额同时声明完整、部分或未知及已知部分；缺来源不能伪装空集合。比例默认值明确区分上月月度单、主体配置、真实班组配置、结算默认、固定尾款及未配置，具体继承规则只见[工资页面](./pages/subcontract-payroll.md#工资核算)。

新 A 输出只读取完整中央发放快照，状态为可用或不可用并附原因；姓名、成员含零、实际分配、明细和此前支付均来自发放时，不从当前档案补齐。输出和历史区共用正式来源、冻结内容与发放回执的完整性核验；旧快照保留原阅读与诊断，不因拥有类似字段就升级为新 A 输出。原完成、工人和班组入口依稳定身份及目标权限解析；返回标记只恢复原草稿或详情上下文，不形成权限或执行命令。

P1 本地限定验收见[A 工资证据](../design/evidence/issue-412-payroll-a/README.md)；完整关系与存储规则见 [DATABASE](./DATABASE.md#a-工资中央来源配置与发放412)，写入见 [COMMANDS](./COMMANDS.md#a-工资中央命令412p1)。

## 考勤矩阵、C1 草稿与配对输出读取（#412，P2）

P2 通过工资 Repository 的 `attendanceMatrix / c1Form / c1Config / c1Output` 读取。对应 `GET /api/read/payroll/attendance`、`POST /api/read/payroll/c1-form`、`GET /api/read/payroll/c1-config`、`GET /api/read/payroll/c1-output`；矩阵与配置绑定项目、月份和班组，表单在正文中传入 `query + input`，输出固定工资 ID。仍使用 `payroll:read`，不因 C1 没有工程量或 quantity 权限而拒绝合格工人的考勤。

矩阵分别返回当前候选、范围内原历史记录、来源锁、诊断与隔离原文证据。空格没有记录，真实零有原记录；坏工时、日期、失效人员和当前不可写分别说明。历史人不能因当前名册 JOIN 而消失；原班组、原记录身份与当前编辑资格分开呈现。表格保完整小数，月底只在自身区域横滚。

未选项目或月份时，考勤矩阵保留原空范围和授权候选，返回空记录、空工人矩阵及空锁定结果；不自动选择首项或当月，不将空月份解释为读取全年考勤。非法非空月份仍拒绝。

C1 草稿返回所选主体、全成员、逐日原事实、每人正常/加班两行、个人有效费率及出处、核算完整度和逐项阻断。配置区同时返回实际保存的 `configuredDailyWage / configuredOvertimeRate` 与有效费率；输入使用原保存值，档案优先值及日薪÷8推导只供核对。读态的来源变化反馈不暗中改写工资，实际需重核持久化由命令负责。

已证考勤来源链接使用真实 record ID，白名单筛选保留项目、月份、班组、工人和日期；返回身份仍是原工资稳定 ID 或独立草稿，不由 query 替换。原记录失效或权限不足时提供原因，不换成同名人员或其它考勤。

通用工资详情读取 C1 时，已发明细及保存的原明细中的 `unitPrice` 按原有限费率传输并显示，例如 `60.125`；工资金额仍按两位小数字符串传输。该例外仅属于 C1 详情的两套明细，不放宽 A 单价或其他金额字段；原快照、原头及审计证据保持原文。

新 C1 冻结输出包含同一单据的工资表与逐日考勤表，两者共用原冻结姓名、工时、费率和全成员实分配，不在打印或下载时读取当前矩阵补数。详情与输出共用已采用来源和原发放回执核验；旧 C1 缺逐考勤原证据持续保留缺口。单据配对输出不等于后续整月或全周期工作簿。存储及资格见 [DATABASE](./DATABASE.md#c1-逐日考勤个人费率与冻结来源412p2)，命令见 [COMMANDS](./COMMANDS.md#考勤与-c1-工资中央命令412p2)。

## 签工台账、C2 草稿与配对输出读取（#412，P3）

P3 已接入工资 Repository 的 `dayworkList / dayworkForm / c2Form / c2Config / c2Output`；限定验证见工资页面及本期验收。对应读取为 `GET /api/read/payroll/daywork`、`POST /api/read/payroll/daywork-form`、`POST /api/read/payroll/c2-form`、`GET /api/read/payroll/c2-config`、`GET /api/read/payroll/c2-output`。表单 POST 是只读预览，不产生写入；所有读取仍要求 `payroll:read`，不要求 quantity 权限或项目有工程量。

签工台账范围含项目、月份、班组与独立签工状态多选，空项目/月返回原空范围及授权候选，不读全年或自动选首项。原事实按项目/月完整读取后再呈现筛选，日内冲突和领用检查不能被班组或状态筛选隐藏。每条记录分别表达原文、当前人员/班组显示、可编辑/可确认资格、诊断、逐条领用与月锁；原事实缺损、已删除、待确认、被占用和可用不合并成普通空态。

原签工表单以路由 `recordId` 读取，查询筛选不替代实体归属；新稿才使用独立 `draftKey`。配置固定项目×负责人，返回原配置及同主体可识别历史、当前候选和不可写原因，空规则与 NULL 不用默认脚注替代。主体价、工数及原单价按有限精确小数保留，金额按既有两位小数字符串传输；原行及审计证据不递归转换。

有限小数在 JSON 边界展开为十进制定点字符串，例如 `0.0000001`，不舍入成金额也不输出指数形式。C1/C2 共用费率转换及通用详情原单价遵守相同规则，读取和命令拒绝科学计数法字符串；存储的原始证据旁路保持原文。

台账独立月份锁按当前项目、月份和全部真实工资成员投影，不依赖筛选后是否还有签工行。无签工或零分配成员、状态筛选为空时仍显示其真实锁；空项目/月不投影其他范围。表单自动重读刷新当前身份及资格但保留原稿的保存依据，用户明确重新核对才采用新版本；未知提交仍沿原编号核验。

C2 工资预览分开返回当前逐条事实与原单采用来源，另有服务端实际采用 ID、原配置、全体成员、明细和核算完整度。被其他有效工资领用的行仍可见且不可抢占；合法剩余 confirmed 来源可核算。原来源后来移日、换人、换项目或改状态，仍沿稳定 ID 呈现实际变化和需重核原因，不能因当前筛选而吞掉原关联。原工资身份与格式来自实际读取，不由 query 强改。

签工来源意图使用 `source-record / daywork / ledger` 与真实记录 ID，经授权关系校验后只读定位台账原记录；编辑另走明确整页入口。返回保原工资 ID/新稿与项目、月份、班组、工资状态及独立签工状态；失效或不再符合原关系时说明原因，不能猜同名对象或自动改挂。

完整已发 C2 输出仅从本单采用来源、专属冻结及原发放回执互证后生成：零星用工记录表与工资表使用同一原配置、逐条时段/工数/证明信息、当时姓名和实发分配。已发后当前档案或配置变化不重写输出；缺证据保持 unavailable 与原历史只读，不能用当前数据填成完整工资。本期配对表不包含考勤或完整月工作簿。

## 工资更正历史与实际收付读取（#412，P4）

工资 Repository 提供 `adjustmentForm / adjustmentDetail / adjustmentHistory / actualPaymentForm / actualPaymentDetail / actualReversalForm / actualLedger / releaseAdjustmentPreview`，分别对应 `/api/read/payroll/` 下 `adjustment-form / adjustment-detail / adjustment-history / actual-payment-form / actual-payment-detail / actual-reversal-form / actual-ledger / release-adjustments` 的 POST 只读接口。query 与固定 input 身份共同校验，preview 不写入业务事实。

原单更正历史包含尚未发生现金处理的核算更正、同根余额和每次处理；关联对象分别指向真实补退/冲销事件或后续已发工资，不能仅从现金集合反推更正清单。原签名金额、核算差额、待处理额与实际净额分区呈现。确认记录输出取已验证的独立确认快照，原 A/C1/C2 签名输出继续使用原冻结。

`PayrollActualFacts` 以稳定 identity 去重，保留原工资、更正、应用和冲销引用，实际发生日、有符号金额、当时成员及个人分配、资格和完整性版本。金额保持两位十进制字符串，数量/单价保有限小数精度；未知、已知零、部分已知、无权和读取不可用分别解码。封闭解析器拒绝串项目、原单或事件的响应。

按原工资范围读取时，先核实整笔收付及冲销证明，再按原更正的已确认处理金额投影；一笔跨月退款不能在各月重复计入整笔。范围投影保留实际身份，限制原工资/更正/应用引用，使用独立来源版本和 `scoped-amount-proven` 资格；完整事件详情仍读取整笔金额，范围金额不能作为整笔错记冲销依据。单个非零收付人可证明该范围个人金额；多人而无各原工资的个人分配矩阵时，范围总额已知、非零个人金额未知，整体标为部分完整，不能按比例猜分。缺少可核对处理金额则范围净额未知，不跳过后当作完整零。

预算在已有事务传入当前身份给内部工资 loader；班组/工人/项目 detail 嵌入目的范围的工资实际分区，避免页面再发另一套并行工资请求。目的读取权限和 `payroll:read` 同时核对，最后异步等待后再核验；个人缺分配不从整单或当前名册推份额。付款管理的工资收付为独立只读区域，不计入申请待付、银行流水或往来款。所有来源入口校验稳定关系并保留原预算版本、人员/项目及工资筛选返回。

## A 工资费用与独立管理簿读取（#412，P5）

`POST /api/read/payroll/a-fee-config` 经 Repository 的 `aFeeConfig(query, scope)` 读取项目、班组、负责人、月份和用途簿。返回封闭上下文、保存版本、原默认三态、逐条费用及修订、管理簿、原责任与细格候选、分项语义、历史和分动作资格。未选项目保持空预览；未证名称不升级为墙砖/地砖语义。费用保存、新增管理关系和新建管理草稿各有原因，普通簿已发不一并禁掉另一个独立管理簿的合法操作。

`aForm` 扩展用途证明、管理关系、费用组成、当前负价草稿及全部修订、本簿逐期实付和正负金额分区。普通工资与管理费虽同属 A，必须按可证明簿身份分开累计。原责任候选包括未完工细格以供管理关系及负价依据；正向费用只读取真实完成。可见的来源链接按原 ID、当前权限及来源意图解析，保留工资、费用配置、管理簿与焦点返回上下文。

读取区分当前候选、已采用依据和原冻结；来源缺损仍提供诊断及可证部分，不伪装为无费用或已领 0。坏响应必须在 Repository 封闭解析边界拒绝，不能让不完整嵌套对象进入可信页面状态。已发 V2 表单与输出取原冻结；费用组成、负价全集、本簿历史及回执一致才为 `available`。旧 V1 原文不补新字段，不能因表面相似就升级费用输出。

迁入的费用、管理关系及负价使用原物理证明与明确 ID 映射生成受控类型投影，原 JSON 保持逐字不变。原链失效时停用对应证明，不缓存旧可用资格，也不从当前配置或同名人员补齐。P4 与跨域实际消费者读取同一 proven 工资集合，费用明细、负价行、个人分配和更正关系不再加一次成本。保存与物理模型见 [COMMANDS](./COMMANDS.md#a-工资费用与独立管理簿命令412p5)、[DATABASE](./DATABASE.md#a-工资费用独立管理簿与负价清单412p5)。

## 户级空鼓和工资扣款读取（#412，P6）

工程量 Repository 的 `hollow` 经 `GET /api/read/quantity/hollow` 读取固定项目、户与来源。返回当前可记录目标、可证明的原检查、全部修订及整改、当前余量、逐条写资格和不可用诊断。创建目标依当前有效责任，已有检查保留检查时原责任；“暂无检查”与“明确检查零处”分别表达，破损证明不能变成空数组。

原户提供独立 `/subcontract/quantity/:pid/:uid/hollow/new`、`hollow/:id` 和 `hollow/form/:id` 页面。来源意图校验真实项目/户/记录与权限；工资返回信息只恢复原单或新稿、分项与楼层位置，不能扩大查看资格或更换原实体。A 未保存输入以独立草稿身份保留，冷恢复必须重新取得当前预览，恢复缓存不能成为可信读取或核对凭证。

工资 Repository 的 `hollowConfig(query, config)` 经 `POST /api/read/payroll/hollow-config` 接收严格的 `{ query, config }` 只读正文；返回固定格式、项目、班组、负责人、月份及 A 用途簿下的有效配置、原修订、状态和保存资格。无分项修订时默认金额与出处一并说明；明确关闭、金额 0、金额缺失分别解码。项目和范围关系不符拒绝，不能借查询扩大配置范围。

A/C1/C2 表单的 `hollow` 区分当前原检查、人工开始、此前处理、冻结采用及各金额完整度。行状态分别为待人工开始、不启用、已整改、原单已处理、待明确规则和依据未获证明；没有当前可见行不代表排查完成。进度月仅列示，离职且仍有未整改来源时只提醒。配置或整改变化后，原启动仍可见且显示需重核，不能用旧合计冒充当前完整结果。

已发表单把冻结行、冻结金额与只读 `current` 伴随视图分开返回。冻结区继续使用发放时的原检查、截止整改、量价和采用；`current` 只投影原冻结记录的当前户级来源，记录、项目、户和分项身份必须与冻结事实对得上，并使用同一主体最新生效月份的当前配置。它返回位置、原责任、检查/整改/余量、当前单价和诊断，用于说明后来整改、改量、改价或责任变化。当前读取失败时保留冻结区并明确失败，不拿冻结行冒充当前，也不以当前行重算原工资。

A 的施工楼层按本簿在所选月及以前的已证完成事实，以楼栋 ID×楼层 ID 区分往月、本月和未涉及分项；空鼓原位置在此范围之外时另列说明，不以责任分配伪造完成格。清单联动分项，原空鼓入口与橙点均保留文字和键盘路径。C1/C2 不生成工程量楼层矩阵。

空鼓处数按安全整数、单处金额按有限精确小数、金额指标按两位定点字符串传输，原 JSON 证据旁路保持逐字不变。冻结 A/C1/C2 的表单、打印与 Excel 只取当时完整原件；来源快照与输出只差本次采用集合。缺原配置同次集合、采用、原工资冻结日志或回执时返回 unavailable；不能以缓存的可用结果替代当前物理证明。

P4 更正读取展示原采用位置与量价，预览差额时保留原签字金额；实际收付和后月已包含关系沿同一原更正链核对。工资迁入后的可读身份投影须由完整原件及明确映射证明，旧文字不升级为健康空鼓源。实施状态及操作见 [P6 指南](../guides/payroll-hollow.md)，实体和写入见 [DATABASE](./DATABASE.md#户级空鼓整改与工资采用412p6)、[COMMANDS](./COMMANDS.md#户级空鼓和人工扣款命令412p6)。

## 批量工资预览与计划读取（#412，P7）

Repository 的 `batchPreview` 经 `POST /api/read/payroll/batch-preview` 读取同项目同月且身份不重复的 A/C1/C2 原工资。每项返回格式、负责人、完整成员、当前状态、整数分可发额、空鼓整单约束、A 取整三态、核对依据摘要和阻断理由；C1/C2 的取整恒为不适用。批量核对不接收资金，批量发放必须明确非负安全整数分资金。未知余额、需重核、未核对、已发或来源缺损不能作为零权重继续。

资金建议先按服务端稳定簿身份安排可容纳的整单工资，再按其余可证余额计算比例与分值余数，逐项不超过余额。初分保留 A 整百配置，最终可突破档位用尽合法资金；未配置不采用默认档位。稳定身份排序与保留余额原因见[工资页面](./pages/subcontract-payroll.md)。资金不足的整单和0建议保持暂缓，诊断同时进入预览说明；建议仍不代表实发。人工修改由确认命令复验总资金、单项余额和全部成员分配。新增排序键只来自当前预览，不改变已固定计划的原依据或原命令正文。

`batch(query, planId)` 经 `GET /api/read/payroll/batch` 冷读当前协调状态。计划正文保留原确认项；`planVersion / state / nextItemIndex / expectedPayrollRevision` 反映当前进度。`ready` 可准备下一原单，`prepared` 表示原命令已经持久化且资金不可挪用，`needs-recheck` 要求重新核对，`complete` 表示所有非暂缓项已有原回执。计划或回执不能替代原工资详情、冻结输出和实际收付读取。

`aRounding` 经 `GET /api/read/payroll/a-rounding` 返回固定 A 工资簿范围的全部追加修订、目标月有效修订及不可写原因。缺失、明确关闭和整百规则分别表达；后月修订不回写前月。

## 工资正式编号与原件读取（#477）

Repository 的 `numbering(query, { projectId, statementId })` 经 `POST /api/read/payroll/numbering` 读取固定项目、可空原工资、项目序列、已出具元数据、可证明冻结文档及分动作资格。`statementId=null` 仅用于项目起点登记；它不能自动选择工资。正式编号 `issue.number` 始终为原字符串，`firstNumber / nextNumber` 仅是内部安全整数计数。编号缺失与已出具区分，预览不占号；未知旧号不从文件名、月份或当前行序推导。

`document` 复用完整 A/C1/C2 冻结 DTO，数量、费率与金额继续使用各格式既有十进制传输，不因附加编号重算工资。已出具必须同时证明原回执、序列和原件摘要才能 `canDownload`；只读工资身份可读取已证编号和单份原件，但不能登记或新增出具。没有写权限、缺起点、删除未出具原单、未发、历史 B、缺冻存证据分别返回不可操作原因；跨项目和坏响应在服务及 Repository 边界拒绝。

迁入 DTO 只投影经原图和显式映射证明的当前身份；`issue.documentHash` 保留出具时原摘要，映射后的文档另在服务端核对，不改写原摘要来伪装一致。完整工资工作簿与月归档之后通过 [#479](https://github.com/zodea/crm-new/issues/479) 消费该接口，不凭工资权限扩读私密名册。页面流程见[正式出具指南](../guides/payroll-official-numbering.md)。

## 工人私密资料与名册读取（#449）

`WorkerRosterRepository` 提供 `profile(workerId)`、`preview(scope)`、`archives(projectId)`、`archive(projectId,archiveId)` 和 `file(input)`；对应 `/api/read/worker-roster/profile|preview|archives|archive|file`。预览采用 POST 正文 `{projectId,statementIds,registeredOn}`，不接收手填成员范围。全部私密读取需要 `worker:sensitive:read`，预览和名册读取同时需要 `payroll:read`。响应为 private/no-store；普通工人列表和详情不因新增接口取消遮盖。

预览从可信工资冻结读取映射稳定工人身份，保留零成员、原姓名、负责人和工资来源；当前工人资料缺失仍保留成员并记录缺口。当前项目与合法进退场事实不足时登记日期的在场状态为 unknown。归档是独立日期的资料补充，返回固定成员、字段、劳动合同、照片元数据/摘要、资料版本和缺口；后续主档修改不补写旧归档。

照片读取核对工人 owner、归档成员与该版照片引用、正文编码/长度/SHA-256；无归档参数只服务当前工人专门私密页面，仍须独立私密权限。客户端不提供路径，不以文件名判断归属。所有读取在最后异步等待后再次核验会话和权限，Repository 验证响应身份与选择范围。

## 工资完整工作簿与保存目录读取（#479）

`PayrollRepository` 的 `workbookPreview(query,input)`、`workbookArchives(query,{projectId})`、`workbookArchive(query,{projectId,archiveId})` 对应 `POST /api/read/payroll/workbook-preview|workbook-archives|workbook-archive`。输入固定正式来源、项目、模式、唯一原工资集合及可空名册版本，不能靠当前分页或姓名隐式补选。负责人全周期只允许同一稳定请款簿；按月模式将所选原工资按月份分组。

预览同事务组合已发 A/C1/C2 原冻结文档、正式出具及原工资范围的实际收付。原工资正文缺口 `gaps` 与编号、名册、实际账交付缺口 `deliveryGaps` 分开；缺照片不能抹掉已证明的工资金额。未正式出具保持明确缺口，预览或保存不自动发号；不可用的来源不补零、不伪造已发正文。名册“独立登记日补充版本”是证据性质说明，不是资料缺口。

所有目录读取要求 `payroll:read`。预览选择了名册时，额外从工人 owner 核验 `worker:sensitive:read`、完全一致的原工资范围、固定版本、照片归属和正文摘要；公开预览仅返回名册摘要，公开保存目录只返回固定引用。工资权限可阅读及下载工资部分，完整实名附件需重新单独授权。无权限、未选择、缺照片和坏版本分别说明，不把权限失败降格为“资料齐全”。

HTTP 复用各工资格式与实际台账的十进制传输协议。Repository 验证金额、组内原单身份、模式分组、实际账范围、版本与当前身份；历史目录的实际账以保存时点为准，外层 context 为本次真实读取身份。输出器在完整附件生成后重新读取同一目录和名册，校验权限、范围和摘要，任何失败均不返回完整下载文件。

经过服务端完整原图及映射证明的迁入目录/名册 DTO 可以附带 `migration: { originalId, originalContentHash }`。目录中的该摘要必须等于保留的原 `manifestHash`；名册的该摘要标识不含 context 的原归档正文。它说明原件与本代身份投影的关系，不是本代改写 JSON 的摘要，也不接受来源 JSON 自带的同名声明。私密下载仍核对本代项目、精确工资集合、名册版本/日期/来源版本及当前身份权限；目录固定的原名册摘要可以与经过证明的 `originalContentHash` 核对，不能因此绕开范围或撤权检查。
