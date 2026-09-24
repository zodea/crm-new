# CI 按需调用与费用预估

本仓库的 GitHub Actions CI 只允许通过 `workflow_dispatch` 手动调用，不随提交、PR 或合并自动运行。目标是在不跳过必要验证的前提下，避免重复消耗私有仓库的 Actions 分钟。

## 调用前协议

调用者必须先完成以下步骤，并在触发 workflow 前向用户报告：

1. 检查待验证的提交范围和改动文件。
2. 说明准备运行的套件、选择理由和精确 E2E 文件（如有）。
3. 基于最近成功运行估算 runner-minutes；额度已耗尽时，同时给出按当前费率计算的理论费用。
4. 等用户明确确认后再调用。

触发后先返回 workflow run 链接，不为等待完整结果长时间阻塞当前会话。需要最终结果或实际用量时，再读取该 run 的 job 时长并回报。

## PR 依赖链与 CI 批次

- 先检查 PR 依赖图，再决定验证对象：没有后置分支的叶子 PR，可以在提交范围冻结并经用户确认后单独调用所需套件。
- 有后置分支的前置 PR 不单独重复调用 CI；等待整条依赖链的提交范围冻结后，以最末端叶子分支的最终提交作为一次集成验证范围。
- 同一条依赖链只保留一次集成 CI 结果，避免父 PR 和子 PR 对相同基础改动重复消耗 runner-minutes。
- CI 结果绑定提交 SHA，不锁定 PR，也不禁止继续修改。CI 之后追加 commit、amend、rebase 或 force-push 都会产生新 SHA；旧结果视为失效，只对新提交按需重跑。
- 后置分支在前置分支变更后必须重新同步，再重新计算验证范围；不得沿用前置分支变更前的旧 CI 结果。
- 只有在用户确认并完成提交/推送后才触发远端 Actions；本地分支整理和本地测试不消耗 GitHub Actions 配额。

## 批次验证规则

- 单个 PR 创建、更新和合并时不自动调用 GitHub Actions；经用户确认后，无后置依赖的叶子 PR 才可按需手动调用 `quality` 或其他必要套件。
- `e2e + visual` 以合并批次为单位：先将一批 PR 合并到 `main`，批次结束后再对当前 `main` 手动运行一次。
- 调用前用“上一批次已验证提交..当前 `main`”作为待验证范围，汇总这一批 PR 的改动后再决定运行全量或精确 E2E。
- 不得为了给每个 PR 单独生成检查结果而重复运行 `e2e` 或 `visual`。
- `quality` 也不自动运行；只有用户单独要求、批次验证前置检查或发布验收时才手动调用。

## 套件选择

| 套件 | 必须运行的典型改动 | 通常不需要运行 |
| --- | --- | --- |
| `quality` | JavaScript/TypeScript/Vue、依赖、Nuxt/Vite/Vitest/ESLint 配置、单元或组件测试 | 纯文档、截图或研究材料 |
| `e2e` | 跨页面业务流程、路由/状态/持久化联动、浏览器原生交互、上传下载、焦点/浮层/拖拽等行为 | 纯样式、纯文案、已被单测充分覆盖的纯函数 |
| `visual` | 布局、样式令牌、响应式、表格密度、弹窗层级、页面外壳、视觉基线或截图断言 | 纯数据逻辑、API、数据库迁移、不可见重构 |
| `rust` | `src-tauri/`、Cargo 配置、桌面命令或 Rust 数据层 | 仅 Web 前端和文档 |

同时涉及行为与视觉时可以组合调用 `e2e + visual`。只有测试基础设施、全局框架、依赖大升级或发布前总验收才运行全部套件。

E2E 默认应传 `e2e_targets`，只运行与改动对应的 Playwright 文件。只有跨域基础设施变更或无法可靠缩小范围时才留空并运行全部 E2E。

## 估算基线

以下数据来自 2026-07-28 前最近一次成功的 GitHub-hosted runner：

| 套件 | Runner | 参考用时 |
| --- | --- | ---: |
| `quality` | Ubuntu | 约 4 分钟 |
| 全量 `e2e` | Ubuntu | 约 16 分钟 |
| `rust` | Windows | 约 9 分钟 |
| `visual` | Windows | 首次成功运行前暂按 8–15 分钟估算 |

精确 E2E 调用先用 `pnpm exec playwright test <files...> --list` 统计目标测试数，再结合全量基线保守估算；至少预留 2 分钟给 runner 初始化、依赖和浏览器准备。

费率和免费额度以 [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) 为准。当前标准 runner 超额参考价为 Ubuntu `US$0.006/分钟`、Windows `US$0.010/分钟`；预估时优先报告 runner-minutes，美元金额只作为辅助。
