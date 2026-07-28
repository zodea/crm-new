# 瑞航 CRM（crm-new）

本文件只保留所有开发任务都必须遵守的规则。文档导航从 [`docs/README.md`](docs/README.md) 进入；不要把专题规格复制回本文件。

## 1. 开工顺序

1. 运行 `git status --short --branch`，保护其他会话或用户尚未提交的改动。
2. 用 `gh issue list --state open` 搜本次工作的关键词，再用 `gh issue view <number> --comments` 核实现时状态。已有 open Issue 的定稿规格优先；关闭 Issue 不自动成为新工作的规格。
3. 读与任务相关的权威源：术语看 `CONTEXT.md`，决策看 `docs/adr/`，数据看 `docs/rewrite/DATABASE.md`，页面看 `docs/rewrite/pages/`，视觉看 `docs/design/README.md`。
4. 规格与代码、设计稿互相冲突时，先在 Issue 留证，再在同一工作单元消除冲突；不要静默选一边。

Issue 与分诊细则见 [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) 和 [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)。

## 2. 当前工程基线

- Nuxt 4、Vue 3.5、TypeScript，SPA（`ssr: false`）；桌面壳为 Tauri 2。
- 包管理固定为 pnpm；以 `package.json` 的 `packageManager` 和 scripts 为准。
- 状态使用 Pinia；持久化统一经 `app/lib/db/` 接入 SQLite（浏览器开发态使用 sql.js fallback）。
- 样式使用 UnoCSS；交互底座为 reka-ui / shadcn-vue 结构与 vue-sonner；数据网格底座为 vxe-table。
- 代码目录采用 Nuxt 4 的 `app/` 布局。架构入口见 [`docs/rewrite/ARCHITECTURE.md`](docs/rewrite/ARCHITECTURE.md)。

### Vue 任务

写或改 `.vue`、composable、store、路由或相关配置前，必须加载与任务匹配的技能：

- 总是先用 `vue-best-practices`，并按需用 `vue`、`nuxt`、`vue-router-best-practices`。
- 可复用交互先查 `vueuse-functions`；不要重复实现 VueUse 已提供的能力。
- 样式用 `unocss`；测试用 `vue-testing-best-practices` 与 `vitest`；依赖和构建用 `pnpm`、`vite`。
- 一律 Composition API、`<script setup>` 和 TypeScript；改到旧坏范式时就地纠正，不扩大到无关文件。

### 数据归属阶梯

1. 父子组件：props 向下、emits 向上；只有“单个可双向值”才用 `defineModel` / `v-model`。
2. 同一功能的深层组件树：`provide/inject` + `InjectionKey`，mutation 留在 provider。
3. 跨界面、需持久化或领域共享：Pinia store，写入只走 action。
4. 只复用行为：composable；无状态逻辑：纯 util。

## 3. 设计与界面实现

- 有直接对应页时，登录态运行参考决定构图、密度、控件状态和安全交互路径；`DC重构设计源码/app.dc.html` 与 `kit/` 是瑞航品牌、DC 独有能力和无直接参考页的唯一视觉基准。证据与只读边界见 `docs/design/runtime-reference-audit.md`，冲突裁定见 ADR 0013。
- 固定视口截图不是固定尺寸合同。每次界面工作按设计参考视口及 390 / 768 / 1024 / 1280–1440px 验证；密集表格只能在自己的区域横向滚动。
- 业务实体新增/编辑使用独立路由的整页表单；弹窗只用于行级小对象、确认和明确的轻量任务，见 ADR 0014。
- 框架组件的默认观感与设计稿冲突时，以设计稿定制或替换；可达性和交互底座约束仍按 ADR 0008 / 0009。
- 当前“未实现”和“已搭但未闭环”必须分开统计，见 [`docs/design/ui-implementation-status.md`](docs/design/ui-implementation-status.md)。

### 通用组件

先检查 `app/components/ui/` 与 `app/components/shared/`。按钮、弹窗壳、表格尺度、状态标签、工具栏等跨领域稳定能力应沉淀到通用原语；WBS、甘特、工程量矩阵、领域表单保留为领域组件。

采用“改到哪、迁到哪”：当前工作涉及的界面立即按新原语和设计稿验收，未触及界面不做无差别重刷。通用原语在 `/dev/kit-ui` 或组件测试验证，业务页面仍需逐屏对照。

### KitUI 边界

- 统一入口：`app/composables/useKitUI.ts`。
- 单宿主：`app/components/shared/KitUIHost.vue`。
- confirm / formModal 基于 reka-ui Dialog；toast 基于 vue-sonner 双 Toaster；不引入 Tailwind 引擎。
- `system` 泳道承载结果与需要阅读的消息；`process` 泳道承载 loading / promise。
- ripple 已全域废弃。

具体组件契约只看 [`docs/design/kit-ui-component-specs.md`](docs/design/kit-ui-component-specs.md) 和相关 ADR。

## 4. 验证

按风险选择最小充分验证：

- 类型：`pnpm typecheck`
- 单测：`pnpm test:unit`
- 组件：`pnpm test:components`
- E2E：`pnpm test:e2e` 或精确 Playwright 文件
- 质量：`pnpm lint`
- 构建：`pnpm build`

修 bug 时先建立能失败的复现；界面修改除行为断言外还要验证实际视口、滚动边界、键盘焦点与浮层层次。不要用静态源码检查替代运行态验收。

GitHub Actions 只手动按需调用；调用前必须先估算 runner-minutes、说明所选套件并等待用户确认。选择规则与费用基线见 [`docs/agents/ci-usage.md`](docs/agents/ci-usage.md)。

## 5. 文档纪律

- 单一权威源：词义 → `CONTEXT.md`；架构决策 → `docs/adr/`；数据模型 → `docs/rewrite/DATABASE.md`；当前界面对标权威链 → ADR 0013 与 `docs/design/README.md`。
- 二次文档只链接，不复制字段表、色值或状态快照。
- 决策或实现状态变化时，同一提交更新权威源和受影响入口；暂不能重写的历史材料移入 `docs/research/` 并标明“非权威源”。
- 完成的临时计划、反馈轮、TODO 和交接副本应删除；Git 历史就是参考档案。

## 6. 提交纪律

- 每个独立工作单元完成并验证后立即提交，不把多个 Issue 攒成一个 commit。
- 只 `git add` 本任务明确文件；禁止 `git add .` 和 `git add -A`。
- 提交信息使用 conventional commits + 中文描述，例如 `docs(repo): 重建开发指引`。
- 结束前再次检查 `git status`；不得把其他会话的改动混入提交。
