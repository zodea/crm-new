# 首页与看板

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/home/dashboard.test.ts](../../../tests/home/dashboard.test.ts) | 单元／服务／状态 | 首页驾驶舱状态规则 |
| [tests/home/project-source.test.ts](../../../tests/home/project-source.test.ts) | 单元／服务／状态 | 首页项目中央来源 |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/HomeDashboardSurface.test.ts](../../../tests/components/HomeDashboardSurface.test.ts) | 组件（jsdom） | homeDashboardSurface |
| [tests/components/HomeProjectSourceNavigation.test.ts](../../../tests/components/HomeProjectSourceNavigation.test.ts) | 组件（jsdom） | 首页中央项目与施工进度来源导航 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/home-schedule.spec.ts](../../../e2e/home-schedule.spec.ts) | Playwright E2E | 关联进度／工程量：首页项目上下文与下钻返回 |
| [e2e/issue-189-home-dashboard.spec.ts](../../../e2e/issue-189-home-dashboard.spec.ts) | Playwright E2E | Issue #189：首页默认工作台只展示真实排程并保持项目、分组与下钻入口可达 |
| [e2e/issue-434-home-project-source.spec.ts](../../../e2e/issue-434-home-project-source.spec.ts) | Playwright E2E | ${width}px 中央新项目进入首页，缺源只读查看并返回同一身份 |
