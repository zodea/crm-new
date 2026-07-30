# 运行态参考差异矩阵

> Issue：[#182](https://github.com/zodea/crm-new/issues/182)
>
> 父计划：[#181](https://github.com/zodea/crm-new/issues/181)
>
> 核对日期：2026-07-30

本文是全部生产 Nuxt 路由的运行态参考证据登记册，不是第二份页面规格。字段、业务规则和数据关系仍以 `docs/rewrite/pages/`、`DATABASE.md`、`CONTEXT.md` 为准；实际实现状态仍看 `ui-implementation-status.md`。

## 1. 裁定边界

- [#181](https://github.com/zodea/crm-new/issues/181) 的裁定已经通过 #183 并入设计权威链：登录后的参考站是有直接对应页时的布局、样式、控件状态和安全交互路径参考；缺失或变化较大的页面先提供裁剪脱敏图或重绘线框。
- [#110](https://github.com/zodea/crm-new/issues/110) 的旧评论只保留历史解释力，不再限制 #181 的逐屏对标范围。
- `docs/design/README.md` 与 ADR 0013 已明确双源边界：运行参考主导直接对应页的信息流，`app.dc.html` 保留瑞航品牌、DC 独有能力和无直接参考页的当前方案。
- 瑞航蓝色基准不变；可在对应实施票中调整几何、字号、间距、密度、模块顺序和只读反馈路径。
- 新增/编辑业务实体继续使用独立路由的整页表单，不因参考站出现弹窗而退回弹窗表单。

## 2. 严格只读观察协议

参考站只允许页面导航、页签切换、分页、语义明确的只读详情展开，以及用户在 2026-07-29 明确授权的“打开空白新建页核对后直接关闭/取消”。进入新建页后不得录入、粘贴、上传、选择业务对象、保存、提交或触发任何写入；仍禁止修改、删除、下载、导出、审批和任何状态变更。不点击语义不明确、可能立即生效或会触发文件传输的控件。无法确认无副作用时立即停止，由用户亲自操作或补充说明。

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
| `R-OCR-STUDIO-SOURCE` | 固定源码参考，非业务运行态 | [`andyhuo520/ppocrv6-studio@34bf6c3`](https://github.com/andyhuo520/ppocrv6-studio/tree/34bf6c3) 的单页设置工作台 | 源项目桌面布局；瑞航仍复核 390、768、1024、1280–1440px | 只复刻“单页纵向分组、紧凑控件密度、恢复默认/保存反馈”的信息架构，不复制其传统 PP-OCRv6 ONNX 引擎契约。`model_variant`、`det_thresh`、`box_thresh`、`unclip` 等传统检测参数不能伪装成 PaddleOCR-VL 1.6 云端参数；瑞航可编辑项必须确实进入现有 VL 调用链，Access Token 等私密运行参数继续仅由服务端持有。 |
| `R-SHELL-LIVE` | 当前直接证据 | 已登录参考站全局外壳；活动业务页签保持在用户原先打开的页面 | 桌面窗口，`RootWebArea` 约 1568×1153，2026-07-27 | 仅通过 Windows 无障碍树读取和安全界面状态切换：侧栏主体约 215px、顶栏约 50px、路由页签约 28–32px、通知面板约 360px；参考站菜单搜索“分包”显示 5 个站内入口，其中“分包产值确认”“分包签证结算”是参考站独有能力，不构成给瑞航新增或改名路由的授权。瑞航只按自身叶子名称/提示过滤，因此本地同词结果保持“分包变洽签”“分包合同”“分包结算”3 项。分组收起后立即恢复，两个已打开页签切换后恢复原页，通知面板只打开读取并由同一入口关闭。未触发已读、删除、处理、提交、导入、导出或任何业务动作；未保存参考截图和业务值。 |
| `R-HOME-LIVE` | 当前直接证据 | 已登录参考站“默认首页” | 桌面窗口，内容区约 1348×1071，2026-07-27 | 仅通过 Windows 无障碍树读取并在观察后恢复用户原活动页签：上方为待办、周历日程、公告，当前分别显示暂无待办、暂无日程、暂无公告；下方有项目信息、目标成本、付款申请、费用报销四个快捷入口。未见项目切换、施工进度甘特、经营指标卡或统计图表。未点击快捷入口、加号或任何业务动作，未保存参考截图和业务值。 |
| `R-SUBCONTRACT-LIST-LIVE` | 当前直接证据 | `默认首页 > 分包及人工 > 分包合同`；活动业务页签为“分包合同” | 桌面窗口，`RootWebArea` 约 1568×1153，2026-07-27 | 用户先打开目标页，本轮仅通过浏览器辅助功能树读取：确认左侧合同分类、搜索/筛选、紧凑工具栏、超宽合同表格及表格内横向延展；“导入/新建”只确认控件存在，未触发；未把任何行级业务值写入仓库或公开 Issue |
| `R-TABLE-LIVE` | 当前直接证据 | 已登录参考站采购合同编辑表、采购合同列表与分供方列表 | 桌面窗口，2026-07-28 | 严格只读观察并测量：编辑表表头约 36px；列表表头约 34px、数据行约 36px；宽表只在表格内部横滚，重要列与末尾操作列固定；可调列手柄仅位于表头右边缘，命中区约 7px、`right:-4px`、`cursor:col-resize`。仅切换既有页签、打开并关闭筛选/看板设置等只读浮层；未执行新增、编辑、删除、保存、提交、审批、上传、下载、导入或导出，也未记录业务值。 |
| `R-MATERIAL-CONTRACT-LIVE` | 当前直接证据 | `默认首页 > 乙供材管理 > 材料采购合同` | Chrome 内容视口约 1280×1024，2026-07-29 | 列表为“左侧单层合同分类 + 顶部单行搜索/图标工具栏 + 单一紧凑宽表 + 底部汇总和分页”；合同名为蓝色详情入口，末列为固定省略号操作。安全右键合同名称未出现参考站自定义业务菜单；单击名称打开详情页签。未打开省略号菜单，未执行导入或任何行级动作。 |
| `R-FORM-LIVE` | 当前直接证据 | 空白“新建支出合同·材料采购合同”与“新建分供方·大宗供应商”页 | Chrome 内容视口约 1280×1024，2026-07-29 | 经用户明确授权，只打开空白新建页后取消：复杂合同表单使用约 140px 左分区导航、两列字段网格、纵向分区、局部明细表和固定底部操作条；较短的分供方表单不保留空左栏，直接使用两列字段网格、内容区纵向滚动和同一固定底部操作条。分供方先以小型类型选择对话框确定表单种类，再进入整页表单；类型选择弹窗不承载实体字段。未录入、粘贴、上传、保存或提交。 |
| `R-DETAIL-LIVE` | 当前直接证据 | 材料采购合同名称单击进入“详情-支出合同”页签 | Chrome 内容视口约 1280×1024，2026-07-29 | 详情采用“顶部摘要与动作 + 左侧审批轨迹/业务内容 + 右侧审批记录栏 + 页内标签”的整页结构；变更历史、增补合同和基础信息均在详情内容区内分段，不再套大弹窗。只打开并关闭详情，未触发复制、变更、打印、转计划或任何写操作。 |
| `R-PROJECT-LIST-LIVE` | 当前直接证据 | `默认首页 > 项目信息` | Chrome 内容视口约 1280×1024，2026-07-29 | 项目列表为“左侧业务流程阶段 + 顶部单行搜索/筛选/设置工具栏 + 紧凑表格 + 右下分页”；本次观察到导入入口，未观察到新建入口。项目名称和金额使用链接态，操作保持右侧固定。未点击导入、筛选、设置或行级操作。 |
| `R-PROJECT-DETAIL-LIVE` | 当前直接证据 | `默认首页 > 项目信息 > 项目名称` | Chrome 内容视口约 1280×1024，2026-07-30 | 项目详情为“紧凑标题与五项元数据 + 项目经营数据/往来款/票据信息 + 左侧审批流程与项目阶段 + 右侧项目团队与文件”的宽屏双栏结构，区块使用轻边界而非层层大卡片。仅通过项目名称进入并读取结构，未触发编辑、上传、下载、审批或任何写入；未保存业务名称、人员、金额等参考值。 |
| `R-SUPPLIER-LIST-LIVE` | 当前直接证据 | 已打开业务页签“分供方” | Chrome 内容视口约 1280×1024，2026-07-29 | 分供方列表不设空白左树，搜索/刷新/排序/筛选/设置/导入/新建保持一行，表格占满剩余宽度并在加载时原位显示骨架。新建入口先弹出供应商类型选择，确认默认类型后进入整页表单；取消后返回原列表。未录入、保存、提交、导入或触发行级操作。 |

上一次实施无法读取浏览器正文，因此当时生成的项目详情“当前直接证据”和线框不成立，已在本轮撤销；#190 已按严格只读协议重新观察并登记为 `R-PROJECT-DETAIL-LIVE`。`R-DETAIL-LIVE` 仍只覆盖材料采购合同详情，不能外推项目字段。当前直接证据覆盖全局外壳、默认首页、上述合同列表/空白新建/合同详情，以及项目列表和项目详情；外壳证据只支持导航、页签和通知的结构/只读状态，不能外推为其他业务页字段或写入行为。

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
| `app/pages/base/crew/[id].vue` | `/base/crew/:id` | 基础主数据 | 详情 | #194 | R-DETAIL-PRIOR | #194 已完成统一详情壳、真实成员/能力/项目工程量/工资/扣罚区块、长名称与四档无整页横滚回归 | 电话脱敏；工人、关联人员、项目和扣罚源单真实下钻；无事实时分别显示空态 | C-DENSE |
| `app/pages/base/crew/form/[[id]].vue` | `/base/crew/form/:id?` | 基础主数据 | 整页表单 | #194 | R-FORM-PRIOR | #194 已完成整页表单返回详情、电话输入语义、班组级计薪说明与开关联动回归 | 只写 `crews` 与班组附件；不恢复不存在的班组项目单价关系 | C-FORM |
| `app/pages/base/crew/index.vue` | `/base/crew` | 基础主数据 | 列表 | #194 | R-LIST-PRIOR | #194 已完成真实人数/在场人数/项目数、领域筛选、紧凑工具栏与四档局部横滚回归 | 名称下钻；电话脱敏；在册工人阻止删除，其他下游触发级联安全确认；不涉及 #191 目标成本列表 | C-DENSE |
| `app/pages/base/customer/[id].vue` | `/base/customer/:id` | 基础主数据 | 详情 | #194 | R-DETAIL-PRIOR | #194 已完成客户主数据、名下项目、施工合同与收款台账的只读聚合、页签深链及四档回归 | 方向键切换页签；只按真实外键下钻，不从名称或合同金额推算收款 | C-DENSE |
| `app/pages/base/customer/form/[[id]].vue` | `/base/customer/form/:id?` | 基础主数据 | 整页表单 | #194 | R-FORM-PRIOR | #194 已完成整页表单返回详情、联系人输入语义及统一社会信用代码冲突反馈 | 保存仍走客户领域 action；敏感字段只在编辑流程维护 | C-FORM |
| `app/pages/base/customer/index.vue` | `/base/customer` | 基础主数据 | 列表 | #194 | R-LIST-PRIOR | #194 已完成简称/税号/联系人列、领域搜索筛选、紧凑工具栏与四档局部横滚回归 | 名称下钻；税号与电话脱敏；活跃项目/合同阻止删除，其他下游触发级联安全确认 | C-DENSE |
| `app/pages/base/supplier/[id].vue` | `/base/supplier/:id` | 分供方 | 详情 | #193 | R-DETAIL-PRIOR | #193 已按统一详情壳完成长名称、脱敏摘要、6 页签、可追溯汇总、分类文件区与四档布局回归 | 参考系统未安全观察的审批、评论和供应商层级不推断；资料状态与文件动作由本地 #13 契约裁定 | C-BASE |
| `app/pages/base/supplier/form/[[id]].vue` | `/base/supplier/form/:id?` | 分供方 | 整页表单 | #193 | R-FORM-LIVE | #193 已确认短表单无空左栏、两列字段网格、内容滚动、固定底部操作和统一七类选择；主数据保存后进入真实证照流程 | 普通附件不伪装证照；`approvalStatus` 不展示，证照原件、OCR 与人工核验统一在详情维护 | C-FORM |
| `app/pages/base/supplier/index.vue` | `/base/supplier` | 分供方 | 列表 | #193 | R-SUPPLIER-LIST-LIVE | #193 已完成无空左树、单行工具栏、真实项目/欠款/资料筛选、聚合列、固定操作列、局部横滚和列表汇总回归 | 行级关联写入真实 ProjectSupplier；税号与电话脱敏；上级供应商和参考站未授权业务动作不引入 | C-DENSE |
| `app/pages/base/worker/[id].vue` | `/base/worker/:id` | 基础主数据 | 详情 | #194 | R-DETAIL-PRIOR | #194 已完成个人资料、班组、能力、附件、项目责任、考勤、签工、工资、扣罚与关联人员区块及四档回归 | 身份/联系/银行信息脱敏；档案与在场状态分离；工资和扣罚真实下钻且不反推个人金额 | C-DENSE |
| `app/pages/base/worker/form/[[id]].vue` | `/base/worker/form/:id?` | 基础主数据 | 整页表单 | #194 | R-FORM-PRIOR | #194 已完成整页编辑返回详情及主档字段闭环 | 班组、当前项目保存真实 ID；项目不可见时不连带隐藏跨项目工人主档 | C-FORM |
| `app/pages/base/worker/index.vue` | `/base/worker` | 基础主数据 | 列表 | #194 | R-LIST-PRIOR | #194 已完成班组/项目/档案状态/在场状态/进退场日期/安全教育列、领域筛选与四档局部横滚回归 | 电话和身份证脱敏；键盘可进入详情；存在工资、扣罚等下游时触发级联安全确认 | C-DENSE |
| `app/pages/contract/[id].vue` | `/contract/:id` | 核心合同 | 详情 | #195 | R-DETAIL-LIVE | #195 已按参考构图完成顶部摘要、合同阶段、金额、本地基本信息、真实关联单据、材料采购明细与合同文件页签；不补造审批人或关联记录 | 参考仅打开并关闭材料采购合同详情；本地按真实外键和文件引用验证 | C-BASE |
| `app/pages/contract/boq/import.vue` | `/contract/boq/import` | 核心合同 | 特殊工具 | #195 | R-TOOL-PENDING | #195 已按本地清单拆表蓝本完成三步导入、逐 sheet 映射、持久缺失字段错误与四档无整页横滚回归；无红圈安全直接证据，不宣称同屏复刻 | 未对参考站触发上传或导入；A–E 格式与人工确认口径以 `docs/rewrite/pages/boq-import.md` 为准 | C-TOOL |
| `app/pages/contract/boq/index.vue` | `/contract/boq` | 核心合同 | 工作台 | #195 | R-WORKBENCH-PRIOR | #195 已完成目录/密集表格/变更/月度报量三页签、完整合同编号、直接业务入口、金额完整显示、键盘与四档局部横滚回归；无红圈安全直接证据 | 原始金额不做 MoneyLink；清单手调/导出不推进甲方报量状态；布局权威见 `docs/rewrite/pages/boq-import.md` | C-DENSE |
| `app/pages/contract/company-expense/form/[id].vue` | `/contract/company-expense/form/:id` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/company-expense/form/index.vue` | `/contract/company-expense/form` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/company-expense/index.vue` | `/contract/company-expense` | 辅助合同与结算 | 列表 | #196 | R-LIST-PRIOR | 待 #196 同屏测量 | 待 #196 只读核对 | C-DENSE |
| `app/pages/contract/construction/form/[id].vue` | `/contract/construction/form/:id` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | #195 已完成整页分区、真实 lookup、草稿/提交校验和四档局部滚动回归 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/construction/form/index.vue` | `/contract/construction/form` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | #195 已完成整页分区、真实 lookup、草稿/提交校验和四档局部滚动回归 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/construction/index.vue` | `/contract/construction` | 核心合同 | 列表 | #195 | R-LIST-PRIOR | #195 已统一项目/客户/状态/搜索工具栏、收入侧金额口径、分页、长编号与四档局部横滚 | 本地聚合只按合同真实外键；未扩张参考写操作 | C-DENSE |
| `app/pages/contract/material/form/[id].vue` | `/contract/material/form/:id` | 核心合同 | 整页表单 | #195 | R-FORM-LIVE | 复用左分区导航、两列字段网格、局部明细表和底部固定操作条；编辑态字段差异仍按本地规格 | 写入路径保持现有契约；参考站仅观察空白新建态 | C-FORM |
| `app/pages/contract/material/form/index.vue` | `/contract/material/form` | 核心合同 | 整页表单 | #195 | R-FORM-LIVE | 已确认独立页签整页表单、分区导航、两列主体、局部明细表和固定底部动作 | 仅进入空白页、切换分区并取消，未录入或保存 | C-FORM |
| `app/pages/contract/material/index.vue` | `/contract/material` | 核心合同 | 列表 | #195 | R-MATERIAL-CONTRACT-LIVE | 已确认左分类、单行工具栏、紧凑表格、固定操作列及底部汇总/分页；具体字段继续按本地规格 | 仅打开既有详情与空白新建页；未执行录入、保存、提交、导入或行级动作 | C-DENSE |
| `app/pages/contract/other-expense/form/[id].vue` | `/contract/other-expense/form/:id` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/other-expense/form/index.vue` | `/contract/other-expense/form` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/other-expense/index.vue` | `/contract/other-expense` | 辅助合同与结算 | 列表 | #196 | R-LIST-PRIOR | 待 #196 同屏测量 | 待 #196 只读核对 | C-DENSE |
| `app/pages/contract/other-settlement/form/[id].vue` | `/contract/other-settlement/form/:id` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/other-settlement/form/index.vue` | `/contract/other-settlement/form` | 辅助合同与结算 | 整页表单 | #196 | R-FORM-PRIOR | 待 #196 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/other-settlement/index.vue` | `/contract/other-settlement` | 辅助合同与结算 | 列表 | #196 | R-LIST-PRIOR | 待 #196 同屏测量 | 待 #196 只读核对 | C-DENSE |
| `app/pages/contract/subcontract/form/[id].vue` | `/contract/subcontract/form/:id` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | #195 已完成整页分区、真实 lookup、草稿/提交校验和四档局部滚动回归 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/subcontract/form/index.vue` | `/contract/subcontract/form` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | #195 已完成整页分区、真实 lookup、草稿/提交校验和四档局部滚动回归 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/subcontract/index.vue` | `/contract/subcontract` | 核心合同 | 列表 | #195 | R-SUBCONTRACT-LIST-LIVE | #195 已收敛为参考式左分类、单行项目/分供方/状态/搜索工具栏、紧凑超宽表格与分页，保留劳务/专业业务分类 | 参考仅确认分类、搜索/筛选及导入/新建入口存在；本地行内详情和写路径沿用真实契约 | C-DENSE |
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
| `app/pages/finance/payment-management/index.vue` | `/finance/payment-management` | 支出财务 | 工作台 | #203 | R-WORKBENCH-PRIOR | 设计稿 PayManageScreen；待 #203 同屏测量 | 只读核对批复与已确认支付；登记支付跳整页支付记录 | C-DENSE |
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
| `app/pages/index.vue` | `/` | 首页 | 工作台 | #189 | R-HOME-LIVE | 参考首页是待办/周历/公告与四个快捷入口的通用门户，未见项目切换和甘特；瑞航按 DC 独有设计保留项目切换 + 单一真实施工进度甘特，不复制无对应事实的门户面板 | 参考入口未触发；瑞航首页只读，项目切换失败恢复原项目，工序仅下钻现有工程量或提示前往施工进度维护 | C-DENSE |
| `app/pages/material/arrival/[id].vue` | `/material/arrival/:id` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/arrival/index.vue` | `/material/arrival` | 自购材 | 列表 | #199 | R-LIST-PRIOR | 待 #199 同屏测量 | 待 #199 只读核对 | C-DENSE |
| `app/pages/material/arrival/new.vue` | `/material/arrival/new` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/delivery/archive/[id].vue` | `/material/delivery/archive/:id` | 送货单闭环 | 详情 | #201 | R-DETAIL-PRIOR | 待 #201 同屏测量 | 待 #201 只读核对 | C-BASE |
| `app/pages/material/delivery/archive/form/[[id]].vue` | `/material/delivery/archive/form/:id?` | 送货单闭环 | 整页表单 | #201 | R-FORM-PRIOR | 待 #201 同屏测量；同一路由统一新建/编辑 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/delivery/archive/index.vue` | `/material/delivery/archive` | 送货单闭环 | 工作台 | #201 | R-WORKBENCH-PRIOR | 待 #201 同屏测量 | 待 #201 只读核对 | C-DENSE |
| `app/pages/material/delivery/index.vue` | `/material/delivery` | 送货单闭环 | 工作台 | #201 | R-WORKBENCH-PRIOR | 待 #201 同屏测量 | OCR/归档动作保持现有契约 | C-DENSE |
| `app/pages/material/price.vue` | `/material/price` | 材料价格 | 特殊工具 | #207 | R-TOOL-PENDING | 2026-07-29 按用户定稿完成“搜索选材料→趋势/厂家比较→来源→合同历史”及 390/768/1024/1440px 回归；没有直接参考页证据，不声称已对齐参考站 | 搜索、材料切换、最多 4 家趋势、最新价横向比较及只读送货单/合同下钻已验证；不触发参考站或本地业务写入 | C-TOOL |
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
| `app/pages/project/[id].vue` | `/project/:id` | 项目 | 详情 | #190 | R-PROJECT-DETAIL-LIVE | 参考已确认紧凑标题与元数据、三组经营摘要、左侧流程/阶段和右侧团队/文件的宽屏双栏；瑞航继续保留已闭环的十个真实业务页签 | 参考页仅只读打开；瑞航零值无真实下钻时显示文本，编辑进入独立整页表单 | C-DENSE |
| `app/pages/project/[pid]/supplier/[sid].vue` | `/project/:pid/supplier/:sid` | 项目分供方 | 详情 | #192 | R-PROJECT-DETAIL-LIVE | 没有项目×分供方目标页的安全直接证据；这里只借鉴邻近项目详情已确认的紧凑摘要、轻边界分区和局部横向滚动，实际采用页签主区与下方合作文件，不把邻近页字段或动作写成目标页事实 | 合同、请款、收票、付款、支出结算及文件只读真实源表并穿透现有路由；合作终态结算沿用本地状态机与事务写入，不从参考页推断业务 | C-DENSE |
| `app/pages/project/[pid]/supplier/import.vue` | `/project/:pid/supplier/import` | 项目分供方 | 特殊工具 | #192 | R-FORM-LIVE | 没有文件导入目标页的安全直接证据，且严格只读协议禁止在参考站触发上传或导入；这里只借鉴邻近整页表单已确认的纵向分区、步骤信息和底部操作区，三步内容由本地蓝本裁定 | 当前只在本机按文件名匹配名称/别名与类别，所有结果可人工调整；不读取正文、不伪装 OCR、不上传云端，未确认候选不写分供方，文件只挂 ProjectSupplier | C-TOOL |
| `app/pages/project/form/[[id]].vue` | `/project/form/:id?` | 项目 | 整页表单 | #190 | R-FORM-PRIOR | 项目目标页没有安全直接证据；仅借鉴 `R-FORM-LIVE` 的相邻短表单结构，并以项目蓝本、ADR 0014 和真实客户外键裁定字段与行为 | 保留草稿、保存、保存并新建、保存并提交；新建取消返回列表、保存进入新项目详情，编辑取消/保存返回原项目详情 | C-FORM |
| `app/pages/project/index.vue` | `/project` | 项目 | 列表 | #190 | R-PROJECT-LIST-LIVE | 参考已确认左流程阶段、单行工具栏、紧凑表格和右下分页；本地新建能力继续按项目规格保留 | 未触发导入、筛选、设置或行级操作 | C-DENSE |
| `app/pages/project/penalty/[id].vue` | `/project/penalty/:id` | 甲方单据 | 整页表单 | #197 | R-FORM-PRIOR | 待 #197 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/project/penalty/index.vue` | `/project/penalty` | 甲方单据 | 列表 | #197 | R-LIST-PRIOR | 待 #197 同屏测量 | 待 #197 只读核对 | C-DENSE |
| `app/pages/project/penalty/new.vue` | `/project/penalty/new` | 甲方单据 | 整页表单 | #197 | R-FORM-PRIOR | 待 #197 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/project/target-cost/[id].vue` | `/project/target-cost/:id` | 项目进度成本 | 详情 | #191 | R-DETAIL-PRIOR | 待 #191 同屏测量 | 只读汇总所选版本与项目正式成本事实 | C-DENSE |
| `app/pages/project/target-cost/form/[[id]].vue` | `/project/target-cost/form/:id?` | 项目进度成本 | 整页表单 | #191 | R-FORM-PRIOR | 待 #191 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/project/target-cost/index.vue` | `/project/target-cost` | 项目进度成本 | 列表 | #191 | R-LIST-PRIOR | 待 #191 同屏测量 | 待 #191 只读核对 | C-DENSE |
| `app/pages/schedule/[pid]/index.vue` | `/schedule/:pid` | 项目进度成本 | 工作台 | #191 | R-WORKBENCH-PRIOR | 待 #191 同屏测量 | 排程写入路径保持现有契约 | C-DENSE |
| `app/pages/schedule/[pid]/bind/[gid].vue` | `/schedule/:pid/bind/:gid` | 项目进度成本 | 整页表单 | #191 | R-FORM-PRIOR | 采用整页选择与只读复核，不使用复杂弹窗；合同名称/编号检索、楼栋覆盖、分项映射和数量差异按本地 ADR 0017 领域契约呈现 | 进入页面不写入；只有无阻断且再次确认“确认绑定”才切换范围依据，成功后返回原施工进度分组 | C-FORM |
| `app/pages/schedule/index.vue` | `/schedule` | 项目进度成本 | 工作台 | #191 | R-WORKBENCH-PRIOR | 待 #191 同屏测量 | 待 #191 只读核对 | C-DENSE |
| `app/pages/schedule/new.vue` | `/schedule/new` | 项目进度成本 | 整页表单 | #191 | R-FORM-PRIOR | 待 #191 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/schedule/process-library/form.vue` | `/schedule/process-library/form` | 项目进度成本 | 整页表单 | #191 | R-FORM-PRIOR | 遵循 ADR 0014 整页表单与本地甘特/精确表格双视图；无直接参考页时以 DC 品牌原语为准 | 进入页面只读来源版本；只有“保存为新版本”才新增库与工序定义，绝不回写来源版本 | C-FORM |
| `app/pages/schedule/process-library/index.vue` | `/schedule/process-library` | 项目进度成本 | 列表 | #191 | R-LIST-PRIOR | 版本列表沿用本地紧凑表格与局部横向滚动；不照搬无直接参考的业务结构 | 只读展示版本、工序数及引用数；编辑动作统一转入新版本整页表单 | C-DENSE |
| `app/pages/settings/ocr.vue` | `/settings/ocr` | 系统设置 | 工作台 | #204 | R-OCR-STUDIO-SOURCE | 采用参考项目的单页纵向区块、紧凑密度和底部恢复/保存反馈；字段与能力只按 ADR 0006 的 PaddleOCR-VL 单模型契约实现，不照搬传统 PP-OCRv6 参数 | 当前路由已可达；7 项 VL 文档能力和有界请求/轮询超时保存到本机 SQLite，并真实进入发票、送货单识别请求。Token、API 地址和模型仍由服务端私有配置持有，不提供假保存 | C-TOOL |
| `app/pages/subcontract/[kind]/[id].vue` | `/subcontract/:kind/:id` | 分包单据 | 整页表单 | #197 | R-FORM-PRIOR | 待 #197 分类型测量 | 动态单据写入路径保持现有契约 | C-FORM |
| `app/pages/subcontract/[kind]/index.vue` | `/subcontract/:kind` | 分包单据 | 列表 | #197 | R-LIST-PRIOR | 待 #197 分类型测量 | 动态类型与权限保持现有契约 | C-DENSE |
| `app/pages/subcontract/[kind]/new.vue` | `/subcontract/:kind/new` | 分包单据 | 整页表单 | #197 | R-FORM-PRIOR | 待 #197 分类型测量 | 动态单据写入路径保持现有契约 | C-FORM |
| `app/pages/subcontract/attendance.vue` | `/subcontract/attendance` | 工程量与工资 | 工作台 | #198 | R-WORKBENCH-PRIOR | 待 #198 同屏测量 | 考勤写入路径保持现有契约 | C-DENSE |
| `app/pages/subcontract/daywork.vue` | `/subcontract/daywork` | 工程量与工资 | 工作台 | #198 | R-WORKBENCH-PRIOR | C2 逐日签工独立整页；待后续同屏测量 A4 记录表 | 签工与考勤同月互斥，已发月份冻结 | C-DENSE |
| `app/pages/subcontract/payroll/[id].vue` | `/subcontract/payroll/:id` | 工程量与工资 | 详情 | #197 | R-DETAIL-PRIOR | 已迁入统一详情壳，成员分配、核算行与 C2 签工均使用 KitTable；具体参考同屏差异仍待 #197 测量 | 仅展示真实工资单外键与 released 冻结快照；草稿/已核对金额不计为正式已发，不包含写入动作 | C-DENSE |
| `app/pages/subcontract/payroll/index.vue` | `/subcontract/payroll` | 工程量与工资 | 工作台 | #198 | R-WORKBENCH-PRIOR | 待 #198 同屏测量 | 工资核算规则保持现有契约 | C-DENSE |
| `app/pages/subcontract/quantity/[pid]/[uid].vue` | `/subcontract/quantity/:pid/:uid` | 工程量与工资 | 详情 | #198 | R-DETAIL-PRIOR | 待 #198 同屏测量 | 待 #198 只读核对 | C-DENSE |
| `app/pages/subcontract/quantity/index.vue` | `/subcontract/quantity` | 工程量与工资 | 工作台 | #198 | R-WORKBENCH-PRIOR | 待 #198 同屏测量 | 工程量写入路径保持现有契约 | C-DENSE |
| `app/pages/subcontract/quantity/region.vue` | `/subcontract/quantity/region` | 工程量与工资 | 整页表单 | #198 | R-FORM-PRIOR | 复用统一整页表单壳；具体区域配置参考仍待 #198 同屏测量 | 只新增楼栋、楼层、户并记录日志；合同可选，归档矩阵禁止写入 | C-FORM |
| `app/pages/subcontract/quantity/template.vue` | `/subcontract/quantity/template` | 工程量与工资 | 整页表单 | #198 | R-FORM-PRIOR | 待 #198 同屏测量 | 户型模板写入路径保持现有契约 | C-FORM |

## 6. 维护规则

1. `app/pages/` 新增、删除或改名生产页面时，同一提交更新本矩阵；`app/pages/dev/` 不计入生产清单。
2. 业务实施票完成安全观察后，记录实际参考路径、视口、只读状态和差异结论；不能用“看起来一样”替代证据。
3. 同一类参考证据可以复用档案代码，但目标页没有直接证据时必须继续标为邻近或待补采。
4. 若发现会改变业务规则、权限、状态机、字段含义或写入副作用的差异，停止实现并按固定模板建立独立 `needs-info` Issue。
5. 实施票关闭前同时更新本矩阵、受影响的页面蓝本/ADR、`ui-implementation-status.md` 和 Issue 验收证据。
