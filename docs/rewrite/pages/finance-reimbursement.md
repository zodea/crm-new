# 费用报销 — 报销头 + 费用明细

> 表单蓝本：`reimburseForm`
> 持久化权威：`DATABASE.md` 的 `expense_reimbursements` / `expense_reimbursement_lines`

## 新增/编辑

| 分区 | 字段与规则 |
|---|---|
| 基本信息 | 报销单号、报销人*、归属项目（可空=公司开支）、费用类别、报销日期* |
| 报销明细 | 费用项目*、发生日期、金额*、备注；支持增删复制与汇总 |
| 审批与备注 | 报销总额（按明细汇总）、状态、发票张数、报销事由、票据附件 |

报销总额由有效明细金额汇总，页面不维护可与明细永久分叉的第二份金额。项目 lookup 保存真实 ID；公司开支使用空项目，不建立虚拟项目。

## 无合同零星材料

无合同的零星材料仍先新增真实分供方，再将送货单或收据作为票据附件放入个人开支或具体项目，继续走本报销流程。没有合同不等于可以省略分供方，也不等于报销单已经形成银行支付事实；实际付款仍需另建支付记录并完成人工核对。

## 生命周期与成本

`草稿 → 审批中 → 已审批 → 已付款` 为界面状态；数据库使用稳定状态码映射。只有已确认/已审批的报销进入动态成本，实际资金流出仍以支付记录为准，避免成本与现金流混淆。

## 验收

1. 明细刷新后不丢失，总额始终等于有效明细合计。
2. 票据附件通过 `file_refs` 保存。
3. 草稿可不完整，提交时至少需要报销人、日期和一条正金额明细。

## 运行态对标与列表契约（2026-08-13）

参考费用报销按材料报销、非材料报销和公司报销分类，专属宽表包含申请编号、项目、支出所属公司、业务/报销类型、报销人、申请日期、说明、累计报销、备用金抵扣、扣款、抵扣后需支付、审批、实际支付、剩余待支付、支付状态、生效状态和成本分类；直接证据见 `R-FINANCE-FLOW-LIVE`。

当前参考与本地均为明确空数据。本地没有 `expense_reimbursements` / 明细 seed，应保持真实空态，但不能继续只显示通用列。列表读模型至少返回 `id/no/project/company/bizType/category/applicant/applicationDate/reason/reimbursedAmount/advanceOffset/deductionAmount/payableAmount/approvalStatus/paidAmount/unpaidAmount/paymentStatus/effectiveStatus/costCategory`，其中：

- `reimbursedAmount` 从有效明细汇总；
- `paidAmount/unpaidAmount` 只从已确认支付及分摊派生；
- `advanceOffset` 在备用金实体未建立前返回 `null + availability='not_connected'`，界面显示“未接”，不得补 `0`；
- 公司报销的 `project` 可空，不创建虚拟项目。

申请编号主链接应进入只读详情，编辑保持独立动作；列表无数据时仍保留分类、表头、筛选和分页。
