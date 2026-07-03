# 项目×分供方 — 项目维度工作台

> 路由: `/project/:pid/supplier/:sid`  
> 页面: `pages/project/[pid]/supplier/[sid].vue`  
> 关联: `base-supplier.md`（主数据）· `contract-base.md`（合同）· `finance-payment.md`（付款）· `finance-ticket.md`（收票）  
> 交互模式: `CRM-PATTERNS.md` · 色值: `DESIGN-SYSTEM.md` v5

---

## 定位

**ProjectSupplier（项目×分供方）** 是某个项目下某个分供方的合作关系工作台。它是 Supplier 主数据和项目业务单据之间的枢纽：

| 层 | 职责 | 页面 |
|---|---|---|
| Supplier | 公司主数据、证照 | `/base/supplier/:id` |
| **ProjectSupplier** | **项目维度状态、聚合指标、源单据关联、结算锁定** | **`/project/:pid/supplier/:sid`** |
| 采购合同 | 合同 CRUD、审批、明细行 | `/material/contract/:id`（→ `material-contract.md`） |
| 付款申请 | 请款/付款 CRUD、审批 | `/finance/payment/:id`（→ `finance-payment.md`） |
| 收票登记 | 收票 CRUD、审批 | `/finance/ticket/:id`（→ `finance-ticket.md`） |

本页所有合同/请款/收票/付款的**新增、编辑、审批**操作都跳转到各自独立模块完成。本页只做**聚合展示 + 跳转 + 结算确认**。

---

## 一、业务流程

```
① 选择合格分供方 ──→ ② 关联项目（生成 ProjectSupplier）
                           │
                           ▼
                      ③ 合同签订 ──→ ④ 请款申请 ──→ ⑤ 收票登记
                      源: 采购合同     源: 付款申请     源: 收票登记
                                          │               │
                                          ▼               ▼
                                      ⑥ 付款流水 ──→ ⑦ 最终结算
                                      源: 付款申请     本页确认终态
                                          │               │
                                          └─ 多轮请款 ─→ ④  上传PDF/二次确认/锁定只读
```

各阶段操作入口：

| 阶段 | 操作位置 | 动作 |
|---|---|---|
| ③ 合同签订 | 采购合同模块 `/material/contract` | 新建合同时选择项目+分供方 |
| ④ 请款申请 | 付款申请模块 `/finance/payment` | 新建请款时关联项目+分供方+合同 |
| ⑤ 收票登记 | 收票登记模块 `/finance/ticket` | 新建收票时关联项目+分供方 |
| ⑥ 付款流水 | 付款申请模块 `/finance/payment` | 请款审批通过后录入付款 |
| ⑦ 最终结算 | **本页** | 填写结算金额、上传结算 PDF、二次确认后锁定 |

---

## 二、数据模型

### ProjectSupplier

```ts
type ProjectSupplierStatus =
  | 'collecting'   // 资料收集中（刚关联，尚未签合同）
  | 'contracted'   // 已签合同
  | 'claiming'     // 请款中（含多轮）
  | 'paid'         // 已付款（部分/全部）
  | 'settled'      // 已结算（终态，数据锁定只读）

interface ProjectSupplier {
  id: string
  projectId: string               // → Project.id
  supplierId: string              // → Supplier.id
  status: ProjectSupplierStatus

  // V2 预留：审批相关
  reviewerId: string | null       // 当前审核人（V1 不启用）

  // 源单据 id 索引（通过外键关联，非冗余存储）
  // 实际查询走 SQL JOIN：WHERE projectId = X AND supplierId = Y

  // 结算（唯一在本页完成的写操作）
  settlement: Settlement | null

  note: string
  createdAt: string
  updatedAt: string
}
```

### Settlement（结算 — 本页独有）

```ts
interface Settlement {
  id: string
  projectSupplierId: string       // → ProjectSupplier.id
  date: string
  finalAmount: number             // 最终结算金额（可与合同额不同）
  pdfFile: FileRef | null         // 结算确认书 PDF
  note: string
  // 确认后 ProjectSupplier.status → 'settled'，数据锁定只读
}
```

### ComputedSummary（实时计算，不存储）

```ts
interface ComputedSummary {
  contractTotal: number           // Σ 关联合同.变更后合同额
  claimedTotal: number            // Σ 已批准请款.金额
  paidTotal: number               // Σ 付款流水.金额
  invoiceTotal: number            // Σ 收票.含税金额
  taxTotal: number                // Σ 收票.税额
  balance: number                 // contractTotal - paidTotal
  settlementGap: number           // settlement.finalAmount - paidTotal（结算后）
}
```

> 合同(MaterialContract)、请款(Claim)、收票(InvoiceRef)、付款(Payment) 的完整数据模型见各自模块文档。  
> 全局外键关系见 → `DATABASE.md`

---

## 三、状态机

| 当前状态 | 触发动作 | 目标状态 | 前置条件 |
|---|---|---|---|
| `collecting` | 关联合同签订完成 | `contracted` | 采购合同模块中有关联本项目+分供方的合同 |
| `contracted` | 新建请款 | `claiming` | 付款申请模块中创建关联本项目+分供方的 Claim |
| `claiming` | 请款审批通过 + 录入付款 | `paid` | Claim approved + Payment 记录 |
| `claiming` | 请款驳回 | `contracted` | Claim rejected |
| `paid` | 发起新请款 | `claiming` | 多轮请款（分阶段施工） |
| `paid` | 确认结算 | `settled` | 填写结算金额 + 上传结算 PDF + 二次确认 |

状态变更说明：
- `collecting → contracted`：被动触发，采购合同模块新建合同时自动更新
- `contracted → claiming`：被动触发，付款申请模块新建请款时自动更新
- `paid → settled`：**主动触发**，在本页完成

### 状态 → 默认视图

| 状态 | 默认 Tab | 说明 |
|---|---|---|
| `collecting` | 合同 | 引导用户去采购合同模块补合同 |
| `contracted` | 请款 | 合同已签，提示可发起请款 |
| `claiming` | 请款 | 查看审批状态 |
| `paid` | 付款 | 查看付款流水和余额 |
| `settled` | 结算 | 只读查看 |

---

## 四、详情页交互

### 入口

从项目详情页的「支出合同管理」tab 或「分供方列表」中点击分供方名称 → 进入本页。

### 顶部摘要

```
┌──────────────────────────────────────────────────────────────────────┐
│ [← 返回项目]  项目: 合和新城 × 分供方: 大板东建材                      │
│ 状态: [已签合同]  合同额: ¥38.5万  请款: ¥12万  收票: ¥8万  已付: ¥10万  │
│ 应付余额: ¥28.5万                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### Tab（6 个）

| # | Tab | 内容 | 操作 |
|---|---|---|---|
| 1 | 合作概览 | 项目信息、分供方信息、状态、关键金额、最近动态 | 编辑备注 |
| 2 | 合同 | 只读合同列表: 合同号/名称/金额/变更后金额/附件数 | [+ 新建] → 跳转采购合同模块；行点击 → 跳转合同详情 |
| 3 | 请款 | 只读请款列表: 单号/状态/申请金额/审批金额/附件数 | [+ 新建] → 跳转付款申请模块；行点击 → 跳转请款详情 |
| 4 | 收票 | 只读收票列表: 发票号/开票日期/含税金额/税额/发票类型 | [+ 新建] → 跳转收票登记模块；行点击 → 跳转收票详情 |
| 5 | 付款 | 只读付款列表: 日期/金额/方式/凭证/关联请款单号 | [+ 新建] → 跳转付款申请模块；行点击 → 跳转付款详情 |
| 6 | 结算 | 结算金额/结算PDF/尾款差额/锁定状态 | **本页操作**: 填写结算金额 + 上传PDF + [确认结算]（二次确认弹窗） |

### 源单据跳转规则

各 tab 的 [+ 新建] 按钮和行点击都跳转到对应模块页面，跳转时携带筛选参数：

| 目标模块 | 携带参数 |
|---|---|
| 采购合同 | `projectId` + `supplierId` |
| 付款申请 | `projectId` + `supplierId` |
| 收票登记 | `projectId` + `supplierId` |

### 右侧辅助区

| 区域 | V1 状态 |
|---|---|
| 文件管理 | **启用**（展示本项目×分供方关联的所有文件，按来源分组） |
| 审批时间线 | 留空（V2） |
| 评论 | 留空（V2） |
| 动态 | 留空（V2） |

---

## 五、批量导入向导

路由: `/project/:pid/supplier/import`

用于批量把文件和分供方挂到项目维度。

### 三步向导

| 步骤 | 内容 |
|---|---|
| 1 选择文件 | 选择文件夹或多选文件，展示文件名/大小/类型 |
| 2 自动分类 + 人工调整 | 识别分供方名、文件类别、项目归属；可下拉修正 |
| 3 确认生成 | 预览将生成的 ProjectSupplier 记录，确认后回项目详情 |

### 生成规则

1. 已存在同项目同分供方关系时不重复创建
2. 分供方不存在时进入候选状态，由用户确认是否写入 Supplier 主数据
3. 文件只挂到 ProjectSupplier，不回写分供方证照

---

## 六、验收要点

1. ProjectSupplier 只保存项目维度关系和结算数据
2. 合同、请款、收票、付款的新增/编辑/审批不在本页完成，全部跳转到独立模块
3. 结算确认是本页唯一的写操作，确认后终态锁定
4. 所有 tab 的金额汇总都能跳转到源单据（带项目+分供方筛选）
5. 请款和付款允许多轮、多次
6. 状态变更除结算外都是被动触发（由源模块的操作自动更新）
7. `reviewerId` V1 预留不启用
