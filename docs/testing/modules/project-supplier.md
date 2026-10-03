# 项目供应商

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/project-supplier/command-contract.test.ts](../../../tests/project-supplier/command-contract.test.ts) | 单元／服务／状态 | 项目分供方中央导入命令 |
| [tests/project-supplier/file-archive.test.ts](../../../tests/project-supplier/file-archive.test.ts) | 单元／服务／状态 | 选中合作原件 ZIP |
| [tests/project-supplier/file-content.test.ts](../../../tests/project-supplier/file-content.test.ts) | 单元／服务／状态 | 项目合作档案正文读取边界 |
| [tests/project-supplier/file-reader.test.ts](../../../tests/project-supplier/file-reader.test.ts) | 单元／服务／状态 | 项目合作原件中央服务 |
| [tests/project-supplier/file-source.test.ts](../../../tests/project-supplier/file-source.test.ts) | 单元／服务／状态 | 项目合作中央正文源 |
| [tests/project-supplier/http-repository.test.ts](../../../tests/project-supplier/http-repository.test.ts) | 单元／服务／状态 | 项目×分供方 HTTP Repository |
| [tests/project-supplier/repository-contract.test.ts](../../../tests/project-supplier/repository-contract.test.ts) | 单元／服务／状态 | 项目×分供方中央 Repository 契约 |
| [tests/project-supplier/return-context.test.ts](../../../tests/project-supplier/return-context.test.ts) | 单元／服务／状态 | 项目×分供方受限来源上下文 |
| [tests/project-supplier/source-target-policy.test.ts](../../../tests/project-supplier/source-target-policy.test.ts) | 单元／服务／状态 | 项目分供方源单目标策略 |
| [tests/server/project-supplier-central-test-instance.test.ts](../../../tests/server/project-supplier-central-test-instance.test.ts) | 单元／服务／状态 | 项目×分供方中央读取测试实例 |
| [tests/stores/project-supplier-import.test.ts](../../../tests/stores/project-supplier-import.test.ts) | 单元／服务／状态 | 项目分供方文件导入事务 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/ProjectSupplierFactTable.test.ts](../../../tests/components/ProjectSupplierFactTable.test.ts) | 组件（jsdom） | 项目分供方事实表 |
| [tests/components/ProjectSupplierFileAccess.test.ts](../../../tests/components/ProjectSupplierFileAccess.test.ts) | 组件（jsdom） | 合作原件工作台动作 |
| [tests/components/ProjectSupplierFilePanel.test.ts](../../../tests/components/ProjectSupplierFilePanel.test.ts) | 组件（jsdom） | 项目分供方合作文件 |
| [tests/components/ProjectSupplierImportWizard.test.ts](../../../tests/components/ProjectSupplierImportWizard.test.ts) | 组件（jsdom） | project supplier import wizard |
| [tests/components/ProjectSupplierLinksPanel.test.ts](../../../tests/components/ProjectSupplierLinksPanel.test.ts) | 组件（jsdom） | 项目详情分供方入口 |
| [tests/components/ProjectSupplierOverview.test.ts](../../../tests/components/ProjectSupplierOverview.test.ts) | 组件（jsdom） | 项目分供方身份概览 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-192-project-supplier.spec.ts](../../../e2e/issue-192-project-supplier.spec.ts) | Playwright E2E | Issue #192：项目×分供方工作台与文件导入 |
| [e2e/issue-317-project-supplier-facts.spec.ts](../../../e2e/issue-317-project-supplier-facts.spec.ts) | Playwright E2E | Issue #317：项目分供方六类事实工作台 |
| [e2e/issue-319-project-material-supplier-journey.spec.ts](../../../e2e/issue-319-project-material-supplier-journey.spec.ts) | Playwright E2E | 关联物资：项目供应商穿透流程 |
| [e2e/project-supplier-files.spec.ts](../../../e2e/project-supplier-files.spec.ts) | Playwright E2E | Issue #438 合作档案中央原件 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/project-supplier/pdf-fixture.ts](../../../tests/project-supplier/pdf-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
