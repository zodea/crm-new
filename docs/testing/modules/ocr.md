# OCR 通用识别

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/ocr/paddleocr-cloud.test.ts](../../../tests/ocr/paddleocr-cloud.test.ts) | 单元／服务／状态 | paddleOcrCloudClient |
| [tests/ocr/preferences.test.ts](../../../tests/ocr/preferences.test.ts) | 单元／服务／状态 | ocr 本机偏好 |
| [tests/ocr/runtime-options.test.ts](../../../tests/ocr/runtime-options.test.ts) | 单元／服务／状态 | ocr 运行参数契约 |
| [tests/ocr/sample-acceptance.test.ts](../../../tests/ocr/sample-acceptance.test.ts) | 单元／服务／状态 | OCR 本地样本验收清单；项目内独立合成样本 |
| [tests/ocr/sample-runner.test.ts](../../../tests/ocr/sample-runner.test.ts) | 单元／服务／状态 | OCR 样本运行摘要与重试；项目内独立合成输入及输出 |
| [tests/ocr/settings.test.ts](../../../tests/ocr/settings.test.ts) | 单元／服务／状态 | ocr 设置运行状态 |
| [tests/recognize/engine.test.ts](../../../tests/recognize/engine.test.ts) | 单元／服务／状态 | recognizeDocument |
| [tests/recognize/image-preprocess.test.ts](../../../tests/recognize/image-preprocess.test.ts) | 单元／服务／状态 | prepareDeliveryOcrImage |
| [tests/stores/ocr-settings.test.ts](../../../tests/stores/ocr-settings.test.ts) | 单元／服务／状态 | ocr 设置 store |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/OcrRecognitionSettingsForm.test.ts](../../../tests/components/OcrRecognitionSettingsForm.test.ts) | 组件（jsdom） | ocr 识别设置表单 |
| [tests/components/OcrRuntimeStatusCard.test.ts](../../../tests/components/OcrRuntimeStatusCard.test.ts) | 组件（jsdom） | ocr 运行状态卡 |
| [tests/components/OcrSettingsScreen.test.ts](../../../tests/components/OcrSettingsScreen.test.ts) | 组件（jsdom） | ocr 设置页面 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/ocr-settings-recovery.spec.ts](../../../e2e/ocr-settings-recovery.spec.ts) | Playwright E2E | OCR 设置重读失败锁定写入，键盘重试恢复原配置 |
| [e2e/ocr-settings.spec.ts](../../../e2e/ocr-settings.spec.ts) | Playwright E2E | Issue #204：OCR 设置 |
| [tests/ocr-local-browser/runtime.spec.ts](../../../tests/ocr-local-browser/runtime.spec.ts) | Playwright 独立配置 | 合成图片、扫描及中文 PDF、本地资源与外站请求；依赖隔离开发服务和本机 OCR 资源 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/ocr-local-browser/playwright.config.ts](../../../tests/ocr-local-browser/playwright.config.ts) | 浏览器测试配置 | 本地 OCR 浏览器验证的独立配置 |
