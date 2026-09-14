# P3 B：逐签工事实与迁入接缝笔记

> 2026-09-14，只读准备，非权威规格或已验收实现。依据 P3 票及 preparation/implementation-plan.md；母票现时状态采用 Root 刚重读的 #412（四评论，2026-09-12T08:01:45Z）。当前 HEAD 仍为 `579d9383357fffd2bd87e727dbc21b903a7cb69c`，P2 WIP 正由 Root 提交。**等 P2 最终 SHA 与 A 冻结合同后再写产品；本次未运行服务或测试。** B 将担任 P3 作者，不能兼任本期独立最终审查人。

## 1. 已核事实与接缝判断

| 当前代码 | 已核事实 / P3 处理 |
| --- | --- |
| `server/utils/payroll-service.ts:29/64`；`payroll-runtime.ts:28` | `PayrollRun` 在同一工作区事务内同步身份、读写工资并最后复验 owner/身份/能力。B loader 只接受调用者的 `TransactionDb`，不调用公共 Repository、owner HTTP、service.run 或再次入队。 |
| `app/lib/payroll/daywork.ts:131/140/178/261` | 旧实现已有真实日期、单日 HH:mm、1/0.5 工、确认事实、时段重叠及日合计规则；配置正价按项目×负责人。保留行为，不直接开放 Native 写入；原修改只核目标范围，已发检查过滤软删头/链接，中央须补完整旧新范围与证据。 |
| `app/lib/payroll/statements.ts:394/1283` | 唯一关联已存在；旧预览过滤其他有效工资占用后才汇总。中央不能沿过滤结果把“被占用”说成“没有来源”。旧指纹已经含 ID、内容、时段、证明和配置规则，不能误称仅用合计。 |
| `central-source-locks.ts:17/23` | 当前纯投影保留已发软删头/成员/链接、快照成员及可定位隔离来源；同格式未发工资有意不构成人员月互斥。它**不是逐条签工领用表**。 |
| `server/utils/payroll-migration.ts:212/269` | P0 全图恢复先比较迁入原行及日志，并经共享投影核新旧来源互斥；P2 已补 C1/attendance source 与 receipt 引用。P3 扩展同一删除前检查，不另设恢复队列。 |

长期依据为 `docs/rewrite/DATABASE.md:528–549`、工资页面 C2 和 P3 票。API/类型名下述仅为 B 建议，由 A 一次冻结，不创建第二套签工/配置表，也不新增业务 grill。

## 2. 给 A 的最小 loader 合同

建议在 `server/utils/payroll-daywork-facts.ts` 集中无副作用的 SQL 读取及纯投影。可将结果合并为一次 loader，也可按 A 的合同拆两次调用；**必须共用同一个 tx**。

- 月事实入口：`loadPayrollDayworkFacts(tx, { projectId, month })`。仅接受明确项目和合法非空月；空页面由 A 返回原空范围与候选，不用空月读全年或自动选当月。月查询不接 crew/status 筛选，避免漏掉跨组占用、待确认或日内冲突。
- 原身份入口：`loadPayrollDayworkRecord(tx, recordId)`，原 ID 决定旧项目/人员/日期/班组，保留软删/不可用状态；页面 query 不能替换身份。编辑由 A 先读旧行，再按去重后的旧、新项目/月读取事实；冲突核验分别检查两侧，不只查目标范围。
- 配置入口可单独为 `loadPayrollC2ConfigFacts(tx, { projectId, leaderWorkerId })`。配置无按月生效策略；保留当前及停用/软删原行，既不借月参数造配置版本政策，也不只返回 `enabled=1` 行。

### 返回分区（字段须由 A 加入正式类型）

| 分区 | 必需资料与用途 |
| --- | --- |
| 原签工 `rows` | 稳定 `id/projectId/crewId/workerId`，`workDate/startTime/endTime/laborUnits/workContent/witness/confirmedOn/status/note`，原 `createdAt/updatedAt/deletedAt`，逐行 `sourceFingerprint`。原班组与当前班组分开；NULL/空字串/非法状态不默认成 0、draft 或 confirmed。正常 typed 字段不能表达的原值留内部原行或迁入证据，并给诊断。 |
| 原配置 `configs` | `id/projectId/crewId/leaderWorkerId/formatFamily/unitRate/ruleText/enabled`、原三个时间字段、整行指纹。明确 0/负数/坏值与缺值分别诊断；明确空规则保留空字串，不取当前默认脚注。不把 C1 dailyWage/overtimeRate 当 C2 价格。 |
| 行占用 `occupations` | `dayworkRecordId/linkId/statementId/projectId/month/formatFamily/status`，头与链接软删信息；来源类别（有效关联/已发原关联/可证明冻结/新 C2 source）及证据身份。全部返回后由 A 区分本单、他单未发、他单已发；本单重核可复用自己的有效行，他单未发不能抢走，已发软删仍占用。缺头/不一致关联不能被 LEFT JOIN 过滤成可用，改给缺损诊断。 |
| 月互斥 `locks` | 复用 `PayrollSourceExclusion`：项目、月、工人、格式、kind、工资 ID、签工/考勤 ID、evidenceId、legacyRecordId。查锁不按页面班组或确认状态过滤；真实零考勤、待确认签工、全部工资成员和已发零成员均在范围内。 |
| `diagnostics/evidence` | 沿 P2 可定位结构：code/message、recordId、workerId、field、tableName、entityId、legacyRecordId；完整原图及映射保持。日期坏、时段坏、工数坏、confirmed 缺证明、原关系不可用、重叠/超工、重复/缺损占用分别定位。无法定位的原记录保项目级未知诊断，不捏造可写 ID。 |
| 版本与资格 | 原行、配置、关联、相关头/快照及诊断稳定排序后生成内容指纹；不只用 MAX(updated_at)。当前人员/项目/班组资格和导航由 A 复用 P2 owner/options，B 不另造身份层；当前资格失效不抹去历史原行。 |

B 的月事实版本覆盖完整读取结果；A 的“已采用来源”应只封闭记录实际选中的原行、配置、全成员与相关资格/占用，避免把另一个无关主体配置当成已采用价格。同总量换 ID、同更新时间改 note/status/witness/ruleText 仍改变采用指纹。

## 3. A/C 的组合边界

1. A 将不删减的事实投影成台账/单记录/C2 form：独立“无记录 / 仅待确认 / 已占用 / 坏来源 / confirmed 可用”原因；C 按原因显示原行和去确认/原工资入口，不再用一组过滤后的 rows 猜空态。工资三态与签工两态由不同字段承载。
2. 日内验证用同项目、人员、日期的全部活跃签工，含 draft、不按 crew 过滤；编辑排除原记录自身。只比较合法时段和 0.5/1 工，坏旧行有定位诊断，不能用 Number(null) 变合法值。
3. 签工 mutation：先按原 ID 固定旧范围，再验证旧、新范围已发锁及占用；未发合法改文/改状态不一律禁写。相关工资由 A 标需重核。已有“其他未发工资领用”禁止第二单抢来源，和“已领用但未发原签工可合法修正”是两种动作，不能共用一个过宽禁写布尔值。
4. C2 保存/重核/发放：对所选原行逐条复验 confirmed/证明/资格/占用；A 在事务中写唯一关联及审计。发放前最后一次 owner await 后仍由 PayrollRun 复验；B 不写工资、配置、签工、revision 或 receipt。
5. 历史详情/输出只读冻结当时 source；B 提供冻结引用与原事实，不让当前月 loader 给旧缺快照补源。C 只能经 A store actions 调用，不直接 import B SQL loader。

## 4. 共享锁与逐条占用的实现建议

保留 `payrollSourceExclusionsFromGraph` 的人员月含义及 C1 现有行为。逐条占用建议增加同文件纯投影 `payrollDayworkOccupationsFromGraph(graph, query)`，由 B loader 与必要的迁入候选检查复用；类型归 A。不要把所有 C2 未发成员加入整月排他锁，否则会错禁同人作为另一簿成员、却使用不同签工的合法情况。

逐条投影应读取所有相关链接及原头：活跃 C2 头+活跃链接保未发领用；released 不以头/链接软删解除。P0 已发快照里的已知 `dayworkRecords` 原 ID、迁入映射，以及 A 新封闭 `c2Source` 可证明的签工引用参与；只解析已知结构。只有 source/快照而链接缺损时保缺损与可证明占用，不默认为自由来源；未知字段中的任意同名 ID 不推断为签工。

本单 `statementId` 只用于领用判定排除自己的有效关联，不消掉读取证据。独立签工编辑查已发保护时不能随意用它豁免原已发工资。旧图内部矛盾保持只读；新日常事实或新迁入不得借该兼容口径制造新冲突。

## 5. 迁入/恢复稳定引用

- 现有八表和日志已覆盖配置/签工/关联原行；`graphFingerprint` 比较规则正文、确认状态、note 及软删字段，repeat/恢复不能覆盖后来修改。当前没有证据需要改 `app/lib/migration/payroll-source.ts` 的 P0 字段集。
- 新 `payroll-c2-migration-references.ts` 按 A 封闭 source 校验并提取：原项目/班组/负责人/全成员、`payroll_subject_configs.id`、逐条 `signed_daywork_records.id` 与各行原归属、工资 ID，以及 A 最终采用的源表/物理关联 ID。规则文字仅原文，不递归猜引用。
- 读取新 C2 source 表、`wage_statements.snapshot_json.c2Source`、相关 operation_logs 的 before/after 和 record_id；任一证据独存仍能挡危险撤回。原 P0 subjectConfig/dayworkRecords 保其已知结构和映射，不升级为完整新输出。
- 共享 receipt 聚合当前在 `payroll-a-migration-references.ts:73` 先分派 C1/attendance，再解析 A。B 添加显式 C2/daywork 分派：按 action 校验原正文 canonical/SHA、commandId/actor/project/原目标及 result 引用。已知动作解析失败不能返回 null 跳过；未知非空正文必须拒绝。旧 SQL NULL command_json 只保已有 SQL 关系，不补原文。
- A 的新结果需返回**实际保存**的 recordId/configId/statementId（及 contract 定义的物理源/关联引用）；仅 commandId 或 client draftKey 不能保护真实资料。源码字段和枚举待 A freeze，B 不预写 cast 或猜表名。
- `assertPayrollMigrationRemoval` 的删除前引用并集增加 C2 收集器；互斥仍复用当前纯锁投影与 same-tx 候选。逐条领用若映射到已有原行，按同一占用投影复验；不能因不同项目中有无关 C2 source 而笼统拒绝全部恢复。

## 6. 建议 B 唯一可写清单与首批真红

**新产品文件：**`server/utils/payroll-daywork-facts.ts`、`server/utils/payroll-c2-migration-references.ts`。

**既有产品文件仅 B 写：**`app/lib/payroll/central-source-locks.ts`（共用纯投影），`server/utils/payroll-migration.ts`（删除前/候选检查接线），`server/utils/payroll-a-migration-references.ts`（混合回执分派）。`app/lib/migration/payroll-source.ts` 默认只读，确有复现才向 Root/A 调整所有权。

**B 自有测试建议：**`tests/payroll/daywork-facts.test.ts`、`tests/payroll/c2-source-locks.test.ts`、`tests/payroll/c2-migration-protection.test.ts`；必要独立 helper 为 `tests/helpers/payroll-c2-migration-source.ts`。只按合同建立真实 SQLite/公开服务反例，使用已批准的共同 fixture 接缝；不改 A 的命令测试夹具或重写 Native 功能。

优先顺序：① draft/confirmed/失效原组/NULL/同更新时间正文变化原行保真；② 相邻半工、他单未发领用、已发软删与无签工零成员锁；③ 同库 C1 零考勤和 C2 draft 并发、迁入候选一致；④ 真实迁入后合法配置/签工修改挡恢复；⑤ 依次只余 c2Source、快照、审计、receipt 的引用仍挡删除，另项目恢复可通过。先得到真红，再做最小实现；本准备未宣称任何一项已通过。

**待 A 给出的工程输入：**P2 最终 SHA；daywork/config/facts/occupation DTO 和 parser；新 C2 source 的表名与完整结构；命令 action/结果原目标引用；是否由 A 提取共享 options helper。除此以外无新的用户决策。

