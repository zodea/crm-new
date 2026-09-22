import type { DataOriginDTO, NavigationIntentDTO } from '../../types/read-model'
import type { QuantityHollowFact, QuantityHollowProofRef } from '../quantity/central-hollow-contract'
import type { PayrollAAmount } from './central-a-contract'
import type { PayrollABookRef } from './central-a-fees-contract'
import type { PayrollQuery, PayrollWritableContext } from './central-contract'
import type { PayrollHollowTotals } from './central-hollow-deduction-calculation'

/** 建档按原请款主体×项目。A另区分普通与管理簿，C1/C2不接受管理簿。 */
export type PayrollHollowScope = {
  projectId: string
  crewId: string | null
  leaderWorkerId: string
} & ({ formatFamily: 'A', book: PayrollABookRef } | { formatFamily: 'C1' | 'C2', book: null })

export interface PayrollHollowConfigQuery {
  scope: PayrollHollowScope
  month: string
}

export interface PayrollHollowPolicy {
  itemId: string
  itemName: string | null
  enabled: boolean | null
  unitAmount: number | null
  /** 默认30为产品规则；缺损旧配置不能以默认值掩盖。 */
  source: 'default' | 'configured' | 'legacy-unavailable'
  revisionId: string | null
  sourceVersion: string
}

export interface PayrollHollowPolicyDraft {
  policyId: string | null
  baseRevisionId: string | null
  itemId: string
  enabled: boolean
  unitAmount: number | null
  effectiveMonth: string
}

export interface PayrollHollowPolicyRevision extends Omit<PayrollHollowPolicyDraft, 'baseRevisionId'> {
  id: string
  policyId: string
  scope: PayrollHollowScope
  previousRevisionId: string | null
  commandId: string
  createdBy: string
  createdAt: string
}

export type PayrollHollowTarget = { statementId: string, draftKey: null }
  | { statementId: null, draftKey: string }

/** 每条采用均保留原检查/整改端点，不能只存处数或在当前整改后重算。 */
export interface PayrollHollowSelectedLine {
  recordId: string
  proof: QuantityHollowProofRef
  fact: QuantityHollowFact
  policy: PayrollHollowPolicy
  count: number
  unitAmount: number
  amount: number
}

export interface PayrollHollowStart {
  id: string
  projectId: string
  statementId: string
  previousStartId: string | null
  scope: PayrollHollowScope
  month: string
  sourceVersion: string
  lines: PayrollHollowSelectedLine[]
  amount: number
  commandId: string
  createdBy: string
  createdAt: string
}

/** 完整发放事务才创建；原记录归属不因退款、软删或后期整改释放。 */
export interface PayrollHollowAdoption {
  id: string
  projectId: string
  statementId: string
  startId: string
  scope: PayrollHollowScope
  month: string
  line: PayrollHollowSelectedLine
  commandId: string
  createdBy: string
  createdAt: string
}

export interface PayrollHollowProcessedAmount {
  adoption: PayrollHollowAdoption
  /** 原确认更正链决定有效核算扣款，实际现金另从原支付链读取。 */
  effectiveAmount: PayrollAAmount
  adjustmentIds: string[]
  sourceVersion: string
}

export interface PayrollHollowRow {
  fact: QuantityHollowFact
  policy: PayrollHollowPolicy
  state: 'ready' | 'disabled' | 'rectified' | 'already-processed' | 'needs-decision' | 'unknown'
  amount: PayrollAAmount
  adoption: PayrollHollowAdoption | null
  source: NavigationIntentDTO | null
  sourceUnavailableReasons: string[]
  reasons: string[]
}

/** 与原格式source一起保存；读取当前详情另取current，不更改此冻结正文。 */
export interface PayrollHollowSnapshot {
  schemaVersion: 1
  scope: PayrollHollowScope
  month: string
  sourceVersion: string
  state: 'available' | 'unavailable'
  facts: QuantityHollowFact[]
  policies: PayrollHollowPolicy[]
  start: PayrollHollowStart | null
  previousProcessed: PayrollHollowProcessedAmount[]
  adoptions: PayrollHollowAdoption[]
  totals: PayrollHollowTotals
  reasons: string[]
}

export interface PayrollHollowRead {
  context: PayrollWritableContext
  target: PayrollHollowTarget
  scope: PayrollHollowScope | null
  month: string | null
  state: 'available' | 'unavailable'
  rows: PayrollHollowRow[]
  starts: PayrollHollowStart[]
  snapshot: PayrollHollowSnapshot | null
  /** 已发单只读伴随视图；只解释当前原来源，不参与原单金额重算。 */
  current: { sourceVersion: string, state: 'available' | 'unavailable', rows: PayrollHollowRow[], departureNotice: { workerIds: string[], message: string } | null, reasons: string[] } | null
  totals: PayrollHollowTotals
  departureNotice: { workerIds: string[], message: string } | null
  eligibility: { canStart: boolean, reasons: string[] }
  reasons: string[]
}

export interface PayrollHollowConfigRead {
  context: PayrollWritableContext
  query: PayrollHollowConfigQuery
  policies: PayrollHollowPolicy[]
  revisions: PayrollHollowPolicyRevision[]
  eligibility: { canSave: boolean, reasons: string[] }
  reasons: string[]
}

export type PayrollHollowAction = { kind: 'save-hollow-policies', policies: PayrollHollowPolicyDraft[] }
  | { kind: 'start-hollow-deduction' }

export interface PayrollHollowCommand {
  commandId: string
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  requiredCapability: 'payroll:write'
  sourceVersion: string
  projectId: string
  target: PayrollHollowTarget | null
  config: PayrollHollowConfigQuery | null
  action: PayrollHollowAction
}

export interface PayrollHollowCommandResult {
  commandId: string
  projectId: string
  statementId: string | null
  startId: string | null
  policyRevisionIds: string[]
  sourceVersion: string
  outcome: 'saved' | 'started'
  logIds: string[]
}

export interface PayrollHollowPending {
  command: PayrollHollowCommand
  state: 'sending' | 'unknown' | 'awaiting-read'
  result: PayrollHollowCommandResult | null
}

export interface PayrollHollowRepository {
  hollowConfig: (query: PayrollQuery, config: PayrollHollowConfigQuery) => Promise<PayrollHollowConfigRead>
  executeHollow: (command: PayrollHollowCommand) => Promise<PayrollHollowCommandResult>
}

/** P4更正只允许调整同一原采用引用的数量/单价；不得用当前空鼓替换原事实。 */
export interface PayrollHollowAdjustmentBasis {
  schemaVersion: 1
  source: PayrollHollowSnapshot
  components: Array<{ adoptionId: string, recordId: string, count: number | null, unitAmount: number | null }>
}
