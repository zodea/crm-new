# 财务收付与审批

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/db/f3-finance-migrations.test.ts](../../../tests/db/f3-finance-migrations.test.ts) | 单元／服务／状态 | v22 F3 资金表单与票款分摊迁移 |
| [tests/db/finance-seed.test.ts](../../../tests/db/finance-seed.test.ts) | 单元／服务／状态 | 资金演示 seed |
| [tests/db/payment-approval-migration.test.ts](../../../tests/db/payment-approval-migration.test.ts) | 单元／服务／状态 | 付款批复金额来源迁移 |
| [tests/finance/forms.test.ts](../../../tests/finance/forms.test.ts) | 单元／服务／状态 | f3 六条资金表单领域 action |
| [tests/finance/payment-approval-source.test.ts](../../../tests/finance/payment-approval-source.test.ts) | 单元／服务／状态 | 付款源单迁移批复来源 |
| [tests/finance/payment-approval.test.ts](../../../tests/finance/payment-approval.test.ts) | 单元／服务／状态 | 付款批复输入意图 |
| [tests/finance/payment-boundary.test.ts](../../../tests/finance/payment-boundary.test.ts) | 单元／服务／状态 | 付款申请付款对象边界 |
| [tests/finance/payment-detail.test.ts](../../../tests/finance/payment-detail.test.ts) | 单元／服务／状态 | 付款申请智能业务洞察 |
| [tests/finance/status.test.ts](../../../tests/finance/status.test.ts) | 单元／服务／状态 | 财务状态展示 |
| [tests/receipt/command-session.test.ts](../../../tests/receipt/command-session.test.ts) | 单元／服务／状态 | 收款表单命令会话 |
| [tests/receipt/commands.test.ts](../../../tests/receipt/commands.test.ts) | 单元／服务／状态 | 普通收款中央命令与公开读回 |
| [tests/receipt/file-content.test.ts](../../../tests/receipt/file-content.test.ts) | 单元／服务／状态 | 收款附件公开正文边界 |
| [tests/receipt/migration.test.ts](../../../tests/receipt/migration.test.ts) | 单元／服务／状态 | 普通收款完整受控迁移 |
| [tests/receipt/navigation.test.ts](../../../tests/receipt/navigation.test.ts) | 单元／服务／状态 | 普通收款稳定身份与来源往返 |
| [tests/receipt/read.test.ts](../../../tests/receipt/read.test.ts) | 单元／服务／状态 | 普通收款中央读模型与 Repository |
| [tests/receipt/relations.test.ts](../../../tests/receipt/relations.test.ts) | 单元／服务／状态 | 普通收款的独立中央关联事实 |
| [tests/receipt/request.test.ts](../../../tests/receipt/request.test.ts) | 单元／服务／状态 | 收款 HTTP 写入边界 |
| [tests/stores/finance-read.test.ts](../../../tests/stores/finance-read.test.ts) | 单元／服务／状态 | finance read store |
| [tests/stores/payment-management.test.ts](../../../tests/stores/payment-management.test.ts) | 单元／服务／状态 | payment management store |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/FinanceFormFields.test.ts](../../../tests/components/FinanceFormFields.test.ts) | 组件（jsdom） | financeFormFields real-ID and detail-grid flow |
| [tests/components/FinanceIncomingFormFields.test.ts](../../../tests/components/FinanceIncomingFormFields.test.ts) | 组件（jsdom） | financeIncomingFormFields 收款登记 |
| [tests/components/FinanceListScreen.test.ts](../../../tests/components/FinanceListScreen.test.ts) | 组件（jsdom） | 收款列表来源边界 |
| [tests/components/PaymentApplicationInsightPanel.test.ts](../../../tests/components/PaymentApplicationInsightPanel.test.ts) | 组件（jsdom） | 付款申请洞察说明 |
| [tests/components/PaymentApprovalReturn.test.ts](../../../tests/components/PaymentApprovalReturn.test.ts) | 组件（jsdom） | 编辑保存后返回同 ID 缓存详情，批复和余额读取最新值 |
| [tests/components/PaymentManagementRefresh.test.ts](../../../tests/components/PaymentManagementRefresh.test.ts) | 组件（jsdom） | 付款管理快照刷新 |
| [tests/components/PaymentManagementToolbar.test.ts](../../../tests/components/PaymentManagementToolbar.test.ts) | 组件（jsdom） | payment management toolbar |
| [tests/components/ReceiptDetailScreen.test.ts](../../../tests/components/ReceiptDetailScreen.test.ts) | 组件（jsdom） | 收款只读详情的当前来源 |
| [tests/components/ReceiptFiles.test.ts](../../../tests/components/ReceiptFiles.test.ts) | 组件（jsdom） | 收款附件预览与下载生命周期 |
| [tests/components/ReceiptFormFields.test.ts](../../../tests/components/ReceiptFormFields.test.ts) | 组件（jsdom） | 收款独立表单字段 |
| [tests/components/ReceiptFormScreen.test.ts](../../../tests/components/ReceiptFormScreen.test.ts) | 组件（jsdom） | 收款整页表单读写边界 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/finance-forms.spec.ts](../../../e2e/finance-forms.spec.ts) | Playwright E2E | F3 资金表单、真实分摊与人工支付确认 |
| [e2e/issue-176-expenditure-relations.spec.ts](../../../e2e/issue-176-expenditure-relations.spec.ts) | Playwright E2E | 支出合同页签按真实合同外键展示四组关系和来源入口 |
| [e2e/payment-approval.spec.ts](../../../e2e/payment-approval.spec.ts) | Playwright E2E | Issue #439 批复空值与明确零 |
| [e2e/payment-management.spec.ts](../../../e2e/payment-management.spec.ts) | Playwright E2E | Issue #203：付款管理 |
| [e2e/receipt-migration.spec.ts](../../../e2e/receipt-migration.spec.ts) | Playwright E2E | Issue #436 真实 SQLite 全字段及正文经 HTTP 迁移、中央更正与批次回滚 |
| [e2e/receipt-registration.spec.ts](../../../e2e/receipt-registration.spec.ts) | Playwright E2E | Issue #436 普通收款中央全链 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/receipt-migration-source.ts](../../../e2e/helpers/receipt-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/receipt/fixtures.ts](../../../tests/receipt/fixtures.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
