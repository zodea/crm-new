# 通用导入导出

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/kit/configured-export-runner.test.ts](../../../tests/kit/configured-export-runner.test.ts) | 单元／服务／状态 | 配置导出运行器 |
| [tests/kit/export-config.test.ts](../../../tests/kit/export-config.test.ts) | 单元／服务／状态 | 配置导出：命名规则预览 |
| [tests/kit/export-directory.test.ts](../../../tests/kit/export-directory.test.ts) | 单元／服务／状态 | 导出目录适配器 |
| [tests/kit/export-created-file-retry.test.ts](../../../tests/kit/export-created-file-retry.test.ts) | 合成内存目录 | 创建、写入或关闭失败后提示可能残留的候选文件；保留原错误及既有文件，验证重试后缀与流终止失败 |
| [tests/kit/export.test.ts](../../../tests/kit/export.test.ts) | 单元／服务／状态 | 导出路径分流：chooseExportPath |
| [tests/kit/import-entities.test.ts](../../../tests/kit/import-entities.test.ts) | 单元／服务／状态 | 导入实体注册表 |
| [tests/kit/import-mapping-tab.test.ts](../../../tests/kit/import-mapping-tab.test.ts) | 单元／服务／状态 | 导入登记按需加载、调用时目标冻结；页签上限、未知实体及导航失败回滚 |
| [tests/kit/import-mapping.test.ts](../../../tests/kit/import-mapping.test.ts) | 单元／服务／状态 | 导入映射：精确与建议争用同列时的预匹配，以及人工重复映射的行投影 |
| [tests/kit/import-runner.test.ts](../../../tests/kit/import-runner.test.ts) | 单元／服务／状态 | 导入执行器 |
| [tests/kit/import-source.test.ts](../../../tests/kit/import-source.test.ts) | 单元／服务／状态 | 导入源解析：原始表头 + 行 |
| [tests/stores/export-workflows.test.ts](../../../tests/stores/export-workflows.test.ts) | 单元／服务／状态 | 配置导出工作流上下文 |

## 浏览器组件

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/browser/ConfiguredExportDirectoryIdentity.test.ts](../../../tests/browser/ConfiguredExportDirectoryIdentity.test.ts) | Vitest Browser／Chromium | 配置导出界面写入中断后选择同名不同目录，内存目录句柄核对身份并重写全部文件 |
| [tests/browser/ConfiguredExportCreatedFile.test.ts](../../../tests/browser/ConfiguredExportCreatedFile.test.ts) | Vitest Browser／Chromium，合成目录 | 配置页提示候选文件、键盘重试及成功反馈；空文件和既有文件保留，不访问真实磁盘目录 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/kit-ui-export.spec.ts](../../../e2e/kit-ui-export.spec.ts) | Playwright E2E | 配置导出：实时预览、二级写盘、逐步完成并自动关闭页签；KitUI 单文件导出：选择目录、写入文件且只显示一次成功反馈 |
| [e2e/kit-ui-import-mapping.spec.ts](../../../e2e/kit-ui-import-mapping.spec.ts) | Playwright E2E | 导入映射：坏文件报错、预匹配三色态、必填门控、删行并成功导入后自动关闭 |
