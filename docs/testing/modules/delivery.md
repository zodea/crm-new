# 小票与送货档案

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/delivery/central-service.test.ts](../../../tests/delivery/central-service.test.ts) | 单元／服务／状态 | 送货原件与修订中央公开行为 |
| [tests/delivery/central-state.test.ts](../../../tests/delivery/central-state.test.ts) | 单元／服务／状态 | 送货浏览器中央状态 |
| [tests/delivery/controlled-migration.test.ts](../../../tests/delivery/controlled-migration.test.ts) | 单元／服务／状态 | 送货完整受控迁移 |
| [tests/delivery/export.test.ts](../../../tests/delivery/export.test.ts) | 单元／服务／状态 | 送货单 Excel 导出 |
| [tests/delivery/legacy-history.test.ts](../../../tests/delivery/legacy-history.test.ts) | 单元／服务／状态 | 可证明的旧送货历史恢复 |
| [tests/delivery/match.test.ts](../../../tests/delivery/match.test.ts) | 单元／服务／状态 | matchSupplierName |
| [tests/delivery/material-contracts.test.ts](../../../tests/delivery/material-contracts.test.ts) | 单元／服务／状态 | 送货既有材采合同来源 |
| [tests/delivery/migration-source.test.ts](../../../tests/delivery/migration-source.test.ts) | 单元／服务／状态 | 送货旧库完整迁移来源 |
| [tests/delivery/read-service.test.ts](../../../tests/delivery/read-service.test.ts) | 单元／服务／状态 | 送货 HTTP 读入口服务 |
| [tests/delivery/records.test.ts](../../../tests/delivery/records.test.ts) | 单元／服务／状态 | 送货单 pass-1：版本化持久化 |
| [tests/delivery/reference-suggestions.test.ts](../../../tests/delivery/reference-suggestions.test.ts) | 单元／服务／状态 | 中央送货项目建议来源 |
| [tests/delivery/repository.test.ts](../../../tests/delivery/repository.test.ts) | 单元／服务／状态 | 送货 HTTP Repository 边界 |
| [tests/delivery/request.test.ts](../../../tests/delivery/request.test.ts) | 单元／服务／状态 | 送货 HTTP 命令解析 |
| [tests/delivery/review.test.ts](../../../tests/delivery/review.test.ts) | 单元／服务／状态 | 送货单号规范化 |
| [tests/delivery/source-assets.test.ts](../../../tests/delivery/source-assets.test.ts) | 单元／服务／状态 | 送货旧原件到不可变中央资产映射 |
| [tests/recognize/delivery-parse.test.ts](../../../tests/recognize/delivery-parse.test.ts) | 单元／服务／状态 | parseDeliveryMarkdown |
| [tests/stores/delivery-central-print.test.ts](../../../tests/stores/delivery-central-print.test.ts) | 单元／服务／状态 | 中央送货打印原件 |
| [tests/stores/delivery-recognition.test.ts](../../../tests/stores/delivery-recognition.test.ts) | 单元／服务／状态 | delivery store 真实识别与归档管线 |
| [tests/tabs/delivery-restore.test.ts](../../../tests/tabs/delivery-restore.test.ts) | 单元／服务／状态 | 送货详情页签按中央当前记录恢复 |
| [tests/tabs/delivery-tab-title.test.ts](../../../tests/tabs/delivery-tab-title.test.ts) | 单元／服务／状态 | 送货单归档库页签文案 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/DeliveryArchiveFormPage.test.ts](../../../tests/components/DeliveryArchiveFormPage.test.ts) | 组件（jsdom） | 送货单手工归档确认门禁 |
| [tests/components/DeliveryArchiveScreen.test.ts](../../../tests/components/DeliveryArchiveScreen.test.ts) | 组件（jsdom） | 送货单归档库导出 |
| [tests/components/DeliveryQueuePanel.test.ts](../../../tests/components/DeliveryQueuePanel.test.ts) | 组件（jsdom） | delivery queue panel |
| [tests/components/DeliveryRecognitionCentral.test.ts](../../../tests/components/DeliveryRecognitionCentral.test.ts) | 组件（jsdom） | 识别送货人工归档与别名的独立结果 |
| [tests/components/DeliveryRecordDetailScreen.test.ts](../../../tests/components/DeliveryRecordDetailScreen.test.ts) | 组件（jsdom） | deliveryRecordDetailScreen |
| [tests/components/DeliveryRecordHistory.test.ts](../../../tests/components/DeliveryRecordHistory.test.ts) | 组件（jsdom） | 送货只读修订历史 |
| [tests/components/DeliveryRecordSourcePanel.test.ts](../../../tests/components/DeliveryRecordSourcePanel.test.ts) | 组件（jsdom） | 送货原件读写边界 |
| [tests/components/DeliveryReferences.test.ts](../../../tests/components/DeliveryReferences.test.ts) | 组件（jsdom） | 送货处理区中央资料与独立别名保存 |
| [tests/components/delivery-duplicate-preview.test.ts](../../../tests/components/delivery-duplicate-preview.test.ts) | 组件（jsdom） | 送货单重复对照预览 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/delivery-central.spec.ts](../../../e2e/delivery-central.spec.ts) | Playwright E2E | 两页真实 PDF 经人工核对形成共享原件的两张逻辑记录，刷新修订下载与五档界面保持同源 |
| [e2e/delivery-export-browser-smoke.spec.ts](../../../e2e/delivery-export-browser-smoke.spec.ts) | Playwright E2E | Chromium 真实图片 API 生成图片 PDF，保留项目 PDF 原字节并通过 Poppler 首末页渲染 |
| [e2e/delivery-migration.spec.ts](../../../e2e/delivery-migration.spec.ts) | Playwright E2E | 真实 SQLite 送货头行原件打印与历史通过 HTTP 迁移、重试和回滚 |
| [e2e/delivery-recognition.spec.ts](../../../e2e/delivery-recognition.spec.ts) | Playwright E2E | 送货单闭环：上传识别、主数据匹配、人工核对并自动进入归档库 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/delivery-migration-source.ts](../../../e2e/helpers/delivery-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/fixtures/delivery-export-images.ts](../../../tests/fixtures/delivery-export-images.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
