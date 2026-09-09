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
- 成功读取且确实没有子记录返回 `[]`；未读取、无权限或父关系缺失不能返回假空数组。
- 字段“不适用于该变体”应在变体 schema 中省略；字段适用但尚无事实必须显式返回 `null`。
- 工程量现场量缺失必须保持 `null`；阶段/全户合计只有所有参与行都有值时才是 `complete`，不能用 `?? 0` 消除缺失。
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
| `project-supplier` | 项目分供方 | 项目×分供方详情、六类事实集合、合作文件与汇总；本地文件选择/分类草稿，确认后中央原子导入 | 中央 `ProjectSupplierReadRepository` 与导入命令；浏览器本地 adapter 只负责文件选择、分类和正文读取 | `A+C`；#317 已闭合双 ID 关系校验、正式/演示六类事实 DTO 与 HTTP，#281 闭合正式分供方/合作关系/文件正文的中央原子写入与反向读回；来源意图携 `dataOrigin`，仅已验证只读目标可返回，其他目标稳定不可用；文件预览/下载和终态结算写入仍不冒充已接入，见 [`project-supplier.md`](./pages/project-supplier.md) |
| `core-contract` | 核心合同 | 三类合同列表/详情/表单、关联单据、材料明细、BOQ 文件/行/变更/月报量与汇总 | 材采、施工与分包分别经中央领域 Repository；BOQ 按 canonical `contracts` 及下游单据 | `A+B`；#318/#320/#321 分别闭合材采、施工、分包专属列表—七分区详情—正式中央写入—读回；#322 闭合施工/分包补充协议稳定聚焦、父子校验、正式迁移与列表来源恢复；演示须显式授权且只读，未闭合稳定目标返回 `unverified-target` |
| `aux-contract` | 辅助合同与结算 | 公司/其他支出合同、其他支出结算的专属列表/只读详情/表单，以及材料结算列表和表单；项目/分供方/合同引用、金额链与状态 | 两类辅助合同与其他支出结算经各自中央 Repository；`expenditure_settlements`、真实分摊与独立中央源单 | `A+B`；#330 已闭合两类辅助合同中央链，#331 已闭合其他支出结算及奖罚/申请/支付源单往返；未知付款归属仍保持 null。没有业务明细实体的类型不得返回虚构 lineItems；材料结算—有效到货关系已定，#409 核验实际迁移与实现，见 [`contract-forms.md`](./pages/contract-forms.md) |
| `owner-document` | 甲方单据 | 六类单据变体的专属列表、只读详情投影与表单；项目/施工合同/客户、金额、分视图附件与审计事件 | 甲方单据表、月报量、BOQ 变更、`project_acceptances`、`project_acceptance_lifecycle_events`、`owner_final_settlements`、`owner_penalties`、`contract_supplements`、`receipt_registrations` 和 `file_refs` | `A+B`；#323 已闭合甲方变洽签/月度报量，#324 已闭合验收/保修 canonical 双视图，#325 已闭合最终结算，#326 已闭合甲方罚扣专属只读详情、中央表单命令、真实联系单附件与施工合同来源往返。罚扣金额、联系单、事由、申诉说明与状态来自同一 canonical 事实，申诉说明不推导审批流，见 [`owner-documents.md`](./pages/owner-documents.md) |
| `subcontract-document` | 分包单据 | 分包变更、分包结算、项目罚扣专属列表/详情投影/表单；合同/分供方/班组与抵扣关系 | 分包变洽签、分包结算与项目罚扣经中央 owner-document Repository；`penalty_records`、独立抵扣与整改事实 | `A+B`；#327 已闭合分包变洽签专属只读链；#328 已闭合分包结算的中央列表、详情、保存确认、附件与迁移，并恢复全局/项目/合同来源；#329 已闭合项目罚扣中央详情、抵扣/整改与审计。分包结算付款来源未接入或精确归属未知时仍保持 partial，不用表单记录冒充详情，见 [`owner-documents.md`](./pages/owner-documents.md) |
| `material` | 自购材 | 下料、到货、领用、盘点列表/详情投影/表单；材料行、来源单据、库存与结算付款状态 | 乙供材头/行表、合同/项目/分供方外键 | `A+B`；warehouse 仍为文本，到货—归档、结算分摊、领用批次和调拨两端缺稳定 ID，必须返回 missing-relation，见 [`material-management.md`](./pages/material-management.md) |
| `owner-material` | 甲供材 | 总控、下料、到货、领用、直入直出五类专属列表/详情投影/表单 | 五类甲供材实体、项目/客户/班组引用和三量派生 | `A+B`；供货单位不得冒用项目客户，总计划头/行、仓库、送货单和班组合同身份待建；无 seed 时返回真实 0 条，见 [`material-management.md`](./pages/material-management.md) |
| `delivery` | 送货单闭环 | 处理区、归档库、归档详情/表单；送货头、材料行、归属、OCR/审核/归档/打印状态 | `delivery_records`、`delivery_lines`、`file_refs/file_payloads` | `A+C`；头/行和价格事实可后台化，原件字节、上传会话、OCR 轮询和桌面打印使用专用 adapter；文件名/路径不授予读取权限，见 [`material-delivery.md`](./pages/material-delivery.md) |
| `material-price` | 材料价格 | 材料×规格×单位×分供方×项目×时间的价格事实、序列、对比和来源下钻 | 已归档送货行的确定性聚合，无独立价格表 | `A`；只返回有真实归档来源的事实，reviewed/done 名称差异由 adapter 归一，不保存第二份价格，见 [`material-management.md`](./pages/material-management.md) |
| `finance-income` | 收入财务 | 开票申请、中央只读收款详情、显式收款表单、往来列表/详情投影；项目/客户、金额/税额、方向、状态、来源 | `invoice_applications`、`receipt_registrations`、`current_transactions` | `A`；#314 已闭合客户收款关系的中央只读目标，其他通用本地列表仍需后台 DTO 返回真实关系 ID；保证金/备用金无本地路由不扩张，见 [`finance-billing.md`](./pages/finance-billing.md)、[`finance-receipt.md`](./pages/finance-receipt.md) |
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
| 首页、项目 | 项目列表与来源感知基础详情：`app/stores/project-list.ts`、`app/lib/project/repository.ts`、`http-repository.ts`、`sqlite-repository.ts`、`server/api/read/projects.get.ts`、`server/api/read/projects/[id].get.ts`；项目详情语义目标统一经 `app/lib/nav/target-registry.ts` 解析；正式项目表单与写入：`app/stores/project-command.ts`、`app/lib/project/command-contract.ts`、`command-http-repository.ts`、`server/api/read/projects/[id]/form.get.ts`、`server/api/commands/projects[/:id]`。首页与详情尚未接入的页签仍在 `project-detail.ts`、`phase-task.ts` 与既有 `app/lib/home/`、`app/lib/project/` |
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
- 营业执照继续使用证照专用文件边界。列表普通 DTO 只允许受控文件 ID 与状态，不能返回本地路径或正文；专用真实文件读面尚未接通时返回 `unavailable`，计数为 `null`、ID 集合为空，不能等同于“未上传”。只有成功接通并查明无文件时才是 `missing`；非空真实文件引用才是 `available`。

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
