# 运行态参考差异矩阵

> Issue：[#182](https://github.com/zodea/crm-new/issues/182)
>
> 父计划：[#181](https://github.com/zodea/crm-new/issues/181)
>
> 核对日期：2026-07-27

本文是全部生产 Nuxt 路由的运行态参考证据登记册，不是第二份页面规格。字段、业务规则和数据关系仍以 `docs/rewrite/pages/`、`DATABASE.md`、`CONTEXT.md` 为准；实际实现状态仍看 `ui-implementation-status.md`。

## 1. 裁定边界

- [#181](https://github.com/zodea/crm-new/issues/181) 的裁定已经通过 #183 并入设计权威链：登录后的参考站是有直接对应页时的布局、样式、控件状态和安全交互路径参考；缺失或变化较大的页面先提供裁剪脱敏图或重绘线框。
- [#110](https://github.com/zodea/crm-new/issues/110) 的旧评论只保留历史解释力，不再限制 #181 的逐屏对标范围。
- `docs/design/README.md` 与 ADR 0013 已明确双源边界：运行参考主导直接对应页的信息流，`app.dc.html` 保留瑞航品牌、DC 独有能力和无直接参考页的当前方案。
- 瑞航蓝色基准不变；可在对应实施票中调整几何、字号、间距、密度、模块顺序和只读反馈路径。
- 新增/编辑业务实体继续使用独立路由的整页表单，不因参考站出现弹窗而退回弹窗表单。

## 2. 严格只读观察协议

参考站只允许页面导航、页签切换、分页和语义明确的只读详情展开。禁止新增、修改、删除、保存、提交、上传、下载、导出、审批和任何状态变更；不点击语义不明确、可能立即生效或会触发文件传输的控件。无法确认无副作用时立即停止，由用户亲自操作或补充说明。

只读证据按以下顺序登记：

1. 记录参考菜单路径或视图名称、观察日期、视口和可安全到达的状态。
2. 只记录亲眼观察到的结构；邻近模板只能标为“邻近证据”，不能写成目标页面事实。
3. 对结构缺失或变化较大的界面，Issue 只附裁剪脱敏图或重绘线框。
4. 截图必须移除浏览器外壳、微信/通知、账号、真实客户、项目、人员、金额或单据数据；无法充分脱敏的原图不入库、不上传。
5. 参考站没有安全证据时保留本地现有行为，并在对应实施票补采；发现需要产品裁定的真实差异时，另建 `needs-info` Issue。

### needs-info 固定模板

```md
## Reference behavior
仅写已通过严格只读路径观察到的行为、路径、视口和证据。

## Current app behavior
写当前路由、现有业务约束和可复现步骤。

## Decision requested
只提出一个需要用户裁定的问题。

## Safe default
在裁定前保留现有业务规则、权限、状态机和写入路径，不复制未确认行为。
```

## 3. 参考证据档案

以下代码由路由矩阵引用。`历史结构记录` 的采集方式没有证明符合本轮严格只读协议，只能提供结构线索，不能作为目标页已验证证据；`待补采` 不得用于推断。

| 代码 | 证据级别 | 参考路径或视图 | 视口 | 只读证据与安全状态 |
| --- | --- | --- | --- | --- |
| `R-LIST-PRIOR` | 历史结构记录，未验证只读 | 业务列表；目标菜单路径待对应实施票补采 | 历史桌面视口；实现需复核 390、768、1024、1280–1440px | `docs/research/red-circle-ui-gap-2026-07-11.md` §2；仅作列表密度、筛选区、工具栏与分页的采集线索，必须按本轮协议重新观察 |
| `R-FORM-PRIOR` | 历史结构记录，未验证只读 | 新增/编辑表单；目标菜单路径待对应实施票补采 | 历史桌面视口；实现需复核 390、768、1024、1280–1440px | 同一研究记录 §1 与 ADR 0014；旧记录包含保存、取消关闭等行为结论，本轮不采信这些交互，也不再点击相关入口 |
| `R-DETAIL-PRIOR` | 历史结构记录，未验证只读 | 业务详情；目标菜单路径待对应实施票补采 | 历史桌面视口；实现需复核 390、768、1024、1280–1440px | 同一研究记录 §3；仅作结构线索，字段、动作和进入路径都必须通过明确只读入口重新确认 |
| `R-WORKBENCH-PRIOR` | 历史结构记录，未验证只读 | 数据工作台/矩阵；目标菜单路径待对应实施票补采 | 历史桌面视口；实现需复核 390、768、1024、1280–1440px | 同一研究记录 §2–§3；仅作密度、分栏和局部滚动线索，业务操作保持本地契约并等待重新观察 |
| `R-TOOL-PENDING` | 待补采 | 导入、导出、OCR、换算或价格工具；具体参考路径未知 | 首次安全观察目标 1440×900；实现仍复核四档视口 | 没有可安全确认的目标页证据；不得点击上传、下载、导出或任何可能立即生效的控件，先保留本地行为 |
| `R-SUBCONTRACT-LIST-LIVE` | 当前直接证据 | `默认首页 > 分包及人工 > 分包合同`；活动业务页签为“分包合同” | 桌面窗口，`RootWebArea` 约 1568×1153，2026-07-27 | 用户先打开目标页，本轮仅通过浏览器辅助功能树读取：确认左侧合同分类、搜索/筛选、紧凑工具栏、超宽合同表格及表格内横向延展；“导入/新建”只确认控件存在，未触发；未把任何行级业务值写入仓库或公开 Issue |

上一次实施无法读取浏览器正文，因此当时生成的项目详情“当前直接证据”和线框不成立，已在本轮撤销。项目详情恢复为 `R-DETAIL-PRIOR`，等待 #190 按本协议重新观察。当前直接证据只覆盖上述分包合同列表；它不能外推为其他合同或列表页面事实。

## 4. 业务约束档案

| 代码 | 必须保留的约束 |
| --- | --- |
| `C-BASE` | 保留瑞航蓝、字段含义、数据关系、权限、状态机和写入语义；实现响应式、键盘焦点与浮层层级 |
| `C-FORM` | 包含 `C-BASE`；遵守 ADR 0014/0015 的整页表单和草稿边界，不从参考站推断保存或提交行为 |
| `C-DENSE` | 包含 `C-BASE`；密集表格、矩阵和工作台只能在自身区域横向滚动，页面不得产生横向滚动 |
| `C-TOOL` | 包含 `C-BASE`；导入、导出、OCR、文件和换算能力只走现有 ADR 与业务契约，不能复制未确认副作用 |

## 5. 生产路由矩阵

“待核对”是明确的证据状态，不代表页面已与参考站一致。业务实施票完成只读采集后，应在同一提交把证据档案升级为直接证据，并把对应差异改成已验证结论。

| Page | Route | 业务域 | 模板 | 实施票 | 参考证据 | 布局差异 | 交互差异 | 业务约束 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `app/pages/base/crew/[id].vue` | `/base/crew/:id` | 基础主数据 | 详情 | #194 | R-DETAIL-PRIOR | 待 #194 同屏测量 | 待 #194 只读核对 | C-BASE |
| `app/pages/base/crew/form/[[id]].vue` | `/base/crew/form/:id?` | 基础主数据 | 整页表单 | #194 | R-FORM-PRIOR | 待 #194 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/base/crew/index.vue` | `/base/crew` | 基础主数据 | 列表 | #194 | R-LIST-PRIOR | 待 #194 同屏测量 | 待 #194 只读核对 | C-DENSE |
| `app/pages/base/customer/form/[[id]].vue` | `/base/customer/form/:id?` | 基础主数据 | 整页表单 | #194 | R-FORM-PRIOR | 待 #194 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/base/customer/index.vue` | `/base/customer` | 基础主数据 | 列表 | #194 | R-LIST-PRIOR | 待 #194 同屏测量 | 待 #194 只读核对 | C-DENSE |
| `app/pages/base/supplier/[id].vue` | `/base/supplier/:id` | 分供方 | 详情 | #193 | R-DETAIL-PRIOR | #186 已迁入统一详情壳并完成四档布局回归；具体字段与参考同屏差异仍待 #193 测量 | 待 #193 严格只读核对；现有 6 页签、文件与业务动作契约保持不变 | C-BASE |
| `app/pages/base/supplier/form/[[id]].vue` | `/base/supplier/form/:id?` | 分供方 | 整页表单 | #193 | R-FORM-PRIOR | #187 已迁入统一整页表单壳并完成四档及 200% 等效宽度回归；具体字段与参考同屏差异仍待 #193 测量 | 现有保存、提交、dirty、页签缓存和附件 action 保持；待 #193 严格只读核对 | C-FORM |
| `app/pages/base/supplier/index.vue` | `/base/supplier` | 分供方 | 列表 | #193 | R-LIST-PRIOR | 待 #193 同屏测量 | 待 #193 只读核对 | C-DENSE |
| `app/pages/base/worker/[id].vue` | `/base/worker/:id` | 基础主数据 | 详情 | #194 | R-DETAIL-PRIOR | 待 #194 同屏测量 | 待 #194 只读核对 | C-BASE |
| `app/pages/base/worker/form/[[id]].vue` | `/base/worker/form/:id?` | 基础主数据 | 整页表单 | #194 | R-FORM-PRIOR | 待 #194 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/base/worker/index.vue` | `/base/worker` | 基础主数据 | 列表 | #194 | R-LIST-PRIOR | 待 #194 同屏测量 | 待 #194 只读核对 | C-DENSE |
| `app/pages/contract/[id].vue` | `/contract/:id` | 核心合同 | 详情 | #195 | R-DETAIL-PRIOR | 待 #195 同屏测量 | 待 #195 只读核对 | C-BASE |
| `app/pages/contract/boq/import.vue` | `/contract/boq/import` | 核心合同 | 特殊工具 | #195 | R-TOOL-PENDING | 无安全直接证据 | 禁止触发上传或导入 | C-TOOL |
| `app/pages/contract/boq/index.vue` | `/contract/boq` | 核心合同 | 工作台 | #195 | R-WORKBENCH-PRIOR | 待 #195 同屏测量 | 待 #195 只读核对 | C-DENSE |
| `app/pages/contract/company-expense/form/[id].vue` | `/contract/company-expense/form/:id` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/company-expense/form/index.vue` | `/contract/company-expense/form` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/company-expense/index.vue` | `/contract/company-expense` | 辅助合同与结算 | 列表 | #196 | R-LIST-PRIOR | 待 #196 同屏测量 | 待 #196 只读核对 | C-DENSE |
| `app/pages/contract/construction/form/[id].vue` | `/contract/construction/form/:id` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | 待 #195 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/construction/form/index.vue` | `/contract/construction/form` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | 待 #195 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/construction/index.vue` | `/contract/construction` | 核心合同 | 列表 | #195 | R-LIST-PRIOR | 待 #195 同屏测量 | 待 #195 只读核对 | C-DENSE |
| `app/pages/contract/material/form/[id].vue` | `/contract/material/form/:id` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | 待 #195 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/material/form/index.vue` | `/contract/material/form` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | 待 #195 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/material/index.vue` | `/contract/material` | 核心合同 | 列表 | #195 | R-LIST-PRIOR | 待 #195 同屏测量 | 待 #195 只读核对 | C-DENSE |
| `app/pages/contract/other-expense/form/[id].vue` | `/contract/other-expense/form/:id` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/other-expense/form/index.vue` | `/contract/other-expense/form` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/other-expense/index.vue` | `/contract/other-expense` | 辅助合同与结算 | 列表 | #196 | R-LIST-PRIOR | 待 #196 同屏测量 | 待 #196 只读核对 | C-DENSE |
| `app/pages/contract/other-settlement/form/[id].vue` | `/contract/other-settlement/form/:id` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/other-settlement/form/index.vue` | `/contract/other-settlement/form` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/other-settlement/index.vue` | `/contract/other-settlement` | 辅助合同与结算 | 列表 | #196 | R-LIST-PRIOR | 待 #196 同屏测量 | 待 #196 只读核对 | C-DENSE |
| `app/pages/contract/subcontract/form/[id].vue` | `/contract/subcontract/form/:id` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | 待 #195 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/subcontract/form/index.vue` | `/contract/subcontract/form` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | 待 #195 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/subcontract/index.vue` | `/contract/subcontract` | 核心合同 | 列表 | #195 | R-SUBCONTRACT-LIST-LIVE | 参考页为左分类 + 紧凑工具栏 + 单一超宽表格面；当前实现另分标题工具栏、状态页签、左侧 TreeNav 和独立汇总面，待 #195 同屏测量 | 参考仅确认分类、搜索/筛选及导入/新建入口存在；行内链接和写操作均未触发，当前新增/编辑/删除契约继续保留 | C-DENSE |
| `app/pages/export/config/[jobId].vue` | `/export/config/:jobId` | 导入导出 | 特殊工具 | #205 | R-TOOL-PENDING | 无安全直接证据 | 禁止触发下载或导出 | C-TOOL |
| `app/pages/finance/billing/[id].vue` | `/finance/billing/:id` | 收入财务 | 整页表单 | #202 | R-FORM-PRIOR | 待 #202 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/billing/index.vue` | `/finance/billing` | 收入财务 | 列表 | #202 | R-LIST-PRIOR | 待 #202 同屏测量 | 待 #202 只读核对 | C-DENSE |
| `app/pages/finance/billing/new.vue` | `/finance/billing/new` | 收入财务 | 整页表单 | #202 | R-FORM-PRIOR | 待 #202 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/current/[id].vue` | `/finance/current/:id` | 收入财务 | 整页表单 | #202 | R-FORM-PRIOR | 待 #202 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/current/index.vue` | `/finance/current` | 收入财务 | 列表 | #202 | R-LIST-PRIOR | 待 #202 同屏测量 | 待 #202 只读核对 | C-DENSE |
| `app/pages/finance/current/new.vue` | `/finance/current/new` | 收入财务 | 整页表单 | #202 | R-FORM-PRIOR | 待 #202 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/invoice/[id].vue` | `/finance/invoice/:id` | 发票台账 | 整页表单 | #204 | R-FORM-PRIOR | 待 #204 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/invoice/factor.vue` | `/finance/invoice/factor` | 发票台账 | 特殊工具 | #204 | R-TOOL-PENDING | 无安全直接证据 | 换算规则保持现有契约 | C-TOOL |
| `app/pages/finance/invoice/index.vue` | `/finance/invoice` | 发票台账 | 工作台 | #204 | R-WORKBENCH-PRIOR | 待 #204 同屏测量 | 待 #204 只读核对 | C-DENSE |
| `app/pages/finance/ledger.vue` | `/finance/ledger` | 发票台账 | 工作台 | #204 | R-WORKBENCH-PRIOR | 待 #204 同屏测量 | 待 #204 只读核对 | C-DENSE |
| `app/pages/finance/payment/[id].vue` | `/finance/payment/:id` | 支出财务 | 整页表单 | #203 | R-FORM-PRIOR | 待 #203 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/payment/index.vue` | `/finance/payment` | 支出财务 | 列表 | #203 | R-LIST-PRIOR | 待 #203 同屏测量 | 待 #203 只读核对 | C-DENSE |
| `app/pages/finance/payment/new.vue` | `/finance/payment/new` | 支出财务 | 整页表单 | #203 | R-FORM-PRIOR | 待 #203 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/receipt/[id].vue` | `/finance/receipt/:id` | 收入财务 | 整页表单 | #202 | R-FORM-PRIOR | 待 #202 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/receipt/index.vue` | `/finance/receipt` | 收入财务 | 列表 | #202 | R-LIST-PRIOR | 待 #202 同屏测量 | 待 #202 只读核对 | C-DENSE |
| `app/pages/finance/receipt/new.vue` | `/finance/receipt/new` | 收入财务 | 整页表单 | #202 | R-FORM-PRIOR | 待 #202 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/records/[id].vue` | `/finance/records/:id` | 支出财务 | 整页表单 | #203 | R-FORM-PRIOR | 待 #203 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/records/index.vue` | `/finance/records` | 支出财务 | 列表 | #203 | R-LIST-PRIOR | 待 #203 同屏测量 | 待 #203 只读核对 | C-DENSE |
| `app/pages/finance/records/new.vue` | `/finance/records/new` | 支出财务 | 整页表单 | #203 | R-FORM-PRIOR | 待 #203 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/reimbursement/[id].vue` | `/finance/reimbursement/:id` | 支出财务 | 整页表单 | #203 | R-FORM-PRIOR | 待 #203 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/reimbursement/index.vue` | `/finance/reimbursement` | 支出财务 | 列表 | #203 | R-LIST-PRIOR | 待 #203 同屏测量 | 待 #203 只读核对 | C-DENSE |
| `app/pages/finance/reimbursement/new.vue` | `/finance/reimbursement/new` | 支出财务 | 整页表单 | #203 | R-FORM-PRIOR | 待 #203 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/import/mapping/[entity].vue` | `/import/mapping/:entity` | 导入导出 | 特殊工具 | #205 | R-TOOL-PENDING | 无安全直接证据 | 禁止触发上传或导入 | C-TOOL |
| `app/pages/index.vue` | `/` | 首页 | 工作台 | #189 | R-WORKBENCH-PRIOR | 待 #189 同屏测量 | 待 #189 只读核对 | C-DENSE |
| `app/pages/material/arrival/[id].vue` | `/material/arrival/:id` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/arrival/index.vue` | `/material/arrival` | 自购材 | 列表 | #199 | R-LIST-PRIOR | 待 #199 同屏测量 | 待 #199 只读核对 | C-DENSE |
| `app/pages/material/arrival/new.vue` | `/material/arrival/new` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/delivery/archive/[id].vue` | `/material/delivery/archive/:id` | 送货单闭环 | 详情 | #201 | R-DETAIL-PRIOR | 待 #201 同屏测量 | 待 #201 只读核对 | C-BASE |
| `app/pages/material/delivery/archive/form/[id].vue` | `/material/delivery/archive/form/:id` | 送货单闭环 | 整页表单 | #201 | R-FORM-PRIOR | 待 #201 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/delivery/archive/index.vue` | `/material/delivery/archive` | 送货单闭环 | 工作台 | #201 | R-WORKBENCH-PRIOR | 待 #201 同屏测量 | 待 #201 只读核对 | C-DENSE |
| `app/pages/material/delivery/index.vue` | `/material/delivery` | 送货单闭环 | 工作台 | #201 | R-WORKBENCH-PRIOR | 待 #201 同屏测量 | OCR/归档动作保持现有契约 | C-DENSE |
| `app/pages/material/price.vue` | `/material/price` | 材料价格 | 特殊工具 | #207 | R-TOOL-PENDING | 无安全直接证据；独立 needs-info #207 等待参考路径和业务归属裁定 | #207 裁定前保留现有价格规则与交互 | C-TOOL |
| `app/pages/material/requisition/[id].vue` | `/material/requisition/:id` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/requisition/index.vue` | `/material/requisition` | 自购材 | 列表 | #199 | R-LIST-PRIOR | 待 #199 同屏测量 | 待 #199 只读核对 | C-DENSE |
| `app/pages/material/requisition/new.vue` | `/material/requisition/new` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/settlement/form/[id].vue` | `/material/settlement/form/:id` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/settlement/form/index.vue` | `/material/settlement/form` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/settlement/index.vue` | `/material/settlement` | 辅助合同与结算 | 列表 | #196 | R-LIST-PRIOR | 待 #196 同屏测量 | 待 #196 只读核对 | C-DENSE |
| `app/pages/material/stock-check/[id].vue` | `/material/stock-check/:id` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/stock-check/index.vue` | `/material/stock-check` | 自购材 | 列表 | #199 | R-LIST-PRIOR | 待 #199 同屏测量 | 待 #199 只读核对 | C-DENSE |
| `app/pages/material/stock-check/new.vue` | `/material/stock-check/new` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/use/[id].vue` | `/material/use/:id` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/use/index.vue` | `/material/use` | 自购材 | 列表 | #199 | R-LIST-PRIOR | 待 #199 同屏测量 | 待 #199 只读核对 | C-DENSE |
| `app/pages/material/use/new.vue` | `/material/use/new` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/owner/[kind]/[id].vue` | `/owner/:kind/:id` | 甲方单据 | 整页表单 | #197 | R-FORM-PRIOR | 待 #197 分类型测量 | 动态单据写入路径保持现有契约 | C-FORM |
| `app/pages/owner/[kind]/index.vue` | `/owner/:kind` | 甲方单据 | 列表 | #197 | R-LIST-PRIOR | 待 #197 分类型测量 | 动态类型与权限保持现有契约 | C-DENSE |
| `app/pages/owner/[kind]/new.vue` | `/owner/:kind/new` | 甲方单据 | 整页表单 | #197 | R-FORM-PRIOR | 待 #197 分类型测量 | 动态单据写入路径保持现有契约 | C-FORM |
| `app/pages/owner-material/arrival/[id].vue` | `/owner-material/arrival/:id` | 甲供材 | 整页表单 | #200 | R-FORM-PRIOR | 待 #200 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/owner-material/arrival/index.vue` | `/owner-material/arrival` | 甲供材 | 列表 | #200 | R-LIST-PRIOR | 待 #200 同屏测量 | 待 #200 只读核对 | C-DENSE |
| `app/pages/owner-material/arrival/new.vue` | `/owner-material/arrival/new` | 甲供材 | 整页表单 | #200 | R-FORM-PRIOR | 待 #200 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/owner-material/control/[id].vue` | `/owner-material/control/:id` | 甲供材 | 整页表单 | #200 | R-FORM-PRIOR | 待 #200 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/owner-material/control/index.vue` | `/owner-material/control` | 甲供材 | 列表 | #200 | R-LIST-PRIOR | 待 #200 同屏测量 | 待 #200 只读核对 | C-DENSE |
| `app/pages/owner-material/control/new.vue` | `/owner-material/control/new` | 甲供材 | 整页表单 | #200 | R-FORM-PRIOR | 待 #200 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/owner-material/direct/[id].vue` | `/owner-material/direct/:id` | 甲供材 | 整页表单 | #200 | R-FORM-PRIOR | 待 #200 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/owner-material/direct/index.vue` | `/owner-material/direct` | 甲供材 | 列表 | #200 | R-LIST-PRIOR | 待 #200 同屏测量 | 待 #200 只读核对 | C-DENSE |
| `app/pages/owner-material/direct/new.vue` | `/owner-material/direct/new` | 甲供材 | 整页表单 | #200 | R-FORM-PRIOR | 待 #200 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/owner-material/requisition/[id].vue` | `/owner-material/requisition/:id` | 甲供材 | 整页表单 | #200 | R-FORM-PRIOR | 待 #200 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/owner-material/requisition/index.vue` | `/owner-material/requisition` | 甲供材 | 列表 | #200 | R-LIST-PRIOR | 待 #200 同屏测量 | 待 #200 只读核对 | C-DENSE |
| `app/pages/owner-material/requisition/new.vue` | `/owner-material/requisition/new` | 甲供材 | 整页表单 | #200 | R-FORM-PRIOR | 待 #200 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/owner-material/use/[id].vue` | `/owner-material/use/:id` | 甲供材 | 整页表单 | #200 | R-FORM-PRIOR | 待 #200 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/owner-material/use/index.vue` | `/owner-material/use` | 甲供材 | 列表 | #200 | R-LIST-PRIOR | 待 #200 同屏测量 | 待 #200 只读核对 | C-DENSE |
| `app/pages/owner-material/use/new.vue` | `/owner-material/use/new` | 甲供材 | 整页表单 | #200 | R-FORM-PRIOR | 待 #200 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/project/[id].vue` | `/project/:id` | 项目 | 详情 | #190 | R-DETAIL-PRIOR | 待 #190 重新只读观察并同屏测量 | 待 #190 只读核对；上次未能读取浏览器正文，不保留未经验证的交互结论 | C-DENSE |
| `app/pages/project/[pid]/supplier/[sid].vue` | `/project/:pid/supplier/:sid` | 项目分供方 | 详情 | #192 | R-DETAIL-PRIOR | 待 #192 同屏测量 | 待 #192 只读核对 | C-BASE |
| `app/pages/project/[pid]/supplier/import.vue` | `/project/:pid/supplier/import` | 项目分供方 | 特殊工具 | #192 | R-TOOL-PENDING | 无安全直接证据 | 禁止触发上传或导入 | C-TOOL |
| `app/pages/project/form/[[id]].vue` | `/project/form/:id?` | 项目 | 整页表单 | #190 | R-FORM-PRIOR | #187 随 MasterData 共享入口迁入统一整页表单壳；具体字段与参考同屏差异仍待 #190 测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/project/index.vue` | `/project` | 项目 | 列表 | #190 | R-LIST-PRIOR | 待 #190 同屏测量 | 待 #190 只读核对 | C-DENSE |
| `app/pages/project/penalty/[id].vue` | `/project/penalty/:id` | 甲方单据 | 整页表单 | #197 | R-FORM-PRIOR | 待 #197 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/project/penalty/index.vue` | `/project/penalty` | 甲方单据 | 列表 | #197 | R-LIST-PRIOR | 待 #197 同屏测量 | 待 #197 只读核对 | C-DENSE |
| `app/pages/project/penalty/new.vue` | `/project/penalty/new` | 甲方单据 | 整页表单 | #197 | R-FORM-PRIOR | 待 #197 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/project/target-cost/form/[[id]].vue` | `/project/target-cost/form/:id?` | 项目进度成本 | 整页表单 | #191 | R-FORM-PRIOR | 待 #191 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/project/target-cost/index.vue` | `/project/target-cost` | 项目进度成本 | 列表 | #191 | R-LIST-PRIOR | 待 #191 同屏测量 | 待 #191 只读核对 | C-DENSE |
| `app/pages/schedule/[pid].vue` | `/schedule/:pid` | 项目进度成本 | 工作台 | #191 | R-WORKBENCH-PRIOR | 待 #191 同屏测量 | 排程写入路径保持现有契约 | C-DENSE |
| `app/pages/schedule/index.vue` | `/schedule` | 项目进度成本 | 工作台 | #191 | R-WORKBENCH-PRIOR | 待 #191 同屏测量 | 待 #191 只读核对 | C-DENSE |
| `app/pages/schedule/new.vue` | `/schedule/new` | 项目进度成本 | 整页表单 | #191 | R-FORM-PRIOR | 待 #191 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/subcontract/[kind]/[id].vue` | `/subcontract/:kind/:id` | 分包单据 | 整页表单 | #197 | R-FORM-PRIOR | 待 #197 分类型测量 | 动态单据写入路径保持现有契约 | C-FORM |
| `app/pages/subcontract/[kind]/index.vue` | `/subcontract/:kind` | 分包单据 | 列表 | #197 | R-LIST-PRIOR | 待 #197 分类型测量 | 动态类型与权限保持现有契约 | C-DENSE |
| `app/pages/subcontract/[kind]/new.vue` | `/subcontract/:kind/new` | 分包单据 | 整页表单 | #197 | R-FORM-PRIOR | 待 #197 分类型测量 | 动态单据写入路径保持现有契约 | C-FORM |
| `app/pages/subcontract/attendance.vue` | `/subcontract/attendance` | 工程量与工资 | 工作台 | #198 | R-WORKBENCH-PRIOR | 待 #198 同屏测量 | 考勤写入路径保持现有契约 | C-DENSE |
| `app/pages/subcontract/payroll/index.vue` | `/subcontract/payroll` | 工程量与工资 | 工作台 | #198 | R-WORKBENCH-PRIOR | 待 #198 同屏测量 | 工资核算规则保持现有契约 | C-DENSE |
| `app/pages/subcontract/quantity/[pid]/[uid].vue` | `/subcontract/quantity/:pid/:uid` | 工程量与工资 | 详情 | #198 | R-DETAIL-PRIOR | 待 #198 同屏测量 | 待 #198 只读核对 | C-DENSE |
| `app/pages/subcontract/quantity/index.vue` | `/subcontract/quantity` | 工程量与工资 | 工作台 | #198 | R-WORKBENCH-PRIOR | 待 #198 同屏测量 | 工程量写入路径保持现有契约 | C-DENSE |

## 6. 维护规则

1. `app/pages/` 新增、删除或改名生产页面时，同一提交更新本矩阵；`app/pages/dev/` 不计入生产清单。
2. 业务实施票完成安全观察后，记录实际参考路径、视口、只读状态和差异结论；不能用“看起来一样”替代证据。
3. 同一类参考证据可以复用档案代码，但目标页没有直接证据时必须继续标为邻近或待补采。
4. 若发现会改变业务规则、权限、状态机、字段含义或写入副作用的差异，停止实现并按固定模板建立独立 `needs-info` Issue。
5. 实施票关闭前同时更新本矩阵、受影响的页面蓝本/ADR、`ui-implementation-status.md` 和 Issue 验收证据。
