# 调研与历史证据

> **本目录是非权威源。** 保留当时的观察、论证与证据，不用于确定当前规格或安排任务。现行约束直接查对应 ADR、组件契约或页面蓝本。

## 索引

| 文档 | 用途 | 现行权威 |
| --- | --- | --- |
| [文档分模块整理清单](./rules-review-inventory-2026-09-23.md) | 用户指定的临时整理入口；按编号核对文件、问题与处置方向，完成后清退 | 各项直接链接对应现行契约，不定义业务规则 |
| [`local-branch-integration-2026-09-10.md`](./local-branch-integration-2026-09-10.md) | 分支整合依据、回归与恢复入口 | 当前 Git 历史及相关决策 |
| [`local-branch-integration-2026-09-05.md`](./local-branch-integration-2026-09-05.md) | 旧分支整合时点的依据与分支头，非当前分支状态 | 当前 Git 历史及后续整合记录 |
| [`module-development-flows.md`](./module-development-flows.md) | 全局及八模块流程方向，不代表完成 | [页面蓝本](../rewrite/pages/) |
| [`kitui-to-shadcn-migration.md`](./kitui-to-shadcn-migration.md) | 已执行迁移的映射与取舍 | [ADR 0008](../adr/0008-adopt-shadcn-vue-on-unocss.md) |
| [`schedule-dependency-editor-brief.md`](./schedule-dependency-editor-brief.md) | 排程依赖编辑器历史设计 | [排程页面](../rewrite/pages/schedule-progress.md)、[ADR 0018](../adr/0018-versioned-schedule-process-library.md) |
| [`browser-audit-2026-09-05.md`](./browser-audit-2026-09-05.md) | 浏览器审计与复现入口 | [实现状态](../design/ui-implementation-status.md)及对应领域规格 |
| [`red-circle-ui-gap-2026-07-11.md`](./red-circle-ui-gap-2026-07-11.md) | 红圈结构与交互走查 | [设计依据](../design/README.md)及对应页面规格 |
| [`architecture-review-2026-07-05.html`](./architecture-review-2026-07-05.html) | 早期架构扫描 | [当前架构](../rewrite/ARCHITECTURE.md) |
| [`invoice-recognition-app-port-plan.md`](./invoice-recognition-app-port-plan.md) | 旧识别应用可迁移能力调查 | ADR 0006、当前 `app/lib/recognize/` |
| [`ocr-recognition-strategy.md`](./ocr-recognition-strategy.md) | OCR 引擎、隐私与成本论证 | ADR 0006 |
| [`ocr-ux-benchmark.md`](./ocr-ux-benchmark.md) | OCR 工作台体验参考 | [设计依据](../design/README.md)与识别规格 |
| [`project-switcher-patterns.md`](./project-switcher-patterns.md) | 项目切换器参考模式 | 当前设计稿与已确认要求 |
| [`issue-tracker-audit-2026-07-06.md`](./issue-tracker-audit-2026-07-06.md) | 某一时点的 Issue 审计 | GitHub 当前状态 |

## 使用规则

- 已采纳结论并入现有权威文档；只保留有独立价值的论证和证据，标明日期、样本与非权威属性。
- 过期计划、待办和状态快照不据此排期；任务范围按用户当前指令，需要时定向核对相关 Issue。
- 真实业务数据、客户名称、原始票据和未脱敏截图不得提交。
