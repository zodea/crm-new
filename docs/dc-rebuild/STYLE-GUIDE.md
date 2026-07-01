# 统一视觉规范（DC 重构）

> 基准来源：`kit/HomeScreenNew.jsx`（首页）+ `kit/QuantityScreenV2.jsx`（工程量）——用户亲自调过、认可的「疏朗仪表盘」风格。
> 所有重构页面以本规范为准；与 `docs/rewrite/DESIGN-SYSTEM.md` 旧扁平条款冲突时，**以本文件为准**。

---

## 一、总体气质
现代 SaaS 仪表盘观感：**圆润卡片 + 轻阴影 + 充足留白 + 克制线条**。
反面（要避免）：密集表格台账、横条工具栏挤满按钮、重网格线、多行紧凑筛选。

---

## 二、Design Token（沿用，勿新增颜色）
| 用途 | token | 值 |
|---|---|---|
| 品牌蓝 | `--brand` / `--brand-deep` / `--brand-soft` | `#3976C6` / `#2A5996` / 浅蓝 |
| 卡片圆角 | `--radius-card` | 12px |
| 按钮/输入圆角 | `--radius-btn` | 8px |
| pill | `--radius-pill` | 999px |
| 卡片阴影 | `--shadow-card` | 轻阴影（L1）|
| 浮层阴影 | `--shadow-pop` | 弹窗/下拉（L2）|
| 面板底 | `--panel` | #fff |
| 画布底 | `--bg` | 浅灰 |
| 表头/次级底 | `--surface-2` | |
| hover 底 | `--surface-3` | |
| 描边 | `--line` / `--line-strong` | 默认 / 输入按钮 |
| 文字 | `--ink` / `--ink-soft` / `--ink-faint` | 主 / 次 / 弱 |
| 状态 | `--ok` / `--warn` / `--danger`（+ `-soft` 底 / `-ink` 深字）| |
| 等宽数字 | `--font-mono` | 金额/编号/日期 tabular-nums |

---

## 三、组件级规范

### 3.1 卡片容器
统一用 DS `Panel`（`window.DesignSystem_e3d871.Panel`）——它已内置 `var(--panel)` 底 + 1px `--line` 边 + `--radius-card` 圆角 + `--shadow-card` 阴影。
- 普通卡：`<Panel padding={14~18}>`
- 表格/列表卡：`<Panel padding={0} style={{overflow:"hidden"}}>`，内部表格自带表头/分隔
- 页面区块之间：`gap: 16`

### 3.2 标题层级
| 级别 | 规格 |
|---|---|
| 页面大标题 | 顶栏 `pageTitle`（18/800）+ 副标题（12/ink-soft），由 `app.dc.html` 的 `PAGE` 表提供 |
| 区块标题 | 14~15px / 700 |
| Section 标题 | 15/800，**前置 4×16 品牌色竖条**（`SectionHeader` 原子）|
| 字段 label | 11~12px / 600 / ink-soft 或 ink-faint |

### 3.3 数字
金额/编号/数量/日期一律 `fontFamily: var(--font-mono)`；指标大数字 24/800；表内金额右对齐、`font-700`。

### 3.4 按钮
- 主操作：`<Button variant="primary" icon="...">`（品牌底白字，radius 8）
- 次级：`<Button icon="...">`
- 危险：`<Button variant="danger">`
- 图标按钮：`<IconButton icon="..." tone="danger?" title="...">`（操作列）
- 小号：`size="sm"`

### 3.5 Tab —— 下划线分段 tab（统一首页视觉）
不要用方块 / StageTab。统一 `SegTab` 原子：
- 容器 `borderBottom: 1px var(--line)`，**`flexWrap:"wrap"`，禁止 `overflowX:auto`**（否则出横向滚动条）
- 选中：文字 `--brand-deep` + 700 + 底部 `2px solid --brand`（`marginBottom:-1`）
- 未选中：`--ink-soft` / 500
- 可带计数 pill（选中 brand-soft 底，未选中 surface-3 底，mono）

### 3.6 筛选 —— 下拉框 `SelectFilter`（多分类首选，用户要求）
列表页的**多分类/多状态筛选**统一用紧凑下拉框，**并入工具栏**，不再单独占一行 pill：
- `SelectFilter` 原子：`label`（12/700/ink-soft）+ 原生 `<select>`（`appearance:none`）+ 自绘 `chevron-down`
- select：1px `--line-strong` 边 + `--radius-btn` 圆角 + 13/600，padding `7px 30px 7px 12px`
- 放在工具栏标题之后、搜索/操作之前；多个并排，`gap:14`
- 理由：pill 平铺把所有分类列出来显得臃肿，下拉框收敛为一个控件即可

> pill（选中 `--brand-soft` 底 + `--brand` 边）现在**只用于「可点击汇总卡」「单/双值开关」之类的状态切换**（如工人页在场/退场卡、分区标签栏），不再用于多分类筛选。

### 3.7 表格
- 容器：`Panel padding={0}`，`overflowX:auto`
- 表头：`background: var(--surface-2)`，12/700/ink-soft，下边框 1px line
- 行：分隔 1px `--line`；hover `--surface-3`（JS onMouseEnter/Leave 切 background）
- 单元格：`padding: 13~16px`（疏朗）；金额/操作列右对齐
- 首列序号 ink-soft；名称列做蓝色链接（→ 详情）
- 操作列：右对齐，一排 `IconButton`（详情/编辑/删除…）
- 底部汇总条：`padding 12~16`，`--surface-2` 底，左统计 + 右分页

### 3.8 状态标签
`<StatusChip tone="ok|warn|danger|brand|neutral">文字</StatusChip>`（pill 浅底深字）。
列表内状态也可用纯文字色（在场=ok-ink、退场=ink-soft）。

### 3.9 信息网格（详情页字段展示，`InfoGrid` 原子）
3 列网格，1px line 分隔，每格：label（11/ink-faint）+ value（13；金额/编号用 mono）。

---

## 四、页面级模板

### 4.1 列表页模板
```
工具栏卡（Panel padding14）
  左：标题 + 「共 N 项」计数
  右：搜索框(pill) + [刷新][列设置][导入][导出][+ 新建/主操作]
（可选）汇总卡行：等分 StatCard / 可点击 SumCard（点击切换筛选，选中 brand-soft）
筛选卡（Panel padding14）：1~2 行 FilterRow
表格卡（Panel padding0）：表头 + 行 + 底部汇总/分页
```

### 4.2 详情页模板
```
顶部摘要卡（Panel padding0）
  行1：[← 返回列表] + 头像方块 + 标题 + 副信息 + 右侧 [编辑] 等
  行2：摘要格行（等宽 N 格，1px 分隔，label+value）
主体：
  · Tab 型（分供方/工人）：SegTab 条 + 各 Tab 内容；依赖未完成的 Tab 用占位卡
  · Section 型（班组）：SectionHeader + 内容，垂直堆叠
  · 可选右栏（条件）：如工人有亲属 → 左 1fr + 右 300px；否则全宽
```

### 4.3 占位卡（依赖模块未完成的 Tab）
居中：图标 + 标题 + 「数据结构已定义，待 X 模块完成后启用（V1）」。

---

## 五、动效（克制）
- hover 过渡：`transition: ... var(--dur-fast) var(--ease-snappy)`
- 卡片/行 hover：边框转 brand 或底色转 surface-3
- 禁止：路由动画、表格行持续动画、金额滚动、视差
- 导出完成动效（蓝色水波）见 `DESIGN-SYSTEM.md §7.3`，本轮未实现，后续补
