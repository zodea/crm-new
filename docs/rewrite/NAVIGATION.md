# 跨域导航与返回语义

本文是瑞航 CRM 业务关系入口、目标视图和返回上下文的权威源。页面字段与布局看 [`pages/`](./pages/)，实体与外键看 [`DATABASE.md`](./DATABASE.md)，读 DTO 的金额、空态、权限和错误语义看 [`READ-MODELS.md`](./READ-MODELS.md)。参考站只提供运行态证据，不提供瑞航路由或实体身份。

## 1. 目标与边界

- 蓝色名称、编号、金额和聚合值只有在“稳定实体 ID + 已登记目标 + 查看能力”同时成立时才可点击。
- 路由由前端矩阵生成；后台只返回实体引用、语义化目标和筛选 ID，不返回 Vue 路由字符串。
- 新增/编辑仍走独立整页表单；关系主链接优先进入只读详情。当前只有表单路由的对象标为“读写混用”，不能宣称隐藏详情已闭合。
- `0`、空列表、缺关系、权限不可见和加载失败是不同状态。聚合值为 `0` 时，只要后端明确返回可用下钻目标，入口仍可进入真实空列表；不得用金额是否为零猜可点击性。
- 本文覆盖 [`runtime-reference-audit.md`](../design/runtime-reference-audit.md) 的 20 个生产页面域及应用壳公共入口，不增加保证金、备用金、统计分析等当前没有本地路由的模块。

## 2. 导航意图合同

`EntityRefDTO` 负责身份，`NavigationIntentDTO` 负责“去哪里看”。多态单据必须带 canonical `variant`；例如只有 `entity='material-document' + variant='arrival'` 才能选择到货详情，不能按编号前缀或名称猜类型。

```ts
type NavigationIntentDTO =
  | {
      kind: 'entity-detail' | 'entity-subview' | 'source-record'
      subject: EntityRefDTO
      variant: string | null
      view: string | null
      filters: Record<string, OpaqueIdDTO | BusinessCodeDTO | null>
    }
  | {
      kind: 'entity-list'
      entity: EntityKindDTO
      variant: string | null
      view: string | null
      filters: Record<string, OpaqueIdDTO | BusinessCodeDTO | null>
    }
  | {
      kind: 'same-route-overlay'
      subject: EntityRefDTO
      view: string
    }
  | {
      kind: 'unavailable'
      reason: 'missing-id' | 'missing-route' | 'not-connected' | 'forbidden' | 'unverified-target' | 'error'
    }
```

约束：

1. `subject.id` 和 `filters` 中的关系键只接受稳定 ID；label、业务编号和人员姓名只展示。
2. `variant` 来自 canonical 业务类型，不等同于路由片段。前端注册表负责把它解析为站内路径。
3. `view` 表示详情页签、区块或列表分类，不参与实体身份。
4. `same-route-overlay` 不创建新路由。关闭后仍停留原记录，切换记录时必须以新的 `subject.id` 重算记录级数据。
5. `unavailable` 的缺关系、未接、无权限与未验证目标渲染普通文本或明确边界状态，不伪装蓝链；`error` 是可重试的读取失败，必须渲染错误状态，不能降级为其他 `reason` 或 `0`。

### 当前运行落点（#312）

唯一前端 Target Registry 位于 `app/lib/nav/target-registry.ts`。后台和 Repository 只返回上述 `NavigationIntentDTO`，不得返回 `/project/...` 等 Vue 路径；Registry 才能把登记过的 `entity + variant + stable id` 解析成站内目标。项目列表现在随每行返回 `kind='entity-detail'`、`entity='project'`、`variant='detail'` 和后台判定的 `filters.dataOrigin`，由 Registry 生成 `/project/:id?origin=:dataOrigin`。详情刷新仍只依赖路径 ID、来源 query 与中央读接口，不依赖列表组件留在内存。

当前项目切片已经把 `resolved`、`missing`、`forbidden`、`not-connected`、`unverified-target` 和 `error` 分成稳定展示状态；未登记目标不会回退到 `/project` 或按名称猜路由。项目 ID 存在但 URL 来源不一致时显示 `relationship-mismatch`，不存在时显示 `not-found`，两者都不展示同名详情。#313 已补齐项目列表筛选、排序、页码、每页条数、应用页签、行锚点、滚动和焦点的 `returnTo` 往返合同。

### 2.1 返回上下文

列表到详情的来源状态由前端生成，不由后台拼接：

```ts
interface NavigationOrigin {
  route: string
  query: Record<string, string>
  tab: string | null
  anchor: { kind: 'row' | 'section' | 'task', id: string } | null
  page: number | null
  scrollTop: number | null
}
```

- `returnTo` 只接受站内相对路径，解析后必须命中生产路由白名单；拒绝协议、host、凭证、`//`、反斜线和越界路径。
- 每个目标页只消费自己登记的 query；未知键丢弃。query 只恢复筛选/页签/来源，不覆盖路径实体 ID。
- 详情加载、空态、错误或无权限时仍保留合法返回上下文；不能依赖浏览器历史“碰巧还在”。
- 页码和滚动位置属于本地应用页签状态，不进入后台 DTO。目标记录不存在或关系错配时显示明确问题，并允许返回原筛选位置。
- 应用内部页签实例 ID 只隔离视图状态，不是业务实体 ID，也不得写入业务接口。

#### 当前运行落点（#313）

项目列表在进入详情前把已登记的搜索、阶段、排序、列筛选、页码和每页条数编码为站内 `/project` 相对路径，并以短期 `sessionStorage` 来源记录绑定应用页签、行锚点和工作区滚动位置。详情页在 ready、loading、forbidden、error、relationship-mismatch 和 not-found 状态都显示同一返回入口；直接深链、伪造、篡改、过期或跨路由来源统一降级到 `/project`。返回后优先恢复原行焦点；原行因删除、权限或筛选变化不存在时，降级聚焦项目列表标题。来源记录只存于当前浏览器会话，30 分钟到期后详情入口主动失效，不进入后台 DTO。

### 2.2 展示状态

| 状态 | 入口 | 目标页 |
| --- | --- | --- |
| `resolved` | 蓝色可点击；金额可为 0 | 加载后显示数据或真实空表 |
| `missing` | 普通文本/“未记录” | 不导航，不按名称补 ID |
| `forbidden` | 脱敏文本或锁定状态 | 可显示无权限页，但不得泄露 label/明细 |
| `not-connected` | 明确“未接” | 不进入空白表单冒充详情 |
| `unverified-target` | 普通文本，并留在差异清单 | 后续取得只读直接证据再开放 |
| `error` | 保留原入口与上下文 | 错误页提供重试和返回，不渲染成 0 条 |

### 2.3 缺数据下钻与最小只读目标页

“缺数据”必须先判定缺的是**子记录**、**筛选命中**、**关系身份**还是**查看能力**，再决定是否导航。入口不以当前行数、金额、中文状态或测试数据是否可见来猜可达性。

#### 入口判定

| 前置事实 | 入口表现 | 目标表现 |
| --- | --- | --- |
| 已登记 `entity-list/entity-subview`、筛选所需 ID 完整且有查看 capability | 蓝色链接；聚合值可为 `0` | 正常进入目标列表/页签，成功返回 0 条时保留目标结构并显示真实空态 |
| 已登记 `entity-detail/source-record` 且实体 ID、variant、查看 capability 完整 | 蓝色链接 | 先加载只读详情；实体存在但子分区无记录时保留详情头和其他分区，只在该分区显示空态 |
| 关系适用但没有稳定 ID | 普通文本、“未记录”或“关系待配置” | 不导航，不按名称、编号、金额或同项目补 ID |
| 有稳定 ID 但最小只读目标页尚未登记 | 普通文本或明确“详情待接入” | 先补领域专属最小只读页并登记 target，再开放入口；不得临时进入编辑表单或通用空白页 |
| `forbidden` | 脱敏文本或锁定状态 | 只有后台明确返回可达的权限页时才允许进入；不得泄露 label、记录是否存在或明细数量 |
| `unverified-target/not-connected` | 普通文本并保留原因 | 不导航；取得直接证据或补齐 canonical 关系后再登记 |
| 入口解析或目标读取失败 | 保留原文本与返回上下文 | 显示错误、重试和返回；不得降级成 0 条、未记录或新建表单 |

可进入真实空列表的范围包括矩阵中已经登记并能用稳定 ID 过滤的项目合同/目标成本、项目详情金额页签、分供方合同/结算/收票/付款、项目×分供方六类事实、客户关系、合同来源单据、材料/财务/工资等已有列表目标。是否为 0 条由目标查询返回的 `PageDTO.empty` 决定，不由来源页先查数量。

暂时不可用的入口包括：只有姓名而没有人员 ID 的项目角色；没有 canonical 仓库、供货单位、到货—归档、结算分摊、领用批次或调拨两端关系的材料入口；没有稳定 focus 目标的补充协议；没有明确 `NavigationIntentDTO` 的洞察报表行；以及当前权限下未验证的参考目标。它们必须保留在矩阵差异中，不能用测试数据补成可点击关系。

#### 最小只读页结构

本地图已经登记但仍为“读写混用”的甲方/分包/材料/辅助合同结算/普通财务对象，开放主链接前先补领域专属只读页。最小页不是通用占位模板，至少包含：

1. 始终可见且经过白名单校验的返回入口，保留来源筛选、页签、页码、滚动与行/区块锚点。
2. `EntityDetailShell` 头部：业务名称或编号、类型、状态和必要元数据；编辑仅作为有 capability 时的独立动作，不把详情本体做成表单。
3. 与页面蓝本一致的扁平资料网格；字段本身不加彩色背景或层层卡片，未知值显示“—”，不拿测试值补齐。
4. 已有真实关系的项目、客户、分供方、合同、班组、工人和来源单据；缺关系按 `EntityRefDTO` 原状态展示，不生成死链。
5. 页面蓝本要求的页签、分区或专属表头。实体存在但某分区为 0 条时，详情仍是 `ready`，只让该分区显示紧凑空态；不把整个详情替换成大空框。
6. 数据来源时点、完整度和 capability；没有真实事实的汇总保持 `null/pending/partial`，不显示静态成功数字。

列表目标同样保留标题、来源条件、已实现筛选、专属列、汇总位置和分页。首次成功且 0 条使用 `no-records`；有数据但当前筛选无命中使用 `no-filter-match` 并提供“清除筛选”；缺必需父关系使用 `missing-relation`，不发送无约束查询。

#### 页面状态与直接深链

- 初次读取先显示贴近目标结构的 loading，不先闪空态。已有缓存但刷新失败时保留旧数据，并在内容上方显示 compact error 与重试。
- `not-found` 表示目标不存在或已删除；`relationship-mismatch` 表示 URL 中父子身份不匹配；两者都保留合法返回入口，但不回退到同名记录或空白新建页。
- `forbidden` 是权限边界，不是空态或系统错误。整个页面不可见时只显示脱敏权限页；单个关系不可见时只替换该关系。
- 页面只依赖路径身份、白名单 query 和后台 DTO 即可刷新/深链；不得依赖来源组件还在内存中。来源提示可以丢失，实体身份不能丢失。
- 加载完成后把焦点移到页面主标题；返回时优先恢复来源 `anchor` 对应的链接/行，其次恢复列表标题或工具栏。站内导航使用原生链接语义，支持 Tab 与 Enter；Space 只激活真正的按钮。Esc 只关闭当前 overlay，不代替整页返回。
- 状态变化使用既有 `StatePanel`/`KitTable.empty` 的 live region；密集表格只在自己的容器横向滚动，页面根不得横滚。

#### 测试数据可见性

- “显示测试数据”默认关闭。若真实查询为 0 条而演示空间有记录，目标仍返回真实 `no-records`，可提示“测试数据已隐藏”，但不得自动打开开关或把测试记录当真实命中。
- 打开后可在同一只读列表叠加测试行；每行、详情、页签标题和后续下钻持续携带 `dataOrigin='demo'` 标识。真实与测试汇总分组展示，不产生混合业务总数。
- 测试记录不能补齐真实记录缺失的外键，也不能让原本 `missing/not-connected` 的真实入口变成可点击。叠加模式中的测试行只读；写入测试数据必须显式进入演示工作区。
- 已携带 `dataOrigin` 的关联只在目标页已登记并消费同一来源策略时可点击；否则 `real/demo` 都退化为文本。这不改变未携带来源身份的既有本地导航。

## 3. 已登记目标路由

“当前状态”只描述本地实现；`读写混用` 表示路径存在但当前主体是编辑表单，仍需增加独立只读详情能力。

| 实体/视图 | canonical variant / view | 目标路由 | 当前状态 |
| --- | --- | --- | --- |
| 项目 | detail | `/project/:id` | 已闭合；唯一 Target Registry 生成来源感知路径 |
| 客户 | detail | `/base/customer/:id?origin=:dataOrigin` | 已闭合；唯一 Target Registry 生成来源感知路径，测试来源只读 |
| 分供方 | detail | `/base/supplier/:id` | 已闭合 |
| 班组 | detail | `/base/crew/:id?origin=&returnTo=` | 已闭合；公共 `EntityLink` 已登记 |
| 工人 | detail | `/base/worker/:id?origin=&returnTo=` | 已闭合；公共 `EntityLink` 已登记 |
| 工程量责任单元 | detail | `/subcontract/quantity/:pid/:uid` | 已闭合；必须同时持有项目 ID 与单元 ID；班组—工人中央入口携来源主体进入只读事实详情 |
| 工资单 | detail | `/subcontract/payroll/:id` | 已闭合；班组—工人中央入口携来源主体进入只读事实详情 |
| 项目扣罚 | penalty-detail | `/project/penalty/:id` | 已闭合；班组—工人中央入口进入只读事实详情，不落入旧编辑表单 |
| 合同 | detail | `/contract/:id` | 已闭合；施工/分包/材采按合同类型分组 |
| 项目×分供方 | overview / six tabs | `/project/:pid/supplier/:sid` | 已闭合；目标模块尚未统一消费来源 query |
| 目标成本 | detail | `/project/target-cost/:id` | 已闭合；合同聚合区缺稳定锚点 |
| 开票申请 | detail | `/finance/billing/:id` | 读写混用 |
| 收款登记 | detail | `/finance/receipt/:id?origin=:dataOrigin&customerId=:customerId` | 已闭合；稳定来源与父客户成对校验，只读详情和显式编辑分路由 |
| 往来收付 | receipt / payment | `/finance/current/:id` | 读写混用；参考往来付款目标待补证 |
| 付款申请 | detail | `/finance/payment/:id/detail` | 已闭合 |
| 支付记录 | detail | `/finance/records/:id` | 读写混用 |
| 费用报销 | detail | `/finance/reimbursement/:id` | 读写混用；当前真实空态 |
| 发票 | review / detail | `/finance/invoice/:id` | 已有单票工作台；来源返回仍需统一 |
| 送货归档 | detail | `/material/delivery/archive/:id` | 已闭合 |
| 工程量户 | detail | `/subcontract/quantity/:pid/:uid` | 已闭合；六项筛选可恢复 |
| 工资单 | detail | `/subcontract/payroll/:id` | 详情已存在；班组工人中央来源可安全返回，常规工资台账的全量筛选返回仍未闭合 |
| 排程工序 | task subview | `/schedule` + `project/group/task` | 已闭合 |
| 甲方单据 | change/report/acceptance/final-settlement/penalty | `/owner/:kind/:id` | 读写混用；验收/保修为同实体双视图 |
| 分包单据 | change/settlement | `/subcontract/:kind/:id` | 读写混用 |
| 项目罚扣 | penalty | `/project/penalty/:id` | 班组工人中央来源为只读事实详情；其他入口仍读写混用 |
| 自购材单据 | requisition/arrival/use/stock-check | `/material/requisition/:id`、`/material/arrival/:id`、`/material/use/:id`、`/material/stock-check/:id` | 读写混用；variant 只能进入登记的具体路径 |
| 甲供材单据 | control/requisition/arrival/use/direct | `/owner-material/control/:id`、`/owner-material/requisition/:id`、`/owner-material/arrival/:id`、`/owner-material/use/:id`、`/owner-material/direct/:id` | 读写混用；variant 只能进入登记的具体路径 |
| 支出结算 | material/subcontract/other | 对应 `/material/settlement/form/:id`、`/subcontract/:kind/:id`（variant 为 settlement）、`/contract/other-settlement/form/:id` | 读写混用，且到货分摊关系未接 |
| 仓库 | detail | — | 没有 canonical 实体/路由，保持 `not-connected` |
| 文件 | controlled-viewer | — | 只按 capability 打开受控预览；文件名/路径不是权限 |

## 4. 跨域关系矩阵

状态含义：`闭合` 为目标与往返已实现；`部分` 为目标存在但来源筛选、只读层或公共解析未闭合；`缺身份` 为本地没有稳定关系 ID；`待只读页` 为当前会进入编辑表单；`待补证` 为参考目标未被安全确认；`非入口` 为明确不跳转。

| 键 | 来源域 / 页面 | 可点击字段或动作 | 可点击条件 | 目标与携带上下文 | 返回语义 | 当前状态 / 后端要求 |
| --- | --- | --- | --- | --- | --- | --- |
| `N-HOME-SCHEDULE` | `home` `/` | 当前项目施工进度 | `project.id` resolved | `/schedule?project=:projectId`；工序再带 `group/task` | 返回首页恢复项目与工序 | 闭合 |
| `N-PROJECT-NAME` | `project` `/project` | 项目名称 | `project.id` resolved | `/project/:id?origin=:dataOrigin`，路径由唯一 Target Registry 解析 | 返回项目列表原阶段/搜索/排序/列筛选/页码/每页条数/应用页签/滚动/焦点 | 闭合；语义 DTO、来源校验、深链刷新与 #313 完整返回上下文已实现 |
| `N-PROJECT-INCOME` | `project` `/project` | 累计收入合同金额 | `MetricDTO.drilldown` 非空，金额可为 0 | `/contract/construction?project=:id` | 返回项目列表原上下文 | 部分；本地目标存在，列表金额仍是文本 |
| `N-PROJECT-BUDGET` | `project` `/project` | 预算总额 | 同上 | `/project/target-cost?project=:id` | 返回项目列表原上下文 | 部分；目标成本列表需消费项目 query |
| `N-PROJECT-ROLE` | `project` `/project` | 项目经理/执行经理及角色 | 必须有人员实体 ID | 项目成员只读视图，路由待定 | 返回项目列表原上下文 | 缺身份；当前只有姓名文本，禁止造链接 |
| `N-PROJECT-CUSTOMER` | `project` `/project` | 客户 | `customer.id` resolved | `/base/customer/:id` | 返回项目列表原上下文 | 闭合；参考权限拒绝记为 forbidden |
| `N-PROJECT-METRICS` | `project` `/project/:id` | 合同/收付/票税/支付金额 | 明确 drilldown，不以非零判断 | 同一项目详情 `?tab=construction,fund,current,tax,payment`，进项票也可到 `/finance/ledger?project=:id` | 返回同一项目与页签/子表 | 闭合主链；0 金额公共组件规则待统一 |
| `N-CUSTOMER-DETAIL` | `master-data` `/base/customer` | 客户名称 | `customer.id` resolved | `/base/customer/:id?origin=:dataOrigin` | 返回原搜索、状态、排序、页码、每页条数、滚动与行焦点；详情再显式进入正式编辑 | 闭合；#314 以白名单 `returnTo` + 有时效会话上下文恢复，直达或伪造来源回退 canonical 列表 |
| `N-CUSTOMER-RELATIONS` | `master-data` `/base/customer/:id` | 名下项目/施工合同/收款单 | 关系 ref resolved | `/project/:id?origin=:dataOrigin`、`/contract/:id`、`/finance/receipt/:id?origin=:dataOrigin&customerId=:customerId`；页签 `contracts,receipts` | 收款详情返回客户详情的收款页签，并透传已校验的客户列表返回上下文 | 闭合；三类关系均由 Target Registry 按稳定 ID 进入只读目标，missing 与 forbidden 不生成死链；收款编辑仅从列表显式动作进入 `/finance/receipt/form/:id` |
| `N-CREW-WORKER` | `master-data` 班组/工人列表与详情 | 班组、工人、项目、责任户、工资单、罚扣 | 相应 ref resolved，且来源一致 | `/base/crew/:id`、`/base/worker/:id`、`/project/:id`、`/subcontract/quantity/:pid/:uid`、`/subcontract/payroll/:id`、`/project/penalty/:id` | 所有目标都携白名单校验的 `returnTo` 返回班组/工人来源；列表保留搜索、工种、排序、页码 | 闭合；公共 Target Registry 按稳定 ID 解析；责任户/工资/扣罚携 `dataOrigin + ownerKind + ownerId` 进入只读事实详情，不按名称猜测或借编辑表单 |
| `N-SUPPLIER-NAME` | `supplier` `/base/supplier` | 分供方名称 | `supplier.id + dataOrigin` resolved | `/base/supplier/:id?origin=` | 返回中央列表原搜索、类别、资料状态、排序、页码与原行焦点 | 闭合 |
| `N-SUPPLIER-PROJECT` | `supplier` `/base/supplier/:id` | 合作项目 | `project.id + supplier.id` resolved | `/project/:pid/supplier/:sid`，`?tab=projects` 为来源视图 | 返回分供方详情合作项目页签 | 闭合 |
| `N-SUPPLIER-CONTRACT` | `supplier` `/base/supplier/:id` | 累计合同/累计结算及行内合同、项目 | 明确聚合目标；允许目标 0 条 | `?tab=contracts` / `?tab=settlements`，行到 `/contract/:id`、`/project/:id`；无 canonical 结算详情时行保持不可导航 | 返回同一分供方事实页签 | 闭合；结算不再借合同页签或旧累计字段 |
| `N-SUPPLIER-INVOICE` | `supplier` `/base/supplier/:id` | 累计收票/发票号 | 明确聚合目标 | `?tab=invoices`，行到 `/finance/invoice/:id` | 返回同一页签/分页 | 闭合 |
| `N-SUPPLIER-PAYMENT` | `supplier` `/base/supplier/:id` | 累计付款/付款申请号 | 明确聚合目标 | `?tab=payments`，行到 `/finance/payment/:id/detail` | 返回同一页签/分页 | 闭合 |
| `N-SUPPLIER-CREDENTIAL` | `supplier` `/base/supplier/:id` | 证照附件 | 分供方稳定 ID | `/base/supplier/credential/:id` 独立专用路由 | 返回同一中央详情及来源 | 闭合既有专用文件/审计边界；未接入专用存储时显示不可用，不创建平行正式主档 |
| `N-SUPPLIER-NONACTION` | `supplier` 列表/详情 | 列表失效金额、应付金额 | 无可靠目标 | — | 不导航 | 非入口；不能复制“蓝色但无操作” |
| `N-PROJECT-SUPPLIER-TABS` | `project-supplier` 工作台 | 项目/分供方名称与六页签 | 两个 ID resolved | `/project/:pid`、`/base/supplier/:sid`；`?tab=overview,contract,claim,ticket,payment,settlement` | 刷新/浏览器返回恢复页签 | 闭合 |
| `N-PROJECT-SUPPLIER-SOURCES` | `project-supplier` 工作台 | 合同/请款/收票/支付/结算/文件来源 | 每行稳定源 ID + variant + `dataOrigin` | 演示合同 `/contract/:id`、演示付款申请 `/finance/payment/:id/detail`；其他来源保持 `unverified-target` | 已验证目标校验 `dataOrigin/projectId/supplierId/returnTo` 后返回原页签 | 部分；#317 统一语义意图与受限返回，正式中央来源及读写混用目标不回落本地编辑页；待各域只读页消费同一来源策略后开放 |
| `N-CORE-CONTRACT` | `core-contract` 三类合同列表 | 合同名称、项目、客户/分供方 | 相应 ref resolved；材采另带 `dataOrigin + contractKind='材采'` | `/contract/:id`、`/project/:id`、主数据详情 | 材采返回白名单 `returnTo` 中的搜索/项目/分供方/状态/页码；其余保持原合同类别上下文 | 部分；#318 已闭合材采中央列表—七页签详情—显式编辑—读回，演示只读；发票/付款等事实保留稳定 ID 但在目标页消费同一来源前为 `unverified-target`；施工/分包详情仍待后续票 |
| `N-CONTRACT-SOURCE` | `core-contract` `/contract/:id` | 关联甲方/分包单据、BOQ 变更/月报量 | 源 ID + variant resolved | `/owner/:kind/:id`、`/subcontract/:kind/:id`、`/contract/boq?project=:pid&contract=:cid` | 返回合同原页签和行 | 部分；单据详情当前读写混用 |
| `N-CONTRACT-SUPPLEMENT` | `core-contract` `/contract/:id` | 补充协议 | supplement ID resolved | `/contract/:id` 的补充协议聚焦视图 | 返回合同原区块 | 部分；尚无稳定 `focus` 深链，不保留无目标蓝字 |
| `N-AUX-CONTRACT` | `aux-contract` 辅助合同/结算列表 | 名称、项目、分供方、来源合同 | ID + variant resolved | 当前进入各 variant 已登记的辅助合同/结算表单路径 | 返回原 `project/contract/supplier`、搜索/类型/状态/页码 | 待只读页；来源 query 可读但返回会丢失 |
| `N-OWNER-DOCUMENT` | `owner-document` 甲方六类列表 | 编号/名称 | ID + canonical variant | 当前 `/owner/:kind/:id` | 返回来源列表及筛选 | 待只读页；参考已证明独立详情，当前是编辑表单 |
| `N-OWNER-RELATIONS` | `owner-document` 甲方报量/验收详情 | 项目、施工合同、客户、源单 | ref resolved | `/project/:id`、`/contract/:id`、`/base/customer/:id` 与源单路由 | 返回原详情区块 | 部分；详情壳待实现；验收/保修共用同一实体双视图 |
| `N-SUBCONTRACT-DOCUMENT` | `subcontract-document` 分包三类列表 | 编号/名称、项目、合同、分供方/班组 | ID + variant resolved | 当前 `/subcontract/:kind/:id` 或 `/project/penalty/:id` | 返回筛选/页码/滚动 | 待只读页；当前主链接进入编辑表单 |
| `N-MATERIAL-DOCUMENT` | `material` 下料/到货/领用/盘点 | 单据编号/名称 | ID + variant resolved | 对应 `/material/requisition/:id`、`/material/arrival/:id`、`/material/use/:id`、`/material/stock-check/:id` | 返回列表项目/分供方/仓库/状态/页码 | 待只读页；现有路径均为编辑表单 |
| `N-MATERIAL-RELATIONS` | `material` 单据/材采合同物资页签 | 项目、合同、分供方、送货归档、仓库、来源批次、结算 | 相应 ref resolved | `/project/:id`、`/contract/:id`、`/base/supplier/:id`、`/material/delivery/archive/:id` 及结算 variant | 返回来源页签/子表 | 部分；仓库、到货—归档、结算分摊、领用批次和调拨两端缺 canonical 关系 |
| `N-OWNER-MATERIAL` | `owner-material` 五类列表/项目物资页签 | 单据号、项目、供货单位、送货单、仓库、班组/班组合同 | ID + variant resolved | 对应五条已登记的甲供材表单路径，关系到项目/主数据/合同/归档详情 | 返回来源、页签、子表、筛选、页码、滚动 | 待只读页；供货身份/总计划头行/仓库等缺关系时不得链接 |
| `N-DELIVERY-ARCHIVE` | `delivery` 归档库/项目归档 | 送货单号、项目、分供方 | ref resolved | `/material/delivery/archive/:id`、`/project/:id`、`/base/supplier/:id` | 返回项目—分供方树、搜索、日期和页码 | 部分；详情闭合，返回树上下文待统一 |
| `N-MATERIAL-PRICE` | `material-price` 价格事实 | 来源送货单、相关厂家历史合同 | 价格行必须有 delivery record/line ID；合同有 contract ID | `/material/delivery/archive/:id`、`/contract/:id` | 返回材料/规格/供应商/时间筛选 | 闭合主链；历史合同不是单个价格点来源 |
| `N-FINANCE-INCOME` | `finance-income` 开票/收款/往来列表 | 申请名称或编号 | ID + variant resolved | `/finance/billing/:id`、`/finance/receipt/:id?origin=:dataOrigin&customerId=:customerId`、`/finance/current/:id` | 返回分类、搜索、页码和滚动 | 部分；中央收款关系已从客户详情进入只读详情，旧本地收款未携带中央来源时只显示普通文本，编辑走 `/finance/receipt/form/:id`；开票与往来仍读写混用，往来付款参考目标待补证 |
| `N-FINANCE-INCOME-REL` | `finance-income` 详情/项目财务页签 | 项目、客户、合同、来源单据 | ref resolved | `/project/:id`、`/base/customer/:id`、`/contract/:id` 与源单路由 | 返回详情原区块或项目财务页签 | 部分；通用列表 DTO 必须补真实关系 ID |
| `N-PAYMENT-APPLICATION` | `finance-expense` 付款申请/付款管理/分供方/项目×分供方 | 申请编号/名称 | payment application ref resolved | `/finance/payment/:id/detail`；来源可带 `projectId/supplierId` | 返回原列表分类/筛选/页码或来源工作台 | 部分；专属详情闭合，来源返回未统一 |
| `N-PAYMENT-DETAIL-REL` | `finance-expense` 付款申请详情 | 项目、分供方、合同、发票、支付记录 | ref resolved | `/project/:id`、`/base/supplier/:id`、`/contract/:id`、`/finance/invoice/:id`、`/finance/records/:id` | 返回同一付款申请页签 | 闭合主链 |
| `N-PAYMENT-INSIGHT` | `finance-expense` `/finance/payment/:id/detail` | 业务洞察浮标 | 当前详情组件挂载且付款申请 ID resolved | 同路由右侧 overlay；请求按业务元数据名、记录 code、`detail` 位置计算 | 关闭仍在原记录；切记录必须换 subject；页签栏刷新收起 overlay | 直接证据；列表、合同详情、付款管理、支付记录、费用报销未挂载。通用引擎可配置其他实体，本地首版只承诺付款申请 |
| `N-PAYMENT-INSIGHT-REPORT` | `finance-expense` 洞察跨项目/跨供应商报表 | 报表行/金额 | 只有返回明确 NavigationIntent 才可点 | 当前无已验证目标 | 保持 overlay 与当前付款记录 | 待补证；可见蓝色样式不能自动解释为链接 |
| `N-PAYMENT-RECORD` | `finance-expense` 支付记录/报销 | 编号/名称、付款申请分摊 | stable ID | `/finance/records/:id`、`/finance/reimbursement/:id`、付款申请详情 | 返回原列表筛选 | 待只读页；支付/报销详情当前读写混用 |
| `N-INVOICE` | `invoice` 收票/归档台账 | 发票号、项目、分供方、合同、付款申请 | 对应 ref resolved | `/finance/invoice/:id` 与项目/分供方/合同/付款详情 | 返回上传/校对/台账来源 | 部分；单表状态机正确，来源返回和关系 ID 仍需补齐 |
| `N-SCHEDULE-QUANTITY` | `schedule-target-cost` 排程工序详情 | 工程量矩阵 | project/group/task/stage/item 稳定 ID | `/subcontract/quantity` + `project/group/buildings/task/stage/item`，名称与日期仅提示 | `/schedule?project=:pid&group=:gid&task=:tid` | 闭合 |
| `N-QUANTITY-UNIT` | `quantity-payroll` 工程量矩阵 | 户施工详情 | project + unit ID resolved | `/subcontract/quantity/:pid/:uid`，带 `project/building/month/view/trade/assignee` | 原六项筛选 | 闭合 |
| `N-PAYROLL-FLOW` | `quantity-payroll` 工资台账 | 新建草稿、考勤、工资详情 | 项目/月/班组及单据 ID resolved | `/subcontract/payroll/new`、`/subcontract/attendance`、`/subcontract/payroll/:id` | 返回 `project/month/crew/status` | 部分；建单/考勤闭合，详情固定退工资根路由 |
| `N-DAYWORK-FLOW` | `quantity-payroll` 考勤/工资台账 | C2 零星签工 | 项目/月/班组上下文 | `/subcontract/daywork` | 返回考勤或工资原筛选 | 部分；当前忽略来源 query 且两侧都退根路由 |
| `N-TARGET-COST` | `schedule-target-cost` 目标成本列表/详情 | 名称、项目、已签合同额 | ref 或明确聚合目标 | `/project/target-cost/:id`、`/project/:id`；已签合同额进入当前版本合同聚合区 | 返回列表筛选/详情区块 | 部分；名称/项目闭合，金额聚合锚点待实现 |
| `N-IMPORT-EXPORT` | `import-export` 映射/导出配置 | 返回来源、错误行源实体、生成结果 | 来源为站内 route key；文件 capability resolved | 返回调用页或受控文件预览 | 恢复调用页上下文 | 部分；不得把原始文件路径或私有 URL 当路由 |
| `N-OCR-SETTINGS` | `ocr-settings` `/settings/ocr` | 无业务实体关系入口 | — | 仅侧栏导航 `/settings/ocr` | 返回原应用页签 | 非入口；Token/API 地址永不进入导航 DTO |
| `N-SHELL-NOTIFICATION` | `shell` 顶栏 toast/消息抽屉 | 消息主体/查看动作 | `NotificationDTO.target` resolved 且未 forbidden | 由本矩阵解析 `open-entity/open-list`；后台不传路由字符串 | 关闭抽屉后目标页保留自己的返回上下文 | 部分；本地静态 route 字符串和 5 条 seed 必须迁移 |
| `N-SHELL-TABS` | `shell` 应用内部页签 | 页签切换、溢出、刷新 | 仅当前活动实例 | 切换不新建业务事实；刷新只重取当前页并重置局部 overlay | 页签状态按实例隔离 | 直接证据：28 个内部页签不等于 28 个浏览器页；详见 §5 |

## 5. 付款洞察与多页签影响因素

2026-08-13 的严格只读对照使用同一浏览器标签页内的 28 个应用页签完成。结论如下：

1. **挂载位置**：目前直接验证的入口是付款申请详情。付款申请列表、支出合同详情、付款管理、支付记录和费用报销均没有可见入口。不能据此断言通用引擎永远只支持付款；公开前端实现显示它按业务元数据和记录 code 调用通用分析 operation，本地只在已有直接证据的付款申请详情落首版。
2. **记录作用域**：两个付款申请详情都显示浮标；切换记录时当前合同/付款/票款检查会换成新记录结果，不能缓存上一单完整侧栏。
3. **聚合作用域**：同一侧栏还包含跨项目和跨供应商报表。这部分不是当前项目私有数据，应按报表 key、用户可见范围、统计时点和来源版本缓存。
4. **内部页签**：应用页签会保留各详情组件状态；面板打开时切换另一付款详情，可继续打开并换用新 subject。切到列表或其他业务页后入口和面板都不可见，没有观察到由页签数量造成的数据串页。
5. **刷新**：页签栏刷新后右侧面板收起，但付款详情浮标仍存在；刷新影响局部展开状态，不决定功能资格。
6. **浮标位置**：参考实现只把按钮位置按企业/记录保存为本地 UI 偏好。位置缓存不能携带洞察结果、权限或业务状态。
7. **审批链**：普通详情分析与审批流分析是两个语义 operation；审批场景额外使用流程定义和活动节点身份。瑞航实现不能把“详情查看”结果直接当审批阻断结论。
8. **面板蓝色样式**：当前跨项目/跨供应商表格的项目名和金额在可访问结构中不是已验证链接；在没有明确 target DTO 前保持只读表格，不按颜色猜跳转。

因此，多开应用页签本身不是洞察出现的原因；真正影响因素是：页面是否挂载洞察组件、业务元数据是否配置、当前记录 ID/code、详情/审批位置、用户可见范围、统计时点/来源版本，以及局部 overlay 展开状态。

## 6. 当前统一实施顺序

1. 在 #312 已建立的唯一前端 Target Registry 上继续登记班组、工人、付款申请、支付记录、目标成本、送货归档和工程量户；多态对象必须通过 variant 解析。项目详情目标已经接入，不再新增领域内 route map。
2. 建立站内 `returnTo` 编解码/校验器，并让列表、详情、项目×分供方、工资/C2、材料和财务目标页按白名单消费 query。
3. 先为甲方/分包/材料/辅助合同结算/普通财务对象补独立只读详情，再把主链接从编辑表单切走；编辑入口保持显式动作。
4. 金额链接改为由 `MetricDTO.drilldown` 决定；值为 0 可以进入真实空表，`null`、missing、forbidden 和无目标继续退化。
5. 通知、洞察报表行和文件来源统一输出 `NavigationIntentDTO`，去掉 store 内业务 route 字符串；未知目标保持不可达而不是猜路径。
6. 路由、目标、返回 query 或实体 variant 发生变化时，同一工作单元更新本文、[`READ-MODELS.md`](./READ-MODELS.md)、对应页面蓝本和验收测试。

## 7. 验收

- 20 个生产页面域及应用壳公共入口均在矩阵中有记录；没有入口的域也明确标为非入口。
- 矩阵内所有具体目标路径均命中现有生产路由；规划中的通配说明不能冒充可访问 URL。
- 每个蓝链均能区分 resolved、missing、forbidden、not-connected、unverified-target 和 error。
- 列表 → 详情 → 关系目标 → 返回可恢复原筛选、页签、分页和必要锚点；无效 query 不改变实体身份。
- 0 条目标能显示真实空态；未读取、权限不可见、错误和缺关系不显示伪造 0 条。
- 付款洞察按记录级和跨域报表级分别缓存；切换应用页签、切换付款记录、局部刷新和关闭面板均不串用结果。
- 通知与洞察只返回语义目标；后端、seed 和参考私有接口均不成为前端路由权威。
