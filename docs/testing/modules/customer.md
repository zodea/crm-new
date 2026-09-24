# 客户

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/customer/detail.test.ts](../../../tests/customer/detail.test.ts) | 单元／服务／状态 | 客户详情只读模型 |
| [tests/customer/http-repository.test.ts](../../../tests/customer/http-repository.test.ts) | 单元／服务／状态 | 客户中央 HTTP Repository |
| [tests/customer/repository-contract.test.ts](../../../tests/customer/repository-contract.test.ts) | 单元／服务／状态 | 客户中央 Repository contract |
| [tests/customer/return-context.test.ts](../../../tests/customer/return-context.test.ts) | 单元／服务／状态 | 客户列表返回上下文 |
| [tests/production/customer-failure.test.ts](../../../tests/production/customer-failure.test.ts) | 单元／服务／状态 | 审计提交中断不暴露客户或原件；同键重试仅保存一次，陈旧更正保持原值 |
| [tests/production/customer-http-boundary.test.ts](../../../tests/production/customer-http-boundary.test.ts) | 单元／服务／状态 | 生产公开命令在解码前拒绝跨来源、伪能力与无法回查的编号 |
| [tests/production/customer-pending.test.ts](../../../tests/production/customer-pending.test.ts) | 单元／服务／状态 | 成功后响应丢失保留原键，未明确采用已保存内容前不重复添加原件 |
| [tests/production/customer-storage.test.ts](../../../tests/production/customer-storage.test.ts) | 单元／服务／状态 | 客户含原件保存后冷打开读回同一身份、审计和回执，同键异文不能新增 |
| [tests/server/customer-central-test-instance.test.ts](../../../tests/server/customer-central-test-instance.test.ts) | 单元／服务／状态 | 客户中央读写测试实例 |
| [tests/server/customer-construction-contract-central.test.ts](../../../tests/server/customer-construction-contract-central.test.ts) | 单元／服务／状态 | 关联施工合同：客户端合同事实 |
| [tests/server/customer-project-central.test.ts](../../../tests/server/customer-project-central.test.ts) | 单元／服务／状态 | 中央项目事实→客户关联回读 |
| [tests/server/customer-receipt-source.test.ts](../../../tests/server/customer-receipt-source.test.ts) | 单元／服务／状态 | 客户收款只读取当前会话的中央事实 |
| [tests/stores/customer-central.test.ts](../../../tests/stores/customer-central.test.ts) | 单元／服务／状态 | 客户中央 stores |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/CustomerDetail.test.ts](../../../tests/components/CustomerDetail.test.ts) | 组件（jsdom） | 客户详情展示 |
| [tests/components/CustomerDetailScreen.test.ts](../../../tests/components/CustomerDetailScreen.test.ts) | 组件（jsdom） | 客户详情业务页签 |
| [tests/components/CustomerProjectReturnContext.test.ts](../../../tests/components/CustomerProjectReturnContext.test.ts) | 组件（jsdom） | 客户项目返回的稳定来源行 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/customer-construction-contract-central.spec.ts](../../../e2e/customer-construction-contract-central.spec.ts) | Playwright E2E | 关联施工合同：客户端合同来源 |
| [e2e/customer-detail.spec.ts](../../../e2e/customer-detail.spec.ts) | Playwright E2E | Issue #194：客户详情 |
| [e2e/customer-project-central.spec.ts](../../../e2e/customer-project-central.spec.ts) | Playwright E2E | 正式项目保存后同一客户详情返回关联身份、数量并往返项目详情 |
| [e2e/customer-receipt-source.spec.ts](../../../e2e/customer-receipt-source.spec.ts) | Playwright E2E | 中央收款按当前会话读取，源撤回后客户与收款详情都不保留固定样例 |
| [e2e/issue-314-customer-central-chain.spec.ts](../../../e2e/issue-314-customer-central-chain.spec.ts) | Playwright E2E | Issue #314：客户中央列表—详情—显式编辑链 |
| [e2e/production-customer-storage.spec.ts](../../../e2e/production-customer-storage.spec.ts) | Playwright E2E | 公开客户保存、丢响应、独立进程重启、原件和删除恢复保持一致 |
