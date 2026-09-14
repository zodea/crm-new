# P2 B 独立复核

复核日期：2026-09-14。基线：`579d9383357fffd2bd87e727dbc21b903a7cb69c`。审查者不是 B 作者。结论：**1 项 P1 阻断，5 个独立真实 SQLite 反例已失败；修复前不能把 B 标为验收完成。**

## Standards

没有发现独立于下述行为问题的硬性规范违规。B 的事务读取没有重新进入同工作区队列，日薪只沿既有受控导出/网络/人员 owner 接缝扩展，没有新增依赖、改生产数据库或扩大到当前 C2 新写入。以下 Spec 问题的根因是迁入候选自己提取一份来源范围，未完整复用日常共享锁所认定的原事实。

## Spec

### [P1] 迁入/恢复候选漏掉已存在的原冻结和来源占用依据

- 文件：`server/utils/payroll-migration.ts:265`、`:272`、`:277`、`:283`，函数 `assertIncomingSources`。
- 规格：P2 实施票第 82 行要求 C2 待确认、主体成员、已发及独立来源互斥；第 84 行明确“现有迁入 C2、其恢复以及 P2 考勤/C1 必须消费同一互斥检查”；第 119 行要求恢复在删除前保护来源，失败整批不变。
- 现状：已发迁入只收头负责人、原 members、冻结 memberWorkerIds/members/allocations，并只用头 month。它遗漏共享 `loadPayrollSourceExclusions` 已采用的冻结 lines、冻结 leaderWorkerId、冻结 month 和已发软删签工链接所证明的人员。来源行又要求整个 work_date 合法才收范围，而日常共享锁对原 `2026-08-99` 待确认签工仍保留明确的 8 月占用。
- 影响：迟到迁入或恢复同一旧 C2 原图时，原图能重新进入已经保存真实 C1 考勤的人员月份。它们不是旧原图内部原本并存的历史冲突，属于本次恢复新增的冲突。读取与写入次序不同会得到不同互斥结果。
- 最小复现：真实 SQLite 保存缺损历史原件，经原字节哈希、preflight/dry-run/import/confirm 接管；先断言普通 attendanceMatrix 的共享锁确实锁住原零成员，再用 prepareMigrationSnapshot 暂撤工资图；随后由公开 executeAttendance 为该成员保存 8 月真实零考勤；恢复原 authority。预期恢复返回 conflict，实际 prepare 成功。测试对意外成功候选先 abort 后断言，避免悬挂事务，所有表及迁移 authority 已断言保持原值。
- 五个参数：`frozen-lines`、`frozen-leader`、`frozen-month`、`deleted-source-link`、`invalid-date-source`。前四例的前置锁是 released-month，第五例是 daywork-occupation；没有冒充新健康工资快照，也没有把坏日期提升为可核算来源。
- 复现文件：`tests/payroll/c1-b-independent-review.test.ts`。最终日志：`incoming-lock-final-red.log`，**5/5 failed，8.08 秒**；失败均为末尾预期 conflict 收到 undefined，前置锁、真实登记、全表不变和 authority 不变断言已通过。
- 修复方向：候选原图与现存原图采用同一稳定的成员、月份及独立来源占用投影；保留原身份映射、已发软删关系和缺损原文。仍应区分本次新引入冲突与同批 repeat/原内部历史冲突，不用全域禁止恢复掩盖遗漏。

## 未发现新问题的范围

- `core-local-source.ts`、`core-migration-request.ts`、人员 owner：实际日薪 missing/NULL/0/481、非法值拒绝、同批 repeat 保留日常更正；当前读取未用姓名或负责人价补个人标准。
- `payroll-attendance-facts.ts`：原逐日物理 ID、原班组、7.51 小数、零行、软删除和文本指纹保留；坏未来日期不会按合法月份过滤消失；隔离原件通过 evidence/diagnostic 定位，没有造可写 attendance ID。
- `payroll-a-migration-references.ts` 与 `payroll-c1-migration-references.ts`：A/C1/attendance 分派按已知动作封闭解析；非 NULL 原正文校验 canonical/SHA，考勤结果保真实 recordId，C1 结果费率修订与全成员来源引用被收集；旧 SQL NULL 没有反推新正文；来源表、冻结 c1Source 和原审计中可证明引用均参与删除前保护；合法无关费率通过对照。
- 上述只是 11 个 B 冻结文件及必要调用接缝的限定复核，不替代 Root 对 A/C 的独立复核、最终全量、类型、构建和浏览器验收。

## 输入与验证记录

- 已读根 AGENTS、`docs/agents/module-review.md`、P2 本地实施票、B 的 owned/validation/contract-response 与必要 A 公共 codec/锁/服务接缝。
- 原 11 文件与 B owned manifest 的 SHA256 全部匹配，见 `review-inputs.json`；审查未修改其产品源码。
- 独立复跑 B 三个文件：`c1-worker-facts`、`attendance-facts`、`c1-migration-protection`，**3 files / 16 tests passed，15.78 秒**，`existing-targeted.log`。因此上述 5 个失败属于已有测试未覆盖的具体边界，不能被原绿例抵消。
- 新独立测试最终 eslint **0 errors / 0 warnings**，`lint-final.log`。仅该文件被审查者新增；未跑全量、typecheck、服务、构建或提交。
- 首次本地测试因 esbuild spawn EPERM 未启动，记录 `incoming-lock-red.log`；后经本地定向执行授权成功运行真实断言。该启动失败不算业务红例。早期排版 lint 失败已修正并复核。
- 本次 gh 只读访问被环境本地代理拒绝，未冒称重新取得线上 Issue；沿 Root 本轮已核对的 #412 与固定本地 P2 票实施依据，没有外发文稿。
- 临时输出仅本目录日志/报告/输入清单；测试使用关闭的内存 SQLite，无落盘业务库，无截图或浏览器资料。交由 Root 在本工作单元正式归档后统一回收本目录，当前为审查交接证据而保留。
