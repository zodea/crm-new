---
decision: 07
status: confirmed
date: 2026-06-26
---

# 决策 07：OCR 架构 — 云优先 + 本地双轨

## 结论

- **主引擎**：PaddleOCR-VL 云 API（优先使用）
- **本地回退**：生产环境用更适合 Tauri 的方案（Rust 侧 onnxruntime），开发阶段暂用现有的 onnxruntime-web（WebGPU/wasm）

## 执行策略

1. 云 VL 优先：已配置 API 令牌时默认走云端，手写体/表格/多单拆分能力强
2. 云不可用时回退本地
3. 本地推理分两阶段：
   - **开发期**：继续用 onnxruntime-web（前端 WebGPU/wasm），零 Rust 依赖，快速迭代
   - **生产打包**：迁移到 Tauri Rust 侧 ort crate，原生性能 + DirectML 加速
4. 前端调用层封装统一接口，屏蔽底层引擎差异

## 沿用的设计

- ADR-0001（云 VL 优先）和 ADR-0006（本地 PP-OCRv6 Small）的核心决策不变
- 模型文件 PP-OCRv6 Small ~30MB，开发期放 public/，生产期随 Tauri sidecar/资源打包
