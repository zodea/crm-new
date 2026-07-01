# DC 设计稿重构 — 总览与进度

> 对象：claude.ai/design 项目「瑞航CRM-NEW」的 `app.dc.html` 单页设计稿
> 目标：以 `docs/rewrite/pages/*.md` 为内容蓝本，把各页面按统一的「疏朗仪表盘」风格重构，消除「各页各做一套」的割裂感
> 开始：2026-06-30 · 本目录为实施记录

---

## 一、背景与核心决策

### 1.1 问题
- 原 `app.dc.html` 侧边栏列出了完整导航，但 `<main>` 只渲染了 5 个路由，其余页面点击空白（已先补齐接入）。
- 更关键：**各页面风格不统一**——首页/工程量是用户亲自调过的「圆角卡片 + 阴影 + 充足留白」现代仪表盘风，而发票/分供方/工人等列表页还是「密集表格台账 + 横条工具栏」的旧 CRM 风，两种风格并存 = 割裂。

### 1.2 风格基准（已与用户确认）
**以首页 `HomeScreenNew` + 工程量 `QuantityScreenV2` 为唯一视觉基准**，所有页面向其看齐。

> ⚠️ 注意：`docs/rewrite/DESIGN-SYSTEM.md` §1.2 / §3.2 / §4.1 写的是「内容区扁平、无圆角、无阴影」的旧 CRM 规范，**已与实际实现和用户要求脱节**。实际 `_ds_bundle.js` 里的 `Panel`/`StatCard` 组件早已是圆角 12px + 阴影。本轮以「首页/工程量」为准，`DESIGN-SYSTEM.md` 冲突条款暂不更新（用户要求），但**不要再照旧 DESIGN-SYSTEM 的扁平规范做**。详见 [STYLE-GUIDE.md](./STYLE-GUIDE.md)。

### 1.3 内容蓝本
每个页面的 Tab 结构、字段、列表列、筛选、详情页设计，**严格按 `docs/rewrite/pages/*.md` 实现**（不只是套皮，结构也要对齐 md）。

---

## 二、进度

| # | 站 | md 蓝本 | 形态 | 状态 |
|---|---|---|---|---|
| ① | 发票 | finance-invoice.md | 3 Tab：上传 / 校对与排版（三栏）/ 发票台账 | ✅ 完成 |
| ② | 分供方 | base-supplier.md | 列表 + 详情 6 Tab + 证照 + 跨项目汇总 | ✅ 完成 |
| ③ | 工人 | base-worker.md | 列表（可点汇总卡）+ 详情（条件亲属右栏 + 证书三档着色）| ✅ 完成 |
| ④ | 班组 | base-crew.md | 列表 + 详情全宽 3 Section（工人配置/项目配置/扣罚只读）| ✅ 完成 |
| ⑤ | 项目信息 | project-info.md · project-supplier.md | 列表（状态下拉筛选）+ 详情驾驶舱：摘要 / 经营数据 / 票据信息 / 6阶段时间线 / 10 Tab 子表（重点 4 Tab 出真实子表，其余占位）| ✅ 完成（框架）|
| ⑥ | 工资核算 + 明细 | subcontract-payroll.md | 三层钻取 + 比例阶梯 + 计件/计时总表（StageTab→SegTab）+ 明细瀑布 | ✅ 完成 |
| ⑦ | 工程量 | subcontract-quantity.md | 户级矩阵重做：每户一格(分项对半)+hover全工种+点击弹"该户"弹窗+隐藏未开工楼层+楼层列固定 | ✅ 完成（户级重做）|
| ⑧ | 开票·税额工具 | finance-invoice.md §9 | CalcScreen：因子推算 + 价税分离 + 大写复制（风格打磨）| ✅ 完成 |
| ⑨ | 送货单 | material-delivery.md | DeliveryScreen：已接入侧边栏(乙供材管理) + `delivery` 路由，修未定义 token | ✅ 完成 |

> 首页 `HomeScreenNew`、工程量 `QuantityScreenV2` 为风格基准，本身无需重构。

---

## 三、本轮改动的文件

### kit 组件（claude.ai/design 项目内 `kit/`）
| 文件 | 改动 |
|---|---|
| `InvoiceScreen.jsx` | 重写：4 阶段 → md 3 Tab，修 tab 横向滚动条 |
| `SupplierScreen.jsx` | 重写：列表页；筛选 pill→下拉框；**已移除 `KitToolbar/KitTH/KitTD` 遗留垫片** |
| `SupplierDetailScreen.jsx` | 新建：详情 6 Tab |
| `WorkerScreen.jsx` | 重写：列表 + 可点汇总卡；筛选 pill→下拉框；挂 `window.WORKER_META` 供详情复用 |
| `WorkerDetailScreen.jsx` | 新建：详情 + 条件亲属右栏 |
| `CrewScreen.jsx` | 重写：卡片网格 → 统一表格；筛选 pill→下拉框 |
| `CrewDetailScreen.jsx` | 重写：全宽 3 Section |
| `ProjectScreen.jsx` | 重写：脱离 KitToolbar，统一疏朗列表 + 状态下拉筛选 + 项目名→详情 |
| `ProjectDetailScreen.jsx` | 新建：项目经营驾驶舱（摘要/经营数据/票据/阶段时间线/10 Tab 子表）|
| `PayrollScreen.jsx` | 重构：StageTab→SegTab，疏朗表格 + 统一圆角卡片 + 校验提示 |
| `CalcScreen.jsx` | 打磨：税率 pill、疏朗表格、统一圆角，token 用 `--ok-soft`/`--warn-ink` 等 |
| `DeliveryScreen.jsx` | 接入路由 + 修未定义 token（`--surface-sink`→`--surface-2`、`--header-h`→64）|

### 外壳
| 文件 | 改动 |
|---|---|
| `app.dc.html` | 新增 `projectDetail` 路由（项目父项高亮）+ `delivery` 路由 + 侧边栏「乙供材管理」加「送货单」项 |

### 筛选交互变更（用户要求）
分供方 / 班组 / 工人 / 项目 四个列表页的筛选由「一整行 pill 按钮平铺所有分类」改为**紧凑下拉框 `SelectFilter`**（label + 原生 select + 自绘 chevron），并入工具栏，去掉独立筛选 Panel 行——去臃肿。**与 STYLE-GUIDE §3.6 的 pill 筛选规范脱钩**（pill 仍用于「可点击汇总卡」之类的状态切换，不用于多分类筛选）。

### KitToolbar 垫片已移除
`ProjectScreen` 重写后不再引用 `window.KitToolbar/KitTH/KitTD`，已从 `SupplierScreen.jsx` 末尾删除该注册块。全项目无残留引用。

### 反馈轮 2（分部/工种·配置·工资·请款单·全量按钮）
- `kit/KitUI.jsx`（新增）：全局轻交互工具（纯 DOM，跨所有屏复用）—— `KitUI.toast/confirm/modal/formModal`，经隐藏 x-import 预加载；全项目占位按钮（导出/导入/新增/编辑/删除/刷新/上传/查看/列设置/识别…）均已接通交互。
- `QuantityScreenV2.jsx` 再改：**分部 → 工种 → 分项** 三级（格子按工种分块，不再只到泥水分项）；hover/弹窗展示各工种工人+工程量；弹窗「先量后钱」（金额折叠）、去掉跨楼层入口；格子改**瓷砖留白圆角**观感；**完工月份做成可编辑 state**（「设置工程量/完工时间」弹窗逐层配置，实时驱动矩阵着色/工种/隐藏），并标注首页进度据此生成。
- `PayrollScreen.jsx`：接 `params` 可从工资明细**逐级回退到班组**层级；发放比例节点**可点选查看历史月份**当期发放；加「请款单格式」入口。`PayrollDetailScreen.jsx`：面包屑逐级可回退（工资核算/项目/班组/工人）。
- `kit/WageSlipScreen.jsx`（新增）：**网页版工资请款单**，还原 `docs/rewrite/工资发放格式` 真实 Excel 四表（① 进度款审批表 ② 工程量进度清单 ③ 工人工资表 ④ 考勤表），数据按车陂商业大楼·周维铺贴班组 2025.4 样例；侧边栏「分包及人工」加入口 + `wageSlip` 路由。

### 反馈轮 1（首页 + 工程量交互修正）
- `HomeScreenNew.jsx`：新增「开工 → 完工总进度」卡（整体进度条 + 今天标记 + 各节点提前/延后/进行中），插在项目 Tab 之后；「+全部项目」接 `navigate("project")`。
- `QuantityScreenV2.jsx` 户级重做（按 subcontract-quantity.md §四）：
  - 每户合并为**一个格子**，分项在格内对半（不再拆「墙砖/地砖」两列）；
  - **hover** 弹该户全部分项 + 工人 + 工程量（不止单块）；
  - **点击格子 → 弹窗只展示「这一户」**（floor×unit）的房间级合同量/现场量/暂定量 + 工人链接 + 合计，不再跳到「该户跨所有楼层」页；
  - 空户干净留白（不再红框），默认**隐藏未开工楼层**（可开关）；
  - 左侧楼层列 sticky 固定 + nowrap 自适应宽。
- 已在 design 预览实测：户弹窗、首页总进度、矩阵结构均正常渲染，加载无控制台报错。

---

## 四、尚未做的（待深化）
- **项目详情子表**：10 Tab 中「详细资料 / 施工合同管理 / 票税管理 / 资金管理」已出真实子表，其余 6 个（成本预算 / 支出合同管理 / 往来款 / 支付明细 / 物资管理 / 竣工验收及保修）为占位卡，待按 project-info.md §五逐步填充；阶段任务「上传/查看」为占位按钮。
- **项目×分供方工作台**（project-supplier.md，路由 `/project/:pid/supplier/:sid`）尚未建独立页，目前从项目详情「支出合同管理」Tab 占位入口预留。
- 各页面 md 中的**二级弹窗**普遍只占位：发票导出原件配置 / Excel 导入字段映射 / 打印确认；新增编辑弹窗；送货单整理树 / 问题汇总 / 入库 / 导出弹窗。
- **数据 mock 在组件内**（项目经营数据/票据/阶段/各子表样例按 id mock）。后续若要更真实，统一补进 `kit/data.js`。
- `docs/rewrite/DESIGN-SYSTEM.md` 与新风格冲突的条款未同步更新（用户暂不要求）。

---

## 五、文档导航
- [STYLE-GUIDE.md](./STYLE-GUIDE.md) — 统一视觉规范（卡片/标题/数字/按钮/Tab/筛选/表格/状态色 + 列表页/详情页模板）
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) — 技术实现与「新增一个页面」的标准流程（DC 路由机制、x-import 加载、DS 组件、data mock、DesignSync 上传）
