# #463 / #451 共享存储接缝检查

基于 #450 冻结提交 `87fc4ac3`。这是共享存储能力的独立检查点；#463 公开工序库与 #451 完整备份流程分别继续验收，不凭本记录宣称两个 Issue 完成或正式业务写入开放。

`productionRuntime()` 只维护一个磁盘 coordinator；各领域复用其 `storage` 与 `productionSession(event)`，不能建立新的正式内存权威。客户原调用仍转入同一存储。schema v1 引导定义保持冻结，v1→v2 在一个写事务中加入工序库版本、回执、审计及目录版本表，先验证旧参与者清单再升级；失败不会留下部分新表或提高版本。

`productionStorageManifest(version)` 返回该发布版本的 `coreTables` 及每个领域的 `schemaVersion`、完整 `tables`；未知版本拒绝。后续域必须增加独立 schema 模块并按合入顺序追加编号升级，不重写既有升级，也不替换其他领域参与者。数据权威见 [DATABASE](../../../../rewrite/DATABASE.md)。

`ProductionStorage.backupTo(destination)` 使用 [Node 24.12.0 一致备份 API](https://nodejs.org/download/release/v24.12.0/docs/api/sqlite.html#sqlitebackupsourceDb-path-options)，原生连接留在驱动内。它与事务、写入、关闭共用队列，备份本身不启动 `BEGIN IMMEDIATE`；仅允许新建本机目标，拒绝已有文件、原库路径及链接/重定向父目录。文件生成失败保留可诊断产物，由备份 owner 分类；此方法不发布成功备份、不代替副本核验或 NAS 传输。Node 此固定版本 API 的实验标识仍有效。

公开验证先建立失败复现：旧库状态只报告 schema 1/customer；一致备份能力不存在。实现后，实际磁盘检查覆盖旧客户库升级/原事实保留、中途 DDL 失败原子回退、未知参与者拒绝、原件及原回执冷开兼容、真实副本独立读取、同路径/已有目标拒绝、前一事务→备份→后一写入→关闭顺序，以及目标失败后原库继续可读。客户公开 HTTP 边界回归亦通过。不会把进程内顺序或文件副本测试冒称物理断电验证。

独立复核发现参与者登记存在但实际审计表缺失时，SQLite自检仍可能成功；先复现错误就绪状态，再按同一 manifest 核对实际业务表，缺表停止冷打开及升级。另为 #451 的后台状态轮询补 `productionSession(event, { touch: false })`；中间件对唯一 `GET /api/production/backup/status` 同样不续期，实际用户动作仍使用默认续期。已复现第29分钟轮询错误延长登录，再验证第31分钟业务读取必须重新登录。追加的认证/升级2文件9项检查与精确lint通过。
