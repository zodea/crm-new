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
| [tests/helpers/material-read-meta.ts](../../../tests/helpers/material-read-meta.ts) | 辅助／夹具（非独立测试） | 材采来源与真实元数据夹具 |
| [tests/helpers/notification-read-meta.ts](../../../tests/helpers/notification-read-meta.ts) | 辅助／夹具（非独立测试） | 通知来源元数据夹具 |
| [tests/helpers/supplier-read-meta.ts](../../../tests/helpers/supplier-read-meta.ts) | 辅助／夹具（非独立测试） | 分供方来源与权限夹具 |
| [tests/helpers/public-read-meta.ts](../../../tests/helpers/public-read-meta.ts) | 辅助／夹具（非独立测试） | 跨领域公共读取协议夹具 |
| [tests/helpers/project-read-meta.ts](../../../tests/helpers/project-read-meta.ts) | 辅助／夹具（非独立测试） | 项目及真实客户参考来源夹具 |
| [tests/helpers/verified-signatory.ts](../../../tests/helpers/verified-signatory.ts) | 辅助／夹具（非独立测试） | 在同一隔离SQL目录明确创建并读取主体采用事实 |
| [e2e/helpers/contract-signatory.ts](../../../e2e/helpers/contract-signatory.ts) | 辅助／夹具（非独立测试） | 端到端实际主体创建、选择与冻结采用准备 |
