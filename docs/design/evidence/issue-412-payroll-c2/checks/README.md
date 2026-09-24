# P3 C2 验证证据索引

本目录保存各作者和独立审查人在 2026-09-14 的原始证据，比较基线为 `4738be98730955cd63832c8df04fc6f1d855caff`。这是分轮归档，**不代表 Root 对当前最终源码的全量测试、类型检查、构建或提交已经完成**。文件名中的 `final` 只表示该作者当时的验证轮次。

[source-map.json](source-map.json) 逐项记录 123 份原文件的来源、正式位置、字节数、SHA-256 和轮次含义；所有原文保持不变。历史报告中的待办和代码身份是当时快照，应结合后续增量阅读。旧 C 的 53 文件身份、旧 Root 清单或任何作者的局部清单均不能替代 Root 最后的完整代码身份。

## 作者与独立审查

| 范围 | 原始入口 | 已记录的运行范围与限制 |
| --- | --- | --- |
| A：领域、服务、HTTP、Repository、store | [validation.json](a/validation.json)、[合同](a/contract.md)、[代码身份](a/code-hashes.json) | 首轮精准回归 14 文件、42 例；随后全成员月锁 5 文件、12 例；定点传输 5 文件、9 例。各轮有重叠，不相加为独立总数；含原 A/C1 精准回归 |
| B：事实、锁、迁入及恢复 | [validation.md](b/validation.md)、[validation.json](b/validation.json) | 8 文件、73 例精准回归；原行、隔离、物理领用、旧证据及冻结残存保护见同目录日志 |
| B 独立审查 | [review.md](b-independent/review.md)、[validation.json](b-independent/validation.json) | 独立新增 1 例；包含作者回归的 4 文件、27 例不冒称全部由审查人新增 |
| Spec 独立审查 | [review.md](spec-final/review.md)、[validation.json](spec-final/validation.json)、[视觉后续审查](spec-final/visual-followup-review.md) | 2 文件、8 例独立断言通过；签工刷新、C1 来源返回、无签工成员月锁等发现已复验。审查范围与之后视觉变化分别记录 |
| Standards 交叉审查 | [cross-review.md](standards-final/cross-review.md)、[身份](standards-final/cross-review-identities.json) | C 作者独立读取 37 个非 C 源码身份；不签署自己的 C 产品。C 范围另见 [Root 审查](root/standards-c-review.md) |
| C：界面、导航与输出 | [validation.json](c/validation.json)、[验收映射快照](c/acceptance-map.md) | 13 文件、30 例；审查修复 7 文件、17 例；视觉后续 4 文件、22 例。各轮重叠。原报告中的浏览器待执行由后续实际证据补充，原文不倒改 |

## 验收增量 G1–G4

[独立增量报告](spec-final/acceptance-gap-review.md) 已逐项核读 Root 新增断言：同人两个半工汇总并保存/核对、前月实发不扣次月工资、真实迁入停用或 NULL 单价阻断建单、C2 实发同键异文拒绝。这四项补齐 [C 旧映射](c/acceptance-map.md) 中记录的证据缺口。

[acceptance-gap-checked-final.log](root/acceptance-gap-checked-final.log) 是 Root 执行的 **2 文件、14 例通过，8.48 秒**；Spec 独立核读，没有冒称执行这些测试。前面的 [first](root/acceptance-gap-first.log) 两项失败来自测试预期错误，不是产品缺陷；[final](root/acceptance-gap-final.log) 虽已 14 例通过，当时 G1 尚缺 `check-c2` 断言，须以 `checked-final` 为完整增量。此过程中没有产品改动。

## 失败与修复的可追溯入口

- 定点传输：A [C2 红](a/fixed-decimal-red.log)、[C1 红](a/fixed-decimal-c1-red.log) → [绿](a/fixed-decimal-green.log)；Root 通用详情 [红](root/detail-decimal-red.log) → [绿](root/detail-decimal-green.log)。保留极小/极大有限价和 `350.125`，金额仍到分，不接受指数传输。
- HTTP 原价与异常读取：A [HTTP 首次失败](a/c2-http-first.log)、[负例失败](a/negative-first.log) → [负例通过](a/negative-green.log)；通用详情修复归 Root，专属 wire 归 A，见各自说明。
- 原命令后读恢复：A [同目标失败](a/stores-target-red.log) → [通过](a/stores-target-green.log)；Spec 的 [刷新复现](spec-final/daywork-reload-reproduction.log)、[来源返回复现](spec-final/c1-source-return-reproduction.log) → [最终精准回归](spec-final/final-identity-regression.log)。
- 全成员月锁：Spec [无签工零成员复现](spec-final/zero-member-lock-reproduction.log) → [通过](spec-final/zero-member-lock-green.log)；A [跨项目/月补充回归](a/month-lock-final.log)。状态筛空保锁，不造签工事实。
- B 原文、月份及残存证据：[原行红](b/raw-red.log) → [绿](b/raw-green.log)、[隔离红](b/evidence-red.log) → [绿](b/evidence-green.log)、[月份红](b/source-month-red.log) → [绿](b/source-month-green.log)、[冻结物理链接红](b/frozen-links-red.log) → [绿](b/frozen-links-green.log)；其余残存来源见 [最终范围说明](b/validation.md)。
- C 确认与重核：[确认重核失败](c/confirmation-recheck-red.log) → [审查修复通过](c/review-fixes-green.log)。浏览器发现后的视觉修复见 [后续组件通过](c/final-visual-followup-green.log) 及下方实际图。

部分早期 `red` 日志只证明尚无方法、模块或接线，不能当成已存在产品行为缺陷；逐项分类见 `source-map.json`。B 独立首轮日志的 `EPERM` 属于环境启动失败。无输出的 lint 日志结合对应 validation 的退出码解释，不能仅凭空文件声称通过。

## 集成与实际交互分轮

[npm-test-final.log](root/npm-test-final.log) 是中间集成失败：681 文件中 4 失败、677 通过，3957 例中 6 失败、3951 通过。其后 [npm-test-final-second.log](root/npm-test-final-second.log) 为 **681 文件、3959 例通过**，但发生在后续视觉修复之前，标记为 **pre-visual**，不代替当前最终全量验证。Root 后续完整检查、类型、构建、最终代码身份和总 verification 由 Root 另行归档。

[browser-visual-final.log](root/browser-visual-final.log) 记录新轮 5 场景通过。最终选用图由新轮场景和旧轮未被替代的 4 场景组成，精确来源见 [视觉归档映射](visual/archive-map.json)：165 张浏览器原图、8 份完成证据 JSON、2 份实际 PDF、2 份实际 XLSX；映射另包含 14 张指南渲染图和原始审查报告。未复制 source fixture、trace、视频或数据库，也未把被新轮替代的旧图重计。

- 恢复视觉：[原轮报告](visual/recovery/review.json)、[最终补图报告](visual/recovery/final-round.json)。最终补图关闭底部按钮、后读失败提示、展开当前事实及保留原输入的覆盖缺口；原报告保留。
- 主流程视觉：[85 图逐张报告](visual/main/main-visual-final-review.json)。旧报告保留 390px 表格右端与最新 Notice 的覆盖限度；[补图审查](visual/main/main-visual-supplement-review.json) 已核读 16 张原图（15 张有效，保留 1 张旧 1024px 未覆盖帧，最终替代帧关闭该缺口）。补图与完成证据另见 [独立路径映射](../interaction/supplement/source-map.json)，不改前轮报告或重算原 165 张图。
- 两份指南：[14 页逐页报告](../guide-review/review.json)，记录原 PDF 身份、页码、原图身份和版面结论。
- 长输出：[独立目检报告](visual/long-output/review.md)、[正式路径映射](visual/long-output/source-map.json)。此范围由独立审查人归档，本索引不改其原文或图片。

## Root 最终交付检查

上述作者归档保持原轮次；Root 另附 [最终完整测试](delivery/npm-test-delivery-final.log)：682 文件 / 3964 项通过，284.98秒；[类型](delivery/typecheck-delivery-final.log)及[构建](delivery/build-delivery-final.log)通过。112个代码文件[规范检查](delivery/lint-delivery-final.log)仅报告一个测试标题首字母问题，改成小写后[单文件复查](delivery/lint-title-final.log)通过，产品和断言未变；正常提交检查另记回执。代码身份见 [code-identities.json](../code-identities.json)。

[Root 最终 Standards](standards-root-final.md)补足 C 最后54路径和三项视觉修正；[最后15张有效补图及1张旧缺帧](visual/main/main-visual-supplement-review.json)关闭右端与说明文字的覆盖缺口。[补图路径映射](../interaction/supplement/source-map.json)保留原缺帧及独立替代帧，不覆盖旧图。有效交互总180张；短输出2页、长输出10页、指南14页分别计数，Root短输出与独立重点检查见[目检记录](visual/root-review.json)。

最后将签工覆盖账本的旧“实施中”改为已验收状态，并重新同步生成文档后，[最终元数据完整测试](delivery/npm-test-metadata-final.log)再次通过：682 文件 / 3964 项，263.07 秒。最终112项代码身份已包含该文字修正；产品、断言及三项视觉修正未再改变。[身份增量独立复核](spec-final/delivery-identity-review.md)保留当时清单待更新的事实，本次已将该单项身份更新。

审阅报告实际验证了46个 Issue、#412的16步切换、18节点/27连线和83个本地证据链接；窄屏无根级横向溢出，见[报告验证](../report/verification.json)。报告截图证明报告本身的呈现，业务交互验收仍以上述实际场景为准。

本索引不改原证据，不把中间通过提升成最终，也不代替每个实际检查的范围和输出。
