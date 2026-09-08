# 调研与历史证据

> **本目录全部是非权威源。** 它回答“当时看到了什么、为什么形成某个方向”，不回答“现在必须怎么实现”。当前约束请回到 [`docs/README.md`](../README.md)、ADR、页面蓝本和 GitHub open Issues。

## 索引

| 文档 | 用途 | 现行权威 |
| --- | --- | --- |
| [`module-development-flows.md`](./module-development-flows.md) | 全局及八模块流程方向确认稿，不代表实现完成 | [全模块复核总图 #402](https://github.com/zodea/crm-new/issues/402)、各模块票及页面蓝本 |
| [`kitui-to-shadcn-migration.md`](./kitui-to-shadcn-migration.md) | 已执行的 KitUI 迁移映射及当时取舍 | ADR 0008、当前 KitUI 组件契约 |
| [`kit-ui-primitives-wave2-prd.md`](./kit-ui-primitives-wave2-prd.md) | 第二波原语建设历史需求 | 当前组件契约、[交互复核 #404](https://github.com/zodea/crm-new/issues/404) |
| [`schedule-dependency-editor-brief.md`](./schedule-dependency-editor-brief.md) | 排程依赖编辑器历史设计任务书 | 排程页面蓝本、ADR 0018、[工程模块 #412](https://github.com/zodea/crm-new/issues/412) |
| [`red-circle-ui-gap-2026-07-11.md`](./red-circle-ui-gap-2026-07-11.md) | 红圈系统结构与交互差距走查，保留来源证据 | ADR 0013–0015、界面状态页、open Issues |
| [`architecture-review-2026-07-05.html`](./architecture-review-2026-07-05.html) | 早期架构扫描报告 | `docs/rewrite/ARCHITECTURE.md`、ADR |
| [`invoice-recognition-app-port-plan.md`](./invoice-recognition-app-port-plan.md) | 旧识别应用可迁移能力调查 | ADR 0006、当前 `app/lib/recognize/` |
| [`ocr-recognition-strategy.md`](./ocr-recognition-strategy.md) | OCR 引擎、隐私与成本论证 | ADR 0006 |
| [`ocr-ux-benchmark.md`](./ocr-ux-benchmark.md) | OCR 工作台历史体验参考 | 当前设计权威链、[附件与识别复核 #406](https://github.com/zodea/crm-new/issues/406) |
| [`project-switcher-patterns.md`](./project-switcher-patterns.md) | 项目切换器参考模式 | 当前设计稿和相关 Issue |
| [`issue-tracker-audit-2026-07-06.md`](./issue-tracker-audit-2026-07-06.md) | 某一时点的 Issue 审计 | GitHub 当前状态 |

## 使用规则

- 调研结论被采纳后，应写入 ADR、`CONTEXT.md`、`DATABASE.md` 或页面蓝本；这里保留论证，不复制为第二套规格。
- 文件顶部必须写清采集日期、样本和“非权威源”。
- “待拍板”“下一步”“当前状态”等快照文字超过有效期后，不据此排期；以 GitHub 当前 Issue 为准。
- 真实业务数据、客户名称、原始票据和未脱敏截图不得提交。
