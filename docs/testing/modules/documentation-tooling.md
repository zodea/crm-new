# 文档契约与工程工具

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

这里的文档、源码静态契约与生成物登记检查应按各自目的审查。即使它们通过，也不能作为工资计算、收付、快照冻结或事务正确的证据。界面运行行为测试仍在业务模块和 [通用界面](ui.md) 中。

## 工程工具测试

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/tooling/commitlint.test.ts](../../../tests/tooling/commitlint.test.ts) | 工程工具测试 | commitlint 项目接入 |
| [tests/tooling/check-md-links.test.ts](../../../tests/tooling/check-md-links.test.ts) | 工程工具测试 | Markdown 相对链接提取与失效判定 |
| [tests/tooling/git-hooks.test.ts](../../../tests/tooling/git-hooks.test.ts) | 工程工具测试 | 暂存路径保护 |

## 文档／静态契约检查

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/ui/design-token-contract.test.ts](../../../tests/ui/design-token-contract.test.ts) | 文档／静态契约检查 | design token contract |
| [tests/ui/navigation-contract.test.ts](../../../tests/ui/navigation-contract.test.ts) | 文档／静态契约检查 | cross-domain navigation contract |
| [tests/ui/overlay-contract.test.ts](../../../tests/ui/overlay-contract.test.ts) | 文档／静态契约检查 | overlay composition contract |
| [tests/ui/read-model-contract.test.ts](../../../tests/ui/read-model-contract.test.ts) | 文档／静态契约检查 | 现行权威文档链接与锚点可解析；生产路由页面域与 READ-MODELS DTO 域一一对应 |
