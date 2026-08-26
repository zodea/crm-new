# 核心合同 — 施工 / 分包 / 材料采购

> 路由：`/contract/construction`、`/contract/subcontract`、`/contract/material`、`/contract/:id`
> 数据权威：`contracts`、`contract_supplements`、`contract_line_items` 及各业务单据的 `contract_id`
> 表单字段与写入规则：[`contract-forms.md`](./contract-forms.md)

## 一、列表

三类列表共用一套紧凑工具栏、分页和行操作，但列与交易方向按合同类型展示，不能把支出侧词义套到施工合同。

### 统一筛选与操作

- 搜索：合同名称或合同编号。
- 项目：仅使用 `contracts.project_id`。
- 交易对方：施工合同按 `customer_id` 筛选客户；分包与材料采购合同按 `supplier_id` 筛选分供方。
- 状态：全部、草稿、审批中、履约中、已签订、已结算、已结清。
- 刷新、新增、查看详情、编辑、删除与分页。
- 分包保留劳务 / 专业分类；材料采购保留单层“全部材料采购合同”分类。

项目、客户和分供方名称来自真实外键连接。长名称提供完整标题，合同编号和金额不因窄视口被截断；密集表格只在自身区域横向滚动。

### 列与金额方向

| 合同类型 | 交易对方 | 专有列 | 票款方向 |
|---|---|---|---|
| 施工 | 客户 | 甲方（客户） | 累计开票、累计收款、按结算应收余额 |
| 分包 | 分供方 | 劳务 / 专业类别 | 累计收票、累计支付、按结算应付余额 |
| 材料采购 | 分供方 | 材料采购合同分类 | 累计收票、累计支付、按结算应付余额 |

### 参考运行态补齐目标（#282）

当前三类列表已有真实合同、项目、客户/分供方和金额聚合，但专有列还没有完全复刻。后续实现必须保留同一紧凑表格骨架，同时按合同类型返回不同投影：

| 合同类型 | 必须补齐的专有列 | 数据口径与缺口 |
| --- | --- | --- |
| 施工 | 实际竣工日期、签约日期、含税/变更后金额、合同已结算、累计开票、累计收款、按结算应收、开票未回 | #320 已按中央读模型投影；`开票未回 = 累计开票 - 累计收款` 只作派生显示；实际竣工日期由 canonical `contracts.actual_completion_date` 提供，迁移前保持 `null` 并显示“未记录”，不得用合同结束日期代替 |
| 分包 | 劳务/专业类别、累计结算/收票/支付、按结算应付、按收票应付、完工审定金额、结算状态、结清状态 | #321 已按中央读模型投影；完工审定只汇总真实完工结算；按收票应付由收票与已确认支付派生；结清是独立业务事实，不能因余额为 0 自动认定 |
| 材料采购 | 合同金额、变更后金额、累计结算/收票/支付、按结算/按收票应付 | 延续材料合同运行态证据，不把材料采购明细金额重复当作结算或收票事实 |

合同名称、项目名称、施工甲方、支出侧乙方均为可聚焦关系入口。列表筛选必须写入 URL 查询参数（`q`、`project`、`party`、`status`、`category`、`page`、`pageSize`）；进入详情后关闭或返回要恢复原筛选、页码和滚动位置，而不是跳回无条件列表。

列表聚合只读取合同外键可追溯的事实：

- 变更后合同金额：施工合同为“合同金额 + 有效补充协议 + 已审定甲方变洽签”；分包、材料采购当前为“合同金额 + 有效补充协议”；
- 施工累计结算：非草稿甲方报量；
- 支出侧累计结算：非草稿支出结算；
- 施工累计开票：非草稿开票申请；
- 支出侧累计收票：已归档且关联当前合同的发票；
- 施工累计收款：非草稿且关联当前合同的收款登记；
- 支出侧累计支付：已确认支付记录经付款申请分摊到当前合同的金额。

不得按项目、分供方、合同名称或金额相近推断合同归属；存量静态金额不回填到缺失的关联单据。

## 二、通用合同详情

> 当前实现边界（#318、#319、#320、#321）：材料采购、施工与分包合同已分别切到中央专属列表、七分区只读详情和正式中央表单。三类入口意图都必须携带 `dataOrigin` 与对应 `contractKind`；演示数据只读。

详情共用顶部合同标题、编号、类型、状态、编辑入口和六项金额摘要。合同阶段只根据 `contracts.status` 展示“拟定 → 审批与签订 → 履约 → 结算 → 结清”，不伪造审批人或审批记录。

### 基本信息

合同编号、合同类型、所属项目、客户或分供方、签约日期、发票类型、履约联系人、联系电话、合同内容、主要条款和备注。项目、客户、分供方均提供真实详情下钻；联系电话在只读详情中脱敏。

### 关联单据

“关联单据”只展示具有当前 `contract_id` 的记录，并保留来源类型、编号、名称或摘要、关联金额、业务日期、状态和可用详情入口。

| 合同类型 | 可见来源 |
|---|---|
| 全部 | `contract_supplements` |
| 施工 | `owner_change_orders`、`monthly_statements`、`owner_final_settlements`、`invoice_applications`、`receipt_registrations` |
| 分包 | `subcontract_change_orders`、`expenditure_settlements`、`invoices`、`payment_applications` 及已确认支付分摊 |
| 材料采购 | `expenditure_settlements`、`invoices`、`payment_applications` 及已确认支付分摊、`material_requisitions`、`material_arrivals` |

没有真实外键关系时展示“暂无关联单据”，不以同项目记录填充空白。

### 类型专有页签

- 材料采购合同显示“采购明细”，读取 `contract_line_items`，金额由数量 × 含税单价只读派生。
- 施工和分包合同不显示采购明细，也不凭空增加合同明细。
- 三类合同均显示“合同文件”，读取 `file_refs(owner_type='contract', owner_id=合同 ID)`；文件维护仍在合同编辑页完成。

运行态走查已证明三类合同不能继续只显示一组通用页签。通用“关联单据”读模型保留为后台聚合能力，前台按类型拆成下列稳定分组；没有记录时仍显示表头和真实空态。

| 合同类型 | 详情分组 | 本地真实来源与下钻 |
| --- | --- | --- |
| 施工 | 详细资料 | `contracts`、合同附件；项目、客户走真实详情路由 |
| 施工 | 补充合同 | `contract_supplements`；无独立详情路由，由 Target Registry 深链到 `/contract/:id?tab=supplements&focus=:supplementId`；读取时验证补充协议存在且属于当前主合同，不能保留不可点击的蓝字 |
| 施工 | 甲方变洽签 | `owner_change_orders.contract_id` → `/owner/change/:sourceId` |
| 施工 | 验收结算 | `owner_final_settlements`、`owner_penalties`；按来源单据分别下钻，不合并成无类型通用行 |
| 施工 | 票税管理 | `invoice_applications` 与销项开票事实；开票申请已有路由，开票登记缺失部分由财务链路票补齐，当前不能用申请状态冒充已开票登记 |
| 施工 | 收款登记 | `receipt_registrations.contract_id` → `/finance/receipt/:id` |
| 施工 | 竣工验收及保修 | `project_acceptances.contract_id`；竣工验收与保修到期为同 acceptance ID 的两个 canonical 分组，分别以 `focusView=acceptance\|warranty` 聚焦 |
| 分包 | 详细资料 | `contracts`、合同附件；项目、分供方走真实详情路由 |
| 分包 | 分包变洽签 | `contract_supplements` 由 Target Registry 深链到 `/contract/:id?tab=changes&focus=:supplementId`；与 `subcontract_change_orders.contract_id` 分区展示，后者按已核验目标下钻 |
| 分包 | 收票登记 | `invoices.contract_id` → `/finance/invoice/:id` |
| 分包 | 付款信息 | `payment_applications.contract_id` 与已确认 `payment_records` 分摊；付款申请和支付明细分区展示 |
| 分包 | 支出结算 | `expenditure_settlements.contract_id`，按过程结算/完工结算分区 → `/subcontract/settlement/:id` |
| 分包 | 项目罚扣 | `penalty_records.contract_id` 及 `penalty_settlement_deductions` → `/subcontract/penalty/:id` |
| 分包 | 材料领用情况 | 参考页分新仓/历史领用；当前 `material_uses` 没有合同或分供方外键，先保留空页签和字段规格，不按项目/班组猜合同归属 |
| 材料采购 | 详细资料、采购合同明细、物资管理、收票登记、付款信息、支出结算、项目罚扣 | 各分组复用同一来源 DTO，不复制静态金额；合同分供方可进入同来源合同/结算/收票/付款事实页签，其他尚未消费同一中央来源的行目标保持 `unverified-target` 普通文本 |

施工七组在 URL 中以 `tab=info|supplements|changes|settlements|invoices|receipts|acceptance` 恢复；补充合同使用同一详情的稳定 `focus` 深链，验收/保修再以 `focusView` 区分同 ID 的两个分组。目标不存在与父子错配分别显示，返回时恢复原施工合同列表筛选、分页、滚动、合同焦点以及验收/保修分组。甲方变洽签、月报量、最终结算、开票申请、收款、验收与保修只按稳定来源 ID 生成目标。详情显式编辑进入独立整页表单，保存或生命周期动作后回到同一详情并保留嵌套列表返回上下文。刷新失败时保留上一版成功详情并提示重试；实际竣工日期为 `null` 时显示“未记录”。

分包七组在 URL 中以 `tab=info|changes|invoices|payments|settlements|penalties|material-uses` 恢复；补充合同在“分包变洽签”中按稳定 `focus` 深链并验证父合同，返回时恢复原分包合同列表筛选、分页、滚动和合同焦点。付款申请与付款登记、过程结算与完工结算分区展示。`material_uses` 缺少合同/分供方外键时返回 `missing-relation` 空态，不按项目、班组或名称猜测。

材料采购七组在 URL 中以 `tab=info|lines|materials|invoices|payments|settlements|penalties` 恢复；物资管理内部只展示已核验的下料、到货事实，直调、出库及其他缺稳定外键集合返回真实空态。合同到分供方事实的 `tab=contracts|settlements|invoices|payments` 只接受白名单值，返回时保留原合同页签及材采列表上下文。正式详情才显示显式编辑入口，演示详情即使有相同字段也始终只读。

审批历史和完整流程只在本地存在真实审批事件时显示；没有审批事件表时保留合同阶段，不用人员种子拼出参考审批流。参考站的打印、下载、评论、文件操作、转需用计划均未获写入验证，不纳入本轮复刻范围。

## 三、工程量清单关联闭环

`/contract/boq` 已由 SQLite 实体闭合，不使用 MockJS：

- 项目与施工合同通过 `project_id + contract_id` 选择，合同名称进入 `/contract/:id`；查询参数保留 `project`、`contract` 和 `tab`。
- 合同清单读取 `boq_files`、`boq_lines`，保留文件、sheet、行号来源追溯键；清单行可沿稳定 `boqLine` 进入现场工程量和排程。
- 变更读取 `boq_change_orders`、`boq_change_lines`；只有已签证且存在 `ledger_id` 的编号可进入对应甲方变洽签，其他状态显示纯文本。
- 月度报量读取 `monthly_statements`、`monthly_statement_lines`；同一记录进入 `/owner/report/:id`，草稿调整不推进申报/审定状态。
- 当前脱敏种子含施工 12、分包 9、材采 10 份合同，但下游样本稀疏：补充协议、BOQ 文件、变更和月报量各只有少量样本。空态用于验证布局，不能伪造更多合作、票款或结算记录。
- 参考站没有安全直接证据的导入、编辑、生成、导出与附件动作继续由 [`boq-import.md`](./boq-import.md)、ADR 0002 和本地事务测试裁定，不因只读走查改变。

## 四、后台接口投影

后端接口以数据库真实外键为源，前端不再自行拼接名称或 Mock 聚合。共享关系、金额、分页、空态、权限与错误语义统一引用 [`READ-MODELS.md`](../READ-MODELS.md)；其中 `MoneyDTO` 是固定两位十进制定点字符串，关系目标路由由前端路由矩阵生成。合同域稳定为三层响应：

```ts
interface ContractListQueryDTO {
  kind: 'construction' | 'subcontract' | 'material'
  q?: string
  projectId?: string
  partyId?: string
  status?: string
  category?: string
  page: number
  pageSize: number
}

interface ContractListRowDTO {
  id: string
  no: string
  name: string
  kind: 'construction' | 'subcontract' | 'material'
  project: EntityRefDTO
  party: EntityRefDTO
  signDate: string | null
  actualCompletionDate?: string | null
  amounts: {
    contract: MoneyDTO
    changed: MoneyDTO
    settled: MoneyDTO
    invoiced: MoneyDTO
    paid: MoneyDTO
    bySettlementBalance: MoneyDTO
    byInvoiceBalance?: MoneyDTO
    completionSettlement?: MoneyDTO
  }
  contractStatus: string
  settlementStatus?: string | null
  clearanceStatus?: string | null
}

interface RelatedDocumentDTO {
  id: string
  type: string
  no: string
  name: string
  amount: MoneyDTO | null
  date: string | null
  status: string
  contractId: OpaqueIdDTO
}

interface ContractDetailDTO {
  contract: ContractListRowDTO
  sections: Array<{
    key: string
    label: string
    rows: RelatedDocumentDTO[]
    emptyReason?: 'no-records' | 'missing-relation' | 'permission-denied'
  }>
}
```

列表响应使用共享 `PageDTO`，汇总与分页读取同一筛选；BOQ 工作台响应继续按 `projectId + contractId` 返回 `files / lines / changes / monthlyStatements / summary`。金额不传货币符号或格式化文本；缺失关系、真实空集合与权限拒绝按共享语义区分，禁止用名称、同项目或相近金额补链。

## 五、响应式与可达性

- 在 390、768、1024、1280–1440px 无页面级横向滚动。
- 合同长名称允许换行，长编号允许断行且完整保留。
- 关联单据和采购明细由各自表格区域横向滚动。
- 页签支持键盘方向键切换，当前合同阶段使用 `aria-current="step"`。
- 空态、读取失败和不存在状态均有明确文字，不以空白表格代替。
