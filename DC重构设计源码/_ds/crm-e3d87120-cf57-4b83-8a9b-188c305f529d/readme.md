# 扫描件助手 Design System

面向**建筑工地财务**的本地桌面工具「扫描件助手」的设计系统。它把工地记账员每天处理的纸质单据——发票、手写送货单、分供方资料、工人证书——变成可识别、可校对、可对账、可导出的结构化数据。视觉气质接近**银行柜台终端**，不是 SaaS 仪表盘，不是营销官网。一切为吞吐量服务。

> ⚠️ **现行范围勘误（2026-07-18）**：本文源自早期独立“扫描件助手”，模块组织和固定布局仅作令牌来源/历史参考。当前 Claude Design 只以 `app.dc.html` 为应用界面；全站布局必须遵循仓库根目录 `docs/adr/0013-align-all-ui-to-online-design.md` 的响应式与自适应契约。

> 产品定位一句话：**"工地记账员的桌面"**。高密度、可扫读、本地优先、数据不上传。

## 来源（Sources）

本设计系统对照以下真实代码库逆向还原，读者若有权限可深入查阅：

- **GitHub**：[`zodea/invoice-recognition-app`](https://github.com/zodea/invoice-recognition-app)（`main` 分支）— Vue 3 + Tauri 桌面应用。
  - `design.md` — 界面设计规范（令牌、布局、各视图、响应式、动效），是还原的主要依据。
  - `CONTEXT.md` — 领域术语表（工地/分供方/送货单/识别明细库/单价对比排除集…）。
  - `uno.config.ts` + `src/styles.css` — 颜色/圆角/阴影/shortcut 的唯一来源。
  - `src/App.vue` + `src/views/*.vue` — 壳层与六个视图的真实实现。

技术栈参考：Vue 3、UnoCSS（`presetWind3` + `presetIcons` + Lucide）、reka-ui（弹窗）、vxe-table（表格）、pdfjs/pdf-lib（PDF）、xlsx（Excel）、PaddleOCR（识别）。本设计系统用 React 复刻其**视觉与交互**，非生产实现。

## 六大模块

| 单字 | 模块 | 职责 |
| --- | --- | --- |
| 票 | 发票管理（首页） | 识别·校对·入账。四阶段：文档识别状态 → 三栏校对 → 待入账 → 已入账 |
| 单 | 送货单 | 扫描·整理·归档。拖拽上传 → 整理树（工地/分供方）→ 识别 → 导出 PDF+Excel |
| 方 | 分供方 | 资料管理·对账。公司全称/税号/开户行/联系人；从发票收集；Excel 导入导出 |
| 项 | 施工项目 | 项目管理。名称/状态/地址/开工日期/建设单位/项目经理 |
| 工 | 工人信息 | 人员证书管理。工种/班组/在场状态/日工资/证书到期提醒 |
| 价 | 单价对比 | 材料价格分析。多供应商同材料横向对比，最低价高亮，运费类可剔除 |

---

## 内容基调（Content Fundamentals）

**语言**：简体中文，工地财务行话。术语精确、不口语化营销化。例：「分供方」（不说"供应商伙伴"）、「待入账」「价税合计」「红章为准」「待复核」「同类合并」。

**人称**：界面以**功能名词**与**动作动词**为主，几乎不用"你/您/我"。按钮是祈使动词短语——「批量识别」「确认并入账」「重新整理」「从发票收集」「废弃该单据」。提示语对系统状态做客观陈述，不拟人：「识别完成」「重复已排除」「OCR 未配置或无法连接」。

**casing / 标点**：中文无大小写；英文专有名词保留原样（PaddleOCR-VL、Excel、PDF、OCR）。数字、金额、日期、单号一律半角 + 等宽。金额带 `¥` 前缀、两位小数；税点写 `13%`；日期 `2026-06-15`；单号取尾部流水（红色流水号，OCR 易与税号粘连）。

**语气**：克制、确定、可信赖——像柜台终端，不像助手。**绝不**用感叹号堆砌、不用 emoji（设计明确"已替换所有 emoji 图标"）、不用营销辞令（无"智能""一键搞定""赋能"）。

**空状态**：永远指明下一步，不留白。例：「尚未上传任何文档 · 上传后进入文档识别状态」「还没有分供方。可手动新增、从已识别发票收集，或导入现有 Excel。」

**冲突/校对话术**：来源不一致即亮色标注并给二选一动作——「文件夹说 A / 识别是 B」，一键采用或保留。机器不确定的统一标「待复核」，汇总进 Excel「待复核清单」。

**示例文案**：贴近工地/财务，**禁止** Acme / Amazon / London Site / John Smith 这类通用假数据；用「合和新城·3 号楼」「广州市大板东建材有限公司（简称大板东）」「HRB400 螺纹钢 Φ12」「C30 商品混凝土」。

---

## 视觉基础（Visual Foundations）

**色彩策略**：四层信号。机构灰画布 `#f5f6f8`（"这是严肃的财务工具"）→ 白纸面板 `#ffffff` 浮在灰桌面上，层级天然分明 → 唯一品牌蓝 `#2563eb` 只标记"你在哪"和"主操作" → 状态用红/橙/绿交通灯，**每色三档**（实色 DEFAULT / 浅底 soft / 深字 ink）。**不使用**渐变、玻璃态、深色模式、装饰性色带。品牌蓝是页面上唯一的非状态彩色——克制是纪律。

**字体**：界面用系统中文字体（原应用 Microsoft YaHei / PingFang SC）；本设计系统以 **Noto Sans SC** 作跨平台等价替身（见下「字体替换」）。财务字段（发票号/税号/日期/金额/税额）一律**等宽 + `tabular-nums`**，保证数字竖向对齐、可逐位核对。字号高密度：正文 14px、label 11–12px font-600、小标题 13px font-700、标题 font-800、统计数字 24px font-800。

**间距 / 密度**：高密度可扫读。panel 内边距 12–16，元素间 gap 8–12。紧凑但不拥挤——靠分隔线与表面层次分区，**不嵌套卡片**。主内容 `max-width: 1480px`，超宽屏左右留空。

**圆角**：容器更圆、控件更挺——卡片/面板 **12px**，按钮/输入框 **8px**，chip/圆形按钮 **999px**。这组对比是品牌的形状签名。

**卡片长什么样**：白底 + `1px var(--line)` 描边 + L1 卡片阴影（`0 1px 3px / 0 1px 2px`，极柔）+ 12 圆角。可点击卡片 hover 时升级到 L2 弹层阴影 + 蓝框。

**阴影系统**：仅两级。L1 `shadow-card` 给静态卡片极轻浮起；L2 `shadow-pop` 给弹层/下拉/hover 卡片柔和扩散。无重投影、无彩色光晕。

**描边**：默认描边 `#e3e6ea`（卡片、分隔）；强描边 `#c9ced6`（按钮、输入框）。表格行用 `1px line` 分隔，表头 `surface-2` 浅底。

**背景**：纯色。画布灰、面板白、表头/凹底浅灰。**无**图片背景、无全幅大图、无插画、无重复纹理、无渐变。预览区用 `surface-sink` 凹底承托白色 A4 纸。唯一的"图像"是用户自己的扫描件缩略图。

**动效**：快、原生桌面手感。时长 120–180ms（大弹窗 220ms），曲线 `cubic-bezier(0.2,0,0.2,1)`。五类：阶段切换（淡入 + 6–8px 纵移）、左右联动（点打印位→右栏行高亮 pulse）、弹窗（遮罩淡入 + 内容上移）、树/卡片展开、toast。**禁止**：全局路由大动画、表格行持续动画、金额滚动计数、拖拽物理弹簧。支持 `prefers-reduced-motion`。

**hover / press 状态**（贴合原应用 snappy native desktop）：
- secondary 按钮 hover → 浅灰底 `#eceef1` + 边框转 `ink-soft`；primary hover → `opacity .9`；ghost hover → 浅蓝底 + 蓝字；danger hover → 浅红底 `rgba(220,38,38,.05)` + 红框。
- press（active）→ 统一 `scale(.97)` 轻微压下反馈。
- 输入框 focus → 蓝框 + `0 0 0 3px rgba(37,99,235,.18)` 蓝环。
- 表格行 hover → `surface-2` 浅底；选中 → `brand-soft` 浅蓝底。

**布局规则**：桌面侧栏 248/68px 与顶栏 64px 是外壳组件令牌，不是固定页面画布；<1024px 侧栏转 Sheet。业务区默认流式响应容器：宽屏三栏只是首选构图，空间不足时改为两栏/分段/单列，操作栏允许换行或紧凑收纳；禁止整页横滚，表格、甘特、A4 预览只在自身容器滚动。最低验证 390 / 768 / 1024 / 1440px，不再使用旧“<768 底部 tab bar”方案。

**透明 / 模糊**：仅顶栏用 `backdrop-blur` + 95% 白底；其余不透明。无大面积玻璃态。

### 视觉签名（两个记忆点）
1. **中文单字图标方块**：导航项用单个汉字（票/单/方/项/工/价）置于 8px 圆角方块内。选中态白底蓝字 + 左侧 3px 内描边蓝条；未选浅灰底。这是品牌辨识度来源——替代 emoji 后仍保留单字，不换成纯 Lucide 图标。
2. **A4 打印排版预览**：发票校对中栏不是普通列表，而是真实 A4 比例（`aspect-ratio: 1/1.4142`）打印网格，每页 1/2/4 张，看到的就是打印出来的样子。

### 字体替换（需你确认）
原应用用系统中文字体，未内置 webfont。为在任意浏览器一致渲染，本系统以 **Noto Sans SC**（Google Fonts）作等价替身，回退到 Microsoft YaHei / PingFang SC 系统栈；等宽栈用系统 mono（`ui-monospace` 等）。**若需绝对还原原生外观，或你有指定中英文/等宽字体文件，请上传，我替换。**

---

## 图标（Iconography）

**全局图标系统：Lucide**。原应用通过 UnoCSS Icons preset（`presetIcons` + `@iconify-json/lucide`）使用 `i-lucide-*` 类名，**已替换所有 emoji 图标**——这是设计的硬规则（不同系统 emoji 渲染不一致）。线宽 2、纯描边、`currentColor` 跟随文字色。

本设计系统通过 CDN（`https://unpkg.com/lucide@latest`）加载 Lucide，并提供 `Icon` 组件（`<Icon name="scan-text" />`）按需渲染同名 SVG。**这是与原应用一致的图标集，非替代品。**

**操作 → 图标映射**（节选）：识别 `scan-text` · 编辑 `square-pen` · 删除 `trash-2` · 入账 `file-check` · 移回待入账 `file-output` · 详情 `file-text` · 查看树 `file-search` · 搜索 `search` · 筛选 `filter` · 上传 `upload` · 文件夹 `folder-open` · 打印 `printer` · 导出 `download` · 重新识别 `refresh-cw` · 设置 `settings` · 警告 `triangle-alert` · 放大 `zoom-in` · 旋转 `rotate-ccw`/`rotate-cw` · 更多 `ellipsis` · 回到顶部 `arrow-up`。

**导航图标**（历史映射；当前 app 侧栏用中文单字方块，Lucide 主要用于组头与动作）：发票 `receipt-text` · 送货单 `truck` · 分供方 `building-2` · 施工项目 `building` · 工人 `users` · 单价对比 `scale`。

**规则**：表格操作列统一**纯图标 + tooltip**，不混用文字按钮（窄屏不挤爆）。**不使用** emoji，不用 unicode 字符当图标（✓ 除外，用于最低价标记）。导航的单字汉字方块是品牌签名，不属于"图标"范畴、不替换。

---

## 索引（Manifest）

**根**
- `styles.css` — 全局入口（仅 `@import`）。消费方链接此一个文件。
- `tokens/` — `colors.css` · `typography.css` · `spacing.css`（含圆角/阴影/布局尺度/动效）· `fonts.css` · `base.css`。
- `readme.md`（本文）· `SKILL.md`（Agent Skill 入口）。

**组件**（`window.DesignSystem_e3d871.*`）
- `components/core/` — `Button` · `IconButton` · `StatusChip` · `Panel` · `Field` · `StatCard` · `Icon`。
- `components/navigation/` — `NavItem`（单字方块导航·签名）· `StageTab`（阶段 tab）· `FilterPill`（筛选标签）。
- 每个组件含 `.jsx` + `.d.ts` + `.prompt.md`；每目录一张 `@dsCard` 演示卡。

**规范卡片**（Design System 标签页）
- `guidelines/*.card.html` — Colors（表面/品牌/墨阶/状态三色/描边）、Type（字族/字号字重/财务数字）、Spacing（圆角/阴影/间距阶）、Brand（视觉签名/Lucide 图标）。

**UI Kit**
- `ui_kits/scanner-assistant/` — 完整可点击桌面应用（六视图 + 设置弹窗）。入口 `index.html`，见该目录 `README.md`。

---

## 怎么用

做工地财务相关的界面、原型或演示时：复用 `tokens/` 的 CSS 变量与 `components/` 的组件原语，对照 `ui_kits/scanner-assistant` 的真实版式。守住三条底线——**机构灰 + 白纸 + 唯一品牌蓝**、**财务数字等宽对齐**、**导航用中文单字方块**——就不会跑偏。
