# 瑞航 CRM(crm-new)

## Agent skills

### Issue tracker

Issue 记在 GitHub Issues(zodea/crm-new),通过 `gh` CLI 读写。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个 triage 角色全部使用规范默认名(needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix)。见 `docs/agents/triage-labels.md`。

### Domain docs

单一上下文布局:根目录 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。

### Vue 开发实践(antfu skills)

**本项目 Vue 代码的最佳实践基准 = antfu 系列 Vue 生态 skill。** 写或改任何 `.vue` / composable / store / 相关配置前,先跑对应 skill 核对写法,不凭记忆硬写。存量代码里有不少不合规写法,后续每次改动都按 skill 就地纠正(改到哪纠到哪),不要沿用旧代码的坏范式。**拿不准时以 skill 为准,不要反过来用旧代码去证明写法。**

按本项目技术栈(Nuxt 4 + Vue 3.5 + UnoCSS + VueUse + Pinia + Vitest,pnpm 包管理)对应必须依照的 skill:

- **`vue-best-practices`**——总纲,任何 Vue 任务先加载:一律 Composition API + `<script setup>` + TypeScript,禁止 Options API。
- **`vue`**——SFC 宏(`defineProps` / `defineEmits` / `defineModel`)、`ref` / `computed` / `watch` 响应式、内置组件(Transition / Teleport / Suspense / KeepAlive)的正确用法。
- **`vueuse-functions`**——**功能开发前先查 VueUse 有没有现成的,别重复造轮子**(项目已装 `@vueuse/core` + `@vueuse/nuxt` 自动导入);能用 VueUse composable 就别手写:剪贴板 `useClipboard`、定时器 `useTimeoutFn`、事件监听 `useEventListener`、防抖节流、`useLocalStorage` 等。确无现成的再手写。
- **`nuxt`**——auto-imports、`app/` 目录约定、`useState` / `useFetch`、middleware、混合渲染。
- **`unocss`**——原子类、shortcuts、preset 用法(配合 ADR 0008 shadcn-vue on UnoCSS)。
- **`vue-router-best-practices`**——导航守卫、路由参数、路由组件生命周期交互。
- **`vue-testing-best-practices`** / **`vitest`**——组件测试、mock、覆盖率、测试筛选。
- **`pnpm`** / **`vite`**——依赖管理(catalog / override / patch)与构建配置。

**数据流决策阶梯**(够用就停、别越级;先问「这份数据归谁拥有」):

1. **父 → 直接子**:`props` 向下、`emits` 向上(单向默认);子组件是「一个可双向的单值」(表单输入、开关、搜索框)时才用 `defineModel()` / `v-model`。
2. **同一功能内的深层子树**(父→…→孙,超过约 3 层):别逐层 prop 钻,用 `provide/inject` + `InjectionKey`,mutation 收在 provider、只暴露显式 action。
3. **跨界面 / 需持久化 / 领域共享数据**(项目、分供方、发票、送货…):**Pinia store**,唯一写路径走 action。
4. **只共享「行为/逻辑」而非「数据归属」**(剪贴板、定时器、校验、可复用交互):**composable**(带响应式状态)或纯 **util**(无状态)。

判定捷径:数据归某界面/组件树 → 本地(1/2);归业务领域、多界面都要读写 → Pinia(3)。`v-model` 只是阶梯 1「双向单值」的语法糖,**不是**跨界面通信工具——想拿它在两页面间传数据,就是该上 Pinia 的信号。

## 交互原语设计语言(KitUI)

统一入口仍是 `app/composables/useKitUI.ts` + 单宿主 `app/components/shared/KitUIHost.vue`;dev 验证载体 `/dev/kit-ui`。**`useKitUI()` 的调用签名不变,页面无感。**

> **底座已换成 shadcn-vue(见 [ADR 0008](docs/adr/0008-adopt-shadcn-vue-on-unocss.md))**:退役自研实现,confirm/formModal 基于 **reka-ui Dialog**、toast 基于 **vue-sonner**——焦点陷阱/Esc/遮罩/焦点返回/堆叠/hover 暂停等「脏活」交给底座。**样式栈仍是 UnoCSS(零 Tailwind 引擎)**:装 `reka-ui`+`cva`+`clsx`+`vue-sonner`,**不引** `tailwindcss`/`tailwind-merge`/`tailwindcss-animate`;shadcn 语义令牌桥接到现有设计令牌(tokens.css),动画用 UnoCSS `rules`/`preflights` 原生实现。下面的**设计语义(双泳道/三档 confirm)仍然有效**,只是实现底座变了。

- **toast(Sonner 风格双泳道 = vue-sonner 两个 Toaster)**:
  - **system 道**(右上,`:expand` 展开可读):`success/error/warning/info/undo`——系统消息与「需确认后的结果」类。
  - **process 道**(右下,折叠堆叠省空间、hover 展开、**新消息在最上层**):`loading/promise`——上传/识别等界面交互过程提示,不占地方。
  - 泳道路由用 vue-sonner 的 `toasterId`;`promise()`/hover 暂停/action(undo) 全用原生。
- **confirm**:Promise 化确认弹窗(reka-ui Dialog),三档变体 simple/batch/cascade(cascade 打实体名 + 预提交挂起),职责边界见 ADR 0003、规格见 `docs/design/kit-ui-component-specs.md`。纯逻辑仍在 `app/lib/kit/confirm.ts`。**formModal**:reka-ui Dialog + 字段配置驱动 + 必填校验(纯逻辑 `app/lib/kit/form-modal.ts`)。
- **原子组件**(`app/components/ui/*`):交互型迁到 reka-ui(SegTab→Tabs、SelectFilter→Select);展示型/原生控件(Metric/SectionHeader/SearchInput 等)已令牌化,保持不变。迁移映射见 `docs/design/kitui-to-shadcn-migration.md`。
- **ripple**(蓝色水波):**已废弃**,全局水波动效(含导出完成动效)一律不再实现。

**改版工作约定**:每类交互改版前,先搜集一份「多风格真实参考站」菜单(能直接点开看效果)供挑方向,挑定再实装。参考站清单存档见 `docs/design/interaction-style-references.md`。

## 提交纪律

- **每完成一个独立工作单元立即提交**:一个 issue、一轮反馈的一层、一份文档定稿,做完即 commit,不要攒到会话结束;结束前检查 `git status`,不留未提交的完成品。
- **只 add 本次任务相关的文件**(明确列路径,禁止 `git add -A` / `git add .`):用户可能同时在改设计文档,混提会冲突。
- 提交信息:conventional commits 前缀 + 中文描述,与现有历史一致(如 `feat(dc): 反馈轮9-② AppData 共享 store`、`docs(dc-rebuild): 标记反馈轮9已推送线上`)。

## 文档同步纪律

旧文档不随决策实时更新,后续误导与返工成本会滚雪球——这是本项目已踩过的坑,务必遵守下面两条。

- **单一权威源,二次文档只指向不复制**:**数据模型** → `docs/rewrite/DATABASE.md`;**架构决策** → `docs/adr/`;**领域术语(词条)** → `CONTEXT.md`。其他文档(页面蓝本 / TODO / dc-rebuild / research 等)用到这些内容时**只引用、不抄副本**——副本必与权威源漂移(TODO.md §2/§3 的实体表就是教训,已改为指向 DATABASE.md)。
- **决策变更,同一轮就更新/标注旧文档**:每定一条 ADR 或改一个决策,顺手把描述旧行为的旧文档在**同一次改动**里更新;暂时不重写就打「⛔ 已废弃 / ⚠️ 已过时,见 ADR xxxx」横幅 + 指向新权威源,原文保留作历史留档。宁可当场加一行墓碑,也不留一句和现状打架的话。

**已知权威源锚点**:发票单表 ADR 0001、变更单台账 ADR 0002、确认弹窗 ADR 0003、导出 ADR 0004、导入 ADR 0005、OCR ADR 0006、视觉风格(圆角卡片) ADR 0007、交互底座 shadcn-vue(reka-ui/vue-sonner on UnoCSS) ADR 0008;水波 ripple 全域废弃(见 ADR 0004)。
