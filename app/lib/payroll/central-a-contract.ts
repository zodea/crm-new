// 仅 P1 A 核算；取消是离开未保存页面，不是数据库删除/撤销/解除发放。
import type { DataOriginDTO, NavigationIntentDTO } from '../../types/read-model'
import type { PayrollAAdjustmentReconciliation } from './central-a-adjustment-contract'
import type { PayrollABookRef } from './central-a-fees-contract'
import type { PayrollARatioPlan } from './central-a-item-ratio'
import type { PayrollContext, PayrollDetailRead, PayrollHistoryEntry, PayrollProjectOption, PayrollQuery } from './central-contract'
import type { PayrollHollowRead, PayrollHollowSnapshot } from './central-hollow-deduction-contract'
import type { PayrollReleaseAdjustmentApplication } from './central-release-adjustment-contract'

export const PAYROLL_WRITE_CAPABILITY = 'payroll:write' as const
export type PayrollAPeriodKind = 'monthly' | 'settlement' | 'retention'
export interface PayrollAContext extends Omit<PayrollContext, 'readonly'> { readonly: boolean }

/** 完成时的物理责任范围；不以当前名册、名称或当前 assignment 替换。 */
export interface PayrollAAssignmentScope {
  id: string
  roomId: string
  itemId: string
  deletedAt: string | null
}

export interface PayrollAQuantityFact {
  /** project+unit+assignment+room+item；不含可重建的 completionId 或工资月份。 */
  ownershipKey: string
  completionId: string
  assignmentId: string
  stageId: string
  stageItemId: string
  unitId: string
  floorId: string
  buildingId: string
  templateId: string
  templateLineId: string
  roomId: string
  itemId: string
  completedAt: string
  workerId: string | null
  crewId: string | null
  assignmentScopeIds: string[]
  scopeKind: 'whole-trade' | 'selected'
  scopeRows: PayrollAAssignmentScope[]
  unit: string | null
  fieldQty: number | null
  fieldFormula: string | null
  buildingName: string | null
  floorName: string | null
  unitName: string | null
  templateName: string | null
  roomName: string | null
  itemName: string | null
  workerName: string | null
  crewName: string | null
  sourceFingerprint: string
  /** Adopted formal upstream references; no contract price enters the independent wage price track. */
  productionUpstream?: { boqLineId: string, mainContractId: string, qualificationVersion: string, sourceSha256: string | null }
}

/** 缺定位链仍报告；无法证明属于哪位原执行主体时不能由前端筛掉。 */
export interface PayrollAQuantityDiagnostic {
  code: string
  message: string
  affects: 'subject' | 'project'
  completionId: string | null
  assignmentId: string | null
  workerId: string | null
  crewId: string | null
  unitId: string | null
  roomId: string | null
  itemId: string | null
}
export interface PayrollAQuantityFacts {
  sourceVersion: string
  rows: PayrollAQuantityFact[]
  diagnostics: PayrollAQuantityDiagnostic[]
}

/** B loader：loadPayrollAQuantityFacts(tx, { projectId, month })，不另开队列/权限读取。 */
export interface PayrollAQuantityQuery { projectId: string, month: string }

/** B 名册受控事实：只有原录入/原迁入属性可证明配置；formDefaults 不是证据。 */
export interface PayrollACrewRatioFact {
  crewId: string
  value: number | null
  explicitlyConfigured: boolean
  sourceVersion: string
}

export interface PayrollASubjectScope {
  projectId: string
  crewId: string | null
  leaderWorkerId: string
  /** 完整成员集合包含负责人，包含没有工资行、真实零金额的成员。 */
  memberWorkerIds: string[]
}

export interface PayrollAMemberOption {
  id: string
  name: string | null
  crewId: string | null
  eligible: boolean
  reasons: string[]
  source: NavigationIntentDTO | null
}
export interface PayrollACrewOption { id: string, name: string | null, eligible: boolean, reasons: string[] }
export interface PayrollAOptions {
  projects: PayrollProjectOption[]
  crews: PayrollACrewOption[]
  workers: PayrollAMemberOption[]
}

export interface PayrollARatioDefault {
  value: number | null
  source: 'previous-statement' | 'subject-config' | 'crew-config' | 'settlement-default' | 'retention-fixed' | 'missing'
  statementId: string | null
  configId: string | null
  sourceVersion: string | null
}

/** 金额完整度独立于数值：未知不能用 0，存在未知且没有已知项时 knownValue 也为 null。 */
export interface PayrollAAmount {
  value: number | null
  knownValue: number | null
  state: 'known' | 'partial' | 'unknown'
  reasons: string[]
}
export interface PayrollATotals {
  workAmount: PayrollAAmount
  cumulativeAmount: PayrollAAmount
  previouslyPaid: PayrollAAmount
  grossAmount: PayrollAAmount
}

export interface PayrollABlocker {
  code: string
  message: string
  /** 原稳定身份可证明的位置；不是按当前同名责任或分项补接。 */
  locationLabel: string | null
  sourceUnavailableReason: string | null
  field: string | null
  completionId: string | null
  assignmentId: string | null
  unitId: string | null
  roomId: string | null
  itemId: string | null
  workerId: string | null
  statementId: string | null
  source: NavigationIntentDTO | null
}

/** 价格适用范围采用稳定身份。全项目与显式格子集合分别编码，空 cells 不表示通配。 */
export type PayrollAPriceScope = { kind: 'project' }
  | { kind: 'cells', cells: Array<{ unitId: string, roomId: string, itemId: string }> }

export interface PayrollAPriceRevision {
  id: string
  priceId: string
  projectId: string
  crewId: string | null
  leaderWorkerId: string
  itemId: string
  itemName: string | null
  unit: string | null
  mode: 'baseline' | 'worker-exception'
  workerId: string | null
  workerName: string | null
  effectiveMonth: string
  unitPrice: number | null
  scope: PayrollAPriceScope
  revision: number
  operatorId: string | null
  createdAt: string | null
  editable: boolean
  readonlyReasons: string[]
}

export interface PayrollAPriceDraft {
  priceId: string | null
  itemId: string
  unit: string | null
  mode: 'baseline' | 'worker-exception'
  workerId: string | null
  effectiveMonth: string
  unitPrice: number | null
  scope: PayrollAPriceScope
}

export interface PayrollASubjectConfig {
  id: string
  projectId: string
  crewId: string | null
  leaderWorkerId: string
  initialPayRatio: number | null
  revision: number
}
export interface PayrollASubjectConfigDraft {
  crewId: string | null
  leaderWorkerId: string
  initialPayRatio: number | null
}

export interface PayrollALine {
  id: string
  workerId: string
  workerName: string | null
  itemId: string
  itemName: string | null
  unit: string | null
  quantity: number | null
  knownQuantity: number | null
  unitPrice: number | null
  amount: number | null
  /** 不同适用单价拆行；不按数量加权捏造一个展示单价。 */
  priceRevisionIds: string[]
  facts: PayrollAQuantityFact[]
  sources: NavigationIntentDTO[]
  blockers: PayrollABlocker[]
}

export interface PayrollADraft extends PayrollASubjectScope {
  book?: PayrollABookRef
  month: string
  periodKind: PayrollAPeriodKind
  payRatio: number | null
  /** 新单按工程量分项；旧单无此字段，禁止按当前默认比例补造历史事实。 */
  ratioPlan?: PayrollARatioPlan
  note: string
}

export type PayrollAFormTarget = { statementId: string, draftKey?: never }
  | { statementId: null, draftKey: string }

/** 预览可逐步填写；项目、负责人、月份的空串表示尚未选择，不自动取首项。保存仍验证完整资格。已存目标以 stable statementId 为准。 */
export type PayrollAFormInput = PayrollAFormTarget & { draft?: Partial<PayrollADraft> }

export interface PayrollAEligibility {
  canSaveDraft: boolean
  canCheck: boolean
  canRelease: boolean
  canOutput: boolean
  reasons: string[]
}
export interface PayrollAFormRead {
  hollow?: PayrollHollowRead
  adjustmentReconciliation?: PayrollAAdjustmentReconciliation
  context: PayrollAContext
  statementId: string | null
  draftKey: string | null
  status: 'new' | 'draft' | 'checked' | 'released'
  needsRecheck: boolean
  draft: Partial<PayrollADraft>
  options: PayrollAOptions
  members: PayrollAMemberOption[]
  facts: PayrollAQuantityFact[]
  lines: PayrollALine[]
  prices: PayrollAPriceRevision[]
  ratioDefault: PayrollARatioDefault
  totals: PayrollATotals
  /** 此前实际发放的身份和金额完整集合，核对时冻结其指纹。 */
  paymentSourceVersion: string
  blockers: PayrollABlocker[]
  eligibility: PayrollAEligibility
}

export interface PayrollAConfigScope {
  projectId: string
  month: string
  crewId: string | null
  leaderWorkerId: string | null
}
export interface PayrollAConfigRead {
  context: PayrollAContext
  scope: PayrollAConfigScope
  options: PayrollAOptions
  subject: PayrollASubjectConfig | null
  crewRatio: PayrollACrewRatioFact | null
  prices: PayrollAPriceRevision[]
  priceOptions: Array<{ itemId: string, itemName: string | null, unit: string | null, scopes: PayrollAPriceScope[] }>
  readonlyReasons: string[]
  history: PayrollHistoryEntry[]
}

export interface PayrollAReleaseDraft {
  adjustmentApplications?: PayrollReleaseAdjustmentApplication[]
  actualAmount: number | null
  /** 服务端必须验证全部成员与整数分合计；页面默认零也要明确保留。 */
  allocations: Array<{ workerId: string, amount: number | null }>
}

export type PayrollAAction = { kind: 'save-a-draft', draft: PayrollADraft }
  | { kind: 'check-a' }
  | { kind: 'set-a-pay-ratio', payRatio: number | null }
  | { kind: 'set-a-ratio-plan', ratioPlan: PayrollARatioPlan }
  | { kind: 'release-a', release: PayrollAReleaseDraft }
  | { kind: 'save-a-subject-config', config: PayrollASubjectConfigDraft }
  | { kind: 'save-a-prices', prices: PayrollAPriceDraft[] }

/**
 * save-a-draft 仅新建或现存 draft 可用；checked 可单独改比例并标记需重核，released 永久只读。
 * 取消未保存输入不发送命令。无 delete/restore/undo/cancel 动作，不把发放冻结变成软删门禁。
 * check/release 不接受客户端明细、此前已付、来源资格或快照；全部在服务器同事务重建核验。
 */
export interface PayrollACommand {
  commandId: string
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  requiredCapability: typeof PAYROLL_WRITE_CAPABILITY
  sourceVersion: string
  projectId: string
  statementId: string | null
  draftKey: string | null
  /** 配置命令绑定读取时的完整目标；不从当前全局页面选择取代。 */
  configScope: PayrollAConfigScope | null
  action: PayrollAAction
}
export interface PayrollACommandResult {
  adjustmentApplicationIds?: string[]
  adjustmentCoverageIds?: string[]
  commandId: string
  projectId: string
  statementId: string | null
  subjectConfigId: string | null
  priceRevisionIds: string[]
  sourceVersion: string
  outcome: 'saved' | 'checked' | 'released' | 'needs-recheck'
  logIds: string[]
}
export interface PayrollAPending { command: PayrollACommand, state: 'sending' | 'unknown' | 'awaiting-read' }
export type PayrollAStatementCommandResult = PayrollACommandResult & { statementId: string }

/** B 恢复保护只解析这个封闭字段集合，不泛递归旧快照或未知扩展。 */
export interface PayrollAStatementSourceSnapshot {
  adjustmentReconciliation?: PayrollAAdjustmentReconciliation
  schemaVersion: 1
  subject: PayrollASubjectScope
  facts: PayrollAQuantityFact[]
  priceRevisions: PayrollAPriceRevision[]
}

/** 已发 A 输出仅从完整且可证明的新中央冻结事实构建；不使用当前量/价格/姓名补齐。 */
export interface PayrollAFrozenDocument {
  hollow?: PayrollHollowSnapshot
  adjustmentReconciliation?: PayrollAAdjustmentReconciliation
  /** 新单冻结时保存分项比例；旧单不存在此字段。 */
  ratioPlan?: PayrollARatioPlan
  id: string
  projectId: string
  projectName: string
  crewName: string | null
  leaderName: string
  month: string
  periodKind: PayrollAPeriodKind
  formatFamily: 'A'
  payRatio: number
  workAmount: number
  cumulativeAmount: number
  previouslyPaid: number
  grossAmount: number
  actualAmount: number
  releasedAt: string
  operatorName: string
  note: string
  lines: PayrollALine[]
  members: Array<{ workerId: string, workerName: string, isLeader: boolean }>
  allocations: Array<{ workerId: string, workerName: string, isLeader: boolean, amount: number, allocatedAmountFen: number }>
  previousPayments: Array<{ statementId: string, month: string, amount: number }>
}
export type PayrollAOutputRead = { context: PayrollAContext, statementId: string } & (
  { state: 'available', document: PayrollAFrozenDocument, reasons: [] }
  | { state: 'unavailable', document: null, reasons: string[] }
)

export interface PayrollARepository {
  aForm: (query: PayrollQuery, input: PayrollAFormInput) => Promise<PayrollAFormRead>
  aConfig: (query: PayrollQuery, scope: PayrollAConfigScope) => Promise<PayrollAConfigRead>
  aOutput: (query: PayrollQuery, statementId: string) => Promise<PayrollAOutputRead>
  execute: (command: PayrollACommand) => Promise<PayrollACommandResult>
}

export type PayrollACommandRead = PayrollAFormRead | PayrollAConfigRead
export type PayrollADetailRead = PayrollDetailRead

// Schema 接缝（A 唯一实现；B 仅消费其已知字段核验迁移恢复引用）：
// payroll_a_subject_configs: id/project_id/crew_id/leader_worker_id/initial_pay_ratio/revision/deleted_at
// payroll_a_price_revisions: id/price_id/project_id/crew_id/leader_worker_id/item_id/unit/mode/worker_id/effective_month/unit_price/scope_json/revision/operator_id/created_at
//   scope_json = PayrollAPriceScope，不猜名称，不任意递归 JSON 搜 ID。
// payroll_a_statement_sources: statement_id/project_id/leader_worker_id/source_json
//   source_json = PayrollAStatementSourceSnapshot
// payroll_command_receipts: command_id/actor_id/project_id/statement_id/config_scope_json/action/fingerprint/result_json/command_json
//   config_scope_json = PayrollAConfigScope|null；原 P0 snapshot_json 与迁入 evidence 不改写。
//   command_json = 原 PayrollACommand 的 canonical JSON；旧回执未存正文保 SQL NULL，不能重构。
