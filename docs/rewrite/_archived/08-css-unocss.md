---
decision: 08
status: confirmed
date: 2026-06-26
---

# 决策 08：CSS 方案 — 继续使用 UnoCSS

## 结论

重写后继续使用 UnoCSS，shadcn-vue 通过社区的 UnoCSS 适配方案集成。

## 理由

- UnoCSS 的 shortcuts、icons preset（Lucide）、attributify 等能力成熟好用
- 构建速度更快
- shadcn-vue 有 UnoCSS 社区方案可用

## 需要做的

- 配置 UnoCSS preset 对齐 shadcn-vue 的 CSS 变量命名（`--background`、`--foreground`、`--primary` 等）
- 设计令牌体系重新定义，对齐 Claude Design 的视觉语言
- Icons preset 保留 `@iconify-json/lucide`
