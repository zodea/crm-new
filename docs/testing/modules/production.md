# 生产访问、备份与存储

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/server/lan-verification-proxy.test.ts](../../../tests/server/lan-verification-proxy.test.ts) | 本机 HTTP 与合成数据 | 隔离入口来源校验、登录凭据、备份配置及二进制原件传输字节核对 |
| [tests/production/target-cost-storage.test.ts](../../../tests/production/target-cost-storage.test.ts) | 真实磁盘与独立进程 | 原预算版本、实际消费依据、完整 SQLite 输入与本域来源保全、原件、原编号和受保护整批恢复 |
| [tests/production/quantity-storage.test.ts](../../../tests/production/quantity-storage.test.ts) | 真实磁盘与独立进程 | 原工程量事实、主档只读、动作消费版本、失效楼栋拒绝及无副作用、原命令封存与冷恢复 |
| [tests/production/quantity-migration.test.ts](../../../tests/production/quantity-migration.test.ts) | 真实完整 SQLite 与独立进程 | 领域原图、精确 SQL 原列、同源映射、共享原件、清单撤权拒绝、整批恢复及下游引用保护 |
| [tests/production/wbs-storage.test.ts](../../../tests/production/wbs-storage.test.ts) | 真实磁盘与独立进程 | 真实暂估及单位、正式不可变库、实际动作依赖、迁入原图和原件、原号封存及危险恢复 |
| [tests/production/payroll-storage.test.ts](../../../tests/production/payroll-storage.test.ts) | 真实磁盘与独立进程 | C1/C2 冻结与零成员、P4/P7、正式编号、固定名册及完整目录、原键与回执故障回滚；C1 班组资格变化后陈旧来源拒绝核对，重读保留草稿并明确阻断原因 |
| [tests/production/payroll-history-adoption.test.ts](../../../tests/production/payroll-history-adoption.test.ts) | 真实完整 SQLite 与同库引用 | A/P5/P6 原冻结、管理簿与更正补退、同源工程量引用和原目录保全 |
| [tests/production/storage-schema.test.ts](../../../tests/production/storage-schema.test.ts) | 单元／服务／状态 | 真实盘历史与付款核验保护被删除、替换或改变条件时冷启动和备份拒绝，不重建保护冒充完整 |
| [tests/production/migration-references.test.ts](../../../tests/production/migration-references.test.ts) | 单元／服务／状态 | 实际主档引用ID和独立版本、权限、冷打开及损坏拒绝；同名合成项目按稳定身份读取、改名与同进程重开后不串接 |
| [tests/production/backup-quotation.test.ts](../../../tests/production/backup-quotation.test.ts) | 单元／服务／状态 | 报价实际参与者、原价与未知税点、原件字节、冷回执；结构完整性及损坏历史拒绝 |
| [tests/production/finance-storage.test.ts](../../../tests/production/finance-storage.test.ts) | 单元／服务／状态 | F3 单库事务、原费用不重复计成本、实付确认与撤回、原件与冷启动原键，工作台实付权限／来源版本及失权迟到响应；付款采用发票期间撤权回滚 |
| [tests/production/finance-verification.test.ts](../../../tests/production/finance-verification.test.ts) | 实际 SQLite 及正式参与者 | 旧 v12/v13 备份、v30 升级历史冻结及原件冷恢复；损坏依据拒绝、未知原键与可靠后读、撤权和版本冲突 |
| [tests/production/crew-worker-storage.test.ts](../../../tests/production/crew-worker-storage.test.ts) | 单元／服务／状态 | 全局工人稳定身份、跨项目候选、隐私与权限边界、同库冷读取及损坏来源拒绝 |
| [tests/production/supplier-credential-delete-restart.test.ts](../../../tests/production/supplier-credential-delete-restart.test.ts) | 合成数据库、本机 HTTP 与独立进程 | 证照两次删除之间撤回，重启后以最新版本拒绝旧撤回凭证、核对无副作用，并以当前凭证恢复同一原件；使用合成服务，不覆盖完整 Nuxt 或浏览器 |
| [tests/production/notification-restart.test.ts](../../../tests/production/notification-restart.test.ts) | 单元／服务／状态 | 消息原键与已读事实冷重启保全 |
| [tests/production/notification-storage.test.ts](../../../tests/production/notification-storage.test.ts) | 单元／服务／状态 | 消息事件、原命令及已读事实同库持久化 |
| [tests/production/auth.test.ts](../../../tests/production/auth.test.ts) | 单元／服务／状态 | 单人正式访问保护 |
| [tests/production/backup-manifest.test.ts](../../../tests/production/backup-manifest.test.ts) | 单元／服务／状态 | 一致副本清单及超过 260 字符中文普通路径的只读核验；原件、两版审计、回执和摘要保全，缺正文、字节坏损或未知表拒绝 |
| [tests/production/backup-package.test.ts](../../../tests/production/backup-package.test.ts) | 单元／服务／状态 | 中文深目录新库与冷打开、长目标一致备份、离线复制及隔离恢复；原件和同键回执保真、不重复写，已有目标与健康副本不被覆盖 |
| [tests/production/backup-policy.test.ts](../../../tests/production/backup-policy.test.ts) | 单元／服务／状态 | 备份保护与调度使用实际数据时点；一次旅程检查已清理包确实不存在，并逐一保留最后成功、基线和混入未知文件的包 |
| [tests/production/backup-service.test.ts](../../../tests/production/backup-service.test.ts) | 单元／服务／状态 | 计划补跑、原键回执、介质失败保上份、离线时点和隔离恢复证明持久一致 |
| [tests/production/backup-cleanup-paused.test.ts](../../../tests/production/backup-cleanup-paused.test.ts) | 合成目录／真实服务与独立进程 | 自动清理暂停、各副本与原键保全；隔离恢复的合成客户和原件独立进程回读 |
| [tests/production/backup-ui-state.test.ts](../../../tests/production/backup-ui-state.test.ts) | 单元／服务／状态 | 备份失响应后刷新重建界面仍使用原编号，成功回读后才清除；不完整成功回执的明确拒绝 |
| [tests/production/material-contract-storage.test.ts](../../../tests/production/material-contract-storage.test.ts) | 单元／服务／状态 | 材采日常 SQL 事务、原件与回执冷读、完整混合图备份及封存；损坏图停止恢复，未接管正式初次写入保持门禁 |
| [tests/production/storage-backup.test.ts](../../../tests/production/storage-backup.test.ts) | 单元／服务／状态 | 一致备份保留已提交事实并拒绝覆盖已有目标，原库和副本能独立读取 |
| [tests/production/storage-boundaries.test.ts](../../../tests/production/storage-boundaries.test.ts) | 单元／服务／状态 | 缺失目录、损坏文件与未知版本停止初始化，不替换已有文件 |
| [tests/production/storage-upgrade.test.ts](../../../tests/production/storage-upgrade.test.ts) | 单元／服务／状态 | v1/v7/v12 同事务升级与冲突回滚、原金额和现金保全、v13 核验追加及旧备份表清单保留；v13→v14 核定和明确采用关系冲突回滚、原费用／清偿／批复／银行分摊及原件保全，v28 起发票登记、v29–32 清单及冲突回滚；冷重开不补造核验 |
| [tests/production/storage.test.ts](../../../tests/production/storage.test.ts) | 单元／服务／状态 | 磁盘权威事务提交后冷打开保留原值，失败事务不留下半份结果 |
| [tests/production/boq-migration.test.ts](../../../tests/production/boq-migration.test.ts) | 单元／服务／状态 | 完整 BOQ SQLite 原图、原件、显式映射、隐私与整批恢复 |
| [tests/production/boq-storage.test.ts](../../../tests/production/boq-storage.test.ts) | 单元／服务／状态 | 日常清单与变洽签、真实上游、原件及原编号冷恢复 |
| [tests/production/owner-documents-storage.test.ts](../../../tests/production/owner-documents-storage.test.ts) | 真实磁盘与独立进程 | 八类商务单据、原 BOQ 委托事实、验收双视图、原件/回执、实际消费版本、NULL 与冻结历史、整改抵扣及受保护恢复 |
| [tests/production/owner-documents-migration.test.ts](../../../tests/production/owner-documents-migration.test.ts) | 完整 Native SQLite 与独立进程 | 同 SHA 施工/BOQ 身份、精确原列及未知扩展、原审计/命令、软删、历史 NULL/空原件、Other 原目标与整批危险恢复 |
| [tests/production/owner-settlement.test.ts](../../../tests/production/owner-settlement.test.ts) | 同库共享结算与 F3 | 商务/Other owner 权限、合同领域与版本证据、不可变 Other 头、原结算与独立抵扣、申请及实际支付精确分摊、项目/合同宿主来源与冷恢复 |
| [tests/production/construction-contract-storage.test.ts](../../../tests/production/construction-contract-storage.test.ts) | 单元／服务／状态 | 施工主合同与协议、完整原件、历史与实际源冷恢复；合成旧库夹具设异常关闭保护 |
| [tests/production/construction-scope-storage.test.ts](../../../tests/production/construction-scope-storage.test.ts) | 单元／服务／状态 | 同库单份工程关联、原费用去重、权限及真实来源消费 |
| [tests/production/migration-domain-evidence.test.ts](../../../tests/production/migration-domain-evidence.test.ts) | 单元／服务／状态 | 来源原列、未知扩展、整数与 BLOB 的精确保全 |
| [tests/production/payroll-a-upstream.test.ts](../../../tests/production/payroll-a-upstream.test.ts) | 单元／服务／状态 | A 工资实际工程量与 BOQ 上游、独立工资价及发放冷恢复 |
| [tests/production/subcontract-storage.test.ts](../../../tests/production/subcontract-storage.test.ts) | 单元／服务／状态 | 分包主补合同、工程原子关联、Native 原图及独立进程恢复 |


## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/production-access-gate.test.ts](../../../tests/components/production-access-gate.test.ts) | 组件（jsdom） | 已认证后的连接失败遮挡但不卸载输入，明确过期才卸载业务页 |

## 浏览器组件

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/browser/ProductionBackupPause.test.ts](../../../tests/browser/ProductionBackupPause.test.ts) | 浏览器组件 | 暂停自动清理与空间提示、键盘焦点及五视口布局 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/production-backup.spec.ts](../../../e2e/production-backup.spec.ts) | Playwright E2E | 客户原件公开备份、失响应原键、离线副本与隔离冷恢复保持一致 |
| [e2e/production-our-signatories.spec.ts](../../../e2e/production-our-signatories.spec.ts) | Playwright E2E | 自有随机端口和合成磁盘库：材采选施工主合同后整页创建、编辑和关系回读；主体选择/协议冻结、原命令恢复、五档视口与独立进程重启读取 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/browser-production-snapshot.ts](../../../e2e/helpers/browser-production-snapshot.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/production-backup-paused-cold.ts](../../../tests/helpers/production-backup-paused-cold.ts) | 辅助／独立进程 | 合成备份原键回读与副本摘要核对 |
| [tests/helpers/production-target-cost-cold.ts](../../../tests/helpers/production-target-cost-cold.ts) | 辅助／夹具 | 预算版本、原基线与原件独立进程读取入口 |
| [tests/helpers/production-owner-document-cold.ts](../../../tests/helpers/production-owner-document-cold.ts) | 辅助／夹具 | 商务列表/详情/表单、验收双视图、原件、原 journal、独立事件及项目/合同宿主的独立冷进程入口 |
| [tests/helpers/production-owner-document-import-cold.ts](../../../tests/helpers/production-owner-document-import-cold.ts) | 辅助／夹具 | 原完整来源采用定位、原回执、采用状态及共享原件的独立冷进程入口 |
