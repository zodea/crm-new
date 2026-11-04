# 项目与阶段任务

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/server/project-customer-reference.test.ts](../../../tests/server/project-customer-reference.test.ts) | 单元／服务／状态 | 真实项目客户候选与权限降级 |
| [tests/project/cost-amounts.test.ts](../../../tests/project/cost-amounts.test.ts) | 单元／服务／状态 | 可空金额归集与真实零 |
| [tests/production/project-pending.test.ts](../../../tests/production/project-pending.test.ts) | 单元／服务／状态 | 响应丢失保留不可用原因和原异常，未知结果禁止替换原提交；可靠回执与合法同项目回读共同清理，读取失败只读重试，身份变化及错误目标不解锁 |
| [tests/production/project-storage.test.ts](../../../tests/production/project-storage.test.ts) | 单元／服务／状态 | 项目与原件同库冷回读，客户改名沿原 ID、未知指标不归零、删除恢复保留原件；客户被有效项目引用时拒绝删除 |
| [tests/project/archive.test.ts](../../../tests/project/archive.test.ts) | 单元／服务／状态 | 档案路径清洗与稳定 ZIP 打包 |
| [tests/project/cost-control.test.ts](../../../tests/project/cost-control.test.ts) | 单元／服务／状态 | project cost control read model |
| [tests/project/data-origin.test.ts](../../../tests/project/data-origin.test.ts) | 单元／服务／状态 | project data-origin boundary |
| [tests/project/detail-aggregate.test.ts](../../../tests/project/detail-aggregate.test.ts) | 单元／服务／状态 | 现行归档发票的项目汇总，逐行未知／零／红字与祖先软删及恢复 |
| [tests/project/export.test.ts](../../../tests/project/export.test.ts) | 单元／服务／状态 | 项目台账导出行 |
| [tests/project/management-fee.test.ts](../../../tests/project/management-fee.test.ts) | 单元／服务／状态 | 同库P5冻结归属及P4补退净额，普通工资排除，未知与零、权限与来源证明 |
| [tests/project/formal-facts.test.ts](../../../tests/project/formal-facts.test.ts) | 单元／服务／状态 | project formal fact boundaries |
| [tests/project/import-central.test.ts](../../../tests/project/import-central.test.ts) | 单元／服务／状态 | 项目 Excel → 实际存储 → 中央回读 |
| [tests/project/import-command.test.ts](../../../tests/project/import-command.test.ts) | 单元／服务／状态 | 项目中央逐行导入命令 |
| [tests/project/phase-task-files.test.ts](../../../tests/project/phase-task-files.test.ts) | 单元／服务／状态 | phase task file references |
| [tests/project/project-command-http-repository.test.ts](../../../tests/project/project-command-http-repository.test.ts) | 单元／服务／状态 | project command HTTP repository |
| [tests/project/project-detail-boundary.test.ts](../../../tests/project/project-detail-boundary.test.ts) | 单元／服务／状态 | project detail data-origin boundary |
| [tests/project/project-local-draft.test.ts](../../../tests/project/project-local-draft.test.ts) | 单元／服务／状态 | project local draft |
| [tests/project/repository-contract.test.ts](../../../tests/project/repository-contract.test.ts) | 单元／服务／状态 | project repository contract |
| [tests/project/status.test.ts](../../../tests/project/status.test.ts) | 单元／服务／状态 | 项目状态归一 |
| [tests/server/project-command-test-instance.test.ts](../../../tests/server/project-command-test-instance.test.ts) | 单元／服务／状态 | project command test instance |
| [tests/server/project-read-test-instance.test.ts](../../../tests/server/project-read-test-instance.test.ts) | 单元／服务／状态 | project read resettable instance |
| [tests/stores/project-alias.test.ts](../../../tests/stores/project-alias.test.ts) | 单元／服务／状态 | project alias store |
| [tests/stores/project-command.test.ts](../../../tests/stores/project-command.test.ts) | 单元／服务／状态 | project command store |
| [tests/stores/project-list.test.ts](../../../tests/stores/project-list.test.ts) | 单元／服务／状态 | project list read state |
| [tests/stores/project-load-state.test.ts](../../../tests/stores/project-load-state.test.ts) | 单元／服务／状态 | project store load state |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/ProjectDetailScreen.test.ts](../../../tests/components/ProjectDetailScreen.test.ts) | 组件（jsdom） | 项目详情中央来源边界 |
| [tests/components/ProjectDetailTab.test.ts](../../../tests/components/ProjectDetailTab.test.ts) | 组件（jsdom） | 项目详细资料 |
| [tests/components/ProjectFormPage.test.ts](../../../tests/components/ProjectFormPage.test.ts) | 组件（jsdom） | 项目整页表单 |
| [tests/components/ProjectImportReview.test.ts](../../../tests/components/ProjectImportReview.test.ts) | 组件（jsdom） | 项目导入人工核对 |
| [tests/components/ProjectListScreen.test.ts](../../../tests/components/ProjectListScreen.test.ts) | 组件（jsdom） | project list screen |
| [tests/components/ProjectListToolbar.test.ts](../../../tests/components/ProjectListToolbar.test.ts) | 组件（jsdom） | project list toolbar |
| [tests/components/ProjectMasterDataFormFields.test.ts](../../../tests/components/ProjectMasterDataFormFields.test.ts) | 组件（jsdom） | 项目表单字段 |
| [tests/components/ProjectReturnLink.test.ts](../../../tests/components/ProjectReturnLink.test.ts) | 组件（jsdom） | project return link expiry |

## 真实浏览器组件

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/browser/ProjectManagementFees.test.ts](../../../tests/browser/ProjectManagementFees.test.ts) | Vitest Browser／Chromium | 五档视口管理费原净额与未知总额、原单链接、键盘展开及重读、撤权去除旧金额与链接，可证空源保留真实零 |
| [tests/browser/ProjectImportCancel.test.ts](../../../tests/browser/ProjectImportCancel.test.ts) | Vitest Browser／Chromium | 真实项目导入界面搭配合成 Excel、内存命令和受控渲染等待；停止后尚未开始的行不提交 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-180-project-integration.spec.ts](../../../e2e/issue-180-project-integration.spec.ts) | Playwright E2E | 中央材采／商务／工资／收款身份与来源，五档及等效 200% 视口的页面边界、工资密表局部滚动和键盘导航 |
| [e2e/issue-190-project-reference.spec.ts](../../../e2e/issue-190-project-reference.spec.ts) | Playwright E2E | 中央项目列表、来源感知只读详情与整页表单，响应式滚动及键盘旅程 |
| [e2e/issue-288-project-http-read.spec.ts](../../../e2e/issue-288-project-http-read.spec.ts) | Playwright E2E | Issue #288：项目列表中央 HTTP 读链 |
| [e2e/issue-293-project-command.spec.ts](../../../e2e/issue-293-project-command.spec.ts) | Playwright E2E | Issue #293：项目中央命令与本地草稿 |
| [e2e/issue-312-project-target-registry.spec.ts](../../../e2e/issue-312-project-target-registry.spec.ts) | Playwright E2E | Issue #312：项目 Target Registry |
| [e2e/issue-313-project-return-context.spec.ts](../../../e2e/issue-313-project-return-context.spec.ts) | Playwright E2E | Issue #313：项目列表完整来源上下文 |
| [e2e/production-project-storage.spec.ts](../../../e2e/production-project-storage.spec.ts) | Playwright E2E | 关联生产存储：项目正式保存链 |
| [e2e/project-central-entries.spec.ts](../../../e2e/project-central-entries.spec.ts) | Playwright E2E | 中央项目详情基础资料与材采、其他支出、分包、验收保修、收款入口保持正式身份并可跳转；未接管的本地阶段、文件柜、预算、往来支付、到货归档与档案导出不出现；多宽度不溢出 |
| [e2e/project-crud.spec.ts](../../../e2e/project-crud.spec.ts) | Playwright E2E | 项目列表正式新增与中央导入均可进入现行整页命令 |
| [e2e/project-detail-metrics.spec.ts](../../../e2e/project-detail-metrics.spec.ts) | Playwright E2E | 收款来源暂不可用／无权限时保留未知和基础资料，不冒零或把本地票面差额展示为真实税额 |
| [e2e/project-detail.spec.ts](../../../e2e/project-detail.spec.ts) | Playwright E2E | 独立合成项目列表↔只读详情保持 demo 来源、页签复用及缺失实体空态 |
| [e2e/project-import-central.spec.ts](../../../e2e/project-import-central.spec.ts) | Playwright E2E | 两组真实 Excel 输入按中央客户回执 ID／唯一名称解析筹备／施工阶段；中央保存、详情冷回读、重传 ID 与版本幂等，部分拒绝、响应丢失重试、取消和五视口 |
| [e2e/project-import.spec.ts](../../../e2e/project-import.spec.ts) | Playwright E2E | 项目导入：有中央写权限时从项目列表打开真实导入流程 |
| [e2e/project-subtables.spec.ts](../../../e2e/project-subtables.spec.ts) | Playwright E2E | 九类项目商务卡片进入各自中央列表，保留项目、来源、variant 和具名返回锚点 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/project-central-fixture.ts](../../../e2e/helpers/project-central-fixture.ts) | 辅助／夹具 | 每例统一浏览器与请求的隔离会话、关闭 demo、安装固定起点自然推进的时钟；通过项目命令创建筹备／施工输入并返回正式 ID、来源地址与中央回读 |

## 浏览器组件

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
