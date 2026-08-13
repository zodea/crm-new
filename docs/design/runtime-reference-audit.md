# 运行态参考差异矩阵

> Issue：[#182](https://github.com/zodea/crm-new/issues/182)
>
> 父计划：[#181](https://github.com/zodea/crm-new/issues/181)
>
> 核对日期：2026-08-13

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
| `R-CONSTRUCTION-CONTRACT-LIVE` | 当前直接证据 | `默认首页 > 主合同管理 > 施工合同 > 合同名称 > 详情-施工合同` | Chrome 内容视口约 1280×1024，2026-08-13 | 列表使用左侧合同状态、单行分类/搜索工具栏、施工专属紧凑宽表和底部汇总/分页；合同名称进入整页详情。详情为紧凑摘要、审批轨迹、白底资料区和详细资料/补充合同/甲方变洽签/验收结算/票税管理/收款登记/竣工验收及保修页签；审批历史为可关闭浮层，完整流程为独立只读流程层。票税管理同时保留开票申请与开票登记，空页签仍展示完整表头。仅点击合同名、页签、审批历史和完整流程；未点击打印、批量下载、编辑、导出、评论、文件或任何写入口。 |
| `R-SUBCONTRACT-CONTRACT-LIVE` | 当前直接证据 | `默认首页 > 分包及人工 > 分包合同 > 合同名称 > 详情-支出合同` | Chrome 内容视口约 1280×1024，2026-08-13 | 列表保留劳务/专业分类及合同金额、变更后金额、累计结算/收票/支付、按结算/按收票应付、完工审定、结算/结清状态等专属列；合同名称进入支出合同详情。详情采用紧凑摘要、审批轨迹和详细资料/分包变洽签/收票登记/付款信息/支出结算/项目罚扣/材料领用情况页签；付款信息再分付款申请与支付明细，支出结算再分过程与完工结算，材料领用再分新仓与历史记录。当前样本多个页签无数据，但完整表头与空态仍保留。仅点击合同名和只读页签；未点击转需用计划、打印、下载、编辑或任何业务动作。 |
| `R-CONTRACT-DETAIL-LIVE` | 当前直接证据汇总 | 施工合同、分包合同、材料采购合同名称分别进入对应只读详情 | Chrome 内容视口约 1280×1024，2026-08-13 | 汇总 `R-CONSTRUCTION-CONTRACT-LIVE`、`R-SUBCONTRACT-CONTRACT-LIVE` 与 `R-DETAIL-LIVE`：三类详情共用紧凑摘要、白底资料和真实关系入口，但施工、分包、材采各有独立业务页签，不能继续以通用四页签冒充已完成复刻；空页签保留完整表头，写入口一律未触发。 |
| `R-TABLE-LIVE` | 当前直接证据 | 已登录参考站采购合同编辑表、采购合同列表与分供方列表 | 桌面窗口，2026-07-28 | 严格只读观察并测量：编辑表表头约 36px；列表表头约 34px、数据行约 36px；宽表只在表格内部横滚，重要列与末尾操作列固定；可调列手柄仅位于表头右边缘，命中区约 7px、`right:-4px`、`cursor:col-resize`。仅切换既有页签、打开并关闭筛选/看板设置等只读浮层；未执行新增、编辑、删除、保存、提交、审批、上传、下载、导入或导出，也未记录业务值。 |
| `R-MATERIAL-CONTRACT-LIVE` | 当前直接证据 | `默认首页 > 乙供材管理 > 材料采购合同` | Chrome 内容视口约 1280×1024，2026-08-13 | 列表为“左侧单层合同分类 + 顶部单行搜索/图标工具栏 + 单一紧凑宽表 + 底部汇总和分页”；合同名为蓝色详情入口，末列为固定省略号操作。以“车陂商业大楼项目”的可见记录补验：合同名称进入“详情-支出合同”，详情中的乙方蓝链继续进入“详情-分供方”。未打开省略号菜单，未执行导入、下载或任何行级写动作。 |
| `R-FORM-LIVE` | 当前直接证据 | 空白“新建支出合同·材料采购合同”与“新建分供方·大宗供应商”页 | Chrome 内容视口约 1280×1024，2026-07-29 | 经用户明确授权，只打开空白新建页后取消：复杂合同表单使用约 140px 左分区导航、两列字段网格、纵向分区、局部明细表和固定底部操作条；较短的分供方表单不保留空左栏，直接使用两列字段网格、内容区纵向滚动和同一固定底部操作条。分供方先以小型类型选择对话框确定表单种类，再进入整页表单；类型选择弹窗不承载实体字段。未录入、粘贴、上传、保存或提交。 |
| `R-DETAIL-LIVE` | 当前直接证据 | 材料采购合同名称单击进入“详情-支出合同”页签 | Chrome 内容视口约 1280×1024，2026-08-13 | 详情采用“顶部摘要与动作 + 左侧审批轨迹/业务内容 + 右侧审批记录栏 + 页内标签”的整页结构；页签包括详细资料、采购合同明细、物资管理、收票登记、付款信息、支出结算和项目罚扣。乙方名称是蓝色关系入口，可继续打开分供方详情；变更历史、增补合同和基础信息均在详情内容区内分段，不再套大弹窗。只读进入并沿关系返回，未触发复制、变更、打印、转计划或任何写操作。 |
| `R-PROJECT-LIST-LIVE` | 当前直接证据 | `默认首页 > 项目信息` | Chrome 内容视口约 1280×1024，2026-08-13 | 项目列表为“左侧业务流程阶段 + 顶部单行搜索/筛选/设置工具栏 + 紧凑表格 + 右下分页”；项目名称、累计收入合同金额、预算总额、项目经理/执行经理、客户和多个项目角色均使用链接态。累计收入合同金额进入按项目过滤的施工合同清单，预算总额进入目标成本清单明细，人员进入项目组成员列表；当前账号点击客户入口被明确权限提示拦截，因此只保留入口语义，不外推客户详情。未点击导入、筛选、设置或行级操作。 |
| `R-PROJECT-DETAIL-LIVE` | 当前直接证据 | `默认首页 > 项目信息 > 车陂商业大楼项目` | Chrome 内容视口约 1280×1024，2026-08-13 | 用户确认“车陂商业大楼项目”是当前权限下流程最完整的主样本；项目详情为“紧凑标题与五项元数据 + 项目经营数据/往来款/票据信息 + 六个小型阶段节点与计数 + 左侧审批流程/阶段任务 + 右侧项目团队与文件”的宽屏双栏结构。详细资料采用白底标签—值排版，不把只读资料做成带底色表单格；区块使用轻边界而非层层大卡片。其他项目只在该样本缺页且当前账号可见时用于补充相邻布局证据，不据其残缺数据反推业务规则。未触发编辑、上传、下载、审批或任何写入；未保存业务人员、金额等参考值。 |
| `R-CUSTOMER-LIST-LIVE` | 当前直接证据，详情受权限限制 | `默认首页 > 基础信息 > 客户` | Chrome 内容视口约 1280×1024，2026-08-13 | 客户列表为无空左树的单行筛选/工具栏、紧凑宽表和右下分页；可观察列为客户名称、类型、法人代表、详细地址、主要联系人/电话/职务、行业、负责人、创建时间和操作。当前账号列表无可见记录，且从项目客户蓝链进入时收到明确权限拒绝，因此只能确认列表构图与客户入口语义，不能把权限拒绝解释为客户详情不存在，也不外推详情或表单字段。未点击新建、导入或行级动作。 |
| `R-SUPPLIER-LIST-LIVE` | 当前直接证据 | `默认首页 > 基础信息 > 分供方` | Chrome 内容视口约 1280×1024，2026-08-13 | 分供方列表不设空白左树，搜索/刷新/排序/筛选/设置/导入/新建保持一行，表格占满剩余宽度并使用紧凑宽表和右下分页。可观察列覆盖分供方名称/类别/唯一识别码/简称/上级、地址与联系人、审批与纳税人类型、主营/劳务范围、开户信息、业务类型、累计结算/合同、营业执照与附件。名称进入独立分供方详情；本次样例的列表累计金额虽呈蓝色，但点击只返回“无可用操作”，未形成可靠目标页，因此本地不得复制这种失效链接，聚合下钻以详情页直接证据为准。新建入口只沿用既有空表单证据，未在本轮触发；未执行导入、保存、提交或行级写动作。 |
| `R-SUPPLIER-DETAIL-LIVE` | 当前直接证据 | `材料采购合同 > 合同名称 > 乙方名称 > 详情-分供方` | Chrome 内容视口约 1280×1024，2026-08-13 | 分供方详情采用“紧凑摘要 + 详细资料/支出合同/物资管理/支出结算/收票登记/付款管理页签 + 左侧平铺资料分区 + 右侧审批、文件、评论、跟进人与动态”的双栏布局。详细资料中的“往期合作情况”不是纯展示：累计合同金额和累计结算金额进入关联支出合同/结算事实，累计收票金额进入收票登记，累计付款金额进入付款事实；灰色应付金额无下钻。支出合同展示项目、乙方、金额及累计结算/收票/支付；支出结算展示合同、结算类型、期间金额与累计支付；物资管理分为出库记录和班组领用记录；收票登记和付款管理即使当前样例为零记录，仍保留完整表头、真实空态，其中付款管理再分付款申请与集中付款明细。目标无记录时不能删除入口或伪造记录。只切换页签和已确认的只读关系入口，未点击文件、下载、评论、生成往来单位、查询、转移负责人或任何写动作。 |
| `R-TARGET-COST-LIVE` | 当前直接证据 | `默认首页 > 目标成本 > 目标成本名称 > 详情-目标成本` | Chrome 内容视口约 1280×1024，2026-08-13 | 列表使用单行工具栏、紧凑宽表和右下分页，列包含目标成本名称、项目、收入合同金额、计划利润、已签合同额、含税/不含税目标成本、税金、备注、创建人/时间和审批状态。名称进入独立“详情-目标成本”页签；详情当前只有“详细资料”页签，白底平铺目标成本、已签合同、实际成本、已申请付款、成本占比与审批状态等只读摘要，并提供明确关闭返回。列表中的已签合同额为蓝色入口，进入“全部目标成本清单明细”嵌套列表；即使当前项目显示空表，也保留返回、表头与分页。只确认导出、导入、新建控件存在，均未触发；未进入目标成本表单，不能据此外推表单字段或写入行为。 |
| `R-TARGET-COST-LOCAL` | 固定本地脱敏资料与 DC 直接源码，非目标页运行态 | `红圈系统/业务流转.md` 的 `targetCost3X` / `targetCostListDetails3X` 脱敏关系；`DC重构设计源码/kit/TargetCostListScreen.jsx`、`TargetCostDetailScreen.jsx`、`forms/BaseForms.jsx` | 固定源码桌面构图；生产实现仍复核 390、768、1024、1280–1440px | 本地脱敏资料证明目标成本头、清单明细和预算/已签/实际/申请四轨关系；DC 源码继续裁定瑞航目标成本整页表单、版本/基线语义和正式成本对比。运行态列表与详情改由 `R-TARGET-COST-LIVE` 佐证；本轮未进入参考表单，因此表单字段、保存/提交动作和本地事务契约仍不能从参考站外推。 |
| `R-OWNER-DOCUMENTS-LIVE` | 当前直接证据 | `默认首页 > 主合同管理 > 甲方报量 / 甲方罚扣单 / 甲方变洽签 / 竣工验收 / 最终结算 / 保修到期确认单`；甲方报量编号进入只读详情 | Chrome 内容视口约 1280×1024，2026-08-13 | 六类列表均保留专属分类、列、汇总/分页和空态，不能压成一套通用表；甲方报量有真实行，编号进入“详情-收入结算”，详情采用顶部摘要、审批轨迹、详细资料/合同清单/变洽签清单/扣款与奖励/结算转扣记录页签。项目、施工合同和甲方均为蓝色关系入口，附件为独立集合。仅点击菜单、报量编号与只读页签；未点击导入、新建、下载、文件、评论、审批或任何写动作。其余五类详情未因列表为空而外推。 |
| `R-SUB-DOCUMENTS-LIVE` | 当前直接证据 | `默认首页 > 分包及人工 > 分包变洽签 / 分包结算 / 项目罚扣`；分包合同详情的对应只读页签 | Chrome 内容视口约 1280×1024，2026-08-13 | 三类独立列表分别展示变更合同金额链、结算付款余额链和罚扣转扣关系列；当前列表样本均为空，但完整分类、表头、分页与空态仍存在。分包合同详情中的项目罚扣页签进一步按已通过、审批中、未提交/已驳回/已撤销、补充协议四组保留同一专属表头。只切换菜单和既有只读页签，未触发导入、新建、导出、编辑、审批或行级动作。 |
| `R-AUX-DOCUMENTS-LIVE` | 当前直接证据 | `默认首页 > 项目其他合同 > 项目其他收入合同 / 其他支出合同 / 其他支出结算 / 公司支出合同` | Chrome 内容视口约 1280×1024，2026-08-13 | 四类入口都保持自己的分类和专属表头；当前样本为空仍显示分页/空态。项目其他收入含项目、甲方、税率、期限和两类合同附件；其他支出含项目/乙方及结算、收票、支付、应付与结清链；其他支出结算含项目/合同/分供方、奖罚及申请/支付余额；公司支出不含项目，改为甲乙方、税额、附件、票款与经办审计列。只切换菜单，未触发导入、新建、导出或任何业务动作。项目其他收入当前无本地生产路由，只作为相邻范围证据。 |
| `R-MATERIAL-SETTLEMENT-LIVE` | 当前直接证据 | `默认首页 > 乙供材管理 > 材料采购结算 > 结算名称 > 详情-支出结算` | Chrome 内容视口约 1280×1024，2026-08-13 | 列表保留业务类型分类、付款状态、项目/采购合同/分供方、含税金额/奖罚/本次结算、申请与支付四档余额、审批状态、全量汇总和分页。结算名称进入只读详情，详情为顶部摘要、审批轨迹与详细资料；资料分基础、前期、结算、累计、应付、质保金和系统信息，并有附件集合及可空的采购结算明细表（关联到货单/送货单/到货日/金额）。仅点击结算名称，未点击附件、批量下载、审批、评论、新建、导入或行级动作；该明细的本地 canonical 关系尚未裁定，不能据此补 Mock 表格。 |
| `R-MATERIAL-FLOW-LIVE` | 当前直接证据 | `默认首页 > 乙供材管理 > 仓库档案 / 下料单 / 材料到货 / 材料领用 / 乙供材直入直出 / 批量调拨 / 库存盘点`；`材料采购合同 > 合同名称 > 物资管理` | Chrome 内容视口约 1280×1024，2026-08-13 | 七类列表均使用有业务意义的单层分类、单行工具栏、专属紧凑宽表和底部空态/分页；当前样本均为 0 条，但表头明确覆盖仓库与项目、源单据、合同、分供方、送货单、入出库、班组合同、调拨两端、结算和付款状态。材采合同“物资管理”进一步拆成新/历史入库、直入直出、新/历史出库五组专属空表。只切换菜单、既有合同详情和只读页签；未点击新建、编辑、删除、上传、下载、导入、导出、审批、打印、评论、文件或行级动作，也未进入任何表单。 |
| `R-OWNER-MATERIAL-LIVE` | 当前直接证据 | `默认首页 > 甲供材管理 > 甲供材总控量 / 甲供材下料单 / 甲供材到货 / 甲供材领用 / 甲供材直入直出`；`项目信息 > 车陂商业大楼项目 > 物资管理` | Chrome 桌面视口，2026-08-13 | 五类全局列表当前均为 0 条，但各自保留专属分类、单行工具栏、紧凑宽表、真实空态和 20 条/页分页：总控量覆盖计划/盖章/说明/附件，下料覆盖审批/金额/到货情况，到货覆盖源单/分供方/送货单/仓库/结算付款链，领用覆盖负责人/部门/班组合同，直入直出覆盖仓库/分供方/送货照片与编号。主样本项目“物资管理”另保留物资总计划、物资需用计划、入库单三组专属空表；阶段任务、成员与文件位于独立区域。只切换菜单、项目名称和只读页签；未点击导入、新建、上传、下载、文件、评论、操作列或任何写入口。空表无法证明未知详情/明细字段，供货单位和单据头/行身份不得据此猜定。 |
| `R-AUX-CONTRACT-DC` | 本地 DC 直接目标源码，非外部业务运行态 | `DC重构设计源码/kit/CompanyExpScreen.jsx`、`OtherExpScreen.jsx`、`forms/ContractForms.jsx` | 固定源码桌面构图；生产实现仍复核 390、768、1024、1280–1440px | 直接源码规定公司支出合同与项目其他支出合同的列表列、搜索/分类/状态筛选、金额汇总、分页及整页表单分区。公司支出不含项目，其他支出保存真实项目和分供方；外部 `R-TABLE-LIVE`、`R-FORM-LIVE` 只佐证紧凑表格、局部横滚、两列字段与固定底栏等几何，不外推目标页字段或写入行为。 |
| `R-AUX-SETTLEMENT-DC` | 本地 DC 直接目标源码，非外部业务运行态 | `DC重构设计源码/kit/OtherSettleScreen.jsx`、`MatSettleScreen.jsx`、`forms/ContractForms.jsx`、`forms/MaterialForms.jsx` | 固定源码桌面构图；生产实现仍复核 390、768、1024、1280–1440px | 直接源码规定其他支出结算与材料采购结算的项目、真实源合同、分供方、金额、日期、状态、筛选、汇总、分页和整页表单分区。两类结算均没有持久化业务明细实体，不能套用材料采购合同的 `KitEditGrid`；外部运行态只作为表格和表单几何佐证。 |
| `R-OWNER-DOC-DC` | 本地 DC 直接目标源码，非外部业务运行态 | `DC重构设计源码/kit/OwnerChangeScreen.jsx`、`OwnerReportScreen.jsx`、`AcceptanceScreen.jsx`、`FinalSettleScreen.jsx`、`OwnerPenaltyScreen.jsx`、`forms/OwnerDocForms.jsx` | 固定源码桌面构图；生产实现仍复核 390、768、1024、1280–1440px | 直接源码分别规定五类甲方单据的真实标题、列表列、搜索/项目/类型/状态筛选、金额汇总、分页和整页表单分区，不能退化为同一套通用占位界面。外部 `R-TABLE-LIVE`、`R-FORM-LIVE` 只佐证紧凑表格、局部横滚、两列字段与固定底栏等几何；状态名称、来源关系、附件归属及写入动作仍由本地数据库和页面规格裁定。 |
| `R-SUB-DOC-DC` | 本地 DC 直接目标源码，非外部业务运行态 | `DC重构设计源码/kit/SubChangeScreen.jsx`、`SubSettleScreen.jsx`、`ProjPenaltyScreen.jsx`、`forms/OwnerDocForms.jsx` | 固定源码桌面构图；生产实现仍复核 390、768、1024、1280–1440px | 直接源码分别规定分包变洽签、分包结算和项目罚扣的真实标题、列表列、搜索/项目/类型/状态筛选、金额汇总、分页和整页表单分区。外部运行态仅提供共性几何证据；分供方、合同、班组、结算抵扣、附件与状态动作必须沿用本地真实外键和事务契约，不从示例数据反推。 |
| `R-SCHEDULE-LOCAL` | DC 独有能力的固定本地蓝本，非红圈目标页运行态 | `docs/合和新城7期施工进度计划表 （户内）2026.04.22.pdf`、`DC重构设计源码/kit/SchedulePlanScreen.jsx`、`ScheduleGroupNewScreen.jsx`、`ScheduleBindScreen.jsx`、`ScheduleProcessLibraryScreen.jsx`、`forms/ScheduleForms.jsx`、ADR 0017 / 0018 | 固定源码桌面构图与本地生产四档验证 | 本地脱敏红圈资料未登记施工排程对象；`红圈系统/业务流转.md` 仅能提供成本、合同和结算来源关系。因此 WBS、甘特、内部暂估、标准工序库和合同后绑定均按瑞航本地蓝本裁定，不宣称复制红圈目标页。[#244](https://github.com/zodea/crm-new/issues/244) 已合入工序库、合同绑定和整页表单的设计源码落点，但仍保持 open 以追平依赖弹窗细节和四档设计稿验收；#191 只负责生产数据与交互闭环。 |

上一次实施无法读取浏览器正文，因此当时生成的项目详情“当前直接证据”和线框不成立，已在后续严格只读观察中撤销并重建。`R-PROJECT-DETAIL-LIVE` 以用户指定的完整权限项目为主样本；`R-PROJECT-LIST-LIVE` 与 `R-TARGET-COST-LIVE` 补齐项目金额、人员与目标成本名称/金额的隐藏只读下钻；`R-CONSTRUCTION-CONTRACT-LIVE`、`R-SUBCONTRACT-CONTRACT-LIVE`、`R-DETAIL-LIVE` 与 `R-MATERIAL-CONTRACT-LIVE` 共同确认三类合同不能继续共用一组视觉页签，`R-SUPPLIER-DETAIL-LIVE` 则补齐材料合同乙方与往期合作聚合下钻。`R-OWNER-DOCUMENTS-LIVE`、`R-SUB-DOCUMENTS-LIVE`、`R-AUX-DOCUMENTS-LIVE`、`R-MATERIAL-SETTLEMENT-LIVE`、`R-MATERIAL-FLOW-LIVE` 和 `R-OWNER-MATERIAL-LIVE` 进一步确认单据空态也必须保留专属列表，蓝色名称先进入只读详情，项目/合同/客户或分供方关系与返回上下文是同一条导航契约；材料链还必须保留源单、仓库、送货单、班组合同、调拨两端及结算/付款状态。甲供材五类不能继续共用“材料/对象”列表，项目物资页也不能用一张送货归档表冒充总计划、需用计划和入库单；供货单位身份、总计划头/行和归档—入库关系仍等待本地 canonical 裁定。`R-CUSTOMER-LIST-LIVE` 只证明客户列表构图和受权限保护的入口。参考站没有可安全确认的一一对应送货 OCR、归档库或价格分析页面，这三类瑞航独有工具继续由本地 DC、页面规格和真实 SQLite 数据裁定。上述证据仍不能把某一对象字段外推到另一对象，也不能把权限拒绝解释为不存在目标页；参考站的导入、编辑、打印、下载、评论和文件动作均未触发。当前直接证据只支持已实际打开的布局、只读状态和关系入口，不能外推未走查页面、写入行为或参考站私有数据契约。

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
| `app/pages/base/customer/index.vue` | `/base/customer` | 基础主数据 | 列表 | #194 | R-CUSTOMER-LIST-LIVE | 参考已确认无空左树、单行工具栏、紧凑宽表和分页；当前账号无可见客户，字段仍按本地真实模型收敛为名称/简称/税号/联系人/状态，不复制参考私有列 | 名称进入本地真实详情；税号与电话脱敏；参考详情受权限限制，不能据此更改本地外键、删除或表单契约 | C-DENSE |
| `app/pages/base/supplier/[id].vue` | `/base/supplier/:id` | 分供方 | 详情 | #193 | R-SUPPLIER-DETAIL-LIVE | #193 已按统一详情壳完成长名称、脱敏摘要、6 页签、可追溯汇总、分类文件区与四档布局回归；参考补验确认详情双栏、六页签及合同/结算/收票/付款聚合下钻语义 | 蓝色聚合值必须按真实外键进入对应关联列表，目标无可见记录时显示真实空态；灰色值不伪装入口。参考审批、评论、供应商层级和写动作仍不推断，资料状态与文件动作由本地 #13 契约裁定 | C-BASE |
| `app/pages/base/supplier/form/[[id]].vue` | `/base/supplier/form/:id?` | 分供方 | 整页表单 | #193 | R-FORM-LIVE | #193 已确认短表单无空左栏、两列字段网格、内容滚动、固定底部操作和统一七类选择；主数据保存后进入真实证照流程 | 普通附件不伪装证照；`approvalStatus` 不展示，证照原件、OCR 与人工核验统一在详情维护 | C-FORM |
| `app/pages/base/supplier/index.vue` | `/base/supplier` | 分供方 | 列表 | #193 | R-SUPPLIER-LIST-LIVE | #193 已完成无空左树、单行工具栏、真实项目/欠款/资料筛选、聚合列、固定操作列、局部横滚和列表汇总回归 | 行级关联写入真实 ProjectSupplier；税号与电话脱敏；上级供应商和参考站未授权业务动作不引入 | C-DENSE |
| `app/pages/base/worker/[id].vue` | `/base/worker/:id` | 基础主数据 | 详情 | #194 | R-DETAIL-PRIOR | #194 已完成个人资料、班组、能力、附件、项目责任、考勤、签工、工资、扣罚与关联人员区块及四档回归 | 身份/联系/银行信息脱敏；档案与在场状态分离；工资和扣罚真实下钻且不反推个人金额 | C-DENSE |
| `app/pages/base/worker/form/[[id]].vue` | `/base/worker/form/:id?` | 基础主数据 | 整页表单 | #194 | R-FORM-PRIOR | #194 已完成整页编辑返回详情及主档字段闭环 | 班组、当前项目保存真实 ID；项目不可见时不连带隐藏跨项目工人主档 | C-FORM |
| `app/pages/base/worker/index.vue` | `/base/worker` | 基础主数据 | 列表 | #194 | R-LIST-PRIOR | #194 已完成班组/项目/档案状态/在场状态/进退场日期/安全教育列、领域筛选与四档局部横滚回归 | 电话和身份证脱敏；键盘可进入详情；存在工资、扣罚等下游时触发级联安全确认 | C-DENSE |
| `app/pages/contract/[id].vue` | `/contract/:id` | 核心合同 | 详情 | #195 | R-CONTRACT-DETAIL-LIVE | 当前已完成顶部摘要、合同阶段、金额、本地基本信息、真实关联单据、材料采购明细与合同文件；#282 补验确认施工、分包、材采详情分别有专属页签，当前通用四页签只能算数据闭环，尚未完成参考信息架构复刻 | 继续只按真实合同外键和文件引用下钻；补充协议无独立详情路由、施工/分包专属分组与返回筛选恢复列为待补齐，不补造审批人或关联记录 | C-BASE |
| `app/pages/contract/boq/import.vue` | `/contract/boq/import` | 核心合同 | 特殊工具 | #195 | R-TOOL-PENDING | #195 已按本地清单拆表蓝本完成三步导入、逐 sheet 映射、持久缺失字段错误与四档无整页横滚回归；无红圈安全直接证据，不宣称同屏复刻 | 未对参考站触发上传或导入；A–E 格式与人工确认口径以 `docs/rewrite/pages/boq-import.md` 为准 | C-TOOL |
| `app/pages/contract/boq/index.vue` | `/contract/boq` | 核心合同 | 工作台 | #195 | R-WORKBENCH-PRIOR | #195 已完成目录/密集表格/变更/月度报量三页签、完整合同编号、直接业务入口、金额完整显示、键盘与四档局部横滚回归；无红圈安全直接证据 | 原始金额不做 MoneyLink；清单手调/导出不推进甲方报量状态；布局权威见 `docs/rewrite/pages/boq-import.md` | C-DENSE |
| `app/pages/contract/company-expense/form/[id].vue` | `/contract/company-expense/form/:id` | 辅助合同与结算 | 整页表单 | #196 | R-AUX-CONTRACT-DC | 按 `companyExpForm` 直接源码呈现基本信息、金额、合同条款、附件与备注；外部运行态只佐证短表单两列字段、内容滚动和固定底栏 | 编辑只回填并保存独立 `company_expense_contracts`，不补项目、项目结算或分供方外键 | C-FORM |
| `app/pages/contract/company-expense/form/index.vue` | `/contract/company-expense/form` | 辅助合同与结算 | 整页表单 | #196 | R-AUX-CONTRACT-DC | 按 `companyExpForm` 直接源码呈现基本信息、金额、合同条款、附件与备注；外部运行态只佐证短表单两列字段、内容滚动和固定底栏 | 新建不挂项目且不用虚拟项目占位；保存、提交仍走本地状态机 | C-FORM |
| `app/pages/contract/company-expense/index.vue` | `/contract/company-expense` | 辅助合同与结算 | 列表 | #196 | R-AUX-DOCUMENTS-LIVE | 参考确认公司支出不含项目，专属列覆盖甲乙方、税额、合同附件、累计收票/付款/按票应付和经办审计；当前本地仅有编号、名称、类别、对方、金额、日期、合同期和状态 | 保持独立 `company_expense_contracts` 且不造虚拟项目；补读模型前先确认甲乙方与票款 canonical 来源，名称应先进入只读详情而非隐式写态，返回恢复筛选 | C-DENSE |
| `app/pages/contract/construction/form/[id].vue` | `/contract/construction/form/:id` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | #195 已完成整页分区、真实 lookup、草稿/提交校验和四档局部滚动回归 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/construction/form/index.vue` | `/contract/construction/form` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | #195 已完成整页分区、真实 lookup、草稿/提交校验和四档局部滚动回归 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/construction/index.vue` | `/contract/construction` | 核心合同 | 列表 | #195 | R-CONSTRUCTION-CONTRACT-LIVE | 当前项目/客户/状态/搜索、收入侧金额聚合、分页和局部横滚可用；#282 补验确认仍缺实际竣工日期、开票未回金额等施工专属列，以及从详情精确恢复列表筛选的返回语义 | 实际竣工日期没有 canonical 字段时保持空缺并登记数据迁移，不能从合同工期或状态猜测；金额继续只按真实外键派生 | C-DENSE |
| `app/pages/contract/material/form/[id].vue` | `/contract/material/form/:id` | 核心合同 | 整页表单 | #195 | R-FORM-LIVE | 复用左分区导航、两列字段网格、局部明细表和底部固定操作条；编辑态字段差异仍按本地规格 | 写入路径保持现有契约；参考站仅观察空白新建态 | C-FORM |
| `app/pages/contract/material/form/index.vue` | `/contract/material/form` | 核心合同 | 整页表单 | #195 | R-FORM-LIVE | 已确认独立页签整页表单、分区导航、两列主体、局部明细表和固定底部动作 | 仅进入空白页、切换分区并取消，未录入或保存 | C-FORM |
| `app/pages/contract/material/index.vue` | `/contract/material` | 核心合同 | 列表 | #195 | R-MATERIAL-CONTRACT-LIVE | 已确认左分类、单行工具栏、紧凑表格、固定操作列及底部汇总/分页；具体字段继续按本地规格 | 仅打开既有详情与空白新建页；未执行录入、保存、提交、导入或行级动作 | C-DENSE |
| `app/pages/contract/other-expense/form/[id].vue` | `/contract/other-expense/form/:id` | 辅助合同与结算 | 整页表单 | #196 | R-AUX-CONTRACT-DC | 按 `otherExpForm` 直接源码呈现项目合同分区；外部运行态只佐证两列字段、内容滚动和固定底栏 | 回填真实项目与分供方 ID，编辑中不得跨业务类型迁移 | C-FORM |
| `app/pages/contract/other-expense/form/index.vue` | `/contract/other-expense/form` | 辅助合同与结算 | 整页表单 | #196 | R-AUX-CONTRACT-DC | 按 `otherExpForm` 直接源码呈现项目、类别、对方单位、金额、期限、条款和附件 | 项目与分供方 lookup 保存真实 ID；提交校验关联关系，不保存自由文本副本 | C-FORM |
| `app/pages/contract/other-expense/index.vue` | `/contract/other-expense` | 辅助合同与结算 | 列表 | #196 | R-AUX-DOCUMENTS-LIVE | 参考确认专属列表含项目/乙方、合同金额链、累计结算/收票/支付、两档应付及合同/结算/结清状态；当前本地只有基础金额、日期和状态投影 | 聚合只读真实结算、发票和支付外键；没有完工/结清事实时显示未记录，不复制参考内部字段名；名称先进入只读详情并恢复来源筛选 | C-DENSE |
| `app/pages/contract/other-settlement/form/[id].vue` | `/contract/other-settlement/form/:id` | 辅助合同与结算 | 整页表单 | #196 | R-AUX-SETTLEMENT-DC | 按 `otherSettleForm` 直接源码回填基本信息、结算金额、合同情况、附件与备注 | 真实源合同必须属于所选项目；分供方由源合同带出并校验，无候选合同时不允许伪造来源 | C-FORM |
| `app/pages/contract/other-settlement/form/index.vue` | `/contract/other-settlement/form` | 辅助合同与结算 | 整页表单 | #196 | R-AUX-SETTLEMENT-DC | 按 `otherSettleForm` 直接源码先选项目再选其他支出合同，并展示合同金额等只读来源信息 | 只保存结算头和附件；没有业务明细实体，不引入 `KitEditGrid` | C-FORM |
| `app/pages/contract/other-settlement/index.vue` | `/contract/other-settlement` | 辅助合同与结算 | 列表 | #196 | R-AUX-DOCUMENTS-LIVE | 参考确认项目/合同/分供方外，还含奖罚、本次结算与申请/支付余额链；当前统一 `expenditure_settlements` 来源正确但读模型不完整 | 余额只从真实付款申请、支付和抵扣事实派生；来源下钻与返回保留 query，名称先进入只读详情，空数据不能删入口 | C-DENSE |
| `app/pages/contract/subcontract/form/[id].vue` | `/contract/subcontract/form/:id` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | #195 已完成整页分区、真实 lookup、草稿/提交校验和四档局部滚动回归 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/subcontract/form/index.vue` | `/contract/subcontract/form` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | #195 已完成整页分区、真实 lookup、草稿/提交校验和四档局部滚动回归 | 写入路径保持现有契约 | C-FORM |
| `app/pages/contract/subcontract/index.vue` | `/contract/subcontract` | 核心合同 | 列表 | #195 | R-SUBCONTRACT-CONTRACT-LIVE | 当前左分类、项目/分供方/状态/搜索、劳务/专业分类、真实金额和分页可用；#282 补验确认仍缺按收票应付、完工审定、结算/结清状态等分包专属列及返回筛选恢复 | 完工审定按真实完工结算聚合；结清状态不能由零余额或合同名称推断，缺少独立事实时显示未记录 | C-DENSE |
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
| `app/pages/finance/payment/[id]/detail.vue` | `/finance/payment/:id/detail` | 支出财务 | 详情 | #203 | R-DETAIL-PRIOR | 暂无一一对应的详情设计稿；以用户提供的智能业务洞察侧栏作结构线索 | 详情仅展示真实派生的合同、结算、发票、支付勾稽；编辑与登记支付分别进入整页表单，不伪造审批轨迹 | C-DENSE |
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
| `app/pages/material/arrival/index.vue` | `/material/arrival` | 自购材 | 列表 | #199 | R-MATERIAL-FLOW-LIVE | 参考为材料到货专属宽表，包含源单、送货单、项目/分供方/仓库、采购类型、生效/领料/可结算/付款状态及累计金额；当前通用列表只有材料/对象、编号、项目、数量、日期、状态 | 单据编号应先进入只读详情，项目/分供方/合同/源单/送货归档/仓库按真实 ID 下钻并恢复列表上下文；当前名称与查看动作都直接进入编辑表单，且没有送货归档和结算分摊关系 | C-DENSE |
| `app/pages/material/arrival/new.vue` | `/material/arrival/new` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/delivery/archive/[id].vue` | `/material/delivery/archive/:id` | 送货单闭环 | 详情 | #201 | R-TOOL-PENDING | 没有外部一一对应详情；本地已按 DC 呈现送货日、材料项数、金额、入库/打印状态、原件缺失态、项目/分供方和材料明细，现有种子详情可真实运行 | 项目、分供方按 ID 下钻，编辑保持显式整页入口；返回仍需恢复归档树节点、搜索、日期、页码和滚动位置，不把“补传原件”混入只读主路径 | C-BASE |
| `app/pages/material/delivery/archive/form/[[id]].vue` | `/material/delivery/archive/form/:id?` | 送货单闭环 | 整页表单 | #201 | R-FORM-PRIOR | 待 #201 同屏测量；同一路由统一新建/编辑 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/delivery/archive/index.vue` | `/material/delivery/archive` | 送货单闭环 | 工作台 | #201 | R-TOOL-PENDING | 没有外部一一对应工作台；本地 DC 的项目→分供方树、未区分分供方、专属宽表和汇总仍是目标。2026-08-13 本地运行有 3 个归档头/4 条明细，树、空原件态、送货单详情及项目/分供方下钻可用 | 送货单号先进入只读详情；编辑/删除/导出保持显式动作。归档记录尚未与到货 canonical 关联，返回上下文也未完整保留；不得用单号或名称猜关联 | C-DENSE |
| `app/pages/material/delivery/index.vue` | `/material/delivery` | 送货单闭环 | 工作台 | #201 | R-TOOL-PENDING | 参考站没有可安全确认的 OCR 处理区；继续按本地 DC 的队列—原件—人工核对三栏和窄屏分段布局实现，不宣称外部复刻 | OCR、上传、归档、打印与原件动作只按 ADR 0006、`material-delivery.md` 和 #251 裁定；参考站未触发任何文件或写入动作 | C-DENSE |
| `app/pages/material/price.vue` | `/material/price` | 材料价格 | 特殊工具 | #207 | R-TOOL-PENDING | 没有直接参考页；本地 DC 仍裁定“搜索选材料→趋势/厂家比较→来源→合同历史”。2026-08-13 运行态因存量 `ocr_status='reviewed'` 与分析器只接受 `done` 的状态冲突而错误显示空态 | 先在读边界统一 OCR 完成与人工核对完成状态，恢复 3 个归档头/4 条明细中的有效价格事实；来源继续按 `deliveryRecordId + deliveryLineId` 下钻，合同只按真实 `contractId` 下钻，不补 Mock | C-TOOL |
| `app/pages/material/requisition/[id].vue` | `/material/requisition/:id` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/requisition/index.vue` | `/material/requisition` | 自购材 | 列表 | #199 | R-MATERIAL-FLOW-LIVE | 参考下料单专属列覆盖业务/审批状态、项目、供应商、到货情况、明细及完成/部分/未完成入库计数；当前通用列表只显示材料/对象、编号、项目、数量、日期、状态 | 蓝色名称应先进入只读详情，项目、材采合同和关联到货按真实 ID 下钻；到货进度只从 `requisition_id` 聚合，当前直接进入编辑态且缺供应与进度读模型 | C-DENSE |
| `app/pages/material/requisition/new.vue` | `/material/requisition/new` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/settlement/form/[id].vue` | `/material/settlement/form/:id` | 辅助合同与结算 | 整页表单 | #196 | R-MATERIAL-SETTLEMENT-LIVE | 参考名称先进入只读详情，采用摘要、审批轨迹、分段资料、附件与采购结算明细；当前本地同一路由直接承载编辑表单，尚未复刻查看态 | 编辑仍走本地整页表单和真实合同外键；新增独立查看态前先裁定结算—到货分摊实体，不能用采购合同物资行或 Mock 明细冒充；返回必须恢复列表上下文 | C-FORM |
| `app/pages/material/settlement/form/index.vue` | `/material/settlement/form` | 辅助合同与结算 | 整页表单 | #196 | R-AUX-SETTLEMENT-DC | `matSettleForm` 直接源码提供项目、采购合同、金额、期间、扣款、合同情况和附件分区；税额、税率等由本地持久化模型裁定 | 先选项目和真实材料采购合同，分供方从合同派生；只保存结算头和附件，材料采购合同明细仍归 `contract_line_items` | C-FORM |
| `app/pages/material/settlement/index.vue` | `/material/settlement` | 辅助合同与结算 | 列表 | #196 | R-MATERIAL-SETTLEMENT-LIVE | 参考确认付款状态、奖罚、本次结算、申请/支付余额链、全量汇总和分页；当前本地只投影项目/分供方/采购合同、金额、日期与状态 | 补充字段只从真实支出结算、付款申请、支付与抵扣关系聚合；明确当前筛选/全量汇总口径，名称进入只读详情且返回恢复筛选 | C-DENSE |
| `app/pages/material/stock-check/[id].vue` | `/material/stock-check/:id` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/stock-check/index.vue` | `/material/stock-check` | 自购材 | 列表 | #199 | R-MATERIAL-FLOW-LIVE | 参考盘点列表保留项目、仓库、盘点人、日期和生效状态；当前通用列表没有盘点人，`stock_checks` 只有仓库文本且无项目 ID，却仍显示无来源的项目筛选 | 编号应先进入只读详情；仓库必须先建 canonical 实体并与项目关联，未完成迁移前不得按仓库名猜项目或伪造项目筛选 | C-DENSE |
| `app/pages/material/stock-check/new.vue` | `/material/stock-check/new` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/use/[id].vue` | `/material/use/:id` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/material/use/index.vue` | `/material/use` | 自购材 | 列表 | #199 | R-MATERIAL-FLOW-LIVE | 参考领用专属列含类型、项目、出库日、分供方、仓库、领料人、班组/班组合同、出库金额和非班组说明；当前通用列表只有材料/对象、编号、项目、数量、日期、状态 | 编号应先进入只读详情，项目/仓库/班组/班组合同和采购来源按真实 ID 下钻；当前直接进入编辑态，仓库仍是文本，也没有合同或入库批次来源 | C-DENSE |
| `app/pages/material/use/new.vue` | `/material/use/new` | 自购材 | 整页表单 | #199 | R-FORM-PRIOR | 待 #199 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/owner/[kind]/[id].vue` | `/owner/:kind/:id` | 甲方单据 | 整页表单 | #197 | R-OWNER-DOCUMENTS-LIVE | 参考甲方报量编号先进入只读详情，详情有摘要、审批轨迹、五个业务页签、分段资料、附件以及项目/合同/甲方蓝链；当前本地 `/:id` 直接进入编辑表单，其余类型详情尚无直接证据 | 需要把查看态与编辑动作显式分开；写入仍沿本地状态机，详情关系下钻和返回使用受限来源上下文，不能丢列表筛选或从参考推断审批写动作 | C-FORM |
| `app/pages/owner/[kind]/index.vue` | `/owner/:kind` | 甲方单据 | 列表 | #197 | R-OWNER-DOCUMENTS-LIVE | 参考六类入口分别保留专属金额链、日期、甲方/合同、附件、审批列及汇总；当前本地五类路由已有真实实体筛选和局部横滚，但列投影较窄，验收/保修合并为同实体单路由 | 保持 `project_acceptances` 连续生命周期不复制数据；实施票再裁定同路由双视图或别名路由。编号进入只读详情，来源/搜索/类型/状态/页码往返可恢复 | C-DENSE |
| `app/pages/owner/[kind]/new.vue` | `/owner/:kind/new` | 甲方单据 | 整页表单 | #197 | R-OWNER-DOC-DC | 新建页按动态类型显示真实标题、字段分区、金额摘要、必要明细和附件区，不使用通用占位标题 | 项目与施工合同只选择真实关联记录；草稿和提交分别执行本地校验与保存语义 | C-FORM |
| `app/pages/owner-material/arrival/[id].vue` | `/owner-material/arrival/:id` | 甲供材 | 整页表单 | #200 | R-OWNER-MATERIAL-LIVE | 参考列表 0 条，未能安全观察详情；当前 `/:id` 直接进入编辑表单 | 增加独立只读详情，源单/项目/分供方/送货单/仓库只按真实 ID 下钻；编辑仍由明确动作进入现有整页表单 | C-FORM |
| `app/pages/owner-material/arrival/index.vue` | `/owner-material/arrival` | 甲供材 | 列表 | #200 | R-OWNER-MATERIAL-LIVE | 参考为 22 列到货专属宽表及三类分类/未完全出库视图；当前只有“材料/对象、编号、项目、数量、日期、状态” | 按可空 DTO 补源单、分供方、送货单、仓库、采购类型、入出库、结算和付款状态；金额无事实时保持未知 | C-DENSE |
| `app/pages/owner-material/arrival/new.vue` | `/owner-material/arrival/new` | 甲供材 | 整页表单 | #200 | R-OWNER-MATERIAL-LIVE | 本轮只登记参考新建入口，未点击，不能外推表单字段；本地已有项目/材料/质检/入库表单 | 写入路径保持本地总控校验与整页表单；新增关系字段须先有 canonical ID，不复制参考审批动作 | C-FORM |
| `app/pages/owner-material/control/[id].vue` | `/owner-material/control/:id` | 甲供材 | 整页表单 | #200 | R-OWNER-MATERIAL-LIVE | 参考列表 0 条，仅确认二级展开位，未知明细与详情不可外推；当前 `/:id` 直接进入编辑表单 | 增加只读详情并保留未知明细空态；总控头/材料行身份裁定前不拆错实体，编辑由明确动作进入现有表单 | C-FORM |
| `app/pages/owner-material/control/index.vue` | `/owner-material/control` | 甲供材 | 列表 | #200 | R-OWNER-MATERIAL-LIVE | 参考专属列为单据编号、项目、计划日期、备注、盖章、说明、附件；当前为通用材料列表 | 使用总计划头读模型和真实空态；当前材料维度三量可在详情/展开中展示，但不能替代单据头字段 | C-DENSE |
| `app/pages/owner-material/control/new.vue` | `/owner-material/control/new` | 甲供材 | 整页表单 | #200 | R-OWNER-MATERIAL-LIVE | 本轮未点击参考新建；本地已有项目/甲方客户/材料/总控量和派生量表单 | 继续本地事务与项目甲方校验；计划头/行与附件写入待 canonical 裁定后再扩展 | C-FORM |
| `app/pages/owner-material/direct/[id].vue` | `/owner-material/direct/:id` | 甲供材 | 整页表单 | #200 | R-OWNER-MATERIAL-LIVE | 参考列表 0 条，详情不可观察；当前 `/:id` 直接进入编辑表单 | 增加只读详情，项目/仓库/分供方/送货单按真实 ID 下钻并恢复来源；确认写入仍保持双计且不入仓 | C-FORM |
| `app/pages/owner-material/direct/index.vue` | `/owner-material/direct` | 甲供材 | 列表 | #200 | R-OWNER-MATERIAL-LIVE | 参考专属列覆盖业务类型、负责人、项目、仓库、日期、采购类型、分供方、送货照片/编号；当前为通用材料列表 | 专属列和附件计数来自可空 DTO；客户 ID 不得冒充分供方，照片未授权时只显示状态/数量 | C-DENSE |
| `app/pages/owner-material/direct/new.vue` | `/owner-material/direct/new` | 甲供材 | 整页表单 | #200 | R-OWNER-MATERIAL-LIVE | 本轮未点击参考新建；本地已有项目/甲方客户/材料/用途/部位表单 | 保持本地不入仓双计事务；仓库、供货单位和送货单字段先完成身份/关系裁定再写入 | C-FORM |
| `app/pages/owner-material/requisition/[id].vue` | `/owner-material/requisition/:id` | 甲供材 | 整页表单 | #200 | R-OWNER-MATERIAL-LIVE | 参考列表 0 条，未能安全观察详情；当前 `/:id` 直接进入编辑表单 | 增加独立只读详情和真实到货进度，编辑由明确动作进入整页表单；不得手写到货累计 | C-FORM |
| `app/pages/owner-material/requisition/index.vue` | `/owner-material/requisition` | 甲供材 | 列表 | #200 | R-OWNER-MATERIAL-LIVE | 参考专属列覆盖业务/审批、项目、计划/要求到货日、金额、创建人、备注和到货情况；当前为通用材料列表 | 按项目与真实到货关系投影完成/部分/未到状态；金额无单价事实时返回 null 而非 0 | C-DENSE |
| `app/pages/owner-material/requisition/new.vue` | `/owner-material/requisition/new` | 甲供材 | 整页表单 | #200 | R-OWNER-MATERIAL-LIVE | 本轮未点击参考新建；本地已有项目/申请与需用日期/材料计划表单 | 写入路径保持本地状态机；金额与到货关系只在持久化事实具备后派生 | C-FORM |
| `app/pages/owner-material/use/[id].vue` | `/owner-material/use/:id` | 甲供材 | 整页表单 | #200 | R-OWNER-MATERIAL-LIVE | 参考列表 0 条，详情不可观察；当前 `/:id` 直接进入编辑表单 | 增加只读详情，项目/分供方/班组/班组合同按真实 ID 下钻；编辑仍走现有库存与总控校验 | C-FORM |
| `app/pages/owner-material/use/index.vue` | `/owner-material/use` | 甲供材 | 列表 | #200 | R-OWNER-MATERIAL-LIVE | 参考专属列覆盖负责人/部门/创建人、项目/分供方/采购类型、日期/月、班组与班组合同；当前为通用材料列表 | 使用领用专属 DTO；负责人、创建人、班组和班组合同保持独立身份，无关系时显示未记录 | C-DENSE |
| `app/pages/owner-material/use/new.vue` | `/owner-material/use/new` | 甲供材 | 整页表单 | #200 | R-OWNER-MATERIAL-LIVE | 本轮未点击参考新建；本地已有项目/材料/数量/领用人/班组表单 | 写入继续校验甲供库存与总控余量；班组合同/来源批次先建真实关系再扩展 | C-FORM |
| `app/pages/project/[id].vue` | `/project/:id` | 项目 | 详情 | #190 | R-PROJECT-DETAIL-LIVE | 参考已确认紧凑标题与元数据、三组经营摘要、左侧流程/阶段和右侧团队/文件的宽屏双栏；`R-OWNER-MATERIAL-LIVE` 又补验物资管理直接显示总计划、需用计划、入库单三组空表。当前瑞航十个真实页签可用，但物资页只有一张项目到货归档表 | 保留瑞航独有归档为独立来源视图，补三组项目读模型；到货—归档 canonical 关系闭合前不得合并。零值无真实下钻时显示文本，编辑进入独立整页表单 | C-DENSE |
| `app/pages/project/[pid]/supplier/[sid].vue` | `/project/:pid/supplier/:sid` | 项目分供方 | 详情 | #192 | R-PROJECT-DETAIL-LIVE | 没有项目×分供方目标页的安全直接证据；这里只借鉴邻近项目详情已确认的紧凑摘要、轻边界分区和局部横向滚动，实际采用页签主区与下方合作文件，不把邻近页字段或动作写成目标页事实 | 合同、请款、收票、付款、支出结算及文件只读真实源表并穿透现有路由；合作终态结算沿用本地状态机与事务写入，不从参考页推断业务 | C-DENSE |
| `app/pages/project/[pid]/supplier/import.vue` | `/project/:pid/supplier/import` | 项目分供方 | 特殊工具 | #192 | R-FORM-LIVE | 没有文件导入目标页的安全直接证据，且严格只读协议禁止在参考站触发上传或导入；这里只借鉴邻近整页表单已确认的纵向分区、步骤信息和底部操作区，三步内容由本地蓝本裁定 | 当前只在本机按文件名匹配名称/别名与类别，所有结果可人工调整；不读取正文、不伪装 OCR、不上传云端，未确认候选不写分供方，文件只挂 ProjectSupplier | C-TOOL |
| `app/pages/project/form/[[id]].vue` | `/project/form/:id?` | 项目 | 整页表单 | #190 | R-FORM-PRIOR | 项目目标页没有安全直接证据；仅借鉴 `R-FORM-LIVE` 的相邻短表单结构，并以项目蓝本、ADR 0014 和真实客户外键裁定字段与行为 | 保留草稿、保存、保存并新建、保存并提交；新建取消返回列表、保存进入新项目详情，编辑取消/保存返回原项目详情 | C-FORM |
| `app/pages/project/index.vue` | `/project` | 项目 | 列表 | #190 | R-PROJECT-LIST-LIVE | 参考已确认左流程阶段、单行工具栏、紧凑表格和右下分页；本地新建能力继续按项目规格保留 | 未触发导入、筛选、设置或行级操作 | C-DENSE |
| `app/pages/project/penalty/[id].vue` | `/project/penalty/:id` | 分包单据 | 整页表单 | #197 | R-SUB-DOC-DC | 项目罚扣使用独立标题、项目/分供方/合同/班组来源、罚扣与整改分区及真实状态动作 | 抵扣必须引用真实已确认分包结算；附件归当前罚扣，错误定位首个无效字段 | C-FORM |
| `app/pages/project/penalty/index.vue` | `/project/penalty` | 分包单据 | 列表 | #197 | R-SUB-DOCUMENTS-LIVE | 参考专属列覆盖审批、罚扣类型、转扣合同/乙方、罚扣与签认金额、附件及甲方结算转扣记录；分包合同详情再按四组审批状态保留相同表头 | 不展示参考内部“是否删除”列；签认和转扣只读真实抵扣关系，编号先进入只读详情，来源 query 和列表状态往返可恢复 | C-DENSE |
| `app/pages/project/penalty/new.vue` | `/project/penalty/new` | 分包单据 | 整页表单 | #197 | R-SUB-DOC-DC | 新建页使用项目罚扣专属字段和附件区，项目、合同、分供方或班组只选择真实关联记录 | 草稿不伪造抵扣结果；状态推进和结算抵扣保持本地事务契约 | C-FORM |
| `app/pages/project/target-cost/[id].vue` | `/project/target-cost/:id` | 项目进度成本 | 详情 | #191 | R-TARGET-COST-LIVE | 参考详情已确认独立页签、白底平铺资料、明确关闭返回和预算/已签/实际/申请四轨摘要；本地继续保留版本摘要、科目清单与正式成本对比，不复制参考审批栏或示例值 | 科目明细只写当前版本；成本对比只读正式源单并穿透现有路由，不从名称或录入汇总值反推 | C-DENSE |
| `app/pages/project/target-cost/form/[[id]].vue` | `/project/target-cost/form/:id?` | 项目进度成本 | 整页表单 | #191 | R-TARGET-COST-LOCAL | DC 有目标成本版本头整页表单源码；现有参考运行证据只支持邻近短表单的两列字段网格、纵向滚动和固定底部动作，不把材料合同或分供方字段外推到目标成本 | 版本头与科目明细分开保存；草稿、提交、项目 lookup 和基线切换继续按本地事务契约 | C-FORM |
| `app/pages/project/target-cost/index.vue` | `/project/target-cost` | 项目进度成本 | 列表 | #191 | R-TARGET-COST-LIVE | 参考已确认单行工具栏、紧凑宽表、右下分页、名称详情入口和已签合同额到清单明细的嵌套下钻；本地保留项目/基线/状态筛选与真实版本状态，不复制导入导出或参考审批写入 | 金额只展示 `target_costs` 版本头事实；项目、状态和基线筛选不改写数据，名称进入专用详情；金额下钻由后续跨域链接票按本地真实关系统一裁定 | C-DENSE |
| `app/pages/schedule/[pid]/index.vue` | `/schedule/:pid` | 项目进度成本 | 工作台 | #191 | R-SCHEDULE-LOCAL | 红圈没有可对应的施工排程目标页；采用 DC 施工进度源码与本地进度计划 PDF，呈现同一 WBS Tree + 甘特核心、计划/实际对照和局部横滚；#244 已完成设计源覆盖 | 排程写入、工程量下钻、拖拽冲突保护与项目上下文保持本地契约 | C-DENSE |
| `app/pages/schedule/[pid]/bind/[gid].vue` | `/schedule/:pid/bind/:gid` | 项目进度成本 | 整页表单 | #191 | R-SCHEDULE-LOCAL | 红圈无目标页；采用 #244 已补齐的 `ScheduleBindScreen.jsx` 与 ADR 0017，展示合同检索、楼栋覆盖、分项映射和冻结数量差异 | 进入页面不写入；只有无阻断且再次确认“确认绑定”才切换范围依据；预览与绑定均读取建组时冻结的暂估量 | C-FORM |
| `app/pages/schedule/index.vue` | `/schedule` | 项目进度成本 | 工作台 | #191 | R-SCHEDULE-LOCAL | 红圈没有可对应的施工排程目标页；采用 DC 施工进度源码与本地进度计划 PDF，呈现同一 WBS Tree + 甘特核心、计划/实际对照和局部横滚；#244 已完成设计源覆盖 | 默认/空计划/部分完成/延期冲突/加载错误均按本地状态解释 | C-DENSE |
| `app/pages/schedule/new.vue` | `/schedule/new` | 项目进度成本 | 整页表单 | #191 | R-SCHEDULE-LOCAL | DC 有新建排程源码但形态早于当前三步向导；业务字段只取其本地蓝本，生产结构按“范围 → 工序 → 确认”与 ADR 0017 / 0018 裁定，不声称红圈有目标页 | 无项目区域时直达区域配置；内部暂估只读手工暂估量；第三步集中汇总范围、依据、周期、依赖与阻断项，失败保留草稿并可重试 | C-FORM |
| `app/pages/schedule/process-library/form.vue` | `/schedule/process-library/form` | 项目进度成本 | 整页表单 | #191 | R-SCHEDULE-LOCAL | 红圈无直接目标页；采用 #244 已补齐的 `forms/ScheduleForms.jsx`、ADR 0014 与本地甘特/精确表格双视图 | 进入页面只读来源版本；只有“保存为新版本”才新增库与工序定义，绝不回写来源版本 | C-FORM |
| `app/pages/schedule/process-library/index.vue` | `/schedule/process-library` | 项目进度成本 | 列表 | #191 | R-SCHEDULE-LOCAL | 红圈无直接目标页；采用 #244 已补齐的 `ScheduleProcessLibraryScreen.jsx`、本地紧凑列表模板与局部横向滚动 | 只读展示版本、工序数及引用数；编辑动作统一转入新版本整页表单 | C-DENSE |
| `app/pages/settings/ocr.vue` | `/settings/ocr` | 系统设置 | 工作台 | #204 | R-OCR-STUDIO-SOURCE | 采用参考项目的单页纵向区块、紧凑密度和底部恢复/保存反馈；字段与能力只按 ADR 0006 的 PaddleOCR-VL 单模型契约实现，不照搬传统 PP-OCRv6 参数 | 当前路由已可达；7 项 VL 文档能力和有界请求/轮询超时保存到本机 SQLite，并真实进入发票、送货单识别请求。Token、API 地址和模型仍由服务端私有配置持有，不提供假保存 | C-TOOL |
| `app/pages/subcontract/[kind]/[id].vue` | `/subcontract/:kind/:id` | 分包单据 | 整页表单 | #197 | R-SUB-DOC-DC | 动态类型映射到分包变洽签或分包结算的真实标题、字段分区和状态动作；两类均不补造无持久化实体支撑的明细网格 | 编辑返回原类型列表；分供方、合同、附件和结算只走真实外键，错误定位首个无效字段 | C-FORM |
| `app/pages/subcontract/[kind]/index.vue` | `/subcontract/:kind` | 分包单据 | 列表 | #197 | R-SUB-DOCUMENTS-LIVE | 参考分包变洽签与分包结算分别保留合同金额/申报审定链和奖罚/申请支付余额链；当前本地真实项目/合同/分供方来源正确但列表投影较窄 | 金额与余额只做真实聚合，不保存副本；空列表仍保留专属列，编号/名称先进入只读详情并恢复项目/合同/分供方及本地筛选 | C-DENSE |
| `app/pages/subcontract/[kind]/new.vue` | `/subcontract/:kind/new` | 分包单据 | 整页表单 | #197 | R-SUB-DOC-DC | 新建页按动态类型显示真实标题、来源、金额、备注和附件分区，不使用通用占位标题或虚构明细 | 项目、合同和分供方只选择真实关联记录；草稿、上报和确认沿用本地状态校验 | C-FORM |
| `app/pages/subcontract/attendance.vue` | `/subcontract/attendance` | 工程量与工资 | 工作台 | #198 | R-WORKBENCH-PRIOR | #198 已完成真实名册/人日/工时/锁定汇总、31 日矩阵、固定首列、保存进行态、错误保留和 390px 编辑区退化 | 只写 `attendance_records`；C2 人员与 C1 已发月份锁定，未实现能力不补演示数字 | C-DENSE |
| `app/pages/subcontract/daywork.vue` | `/subcontract/daywork` | 工程量与工资 | 工作台 | #198 | R-WORKBENCH-PRIOR | C2 逐日签工独立整页，列表与表单保持紧凑纵向工作流 | 签工与考勤同月互斥，已发月份冻结；只有已确认记录进入工资 | C-DENSE |
| `app/pages/subcontract/payroll/[id].vue` | `/subcontract/payroll/:id` | 工程量与工资 | 详情 | #198 | R-DETAIL-PRIOR | 统一详情壳承载成员分配、核算行、C2 签工、来源版本和发放快照 | 只展示真实工资单外键与 released 冻结快照；草稿/已核对金额不计为正式已发 | C-DENSE |
| `app/pages/subcontract/payroll/index.vue` | `/subcontract/payroll` | 工程量与工资 | 工作台 | #198 | R-WORKBENCH-PRIOR | #198 收敛为项目/月/班组/状态筛选、真实汇总、请款簿台账与详情；大型建单表单迁出 | query 与新建页往返保留；A/C1/C2 可用，B 因显式数据关系未定继续禁用 | C-DENSE |
| `app/pages/subcontract/payroll/new.vue` | `/subcontract/payroll/new` | 工程量与工资 | 整页表单 | #198 | R-FORM-PRIOR | 参考工资字段按 ADR 0014 迁入独立整页建单，分建单范围、工资口径、请款组员和经办说明 | 取消/成功返回原台账筛选；页面与 store/服务均阻止 B 类伪建单 | C-FORM |
| `app/pages/subcontract/quantity/[pid]/[uid].vue` | `/subcontract/quantity/:pid/:uid` | 工程量与工资 | 详情 | #198 | R-DETAIL-PRIOR | 矩阵单元直接进入户施工详情，不在矩阵下方插入二次时间线；返回恢复项目、楼栋、月份、视角、工种和责任人 | pid/uid 真实归属校验；责任、阶段完成和三量只读派生不落第二表 | C-DENSE |
| `app/pages/subcontract/quantity/index.vue` | `/subcontract/quantity` | 工程量与工资 | 工作台 | #198 | R-WORKBENCH-PRIOR | #198 完成双视角矩阵、冻结首列/表头、筛选汇总、责任/完成入口、直接下钻和真实量差总表 | 矩阵与量差宽表各自在自身区域横滚；量差读三量、合同价轨和已审批变更，无楼栋归属的变更单列待分摊且只计一次，不保存副本 | C-DENSE |
| `app/pages/subcontract/quantity/region.vue` | `/subcontract/quantity/region` | 工程量与工资 | 整页表单 | #198 | R-FORM-PRIOR | 统一整页表单壳承载楼栋→楼层→户配置，并与户型模板、排程来源往返 | 只新增真实区域并记录日志；合同可选，归档矩阵禁止写入 | C-FORM |
| `app/pages/subcontract/quantity/template.vue` | `/subcontract/quantity/template` | 工程量与工资 | 整页表单 | #198 | R-FORM-PRIOR | 从大型 Dialog 迁为独立路由，分基本信息、房间与三量明细；录入口径显式区分合同/暂估/现场 | 三量分别保存；现场量保存算式与结果，未保存离开需确认 | C-FORM |

## 6. 维护规则

1. `app/pages/` 新增、删除或改名生产页面时，同一提交更新本矩阵；`app/pages/dev/` 不计入生产清单。
2. 业务实施票完成安全观察后，记录实际参考路径、视口、只读状态和差异结论；不能用“看起来一样”替代证据。
3. 同一类参考证据可以复用档案代码，但目标页没有直接证据时必须继续标为邻近或待补采。
4. 若发现会改变业务规则、权限、状态机、字段含义或写入副作用的差异，停止实现并按固定模板建立独立 `needs-info` Issue。
5. 实施票关闭前同时更新本矩阵、受影响的页面蓝本/ADR、`ui-implementation-status.md` 和 Issue 验收证据。
