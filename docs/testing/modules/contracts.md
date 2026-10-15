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
| [tests/material-contract/controlled-migration.test.ts](../../../tests/material-contract/controlled-migration.test.ts) | 单元／服务／状态 | 真实 SQLite v49–54 完整主合同、协议明细、减项及原件图；v53/54 已采用主体冻结版本与同图目录全历史经解码、预检、导入、确认、冷恢复与受控回滚保全 |
| [tests/material-contract/http-repository.test.ts](../../../tests/material-contract/http-repository.test.ts) | 单元／服务／状态 | 材料采购合同中央 HTTP Repository |
| [tests/material-contract/line-import.test.ts](../../../tests/material-contract/line-import.test.ts) | 单元／服务／状态 | 文件映射保源行、材质与未知单位；全部修错并核实量价单位后一次追加当前合同草稿 |
| [tests/material-contract/owned-details.test.ts](../../../tests/material-contract/owned-details.test.ts) | 单元／服务／状态 | 材质、独立减项、自有协议明细、原行冻结与原编号封存；后来输入保留及稳定行身份承接 |
| [tests/material-contract/repository-contract.test.ts](../../../tests/material-contract/repository-contract.test.ts) | 单元／服务／状态 | 材料采购合同中央 Repository contract |
| [tests/material-contract/return-context.test.ts](../../../tests/material-contract/return-context.test.ts) | 单元／服务／状态 | 材料采购合同列表返回上下文 |
| [tests/stores/material-contract-read.test.ts](../../../tests/stores/material-contract-read.test.ts) | 单元／服务／状态 | 同来源暂不可用保快照、401和真实访问切换清事实、跨来源与迟到响应隔离 |
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
| [e2e/production-other-settlements.spec.ts](../../../e2e/production-other-settlements.spec.ts) | 实际正式构建与隔离 SQLite | 无合同原费用、结算、申请及实付全链；普通申请与历史未知批复分别验收；E100／缺原纸清偿30替代核定、新70与旧30明确合并、银行现金只计100；整页真实原件、未知原键、版本冲突、冻结历史、Native 迁入及冷开五档 |
| [e2e/helpers/other-settlement-migration-source.ts](../../../e2e/helpers/other-settlement-migration-source.ts) | 辅助／夹具 | 实际 Native60 原费用及结算图、冻结历史、原回执和原件，逐项显式映射后供正式页面采用 |
| [e2e/helpers/historical-clearance-migration-source.ts](../../../e2e/helpers/historical-clearance-migration-source.ts) | 辅助／夹具 | 实际 Native60 原费用100与纸单清偿30；原纸从未电子化的缺失状态、独立原费用正文及原审计保全，供真实替代核定流程使用 |
| [e2e/contract-forms.spec.ts](../../../e2e/contract-forms.spec.ts) | Playwright E2E | F2 canonical 合同与支出结算整页表单 |
| [e2e/contract-list-toolbar.spec.ts](../../../e2e/contract-list-toolbar.spec.ts) | Playwright E2E | 分包合同工具栏在 ${width}px 保持稳定且仅表格内部横滚 |
| [e2e/contract-multifilter.spec.ts](../../../e2e/contract-multifilter.spec.ts) | Playwright E2E | ${domain} 合同固定多选贯通中央查询，刷新保留表格与四档滚动边界 |
| [e2e/issue-322-contract-supplement-focus.spec.ts](../../../e2e/issue-322-contract-supplement-focus.spec.ts) | Playwright E2E | Issue #322：补充协议稳定聚焦与来源恢复 |
| [tests/components/ContractDetailSections.test.ts](../../../tests/components/ContractDetailSections.test.ts) | 组件（jsdom） | contract detail sections |
| [tests/components/ContractFormFields.test.ts](../../../tests/components/ContractFormFields.test.ts) | 组件（jsdom） | contractFormFields lookup data flow |
| [tests/components/ContractFormPage.test.ts](../../../tests/components/ContractFormPage.test.ts) | 组件（jsdom） | 辅助合同整页表单状态 |
| [tests/components/ContractLineItemsEditor.test.ts](../../../tests/components/ContractLineItemsEditor.test.ts) | 组件（jsdom） | contractLineItemsEditor |
| [tests/contract/central-list-filters.test.ts](../../../tests/contract/central-list-filters.test.ts) | 单元／服务／状态 | 合同中央列表固定条件多选 |
| [tests/contract/command-sessions.test.ts](../../../tests/contract/command-sessions.test.ts) | 单元／服务／状态 | 未知结果沿原键核对、未应用受控封存；回执及合法后读共同清理，输入和原保存基准保留，跨目标迟到结果隔离 |
| [tests/contract/original-content.test.ts](../../../tests/contract/original-content.test.ts) | 单元／服务／状态 | 原件公开DTO核所有者、来源、规范Base64、长度与SHA256；真实零字节保留 |
| [tests/contract/original-owners.test.ts](../../../tests/contract/original-owners.test.ts) | 单元／服务／状态 | 施工与分包原件归属、字节、软删恢复、原命令回执及受控迁移保全 |
| [tests/contract/detail.test.ts](../../../tests/contract/detail.test.ts) | 单元／服务／状态 | contract detail read model |
| [tests/contract/forms.test.ts](../../../tests/contract/forms.test.ts) | 单元／服务／状态 | f2 合同与支出结算领域 action |
| [tests/contract/native-contract-identities.test.ts](../../../tests/contract/native-contract-identities.test.ts) | 单元／服务／状态 | Native v52→53 真实磁盘重建保全部列/外键/索引/触发器与旧原件、冻结/审计；版本记账前中断冷开重试保零/未知及历史重复占号 |
| [tests/contract/our-signatory-repository.test.ts](../../../tests/contract/our-signatory-repository.test.ts) | 单元／服务／状态 | 独立主体目录真实 owner/HTTP严格解码、完整核实历史、401/403与原命令回执/墓碑；精确编辑恢复定位不开放写页签正文 |
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
| [tests/other-settlement/native-owner-upgrade.test.ts](../../../tests/other-settlement/native-owner-upgrade.test.ts) | 单元／服务／状态 | Native v60 同表真实迁移保旧零、未知、额外字段、原 actor/index/trigger/FK；记账中断冷幂等及损坏拒绝 |
| [tests/other-settlement/native-original-size.test.ts](../../../tests/other-settlement/native-original-size.test.ts) | 实际 SQLite 原件读取 | 旧原件大小 NULL 拒绝冒充零，真实零字节保持可读；读取不改变来源文件与原始元数据 |
| [tests/other-settlement/production-storage.test.ts](../../../tests/other-settlement/production-storage.test.ts) | 单元／服务／状态 | 同盘原费用采用、结算净额、稳定付款对象、版本及原件历史；冷原键与重复采用拒绝 |
| [tests/other-settlement/production-migration.test.ts](../../../tests/other-settlement/production-migration.test.ts) | 实际 SQLite 及正式参与者 | Native 完整原图、历史回执、原件及逐条版本映射；旧来源命令与当前授权隔离、未知结果恢复、冷读取与备份核验 |
| [tests/other-settlement/production-pay08.test.ts](../../../tests/other-settlement/production-pay08.test.ts) | 实际 SQLite 及正式参与者 | 历史未知批复沿真实原费用和结算核验，新支付门槛、累计现金、原件、权限及源版本变化与冷原键 |
| [tests/other-settlement/clearance-verification.test.ts](../../../tests/other-settlement/clearance-verification.test.ts) | 实际 SQLite 及正式参与者 | E100／C30 核定与明确采用去重、同次新旧份额合并、真实现金及旧义务分别读取、版本权限、冷恢复与备份冻结保护 |
| [tests/other-settlement/clearance-native-missing-original.test.ts](../../../tests/other-settlement/clearance-native-missing-original.test.ts) | 真实 Native SQLite 与正式迁入 | 精确旧清偿外部原单缺失声明、未知原大小及原元数据保全、原字节与银行／其他 owner 损坏拒绝；声明不冒充找回原件 |
| [tests/other-settlement/stable-payee-snapshots.test.ts](../../../tests/other-settlement/stable-payee-snapshots.test.ts) | 实际 SQLite 及正式参与者 | 同一稳定收款 ID 更名保各单历史姓名、冷读取和旧删除图实付；不同 ID 同名拒绝采用，同 ID 原费与清偿历史姓名不同仍可明确核定 |
| [tests/components/OtherSettlementClearanceBinding.test.ts](../../../tests/components/OtherSettlementClearanceBinding.test.ts) | 组件（jsdom） | 新采用与已核旧份额明确合并、真实采用行追加关联、旧待实付与未知显示；只验证字段交互，不代替事务和银行事实 |
| [tests/helpers/other-settlement-pay08-source.ts](../../../tests/helpers/other-settlement-pay08-source.ts) | 辅助／夹具 | 完整 Native60 原费、结算、历史未知批复、已确认银行分摊和真实核验原件 |

## 施工合同

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/construction-contract/management-fee.test.ts](../../../tests/construction-contract/management-fee.test.ts) | 单元／服务／状态 | 总合同配置位置、未知与零、冻结采用版本及 Native 冷恢复 |
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
| [tests/browser/NativeContractAuxUnknown.test.ts](../../../tests/browser/NativeContractAuxUnknown.test.ts) | 浏览器组件 | Native 公司合同实际 Vxe 表格与筛选合计保持未知/真实零；五档视口、局部横滚及键盘焦点 |
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

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/server/contract-read-meta.test.ts](../../../tests/server/contract-read-meta.test.ts) | 单元／服务／状态 | 核心合同与商务来源的读取时点、版本及相关源完整性 |
| [tests/contract/construction-subcontract-signatory.test.ts](../../../tests/contract/construction-subcontract-signatory.test.ts) | 单元／服务／状态 | 施工与分包实际主体采用、历史快照及原键 |
| [tests/boq/production-recovery.test.ts](../../../tests/boq/production-recovery.test.ts) | 单元／服务／状态 | BOQ 普通命令与整源迁入各自的最小原编号恢复 |
| [tests/stores/boq-production-pending.test.ts](../../../tests/stores/boq-production-pending.test.ts) | 单元／服务／状态 | 清单失响应、原键核对及后读失败保全 |
| [tests/tabs/construction-scope-startup.test.ts](../../../tests/tabs/construction-scope-startup.test.ts) | 单元／服务／状态 | 工程关联启动只恢复同身份原目标和动作 |


## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/ContractPersistentFormLifecycle.test.ts](../../../tests/components/ContractPersistentFormLifecycle.test.ts) | 组件（jsdom） | 合同表单原提交、后读失败及后来输入隔离 |
| [tests/components/ConstructionScopeSelector.test.ts](../../../tests/components/ConstructionScopeSelector.test.ts) | 组件（jsdom） | 真实工程候选、原编号、后读及来源权限变化 |
| [tests/components/ContractSignatoryField.test.ts](../../../tests/components/ContractSignatoryField.test.ts) | 组件（jsdom） | 核实签约主体动态搜索及原文书采用快照 |
| [tests/components/SubcontractMigrationPanel.test.ts](../../../tests/components/SubcontractMigrationPanel.test.ts) | 组件（jsdom） | 完整分包源预检、确认及原批次恢复入口 |



## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/helpers/production-auxiliary-cold.ts](../../../tests/helpers/production-auxiliary-cold.ts) | 辅助／夹具 | 辅助合同独立 Node 冷恢复调用入口 |
| [tests/helpers/production-boq-cold.ts](../../../tests/helpers/production-boq-cold.ts) | 辅助／夹具 | BOQ 独立 Node 原件与原编号读取入口 |
| [tests/helpers/production-boq-fixture.ts](../../../tests/helpers/production-boq-fixture.ts) | 辅助／夹具 | 同库正式主档与 BOQ 原图夹具 |
| [tests/helpers/production-construction-cold.ts](../../../tests/helpers/production-construction-cold.ts) | 辅助／夹具 | 施工合同独立 Node 原件及回执读取入口 |
| [tests/helpers/production-construction-scope-cold.ts](../../../tests/helpers/production-construction-scope-cold.ts) | 辅助／夹具 | 工程关系独立 Node 恢复入口 |
| [tests/helpers/production-construction-scope-fixture.ts](../../../tests/helpers/production-construction-scope-fixture.ts) | 辅助／夹具 | 同项目多主合同与唯一原费用事实夹具 |
| [tests/helpers/production-subcontract-cold.ts](../../../tests/helpers/production-subcontract-cold.ts) | 辅助／夹具 | 分包普通命令及完整来源采用冷进程入口 |
| [tests/helpers/production-subcontract-fixture.ts](../../../tests/helpers/production-subcontract-fixture.ts) | 辅助／夹具 | 正式主档、实际工程与分包单元夹具 |
| [tests/helpers/production-subcontract-native.ts](../../../tests/helpers/production-subcontract-native.ts) | 辅助／夹具 | 完整分包 Native 原图、原件及未知元数据夹具 |
