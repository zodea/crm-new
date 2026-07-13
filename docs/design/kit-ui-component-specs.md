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
| 圆角 | 弹窗/卡片 `--radius-card`(12px),按钮/输入 `--radius-btn`(10px),小控件 `--radius-sm`(8px) |
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

**用途**:全局导出的进度与落点反馈。按「导出前是否需要配置目录结构」分两条路——不是按文件数,是按**是否需分类**。

**两条路**:

| 路径 | 触发 | 交互载体 | 进度 | 完成 |
|---|---|---|---|---|
| **直接保存** | 单文件 / 无需分类 | 系统保存文件夹选择器(原生) | 右下 process 道 toast(Sonner promise) | toast 成功 |
| **配置导出** | 多文件且需按类分两级目录 | 独立「导出配置」页签 | 页签内进度条 + stepper(读数据→生成→写盘) | toast 成功 + 页签自动关闭 |

**配置页签结构**(仅「配置导出」路):两级文件夹结构配置 → 命名规则(带实时预览)→「开始导出」→ 同页转进度区。

**stepper 状态配色**(多阶段):激活步 `--brand`、完成步 `--ok`(打勾)、失败步 `--danger`(参照 PatternFly 五态);走过的步打勾。

**完成落点**:统一 = **toast 成功弹窗**(system 道),文案「已导出到 X 文件夹」,**无任何动效**(全局水波已废弃)。

**失败**:process 道 toast 或页签内原地转 `--danger`,写明失败步,可重试;配置页签失败时**不自动关闭**。

**约束**:配置 UI 全局只此一套(在页签内),任意模块传导出上下文复用;配置页签算 [[页签导航]] 15 上限,成功即自动关闭。

**调用签名**:

```ts
// 直接保存(单文件/无需分类)
await exportFile({ data, defaultName })   // 弹系统文件夹选择器 → 导 → toast 成功

// 配置导出(多文件需分类)——打开导出配置页签
openExportTab({
  source,                         // 导出上下文(哪个模块/哪批数据)
  structure?: TwoLevelFolderCfg,  // 两级文件夹结构
  naming?: NamingRuleCfg,         // 命名规则 + 预览
}) // 页签内配置→开始→进度→toast 成功→自动关页签
```

---

## 04 · 导入映射 `import-mapping` ✅ 已定案(ADR 0005)

**用途**:旧数据迁移——把 Excel/CSV 导进某个系统实体。**模板驱动 + 实体触发 + 独立页签**。识别类(发票/送货单)、清单拆表**不套此原语**。

**载体**:独立页签(复杂流程少用弹窗;不遮罩、不误关),算 [[页签导航]] 15 上限、成功自动关闭。**从目标实体列表页触发**,模板隐含、无统一入口。

**三步 stepper**:

| 步 | 内容 | 要点 |
|---|---|---|
| 1 上传 | 拖入 Excel/CSV | — |
| 2 映射 | 左「源列」↔ 右「系统模板字段」两栏对照 + 智能预匹配 | 三色态见下;必填未映上**拦住不进下一步** |
| 3 预览/导入 | 行预览 + 进度条 | **可删除不属于该实体的行**;进度与导出 stepper 同源 |

**映射步三色态**:`--brand` 已匹配 / `--warn` 待确认 / `--danger` 必填缺失。

**完成**:toast 成功提示 + 页签自动关闭(与导出一致)。失败:页签内标失败、可重试,不自动关。

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

---

## 06 · 按钮三态 `button-states` ✅ 已定案(公共零件,无 ADR)

**用途**:提交类按钮的状态机,被表单提交 / confirm 确认 / 导入导出「开始」按钮复用。保持克制,不做花哨展示。

**核心机制**(无争议):

- 进 loading **立即 disabled** 防重复提交;**锁死宽度不跳动**。
- loading 文案:**原文字不变 + 前置 spinner**(如「⟳ 保存」),不换「保存中…」文案(锁宽最稳、免配套文案)。

**状态**:

| 状态 | 表现 | 默认 |
|---|---|---|
| default | `--brand`(或调用处指定语义色) | — |
| loading | 前置 spinner + disabled + 锁宽 | 启用 |
| success 打勾 | 缩字→打勾 `--ok`→停约 1s 复位 | **默认关** |

**success 打勾按需开**:多数按钮成功后已有别的落点(表单关窗 / 导出/confirm 弹 toast),按钮再打勾是**重复反馈**——故默认只走 default→loading,成功后随容器消失或复位。**仅**「原地保存、不关不跳、无其他反馈」的按钮(如页内「保存设置」)才开 success 打勾。

**行内校验**:配套表单时,错误红字 `--danger` 贴**字段下方**,不在按钮上表达。

**调用签名**:

```ts
<KitButton
  :loading="submitting"      // 受控 loading
  :success="false"           // 可选第三态,默认关
  variant="brand | danger | ghost"
  @click="onSubmit"
/>
```
