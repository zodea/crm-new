# 工程量管理 — 区域结构 + 矩阵可视化

> 路由: `/subcontract/quantity` · `/subcontract/quantity/:pid/:cid`
> 页面: `pages/subcontract/quantity/index.vue` · `pages/subcontract/quantity/[pid]/[cid].vue`
> 来源: DESIGN-project-worker §8 + §10

---

## 一、区域结构

树形区域：**楼栋 → 楼层 → 户 → 房间**

```sql
-- buildings
id TEXT PRIMARY KEY, projectId TEXT, name TEXT, sortOrder INTEGER

-- floors
id TEXT PRIMARY KEY, buildingId TEXT, name TEXT, sortOrder INTEGER

-- units（户）
id TEXT PRIMARY KEY, floorId TEXT, name TEXT, sortOrder INTEGER

-- rooms
id TEXT PRIMARY KEY, unitId TEXT, name TEXT, sortOrder INTEGER
```

**楼层结构复制**：大部分楼层结构一致，提供"快速匹配"按钮复制某层的户/房间到其他楼层。

**不同分项的适用区域不完全一样**：墙砖涉及客厅+卧室+卫生间，防水只涉及卫生间+厨房。通过勾选配置。

---

## 二、分项 + 工程量数据

```sql
-- items（分项定义：项目×分部/工种，不挂班组——分项是合同计量口径（BoQ 拆表产生），
-- 谁做记在 quantities.crewId/workerId，班组单价走 crew_project_items（2026-07-04 grill 修订）
id TEXT PRIMARY KEY, projectId TEXT
section TEXT, trade TEXT   -- 分部（如 装饰装修）/ 工种（如 泥水）
name TEXT, unit TEXT, sortOrder INTEGER

-- quantities（工程量记录）
id TEXT PRIMARY KEY
itemId TEXT, roomId TEXT, unitId TEXT, crewId TEXT, workerId TEXT
contractQty     REAL    -- 合同工程量
fieldFormula    TEXT    -- 现场复核计算式（含【备注】标注）
fieldQty        REAL    -- 现场工程量（由计算式算出）
provisionalQty  REAL    -- 暂定工程量（施工中发工资用）
completedMonth  TEXT    -- 完成月份 yyyy-mm（矩阵着色）
note            TEXT
```

**默认分配规则**：一个工人做了一个分项后，该分项内所有区域默认属于他，除非单独指定。

---

## 三、计算式引擎

支持带中文备注标注的四则运算。

```
7.55【边长】*（3.05【原顶高度】-0.08【踢脚线高度】）-1.2*（2.4-0.08）【门洞】
(3.6×2.4-0.8×2.1)×2 客厅南墙+北墙
```

解析规则：
1. 剥离 `【...】` 标注和纯中文文本
2. 全角→半角：`×→*` `÷→/` `（→(` `）→)`
3. 解析四则运算 + 括号嵌套
4. 结果填入 `fieldQty`

---

## 四、矩阵可视化

### 布局

```
┌──────────────────────────────────────────────────────────┐
│ [1栋] [2栋] [3栋]              ← 楼栋标签切换              │
├──────────────────────────────────────────────────────────┤
│ 月份：[2024.9] [2024.11] [2025.1] [2025.4]  ← 可多选     │
│ [✓突出未施工]  [✓突出当前月份]                              │
├──────┬──────┬──────┬──────┬──────┬──────────────────────┤
│      │ 01户 │      │ 02户 │      │ 03户               │
│ 楼层 │墙砖│地砖│墙砖│地砖│墙砖│地砖               │
├──────┼──────┼──────┼──────┼──────┼──────────────────────┤
│ 39F  │ 虞  │ 张  │ 虞  │ 张  │ 虞  │ 张              │
│ 38F  │ 匡  │ 张  │ 匡  │ 张  │ 匡  │ 张              │
└──────┴──────┴──────┴──────┴──────┴──────────────────────┘
```

### 格子内多分项布局

| 分项数 | 布局 |
|--------|------|
| 1 | 铺满整个格子 |
| 2 | 左右对半 |
| 3 | 上1下2 |
| 4 | 2×2 四宫格 |
| >4 | 只在 tooltip/弹窗中展示 |

### 月份色彩

系统预设 12 种高区分度颜色循环分配。交互：
- 月份按钮可多选
- 选中月份着色，未选中灰色
- "突出未施工"→空格子加红边框/虚线底

### Hover tooltip

工人姓名（夫妻两人都显示）+ 当月工程量

### Click 弹窗

- 该户该分项的所有房间/区域
- 每个区域的合同量/现场量/暂定量
- 施工工人 + 工程金额
- 罚款/扣款明细

点击工人姓名 → 跳转 `/base/worker/:id`
