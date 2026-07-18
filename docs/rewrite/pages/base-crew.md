# 基础信息/班组管理 — 列表 + 详情 + 项目配置

> 路由: `/base/crew` · `/base/crew/:id`
> 页面: `pages/base/crew/index.vue` · `pages/base/crew/[id].vue`
> 交互模式: `CRM-PATTERNS.md` · 色值: `DESIGN-SYSTEM.md` v5
> 原型参考: `DC重构设计源码/kit/CrewScreen.jsx` · `CrewDetailScreen.jsx`（圆角卡片版，见 ADR 0007；旧扁平稿已删除）

---

## 定位

**Crew（班组）** 是跨项目共享的全局实体，独立于项目存在。一个班组可同时参与多个项目，各项目下的分项单价和补贴参数独立配置。约 20+ 个班组，各自独立核算。

边界原则：

| 在本页面做 | 不在本页面做 |
|---|---|
| 新增/编辑班组基本信息 | 录入工程量（→ `subcontract-quantity`） |
| 管理班组成员（关联/移除工人） | 计算工资（→ `subcontract-payroll`） |
| 配置班组×项目的分项单价和补贴参数 | 录入/审批扣罚（→ 扣罚来源模块） |
| 配置工人个人计薪规则（计件/计时、比例覆盖） | 管理考勤（→ `subcontract-attendance`） |
| **只读展示**该班组关联的扣罚记录 | |

---

## 一、核心概念

### 1.1 单价粒度

单价 = **班组 × 项目 × 分项**，三维度交叉。同一班组在不同项目中单价可以不同。

### 1.2 配置层级

| 层级 | 归属表 | 内容 |
|------|--------|------|
| **班组级** | `crews` | 基本信息（名称/工种/负责人/电话/备注） |
| **班组×项目级** | `crew_project_config` + `crew_project_prices` | 分项单价、补贴开关+金额、默认发放比例 |
| **班组×工人级** | `crew_workers` | 计薪方式、个人发放比例覆盖、房租/提成覆盖 |

关键原则：
- **单价跟项目走**——不同项目单价不同
- **工人配置跟班组走**——同一人不按项目区分计薪规则
- **扣罚不在本页面维护**——扣罚数据有三个来源（管理人员发现、甲方/监理处罚联系单、完工验收整改罚单），归属工资核算和项目进度模块，本页面只做只读展示

### 1.3 模板系统

| 模板类型 | 粒度 | 用途 |
|----------|------|------|
| 分项+单价模板 | 按班组 | 创建新班组-项目配置时快速填充分项列表，单价各自设置 |
| 工资表模板 | 按班组 | 导出格式（表头结构、审批栏、备注条款） |

共用的是模板的格式/排版/结构。创建新配置时可从模板复制分项列表。

---

## 二、数据模型（SQLite）

### crews

```sql
CREATE TABLE crews (
  id            TEXT PRIMARY KEY,       -- "crew_<timestamp>_<seq>"
  name          TEXT NOT NULL,          -- 班组名称（如"泥水A班"）
  trade         TEXT,                   -- 工种类型
  contactName   TEXT,                   -- 班组负责人
  contactPhone  TEXT,
  note          TEXT,
  createdAt     TEXT,
  updatedAt     TEXT
);
```

### crew_workers（班组×工人，多对多）

```sql
CREATE TABLE crew_workers (
  id            TEXT PRIMARY KEY,
  crewId        TEXT NOT NULL REFERENCES crews(id),
  workerId      TEXT NOT NULL,
  role          TEXT,                   -- '班组长' | '普通工人'
  payMode       TEXT NOT NULL DEFAULT 'piece',  -- 'piece'(计件) | 'time'(计时)
  dailyWage     REAL,                   -- 计时工日工资（元/天），计件工为 NULL
  rentOverride  TEXT,                   -- NULL=班组默认, 'on'=开启, 'off'=关闭
  mgmtOverride  TEXT,                   -- NULL=班组默认, 'on'=开启, 'off'=关闭
  ratioOverride REAL,                   -- NULL=班组默认, 0~1 覆盖发放比例
  joinedAt      TEXT,

  UNIQUE(crewId, workerId)
);
```

### crew_project_config（班组×项目配置）

```sql
CREATE TABLE crew_project_config (
  id                  TEXT PRIMARY KEY,
  crewId              TEXT NOT NULL REFERENCES crews(id),
  projectId           TEXT NOT NULL,
  defaultPayRatio     REAL NOT NULL DEFAULT 0.95,   -- 默认发放比例
  rentSubsidyEnabled  INTEGER NOT NULL DEFAULT 1,   -- 房租补贴开关
  rentSubsidyPrice    REAL DEFAULT 3.0,             -- 房租补贴单价（元/㎡）
  mgmtFeeEnabled      INTEGER NOT NULL DEFAULT 1,   -- 管理提成开关
  mgmtFeePrice        REAL DEFAULT 1.5,             -- 管理提成单价（元/㎡）

  UNIQUE(crewId, projectId)
);
```

### crew_project_items（班组×项目×分项单价）

```sql
CREATE TABLE crew_project_items (
  id                  TEXT PRIMARY KEY,
  configId            TEXT NOT NULL REFERENCES crew_project_config(id),
  itemName            TEXT NOT NULL,          -- 分项名称（如"墙砖铺贴"）
  unit                TEXT NOT NULL,          -- 单位（㎡/m/套）
  unitPrice           REAL NOT NULL,          -- 含税单价（元）
  inRentSubsidy       INTEGER DEFAULT 1,      -- 是否参与房租补贴计算
  inMgmtFee           INTEGER DEFAULT 1,      -- 是否参与管理提成计算
  sortOrder           INTEGER DEFAULT 0
);
```

### penalty_records（扣罚记录，跨模块共享）

```sql
CREATE TABLE penalty_records (
  id              TEXT PRIMARY KEY,
  projectId       TEXT NOT NULL,          -- → projects.id
  crewId          TEXT,                   -- → crews.id（可选）
  workerId        TEXT,                   -- → workers.id（可选）

  -- 来源
  source          TEXT NOT NULL,          -- 'inspection'(管理巡检) | 'owner_notice'(甲方/监理联系单) | 'acceptance'(完工验收整改)
  noticeNo        TEXT,                   -- 联系单编号（来源=owner_notice 时）

  -- 位置
  building        TEXT,                   -- 楼栋
  floor           TEXT,                   -- 楼层
  room            TEXT,                   -- 户号/房间
  location        TEXT,                   -- 位置描述（自由文本）

  -- 扣罚内容
  reason          TEXT NOT NULL,          -- 扣罚原因
  amount          REAL NOT NULL DEFAULT 0,-- 罚款金额（元）
  penaltyDate     TEXT NOT NULL,          -- 发生日期
  chargeMethod    TEXT,                   -- 计费方式说明（如"按面积扣除""按项扣除"等）

  -- 责任人（谁造成的问题 + 谁录入的）
  responsibleWorkerId  TEXT,              -- → workers.id，责任工人（被扣罚的人）
  responsibleWorkerName TEXT,             -- 责任工人姓名（冗余，显示用）
  reportedBy      TEXT,                   -- 发现/录入人（管理人员姓名）
  repairedByWorkerId TEXT,               -- 代修工人 ID（repaired_other 时）
  repairedByWorkerName TEXT,             -- 代修工人姓名（冗余）

  -- 整改
  deadline        TEXT,                   -- 整改期限
  status          TEXT NOT NULL DEFAULT 'pending',
    -- 'pending'(待处理) | 'repairing'(整改中) | 'repaired_self'(自行修复,可抵消) | 'repaired_other'(他人代修,扣罚) | 'deducted'(已扣罚)
  repairedAt      TEXT,                   -- 实际修复完成时间
  deductedAt      TEXT,                   -- 扣罚执行时间

  note            TEXT,
  createdAt       TEXT,
  updatedAt       TEXT
);
-- 附件（整改前后照片/联系单扫描件）通过 FileRef 关联：ownerType='penalty_record', ownerId=penalty_records.id
-- FileRef.category 值：'before_photo'(整改前) | 'after_photo'(整改后) | 'notice_scan'(联系单) | 'other'
```

### 索引

```sql
CREATE INDEX idx_crew_workers_crew ON crew_workers(crewId);
CREATE INDEX idx_crew_workers_worker ON crew_workers(workerId);
CREATE INDEX idx_crew_project_config_crew ON crew_project_config(crewId);
CREATE INDEX idx_crew_project_config_project ON crew_project_config(projectId);
CREATE INDEX idx_crew_project_items_config ON crew_project_items(configId);
CREATE INDEX idx_penalty_records_project ON penalty_records(projectId);
CREATE INDEX idx_penalty_records_crew ON penalty_records(crewId);
CREATE INDEX idx_penalty_records_worker ON penalty_records(workerId);
```

> 完整实体关系和外键索引见 → `DATABASE.md`
> 附件/照片通过 `file_refs` 多态关联，详见 `DATABASE.md § 3.5`

---

## 三、列表页 `/base/crew`

### 工具栏

```
班组管理 · 共 N 个
[搜索班组名/负责人] [刷新] [列设置] [筛选] [+ 新建]
```

### 表格列（vxe-table）

| 列 | 字段 | 宽度 | 备注 |
|----|------|------|------|
| # | seq | 52px | fixed left |
| 班组名称 | `name` | min 120px | 蓝色链接→详情，fixed left |
| 工种 | `trade` | 80px | 可筛选 |
| 负责人 | `contactName` | 80px | |
| 联系电话 | `contactPhone` | 110px | font-mono |
| 工人数 | computed | 80px | COUNT(crew_workers) |
| 关联项目数 | computed | 90px | COUNT(crew_project_config) |
| 备注 | `note` | flex | 长文本省略 |
| 操作 | — | 130px | 详情/编辑/删除，fixed right |

### 筛选

| 筛选项 | 说明 |
|--------|------|
| 工种 | 泥水工/木工/钢筋工/水暖工/防水工/其他 |
| 关联项目 | 只看某项目的班组 |
| 是否有配置 | 已配置单价 / 未配置 |

### 底部汇总栏

```
共 N 个班组 · 在场工人 M 人
```

---

## 四、新增/编辑班组

弹窗表单宽屏最多 2 列，字段最小可读宽度不足时自动单列。

| 分区 | 字段 | 说明 |
|------|------|------|
| 基本信息 | 班组名称*、工种类型*、备注 | 名称不可重复 |
| 负责人 | 负责人姓名、联系电话 | |

保存后跳转至详情页。

---

## 五、详情页 `/base/crew/:id`

### 整体布局

**全宽布局**，无右侧边栏。顶部摘要 + 内容 Section 垂直堆叠。

### 5.1 顶部

```
[← 班组管理]  >  泥水A班                               [编辑]

┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ 工种类型   │ 负责人    │ 联系电话   │ 工人数    │ 关联项目数 │
│ 泥水工    │ 虞师傅    │ 137xxx   │ 8 人     │ 2 个      │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

- 面包屑导航：蓝色"班组管理"可点击返回列表
- 信息摘要行：宽屏最多 5 格等宽，按容器最小可读宽度自动降列，1px 分隔（CRM 模式）
- 右上角编辑按钮打开编辑弹窗

### 5.2 内容区 — Section 垂直堆叠

详情页下方分为 3 个 Section，垂直排列，不使用 Tab 切换：

```
━━ 工人配置（班组级）
   [工人配置表格]

━━ 项目配置（班组×项目级）
   [项目选择器]
   [分项单价表格]
   [补贴 & 比例参数]

━━ 扣罚记录（只读）
   [该班组的扣罚记录表格]
```

---

### 5.3 Section 1 — 工人配置

该班组所有关联工人的个人计薪配置。数据存储在 `crew_workers` 表，**班组级**，不跟项目走。

#### 工具栏

```
工人配置 · 共 N 人                    [关联工人] [移除]
```

#### 表格列

| 列 | 字段 | 宽度 | 备注 |
|----|------|------|------|
| 工人 | worker.name | min 100px | 蓝色链接→工人详情；班组长显示 chip；有亲属关联显示 `↔ 姓名` |
| 计薪方式 | `payMode` | 80px | chip: 计件=brand / 计时=neutral；计时工附带 `{dailyWage}元/天` |
| 房租补贴 | `rentOverride` | 90px | NULL→"班组默认"(neutral) / on→"开启"(ok) / off→"关闭"(neutral) |
| 管理提成 | `mgmtOverride` | 90px | 同上 |
| 发放比例 | `ratioOverride` | 90px | NULL→"班组默认"(ink-faint) / 有值→`{ratio*100}%`(font-700) |
| 操作 | — | 80px | 编辑 |

#### 编辑弹窗

点击"编辑"打开弹窗，修改单个工人的配置：

| 字段 | 控件 | 说明 |
|------|------|------|
| 计薪方式 | 按钮组: 计件 / 计时 | 切换后联动显示不同字段 |
| 日工资 | 数字输入 | 仅计时模式显示 |
| 房租补贴 | 三选一: 班组默认 / 开启 / 关闭 | 仅计件模式显示 |
| 管理提成 | 三选一: 班组默认 / 开启 / 关闭 | 仅计件模式显示 |
| 发放比例 | 数字输入（%），留空=班组默认 | 仅计件模式显示 |

---

### 5.4 Section 2 — 项目配置

该班组在各项目下的分项单价和补贴参数。数据存储在 `crew_project_config` + `crew_project_items`，**班组×项目级**。

#### 项目选择器

Section 标题栏右侧有**项目下拉选择器**，列出该班组所有关联项目（`crew_project_config` 记录）。切换项目后，下方表格和参数同步更新。

```
━━ 项目配置                          项目: [▼ 合和新城]  [+ 新增项目配置]
```

未关联任何项目时显示空状态：`尚未配置任何项目，点击"新增项目配置"开始。`

#### 分项单价表格

| 列 | 字段 | 宽度 | 备注 |
|----|------|------|------|
| 分项名称 | `itemName` | min 120px | font-600 |
| 单位 | `unit` | 60px | ink-soft |
| 单价（元） | `unitPrice` | 90px | font-mono font-700，右对齐 |
| 房租补贴 | `inRentSubsidy` | 80px | chip: ✓(ok) / —(neutral) |
| 管理提成 | `inMgmtFee` | 80px | chip: ✓(ok) / —(neutral) |
| 操作 | — | 80px | 编辑/删除 |

工具栏：`[+ 添加分项] [从模板复制]`

#### 分项编辑弹窗

| 字段 | 控件 | 说明 |
|------|------|------|
| 分项名称 | 文本输入 | 必填 |
| 单位 | 文本输入 | 默认"㎡" |
| 单价（元） | 数字输入 | 必填 |
| 参与房租补贴 | checkbox | |
| 参与管理提成 | checkbox | |

#### 补贴 & 比例参数

分项表下方，宽屏最多 3 列卡片布局；容器不足时自动降为 2/1 列：

```
┌── 房租补贴 ──────┐  ┌── 管理提成 ──────┐  ┌── 默认发放比例 ──┐
│ [✓] 启用          │  │ [✓] 启用          │  │                  │
│ 单价: [3.0] 元/㎡ │  │ 单价: [1.5] 元/㎡ │  │ 比例: [95] %     │
│                   │  │                   │  │ 工人可单独覆盖    │
└───────────────────┘  └───────────────────┘  └──────────────────┘
                                                      [保存参数]
```

每张卡片：1px border + 10px 圆角，标题 14px font-700，开关+数字输入。

---

### 5.5 Section 3 — 扣罚记录（只读）

展示该班组相关的所有扣罚记录，**数据来源于其他模块，本页面只读不可编辑**。

#### 扣罚三个来源

| 来源 | 说明 | 发起模块 |
|------|------|----------|
| 管理人员发现 | 施工过程中我方管理人员巡检发现的问题 | 项目管理 |
| 甲方/监理处罚联系单 | 施工过程中甲方或监理下发的处罚通知 | 项目管理 |
| 完工验收整改罚单 | 完工后验收发现的整改项；分为自行修复（可抵消）和他人代修（扣罚） | 项目管理 |

#### 表格列

| 列 | 字段 | 宽度 | 备注 |
|----|------|------|------|
| 日期 | penaltyDate | 100px | font-mono |
| 来源 | source | 100px | chip: 巡检/联系单/验收 |
| 项目 | projectName | min 120px | |
| 位置 | location | min 100px | 楼栋-楼层-户号（可选） |
| 原因 | reason | flex | |
| 金额 | amount | 90px | font-mono，右对齐，¥ 前缀 |
| 状态 | status | 80px | 待处理/已修复(抵消)/已扣罚 |
| 操作 | — | 60px | 查看详情（跳转源单据） |

空状态：`暂无扣罚记录。`

---

## 六、新增项目配置

点击"新增项目配置"按钮打开弹窗：

| 步骤 | 内容 |
|------|------|
| 1. 选择项目 | 项目下拉（排除已配置的项目） |
| 2. 初始化分项 | 三选一：空白 / 从模板复制 / 从该班组其他项目复制 |
| 3. 设置参数 | 默认发放比例、房租补贴开关+单价、管理提成开关+单价 |

保存后自动选中新项目，展示空的分项表等待填充。

---

## 七、验收要点

1. `/base/crew` 列表页按 CRM 列表模式：工具栏 + vxe-table + 底部汇总 + 列头筛选
2. 详情页全宽布局，无右侧边栏，Section 垂直堆叠
3. 工人个人配置（计薪/比例/覆盖）存储在班组级，不按项目区分
4. 分项单价和补贴参数通过**项目选择器**切换，按班组×项目级存储
5. 扣罚记录只读展示，数据来源于项目管理/工资核算模块
6. 扣罚有三个来源：管理人员巡检、甲方/监理联系单、完工验收整改罚单
7. 新建项目配置支持从模板或其他项目复制分项列表
8. 编辑弹窗中计件/计时切换后联动显示不同字段
