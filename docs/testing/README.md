# 测试文件业务模块索引

本索引保留测试文件原位置，按主要业务责任逐文件分类，供后续 `$prune test`／`prune-tests` 单文件审查选择范围。它是查找入口，不是测试质量评审、覆盖率报告或业务通过证明。

## 范围与分类方法

2026-09-24 工作区盘点包括 `tests/`、`e2e/` 的全部文件，以及 `src-tauri/tests/` 和 `src-tauri/src/lib.rs` 内联测试。共登记 1165 个文件：1030 个含测试的文件、57 个视觉基线、78 个辅助／配置文件。数字仅用于查漏，不表示有效业务场景数量。

每个文件只有一个主模块。组件、store、服务、数据库迁移、生产存储和 E2E 中同一业务的文件归在一起；专用导入导出、OCR、页签恢复仍归相应业务，通用能力单列。确实横跨多个业务的共享行为归跨业务模块；文件内多个领域的断言暂不拆分。文档／静态契约检查、工程工具测试和测试基础设施分别标注。

本次包含盘点时尚未提交的 `tests/browser/`，浏览器配置与依赖正在其他会话调整。其文件以当时工作区为准，不表示该配置已随本索引提交。分类未移动文件、改断言、增加测试或改变运行配置。

## 模块入口

| 模块 | 含测试的文件 | 辅助／配置／基线 | 逐文件清单 |
| --- | ---: | ---: | --- |
| 工资、考勤与点工 | 245 | 45 | [payroll](./modules/payroll.md) |
| 工程量与空鼓检查 | 84 | 7 | [quantity](./modules/quantity.md) |
| 进度、工序库与 WBS | 60 | 6 | [schedule](./modules/schedule.md) |
| 目标成本与成本归集 | 31 | 2 | [target-cost](./modules/target-cost.md) |
| 工程量清单与月报 | 21 | 1 | [boq](./modules/boq.md) |
| 客户 | 22 | 0 | [customer](./modules/customer.md) |
| 供应商与资质 | 55 | 5 | [supplier](./modules/supplier.md) |
| 班组、工人与花名册 | 25 | 0 | [crew-worker](./modules/crew-worker.md) |
| 项目与阶段任务 | 63 | 0 | [project](./modules/project.md) |
| 项目供应商 | 21 | 1 | [project-supplier](./modules/project-supplier.md) |
| 合同与其他结算 | 64 | 0 | [contracts](./modules/contracts.md) |
| 业主／分包商务单据 | 43 | 0 | [commercial-documents](./modules/commercial-documents.md) |
| 物资与价格 | 11 | 1 | [material](./modules/material.md) |
| 小票与送货档案 | 33 | 2 | [delivery](./modules/delivery.md) |
| 财务收付与审批 | 36 | 2 | [finance](./modules/finance.md) |
| 发票与税额工具 | 24 | 1 | [invoice](./modules/invoice.md) |
| OCR 通用识别 | 14 | 0 | [ocr](./modules/ocr.md) |
| 通用导入导出 | 13 | 0 | [import-export](./modules/import-export.md) |
| 通用主数据 | 12 | 0 | [master-data](./modules/master-data.md) |
| 首页与看板 | 7 | 0 | [home](./modules/home.md) |
| 导航、页签与恢复 | 25 | 0 | [navigation](./modules/navigation.md) |
| 通用界面与交互 | 50 | 56 | [ui](./modules/ui.md) |
| 核心身份迁移 | 11 | 0 | [migration](./modules/migration.md) |
| 生产访问、备份与存储 | 13 | 1 | [production](./modules/production.md) |
| 数据库、会话与基础工具 | 24 | 0 | [core](./modules/core.md) |
| 跨业务页面与流程 | 11 | 0 | [cross-domain](./modules/cross-domain.md) |
| 文档契约与工程工具 | 12 | 0 | [documentation-tooling](./modules/documentation-tooling.md) |
| 测试基础设施 | 0 | 5 | [test-infrastructure](./modules/test-infrastructure.md) |

## 工资优先审查的查找顺序

先在 [文档契约清单](./modules/documentation-tooling.md) 定位 `payroll-p5-registration.test.ts` 和 `runtime-reference-audit.test.ts`；文档登记与业务测试分开判断。再从 [工资清单](./modules/payroll.md) 的子模块中选择单个文件，连同它实际使用的夹具及相邻有效测试阅读。下表只提供检索线索，尚未逐条验证这些文件能否抓住所列业务错误。

| 业务风险 | 优先检索的文件名线索／相邻模块 |
| --- | --- |
| 金额精度、舍入、零值 | `amount-integrity`、`rounding`、`DetailPrecision`、`hollow-zero`；基础工具的 `money` |
| 普通／管理簿隔离 | `management-ownership`、`management-ratio`、`book-history-gaps`、`route-scope` |
| 重复提交、失响应恢复与异步竞态 | `commands`、`transactions`、`pending`、`recovery`、`race`；组件和状态层一并读 |
| 已发快照冻结 | `FrozenPrint`、`FrozenOutput`、`ReleasedEvidence`、`workbook-actual-snapshot` |
| 扣款不重复 | 空鼓扣款子模块、`release-adjustments`、`adjustment-chain` |
| 跨月实际收付 | `actual-month-scope`、`actual-payments`、`actual-reversal`；财务与目标成本模块 |
| 事务失败后的数据一致性 | `central-a-transactions`、`central-adjustment-transactions`、`release-safety` |

后续每次审查以一个明确路径调用技能；优化授权、业务条件／动作／结果／防止的实际错误、与已有测试是否重复，仍需在该批次单独核实。批次完成后按仓库规则检查改动范围、运行对应测试和完整用例检查，并检查应用及本批测试的 TypeScript 类型后提交。此索引不预先给出删除结论。

## 运行与类型检查入口

脚本以 [package.json](../../package.json) 为准；运行前查看相应配置，不能把一种运行器通过理解成所有测试都通过。

| 类别 | 当前本地入口与范围 |
| --- | --- |
| 单元／服务／状态、文档契约、工程工具 | `pnpm test:unit`；[vitest.config.ts](../../vitest.config.ts) 的 `unit` 项目 |
| jsdom 组件 | `pnpm test:components`；同一配置的 `component` 项目 |
| 单元与 jsdom 组件合并 | `npm test`；不含独立浏览器配置、E2E、视觉矩阵和 Rust |
| 浏览器组件行为 | `pnpm test:browser`；[vitest.browser.config.ts](../../vitest.browser.config.ts)，盘点时为其他会话未提交配置 |
| E2E | `pnpm test:e2e` 或精确文件；[playwright.config.ts](../../playwright.config.ts) |
| 专用视觉矩阵 | `pnpm test:visual`；[playwright.visual.config.ts](../../playwright.visual.config.ts)，不在普通 E2E 中运行；其他 E2E 仍可含截图断言 |
| 桌面 Rust 测试 | `cargo test --manifest-path src-tauri/Cargo.toml`；需要相应 Rust／Tauri 本机构建环境 |
| 应用类型 | `pnpm typecheck`；Nuxt 应用类型检查不等于普通测试文件全部经过类型检查 |
| 已复核工资测试类型 | `pnpm exec vue-tsc --noEmit -p tests/payroll/tsconfig.json`；当前仅显式纳入 3 个测试文件及其依赖，范围见配置 |

质量与提交规则见 [AGENTS.md](../../AGENTS.md) 和 [Git 工作流](../agents/git-workflow.md)。远端 CI 仍按 [CI 使用规则](../agents/ci-usage.md) 单独确认，本地分类不会触发远端任务。

## 维护与核对

新增、删除、改名测试时同步修改对应模块表；归属变更时移动索引行而非复制。核对 `rg --files tests e2e src-tauri/tests` 与所有模块表的文件行集合一致，再补查 `src-tauri/src/` 中的内联测试，并搜索这些目录之外的新 `*.test.*`／`*.spec.*`。检查每个文件恰有一个主归属、所有链接存在、辅助文件未算作独立测试。

生产代码中的 `*-test-instance.ts` 属于被测实现，本索引不把它们当成测试文件；配置在上表链接，历史运行日志、报告、缓存和生成截图不作为测试源文件登记。已检入 E2E 截图基线单列保存。业务规格仍以 [文档总入口](../README.md) 所指权威源为准；可信测试基线承接见 [Issue #403](https://github.com/zodea/crm-new/issues/403)。
