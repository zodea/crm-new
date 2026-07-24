# 项目经营汇总与睿璟迁移文档入口

> 合入基线：`main@09971b01`
> 首个验收样本：车陂商业大楼项目
> 文档定稿：2026-07-24

本组文档把睿璟/未来印 Excel 的真实业务口径整理为 `crm-new` 可实施的通用项目经营汇总、付款和迁移规格。车陂商业大楼只是首个迁移与回归数据集，代码中不得写死项目名称、金额或工作簿行号。

## 权威文档

- [领域术语](../../CONTEXT.md)
- [ADR 0015：表单持久化、付款勾稽与支付事实](../adr/0015-form-persistence-and-payment-reconciliation.md)
- [数据库设计](../rewrite/DATABASE.md)
- [项目详情页](../rewrite/pages/project-info.md)
- [付款申请与支付记录](../rewrite/pages/finance-payment.md)

## 本次新增规格

1. [通用项目经营汇总与实体迁移 PRD](project-operating-summary-and-import.md)
2. [汇总表完整字段字典](../migration/summary-field-catalog.md)
3. [Excel 实体与字段映射](../migration/ruijing-workbook-mapping.md)
4. [数据质量、逻辑差异与责任归因](../migration/ruijing-data-quality-and-reconciliation.md)
5. [迁移与经营汇总验收清单](../migration/ruijing-acceptance.md)
6. [代码实施拆分](../implementation/project-operating-summary-work-breakdown.md)

## 与现有 issue 的关系

- **#116 表单字段回写**：本组文档继续执行 ADR 0015 的可编辑字段持久化和真实结算/发票分摊，并新增支付记录—付款申请多对多模型。本文档定稿不代表 schema、store 或页面已经实现。
- **#117 工资进度款域**：保持“草稿 → 已核对 → 已发放”三态；“确认发放”是进入已发放状态的动作。已发放实际金额同时形成工资成本和已支付事实，不要求逐工人银行回单。
- **#104 项目详情第二趟**：继续使用项目详情作为经营驾驶舱。原四科目目标成本不足以区分合同劳务、专业分包和直接工人工资；本组文档将经营汇总扩展为五类合同结算 + 工人工资 + 费用报销，并把该差异记录为项目模型问题。

## 开发采用顺序

1. 先读 PRD、字段字典和差异归因；
2. 以 `DATABASE.md §10` 为目标 schema；
3. 按实施拆分的 Slice A-G 逐项开发；
4. 用睿璟样本金额做迁移回归，不把旧汇总静态值当新事实；
5. 完成后逐项勾选验收清单。
