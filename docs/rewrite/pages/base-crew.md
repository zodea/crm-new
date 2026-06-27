# 班组管理 — 列表 + 详情 + 项目配置

> 路由: `/base/crew` · `/base/crew/:id`
> 页面: `pages/base/crew/index.vue` · `pages/base/crew/[id].vue`
> 来源: DESIGN-project-worker §7

---

## 核心概念

班组是**全局实体**，独立于项目存在，可复用跨项目。约 20+ 个班组，各自独立核算。

**单价粒度**：单价 = 班组 × 项目 × 分项，三维度交叉。同一班组在不同项目中单价可以不同。

**共用机制**：共用的是模板的格式/排版/结构。创建新配置时可从模板复制分项列表，单价各自设置。

---

## 数据模型（SQLite）

```sql
-- crews 表
id            TEXT PRIMARY KEY    -- "crew_<timestamp>_<seq>"
name          TEXT NOT NULL       -- 班组名称（如"泥水A班"）
trade         TEXT                -- 工种类型
contactName   TEXT                -- 班组负责人
contactPhone  TEXT
note          TEXT
createdAt     TEXT

-- crew_workers 表（多对多）
crewId        TEXT REFERENCES crews(id)
workerId      TEXT
role          TEXT                -- 班组长 | 普通工人
joinedAt      TEXT

-- crew_project_config 表（班组在某项目中的配置）
id                  TEXT PRIMARY KEY
crewId              TEXT REFERENCES crews(id)
projectId           TEXT
defaultPayRatio     REAL          -- 默认发放比例（如 0.9）
rentSubsidyEnabled  INTEGER       -- 房租补贴开关
rentSubsidyPrice    REAL          -- 房租补贴单价（元/㎡）
rentSubsidyItemIds  TEXT          -- 参与分项 ID（JSON array）
mgmtFeeEnabled      INTEGER       -- 管理提成开关
mgmtFeePrice        REAL
mgmtFeeItemIds      TEXT

-- crew_project_prices 表（班组×项目×分项→单价）
crewProjectConfigId  TEXT REFERENCES crew_project_config(id)
itemId               TEXT
unitPrice            REAL
```

---

## 列表页 `/base/crew`

工具栏：标题 "班组管理 · 共 N 个" + 搜索 + 新增

| 列 | 字段 | 宽度 | 备注 |
|----|------|------|------|
| # | seq | 52px | |
| 班组名称 | name | min 120px | 蓝色链接→详情 |
| 工种 | trade | 80px | |
| 负责人 | contactName | 80px | |
| 工人数 | workerCount | 80px | 关联工人数 |
| 关联项目数 | projectCount | 90px | |
| 操作 | — | 130px | 详情/编辑/删除 |

---

## 详情页 `/base/crew/:id`

### Tab 1 — 基本信息

班组信息卡片（只读，右上"编辑"）

### Tab 2 — 工人列表

关联工人列表，可新增/移除关联。

### Tab 3 — 项目配置

该班组关联的各项目配置列表。每个项目配置可展开：
- 分项单价表（可编辑）
- 房租补贴：开关 + 单价 + 参与分项多选
- 管理提成：开关 + 单价 + 参与分项多选
- 默认发放比例

---

## 模板系统

| 模板类型 | 粒度 | 用途 |
|----------|------|------|
| 分项+单价模板 | 按班组 | 创建新班组-项目配置时快速填充分项列表 |
| 工资表模板 | 按班组 | 导出格式（表头结构、审批栏、备注条款） |
