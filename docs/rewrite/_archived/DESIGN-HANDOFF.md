# 设计稿交付规范 — V1 第一版

> ⛔ **已归档**：本文不是当前设计或实现依据。现行视觉/布局与响应式契约见 [ADR 0013](../../adr/0013-align-all-ui-to-online-design.md)；下文固定比例、列数和画布尺寸仅为 2026-06-26 历史快照。
> 日期: 2026-06-26 · 用途: Claude Design 出图输入  
> 本文汇总所有已确认的页面、颜色、交互和动效规范

---

## § 1 可出图页面清单

### 已确认布局，可直接出设计稿

| 页面 | 设计文档 | 效果图状态 | 出图优先级 |
|------|---------|----------|----------|
| **首页 Dashboard** | `pages/homepage-dashboard.md` | ✅ V2 效果图已确认 | P0 |
| **项目列表** | `pages/project-info.md` § 一 | ✅ 效果图已确认 | P0 |
| **项目详情** | `pages/project-info.md` § 二-七 | ✅ V3 效果图已确认(CRM风格) | P0 |
| **全局壳（侧边栏+顶栏）** | `REWRITE-DESIGN.md` § 3 | 导航结构已确认，效果图未出 | P0 |

### 有旧版设计但需按新风格重做

| 页面 | 原设计参考 | 需要调整 | 出图优先级 |
|------|----------|---------|----------|
| 发票识别（四阶段） | `design.md` § 4 | 改用 Claude Design 色彩 + shadcn-vue 组件 | P1 |
| 送货单识别 | `design.md` § 5 | 同上 | P1 |
| 分供方列表+详情 | `design.md` § 6 | 同上 | P1 |
| 单价对比 | `design.md` § 7 | 同上 | P1 |
| 开票因子计算器 | `design.md` § 4.8 | 同上 | P1 |
| 设置弹窗 | `design.md` § 8 | 同上 | P2 |

### 未出设计文档的页面（暂不出图）

| 页面 | 状态 |
|------|------|
| 基础信息/分供方 | 待确认交互 |
| 基础信息/班组 | 待确认交互 |
| 基础信息/工人 | 待确认交互 |
| 资金管理各子模块 | 待设计 |
| 主合同管理各子模块 | 待设计 |
| 分包及人工各子模块 | 待设计 |
| 乙供材管理/采购合同 | 待设计 |

---

## § 2 颜色系统

### 2.1 Claude Design 方案 5 色板（设计基准）

**基底色**

| 用途 | 色值 | 说明 |
|------|------|------|
| 画布 | `#edf2f7` | 冷灰蓝底，比旧版 `#f5f6f8` 更蓝 |
| 面板 | `rgb(255 255 255 / 82%)` | 半透明白 + `backdrop-filter: blur(12px)` |
| 面板描边 | `#d4dde7` | 卡片边框 |
| 表头底 | `rgb(247 250 253 / 88%)` | 微透明冷白 |
| 行底(hover) | `rgb(var(--soft-rgb) / 24%)` | 品牌色极浅底 |

**品牌色**

| 令牌 | 色值 | 说明 |
|------|------|------|
| brand | `#2f63ad` | 主品牌蓝（比旧版 `#2563eb` 更深沉） |
| brand-deep | `#254d87` | 深蓝（文字/强调） |
| brand-soft-rgb | `218 227 240` | 品牌浅底 RGB（用于 rgba 组合透明度） |

**状态色**

| 状态 | 实色 | 浅底 RGB | 深字 |
|------|------|---------|------|
| ok (成功) | `#0e8a60` | `216 244 232` | `#086244` |
| warn (警告) | `#c17b18` | `255 240 204` | `#85520c` |
| danger (危险) | `#d23f4e` | `252 224 227` | `#952a36` |

**文字色**

| 用途 | 色值 |
|------|------|
| 主文字 | `#202936` |
| 次级文字 | `#657382` |
| 弱文字(label) | `#687583` |
| 极弱文字 | `#7c8793` |

### 2.2 与旧版设计的差异对照

| 属性 | 旧版 (design.md) | 新版 (Claude Design) | 变化 |
|------|-----------------|---------------------|------|
| 画布 | `#f5f6f8` 纯灰 | `#edf2f7` 冷灰蓝 | 更蓝 |
| 面板 | `#ffffff` 纯白实底 | `rgba(255,255,255,0.82)` 半透明 | 玻璃态 |
| 面板圆角 | `12px` | `13px` | 微调 |
| 面板阴影 | `0 1px 3px` 轻阴影 | `0 12px 32px rgb(40 67 104 / 8%)` 柔阴影 | 更大更柔 |
| 品牌蓝 | `#2563eb` | `#2f63ad` | 更深沉稳重 |
| ok-soft | `#b1f5d0` | `rgba(216,244,232,0.68)` | 半透明 |
| warn-soft | `#feeda9` | `rgba(255,240,204,0.72)` | 半透明 |
| danger-soft | `#fed6d6` | `rgba(252,224,227,0.70)` | 半透明 |
| 毛玻璃 | 无 | `backdrop-filter: blur(12px)` | 新增 |
| 按钮 | 实色填充 | 渐变 + 内阴影 + 毛玻璃 | 更丰富 |

### 2.3 需要设计稿确认的色彩问题

- [ ] shadcn-vue 组件的 CSS 变量命名如何映射到上述色板？
- [ ] 毛玻璃效果在 Tauri webview 中的性能表现？是否需要降级方案？
- [ ] vxe-table 主题覆写需要哪些 CSS 变量？
- [ ] 暗色模式是否在 V1 范围内？（建议 V1 不做）

---

## § 3 组件样式规范

### 3.1 按钮

```css
/* 主按钮 */
.btn-primary {
  border: 1px solid var(--brand);
  background: linear-gradient(180deg, rgb(255 255 255 / 11%), transparent), var(--brand);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 24%),
              0 4px 10px color-mix(in srgb, var(--brand) 18%, transparent);
  color: white;
  border-radius: 7px;
  padding: 8px 11px;
  font-weight: 800;
}

/* 次级按钮（柔和） */
.btn-soft {
  border: 1px solid color-mix(in srgb, var(--brand) 48%, white);
  background: rgb(var(--brand-soft-rgb) / 62%);
  color: var(--brand-deep);
  backdrop-filter: blur(8px);
  border-radius: 7px;
}
```

### 3.2 卡片/面板

```css
.panel {
  border: 1px solid #d4dde7;
  border-radius: 13px;
  background: rgb(255 255 255 / 82%);
  box-shadow: 0 12px 32px rgb(40 67 104 / 8%);
  backdrop-filter: blur(12px);
}
```

### 3.3 状态条

```css
.status {
  border-left: 4px solid;
  border-radius: 6px;
  padding: 8px 9px;
  font-weight: 800;
  backdrop-filter: blur(8px);
}
.status-ok   { border-color: var(--ok);   background: rgb(var(--ok-rgb) / 68%);   color: var(--ok-ink); }
.status-warn { border-color: var(--warn); background: rgb(var(--warn-rgb) / 72%); color: var(--warn-ink); }
.status-danger { border-color: var(--danger); background: rgb(var(--danger-rgb) / 70%); color: var(--danger-ink); }
```

### 3.4 Chip / 标签

```css
.chip {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 600;
  leading: none;
}
/* 各状态chip同status色，但用pill形状 */
```

### 3.5 输入框

```css
.field-input {
  border: 1px solid var(--brand);
  border-radius: 7px;
  padding: 8px 9px;
  background: rgb(255 255 255 / 72%);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 16%, transparent),
              inset 0 1px 0 rgb(255 255 255 / 70%);
  backdrop-filter: blur(8px);
}
/* 未聚焦态用 #d4dde7 描边，聚焦态用 var(--brand) */
```

### 3.6 侧边栏选中态

```css
.nav-active {
  box-shadow: inset 3px 0 0 var(--brand),
              inset 0 1px 0 rgb(255 255 255 / 68%);
  border: 1px solid rgb(255 255 255 / 50%);
  border-radius: 7px;
  background: rgb(var(--brand-soft-rgb) / 58%);
  color: var(--brand-deep);
  font-weight: 800;
  backdrop-filter: blur(9px);
}
```

### 3.7 上传区

```css
.upload-zone {
  border: 1px dashed color-mix(in srgb, var(--brand) 58%, white);
  border-radius: 8px;
  background: rgb(var(--brand-soft-rgb) / 34%);
  color: var(--brand-deep);
}
```

---

## § 4 字体规范

| 用途 | 字号 | 字重 | 字体 |
|------|------|------|------|
| 页面标题 (h1) | 30px | — | Microsoft YaHei / PingFang SC / system-ui |
| 卡片标题 (h2) | 14px | 800 | 同上 |
| 小节标题 (h3) | 12px | 800 | 同上 |
| 正文 | 13px | 400 | 同上 |
| 标签 | 11px | 800 | 同上 |
| 极小文字 | 9-10px | 700-800 | 同上 |
| 金额/数值 | 16-22px | 500 | `ui-monospace, Consolas, monospace` |
| 代码/编号 | 10px | 700 | 同上 |

---

## § 5 图标规范

全局使用 UnoCSS Icons preset + `@iconify-json/lucide`。

### 导航图标

| 菜单项 | 方块文字 | Lucide class |
|--------|---------|-------------|
| 首页 | 首 | `i-lucide-home` |
| 项目信息 | 项 | `i-lucide-building` |
| 基础信息 | 基 | `i-lucide-database` |
| 资金管理 | 资 | `i-lucide-wallet` |
| 主合同管理 | 合 | `i-lucide-file-signature` |
| 分包及人工 | 包 | `i-lucide-users` |
| 乙供材管理 | 材 | `i-lucide-truck` |

### 操作图标

| 操作 | class | 尺寸 |
|------|-------|------|
| 详情 | `i-lucide-file-text` | 15-16px |
| 编辑 | `i-lucide-square-pen` | 15-16px |
| 删除 | `i-lucide-trash-2` | 15-16px |
| 搜索 | `i-lucide-search` | 14px |
| 新增 | `i-lucide-plus` | 14px |
| 上传 | `i-lucide-upload` | 14px |
| 导出 | `i-lucide-download` | 14px |
| 返回 | `i-lucide-arrow-left` | 16-18px |
| 设置 | `i-lucide-settings` | 16px |
| 关闭 | `i-lucide-x` | 16px |
| 筛选 | `i-lucide-filter` | 14px |
| 刷新 | `i-lucide-refresh-cw` | 14px |
| 更多 | `i-lucide-ellipsis-vertical` | 14px |
| 信息 | `i-lucide-info` | 12px |
| 通知 | `i-lucide-bell-ring` | 18px |

---

## § 6 交互规范

### 6.1 全局交互

| 交互 | 规范 |
|------|------|
| **表格行 hover** | 背景色 `rgb(var(--brand-soft-rgb) / 24%)` |
| **蓝色链接** | 品牌蓝 `var(--brand)`，hover 下划线 |
| **操作按钮** | 28×28px，图标 15px，hover 显示 tooltip |
| **删除操作** | 红色 `var(--danger)`，需 confirm 确认 |
| **表单弹窗** | 宽度 `min(880px, 95vw)`，overlay `bg-black/40` |
| **回到顶部** | `fixed bottom-6 right-6`，滚动超一屏淡入 |
| **sticky 工具栏** | 所有操作栏 `sticky top-16`（在顶栏下方） |
| **搜索框** | 左侧放大镜图标，placeholder 灰色提示文字 |

### 6.2 首页 Dashboard 专属

| 交互 | 规范 |
|------|------|
| 通知条 | 页面最顶，每次进入弹出，可关闭（本次会话不再显示） |
| 项目 Tab | 待办数字 badge（红色），无待办不显示 |
| Tab 切换 | 下方全部面板数据刷新，skeleton 加载 |
| 面板数值 | monospace 字体，收款绿色/支出红色 |
| `+ 全部项目` | 点击跳转 `/project` |

### 6.3 项目详情专属

| 交互 | 规范 |
|------|------|
| 顶部元数据 | 一行排列，竖线分隔，公司名可点击 |
| 经营数据面板 | 所有数值自动计算，ⓘ hover 显示公式 |
| 阶段时间线 | 点击阶段节点展开/收起任务列表 |
| 阶段任务 | 每项有 [上传] [查看] 按钮，支持多文件 |
| 底部 Tab | 9 个 Tab 横向排列，窄屏可滚动 |
| 子表 | 每个子表独立搜索/筛选/导出/新增按钮 |
| 子表汇总行 | 底部显示合计金额，加粗 |

### 6.4 列表页通用

| 交互 | 规范 |
|------|------|
| 工具栏 | 标题+计数 + 搜索 + 操作按钮(右对齐) |
| 表格 | vxe-table，固定首列(#/名称)+尾列(操作) |
| 名称列 | 蓝色链接，点击跳转详情 |
| 操作列 | 纯图标按钮，hover 显示 tooltip |
| 空状态 | 居中文字提示下一步操作 |
| 表格高度 | 固定 560px，内部滚动 |

---

## § 7 动效规范

### 7.1 参数

| 属性 | 值 |
|------|-----|
| 基础时长 | 120-180ms |
| 大弹窗时长 | 220ms |
| 曲线 | `cubic-bezier(0.2, 0, 0.2, 1)` |
| 减弱动画 | 支持 `prefers-reduced-motion` |

### 7.2 动效类型

| 场景 | 动效 | 参数 |
|------|------|------|
| Tab 切换 | 淡入 + 6-8px 纵向位移 | 150ms |
| 弹窗打开 | 遮罩淡入 + 内容上移 | 220ms |
| 弹窗关闭 | 遮罩淡出 + 内容下移 | 180ms |
| 通知条出现 | 从顶部滑入 + 淡入 | 200ms |
| 通知条关闭 | 向上滑出 + 淡出 | 150ms |
| Toast 进入 | 从右侧滑入 | 180ms |
| Toast 退出 | 向右滑出 + 淡出 | 150ms |
| 按钮 active | `scale(0.97)` | 100ms |
| 卡片 hover | 微提升阴影 | 150ms |
| 阶段节点展开 | 高度展开 + 淡入 | 200ms |
| skeleton 脉冲 | 背景色左右扫光 | 1.5s loop |
| 进度条填充 | 宽度从 0 到目标值 | 600ms ease-out |

### 7.3 禁止的动效

- 全局路由大动画
- 表格行持续动画
- 金额滚动计数
- 拖拽物理弹簧
- 页面滚动视差

---

## § 8 响应式断点

| 断点 | 侧边栏 | 经营数据列数 | 表格 | Tab |
|------|--------|-----------|------|-----|
| ≥1024px (桌面) | 固定左侧 248px | 6列 | 正常 | 横排 |
| 768-1024px (平板) | 收起为图标 68px | 3列(2行) | 横向滚动 | 可滚动 |
| <768px (手机) | 底部 tab bar | 2列(3行) | 横向滚动，固定首尾列 | 可滚动 |

---

## § 9 出图批次建议

### 第 1 批: 全局壳 + 首页（4张）

| 编号 | 内容 | 尺寸 |
|------|------|------|
| G-01 | 全局壳：桌面态（侧边栏展开 + 顶栏 + 空内容区） | 1440px |
| G-02 | 全局壳：平板态（侧边栏收起 + 顶栏） | 1024px |
| D-01 | 首页 Dashboard：通知条 + Tab + 面板（合和新城选中） | 1440px |
| D-02 | 首页 Dashboard：Tab 切换（锦绣华庭选中，数据变化） | 1440px |

### 第 2 批: 项目信息（4张）

| 编号 | 内容 | 尺寸 |
|------|------|------|
| P-01 | 项目列表（工具栏 + 表格4行数据） | 1440px |
| P-02 | 项目详情：顶栏 + 经营数据 + 票据 + 阶段时间线 | 1440px |
| P-03 | 项目详情：底部 Tab「详细资料」展开 | 1440px |
| P-04 | 项目详情：底部 Tab「资金管理」展开（含子表） | 1440px |

### 第 3 批: 弹窗 + 组件（4张）

| 编号 | 内容 | 尺寸 |
|------|------|------|
| C-01 | 项目表单弹窗（新增态，4组字段） | 1440px |
| C-02 | 颜色 token 调色板 + 组件样式速查 | 1440px |
| C-03 | 通知条 + Toast 样式集 | 1440px |
| C-04 | 设置弹窗 | 1440px |

### 后续批次

发票/送货单/分供方/单价对比/开票因子等页面待逐个确认交互后出图。

---

## § 10 设计文件索引

| 文件 | 内容 |
|------|------|
| `docs/rewrite/REWRITE-DESIGN.md` | 技术选型+导航+路由+目录结构+分期(总纲) |
| `docs/rewrite/pages/homepage-dashboard.md` | 首页 Dashboard 完整设计 |
| `docs/rewrite/pages/project-info.md` | 项目列表+详情 完整设计(含25+子表) |
| `docs/rewrite/01~11-*.md` | 11项技术决策文档 |
| `docs/COLOR-BRIGHT-TRANSLUCENT-5.html` | Claude Design 方案5 色板参考(可浏览器打开) |
| `docs/项目详情页/*.png` | 25张红圈CRM项目详情截图(参考基准) |
| `docs/design.md` | 旧版设计规范(发票/送货单/分供方/单价对比，需按新风格重做) |
