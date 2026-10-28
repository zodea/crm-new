# 项目经营汇总与睿璟迁移：实施承接入口

> 2026-09-08 更新。旧拆分基于 `main@09971b01`，其代码状态与 Slice A–G 排期已经过时；原文由 Git 历史保留。本页只导航当前工作，不另立业务规格，也不将既有成果重新排成待开发。

## 当前承接

| 工作 | 当前复核任务 | 权威依据 |
| --- | --- | --- |
| 合同分类、补充协议、材料与其他支出结算 | [#409](https://github.com/zodea/crm-new/issues/409) | [合同蓝本](../rewrite/pages/core-contracts.md)、[合同表单](../rewrite/pages/contract-forms.md) |
| 分包结算与项目罚扣 | [#410](https://github.com/zodea/crm-new/issues/410) | [单据蓝本](../rewrite/pages/owner-documents.md) |
| 付款申请、发票分摊、支付记录及报销 | [#413](https://github.com/zodea/crm-new/issues/413) | [ADR 0015](../adr/0015-form-persistence-and-payment-reconciliation.md)、[支付记录](../rewrite/pages/finance-records.md) |
| A/C1/C2 工资与目标成本 | [#412](https://github.com/zodea/crm-new/issues/412) | [工资蓝本](../rewrite/pages/subcontract-payroll.md)、[目标成本](../rewrite/pages/target-cost.md) |
| 项目经营汇总、合作方下钻 | [#408](https://github.com/zodea/crm-new/issues/408) | [项目详情](../rewrite/pages/project-info.md)、[经营需求](../prd/project-operating-summary-and-import.md) |
| Excel 实体导入、预演、来源追溯与重试 | [#406](https://github.com/zodea/crm-new/issues/406) | [工作簿映射](../migration/ruijing-workbook-mapping.md)、[差异归因](../migration/ruijing-data-quality-and-reconciliation.md) |
| 来源、状态和金额跨模块一致性 | [#405](https://github.com/zodea/crm-new/issues/405) | [数据库](../rewrite/DATABASE.md)、[读模型](../rewrite/READ-MODELS.md)、[写命令](../rewrite/COMMANDS.md) |
| 后置正式存储、恢复与部署验收 | [#416](https://github.com/zodea/crm-new/issues/416) | [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md) |

## 如何形成可执行任务

1. 从 [#403](https://github.com/zodea/crm-new/issues/403) 固定提交与运行环境，对比已实现、未闭环和缺失项；不从旧文档的“当前代码”段推断现状。
2. 按[模块复核规程](../agents/module-review.md)记录正常、失败、更正、重复操作、来源缺失及返回恢复场景，继承最终决定；能依证判断的直接记录依据。
3. 将确定差异拆成包含页面、交互、写入、回读、关联影响与验收的完整任务，仅连接真实上游依赖。各模块可独立形成规格并实施，无需等待所有模块全部调查完。
4. 已接管实体沿中央命令与查询接缝处理，旧本地实现只作为迁移证据或隔离适配。内存测试实例通过不等于正式保存、恢复或部署通过。
5. 以[样本验收清单](../migration/ruijing-acceptance.md)核对合同、结算、银行支付与差异来源；样本金额只用于本地受控对账，不硬编码或提交真实票据。
6. 完成后同步对应权威源、用户指南及验收证据，由 [#415](https://github.com/zodea/crm-new/issues/415) 汇总全模块规格与剩余差异。

新路线见 [#402](https://github.com/zodea/crm-new/issues/402)，数据归属见 [ARCHITECTURE · 逻辑数据归属](../rewrite/ARCHITECTURE.md#data-ownership)。旧 #116、#117、#104 等只保留决定与实现来源，不再作为本页排期入口。
