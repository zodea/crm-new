# antfu 收藏中的测试与开发工具适配调查

日期：2026-09-24。性质：非权威调研，不是已采纳决策或实施规格。未安装工具、修改依赖或运行 CI。

## 调查范围与证据

通过 GitHub REST API `GET /users/antfu/starred?per_page=100` 完整分页，取得 **1,755** 个公开收藏条目，再按名称、描述筛选测试、调试、依赖和代码质量工具；对下述重点候选核查官方 README、文档、许可证、归档状态及发行信息。完整读取元数据不等于逐一审查 1,755 个项目源码。收藏不代表作者担保，清单可能随时变化。

来源：[公开收藏页](https://github.com/antfu?tab=stars)、[REST 清单入口](https://api.github.com/users/antfu/starred?per_page=100)。网页搜索缓存有旧日期，维护日期优先使用本次实时 GitHub API 结果。没有将原始清单另存为临时文件。

本地起点：`8a00fffbbc42ee18e652f6842bd3041da5da3a28`，main 已有其他未提交、已暂存测试改动；全部保留。本调查读取工作目录配置，因此观察也包含当时未提交状态。已查询开放 Issue 并读取 [#403 评论](https://github.com/zodea/crm-new/issues/403)：真实运行、逐场景验收和生产持久化证据不得互相替代。

本地权威入口：[架构](../rewrite/ARCHITECTURE.md)、[Git 验证纪律](../agents/git-workflow.md)、[CI 约束](../agents/ci-usage.md)。详细测试适配证据见[测试审计附录](./antfu-starred-testing-local-audit-2026-09-24.md)。

## 当前项目已有的能力

- [package.json](../../package.json)：Nuxt 4、Vue 3.5、Vitest 4.1、Playwright 1.61、Vue Test Utils、Testing Library、vitest-axe、jsdom、antfu ESLint 配置。版本为声明范围，不能当作每个本地实际安装版本。
- [vitest.config.ts](../../vitest.config.ts)：unit 在 Node 跑，component 在 jsdom 跑；已有项目分组。组件统一 setup 将 ResizeObserver、scrollIntoView、pointer capture 模拟掉。
- [Playwright 配置](../../playwright.config.ts)：已有失败截图、重试 trace、失败视频；本地 retries=0，配合 on-first-retry 意味着默认本地失败未必有 trace。
- [视觉配置](../../playwright.visual.config.ts)：已有 Windows/Chromium、隔离演示服务和独立视觉矩阵。
- [Nuxt 配置](../../nuxt.config.ts)：已有 Nuxt DevTools，并显式对 Vue/Pinia 去重。
- 本次只读调用 ESLint `calculateConfigForFile('tests/components/ContextHelp.test.ts')`，实际生效的 test 规则包含 no-only-tests、no-identical-title、no-import-node-test、consistent-test-it、prefer-hooks-in-order、prefer-lowercase-title；未看到 valid-expect、valid-expect-in-promise、expect-expect。不能说完全缺少测试 lint。

## 第一优先级：测试质量和定位效率

### 1. @vitest/eslint-plugin：复用已带入的插件，补强断言规则

收藏仓库：[vitest-dev/eslint-plugin-vitest](https://github.com/vitest-dev/eslint-plugin-vitest)。MIT，未归档；API 返回最新 release 为 [v1.6.27，2026-08-10](https://github.com/vitest-dev/eslint-plugin-vitest/releases/tag/v1.6.27)。官方说明当前插件要求 ESLint 9 及以上，项目声明 ESLint 10；实际组合仍须定向 lint 验证。

价值：在执行测试前发现错误 expect 用法、Promise 断言处理问题及没有断言的测试。现有 antfu 配置已注册为 `test/*`，无需为了同一能力重复安装。建议针对 tests 精确评估 `test/valid-expect`、`test/valid-expect-in-promise`、`test/expect-expect`；有共享断言 helper 的文件需要配置识别，先看误报再决定门禁。

成本低：少量配置与现有测试修订。验收以能拦截缺陷样例、允许合法共享断言为准，不能只看 lint 全绿。

### 2. Vitest Browser Mode：给少数依赖真实浏览器行为的组件补测试

收藏仓库：[vitest-dev/vitest](https://github.com/vitest-dev/vitest)，MIT、未归档。使用与项目匹配的 [Vitest 4 Browser Mode 文档](https://v4.vitest.dev/guide/browser/)，避免直接照搬官网 v5 的配置。

本地依据：[组件 setup](../../tests/components/setup.ts) 模拟布局相关 API，[ContextHelp 测试](../../tests/components/ContextHelp.test.ts) 人工设定几何位置。这些测试仍然有效，但不足以证明浏览器实际定位、滚动和 pointer 行为。

建议只选 ContextHelp、Dialog/Popover、表格滚动或 ResizeObserver 相关组件建立独立 browser 项目；配合 Playwright provider 和适合 Vue 的渲染辅助包，版本与 Vitest 4 对齐。保留纯逻辑在 Node，简单组件留在 jsdom，完整业务旅程仍由现有 Playwright 验证。Vite/Vue 插件、UnoCSS、Nuxt 自动导入与 provider 装配都需要小规模试点。

成本中：新增开发依赖、独立 setup 和少量测试；不是给全部 242 个组件测试切换环境，也不承诺更快。验收看能否在真实 CSS 下发现既有模拟环境遗漏的问题，并记录增量耗时。

### 3. Vitest 官方 VS Code 扩展：改善人工调试

收藏仓库：[vitest-dev/vscode](https://github.com/vitest-dev/vscode)，MIT、未归档；[v1.52.0，2026-09-09](https://github.com/vitest-dev/vscode/releases/tag/v1.52.0)。支持单测运行、调试、watch、覆盖率界面；官方最低 Vitest 要求 1.4，项目版本在范围内。官网已提到的 Vitest 5 browser Trace View 不能套用到当前 Vitest 4。

适合使用 VS Code 的开发者，成本很低且不增加产品运行时依赖。当前任务在 Codex 桌面，扩展本身不会直接提升 agent 通过命令行执行测试的速度；不把它列为必须安装。

### 4. 先用现有 Vitest / Playwright 的性能诊断能力

两个仓库均已确认被收藏。参考 [Vitest 4 性能分析](https://v4.vitest.dev/guide/profiling-test-performance)和 [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer)。

在决定更换 DOM 模拟器之前，先区分慢在模块导入、环境初始化、SQLite 夹具，还是测试执行。开发阶段按 project、文件和名称选择目标，任务收尾仍遵守仓库全量检查纪律。本地疑难 E2E 可以定向记录 trace；现有 CI 重试配置已经会留 trace，不是从零引入。

成本低到中。本调查没有运行性能基准，因此没有声称某项配置可提速特定百分比，也未建议取消隔离、盲目加并发或用局部测试取代发布验收。

## 第二优先级：开发维护工具

| 工具（均确认在收藏中） | 项目用途与建议范围 | 接入与限制 |
| --- | --- | --- |
| [node-modules-inspector](https://github.com/antfu/node-modules-inspector) | 看依赖树、重复版本与安装大小；本项目已有 Vue/Pinia dedupe，适合定位多个实例或依赖链问题 | 低成本，官方支持 pnpm；按需运行，不必成为产品依赖。安装体积不等于浏览器包体积 |
| [jscpd](https://github.com/kucherenko/jscpd) | 找 app/lib、server 及测试 helper 中的复制片段，辅助发现修了 A 漏了 B 的位置 | 低到中，先报告后人工复核；排除生成物、设计参考与快照，不为重复率强行合并语义不同的领域逻辑。v5 有 Windows 分发 |
| [dpdm](https://github.com/acrazing/dpdm) | 从 app/lib、server 的 TypeScript 入口查循环依赖 | 中等，支持 tsconfig path 与忽略类型依赖；Nuxt 自动导入和 .vue SFC 不应假定完整识别。先限定显式 TS 依赖图，空结果不等于整个应用无环 |
| [Taze](https://github.com/antfu-collective/taze) | 可读地检查版本更新，并按范围控制升级 | 低，先只读报告；锁定版本默认跳过，应纳入审查但不自动放开。工具列出新版本不证明 Nuxt/Vite/Vitest/ESLint 组合兼容 |
| [ast-grep](https://github.com/ast-grep/ast-grep) | 在大范围重构前按代码语法结构搜索，例如绕过 Repository 的可疑调用 | 中等，需编写模式、校验 Vue 片段覆盖；适合重复迁移任务，先只读搜索再决定改写范围 |

以上均为 MIT，API 显示未归档。发行核查：node-modules-inspector [v2.7.0 / 2026-09-16](https://github.com/antfu/node-modules-inspector/releases/tag/v2.7.0)，jscpd [v5.3.2 / 2026-09-23](https://github.com/kucherenko/jscpd/releases/tag/v5.3.2)，dpdm [v4.3.0 / 2026-07-29](https://github.com/acrazing/dpdm/releases/tag/v4.3.0)，Taze [v21.1.0 / 2026-08-14](https://github.com/antfu-collective/taze/releases/tag/v21.1.0)，ast-grep [0.45.3 / 2026-08-31](https://github.com/ast-grep/ast-grep/releases/tag/0.45.3)。许可证核查属于选型元数据，不是法律意见；依赖树许可证未逐包审计。

## 有价值，但当前暂缓

- [Compodium](https://github.com/romhml/compodium)：Vue/Nuxt 组件演练场，能直接分析组件、减少手写 stories。MIT、未归档，API 返回 [v0.1.0-beta.14 / 2026-08-26](https://github.com/romhml/compodium/releases/tag/v0.1.0-beta.14)，README 仍提示早期阶段。本项目已有 /dev/kit-ui，先比较维护成本，避免两个组件展示入口。它不是自动验收测试的替代品。
- [Histoire](https://github.com/histoire-dev/histoire)：MIT、未归档，API pushed_at 为 2026-08-05，但 latest release 接口返回 v0.17.17 / 2024-04-09。不能仅凭最近 push 推断稳定包已适配当前 Nuxt/Vite；后续需核对 npm dist-tags 和 peer 依赖。
- [happy-dom](https://github.com/capricorn86/happy-dom)：MIT、未归档，可作为 jsdom 性能对比候选。两个都是模拟环境；是否更快且通过现有 reka-ui、axe、pointer 测试必须实测，不直接全量替换。
- [vite-plugin-inspect](https://github.com/antfu-collective/vite-plugin-inspect)：MIT、未归档，适合定位插件转换。当前主线文档要求 Vite 8 和 @vitejs/devtools >=0.4；需核对 Nuxt 实际锁定 Vite，再决定相容分支。项目已启用 [Nuxt DevTools](https://github.com/nuxt/devtools)，优先使用已有入口。
- [Cypress](https://github.com/cypress-io/cypress)、[Storybook](https://github.com/storybookjs/storybook)：虽被收藏，但现有 Playwright 和 /dev/kit-ui 已承担大量对应职责；当前没有证据支持增加第二套完整平台。
- `danielroe/nuxt-vitest`、`webfansplz/vite-plugin-vue-devtools`、`qawolf/playwright-video`：API 明确显示已归档，排除旧仓库接入；Playwright 已有视频能力。
- `antfu/tsnapi`、`antfu/vitest-package-exports`、`antfu-collective/eslint-vitest-rule-tester`：面向公共库 API 或自定义 ESLint 规则的测试，当前 private CRM 应用没有明显优先需求。

## 收藏范围外的补充候选

本次 1,755 项公开清单没有找到 MSW、fast-check、Knip；不能标为“antfu 收藏推荐”。

- [fast-check](https://github.com/dubzzz/fast-check)：可按性质生成金额、数量、顺序等边界输入，适合金额守恒、分摊和导入归一化等纯逻辑。试点需固定可复现 seed 并保存失败反例，性质本身必须来自已定业务规则。
- [MSW](https://github.com/mswjs/msw)：补前端真实请求链的错误响应、超时等可控场景；项目已有注入式 fetch 和真实 HTTP 测试，不应将中央事务、幂等、持久化验收替换成 mock。
- [Knip](https://github.com/webpro-nl/knip)：ISC，查未使用文件、导出和依赖；[官方 Nuxt 插件](https://knip.dev/reference/plugins/nuxt)已提供框架入口，但 Nuxt 4 app/、自动导入和动态组件仍需核验误报。若用户后续扩展到收藏外工具，可先只读评估。

fast-check 与 MSW 的详细适配和来源见测试附录。本轮不将补充候选视为已验证可接入的最终选型。

## 建议顺序与验收

1. 优先完善已有测试 lint，定向取一次 Vitest 耗时基线；没有基准不承诺提速。
2. 选择 2–3 个真实浏览器交互组件试点 Browser Mode，比较发现能力与耗时后再决定范围。
3. 按需用 node-modules-inspector 定位依赖；jscpd 先输出候选重复片段，不自动改代码。
4. dpdm 从纯 TS 领域层试点；Taze 用于独立依赖维护工作单元。
5. 工具选型确定后再实施。新增生产依赖、替换测试环境或扩大范围仍遵守项目决策规则；本报告没有作出这些变更。

本轮验证仅包括资料核查、配置读取和 ESLint 生效规则查询；没有修改 JavaScript/TypeScript，未运行 npm test、构建或 GitHub Actions。没有创建临时脚本、下载缓存、截图或测试输出，因此没有临时删除项。正式交付为本报告及测试审计附录。
