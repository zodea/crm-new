# 功能路由索引

本索引登记本批次新增的中央业务链；其他操作指南见[指南入口](./README.md)。

| 功能 | 路由 | 当前状态与使用说明 |
| --- | --- | --- |
| 标准工序库目录、详情与新版本 | `/schedule/process-library`、`/schedule/process-library/:id`、`/schedule/process-library/form` | 既有整页流程接本机磁盘保存，服务重启后按原身份读取；正式写入仍受备份门禁，见[本机工序库指南](./local-process-library-storage.md) |
| 本机分供方主档与证照 | `/base/supplier`、`/base/supplier/form/:id`、`/base/supplier/credential/:id` | 主档、原件、OCR 候选和人工核验磁盘保存与原提交恢复；未接入跨域事实显示未知，见[本机使用说明](./local-supplier-storage.md) |
| 工资台账与详情 | `/subcontract/payroll`、`/subcontract/payroll/:id` | 浏览器验证版本已开放历史只读、A/C1/C2 核对、实际发放及冻结输出，范围见[工资指南](./payroll-attendance.md) |
| 考勤、签工与主体配置来源 | `/subcontract/payroll/sources`、`/subcontract/attendance`、`/subcontract/daywork` | 同项目真实来源及月锁查看；包含尚无工资头的独立来源 |
| 工资新建与草稿编辑 | `/subcontract/payroll/new`、`/subcontract/payroll/form/:id` | A/C1/C2 独立整页在浏览器验证版本可用，既有单据按实际格式读取 |
| 完整工资工作簿 | `/subcontract/payroll/workbooks` | 同项目已发工资、固定目录和独立实名版本；见[完整工作簿指南](./payroll-complete-workbook.md) |
| 工资配置 | `/subcontract/payroll/config` | A 的负责人首月比例、分项基准价及个人例外，C1 的个人兜底与加班标准，C2 的项目×负责人主体价与确认规则分别核对 |
| 独立工资更正 | `/subcontract/payroll/adjustments/new`、`/subcontract/payroll/adjustments/form/:id`、`/subcontract/payroll/adjustments/:id` | 原已发工资的独立核算更正；P4 已本地验收，见[更正指南](./payroll-adjustments.md) |
| 工资补贴与独立管理费 | `/subcontract/payroll/config`、`/subcontract/payroll/form/:id`、`/subcontract/payroll/:id` | 配置明确费用与管理关系，管理草稿中编辑负价清单，再核对实发；见[费用指南](./payroll-fees.md) |
| 户级空鼓与整改 | `/subcontract/quantity/:pid/:uid/hollow/new`、`/subcontract/quantity/:pid/:uid/hollow/:id`、`/subcontract/quantity/:pid/:uid/hollow/form/:id` | 原户记录、独立修订及追加整改；P6 验收进度见[空鼓指南](./payroll-hollow.md) |
| 工资空鼓配置与人工扣款 | `/subcontract/payroll/config`、`/subcontract/payroll/:id` | 逐分项配置，原工资中明确开始后重新核对；冻结与独立更正见[空鼓指南](./payroll-hollow.md) |
| 工资实际收付 | `/subcontract/payroll/payments`、`/subcontract/payroll/payments/new`、`/subcontract/payroll/payments/reversal/new`、`/subcontract/payroll/payments/:eventId` | 实际补退、错记冲销与只读台账；后月处理仍在原工资发放步骤 |
| 签工新建与显式编辑 | `/subcontract/daywork/new`、`/subcontract/daywork/form/:id` | 浏览器独立整页可用，原用工事实与人工证明分开，操作见[工资指南 C2](./payroll-attendance.md#八c2-从人工签工到实际发放) |
| 目标成本列表 | `/project/target-cost` | 当前浏览器验证实例可用；筛选、基线、删除与恢复见[预算指南](./target-cost.md) |
| 目标成本版本详情 | `/project/target-cost/:id` | 固定版本科目、来源对比、附件与历史；来源未齐保持未知 |
| 目标成本新建 / 显式编辑 | `/project/target-cost/form`、`/project/target-cost/form/:id` | 整页版本头与原件保存，缺项目草稿及原提交恢复 |
| 项目 Excel 导入 | `/project` → `/import/mapping/project` | 当前浏览器验证环境可用；[操作指南](./project-excel-import.md)。历史深链遵守相同中央写入边界 |
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
