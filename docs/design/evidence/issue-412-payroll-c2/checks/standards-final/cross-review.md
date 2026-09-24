# P3 交叉 Standards 审查

基线：`4738be98730955cd63832c8df04fc6f1d855caff`。按作者隔离，只读 A 的领域、服务、事务、API、Repository/store，B 的事实、锁与迁移恢复，以及 Root 的通用读取/数值及覆盖登记；排除本人 C 产品与测试。当前字节见 `cross-review-identities.json`。未运行测试、类型、构建或浏览器。

**未解决硬规范：0。原 P2 已关闭。** [READ-MODELS.md:28](D:/crm本地项目开发/docs/rewrite/READ-MODELS.md:28) 禁止科学计数法。原 C2 `String(child)` 指数问题已由 `payrollFixedDecimal` 无舍入展开修复；C1/C2 decoder 拒绝指数，Root 通用详情仅对原 C1/C2 单价复用该 helper。原 JSON 证据、null、0 与金额到分边界未改变，未增加业务价位上限。只读核验作者真实 HTTP 小价/大价/350.125、指数请求拒绝及通用详情红绿：A 5 文件 9 例、Root 3 文件 6 例通过。本审查未另跑测试。

**判断性气味：0 项需修改。** 已审命名、真实共形提取、数据归属、分派及变化职责；格式专属校验和已有共用事务/pending 分工有实际依据，未要求为消除表面重复而合并领域。

本轮仅两文件与前次身份不同，已逐处复读；37 个非 C 源码身份与 Root 最终清单一致。零签工成员台账锁展示疑点另交 Spec，不混入本轴。C 自修不在独立签署范围；后续新增字节须增量复读。
