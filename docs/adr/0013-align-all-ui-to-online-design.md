# 全站界面基准统一为线上设计稿（含应用外壳）

> 状态：已采纳（2026-07-17）
> 来源：用户指令（2026-07-17）——「所有开发界面布局，统一按线上 claude.ai/design『瑞航CRM-NEW』`app.dc.html` 的布局排版、颜色统一；框架组件不符则替换」。
> 取代：[ADR 0011](0011-redesign-application-shell.md) 的**视觉与布局**条款（其行为能力条款保留，见下）。

## 背景

ADR 0011（issue #82）将应用外壳定为「深蓝侧栏 `#162238` + 54px 顶栏 + 36px Chrome 式页签」，并声明外壳不在设计稿对照范围内（DESIGN-TASTE §8.1「有意分叉」）。此后线上 Claude Design 一直是用户视觉验收的满意基准，外壳与内容区双轨基准造成「线上满意、本地有出入」的长期观感割裂。用户现明确：**全站（含外壳）统一按线上设计稿对齐，不再保留外壳分叉。**

## 决策

**唯一视觉/布局权威源** = 线上 Claude Design「瑞航CRM-NEW」的 `app.dc.html`，仓库镜像 `DC重构设计源码/app.dc.html`（+ `kit/*.jsx` 各屏、`_ds/.../tokens/*.css` 令牌）。布局、排版、尺寸、颜色一律以镜像实测为准；本 ADR 摘录关键规格便于施工，与镜像不符时**以镜像为准并同轮更新本文**。

### 外壳规格（实测自 app.dc.html）

- **侧栏**：fixed 左侧，展开 248px / 收起 68px（0.18s ease 过渡）；**白底 `--panel` + 右缘 `1px --line`**（不再深蓝、不再毛玻璃）；padding 展开 `16px 12px`、收起 `16px 8px`。
  - 品牌头：36×36 `--brand` 圆角 8px 方块「瑞」白字 16/800 + 标题「瑞航 CRM」16/800 + 副标「工程财务管理」11 `--ink-soft`。
  - 导航项（NavItem）：**中文单字方块 mark**（26–28px、圆角 7–8px、`--surface-3` 底 `1px --line` 边、13–14/800）+ 名称 13/600 + hint 副提示；active = `--brand-soft` 底、mark 转 `--brand`。
  - 分组：组头 12/800 字距 0.05em `--ink-soft` + 15px Lucide 图标 + chevron 折叠；组内左侧 `1px --line` 缩进线（`padding-left:8px; margin-left:8px`）。
  - 收起态：40×40 单字方块按钮居中排列，active `--brand-soft` 底 + `rgba(57,118,198,.25)` 边。
  - 底部：`1px --line` 分隔 + 「收起侧栏」按钮（`--surface-2` 底 12/700）+ 11px 版本注两行。
  - 导航结构 = 设计稿 NAV 锁定版 10 组约 30 实体（首页 / 项目信息 / 主合同管理 / 分包及人工 / 乙供材管理 / 甲供材管理 / 资金管理 / 项目其他合同 / 基础信息 / 设置），未实装项灰显「待建」徽标。
- **顶栏**：sticky 64px，`rgba(255,255,255,.96)` + `backdrop-filter: blur(8px)`，下缘 `1px --line`，padding `0 24px`；左侧**页标题 18/800 + 页副标 12 `--ink-soft`**（随当前路由变化），右侧日期 12 `--ink-soft`。
- **页签栏（红圈式）**：sticky 于顶栏下，40px，`--surface-2` 底 + 下缘 `1px --line`，padding `0 16px`，横向可滚（隐藏滚动条）；页签 13/600 `--ink-soft`、上圆角 `6px 6px 0 0`、max-width 200px；hover `--ink` + `rgba(17,24,39,.05)` 底；**active = `--panel` 白底 + `--brand` 字 800 + `inset 0 -2px 0 --brand` 下划线**；关闭钮 16×16 hover `--danger-soft`/`--danger-ink`。
- **内容区**：`padding: 20px 24px 36px`，仅内容区滚动（`flex:1; min-width:0; overflow-y:auto`）。

### 保留自 ADR 0011 的行为能力（不受本 ADR 影响）

路由驱动页签 + 纯状态机权威（右键四类关闭、刷新只失效当前实例、最多 15 个业务页签、关闭同步清缓存）；通知中心右侧抽屉与 Pinia store；侧栏固定/分组展开状态持久化；<1024px 侧栏转 reka-ui Sheet；导航搜索。**行为底座继续遵循 ADR 0008（reka-ui）/ ADR 0009（vxe-table）。**

### 框架组件替换原则

框架/库组件（shadcn-vue、reka-ui、vxe-table、vue-sonner 等）的**默认观感与设计稿冲突时，一律以设计稿为准**：优先通过令牌桥接与变体定制对齐（如 #109 五变体、#110 Panel）；定制无法达成时替换实现（自绘或换件），交互可达性（焦点/键盘/aria）不得回退。**不允许**「以框架默认样式为由」偏离设计稿。

### 颜色与排版

内容区令牌唯一权威源不变：`DC重构设计源码/_ds/.../tokens/content-v5.css`（`app/assets/css/tokens.css` 首行 @import 引入）。外壳弃用深蓝 `--shell-*` 色值组，改为直接消费设计稿同款令牌（`--panel`/`--line`/`--surface-2`/`--brand-soft`…）；`--shell-*` 桥接层保留变量名但重新映射到浅色值，避免大范围改组件引用。正文基准 14px、控件阶 13px（ADR 0007 勘误注 + #110 阶段③）。

## 后果

- DESIGN-TASTE §8.1「有意分叉」表中**外壳行作废**——外壳纳入逐屏对照范围，对照基准同内容区。
- ADR 0011 视觉条款（深蓝侧栏 / 54px 顶栏 / 36px Chrome 页签 / 14px 外壳字号）作废，该文已打标注；`docs/rewrite/DESIGN-SYSTEM.md`「单字方块+毛玻璃侧栏已废弃」横幅改写——**白底单字方块侧栏按本 ADR 回归**（毛玻璃侧栏仍废弃；顶栏 blur(8px) 为设计稿本身规格，属例外）。
- 实施拆分：外壳重构（侧栏/顶栏/页签视觉迁移）+ 全站布局逐屏对照（#110 阶段④-⑥ 继续），转 issue 跟踪。
- `tokens.css` 的 `--shell-*` 深蓝值、`--header-h: 54px`、`--tabbar-h: 36px` 等随实施轮更新。
