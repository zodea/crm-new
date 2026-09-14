# P3 验收缺口 G1–G4 独立增量审查

审查人 `/root/c2_b_independent`，固定产品比较基线仍为 `4738be98730955cd63832c8df04fc6f1d855caff`。本次只独立读取 Root 新增测试、夹具真实迁入路径、权威契约及最终运行日志；未改产品或测试，未把 Root 的用例冒称为本审查人新增或执行。

**结论：G1、G2、G3、G4 均有有区分力的公开服务证据，可关闭；无新增产品规格问题。** 缺口编号沿 `c/acceptance-map.md`，验收义务来自 P3 实施票的配置/月核算、真实入口及实发清单。

| 缺口 | 实际断言与区分力 | 判断 |
| --- | --- | --- |
| G1：同人两个相邻 confirmed 半工合计 350 | 公开命令保存同人 08:00–12:00 与 12:00–16:00 两个真实半工；预览明确 1 工、350 单价、350 金额并保两原 ID；公开 save 后冷读两事实/350，再公开 `check-c2` 返回 checked，后读状态 checked、350、两事实。第一次增量复读指出少 check，Root 已补齐 | 已闭合。证明同人汇总及保存/核对链，不能由原来“两个待确认允许保存”推论的缺口现有直接证据 |
| G2：前月已发 500 后次月新 1 工仍 350 | 先真实前月发放并明确断言冻结 available；次月只采用新记录 ID，预览/保存冷读均 350；前月原冻结 document 恒定，前月零签工成员补签仍被已发锁拒绝 | 已闭合。既排除误扣前月实发，也排除借新月份释放旧月锁。available 前置避免 `null == null` 弱断言 |
| G3：迁入 disabled/NULL 价禁止建单 | Native 公共接口先生成健康配置与签工，仅在测试源库模拟可空历史表/旧配置状态；真实 SQLite 字节哈希、preflight/dry-run/import/confirm 后读中央服务。disabled 保 false 与 350.125；NULL 价保隔离证据原 `unit_rate:null`，不造有效配置。两例都证明有 confirmed 来源仍不可建，且命令拒绝、头/回执/审计/revision 不变 | 已闭合。已确认来源存在并明确对应 config-invalid/config-missing，拒绝不能仅归因于普通空来源。NULL 原文保真与合法配置隔离符合既有契约 |
| G4：C2 release 同编号异文拒绝 | 先公开真实 release，再沿同 commandId 改成另一份仍合法的 499 总额及 349/150/0 完整分配；返回 conflict，15 张相关事实表与原回执/审计/revision 不变；原命令仍返回同结果，冻结输出不变 | 已闭合。不同正文自身金额合法，失败不是普通金额验证；真实 C2 release 分支直接受验，不借签工命令分支代验 |

## 测试假定修正与运行归属

首次两处失败是测试预期错误：后续合法写入会改变当前读取 context/sourceVersion，要求恒定的是原冻结 document；NULL 单价的迁入原行按规则隔离，不应被当成有效配置。按现有权威修正这两个测试预期合理，不是放宽产品规则，也不是“先红再改产品”。本次没有产品改动。

最终日志 `root/acceptance-gap-checked-final.log`：2026-09-14 15:35:57 开始，**2 文件、14 例全部通过，8.48 秒**。其中既有独立服务文件由 9 增至 12 例，新迁入文件为 2 例。该执行归 Root；本审查独立核读用例是否实际证明相应义务，没有重复运行整套或生成新的浏览器结论。

## 冻结输入身份

| 输入 | SHA-256 |
| --- | --- |
| `tests/payroll/central-c2-independent.test.ts` | `e647f55b1b6517481e95ea99ae011a3e0a2f29911715004e560c1795f01215c3` |
| `tests/payroll/central-c2-invalid-migration.test.ts` | `db50f711a0fa1d287d8390a97873c31cdc91d4a403f9ff0d2e719b6ac22341a5` |
| `root/acceptance-gap-checked-final.log` | `a3075ac07e01dabce37b84b30e625d2a2c703289c4c10ecf9e3d829b3e67cec7` |
| 首轮修正预期后日志 `root/acceptance-gap-final.log` | `5afa6bb559e370750d55c3daf858e221bce8d397136cf78053668cbaf75b7f3c` |

## 视觉证据原样归档

第二轮十张逐页 PNG、`review.md` 与配套 `validation.json` 共 12 个文件，已逐个比对 SHA 后原样复制到 `docs/design/evidence/issue-412-payroll-c2/checks/visual/long-output/`，未修改报告正文或覆盖不同目标文件。另存 `source-map.json` 保留原路径、原 hash、归档 hash 及新 PDF hash；映射 SHA 为 `10eef50ab1d213bff4364d6e2942cf0869b8683e3014945326d87d5c0698c03f`。原第一/第二轮证据均未删除。

本增量不把之前的 110 路径快照继续称为现最终，也不重新授予其他全量、浏览器、视口、指南 PDF 或生产持久化的通过结论。
