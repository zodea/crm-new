# 瑞航 CRM

Nuxt 4 + Vue 3.5 + SQLite/Tauri 的工程项目管理应用。

## 唯一设计入口

设计、页面蓝本、数据模型及权威源优先级统一从 [`docs/design/README.md`](docs/design/README.md) 进入。不要从旧 HTML、历史反馈稿或截图开始查规格。

## 本地开发

```bash
pnpm install
pnpm dev
```

常用校验：

```bash
pnpm typecheck
pnpm test
pnpm build
```

协作约定见 [`AGENTS.md`](AGENTS.md)。本地真实业务参考资料位于被 Git 忽略的目录，不得提交到仓库、测试夹具或 CI。
