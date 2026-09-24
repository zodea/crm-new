# 通用导入导出

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/kit/configured-export-runner.test.ts](../../../tests/kit/configured-export-runner.test.ts) | 单元／服务／状态 | 配置导出运行器 |
| [tests/kit/export-config.test.ts](../../../tests/kit/export-config.test.ts) | 单元／服务／状态 | 配置导出：命名规则预览 |
| [tests/kit/export-directory.test.ts](../../../tests/kit/export-directory.test.ts) | 单元／服务／状态 | 桌面导出目录适配器 |
| [tests/kit/export.test.ts](../../../tests/kit/export.test.ts) | 单元／服务／状态 | 导出路径分流：chooseExportPath |
| [tests/kit/import-entities.test.ts](../../../tests/kit/import-entities.test.ts) | 单元／服务／状态 | 导入实体注册表 |
| [tests/kit/import-mapping-tab.test.ts](../../../tests/kit/import-mapping-tab.test.ts) | 单元／服务／状态 | 打开导入映射页签 |
| [tests/kit/import-mapping.test.ts](../../../tests/kit/import-mapping.test.ts) | 单元／服务／状态 | 导入映射：智能预匹配 |
| [tests/kit/import-runner.test.ts](../../../tests/kit/import-runner.test.ts) | 单元／服务／状态 | 导入执行器 |
| [tests/kit/import-source.test.ts](../../../tests/kit/import-source.test.ts) | 单元／服务／状态 | 导入源解析：原始表头 + 行 |
| [tests/stores/export-workflows.test.ts](../../../tests/stores/export-workflows.test.ts) | 单元／服务／状态 | 配置导出工作流上下文 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/kit-ui-config-export.spec.ts](../../../e2e/kit-ui-config-export.spec.ts) | Playwright E2E | 配置导出：实时预览、二级写盘、逐步完成并自动关闭页签 |
| [e2e/kit-ui-export.spec.ts](../../../e2e/kit-ui-export.spec.ts) | Playwright E2E | KitUI 单文件导出：选择目录、写入文件且只显示一次成功反馈 |
| [e2e/kit-ui-import-mapping.spec.ts](../../../e2e/kit-ui-import-mapping.spec.ts) | Playwright E2E | 导入映射：坏文件报错、预匹配三色态、必填门控、删行并成功导入后自动关闭 |
