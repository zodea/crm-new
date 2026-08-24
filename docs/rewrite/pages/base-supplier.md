# 基础信息/分供方 — 主数据 + 证照 + 跨项目汇总

> 路由: `/base/supplier` · `/base/supplier/:id`  
> 页面: `pages/base/supplier/index.vue` · `pages/base/supplier/[id].vue`  
> 表单蓝本: `supplierForm`（ADR 0014）
> 视觉参考: [ADR 0013](../../adr/0013-align-all-ui-to-online-design.md) · [运行态参考审计](../../design/runtime-reference-audit.md)
> 术语与业务差异: [`CONTEXT.md`「分供方」](../../../CONTEXT.md#分供方)
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

## 二、旧字段快照（已废弃）

> ⛔ 本节只保留早期界面类型作历史对照，不是 schema 来源。现行列、约束、核验状态与迁移批次统一见 [`DATABASE.md` §2.1、§2.10](../DATABASE.md)；新增实现不得从下列 TypeScript 接口反推表结构。

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
  supplierCategory: string        // ⛔ 历史 4 类快照；现行 7 类以 CONTEXT.md「分供方」为准
  rating: string                  // 评价等级
  parentSupplierId: string | null // ⛔ 已废弃：分供方是终端签约对象、无母子挂靠；见 DATABASE.md §2.10.2

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
    // 资料维度: 必需资料齐全度 + 人工核验结论
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
  filePath: string                // legacy 迁移路径留痕（证照域不读取）
  fileRefId: string | null
  fileSize: number
  mimeType: string
  hasAccessibleFile: boolean      // 已持久化 payload；路径本身不算可访问
  validFrom: string
  expiresAt: string
  longTerm: boolean
  ocrResult: Record<string, unknown>  // OCR 识别回填字段
  ocrConfidence: number | null    // 识别置信度
  ocrConfirmedResult: Record<string, unknown>
  ocrConfirmedAt: string | null
  verifiedAt: string | null       // 审核通过时间
  addedAt: string
}
```

### SupplierReadonlySummary（实时计算，不存储）

```ts
interface SupplierReadonlySummary {
  projectCount: number            // 关联项目数
  contractCount: number           // 合同总数
  contractTotal: number           // 合同总额
  settledTotal: number            // 累计结算金额
  claimedTotal: number            // 累计已审批请款
  invoiceTotal: number            // 累计收票金额
  invoiceTaxTotal: number         // 累计收票税额
  paidTotal: number               // 累计付款金额
  payableBalance: number          // 应付金额 = contractTotal - paidTotal
}
```

> 完整实体关系和外键索引见 → `DATABASE.md`

---

## 三、列表页 `/base/supplier`

### 工具栏

```
分供方资料库 · 共 N 家
[搜索关键词] [刷新] [排序] [类别] [资料状态] [列设置] [导入] [导出台账] [分类导出] [+ 新增分供方]
```

工具栏保持单行并在自身区域横向滚动；表格占满剩余内容宽度，采用紧凑行高、固定操作列、表格内部横向滚动和底部分页。加载态在表格原位显示骨架，不使用会改变整体布局的独立占位区。

### 表格列（vxe-table）

| 列 | 字段 | 备注 |
|---|---|---|
| # | seq | fixed left |
| 分供方名称 | `name` | 蓝色链接→详情，fixed left |
| 分供方类别 | `supplierCategory` | 可筛选 |
| 唯一识别码/税号 | `uniqueCode` / `taxNo` | 用于去重 |
| 供应商简称 | `aliases[0]` | 可为空 |
| 详细地址 | `address` | 长文本省略 |
| 主要联系人 | `contact` | |
| 联系方式 | `contactPhone` | |
| 资料状态 | `credentialStatus` | chip: 缺失/齐全待核验/合格/退回 |
| 合作项目数 | computed | 只读计算 |
| 累计合同额 | computed | 只读计算 |
| 累计已付 | computed | 只读计算 |
| 操作 | — | 详情、编辑、维护证照、关联项目、删除，fixed right |

### 筛选

| 筛选项 | 说明 |
|---|---|
| 分供方类别 | 材料供应商、劳务分包商、专业分包商、设备供应商、检测供应商、个人、其他 |
| 资料状态 | 缺失、齐全待核验、合格、退回 |
| 合作项目 | 只看某项目关联过的分供方 |
| 欠款状态 | 应付余额 > 0 |
| 证照缺失 | 必需证照不完整 |

---

## 四、新增/编辑

采用 ADR 0014 整页表单；新建前先通过统一 KitUI 类型选择框选择 CONTEXT.md 权威七类，确认后进入整页表单。类型带入表单，但仍可在未产生业务引用前修正。短分供方表单不显示左侧分区导航，字段使用两列网格（窄屏单列）、内容区纵向滚动和固定底部操作栏。

| 分区 | 字段 |
|---|---|
| 基础信息 | 公司全称*、简称别名、分供方类别*、经营类型、唯一识别码、统一社会信用代码、法定代表人、注册资金、注册日期、注册地址、纳税人类型、评价等级、主营业务 |
| 联系人信息 | 主要联系人*、联系人电话、职务、公司电话 |
| 开票信息 | 开票名称、开户行、银行账号、开票地址及电话 |
| 证照资料引导 | 表单不保存第二套普通附件；主数据保存后进入详情“证照附件”，统一维护真实文件、OCR、有效期、资料要求和人工核验 |
| 状态与备注 | 资料状态（按资料规则与人工审核动作产生）、备注 |

`approvalStatus` 不作为本表单普通字段。`credentialStatus` 中 `incomplete/reviewing` 由资料规则自动计算，`qualified/rejected` 只能由人工核验动作产生；设计稿普通 select 不得绕过 #13 的审核凭证要求。

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

### 浏览器中央事实区（5 个页签）

| # | Tab | 内容 | 操作边界 |
|---|---|---|---|
| 1 | 合作项目 | ProjectSupplier 稳定关系 | 点击项目进入 `/project/:pid/supplier/:sid` |
| 2 | 合同事实 | 有效合同与有效补充协议金额 | 合同和项目有稳定身份时穿透 |
| 3 | 结算事实 | 已登记的支出结算事实 | 0 条也进入真实空态；没有 canonical 详情路由的结算行保持不可导航 |
| 4 | 收票事实 | 仅已归档发票 | 发票、项目和合同分别按稳定身份解析 |
| 5 | 付款事实 | 付款申请及已确认支付分摊 | 申请进入只读付款申请详情；实付不从申请金额推算 |

分供方主数据在事实区上方只读展示；正式分供方只能从详情顶部显式进入独立整页表单。浏览器中央主链不读取旧 `supplier-detail` store。证照上传、OCR 与人工核验从 `/base/supplier/credential/:id` 独立路由进入既有证照专用文件/审计边界；该路由不回退成事实页签，也不把证照改造成中央主档附件命令。尚未接入该专用存储的中央主档必须显示明确不可用状态，禁止写入平行正式主数据。

> 当前实现（#319）：材料采购合同详情使用稳定 `supplierId + dataOrigin` 进入本页 `contracts|settlements|invoices|payments` 四类事实页签，事实为 `0` 时仍显示专属空态。仅接受白名单页签与经验证的同源材采合同返回地址；返回时恢复原合同页签，并继续沿材采列表、项目详情和项目列表的嵌套上下文逐级恢复。该入口不引入新的供应商聚合来源，也不扩展库存、交付或结算核心。

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

1. 使用系统设置中已配置的 PaddleOCR-VL 服务识别证照内容
2. 按关键词自动归类证照类别
3. 只回填空字段，不覆盖已填值
4. 与已填值冲突时高亮提示（绿框 + "请核对"），由人工决定是否替换
5. 所有识别值允许人工修改

### credentialStatus 流转

> ✅ Issue #13 已确认：资料齐全不等于合格，必须经过人工核验。内部值 `reviewing` 的界面文案统一显示“齐全待核验”。
>
> 数据底座已由迁移 v36 落地：证照原件只有在有效 `file_refs + file_payloads` 下才算已收到；legacy 桌面路径只保留迁移线索，不授予应用读取权限，用户必须重新选择原件上传。原始 OCR、待核对状态与人工确认值分列保存，“稍后核对”或重启后仍可继续；OCR 类别与当前类别冲突时默认保留当前类别并记录决定。OCR 更新只写不含正文的专用脱敏审计；逐类别要求、按 `Asia/Shanghai` 业务日期计算的有效期和供应商级人工核验凭证参与同一状态机。存量 `qualified/rejected` 没有供应商级凭证时会重算为 `incomplete/reviewing`。

> 供应商主数据、人工资料核验和纳税人核验只写 `supplier_audits` 脱敏审计，记录动作、结果、来源类别、变更字段名、备注是否存在和时间，不复制税号、银行账号、OCR 或备注正文。关键工商/银行字段由数据库触发器统一使旧人工结论失效；列表加载还会按当天上海业务日淘汰已经过期的 `qualified`。普通表单、store 和导入不能直接制造 `qualified/rejected`。

| 动作 | 结果 |
|---|---|
| 上传/删除文件，或修改类别、有效期、条件要求 | 自动重算：必需资料缺失或过期 → `incomplete`；全部满足 → `reviewing` |
| 人工核验通过 | 仅 `reviewing` 可执行；→ `qualified`，记录核验时间和备注 |
| 人工退回 | → `rejected`，退回原因必填 |
| 修正退回问题 | 按资料规则重新计算为 `incomplete` 或 `reviewing`，不得自动恢复 `qualified` |

已人工合格后，如必需资料的文件、分类、有效期、要求状态或相关 OCR 确认值发生变化，原核验结论失效并重新计算；只修改不参与齐全度的可选资料，不应无故撤销合格。

---

## 七、跨项目只读汇总

汇总只在详情页展示，不直接编辑源数据。顶部“合作项目、累计合同金额、累计结算金额、累计收票金额、累计付款金额”是固定穿透入口并同步 `?tab=` 深链；“应付金额”只展示。入口对应的真实关系暂时没有记录时仍进入目标 Tab 的真实空态，不用 mock 填充。项目、合同、付款申请和发票明细继续通过蓝色链接穿透真实源记录。

| 指标 | 计算来源 |
|---|---|
| 合作项目数 | COUNT(ProjectSupplier WHERE supplierId) |
| 合同数 / 累计合同金额 | 采购合同表（→ `contracts`） |
| 累计结算金额 | 已确认支出结算事实（→ `settlements`）；不得使用合同旧累计字段 |
| 累计收票金额 / 税额 | 已归档发票表（→ `invoices`） |
| 累计付款金额 | 已确认支付记录对付款申请的真实分摊（→ `payments`） |
| 应付金额 | 累计合同金额 − 累计付款金额（只读、不穿透） |

---

## 八、验收要点

1. 浏览器 `/base/supplier` 的列表、详情和正式主档新增/编辑只走中央 Repository、HTTP 与命令边界
2. 合同、请款、收票、付款的新增和审批在各自业务模块完成
3. 证照 OCR 冲突不覆盖人工字段
4. 详情页汇总数字必须能追溯源单据（带筛选条件跳转）
5. 同一个 Supplier 可关联多个项目，主数据只维护一份
6. `approvalStatus` V1 预留不启用；资料缺失/齐全状态自动计算，但 `qualified/rejected` 必须由人工核验产生并可追溯
7. 文件管理区 V1 启用（上传/下载/目录结构），审批/评论/跟进人/动态 V1 留空
8. 开票资料地址和公司电话允许留空，不影响资料齐全度；注册地址与开票资料地址独立保存
9. 资质证书、品牌授权书默认不适用，只有明确标记“需提供”后才参与缺失/过期判断
10. 纳税人类型默认未核验；广东税务入口只做“复制税号 + 打开官网 + 人工确认”，不得爬取或绕过验证码
11. “基本存款账户信息”能够满足“银行账户资料”要求，不因历史名称不同误报缺失

## 九、参考系统差异裁定（Issue #193）

- 不采用“上级供应商”或 `parentSupplierId`：瑞航分供方是终端签约对象，不建立母子挂靠。
- 不引入“大宗供应商”、历史四类或多选类型；新建、筛选和表单统一使用权威七类单选。
- 不照抄参考系统的审批人、评论、跟进人、动态和供应商层级；`approvalStatus` V1 不在表单展示或驱动资料状态。
- 不增加列表左分类树，不把整页表单改回弹窗；宽表只在自身区域横向滚动。
- 列表与详情只脱敏展示税号、手机号和银行账号；编辑表单保留业务维护所需原值。
- 详情右栏文件管理按证照类别分组，提供真实原件预览和下载；无法读取的 legacy 路径只提示重新上传。
