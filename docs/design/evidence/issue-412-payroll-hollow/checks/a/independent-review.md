# P6 非作者 Standards / Spec 复核

审查快照：2026-09-15 04:01 +08:00。固定基线 `e344a5444cd52bfeb65e78b031912d5241666fc0`。`git rev-parse` 已核实，`git log <base>..HEAD` 为空；`git diff <base>...HEAD` 也为空，实际审查按 Root 明确要求采用 `git diff <base>` 加当前未跟踪 P6 文件。工作区尚未提交，以下不构成最终整票通过。

末端补记：2026-09-15 04:18 +08:00。第二户返回 P2 已由 C 修复，并由本代理独立复验关闭；后续补录月份及首次空稿 503 是本代理作者修复，单列验证，不冒充非作者覆盖。

使用 `code-review-matt` 的 Standards / Spec 两轴，另读取 Vue 规范。现有四个代理槽位均在运行，未再创建嵌套审查代理；本审查按两轴分别记录，不把作者自验计入独立覆盖。只读复核 #412 当前评论、本地 P6 票、DATABASE / COMMANDS / READ-MODELS、工资/工程量页面蓝本及 Markdown 指南；没有外发评论或修改业务规则。

## Standards

**无新增可证实规范阻断。** Root 新工资三表与 C 页面/状态模块使用现有中央 Repository、受限命令、共同事务、Vue Composition API、现有整页和 Kit 交互原语；来源数量未保存工资金额，工资采用没有被包装为新增现金。零、空值、未检查和未完整依据有独立表示。八张领域表的名称、列、追加语义及工资/来源回执归属与 DATABASE 当前章节一致；不重复列本代理编写的五表实现为独立代码审批。

未报告可由工具自动检查的格式问题，也未把抽象程度等代码气味当作硬违规。未新增生产依赖。`nuxt.config.ts` 只把既有 sql.js WASM 纳入 Nitro tracing；实测构建目录自身的 sql.js 能初始化可丢弃内存库并执行 `SELECT sqlite_version()`，返回 `3.49.1`。产物 `sql-wasm.wasm` 为 659730 字节，SHA256 `438C88F666DC054CE4E9395F80FE9DB4218B1A3C379960454880F048A7898AED`，与既有依赖完全相同。这只证明该构建产物可加载 WASM，未重跑或替代最终构建、生产部署验收。

## Spec

**原已复现 P2 已关闭：同层同分项第二户的空鼓入口带回第一户完成焦点。当前已审非作者范围无未决高置信问题。**

- 原问题位置：`app/components/payroll/PayrollAFloorReview.vue:15` 把整个楼层×分项格的焦点设置为 `completed[0]?.completionId`；原第 59 行同格每个原户链接都用 `cell.focus`。
- 规格：P6“点第二楼层/第二户往返保持自己的定位”，以及“返回原工资或未保存 draftKey，保项目/月/负责人/分项/原楼层及输入”。
- 复现：复用真实公开来源 fixture，在同一楼层追加 102 室，经公开命令建同一分项原责任、阶段完成及空鼓检查；真实工资 `aForm` 返回两户事实。挂载实际 `PayrollAFloorReview`，102 室链接确实进入 102 室记录，但嵌套 `payrollReturnTo.focus` 是 101 室完成 ID。期望 `qty_done_mu1nzzp3_15`，实际 `qty_done_mu1nzznh_s`（每次生成 ID 不同）。
- 历史红例：`npm test -- --config .tmp/remaining-issues-20260910/payroll-p6-central/a/review.vitest.config.ts --reporter=dot`；2026-09-15 03:57:31，1 项失败，4.83 秒。现已由 C 迁为正式 `tests/components/PayrollAFloorSourceFocus.test.ts`，临时实验与配置已回收，不再作为运行入口。
- 修复边界：按点击原户及原责任/房间/分项匹配其可证明完成事实；不能借同格首行猜焦点。没有匹配时保留可读来源且不假造完成定位。原文件 SHA256：`383ABDE24C02D4F1A0987DEB49EFCC4AF8D579E55CFCBCE40EEE0EE86615EEAD`。
- 非作者复验：`npm test -- --project component tests/components/PayrollAFloorSourceFocus.test.ts tests/components/PayrollAFloorReview.test.ts tests/components/PayrollHollowSourceReturn.test.ts --reporter=dot`，2026-09-15 04:04:53，3 文件 / 5 项通过，6.42 秒。覆盖第二户自己的完成焦点，以及缺少或存在多条完成时不猜焦点。当前组件 SHA256：`F42A28B0F2D6C348392AE2EDEDBC009F4FF747996E91D3F6C8F1FDB6483D11E4`。

其余已审接缝未发现新的高置信阻断：人工启动只绑定具体已存单；19−4、450 扣款、550 实际现金分别守恒；A 后月处理抵扣与 C1/C2 逐期口径分开；0 实发只开放完整正数扣款恰好抵完分支；原键恢复、迟到读、撤权与成功后读取失败保持 pending；记录/修订整页、整改小动作、错误焦点及原户来源权限沿原合同。持续启动、部分采用和已处理记录新增处数仍按票保留 local grill，不作为已完成业务。

## 本次独立运行证据

| 验证 | 结果 | 适用范围 |
| --- | --- | --- |
| `hollow-deduction-calculation / hollow-deduction-command / central-hollow-deduction / central-hollow-adjustments`；`payroll-hollow-pending / quantity-hollow-pending / quantity-hollow-startup`；`quantity/hollow-navigation` | 8 文件、29 项通过，15.07 秒 | Root 工资计算与公开命令/P4 守恒、C 原提交和冷恢复/导航 |
| `PayrollHollowConfig / PayrollHollowStart / PayrollHollowSourceReturn / PayrollHollowZeroRelease / QuantityHollowFormState / QuantityHollowRectification` | 6 文件、12 项通过，22.10 秒 | C 组件与真实服务结合的失败保稿、确认取消、零额、权限返回和焦点 |
| `PayrollAFloorSourceFocus / PayrollAFloorReview / PayrollHollowSourceReturn` | 3 文件、5 项通过，6.42 秒 | C 修复第二户完成焦点的正式非作者末端复验 |
| 构建目录 sql.js 直接初始化及 WASM 哈希对照 | 通过 | 构建资源可运行；没有重新执行 build |

本轮未跑全量、类型检查或构建，没有创建产品 PDF。屏幕尺寸、实际横滚和逐页打印由 Root/C 集成浏览器及页图检查负责，组件断言不代替实图。

## 非作者覆盖范围及末端复核

- 本代理是 quantity hollow 原生合同/五表/proof/service/read、C1/C2 空鼓接入与零额、A 迁入价格、`central-hollow-processed-original/proof` 的作者；后续又作者修复 `payroll-hollow-read.ts` 的月份截断，以及 A 空稿的费用早期返回、空鼓月份和 codec 门禁。这些实现及共同文件中本代理的补丁**不计独立覆盖**。本轮五表只与 Root 权威文档交叉核对。Root/B 应继续独立复核上述作者代码。
- 独立覆盖 Root 的工资扣款配置/启动/采用/当前读取/P4 接线、C 新 UI 与 store/composable/导航工作页恢复，以及其权威 MD。B 原图传输只检查接缝：原 JSON/摘要与 typed 映射分离、来源五表与工资三表完整运输、实际同事务引用；没有把其仍在变化的第三次原图末端判为通过。
- 第二户焦点已闭环。提交前仍按各代理职责复核 B 第三次原图 root/suffix、命令三元组/价格系列映射、处理前缀别名及恢复保护最终版本；本代理最新作者修复由其他代理复验；最终工资原件和 WASM 所属构建与产品 SHA 由 Root 绑定。现快照不能替代这些末端复验。
- 审查时 Root/C 运行文件快照 SHA256：`payroll-hollow-read.ts` = `94DEEEF1AC957EA2AF5ADDBB82F585E020530E9FD229C3AA7AF51D6D02201FCE`；`payroll-hollow-service.ts` = `7513130A7918259D863FBE8EF06D15DFD4FF7AEECAF1258F05A5AE1269CB396B`；`quantity-hollow.ts` = `94951D60C08B86B1134C3E0993D58DE19EB61B0D05B508955B5A6BDEF84E31ED`；`payroll-hollow.ts` = `67428B3B0AACC3668A37D277FDA4E6CE9DF18CCCC96A1281B6210755B84245D3`。

## 作者后续窄修证据（不计独立审查）

- 月份 P1：`tests/payroll/central-hollow-month-order-review.test.ts` 原 C1 红例 1 项失败 / 3.02 秒；补 A/C2 后 3 项红。仅 `server/utils/payroll-hollow-read.ts` 对 `previousProcessed` 加 `adoption.month <= month`，原采用集合仍完整用于防重扣，不改原冻结。随后 `central-hollow-month-order-review / central-hollow-deduction / central-hollow-adjustments / central-hollow-processed-proof / central-c-hollow` 5 文件 / 17 项通过，11.70 秒，2 文件精确 lint 通过。Root 已转达 B 非作者月份三格式及 prefix 共 20 项通过。当前读取文件 SHA256：`276CE5326331C430329696D7CD210F2989DCDC433DD6C91A7D9CFDA1160FE7D6`。
- 首次空稿 503：正式 `tests/payroll/central-a-hollow-incomplete-form.test.ts`，真实公开 `aForm` 未选负责人，首红为 SQLite 绑定 `undefined`，1 项失败 / 2.66 秒。原因是费用读取在主体未选全时仍以非空断言调用同簿已付 SQL；复用 `unproven` 费用分支后公开服务转绿。新增真实 HTTP/Repository 后又红于 A codec 错拒 `unavailable + scope:null`；现只允许确实未选全、不可启动的未知主体，空月份在 hollow DTO 规范为 null，原 draft 原样保留。完整主体、available 或可启动伪装仍拒绝。
- 503 最终关联：`central-a-hollow-incomplete-form / central-a-http / central-hollow-http` 3 文件 / 4 项通过，3.34 秒；`central-a-hollow-incomplete-form / central-a-fees-integrity / central-a-fees-codec / central-a-diagnostic-location / central-a-book-history-gaps / central-a-fee-adjustments` 6 文件 / 44 项通过，8.30 秒（2026-09-15 04:16:39）。四个精确变更文件 lint 通过。空稿、缺负责人、清空月份均经真实 HTTP 返回 200 并严格解码；补齐同一原稿恢复 1000 元及 15 处未处理事实。源码已冻结，未重跑 build/full/typecheck，后续真实浏览器和非作者复验由 Root/C 协调。

以上红绿输出来自本任务实际工具执行结果；本目录只保留本报告作为最小证据汇总，没有另造原始日志副本或失败调查包。

## 已迁正式实验的回收记录

Root 授权在正式组件回归落地后回收两个旧实验。2026-09-15 已逐级检查解析路径、重解析点、完整进程命令行、独占读取和哈希后，用 Windows 回收站处理下列精确文件；未永久删除，未触及其他文件，可从当前用户回收站恢复。总计 3714 字节。

| 原路径（相对此 `a` 目录） | 字节 | SHA256 |
| --- | ---: | --- |
| `review-reproduction.test.ts` | 3273 | `A962D3AA2FCB5F6A2EA53FBA9AA6FF7261296386DDC54EBC4FD72F03C29B69E4` |
| `review.vitest.config.ts` | 441 | `FB1DDEC751F79165EEEF4E142B49F59B3F5EAF0FE554A11A4C7771618A42C281` |

结论：本次已审非作者范围 Standards 0 项阻断、Spec 0 项未决；原第二户返回 P2 已正式独立复验关闭。作者后续修复、变化中的迁入末端及最终构建不冒充本次独立通过，未扩大到 P7、生产持久化或 #412 全域完成。
