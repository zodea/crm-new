# 测试基础设施

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/responsive.ts](../../../e2e/helpers/responsive.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/visual-environment.ts](../../../e2e/helpers/visual-environment.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/browser/setup.ts](../../../tests/browser/setup.ts) | 测试环境初始化 | 真实浏览器组件测试初始化 |
| [tests/components/setup.ts](../../../tests/components/setup.ts) | 测试环境初始化 | jsdom 测试清理与浏览器 API 替身 |
| [tests/global-setup.ts](../../../tests/global-setup.ts) | 测试环境初始化 | unit 全局准备：冷进程入口预打包、迁移后内存库快照；共享旧缓存不自动删除 |
| [tests/helpers/fixture-cache.ts](../../../tests/helpers/fixture-cache.ts) | 辅助／夹具（非独立测试） | 缓存独立发布、摘要校验及同键冲突拒绝 |
| [tests/tooling/fixture-cache.test.ts](../../../tests/tooling/fixture-cache.test.ts) | 工程工具测试 | 并发缓存、旧文件保留、篡改与同键冲突 |
| [scripts/e2e-isolation.ts](../../../scripts/e2e-isolation.ts) | 辅助／夹具（非独立测试） | 独立构建路径与正式验收服务入口约束 |
| [tests/server/e2e-isolation.test.ts](../../../tests/server/e2e-isolation.test.ts) | 工程工具测试 | 拒绝复用、越界及链接路径，隔离正式服务配置 |
| [tests/helpers/cold-process.ts](../../../tests/helpers/cold-process.ts) | 辅助／夹具（非独立测试） | 以独立 Node 进程启动预打包的冷恢复与服务入口 |
| [tests/helpers/test-temp-root.ts](../../../tests/helpers/test-temp-root.ts) | 辅助／夹具（非独立测试） | 每个测试文件的合成数据隔离与保留 |
| [tests/tooling/test-temp-root.test.ts](../../../tests/tooling/test-temp-root.test.ts) | 工程工具测试 | 临时目录隔离、进程运行或退出时保留数据 |
| [tests/helpers/production-storage-seed.ts](../../../tests/helpers/production-storage-seed.ts) | 辅助／夹具（非独立测试） | 测试种子独立生成与保留；校验身份、结构及完整性后复制冷打开 |
| [tests/tooling/production-storage-seed.test.ts](../../../tests/tooling/production-storage-seed.test.ts) | 工程工具测试 | 并发种子、身份拒绝和已有目标保留 |
| [tests/helpers/memory-db.ts](../../../tests/helpers/memory-db.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/material-read-meta.ts](../../../tests/helpers/material-read-meta.ts) | 辅助／夹具（非独立测试） | 材采来源与真实元数据夹具 |
| [tests/helpers/notification-read-meta.ts](../../../tests/helpers/notification-read-meta.ts) | 辅助／夹具（非独立测试） | 通知来源元数据夹具 |
| [tests/helpers/supplier-read-meta.ts](../../../tests/helpers/supplier-read-meta.ts) | 辅助／夹具（非独立测试） | 分供方来源与权限夹具 |
| [tests/helpers/public-read-meta.ts](../../../tests/helpers/public-read-meta.ts) | 辅助／夹具（非独立测试） | 跨领域公共读取协议夹具 |
| [tests/helpers/project-read-meta.ts](../../../tests/helpers/project-read-meta.ts) | 辅助／夹具（非独立测试） | 项目及真实客户参考来源夹具 |
| [tests/helpers/verified-signatory.ts](../../../tests/helpers/verified-signatory.ts) | 辅助／夹具（非独立测试） | 在同一隔离SQL目录明确创建并读取主体采用事实 |
| [e2e/helpers/contract-signatory.ts](../../../e2e/helpers/contract-signatory.ts) | 辅助／夹具（非独立测试） | 端到端实际主体创建、选择与冻结采用准备 |
| [e2e/helpers/contract-engineering-fixture.ts](../../../e2e/helpers/contract-engineering-fixture.ts) | 辅助／夹具（非独立测试） | 仅为开发界面测试提供合成施工主合同候选；正式关系保存须以生产验收核对 |
| [e2e/helpers/owner-document-read-fixture.ts](../../../e2e/helpers/owner-document-read-fixture.ts) | 辅助／夹具（非独立测试） | 为单据界面合成响应提供会话身份与来源读取证明，不代表正式来源接入 |
