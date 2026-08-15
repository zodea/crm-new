# 文档入口

这里是仓库文档的唯一导航页。先判断问题类型，再进入对应权威源；不要从历史记录或调研笔记反推现行规格。

## 权威源

| 要回答的问题 | 权威源 |
| --- | --- |
| 项目术语是什么意思 | [`CONTEXT.md`](../CONTEXT.md) |
| 为什么采用某项架构或交互方案 | [`docs/adr/`](./adr/) |
| 数据实体、字段、关系与迁移 | [`docs/rewrite/DATABASE.md`](./rewrite/DATABASE.md) |
| 页面读模型、DTO 类型、空错权限和本地/后台适配边界 | [`docs/rewrite/READ-MODELS.md`](./rewrite/READ-MODELS.md) |
| 中央写命令、幂等、版本冲突和本地草稿边界 | [`docs/rewrite/COMMANDS.md`](./rewrite/COMMANDS.md) |
| 蓝色入口、目标路由、页签和返回上下文 | [`docs/rewrite/NAVIGATION.md`](./rewrite/NAVIGATION.md) |
| 智能洞察、全局消息和业务页签怎样挂载、恢复与对账 | [`docs/rewrite/PUBLIC-SURFACES.md`](./rewrite/PUBLIC-SURFACES.md) |
| 当前界面应当长什么样 | [`DC重构设计源码/app.dc.html`](../DC重构设计源码/app.dc.html) 与 [`docs/design/README.md`](./design/README.md) |
| 页面有哪些字段、Tab 和业务边界 | [`docs/rewrite/pages/`](./rewrite/pages/) |
| 用户应当怎样完成一条业务流程 | [`docs/guides/`](./guides/) |
| 如何将浏览器旧核心身份数据显式切换到中央后台 | [`docs/guides/local-data-migration.md`](./guides/local-data-migration.md) |
| 当前还有哪些界面未实现或未闭环 | [`docs/design/ui-implementation-status.md`](./design/ui-implementation-status.md) |
| 当前工作是否已定稿、由谁领取 | [GitHub Issues](https://github.com/zodea/crm-new/issues) |
| Agent 如何开工、分诊和提交 | [`docs/agents/`](./agents/) |

## 参照索引（非权威源）

- [红圈四条业务流转](../红圈系统/业务流转.md)：收入、支出、物资、工程量·变更的对象流与关键勾稽索引。
- [红圈对象 → DC 实体命名对照与系统全景](../红圈系统/命名对照与全景.md)：124 个红圈对象的迁移归属、DC 补集与双视角全景。

两份索引不定义 DC 术语、实体或字段；冲突时仍以本页“权威源”表为准。

## 目录职责

- `adr/`：已经采纳的、会约束后续实现的决策；入口见 [`adr/README.md`](./adr/README.md)。
- `agents/`：仓库协作规则，不承载产品规格。
- `design/`：设计入口、组件规格和视觉验收规则。
- `guides/`：面向最终用户的操作说明 Markdown 权威源；PDF 是同源生成的交付物。
- `rewrite/`：当前架构、数据模型、通用业务模式与页面蓝本。
- `prd/`：仍有独立价值的产品需求文档；落地状态以 Issue 为准。
- `implementation/`：仍在执行的实施拆解，不是架构或业务权威源。
- `migration/`：数据迁移、验收与对账材料。
- `research/`：证据、竞品和历史调查，明确为非权威源。

## 冲突处理

1. 先看相关 GitHub Issue 的当前状态和最新评论。
2. 术语冲突以 `CONTEXT.md` 为准，数据冲突以 `DATABASE.md` 为准，已采纳决策冲突以最新 ADR 为准。
3. 视觉冲突按 ADR 0013：当前 `app.dc.html` 是全站基准，响应式约束仍必须成立。
4. 代码现状与权威文档冲突时，不用旧代码证明旧文档正确；先把冲突记入 Issue，再在同一工作单元同步实现与文档。

临时过程记录完成后应并入 Issue、ADR 或上述权威源并删除。历史版本由 Git 保存，不在工作树保留“旧版副本”。
