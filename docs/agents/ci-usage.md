# CI 按需调用与费用预估

实际任务定义在 [ci.yml](../../.github/workflows/ci.yml)，仅由 `workflow_dispatch` 手动触发。调用授权按根 `AGENTS.md` 执行。

## 提交范围与批次

| 验证对象 | 执行边界 |
| --- | --- |
| 无后置依赖的叶子 PR | 提交范围冻结后，可按需调用 `quality` 或其他必要套件 |
| 有后置依赖的 PR 链 | 前置分支不重复运行；在最末端叶子分支范围冻结后做一次集成验证 |
| `e2e + visual` | 一批 PR 合并到 `main` 后按需运行一次，不逐 PR 调用 |

CI 结果只适用于对应 SHA；后续 commit、amend 或 rebase 后重新判断验证需要。前置分支变化时先同步后置分支，再确定新的集成范围。

运行 `quality` 时，明确并核实 `base_sha`，批次通常使用上一批已验证 SHA，以 `base_sha..目标SHA` 检查本次改动。**当前 workflow 在基准为空或无效时会静默回退到 `HEAD^`，lint 可能只检查最后一个提交。** 多提交范围必须传有效基准，并核对运行日志。

E2E 默认传 `e2e_targets` 指定相关 Playwright 文件；跨域基础设施变更或无法可靠缩小范围时才留空。触发后返回 run 链接，结果注明实际 SHA、套件与文件范围。

E2E 在 CI 中先检查两个项目的目标合计非空，再将 `chromium`、`chromium-b` 各按文件分成八批，共十六个独立任务；每个任务独立启动服务并保存 JSON 结果与浏览器诊断。E2E 和视觉检查的开发服务初次启动时以隔离浏览器确认对应外壳加载完成，再开始业务用例；预热失败即停止，不改变业务断言或超时。允许单组或单批没有匹配项，但整体没有匹配项仍失败。静态生成、生产构建及浏览器服务在对应 CI 步骤设置 Node 堆上限 4096 MiB；运行失败或跳过仍须按实际结果处理。

生产验收统一运行 `pnpm test:production`，分别构建默认产物和 `.tmp` 下包含发票验收层的独立产物，显式启用各专项并提供新建下载目录；任何跳过或未通过均使入口失败。导入、发票及辅助合同专项使用显式隔离入口，保留构建与合成数据目录的校验。正式服务验收应归入 `production-*.spec.ts`，普通 E2E 不提供生产构建。

每个 E2E 批次的任务上限为 35 分钟；十六批各用独立 runner，合计上限 560 runner-minutes，不改变单个测试的超时或断言。触发前仍须按实际范围估算费用并取得授权。

## 套件选择

| 套件 | 实际执行 | 适用改动 |
| --- | --- | --- |
| `quality` | diff 范围 ESLint、Nuxt 类型检查、Vitest 单元/jsdom 组件、静态生成 | JS/TS/Vue、依赖、框架或测试配置 |
| `e2e` | Playwright 行为测试 | 跨页面流程、路由/状态/持久化、上传下载、焦点/浮层/拖拽 |
| `production-acceptance` | 构建生产产物，以独立合成目录运行 production Playwright 项目 | 生产入口、持久化及备份相关验收；查看报告中的执行与跳过 |
| `visual` | Windows/Chromium 专用视觉矩阵 | 布局、令牌、响应式、表格密度、页面外壳和截图断言 |

按影响组合套件；全部远端套件仅用于跨层基础设施、依赖大升级或发布总验收。纯文档通常不需要远端 CI。现有 CI 没有独立浏览器组件或普通测试整体类型检查任务，其本地入口与覆盖范围见 [测试入口](../testing/README.md)。

## 费用预估

按最近成功运行的 job 时长、runner 类型和本次文件范围估算 runner-minutes；精确 E2E 可用 `pnpm exec playwright test <files...> --list` 核对测试数，并预留安装和浏览器准备时间。

费率及免费额度以 [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) 为准；需要金额时再核对现行费率与可用额度。运行结束后以实际 job 时长核对估算。
