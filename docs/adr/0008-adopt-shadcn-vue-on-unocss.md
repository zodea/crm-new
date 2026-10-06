# 采纳 shadcn-vue（reka-ui + UnoCSS 桥接），退役自研 KitUI

> 状态：已采纳（2026-07-05）
> 影响：`app/composables/useKitUI.ts`、`app/components/shared/KitUIHost.vue` 及其子件、`app/components/ui/*`、`docs/design/kit-ui-component-specs.md`、`docs/design/interaction-style-references.md`、ADR 0003（confirm 承载技术改述）。

## 背景

原自研原语需要自行维护键盘、焦点、可达性和浮层边界，成本较高，因此采用成熟无头组件并保留既有样式栈。

## 决策

**用 shadcn-vue 取代自研 KitUI**，但**不引入 Tailwind CSS 引擎**——本项目样式栈是 UnoCSS，保留不变。做法：

1. **逻辑底座**：安装 `reka-ui`（无头原语）+ `class-variance-authority`（变体）+ `clsx`（class 拼接）。**不装 `tailwindcss`、不装 `tailwind-merge`、不装 `tailwindcss-animate`。**
2. **样式底座仍是 UnoCSS `presetWind3`**：它提供 Tailwind 兼容原子类，shadcn 组件源码里的 `bg-primary`/`px-4` 等能被 UnoCSS 直接编译。
3. **令牌桥接（纯 UnoCSS，零新依赖）**：在 `tokens.css` 定义 shadcn 语义变量（`--background/--foreground/--primary/--secondary/--muted/--accent/--destructive/--border/--input/--ring/--card/--popover/--radius`），值指向**现有设计令牌**（`--brand/--panel/--line/--ink/--radius-btn`…）。改品牌色仍只改 `--brand`，语义变量自动跟随。用**完整色值约定**（`var(--x)`）而非 shadcn 默认的 `hsl(三元组)`，从而复用现有 hex 令牌、不重做已定的原子样式。在 `uno.config.ts` 的 `theme.colors` 注册这些语义色名 + `borderRadius` 阶梯（`lg/md/sm/xl`）。
4. **进出动画（tailwindcss-animate 的 UnoCSS 原生移植）**：在 `uno.config.ts` 用 `rules` 注册 `animate-in/animate-out/fade-*/zoom-*/slide-*`，`keyframes` 放 `preflights`；时长/缓动接 `--dur-dialog`/`--ease-snappy`。注册为 rules（而非静态 CSS）是为了让 `data-[state=open]:animate-in` 这类变体能被 UnoCSS 识别生成。
5. **`cn()` 用 clsx 单跑，不用 tailwind-merge**：样式覆盖走 cva 变体属性，而非 class 字符串对冲——避免运行时字符串魔法，冲突在 variant 层解决。
6. **组件源码纳入仓库**（shadcn「你拥有源码」模式），落在 `app/components/ui/<name>/`；`useKitUI()` 保留为**薄封装**，`confirm/formModal/toast/promise/undoToast` 调用签名不变，业务页面无感迁移。
7. **遵循官方扩展**：按项目安装版本的官方公开 API、模板和扩展方式接入；视觉差异优先通过令牌、变体、插槽解决。现有能力不足时，先说明缺口、维护成本与迁移影响，经用户确认后再改变组件契约或底层方案；视觉目标见 [ADR 0013](0013-align-all-ui-to-online-design.md)。

## 考虑过的替代

- **@vuetify/v0**：同类无头框架，但 2026-07 仍是 RC、多数 API 为 Preview、案例极少、LLM 不熟——「难维护」风险反而更高，观望至 v1.0（Q3 2026）。
- **维持自研 KitUI**：即本 ADR 要解决的问题，否决。
- **上 Tailwind 引擎跑标准 shadcn-vue**：与现有 UnoCSS 栈冲突、要维护两套令牌、失去 UnoCSS 的动态性与既有 shortcuts，否决。
- **引 `unocss-preset-shadcn` 预设**：能自动对齐 shadcn 约定并保 CLI 可用，但它用 hsl 三元组令牌格式、需重写现有 hex 令牌，且多一个依赖；当时选择沿用既有令牌桥接。后续若要 `shadcn-vue add` CLI 便利可再评估。

## 后果

- `docs/design/kit-ui-component-specs.md` 等规格文档的"照着手写"承载改述为"基于 shadcn-vue + reka-ui 的桥接实现"；结构锚点、变体、令牌、行为规则仍有效（那是设计语言，与实现无关）。
- 现行实现位置与调用契约统一见 [KitUI 组件规格](../design/kit-ui-component-specs.md)，词表与 Agent 导入文件不承载实现说明。
- `/dev/kit-ui` 改为 shadcn 组件验证台。
- 当时的迁移映射见[固定历史映射材料](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/research/kitui-to-shadcn-migration.md)，仅作非权威参考；当前 API 与实现边界以 [KitUI 组件规格](../design/kit-ui-component-specs.md)为准。
- 桥接已离线验证：UnoCSS 生成器对语义色、圆角阶梯、`data-[state]` 动画变体均产出正确 CSS，无 Tailwind 引擎。
