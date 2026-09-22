# P3 独立 Spec 产品预审

独立审查人 `/root/c2_b_independent`。固定比较基线 `4738be98730955cd63832c8df04fc6f1d855caff`。范围是 A/B/C 与 Root 两个共享读面文件，共 70 个产品路径（包含删除的旧签工入口），已读取 tracked 差异及新增产品全文；输入身份见 `pre-review-inputs.json`。本记录为实施期预审，已报告问题等待 C 修复与独立复验，不是最终无阻断或浏览器验收结论。

## 已复现问题

1. **签工原稿刷新后沿用过期权限与提交依据。** P3 验收「草稿与来源往返」要求“撤权、未知响应和成功冷读失败逐项检验。失败不清内容/证明信息”；COMMANDS 要求明确未应用后重新读取并重确认。`usePayrollDayworkForm.ts` 的新读 watch 将缓存旧 `read` 恢复为可写依据，新读仅保留为 `latest`；`editable` 与 `save()` 仍消费旧对象。独立组件测试先填写原稿再刷新到只读，实际输入仍可编辑；刷新到 `current-v2` 后再次保存仍传 `v1`。日志 `daywork-reload-reproduction.log`：2 个行为断言失败。修复必须保原稿，但以最新真实权限立刻停止编辑；更新提交依据需要明确重新核对动作，不能静默把旧稿提升为新依据。初始第二例表达的是用户重读后再次明确确认，若采用单独的重新核对按钮，独立复验将改用该实际动作。
2. **新增 C2 分支破坏既有 C1 来源返回。** P3 要保留既有来源往返及 A/C1 边界。`CrewWorkerCentralDetailScreen.vue` 在 C1 `v-if` 和 A `v-else-if` 中插入 C2 独立 `v-if`，导致 C1 来源同时渲染 C1 与 A 两套返回。实际组件独立复现见 `c1-source-return-reproduction.log`，C1 已出现时 A 仍出现。C2 应与 C1/A 组成一个互斥分支。

## 已通知实施方的同类接缝

- `PayrollDayworkConfirmDialog.vue` 使用打开时 `props.read`；明确未应用的旧依据错误之后没有保留证明信息并重新读取/核对的操作，重复确认会继续携旧依据。关闭重开会触发放弃输入。需要同样保稿并明确更新原依据；尚未将此代码判断计为新增独立运行反例。
- A 已修复 C2 原命令返回 `needs-recheck` 后被另一窗口重新核对导致永久等待的问题。`usePayrollC2Statement.completed()` 仍按原结果无条件写“已保存为需重核…请先重新核对”，实际后读可以是已重新核对或已发。应说明原提交与随后变化，同时保原实发分配；不能用旧状态文案代替当前事实。尚待 C 更新和运行复验。

## 规格对照

| 验收义务 | 已读实现链路 | 预审结论 / 运行边界 |
| --- | --- | --- |
| 无工程量直接签工、空项目/月、配置/待确认/占用/历史可辨 | participant-options、daywork-service、c2-service、三个页面 | 当前项目资格不依赖 BOQ 或 quantity:read；不同事实有独立状态，待浏览器逐态验收 |
| 整工/半工、日期时段、证明及晚确认 | daywork codec/service、fields/confirm | 后台严格校验 1/0.5、有效日历/日内时段、证明与确认日期；没有自动免费或处罚逻辑 |
| 同日相邻半工、待确认参与上限、原/新范围 | daywork-service、B facts/locks | 同人同项目同日全部有效行参与；编辑排除自身，原与目标范围同时验互斥 |
| 项目×负责人配置、当月 100%、350×1.5=525 | c2-service/calculation/command | 未消费 A 比例/合同价/前月实发，配置价与空规则保原精度/原文 |
| confirmed 唯一逐条领用 | c2-service、source-locks、c2-command | 来源由服务选择，客户端不可传任意 ID/金额；当前关联与来源在同事务保存 |
| 内容/证明/原时间相同也需重核 | daywork-facts、C2 source/version、markRecheck | 原行完整指纹、配置、资格、全员和其他占用进入核对；保旧关联软删记录 |
| C1/C2 并发互斥、A可并存 | 共用source-locks、workspace事务 | 同一份投影服务日常与迁入；具体最终并发证据由 Root 独立服务测试承担 |
| 525核算、500唯一实发、350/150/0完整分配 | c2-command、provenance | 金额到分且正数/不超核算；全成员精确分配；同键回执及冻结互证 |
| 已发全成员月锁、软删不释放 | B source-locks、daywork-service | 负责人/全成员及可证明冻结事实参与；无签工零成员保锁，B独立审查已单独完成 |
| 迁入、原文、危险恢复 | B facts/migration/references | 9 输入先独立核验；新增跨项目回执唯一证据对照通过，不猜未知original引用 |
| pending、后读、撤权、迟到、草稿往返 | 两store、五composable、return组件/navigation | 原键可靠保留、可信后读要求存在；上列界面缺陷待修；浏览器冷恢复待验 |
| 五档视口/键盘/浮层/滚动 | 局部表滚动/表单/Dialog组件 | 静态实现只支持继续运行验收，未代称视口通过 |
| 配对工资+签工打印及XLSX、后改名改价不改旧单 | provenance、frozen-print、c2-export、通用detail | 输出来自专属冻结与原来源/回执；原价/半工/空规则/全员分配存在；真实下载/PDF逐页待验 |
| 浏览器中央与Tauri原边界、不冒称P4–7 | routes、Repository/API、工资台账/detail分派 | browser新写走中央；新整页/Native守卫明确；没有新增更正、费用、整册或生产持久化声明 |

未改任何产品、作者测试或权威规格。独立新增 `tests/components/PayrollC2SpecIndependent.test.ts`；初次错误使用不存在的测试 project `components` 只发生配置启动失败，后用实际 `component` 进入用例复现，不将配置错误计作业务失败。没有 full/type/build/dev/browser、依赖安装、提交或外发。
