# 采纳 shadcn-vue（reka-ui + UnoCSS 桥接），退役自研 KitUI

> 状态：已采纳（2026-07-05）
> 影响：`app/composables/useKitUI.ts`、`app/components/shared/KitUIHost.vue` 及其子件、`app/components/ui/*`、`docs/design/kit-ui-component-specs.md`、`docs/design/interaction-style-references.md`、`CONTEXT.md`「原语（KitUI 原语）」定义、ADR 0003（confirm 承载技术改述）。

## 背景

交互原语（confirm / formModal / toast）与原子组件（`app/components/ui/*`）此前是**从 DC 设计稿逐个手写平移**的自研实现（`window.KitUI` → `useKitUI()` + 单宿主 `KitUIHost`）。自研有两个实打实的代价：

1. **难维护**：无障碍、键盘导航、焦点陷阱、`aria-*`、滚动锁、层级管理、边缘交互（打字确认、预提交挂起、hover 暂停）全得自己写自己修，出问题定位成本高。
2. **优化考虑不全**：焦点返回、`Esc`/遮罩点击、`inert`、屏幕阅读器、RTL、reduced-motion 等大量细节，自研版本零散且不完整。

这些正是「自研组件库」的长期负担。业界成熟方案（shadcn-vue，底层 reka-ui = 前 Radix Vue）已把这些"脏活"做对并经 shadcn-vue / Nuxt UI 大规模验证，且社区文档、LLM 训练充分——AI 辅助维护也更省力。

## 决策

**用 shadcn-vue 取代自研 KitUI**，但**不引入 Tailwind CSS 引擎**——本项目样式栈是 UnoCSS，保留不变。做法：

1. **逻辑底座**：安装 `reka-ui`（无头原语）+ `class-variance-authority`（变体）+ `clsx`（class 拼接）。**不装 `tailwindcss`、不装 `tailwind-merge`、不装 `tailwindcss-animate`。**
2. **样式底座仍是 UnoCSS `presetWind3`**：它提供 Tailwind 兼容原子类，shadcn 组件源码里的 `bg-primary`/`px-4` 等能被 UnoCSS 直接编译。
3. **令牌桥接（纯 UnoCSS，零新依赖）**：在 `tokens.css` 定义 shadcn 语义变量（`--background/--foreground/--primary/--secondary/--muted/--accent/--destructive/--border/--input/--ring/--card/--popover/--radius`），值指向**现有设计令牌**（`--brand/--panel/--line/--ink/--radius-btn`…）。改品牌色仍只改 `--brand`，语义变量自动跟随。用**完整色值约定**（`var(--x)`）而非 shadcn 默认的 `hsl(三元组)`，从而复用现有 hex 令牌、不重做已定的原子样式。在 `uno.config.ts` 的 `theme.colors` 注册这些语义色名 + `borderRadius` 阶梯（`lg/md/sm/xl`）。
4. **进出动画（tailwindcss-animate 的 UnoCSS 原生移植）**：在 `uno.config.ts` 用 `rules` 注册 `animate-in/animate-out/fade-*/zoom-*/slide-*`，`keyframes` 放 `preflights`；时长/缓动接 `--dur-dialog`/`--ease-snappy`。注册为 rules（而非静态 CSS）是为了让 `data-[state=open]:animate-in` 这类变体能被 UnoCSS 识别生成。
5. **`cn()` 用 clsx 单跑，不用 tailwind-merge**：样式覆盖走 cva 变体属性，而非 class 字符串对冲——避免运行时字符串魔法，冲突在 variant 层解决。
6. **组件源码纳入仓库**（shadcn「你拥有源码」模式），落在 `app/components/ui/<name>/`；`useKitUI()` 保留为**薄封装**，`confirm/formModal/toast/promise/undoToast` 调用签名不变，业务页面无感迁移。
7. **保留既定视觉**：v5 品牌/状态色、圆角卡片风（ADR 0007）、confirm 三档模型与撤回时长（ADR 0003）不变——把已定的原子态效果接进 shadcn，不重起炉灶。shadcn/reka-ui **默认观感与设计稿冲突时，一律以设计稿为准定制或替换**（[ADR 0013](0013-align-all-ui-to-online-design.md) 框架组件替换原则）。

## 考虑过的替代

- **@vuetify/v0**：同类无头框架，但 2026-07 仍是 RC、多数 API 为 Preview、案例极少、LLM 不熟——「难维护」风险反而更高，观望至 v1.0（Q3 2026）。
- **维持自研 KitUI**：即本 ADR 要解决的问题，否决。
- **上 Tailwind 引擎跑标准 shadcn-vue**：与现有 UnoCSS 栈冲突、要维护两套令牌、失去 UnoCSS 的动态性与既有 shortcuts，否决。
- **引 `unocss-preset-shadcn` 预设**：能自动对齐 shadcn 约定并保 CLI 可用，但它用 hsl 三元组令牌格式、需重写现有 hex 令牌，且多一个依赖；当前 pnpm 安装在本机有抖动，故选零依赖手写桥接，更可控。后续若要 `shadcn-vue add` CLI 便利可再评估。

## 后果

- `docs/design/kit-ui-component-specs.md` 等规格文档的"照着手写"承载改述为"基于 shadcn-vue + reka-ui 的桥接实现"；结构锚点、变体、令牌、行为规则仍有效（那是设计语言，与实现无关）。
- `CONTEXT.md` / `CLAUDE.md` 中 `window.KitUI` 表述需更新为 shadcn 底座 + `useKitUI` 薄封装。
- `/dev/kit-ui` 改为 shadcn 组件验证台。
- 当时的迁移映射见[历史映射材料](../research/kitui-to-shadcn-migration.md)，仅作非权威参考；当前 API 与实现边界以 [KitUI 组件规格](../design/kit-ui-component-specs.md)为准。
- 桥接已离线验证：UnoCSS 生成器对语义色、圆角阶梯、`data-[state]` 动画变体均产出正确 CSS，无 Tailwind 引擎。
