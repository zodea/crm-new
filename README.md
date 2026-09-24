# 瑞航 CRM

基于 Nuxt 4 + Vue 3.5 的工程项目管理应用，当前交付方向为浏览器版。已接管实体采用中央读写，过渡本地适配与桌面壳边界见 [ADR 0020](docs/adr/0020-browser-authority-and-demo-workspace-boundary.md)；正式持久化、备份恢复与部署仍需独立验收。

## 文档入口

项目术语、ADR、设计、页面蓝本、数据模型和界面状态统一从 [`docs/README.md`](docs/README.md) 进入。视觉工作再进入 [`docs/design/README.md`](docs/design/README.md)。不要从历史反馈稿、调研笔记或截图开始查规格。

## 本地开发

先切换到 [`.node-version`](.node-version) 固定的 Node 版本，并使用 `package.json` 中 `packageManager` 指定的 pnpm。运行时版本依据见 [ADR 0021](docs/adr/0021-single-operator-windows-production-storage.md)；CI 同样读取 `.node-version`。安装时按现有锁文件恢复依赖，不自动更新版本；版本不符会拒绝安装。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

常用校验：

```bash
pnpm typecheck
pnpm test
pnpm build
```

协作约定见 [`AGENTS.md`](AGENTS.md)。本地真实业务参考资料位于被 Git 忽略的目录，不得提交到仓库、测试夹具或 CI。
