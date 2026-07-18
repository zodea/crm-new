# 设计唯一入口

> 本文件是瑞航 CRM 设计工作的唯一入口。不要从散落的历史记录、旧 HTML 或截图反推现行规格。

## 权威源与优先级

| 优先级 | 要回答的问题 | 唯一权威源 |
|---|---|---|
| 1 | 当前界面实际长什么样 | `DC重构设计源码/app.dc.html`；屏幕源码为 `DC重构设计源码/kit/**/*.jsx` |
| 2 | 颜色、间距、圆角等令牌 | `DC重构设计源码/_ds/crm-e3d87120-cf57-4b83-8a9b-188c305f529d/tokens/content-v5.css` |
| 3 | 自适应、响应式和视觉冲突规则 | [ADR 0013](../adr/0013-align-all-ui-to-online-design.md) |
| 4 | 当前功能是否要做、做到什么程度 | [GitHub Issues](https://github.com/zodea/crm-new/issues) 中当下状态的 Issue；关闭 Issue 不作为新工作的规格 |
| 5 | 页面字段、Tab、业务边界 | [`docs/rewrite/pages/`](../rewrite/pages/) |
| 6 | 数据实体、关系和迁移 | [DATABASE.md](../rewrite/DATABASE.md) |
| 7 | 领域术语 | [CONTEXT.md](../../CONTEXT.md) |
| 8 | 组件和交互原语 | 本目录除本入口外的专题文档 + 对应 ADR |

发生冲突时按表中优先级判断，但有两个例外：

- `app.dc.html` 的某个固定视口只是参考样态；与 ADR 0013 的响应式契约冲突时，以 ADR 0013 为准，并同轮补齐设计稿。
- Issue 已明确变更业务口径时，必须同轮更新 `docs/rewrite` 或 ADR，不能长期依赖评论覆盖旧正文。

## 当前设计源码只保留这些入口

```text
DC重构设计源码/
├─ app.dc.html        # 当前且唯一的 HTML 应用入口
├─ support.js         # Claude Design 支撑脚本
├─ kit/               # 当前各屏幕和交互源码
└─ _ds/               # 设计系统运行时、CSS 与令牌
```

`app-old.html`、`app-new.html`、打印试验页、色彩对比原型、`DC重构设计源码/docs/` 副本均属于旧稿，不再保留在工作树。历史需要通过 Git 记录查看。

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
2. 打开 `app.dc.html` 核对当前 `app` 界面，只看这一套应用界面。
3. 查对应页面蓝本和 DATABASE/CONTEXT，不从旧截图补猜字段。
4. 检查 ADR 0013 的响应式要求；不得按固定长宽实现。
5. 若设计稿、Issue、Nuxt 现状互相冲突，在 Issue 中记录后再修改，并同轮消除旧文档冲突。
