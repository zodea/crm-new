# P3 B 完成与验证

基线 `4738be98730955cd63832c8df04fc6f1d855caff`。B 产品及精确测试已冻结，9 个唯一文件见 `owned-files.json`；B 是本期作者，不作为最终独立审查人。未修改 A/C 文件，未执行完整测试、类型、构建、服务、浏览器或提交，整批集成归 Root。

## 实际实现

- 三个同事务 loader：项目月全部签工、原 stable ID 单记录、项目×负责人 C2 配置。保留原组、draft/confirmed、软删、精确数值、明确零、NULL、非法原值和未知原列；坏日期不被月过滤吞掉。逐条原文 SHA 与范围版本含占用、相关头/来源、诊断和完整迁入证据；隔离原行仅定位旧 ID 与映射，不补造可写实体。
- 逐条领用独立于人员月锁；有效未发领用挡第二工资抢源，原签工仍可合法更正并令工资需重核。已发软删头/关联、原冻结签工、C2 source/document 与新 dayworkLinks 都保留明确占用；完整零成员或可定位原签工保留月锁，不因重建新 ID 解锁。
- C2/daywork receipt 按各自原命令与结果 codec 解析，校验 canonical、SHA、SQL 元数据及原范围；收集真实 record/config/statement/link ID、原/新项目人员班组。SQL NULL 原正文只保留已有 SQL 引用；非空坏正文、未知动作或字段、错误目标不得跳过。
- 恢复删除前并入 C2 source 表、冻结 source/document/links、before/after 审计和 receipts 的封闭引用。只识别既定路径，不递归猜 original 中的 ID。迁入候选复用同一领用/月锁投影，不扩大到无关人员或项目。

## 有效验证

最终命令与日志 SHA 见 `validation.json`。`final-validation.log`：**8 文件、73 项全部通过，23.63 秒**；包含 B 的 3 文件 26 项以及既有 A/C1/P0/Native 签工回归。9 个文件精确 ESLint 通过，固定基线 tracked diff 检查通过。Root 最终类型与完整集成尚未执行，不将本结果代称为整批通过。

- SQLite 原行保真；公开迁入隔离原组仍可定位；相邻半工和待确认事实不丢失。
- 真实保存/人工确认/C2 配置及保存→核对→发放链产生健康证据，再依次只保留 source 表、source 前/后审计、冻结 source、冻结审计、冻结 document、冻结物理 links，危险恢复均删除前拒绝且整库/owner 不变。
- 真实回执对照覆盖仅回执、SQL NULL 原正文、坏正文、未知字段、异目标结果、未知动作；真实 C2 各工资动作收集实际 config/daywork/link 引用。
- 已领用未发签工合法编辑成功且工资需重核；新候选 C1 真零与独立 C2 同人冲突拒绝，无关人员候选可准备并 abort；另一项目存在真实已核 C2 来源时，本项目可单独准备恢复。
- 明确真红轨迹：`raw-red.log`（原日期诊断）、`evidence-red.log`（隔离证据）、`source-month-red.log` / `document-lock-red.log`（残存来源月锁）、`frozen-links-red.log` / `frozen-links-month-red.log`（新物理关联引用及月锁）。最终全绿覆盖上述修复。启动 EPERM 与早期 Native 夹具的 NULL/空串差异是环境/夹具问题，不计产品缺陷；`c2-source-red.log` 当时 public c2Form 尚未接通，不宣称为独立业务失败。

本部分没有新业务 grill 或未决实现项。临时日志和本说明保留供 Root 统一归档及安全清理；本作者未删除任何文件。
