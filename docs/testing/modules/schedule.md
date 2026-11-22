# 进度、工序库与 WBS

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/db/schedule-migrations.test.ts](../../../tests/db/schedule-migrations.test.ts) | 单元／服务／状态 | 施工进度排程数据底座 |
| [tests/db/schedule-process-library-migrations.test.ts](../../../tests/db/schedule-process-library-migrations.test.ts) | 单元／服务／状态 | 标准工序库与内部暂估排程迁移 |
| [tests/db/schedule-seed.test.ts](../../../tests/db/schedule-seed.test.ts) | 单元／服务／状态 | 施工进度演示 seed |
| [tests/migration/process-library-source.test.ts](../../../tests/migration/process-library-source.test.ts) | 单元／服务／状态 | 工序库物理源导出 |
| [tests/production/process-library-boundaries.test.ts](../../../tests/production/process-library-boundaries.test.ts) | 单元／服务／状态 | 工序库提交期间撤权完整回滚，已存原件证据损坏后明确拒绝读取和再保存 |
| [tests/production/process-library-http.test.ts](../../../tests/production/process-library-http.test.ts) | 单元／服务／状态 | 正式公开工序库保存完整版本且同键重复不升号，旧版本仍按稳定身份读取 |
| [tests/production/process-library-restart.test.ts](../../../tests/production/process-library-restart.test.ts) | 单元／服务／状态 | 独立服务进程公开保存后丢弃响应并重启，原键恢复原图且并开旧版仍按原身份解析 |
| [tests/schedule/central-binding.test.ts](../../../tests/schedule/central-binding.test.ts) | 单元／服务／状态 | 中央暂估绑定冻结比较与原子确认 |
| [tests/schedule/central-repository.test.ts](../../../tests/schedule/central-repository.test.ts) | 单元／服务／状态 | 中央 WBS HTTP Repository |
| [tests/schedule/central-request.test.ts](../../../tests/schedule/central-request.test.ts) | 单元／服务／状态 | 中央 WBS 请求边界 |
| [tests/schedule/central-service.test.ts](../../../tests/schedule/central-service.test.ts) | 单元／服务／状态 | 中央 WBS 原子命令与真实数量来源 |
| [tests/schedule/central-usage.test.ts](../../../tests/schedule/central-usage.test.ts) | 单元／服务／状态 | 中央排程目录与工序库引用共用当前可见范围 |
| [tests/schedule/contract-binding.test.ts](../../../tests/schedule/contract-binding.test.ts) | 单元／服务／状态 | 内部暂估排程绑定施工合同 |
| [tests/schedule/navigation.test.ts](../../../tests/schedule/navigation.test.ts) | 单元／服务／状态 | 绑定与清单证据更正往返；排程下钻导航；工序库建组返回上下文 |
| [tests/schedule/planning.test.ts](../../../tests/schedule/planning.test.ts) | 单元／服务／状态 | 拒绝不存在的月日，不能将日期溢出静默滚到下月；施工进度纯领域规则 |
| [tests/schedule/process-library-central.test.ts](../../../tests/schedule/process-library-central.test.ts) | 单元／服务／状态 | 工序库中央不可变版本 |
| [tests/schedule/process-library-core-integration.test.ts](../../../tests/schedule/process-library-core-integration.test.ts) | 单元／服务／状态 | 工序库与中央迁移协调器完整接缝 |
| [tests/schedule/process-library-migration.test.ts](../../../tests/schedule/process-library-migration.test.ts) | 单元／服务／状态 | 工序库迁入候选与恢复 |
| [tests/schedule/process-library-repository.test.ts](../../../tests/schedule/process-library-repository.test.ts) | 单元／服务／状态 | 工序库公开 HTTP Repository |
| [tests/schedule/process-library-request.test.ts](../../../tests/schedule/process-library-request.test.ts) | 单元／服务／状态 | 工序库公开命令解析 |
| [tests/schedule/process-library-test-reset.test.ts](../../../tests/schedule/process-library-test-reset.test.ts) | 单元／服务／状态 | 工序库测试重置端点 |
| [tests/schedule/process-library-domain.test.ts](../../../tests/schedule/process-library-domain.test.ts) | 单元／服务／状态 | 标准工序库前置关系校验 |
| [tests/schedule/read-model.test.ts](../../../tests/schedule/read-model.test.ts) | 单元／服务／状态 | 排程 read model |
| [tests/schedule/wbs-controlled-migration.test.ts](../../../tests/schedule/wbs-controlled-migration.test.ts) | 单元／服务／状态 | 完整 SQLite 图经确认原子迁入，绑定历史/软禁用/无组任务/冻结8与人工楼层均可读；重复确认保日常更正 |
| [tests/server/wbs-migration.test.ts](../../../tests/server/wbs-migration.test.ts) | 单元／服务／状态 | WBS 写后分组名唯一约束冲突丢弃已准备工程量候选，原组和版本保留，失败后队列可继续读取与保存 |
| [tests/stores/process-library-central-state.test.ts](../../../tests/stores/process-library-central-state.test.ts) | 单元／服务／状态 | 中央工序库公开状态 |
| [tests/stores/schedule-central-library-source.test.ts](../../../tests/stores/schedule-central-library-source.test.ts) | 单元／服务／状态 | 浏览器 WBS 的工序库来源接管 |
| [tests/stores/schedule-central-state.test.ts](../../../tests/stores/schedule-central-state.test.ts) | 单元／服务／状态 | 中央绑定固定预览与原提交恢复 |
| [tests/tabs/process-library-restore.test.ts](../../../tests/tabs/process-library-restore.test.ts) | 单元／服务／状态 | 中央工序库只读详情恢复 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/ScheduleBindingCentralState.test.ts](../../../tests/components/ScheduleBindingCentralState.test.ts) | 组件（jsdom） | 中央绑定表单状态边界 |
| [tests/components/ScheduleBindingReview.test.ts](../../../tests/components/ScheduleBindingReview.test.ts) | 组件（jsdom） | 冻结差异展示 |
| [tests/components/ScheduleCentralUiState.test.ts](../../../tests/components/ScheduleCentralUiState.test.ts) | 组件（jsdom） | 中央排程界面目标与草稿边界 |
| [tests/components/ScheduleContractBindingEntry.test.ts](../../../tests/components/ScheduleContractBindingEntry.test.ts) | 组件（jsdom） | 内部暂估排程绑定入口 |
| [tests/components/ScheduleContractBindingRoute.test.ts](../../../tests/components/ScheduleContractBindingRoute.test.ts) | 组件（jsdom） | 施工排程合同绑定路由 |
| [tests/components/ScheduleContractBindingScreen.test.ts](../../../tests/components/ScheduleContractBindingScreen.test.ts) | 组件（jsdom） | scheduleContractBindingScreen |
| [tests/components/ScheduleDependencyDialog.test.ts](../../../tests/components/ScheduleDependencyDialog.test.ts) | 组件（jsdom） | schedule dependency dialog |
| [tests/components/ScheduleGroupNewLoadingGuard.test.ts](../../../tests/components/ScheduleGroupNewLoadingGuard.test.ts) | 组件（jsdom） | 新建排程范围加载保护 |
| [tests/components/ScheduleProcessLibraryCentralForm.test.ts](../../../tests/components/ScheduleProcessLibraryCentralForm.test.ts) | 组件（jsdom） | 工序库中央整页表单 |
| [tests/components/ScheduleProcessLibraryFormReuse.test.ts](../../../tests/components/ScheduleProcessLibraryFormReuse.test.ts) | 组件（jsdom） | 标准工序库表单页签复用 |
| [tests/components/ScheduleProcessLibraryFormTabGuard.test.ts](../../../tests/components/ScheduleProcessLibraryFormTabGuard.test.ts) | 组件（jsdom） | 工序库真实路由与页签关闭守卫 |
| [tests/components/ScheduleProcessLibraryReadPages.test.ts](../../../tests/components/ScheduleProcessLibraryReadPages.test.ts) | 组件（jsdom） | 工序库中央只读页面 |
| [tests/components/ScheduleProcessLibraryReorder.test.ts](../../../tests/components/ScheduleProcessLibraryReorder.test.ts) | 组件（jsdom） | 工序库调序关系核对 |
| [tests/components/ScheduleProcessLibraryTaskEditor.test.ts](../../../tests/components/ScheduleProcessLibraryTaskEditor.test.ts) | 组件（jsdom） | 标准工序库工序编辑表 |
| [tests/components/ScheduleTaskDialog.test.ts](../../../tests/components/ScheduleTaskDialog.test.ts) | 组件（jsdom） | 仅改人工进度仍发送同一前置，依赖往返不重置未提交日期 |
| [tests/components/ScheduleTemplateGanttEditor.test.ts](../../../tests/components/ScheduleTemplateGanttEditor.test.ts) | 组件（jsdom） | 模板甘特编辑器 |
| [tests/components/ScheduleTimelineReuse.test.ts](../../../tests/components/ScheduleTimelineReuse.test.ts) | 组件（jsdom） | 施工排程时间轴复用 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/process-library-central.spec.ts](../../../e2e/process-library-central.spec.ts) | Playwright E2E | 真实 SQLite 迁入、从任意旧版保存下一版、冷刷新与冲突人工核对 |
| [e2e/production-process-library-storage.spec.ts](../../../e2e/production-process-library-storage.spec.ts) | Playwright E2E | 正式工序库完整页面保存、独立进程冷重开、原键和旧版本保持一致 |
| [e2e/schedule-binding-central.spec.ts](../../../e2e/schedule-binding-central.spec.ts) | Playwright E2E | 暂估冻结差异、缺覆盖更正往返、取消与确认、绑定冷读及原楼层来源五档闭环 |
| [e2e/schedule-binding-overflow.spec.ts](../../../e2e/schedule-binding-overflow.spec.ts) | Playwright E2E | 组件读取夹具：四条稳定清单来源与完整长说明可键盘滚动并进入第四行 |
| [e2e/schedule-central.spec.ts](../../../e2e/schedule-central.spec.ts) | Playwright E2E | 中央合同三步建组、冻结历史、任务调整与基线在五档视口闭环 |
| [e2e/production-schedule-recovery.spec.ts](../../../e2e/production-schedule-recovery.spec.ts) | 生产 Playwright E2E | 隔离正式排程建组及合同绑定回执丢失、原编号核对、冻结计划和完成事实、独立进程冷恢复 |
| [e2e/schedule-process-library.spec.ts](../../../e2e/schedule-process-library.spec.ts) | Playwright E2E | 标准工序库版本维护与建组甘特 |
| [e2e/schedule-progress.spec.ts](../../../e2e/schedule-progress.spec.ts) | Playwright E2E | Issue #114：施工进度 WBS 排程 |
| [e2e/wbs-migration.spec.ts](../../../e2e/wbs-migration.spec.ts) | Playwright E2E | 完整旧 WBS 经真实 HTTP 接管，冻结绑定历史与冷读一致，重复确认保更正，独立新组阻止危险恢复 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/process-library-migration-source.ts](../../../e2e/helpers/process-library-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/schedule-binding-source.ts](../../../e2e/helpers/schedule-binding-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/wbs-migration-source.ts](../../../e2e/helpers/wbs-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/production-process-library-process.ts](../../../tests/helpers/production-process-library-process.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/production-process-library-server.ts](../../../tests/helpers/production-process-library-server.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/wbs-migration-source.ts](../../../tests/helpers/wbs-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/production-wbs-cold.ts](../../../tests/helpers/production-wbs-cold.ts) | 辅助／夹具 | WBS 原计划、原绑定与命令冷进程读取 |
| [tests/helpers/production-wbs-upstream-fixture.ts](../../../tests/helpers/production-wbs-upstream-fixture.ts) | 辅助／夹具 | 实际主合同、清单及工序库依赖夹具 |
