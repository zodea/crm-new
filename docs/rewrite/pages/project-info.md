# 项目信息 — 项目列表 + 项目详情

> 路由: `/project` · `/project/:id`  
> 页面: `pages/project/index.vue` · `pages/project/[id].vue`  
> 表单蓝本: `projectForm`（ADR 0014）
> 参考: `docs/红圈系统/项目详情页/` 25张红圈CRM截图  
> 交互模式: `CRM-PATTERNS.md` · 色值: `DESIGN-SYSTEM.md` v5  
> 状态: 已确认布局 · 2026-06-26

---

## 定位

项目是全系统的核心关联实体。项目详情页是整个系统的**经营驾驶舱**——顶部汇总面板的每个数值都从下方 Tab 的业务数据自动聚合计算。

---

## 一、项目列表 `/project`

### 布局

```
┌─ sticky 工具栏 ──────────────────────────────────────────────────┐
│ 施工项目 · 共 N 个                                                │
│ [搜索框 w-52]  [+ 新增]  [导入Excel]  [导出Excel]                 │
└──────────────────────────────────────────────────────────────────┘
┌─ vxe-table ─────────────────────────────────────────────────────┐
│ # │ 项目名称(链接) │ 状态chip │ 地址 │ 开工日期 │ 建设单位 │ 项目经理 │ 操作 │
└─────────────────────────────────────────────────────────────────┘
```

### 表格列

| 列 | 字段 | 宽度 | 备注 |
|----|------|------|------|
| # | seq | 52px | fixed left |
| 项目名称 | name | min 160px | fixed left，蓝色链接→详情 |
| 状态 | status | 90px | chip: 筹备中=橙/施工中=蓝/停工=灰/已竣工=绿/已结算=绿 |
| 项目地址 | address | min 130px | |
| 开工日期 | startDate | 110px | |
| 建设单位 | developer | min 120px | |
| 项目经理 | manager | 90px | |
| 操作 | — | 130px | fixed right: 详情/编辑/删除 |

### 新增/编辑项目

采用 ADR 0014 整页表单。

| 分区 | 字段与规则 |
|---|---|
| 基本信息 | 项目名称*、项目合同名称、项目编号、客户(甲方)*、客户2、工程地域、详细地址、经营类型、建筑面积、工程概况 |
| 工期与阶段 | 业务流程阶段、计划开工、计划竣工、计划工期、实际竣工 |
| 参建单位 | 项目经理*、项目经理电话、执行经理、承包单位、监理单位、设计单位、现场负责人、现场负责人电话 |
| 风控与立项 | 项目风险级别、立项文件时间、立项文件附件、效果图附件 |
| 备注 | 备注 |

客户 lookup 保存真实 `customer_id` / `secondary_customer_id`；不再依赖客户名称同名关联。附件进入 `file_refs`。

---

## 二、项目详情 `/project/:id`

### 整体结构（从上到下）

```
┌─ 顶栏：项目名 + 元数据行 ──────────────────────────────────────────┐
│ [←返回] 合和新城  项目信息  [施工中]                      [编辑]    │
│ 业务流程阶段│经营类型│项目经理│客户(甲方)│承包单位                    │
│ [施工中]    │自营    │陈志强  │广州合和置业│广州睿瑛装饰              │
└──────────────────────────────────────────────────────────────────┘
┌─ 项目经营数据（自动计算） ──────────────────────────────────────────┐
│ 主合同金额 │ 增补合同额 │ 变洽签审定额 │ 变更后合同额 │ 项目收款 │ 合同付款 │
│ 32,388,422 │ 0.00      │ 0.00        │ 32,388,422  │ 25,367,027│ 0.00   │
│ 往来收款   │ 往来付款   │ 扣除管理费   │ 扣除管理费   │ 项目可用资金余额     │
│ 6,100,000  │ 5,950,000 │ 0.00        │ 0.00        │ 31,467,027.10      │
└──────────────────────────────────────────────────────────────────┘
┌─ 票据信息（自动计算） ─────────────────────────────────────────────┐
│ 销项票额    │ 销项税额    │ 进项票额    │ 进项税额    │ 增值税  │ 税负率  │
│ 25,663,629  │ 2,119,015  │ 24,696,348  │ 1,959,703  │ 159,312│ 0.68%  │
└──────────────────────────────────────────────────────────────────┘
┌─ 阶段时间线 + 任务（含文件上传） ──────────────────────────────────┐
│ ●项目立项 → ●施工准备(0/5) → ◐施工中(0/3) → ○完工验收 → ○交付 → ○保修│
│ ▾ 施工准备阶段                                                     │
│   1. 施工组织设计方案 | 资料员扫描上传并存档      [上传] [查看]       │
│   2. 开工报告及开工令 | 资料员扫描上传并存档      [上传] [查看]       │
│   3. 材料定样板 | 资料员照片上传，封样件存档      [上传] [查看]       │
│   4. 图纸会审记录 | 设计师扫描上传并原件存档      [上传] [查看]       │
│   5. 施工蓝图 | 设计师勾选不上传但原蓝图存档      [上传] [查看]       │
└──────────────────────────────────────────────────────────────────┘
┌─ Tab 栏（9个Tab，去掉扣返款） ─────────────────────────────────────┐
│ 详细资料│成本预算│施工合同管理│支出合同管理│票税管理│资金管理│往来款│支付明细│物资管理│竣工验收及保修│
└──────────────────────────────────────────────────────────────────┘
┌─ Tab 内容区 ────────────────────────────────────────────────────┐
│ (根据选中 Tab 渲染对应子表)                                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 三、顶部汇总面板

### 3.1 项目经营数据

顶部经营区展示主合同金额、增补合同金额、变洽签审定金额、变更后合同金额、项目收款、合同付款、工人工资支付、动态成本、往来收付款、扣除管理费、收支差额、工程款余缺和项目可用资金余额。

字段来源与既有聚合见 [`DATABASE.md §4.3`](../DATABASE.md)，新增成本与资金公式见 [`DATABASE.md §10.4-10.6`](../DATABASE.md)。本页只规定卡片顺序、状态呈现和下钻交互，不维护公式副本。

### 3.2 票据信息

票据信息区展示销项票额、销项税额、进项票额、进项税额、增值税和税负率。计算口径只在 [`DATABASE.md §4.4`](../DATABASE.md) 维护；金额卡仍使用统一状态与下钻契约。

### 3.3 支出合同与动态成本分类

经营汇总以 [`CONTEXT.md`](../../../CONTEXT.md) 的成本术语和 [`DATABASE.md §10.4`](../DATABASE.md) 的归集口径为准，界面并排展示合同额、动态成本和付款三个维度。合同劳务与工人工资必须使用独立行，点击金额进入对应源单列表。

### 3.4 指标完整性

每张金额卡按 [`DATABASE.md §10.5`](../DATABASE.md) 的 `OperatingMetric` 契约显示状态、汇总截止时间、缺失来源和下钻入口。界面不得把空值强制格式化为 0，并须为不同状态提供可辨识的中文标签。

---

## 四、阶段时间线 + 文件管理

### 4.1 六个阶段

| 阶段 | 任务数 | 说明 |
|------|--------|------|
| 项目立项 | 1 | — |
| 施工准备 | 5 | 施工组织设计方案、开工报告、材料定样板、图纸会审记录、施工蓝图 |
| 施工中 | 3 | 排版图签确白图、隐蔽验收记录、送检报告验收记录 |
| 完工及验收 | 1 | 竣工验收报告/移交 |
| 交付 | 5 | 工期一览表、工期延期说明工联单、范围界面确认文件、无甩项确认工联单、结算封板图 |
| 保修 | 0 | 动态 |

### 4.2 每个任务的文件管理

每个阶段任务 = 一个文件上传槽位：

```ts
interface PhaseTask {
  id: string
  phaseIndex: number         // 0-5 对应六个阶段
  taskIndex: number          // 阶段内序号
  title: string              // "施工组织设计方案"
  description: string        // "资料员扫描上传并存档"
  responsible: string        // 负责角色: 资料员/设计师
  files: FileRef[]           // 已上传的文件列表
  status: 'pending' | 'uploaded' | 'confirmed'
}

interface FileRef {
  id: string
  fileName: string
  fileSize: number
  uploader: string           // 上传人
  uploadedAt: string         // 上传时间
  storagePath: string        // Tauri 文件系统路径
}
```

### 4.3 阶段状态规则

- 绿色✓ = 该阶段所有任务均已有有效文件或已经人工确认归档
- 蓝色◐ = 当前活跃阶段（部分任务完成）
- 灰色○ = 未开始
- 进度显示: `已完成数/总任务数`

### 4.4 项目文件柜

项目文件柜不建立第二套文件记录，而是按当前项目的阶段任务聚合有效 `file_refs`。每份文件保留阶段、任务、分类、上传人和上传时间，可从任务行或项目文件柜预览、下载；删除任一入口的文件都会同步影响另一入口及阶段进度。

---

## 五、9 个 Tab 详细规范

### Tab ① 详细资料

宽屏最多两列的只读信息卡片，按容器最小可读宽度自动降为单列，字段分组：

**基础信息：** 项目名称、项目合同名称、客户(甲方)、客户2、工程地域、工程详细地址、工程概况、经营类型、计划开工日期、计划竣工日期、计划工期(天)、备注、上传立项文件时间、附件、业务流程阶段、说明、F-验收日期、项目风险级别、审批状态

**系统信息：** 负责人、创建人、创建时间、修改人、修改时间

### Tab ② 成本预算

子表：**目标成本**

| 列 | 字段 |
|----|------|
| # | 序号 |
| 目标成本名称 | 链接，可展开 |
| 项目名称 | 链接 |
| 含税合价 | 金额 |
| 已签合同金额 | 金额 |
| 实际发生金额 | 金额 |
| 已申请付金额 | 金额 |
| 操作 | — |

### Tab ③ 施工合同管理

4个子表：

**施工合同：** 合同名称、含税合同金额、合同状态、签约日期、合同分类、含税已签金额、**附件**
- 底部汇总行: `含税合同金额总计: ¥X`
- **附件列（反馈轮 7 新增，合同文件柜）** —— 每行两组 chip：
  - **合同文书**：纯预览留底（CONTEXT.md「施工合同」）。未传→「+ 上传」；已传→「📄 PDF·N 页」点击弹**在线预览层**（翻页/缩放/下载），字段手工填、不做 OCR。
  - **清单附件**（**一对多**）：一份合同可挂多份清单文件（现实常出现户内清单 + 公区清单分文件、多 sheet）。聚合显示「清单 ×N」，点开文件列表——每份独立状态：**未拆表→点击进拆表三步向导**（boq-import.md）；**已拆表→「已拆表·N 行」点击跳工程量清单管理页并定位到该合同**。合同量/合同单价的唯一来源即此清单（CONTEXT.md「合同工程量清单」）。
- 不开合同详情页签、不做抽屉：行内 chip + 预览弹层即可（一个项目通常一两份合同）。

**补充协议：** 协议名称、金额、签约日期、**附件**（同样可挂合同文书 chip）

**甲方变洽签：** 变更编号、合同名称、含税审定金额、无税审定金额、无税申报金额、审定日期

**进度结算：** 结算编号、期数、金额

### Tab ④ 支出合同管理

3个子表：

**支出合同(N)：** 合同名称、合同类别（专业分包/合同劳务/材料/机械/其他）、原始细类、分类状态、审批状态、主合同含税金额、有效补充协议金额、分供方、生效日期、累计结算金额、累计支付
- 底部汇总行: `含税合价总计: ¥X`

**支出合同补充协议(N)：** 协议编号、协议名称、关联合同、金额、签约日期、状态、附件

**分包变洽签(N)：** 变更编号、变更类型、乙方、合同名称、审批金额、变更面积、实际审定价、合约审批

**支出结算(N)：** 结算名称、合同名称、结算日期、结算类型、金额
- 底部汇总行

### Tab ⑤ 票税管理

2个子表：

**开票申请(N)：** 开票申请名称、开票金额、审核状态、开票日期、项目名称
- 底部汇总行: `合计金额: ¥X`，汇总到顶部「销项票额/销项税额」

**收票登记(N)：** 发票号码、金额类型、合同名称、发票金额、税额、发票类型、开票日期、分供方
- 底部汇总行: `合计金额: ¥X`，汇总到顶部「进项票额/进项税额」

### Tab ⑥ 资金管理

5个子表：

**收款登记(N)：** 收款登记编号、收款日期、收款金额、支付方式、支付单位、累计应收
- 底部汇总行，汇总到顶部「项目收款」

**我方项目扣减项目(N)：** 扣减编号、项目名称、金额、审核状态

**付款申请(N)：** 付款申请编号、审批状态、申请人、金额、已付金额（支付记录分摊派生）、未付金额、回票状态
- 底部汇总行: `申请金额合计`、`已付合计`；已付合计不得读取申请头手写值

**先行付款申请(N)：** 编号、金额、审批状态

**费用报销(N)：** 申请编号、报销金额、报销人、审批状态

### Tab ⑦ 往来款

2个子表：

**往来收款(N)：** 往来收款编号、收款日期、收款金额、付款人、操作
- 底部汇总行，汇总到顶部「往来收款」

**往来付款(N)：** 往来付款编号、审批状态、付款日期、收款单位、金额、付款方式
- 底部汇总行，汇总到顶部「往来付款」

### Tab ⑧ 支付明细

**支付记录(N)：** 支付编号、支付日期、支付金额、支付方式、收款单位、收款账户、开户行、银行账号、银行流水号、凭证、识别来源、人工确认状态、关联付款申请数、分摊差额

- 点击行进入支付详情，查看原始回单和付款申请分摊；
- OCR 或手录但未人工确认的记录不进入汇总；
- 已确认记录要求分摊差额为 0；
- 一笔支付可以对应多张付款申请，一张申请也可以由多笔支付完成。

### Tab ⑨ 物资管理

6个子表（对应乙供材管理模块的项目维度视图）：

**物资设计计划(N)：** 单据编号、审批状态、计划日期、负责人、创建时间、操作

**物资需用计划(N)：** 单据编号、审批状态、计划日期、要求到期日期、创建时间、操作

**入库单(N)：** 单据编号、类型、分供方、入库日期、入库仓库、材料采购合同、操作

**直入直出(N)：** 单据编号、类型、分供方、日期、仓库、合同名、操作

**出库单(N)：** 单据编号、类型、出库日期、仓库、领料人、材料采购合同、操作

**库存盘点(N)：** 盘点编号、仓库名称、盘点日期、盘点人、生效状态

### Tab ⑩ 竣工验收及保修

2个子表：

**竣工验收(N)：** 验收编号、项目名称、甲方、合同名称、验收状态、合同估价、操作

**保修到期确认单(N)：** 编号、项目名称、甲方、合同名称、审批状态、保修负责人、操作

---

## 六、旧字段快照（已废弃）

> ⛔ 本节只保留早期项目详情聚合类型作历史对照，不是 schema 来源。现行项目客户外键、表单字段、合同/资金子实体及迁移批次统一见 [`DATABASE.md` §2.10](../DATABASE.md)；`developer` / `developer2` 名称文本、`TicketRegistration` 和拆分的 `CurrentReceipt` / `CurrentPayment` 均不得用于新写路径。

### 6.1 Project（扩展）

```ts
interface Project {
  // ... 原有字段保持
  id: string
  name: string
  contractName: string        // 新增: 项目合同名称
  code: string
  address: string
  region: string              // 新增: 工程地域
  type: string
  area: number | null
  contractAmount: number | null
  overview: string            // 新增: 工程概况
  operationType: string       // 新增: 经营类型(自营/联营)

  startDate: string
  plannedEnd: string
  actualEnd: string
  plannedDuration: number | null  // 新增: 计划工期(天)
  status: string

  developer: string           // 客户(甲方)
  developer2: string          // 新增: 客户2
  supervisor: string
  designer: string
  contractor: string          // 承包单位

  manager: string
  managerPhone: string
  siteLeader: string
  siteLeaderPhone: string

  riskLevel: string           // 新增: 项目风险级别
  approvalStatus: string      // 新增: 审批状态
  acceptanceDate: string      // 新增: F-验收日期
  filingDate: string          // 新增: 上传立项文件时间

  note: string
  description: string         // 新增: 说明(阶段转换规则等)
  source: 'manual' | 'import'
  createdBy: string           // 新增
  createdAt: string
  updatedBy: string           // 新增
  updatedAt: string

  // 阶段任务
  phaseTasks: PhaseTask[]

  // 以下为 computed，不存储
  // 经营数据、票据信息从关联子表实时聚合
}
```

### 6.2 子表数据模型

```ts
// 施工合同
interface ConstructionContract {
  id: string
  projectId: string
  name: string
  contractNo: string
  amount: number              // 含税合同金额
  status: string              // 合同状态
  signDate: string
  category: string            // 合同分类
  signedAmount: number        // 含税已签金额
  taxRate: number
}

// 补充协议
interface SupplementAgreement {
  id: string
  contractId: string          // 关联施工合同
  name: string
  amount: number
  signDate: string
}

// 甲方变洽签
interface OwnerChangeOrder {
  id: string
  projectId: string
  changeNo: string
  contractName: string
  taxIncAmount: number        // 含税审定金额
  taxExcAmount: number        // 无税审定金额
  appliedAmount: number       // 无税申报金额
  approvalDate: string
}

// 支出合同
interface ExpenditureContract {
  id: string
  projectId: string
  name: string
  approvalStatus: string
  taxIncTotal: number         // 含税合价
  contractor: string          // 乙方
  effectiveDate: string
  accumulatedSettlement: number
  signedAmount: number
}

// 开票申请
interface InvoiceApplication {
  id: string
  projectId: string
  name: string
  amount: number              // 开票金额
  taxAmount: number           // 税额
  status: string
  invoiceDate: string
}

// 收票登记
interface TicketRegistration {
  id: string
  projectId: string
  invoiceNo: string
  amountType: string
  contractName: string
  amount: number              // 发票金额
  taxAmount: number           // 税额
  invoiceType: string
  invoiceDate: string
  supplier: string
}

// 收款登记
interface ReceiptRegistration {
  id: string
  projectId: string
  receiptNo: string
  receiptDate: string
  amount: number
  paymentMethod: string
  payerUnit: string
  cumulativeReceivable: number
}

// 付款申请
interface PaymentApplication {
  id: string
  projectId: string
  applicationNo: string
  approvalStatus: string
  applicant: string
  amount: number              // 申请金额
  paidAmount: number          // 已付金额
  paymentMethod: string
  actualPayment: number       // 实际支付金额
  acceptor: string            // 承兑人
}

// 往来收款
interface CurrentReceipt {
  id: string
  projectId: string
  receiptNo: string
  receiptDate: string
  amount: number
  payer: string
}

// 往来付款
interface CurrentPayment {
  id: string
  projectId: string
  paymentNo: string
  approvalStatus: string
  paymentDate: string
  payee: string
  amount: number
  paymentMethod: string
}
```

---

## 七、交互规范

### 顶部汇总面板

- 所有数值自动计算，不可直接编辑
- 每个数值旁有 ⓘ 信息图标，hover 显示计算公式说明
- 金额字段保留 2 位小数，monospace 字体
- 收款绿色、付款/支出红色、余额按正负着色

### 阶段时间线

> 当前阶段（#174）：六阶段任务清单与附件均使用真实持久化。项目详情只读打开不会自动写入默认任务；首次明确上传时才一次性持久化完整默认任务清单，避免只保留被上传的单条任务。

- 点击阶段节点展开/收起该阶段的任务列表
- 每个任务有 [上传] [查看] 按钮
- 上传支持多文件，Tauri 文件对话框
- 已上传的文件显示文件名、大小、上传人、上传时间
- 文件可预览（图片/PDF）和删除
- 浏览器开发态把正文放入既有文件正文表，并将 sql.js 快照写入 IndexedDB，刷新后仍可预览/下载；Tauri 保留本机路径
- 项目文件柜按任务聚合同一批文件，不复制文件事实

### 底部 Tab

> 当前阶段（#175）：「详细资料 / 成本预算 / 施工合同管理 / 票税管理 / 资金管理」5 个 Tab 已接真实 SQLite；真实子表统一具备搜索、列筛选、独立分页和筛选结果合计。成本预算只把 `submitted + is_baseline=1` 的目标明细作为正式控制线，签约、结算和支付分别回读合同、已确认结算与已确认支付分摊，草稿不进入正式金额。其余 5 个深度 Tab 仍由 #176–#179 分功能接入。

- 每个 Tab 内包含 1-6 个子表
- 每个真实子表有独立的搜索、列筛选、分页和筛选结果合计
- 项目详情保持只读；新增、编辑、审批和导出继续进入对应业务源单流程
- 子表间通过分隔线区分
- 有底部汇总行的子表显示合计金额
- 子表标题显示记录数: `收款登记(12)`

### 响应式

响应式强制口径见 [ADR 0013](../../adr/0013-align-all-ui-to-online-design.md)。宽屏经营数据/票据最多 6 列；`6` 只是语义最大列数，组件按最小可读宽度自动降为 3/2/1 列，不以固定两排模板锁定。业务 SegTab 允许换行，禁止页面级横向滚动；子表只在自身数据容器内横滚。最低在 390 / 768 / 1024 / 1440px 验证摘要、阶段时间线、Tab、主操作和全部字段可达。

---

## 八、工程量评估

这是整个系统最大的单页，涉及：
- 3 个汇总面板（经营数据 + 往来款 + 票据信息）
- 1 个阶段时间线 + 文件管理
- 9 个 Tab × 平均 3 个子表 ≈ **25+ 个独立数据表**
- 每个子表有 CRUD + 搜索 + 筛选 + 导出 + 汇总
- 顶部面板的 15+ 个字段需要实时聚合计算

建议实施策略：先做框架（顶部+阶段+Tab 切换），子表按优先级逐步填充。

---

## 九、首个迁移样本验收

车陂商业大楼项目只用于验证通用查询，不在页面或代码中写死。金额、凭证和缺源基准统一见[睿璟验收清单](../../migration/ruijing-acceptance.md)；本页不保存第二份样本事实。
