# 测试入口与模块索引

按受影响行为选择测试层，再到模块清单定位文件。清单只记录归属与查找线索，不代表覆盖率或业务验收通过。

## 运行与类型检查入口

命令以 [package.json](../../package.json) 为准；下表说明各入口的覆盖边界。

| 用途 | 工具与入口 | 范围 |
| --- | --- | --- |
| 日常单元、服务与状态 | Vitest：`pnpm test:unit` | [unit 与 unit-heavy 项目](../../vitest.config.ts)；冷进程、数据库启动与升级、正式库等重夹具用例在其余项目之后运行，最多并发 3 个 |
| jsdom 组件 | Vitest、Vue Test Utils、Testing Library：`pnpm test:components` | [component 项目](../../vitest.config.ts)；部分用例使用 `vitest-axe` 检查无障碍规则 |
| 本地 PR 回归 | `pnpm test:pr` | 日常单元、服务、状态、jsdom 组件和未标记 `@migration` 的中央 E2E |
| 文档、源码与工程契约 | `pnpm test:contracts` | [contracts 项目](../../vitest.config.ts)，含静态界面契约、Markdown 链接、Git 钩子和提交说明工具 |
| 历史数据受控迁入 | `pnpm test:migration` | [migration 项目](../../vitest.config.ts)、`@migration` 中央 E2E 和独立构建的发票迁入 E2E |
| 完整 Vitest 回归 | `pnpm test` | unit、unit-heavy、component、contracts、migration 五个项目。推送钩子与按需 CI quality 使用此入口 |
| 真实浏览器组件行为 | Vitest Browser、Playwright provider、`vitest-browser-vue`：`pnpm test:browser` | [独立配置](../../vitest.browser.config.ts)，Chromium 多视口 |
| 跨页面流程 | Playwright：`pnpm test:e2e`；精确文件用 `pnpm exec playwright test <files...>` | [E2E 配置](../../playwright.config.ts)，排除专用视觉矩阵；默认 E2E 不写存档截图 |
| 专用视觉矩阵 | Playwright：`pnpm test:visual` | [视觉配置](../../playwright.visual.config.ts)，固定 Windows/Chromium 与隔离演示服务 |
| 应用及 E2E 类型 | `pnpm typecheck` | 依次检查 Nuxt 应用、`e2e/**/*.ts` 和 Playwright 配置。单独检查 E2E 可运行 `pnpm typecheck:e2e` |
| 已纳入的工资测试类型 | `pnpm exec vue-tsc --noEmit -p tests/payroll/tsconfig.json` | 仅[配置](../../tests/payroll/tsconfig.json)显式纳入的文件及依赖 |
| 循环依赖 | dpdm：`pnpm check:cycles` | [配置](../../dpdm.config.ts)覆盖的应用与服务端 TS 模块；调整模块边界或抽取共享逻辑后运行 |
| 依赖重复版本 | node-modules-inspector：`pnpm check:deps` | [配置](../../node-modules-inspector.config.ts)；新增、升级依赖后运行 |
| Markdown 相对链接 | `pnpm check:links` | 全仓已跟踪 Markdown；提交钩子只拦截本次引入的断链 |

`pnpm test` 不包含浏览器组件、E2E 或视觉矩阵。浏览器组件、工资测试类型、循环依赖与依赖重复检查目前也未接入推送钩子和 CI，涉及这些文件时须单独选择对应本地入口。钩子实际执行范围见 [Git 工作流](../agents/git-workflow.md)，远端套件见 [CI 使用规则](../agents/ci-usage.md)。

视觉矩阵只在测试页面加载 [Noto Sans SC 测试字体](../../tests/fixtures/visual-font/NotoSansSC-variable.ttf)，不修改产品字体。该文件来自 [Google Fonts 官方仓库](https://github.com/google/fonts/tree/main/ofl/notosanssc)，上游版本 2.004（`notofonts/noto-cjk` 提交 `523d033d6cb47f4a80c58a35753646f5c3608a78`），Google Fonts 文件的 Git blob 为 `fb0637bafbcd804fe32152370a1225990745b4bc`，SHA-256 为 `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`；许可见同目录 [OFL.txt](../../tests/fixtures/visual-font/OFL.txt)。测试显式确认常用字重加载成功，加载失败时不得以系统字体替代生成基线。基线调整须逐项复核差异，保留布局、焦点和交互断言。

### Vitest 本地缓存

`pnpm test`、`test:unit`、`test:components` 在已忽略的 `.tmp/` 下保留两类缓存，跨次运行复用：

| 缓存 | 位置 | 失效方式 | 清除 |
| --- | --- | --- | --- |
| 模块转译（Vitest 实验特性 `experimental.fsModuleCache`） | `.tmp/vitest-cache/` | Vitest 按文件内容、配置与依赖版本自动判定 | `pnpm exec vitest --clearCache`（同时清除结果缓存），或删除目录 |
| 冷进程入口预打包及默认全量迁移后的内存库快照（[全局准备](../../tests/global-setup.ts)） | `.tmp/vitest-fixtures-v2/` | 按源码和工具版本的内容键、清单及产物摘要校验复用；预打包键还包含构建选项，并发生成各使用独立目录 | 测试不自动删除；处理前核对归属、路径及进程占用 |
| 按身份缓存的正式库测试种子 | `.tmp/vitest-fixtures-v2/production-storage-seed/` | 按身份和正式库结构换键，复用前只读冷核数据库；并发种子各用独立目录 | 测试不自动删除；处理前核对归属、路径及进程占用 |
| 旧版测试缓存 | `.tmp/vitest-fixtures/` | 保留已有内容，不再由新测试种子清理 | 处理前核对归属、路径及进程占用 |

使用 `testTempRoot()` 的 Vitest 测试为每个测试文件创建独立的 `.tmp/vitest-runs/test-*` 目录；结束钩子保留目录及合成数据，包括测试数据库，不自动删除。后续处理前须核对归属、路径、重解析点及活动进程；无法核实则保留。Playwright 的既有临时产物暂不使用这一机制。

过期风险：转译缓存是实验特性，改动 Vite 插件、别名或升级依赖后若出现无法解释的旧行为，先清除再复现；预打包把 `node_modules` 中的包留作外部依赖、运行时现读，不计入内容键。测试准备期间应保持相关源码稳定；并发生成的同键内容不一致会在后续扫描时拒绝复用。缓存只含转译产物、迁移后空库与建库后空库，不保存任何用例写入的数据或业务状态。

E2E 分三个项目（[E2E 配置](../../playwright.config.ts)）：

| 项目 | 范围 | 服务与并发 |
| --- | --- | --- |
| `chromium`、`chromium-b` | 中央 spec 按文件名排序后交替分组 | 各连一个独立 dev server（默认端口 3100、3102，可用 `PLAYWRIGHT_PORT`、`PLAYWRIGHT_PORT_B` 改；第二个用 `.tmp/e2e-nuxt-b` 作构建与 Vite 缓存目录），组内 1 个 worker |
| `production` | `production-*.spec.ts` | 用 `pnpm test:production` 构建并启用全部专项；各 spec 自启生产入口、空闲端口与独立合成数据目录，3 个 worker；单项调试须满足对应显式启用条件；只选本项目时不启动 dev server |

完整生产验收使用 `pnpm test:production`（[执行入口](../../scripts/run-production-acceptance.mjs)）：先构建默认生产产物，再构建带发票验收层的独立产物，显式启用普通生产、发票、更正和公司付款专项，并创建独立下载目录。全部 production 用例运行后，报告中出现跳过、失败、重试或没有实际执行项均视为未通过。本地与 CI 使用同一入口；单项调试仍保留各 spec 的显式启用及隔离入口校验。合成数据库与原件均位于项目临时目录，不连接用户数据；运行结束后的清理遵循项目临时文件规则。

受控迁入专项覆盖旧源验证、预检、接管、重复提交与危险恢复。维护 [Vitest 项目](../../vitest.config.ts)和 Playwright `@migration` 标签时按用例职责选择。数据库启动与升级、日常写入和命令恢复保留在本地 PR 回归。`pnpm test:migration` 中的发票生产 E2E 使用同一[生产验收入口](../../scripts/run-production-acceptance.mjs)，仅构建带发票验收层的隔离产物，沿用完整生产验收的报告判定。`pnpm test:pr` 和 `pnpm test:migration` 的中央 E2E 均启动本地双组服务。连接外部测试服务时，使用 `pnpm test:e2e --project=chromium` 并按需加 `--grep=@migration` 或 `--grep-invert=@migration`。

迁入验收会重置所在 dev server 的默认中央仓库，每案独占重置、接管和回读旅程，因此中央组内只用一个 worker；两组的中央仓库在各自进程内存中，互不可见；截图基线两组共用 `chromium` 文件名。普通页面夹具按测试会话隔离；并行批次须避开迁入仓库。只选一个中央项目时只启动该组服务；大型本地回归应分文件批次重启服务，避免长期运行的开发服务耗尽内存。设置 `PLAYWRIGHT_BASE_URL` 连接外部服务时只保留单个中央项目、1 个 worker。命令行选项目时用 `--project=<名称>`：`--project <名称>` 会把后面的文件路径也当作项目名。

浏览器交互与 `page.request` 共同造数或回读时，在浏览器 context 上设置同一个具名测试会话头；仅在 page 上设置不会自动应用到 API 请求。敏感资料用例显式申请具名测试会话的最小权限并在重置时撤销，同时保留未授权拒绝的验证。需要正式构建及独立存储的验收写在 `production-*.spec.ts`，不要混入仅启动开发服务的普通 E2E；像素基线放入 Windows 视觉配置并加载已固定的测试字体。

## 模块入口

| 模块 | 逐文件清单 |
| --- | --- |
| 工资、考勤与点工 | [payroll](./modules/payroll.md) |
| 工程量与空鼓检查 | [quantity](./modules/quantity.md) |
| 进度、工序库与 WBS | [schedule](./modules/schedule.md) |
| 目标成本与成本归集 | [target-cost](./modules/target-cost.md) |
| 工程量清单与月报 | [boq](./modules/boq.md) |
| 客户 | [customer](./modules/customer.md) |
| 供应商与资质 | [supplier](./modules/supplier.md) |
| 班组、工人与花名册 | [crew-worker](./modules/crew-worker.md) |
| 项目与阶段任务 | [project](./modules/project.md) |
| 项目供应商 | [project-supplier](./modules/project-supplier.md) |
| 合同与其他结算 | [contracts](./modules/contracts.md) |
| 业主／分包商务单据 | [commercial-documents](./modules/commercial-documents.md) |
| 物资与价格 | [material](./modules/material.md) |
| 小票与送货档案 | [delivery](./modules/delivery.md) |
| 财务收付与审批 | [finance](./modules/finance.md) |
| 发票与税额工具 | [invoice](./modules/invoice.md) |
| OCR 通用识别 | [ocr](./modules/ocr.md) |
| 通用导入导出 | [import-export](./modules/import-export.md) |
| 通用主数据 | [master-data](./modules/master-data.md) |
| 首页与看板 | [home](./modules/home.md) |
| 导航、页签与恢复 | [navigation](./modules/navigation.md) |
| 通用界面与交互 | [ui](./modules/ui.md) |
| 核心身份迁移 | [migration](./modules/migration.md) |
| 生产访问、备份与存储 | [production](./modules/production.md) |
| 数据库、会话与基础工具 | [core](./modules/core.md) |
| 跨业务页面与流程 | [cross-domain](./modules/cross-domain.md) |
| 文档契约与工程工具 | [documentation-tooling](./modules/documentation-tooling.md) |
| 测试基础设施 | [test-infrastructure](./modules/test-infrastructure.md) |

## 维护与核对

每个文件按主要业务归属登记一次，同一业务的组件、store、服务、数据库和 E2E 放在同一模块。新增、删除、改名时更新相应清单；检查 `tests/`、`e2e/` 及目录外新增测试，保持链接有效。

模块清单只记录文件归属和定位，不评定测试价值或业务验收状态。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核；跨模块关系在备注或总索引说明。

辅助文件和检入的截图基线单列；日志、报告、缓存和生成截图不作测试源文件。生产代码中的 `*-test-instance.ts` 是被测实现。审查断言时连同夹具和相邻用例阅读，区分静态登记检查与实际业务行为验证。

## 编写规范

新增或修改测试前，先在模块清单里检索同一行为是否已有测试；有就扩展原用例，不另写一份。

### 断言

Vitest 测试启用 `test/valid-expect`、`test/valid-expect-in-promise` 和 `test/expect-expect`，检查断言语法、未等待的异步断言以及测试没有断言；`test/require-to-throw-message` 和 `test/no-restricted-matchers` 分别拦截无参的抛错负例和 `rejects.toBeDefined()`。这些规则覆盖 `tests/` 下的 Vitest 测试，由 ESLint 和暂存检查执行，不替代对错误原因是否正确及重复行为的人工审查；浏览器端 Playwright 测试按其自身规则检查。`valid-expect` 允许 `expect` 的第二个说明参数；插件固定为 1.6.28，以支持合法的 `expect.any`。少数异步旅程必须先绑定断言、触发完成再等待，以避免未处理拒绝；仅在对应行注明原因并关闭误报，不改变时序。少数在辅助函数中完成断言的测试只在对应文件登记具体函数名，不全局放宽。

| 不要这样写 | 应该这样写 |
| --- | --- |
| 不带参数的 `toThrow()`、`rejects.toThrow()`、`rejects.toBeDefined()` | 断言具体错误文案或 problem code；任何异常都能让无参断言通过 |
| 预期值由被测函数算出，或从演示 seed 的当前数据读取 | 预期值写成字面量，并在旁边注明计算依据 |
| 可以确定的值用 `expect.any(Number)` 代替 | 断言具体值；验证"没有变化"时比较前后数量相等 |
| 用裸 SQL 写入再读回，自己证明自己 | 走真实的仓库、服务或 HTTP 写路径，再从读路径核对 |
| 空测试、占位用例、只有前置步骤没有断言 | 删除；每个用例至少有一条针对被测行为的断言 |
| 断言列名、字段名清单，镜像实现结构 | 断言行为：能写入、能拒绝、读出的值 |
| 锁定历史调研报告、台账正文或当前记录总数 | 只断言现行规格；数量核对完整集合，不固定当前总数 |

同一规则的金额、税率、状态、权限、日期和错误输入用具名案例表参数化，每个案例独立初始化、执行和清理。业务限额和历史证据身份作为明确契约校验。

### 负例与边界

规格中的金额、数量、日期、状态和权限规则，按"正例 + 负例 + 边界"三类各至少一案，并在用例旁注明规格出处（文件:行号）：

```text
余量 = 10
  等于余量 10       → 通过（边界正例）
  超出余量 1 → 11   → 拒绝，断言具体原因
  日期早于检查日 1 天 → 拒绝，断言具体原因
  零额 / 负数        → 按规格通过或拒绝，不能没有覆盖
```

伪造字段、多余字段单独成案，不要混在正例的输入里。

### 去重与结构

- 同一行为只在最低的合适层验证：纯规则用单元测试，交互用组件测试，E2E 只覆盖跨页面旅程，不重复下层已覆盖的分支。
- 结构几乎相同的成对测试（如 C1/C2）用 `describe.each` / `it.each` 参数化，不要复制成两个文件。
- 参数只影响最后一步时，公共前置放进 `beforeAll` 并导出快照，每个案例克隆后只执行变化的那一步：

```text
不要  it.each(cases): 建库 → 主档 → 考勤 → 生成批次 → 发放(case)
应该  beforeAll: 建库 → 主档 → 考勤 → 生成批次 → 导出快照
      it.each(cases): 克隆快照 → 发放(case) → 断言
```

- 每个案例都相同的正向断言单独写一案，案例表只断言各案例之间的差异。
- E2E 视口：业务断言只在一档宽度跑一次；布局（溢出、局部滚动、入口可见）在同一用例内循环 `RESPONSIVE_WIDTHS` 检查，不按"页面 × 宽度"生成用例。
- E2E 不写存档截图：失败时 Playwright 自动截图；需要像素比对的放进视觉配置用 `toHaveScreenshot`。不得向仓库已跟踪目录写文件。
- 只断言"某入口不存在"的过渡契约合并到一个用例，并在注释写明承接的 Issue。

### 命名

- 标题写"在什么条件下、什么行为、得到什么结果"，并且与断言内容一致。
- 同一文件内不能有同名用例；参数化标题用具名字段（如 `'$label'`），不用 `%#` 或"输入案例 N"。

### 数据、资源与时间

- 需要已迁移的内存库时用 [`createMigratedMemoryDb()`](../../tests/helpers/memory-db.ts)（整次运行由全局准备迁移一次并按迁移源码哈希缓存快照，各用例克隆）；只有验证迁移本身、空库或指定旧版本时，才用 `createMemoryDb()` 加 `runMigrations`。
- 正式库夹具在新建的空数据目录上用 [`createSeededProductionStorage()`](../../tests/helpers/production-storage-seed.ts)（复制同身份种子库后打开，仍走完整打开校验）；验证建库、升级、结构或空目录行为的用例直接用 `createProductionStorage()`。
- 冷恢复与独立服务进程用 [`runColdProcess` / `spawnColdProcess`](../../tests/helpers/cold-process.ts) 启动预打包入口，新入口登记到[全局准备](../../tests/global-setup.ts)的 `COLD_ENTRIES`；子进程仍须独立启动并从磁盘重开数据库，不得复用测试进程内存状态。
- 每个打开的库都要在 `afterEach` 或 `finally` 中 `close()`；`vi.stubGlobal`、`vi.spyOn`、`vi.useFakeTimers` 在同一文件的 `afterEach` 中恢复。
- 写入旅程由每个案例创建正式主档，或安装隔离的受控迁移来源，并使用回执 ID；演示记录只用于明确授权的只读场景。
- 涉及当前时间时使用受控时钟或已有的时间注入；等待以页面状态、响应或时钟事件为准，不用固定延时。
- 单条用例应在默认并发下数秒内完成；重夹具改为复用快照，不靠调大超时来掩盖。新增冷进程、整库迁入或正式库读写文件时，确认其路径落入 [`HEAVY_UNIT_TESTS`](../../vitest.config.ts)，不能归类时补登记。
- 布局、滚动与焦点在真实浏览器中验证；[浏览器组件配置](../../vitest.browser.config.ts)会预扫全部组件的 UnoCSS 样式。
