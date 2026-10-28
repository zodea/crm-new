# 瑞航 CRM

装修工程公司的项目、合同、资金、物资与施工管理应用，当前交付方向为浏览器版。运行与持久化边界见 [架构说明](docs/rewrite/ARCHITECTURE.md)，正式保存、备份恢复与部署需独立验收。

## 本地开发

使用 [`.node-version`](.node-version) 指定的 Node 和 `package.json` 指定的 pnpm，按锁文件安装：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

需要从同一局域网的其他电脑访问开发实例时，在主机运行 `pnpm dev:lan`，再用命令输出的局域网地址和端口打开。此入口不增加登录，局域网内能访问的设备使用现有开发权限；只在可信网络中使用。各设备应连接同一个运行中的服务，另起服务不会共享该进程的开发数据。

开发实例用于测试：部分服务使用可重置的进程内数据，部分浏览器数据保存在各自浏览器中，重启或换设备不保证保留或共享。它不等同于正式磁盘库；正式保存和迁移边界见[架构说明](docs/rewrite/ARCHITECTURE.md#runtime-environments)。

验证命令见 `package.json`。文档从 [docs/README.md](docs/README.md) 进入，协作规则见 [AGENTS.md](AGENTS.md)。本地真实业务参考资料不得提交到仓库、测试夹具或 CI。
