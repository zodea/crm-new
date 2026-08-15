# 物资管理表单 — 乙供材与甲供材

> 表单蓝本：`MaterialForms.jsx` 中除 `deliveryArchiveForm` 外的 10 条路由
> 持久化权威：`DATABASE.md` §2.5
> 视觉参考：[ADR 0013](../../adr/0013-align-all-ui-to-online-design.md) · [运行态参考审计](../../design/runtime-reference-audit.md)

## 运行态参考与当前边界（2026-08-13）

本轮以“车陂商业大楼项目”为主样本，按严格只读协议查看参考站的仓库档案、下料单、材料到货、材料领用、乙供材直入直出、批量调拨、库存盘点、材料采购合同及合同内“物资管理”页签；随后补验甲供材总控量、甲供材下料单、甲供材到货、甲供材领用、甲供材直入直出五类全局列表，以及项目详情内“物资管理”、阶段资料、项目成员与文件区。材料采购结算沿用 [`contract-forms.md`](./contract-forms.md) 的同轮直接证据。未点击新建、编辑、删除、上传、下载、导入、导出、审批、打印、评论、文件或行级操作。

### 乙供材参考列表与详情构图

| 参考入口 | 可见读模型 | 当前样本 | 对瑞航的约束 |
| --- | --- | --- | --- |
| 仓库档案 | 仓库名称、类型、项目、状态、计价方式、描述、负责人、创建时间、项目默认仓库、操作 | 0 条 | 即使为空也保留仓库专属表头；仓库不是自由文本筛选项 |
| 下料单 | 单据名称、业务类型、审批状态、项目、供应商、到货情况、明细数、已完成/部分/未完成入库数、创建日期、编号、操作 | 0 条 | 到货进度是由关联到货事实聚合的读模型，不写回手工累计列 |
| 材料到货 | 编号、填单时差、源单据、类型、项目、分供方、送货单号、到货日、仓库、采购类型、生效/领料/可结算/付款状态、累计结算/付款、备注、操作 | 0 条 | 源单、送货单、合同、仓库、结算和付款必须保留真实 ID；空表也不能压成通用“材料/对象”列 |
| 材料领用 | 编号、类型、项目、出库日、分供方、仓库、领料人、生效状态、是否班组领用、班组、班组合同、出库金额、非班组说明、操作 | 0 条 | 班组与班组合同是独立关系；领用不能只剩材料名称、数量和日期 |
| 乙供材直入直出 | 编号、业务类型、负责人、项目、创建人、审批状态、到货金额、创建时间、送货单号、合同、分供方、领料人、修改人/时间、操作 | 0 条 | 它是乙供材专属业务单据，不得复用甲供材直入直出实体 |
| 批量调拨 | 编号、计划日期、调出项目/仓库、调入项目/仓库、生效状态、生单状态、附件、操作 | 0 条 | 调出与调入两端都需要真实项目、仓库 ID；不能用备注表达调拨 |
| 库存盘点 | 编号、项目、仓库、盘点人、盘点日期、生效状态、操作 | 0 条 | 盘点归属必须可追到项目和仓库；明细继续由瑞航本地规格裁定 |
| 材采合同 · 物资管理 | 新/历史入库、直入直出、新/历史出库五组；保留原单、日期、仓库、金额、结算余额、付款状态、班组合同等专属列 | 当前合同五组均为 0 条 | 合同详情即物资链的只读聚合入口；没有记录仍展示五组表头和真实空态 |

所有列表采用“有业务意义时才出现的单层分类 + 单行工具栏 + 紧凑宽表 + 表格内横向滚动 + 底部汇总/分页”。流程阶段和状态使用小型节点或行内标签，不使用占据首屏的大卡片；详情资料采用白底标签—值平铺和轻边界分区，不给每个字段套灰色背景格。固定截图尺寸不是实现合同，仍需在 390 / 768 / 1024 / 1280–1440px 验证。

### 甲供材五类列表与项目资料构图

参考站五类全局列表当前均为 0 条，但分类、专属表头、真实空态和 20 条/页分页完整保留，因此空记录不能作为继续复用通用“材料/对象—数量—日期”列表的理由。

| 参考入口 | 分类/视图 | 可见专属列 | 当前样本与实现约束 |
| --- | --- | --- | --- |
| 甲供材总控量 | 全部物资总计划 | 单据编号、项目名称、计划日期、备注、是否需要盖章、说明、附件、操作 | 0 条；表头另有二级展开位，证明这是总计划单据读模型，不等同于本地单行材料总控事实。详情明细不可见前不据展开位猜行字段 |
| 甲供材下料单 | 全部物资需用计划 | 单据名称、业务类型、审批状态、项目名称、计划日期、要求到货日期、下料金额合计、创建人、备注、到货情况、操作 | 0 条；到货情况和金额是派生读模型，不能写回手工累计列 |
| 甲供材到货 | 全部类型 / 直入入库 / 甲供材入库；全部未完全出库入库单【新】 | 单据编号、入库—填单日期差、源单据、类型、项目、分供方、送货单编号、入库日期、仓库、采购类型、生效/领料/可结算/付款状态、到货及结算付款金额链、备注、操作 | 0 条；源单、分供方、送货单、仓库和金额状态都必须来自真实关系或可空快照，不得用项目、客户或材料名称代填 |
| 甲供材领用 | 全部类型 / 直出出库 / 甲供材出库；全部出库单【新】 | 单据编号、类型、负责人、所属部门、创建人/时间、项目、分供方、采购类型、出库日期、领用月份、领用班组、班组合同、操作 | 0 条；班组与班组合同是两个关系，负责人/创建人也不能共用一个自由文本字段 |
| 甲供材直入直出 | 全部直入直出 | 单据编号、业务类型、负责人、项目、仓库、入出日期、采购类型、分供方、送货单照片、送货单编号、操作 | 0 条；照片和单号只登记附件/来源语义，本轮未点击；直入直出仍按本地规则同时形成到货与领用事实但不入仓 |

五类列表共用一套外壳密度，不共用一套业务列。目标布局为“单一白色工作区 + 一行搜索/刷新/排序/筛选/设置/登记型动作 + 专属紧凑宽表 + 右下分页”；分类只有确有业务意义时才占左侧窄栏或行内选择器。当前本地五页虽然已经没有大流程卡，但仍把标题、筛选和表格分成多层带底色 panel，且五页都只有“材料/对象、编号、项目、数量、日期、状态、操作”。实施时应减去多余底色与卡片边界，用留白和细分隔线分区，表格只在自身区域横向滚动。

车陂商业大楼项目详情继续采用紧凑摘要、三组经营数据、小型阶段节点和“左主区 + 右成员/文件”的宽屏双栏；阶段资料直接显示任务名称与归档说明，项目文件只使用文件表格，不给字段加灰色背景。该项目“物资管理”页签当前保留三组独立空表：

| 项目聚合组 | 可见列 | 本地映射边界 |
| --- | --- | --- |
| 物资总计划 | 单据编号、审批状态、计划日期、负责人、创建时间、操作 | 先投影真实项目下甲供材总控单据；参考详情为空，不能把全局列表的盖章/附件或未知明细强行复制到项目表 |
| 物资需用计划 | 单据名称、审批状态、计划日期、要求到货日期、负责人、创建时间、操作 | 投影真实项目下甲供/乙供下料事实，类型差异由来源引用保留 |
| 入库单 | 单据编号、类型、分供方、入库日期、入库仓库、材料采购合同、生效状态、操作 | 甲供到货、乙供到货与送货归档在 canonical 关系闭合前分源展示；不得把本地送货归档直接冒充已入库单 |

本地主项目详情当前“物资管理”只有一张“项目到货归档”表，能真实展示 2 个已归档送货单并下钻详情，但缺少上述三组项目级计划/入库读模型。该归档表属于瑞航已闭环的独有来源视图，应保留为独立组；在到货 ↔ 送货归档关系裁定前不能并入参考“入库单”。参考文件区当前有记录，但本轮未点击文件名、加号或操作列；本地项目档案包仍按 [`project-info.md`](./project-info.md) 的真实 `file_refs` 与 owner 目录规则实现，不复制参考文件正文。

### 只读跳转合同

1. 列表的蓝色单据名称或编号先进入独立只读详情；编辑只由明确的“编辑”动作进入整页表单。当前四类材料列表把名称和“查看/编辑”都直接送进编辑表单，不符合该边界。
2. 项目、分供方、材料采购合同、源单据、送货单、仓库、班组合同和结算名称都是关系入口；目标存在时按真实 ID 下钻，目标为空时展示“未记录”，不得用名称搜索猜 ID。
3. 材料采购合同详情的“物资管理”汇总该合同下的新/历史入库、直入直出和新/历史出库；本地已有 `contract_id → material_requisitions/material_arrivals` 查询基础，但当前下钻仍进入编辑表单，且没有送货归档、出库批次和结算分摊关系。
4. 送货单号进入 `/material/delivery/archive/:id`；归档详情中的项目、分供方继续进入各自详情。材料价格来源使用 `deliveryRecordId + deliveryLineId` 回到同一送货单，合作合同使用 `contractId` 回到合同详情。
5. 任一详情返回列表时必须恢复来源路由、项目/状态/分类筛选、搜索、分页和滚动位置；不得只写死返回域首页。建议统一携带 `from` 或可序列化的列表 query，不把展示名称当返回键。
6. 甲供材五类列表的单据编号/名称同样先进入独立只读详情；当前本地 `/owner-material/*/:id` 全部直接复用编辑表单，必须把“查看”与明确的“编辑”动作分开。参考列表没有记录，因此本轮只锁定入口边界，不外推未知详情页签或审批动作。
7. 甲供材到货的源单据、项目、分供方、送货单和仓库，甲供材领用的项目、分供方、班组与班组合同，以及直入直出的项目、仓库、分供方和送货单都是候选关系字段；只有后端返回稳定 ID 时才渲染蓝链，缺 ID 时显示“未记录”而不是名称搜索结果。
8. 项目详情“物资总计划 / 物资需用计划 / 入库单”使用 `projectId` 作为受限来源上下文；单据下钻后返回原项目、原页签、原子表、筛选、页码和滚动位置。全局列表下钻则返回原全局列表，两个来源不能共用写死返回地址。
9. 参考项目右侧成员编号为可见关系入口，文件名、附件、送货单照片和加号/操作列属于文件或写动作；本轮只登记其位置与字段，不点击、不下载。本地文件继续只读 `file_refs(owner_type, owner_id, category)`，没有正文时展示缺失原因，不生成替代文件。

### 当前本地完成度与实体数据

| 本地范围 | 运行态数据 | 已有能力 | 待补缺口 |
| --- | ---: | --- | --- |
| `/material/requisition` | 0 条种子 | SQLite 头表、项目/材采合同 ID、到货派生量、整页表单 | 专属列表列、只读详情、到货进度计数、供应关系投影、返回上下文 |
| `/material/arrival` | 0 条种子 | 头/明细事务、项目/分供方/合同/下料单 ID、库存派生 | 专属列表列、只读详情、仓库 ID、送货归档 ID、结算/付款快照 |
| `/material/use` | 0 条种子 | 项目/班组 ID、仓库文本、实时库存校验 | 专属列表列、只读详情、仓库 ID、分供方/合同或来源批次、班组合同关系 |
| `/material/stock-check` | 0 条种子 | 头/明细事务、账面量/实盘量/盈亏和生效库存 | 当前没有项目 ID、仓库 ID；通用列表仍显示无来源的“项目”筛选 |
| 仓库档案 / 乙供材直入直出 / 批量调拨 | 无实体、无生产路由 | 无 | 先完成领域实体与迁移裁定，再实现列表/详情/整页表单；不得借用甲供材直入直出 |
| `/material/settlement` | 0 条种子 | 复用真实 `expenditure_settlements` 与材采合同 | 只读详情、到货/送货分摊实体及付款余额读模型见 `contract-forms.md` |
| `/material/delivery/archive` | 3 个归档头、4 条材料明细 | 项目→分供方树、列表、只读详情、项目/分供方下钻、原件缺失态 | 尚未与 `material_arrivals` 建立 canonical 关系；详情返回未保留树节点/筛选上下文 |
| `/material/price` | 现有归档事实被过滤后为 0 个可分析材料 | 来源送货单和历史材采合同下钻均已实现 | `delivery_records.ocr_status='reviewed'` 与分析器要求 `ocrStatus='done'` 的词汇冲突会把 3 个归档头/4 条明细全部过滤，须在读边界统一状态而非补 Mock 数据 |
| `/owner-material/control` | 0 条种子 | 项目/客户 ID、材料维度总控和五项派生量、真实事务约束 | 专属总计划列表、只读详情、计划/盖章/说明/附件读模型；参考空表显示二级展开但明细身份尚不能外推 |
| `/owner-material/requisition` | 0 条种子 | 项目 ID、申请/需用日期、材料计划量、状态事务 | 专属需用计划列表、只读详情、业务类型/审批/金额/创建人与到货进度投影 |
| `/owner-material/arrival` | 0 条种子 | 项目 ID、仓库文本、日期/收货/材料/质检/入库状态、总控校验 | 专属到货列表、只读详情、源单/分供方/送货单/仓库 ID、采购类型和结算付款快照；当前没有单价/金额事实 |
| `/owner-material/use` | 0 条种子 | 项目/班组 ID、领用事实与总控/库存校验 | 专属领用列表、只读详情、负责人/部门/分供方/采购类型/仓库或来源批次/班组合同 ID |
| `/owner-material/direct` | 0 条种子 | 项目/客户 ID、不入库的到货与领用双计事实 | 专属直入直出列表、只读详情、仓库/分供方/采购类型/负责人/送货单号与照片关系 |
| 项目详情 · 物资管理 | 2 个已归档送货单 | 真实项目到货归档、送货单详情及分供方下钻 | 缺参考三组项目读模型；保留归档独立组，不能在到货 canonical 关系建立前冒充“入库单” |

现有实体数据不多：核心乙供材和甲供材 9 张单据头/明细表都没有 JSON 种子记录；甲供材单测和 E2E 会在隔离数据库创建真实关系，但不能作为运行页演示数据。可直接复用的是送货归档的 3 个头和 4 条材料明细，其中 2 个归档头已绑定分供方并含有效单价，足以先修通真实价格读链和跳转，之后再补充业务数据。界面必须把“真实 0 条”与“接口失败/权限不可见”分开，不用 MockJS 或随机行填满空表。

### ID 链、断点与读接口契约

当前可追溯主链为：

```text
project.id / supplier.id / contract.id
  → material_requisitions.contract_id
  → material_arrivals.requisition_id + contract_id + supplier_id
  → 库存派生（warehouse 目前仍是文本）

delivery_records.id
  → delivery_lines.delivery_record_id
  → 材料价格事实（deliveryRecordId + deliveryLineId）
  → 送货单详情

expenditure_settlements.contract_id
  → payment/invoice allocations

project.id
  → owner_material_controls.project_id + customer_id
  → owner_material_requisitions.project_id
  → owner_material_arrivals.project_id
  → owner_material_uses.project_id + crew_id
  → owner_material_directs.project_id + customer_id
  → 甲供三量派生（project_id + material_name + unit）
```

尚未闭合的连接是 `warehouse.id`、到货 ↔ 送货归档、到货 ↔ 材料结算分摊、领用 ↔ 入库批次/采购来源，以及调拨两端。甲供材还缺总计划头 ↔ 材料明细边界、下料 ↔ 到货、到货/领用/直入直出 ↔ 供货单位、送货单、仓库和班组合同的稳定 ID。当前 `customer_id` 只证明项目甲方关系，不能自动解释成参考列表中的“分供方”；项目档案包因此继续使用“甲供材供货单位待配置”，不冒用客户名。没有这些 ID 前，不能靠仓库名、送货单号、材料名或金额近似匹配。到货与送货归档究竟采用单一 `delivery_record_id` 还是分配桥表，必须在数据迁移票中根据“一张原件拆多单/多次入库”的实际口径裁定；甲供材供货单位身份和总计划头/行身份交由后续 DTO/迁移票集中裁定，不在空表走查中猜定。

后端读接口统一使用 [`READ-MODELS.md`](../READ-MODELS.md) 的分页、关系、金额、空态与权限语义；名称只作快照展示，写入仍保存 ID。下列领域结构中的 `MoneyDTO` 均为固定两位十进制定点字符串：

```ts
type EntityRef = EntityRefDTO
type PageResult<T, S = null> = PageDTO<T, S>

interface MaterialDocumentRef {
  id: string
  no: string
  type: 'requisition' | 'arrival' | 'delivery' | 'use' | 'direct' | 'transfer' | 'stock-check' | 'settlement'
}

interface SettlementPaymentSnapshot {
  settlementStatus: string | null
  settledAmount: MoneyDTO | null
  remainingSettleAmount: MoneyDTO | null
  paymentStatus: string | null
  paidAmount: MoneyDTO | null
}

interface OwnerMaterialControlListItem {
  id: string
  no: string
  project: EntityRef
  planDate: string | null
  note: string | null
  requiresSeal: boolean | null
  description: string | null
  attachmentCount: number
  lineCount: number | null
  status: string | null
}

interface OwnerMaterialRequisitionListItem {
  id: string
  no: string
  businessType: string | null
  approvalStatus: string | null
  project: EntityRef
  planDate: string | null
  requiredArrivalDate: string | null
  totalAmount: MoneyDTO | null
  creator: EntityRef | null
  note: string | null
  arrivalProgress: {
    completed: number
    partial: number
    pending: number
  } | null
}

interface OwnerMaterialArrivalListItem {
  id: string
  no: string
  fillDelayDays: number | null
  sourceDocument: MaterialDocumentRef | null
  type: string | null
  project: EntityRef
  supplier: EntityRef | null
  deliveryDocument: MaterialDocumentRef | null
  arrivalDate: string | null
  warehouse: EntityRef | null
  purchaseType: string | null
  effectiveStatus: string | null
  issueStatus: string | null
  totalAmount: MoneyDTO | null
  settlementPayment: SettlementPaymentSnapshot
  note: string | null
}

interface OwnerMaterialUseListItem {
  id: string
  no: string
  type: string | null
  owner: EntityRef | null
  department: EntityRef | null
  creator: EntityRef | null
  createdAt: string
  project: EntityRef
  supplier: EntityRef | null
  purchaseType: string | null
  useDate: string | null
  useMonth: string | null
  crew: EntityRef | null
  crewContract: EntityRef | null
}

interface OwnerMaterialDirectListItem {
  id: string
  no: string
  businessType: string | null
  owner: EntityRef | null
  project: EntityRef
  warehouse: EntityRef | null
  transactionDate: string | null
  purchaseType: string | null
  supplier: EntityRef | null
  deliveryPhotoCount: number
  deliveryNo: string | null
}
```

各列表 DTO 至少包含 `id/no/status/createdAt/updatedAt`，再按领域追加：下料单带 `project/contract/supplier` 与完成/部分/剩余入库计数；到货带 `sourceDocument/project/supplier/contract/deliveryRecord/warehouse` 及结算付款快照；领用带 `project/warehouse/receiver/crew/crewContract/sourceLots`；盘点带 `project/warehouse/checker/date`；调拨带调出/调入两端引用。甲供材五类使用上面的可空读模型，金额按 `MoneyDTO` 传输，日期传 ISO 值，状态传本地稳定 code 并由前端显示中文；权限不可见、关系未配置和真实空值必须是三个可区分状态。上述是瑞航所需的 canonical 读模型，不是对参考站接口名或内部字段的复制；参考空表没有证明的字段只能保持 nullable，不得反向成为必填写模型。

## 一、乙供材

### 下料单 `matRequisitionForm`

| 分区 | 字段与规则 |
|---|---|
| 基本信息 | 下料单编号、项目*、材料采购合同（项目级联）、申请人、下料日期*、需用日期 |
| 材料 | 材料名称*、规格型号、单位、计划量*、已到量（关联到货派生）、到货仓库 |
| 备注 | 用途、状态、备注、下料计划表 |

### 材料到货 `matArrivalForm`

| 分区 | 字段与规则 |
|---|---|
| 基本信息 | 到货单号、项目*、分供方*、采购合同、关联下料单、到货仓库、到货日期*、收货人 |
| 到货明细 | 材料名称*、规格、单位、数量*、单价、派生金额、备注 |
| 质检与附件 | 质检结论、入库状态、备注、送货单扫描件 |

到货头的材料摘要、数量和金额只作明细聚合展示，不作为独立可编辑事实；关联下料单后自动更新已到量。

### 材料领用 `matUseForm`

基本信息：领用单号、项目*、领用仓库、领用日期*。材料与领用：材料名称*、规格、单位、领用数量*、领用人*、领用班组 lookup、用途。备注区包含备注和领料单。

### 材料采购结算 `matSettleForm`

结算单号、结算名称*、项目*、分供方*、采购合同*、结算日期*、结算期间、结算金额*、扣款说明、状态、备注、对账单。合同金额和累计支付只读带出。该表单写入统一支出结算，不建立材料专属结算副本。

### 库存盘点 `stockCheckForm`

| 分区 | 字段与规则 |
|---|---|
| 基本信息 | 盘点编号、仓库*、盘点人*、盘点日期* |
| 盘点明细 | 材料名称*、规格、单位、账面量、实盘量*、派生盈亏量、盈亏金额 |
| 生效与备注 | 状态（草稿/已生效）、备注、盘点表扫描件 |

只有已生效盘点影响库存；物料数与盈亏金额由明细汇总。

## 二、甲供材

| 表单 | 字段与规则 |
|---|---|
| 总控量 `omTotalForm` | 总控编号、项目*、甲供单位客户*、材料*、规格、单位、总控量*、累计到货、累计领用、剩余可用只读、备注 |
| 下料单 `omRequisitionForm` | 下料单编号、项目*、申请人、申请日期*、需用日期、材料*、规格、单位、计划量*、状态、备注、下料计划表 |
| 到货 `omArrivalForm` | 到货单号、项目*、仓库、到货日期*、收货人、材料*、规格、单位、数量*、质检结论、入库状态、备注、送货单 |
| 领用 `omUseForm` | 领用单号、项目*、领用日期*、材料*、单位、数量*、领用人*、班组 lookup、用途、备注 |
| 直入直出 `omDirectForm` | 单据编号、项目*、甲供单位客户、日期*、材料*、单位、数量*、用途、使用部位、备注、签收单 |

累计到货、累计领用和剩余可用均从明细事实派生；表单不得手工覆盖累计值。甲供材不进入乙供材采购合同和材料成本。

## 三、材料单价分析

路由 `/material/price` 只读取已归档送货单的明细价格事实，不另建价格副本。

- 一般材料身份由归一后的“材料名称 + 规格 + 单位”共同确定；`米/m`、`㎡/m²`、`m³/方` 等常见单位写法归一后参与检索和分组。
- 电线电缆优先解析稳定的“型号 + 芯数 + 截面 + 单位”身份。当前已实现 BV、BVR、YJV：BV 全称/简称，以及规格写在名称或规格栏中的 `2.5`、`2.5mm2`、`1×2.5`、`1*2.5` 会归一显示为 `BV 电线 · 1×2.5 mm²`；BVR、YJV 保持各自型号，不与 BV 合并。
- 只规范化精确的基础型号与单一“芯数 × 截面”规格。`ZR-BV`、`NH-BV`、`YJV22` 等型号变体保留原材料身份，不并入基础型号；`4×25+1×16` 等复合规格也不截断归并。上述未支持身份均不关联普通 BV 官方价格。
- `米/m` 归一为 `m`，`千米/km` 归一为 `km`；两种量级始终保持独立，系统不把 `km` 自动改成 `m`，也不静默换算送货单市场单价。
- 归一身份同时保留稳定匹配键，与[广州官方价格信息](https://zfcj.gz.gov.cn/zwgk/zsdwxxgkzl/jsgczjglz/jgxx/)中的材料编码、规格和单位做严格映射；分类命中本身不得产生价格。
- 当前已核实并接入“铜芯聚氯乙烯绝缘电线 BV 1×2.5 mm²”（编码 `280304800070120011`）2026 年 2–6 月税前综合价，原单位为千米，官方事实页面统一换算为元/米后与市场中位价展示趋势和最新偏差。只有规范身份精确等于 `BV + 1 芯 + 2.5 mm² + m` 才匹配该价格；BVR、YJV、BV 其他芯数/截面及千米口径市场价均不得套价。其他材料仅展示十二大类归属及官方来源入口，不推断未核实价格。
- 官方信息价事实保留数据源、分类、月份、材料编码、材料名称、规格、原单位、归一单位、价格和原文链接；信息价是市场综合参考，不是政府定价。
- 搜索支持材料名称、规格和单位；`2.5mm2` 与 `1×2.5 mm²` 等等价截面写法使用同一归一规则。选中一种材料后才展示对应分析，不再铺一张全材料×全厂家假矩阵。
- 同一厂家存在多个日期价格点时展示时间趋势，最多同时显示 4 家厂家；否则按每家最新有效价格做横向比较。
- 横向比较展示最低价、中位价、价差、价格日期和来源送货单；趋势图保留每个价格点的送货单来源。
- 运费、搬运费、上楼费、装卸费和吊装费等费用行不作为材料参与单价比较。
- 页面底部只读汇总所选材料涉及厂家签订过的材采合同，按厂家和项目展示合同数、合同名称、金额与签订日期，并可下钻合同详情。

## 四、共同规则

- 项目、合同、分供方、客户、班组、下料单均保存真实 ID。
- 明细网格落子表；附件走 `file_refs`。
- 单据头和明细由同一个事务保存；删除使用软删除并同步重算派生量。
- 草稿允许不完整；入库、生效或确认动作校验必填、正数量及上游关系。

## 四、验收

1. 10 条整页表单刷新后字段、明细和附件保持。
2. 到货—下料、领用—库存、甲供三量均可追溯，不用头字段手工补累计。
3. 材料采购结算可被付款申请作为真实支出结算选择。
