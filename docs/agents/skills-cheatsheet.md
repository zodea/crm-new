# Skills 路由速查

技能清单由运行环境动态提供，名称和可用性会变化。本文件不再复制全局技能全集，只记录本仓库稳定的选择原则；实际执行前以当前会话的技能目录为准。

| 工作 | 优先技能 |
| --- | --- |
| Vue / Nuxt 实现 | `vue-best-practices`，再按需加载 `vue`、`nuxt`、`vue-router-best-practices`、`vueuse-functions`、`unocss` |
| Vue / E2E 测试 | `vue-testing-best-practices`、`vitest` |
| 包管理与构建 | `pnpm`、`vite` |
| 难 bug 或性能回归 | `diagnosing-bugs` |
| 测试先行实现 | `tdd` |
| 本地改动审查 | `code-review` |
| 模块接口与架构深化 | `codebase-design`、`improve-codebase-architecture` |
| 领域术语或 ADR | `domain-modeling`；需要对话压测时用 `grill-with-docs` |
| 方案压力测试 | `grill-me` / `grilling` |
| 规格与 Issue 拆分 | `to-spec`、`to-tickets`、`triage` |
| 大范围复核与路线 | `wayfinder`；逐模块按 [复核规程](module-review.md) 记录证据、决定和真实业务问题 |
| 会话交接 | `handoff` |

规则：

- 用户显式点名技能时，按当前技能说明执行。
- 技术栈任务先加载对应技能，不凭旧代码或本文件里的简述替代技能正文。
- 技能不可用时说明并采用最接近的仓库工作流，不为此创建假的本地命令。
- 不再记录 Claude 专属路径、已删除斜杠命令、某次全局技能版本或“只能手动触发”快照。

## Matt Pocock 技能维护

- 上游权威源为 [`mattpocock/skills`](https://github.com/mattpocock/skills)，安装和更新方式以上游 README 为准。
- Codex 等 agent 使用 `npx skills@latest add mattpocock/skills` 安装；全局已安装技能使用 `npx skills@latest update -g` 更新。
- 更新后核对上游删除项并清理本地旧副本；不要继续引用已由 `to-spec`、`to-tickets` 取代的 `to-prd`、`to-issues`。
- 上游要求先为仓库运行一次 `setup-matt-pocock-skills`。本仓库的 issue tracker、分诊标签和领域文档布局已经配置完成，无需在每次更新后重复运行。
