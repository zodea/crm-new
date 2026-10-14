# 测试入口与模块索引

按受影响行为选择测试层，再到模块清单定位文件。清单只记录归属与查找线索，不代表覆盖率或业务验收通过。

## 运行与类型检查入口

命令以 [package.json](../../package.json) 为准；下表说明各入口的覆盖边界。

| 用途 | 工具与入口 | 范围 |
| --- | --- | --- |
| 单元、服务、状态及静态契约 | Vitest：`pnpm test:unit` | [unit 项目](../../vitest.config.ts)，排除组件与浏览器目录 |
| jsdom 组件 | Vitest、Vue Test Utils、Testing Library：`pnpm test:components` | [component 项目](../../vitest.config.ts)；部分用例使用 `vitest-axe` 检查无障碍规则 |
| 单元与 jsdom 组件合并 | `pnpm test` | 仅以上两个项目 |
| 真实浏览器组件行为 | Vitest Browser、Playwright provider、`vitest-browser-vue`：`pnpm test:browser` | [独立配置](../../vitest.browser.config.ts)，Chromium 多视口 |
| 跨页面流程 | Playwright：`pnpm test:e2e`；精确文件用 `pnpm exec playwright test <files...>` | [E2E 配置](../../playwright.config.ts)，排除专用视觉矩阵；默认 E2E 不写存档截图 |
| 专用视觉矩阵 | Playwright：`pnpm test:visual` | [视觉配置](../../playwright.visual.config.ts)，固定 Windows/Chromium 与隔离演示服务 |
| 桌面 Rust | `cargo test --manifest-path src-tauri/Cargo.toml --locked` | 需要 Rust／Tauri 本机构建环境 |
| 应用类型 | `pnpm typecheck` | Nuxt 项目类型；不覆盖普通测试、E2E 和测试配置的整体类型检查 |
| 已纳入的工资测试类型 | `pnpm exec vue-tsc --noEmit -p tests/payroll/tsconfig.json` | 仅[配置](../../tests/payroll/tsconfig.json)显式纳入的文件及依赖 |

`pnpm test` 不包含浏览器组件、E2E、视觉矩阵或 Rust。浏览器组件与工资测试类型检查目前也未接入推送钩子和 CI，涉及这些文件时须单独选择对应本地入口。钩子实际执行范围见 [Git 工作流](../agents/git-workflow.md)，远端套件见 [CI 使用规则](../agents/ci-usage.md)。

E2E 默认使用一个 worker：迁入验收会重置共享的默认中央仓库，每案独占重置、接管和回读旅程。普通页面夹具按测试会话隔离；并行批次须避开迁入仓库。

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

## 编写规范

新增或修改测试前，先在模块清单里检索同一行为是否已有测试；有就扩展原用例，不另写一份。

### 断言

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

- 需要已迁移的内存库时用 [`createMigratedMemoryDb()`](../../tests/helpers/memory-db.ts)（每个 worker 只迁移一次，之后克隆）；只有验证迁移本身、空库或指定旧版本时，才用 `createMemoryDb()` 加 `runMigrations`。
- 每个打开的库都要在 `afterEach` 或 `finally` 中 `close()`；`vi.stubGlobal`、`vi.spyOn`、`vi.useFakeTimers` 在同一文件的 `afterEach` 中恢复。
- 写入旅程由每个案例创建正式主档，或安装隔离的受控迁移来源，并使用回执 ID；演示记录只用于明确授权的只读场景。
- 涉及当前时间时使用受控时钟或已有的时间注入；等待以页面状态、响应或时钟事件为准，不用固定延时。
- 单条用例应在默认并发下数秒内完成；重夹具改为复用快照，不靠调大超时来掩盖。
- 布局、滚动与焦点在真实浏览器中验证；[浏览器组件配置](../../vitest.browser.config.ts)会预扫全部组件的 UnoCSS 样式。
