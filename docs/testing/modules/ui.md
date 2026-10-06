# 通用界面与交互

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

浏览器组件行为、jsdom 组件行为、E2E 和视觉基线分别列出。权限、交互、来源切换或竞态是否有有效断言，需要后续逐文件读取；不能因归到界面模块就一概删除。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/notifications/pending.test.ts](../../../tests/notifications/pending.test.ts) | 单元／服务／状态 | 通知最小原提交描述及恢复 |
| [tests/notifications/repository.test.ts](../../../tests/notifications/repository.test.ts) | 单元／服务／状态 | 全局通知HTTP契约与真实未知状态 |
| [tests/composables/useToast.test.ts](../../../tests/composables/useToast.test.ts) | 单元／服务／状态 | undo toast |
| [tests/kit/button.test.ts](../../../tests/kit/button.test.ts) | 单元／服务／状态 | kitButton 状态 |
| [tests/kit/confirm.test.ts](../../../tests/kit/confirm.test.ts) | 单元／服务／状态 | cascade 打字确认门控：matchesConfirmName |
| [tests/kit/edit-grid.test.ts](../../../tests/kit/edit-grid.test.ts) | 单元／服务／状态 | kit edit grid 纯逻辑 |
| [tests/kit/form-modal-validation.test.ts](../../../tests/kit/form-modal-validation.test.ts) | 单元／服务／状态 | formModal 必填校验：findMissingRequired |
| [tests/kit/kit-ui-preempt.test.ts](../../../tests/kit/kit-ui-preempt.test.ts) | 单元／服务／状态 | #86 KitUI 并发二次调用抢占 |
| [tests/kit/lookup.test.ts](../../../tests/kit/lookup.test.ts) | 单元／服务／状态 | lookup keyword highlighting |
| [tests/kit/money-link.test.ts](../../../tests/kit/money-link.test.ts) | 单元／服务／状态 | moneyLink 解析（specs §07：¥#,##0.00 + 0/空/无目标退化） |
| [tests/kit/table.test.ts](../../../tests/kit/table.test.ts) | 单元／服务／状态 | 列配置归一化:normalizeKitColumn |
| [tests/kit/tree-nav.test.ts](../../../tests/kit/tree-nav.test.ts) | 单元／服务／状态 | 节点计数聚合：resolveNodeCount |
| [tests/stores/notifications.test.ts](../../../tests/stores/notifications.test.ts) | 单元／服务／状态 | 通知中心 |

## 浏览器组件行为

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/browser/ResponsiveControls.test.ts](../../../tests/browser/ResponsiveControls.test.ts) | 真实浏览器组件 | 五档视口验证弹窗、搜索栏、项目工具栏与排程控件的宽度、局部滚动及操作可达性；共享 Dialog 默认关闭按钮通过真实 Tab/Shift+Tab 检查非 hover 的可见焦点及 Escape 返回入口 |
| [tests/browser/ContextHelp.test.ts](../../../tests/browser/ContextHelp.test.ts) | 浏览器组件行为 | 就近帮助的真实浏览器交互 |
| [tests/browser/KitMultiSelectFilter.test.ts](../../../tests/browser/KitMultiSelectFilter.test.ts) | 浏览器组件行为 | 多选筛选器的真实浏览器交互 |

## 视觉基线（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/detail-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/detail-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/detail-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/detail-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/detail-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/detail-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/detail-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/detail-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/detail-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/detail-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/entity-detail-shell-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/entity-detail-shell-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/entity-detail-shell-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/entity-detail-shell-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/entity-detail-shell-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/entity-detail-shell-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/entity-detail-shell-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/entity-detail-shell-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/entity-detail-shell-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/entity-detail-shell-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/form-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/form-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/form-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/form-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/form-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/form-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/form-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/form-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/form-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/form-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-default-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-default-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-default-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-default-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-default-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-default-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-default-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-default-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-default-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-default-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-empty-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-empty-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-empty-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-empty-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-empty-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-empty-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-empty-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-empty-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-empty-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-empty-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-error-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-error-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-error-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-error-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-error-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-error-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-error-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-error-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-error-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-error-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-loading-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-loading-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-loading-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-loading-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-loading-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-loading-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-loading-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-loading-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-loading-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-loading-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-partial-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-partial-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-partial-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-partial-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-partial-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-partial-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-partial-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-partial-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-partial-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/home-dashboard-partial-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/list-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/list-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/list-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/list-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/list-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/list-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/list-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/list-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/list-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/list-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/notification-sheet-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/notification-sheet-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/notification-sheet-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/notification-sheet-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/notification-sheet-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/notification-sheet-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/notification-sheet-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/notification-sheet-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/notification-sheet-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/notification-sheet-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/overlay-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/overlay-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/overlay-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/overlay-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/overlay-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/overlay-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/overlay-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/overlay-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/overlay-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/overlay-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/shell-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/shell-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/shell-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/shell-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/shell-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/shell-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/shell-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/shell-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/shell-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/shell-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/shell-stress-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/shell-stress-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/shell-stress-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/shell-stress-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/shell-stress-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/shell-stress-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/shell-stress-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/shell-stress-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/shell-stress-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/shell-stress-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/workspace-1024-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/workspace-1024-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/workspace-1280-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/workspace-1280-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/workspace-1440-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/workspace-1440-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/workspace-390-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/workspace-390-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |
| [e2e/runtime-visual-matrix.spec.ts-snapshots/workspace-768-chromium-win32.png](../../../e2e/runtime-visual-matrix.spec.ts-snapshots/workspace-768-chromium-win32.png) | 视觉基线 | 通用视觉矩阵截图 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/ConfirmDialog.test.ts](../../../tests/components/ConfirmDialog.test.ts) | 组件（jsdom） | confirmDialog public contract |
| [tests/components/ContextHelp.test.ts](../../../tests/components/ContextHelp.test.ts) | 组件（jsdom） | 就近帮助 |
| [tests/components/EntityDetailShell.test.ts](../../../tests/components/EntityDetailShell.test.ts) | 组件（jsdom） | entityDetailShell |
| [tests/components/EntityFormShell.test.ts](../../../tests/components/EntityFormShell.test.ts) | 组件（jsdom） | entityFormShell |
| [tests/components/FormFooter.test.ts](../../../tests/components/FormFooter.test.ts) | 组件（jsdom） | formFooter public behavior |
| [tests/components/KitButton.test.ts](../../../tests/components/KitButton.test.ts) | 组件（jsdom） | kitButton public contract |
| [tests/components/KitColumnHeader.test.ts](../../../tests/components/KitColumnHeader.test.ts) | 组件（jsdom） | 可操作表头 |
| [tests/components/KitEditGrid.test.ts](../../../tests/components/KitEditGrid.test.ts) | 组件（jsdom） | kit edit grid |
| [tests/components/KitFormModal.test.ts](../../../tests/components/KitFormModal.test.ts) | 组件（jsdom） | kitFormModal public contract |
| [tests/components/KitMultiSelectFilter.test.ts](../../../tests/components/KitMultiSelectFilter.test.ts) | 组件（jsdom） | 列表多选筛选器 |
| [tests/components/KitTableReturnView.test.ts](../../../tests/components/KitTableReturnView.test.ts) | 组件（jsdom） | kitTable 来源视图恢复公共契约 |
| [tests/components/KitTableVisualStates.test.ts](../../../tests/components/KitTableVisualStates.test.ts) | 组件（jsdom） | kitTable visual states |
| [tests/components/KitTypeSelectDialog.test.ts](../../../tests/components/KitTypeSelectDialog.test.ts) | 组件（jsdom） | kitTypeSelectDialog public contract |
| [tests/components/KitUIHost.type-select.test.ts](../../../tests/components/KitUIHost.type-select.test.ts) | 组件（jsdom） | kitUIHost typeSelect integration |
| [tests/components/ListFilterBar.test.ts](../../../tests/components/ListFilterBar.test.ts) | 组件（jsdom） | 列表筛选栏 |
| [tests/components/ListShell.test.ts](../../../tests/components/ListShell.test.ts) | 组件（jsdom） | list shell |
| [tests/components/LookupSelect.test.ts](../../../tests/components/LookupSelect.test.ts) | 组件（jsdom） | lookupSelect public behavior |
| [tests/components/RowActionMenu.test.ts](../../../tests/components/RowActionMenu.test.ts) | 组件（jsdom） | row action menu |
| [tests/components/StatePanel.test.ts](../../../tests/components/StatePanel.test.ts) | 组件（jsdom） | statePanel |
| [tests/components/UiAtoms.test.ts](../../../tests/components/UiAtoms.test.ts) | 组件（jsdom） | ui atom public contracts |

## Playwright 视觉矩阵

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/runtime-visual-matrix.spec.ts](../../../e2e/runtime-visual-matrix.spec.ts) | Playwright 视觉矩阵 | 14 个运行样态 × 390/768/1024/1280/1440px；普通截图记录中性鼠标与焦点状态，表单保留自身 autofocus、浮层保留真实焦点；独立 Windows/Chromium 演示配置校验 origin/data-profile，矩阵及责任配置经隔离中央会话的正式命令回执准备；两组表单名称的键盘主操作、矩阵局部滚动及弹层 Esc 返回焦点分别参数化 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/form-footer.spec.ts](../../../e2e/form-footer.spec.ts) | Playwright E2E | FormFooter 表单保存动作组 |
| [e2e/issue-110-reference-density.spec.ts](../../../e2e/issue-110-reference-density.spec.ts) | Playwright E2E | Issues #110/#183 reference density and token contract |
| [e2e/issue-168-overlay-contract.spec.ts](../../../e2e/issue-168-overlay-contract.spec.ts) | Playwright E2E | Issue #168：浮层组合契约扩展底座 |
| [e2e/issue-170-dialog-layering.spec.ts](../../../e2e/issue-170-dialog-layering.spec.ts) | Playwright E2E | Issue #170：Dialog 子浮层与嵌套确认 |
| [e2e/issue-171-sheet-project-switcher.spec.ts](../../../e2e/issue-171-sheet-project-switcher.spec.ts) | Playwright E2E | Issue #171：Sheet、通知抽屉与项目切换器 |
| [e2e/issue-172-overlay-contract.spec.ts](../../../e2e/issue-172-overlay-contract.spec.ts) | Playwright E2E | Issue #172：全局浮层契约收缩 |
| [e2e/issue-185-page-states.spec.ts](../../../e2e/issue-185-page-states.spec.ts) | Playwright E2E | Issue #185：项目页面状态与恢复旅程 |
| [e2e/issue-186-detail-shell.spec.ts](../../../e2e/issue-186-detail-shell.spec.ts) | Playwright E2E | Issue #186：统一实体详情壳 |
| [e2e/issue-187-form-shell.spec.ts](../../../e2e/issue-187-form-shell.spec.ts) | Playwright E2E | Issue #187：统一整页表单壳 |
| [e2e/kit-button.spec.ts](../../../e2e/kit-button.spec.ts) | Playwright E2E | KitButton 三态原语 |
| [e2e/kit-table-responsive.spec.ts](../../../e2e/kit-table-responsive.spec.ts) | Playwright E2E | KitTable 公共表格规格 |
| [e2e/kit-type-select.spec.ts](../../../e2e/kit-type-select.spec.ts) | Playwright E2E | KitUI typeSelect：8 类付款申请、键盘确定与取消返回值 |
| [e2e/kit-ui-keyboard.spec.ts](../../../e2e/kit-ui-keyboard.spec.ts) | Playwright E2E | KitUI real-browser keyboard contracts |
| [e2e/kit-ui-motion.spec.ts](../../../e2e/kit-ui-motion.spec.ts) | Playwright E2E | KitUI 浮层几何稳定性 |
| [e2e/lookup-select.spec.ts](../../../e2e/lookup-select.spec.ts) | Playwright E2E | LookupSelect 检索下拉原语 |
| [e2e/responsive-primitives.spec.ts](../../../e2e/responsive-primitives.spec.ts) | Playwright E2E | Issue #112 R1：共享响应式原语 |
