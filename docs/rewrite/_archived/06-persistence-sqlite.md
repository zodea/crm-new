---
decision: 06
status: confirmed
date: 2026-06-26
---

# 决策 06：数据持久化 — 全部 SQLite

## 结论

重写后所有模块统一使用 SQLite（tauri-plugin-sql），不再使用 localStorage。

## 范围

V1 模块（发票、送货单、分供方、项目）和 V2 模块（班组、工程量、工资、考勤）全部走 SQLite。

## 需要处理

- 旧数据迁移：首次启动检测 localStorage 中的旧数据，自动导入 SQLite
- dev 模式：Nuxt dev 没有 Tauri 环境，需要 mock 或 fallback 方案（如 sql.js wasm 版 SQLite）
- Pinia store 作为内存缓存层，启动时从 SQLite 加载，变更时写回
