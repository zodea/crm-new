# 数据网格引擎选型：vxe-table 作为唯一底座，KitTable 深封装其上，不自研表格

> 状态：已采纳（2026-07-07）
> 影响：`app/components/ui/KitTable.vue`、`app/lib/kit/table.ts`、`app/plugins/vxe-table.ts`、`app/assets/css/vxe-theme.css`、现存 6 处裸用 vxe-table 的页面（后续统一收口到 KitTable）；`docs/rewrite/_archived/05-table-solution.md`（历史留档，本 ADR 取代其为权威源）。

## 背景

本项目的数据网格底座是 vxe-table（4.x），但它的选型理由此前只散落在 `docs/rewrite/_archived/05-table-solution.md`（2026-06-26 定稿、已归档、无 ADR 编号），且 `STYLE-GUIDE.md`「表格三件套」规范只讲行为契约、不指名库。结果是：一个既成且合理的选型没有可被发现的权威留痕——2026-07-07 就出现了「都用了 shadcn-vue 组件库，怎么 KitTable 还在用 vxe-table，是不是自造 UI」的质疑。

这个质疑基于一个误解：以为 [ADR 0008](0008-adopt-shadcn-vue-on-unocss.md) 采纳 shadcn-vue 就该把表格也统一过去。但 ADR 0008 的范围严格限定在**交互原语**（confirm / formModal / toast）+ 两个交互型原子（SegTab / SelectFilter），全文从未把数据网格纳入或排除——唯一涉及表格处是迁移映射表顺带确认「表体由 vxe-table 负责」。**交互原语与数据网格是两个正交的问题域**，需要各自的权威源。本 ADR 补上数据网格这条。

## 决策

**vxe-table 是数据网格的唯一底座；一切表格通过深封装 `KitTable` 使用；不自研表格引擎、也不为「门面统一」把数据网格迁到 shadcn Table + TanStack Table 手拼方案。**

以 codebase-design 的语言说清楚这个模块形状：

- **`KitTable` 是一个深模块**：小接口（列配置 `columns` + `data` + `page` + 具名插槽）包住 vxe-table 的大实现。调用方学一份列配置，就能拿到「表格三件套」铁律（≥10 行高度、容器内横滚不撑破页面、分页）+ 金额列 `¥#,##0.00` + 列头筛选 + 固定列，无需接触 vxe 的宽接口。
- **vxe-table 是坐在这个 seam 后面的引擎适配器**：虚拟滚动、固定列、多级表头、表尾合计、树表格这些「深行为」全在实现内，不进 `KitTable` 的接口。
- **「不自己造 table」的精确含义**：不去重新实现这些深行为（虚拟滚动、固定列 sticky/阴影、筛选 UI）。封装（在 vxe-table 上加约束、加插槽、统一令牌）是**加深模块**；重写引擎才是「自造 table」——两者是相反方向。
- **业务页面不裸用 vxe-table**：现存 6 处裸用（项目列表、分供方列表/详情、发票台账、分供方证照 Tab、项目子表）是待收口的历史欠账，统一入口是 `KitTable`。

## 考虑过的替代

- **shadcn Table + @tanstack/vue-table 手拼**（否决）：shadcn 官方明确 Table 只是语义化 `<table>` + 样式原语、不是数据网格方案，复杂表格「自己拿 TanStack Table 搭」；而 TanStack 也是 headless，虚拟滚动官方明说不内置（需再接 TanStack Virtual）、固定列 sticky/阴影/筛选 UI 全要自己写。这等于把 ADR 0008 想甩掉的「脏活」重新揽回来，与其初衷相悖，且要重写 KitTable + 6 处业务用法并重新踩生产边界坑，收益仅「门面统一」一项审美诉求。
- **AG Grid 等更重的商用网格**（否决）：能力过剩、体积/授权成本高，本域最复杂的工程量矩阵 vxe-table 已能撑。
- **维持散落裸用、不做 KitTable 封装**（否决）：分页/金额格式/滚动规则在 N 处各写一遍必然漂移（金额位数不一、漏掉容器滚动约束），正是 KitTable 要消除的重复。

## 后果

- **表格选型此后以本 ADR 为权威源**，`_archived/05-table-solution.md` 降为历史留档。任何「要不要换表格库」的新诉求，先核对本 ADR，不重新发起选型讨论（AGENTS.md 开工纪律）。
- **shadcn-vue 与 vxe-table 视觉对齐是「换皮」不是「换引擎」**：通过 `app/assets/css/vxe-theme.css` 用 CSS 变量把 vxe 默认主题桥接到设计令牌，与 KitTable 之外的 shadcn 组件视觉一致。这是持续项，不是迁移。
- **边界**：若未来出现「几行静态数据、无需固定列/虚拟滚动/复杂表头」的轻表格,可评估直接用语义化 `<table>`（更轻），不必套 KitTable/vxe——但当前所有场景都在「重型数据网格」这一侧，暂不引入第二套表格方案以免认知负担。
- vxe-table 的已知实现坑（如 `vxe-column` 的 `v-bind` 每次渲染产出新对象会触发列重注册死循环、需 `row-config.keyField='id'`）沉在 `KitTable` 实现内，不外泄给调用方。
