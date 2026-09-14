# P2 正式验收证据索引

本目录是 2026-09-14 的 P2 证据归档接缝。固定基线为 `579d9383357fffd2bd87e727dbc21b903a7cb69c`；归档时产品范围已冻结，后续提交 SHA 由主任务登记。这里保留作者和独立审查人的原始范围，不把单项通过扩展成生产部署或全部工资功能已完成。

## 当前输入与阶段记录

| 范围 | 正式入口 | 解释 |
| --- | --- | --- |
| A，40 个文件 | [所有权](a/owned-files.json)、[作者验证](a/validation.json)、[作者指纹](a/code-hashes.json) | 包含 C1 详情两套明细费率 `60.125` 的真实 HTTP 红绿，6 文件 / 20 测试回归与 2 文件 lint |
| B，11 个文件 | [所有权](b/owned-files.json)、[作者验证](b/validation.json) | 最后追加 shared-exclusion 5 文件 / 36 测试绿；旧顶层 awaiting-review 是作者交接时点 |
| C，52 个文件 | [所有权](c/owned-files.json)、[作者验证](c/validation.json) | 原文顶层 ownedFiles=51 和 remaining/browser 是早轮记录；实际清单为52，后续独立审查及本轮图另有证据 |
| 独立 Spec 阶段 | [报告](spec/review.md)、[当时87项输入](spec/final-input-hashes.json) | S1/S1a/S2/S2a 六条原反例最终通过，红绿日志与报告同目录；此后源码有11个已知差异，不倒填历史指纹 |
| 最终 Standards 与有界 Spec 增量 | [报告](standards/review.md)、[最终输入](standards/final-inputs.json) | A40/B11/C52 共103个 owned 输入与当前文件逐一匹配；0硬违规、0增量缺项，非阻断重复规则线索仍保留 |
| B 独立迁入发现 | [原报告](b-independent/review.md)、[作者修复绿日志](b/shared-exclusion-green.log) | 原报告的1项阻断/5真红是修复前历史；后续共用图提取修复与最终独立报告限定其消项，不篡改原发现 |

[最终代码指纹](code-hashes.json)覆盖112个唯一文件：103个作者文件以及9个Root/独立文件。相对于上一份正式摘要，只有主E2E新增等待名称断言的指纹变化。[逐项核查](code-verification.json)保留该差异和各阶段输入比较。作者 validation 的旧 remaining 不代表当前未完成；最终全量、类型、构建、浏览器及提交仍由主任务的整合结论负责。

## 本轮图与实际文件

| 原图范围 | 正式评审 |
| --- | --- |
| A 主链40图 | [release逐图记录](a/source-image-review-release.json) |
| C 草稿、配置及分配40图 | [release逐图记录](c/source-image-review-release.json) |
| 独立恢复、只读等40图 | [release逐图记录](standards/source-image-review-release.json) |
| 配置名称完成后的5张只读补图 | [逐图记录](a/config-scope-supplement-review.json)、[原scope与零写入](a/config-scope-supplement-verification.json) |
| 两份指南13页 | [逐页评审](a/guide-final-review.json) |
| 实际工资/考勤配对PDF两页 | [Root评审](actual-pdf-review.json) |

[原路径至正式图片映射](image-source-map.json)覆盖全部140张已归档图：120张release、5张配置补图、13页指南、2页实际PDF。125张浏览器图与原评审记录SHA、原图和正式副本三方一致；15张文档渲染图的原评审没有逐图SHA，本次只核指定原图与正式副本字节一致，不补写历史签字。没有漏图、重复映射或哈希不符。

已发明细 `60.125` 与390px正常工时合计 `7.51` 在本轮可见证据中闭环。C原主旅程3张配置截图保留Lookup名称尚在读取的过渡态，由同实例5张只读补图补足名称证据。首屏以下不自动算作已目检，也不因单张折下判产品缺陷。

`standards/source-image-review-final.json` 仅是release报告引用的修复前历史，不用于给当前图片盖章；本轮正式图片对应关系只以release及补图映射为准。原审查中的临时绝对路径原样保留，可从映射查询正式位置。

## 归档完整性与旧副本

[归档清单](archive-manifest.json)登记原件到正式副本的逐文件SHA，所有复制件保持字节一致。报告引用的红绿日志留在原相对目录；本目录的局部忽略例外只允许这些验收日志纳入提交。原临时目录与产品源码未修改。

[旧同义文件清单](retire-duplicates.json)列出15份旧副本及替代位置。Root 已核对替代原件、绝对路径、文件指纹及未跟踪状态，更新上层入口后将15份旧副本送入回收站，可恢复；正式子目录保留完整记录。
