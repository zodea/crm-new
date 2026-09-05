# 本地分支整合记录

> 2026-09-05；非权威源，仅记录本次 Git 整合依据与恢复入口。

## 整合依据

- 共核对 25 个本地分支、1 个工作区。远程 origin/main 为 44d0ca70，与审计基线 648b91e4 的文件树完全一致。
- 班组成员分支 c1af894f 含独立功能，按正常合并保留添加、转组、移出及对应指南。冲突处保留本轮表单会话隔离；成员重试改为页面独立的单条操作。
- 其余功能分支没有尚未纳入的独立补丁。旧 main 997fe08e 与当前历史中的 d9d19b7c 仅有换行、依赖排列和测试导入位置差异。
- 旧 review 分支的六项工作（项目导出、送货单原件、付款主客户、OCR 样例隔离、缺号发票、归档审计与导出偏好）已被当前实现覆盖；保留当前更完整实现及修复。
- 对上述等价历史使用保留当前文件树的合并，合并后索引与合并前文件树完全一致。原分支头作为 main 的祖先保留；删除本地分支名称不会删除这些提交。
- 合并验证：类型检查通过，383 个测试文件、2,174 条测试通过；班组与工人 8 条浏览器旅程通过，含四档视口。
- 只整理本地分支，远程分支和远程 main 未改写。

## 原本地分支头

需要恢复某分支时，可从下表提交重新建立分支。审计分支记录的是合并班组功能后的头，包含本轮全部修复。

| 分支 | 原提交 |
| --- | --- |
| codex/browser-audit-docs-memory-20260905 | e7894589 |
| codex/crew-member-management | c1af894f |
| codex/issue-277-material-contract-zero-chain | b16facca |
| codex/issue-281-partner-identity-chain | 9f10bf6d |
| codex/issue-282-construction-subcontract-detail | 8e10e4c7 |
| codex/issue-283-owner-documents-detail | a132aedb |
| codex/issue-289-target-registry-return-to | 366d617d |
| codex/issue-314-customer-central-chain | 6998adcb |
| codex/issue-315-supplier-central-facts | 75e821bf |
| codex/issue-316-crew-worker-central-chain | 6c702a28 |
| codex/issue-317-project-supplier-facts | 48a47f70 |
| codex/issue-318-material-contract-detail | 304084e8 |
| codex/issue-319-project-material-supplier-journey | e6e04bb3 |
| codex/issue-320-construction-contract-detail | 17105b02 |
| codex/issue-321-subcontract-detail | 2183c063 |
| codex/issue-322-supplement-focus | f89b986e |
| codex/issue-323-owner-documents-detail | 9198686b |
| codex/issue-324-acceptance-warranty-canonical | 17b2c7bb |
| codex/issue-325-owner-final-settlement-canonical | b4d48a0c |
| codex/issue-326-owner-deduction-readonly | c1fe0845 |
| codex/issue-327-subcontract-change-readonly | 648b91e4 |
| codex/local-main-before-sync-20260815 | 9e1bb416 |
| codex/remove-claude-launch-config-main | 4a5ab95d |
| codex/review-head-fixes-20260811 | 776d2a41 |
| main | 997fe08e |
