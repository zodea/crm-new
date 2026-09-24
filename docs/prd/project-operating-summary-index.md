# 项目经营汇总与睿璟迁移文档入口

> 原始取证基线：`main@09971b01`（历史快照，不代表当前代码或完成状态）
> 首个验收样本：车陂商业大楼项目
> 原始定稿：2026-07-24；当前承接入口更新：2026-09-08

本组文档把睿璟/未来印 Excel 的真实业务口径整理为 `crm-new` 可实施的通用项目经营汇总、付款和迁移规格。车陂商业大楼只是首个迁移与回归数据集，代码中不得写死项目名称、金额或工作簿行号。

## 权威文档

- [领域术语](../../CONTEXT.md)
- [ADR 0015：表单持久化、付款勾稽与支付事实](../adr/0015-form-persistence-and-payment-reconciliation.md)
- [数据库设计](../rewrite/DATABASE.md)
- [项目详情页](../rewrite/pages/project-info.md)
- [付款申请与支付记录](../rewrite/pages/finance-payment.md)

## 需求与迁移材料

1. [通用项目经营汇总与实体迁移 PRD](project-operating-summary-and-import.md)
2. [汇总表完整字段字典](../migration/summary-field-catalog.md)
3. [Excel 实体与字段映射](../migration/ruijing-workbook-mapping.md)
4. [数据质量、逻辑差异与责任归因](../migration/ruijing-data-quality-and-reconciliation.md)
5. [迁移与经营汇总验收清单](../migration/ruijing-acceptance.md)
6. [代码实施拆分](../implementation/project-operating-summary-work-breakdown.md)

## 历史决定的来源

- **#116 表单字段回写（已定稿）**：37 条表单的页面蓝本和目标 schema 已回写；本组文档继续执行 ADR 0015 的真实结算/发票分摊和支付记录—付款申请多对多模型。文档定稿不代表迁移、store 或页面已经实现。
- **#117 工资进度款域**：保持“草稿 → 已核对 → 已发放”三态；“确认发放”是进入已发放状态的动作。已发放实际金额同时形成工资成本和已支付事实，不要求逐工人银行回单。
- **#104 项目详情第二趟**：继续使用项目详情作为经营驾驶舱。原四科目目标成本不足以区分合同劳务、专业分包和直接工人工资；本组文档将经营汇总扩展为五类合同结算 + 工人工资 + 费用报销，并把该差异记录为项目模型问题。

## 当前开发入口

1. 从 [全模块复核 #402](https://github.com/zodea/crm-new/issues/402) 和[实施承接入口](../implementation/project-operating-summary-work-breakdown.md)找到当前模块任务，核实所选提交的实际差异。
2. 需求读本组 PRD，词义、数据关系和计算仍以 `CONTEXT.md`、`DATABASE.md §10` 为权威；中央读写与过渡本地边界执行 ADR 0020。
3. 依照模块任务形成含异常、更正、返回和回读场景的实施规格；不重新执行旧 Slice 顺序，也不将 #117 当作当前工资任务。
4. 用睿璟样本做受控迁移对账，不把旧汇总静态值当新事实。样本库存“暂不统计”只限定本次经营汇总，不能排除 #411 的物资业务。
5. 按选定基线逐项记录验收证据；正式保存、恢复与部署另过 #416，不能用本地或内存实例验收替代。
