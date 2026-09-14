import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollActualFact } from '../../app/lib/payroll/central-actual-contract'
import type { PayrollReadGraph } from '../../app/lib/payroll/central-read'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { wireCent, wireDate, wireId } from '../../app/lib/payroll/central-payroll-wire'
import { readPayrollStatement } from '../../app/lib/payroll/central-read'
import { amountInCents } from '../../app/lib/payroll/statements'
import { payrollAdjustmentHash as hash, payrollKnownAmount as known } from './payroll-adjustment-facts'

/** P0 已接管的原金额与成员映射只读投影，不用当前头金额、名册或单价补齐原事实。 */
export async function loadPayrollHistoricalActual(tx: TransactionDb, statementId: string, graph: PayrollReadGraph): Promise<PayrollActualFact> {
  const detail = await readPayrollStatement(tx, statementId, graph)
  const frozen = detail.snapshot.data
  const actual = detail.actualAmount
  const modern = frozen && ['aDocument', 'aSource', 'c1Document', 'c1Source', 'c2Document', 'c2Source'].some(k => k in frozen)
  const conflicts = detail.diagnostics.some(d => d.code === 'snapshot-row-mismatch')
  const amountKnown = !modern && !conflicts && detail.recordKind === 'central' && actual !== null && wireCent(actual) && (!frozen?.formatFamily || frozen.formatFamily === detail.formatFamily) && (!frozen || !('actualAmountFen' in frozen) || frozen.actualAmountFen === amountInCents(actual))
  const amountReasons = amountKnown ? [] : ['原实际金额、格式或冻结依据无法互证；不采用当前行金额补齐']
  const sourceVersion = hash({ id: statementId, original: detail.snapshot.originalRaw, snapshot: detail.snapshot.raw, stored: detail.stored, diagnostics: detail.diagnostics })
  const proofRefs = [{ kind: 'frozen-source' as const, id: statementId, sourceFingerprint: sourceVersion }]
  const membersValid = Array.isArray(frozen?.members) && frozen.members.length === detail.members.length && detail.members.length > 0 && detail.members.every(m => wireId(m.workerId)) && new Set(detail.members.map(m => m.workerId)).size === detail.members.length
  const historicalMembers = membersValid ? detail.members.map(m => ({ workerId: m.workerId!, name: m.workerName, crewId: detail.crewId })) : []
  const allocationsValid = amountKnown && frozen?.allocationRecorded === true && membersValid && Array.isArray(frozen.allocations) && frozen.allocations.length === detail.allocations.length && detail.allocations.length > 0 && new Set(detail.allocations.map(a => a.workerId)).size === detail.allocations.length && detail.allocations.every(a => historicalMembers.some(m => m.workerId === a.workerId) && a.amount !== null && wireCent(a.amount) && Number.isSafeInteger(a.allocatedAmountFen) && a.allocatedAmountFen === amountInCents(a.amount))
  const totalFen = allocationsValid ? detail.allocations.reduce((sum, a) => sum + a.allocatedAmountFen!, 0) : null
  const allocations = allocationsValid && totalFen! <= amountInCents(actual!) ? detail.allocations.map(a => ({ workerId: a.workerId!, workerName: historicalMembers.find(m => m.workerId === a.workerId)?.name ?? null, crewId: detail.crewId, amount: a.amount, proofRefs })) : []
  const allocationState = allocations.length && allocations.length === historicalMembers.length && totalFen === amountInCents(actual!) ? 'complete' : allocations.length ? 'partial' : 'unknown'
  const diagnostics = [...detail.diagnostics.map(d => ({ ...d, workerId: null, entityId: null, legacyRecordId: detail.legacyId })), ...(allocationState === 'complete' ? [] : [{ code: 'historical-allocation-unproven', message: '历史个人分配未完整记录；整单可证金额与个人已收分别显示', recordId: statementId, workerId: null, field: 'allocations', tableName: 'wage_statements', entityId: null, legacyRecordId: detail.legacyId }])]
  const occurred = detail.releasedAt ?? detail.submittedAt
  return { identity: `real:payroll:released:${statementId}`, ref: { kind: 'released-statement', statementId }, kind: 'initial-release', projectId: detail.projectId, originalStatementIds: [statementId], adjustmentIds: [], applicationIds: [], reverses: null, occurredOn: occurred && wireDate(occurred.slice(0, 10)) ? occurred.slice(0, 10) : null, recordedAt: occurred, signedAmount: amountKnown ? known(actual!) : payrollAAmount([null], amountReasons), allocations, allocationState, historicalMembers, qualification: amountKnown ? 'historical-amount-proven' : 'unproven', sourceVersion, diagnostics }
}
