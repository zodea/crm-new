# 文档入口

知道位置时直接读相关文档；需要定位时使用下表。协作规则见 [`AGENTS.md`](../AGENTS.md)，历史记录不作为现行规格。

## 现行规范与使用说明

| 要回答的问题 | 直接入口 |
| --- | --- |
| 项目术语 | [`CONTEXT.md`](../CONTEXT.md) |
| 技术栈、模块与读写边界 | [`docs/rewrite/ARCHITECTURE.md`](./rewrite/ARCHITECTURE.md) |
| 架构与交互决策及其替代关系 | [`docs/adr/`](./adr/) |
| 实体、字段、关系与迁移 | [`docs/rewrite/DATABASE.md`](./rewrite/DATABASE.md) |
| 页面读模型、DTO、空错权限与适配边界 | [`docs/rewrite/READ-MODELS.md`](./rewrite/READ-MODELS.md) |
| 中央写命令、幂等、版本冲突与草稿 | [`docs/rewrite/COMMANDS.md`](./rewrite/COMMANDS.md) |
| 跨域入口、目标路由与返回上下文 | [`docs/rewrite/NAVIGATION.md`](./rewrite/NAVIGATION.md) |
| 智能洞察、全局消息与业务页签 | [`docs/rewrite/PUBLIC-SURFACES.md`](./rewrite/PUBLIC-SURFACES.md) |
| 视觉依据、组件与响应式 | [`docs/design/README.md`](./design/README.md) |
| 页面字段、Tab 与业务边界 | [`docs/rewrite/pages/`](./rewrite/pages/) |
| 用户操作与功能路由 | [`docs/guides/`](./guides/)（Markdown） |
| 浏览器旧核心身份数据迁移 | [`docs/guides/local-data-migration.md`](./guides/local-data-migration.md) |
| 界面未实现或未闭环项 | [`docs/design/ui-implementation-status.md`](./design/ui-implementation-status.md) |
| Issue、技能、模块复核、CI 与提交细则 | [`docs/agents/`](./agents/) |
| 测试工具、运行命令与业务模块索引 | [`docs/testing/README.md`](./testing/README.md) |

ADR 按明确的采纳、替代与适用范围理解，不按编号新旧覆盖所有规则。发现来源冲突时先核实依据，再按已确认范围同步修改。

## 专题与历史参考

| 入口 | 用途与边界 |
| --- | --- |
| [`prd/`](./prd/) · [`migration/`](./migration/) | 独立产品需求、迁移验收与对账材料；结合对应现行契约使用 |
| [生产运行与验证边界](./rewrite/ARCHITECTURE.md#runtime-environments) | 运行范围见架构，存储与恢复决定见 [ADR 0021](./adr/0021-single-operator-windows-production-storage.md)，实际上线直接核对 [#471](https://github.com/zodea/crm-new/issues/471) |
| [调研与历史证据](./research/README.md) | 非权威来源，保留观察与论证 |
| [历史 Issue 流程审阅](./research/issue-review-2026-09-11/README.md) · [模块开发方向](./research/module-development-flows.md) | 流程与交互快照，不代表当前完成状态 |
| [红圈业务流转](../红圈系统/业务流转.md) · [红圈对象与 DC 命名对照](../红圈系统/命名对照与全景.md) | 竞品对象及业务流索引，不定义 DC 术语、实体或字段 |
