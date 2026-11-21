# 工资、考勤与点工

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

工资与其他模块的交界另见 [工程量](quantity.md)、[班组／工人](crew-worker.md)、[财务](finance.md)、[目标成本](target-cost.md)。P5／P6／P7 登记与运行参考审计位于 [文档契约与工程工具](documentation-tooling.md)。先读现有条件、动作与业务断言，再判断是否需要改写或补测。

## 调整、实际收付与冲销

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/payroll-actual-month-scope.spec.ts](../../../e2e/payroll-actual-month-scope.spec.ts) | Playwright E2E | 跨月退款范围金额、个人未知说明与完整详情往返 |
| [e2e/payroll-adjustments-central.spec.ts](../../../e2e/payroll-adjustments-central.spec.ts) | Playwright E2E | 原工资独立更正、真退40、后月处理60与跨页同源冷读 |
| [tests/components/PayrollActualPaymentFormState.test.ts](../../../tests/components/PayrollActualPaymentFormState.test.ts) | 组件（jsdom） | 待退差额不会默认成实际已退，取消实际确认仍保人员金额 |
| [tests/components/PayrollActualReferencePicker.test.ts](../../../tests/components/PayrollActualReferencePicker.test.ts) | 组件（jsdom） | 只从已读真实收付选择引用，显示日期类别金额和原单主体；选择不创建现金 |
| [tests/components/PayrollAdjustmentDetailScreen.test.ts](../../../tests/components/PayrollAdjustmentDetailScreen.test.ts) | 组件（jsdom） | 续更正本次加40与原链累计减60独立展示，并可回读前序和新旧依据 |
| [tests/components/PayrollAdjustmentFormState.test.ts](../../../tests/components/PayrollAdjustmentFormState.test.ts) | 组件（jsdom） | 成功后读失败保留原更正与原键，明确恢复后才关页签 |
| [tests/components/PayrollRecordingReversalEntry.test.ts](../../../tests/components/PayrollRecordingReversalEntry.test.ts) | 组件（jsdom） | 实际台账可以引用错误冲销追加纠错，保持原引用和来源返回 |
| [tests/components/PayrollReleaseAdjustmentSelection.test.ts](../../../tests/components/PayrollReleaseAdjustmentSelection.test.ts) | 组件（jsdom） | 后续工资核算变化重读候选，保留处理金额直到明确采用新依据 |
| [tests/payroll/adjustment-navigation-output.test.ts](../../../tests/payroll/adjustment-navigation-output.test.ts) | 单元／服务／状态 | 实际事实按原引用分流，工资筛选与预算/人员返回保留，外站与错来源拒绝 |
| [tests/payroll/central-actual-history.test.ts](../../../tests/payroll/central-actual-history.test.ts) | 单元／服务／状态 | 历史总额、个人分配与新写依据分别判断：缺个人分配仍保留可证300，不能均分或开放更正 |
| [tests/payroll/central-actual-month-scope.test.ts](../../../tests/payroll/central-actual-month-scope.test.ts) | 单元／服务／状态 | 按文件中的测试场景定位 |
| [tests/payroll/central-actual-payments.test.ts](../../../tests/payroll/central-actual-payments.test.ts) | 单元／服务／状态 | 核减100后实际退回40，只减少一次实际现金并保留60待处理和原签名 |
| [tests/payroll/central-actual-reversal.test.ts](../../../tests/payroll/central-actual-reversal.test.ts) | 单元／服务／状态 | 有证据的错误退款记录以独立冲销抵销，恢复原待处理余额；不改旧退款也不冒充新现金 |
| [tests/payroll/central-actual-supplement.test.ts](../../../tests/payroll/central-actual-supplement.test.ts) | 单元／服务／状态 | 确认核增100不会提前增加支出，实际补100才净1100，重复补发和反向伪退款均拒绝 |
| [tests/payroll/central-adjustment-chain.test.ts](../../../tests/payroll/central-adjustment-chain.test.ts) | 单元／服务／状态 | 先存的草稿后确认时，后续更正与工资处理均采用唯一链末而非建稿顺序 |
| [tests/payroll/central-adjustment-imported-integrity.test.ts](../../../tests/payroll/central-adjustment-imported-integrity.test.ts) | 单元／服务／状态 | 原实际事件新增矛盾分配后，缓存不得继续给完整净额 |
| [tests/payroll/central-adjustment-imported-runtime.test.ts](../../../tests/payroll/central-adjustment-imported-runtime.test.ts) | 单元／服务／状态 | 迁入完整原工资、更正及退款后继续处理剩余60，原始JSON和签收1000不变 |
| [tests/payroll/central-adjustment-migrated-mapping.test.ts](../../../tests/payroll/central-adjustment-migrated-mapping.test.ts) | 单元／服务／状态 | 公开发放的 A 类更正：归属、范围与价格完整映射，正文不改，缺身份拒绝 |
| [tests/payroll/central-adjustment-migration.test.ts](../../../tests/payroll/central-adjustment-migration.test.ts) | 单元／服务／状态 | 真实更正保存、确认及退款后重复迁入保原事实，无关原图可恢复，相关恢复整批拒绝 |
| [tests/payroll/central-adjustment-provenance.test.ts](../../../tests/payroll/central-adjustment-provenance.test.ts) | 单元／服务／状态 | 已确认更正正文与确认冻结不一致时阻止新处理，不能按损坏后的数字继续补退 |
| [tests/payroll/central-adjustment-scope.test.ts](../../../tests/payroll/central-adjustment-scope.test.ts) | 单元／服务／状态 | 原工资及收付稳定身份不属于指定项目时，受控读取拒绝改用另一项目内容 |
| [tests/payroll/central-adjustment-transactions.test.ts](../../../tests/payroll/central-adjustment-transactions.test.ts) | 单元／服务／状态 | 两个窗口争用同一剩余，只有一笔退款及其分配、余额处理和回执成功 |
| [tests/payroll/central-adjustment-transport.test.ts](../../../tests/payroll/central-adjustment-transport.test.ts) | 单元／服务／状态 | 真实 P4 SQLite 原图迁入完整中央工资表与回执审计，正文逐字保留且重复接管不覆盖 |
| [tests/payroll/central-adjustments-http.test.ts](../../../tests/payroll/central-adjustments-http.test.ts) | 单元／服务／状态 | 真实 HTTP 完成独立更正、退40及错记冲销，所有有符号实额以到分十进制传输 |
| [tests/payroll/central-adjustments.test.ts](../../../tests/payroll/central-adjustments.test.ts) | 单元／服务／状态 | 核减原已发C2的一百元只产生待处理，不改变原签名或实际一千元 |
| [tests/payroll/central-release-adjustments.test.ts](../../../tests/payroll/central-release-adjustments.test.ts) | 单元／服务／状态 | 核减100先退40再随次月实发940处理60，两月实际1900且不把抵扣另算退款 |
| [tests/payroll/workbook-actual-snapshot.test.ts](../../../tests/payroll/workbook-actual-snapshot.test.ts) | 单元／服务／状态 | 已保存目录固定当时实际账；后来真实退款只进入新目录版本且旧预览拒绝提交 |
| [tests/stores/payroll-adjustments-central.test.ts](../../../tests/stores/payroll-adjustments-central.test.ts) | 单元／服务／状态 | 退款已成功但响应丢失时，冷实例只重发原命令，后续合法冲销不妨碍确认原成功 |

## 公共读写、来源、发放与恢复

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/payroll-central.spec.ts](../../../e2e/payroll-central.spec.ts) | Playwright E2E | 工资真实八表迁入、完整发放记录、独立来源、缺坏快照与退休历史只读往返 |
| [e2e/payroll-context-retirement.spec.ts](../../../e2e/payroll-context-retirement.spec.ts) | Playwright E2E | 工资中央来源、筛选与退役写入口 |
| [e2e/payroll-frozen-location.spec.ts](../../../e2e/payroll-frozen-location.spec.ts) | Playwright E2E | 真实冻结楼层范围在预览、XLSX及分页打印一致，不补断层或改原金额 |
| [e2e/payroll-statement-detail.spec.ts](../../../e2e/payroll-statement-detail.spec.ts) | Playwright E2E | 工资历史详情的失效边界 |
| [tests/components/PaymentPayrollSection.test.ts](../../../tests/components/PaymentPayrollSection.test.ts) | 组件（jsdom） | 关联工资：付款页中的工资区块 |
| [tests/components/PayrollCentralBoundary.test.ts](../../../tests/components/PayrollCentralBoundary.test.ts) | 组件（jsdom） | 工资浏览器与桌面入口边界 |
| [tests/components/PayrollCentralRead.test.ts](../../../tests/components/PayrollCentralRead.test.ts) | 组件（jsdom） | 工资中央只读资料 |
| [tests/components/PayrollFeeEditors.test.ts](../../../tests/components/PayrollFeeEditors.test.ts) | 组件（jsdom） | 没有工程量读取权限仍可选择工资基数，不能凭格子ID造原户链接 |
| [tests/components/PayrollHostSection.test.ts](../../../tests/components/PayrollHostSection.test.ts) | 组件（jsdom） | 个人0与整单1000分列，来源链接保原档案查询，表可获得键盘焦点 |
| [tests/components/PayrollNavigation.test.ts](../../../tests/components/PayrollNavigation.test.ts) | 组件（jsdom） | 工资跨页筛选恢复 |
| [tests/components/PayrollStatementDetailTables.test.ts](../../../tests/components/PayrollStatementDetailTables.test.ts) | 组件（jsdom） | payroll statement dedicated detail tables |
| [tests/components/PayrollStatementTable.test.ts](../../../tests/components/PayrollStatementTable.test.ts) | 组件（jsdom） | 工资单列表刷新 |
| [tests/components/PayrollWorkbench.test.ts](../../../tests/components/PayrollWorkbench.test.ts) | 组件（jsdom） | payroll workbench components |
| [tests/migration/payroll-central-source.test.ts](../../../tests/migration/payroll-central-source.test.ts) | 单元／服务／状态 | 中央工资只剩原审计的损坏旧库仍运输有项目归属的原文，不因当前表为空静默丢失 |
| [tests/migration/payroll-source.test.ts](../../../tests/migration/payroll-source.test.ts) | 单元／服务／状态 | 公开旧库读取包含八表、独立未领用来源和冻结原文，不因没有工资漏项目 |
| [tests/payroll/central-history-integrity.test.ts](../../../tests/payroll/central-history-integrity.test.ts) | 单元／服务／状态 | 工资中央历史原值与冻结完整性 |
| [tests/payroll/central-host-http.test.ts](../../../tests/payroll/central-host-http.test.ts) | 单元／服务／状态 | 真实三个详情HTTP接口受控读取同一退40后960，撤工资权限不返回来源或姓名 |
| [tests/payroll/central-host-read.test.ts](../../../tests/payroll/central-host-read.test.ts) | 单元／服务／状态 | 项目、原班组及个人冷读同一1000实发与退40，更正不另计现金；零成员与后来转组保留 |
| [tests/payroll/central-http.test.ts](../../../tests/payroll/central-http.test.ts) | 单元／服务／状态 | 公开迁入后经真实 HTTP/Repository 读冻结姓名、零分配、完整快照与无工资的独立来源 |
| [tests/payroll/central-navigation.test.ts](../../../tests/payroll/central-navigation.test.ts) | 单元／服务／状态 | 中央工资阅读往返 |
| [tests/payroll/central-read.test.ts](../../../tests/payroll/central-read.test.ts) | 单元／服务／状态 | 工资中央完整历史读取 |
| [tests/payroll/central-service.test.ts](../../../tests/payroll/central-service.test.ts) | 单元／服务／状态 | 工资 P0 中央读取事务 |
| [tests/payroll/controlled-migration.test.ts](../../../tests/payroll/controlled-migration.test.ts) | 单元／服务／状态 | 公开迁入后同库冷读原八表与不可变证据，重复确认保留日常更正 |
| [tests/payroll/detail.test.ts](../../../tests/payroll/detail.test.ts) | 单元／服务／状态 | payroll statement detail read model |
| [tests/payroll/export.test.ts](../../../tests/payroll/export.test.ts) | 单元／服务／状态 | 工资已发放快照导出 |
| [tests/payroll/navigation.test.ts](../../../tests/payroll/navigation.test.ts) | 单元／服务／状态 | payroll navigation state |
| [tests/payroll/release-safety.test.ts](../../../tests/payroll/release-safety.test.ts) | 单元／服务／状态 | wage release safety |
| [tests/payroll/retired-format.test.ts](../../../tests/payroll/retired-format.test.ts) | 单元／服务／状态 | 退役 B 工资保留历史原值并拒绝写入 |
| [tests/payroll/subject-facts.test.ts](../../../tests/payroll/subject-facts.test.ts) | 单元／服务／状态 | 真实 SQLite 的原比例经网络来源保留 0 与 0.8，旧缺字段不变成表单默认 0.95 |
| [tests/payroll/workbench.test.ts](../../../tests/payroll/workbench.test.ts) | 单元／服务／状态 | payroll statement lifecycle |
| [tests/stores/payroll-central.test.ts](../../../tests/stores/payroll-central.test.ts) | 单元／服务／状态 | 正式读取四入口只经 Repository，任一失败都不回退本地库 |
| [tests/stores/payroll-race.test.ts](../../../tests/stores/payroll-race.test.ts) | 单元／服务／状态 | payroll store latest-wins |
| [tests/stores/payroll-route-scope.test.ts](../../../tests/stores/payroll-route-scope.test.ts) | 单元／服务／状态 | 工资三入口按实际选项恢复来源范围 |
| [tests/tabs/payroll-restore.test.ts](../../../tests/tabs/payroll-restore.test.ts) | 单元／服务／状态 | 工资只读页签恢复 |
| [tests/components/PayrollMigrationPanel.test.ts](../../../tests/components/PayrollMigrationPanel.test.ts) | 组件（jsdom） | 完整工资来源预检、确认及原编号恢复 |
| [tests/payroll/central-a-consumed-dependencies.test.ts](../../../tests/payroll/central-a-consumed-dependencies.test.ts) | 单元／服务／状态 | A 工资实际消费依赖与无关来源变化隔离 |
| [tests/payroll/coordination-source.test.ts](../../../tests/payroll/coordination-source.test.ts) | 单元／服务／状态 | P7 原协调来源与失败状态保全 |
| [tests/payroll/source-publication-privacy.test.ts](../../../tests/payroll/source-publication-privacy.test.ts) | 单元／服务／状态 | 工资发布目录与名册照片来源隐私 |
| [tests/stores/payroll-production-pending.test.ts](../../../tests/stores/payroll-production-pending.test.ts) | 单元／服务／状态 | 工资正式来源原键及后读恢复 |
| [tests/tabs/payroll-production-startup.test.ts](../../../tests/tabs/payroll-production-startup.test.ts) | 单元／服务／状态 | 工资启动恢复不扩大来源或实体范围 |


## 空鼓扣款与零额发放

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/payroll-hollow-central.spec.ts](../../../e2e/payroll-hollow-central.spec.ts) | Playwright E2E | 原户19减4、真实楼层冷返回、人工450扣款550发放及独立补款150 |
| [tests/components/PayrollHollowAdjustmentFields.test.ts](../../../tests/components/PayrollHollowAdjustmentFields.test.ts) | 组件（jsdom） | 真实 V3 原工资保费用编辑与可读原责任价格，不显示内部身份或猜测缺失来源 |
| [tests/components/PayrollHollowConfig.test.ts](../../../tests/components/PayrollHollowConfig.test.ts) | 组件（jsdom） | 原默认30不伪空，明确零未知提交冷恢复保原键与开关并聚焦核对面板 |
| [tests/components/PayrollHollowFrozenOutput.test.ts](../../../tests/components/PayrollHollowFrozenOutput.test.ts) | 组件（jsdom） | 真实发放后打印与xlsx保存1000/450/550及原19减4，后来全整改不回填 |
| [tests/components/PayrollHollowSourceReturn.test.ts](../../../tests/components/PayrollHollowSourceReturn.test.ts) | 组件（jsdom） | ${format}由已授权空鼓原户返回同一工资，只有原户ID及撤权不得放行 |
| [tests/components/PayrollHollowStart.test.ts](../../../tests/components/PayrollHollowStart.test.ts) | 组件（jsdom） | 真实工资人工确认后才采用15处扣450，回复丢失原键核对不重复启动 |
| [tests/components/PayrollHollowZeroRelease.test.ts](../../../tests/components/PayrollHollowZeroRelease.test.ts) | 组件（jsdom） | 明确空鼓450全部抵完请款450时可在原发放确认中提交全员0，撤权和普通零额仍拒 |
| [tests/payroll/central-a-hollow-incomplete-form.test.ts](../../../tests/payroll/central-a-hollow-incomplete-form.test.ts) | 单元／服务／状态 | 首次新建 A 尚未选择负责人时返回缺项诊断和未知空鼓依据，不能抛出服务错误 |
| [tests/payroll/central-c-hollow-zero.test.ts](../../../tests/payroll/central-c-hollow-zero.test.ts) | 单元／服务／状态 | 按文件中的测试场景定位 |
| [tests/payroll/central-c-hollow.test.ts](../../../tests/payroll/central-c-hollow.test.ts) | 单元／服务／状态 | c1真实考勤请款1000，明确启动15处后只发550并保持原检查冻结 |
| [tests/payroll/central-hollow-adjustments.test.ts](../../../tests/payroll/central-hollow-adjustments.test.ts) | 单元／服务／状态 | 空鼓450更正为300只记应补150，真实补款后现金700且后月不重复领用 |
| [tests/payroll/central-hollow-deduction.test.ts](../../../tests/payroll/central-hollow-deduction.test.ts) | 单元／服务／状态 | 真实户记录到工资扣款 |
| [tests/payroll/central-hollow-http.test.ts](../../../tests/payroll/central-hollow-http.test.ts) | 单元／服务／状态 | 真实HTTP配置、启动及冻结沿Repository同源往返，非法范围和客户端自报扣款不写入 |
| [tests/payroll/central-hollow-month-order-review.test.ts](../../../tests/payroll/central-hollow-month-order-review.test.ts) | 单元／服务／状态 | 非作者复核：八月已处理空鼓后补录七月真实C1工资，不得引用未来采用而发放后无法输出 |
| [tests/payroll/central-hollow-new-inspection.test.ts](../../../tests/payroll/central-hollow-new-inspection.test.ts) | 单元／服务／状态 | 原15处已扣、5处仍未修、新增2处时后单仅人工启动新增2处，后续整改不退款 |
| [tests/payroll/central-hollow-processed-proof.test.ts](../../../tests/payroll/central-hollow-processed-proof.test.ts) | 单元／服务／状态 | 非作者复核：后月冻结的有效已处理金额和更正引用不能仅凭自洽数值证明 |
| [tests/payroll/central-hollow-proof-review.test.ts](../../../tests/payroll/central-hollow-proof-review.test.ts) | 单元／服务／状态 | 非作者复核：未启动的已发单也核对完整采用物理集合，不接受后来未签入的采用行 |
| [tests/payroll/hollow-deduction-calculation.test.ts](../../../tests/payroll/hollow-deduction-calculation.test.ts) | 单元／服务／状态 | 人工空鼓扣款的本次核算 |
| [tests/payroll/hollow-deduction-command.test.ts](../../../tests/payroll/hollow-deduction-command.test.ts) | 单元／服务／状态 | 空鼓工资提交的封闭边界 |
| [tests/payroll/hollow-export.test.ts](../../../tests/payroll/hollow-export.test.ts) | 单元／服务／状态 | ${format}真实发放工作簿将请款1000、空鼓450与现金550分列且保原来源 |
| [tests/payroll/hollow-migration-adjustments.test.ts](../../../tests/payroll/hollow-migration-adjustments.test.ts) | 单元／服务／状态 | 迁入原450扣款后真实更正300并补款150，再次迁入保留现金700与原冻结550 |
| [tests/payroll/hollow-migration-graph.test.ts](../../../tests/payroll/hollow-migration-graph.test.ts) | 单元／服务／状态 | 工资只出现部分空鼓扣款三表时拒绝导出，不能静默降回旧工资图 |
| [tests/payroll/hollow-migration-integrity.test.ts](../../../tests/payroll/hollow-migration-integrity.test.ts) | 单元／服务／状态 | 迁入配置可追加真实0修订，原raw不改；重复迁入保全而恢复拒绝抹掉新修订 |
| [tests/payroll/hollow-migration-proof-package.test.ts](../../../tests/payroll/hollow-migration-proof-package.test.ts) | 单元／服务／状态 | 真实工资原图包只接受完整可达祖先、原字节摘要和明确表映射 |
| [tests/payroll/hollow-migration-runtime.test.ts](../../../tests/payroll/hollow-migration-runtime.test.ts) | 单元／服务／状态 | 真实原检查19整改4与工资550整体迁入，公开冻结输出和后月已处理450保留 |
| [tests/stores/payroll-hollow-pending.test.ts](../../../tests/stores/payroll-hollow-pending.test.ts) | 单元／服务／状态 | 扣款配置未知回复冷重建仍保原编号、开关、明确零和生效月份 |

## 批次与分配

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/payroll-batch-remainder.spec.ts](../../../e2e/payroll-batch-remainder.spec.ts) | Playwright E2E | 真实三张工资从0暂缓到自动分完1000，五档视口及逐单冷读不超发 |
| [tests/payroll/allocations.test.ts](../../../tests/payroll/allocations.test.ts) | 单元／服务／状态 | wage statement member allocations |
| [tests/payroll/central-batch-format-execution.test.ts](../../../tests/payroll/central-batch-format-execution.test.ts) | 单元／服务／状态 | persists and executes the original C1 command before completing a one-item plan |
| [tests/payroll/central-batch-funding.test.ts](../../../tests/payroll/central-batch-funding.test.ts) | 单元／服务／状态 | central payroll batch funding |
| [tests/payroll/central-batch-http.test.ts](../../../tests/payroll/central-batch-http.test.ts) | 单元／服务／状态 | batch HTTP/Repository roundtrip binds preview, identity and immutable plan while rejecting altered commands |
| [tests/payroll/central-batch-preview.test.ts](../../../tests/payroll/central-batch-preview.test.ts) | 单元／服务／状态 | central payroll batch preview and immutable confirmation |
| [tests/payroll/central-batch-remainder-execution.test.ts](../../../tests/payroll/central-batch-remainder-execution.test.ts) | 单元／服务／状态 | 冷读稳定簿身份分出333.34/333.33/333.33，三份原工资实际合计1000且不重复发放 |
| [tests/payroll/central-batch-schema.test.ts](../../../tests/payroll/central-batch-schema.test.ts) | 单元／服务／状态 | central payroll batch schema |

## 正式编号与工资簿

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/payroll-official-numbering.spec.ts](../../../e2e/payroll-official-numbering.spec.ts) | Playwright E2E | 原工资预览、人工起点、正式占号丢响应恢复、重复Excel和实际打印保持原号 |
| [e2e/payroll-workbook-archive.spec.ts](../../../e2e/payroll-workbook-archive.spec.ts) | Playwright E2E | 现代完整工资图经实际快照公开迁入后，两种历史目录仍可重下原编号名册与照片 |
| [tests/components/PayrollNumberingState.test.ts](../../../tests/components/PayrollNumberingState.test.ts) | 组件（jsdom） | 项目旧纸号不猜起点，未明确填写时不发命令 |
| [tests/components/PayrollWorkbookScreen.test.ts](../../../tests/components/PayrollWorkbookScreen.test.ts) | 组件（jsdom） | 已保存目录分开提供公开工资与需独立权限的私密包，不再沿用未定稿归档窗口 |
| [tests/components/PayrollWorkbookState.test.ts](../../../tests/components/PayrollWorkbookState.test.ts) | 组件（jsdom） | 普通工资权限可打开目录，不预读私密版本；项目切换后的迟到读取不会串入 |
| [tests/payroll/central-numbering-integrity.test.ts](../../../tests/payroll/central-numbering-integrity.test.ts) | 单元／服务／状态 | 双窗相同原单不同提交只有一次占号，另窗先重读后仍返回原号 |
| [tests/payroll/central-official-numbering.test.ts](../../../tests/payroll/central-official-numbering.test.ts) | 单元／服务／状态 | 登记项目旧纸号起点后首次正式出具占一个号，原键恢复和再次出具仍读原号 |
| [tests/payroll/central-workbook.test.ts](../../../tests/payroll/central-workbook.test.ts) | 单元／服务／状态 | 目录正文/回执/版本损坏必须拒绝，不能将不一致归档当作完整文件 |
| [tests/payroll/complete-workbook.test.ts](../../../tests/payroll/complete-workbook.test.ts) | 单元／服务／状态 | 完整工资工作簿与按月归档 |
| [tests/payroll/numbering-controlled-migration.test.ts](../../../tests/payroll/numbering-controlled-migration.test.ts) | 单元／服务／状态 | 正式旧号和起点随完整原图迁入，原单再次出具不增号，日常回执阻挡危险恢复 |
| [tests/payroll/numbering-export.test.ts](../../../tests/payroll/numbering-export.test.ts) | 单元／服务／状态 | 正式单份Excel实际包含原号、原工资与冻结金额，重复输出不新增编号 |
| [tests/payroll/numbering-http.test.ts](../../../tests/payroll/numbering-http.test.ts) | 单元／服务／状态 | 真实HTTP读取冻结金额、初始化、正式出具及失响应原键恢复完整往返 |
| [tests/payroll/numbering-migration-chain.test.ts](../../../tests/payroll/numbering-migration-chain.test.ts) | 单元／服务／状态 | 迁入 A 冻结工资正式出具后连续两次完整迁入，保留原号/原件hash并恢复日常原号输出 |
| [tests/payroll/workbook-controlled-migration.test.ts](../../../tests/payroll/workbook-controlled-migration.test.ts) | 单元／服务／状态 | 真实工资正式128号、固定名册六张原件与保存目录一起迁入，原JSON及摘要保留 |
| [tests/payroll/workbook-deep-references.test.ts](../../../tests/payroll/workbook-deep-references.test.ts) | 单元／服务／状态 | 真实管理工资无普通施工行时仍保护管理范围、费用修订和每个原工程量身份 |
| [tests/payroll/workbook-export.test.ts](../../../tests/payroll/workbook-export.test.ts) | 单元／服务／状态 | 固定工资目录的真实文件组合 |
| [tests/payroll/workbook-http.test.ts](../../../tests/payroll/workbook-http.test.ts) | 单元／服务／状态 | 真实HTTP预览、归档、列表、冷读取及失响应核对往返，并拒绝多余请求字段 |
| [tests/tabs/payroll-numbering-restore.test.ts](../../../tests/tabs/payroll-numbering-restore.test.ts) | 单元／服务／状态 | 正式出具冷恢复只保留明确原项目与工资身份并重新读取 |
| [tests/tabs/payroll-workbook-restore.test.ts](../../../tests/tabs/payroll-workbook-restore.test.ts) | 单元／服务／状态 | 工资目录冷恢复仅带公开身份，重新受权读取原目录且不预读私密正文 |

## A 表、费用与管理簿

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/payroll-a-central.spec.ts](../../../e2e/payroll-a-central.spec.ts) | Playwright E2E | A工资真实迁入、配置保稿、实际核对发放、跨月重核与冻结输出完整旅程 |
| [e2e/payroll-fees-central.spec.ts](../../../e2e/payroll-fees-central.spec.ts) | Playwright E2E | 多条补贴与独立管理簿：明确配置、未知提交恢复、520负价清单和真实输出 |
| [tests/components/PayrollAConfigState.test.ts](../../../tests/components/PayrollAConfigState.test.ts) | 组件（jsdom） | 尚无工资的新项目从已验证配置读取得到项目候选 |
| [tests/components/PayrollACreateFromQuantity.test.ts](../../../tests/components/PayrollACreateFromQuantity.test.ts) | 组件（jsdom） | 没有旧工资的纯量项目按授权新建候选显示入口，固定draftKey并保来源筛选 |
| [tests/components/PayrollAFeeAdjustmentFields.test.ts](../../../tests/components/PayrollAFeeAdjustmentFields.test.ts) | 组件（jsdom） | 费用更正保原费项/负价修订及范围，只提交本次量价和说明，原冻结不变 |
| [tests/components/PayrollAFeesReview.test.ts](../../../tests/components/PayrollAFeesReview.test.ts) | 组件（jsdom） | 普通工资明确分开3600工作与130房补，不将缺费用读当无补贴 |
| [tests/components/PayrollAFloorReview.test.ts](../../../tests/components/PayrollAFloorReview.test.ts) | 组件（jsdom） | 楼层轴只取本簿截至本月真实完成，格内区分往月、本月和未涉及 |
| [tests/components/PayrollAFloorSourceFocus.test.ts](../../../tests/components/PayrollAFloorSourceFocus.test.ts) | 组件（jsdom） | 同层同分项第二户空鼓入口返回自己的原完成定位 |
| [tests/components/PayrollAFormState.test.ts](../../../tests/components/PayrollAFormState.test.ts) | 组件（jsdom） | 中央 A 独立草稿 |
| [tests/components/PayrollAFrozenPrint.test.ts](../../../tests/components/PayrollAFrozenPrint.test.ts) | 组件（jsdom） | 打印内容仅用已传冻结值，零成员和四类签名位置完整 |
| [tests/components/PayrollAIncompleteForm.test.ts](../../../tests/components/PayrollAIncompleteForm.test.ts) | 组件（jsdom） | 真实不完整费用与空鼓诊断可补选原稿范围，未证核算始终不能保存 |
| [tests/components/PayrollANegativeLinesState.test.ts](../../../tests/components/PayrollANegativeLinesState.test.ts) | 组件（jsdom） | 负价命令停用后迟到失败不锁死，原键恢复保负价输入和原基准 |
| [tests/components/PayrollAPriceDialog.test.ts](../../../tests/components/PayrollAPriceDialog.test.ts) | 组件（jsdom） | 调价弹层切页后撤权，原价格仍保留但保存按钮禁用 |
| [tests/components/PayrollAReleaseDialog.test.ts](../../../tests/components/PayrollAReleaseDialog.test.ts) | 组件（jsdom） | 中央A工资实发确认 |
| [tests/components/PayrollARoundingSection.test.ts](../../../tests/components/PayrollARoundingSection.test.ts) | 组件（jsdom） | a 工资取整配置 |
| [tests/components/PayrollASourceReturn.test.ts](../../../tests/components/PayrollASourceReturn.test.ts) | 组件（jsdom） | 工资来源页返回读取核验 |
| [tests/components/PayrollASourceReview.test.ts](../../../tests/components/PayrollASourceReview.test.ts) | 组件（jsdom） | 没有已证明工资行时仍展示原户位置、损坏说明和原身份，无权入口保持不可用 |
| [tests/components/PayrollAStatementState.test.ts](../../../tests/components/PayrollAStatementState.test.ts) | 组件（jsdom） | 此前实付变化后持久需重核，重核成功仍保原实发输入且再确认使用新依据 |
| [tests/payroll/a-export.test.ts](../../../tests/payroll/a-export.test.ts) | 单元／服务／状态 | 冻结 A 工资实际工作簿 |
| [tests/payroll/a-fees-output.test.ts](../../../tests/payroll/a-fees-output.test.ts) | 单元／服务／状态 | 冻结费用工作表保存逐条基数和负价，原文档不变且不称完整工作簿 |
| [tests/payroll/a-location-output.test.ts](../../../tests/payroll/a-location-output.test.ts) | 单元／服务／状态 | 冻结位置按楼栋分项单位分组，断层楼层不补齐，原房间责任与金额不丢失 |
| [tests/payroll/a-migration-protection.test.ts](../../../tests/payroll/a-migration-protection.test.ts) | 单元／服务／状态 | 按文件中的测试场景定位 |
| [tests/payroll/a-navigation.test.ts](../../../tests/payroll/a-navigation.test.ts) | 单元／服务／状态 | a工资原来源返回 |
| [tests/payroll/a-quantity-migration-navigation.test.ts](../../../tests/payroll/a-quantity-migration-navigation.test.ts) | 单元／服务／状态 | 迁入编码量身份的工资来源往返 |
| [tests/payroll/a-receipt-migration.test.ts](../../../tests/payroll/a-receipt-migration.test.ts) | 单元／服务／状态 | 按文件中的测试场景定位 |
| [tests/payroll/central-a-adjustment-reconciliation.test.ts](../../../tests/payroll/central-a-adjustment-reconciliation.test.ts) | 单元／服务／状态 | 按文件中的测试场景定位 |
| [tests/payroll/central-a-adjustments.test.ts](../../../tests/payroll/central-a-adjustments.test.ts) | 单元／服务／状态 | a 更正按原施工责任、现场量、价和比例重新核算；原签名与原施工完成不改 |
| [tests/payroll/central-a-amount-integrity.test.ts](../../../tests/payroll/central-a-amount-integrity.test.ts) | 单元／服务／状态 | a 工资公开核算的历史实付完整性 |
| [tests/payroll/central-a-book-history-gaps.test.ts](../../../tests/payroll/central-a-book-history-gaps.test.ts) | 单元／服务／状态 | 管理已领用途关系及两份原件同时缺损时，不借旧A兼容分支变成零已领 |
| [tests/payroll/central-a-codec.test.ts](../../../tests/payroll/central-a-codec.test.ts) | 单元／服务／状态 | 工资预览拒绝缺数量/状态权限不符/错目标，金额不能传输时取整成另一笔 |
| [tests/payroll/central-a-commands.test.ts](../../../tests/payroll/central-a-commands.test.ts) | 单元／服务／状态 | 中央 A 配置、核对与冻结发放事务 |
| [tests/payroll/central-a-diagnostic-location.test.ts](../../../tests/payroll/central-a-diagnostic-location.test.ts) | 单元／服务／状态 | 中央工资损坏来源的原位置读取 |
| [tests/payroll/central-a-fee-adjustment-calculation.test.ts](../../../tests/payroll/central-a-fee-adjustment-calculation.test.ts) | 单元／服务／状态 | a 费用独立更正计算 |
| [tests/payroll/central-a-fee-adjustments.test.ts](../../../tests/payroll/central-a-fee-adjustments.test.ts) | 单元／服务／状态 | 后来费用单价变成第三个值时不能以总额近似认作已含原更正 |
| [tests/payroll/central-a-fees-codec.test.ts](../../../tests/payroll/central-a-fees-codec.test.ts) | 单元／服务／状态 | p5 费用 HTTP 读取的封闭嵌套边界 |
| [tests/payroll/central-a-fees-host-cost.test.ts](../../../tests/payroll/central-a-fees-host-cost.test.ts) | 单元／服务／状态 | 真实普通工资1000和含负价管理工资500经预算、项目、班组、个人、付款入口均只计1500 |
| [tests/payroll/central-a-fees-integrity.test.ts](../../../tests/payroll/central-a-fees-integrity.test.ts) | 单元／服务／状态 | p5 已发费用完整性与管理主体 |
| [tests/payroll/central-a-fees-removal.test.ts](../../../tests/payroll/central-a-fees-removal.test.ts) | 单元／服务／状态 | p5 移除追加原文墓碑，不要求失效来源重新取得计价资格 |
| [tests/payroll/central-a-fees-runtime-options.test.ts](../../../tests/payroll/central-a-fees-runtime-options.test.ts) | 单元／服务／状态 | 真实名册工资事实只投影 A 候选合同，经 HTTP wire 可读取费用配置 |
| [tests/payroll/central-a-fees.test.ts](../../../tests/payroll/central-a-fees.test.ts) | 单元／服务／状态 | p5 公开配置与现场量费用核算 |
| [tests/payroll/central-a-http.test.ts](../../../tests/payroll/central-a-http.test.ts) | 单元／服务／状态 | a HTTP/Repository往返保数量精度、明确零与固定目标，拒绝客户端伪造来源和未知动作 |
| [tests/payroll/central-a-management-ownership.test.ts](../../../tests/payroll/central-a-management-ownership.test.ts) | 单元／服务／状态 | 双窗发起同簿同月只保留一个草稿，重新读取定位原单；双窗发放只有一份实付 |
| [tests/payroll/central-a-management-ratio.test.ts](../../../tests/payroll/central-a-management-ratio.test.ts) | 单元／服务／状态 | 管理草稿统一沿同簿A比例默认 |
| [tests/payroll/central-a-prices-migration.test.ts](../../../tests/payroll/central-a-prices-migration.test.ts) | 单元／服务／状态 | 迁入的单元工资价按已证身份供后月读取和修订，原范围 JSON 保持原文 |
| [tests/payroll/central-a-prices.test.ts](../../../tests/payroll/central-a-prices.test.ts) | 单元／服务／状态 | 中央 A 工资单价与比例的有效版本 |
| [tests/payroll/central-a-provenance.test.ts](../../../tests/payroll/central-a-provenance.test.ts) | 单元／服务／状态 | 旧无正文列的回执升级只增加NULL字段，保原回执全部已知内容 |
| [tests/payroll/central-a-rounding.test.ts](../../../tests/payroll/central-a-rounding.test.ts) | 单元／服务／状态 | central A payroll rounding revisions |
| [tests/payroll/central-a-service.test.ts](../../../tests/payroll/central-a-service.test.ts) | 单元／服务／状态 | 中央 A 完成现场量及明确工资配置 |
| [tests/payroll/central-a-transactions.test.ts](../../../tests/payroll/central-a-transactions.test.ts) | 单元／服务／状态 | 工资核对后的事务复验与不可重复发放 |
| [tests/payroll/crew-fee-default-facts.test.ts](../../../tests/payroll/crew-fee-default-facts.test.ts) | 单元／服务／状态 | 班组费用默认经真实导出与owner保留0/false/null/缺字段，改名不采用表单默认 |
| [tests/payroll/fees-migration-batch-boundaries.test.ts](../../../tests/payroll/fees-migration-batch-boundaries.test.ts) | 单元／服务／状态 | 公开第二批及原子边界混合批次均拒绝，两套真实费用原图和当前全状态不变 |
| [tests/payroll/fees-migration-graph.test.ts](../../../tests/payroll/fees-migration-graph.test.ts) | 单元／服务／状态 | 费用图使用outer v3和独立fees v1，原v1/v2保持封闭白名单 |
| [tests/payroll/fees-migration-runtime.test.ts](../../../tests/payroll/fees-migration-runtime.test.ts) | 单元／服务／状态 | 同人同月普通工资和管理簿可以分别建立并发放，再完整迁入 |
| [tests/payroll/management-scope-facts.test.ts](../../../tests/payroll/management-scope-facts.test.ts) | 单元／服务／状态 | 原责任范围包含未完成格子，保留明确细格，不产生施工完成数量 |
| [tests/payroll/quantity-facts-date-integrity.test.ts](../../../tests/payroll/quantity-facts-date-integrity.test.ts) | 单元／服务／状态 | 按文件中的测试场景定位 |
| [tests/payroll/quantity-facts.test.ts](../../../tests/payroll/quantity-facts.test.ts) | 单元／服务／状态 | 完成保留旧个人scope、8/null/0及原责任，缺量只影响原主体不跟随当前转组 |
| [tests/stores/payroll-a-central.test.ts](../../../tests/stores/payroll-a-central.test.ts) | 单元／服务／状态 | 固定页面读不被另一读抬高基准，失响应保原身份/原金额/原键并冷恢复 |
| [tests/stores/payroll-a-fees-pending.test.ts](../../../tests/stores/payroll-a-fees-pending.test.ts) | 单元／服务／状态 | 费用原稿成功后仍等待可信同目标后读，空修订列表不能冒充保存完成 |
| [tests/stores/payroll-a-pending-read.test.ts](../../../tests/stores/payroll-a-pending-read.test.ts) | 单元／服务／状态 | a 成功回执仍保留原键，原键重取同目标纯读后才完成 |
| [tests/stores/payroll-a-release-read.test.ts](../../../tests/stores/payroll-a-release-read.test.ts) | 单元／服务／状态 | 按文件中的测试场景定位 |

## C1 与考勤

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/payroll-attendance.spec.ts](../../../e2e/payroll-attendance.spec.ts) | Playwright E2E | 工资与考勤浏览器接管边界 |
| [e2e/payroll-c1-central.spec.ts](../../../e2e/payroll-c1-central.spec.ts) | Playwright E2E | 无工程量项目考勤、个人标准、C1核对实发、原键恢复与配对冻结输出 |
| [e2e/payroll-c1-readonly.spec.ts](../../../e2e/payroll-c1-readonly.spec.ts) | Playwright E2E | 旧C1缺原快照仍能读原金额，不生成完整工资或考勤输出 |
| [e2e/payroll-c1-recovery.spec.ts](../../../e2e/payroll-c1-recovery.spec.ts) | Playwright E2E | 原考勤保存失败保稿、冷页原编号恢复与切月份迟到读取 |
| [tests/components/AttendanceCentralRace.test.ts](../../../tests/components/AttendanceCentralRace.test.ts) | 组件（jsdom） | 中央考勤原格保存边界 |
| [tests/components/AttendanceCentralState.test.ts](../../../tests/components/AttendanceCentralState.test.ts) | 组件（jsdom） | 中央考勤矩阵精度 |
| [tests/components/AttendanceWorkbench.test.ts](../../../tests/components/AttendanceWorkbench.test.ts) | 组件（jsdom） | attendance workbench components |
| [tests/components/PayrollAttendanceCell.test.ts](../../../tests/components/PayrollAttendanceCell.test.ts) | 组件（jsdom） | 中央原单元格输入 |
| [tests/components/PayrollC1Completion.test.ts](../../../tests/components/PayrollC1Completion.test.ts) | 组件（jsdom） | c1 回执后的同目标状态读取 |
| [tests/components/PayrollC1Config.test.ts](../../../tests/components/PayrollC1Config.test.ts) | 组件（jsdom） | c1 每人标准输入 |
| [tests/components/PayrollC1ConfigRecovery.test.ts](../../../tests/components/PayrollC1ConfigRecovery.test.ts) | 组件（jsdom） | 冷实例重新打开同一配置，真实 store 保原编号及54/空日薪；读回成功才解除 |
| [tests/components/PayrollC1C2DetailPrecision.test.ts](../../../tests/components/PayrollC1C2DetailPrecision.test.ts) | 组件（jsdom） | C1、C2 原单价、未知与金额精度 |
| [tests/components/PayrollC1C2Form.test.ts](../../../tests/components/PayrollC1C2Form.test.ts) | 组件（jsdom） | C1、C2 页面固定草稿与负责人选择 |
| [tests/components/PayrollC1FrozenPrint.test.ts](../../../tests/components/PayrollC1FrozenPrint.test.ts) | 组件（jsdom） | c1 配对打印材料 |
| [tests/components/PayrollC1Release.test.ts](../../../tests/components/PayrollC1Release.test.ts) | 组件（jsdom） | c1 实际发放确认 |
| [tests/components/PayrollC1C2ReleasedEvidence.test.ts](../../../tests/components/PayrollC1C2ReleasedEvidence.test.ts) | 组件（jsdom） | C1、C2 发放证据缺失与配对输出 |
| [tests/components/PayrollC1SourceReturn.test.ts](../../../tests/components/PayrollC1SourceReturn.test.ts) | 组件（jsdom） | c1 来源返回验证 |
| [tests/payroll/attendance-facts.test.ts](../../../tests/payroll/attendance-facts.test.ts) | 单元／服务／状态 | 逐日事实保原组、7.51小数和真零，坏未来日期不消失且软删原行仍可读 |
| [tests/payroll/attendance-safety.test.ts](../../../tests/payroll/attendance-safety.test.ts) | 单元／服务／状态 | attendance write boundary |
| [tests/payroll/c1-b-independent-review.test.ts](../../../tests/payroll/c1-b-independent-review.test.ts) | 单元／服务／状态 | 按文件中的测试场景定位 |
| [tests/payroll/c1-export.test.ts](../../../tests/payroll/c1-export.test.ts) | 单元／服务／状态 | c1 真正配对工作簿 |
| [tests/payroll/c1-migration-protection.test.ts](../../../tests/payroll/c1-migration-protection.test.ts) | 单元／服务／状态 | 迟到的迁入考勤不能越过同库独立待确认签工占用，失败前后整批不变 |
| [tests/payroll/c1-navigation.test.ts](../../../tests/payroll/c1-navigation.test.ts) | 单元／服务／状态 | c1 格式与原逐日来源 |
| [tests/payroll/c1-spec-independent.test.ts](../../../tests/payroll/c1-spec-independent.test.ts) | 单元／服务／状态 | c1 成功回执后冷读失败并刷新页面，仍可用原金额原编号恢复结果 |
| [tests/payroll/c1-worker-facts.test.ts](../../../tests/payroll/c1-worker-facts.test.ts) | 单元／服务／状态 | 真实工人日薪经受控网络保 NULL/0/481，旧缺字段不补价且重复迁入保日常更正 |
| [tests/payroll/central-attendance-service.test.ts](../../../tests/payroll/central-attendance-service.test.ts) | 单元／服务／状态 | 未选择项目或月份时保原空范围与候选，空矩阵不读取整年事实；非法非空月和空月写入仍拒绝 |
| [tests/payroll/central-c1-adjustments.test.ts](../../../tests/payroll/central-c1-adjustments.test.ts) | 单元／服务／状态 | 按文件中的测试场景定位 |
| [tests/payroll/central-c1-codec.test.ts](../../../tests/payroll/central-c1-codec.test.ts) | 单元／服务／状态 | 考勤与 C1 命令封闭动作/字段，正常小数不提前舍入，非数与非法日期不能入请求 |
| [tests/payroll/central-c1-commands.test.ts](../../../tests/payroll/central-c1-commands.test.ts) | 单元／服务／状态 | 核算与真实实发分离，全成员到分且原键只发一次，已发不可改 |
| [tests/payroll/central-c1-http.test.ts](../../../tests/payroll/central-c1-http.test.ts) | 单元／服务／状态 | 真实 HTTP/Repository 贯通考勤、独立费率、C1 核对实发与配对冻结，传输不截工时或费率 |
| [tests/payroll/central-c1-independent.test.ts](../../../tests/payroll/central-c1-independent.test.ts) | 单元／服务／状态 | c1 独立复验：事务末端、历史原组与月份边界 |
| [tests/payroll/central-c1-provenance.test.ts](../../../tests/payroll/central-c1-provenance.test.ts) | 单元／服务／状态 | 原考勤/个人标准/成功回执须相互证明，改两份来源仍不能复用旧指纹输出 |
| [tests/payroll/central-c1-service.test.ts](../../../tests/payroll/central-c1-service.test.ts) | 单元／服务／状态 | 纯时工项目无需工程量，逐人工资与未舍入的默认加班价来自真实考勤 |
| [tests/stores/attendance-central.test.ts](../../../tests/stores/attendance-central.test.ts) | 单元／服务／状态 | 同一个原单元格按项目/人/日保稿恢复，切班组不丢原键，另一日或项目不串写 |
| [tests/stores/payroll-c1-central.test.ts](../../../tests/stores/payroll-c1-central.test.ts) | 单元／服务／状态 | c1 原金额原键在丢响应、换单和冷恢复期间固定，不与 A 存储桶混用 |

## C2 与点工

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/payroll-c2-central.spec.ts](../../../e2e/payroll-c2-central.spec.ts) | Playwright E2E | 独立签工、人工确认、主体规则、C2核算实发与原键配对冻结输出 |
| [e2e/payroll-c2-output.spec.ts](../../../e2e/payroll-c2-output.spec.ts) | Playwright E2E | 真实长签工发放后两表分页与下载回读，精确单价及明确空规则不被改写 |
| [e2e/payroll-c2-readonly.spec.ts](../../../e2e/payroll-c2-readonly.spec.ts) | Playwright E2E | 旧 C2 缺原快照保留原金额与资料，禁止伪完整工资及签工输出 |
| [e2e/payroll-c2-recovery.spec.ts](../../../e2e/payroll-c2-recovery.spec.ts) | Playwright E2E | 新签工失响应后冷页按原编号保存一次，日期和正文不丢失 |
| [tests/components/PayrollC2Completion.test.ts](../../../tests/components/PayrollC2Completion.test.ts) | 组件（jsdom） | c2 回执后的同目标状态读取 |
| [tests/components/PayrollC2Config.test.ts](../../../tests/components/PayrollC2Config.test.ts) | 组件（jsdom） | 原缺单价不伪零、规则 null 不伪空；显式选择空规则后按原固定读提交 |
| [tests/components/PayrollC2FrozenPrint.test.ts](../../../tests/components/PayrollC2FrozenPrint.test.ts) | 组件（jsdom） | 工资和签工两个输出保原半工、证明、空规则及全成员真实分配，不输出考勤 |
| [tests/components/PayrollC2Release.test.ts](../../../tests/components/PayrollC2Release.test.ts) | 组件（jsdom） | c2 实际发放确认 |
| [tests/components/PayrollC2SourceReturn.test.ts](../../../tests/components/PayrollC2SourceReturn.test.ts) | 组件（jsdom） | c2 来源返回验证 |
| [tests/components/PayrollC2SourceReview.test.ts](../../../tests/components/PayrollC2SourceReview.test.ts) | 组件（jsdom） | 待确认与被占用原记录仍显示具体时段、证明及未采用原因；只以服务采用集合标记 |
| [tests/components/PayrollC2SpecIndependent.test.ts](../../../tests/components/PayrollC2SpecIndependent.test.ts) | 组件（jsdom） | 独立规格反例：重新读取已撤写权的同一签工，保留本地草稿但停止可编辑与提交 |
| [tests/components/PayrollDayworkConfirmation.test.ts](../../../tests/components/PayrollDayworkConfirmation.test.ts) | 组件（jsdom） | 修改证明后取消关闭，或 KeepAlive 隐藏再显示，仍保同一原格证明输入 |
| [tests/components/PayrollDayworkForm.test.ts](../../../tests/components/PayrollDayworkForm.test.ts) | 组件（jsdom） | 保存并确认依据实际状态提示，不将 saved 回执误说为待确认 |
| [tests/components/SignedDaywork.test.ts](../../../tests/components/SignedDaywork.test.ts) | 组件（jsdom） | signed daywork components |
| [tests/payroll/c2-b-independent.test.ts](../../../tests/payroll/c2-b-independent.test.ts) | 单元／服务／状态 | 独立反例：原签工跨项目及人员移动后仅余可靠回执，仍在恢复删除前保护原行；去掉该回执才可准备 |
| [tests/payroll/c2-migration-protection.test.ts](../../../tests/payroll/c2-migration-protection.test.ts) | 单元／服务／状态 | 另一项目真实 C2 核对来源保留时，可单独准备恢复未被引用的原项目 |
| [tests/payroll/c2-navigation.test.ts](../../../tests/payroll/c2-navigation.test.ts) | 单元／服务／状态 | c2 原签工导航 |
| [tests/payroll/c2-source-locks.test.ts](../../../tests/payroll/c2-source-locks.test.ts) | 单元／服务／状态 | 他单未发逐条领用可见，但不制造同格式整月编辑锁；已发软删头与关联仍占用 |
| [tests/payroll/c2-spec-independent.test.ts](../../../tests/payroll/c2-spec-independent.test.ts) | 单元／服务／状态 | 独立规格反例：真实发放的全员月锁在签工台账可见，零签工成员与状态筛空均不能丢锁 |
| [tests/payroll/central-c2-codec.test.ts](../../../tests/payroll/central-c2-codec.test.ts) | 单元／服务／状态 | 签工C2有限数精确展开十进制定点，null与零保真，科学计数传输不能进入读取或命令 |
| [tests/payroll/central-c2-commands.test.ts](../../../tests/payroll/central-c2-commands.test.ts) | 单元／服务／状态 | 同日两段相邻半工可保存，待确认计入一工上限，重叠与第三半工拒绝且不留回执 |
| [tests/payroll/central-c2-detail.test.ts](../../../tests/payroll/central-c2-detail.test.ts) | 单元／服务／状态 | 中央 C2 回执被损坏时通用详情也降为来源未证实，保留原金额与原文 |
| [tests/payroll/central-c2-http.test.ts](../../../tests/payroll/central-c2-http.test.ts) | 单元／服务／状态 | 真实HTTP贯通签工与C2空态、半工、主体配置、唯一核对发放及冻结，价保原精度而金额到分 |
| [tests/payroll/central-c2-independent.test.ts](../../../tests/payroll/central-c2-independent.test.ts) | 单元／服务／状态 | c2 独立公开服务反例：原关系、最后窗口与完整冻结 |
| [tests/payroll/central-c2-invalid-migration.test.ts](../../../tests/payroll/central-c2-invalid-migration.test.ts) | 单元／服务／状态 | 按文件中的测试场景定位 |
| [tests/payroll/central-c2-service.test.ts](../../../tests/payroll/central-c2-service.test.ts) | 单元／服务／状态 | c2主体按项目与负责人保存正价和明确空规则，不要求月份或工程量，原配置可冷读 |
| [tests/payroll/central-daywork-service.test.ts](../../../tests/payroll/central-daywork-service.test.ts) | 单元／服务／状态 | 没有工程量的直接用工项目可读签工候选，未选择月份保空台账且非法非空月拒绝 |
| [tests/payroll/daywork-facts.test.ts](../../../tests/payroll/daywork-facts.test.ts) | 单元／服务／状态 | 逐签工事实保留原组、状态、相邻半工与同更新时间的原文变化 |
| [tests/payroll/signed-daywork.test.ts](../../../tests/payroll/signed-daywork.test.ts) | 单元／服务／状态 | c2 signed daywork source |
| [tests/stores/daywork-central.test.ts](../../../tests/stores/daywork-central.test.ts) | 单元／服务／状态 | 原保存成功后冷读失败仍保原键，随后同ID合法移项目改人改日也能确认原成功并提示后续变化 |
| [tests/stores/payroll-c2-central.test.ts](../../../tests/stores/payroll-c2-central.test.ts) | 单元／服务／状态 | 真实C2发放丢响应冷实例按原键恢复，只有原表单与available冻结的可信后读能解除 |
| [tests/stores/signed-daywork-race.test.ts](../../../tests/stores/signed-daywork-race.test.ts) | 单元／服务／状态 | 桌面签工读取范围与竞态 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/helpers/payroll-a-migration-source.ts](../../../e2e/helpers/payroll-a-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-adjustment-workspace.ts](../../../e2e/helpers/payroll-adjustment-workspace.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-batch-migration-source.ts](../../../e2e/helpers/payroll-batch-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-c1-migration-source.ts](../../../e2e/helpers/payroll-c1-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-c1-workspace.ts](../../../e2e/helpers/payroll-c1-workspace.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-c2-migration-source.ts](../../../e2e/helpers/payroll-c2-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-c2-workspace.ts](../../../e2e/helpers/payroll-c2-workspace.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-fees-boundaries.ts](../../../e2e/helpers/payroll-fees-boundaries.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-fees-migration-source.ts](../../../e2e/helpers/payroll-fees-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-fees-workspace.ts](../../../e2e/helpers/payroll-fees-workspace.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-hollow-migration-source.ts](../../../e2e/helpers/payroll-hollow-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-hollow-workspace.ts](../../../e2e/helpers/payroll-hollow-workspace.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-location-migration-source.ts](../../../e2e/helpers/payroll-location-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-migration-source.ts](../../../e2e/helpers/payroll-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-roster-workspace.ts](../../../e2e/helpers/payroll-roster-workspace.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-workbook-roundtrip.ts](../../../e2e/helpers/payroll-workbook-roundtrip.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [e2e/helpers/payroll-workbook-snapshot-source.ts](../../../e2e/helpers/payroll-workbook-snapshot-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/fixtures/payroll/fees-config-captured.json](../../../tests/fixtures/payroll/fees-config-captured.json) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-a-adjustment-fixture.ts](../../../tests/helpers/payroll-a-adjustment-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-a-fee-adjustment-fixture.ts](../../../tests/helpers/payroll-a-fee-adjustment-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-a-fees-fixture.ts](../../../tests/helpers/payroll-a-fees-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-a-output-migration-fixture.ts](../../../tests/helpers/payroll-a-output-migration-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-a-quantity-source.ts](../../../tests/helpers/payroll-a-quantity-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-a-service-fixture.ts](../../../tests/helpers/payroll-a-service-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-a-ui-fixture.ts](../../../tests/helpers/payroll-a-ui-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-adjustment-migration-fixture.ts](../../../tests/helpers/payroll-adjustment-migration-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-adjustment-service-fixture.ts](../../../tests/helpers/payroll-adjustment-service-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-adjustment-ui-fixture.ts](../../../tests/helpers/payroll-adjustment-ui-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-c-hollow-fixture.ts](../../../tests/helpers/payroll-c-hollow-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-c1-service-fixture.ts](../../../tests/helpers/payroll-c1-service-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-c1-source.ts](../../../tests/helpers/payroll-c1-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-c1-ui.ts](../../../tests/helpers/payroll-c1-ui.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-c2-migration-source.ts](../../../tests/helpers/payroll-c2-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-c2-service-fixture.ts](../../../tests/helpers/payroll-c2-service-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-c2-ui.ts](../../../tests/helpers/payroll-c2-ui.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-central-read-fixture.ts](../../../tests/helpers/payroll-central-read-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-fees-migration-fixture.ts](../../../tests/helpers/payroll-fees-migration-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-fees-ui-fixture.ts](../../../tests/helpers/payroll-fees-ui-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-hollow-fixture.ts](../../../tests/helpers/payroll-hollow-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-hollow-migration-fixture.ts](../../../tests/helpers/payroll-hollow-migration-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-host-fixture.ts](../../../tests/helpers/payroll-host-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-migration-source.ts](../../../tests/helpers/payroll-migration-source.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-numbering-fixture.ts](../../../tests/helpers/payroll-numbering-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/helpers/payroll-workbook-fixture.ts](../../../tests/helpers/payroll-workbook-fixture.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
| [tests/payroll/tsconfig.json](../../../tests/payroll/tsconfig.json) | 测试类型配置 | 仅纳入配置列出的 3 个已复核测试及其依赖；不是全部工资测试类型覆盖 |
| [tests/helpers/production-payroll-a-cold.ts](../../../tests/helpers/production-payroll-a-cold.ts) | 辅助／夹具 | A 工资实际发放及原号冷进程读取 |
| [tests/helpers/production-payroll-a-upstream-fixture.ts](../../../tests/helpers/production-payroll-a-upstream-fixture.ts) | 辅助／夹具 | 真实 BOQ、工程量完成与工资独立价格夹具 |
| [tests/helpers/production-payroll-cold-process.ts](../../../tests/helpers/production-payroll-cold-process.ts) | 辅助／夹具 | 完整工资独立进程读取入口 |
| [tests/helpers/production-payroll-history-cold-process.ts](../../../tests/helpers/production-payroll-history-cold-process.ts) | 辅助／夹具 | A/C1/C2、P4–P7 与完整目录历史冷读取 |
