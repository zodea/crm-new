# Skills / 斜杠命令速查表

> 用途：快速查「要做某件事该敲哪个命令」。
> 触发方式：多数命令输入 `/命令名` 即可显式调用；技术栈类（vue / nuxt / vite 等）我通常会在相关任务里自动加载，你也可以显式点名。
> 标 🔒 的命令**只能你手动触发**，我不会自动调用——2026-07-06 同步上游后，这一批从「自动」改成了「仅手动」（详见 `~/.claude/skills-changelog.md`）：`grill-with-docs` `implement` `improve-codebase-architecture` `to-issues` `triage` `grill-me` `handoff`。

---

## 0. 先看这里：我该用哪个？

| 你想做的事 | 用这个 |
| --- | --- |
| 把这次讨论定成需求文档 | `/to-prd` |
| 把计划/PRD 拆成一个个能认领的 issue | `/to-issues` 🔒 |
| 拿一个 issue 从头实现到能跑 | `/implement` 🔒 |
| 写代码前先把方案怼清楚 | `/grill-with-docs` 🔒（对照文档）· `/grill-me` 🔒（纯压测） |
| 审我刚改的代码 | `/code-review`（官方档位版）· `/code-review-matt`（Standards+Spec 双轴版，见下方说明） |
| 只做清理、不查 bug | `/simplify` |
| 卡在一个难 bug 上 | `/diagnosing-bugs`（原 `/diagnose` 已改名） |
| 解决 merge/rebase 冲突 | `/resolving-merge-conflicts` |
| 跑起来看看效果对不对 | `/run` · `/verify` |
| 这块代码不熟，给我讲讲 | `/teach` 🔒（`/zoom-out` 已被上游下架，本地已删除） |
| 不知道该用哪个命令 | `/ask-matt` 🔒 |

---

## 1. 项目主线工作流（PRD → Issue → 实现 → 审查 → 提交）

> 本项目 issue 记在 GitHub Issues（zodea/crm-new），配套 `docs/agents/` 里的 issue-tracker / triage-labels / domain 三份约定。

| 命令 | 用途 | 何时用 |
| --- | --- | --- |
| `/to-prd` | 把当前对话整理成 PRD 并发到 issue 追踪器 | 讨论出一个功能方向后，先固化成需求 |
| `/to-issues` 🔒 | 把计划/规格/PRD 按「tracer-bullet 垂直切片」拆成可独立认领的 issue | PRD 定稿后拆活。⚠️ #47 已拆成 #48–72，别再重拆 |
| `/triage` 🔒 | issue 分诊状态机：分类 → 核实 → 需要时拷问 → 写成 agent 可读的 brief | 新建 issue、整理待办、给 AFK agent 备料 |
| `/implement` 🔒 | 依据一份 PRD 或一组 issue 实现一块工作：优先复用现有组件、把后端 schema 当字段级契约、遵守术语表和 ADR | 新会话里挑一个 issue 开干 |
| `/code-review` | **官方插件版**：按 low/medium/high/max 档位审当前 diff（correctness + 复用/简化/效率），`ultra` 可云端多 agent 深审 | 改完代码自查，要分档控制审查深度时 |
| `/code-review-matt` | **mattpocock 版**：审「自某个基准点以来」的改动，Standards（是否符合本仓库文档化的编码规范）+ Spec（是否符合发起该改动的 issue/PRD）两条轴并行子 agent 审查，结果并排展示 | 想同时核对「代码规范」和「是否做对了需求」两件事时；两者同名不同源，按需选一个，别混用 |
| `/resolving-merge-conflicts` | 处理一次**进行中**的 git merge/rebase 冲突 | 合并/变基卡在冲突标记里 |
| `/simplify` | 只做复用 / 简化 / 效率 / 抽象层级清理，**不查 bug** | 逻辑没问题、只想让代码更干净 |
| `/review` | 审一个 **GitHub PR**（区别于审本地 diff 的 code-review） | 别人开了 PR 要评 |
| `/security-review` | 对当前分支改动做安全审查 | 涉及权限、输入、外部数据时 |
| `/init` | 初始化/更新 CLAUDE.md（仓库说明） | 新仓库或说明过时 |

### `/code-review` 的档位（重要）
- `/code-review low|medium|high|max` —— effort 越高覆盖越广，但高档可能含不确定结论。
- `/code-review ultra` —— 云端多智能体深审**当前分支**；`/code-review ultra <PR#>` 审指定 GitHub PR。
- 追加 `--comment` 把结论发成 PR 内联评论；`--fix` 把结论直接改进工作区。
- `/ultrareview` 是 `ultra` 的**废弃别名**。ultra 由你触发且计费，我无法代你启动。
- 以上档位机制只属于**官方版** `/code-review`；`/code-review-matt` 没有这套档位，是固定的「Standards+Spec 双轴」流程。

---

## 2. 计划与设计（写代码之前）

| 命令 | 用途 | 何时用 |
| --- | --- | --- |
| `/grill-with-docs` 🔒 | 拷问式压测方案，同时对照/生成文档（ADR + 术语表），边讨论边就地更新 CONTEXT.md、ADR | 方案要落到本项目语言和已定决策上时（首选） |
| `/grill-me` 🔒 · `/grilling` | 顺着决策树把计划逐个分支怼到共识，纯压测不改文档 | 只想把想法压结实。二者内容基本等价，`/grill-me` 是精简版仅手动，`/grilling` 仍可自动触发 |
| `/domain-modeling` | 建立/打磨领域术语（ubiquitous language）、记录 ADR | 术语含糊、要沉淀一条架构决策 |
| `/codebase-design` | 「深模块设计」共享词汇（模块/接口/深度/接缝/适配器/杠杆/局部性），含 Design-It-Twice 并行探索接口方案 | 想把一堆浅模块合并成一个深模块、重新设计接口；也是 `/tdd`、`/improve-codebase-architecture` 内部引用的词汇权威来源 |
| `/improve-codebase-architecture` 🔒 | 扫描代码库找深化机会，产出**可视化 HTML 报告**，挑一个后接入 `/codebase-design` 词汇拷问深化方案 | 想系统性改善架构；现在会真的生成一份 HTML 报告，不只是文字建议 |
| `/prototype` | 做一次性原型回答一个设计问题（可跑的终端 app 验证状态/逻辑，或一条路由里切多套 UI 变体） | 数据模型/状态机/UI 方向拿不准，先玩一下 |
| `/handoff` 🔒 | 把当前对话压缩成交接文档给下一个 agent 接手 | 会话太长要换人/换窗口继续 |

---

## 3. 编码方法论

| 命令 | 用途 | 何时用 |
| --- | --- | --- |
| `/tdd` | 测试驱动开发（红-绿-重构） | 想测试先行、要集成测试 |
| `/diagnosing-bugs` | 硬 bug / 性能回归的诊断循环（原名 `/diagnose`，2026-07-06 上游改名） | 报错、崩溃、跑失败、变慢 |

---

## 4. 前端技术栈（本项目 Nuxt + Vue 3 + UnoCSS）

> 这些多在相关任务时自动加载，也可 `/名字` 显式点名要求按最佳实践来。

| 命令 | 覆盖 |
| --- | --- |
| `/vue` · `/vue-best-practices` | Vue 3 组合式 API、`<script setup>`、响应式、内置组件（首选 Composition API + TS） |
| `/vue-router-best-practices` | Vue Router 4：导航守卫、路由参数、组件生命周期 |
| `/vue-testing-best-practices` | Vitest + Vue Test Utils 组件测试、mock、Playwright E2E |
| `/vueuse-functions` | VueUse 组合式函数 |
| `/nuxt` | Nuxt 全栈：SSR、自动导入、文件路由、server routes、useFetch、middleware |
| `/vite` | Vite 配置、插件 API、SSR、库/SSR 构建 |
| `/vitest` | Vitest 单测：mock、覆盖率、过滤、fixture |
| `/unocss` | UnoCSS 原子化 CSS（Tailwind 超集）：规则、shortcut、preset |
| `/pnpm` | pnpm 包管理：workspace、catalog、patch、override |
| `/web-design-guidelines` | 按 Web Interface Guidelines 审 UI 代码（可访问性、UX） |

---

## 5. 文件与文档处理（Office / PDF）

| 命令 | 用途 |
| --- | --- |
| `/docx`（anthropic-skills） | 建/读/改 Word：目录、页码、表格、图片、查找替换、修订 |
| `/xlsx` | 建/读/改 Excel/CSV/TSV：公式、格式、图表、清洗脏数据 |
| `/pptx` | 建/读/改 PPT：幻灯片、模板、备注、合并拆分 |
| `/pdf` | PDF：读取/抽取文字表格、合并拆分、旋转、水印、填表、加解密、OCR |

---

## 6. 研究与信息

| 命令 | 用途 |
| --- | --- |
| `/deep-research` | 多源联网搜索 → 抓取 → 对抗式核查 → 带引用的研究报告（问题太宽会先追问 2–3 个澄清点）；面向**外部**开放性问题 |
| `/research` | 针对一个具体问题，对高可信一手资料做调研，落成一份 Markdown 文件存进仓库；可后台委派、不用你盯着——比 `/deep-research` 更轻量、更聚焦「查个 API 事实/文档细节」 |
| `/claude-api` | Claude API / Anthropic SDK 参考：模型 id、定价、参数、流式、tool use、MCP、缓存、迁移 |

---

## 7. 运行与验证

| 命令 | 用途 |
| --- | --- |
| `/run` | 启动并驱动本项目 app，看某个改动真的跑起来（优先用项目自带的启动方式） |
| `/verify` | 跑起 app、观察实际行为，确认改动/修复真的生效（不只是测试过） |

---

## 8. 配置 · 自动化 · 元

| 命令 | 用途 |
| --- | --- |
| `/update-config` | 改 settings.json：权限（allow X）、环境变量、hooks（「每次 X 就…」这类自动化只能靠 hook 实现） |
| `/keybindings-help` | 自定义快捷键 / 改键位 / 加 chord（~/.claude/keybindings.json） |
| `/fewer-permission-prompts` | 扫历史里常见只读命令，写进项目允许列表，减少权限弹窗 |
| `/schedule` | 建/改/列/跑定时云端 agent（cron routine），也支持一次性定时 |
| `/loop` | 按间隔重复跑某个命令（如每 5 分钟查一次），省略间隔则我自定节奏 |
| `/writing-great-skills` 🔒 · `/skill-creator` | 写/改 skill 的词汇与原则参考（原名 `/write-a-skill`，2026-07-06 上游改名+改为仅手动） |
| `/setup-pre-commit` | 给当前仓库装 Husky pre-commit 钩子：lint-staged（Prettier）+ 类型检查 + 测试，提交时自动跑 |
| `/artifact-design` | 生成 Artifact 网页前的设计规范（配合 Artifact 工具用） |
| `/consolidate-memory` | 反思式整理记忆文件：合并重复、修正过时、精简索引 |
| `/setup-cowork` | Cowork 引导配置：按角色装插件、连工具、试用 skill |

---

## 9. 沟通风格

| 命令 | 用途 |
| --- | --- |
| `/caveman` | 极简 token 模式，砍掉客套/冠词、保留全部技术准确性（省约 75% token） |

---

## 10. 纯用户触发（🔒 我不会自动调用，只能你敲）

2026-07-06 起，🔒 名单从 3 个扩到 10 个——上游把大半工程流程收拢到「显式路由」范式（配合 `/ask-matt`），不再靠关键词自动命中：

| 命令 | 用途 |
| --- | --- |
| `/ask-matt` 🔒 | 不知道该用哪个命令时，帮你路由到合适的 skill / 流程 |
| `/teach` 🔒 | 跨多次会话教你一个新概念/技能（有状态，会记进度） |
| `/grill-with-docs` 🔒 | 见「2. 计划与设计」 |
| `/grill-me` 🔒 | 见「2. 计划与设计」 |
| `/implement` 🔒 | 见「1. 项目主线工作流」 |
| `/to-issues` 🔒 | 见「1. 项目主线工作流」 |
| `/triage` 🔒 | 见「1. 项目主线工作流」 |
| `/improve-codebase-architecture` 🔒 | 见「2. 计划与设计」 |
| `/handoff` 🔒 | 见「2. 计划与设计」 |
| `/writing-great-skills` 🔒 | 见「8. 配置·自动化·元」 |

`/zoom-out` 已于 2026-06-17 被上游彻底下架（连 deprecated 分类都没进），本地残留已于 2026-07-06 删除；「讲代码」类需求现在只用 `/teach`。

---

## 备注

- 本项目**没有自定义 skill**（`.claude/skills/` 为空）；以上命令全部来自全局 skills 与内置插件。
- 项目专属约定见 `CLAUDE.md` 与 `docs/agents/`（issue-tracker / triage-labels / domain）。
- KitUI 交互原语设计规范见 `docs/design/kit-ui-component-specs.md`。
- 全局 skills 的版本变更记录见 `~/.claude/skills-changelog.md`（2026-07-06 建档，后续同步继续追加)。
