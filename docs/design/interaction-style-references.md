# 交互原语改版 · 多风格参考站

配合已定的 **Sonner 风格 toast** 使用。收录各类交互「能直接点开、看到实际效果」的真实网站，逐类挑方向。所有链接经实测可打开且内容相关。品牌基调：蓝 `#3976C6` + 白面板 `#fff`。

> **改版工作约定**：每类交互改版前，先出这样一份多风格参考站菜单（能直接点开看效果）供挑方向，挑定再实装。dev 验证载体：`/dev/kit-ui`。

在线可视版（本会话生成的 Artifact，含卡片式排版）：
- toast 五风格菜单 · <https://claude.ai/code/artifact/2d65b7a8-ab04-4634-8d69-0d89b481c4de>（六类交互版）

---

## Toast —— 已定：Sonner 风格双泳道（已实装 = vue-sonner，[ADR 0008](../adr/0008-adopt-shadcn-vue-on-unocss.md)）

> 实装底座：**vue-sonner 两个 Toaster**（`toasterId` 路由双泳道），非自研。下面的风格决策据此落地。

- **决策**：走 [Sonner](https://sonner.emilkowal.ski/) 风格。分两条泳道：
  - **system 道**（右上，展开可读）：系统消息 + 需确认后的结果类。
  - **process 道**（右下，重叠堆叠省空间、hover 展开）：上传/识别等界面交互过程提示。
  - **promise/loading**：HeroUI 式加载中转圈 → 自动成功/失败。
- 关键参考（已实测）：
  - [Sonner](https://sonner.emilkowal.ski/) · 可交互 — Action 型即带 Undo 撤回按钮 + 折叠/展开堆叠
  - [Vercel Geist · Toast](https://vercel.com/geist/toast) · 可交互 — Undo 撤回条口径最规范
  - [shadcn · Sonner](https://ui.shadcn.com/docs/components/radix/sonner) · 可交互 — 六向 position + promise
  - [HeroUI · Toast](https://heroui.com/docs/react/components/toast) · 可交互 — promise/loading 态样板
  - [Mantine · Notifications](https://mantine.dev/x/notifications/) · 可交互 — 队列堆叠上限、loading→success 原地打勾

> 其余探索过的方向（活泼圆润 / 玻璃拟态 / 动效炫酷 / 潮流组件集）见上方在线菜单，未采用。

---

## 其余交互（待挑方向）

### 01 · 确认弹窗 `confirm-dialog`
**要点**：破坏性操作要让人「停顿」—— 遮罩 + 焦点锁定 + Esc/取消有退路；取消走中性、确认走 danger 红并写明「不可撤销」；高危场景加 type-to-confirm（打字确认）。

- [DesignRevision · Alert Dialog](https://designrevision.com/components/alert-dialog) · 可交互 — 一页 5 个 demo：基础→红色破坏性→Async(点确认转 spinner 不关弹窗)→GitHub 式打字确认
- [shadcn/ui · Alert Dialog](https://ui.shadcn.com/docs/components/radix/alert-dialog) · 可交互 — 最贴现有克制风，Delete Chat 红色破坏性范式
- [Radix Themes · Alert Dialog](https://www.radix-ui.com/themes/docs/components/alert-dialog) · 可交互 — 评估「品牌蓝主色 + 红确认」配色关系
- [Mantine · Modals manager](https://mantine.dev/x/modals/) · 可交互 — 命令式调用 + 堆叠/递进确认

**推荐**：骨架用 shadcn/DesignRevision 克制结构，高危项叠 type-to-confirm + Async spinner。**落到瑞航**：确认按钮绑 `--danger`、取消用 ghost 灰，品牌蓝不当主角；不用毛玻璃，`rgba(0,0,0,.28)` 轻遮罩即可。

### 02 · 表单弹窗 `form-modal`
**要点**：标题「动词+名词」；字段分组、失焦即时校验、错误贴字段下方；主按钮放右下 footer、动词与标题一致；打开聚焦第一个输入框；有未保存内容要拦。

- [Mantine · Modal](https://mantine.dev/core/modal/) · 可交互 — 最贴现基准，Focus on inner element / size / centered
- [shadcn/ui · Dialog](https://ui.shadcn.com/docs/components/dialog) · 可交互 — Sticky Footer / Scrollable（长表单吸底）
- [Vercel Geist · Modal](https://vercel.com/geist/modal) · 可交互 — 打开自动聚焦 + 提交 loading/disabled
- [Flowbite · Modal](https://flowbite.com/docs/components/modal/) · 可交互 — Create new product 标准 CRUD 表单样板

**推荐**：Mantine/shadcn 克制骨架（白面板、footer 右下主按钮、长表单吸底），主按钮与聚焦态换品牌蓝。**落到瑞航**：白面板、圆角 8-12px、主按钮 `--brand`、校验红提示 `--danger` 贴字段下方；别整体太企业风，圆角/留白可往 Flowbite 靠一档。

### 03 · 导出进度 `export-progress`
**要点**：开始有反馈（进度条/spinner 立刻出现）、过程有推进感（别停 0%）、完成有明确落点（打勾 + 成功色 +「导出到 X」）；多阶段用步骤条，单文件用进度条，失败原地转 error。

- [Sonner · Toast(promise 段)](https://sonner.emilkowal.ski/toast) · 可交互 — loading→自动打勾，与已定 toast 同源，单文件直接照抄
- [Material UI · Stepper](https://mui.com/material-ui/react-stepper/) · 可交互 — 多阶段：读数据→生成→写盘→完成，走过的步打勾
- [Mantine · Progress](https://mantine.dev/core/progress/) · 可交互 — 单文件百分比进度条，平滑宽度过渡
- [PatternFly · Progress stepper](https://www.patternfly.org/components/progress-stepper/design-guidelines/) · 图解为主 — completed/in-progress/failure/warning/pending 五态配色最全

**推荐**：单文件走 Sonner promise toast，多阶段走 MUI Stepper（带打勾），失败态参照 PatternFly。**落到瑞航**：激活步 `--brand`、完成步 `--ok`、失败步 `--danger`；成功收尾=静态 toast 成功、无动效（全局蓝色水波已废弃，见 ADR 0004）。

### 04 · 导入映射 `import-mapping`
**要点**：「上传→认列→校验→入库」拆成清晰 stepper；映射步用源列↔系统字段两栏对照 + 智能预匹配（高亮已匹配/未匹配/必填缺失）；一屏可滚动行预览；导入走进度条而非空等。

- [Dromo · sandbox](https://demo.dromo.io) · 可交互 — 白底克制，第 2 步 AI 自动列映射 + 行内校验，浏览器内跑完整流程免注册
- [CSVbox · Demo](https://csvbox.io/demo/) · 可上传实测 — 直接传真实 CSV/Excel，自动 map + 逐行校验
- [importcsv · Playground](https://docs.importcsv.com/playground) · 可交互 — 左配字段规则右实测导入向导
- [Material UI · Stepper](https://mui.com/material-ui/react-stepper/) · 可交互 — 多步骨架范式（含错误态）

**推荐**：以 Dromo 克制布局为骨架（三步 stepper：上传→映射→预览/导入），stepper 参照 MUI；避免 CSVbox 过饱和配色。**落到瑞航**：映射步 `--brand` 标已匹配、`--warn` 待确认、`--danger` 必填缺失；导入进度条用蓝色，与导出呼应。

### 05 · 抽屉 Sheet `drawer-sheet`
**要点**：右侧滑出装表单/详情、底部升起装移动端快捷操作；重滑入物理感（缓动、可拖拽把手、拖一半回弹）、背板处理、顶部标题栏 + 底部操作条固定 + 中间可滚动三段式。

- [shadcn-vue · Sheet](https://www.shadcn-vue.com/docs/components/sheet) · 可交互 — **Vue 原生**（技术栈直接对齐），右侧滑出三段式，代码可直接抄
- [Vaul · Drawer](https://vaul.emilkowal.ski/) · 可交互 — iOS 质感拖拽把手 + 拖一半回弹，缓动手感全网最佳
- [Mantine · Drawer](https://mantine.dev/core/drawer/) · 可交互 — 四向 + 毛玻璃开关实拖对比 + 多层叠开
- [HeroUI · Drawer](https://heroui.com/docs/react/components/drawer) · 可交互 — 毛玻璃背板（仅作展示性灵感）

**推荐**：结构与代码抄 shadcn-vue Sheet（就是本项目技术栈），动效缓动抄 Vaul。**落到瑞航**：桌面端「编辑项目/看工程量详情」走右侧 Drawer（宽 420-520px），三段式，背板 `rgba(0,0,0,.28)` 轻遮罩、**别上毛玻璃**（Tauri 性价比低）；窄窗退化为底部 Sheet + 拖拽把手。

### 06 · 按钮三态 `button-states`
**要点**：同一颗按钮原地走完 default→loading（转圈+禁用防重复提交）→success（打勾），**锁死宽度不跳动**，成功停约 1s 再复位；行内校验把错误贴字段下方。

- [shadcn/ui · Button](https://ui.shadcn.com/docs/components/radix/button) · 半交互 — Spinner 小节：Generating…/Downloading… 禁用态
- [Aceternity · Stateful Button](https://ui.aceternity.com/components/stateful-button) · 可交互 — 文字缩掉→转圈→打勾一气呵成，「成功一击」记忆点
- [MUI · Button(loading)](https://mui.com/material-ui/react-button/) · 可交互 — 锁宽/禁用细节、spinner 三种位置
- [Indie UI · Stateful Buttons](https://ui.indie-starter.dev/docs/stateful-buttons) · 可交互 — spinner/pulsing 两种反馈

**推荐**：shadcn 克制骨架当基线，嫁接 Aceternity 的 loading→打勾弹性微动画当「成功一击」。**落到瑞航**：默认 `--brand`、success 打勾 `--ok`、校验 `--danger` 贴行内；进 loading 立即 disabled 防重复、锁死宽度、成功停约 1s 复位。

---

_链接均经实测可打开且相关；候选中若干因 SPA/反爬/无自助 demo（403/404）未收录。_
