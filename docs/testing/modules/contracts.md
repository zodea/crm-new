# 合同与其他结算

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 材料合同

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-277-material-contract-supplier-zero-chain.spec.ts](../../../e2e/issue-277-material-contract-supplier-zero-chain.spec.ts) | Playwright E2E | Issue #277：项目—材采合同—分供方零值只读样板链 |
| [e2e/issue-318-material-contract-detail.spec.ts](../../../e2e/issue-318-material-contract-detail.spec.ts) | Playwright E2E | Issue #318：材料采购合同中央只读详情 |
| [e2e/issue-422-material-contract-list.spec.ts](../../../e2e/issue-422-material-contract-list.spec.ts) | Playwright E2E | Issue #422 材料采购合同列表 |
| [tests/components/MaterialContractDetailScreen.test.ts](../../../tests/components/MaterialContractDetailScreen.test.ts) | 组件（jsdom） | 材料采购合同中央详情 |
| [tests/components/MaterialContractFactTable.test.ts](../../../tests/components/MaterialContractFactTable.test.ts) | 组件（jsdom） | 材料采购合同来源事实表 |
| [tests/components/MaterialContractListAmounts.test.ts](../../../tests/components/MaterialContractListAmounts.test.ts) | 组件（jsdom） | 材料合同列表真实金额与关系 |
| [tests/components/MaterialContractListScreen.test.ts](../../../tests/components/MaterialContractListScreen.test.ts) | 组件（jsdom） | 材料采购合同列表返回上下文 |
| [tests/material-contract/command-contract.test.ts](../../../tests/material-contract/command-contract.test.ts) | 单元／服务／状态 | 材料采购合同中央 command contract |
| [tests/material-contract/command-store.test.ts](../../../tests/material-contract/command-store.test.ts) | 单元／服务／状态 | 材料采购合同冲突恢复 |
| [tests/material-contract/http-repository.test.ts](../../../tests/material-contract/http-repository.test.ts) | 单元／服务／状态 | 材料采购合同中央 HTTP Repository |
| [tests/material-contract/repository-contract.test.ts](../../../tests/material-contract/repository-contract.test.ts) | 单元／服务／状态 | 材料采购合同中央 Repository contract |
| [tests/material-contract/return-context.test.ts](../../../tests/material-contract/return-context.test.ts) | 单元／服务／状态 | 材料采购合同列表返回上下文 |
| [tests/server/material-contract-central-test-instance.test.ts](../../../tests/server/material-contract-central-test-instance.test.ts) | 单元／服务／状态 | 材料采购合同中央测试实例 |

## 分包合同

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-321-subcontract-contract-detail.spec.ts](../../../e2e/issue-321-subcontract-contract-detail.spec.ts) | Playwright E2E | Issue #321：分包合同专属中央详情 |
| [tests/components/SubcontractContractDetailScreen.test.ts](../../../tests/components/SubcontractContractDetailScreen.test.ts) | 组件（jsdom） | 分包合同详情来源返回边界 |
| [tests/components/SubcontractContractFactTable.test.ts](../../../tests/components/SubcontractContractFactTable.test.ts) | 组件（jsdom） | subcontractContractFactTable |
| [tests/db/ct04-subcontract-contract-migration.test.ts](../../../tests/db/ct04-subcontract-contract-migration.test.ts) | 单元／服务／状态 | ct04 subcontract contract migration |
| [tests/subcontract-contract/command-contract.test.ts](../../../tests/subcontract-contract/command-contract.test.ts) | 单元／服务／状态 | 分包合同中央 command contract |
| [tests/subcontract-contract/controlled-migration.test.ts](../../../tests/subcontract-contract/controlled-migration.test.ts) | 单元／服务／状态 | 分包合同受控中央迁移 |
| [tests/subcontract-contract/http-repository.test.ts](../../../tests/subcontract-contract/http-repository.test.ts) | 单元／服务／状态 | 分包合同中央 HTTP Repository |
| [tests/subcontract-contract/repository-contract.test.ts](../../../tests/subcontract-contract/repository-contract.test.ts) | 单元／服务／状态 | 分包合同中央 Repository 契约 |
| [tests/subcontract-contract/return-context.test.ts](../../../tests/subcontract-contract/return-context.test.ts) | 单元／服务／状态 | subcontract contract return context |

## 合同通用行为

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/contract-detail.spec.ts](../../../e2e/contract-detail.spec.ts) | Playwright E2E | Issue #195：通用合同详情 |
| [e2e/contract-forms.spec.ts](../../../e2e/contract-forms.spec.ts) | Playwright E2E | F2 canonical 合同与支出结算整页表单 |
| [e2e/contract-list-toolbar.spec.ts](../../../e2e/contract-list-toolbar.spec.ts) | Playwright E2E | 分包合同工具栏在 ${width}px 保持稳定且仅表格内部横滚 |
| [e2e/contract-multifilter.spec.ts](../../../e2e/contract-multifilter.spec.ts) | Playwright E2E | ${domain} 合同固定多选贯通中央查询，刷新保留表格与四档滚动边界 |
| [e2e/issue-322-contract-supplement-focus.spec.ts](../../../e2e/issue-322-contract-supplement-focus.spec.ts) | Playwright E2E | Issue #322：补充协议稳定聚焦与来源恢复 |
| [tests/components/ContractDetailSections.test.ts](../../../tests/components/ContractDetailSections.test.ts) | 组件（jsdom） | contract detail sections |
| [tests/components/ContractFormFields.test.ts](../../../tests/components/ContractFormFields.test.ts) | 组件（jsdom） | contractFormFields lookup data flow |
| [tests/components/ContractFormPage.test.ts](../../../tests/components/ContractFormPage.test.ts) | 组件（jsdom） | 辅助合同整页表单状态 |
| [tests/components/ContractLineItemsEditor.test.ts](../../../tests/components/ContractLineItemsEditor.test.ts) | 组件（jsdom） | contractLineItemsEditor |
| [tests/components/ContractListToolbar.test.ts](../../../tests/components/ContractListToolbar.test.ts) | 组件（jsdom） | contract list toolbar |
| [tests/contract/central-list-filters.test.ts](../../../tests/contract/central-list-filters.test.ts) | 单元／服务／状态 | 合同中央列表固定条件多选 |
| [tests/contract/command-sessions.test.ts](../../../tests/contract/command-sessions.test.ts) | 单元／服务／状态 | 失败重试复用命令身份，保存并新建后不会沿用刚保存的记录 |
| [tests/contract/detail.test.ts](../../../tests/contract/detail.test.ts) | 单元／服务／状态 | contract detail read model |
| [tests/contract/forms.test.ts](../../../tests/contract/forms.test.ts) | 单元／服务／状态 | f2 合同与支出结算领域 action |
| [tests/db/f2-contract-migrations.test.ts](../../../tests/db/f2-contract-migrations.test.ts) | 单元／服务／状态 | v21 F2 canonical 合同与支出结算迁移 |
| [tests/stores/contract-list-refresh.test.ts](../../../tests/stores/contract-list-refresh.test.ts) | 单元／服务／状态 | 合同列表刷新快照边界 |
| [tests/stores/contract.test.ts](../../../tests/stores/contract.test.ts) | 单元／服务／状态 | contract store:唯一写路径 action 闭环 |

## 其他结算

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-331-other-settlement.spec.ts](../../../e2e/issue-331-other-settlement.spec.ts) | Playwright E2E | AX05 其他支出结算中央往返 |
| [tests/other-settlement/central.test.ts](../../../tests/other-settlement/central.test.ts) | 单元／服务／状态 | aX05 其他支出结算中央命令 |
| [tests/other-settlement/http.test.ts](../../../tests/other-settlement/http.test.ts) | 单元／服务／状态 | aX05 HTTP Repository 边界 |
| [tests/other-settlement/migration.test.ts](../../../tests/other-settlement/migration.test.ts) | 单元／服务／状态 | aX05 结算迁移来源 |

## 施工合同

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-282-construction-subcontract-readonly-details.spec.ts](../../../e2e/issue-282-construction-subcontract-readonly-details.spec.ts) | Playwright E2E | Issue #282：施工与分包合同专属只读详情 |
| [e2e/issue-320-construction-contract-detail.spec.ts](../../../e2e/issue-320-construction-contract-detail.spec.ts) | Playwright E2E | Issue #320：施工合同专属中央详情 |
| [tests/components/ConstructionContractFactTable.test.ts](../../../tests/components/ConstructionContractFactTable.test.ts) | 组件（jsdom） | constructionContractFactTable |
| [tests/components/ConstructionContractListScreen.test.ts](../../../tests/components/ConstructionContractListScreen.test.ts) | 组件（jsdom） | 施工合同列表连续工作面 |
| [tests/construction-contract/combined-source-version.test.ts](../../../tests/construction-contract/combined-source-version.test.ts) | 单元／服务／状态 | 施工合同聚合读取版本 |
| [tests/construction-contract/command-contract.test.ts](../../../tests/construction-contract/command-contract.test.ts) | 单元／服务／状态 | 施工合同中央 command contract |
| [tests/construction-contract/controlled-migration.test.ts](../../../tests/construction-contract/controlled-migration.test.ts) | 单元／服务／状态 | 施工合同受控中央迁移 |
| [tests/construction-contract/http-repository.test.ts](../../../tests/construction-contract/http-repository.test.ts) | 单元／服务／状态 | 施工合同中央 HTTP Repository |
| [tests/construction-contract/repository-contract.test.ts](../../../tests/construction-contract/repository-contract.test.ts) | 单元／服务／状态 | 施工合同中央 Repository contract |
| [tests/construction-contract/return-context.test.ts](../../../tests/construction-contract/return-context.test.ts) | 单元／服务／状态 | 施工合同详情返回上下文 |
| [tests/db/ct03-construction-contract-migration.test.ts](../../../tests/db/ct03-construction-contract-migration.test.ts) | 单元／服务／状态 | cT03 施工合同实际竣工事实迁移 |

## 辅助合同

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/auxiliary-list-refresh.spec.ts](../../../e2e/auxiliary-list-refresh.spec.ts) | Playwright E2E | ${path} 同来源筛选和刷新保留表格，失败可重试，拒绝权限时清空 |
| [e2e/contract-aux-list.spec.ts](../../../e2e/contract-aux-list.spec.ts) | Playwright E2E | Issue #196：辅助合同与结算列表 |
| [e2e/issue-330-auxiliary-contracts.spec.ts](../../../e2e/issue-330-auxiliary-contracts.spec.ts) | Playwright E2E | AX04 辅助合同只读与编辑 |
| [tests/auxiliary-contract/central.test.ts](../../../tests/auxiliary-contract/central.test.ts) | 单元／服务／状态 | 辅助合同中央事实 |
| [tests/auxiliary-contract/http.test.ts](../../../tests/auxiliary-contract/http.test.ts) | 单元／服务／状态 | 辅助合同 HTTP Repository |
| [tests/auxiliary-contract/migration.test.ts](../../../tests/auxiliary-contract/migration.test.ts) | 单元／服务／状态 | aX04 受控迁移 |
| [tests/auxiliary-contract/navigation.test.ts](../../../tests/auxiliary-contract/navigation.test.ts) | 单元／服务／状态 | 辅助合同只读导航 |
| [tests/components/AuxiliaryContractRead.test.ts](../../../tests/components/AuxiliaryContractRead.test.ts) | 组件（jsdom） | 辅助合同列表快照 |
| [tests/components/ContractAuxListToolbar.test.ts](../../../tests/components/ContractAuxListToolbar.test.ts) | 组件（jsdom） | 辅助合同工具栏说明 |
| [tests/contract/aux-list.test.ts](../../../tests/contract/aux-list.test.ts) | 单元／服务／状态 | contract aux list configuration |
