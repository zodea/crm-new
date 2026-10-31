# 财务收付与审批

五类财务列表的工具、筛选与窄屏焦点使用 [production-finance-storage](../../../e2e/production-finance-storage.spec.ts) 的独立合成生产来源；付款申请五档视口、200% 布局、390px 明细局部横滚，以及可写状态下的键盘和放弃修改路径使用 [production-other-settlements](../../../e2e/production-other-settlements.spec.ts)。开发环境缺正式来源时保持只读。

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/db/f3-finance-migrations.test.ts](../../../tests/db/f3-finance-migrations.test.ts) | 单元／服务／状态 | v22 F3 资金表单与票款分摊迁移 |
| [tests/db/finance-seed.test.ts](../../../tests/db/finance-seed.test.ts) | 单元／服务／状态 | 资金演示 seed |
| [tests/db/payment-approval-migration.test.ts](../../../tests/db/payment-approval-migration.test.ts) | 单元／服务／状态 | 付款批复金额来源迁移 |
| [tests/finance/forms.test.ts](../../../tests/finance/forms.test.ts) | 单元／服务／状态 | f3 六条资金表单领域 action |
| [tests/finance/http-repository.test.ts](../../../tests/finance/http-repository.test.ts) | 单元／服务／状态 | F3 当前读取身份、版本、权限与严格 HTTP DTO；真实查询编码下未选工人和合法空候选保留空值，非法编号、身份冲突及未就绪来源继续拒绝，不把未知值补成零 |
| [tests/server/finance-routing.test.ts](../../../tests/server/finance-routing.test.ts) | 实际 HTTP 路由 | 五类财务 context／list／form 保持同域 JSON 与参数；付款申请详情不遮挡同级读取，也不扩大其他类型权限 |
| [tests/finance/attachments.test.ts](../../../tests/finance/attachments.test.ts) | 单元／服务／状态 | 附件真实字节与 SHA、零字节原件、历史仅元数据与提交后输入保留 |
| [tests/finance/expense-references.test.ts](../../../tests/finance/expense-references.test.ts) | 单元／服务／状态 | 原费用稳定明细引用、身份与金额冻结、清偿不重复进成本 |
| [tests/finance/party-references.test.ts](../../../tests/finance/party-references.test.ts) | 单元／服务／状态 | v56 工人／分供方稳定引用迁移、真实磁盘冷重跑、原文原件和审计保全 |
| [tests/finance/payment-approval-source.test.ts](../../../tests/finance/payment-approval-source.test.ts) | 单元／服务／状态 | 付款源单迁移批复来源 |
| [tests/finance/payment-approval.test.ts](../../../tests/finance/payment-approval.test.ts) | 单元／服务／状态 | 付款批复输入意图 |
| [tests/finance/payment-verification.test.ts](../../../tests/finance/payment-verification.test.ts) | 单元／服务／状态 | 历史核验输入和只读证明的严格解码、真实零与未知、原件身份及客户端资格伪造拒绝 |
| [tests/finance/payment-boundary.test.ts](../../../tests/finance/payment-boundary.test.ts) | 单元／服务／状态 | 付款申请付款对象边界 |
| [tests/finance/payment-detail.test.ts](../../../tests/finance/payment-detail.test.ts) | 单元／服务／状态 | 付款申请真实关联与洞察；三类回票义务、损坏原类型及真实零保留差额与已确认现金 |
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
| [tests/stores/payment-management.test.ts](../../../tests/stores/payment-management.test.ts) | 单元／服务／状态 | 付款工作台真实 Native 损坏金额、可证空集合、精度及失效来源；回票类型与义务同源派生 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/FinanceFormFields.test.ts](../../../tests/components/FinanceFormFields.test.ts) | 组件（jsdom） | financeFormFields real-ID and detail-grid flow |
| [tests/components/FinanceFormRecovery.test.ts](../../../tests/components/FinanceFormRecovery.test.ts) | 组件（jsdom） | 已保存后读回失败、同 ID 只读恢复、晚输入和附件意图保留 |
| [tests/components/FinancePaymentVerification.test.ts](../../../tests/components/FinancePaymentVerification.test.ts) | 组件（jsdom） | 历史核验整页子区的累计金额、已保存原件、禁用动作、未知值及权限控制 |
| [tests/components/FinancePaymentVerificationRecovery.test.ts](../../../tests/components/FinancePaymentVerificationRecovery.test.ts) | 组件（jsdom） | 原申请核验回执与后读失败、原编号恢复、保存期间晚输入保留和只读核验采用 |
| [tests/components/FinanceExpenseClearanceVerification.test.ts](../../../tests/components/FinanceExpenseClearanceVerification.test.ts) | 组件（jsdom） | 原费用旧清偿核定子区：真实原行选择、逐项金额及匹配依据、已保存替代文件、旧义务与新额度分别显示 |
| [tests/components/FinanceMigrationDeclarations.test.ts](../../../tests/components/FinanceMigrationDeclarations.test.ts) | 组件（jsdom；隔离 inspector／HTTP） | 精确旧清偿声明控件、原大小未知、理由必填、最小原键及已知回执后读失败只 GET；不证明真实 Native 图或正式迁入持久化 |
| [tests/components/FinanceIncomingFormFields.test.ts](../../../tests/components/FinanceIncomingFormFields.test.ts) | 组件（jsdom） | financeIncomingFormFields 收款登记 |
| [tests/components/FinanceListScreen.test.ts](../../../tests/components/FinanceListScreen.test.ts) | 组件（jsdom） | 原收款来源、工具栏及分页筛选，未知合计与只读重读 |
| [tests/components/PaymentApplicationInsightPanel.test.ts](../../../tests/components/PaymentApplicationInsightPanel.test.ts) | 组件（jsdom） | 付款申请洞察说明 |
| [tests/components/PaymentApprovalReturn.test.ts](../../../tests/components/PaymentApprovalReturn.test.ts) | 组件（jsdom） | 编辑保存后返回同 ID 缓存详情，批复和余额读取最新值；对应回票指标、真实零及未知显示 |
| [tests/components/PaymentManagementToolbar.test.ts](../../../tests/components/PaymentManagementToolbar.test.ts) | 组件（jsdom） | payment management toolbar |
| [tests/components/ReceiptDetailScreen.test.ts](../../../tests/components/ReceiptDetailScreen.test.ts) | 组件（jsdom） | 收款只读详情的当前来源 |
| [tests/components/ReceiptFiles.test.ts](../../../tests/components/ReceiptFiles.test.ts) | 组件（jsdom） | 收款附件预览与下载生命周期 |
| [tests/components/ReceiptFormFields.test.ts](../../../tests/components/ReceiptFormFields.test.ts) | 组件（jsdom） | 收款独立表单字段 |
| [tests/components/ReceiptFormScreen.test.ts](../../../tests/components/ReceiptFormScreen.test.ts) | 组件（jsdom） | 收款整页表单读写边界 |

## 真实浏览器（Vitest／Chromium）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/browser/FinanceOriginalRecovery.test.ts](../../../tests/browser/FinanceOriginalRecovery.test.ts) | 实际 Vue 页面与浏览器文件操作 | 五档布局、下载原字节、已保存后读回失败不重放与焦点恢复；隔离 Repository 不证明生产接管 |
| [tests/browser/components/FinanceMigration.browser.test.ts](../../../tests/browser/components/FinanceMigration.browser.test.ts) | 实际迁入 Vue 页面与 Chromium | 真实 Native SQLite 文件、显式关系与原件补齐、原编号未知及只读恢复、失权迟到隔离、五档布局与键盘；生产迁入持久化另由实际磁盘测试验证 |
| [tests/browser/FinancePartySelection.test.ts](../../../tests/browser/FinancePartySelection.test.ts) | 实际 Vue 字段、LookupSelect 与 Vxe 表格 | 工人／分供方明示选择、原费用引用、键鼠及清空焦点、依赖禁用和表内横滚；数据库写入另由领域测试验证 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/finance-forms.spec.ts](../../../e2e/finance-forms.spec.ts) | Playwright E2E | 中央收款、中央未配置及演示来源的 F3 输入保留／禁写／零写请求与五档布局；显式合成 Native 旧库的完整字节、12 表、原件和审计对账。Native 保存、真实分摊与人工确认由 FinanceNativeFlows 独立验证 |
| [e2e/production-finance-storage.spec.ts](../../../e2e/production-finance-storage.spec.ts) | 实际正式构建与隔离 SQLite | F3 整页未知提交冷重启后原键恢复，已保存后读失败只重读；实际工作台、列表失败重读、付款申请 context/list/form/detail JSON 与同域范围、详情编辑及正式登记预填、三类回票义务与真实零、五档交互、原件、后来输入与真实零/未填写批复 |
| [e2e/production-payment-approval.spec.ts](../../../e2e/production-payment-approval.spec.ts) | 生产 Playwright E2E | Issue #439 批复空值、明确零和历史核验；使用隔离合成正式来源 |
| [e2e/payment-management.spec.ts](../../../e2e/payment-management.spec.ts) | Playwright E2E · 测试数据只读 | 付款管理四档布局、筛选/键盘、表格局部横滚，以及测试来源禁止正式详情/编辑/登记；原正式导航与金额预填保护由上方真实生产链承接 |
| [e2e/receipt-migration.spec.ts](../../../e2e/receipt-migration.spec.ts) | Playwright E2E | Issue #436 真实 SQLite 迁移、更正后拒绝危险回滚并保全原件 |
| [e2e/receipt-registration.spec.ts](../../../e2e/receipt-registration.spec.ts) | Playwright E2E | Issue #436 普通收款中央全链 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/finance-readonly-source.ts](../../../e2e/helpers/finance-readonly-source.ts) | 辅助／非空只读来源夹具 | 一次真实 Native v55→v60 迁移生成不可变 SQLite 字节，各隔离上下文独立安装副本；旧姓名、真实零、NULL 身份、原件正文与旧审计保全，禁写前后核完整 SHA、结构及 12 表。仅构造来源，不赋予中央身份或写权 |
| [e2e/helpers/receipt-migration-source.ts](../../../e2e/helpers/receipt-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/receipt/fixtures.ts](../../../tests/receipt/fixtures.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
