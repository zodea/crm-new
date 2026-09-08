# 设计品味基准（DESIGN-TASTE）— 界面重构文档

> 生成方式：按 `stitch-design-taste` skill 的品味编码框架，对本项目**用户认可的满意版本**做的一次系统提炼（2026-07-17 快照；2026-07-27 按 #181 重构权威链）。
> **双源基准**：有直接对应页时，登录态运行参考决定构图、密度、控件状态和安全交互路径；仓库镜像 `DC重构设计源码/app.dc.html` + `kit/*.jsx` 决定瑞航品牌、DC 独有能力和无直接参考页的当前方案。
> 运行参考不覆盖瑞航字段含义、数据、权限或领域状态机；证据等级与只读协议看 [`runtime-reference-audit.md`](runtime-reference-audit.md)，冲突裁定看 ADR 0013。
>
> **与既有权威源的关系**（本文是「品味层」，不推翻任何权威源）：
> - 色值/形状令牌唯一权威源 = `DC重构设计源码/_ds/crm-e3d87120-cf57-4b83-8a9b-188c305f529d/tokens/content-v5.css`。本文 hex 为快照，冲突以该文件为准。
> - 内容区风格 [ADR 0007](../adr/0007-unified-visual-style-rounded-cards.md)、交互底座 [ADR 0008](../adr/0008-adopt-shadcn-vue-on-unocss.md)、表格 [ADR 0009](../adr/0009-vxe-table-as-datagrid-engine.md) 继续有效；**全站布局/排版/颜色（含应用外壳）基准 = [ADR 0013](../adr/0013-align-all-ui-to-online-design.md)**，[ADR 0011](../adr/0011-redesign-application-shell.md) 仅存外壳行为条款。
> - 与 [DESIGN-SYSTEM.md](../rewrite/DESIGN-SYSTEM.md)（既有 design 文档）的分工：那是逐组件规格清单；本文回答「为什么线上版本好看、哪些做法绝对不许、本地要往哪重构」。两文冲突处见 §8.2（已发现的冲突本文已点名）。
>
> 后续任何页面实装/重构，以本文 §4–§7 为对照检查表；有直接参考页时还必须记录运行态证据与当前 app 差异。

---

## 0. 三轴定位（taste spectrum）

| 轴 | 定位 | 说明 |
|---|---|---|
| 密度 Density | **7 / 10（双档）** | 仪表盘区保留可扫读留白（面板 12–16px、指标大数字）；台账表格区更致密（38px 行高、11–13px label、单元格水平 padding 6px）。两档共存，不改变信息编排。 |
| 变化 Variance | **2 / 10** | 对称、可预期。CRM 工作台靠肌肉记忆吃饭：列表页/详情页模板全站同构（§5），不做非对称炫技。skill 默认值 Variance 8 **不适用**本项目。 |
| 动效 Motion | **2 / 10** | 克制、瞬时反馈。skill 默认的 spring 物理与常驻微动效 **不适用**本项目（§6 覆盖声明）。 |

**一句话气质**：「克制面板 × 高密度台账」——小圆角 + 无卡片阴影 + 清楚分隔 + 适量留白；数据密而不挤，蓝色安静而不喧哗。

---

## 1. 视觉气质与氛围

工地记账员的桌面工具：机构级严肃感 + 数据密集型专业工具。像一间光线充足的项目部办公室——白纸台账、冷蓝灰文件柜、一枚深蓝公章（品牌蓝只在盖章处出现）。

**正面（满意版本这样做）**：
- 白纸面板落在轻机构灰画布上，1px 冷灰描边、小圆角、无卡片阴影；层级靠浅灰标题条、留白和分隔线，不靠堆叠。
- 品牌蓝是「章」不是「墙」：整屏扫过去，实心蓝色块不超过一处（核心 CTA / 选中态），其余蓝只以细节出现——3×14 竖条、下划线、蓝链、聚焦环。
- 数字是主角：金额/编号/日期一律等宽字体 + tabular-nums，右对齐，字重 600–800；文字 label 退居 11–12px 灰色。

**反面（一眼廉价，出现即改）**：
- 密集表格台账 + 横条工具栏挤满实心按钮（旧 CRM 风）。
- 满屏实心蓝按钮、蓝色大色块标题栏、渐变。
- 重网格线、多行紧凑筛选 pill 平铺、卡片套卡片。

---

## 2. 色彩（描述名 + hex + 角色）

> 权威源 `content-v5.css`；以下为 2026-07-17 快照。**整站只此一套冷蓝灰阶，禁止混入暖灰**；唯一 accent = 瑞航蓝（饱和度 ≈55%，符合 skill「单 accent、饱和度 <80%」校准）。

### 2.1 基底（画布与面板）

| 描述名 | 令牌 | 色值 | 角色 |
|---|---|---|---|
| 轻机构灰 | `--bg` | `#f8f9fb` | 页面画布，永远的底 |
| 白纸 | `--panel` | `#ffffff` | 卡片/面板填充 |
| 台账表头灰 | `--surface-2` | `#f1f5f9` | 表头、卡片次级底、底部汇总条 |
| 悬停灰 | `--surface-3` | `#f3f4f6` | 行 hover、占位、中性 chip 底 |
| 凹底灰 | `--surface-sink` | `#e9edf4` | 预览区凹陷底 |
| 细账线 | `--line` | `#e3e6ea` | 默认描边、表格分隔，1px 用足 |
| 粗账线 | `--line-strong` | `#c9ced6` | 按钮/输入框描边（控件要「挺」） |

### 2.2 品牌（唯一 accent）

| 描述名 | 令牌 | 色值 | 角色 |
|---|---|---|---|
| 瑞航蓝 | `--brand` | `#3976C6` | 实心 CTA、选中态、聚焦、蓝链、竖条 |
| 深海军蓝 | `--brand-deep` | `#2A5996` | 选中文字、浅底按钮文字 |
| 晨雾蓝 | `--brand-soft` | `rgb(213 230 248)` | 选中行底、激活筛选、primary 按钮底 |
| 聚焦环 | `--brand-ring` | `rgb(57 118 198 / 22%)` | `focus` 外环 3px |

### 2.3 状态（三档制：实色 / 浅底 / 深字）

| 状态 | 实色 | 浅底 `-soft` | 深字 `-ink` |
|---|---|---|---|
| ok 成功 | `#169D72` | `rgb(207 246 231)` | `#097251` |
| warn 警告 | `#D38A20` | `rgb(255 239 191)` | `#8B590C` |
| danger 危险 | `#E04E5C` | `rgb(253 219 224)` | `#9D313E` |

**三档分工**：表格业务状态按 [ADR 0013 的 2026-09-08 裁定](../adr/0013-align-all-ui-to-online-design.md) 使用紧凑浅底、小圆角和明确文字，列表及详情子表保持同一语义映射，配方只看[组件规格](./kit-ui-component-specs.md)。实色用于图标、进度条和文字，不作大面积状态底色；字段与状态含义仍由领域权威定义。

### 2.4 文字

| 描述名 | 令牌 | 色值 | 角色 |
|---|---|---|---|
| 炭墨 | `--ink` | `#1f2329` | 主文字。**这是本项目的"黑"——禁用纯黑 `#000000`** |
| 灰墨 | `--ink-soft` | `#5b6470` | 次级文字、label、未选中 tab |
| 淡墨 | `--ink-faint` | `#8b93a1` | 弱提示、占位符、字段 label |

### 2.5 遮罩与外壳

- 浮层遮罩 = 中性黑 `rgb(0 0 0 / 28%)`（ADR 0003：不上毛玻璃、不用品牌蓝遮罩）。
- 应用外壳按 [ADR 0013](../adr/0013-align-all-ui-to-online-design.md) 回归设计稿白底浅色（~~深蓝侧栏 `#162238`~~ 作废；`--shell-*` 令牌名保留、重映射浅色值），与内容区共用同一套设计令牌。

---

## 3. 排版规则

### 3.1 字族（skill 字体禁令的中文语境落地）

```css
--font-sans: "Noto Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
```

- 字族**锁死**上面两套，不引进新字体（skill 的「禁 Inter / 换 Geist」条款在中文 CRM 语境的对应物 = 禁止引进任何花哨西文字体、禁止衬线/宋体出现在界面任何位置）。
- **数字等宽铁律**（skill 高密度覆盖条款，本项目密度 7 触发）：金额、编号、日期、数量、百分比、计数 pill——一切数字一律 `--font-mono` + `tabular-nums`。大额数字可加 `letter-spacing: -0.015em`（Metric 实测值）收紧。

### 3.2 字号阶（快照自 typography.css）

| 阶 | px | 用途 |
|---|---|---|
| 2xs | 11 | 序号 chip、计数 pill、备注 |
| xs | 12 | 字段 label、次级元信息、SelectFilter label |
| sm | 13 | 表头、按钮(md)、紧凑正文、SegTab |
| base | 14 | 正文基准（html 根字号 14px） |
| lg | 17 | 模块标题 |
| xl | 20 | 空态标题 |
| 2xl | 24 | 统计卡大数字（**字号封顶，不出现巨字**） |

### 3.3 层级靠字重与颜色，不靠字号轰炸

| 语义 | 字重 | 颜色 |
|---|---|---|
| 页面/区块标题 | 800 | `--ink` |
| 小标题、数字强调、选中 tab | 700 | `--ink` / `--brand-deep` |
| label、按钮文字 | 600 | `--ink-soft` |
| 次要正文 | 500 | `--ink-soft` |
| 正文 | 400 | `--ink` |

行高：正文 1.5；紧凑数字 1.2–1.25。label 加 `letter-spacing: 0.02em`（中文 label-caps 感）。

---

## 4. 组件风格配方（实测自 kit / _ds_bundle）

### 4.1 Panel（L1 内容面，一切内容的容器）

白底 `--panel` + `1px solid --line` + 圆角 `--radius-card`(4px) + 无卡片阴影。默认内边距 12–16（表格面 0 + `overflow:hidden`）。可点面板 hover：边框转 `--brand` 或底色转 `--surface-2`，不位移、不升级阴影。
**不嵌套卡片**——卡内分区用 1px 分隔线或 `--surface-2` 底，绝不再套一层圆角阴影。

### 4.2 按钮：五变体 + 「每屏一枚章」铁律

这是满意版本气质的**第一来源**，也是目前本地最大出入（见 §8.2）。

| 变体 | 配方（实测） | 何时用 |
|---|---|---|
| secondary（**默认**） | 白底 + `1px --line-strong` 边 + `--ink` 字；hover 底转 `#eceef1`、边转 `--ink-soft` | 绝大多数操作：刷新/导出/导入/取消… |
| primary | `--brand-soft` 底 + `--brand` 边 + `--brand-deep` 字；hover 底转 `#dbeafe` | 区块内主操作（比 secondary 响半档） |
| accent | 实心 `--brand` 底白字；hover opacity .9 | **核心 CTA，每屏最多 1 个**（新建/识别/保存） |
| ghost | 透明；hover `--brand-soft` 底 + `--brand` 字 | 工具性弱操作、收起/展开 |
| danger | 白底 + `--line-strong` 边 + `--danger` 字；hover 红边 + `rgba(220,38,38,.05)` 底 | 删除等破坏性操作（静默红，不实心） |

尺寸：sm `5px 11px`/12px、**md `7px 12px`/13px**、lg `9px 16px`/14px；字重 600；圆角 `--radius-btn`(4px)。
交互态：hover = 平面变色（无位移无发光）；**active = `scale(0.97)`**（skill「tactile push」的本项目实现）；disabled = opacity .5。

### 4.3 IconButton（表格操作列 / 工具条）

28×28 描边白底方按钮，圆角 4px，图标 ≈16px `--ink-soft`；hover 蓝边蓝字；`tone="danger"` 红字、hover 红边浅红底。操作列统一纯图标 + `title`，不混文字按钮。

### 4.4 数字展示：StatCard / Metric / MetricGrid

- **StatCard**：Panel 内 label（12/700/`--ink-soft`）+ 大数字（24/800，行高 1.1，tone 上色）。`clickable` 时升级为可跳面板（hover 蓝框或浅底，不浮起）。
- **Metric**：label（11/600/`--ink-faint` + ⓘ公式 tooltip）+ mono 数字（big 17.5/800，普通 13.5/700，`letter-spacing:-0.015em`）。两位小数完整展示，禁省略号。
- **MetricGrid**：宽屏的 `cols` 只表示**最多列数/语义分组提示**，不是所有宽度锁列。重复指标优先 `repeat(auto-fit, minmax(min(100%, var(--metric-min)), 1fr))`，或用容器查询在 1/2/N 列间降级；`gap:1px` + `--line` 底色透出细分隔线，外框 1px + 圆角 4 + `overflow:hidden`。金额必须完整可读，不能靠压缩列宽或省略号维持列数。

### 4.5 StatusChip

业务状态 tag 的形状、尺度、语义色与非交互边界统一看[组件规格](./kit-ui-component-specs.md)。计数、来源、类别等其他 chip 按自身用途保留，不能将本轮状态样式变更全局套给所有标签。列表与详情的同一状态不得因位置不同改写业务结论。

### 4.6 SegTab（业务内容分段 tab，下划线式）

容器 `border-bottom: 1px --line`、`flex-wrap: wrap`（**禁 overflow-x 滚动**）；项高 32px、水平 padding 12px、13px；选中 = `--brand-deep`/700 + 底部 `2px solid --brand`（`margin-bottom:-1`）；未选中 = `--ink-soft`/500。可带计数 pill（11px mono；选中 `--brand-soft` 底，未选中 `--surface-3` 底）。不用方块 tab、不用胶囊 tab（应用外壳路由页签除外，视觉归 ADR 0013 的 40px 红圈式页签栏，行为归 ADR 0011）。

### 4.7 SelectFilter / SearchInput（工具栏两件套）

- **SelectFilter**：label（12/700/`--ink-soft`）+ 原生 select（`appearance:none`，`1px --line-strong` 边、圆角 4px、13px/600、`padding 7px 30px 7px 12px`）+ 自绘 chevron-down（14px `--ink-faint`）。多分类筛选一律收进下拉并入工具栏，**不做 pill 平铺占行**。
- **SearchInput**：小圆角矩形（4px）、`1px --line-strong` 边、`padding 8px 14px 8px 32px`、13px，左内嵌 14px search 图标，默认宽 210px。

### 4.8 TreeNav（左树导航）

Panel padding 0；标题条 `--surface-2` 底 12/700；节点圆角 4、选中 `--brand-soft` 底 + 800 字重 + `--brand-deep`；计数 pill mono 11px（选中白底，未选中 `--surface-3`）。发票台账/清单页同构复用。

### 4.9 EntityLink / MoneyLink（全站穿透语言）

- 实体名一律蓝链：`--brand`/600，hover 下划线，无实体退化纯文本（**不做死链**）。
- 聚合金额可点穿透：mono/600 蓝字，`¥` + 两位小数 `toLocaleString`，点击跳对应单据列表带预筛参数；值为 0/空退化普通 mono 文本。

### 4.10 表格（KitTable / vxe-table，ADR 0009）

4px 圆角 Panel 承载（padding 0、无阴影）；表头 `--surface-2` 底、13/700/`--ink-soft`、高 38px；数据行 14px、高 38px、单元格水平 padding 6px、分隔 `1px --line`、hover `--surface-3`；首列序号 `--ink-soft`；名称列蓝链；金额列 mono 右对齐 600–700；操作列右对齐 IconButton 排；底部汇总条 `--surface-2` 底（左统计 + 右分页）。分页按钮 28×28（同 IconButton 语言，active 实心蓝）。

### 4.11 加载 / 空态 / 错误态

- **区块/页面加载**：skeleton 扫光（1.5s loop），骨架尺寸贴合真实布局；**禁通用圆形大 spinner**。按钮内 loading 允许 14px 小 spinner（KitButton 既有模式）。
- **空态**：组合式（图标 + 标题 20px + 一句指引「如何产生数据」+ 可选 CTA），不是一行"暂无数据"。占位 Tab 用统一占位卡：「数据结构已定义，待 X 模块完成后启用」。
- **错误**：行内红字（`--danger-ink`）+ 字段下方说明；表单 label 上、error 下，无浮动 label。

---

## 5. 布局原则

**页面模板全站同构**（强制响应式契约见 [ADR 0013「响应式与自适应契约」](../adr/0013-align-all-ui-to-online-design.md)，此处只记品味要点）：

- **列表页**：工具栏卡（标题 + 计数 → SelectFilter 组 → 搜索 → 按钮组，一行收齐）→ 可选汇总卡行 → 表格卡。按钮组从左到右由弱到强，accent 永远最右。
- **详情页**：顶部摘要面板（返回 + 头像方块 + 标题行 + 摘要格行）→ 流程/进度事实 → 经营与票据概览 → SegTab / SectionHeader 分区。SectionHeader = 不超过 34px 的 `--surface-2` 层级条 + 3×14px 品牌竖条 + 13/700 标题；只有参考页或既有业务流程能明确证明更优信息流时才调整模块顺序。
- **流式网格优先**：重复卡片按最小可读宽度自适应，可使用 `auto-fit` / `auto-fill` + `minmax()`；语义栏位可显式给宽屏列数或比例，但必须用容器/视口断点提供降列、堆叠、Tab 或 Sheet 退化。比例列是宽屏构图，不是固定画布。
- **禁整页横滚**：宽内容（大表格/矩阵/甘特）在自身容器内 `overflow-x:auto`。SegTab 用 wrap 不用横滚。
- **SVG 图表**：`viewBox` + 百分比宽随容器缩放；需要重绘时观察**容器**而非只监听窗口，不写死画布宽高。
- 内容区 `max-width: 1480px` 只是宽度上限；水平 gutter 从窄屏到宽屏流式收敛。面板间 gap 16、面板内 padding 12–16 是令牌目标，可在紧凑视口按令牌阶梯缩小。
- **退化基线**：<1024px 侧栏转 Sheet（ADR 0011）；业务区根据容器可用宽度自动降列，<768px 以单列/分段呈现为默认。断点是保护最小可读宽度的触发点，不是固定“两排模板”。

---

## 6. 动效哲学（克制覆盖声明）

> **覆盖声明**：stitch-design-taste 默认的 spring 物理（stiffness 100/damping 20）与「常驻微动效」（Pulse/Float/Shimmer 循环）**在本项目全部不适用**——这是数据工具，动效只做状态反馈，不做氛围。本节为唯一动效基准。

| 令牌 | 值 |
|---|---|
| `--dur-fast` | 120ms（hover 变色、图标） |
| `--dur-base` | 160ms（下拉、tab 切换） |
| `--dur-dialog` | 220ms（弹窗进场） |
| `--ease-snappy` | `cubic-bezier(0.2, 0, 0.2, 1)` |

场景速查：tab 切换 = 淡入 + 6px 上移；弹窗 = 遮罩淡入 + 内容上移 12px；抽屉/toast = 侧滑；按钮 active = `scale(0.97)`；skeleton = 1.5s 扫光；进度条 = 600ms ease-out。只动 `transform`/`opacity`；`prefers-reduced-motion: reduce` 全部退化。

**永久禁止**：全局路由动画、表格行持续动画、金额滚动计数、拖拽物理弹簧、滚动视差、**蓝色水波 ripple（全域已废弃，含导出完成动效，ADR 0004）**。

---

## 7. 反模式清单（NEVER）

**视觉**
- 纯黑 `#000000`（黑 = `--ink #1f2329`）；暖灰混入冷蓝灰阶；第二 accent 色。
- 霓虹外发光、紫蓝渐变、渐变大标题、毛玻璃进内容区（`backdrop-filter` 仅限外壳顶栏 blur(8px)，ADR 0013 设计稿规格；侧栏毛玻璃仍废弃）。
- 实心状态色大色块底；一屏多枚实心蓝按钮；卡片套卡片。
- 界面文案/图标混用 emoji；图标只用 Lucide（`i-lucide-*`）单色线性。

**布局**
- 固定页面画布、固定业务区长宽、任何宽度永不变化的列模板；没有最小可读宽度保护、会造成剧烈跳动的 `auto-fit/auto-fill` 滥用；`calc()` 百分比 hack；整页横向滚动条；SegTab 横滚。
- 为凑对称硬摆「3 等分卡片行」——列数由内容语义决定。
- 文字/元素重叠、绝对定位堆内容。

**动效**：见 §6 禁止清单；不实现自定义鼠标指针。

**文案与数据**
- AI 味营销词（「赋能」「一站式」「极致」之类）；「点击探索」「下滑查看」等填充引导。
- 假人名假公司（John Doe/Acme/某某公司）、整数假数（99.99%/50%）——演示数据一律取自真实数据蓝本（`数据蓝本/`，红圈收尾链为空就留空态，**勿造数据**）。
- 未闭环页面不补演示 toast、不伪造成功状态、不以删功能换视觉相似（状态口径见 [ui-implementation-status.md](ui-implementation-status.md)）。
- 金额两位小数完整展示，禁省略号截断。

---

## 8. 线上 Design ↔ 本地开发出入清单（重构指引）

> 用户最新裁定要求真实 app 对照登录态运行参考逐屏收敛，同时保留瑞航品牌与业务语义。本节把出入拆成三类：**必须保留的产品边界**、**已确证待收敛**、**待逐屏核对**。

### 8.1 必须保留的产品边界

| 面 | 设计稿（线上） | 本地（权威） | 结论 |
|---|---|---|---|
| 应用外壳 | 白底浅色侧栏 248px（单字方块+分组）+ 64px 白顶栏 + 40px 红圈式页签 | ~~深蓝侧栏 `#162238` + 54px 顶栏 + 36px Chrome 式页签~~（ADR 0011 视觉条款已废，见 [ADR 0013](../adr/0013-align-all-ui-to-online-design.md)） | **设计稿为准**（2026-07-17 用户指令）。外壳纳入逐屏对照范围；ADR 0011 仅存行为条款 |
| 交互底座 | 手写 React 弹窗/toast | reka-ui Dialog + vue-sonner（ADR 0008） | **本地为准**，视觉语义仍按本文 |
| 业务字段与状态 | 参考页展示其自身业务对象 | 瑞航页面蓝本、DATABASE、CONTEXT 和现有 action | **瑞航为准**；只复刻信息流，不复制参考数据或状态机 |
| 新增/编辑形态 | 参考站可能使用弹窗或整页 | ADR 0014 独立路由整页表单 | **ADR 0014 为准**；弹窗只留给行级小对象 |

### 8.2 已确证待收敛——本轮实测代码逐条点名

> **完整版清单已移交 [#109 审计评论](https://github.com/zodea/crm-new/issues/109#issuecomment-4998491581)**（2026-07-17 放开限制后的全站审计：13px 阶漂移、数字层级错乱、Panel 底座缺失、content-panel 扁平残留、EntityLink/MoneyLink 穿透件缺失、列表页 chip 违例、表格汇总条/skeleton/空态、实心蓝泛滥量化、SegTab 双轨等九组）。本节以下仅保留首轮发现，后续以 #109 为准。

**① 按钮层级语言相反（最大出入，建议最先修）** ✅ **已落地（#109，2026-07-17）**：五变体齐备、缺省 secondary、实心蓝仅 accent、全站逐屏清点完成；下表现状列仅存历史。

| 处 | 现状 | 基准（§4.2） |
|---|---|---|
| [uno.config.ts:187](../../uno.config.ts) | `btn-primary = bg-brand text-white`（实心蓝当 primary 用） | 实心蓝只属于 accent，每屏 ≤1 |
| [button/index.ts:14](../../app/components/ui/button/index.ts) | shadcn `default` 变体 = 实心蓝白字、且是**缺省值** → 页面随手一个按钮就是实心蓝 | 缺省应为 secondary（描边白底安静按钮） |
| [KitButton.vue:34-38](../../app/components/ui/KitButton.vue) | 只有 brand/danger/ghost 三档，缺 primary（浅蓝底深蓝字）与 accent 分档 | 五变体齐备，层级 secondary→primary→accent |
| 同上 | 按钮 14px、无 active 按压态 | md 13px；active `scale(0.97)` |
| [DESIGN-SYSTEM.md §4.2](../rewrite/DESIGN-SYSTEM.md) | 既有文档就把 `.btn-primary` 写成实心蓝——**出入的文档根源** | 按本文 §4.2 修订该节（后续轮次） |

> 重构方向：给 Button/KitButton 补全五变体映射、把缺省降为安静按钮、实心蓝改名 accent 并全站清点「每屏一枚」。已随 #109 实施，DESIGN-SYSTEM.md §4.2 同轮修订。

**② 正文基准文档冲突** ✅ **已处理（#110 阶段③）**：以 14px 为准，ADR 0007 该句已加勘误注；13px 控件阶（SegTab/SelectFilter/SearchInput/TreeNav）与数字字阶（StatCard 24/800、Metric 17.5/13.5）同轮回收。

**③ danger 按钮** ✅ **已落地（#109）**：`destructive`/`btn-danger` 已改静默红（白底红字，§4.2 配方）。破坏性操作靠确认弹窗兜底（ADR 0003），按钮本身不必嘶吼。

### 8.3 页面对齐状态——只指向不复制

未实现与已搭未闭环清单以 [ui-implementation-status.md](ui-implementation-status.md) 为准；具体重构顺序以对应 GitHub open Issues 的优先级和依赖为准，不在品味文档维护排期快照。

### 8.4 重构工作方式

- 每屏先查 `runtime-reference-audit.md`：直接证据页按运行参考核对，邻近/待补采页不得冒充直接复刻。
- 对照顺序：信息流与安全交互 → 按钮层级 → 数字排版（mono/对齐/小数）→ 卡片与分隔（不嵌套）→ 状态色 → 工具栏与列筛选 → 动效克制。
- 同时查 `kit/*.jsx` 保留瑞航品牌和 DC 独有能力；与业务文档、ADR 冲突时业务权威源和 ADR 优先。

---

## 9. 本文维护

- 快照日期 2026-07-17。`content-v5.css`、相关 ADR、`kit/*.jsx` 任何一处变更，同轮更新本文对应小节或打「⚠️ 已过时」墓碑。
- 本文不新增令牌、不定义数据模型；新增设计决策仍走 `docs/adr/`。
