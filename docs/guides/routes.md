# 功能路由索引

本索引登记本批次新增的中央业务链；其他操作指南见[指南入口](./README.md)。

| 功能 | 路由 | 当前状态与使用说明 |
| --- | --- | --- |
| 分包结算列表 | `/subcontract/settlement` | 当前已可用；[操作指南](./core-contract-and-boq.md#分包结算查看草稿与确认) |
| 分包结算只读详情 | `/subcontract/settlement/:id` | 当前已可用，支持全局/项目/合同来源返回 |
| 分包结算新增 | `/subcontract/settlement/new` | 当前已可用，草稿保存或确认 |
| 分包结算显式编辑 | `/subcontract/settlement/form/:id` | 当前已可用，仅正式草稿 |
| 项目罚扣中央执行与审计 | `/project/penalty/:id` | 已定稿待 #329 开发；本票仅提供中央结算候选 |
