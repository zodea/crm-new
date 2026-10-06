# 供应商与资质

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/stores/supplier-persistent-command.test.ts](../../../tests/stores/supplier-persistent-command.test.ts) | 单元／服务／状态 | 分供方原提交恢复、后读失败及输入保全 |
| [tests/supplier/native-review-history.test.ts](../../../tests/supplier/native-review-history.test.ts) | 单元／服务／状态 | Native 原件及人工核验不可变历史 |
| [tests/db/supplier-labor-scope-migration.test.ts](../../../tests/db/supplier-labor-scope-migration.test.ts) | 单元／服务／状态 | 分供方可选劳务范围迁移 |
| [tests/migration/supplier-credential-source.test.ts](../../../tests/migration/supplier-credential-source.test.ts) | 单元／服务／状态 | 分供方证照完整物理图来源 |
| [tests/production/supplier-credential-pending.test.ts](../../../tests/production/supplier-credential-pending.test.ts) | 单元／服务／状态 | 证照原件失响应冷恢复只凭原键核对，正文不进浏览器持久层且不二次上传 |
| [tests/production/supplier-pending.test.ts](../../../tests/production/supplier-pending.test.ts) | 单元／服务／状态 | 主档丢响应后只存原键，冷恢复先读原分供方，不重复创建 |
| [tests/production/supplier-restart.test.ts](../../../tests/production/supplier-restart.test.ts) | 单元／服务／状态 | 真实公开服务重启后恢复原件、OCR候选/人工值及失响应原键；真实财务空源及双读权证明实付零、排序和再次冷读，未接项目及合同仍未知，回滚/撤权/跨来源仍拒绝 |
| [tests/production/supplier-storage.test.ts](../../../tests/production/supplier-storage.test.ts) | 单元／服务／状态 | 磁盘冷打开保留主档、原件、人工核验、原回执及导入指纹 |
| [tests/production/supplier-business-facts.test.ts](../../../tests/production/supplier-business-facts.test.ts) | 实际 SQLite 及正式参与者 | 同事务读取 F3 实付、材采与 Other 有证小计；真实零、缺源、权限隔离及原申请删除后的确认现金保全 |
| [tests/server/supplier-central-test-instance.test.ts](../../../tests/server/supplier-central-test-instance.test.ts) | 单元／服务／状态 | 分供方中央写入测试实例 |
| [tests/server/supplier-fact-source.test.ts](../../../tests/server/supplier-fact-source.test.ts) | 单元／服务／状态 | 分供方跨领域事实投影 |
| [tests/stores/supplier-central.test.ts](../../../tests/stores/supplier-central.test.ts) | 单元／服务／状态 | 分供方中央 stores |
| [tests/stores/supplier-credential-state.test.ts](../../../tests/stores/supplier-credential-state.test.ts) | 单元／服务／状态 | 中央证照会话所有权和原提交恢复 |
| [tests/stores/supplier-detail.test.ts](../../../tests/stores/supplier-detail.test.ts) | 单元／服务／状态 | supplier detail store |
| [tests/stores/supplier-taxpayer.test.ts](../../../tests/stores/supplier-taxpayer.test.ts) | 单元／服务／状态 | 每表单税务提交身份 |
| [tests/supplier/credential-central.test.ts](../../../tests/supplier/credential-central.test.ts) | 单元／服务／状态 | 中央证照与主档同一事务旅程 |
| [tests/supplier/credential-core-integration.test.ts](../../../tests/supplier/credential-core-integration.test.ts) | 单元／服务／状态 | 证照与中央迁移协调器完整接缝 |
| [tests/supplier/credential-master-transaction.test.ts](../../../tests/supplier/credential-master-transaction.test.ts) | 单元／服务／状态 | 证照与主档共同事务 |
| [tests/supplier/credential-migration.test.ts](../../../tests/supplier/credential-migration.test.ts) | 单元／服务／状态 | 分供方证照迁移候选与恢复 |
| [tests/supplier/credential-ocr-central.test.ts](../../../tests/supplier/credential-ocr-central.test.ts) | 单元／服务／状态 | 中央原件识别与人工确认 |
| [tests/supplier/credential-ocr.test.ts](../../../tests/supplier/credential-ocr.test.ts) | 单元／服务／状态 | supplier credential OCR |
| [tests/supplier/credential-repository.test.ts](../../../tests/supplier/credential-repository.test.ts) | 单元／服务／状态 | 中央证照 Repository |
| [tests/supplier/credential-request.test.ts](../../../tests/supplier/credential-request.test.ts) | 单元／服务／状态 | 证照 HTTP 请求边界 |
| [tests/supplier/credentials.test.ts](../../../tests/supplier/credentials.test.ts) | 单元／服务／状态 | 分供方证照规则 |
| [tests/supplier/detail.test.ts](../../../tests/supplier/detail.test.ts) | 单元／服务／状态 | 分供方详情纯聚合 |
| [tests/supplier/export.test.ts](../../../tests/supplier/export.test.ts) | 单元／服务／状态 | 分供方台账导出行 |
| [tests/supplier/http-repository.test.ts](../../../tests/supplier/http-repository.test.ts) | 单元／服务／状态 | 分供方中央 HTTP Repository |
| [tests/supplier/import-command.test.ts](../../../tests/supplier/import-command.test.ts) | 单元／服务／状态 | 分供方中央逐行导入 |
| [tests/supplier/import.test.ts](../../../tests/supplier/import.test.ts) | 单元／服务／状态 | 分供方导入行归一 |
| [tests/supplier/list.test.ts](../../../tests/supplier/list.test.ts) | 单元／服务／状态 | 分供方列表筛选 |
| [tests/supplier/repository-contract.test.ts](../../../tests/supplier/repository-contract.test.ts) | 单元／服务／状态 | 分供方中央 Repository contract |
| [tests/supplier/return-context.test.ts](../../../tests/supplier/return-context.test.ts) | 单元／服务／状态 | 分供方列表返回上下文 |
| [tests/supplier/status.test.ts](../../../tests/supplier/status.test.ts) | 单元／服务／状态 | 分供方类别 |
| [tests/supplier/taxpayer-central.test.ts](../../../tests/supplier/taxpayer-central.test.ts) | 单元／服务／状态 | 人工税务核验中央边界 |
| [tests/supplier/taxpayer-editor.test.ts](../../../tests/supplier/taxpayer-editor.test.ts) | 单元／服务／状态 | 税务核验编辑稿和主档基准 |
| [tests/supplier/taxpayer-repository.test.ts](../../../tests/supplier/taxpayer-repository.test.ts) | 单元／服务／状态 | 税务核验 HTTP 回包 |
| [tests/tabs/supplier-credential-restore.test.ts](../../../tests/tabs/supplier-credential-restore.test.ts) | 单元／服务／状态 | 中央证照独立页签恢复 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/SupplierCredentialCentralPanel.test.ts](../../../tests/components/SupplierCredentialCentralPanel.test.ts) | 组件（jsdom） | 中央证照人工工作面 |
| [tests/components/SupplierCredentialOcrReview.test.ts](../../../tests/components/SupplierCredentialOcrReview.test.ts) | 组件（jsdom） | supplier credential OCR review |
| [tests/components/SupplierCredentialOcrWorkflow.test.ts](../../../tests/components/SupplierCredentialOcrWorkflow.test.ts) | 组件（jsdom） | 中央 OCR 识别与人工确认工作流 |
| [tests/components/SupplierCredentialScreen.test.ts](../../../tests/components/SupplierCredentialScreen.test.ts) | 组件（jsdom） | 中央分供方证照入口 |
| [tests/components/SupplierCredentialTab.test.ts](../../../tests/components/SupplierCredentialTab.test.ts) | 组件（jsdom） | supplier credential tab |
| [tests/components/SupplierDetailScreen.test.ts](../../../tests/components/SupplierDetailScreen.test.ts) | 组件（jsdom） | 分供方中央详情；材采可读而其他合同域不可用／无权／缺证时只显示已核事实与完整未知，禁止挂载缺源子区；统一可信合同及 demo 原边界 |
| [tests/components/SupplierFactTable.test.ts](../../../tests/components/SupplierFactTable.test.ts) | 组件（jsdom） | 分供方合同事实类别 |
| [tests/components/SupplierFormFields.test.ts](../../../tests/components/SupplierFormFields.test.ts) | 组件（jsdom） | 分供方表单资料辅助动作 |
| [tests/components/SupplierListCredentialFilter.test.ts](../../../tests/components/SupplierListCredentialFilter.test.ts) | 组件（jsdom） | 分供方营业执照真实状态筛选 |
| [tests/components/SupplierTaxpayerDialog.test.ts](../../../tests/components/SupplierTaxpayerDialog.test.ts) | 组件（jsdom） | 人工税务核验对话框 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-315-supplier-central-facts.spec.ts](../../../e2e/issue-315-supplier-central-facts.spec.ts) | Playwright E2E | Issue #315：分供方中央详情与四类真实事实 |
| [e2e/production-supplier-storage.spec.ts](../../../e2e/production-supplier-storage.spec.ts) | Playwright E2E | 分供方主档、证照原件与人工核验原键冷恢复；真实空财务零值及排序、材采真实空集合／缺其他域的部分金额与完整未知、零缺源请求／入口、未知项目筛选拒绝、原件和通知保全及五档布局 |
| [e2e/supplier-credential-ocr-central.spec.ts](../../../e2e/supplier-credential-ocr-central.spec.ts) | Playwright E2E | 授权合成原件识别失败重试、稍后冷读、税号矛盾和陈旧确认保选择、重新识别保留确认 |
| [e2e/supplier-credentials-central.spec.ts](../../../e2e/supplier-credentials-central.spec.ts) | Playwright E2E | 真实旧库完整图迁入、历史凭证回读、同原件撤回与缺正文不冒充齐全 |
| [e2e/supplier-crud.spec.ts](../../../e2e/supplier-crud.spec.ts) | Playwright E2E | 两类正式分供方新建、显式编辑、冷回读与页签复用；中央行菜单仅提供只读入口，旧本地删除由数据库及通用主数据测试覆盖 |
| [e2e/supplier-detail.spec.ts](../../../e2e/supplier-detail.spec.ts) | Playwright E2E | 分供方详情：6 Tab 实时汇总、证照软删除撤回与列表双页联动 |
| [e2e/supplier-export.spec.ts](../../../e2e/supplier-export.spec.ts) | Playwright E2E | 两类正式主档 × 五档视口核对中央导出尚未接入的边界；实际 XLSX 内容和分类目录由 supplier/export 参数表覆盖 |
| [e2e/supplier-import.spec.ts](../../../e2e/supplier-import.spec.ts) | Playwright E2E | 中央导入：信用代码和唯一识别码独立映射，同外部旧 ID 重导更新并保留未映射资料 |
| [e2e/supplier-list-replica.spec.ts](../../../e2e/supplier-list-replica.spec.ts) | Playwright E2E | ${width}px：完整列、紧凑标签、表格内滚动及可访问工具 |
| [e2e/supplier-multifilter.spec.ts](../../../e2e/supplier-multifilter.spec.ts) | Playwright E2E | ${width}px 固定枚举复选与表头联动，返回链接保留组合且清空恢复全量 |
| [e2e/supplier-reference-layout.spec.ts](../../../e2e/supplier-reference-layout.spec.ts) | Playwright E2E | Issue #193/#206：两类正式主档、脱敏、局部滚动、类别选择及独立证照入口 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/supplier-credential-migration-source.ts](../../../e2e/helpers/supplier-credential-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/synthetic-credential-ocr.ts](../../../e2e/helpers/synthetic-credential-ocr.ts) | 辅助／夹具 | worker 内持有独立 Nuxt 与回环合成 OCR，显式合成配置和同盘隔离构建目录，结束清理两类服务；不依赖日常 OCR 配置 |
| [tests/helpers/production-supplier-process.ts](../../../tests/helpers/production-supplier-process.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/production-supplier-server.ts](../../../tests/helpers/production-supplier-server.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/supplier/credential-ui-fixtures.ts](../../../tests/supplier/credential-ui-fixtures.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
