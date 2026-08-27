# 运行态参考差异矩阵

> 当前实施票：[#276](https://github.com/zodea/crm-new/issues/276)
>
> 父规格：[#292](https://github.com/zodea/crm-new/issues/292)
>
> 历史来源：[#181](https://github.com/zodea/crm-new/issues/181)、[#182](https://github.com/zodea/crm-new/issues/182)
>
> 核对日期：2026-08-25

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
| `R-PUBLIC-SURFACES-LIVE` | 当前直接证据 | 已登录参考站全局外壳；付款申请列表/详情、付款管理、支付记录、材料采购合同详情、分供方详情、项目详情、开票申请列表/详情 | Chrome 桌面视口，2026-08-13 | 浏览器只有 1 个页面，参考工作台恢复 25 个应用内业务页签并回到“支付记录”；进入付款详情后增至 26。付款详情完成异步能力判定约 3.5 秒后出现“业务洞察”，右侧 Sheet 分为统一检查、当前合同付款与结算/发票、跨项目/跨供应商报表三层；有合同和无合同两张付款单均挂载，当前层指标随记录更新。公共详情壳会以业务元数据、记录 ID 和 `detail/upsert` 位置请求分析，响应 `show` 决定是否挂载浮动入口；审批位置另带流程定义与活动节点。材料采购合同、分供方和项目详情使用相同公共详情壳但当前响应均未挂载入口，证明入口由后台能力/规则控制，不由页签数量、项目名称或“是否详情页”单独决定。页签内刷新收起 Sheet 但保留详情与入口；浏览器刷新丢弃刚打开的详情和 Sheet，恢复 25 个持久化工作台。刷新日志只证明外壳初始化持续通讯能力，未把某条 toast 绑定到私有传输帧。仅切换页签、执行列表搜索、进入蓝色只读详情、打开/关闭洞察和刷新页面；未点击通知、文件、评论、下载、打印、新建、导入、审批或任何写入口，未保存真实业务值。完整挂载、接口抽象、缓存、消息已读与页签恢复契约见 `docs/rewrite/PUBLIC-SURFACES.md`。 |
| `R-HOME-LIVE` | 当前直接证据 | 已登录参考站“默认首页” | 桌面窗口，内容区约 1348×1071，2026-07-27 | 仅通过 Windows 无障碍树读取并在观察后恢复用户原活动页签：上方为待办、周历日程、公告，当前分别显示暂无待办、暂无日程、暂无公告；下方有项目信息、目标成本、付款申请、费用报销四个快捷入口。未见项目切换、施工进度甘特、经营指标卡或统计图表。未点击快捷入口、加号或任何业务动作，未保存参考截图和业务值。 |
| `R-SUBCONTRACT-LIST-LIVE` | 当前直接证据 | `默认首页 > 分包及人工 > 分包合同`；活动业务页签为“分包合同” | 桌面窗口，`RootWebArea` 约 1568×1153，2026-07-27 | 用户先打开目标页，本轮仅通过浏览器辅助功能树读取：确认左侧合同分类、搜索/筛选、紧凑工具栏、超宽合同表格及表格内横向延展；“导入/新建”只确认控件存在，未触发；未把任何行级业务值写入仓库或公开 Issue |
| `R-CONSTRUCTION-CONTRACT-LIVE` | 当前直接证据 | `默认首页 > 主合同管理 > 施工合同 > 合同名称 > 详情-施工合同` | Chrome 内容视口约 1280×1024，2026-08-13 | 列表使用左侧合同状态、单行分类/搜索工具栏、施工专属紧凑宽表和底部汇总/分页；合同名称进入整页详情。详情为紧凑摘要、审批轨迹、白底资料区和详细资料/补充合同/甲方变洽签/验收结算/票税管理/收款登记/竣工验收及保修页签；审批历史为可关闭浮层，完整流程为独立只读流程层。票税管理同时保留开票申请与开票登记，空页签仍展示完整表头。仅点击合同名、页签、审批历史和完整流程；未点击打印、批量下载、编辑、导出、评论、文件或任何写入口。 |
| `R-SUBCONTRACT-CONTRACT-LIVE` | 当前直接证据 | `默认首页 > 分包及人工 > 分包合同 > 合同名称 > 详情-支出合同` | Chrome 内容视口约 1280×1024，2026-08-13 | 列表保留劳务/专业分类及合同金额、变更后金额、累计结算/收票/支付、按结算/按收票应付、完工审定、结算/结清状态等专属列；合同名称进入支出合同详情。详情采用紧凑摘要、审批轨迹和详细资料/分包变洽签/收票登记/付款信息/支出结算/项目罚扣/材料领用情况页签；付款信息再分付款申请与支付明细，支出结算再分过程与完工结算，材料领用再分新仓与历史记录。当前样本多个页签无数据，但完整表头与空态仍保留。仅点击合同名和只读页签；未点击转需用计划、打印、下载、编辑或任何业务动作。 |
| `R-CONTRACT-DETAIL-LIVE` | 当前直接证据汇总 | 施工合同、分包合同、材料采购合同名称分别进入对应只读详情 | Chrome 内容视口约 1280×1024，2026-08-13 | 汇总 `R-CONSTRUCTION-CONTRACT-LIVE`、`R-SUBCONTRACT-CONTRACT-LIVE` 与 `R-DETAIL-LIVE`：三类详情共用紧凑摘要、白底资料和真实关系入口，但施工、分包、材采各有独立业务页签，不能继续以通用四页签冒充已完成复刻；空页签保留完整表头，写入口一律未触发。 |
| `R-TABLE-LIVE` | 当前直接证据 | 已登录参考站采购合同编辑表、采购合同列表与分供方列表 | 桌面窗口，2026-07-28 | 严格只读观察并测量：编辑表表头约 36px；列表表头约 34px、数据行约 36px；宽表只在表格内部横滚，重要列与末尾操作列固定；可调列手柄仅位于表头右边缘，命中区约 7px、`right:-4px`、`cursor:col-resize`。仅切换既有页签、打开并关闭筛选/看板设置等只读浮层；未执行新增、编辑、删除、保存、提交、审批、上传、下载、导入或导出，也未记录业务值。 |
| `R-MATERIAL-CONTRACT-LIVE` | 当前直接证据 | `默认首页 > 乙供材管理 > 材料采购合同` | Chrome 内容视口约 1280×1024，2026-08-13 | 列表为“左侧单层合同分类 + 顶部单行搜索/图标工具栏 + 单一紧凑宽表 + 底部汇总和分页”；合同名为蓝色详情入口，末列为固定省略号操作。以“车陂商业大楼项目”的可见记录补验：合同名称进入“详情-支出合同”，详情中的乙方蓝链继续进入“详情-分供方”。未打开省略号菜单，未执行导入、下载或任何行级写动作。 |
| `R-FORM-LIVE` | 当前直接证据 | 空白“新建支出合同·材料采购合同”与“新建分供方·大宗供应商”页 | Chrome 内容视口约 1280×1024，2026-07-29 | 经用户明确授权，只打开空白新建页后取消：复杂合同表单使用约 140px 左分区导航、两列字段网格、纵向分区、局部明细表和固定底部操作条；较短的分供方表单不保留空左栏，直接使用两列字段网格、内容区纵向滚动和同一固定底部操作条。分供方先以小型类型选择对话框确定表单种类，再进入整页表单；类型选择弹窗不承载实体字段。未录入、粘贴、上传、保存或提交。 |
| `R-DETAIL-LIVE` | 当前直接证据 | 材料采购合同名称单击进入“详情-支出合同”页签 | Chrome 内容视口约 1280×1024，2026-08-13 | 详情采用“顶部摘要与动作 + 左侧审批轨迹/业务内容 + 右侧审批记录栏 + 页内标签”的整页结构；页签包括详细资料、采购合同明细、物资管理、收票登记、付款信息、支出结算和项目罚扣。乙方名称是蓝色关系入口，可继续打开分供方详情；变更历史、增补合同和基础信息均在详情内容区内分段，不再套大弹窗。只读进入并沿关系返回，未触发复制、变更、打印、转计划或任何写操作。 |
| `R-PROJECT-LIST-LIVE` | 当前直接证据 | `默认首页 > 项目信息` | Chrome 内容视口约 1280×1024，2026-08-13 | 项目列表为“左侧业务流程阶段 + 顶部单行搜索/筛选/设置工具栏 + 紧凑表格 + 右下分页”；项目名称、累计收入合同金额、预算总额、项目经理/执行经理、客户和多个项目角色均使用链接态。累计收入合同金额进入按项目过滤的施工合同清单，预算总额进入目标成本清单明细，人员进入项目组成员列表；当前账号点击客户入口被明确权限提示拦截，因此只保留入口语义，不外推客户详情。未点击导入、筛选、设置或行级操作。本地 #289 / #312 / #313 仅据项目名称入口实现稳定 ID 详情与受限来源恢复，不据其他蓝色样式补造目标。 |
| `R-PROJECT-DETAIL-LIVE` | 当前直接证据 | `默认首页 > 项目信息 > 车陂商业大楼项目` | Chrome 内容视口约 1280×1024，2026-08-13 | 用户确认“车陂商业大楼项目”是当前权限下流程最完整的主样本；项目详情为“紧凑标题与五项元数据 + 项目经营数据/往来款/票据信息 + 六个小型阶段节点与计数 + 左侧审批流程/阶段任务 + 右侧项目团队与文件”的宽屏双栏结构。详细资料采用白底标签—值排版，不把只读资料做成带底色表单格；区块使用轻边界而非层层大卡片。其他项目只在该样本缺页且当前账号可见时用于补充相邻布局证据，不据其残缺数据反推业务规则。未触发编辑、上传、下载、审批或任何写入；未保存业务人员、金额等参考值。本地 #289 / #312 / #313 已将项目详情登记为来源感知只读目标，并在各读状态保留白名单返回入口；#319 再扩展材采与分供方事实旅程。 |
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
| `R-FINANCE-FLOW-LIVE` | 当前直接证据 | `默认首页 > 资金管理`下 13 个工作台；`项目信息 > 车陂商业大楼项目 > 票税管理 / 资金管理 / 往来款 / 支付明细` | Chrome 桌面视口，2026-08-13 | 13 个工作台均使用单行搜索/图标工具栏、专属紧凑宽表、表内横向滚动和底部汇总/分页，不能继续压成同一套“名称/编号/项目/关联方/金额/日期/状态”通用列。开票申请有 9 条主样本数据，左侧按未开/部分/全部/终止开票分类，名称进入只读详情；详情平铺项目、收票/开票单位、合同、票种、含税/无税/税额、内容、购方快照、开票记录、系统信息和附件。收款登记有 9 条，编号进入只读详情并展示合同原额/变更额、累计收款、支付/质保/变现字段和凭证。往来收款 14 条且编号进入只读详情；往来付款 5 条，列表明确审批/生效/支付与实付余额，但本轮未从编号形成可靠详情。收票、付款申请、报销、保证金申请/退还、备用金申请/退还、付款管理和支付记录当前均为明确的 `共0条/暂无数据`，仍保留完整分类与专属表头；这属于“当前无记录”，不是权限不可见或参考后台未接。付款管理默认按待支付/已支付/无需支付/全部分段，并保留来源单据与业务类型；支付记录保留账户/开户行/账号和审计字段。项目详情同步聚合开票申请/开票登记/收票登记、收款/付款申请/集中付款/费用报销、往来收付与支付明细；最后一组当前为空。只点击菜单、项目页签和明确蓝色只读名称/编号；未点击导入、新建、打印、下载、文件、评论、支付、审批、操作列或任何写入口。参考站无一一对应的 OCR 校对/排版工作台，瑞航发票识别、打印和因子工具仍由本地 DC、ADR 与 #251 裁定；收票登记只作为台账字段和项目/合同/分供方关系的相邻证据。 |
| `R-AUX-CONTRACT-DC` | 本地 DC 直接目标源码，非外部业务运行态 | `DC重构设计源码/kit/CompanyExpScreen.jsx`、`OtherExpScreen.jsx`、`forms/ContractForms.jsx` | 固定源码桌面构图；生产实现仍复核 390、768、1024、1280–1440px | 直接源码规定公司支出合同与项目其他支出合同的列表列、搜索/分类/状态筛选、金额汇总、分页及整页表单分区。公司支出不含项目，其他支出保存真实项目和分供方；外部 `R-TABLE-LIVE`、`R-FORM-LIVE` 只佐证紧凑表格、局部横滚、两列字段与固定底栏等几何，不外推目标页字段或写入行为。 |
| `R-AUX-SETTLEMENT-DC` | 本地 DC 直接目标源码，非外部业务运行态 | `DC重构设计源码/kit/OtherSettleScreen.jsx`、`MatSettleScreen.jsx`、`forms/ContractForms.jsx`、`forms/MaterialForms.jsx` | 固定源码桌面构图；生产实现仍复核 390、768、1024、1280–1440px | 直接源码规定其他支出结算与材料采购结算的项目、真实源合同、分供方、金额、日期、状态、筛选、汇总、分页和整页表单分区。两类结算均没有持久化业务明细实体，不能套用材料采购合同的 `KitEditGrid`；外部运行态只作为表格和表单几何佐证。 |
| `R-OWNER-DOC-DC` | 本地 DC 直接目标源码，非外部业务运行态 | `DC重构设计源码/kit/OwnerChangeScreen.jsx`、`OwnerReportScreen.jsx`、`AcceptanceScreen.jsx`、`FinalSettleScreen.jsx`、`OwnerPenaltyScreen.jsx`、`forms/OwnerDocForms.jsx` | 固定源码桌面构图；生产实现仍复核 390、768、1024、1280–1440px | 直接源码分别规定五类甲方单据的真实标题、列表列、搜索/项目/类型/状态筛选、金额汇总、分页和整页表单分区，不能退化为同一套通用占位界面。外部 `R-TABLE-LIVE`、`R-FORM-LIVE` 只佐证紧凑表格、局部横滚、两列字段与固定底栏等几何；状态名称、来源关系、附件归属及写入动作仍由本地数据库和页面规格裁定。 |
| `R-SUB-DOC-DC` | 本地 DC 直接目标源码，非外部业务运行态 | `DC重构设计源码/kit/SubChangeScreen.jsx`、`SubSettleScreen.jsx`、`ProjPenaltyScreen.jsx`、`forms/OwnerDocForms.jsx` | 固定源码桌面构图；生产实现仍复核 390、768、1024、1280–1440px | 直接源码分别规定分包变洽签、分包结算和项目罚扣的真实标题、列表列、搜索/项目/类型/状态筛选、金额汇总、分页和整页表单分区。外部运行态仅提供共性几何证据；分供方、合同、班组、结算抵扣、附件与状态动作必须沿用本地真实外键和事务契约，不从示例数据反推。 |
| `R-SCHEDULE-LOCAL` | DC 独有能力的固定本地蓝本，非红圈目标页运行态 | `docs/合和新城7期施工进度计划表 （户内）2026.04.22.pdf`、`DC重构设计源码/kit/SchedulePlanScreen.jsx`、`ScheduleGroupNewScreen.jsx`、`ScheduleBindScreen.jsx`、`ScheduleProcessLibraryScreen.jsx`、`forms/ScheduleForms.jsx`、ADR 0017 / 0018 | 固定源码桌面构图与本地生产四档验证 | 本地脱敏红圈资料未登记施工排程对象；`红圈系统/业务流转.md` 仅能提供成本、合同和结算来源关系。因此 WBS、甘特、内部暂估、标准工序库和合同后绑定均按瑞航本地蓝本裁定，不宣称复制红圈目标页。[#244](https://github.com/zodea/crm-new/issues/244) 已关闭并合入工序库、合同绑定和整页表单的设计源码落点；它只作为本地蓝本来源，不代表 #292 当前实施状态。 |
| `R-ENGINEERING-FLOW-LOCAL` | 当前本地生产运行态直接证据；参考站无同构页面 | `/schedule`、`/schedule/:pid`、`/subcontract/quantity`、`/subcontract/quantity/:pid/:uid`、`/subcontract/quantity/region`、`/subcontract/quantity/template`、`/subcontract/payroll`、`/subcontract/payroll/new`、`/subcontract/payroll/:id`、`/subcontract/attendance`、`/subcontract/daywork`、班组/工人详情反向入口 | 390 / 768 / 1024 / 1440px，2026-08-13 | [#287](https://github.com/zodea/crm-new/issues/287) 仅执行本地只读导航、任务详情展开和多视口测量，未触发登记、保存、删除、导入、导出、打印或发放。合和新城种子可见 8 户、13 条当前责任和 12 条阶段完成/草稿事实；工资、考勤、签工没有运行种子，保持真实空台账。排程工序可携项目/分组/楼栋/任务/阶段/分项/计划区间进入工程量矩阵，返回后恢复同一任务详情；工程量户详情保留项目、楼栋、月份、视角、工种、责任人六项筛选，错误 pid/uid 显式失败。工资列表→建单→列表和工资列表↔考勤能恢复项目/月/班组/状态；独立工资详情返回、零星签工入参及其返回仍会丢失上下文。户详情明细保留 `null` 为“—”，但阶段小计和全户合计仍以 `?? 0` 汇总，存在把缺现场量误表为 0 的断点。施工合同/分包合同没有到工资责任的显式外键，B 类继续禁用；班组、工人和扣罚只按现有项目/责任/工资/罚扣事实反向聚合。四档下页面根均无横向溢出，工程量矩阵、考勤月表和 WBS 甘特只在各自容器滚动。 |

上一次实施无法读取浏览器正文，因此当时生成的项目详情“当前直接证据”和线框不成立，已在后续严格只读观察中撤销并重建。`R-PROJECT-DETAIL-LIVE` 以用户指定的完整权限项目为主样本；`R-PROJECT-LIST-LIVE` 与 `R-TARGET-COST-LIVE` 补齐项目金额、人员与目标成本名称/金额的隐藏只读下钻；`R-CONSTRUCTION-CONTRACT-LIVE`、`R-SUBCONTRACT-CONTRACT-LIVE`、`R-DETAIL-LIVE` 与 `R-MATERIAL-CONTRACT-LIVE` 共同确认三类合同不能继续共用一组视觉页签，`R-SUPPLIER-DETAIL-LIVE` 则补齐材料合同乙方与往期合作聚合下钻。`R-OWNER-DOCUMENTS-LIVE`、`R-SUB-DOCUMENTS-LIVE`、`R-AUX-DOCUMENTS-LIVE`、`R-MATERIAL-SETTLEMENT-LIVE`、`R-MATERIAL-FLOW-LIVE` 和 `R-OWNER-MATERIAL-LIVE` 进一步确认单据空态也必须保留专属列表，蓝色名称先进入只读详情，项目/合同/客户或分供方关系与返回上下文是同一条导航契约；材料链还必须保留源单、仓库、送货单、班组合同、调拨两端及结算/付款状态。甲供材五类不能继续共用“材料/对象”列表，项目物资页也不能用一张送货归档表冒充总计划、需用计划和入库单；供货单位身份、总计划头/行和归档—入库关系仍等待本地 canonical 裁定。`R-CUSTOMER-LIST-LIVE` 只证明客户列表构图和受权限保护的入口。`R-ENGINEERING-FLOW-LOCAL` 则明确工程量、工资、考勤、签工和排程没有可直接套用的参考页，运行态差异必须按本地真实 ID、空值与冻结语义修复，不能从邻近统计页推断。参考站没有可安全确认的一一对应送货 OCR、归档库或价格分析页面，这三类瑞航独有工具继续由本地 DC、页面规格和真实 SQLite 数据裁定。上述证据仍不能把某一对象字段外推到另一对象，也不能把权限拒绝解释为不存在目标页；参考站的导入、编辑、打印、下载、评论和文件动作均未触发。当前直接证据只支持已实际打开的布局、只读状态和关系入口，不能外推未走查页面、写入行为或参考站私有数据契约。

2026-08-21 的本地视觉回归证据使用显式启用的 #279 测试数据工作区和固定业务时间，不采集外部参考站截图或真实业务数据。`e2e/runtime-visual-matrix.spec.ts` 在 390 / 768 / 1024 / 1440px 覆盖十四类共 56 张基线，并保留 3 条键盘、焦点、滚动与浮层行为测试；项目详情通过 `/project/proj_demo_001?origin=demo` 验证来源感知的中央只读详情，分供方压力态验证演示快照只读加载且不触发凭证状态写入。该本地回归只证明已登记的瑞航布局、状态和安全交互可重复，不提升任何外部参考证据等级。

2026-08-24 的 #319 本地旅程证据使用可重置的中央证明实例，不采集外部参考站或真实业务数据。`e2e/issue-319-project-material-supplier-journey.spec.ts` 证明项目列表条件与项目焦点可经项目详情、按稳定项目 ID/来源筛选的材采列表、材采详情和分供方四类事实逐级恢复；真实 `0` 可进入专属空列表，无权限不伪装为 `0`；390 / 768 / 1024 / 1440px 全旅程无页面级横滚。该证据验证本地实现符合 `R-PROJECT-DETAIL-LIVE`、`R-MATERIAL-CONTRACT-LIVE`、`R-DETAIL-LIVE` 与 `R-SUPPLIER-DETAIL-LIVE` 的已确认关系入口和真实空态，不提升外部证据等级，也不覆盖交付、库存或结算核心。

2026-08-26 的 #289 父级本地集成证据联合运行 `e2e/issue-312-project-target-registry.spec.ts` 与 `e2e/issue-313-project-return-context.spec.ts`，13 个场景全部通过：项目名称链接同时保留稳定项目 ID、`dataOrigin`、受限 `returnTo` 与短期来源上下文；详情刷新后仍能用键盘返回并精确恢复搜索、阶段、排序、列筛选、页码、每页条数、应用页签、滚动和焦点；伪造外部来源及直达深链降级到规范列表；390 / 768 / 1024 / 1440px 均无页面级横滚。该证据使用可重置的中央证明实例，不采集外部参考站或真实业务数据，也不提升 `R-PROJECT-LIST-LIVE` / `R-PROJECT-DETAIL-LIVE` 的外部证据等级。

2026-08-27 的 #281 父级本地集成证据联合运行 `e2e/issue-314-customer-central-chain.spec.ts`、`e2e/issue-315-supplier-central-facts.spec.ts`、`e2e/issue-316-crew-worker-central-chain.spec.ts` 与 `e2e/issue-317-project-supplier-facts.spec.ts`：客户、分供方、班组、工人、项目和 ProjectSupplier 只按稳定 ID、`dataOrigin` 与唯一 Target Registry 往返；客户→项目以及工作台→项目/分供方在目标刷新后仍显式恢复原客户页签或工作台页签，目标 ID、来源或额外 query 错配时不保留返回链；六类工作台事实继续区分真实 `0`、缺失、禁止、暂不可用、关系错配与未核验目标。四条浏览器链沿用 390 / 768 / 1024 / 1440px 验证，密集表格只在自身区域横向滚动。证据来自可重置中央证明实例，不采集外部参考站或真实业务数据，也不把客户受限参考详情或未核验来源升级为已确认目标。

## 4. 业务约束档案

| 代码 | 必须保留的约束 |
| --- | --- |
| `C-BASE` | 保留瑞航蓝、字段含义、数据关系、权限、状态机和写入语义；实现响应式、键盘焦点与浮层层级 |
| `C-FORM` | 包含 `C-BASE`；遵守 ADR 0014/0015 的整页表单和草稿边界，不从参考站推断保存或提交行为 |
| `C-DENSE` | 包含 `C-BASE`；密集表格、矩阵和工作台只能在自身区域横向滚动，页面不得产生横向滚动 |
| `C-TOOL` | 包含 `C-BASE`；导入、导出、OCR、文件和换算能力只走现有 ADR 与业务契约，不能复制未确认副作用 |

## 5. 生产路由矩阵

“待核对”是明确的证据状态，不代表页面已与参考站一致。业务实施票完成只读采集后，应在同一提交把证据档案升级为直接证据，并把对应差异改成已验证结论。矩阵中的票号是形成当前页面基础的历史票，不表示它仍是当前前沿；当前票由上方生成账本按页面域统一给出。

账本由 `node scripts/sync-runtime-evidence-ledger.mjs` 从页面文件、本矩阵、证据档案、[`READ-MODELS.md`](../rewrite/READ-MODELS.md) 和 [`design-coverage.json`](./design-coverage.json) 同步生成。每行是一个本地生产端点与具体参考视图的唯一映射，使用不受排序影响的 `evidenceRecordId` / `referenceEndpointId` 计数；被多个路由复用的聚合档案必须先拆成明确目标视图，未知目标只能登记为历史未记录或未验证。完整的证据等级、观测日期或缺失原因、权限状态和当前实施票见 [`runtime-evidence-ledger.json`](./runtime-evidence-ledger.json)。布局、状态和跳转叙述只保留在本矩阵，生成物用 `routeKey` 回指，不复制第二份状态快照。

<!-- runtime-evidence-summary:begin -->
| 可重算口径 | 数量 |
| --- | ---: |
| 跟踪页面文件 / dev / 生产路由 | 137 / 5 / 132 |
| 页面域 | 20 |
| 证据行 / 唯一参考端点 | 132 / 132 |
| 参考证据档案 / 被路由使用 | 37 / 32 |
| 直接 / 邻近 / 本地权威 | 52 / 18 / 19 |
| 历史证据 / 未验证目标 | 34 / 9 |
| 设计已覆盖 / 待补设计 | 130 / 2 |

| 页面域 | 路由数 | 当前实施票 |
| --- | ---: | --- |
| 首页 | 1 | [#278](https://github.com/zodea/crm-new/issues/278) |
| 项目 | 3 | [#288](https://github.com/zodea/crm-new/issues/288)、[#293](https://github.com/zodea/crm-new/issues/293)、[#294](https://github.com/zodea/crm-new/issues/294)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 基础主数据 | 9 | [#281](https://github.com/zodea/crm-new/issues/281)、[#316](https://github.com/zodea/crm-new/issues/316)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 分供方 | 4 | [#281](https://github.com/zodea/crm-new/issues/281)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 项目分供方 | 2 | [#281](https://github.com/zodea/crm-new/issues/281)、[#289](https://github.com/zodea/crm-new/issues/289)、[#317](https://github.com/zodea/crm-new/issues/317) |
| 核心合同 | 12 | [#277](https://github.com/zodea/crm-new/issues/277)、[#282](https://github.com/zodea/crm-new/issues/282)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 辅助合同与结算 | 12 | [#295](https://github.com/zodea/crm-new/issues/295)、[#298](https://github.com/zodea/crm-new/issues/298)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 甲方单据 | 4 | [#283](https://github.com/zodea/crm-new/issues/283)、[#323](https://github.com/zodea/crm-new/issues/323)、[#324](https://github.com/zodea/crm-new/issues/324)、[#325](https://github.com/zodea/crm-new/issues/325)、[#326](https://github.com/zodea/crm-new/issues/326)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 分包单据 | 6 | [#295](https://github.com/zodea/crm-new/issues/295)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 自购材 | 12 | [#296](https://github.com/zodea/crm-new/issues/296)、[#297](https://github.com/zodea/crm-new/issues/297)、[#298](https://github.com/zodea/crm-new/issues/298)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 甲供材 | 15 | [#299](https://github.com/zodea/crm-new/issues/299)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 送货单闭环 | 4 | [#296](https://github.com/zodea/crm-new/issues/296)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 材料价格 | 1 | [#296](https://github.com/zodea/crm-new/issues/296)、[#298](https://github.com/zodea/crm-new/issues/298)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 收入财务 | 10 | [#302](https://github.com/zodea/crm-new/issues/302)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 支出财务 | 11 | [#303](https://github.com/zodea/crm-new/issues/303)、[#305](https://github.com/zodea/crm-new/issues/305)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 发票台账 | 4 | [#304](https://github.com/zodea/crm-new/issues/304)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 工程量与工资 | 9 | [#300](https://github.com/zodea/crm-new/issues/300)、[#301](https://github.com/zodea/crm-new/issues/301)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 项目进度成本 | 9 | [#300](https://github.com/zodea/crm-new/issues/300)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 导入导出 | 3 | [#278](https://github.com/zodea/crm-new/issues/278)、[#294](https://github.com/zodea/crm-new/issues/294) |
| 系统设置 | 1 | [#204](https://github.com/zodea/crm-new/issues/204) |
<!-- runtime-evidence-summary:end -->

| Page | Route | 业务域 | 模板 | 历史基础票 | 参考证据 | 布局差异 | 状态与跳转结论 | 业务约束 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `app/pages/base/crew/[id].vue` | `/base/crew/:id` | 基础主数据 | 详情 | #316 | R-ENGINEERING-FLOW-LOCAL | #316 已以本地中央测试接缝复核统一详情壳、真实成员/项目工程量/工资/扣罚聚合、稳定 ID 下钻、安全返回与四档无整页横滚 | 浏览器只读中央 Repository；电话脱敏；正式/测试来源隔离；无事实分别空态；Tauri 保留本地路径 | C-DENSE |
| `app/pages/base/crew/form/[[id]].vue` | `/base/crew/form/:id?` | 基础主数据 | 整页表单 | #316 | R-FORM-PRIOR | #316 已完成浏览器中央表单预载、幂等命令、乐观锁、返回详情和中央班组校验 | 中央附件未接入时不回退本地；Tauri 仍写 `crews` 与班组附件；不恢复不存在的班组项目单价关系 | C-FORM |
| `app/pages/base/crew/index.vue` | `/base/crew` | 基础主数据 | 列表 | #316 | R-LIST-PRIOR | #316 已完成中央正式/测试隔离、真实人数/项目数、筛选、安全回程与四档局部横滚回归 | 浏览器无本地删除/快捷编辑；名称按稳定 ID 下钻；电话脱敏 | C-DENSE |
| `app/pages/base/customer/[id].vue` | `/base/customer/:id` | 基础主数据 | 详情 | #194 | R-DETAIL-PRIOR | #194 已完成客户主数据、名下项目、施工合同与收款台账的只读聚合、页签深链及四档回归 | 方向键切换页签；只按真实外键下钻，不从名称或合同金额推算收款 | C-DENSE |
| `app/pages/base/customer/form/[[id]].vue` | `/base/customer/form/:id?` | 基础主数据 | 整页表单 | #194 | R-FORM-PRIOR | #194 已完成整页表单返回详情、联系人输入语义及统一社会信用代码冲突反馈 | 保存仍走客户领域 action；敏感字段只在编辑流程维护 | C-FORM |
| `app/pages/base/customer/index.vue` | `/base/customer` | 基础主数据 | 列表 | #194 | R-CUSTOMER-LIST-LIVE | 参考已确认无空左树、单行工具栏、紧凑宽表和分页；当前账号无可见客户，字段仍按本地真实模型收敛为名称/简称/税号/联系人/状态，不复制参考私有列 | 名称进入本地真实详情；税号与电话脱敏；参考详情受权限限制，不能据此更改本地外键、删除或表单契约 | C-DENSE |
| `app/pages/base/supplier/[id].vue` | `/base/supplier/:id` | 分供方 | 详情 | #193 | R-SUPPLIER-DETAIL-LIVE | #193 已按统一详情壳完成长名称、脱敏摘要、6 页签、可追溯汇总、分类文件区与四档布局回归；#319 再按直接证据闭合材采合同到合同/结算/收票/付款事实页签及原合同返回 | 蓝色聚合值按真实外键进入对应事实；目标无记录显示真实空态，灰色值不伪装入口。材采来源只接受稳定分供方 ID、同来源与安全合同返回地址；参考审批、评论、供应商层级和写动作仍不推断 | C-BASE |
| `app/pages/base/supplier/credential/[id].vue` | `/base/supplier/credential/:id` | 分供方 | 详情 | #193 | R-SUPPLIER-DETAIL-LIVE | #315 将既有证照文件、OCR、有效期、资料要求和人工核验从中央事实页签拆为无路由冲突的独立整页入口；复用参考详情文件管理区的构图证据，不外推参考站写动作 | 只接既有证照专用文件/审计边界；未接入时明确不可用，不写入第二套正式分供方；返回同一中央详情和来源 | C-BASE |
| `app/pages/base/supplier/form/[[id]].vue` | `/base/supplier/form/:id?` | 分供方 | 整页表单 | #193 | R-FORM-LIVE | #193 已确认短表单无空左栏、两列字段网格、内容滚动、固定底部操作和统一七类选择；主数据保存后进入真实证照流程 | 普通附件不伪装证照；`approvalStatus` 不展示，证照原件、OCR 与人工核验统一在详情维护 | C-FORM |
| `app/pages/base/supplier/index.vue` | `/base/supplier` | 分供方 | 列表 | #193 | R-SUPPLIER-LIST-LIVE | #193 已完成无空左树、单行工具栏、真实项目/欠款/资料筛选、聚合列、固定操作列、局部横滚和列表汇总回归 | 行级关联写入真实 ProjectSupplier；税号与电话脱敏；上级供应商和参考站未授权业务动作不引入 | C-DENSE |
| `app/pages/base/worker/[id].vue` | `/base/worker/:id` | 基础主数据 | 详情 | #316 | R-ENGINEERING-FLOW-LOCAL | #316 已以本地中央测试接缝复核班组/项目/责任单元/工资单/扣罚与关联人员稳定 ID 链、隐私、未知工资分配和四档回归 | 身份/联系/银行信息脱敏；正式/测试来源隔离；工资分配缺失显示“历史未记录”，不反推金额 | C-DENSE |
| `app/pages/base/worker/form/[[id]].vue` | `/base/worker/form/:id?` | 基础主数据 | 整页表单 | #316 | R-FORM-PRIOR | #316 已完成浏览器中央表单预载、中央班组/项目选择、幂等命令、乐观锁和返回详情 | 班组与当前项目只保存同来源稳定 ID；中央附件未接入时不回退本地 | C-FORM |
| `app/pages/base/worker/index.vue` | `/base/worker` | 基础主数据 | 列表 | #316 | R-LIST-PRIOR | #316 已完成中央来源隔离、班组/项目/档案/在场/安全教育展示、筛选、安全回程与四档局部横滚回归 | 电话和身份证脱敏；浏览器无本地删除/快捷编辑；键盘链接按稳定 ID 进入详情 | C-DENSE |
| `app/pages/contract/[id].vue` | `/contract/:id` | 核心合同 | 详情 | #195 | R-CONTRACT-DETAIL-LIVE | #318 闭合材采中央七页签；#320/#321 闭合施工/分包专属七分区；#322 以真实浏览器证明两类补充协议 canonical 聚焦、键盘焦点、目标不存在/父子错配和列表来源恢复，并复核 390/768/1024/1440px 无页面级横滚 | 只有 `dataOrigin` 加对应 `contractKind` 进入各类中央读模型；补充协议还必须用稳定 `focusId` 命中当前主合同；正式来源显式编辑，演示只读；未核验事实目标保持文本 | C-BASE |
| `app/pages/contract/boq/import.vue` | `/contract/boq/import` | 核心合同 | 特殊工具 | #195 | R-TOOL-PENDING | #195 已按本地清单拆表蓝本完成三步导入、逐 sheet 映射、持久缺失字段错误与四档无整页横滚回归；无红圈安全直接证据，不宣称同屏复刻 | 未对参考站触发上传或导入；A–E 格式与人工确认口径以 `docs/rewrite/pages/boq-import.md` 为准 | C-TOOL |
| `app/pages/contract/boq/index.vue` | `/contract/boq` | 核心合同 | 工作台 | #195 | R-WORKBENCH-PRIOR | #195 已完成目录/密集表格/变更/月度报量三页签、完整合同编号、直接业务入口、金额完整显示、键盘与四档局部横滚回归；无红圈安全直接证据 | 原始金额不做 MoneyLink；清单手调/导出不推进甲方报量状态；布局权威见 `docs/rewrite/pages/boq-import.md` | C-DENSE |
| `app/pages/contract/company-expense/form/[id].vue` | `/contract/company-expense/form/:id` | 辅助合同与结算 | 整页表单 | #196 | R-AUX-CONTRACT-DC | 按 `companyExpForm` 直接源码呈现基本信息、金额、合同条款、附件与备注；外部运行态只佐证短表单两列字段、内容滚动和固定底栏 | 编辑只回填并保存独立 `company_expense_contracts`，不补项目、项目结算或分供方外键 | C-FORM |
| `app/pages/contract/company-expense/form/index.vue` | `/contract/company-expense/form` | 辅助合同与结算 | 整页表单 | #196 | R-AUX-CONTRACT-DC | 按 `companyExpForm` 直接源码呈现基本信息、金额、合同条款、附件与备注；外部运行态只佐证短表单两列字段、内容滚动和固定底栏 | 新建不挂项目且不用虚拟项目占位；保存、提交仍走本地状态机 | C-FORM |
| `app/pages/contract/company-expense/index.vue` | `/contract/company-expense` | 辅助合同与结算 | 列表 | #196 | R-AUX-DOCUMENTS-LIVE | 参考确认公司支出不含项目，专属列覆盖甲乙方、税额、合同附件、累计收票/付款/按票应付和经办审计；当前本地仅有编号、名称、类别、对方、金额、日期、合同期和状态 | 保持独立 `company_expense_contracts` 且不造虚拟项目；补读模型前先确认甲乙方与票款 canonical 来源，名称应先进入只读详情而非隐式写态，返回恢复筛选 | C-DENSE |
| `app/pages/contract/construction/form/[id].vue` | `/contract/construction/form/:id` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | #320 保留整页分区、真实 lookup 与固定底栏，接入中央表单预载、幂等命令、乐观锁和保存后同详情读回 | 只编辑正式来源；演示来源禁止进入写态；编辑返回保留同一详情及其嵌套列表上下文 | C-FORM |
| `app/pages/contract/construction/form/index.vue` | `/contract/construction/form` | 核心合同 | 整页表单 | #195 | R-FORM-PRIOR | #320 按既有整页蓝本接入中央正式项目/客户选项、服务端 ID 分配和保存读回 | 新建只走中央命令；不接采购明细，不实现本票外导入、删除或本地生产旁路 | C-FORM |
| `app/pages/contract/construction/index.vue` | `/contract/construction` | 核心合同 | 列表 | #195 | R-CONSTRUCTION-CONTRACT-LIVE | #320 闭合中央正式/显式授权演示分源列表、实际竣工日期、签约与收入侧金额列、URL 筛选、分页、返回焦点和紧凑宽表，并复核四档视口 | 实际竣工日期来自 canonical nullable 字段，未知显示“未记录”；金额只按真实合同外键派生；名称携稳定 ID、来源与施工类型进入中央详情 | C-DENSE |
| `app/pages/contract/material/form/[id].vue` | `/contract/material/form/:id` | 核心合同 | 整页表单 | #195 | R-FORM-LIVE | #318 保留左分区、两列字段、局部明细与固定底栏，并闭合中央表单预载、乐观锁冲突与保存后读回 | 只编辑正式来源；合同/明细 ID 由服务端分配，演示来源禁止进入写态 | C-FORM |
| `app/pages/contract/material/form/index.vue` | `/contract/material/form` | 核心合同 | 整页表单 | #195 | R-FORM-LIVE | #318 按既有整页蓝本接入中央正式项目/分供方选项、明细复算和保存读回，并复核四档无整页横滚 | 新建只走中央命令；当前不实现导入、删除或本地生产旁路 | C-FORM |
| `app/pages/contract/material/index.vue` | `/contract/material` | 核心合同 | 列表 | #195 | R-MATERIAL-CONTRACT-LIVE | #318 闭合中央正式/显式授权演示分源列表、URL 筛选与紧凑宽表；#319 增加项目稳定 ID/来源入口、项目返回和合同列表筛选/分页/滚动/焦点恢复，并复核四档视口 | 名称携稳定 ID、来源与材采类型进入中央详情；项目来源范围和嵌套返回地址均经白名单验证；演示只读，正式编辑只从详情显式进入 | C-DENSE |
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
| `app/pages/finance/billing/index.vue` | `/finance/billing` | 收入财务 | 列表 | #202 | R-FINANCE-FLOW-LIVE | 参考按开票状态树和开票分类展示项目/收票单位/合同、票种/款项、含税/无税/税额与审批，并在页尾汇总；当前通用列表只有基础金额投影 | 名称应先进入只读详情，项目/客户/合同按真实 ID 下钻；编辑保持独立动作，不能让主链接直接进入写态 | C-DENSE |
| `app/pages/finance/billing/new.vue` | `/finance/billing/new` | 收入财务 | 整页表单 | #202 | R-FORM-PRIOR | 待 #202 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/current/[id].vue` | `/finance/current/:id` | 收入财务 | 整页表单 | #202 | R-FORM-PRIOR | 待 #202 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/current/index.vue` | `/finance/current` | 收入财务 | 列表 | #202 | R-FINANCE-FLOW-LIVE | 参考将往来收款与往来付款拆成专属列表：收款含款项类型/付款单位/创建审计，付款含审批/业务类型/收款单位/生效/实付余额；当前本地以 `direction` 合表但只投影基础列 | 可继续共享 `current_transactions`，界面按方向切换专属列；编号先进入只读详情，项目和往来方按真实身份下钻，不把自由文本单位伪装成主数据 ID | C-DENSE |
| `app/pages/finance/current/new.vue` | `/finance/current/new` | 收入财务 | 整页表单 | #202 | R-FORM-PRIOR | 待 #202 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/invoice/[id].vue` | `/finance/invoice/:id` | 发票台账 | 整页表单 | #204 | R-FORM-PRIOR | 待 #204 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/invoice/factor.vue` | `/finance/invoice/factor` | 发票台账 | 特殊工具 | #204 | R-TOOL-PENDING | 无安全直接证据 | 换算规则保持现有契约 | C-TOOL |
| `app/pages/finance/invoice/index.vue` | `/finance/invoice` | 发票台账 | 工作台 | #204 | R-FINANCE-FLOW-LIVE | 参考“收票登记”只提供台账相邻证据，包含票种树、项目/开票单位/合同、金额税额、进项类型与未关联付款余额；没有可安全观察的一一对应 OCR 校对/排版工作台 | 继续以本地 DC、ADR 0001/0006 和 #251 裁定上传、识别、人工校对与打印；不得把参考空台账解释为 OCR 接口未实现 | C-DENSE |
| `app/pages/finance/ledger.vue` | `/finance/ledger` | 发票台账 | 工作台 | #204 | R-FINANCE-FLOW-LIVE | 参考收票全局列表与项目“收票登记”均证明归档台账需保留项目/合同/开票单位、金额税额、进项类型与付款余额；本地已有 8 张 `invoices` 种子、当前运行 4 张归档台账 | 继续遵守 ADR 0001 单表状态机；编号进入台账编辑/查看时保留来源，项目/分供方/合同与付款申请均按真实外键关联，不恢复 `ticket_registrations` | C-DENSE |
| `app/pages/finance/payment/[id].vue` | `/finance/payment/:id` | 支出财务 | 整页表单 | #203 | R-FORM-PRIOR | 待 #203 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/payment/[id]/detail.vue` | `/finance/payment/:id/detail` | 支出财务 | 详情 | #203 | R-FINANCE-FLOW-LIVE | 参考全局付款列表当前无记录，不能外推详情字段；合同/分供方详情和项目资金页签只证明付款申请、来源单据、支付与票款链应可只读穿透 | 详情继续只展示真实派生的合同、结算、发票、支付勾稽；编辑与登记支付分别进入整页表单，不伪造审批轨迹 | C-DENSE |
| `app/pages/finance/payment/index.vue` | `/finance/payment` | 支出财务 | 列表 | #203 | R-FINANCE-FLOW-LIVE | 参考专属列覆盖申请编号/名称、项目/收款单位/合同、申请/批复/实付、成本、业务类型、支付/审批/生效/回票、结算与审批人；当前通用列表只显示基础 7 列 | 名称先进入只读详情；合同、结算、发票、项目、分供方与支付记录全部按真实外键下钻，来源 query 和列表筛选需可恢复 | C-DENSE |
| `app/pages/finance/payment/new.vue` | `/finance/payment/new` | 支出财务 | 整页表单 | #203 | R-FORM-PRIOR | 待 #203 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/payment-management/index.vue` | `/finance/payment-management` | 支出财务 | 工作台 | #203 | R-FINANCE-FLOW-LIVE | 本地已是独立工作台且运行有 2 条已批复申请；参考默认按支付状态分段，并额外展示合同、付款内容、来源单据/业务类型、所属部门和剩余待支付 | 只读核对批复与已确认支付；申请/项目/分供方/合同/来源单据可下钻，登记支付仍跳整页支付记录，来源字段无 canonical ID 时保持“未接”而非猜文本路由 | C-DENSE |
| `app/pages/finance/receipt/[id].vue` | `/finance/receipt/:id` | 收入财务 | 详情 | #314 | R-FINANCE-FLOW-LIVE | 客户收款关系按稳定 ID 进入中央只读详情；详情展示收款、客户、项目与合同并返回客户收款页签 | 收款查看不得复用表单壳，来源错配/缺失/无权限分别呈现 | C-DENSE |
| `app/pages/finance/receipt/form/[id].vue` | `/finance/receipt/form/:id` | 收入财务 | 整页表单 | #202 | R-FORM-PRIOR | 原编辑表单迁至显式 form 路由，保持既有字段与保存契约 | 只从收款列表显式编辑动作进入 | C-FORM |
| `app/pages/finance/receipt/index.vue` | `/finance/receipt` | 收入财务 | 列表 | #202 | R-FINANCE-FLOW-LIVE | 参考专属列覆盖收款编号/分类、项目/付款单位/合同、收款日期/金额/方式/类型与累计合同收款，编号进入只读详情；当前本地只有 1 条并缺分类、累计列与中央来源身份 | 详情由有效收款聚合累计值，不回写合同静态金额；只有读模型明确返回来源与稳定 ID 时才下钻，旧本地行降级普通文本，编辑保持显式独立动作 | C-DENSE |
| `app/pages/finance/receipt/new.vue` | `/finance/receipt/new` | 收入财务 | 整页表单 | #202 | R-FORM-PRIOR | 待 #202 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/records/[id].vue` | `/finance/records/:id` | 支出财务 | 整页表单 | #203 | R-FORM-PRIOR | 待 #203 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/records/index.vue` | `/finance/records` | 支出财务 | 列表 | #203 | R-FINANCE-FLOW-LIVE | 参考空表仍明确支付编号/日期/金额/方式、收款账户/开户行/账号和创建审计；当前本地有 3 条已确认支付但继续使用通用列表，未展示银行凭证身份 | 编号先进入只读详情，付款申请分摊和收款方下钻按真实 ID；银行流水唯一性、人工确认和 OCR 来源继续以 ADR 0015 为准 | C-DENSE |
| `app/pages/finance/records/new.vue` | `/finance/records/new` | 支出财务 | 整页表单 | #203 | R-FORM-PRIOR | 待 #203 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/reimbursement/[id].vue` | `/finance/reimbursement/:id` | 支出财务 | 整页表单 | #203 | R-FORM-PRIOR | 待 #203 同屏测量 | 写入路径保持现有契约 | C-FORM |
| `app/pages/finance/reimbursement/index.vue` | `/finance/reimbursement` | 支出财务 | 列表 | #203 | R-FINANCE-FLOW-LIVE | 参考按材料/非材料/公司报销分类，专属列含申请、项目/公司、业务/报销类型、报销人/日期/说明、累计报销、备用金抵扣/扣款/抵扣后支付、审批/实付/余额/支付/生效与成本分类；当前本地真实空态但只显示通用列 | 无 seed 保留真实空态；总额从明细派生，项目可空表示公司开支，备用金抵扣没有本地实体前显示未接而非补 0 或 Mock | C-DENSE |
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
| `app/pages/owner/[kind]/[id].vue` | `/owner/:kind/:id` | 甲方单据 | 详情 | #323 | R-OWNER-DOCUMENTS-LIVE | 参考甲方报量编号先进入只读详情，详情有摘要、审批轨迹、分段资料、附件以及项目/合同/甲方蓝链；其余专属详情无参考非空行，按本地页面蓝本与真实模型补齐 | #323—#326 已交付五类中央只读详情；甲方罚扣独立投影金额、联系单、日期、事由、申诉、状态与附件，按稳定 ID 往返合同罚扣事实行，不外推未观测审批流 | C-FORM |
| `app/pages/owner/[kind]/form/[id].vue` | `/owner/:kind/form/:id` | 甲方单据 | 整页表单 | #323 | R-OWNER-DOC-DC | DC 的五类甲方表单规定专属字段、必要明细、附件与固定底栏 | 正式编辑与只读详情分路由；保存只经中央 command，演示及受保护状态不显示写入口；罚扣不借项目罚扣或分包抵扣 | C-FORM |
| `app/pages/owner/[kind]/index.vue` | `/owner/:kind` | 甲方单据 | 列表 | #197 | R-OWNER-DOCUMENTS-LIVE | 参考六类入口分别保留专属金额链、日期、甲方/合同、附件、审批列及汇总；验收和保修的参考列表为两个入口 | #323—#326 已使五类 canonical 单据编号进入只读详情并恢复来源、搜索、视图、状态、页码、滚动与焦点；甲方罚扣只使用草稿/已提交状态，不伪造申诉审批流 | C-DENSE |
| `app/pages/owner/[kind]/new.vue` | `/owner/:kind/new` | 甲方单据 | 整页表单 | #197 | R-OWNER-DOC-DC | 新建页按动态类型显示真实标题、字段分区、金额摘要、必要明细和附件区，不使用通用占位标题 | 五类正式甲方单据只选择真实项目与施工合同并走中央命令；草稿和提交分别校验，演示来源只读 | C-FORM |
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
| `app/pages/project/[id].vue` | `/project/:id` | 项目 | 详情 | #190 | R-PROJECT-DETAIL-LIVE | 参考已确认紧凑标题与元数据、经营摘要和阶段计数；#319 按直接证据增加材料采购合同计数与关系入口；#281 按本地蓝本补齐右栏中央 ProjectSupplier 反向关系，并以 390/768/1024/1440px 验证布局 | 材采计数和项目分供方只读同项目稳定外键与来源；真实空态、暂不可用和无权限分开表达。交付、库存、结算核心及项目物资其他范围不由本票扩展 | C-DENSE |
| `app/pages/project/[pid]/supplier/[sid].vue` | `/project/:pid/supplier/:sid` | 项目分供方 | 详情 | #192 | R-PROJECT-DETAIL-LIVE | 没有项目×分供方目标页的安全直接证据；只借鉴邻近项目详情已确认的紧凑摘要、轻边界分区和局部横向滚动，采用六页签主区与下方合作文件，不把邻近页字段或动作写成目标页事实 | 中央 Repository 按同来源双 ID 返回合同、请款、收票、付款、支出结算与文件六类事实；仅演示合同/付款申请已有同来源只读目标并可返回，其他来源保持不可用；终态结算写入和文件正文能力明确未接入 | C-DENSE |
| `app/pages/project/[pid]/supplier/import.vue` | `/project/:pid/supplier/import` | 项目分供方 | 特殊工具 | #192 | R-FORM-LIVE | 没有文件导入目标页的安全直接证据，且严格只读协议禁止在参考站触发上传或导入；这里只借鉴邻近整页表单已确认的纵向分区、步骤信息和底部操作区，三步内容由本地蓝本裁定 | 文件名匹配、类别推荐和人工调整保留本机；不读正文做分类、不伪装 OCR。只有最终确认才经专用中央命令提交正文及分供方/ProjectSupplier/文件元数据；未确认候选不写入，失败不留半成品 | C-TOOL |
| `app/pages/project/form/[[id]].vue` | `/project/form/:id?` | 项目 | 整页表单 | #190 | R-FORM-PRIOR | 项目目标页没有安全直接证据；仅借鉴 `R-FORM-LIVE` 的相邻短表单结构，并以项目蓝本、ADR 0014 和真实客户外键裁定字段与行为 | 保留草稿、保存、保存并新建、保存并提交；新建取消返回列表、保存进入新项目详情，编辑取消/保存返回原项目详情 | C-FORM |
| `app/pages/project/index.vue` | `/project` | 项目 | 列表 | #190 | R-PROJECT-LIST-LIVE | 参考已确认左流程阶段、单行工具栏、紧凑表格和右下分页；本地新建能力继续按项目规格保留 | 未触发导入、筛选、设置或行级操作 | C-DENSE |
| `app/pages/project/penalty/[id].vue` | `/project/penalty/:id` | 分包单据 | 整页表单 | #197 | R-SUB-DOC-DC | 项目罚扣使用独立标题、项目/分供方/合同/班组来源、罚扣与整改分区及真实状态动作 | 抵扣必须引用真实已确认分包结算；附件归当前罚扣，错误定位首个无效字段 | C-FORM |
| `app/pages/project/penalty/index.vue` | `/project/penalty` | 分包单据 | 列表 | #197 | R-SUB-DOCUMENTS-LIVE | 参考专属列覆盖审批、罚扣类型、转扣合同/乙方、罚扣与签认金额、附件及甲方结算转扣记录；分包合同详情再按四组审批状态保留相同表头 | 不展示参考内部“是否删除”列；签认和转扣只读真实抵扣关系，编号先进入只读详情，来源 query 和列表状态往返可恢复 | C-DENSE |
| `app/pages/project/penalty/new.vue` | `/project/penalty/new` | 分包单据 | 整页表单 | #197 | R-SUB-DOC-DC | 新建页使用项目罚扣专属字段和附件区，项目、合同、分供方或班组只选择真实关联记录 | 草稿不伪造抵扣结果；状态推进和结算抵扣保持本地事务契约 | C-FORM |
| `app/pages/project/target-cost/[id].vue` | `/project/target-cost/:id` | 项目进度成本 | 详情 | #191 | R-TARGET-COST-LIVE | 参考详情已确认独立页签、白底平铺资料、明确关闭返回和预算/已签/实际/申请四轨摘要；本地继续保留版本摘要、科目清单与正式成本对比，不复制参考审批栏或示例值 | 科目明细只写当前版本；成本对比只读正式源单并穿透现有路由，不从名称或录入汇总值反推 | C-DENSE |
| `app/pages/project/target-cost/form/[[id]].vue` | `/project/target-cost/form/:id?` | 项目进度成本 | 整页表单 | #191 | R-TARGET-COST-LOCAL | DC 有目标成本版本头整页表单源码；现有参考运行证据只支持邻近短表单的两列字段网格、纵向滚动和固定底部动作，不把材料合同或分供方字段外推到目标成本 | 版本头与科目明细分开保存；草稿、提交、项目 lookup 和基线切换继续按本地事务契约 | C-FORM |
| `app/pages/project/target-cost/index.vue` | `/project/target-cost` | 项目进度成本 | 列表 | #191 | R-TARGET-COST-LIVE | 参考已确认单行工具栏、紧凑宽表、右下分页、名称详情入口和已签合同额到清单明细的嵌套下钻；本地保留项目/基线/状态筛选与真实版本状态，不复制导入导出或参考审批写入 | 金额只展示 `target_costs` 版本头事实；项目、状态和基线筛选不改写数据，名称进入专用详情；金额下钻由后续跨域链接票按本地真实关系统一裁定 | C-DENSE |
| `app/pages/schedule/[pid]/index.vue` | `/schedule/:pid` | 项目进度成本 | 工作台 | #191 | R-ENGINEERING-FLOW-LOCAL | 合和新城显示真实 WBS、FS+lag、计划/实际和阶段完成率；车陂商业大楼无排程时显示 0 组、0% 与“当前项目还没有楼栋排程分组”，不补演示任务 | 工序详情→工程量携真实项目/分组/楼栋/任务/阶段/分项上下文；返回按项目/分组/任务重新打开同一详情，写动作仍保持本地确认契约 | C-DENSE |
| `app/pages/schedule/[pid]/bind/[gid].vue` | `/schedule/:pid/bind/:gid` | 项目进度成本 | 整页表单 | #191 | R-SCHEDULE-LOCAL | 红圈无目标页；采用 #244 已补齐的 `ScheduleBindScreen.jsx` 与 ADR 0017，展示合同检索、楼栋覆盖、分项映射和冻结数量差异 | 进入页面不写入；只有无阻断且再次确认“确认绑定”才切换范围依据；预览与绑定均读取建组时冻结的暂估量 | C-FORM |
| `app/pages/schedule/index.vue` | `/schedule` | 项目进度成本 | 工作台 | #191 | R-ENGINEERING-FLOW-LOCAL | 本地生产运行态已复核 WBS Tree + 甘特、计划/实际、自动/手动进度和四档局部横滚；参考站没有同构页面，不新增邻近统计模块 | 默认、空计划、部分完成与延期按真实排程解释；项目/分组/任务 query 可恢复外部定位，工程量返回后不丢当前任务 | C-DENSE |
| `app/pages/schedule/new.vue` | `/schedule/new` | 项目进度成本 | 整页表单 | #191 | R-SCHEDULE-LOCAL | DC 有新建排程源码但形态早于当前三步向导；业务字段只取其本地蓝本，生产结构按“范围 → 工序 → 确认”与 ADR 0017 / 0018 裁定，不声称红圈有目标页 | 无项目区域时直达区域配置；内部暂估只读手工暂估量；第三步集中汇总范围、依据、周期、依赖与阻断项，失败保留草稿并可重试 | C-FORM |
| `app/pages/schedule/process-library/form.vue` | `/schedule/process-library/form` | 项目进度成本 | 整页表单 | #191 | R-SCHEDULE-LOCAL | 红圈无直接目标页；采用 #244 已补齐的 `forms/ScheduleForms.jsx`、ADR 0014 与本地甘特/精确表格双视图 | 进入页面只读来源版本；只有“保存为新版本”才新增库与工序定义，绝不回写来源版本 | C-FORM |
| `app/pages/schedule/process-library/index.vue` | `/schedule/process-library` | 项目进度成本 | 列表 | #191 | R-SCHEDULE-LOCAL | 红圈无直接目标页；采用 #244 已补齐的 `ScheduleProcessLibraryScreen.jsx`、本地紧凑列表模板与局部横向滚动 | 只读展示版本、工序数及引用数；编辑动作统一转入新版本整页表单 | C-DENSE |
| `app/pages/settings/ocr.vue` | `/settings/ocr` | 系统设置 | 工作台 | #204 | R-OCR-STUDIO-SOURCE | 采用参考项目的单页纵向区块、紧凑密度和底部恢复/保存反馈；字段与能力只按 ADR 0006 的 PaddleOCR-VL 单模型契约实现，不照搬传统 PP-OCRv6 参数 | 当前路由已可达；7 项 VL 文档能力和有界请求/轮询超时保存到本机 SQLite，并真实进入发票、送货单识别请求。Token、API 地址和模型仍由服务端私有配置持有，不提供假保存 | C-TOOL |
| `app/pages/settings/data-migration.vue` | `/settings/data-migration` | 导入导出 | 工作台 | #294 | R-TOOL-PENDING | 按本地迁移契约使用纵向步骤、预检/备份/对账/切换分区和表内横向滚动；外部参考站没有可安全观察的一一对应迁移页 | 仅浏览器正式工作区可执行；后台权威校验拓扑、整库摘要、映射、实际写入对账和回滚窗口，Tauri 明确不可用；备份字节不上传 | C-TOOL |
| `app/pages/subcontract/[kind]/[id].vue` | `/subcontract/:kind/:id` | 分包单据 | 整页表单 | #197 | R-SUB-DOC-DC | 动态类型映射到分包变洽签或分包结算的真实标题、字段分区和状态动作；两类均不补造无持久化实体支撑的明细网格 | 编辑返回原类型列表；分供方、合同、附件和结算只走真实外键，错误定位首个无效字段 | C-FORM |
| `app/pages/subcontract/[kind]/index.vue` | `/subcontract/:kind` | 分包单据 | 列表 | #197 | R-SUB-DOCUMENTS-LIVE | 参考分包变洽签与分包结算分别保留合同金额/申报审定链和奖罚/申请支付余额链；当前本地真实项目/合同/分供方来源正确但列表投影较窄 | 金额与余额只做真实聚合，不保存副本；空列表仍保留专属列，编号/名称先进入只读详情并恢复项目/合同/分供方及本地筛选 | C-DENSE |
| `app/pages/subcontract/[kind]/new.vue` | `/subcontract/:kind/new` | 分包单据 | 整页表单 | #197 | R-SUB-DOC-DC | 新建页按动态类型显示真实标题、来源、金额、备注和附件分区，不使用通用占位标题或虚构明细 | 项目、合同和分供方只选择真实关联记录；草稿、上报和确认沿用本地状态校验 | C-FORM |
| `app/pages/subcontract/attendance.vue` | `/subcontract/attendance` | 工程量与工资 | 工作台 | #198 | R-ENGINEERING-FLOW-LOCAL | 项目/月/班组 query 可恢复真实名册，当前无考勤时仍展示 0 人日/0 工时和当月实际天数矩阵；390–1440px 根无横滚、矩阵局部横滚 | 返回工资和进入 C2 可保留项目/月/班组/工资状态；只写 `attendance_records`，C2 人员与 C1 已发月份锁定 | C-DENSE |
| `app/pages/subcontract/daywork.vue` | `/subcontract/daywork` | 工程量与工资 | 工作台 | #198 | R-ENGINEERING-FLOW-LOCAL | C2 逐日签工表单与真实空台账已可达，但当前忽略来自工资/考勤的 project/month/crew/status query，回考勤和工资也退回无筛选根路由 | 必须复用工资筛选上下文；签工与考勤同月互斥、已发月份冻结、只有已确认记录进入工资的规则不变 | C-DENSE |
| `app/pages/subcontract/payroll/[id].vue` | `/subcontract/payroll/:id` | 工程量与工资 | 详情 | #198 | R-ENGINEERING-FLOW-LOCAL | 不存在 ID 能显示真实 not-found；当前运行种子无工资单，released 冻结详情只能由既有测试证明 | 详情入口和返回需携项目/月/班组/状态；当前 `back-to` 固定工资根路由会丢筛选。只展示真实外键与 released 快照 | C-DENSE |
| `app/pages/subcontract/payroll/index.vue` | `/subcontract/payroll` | 工程量与工资 | 工作台 | #198 | R-ENGINEERING-FLOW-LOCAL | 项目/月/班组/状态筛选、0 单据汇总、空表头和建单/考勤/C2 入口均由运行态确认；没有工资种子时不补成功单据 | 列表→建单→列表与列表↔考勤已保留 query；详情和 C2 仍需补齐。A/C1/C2 可用，B 因无合同责任外键继续禁用 | C-DENSE |
| `app/pages/subcontract/payroll/new.vue` | `/subcontract/payroll/new` | 工程量与工资 | 整页表单 | #198 | R-ENGINEERING-FLOW-LOCAL | 项目、月份、班组按来源 query 正确预填，负责人只取当前真实责任范围；B 在界面禁用 | 取消/成功按原筛选返回；不触发保存也能观察完整字段。页面、store 和服务继续多层阻止 B 类伪建单 | C-FORM |
| `app/pages/subcontract/quantity/[pid]/[uid].vue` | `/subcontract/quantity/:pid/:uid` | 工程量与工资 | 详情 | #198 | R-ENGINEERING-FLOW-LOCAL | 工种→阶段→三量的只读施工详情可达，六项筛选完整返回，错配 pid/uid 显式失败；当前明细 `null` 显示“—”，阶段/全户合计却按 0 相加 | 先修复可空合计，不能把缺现场量写成 0；责任、阶段完成和三量仍只读派生，不落第二表 | C-DENSE |
| `app/pages/subcontract/quantity/index.vue` | `/subcontract/quantity` | 工程量与工资 | 工作台 | #198 | R-ENGINEERING-FLOW-LOCAL | 合和新城真实 8 户矩阵可显示责任、完成与草稿；车陂商业大楼无区域时显示真实配置空态。四档根无横滚，矩阵只在 390px 局部滚动 | 排程任务下钻与返回已闭合；量差和矩阵继续读三量/阶段事实。分包合同与工资责任无显式外键，不从项目名称猜合同 | C-DENSE |
| `app/pages/subcontract/quantity/region.vue` | `/subcontract/quantity/region` | 工程量与工资 | 整页表单 | #198 | R-ENGINEERING-FLOW-LOCAL | 楼栋→楼层→户真实区域、户型挂靠和排程来源返回已在只读运行态确认；空项目仍提供明确区域配置入口 | 本轮未执行新增；合同可选，归档矩阵禁止写入，排程恢复标记继续按项目真实 ID 传递 | C-FORM |
| `app/pages/subcontract/quantity/template.vue` | `/subcontract/quantity/template` | 工程量与工资 | 整页表单 | #198 | R-ENGINEERING-FLOW-LOCAL | 正式模板、稳定房间、活链接户数和合同/暂估/现场三量并排显示已确认；未触发编辑或保存 | 三量分别保存；现场量保持 number 或 null，未保存离开需确认，详情合计不得把 null 降格为 0 | C-FORM |

## 6. 维护规则

1. `app/pages/` 新增、删除或改名生产页面时，同一提交更新本矩阵；`app/pages/dev/` 不计入生产清单。
2. 业务实施票完成安全观察后，记录实际参考路径、视口、只读状态和差异结论；不能用“看起来一样”替代证据。
3. 同一类参考证据可以复用档案代码，但目标页没有直接证据时必须继续标为邻近或待补采。
4. 若发现会改变业务规则、权限、状态机、字段含义或写入副作用的差异，停止实现并按固定模板建立独立 `needs-info` Issue。
5. 实施票关闭前同时更新本矩阵、受影响的页面蓝本/ADR、`ui-implementation-status.md` 和 Issue 验收证据。
