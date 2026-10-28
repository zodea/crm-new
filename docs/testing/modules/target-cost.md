# 目标成本与成本归集

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/migration/target-cost-source.test.ts](../../../tests/migration/target-cost-source.test.ts) | 单元／服务／状态 | 受控来源按预算版本保存完整图，项目无工程量、无项目草稿、旧空分项名及缺原件均保真 |
| [tests/stores/target-cost-central.test.ts](../../../tests/stores/target-cost-central.test.ts) | 单元／服务／状态 | 预算固定页面快照与原提交恢复 |
| [tests/stores/target-cost-pending-storage.test.ts](../../../tests/stores/target-cost-pending-storage.test.ts) | 单元／服务／状态 | 原附件提交不能可靠保存时阻断发送，恢复存储后可用原草稿重试 |
| [tests/tabs/target-cost-restore.test.ts](../../../tests/tabs/target-cost-restore.test.ts) | 单元／服务／状态 | 演示冷恢复先核服务端授权，再用同一隔离只读adapter，不误打正式详情 |
| [tests/target-cost/central-actual-sources.test.ts](../../../tests/target-cost/central-actual-sources.test.ts) | 单元／服务／状态 | 中央预算实际来源的金额完整度与身份 |
| [tests/target-cost/central-history.test.ts](../../../tests/target-cost/central-history.test.ts) | 单元／服务／状态 | 预算详情保留实体已缺失但归属明确的历史，不串入其他版本或其他领域 |
| [tests/target-cost/central-http.test.ts](../../../tests/target-cost/central-http.test.ts) | 单元／服务／状态 | 预算真实 HTTP 路由与事务边界 |
| [tests/target-cost/central-runtime.test.ts](../../../tests/target-cost/central-runtime.test.ts) | 单元／服务／状态 | 预算实际中央来源与公开项目选项 |
| [tests/target-cost/central-service.test.ts](../../../tests/target-cost/central-service.test.ts) | 单元／服务／状态 | 中央预算工作区事务 |
| [tests/target-cost/controlled-migration.test.ts](../../../tests/target-cost/controlled-migration.test.ts) | 单元／服务／状态 | 项目迁入没有预算图时，日常独立预算仍会阻止项目恢复 |
| [tests/target-cost/detail.test.ts](../../../tests/target-cost/detail.test.ts) | 单元／服务／状态 | target cost detail read model |
| [tests/target-cost/files.test.ts](../../../tests/target-cost/files.test.ts) | 单元／服务／状态 | 中央预算原件真实保存读取；缺件明确，跨预算不能读写，失败补传不丢旧元数据和审计 |
| [tests/target-cost/history-presentation.test.ts](../../../tests/target-cost/history-presentation.test.ts) | 单元／服务／状态 | 预算操作历史展示 |
| [tests/target-cost/items.test.ts](../../../tests/target-cost/items.test.ts) | 单元／服务／状态 | target cost item persistence |
| [tests/target-cost/list.test.ts](../../../tests/target-cost/list.test.ts) | 单元／服务／状态 | target cost list read model |
| [tests/target-cost/navigation.test.ts](../../../tests/target-cost/navigation.test.ts) | 单元／服务／状态 | 目标成本来源与返回上下文 |
| [tests/target-cost/null-read.test.ts](../../../tests/target-cost/null-read.test.ts) | 单元／服务／状态 | 预算空值与真实零 |
| [tests/target-cost/payroll-actual.test.ts](../../../tests/target-cost/payroll-actual.test.ts) | 单元／服务／状态 | 关联工资：从目标成本视角检查工资实际成本 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/TargetCostCentralDetailState.test.ts](../../../tests/components/TargetCostCentralDetailState.test.ts) | 组件（jsdom） | 预算科目整份保存状态 |
| [tests/components/TargetCostCentralList.test.ts](../../../tests/components/TargetCostCentralList.test.ts) | 组件（jsdom） | 中央预算列表同路由状态 |
| [tests/components/TargetCostCentralUiState.test.ts](../../../tests/components/TargetCostCentralUiState.test.ts) | 组件（jsdom） | 中央预算版本头独立草稿 |
| [tests/components/TargetCostDetail.test.ts](../../../tests/components/TargetCostDetail.test.ts) | 组件（jsdom） | target cost detail presentation |
| [tests/components/TargetCostFiles.test.ts](../../../tests/components/TargetCostFiles.test.ts) | 组件（jsdom） | 下载具有真实原件且旧大小未知的附件，并继续校验原始字节摘要 |
| [tests/components/TargetCostItemEditor.test.ts](../../../tests/components/TargetCostItemEditor.test.ts) | 组件（jsdom） | target cost item editor |
| [tests/components/TargetCostReadPresentation.test.ts](../../../tests/components/TargetCostReadPresentation.test.ts) | 组件（jsdom） | 预算原值和受控回程 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/target-cost-central.spec.ts](../../../e2e/target-cost-central.spec.ts) | Playwright E2E | 预算真实迁入、版本头与科目整份保存、原件、固定版本及来源往返 |
| [e2e/target-cost-detail.spec.ts](../../../e2e/target-cost-detail.spec.ts) | Playwright E2E | Issue #191：目标成本详情 |
| [e2e/target-cost-management.spec.ts](../../../e2e/target-cost-management.spec.ts) | Playwright E2E | Issue #191：目标成本列表与科目维护 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/target-cost-migration-source.ts](../../../e2e/helpers/target-cost-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/target-cost-migration-source.ts](../../../tests/helpers/target-cost-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
