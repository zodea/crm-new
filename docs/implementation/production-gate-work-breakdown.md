# 正式保存、备份恢复与本机部署：实施承接入口

> 2026-09-22，调查基线 `084e1e4b97001089452e61407ed1aa6ca6d1ef4d`（PR #448 已合并）。本页记录 [#416](https://github.com/zodea/crm-new/issues/416) 的事实、已定运行约束和生产实施承接；不代替 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md)，也不将既有功能验收升级为生产可用。

## 已定范围与关闭门

- 已定的首期单人本机、存储选型、访问身份、NAS/离线备份与恢复指标统一见 [ADR 0021](../adr/0021-single-operator-windows-production-storage.md)。用户已有常开 Windows 电脑、NAS、移动硬盘和另一台电脑，不需要再询问部署产品名称。
- 正式浏览器版仍以中央服务为唯一权威；演示只读隔离，旧本地库只通过受控迁移接管。完整账号/RBAC、多租户、Tauri 正式交付、离线写入沿用原排除。
- #416 是决策票：部署和恢复目标已经裁定、权威决定一致、每项生产义务已有可直接执行的实施票及原生依赖，才能关闭。关闭本票不表示生产已部署。
- 正式上线由后续上线验收票负责，须同时具备前台及跨域功能验收、真实持久化、故障恢复和部署证据；不能以本决策票关闭代替。
- 本次运行目标与技术方向已经定稿；真实设备路径、凭据与容量通过后续配置和验收取得，不在仓库保存。具体生产票已发布并核回原生关系；本次文档审查及提交合并完成后即可关闭 #416 决策票。

以上已定部署与恢复约束已写回 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md#416-首期部署与恢复目标)；此页保留调查和实施承接，不另立产品决定。

## 当前保存位置与证据

#450 已为客户接入首条本机单库路径、访问保护与原件/回执同事务；限定实现及验收见 [PG-01 证据](../design/evidence/issue-450-production-customer/README.md)。以下调查表保留其他领域的原基线，客户在显式本机模式的状态以该证据及 [DATABASE 参与者清单](../rewrite/DATABASE.md#pg-01-本机客户持久参与者450)为准。PG-02 和最终上线验收未完成前不开放真实业务写入。

下表描述当前代码；“内存”包含 JavaScript 对象和进程内 SQLite，两者均没有由现有接缝自动变成磁盘持久化。

| 事实及接缝 | 当前证据 | 生产实施必须保留的内容 |
| --- | --- | --- |
| 客户、项目、分供方、班组、工人 | 各 `*-command-test-instance` 持有领域 `Map`、版本和提交回执；[项目实例](../../server/utils/project-command-test-instance.ts)、[分供方实例](../../server/utils/supplier-command-test-instance.ts)展示日常写入与迁入候选 | 稳定身份、来源、软删除、字段、版本、审计、导入指纹、证照资料及幂等结果；重启不能回退空库 |
| 项目分供方合作档案和原件 | [合作实例](../../server/utils/project-supplier-command-test-instance.ts)分别保存关系、文件元数据、正文及命令 `Map` | 关系、原件字节、摘要、归属和回执同次提交；保存成功后重启仍能预览、下载并校验摘要 |
| 施工、分包、材采和辅助合同 | [施工](../../server/utils/construction-contract-command-test-instance.ts)、[分包](../../server/utils/subcontract-contract-command-test-instance.ts)、[材采](../../server/utils/material-contract-command-test-instance.ts)、[辅助合同](../../server/utils/auxiliary-contract-test-instance.ts)保留进程内事实与回执 | 原有合同身份、引用、版本和附件；不得以持久化改造补造尚未确定的合同业务动作 |
| 甲方/分包商务单据、罚扣、结算、BOQ 原件与关联事实 | [商务实例](../../server/utils/owner-commercial-document-command-test-instance.ts)、[其他结算实例](../../server/utils/other-settlement-instance.ts)为进程内状态；BOQ 与工程量通过现有互斥接缝协作 | 合法状态、审计、原件、抵扣/整改、各类结算和来源关系；资金与成本不能因恢复重复计算 |
| 普通收款及附件 | [收款实例](../../server/utils/receipt-command-test-instance.ts)保存 records、payloads、commands 和版本 | 同一收款事实、附件与提交指纹一起持久保存；响应丢失后按原键确认结果 |
| 送货归档、原件和修订 | [送货服务](../../server/utils/delivery-command-service.ts)保存 records、assets、legacyOriginals、revisions、commands 和版本 | 每版逻辑记录、原件及历史归属，不能只备份当前可见行或文件名 |
| 全局工序库 | [工序库服务](../../server/utils/process-library-service.ts)以 `Map` 保存完整不可变版本与回执 | 被 WBS 使用的历史版本、图、版本号及提交结果；重启不重种默认版本 |
| 工程量、WBS、目标成本、A/C1/C2 工资及更正/收付 | [数据库](../../server/utils/quantity-database.ts)以 `new SQL.Database()` 建进程内库；[工作区实例](../../server/utils/quantity-test-instance.ts)共用事务队列 | 完整 SQL 事实、冻结原文、来源锁、批次逐项结果、命令回执，以及实例另存的迁入映射与引用集合 |
| 迁移预检、批次、接管与回滚 | [迁移实例](../../server/utils/core-migration-test-instance.ts)将工作区、批次、备份证明、来源哈希及命令结果保存于 `Map`；[协调器](../../server/utils/core-migration-preparation.ts)一次同步发布候选 | 领域事实、活动批次、接管状态、映射和回执必须一起提交或一起恢复，不能一半中央、一半旧源 |
| 会话与测试入口 | [业务会话](../../server/utils/business-session.ts)返回固定工作区和操作者及全量现有 capability；[测试重置](../../server/api/testing/core-migration/reset.post.ts)在 production 拒绝调用 | 固定 actor 不是身份认证，内网也不等于所有人可读私密资料。正式入口须有具体的最低访问保护与可信操作者注入，私密原件另核对当前权限；测试头不得切换正式身份，生产不能启用测试重置 |
| 运行配置 | [Nuxt 配置](../../nuxt.config.ts)携带 sql.js WASM 与服务端 OCR 配置，尚未配置正式数据目录或备份任务 | 发布物、数据、备份和密钥分离；服务启动就绪须覆盖存储可读写及版本兼容性 |

`exportSnapshotBytes()` 只导出当前 SQL 库。上表其他领域的 `Map`、文件原件和迁移接管状态不在该字节流中，因此现有 SQL 导出不能称为全站备份。浏览器的不可变旧库备份用于原接管批次回滚；它同样不能替代中央日常新增数据与原件的灾难恢复备份。

## 现有 Windows 运行时与存储选项

2026-09-22 只读实测：当前 `node.exe` 为 `D:\nodejs\node.exe`，版本 `v24.12.0`，平台 `win32 x64`；内置 SQLite 版本 `3.50.4`。`node:sqlite` 已可加载，暴露 `DatabaseSync` 和 `backup`，使用这两个现有运行时能力无需添加 npm 生产依赖。该版本仍发出 ExperimentalWarning，官方标为 Active development；这不是稳定 API 的证明。版本与 API 依据见 [Node v24.12.0 文档](https://nodejs.org/download/release/v24.12.0/docs/api/sqlite.html)。

已采用的存储方案及取舍统一见 ADR 0021；本轮未安装新运行时、生产依赖或接入正式业务库。同步 API 的阻塞、现有 SQL 兼容与文件容量仍由实施票运行验证。

SQLite 的 [备份接口](https://www.sqlite.org/backup.html)可以形成数据库的一致副本。本期按 ADR 0021 采用同库原件 BLOB，全站备份仍须按上表清单核对同一恢复点；后续若改外置原件，不能假定数据库备份自动覆盖它们。直接复制运行中的数据库文件不能替代经验证的备份流程。事务落盘配置须明确采用的日志与同步模式，并通过故障测试验证，依据见 [SQLite PRAGMA 文档](https://www.sqlite.org/pragma.html#pragma_synchronous)。

本轮能力探针在独立合成 SQLite 库验证：提交后立即退出进程，新的进程能读回事实/原件/回执；未提交事务退出后，新的进程看不到任何部分结果；内置 backup 的副本能重新读取同一原件摘要，外键和完整性检查通过。该证据仅证明驱动原语，未运行 CRM 接管、物理断电、NAS、容量或 RPO/RTO 验收。探针未写入真实业务库。

## 可直接采用的实施约束

以下是既有中央权威、幂等和恢复要求的技术落实，不涉及新的业务政策。

| 结论 | 依据 | 影响 | 必须取得的验证 |
| --- | --- | --- | --- |
| 只有事实及原命令结果已可靠提交，才能返回保存成功 | 现行 [写命令契约](../rewrite/COMMANDS.md)及响应未知恢复规则 | 不能先修改内存、回成功，再异步写盘；持久化失败须保留原输入并明确失败或未知 | 写入前失败、提交中断、提交后响应丢失；重开独立进程后重试同键不重复生效 |
| 事实、版本、审计、提交指纹和回执使用同一提交边界 | 既有各领域原子与幂等约束 | 恢复后不能出现事实已存而回执遗失，再次生成付款/发放/扣款 | 相同键同正文返回原结果；相同键不同正文被拒绝；更正和收付只发生一次 |
| 原件和元数据通过可验证的发布协议成为同一业务结果 | 原件摘要、owner 和历史版本已有领域约束 | 失败不能产生可见的缺正文附件；临时孤儿须可识别并按保留规则处理 | 原件写入/摘要核对/业务提交各处中断后，正式读取无混合版本 |
| 所有已接管领域都进入明确的持久状态清单 | ADR 0020 单一权威；当前存储分散事实 | 不允许只持久化工资 SQL 或只保留可见列表行 | 完整清单逐项经过冷启动读回及关系检查；没有领域继续依赖启动时样例 |
| 备份包含同一恢复点的业务数据、原件及恢复所需版本元数据 | #416 明确要求数据库和文件一起恢复 | 成功备份有摘要和清单；缺包、混包、损坏、版本不兼容不能显示成功 | 从备份恢复到空白隔离实例，核对记录/金额/关系/原件/回执及接管状态 |
| 灾难恢复、发布回退和业务迁移回滚分别验收 | 现行受控迁移有回滚窗口和引用保护 | 不能通过覆盖旧备份绕过日常写入或已发工资的保护；发布回退还需存储版本兼容 | 三种流程各自验证前提、拒绝条件、停止点和恢复后对账 |
| 存储不可用或版本不兼容时停止提供正式写入 | ADR 0020 禁止旧本地源兜底 | 不回落空内存实例、演示或浏览器旧库；诊断不得输出密钥或原件内容 | 无权限、目录缺失、空间不足、版本过新/损坏均有明确失败且已有数据不变 |
| 首期服务仅绑定本机 `127.0.0.1` | 2026-09-22 用户最终决定及 ADR 0021 | 同事内网与公网均不在首期开放；后续接入须单独验收认证、权限、审计和容量 | 部署验收核对实际监听仅为本机，其他网卡不可访问；不把此前内网方向当首期开放授权 |
| 单一 owner 通过本机访问码建立服务端会话 | ADR 0021 已定最低保护，完整账号/RBAC 仍排除 | 正式模式缺访问码或 owner 身份配置明确拒绝；仅已认证 owner 会话获得规定私密能力，客户端不能声明 actor/capability | 未认证、伪造身份、越权原件和会话失效后均拒绝；审计记录可信 owner，测试头不能绕过正式入口 |

## 生产实施票

22 张生产票已发布为 [#450](https://github.com/zodea/crm-new/issues/450)～[#471](https://github.com/zodea/crm-new/issues/471)，父票为 #416；技术规格链接 ADR 0021，业务规则继续引用各域原权威。当前仅无阻塞的 #450 由 zodea 认领，其他票尚未认领。真实首次正式写入还必须通过独立介质备份、本机部署和最终放行门。以下为导航摘要，现时状态、完整验收和原生依赖以对应 Issue 为准。

每张持久化票的共同验收：从现有公开命令/读取接缝完成一次合法写入，在新独立服务进程读取同一稳定身份、字段、版本、审计、回执和原件；分别验证提交前失败、提交后响应丢失、同键同正文重试、同键异文拒绝、陈旧版本、无权与来源隔离。将本域完整状态加入持久参与者及备份清单，原件沿同库协议，不能静默落回测试实例。测试只补新持久边界，不重写既有业务规格；完成双轴审查、最小充分测试和 Markdown 指南/运行回执后独立提交。

| 实施票 | 交付及该票额外验收 | 原生阻塞票 |
| --- | --- | --- |
| [PG-01 / #450 客户首条正式保存与本机身份](https://github.com/zodea/crm-new/issues/450) | 建立窄数据库驱动、版本初始化、提交协调和单人访问码；客户新建/更正/软删除/恢复、附件与回执冷启动一致。缺访问码/目录、不可写、损坏及过新版本拒绝；伪造身份/测试头/跨站写入失败。只开放本票已接管范围，其他正式写入口明确未就绪 | 无 |
| [PG-02 / #451 客户独立介质备份与隔离恢复](https://github.com/zodea/crm-new/issues/451) | 用客户含原件路径完成 NAS 一致备份、摘要/清单校验、隔离恢复和移动硬盘离线复制；介质缺失/校验失败保留上一份成功包。实现配置、最近成功/过期/失败常驻反馈与首次正式写入备份门禁；以假时钟验证计划/补跑，实际设备在部署验收核实 | [#450](https://github.com/zodea/crm-new/issues/450) |
| [PG-03 / #452 项目正式保存与客户关系](https://github.com/zodea/crm-new/issues/452) | 接管项目事实、版本、附件和 Excel 导入回执；重启后客户关联、项目详情、软删/恢复和原导入防重不变。显式旧 ID 与客户引用按现行规则保留 | [#450](https://github.com/zodea/crm-new/issues/450) |
| [PG-04 / #453 分供方证照与 OCR 确认正式保存](https://github.com/zodea/crm-new/issues/453) | 接管主档、证照原件/历史、OCR 原始候选、人工确认与税务核验事实及回执；重启后候选/人工值不混淆，已撤权原件不可读，失败识别保留原件。无需重跑外部 OCR 服务质量评估 | [#450](https://github.com/zodea/crm-new/issues/450) |
| [PG-05 / #454 班组工人与私密 owner 正式保存](https://github.com/zodea/crm-new/issues/454) | 接管班组/工人关系、比例、费用默认值、原始身份资料与其 owner 原件；冷启动保留 missing/null/0/false 区别及归属历史。私密值只由已认证 owner 的规定 capability 读取，普通列表仍脱敏。包括 #449 新增的实名字段、用途照片和不可变名册 owner 引用，须等该票实现，不假设已完成 | [#450](https://github.com/zodea/crm-new/issues/450)、[#452](https://github.com/zodea/crm-new/issues/452)、[#449](https://github.com/zodea/crm-new/issues/449) |
| [PG-06 / #455 项目合作档案与原件正式保存](https://github.com/zodea/crm-new/issues/455) | 项目分供方导入结果、关系、附件元数据和正文同事务；跨域采用主档时不能只存合作关系而丢主档。重启后详情、预览、下载与 ZIP 摘要一致，失败回滚全部候选 | [#452](https://github.com/zodea/crm-new/issues/452)、[#453](https://github.com/zodea/crm-new/issues/453) |
| [PG-07 / #456 施工合同与 BOQ 正式保存](https://github.com/zodea/crm-new/issues/456) | 接管施工合同、补充协议、清单目录/行及现有完成量/楼栋来源事实；冷启动保留历史 ID 和原件。项目/客户来源下钻、同键保存及合同版本不失真；不扩张 BOQ 业务动作 | [#452](https://github.com/zodea/crm-new/issues/452) |
| [PG-08 / #457 分包合同正式保存](https://github.com/zodea/crm-new/issues/457) | 接管分包合同及所属补充协议，验证项目/分供方引用、软删除、附件和迁入来源；重启后日常更正与已成功回执一致 | [#452](https://github.com/zodea/crm-new/issues/452)、[#453](https://github.com/zodea/crm-new/issues/453) |
| [PG-09 / #458 材采合同正式保存](https://github.com/zodea/crm-new/issues/458) | 接管材采合同及现有版本/更正/来源引用；重启后采购合同查询与详情保持真实关系，日常命令不重复，原件和付款相关只读来源不伪造 | [#452](https://github.com/zodea/crm-new/issues/452)、[#453](https://github.com/zodea/crm-new/issues/453) |
| [PG-10 / #459 辅助合同与其他结算正式保存](https://github.com/zodea/crm-new/issues/459) | 两类辅助合同和其独立结算/来源单据进入共同事务；项目合同/公司合同身份不串域。冷启动后结算候选、附件、付款来源及实际已有回执保持关系；未实现付款业务不代验 | [#452](https://github.com/zodea/crm-new/issues/452)、[#453](https://github.com/zodea/crm-new/issues/453) |
| [PG-11 / #460 商务单据共享事实源正式保存](https://github.com/zodea/crm-new/issues/460) | 将现有商务 owner 共享聚合完整持久化，覆盖甲方变洽签/月报量/验收保修/最终结算/罚扣、分包变洽签/结算及项目罚扣/整改/抵扣。每 kind 用既有合法状态夹具冷读并核对关联、历史、原件和回执；共享 owner 不分裂为多份权威 | [#454](https://github.com/zodea/crm-new/issues/454)、[#456](https://github.com/zodea/crm-new/issues/456)、[#457](https://github.com/zodea/crm-new/issues/457) |
| [PG-12 / #461 普通收款正式保存](https://github.com/zodea/crm-new/issues/461) | 收款事实、附件与提交指纹同事务；重启后客户/施工合同/项目读到同一收款，删除/恢复、来源金额和原件摘要不变，响应丢失不重复登记 | [#452](https://github.com/zodea/crm-new/issues/452)、[#456](https://github.com/zodea/crm-new/issues/456) |
| [PG-13 / #462 送货归档与修订正式保存](https://github.com/zodea/crm-new/issues/462) | 当前/历史逻辑记录、原件、legacyOriginals、修订和回执完整接管；冷启动后每版仍指向正确原件，删除/恢复/修订不制造有效库存或结算资格 | [#452](https://github.com/zodea/crm-new/issues/452)、[#453](https://github.com/zodea/crm-new/issues/453) |
| [PG-14 / #463 全局工序库正式保存](https://github.com/zodea/crm-new/issues/463) | 完整不可变库版本、图、版本号和回执持久化；重启不种默认正式库，重复原命令不升新版本，被引用的历史版本可继续解析 | [#450](https://github.com/zodea/crm-new/issues/450) |
| [PG-15 / #464 工程量磁盘库与来源保护](https://github.com/zodea/crm-new/issues/464) | 通过现有数据库接缝将工程量完整 SQL 图接入磁盘权威；中央 schema 初始化可重复启动且不重建/抹去已有表。区域/模板/完成/责任/空鼓及原件冷读，来源锁与引用保护保持；其他同库领域尚未就绪时不误放开其写入口 | [#454](https://github.com/zodea/crm-new/issues/454)、[#456](https://github.com/zodea/crm-new/issues/456) |
| [PG-16 / #465 WBS 与暂估绑定正式保存](https://github.com/zodea/crm-new/issues/465) | 在同一持久 SQL 权威接通分组、任务、依赖、计划、冻结库/来源及合同绑定审计；重启后重试不重复建组/绑定，来源变更和危险删除继续拒绝 | [#463](https://github.com/zodea/crm-new/issues/463)、[#464](https://github.com/zodea/crm-new/issues/464) |
| [PG-17 / #466 目标成本正式保存与同源查询](https://github.com/zodea/crm-new/issues/466) | 预算头、科目、版本、附件和审计冷启动保持完整；重复迁入/命令不覆盖日常更正，缺其他成本来源仍显示 unknown/partial，不伪造为零 | [#464](https://github.com/zodea/crm-new/issues/464) |
| [PG-18 / #467 工资全部已定能力正式保存](https://github.com/zodea/crm-new/issues/467) | 在同一磁盘事务接通当前 A/C1/C2、考勤/签工、配置、来源锁、冻结、独立更正/实际收付、费用/扣款和批次逐项回执；各格式及异常原键恢复分别跨进程验证。完整名册/编号沿 [#412 最终裁定](https://github.com/zodea/crm-new/issues/412#issuecomment-5769698605)，私密 owner 由 #449、正式编号/冻结楼层及归档组合由 #479 及其前置实现后接管，不新增工资事实副本 | [#454](https://github.com/zodea/crm-new/issues/454)、[#464](https://github.com/zodea/crm-new/issues/464)、[#449](https://github.com/zodea/crm-new/issues/449)、[#479](https://github.com/zodea/crm-new/issues/479) |
| [PG-19 / #468 受控迁移跨进程原子接管](https://github.com/zodea/crm-new/issues/468) | 预检证明、批次、来源映射、领域接管和回执一并持久；在 prepare/commit/确认/回滚各边界中断并重启，无半切换。浏览器标记与中央核对、日常更正后的危险回滚保护及本地恢复待办保持 | [#452](https://github.com/zodea/crm-new/issues/452)、[#453](https://github.com/zodea/crm-new/issues/453)、[#454](https://github.com/zodea/crm-new/issues/454)、[#455](https://github.com/zodea/crm-new/issues/455)、[#456](https://github.com/zodea/crm-new/issues/456)、[#457](https://github.com/zodea/crm-new/issues/457)、[#458](https://github.com/zodea/crm-new/issues/458)、[#459](https://github.com/zodea/crm-new/issues/459)、[#460](https://github.com/zodea/crm-new/issues/460)、[#461](https://github.com/zodea/crm-new/issues/461)、[#462](https://github.com/zodea/crm-new/issues/462)、[#463](https://github.com/zodea/crm-new/issues/463)、[#464](https://github.com/zodea/crm-new/issues/464)、[#465](https://github.com/zodea/crm-new/issues/465)、[#466](https://github.com/zodea/crm-new/issues/466)、[#467](https://github.com/zodea/crm-new/issues/467) |
| [PG-20 / #469 Windows 本机发布与维护](https://github.com/zodea/crm-new/issues/469) | 固定 Node/发布版本、计划任务和数据目录权限；启动、关机/休眠后恢复、升级副本演练、发布回退、诊断脱敏和 owner 登录可操作。实际 NAS/移动硬盘配置与备份失败常驻提示演示完成，首写门禁有效；不开放其他网卡 | [#450](https://github.com/zodea/crm-new/issues/450)、[#451](https://github.com/zodea/crm-new/issues/451) |
| [PG-21 / #470 全域备份与故障恢复验收](https://github.com/zodea/crm-new/issues/470) | 全部持久参与者纳入备份清单后，在另一台电脑或空白隔离实例完整恢复；逐域核对记录/金额/关系、原件摘要、冻结与回执/活动批次。备份期间正常读写、大原件和空间不足/损坏/版本差异场景实测；记录恢复时长和实际可恢复数据时间，不把计划频率当 RPO 证据 | [#451](https://github.com/zodea/crm-new/issues/451)、[#468](https://github.com/zodea/crm-new/issues/468)、[#469](https://github.com/zodea/crm-new/issues/469) |
| [PG-22 / #471 首次正式切换与上线放行](https://github.com/zodea/crm-new/issues/471) | 固定真实交付清单和版本，关联各模块当前前台/跨域验收，先完成独立介质基线备份和隔离恢复准备，再按受控步骤切换并复查。未通过领域禁用正式入口并明确承接；已用数据后的回退不覆盖新事实。记录放行或拒绝、本人维护职责和恢复操作 | [#468](https://github.com/zodea/crm-new/issues/468)、[#469](https://github.com/zodea/crm-new/issues/469)、[#470](https://github.com/zodea/crm-new/issues/470)、[#415](https://github.com/zodea/crm-new/issues/415) |

PG-11 虽包含多个现有 kind，但只替换同一 owner 聚合的持久边界；每 kind 的既有规则和用例复用，不在该票重构业务。PG-18 同样只接通已共用工作区事务的工资持久边界，正式业务缺口由 #412 登记的 [#449 名册 owner](https://github.com/zodea/crm-new/issues/449)、[#477 正式编号](https://github.com/zodea/crm-new/issues/477)、[#478 冻结楼层输出](https://github.com/zodea/crm-new/issues/478)及 [#479 归档集成](https://github.com/zodea/crm-new/issues/479)承接，不能以调查票关闭代替实现。若实际实现揭示必须改变领域合同的独立问题，回归原模块 Issue 记录，不能借本票静默改业务。

各票均归入 #416 原生子任务，依赖按上表登记。全前台与跨域验收汇总 #415 属于最终上线 #471 的阻塞，已定部署决策本身不以该汇总完成为关闭门；调整依据已记入 [#416 评论](https://github.com/zodea/crm-new/issues/416#issuecomment-5769908607)。后续实际交付范围如有新增实施票，再补齐 #471 的真实上线依赖，不能机械让所有历史母票互相阻塞。

## 本次验证范围

- 已读取 #416 现行正文及评论、ADR 0020、模块复核和 Issue 规则；检索现行文档及历史部署相关票，没有将 OCR 专用的历史本机部署决定移用为全站部署决定。
- 上表来自固定提交的代码调查；没有声称已执行正式重启、灾难恢复、备份调度或部署验收。
- 已运行 Node 内置 SQLite 合成进程中断/冷读/备份探针，范围如上；不是 CRM 生产恢复证据。
- 已逐票核回 22 张子票的原生父子、阻塞关系、标签和认领；#415 上线依赖由 #471 承接，PG-18 等待真实工资归档实施 #479，不以 #412 调查关闭替代。
- 本阶段只修改 Markdown；不添加生产依赖、不变更运行环境、不上传业务原件。
