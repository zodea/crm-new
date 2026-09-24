# 班组、工人与花名册

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/crew-worker/command-http-repository.test.ts](../../../tests/crew-worker/command-http-repository.test.ts) | 单元／服务／状态 | 班组—工人中央 command HTTP Repository |
| [tests/crew-worker/http-repository.test.ts](../../../tests/crew-worker/http-repository.test.ts) | 单元／服务／状态 | 班组—工人中央 HTTP Repository |
| [tests/crew-worker/member-management.test.ts](../../../tests/crew-worker/member-management.test.ts) | 单元／服务／状态 | 班组成员关系命令 |
| [tests/crew-worker/multi-enum-query.test.ts](../../../tests/crew-worker/multi-enum-query.test.ts) | 单元／服务／状态 | 班组工人多选查询 |
| [tests/crew-worker/repository-contract.test.ts](../../../tests/crew-worker/repository-contract.test.ts) | 单元／服务／状态 | 班组—工人中央 Repository 契约 |
| [tests/crew-worker/return-context.test.ts](../../../tests/crew-worker/return-context.test.ts) | 单元／服务／状态 | 班组—工人安全回程上下文 |
| [tests/db/capability-migrations.test.ts](../../../tests/db/capability-migrations.test.ts) | 单元／服务／状态 | v26 班组/工人能力迁移 |
| [tests/migration/worker-roster-source.test.ts](../../../tests/migration/worker-roster-source.test.ts) | 单元／服务／状态 | 完整实名字段及原件从旧库接管，缺正文和未知用途不猜；重复接管保日常版本，危险恢复拒绝 |
| [tests/server/crew-worker-central-test-instance.test.ts](../../../tests/server/crew-worker-central-test-instance.test.ts) | 单元／服务／状态 | 班组—工人中央 command 测试实例 |
| [tests/stores/crew-detail.test.ts](../../../tests/stores/crew-detail.test.ts) | 单元／服务／状态 | crew detail store |
| [tests/stores/crew-worker-membership.test.ts](../../../tests/stores/crew-worker-membership.test.ts) | 单元／服务／状态 | 班组成员关系 command store |
| [tests/tabs/worker-roster-restore.test.ts](../../../tests/tabs/worker-roster-restore.test.ts) | 单元／服务／状态 | 私密资料与名册冷恢复只保存阅读身份并拒绝演示或缺来源 |
| [tests/worker/detail.test.ts](../../../tests/worker/detail.test.ts) | 单元／服务／状态 | 工人详情只读模型 |
| [tests/worker/roster-service.test.ts](../../../tests/worker/roster-service.test.ts) | 单元／服务／状态 | 工人 owner 私密资料与有日期名册归档 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/CrewDetailSections.test.ts](../../../tests/components/CrewDetailSections.test.ts) | 组件（jsdom） | 班组详情关系区块 |
| [tests/components/CrewFormFields.test.ts](../../../tests/components/CrewFormFields.test.ts) | 组件（jsdom） | 班组表单领域字段 |
| [tests/components/CrewMemberSection.test.ts](../../../tests/components/CrewMemberSection.test.ts) | 组件（jsdom） | 班组成员管理区 |
| [tests/components/CrewWorkerCentralDetailScreen.test.ts](../../../tests/components/CrewWorkerCentralDetailScreen.test.ts) | 组件（jsdom） | 班组—工人中央详情 |
| [tests/components/WorkerDetailSections.test.ts](../../../tests/components/WorkerDetailSections.test.ts) | 组件（jsdom） | 工人详情独立区块 |
| [tests/components/WorkerPrivateProfileState.test.ts](../../../tests/components/WorkerPrivateProfileState.test.ts) | 组件（jsdom） | 换工人后的迟到读取不能显示另一人的实名字段 |
| [tests/components/WorkerRosterArchiveState.test.ts](../../../tests/components/WorkerRosterArchiveState.test.ts) | 组件（jsdom） | 切换项目后的迟到预览不能显示前一个项目的私密名册 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/crew-detail.spec.ts](../../../e2e/crew-detail.spec.ts) | Playwright E2E | Issue #194：班组详情 |
| [e2e/issue-316-crew-worker-central-chain.spec.ts](../../../e2e/issue-316-crew-worker-central-chain.spec.ts) | Playwright E2E | Issue #316：班组—工人中央关系链 |
| [e2e/worker-detail.spec.ts](../../../e2e/worker-detail.spec.ts) | Playwright E2E | Issue #194：工人详情 |
| [e2e/worker-roster-archive.spec.ts](../../../e2e/worker-roster-archive.spec.ts) | Playwright E2E | 工人整页维护、工资成员归档、冷回读、真实照片 ZIP 与权限撤销 |
