# 工程量清单与月报

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/boq/catalog.test.ts](../../../tests/boq/catalog.test.ts) | 单元／服务／状态 | boq catalog scope keys |
| [tests/boq/central-building-http.test.ts](../../../tests/boq/central-building-http.test.ts) | 单元／服务／状态 | 中央清单楼栋实际 HTTP |
| [tests/boq/central-building-invariants.test.ts](../../../tests/boq/central-building-invariants.test.ts) | 单元／服务／状态 | 已批新增行只读，原始行更正保量价、审批时序、台账、已报快照和全部排程事实 |
| [tests/boq/central-building-migration.test.ts](../../../tests/boq/central-building-migration.test.ts) | 单元／服务／状态 | 受控 SQLite 导出保留已确认原始 BOQ 行文件、追踪行与来源资格 |
| [tests/boq/central-building.test.ts](../../../tests/boq/central-building.test.ts) | 单元／服务／状态 | 中央导入 BOQ 楼栋证据 |
| [tests/boq/changes.test.ts](../../../tests/boq/changes.test.ts) | 单元／服务／状态 | boq change order lifecycle |
| [tests/boq/export.test.ts](../../../tests/boq/export.test.ts) | 单元／服务／状态 | boq exports |
| [tests/boq/import.test.ts](../../../tests/boq/import.test.ts) | 单元／服务／状态 | boq import pipeline |
| [tests/boq/monthly.test.ts](../../../tests/boq/monthly.test.ts) | 单元／服务／状态 | boq monthly statements |
| [tests/boq/read-model.test.ts](../../../tests/boq/read-model.test.ts) | 单元／服务／状态 | boq read model |
| [tests/db/boq-migrations.test.ts](../../../tests/db/boq-migrations.test.ts) | 单元／服务／状态 | v15 BOQ 清单、变更与月度报量数据底座 |
| [tests/db/boq-seed.test.ts](../../../tests/db/boq-seed.test.ts) | 单元／服务／状态 | boq 演示 seed |
| [tests/db/monthly-status-migration.test.ts](../../../tests/db/monthly-status-migration.test.ts) | 单元／服务／状态 | monthly statement owner lifecycle migration |
| [tests/stores/boq-building.test.ts](../../../tests/stores/boq-building.test.ts) | 单元／服务／状态 | 楼栋证据中央命令状态 |
| [tests/stores/boq.test.ts](../../../tests/stores/boq.test.ts) | 单元／服务／状态 | boq store |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/BoqBuildingEvidenceState.test.ts](../../../tests/components/BoqBuildingEvidenceState.test.ts) | 组件（jsdom） | 合同楼栋证据整页更正 |
| [tests/components/BoqChangeWorkspace.test.ts](../../../tests/components/BoqChangeWorkspace.test.ts) | 组件（jsdom） | boqChangeWorkspace |
| [tests/components/BoqImportWizard.test.ts](../../../tests/components/BoqImportWizard.test.ts) | 组件（jsdom） | boqImportWizard |
| [tests/components/BoqLinesTable.test.ts](../../../tests/components/BoqLinesTable.test.ts) | 组件（jsdom） | boqLinesTable |
| [tests/components/BoqMonthlyWorkspace.test.ts](../../../tests/components/BoqMonthlyWorkspace.test.ts) | 组件（jsdom） | boqMonthlyWorkspace |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/boq-workspace.spec.ts](../../../e2e/boq-workspace.spec.ts) | Playwright E2E | Issue #115：BOQ 清单、变更与月度报量 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/helpers/boq-building-fixture.ts](../../../tests/helpers/boq-building-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
