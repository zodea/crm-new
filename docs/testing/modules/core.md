# 数据库、会话与基础工具

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/tooling/lazy-repositories.test.ts](../../../tests/tooling/lazy-repositories.test.ts) | 单元／服务／状态 | 仓储方法可同步解构和展开，按域首次加载、并发共用、失败重试与 HTTP 工厂方法对照 |
| [tests/stores/public-read-state.test.ts](../../../tests/stores/public-read-state.test.ts) | 单元／服务／状态 | 权限、来源与会话切换撤下旧私有事实 |
| [tests/server/related-read-meta.test.ts](../../../tests/server/related-read-meta.test.ts) | 单元／服务／状态 | 相关来源的真实读取证据 |
| [tests/server/public-read-problems.test.ts](../../../tests/server/public-read-problems.test.ts) | 单元／服务／状态 | 公共HTTP错误与原命令封存证明 |
| [tests/read-model/collection.test.ts](../../../tests/read-model/collection.test.ts) | 单元／服务／状态 | 完整候选分页、同一来源及版本核验 |
| [tests/read-model/meta.test.ts](../../../tests/read-model/meta.test.ts) | 单元／服务／状态 | 真实来源证明和公共元数据严格解码 |
| [tests/read-model/metric.test.ts](../../../tests/read-model/metric.test.ts) | 单元／服务／状态 | 真实零、未知、可证小计与精度 |
| [tests/read-model/pagination.test.ts](../../../tests/read-model/pagination.test.ts) | 单元／服务／状态 | 稳定分页、合法大小与跨页完整性 |
| [tests/util/read-model-state.test.ts](../../../tests/util/read-model-state.test.ts) | 单元／服务／状态 | 公开读取状态、来源失效与合法旧投影 |
| [tests/composables/session-file-cache.test.ts](../../../tests/composables/session-file-cache.test.ts) | 单元／服务／状态 | 会话原文件生命周期；附带会话数据随原文件释放，读取可被 computed 追踪 |
| [tests/db/browser-storage.test.ts](../../../tests/db/browser-storage.test.ts) | 单元／服务／状态 | browser database migration backup |
| [tests/db/coordinator.test.ts](../../../tests/db/coordinator.test.ts) | 单元／服务／状态 | 数据库连接协调器 |
| [tests/db/connection.test.ts](../../../tests/db/connection.test.ts) | 单元／服务／状态 | 实际数据库入口按需初始化、并发共用连接、条件种子、只读锁、失败关闭重试及初始化前一致备份 |
| [tests/db/native-snapshot.test.ts](../../../tests/db/native-snapshot.test.ts) | 单元／服务／状态 | 完整 SQLite 字节、版本、外键与只读迁移快照核验 |
| [tests/read-model/decimal.test.ts](../../../tests/read-model/decimal.test.ts) | 单元／服务／状态 | 十进制读模型的真实零、精度、极小数与非法值 |
| [tests/forms/read-context.test.ts](../../../tests/forms/read-context.test.ts) | 单元／服务／状态 | 表单读回先核当前身份、来源与权限，失败保留原键及晚输入 |
| [tests/db/data-workspace.test.ts](../../../tests/db/data-workspace.test.ts) | 单元／服务／状态 | local data workspace boundary |
| [tests/db/migrations.test.ts](../../../tests/db/migrations.test.ts) | 单元／服务／状态 | 迁移机制：版本化顺序迁移 |
| [tests/db/seed-data.test.ts](../../../tests/db/seed-data.test.ts) | 单元／服务／状态 | seed 数据:结构与 schema 对齐 |
| [tests/db/soft-delete.test.ts](../../../tests/db/soft-delete.test.ts) | 单元／服务／状态 | v2 迁移:全业务表 deleted_at + operation_logs |
| [tests/kit/money.test.ts](../../../tests/kit/money.test.ts) | 单元／服务／状态 | 金额格式化：formatMoney |
| [tests/server/business-session.test.ts](../../../tests/server/business-session.test.ts) | 单元／服务／状态 | default business session boundary |
| [tests/stores/data-visibility.test.ts](../../../tests/stores/data-visibility.test.ts) | 单元／服务／状态 | global data visibility preference |
| [tests/util/chinese-amount.test.ts](../../../tests/util/chinese-amount.test.ts) | 单元／服务／状态 | moneyToChinese |
| [tests/util/datetime.test.ts](../../../tests/util/datetime.test.ts) | 单元／服务／状态 | datetime formatting；toLocalDateInputValue |
| [tests/util/external-url.test.ts](../../../tests/util/external-url.test.ts) | 单元／服务／状态 | external URL platform boundary |
| [tests/util/file-ref-access.test.ts](../../../tests/util/file-ref-access.test.ts) | 单元／服务／状态 | file reference preview safety |
| [tests/util/file-refs.test.ts](../../../tests/util/file-refs.test.ts) | 单元／服务／状态 | file reference content access |
| [tests/util/json.test.ts](../../../tests/util/json.test.ts) | 单元／服务／状态 | parseJsonColumn:JSON 列安全解析(类型守卫) |
| [tests/util/privacy.test.ts](../../../tests/util/privacy.test.ts) | 单元／服务／状态 | 敏感信息展示脱敏 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/FileRefAttachmentSection.test.ts](../../../tests/components/FileRefAttachmentSection.test.ts) | 组件（jsdom） | 浏览器附件选择、只读附件及恢复操作 |
| [tests/components/AttachmentRows.test.ts](../../../tests/components/AttachmentRows.test.ts) | 组件（jsdom） | 财务、合同和主档附件行的下载、分类、删除与撤销 |
| [tests/components/OriginalFilePreviewDialog.test.ts](../../../tests/components/OriginalFilePreviewDialog.test.ts) | 组件（jsdom） | 原件加载、预览、Esc 与焦点恢复 |
| [tests/components/DomainImportRecovery.test.ts](../../../tests/components/DomainImportRecovery.test.ts) | 组件（jsdom） | 报价与其他结算迁入：原命令已应用后读取失败仅重读；权限切换撤下公开结果并保原键，跨代迟到回执隔离 |
| [tests/components/DomainFormCanonicalRecovery.test.ts](../../../tests/components/DomainFormCanonicalRecovery.test.ts) | 实际 Vue 表单、路由与页签缓存 | 首次保存及原命令恢复保后来字段和原件；留原实例后继续更新已保存的同一 ID，正常离页确认保持 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-279-demo-data-boundary.spec.ts](../../../e2e/issue-279-demo-data-boundary.spec.ts) | Playwright E2E | Issue #279：正式与演示数据边界 |

## Rust 集成测试

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |

## Rust 内联单元测试

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
