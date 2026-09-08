# 睿璟工作簿实体与字段映射

> 源文件：`01_成果文件/未来印合同睿璟清单列表_复核版.xlsx`
> 原则：按实体导入；公式列只用于对账，不作为业务事实。

本文件是指定工作簿的来源映射，不另立数据模型；字段关系以 [DATABASE.md](../rewrite/DATABASE.md) 为准。当前实体导入复核见 [#406](https://github.com/zodea/crm-new/issues/406)，接管后的写入执行 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md)，不能向本地快照回填正式事实。

## 1. 导入实体顺序

1. Project；
2. Supplier；
3. ConstructionContract；
4. Contract 与 ContractSupplement；
5. ExpenditureSettlement；
6. PaymentApplication；
7. PaymentRecord；
8. PaymentRecordApplicationAllocation；
9. Invoice 及 PaymentApplicationInvoiceAllocation；
10. CurrentReceipt / CurrentPayment；
11. DeliveryRecord / DeliveryLine（可延后，不进入本期库存汇总）。

每条迁移记录必须附带：

- `import_batch_id`；
- `source_file`；
- `source_sheet`；
- `source_row`；
- `source_key`；
- 原始文本或原始行快照。

## 2. `合同主数据`

有效业务行必须至少满足：`F 供货单位`、`G 合同编号`、`J 合同金额`之一存在。仅有公式、样式或序号的行不是业务行。

| 源列 | 源字段 | 目标 | 处理 |
|---|---|---|---|
| A | 序号 | `import_source_refs.source_row` | 仅追溯，不作主键 |
| B | 材料名称 | `contracts.name` | 原样保存；源文本同时保留在 `raw_snapshot` |
| C | 合同类型 | `contracts.legacy_type` + `cost_category` | 按五类映射 |
| D | 签约人 | `contracts.signer_name` | 文本迁移 |
| E | 联系电话 | `contracts.contact_phone` | 文本迁移，不转数字 |
| F | 供货单位 | `suppliers.name` / `contracts.supplier_id` | 先标准化并人工确认分供方 |
| G | 合同编号 | `contracts.no` | 项目内业务键；重复号进入主合同/补充协议识别 |
| H | 合同税率 | `contracts.tax_rate` | 仅合同税率，不生成发票 |
| I | 是否结算 | `expenditure_settlements.status` / 迁移备注 | 不直接写合同状态 |
| J | 合同金额 | `contracts.amount` 或 `contract_supplements.amount` | 主记录写主合同，其余确认后写补充协议 |
| K | 合同合计金额 | 不导入 | Excel 聚合列，系统实时计算 |
| L | 结算金额 | `expenditure_settlements.total_amount` | 非空且大于 0 时生成/汇总结算源单 |
| M | 实付金额 | 不作事实导入 | 仅与支付记录分摊对账 |
| N | 合同/结算口径金额 | 不导入 | Excel 派生列 |
| O | 剩余合同金额 | 不导入 | 系统派生 |
| P | 厂家合同地址 | `suppliers.address` 或合同备注 | 分供方地址需人工确认，避免覆盖更可信主数据 |
| Q | 公司信息 | 资料完整性标记 | 不等于业务金额 |
| R | 合同文件 | `file_refs` 迁移状态 | 实际附件按文件哈希挂载 |
| S | 结算书 | `file_refs` 迁移状态 | 挂到结算源单 |
| T | 结算盖章 | 资料完整性标记 | 原样保留 |
| U | 资料核对备注 | `contracts.note` / 迁移问题 | 原样保存 |

### 2.1 合同类型映射

| Excel 原值 | 系统 `cost_category` | 系统合同分组 |
|---|---|---|
| 包工包料 | 专业分包 | `kind=分包, sub_kind=专业` |
| 劳务 | 合同劳务 | `kind=分包, sub_kind=劳务` |
| 材料 | 材料 | `kind=材采` |
| 走账材料 | 材料 | `kind=材采`，保留 `legacy_type` |
| 部分走账材料 | 材料 | `kind=材采`，保留 `legacy_type` |
| 租赁 | 机械 | `kind=其他支出` |
| 其他 | 其他 | `kind=其他支出` |
| 不签合同 | 其他 | 保留 `classification_state=no_contract` |
| 未分类或空 | 其他 | 保留 `classification_state=unclassified`，进入待处理队列 |

直接工人工资不从此表生成，也不映射到“合同劳务”。

### 2.2 主合同与补充协议识别

- 相同项目、相同合同编号出现多行时不得创建多个平级主合同；
- 优先使用附件、名称、备注和金额确认主记录；
- 其余行迁为 `contract_supplements`；
- 无法确认时整组标记 `needs_review`，不自动猜测；
- 合同汇总金额为主合同金额加有效补充协议金额。

## 3. `付款申请`

有效业务行必须至少有 `A 申请ID` 或 `H 申请金额`，且不能是合计行。

| 源列 | 源字段 | 目标 | 处理 |
|---|---|---|---|
| A | 申请ID | `payment_applications.external_ref` | 保留原始业务键 |
| B | 付款凭证序号 | 支付分摊候选键 | 连接 `付款批次.A`，不是申请外键本体 |
| C | 公司付款顺序 | `import_source_refs.raw_snapshot.source_order` | 追溯字段，不进入业务表 |
| D | 供货单位 | `supplier_id` | 分供方 lookup |
| E | 合同编号 | `contract_id` | 项目内按合同号 lookup |
| F | 申请序号 | `import_source_refs.raw_snapshot.application_seq` | 与 A/C 一起留痕 |
| G | 申请日期 | `apply_date` | Excel 日期转 ISO 日期 |
| H | 申请金额 | `apply_amount` | 正数，两位小数 |
| I | 付款申请PDF | `file_refs` 状态 | 文件实际存在时挂载 |
| J | 付款申请Excel | `file_refs` 状态 | 文件实际存在时挂载 |
| K | 发票 | 发票完整性状态 | 不等于发票金额 |
| L | 发票张数 | 迁移校验 | 与实际发票附件/台账对账 |
| M | 发票合计金额 | 发票迁移候选 | 只有可追溯票据时才写 Invoice |
| N-P | 无欠税证明及时效 | 合规资料状态 | 不进入票税金额 |
| Q | 支撑资料 | `file_refs` 状态 | 按实际文件挂载 |
| R | 原始位置 | `import_source_refs.raw_snapshot.source_path` | 追溯，不作为运行时文件路径 |
| S | 核对结论 | `import_source_refs.raw_snapshot.migration_review_status` | 不直接等于审批状态；异常另建对账问题 |
| T | 备注 | `note` | 原样保存 |

付款申请的 `paid_amount` 和 `actual_payment` 不从 Excel 手写值写入。实际已付由支付分摊派生。

## 4. `付款批次`

有效支付记录行必须至少有 `A 全局凭证序号`、`E 实际付款日期`、`F 实际付款金额`之一，并能关联到实际凭证。232 行之后的尾部公式/格式噪声不得凭已用区域直接导入。

| 源列 | 源字段 | 目标 | 处理 |
|---|---|---|---|
| A | 全局凭证序号 | `payment_records.external_ref` | 与集中付款凭证文件名前缀对应 |
| B | 供货单位 | `payment_records.payee_name` / `supplier_id` | 人工确认收款主体 |
| C | 用途 | `payment_records.purpose` | 不用于推断合同分类 |
| D | 合同编号 | 分摊默认合同过滤 | 不取代支付—申请分摊 |
| E | 实际付款日期 | `payment_records.payment_date` | 以银行回单为准 |
| F | 实际付款金额 | `payment_records.amount` | 普通付款的唯一实际金额 |
| G | 申请合计金额 | 不导入 | 由支付分摊反算 |
| H | 金额差额 | 不导入 | 系统校验 `支付金额-分摊金额` |
| I-J | 合同/结算及剩余 | 不导入 | 系统派生 |
| K | 公司付款顺序 | `import_source_refs.raw_snapshot.source_order` | 追溯字段，不进入业务表 |
| L | 申请数量 | 不导入 | 系统统计关联申请数 |
| M-N | 付款申请文件状态 | 迁移检查 | 实际文件挂载到申请 |
| O | 发票 | 资料状态 | 不生成票面金额 |
| P-Q | 无欠税证明及时效 | 合规资料状态 | 原样保留 |
| R | 付款凭证 | `file_refs` | 必须与集中凭证逐份核对；数量基准见[验收清单](ruijing-acceptance.md) |
| S | 支撑资料 | `file_refs` | 按文件实际存在迁移 |
| T | 核对结论 | `import_source_refs.raw_snapshot.migration_review_status` | 不等于支付记录确认状态；异常另建对账问题 |
| U | 来源及备注 | `note` | 原样保存 |
| W-AF | 原表其他收支保留区 | 对应资金实体 | 不计入合同付款批次，单独迁移 |

### 4.1 支付分摊生成

- `付款批次.A = 付款申请.B` 只生成候选关联；
- 对候选申请按明确金额创建 `payment_record_application_allocations`；
- 一笔付款对应多张申请时创建多行分摊；
- 分摊合计必须等于支付记录金额；
- 无法对平时状态为 `needs_review`，支付记录不能确认入账；
- 第 231 条 95,000 元申请缺少银行凭证和实际付款金额，不创建已确认支付记录。

## 5. `核对送货单` 与 `送货单明细`

这两张表可以迁为送货单和送货单行，但本期不统计库存，也不直接计入动态成本。

- `送货单明细` 的日期、编号、金额用于收货事实；
- `核对送货单` 的“已交/未交金额”是对账展示，不作独立金额事实；
- 材料动态成本来自已确认支出结算，不能再叠加送货单金额。

## 6. `汇总表`

汇总表只作为迁移对账基准，不导入静态总额。主要映射如下：

| 区域 | 系统来源 |
|---|---|
| B1-J7 项目概况 | Project、ConstructionContract、项目阶段日期 |
| C9:C19 对上收入 | 施工合同、客户确认产值/结算、项目收款 |
| F9:G14 支出合同 | Contract + ContractSupplement 按五类聚合 |
| F15:G21 动态成本 | 支出结算 + 工资确认发放 + 费用报销 |
| J9:J12 票税 | 销项发票与进项发票台账 |
| J13:J15 库存 | 本期 `not_applicable` |
| J16:J17 动态效益 | 客户确认收入 − 动态成本 |
| C23:J31 资金 | 收款、支付记录、工资发放、往来款、保证金、备用金 |
| A40:K122 分供方汇总 | Supplier + Contract + Settlement + PaymentAllocation + Invoice |

Excel 的 A40:K122 通过“供应商名称”和首个匹配类型汇总，系统不得照搬此关联方式。
