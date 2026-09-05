# 功能与路由索引

从浏览器当前站点进入下列路径。`:id`、`:pid`、`:uid` 等须替换为当前工作区真实记录 ID；带 `?` 的参数可省略。详情优先从对应列表点击，来源与返回参数由系统自动携带。

- 本表按当前 `app/pages/` 与页签标题生成，列出 133 条业务路由；不含 5 条开发预览路由。
- 路由存在不代表业务闭环。操作步骤见[指南入口](./README.md)，本轮可复现问题见[浏览器审计](../research/browser-audit-2026-09-05.md)。
- 审计确认正式与演示来源仍有隔离缺陷；复现请使用隔离测试环境和虚构数据。
- `:kind` 表示单据类型：甲方支持 `change`（变洽签）、`report`（报量）、`acceptance`（竣工验收·保修）、`final-settlement`（最终结算）、`penalty`（罚扣）；分包支持 `change`（变洽签）、`settlement`（结算）。例如 `/owner/report` 是甲方报量列表，新增和编辑从列表进入。

| 功能 | 路由 | 页面用途 | 源码定位 |
| --- | --- | --- | --- |
| 班组详情 | `/base/crew/:id` | 记录 / 工作台 | [页面](../../app/pages/base/crew/%5Bid%5D.vue) |
| 班组表单 | `/base/crew/form/:id?` | 新增 / 编辑 | [页面](../../app/pages/base/crew/form/%5B%5Bid%5D%5D.vue) |
| 班组管理 | `/base/crew` | 入口 / 列表 | [页面](../../app/pages/base/crew/index.vue) |
| 客户 | `/base/customer/:id` | 记录 / 工作台 | [页面](../../app/pages/base/customer/%5Bid%5D.vue) |
| 客户表单 | `/base/customer/form/:id?` | 新增 / 编辑 | [页面](../../app/pages/base/customer/form/%5B%5Bid%5D%5D.vue) |
| 客户 | `/base/customer` | 入口 / 列表 | [页面](../../app/pages/base/customer/index.vue) |
| 分供方详情 | `/base/supplier/:id` | 记录 / 工作台 | [页面](../../app/pages/base/supplier/%5Bid%5D.vue) |
| 分供方证照 | `/base/supplier/credential/:id` | 证照工作台，参数为分供方 ID | [页面](../../app/pages/base/supplier/credential/%5Bid%5D.vue) |
| 分供方表单 | `/base/supplier/form/:id?` | 新增 / 编辑 | [页面](../../app/pages/base/supplier/form/%5B%5Bid%5D%5D.vue) |
| 分供方 | `/base/supplier` | 入口 / 列表 | [页面](../../app/pages/base/supplier/index.vue) |
| 工人详情 | `/base/worker/:id` | 记录 / 工作台 | [页面](../../app/pages/base/worker/%5Bid%5D.vue) |
| 工人表单 | `/base/worker/form/:id?` | 新增 / 编辑 | [页面](../../app/pages/base/worker/form/%5B%5Bid%5D%5D.vue) |
| 工人信息 | `/base/worker` | 入口 / 列表 | [页面](../../app/pages/base/worker/index.vue) |
| 合同详情 | `/contract/:id` | 记录 / 工作台 | [页面](../../app/pages/contract/%5Bid%5D.vue) |
| 清单拆表 | `/contract/boq/import` | 入口 / 列表 | [页面](../../app/pages/contract/boq/import.vue) |
| 工程量清单 | `/contract/boq` | 入口 / 列表 | [页面](../../app/pages/contract/boq/index.vue) |
| 公司支出合同 | `/contract/company-expense/form/:id` | 新增 / 编辑 | [页面](../../app/pages/contract/company-expense/form/%5Bid%5D.vue) |
| 公司支出合同 | `/contract/company-expense/form` | 新增 / 编辑 | [页面](../../app/pages/contract/company-expense/form/index.vue) |
| 公司支出合同 | `/contract/company-expense` | 入口 / 列表 | [页面](../../app/pages/contract/company-expense/index.vue) |
| 施工合同 | `/contract/construction/form/:id` | 新增 / 编辑 | [页面](../../app/pages/contract/construction/form/%5Bid%5D.vue) |
| 施工合同 | `/contract/construction/form` | 新增 / 编辑 | [页面](../../app/pages/contract/construction/form/index.vue) |
| 施工合同 | `/contract/construction` | 入口 / 列表 | [页面](../../app/pages/contract/construction/index.vue) |
| 材料采购合同 | `/contract/material/form/:id` | 新增 / 编辑 | [页面](../../app/pages/contract/material/form/%5Bid%5D.vue) |
| 材料采购合同 | `/contract/material/form` | 新增 / 编辑 | [页面](../../app/pages/contract/material/form/index.vue) |
| 材料采购合同 | `/contract/material` | 入口 / 列表 | [页面](../../app/pages/contract/material/index.vue) |
| 其他支出合同 | `/contract/other-expense/form/:id` | 新增 / 编辑 | [页面](../../app/pages/contract/other-expense/form/%5Bid%5D.vue) |
| 其他支出合同 | `/contract/other-expense/form` | 新增 / 编辑 | [页面](../../app/pages/contract/other-expense/form/index.vue) |
| 其他支出合同 | `/contract/other-expense` | 入口 / 列表 | [页面](../../app/pages/contract/other-expense/index.vue) |
| 其他支出结算 | `/contract/other-settlement/form/:id` | 新增 / 编辑 | [页面](../../app/pages/contract/other-settlement/form/%5Bid%5D.vue) |
| 其他支出结算 | `/contract/other-settlement/form` | 新增 / 编辑 | [页面](../../app/pages/contract/other-settlement/form/index.vue) |
| 其他支出结算 | `/contract/other-settlement` | 入口 / 列表 | [页面](../../app/pages/contract/other-settlement/index.vue) |
| 分包合同 | `/contract/subcontract/form/:id` | 新增 / 编辑 | [页面](../../app/pages/contract/subcontract/form/%5Bid%5D.vue) |
| 分包合同 | `/contract/subcontract/form` | 新增 / 编辑 | [页面](../../app/pages/contract/subcontract/form/index.vue) |
| 分包合同 | `/contract/subcontract` | 入口 / 列表 | [页面](../../app/pages/contract/subcontract/index.vue) |
| 导出配置 | `/export/config/:jobId` | 记录 / 工作台 | [页面](../../app/pages/export/config/%5BjobId%5D.vue) |
| 开票申请 | `/finance/billing/:id` | 记录表单 | [页面](../../app/pages/finance/billing/%5Bid%5D.vue) |
| 开票申请 | `/finance/billing` | 入口 / 列表 | [页面](../../app/pages/finance/billing/index.vue) |
| 开票申请 | `/finance/billing/new` | 新增 / 编辑 | [页面](../../app/pages/finance/billing/new.vue) |
| 往来收付 | `/finance/current/:id` | 记录表单 | [页面](../../app/pages/finance/current/%5Bid%5D.vue) |
| 往来收付 | `/finance/current` | 入口 / 列表 | [页面](../../app/pages/finance/current/index.vue) |
| 往来收付 | `/finance/current/new` | 新增 / 编辑 | [页面](../../app/pages/finance/current/new.vue) |
| 发票编辑 | `/finance/invoice/:id` | 记录 / 工作台 | [页面](../../app/pages/finance/invoice/%5Bid%5D.vue) |
| 精确加法组合与税额计算 | `/finance/invoice/factor` | 入口 / 列表 | [页面](../../app/pages/finance/invoice/factor.vue) |
| 发票识别 | `/finance/invoice` | 入口 / 列表 | [页面](../../app/pages/finance/invoice/index.vue) |
| 发票台账 | `/finance/ledger` | 入口 / 列表 | [页面](../../app/pages/finance/ledger.vue) |
| 付款管理 | `/finance/payment-management` | 入口 / 列表 | [页面](../../app/pages/finance/payment-management/index.vue) |
| 付款申请 | `/finance/payment/:id` | 记录表单 | [页面](../../app/pages/finance/payment/%5Bid%5D.vue) |
| 付款申请详情 | `/finance/payment/:id/detail` | 记录 / 工作台 | [页面](../../app/pages/finance/payment/%5Bid%5D/detail.vue) |
| 付款申请 | `/finance/payment` | 入口 / 列表 | [页面](../../app/pages/finance/payment/index.vue) |
| 付款申请 | `/finance/payment/new` | 新增 / 编辑 | [页面](../../app/pages/finance/payment/new.vue) |
| 收款登记 | `/finance/receipt/:id` | 记录 / 工作台 | [页面](../../app/pages/finance/receipt/%5Bid%5D.vue) |
| 收款登记 | `/finance/receipt/form/:id` | 新增 / 编辑 | [页面](../../app/pages/finance/receipt/form/%5Bid%5D.vue) |
| 收款登记 | `/finance/receipt` | 入口 / 列表 | [页面](../../app/pages/finance/receipt/index.vue) |
| 收款登记 | `/finance/receipt/new` | 新增 / 编辑 | [页面](../../app/pages/finance/receipt/new.vue) |
| 支付记录 | `/finance/records/:id` | 记录表单 | [页面](../../app/pages/finance/records/%5Bid%5D.vue) |
| 支付记录 | `/finance/records` | 入口 / 列表 | [页面](../../app/pages/finance/records/index.vue) |
| 支付记录 | `/finance/records/new` | 新增 / 编辑 | [页面](../../app/pages/finance/records/new.vue) |
| 费用报销 | `/finance/reimbursement/:id` | 记录表单 | [页面](../../app/pages/finance/reimbursement/%5Bid%5D.vue) |
| 费用报销 | `/finance/reimbursement` | 入口 / 列表 | [页面](../../app/pages/finance/reimbursement/index.vue) |
| 费用报销 | `/finance/reimbursement/new` | 新增 / 编辑 | [页面](../../app/pages/finance/reimbursement/new.vue) |
| 导入映射 | `/import/mapping/:entity` | 记录 / 工作台 | [页面](../../app/pages/import/mapping/%5Bentity%5D.vue) |
| 首页 | `/` | 入口 / 列表 | [页面](../../app/pages/index.vue) |
| 材料到货 | `/material/arrival/:id` | 记录表单 | [页面](../../app/pages/material/arrival/%5Bid%5D.vue) |
| 材料到货 | `/material/arrival` | 入口 / 列表 | [页面](../../app/pages/material/arrival/index.vue) |
| 材料到货 | `/material/arrival/new` | 新增 / 编辑 | [页面](../../app/pages/material/arrival/new.vue) |
| 送货单详情 | `/material/delivery/archive/:id` | 记录 / 工作台 | [页面](../../app/pages/material/delivery/archive/%5Bid%5D.vue) |
| 送货单归档表单 | `/material/delivery/archive/form/:id?` | 新增 / 编辑 | [页面](../../app/pages/material/delivery/archive/form/%5B%5Bid%5D%5D.vue) |
| 送货单归档库 | `/material/delivery/archive` | 入口 / 列表 | [页面](../../app/pages/material/delivery/archive/index.vue) |
| 送货单识别 | `/material/delivery` | 入口 / 列表 | [页面](../../app/pages/material/delivery/index.vue) |
| 单价对比 | `/material/price` | 入口 / 列表 | [页面](../../app/pages/material/price.vue) |
| 下料单 | `/material/requisition/:id` | 记录表单 | [页面](../../app/pages/material/requisition/%5Bid%5D.vue) |
| 下料单 | `/material/requisition` | 入口 / 列表 | [页面](../../app/pages/material/requisition/index.vue) |
| 下料单 | `/material/requisition/new` | 新增 / 编辑 | [页面](../../app/pages/material/requisition/new.vue) |
| 材料采购结算 | `/material/settlement/form/:id` | 新增 / 编辑 | [页面](../../app/pages/material/settlement/form/%5Bid%5D.vue) |
| 材料采购结算 | `/material/settlement/form` | 新增 / 编辑 | [页面](../../app/pages/material/settlement/form/index.vue) |
| 材料采购结算 | `/material/settlement` | 入口 / 列表 | [页面](../../app/pages/material/settlement/index.vue) |
| 库存盘点 | `/material/stock-check/:id` | 记录表单 | [页面](../../app/pages/material/stock-check/%5Bid%5D.vue) |
| 库存盘点 | `/material/stock-check` | 入口 / 列表 | [页面](../../app/pages/material/stock-check/index.vue) |
| 库存盘点 | `/material/stock-check/new` | 新增 / 编辑 | [页面](../../app/pages/material/stock-check/new.vue) |
| 材料领用 | `/material/use/:id` | 记录表单 | [页面](../../app/pages/material/use/%5Bid%5D.vue) |
| 材料领用 | `/material/use` | 入口 / 列表 | [页面](../../app/pages/material/use/index.vue) |
| 材料领用 | `/material/use/new` | 新增 / 编辑 | [页面](../../app/pages/material/use/new.vue) |
| 甲供材到货 | `/owner-material/arrival/:id` | 记录表单 | [页面](../../app/pages/owner-material/arrival/%5Bid%5D.vue) |
| 甲供材到货 | `/owner-material/arrival` | 入口 / 列表 | [页面](../../app/pages/owner-material/arrival/index.vue) |
| 甲供材到货 | `/owner-material/arrival/new` | 新增 / 编辑 | [页面](../../app/pages/owner-material/arrival/new.vue) |
| 甲供材总控量 | `/owner-material/control/:id` | 记录表单 | [页面](../../app/pages/owner-material/control/%5Bid%5D.vue) |
| 甲供材总控量 | `/owner-material/control` | 入口 / 列表 | [页面](../../app/pages/owner-material/control/index.vue) |
| 甲供材总控量 | `/owner-material/control/new` | 新增 / 编辑 | [页面](../../app/pages/owner-material/control/new.vue) |
| 甲供材直入直出 | `/owner-material/direct/:id` | 记录表单 | [页面](../../app/pages/owner-material/direct/%5Bid%5D.vue) |
| 甲供材直入直出 | `/owner-material/direct` | 入口 / 列表 | [页面](../../app/pages/owner-material/direct/index.vue) |
| 甲供材直入直出 | `/owner-material/direct/new` | 新增 / 编辑 | [页面](../../app/pages/owner-material/direct/new.vue) |
| 甲供材下料单 | `/owner-material/requisition/:id` | 记录表单 | [页面](../../app/pages/owner-material/requisition/%5Bid%5D.vue) |
| 甲供材下料单 | `/owner-material/requisition` | 入口 / 列表 | [页面](../../app/pages/owner-material/requisition/index.vue) |
| 甲供材下料单 | `/owner-material/requisition/new` | 新增 / 编辑 | [页面](../../app/pages/owner-material/requisition/new.vue) |
| 甲供材领用 | `/owner-material/use/:id` | 记录表单 | [页面](../../app/pages/owner-material/use/%5Bid%5D.vue) |
| 甲供材领用 | `/owner-material/use` | 入口 / 列表 | [页面](../../app/pages/owner-material/use/index.vue) |
| 甲供材领用 | `/owner-material/use/new` | 新增 / 编辑 | [页面](../../app/pages/owner-material/use/new.vue) |
| 甲方单据（按类型） | `/owner/:kind/:id` | 单据详情 | [页面](../../app/pages/owner/%5Bkind%5D/%5Bid%5D.vue) |
| 甲方单据（按类型） | `/owner/:kind/form/:id` | 编辑 | [页面](../../app/pages/owner/%5Bkind%5D/form/%5Bid%5D.vue) |
| 甲方单据（按类型） | `/owner/:kind` | 入口 / 列表 | [页面](../../app/pages/owner/%5Bkind%5D/index.vue) |
| 甲方单据（按类型） | `/owner/:kind/new` | 新增 | [页面](../../app/pages/owner/%5Bkind%5D/new.vue) |
| 项目详情 | `/project/:id` | 记录 / 工作台 | [页面](../../app/pages/project/%5Bid%5D.vue) |
| 项目分供方 | `/project/:pid/supplier/:sid` | 记录 / 工作台 | [页面](../../app/pages/project/%5Bpid%5D/supplier/%5Bsid%5D.vue) |
| 分供方导入 | `/project/:pid/supplier/import` | 记录 / 工作台 | [页面](../../app/pages/project/%5Bpid%5D/supplier/import.vue) |
| 项目表单 | `/project/form/:id?` | 新增 / 编辑 | [页面](../../app/pages/project/form/%5B%5Bid%5D%5D.vue) |
| 项目列表 | `/project` | 入口 / 列表 | [页面](../../app/pages/project/index.vue) |
| 项目罚扣 | `/project/penalty/:id` | 记录表单 | [页面](../../app/pages/project/penalty/%5Bid%5D.vue) |
| 项目罚扣 | `/project/penalty` | 入口 / 列表 | [页面](../../app/pages/project/penalty/index.vue) |
| 项目罚扣 | `/project/penalty/new` | 新增 / 编辑 | [页面](../../app/pages/project/penalty/new.vue) |
| 目标成本 | `/project/target-cost/:id` | 记录 / 工作台 | [页面](../../app/pages/project/target-cost/%5Bid%5D.vue) |
| 目标成本表单 | `/project/target-cost/form/:id?` | 新增 / 编辑 | [页面](../../app/pages/project/target-cost/form/%5B%5Bid%5D%5D.vue) |
| 目标成本 | `/project/target-cost` | 入口 / 列表 | [页面](../../app/pages/project/target-cost/index.vue) |
| 绑定施工合同 | `/schedule/:pid/bind/:gid` | 记录 / 工作台 | [页面](../../app/pages/schedule/%5Bpid%5D/bind/%5Bgid%5D.vue) |
| 施工进度 | `/schedule/:pid` | 记录 / 工作台 | [页面](../../app/pages/schedule/%5Bpid%5D/index.vue) |
| 施工进度 | `/schedule` | 入口 / 列表 | [页面](../../app/pages/schedule/index.vue) |
| 新建楼栋分组 | `/schedule/new` | 新增 / 编辑 | [页面](../../app/pages/schedule/new.vue) |
| 标准工序库表单 | `/schedule/process-library/form` | 新增 / 编辑 | [页面](../../app/pages/schedule/process-library/form.vue) |
| 标准工序库 | `/schedule/process-library` | 入口 / 列表 | [页面](../../app/pages/schedule/process-library/index.vue) |
| 本地数据迁移 | `/settings/data-migration` | 入口 / 列表 | [页面](../../app/pages/settings/data-migration.vue) |
| OCR 设置 | `/settings/ocr` | 入口 / 列表 | [页面](../../app/pages/settings/ocr.vue) |
| 分包单据（按类型） | `/subcontract/:kind/:id` | 变洽签详情 / 结算表单 | [页面](../../app/pages/subcontract/%5Bkind%5D/%5Bid%5D.vue) |
| 分包单据（按类型） | `/subcontract/:kind/form/:id` | 编辑 | [页面](../../app/pages/subcontract/%5Bkind%5D/form/%5Bid%5D.vue) |
| 分包单据（按类型） | `/subcontract/:kind` | 入口 / 列表 | [页面](../../app/pages/subcontract/%5Bkind%5D/index.vue) |
| 分包单据（按类型） | `/subcontract/:kind/new` | 新增 | [页面](../../app/pages/subcontract/%5Bkind%5D/new.vue) |
| 考勤 | `/subcontract/attendance` | 入口 / 列表 | [页面](../../app/pages/subcontract/attendance.vue) |
| 零工登记 | `/subcontract/daywork` | 入口 / 列表 | [页面](../../app/pages/subcontract/daywork.vue) |
| 工资核算 | `/subcontract/payroll/:id` | 记录 / 工作台 | [页面](../../app/pages/subcontract/payroll/%5Bid%5D.vue) |
| 工资核算 | `/subcontract/payroll` | 入口 / 列表 | [页面](../../app/pages/subcontract/payroll/index.vue) |
| 工资核算 | `/subcontract/payroll/new` | 新增 / 编辑 | [页面](../../app/pages/subcontract/payroll/new.vue) |
| 户施工详情 | `/subcontract/quantity/:pid/:uid` | 记录 / 工作台 | [页面](../../app/pages/subcontract/quantity/%5Bpid%5D/%5Buid%5D.vue) |
| 工程量管理 | `/subcontract/quantity` | 入口 / 列表 | [页面](../../app/pages/subcontract/quantity/index.vue) |
| 项目区域配置 | `/subcontract/quantity/region` | 入口 / 列表 | [页面](../../app/pages/subcontract/quantity/region.vue) |
| 户型模板 | `/subcontract/quantity/template` | 入口 / 列表 | [页面](../../app/pages/subcontract/quantity/template.vue) |
