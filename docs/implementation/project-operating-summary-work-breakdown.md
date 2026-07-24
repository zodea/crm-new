# crm-new 实施拆分：项目经营汇总与睿璟迁移

> 本文面向当前 `main@09971b01`，可直接拆为 issue 或按顺序实现。

## 0. 当前实现证据

- `app/lib/db/schema.ts`：`payment_records` 仍有单个 `payment_application_id`；
- `app/lib/db/schema.ts`：`payment_applications` 仍保存 `paid_amount`、`actual_payment`；
- `app/lib/project/detail-aggregate.ts`：项目支出仍从 `payment_applications.actual_payment` 聚合；
- `app/stores/contract.ts`：当前合同轻实体只支持施工/分包/材采；
- `app/pages/subcontract/payroll/index.vue`：工资页仍是待实现占位；
- `app/lib/kit/import-entities.ts`：尚无合同、结算、付款申请、支付记录实体导入；
- `docs/rewrite/DATABASE.md`：目标模型已比物理迁移领先，实施时必须同步 schema、store、read model 和测试。

## Slice A：合同分类与补充协议

### 修改范围

- `app/lib/db/migrations.ts`
- `app/lib/db/schema.ts`
- `app/lib/db/soft-delete.ts`
- `app/stores/contract.ts`
- `app/composables/useContractForm.ts`
- `app/components/contract/*`
- `tests/db/migrations.test.ts`
- `tests/db/soft-delete.test.ts`
- `tests/stores/contract.test.ts`

### 交付

- `contracts.cost_category/legacy_type/classification_state`；
- `kind='其他支出'`；
- `contract_supplements` CRUD 与聚合；
- 旧合同静态 `changed/settled/invoiced/paid` 标为兼容字段；
- 五类合同列表和汇总。

### 测试

- Excel 全部原类型映射；
- 合同劳务不进入工人工资；
- 同合同多补充协议金额聚合；
- 未分类状态可见且不会丢失。

## Slice B：支付记录多对多

### 修改范围

- `app/lib/db/migrations.ts`
- `app/lib/db/schema.ts`
- `app/lib/db/soft-delete.ts`
- 新增 `app/stores/payment-record.ts`
- 新增支付记录/分摊页面组件
- `app/stores/project-detail.ts`
- `app/lib/project/detail-aggregate.ts`
- `tests/db/migrations.test.ts`
- 新增 `tests/finance/payment-allocation.test.ts`
- 更新 `tests/project/detail-aggregate.test.ts`

### 交付

- `payment_record_application_allocations`；
- 支付记录确认事务；
- 付款申请已付/未付派生；
- 移除单个申请外键的写路径；
- 存量 `paid_amount/actual_payment` 差异报告；
- 支付撤回与软删除重算。

### 测试矩阵

| 场景 | 期望 |
|---|---|
| 1 笔支付 → 1 申请 | 正常确认 |
| 1 笔支付 → 2 申请 | 分摊和等于支付金额 |
| 2 笔支付 → 1 申请 | 申请已付为两笔合计 |
| 分摊少于/大于支付 | 禁止确认 |
| 未确认支付 | 不计已付和现金流 |
| 撤回支付 | 汇总立即扣回 |
| 重复银行流水 | 阻止或要求处理重复 |

## Slice C：付款凭证 OCR 与人工确认

### 修改范围

- 复用现有 invoice/delivery recognition 的解析、置信度和人工校对模式；
- 新增支付回单解析器、字段标准化和识别 UI；
- `file_refs.owner_type='payment_record'`；
- 新增 `tests/recognize/payment-parse.test.ts`；
- 新增 `tests/stores/payment-record.test.ts`。

### 交付

- 支持 PNG/PDF；
- 预填日期、金额、收款单位、流水号、账号、开户行、支付方式；
- 原图与字段对照；
- OCR 失败转手工录入；
- 所有来源均需人工确认；
- 确认前先完成申请分摊。

本切片不新增 OCR 生产依赖；优先复用当前识别引擎和手工兜底。若确需新增依赖，另行评审。

## Slice D：工资与费用报销成本事件

### 修改范围

- 按 #117 完成工资实体、store 和三态页面；
- 新增 `expense_reimbursements`；
- 新增统一成本事件查询；
- 新增 `tests/finance/dynamic-cost.test.ts`。

### 交付

- 工资通过“确认发放”进入“已发放”状态时，同时计入成本和工资支付；
- 不生成逐人支付记录；
- 已发放工资金额快照；
- 已确认费用报销计入动态成本；
- 缺工资或报销来源时返回 `partial/pending`。

## Slice E：统一项目经营 Read Model

### 修改范围

- 新增 `app/lib/project/operating-summary.ts`
- 调整 `app/lib/project/detail-aggregate.ts`
- 调整 `app/stores/project-detail.ts`
- 调整项目详情汇总组件
- 新增 `tests/project/operating-summary.test.ts`

### 交付

- 五类合同额、五类结算、工资、报销；
- 五类合同付款（来自已确认支付分摊）；
- 总流入、总流出、收支差额、工程款余缺；
- 票税、动态效益；
- `OperatingMetric` 完整性状态；
- 每个金额的下钻描述。

旧 `ProjectOperationSummary` 需要版本迁移或新增 V2，不能在同一字段上继续混用“申请实付”和“支付记录实付”。

## Slice F：实体导入与对账

### 修改范围

- `app/lib/kit/import-entities.ts`
- `app/lib/kit/import-mapping.ts`
- `app/composables/useImportRunner.ts`
- `app/pages/import/mapping/[entity].vue`
- 新增各实体 import adapter
- 新增 `tests/import/ruijing-*.test.ts`

### 交付

- 合同、补充协议、结算、申请、支付、分摊导入；
- 业务有效行判断；
- 来源追溯表；
- 幂等导入；
- 差异归因队列；
- 睿璟样本回归 fixture。

## Slice G：首个样本迁移验收

1. 导入分供方和合同；
2. 人工确认重复合同号的主合同/补充协议；
3. 导入结算；
4. 导入付款申请；
5. 从集中付款凭证生成支付记录并人工确认，数量基准见[验收清单](../migration/ruijing-acceptance.md)；
6. 创建支付分摊；
7. 运行五类金额对账；
8. 登记工资、报销、票税、客户确认收入和往来款的缺失项；
9. 输出迁移报告。

必须通过的金额基准见 `docs/migration/ruijing-acceptance.md`。

## 提交顺序建议

每个 slice 采用小提交：

1. schema + migration + migration tests；
2. domain/read model + unit tests；
3. store transaction + tests；
4. UI + interaction tests；
5. docs 同步；
6. sample fixture + reconciliation test。

不要在同一提交中同时改变合同分类、支付事实源和经营汇总公式；否则迁移差异无法定位。
