# 文档契约与工程工具

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

这里的文档、源码静态契约与生成物登记检查应按各自目的审查。即使它们通过，也不能作为工资计算、收付、快照冻结或事务正确的证据。界面运行行为测试仍在业务模块和 [通用界面](ui.md) 中。

## 工程工具测试

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/tooling/commitlint.test.ts](../../../tests/tooling/commitlint.test.ts) | 工程工具测试 | commitlint 项目接入 |
| [tests/tooling/git-hooks.test.ts](../../../tests/tooling/git-hooks.test.ts) | 工程工具测试 | 暂存路径保护 |

## 文档／静态契约检查

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/ui/design-token-contract.test.ts](../../../tests/ui/design-token-contract.test.ts) | 文档／静态契约检查 | design token contract |
| [tests/ui/module-review-coverage.test.ts](../../../tests/ui/module-review-coverage.test.ts) | 文档／静态契约检查 | module review coverage |
| [tests/ui/navigation-contract.test.ts](../../../tests/ui/navigation-contract.test.ts) | 文档／静态契约检查 | cross-domain navigation contract |
| [tests/ui/overlay-contract.test.ts](../../../tests/ui/overlay-contract.test.ts) | 文档／静态契约检查 | overlay composition contract |
| [tests/ui/payroll-p5-registration.test.ts](../../../tests/ui/payroll-p5-registration.test.ts) | 文档／静态契约检查 | 工资 P5 文档登记一致性；不证明工资业务正确 |
| [tests/ui/payroll-p6-registration.test.ts](../../../tests/ui/payroll-p6-registration.test.ts) | 文档／静态契约检查 | 工资 P6 文档登记一致性；不证明工资业务正确 |
| [tests/ui/payroll-p7-registration.test.ts](../../../tests/ui/payroll-p7-registration.test.ts) | 文档／静态契约检查 | 工资 P7 文档登记一致性；不证明工资业务正确 |
| [tests/ui/public-surface-contract.test.ts](../../../tests/ui/public-surface-contract.test.ts) | 文档／静态契约检查 | public surface contract |
| [tests/ui/read-model-contract.test.ts](../../../tests/ui/read-model-contract.test.ts) | 文档／静态契约检查 | read model contract coverage |
| [tests/ui/runtime-reference-audit.test.ts](../../../tests/ui/runtime-reference-audit.test.ts) | 文档／静态契约检查 | 运行参考与登记证据一致性；不证明工资业务正确 |
