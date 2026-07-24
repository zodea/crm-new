# 设计系统 — 颜色·字体·组件·图标·动效

> ⛔ 本文中的色值表为历史留档，不再作为实现依据。内容区视觉令牌唯一权威源为 `../_ds/crm-e3d87120-cf57-4b83-8a9b-188c305f529d/tokens/content-v5.css`；运行时与 `app.dc.html` / `app-new.html` 均直接加载该文件。

> 本文是设计稿输出的唯一视觉基准。  
> 色值来源: `docs/设计系统配色更新/app-new.html` color update v5 (2026-06-26)  
> 内容区交互模式: `CRM-PATTERNS.md`  
> 最后更新: 2026-06-27

---

## § 1 设计身份

### 1.1 产品定位

工地记账员的桌面——本地运行的施工项目全流程管理工具。视觉气质：机构级严肃感 + 数据密集型专业工具。

### 1.2 视觉签名

1. **中文单字方块**：导航项使用单个汉字（首/项/基/资/合/包/材）置于方块内。选中态品牌色底白字，未选中浅灰底。品牌辨识度来源。
2. **双层风格**：侧边栏保留毛玻璃质感（半透明白底+blur），内容区采用扁平企业风格（无圆角/无阴影/纯1px边框），参照 CRM-PATTERNS.md。
3. **CRM 风格内容区**：列表页列组切换+列头筛选+底部汇总；详情页信息摘要行+Section网格+右侧审批流。

### 1.3 视觉密度

高密度、可扫读。正文 14px，label 11-12px font-600，标题 font-800 加粗。金融数据使用 `font-mono` tabular-nums。间距紧凑——面板内 padding 12-16px，元素间 gap 8-12px。

---

## § 2 颜色

### 2.1 基底色

| 令牌 | 色值 | 用途 |
|---|---|---|
| `--bg` | `#f8f9fb` | 画布底色（轻机构灰） |
| `--panel` | `#ffffff` | 面板/卡片（白纸） |
| `--surface-2` | `#f1f5f9` | 表头 / 卡片次级底 |
| `--surface-3` | `#f3f4f6` | 占位 / 行 hover 底 |
| `--surface-sink` | `#e9edf4` | 预览区凹底 |
| `--line` | `#e3e6ea` | 默认描边 |
| `--line-strong` | `#c9ced6` | 强描边：按钮 / 输入框 |

> 侧边栏专用：`--sidebar-panel: rgb(255 255 255 / 82%)`（半透明白+blur），仅侧边栏使用。

### 2.2 品牌色 (v5)

| 令牌 | 色值 | 用途 |
|---|---|---|
| `--brand` | `#3976C6` | 主品牌蓝 |
| `--brand-deep` | `#2A5996` | 深蓝（选中文字/强调） |
| `--brand-soft` | `rgb(213 230 248)` | 选中行底/筛选激活态/浅底按钮 |

### 2.3 状态色 (v5) — 三档：实色 / 浅底 / 深字

| 状态 | 实色 | 浅底 | 深字 |
|---|---|---|---|
| ok (成功) | `#169D72` | `rgb(207 246 231)` | `#097251` |
| warn (警告) | `#D38A20` | `rgb(255 239 191)` | `#8B590C` |
| danger (危险) | `#E04E5C` | `rgb(253 219 224)` | `#9D313E` |

### 2.4 文字色

| 令牌 | 色值 | 用途 |
|---|---|---|
| `--ink` | `#1f2329` | 主文字 |
| `--ink-soft` | `#5b6470` | 次级文字 |
| `--ink-faint` | `#8b93a1` | 弱文字/占位符 |

### 2.5 暗色模式

V1 不做暗色模式。预留 CSS 变量结构，V2 按需扩展。

---

## § 3 形状与阴影

### 3.1 侧边栏（保留毛玻璃质感）

| 令牌 | 值 | 用途 |
|---|---|---|
| `--radius-card` | `12px` | 侧边栏面板/导航项 |
| `--radius-btn` | `8px` | 侧边栏按钮/方块 |
| `--sidebar-blur` | `blur(12px)` | 侧边栏毛玻璃 |
| `--sidebar-shadow` | `0 1px 3px rgba(16,24,40,0.08)` | 侧边栏卡片 |

### 3.2 内容区（扁平企业风格，参照 CRM-PATTERNS.md）

| 规则 | 说明 |
|---|---|
| 圆角 | **无圆角**或极小 `2-3px`（按钮/输入框最多 3px） |
| 阴影 | **不使用阴影**，纯 1px 边框区分层级 |
| 毛玻璃 | **不使用** `backdrop-filter` |
| 边框 | 统一 `1px solid var(--line)`，表格内部用 `var(--line)` |
| 背景 | 页面 `var(--bg)`，面板 `var(--panel)`，表头 `var(--surface-2)` |

### 3.3 通用

| 令牌 | 值 | 用途 |
|---|---|---|
| `--radius-pill` | `999px` | chip / badge |
| `--shadow-pop` | `0 10px 15px -3px rgba(16,24,40,0.12), 0 4px 6px -4px rgba(16,24,40,0.1)` | 弹窗/下拉浮层 |

---

## § 4 组件样式

### 4.1 面板

**侧边栏面板**
```css
.sidebar-panel {
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: rgb(255 255 255 / 82%);
  backdrop-filter: var(--sidebar-blur);
  box-shadow: var(--sidebar-shadow);
}
```

**内容区面板**
```css
.content-panel {
  border: 1px solid var(--line);
  border-radius: 0;
  background: var(--panel);
  /* 无阴影、无毛玻璃 */
}
```

### 4.2 按钮

**主按钮**
```css
.btn-primary {
  border: 1px solid var(--brand);
  border-radius: 3px;
  padding: 5px 10px;
  background: var(--brand);
  color: white;
  font-weight: 600;
}
```

**次级按钮**
```css
.btn-secondary {
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 5px 10px;
  background: var(--panel);
  color: var(--ink-soft);
}
.btn-secondary:hover {
  border-color: var(--brand);
  color: var(--brand);
}
```

**图标按钮（工具栏）**
```css
.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 3px;
  border: 1px solid var(--line);
  background: var(--panel);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-soft);
}
.icon-btn:hover { border-color: var(--brand); color: var(--brand); }
.icon-btn.primary { background: var(--brand); color: #fff; border-color: var(--brand); }
```

**危险按钮**
```css
.btn-danger {
  border: 1px solid var(--danger);
  color: var(--danger);
}
```

### 4.3 输入框

```css
.field-input {
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 5px 8px;
  background: var(--panel);
  font-size: 13px;
}
.field-input:focus {
  border-color: var(--brand);
  outline: none;
  box-shadow: 0 0 0 2px rgba(57, 118, 198, 0.15);
}
```

### 4.4 标签(label)

```css
.field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-soft);
  margin-bottom: 4px;
}
```

### 4.5 状态显示

**列表页 — 纯文字颜色（不使用 chip 背景）**

```css
.status-ok     { color: var(--ok); }
.status-warn   { color: var(--warn); }
.status-danger { color: var(--danger); }
```

**详情页/表单 — chip 背景色块（需要强调时使用）**

```css
.chip {
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-pill);
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}
.chip-ok     { background: var(--ok-soft); color: var(--ok-ink); }
.chip-warn   { background: var(--warn-soft); color: var(--warn-ink); }
.chip-danger { background: var(--danger-soft); color: var(--danger-ink); }
.chip-brand  { background: var(--brand-soft); color: var(--brand-deep); }
```

### 4.6 列组切换（CRM 风格）

```css
.col-group {
  display: flex;
  border: 1px solid var(--line);
  border-radius: 3px;
  overflow: hidden;
  background: var(--panel);
}
.col-group-item {
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-soft);
  cursor: pointer;
  border-right: 1px solid var(--line);
}
.col-group-item:last-child { border-right: none; }
.col-group-item.active { background: var(--brand); color: #fff; }
```

### 4.7 内容区 Tab（下划线式）

```css
.content-tab {
  padding: 7px 14px;
  font-size: 12px;
  color: var(--ink-soft);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.content-tab:hover { color: var(--brand); }
.content-tab.active {
  color: var(--brand-deep);
  border-bottom-color: var(--brand);
  font-weight: 600;
}
```

### 4.8 信息摘要行（详情页顶部）

```css
.info-row {
  display: flex;
  border: 1px solid var(--line);
}
.info-cell {
  flex: 1;
  padding: 8px 12px;
  border-right: 1px solid var(--line);
}
.info-cell:last-child { border-right: none; }
.info-cell .label { font-size: 9px; color: var(--ink-faint); margin-bottom: 3px; }
.info-cell .value { font-size: 12px; }
```

### 4.9 表单网格（详情页 Section）

```css
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  border: 1px solid var(--line);
  background: var(--panel);
}
.form-cell {
  padding: 8px 10px;
  border-bottom: 1px solid var(--surface-3);
  border-right: 1px solid var(--surface-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.form-cell:nth-child(3n) { border-right: none; }
.form-cell .fl { font-size: 9px; color: var(--ink-faint); }
.form-cell .fv { font-size: 12px; }
```

### 4.10 审批时间线（详情页右侧）

```css
.timeline-item {
  display: flex;
  gap: 8px;
  padding-bottom: 12px;
  position: relative;
}
.timeline-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  flex-shrink: 0;
}
.timeline-line {
  position: absolute;
  left: 13px;
  top: 32px;
  width: 1px;
  height: calc(100% - 24px);
  background: var(--line);
}
```

### 4.11 上传区

```css
.upload-zone {
  border: 1px dashed var(--line-strong);
  border-radius: 3px;
  background: var(--surface-3);
  color: var(--brand-deep);
  padding: 20px;
  text-align: center;
}
```

### 4.12 侧边栏选中态

```css
.nav-active {
  box-shadow: inset 3px 0 0 var(--brand);
  border: 1px solid rgb(255 255 255 / 50%);
  border-radius: var(--radius-btn);
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-weight: 800;
  backdrop-filter: blur(9px);
}
```

### 4.13 vxe-table 主题覆写要点

- 表头背景: `var(--surface-2)`
- 行 hover: `var(--surface-3)`
- 描边: `var(--line)`
- 列竖线: `1px solid var(--line)`（完整网格线，参照 CRM）
- 字体: 继承全局，金额列 `font-mono`
- 操作列: 纯图标按钮 `.icon-btn`
- 状态列: 纯文字颜色（列表页不用 chip）
- 列头筛选: 漏斗图标，点击弹下拉多选

### 4.14 分页

```css
.pager-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--panel);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--ink-soft);
  cursor: pointer;
}
.pager-btn:hover { border-color: var(--brand); color: var(--brand); }
.pager-btn.active { background: var(--brand); color: #fff; border-color: var(--brand); }
```

---

## § 5 字体

| 用途 | 字号 | 字重 | 字体 |
|---|---|---|---|
| 页面大标题 | 24px | 800 | var(--font-sans) |
| 模块名/项目名 | 17px | 500 | var(--font-sans) |
| 卡片区块标题 | 13-14px | 700-800 | var(--font-sans) |
| 正文 | 14px | 400 | var(--font-sans) |
| 紧凑正文/表格 | 12-13px | 400 | var(--font-sans) |
| 标签 | 11-12px | 600 | var(--font-sans) |
| 统计卡数字 | 20-24px | 500 | var(--font-mono) |
| 金额/编号 | 11-14px | 500-700 | var(--font-mono) |
| 导航副提示 | 11px | 400 | var(--font-sans) |
| 极小提示 | 9-10px | 400 | var(--font-sans) |

```css
:root {
  --font-sans: "Noto Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
```

---

## § 6 图标

全局使用 UnoCSS Icons preset + `@iconify-json/lucide`，class 格式 `i-lucide-xxx`。

### 6.1 导航图标

| 菜单 | 方块字 | Lucide |
|---|---|---|
| 首页 | 首 | `i-lucide-home` |
| 项目信息 | 项 | `i-lucide-building` |
| 基础信息 | 基 | `i-lucide-database` |
| 资金管理 | 资 | `i-lucide-wallet` |
| 主合同管理 | 合 | `i-lucide-file-signature` |
| 分包及人工 | 包 | `i-lucide-users` |
| 乙供材管理 | 材 | `i-lucide-truck` |

### 6.2 操作图标

| 操作 | class |
|---|---|
| 详情 | `i-lucide-file-text` |
| 编辑 | `i-lucide-square-pen` |
| 删除 | `i-lucide-trash-2` |
| 搜索 | `i-lucide-search` |
| 新增 | `i-lucide-plus` |
| 上传 | `i-lucide-upload` |
| 导出 | `i-lucide-download` |
| 返回 | `i-lucide-arrow-left` |
| 设置 | `i-lucide-settings` |
| 关闭 | `i-lucide-x` |
| 筛选 | `i-lucide-filter` |
| 刷新 | `i-lucide-refresh-cw` |
| 更多 | `i-lucide-ellipsis-vertical` |
| 信息 | `i-lucide-info` |
| 通知 | `i-lucide-bell-ring` |
| 识别 | `i-lucide-scan-text` |
| 打印 | `i-lucide-printer` |
| 放大 | `i-lucide-zoom-in` |
| 排序 | `i-lucide-arrows-up-down` |
| 列设置 | `i-lucide-columns-3` |
| 成功 | `i-lucide-circle-check` |
| 警告 | `i-lucide-triangle-alert` |

图标尺寸: 操作列 15px，导航 16px，装饰 18px。

---

## § 7 动效

### 7.1 参数

| 令牌 | 值 |
|---|---|
| `--dur-fast` | `120ms` |
| `--dur-base` | `160ms` |
| `--dur-dialog` | `220ms` |
| `--ease-snappy` | `cubic-bezier(0.2, 0, 0.2, 1)` |
| 减弱动画 | `prefers-reduced-motion: reduce` 时禁用 |

### 7.2 场景

| 场景 | 效果 | 时长 |
|---|---|---|
| Tab 内容切换 | 淡入 + 6px 纵向位移 | 150ms |
| 弹窗打开 | 遮罩淡入 + 内容从底部上移 12px | 220ms |
| 弹窗关闭 | 遮罩淡出 + 内容下移 | 180ms |
| 通知抽屉打开 | 从右侧滑入 | 200ms |
| 通知抽屉关闭 | 向右滑出 | 150ms |
| Toast 进入 | 从右侧滑入 | 180ms |
| Toast 退出 | 向右滑出 + 淡出 | 150ms |
| 按钮 active | `scale(0.97)` | 100ms |
| skeleton 加载 | 背景色扫光 | 1.5s loop |
| 进度条填充 | 宽度 0→目标 | 600ms ease-out |
| 下拉框展开 | 高度展开 + 淡入 | 160ms |

### 7.3 导出完成动效 — 水波粼粼

导出操作（发票 PDF、送货单、工人信息 Excel 等）完成后，播放品牌蓝色水波动效作为成功反馈。

**视觉描述**：
1. 一滴蓝色水滴从导出按钮位置落下（150ms，ease-in）
2. 水滴触达后消失，从落点扩散 2-3 圈同心水波纹（600ms）
3. 水波纹使用品牌蓝色 `--brand: #3976C6`，opacity 从 0.4 → 0 逐渐透明
4. 波纹之间间隔 120ms 依次触发，形成粼粼效果
5. 整体动效 ~800ms，不阻塞操作

**技术要点**：
- 水波使用 CSS `border-radius: 50%` + `scale` + `opacity` 组合动画
- 水滴使用椭圆形 SVG，落下时带轻微拉伸变形（`scaleY(1.2)`）
- 颜色：水滴 `--brand`，波纹 `--brand-soft` → `transparent`
- `prefers-reduced-motion: reduce` 时退化为简单的 checkmark 淡入

**触发场景**：
| 场景 | 触发位置 |
|------|----------|
| 导出打印 PDF | 导出按钮 |
| 导出原件/Excel 台账 | 导出按钮 |
| 送货单导出 | 导出按钮 |
| 工人信息导出 | 导出按钮 |
| 分供方导出 | 导出按钮 |

### 7.4 禁止

全局路由动画、表格行持续动画、金额滚动计数、拖拽物理弹簧、滚动视差。

---

## § 8 响应式

| 断点 | 侧边栏 | 内容区 | 表格 |
|---|---|---|---|
| ≥1024px 桌面 | 固定左侧 248px | max-w-[1480px] mx-auto | 正常 |
| 768-1024px 平板 | 收起 68px(图标模式) | 满宽 | 横向滚动 |
| <768px 手机 | 底部 tab bar h-16 | 满宽 | 横向滚动，固定首尾列 |

弹窗宽度: `min(880px, 95vw)`。长公司名/文件名: `truncate` + `title`。

---

## § 9 新旧令牌映射

旧代码中可能使用的令牌到新令牌的映射（迁移参考）：

| 旧令牌 | 新令牌 | 说明 |
|---|---|---|
| `--canvas` | `--bg` | 画布底色 |
| `--panel` (rgba) | `--panel` (#fff) | 内容区不再半透明 |
| `--panel-border` | `--line` | 描边统一 |
| `--panel-solid` | `--panel` | 合并 |
| `--surface-head` | `--surface-2` | 表头底 |
| `--surface-hover` | `--surface-3` | hover 底 |
| `--ink-label` | `--ink-soft` | 合并为一级 |
| `--brand: #2f63ad` | `--brand: #3976C6` | v5 更新 |
| `--brand-deep: #254d87` | `--brand-deep: #2A5996` | v5 更新 |
| `--ok: #0e8a60` | `--ok: #169D72` | v5 更新 |
| `--warn: #c17b18` | `--warn: #D38A20` | v5 更新 |
| `--danger: #d23f4e` | `--danger: #E04E5C` | v5 更新 |
| `--shadow-card` | 内容区移除 | 仅侧边栏/弹窗保留 |
| `--blur` / `--blur-sm` | 内容区移除 | 仅侧边栏保留 |
| `--radius-card: 13px` | `--radius-card: 12px` | 对齐 Claude Design |
| `--radius-btn: 7px` | `--radius-btn: 8px` / 内容区 `3px` | 对齐 |
