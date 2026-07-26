# 架构决策索引

ADR 记录“已经采纳且会约束后续实现”的决策。新决策使用下一个四位编号；被替代的 ADR 保留正文并在标题下明确指向新决策，不删除历史。

| ADR | 主题 | 当前状态 |
| --- | --- | --- |
| [0001](./0001-invoice-single-table.md) | 发票单表即台账 | 已采纳 |
| [0002](./0002-change-order-generates-ledger.md) | 已签证变更生成台账 | 已采纳 |
| [0003](./0003-confirm-dialog-deletion-model.md) | 确认弹窗与删除模型 | 已采纳 |
| [0004](./0004-export-interaction-model.md) | 导出交互模型 | 已采纳 |
| [0005](./0005-import-mapping-model.md) | 通用导入映射 | 已采纳 |
| [0006](./0006-ocr-paddleocr-vl-single-model.md) | PaddleOCR-VL 单模型 | 已采纳 |
| [0007](./0007-unified-visual-style-rounded-cards.md) | 圆角卡片视觉风格 | 已采纳 |
| [0008](./0008-adopt-shadcn-vue-on-unocss.md) | shadcn-vue / reka-ui / vue-sonner on UnoCSS | 已采纳 |
| [0009](./0009-vxe-table-as-datagrid-engine.md) | vxe-table 数据网格底座 | 已采纳 |
| [0010](./0010-quantity-matrix-and-construction-record-model.md) | 工程量矩阵与施工记录模型 | 已采纳 |
| [0011](./0011-redesign-application-shell.md) | 应用外壳行为 | 视觉条款被 0013 取代；行为有效 |
| [0012](./0012-exact-factor-combination-solver.md) | 开票因子精确组合求解 | 已采纳 |
| [0013](./0013-align-all-ui-to-online-design.md) | 全站视觉统一到线上设计稿 | 已采纳 |
| [0014](./0014-full-page-entity-forms.md) | 业务实体使用整页表单 | 已采纳并已落地 |
| [0015](./0015-form-persistence-and-payment-reconciliation.md) | 表单持久化与付款勾稽 | 已采纳并已落地 |
| [0016](./0016-overlay-composition-contract.md) | 浮层组合采用单交互平面与模态栈契约 | 已采纳，迁移中 |

## 写作边界

- ADR 写决策、约束、权衡与后果，不复制完整字段表或 CSS 色值。
- 实体与字段写入 `docs/rewrite/DATABASE.md`，词义写入根目录 `CONTEXT.md`。
- 设计运行态写入 `DC重构设计源码/`，组件验收规格写入 `docs/design/`。
- 决策发生变化时，同一提交更新被影响的入口和旧正文状态。
