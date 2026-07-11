# 交互实现手册（INTERACTION-PLAYBOOK）

> 定位：DC 设计稿的**「怎么做交互 / 怎么做优化」方法论**。后续所有界面优化、交互补全、反馈轮修改，都按本文的思考路径执行。
> 与 [IMPLEMENTATION.md](./IMPLEMENTATION.md) 的分工：那边管「怎么新增/接入一个页面」，这边管「页面里的交互怎么想、怎么做、怎么验证」。
> 来源：2026-07-02 反馈轮 3（全量回滚 + 二级弹窗补全）实战提炼。
> ⚠️ 状态：骨架经用户确认「先按目前的写」；**待逐条细化的点集中在文末【附录 B · 待确认】**，勿当作已定稿的铁律全部照搬。

---

## 〇、总原则

1. **交互必须闭环**：点了有真实反馈、数据真实变化、可撤回可恢复。占位 toast 只是过渡态，不是交付态。
2. **规范查文档，不凭感觉**：每类交互在项目文档里都有出处（见 Step 1 的定位表）。
3. **先全局后局部**：能沉淀为全局原语的交互（确认弹窗/toast/表单弹窗/撤回）先走统一入口复用，禁止在单个页面里造一次性轮子。（导出/导入是独立页签流程、非弹窗原语，见 [ADR 0004](../adr/0004-export-interaction-model.md) / [ADR 0005](../adr/0005-import-mapping-model.md)。）
4. **改坏了先回滚**：出现「改动效果不如意」时，第一步是回到最后已知良好状态（本地快照），再在其上做增量，不在坏版本上修修补补。

---

## 一、Step 1 —— 先读文档定界

动手前把这几份文档按「改动涉及什么」读一遍：

| 改动涉及 | 查这里 |
|---|---|
| 页面结构 / 字段 / Tab / 弹窗定义 | `docs/rewrite/pages/<page>.md`（内容蓝本，结构也要对齐） |
| 视觉样式（卡片/按钮/表格/状态色） | 视觉基准 [ADR 0007](../adr/0007-unified-visual-style-rounded-cards.md)；dc-rebuild 组件级细化见 [STYLE-GUIDE.md](./STYLE-GUIDE.md) |
| 删除 / 编辑 / 撤回行为 | `docs/rewrite/DATABASE.md` §8（软删除 + 操作日志 + 撤回规则） |
| 导出交互 | [ADR 0004](../adr/0004-export-interaction-model.md) + [kit-ui-component-specs §export-progress](../design/kit-ui-component-specs.md) |
| 页面接入 / 路由 / DS 组件 | [IMPLEMENTATION.md](./IMPLEMENTATION.md) |
| 术语 | 根目录 `CONTEXT.md` |

**冲突时的优先级**：用户当面确认 > 相关 ADR（视觉 [0007](../adr/0007-unified-visual-style-rounded-cards.md)、交互 0003/0004/0005/0008、表格 0009）> STYLE-GUIDE.md（dc 细化）> 页面 md 蓝本。

---

## 二、Step 2 —— 改动前把 4 类问题问清（不问清不动手）

反馈轮 3 靠这 4 问避免了返工，之后每轮改动开工前都过一遍：

| # | 问题 | 反馈轮 3 的答案（作为默认值沿用） |
|---|---|---|
| 1 | **基准**：以哪个版本为准？ | 本地快照「DC重构设计源码」为基准，线上分叉改动全量放弃 |
| 2 | **范围**：这轮做到哪一层？ | 二级弹窗全部做成真实交互；项目详情占位 Tab、项目×分供方工作台不在本轮 |
| 3 | **数据行为**：操作怎么生效？ | 内存生效（页面 state 实时更新），刷新恢复初始 mock；删除一律软删除+撤回，字段结构对齐 DATABASE.md |
| 4 | **深度**：模拟到什么程度？ | 导出=完整模拟全局规范（选文件夹+配置+进度），**不**真实生成文件；导入=映射弹窗+回填示例行 |

> 问题的形式不限于向用户提问——能从文档/代码里查到答案的自己查；查不到、且答案影响做法的才问用户。

---

## 三、Step 3 —— 原语优先（KitUI）

> ⚠ 本节描述 DC 设计稿侧 `window.KitUI`；生产端底座 = shadcn-vue，见 [ADR 0008](../adr/0008-adopt-shadcn-vue-on-unocss.md)（统一入口 `useKitUI()`，「原语优先、禁止一次性轮子」规则不变）。

### 3.1 现有全局原语（`kit/KitUI.jsx`，纯 DOM，经隐藏 x-import 预加载注册 `window.KitUI`）

> ⚠️ 下表为设计稿快照侧旧原语签名（历史留痕），末列给出生产端现行对应；冲突以所引 ADR 为准。

| 原语（设计稿快照） | 用途 | 生产端对应（现行，以此为准） |
|---|---|---|
| `toast(msg, tone)` | 轻反馈 | vue-sonner 双泳道 toast，见 [ADR 0008](../adr/0008-adopt-shadcn-vue-on-unocss.md) |
| `confirm(opts)` | 二次确认 | 三档确认弹窗（所有删除先确认），见 [ADR 0003](../adr/0003-confirm-dialog-deletion-model.md) |
| `modal(opts)` | 自定义内容弹窗 | reka-ui Dialog，见 [ADR 0008](../adr/0008-adopt-shadcn-vue-on-unocss.md) |
| `formModal(opts)` | 字段表单弹窗 | reka-ui Dialog + 字段配置驱动，见 [ADR 0008](../adr/0008-adopt-shadcn-vue-on-unocss.md)（`app/lib/kit/form-modal.ts`）|
| `undoToast(msg, onUndo, ms?)` | **软删除撤回** | 撤回时长以 CONTEXT.md「撤回」为准；机制见 [ADR 0003](../adr/0003-confirm-dialog-deletion-model.md) |
| `folderPicker(onPick)` | 模拟文件夹选择器 | 导出走系统文件夹选择器，见 [ADR 0004](../adr/0004-export-interaction-model.md) |
| `exportModal(opts)` | 旧「全局导出规范弹窗」 | 已退役为独立页签，见 [ADR 0004](../adr/0004-export-interaction-model.md) |
| `importModal(opts)` | 旧「Excel 导入 + 字段映射弹窗」 | 已退役为独立页签三步 stepper，见 [ADR 0005](../adr/0005-import-mapping-model.md) |

### 3.2 规则

- 新交互**先查上表**；语义相同直接复用（哪怕样式想微调，也改原语而不是复制）。
- 表里没有、且 ≥2 个页面会用到 → **先在 KitUI 建原语**，再回页面调用。
- 只有与页面 state 强耦合、别处不会复用的（如工程量的户级弹窗），才允许页面内 React 实现。
- 页面里统一写 fallback：`const UI = () => window.KitUI || { toast(){}, confirm(o){o.onConfirm&&o.onConfirm()}, ... }`，新增原语时记得同步各页 fallback 的 no-op 键。

---

## 四、Step 4 —— state 化 mock（交互必须闭环）

### 4.1 标准模式（四个列表页已统一采用，新页面照抄）

```js
// 列表转 state：新增/编辑/删除实时生效（刷新恢复初始 mock）
const [list, setList] = React.useState(() => data.xxx.slice());   // 或 .map(merge META)

const addRow  = (vals) => setList((l) => [{ id: "x_" + Date.now(), ...默认值, ...vals }, ...l]);
const editRow = (id) => (vals) => setList((l) => l.map((x) => (x.id === id ? { ...x, ...vals } : x)));
const delRow  = (row) => UI().confirm({
  title: "删除…", danger: true, confirmText: "删除",
  message: "确定删除「…」？删除为软删除，可在 N 秒内撤回。", // N=撤回时长，以 CONTEXT.md「撤回」为准
  onConfirm: () => {
    const idx = list.findIndex((x) => x.id === row.id);
    setList((l) => l.filter((x) => x.id !== row.id));
    UI().undoToast("已删除「…」", () => setList((l) => { const n = [...l]; n.splice(Math.min(idx, n.length), 0, row); return n; }));
  },
});
```

### 4.2 硬规则（除非用户明说，否则不破例）

1. 删除 / 废弃一律**软删除 + 撤回 toast**，撤回后**恢复到原位置**（DATABASE.md §8）。
2. 表单提交前做必填校验，失败 `toast(msg, "danger")` 且**不关弹窗数据**（当前实现为 toast 后不执行保存）。
3. 页面上所有**计数 / 合计 / Tab 角标**必须跟 state 联动（不能停留在初始 mock 数）。
4. 搜索框、筛选下拉必须真实过滤 state。
5. 刷新恢复初始 mock，**不做 localStorage 持久化**（避免脏数据干扰演示；待确认项 B4）。
6. 跨 Tab 共享的数据把 state 提升到屏级组件（参考 `InvoiceScreen`：invoices 提升后，上传/校对/台账三 Tab 全联动）。

---

## 五、Step 5 —— 验证闭环（改完 ≠ 完成）

按顺序执行，全过才算交付：

1. **语法检查**：`npx esbuild <改过的>.jsx --loader:.jsx=jsx --outdir=<临时目录>`，全部编译通过。
2. **本地实测**：起本地静态服务器托管快照目录（node 一个 ~20 行的 http server 即可，注意 `.jsx → text/javascript` 的 MIME），Chrome 打开 `http://localhost:<port>/app.dc.html`：
   - 每个新交互至少走一遍**完整 happy path**（如导出：选文件夹→配置→进度→toast）；
   - 软删除必须实际点一次**撤回**验证恢复；
   - 全程 console 无报错。
3. **推送**：DesignSync `finalize_plan`（必须带 `deletes`，无则 `[]`）→ `write_files`（`localPath` 直读快照目录）。全量回滚场景要连 `_ds/**` 一起覆盖。
4. **线上抽查**：design 预览确认渲染正常即可。

### 5.1 实测教训（反馈轮 3）

- design **编辑器画布里的点击是「选元素/缩放」不是真交互**；Present 模式的 iframe 对自动化点击也不可靠。→ **交互验证一律以本地静态 server 为准**，线上只查渲染。

---

## 六、Step 6 —— 文档回写

每轮完成后：

1. 在 [README.md](./README.md) 追加「反馈轮 N」记录：背景/改了什么/为什么/怎么验证的。
2. **修正被本轮推翻的旧条款**（反馈轮 3 修正了 IMPLEMENTATION.md §五.2「弹窗多为占位」）。
3. 新敲定的术语进根目录 `CONTEXT.md`；本手册的规则有变动直接改本文件。

---

## 附录 A · 案例：反馈轮 3

完整记录见 [README.md](./README.md) 「反馈轮 3」。走完 6 步的对应关系：

- Step 1：读了 finance-invoice.md §7（导出规范）、DATABASE.md §8（软删除）。
- Step 2：4 问全部向用户确认（基准=快照全量回滚 / 范围=二级弹窗 / 数据=内存+可撤回 / 深度=完整模拟）。
- Step 3：新建 `exportModal/importModal/undoToast/folderPicker` 四个原语，9 个页面复用。（exportModal/importModal 后退役为独立页签，见 ADR 0004/0005。）
- Step 4：分供方/班组/工人/项目/发票/送货单全部 state 化。
- Step 5：esbuild 全过 → 本地 server 实测（导出全流程/撤回恢复/上传闭环）→ 推送 36 文件 → 线上渲染确认。
- Step 6：README 补反馈轮 3；修正 IMPLEMENTATION.md 过时条款；建 CONTEXT.md。

## 附录 A2 · 案例：反馈轮 4 —— 进度甘特交互（跨屏共享数据源模式）

完整记录见 [README.md](./README.md) 「反馈轮 4」。本轮沉淀的可复用交互模式：

### 共享数据源原语 `window.SCHEDULE`（`kit/ScheduleData.jsx`）
- **适用**：同一份业务数据要在多个屏（首页缩略甘特 / 施工进度页 / 工程量矩阵 / 项目详情驾驶舱）同时展示且**任一处编辑其余实时刷新**时，不要各屏各自 mock —— 建一个隐藏 x-import 预载的数据模块，挂 `window.XXX`，带 `subscribe/notify/update`。
- 各屏接入样板：`const [,force]=React.useReducer(x=>x+1,0)` + `useEffect(()=>window.SCHEDULE.subscribe(force),[])`（未加载时 setInterval 等待，同 `window.KIT_DATA` 模式）。
- 与 `KitUI`（交互原语）的分工：KitUI 管弹窗/toast 等**通用交互**，SCHEDULE 类模块管**跨屏业务状态**。

### 甘特「同轴可控」交互规范（用户核心诉求，后续所有进度类界面遵守）
- 计划与实际必须**同一行同一时间轴**：计划=浅色条（opacity≈0.22），实际=同色深填充（左对齐），今天=红竖线贯穿全部行；禁止「头部时间节点 + 下面另一套只读展示」的割裂结构。
- 行对齐用**常量行高**（`ROWH`）+ 左表/右甘特同一行 flex 容器，依赖线用绝对定位 SVG overlay（`viewBox="0 0 100 H"` + `preserveAspectRatio="none"` + `vector-effect: non-scaling-stroke`，x 用百分比、y 用像素）。
- 偏差语义统一：done→提前/延后/按期，doing→快N天/慢N天，未开始且过计划开始→**应开未开**（danger 红虚框），未到期→待开始。分组/项目汇总=按工期加权。
- **下钻参数约定**：`navigate("quantity", { group, trade, item, task, ps, pf, from })`；目标页出「来自施工进度：分组·工序（计划区间）」上下文条 + 按 `from` 返回来源页。有工程量映射的工序（hasQty）进度只读、由矩阵联动；无映射的工序才允许手动填报。
- 模板实例化：新建分组=从工序标准库勾选 + 起始日期 + 流水搭接（后道错开半个工期）自动排程，建完可逐道调期。

---

## 附录 B · 待确认（与用户逐条过，过完删本节或转正文）

1. **骨架增删**：6 步之外是否要加「效果图先行」节点（记忆规则：先完善设计文档 md、效果图要精致）？「用户确认」节点固定放在 Step 2 之后还是每步都可触发？
2. **规则分级**：§4.2 目前全按硬规则写——哪些允许破例（如某些纯展示页不需要 state 化）？
3. **KitUI 用纯 DOM 而非 React 组件**：是既成事实还是长期决策？若长期，值得立 ADR（理由：跨屏复用不依赖各屏 React 树、x-import 预加载即可用；代价：无法用 JSX、和 React 弹窗并存两套心智）。
4. **mock 不持久化**：内存生效+刷新恢复 是本轮确认的；要不要给「演示重置」场景补一个「重置数据」入口，或部分页面改 localStorage？
5. **界面精修清单**：你标了首页/工程量/工资/其他四块都要调（视觉/布局/交互/数据四类问题都有），**每页的具体不满意点尚未指认**——晚上逐页过时直接记到这里。
6. **占位项排期**：项目详情剩余 6 个占位 Tab、项目×分供方工作台，放哪一轮。
7. **CONTEXT.md 术语表**：初版已建（根目录），术语的取舍/命名待你过目。
