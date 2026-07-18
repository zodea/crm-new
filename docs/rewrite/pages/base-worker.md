# 基础信息/工人信息 — 列表 + 详情（含亲属关联）

> 路由: `/base/worker` · `/base/worker/:id`
> 页面: `pages/base/worker/index.vue` · `pages/base/worker/[id].vue`
> 交互模式: `CRM-PATTERNS.md` · 色值: `DESIGN-SYSTEM.md` v5
> 原型参考: `DC重构设计源码/kit/WorkerScreen.jsx`（重构圆角卡片版，见 ADR 0007；旧扁平版 `设计系统配色更新/kit/` 已弃用）

---

## 定位

**Worker（工人）** 是跨项目共享的基础主数据。管理工人个人信息、证书档案、亲属关联、班组归属，并汇总展示工人在各模块的历史数据。

边界原则：

| 在本页面做 | 不在本页面做 |
|---|---|
| 新增/编辑工人个人信息 | 配置计薪方式/比例覆盖（→ `base-crew` 班组详情） |
| 上传、管理证书档案 | 录入工程量（→ `subcontract-quantity`） |
| 设置亲属关联（familyGroupId） | 计算工资（→ `subcontract-payroll`） |
| 查看三级安全教育状态 | 打卡/考勤录入（→ `subcontract-attendance`） |
| **只读展示**施工区域记录、工资历史、考勤记录、扣罚记录 | 录入/审批扣罚（→ 扣罚来源模块） |

---

## 一、数据模型

### Worker

```ts
interface Worker {
  id: string                // "wkr_<timestamp>_<seq>"
  name: string              // 姓名（必填，≥2字）
  gender: string            // 性别：男 | 女
  idCard: string            // 身份证号（18位）
  phone: string             // 联系电话（必填）
  hometown: string          // 籍贯（省/市）
  emergencyContact: string  // 紧急联系人
  emergencyPhone: string    // 紧急联系电话

  // 银行信息
  bankName: string          // 开户银行（如"中国建设银行广州天河支行"）
  bankAccount: string       // 银行卡号
  bankCode: string          // 银行行号（联行号，自动匹配生成，见 § 银行行号自查表）

  trade: string             // 工种（必填）：木工|泥工|钢筋工|电工|焊工|架子工|油漆工|防水工|水暖工|测量工|普工|机械操作工|其他
  skillLevel: string        // 初级|中级|高级|技师
  dailyWage: number | null  // 参考日工资（实际按 crew_workers.dailyWage 执行）

  currentProject: string    // 当前项目名称
  projectStatus: '在场' | '已退场'
  entryDate: string
  exitDate: string | null

  familyGroupId: string | null  // 亲属关联组 ID，同组工人为一家人
  safetyEducation: boolean      // 三级安全教育是否完成

  certs: WorkerCert[]
  note: string
  source: 'manual' | 'import'
  createdAt: string
  updatedAt: string
}
```

### WorkerCert

```ts
interface WorkerCert {
  id: string
  workerId: string
  category: '身份证' | '银行卡' | '安全培训合格证' | '特种作业操作证' | '检测报告' | '其他'
  subType: string           // 特种作业细分（电工/焊工/高空等）；检测报告细分（体检报告/核酸等）
  fileName: string
  filePath: string          // Tauri 本地路径
  ext: string
  expiryDate: string | null // 有效期，NULL=无有效期
  addedAt: string
}
```

### familyGroupId 说明

替代旧的 `linkedWorkerId`（一对一限制）。同一个 `familyGroupId` 下的工人为一家人（夫妻、兄弟/亲戚），支持 2-4 人关联。

用途：
- 工人详情页开启右侧栏展示亲属列表
- 工程量矩阵中合并显示（同一格位可查看一家人各自的工程量）
- 工资完全独立，亲属关联仅影响 UI 展示，不影响核算

> 完整实体关系和外键索引见 → `DATABASE.md`

---

## 二、列表页 `/base/worker`

### 工具栏

```
工人信息库 · 共 N 人
[搜索姓名/工种/班组] [刷新] [列设置] [筛选] [导入Excel] [导出Excel] [+ 添加工人]
```

### 汇总卡片（宽屏最多 3 列）

按容器最小可读宽度自动降为 2/1 列；不得为保持三列而压缩数字或让页面横滚。

| 卡片 | 色调 | 数据 |
|------|------|------|
| 在场工人数 | brand | `workers.filter(w => w.projectStatus === '在场').length` |
| 已退场人数 | ink-soft | `workers.filter(w => w.projectStatus === '已退场').length` |
| 证书即将过期 | warn | 30 天内到期的证书数 |

卡片可点击，切换下方表格的筛选条件。选中态：border-brand + bg-brand-soft。

### 表格列（vxe-table）

| 列 | 字段 | 宽度 | 备注 |
|----|------|------|------|
| # | seq | 52px | fixed left |
| 姓名 | `name` | 80px | 蓝色链接→详情，fixed left |
| 工种 | `trade` | 80px | 可筛选 |
| 所属班组 | 关联 crew_workers | 90px | |
| 当前项目 | `currentProject` | min 120px | |
| 在场状态 | `projectStatus` | 80px | 状态文字：在场=ok色 / 已退场=ink-soft色 |
| 联系电话 | `phone` | 110px | font-mono |
| 身份证号 | `idCard` | 160px | font-mono，脱敏显示前6后4 |
| 进场日期 | `entryDate` | 100px | font-mono |
| 退场日期 | `exitDate` | 100px | font-mono，无则"—" |
| 安全教育 | `safetyEducation` | 70px | ✓(ok) / ✗(danger) |
| 操作 | — | 130px | 详情/编辑/删除，fixed right |

### 筛选

| 筛选项 | 说明 |
|--------|------|
| 工种 | 多选 |
| 所属班组 | 多选 |
| 当前项目 | 多选 |
| 在场状态 | 在场 / 已退场 |
| 安全教育 | 已完成 / 未完成 |
| 证书状态 | 即将过期 / 已过期 / 正常 |

### 底部汇总栏

```
共 N 人 · 在场 M 人 · 已退场 K 人                     [分页]
```

---

## 三、新增/编辑工人

弹窗表单按分区组织：宽屏最多 2 列，字段最小可读宽度不足时自动单列；弹窗宽度与高度遵循 ADR 0013 的动态视口边界。

| 分区 | 字段 | 布局 |
|------|------|------|
| 个人信息 | 姓名*、性别、身份证号(full width)、联系电话*、籍贯、紧急联系人、紧急联系电话 | 2列 |
| 银行信息 | 开户银行*、银行卡号*、银行行号(自动匹配，可手动修改) | 2列 |
| 工作信息 | 工种*、技能等级、参考日工资、所属班组(combobox) | 2列 |
| 项目分配 | 当前项目(combobox)、在场状态、进场日期、退场日期 | 2列 |
| 证书档案 | 证书卡片列表，类别含：身份证/银行卡/安全培训/特种作业/检测报告/其他。每条：类别·文件名·有效期·上传/查看/删除 | 卡片式 |
| 底部 | 备注(full width) | — |

---

## 四、详情页 `/base/worker/:id`

### 整体布局

**条件性右侧边栏**：
- 该工人有 `familyGroupId`（亲属关联已开启）→ 宽屏首选**左 70% + 右 30%**，右栏使用有界宽度；容器不足时亲属列表移到主内容下方或转 Sheet
- 无亲属关联 → **全宽布局**

### 4.1 顶部摘要

```
[← 工人信息]  >  虞建华                                [编辑]

┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ 工种      │ 所属班组   │ 当前项目   │ 在场状态   │ 进场日期   │
│ 泥水工    │ 泥水A班   │ 合和新城   │ 在场(绿)  │ 2024-08-15│
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

### 4.2 右侧边栏（仅亲属关联启用时）

```
━━ 亲属关联
┌─────────────────────┐
│ 👤 虞建华（本人）      │
│    泥水A班 · 班组长    │
├─────────────────────┤
│ 👤 王芳（虞嫂）        │
│    泥水A班 · 普通工人  │
│    → 查看详情          │
├─────────────────────┤
│ [+ 关联亲属]          │
│ [解除全部关联]         │
└─────────────────────┘
```

- 列出同 `familyGroupId` 的所有工人
- 每人显示：姓名、班组、角色
- 点击"查看详情"跳转该工人详情页
- 可添加新关联 / 解除关联

### 4.3 内容区 — Tab 结构

详情页使用 Tab 切换，V1 完整设计 Tab 1，其余 Tab 定义数据结构但标注依赖状态。

```
[基本信息]  [施工区域记录]  [工资发放历史]  [考勤记录]  [扣罚记录]
```

---

### Tab 1 — 基本信息（V1 完整）

垂直 Section 堆叠：

#### Section: 个人信息

宽屏最多 3 列的自适应网格（CRM 模式），按容器宽度降为 2/1 列，label-value 格式：

| 字段 | 说明 |
|------|------|
| 姓名、性别、身份证号 | 第一行 |
| 联系电话、籍贯、紧急联系人/电话 | 第二行 |
| 工种、技能等级、参考日工资 | 第三行 |
| 所属班组、当前项目、在场状态 | 第四行 |
| 进场日期、退场日期、来源 | 第五行 |

#### Section: 三级安全教育

状态指示：已完成(ok) / 未完成(danger 警告)

未完成时显示警告：`该工人尚未完成三级安全教育，发放工资时将标红警告。`

#### Section: 证书档案

表格展示所有证书：

| 列 | 字段 | 备注 |
|----|------|------|
| 证书类别 | `category` | |
| 细分类型 | `subType` | 特种作业时显示 |
| 文件名 | `fileName` | 蓝色链接，点击预览 |
| 有效期 | `expiryDate` | 状态色：已过期=danger-soft底 / 30天内=warn-soft底 / 有效=ok-soft底 / 无有效期=neutral |
| 添加日期 | `addedAt` | font-mono |
| 操作 | — | 查看/下载/删除 |

工具栏：`[+ 上传证书]`

---

### Tab 2 — 施工区域记录（依赖 `subcontract-quantity` 模块）

> **V1 状态**：定义数据结构，待工程量模块完成后启用。

展示该工人在各项目中施工过的区域（楼栋→楼层→户→分项），按月份着色。

| 列 | 字段 | 备注 |
|----|------|------|
| 项目 | projectName | |
| 楼栋 | building | |
| 楼层 | floor | |
| 户号 | room | |
| 分项 | itemName | |
| 工程量 | qty + unit | font-mono |
| 完工月份 | month | 按月份着色（与矩阵一致） |

点击行可跳转至矩阵视图（`/subcontract/quantity`），自动定位到该工人。

**数据来源**：`quantity_records WHERE workerId = :id`

---

### Tab 3 — 工资发放历史（依赖 `subcontract-payroll` 模块）

> **V1 状态**：定义数据结构，待工资核算模块完成后启用。

按月份列出工资发放记录。

| 列 | 字段 | 备注 |
|----|------|------|
| 月份 | month | |
| 项目 | projectName | |
| 班组 | crewName | |
| 应发工程款 | grossAmount | font-mono，右对齐 |
| 补贴（房租+提成） | subsidyAmount | font-mono |
| 发放比例 | ratio | font-mono |
| 已发 | prevPaid | font-mono |
| 扣款 | deductions | font-mono，danger 色 |
| 本期实发 | netAmount | font-mono，font-800 |

点击行展开工程量明细（各分项的 qty × unitPrice）。

底部累计：`累计应发 ¥xxx · 累计已发 ¥xxx · 累计扣款 ¥xxx`

**数据来源**：`payroll_records WHERE workerId = :id`

---

### Tab 4 — 考勤记录（依赖 `subcontract-attendance` 模块）

> **V1 状态**：定义数据结构，待考勤模块完成后启用。

按月展示打卡记录表格。

| 内容 | 说明 |
|------|------|
| 月份选择器 | 切换查看月份 |
| 日历网格 | 每日出勤状态（出勤/缺勤/请假/迟到），月度汇总（出勤天数、缺勤天数） |
| 用途 | 计时工：按工时算工资依据；计件工：做合理性校验（有工程量但未出勤=异常） |

**数据来源**：`attendance_records WHERE workerId = :id`

---

### Tab 5 — 扣罚记录（只读，依赖扣罚来源模块）

> **V1 状态**：定义数据结构，待扣罚相关模块完成后启用。

展示该工人相关的所有扣罚记录，**只读不可编辑**。

| 列 | 字段 | 备注 |
|----|------|------|
| 日期 | penaltyDate | font-mono |
| 来源 | source | chip: 巡检/联系单/验收 |
| 项目 | projectName | |
| 位置 | location | 楼栋-楼层-户号 |
| 原因 | reason | |
| 金额 | amount | font-mono，右对齐 |
| 状态 | status | 待处理/已修复(抵消)/已扣罚 |
| 操作 | — | 查看详情（跳转源单据） |

底部累计：`累计扣罚 ¥xxx · 已修复抵消 ¥xxx · 实际扣款 ¥xxx`

**数据来源**：`penalty_records WHERE workerId = :id`（三个来源合并查询）

---

## 五、银行行号自查表

工人填写银行信息时，大部分人不知道自己的银行行号（联行号）。系统内置一张**银行行号匹配表**，自动匹配生成。

### 匹配逻辑

1. 用户输入**开户银行名称**（如"中国建设银行广州天河支行"）
2. 系统从行号表中模糊匹配，提取银行名称关键词（银行品牌 + 城市 + 支行名）
3. 匹配成功 → 自动填入行号字段，显示匹配结果供确认
4. 匹配失败 → 提示"未找到匹配行号，请手动输入"

### 行号数据源

| 方案 | 说明 |
|------|------|
| 内置 SQLite 表 | 打包常用银行行号（四大行+招商/交通/兴业等，覆盖广东省为主），约 5000-10000 条 |
| 后续扩展 | 支持导入完整行号 CSV，或对接央行行号查询 API |

### 行号表结构

```sql
CREATE TABLE bank_codes (
  id            INTEGER PRIMARY KEY,
  bankCode      TEXT NOT NULL,         -- 联行号（12位）
  bankName      TEXT NOT NULL,         -- 银行全称（如"中国建设银行股份有限公司广州天河支行"）
  bankShort     TEXT,                  -- 银行简称（如"建行天河支行"）
  province      TEXT,                  -- 省份
  city          TEXT,                  -- 城市
  bankBrand     TEXT                   -- 银行品牌（建设银行/工商银行/…）
);
CREATE INDEX idx_bank_codes_name ON bank_codes(bankName);
CREATE INDEX idx_bank_codes_brand_city ON bank_codes(bankBrand, city);
```

---

## 六、验收要点

1. `/base/worker` 列表页按 CRM 列表模式：汇总卡片 + vxe-table + 底部汇总 + 列头筛选
2. 详情页布局根据亲属关联动态切换：有亲属→70:30 分栏，无亲属→全宽
3. `familyGroupId` 替代 `linkedWorkerId`，支持 2-4 人多对多关联
4. V1 只完整实现 Tab 1（基本信息 + 银行信息 + 安全教育 + 证书），其余 Tab 数据结构已定义，待依赖模块完成后启用
5. 扣罚记录只读展示，三个来源（巡检/联系单/验收整改）合并查询
6. 三级安全教育未完成的工人在发放工资时标红警告
7. 证书有效期按三档着色：已过期=danger / 30天内=warn / 有效=ok
8. 身份证号列表中脱敏显示（前6后4），详情页完整展示
9. 银行行号通过内置匹配表自动填充，支持手动修改
10. 证书类别扩展：身份证/银行卡/安全培训/特种作业/检测报告/其他
