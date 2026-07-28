# 运行态视觉与交互回归

本入口落实 #184，用同一套 Playwright 测试守住响应式布局和跨页面公共交互。基线只记录瑞航 CRM 的本地演示数据，不得写入参考系统截图、真实业务数据或动态运行指标。

## 覆盖矩阵

[`e2e/runtime-visual-matrix.spec.ts`](../../e2e/runtime-visual-matrix.spec.ts) 在 390、768、1024、1440px 四档视口覆盖六类代表页面：

| 类型 | 代表路由 | 重点 |
|---|---|---|
| 应用壳 | `/` | 顶栏、侧栏与移动导航入口 |
| 列表 | `/project` | 工具栏、密集表格与分页 |
| 详情 | `/project/proj_demo_001` | 详情壳、页签与内容区 |
| 整页表单 | `/project/form` | 主操作可达与键盘顺序 |
| 复杂工作台 | `/subcontract/quantity` | 局部横向滚动与密集矩阵 |
| Dialog / Sheet | `/subcontract/quantity`、`/` | 浮层层级、Esc 关闭和焦点归还 |

公共断言集中在 [`e2e/helpers/responsive.ts`](../../e2e/helpers/responsive.ts)，包括页面级无横向溢出、密集区域局部滚动、主操作位于视口内、Tab 顺序、焦点归还和浮层高于应用壳。

## 运行与更新

```bash
pnpm test:visual
pnpm test:visual:update
```

只有确认界面变化符合当前 Issue、页面蓝本和设计权威链后才更新基线。更新后必须：

1. 人工抽查至少一个移动视口和一个桌面视口；
2. 再运行一次 `pnpm test:visual`，确认基线可重复；
3. 保留相关行为断言；截图通过不能替代键盘、焦点、滚动和浮层层级验证；
4. 对照运行态参考时遵守 [`runtime-reference-audit.md`](./runtime-reference-audit.md) 的只读和脱敏边界。

时间、计数、演示业务行等动态或内容敏感区域统一使用 Playwright mask；动画、光标和 Nuxt 调试浮层在测试初始化阶段关闭。后续页面切片应在本文件的六类模板中选择对应类型，并补一条该真实页面的稳定基线，不另建互不相通的截图体系。
