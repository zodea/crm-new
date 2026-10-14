# 发票与税额工具

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/db/invoice-ledger.test.ts](../../../tests/db/invoice-ledger.test.ts) | 单元／服务／状态 | checkReviewed:归档前置——未校对一律拒绝(DATABASE.md §2.4「核对完成是归档唯一前置」) |
| [tests/finance/factor-combination.test.ts](../../../tests/finance/factor-combination.test.ts) | 单元／服务／状态 | solveFactorCombinations：精确整数组合 |
| [tests/invoice/batch-pass.test.ts](../../../tests/invoice/batch-pass.test.ts) | 单元／服务／状态 | isAllGreen:全绿判定(建议通过标记与批量通过入围条件) |
| [tests/invoice/excel.test.ts](../../../tests/invoice/excel.test.ts) | 单元／服务／状态 | 发票台账 Excel 导出 |
| [tests/invoice/ledger-nodes.test.ts](../../../tests/invoice/ledger-nodes.test.ts) | 单元／服务／状态 | 台账树键与 query 预筛（specs §07：预筛不进页签身份） |
| [tests/invoice/print-layout.test.ts](../../../tests/invoice/print-layout.test.ts) | 单元／服务／状态 | 发票打印排版与打印资格：无原件、识别、确认、重复、金额逐项拒绝原因 |
| [tests/invoice/recognition-changes.test.ts](../../../tests/invoice/recognition-changes.test.ts) | 单元／服务／状态 | 重新识别前后的字段差异：人工值被覆盖、清空、补出均列出，长票号按文本比较；草稿字段标记与保存确认正文 |
| [tests/invoice/recognition-regions.test.ts](../../../tests/invoice/recognition-regions.test.ts) | 单元／服务／状态 | 识别字段 → OCR 版面块区域：归一化、金额数字边界、标签消歧、不造框条件、180° 翻转与多页；旋转/缩放坐标换算；变动字段按块合并与“原图未定位”清单 |
| [tests/invoice/recognize.test.ts](../../../tests/invoice/recognize.test.ts) | 单元／服务／状态 | confidenceTier:置信度分档(边框色/角标/✓确认 依据) |
| [tests/invoice/status.test.ts](../../../tests/invoice/status.test.ts) | 单元／服务／状态 | invoiceDocStatus:单一权威的状态优先级 |
| [tests/recognize/invoice-engine.test.ts](../../../tests/recognize/invoice-engine.test.ts) | 单元／服务／状态 | recognizeInvoice；带版面块坐标时给出字段块级区域，无坐标为空 |
| [tests/recognize/invoice-parse.test.ts](../../../tests/recognize/invoice-parse.test.ts) | 单元／服务／状态 | parseInvoiceText |
| [tests/stores/invoice-archive.test.ts](../../../tests/stores/invoice-archive.test.ts) | 单元／服务／状态 | invoice store 归档来源留痕 |
| [tests/stores/invoice-preferences.test.ts](../../../tests/stores/invoice-preferences.test.ts) | 单元／服务／状态 | invoice store 导出样式偏好 |
| [tests/stores/invoice-printing.test.ts](../../../tests/stores/invoice-printing.test.ts) | 单元／服务／状态 | invoice store 打印计数 |
| [tests/stores/invoice-recognition.test.ts](../../../tests/stores/invoice-recognition.test.ts) | 单元／服务／状态 | invoice store 真实识别管线；重新识别只返回草稿不写库、失败不产生草稿、守卫保持；保存草稿后归档审计保留首次识别与完整修订链路 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/FactorSolverState.test.ts](../../../tests/components/FactorSolverState.test.ts) | 组件（jsdom） | 因子工具保存配置兼容 |
| [tests/components/FactorTaxCalculator.test.ts](../../../tests/components/FactorTaxCalculator.test.ts) | 组件（jsdom） | 共用金额税额栏 |
| [tests/components/InvoiceEditPage.test.ts](../../../tests/components/InvoiceEditPage.test.ts) | 组件（jsdom） | 编辑页重新识别草稿：只填表单不写库、保存二次确认（取消不写库）、字段角标与读屏原值、放弃恢复、离开保护、失败保留输入；原图比对框、“原图未定位”、聚焦/悬停强调与旋转换算，无原文件或放弃后回到示意图 |
| [tests/components/InvoiceReviewForm.test.ts](../../../tests/components/InvoiceReviewForm.test.ts) | 组件（jsdom） | 识别校对表单草稿模式：修改只交父级不写库，变动字段角标与读屏原值；聚焦/悬停变动字段通知原图强调，读屏说明原图是否框出 |
| [tests/components/InvoicePrintLayout.test.ts](../../../tests/components/InvoicePrintLayout.test.ts) | 组件（jsdom） | 打印面板：无原件的 Excel 发票不可勾选、列出未打印清单，打印只提交有原件的票 |
| [tests/components/InvoiceExportPreview.test.ts](../../../tests/components/InvoiceExportPreview.test.ts) | 组件（jsdom） | 发票导出预览样式草稿 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/factor-solver.spec.ts](../../../e2e/factor-solver.spec.ts) | Playwright E2E | 精确因子组合工作台 |
| [e2e/invoice-export-borders.spec.ts](../../../e2e/invoice-export-borders.spec.ts) | Playwright E2E | Issue #437 发票 Excel 分组边框 |
| [e2e/invoice-ledger-print-mode.spec.ts](../../../e2e/invoice-ledger-print-mode.spec.ts) | Playwright E2E | 发票台账打印入口：Excel 行可在台账勾选合计但不进入打印，进入双栏选择、打印确认并返回台账 |
| [e2e/invoice-print-layout.spec.ts](../../../e2e/invoice-print-layout.spec.ts) | Playwright E2E | 发票打印排版：1/2/4 张、勾选合计、旋转、打印确认与计数持久化 |
| [e2e/invoice-project-linkage.spec.ts](../../../e2e/invoice-project-linkage.spec.ts) | Playwright E2E | 发票全旅程：识别归档后三处联动，改项目后迁移，再转个人开支隔离 |
| [e2e/issue-398-invoice-rerecognition.spec.ts](../../../e2e/issue-398-invoice-rerecognition.spec.ts) | Playwright E2E | 工作台与编辑页重新识别先作草稿：高亮变动、保存/确认二次确认、取消不写库、离开保护，原图比对框可见、聚焦字段与键盘 Tab 变动条目时强调、缩放旋转后仍可见，1440 与 390 视口键盘焦点，四档视口不横滚 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/fixtures/invoice-workbook.ts](../../../tests/fixtures/invoice-workbook.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
