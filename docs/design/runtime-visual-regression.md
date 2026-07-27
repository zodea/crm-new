# 运行态视觉与交互回归

本入口落实 #184，用同一套 Playwright 测试守住响应式布局和跨页面公共交互。基线只记录瑞航 CRM 的本地演示数据，不得写入参考系统截图、真实业务数据或动态运行指标。视觉任务固定在 Windows Server 2022 / Chromium 环境，普通跨平台 E2E 不自动加载平台截图。

## 覆盖矩阵

[`e2e/runtime-visual-matrix.spec.ts`](../../e2e/runtime-visual-matrix.spec.ts) 在 390、768、1024、1440px 四档视口覆盖七类代表页面：

| 类型 | 代表路由 | 重点 |
|---|---|---|
| 应用壳 | `/` | 顶栏、侧栏与移动导航入口 |
| 列表 | `/project` | 工具栏、密集表格与分页 |
| 详情 | `/project/proj_demo_001` | 详情壳、页签与内容区 |
| 统一实体详情壳 | `/dev/detail-shell` | 长标题、指标、业务模块顺序、可选右栏及响应式退化 |
| 整页表单 | `/project/form` | 主操作可达与键盘顺序 |
| 复杂工作台 | `/subcontract/quantity` | 局部横向滚动与密集矩阵 |
| Dialog / Sheet | `/subcontract/quantity`、`/` | 浮层层级、Esc 关闭和焦点归还 |

公共断言集中在 [`e2e/helpers/responsive.ts`](../../e2e/helpers/responsive.ts)，包括页面级无横向溢出、密集区域局部滚动、主操作位于视口内、Tab 顺序、焦点归还和浮层高于应用壳。

## 运行与更新

```bash
pnpm test:visual
pnpm test:visual:update
```

专用配置 [`playwright.visual.config.ts`](../../playwright.visual.config.ts) 固定启动 `127.0.0.1:3101` 的全新本地服务，禁止复用已有服务、禁止 `PLAYWRIGHT_BASE_URL`，并要求页面报告 `demo` 数据档案。普通 [`playwright.config.ts`](../../playwright.config.ts) 排除视觉 spec，Windows CI 单独执行该任务。

只有确认界面变化符合当前 Issue、页面蓝本和设计权威链后才更新基线。更新后必须：

1. 人工抽查至少一个移动视口和一个桌面视口；
2. 再运行一次 `pnpm test:visual`，确认基线可重复；
3. 保留相关行为断言；截图通过不能替代键盘、焦点、滚动和浮层层级验证；
4. 在相同视口下人工同屏对照运行态参考或 `app.dc.html`，并把证据等级、差异和裁决记录到 [`runtime-reference-audit.md`](./runtime-reference-audit.md)；
5. 对照运行态参考时遵守该登记册的只读和脱敏边界。

时间、计数、演示业务文字等动态或内容敏感节点统一透明化，只隐藏文本而保留行高、边框、背景、控件轮廓与状态色；动画、光标和 Nuxt 调试浮层在测试初始化阶段关闭。后续页面切片应在本文件的七类模板中选择对应类型，并补一条该真实页面的稳定基线，不另建互不相通的截图体系。
