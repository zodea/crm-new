# 核心身份迁移

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/migration/core-http-repository.test.ts](../../../tests/migration/core-http-repository.test.ts) | 单元／服务／状态 | hTTP core migration repository |
| [tests/migration/core-local-source.test.ts](../../../tests/migration/core-local-source.test.ts) | 单元／服务／状态 | 核心迁移来源及真实 SQLite 月度工程量的数值、缺失计数与依据 |
| [tests/migration/verified-snapshot.test.ts](../../../tests/migration/verified-snapshot.test.ts) | 单元／服务／状态 | 中央完整大 SQLite 字节的线性规范编码核验、独立摘要、原字节、外键及只读领域提取；写入拒绝的原因及记录保持 |
| [tests/migration/core-migration-navigation.test.ts](../../../tests/migration/core-migration-navigation.test.ts) | 单元／服务／状态 | 核心身份迁移入口 |
| [tests/server/audit-central-identities.test.ts](../../../tests/server/audit-central-identities.test.ts) | 单元／服务／状态 | 审计正式身份边界 |
| [tests/server/core-migration-preparation.test.ts](../../../tests/server/core-migration-preparation.test.ts) | 单元／服务／状态 | 异步SQL准备失败时丢弃已准备资源，其他领域既不取旧快照也不切换 |
| [tests/server/core-migration-project-read.test.ts](../../../tests/server/core-migration-project-read.test.ts) | 单元／服务／状态 | 核心迁移与项目正式读链 |
| [tests/server/core-migration-test-instance.test.ts](../../../tests/server/core-migration-test-instance.test.ts) | 单元／服务／状态 | core migration test instance |
| [tests/stores/core-migration.test.ts](../../../tests/stores/core-migration.test.ts) | 单元／服务／状态 | core migration store |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/CoreIdentityMigrationScreen.test.ts](../../../tests/components/CoreIdentityMigrationScreen.test.ts) | 组件（jsdom） | 核心身份迁移整页流程 |
| [tests/components/CoreMigrationPanels.test.ts](../../../tests/components/CoreMigrationPanels.test.ts) | 组件（jsdom） | 核心身份迁移展示面板 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-294-core-identity-migration.spec.ts](../../../e2e/issue-294-core-identity-migration.spec.ts) | Playwright E2E | 两组真实旧 SQLite 量价输入、核心身份及证照/工序完整图、真实命令重放与冷刷新回滚；五视口对账局部滚动、软删除实体行与本地恢复失败后的键盘人工重试 |
