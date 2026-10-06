# 生产访问、备份与存储

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/production/storage-schema.test.ts](../../../tests/production/storage-schema.test.ts) | 单元／服务／状态 | 真实盘历史与付款核验保护被删除、替换或改变条件时冷启动和备份拒绝，不重建保护冒充完整 |
| [tests/production/migration-references.test.ts](../../../tests/production/migration-references.test.ts) | 单元／服务／状态 | 实际主档引用ID和独立版本、权限、冷打开及损坏拒绝 |
| [tests/production/backup-quotation.test.ts](../../../tests/production/backup-quotation.test.ts) | 单元／服务／状态 | 报价实际参与者、原价与未知税点、原件字节、冷回执；结构完整性及损坏历史拒绝 |
| [tests/production/finance-storage.test.ts](../../../tests/production/finance-storage.test.ts) | 单元／服务／状态 | F3 单库事务、原费用不重复计成本、实付确认与撤回、原件与冷启动原键，工作台实付权限／来源版本及失权迟到响应 |
| [tests/production/finance-verification.test.ts](../../../tests/production/finance-verification.test.ts) | 实际 SQLite 及正式参与者 | 旧v12备份兼容、v13真实核验和原件冷恢复；损坏依据拒绝、未知原键与可靠后读、撤权、版本冲突及未接公司合同源 |
| [tests/production/crew-worker-storage.test.ts](../../../tests/production/crew-worker-storage.test.ts) | 单元／服务／状态 | 全局工人稳定身份、跨项目候选、隐私与权限边界、同库冷读取及损坏来源拒绝 |
| [tests/production/notification-restart.test.ts](../../../tests/production/notification-restart.test.ts) | 单元／服务／状态 | 消息原键与已读事实冷重启保全 |
| [tests/production/notification-storage.test.ts](../../../tests/production/notification-storage.test.ts) | 单元／服务／状态 | 消息事件、原命令及已读事实同库持久化 |
| [tests/production/auth.test.ts](../../../tests/production/auth.test.ts) | 单元／服务／状态 | 单人正式访问保护 |
| [tests/production/backup-manifest.test.ts](../../../tests/production/backup-manifest.test.ts) | 单元／服务／状态 | 一致副本清单及超过 260 字符中文普通路径的只读核验；原件、两版审计、回执和摘要保全，缺正文、字节坏损或未知表拒绝 |
| [tests/production/backup-package.test.ts](../../../tests/production/backup-package.test.ts) | 单元／服务／状态 | 中文深目录新库与冷打开、长目标一致备份、离线复制及隔离恢复；原件和同键回执保真、不重复写，已有目标与健康副本不被覆盖 |
| [tests/production/backup-policy.test.ts](../../../tests/production/backup-policy.test.ts) | 单元／服务／状态 | 备份保护与调度使用实际数据时点 |
| [tests/production/backup-retention.test.ts](../../../tests/production/backup-retention.test.ts) | 单元／服务／状态 | 只清理有成功回执且完整的到期包，保留最后成功/基线及混入未知文件的包 |
| [tests/production/backup-service.test.ts](../../../tests/production/backup-service.test.ts) | 单元／服务／状态 | 计划补跑、原键回执、介质失败保上份、离线时点和隔离恢复证明持久一致 |
| [tests/production/backup-ui-state.test.ts](../../../tests/production/backup-ui-state.test.ts) | 单元／服务／状态 | 备份失响应后刷新重建界面仍使用原编号，成功回读后才清除 |
| [tests/production/material-contract-storage.test.ts](../../../tests/production/material-contract-storage.test.ts) | 单元／服务／状态 | 材采日常 SQL 事务、原件与回执冷读、完整混合图备份及封存；损坏图停止恢复，未接管正式初次写入保持门禁 |
| [tests/production/storage-backup.test.ts](../../../tests/production/storage-backup.test.ts) | 单元／服务／状态 | 一致备份保留已提交事实并拒绝覆盖已有目标，原库和副本能独立读取 |
| [tests/production/storage-boundaries.test.ts](../../../tests/production/storage-boundaries.test.ts) | 单元／服务／状态 | 缺失目录、损坏文件与未知版本停止初始化，不替换已有文件 |
| [tests/production/storage-upgrade.test.ts](../../../tests/production/storage-upgrade.test.ts) | 单元／服务／状态 | v1/v7/v12 同事务升级与冲突回滚、原金额和现金保全、v13 核验追加及旧备份表清单保留；v13→v14 核定和明确采用关系冲突回滚、原费用／清偿／批复／银行分摊及原件保全，冷重开不补造核验 |
| [tests/production/storage.test.ts](../../../tests/production/storage.test.ts) | 单元／服务／状态 | 磁盘权威事务提交后冷打开保留原值，失败事务不留下半份结果 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/production-access-gate.test.ts](../../../tests/components/production-access-gate.test.ts) | 组件（jsdom） | 已认证后的连接失败遮挡但不卸载输入，明确过期才卸载业务页 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/production-backup.spec.ts](../../../e2e/production-backup.spec.ts) | Playwright E2E | 客户原件公开备份、失响应原键、离线副本与隔离冷恢复保持一致 |
| [e2e/production-our-signatories.spec.ts](../../../e2e/production-our-signatories.spec.ts) | Playwright E2E | 自有随机端口和合成磁盘库：主体整页维护、实际选择/协议冻结、丢响应原命令恢复保后来输入、五档视口和独立进程重启读取 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/browser-production-snapshot.ts](../../../e2e/helpers/browser-production-snapshot.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
