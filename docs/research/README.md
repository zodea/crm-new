# 调研与来源参考

> 本目录保留有独立价值的外部比较和原始观察，不定义当前规格、任务状态或实施顺序。现行约束直接查对应 ADR、组件契约和页面规格。

| 文档 | 保留价值 | 现行权威 |
| --- | --- | --- |
| [项目切换器公开模式比较](./project-switcher-patterns.md) | 不同上下文切换方式的第一方来源及采纳、未采纳理由 | [KitUI 组件规格](../design/kit-ui-component-specs.md) |
| [红圈结构观察](./red-circle-ui-gap-2026-07-11.md) | 当时真实参考页面的结构、字段与观察限制 | [运行参考登记](../design/runtime-reference-audit.md)、对应页面规格 |
| [识别校对参考](./ocr-ux-benchmark.md) | 校对产品的历史参考线索，明确未验证能力 | [发票页面](../rewrite/pages/finance-invoice.md)、[送货页面](../rewrite/pages/material-delivery.md)、[ADR 0006](../adr/0006-ocr-paddleocr-vl-single-model.md) |
| [测试与开发工具比较](./antfu-starred-tooling-2026-09-24.md) | 候选用途、适配证据和未采纳理由 | [测试入口](../testing/README.md)、[架构](../rewrite/ARCHITECTURE.md) |

已完成任务的审阅报告、发布副本、工资分期准备票、组件迁移状态、旧排期和清理流水退出工作树。原始全文、固定提交、当时反例及原路径通过[清理前固定 Git 来源](https://github.com/zodea/crm-new/tree/c16869fcbf954dddd46143839afe5790f3828f1a/docs/research)恢复；旧代码状态和“未推送”“待实施”不用于判断今日进度。

工资现行来源、配置、冻结、更正、费用、空鼓和工作簿范围直接见[工资页面](../rewrite/pages/subcontract-payroll.md)、[DATABASE](../rewrite/DATABASE.md)、[COMMANDS](../rewrite/COMMANDS.md)、[READ-MODELS](../rewrite/READ-MODELS.md)及对应指南。额外费用政策由 [#472](https://github.com/zodea/crm-new/issues/472)至 [#475](https://github.com/zodea/crm-new/issues/475)承接；通知其他业务来源及单操作人自收结果的原调查在 [#404 原评论](https://github.com/zodea/crm-new/issues/404#issuecomment-5644611930)，当前已接证照提醒的规则见 [PUBLIC-SURFACES](../rewrite/PUBLIC-SURFACES.md)。这些承接未因删除准备副本取消，也不据旧待问重复询问已经明确的决定。

旧指南和工资打印 PDF 的精确原路径、固定恢复提交仍可从[原清理记录](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/research/guide-pdf-cleanup-2026-09-14.md)定位。真实样本的字段坐标、实体映射、金额基准和差异归因保留在 [migration](../migration/)，不把样本静态值迁为产品事实。

调研日期、样本和限制须清楚；已采纳的规则只维护权威文档。真实业务数据、客户原件及未脱敏截图不得作为本目录交付。
