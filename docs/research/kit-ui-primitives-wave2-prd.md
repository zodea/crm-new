# PRD：KitUI 交互原语第二波（红圈对标）

> **非权威历史 PRD。** 以下 API、组件命名、验收勾选和实施顺序是 2026-07 的提案快照，不是当前实现合同。现行结构与 API 见 [KitUI 组件规格](../design/kit-ui-component-specs.md)，整页实体表单见 [ADR 0014](../adr/0014-full-page-entity-forms.md)，数据来源边界见 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md)；本轮复核进入 [#404](https://github.com/zodea/crm-new/issues/404)。其中 Lookup 最近选择不能按下文旧 `localStorage` 示例新增平行持久化路径，也不能跨正式/演示来源复用。

> 依据：2026-07-11 红圈线上走查，[非权威差距证据](../research/red-circle-ui-gap-2026-07-11.md) §1/§2/§6；当前范围与状态以 GitHub Issues 和 ADR 0014 / 0015 为准。
> 第一波（确认/表单/导出/导入/抽屉/按钮）见 #74 与 #75–#81，本文**不重复**其范围。
> 底座约束：ADR 0008——交互型组件基于 **reka-ui**，样式 **UnoCSS**（零 Tailwind 引擎），toast 走 **vue-sonner** 双泳道；`useKitUI()` 调用签名向后兼容（只增不改）。
> 纯逻辑一律放 `app/lib/kit/*.ts`（可 vitest 单测），组件放 `app/components/ui/*`，全局弹层挂 `KitUIHost.vue`。
> 演示载体：`/dev/kit-ui` 每个原语一个 demo 区块，浏览器实测通过才算完成。

## 总览（5 个原语 + 1 处增强）

| # | 原语 | 落点 | 红圈对标证据 |
|---|------|------|------|
| W2-1 | KitLookup 检索下拉 | `ui/LookupSelect.vue` + `lib/kit/lookup.ts` | 全站 lookup 字段（项目/合同/分供方…） |
| W2-2 | KitEditGrid 明细网格 | `ui/EditGrid.vue` + `lib/kit/edit-grid.ts` | 目标成本清单明细、付款关联结算/发票 |
| W2-3 | typeSelect 业务类型选择弹窗 | `useKitUI().typeSelect()` + Host | 新建付款申请 8 类型单选弹窗 |
| W2-4 | KitFormFooter 保存动作组 | `ui/FormFooter.vue` | 全站表单脚部五动作 + 按钮三态 |
| W2-5 | KitListShell 列表页模板升级 | `ui/ListShell.vue`（组合 KitTable） | 左侧分类树+服务端汇总行+视图切换器 |
| W2-6 | 校验 toast 联动（增强，非新原语） | 并入 #79 | 「⟨字段名⟩：为必填项」toast+红框双通道 |

---

## W2-1 KitLookup 检索下拉

**动机**：现有 SelectFilter 只有静态枚举。红圈所有关联字段都是"输入即远程搜索"的 lookup，带最近选择记忆与快捷新建。

**API**（`app/components/ui/LookupSelect.vue`，`<script setup>` + `defineModel`）：

```ts
// v-model: string | null   —— 选中项 id
defineProps<{
  fetch: (kw: string) => Promise<Array<{ id: string; label: string; hint?: string }>>, // 远程搜索
  recentKey?: string,        // 传入则启用「最近选择」记忆（localStorage，VueUse useLocalStorage）
  allowCreate?: boolean,     // 字段尾「+」快捷新建
  disabledReason?: string,   // 依赖未满足时：点击弹 toast 提示该文案，不开浮层
  placeholder?: string,
}>()
defineEmits<{ create: [] }>() // 点「+」时抛出，由页面自行开新建表单
```

**行为规格**：
1. 聚焦/输入触发 `fetch`（防抖 300ms，用 VueUse `useDebounceFn`；输入未变不重发）；
2. 浮层分区：顶部「最近选择」（recentKey 命中，最多 5 条，带「不再显示」清空入口）→「可选数据」；
3. 选项内**关键词字符高亮**（`--brand` 色，纯逻辑 `highlightMatch(label, kw)` 放 lookup.ts）；
4. 键盘 ↓/↑/Enter 选择、Esc 关闭；选中后字段尾显示 ✕ 清空；
5. `disabledReason` 非空时：点击不开浮层，system 道 toast warning 显示该文案（对标红圈「该字段依赖"项目名称"的值，请补全后操作」）；
6. 底座：reka-ui **Combobox**；浮层 z-index 用现有 `--z-*` 令牌（#83）。

**纯逻辑**（`lib/kit/lookup.ts`，vitest 覆盖）：`highlightMatch`、`recentStore(key)`（增/查/清、去重、上限 5）。

**验收**：
- [ ] /dev/kit-ui demo：mock fetch 300ms 延迟，输入「车」出结果且高亮；
- [ ] 选中→重开浮层出现「最近选择」区；「不再显示」后不再出现；
- [ ] disabledReason demo：点击弹 toast、不开浮层；
- [ ] 键盘全流程可用；lookup.ts 单测通过。

**不做**：多选、树形选项、分页加载（后续按需）。

## W2-2 KitEditGrid 明细网格

**动机**：红圈所有单据的明细区都是可编辑网格（目标成本清单、付款关联结算/发票/转扣），DC 完全没有此原语——「弹窗简陋」最大缺口。

**API**（`app/components/ui/EditGrid.vue`）：

```ts
// v-model: rows 数组（对象数组，行内字段直接双绑）
defineProps<{
  columns: Array<{
    key: string; label: string; width?: number;
    type?: 'text' | 'number' | 'select' | 'lookup' | 'readonly';
    required?: boolean;
    options?: string[];                    // type=select
    derive?: (row) => unknown;             // 派生列（如 金额=数量×单价），只读实时算
  }>,
  rowOps?: Array<'add' | 'copy' | 'del'>,  // 默认全开
  picker?: { label: string; onPick: () => Promise<object[] | null> }, // 「选择结算单」类选择器入口
  summary?: Array<{ key: string; agg: 'sum' }>, // 底部汇总行（前端算）
  max?: number,
}>()
```

**行为规格**：
1. 工具条：添加 / 复制选中 / 删除选中（多选 checkbox 列）+ 可选 `picker` 按钮（点击调 onPick，返回行数组批量插入，由页面拼装抽屉/弹窗选择器）；
2. 行内编辑：text/number 原生 input，select 用现有 Select，lookup 嵌 W2-1；`derive` 列跟随行数据实时重算（对标红圈 数量×单价=合价）；
3. `required` 列为空时该单元格红框（校验函数暴露 `validate(): {row, key}[]`，供表单提交前调用）；
4. 底部汇总行：`summary` 声明的列显示 Σ（`--ink-soft` 底、数字右对齐）；
5. 纯逻辑（`lib/kit/edit-grid.ts`）：`applyDerive(rows, columns)`、`validateRows(rows, columns)`、`aggregate(rows, summary)`，vitest 覆盖。

**验收**：
- [ ] /dev/kit-ui demo：清单明细（名称*/单位/数量/单价/金额derive）增删改复制全通；
- [ ] 汇总行随编辑实时变；required 空提交时红框 + validate 返回定位；
- [ ] picker demo：mock 选择器返回 2 行批量插入；
- [ ] edit-grid.ts 单测通过。

**不做**（后续批次）：树形行（同级/子级）、Excel 双通道、全屏编辑、快捷键、跨页全选。PRD 记录红圈有这些，实装分期。

## W2-3 typeSelect 业务类型选择弹窗（新建三段式第一段）

**动机**：红圈大单据新建流程 = 类型选择弹窗 → 整页表单。付款申请 8 类型是范本（全名清单见差距清单 §6）。

**API**（挂 `useKitUI()`，Promise 化，同 confirm 风格；宿主 KitUIHost，reka-ui Dialog）：

```ts
const kit = useKitUI()
const picked = await kit.typeSelect({
  title: '新建付款申请',
  options: [
    { value: 'contractSub', label: '有合同（人材料分包）付款申请', hint: '关联结算额度' },
    // …
  ],
  defaultValue: 'contractSub',
})
// 返回 value；点取消/Esc/遮罩返回 null
```

**行为规格**：单选列表（radio 语义，默认选中 defaultValue 或第一项）、双击选项=选中并确定、footer 取消/确定；键盘 ↑↓ 移动 Enter 确定。纯逻辑无（状态极简），不建 lib 文件。

**验收**：
- [ ] /dev/kit-ui demo：8 类型弹窗，确定返回 value、取消返回 null；
- [ ] 与 confirm/formModal 堆叠共存不打架（复用 Host 栈）。

## W2-4 KitFormFooter 保存动作组

**动机**：红圈全站表单脚部五动作：取消 / 保存草稿 / 保存并新建 / 保存并提交 / 保存 + 「【保存】后关闭」勾选；空表单时草稿置灰（按钮三态）。

**API**（`app/components/ui/FormFooter.vue`）：

```ts
defineProps<{
  actions?: Array<'cancel' | 'draft' | 'saveNew' | 'saveSubmit' | 'save'>, // 默认全量，页面可裁剪
  dirty: boolean,        // false 时 draft 置灰
  closeAfterSave?: boolean, // 显示「保存后关闭」勾选（defineModel 双绑）
}>()
defineEmits<{ action: [name: string] }>()
```

**行为规格**：按钮全部复用 #75 KitButton（提交三态 loading 防重复）；`save`/`saveSubmit` 主色 `--brand`，其余次级；间距/顺序与红圈一致（取消最左、保存最右）。**DC 增强**：cancel 时若 dirty，由页面走 #79 的 dirty 拦截（本组件只抛事件，不自己弹 confirm）。

**验收**：
- [ ] /dev/kit-ui demo：五动作 + dirty 切换草稿置灰 + 勾选双绑；
- [ ] Blocked by #75。

## W2-5 KitListShell 列表页模板升级

**动机**：红圈标准列表页 = 左侧分类树 + 视图切换器 + 表格 + **服务端汇总行**。DC 列表只有搜索+分页，差距最大的三件。

**API**（`app/components/ui/ListShell.vue`，插槽组合现有 KitTable，不重写表格）：

```ts
defineProps<{
  tree?: Array<{ key: string; label: string; count?: number; children?: [] }>, // 左侧分类树（可折叠，宽 200）
  views?: Array<{ key: string; label: string }>,   // 顶部视图切换器（下拉）
  summary?: Record<string, number | string>,       // 汇总行数据（页面算好传入；金额格式化由组件做）
}>()
// v-model:treeKey  v-model:viewKey
// 插槽：#toolbar（搜索/筛选/导出导入新建按钮区）、#table（KitTable）、#summary 自定义覆盖
```

**行为规格**：
1. 树点击 → `treeKey` 双绑，页面自行过滤数据（组件不管数据）；选中项高亮 `--brand-soft` 底；
2. 视图切换器 = 现有 Select 样式，切换 → `viewKey` 双绑；
3. 汇总行贴表格底部吸底（滚动时可见），"变更后合同金额总和: 19,393,316.46；" 红圈句式，千分位由组件格式化；
4. 无 tree/views/summary 时对应区块不渲染——现有列表页可零成本包一层渐进升级。

**验收**：
- [ ] /dev/kit-ui demo：合同状态树(履约/中止/废除/终止) + 2 视图 + 3 列汇总行，联动过滤 mock 数据；
- [ ] 任一 prop 缺省时布局不留白。

## W2-6 校验 toast 联动（并入 #79，不另开 issue）

红圈实测：必填不过 = 顶部 toast「⟨字段名⟩：为必填项」（warning）+ 字段红框。#79 已定「失焦红字贴字段下方」，**保留 #79 方案为主**，补一条：提交全量校验失败时，同时发一条 system 道 warning toast，文案 `「⟨首个错误字段 label⟩：为必填项」`（多错误只报第一个 + `等 N 处`）。已在 #79 评论区补充。

---

## 依赖与顺序

```
W2-1 KitLookup ──┐
W2-4 FormFooter ─┼→ W2-2 EditGrid（lookup 列/footer 组合）→ 付款申请级整页表单（后续批次，非本 PRD）
W2-3 typeSelect ─┘
W2-5 ListShell 独立，可并行
```

统一验收底线：Composition API + `<script setup>` + TS；纯逻辑 vitest；/dev/kit-ui 浏览器实测；样式只用设计令牌（tokens.css），不引 tailwind 系包。
