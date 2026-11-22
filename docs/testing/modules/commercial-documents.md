# 业主／分包商务单据

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/db/doc02-acceptance-warranty-migration.test.ts](../../../tests/db/doc02-acceptance-warranty-migration.test.ts) | 单元／服务／状态 | v44 验收—保修 canonical 生命周期迁移 |
| [tests/db/doc03-final-settlement-migration.test.ts](../../../tests/db/doc03-final-settlement-migration.test.ts) | 单元／服务／状态 | v45 甲方最终结算审定事实迁移 |
| [tests/db/f5-owner-subcontract-migrations.test.ts](../../../tests/db/f5-owner-subcontract-migrations.test.ts) | 单元／服务／状态 | v24 F5 甲方/分包单据迁移 |
| [tests/owner-document/central-command-contract.test.ts](../../../tests/owner-document/central-command-contract.test.ts) | 单元／服务／状态 | 甲方商务单据中央命令契约 |
| [tests/owner-document/central-command-request.test.ts](../../../tests/owner-document/central-command-request.test.ts) | 单元／服务／状态 | 甲方商务单据 HTTP 命令解析 |
| [tests/owner-document/central-controlled-migration.test.ts](../../../tests/owner-document/central-controlled-migration.test.ts) | 单元／服务／状态 | 甲方商务单据受控中央迁移 |
| [tests/owner-document/central-http-repository.test.ts](../../../tests/owner-document/central-http-repository.test.ts) | 单元／服务／状态 | 甲方商务单据中央 HTTP Repository |
| [tests/owner-document/central-read-instance.test.ts](../../../tests/owner-document/central-read-instance.test.ts) | 单元／服务／状态 | 甲方商务单据中央读取实例 |
| [tests/owner-document/central-repository-contract.test.ts](../../../tests/owner-document/central-repository-contract.test.ts) | 单元／服务／状态 | 甲方商务单据中央读取契约 |
| [tests/owner-document/central-snapshot.test.ts](../../../tests/owner-document/central-snapshot.test.ts) | 单元／服务／状态 | 商务完整状态图、原命令/封存、独立整改抵扣、真实零与未知、冻结生命周期及损坏整图拒绝 |
| [tests/owner-document/command-intent.test.ts](../../../tests/owner-document/command-intent.test.ts) | 单元／服务／状态 | 甲方商务单据命令意图 |
| [tests/owner-document/form-version.test.ts](../../../tests/owner-document/form-version.test.ts) | 单元／服务／状态 | 甲方商务单据表单实例版本 |
| [tests/owner-document/forms.test.ts](../../../tests/owner-document/forms.test.ts) | 单元／服务／状态 | f5 甲方/分包单据领域事务 |
| [tests/owner-document/lifecycle.test.ts](../../../tests/owner-document/lifecycle.test.ts) | 单元／服务／状态 | 甲方月度报量审定生命周期 |
| [tests/owner-document/list.test.ts](../../../tests/owner-document/list.test.ts) | 单元／服务／状态 | owner document list configuration |
| [tests/owner-document/local-date.test.ts](../../../tests/owner-document/local-date.test.ts) | 单元／服务／状态 | 甲方商务单据本地业务日期 |
| [tests/owner-document/page.test.ts](../../../tests/owner-document/page.test.ts) | 单元／服务／状态 | f5 单据页面模型 |
| [tests/owner-document/project-penalty-central.test.ts](../../../tests/owner-document/project-penalty-central.test.ts) | 单元／服务／状态 | aX03 项目罚扣中央链 |
| [tests/owner-document/return-context.test.ts](../../../tests/owner-document/return-context.test.ts) | 单元／服务／状态 | 甲方商务单据返回上下文 |
| [tests/owner-document/subcontract-settlement-central.test.ts](../../../tests/owner-document/subcontract-settlement-central.test.ts) | 单元／服务／状态 | aX02 分包结算中央事实 |
| [tests/stores/owner-document.test.ts](../../../tests/stores/owner-document.test.ts) | 单元／服务／状态 | owner document store list state |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/OwnerAcceptanceDetailScreen.test.ts](../../../tests/components/OwnerAcceptanceDetailScreen.test.ts) | 组件（jsdom） | 验收—保修 canonical 双视图详情 |
| [tests/components/OwnerCommercialDocumentDetailScreen.test.ts](../../../tests/components/OwnerCommercialDocumentDetailScreen.test.ts) | 组件（jsdom） | 甲方商务单据中央只读详情 |
| [tests/components/OwnerDocumentFormFields.test.ts](../../../tests/components/OwnerDocumentFormFields.test.ts) | 组件（jsdom） | ownerDocumentFormFields data flow |
| [tests/components/OwnerDocumentFormPage.test.ts](../../../tests/components/OwnerDocumentFormPage.test.ts) | 组件（jsdom） | 甲方与分包单据整页表单状态 |
| [tests/components/OwnerDocumentLineGrid.test.ts](../../../tests/components/OwnerDocumentLineGrid.test.ts) | 组件（jsdom） | ownerDocumentLineGrid behavior |
| [tests/components/OwnerDocumentListScreen.test.ts](../../../tests/components/OwnerDocumentListScreen.test.ts) | 组件（jsdom） | owner document list screen |
| [tests/components/OwnerDocumentListToolbar.test.ts](../../../tests/components/OwnerDocumentListToolbar.test.ts) | 组件（jsdom） | 甲方商务单据列表工具栏权限 |
| [tests/components/OwnerDocumentMigrationPanel.test.ts](../../../tests/components/OwnerDocumentMigrationPanel.test.ts) | 组件（jsdom） | 商务完整来源采用、最小原键及可靠后读、身份/来源切换隔离 |
| [tests/components/OwnerFinalSettlementDetailScreen.test.ts](../../../tests/components/OwnerFinalSettlementDetailScreen.test.ts) | 组件（jsdom） | 甲方最终结算专属只读详情 |
| [tests/components/OwnerPenaltyDetailScreen.test.ts](../../../tests/components/OwnerPenaltyDetailScreen.test.ts) | 组件（jsdom） | 甲方罚扣专属只读详情 |
| [tests/components/SubcontractChangeDetailScreen.test.ts](../../../tests/components/SubcontractChangeDetailScreen.test.ts) | 组件（jsdom） | 分包变洽签专属只读详情 |
| [tests/components/SubcontractSettlementDetailScreen.test.ts](../../../tests/components/SubcontractSettlementDetailScreen.test.ts) | 组件（jsdom） | 分包结算专属只读详情 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-179-acceptance-lifecycle.spec.ts](../../../e2e/issue-179-acceptance-lifecycle.spec.ts) | Playwright E2E | 验收保修页签接入真实生命周期并移除占位卡 |
| [e2e/issue-283-owner-document-readonly-details.spec.ts](../../../e2e/issue-283-owner-document-readonly-details.spec.ts) | Playwright E2E | Issue #283：甲方六类单据专属只读详情与双视图 |
| [e2e/issue-323-owner-commercial-document-detail.spec.ts](../../../e2e/issue-323-owner-commercial-document-detail.spec.ts) | Playwright E2E | Issue #323：甲方变洽签与月度报量专属中央详情 |
| [e2e/issue-324-acceptance-warranty-canonical.spec.ts](../../../e2e/issue-324-acceptance-warranty-canonical.spec.ts) | Playwright E2E | Issue #324：验收—保修 canonical 双视图 |
| [e2e/issue-325-owner-final-settlement-canonical.spec.ts](../../../e2e/issue-325-owner-final-settlement-canonical.spec.ts) | Playwright E2E | Issue #325：甲方最终结算专属只读链 |
| [e2e/issue-326-owner-penalty-readonly.spec.ts](../../../e2e/issue-326-owner-penalty-readonly.spec.ts) | Playwright E2E | Issue #326：甲方罚扣专属只读链 |
| [e2e/issue-327-subcontract-change-readonly.spec.ts](../../../e2e/issue-327-subcontract-change-readonly.spec.ts) | Playwright E2E | Issue #327：分包变洽签专属只读链 |
| [e2e/issue-328-subcontract-settlement-readonly.spec.ts](../../../e2e/issue-328-subcontract-settlement-readonly.spec.ts) | Playwright E2E | AX02 分包结算中央只读链 |
| [e2e/issue-329-project-penalty.spec.ts](../../../e2e/issue-329-project-penalty.spec.ts) | Playwright E2E | AX03 项目罚扣真实结算抵扣 |
| [e2e/owner-document-forms.spec.ts](../../../e2e/owner-document-forms.spec.ts) | Playwright E2E | Issue #197：甲方、分包单据与项目罚扣 |
| [e2e/owner-document-lists.spec.ts](../../../e2e/owner-document-lists.spec.ts) | Playwright E2E | ${width}px 单据列表 |
| [e2e/owner-document-snapshot.spec.ts](../../../e2e/owner-document-snapshot.spec.ts) | Playwright E2E | 普通错误保留旧表，受限错误清空权限与记录，重试及成功空快照边界正确 |
