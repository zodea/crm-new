# P6 非作者独立复核

固定基线：`e344a5444cd52bfeb65e78b031912d5241666fc0`。`git log <base>..HEAD` 为空；本轮为工作树增量，以 `git diff <base> -- <明确路径>` 配合新增未跟踪文件全文读取。未运行全量、构建或提交。

规格：[`docs/research/issue-review-2026-09-11/payroll-tickets/06-central-hollow-and-deductions.md`](https://github.com/zodea/crm-new/blob/212a1cb586af9396f4e4a9dbee50eeb7333e0cf5/docs/research/issue-review-2026-09-11/payroll-tickets/06-central-hollow-and-deductions.md)，以及该票承接的 P4/P5 已定冻结、实际收付与同源防重扣边界。按 code-review-matt 两轴独立记录；Root/A 另做并行复核，不重复创建审查代理。

范围：A 的 quantity hollow 五表合同、来源捕获/三个命令/原件回放、C1/C2 source V2 与 native 发放/输出、`central-hollow-processed-{original,proof}.ts`、A 单价 provider 接入和 `payroll-migrated-prices.ts`；Root 的 `payroll-hollow-{read,config,service,processed}.ts`、扣款金额组合、P4 更正/后月关联与新增 HTTP 入口。

排除：B 自写迁移、flat proof 包、mapper、数量迁入 loader、原物理图验证、恢复实现及其共享小接缝，不作为独立通过结论；浏览器、输出文件与完整集成尚由 Root/C 验收。

## Standards

无新增高置信硬性违规。来源命令复用既有事务，提交前再核 session/权限与来源；金额、原件证明、源读取及命令写入有明确分工。未把可由 lint/type 检出的事项计为审查 finding。

## Spec

### 已关闭 P1：补录早月 C1 可成功实发，但错误引用未来扣款采用导致冷输出不可用

- 规格第 9、64、72 行要求实际发放与原扣款依据一起冻结并保持可用输出；当前 C1 按月考勤入口允许补录合法历史月份。
- 原 `server/utils/payroll-hollow-read.ts` 收集同主体全部 `adoptions` 为 `previousProcessed`，未按本工资月份截断。`app/lib/payroll/central-hollow-processed-proof.ts:84` 明确拒绝 `adoption.month > snapshot.month`，两侧范围不一致。
- 真实公开服务：8 月检查 19/整改 4，C1 启动 450 并实发 550；再补录 7 月真实一天考勤，7 月 form 为 1000 且 `canRelease=true`，save/check/release 均成功；随后新 service 冷读 7 月输出返回 `unavailable`。
- 正式反例：`tests/payroll/central-hollow-month-order-review.test.ts`；原红日志 `b/independent-month-order.log`，1 项失败，16.25 秒。
- A 窄修 `server/utils/payroll-hollow-read.ts:64`，只对 `previousProcessed` 加 `adoption.month <= month`；原采用查找仍核全集，避免早月补录释放原记录后重复扣款。未修改原冻结，也未放宽 proof。
- B 非作者复验 C1/C2 先发 8 月 550、再补录 7 月 1000、冷输出可用且 8 月原件不变；A 早月处理额为 0，9 月仍计原处理额 450 且原记录已处理。连同 6 项已处理前缀证明和 C1 迁移保护，`npm test -- tests/payroll/c1-migration-protection.test.ts tests/payroll/central-hollow-month-order-review.test.ts tests/payroll/central-hollow-processed-proof.test.ts` 共 3 文件 / 20 项通过，14.53 秒，日志 `b/migration-month-independent-green.log`。本 finding 关闭。

## 排除与待处理记录

曾检查删原工资 members/lines/allocations 对后月原件的影响。该试验的首个期待已经发现原工资自身仍可按 source/frozen/receipt 输出；基线 A provenance 本就不核这三张可见子表，所以不能冒称本轮新增 P6 prefix 绕过。Root 已明确不扩大本票，该 3 项错误前提测试已原字节移出正式 tests，暂存 `b/original-subset-review.rejected.ts`，SHA-256 移动前后相同；原失败日志仅作调查记录，不是当前待修失败。

源五表因果链、原记录修订/整改、防分叉与完整回执集合；人工启动而非自动扣款；0/null、只读权限、C 格式零净额；P4 更正确认与实际现金分离、历史前缀不取未来 head；原价 JSON 不回写的 provider 接缝，本轮未发现其他高置信差错。

截至此记录：Standards 0；Spec 1 个 P1 已由非作者复验关闭，无其余待修 finding。局部 grill、P7、浏览器及生产等级没有升格。

## A 首次不完整表单 503 修复的最终非作者复验

Root 指定的最后范围为 `server/utils/payroll-a-fees-read.ts`、`server/utils/payroll-a-hollow-read.ts`、`app/lib/payroll/central-a-codec.ts` 及 A 新增的 `tests/payroll/central-a-hollow-incomplete-form.test.ts`。B 只读检查，未改 runtime 或测试。

- `payroll-a-fees-read.ts:56` 将缺项目、缺负责人或缺月份返回原稿、未证明费用用途、未知金额与不可保存/核对/发放诊断，不再把未选身份传给完整费用读取。
- `payroll-a-hollow-read.ts:14` 只在项目、负责人和用途完整时构造 scope；空月份表达为 null，由已有 unavailable 分支承接。
- `central-a-codec.ts:241` 允许不完整 scope=null 的 unavailable 读取，同时要求目标、净额一致、不可启动；完整主体不能伪装这个分支，available 或 canStart 的伪造仍拒绝。现有完整工资和冻结 proof 没有为缺项分支放宽。
- 独立执行 `npm test -- tests/payroll/central-a-hollow-incomplete-form.test.ts tests/components/PayrollAFormState.test.ts`，2 文件 / 9 项通过，11.13 秒，原始日志 `b/incomplete-a-form-independent-green.log`。真实 SQLite 来源经 HTTP/Repository 验证空稿、未选负责人、清空月份；补全恢复 1000 和未整改 15 处；表单原提交、切换与冷返回行为保持。

结论：该 A 修复非作者复验通过，无新增高置信 finding。只增加这一份本次运行日志，不重复归档 A 的全部关联回归；月序修复证据仍为本记录上面的 `independent-month-order.log` 与 `migration-month-independent-green.log`。完整集成、最终浏览器与固定提交由 Root/C 另行记录。

## 全量后迁移兼容跟进（作者修复，非独立审查结论）

Root 的完整测试发现旧 local source SQL 替身与两处新增 schema 探测空格不一致，以及 C2 恢复扫描仍只接受旧 source V1。B 统一两处只读 SQL 为既有写法；C1/C2 恢复扫描改用严格版本联合 guard，保持坏正文/未知字段拒绝，未削弱原恢复断言。C1 另补现有案例的直接引用集合检查，旧 guard 原红 3 项，避免把错误拒绝冒称引用保护。

修复初轮 `b/full-migration-followup-first.log` 为 4 文件 / 47 项通过、22.59 秒；正确 C1 反例原红为 `b/c1-versioned-reference-red-final.log`，6.66 秒（之前 `c1-versioned-reference-red.log` 是误用不存在的 form 字段，已移除该错误断言，不算真实红例）；最终 C1 全部 11 项在上面 20 项定向中通过。`b/full-migration-followup-lint.log`：精确 5 文件 ESLint 退出 0。
