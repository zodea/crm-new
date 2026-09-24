# 测试基础设施

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/responsive.ts](../../../e2e/helpers/responsive.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/visual-environment.ts](../../../e2e/helpers/visual-environment.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/browser/setup.ts](../../../tests/browser/setup.ts) | 测试环境初始化 | 真实浏览器组件测试初始化 |
| [tests/components/setup.ts](../../../tests/components/setup.ts) | 测试环境初始化 | jsdom 测试清理与浏览器 API 替身 |
| [tests/helpers/memory-db.ts](../../../tests/helpers/memory-db.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
