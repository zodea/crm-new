import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollActualFact, PayrollActualScope } from '../../app/lib/payroll/central-actual-contract'
import { isPayrollActualSnapshot } from '../../app/lib/payroll/central-actual-codec'
import { assertPayrollActualCommand, assertPayrollActualDraft } from '../../app/lib/payroll/central-actual-validation'
import { decodePayrollAdjustmentResult, isPayrollAdjustmentConfirmedSnapshot } from '../../app/lib/payroll/central-adjustment-codec'
import { isPayrollAdjustmentBalance } from '../../app/lib/payroll/central-adjustment-read-codec'
import { wireObject } from '../../app/lib/payroll/central-payroll-wire'
import { amountInCents } from '../../app/lib/payroll/statements'
import { payrollAdjustmentHash as hash, payrollKnownAmount as known } from './payroll-adjustment-facts'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'

interface EventRow { id: string, project_id: string, kind: string, occurred_on: string, signed_amount_fen: number, proof_json: string, confirmed_snapshot_json: string, confirmed_by: string, confirmed_at: string }
/** 独立实额须与原确认命令、回执、物理分配及应用互证，不能仅凭一行负数入账。 */
export async function loadPayrollConfirmedActualEvents(tx: TransactionDb, scope: PayrollActualScope): Promise<{ rows: PayrollActualFact[], reasons: string[] }> {
  if (!(await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payroll_actual_events\'')).length)
    return { rows: [], reasons: [] }
  const events = await tx.select<EventRow>('SELECT * FROM payroll_actual_events WHERE project_id=? AND kind<>\'recording-reversal\' ORDER BY id', [scope.projectId])
  const receipts = await tx.select<{ command_id: string, actor_id: string, project_id: string, command_json: string, fingerprint: string, result_json: string }>('SELECT * FROM payroll_command_receipts WHERE project_id=? AND action=\'confirm-actual-payment\'', [scope.projectId])
  const rows: PayrollActualFact[] = []
  const reasons: string[] = []
  const imported = await loadPayrollMigratedProof(tx, scope.projectId)
  for (const event of events) {
    const migrated = imported.facts.get(`real:payroll:actual:${event.id}`)
    if (migrated) {
      if (!scope.originalStatementIds || migrated.originalStatementIds.some(id => scope.originalStatementIds!.includes(id)))
        rows.push(migrated)
      continue
    }
    try {
      const raw: unknown = JSON.parse(event.confirmed_snapshot_json)
      if (!isPayrollActualSnapshot(raw) || 'kind' in raw || raw.id !== event.id || raw.projectId !== event.project_id)
        throw new Error('实际收付冻结头缺损')
      assertPayrollActualDraft(raw.draft)
      if (raw.draft.amount === null || !Number.isSafeInteger(amountInCents(raw.draft.amount)) || raw.draft.amount === 0 || raw.draft.amount * (raw.draft.kind === 'refund' ? -1 : 1) < 0)
        throw new Error('实际收付金额无法证明')
      const snapshot = raw
      if (scope.originalStatementIds && !snapshot.originals.some(o => scope.originalStatementIds!.includes(o.statementId)))
        continue
      const receipt = receipts.find(r => r.command_id === snapshot.commandId)
      if (!receipt)
        throw new Error('实际收付缺少原确认回执')
      const command: unknown = JSON.parse(receipt.command_json)
      assertPayrollActualCommand(command)
      const result = decodePayrollAdjustmentResult(JSON.parse(receipt.result_json), command)
      if (hash(command) !== receipt.fingerprint || command.commandId !== snapshot.commandId || command.actorId !== receipt.actor_id || command.actorId !== event.confirmed_by || command.actorId !== snapshot.confirmedBy || command.origin !== 'real' || command.projectId !== event.project_id || hash(command.action.payment) !== hash(snapshot.draft) || snapshot.confirmedAt !== event.confirmed_at || snapshot.draft.occurredOn !== event.occurred_on || snapshot.draft.kind !== event.kind || amountInCents(snapshot.draft.amount!) !== event.signed_amount_fen || result.originalStatementId !== snapshot.originals[0]?.statementId || result.actualEventId !== event.id || hash(result.applicationIds) !== hash(snapshot.applicationIds) || hash(JSON.parse(event.proof_json)) !== hash({ evidenceNote: snapshot.draft.evidenceNote }) || hash([...command.target.adjustmentIds].sort()) !== hash(snapshot.draft.applications.map(a => a.adjustmentId).sort()))
        throw new Error('实际收付、原提交与回执不一致')
      const allocations = await tx.select<{ worker_id: string, signed_amount_fen: number, proof_json: string }>('SELECT * FROM payroll_actual_allocations WHERE event_id=? ORDER BY worker_id', [event.id])
      const applications = await tx.select<{ id: string, adjustment_id: string, root_adjustment_id: string, kind: string, signed_applied_fen: number, balance_version: string, released_statement_id: string | null, proof_json: string }>('SELECT * FROM payroll_adjustment_applications WHERE actual_event_id=? ORDER BY id', [event.id])
      const allocationValues = allocations.map(a => [a.worker_id, a.signed_amount_fen])
      const submittedAllocations = snapshot.draft.allocations.map(a => [a.workerId, amountInCents(a.amount!)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      if (hash(allocationValues) !== hash(submittedAllocations) || allocations.reduce((sum, a) => sum + a.signed_amount_fen, 0) !== event.signed_amount_fen || hash(applications.map(a => a.id).sort()) !== hash([...snapshot.applicationIds].sort()) || applications.reduce((sum, a) => sum + a.signed_applied_fen, 0) !== event.signed_amount_fen || applications.some(a => !snapshot.draft.applications.some(s => s.adjustmentId === a.adjustment_id && s.balanceVersion === a.balance_version && amountInCents(s.amount!) === a.signed_applied_fen)))
        throw new Error('实际收付分配或处理关系与原确认不一致')
      const balances = []
      const originalIds: string[] = []
      for (const adjustmentId of command.target.adjustmentIds) {
        const application = applications.find(a => a.adjustment_id === adjustmentId)!
        const proof: unknown = JSON.parse(application.proof_json)
        if (application.kind !== 'actual-payment' || application.released_statement_id !== null || !wireObject(proof) || proof.commandId !== command.commandId || !isPayrollAdjustmentBalance(proof.before) || proof.before.adjustmentId !== adjustmentId || proof.before.rootAdjustmentId !== application.root_adjustment_id || proof.before.balanceVersion !== application.balance_version || proof.before.remainingDelta.value === null || proof.before.remainingDelta.value * application.signed_applied_fen <= 0 || Math.abs(application.signed_applied_fen) > Math.abs(amountInCents(proof.before.remainingDelta.value)))
          throw new Error('实际处理的原余额、种类及根更正无法证明')
        const [adjustment] = await tx.select<{ id: string, root_adjustment_id: string, project_id: string, original_statement_id: string, status: string, confirmed_snapshot_json: string }>('SELECT * FROM payroll_adjustments WHERE id=?', [adjustmentId])
        const frozen: unknown = imported.records.get(adjustmentId)?.snapshot ?? (adjustment && JSON.parse(adjustment.confirmed_snapshot_json))
        if (!adjustment || adjustment.status !== 'confirmed' || adjustment.project_id !== event.project_id || adjustment.root_adjustment_id !== application.root_adjustment_id || !isPayrollAdjustmentConfirmedSnapshot(frozen) || frozen.id !== adjustmentId || frozen.rootAdjustmentId !== application.root_adjustment_id || frozen.original.statementId !== adjustment.original_statement_id || !snapshot.originals.some(o => hash(o) === hash(frozen.original)))
          throw new Error('实际处理的原更正与原工资引用不一致')
        originalIds.push(adjustment.original_statement_id)
        balances.push(proof.before)
      }
      if (new Set(balances.map(b => b.rootAdjustmentId)).size !== balances.length || hash([...new Set(originalIds)]) !== hash(snapshot.originals.map(o => o.statementId)) || !command.sourceVersion.endsWith(`+actual:${hash({ target: command.target, originals: snapshot.originals, balances, draft: snapshot.draft })}`))
        throw new Error('实际处理采用的原依据版本不能复原')
      const sourceVersion = hash({ event, allocations, applications, receipt })
      const historicalMembers = snapshot.originals.flatMap(o => o.members.map(m => ({ workerId: m.workerId, crewId: m.crewId, name: m.workerName }))).filter((m, i, all) => all.findIndex(other => other.workerId === m.workerId && other.crewId === m.crewId) === i)
      const factAllocations = allocations.map((a) => {
        const member = historicalMembers.find(m => m.workerId === a.worker_id)
        if (!member || hash(JSON.parse(a.proof_json)) !== hash({ workerId: member.workerId, workerName: member.name, crewId: member.crewId }))
          throw new Error('收退款成员的原确认关系无法证明')
        return { workerId: member.workerId, workerName: member.name, crewId: member.crewId, amount: a.signed_amount_fen / 100, proofRefs: [{ kind: 'actual-confirmation' as const, id: event.id, sourceFingerprint: sourceVersion }] }
      })
      rows.push({ identity: `real:payroll:actual:${event.id}`, ref: { kind: 'actual-event', eventId: event.id }, kind: snapshot.draft.kind, projectId: event.project_id, originalStatementIds: snapshot.originals.map(o => o.statementId), adjustmentIds: snapshot.draft.applications.map(a => a.adjustmentId), applicationIds: snapshot.applicationIds, reverses: null, occurredOn: event.occurred_on, recordedAt: event.confirmed_at, signedAmount: known(event.signed_amount_fen / 100), allocations: factAllocations, allocationState: 'complete', historicalMembers, qualification: 'proven', sourceVersion, diagnostics: [] })
    }
    catch {
      reasons.push(`工资收付 ${event.id} 的原确认、实际分配或处理引用缺损，不能按零忽略`)
    }
  }
  return { rows, reasons }
}
