---
decision: 01
status: confirmed
date: 2026-06-26
---

# 决策 01：Nuxt 渲染模式 — SPA (`ssr: false`)

## 结论

Nuxt 使用 `ssr: false` 纯 SPA 模式。

## 理由

- Tauri 桌面端通过 `file://` 协议加载前端，不可能跑 Node SSR 服务
- SPA 模式打包产物为纯静态 HTML/JS/CSS，与 Tauri webview 完全兼容
- 保留 Nuxt 约定式路由、auto-import、composable 目录等 DX 优势
- PP-OCRv6 ONNX 推理在前端 WebGPU/wasm 执行，无需服务端
- 产品定位「本地工具·数据不上传」不受影响

## 排除的方案

- **SSG (nuxt generate)**：动态路由 (`/invoice/:id`) 需构建时穷举或设回退页，Tauri file:// 回退处理复杂
- **SSR**：需打包 Node sidecar，增加包体积和复杂度，违背本地离线定位
