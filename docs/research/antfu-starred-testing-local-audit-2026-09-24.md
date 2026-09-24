# antfu 收藏调研附录：瑞航 CRM 测试适配审计

> **非权威源。** 采集日期：2026-09-24。样本：当前工作树的测试配置、代表性测试、官方文档与源码。本文是工具评估，不是已采纳的架构或实施规格；现行要求以 [文档入口](../README.md)、ADR 和 open Issues 为准。没有安装依赖、修改测试或执行测试套件，因此不包含实测速率与通过率结论。
>
> 收藏归属由同次主调查的 GitHub 公开 starred 完整清单核验：Vitest、Playwright、`vitest-dev/vscode` 在清单中；**MSW、fast-check 不在本次公开清单，仅是根据本地问题补充的候选**。Browser Mode 是已收藏 Vitest 的功能，不据此宣称 Vue 渲染适配包也被单独收藏。

## 本地事实与判断

| 事实证据 | 本次观察 | 对工具选择的影响 |
| --- | --- | --- |
| [package.json](../../package.json)、[vitest.config.ts](../../vitest.config.ts) | 已有 Vitest `^4.1.10`、Vue Test Utils、Vue Testing Library、jsdom；本地安装的 Vitest 为 4.1.10。unit 用 Node，component 用 jsdom | 首先利用已有测试栈；无需重新引入另一套通用 runner |
| `tests/**/*.test.ts`、`tests/components/**/*.test.ts`、`e2e/**/*.spec.ts` 文件枚举 | 分别是 845、242、181 个文件；242 已包含在 845 中。这是文件数，不是 test case 数 | 适合按领域和环境筛选执行；不应根据文件多就直接推断瓶颈 |
| [组件 setup](../../tests/components/setup.ts) | `scrollIntoView`、pointer capture 被替换为 mock；`ResizeObserver` 是空实现 | jsdom 断言不能证明真实布局、滚动和指针捕获正确 |
| [ContextHelp 测试](../../tests/components/ContextHelp.test.ts) | mock 了 `IntersectionObserver`、`getBoundingClientRect`、视口尺寸，并测试 tooltip、popover、Escape 与焦点返回 | 是 Browser Mode 的具体试点对象，能补浏览器布局与真实输入证据 |
| [工程量 HTTP Repository 测试](../../tests/quantity/http-repository.test.ts) | 注入 fetcher，已覆盖错项目、错来源、错误回执、断网及迟到响应 | 现有注入缝有价值；MSW 应补 transport 层，不替换全部 mock |
| [WBS HTTP Repository 测试](../../tests/schedule/central-repository.test.ts) | 通过临时本地 HTTP server 真正发送请求，检查 query、method、body 与回执 | 仓库已经有真实 HTTP 证据，不能把 MSW 推荐包装成填补“完全没有 HTTP 测试”的空白 |
| [量算式测试](../../tests/quantity/formula.test.ts)、[金额测试](../../tests/kit/money.test.ts) | 使用手工边界样例，覆盖全角字符、备注、优先级、非法字符、除零、长度与深度限制等 | fast-check 可扩展组合覆盖；不应删除这些清晰、稳定的回归例子 |
| [工资分配测试](../../tests/payroll/allocations.test.ts)、[内存数据库 helper](../../tests/helpers/memory-db.ts) | 分配测试每例建库并运行迁移；helper 已缓存 sql.js 初始化 promise。文本搜索有 89 个文件出现 `runMigrations(db)` | 数据库准备值得测量，但目前不能断言它是主要耗时；也不能说初始化完全没有缓存 |
| [Playwright 配置](../../playwright.config.ts) | Chromium，CI 单 worker，失败截图、重试 trace、失败视频；已按需启动 Nuxt | Browser Mode 不代替路由、后台、整页用户流与视觉 E2E |
| [CI 使用规则](../agents/ci-usage.md) | 手动按需调用，需要估算分钟并确认 | 工具试点先本地验证；本文没有触发远端 CI |

本次开始时已有多处工资测试与 UI 登记测试未提交改动，全部保持原样。本附录调查进程的普通 `gh issue list` 因本地代理连接失败未取得结果；同次主调查已单独取得 Issue 信息，本文不据历史笔记推断 open Issue 结论。

## 推荐顺序与边界

### 1. Vitest 性能分析：先测量，接入成本最低

这是现有 Vitest 的能力，不需要另换 runner。Vitest 4 文档区分 transform、setup、import、tests、environment 时间，并提供 runner/main thread CPU profiling、导入耗时分析等路径。[官方性能分析](https://v4.vitest.dev/guide/profiling-test-performance)

建议先对一个组件集合和一个数据库领域集合记录各阶段时间，观察慢点是在 jsdom 启动、组件依赖导入还是迁移/fixture。若确认是迁移准备，才评估可恢复的基线库 fixture；若是模块导入，才优化导入范围。**目前没有测量数据，不能承诺提升百分比，也不建议直接关闭 isolation 或提高全局并发。**本仓库大量 stub、Pinia 状态及数据库场景需要保留可靠隔离。

试点验收：同一机器、同一提交和同一测试集的前后对照，报告 wall time 与阶段耗时，且保持测试行为和隔离保证。分析产生的 profile/log 应遵守项目临时目录与清理规则。Vitest 自身为 MIT，当前已安装 4.1.10；不涉及新增生产依赖。

### 2. Vitest Browser Mode：少量高风险交互优先

Browser Mode 可用真实浏览器运行测试，官方支持 Playwright provider 和多 project 配置；已有 Node/jsdom 套件可保留，增加专门 browser project。[Vitest 4 Browser Mode](https://v4.vitest.dev/guide/browser/)

建议试点 ContextHelp、Dialog 焦点返回、表格滚动或拖拽中的 2–3 个关键场景，使用真实交互和实际几何测量。收益是减少“mock 表现正确就当浏览器表现正确”的风险；它不会自动加快测试。Vue 适配包 `vitest-browser-vue` 的当前源码声明 MIT、Vue `^3.0.0`、Vitest `^4.0.0 || ^5.0.0` peer 范围，与当前栈相符；其 [package.json](https://github.com/vitest-community/vitest-browser-vue/blob/main/package.json) 也显示该包目前归 `vitest-community` 维护。实际安装前仍需核对选定发布版本的 peer 范围。

预计需要新增**开发依赖**及 browser 项目配置。`@vitest/browser-playwright` 必须与当前 Vitest 4.1.10 对齐，本地 Vitest 的 peerDependencies 要求该精确版本，不能顺手安装最新 5.x。Nuxt 自动导入、注入的 store/router、UnoCSS 和主题样式要显式准备；简单 Vue 插件配置并不等于完整 Nuxt 运行环境。浏览器测试也不能验证 Tauri 原生对话框、桌面文件系统或 SQLite 壳层。

试点验收：保留已存在组件行为断言，另外证明真实 Tab/Escape 焦点、popover 视口避让、滚动边界；按项目要求覆盖相关视口，并保留整页 E2E。

### 3. Vitest VS Code 插件：使用 VS Code 时值得启用

官方扩展提供单条运行、调试、watch 和测试浏览器；最低 Vitest 要求为 1.4，当前仓库符合。它是编辑器扩展，通常不改项目生产依赖，MIT 许可证。[官方仓库](https://github.com/vitest-dev/vscode)、[许可证](https://github.com/vitest-dev/vscode/blob/main/LICENSE)

收益是缩短“定位失败例子—断点—重跑”的操作路径，不是提高断言质量或直接加速 runner。如果主要在 Codex 完成开发，它的收益取决于是否同时使用 VS Code。当前扩展 README 的新 Trace View 明确针对 Vitest 5，不能列为当前 4.1.10 已可用收益。已有 [发布记录](https://github.com/vitest-dev/vscode/releases)，具体安装版本应按编辑器兼容性选定。

### 4. MSW：额外候选，先证明现有 HTTP 测试的维护痛点

**不在本次 antfu 公开收藏清单。**MSW 在请求层拦截，Node 用拦截器，浏览器用 Service Worker；可模拟状态码、headers、延迟和网络失败。Vitest 4 官方提供 MSW 集成方式，包括每例重置 handler 和未处理请求报错。[Vitest 请求模拟](https://v4.vitest.dev/guide/mocking/requests)、[MSW Node 集成](https://mswjs.io/docs/integrations/node)

适用增量：用真实客户端 transport 发请求，统一覆盖 401/403、409、超时/中断、错误 JSON 与回读失败，避免各测试重复造响应。先做一个中央 Repository 的集成测试，与既有 fetcher 注入和真实 HTTP round trip 对照；如果增加 handler 维护成本但没有消除重复，就不扩大使用。模拟响应不是服务端契约正确或持久化完成的证据，不能替代真实后台集成。

MSW 为 MIT，官方 [仓库](https://github.com/mswjs/msw) 和 [发布记录](https://github.com/mswjs/msw/releases) 可核验；这里没有选定或安装版本。加入它应作为开发依赖，并将 Node mocking 限制在对应 suite，避免全局启动干扰现有真实 HTTP 测试。不能仅因 lockfile 有 optional peer 名称就认为已经安装启用。

### 5. fast-check：额外候选，适合量算与金额不变量

**不在本次 antfu 公开收藏清单。**fast-check 为 TypeScript/JavaScript 属性测试库，能生成输入并缩小失败反例，提供 seed/path 重放。它可以放在现有 Vitest 测试中使用，为 MIT。[官方仓库](https://github.com/dubzzz/fast-check)、[参数与重放](https://fast-check.dev/docs/api/interfaces/Parameters/)、[配置](https://fast-check.dev/docs/configuration/)

最具体的切入口是量算式：生成受限算式树，分别渲染半角/全角形式，验证同义表达式结果一致；或生成合法金额分配，验证分配和与应发合计一致。断言必须来自业务规格或独立模型，不能直接复制被测算法当 oracle。浮点金额不能随意要求未经规范的精确相等，也不能用任意数学恒等式绕过业务舍入规则。

接入为开发依赖，成本主要在设计正确的生成器与不变量。限定表达式深度、输入规模和每例运行次数，失败保留 seed/path，并把重要最小反例变成固定回归样例。官方 [发布记录](https://github.com/dubzzz/fast-check/releases) 可核验维护情况；这里没有测量 fuzz 执行开销，不建议一开始覆盖全领域。

## 本次结论

优先使用现有 Vitest 性能分析，并小范围补真实浏览器组件测试。VS Code 插件取决于日常编辑器。MSW 和 fast-check 有明确用途，但属于收藏清单外的可选补充，后续应以一个具体场景证明收益再决定是否采用。

官网默认文档在本次采集中已经出现 Vitest 5 信息，本文对运行配置优先引用 **v4 文档**。上述兼容性是文档与源码核对结果，不是安装验证结果；任何新增或替换方案均需另行形成实施范围，不能由本调研直接视为采用决定。
