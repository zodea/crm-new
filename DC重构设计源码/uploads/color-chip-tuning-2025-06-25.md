# 颜色加深 + chip 间距调优

> 日期：2025-06-25
> 修改文件：`uno.config.ts`
> 关联截图：发票管理主视图（InvoiceView）

---

## 问题

| # | 问题 | 表现 |
|---|------|------|
| 1 | soft 色阶偏浅 | chip 背景几乎与白色面板融为一体，状态区分度低 |
| 2 | chip 内文字不垂直居中 | 中文默认 line-height 偏高，文字视觉偏上 |
| 3 | chip 内边距过窄 | `px-2.25 py-0.75` 中文字贴边，显得拥挤 |

---

## 色阶调整（v3 定稿）

从原始 → v1 → v2 三轮迭代后取折中值。

| 令牌 | 原值 | v3 定稿 | 说明 |
|------|------|---------|------|
| `brand-soft` | `#e8f0fe` | `#cde3fe` | 蓝色浅底，用于 chip-brand / 选中行 / 筛选按钮激活态 |
| `ok-soft` | `#dcfce7` | `#b1f5d0` | 绿色浅底，用于 chip-ok（识别完成、已入账） |
| `warn-soft` | `#fffbeb` | `#feeda9` | 琥珀浅底，用于 chip-warn（待人工校对、历史已用） |
| `danger-soft` | `#fef2f2` | `#fed6d6` | 红色浅底，用于 chip-danger（识别失败、重复已排除） |

ink 色（深字）保持不变：

| 令牌 | 值 | 用途 |
|------|-----|------|
| `ok-ink` | `#166534` | 绿色 chip 文字 |
| `warn-ink` | `#92400e` | 琥珀 chip 文字 |
| `danger-ink` | `#991b1b` | 红色 chip 文字 |
| `brand` | `#2563eb` | 蓝色 chip 文字（brand 直接用主色） |

### 色阶位置参考（Tailwind scale）

```
原始    ≈ 50 级（几乎白色）
v3 定稿 ≈ 150 级（v1 的 100 与 v2 的 200 之间）
```

---

## chip 间距 + 居中修复

| 属性 | 原值 | 修改后 | 说明 |
|------|------|--------|------|
| `padding-x` | `px-2.25`（9px） | `px-2.5`（10px） | 左右各多 1px 呼吸空间 |
| `padding-y` | `py-0.75`（3px） | `py-1`（4px） | 上下各多 1px |
| `line-height` | 继承（1.5） | `leading-none`（1） | 去除行高导致的视觉偏上 |

### shortcut 变更

```diff
- chip: "inline-flex items-center rounded-full px-2.25 py-0.75 text-xs font-600"
+ chip: "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-600 leading-none"
```

---

## 受影响的 chip 变体

所有变体继承 `chip` 基础 shortcut，无需单独改：

- `chip-ok` → `chip bg-ok-soft text-ok-ink`
- `chip-warn` → `chip bg-warn-soft text-warn-ink`
- `chip-danger` → `chip bg-danger-soft text-danger-ink`
- `chip-brand` → `chip bg-brand-soft text-brand`

---

## 使用位置

| 组件 / 视图 | 用法 |
|-------------|------|
| `InvoiceView.vue` 状态表格 | `statusClass()` 返回 chip-ok / chip-warn / chip-danger / chip-brand |
| `InvoiceView.vue` 筛选按钮 | `filterBtn()` 激活态用 `bg-brand-soft` |
| `InvoiceView.vue` 校对面板 | `chip-warn` 显示「N 项待补」 |
| `InvoiceView.vue` 底部统计 | `chip-danger` / `chip-warn` 显示重复/历史计数 |
| 其他视图 | 任何使用 chip-* shortcut 的地方自动生效 |
