# 物资与价格

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/material-quotation/graph.test.ts](../../../tests/material-quotation/graph.test.ts) | 单元／服务／状态 | 完整 Native 来源字节、原图与冻结历史、跨 ID 明确映射、原键恢复及坏证据拒绝 |
| [tests/material-quotation/import-repository.test.ts](../../../tests/material-quotation/import-repository.test.ts) | 单元／服务／状态 | 迁入读取范围及原命令回执契约 |
| [tests/material-quotation/source-prices.test.ts](../../../tests/material-quotation/source-prices.test.ts) | 单元／服务／状态 | 报价、合同价与实际送货价分别保留真实身份和量价条件 |
| [tests/material-quotation/contract.test.ts](../../../tests/material-quotation/contract.test.ts) | 单元／服务／状态 | 独立报价身份、未建档报价方、未知与零值及严格命令字段 |
| [tests/material-quotation/storage.test.ts](../../../tests/material-quotation/storage.test.ts) | 单元／服务／状态 | 报价实际磁盘归属、原件、冻结版本、权限切换、版本冲突与冷恢复 |
| [tests/material-quotation/command-session.test.ts](../../../tests/material-quotation/command-session.test.ts) | 单元／服务／状态 | 报价失响应沿原编号核验，保留后来输入，保存后回读失败不重复写入 |
| [tests/material-quotation/http-repository.test.ts](../../../tests/material-quotation/http-repository.test.ts) | 单元／服务／状态 | 报价读取身份、来源、权限、回执与原件契约 |
| [tests/material-quotation/price-facts.test.ts](../../../tests/material-quotation/price-facts.test.ts) | 单元／服务／状态 | 冻结报价各历史价格点、来源与原行追溯，不回写原合同或送货价 |
| [tests/material-contract/price-facts.test.ts](../../../tests/material-contract/price-facts.test.ts) | 单元／服务／状态 | 原合同价格、税点未知及有依据的单位换算 |
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
| [tests/components/MaterialPricePage.test.ts](../../../tests/components/MaterialPricePage.test.ts) | 组件（jsdom） | 送货与合同价格独立缺源、同源旧送货快照仅供查看、失权和迟到响应撤下事实；独立报价夹具明确空源，不借其他 owner 补齐 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/material-forms.spec.ts](../../../e2e/material-forms.spec.ts) | Playwright E2E | F4 物资整页表单：草稿真实编辑路由与冷回读、两组库存数量、结算与归档；四档视口分别使用独立浏览器上下文覆盖十二条表单 |
| [e2e/material-price-analysis.spec.ts](../../../e2e/material-price-analysis.spec.ts) | Playwright E2E | 正式项目、分供方、材料合同与送货事实；电线厂家趋势、两家钢材比价及五档视口 |
| [e2e/production-material-quotations.spec.ts](../../../e2e/production-material-quotations.spec.ts) | Playwright E2E | 真实磁盘报价、完整来源选择与明确跨 ID 迁入、失响应原键及历史冷读、五档视口 |
| [e2e/owner-material.spec.ts](../../../e2e/owner-material.spec.ts) | Playwright E2E | Issue #200 甲供材页面 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/material-production-fixture.ts](../../../e2e/helpers/material-production-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/quotation-migration-source.ts](../../../e2e/helpers/quotation-migration-source.ts) | 辅助／夹具 | 带真实 Native DDL、原件、历史与回执的独立合成 SQLite 来源 |

## 浏览器组件

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/browser/ContractPriceComparison.test.ts](../../../tests/browser/ContractPriceComparison.test.ts) | 浏览器组件 | 五视口合同价格表、原行追溯、换算及键盘焦点 |
| [tests/browser/QuotationPriceComparison.test.ts](../../../tests/browser/QuotationPriceComparison.test.ts) | 浏览器组件 | 五视口三来源比较、未建档报价方、表内滚动及原事实追溯 |
