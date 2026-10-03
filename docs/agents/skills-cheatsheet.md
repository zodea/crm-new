# Skills 路由速查

技术栈技能与使用边界见 [AGENTS.md](../../AGENTS.md#实现规范)。以下按任务选择，以当前技能目录和实际 `SKILL.md` 为准。

| 工作 | 优先技能 |
| --- | --- |
| Vue 测试 | `vue-testing-best-practices`；使用 Vitest 时加载 `vitest` |
| 包管理与构建 | `pnpm`；涉及 Vite 配置或构建时加载 `vite` |
| 难 bug 或性能回归 | `diagnosing-bugs` |
| 测试先行实现 | `tdd` |
| 本地改动审查 | `code-review` |
| 模块接口与架构深化 | `codebase-design`、`improve-codebase-architecture` |
| 领域术语或 ADR | `domain-modeling` |
| 方案压力测试 | `grilling`；用户点名其他技能时加载对应正文 |
| 规格与 Issue 拆分 | `to-spec`、`to-tickets`、`triage` |
| 大范围复核与路线 | `wayfinder`；逐模块按 [复核规程](module-review.md) 记录证据、决定和真实业务问题 |
| 会话交接 | `handoff` |
| 简明图解 | `show-me`；按需内嵌 Markdown 图表 |

用户点名的技能先查实际安装位置；加载失败时说明原因，替换方案须与用户确认。技能中的发布、提交或技术栈默认流程仍受根规则的授权边界约束。

## Matt Pocock 技能维护

仅在技能维护任务中按 [`mattpocock/skills`](https://github.com/mattpocock/skills) 的现行安装说明操作，核对重命名与退役项。本仓库的 Issue、分诊和领域文档布局已配置，无须每次使用技能都重跑初始化。
