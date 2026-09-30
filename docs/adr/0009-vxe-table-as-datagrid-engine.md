# 数据网格引擎选型：vxe-table 作为唯一底座，KitTable 深封装其上，不自研表格

> 状态：已采纳（2026-07-07）
> 影响：`app/components/ui/KitTable.vue`、`app/lib/kit/table.ts`、`app/plugins/vxe-table.ts`、`app/assets/css/vxe-theme.css`及其业务调用处。本 ADR 已接管并取代早期表格选型说明。

## 背景

数据网格与 Dialog、toast 等交互原语承担不同职责：vxe-table 负责网格能力，reka-ui/shadcn-vue 负责交互底座，二者可以共存。

## 决策

**vxe-table 是数据网格的唯一底座；一切表格通过深封装 `KitTable` 使用；不自研表格引擎、也不为「门面统一」把数据网格迁到 shadcn Table + TanStack Table 手拼方案。**

以 codebase-design 的语言说清楚这个模块形状：

- **`KitTable` 是一个深模块**：小接口（列配置 `columns` + `data` + `page` + 具名插槽）包住 vxe-table 的大实现。调用方学一份列配置，就能拿到「表格三件套」铁律（≥10 行高度、容器内横滚不撑破页面、分页）+ 金额列 `¥#,##0.00` + 列头筛选 + 固定列，无需接触 vxe 的宽接口。
- **vxe-table 是坐在这个 seam 后面的引擎适配器**：虚拟滚动、固定列、多级表头、表尾合计、树表格这些「深行为」全在实现内，不进 `KitTable` 的接口。
- **「不自己造 table」的精确含义**：不去重新实现这些深行为（虚拟滚动、固定列 sticky/阴影、筛选 UI）。封装（在 vxe-table 上加约束、加插槽、统一令牌）是**加深模块**；重写引擎才是「自造 table」——两者是相反方向。
- **统一领域无关能力**：数据网格优先通过 `KitTable` 使用；封装遵循当前 vxe-table 官方公开 API 与扩展方式，业务逻辑留在领域组件。不要因封装未暴露某能力而重新实现已有网格机制。

## 考虑过的替代

- **shadcn Table + @tanstack/vue-table 手拼**（否决）：shadcn 官方明确 Table 只是语义化 `<table>` + 样式原语、不是数据网格方案，复杂表格「自己拿 TanStack Table 搭」；而 TanStack 也是 headless，虚拟滚动官方明说不内置（需再接 TanStack Virtual）、固定列 sticky/阴影/筛选 UI 全要自己写。这等于把 ADR 0008 想甩掉的「脏活」重新揽回来，与其初衷相悖，且要重写 KitTable 及其业务调用并重新踩生产边界坑，收益仅「门面统一」一项审美诉求。
- **AG Grid 等更重的商用网格**（否决）：能力过剩、体积/授权成本高，本域最复杂的工程量矩阵 vxe-table 已能撑。
- **维持散落裸用、不做 KitTable 封装**（否决）：分页/金额格式/滚动规则在 N 处各写一遍必然漂移（金额位数不一、漏掉容器滚动约束），正是 KitTable 要消除的重复。

## 后果

- **表格选型此后只以本 ADR 为权威源**。早期方案已从工作树删除，需要时从 Git 历史查看。现有能力或官方扩展不足时，说明缺口、候选与迁移影响，经用户确认后再调整封装契约或底层方案。
- **shadcn-vue 与 vxe-table 视觉对齐是「换皮」不是「换引擎」**：通过 `app/assets/css/vxe-theme.css` 用 CSS 变量把 vxe 默认主题桥接到设计令牌，与 KitTable 之外的 shadcn 组件视觉一致；对齐终点是设计稿令牌与 [ADR 0013](0013-align-all-ui-to-online-design.md) 基准，不是 vxe/shadcn 默认样式。这是持续项，不是迁移。
- **边界**：若未来出现「几行静态数据、无需固定列/虚拟滚动/复杂表头」的轻表格,可评估直接用语义化 `<table>`（更轻），不必套 KitTable/vxe；新增依赖或改变既定方案仍须用户确认。
- vxe-table 的已知实现坑（如 `vxe-column` 的 `v-bind` 每次渲染产出新对象会触发列重注册死循环、需 `row-config.keyField='id'`）沉在 `KitTable` 实现内，不外泄给调用方。
