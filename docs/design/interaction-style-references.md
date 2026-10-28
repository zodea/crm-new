# 交互公开参考与采纳理由（历史索引）

本文保留早期选型用过的公开来源与采纳理由，属于**非权威历史参考**，不定义现行组件配方，也不代表红圈运行页面的现状。当前视觉分工见[设计入口](./README.md)，组件行为见 [KitUI 组件规格](./kit-ui-component-specs.md)；来源索引不要求重新选择整套风格或引入新依赖。

历史可视菜单：[六类交互参考 Artifact](https://claude.ai/code/artifact/2d65b7a8-ab04-4634-8d69-0d89b481c4de)。其中活泼圆润、玻璃拟态、炫技动效等探索未作为项目整体风格采用。

## 表单与抽屉：如何理解旧参考

旧“编辑项目使用右侧 Drawer”建议的理由与规则重绘已归 [DESIGN-SYSTEM 历史对照](../rewrite/DESIGN-SYSTEM.md#a01-history)；现行实体形态直接遵循 [ADR 0014](../adr/0014-full-page-entity-forms.md)，轻量弹窗、速览与通知例外直达 [KitUI §02 / §05](./kit-ui-component-specs.md)。本页只保留下列外部来源与当时采纳理由。

## 公开来源与历史取舍

### 页签与控件形状

曾采用连接工作区的 Chrome 式页签方向；旧造型与圆角方案已被 [ADR 0013](../adr/0013-align-all-ui-to-online-design.md) 替代。关闭、右键菜单、滚动与恢复行为查 [PUBLIC-SURFACES](../rewrite/PUBLIC-SURFACES.md)。

- [Google Chrome · 管理标签页](https://support.google.com/chrome/answer/2391819?hl=zh-Hans&co=GENIE.Platform%3DDesktop)：当时采用的激活标签与肩线来源。
- [Firefox · 标签页概览菜单](https://support.mozilla.org/zh-CN/kb/%E6%A0%87%E7%AD%BE%E9%A1%B5%E6%A6%82%E8%A7%88%E8%8F%9C%E5%8D%95)：浮动标签的未采用对照。
- [Fluent 2 · Shape](https://fluent2.microsoft.design/shapes)：形状层级参考，不沿用旧圆角数值。

### Toast

采用 Sonner 的克制消息与堆叠方向；底座选择见 [ADR 0008](../adr/0008-adopt-shadcn-vue-on-unocss.md)，双泳道及反馈查 [KitUI](./kit-ui-component-specs.md)，导出收尾按 [ADR 0004](../adr/0004-export-interaction-model.md)。

- [Sonner](https://sonner.emilkowal.ski/)：Action / Undo 与折叠展开堆叠的主要来源。
- [Vercel Geist · Toast](https://vercel.com/geist/toast)：撤回消息的文案与动作关系。
- [shadcn · Sonner](https://ui.shadcn.com/docs/components/radix/sonner)：位置与异步反馈。
- [HeroUI · Toast](https://heroui.com/docs/react/components/toast)：loading 到结果的状态过渡。
- [Mantine · Notifications](https://mantine.dev/x/notifications/)：队列上限及原地反馈的对照，不据此统一添加成功打勾。

### 项目切换器

采用 GitHub 型“当前上下文触发器 + 可搜索面板”，以同一入口覆盖不同项目数量；未采用最近使用分组、访问历史持久化、按数量切换皮肤、两级 scope 或侧栏常驻项目列表（会与业务域导航争夺层级）。现行结构见 [KitUI §08](./kit-ui-component-specs.md)。

- [GitHub · Repository switcher](https://github.blog/changelog/2026-06-18-repository-switcher-generally-available-in-global-navigation/) 与 [Primer SelectPanel](https://primer.style/product/components/select-panel/)：当前上下文可见、打开后搜索的主要来源。
- [GitLab · Search or go to](https://docs.gitlab.com/tutorials/left_sidebar/)：搜索和常访问项目的信息组织。
- [Jira · 切换项目与看板](https://support.atlassian.com/jira-software-cloud/docs/switch-between-projects-and-boards/)：Recent / Starred 的长列表降噪对照，未移植该分组。
- [Vercel · Team switcher](https://vercel.com/kb/guide/how-do-i-select-a-team-on-vercel)：单一 scope 触发器参考，未采用两级 scope。
- [Linear · Workspaces](https://linear.app/docs/workspaces)：当前 workspace 入口与快捷键思路。

### 确认弹窗

借鉴克制结构、异步状态和明确影响说明；打字确认、删除与撤回条件按 [ADR 0003](../adr/0003-confirm-dialog-deletion-model.md)，组件行为见 [KitUI §01](./kit-ui-component-specs.md)，不从参考站推导业务删除规则。

- [DesignRevision · Alert Dialog](https://designrevision.com/components/alert-dialog)：基础、破坏性、异步和打字确认变体的比较。
- [shadcn/ui · Alert Dialog](https://ui.shadcn.com/docs/components/radix/alert-dialog)：克制结构与破坏性动作表达。
- [Radix Themes · Alert Dialog](https://www.radix-ui.com/themes/docs/components/alert-dialog)：品牌色与危险操作色的关系。
- [Mantine · Modals manager](https://mantine.dev/x/modals/)：命令式调用与递进确认；浮层组合按 [ADR 0016](../adr/0016-overlay-composition-contract.md)。

### 轻量表单弹窗

借鉴白面板、字段滚动和焦点反馈；公开 CRUD 示例不决定瑞航实体形态。适用边界见 [ADR 0014](../adr/0014-full-page-entity-forms.md)，组件结构见 [KitUI §02](./kit-ui-component-specs.md)。

- [Mantine · Modal](https://mantine.dev/core/modal/)：内部焦点、尺寸与居中方式。
- [shadcn/ui · Dialog](https://ui.shadcn.com/docs/components/dialog)：字段滚动与固定操作区。
- [Vercel Geist · Modal](https://vercel.com/geist/modal)：打开后的焦点及提交反馈。
- [Flowbite · Modal](https://flowbite.com/docs/components/modal/)：CRUD 结构对照，未采用实体弹窗作为项目默认。

### 导出进度

借鉴 loading 载体、多阶段步骤与失败定位；裁定见 [ADR 0004](../adr/0004-export-interaction-model.md)，组件见 [KitUI §03](./kit-ui-component-specs.md)。不照搬 Sonner promise 的成功终态，以免重复反馈。

- [Sonner · Toast](https://sonner.emilkowal.ski/toast)：直接保存的 loading 载体。
- [Material UI · Stepper](https://mui.com/material-ui/react-stepper/)：多阶段骨架及已完成步骤。
- [Mantine · Progress](https://mantine.dev/core/progress/)：有可测进度时的平滑过渡。
- [PatternFly · Progress stepper](https://www.patternfly.org/components/progress-stepper/design-guidelines/)：完成、进行中、失败、警告与待处理状态。

### 导入映射

借鉴 Dromo 的克制布局、列映射与行预览，步骤参考 MUI；未采用 CSVbox 的饱和配色。流程见 [ADR 0005](../adr/0005-import-mapping-model.md)，组件见 [KitUI §04](./kit-ui-component-specs.md)。公开演示站不是业务资料处理入口；演示资料边界见 [ADR 0014 §9](../adr/0014-full-page-entity-forms.md#9-数据与实施纪律)。

- [Dromo · sandbox](https://demo.dromo.io)：列匹配、行内校验与预览布局。
- [CSVbox · Demo](https://csvbox.io/demo/)：字段映射与逐行校验的历史对照。
- [importcsv · Playground](https://docs.importcsv.com/playground)：字段规则配置与导入向导的并列观察。
- [Material UI · Stepper](https://mui.com/material-ui/react-stepper/)：多步流程及错误状态。

### 抽屉 Sheet

借鉴 shadcn-vue 结构和 Vaul 缓动；项目编辑抽屉、统一底部操作条和固定宽度不再作为要求。只读速览、通知专用例外及通用 API 延期边界见 [KitUI §05](./kit-ui-component-specs.md)，浮层组合按 [ADR 0016](../adr/0016-overlay-composition-contract.md)。

- [shadcn-vue · Sheet](https://www.shadcn-vue.com/docs/components/sheet)：与现有 Vue 底座相符的面板结构。
- [Vaul · Drawer](https://vaul.emilkowal.ski/)：把手、回弹与缓动的历史参考，不据此新增交互能力。
- [Mantine · Drawer](https://mantine.dev/core/drawer/)：方向、背板与多层组合的对照。
- [HeroUI · Drawer](https://heroui.com/docs/react/components/drawer)：玻璃背板仅作早期展示探索，未采用为项目方案；视觉裁定见 [ADR 0013](../adr/0013-align-all-ui-to-online-design.md)。

### 按钮反馈

借鉴 shadcn 的克制骨架与 loading 反馈，成功打勾保留为可选来源。适用条件、五变体和状态行为见 [KitUI §06](./kit-ui-component-specs.md)，不要求所有按钮经过成功动画。

- [shadcn/ui · Button](https://ui.shadcn.com/docs/components/radix/button)：spinner 与禁用态。
- [Aceternity · Stateful Button](https://ui.aceternity.com/components/stateful-button)：loading 到成功打勾的历史动效来源，不据此默认启用。
- [MUI · Button](https://mui.com/material-ui/react-button/)：锁宽、禁用与 spinner 位置。
- [Indie UI · Stateful Buttons](https://ui.indie-starter.dev/docs/stateful-buttons)：spinner / pulsing 的反馈对照。
