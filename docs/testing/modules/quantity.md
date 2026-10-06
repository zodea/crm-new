# 工程量与空鼓检查

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/db/quantity-seed.test.ts](../../../tests/db/quantity-seed.test.ts) | 单元／服务／状态 | 工程量演示 seed |
| [tests/quantity/basis.test.ts](../../../tests/quantity/basis.test.ts) | 单元／服务／状态 | 工程量取数基准 |
| [tests/quantity/browser-catalog.test.ts](../../../tests/quantity/browser-catalog.test.ts) | 单元／服务／状态 | 工程量正式项目候选 |
| [tests/quantity/browser-state.test.ts](../../../tests/quantity/browser-state.test.ts) | 单元／服务／状态 | 工程量浏览器中央工作面 |
| [tests/quantity/central-assignment.test.ts](../../../tests/quantity/central-assignment.test.ts) | 单元／服务／状态 | 责任从当前中央主数据选人，保存后同一工作区回读且重试不重复责任与审计 |
| [tests/quantity/central-boq-template.test.ts](../../../tests/quantity/central-boq-template.test.ts) | 单元／服务／状态 | 中央户型人工关联清单 |
| [tests/quantity/central-boq.test.ts](../../../tests/quantity/central-boq.test.ts) | 单元／服务／状态 | 中央 BOQ 原量与当前有效量价 |
| [tests/quantity/central-completion.test.ts](../../../tests/quantity/central-completion.test.ts) | 单元／服务／状态 | 两阶段独立完成，月度只计指定阶段，未知现场量保留，照片同源且责任替换不重写执行历史 |
| [tests/quantity/central-hollow-http.test.ts](../../../tests/quantity/central-hollow-http.test.ts) | 单元／服务／状态 | 真实 HTTP 与 Repository 冷读明确零、修订及整改，并按历史确认原回执 |
| [tests/quantity/central-hollow-integrity.test.ts](../../../tests/quantity/central-hollow-integrity.test.ts) | 单元／服务／状态 | 空鼓来源原件与事务边界 |
| [tests/quantity/central-hollow.test.ts](../../../tests/quantity/central-hollow.test.ts) | 单元／服务／状态 | 户级空鼓公开来源服务 |
| [tests/quantity/central-import.test.ts](../../../tests/quantity/central-import.test.ts) | 单元／服务／状态 | 三类工程量中央日常导入 |
| [tests/quantity/central-monthly.test.ts](../../../tests/quantity/central-monthly.test.ts) | 单元／服务／状态 | 当前工程量至甲方月报 |
| [tests/quantity/central-photo.test.ts](../../../tests/quantity/central-photo.test.ts) | 单元／服务／状态 | 验收照片的编码、实际长度及图片类型都要验证，拒绝伪造元数据 |
| [tests/quantity/central-service.test.ts](../../../tests/quantity/central-service.test.ts) | 单元／服务／状态 | 中央工程量公共服务 |
| [tests/quantity/central-stage-service.test.ts](../../../tests/quantity/central-stage-service.test.ts) | 单元／服务／状态 | 阶段配置走中央命令与同源回读，新映射不自动报量，显式切换原子且可重试 |
| [tests/quantity/central-stages.test.ts](../../../tests/quantity/central-stages.test.ts) | 单元／服务／状态 | 项目阶段目录与显式报量映射 |
| [tests/quantity/controlled-migration.test.ts](../../../tests/quantity/controlled-migration.test.ts) | 单元／服务／状态 | 历史照片缺正文只登记明确提示，元数据照实迁入且读正文报告缺失 |
| [tests/quantity/entry-source.test.ts](../../../tests/quantity/entry-source.test.ts) | 单元／服务／状态 | quantity entry source |
| [tests/quantity/export.test.ts](../../../tests/quantity/export.test.ts) | 单元／服务／状态 | quantity export：派生查询到 ADR 0004 两路导出 |
| [tests/quantity/formula.test.ts](../../../tests/quantity/formula.test.ts) | 单元／服务／状态 | 现场量算式 |
| [tests/quantity/hollow-migration.test.ts](../../../tests/quantity/hollow-migration.test.ts) | 单元／服务／状态 | 空鼓来源只出现部分新表时拒绝导出，不将检查记录静默丢回旧工程量图 |
| [tests/quantity/hollow-navigation.test.ts](../../../tests/quantity/hollow-navigation.test.ts) | 单元／服务／状态 | 户级空鼓的受控来源导航 |
| [tests/quantity/http-repository.test.ts](../../../tests/quantity/http-repository.test.ts) | 单元／服务／状态 | 工程量 HTTP Repository |
| [tests/quantity/import.test.ts](../../../tests/quantity/import.test.ts) | 单元／服务／状态 | quantity import：三类目标逐行复用唯一写路径 |
| [tests/quantity/matrix.test.ts](../../../tests/quantity/matrix.test.ts) | 单元／服务／状态 | 工程量矩阵纯投影 |
| [tests/quantity/migration-core-source.test.ts](../../../tests/quantity/migration-core-source.test.ts) | 单元／服务／状态 | 真实BOQ迁移目录保持量价空零、楼栋归属与规范更新时间，不预先叠加变更 |
| [tests/quantity/migration-graph.test.ts](../../../tests/quantity/migration-graph.test.ts) | 单元／服务／状态 | 迁移时间不把不存在的日期滚动到下一月，也不接收含糊时间格式 |
| [tests/quantity/navigation.test.ts](../../../tests/quantity/navigation.test.ts) | 单元／服务／状态 | quantity route context |
| [tests/quantity/read-adapter.test.ts](../../../tests/quantity/read-adapter.test.ts) | 单元／服务／状态 | 工程量浏览器读来源适配 |
| [tests/quantity/read-model.test.ts](../../../tests/quantity/read-model.test.ts) | 单元／服务／状态 | 工程量只读查询 |
| [tests/quantity/region.test.ts](../../../tests/quantity/region.test.ts) | 单元／服务／状态 | 工程量项目区域配置 |
| [tests/quantity/request.test.ts](../../../tests/quantity/request.test.ts) | 单元／服务／状态 | 工程量 HTTP 请求边界 |
| [tests/quantity/stage-state.test.ts](../../../tests/quantity/stage-state.test.ts) | 单元／服务／状态 | 阶段配置编辑会话 |
| [tests/quantity/variance.test.ts](../../../tests/quantity/variance.test.ts) | 单元／服务／状态 | 工程量量差总表 |
| [tests/quantity/wage-source.test.ts](../../../tests/quantity/wage-source.test.ts) | 单元／服务／状态 | 关联工资：工程量向工资提供的来源 |
| [tests/quantity/workspace-state.test.ts](../../../tests/quantity/workspace-state.test.ts) | 单元／服务／状态 | 工程量工作面独立编辑会话 |
| [tests/server/quantity-database.test.ts](../../../tests/server/quantity-database.test.ts) | 单元／服务／状态 | 工程量候选SQL完全准备后才交换，失败候选不改变现有数据库 |
| [tests/server/quantity-hollow-migration.test.ts](../../../tests/server/quantity-hollow-migration.test.ts) | 单元／服务／状态 | 公开迁入冷读保余15处，中央追加整改后仍可重试原命令且恢复受保护 |
| [tests/server/quantity-migration.test.ts](../../../tests/server/quantity-migration.test.ts) | 单元／服务／状态 | 完整工程量在准备期间占住实例队列，确认后从同一服务读回映射身份，重复同步保持版本 |
| [tests/server/quantity-test-instance.test.ts](../../../tests/server/quantity-test-instance.test.ts) | 单元／服务／状态 | 工程量中央 SQL 测试实例 |
| [tests/server/quantity-workspace.test.ts](../../../tests/server/quantity-workspace.test.ts) | 单元／服务／状态 | 预算工作区事务不要求工程量或项目权限，失败不发布半份SQL |
| [tests/stores/quantity-archive.test.ts](../../../tests/stores/quantity-archive.test.ts) | 单元／服务／状态 | quantity matrix archive：归档独立 action 与全域写入门控 |
| [tests/stores/quantity-assignment.test.ts](../../../tests/stores/quantity-assignment.test.ts) | 单元／服务／状态 | quantity store：户×工种责任配置唯一写路径 |
| [tests/stores/quantity-batch-completion.test.ts](../../../tests/stores/quantity-batch-completion.test.ts) | 单元／服务／状态 | quantity batch completion：整工种批量展开与逐阶段写入 |
| [tests/stores/quantity-completion.test.ts](../../../tests/stores/quantity-completion.test.ts) | 单元／服务／状态 | quantity stage completion：单户×单阶段唯一写路径 |
| [tests/stores/quantity-derived.test.ts](../../../tests/stores/quantity-derived.test.ts) | 单元／服务／状态 | quantity derived：统一派生读 seam |
| [tests/stores/quantity-hollow-pending.test.ts](../../../tests/stores/quantity-hollow-pending.test.ts) | 单元／服务／状态 | 响应丢失冷恢复保原键原正文，后来版本不能覆盖原提交 |
| [tests/stores/quantity-hollow-startup.test.ts](../../../tests/stores/quantity-hollow-startup.test.ts) | 单元／服务／状态 | 刷新精确空鼓工作页保直接目标，仍不保存为可恢复只读页签 |
| [tests/stores/quantity-source.test.ts](../../../tests/stores/quantity-source.test.ts) | 单元／服务／状态 | 工程量运行环境入口 |
| [tests/stores/quantity-template.test.ts](../../../tests/stores/quantity-template.test.ts) | 单元／服务／状态 | quantity store：户型模板唯一写路径 |
| [tests/stores/quantity.test.ts](../../../tests/stores/quantity.test.ts) | 单元／服务／状态 | quantity store |
| [tests/tabs/quantity-hollow-restore.test.ts](../../../tests/tabs/quantity-hollow-restore.test.ts) | 单元／服务／状态 | 真实原户空鼓冷恢复分别核验户、记录和历史修订并保工资原稿返回 |
| [tests/tabs/quantity-restore.test.ts](../../../tests/tabs/quantity-restore.test.ts) | 单元／服务／状态 | 中央工程量户详情只读恢复 |

## 视觉基线（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-169-responsibility-dialog.spec.ts-snapshots/responsibility-dialog-1740x974-chromium-win32.png](../../../e2e/issue-169-responsibility-dialog.spec.ts-snapshots/responsibility-dialog-1740x974-chromium-win32.png) | 视觉基线 | 责任配置弹窗截图 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/QuantityAssignmentSource.test.ts](../../../tests/components/QuantityAssignmentSource.test.ts) | 组件（jsdom） | 已打开责任配置同项目切换来源重新读取并撤销正式写权限 |
| [tests/components/QuantityBoqLinkField.test.ts](../../../tests/components/QuantityBoqLinkField.test.ts) | 组件（jsdom） | 模板稳定清单关联 |
| [tests/components/QuantityCompletionPhotoRace.test.ts](../../../tests/components/QuantityCompletionPhotoRace.test.ts) | 组件（jsdom） | 照片仍在读取时切换阶段，旧文件迟到不会加入新阶段草稿 |
| [tests/components/QuantityFieldFormulaCell.test.ts](../../../tests/components/QuantityFieldFormulaCell.test.ts) | 组件（jsdom） | quantity field formula cell |
| [tests/components/QuantityHollowFormState.test.ts](../../../tests/components/QuantityHollowFormState.test.ts) | 组件（jsdom） | 未知保存完整字段冷恢复，核对原提交后才进入真实记录详情 |
| [tests/components/QuantityHollowHistory.test.ts](../../../tests/components/QuantityHollowHistory.test.ts) | 组件（jsdom） | 当前19减4显示15，原检查与整改的日期处数分别可读 |
| [tests/components/QuantityHollowRectification.test.ts](../../../tests/components/QuantityHollowRectification.test.ts) | 组件（jsdom） | 真实公开来源 19 处取消小确认保输入，确认整改 4 处后仍保原检查且余 15 |
| [tests/components/QuantityHollowRuntime.test.ts](../../../tests/components/QuantityHollowRuntime.test.ts) | 组件（jsdom） | 桌面原户深链不挂载三类中央空鼓页面，浏览器仍由原页读取权限 |
| [tests/components/QuantityScreenCentral.test.ts](../../../tests/components/QuantityScreenCentral.test.ts) | 组件（jsdom） | 正式工程量矩阵来源与入口 |
| [tests/components/QuantityStageFields.test.ts](../../../tests/components/QuantityStageFields.test.ts) | 组件（jsdom） | 阶段整页字段 |
| [tests/components/QuantityStageFormPage.test.ts](../../../tests/components/QuantityStageFormPage.test.ts) | 组件（jsdom） | 施工阶段配置整页 |
| [tests/components/QuantityStageReporting.test.ts](../../../tests/components/QuantityStageReporting.test.ts) | 组件（jsdom） | 显式报量阶段选择 |
| [tests/components/QuantityTemplateCentral.test.ts](../../../tests/components/QuantityTemplateCentral.test.ts) | 组件（jsdom） | 中央模板整页与缓存 |
| [tests/components/QuantityTemplateLinesSection.test.ts](../../../tests/components/QuantityTemplateLinesSection.test.ts) | 组件（jsdom） | quantity template lines section |
| [tests/components/QuantityUnitTotals.test.ts](../../../tests/components/QuantityUnitTotals.test.ts) | 组件（jsdom） | 户详情工程量合计 |
| [tests/components/QuantityVarianceDialog.test.ts](../../../tests/components/QuantityVarianceDialog.test.ts) | 组件（jsdom） | quantity variance dialog |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-169-responsibility-dialog.spec.ts](../../../e2e/issue-169-responsibility-dialog.spec.ts) | Playwright E2E | Issue #169：责任配置弹窗视觉与模态边界 |
| [e2e/quantity-archive-export.spec.ts](../../../e2e/quantity-archive-export.spec.ts) | Playwright E2E | 中央矩阵归档取消、确认及解除回读一致，分类导出保留目录和施工记录原值 |
| [e2e/quantity-assignment.spec.ts](../../../e2e/quantity-assignment.spec.ts) | Playwright E2E | Issue #103 Slice 4：户×工种责任配置 |
| [e2e/quantity-central-api.spec.ts](../../../e2e/quantity-central-api.spec.ts) | Playwright E2E | 工程量真实 HTTP 从中央新项目保存区域与模板，重读并拒绝身份、版本和来源错配 |
| [e2e/quantity-central-ui.spec.ts](../../../e2e/quantity-central-ui.spec.ts) | Playwright E2E | 新项目经真实整页建立模板清单关联和区域，刷新与五档保持正式来源及未知量 |
| [e2e/quantity-completion-ui.spec.ts](../../../e2e/quantity-completion-ui.spec.ts) | Playwright E2E | 中央责任、缺照草稿、照片完成和责任替换保留历史，批量软卡逐项回读 |
| [e2e/quantity-import.spec.ts](../../../e2e/quantity-import.spec.ts) | Playwright E2E | 三类实际 CSV 经中央导入：零与未知、唯一责任、缺照拒绝和草稿反馈 |
| [e2e/quantity-matrix.spec.ts](../../../e2e/quantity-matrix.spec.ts) | Playwright E2E | Issue #103 Slice 2：只读工程量矩阵 |
| [e2e/quantity-migration.spec.ts](../../../e2e/quantity-migration.spec.ts) | Playwright E2E | 工程量真实SQLite十五表经HTTP迁移，更正与独立新增保留，回滚撤下原批次事实 |
| [e2e/quantity-owner-monthly.spec.ts](../../../e2e/quantity-owner-monthly.spec.ts) | Playwright E2E | 当前清单、中央完工与甲方月报经真实 HTTP 联通，三量不回退且已提交快照不漂移 |
| [e2e/quantity-stages.spec.ts](../../../e2e/quantity-stages.spec.ts) | Playwright E2E | 中央新项目建立两个阶段，显式报量逐项保存不丢草稿，五档可操作且取消归档修改保留输入 |
| [e2e/quantity-template.spec.ts](../../../e2e/quantity-template.spec.ts) | Playwright E2E | Issue #103 Slice 3：户型模板活链接与三量 |
| [e2e/quantity-totals.spec.ts](../../../e2e/quantity-totals.spec.ts) | Playwright E2E | Issue #440 工程量三量合计与真实导出 |
| [e2e/quantity-unit-detail.spec.ts](../../../e2e/quantity-unit-detail.spec.ts) | Playwright E2E | Issue #103 Slice 6A：户施工详情 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/quantity-migration-source.ts](../../../e2e/helpers/quantity-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/quantity-production-fixture.ts](../../../e2e/helpers/quantity-production-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/quantity-hollow-fixture.ts](../../../tests/helpers/quantity-hollow-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/quantity-hollow-migration-fixture.ts](../../../tests/helpers/quantity-hollow-migration-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/quantity-hollow-ui-fixture.ts](../../../tests/helpers/quantity-hollow-ui-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/quantity-migration-source.ts](../../../tests/helpers/quantity-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
