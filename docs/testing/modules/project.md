# 项目与阶段任务

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/production/project-pending.test.ts](../../../tests/production/project-pending.test.ts) | 单元／服务／状态 | 成功后响应丢失保留原键，未明确采用已保存内容前不重复添加原件 |
| [tests/production/project-storage.test.ts](../../../tests/production/project-storage.test.ts) | 单元／服务／状态 | 项目与原件同库冷回读，客户改名沿原 ID、未知指标不归零、删除恢复保留原件 |
| [tests/project/acceptance-lifecycle.test.ts](../../../tests/project/acceptance-lifecycle.test.ts) | 单元／服务／状态 | project acceptance lifecycle read model |
| [tests/project/archive.test.ts](../../../tests/project/archive.test.ts) | 单元／服务／状态 | 项目档案包导出（Issue #248） |
| [tests/project/cost-control.test.ts](../../../tests/project/cost-control.test.ts) | 单元／服务／状态 | project cost control read model |
| [tests/project/data-origin.test.ts](../../../tests/project/data-origin.test.ts) | 单元／服务／状态 | project data-origin boundary |
| [tests/project/delivery-archive.test.ts](../../../tests/project/delivery-archive.test.ts) | 单元／服务／状态 | project delivery archive read model |
| [tests/project/detail-aggregate.test.ts](../../../tests/project/detail-aggregate.test.ts) | 单元／服务／状态 | project detail SQL aggregates |
| [tests/project/detail-summary.test.ts](../../../tests/project/detail-summary.test.ts) | 单元／服务／状态 | 项目详情经营数据（DATABASE.md §4.1） |
| [tests/project/expenditure-relations.test.ts](../../../tests/project/expenditure-relations.test.ts) | 单元／服务／状态 | project expenditure relation read model |
| [tests/project/export.test.ts](../../../tests/project/export.test.ts) | 单元／服务／状态 | 项目台账导出行 |
| [tests/project/finance-facts.test.ts](../../../tests/project/finance-facts.test.ts) | 单元／服务／状态 | project finance facts read model |
| [tests/project/finance.test.ts](../../../tests/project/finance.test.ts) | 单元／服务／状态 | 项目列表金额列取值 |
| [tests/project/formal-facts.test.ts](../../../tests/project/formal-facts.test.ts) | 单元／服务／状态 | project formal fact boundaries |
| [tests/project/import-central.test.ts](../../../tests/project/import-central.test.ts) | 单元／服务／状态 | 项目 Excel → 实际存储 → 中央回读 |
| [tests/project/import-command.test.ts](../../../tests/project/import-command.test.ts) | 单元／服务／状态 | 项目中央逐行导入命令 |
| [tests/project/list.test.ts](../../../tests/project/list.test.ts) | 单元／服务／状态 | 项目列表筛选 |
| [tests/project/phase-task-files.test.ts](../../../tests/project/phase-task-files.test.ts) | 单元／服务／状态 | phase task file references |
| [tests/project/phases.test.ts](../../../tests/project/phases.test.ts) | 单元／服务／状态 | 项目六阶段定义 |
| [tests/project/project-command-http-repository.test.ts](../../../tests/project/project-command-http-repository.test.ts) | 单元／服务／状态 | project command HTTP repository |
| [tests/project/project-detail-boundary.test.ts](../../../tests/project/project-detail-boundary.test.ts) | 单元／服务／状态 | project detail data-origin boundary |
| [tests/project/project-local-draft.test.ts](../../../tests/project/project-local-draft.test.ts) | 单元／服务／状态 | project local draft |
| [tests/project/repository-contract.test.ts](../../../tests/project/repository-contract.test.ts) | 单元／服务／状态 | project repository contract |
| [tests/project/status.test.ts](../../../tests/project/status.test.ts) | 单元／服务／状态 | 项目状态归一 |
| [tests/project/subtables.test.ts](../../../tests/project/subtables.test.ts) | 单元／服务／状态 | project detail subtable definitions |
| [tests/server/project-command-test-instance.test.ts](../../../tests/server/project-command-test-instance.test.ts) | 单元／服务／状态 | project command test instance |
| [tests/server/project-read-test-instance.test.ts](../../../tests/server/project-read-test-instance.test.ts) | 单元／服务／状态 | project read resettable instance |
| [tests/stores/phase-task.test.ts](../../../tests/stores/phase-task.test.ts) | 单元／服务／状态 | phase task store:阶段任务唯一写路径 |
| [tests/stores/project-alias.test.ts](../../../tests/stores/project-alias.test.ts) | 单元／服务／状态 | project alias store |
| [tests/stores/project-command.test.ts](../../../tests/stores/project-command.test.ts) | 单元／服务／状态 | project command store |
| [tests/stores/project-list.test.ts](../../../tests/stores/project-list.test.ts) | 单元／服务／状态 | project list read state |
| [tests/stores/project-load-state.test.ts](../../../tests/stores/project-load-state.test.ts) | 单元／服务／状态 | project store load state |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/ProjectArchiveExportDialog.test.ts](../../../tests/components/ProjectArchiveExportDialog.test.ts) | 组件（jsdom） | 项目档案包导出选择器 |
| [tests/components/ProjectDetailScreen.test.ts](../../../tests/components/ProjectDetailScreen.test.ts) | 组件（jsdom） | 项目详情中央来源边界 |
| [tests/components/ProjectDetailTab.test.ts](../../../tests/components/ProjectDetailTab.test.ts) | 组件（jsdom） | 项目详细资料 |
| [tests/components/ProjectFormPage.test.ts](../../../tests/components/ProjectFormPage.test.ts) | 组件（jsdom） | 项目整页表单 |
| [tests/components/ProjectImportReview.test.ts](../../../tests/components/ProjectImportReview.test.ts) | 组件（jsdom） | 项目导入人工核对 |
| [tests/components/ProjectListScreen.test.ts](../../../tests/components/ProjectListScreen.test.ts) | 组件（jsdom） | project list screen |
| [tests/components/ProjectListToolbar.test.ts](../../../tests/components/ProjectListToolbar.test.ts) | 组件（jsdom） | project list toolbar |
| [tests/components/ProjectMasterDataFormFields.test.ts](../../../tests/components/ProjectMasterDataFormFields.test.ts) | 组件（jsdom） | 项目表单字段 |
| [tests/components/ProjectMetrics.test.ts](../../../tests/components/ProjectMetrics.test.ts) | 组件（jsdom） | 项目详情真实聚合摘要 |
| [tests/components/ProjectReturnLink.test.ts](../../../tests/components/ProjectReturnLink.test.ts) | 组件（jsdom） | project return link expiry |
| [tests/components/ProjectSubTableSection.test.ts](../../../tests/components/ProjectSubTableSection.test.ts) | 组件（jsdom） | project subtable section read-only contract |
| [tests/components/ProjectTaskFiles.test.ts](../../../tests/components/ProjectTaskFiles.test.ts) | 组件（jsdom） | project task files public behavior |
| [tests/components/ProjectTimeline.test.ts](../../../tests/components/ProjectTimeline.test.ts) | 组件（jsdom） | 项目阶段时间线 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-174-project-files.spec.ts](../../../e2e/issue-174-project-files.spec.ts) | Playwright E2E | 阶段任务文件与项目文件柜引用同一份持久化文件 |
| [e2e/issue-177-project-finance-facts.spec.ts](../../../e2e/issue-177-project-finance-facts.spec.ts) | Playwright E2E | 往来调拨与实际支付保持不同事实和来源入口 |
| [e2e/issue-178-project-delivery-archive.spec.ts](../../../e2e/issue-178-project-delivery-archive.spec.ts) | Playwright E2E | 物资页签只展示当前项目已归档送货单及有效明细聚合 |
| [e2e/issue-180-project-integration.spec.ts](../../../e2e/issue-180-project-integration.spec.ts) | Playwright E2E | 项目驾驶舱与正式源事实同口径，并提供只读来源穿透 |
| [e2e/issue-190-project-reference.spec.ts](../../../e2e/issue-190-project-reference.spec.ts) | Playwright E2E | Issue #190：项目列表、详情与表单参考旅程 |
| [e2e/issue-248-project-archive.spec.ts](../../../e2e/issue-248-project-archive.spec.ts) | Playwright E2E | Issue #248：项目详情阶段重排与档案包导出 |
| [e2e/issue-288-project-http-read.spec.ts](../../../e2e/issue-288-project-http-read.spec.ts) | Playwright E2E | Issue #288：项目列表中央 HTTP 读链 |
| [e2e/issue-293-project-command.spec.ts](../../../e2e/issue-293-project-command.spec.ts) | Playwright E2E | Issue #293：项目中央命令与本地草稿 |
| [e2e/issue-312-project-target-registry.spec.ts](../../../e2e/issue-312-project-target-registry.spec.ts) | Playwright E2E | Issue #312：项目 Target Registry |
| [e2e/issue-313-project-return-context.spec.ts](../../../e2e/issue-313-project-return-context.spec.ts) | Playwright E2E | Issue #313：项目列表完整来源上下文 |
| [e2e/production-project-storage.spec.ts](../../../e2e/production-project-storage.spec.ts) | Playwright E2E | 关联生产存储：项目正式保存链 |
| [e2e/project-crud.spec.ts](../../../e2e/project-crud.spec.ts) | Playwright E2E | 项目列表：中央新增可用，未迁移的导入仍禁用 |
| [e2e/project-detail-metrics.spec.ts](../../../e2e/project-detail-metrics.spec.ts) | Playwright E2E | 项目详情票据面板：归档新票后金额、税额与张数实时更新 |
| [e2e/project-detail.spec.ts](../../../e2e/project-detail.spec.ts) | Playwright E2E | 项目列表↔详情：中央列表可打开现有只读详情并复用同一页签 |
| [e2e/project-import-central.spec.ts](../../../e2e/project-import-central.spec.ts) | Playwright E2E | 历史深链真实 Excel 保存后中央列表、详情与刷新回读；重传同文件只返回原 ID |
| [e2e/project-import.spec.ts](../../../e2e/project-import.spec.ts) | Playwright E2E | 项目导入：有中央写权限时从项目列表打开真实导入流程 |
| [e2e/project-phases.spec.ts](../../../e2e/project-phases.spec.ts) | Playwright E2E | 项目六阶段：编辑任务后持久化并实时更新阶段卡进度 |
| [e2e/project-subtables.spec.ts](../../../e2e/project-subtables.spec.ts) | Playwright E2E | 项目详情十页签读取 SQLite 且不再显示待建设占位卡 |
