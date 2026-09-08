# 功能路由索引

本索引登记本批次新增的中央业务链；其他操作指南见[指南入口](./README.md)。

| 功能 | 路由 | 当前状态与使用说明 |
| --- | --- | --- |
| 其他支出合同列表 | `/contract/other-expense` | 当前浏览器验证环境可用；[操作指南](./auxiliary-contracts.md) |
| 其他支出合同只读详情 | `/contract/other-expense/:id` | 真实项目与分供方关系，来源返回 |
| 其他支出合同新建 / 显式编辑 | `/contract/other-expense/form`、`/contract/other-expense/form/:id` | 独立整页表单，中央保存 |
| 公司支出合同列表 | `/contract/company-expense` | 当前浏览器验证环境可用，不挂项目 |
| 公司支出合同只读详情 | `/contract/company-expense/:id` | 专属税务、票款、附件与审计 |
| 公司支出合同新建 / 显式编辑 | `/contract/company-expense/form`、`/contract/company-expense/form/:id` | 独立整页表单，中央保存 |
| 分包结算列表 | `/subcontract/settlement` | 当前已可用；[操作指南](./core-contract-and-boq.md#分包结算查看草稿与确认) |
| 分包结算只读详情 | `/subcontract/settlement/:id` | 当前已可用，支持全局/项目/合同来源返回 |
| 分包结算新增 | `/subcontract/settlement/new` | 当前已可用，草稿保存或确认 |
| 分包结算显式编辑 | `/subcontract/settlement/form/:id` | 当前已可用，仅正式草稿 |
| 项目罚扣列表 | `/project/penalty` | 当前已可用；[操作指南](./core-contract-and-boq.md#项目罚扣整改与结算抵扣) |
| 项目罚扣只读详情、整改与抵扣历史 | `/project/penalty/:id` | 当前已可用，来源返回及部分抵扣 |
| 项目罚扣新增 | `/project/penalty/new` | 当前已可用，保存草稿或提交 |
| 项目罚扣显式编辑 | `/project/penalty/form/:id` | 当前已可用，仅正式草稿 |

| 其他支出结算功能 | 路由 | 当前行为 |
| --- | --- | --- |
| 专属结算列表 | `/contract/other-settlement` | 中央查询、真实合同来源与分页；[操作指南](./other-expense-settlement.md) |
| 只读结算详情 | `/contract/other-settlement/:id` | 金额链、中央罚扣/申请/支付源单、附件与审计；query 保留页签、所选源单及多级返回链 |
| 新建 / 显式编辑 | `/contract/other-settlement/form`、`/contract/other-settlement/form/:id` | 同项目非草稿源合同，整页保存、提交与确认 |
