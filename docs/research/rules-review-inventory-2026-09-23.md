# 全量文档清理计划与复核清单

> 计划更新：2026-09-24。目标是全方位审查、合并、迁移和清退文档，降低文件数量与查阅负担。用户最新要求：提供完整计划；逐文件核查由 agent 承担；不持续进行零碎 commit。本次仅编制计划，尚未执行其中的规则改写、文件删除或 GitHub 写操作。
>
> 本文件是整理工作的临时控制清单，属于非权威源。业务定义、决策和规范仍写入各自现有权威文档。文末保留 2026-09-23 原始盘点供核对，其中“保留”“待用户逐项裁定”“触及时复核”均为当时的建议，不代表本次已完成审查；本次范围包含全部页面规格、指南、研究和证据。

## 1. 最终要交付什么

完成后的仓库应同时满足以下条件：

1. **所有范围内文件都有处置结果。** 每份文档、每个附件均登记保留、重写、合并、迁移或删除结果；不能用“这个目录暂时不动”代替审查。
2. **独立文档确实减少。** 同一职责的碎片文档合并，已完成的计划、交接副本、重复报告和失效快照退出工作树；不以全部转移到 `research/` 或新增 `archive/` 代替清理。
3. **同一约束只有一个现行权威定义。** 其他位置使用简短说明和准确链接；操作指南可以用面向用户的语言解释同一流程，但不维护第二套字段、枚举或状态规则。
4. **入口足够直接。** 根规则回答如何开工，文档入口回答到哪里找，领域词表回答词义；按任务进入对应专题，不要求每次通读大量文件。
5. **有效规则、例外和独有证据不丢失。** 精简前先确认承接位置，迁移后全量核对；历史完成标签和代码现状均不能自动推翻已定业务要求。
6. **用户不承担逐文件校对。** agent 完成全文审查、引用核对、改写和复核，只集中提交证据不能解决的实际取舍及需要明确授权的具体处置。

文件数、正文体积和证据体积都记录清理前后变化。实际删除/合并数量在全量审查后确定，不能预先按比例删掉可能仍是唯一依据的内容。重点压减的是独立入口、重复定义和无用材料，不能把所有内容塞进一份巨型文件来达成数量指标。

## 2. 已核实的当前规模与基线

2026-09-24 本地盘点快照：项目已跟踪 Markdown 共 **273 份**；当次 `docs/**` 工作树共 **2,482 个文件，其中 Markdown 268 份**。后者包含未跟踪文件，两种统计口径不可混用。数量盘点已完成，逐段业务审查尚未完成。编制计划期间其他任务又新增了 `docs/testing/` 并修改文档入口；这些属于后续增量，已纳入全量审查范围，不能用本表旧计数漏掉它们。

| 当前目录 | 文件数 | Markdown 数 | 约 MiB |
| --- | ---: | ---: | ---: |
| `docs/` 根入口 | 1 | 1 | < 0.01 |
| `docs/adr/` | 22 | 22 | 0.12 |
| `docs/agents/` | 8 | 8 | 0.04 |
| `docs/design/`，含证据 | 2,320 | 117 | 193.97 |
| `docs/guides/` | 38 | 38 | 0.30 |
| `docs/implementation/` | 2 | 2 | 0.03 |
| `docs/migration/` | 4 | 4 | 0.03 |
| `docs/prd/` | 3 | 3 | 0.02 |
| `docs/research/` | 52 | 41 | 1.25 |
| `docs/rewrite/`，含页面 | 32 | 32 | 0.83 |

其中 `docs/design/evidence/` 共 **2,309 个文件、109 份 Markdown、约 191.52 MiB、49 个 Issue 子目录**，是文件数量的主要来源。证据按完整验证事件分组审查，同时逐文件登记；不是要求用户逐张看图。

- 本地 HEAD：`f11110430fba01e1ce0da27e16bd7a560ad6e45e`。
- 本地记录的 `origin/main`：`c9ccdf350baf78bc27c9d5981453d5e5b4244b0f`；当前 `main` 超前 4 个提交。这里没有把远端跟踪引用当作刚刷新后的服务器状态。
- 工作区存在其他任务的测试、依赖与工具改动。执行时只处理本任务明确文件；不能清理其他任务目录、重置改动或把它们纳入提交。
- 原清单基于 `bbe8247a`，漏了后续新增的 `docs/agents/git-workflow.md` 等内容。正式执行前以当时工作树重算增量，并登记整理期间新增的文档。
- 项目规则文件目前仅发现根 `AGENTS.md` 与 `CLAUDE.md`，未发现业务目录嵌套同类文件。用户全局规则 `C:/Users/Administrator/.codex/AGENTS.md` 单独纳入作用域核对。

## 3. 审查范围与边界

**全部审查：** `docs/**` 的 Markdown、HTML、JSON、图片、日志、PDF 及其他附件；根 `README.md`、`AGENTS.md`、`CLAUDE.md`、`CONTEXT.md`；文档所引用的项目内说明、样本与生成源；用户全局规则与项目规则的重复、冲突和适用范围。

**按引用扩展核对：** 设计源码说明、红圈参考说明、代码/测试/脚本里的文档路径、文档生成器、GitHub 当前 Issue 与引用评论。范围外材料只在形成依赖时读取，不把整个设计源码、业务代码或已安装技能包变成本次重写对象。

**需要保护：** 真实业务原件、用户资料、数据库、密钥、浏览器资料、其他任务未提交文件及活动进程产物；样本、图片或日志不能仅凭扩展名归为垃圾。位于文档目录内的业务原件也必须先识别，再单独确定归属。

本次文档治理会完整发现规格与实现差异，并登记其承接任务；不把发现的所有业务缺陷自动扩成软件重写。纯表述和内容迁移可以闭环；需要改变行为的冲突须有明确的现行依据或用户决定，并按对应业务工作单元处理。

## 4. 整理后的文档职责

沿用现有权威位置，先合并内容与职责，再判断是否值得调整目录。下面是目标职责，不是要求为每一行新建文件。

| 信息 | 最终归属 | 清理动作 |
| --- | --- | --- |
| 跨项目个人协作偏好 | 用户全局 `AGENTS.md` | 保留通用偏好；项目专属命令和栈约束下放；全局变化单独展示影响 |
| 本仓库所有任务的共同规则 | 根 `AGENTS.md` | 保留必要开工动作、边界和按任务触发的指针；专题细节迁到已有专题 |
| Claude 入口 | 根 `CLAUDE.md` | 保持单一规则指针；现状已符合，检查链接即可 |
| 如何找到文档 | 根 `README.md`、`docs/README.md` | 根页只做项目入口；文档页统一导航，减少层层跳转和重复目录 |
| 词义与概念区别 | `CONTEXT.md` | 重写为词表，保留必要关系与辨义；移走流程、枚举、UI 数值和技术实现 |
| 决策原因与真实取舍 | `docs/adr/` | 全部核对有效性、替代关系和独有理由；按定稿保留政策处置旧 ADR |
| 开发专题规程 | `docs/agents/` | 合并同一流程的碎片规则，删除重复开工步骤、命令快照和失效技能列表 |
| 测试方法与测试资产说明 | 新出现的 `docs/testing/` 及现有测试入口 | 核对与协作验证规则、脚本说明的重复；只保留有独立用途的内容，并按实际职责决定归属 |
| 视觉和交互规格 | `docs/design/` | 统一权威链、组件规格及验证方法；令牌值来自实际令牌源 |
| 架构、字段、命令、读模型、导航 | `docs/rewrite/` | 每类契约各自集中，清掉跨文档重复定义与过时实现说明 |
| 领域/页面业务规则 | `docs/rewrite/pages/` | 全量审查 24 份；按完整业务对象及流程决定合并，不再等触及时才检查 |
| 用户怎样完成任务 | `docs/guides/` | 全量审查 38 份，按完整用户流程合并短碎指南，修复入口及步骤 |
| 尚未完成的产品/迁移目标 | `docs/prd/`、`docs/migration/` | 核对独立价值；已成为现行契约的内容迁移，未完验收义务保留承接 |
| 排期、认领和任务进度 | GitHub 当前 Issue | 完成的本地实施计划、票据副本和交接稿并回相应记录后清退 |
| 独有研究与最小验收依据 | `docs/research/`、`docs/design/evidence/` | 保留有价值的结论和可定位的依据，清除重复轮次、中间输出及无用快照 |

拆分或合并采用同一个判断：读者、职责、更新时机是否相同。同一用户流程被分散在多份很短的文件中，优先合并；独立领域虽然相邻但各自完整，保留独立入口。每次合并同时更新全部入链，避免留下新的“汇总文档 + 原文件”双份正文。

## 5. 处置规则：由 agent 先给完整结论

每份文件最终必须落入下列一种主结果；一份长文中的不同章节可以有不同去向。

| 结果 | 适用情况 | 完成门槛 |
| --- | --- | --- |
| 保留 | 职责独立、内容有效、有持续用途 | 全文已审，引用及状态正确；不能仅凭标题给“保留” |
| 重写 | 有独立价值，但混写、冗长、冲突或过时 | 有效条件和例外完整保留，职责清楚，旧错误有依据地修正 |
| 合并 | 多份文件服务同一读者和任务，拆分徒增查找 | 接收文档可独立回答问题，独有内容与理由有去向，原入链全部修复 |
| 迁移 | 内容放错类别，仍有独立价值 | 放入现有恰当位置；迁移本身不能冒充减少文件 |
| 删除 | 无独有有效内容、无未承接义务、无必要历史依据 | 给出具体路径、理由、承接位置、引用处理和恢复办法，再按授权执行 |
| 待裁定 | 存在证据无法解决的真实取舍 | 明确问题、选项、推荐、影响与阻塞范围；不得无限期留“待看” |

所有有效业务限制、状态条件、计算口径、资格门槛、失败路径、例外及验收义务均需逐项核对去向。重复文本检测和模型相似度只能筛选候选，不能直接授权删除。抽样用于复核改写质量，不替代全量覆盖。

实施时把原清单更新为唯一处置台账，必要字段为：`文件/章节 → 问题 → 处理动作 → 权威承接 → 入链/生成源 → 验证结果 → 最终状态`。用户只看汇总和例外，完整底账由 agent 维护。大规模附件的机器清单放在项目专用临时目录，不另增长期报告。

## 6. 分阶段执行计划

阶段是便于组织和验收的边界，不是每阶段都要求用户确认或提交 commit。

| 阶段 | 可核对的交付结果 |
| --- | --- |
| P0 全量登记 | 全部文件及保护项入账，补齐旧清单和执行中的增量 |
| P1 全文与关系审查 | 文件处置建议、独有规则去向、引用关系、真正待决问题 |
| P2 规则与入口统一 | 一套明确的协作规则、导航和材料保留政策 |
| P3 词表与决策整理 | 纯词义 CONTEXT、已承接的业务规则、准确的 ADR 状态 |
| P4 设计与业务契约整合 | 全量审查后的跨域契约与 24 份页面规格，合并重复正文 |
| P5 面向用户与实施材料整合 | 按完整任务组织的指南、清楚承接的产品及迁移义务 |
| P6 历史与证据清退 | 最小完整证据集合、具体清退名单与恢复办法 |
| P7 验收与集中交付 | 全量检查结果、数量变化、剩余取舍及最终差异 |

### P0：补齐全量清单与保护范围

- 枚举全部范围内文件，分别标记已跟踪、未跟踪、他人修改、生成文件及真实原件。
- 记录当前版本、文件大小、类型、作用域、现有入口；补齐原清单遗漏，不继承旧计数。
- 确认文档生成器与输出关系，查出只读生成文件、受测试引用的路径和活动目录。
- 建立本任务文件白名单与变化记录；不创建全仓备份副本，不清理其他任务产物。
- **完成条件：** 全部文件进入台账；保护项明确；后续每项改动能归因到本次任务。

### P1：全量关系核对与正文审查

- 建立 Markdown 链接、相对路径、标题锚点、`[[词条]]`、正文路径及代码/测试引用关系。
- 全文审查所有 Markdown 和有规则含义的 HTML/JSON；按文件确认内容类型，不能只扫标题。
- 识别重复定义、冲突指令、孤立文档、循环导航、完成的计划、过期状态、失效截图和重复附件。
- 对所有规则逐条区分现行定义、已定待开发、当前实现事实、历史观察；用相关当前 Issue 核实，不能只看标签。
- 证据按验证事件建立版本、场景、结论与支撑文件关系。先对全部附件做精确重复和元数据检查，再检查内容差异；不同状态截图不能只因相似就删除。
- **完成条件：** 每份文件有审查结论，每条独有义务有保留或承接方案，真实未知集中成少量主题。

### P2：统一规则、入口与保留政策

- 一起整理全局 `AGENTS.md`、项目 `AGENTS.md`、`CLAUDE.md`、`docs/agents/` 和两层 README。
- 全局文件的项目无关偏好与本仓约束分开；例如全局固定 `npm test` 与本仓按风险选择 pnpm 脚本的要求需明确适用关系，不能在改写时悄悄取消测试义务。
- 开工顺序只定义一次；专题文档用“何时读取、完成什么”的指针，清掉反复复制的步骤。
- 依据已有要求修正例行 PDF、过时命令/版本、CI 快照等问题；同时检查 GitHub 仍被执行的规则正文。
- 本次采用用户新要求：不按文件或小修复频繁 commit；永久规则是否改成同样策略单独呈现，不自行扩大为所有未来项目偏好。
- 拿具体候选解释旧 ADR、研究和证据的保留/清退政策，集中解决确需决定的政策差异。
- **完成条件：** 常见任务能从入口直接找到唯一规程；同一动作不再收到相反指令；全局修改与项目修改的影响明确。

### P3：迁移规则并重写 CONTEXT 与 ADR

- 全量逐词条审查 `CONTEXT.md`，保留名称、定义、关键区别和必要概念关系。
- 枚举和字段约束迁到数据契约，操作和资格迁到页面契约，技术选型和理由迁到 ADR/架构，UI 行为迁到对应公共契约。
- 先补接收位置，再修复所有依赖词条获得业务规格的反向引用，最后精简词条；CONTEXT 不能丢失最后一份业务规则。
- 全部 ADR 核对当前有效条款、被替代部分、真实取舍理由和引用；部分过时不能导致整份连同有效理由一起删除。
- 退役术语按仍被使用的程度保留必要指针；退役业务的禁止规则若仍约束当前实现，必须留在现行契约。
- **完成条件：** CONTEXT 回到词表职责；所有迁出规则有承接；ADR 状态和替代关系一致；候选清退文件不再持有唯一有效依据。

### P4：全面整合设计、架构与业务契约

- 全量处理 `docs/design/` 非证据规范、`docs/rewrite/` 的 8 份跨域契约以及全部 24 份页面规格。
- 统一视觉数值来源，合并重复设计原则，去掉阶段性实施记录；保留验证方法与运行参考证据的准确关系。
- 核对实体、字段、命令、读模型、导航和页面的职责，消除重复字段表、枚举、状态流和计算口径。
- 每个领域完整检查正常、缺失、失败、重复、更正和跨域结果；现行有效内容即使很长也先归并后压缩。
- 统一“已实现”“已定待开发”“历史参考”的表达，状态账本只保留必要汇总；生成索引从生成源修正，避免手改输出。
- 规格与代码冲突单独留证并明确承接，不能把正文改成代码现状来掩盖缺陷。
- **完成条件：** 所有跨域与页面文档均完成全文审查和处置；独有规则可追溯；入口、字段与状态不互相矛盾。

### P5：整合指南、PRD、迁移及实施承接材料

- 全量处理 38 份指南、3 份 PRD、4 份迁移材料和2份实施承接文档。
- 按用户完成一个任务的路径整合指南；需要连着阅读的短碎篇合并，独立完整流程保留。指南不复制内部开发细节。
- 核对每条操作的真实入口、前置条件、保存结果、失败恢复和可用状态；已定未实现流程清楚标记。
- 对声称当前可用但证据不足的关键步骤，定向检查代码、测试或运行态；无法核实的明确标记，不宣称已验证。
- PRD 已落入现行契约的内容与实施票副本清退；未完成目标、迁移映射与对账口径必须保留明确承接。
- 指南默认交付 Markdown；已有 PDF 按是否仍有独立用途判断，不例行再生成。
- **完成条件：** 指南覆盖有效用户任务，碎片入口减少；已完成计划不再承担排期；未完义务无遗漏。

### P6：清退研究、历史过程稿与冗余证据

- 全量检查 `research/`、各处计划/交接/反馈轮及 49 组 Issue 证据目录和根级证据报告。
- 每项研究判断独有观察是否仍支撑决定；结论已被采纳时保留必要论证，已完成的任务正文、旧待办和重复规格退出工作树。
- 为每个验证事件保留能说明版本、场景、操作、结果、限制的最小完整证据集合。重复图片、中间渲染、过期轮次日志和可重建输出是候选，逐项确认价值后清退。
- 同时核对 Issue/评论、现行报告、测试以及外部稳定引用。历史提交已保存的原链接可记录恢复定位；无法修改的外部引用不假装已修复。
- Git 可恢复、未提交可回收、真实原件三种情况分别说明。删除工作树文件不会自动缩小 Git 历史，本次不重写仓库历史。
- **完成条件：** 每份历史材料及每个附件均有结果；删除候选有具体路径和恢复办法；没有失去唯一证明或未完成验收依据。

### P7：全量验收、集中呈现与收尾

- 对所有受影响文件和引用做完整检查；改写质量可由独立 agent 复核，但迁移义务和删除依赖必须全量核对。
- 用常见任务检查导航：改 Vue 页面、修数据规则、理解工资概念、完成导入操作、查询某项决定、回看验收证据。确认能找到正确入口且不会被旧稿误导。
- 给用户一份短结果：合并/删除数量、主要结构变化、剩余真实取舍、具体删除集合及恢复方式。完整路径底账附在同一任务清单中，不要求用户逐份阅读。
- 对仍需明确授权的永久删除，先完成全部核对和承接，再集中提交具体范围；批准某组后按该范围执行，不重复逐文件询问。可逆处置与已获授权的操作按授权直接完成。
- 完成后移除本任务临时扫描输出、缓存和脚本；使用项目专用临时目录并逐路径检查，优先可恢复处置。
- 本计划及旧盘点作为过程材料，完成后的必要规则并回权威源，结果进入最终回执；不永久留下新版计划、旧版计划、总结副本三套材料。
- **完成条件：** 达到第 10 节的全部指标；用户只需处理清楚列出的剩余选择；提交按第 9 节执行。

## 7. 可以立即纳入处理的具体候选

以下为已发现的问题与合并方向，具体去留仍由全量审查确定；不表示已经授权删除。

| 对象 | 已知问题或整合方向 | 必须一并处理的关系 |
| --- | --- | --- |
| `AGENTS.md`、`docs/agents/README.md` | 开工顺序重复且不同；根规则混有专题细节 | 统一开工流程，专题入口按任务触发；纳入新增 `git-workflow.md` |
| `docs/agents/skills-cheatsheet.md` 与协作入口 | 评估将稳定路由并入同一入口，减少一个必须维护的碎片页 | 不复制动态技能全集；修复所有入链 |
| `docs/agents/domain.md` 与文档职责入口 | 评估短规则合并或改为必要专题链接 | CONTEXT/ADR/数据归属仍必须明确，不将重要约束埋入泛泛导航 |
| `module-review.md`、#402、#403 | 仍出现例行 PDF 要求，与现行 Markdown 指南规则不一致 | 本地与被执行的 Issue 一起核对；不能只修本地文件 |
| `CONTEXT.md` 的归档、分供方、页签、原语、工资词条 | 混入门禁、七类枚举、UI 数值、实现位置、退役来源规则 | 归档页面和分供方数据/页面仍反向依赖词表；先迁移再缩词条 |
| ADR 0007、0011、0013 与 ADR 索引 | 38px/36px 冲突，旧文件仍含有效容器/导航行为 | 迁移有效条款与必要决策理由；核对现行“旧 ADR 不删除”政策 |
| `DESIGN-TASTE.md`、`DESIGN-SYSTEM.md`、`CRM-PATTERNS.md` | 视觉原则、样式数值和业务模式职责交叉 | 视觉内容归并到设计权威；业务查询等独有模式保留合理位置 |
| `boq-import.md`、`real-ticket-excel-reference.md` | 真实样本分析与持续导入规则混杂 | 独有导入规则留在契约；样本价值另判，不一律搬进研究再保留 |
| 工资系列指南与证据轮次 | 多篇指南与多个验证轮次并存 | 按用户任务合并指南；按不同事实/场景保留证据，不能把不同类型工资混为一篇无边界大文档 |
| 本地实施票副本、工作分解与旧交接稿 | 与当前 Issue 可能重复，可能继续展示旧状态 | 逐条承接未完义务；完成的过程副本清退 |

## 8. 工作组织与用户参与

采用一个统筹任务持续维护本清单。只读调查可并行：一组审规则和术语，一组审契约与指南，一组审历史材料和证据。主 agent 统一决定归属和合并路径，编辑阶段分配互不冲突的文件范围；CONTEXT、页面契约与 ADR 的迁移必须共同收口。

其他开发任务可以继续，但共享文档先核对最新改动并串行编辑，不能覆盖其未提交内容。每批记录新增/变更文档，最终再做一次增量复扫；清理范围以真实工作树为准，不锁死在最初的数量快照。

依赖顺序：`P0 → P1 → P2 → P3/P4/P5 → P6 收口 → P7`。P3、P4、P5 可按已确定的接收位置分领域交错推进；历史采证与重复检测可从 P1 并行，但依赖内容迁移的删除必须等承接完成。

- 已由用户和现行权威决定的事项直接处理，重复、断链、错位、格式问题不交给用户做选择题。
- 真实分歧按主题集中，每轮最多 3 个关键问题；每个问题附推荐方案和具体影响，减少用户重新阅读原文的负担。
- 未回答的选择只阻塞依赖它的处置，独立审查和改写继续。沉默不视为删除或业务变更授权。
- 用户批准具体删除集合时，不需要逐文件再次确认；新增越出该集合的删除另列。
- 不为每个文件创建一个 Issue。若需要跨会话执行，沿既有 #402/#403 的相关范围登记一个文档治理工作单元，必要时按完整成果分少量子任务，避免新建平行总路线。
- 本计划不自动创建或修改 Issue，不调用远端 CI。正式需要同步 Issue 时，按用户对执行工作的授权处理。

技能路线：`ask-matt` 用于选择流程；规则改写用 `writing-for-agents`；词表与 ADR 用 `domain-modeling`；只有真实取舍才用 `grill-with-docs`。本次范围已经可描述，无需先重建大型 `wayfinder` 地图。确需发布跨会话规格时再用 `to-spec` / `to-tickets`，文档整理不套用无关的功能开发和测试模板。

## 9. 提交、可恢复性与临时产物

用户最新要求优先于仓库“每个独立工作单元立即提交”的默认规则：**本次计划不提交 commit；后续整理不按文件或小修改频繁提交。** 默认在完整整理并验收后集中交付差异，按用户要求统一提交；用户要求阶段性保存时再形成大批次提交。

- 不使用 commit 充当每一步检查点，也不自动推送、合并或调用 GitHub Actions。
- 修改只限本任务文件；最终若提交，显式列出这些路径，不暂存其他任务变更。
- 已跟踪文件利用 Git 基线与本次差异核对；未跟踪且含独有内容的文件，在覆盖、删除前保留明确的可恢复副本或完成可核对迁移，不能声称 Git 已能恢复。
- 临时机器清单、扫描缓存和必要备份限定在项目内专用临时目录；不能把整个 docs 克隆成第二套资料。完成后清理 Codex 自有临时项，优先回收站。
- 永久删除前列明精确范围与恢复条件并取得明确授权；递归处置前核对绝对路径、重解析点和活动进程，不对业务原件或未分类文件批量操作。
- 全局 `AGENTS.md` 的改写单独提供差异；它影响其他项目，且位于当前项目写入范围之外，实际写入遵守环境授权要求。

## 10. 最终验收与回执

| 检查项 | 合格标准 |
| --- | --- |
| 文件覆盖 | 范围内文件 100% 登记并有最终处置；执行中新文件纳入增量 |
| 规则覆盖 | 独有有效规则、例外、决策理由和未完验收义务 100% 有去向 |
| 权威唯一性 | 同一现行规则不存在互相竞争的独立定义；重复说明只作解释/链接 |
| 冲突 | 可依证解决的冲突全部消除；剩余取舍列清责任与阻塞范围，有未决项时不宣称全量完成 |
| 引用 | 当前仓库中的失效文件链接、锚点、词条及代码/测试引用清零；外部历史链接限制明确说明 |
| 内容减少 | 报告文档数、合并数、删除数、正文体积、证据文件数与体积的前后变化 |
| 用户负担 | 用户只需阅读结果摘要、真正取舍与具体处置集合；不需要重新审阅全部正文 |
| 功能边界 | 纯文档整理不修改业务行为；实际发现的行为差异有明确承接，不伪造已完成状态 |
| 验证方式 | 文档链接、生成索引、导航及迁移义务做匹配检查；无代码变更不运行无关全套应用测试。若修改 JavaScript，仍遵守当前有效的 `npm test` 要求 |
| 恢复与卫生 | 每项删除说明恢复途径；本任务临时输出清完；他人改动未混入；无自动零碎提交 |

最终回执统一展示：**处理总数、留下的文档结构、实际合并与删除、有效内容承接证明、未解决事项、恢复方法、验证结果，以及是否提交。** 只有完成全量核对与约定处置后，才能称本次全方位清理完成。

---

# 开发规则逐份复核清单（待用户裁定）

> 基线：2026-09-23，`origin/main` 的 `bbe8247a`。本文件是审阅稿，不是新规则，也不代表文件已获准删除。先逐份给一行建议；有争议的条款在文末列原文与建议方向。用户修改规则正文后，再协助压缩措辞。

## 范围与数量

基线已跟踪 Markdown 共 **265 份**。其中验收证据 **106** 份、历史研究 **37** 份、用户指南 **36** 份，先盘点，均不在本轮规则裁定范围内；其余 **86** 份逐份列于下方。“保留”表示目前有明确用途，不表示已逐条重新验收业务正确性。

验收证据目录另含图片、日志和 JSON，共 **2,271 个文件、约 191.4 MiB**；基线历史研究目录共 **46 个文件、约 1.2 MiB**；用户指南目录 **36 个文件、约 0.3 MiB**。较大的证据组是 `issue-412-payroll-c2`（403 件／24.6 MiB）、`issue-412-payroll-c1`（274 件／17.2 MiB）、`issue-412-payroll-fees`（192 件／14.2 MiB）、`issue-412-payroll-a`（131 件／12.1 MiB）、`issue-412-target-cost`（97 件／11.8 MiB）和 `issue-412-payroll-hollow`（129 件／11.8 MiB）。这些都是**候选盘点对象**；删除前须核对当前引用、可复现方法与保留价值，由用户逐项决定。

## 协作与入口（8）

| 文件 | 初步建议 | 理由或修改方向 |
| --- | --- | --- |
| `AGENTS.md` | 修改 | 保留开工与验证底线；补“业务闭环提交、依赖链验收冻结后成批合并”和模型／推理强度的表达方式。 |
| `CLAUDE.md` | 保留 | 只作 `AGENTS.md` 指针，避免第二套协作规则。 |
| `CONTEXT.md` | 保留 | 领域术语权威源；变化随业务闭环更新。 |
| `README.md` | 保留 | 项目入口；只保留导航，不复制协作细则。 |
| `docs/README.md` | 保留 | 权威源导航；历史链接继续标为非权威。 |
| `DC重构设计源码/_ds/crm-e3d87120-cf57-4b83-8a9b-188c305f529d/readme.md` | 保留 | 设计运行时入口，属于基准说明。 |
| `红圈系统/业务流转.md` | 保留为参考 | 原系统业务流资料，不直接覆盖现行 DC 规格。 |
| `红圈系统/命名对照与全景.md` | 保留为参考 | 原系统对象映射，现行词义仍以 `CONTEXT.md` 为准。 |

## ADR（22）

| 文件 | 初步建议 | 理由或修改方向 |
| --- | --- | --- |
| `docs/adr/0001-invoice-single-table.md` | 保留 | 发票台账建模决策仍是业务约束。 |
| `docs/adr/0002-change-order-generates-ledger.md` | 保留 | 已签证变更与台账派生关系仍有效。 |
| `docs/adr/0003-confirm-dialog-deletion-model.md` | 保留 | 删除确认模型仍约束交互。 |
| `docs/adr/0004-export-interaction-model.md` | 保留 | 导出直接保存与配置入口边界仍有效。 |
| `docs/adr/0005-import-mapping-model.md` | 保留 | 导入映射与实体入口仍是跨模块约束。 |
| `docs/adr/0006-ocr-paddleocr-vl-single-model.md` | 保留，实施时复核 | OCR 模型与部署边界是独立决定；需随实际部署核对。 |
| `docs/adr/0007-unified-visual-style-rounded-cards.md` | 候选迁移后删除 | 旧视觉方案大部被 0013 取代；先迁走仍有效的“内容区单层容器”，并消除 38px／36px 冲突。 |
| `docs/adr/0008-adopt-shadcn-vue-on-unocss.md` | 保留 | 组件栈和 UnoCSS 边界仍约束实现。 |
| `docs/adr/0009-vxe-table-as-datagrid-engine.md` | 保留 | 表格底座决策仍约束实现。 |
| `docs/adr/0010-quantity-matrix-and-construction-record-model.md` | 保留 | 工程量矩阵与施工记录的领域关系仍有效。 |
| `docs/adr/0011-redesign-application-shell.md` | 候选迁移后删除 | 视觉已被 0013 取代；页签、导航、通知等有效行为先迁入现行契约。 |
| `docs/adr/0012-exact-factor-combination-solver.md` | 保留 | 开票因子的精确求解边界仍有效。 |
| `docs/adr/0013-align-all-ui-to-online-design.md` | 保留，精简历史 | 当前视觉权威；保留现行规则，考虑把被覆盖的阶段性叙述移出正文。 |
| `docs/adr/0014-full-page-entity-forms.md` | 保留 | 业务实体整页表单是现行交互原则。 |
| `docs/adr/0015-form-persistence-and-payment-reconciliation.md` | 保留 | 字段持久化和付款勾稽仍约束开发。 |
| `docs/adr/0016-overlay-composition-contract.md` | 保留 | 浮层交互平面和模态栈仍需统一。 |
| `docs/adr/0017-provisional-schedule-before-contract.md` | 保留 | 暂估排程与合同后绑定是现行业务决定。 |
| `docs/adr/0018-versioned-schedule-process-library.md` | 保留 | 工序版本和前置关系仍是领域约束。 |
| `docs/adr/0019-delivery-export-source-preservation.md` | 保留 | 原件保真与可选转换仍有未完验收，不能按引用少删除。 |
| `docs/adr/0020-browser-authority-and-demo-workspace-boundary.md` | 保留 | 中央权威与演示实例的区分是当前数据边界。 |
| `docs/adr/0021-single-operator-windows-production-storage.md` | 保留 | 正式存储与备份门槛仍在实施中。 |
| `docs/adr/README.md` | 修改 | 现写“被替代 ADR 不删除”；改成经现行约束迁移、引用修复和用户核对后可删。 |

## 开发协作规则（7）

| 文件 | 初步建议 | 理由或修改方向 |
| --- | --- | --- |
| `docs/agents/README.md` | 修改 | 开工顺序应与 `AGENTS.md` 一致：先检查工作树，再查 Issue。 |
| `docs/agents/ci-usage.md` | 修改 | 保留远端 CI 的按需确认和依赖链原则；2026-07-28 的时长／费率快照改为调用前读取最新成功运行与官方费率。 |
| `docs/agents/domain.md` | 保留 | 术语、ADR 和数据模型的归属规则有明确用途。 |
| `docs/agents/issue-tracker.md` | 保留 | Issue 查询、承接与依赖关系规则仍有效。 |
| `docs/agents/module-review.md` | 修改 | 第 176 行的例行 PDF 要求与当前 Markdown 指南规则冲突；同步闭环提交与批次合并表述。 |
| `docs/agents/skills-cheatsheet.md` | 保留，按使用复核 | 技能路由可以留一页，但不维护易失效的全集。 |
| `docs/agents/triage-labels.md` | 保留 | 分诊标签约定仍是 Issue 协作入口。 |

## 设计规则、索引和状态（8）

| 文件 | 初步建议 | 理由或修改方向 |
| --- | --- | --- |
| `docs/design/DESIGN-TASTE.md` | 修改 | 2026-07 的色值快照和后续实施历史易与令牌、ADR 0013 重复；保留视觉原则，令牌只链接权威源。 |
| `docs/design/README.md` | 修改 | 保留简短导航和权威链；历史实现状态移向状态账本／Issue。 |
| `docs/design/interaction-style-references.md` | 保留为参考，核对位置 | 多风格参考不是现行规范；与现行组件规格冲突时以组件规格为准。 |
| `docs/design/kit-ui-component-specs.md` | 保留 | 共享交互原语和表格密度的可执行规格。 |
| `docs/design/module-review-coverage.md` | 保留为生成索引 | 大型覆盖表是数据／状态，不应当被当作人工规则；核对生成源与当前 Issue。 |
| `docs/design/runtime-reference-audit.md` | 保留为证据矩阵 | 直接参考等级和路由依据仍被使用；将规范性结论与历史采证清楚分开。 |
| `docs/design/runtime-visual-regression.md` | 保留 | 视口、滚动和运行态验收方法仍有用。 |
| `docs/design/ui-implementation-status.md` | 保留为状态账本，精简 | “未实现／已搭未闭环”要保留；避免复制每个 Issue 的过程记录。 |

## 架构与跨域业务契约（8）

| 文件 | 初步建议 | 理由或修改方向 |
| --- | --- | --- |
| `docs/rewrite/ARCHITECTURE.md` | 保留 | 工程结构、数据边界的权威入口。 |
| `docs/rewrite/COMMANDS.md` | 保留 | 中央写入、幂等和冲突恢复的权威契约。 |
| `docs/rewrite/CRM-PATTERNS.md` | 修改 | 保留列表查询等业务模式；视觉尺寸与状态样式改为引用 ADR 0013／组件规格。 |
| `docs/rewrite/DATABASE.md` | 保留 | 字段与实体关系的唯一权威源，篇幅大本身不是删除理由。 |
| `docs/rewrite/DESIGN-SYSTEM.md` | 修改 | 去掉与令牌源／ADR 0013 重复的视觉配方，保留使用边界。 |
| `docs/rewrite/NAVIGATION.md` | 保留 | 跨域路由、返回上下文与身份传递契约。 |
| `docs/rewrite/PUBLIC-SURFACES.md` | 保留 | 洞察、通知、页签行为的现行契约；可承接 ADR 0011 的有效行为。 |
| `docs/rewrite/READ-MODELS.md` | 保留 | DTO、空错权限和本地／后台适配边界的权威源。 |

## 页面业务契约（24）

这些文档按用户选择随业务页面触及时逐份深挖；当前建议“保留”仅表示页面仍有对应规格入口。

| 文件 | 初步建议 | 理由或修改方向 |
| --- | --- | --- |
| `docs/rewrite/pages/base-crew.md` | 保留，触及时复核 | 班组实体与页面行为。 |
| `docs/rewrite/pages/base-customer.md` | 保留，触及时复核 | 客户主数据、开票资料与当前磁盘切片。 |
| `docs/rewrite/pages/base-supplier.md` | 保留，触及时复核 | 分供方主数据、证照与跨项目视图。 |
| `docs/rewrite/pages/base-worker.md` | 保留，触及时复核 | 工人信息与私密资料边界。 |
| `docs/rewrite/pages/boq-import.md` | 修改候选 | 7 份真实合同的样本分析与持久导入规则混写；规则留在页面契约，样本资料可转证据。 |
| `docs/rewrite/pages/contract-forms.md` | 保留，触及时复核 | 合同表单与辅助结算。 |
| `docs/rewrite/pages/core-contracts.md` | 保留，触及时复核 | 三类核心合同。 |
| `docs/rewrite/pages/finance-billing.md` | 保留，触及时复核 | 开票申请流程。 |
| `docs/rewrite/pages/finance-invoice.md` | 保留，触及时复核 | 发票台账、识别与因子。 |
| `docs/rewrite/pages/finance-payment.md` | 保留，触及时复核 | 付款申请与勾稽。 |
| `docs/rewrite/pages/finance-receipt.md` | 保留，触及时复核 | 实际收款与往来。 |
| `docs/rewrite/pages/finance-records.md` | 保留，触及时复核 | 实际支付与申请分摊。 |
| `docs/rewrite/pages/finance-reimbursement.md` | 保留，触及时复核 | 报销头与明细。 |
| `docs/rewrite/pages/homepage-dashboard.md` | 保留，触及时复核 | 首页施工进度入口。 |
| `docs/rewrite/pages/material-delivery.md` | 保留，触及时复核 | 送货单识别、归档、打印。 |
| `docs/rewrite/pages/material-management.md` | 保留，触及时复核 | 乙供材和甲供材表单。 |
| `docs/rewrite/pages/owner-documents.md` | 保留，触及时复核 | 甲方与分包单据、罚扣。 |
| `docs/rewrite/pages/project-info.md` | 保留，触及时复核 | 项目列表与详情。 |
| `docs/rewrite/pages/project-supplier.md` | 保留，触及时复核 | 项目×分供方工作台。 |
| `docs/rewrite/pages/real-ticket-excel-reference.md` | 候选移入参考资料 | 真实票据结构更像样本参考；先确认没有独有的现行导入规则。 |
| `docs/rewrite/pages/schedule-progress.md` | 保留，触及时复核 | WBS 排程与工程量联动。 |
| `docs/rewrite/pages/subcontract-payroll.md` | 保留，触及时复核 | 工资、考勤与结算主流程。 |
| `docs/rewrite/pages/subcontract-quantity.md` | 保留，触及时复核 | 工程量模板、指派与阶段完成。 |
| `docs/rewrite/pages/target-cost.md` | 保留，触及时复核 | 目标成本项目基线。 |

## 产品、迁移与实施承接（9）

| 文件 | 初步建议 | 理由或修改方向 |
| --- | --- | --- |
| `docs/prd/delivery-recognition.md` | 保留 | 送货单识别与原件处置需求仍需按业务验收。 |
| `docs/prd/project-operating-summary-and-import.md` | 保留 | 项目经营汇总与实体迁移的产品目标。 |
| `docs/prd/project-operating-summary-index.md` | 保留，精简 | 作为入口即可，不复制状态与字段。 |
| `docs/migration/ruijing-acceptance.md` | 保留 | 睿璟迁移的验收口径。 |
| `docs/migration/ruijing-data-quality-and-reconciliation.md` | 保留 | 数据质量与差异归因。 |
| `docs/migration/ruijing-workbook-mapping.md` | 保留 | 工作簿到实体字段的映射。 |
| `docs/migration/summary-field-catalog.md` | 保留 | 汇总字段口径，复核是否与 `DATABASE.md` 重复。 |
| `docs/implementation/production-gate-work-breakdown.md` | 保留到关口完成 | 当前生产存储、备份和部署依赖入口；完成后并回 Issue／权威源再删。 |
| `docs/implementation/project-operating-summary-work-breakdown.md` | 保留到业务闭环完成 | 当前项目经营汇总实施入口；完成后并回 Issue／权威源再删。 |

## 先深挖的争议项：原文与建议方向

| 文件与现行原文 | 建议方向（待用户改正文） |
| --- | --- |
| `docs/agents/module-review.md:176`：“用户流程变化……生成并逐页渲染检查 PDF。” | 与 `AGENTS.md:84`、`docs/guides/README.md:58-60` 对齐：同单元更新 Markdown 指南；仅明确需要 PDF 时生成并逐页检查。 |
| `docs/agents/README.md:7-11`：查 Issue 和权威源后才核对工作树。 | 对齐 `AGENTS.md:7-8`：先 `git status`，保护他人改动，然后查 open Issue 和权威源。 |
| `docs/adr/0007-unified-visual-style-rounded-cards.md:15`：表头／数据行均为 38px。`docs/adr/0013-align-all-ui-to-online-design.md:29`：均为 36px。 | 现行表格密度只保留一处定义；核对组件规格和运行参考后，迁移 0007 的有效单层容器结论，再考虑删旧 ADR。 |
| `docs/adr/README.md:3`：“被替代的 ADR 保留正文……不删除历史。” | 改为：仍有效的约束与引用迁移、核对完成后，可删除过时 ADR；历史由 Git 保存。 |
| `docs/design/DESIGN-TASTE.md:8,46-85`：声明 `content-v5.css` 是唯一令牌源，又复制一套 hex 快照。 | 将现行数值链接到令牌源；本文只保留稳定的视觉判断原则和必要示例。 |

ADR 删除执行条件：**不再约束现行实现；仍有效的结论已迁入权威位置；代码、测试及现行文档引用已更新；用户看过对照稿。** 引用次数低或文件很长都不单独构成删除理由。验收证据、调查和指南的去留另经用户逐项裁定；本稿不授权删除它们。

## 非规则材料逐项目录（待用户决定去留）

证据以 Issue 目录为一项，避免把 2,271 个图片和日志逐张当作独立规则；研究和指南逐份列出。目录大小只作优先盘点依据，不能代替引用与保留价值判断。

### 验收证据目录（47 组）

| 目录 | 文件数 | 大小 MiB | Markdown 数 |
| --- | ---: | ---: | ---: |
| `issue-329` | 5 | 0.3 | 1 |
| `issue-330` | 25 | 1.7 | 1 |
| `issue-331` | 17 | 1.3 | 1 |
| `issue-412-payroll-a` | 131 | 12.1 | 4 |
| `issue-412-payroll-adjustments` | 119 | 9.5 | 4 |
| `issue-412-payroll-batch-workbooks` | 6 | 0.2 | 4 |
| `issue-412-payroll-c1` | 274 | 17.2 | 6 |
| `issue-412-payroll-c2` | 403 | 24.6 | 21 |
| `issue-412-payroll-fees` | 192 | 14.2 | 1 |
| `issue-412-payroll-history` | 103 | 10.2 | 3 |
| `issue-412-payroll-hollow` | 129 | 11.8 | 7 |
| `issue-412-target-cost` | 97 | 11.8 | 2 |
| `issue-418` | 1 | 0 | 1 |
| `issue-419` | 23 | 2 | 1 |
| `issue-421` | 1 | 0 | 1 |
| `issue-422` | 11 | 0.7 | 1 |
| `issue-423` | 1 | 0 | 1 |
| `issue-424` | 6 | 0.3 | 1 |
| `issue-425` | 6 | 0.4 | 1 |
| `issue-426` | 6 | 0.4 | 1 |
| `issue-427` | 1 | 0 | 1 |
| `issue-428` | 1 | 0 | 1 |
| `issue-429` | 6 | 0.6 | 1 |
| `issue-430` | 6 | 0.5 | 1 |
| `issue-432` | 6 | 0.5 | 1 |
| `issue-433` | 14 | 0.9 | 1 |
| `issue-434` | 12 | 0.5 | 1 |
| `issue-435` | 14 | 1 | 2 |
| `issue-436` | 29 | 1.9 | 1 |
| `issue-437` | 19 | 1.3 | 1 |
| `issue-438` | 7 | 0.6 | 1 |
| `issue-439` | 13 | 1.1 | 1 |
| `issue-440` | 8 | 0.6 | 1 |
| `issue-441` | 38 | 3.4 | 1 |
| `issue-442` | 77 | 6.9 | 5 |
| `issue-443` | 58 | 7.8 | 2 |
| `issue-444` | 88 | 9.4 | 2 |
| `issue-445` | 84 | 10.9 | 2 |
| `issue-446` | 96 | 11.6 | 2 |
| `issue-447` | 84 | 9.3 | 2 |
| `issue-449` | 13 | 1.3 | 1 |
| `issue-450-production-customer` | 4 | 0.2 | 1 |
| `issue-452-production-project` | 3 | 0.1 | 1 |
| `issue-463-production-process-library` | 5 | 0.1 | 2 |
| `issue-477-official-numbering` | 6 | 0.3 | 2 |
| `issue-478-frozen-location-output` | 6 | 0.6 | 1 |
| `issue-479-complete-workbook` | 15 | 1.3 | 3 |

### 历史研究 Markdown（基线 37 份）

| 文件 | KiB |
| --- | ---: |
| `docs/research/browser-audit-2026-09-05.md` | 16.1 |
| `docs/research/guide-pdf-cleanup-2026-09-14.md` | 6.9 |
| `docs/research/invoice-recognition-app-port-plan.md` | 22.3 |
| `docs/research/issue-review-2026-09-11/notification-grill.md` | 2.1 |
| `docs/research/issue-review-2026-09-11/payroll-central-facts.md` | 10.6 |
| `docs/research/issue-review-2026-09-11/payroll-central-spec-draft.md` | 35 |
| `docs/research/issue-review-2026-09-11/payroll-tickets/00-central-history-and-sources.md` | 5.8 |
| `docs/research/issue-review-2026-09-11/payroll-tickets/01-central-a-payroll.md` | 6.9 |
| `docs/research/issue-review-2026-09-11/payroll-tickets/02-central-c1-attendance.md` | 22.5 |
| `docs/research/issue-review-2026-09-11/payroll-tickets/03-central-c2-daywork.md` | 25.6 |
| `docs/research/issue-review-2026-09-11/payroll-tickets/04-central-adjustments-and-actual-payments.md` | 28.1 |
| `docs/research/issue-review-2026-09-11/payroll-tickets/05-central-housing-and-management-fees.md` | 36.6 |
| `docs/research/issue-review-2026-09-11/payroll-tickets/06-central-hollow-and-deductions.md` | 10.8 |
| `docs/research/issue-review-2026-09-11/payroll-tickets/07-central-batch-payments-and-workbooks.md` | 30.3 |
| `docs/research/issue-review-2026-09-11/payroll-tickets/08-worker-roster-archive.md` | 6.2 |
| `docs/research/issue-review-2026-09-11/README.md` | 50.2 |
| `docs/research/issue-review-2026-09-11/schedule-central-spec.md` | 6.2 |
| `docs/research/issue-review-2026-09-11/schedule-tickets/01-central-process-library.md` | 8.7 |
| `docs/research/issue-review-2026-09-11/schedule-tickets/02-central-wbs.md` | 12 |
| `docs/research/issue-review-2026-09-11/schedule-tickets/03-central-provisional-binding.md` | 9.8 |
| `docs/research/issue-review-2026-09-11/supplier-credential-tickets/01-central-originals-and-review.md` | 5.6 |
| `docs/research/issue-review-2026-09-11/supplier-credential-tickets/02-central-ocr-confirmation.md` | 4.4 |
| `docs/research/issue-review-2026-09-11/supplier-credentials-central-spec.md` | 8.9 |
| `docs/research/issue-review-2026-09-11/target-cost-central-spec.md` | 10.4 |
| `docs/research/issue-review-2026-09-11/target-cost-tickets/01-central-budget-versions-and-items.md` | 6.7 |
| `docs/research/issue-tracker-audit-2026-07-06.md` | 9.4 |
| `docs/research/kit-ui-primitives-wave2-prd.md` | 11.1 |
| `docs/research/kitui-to-shadcn-migration.md` | 5.4 |
| `docs/research/local-branch-integration-2026-09-05.md` | 2.8 |
| `docs/research/local-branch-integration-2026-09-10.md` | 15.6 |
| `docs/research/module-development-flows.md` | 17.6 |
| `docs/research/ocr-recognition-strategy.md` | 10.6 |
| `docs/research/ocr-ux-benchmark.md` | 12.2 |
| `docs/research/project-switcher-patterns.md` | 12 |
| `docs/research/README.md` | 3.2 |
| `docs/research/red-circle-ui-gap-2026-07-11.md` | 10.2 |
| `docs/research/schedule-dependency-editor-brief.md` | 14.6 |

### 用户指南 Markdown（36 份）

| 文件 | KiB |
| --- | ---: |
| `docs/guides/auxiliary-contracts.md` | 4.8 |
| `docs/guides/core-contract-and-boq.md` | 30 |
| `docs/guides/crew-worker-records.md` | 6.2 |
| `docs/guides/customer-records.md` | 10 |
| `docs/guides/finance-invoice.md` | 7.3 |
| `docs/guides/finance-payment.md` | 7.6 |
| `docs/guides/home-project-progress.md` | 4.8 |
| `docs/guides/invoice-factor.md` | 3.3 |
| `docs/guides/list-search-and-filters.md` | 5.1 |
| `docs/guides/local-customer-storage.md` | 4.8 |
| `docs/guides/local-data-migration.md` | 22.9 |
| `docs/guides/local-process-library-storage.md` | 2.2 |
| `docs/guides/local-project-storage.md` | 3.1 |
| `docs/guides/material-delivery.md` | 8.4 |
| `docs/guides/material-price-analysis.md` | 5.2 |
| `docs/guides/ocr-settings.md` | 1.9 |
| `docs/guides/other-expense-settlement.md` | 5 |
| `docs/guides/payroll-adjustments.md` | 7.1 |
| `docs/guides/payroll-attendance.md` | 24.2 |
| `docs/guides/payroll-complete-workbook.md` | 4.5 |
| `docs/guides/payroll-fees.md` | 6.7 |
| `docs/guides/payroll-hollow.md` | 6.1 |
| `docs/guides/payroll-official-numbering.md` | 2.9 |
| `docs/guides/project-excel-import.md` | 5.3 |
| `docs/guides/project-start-and-schedule.md` | 25.5 |
| `docs/guides/project-supplier-workbench.md` | 10.8 |
| `docs/guides/quantity-central-workflow.md` | 10.6 |
| `docs/guides/quantity-totals-and-export.md` | 4 |
| `docs/guides/README.md` | 6.8 |
| `docs/guides/receipt-registration.md` | 4.9 |
| `docs/guides/routes.md` | 5.9 |
| `docs/guides/supplier-credential-review.md` | 12.9 |
| `docs/guides/supplier-records.md` | 14 |
| `docs/guides/tabs-and-recovery.md` | 4.3 |
| `docs/guides/target-cost.md` | 8 |
| `docs/guides/worker-roster-archive.md` | 4.7 |
