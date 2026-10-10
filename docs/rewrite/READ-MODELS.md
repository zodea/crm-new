# A03 读模型、DTO 与页面状态

<a id="前后端读模型与-dto-语义基线"></a>

本文是 **A03 确认后的目标设计**，指导后续开发；不因旧文档、现有 DTO 或已合并代码而推定目标能力已实现。当前实现、待实施差异和历史证据集中在[实现差异](#implementation-gaps)。

本文唯一维护公共 DTO、标量、Problem、分页一致性、权限、可空值、完整度和读状态。业务实体及公式见 [DATABASE](./DATABASE.md)，环境、模块 owner 和隔离见 [ARCHITECTURE](./ARCHITECTURE.md#data-ownership)，写信封、幂等、冲突和成功恢复见 [COMMANDS](./COMMANDS.md#command-envelope)，语义目标和返回上下文见 [NAVIGATION](./NAVIGATION.md)。领域章节仅保留差异和必要来源，不另定义公共协议。

## 1. 边界与分级

读接口返回当前授权范围内可证明的事实、版本和缺口。读取不保存输入、不核验资料、不占号、不发放、不归档；使用 POST 承载大型预览正文仍是只读操作。实体是否存在、关系是否可读、计算是否完整和允许哪些动作分别表达。

历史 A/B/C 分类仅用于理解旧接入证据：A 为已有稳定身份/事实，B 为 canonical 关系或来源缺口，C 为文件/OCR/导入导出专用边界。它们不是新的实现验收等级，也不证明某领域已正式可用。现行运行范围只见 [ARCHITECTURE](./ARCHITECTURE.md#runtime-environments)。

<a id="shared-dto"></a>
## 2. 共享语义类型

以下类型是目标语义示意，具体 operation 的可执行 schema 由所属领域维护。采用公共语义和 Problem 协议，领域 payload、变体及兼容 adapter 可以不同；不强迫所有领域使用相同字段，也不另建一套 HTTP 读取错误协议。升级须显式解码版本，旧载荷缺字段只有存在已确认的兼容含义时才归一；不能以默认值修复未知事实。

~~~ts
type OpaqueIdDTO = string
type BusinessCodeDTO = string
type DataOriginDTO = 'real' | 'demo'
type ISODateDTO = string // YYYY-MM-DD，真实日历日期
type ISODateTimeDTO = string // ISO-8601，明确时区或 UTC
type YearMonthDTO = string // YYYY-MM
type CountDTO = number // 非负安全整数
type BoolDTO = boolean

interface AuthorizedScopeDTO {
  coverage: 'complete' | 'permission-filtered' | 'unknown'
  fingerprint: string // 不透明范围标识，不泄漏受限记录
}
interface SourceEvidenceDTO {
  key: string // 稳定来源 key
  state: 'readable' | 'forbidden' | 'unavailable' | 'not-requested'
  sourceVersion: string | null
  asOf: ISODateTimeDTO | null
}
interface ReadMetaDTO {
  schemaVersion: string
  workspaceId: OpaqueIdDTO
  actorId: OpaqueIdDTO
  dataOrigin: DataOriginDTO
  asOf: ISODateTimeDTO
  sourceVersion: string | null // 本次实际组合来源的不透明版本
  sources: SourceEvidenceDTO[]
  authorizedScope: AuthorizedScopeDTO
  capabilities: string[]
}
~~~

身份至少以工作区、来源、实体 kind 和稳定 ID 解释；记录、配置、新稿、冻结、原件各有自己的身份，不能互换。metadata 不代替实体 payload 的身份校验。decoder 校验目标、父链、variant、来源、当前会话、唯一关系和字段边界；不完整或串目标响应不得进入可信状态。原始证据 JSON 保留原文，与用于本代显示的类型化投影分开。

authorizedScope 的 complete 表示已覆盖声明的请求业务范围，permission-filtered 表示仅当前可见子集，unknown 表示范围证明不足；它不代替来源可用性或计算完整度。各子区另声明自己的范围。授权可见小计即使计算 complete 也只能标“当前可见范围”，不能贴“全项目/企业总额”；不得输出受限记录的数量或以差额反推隐藏金额。

sourceVersion 由真实参与来源组成，不能用客户端生成值、实体 updatedAt 或仅一个主表修订冒充组合来源。asOf 是本次一致读取时点；冻结/归档的业务时点在 payload 中另列。不能在未读某来源时声称它已完整。依赖版本在写动作中如何判定冲突由 [COMMANDS](./COMMANDS.md#version-and-dependency-checks) 裁定，版本变化本身不一律阻断业务。

<a id="scalar-semantics"></a>
### 2.1 标量

~~~ts
type DecimalDTO = string // 无科学计数法的十进制字符串
type MoneyDTO = DecimalDTO
type QuantityDTO = DecimalDTO
type RateDTO = DecimalDTO
type RatioDTO = DecimalDTO
~~~

金额、数量、费率、工时和比例在 DTO 中使用十进制字符串，不含千位符、货币符号或百分号。金额结果沿领域既定结算/舍入口径；工资最终金额按两位小数传输，页面加千位分隔显示。原单价、费率、工时和数量保留可证明精度，不能先舍入再乘；不新增数量统一六位上限，不把费率截成金额精度。比例的合法范围由指标定义，可能为负或超过 100%，不能通用限制成 0..1。计数是安全整数；金额按整数分分配的工资算法仍在领域内使用既定整数分。

例如日薪 481 元、正常工时 8 小时、另计工时 2 小时：单价保留 `481 ÷ 8 = 60.125`，另计金额为 `120.25`，合计 `601.25`；不能先把单价舍入成 `60.13`，得到不同的 `601.26`。工资金额 DTO `"1234.50"` 在页面显示为 `1,234.50`，展示分隔符不进入保存值。

当前 SQLite REAL、整数分和历史 JSON 是实现及证据，不因 DTO 改成字符串而完成存储迁移。adapter 将有限数值按其已证精度展开，例如 0.0000001；金额边界按领域规则处理，原 JSON/审计原文不递归重写。拒绝非有限数和非法数字字符串，不用浮点绝对相等或 Number(value) || 0 判断业务。

编号、税号、银行账号、电话和外部键为字符串并保留前导零。缺失日期为 null；业务日与事件时间分开。证照按[上海业务日](#supplier-expiry-warnings)，排程 today 按其领域已确认的客户端运行日，不能偷换为部署服务器 UTC 日期。枚举传已确认 canonical code；当前中文 code 可以保留，显示标签、颜色和按钮不能成为身份，改 code 须显式迁移。

### 2.2 关系引用

~~~ts
type EntityKindDTO
  = | 'project' | 'customer' | 'supplier' | 'crew' | 'worker'
    | 'contract' | 'settlement' | 'owner-document' | 'subcontract-document'
    | 'invoice-application' | 'invoice' | 'receipt' | 'current-transaction'
    | 'payment-application' | 'payment-record' | 'expense-reimbursement'
    | 'material' | 'material-document' | 'delivery-record' | 'warehouse'
    | 'wage-statement' | 'wage-adjustment' | 'wage-actual' | 'attendance' | 'daywork'
    | 'schedule-group' | 'schedule-task' | 'process-library'
    | 'quantity-unit' | 'target-cost' | 'file'

type EntityRefDTO
  = | { state: 'resolved', entity: EntityKindDTO, id: OpaqueIdDTO, label: string, no: BusinessCodeDTO | null }
    | { state: 'missing', entity: EntityKindDTO, id: null, label: null, reason: 'not-configured' | 'not-recorded' | 'not-applicable' }
    | { state: 'forbidden', entity: EntityKindDTO, id: null, label: null, reason: 'permission-denied' }
    | { state: 'unavailable', entity: EntityKindDTO, id: null, label: null, reason: 'source-unavailable' }
~~~

实体存在而子集合确为 0 条，引用仍 resolved；父关系未配置与整源故障分别表达。禁止按名称、同项目、用途文本、金额近似或历史路径猜关系。kind 是允许解释的词表，不代表仓库等每一种实体已经实施。

DTO 不下发 Vue 路由字符串；语义目标使用 [NavigationIntentDTO](./NAVIGATION.md)，经唯一 Target Registry 解析。合同需 canonical contractKind，来源须与 subject 一致；无有效目标/权限则显示普通文本和原因。聚合是否可点由已验证 drilldown 决定，不由金额是否大于零决定。

<a id="pagination-and-consistency"></a>
### 2.3 分页、筛选、排序与汇总

~~~ts
interface SortDTO { field: string, direction: 'asc' | 'desc' }
interface PaginationDTO {
  requestedPage: number // 合法请求页，从 1 开始
  page: number // 实际页；越界回最后页，空结果为 1
  pageSize: number
  total: CountDTO // 当前授权且同筛选的总行数
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
  meta: ReadMetaDTO
}
~~~

每个 operation 定义强类型筛选、排序和列条件白名单、搜索字段及匹配方式，实体条件只收稳定 ID。搜索、列条件、工具栏条件和排序消费同一个查询；同字段枚举多选取并集，不同字段条件取交集，空选择表示不限，领域明确的兼容解码另按该领域处理。远程分页必须查询当前业务范围的完整集合，普通翻页每次到后台重读一页；仅已证明完整的本地小集合可在本地执行等价查询。同一响应的行、分页总数、汇总、facet 及相关来源须来自一致读取。汇总先按同一完整授权筛选集计算再分页，不以当前页求和。排序追加稳定来源和 ID 次序，按原日期、枚举 code、decimal 语义排序；未知值的位置由领域明确规定。

API 拒绝非法页码/页大小/排序/筛选载荷并返回 invalid-query；前端可在恢复旧 URL/本地筛选时按公开白名单 normalize 后再发请求，不把非法请求解释为成功。页大小支持既有 10/20/50/100。合法页码超过末页自动回最后页，同时返回 requestedPage 与实际 page；空结果 page=1，并保留筛选。无业务数据、筛选无命中和缺必需关系分别说明。

全量候选、导出和跨页分析不能拼接不同 sourceVersion 或授权范围的页。需完整集合的 operation 使用同一快照/一致读取证明；分页累计发现版本变化、缺页、重复身份、读取失败或权限变化时停止并重新读取，未完成前不能选择或输出为完整集合。普通分页不会承诺所有历史页永久同一快照。

导出固定点击时的查询、排序和授权范围，默认输出该查询的完整匹配集合；领域支持勾选导出时另明确范围与数量，不把当前页切片当全部结果。筛选或排序变化回第 1 页，普通翻页和每页条数变化保留条件；刷新重读当前查询并由合法越界规则修正页码。来源返回后的查询恢复只见 [NAVIGATION](./NAVIGATION.md#21-返回上下文)，控件应用时机与中文输入处理只见 [DESIGN-SYSTEM](./DESIGN-SYSTEM.md)。

例如每页 2 条，原排序为 `A、B、C、D`，第一页读取 `A、B` 后插入了排在最前的 `X`；普通第二页重读当前集合，得到 `B、C`，这是当前第二页的有效结果。若任务是收集完整候选或导出，则不能把两次结果拼成 `A、B、B、C`；应停止累计，重新取得能证明一致的完整集合。

includeDemo 默认 false 且须服务端 demo:read；每行来源由后台确定。正式/演示的数量、金额、完整度分别汇总，不提供混合业务总额，不以演示补正式缺口。facet 在同一集合上保留其他条件、去掉自己的选中条件，不能来自当前页。

<a id="read-status-and-completeness"></a>
### 2.4 可空值与聚合完整性

读取状态、计算完整度和授权范围是三个独立维度。ready 不代表全量可见或计算完整；permission-filtered 不等于计算 partial；父主档可读不代表子域可读。

~~~ts
type CompletenessDTO = 'complete' | 'partial' | 'pending' | 'not-applicable' | 'undefined'
interface MetricDTO {
  value: MoneyDTO | QuantityDTO | RatioDTO | CountDTO | null
  knownValue: MoneyDTO | QuantityDTO | RatioDTO | CountDTO | null
  unit: 'CNY' | 'quantity' | 'ratio' | 'count'
  quantityUnit: string | null
  status: CompletenessDTO
  missingSources: string[]
  participatingCount: CountDTO | null
  missingCount: CountDTO | null
  asOf: ISODateTimeDTO
  drilldown: NavigationIntentDTO | null
}
type ReadState<T>
  = | { kind: 'idle' }
    | { kind: 'loading', previous: T | null }
    | { kind: 'ready', data: T }
    | { kind: 'empty', data: T, empty: EmptyDTO }
    | { kind: 'forbidden', problem: ProblemDTO }
    | { kind: 'not-found', problem: ProblemDTO }
    | { kind: 'mismatch', problem: ProblemDTO }
    | { kind: 'unavailable', problem: ProblemDTO, previous: T | null }
    | { kind: 'error', problem: ProblemDTO, previous: T | null }
~~~

- value 是所声明计算范围的完整值；无法完整计算为 null。knownValue 是可证明的已知部分，不冒充全量，也不把不可见记录数量/金额反推给用户。complete 可令 knownValue=value；比例等不能合法合并的“已知部分”仍为 null。
- partial 表示参与来源中部分未知；pending 表示尚待取得/核验；not-applicable 表示不适用；undefined 表示定义无法产生数值，例如分母为 0。缺口要有来源原因，不能只给一个含混状态。
- null 是适用字段未知或不可算，真实已知零才传零。变体不适用字段在该变体 schema 中省略；适用但未知字段显式 null。缺日期、数量、税点、人员分配不能补默认零。
- 数组只有已成功读取且确无记录时才代表真实空。子域独立返回 ready/empty/forbidden/unavailable 等状态；旧 adapter 若保留 items=[] + 子域 Problem，必须先据 Problem 呈现，不能把该数组展示为“暂无”。
- 授权集合的计数、行、汇总保持一致，标明 authorizedScope。受限单行排除且不提供占位身份/数量；整源无权/不可用时相关指标为 null，独立可读主档和其他分区仍可读。
- 数量按明确单位分组，同单位且身份去重后聚合，三量分别保持缺失，不跨基准补值。返回参与/缺项数和已知小计；缺单位使对应完整值和已知部分均未知。工程量规则见[页面蓝本](./pages/subcontract-quantity.md#六详情与施工记录)。
- 付款批复另带 not-entered / known / legacy-unknown，银行实付独立；业务来源/余额只见 [DATABASE 支付记录](./DATABASE.md#entity-payment-record)。合同金额录入的已确认空税率规则不能推广为票据、价格对比或真实税负的未知税率默认值。

<a id="permissions-and-stale-data"></a>
### 2.5 错误、权限和并发

读取请求绑定当前 actor、工作区、目标、来源和读取代次。切换目标/来源、撤权、退出或失效后清除敏感事实和候选；最后异步等待后再次核验，迟到响应不得显示、下载或覆盖输入。同 cookie 多窗口是同一登录；新独立登录使旧登录失效，运行边界见 [ARCHITECTURE](./ARCHITECTURE.md#runtime-environments)。

可在**同用户、同目标、同来源、同授权范围**保留上次读数据，并显著标明旧数据和读取失败/加载中。查询变化期间保留旧表格时，旧行、数量、汇总和 facet 仍属于旧查询，不能标成新查询成功；只有当前读取代次能一次发布新的完整响应。旧数据仅供查看，不能作为候选、新写依据或导出完整结果。权限/来源改变时不能沿用；冻结历史本身可独立通过本次授权读取，不能拿当前读失败把旧当前状态标成最新。当前输入与最小原命令恢复描述按 [COMMANDS](./COMMANDS.md#draft-lifecycle) 保留，不能以缓存事实代替原键恢复。

<a id="problem-semantics"></a>
#### 公共 Problem 与 HTTP 对应

~~~ts
interface ProblemDTO {
  code: 'invalid-query' | 'unauthenticated' | 'forbidden' | 'not-found'
    | 'relationship-mismatch' | 'validation-failed' | 'stale-source'
    | 'conflict' | 'unavailable' | 'internal-error'
  message: string
  retryable: boolean
  fieldErrors: Record<string, string[]>
  traceId: string | null
}
~~~

| HTTP | Problem code | 含义 |
| --- | --- | --- |
| 400 | invalid-query | 查询语法、白名单或载荷错误 |
| 401 | unauthenticated | 未登录、登录到期或已被新登录替换 |
| 403 | forbidden | 当前读取能力不足 |
| 404 | not-found / relationship-mismatch | 实体不存在或父链错配；按授权避免存在性泄漏 |
| 409 | conflict / stale-source | 领域写约束或依赖依据冲突 |
| 422 | validation-failed | 领域字段校验失败 |
| 503 | unavailable | 来源/服务暂不可用，可否重试以 retryable 为准 |
| 500 | internal-error | 未分类故障，返回可追踪且不泄密的说明 |

HTTP adapter、领域 Repository 和显式本地 adapter 均映射此语义；网络失败可以生成本地 Problem，但不能伪造后台成功。页面保留合法筛选和适用重试入口，错误不降格为空。原命令结果查询的 not-found 不证明未应用；封存与恢复唯一见 [COMMANDS](./COMMANDS.md#idempotency-and-recovery)。

<a id="domain-projections"></a>
## 3. 页面域的 DTO 映射

下表覆盖整个 A03 页面域；稳定编码供运行参考矩阵和导航覆盖检查使用，中文名称不作为新实体身份；不以固定路由数量代替功能覆盖。业务字段、适用变体、公式和允许动作沿 A01/A02 已确认蓝本；读模型统一引用[公共 DTO](#shared-dto)。历史运行面复核见 [#403](https://github.com/zodea/crm-new/issues/403) 与[运行记录](../design/runtime-reference-audit.md)，当前接入另见[实现差异](#implementation-gaps)。

| 稳定编码 | 页面域 | 目标投影与领域差异 | 业务权威来源 |
| --- | --- | --- | --- |
| `home` | 首页 | 明确当前项目、WBS 分组/任务、计划/实际进度及空排程；无项目不选首项 | [首页](./pages/homepage-dashboard.md) |
| `project` | 项目 | 稳定身份、主/次客户、阶段和独立十个资料分区；经营指标分别说明计算和授权范围，文本人员不猜 ID | [项目](./pages/project-info.md) |
| `master-data` | 基础主数据 | 客户/班组/工人主档及独立关系；个人实发缺分配不从整单猜；工人 currentProject 不是删除祖先 | [客户](./pages/base-customer.md)、[班组](./pages/base-crew.md)、[工人](./pages/base-worker.md) |
| `supplier` | 分供方 | 主档、资料核验与证照独立；敏感资料先授权再检索；合同/结算/收票/付款按各源解释 | [分供方](./pages/base-supplier.md) |
| `project-supplier` | 项目分供方 | 项目×分供方双 ID、六类事实、合作档案；草稿文件分类与已提交事实分开 | [项目分供方](./pages/project-supplier.md) |
| `core-contract` | 核心合同 | 材采/施工/分包独立变体、补充协议、BOQ、关联单据；原金额/有效补充/有效总额分别可空 | [合同](./pages/contract-forms.md)、[甲方单据](./pages/owner-documents.md) |
| `aux-contract` | 辅助合同与结算 | 公司/其他支出合同与其他结算专属字段；不存在业务行实体时不虚构 lineItems | [合同](./pages/contract-forms.md) |
| `owner-document` | 甲方单据 | 变洽签、月报、验收/保修、最终结算、罚扣及补充协议各自身份；双视图共用 canonical 事实 | [甲方单据](./pages/owner-documents.md) |
| `subcontract-document` | 分包单据 | 分包变更、结算、项目罚扣专属金额/审批/审定价与抵扣整改；不复用甲方金额 | [单据](./pages/owner-documents.md) |
| `material` | 自购材 | 下料、到货、领用、盘点及真实库存/结算；只读反向关系引用同一送货明细事实 | [材料](./pages/material-management.md) |
| `owner-material` | 甲供材 | 总控计划头/行、下料、到货、领用、直入直出；供货 Party 不冒用项目客户，单据量基准不跨量补值 | [材料](./pages/material-management.md)、[DATABASE 物资关系](./DATABASE.md#已确认目标关系与迁移边界) |
| `delivery` | 送货单闭环 | 处理/归档、当前/历史修订、整张有效性与原件；正文在专用边界读取 | [送货](./pages/material-delivery.md) |
| `material-price` | 材料价格 | 询价报价、合同约定、实际送货分来源序列，不能以一份历史价覆盖其他来源 | [材料](./pages/material-management.md)、[价格投影](#price-comparison-projection) |
| `finance-income` | 收入财务 | 开票申请、普通/其他收款和往来各自性质；真实付款人和现金来源不能因无新增路由丢失 | [开票](./pages/finance-billing.md)、[收款](./pages/finance-receipt.md)、[现金来源](./DATABASE.md#410-资金计算) |
| `finance-expense` | 支出财务 | 申请、批复、支付、报销和分摊独立；未填/历史未知/真实零区分，工资实际区域独立 | [付款](./pages/finance-payment.md)、[记录](./pages/finance-records.md)、[报销](./pages/finance-reimbursement.md) |
| `invoice` | 发票台账 | 识别候选/置信度、原始票面、人工核实、归属与归档独立；reviewStatus 与 accountStatus 分开 | [发票](./pages/finance-invoice.md) |
| `quantity-payroll` | 工程量与工资 | 三量/模板/责任/完成、A/C1/C2、考勤、签工、原件冻结；B 历史隔离，缺量不补零 | [工程量](./pages/subcontract-quantity.md)、[工资](./pages/subcontract-payroll.md) |
| `schedule-target-cost` | 项目进度成本 | WBS、标准版本、冻结楼层、绑定证据；预算/合同承诺/结算成本/实付独立 | [排程](./pages/schedule-progress.md)、[成本](./pages/target-cost.md) |
| `import-export` | 导入导出 | 候选/行错误/批次/对账/映射/结果引用；原始文件和整库字节留专用追溯边界 | [BOQ 导入](./pages/boq-import.md)、[实票参考](./pages/real-ticket-excel-reference.md)、[迁移](../guides/local-data-migration.md) |
| `ocr-settings` | 系统设置 | 沿历史保留稳定域编码；OCR 非敏感能力/超时/阈值与结果，私密 Token/地址不进 DTO；我方主体独立 catalog 提供真实资料、核实版本/历史、停用状态及可信读权限，合同显示采用时快照 | [架构](./ARCHITECTURE.md#our-signatories)、[主体物理归属](./DATABASE.md#our-signatory-storage)、[票据](./pages/finance-invoice.md) |

### 主合同身份与同号核对

合同明确我方签约主体稳定 ID，并呈现签约快照；补充协议继承父合同主体和父号检索关系，自身仍有独立 ID。主体 owner 与设置边界只见 [ARCHITECTURE](./ARCHITECTURE.md#our-signatories)。

重复核对投影包含当前输入和命中合同的两侧公司、项目、种类、状态、原金额、有效补充额、有效总额。后三项逐项 nullable 并附来源/完整度，不能把未知当零或沿用别种金额；无权字段按公共权限规则保护。后台给出可证明的重复事实和稳定命中身份，不用名称或金额猜唯一性。草稿提醒、正式阻断、历史占号和自身排除规则只见 [COMMANDS](./COMMANDS.md#contract-number-uniqueness)。核对失败或命中不得清当前输入。

### 项目经营、税票与现金来源

经营投影提供定义、来源时间、已知部分与缺口，可追到实际源单。管理费主展示已核实实际成本并按来源展开，合同记取和实际收付分别列示；原件、费用行、工资个人分配和更正链不重复计成本。目标/承诺/结算/实付保留独立口径，不把暂估或申请当确认事实。

真实税务按主体、期间和计税方法呈现应纳、申报、实缴及迟票缺口；项目票面差额仅是其本身指标。票据保留原票面字段和人工核实状态，含税收票使用 total_amount，DATABASE 既定不含税票额另保持原义。核实投影不能静默修改原发票或报价；具体业务公式引用 [DATABASE 经营事实来源](./DATABASE.md#operating-calculations)。

项目现金投影纳入 A02 已确认的保证金、备用金、其他收款等真实来源及发生日/方向/付款人；备用金申请不是实拨。来源尚未实施保持未知并给缺口，不因没有独立页面而缩减现金范围。

<a id="price-comparison-projection"></a>
### 历史价格与当前价对比

每条价格事实分别返回来源类型（询价报价/合同约定/实际送货）、原记录及行身份、业务日期、材料/规格/单位、报价方或供应方引用、项目范围、单价、税点及含税口径、当前有效状态和来源版本。未签报价仍能作为报价来源显示；报价方尚未核实稳定关系时引用可空，不按名称转成正式分供方。

序列按来源展示，只有材料、规格、单位及税口径可核实相容时才计算差异；缺税点或单位时保留事实并解释不可比较，不能默认同税/同单位。当前有效合同价与旧送货价分别存在。降价提醒携带比较双方、差异依据和待协商状态，不作为覆盖旧行的动作；涨价、协商和真实更正的写规则只见 [COMMANDS](./COMMANDS.md#price-basis-and-corrections)。本节目标包括三类来源，当前送货/合同分析不能作为报价来源已实施的证明。
### 工程量中央读取与甲方月报（#442）

浏览器正式工程量由专用中央 Repository 读取区域、模板、三量、阶段及报量映射、当前责任、阶段完成、照片和量差。请求绑定当前会话、项目、来源及权限；分页候选必须完整读取后才能成为选择或导出依据。同 ID 的演示与正式来源不能共享草稿或读取结果；离页及切换来源后的迟到响应必须丢弃。显式桌面 SQLite 适配和受控迁移输入保留独立边界，不作为浏览器读取失败的回退源。

合同清单由中央施工合同与已签证变洽签提供稳定 BOQ 身份、有效量价与来源版本；工程量库仅保存外部身份索引，不复制一套合同量价。首次明确关联清单行才更新模板的认定合同量；后续普通编辑保持已有认定值，量差中的已签证增减量只计一次。合同量、暂估量、现场复核量各自允许 `null` 和显式 `0`，汇总同时返回已知小计和缺失项数，不跨基准补值。

甲方月报按所选期次、户的有效模板及分项唯一报量阶段读取已完成事实。未提交预览使用当前已签证有效单价及真实来源版本，重算金额时保留手工申报量；已提交按原冻结的三量基准、自动量、申报量、有效价与来源版本读取，不随模板或 BOQ 新版本漂移。价变复算及提交依赖核对的写规则唯一见 [COMMANDS](./COMMANDS.md#version-and-dependency-checks)，不能把正常有效价变化显示为人工冲突。切换数量基准的既定确认/清旧手工量另保持原义；缺量未明确填写仍待核对。历史验证见 [#442 证据](../design/evidence/issue-442/)。

活跃户的模板明细已经关联当前 BOQ、却没有可见同项目同工种报量映射时，自动取数与申报必须明确报错并引导先配置阶段，不返回一个可被解释为完整零量的空事实。未挂接实际户的候选模板不触发此阻断；映射有效但所选月份确无完成记录时仍为真实零。

### 标准工序库中央读取（#443）

`GET /api/read/process-libraries` 与 `GET /api/read/process-libraries/:id` 读取同一授权工作区内的版本目录与指定不可变版本。列表、整页来源及 WBS 工序库候选沿同一 Repository 消费；正式空态不以演示模板填补，失败撤下候选和写入资格，旧只读数据仅按[公共旧数据规则](#permissions-and-stale-data)展示。目录带当前身份、能力、来源与同编码系列保存基准；已删除版本不作为可使用正文返回，但其版本号不能被重新分配。

版本使用项目及数量读取当前中央 WBS，创建、迁入和合法移除后随事实更新；不可读取时保持 `null` 和未知说明，不能当作“尚未引用”。库名、库版本、工序 key 与前置禁用状态保持原身份；阶段码/分项码只解释全局定义，不从显示名猜某项目映射。本读取不生成排程完成事实。

### 中央 WBS 读取（#444）

`GET /api/read/schedule/catalog` 提供授权项目目录，`GET /api/read/schedule/workspace` 提供指定项目排程、合同与楼栋候选，`GET /api/read/schedule/scope` 提供逐栋内部暂估范围核验。请求明确项目、来源及适用筛选；后台使用 `schedule:read` 和当前会话复验项目及来源身份。返回包含当前身份、来源、能力和 `sourceVersion`；来源版本共同覆盖工程量、WBS、项目/合同清单及工序库事实。字段定义以领域契约为准，不把显示名称用作关联。

独立排程与首页投影读取同一份正式 WBS。显式 `from=home` 保持只读来源入口；仅带 `origin` 的独立排程地址不能因此退化为首页入口。正式空项目返回确实未建计划，无权、错配或失败均单独说明，不退回本地首个项目。演示读取须已获服务端授权并明确开启，沿隔离只读适配，不进入正式命令源。

客户端把用户本机运行日作为 `today` 传入，后台严格校验真实日历日期；首页与独立页按同一运行日计算时间轴及工期加权偏差，不以部署服务器 UTC 日期替换用户日期。自动进度只计算当前任务阶段、组内楼栋和有效模板适用范围内应做户与已完成户的交集；最早完成日为实际开始，全部应做户完成后才有实际完成日。无计量来源任务使用手工进度，不能生成虚假的自动完成入口。

暂估预览分别返回有效范围、已知小计和缺失情况，按单位汇总；楼层读取保留冻结来源、人工计划和已有合同绑定历史，当前模板或失效 BOQ 不覆盖历史快照。排程、矩阵及户详情往返使用同一来源链并保留有效筛选；冷刷新或关系失效时重验稳定身份，不扩大成全部范围。写入与迁移见 [COMMANDS](./COMMANDS.md#中央-wbs-命令444) 及 [DATABASE](./DATABASE.md#中央-wbs-事实与整图接管444)，实际验证见 [#444 证据](../design/evidence/issue-444/README.md)。

本机正式读取来自同一 `wbs`、`quantity`、项目和不可变工序库 owner；内部暂估与冻结楼层按真实零、缺量及单位分别返回，当前模板不回填历史。合同候选和新绑定来源明确不可用，历史合同/BOQ ID 仅用于追溯，不能冒充现行主档。原文件读取核对分组或任务的真实项目归属、来源路径、原字节与摘要；缺件和坏件分别处理。迁入读取保留已恢复批次及原回执，恢复不删除原件或审计。正式接入范围以 [ARCHITECTURE](./ARCHITECTURE.md#opt-02-scope-decision)为准，不由开发首页或历史中央证据扩大。

### 中央暂估绑定与楼栋证据读取（#445）

`GET /api/read/schedule/binding` 使用当前项目、分组、合同选择与来源，返回未绑定预览或已绑定的真实记录。预览按显式楼栋与稳定分项关系读取当前合同清单，逐栋区分覆盖、缺覆盖与额外范围；暂估依据来自已有楼层冻结快照，不读取当前模板回填。分项按单位分别呈现合同量、冻结暂估量、完整度和可计算差异；缺量保留已知部分，真实零仍是确定值。

已绑定时只读合同依据、绑定时间及可识别的绑定时比较。旧历史缺少比较或单位/逐户证据时明确历史不足，不用当前清单重造旧差异。读取核验项目、来源和当前能力；合同或分组错配不按同名关系回退。

`GET /api/read/boq/building-context` 提供同项目合同的当前清单行、合法楼栋候选和楼栋更正审计；原始与已签证生效量价分别保持原有意义。行来源区分已确认导入基准、签证新增和未知，并给出只读原因。绑定页进入独立更正整页，返回恢复原项目、分组、合同选择与有效排程来源；保存后必须重新生成预览。写态不登记为刷新自动恢复的只读页签，页面切换后的迟到结果不能替换新目标。命令与历史保护见 [COMMANDS](./COMMANDS.md#中央暂估绑定与合同楼栋证据更正445) 及 [DATABASE](./DATABASE.md#中央暂估绑定与楼栋证据445)。

### 3.2 跨路由公共读模型

跨路由公共能力不增加生产路由计数，但必须使用与 20 个页面域相同的身份、金额、权限和完整度语义。参考站当前直接证据只证明付款申请详情挂载智能业务洞察；付款申请列表、付款管理/支付记录列表、材料采购合同详情和开票申请详情均未挂载。最终挂载、消息扇出和页签恢复矩阵见 [`PUBLIC-SURFACES.md`](./PUBLIC-SURFACES.md)，蓝色报表行目标见 [`NAVIGATION.md`](./NAVIGATION.md)。

#### 智能业务洞察

洞察有当前单据上下文和独立计算范围。挂载矩阵见 [PUBLIC-SURFACES](./PUBLIC-SURFACES.md)，导航只用 [NAVIGATION](./NAVIGATION.md)；参考 L2 标签和私有配置不是本地接口身份。

~~~ts
type InsightScopeLevelDTO
  = | 'record' | 'contract' | 'project' | 'supplier'
    | 'cross-project' | 'enterprise-visible'
interface InsightScopeDTO { level: InsightScopeLevelDTO, anchor: EntityRefDTO }
interface InsightAvailabilityDTO {
  key: string
  metadataKey: string
  position: 'detail'
  subject: EntityRefDTO
  availability: 'available' | 'unavailable' | 'forbidden'
  suiteVersion: string | null
  meta: ReadMetaDTO
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
  meta: ReadMetaDTO | null
}
interface InsightDTO<Row = Record<string, unknown>> {
  key: string
  subject: EntityRefDTO
  scope: InsightScopeDTO
  attentionCount: CountDTO
  sections: InsightSectionDTO<Row>[]
  meta: ReadMetaDTO
}
~~~

先按 metadataKey + position + subject 读取可用性，available 才挂载。无规则 no-rule 既不算通过也不算失败；规则结果、度量完整度和授权范围分别解释。跨项目/企业可见报表的行和汇总受同一权限过滤，不能宣称企业全量。每个子区有自己的读状态及 scope，未读、无权、不可用与真实空报表分开。

<a id="insight-cache-identity"></a>
记录指标缓存包含工作区、actor、origin、授权范围，以及 `subject.id + sourceVersion`；跨项目/企业可见报表另外包含 `report.key + visibility fingerprint + asOf + sourceVersion`。缓存按当前单据/合同指标与跨域报表拆层，不按整个项目复用上一付款单指标，不重复获取同一已证全局报表。页签数量、显示项目名和上一单据均不构成缓存身份；重新读取与旧数据展示沿[公共规则](#permissions-and-stale-data)，缓存不得增加读取能力。宿主开合与活动生命周期只见 [PUBLIC-SURFACES](./PUBLIC-SURFACES.md#52-后台活动约束)。当前面板及缺口集中见[实现差异](#implementation-gaps)。

#### 全局通知与抄送事件

toast、顶栏未读数、inbox 消费同一稳定事件，传输可以用实时增量触发并以分页查询对账。通知投影包含 eventId、eventType、kind(todo/notice)、标题/摘要、受控 subject/actor、业务 result、occurredAt、readAt、语义 target 及目标解析状态。通知事件身份、业务问题状态和已读状态分开；证照的持续提醒扩展只见[证照预警](#supplier-expiry-warnings)。

NotificationOpenResultDTO 返回 {eventId,readAt,target}；target 为 resolved(intent)、forbidden 或 missing 的受控结果。事件去重、toast 呈现、单条打开与全部已读的用户动作唯一见 [PUBLIC-SURFACES](./PUBLIC-SURFACES.md#4-全局审批与抄送消息)，写入仍经 [COMMANDS](./COMMANDS.md#idempotency-and-recovery)。读取接口不修改 readAt。

目标失效/无权时可以保留经授权脱敏的事件事实，并明确解析问题，不伪装为正常可达。静态演示事件和真实来源隔离，不能补正式消息源。
### 3.3 分供方列表查询与跨域事实

分供方列表、详情和表单预载沿同一 `dataOrigin + supplierId` 读取主档；新增 `laborScope` 进入同一读取和查询投影，旧载荷缺少该字段时归一为空文本。字段词义、持久化及界面列序分别只见 [CONTEXT.md](../../CONTEXT.md)、[DATABASE.md](./DATABASE.md) 和[页面蓝本](./pages/base-supplier.md)，不在此复制字段表。可执行类型与查询白名单位于 [`read-contract.ts`](../../app/lib/supplier/read-contract.ts)，边界解码位于 [`read-decoder.ts`](../../app/lib/supplier/read-decoder.ts)。

- 查询保留原有关键词、类别、资料状态、排序、分页和来源开关；`columnFilters` 在 HTTP 查询参数中传 JSON，按 [`read-query.ts`](../../app/lib/supplier/read-query.ts) 归一。文本使用包含匹配，枚举允许单值或多值精确匹配（同字段 OR、跨字段 AND），数值范围包含两端；空条件不产生约束，未知字段、非法枚举载荷、非有限数值及反向区间返回 `invalid-query`。类别与资料状态兼容旧单值参数，多值使用 JSON 数组；详情返回保存同一语义。敏感列先按当前 capability 形成可见值，再参与关键词和列条件匹配，不允许通过筛选探测隐藏原值。
- 数值排序把未知值放在末尾，以稳定身份处理同值；隐藏列不清除已生效条件，返回列表时保留同一查询语义。分页、facet 和汇总只遵循[公共分页规则](#pagination-and-consistency)；前端恢复旧查询可 normalize，API 非法查询拒绝，不保留旧接口静默修正非法页码作为目标契约。
- 列表合同金额、累计合同金额、累计结算金额及对应详情金额允许 `MoneyDTO | null`，不能在 decoder 或展示层把 `null` 变为 `0.00`。参与汇总的源金额缺失时，列表值及该来源汇总保持 `null`，详情 `MetricDTO` 返回 `value=null + status=partial + missingSources`，保留可用的源记录核对入口。只有已读取且确实为空的集合可以计算为零；草稿、失效记录和确认条件按[页面蓝本的金额口径](./pages/base-supplier.md#七跨项目只读汇总)执行，累计指标不另存为主档余额。
- 跨域事实由各自 owner 的原始读源组合，材料采购合同及结算、分包合同有效增补及 sub_settlement、其他支出合同及其他结算分别保留来源。关系按同来源稳定身份连接，合同 canonical kind 不随中文类别改变。已接和缺源状态见[实现差异](#implementation-gaps)。
- 缺稳定分供方归属或申请分摊的发票/确认付款明确缺源；不能从合同旧累计字段、付款申请或其他票款摘要推造事实。指标不另存为主档余额。
- 关联项目无权时，普通响应的 `id/label` 都为空；不能只隐藏名称而把稳定 ID 留在响应或导航中。项目/合同整源不可用且存在原关系时返回 `unavailable/source-unavailable` 和 `not-connected` 导航，与成功读取后查明未记录分开；生产者、decoder 与关系入口使用同一四态契约。
- 营业执照使用 #446 中央证照专用文件来源。列表普通 DTO 只允许受控文件 ID 与状态，不能返回本地路径或正文；当前读取无权限或无法取得资料时返回 `unavailable`，计数为 `null`、ID 集合为空，不能等同于“未上传”。只有成功读取并查明无原件时才是 `missing`；非空真实正文引用才是 `available`。证照、主档详情和列表查询按同一业务日及当前凭证生成资料状态，再执行筛选与分页，不能从主档旧状态副本筛选。

### 3.4 分供方证照专用读取（#446）

`GET /api/read/supplier-credentials/:supplierId` 要求明确 `origin`，返回当前稳定分供方、主档版本、证照事实版本、服务端会话与能力、上海业务日、资料状态、历史人工核验凭证及独立当前资格、证照文件元数据、逐类别要求及可公开的专用审计。演示来源还必须显式 `includeDemo=true` 并具备后台 `demo:read`；返回只读能力，不能进入正式命令。当前原件与历史 OCR 正文仅在专用受控边界使用，不放入普通主档 DTO。当前资格投影遵循[证照预警](#supplier-expiry-warnings)，不删除历史 review。

`GET /api/read/supplier-credentials/:supplierId/files/:fileId` 另携明确 `credentialId` 和来源，重验当前主档、活跃证照及对应文件的所有权。正文可用时返回原字节及 SHA-256，客户端在预览/下载前核对长度与摘要；只有历史元数据而无正文时明确 `missing-payload`。已删除证照、错父记录、错原件或无权均拒绝，文件名、旧路径和猜测 ID 不授予读取权。

实际空集合、无原件、暂时不可用、无权、来源错配与记录失效分别表达；失败不降格为空态，正式读取不回旧浏览器 SQLite。专用 Repository 校验响应身份、字段和重复关系；页面请求绑定当前身份与读取代次，切换或取消后的迟到结果不显示、不下载、不覆盖输入。数据保全与状态依据见 [DATABASE](./DATABASE.md#分供方证照中央事实446)，写入与并发恢复见 [COMMANDS](./COMMANDS.md#分供方证照与人工核验命令446)。

Native v51 的人工历史由专用 owner 查询回读，当前指针与归档副本按原证明去重；v47–50 旧图保持原格式，v51–54 的历史图附真实物理身份、归档时间及中央映射身份。不会从已过期资料状态猜测原人工通过或退回，也不填造旧核验人。一次本机中央事务内的主档状态、资料状态、来源版本和 `asOf` 共享同一时刻，上海跨日后的新读取换来源版本，原事实修订不因 GET 推进。

Issue #447 在同一专用响应中返回当前识别快照、原始候选、置信度、待核对状态及独立的上次确认事实，供稍后核对和冷刷新恢复。正式来源且具备 `supplier:write` 时才额外提供用于人工比对的 `masterValues`，沿已有整页表单读取权限；普通列表与只读主档的敏感遮罩规则不变。可解析的历史待核对来源按旧字段原义投影，不能将旧 `uniqueCode` 静默解释为 `taxNo`；无法确认的旧格式与缺原件分别提示，不生成虚假确认入口。税务专用命令返回服务端核验五字段和提交版本，重新进入表单仍由同一中央主档读取。

<a id="supplier-expiry-warnings"></a>
### 分供方证照有效性与持续预警

本节是 A03 证照时效和提醒的唯一权威。资料是否具备、人工核验历史、当前有效性及预警是不同事实：新资料仍待人工核验；旧 review 只证明历史人工动作，不能证明变更后的资料已核实。

按 Asia/Shanghai 的业务日期，提前 **7 个自然日（含周末）**进入临期预警，即距到期 0..7 天；到期当天仍有效，次日才过期。原字段明确长期有效的证照按原长期规则处理，不产生虚假到期日期；本轮不新增 validFrom 生效门槛。坏/缺日期的展示保留未知与核对原因，不用日期默认值补齐，也不自行否定已有原件齐全或人工核验资格；未记录截止日期不新增失效门槛。

目标投影逐证照返回业务日、原到期/长期字段、当前有效性（有效/临期/过期/未知）、预警原因和相关核验历史；主档列表、筛选、详情、资料页使用同一当前业务日投影。GET 只计算状态，不持久撤销原核验、不写审计；真正资料变更和人工核验经 [COMMANDS](./COMMANDS.md#分供方证照与人工核验命令446)。

临期/过期主动进入应用 inbox，提供当前问题状态、首次发现/最近核对时点、当前严重度和资料入口。事件按供应方、证照及同一问题身份去重；继续临期、转过期、续期或补齐后，问题状态随事实更新。readAt 仅表示消息已读，已读不能把持续资料问题变成已解决；问题解除保留可追溯事件。用户刷新时返回当前问题状态和真实来源版本，不以此前 toast 或已读状态代替时效计算。

本机服务运行时按上海业务日重新评估；停机/离线期间不能承诺后台实时提醒，启动后补算当前问题并对账事件。范围仅应用 inbox，不扩展邮件、系统通知或新外部发送通道。当前时效计算、纯读取与事件接入状态见[实现差异](#implementation-gaps)。
### AX02 分包结算

`ownerCommercialDocumentRead` 的 `sub_settlement` 列表/详情使用专属 `SubcontractSettlementAmounts`，项目/合同/分供方与附件按真实 ID 读取。金额和空错权限语义见[页面蓝本](./pages/owner-documents.md#issue-328-分包结算中央只读链)，累计事实不复制到头记录。

### AX04 辅助合同中央读面

两类辅助合同列表、专属只读详情、项目/分供方来源入口使用同一领域读事实，采用公共 PageDTO 和独立分区状态；主链接不进入编辑。字段和金额口径仅见 [DATABASE](./DATABASE.md#ax04-辅助合同中央事实)，交互及 #330 历史实现见 [页面蓝本](./pages/contract-forms.md#ax04-当前浏览器实现330)。

### 目标成本中央读取（#412）

预算使用 `/api/read/target-costs`、`/api/read/target-costs/form`、`/api/read/target-costs/:id` 及所属版本文件读取端点。Repository 校验来源、会话、目标身份、金额/数量边界及语义导航；浏览器正式读取失败不退回旧库。列表在同一完整授权结果集内筛选和分页；版本头表单和明细页各保存独立读取依据。

预算读取权限与工程量权限分开。内部项目完整事实只用于复验身份及关联；公开项目 lookup 仍要求项目读取能力，不暴露内部目录。已授权预算可显示自身关联项目名称，项目及成本来源入口须核对目标能力并经 Target Registry 解析。来源返回使用受控项目、预算版本及 origin，不接受任意站内路径作为业务授权。

详情只读取指定版本的科目、附件及明确归属的历史；实际成本按该版本项目读取当前已接管事实，并有独立来源指纹。预算头录入金额、正式合同承诺、结算成本与支付分别显示，历史版本不换成当前基线科目。完整度、已知部分、缺源及真实零的含义引用[公共三维规则](#read-status-and-completeness)，业务来源引用 [DATABASE](./DATABASE.md#目标成本中央版本与完整接管412)。

原件只通过所属预算和文件身份读取，正文验证真实长度及摘要；历史未知大小仍保持空值，缺件与损坏分别说明。读态、多页签、异常恢复和五档视口的验收以 [#412 预算证据](../design/evidence/issue-412-target-cost/README.md)为准。本节不表示完整工资、材料、财务来源或生产持久化已经通过。

正式预算从同一磁盘 owner 读取并核对原版本图、原件正文及来源证据；GET 不初始化 schema 或同步项目。实际成本只消费已接正式 owner，未接来源有独立缺口，保已知部分和真实零；其版本不抬高版本头或科目草稿基准。限定迁入目录仅公开来源定位、对账及恢复状态，不向普通预算读面返回完整原库字节或跨域私密来源正文。

### 工资中央历史与独立来源读取（#412）

`/api/read/payroll`、`/api/read/payroll/:id` 和 `/api/read/payroll/sources` 分别提供台账、指定单据及指定项目的独立来源。Repository 固定 `workspaceId / actorId / origin / sourceVersion` 与 `payroll:read`，不借用工程量或排程权限。正式来源失败不回落本地；演示必须由后台授权且只读，同 ID 也与正式缓存隔离。读取结果不含可执行工资命令。

项目来源目录必须涵盖没有工资头、只有配置/考勤/签工的已接管项目；不以工资行集合证明项目资料不存在。台账在同一完整授权集合内组合筛选，来源查询固定项目并保留月份、班组；工资状态与签工确认状态各自恢复。未知项目深链明确失败，不自动换项目。当前资格在异步等待后重新核实，旧来源/目标的迟到结果不覆盖新页面。

已发详情分为冻结呈现与保存的原关系证据。冻结数据、原快照全文及未知扩展字段保留；缺/坏/部分和原表不一致分别诊断。历史量价、姓名、实际金额或分配缺失不得用当前档案补齐；合法零仍为零。原工资头和软删子表可追溯，避免把发放呈现中的未知误解为原记录也不存在。完整性的字段与关系规则见 [DATABASE](./DATABASE.md#工资完整资料中央接管412)。

独立来源提供主体配置、考勤、签工、可识别历史、月锁和签工占用。锁由工资状态及全体相关成员投影，不用正数金额、工时或明细行数替代成员存在性。B 类和缺证据的旧来源保持隔离，不给新核算、发放、输出或成本资格；接管只读本身不证明这些后续能力已完成。

### A 工资草稿、配置与冻结输出读取（#412，P1）

工资 Repository 扩展 `aForm / aConfig / aOutput`：`POST /api/read/payroll/a-form` 只读预览请求正文中的 `query + input`，避免完整草稿放入长 URL；`GET /api/read/payroll/a-config` 读取指定 `scope`；`GET /api/read/payroll/a-output` 按稳定 `statementId` 读取冻结输出。读取本身不保存草稿、改价或核对。P0 台账/历史与独立来源继续只读，不能由 A 的写能力反推全部工资来源可编辑。

草稿预览返回固定上下文、完整成员、原施工事实、按工资价格拆分的明细、比例默认值出处、各金额完整度、逐项阻断及允许动作。新建使用独立 `draftKey` 并允许逐步填写，已存工资始终按路径身份读取；输入、当前读取结果和保存依据分别保留。配置读取绑定项目、月份、班组与负责人，返回首月配置、可证明班组比例、工资价格修订及历史，不以当前全局筛选替代原读取目标。

新建尚未选择或明确清空项目、负责人、月份时仍可读取空预览及授权候选，保存保持阻断，不自动选取首项。项目候选由新建读取提供，不以历史工资台账是否已有记录决定首张工资可达性。缺损来源即使没有可核算行，也保留可证明的位置和原身份；只有目标项目、可见链及读取能力均通过时才提供原户链接，否则显示不可用原因。多户聚合行的每个来源保留自己的完成身份，返回后恢复对应楼层和焦点。responsibility assignment 和 copied_from 属原依据/审计关系，源软删不吞掉已证完成或复制件。

数值传输沿既有金额定点字符串规范，数量及比例使用明确十进制字符串；领域和页面解码后保留 null 与真实零。金额同时声明完整、部分或未知及已知部分；缺来源不能伪装空集合。比例默认值明确区分上月月度单、主体配置、真实班组配置、结算默认、固定尾款及未配置，具体继承规则只见[工资页面](./pages/subcontract-payroll.md#工资核算)。

新 A 输出只读取完整中央发放快照，状态为可用或不可用并附原因；姓名、成员含零、实际分配、明细和此前支付均来自发放时，不从当前档案补齐。输出和历史区共用正式来源、冻结内容与发放回执的完整性核验；旧快照保留原阅读与诊断，不因拥有类似字段就升级为新 A 输出。原完成、工人和班组入口依稳定身份及目标权限解析；返回标记只恢复原草稿或详情上下文，不形成权限或执行命令。

P1 本地限定验收见[A 工资证据](../design/evidence/issue-412-payroll-a/README.md)；完整关系与存储规则见 [DATABASE](./DATABASE.md#a-工资中央来源配置与发放412)，写入见 [COMMANDS](./COMMANDS.md#a-工资中央命令412p1)。

### 考勤矩阵、C1 草稿与配对输出读取（#412，P2）

P2 通过工资 Repository 的 `attendanceMatrix / c1Form / c1Config / c1Output` 读取。对应 `GET /api/read/payroll/attendance`、`POST /api/read/payroll/c1-form`、`GET /api/read/payroll/c1-config`、`GET /api/read/payroll/c1-output`；矩阵与配置绑定项目、月份和班组，表单在正文中传入 `query + input`，输出固定工资 ID。仍使用 `payroll:read`，不因 C1 没有工程量或 quantity 权限而拒绝合格工人的考勤。

矩阵分别返回当前候选、范围内原历史记录、来源锁、诊断与隔离原文证据。空格没有记录，真实零有原记录；坏工时、日期、失效人员和当前不可写分别说明。历史人不能因当前名册 JOIN 而消失；原班组、原记录身份与当前编辑资格分开呈现。表格保完整小数，月底只在自身区域横滚。

未选项目或月份时，考勤矩阵保留原空范围和授权候选，返回空记录、空工人矩阵及空锁定结果；不自动选择首项或当月，不将空月份解释为读取全年考勤。非法非空月份仍拒绝。

C1 草稿返回所选主体、全成员、逐日原事实、每人正常/加班两行、个人有效费率及出处、核算完整度和逐项阻断。配置区同时返回实际保存的 `configuredDailyWage / configuredOvertimeRate` 与有效费率；输入使用原保存值，档案优先值及日薪÷8推导只供核对。读态的来源变化反馈不暗中改写工资，实际需重核持久化由命令负责。

已证考勤来源链接使用真实 record ID，白名单筛选保留项目、月份、班组、工人和日期；返回身份仍是原工资稳定 ID 或独立草稿，不由 query 替换。原记录失效或权限不足时提供原因，不换成同名人员或其它考勤。

通用工资详情读取 C1 时，已发明细及保存的原明细中的 `unitPrice` 按原有限费率传输并显示，例如 `60.125`；工资最终金额仍按两位小数字符串传输。这是费率与金额的字段差异，不新增对其他格式原费率/工时的截断；各领域既有合法边界保持，原快照、原头及审计证据保持原文。

新 C1 冻结输出包含同一单据的工资表与逐日考勤表，两者共用原冻结姓名、工时、费率和全成员实分配，不在打印或下载时读取当前矩阵补数。详情与输出共用已采用来源和原发放回执核验；旧 C1 缺逐考勤原证据持续保留缺口。单据配对输出不等于后续整月或全周期工作簿。存储及资格见 [DATABASE](./DATABASE.md#c1-逐日考勤个人费率与冻结来源412p2)，命令见 [COMMANDS](./COMMANDS.md#考勤与-c1-工资中央命令412p2)。

### 签工台账、C2 草稿与配对输出读取（#412，P3）

签工台账与 C2 使用工资 Repository 的 dayworkList / dayworkForm / c2Form / c2Config / c2Output。对应读取为 GET /api/read/payroll/daywork、POST /api/read/payroll/daywork-form、POST /api/read/payroll/c2-form、GET /api/read/payroll/c2-config、GET /api/read/payroll/c2-output。该域独立使用 payroll:read，不要求 quantity 权限或项目有工程量。限定证据及生产缺口见[实现差异](#implementation-gaps)。

签工台账范围含项目、月份、班组与独立签工状态多选，空项目/月返回原空范围及授权候选，不读全年或自动选首项。原事实按项目/月完整读取后再呈现筛选，日内冲突和领用检查不能被班组或状态筛选隐藏。每条记录分别表达原文、当前人员/班组显示、可编辑/可确认资格、诊断、逐条领用与月锁；原事实缺损、已删除、待确认、被占用和可用不合并成普通空态。

原签工表单以路由 `recordId` 读取，查询筛选不替代实体归属；新稿才使用独立 `draftKey`。配置固定项目×负责人，返回原配置及同主体可识别历史、当前候选和不可写原因，空规则与 NULL 不用默认脚注替代。主体价、工数及原单价按有限精确小数保留，金额按既有两位小数字符串传输；原行及审计证据不递归转换。

C1/C2 共用费率转换及通用详情原单价，原费率和工数传输引用[标量规则](#scalar-semantics)；存储的原始证据旁路保持原文。

台账独立月份锁按当前项目、月份和全部真实工资成员投影，不依赖筛选后是否还有签工行。无签工或零分配成员、状态筛选为空时仍显示其真实锁；空项目/月不投影其他范围。表单自动重读刷新当前身份及资格但保留原稿的保存依据，用户明确重新核对才采用新版本；未知提交仍沿原编号核验。

C2 工资预览分开返回当前逐条事实与原单采用来源，另有服务端实际采用 ID、原配置、全体成员、明细和核算完整度。被其他有效工资领用的行仍可见且不可抢占；合法剩余 confirmed 来源可核算。原来源后来移日、换人、换项目或改状态，仍沿稳定 ID 呈现实际变化和需重核原因，不能因当前筛选而吞掉原关联。原工资身份与格式来自实际读取，不由 query 强改。

签工来源意图使用 `source-record / daywork / ledger` 与真实记录 ID，经授权关系校验后只读定位台账原记录；编辑另走明确整页入口。返回保原工资 ID/新稿与项目、月份、班组、工资状态及独立签工状态；失效或不再符合原关系时说明原因，不能猜同名对象或自动改挂。

完整已发 C2 输出仅从本单采用来源、专属冻结及原发放回执互证后生成：零星用工记录表与工资表使用同一原配置、逐条时段/工数/证明信息、当时姓名和实发分配。已发后当前档案或配置变化不重写输出；缺证据保持 unavailable 与原历史只读，不能用当前数据填成完整工资。本期配对表不包含考勤或完整月工作簿。

### 工资更正历史与实际收付读取（#412，P4）

工资 Repository 提供 `adjustmentForm / adjustmentDetail / adjustmentHistory / actualPaymentForm / actualPaymentDetail / actualReversalForm / actualLedger / releaseAdjustmentPreview`，分别对应 `/api/read/payroll/` 下 `adjustment-form / adjustment-detail / adjustment-history / actual-payment-form / actual-payment-detail / actual-reversal-form / actual-ledger / release-adjustments` 的 POST 只读接口。query 与固定 input 身份共同校验，preview 不写入业务事实。

原单更正历史包含尚未发生现金处理的核算更正、同根余额和每次处理；关联对象分别指向真实补退/冲销事件或后续已发工资，不能仅从现金集合反推更正清单。原签名金额、核算差额、待处理额与实际净额分区呈现。确认记录输出取已验证的独立确认快照，原 A/C1/C2 签名输出继续使用原冻结。

`PayrollActualFacts` 以稳定 identity 去重，保留原工资、更正、应用和冲销引用，实际发生日、有符号金额、当时成员及个人分配、资格和完整性版本。金额保持两位十进制字符串，数量/单价保有限小数精度；未知、已知零、部分已知、无权和读取不可用分别解码。封闭解析器拒绝串项目、原单或事件的响应。

按原工资范围读取时，先核实整笔收付及冲销证明，再按原更正的已确认处理金额投影；一笔跨月退款不能在各月重复计入整笔。范围投影保留实际身份，限制原工资/更正/应用引用，使用独立来源版本和 `scoped-amount-proven` 资格；完整事件详情仍读取整笔金额，范围金额不能作为整笔错记冲销依据。单个非零收付人可证明该范围个人金额；多人而无各原工资的个人分配矩阵时，范围总额已知、非零个人金额未知，整体标为部分完整，不能按比例猜分。缺少可核对处理金额则范围净额未知，不跳过后当作完整零。

预算在已有事务传入当前身份给内部工资 loader；班组/工人/项目 detail 嵌入目的范围的工资实际分区，避免页面再发另一套并行工资请求。目的读取权限和 `payroll:read` 同时核对，最后异步等待后再核验；个人缺分配不从整单或当前名册推份额。付款管理的工资收付为独立只读区域，不计入申请待付、银行流水或往来款。所有来源入口校验稳定关系并保留原预算版本、人员/项目及工资筛选返回。

### A 工资费用与独立管理簿读取（#412，P5）

`POST /api/read/payroll/a-fee-config` 经 Repository 的 `aFeeConfig(query, scope)` 读取项目、班组、负责人、月份和用途簿。返回封闭上下文、保存版本、原默认三态、逐条费用及修订、管理簿、原责任与细格候选、分项语义、历史和分动作资格。未选项目保持空预览；未证名称不升级为墙砖/地砖语义。费用保存、新增管理关系和新建管理草稿各有原因，普通簿已发不一并禁掉另一个独立管理簿的合法操作。

`aForm` 扩展用途证明、管理关系、费用组成、当前负价草稿及全部修订、本簿逐期实付和正负金额分区。普通工资与管理费虽同属 A，必须按可证明簿身份分开累计。原责任候选包括未完工细格以供管理关系及负价依据；正向费用只读取真实完成。可见的来源链接按原 ID、当前权限及来源意图解析，保留工资、费用配置、管理簿与焦点返回上下文。

读取区分当前候选、已采用依据和原冻结；来源缺损仍提供诊断及可证部分，不伪装为无费用或已领 0。坏响应必须在 Repository 封闭解析边界拒绝，不能让不完整嵌套对象进入可信页面状态。已发 V2 表单与输出取原冻结；费用组成、负价全集、本簿历史及回执一致才为 `available`。旧 V1 原文不补新字段，不能因表面相似就升级费用输出。

迁入的费用、管理关系及负价使用原物理证明与明确 ID 映射生成受控类型投影，原 JSON 保持逐字不变。原链失效时停用对应证明，不缓存旧可用资格，也不从当前配置或同名人员补齐。P4 与跨域实际消费者读取同一 proven 工资集合，费用明细、负价行、个人分配和更正关系不再加一次成本。保存与物理模型见 [COMMANDS](./COMMANDS.md#a-工资费用与独立管理簿命令412p5)、[DATABASE](./DATABASE.md#a-工资费用独立管理簿与负价清单412p5)。

### 户级空鼓和工资扣款读取（#412，P6）

工程量 Repository 的 `hollow` 经 `GET /api/read/quantity/hollow` 读取固定项目、户与来源。返回当前可记录目标、可证明的原检查、全部修订及整改、当前余量、逐条写资格和不可用诊断。创建目标依当前有效责任，已有检查保留检查时原责任；“暂无检查”与“明确检查零处”分别表达，破损证明不能变成空数组。

原户提供独立 `/subcontract/quantity/:pid/:uid/hollow/new`、`hollow/:id` 和 `hollow/form/:id` 页面。来源意图校验真实项目/户/记录与权限；工资返回信息只恢复原单或新稿、分项与楼层位置，不能扩大查看资格或更换原实体。A 未保存输入在当前页面会话中以独立草稿身份保留；刷新后的恢复能力与中央业务草稿沿 [COMMANDS](./COMMANDS.md#draft-lifecycle)，不得承诺浏览器持久完整正文，缓存不能成为核对凭证。

工资 Repository 的 `hollowConfig(query, config)` 经 `POST /api/read/payroll/hollow-config` 接收严格的 `{ query, config }` 只读正文；返回固定格式、项目、班组、负责人、月份及 A 用途簿下的有效配置、原修订、状态和保存资格。无分项修订时默认金额与出处一并说明；明确关闭、金额 0、金额缺失分别解码。项目和范围关系不符拒绝，不能借查询扩大配置范围。

A/C1/C2 表单的 `hollow` 区分当前原检查、人工开始、此前处理、冻结采用及各金额完整度。行状态分别为待人工开始、不启用、已整改、原单已处理、待明确规则和依据未获证明；没有当前可见行不代表排查完成。进度月仅列示，离职且仍有未整改来源时只提醒。配置或整改变化后，原启动仍可见且显示需重核，不能用旧合计冒充当前完整结果。

已发表单把冻结行、冻结金额与只读 `current` 伴随视图分开返回。冻结区继续使用发放时的原检查、截止整改、量价和采用；`current` 只投影原冻结记录的当前户级来源，记录、项目、户和分项身份必须与冻结事实对得上，并使用同一主体最新生效月份的当前配置。它返回位置、原责任、检查/整改/余量、当前单价和诊断，用于说明后来整改、改量、改价或责任变化。当前读取失败时保留冻结区并明确失败，不拿冻结行冒充当前，也不以当前行重算原工资。

A 的施工楼层按本簿在所选月及以前的已证完成事实，以楼栋 ID×楼层 ID 区分往月、本月和未涉及分项；空鼓原位置在此范围之外时另列说明，不以责任分配伪造完成格。清单联动分项，原空鼓入口与橙点均保留文字和键盘路径。C1/C2 不生成工程量楼层矩阵。

空鼓处数按安全整数、单处金额按有限精确小数、金额指标按两位定点字符串传输，原 JSON 证据旁路保持逐字不变。冻结 A/C1/C2 的表单、打印与 Excel 只取当时完整原件；来源快照与输出只差本次采用集合。缺原配置同次集合、采用、原工资冻结日志或回执时返回 unavailable；不能以缓存的可用结果替代当前物理证明。

P4 更正读取展示原采用位置与量价，预览差额时保留原签字金额；实际收付和后月已包含关系沿同一原更正链核对。工资迁入后的可读身份投影须由完整原件及明确映射证明，旧文字不升级为健康空鼓源。实施状态及操作见 [P6 指南](../guides/payroll-hollow.md)，实体和写入见 [DATABASE](./DATABASE.md#户级空鼓整改与工资采用412p6)、[COMMANDS](./COMMANDS.md#户级空鼓和人工扣款命令412p6)。

### 批量工资预览与计划读取（#412，P7）

Repository 的 `batchPreview` 经 `POST /api/read/payroll/batch-preview` 读取同项目同月且身份不重复的 A/C1/C2 原工资。每项返回格式、负责人、完整成员、当前状态、整数分可发额、空鼓整单约束、A 取整三态、核对依据摘要和阻断理由；C1/C2 的取整恒为不适用。批量核对不接收资金，批量发放必须明确非负安全整数分资金。未知余额、需重核、未核对、已发或来源缺损不能作为零权重继续。

资金建议先按服务端稳定簿身份安排可容纳的整单工资，再按其余可证余额计算比例与分值余数，逐项不超过余额。初分保留 A 整百配置，最终可突破档位用尽合法资金；未配置不采用默认档位。稳定身份排序与保留余额原因见[工资页面](./pages/subcontract-payroll.md)。资金不足的整单和0建议保持暂缓，诊断同时进入预览说明；建议仍不代表实发。人工修改由确认命令复验总资金、单项余额和全部成员分配。新增排序键只来自当前预览，不改变已固定计划的原依据或原命令正文。

`batch(query, planId)` 经 `GET /api/read/payroll/batch` 冷读当前协调状态。计划正文保留原确认项；`planVersion / state / nextItemIndex / expectedPayrollRevision` 反映当前进度。`ready` 可准备下一原单，`prepared` 表示原命令已经持久化且资金不可挪用，`needs-recheck` 要求重新核对，`complete` 表示所有非暂缓项已有原回执。计划或回执不能替代原工资详情、冻结输出和实际收付读取。

`aRounding` 经 `GET /api/read/payroll/a-rounding` 返回固定 A 工资簿范围的全部追加修订、目标月有效修订及不可写原因。缺失、明确关闭和整百规则分别表达；后月修订不回写前月。

### 工资正式编号与原件读取（#477）

Repository 的 `numbering(query, { projectId, statementId })` 经 `POST /api/read/payroll/numbering` 读取固定项目、可空原工资、项目序列、已出具元数据、可证明冻结文档及分动作资格。`statementId=null` 仅用于项目起点登记；它不能自动选择工资。正式编号 `issue.number` 始终为原字符串，`firstNumber / nextNumber` 仅是内部安全整数计数。编号缺失与已出具区分，预览不占号；未知旧号不从文件名、月份或当前行序推导。

`document` 复用完整 A/C1/C2 冻结 DTO，数量、费率与金额继续使用各格式既有十进制传输，不因附加编号重算工资。已出具必须同时证明原回执、序列和原件摘要才能 `canDownload`；只读工资身份可读取已证编号和单份原件，但不能登记或新增出具。没有写权限、缺起点、删除未出具原单、未发、历史 B、缺冻存证据分别返回不可操作原因；跨项目和坏响应在服务及 Repository 边界拒绝。

迁入 DTO 只投影经原图和显式映射证明的当前身份；`issue.documentHash` 保留出具时原摘要，映射后的文档另在服务端核对，不改写原摘要来伪装一致。完整工资工作簿与月归档之后通过 [#479](https://github.com/zodea/crm-new/issues/479) 消费该接口，不凭工资权限扩读私密名册。页面流程见[正式出具指南](../guides/payroll-official-numbering.md)。

### 工人私密资料与名册读取（#449）

`WorkerRosterRepository` 提供 `profile(workerId)`、`preview(scope)`、`archives(projectId)`、`archive(projectId,archiveId)` 和 `file(input)`；对应 `/api/read/worker-roster/profile|preview|archives|archive|file`。预览采用 POST 正文 `{projectId,statementIds,registeredOn}`，不接收手填成员范围。全部私密读取需要 `worker:sensitive:read`，预览和名册读取同时需要 `payroll:read`。响应为 private/no-store；普通工人列表和详情不因新增接口取消遮盖。

预览从可信工资冻结读取映射稳定工人身份，保留零成员、原姓名、负责人和工资来源；当前工人资料缺失仍保留成员并记录缺口。当前项目与合法进退场事实不足时登记日期的在场状态为 unknown。归档是独立日期的资料补充，返回固定成员、字段、劳动合同、照片元数据/摘要、资料版本和缺口；后续主档修改不补写旧归档。

照片读取核对工人 owner、归档成员与该版照片引用、正文编码/长度/SHA-256；无归档参数只服务当前工人专门私密页面，仍须独立私密权限。客户端不提供路径，不以文件名判断归属。所有读取在最后异步等待后再次核验会话和权限，Repository 验证响应身份与选择范围。

### 工资完整工作簿与保存目录读取（#479）

`PayrollRepository` 的 `workbookPreview(query,input)`、`workbookArchives(query,{projectId})`、`workbookArchive(query,{projectId,archiveId})` 对应 `POST /api/read/payroll/workbook-preview|workbook-archives|workbook-archive`。输入固定正式来源、项目、模式、唯一原工资集合及可空名册版本，不能靠当前分页或姓名隐式补选。负责人全周期只允许同一稳定请款簿；按月模式将所选原工资按月份分组。

预览同事务组合已发 A/C1/C2 原冻结文档、正式出具及原工资范围的实际收付。原工资正文缺口 `gaps` 与编号、名册、实际账交付缺口 `deliveryGaps` 分开；缺照片不能抹掉已证明的工资金额。未正式出具保持明确缺口，预览或保存不自动发号；不可用的来源不补零、不伪造已发正文。名册“独立登记日补充版本”是证据性质说明，不是资料缺口。

所有目录读取要求 `payroll:read`。预览选择了名册时，额外从工人 owner 核验 `worker:sensitive:read`、完全一致的原工资范围、固定版本、照片归属和正文摘要；公开预览仅返回名册摘要，公开保存目录只返回固定引用。工资权限可阅读及下载工资部分，完整实名附件需重新单独授权。无权限、未选择、缺照片和坏版本分别说明，不把权限失败降格为“资料齐全”。

HTTP 复用各工资格式与实际台账的十进制传输协议。Repository 验证金额、组内原单身份、模式分组、实际账范围、版本与当前身份；历史目录的实际账以保存时点为准，外层 context 为本次真实读取身份。输出器在完整附件生成后重新读取同一目录和名册，校验权限、范围和摘要，任何失败均不返回完整下载文件。

经过服务端完整原图及映射证明的迁入目录/名册 DTO 可以附带 `migration: { originalId, originalContentHash }`。目录中的该摘要必须等于保留的原 `manifestHash`；名册的该摘要标识不含 context 的原归档正文。它说明原件与本代身份投影的关系，不是本代改写 JSON 的摘要，也不接受来源 JSON 自带的同名声明。私密下载仍核对本代项目、精确工资集合、名册版本/日期/来源版本及当前身份权限；目录固定的原名册摘要可以与经过证明的 `originalContentHash` 核对，不能因此绕开范围或撤权检查。

### 本机备份保护状态（#451）

`GET /api/production/backup/status` 经 `productionBackup` Repository 读取固定工作区、维护人、是否配置、主备份保护状态、最近成功主副本/离线副本、当前版本恢复证明、执行中与最近操作。中间件和 handler 均使用不续期身份核验，不能因为每分钟轮询使登录永不过期。来源 demo/all、未认证与身份失效拒绝。

保护时点取一致副本数据时点，超过 24 小时为过期；非法或未来时点需核对，最近主备份失败保留原成功记录并明确失败。离线复制的完成时间与其数据时点分开保存，不能用刚复制的旧包刷新保护期限。恢复证明另外带 `current`，只在 schema 和完整参与者摘要相符时为 true；`releaseState` 固定等待最终验收。

Pinia 保存当前读取与运行状态；暂时请求失败不把旧成功当作新确认。备份命令最小描述与未知结果恢复遵循 [COMMANDS](./COMMANDS.md#idempotency-and-recovery)，操作回执不能代替客户、原件或恢复证明的业务读取。模型、保留策略与配置见 [DATABASE](./DATABASE.md#pg-02-备份记录与隔离恢复证明451)和[指南](../guides/local-backup-and-restore.md)。

### 客户关联项目

`CustomerDetailReadDTO.projects` 从中央项目原始事实快照投影，不经项目列表/详情的客户名称富化回调；客户列表本身不依赖项目聚合，避免两端递归。项目主读与客户投影共享命令、已确认迁移、测试会话、来源版本和服务可用性边界，未创建本地正式镜像或第二张关系表。

`summary.projectCount` 等于可读 `projects.length`。受限单记录从集合排除；关联引用的 forbidden 身份置空。整个项目源无权/暂不可用时返回 `projectsProblem`（`forbidden` / `unavailable`），`projects=[]`、`projectCount=null`，前端须以问题状态解释，不能呈现空关系或真实 0；恢复后重新读取集合。DTO 解码验证数量、状态与集合一致。关系更正和匹配规则见[客户页面](./pages/base-customer.md#详情)。

客户关联项目的实现及可读取来源见[实现差异](#implementation-gaps)，不从该分区通过推定其他关系源已接管。

### 客户关联施工合同

Issue #425 的 `CustomerDetailReadDTO.contracts` 复用施工合同中央主读事实，按合同自身客户 ID/来源投影；合同、有效补充协议和累计收款字段均来自该主读源，版本随合同命令及其既有事实来源变化。有效补充金额的状态判定与施工合同主读共享；客户有效额与合同变更后金额的区别见[客户页](./pages/base-customer.md#详情)。客户列表与客户原始身份 facts 不读取合同/项目聚合，避免候选、命令校验和客户详情互相递归。

`summary.contractCount=contracts.length`；合同导航必须含同一 `dataOrigin`、`contractKind=施工` 与父 `customerId`，解码器拒绝来源/类型/客户错配。项目引用仍检查实际可读项目和合同源的关系权限。

整个合同源无权/不可用返回 `contractsProblem`（`forbidden` / `unavailable`），`contracts=[]`，摘要合同数/有效合同额/待收差额与项目行合同数/有效合同额为 `null`，保持独立可读的客户和项目。解码验证问题态、未知值、集合及计数一致，不将失败转换为真实零。前端对合同页签给出明确反馈和适用重试；未接入的新收款写源不由本票推定完成。

<a id="客户已有中央收款来源"></a>
### 普通收款及客户关联来源

Issue #436 将普通收款接入单一中央命令事实源，取代 #426 依赖最终结算文档的临时投影边界。列表、详情、表单、客户关系、施工合同累计、项目收入和最终结算共用原始收款，按 `(dataOrigin, id)` 去重；没有最终结算的普通收款仍进入关系，多张结算不重复累计。原始 `facts` 不读取消费方的聚合，避免客户—合同—收款相互递归。读取版本随收款和合同事实变化，普通读取不导入正式样例。

普通收款读取使用 `receipt:read`；详情按稳定 ID 与 `dataOrigin` 独立读取，客户上下文不是必需身份。项目、客户和合同引用分别复验对应读权，受限引用不返回 ID/名称，包含受限关联的记录撤下 `receipt:write`。列表分页和汇总使用同一完整筛选集，正式与演示分别汇总。金额缺失为 `null`，已知零为两位小数字符串；未知历史账号、分类与类型不从其他字段推断。字段展示及状态口径见[收款页面契约](./pages/finance-receipt.md)。

整个来源无权/不可用时返回 `receiptsProblem`，收款集合为空；摘要收款数、草稿数、有效收款、待收差额，项目行收款数/金额，以及合同行累计收款/余额为 `null`，不得用其他摘要泄露受限金额。客户主数据、列表和其他可读关系仍可使用；收款详情返回同一问题，前端支持适用重试。解码同时检查问题状态、集合、计数和未知金额。

施工合同、最终结算和项目收入对同一收款源故障同样返回未知金额与来源问题，保留独立可读主档。旧读数据仅按[公共规则](#permissions-and-stale-data)展示，无权时清除敏感金额。收款附件正文经当前记录、来源、归属和哈希校验，历史本机路径不暴露为读取入口。迁移/恢复见 [COMMANDS](./COMMANDS.md#migration-and-rollback)，运行状态集中见[实现差异](#implementation-gaps)。

## 4. 页面族响应最低字段

### 4.1 列表

每条列表行至少包含：

- `id`；有业务编号时包含字符串 `no`；名称与状态用未格式化值。
- 所有可点击实体的 `EntityRefDTO`，而不只有 `projectName/supplierName`。
- 所有可点击目标的 `NavigationIntentDTO`；后端只给语义和稳定筛选 ID，不给 route 字符串。
- 该页面判断所需的日期、枚举、金额、数量、附件计数和更新时间。
- 只读聚合使用 `MetricDTO` 或等价完整性结构；可下钻聚合必须给出稳定 filters。
- `PageDTO` 的 pagination、同筛选 summary、empty 和 meta；领域旧顶层字段由兼容 adapter 映射，不定义第二套公共含义。

### 4.2 详情

详情响应至少包含：

- `entity`：列表同一稳定 ID 和版本；不存在/错配使用明确问题码。
- `summary`：关键字段与完整性，不复制可从 children 聚合的第二份可编辑余额。
- `sections`：带稳定 `key` 的独立分区，每区返回读状态、数据/空原因、来源证据、计算完整度和授权范围；不可用或无权不伪装 0 条。
- `relations`：项目、客户、分供方、合同、班组、工人、来源单据等关系引用。
- `files`：只返回文件元数据、capability 和受控 file id；不返回本地路径、认证 URL 或无授权 payload。
- `capabilities`：查看、编辑、提交、审批、下载等分别声明；前端不从中文状态猜动作权限。

### 4.3 表单预载与工作台

- 表单预载将可编辑 draft、只读 lookup 和 sourceVersion 分开；只读名称不回写为外键。
- 工作台共享同一实体/筛选上下文，分区状态不各自复制。队列项和详情都使用稳定 ID。
- 上传、识别、核对、归档、确认支付、工资发放等是独立命令；读 DTO 只报告已持久化状态，不以 toast 或本地临时布尔值证明成功。
- 原输入、当前预览和已采用保存依据分开；写后读取与输入清理直接遵循 [COMMANDS](./COMMANDS.md#success-receipt-and-readback)，读 DTO 不另外定义“保存成功”。

## 5. 本地 adapter 与后台迁移规则

### 适配边界

领域 Repository 负责事实读取和边界解码，HTTP/显式本地 adapter 保持相同公共语义；UI 状态与领域 owner 的职责只见 [ARCHITECTURE](./ARCHITECTURE.md#module-responsibilities)。已接管领域禁止以旧 SQLite、演示或 Mock 补读取失败；当前接入清单见[实现差异](#implementation-gaps)。

adapter 切换须用同一确定事实验证身份、列表/详情、三维状态、权限、分页汇总、decimal 精度和来源版本等价。候选/导出全量读取沿[公共分页规则](#pagination-and-consistency)，导航沿唯一 Target Registry。

不以整理协议改变持久化归属、暗中双写或自动回放。来源切换、迁移对账和整批回滚只遵循 [COMMANDS](./COMMANDS.md#migration-and-rollback)；输入的内存生命周期、最小原键描述与已有中央业务草稿只见 [COMMANDS](./COMMANDS.md#draft-lifecycle)。

文件/OCR/Excel 使用所属专用 adapter；普通 DTO 仅提供受控元数据和 file ID，二进制边界校验当前 owner、祖先、来源、权限、实际字节及 SHA-256，不输出本地路径或私密地址。文件缺件与完整性失败分别说明，不能从图标/文件名推定真实原件可用。

<a id="implementation-gaps"></a>
## 6. 实现差异与历史证据

本节是实现状态索引，不改变上文目标。审阅起点为 main HEAD 31f8ec34293f7edca8cc732285073f044acb5b03，当前状态以工作区及本轮验证原位更新。测试实例/本机切片仅证明对应证据范围；#416/#471 最终正式使用关口未通过，不写成全站或首次真实业务已放行。环境和生产门禁只见 [ARCHITECTURE](./ARCHITECTURE.md#implementation-gaps)。

<a id="31-当前实现落点"></a>
### 当前实现入口

| 当前领域入口 | 实现证据和边界 |
| --- | --- |
| 项目、客户、分供方 | app/lib/project、customer、supplier 的 Repository/HTTP/DTO；项目、客户、分供方浏览器主读已接中央，本机使用已登记磁盘参与者 |
| 班组—工人 | app/lib/crew-worker、app/stores/crew-worker-read.ts 与 server/api/read/crews*、workers*；全局列表及成员候选跨页读取稳定身份，项目标签读取现有同源项目主档；原班组/项目变更后回读、原命令回执与历史冻结已有定向验证。显式 Tauri 仍有本地适配；正式持久接管及业务定义分别直达 ARCHITECTURE 与 [DATABASE](./DATABASE.md#global-worker-crew-directory) |
| 核心/辅助合同、BOQ | app/lib/material-contract、construction-contract、subcontract-contract、auxiliary-contract、other-settlement；canonical kind 与补充协议按稳定父子关系读取 |
| 施工主合同开支来源 | `GET /api/read/construction-scope/spending` 按实际项目和可选主合同读取；原材采、分包、其他支出合同承诺及唯一原费用分别从自己的持久 owner 派生，已知部分与完整值分开，未接或无权的发票／结算／支付来源明确缺口。工资返回项目范围的原实际事实，归集边界直达 [已答决定](./ARCHITECTURE.md#opt-02-scope-decision) |
| 甲方/分包单据 | app/lib/owner-document/central-*、owner-commercial-document-read.ts；独立 kind/capability/金额投影，sub_settlement 与 project_penalty 使用专属事实 |
| 项目分供方 | app/lib/project-supplier、project-supplier-read.ts；双 ID 与六类事实，合作文件 owner 的实际正文校验已接，其他文件 owner 以实际实现为准 |
| 送货/材料价格 | app/lib/delivery、material、material-quotation 与 app/stores/delivery-record.ts；送货、合同和独立报价按各实际 owner 组合原价及版本，缺源分别呈现；报价的归属和迁入范围直达 [DATABASE](./DATABASE.md#quotation-target) |
| 普通收款/支出财务/票据 | 普通收款 app/lib/receipt 独立中央事实；F3 app/lib/finance 的往来、报销、申请、实付和开票申请由正式 finance 参与者读取，实际付款详情同事务关联已接结算与分摊；未登记的采购发票或合同来源仍分别不可用，不能以开票申请代替发票台账 |
| 工程量/排程/标准库 | app/lib/quantity、schedule，中央 #442–#445 与本机标准库 #463；冻结依据与当前来源独立 |
| 工资/目标成本 | app/lib/payroll、target-cost 与专属 read operation；#412 分阶段、#449/#477/#479 有独立证据，生产落盘不能从测试中央通过推定 |
| 公共洞察/通知 | app/lib/finance/payment-detail.ts、PaymentApplicationInsightPanel.vue、app/stores/notifications.ts；分供方资料提醒已接本机持久公共通知 owner，其他未接领域保留真实缺口；静态样本只在服务端授权演示可见 |
| 导入/导出/OCR/备份 | app/stores/export-workflows.ts、ocr-settings.ts、server/api/ocr 与 productionBackup；专用读取不授予全领域普通业务读取 |

以上是查代码的入口，不是另一份网络 schema。历史核心链的 #281/#317–#331、普通收款 #436、文件 #438/#441 和工资/工程量阶段证据按所证明范围解读；已确认但未实施的 canonical 关系不能因代码缺失重新变成待答业务问题。

<a id="f3-payment-verification-read"></a>
### F3 历史付款核验读取

原付款申请表单读取附只读 `paymentVerification`：`required`、`status`、原因及当前可用 `proof`。状态区分无需核验、缺核验、已核验、依据变化及不可用；实际资格、金额与历史保全只见 [DATABASE 的 PAY-08](./DATABASE.md#entity-payment-record)。证明包含原申请版本、原命令、可信核验人／时间、累计结论、真实源版本摘要和原件引用，不能将客户端同名字段作为写入的资格事实。

GET 不生成核验、不改旧批复或旧余额、不增加现金。读取及当前资格复验遵守实际申请、结算、原费用、实付和原件权限；不可读来源不泄露旧证明正文。源版本改变只影响当前资格，旧核验仍保存在冻结历史。普通申请批复、真实现金与可核实 Other 结算余额按各自源投影，不把历史未知批复的 `NULL` 替成核验金额。界面提交、后读及恢复直接见 [COMMANDS](./COMMANDS.md#f3-finance-payment-verification)。

<a id="historical-expense-clearance-read"></a>

2026-10-05 已确认的[历史清偿承接](./DATABASE.md#historical-expense-clearance)由原费用表单的只读 `draft.clearanceVerification` 及 Other 原费用列表读取。`sources` 保留原费用版本、`clearanceSourceHash`、原清偿行及 `missingOriginalDocument / originalDocumentState`、冻结 `clearanceProofs`、明确 `clearanceLinks` 和逐 item 尚可关联的 `clearanceItemAvailability`；不把缺失原单显示成已找回。`qualification` 分开给出原记录处理份额、已核份额、已确认采用、已核重叠、新可采用额、旧义务及旧实际已付／未付；not-required / missing / verified / stale / unavailable 和原因沿业务依据解释，不能用其中一个余额冒充另一个。银行来源不足时旧已付／未付保持 null，不能从清偿行或文件推断。

Other 表单及详情返回真实 `expenseAllocations / clearanceLinks`，只有本单实际采用行可用于追加关联。Native 财务预检的原件携 `ownerId / canDeclareMissingClearance`，大小允许真实 number 或 null；null 明示原大小未知，不提供任意补大小的路径。仅服务端精确允许的旧清偿 external-required 原单可声明缺失，其他原件继续按原边界读真字节。缺权限为 forbidden，实际来源未接为 unavailable；撤权不留旧证明正文或私密身份，过期响应不覆盖当前范围。GET 不保存核定、不补关系、不生成成本或现金，旧冻结证明按原版本保全；写入与原回执可靠后读见 [COMMANDS](./COMMANDS.md#historical-expense-clearance-command)。原费用核定、新旧份额合并、可靠后读及冷读取已完成限定正式流程验证；纸单整页、精确外部缺件声明和迁入组件的验证层次分别见 [DATABASE](./DATABASE.md#historical-expense-clearance)。

### PG-01 本机客户读取（#450）

当前本机客户列表/详情/表单、lifecycle、deleted、audit 与原命令结果查询回读磁盘参与者。文件按客户归属、删除状态、长度/SHA-256 校验，附件下载为 private/no-store 并禁止 MIME 嗅探；项目和施工主合同由同次事务读取已登记 owner，合同与有效补充协议保可空金额，未接普通收款仍 unavailable。缺合同权限为 forbidden，不能把缺源显示成零。运行和身份策略见 [ADR 0021](../adr/0021-single-operator-windows-production-storage.md)，原结果 not-found 的处理由 [COMMANDS](./COMMANDS.md#pg-01-本机客户命令450) 保持封存保护。

### PG-03 本机项目读取（#452）

当前本机 project/customer 双向投影沿真实主/次客户外键，同一只读事务读取，已删项目不进入正常关系。lifecycle/deleted/audit 为核对恢复入口；已删除项目基础身份可核对，表单和文件拒绝。独立附件删除不随客户/项目恢复而改变。项目列表与详情已由实际同次事务组合项目和客户来源证明、可信会话及真实读取时点，HTTP 校验稳定身份、来源、原请求页和大小。金额不完整时界面明确显示未知、可证小计、缺失数量与当前筛选范围，不将授权可见范围称为企业全量。

施工主合同管理费配置从同次事务的正式施工 owner 读取，每份合同保独立配置及冻结证明，配置不算实际成本。项目菜单可新建施工主合同；施工详情和项目开支面板从原合同、费用和真实实付关系只读归集，单份关联及项目工资范围沿 [OPT-02 已答决定](./ARCHITECTURE.md#opt-02-scope-decision)。基页未接的普通收款、预算与工资综合指标、项目分供方仍未知；面板的有证小计不把这些来源称为完整经营总额，没有开发/演示补源。原键读取见 [COMMANDS](./COMMANDS.md#pg-03-本机项目命令452)，持久清单见 [DATABASE](./DATABASE.md#pg-03-本机项目持久参与者452)。

### PG-04 本机分供方读取（#453）

当前本机主档、表单和证照来自 supplier 磁盘参与者。原件经专用接口核对分供方→证照→文件、删除状态和摘要，普通 DTO 不带正文；OCR 原候选、人工确认、审核分别回读。关联事实在同次正式事务核对各 owner、能力与源版本：F3 已确认支付按真实分摊归属，读取须同时具备申请和支付读取能力；原申请后来删除不抹掉已确认现金。材采有效合同与协议、Other 当前服务交易方结算分别提供有证小计与真实原单入口，不能把这些局部来源称为全部合同额或结算额。完整合作关系、采购发票及应付余额仍明确缺源；项目主档名称可读不证明 ProjectSupplier 合作关系已接入。原恢复见 [COMMANDS](./COMMANDS.md#pg-04-本机分供方命令453)。

当前分供方普通列表/详情与正式通知已逐响应承接[可信读取证据](#shared-dto)。分供方列表的主档授权范围可完整，同时未接关联来源分别不可用；两者不互相覆盖。分供方合作金额返回可证小计、实际参与记录及缺金额记录数量；整项来源不可用时这些值均未知。列表响应必须对应原请求页与页大小，详情必须对应稳定身份和来源；只有仍属于当前查询的合法回读才能将实际末页写回 URL。通知跨页以同一 owner 版本、授权范围和事件身份完整对账，再允许原已读集合恢复。

### 本机工序库读取（#463）

当前 GET process-libraries 及指定版本回读磁盘，只接 real 且需要 process-library:read；完整顺序、阶段/分项、前置 key、禁用状态和创建证据保持不可变。核对版本、原命令和审计完整图后才返回，损坏图不截取有效行冒充完整。同事务 WBS 使用投影包含真实项目和组数；权限不足或参与者未接时 usageCount=null，已证实无引用才为0，投影不改不可变库正文。参与者见 [DATABASE](./DATABASE.md#共享正式存储版本与参与者463)，限定证据见 [#463](../design/evidence/issue-463-production-process-library/README.md)。

### 待实施及需验证差异

| 目标 | 当前差异 / 后续验收依据 |
| --- | --- |
| 公共协议与三维状态 | 公共 ReadState 已退役 partial，401 与来源 unavailable 分别解码和失效清理。项目、客户、分供方、班组工人、施工/分包/材采/辅助合同、甲方单据、项目分供方及普通收款的普通列表/详情已接强制 metadata；通知沿其 owner 同样接线。Metric 的已知小计、缺项和范围已接项目及分供方主要出口，其他领域旧派生指标仍按实际来源逐项核验；独立子区读取失败不抹除可读本体，正式持久边界沿 ARCHITECTURE |
| decimal 与可空 | 旧 number/REAL、局部 round2/默认零与固定六位限制须逐字段检查；保留原费率/工时/数量精度和历史原文，工资最终两位，不因协议整理改算法 |
| 分页/查询 | 公共普通分页已返回 requestedPage 与实际末页，已接领域 HTTP 拒绝错页、大小或身份来源响应；API 非法查询拒绝，前端旧查询恢复仍可 normalize。项目导入、主档候选及班组成员候选已复用完整跨页来源与范围对账；现有未接该公共协议的专用导出仍需按各领域实际 owner 验证，不从列表通过推定其完成 |
| 强一致来源 | 各主读/组合投影需有真实相关版本和同响应一致读取；项目列表组合客户版本等不足须补，不能用 updatedAt 或假版本证明完整 |
| 报量 | 当前表单刷新 BOQ 已保 reportedQty，backend 使用当前有效 BOQ 价生成申报快照；新协议要保该已确认语义，不统一阻断每次价格版本变化 |
| 主体和全域合同同号 | 系统设置独立 catalog 返回核实版本/原历史及可信 metadata；三核心合同显示采用快照/原主体文本，目录后来更名不替换旧事实。Native 全种类同库占号、中央正式材采占号已接；未接正式合同域不开放，历史未核实主体仍为 null，不按同名推定 |
| 三类价格来源 | 独立报价、材采合同与实际送货各自读取当前 owner，逐项保留单位、税率、运费条件、日期和来源；缺条件不能加入可比候选。读取期间的旧送货分析仅供查阅，不参加本次比较、候选或导出；归档事实不被当前报价覆盖 |
| 证照有效性 | 已按 7 天及上海业务日纯读取投影；跨日 GET 不改原件、人工核验凭证、版本、审计或原回执。真实关键资料写归档旧核验，当前有效性与历史核验分别返回；无效日历日期明确为未知，未填截止日仍沿既有规则 |
| 主动提醒 | 本机中央 supplier 保存稳定到期问题，public notifications 持久事件、每 actor 已读及原命令；启动补算、每分钟检查、壳层分页对账与 system 提示已接。已读/关闭均不解除问题；失权、来源/actor切换撤回含名称的旧系统提示，来源不可用单独呈现；首次真实业务写入仍依生产门禁，其他未接领域不造通知 |
| 财务和经营来源 | 正式分供方确认付款及其他支出结算已接同事务事实与真实分摊，部分合同和结算的有证小计不替代完整来源，采购发票仍缺源。项目管理费的总合同配置与实际成本分开；既有管理簿冻结用途和 P4 实际净额保留来源证明。普通工资排除，补退沿原单，空来源的零不代替完整总额。真实税主体期间与完整现金来源仍缺；定义只见 [DATABASE](./DATABASE.md#management-fee-sources)，限定接线见 [项目页](./pages/project-info.md#31-项目经营数据) |
| Native 成本与原费用 | Native 原费用、明示清偿及收款采用快照保全；正式 F3 与 Other 持久参与者承接可核验无合同费用链，成本与实付各归原事实一次。具体身份与历史清偿核验边界只见 [DATABASE](./DATABASE.md#actual-counterparty-identities)。项目成本和预算比较保留合同/协议/目标空值及已知小计；未接完整 P4 实际源保持未知，不以工资头或部分实际算完整余额。正式领域接通不表示所有项目经营投影已接通 |
| 保存后读回与输入 | 各领域可靠回执 + 同源同实体正式 readback 才自动清输入/待确认/关闭，已保存读失败只读重试；浏览器持久最小描述与中央草稿的差异按 COMMANDS 验收 |
| 生产与私密输出 | 本机已放行接口和持久参与者不等于全域生产可用；工资完整文件、工人私密版本、原件摘要及最后授权重验沿各阶段证据，#471 未完成仍保持关口 |

问题若是已确认目标与代码差异，列为待实施能力；若发现新的关键业务/架构决定，集中列新批次并暂停，不能替用户确认。Issue 的创建/修改/评论须依 AGENTS 取得明确授权，文档整理本身不自动授权写 Issue。

<a id="6-验收"></a>
## 7. 验收

文档验收使用以下闭环，业务实现验收按后续工作单元完成：

- 各页面域均有 owner 和业务权威出处，公共语义只保留一处；目标、当前、待实施和历史证据可区分，#471 未通过不宣称生产就绪。
- 身份/编号为字符串；decimal 传输无指数与格式化符号；费率、工时、数量不提前截断；工资金额结果两位；null、真实零与历史未知可区分。
- 同一例子同时说明读状态、计算完整度和授权范围；父可读/子空、无权、不可用分别成立，已知小计不冒充全量。
- 每普通分页后台重读，单响应同筛选/授权/来源一致；非法查询拒绝，合法越界回最后页并附请求页，空结果仍保留筛选。
- 跨页候选/导出出现版本/权限变化或完整性缺口即停止重读；旧数据明显标注且不能用于新写、候选或导出；换目标/来源/权限后的迟到响应丢弃。
- 未提交报量按当前有效签证价复算并保手工量；已提交冻结不漂移；三价格源分开；证照 7 日临期、到期当天、长期字段和 GET 无业务副作用一致。
- 原件、工资冻结、名册/工作簿范围及隐私重新授权可证明；回执/readback 与输入恢复只引用 COMMANDS，不把读取不存在当原写未应用。
- 检查所有直接链接及旧锚点，领域例外不与公共规则矛盾；实现差异按已经完成的业务工作单元与其实际验证更新，不将测试实例通过写成生产放行。

三个维度的最小示例：

| 读状态 | 计算完整度 | 授权范围 | 呈现 |
| --- | --- | --- | --- |
| ready | complete | permission-filtered | 当前可见集合合计已知，明确仅可见范围，不能称企业总额 |
| ready | partial | complete | 完整读取范围内缺一项金额，value=null，knownValue 为可证小计 |
| 父 ready，子 unavailable | 父独立指标可 complete，依赖子源指标 pending/partial | 各分区独立声明 | 主档可读，子区显示来源失败，相关总额未知；不显示“暂无记录” |
| 父 ready，子 forbidden | 依赖子源值未知 | 子区无当前读取权 | 主档继续可读，子域不泄漏身份、金额或隐藏行数 |
| empty | complete | complete | 已查明无记录，可报告该范围真实零，仍保留筛选与分页信息 |
| loading / error，保留 previous | 旧数据沿原完整度，不声明最新 | 同用户、目标、来源和授权范围 | 标明旧时点，仅查看；撤权/切源即清除，不能作为候选、新写或导出 |
