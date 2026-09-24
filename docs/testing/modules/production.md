# 生产访问、备份与存储

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/production/auth.test.ts](../../../tests/production/auth.test.ts) | 单元／服务／状态 | 单人正式访问保护 |
| [tests/production/backup-manifest.test.ts](../../../tests/production/backup-manifest.test.ts) | 单元／服务／状态 | 清单来自实际一致副本，覆盖客户原件/审计/回执，字节坏损或未知表拒绝 |
| [tests/production/backup-package.test.ts](../../../tests/production/backup-package.test.ts) | 单元／服务／状态 | 真实独立副本与离线复制保留数据时间，隔离恢复不覆盖活动库，损坏复制不替换上份 |
| [tests/production/backup-policy.test.ts](../../../tests/production/backup-policy.test.ts) | 单元／服务／状态 | 备份保护与调度使用实际数据时点 |
| [tests/production/backup-retention.test.ts](../../../tests/production/backup-retention.test.ts) | 单元／服务／状态 | 只清理有成功回执且完整的到期包，保留最后成功/基线及混入未知文件的包 |
| [tests/production/backup-service.test.ts](../../../tests/production/backup-service.test.ts) | 单元／服务／状态 | 计划补跑、原键回执、介质失败保上份、离线时点和隔离恢复证明持久一致 |
| [tests/production/backup-ui-state.test.ts](../../../tests/production/backup-ui-state.test.ts) | 单元／服务／状态 | 备份失响应后刷新重建界面仍使用原编号，成功回读后才清除 |
| [tests/production/storage-backup.test.ts](../../../tests/production/storage-backup.test.ts) | 单元／服务／状态 | 一致备份保留已提交事实并拒绝覆盖已有目标，原库和副本能独立读取 |
| [tests/production/storage-boundaries.test.ts](../../../tests/production/storage-boundaries.test.ts) | 单元／服务／状态 | 缺失目录、损坏文件与未知版本停止初始化，不替换已有文件 |
| [tests/production/storage-upgrade.test.ts](../../../tests/production/storage-upgrade.test.ts) | 单元／服务／状态 | 既有客户v1库经同事务升级加入全部当前领域，客户参与者和原事实不被替换 |
| [tests/production/storage.test.ts](../../../tests/production/storage.test.ts) | 单元／服务／状态 | 磁盘权威事务提交后冷打开保留原值，失败事务不留下半份结果 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/production-access-gate.test.ts](../../../tests/components/production-access-gate.test.ts) | 组件（jsdom） | 已认证后的连接失败遮挡但不卸载输入，明确过期才卸载业务页 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/production-backup.spec.ts](../../../e2e/production-backup.spec.ts) | Playwright E2E | 客户原件公开备份、失响应原键、离线副本与隔离冷恢复保持一致 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/browser-production-snapshot.ts](../../../e2e/helpers/browser-production-snapshot.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
