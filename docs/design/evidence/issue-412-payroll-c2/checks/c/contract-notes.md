# P3 C 界面合同准备

> 2026-09-14，只读准备，非权威规格或验收结果。Root 正提交 P2；本次未修改产品、测试或长期文稿，未运行测试、服务、构建或提交。开始实施以 Root 给出的 P2 最终 SHA 和 A 正式公共合同为准。

依据：[`docs/research/issue-review-2026-09-11/payroll-tickets/03-central-c2-daywork.md`](https://github.com/zodea/crm-new/blob/212a1cb586af9396f4e4a9dbee50eeb7333e0cf5/docs/research/issue-review-2026-09-11/payroll-tickets/03-central-c2-daywork.md)、本期 `preparation/implementation-plan.md`、现行 NAVIGATION、ADR 0014 和 KitUI 整页契约。已读 `vue-best-practices` 及 reactivity/sfc/component-data-flow/composables 四参考、`vue-router-best-practices`、`vueuse-functions`。没有新增业务取舍或需要重问的已定规则。

## 1. 已核入口与独立路由

当前 `app/pages/subcontract/daywork.vue` 只有 `<SignedDayworkScreen />`，没有子路由出口；`SignedDayworkScreen.vue` 浏览器分派 P0 来源只读页，Native 分派原签工工作台。工资 `CentralPayrollFormPage.vue` 已按既有 ID 的真实 detail.formatFamily 分派 A/C1，新单和配置才用显式 format。

| 用户入口 | 真实路径及实施文件 | 目标边界 |
| --- | --- | --- |
| 签工台账及原记录定位 | `/subcontract/daywork`；将薄入口移为 `app/pages/subcontract/daywork/index.vue` | 保留现 URL；新增 children 时不保留无 NuxtPage 的同名父页面。record 焦点是原 stable ID，台账本身可只读。 |
| 新增签工 | `/subcontract/daywork/new?draftKey=…`；`daywork/new.vue` | 只创建新稿；draftKey 在进入时生成并保留，不能用空 recordId 合并不同新稿。 |
| 编辑签工 | `/subcontract/daywork/form/[id]`；`daywork/form/[id].vue` | 路径 ID+origin 读原记录，query 不改实体归属；失效或已锁只读显示实际原因，不降成新增。 |
| 新 C2 工资 | `/subcontract/payroll/new?format=C2&draftKey=…` | 接现工资薄壳并新增 C2 子页；不复用 Native WageStatement。 |
| 原 C2 草稿编辑/详情 | `/subcontract/payroll/form/[id]`、`/subcontract/payroll/[id]` | 真正格式来自读取结果；query format 不可把 A/C1/B 伪装为 C2。详情只读，核对/发放为明确轻任务。 |
| C2 主体配置 | `/subcontract/payroll/config?format=C2&project=…&leader=…` | 配置身份为项目×负责人；crew 只保明确关系，month 只属返回上下文，不新增按月生效配置政策。 |

现 Native `SignedDayworkEntryForm` 会默认首人/confirmed，emit 后立即清内容；中央整页不沿用这些行为。新增采用明确“保存待确认”和“保存并确认”动作，后一动作必须有证明人及日期；支持台账原记录的轻量证明确认。未发多字段编辑独立整页，不新增删除/撤销或驳回状态。

## 2. A 需提供的最小读写接口

以下方法名为 C 需求建议，最终直接采用 A 冻结字面量；C 不自行复制领域 DTO。

| 读取 | 输入与最低返回信息 |
| --- | --- |
| `loadDayworkList(query, scope)` | `origin` 与项目/月/班组/独立签工状态筛选；返回 context、原 scope、合法 options、原 records、逐条当前占用/月锁/诊断。空项目或月返回候选及明确空态，不默认首项、不读全年。 |
| `loadDayworkForm(query, input)` | `{recordId}` 或 `{recordId:null,draftKey,draft?:Partial<…>}`；返回原目标、context、draft、options、实际可编辑/可确认状态与字段错误/原因。既有只读应保原字段及证据，不能只剩建单 blocker。 |
| `loadC2Form(query, input)` | 沿 C1 的 `{statementId}` / `{statementId:null,draftKey,draft?:Partial<…>}`；返回 context、status、draft、members、逐条 facts、所用 subjectConfig、金额完整度、blockers、eligibility、sources。事实必须分出待确认/他单占用/缺证据/可用，不能空数组掩盖。 |
| `loadC2Config(query, scope)` | scope 为 projectId+leaderWorkerId；返回原配置稳定 ID、原 unitRate（number\|null）、原 ruleText（明确空串保留）、实际关系/状态、候选及 readonlyReasons。页面不把当下默认文案写回旧配置。 |
| `loadC2Output(query, id)` | 严格 available+专属 FrozenDocument / unavailable+reasons；网络读取中或失败是页面读态，不得冒充已确认历史缺损。 |

保存/人工确认/配置/草稿/核对/发放均接固定 read，由 store 组装原身份和 sourceVersion。UI 不计算提交金额、费率或已付，不把 records/配置正文自行转成工资来源；若合同提供选择来源 ID，UI 只提交该合同明确的 stable ID 选择，资格、占用与最终关联由服务复验。选负责人/用工人采用其明确实际 crewId；null 只表示实际无组，台账的“全部班组”不是工资/记录主体。

字段问题需可定位 `field` 或成员/记录 ID；缺链诊断保原项目/人员/日期等可证明身份，并单独给 `source:NavigationIntentDTO|null`。旧坏行的金额、状态、证明信息不能因“不参与新核算”从只读报告消失。

## 3. pending 与完成确认

三类持久目标分别为：

- 签工：workspace/actor/origin + 原 recordId；新增用 draftKey。编辑改项目/人员/日期仍是同一 recordId，原提交保旧目标及完整新正文，不能按新筛选桶丢掉旧命令。
- 主体配置：workspace/actor/origin + projectId+leaderWorkerId；不按 month 或列表 crew 通配分桶。
- C2 工资：workspace/actor/origin + statementId；新建用独立 draftKey。

沿 P2 `central-pending.ts` 的 sending/unknown/awaiting-read，复用实际成功回执与同目标后读确认。建议公开 `getDayworkPending/getC2Pending`、`recoverDaywork/recoverC2`、`acknowledgeDaywork/acknowledgeC2`，C 使用原 command，不从目前表单另造恢复命令。

完成顺序固定：收到结果 → 纯读原结果 ID/配置 → 检查同目标、同身份、当前仍 active → store ack → 清本目标稿/关闭弹层/导航/提示。新签工必须能按 result.recordId 纯读确认；新工资按 result.statementId；released 还须同次取得 available 输出。成功后冷读失败保原输入与 awaiting-read，不能只因父详情变 released 就关闭原分配框。只在全部必要子读完成后通知父级 changed，避免 P2 已修的父子刷新竞争。

页面固定 read 和可编辑 draft 分开；读取新版本不暗中抬旧稿 baseline。换目标/KeepAlive 缓存按完整身份隔离，迟到结果不写新目标。使用现有 `useTabCloseGuard` 覆盖页签关闭/刷新及 KeepAlive；确认只返回用户裁定，不在全页签关闭链尚未最终通过时清缓存。写页仍不进入只读页签自动恢复白名单；cold reload 后可明确重新打开原 URL，再按存储原 key 恢复。

## 4. 最小返回 query 与语义导航

复用 `central-navigation.ts` 已有 `origin/project/month/crew/status/dayworkStatus/format`：工资 status 保三态多选 OR，dayworkStatus 独立保 draft/confirmed 多选 OR，二者不能覆盖。其余既有合法 search/tab 等由共享 helper 透传；新增焦点只用 `record/worker/workDate`，配置负责人用 `leader`。

- C2 返回原工资上下文沿现五键：`payrollReturnTo`、`payrollSourceKind`、`payrollSourceId`、`payrollProject`、`payrollFormat=C2`。`returnTo` 仅允许同 origin、受控内部白名单，拒重复键、外链、坏稳定 ID。返回新稿必须保 draftKey；返回既有工资必须保持 path ID，不拿来源新筛选替换它。
- 新增语义目标建议 `source-record / subject.entity='daywork' / variant='ledger'`，filters 至少 `dataOrigin/projectId/month/crewId/workerId/workDate`，subject.id 为真实 recordId。C 将单独扩 `app/types/read-model.ts` 的实体字面量及唯一 Target Registry；A 仅返回受权限核实的意图，不返回路由字符串。A 若已有不同确定字面量，冻结时统一采用一版。
- Registry 将记录目标解析到只读台账原 record；页面从公开 list/form read 验 recordId+project+worker+date+origin 后展开/聚焦，不将关系主链接直接导向可编辑表单。编辑用独立明确按钮。
- 已存工资回来源须由工资 frozen/checked facts 或 blocker 中受控 source 证明；新草稿因仅 project 预览不会有完整 facts，需使用原返回 URL 的项目/月/班组和公开记录读核关系，不能重演 P2 facts=[] 导致返回失败，也不能仅凭 query 放行。
- 原 record 已移日/转人/失效时显示读取到的真实关系及说明；返回原工资仍能按原工资 ID 回读、要求重核，不靠猜新关联消除缺口。无权限的 worker/crew 只显示已有历史标签，不伪造可达链接。

## 5. C 唯一文件与组件边界

| 范围 | 拟 owned 文件及责任 |
| --- | --- |
| 薄路由与格式分派 | `app/pages/subcontract/daywork.vue` → `daywork/index.vue`、新增 `daywork/new.vue` / `daywork/form/[id].vue`；工资 config 页面、`SignedDayworkScreen.vue`、`CentralPayrollScreen.vue`、`CentralPayrollFormPage.vue`、`CentralPayrollDetailScreen.vue`。只做入口组合，不塞领域请求。 |
| 签工台账/表单 | 新 `CentralSignedDayworkScreen.vue`、`CentralDayworkFormPage.vue`、`PayrollDayworkFormFields.vue`、`PayrollDayworkTable.vue`、`PayrollDayworkConfirmDialog.vue`；对应 `useCentralDaywork.ts` / `usePayrollDayworkForm.ts`。台账读筛选；字段组件 props draft/options/errors，emit patch；确认弹层 props 原 record/pending，emit 原证明确认/恢复。 |
| C2 工资/配置 | 新 `CentralC2DraftFormPage.vue`、`PayrollC2FormFields.vue`、`PayrollC2ConfigScreen.vue`、`PayrollC2SourceReview.vue`、`PayrollC2StatementWorkspace.vue`、`PayrollC2ReleaseDialog.vue`；相应 `usePayrollC2Form/Config/Statement.ts`。页面本地固定 read，服务 mutation 归 store；表单和展示按职责拆分。 |
| 导航与来源返回 | 新 `c2-navigation.ts` / `PayrollC2SourceReturn.vue`；精确改 `central-navigation.ts`、`target-registry.ts`、`restore-target.ts`、`app/types/read-model.ts` 实体字面量及 `CrewWorkerCentralDetailScreen.vue` 受控 C2 返回分支。A/B 不并行写这些 C 接缝。 |
| 打印/XLSX | 新 `PayrollC2FrozenPrint.vue`、`c2-export.ts`，只接 A FrozenDocument；按原成员标签/逐签工/配置规则/实发分配输出签工表及工资表，不输出考勤、不强转旧 Native 文档、不用 `??0` 或 `ruleText \|\| 默认脚注`。沿现 exportFile/XLSX，不加依赖。 |
| 验证 | C 自有组件、导航/导出 unit、真实主链/恢复/只读 E2E 与 helper。共享 B 真实迁入夹具；Root 的独立反例、metadata、权威文档、指南与最终 service/full/type/build 不占用。 |

整页继续 EntityFormShell、检索 LookupSelect、最多两列/窄屏单列；空值输入与建议分开，disabled/pending 仍显原项目/班组/负责人名称。局部密集表各自横滚，长内容可换行且有定位。C 不写 A domain/API/Repository/stores/schema，不改 B facts/锁/迁移，也不修改 Native 业务算法。

## 6. 首条真实旅程与针对性组件红例

首条：迁入只有项目/直接工人而无工程量/BOQ → 签工空台账 → 独立新增负责人 1 工待确认（保存失败保内容）→ 人工证明确认（超过两天仍按原规则合法）→ 成员 0.5 工一次保存并确认 → 新 C2 草稿按 stable 主体选三人 → 配置 350 并回原 draftKey → 明确核对 525 → 原签工定位/编辑内容后原单需重核 → 明确重新核对 → 发放差一分拒绝 → 实发 500、分配 350/150/0 的响应丢失及原 key 恢复 → 冷读健康签工+工资输出、真实 PDF/XLSX → 零成员整月锁。

少量独立恢复/只读旅程再覆盖配置或签工 unknown/cold reopen、保存成功但后读失败、无权/demo/旧 C2 缺快照。组件优先红例：同路由换 record/draftKey 延迟隔离；多页签合并关闭后取消保稿；null/0/空规则保真；原配置 pending 名称；released 输出 available/unavailable/读取失败三态；真实 source ID 往返；半工及长证明/规则文本；实际 workbook reread。最终五宽要覆盖表正文、末行、横滚数值、配置尾与完整签字位，不只首屏。

以上为待执行方案，未运行或宣称通过任何 P3 测试。等 Root 最终 P2 SHA 和 A public contract 后，将字面量一次对齐，再逐条建立真实失败反例。
