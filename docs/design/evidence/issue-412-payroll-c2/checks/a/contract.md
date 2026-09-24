# P3 A 公共合同 v2

> 2026-09-14，工程合同，非验收结果或新的业务规格。P2 最终基线为 `4738be98730955cd63832c8df04fc6f1d855caff`，产品提交 `fd0a7b6b4ab58eb177eea1db86a069067be92a4a`；Root 已正式放行实施。v2 关闭独立 Spec S1：原提交成功后的合法后续修改不能使 pending 永久无法确认。依据 P3 实施票、preparation/implementation-plan.md 及 B/C contract-notes。A 负责本合同所有正式类型、Repository/API/store/runtime/schema；B 独占事实 loader、共享来源锁与迁移；C 独占界面、导航、输出文件及其测试。

所有下面声明均为计划落盘的实际导出名；实现前若需调整，A 一次修改本合同并通知 B/C。业务没有待 grill 项。只共享真正格式无关的身份、JSON、金额分和 pending 能力，不把 C2 传入 A/C1 的 decoder、calculation、execute 或 frozen document。

## 1. 公共身份及 DTO

在 A owned `central-contract.ts` 增加以下格式无关类型；P2 原公共名称保留为兼容别名，不更改 A/C1 外部接口和行为。现 `payroll-c1-options.ts` 实现提取到 A owned `server/utils/payroll-participant-options.ts`；原文件重新导出原名字，C2 直接用新通用名字。

```ts
export interface PayrollWritableContext extends Omit<PayrollContext, 'readonly'> { readonly: boolean }
export interface PayrollParticipantOption {
  id: string; name: string | null; crewId: string | null
  eligible: boolean; reasons: string[]; historical: boolean
  source: NavigationIntentDTO | null
}
export interface PayrollCrewOption { id: string; name: string | null; eligible: boolean; reasons: string[] }
export interface PayrollParticipantOptions {
  projects: PayrollProjectOption[]; crews: PayrollCrewOption[]; workers: PayrollParticipantOption[]
}
export interface PayrollSourceDiagnostic {
  code: string; message: string; recordId: string | null; workerId: string | null
  field: string | null; tableName: string | null; entityId: string | null; legacyRecordId: string | null
}
```

通用 options 保留 P2 当前 worker.currentProjectId 或有效现场责任的资格判断；不要求工程量/BOQ，不引入供应商、合同名称或新身份桥。`null` 班组只表示实际无班组；“全部班组”仅是台账筛选。原记录班组、当前工人班组与工资主体关系分别读，不静默改写原记录来消除冲突。语义 source 只由权限核实的事实产生，C owned 的新合法意图为 `source-record / subject.entity='daywork' / variant='ledger'`，subject.id 是真实 recordId，filters 包含 `dataOrigin/projectId/month/crewId/workerId/workDate`，A 不返回路径字符串。

## 2. `central-daywork-contract.ts`

### 原事实与 B 同事务导出

```ts
export type PayrollDayworkStatus = 'draft' | 'confirmed'
export interface PayrollDayworkScope {
  projectId: string; month: string; crewId: string | null; dayworkStatuses: PayrollDayworkStatus[]
}
export interface PayrollDayworkFact {
  id: string; projectId: string; crewId: string | null; workerId: string; workDate: string
  workContent: string | null; startTime: string | null; endTime: string | null
  laborUnits: number | null; witness: string | null; confirmedOn: string | null
  status: string | null; note: string | null
  createdAt: string | null; updatedAt: string | null; deletedAt: string | null
  sourceFingerprint: string
  original: PayrollJsonObject
}
export interface PayrollDayworkOccupation {
  dayworkRecordId: string; linkId: string | null; statementId: string
  projectId: string; month: string; formatFamily: string | null; status: string | null
  statementDeletedAt: string | null; linkDeletedAt: string | null
  kind: 'active-link' | 'released-link' | 'released-snapshot' | 'c2-source' | 'missing-head'
  evidenceId: string | null; legacyRecordId: string | null
}
export interface PayrollDayworkFacts {
  sourceVersion: string; rows: PayrollDayworkFact[]; occupations: PayrollDayworkOccupation[]
  diagnostics: PayrollSourceDiagnostic[]; evidence: PayrollSourceEvidence[]
}
export interface PayrollDayworkRecordFacts {
  sourceVersion: string; record: PayrollDayworkFact | null; occupations: PayrollDayworkOccupation[]
  diagnostics: PayrollSourceDiagnostic[]; evidence: PayrollSourceEvidence[]
}
export interface PayrollDayworkOccupationQuery { projectId?: string; recordIds?: string[] }
```

B 在 `server/utils/payroll-daywork-facts.ts` 导出：

```ts
loadPayrollDayworkFacts(tx: TransactionDb, query: { projectId: string; month: string }): Promise<PayrollDayworkFacts>
loadPayrollDayworkRecord(tx: TransactionDb, recordId: string): Promise<PayrollDayworkRecordFacts>
loadPayrollC2ConfigFacts(tx: TransactionDb, scope: PayrollC2ConfigScope): Promise<PayrollC2ConfigFacts>
```

B 在 `central-source-locks.ts` 继续保留原人员月锁导出和原 C1 行为，新增：

```ts
export type PayrollDayworkOccupationGraph = Pick<PayrollReadGraph,
  'statements' | 'statementDaywork' | 'daywork' | 'evidence'> & { c2Sources?: PayrollStoredRow[] }
payrollDayworkOccupationsFromGraph(graph: PayrollDayworkOccupationGraph,
  query?: PayrollDayworkOccupationQuery): PayrollDayworkOccupation[]
loadPayrollDayworkOccupations(tx: TransactionDb,
  query?: PayrollDayworkOccupationQuery): Promise<PayrollDayworkOccupation[]>
```

- 全部 loader 持有调用者 tx；不调用公共 Repository/HTTP、owner 或再次进入工作区队列。`c2Sources` 是 `payroll_c2_statement_sources` 的实际行；表不存在时空数组，不能因 P3 表尚未创建破坏 P0/P2 读。
- 月 facts 必须明确合法非空月；不接 crew/status，不以筛选漏掉同人原组记录、draft、占用或日内冲突。先验证实际日期再按月筛选；无法证明月份的坏行保定位诊断。原 record 入口按 ID 取真实旧范围，可返回软删/缺损；隔离未入表只有 evidence 与定位，不造可写 ID。
- `original` 保数据库原行的完整 JSON 可表达值，HTTP 原样传输，不递归转换字段名，不根据其中任意同名 ID 推断引用；正规字段是便于领域判定的投影。有限 0、负数不会变 null；非法数值文本正规字段为 null，但原文本仍在 original。sourceFingerprint 基于完整原行，包含旧时间与正文，不由 UI 计算。
- occupations 不隐去本单或他单关系，不要求调用方预知状态。有效头+有效链接产生 active-link；released 的原头/原关联即使软删仍产生 released-link；可证明原冻结和新 c2Source 独存也保占用。未知缺头不能当作自由来源：使用 missing-head 并附诊断。保存工资时 A 区分本单可复用、他单未发、已发与缺损。
- 单独签工编辑可合法修改被未发工资领用的原行；`active-link` 不等于编辑锁。已发月锁或已发原来源才禁改。人员月互斥仍用 `loadPayrollSourceExclusions`，不把同格式未发工资的全部成员误当排他月锁。
- 内容版本包含实际原行、相关关联/头/冻结、诊断/evidence。A 采用指纹另只封闭选中主体实际来源/配置/资格与相关占用；无关配置不被当成本单价格。

### 台账与整页读取

```ts
export interface PayrollDayworkRecordDraft {
  projectId: string; crewId: string | null; workerId: string; workDate: string
  workContent: string; startTime: string; endTime: string; laborUnits: number | null
  witness: string; confirmedOn: string | null; status: PayrollDayworkStatus; note: string
}
export interface PayrollDayworkEligibility { canEdit: boolean; canConfirm: boolean; reasons: string[] }
export interface PayrollDayworkRecordRead extends PayrollDayworkFact {
  workerName: string | null; crewName: string | null; source: NavigationIntentDTO | null
  occupations: PayrollDayworkOccupation[]; locks: PayrollSourceExclusion[]
  diagnostics: PayrollSourceDiagnostic[]; eligibility: PayrollDayworkEligibility
  availability: 'available' | 'pending' | 'occupied' | 'invalid' | 'deleted'
}
export interface PayrollDayworkListRead {
  context: PayrollWritableContext; scope: PayrollDayworkScope; options: PayrollParticipantOptions
  records: PayrollDayworkRecordRead[]; locks: PayrollSourceExclusion[]
  diagnostics: PayrollSourceDiagnostic[]; evidence: PayrollSourceEvidence[]
}
export type PayrollDayworkFormInput = (
  { recordId: string; draftKey?: never } | { recordId: null; draftKey: string }
) & { draft?: Partial<PayrollDayworkRecordDraft> }
export interface PayrollDayworkFormRead {
  context: PayrollWritableContext; recordId: string | null; draftKey: string | null
  record: PayrollDayworkRecordRead | null; draft: Partial<PayrollDayworkRecordDraft>
  options: PayrollParticipantOptions; eligibility: PayrollDayworkEligibility
  diagnostics: PayrollSourceDiagnostic[]; evidence: PayrollSourceEvidence[]
}
```

读取范围 projectId/month 允许空串，非空值必须合法；空项目/月返回候选和空 records，不选首项目/当前月、不读全年。`dayworkStatuses=[]` 不筛确认状态；多选 OR。未知历史状态不会转换成 draft/confirmed，只能原文及诊断阅读。单记录读取不靠页面 month/crew/status 过滤；原身份存在而 query 关系错误时明确报错，不降为新增。`draft` 只承载可编辑字段；非法旧状态等不能表达为合法草稿时，原 record/original/evidence 仍完整可读且明确禁止写入。

修改已存签工时，C 用固定 form read 提交，原 read 和用户新 draft 分开。人工确认弹层也先通过 form 读固定原 ID；不以台账聚合 version 自行构造单记录命令。

### 签工封闭命令、结果与原键

```ts
export interface PayrollDayworkOriginalScope {
  projectId: string; crewId: string | null; workerId: string; workDate: string
}
export type PayrollDayworkAction =
  | { kind: 'save-daywork'; record: PayrollDayworkRecordDraft }
  | { kind: 'confirm-daywork'; confirmation: { witness: string; confirmedOn: string } }
export interface PayrollDayworkCommand {
  commandId: string; workspaceId: string; actorId: string; origin: DataOriginDTO
  requiredCapability: 'payroll:write'; sourceVersion: string
  projectId: string; recordId: string | null; draftKey: string | null
  originalScope: PayrollDayworkOriginalScope | null; action: PayrollDayworkAction
}
export interface PayrollDayworkCommandResult {
  commandId: string; projectId: string; recordId: string
  recordProjectId: string; workerId: string; workDate: string; status: PayrollDayworkStatus
  affectedStatementIds: string[]; recordFingerprint: string; sourceVersion: string
  outcome: 'saved' | 'confirmed'; logIds: string[]
}
export interface PayrollDayworkPending {
  command: PayrollDayworkCommand; state: 'sending' | 'unknown' | 'awaiting-read'
}
export interface PayrollDayworkRepository {
  dayworkList(query: PayrollQuery, scope: PayrollDayworkScope): Promise<PayrollDayworkListRead>
  dayworkForm(query: PayrollQuery, input: PayrollDayworkFormInput): Promise<PayrollDayworkFormRead>
  executeDaywork(command: PayrollDayworkCommand): Promise<PayrollDayworkCommandResult>
}
```

- 新增 command.recordId/originalScope=null，draftKey 必填；outer projectId 是 action.record.projectId，必须真实有效。既有 command.recordId 必填、draftKey=null，outer projectId 固定原项目，originalScope 必须等于读回原行；移动后的 projectId/worker/date 在 action.record 中，不拿新筛选替换旧目标。confirm 只可针对既有原 ID，不能附任意新时段/工数；保存并确认仍是 save-daywork 的明确 confirmed 正文。
- decoder 核 result 原 commandId、outer projectId、既有 recordId；save 的实际 recordProjectId/workerId/workDate/status 必须与 action.record 相同，confirm 则与 originalScope 相同且 status=confirmed。结果物理 recordId 可供迁入恢复引用，不依赖 command 新建时有不存在的 ID。
- 两动作必须完整核验合法日期、时段、1/0.5 工、确认事实、真实人员班组、全部有效同人同日重叠及上限，编辑排自己，旧新范围共同复验月互斥及已发来源；不引入跨项目全局时长限制。确认日期超过两天仍合法，不解析规则触发扣款。
- 内容/关系/状态变化使受影响未发工资持久 needsRecheck。仍活跃的旧关联不能自动送给另一工资；本单重核时 A 软删旧关联并保存替换历史与审计。所有写、revision、审计、receipt 与最终 owner/会话复验在同一事务。

## 3. `central-c2-contract.ts`

### 配置原事实与新稿

```ts
export interface PayrollC2ConfigScope { projectId: string; leaderWorkerId: string }
export interface PayrollC2ConfigFact {
  id: string; projectId: string; crewId: string | null; leaderWorkerId: string
  formatFamily: string | null; unitRate: number | null; ruleText: string | null; enabled: boolean | null
  createdAt: string | null; updatedAt: string | null; deletedAt: string | null
  sourceFingerprint: string; original: PayrollJsonObject
}
export interface PayrollC2ConfigFacts {
  sourceVersion: string; rows: PayrollC2ConfigFact[]
  diagnostics: PayrollSourceDiagnostic[]; evidence: PayrollSourceEvidence[]
}
export interface PayrollC2ConfigDraft { crewId: string | null; unitRate: number | null; ruleText: string | null }
export interface PayrollC2ConfigRead {
  context: PayrollWritableContext; scope: PayrollC2ConfigScope; options: PayrollParticipantOptions
  config: PayrollC2ConfigFact | null; configs: PayrollC2ConfigFact[]; draft: PayrollC2ConfigDraft
  diagnostics: PayrollSourceDiagnostic[]; evidence: PayrollSourceEvidence[]
  readonlyReasons: string[]; history: PayrollHistoryEntry[]
}
```

B config loader 输入必须实际 projectId/leaderWorkerId；A read 允许空选择时返回候选及无配置态，不调用空范围 loader。configs 保对应 scope 当前、停用和软删原行。`config` 仅指唯一未删 C2 行，enabled=false 也原样返回；多条不猜一条，明确冲突。新稿规则为空串，旧规则的 null 与空串不得变成当前默认文字。新写要求有限正价及实际字符串规则（允许空串，保存原文），复用既有 upsert 行为创建/更新当前主体配置且 enabled=1；不新增停用/删除动作、按月生效或版本表。配置停用期间不能计薪，明确重新保存后的有效配置方可被采用。

### 工资草稿、采用来源与输出

```ts
export interface PayrollC2Draft {
  projectId: string; crewId: string | null; leaderWorkerId: string
  memberWorkerIds: string[]; month: string; note: string
}
export type PayrollC2FormInput = (
  { statementId: string; draftKey?: never } | { statementId: null; draftKey: string }
) & { draft?: Partial<PayrollC2Draft> }
export interface PayrollC2Line {
  id: string; workerId: string; workerName: string | null; kind: 'daywork'; itemName: string
  quantity: number; unit: '工'; unitPrice: number | null; amount: number | null; dayworkIds: string[]
}
export interface PayrollC2Blocker {
  code: string; message: string; field: string | null; workerId: string | null
  recordId: string | null; statementId: string | null; source: NavigationIntentDTO | null
}
export interface PayrollC2Amount {
  value: number | null; knownValue: number | null; state: 'known' | 'partial' | 'unknown'; reasons: string[]
}
export interface PayrollC2Eligibility {
  canSaveDraft: boolean; canCheck: boolean; canRelease: boolean; canOutput: boolean; reasons: string[]
}
export interface PayrollC2MemberSnapshot { workerId: string; workerName: string; crewId: string | null }
export interface PayrollC2StatementSourceSnapshot {
  schemaVersion: 1
  subject: Pick<PayrollC2Draft, 'projectId' | 'crewId' | 'leaderWorkerId' | 'memberWorkerIds'>
  month: string; facts: PayrollDayworkFact[]; config: PayrollC2ConfigFact
  members: PayrollC2MemberSnapshot[]; qualificationVersion: string
}
export interface PayrollC2FormRead {
  context: PayrollWritableContext; statementId: string | null; draftKey: string | null
  status: 'new' | 'draft' | 'checked' | 'released'; needsRecheck: boolean
  draft: Partial<PayrollC2Draft>; options: PayrollParticipantOptions; members: PayrollParticipantOption[]
  facts: PayrollDayworkRecordRead[]; adoptedRecordIds: string[]; qualificationVersion: string
  config: PayrollC2ConfigFact | null; storedSource: PayrollC2StatementSourceSnapshot | null
  sources: NavigationIntentDTO[]; lines: PayrollC2Line[]; totals: { grossAmount: PayrollC2Amount }
  blockers: PayrollC2Blocker[]; eligibility: PayrollC2Eligibility
  diagnostics: PayrollSourceDiagnostic[]; evidence: PayrollSourceEvidence[]
}
export interface PayrollC2ReleaseDraft {
  actualAmount: number | null; allocations: Array<{ workerId: string; amount: number | null }>
}
export interface PayrollC2FrozenDocument {
  id: string; projectId: string; projectName: string; crewId: string | null; crewName: string | null
  leaderName: string; month: string; formatFamily: 'C2'; periodKind: 'monthly'; payRatio: 1
  grossAmount: number; actualAmount: number; releasedAt: string; operatorName: string; note: string
  lines: PayrollC2Line[]; daywork: PayrollDayworkFact[]; config: PayrollC2ConfigFact
  members: Array<{ workerId: string; workerName: string; isLeader: boolean }>
  allocations: Array<{ workerId: string; workerName: string; isLeader: boolean; amount: number; allocatedAmountFen: number }>
}
export type PayrollC2OutputRead = { context: PayrollWritableContext; statementId: string } & (
  { state: 'available'; document: PayrollC2FrozenDocument; reasons: [] }
  | { state: 'unavailable'; document: null; reasons: string[] }
)
```

- Form facts 展示完整相关原行和逐行 availability（待确认、被占用、坏来源、可用分明）。工资采用所选全成员当月真实可用 confirmed 行，由服务决定 adoptedRecordIds；**command 不接受 sourceRecordIds、合计、单价或客户端 sources**。他单占用可见且不可抢；有剩余合法行时仍可按其建单，不能把占用行显示为“无记录”。坏来源妨碍证明完整时保持 blocker/partial；只待确认或没有可用来源不能建空单。
- 本单已有 source 与当前事实分开：storedSource 是原保存/核对证据，facts 是当前可证明事实；来源被改人/改日/改项目后不凭当前筛选吞掉旧关系，借原 record ID 读回实际旧来源并说明需重核。详情 path ID 决定格式，不由 query 变换。
- 所选成员须唯一、包含负责人且真实同班组，null 只接受真实无组。允许没有签工的零分配成员，source.members 与所有成员一致，line 只产生有采用工数者。每人 quantity 是采用行 0.5/1 之和，金额为该人的工数×主体价按分计算；月度100%，不读前月实发抵减。
- qualificationVersion 封闭实际采用成员/项目/班组及现场责任资格证据；记录正文/状态/配置规则/价/原归属也进入完整 canonical source hash，相关占用与月锁另进命令读取版本。相同时间/合计换内容必须失效。新保存和重核保唯一物理关联；发放最终复验同一指纹和 owner，变化持久 needsRecheck，不能发旧合计。
- output 只消费自身完整已发专属 document：签工原文和配置空规则保留，members/allocations 覆盖全员且分精确相等。冻结语义守卫复算 line、价、工数、gross/actual，验证真实日期/确认/时段/状态/删除/成员和所有原 project/crew/month 关系。不读当前姓名配置补旧证据，旧不完整 C2 继续已有历史读取。

### C2 封闭命令和回执

```ts
export type PayrollC2Action =
  | { kind: 'save-c2-draft'; draft: PayrollC2Draft }
  | { kind: 'check-c2' }
  | { kind: 'release-c2'; release: PayrollC2ReleaseDraft }
  | { kind: 'save-c2-config'; config: PayrollC2ConfigDraft }
export interface PayrollC2Command {
  commandId: string; workspaceId: string; actorId: string; origin: DataOriginDTO
  requiredCapability: 'payroll:write'; sourceVersion: string; projectId: string
  statementId: string | null; draftKey: string | null
  configScope: PayrollC2ConfigScope | null; configId: string | null; action: PayrollC2Action
}
export interface PayrollC2CommandResult {
  commandId: string; projectId: string; statementId: string | null; configId: string
  dayworkRecordIds: string[]; dayworkLinkIds: string[]; sourceVersion: string
  outcome: 'saved' | 'checked' | 'released' | 'needs-recheck'; logIds: string[]
}
export interface PayrollC2Pending { command: PayrollC2Command; state: 'sending' | 'unknown' | 'awaiting-read' }
export type PayrollC2CommandRead = PayrollC2FormRead | PayrollC2ConfigRead
export type PayrollC2StatementCommandResult = PayrollC2CommandResult & { statementId: string }
export interface PayrollC2Repository {
  c2Form(query: PayrollQuery, input: PayrollC2FormInput): Promise<PayrollC2FormRead>
  c2Config(query: PayrollQuery, scope: PayrollC2ConfigScope): Promise<PayrollC2ConfigRead>
  c2Output(query: PayrollQuery, statementId: string): Promise<PayrollC2OutputRead>
  executeC2(command: PayrollC2Command): Promise<PayrollC2CommandResult>
}
```

save-c2-config 必须 configScope 与 outer projectId 一致，statementId/draftKey=null，configId 为原 read.config?.id（新建为null）；其实际结果 configId 是 `payroll_subject_configs.id`，dayworkRecordIds/dayworkLinkIds 为空。工资动作的 configScope/configId=null；既有 statementId 或新建 draftKey 唯一，check/release 不可针对新稿。工资结果 configId 是实际采用配置物理 ID，record/link 数组是实际本单关联及原记录，均唯一且对应；不得把 draftKey 当物理引用。结果 decoder 核各 action 的 outcome，配置绝不能返回工资ID或签工数组，工资必须实际 statementId，既有 ID 必须原值，needs-recheck 只属于 release。

## 4. Schema、原文和迁入引用

仅 A 增加来源证据表，不另建配置/签工业务表：

```sql
CREATE TABLE IF NOT EXISTS payroll_c2_statement_sources (
  statement_id TEXT PRIMARY KEY REFERENCES wage_statements(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  leader_worker_id TEXT NOT NULL REFERENCES workers(id),
  source_json TEXT NOT NULL
)
```

source_json 是 `PayrollC2StatementSourceSnapshot` 的 canonical JSON。wage.snapshot_json 同存专属 `c2Source` 和 `c2Document`，并按 P2 通用详情所需保存同源顶层冻结字段；不是从通用裁剪 DTO 反向拼专属文档。B 只解析已知 c2Source 与已知旧 `subjectConfig/dayworkRecords`，不递归 original 或 note 找 ID。

复用 `payroll_command_receipts`，action 精确为六个新字面量之一；command_json 保存原**领域数值形态** canonical 命令、fingerprint 为其 SHA-256；result_json 保存领域结果。配置 config_scope_json 是 {projectId,leaderWorkerId}；签工 config_scope_json=null、statement_id=null；工资 statement_id 是真实保存ID。新命令表格不变更旧 SQL NULL 原文的兼容边界。B 收集 record 原 ID/旧 scope、save 的新 scope、result 实际 recordId/configId/dayworkRecordIds/dayworkLinkIds、c2Source 全成员/配置/原行与已知关系及相关审计；canonical/SHA/command/result不符拒绝危险恢复。已知新 action 解析失败不能静默回落到A，未知非空正文不能忽略。

迁入恢复由 B 扩现混合分派及删除前检查。原已发来源即使仅 c2Source、snapshot、审计或 receipt 独存仍保护相关原记录；不相关项目/配置不能笼统禁恢复。A 不写 B 的迁移/锁文件。

## 5. Codec、API 与 service 导出

`central-daywork-codec.ts` 公开：

```ts
parsePayrollDayworkScope(raw: unknown, allowEmpty?: boolean): PayrollDayworkScope
parsePayrollDayworkFormInput(raw: unknown): PayrollDayworkFormInput
parsePayrollDayworkCommand(raw: unknown): PayrollDayworkCommand
encodePayrollDayworkWire(value: unknown): unknown
decodePayrollDayworkResult(value: unknown, command: PayrollDayworkCommand): PayrollDayworkCommandResult
decodePayrollDayworkRead<T extends PayrollDayworkListRead | PayrollDayworkFormRead>(
  raw: unknown, kind: 'list' | 'form', query: PayrollQuery,
  target: PayrollDayworkScope | PayrollDayworkFormInput): T
isPayrollDayworkFact(value: unknown): value is PayrollDayworkFact
```

`central-c2-codec.ts` 公开：

```ts
parsePayrollC2ConfigScope(raw: unknown, allowEmpty?: boolean): PayrollC2ConfigScope
parsePayrollC2FormInput(raw: unknown): PayrollC2FormInput
parsePayrollC2Command(raw: unknown): PayrollC2Command
encodePayrollC2Wire(value: unknown): unknown
decodePayrollC2Result(value: unknown, command: PayrollC2Command): PayrollC2CommandResult
decodePayrollC2Read<T extends PayrollC2FormRead | PayrollC2ConfigRead | PayrollC2OutputRead>(
  raw: unknown, kind: 'form' | 'config' | 'output', query: PayrollQuery,
  target: PayrollC2FormInput | PayrollC2ConfigScope | string): T
isPayrollC2ConfigFact(value: unknown): value is PayrollC2ConfigFact
isPayrollC2StatementSourceSnapshot(value: unknown): value is PayrollC2StatementSourceSnapshot
isPayrollC2FrozenDocument(value: unknown): value is PayrollC2FrozenDocument
```

共用低层 JSON/decimal/cent 守卫可以由 A 深化，但新命令使用独立 action、精确字段闭集和所属格式守卫。金额 wire 仍两位小数字符串；unitRate/unitPrice/laborUnits/quantity 是有限十进制定点字符串，禁止科学计数法。payrollFixedDecimal 展开有限数的指数表示，不舍入，不新增业务位数上限；半工和费率不按金额取两位，也不宽放金额 decoder。original/evidence/history 的原文 JSON 不转换。14:44 根据 READ-MODELS:28 和 Root 明确裁定，同一共享文件的 C1/考勤有限小数也采用此格式并拒绝指数传输，修复既有与全局规范的冲突；原数值与到分金额语义保持。公共 detail 的 C1/C2 lines/stored.lines 单价由 Root 使用同一 helper，A 行为不变。

| Repository/service 方法 | HTTP |
| --- | --- |
| dayworkList(query,scope) | GET `/api/read/payroll/daywork`，scope JSON query |
| dayworkForm(query,input) | POST `/api/read/payroll/daywork-form`，{query,input} |
| executeDaywork(command) | POST `/api/commands/payroll-daywork` |
| c2Form(query,input) | POST `/api/read/payroll/c2-form`，{query,input} |
| c2Config(query,scope) | GET `/api/read/payroll/c2-config`，scope JSON query |
| c2Output(query,statementId) | GET `/api/read/payroll/c2-output` |
| executeC2(command) | POST `/api/commands/payroll-c2` |

对应 service creators 是 `createPayrollDayworkService(run,options)` 和 `createPayrollC2Service(run,options)`；createPayrollService 合并这些独立方法，service 方法最后参数沿现 `sessionId?: string|null`。PayrollServiceOptions 增加 B 三个同事务注入口 `dayworkFacts`、`dayworkRecord`、`c2ConfigFacts`，签名分别等于三 loader。runtime 直接接真实 B 实现；测试仍以真实 SQLite、公开 service/HTTP 为最高有效接缝，不 mock Repo 冒充 SQL 权威。

## 6. Store、pending 与同目标完成确认

`useDayworkCentralStore()`：

```ts
dayworkSaving: ComputedRef<boolean>
loadDayworkList(q: PayrollQuery, scope: PayrollDayworkScope): Promise<PayrollDayworkListRead>
loadDayworkForm(q: PayrollQuery, input: PayrollDayworkFormInput): Promise<PayrollDayworkFormRead>
saveDaywork(read: PayrollDayworkFormRead, record: PayrollDayworkRecordDraft): Promise<PayrollDayworkCommandResult>
confirmDaywork(read: PayrollDayworkFormRead, confirmation: {witness:string;confirmedOn:string}): Promise<PayrollDayworkCommandResult>
getDayworkPending(read: PayrollDayworkFormRead): PayrollDayworkPending | null
recoverDaywork(original: {command: PayrollDayworkCommand}): Promise<PayrollDayworkCommandResult>
acknowledgeDaywork(original: {command: PayrollDayworkCommand}, refreshed: PayrollDayworkFormRead): { changedSinceCommand: boolean }
```

`usePayrollC2Store()`：

```ts
c2Saving: ComputedRef<boolean>
loadC2Form(q: PayrollQuery, input: PayrollC2FormInput): Promise<PayrollC2FormRead>
loadC2Config(q: PayrollQuery, scope: PayrollC2ConfigScope): Promise<PayrollC2ConfigRead>
loadC2Output(q: PayrollQuery, id: string): Promise<PayrollC2OutputRead>
saveC2Draft(read: PayrollC2FormRead, draft: PayrollC2Draft): Promise<PayrollC2StatementCommandResult>
checkC2(read: PayrollC2FormRead): Promise<PayrollC2StatementCommandResult>
releaseC2(read: PayrollC2FormRead, release: PayrollC2ReleaseDraft): Promise<PayrollC2StatementCommandResult>
saveC2Config(read: PayrollC2ConfigRead, config: PayrollC2ConfigDraft): Promise<PayrollC2CommandResult>
getC2Pending(read: PayrollC2CommandRead): PayrollC2Pending | null
recoverC2(original: {command: PayrollC2Command}): Promise<PayrollC2CommandResult>
acknowledgeC2(original: {command: PayrollC2Command}, refreshed: PayrollC2CommandRead, output?: PayrollC2OutputRead): void
```

两 store 复用 P2 `usePayrollPending` 的持久原命令+成功结果、sending/unknown/awaiting-read 与可信后读 WeakMap；不默认改变共享实现。pending key 含 workspace/actor/origin + 固定 domain + 原 recordId/draftKey、configScope 或 statementId/draftKey。签工 key 不带可变人员/日期/项目筛选；配置 key 不带 month/crew。新增结果有物理ID以后仍按 original.command 的 draftKey 解除，不能用新 ID 找错桶。

- 纯读 form **input.draft===undefined** 才登记后读证据；预览用户稿不能作为命令完成确认。来源旁读或任意其他 scope 成功不解除原命令。
- 签工 ack 要求原可靠同键成功回执、同 workspace/actor/origin/有效权限、refreshed.recordId=result.recordId 的可信纯读；不强求当前可变 project/worker/date/status 仍等于原结果。原 result 的保存字段继续由严格 decoder 与原 command 互证；后读按 stable recordId，仅用 origin，不把旧列表或旧结果项目强加到后来又被合法移动的记录。refreshed.record.sourceFingerprint 与 result.recordFingerprint 不同时返回 changedSinceCommand=true，提示“原提交已完成，记录随后有更新”，保留用户尚未处理的编辑；不回滚当前内容来解除 pending。未成功回执、伪造/改写DTO、其他原ID、非后读或撤权仍不能ack。
- 配置 ack 要求同身份与有效权限、scope完全一致，可信后读 configs 包含 result.configId；不以配置后续停用、重复诊断等可变业务状态抹去原成功。工资 ack 要求真实原结果 statementId 与 project 一致。release= released 时还要同一成功回执之后的 output available、document ID/项目匹配；needs-recheck 由原同键成功回执证明该次动作的结果，可信后读呈现原单当前状态，不要求 needsRecheck 永远保持 true（其他窗口可已合法重新核对）。原发放输入由 C 保留待用户处理，不根据后续状态重发或覆盖。
- C 在所需本目标全部读取完成并仍 active 后调用 ack，再清稿、关原弹层、导航、通知父级 changed。成功后冷读失败、撤权、输出暂时不可读、离页或迟到均保原命令和输入；原key recover 仍发送完全同文。只有服务明确 not-applied 的原命令可按 P2 已封闭原因清除。

## 7. 首批红例与交接次序

1. A 先落正式类型/schema 与 fixture，不带未存在 service import 破坏 P2；通知 B/C 精确 exports。B loader 与 A command 独立按同类型前进，C 接真实 store API。
2. 公共 daywork service：无工程量项目空台账/空月可选；draft不计薪但占月；确认晚于两天仍合法；相邻半工绿、第三半工/重叠/假日/早确认红；编辑自己排除与旧新范围复验；转组原事实不被筛选清掉。
3. C2 配置及来源：350、空规则；0/缺/停用/错主体明确阻断；1+0.5=525、无源禁空单；已占用显示原工资；同记录并发最多一单；成员含无源零成员。
4. 重核与release：相同时间/合计换正文或规则、原行降状态/移动都使旧核对失效；needsRecheck冷读；500与350/150/0全表一致、差一分/漏员/超额红；同键同文唯一、异文冲突、最后owner await撤权/改源整事务回滚。
5. 冻结/HTTP/store：自身source+document+原command/receipt互证、原事实改项目/月/确认破坏守卫；金额到分与费率精度；success后readfail/另scope读不可clear、原key冷恢复与release双后读，A/P2 pending行为不倒退。
6. Root 接管全量、类型、构建、独立双轴和最终浏览器/PDF归档；A/B/C只精确测试，不并发运行全量、服务或提交。A 实际 owned/hash/validation 在 a/ 路径维护。

合同阶段没有宣称上述测试通过；正式实现及红绿证据在同 a/ 目录另行记录。
