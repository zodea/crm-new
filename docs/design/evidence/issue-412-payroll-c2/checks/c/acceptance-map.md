# P3 C2 验收覆盖映射（收口中的事实记录）

记录者：`/root/wbs_central_backend`，本期 C 界面作者。固定比较基线 `4738be98730955cd63832c8df04fc6f1d855caff`。本表是逐条证据定位，不是对本人代码的独立审查，也不修改或提前勾选正式票。对应本地票 [13 组 AC](D:/crm本地项目开发/docs/research/issue-review-2026-09-11/payroll-tickets/03-central-c2-daywork.md:122)。2026-09-14 编制；四项精确运行缺口已交 Root 独立补验，最后视觉轮另行绑定实际图片身份。

## 证据层级与本轮身份

- **public-service**：真实 SQLite 与公开 service/HTTP/Repository 产生及读取事实，检查金额、原表、关联、审计/回执；不以组件替身代替事务证据。
- **component**：实际 Vue 页面/composable/弹层行为；依测试实际情况使用 store 替身。证明保稿、权限呈现、基准采纳和生命周期，不单独证明后台原子性。
- **browser**：Root 启动的隔离中央实例、公开 SQLite 迁入后真实 UI/HTTP 操作。`root/browser-final.log` 是 **7 通过、2 失败**，失败分别为 Home 水平归零的错误测试假设及以 region 定位实际 dl。修正后 `root/browser-final-two.log` 两项通过（主链 59.6s、历史只读 2.7s），合起来覆盖 **9 个唯一旅程，分两轮完成**，不是某次整批 9/9。最后三处展示修复另待受影响场景重验。
- **visual**：必须逐张原图或逐页原 PDF 检查。组件通过、根宽度断言、PDF 文本提取均不能代替视觉结论。
- `root/npm-test-final-second.log`：681 文件、3959 项通过，273.70s；这是后续确认弹层留白、Notice 文案及打印 html 白底调整之前的整仓结果。后三处已有 `c/final-visual-followup-green.log` 4 文件/22 项、5.17s 与精准 lint 0；最终集成/提交仍由 Root 登记，不将前一全量结果套给新字节。
- A `a/final-targeted.log` 14 文件/42 项；B `b/final-validation.log` 8 文件/73 项。A 月锁与固定小数增量另见 `a/validation.json`，不能把重复运行累计成新增用例数。
- 独立 Spec：`spec-final/review.md`；独立 B 真实恢复：`b-independent/review.md`；Standards 按作者隔离：`standards-final/cross-review.md`（A/B/Root）与 `root/standards-c-review.md`（C）。这些报告各自有输入身份及边界，最后展示增量仍由 Root/独立审查员核实。

## 13 组对应关系

| AC | 已读到的 public-service / component 断言及实现入口 | 实际 browser / visual 证据 | 当前裁定与限制 |
| --- | --- | --- | --- |
| 1 真实入口与空态 | `central-daywork-service.test.ts:4` 实际无工程量直接项目、无月空台账、坏非空月拒绝；`central-c2-commands.test.ts:32` 只有待确认不能保存空工资；`central-c2-independent.test.ts:139` 败方看到 occupied 原记录并再次禁建；`daywork-facts.test.ts:35/51` 隔离原组、坏原值/NULL/0 和原文保留；`PayrollC2SourceReview.test.ts:6` 待确认/占用原行及不同原因仍可见，`PayrollC2Config.test.ts:25` 缺值不伪零。实际入口 `createPayrollDayworkService`/`createPayrollC2Service`。 | 主链经真实迁入建立无工程量项目，空签工→待确认→确认→C2；readonly 拒权和显式 demo 各一条已通过。主链初始、来源与配置五宽图待本轮逐张复验。 | 主要链已证。**G3：迁入停用/NULL 单价配置在公开 c2Form/命令上禁建**仍缺精确运行证据；已有 loader 保真不能替代此项。 |
| 2 登记与人工确认 | `central-c2-commands.test.ts:17` 真实拒坏日历、逆时段、0 工、空内容、confirmed 缺证明/提前确认，失败后表为空；`central-daywork-service.test.ts:20` 待确认后人工确认且超过两天仍 1 工；`central-c2-independent.test.ts:33/87` 最后身份等待后撤权/移项目整库不变；`PayrollDayworkForm.test.ts:38` saved+confirmed 提示按真实 status；确认弹窗 tests 保证明、日期。后台 `validatePayrollDayworkRecord`/人员资格投影负责严格新写。 | 主链通过整工/半工、人工确认日期 8 月 5 日、取消回焦点、保存并确认；不是按脚注罚扣。未知响应签工冷恢复保持 0.5 工/日期/内容。 | 业务路径有直接证据。原确认浮层贴边是真视觉问题，已修调用方 padding/局部滚动，**最后修后五宽待 QA**。不把样式修复解释成确认业务变更。 |
| 3 日内边界 | `central-c2-commands.test.ts:4` 两条相邻待确认半工允许；11:59 重叠及第三半工拒绝，最终恰两行/两回执；`central-c2-independent.test.ts:63` 原记录改人改日到真实零考勤范围失败，旧新所有表不变；旧 `signed-daywork.test.ts:119` 的时段/工数验证保留为原领域回归，明确不是中央 HTTP 独立证据。 | 主链登记合法整工/不同人半工；未用它冒充相邻双半工边界，边界由前述公开 service 运行承担。 | 保存/冲突/原范围边界已证；**同人两半工最终金额**归 AC4 的 G1，不能从保存成功直接推算通过。 |
| 4 配置与月核算 | `central-c2-service.test.ts:4/43` 项目×负责人配置、正价 350/空规则与不同人 1+0.5=525；`central-c2-codec.test.ts:26` 拒错负责人/项目读取；`central-c2-http.test.ts:15` 真 HTTP 350.125 与 525.19、极小/极大有限价定点传输；`central-c2-calculation.ts` 逐人按当月采用 facts 合计，命令冻结 `periodKind=monthly/payRatio=1`，没有 A 累计字段或 C1 费率消费。 | 主链真实 UI 350→525，配置与原 draftKey 往返；长输出 350.125×42=14705.25 的实际文件回读已通过。 | **G1：同人 0.5+0.5→350；G2：上月已实发500后下月1工仍350**尚缺中央公开运行链。实现检查可说明算法边界，不能代替这两个票内明确数值例。 |
| 5 逐行唯一来源 | `central-c2-service.test.ts:43` 采用确切两个 confirmed ID，另一个 draft 仍在事实里但不采用；`central-c2-independent.test.ts:139` 两负责人同时争一 source，最终一头/一有效链接、败方 occupied 且无源禁建；HTTP 末尾发送 `check-c2.sourceRecordIds=[]` 被拒；`c2-source-locks.test.ts:8/40` 未发占用、软删已发关联、缺头及可定位冻结证据不消失。 | 主链 source return 按实际 recordId，发放后 c2Output 的 daywork IDs 恰为原整工和半工；原关联无编辑入口。 | 直接来源及跨簿唯一性已证。纯锁投影的损坏历史样本只证明保守占用，不能称健康发放。 |
| 6 指纹与未发更正 | `daywork-facts.test.ts:15` 不改更新时间只改备注，源版本和行指纹改变；`central-c2-independent.test.ts:74` 同总工数/同更新时间改证明人，旧 release 返回 needs-recheck，冷读保留且无分配；`:169` 已核对原签工可合法降 draft，旧采用快照/链接仍保留；`PayrollDayworkConfirmation.test.ts:68`/独立组件明确重读采纳，保原证明/日期；完整 record/config/资格被 service source hash 和专属 source snapshot 收入。 | 主链已从原工资进入原签工，只改内容且工数不变→回原单看到需重核→重新核对再发放。配置恢复及 S1 后续更新有真实往返证据。 | 代表性的同量变正文、配置及资格运行反例已证；不声称每个字段的笛卡尔组合都单独跑过。完整字段参与指纹另由源码/独立审查佐证。 |
| 7 双向并发互斥 | `central-c2-independent.test.ts:49` 并发零考勤与待确认签工恰一方成功，只有一种事实/一个回执；`:63` 移动旧、新范围同验；`c2-migration-protection.test.ts:140` 同人/无关人真实候选区分，迁入也走共同窗口；`central-source-locks.ts` 复用完整成员与来源投影，A 不作为 C1/C2 排他事实。 | 没有把单一浏览器 happy path 计作并发验证。并发证据来自公开 service 和迁入集成的最终表断言。 | 已有真实并发/零/原范围/迁入覆盖；A 与 C2 同人不误锁依共享 helper 及既有回归，不冒称本期浏览器专门操作过 A。 |
| 8 实发与全成员锁 | `central-c2-service.test.ts:19` 525/500/350+150+0、同键同文只一 release 回执，后来改名改价冻结不变；`central-c2-commands.test.ts:32` 到分/超核算/漏零/NULL零/不等额失败且无分配回执；`central-c2-independent.test.ts:103` 无源零成员补签、原已发改人跨月均拒且全库不变；`c2-source-locks` 软删头/成员/链接仍锁；`c2-spec-independent` 真实全员锁在无签工/状态筛空台账仍可见。 | 主链差一分禁确认，真实后端成功但中断响应→沿原 commandId 恢复，冷读 500 和三人分配；只读来源及无签工零成员月锁可见。 | 一次实发及全员锁有直接证明。**G4：C2 release 同键异文拒绝**没有直接运行断言；签工同键异文经过另一 service 分支，不能代验。实际成本消费者的完整接齐属后续，不称 P3 已实现成本汇总。 |
| 9 历史与恢复 | `daywork-facts.test.ts:35` 真 SQLite 导出/确认后的隔离原组和映射；`c2-migration-protection.test.ts:22/52/74/186` 不相关项目可准备、配置回执、源表/前后审计/冻结/链接/checked-edit 等单一残存证据拒危险恢复，repeat 全库不变；独立 `c2-b-independent.test.ts:26` 跨项目移动后仅原回执仍保护，移走唯一回执的对照可准备；`central-c2-detail.test.ts` 坏回执不能 complete，原姓名/null 保真。 | 旧 C2 缺快照 readonly 第1例经 locator 修正已真正通过，原 actual100 可查、output unavailable；不造完整历史。 | 公共迁移及恢复有真实结果，不相关事实不会一概阻断；旧缺证据文案/原头当前最后视觉另验。生产持久化/灾备不属于此测试实例。 |
| 10 草稿与来源往返 | `PayrollDayworkForm` 与独立 `PayrollC2SpecIndependent` 覆盖撤权后保稿停写、显式采纳新依据、KeepAlive 不抬旧依据；`PayrollDayworkConfirmation` 隐藏期间迟到不 ack、不清稿；`PayrollC2Form` draftKey 切换失败不串稿/负责人真实班组；两 store 的真实 service tests 验 unknown/awaiting-read、只可信同目标纯读可 ack、released 必须 available 输出，S1 记录后来移范围可解除原成功并告后续变化；`c2-navigation.test.ts` 控制 return query。 | recovery 四条全部实际通过：新签工冷页原键、成功后读失败再合法更新且原输入与当前事实并存、配置原键空规则、迟到旧月份不盖新月/两类状态；主链配置→原 draftKey、原 record→原工资及取消回焦点。 | 行为覆盖直接，签工状态与工资状态不混。旧45图报告 V1/V2/V3 指出页尾/当前记录展开/失败顶部未入镜，Root 已补脚本，**新增原图仍待最后目检**。 |
| 11 五档视口与可达性 | 组件使用真实 Dialog/KeepAlive；样式由通用底座及领域局部滚动承担。主 E2E 每幅断言 document/shell 不横溢，ArrowLeft/Right 实际改变表内 scrollLeft、Tab 到原编辑链接；不是脚本直接设 scrollLeft 冒充键盘操作。 | 旧 recovery 45 图逐张报告：33 无覆盖缺口，12 有覆盖缺口、未见可视产品缺陷；主链 final-two 已实际通过5宽 capture，最后新85图及补 recovery 图待按 hash 全部目检。确认 Dialog 留白、Notice 口径已最小修复；长 PDF 白底另归 AC12。 | **暂不整组勾选**。本表不以测试通过替代逐图目视。每一最终图片必须记录路径/hash/实际观察者，C 自审标作者视觉 QA。 |
| 12 两种冻结输出 | `central-c2-service.test.ts:19` 改当前名册和配置后原 document 深等；`central-c2-codec.test.ts:61` 坏日期/证明/班组/原文/漏零成员不能完整；`PayrollC2FrozenPrint.test.ts` 工资+签工两表、空规则、原证明与三人分配且无考勤；同一 `PayrollC2FrozenPrint.test.ts` 还实际生成并重读 XLSX 字节，核对 525/500、零成员、空规则、时段/半工/证明。 | 主链实际下载并读工作簿、实际 PDF，冷刷新后仍可输出；长输出浏览器通过56条、28半工、空规则、后改价/规则冻结不变、两sheet、零成员、350.125和每条备注。旧长PDF10页独立逐页已证正文/重复表头/签字完整，第10页灰底为真实瑕疵；已修 html 白底，**新PDF需重生逐页目检**。 | 真实双文件行为已证，最终版式尚待新PDF/图。没有考勤表，也没有整月工作簿/电子审批。 |
| 13 职责与交付 | `PayrollCentralBoundary.test.ts` 7例保持 browser 中央/Native 隔离；`PayrollC2ReleasedEvidence` 拒旧已发冒完整；readonly 两例真实拒权/demo不可写。新独立路由、中央 Repository/HTTP/action 分派、通用精确单价 wire、范围说明及覆盖元数据均在最终路径清单。Root 权威文档/COMMANDS/READ-MODELS/DATABASE/ADR和指南另拥有。 | 指南 `guide-review/review.json`：工资7页+迁移7页共14页逐张原尺寸，文件前后哈希相同，未见可见裁切；原整仓681/3959、type/build与独立两轴报告已存在，但最后展示字节要以Root最终身份记录。 | **最终归档/提交仍待 Root**。本稿不填未知提交SHA，不宣称母#412、P4–P7或生产#416关闭；“已发后的独立更正与实际补退暂未开放”是当前产品边界。 |

## 真正尚缺的运行证据（不是已复现产品失败）

以下四项由本表读取者逐处查断言，并获 A 作者只读确认“未找到完整中央运行形状”。Root 已接手补独立公开服务测试，本文件暂不抢填结果：

1. **G1 / AC4**：同一人两条 confirmed 相邻半工经中央 c2Form/save/check 得到 350；当前只有两条待确认允许保存，以及不同人 1+0.5=525。
2. **G2 / AC4**：上月真实已发500，次月新1工仍完整核算350；不能借 C1 跨月测试或纯算法注释作为证据。
3. **G3 / AC1/4**：真实迁入 enabled=false 与未知/NULL 价分别使中央预览不可建并且命令拒绝；现有 loader 的 0/NULL/enabled 保真是必要但不充分证据。
4. **G4 / AC8**：真实 release 同 commandId 换金额/分配或正文，必须拒绝且原实发/回执/审计不变；现有签工同键异文不是同一 C2 command 分支。

这四项没有提出新业务决定，也不要求添加产品能力。若新增反例首跑即绿，应明确记直接通过，不虚构红绿。

## 最后视觉与交付仍待衔接

- `browser-visual-final` 主旅程按实际枚举逐张核对；当前待作者视觉 QA，不能借旧截图哈希。
- 最后 Notice 刚移除内部阶段号，只说明更正/补退暂未开放。旧轮图如果仍含阶段号须如实标旧状态，Root 另补最新 Notice 图，不据此重跑无关业务。
- 已保存的恢复证据存在 V1 页尾按钮、V2 当前原记录展开、V3 后读失败顶部提示缺口；需关联新增真实原图后才能关闭，不把未入镜视为通过或产品缺陷。
- 长输出旧第10页灰底保原瑕疵证据，新CSS修正后的PDF必须独立再看；所有文本/签字未裁事实与背景外观问题分别记录。
- 本期只完成 C2 的签工、工资实际发放及同次双表。独立更正、退回/后月抵扣和完整实际成本消费者归后续 P4；房补管理费、空鼓、资金建议与完整工作簿归 P5–P7；生产数据库、备份恢复及上线仍为 #416。

本任务只新增本临时映射，不修改正式票、业务、测试或报告。未启动测试/服务/浏览器；以上运行结果均明确引用已有实际日志与测试断言。

## 刚完成的受影响浏览器增量

编制末次读取 `root/browser-visual-final.log`：最后5场景全部通过（主链59.3s、长输出4.5s、旧缺快照2.8s、新签工冷恢复3.9s、成功后读失败及后续更正4.0s；合计1.3m）。这已证明修后行为脚本和补图生成完成，尚不等于新85张原图或新10页PDF已目检。下面由Root分派原图QA，各自另存路径与哈希。四个精确服务缺口仍以Root新增独立测试的实际结果另行闭合。
