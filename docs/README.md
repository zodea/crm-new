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
| 当前界面应当长什么样 | [`docs/design/README.md`](./design/README.md) 与 ADR 0013；直接对应页看运行参考，瑞航品牌与独有能力看 DC 设计稿 |
| 页面有哪些字段、Tab 和业务边界 | [`docs/rewrite/pages/`](./rewrite/pages/) |
| 用户应当怎样完成一条业务流程 | [`docs/guides/`](./guides/) |
| 如何将浏览器旧核心身份数据显式切换到中央后台 | [`docs/guides/local-data-migration.md`](./guides/local-data-migration.md) |
| 当前还有哪些界面未实现或未闭环 | [`docs/design/ui-implementation-status.md`](./design/ui-implementation-status.md) |
| Agent 如何开工、分诊和提交 | [`docs/agents/`](./agents/) |

## 参照索引（非权威源）

- [测试文件业务模块索引](./testing/README.md)：保留测试原位置，逐文件归类业务、界面行为、文档契约与辅助夹具，供分批测试审查使用；不代表业务验收通过。
- [逐 Issue 流程与交互审阅](./research/issue-review-2026-09-11/README.md)：历史流程图、异常退回、交互示意与运行证据；为开发快照，不表示当前完成状态。
- [模块开发方向流程图](./research/module-development-flows.md)：全局业务衔接及八个模块的操作、结果与异常返回，用于核对方向；不表示功能已完成。
- [正式保存、备份恢复与本机部署承接](./implementation/production-gate-work-breakdown.md)：#416 的存储现状、已定运行约束与生产子票入口；决策票关闭和正式上线分别验收。
- [红圈四条业务流转](../红圈系统/业务流转.md)：收入、支出、物资、工程量·变更的对象流与关键勾稽索引。
- [红圈对象 → DC 实体命名对照与系统全景](../红圈系统/命名对照与全景.md)：124 个红圈对象的迁移归属、DC 补集与双视角全景。

两份索引不定义 DC 术语、实体或字段；冲突时仍以本页“权威源”表为准。

## 目录职责

- `adr/`：已经采纳的、会约束后续实现的决策；入口见 [`adr/README.md`](./adr/README.md)。
- `agents/`：仓库协作规则，不承载产品规格。
- `design/`：设计入口、组件规格和视觉验收规则。
- `guides/`：面向最终用户的 Markdown 操作说明与[功能路由索引](./guides/routes.md)，是默认交付入口；需要 PDF 时再按需生成。
- `rewrite/`：当前架构、数据模型、通用业务模式与页面蓝本。
- `prd/`：仍有独立价值的产品需求文档。
- `implementation/`：实施承接与拆分入口，不是架构或业务权威源。
- `migration/`：数据迁移、验收与对账材料。
- `research/`：证据、竞品和历史调查，明确为非权威源。
- `testing/`：现有测试的业务模块索引与运行入口，不替代业务规格或测试有效性评审。

## 冲突处理

1. 用户当前指令确定需求与范围；事实查代码和现行文档，需求疑问直接问用户。
2. 术语冲突以 `CONTEXT.md` 为准，数据冲突以 `DATABASE.md` 为准，已采纳决策冲突以最新 ADR 为准。
3. 视觉冲突按 ADR 0013：直接对应页采用运行参考，瑞航品牌、独有能力及无直接参考页采用 `app.dc.html`，响应式约束仍必须成立。
4. 代码与权威文档冲突时核实依据；确定后在同一工作单元同步实现与文档。

临时过程记录中仍有效的结论写入上述权威源，完成后删除过程记录；历史版本由 Git 保存。
