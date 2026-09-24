# 数据库、会话与基础工具

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/composables/session-file-cache.test.ts](../../../tests/composables/session-file-cache.test.ts) | 单元／服务／状态 | 会话原文件生命周期 |
| [tests/db/browser-storage.test.ts](../../../tests/db/browser-storage.test.ts) | 单元／服务／状态 | browser database migration backup |
| [tests/db/coordinator.test.ts](../../../tests/db/coordinator.test.ts) | 单元／服务／状态 | 桌面数据库连接协调器 |
| [tests/db/data-workspace.test.ts](../../../tests/db/data-workspace.test.ts) | 单元／服务／状态 | local data workspace boundary |
| [tests/db/migrations.test.ts](../../../tests/db/migrations.test.ts) | 单元／服务／状态 | 迁移机制：版本化顺序迁移 |
| [tests/db/seed-data.test.ts](../../../tests/db/seed-data.test.ts) | 单元／服务／状态 | seed 数据:结构与 schema 对齐 |
| [tests/db/soft-delete.test.ts](../../../tests/db/soft-delete.test.ts) | 单元／服务／状态 | v2 迁移:全业务表 deleted_at + operation_logs |
| [tests/kit/money.test.ts](../../../tests/kit/money.test.ts) | 单元／服务／状态 | 金额格式化：formatMoney |
| [tests/kit/tauri-security.test.ts](../../../tests/kit/tauri-security.test.ts) | 单元／服务／状态 | tauri 桌面壳安全边界 |
| [tests/server/business-session.test.ts](../../../tests/server/business-session.test.ts) | 单元／服务／状态 | default business session boundary |
| [tests/server/demo-workspace-test-instance.test.ts](../../../tests/server/demo-workspace-test-instance.test.ts) | 单元／服务／状态 | global demo workspace capability boundary |
| [tests/stores/data-visibility.test.ts](../../../tests/stores/data-visibility.test.ts) | 单元／服务／状态 | global data visibility preference |
| [tests/util/chinese-amount.test.ts](../../../tests/util/chinese-amount.test.ts) | 单元／服务／状态 | moneyToChinese |
| [tests/util/datetime.test.ts](../../../tests/util/datetime.test.ts) | 单元／服务／状态 | datetime formatting |
| [tests/util/external-url.test.ts](../../../tests/util/external-url.test.ts) | 单元／服务／状态 | external URL platform boundary |
| [tests/util/file-ref-access.test.ts](../../../tests/util/file-ref-access.test.ts) | 单元／服务／状态 | file reference preview safety |
| [tests/util/file-refs.test.ts](../../../tests/util/file-refs.test.ts) | 单元／服务／状态 | file reference content access |
| [tests/util/json.test.ts](../../../tests/util/json.test.ts) | 单元／服务／状态 | parseJsonColumn:JSON 列安全解析(类型守卫) |
| [tests/util/local-date.test.ts](../../../tests/util/local-date.test.ts) | 单元／服务／状态 | toLocalDateInputValue |
| [tests/util/privacy.test.ts](../../../tests/util/privacy.test.ts) | 单元／服务／状态 | 敏感信息展示脱敏 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/FileRefAttachmentSection.test.ts](../../../tests/components/FileRefAttachmentSection.test.ts) | 组件（jsdom） | fileRefAttachmentSection restore flow |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-279-demo-data-boundary.spec.ts](../../../e2e/issue-279-demo-data-boundary.spec.ts) | Playwright E2E | Issue #279：正式与演示数据边界 |

## Rust 集成测试

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [src-tauri/tests/database_pool.rs](../../../src-tauri/tests/database_pool.rs) | Rust 集成测试 | 桌面数据库池集成测试 |

## Rust 内联单元测试

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [src-tauri/src/lib.rs](../../../src-tauri/src/lib.rs) | Rust 内联单元测试 | #[cfg(test)] 内的外链允许列表测试；本文件同时包含生产代码 |
