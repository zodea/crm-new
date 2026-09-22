# P6 B 来源与迁移冻结记录

基线：`e344a5444cd52bfeb65e78b031912d5241666fc0`。本记录不声明全量、构建或提交完成。

数量五表原件通过 flat origins 和明确 typed mapping 支持原生→迁入→原生追加→再导出/迁入；工资 outer v4 携带 deductions v1 和数量原件闭包。工资原图依赖包保留原业务 JSON 字节、非递归祖先节点和明确映射边，当前物理原件及完整子集合每次核验。三次实际收付款迁入和后月更正确认原前缀均已验证。

## 定向证据

- `migration-runtime-closure-final.log`：5 文件 / 16 项通过，19.13 秒。
- `payroll-adjustment-reexport-final.log`：2 项通过，19.59 秒，包含原 450→更正 300→真实补款 150、三次迁入现金 700，以及原 600 更正→后月实发 50 的原确认凭据。
- `migration-compatibility-final.log`：3 文件 / 17 项通过，18.44 秒，覆盖原 P4 迁入草稿/确认/冲销、A 二次单价映射、三格式 P6 完整图。
- `migration-proof-regression-final.log`：当轮 6 文件 / 30 项中 28 项通过；2 项 C2 表名 gate 红由 Root 修正，已在上述 compatibility-final 原文件全部 10 项重跑关闭。保留原失败日志，不改写为全绿。
- `payroll-proof-package-first.log` → `payroll-proof-package-green.log`：未知表映射原红→2 项绿；同时覆盖缺祖先、不可达节点、原字节摘要改动及祖先映射篡改公开迁入拒绝。
- `payroll-actual-third-import-first.log`：第三次原回执只映一层真红；`payroll-actual-third-import-second.log` 被中途新增的严格 codec 反例阻断；Root 日志 `root/adjustment-migration-wire-second.log` 证实后续祖先 actual snapshot 覆盖真红；最终两项绿见 adjustment-reexport-final。
- `migration-lint-final.log`：以下 47 个明确文件精确 ESLint 无输出，退出 0。类型由 Root 统一执行。

上述有效绿色结果按不同测试文件去重覆盖 13 文件 / 52 项；分轮运行，不冒称单次全量。

## 全量后最小兼容修复补记

Root 完整测试暴露旧 local adapter 精确 SQL 写法与新探测不一致，以及 C2 scanner 仍用 source V1 guard；同形 C1 以新增直接引用断言证实。修复保留旧库全无新表的正常导出，部分表/未知列仍拒绝；C1/C2 source 只接受各自严格版本合同，原 JSON 不改，危险恢复原断言不弱化。

- 本轮准确文件：`app/lib/quantity/hollow-migration-source.ts`、`app/lib/quantity/hollow-migration-tables.ts`（两处 schema 探测空格统一）；`server/utils/payroll-c1-migration-references.ts`、`server/utils/payroll-c2-migration-references.ts`（仅严格 Versioned guard）；`tests/payroll/c1-migration-protection.test.ts`（现有三场景直接断言正常来源包含原考勤引用，无新增健康快照）。
- `full-migration-followup-first.log`：`npm test` 精确 core-local-source、c2-migration-protection、central-adjustment-migration、c1-migration-protection 共 4 文件 / 47 项通过，22.59 秒，关闭 Root 所报 17 项原失败。
- `c1-versioned-reference-red-final.log`：旧 C1 guard 拒绝真实新来源，3 项原红，6.66 秒。之前 red.log 的不存在字段断言已纠正，不计真实原红。
- `migration-month-independent-green.log`：最终 C1 11 项、A 修复的 C1/C2/A 月序 3 项、processed-proof 6 项，共 3 文件 / 20 项通过，14.53 秒。月份修复非 B 作者；独立结论见 `independent-review.md`。
- `full-migration-followup-lint.log`：本轮上述 5 文件精确 ESLint 退出 0。未再跑全量、类型、构建或提交。

## 最后单例时限补记

Root `root/full-test-final.log` 明确记录 780 文件 / 4308 项仅 `fees-migration-runtime.test.ts:103` 的真实费用迁入→更正确认→退款链失败，错误为 `Test timed out in 5000ms`，该项 5027 ms；其余 779 文件 / 4307 项通过，整轮 399.34 秒。B 未改断言先隔离原项通过，实际 4389 ms（`fees-adjustment-timeout-isolated.log`，整轮 25.63 秒，当时其他验证并行）。

仅该 `it` 末尾新增 `30_000` 上限，源码 diff 为一行；未改全局 timeout、断言、夹具或产品。修改后 `npm test -- tests/payroll/fees-migration-runtime.test.ts -t '迁入原费用依据仍可独立更正和实际退款' --reporter=verbose` 一项通过、11 项按精确筛选未运行，实际 2525 ms、整轮 6.15 秒，日志 `fees-adjustment-timeout-final.log`；精确该文件 ESLint 退出 0，日志 `fees-adjustment-timeout-lint.log`。这两次绿不冒称该文件重跑 12 项或完整集成已通过。正常提交钩子最终全量由 Root 执行。

## B 实施触及范围

以下名单含交还 A/Root 接入的共享小接缝；`central-hollow-deduction-provenance.ts` 的 previousProcessed 最终证明由 A 维护，`hollow-migration-adjustments.test.ts` 的严格 wire 断言由 Root 补齐。B 不再编辑这些已交还区域。

- `app/lib/migration/payroll-source.ts`
- `app/lib/migration/payroll-hollow-source.ts`
- `app/lib/migration/payroll-proof-package.ts`
- `app/lib/payroll/central-hollow-deduction-mapping.ts`
- `app/lib/payroll/central-hollow-deduction-projection.ts`
- `app/lib/payroll/central-hollow-deduction-validation.ts`
- `app/lib/payroll/central-hollow-deduction-snapshot.ts`
- `app/lib/payroll/central-hollow-deduction-read.ts`
- `app/lib/payroll/central-hollow-deduction-codec.ts`
- `app/lib/payroll/central-hollow-deduction-adjustment.ts`
- `app/lib/payroll/migration-identity.ts`
- `app/lib/payroll/central-c2-output-identity.ts`
- `app/lib/payroll/central-c2-contract.ts`
- `app/lib/quantity/hollow-migration-contract.ts`
- `app/lib/quantity/hollow-migration-graph.ts`
- `app/lib/quantity/hollow-migration-mapping.ts`
- `app/lib/quantity/hollow-migration-proof.ts`
- `app/lib/quantity/hollow-migration-source.ts`
- `app/lib/quantity/hollow-migration-tables.ts`
- `app/lib/quantity/migration-graph.ts`
- `app/lib/quantity/migration-identity.ts`
- `app/lib/quantity/migration-mapping.ts`
- `app/lib/quantity/migration-source.ts`
- `server/utils/quantity-hollow-migrated-proof.ts`
- `server/utils/quantity-hollow-migration.ts`
- `server/utils/quantity-migration.ts`
- `server/utils/payroll-hollow-migration.ts`
- `server/utils/payroll-migration.ts`
- `server/utils/payroll-hollow-migration-references.ts`
- `server/utils/payroll-migrated-hollow-mapping.ts`
- `server/utils/payroll-migrated-mapping.ts`
- `server/utils/payroll-migrated-hollow.ts`
- `server/utils/payroll-hollow-data.ts`
- `server/utils/payroll-hollow-starts.ts`
- `server/utils/payroll-hollow-migrated-source.ts`
- `server/utils/payroll-migrated-proof.ts`
- `server/utils/payroll-migrated-form.ts`
- `tests/quantity/hollow-migration.test.ts`
- `tests/server/quantity-hollow-migration.test.ts`
- `tests/helpers/quantity-hollow-migration-fixture.ts`
- `tests/helpers/payroll-hollow-migration-fixture.ts`
- `tests/payroll/hollow-migration-graph.test.ts`
- `tests/payroll/hollow-migration-runtime.test.ts`
- `tests/payroll/hollow-migration-integrity.test.ts`
- `tests/payroll/hollow-migration-adjustments.test.ts`
- `tests/payroll/hollow-migration-proof-package.test.ts`
- `app/lib/payroll/central-hollow-deduction-provenance.ts`
