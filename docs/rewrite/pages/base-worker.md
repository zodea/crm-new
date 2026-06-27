# 工人信息 — 列表 + 详情

> 路由: `/base/worker` · `/base/worker/:id`
> 页面: `pages/base/worker/index.vue` · `pages/base/worker/[id].vue`
> 来源: DESIGN-project-worker §2

---

## 数据模型

```ts
interface Worker {
  id: string             // "wkr_<timestamp>_<seq>"
  name: string           // 姓名（必填，≥2字）
  gender: string         // 性别：男 | 女
  idCard: string         // 身份证号（18位）
  phone: string          // 联系电话（必填）
  hometown: string       // 籍贯（省/市）
  emergencyContact: string
  emergencyPhone: string

  trade: string          // 工种（必填）：木工|泥工|钢筋工|电工|焊工|架子工|油漆工|防水工|水暖工|测量工|普工|机械操作工|其他
  skillLevel: string     // 初级|中级|高级|技师
  dailyWage: number | null
  team: string           // 所属班组

  currentProject: string // 当前项目名称
  projectStatus: '在场' | '已退场'
  entryDate: string
  exitDate: string

  certs: WorkerCert[]
  linkedWorkerId: string // 夫妻关联（矩阵合并显示）
  safetyEducation: boolean

  note: string
  source: 'manual' | 'import'
}

interface WorkerCert {
  id: string
  category: '身份证' | '安全培训合格证' | '特种作业操作证' | '其他'
  subType: string
  fileName: string
  relPath: string
  ext: string
  expiryDate: string
  addedAt: string
}
```

---

## 列表页 `/base/worker`

### 工具栏

标题 "工人信息库 · 共 N 人" + 搜索（姓名、工种、班组）+ 新增 + 导入/导出 Excel

### 汇总卡片（3 列）

| 卡片 | 颜色 | 数据 |
|------|------|------|
| 在场工人数 | brand | `.filter(w => w.projectStatus === '在场').length` |
| 已退场人数 | ink-soft | `.filter(w => w.projectStatus === '已退场').length` |
| 证书即将过期 | warn | 30 天内到期的证书数 |

### 表格列

| 列 | 字段 | 宽度 | 备注 |
|----|------|------|------|
| # | seq | 52px | fixed left |
| 姓名 | name | 80px | fixed left，蓝色链接→详情 |
| 工种 | trade | 80px | |
| 所属班组 | team | 90px | |
| 当前项目 | currentProject | min 120px | |
| 在场状态 | projectStatus | 80px | chip: 在场=蓝/已退场=灰 |
| 日工资 | dailyWage | 80px | ¥ 前缀 |
| 联系电话 | phone | 110px | |
| 操作 | — | 130px | fixed right: 详情/编辑/删除 |

---

## 详情页 `/base/worker/:id`

### Tab 1 — 基本信息

- 个人信息卡片（只读，右上"编辑"）
- 证书档案列表 + 有效期状态（已过期=红底、30天内=橙底、有效=绿底、无有效期=灰）
- 三级安全教育状态

### Tab 2 — 施工区域记录

该工人在各项目中施工过的区域（楼栋→楼层→户→分项），按月份着色，可跳转矩阵视图。

### Tab 3 — 工资发放历史

按月份列出工资发放记录（应发/比例/已发/扣款/实发）。点击展开工程量明细。累计对账。

### Tab 4 — 考勤记录

打卡记录月度表格。计时工按工时算工资依据，计件工做合理性校验。

---

## 表单分组（弹窗）

| 分组 | 字段 | 布局 |
|------|------|------|
| 个人信息 | 姓名*、性别、身份证号(full)、联系电话*、籍贯、紧急联系人、紧急联系电话 | 2列 |
| 工作信息 | 工种*、技能等级、日工资、所属班组 | 2列 |
| 项目分配 | 当前项目(combobox)、在场状态、进场日期、退场日期 | 2列 |
| 证书档案 | 证书列表，每条：类别·文件名·有效期·上传/查看/删除 | 卡片式 |
| 底部 | 备注(full) | — |

---

## 夫妻关联

`linkedWorkerId` 用于两口子关联。矩阵中只显示一人，tooltip 和弹窗显示两人的工程量和金额。工资完全独立。仅泥水工场景。

## 三级安全教育

未完成的工人发放工资时禁止或标红警告。
