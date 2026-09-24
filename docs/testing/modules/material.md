# 物资与价格

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/db/f4-material-migrations.test.ts](../../../tests/db/f4-material-migrations.test.ts) | 单元／服务／状态 | v23 F4 物资表单与库存事实迁移 |
| [tests/material/forms.test.ts](../../../tests/material/forms.test.ts) | 单元／服务／状态 | f4 物资事实、派生库存与甲供材总控 |
| [tests/material/price-analysis.test.ts](../../../tests/material/price-analysis.test.ts) | 单元／服务／状态 | 材料单价分析 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/MaterialFormFields.test.ts](../../../tests/components/MaterialFormFields.test.ts) | 组件（jsdom） | materialFormFields data flow |
| [tests/components/MaterialLineGrid.test.ts](../../../tests/components/MaterialLineGrid.test.ts) | 组件（jsdom） | materialLineGrid behavior |
| [tests/components/MaterialListScreen.test.ts](../../../tests/components/MaterialListScreen.test.ts) | 组件（jsdom） | 物资列表连续工作面 |
| [tests/components/MaterialPriceAnalysisScreen.test.ts](../../../tests/components/MaterialPriceAnalysisScreen.test.ts) | 组件（jsdom） | materialPriceAnalysisScreen |
| [tests/components/MaterialPricePage.test.ts](../../../tests/components/MaterialPricePage.test.ts) | 组件（jsdom） | 材料单价分析读取周期 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/material-forms.spec.ts](../../../e2e/material-forms.spec.ts) | Playwright E2E | F4 物资领域整页表单 |
| [e2e/material-price-analysis.spec.ts](../../../e2e/material-price-analysis.spec.ts) | Playwright E2E | 材料单价分析真实价格事实 |
| [e2e/owner-material.spec.ts](../../../e2e/owner-material.spec.ts) | Playwright E2E | Issue #200 甲供材页面 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/material-production-fixture.ts](../../../e2e/helpers/material-production-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
