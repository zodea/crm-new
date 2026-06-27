---
decision: 05
status: confirmed
date: 2026-06-26
---

# 决策 05：表格方案 — 保留 vxe-table

## 结论

继续使用 vxe-table 作为全局表格方案。

## 理由

- 功能完备：固定列、固定表头、拖拽列宽、横向滚动、行高亮均开箱即用
- 现有业务逻辑已验证过 vxe-table 的能力边界
- 工程量矩阵等极复杂渲染场景需要成熟表格引擎支撑
- TanStack Table headless 方案自己实现固定列/拖拽列宽工作量过大

## 需要做的

- vxe-table 主题样式需要对齐 Claude Design 的视觉语言（色彩、圆角、阴影）
- 通过 CSS 变量覆写 vxe-table 默认主题，保持与 shadcn-vue 其他组件的视觉一致性
