# 全模块复核覆盖索引

源码采证基线：`8252e1abe1520d03aa75c48f7bf237631742ddf7`，日期 2026-09-08。本页和同名 JSON 由 `node scripts/sync-module-review-coverage.mjs` 生成。

本索引负责防遗漏，不定义业务规格，也不是完成率。路由来源为 [运行证据账本](./runtime-evidence-ledger.json)；子视图和宿主接线来自实际源码。父路由的 direct/historical 等级不自动赋给子视图。逐场景规则、差异和验收继续写入 [模块复核规程](../agents/module-review.md) 指定的当前 Issue。

现有 137 条生产路由展开为 192 个路由变体、556 个页面/子视图、1012 个宿主用例。另有 5 个 dev 路由；这些数量均不表示已验收。

实际记录见 [可机读清单](./module-review-coverage.json)：surfaces 保存 route + kind + variant + mode + path，cases 再按 browser/tauri 展开，分别保存读写适配器、参考范围、验收结果和剩余缺口。规则已定、前台通过、跨域通过、生产可用独立记录。#422 只登记材料合同浏览器列表已覆盖切片，整页仍为 partial；中央 Map、IndexedDB 刷新读回都没有生产可用结论。

源码清点仍需逐模块补全动作、合法状态、附件正文及审计细节。新增动态注册、路由或已登记源码锚点变化时运行生成器并审查差异；不要把自动新增行提升为验收通过。

## 宿主与读写边界

| 标识 | 读取 | 写入边界 | 实际存储/限制 |
| --- | --- | --- | --- |
| central-http | HTTP Repository；测试服务实例 | 中央 command（仅已暴露动作；逐动作原子性/幂等/版本待核验） | 中央测试实例 Map；不具备进程重启持久化证据 |
| browser-local | 本地 DB adapter：sql.js / IndexedDB 快照 | 本地 DB 事务；尚未接管的业务边界，不能冒充中央正式写入 | IndexedDB crm-new-browser / database_snapshots；文件正文须另验 |
| desktop-sqlite | Tauri 本地 DB adapter | 现有桌面 SQLite 分支；本轮只核对既有能力 | sqlite:crm.db；桌面正式交付不在本轮扩展范围 |
| credential-browser | 中央核对分供方身份；仅 demo 可读本地证照快照 | 正式浏览器证照专用存储未接入；demo 只读 | 正式证照正文未接入，不能用本地演示快照证明正式可用 |
| simulation | 合成导入演示 | 模拟成功/首次失败，无业务记录写入 | 无业务持久化 |
| precheck-only | 本地来源预检 | 只预检，不写业务行 | 无导入写入 |
| file-workflow | 导出任务上下文与选定数据集 | 生成真实文件；不是业务存储写入 | 瞬时文件工作流；完整数据集/正文/失败清理分别验收 |
| tool-local-storage | localStorage 因子工具配置；当前计算结果在内存 | useLocalStorage 保存 sum-solver-state；不写业务记录 | WebView/browser localStorage；不是 SQLite 或中央持久化 |
| migration-browser | 本地旧快照 + 中央预检/对账 | 显式迁移确认/切换/回滚；正式执行需另获授权 | 中央测试实例；备份恢复不构成生产数据库验收 |
| unsupported | 当前宿主不支持 | 禁止执行 | 不适用 |

Tauri 只核验已有功能，正式交付按 #402 排除。HTTP Repository 未按宿主自动换成 SQLite；项目列表/详情、客户/分供方列表/详情和部分关系详情在桌面仍是 HTTP。所有未附实际运行证据的宿主用例为待验收。

## 红圈可见菜单双向映射

以下只证明登录会话中入口名称可见，不能证明子页面、保存、空数据或私有接口行为。pending 是待调查映射，不是排除。瑞航独有的工程量、工资、OCR、迁移等按下方本地路由索引和当前规格验收。

| 菜单 | 本地候选/对应 | 映射状态 | 承接与边界 |
| --- | --- | --- | --- |
| 工程项目管理 / 首页 | `/` | partial | #414 仅施工进度属于当前首页范围 |
| 工程项目管理 / 项目信息 | `/project` | mapped | #408  |
| 工程项目管理 / 目标成本 | `/project/target-cost` | mapped | #412  |
| 统计分析 / 分析 | — | excluded | #402 独立统计门户/完整审批按 #402 排除；现有通知与 capability 仍须复核 |
| 统计分析 / 公告 | — | excluded | #402 独立统计门户/完整审批按 #402 排除；现有通知与 capability 仍须复核 |
| 统计分析 / 审批 | — | excluded | #402 独立统计门户/完整审批按 #402 排除；现有通知与 capability 仍须复核 |
| 乙供材管理 / 仓库档案 | — | pending | #411 尚未找到独立本地路由；仓库业务归属和已有字段需核验 |
| 乙供材管理 / 材料采购合同 | `/contract/material` | mapped | #409  |
| 乙供材管理 / 下料单 | `/material/requisition` | mapped | #411  |
| 乙供材管理 / 材料到货 | `/material/arrival` | mapped | #411  |
| 乙供材管理 / 材料领用 | `/material/use` | mapped | #411  |
| 乙供材管理 / 乙供材直入直出 | — | pending | #411 不能把甲供材 direct 当作乙供对应能力 |
| 乙供材管理 / 批量调拨 | — | pending | #411  |
| 乙供材管理 / 材料采购结算 | `/material/settlement` | mapped | #409  |
| 乙供材管理 / 库存盘点 | `/material/stock-check` | mapped | #411  |
| 甲供材管理 / 甲供材总控量 | `/owner-material/control` | mapped | #411  |
| 甲供材管理 / 甲供材下料单 | `/owner-material/requisition` | mapped | #411  |
| 甲供材管理 / 甲供材到货 | `/owner-material/arrival` | mapped | #411  |
| 甲供材管理 / 甲供材领用 | `/owner-material/use` | mapped | #411  |
| 甲供材管理 / 甲供材直入直出 | `/owner-material/direct` | mapped | #411  |
| 分包及人工 / 分包合同 | `/contract/subcontract` | mapped | #409  |
| 分包及人工 / 项目罚扣 | `/project/penalty` | mapped | #410  |
| 分包及人工 / 分包结算 | `/subcontract/settlement` | mapped | #410  |
| 分包及人工 / 分包变洽签 | `/subcontract/change` | mapped | #410  |
| 资金管理 / 开票申请 | `/finance/billing` | mapped | #413  |
| 资金管理 / 收款登记 | `/finance/receipt` | mapped | #413  |
| 资金管理 / 收票登记 | `/finance/ledger` | mapped | #413  |
| 资金管理 / 付款申请 | `/finance/payment` | mapped | #413  |
| 资金管理 / 费用报销 | `/finance/reimbursement` | mapped | #413  |
| 资金管理 / 付款管理 | `/finance/payment-management` | mapped | #413  |
| 资金管理 / 支付记录 | `/finance/records` | mapped | #413  |
| 资金管理 / 保证金申请 | — | pending | #413 只有菜单证据，尚不能裁定为瑞航往来单据或现有付款类型 |
| 资金管理 / 保证金退还 | — | pending | #413 只有菜单证据，尚不能裁定为瑞航往来单据或现有付款类型 |
| 资金管理 / 备用金申请 | — | pending | #413 只有菜单证据，尚不能裁定为瑞航往来单据或现有付款类型 |
| 资金管理 / 备用金退还 | — | pending | #413 只有菜单证据，尚不能裁定为瑞航往来单据或现有付款类型 |
| 资金管理 / 往来收款 | `/finance/current` | partial | #413 按本地实际收付方向逐场景核验 |
| 资金管理 / 往来付款 | `/finance/current` | partial | #413 按本地实际收付方向逐场景核验 |
| 基础信息 / 客户 | `/base/customer` | mapped | #407  |
| 基础信息 / 分供方 | `/base/supplier` | mapped | #407  |
| 基础信息 / 往来单位 | — | pending | #407 Party/客户/分供方的当前归属须依 CONTEXT 核对，不新造平行主档 |
| 主合同管理 / 施工合同 | `/contract/construction` | mapped | #409  |
| 主合同管理 / 甲方报量 | `/owner/report` | mapped | #410  |
| 主合同管理 / 甲方罚扣单 | `/owner/penalty` | mapped | #410  |
| 主合同管理 / 甲方变洽签 | `/owner/change` | mapped | #410  |
| 主合同管理 / 竣工验收 | `/owner/acceptance` | mapped | #410  |
| 主合同管理 / 最终结算 | `/owner/final-settlement` | mapped | #410  |
| 主合同管理 / 保修到期确认单 | `/owner/acceptance?variant=warranty` | mapped | #410  |
| 项目其他合同 / 项目其他收入合同 | — | pending | #409 独立收入合同现有范围及本地对应待核对 |
| 项目其他合同 / 其他支出合同 | `/contract/other-expense` | mapped | #409  |
| 项目其他合同 / 其他支出结算 | `/contract/other-settlement` | mapped | #409  |
| 项目其他合同 / 公司支出合同 | `/contract/company-expense` | mapped | #409  |
| 物品管理 / 物品档案 | — | excluded | #402 独立办公物品管理不在 #402 当前范围 |
| 物品管理 / 物品领用单 | — | excluded | #402 独立办公物品管理不在 #402 当前范围 |
| 物品管理 / 物品移交单 | — | excluded | #402 独立办公物品管理不在 #402 当前范围 |
| 物品管理 / 物品归还单 | — | excluded | #402 独立办公物品管理不在 #402 当前范围 |
| 物品管理 / 物品销毁单 | — | excluded | #402 独立办公物品管理不在 #402 当前范围 |
| 协同办公 / 日程 | — | excluded | #402 独立协同办公不在 #402 当前范围；瑞航业务附件/排程不因此排除 |
| 协同办公 / 文件 | — | excluded | #402 独立协同办公不在 #402 当前范围；瑞航业务附件/排程不因此排除 |
| 协同办公 / 任务 | — | excluded | #402 独立协同办公不在 #402 当前范围；瑞航业务附件/排程不因此排除 |

## 无独立路由的公共能力

- 侧栏、业务页签、刷新与脏数据关闭保护：[app/components/layout/AppTabBar.vue](../../app/components/layout/AppTabBar.vue)；#404；逐场景待核验。
- 确认、轻量表单、结果消息与处理消息：[app/components/shared/KitUIHost.vue](../../app/components/shared/KitUIHost.vue)；#404；逐场景待核验。
- 通知抽屉 todo / notice 及目标返回：[app/components/shared/NotificationDrawer.vue](../../app/components/shared/NotificationDrawer.vue)；#404；逐场景待核验。

## 本地路由、变体与子视图

每行的 browser / tauri 列是接线事实，实际验收在 JSON cases 内逐宿主记录。page 是完整页面；tab、section、table、pane、dialog、step 是需单独采证的子面。动态记录 ID、项目、来源 real/demo、权限和失败状态在相应 Issue 的场景表继续展开，不能用一条合成样本替代全部适用场景。

### 首页（#414）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/` view | home / default | page · 工作台 | browser-local / desktop-sqlite | [app/pages/index.vue](../../app/pages/index.vue) |

### 项目（#408）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/project/:id` view | project / default | page · 详情 | central-http / central-http | [app/pages/project/[id].vue](../../app/pages/project/[id].vue) |
| `/project/:id` view | project / default | section/basic · basic | central-http / central-http | [app/components/project/ProjectDetailTab.vue](../../app/components/project/ProjectDetailTab.vue) |
| `/project/:id` view | project / default | section/participants · participants | central-http / central-http | [app/components/project/ProjectDetailTab.vue](../../app/components/project/ProjectDetailTab.vue) |
| `/project/:id` view | project / default | section/system · system | central-http / central-http | [app/components/project/ProjectDetailTab.vue](../../app/components/project/ProjectDetailTab.vue) |
| `/project/:id` view | project / default | journey/ProjectMaterialContractJourney · ProjectMaterialContractJourney | central-http / central-http | [app/components/project/ProjectDetailScreen.vue](../../app/components/project/ProjectDetailScreen.vue) |
| `/project/:id` view | project / default | journey/AuxiliaryContractJourney · AuxiliaryContractJourney | central-http / central-http | [app/components/project/ProjectDetailScreen.vue](../../app/components/project/ProjectDetailScreen.vue) |
| `/project/:id` view | project / default | journey/owner/change · change | central-http / central-http | [app/components/project/ProjectDetailScreen.vue](../../app/components/project/ProjectDetailScreen.vue) |
| `/project/:id` view | project / default | journey/owner/report · report | central-http / central-http | [app/components/project/ProjectDetailScreen.vue](../../app/components/project/ProjectDetailScreen.vue) |
| `/project/:id` view | project / default | journey/owner/acceptance · acceptance | central-http / central-http | [app/components/project/ProjectDetailScreen.vue](../../app/components/project/ProjectDetailScreen.vue) |
| `/project/:id` view | project / default | journey/owner/warranty · warranty | central-http / central-http | [app/components/project/ProjectDetailScreen.vue](../../app/components/project/ProjectDetailScreen.vue) |
| `/project/:id` view | project / default | journey/owner/final-settlement · final-settlement | central-http / central-http | [app/components/project/ProjectDetailScreen.vue](../../app/components/project/ProjectDetailScreen.vue) |
| `/project/:id` view | project / default | journey/owner/penalty · penalty | central-http / central-http | [app/components/project/ProjectDetailScreen.vue](../../app/components/project/ProjectDetailScreen.vue) |
| `/project/:id` view | project / default | journey/owner/project-penalty · project-penalty | central-http / central-http | [app/components/project/ProjectDetailScreen.vue](../../app/components/project/ProjectDetailScreen.vue) |
| `/project/:id` view | project / default | journey/owner/sub-settlement · sub-settlement | central-http / central-http | [app/components/project/ProjectDetailScreen.vue](../../app/components/project/ProjectDetailScreen.vue) |
| `/project/:id` view | project / default | journey/owner/sub-change · sub-change | central-http / central-http | [app/components/project/ProjectDetailScreen.vue](../../app/components/project/ProjectDetailScreen.vue) |
| `/project/:id` view | project / default | relations/suppliers · suppliers | central-http / central-http | [app/components/project/ProjectDetailScreen.vue](../../app/components/project/ProjectDetailScreen.vue) |
| `/project/form` new | project / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/project/form/[[id]].vue](../../app/pages/project/form/[[id]].vue) |
| `/project/form/:id` edit | project / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/project/form/[[id]].vue](../../app/pages/project/form/[[id]].vue) |
| `/project` view | project / default | page · 列表 | central-http / central-http | [app/pages/project/index.vue](../../app/pages/project/index.vue) |

### 基础主数据（#407）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/base/crew/:id` view | crew / default | page · 详情 | central-http / desktop-sqlite | [app/pages/base/crew/[id].vue](../../app/pages/base/crew/[id].vue) |
| `/base/crew/:id` view | crew / default | table/members · members | central-http / 不适用 | [app/components/crew-worker/CrewWorkerCentralDetailScreen.vue](../../app/components/crew-worker/CrewWorkerCentralDetailScreen.vue) |
| `/base/crew/:id` view | crew / default | table/projects · projects | central-http / 不适用 | [app/components/crew-worker/CrewWorkerCentralDetailScreen.vue](../../app/components/crew-worker/CrewWorkerCentralDetailScreen.vue) |
| `/base/crew/:id` view | crew / default | table/penalties · penalties | central-http / 不适用 | [app/components/crew-worker/CrewWorkerCentralDetailScreen.vue](../../app/components/crew-worker/CrewWorkerCentralDetailScreen.vue) |
| `/base/crew/:id` view | crew / default | section/CrewDetailCapabilities · CrewDetailCapabilities | 不适用 / desktop-sqlite | [app/components/master-data/CrewDetailScreen.vue](../../app/components/master-data/CrewDetailScreen.vue) |
| `/base/crew/:id` view | crew / default | section/CrewDetailMembers · CrewDetailMembers | 不适用 / desktop-sqlite | [app/components/master-data/CrewDetailScreen.vue](../../app/components/master-data/CrewDetailScreen.vue) |
| `/base/crew/:id` view | crew / default | section/CrewDetailProjects · CrewDetailProjects | 不适用 / desktop-sqlite | [app/components/master-data/CrewDetailScreen.vue](../../app/components/master-data/CrewDetailScreen.vue) |
| `/base/crew/:id` view | crew / default | section/CrewDetailPenalties · CrewDetailPenalties | 不适用 / desktop-sqlite | [app/components/master-data/CrewDetailScreen.vue](../../app/components/master-data/CrewDetailScreen.vue) |
| `/base/crew/form` new | crew / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/base/crew/form/[[id]].vue](../../app/pages/base/crew/form/[[id]].vue) |
| `/base/crew/form/:id` edit | crew / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/base/crew/form/[[id]].vue](../../app/pages/base/crew/form/[[id]].vue) |
| `/base/crew` view | crew / default | page · 列表 | central-http / desktop-sqlite | [app/pages/base/crew/index.vue](../../app/pages/base/crew/index.vue) |
| `/base/customer/:id` view | customer / default | page · 详情 | central-http / central-http | [app/pages/base/customer/[id].vue](../../app/pages/base/customer/[id].vue) |
| `/base/customer/:id` view | customer / default | tab/projects · projects | central-http / central-http | [app/components/master-data/CustomerDetailScreen.vue](../../app/components/master-data/CustomerDetailScreen.vue) |
| `/base/customer/:id` view | customer / default | tab/contracts · contracts | central-http / central-http | [app/components/master-data/CustomerDetailScreen.vue](../../app/components/master-data/CustomerDetailScreen.vue) |
| `/base/customer/:id` view | customer / default | tab/receipts · receipts | central-http / central-http | [app/components/master-data/CustomerDetailScreen.vue](../../app/components/master-data/CustomerDetailScreen.vue) |
| `/base/customer/:id` view | customer / default | tab/projects/table · table | central-http / central-http | [app/components/master-data/CustomerDetailRelations.vue](../../app/components/master-data/CustomerDetailRelations.vue) |
| `/base/customer/:id` view | customer / default | tab/contracts/table · table | central-http / central-http | [app/components/master-data/CustomerDetailRelations.vue](../../app/components/master-data/CustomerDetailRelations.vue) |
| `/base/customer/:id` view | customer / default | tab/receipts/table · table | central-http / central-http | [app/components/master-data/CustomerDetailRelations.vue](../../app/components/master-data/CustomerDetailRelations.vue) |
| `/base/customer/form` new | customer / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/base/customer/form/[[id]].vue](../../app/pages/base/customer/form/[[id]].vue) |
| `/base/customer/form/:id` edit | customer / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/base/customer/form/[[id]].vue](../../app/pages/base/customer/form/[[id]].vue) |
| `/base/customer` view | customer / default | page · 列表 | central-http / central-http | [app/pages/base/customer/index.vue](../../app/pages/base/customer/index.vue) |
| `/base/worker/:id` view | worker / default | page · 详情 | central-http / desktop-sqlite | [app/pages/base/worker/[id].vue](../../app/pages/base/worker/[id].vue) |
| `/base/worker/:id` view | worker / default | facts/relatedWorkers · relatedWorkers | central-http / 不适用 | [app/components/crew-worker/CrewWorkerCentralDetailScreen.vue](../../app/components/crew-worker/CrewWorkerCentralDetailScreen.vue) |
| `/base/worker/:id` view | worker / default | facts/assignments · assignments | central-http / 不适用 | [app/components/crew-worker/CrewWorkerCentralDetailScreen.vue](../../app/components/crew-worker/CrewWorkerCentralDetailScreen.vue) |
| `/base/worker/:id` view | worker / default | facts/wageStatements · wageStatements | central-http / 不适用 | [app/components/crew-worker/CrewWorkerCentralDetailScreen.vue](../../app/components/crew-worker/CrewWorkerCentralDetailScreen.vue) |
| `/base/worker/:id` view | worker / default | facts/penalties · penalties | central-http / 不适用 | [app/components/crew-worker/CrewWorkerCentralDetailScreen.vue](../../app/components/crew-worker/CrewWorkerCentralDetailScreen.vue) |
| `/base/worker/:id` view | worker / default | section/WorkerDetailProfile · WorkerDetailProfile | 不适用 / desktop-sqlite | [app/components/worker/WorkerDetailScreen.vue](../../app/components/worker/WorkerDetailScreen.vue) |
| `/base/worker/:id` view | worker / default | section/WorkerDetailProjects · WorkerDetailProjects | 不适用 / desktop-sqlite | [app/components/worker/WorkerDetailScreen.vue](../../app/components/worker/WorkerDetailScreen.vue) |
| `/base/worker/:id` view | worker / default | section/WorkerDetailLaborFacts · WorkerDetailLaborFacts | 不适用 / desktop-sqlite | [app/components/worker/WorkerDetailScreen.vue](../../app/components/worker/WorkerDetailScreen.vue) |
| `/base/worker/:id` view | worker / default | section/WorkerDetailAside · WorkerDetailAside | 不适用 / desktop-sqlite | [app/components/worker/WorkerDetailScreen.vue](../../app/components/worker/WorkerDetailScreen.vue) |
| `/base/worker/form` new | worker / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/base/worker/form/[[id]].vue](../../app/pages/base/worker/form/[[id]].vue) |
| `/base/worker/form/:id` edit | worker / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/base/worker/form/[[id]].vue](../../app/pages/base/worker/form/[[id]].vue) |
| `/base/worker` view | worker / default | page · 列表 | central-http / desktop-sqlite | [app/pages/base/worker/index.vue](../../app/pages/base/worker/index.vue) |

### 分供方（#407）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/base/supplier/:id` view | supplier / default | page · 详情 | central-http / central-http | [app/pages/base/supplier/[id].vue](../../app/pages/base/supplier/[id].vue) |
| `/base/supplier/:id` view | supplier / default | tab/overview · overview | central-http / central-http | [app/components/supplier/SupplierDetailScreen.vue](../../app/components/supplier/SupplierDetailScreen.vue) |
| `/base/supplier/:id` view | supplier / default | tab/projects · projects | central-http / central-http | [app/components/supplier/SupplierDetailScreen.vue](../../app/components/supplier/SupplierDetailScreen.vue) |
| `/base/supplier/:id` view | supplier / default | tab/contracts · contracts | central-http / central-http | [app/components/supplier/SupplierDetailScreen.vue](../../app/components/supplier/SupplierDetailScreen.vue) |
| `/base/supplier/:id` view | supplier / default | tab/settlements · settlements | central-http / central-http | [app/components/supplier/SupplierDetailScreen.vue](../../app/components/supplier/SupplierDetailScreen.vue) |
| `/base/supplier/:id` view | supplier / default | tab/invoices · invoices | central-http / central-http | [app/components/supplier/SupplierDetailScreen.vue](../../app/components/supplier/SupplierDetailScreen.vue) |
| `/base/supplier/:id` view | supplier / default | tab/payments · payments | central-http / central-http | [app/components/supplier/SupplierDetailScreen.vue](../../app/components/supplier/SupplierDetailScreen.vue) |
| `/base/supplier/:id` view | supplier / default | tab/projects/table · table | central-http / central-http | [app/components/supplier/SupplierFactTable.vue](../../app/components/supplier/SupplierFactTable.vue) |
| `/base/supplier/:id` view | supplier / default | tab/contracts/table · table | central-http / central-http | [app/components/supplier/SupplierFactTable.vue](../../app/components/supplier/SupplierFactTable.vue) |
| `/base/supplier/:id` view | supplier / default | tab/settlements/table · table | central-http / central-http | [app/components/supplier/SupplierFactTable.vue](../../app/components/supplier/SupplierFactTable.vue) |
| `/base/supplier/:id` view | supplier / default | tab/invoices/table · table | central-http / central-http | [app/components/supplier/SupplierFactTable.vue](../../app/components/supplier/SupplierFactTable.vue) |
| `/base/supplier/:id` view | supplier / default | tab/payments/table · table | central-http / central-http | [app/components/supplier/SupplierFactTable.vue](../../app/components/supplier/SupplierFactTable.vue) |
| `/base/supplier/credential/:id` view | supplier / default | page · 详情 | credential-browser / desktop-sqlite | [app/pages/base/supplier/credential/[id].vue](../../app/pages/base/supplier/credential/[id].vue) |
| `/base/supplier/form` new | supplier / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/base/supplier/form/[[id]].vue](../../app/pages/base/supplier/form/[[id]].vue) |
| `/base/supplier/form/:id` edit | supplier / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/base/supplier/form/[[id]].vue](../../app/pages/base/supplier/form/[[id]].vue) |
| `/base/supplier` view | supplier / default | page · 列表 | central-http / central-http | [app/pages/base/supplier/index.vue](../../app/pages/base/supplier/index.vue) |

### 项目分供方（#408）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/project/:pid/supplier/:sid` view | project.supplier / default | page · 详情 | central-http / central-http | [app/pages/project/[pid]/supplier/[sid].vue](../../app/pages/project/[pid]/supplier/[sid].vue) |
| `/project/:pid/supplier/:sid` view | project.supplier / default | tab/overview · overview | central-http / central-http | [app/components/project-supplier/ProjectSupplierWorkbench.vue](../../app/components/project-supplier/ProjectSupplierWorkbench.vue) |
| `/project/:pid/supplier/:sid` view | project.supplier / default | tab/contract · contract | central-http / central-http | [app/components/project-supplier/ProjectSupplierWorkbench.vue](../../app/components/project-supplier/ProjectSupplierWorkbench.vue) |
| `/project/:pid/supplier/:sid` view | project.supplier / default | tab/claim · claim | central-http / central-http | [app/components/project-supplier/ProjectSupplierWorkbench.vue](../../app/components/project-supplier/ProjectSupplierWorkbench.vue) |
| `/project/:pid/supplier/:sid` view | project.supplier / default | tab/ticket · ticket | central-http / central-http | [app/components/project-supplier/ProjectSupplierWorkbench.vue](../../app/components/project-supplier/ProjectSupplierWorkbench.vue) |
| `/project/:pid/supplier/:sid` view | project.supplier / default | tab/payment · payment | central-http / central-http | [app/components/project-supplier/ProjectSupplierWorkbench.vue](../../app/components/project-supplier/ProjectSupplierWorkbench.vue) |
| `/project/:pid/supplier/:sid` view | project.supplier / default | tab/settlement · settlement | central-http / central-http | [app/components/project-supplier/ProjectSupplierWorkbench.vue](../../app/components/project-supplier/ProjectSupplierWorkbench.vue) |
| `/project/:pid/supplier/:sid` view | project.supplier / default | files · files | central-http / central-http | [app/components/project-supplier/ProjectSupplierWorkbench.vue](../../app/components/project-supplier/ProjectSupplierWorkbench.vue) |
| `/project/:pid/supplier/import` view | project.supplier.import / default | page · 特殊工具 | central-http / central-http | [app/pages/project/[pid]/supplier/import.vue](../../app/pages/project/[pid]/supplier/import.vue) |
| `/project/:pid/supplier/import` view | project.supplier.import / default | step/files · files | central-http / central-http | [app/components/project-supplier/ProjectSupplierImportWizard.vue](../../app/components/project-supplier/ProjectSupplierImportWizard.vue) |
| `/project/:pid/supplier/import` view | project.supplier.import / default | step/classify · classify | central-http / central-http | [app/components/project-supplier/ProjectSupplierImportWizard.vue](../../app/components/project-supplier/ProjectSupplierImportWizard.vue) |
| `/project/:pid/supplier/import` view | project.supplier.import / default | step/confirm · confirm | central-http / central-http | [app/components/project-supplier/ProjectSupplierImportWizard.vue](../../app/components/project-supplier/ProjectSupplierImportWizard.vue) |

### 核心合同（#409）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | page · 详情 | central-http / 不适用 | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/info · info | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/supplements · supplements | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/changes · changes | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/settlements · settlements | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/invoices · invoices | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/receipts · receipts | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/acceptance · acceptance | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/supplements/table/supplements · supplements | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/changes/table/changes · changes | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/settlements/table/monthlyStatements · monthlyStatements | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/settlements/table/finalSettlements · finalSettlements | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/settlements/table/penalties · penalties | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/invoices/table/applications · applications | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/invoices/table/registrations · registrations | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/receipts/table/receipts · receipts | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/acceptance/table/acceptances · acceptances | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/acceptance/table/warranties · warranties | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=construction&origin=:origin` view | construction / central | tab/info/files · files | central-http / 不适用 | [app/components/contract/ConstructionContractDetailScreen.vue](../../app/components/contract/ConstructionContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | page · 详情 | central-http / 不适用 | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/info · info | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/lines · lines | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/materials · materials | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/invoices · invoices | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/payments · payments | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/settlements · settlements | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/penalties · penalties | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/materials/table/requisitions · requisitions | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/materials/table/arrivals · arrivals | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/materials/table/directTransfers · directTransfers | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/materials/table/outbound · outbound | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/lines/table · table | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/invoices/table · table | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/payments/table · table | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/settlements/table · table | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/penalties/table · table | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=material&origin=:origin` view | material / central | tab/info/files · files | central-http / 不适用 | [app/components/contract/MaterialContractDetailScreen.vue](../../app/components/contract/MaterialContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | page · 详情 | central-http / 不适用 | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/info · info | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/changes · changes | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/invoices · invoices | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/payments · payments | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/settlements · settlements | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/penalties · penalties | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/material-uses · material-uses | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/changes/table/supplements · supplements | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/changes/table/changes · changes | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/invoices/table/invoices · invoices | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/payments/table/applications · applications | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/payments/table/records · records | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/settlements/table/progress · progress | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/settlements/table/completion · completion | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/penalties/table/penalties · penalties | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/info/files · files | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id?contractKind=subcontract&origin=:origin` view | subcontract / central | tab/material-uses/unlinked · unlinked | central-http / 不适用 | [app/components/contract/SubcontractContractDetailScreen.vue](../../app/components/contract/SubcontractContractDetailScreen.vue) |
| `/contract/:id` view | 施工 / legacy | page · 详情 | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id` view | 施工 / legacy | tab/info · info | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id` view | 施工 / legacy | tab/documents · documents | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id` view | 施工 / legacy | tab/files · files | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id` view | 分包 / legacy | page · 详情 | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id` view | 分包 / legacy | tab/info · info | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id` view | 分包 / legacy | tab/documents · documents | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id` view | 分包 / legacy | tab/files · files | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id` view | 材采 / legacy | page · 详情 | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id` view | 材采 / legacy | tab/info · info | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id` view | 材采 / legacy | tab/documents · documents | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id` view | 材采 / legacy | tab/files · files | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/:id` view | 材采 / legacy | tab/lines · lines | browser-local / desktop-sqlite | [app/pages/contract/[id].vue](../../app/pages/contract/[id].vue) |
| `/contract/boq/import` view | boq / format-A | page · 特殊工具 | browser-local / desktop-sqlite | [app/pages/contract/boq/import.vue](../../app/pages/contract/boq/import.vue) |
| `/contract/boq/import` view | boq / format-A | step/upload · upload | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-A | step/confirm · confirm | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-A | step/preview · preview | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-A | step/preview/table · table | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-A | state/requiresReview · requiresReview | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-A | state/mappingError · mappingError | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-A | state/parseError · parseError | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-B | page · 特殊工具 | browser-local / desktop-sqlite | [app/pages/contract/boq/import.vue](../../app/pages/contract/boq/import.vue) |
| `/contract/boq/import` view | boq / format-B | step/upload · upload | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-B | step/confirm · confirm | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-B | step/preview · preview | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-B | step/preview/table · table | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-B | state/requiresReview · requiresReview | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-B | state/mappingError · mappingError | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-B | state/parseError · parseError | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-C | page · 特殊工具 | browser-local / desktop-sqlite | [app/pages/contract/boq/import.vue](../../app/pages/contract/boq/import.vue) |
| `/contract/boq/import` view | boq / format-C | step/upload · upload | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-C | step/confirm · confirm | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-C | step/preview · preview | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-C | step/preview/table · table | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-C | state/requiresReview · requiresReview | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-C | state/mappingError · mappingError | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-C | state/parseError · parseError | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-D | page · 特殊工具 | browser-local / desktop-sqlite | [app/pages/contract/boq/import.vue](../../app/pages/contract/boq/import.vue) |
| `/contract/boq/import` view | boq / format-D | step/upload · upload | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-D | step/confirm · confirm | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-D | step/preview · preview | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-D | step/preview/table · table | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-D | state/requiresReview · requiresReview | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-D | state/mappingError · mappingError | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-D | state/parseError · parseError | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-E | page · 特殊工具 | browser-local / desktop-sqlite | [app/pages/contract/boq/import.vue](../../app/pages/contract/boq/import.vue) |
| `/contract/boq/import` view | boq / format-E | step/upload · upload | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-E | step/confirm · confirm | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-E | step/preview · preview | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-E | step/preview/table · table | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-E | state/requiresReview · requiresReview | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-E | state/mappingError · mappingError | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq/import` view | boq / format-E | state/parseError · parseError | browser-local / desktop-sqlite | [app/components/boq/BoqImportWizard.vue](../../app/components/boq/BoqImportWizard.vue) |
| `/contract/boq` view | contract.boq / default | page · 工作台 | browser-local / desktop-sqlite | [app/pages/contract/boq/index.vue](../../app/pages/contract/boq/index.vue) |
| `/contract/boq` view | contract.boq / default | tab/lines · lines | browser-local / desktop-sqlite | [app/components/boq/BoqWorkspace.vue](../../app/components/boq/BoqWorkspace.vue) |
| `/contract/boq` view | contract.boq / default | tab/changes · changes | browser-local / desktop-sqlite | [app/components/boq/BoqWorkspace.vue](../../app/components/boq/BoqWorkspace.vue) |
| `/contract/boq` view | contract.boq / default | tab/monthly · monthly | browser-local / desktop-sqlite | [app/components/boq/BoqWorkspace.vue](../../app/components/boq/BoqWorkspace.vue) |
| `/contract/boq` view | contract.boq / default | workspace/BoqCatalogTree · BoqCatalogTree | browser-local / desktop-sqlite | [app/components/boq/BoqWorkspace.vue](../../app/components/boq/BoqWorkspace.vue) |
| `/contract/boq` view | contract.boq / default | workspace/BoqLinesTable · BoqLinesTable | browser-local / desktop-sqlite | [app/components/boq/BoqWorkspace.vue](../../app/components/boq/BoqWorkspace.vue) |
| `/contract/boq` view | contract.boq / default | workspace/BoqChangeWorkspace · BoqChangeWorkspace | browser-local / desktop-sqlite | [app/components/boq/BoqWorkspace.vue](../../app/components/boq/BoqWorkspace.vue) |
| `/contract/boq` view | contract.boq / default | workspace/BoqMonthlyWorkspace · BoqMonthlyWorkspace | browser-local / desktop-sqlite | [app/components/boq/BoqWorkspace.vue](../../app/components/boq/BoqWorkspace.vue) |
| `/contract/construction/form/:id` edit | construction / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/contract/construction/form/[id].vue](../../app/pages/contract/construction/form/[id].vue) |
| `/contract/construction/form` new | construction / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/contract/construction/form/index.vue](../../app/pages/contract/construction/form/index.vue) |
| `/contract/construction` view | construction / default | page · 列表 | central-http / desktop-sqlite | [app/pages/contract/construction/index.vue](../../app/pages/contract/construction/index.vue) |
| `/contract/material/form/:id` edit | material / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/contract/material/form/[id].vue](../../app/pages/contract/material/form/[id].vue) |
| `/contract/material/form` new | material / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/contract/material/form/index.vue](../../app/pages/contract/material/form/index.vue) |
| `/contract/material` view | material / default | page · 列表 | central-http / desktop-sqlite | [app/pages/contract/material/index.vue](../../app/pages/contract/material/index.vue) |
| `/contract/subcontract/form/:id` edit | subcontract / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/contract/subcontract/form/[id].vue](../../app/pages/contract/subcontract/form/[id].vue) |
| `/contract/subcontract/form` new | subcontract / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/contract/subcontract/form/index.vue](../../app/pages/contract/subcontract/form/index.vue) |
| `/contract/subcontract` view | subcontract / default | page · 列表 | central-http / desktop-sqlite | [app/pages/contract/subcontract/index.vue](../../app/pages/contract/subcontract/index.vue) |

### 辅助合同与结算（#409）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/contract/other-expense/:id` view | other_expense / default | page · 详情 | central-http / central-http | [app/pages/contract/other-expense/[id].vue](../../app/pages/contract/other-expense/[id].vue) |
| `/contract/other-expense/:id` view | other_expense / default | tab/info · info | central-http / central-http | [app/components/contract/AuxiliaryContractDetailScreen.vue](../../app/components/contract/AuxiliaryContractDetailScreen.vue) |
| `/contract/other-expense/:id` view | other_expense / default | tab/invoice · invoice | central-http / central-http | [app/components/contract/AuxiliaryContractDetailScreen.vue](../../app/components/contract/AuxiliaryContractDetailScreen.vue) |
| `/contract/other-expense/:id` view | other_expense / default | tab/payment · payment | central-http / central-http | [app/components/contract/AuxiliaryContractDetailScreen.vue](../../app/components/contract/AuxiliaryContractDetailScreen.vue) |
| `/contract/other-expense/:id` view | other_expense / default | tab/settlement · settlement | central-http / central-http | [app/components/contract/AuxiliaryContractDetailScreen.vue](../../app/components/contract/AuxiliaryContractDetailScreen.vue) |
| `/contract/other-expense/:id` view | other_expense / default | tab/supplement · supplement | central-http / central-http | [app/components/contract/AuxiliaryContractDetailScreen.vue](../../app/components/contract/AuxiliaryContractDetailScreen.vue) |
| `/contract/company-expense/:id` view | company_expense / default | page · 详情 | central-http / central-http | [app/pages/contract/company-expense/[id].vue](../../app/pages/contract/company-expense/[id].vue) |
| `/contract/company-expense/:id` view | company_expense / default | tab/info · info | central-http / central-http | [app/components/contract/AuxiliaryContractDetailScreen.vue](../../app/components/contract/AuxiliaryContractDetailScreen.vue) |
| `/contract/company-expense/:id` view | company_expense / default | tab/invoice · invoice | central-http / central-http | [app/components/contract/AuxiliaryContractDetailScreen.vue](../../app/components/contract/AuxiliaryContractDetailScreen.vue) |
| `/contract/company-expense/:id` view | company_expense / default | tab/payment · payment | central-http / central-http | [app/components/contract/AuxiliaryContractDetailScreen.vue](../../app/components/contract/AuxiliaryContractDetailScreen.vue) |
| `/contract/company-expense/form/:id` edit | company_expense / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/contract/company-expense/form/[id].vue](../../app/pages/contract/company-expense/form/[id].vue) |
| `/contract/company-expense/form` new | company_expense / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/contract/company-expense/form/index.vue](../../app/pages/contract/company-expense/form/index.vue) |
| `/contract/company-expense` view | company_expense / default | page · 列表 | central-http / desktop-sqlite | [app/pages/contract/company-expense/index.vue](../../app/pages/contract/company-expense/index.vue) |
| `/contract/other-expense/form/:id` edit | other_expense / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/contract/other-expense/form/[id].vue](../../app/pages/contract/other-expense/form/[id].vue) |
| `/contract/other-expense/form` new | other_expense / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/contract/other-expense/form/index.vue](../../app/pages/contract/other-expense/form/index.vue) |
| `/contract/other-expense` view | other_expense / default | page · 列表 | central-http / desktop-sqlite | [app/pages/contract/other-expense/index.vue](../../app/pages/contract/other-expense/index.vue) |
| `/contract/other-settlement/form/:id` edit | other_settlement / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/contract/other-settlement/form/[id].vue](../../app/pages/contract/other-settlement/form/[id].vue) |
| `/contract/other-settlement/form` new | other_settlement / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/contract/other-settlement/form/index.vue](../../app/pages/contract/other-settlement/form/index.vue) |
| `/contract/other-settlement/:id` view | other_settlement / default | page · 详情 | central-http / central-http | [app/pages/contract/other-settlement/[id].vue](../../app/pages/contract/other-settlement/[id].vue) |
| `/contract/other-settlement/:id` view | other_settlement / default | tab/info · info | central-http / central-http | [app/components/other-settlement/OtherSettlementDetailScreen.vue](../../app/components/other-settlement/OtherSettlementDetailScreen.vue) |
| `/contract/other-settlement/:id` view | other_settlement / default | tab/penalty · penalty | central-http / central-http | [app/components/other-settlement/OtherSettlementDetailScreen.vue](../../app/components/other-settlement/OtherSettlementDetailScreen.vue) |
| `/contract/other-settlement/:id` view | other_settlement / default | tab/application · application | central-http / central-http | [app/components/other-settlement/OtherSettlementDetailScreen.vue](../../app/components/other-settlement/OtherSettlementDetailScreen.vue) |
| `/contract/other-settlement/:id` view | other_settlement / default | tab/payment · payment | central-http / central-http | [app/components/other-settlement/OtherSettlementDetailScreen.vue](../../app/components/other-settlement/OtherSettlementDetailScreen.vue) |
| `/contract/other-settlement/:id` view | other_settlement / default | facts/source-detail · source-detail | central-http / central-http | [app/components/other-settlement/OtherSettlementFacts.vue](../../app/components/other-settlement/OtherSettlementFacts.vue) |
| `/contract/other-settlement` view | other_settlement / default | page · 列表 | central-http / desktop-sqlite | [app/pages/contract/other-settlement/index.vue](../../app/pages/contract/other-settlement/index.vue) |
| `/material/settlement/form/:id` edit | material_settlement / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/material/settlement/form/[id].vue](../../app/pages/material/settlement/form/[id].vue) |
| `/material/settlement/form` new | material_settlement / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/material/settlement/form/index.vue](../../app/pages/material/settlement/form/index.vue) |
| `/material/settlement` view | material_settlement / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/material/settlement/index.vue](../../app/pages/material/settlement/index.vue) |

### 甲方单据（#410）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/owner/change/:id` view | owner_change / default | page · 详情 | central-http / desktop-sqlite | [app/pages/owner/[kind]/[id].vue](../../app/pages/owner/[kind]/[id].vue) |
| `/owner/change/:id` view | owner_change / default | table/lines · lines | central-http / 不适用 | [app/components/owner-document/OwnerCommercialDocumentDetailScreen.vue](../../app/components/owner-document/OwnerCommercialDocumentDetailScreen.vue) |
| `/owner/change/:id` view | owner_change / default | desktop/form · form | 不适用 / desktop-sqlite | [app/pages/owner/[kind]/[id].vue](../../app/pages/owner/[kind]/[id].vue) |
| `/owner/report/:id` view | owner_report / default | page · 详情 | central-http / desktop-sqlite | [app/pages/owner/[kind]/[id].vue](../../app/pages/owner/[kind]/[id].vue) |
| `/owner/report/:id` view | owner_report / default | table/lines · lines | central-http / 不适用 | [app/components/owner-document/OwnerCommercialDocumentDetailScreen.vue](../../app/components/owner-document/OwnerCommercialDocumentDetailScreen.vue) |
| `/owner/report/:id` view | owner_report / default | desktop/form · form | 不适用 / desktop-sqlite | [app/pages/owner/[kind]/[id].vue](../../app/pages/owner/[kind]/[id].vue) |
| `/owner/acceptance/:id` view | acceptance / default | page · 详情 | central-http / desktop-sqlite | [app/pages/owner/[kind]/[id].vue](../../app/pages/owner/[kind]/[id].vue) |
| `/owner/acceptance/:id` view | acceptance / default | tab/acceptance · acceptance | central-http / 不适用 | [app/components/owner-document/OwnerAcceptanceDetailScreen.vue](../../app/components/owner-document/OwnerAcceptanceDetailScreen.vue) |
| `/owner/acceptance/:id` view | acceptance / default | tab/warranty · warranty | central-http / 不适用 | [app/components/owner-document/OwnerAcceptanceDetailScreen.vue](../../app/components/owner-document/OwnerAcceptanceDetailScreen.vue) |
| `/owner/acceptance/:id` view | acceptance / default | section/OwnerAcceptanceFactsPanel · OwnerAcceptanceFactsPanel | central-http / 不适用 | [app/components/owner-document/OwnerAcceptanceDetailScreen.vue](../../app/components/owner-document/OwnerAcceptanceDetailScreen.vue) |
| `/owner/acceptance/:id` view | acceptance / default | section/OwnerAcceptanceFilesPanel · OwnerAcceptanceFilesPanel | central-http / 不适用 | [app/components/owner-document/OwnerAcceptanceDetailScreen.vue](../../app/components/owner-document/OwnerAcceptanceDetailScreen.vue) |
| `/owner/acceptance/:id` view | acceptance / default | section/OwnerAcceptanceAuditPanel · OwnerAcceptanceAuditPanel | central-http / 不适用 | [app/components/owner-document/OwnerAcceptanceDetailScreen.vue](../../app/components/owner-document/OwnerAcceptanceDetailScreen.vue) |
| `/owner/acceptance/:id` view | acceptance / default | desktop/form · form | 不适用 / desktop-sqlite | [app/pages/owner/[kind]/[id].vue](../../app/pages/owner/[kind]/[id].vue) |
| `/owner/acceptance/:id?variant=warranty` view | acceptance / warranty | page · 详情 | central-http / desktop-sqlite | [app/pages/owner/[kind]/[id].vue](../../app/pages/owner/[kind]/[id].vue) |
| `/owner/acceptance/:id?variant=warranty` view | acceptance / warranty | tab/acceptance · acceptance | central-http / 不适用 | [app/components/owner-document/OwnerAcceptanceDetailScreen.vue](../../app/components/owner-document/OwnerAcceptanceDetailScreen.vue) |
| `/owner/acceptance/:id?variant=warranty` view | acceptance / warranty | tab/warranty · warranty | central-http / 不适用 | [app/components/owner-document/OwnerAcceptanceDetailScreen.vue](../../app/components/owner-document/OwnerAcceptanceDetailScreen.vue) |
| `/owner/acceptance/:id?variant=warranty` view | acceptance / warranty | section/OwnerAcceptanceFactsPanel · OwnerAcceptanceFactsPanel | central-http / 不适用 | [app/components/owner-document/OwnerAcceptanceDetailScreen.vue](../../app/components/owner-document/OwnerAcceptanceDetailScreen.vue) |
| `/owner/acceptance/:id?variant=warranty` view | acceptance / warranty | section/OwnerAcceptanceFilesPanel · OwnerAcceptanceFilesPanel | central-http / 不适用 | [app/components/owner-document/OwnerAcceptanceDetailScreen.vue](../../app/components/owner-document/OwnerAcceptanceDetailScreen.vue) |
| `/owner/acceptance/:id?variant=warranty` view | acceptance / warranty | section/OwnerAcceptanceAuditPanel · OwnerAcceptanceAuditPanel | central-http / 不适用 | [app/components/owner-document/OwnerAcceptanceDetailScreen.vue](../../app/components/owner-document/OwnerAcceptanceDetailScreen.vue) |
| `/owner/acceptance/:id?variant=warranty` view | acceptance / warranty | desktop/form · form | 不适用 / desktop-sqlite | [app/pages/owner/[kind]/[id].vue](../../app/pages/owner/[kind]/[id].vue) |
| `/owner/final-settlement/:id` view | final_settlement / default | page · 详情 | central-http / desktop-sqlite | [app/pages/owner/[kind]/[id].vue](../../app/pages/owner/[kind]/[id].vue) |
| `/owner/final-settlement/:id` view | final_settlement / default | section/OwnerFinalSettlementFactsPanel · OwnerFinalSettlementFactsPanel | central-http / 不适用 | [app/components/owner-document/OwnerFinalSettlementDetailScreen.vue](../../app/components/owner-document/OwnerFinalSettlementDetailScreen.vue) |
| `/owner/final-settlement/:id` view | final_settlement / default | section/OwnerFinalSettlementSourceTable · OwnerFinalSettlementSourceTable | central-http / 不适用 | [app/components/owner-document/OwnerFinalSettlementDetailScreen.vue](../../app/components/owner-document/OwnerFinalSettlementDetailScreen.vue) |
| `/owner/final-settlement/:id` view | final_settlement / default | section/OwnerAcceptanceFilesPanel · OwnerAcceptanceFilesPanel | central-http / 不适用 | [app/components/owner-document/OwnerFinalSettlementDetailScreen.vue](../../app/components/owner-document/OwnerFinalSettlementDetailScreen.vue) |
| `/owner/final-settlement/:id` view | final_settlement / default | desktop/form · form | 不适用 / desktop-sqlite | [app/pages/owner/[kind]/[id].vue](../../app/pages/owner/[kind]/[id].vue) |
| `/owner/penalty/:id` view | owner_penalty / default | page · 详情 | central-http / desktop-sqlite | [app/pages/owner/[kind]/[id].vue](../../app/pages/owner/[kind]/[id].vue) |
| `/owner/penalty/:id` view | owner_penalty / default | section/OwnerPenaltyFactsPanel · OwnerPenaltyFactsPanel | central-http / 不适用 | [app/components/owner-document/OwnerPenaltyDetailScreen.vue](../../app/components/owner-document/OwnerPenaltyDetailScreen.vue) |
| `/owner/penalty/:id` view | owner_penalty / default | section/OwnerAcceptanceFilesPanel · OwnerAcceptanceFilesPanel | central-http / 不适用 | [app/components/owner-document/OwnerPenaltyDetailScreen.vue](../../app/components/owner-document/OwnerPenaltyDetailScreen.vue) |
| `/owner/penalty/:id` view | owner_penalty / default | desktop/form · form | 不适用 / desktop-sqlite | [app/pages/owner/[kind]/[id].vue](../../app/pages/owner/[kind]/[id].vue) |
| `/owner/change/form/:id` edit | owner_change / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/owner/[kind]/form/[id].vue](../../app/pages/owner/[kind]/form/[id].vue) |
| `/owner/change/form/:id` edit | owner_change / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/change/form/:id` edit | owner_change / default | section/lines · lines | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/change/form/:id` edit | owner_change / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/report/form/:id` edit | owner_report / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/owner/[kind]/form/[id].vue](../../app/pages/owner/[kind]/form/[id].vue) |
| `/owner/report/form/:id` edit | owner_report / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/report/form/:id` edit | owner_report / default | section/lines · lines | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/report/form/:id` edit | owner_report / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/acceptance/form/:id` edit | acceptance / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/owner/[kind]/form/[id].vue](../../app/pages/owner/[kind]/form/[id].vue) |
| `/owner/acceptance/form/:id` edit | acceptance / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/acceptance/form/:id` edit | acceptance / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/final-settlement/form/:id` edit | final_settlement / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/owner/[kind]/form/[id].vue](../../app/pages/owner/[kind]/form/[id].vue) |
| `/owner/final-settlement/form/:id` edit | final_settlement / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/final-settlement/form/:id` edit | final_settlement / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/penalty/form/:id` edit | owner_penalty / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/owner/[kind]/form/[id].vue](../../app/pages/owner/[kind]/form/[id].vue) |
| `/owner/penalty/form/:id` edit | owner_penalty / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/penalty/form/:id` edit | owner_penalty / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/change` view | owner_change / default | page · 列表 | central-http / desktop-sqlite | [app/pages/owner/[kind]/index.vue](../../app/pages/owner/[kind]/index.vue) |
| `/owner/report` view | owner_report / default | page · 列表 | central-http / desktop-sqlite | [app/pages/owner/[kind]/index.vue](../../app/pages/owner/[kind]/index.vue) |
| `/owner/acceptance` view | acceptance / default | page · 列表 | central-http / desktop-sqlite | [app/pages/owner/[kind]/index.vue](../../app/pages/owner/[kind]/index.vue) |
| `/owner/acceptance?variant=warranty` view | acceptance / warranty | page · 列表 | central-http / desktop-sqlite | [app/pages/owner/[kind]/index.vue](../../app/pages/owner/[kind]/index.vue) |
| `/owner/final-settlement` view | final_settlement / default | page · 列表 | central-http / desktop-sqlite | [app/pages/owner/[kind]/index.vue](../../app/pages/owner/[kind]/index.vue) |
| `/owner/penalty` view | owner_penalty / default | page · 列表 | central-http / desktop-sqlite | [app/pages/owner/[kind]/index.vue](../../app/pages/owner/[kind]/index.vue) |
| `/owner/change/new` new | owner_change / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/owner/[kind]/new.vue](../../app/pages/owner/[kind]/new.vue) |
| `/owner/change/new` new | owner_change / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/change/new` new | owner_change / default | section/lines · lines | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/change/new` new | owner_change / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/report/new` new | owner_report / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/owner/[kind]/new.vue](../../app/pages/owner/[kind]/new.vue) |
| `/owner/report/new` new | owner_report / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/report/new` new | owner_report / default | section/lines · lines | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/report/new` new | owner_report / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/acceptance/new` new | acceptance / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/owner/[kind]/new.vue](../../app/pages/owner/[kind]/new.vue) |
| `/owner/acceptance/new` new | acceptance / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/acceptance/new` new | acceptance / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/final-settlement/new` new | final_settlement / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/owner/[kind]/new.vue](../../app/pages/owner/[kind]/new.vue) |
| `/owner/final-settlement/new` new | final_settlement / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/final-settlement/new` new | final_settlement / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/penalty/new` new | owner_penalty / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/owner/[kind]/new.vue](../../app/pages/owner/[kind]/new.vue) |
| `/owner/penalty/new` new | owner_penalty / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/owner/penalty/new` new | owner_penalty / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |

### 分包单据（#410）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/project/penalty/:id` view | project_penalty / default | page · 详情 | central-http / central-http | [app/pages/project/penalty/[id].vue](../../app/pages/project/penalty/[id].vue) |
| `/project/penalty/:id` view | project_penalty / default | history · history | central-http / central-http | [app/components/owner-document/ProjectPenaltyDetailScreen.vue](../../app/components/owner-document/ProjectPenaltyDetailScreen.vue) |
| `/project/penalty/:id` view | project_penalty / default | files · files | central-http / central-http | [app/components/owner-document/ProjectPenaltyDetailScreen.vue](../../app/components/owner-document/ProjectPenaltyDetailScreen.vue) |
| `/project/penalty/:id?ownerKind=crew&ownerId=:ownerId&origin=:origin` view | project_penalty / central-source | page · 详情 | central-http / central-http | [app/pages/project/penalty/[id].vue](../../app/pages/project/penalty/[id].vue) |
| `/project/penalty/:id?ownerKind=worker&ownerId=:ownerId&origin=:origin` view | project_penalty / central-source | page · 详情 | central-http / central-http | [app/pages/project/penalty/[id].vue](../../app/pages/project/penalty/[id].vue) |
| `/project/penalty/form/:id` edit | project_penalty / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/project/penalty/form/[id].vue](../../app/pages/project/penalty/form/[id].vue) |
| `/project/penalty` view | project_penalty / default | page · 列表 | central-http / desktop-sqlite | [app/pages/project/penalty/index.vue](../../app/pages/project/penalty/index.vue) |
| `/project/penalty/new` new | project_penalty / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/project/penalty/new.vue](../../app/pages/project/penalty/new.vue) |
| `/subcontract/change/:id` view | sub_change / default | page · 详情 | central-http / desktop-sqlite | [app/pages/subcontract/[kind]/[id].vue](../../app/pages/subcontract/[kind]/[id].vue) |
| `/subcontract/change/:id` view | sub_change / default | section/basic · basic | central-http / 不适用 | [app/components/owner-document/SubcontractChangeDetailScreen.vue](../../app/components/owner-document/SubcontractChangeDetailScreen.vue) |
| `/subcontract/change/:id` view | sub_change / default | files · files | central-http / 不适用 | [app/components/owner-document/SubcontractChangeDetailScreen.vue](../../app/components/owner-document/SubcontractChangeDetailScreen.vue) |
| `/subcontract/change/:id` view | sub_change / default | desktop/form · form | 不适用 / desktop-sqlite | [app/pages/subcontract/[kind]/[id].vue](../../app/pages/subcontract/[kind]/[id].vue) |
| `/subcontract/settlement/:id` view | sub_settlement / default | page · 详情 | central-http / desktop-sqlite | [app/pages/subcontract/[kind]/[id].vue](../../app/pages/subcontract/[kind]/[id].vue) |
| `/subcontract/settlement/:id` view | sub_settlement / default | section/basic · basic | central-http / 不适用 | [app/components/owner-document/SubcontractSettlementDetailScreen.vue](../../app/components/owner-document/SubcontractSettlementDetailScreen.vue) |
| `/subcontract/settlement/:id` view | sub_settlement / default | section/payment · payment | central-http / 不适用 | [app/components/owner-document/SubcontractSettlementDetailScreen.vue](../../app/components/owner-document/SubcontractSettlementDetailScreen.vue) |
| `/subcontract/settlement/:id` view | sub_settlement / default | section/files · files | central-http / 不适用 | [app/components/owner-document/SubcontractSettlementDetailScreen.vue](../../app/components/owner-document/SubcontractSettlementDetailScreen.vue) |
| `/subcontract/settlement/:id` view | sub_settlement / default | desktop/form · form | 不适用 / desktop-sqlite | [app/pages/subcontract/[kind]/[id].vue](../../app/pages/subcontract/[kind]/[id].vue) |
| `/subcontract/change/form/:id` edit | sub_change / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/subcontract/[kind]/form/[id].vue](../../app/pages/subcontract/[kind]/form/[id].vue) |
| `/subcontract/change/form/:id` edit | sub_change / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/subcontract/change/form/:id` edit | sub_change / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/subcontract/settlement/form/:id` edit | sub_settlement / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/subcontract/[kind]/form/[id].vue](../../app/pages/subcontract/[kind]/form/[id].vue) |
| `/subcontract/settlement/form/:id` edit | sub_settlement / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/subcontract/settlement/form/:id` edit | sub_settlement / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/subcontract/change` view | sub_change / default | page · 列表 | central-http / desktop-sqlite | [app/pages/subcontract/[kind]/index.vue](../../app/pages/subcontract/[kind]/index.vue) |
| `/subcontract/settlement` view | sub_settlement / default | page · 列表 | central-http / desktop-sqlite | [app/pages/subcontract/[kind]/index.vue](../../app/pages/subcontract/[kind]/index.vue) |
| `/subcontract/change/new` new | sub_change / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/subcontract/[kind]/new.vue](../../app/pages/subcontract/[kind]/new.vue) |
| `/subcontract/change/new` new | sub_change / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/subcontract/change/new` new | sub_change / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/subcontract/settlement/new` new | sub_settlement / default | page · 整页表单 | central-http / desktop-sqlite | [app/pages/subcontract/[kind]/new.vue](../../app/pages/subcontract/[kind]/new.vue) |
| `/subcontract/settlement/new` new | sub_settlement / default | section/basic · basic | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |
| `/subcontract/settlement/new` new | sub_settlement / default | section/attachments · attachments | central-http / desktop-sqlite | [app/lib/owner-document/page.ts](../../app/lib/owner-document/page.ts) |

### 自购材（#411）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/material/arrival/:id` edit | material.arrival / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/material/arrival/[id].vue](../../app/pages/material/arrival/[id].vue) |
| `/material/arrival` view | material.arrival / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/material/arrival/index.vue](../../app/pages/material/arrival/index.vue) |
| `/material/arrival/new` new | material.arrival / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/material/arrival/new.vue](../../app/pages/material/arrival/new.vue) |
| `/material/requisition/:id` edit | material.requisition / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/material/requisition/[id].vue](../../app/pages/material/requisition/[id].vue) |
| `/material/requisition` view | material.requisition / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/material/requisition/index.vue](../../app/pages/material/requisition/index.vue) |
| `/material/requisition/new` new | material.requisition / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/material/requisition/new.vue](../../app/pages/material/requisition/new.vue) |
| `/material/stock-check/:id` edit | material.stock-check / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/material/stock-check/[id].vue](../../app/pages/material/stock-check/[id].vue) |
| `/material/stock-check` view | material.stock-check / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/material/stock-check/index.vue](../../app/pages/material/stock-check/index.vue) |
| `/material/stock-check/new` new | material.stock-check / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/material/stock-check/new.vue](../../app/pages/material/stock-check/new.vue) |
| `/material/use/:id` edit | material.use / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/material/use/[id].vue](../../app/pages/material/use/[id].vue) |
| `/material/use` view | material.use / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/material/use/index.vue](../../app/pages/material/use/index.vue) |
| `/material/use/new` new | material.use / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/material/use/new.vue](../../app/pages/material/use/new.vue) |

### 甲供材（#411）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/owner-material/arrival/:id` edit | owner-material.arrival / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/owner-material/arrival/[id].vue](../../app/pages/owner-material/arrival/[id].vue) |
| `/owner-material/arrival` view | owner-material.arrival / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/owner-material/arrival/index.vue](../../app/pages/owner-material/arrival/index.vue) |
| `/owner-material/arrival/new` new | owner-material.arrival / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/owner-material/arrival/new.vue](../../app/pages/owner-material/arrival/new.vue) |
| `/owner-material/control/:id` edit | owner-material.control / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/owner-material/control/[id].vue](../../app/pages/owner-material/control/[id].vue) |
| `/owner-material/control` view | owner-material.control / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/owner-material/control/index.vue](../../app/pages/owner-material/control/index.vue) |
| `/owner-material/control/new` new | owner-material.control / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/owner-material/control/new.vue](../../app/pages/owner-material/control/new.vue) |
| `/owner-material/direct/:id` edit | owner-material.direct / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/owner-material/direct/[id].vue](../../app/pages/owner-material/direct/[id].vue) |
| `/owner-material/direct` view | owner-material.direct / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/owner-material/direct/index.vue](../../app/pages/owner-material/direct/index.vue) |
| `/owner-material/direct/new` new | owner-material.direct / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/owner-material/direct/new.vue](../../app/pages/owner-material/direct/new.vue) |
| `/owner-material/requisition/:id` edit | owner-material.requisition / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/owner-material/requisition/[id].vue](../../app/pages/owner-material/requisition/[id].vue) |
| `/owner-material/requisition` view | owner-material.requisition / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/owner-material/requisition/index.vue](../../app/pages/owner-material/requisition/index.vue) |
| `/owner-material/requisition/new` new | owner-material.requisition / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/owner-material/requisition/new.vue](../../app/pages/owner-material/requisition/new.vue) |
| `/owner-material/use/:id` edit | owner-material.use / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/owner-material/use/[id].vue](../../app/pages/owner-material/use/[id].vue) |
| `/owner-material/use` view | owner-material.use / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/owner-material/use/index.vue](../../app/pages/owner-material/use/index.vue) |
| `/owner-material/use/new` new | owner-material.use / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/owner-material/use/new.vue](../../app/pages/owner-material/use/new.vue) |

### 送货单闭环（#411）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/material/delivery/archive/:id` view | material.delivery.archive / default | page · 详情 | browser-local / desktop-sqlite | [app/pages/material/delivery/archive/[id].vue](../../app/pages/material/delivery/archive/[id].vue) |
| `/material/delivery/archive/form` new | material.delivery.archive / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/material/delivery/archive/form/[[id]].vue](../../app/pages/material/delivery/archive/form/[[id]].vue) |
| `/material/delivery/archive/form/:id` edit | material.delivery.archive / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/material/delivery/archive/form/[[id]].vue](../../app/pages/material/delivery/archive/form/[[id]].vue) |
| `/material/delivery/archive` view | material.delivery.archive / default | page · 工作台 | browser-local / desktop-sqlite | [app/pages/material/delivery/archive/index.vue](../../app/pages/material/delivery/archive/index.vue) |
| `/material/delivery` view | material.delivery / default | page · 工作台 | browser-local / desktop-sqlite | [app/pages/material/delivery/index.vue](../../app/pages/material/delivery/index.vue) |
| `/material/delivery` view | material.delivery / default | pane/queue · queue | browser-local / desktop-sqlite | [app/components/delivery/DeliveryRecognitionScreen.vue](../../app/components/delivery/DeliveryRecognitionScreen.vue) |
| `/material/delivery` view | material.delivery / default | pane/source · source | browser-local / desktop-sqlite | [app/components/delivery/DeliveryRecognitionScreen.vue](../../app/components/delivery/DeliveryRecognitionScreen.vue) |
| `/material/delivery` view | material.delivery / default | pane/review · review | browser-local / desktop-sqlite | [app/components/delivery/DeliveryRecognitionScreen.vue](../../app/components/delivery/DeliveryRecognitionScreen.vue) |
| `/material/delivery` view | material.delivery / default | duplicates · duplicates | browser-local / desktop-sqlite | [app/components/delivery/DeliveryRecognitionScreen.vue](../../app/components/delivery/DeliveryRecognitionScreen.vue) |
| `/material/delivery` view | material.delivery / default | pane/review/DeliveryDocumentFields · DeliveryDocumentFields | browser-local / desktop-sqlite | [app/components/delivery/DeliveryReviewPanel.vue](../../app/components/delivery/DeliveryReviewPanel.vue) |
| `/material/delivery` view | material.delivery / default | pane/review/DeliveryItemsEditor · DeliveryItemsEditor | browser-local / desktop-sqlite | [app/components/delivery/DeliveryReviewPanel.vue](../../app/components/delivery/DeliveryReviewPanel.vue) |

### 材料价格（#411）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/material/price` view | material.price / default | page · 特殊工具 | browser-local / desktop-sqlite | [app/pages/material/price.vue](../../app/pages/material/price.vue) |

### 收入财务（#413）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/finance/billing/:id` edit | billing / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/billing/[id].vue](../../app/pages/finance/billing/[id].vue) |
| `/finance/billing` view | billing / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/finance/billing/index.vue](../../app/pages/finance/billing/index.vue) |
| `/finance/billing/new` new | billing / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/billing/new.vue](../../app/pages/finance/billing/new.vue) |
| `/finance/current/:id` edit | current / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/current/[id].vue](../../app/pages/finance/current/[id].vue) |
| `/finance/current` view | current / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/finance/current/index.vue](../../app/pages/finance/current/index.vue) |
| `/finance/current/new` new | current / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/current/new.vue](../../app/pages/finance/current/new.vue) |
| `/finance/receipt/:id` view | receipt / default | page · 详情 | central-http / central-http | [app/pages/finance/receipt/[id].vue](../../app/pages/finance/receipt/[id].vue) |
| `/finance/receipt/form/:id` edit | receipt / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/receipt/form/[id].vue](../../app/pages/finance/receipt/form/[id].vue) |
| `/finance/receipt` view | receipt / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/finance/receipt/index.vue](../../app/pages/finance/receipt/index.vue) |
| `/finance/receipt/new` new | receipt / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/receipt/new.vue](../../app/pages/finance/receipt/new.vue) |

### 支出财务（#404/#413）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/finance/payment/:id` edit | payment / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/payment/[id].vue](../../app/pages/finance/payment/[id].vue) |
| `/finance/payment/:id/detail` view | payment / default | page · 详情 | browser-local / desktop-sqlite | [app/pages/finance/payment/[id]/detail.vue](../../app/pages/finance/payment/[id]/detail.vue) |
| `/finance/payment/:id/detail` view | payment / default | insight/PaymentApplicationInsightPanel · PaymentApplicationInsightPanel | browser-local / desktop-sqlite | [app/components/finance/PaymentApplicationDetailScreen.vue](../../app/components/finance/PaymentApplicationDetailScreen.vue) |
| `/finance/payment` view | payment / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/finance/payment/index.vue](../../app/pages/finance/payment/index.vue) |
| `/finance/payment/new` new | payment / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/payment/new.vue](../../app/pages/finance/payment/new.vue) |
| `/finance/payment-management` view | payment-management / default | page · 工作台 | browser-local / desktop-sqlite | [app/pages/finance/payment-management/index.vue](../../app/pages/finance/payment-management/index.vue) |
| `/finance/records/:id` edit | records / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/records/[id].vue](../../app/pages/finance/records/[id].vue) |
| `/finance/records` view | records / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/finance/records/index.vue](../../app/pages/finance/records/index.vue) |
| `/finance/records/new` new | records / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/records/new.vue](../../app/pages/finance/records/new.vue) |
| `/finance/reimbursement/:id` edit | reimbursement / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/reimbursement/[id].vue](../../app/pages/finance/reimbursement/[id].vue) |
| `/finance/reimbursement` view | reimbursement / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/finance/reimbursement/index.vue](../../app/pages/finance/reimbursement/index.vue) |
| `/finance/reimbursement/new` new | reimbursement / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/reimbursement/new.vue](../../app/pages/finance/reimbursement/new.vue) |

### 发票台账（#413/#414）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/finance/invoice/:id` edit | invoice / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/finance/invoice/[id].vue](../../app/pages/finance/invoice/[id].vue) |
| `/finance/invoice/factor` view | invoice / default | page · 特殊工具 | tool-local-storage / tool-local-storage | [app/pages/finance/invoice/factor.vue](../../app/pages/finance/invoice/factor.vue) |
| `/finance/invoice` view | invoice / review | page · 工作台 | browser-local / desktop-sqlite | [app/pages/finance/invoice/index.vue](../../app/pages/finance/invoice/index.vue) |
| `/finance/invoice` view | invoice / review | pane/queue · queue | browser-local / desktop-sqlite | [app/components/invoice/InvoiceWorkspaceScreen.vue](../../app/components/invoice/InvoiceWorkspaceScreen.vue) |
| `/finance/invoice` view | invoice / review | pane/source · source | browser-local / desktop-sqlite | [app/components/invoice/InvoiceWorkspaceScreen.vue](../../app/components/invoice/InvoiceWorkspaceScreen.vue) |
| `/finance/invoice` view | invoice / review | pane/review · review | browser-local / desktop-sqlite | [app/components/invoice/InvoiceWorkspaceScreen.vue](../../app/components/invoice/InvoiceWorkspaceScreen.vue) |
| `/finance/invoice` view | invoice / review | manual-entry · manual-entry | browser-local / desktop-sqlite | [app/components/invoice/InvoiceWorkspaceScreen.vue](../../app/components/invoice/InvoiceWorkspaceScreen.vue) |
| `/finance/invoice` view | invoice / review | pane/source/InvoiceOriginalPanel · InvoiceOriginalPanel | browser-local / desktop-sqlite | [app/components/invoice/InvoiceWorkspaceScreen.vue](../../app/components/invoice/InvoiceWorkspaceScreen.vue) |
| `/finance/invoice` view | invoice / review | pane/review/items · items | browser-local / desktop-sqlite | [app/components/invoice/InvoiceReviewForm.vue](../../app/components/invoice/InvoiceReviewForm.vue) |
| `/finance/invoice` view | invoice / print | page · 工作台 | browser-local / desktop-sqlite | [app/pages/finance/invoice/index.vue](../../app/pages/finance/invoice/index.vue) |
| `/finance/invoice` view | invoice / print | pane/queue · queue | browser-local / desktop-sqlite | [app/components/invoice/InvoiceWorkspaceScreen.vue](../../app/components/invoice/InvoiceWorkspaceScreen.vue) |
| `/finance/invoice` view | invoice / print | pane/source · source | browser-local / desktop-sqlite | [app/components/invoice/InvoiceWorkspaceScreen.vue](../../app/components/invoice/InvoiceWorkspaceScreen.vue) |
| `/finance/invoice` view | invoice / print | pane/review · review | browser-local / desktop-sqlite | [app/components/invoice/InvoiceWorkspaceScreen.vue](../../app/components/invoice/InvoiceWorkspaceScreen.vue) |
| `/finance/invoice` view | invoice / print | manual-entry · manual-entry | browser-local / desktop-sqlite | [app/components/invoice/InvoiceWorkspaceScreen.vue](../../app/components/invoice/InvoiceWorkspaceScreen.vue) |
| `/finance/invoice` view | invoice / print | pane/source/InvoicePrintLayout · InvoicePrintLayout | browser-local / desktop-sqlite | [app/components/invoice/InvoiceWorkspaceScreen.vue](../../app/components/invoice/InvoiceWorkspaceScreen.vue) |
| `/finance/invoice` view | invoice / print | pane/review/items · items | browser-local / desktop-sqlite | [app/components/invoice/InvoiceReviewForm.vue](../../app/components/invoice/InvoiceReviewForm.vue) |
| `/finance/ledger` view | ledger / default | page · 工作台 | browser-local / desktop-sqlite | [app/pages/finance/ledger.vue](../../app/pages/finance/ledger.vue) |

### 工程量与工资（#412）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/subcontract/attendance` view | subcontract.attendance / default | page · 工作台 | browser-local / desktop-sqlite | [app/pages/subcontract/attendance.vue](../../app/pages/subcontract/attendance.vue) |
| `/subcontract/daywork` view | subcontract.daywork / default | page · 工作台 | browser-local / desktop-sqlite | [app/pages/subcontract/daywork.vue](../../app/pages/subcontract/daywork.vue) |
| `/subcontract/payroll/:id` view | subcontract.payroll / default | page · 详情 | browser-local / desktop-sqlite | [app/pages/subcontract/payroll/[id].vue](../../app/pages/subcontract/payroll/[id].vue) |
| `/subcontract/payroll/:id` view | subcontract.payroll / default | table/PayrollStatementMembersTable · PayrollStatementMembersTable | browser-local / desktop-sqlite | [app/components/payroll/PayrollStatementDetailScreen.vue](../../app/components/payroll/PayrollStatementDetailScreen.vue) |
| `/subcontract/payroll/:id` view | subcontract.payroll / default | table/PayrollStatementLinesTable · PayrollStatementLinesTable | browser-local / desktop-sqlite | [app/components/payroll/PayrollStatementDetailScreen.vue](../../app/components/payroll/PayrollStatementDetailScreen.vue) |
| `/subcontract/payroll/:id` view | subcontract.payroll / default | table/daywork · daywork | browser-local / desktop-sqlite | [app/components/payroll/PayrollStatementDetailScreen.vue](../../app/components/payroll/PayrollStatementDetailScreen.vue) |
| `/subcontract/payroll/:id?ownerKind=crew&ownerId=:ownerId&origin=:origin` view | subcontract.payroll / central-source | page · 详情 | central-http / central-http | [app/pages/subcontract/payroll/[id].vue](../../app/pages/subcontract/payroll/[id].vue) |
| `/subcontract/payroll/:id?ownerKind=worker&ownerId=:ownerId&origin=:origin` view | subcontract.payroll / central-source | page · 详情 | central-http / central-http | [app/pages/subcontract/payroll/[id].vue](../../app/pages/subcontract/payroll/[id].vue) |
| `/subcontract/payroll` view | subcontract.payroll / default | page · 工作台 | browser-local / desktop-sqlite | [app/pages/subcontract/payroll/index.vue](../../app/pages/subcontract/payroll/index.vue) |
| `/subcontract/payroll` view | subcontract.payroll / default | workspace/PayrollStatementTable · PayrollStatementTable | browser-local / desktop-sqlite | [app/components/payroll/PayrollScreen.vue](../../app/components/payroll/PayrollScreen.vue) |
| `/subcontract/payroll` view | subcontract.payroll / default | workspace/PayrollStatementDetail · PayrollStatementDetail | browser-local / desktop-sqlite | [app/components/payroll/PayrollScreen.vue](../../app/components/payroll/PayrollScreen.vue) |
| `/subcontract/payroll` view | subcontract.payroll / default | embedded/lines · lines | browser-local / desktop-sqlite | [app/components/payroll/PayrollStatementDetail.vue](../../app/components/payroll/PayrollStatementDetail.vue) |
| `/subcontract/payroll` view | subcontract.payroll / default | dialog/PayrollReleaseAllocationDialog · PayrollReleaseAllocationDialog | browser-local / desktop-sqlite | [app/components/payroll/PayrollStatementDetail.vue](../../app/components/payroll/PayrollStatementDetail.vue) |
| `/subcontract/payroll` view | subcontract.payroll / default | print/PayrollPrintSheet · PayrollPrintSheet | browser-local / desktop-sqlite | [app/components/payroll/PayrollStatementDetail.vue](../../app/components/payroll/PayrollStatementDetail.vue) |
| `/subcontract/payroll/new` new | subcontract.payroll / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/subcontract/payroll/new.vue](../../app/pages/subcontract/payroll/new.vue) |
| `/subcontract/payroll/new` new | subcontract.payroll / default | section/basic · basic | browser-local / desktop-sqlite | [app/components/payroll/PayrollDraftFormPage.vue](../../app/components/payroll/PayrollDraftFormPage.vue) |
| `/subcontract/payroll/new` new | subcontract.payroll / default | section/source · source | browser-local / desktop-sqlite | [app/components/payroll/PayrollDraftFormPage.vue](../../app/components/payroll/PayrollDraftFormPage.vue) |
| `/subcontract/payroll/new` new | subcontract.payroll / default | section/members · members | browser-local / desktop-sqlite | [app/components/payroll/PayrollDraftFormPage.vue](../../app/components/payroll/PayrollDraftFormPage.vue) |
| `/subcontract/payroll/new` new | subcontract.payroll / default | section/audit · audit | browser-local / desktop-sqlite | [app/components/payroll/PayrollDraftFormPage.vue](../../app/components/payroll/PayrollDraftFormPage.vue) |
| `/subcontract/quantity/:pid/:uid` view | subcontract.quantity / default | page · 详情 | browser-local / desktop-sqlite | [app/pages/subcontract/quantity/[pid]/[uid].vue](../../app/pages/subcontract/quantity/[pid]/[uid].vue) |
| `/subcontract/quantity/:pid/:uid` view | subcontract.quantity / default | group/stage/quantities · quantities | browser-local / desktop-sqlite | [app/components/quantity/QuantityUnitDetailScreen.vue](../../app/components/quantity/QuantityUnitDetailScreen.vue) |
| `/subcontract/quantity/:pid/:uid` view | subcontract.quantity / default | group/stage/photos · photos | browser-local / desktop-sqlite | [app/components/quantity/QuantityUnitDetailScreen.vue](../../app/components/quantity/QuantityUnitDetailScreen.vue) |
| `/subcontract/quantity/:pid/:uid?ownerKind=crew&ownerId=:ownerId&origin=:origin` view | subcontract.quantity / central-source | page · 详情 | central-http / central-http | [app/pages/subcontract/quantity/[pid]/[uid].vue](../../app/pages/subcontract/quantity/[pid]/[uid].vue) |
| `/subcontract/quantity/:pid/:uid?ownerKind=worker&ownerId=:ownerId&origin=:origin` view | subcontract.quantity / central-source | page · 详情 | central-http / central-http | [app/pages/subcontract/quantity/[pid]/[uid].vue](../../app/pages/subcontract/quantity/[pid]/[uid].vue) |
| `/subcontract/quantity` view | quantity / trade | page · 工作台 | browser-local / desktop-sqlite | [app/pages/subcontract/quantity/index.vue](../../app/pages/subcontract/quantity/index.vue) |
| `/subcontract/quantity` view | quantity / trade | workspace/QuantityProgressCards · QuantityProgressCards | browser-local / desktop-sqlite | [app/components/quantity/QuantityScreen.vue](../../app/components/quantity/QuantityScreen.vue) |
| `/subcontract/quantity` view | quantity / trade | workspace/QuantityWorkspace · QuantityWorkspace | browser-local / desktop-sqlite | [app/components/quantity/QuantityScreen.vue](../../app/components/quantity/QuantityScreen.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/QuantityAssignmentDialog · QuantityAssignmentDialog | browser-local / desktop-sqlite | [app/components/quantity/QuantityScreen.vue](../../app/components/quantity/QuantityScreen.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/QuantityCompletionDialog · QuantityCompletionDialog | browser-local / desktop-sqlite | [app/components/quantity/QuantityScreen.vue](../../app/components/quantity/QuantityScreen.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/QuantityBatchCompletionDialog · QuantityBatchCompletionDialog | browser-local / desktop-sqlite | [app/components/quantity/QuantityScreen.vue](../../app/components/quantity/QuantityScreen.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/QuantityVarianceDialog · QuantityVarianceDialog | browser-local / desktop-sqlite | [app/components/quantity/QuantityScreen.vue](../../app/components/quantity/QuantityScreen.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/assignment/section/target · target | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/assignment/section/units · units | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/assignment/section/scopes · scopes | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/assignment/tab/crew · crew | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/assignment/tab/worker · worker | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/assignment/tab/whole · whole | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/assignment/tab/detailed · detailed | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/completion/stage · stage | browser-local / desktop-sqlite | [app/components/quantity/QuantityCompletionDialog.vue](../../app/components/quantity/QuantityCompletionDialog.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/completion/record · record | browser-local / desktop-sqlite | [app/components/quantity/QuantityCompletionDialog.vue](../../app/components/quantity/QuantityCompletionDialog.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/completion/completed · completed | browser-local / desktop-sqlite | [app/components/quantity/QuantityCompletionDialog.vue](../../app/components/quantity/QuantityCompletionDialog.vue) |
| `/subcontract/quantity` view | quantity / trade | dialog/completion/draft · draft | browser-local / desktop-sqlite | [app/components/quantity/QuantityCompletionDialog.vue](../../app/components/quantity/QuantityCompletionDialog.vue) |
| `/subcontract/quantity` view | quantity / crew | page · 工作台 | browser-local / desktop-sqlite | [app/pages/subcontract/quantity/index.vue](../../app/pages/subcontract/quantity/index.vue) |
| `/subcontract/quantity` view | quantity / crew | workspace/QuantityProgressCards · QuantityProgressCards | browser-local / desktop-sqlite | [app/components/quantity/QuantityScreen.vue](../../app/components/quantity/QuantityScreen.vue) |
| `/subcontract/quantity` view | quantity / crew | workspace/QuantityWorkspace · QuantityWorkspace | browser-local / desktop-sqlite | [app/components/quantity/QuantityScreen.vue](../../app/components/quantity/QuantityScreen.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/QuantityAssignmentDialog · QuantityAssignmentDialog | browser-local / desktop-sqlite | [app/components/quantity/QuantityScreen.vue](../../app/components/quantity/QuantityScreen.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/QuantityCompletionDialog · QuantityCompletionDialog | browser-local / desktop-sqlite | [app/components/quantity/QuantityScreen.vue](../../app/components/quantity/QuantityScreen.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/QuantityBatchCompletionDialog · QuantityBatchCompletionDialog | browser-local / desktop-sqlite | [app/components/quantity/QuantityScreen.vue](../../app/components/quantity/QuantityScreen.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/QuantityVarianceDialog · QuantityVarianceDialog | browser-local / desktop-sqlite | [app/components/quantity/QuantityScreen.vue](../../app/components/quantity/QuantityScreen.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/assignment/section/target · target | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/assignment/section/units · units | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/assignment/section/scopes · scopes | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/assignment/tab/crew · crew | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/assignment/tab/worker · worker | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/assignment/tab/whole · whole | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/assignment/tab/detailed · detailed | browser-local / desktop-sqlite | [app/components/quantity/QuantityAssignmentDialog.vue](../../app/components/quantity/QuantityAssignmentDialog.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/completion/stage · stage | browser-local / desktop-sqlite | [app/components/quantity/QuantityCompletionDialog.vue](../../app/components/quantity/QuantityCompletionDialog.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/completion/record · record | browser-local / desktop-sqlite | [app/components/quantity/QuantityCompletionDialog.vue](../../app/components/quantity/QuantityCompletionDialog.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/completion/completed · completed | browser-local / desktop-sqlite | [app/components/quantity/QuantityCompletionDialog.vue](../../app/components/quantity/QuantityCompletionDialog.vue) |
| `/subcontract/quantity` view | quantity / crew | dialog/completion/draft · draft | browser-local / desktop-sqlite | [app/components/quantity/QuantityCompletionDialog.vue](../../app/components/quantity/QuantityCompletionDialog.vue) |
| `/subcontract/quantity/region` new | subcontract.quantity.region / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/subcontract/quantity/region.vue](../../app/pages/subcontract/quantity/region.vue) |
| `/subcontract/quantity/region` new | subcontract.quantity.region / default | form/createBuilding · createBuilding | browser-local / desktop-sqlite | [app/components/quantity/QuantityRegionFormPage.vue](../../app/components/quantity/QuantityRegionFormPage.vue) |
| `/subcontract/quantity/region` new | subcontract.quantity.region / default | form/createFloor · createFloor | browser-local / desktop-sqlite | [app/components/quantity/QuantityRegionFormPage.vue](../../app/components/quantity/QuantityRegionFormPage.vue) |
| `/subcontract/quantity/region` new | subcontract.quantity.region / default | form/createUnit · createUnit | browser-local / desktop-sqlite | [app/components/quantity/QuantityRegionFormPage.vue](../../app/components/quantity/QuantityRegionFormPage.vue) |
| `/subcontract/quantity/template` new | quantity-template / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/subcontract/quantity/template.vue](../../app/pages/subcontract/quantity/template.vue) |
| `/subcontract/quantity/template` new | quantity-template / default | section/QuantityTemplateBasicSection · QuantityTemplateBasicSection | browser-local / desktop-sqlite | [app/components/quantity/QuantityTemplateFormPage.vue](../../app/components/quantity/QuantityTemplateFormPage.vue) |
| `/subcontract/quantity/template` new | quantity-template / default | section/QuantityTemplateRoomsSection · QuantityTemplateRoomsSection | browser-local / desktop-sqlite | [app/components/quantity/QuantityTemplateFormPage.vue](../../app/components/quantity/QuantityTemplateFormPage.vue) |
| `/subcontract/quantity/template` new | quantity-template / default | section/QuantityTemplateLinesSection · QuantityTemplateLinesSection | browser-local / desktop-sqlite | [app/components/quantity/QuantityTemplateFormPage.vue](../../app/components/quantity/QuantityTemplateFormPage.vue) |
| `/subcontract/quantity/template` edit | quantity-template / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/subcontract/quantity/template.vue](../../app/pages/subcontract/quantity/template.vue) |
| `/subcontract/quantity/template` edit | quantity-template / default | section/QuantityTemplateBasicSection · QuantityTemplateBasicSection | browser-local / desktop-sqlite | [app/components/quantity/QuantityTemplateFormPage.vue](../../app/components/quantity/QuantityTemplateFormPage.vue) |
| `/subcontract/quantity/template` edit | quantity-template / default | section/QuantityTemplateRoomsSection · QuantityTemplateRoomsSection | browser-local / desktop-sqlite | [app/components/quantity/QuantityTemplateFormPage.vue](../../app/components/quantity/QuantityTemplateFormPage.vue) |
| `/subcontract/quantity/template` edit | quantity-template / default | section/QuantityTemplateLinesSection · QuantityTemplateLinesSection | browser-local / desktop-sqlite | [app/components/quantity/QuantityTemplateFormPage.vue](../../app/components/quantity/QuantityTemplateFormPage.vue) |

### 项目进度成本（#412）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/project/target-cost/:id` view | project.target-cost / default | page · 详情 | browser-local / desktop-sqlite | [app/pages/project/target-cost/[id].vue](../../app/pages/project/target-cost/[id].vue) |
| `/project/target-cost/:id` view | project.target-cost / default | tab/items · items | browser-local / desktop-sqlite | [app/components/target-cost/TargetCostDetailScreen.vue](../../app/components/target-cost/TargetCostDetailScreen.vue) |
| `/project/target-cost/:id` view | project.target-cost / default | tab/comparison · comparison | browser-local / desktop-sqlite | [app/components/target-cost/TargetCostDetailScreen.vue](../../app/components/target-cost/TargetCostDetailScreen.vue) |
| `/project/target-cost/:id` view | project.target-cost / default | table/TargetCostItemEditor · TargetCostItemEditor | browser-local / desktop-sqlite | [app/components/target-cost/TargetCostDetailScreen.vue](../../app/components/target-cost/TargetCostDetailScreen.vue) |
| `/project/target-cost/:id` view | project.target-cost / default | table/TargetCostItemTable · TargetCostItemTable | browser-local / desktop-sqlite | [app/components/target-cost/TargetCostDetailScreen.vue](../../app/components/target-cost/TargetCostDetailScreen.vue) |
| `/project/target-cost/:id` view | project.target-cost / default | table/TargetCostComparisonTable · TargetCostComparisonTable | browser-local / desktop-sqlite | [app/components/target-cost/TargetCostDetailScreen.vue](../../app/components/target-cost/TargetCostDetailScreen.vue) |
| `/project/target-cost/form` new | project.target-cost / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/project/target-cost/form/[[id]].vue](../../app/pages/project/target-cost/form/[[id]].vue) |
| `/project/target-cost/form/:id` edit | project.target-cost / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/project/target-cost/form/[[id]].vue](../../app/pages/project/target-cost/form/[[id]].vue) |
| `/project/target-cost` view | project.target-cost / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/project/target-cost/index.vue](../../app/pages/project/target-cost/index.vue) |
| `/schedule/:pid` view | schedule / default | page · 工作台 | browser-local / desktop-sqlite | [app/pages/schedule/[pid]/index.vue](../../app/pages/schedule/[pid]/index.vue) |
| `/schedule/:pid` view | schedule / default | workspace/ScheduleBoard · ScheduleBoard | browser-local / desktop-sqlite | [app/components/schedule/ScheduleScreen.vue](../../app/components/schedule/ScheduleScreen.vue) |
| `/schedule/:pid` view | schedule / default | workspace/ScheduleTaskDialog · ScheduleTaskDialog | browser-local / desktop-sqlite | [app/components/schedule/ScheduleScreen.vue](../../app/components/schedule/ScheduleScreen.vue) |
| `/schedule/:pid` view | schedule / default | workspace/ScheduleDependencyDialog · ScheduleDependencyDialog | browser-local / desktop-sqlite | [app/components/schedule/ScheduleScreen.vue](../../app/components/schedule/ScheduleScreen.vue) |
| `/schedule/:pid` view | schedule / default | workspace/mobile/wbs · wbs | browser-local / desktop-sqlite | [app/components/schedule/ScheduleTimeline.vue](../../app/components/schedule/ScheduleTimeline.vue) |
| `/schedule/:pid` view | schedule / default | workspace/mobile/gantt · gantt | browser-local / desktop-sqlite | [app/components/schedule/ScheduleTimeline.vue](../../app/components/schedule/ScheduleTimeline.vue) |
| `/schedule/:pid/bind/:gid` new | schedule.bind / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/schedule/[pid]/bind/[gid].vue](../../app/pages/schedule/[pid]/bind/[gid].vue) |
| `/schedule` view | schedule / default | page · 工作台 | browser-local / desktop-sqlite | [app/pages/schedule/index.vue](../../app/pages/schedule/index.vue) |
| `/schedule` view | schedule / default | workspace/ScheduleBoard · ScheduleBoard | browser-local / desktop-sqlite | [app/components/schedule/ScheduleScreen.vue](../../app/components/schedule/ScheduleScreen.vue) |
| `/schedule` view | schedule / default | workspace/ScheduleTaskDialog · ScheduleTaskDialog | browser-local / desktop-sqlite | [app/components/schedule/ScheduleScreen.vue](../../app/components/schedule/ScheduleScreen.vue) |
| `/schedule` view | schedule / default | workspace/ScheduleDependencyDialog · ScheduleDependencyDialog | browser-local / desktop-sqlite | [app/components/schedule/ScheduleScreen.vue](../../app/components/schedule/ScheduleScreen.vue) |
| `/schedule` view | schedule / default | workspace/mobile/wbs · wbs | browser-local / desktop-sqlite | [app/components/schedule/ScheduleTimeline.vue](../../app/components/schedule/ScheduleTimeline.vue) |
| `/schedule` view | schedule / default | workspace/mobile/gantt · gantt | browser-local / desktop-sqlite | [app/components/schedule/ScheduleTimeline.vue](../../app/components/schedule/ScheduleTimeline.vue) |
| `/schedule/new` new | schedule / default | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/schedule/new.vue](../../app/pages/schedule/new.vue) |
| `/schedule/process-library/form` new | process-library / new | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/schedule/process-library/form.vue](../../app/pages/schedule/process-library/form.vue) |
| `/schedule/process-library/form?source=:versionId` new | process-library / copy-version | page · 整页表单 | browser-local / desktop-sqlite | [app/pages/schedule/process-library/form.vue](../../app/pages/schedule/process-library/form.vue) |
| `/schedule/process-library` view | schedule.process-library / default | page · 列表 | browser-local / desktop-sqlite | [app/pages/schedule/process-library/index.vue](../../app/pages/schedule/process-library/index.vue) |

### 导入导出（#406/#414）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/export/config/:jobId` view | export.config / default | page · 特殊工具 | file-workflow / file-workflow | [app/pages/export/config/[jobId].vue](../../app/pages/export/config/[jobId].vue) |
| `/import/mapping/invoice` view | invoice / default | page · 特殊工具 | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/invoice` view | invoice / default | step/upload · upload | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/invoice` view | invoice / default | step/mapping · mapping | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/invoice` view | invoice / default | step/preview-import · preview-import | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/invoice` view | invoice / default | step/preview-import/rejected · 拒绝行与来源 | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/project` view | project / default | page · 特殊工具 | central-http / central-http | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/project` view | project / default | step/upload · upload | central-http / central-http | [app/composables/useProjectImport.ts](../../app/composables/useProjectImport.ts) |
| `/import/mapping/project` view | project / default | step/mapping · mapping | central-http / central-http | [app/composables/useProjectImport.ts](../../app/composables/useProjectImport.ts) |
| `/import/mapping/project` view | project / default | step/preview-import · preview-import | central-http / central-http | [app/composables/useProjectImport.ts](../../app/composables/useProjectImport.ts) |
| `/import/mapping/project` view | project / default | step/preview-import/rejected · 拒绝行与来源 | central-http / central-http | [app/components/project/ProjectImportScreen.vue](../../app/components/project/ProjectImportScreen.vue) |
| `/import/mapping/supplier` view | supplier / default | page · 特殊工具 | central-http / central-http | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/supplier` view | supplier / default | step/upload · upload | central-http / central-http | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/supplier` view | supplier / default | step/mapping · mapping | central-http / central-http | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/supplier` view | supplier / default | step/preview-import · preview-import | central-http / central-http | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/supplier` view | supplier / default | step/preview-import/rejected · 拒绝行与来源 | central-http / central-http | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/demo-supplier` view | demo-supplier / default | page · 特殊工具 | simulation / simulation | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/demo-supplier` view | demo-supplier / default | step/upload · upload | simulation / simulation | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/demo-supplier` view | demo-supplier / default | step/mapping · mapping | simulation / simulation | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/demo-supplier` view | demo-supplier / default | step/preview-import · preview-import | simulation / simulation | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/demo-supplier` view | demo-supplier / default | step/preview-import/rejected · 拒绝行与来源 | simulation / simulation | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-template` view | quantity-template / default | page · 特殊工具 | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-template` view | quantity-template / default | step/upload · upload | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-template` view | quantity-template / default | step/mapping · mapping | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-template` view | quantity-template / default | step/preview-import · preview-import | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-template` view | quantity-template / default | step/preview-import/rejected · 拒绝行与来源 | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-assignment` view | quantity-assignment / default | page · 特殊工具 | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-assignment` view | quantity-assignment / default | step/upload · upload | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-assignment` view | quantity-assignment / default | step/mapping · mapping | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-assignment` view | quantity-assignment / default | step/preview-import · preview-import | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-assignment` view | quantity-assignment / default | step/preview-import/rejected · 拒绝行与来源 | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-completion` view | quantity-completion / default | page · 特殊工具 | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-completion` view | quantity-completion / default | step/upload · upload | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-completion` view | quantity-completion / default | step/mapping · mapping | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-completion` view | quantity-completion / default | step/preview-import · preview-import | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-completion` view | quantity-completion / default | step/preview-import/rejected · 拒绝行与来源 | browser-local / desktop-sqlite | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-legacy-precheck` view | quantity-legacy-precheck / default | page · 特殊工具 | precheck-only / precheck-only | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-legacy-precheck` view | quantity-legacy-precheck / default | step/upload · upload | precheck-only / precheck-only | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-legacy-precheck` view | quantity-legacy-precheck / default | step/mapping · mapping | precheck-only / precheck-only | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-legacy-precheck` view | quantity-legacy-precheck / default | step/preview-import · preview-import | precheck-only / precheck-only | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/import/mapping/quantity-legacy-precheck` view | quantity-legacy-precheck / default | step/preview-import/rejected · 拒绝行与来源 | precheck-only / precheck-only | [app/pages/import/mapping/[entity].vue](../../app/pages/import/mapping/[entity].vue) |
| `/settings/data-migration` view | settings.data-migration / default | page · 工作台 | migration-browser / unsupported | [app/pages/settings/data-migration.vue](../../app/pages/settings/data-migration.vue) |
| `/settings/data-migration` view | settings.data-migration / default | section/MigrationPreflightPanel · MigrationPreflightPanel | migration-browser / unsupported | [app/components/migration/CoreIdentityMigrationScreen.vue](../../app/components/migration/CoreIdentityMigrationScreen.vue) |
| `/settings/data-migration` view | settings.data-migration / default | section/MigrationReconciliationTable · MigrationReconciliationTable | migration-browser / unsupported | [app/components/migration/CoreIdentityMigrationScreen.vue](../../app/components/migration/CoreIdentityMigrationScreen.vue) |
| `/settings/data-migration` view | settings.data-migration / default | section/MigrationSwitchPanel · MigrationSwitchPanel | migration-browser / unsupported | [app/components/migration/CoreIdentityMigrationScreen.vue](../../app/components/migration/CoreIdentityMigrationScreen.vue) |

### 系统设置（#414）

| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |
| --- | --- | --- | --- | --- |
| `/settings/ocr` view | settings.ocr / default | page · 工作台 | browser-local / desktop-sqlite | [app/pages/settings/ocr.vue](../../app/pages/settings/ocr.vue) |
