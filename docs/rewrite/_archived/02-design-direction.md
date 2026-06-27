---
decision: 02
status: confirmed
date: 2026-06-26
---

# 决策 02：设计语言方向 — 以 Claude Design 为准，不沿用旧代码

## 结论

UI 设计以 Claude Design 原型（方案 5 明亮通透版）为基准重新设计，不延续现有代码的设计系统。

## 要点

- 现有代码的 UI 存在问题，是本次重写的原因之一
- shadcn-vue 作为组件底层，样式层面向 Claude Design 的视觉语言靠拢
- 具体视觉方案（玻璃态程度、色彩、层级）通过效果图逐步确认
- 每次有界面调整需要对比时，先出效果图由用户判断，再落地

## 待确认

- shadcn-vue 组件与 Claude Design 风格的融合程度（后续出图确认）
