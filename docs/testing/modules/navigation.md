# 导航、页签与恢复

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/util/entity-reference.test.ts](../../../tests/util/entity-reference.test.ts) | 单元／服务／状态 | 稳定目标、来源与不可访问关系 |
| [tests/kit/entity-link.test.ts](../../../tests/kit/entity-link.test.ts) | 单元／服务／状态 | entityLink 解析（specs §07：type→route 唯一映射 + 退化不做死链） |
| [tests/kit/workflow-tab.test.ts](../../../tests/kit/workflow-tab.test.ts) | 单元／服务／状态 | 预占式工作流页签（导出/导入共用） |
| [tests/nav/nav-tree.test.ts](../../../tests/nav/nav-tree.test.ts) | 单元／服务／状态 | 侧栏导航树 |
| [tests/nav/return-to.test.ts](../../../tests/nav/return-to.test.ts) | 单元／服务／状态 | project returnTo contract |
| [tests/nav/target-registry.test.ts](../../../tests/nav/target-registry.test.ts) | 单元／服务／状态 | 唯一 Target Registry |
| [tests/stores/tab-session.test.ts](../../../tests/stores/tab-session.test.ts) | 单元／服务／状态 | 浏览器页签按需验证；迁入页仅凭同身份原命令编号恢复，不缓存正文，不借其他 actor、来源或命令族授予恢复资格 |
| [tests/stores/tabs.test.ts](../../../tests/stores/tabs.test.ts) | 单元／服务／状态 | 页签缓存失效 |
| [tests/tabs/navigation-intent.test.ts](../../../tests/tabs/navigation-intent.test.ts) | 单元／服务／状态 | 普通业务导航与旧页签恢复意图 |
| [tests/tabs/page-cache.test.ts](../../../tests/tabs/page-cache.test.ts) | 单元／服务／状态 | 页签页面缓存身份 |
| [tests/tabs/restore-deadline.test.ts](../../../tests/tabs/restore-deadline.test.ts) | 单元／服务／状态 | 恢复等待边界 |
| [tests/tabs/restore-session.test.ts](../../../tests/tabs/restore-session.test.ts) | 单元／服务／状态 | 页签恢复按需校验与安全回退 |
| [tests/tabs/restore-target.test.ts](../../../tests/tabs/restore-target.test.ts) | 单元／服务／状态 | 页签恢复目标、身份与来源白名单；仅工资恢复加载其读取模块，加载期间取消不读取事实 |
| [tests/tabs/session-persistence.test.ts](../../../tests/tabs/session-persistence.test.ts) | 单元／服务／状态 | 浏览器页签描述持久化 |
| [tests/tabs/startup-order.test.ts](../../../tests/tabs/startup-order.test.ts) | 单元／服务／状态 | nuxt 初始导航与页签恢复顺序 |
| [tests/tabs/tab-machine.test.ts](../../../tests/tabs/tab-machine.test.ts) | 单元／服务／状态 | 初始态 |
| [tests/tabs/tab-title.test.ts](../../../tests/tabs/tab-title.test.ts) | 单元／服务／状态 | 导出配置页签文案 |
| [tests/tabs/use-tab-title.test.ts](../../../tests/tabs/use-tab-title.test.ts) | 单元／服务／状态 | useTabTitle：动态标题回填 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/EntityReferenceLinks.test.ts](../../../tests/components/EntityReferenceLinks.test.ts) | 组件（jsdom） | 相关实体链接与不可访问反馈 |
| [tests/components/EntityLink.test.ts](../../../tests/components/EntityLink.test.ts) | 组件（jsdom） | entity link Target Registry 展示 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/issue-188-shell.spec.ts](../../../e2e/issue-188-shell.spec.ts) | Playwright E2E | Issue #188：导航搜索与页签溢出均可由键盘可达控件操作 |
| [e2e/issue-398-audit-form-tabs.spec.ts](../../../e2e/issue-398-audit-form-tabs.spec.ts) | Playwright E2E | 关联项目：草稿页签关闭／刷新保护 |
| [e2e/shell-visual.spec.ts](../../../e2e/shell-visual.spec.ts) | Playwright E2E | Issue #419：外壳保持深色侧栏与清晰可读的全站导航尺寸 |
| [e2e/sidebar-accordion.spec.ts](../../../e2e/sidebar-accordion.spec.ts) | Playwright E2E | 侧栏一级目录单开模式 |
| [e2e/tab-session-restore.spec.ts](../../../e2e/tab-session-restore.spec.ts) | Playwright E2E | 初始导航完成后才恢复活动页，刷新与关闭保留正确集合 |
| [e2e/tabs-smoke.spec.ts](../../../e2e/tabs-smoke.spec.ts) | Playwright E2E | 页签完整旅程：打开、切换、右键关闭并触发上限提示 |
