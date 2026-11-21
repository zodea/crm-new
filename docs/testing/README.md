# 测试入口与模块索引

按受影响行为选择测试层，再到模块清单定位文件。清单只记录归属与查找线索，不代表覆盖率或业务验收通过。

## 运行与类型检查入口

命令以 [package.json](../../package.json) 为准；下表说明各入口的覆盖边界。

| 用途 | 工具与入口 | 范围 |
| --- | --- | --- |
| 提交前快速检查 | `pnpm test:fast` | Vitest 按本地变更及依赖关系选择 unit 用例；可追加 Git 基准，如 `pnpm test:fast origin/main` |
| 合并前检查 | `pnpm test:pr` | 全部单元与 jsdom 组件、并行 UI 和三个中央 E2E 分片；共享响应式矩阵使用 390、1024、1440px |
| 发布前浏览器全量验收 | `pnpm test:nightly` | Windows 下运行单元与 jsdom、完整五档浏览器组件、全部行为 E2E（含正式来源）和视觉矩阵 |
| 单元、服务、状态及静态契约 | Vitest：`pnpm test:unit` | [unit 项目](../../vitest.config.ts)，排除组件与浏览器目录 |
| jsdom 组件 | Vitest、Vue Test Utils、Testing Library：`pnpm test:components` | [component 项目](../../vitest.config.ts)；部分用例使用 `vitest-axe` 检查无障碍规则 |
| 单元与 jsdom 组件合并 | `pnpm test` | 仅以上两个项目 |
| 真实浏览器组件行为 | `pnpm test:browser`；完整五档用 `pnpm test:browser:full` | 日常财务流程在 1280px 执行业务步骤，对已挂载状态复核五档几何；其余组件在 390、1024、1440px 检查。完整矩阵在每个视口重新执行全部交互。见[浏览器配置](../../vitest.browser.config.ts) |
| 跨页面流程 | Playwright：`pnpm test:e2e`；精确文件用 `pnpm exec playwright test <files...>` | [E2E 配置](../../playwright.config.ts)，排除专用视觉矩阵；其他 E2E 仍可含截图断言 |
| 专用视觉矩阵 | Playwright：`pnpm test:visual` | [视觉配置](../../playwright.visual.config.ts)，固定 Windows/Chromium 与隔离演示服务 |
| 桌面 Rust | `cargo test --manifest-path src-tauri/Cargo.toml --locked` | 需要 Rust／Tauri 本机构建环境 |
| 应用类型 | `pnpm typecheck` | Nuxt 项目类型；不覆盖普通测试、E2E 和测试配置的整体类型检查 |
| 已纳入的工资测试类型 | `pnpm exec vue-tsc --noEmit -p tests/payroll/tsconfig.json` | 仅[配置](../../tests/payroll/tsconfig.json)显式纳入的文件及依赖 |

`pnpm test` 不包含浏览器组件、E2E、视觉矩阵或 Rust。浏览器组件与工资测试类型检查目前也未接入推送钩子和 CI，涉及这些文件时须单独选择对应本地入口。钩子实际执行范围见 [Git 工作流](../agents/git-workflow.md)，远端套件见 [CI 使用规则](../agents/ci-usage.md)。

普通 E2E 最多同时运行四个 worker。可并行的 UI 用例共用当次构建的服务。中央测试按文件分为三片，每片独占一个回环开发服务，片内串行完成重置、接管及回读。依赖开发 Mock 面板或 Vite 源模块的用例也由开发服务执行。正式来源用例自行启动隔离实例，最多两个 worker。显式选择旧的 `--project=chromium` 时仍可串行使用开发服务。指定 `PLAYWRIGHT_BASE_URL` 时共用显式服务，保持单 worker。视觉验收继续使用带演示标识的 Windows 开发服务。

付款申请的开发环境禁写行为由 [finance-forms](../../e2e/finance-forms.spec.ts) 验证。可写表单的键盘及横滚由 [正式来源用例](../../e2e/production-other-settlements.spec.ts) 启动正式构建和隔离合成数据库验证。

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

每个文件按主要业务归属登记一次，同一业务的组件、store、服务、数据库和 E2E 放在同一模块。新增、删除、改名时更新相应清单；检查 `tests/`、`e2e/`、`src-tauri/tests/`、Rust 内联测试及目录外新增测试，保持链接有效。

辅助文件和检入的截图基线单列；日志、报告、缓存和生成截图不作测试源文件。生产代码中的 `*-test-instance.ts` 是被测实现。审查断言时连同夹具和相邻用例阅读，区分静态登记检查与实际业务行为验证。

Playwright 用例通过 `testInfo.outputPath()` 保存截图到该次运行的产物目录。固定像素基线由视觉配置维护。几何对齐断言比较主表及左右固定区对应列的两侧边缘，使用普通浏览器测试配置运行。

E2E 的 ESLint 规则拦截空测试体、无参 `toThrow()` 和 `rejects.toBeDefined()`。Vitest 也检查正向无参抛错与弱拒绝断言，历史例外按文件与规则记在 [ESLint 基线](../../eslint-suppressions.json)。测试夹具使用 `createMigratedMemoryDb()` 复用当前隔离测试环境中的空库迁移快照，每次打开独立连接；验证迁移过程时用空库或原版本字节。打开后登记关闭回调，也可在 `finally` 中关闭。

同一规则的金额、税率、状态、权限、日期和错误输入按具名案例表参数化，每案独立初始化、执行和清理。预期结果独立记录，不能用被测计算器生成；业务限额和历史证据身份仍作为明确契约校验。涉及当前时间时使用受控时钟或已有时间注入；等待以页面状态、响应或时钟事件为准。

写入旅程由每案创建正式主档或安装隔离的受控迁移来源，并使用回执 ID；演示记录只用于显式授权的只读场景。页面、报告和图形数量核对独立文件或登记数据的完整集合，避免固定当前总数。布局、滚动与焦点在真实浏览器验证；[浏览器组件配置](../../vitest.browser.config.ts)预扫全部组件的 UnoCSS 样式。
