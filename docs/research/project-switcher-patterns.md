# 项目切换器公开产品模式比较

> 非权威历史调研，取证于 2026-07-22；以下只保留第一方资料和当时模式比较，不声称产品今日状态。已采纳方向及 2026-07-28 不使用最近分组的决定统一见 [KitUI §08](../design/kit-ui-component-specs.md#08--项目切换器-project-switcher--已定案2026-07-22)，本文件不复制组件字段、键盘、响应式和保存规则。

调查认为当前上下文可见性与可搜索长列表能兼顾不同项目数量；常驻项目侧栏、两级工作域、访问历史分组和按数量切换皮肤各有额外状态或空间成本。此处保存取舍理由，不从参考产品扩张瑞航身份、权限或数据能力。

## 公开参考菜单

### 1. GitHub：当前仓库触发器 + 可搜索锚定面板

- [GitHub 官方更新：Repository switcher](https://github.blog/changelog/2026-06-18-repository-switcher-generally-available-in-global-navigation/)
- [GitHub Primer：SelectPanel](https://primer.style/product/components/select-panel/)
- [Primer：SelectPanel 窄屏迁移规范](https://primer.style/product/getting-started/react/migration-guides/primer-experimental-selectpanel/)

真实形态：仓库名位于导航面包屑中，点击其后的 chevron 打开 Dialog；用户可在当前 organization/owner namespace 中搜索并选择其他仓库。GitHub 明确把它用于需要跨许多仓库工作的场景。

- **信息密度**：头部只保留当前上下文名称和展开标记，列表不常驻占宽。
- **可扩展性**：SelectPanel 支持过滤、分组、滚动容器、动态加载；Primer 对超过 100 项的列表建议虚拟化。
- **键盘/搜索**：过滤输入是组件结构的一部分；组件定义了键盘打开、Escape、选择关闭和焦点循环行为。
- **窄屏**：Primer 明确支持把同一个 SelectPanel 转为全屏面板；信息结构无需改写。

**适配判断：最适合瑞航 CRM。** 项目与仓库一样，都是“当前页面工作的全局上下文”；数量变化不应改变头部骨架。

### 2. GitLab：全局 `Search or go to` 命令式切换

- [GitLab 官方界面导航教程](https://docs.gitlab.com/tutorials/left_sidebar/)
- [GitLab 官方搜索说明](https://docs.gitlab.com/user/search/)
- [GitLab 官方键盘快捷键](https://docs.gitlab.com/user/shortcuts/)

真实形态：顶栏只有一个 `Search or go to` 入口；打开后先列出常访问项目，也可输入冒号加项目名定向查找。选中项目后，左侧栏切换为该项目的专属导航。

- **信息密度**：头部极省空间，一个入口可覆盖项目、组和其他全局对象。
- **可扩展性**：搜索优先，适合项目数量很大、层级较深的系统。
- **键盘/搜索**：官方提供搜索聚焦与项目/组跳转快捷键；熟练用户效率高。
- **窄屏**：官方资料未单独承诺项目切换面板的手机形态，不能把桌面行为直接推断为移动规范。

**适配判断：适合作为全局快速跳转的第二入口，不适合单独替代可见的当前项目触发器。** CRM 用户需要持续知道“当前在操作哪个项目”，纯命令入口的上下文可见性不足。

### 3. Jira：侧栏常驻项目 + Recent/Starred

- [Jira 官方：切换 spaces 与 boards](https://support.atlassian.com/jira-software-cloud/docs/switch-between-projects-and-boards/)
- [Jira 官方：新旧导航中的项目位置](https://support.atlassian.com/navigation/docs/old-vs-new-navigation-in-jira/)
- [Jira 官方：项目 picker 在大量项目下的行为](https://support.atlassian.com/jira/kb/while-creating-an-issue-project-field-not-showing-all-the-projects-available/)

真实形态：Jira 新导航把项目从顶栏下拉迁到侧栏，让项目保持可见；常用路径依赖 Recent、Starred 和查看全部。项目 picker 在大量项目时只预显最近项目和少量其他项目，完整集合通过输入名称或 key 搜索。

- **信息密度**：利用纵向空间，常用项目扫描速度快，但会持续占用侧栏面积。
- **可扩展性**：Recent/Starred 降低长列表噪音；搜索负责命中未预显的项目。
- **键盘/搜索**：项目 picker 支持输入项目名或 key；新导航也有全局搜索能力。
- **窄屏**：侧栏可折叠，但项目切换在手机端的具体浮层行为未在上述资料中明确说明。

**适配判断：借用信息分组，不照搬常驻项目侧栏。** 瑞航 CRM 已有按业务域组织的主侧栏，再塞入项目列表会把“业务导航”和“当前项目上下文”混在一起。

### 4. Vercel：顶栏团队 scope 切换器 + 项目层级

- [Vercel 官方：选择团队](https://vercel.com/kb/guide/how-do-i-select-a-team-on-vercel)
- [Vercel 官方：账户与 Team switcher](https://vercel.com/docs/accounts)
- [Vercel 官方：管理项目](https://vercel.com/docs/projects/managing-projects)

真实形态：顶栏左侧 Select 用于切换 team scope，进入团队后再选择项目。它把“组织”和“项目”分成两级上下文，避免全部对象混进同一列表。

- **信息密度**：头部只显示当前 scope，层级关系清晰。
- **可扩展性**：适合一个账号同时属于多个团队、每个团队又有许多项目的 SaaS。
- **键盘/搜索**：官方网页资料没有明确披露 dashboard switcher 的键盘搜索行为；CLI 的 `vercel switch` 不能当作网页交互依据。
- **窄屏**：团队切换本身的手机面板细节未在上述资料中明确说明。

**适配判断：当前不采用两级切换。** 只有未来 CRM 确实出现“公司/项目”两级工作域且两者都需要频繁切换时才值得引入；现在使用会平白增加一层概念。

### 5. Linear：左上 workspace 下拉 + 快捷键/命令菜单

- [Linear 官方：Workspaces](https://linear.app/docs/workspaces)
- [Linear 官方：概念模型与命令菜单](https://linear.app/docs/conceptual-model)
- [Linear 官方：搜索](https://linear.app/docs/search)

真实形态：左上角始终显示当前 workspace，展开后切换其他 workspace；`O` 后按 `W` 可打开 workspace 切换。Linear 同时用命令菜单和搜索提供键盘入口。

- **信息密度**：单一触发器非常紧凑，当前上下文始终可见。
- **可扩展性**：适合少量相互独立的 workspace；Linear 官方本身建议一个组织尽量保持单 workspace。
- **键盘/搜索**：快捷键和命令菜单路径清晰，熟练用户切换成本低。
- **窄屏**：官方资料未承诺桌面左上 workspace 下拉在手机端保持同一外观。

**适配判断：可借用“单一当前上下文入口”和快捷键理念，但项目数量与使用频率更接近 GitHub 仓库，不应只做无搜索的简单菜单。**

## 模式对比

| 模式 | 头部占用 | 3 个项目 | 12+ 项目 | 搜索/键盘 | 窄屏 | 瑞航 CRM 结论 |
|---|---:|---:|---:|---|---|---|
| 横向按钮/分段控件 | 随项目数增长 | 很直观 | 很快溢出 | 通常无搜索 | 需滚动或另造下拉 | 不采用 |
| GitHub 可搜索 SelectPanel | 固定 | 一次展开 | 很强，100+ 可虚拟化 | 搜索、完整焦点闭环 | 同组件全屏化 | **主推荐** |
| GitLab 全局命令搜索 | 固定且最小 | 略重 | 极强 | 最强 | 官方未明确项目面板形态 | 只作补充入口 |
| Jira 侧栏 Recent/Starred | 持续占纵向空间 | 很快 | 强，搜索兜底 | 支持搜索 | 侧栏可折叠 | 只借分组逻辑 |
| Vercel 两级 scope | 固定 | 清晰 | 强 | 网页键盘证据不足 | 官方未明确切换面板形态 | 暂不引入两级结构 |
| Linear workspace 菜单 | 固定 | 很快 | 中等 | 快捷键/命令菜单 | 官方未承诺同外观 | 借单一入口理念 |
