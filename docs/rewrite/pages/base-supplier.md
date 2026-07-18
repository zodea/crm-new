# 基础信息/分供方 — 主数据 + 证照 + 跨项目汇总

> 路由: `/base/supplier` · `/base/supplier/:id`  
> 页面: `pages/base/supplier/index.vue` · `pages/base/supplier/[id].vue`  
> 参考: CRM 截图 `docs/红圈系统/合同页/`、`docs/红圈系统/付款申请/`、`docs/红圈系统/收票登记/`  
> 交互模式: `CRM-PATTERNS.md` · 色值: `DESIGN-SYSTEM.md` v5

---

## 定位

**Supplier（分供方）** 是跨项目共享的基础主数据。负责公司资料、证照附件、开票/银行信息、联系人、资料审核状态和跨项目只读汇总。

边界原则：

| 在本页面做 | 不在本页面做 |
|---|---|
| 新增/编辑分供方主数据 | 新建采购合同（→ `material-contract`） |
| 上传、识别、审核证照 | 发起请款审批（→ `finance-payment`） |
| 查看跨项目汇总，跳转源单据 | 登记收票（→ `finance-ticket`） |
| 管理文件结构（上传/下载/浏览） | 录入付款流水（→ `finance-payment`） |

---

## 一、业务流程

```
① 新增分供方 ──→ ② 证照管理 ──→ ③ 资料审核 ──→ ④ 合格入库
   手动/发票收集/      上传/OCR识别/     提交审核/        可关联项目
   Excel导入           自动归类/回填     通过/退回补充     生成ProjectSupplier
                           ↑                │
                           └── 退回补充 ─────┘

④ 合格入库 ──→ 跨项目只读汇总（合同数/合同额/请款/收票/已付/应付）
                    │
                    └──→ 点击跳转源单据（采购合同 / 付款申请 / 收票登记）
```

---

## 二、数据模型

### Supplier

```ts
interface Supplier {
  id: string
  name: string                    // 公司全称 *必填
  aliases: string[]               // 简称/别名，用于文件夹名对应
  uniqueCode: string              // 唯一识别码
  taxNo: string                   // 统一社会信用代码

  // 分类
  businessType: string            // 业务类型
  supplierCategory: string        // 分供方类别: 材料供应商/劳务分包商/设备供应商/其他
  rating: string                  // 评价等级
  parentSupplierId: string | null // 上级供应商

  // 工商信息
  legalRep: string                // 法定代表人
  registeredCapital: number | null // 注册资金
  registeredDate: string          // 注册日期
  address: string                 // 营业执照住所/注册地址
  taxpayerType: string            // 纳税人类型（选填，默认未核验）
  mainBusiness: string            // 主营业务

  // 开票/银行信息
  invoiceName: string             // 开票名称
  invoiceAddress: string          // 开票资料地址（选填，与注册地址独立）
  bank: string                    // 开户行
  bankAccount: string             // 银行账号
  phone: string                   // 公司电话/开票资料电话（选填）

  // 联系人
  contact: string                 // 主要联系人(签约代表)
  contactPhone: string            // 联系方式

  // 状态（两个独立维度）
  credentialStatus: 'incomplete' | 'reviewing' | 'qualified' | 'rejected'
    // 证照维度: 必需证照是否齐全
  approvalStatus: 'draft' | 'submitted' | 'approved' | 'rejected'
    // 入库维度: 分供方整体是否通过审批
    // V1: 默认 'draft'，无流转操作入口，预留字段

  source: 'manual' | 'invoice' | 'excel' | 'delivery'
  note: string
  createdAt: string
  updatedAt: string
}
```

### SupplierCredential

```ts
type CredentialCategory =
  | '营业执照'
  | '法人身份证'
  | '银行开户许可证'
  | '签约代表身份证'
  | '品牌授权证明'
  | '合同模板'
  | '完税证明'
  | '过往业绩合同'
  | '施工照片'
  | '其他'

interface SupplierCredential {
  id: string
  supplierId: string              // → Supplier.id
  category: CredentialCategory
  fileName: string
  filePath: string                // Tauri 本地路径
  ocrResult: Record<string, unknown>  // OCR 识别回填字段
  ocrConfidence: number | null    // 识别置信度
  verifiedAt: string | null       // 审核通过时间
  addedAt: string
}
```

### SupplierReadonlySummary（实时计算，不存储）

```ts
interface SupplierReadonlySummary {
  supplierId: string
  projectCount: number            // 关联项目数
  contractCount: number           // 合同总数
  contractTotal: number           // 合同总额
  claimedTotal: number            // 累计已审批请款
  invoiceTotal: number            // 累计收票金额
  paidTotal: number               // 累计已付
  payableBalance: number          // 应付余额 = contractTotal - paidTotal
}
```

> 完整实体关系和外键索引见 → `DATABASE.md`

---

## 三、列表页 `/base/supplier`

### 工具栏

```
分供方 · 共 N 家
[搜索关键词] [刷新] [列设置] [筛选] [导入] [+ 新建]
```

### 表格列（vxe-table）

| 列 | 字段 | 备注 |
|---|---|---|
| # | seq | fixed left |
| 分供方名称 | `name` | 蓝色链接→详情，fixed left |
| 分供方类别 | `supplierCategory` | 可筛选 |
| 唯一识别码/税号 | `uniqueCode` / `taxNo` | 用于去重 |
| 供应商简称 | `aliases[0]` | 可为空 |
| 上级供应商 | `parentSupplierId` | 显示上级名称 |
| 详细地址 | `address` | 长文本省略 |
| 主要联系人 | `contact` | |
| 联系方式 | `contactPhone` | |
| 资料状态 | `credentialStatus` | chip: 缺失/审核中/合格/退回 |
| 合作项目数 | computed | 只读计算 |
| 累计合同额 | computed | 只读计算 |
| 累计已付 | computed | 只读计算 |
| 操作 | — | 编辑、上传证照、关联项目，fixed right |

### 筛选

| 筛选项 | 说明 |
|---|---|
| 分供方类别 | 材料供应商、劳务分包商、设备供应商、其他 |
| 资料状态 | 缺失、审核中、合格、退回 |
| 合作项目 | 只看某项目关联过的分供方 |
| 欠款状态 | 应付余额 > 0 |
| 证照缺失 | 必需证照不完整 |

---

## 四、新增/编辑

弹窗或抽屉表单，字段按分区组织。

| 分区 | 字段 |
|---|---|
| 基础信息 | 公司全称*、简称/别名、分供方类别、业务类型、统一社会信用代码/税号、法人代表、注册资金、注册日期、注册地址、主营业务 |
| 开票/银行 | 开票名称、纳税人类型（默认未核验）、开户行、银行账号、开票资料地址（选填）、公司电话（选填） |
| 联系/其他 | 主要联系人、联系方式、评价等级、上级供应商、来源、备注 |
| 证照附件 | 上传、预览、删除、OCR 识别、自动分类、手动调整类别 |

V1 说明：`approvalStatus` 默认 `draft`，表单中不显示审批操作入口。`credentialStatus` 根据证照齐全程度自动计算。

### 地址、电话与纳税人类型口径

- `address` 是营业执照登记的住所/注册地址；不得用经营地址、收件地址或开票地址覆盖。
- `invoiceAddress` 是分供方确认使用的开票资料地址，常与注册地址一致，但不是同一个字段。允许点击“同注册地址”做一次性复制，复制后仍可独立编辑；选填且不参与资料齐全度。
- `phone` 是公司电话/开票资料电话，选填；与主要联系人手机 `contactPhone` 分开，不参与资料齐全度、提交审核或合格判断。
- `taxpayerType` 选填且新建默认“未核验”，不得默认“一般纳税人”。字段旁提供“复制税号”和“打开广东税务查询”，跳转[广东省电子税务局一般纳税人资格查询](https://etax.guangdong.chinatax.gov.cn:8443/xxbg/view/zhsffw/#/query/ybnsrzgcx)。用户在官网完成验证码和查询，回到应用后人工确认结果并记录核验时间；应用不抓取网页、不绕过验证码。“未查到”只记为待确认，不自动判为小规模纳税人。

### 新增来源

1. 手动新建
2. Excel 导入
3. 从已入账发票销售方收集候选分供方
4. 从送货单识别结果归并公司名称

---

## 五、详情页 `/base/supplier/:id`

### 顶部摘要

```
┌──────────────────────────────────────────────────────────────────────┐
│ [← 返回列表]  广州市大板东建材有限公司                                │
│ 类别: 材料供应商 │ 评价: A │ 联系人: 张三 │ 电话: 138xxxx │ [爱企查] [编辑] │
│ 资料状态: [合格✓]                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

- 工商查询（爱企查）按钮放在顶部摘要栏

### Tab（6 个）

| # | Tab | 内容 | 操作边界 |
|---|---|---|---|
| 1 | 详细资料 | 基础信息、开票信息、联系人信息、层级关系 | 可编辑主数据 |
| 2 | 证照附件 | 证照清单表格、批量下载、上传、OCR 重新识别 | 可维护证照 |
| 3 | 合作项目 | ProjectSupplier 列表: 项目名/状态/合同额/已付/应付/结算状态 | 点击跳转 → ProjectSupplier 详情 |
| 4 | 合同汇总 | 只读合同列表（跨项目），可按金额排序、按合同类型筛选 | 点击跳转 → 采购合同详情 |
| 5 | 请款/付款汇总 | 只读请款和付款列表（跨项目），可按时间/金额排序 | 点击跳转 → 付款申请详情 |
| 6 | 收票汇总 | 只读收票列表（跨项目），可按发票号/金额/日期筛选 | 点击跳转 → 收票登记详情 |

Tab 3 和 Tab 4/5/6 的视角不同：Tab 3 按项目维度，Tab 4/5/6 按单据类型维度（跨项目汇总排序筛选）。

### 右侧辅助区

| 区域 | V1 状态 | 说明 |
|---|---|---|
| 文件管理 | **启用** | 展示文件目录结构，支持上传/下载/预览，按证照类别分组 |
| 审批时间线 | 留空 | 预留 UI 位置，V2 接入后台后启用 |
| 评论 | 留空 | 预留，V2 多用户协作 |
| 跟进人 | 留空 | 预留，V2 分配负责人 |
| 动态 | 留空 | 预留，V2 操作日志 |

---

## 六、证照管理与审核

### 证照清单

| 类别 | 默认要求 | OCR 回填 / 说明 |
|---|---|---|
| 营业执照 | 必需 | 公司全称、税号、法人、注册地址 |
| 法人身份证 | 必需 | 法人姓名、证件有效期 |
| 银行账户资料 | 必需 | 开户行、银行账号；兼容“银行开户许可证 / 开户许可证 / 基本存款账户信息 / 基本存款账户信息表” |
| 签约代表身份证 | 不适用 | 仅在签约代表与法人不同且业务明确要求时改为“需提供” |
| 资质证书 | 不适用 | 仅特定品牌、专业类别、项目或合同明确要求时改为“需提供” |
| 品牌授权书/品牌授权证明 | 不适用 | 两个名称视为同一类别；仅明确要求授权关系时改为“需提供” |
| 合同模板 / 完税证明 / 过往业绩合同 / 施工照片 / 其他 | 可选 | 默认不影响资料齐全度 |

条件资料的要求状态与文件是否已收到分开保存：默认“不适用”，人工改为“需提供”后，缺失或过期才影响资料齐全度；不得为了让状态变绿而制造现实中不存在的证照。

### OCR 回填规则

1. 本地 OCR 识别证照内容
2. 按关键词自动归类证照类别
3. 只回填空字段，不覆盖已填值
4. 与已填值冲突时高亮提示（绿框 + "请核对"），由人工决定是否替换
5. 所有识别值允许人工修改

### credentialStatus 流转

> ⚠️ Issue #13 尚待用户确认：资料齐全后应直接自动 `qualified`，还是进入人工核验后才 `qualified`。确认前保留下表作为存量行为记录，不据此关闭 Issue；当前推荐“缺失 → 齐全待核验 → 人工合格 / 人工退回”。

| 动作 | 结果 |
|---|---|
| 上传证照 | 自动检查：必需证照齐全 → `qualified`，否则 → `incomplete` |
| 删除证照 | 重新检查，可能退回 `incomplete` |
| 退回补充（V2 审核人操作） | `rejected`，必须填写退回原因 |

---

## 七、跨项目只读汇总

汇总只在详情页展示，不直接编辑源数据。所有指标可点击跳转到源单据列表（自动带当前分供方筛选条件）。

| 指标 | 计算来源 |
|---|---|
| 合作项目数 | COUNT(ProjectSupplier WHERE supplierId) |
| 合同数 / 合同总额 | 采购合同表（→ `material-contract`） |
| 累计已审批请款 | 付款申请表（→ `finance-payment`） |
| 累计收票金额 / 税额 | 收票登记表（→ `finance-ticket`） |
| 累计已付 | 付款流水表（→ `finance-payment`） |
| 应付余额 | 合同总额 − 累计已付 |

---

## 八、验收要点

1. `/base/supplier` 只做主数据、证照、审核状态和只读汇总
2. 合同、请款、收票、付款的新增和审批在各自业务模块完成
3. 证照 OCR 冲突不覆盖人工字段
4. 详情页汇总数字必须能追溯源单据（带筛选条件跳转）
5. 同一个 Supplier 可关联多个项目，主数据只维护一份
6. `approvalStatus` V1 预留不启用，`credentialStatus` 根据证照自动计算
7. 文件管理区 V1 启用（上传/下载/目录结构），审批/评论/跟进人/动态 V1 留空
8. 开票资料地址和公司电话允许留空，不影响资料齐全度；注册地址与开票资料地址独立保存
9. 资质证书、品牌授权书默认不适用，只有明确标记“需提供”后才参与缺失/过期判断
10. 纳税人类型默认未核验；广东税务入口只做“复制税号 + 打开官网 + 人工确认”，不得爬取或绕过验证码
11. “基本存款账户信息”能够满足“银行账户资料”要求，不因历史名称不同误报缺失
