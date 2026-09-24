# P2 C1 独立 Spec 复核（第一轮，2026-09-14）

> **最终结论（2026-09-14 11:54）：已报告的 S1/S1a/S2/S2a 全部修复并独立复验通过，6 条原反例全部绿；当前复核范围无未决 Spec 发现。最终输入以 `final-input-hashes.json` 的 87 个 A/C 文件 SHA 及独立测试 SHA 为准。下方保留逐轮真红到消项的过程，不能把历史发现当作现时未决。浏览器/完整质量门仍由 Root 统一完成。**

固定基线：`579d9383357fffd2bd87e727dbc21b903a7cb69c`，已通过 `git rev-parse` 核实；`git log BASE..HEAD --oneline` 为空。本轮是工作区复核，比较 `git diff BASE -- <A/B owned files>`，并单独读取 owned manifest 中的新文件；不能使用空的 `BASE...HEAD` 冒充已审全部。

范围：A 已冻结 manifest 39 文件中的领域/API/Repository/store 核心；B 原迁入五个反例由另一位独立复核与作者处理，不重复列为本轮发现。C 尚未最终冻结，只记录与公开 store 问题直接相关的调用接缝；完整 UI/输出复核待 Root 给定冻结范围继续。

规格：本地 `docs/research/issue-review-2026-09-11/payroll-tickets/02-central-c1-attendance.md` 承接 #412；已读取 AGENTS、issue-tracker、工资权威页、COMMANDS/READ-MODELS/DATABASE 对应 P2 内容。应用 `code-review-matt` 的独立 Spec 轴，不将 Standards 判断混入。测试新增前读取 vitest 技能。

## 发现 S1（P1）：成功回执之后冷读失败，原命令已被清除

- **规格原文**：P2 票第 99 行：“响应未知、成功后冷读失败、撤权和换页均保存原命令；明确未应用才允许重新读取后重新确认。” 工资页“考勤”第 9 项同时要求保存失败/未知时保护原输入。
- **位置**：`app/lib/payroll/central-pending.ts:47–48` 在 `execute` 成功即 `clear(command)`；`app/lib/payroll/central-repository.ts:14/18` 的 executeAttendance/executeC1 只验证 POST 回执，不执行后续冷读。
- **可失败复现**：新增唯一独占 `tests/payroll/c1-spec-independent.test.ts` 两例，通过公开 store 返回完整成功回执，然后分别使工资/矩阵冷读失败，再创建新 Pinia 模拟冷恢复。要求取得完全相同的原 commandId、原实体/日期、原实发金额与全成员分配，实际均为 `undefined`。成功回执本身可靠，此处发现来自规格明确要求保留至冷读确认，而非把可靠成功误称结果未知。
- **实际影响**：发放已成功但读取中断后，页面刷新无法恢复原次操作，原 300 实发/300+0 分配或 7.51 工时及施工内容失去本地恢复凭据，后续只能读当前状态或重新提交。不能用普通“重试读取”文案代替原键恢复。
- **C 接缝观察，待冻结复核**：`app/composables/usePayrollC1Statement.ts:85–99` 先关闭发放框、清实发输入，再 `load(true)`；load 自行吞读取异常后仍可显示 success。此处需与 A 的保留/确认协议同步，而不是只改提示。
- **建议合同**：可靠成功后保留原操作，只有原目标的冷读确认完成才解除；冷读失败、离开、撤权均可按原操作恢复，恢复不能创造新 commandId。具体 API 由 A/C 唯一作者协商。

验证命令：`pnpm exec vitest run --project unit tests/payroll/c1-spec-independent.test.ts`。准确日志 `pending-red.log`，2026-09-14 11:17，1 文件 2 测试，**2 真失败**，耗时 2.55 秒；失败均是 expected 原命令 / received undefined，不是环境或 setup 失败。仅运行精准测试；未全量、类型、构建、浏览器、起服务或提交。

## 本轮其余结论与保留范围

已审个人档案日薪优先、独立加班配置/60.125 精度、逐成员零行、无记录与真零区分、只月度 100%、前月实发不扣当月、固定工资主体、转组原格、月锁与对侧来源占用、同库事务最后 owner/权限复验、冻结来源/原发放回执互证。除 S1 外未发现可报告的新规格缺陷；未发现主动超出 P2 的新增产品范围。这不是对尚未运行的完整 UI/浏览器/迁移最终集成盖章。

新增文件 ownership：仅本报告、`pending-red.log` 与 `tests/payroll/c1-spec-independent.test.ts`。未修改产品或他人测试；Root 可将精准反例纳入最终集成和交付证据。第一轮报告暂结，待作者修复后保持原断言独立复跑，再审 C 冻结范围。

## 第二轮：S1 修复复核（2026-09-14 11:39）

读取 A 冻结 `a/pending-ack-contract.md`、central-pending、两个 contracts/stores 与作者精准回归测试。修复将原命令与封闭成功回执一起持久保存，显式 `awaiting-read`，并用原 store 公开 load 的对象/内容/读取开始时已存在回执作为确认依据；同目标/身份及 released 配对输出均参与确认，预览和命令前已开始的旧读不能作为确认。未因 helper 变大提出无关重构。

本轮独立复跑 `tests/payroll/c1-spec-independent.test.ts`：原 2 例完全未改，均通过。新增考勤冷实例反例也通过：保存后无须再发一次命令；只读身份和真实 DTO 的复制品均不能清除 pending，原实例的真实合法后读才能解除，并断言 execute 总共只调用 1 次。

尚有 **S1a（P2）配置失效读取误确认**：`app/stores/payroll-c1.ts` 的 acknowledgeC1 在 save-c1-rates 分支只验证 context/scope。真实 `server/utils/payroll-c1-service.ts` config 在原项目从 source.projects 消失时返回原 scope、空 options/rates 和 `readonlyReasons=['当前工资项目不可用']`，而 context.readonly 仍只由 payroll:write 决定。这份没有读到任何原标准的失效结果可以清除原配置输入、物理修订回执和恢复入口，不符合 S1 修复合同“原目标后读完整确认”。建议配置 ack 至少拒绝非空 readonlyReasons 及失效项目；不是要求当前标准永远不得合法变更。

新增公开 store 反例第 50 行准确模拟该服务返回，`acknowledgeC1` 应拒绝且 pending 保留，实际未抛错并清除。日志 `pending-ack-independent.log`：4 例 **3 绿 / 1 真红**，11:39:24，2.05 秒。没有通过伪造未知 result 或跳过 store public load 建造失败；成功回执与读取时序均合法，问题是将不可用空读当完整确认。

结论：原 S1 的“成功即 clear”已修；完整闭合仍待 S1a 修复和 C 用户调用接缝最终集成。未运行完整/类型/构建/浏览器，未提交，C 尚未正式冻结。

## 第三轮：S1a 消项与 C 冻结范围（2026-09-14 11:46）

Root 仅在 C1 标准确认分支增加服务端 `readonlyReasons` 检查；失效项目由服务明确产生该原因。原四例独立反例没有弱化，全部通过，**S1a 已消项**。

C 输入为 `c/owned-files.json` 48 文件；A 39 + C 48 共 87 个复核输入实际 SHA-256 记录于 `third-input-hashes.json`。该文件标明是 S2 修复前版本，不能用于对随后源码盖章。

已核 C 的新旧工资格式路由、首次无量 C1 草稿、负责人实际班组、成员变更后来源预览、个人日薪/加班输入与 0/空值区别、7.51/60.125 完整显示、原格 Map 保稿和关闭确认、同路径/KeepAlive 读取目标、原工资/新 draftKey 来源往返、后读失败保留原实发窗口与分配、ack 后才 changed/清稿/关窗，以及仅以同一冻结 document 生成工资/考勤双表。新草稿返回用原范围矩阵、原物理记录/人员/日期证明，不再依赖尚不存在的已存工资成员。未发现其它可报告的新增规格错误或 P2 范围扩张；实际五宽滚动、焦点和打印外观仍由 Root 独占浏览器验收，不用本次代码审查代验。

### S2（P2）：考勤应用页签关闭或刷新仍会丢弃未提交原格

- **规格原文**：工资页面“考勤”第 9 项：“换范围、切单元格或离开时保护未保存输入。”P2 票“界面状态”要求“矩阵单元格保存失败保稿，换单元格或范围不偷偷丢稿”。既有 `useTabCloseGuard` 明确停用的 KeepAlive 页面也必须保护未保存输入。
- **位置**：`app/composables/useCentralAttendance.ts` 的 `cellDrafts` 仅存页面实例 Map，只有 beforeunload 提示，没有调用现有应用页签 close guard。`PayrollAttendanceCellDialog.close()` 的确认只拦自身 Dialog，应用页签关闭/刷新不会调用它。
- **公开运行反例**：`tests/payroll/c1-spec-independent.test.ts:91` 挂载实际 composable 和真实 Pinia `useTabsStore`，打开考勤页签，编辑原格为 7.51 及施工内容，kit.confirm 预置取消；调用真实 `tabs.requestClose(key)` 应拒绝关闭并保原格，实际返回 true。断言失败发生在正常运行行为，不是缺全局或编译失败。实际应用随后卸载实例，未提交 Map 随之丢失。用同一测试保留刷新缓存不得失效的后续断言。
- **结果**：`final-c-independent.log`，11:46:17，2.18 秒，5 例 **4 绿 / 1 真红**。S1/S1a 与原恢复保护已绿，唯一当前阻断为 S2。
- **处理**：已通知 Root/C 仅接现有 useTabCloseGuard，保护仍活跃或 KeepAlive 的原格输入及处理中的命令；不要求为已由缓存保稿的普通来源跳转另造确认流程。

## 第四轮：S2 原关闭保护已修，批量关闭取消的确认副作用待修（11:52）

C 已在同一文件接 useTabCloseGuard，并追踪 openedCells 的 pending，读取或关闭确认等待期间有新输入/命令则不得使用旧确认。原 5 例完全不改独立复跑全绿，原 S2 单页签关闭与刷新取消路径已修。

复读新增 guard 发现其接受确认后立即清 cellDrafts/openedCells 与计数，但真实 `app/stores/tabs.ts` requestChange 先询问全部目标，任一后续页签取消则整个批量关闭取消。guard 不应在决定阶段销毁输入。该具体新问题先向 Root 报告后，才添加第 6 个公开反例（未修改原五例）：真实考勤页签原格 7.51/施工内容、考勤确认 true，后续另一个工资草稿 close guard 返回 false；`tabs.requestCloseEvery()` 正确返回 false 且考勤页签仍存在，但原 cellDraft 变 undefined。不是模拟私有 guard，也不是空源的预期错误。

准确日志 `tab-guard-aggregate-red.log`，11:52:00，7.68 秒，6 例 **5 绿 / 1 真红**。新阻断记为 **S2a（P2）**，同一未保存输入保护规格；建议仅移除 guard 接受阶段的 Map 清理副作用，让真正关闭/刷新导致的页面卸载释放实例。等待确认期间版本/pending 检查保留。未改产品，未跑浏览器/其它套件。

## 最终独立消项（2026-09-14 11:54）

C 最后只移除 guard 接受时提前清理原稿的副作用，保留原 pending/进行中操作/输入版本复验，真正关闭或刷新后的实例卸载自然释放 Map。已复读该文件最终实现；没有要求新增产品范围或改变已经确认的业务决定。

独立测试全部保持原断言，精准运行 `pnpm exec vitest run --project unit tests/payroll/c1-spec-independent.test.ts`：**1 文件 / 6 测试全部通过**，11:54:28，2.09 秒；日志 `final-independent-green.log`。该轮一次覆盖成功后冷读失败冷恢复、失效配置不得解除、真实后读/原身份及伪 DTO 拒绝、单页签关闭/刷新取消保稿、批量关闭被另一页签取消后保稿。精准测试文件 eslint 0 错误（`independent-lint-final.log`）。未重跑作者其它套件，未跑浏览器、全量、类型、构建或提交。

最终 87 个复核输入及独立测试 SHA：`final-input-hashes.json`，该清单 SHA-256 为 `52fb4b58a75d5f3163d9998173d6a98cd36a200b0deab333dbabae39bd5d900d`。其中 `app/composables/useCentralAttendance.ts` 为 `6592a93055b31e4528e29365f068b76608e99d8fdc020855a068b44d4abee310`；C1 store 为 `7b50ce081d3485b9610ba2bb60225e97fa8f9e88a3bb7052510a2e98db889461`。

与第三轮输入相比，另有 PayrollC1ConfigScreen、C1 store、考勤/标准组件测试及 E2E 来源夹具的已知整合改动；已复读最终匹配状态/只读原因门禁和相关断言，未发现新增 Spec 缺陷。最终结论为 **0 未决 Spec 发现**；此前 2 处主要问题及各自修复接缝问题均已证据消项。B 的独立迁入保护复核、Root 的真实浏览器和完整质量门属于各自验证，不能由此文自动代替。
