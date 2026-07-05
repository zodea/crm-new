# 实现方法（DC 重构）

> 面向接手者：如何在 claude.ai/design 项目「瑞航CRM-NEW」里新增 / 重构一个页面。
> projectId：`e54e3b41-1b18-485c-924f-e277deedc21e`

---

## 一、整体架构

这是一个 **Claude Design DC（声明式组件）单页应用**：

```
app.dc.html                       ← 唯一 SPA 外壳（侧边栏 + 顶栏 + <main> 路由）
  ├─ <helmet>                      ← 加载 tokens/styles、_ds_bundle.js、kit/data.js
  ├─ <x-dc> 模板                   ← 侧边栏 {{ sidebar }} + 顶栏 {{ pageTitle }} + <main> 内一组 <sc-if>
  └─ <script type="text/x-dc">     ← class Component extends DCLogic：state.route / navigate / renderVals()
kit/*.jsx                          ← 各页面组件（IIFE 注册到 window.XxxScreen）
kit/data.js                        ← window.KIT_DATA 演示数据
_ds/.../_ds_bundle.js              ← 设计系统组件库 window.DesignSystem_e3d871
_ds/.../tokens/*.css               ← 颜色/间距/阴影 token
```

> 约束（用户要求）：**DC 必须是单个 SPA**，侧边栏切换页面，不拆成多个独立文件。

### 1.1 路由如何工作（`app.dc.html`）
- `state.route` 决定当前页；`navigate(route, params)` 切换。
- `renderVals()` 把每个路由算成布尔（`isXxx: route === "xxx"`），喂给模板里的 `<sc-if value="{{ isXxx }}">`。
- 每个 `<sc-if>` 内一个 `<x-import>` 挂载对应 kit 组件。
- `PAGE` 表提供顶栏标题/副标题；`_isActive(key)` 决定侧边栏高亮（详情页要让父项高亮）。

### 1.2 ⚠️ x-import 是「编译期预加载」
`support.js:598` —— `<x-import from="...">` 的模块在**模板解析时就全部 `loadExternal`**，与 `sc-if` 真假无关。
含义：
- 只要模板里写了某组件的 `<x-import>`，它的 JS 就会被加载、IIFE 执行、注册 `window.XxxScreen`——**不存在「没访问就没加载」**。
- 因此**跨文件共享全局**（如旧 `KitToolbar`）能work：提供方文件被预加载即注册成功。但仍要注意：用户首次点进某页时所有小文件早已加载完，时序安全。

---

## 二、新增 / 重构一个页面的标准流程

### Step 1 — 读蓝本
读 `docs/rewrite/pages/<page>.md`，确认：Tab/Section 结构、列表列、筛选项、详情页布局、字段、状态流转、验收要点。

### Step 2 — 写组件（scratchpad → 上传）
在 scratchpad 写 `kit/XxxScreen.jsx`（列表）、必要时 `kit/XxxDetailScreen.jsx`（详情）。约定：
```js
(function () {
  const { Button, IconButton, StatusChip, Panel, Icon /* , Field, StatCard */ } = window.DesignSystem_e3d871;
  // 统一原子（按需内联复制）：SegTab / SelectFilter(下拉筛选) / InfoGrid / SectionHeader / Metric+MetricGrid / SubTable
  // 统一表格样式常量：const TH = {...surface-2 表头}; const TD = {...13~16 padding};
  // md 字段 data.js 暂缺 → 组件内 mock（按 id 映射），勿改 data.js
  function XxxScreen({ data, navigate, params }) { /* ... */ }
  window.XxxScreen = XxxScreen;
})();
```
- 组件签名：列表 `({ data, navigate })`；详情 `({ data, params, navigate })`。
- 风格严格按 [STYLE-GUIDE.md](./STYLE-GUIDE.md)。
- **展示原子目前是各文件内联复制**（SegTab/SelectFilter/InfoGrid/SectionHeader/Metric/SubTable/TH/TD），为降耦合先内联；`SelectFilter` 已在 Project/Supplier/Crew/Worker 四个列表页各自内联一份。
- **交互原语已全局化**：`kit/KitUI.jsx`（隐藏 x-import 预加载注册 `window.KitUI`）提供 toast/confirm/modal/formModal/undoToast/folderPicker/exportModal/importModal（ripple 蓝色水波已废弃，不再提供）。交互一律先用/先扩 KitUI，规则见 [INTERACTION-PLAYBOOK.md](./INTERACTION-PLAYBOOK.md) §三。
  > ⚠ **本条仅描述 DC 设计稿侧。生产端（Nuxt/Vue）已按 [ADR 0008](../adr/0008-adopt-shadcn-vue-on-unocss.md) 换 shadcn-vue 底座**：confirm/formModal 基于 reka-ui Dialog、toast 基于 vue-sonner 双 Toaster（样式栈 UnoCSS，零 Tailwind 引擎）；统一入口仍是 `useKitUI()`（签名不变）。设计稿的 `window.KitUI` 仅作视觉/行为基准留档。
- **展示原子已全局化（反馈轮 9，替代"各文件内联复制"旧约定）**：`kit/KitAtoms.jsx` → `window.KitAtoms`（SelectFilter/SegTab/SearchInput/SectionHeader/Metric/MetricGrid/TreeNav）；表格一律 `kit/KitTable.jsx` → `window.KitTable`（≥10 行/容器内横滚/分页/金额两位小数）。**新页面禁止再内联复制这些原子。**
- **跨页共享数据 store（反馈轮 9）**：主数据走 `kit/AppData.jsx` → `window.APP`（projects/suppliers，subscribe/rows/get/update/add/softDel/restore/use）；发票域 `window.INV`、排程域 `window.SCHEDULE`、工资域 `window.WAGE`。**列表/详情/聚合页禁止各自 useState 持有数据副本**，一律订阅 store，编辑写回 store 实现跨页联动。

### Step 3 — 接入路由（仅新增路由时改 `app.dc.html`）
在 scratchpad 的 `app.dc.html` 改 4 处：
```html
<!-- ① <main> 内加渲染块（详情页带 params） -->
<sc-if value="{{ isXxx }}" hint-placeholder-val="{{ false }}">
  <x-import component-from-global-scope="XxxScreen" from="./kit/XxxScreen.jsx"
    data="{{ kitData }}" navigate="{{ navigate }}" params="{{ params }}" hint-size="100%,500px"></x-import>
</sc-if>
```
```js
// ② PAGE 表加标题
xxx: { title: "标题", subtitle: "副标题" },
// ③ renderVals 加布尔
isXxx: route === "xxx",
// ④ 详情页：_isActive 让父项高亮
if (key === "parent") return r === "parent" || r === "xxxDetail";
```
> 列表→详情用 `navigate("xxxDetail", { id })`，详情里 `params.id` 取回。

### Step 4 — 上传（DesignSync）
```
finalize_plan(projectId, writes:[...], deletes:[], localDir: <scratchpad>)
write_files(projectId, planId, files:[{ path:"kit/Xxx.jsx", localPath:"Xxx.jsx" }, ...])
```
- `localDir` 用 scratchpad 目录；`localPath` 相对它。
- `finalize_plan` 必须同时传 `deletes`（无则 `[]`）。
- 改了 `app.dc.html` 要一并 write。

### Step 5 — 预览确认
在 design 预览（claude.ai/design/p/<projectId>?file=app.dc.html）点开对应侧边栏项查看。
> 注意：design 编辑器里直接点 preview 是「缩放/选元素」，不是真交互；切页确认以人工为主。

---

## 三、常用 DS 组件（`window.DesignSystem_e3d871`）
| 组件 | 用途 | 关键 props |
|---|---|---|
| `Panel` | 卡片容器（已圆角+阴影）| `padding`, `hover`, `as`, `style` |
| `Button` | 按钮 | `variant`("primary"/"danger"), `icon`, `iconRight`, `size`("sm"), `disabled` |
| `IconButton` | 图标按钮 | `icon`, `title`, `tone`("danger"), `size` |
| `StatusChip` | pill 状态标签 | `tone`("ok"/"warn"/"danger"/"brand"/"neutral") |
| `StatCard` | 统计卡 | `label`, `value`, `tone`, `clickable`, `onClick` |
| `Field` | 带 label 输入 | `label`, `mono`, `value`, `onChange`, `placeholder`, `colSpan` |
| `Icon` | lucide 图标 | `name`, `size`, `color` |
| `NavItem` | 侧边栏项 | `mark`, `label`, `hint`, `active`, `onClick` |

> 图标名用 lucide（如 `search` `plus` `upload` `download` `file-text` `square-pen` `trash-2` `arrow-left` `filter` `refresh-cw` `columns-3` `circle-check` `triangle-alert` `chevron-down` 等）。

---

## 四、数据约定
- 真实演示数据在 `kit/data.js` → `window.KIT_DATA`（invoices/suppliers/projects/workers/crews/crewConfig/matrix/payroll/priceRows/factorDefaults/deliveryFiles…）。
- md 里有、但 `data.js` 没有的字段（证照、货物明细、扣罚、工人 trade/safety/family、来源、打印次数…）：**目前在组件内 mock**，按 id 映射；`WorkerScreen` 把 mock 挂 `window.WORKER_META` 供详情页复用。
- 后续若要更真实，统一把这些补进 `data.js` 再让组件读取（保留现有字段，只新增）。

---

## 五、已知遗留 / 注意
1. **KitToolbar 兼容垫片已移除**：`ProjectScreen` 第 5 站重写后不再引用 `window.KitToolbar/KitTH/KitTD`，已从 `SupplierScreen.jsx` 删除该注册块，全项目无残留。
2. ~~弹窗多为占位~~ **已完成（反馈轮 3）**：新增/编辑弹窗、导出配置、导入映射、打印确认、送货单系列弹窗均已是真实交互，做法与规则见 [INTERACTION-PLAYBOOK.md](./INTERACTION-PLAYBOOK.md)。项目详情 6 个占位 Tab 与项目×分供方工作台仍为占位。
3. **DESIGN-SYSTEM.md 未同步**：其扁平 CRM 条款与现风格冲突，暂不改（用户要求），以 [STYLE-GUIDE.md](./STYLE-GUIDE.md) 为准。
