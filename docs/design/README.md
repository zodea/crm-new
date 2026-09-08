# 设计入口

> 本文件是瑞航 CRM 设计工作的唯一导航入口。不要从散落的历史记录、旧 HTML 或截图反推现行规格。

## 权威源与优先级

| 优先级 | 要回答的问题 | 唯一权威源 |
|---|---|---|
| 1 | 当前功能是否要做、做到什么程度 | [GitHub Issues](https://github.com/zodea/crm-new/issues) 中当下状态的 Issue；关闭 Issue 不作为新工作的规格 |
| 2 | 页面字段、Tab、业务边界 | [`docs/rewrite/pages/`](../rewrite/pages/)；数据实体看 [DATABASE.md](../rewrite/DATABASE.md)，领域术语看 [CONTEXT.md](../../CONTEXT.md) |
| 3 | 有直接对应页时的构图、密度、控件状态和只读交互路径 | 用户已登录的运行态参考系统；证据、差异和只读边界登记在 [`runtime-reference-audit.md`](./runtime-reference-audit.md) |
| 4 | 瑞航品牌、无直接对应页和 DC 独有能力的当前方案 | `DC重构设计源码/app.dc.html`；屏幕源码为 `DC重构设计源码/kit/**/*.jsx` |
| 5 | 颜色、间距、圆角等令牌 | `DC重构设计源码/_ds/crm-e3d87120-cf57-4b83-8a9b-188c305f529d/tokens/content-v5.css` |
| 6 | 参考冲突、响应式和可达性裁定 | [ADR 0013](../adr/0013-align-all-ui-to-online-design.md)；整页实体表单继续遵守 [ADR 0014](../adr/0014-full-page-entity-forms.md) |
| 7 | 组件和交互原语 | 本目录除本入口外的专题文档 + ADR 0008 / 0009 |

发生冲突时按表中优先级判断，并遵守以下边界：

- 运行态参考只决定有直接对应页的界面信息流和安全可观察交互，不覆盖瑞航品牌、字段含义、数据、权限或领域状态机。
- `app.dc.html` 与运行态参考中的固定视口都不是固定画布合同；与 ADR 0013 的响应式、滚动或可达性要求冲突时，以 ADR 0013 为准。
- 参考系统没有直接对应页，或现有业务能力变化很大时，先按 `runtime-reference-audit.md` 提供脱敏标注图或重绘线框，不拿相邻页面伪装成直接证据。
- Issue 已明确变更业务口径时，必须同轮更新 `docs/rewrite` 或 ADR，不能长期依赖评论覆盖旧正文。

## 当前设计源码只保留这些入口

```text
DC重构设计源码/
├─ app.dc.html        # 当前设计稿 HTML 应用入口
├─ support.js         # Claude Design 支撑脚本
├─ kit/               # 当前各屏幕和交互源码
└─ _ds/               # 设计系统运行时、CSS 与令牌
```

`app-old.html`、`app-new.html`、打印试验页、色彩对比原型、`DC重构设计源码/docs/` 副本均属于旧稿，不再保留在工作树。历史需要通过 Git 记录查看。

## 当前待补设计

现有生成账本登记 **2 条**：`/finance/payment/:id/detail` 与 `/settings/data-migration` 已有生产路由，但还没有一一对应的 DC 页面，在 [`design-coverage.json`](./design-coverage.json) 中保持 `design-pending`。本轮付款详情的公共洞察形态由 [#404](https://github.com/zodea/crm-new/issues/404) 联同资金模块 [#413](https://github.com/zodea/crm-new/issues/413) 复核，迁移界面由 [#414](https://github.com/zodea/crm-new/issues/414) 承接；旧 #305/#294 仅作历史来源。迁移页在设计补齐前以运行契约、四档实际视口和表内局部滚动证据验收。此前的施工进度「前后置依赖设置」已由 #244 合入设计源码，[补图 brief](../research/schedule-dependency-editor-brief.md) 已移入历史研究，不再作为待办。

当前界面数量、未实现和未闭环清单统一看 [`ui-implementation-status.md`](./ui-implementation-status.md)；全部生产 Nuxt 路由的运行态参考证据和差异看 [`runtime-reference-audit.md`](./runtime-reference-audit.md)，可机读双向集合见 [`runtime-evidence-ledger.json`](./runtime-evidence-ledger.json)。本轮任务统一进入[瑞航 CRM 全模块复核与红圈对齐路线：前台交互和数据处理优先](https://github.com/zodea/crm-new/issues/402)，复核与详细规格按 [`module-review.md`](../agents/module-review.md) 执行。旧总规格、地图及账本中的票号保留历史证据含义；被替代的旧票通过正文指向当前承接者，不再充当当前实施入口。选定代码基线后的路由与机器账本校正由[建立全模块功能清单与可信复核基线](https://github.com/zodea/crm-new/issues/403)负责。

历史溯源继续保留：旧生产链总规格 [#292](https://github.com/zodea/crm-new/issues/292) 与证据账本重建 [#276](https://github.com/zodea/crm-new/issues/276)。这些链接用于核对已有决定和验收来源，当前工作仍跟随新总图与承接任务。

动态单据、导入阶段、当前挂载的页签/子表和 browser/Tauri 读写差异，进入 [全模块复核覆盖索引](./module-review-coverage.md)；其 [JSON](./module-review-coverage.json) 为派生清单。它与路由证据账本分别记录“需要核验哪些面”和“已有何种参考证据”，不以生成行数宣告功能完成。

运行态视觉与公共交互回归的覆盖矩阵、更新方式和数据脱敏边界见 [`runtime-visual-regression.md`](./runtime-visual-regression.md)。页面切片完成时必须同时更新对应模板样本与真实页面基线。

## 文档放置规则

- 新的架构或不可逆技术决策：写入 `docs/adr/`。
- 页面字段、交互和验收变化：更新 `docs/rewrite/pages/`，不要复制第二份页面蓝本。
- 数据结构变化：只更新 `docs/rewrite/DATABASE.md`。
- 领域词义变化：只更新根目录 `CONTEXT.md`。
- 组件级设计：放在 `docs/design/`，先检查是否已有对应专题文件。
- 调研证据：放在 `docs/research/`，必须标注“非权威源”。
- 临时实施记录完成后，应合并进 Issue、ADR 或权威文档并删除；不再新增长期“反馈轮次”副本。

## 开工检查

1. 从 GitHub 查看相关 Issue 的当前状态和最新评论。
2. 查 `runtime-reference-audit.md` 的证据等级；有直接对应页时按严格只读协议核对运行态参考。
3. 查对应页面蓝本和 DATABASE/CONTEXT，不从参考站或旧截图补猜瑞航字段。
4. 打开 `app.dc.html` 核对品牌、DC 独有能力和无直接参考页的当前方案。
5. 检查 ADR 0013 的响应式要求；不得按固定长宽实现。
6. 若运行态参考、设计稿、Issue、Nuxt 现状互相冲突，在 Issue 中记录后再修改，并同轮消除旧文档冲突。
