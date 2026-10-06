# #442 工程量受控迁移验证

日期：2026-09-11。此证据对应已验证的 #442 迁移切片，整票集成结果见[工程量验收汇总](../README.md)，不能据此宣告母票 #412 完成。当前中央服务为可重置、会话与工作区隔离的服务端内存实例，不代表生产持久化交付。

## 实际覆盖

- 真实 SQLite 十五张工程量表，经受保护来源适配器、HTTP 请求解析、预检、试跑、导入、确认后进入同一中央工程量读写服务。区域、模板、责任范围、阶段完成、照片和审计保持稳定映射；空值、明确零、软删除与时间保留。
- BOQ 保留真实文件与合同祖先提供的稳定身份；中央量域仅保存外部身份索引，不生成虚假 BOQ 文件或量价副本。施工合同目录保留楼栋、更新时间及未知量价。
- 候选 SQL 完整准备并逐字段回读核对后才交换连接；同一实例队列保护准备期间的读写。其他领域在最后同步提交前才获取当前事实；同工作区确认、回滚按受理顺序串行。
- 真实 SQL 故障时原量域记录、版本、其他命令来源和 authority 均保持原状；兼容附加钩子失败会丢弃候选，不会先发布后报失败。
- 重复同步保留中央更正。回滚保留其他项目独立新增记录；新增记录仍引用迁入祖先时阻断整个回滚，保留全部当前来源。历史照片缺正文只记录明确提示，普通正文请求报告缺失。

## 失败复现与修正

1. 完整旧模板携带整户房间，插入模板时便利触发器又生成整户房间，实际 SQLite 唯一约束失败。候选事务现在暂停已知自动生成触发器，导入真实行后恢复；后续普通新模板仍自动生成整户房间。
2. 量域图的班组身份失踪原先未在试跑暴露。现在试跑执行同一完整图映射校验，并阻止带该问题的批次进入导入。
3. 异步准备期间提前捕获其他域旧 Map 会覆盖等待期间的中央更正。现在仅在最终同步段准备 Map。
4. 并行确认与回滚原先能让迟到确认重新切到中央。现按工作区队列串行。
5. 回滚原先可能保留失去迁入祖先的独立新增记录。现显式阻断并保留全部现状。

## 验证记录

- 定向兼容：`npm test -- tests/server/core-migration-preparation.test.ts tests/server/quantity-migration.test.ts tests/server/quantity-database.test.ts tests/server/quantity-test-instance.test.ts tests/quantity/controlled-migration.test.ts tests/quantity/migration-graph.test.ts tests/quantity/migration-core-source.test.ts tests/migration/core-local-source.test.ts tests/server/core-migration-test-instance.test.ts tests/receipt/migration.test.ts tests/delivery/controlled-migration.test.ts`：11 文件 / 62 项通过；随后补历史照片缺正文反例，`tests/quantity/controlled-migration.test.ts` 3 / 3 通过。
- `pnpm typecheck`：通过。独占迁移源码、测试及 E2E 的精确 ESLint：通过。共享文件由集成提交统一检查，未整体格式化其他代理的改动。
- 真实 HTTP：`e2e/quantity-migration.spec.ts`，Chromium 项目 1 worker，1 / 1 通过，业务 2.7 秒、整轮 15.3 秒。覆盖真实来源包、稳定身份、三量空零、原始照片字节、中央更正、独立新项目与回滚。该项是实际 HTTP 验证，不是页面视觉截图；[运行结果](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-442/migration/http-result.json)与[合成来源及真实 SQLite 摘要](./source.json)已归档。
- [迁移指南](../../../../guides/local-data-migration.md) V2.0 的 [Markdown 指南](../../../../guides/local-data-migration.md) 共 5 页，已逐页渲染核对，无截断或覆盖；预览保留在 [pdf-preview](./pdf-preview/)。

## 当前边界

本切片不新增生产数据库或部署能力，不把迁移快照作为日常 BOQ、签证或月度报量来源。工程量整个页面链与三基准报量由 #442 其他切片独立验收。完整字段与规则的权威来源仍为 DATABASE、ADR 0010/0020 和工程量页面蓝本，本文只记录验证事实。
