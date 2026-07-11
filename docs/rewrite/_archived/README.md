# _archived — 早期决策原始留档（2026-06 起）

> 本目录是重写规划早期（2026-06）的决策草稿，**均已归档、不作现行权威**。凡与现行 ADR / 权威源冲突处，一律以后者为准。下表给出「原始决策 → 现行权威源」映射；未列入的（`01` SPA 模式 / `03` 模块分期 / `04` 待调整项 / `09` 目录结构 / `10`·`11` 导航结构、`REWRITE-DESIGN`、`DESIGN-HANDOFF`）为早期规划，无对应现行 ADR，纯历史留档。

| 归档决策 | 主题 | 现行权威源 |
|---|---|---|
| `02-design-direction.md` | 设计语言方向 | 视觉 [ADR 0007](../../adr/0007-unified-visual-style-rounded-cards.md) + 交互底座 [ADR 0008](../../adr/0008-adopt-shadcn-vue-on-unocss.md) |
| `05-table-solution.md` | 表格方案（vxe-table） | [ADR 0009](../../adr/0009-vxe-table-as-datagrid-engine.md)（取代本条） |
| `06-persistence-sqlite.md` | 数据持久化 SQLite | 数据模型 [DATABASE.md](../DATABASE.md)；表级决策另见 [ADR 0001](../../adr/0001-invoice-single-table.md) / [ADR 0002](../../adr/0002-change-order-generates-ledger.md) |
| `07-ocr-architecture.md` | OCR 架构 | [ADR 0006](../../adr/0006-ocr-paddleocr-vl-single-model.md) |
| `08-css-unocss.md` | CSS = UnoCSS | 延续；交互底座 [ADR 0008](../../adr/0008-adopt-shadcn-vue-on-unocss.md)（shadcn-vue on UnoCSS，零 Tailwind 引擎） |

> 完整现行权威源锚点见根 `AGENTS.md`「已知权威源锚点」与 `docs/adr/`。
