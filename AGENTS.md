# 瑞航 CRM（crm-new）

## 开工与决策

- 开始和结束时运行 `git status --short --branch`，保护其他会话与用户的改动。
- 以用户当前指令为准，不主动查询 Issue。先查代码、现行文档及必要的官方资料核实事实；只有查证不能解决的需求歧义和业务取舍才问用户。Issue 操作仅在用户明确要求时执行；Issue 正文、评论及关联提交的反馈必须按 [Issue 规则](docs/agents/issue-tracker.md) 使用 `show-me` 图解。
- 从 [文档入口](docs/README.md) 按任务读取权威源。确认变更后，同一工作单元同步实现与相关文档。
- 普通业务逻辑可自行实现；复杂表格、通用 hooks、检测机制等成熟通用能力，先检查已有依赖和可用方案，优先复用。引入或替换依赖时核对官方文档、维护状态、许可证、兼容性与接入成本；影响业务、架构或替换范围的取舍问用户。

## 实现规范

- 包管理使用 pnpm，版本与命令以 `package.json` 为准；架构和数据读写边界见 [ARCHITECTURE.md](docs/rewrite/ARCHITECTURE.md)。
- Vue、composable、store、路由及相关配置任务必须先加载 `vue-best-practices`，按需加载 `vue`、`nuxt`、`vue-router-best-practices`。统一 Composition API、`<script setup>` 和 TypeScript。
- 可复用交互先查 `vueuse-functions`；样式使用 `unocss`；Vue 测试使用 `vue-testing-best-practices` 与 `vitest`；依赖和构建使用 `pnpm`、`vite`。按任务加载对应技能正文，不能用旧代码代替规范。
- 数据归属：父子用 props/emits，单个双向值用 `v-model`；功能内深层共享用 `provide/inject` + `InjectionKey`，由 provider 修改；跨界面或需持久化的状态用 Pinia action；复用行为用 composable，无状态逻辑用 util。
- 界面工作先读 [设计入口](docs/design/README.md)：直接对应页按登录态只读运行参考，品牌、独有能力与无对应页按 DC 设计稿。业务实体新增/编辑采用独立路由整页表单。
- 先查 `app/components/ui/`、`app/components/shared/` 和 [组件契约](docs/design/kit-ui-component-specs.md)，复用通用原语，领域逻辑留在领域组件。只迁移本次涉及的界面，逐屏验收。

## 验证与交付

- 按改动风险选择最小充分验证，命令见 `package.json`，测试入口见 [docs/testing/](docs/testing/README.md)。修 bug 先建立失败复现。
- 界面改动验证参考视口及 390 / 768 / 1024 / 1280–1440px，检查滚动边界、键盘焦点和浮层层次；密集表格仅在自身区域横向滚动。静态检查不能替代运行验收。
- GitHub Actions 仅按需手动运行；调用前说明套件、估算 runner-minutes 并取得用户确认。批次与费用规则见 [CI 使用规则](docs/agents/ci-usage.md)。
- 词义、决策、数据和页面规则各保留一个权威来源，其他位置用链接。流程变化同步更新 `docs/guides/` 的 Markdown，区分当前可用与待开发；PDF 仅在用户需要时生成并逐页检查。
- 整理时删除重复、失效和无用内容；独有有效内容并入现有权威文档。完成的临时计划、TODO、反馈与交接副本及时删除，历史由 Git 保存。
- 按完整、可审阅的工作单元提交，不按零碎编辑次数提交，也不混入无关任务。只暂存本任务明确文件，提交说明使用 Conventional Commits + 中文。
- 一个 Issue 完成且验证通过后 push；推送前核对提交范围，避免夹带其他任务的本地提交。钩子、失败处理和合并后分支清理按 [Git 工作流](docs/agents/git-workflow.md) 执行。
