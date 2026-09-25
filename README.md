# 瑞航 CRM

装修工程公司的项目、合同、资金、物资与施工管理应用，当前交付方向为浏览器版。运行与持久化边界见 [架构说明](docs/rewrite/ARCHITECTURE.md)，正式保存、备份恢复与部署需独立验收。

## 本地开发

使用 [`.node-version`](.node-version) 指定的 Node 和 `package.json` 指定的 pnpm，按锁文件安装：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

验证命令见 `package.json`。文档从 [docs/README.md](docs/README.md) 进入，协作规则见 [AGENTS.md](AGENTS.md)。本地真实业务参考资料不得提交到仓库、测试夹具或 CI。
