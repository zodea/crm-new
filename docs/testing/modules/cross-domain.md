# 跨业务页面与流程

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/stores/central-list-snapshot.test.ts](../../../tests/stores/central-list-snapshot.test.ts) | 单元／服务／状态 | 客户／班组／工人中央列表可见范围与旧快照 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/DocumentListScreens.test.ts](../../../tests/components/DocumentListScreens.test.ts) | 组件（jsdom） | 财务／物资列表共同行为 |
| [tests/components/DomainFormPages.test.ts](../../../tests/components/DomainFormPages.test.ts) | 组件（jsdom） | 财务／物资整页表单共同行为 |
| [tests/components/SupplementalListFilters.test.ts](../../../tests/components/SupplementalListFilters.test.ts) | 组件（jsdom） | 付款／发票／通知筛选共同行为 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/document-list-reference.spec.ts](../../../e2e/document-list-reference.spec.ts) | Playwright E2E | Issue #419：十五类单据列表均保留紧凑工具与真实可操作表头 |
| [e2e/full-page-form-responsive.spec.ts](../../../e2e/full-page-form-responsive.spec.ts) | Playwright E2E | #112 R3-B 整页表单增量验收 |
| [e2e/issue-418-page-hierarchy.spec.ts](../../../e2e/issue-418-page-hierarchy.spec.ts) | Playwright E2E | Issue #418：页面层次与红圈结构对齐 |
| [e2e/list-enum-filters.spec.ts](../../../e2e/list-enum-filters.spec.ts) | Playwright E2E | 辅助合同和其他支出结算保留旧链接并提交完整多选值，默认控件无粗框 |
| [e2e/list-multifilter-regression.spec.ts](../../../e2e/list-multifilter-regression.spec.ts) | Playwright E2E | ${width}px 单据多选联动完整结果、清空与无闪动刷新 |
| [e2e/responsive-workspaces.spec.ts](../../../e2e/responsive-workspaces.spec.ts) | Playwright E2E | Issue #112 R2：高风险业务工作区 |
| [e2e/supplemental-list-filters.spec.ts](../../../e2e/supplemental-list-filters.spec.ts) | Playwright E2E | ${width}px 补充列表多选浮层可达且保持主视图 |
