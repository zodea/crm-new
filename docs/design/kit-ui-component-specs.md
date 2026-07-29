# KitUI 交互原语组件规格（可落地模板）

> **底座已改（[ADR 0008](../adr/0008-adopt-shadcn-vue-on-unocss.md)）**：confirm/formModal 基于 **shadcn-vue Dialog（reka-ui）**，toast 基于 **vue-sonner 双 Toaster**——焦点陷阱/Esc/遮罩/焦点返回/堆叠/hover 暂停等交给底座，不再手写。本文的**结构锚点、变体/状态、配色令牌、行为规则、调用签名仍然有效**（那是设计语言，与实现无关）。迁移映射见 [kitui-to-shadcn-migration.md](./kitui-to-shadcn-migration.md)。

把每类交互敲定的方向翻译成**照着就能写组件**的规格:结构锚点、变体/状态、配色令牌、行为规则、调用签名。与另外两份分工:方向从 [interaction-style-references.md](./interaction-style-references.md) 挑,为什么这么定见 `docs/adr/`,本文只答「照着怎么写」。

- 技术栈:Nuxt 4 + Vue 3 + UnoCSS,SSR 关闭;交互底座 shadcn-vue(reka-ui)+vue-sonner。统一入口 `app/composables/useKitUI.ts`,单宿主 `app/components/shared/KitUIHost.vue`。
- dev 验证载体:`/dev/kit-ui`。令牌见 `app/assets/css/tokens.css`。

---

## 00 · 全局约定(所有浮层共用)

| 项 | 规格 |
|---|---|
| 遮罩 | `rgba(0,0,0,.28)`(中性轻遮罩,2026-07-05 由品牌蓝改中性黑),**不上毛玻璃**(Tauri 性价比低) |
| 圆角 | 弹窗/卡片 `--radius-card`(12px),按钮/输入 `--radius-btn`(8px,勘误:旧文写 10px,镜像 content-v5.css 实值 8px),小控件 `--radius-sm`(8px) |
| 浮层阴影 | `--shadow-pop` |
| 进出动效 | `--dur-dialog`(220ms)+ `--ease-snappy`;进场 `opacity 0→1 + translateY(12→0)` |
| 退路 | Esc 关闭、遮罩点击关闭、焦点锁定在浮层内 |
| 配色语义 | 建设性主操作 = `--brand`;破坏性确认 = `--danger`;取消 = ghost 灰 |
| z-index | 浮层 9000 段;toast 在其上 |

---

## 01 · 确认弹窗 `confirm-dialog` ✅ 已定案(ADR 0003)

**用途**:**所有业务删除一律先弹本弹窗确认**(单条 / 批量 / 级联,2026-07-07 起单条也确认),外加其他「不可撤回 / 高后果」操作(如归档后修改)。纯信息阻断(页签上限等)走 toast、不弹本弹窗。

**结构锚点**(自上而下):标题 → 正文/杀伤清单 → [type-to-confirm 输入框] → footer(取消 ghost 左 · 确认 danger 右)。

**三档变体 & 行为**:

| 变体 | 触发 | 打字确认 | 点确认后 | 事后撤回 |
|---|---|---|---|---|
| `simple` | **单条删除**、归档后修改、删未入库扫描件等 | 无 | 立即关窗 → 交 toast 反馈 | 删除类 **10 秒 undoToast**;非删除类一般无 |
| `batch` | 批量删除 | 无(仅显示「将删除 N 条」) | 立即关窗 | **10 秒 undoToast** 整批恢复 |
| `cascade` | 删有下游关联的父级(如分供方) | **必填,打记录自身名称** | **原地 spinner、弹窗不关、≥3 秒预提交挂起** | **无**(挂起期即撤销窗口) |

**cascade 细节**:

- 弹窗列**杀伤清单**:「将影响 3 份合同、12 条材料、8 张发票」(只读 count 查询得出)。
- 输入框需精确匹配记录名(如「华东建材」)才激活确认按钮。
- 点确认 → 进入 **≥3 秒**挂起(关联多则更久,永不少于 3 秒),期间 **不写库**、显示显眼「撤销」按钮;撤销即彻底中止;超时未撤才写父级删除标记、关窗。
- 软删除**只标父级**,子级靠「祖先是否已删」过滤隐藏,不逐条标记。

**配色 & 令牌**:确认 `--danger`、取消 ghost 灰、品牌蓝不当主角;遮罩 `rgba(0,0,0,.28)`(中性);打开焦点默认落**取消**按钮(危险操作停在安全选项)。

**调用签名**(命令式 Promise,沿用 `useKitUI`):

```ts
await confirm({
  variant: 'simple' | 'batch' | 'cascade',
  title, message,
  count?: number,                 // batch: 显示删除条数
  impact?: { label: string; n: number }[], // cascade: 杀伤清单
  requireTyping?: string,         // cascade: 需精确打入的记录名
  holdMs?: number,                // cascade: 预提交挂起时长,默认 ≥3000
  confirmLabel?, cancelLabel?,
}) // resolve(true) 执行 / resolve(false) 取消
```

---

## 02 · 表单弹窗 `form-modal` ✅ 已定案

**用途**:新增/编辑单条记录的字段录入。低方差原语——各处表单结构基本一致,沿用现有 `KitFormModal`(字段配置驱动 + 必填校验,纯校验在 `app/lib/kit/form-modal.ts`),**不换骨架,只做四处增强**。

**结构锚点**:标题(动词+名词,与主按钮动词一致)→ 字段区(可分组、可滚动)→ 吸底 footer(取消 ghost 左 · 主按钮 `--brand` 右)。

**四处增强**:

| 增强 | 规格 | 参考 |
|---|---|---|
| 长表单吸底 | 标题栏 + footer 固定,中间字段区 `overflow-y:auto`;短表单自然高度、不吸底 | shadcn Dialog Sticky Footer |
| 自动聚焦 | 打开后焦点落在**第一个输入框** | Vercel Geist |
| 失焦即时校验 | 字段 `blur` 时校验,错误红字贴**该字段下方**(非顶部汇总);提交时再全量校验 | — |
| 提交三态 | 主按钮 default→loading(spinner + disabled 防重复)→success 关窗;复用 [按钮三态](#06--按钮三态-button-states) 原语 | Vercel Geist |

**未保存内容拦截**:仅当表单**已被改动(dirty)** 时,点遮罩/Esc 关闭要弹一道 `confirm`(`simple` 变体,确认按钮文案「放弃修改」);未动过的表单直接关、不打扰。

**配色 & 令牌**:主按钮 `--brand`(建设性操作,品牌蓝当主角,与 confirm 的 danger 相反);聚焦态品牌蓝描边;校验错误 `--danger` 贴字段下;圆角/留白往 Flowbite 靠一档,别太企业风。

**调用签名**(沿用现有,字段配置驱动):

```ts
await formModal({
  title,                          // 动词+名词
  fields: FieldConfig[],          // 类型/label/必填/校验规则/分组
  initial?: Record<string, any>,  // 编辑态回填;有值即判 dirty 基线
  submitLabel?,                   // 与 title 动词一致
}) // resolve(values) 提交 / resolve(null) 取消
```

---

## 03 · 导出进度 `export-progress` ✅ 已定案(ADR 0004)

**用途**:全局导出的进度与落点反馈。路径分流、上下文生命周期、安全命名和写盘环境以 [ADR 0004](../adr/0004-export-interaction-model.md) 为唯一权威;本节只定义 KitUI 的调用与呈现契约。

**两条路**:

| 路径 | 触发 | 交互载体 | 进度 | 完成 |
|---|---|---|---|---|
| **直接保存** | 无需目录分类 | 目录选择与写盘能力 | 右下 process 道 loading,成功后 dismiss | 唯一 system 成功 toast |
| **配置导出** | 需要目录分类 | 独立「导出配置」页签 | `ProcessStepper`(读数据→生成→写盘) | 唯一 system 成功 toast + 页签自动关闭 |

**配置页签结构**:最多两级文件夹配置 → 两段命名字段/分隔符/扩展名 → 完整相对路径实时预览 →「开始导出」→ 同页转进度区。

**进度契约**:`ProcessStepper` 接收 pending / active / completed / failed 步态。激活步 `--brand`,完成步 `--ok`并打勾,失败步 `--danger`;该展示组件可直接复用于 #81 导入流程。

「开始导出」与「重试失败步骤」均用 `KitButton`。失败保留页签与已完成步,重试从失败步继续;成功弹唯一 system toast 并自动关闭页签。

**直接保存契约**:调用方只提供数据与默认文件名;KitUI 负责目录选择、真实写盘、取消与环境降级。具体能力与边界见 ADR 0004。

**完成落点**:统一 = **唯一 system 道成功 toast**,文案「已导出到 X 文件夹」。直接保存成功时先 dismiss process loading,不再显示 process success;**无任何动效**。

**约束**:配置 UI 全局只此一套。通用路由、transient context 空态、路径安全、同名序号与普通下载 fallback 的失败语义不在本文复制,统一见 ADR 0004。

**调用签名**:

```ts
const { exportFile, openExportTab } = useKitUI()

// 直接保存:requiresDirectoryStructure 缺省为 false
await exportFile({ data, defaultName })

// 配置导出:由同一 exportFile 入口判定并打开通用页签
await exportFile({
  requiresDirectoryStructure: true,
  source,
  structure,
  naming,
})

// 需显式打开配置页签时的等价别名
await openExportTab({ source, structure, naming })
```

---

## 04 · 导入映射 `import-mapping` ✅ 已定案(ADR 0005)

**用途**:旧数据迁移——把 Excel/CSV 导进某个系统实体。**模板驱动 + 实体触发 + 独立页签**。识别类(发票/送货单)、清单拆表**不套此原语**。

**载体**:独立页签(复杂流程少用弹窗;不遮罩、不误关),算 [[页签导航]] 15 上限、成功自动关闭。**从目标实体列表页触发**,模板隐含、无统一入口。

**三步 stepper**:

| 步 | 内容 | 要点 |
|---|---|---|
| 1 上传 | 拖入 Excel/CSV | — |
| 2 映射 | 模板字段清单逐行对照源列下拉(以模板字段为主轴,必填即清单) + 智能预匹配 | 三色态见下;必填未映上**拦住不进下一步** |
| 3 预览/导入 | 行预览 + 进度条 | **可删除不属于该实体的行**;进度与导出 stepper 同源 |

**映射步三色态**:`--brand` 已匹配 / `--warn` 待确认 / `--danger` 必填缺失。

**完成**:toast 成功提示 + 页签自动关闭(与导出一致)。失败:页签内标失败、可重试(从失败行续导,已成功行不重复入库),不自动关。路由与实体注册表见 ADR 0005。

**前置依赖**:各实体的「主要字段模板」(字段 + 必填)来自红圈数据结构分析,单列 issue 产出(草案已备:`scratchpad/import-template-fields-draft.md`,8 主实体证据充分;班组/工人、施工记录待用户拍板)。

**外部旧ID列**:每个实体的导入模板预留一列「外部旧ID / 匹配标识」(仿红圈 `field3__c 匹配标识`),存源系统主键,便于迁移后对账与二次修正、避免重复导入。

**调用签名**:

```ts
// 从目标实体列表页触发,实体隐含决定模板
openImportTab({
  entity,            // 目标实体(分供方/工程量清单/...),隐含选模板
}) // 页签内 上传→映射→预览(可删非归属行)→导入→toast 成功→自动关页签
```

---

## 05 · 抽屉 Sheet `drawer-sheet` ✅ 已定案(轻量,无 ADR)

**用途**:**只读速览**——右侧滑出看详情,不承载编辑。凡「编辑 / 复杂表单 / 边改边对照」一律走**页签**(遵循 ADR 0004/0005「复杂流程少用浮层」原则),不进抽屉。域内实际用途很少:

- **主要实例**:消息通知面板。
- 偶尔:从列表点一行速览字段 / 附件缩略,Esc 即关,不值得占页签。

**结构**(抄 shadcn-vue Sheet):顶部标题栏(固定)+ 中间可滚动内容;因只读,**无底部操作条**。

**样式**:**不上毛玻璃**(Tauri 性价比低);背板 `rgba(0,0,0,.28)` 中性轻遮罩;宽约 380–420px。Esc / 遮罩点击关闭。

**窄窗退化**:退化为**底部 Sheet + 拖拽把手**,缓动手感借 Vaul(拖一半回弹)。

**调用签名**:

```ts
openDrawer({
  title,
  content,          // 只读内容(字段/附件/通知列表)
  side?: 'right' | 'bottom', // 默认 right;窄窗自动 bottom
})
```

**#188 审计结论**：通知中心以领域专用 `NotificationDrawer` **替代**通用命令式 `openDrawer`，但复用本节的中性遮罩、桌面右侧 390px、窄窗底部 Sheet、固定标题、内容滚动、Esc、焦点返回和滚动锁合同；它为保留既有已读、全部已读、删除及路由打开能力，仍不是纯只读容器。项目切换器会改变当前工作项目，属于选择器而非只读速览，继续使用 Popover / Dialog，不纳入本原语。列表行级纯只读速览和通用 `openDrawer` API 本期明确**延期**，因此 #78 保持 open，不作为 #188 的 blocker。

---

## 06 · 按钮三态 `button-states` ✅ 已定案(公共零件,无 ADR)

**用途**:提交类按钮的状态机,被表单提交 / confirm 确认 / 导入导出「开始」按钮复用。保持克制,不做花哨展示。

**核心机制**(无争议):

- 进 loading **立即 disabled** 防重复提交;**锁死宽度不跳动**。
- loading 文案:**原文字不变 + 前置 spinner**(如「⟳ 保存」),不换「保存中…」文案(锁宽最稳、免配套文案)。

**状态**:

| 状态 | 表现 | 默认 |
|---|---|---|
| default | 按变体配方渲染(缺省 secondary 安静按钮,见 DESIGN-TASTE §4.2 / #109) | — |
| loading | 前置 spinner + disabled + 锁宽 | 启用 |
| success 打勾 | 缩字→打勾 `--ok`→停约 1s 复位 | **默认关** |

**success 打勾按需开**:多数按钮成功后已有别的落点(表单关窗 / 导出/confirm 弹 toast),按钮再打勾是**重复反馈**——故默认只走 default→loading,成功后随容器消失或复位。**仅**「原地保存、不关不跳、无其他反馈」的按钮(如页内「保存设置」)才开 success 打勾。

**行内校验**:配套表单时,错误红字 `--danger` 贴**字段下方**,不在按钮上表达。

**调用签名**:

```ts
<KitButton
  :loading="submitting"      // 受控 loading
  :success="false"           // 可选第三态,默认关
  variant="secondary | primary | accent | ghost | danger"  // 五变体层级,缺省 secondary(#109,DESIGN-TASTE §4.2)
  @click="onSubmit"
/>
```

## 07 · 穿透件 `entity-link` / `money-link` ✅ 已定案(2026-07-17 四问定稿,无 ADR)

> 基准:`DC重构设计源码/kit/KitAtoms.jsx` EntityLink(批A 底座件①)+ MoneyLink(批B 铁律④);领域语言见 CONTEXT.md「穿透」词条。

**EntityLink(实体蓝链)**:
- type→route 映射**唯一处**(组件内 ENTITY_ROUTES 一张表,别处不复制);只登记已实装详情页(project/supplier/contract/invoice…),**未实装类型查无路由自动退化纯文本**——实装后回填映射即全站上线。
- label 缺省时按 type 从对应 store best-effort 解析(分供方取别名优先);解析为空 → 灰「—」。
- 视觉:`--brand`/600、hover 下划线、`font-size: inherit`;点击 stopPropagation(不触发行点击)。

**MoneyLink(金额穿透)**:
- `¥#,##0.00` mono/600 完整两位小数;**跳转目标由调用点传入**(目标列表路由 + 预筛 query),不建集中金额映射表——金额语义(合同额/请款/收票/已付…)归业务屏。
- 值 0/空/未给目标 → 退化普通 mono 文本。**不做死链**(与 EntityLink 同一铁律)。

**页签交互(对 CONTEXT.md 页签词条的补充边界)**:
- **穿透预筛不进页签身份**:跳转激活目标列表页的既有页签并应用新预筛;预筛参数不参与「同路由同参数复用」判定。
- 目标列表页需支持从 query 初始化筛选(样板已接:发票台账 `?project=<id>`;项目列表暂无入站金额生产者,待客户详情/收款侧实装后随其接入)。

**落地节奏**:样板先行——发票台账 + 项目列表两屏接入并浏览器验收(穿透观感 + 预筛口径 + 页签复用)后,再全站铺开;样板屏顺手带状态色纯文字化与汇总条(左统计右分页)。

---

## 08 · 项目切换器 `project-switcher` ✅ 已定案（2026-07-22）

> 公开产品调研与来源见 [头部项目切换器公开产品模式调研](../research/project-switcher-patterns.md)。本节是实施与设计稿补图的权威组件规格。

**用途**：在施工进度、首页、项目驾驶舱等项目上下文界面切换当前项目。项目数量从 1、3、12 到更多时始终使用同一个 `ProjectSwitcher`，不按数量维护多种皮肤。

**组件归属**：首个实现放在 `app/components/project/ProjectSwitcher.vue`，由项目域提供项目名称、编码和权限。暂不为了抽象而新增无实际第二调用域的 `ContextSwitcher`；后续出现真实的公司/仓库等同构上下文后再提炼。

**关闭状态**：

- 单一按钮触发器：项目图标/单字 mark + 当前项目名称 + 可选项目编码 + chevron。
- 当前项目始终可见；长名称单行截断，hover/focus 可读全名。
- 宽度受控，不得因项目数量或名称挤压同一工具栏中的整体进度、日期和操作按钮。
- 1 个项目时仍保持同一外观；若确实不可切换则 disabled 并保留当前上下文，不换成纯文字标题。

**打开状态**：

1. 顶部搜索框，打开即聚焦；按项目名称与项目编码过滤。
2. 搜索框下方只有一个「全部项目」滚动列表，不显示「最近使用」分组，不保存额外的访问历史。
3. 当前项目显示 check 与 `aria-selected`，不能只靠颜色；项目选项清除浏览器默认按钮边框。
4. 空结果、加载、加载失败、无权限分别有明确状态。
5. 选中后立即关闭并请求切换；加载失败恢复原项目，system toast 报错。

**统一而非多套样式**：

- 桌面使用触发器下方锚定 SelectPanel。
- 390/768px 使用同一触发器、搜索、分组、选项与状态逻辑，仅把面板容器改为全屏 Dialog/Sheet。
- 响应式只改变浮层定位和尺寸，不改变任务模型；禁止「3 个以内按钮、4 个以上下拉」、项目按钮横向滚动和原生 `select` 降级。

**键盘与可达性**：`Enter` / `Space` / `ArrowDown` 打开，方向键移动，`Enter` 选择，`Esc` 关闭并把焦点还给触发器；搜索结果变化需提供结果数量的屏幕阅读器反馈。触发器可访问名称包含「当前项目」和实际项目名。

**建议调用签名**：

```vue
<ProjectSwitcher
  v-model="projectId"
  :projects="projectOptions"
  :loading="loading"
  :disabled="disabled"
/>
```

`v-model` 只表达本界面中的当前项目单值；项目主数据仍归项目 Pinia store，切换后的排程加载与路由同步由页面 action 负责。

**施工进度设计稿落点**：`SchedulePlanScreen.jsx` 工具栏当前三个项目按钮整体替换成一个 `ProjectSwitcher`；其右侧「整体进度 → 日期/说明 → 设为基线 → 新建楼栋分组」次序不变。设计稿需补关闭态、搜索展开态、空结果态和 390px 全屏态，并在 `app.dc.html` 中可实际切换项目。

---

## 09 · 页面状态 `state-panel` / 表格空态 ✅ 已定案（2026-07-27）

**用途**：列表、详情与工作区的加载、空数据、错误和重试共用 `app/components/ui/StatePanel.vue`；表格自身的业务空态由 `KitTable.empty` 承载。页面不得再散落纯文字「加载中…」或无引导的「暂无数据」。

**四态语义**：

| 状态 | 可达性 | 结构与动作 |
| --- | --- | --- |
| `loading` | `role=status`、`aria-busy=true`、可读加载名称 | 使用贴近内容结构的 shimmer skeleton；页面级禁用巨型 spinner |
| `empty` | `role=status`、业务标题作为可访问名称 | 业务标题 + 原因/下一步说明 + 可选主动作 |
| `error` | `role=alert`、assertive live region | 失败标题 + 可读原因 +「重新加载」动作；重试期间回到 loading |
| `forbidden` | `role=status`、权限标题作为可访问名称 | 锁图标 + 权限范围说明；这是预期权限边界，不误报为系统故障 |

`compact` 只缩减区块高度，用于有缓存内容时在列表上方提示刷新失败，不改变角色与动作语义。按钮内部提交态仍遵循第 06 节按钮三态：只有小 spinner，不把按钮进度放大成页面进度。

**表格空态**：`KitTable.empty` 兼容原有字符串，也接受 `{ title, description?, actionLabel? }`。传对象时组件发出 `emptyAction`，由业务页决定清筛选、创建首条记录等动作；不能在通用表格里猜业务路由。

**与 #97 KitListShell 的边界**：#185 不采用也不替代 `KitListShell`，明确延期到具有真实左树、视图切换或服务端汇总需求的领域列表票。`StatePanel` 与 `KitTable` 状态契约保持可组合，未来进入 `ListShell` 时直接复用；不能为完成状态原语而虚构列表壳业务。

**页面状态机**：

1. 首次请求未完成：loading，不先闪 empty。
2. 成功且无数据：empty；筛选无结果与业务从未建档必须使用不同文案和动作。
3. 失败且无缓存：error；失败但有缓存可显示 compact error，并保留旧数据。
4. 点击重试：立即清旧错误并回 loading；成功进入默认/empty，失败更新 error。并发加载必须采用“最新请求胜出”，过期请求不得覆盖新数据或提前结束 loading。

表头筛选参与业务空态时，「清除筛选」除重置页面筛选模型外，还必须调用 `KitTable.clearFilter()` 清除 vxe-table 内部选中态，保证筛选图标、弹层选项与实际数据一致。

**调用签名**：

```vue
<StatePanel
  kind="loading | empty | error | forbidden"
  title="业务状态标题"
  description="原因或下一步"
  action-label="可选动作"
  :compact="false"
  @action="retryOrContinue"
/>

<KitTable
  :empty="{ title, description, actionLabel }"
  @empty-action="clearFiltersOrCreate"
/>
```

---

## 10 · 实体详情壳 `entity-detail-shell` ✅ 已定案（2026-07-27）

**用途**：`app/components/ui/EntityDetailShell.vue` 统一实体详情的页面层级：返回、标题/编号、状态与操作、可选摘要指标、主内容和可选右栏。壳只提供布局、状态落点和插槽，不读取 store、不定义业务页签、不决定流程事实或指标顺序。

**参考、差异与最终处理**：

| 核对项 | 参考结构 | #186 前 app | 最终处理 |
| --- | --- | --- | --- |
| 顶部摘要 | `DC重构设计源码/kit/DetailShell.jsx`：返回 + 标题/编号 + 状态 + 操作，下接指标 | 项目、合同、分供方各自复制头部，长标题有截断/换行差异 | 固定统一头部；`mark/status/actions/metadata/summary` 均为可选插槽 |
| 模块顺序 | 参考壳展示指标、页签、内容，但不同实体可缺省 | 各详情自行排列流程、指标、页签 | 默认插槽完全由业务页编排；壳不把流程、指标、页签写死 |
| 辅助右栏 | 参考壳按文书/文件是否存在决定右栏 | 分供方有右栏，项目/合同结构不一致 | `aside` 存在才启用；容器不足时堆到主内容下方，主内容始终 `min-width:0` |
| 页面状态 | 参考设计稿只有不存在的简略落点 | 各页散落文字 loading/不存在 | 复用 `StatePanel`：loading、empty、error、forbidden、not-found；页面仍持有领域加载与权限判断 |
| 代表详情 | 参考详情数据不可写入仓库；当前直接证据仍不足 | 分供方已有真实 6 页签、跨项目汇总和文件栏 | 迁移 `/base/supplier/:id`；保留真实 store/动作/页签，仅更换页面组织壳与状态呈现 |

线上参考站当前只有 `R-DETAIL-PRIOR` 历史结构线索；#186 不把邻近模板写成目标页事实。分供方字段、动作和同屏差异继续由 #193 按严格只读协议核对，#186 只裁定跨实体稳定层级。

**插槽与编排边界**：

- `mark`：实体首字、图标或小型标记。
- `status` / `actions` / `metadata`：状态、页面动作与副标题补充；业务权限与事件留在调用页。
- `summary`：可选指标区；指标口径由业务页计算。
- 默认插槽：流程事实、指标、页签、表单或子表按业务证据自由排序。
- `aside`：文件、动态或只读辅助信息；没有内容时不留空列。

**状态契约**：`state` 支持 `ready | loading | empty | error | forbidden | not-found`。壳只把调用页给出的判定映射到统一状态表面，并发、缓存、重试与权限来源仍归领域 store/page；有缓存刷新失败时，调用页可保持 `ready` 并在默认插槽顶部放 compact `StatePanel`。

**响应式与可达性**：

- 长标题允许自然换行，编号/副标题可断行，状态与操作独立换行；不得用标题截断掩盖信息。
- 右栏在详情容器达到 68rem 时并列，否则堆叠；按可用容器而不是截图宽度判断。
- 页签可换行/局部横滚；密集子表由调用点提供明确 `overflow-x:auto` 边界，页面本身不得横滚。
- 返回入口、操作组、状态角色和 `aside` complementary 名称均可读；页签继续复用 reka-ui 键盘导航。

**与 #78 Sheet 的审计结论**：#186 不采用也不替代只读速览 Sheet，明确延期。实体详情是可导航的整页信息架构，右栏在窄容器直接堆叠即可；把整页详情塞进 Sheet 会改变任务模型。#78 继续用于消息通知或列表行级只读速览，不是 `EntityDetailShell` blocker。

**调用签名**：

```vue
<EntityDetailShell
  :state="pageState"
  :title="entityName"
  :back-to="listRoute"
  @state-action="retry"
>
  <template #status />
  <template #actions />
  <template #summary />

  <!-- 业务页自行编排流程、指标、页签与子表 -->

  <template #aside />
</EntityDetailShell>
```

---

## 11 · 整页表单壳 `entity-form-shell` ✅ 已定案（2026-07-27）

**用途**：`app/components/ui/EntityFormShell.vue` 统一业务实体整页表单的页面结构：返回、标题/副标题、状态与页面级操作、可选分区导航、加载/错误落点、内容区和吸底动作区。壳只发出 `back/stateAction` 事件并承载插槽，不读取领域 store、不执行校验、不决定保存草稿、保存或提交规则。

**参考、差异与最终处理**：

| 核对项 | 参考结构 | #187 前 app | 最终处理 |
| --- | --- | --- | --- |
| 页面头部 | `DC重构设计源码/kit/FormPage.jsx`：返回 + 新建/编辑标题 + 草稿状态/提示 | 各领域 Page 复制相近头部，文案和右侧动作位置不一 | 固定 `title/subtitle/backLabel`，`status/actions` 由领域页注入 |
| 分区导航 | 三个以上分区时显示左侧锚点，窄容器隐藏 | MasterData/Contract/Finance 等组件重复 aside，按 viewport 判断 | `sections` 统一生成语义化 nav；以 56.25rem 表单容器阈值并排，窄容器由分区卡片标题接替 |
| 状态 | 参考页有载入与保存反馈 | 代表页只有文字 loading，加载异常只 toast 或无落点 | `ready/loading/error` 映射共享 `StatePanel`；领域页仍判定状态和重试 |
| 内容与动作 | 字段卡片 + 可选明细网格 + 吸底五动作 | 字段、附件、明细和 `FormFooter` 已存在，但外壳逐页复制 | 默认插槽承载字段/明细；`footer` 插槽承载现有 `FormFooter`，动作语义不进入壳 |
| 代表迁移 | 新建、编辑回显、校验、草稿、提交、页签缓存、放弃修改 | `MasterDataFormPage` 已有完整领域 action | 迁移 MasterData 代表页；保留 store/action/dirty/KeepAlive，补首次字段聚焦、加载错误和首个错误字段聚焦 |

`EntityFormShell` 不创建第二个 `main` landmark；应用级 `SidebarInset` 仍是唯一主内容地标。底部动作在 DOM 顺序上位于字段内容之后，保持从字段自然 Tab 到取消与主操作。

**响应式与交互契约**：

- 390 / 768 / 1024 / 1440px 与 200% 等效宽度不得产生页面横向滚动。
- 分区导航按表单自身可用宽度显示；隐藏后各 `section-*` 卡片标题仍是结构导航。导航拦截原生 hash，仅滚动目标分区，不改变 Nuxt 路由与页签 key。
- 密集明细网格由领域调用点提供唯一的局部 `overflow-x:auto`，表格最小宽度随实际列宽求和，壳不得吞掉或放大为整页滚动。
- 非就绪态仍保留返回入口；错误状态由 `stateAction` 回到领域加载函数。
- dirty 拦截只在首次成功水合后生效；页签切换保值、失焦字段内错误、提交 toast 双通道、首错滚入视口并聚焦、草稿跳过必填、保存/提交 loading 均由既有领域层保持。必填 `LookupSelect` 通过 `field` 把同一字段键落到真实 combobox，以 `invalid` 同步视觉与 `aria-invalid`，并用 `descriptionId` 关联字段错误说明。
- `footer` 插槽不增加包裹层，`FormFooter` 必须作为内容列直接子元素保持 sticky 定位。

**关联原语审计**：

- #79：旧表单弹窗范围已由 ADR 0014 替代；#187 在整页形态采用其吸底动作、首次聚焦、校验双通道、提交三态和 dirty 拦截语义，弹窗仅保留轻量对象兜底。
- #94 `KitEditGrid`：继续作为跨领域明细网格独立原语；代表 MasterData 表单没有可编辑明细矩阵，本期明确延期，不阻塞表单壳。
- #95 `typeSelect`：继续作为付款申请等“三段式新建”独立原语；代表 MasterData 表单没有业务类型首段，本期明确延期，不阻塞表单壳。

**调用签名**：

```vue
<EntityFormShell
  :title="title"
  :sections="sections"
  :state="pageState"
  @back="leaveToList"
  @state-action="reload"
>
  <template #status />
  <template #actions />

  <form><!-- 领域字段、附件与明细 --></form>

  <template #footer>
    <FormFooter @action="handleDomainAction" />
  </template>
</EntityFormShell>
```
