import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollActualFact, PayrollActualReversalSnapshot, PayrollActualScope } from '../../app/lib/payroll/central-actual-contract'
import { decodePayrollAdjustmentResult, isPayrollOriginalWageRef } from '../../app/lib/payroll/central-adjustment-codec'
import { wireCent, wireExact, wireId, wireObject } from '../../app/lib/payroll/central-payroll-wire'
import { assertPayrollReversalCommand, assertPayrollReversalDraft } from '../../app/lib/payroll/central-reversal-validation'
import { amountInCents } from '../../app/lib/payroll/statements'
import { payrollAdjustmentHash as hash, payrollKnownAmount as known } from './payroll-adjustment-facts'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'
import { loadPayrollReleasedApplicationIds } from './payroll-release-application-provenance'

interface ReversalRow { id: string, project_id: string, reverses_kind: string, reverses_id: string, occurred_on: string, signed_amount_fen: number, proof_json: string, confirmed_snapshot_json: string, confirmed_by: string, confirmed_at: string }
export async function loadPayrollConfirmedReversals(tx: TransactionDb, scope: PayrollActualScope, previousFacts: PayrollActualFact[]): Promise<{ rows: PayrollActualFact[], reasons: string[] }> {
  if (!(await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payroll_actual_events\'')).length)
    return { rows: [], reasons: [] }
  const pending = await tx.select<ReversalRow>('SELECT * FROM payroll_actual_events WHERE project_id=? AND kind=\'recording-reversal\' ORDER BY rowid', [scope.projectId])
  const receipts = await tx.select<{ command_id: string, actor_id: string, project_id: string, fingerprint: string, command_json: string, result_json: string }>('SELECT * FROM payroll_command_receipts WHERE project_id=? AND action=\'confirm-recording-reversal\'', [scope.projectId])
  const rows: PayrollActualFact[] = []
  const reasons: string[] = []
  const consumed = new Set<string>()
  const imported = await loadPayrollMigratedProof(tx, scope.projectId)
  for (let i = pending.length - 1; i >= 0; i--) {
    const migrated = imported.facts.get(`real:payroll:actual:${pending[i]!.id}`)
    if (!migrated)
      continue
    pending.splice(i, 1)
    if (!scope.originalStatementIds || migrated.originalStatementIds.some(id => scope.originalStatementIds!.includes(id)))
      rows.push(migrated)
    if (migrated.reverses)
      consumed.add(hash(migrated.reverses))
  }
  while (pending.length) {
    let progressed = false
    for (let index = pending.length - 1; index >= 0; index--) {
      const event = pending[index]!
      if (scope.originalStatementIds) {
        try {
          const snapshot: unknown = JSON.parse(event.confirmed_snapshot_json)
          if (wireObject(snapshot) && Array.isArray(snapshot.originals) && snapshot.originals.length && snapshot.originals.every(isPayrollOriginalWageRef) && !snapshot.originals.some(o => scope.originalStatementIds!.includes(o.statementId))) {
            pending.splice(index, 1)
            progressed = true
            continue
          }
        }
        catch { /* 无法证明归属时保留缺损诊断。 */ }
      }
      const original = [...previousFacts, ...rows].find(f => f.ref.kind === event.reverses_kind && (f.ref.kind === 'released-statement' ? f.ref.statementId : f.ref.eventId) === event.reverses_id)
      if (!original)
        continue
      progressed = true
      pending.splice(index, 1)
      try {
        const raw: unknown = JSON.parse(event.confirmed_snapshot_json)
        wireExact(raw, ['schemaVersion', 'kind', 'id', 'commandId', 'projectId', 'originalFact', 'originals', 'draft', 'applications', 'applicationIds', 'confirmedBy', 'confirmedAt'])
        if (raw.schemaVersion !== 1 || raw.kind !== 'recording-reversal' || raw.id !== event.id || raw.projectId !== event.project_id || raw.confirmedBy !== event.confirmed_by || raw.confirmedAt !== event.confirmed_at || !wireId(raw.commandId) || !Array.isArray(raw.originals) || !raw.originals.every(isPayrollOriginalWageRef) || !Array.isArray(raw.applications) || !Array.isArray(raw.applicationIds) || !raw.applicationIds.every(wireId) || new Set(raw.applicationIds).size !== raw.applicationIds.length || hash(raw.originalFact) !== hash(original) || original.qualification !== 'proven' || original.signedAmount.value === null || original.allocationState !== 'complete')
          throw new Error('冲销原事实不一致')
        assertPayrollReversalDraft(raw.draft)
        if (!raw.draft.confirmedNotOccurred || !raw.draft.evidenceNote.trim() || raw.draft.confirmedOn !== event.occurred_on || event.signed_amount_fen !== -amountInCents(original.signedAmount.value))
          throw new Error('冲销金额或事实确认不一致')
        for (const a of raw.applications) {
          wireExact(a, ['originalApplicationId', 'adjustmentId', 'rootAdjustmentId', 'amount', 'balanceVersion'])
          if (![a.originalApplicationId, a.adjustmentId, a.rootAdjustmentId].every(wireId) || typeof a.amount !== 'number' || !wireCent(Math.abs(a.amount)) || typeof a.balanceVersion !== 'string')
            throw new Error('冲销处理引用无效')
        }
        const snapshot = raw as unknown as PayrollActualReversalSnapshot
        const receipt = receipts.find(r => r.command_id === snapshot.commandId)
        if (!receipt)
          throw new Error('缺少冲销回执')
        const command: unknown = JSON.parse(receipt.command_json)
        assertPayrollReversalCommand(command)
        const result = decodePayrollAdjustmentResult(JSON.parse(receipt.result_json), command)
        const expectedVersion = `+reversal:${hash({ target: command.target, originalFact: original, originals: snapshot.originals, applications: snapshot.applications, alreadyReversedBy: [], draft: snapshot.draft })}`
        if (command.origin !== 'real' || command.commandId !== snapshot.commandId || command.actorId !== event.confirmed_by || receipt.actor_id !== command.actorId || command.projectId !== event.project_id || receipt.project_id !== command.projectId || hash(command) !== receipt.fingerprint || !command.sourceVersion.endsWith(expectedVersion) || hash(command.target.original) !== hash(original.ref) || hash(command.action.reversal) !== hash(snapshot.draft) || result.actualEventId !== event.id || hash(result.applicationIds) !== hash(snapshot.applicationIds) || hash(JSON.parse(event.proof_json)) !== hash({ original: original.ref, ...snapshot.draft }) || consumed.has(hash(original.ref)))
          throw new Error('冲销原提交或唯一引用无法互证')
        const originalId = original.ref.kind === 'released-statement' ? original.ref.statementId : original.ref.eventId
        const sourceApps = await tx.select<{ id: string, adjustment_id: string, root_adjustment_id: string, signed_applied_fen: number }>(`SELECT * FROM payroll_adjustment_applications WHERE ${original.ref.kind === 'released-statement' ? 'released_statement_id' : 'actual_event_id'}=? ORDER BY id`, [originalId])
        const sourceIds = original.ref.kind === 'released-statement' ? await loadPayrollReleasedApplicationIds(tx, originalId) : original.applicationIds
        const applications = await tx.select<{ id: string, kind: string, adjustment_id: string, root_adjustment_id: string, signed_applied_fen: number, released_statement_id: string | null, balance_version: string, proof_json: string }>('SELECT * FROM payroll_adjustment_applications WHERE actual_event_id=? ORDER BY id', [event.id])
        if (sourceApps.length !== snapshot.applications.length || applications.length !== sourceApps.length || hash(applications.map(a => a.id).sort()) !== hash([...snapshot.applicationIds].sort()) || snapshot.applications.some(a => !sourceIds.includes(a.originalApplicationId) || !sourceApps.some(s => s.id === a.originalApplicationId && s.adjustment_id === a.adjustmentId && s.root_adjustment_id === a.rootAdjustmentId && s.signed_applied_fen === -amountInCents(a.amount))))
          throw new Error('原余额应用无法抵销')
        for (const [i, a] of snapshot.applications.entries()) {
          const row = applications.find(r => r.id === snapshot.applicationIds[i])
          if (!row || row.kind !== 'recording-reversal' || row.released_statement_id !== null || row.adjustment_id !== a.adjustmentId || row.root_adjustment_id !== a.rootAdjustmentId || row.signed_applied_fen !== amountInCents(a.amount) || row.balance_version !== a.balanceVersion || hash(JSON.parse(row.proof_json)) !== hash({ commandId: command.commandId, ...a }))
            throw new Error('冲销应用与冻结不一致')
        }
        const allocations = await tx.select<{ worker_id: string, signed_amount_fen: number, proof_json: string }>('SELECT * FROM payroll_actual_allocations WHERE event_id=? ORDER BY worker_id', [event.id])
        if (allocations.length !== original.allocations.length || allocations.some(a => !original.allocations.some(s => s.workerId === a.worker_id && a.signed_amount_fen === -amountInCents(s.amount!) && hash(JSON.parse(a.proof_json)) === hash({ workerId: s.workerId, workerName: s.workerName, crewId: s.crewId }))))
          throw new Error('原个人分配没有完整反向保留')
        const sourceVersion = hash({ event, allocations, applications, receipt, original: original.sourceVersion })
        rows.push({ identity: `real:payroll:actual:${event.id}`, ref: { kind: 'actual-event', eventId: event.id }, kind: 'recording-reversal', projectId: event.project_id, originalStatementIds: original.originalStatementIds, adjustmentIds: [...new Set(snapshot.applications.map(a => a.adjustmentId))], applicationIds: snapshot.applicationIds, reverses: original.ref, occurredOn: event.occurred_on, recordedAt: event.confirmed_at, signedAmount: known(event.signed_amount_fen / 100), allocations: original.allocations.map(a => ({ ...a, amount: -a.amount!, proofRefs: [{ kind: 'actual-confirmation', id: event.id, sourceFingerprint: sourceVersion }] })), allocationState: 'complete', historicalMembers: original.historicalMembers, qualification: 'proven', sourceVersion, diagnostics: [] })
        consumed.add(hash(original.ref))
      }
      catch { reasons.push(`错记冲销 ${event.id} 的原事实、核查依据或处理引用缺损，不能按零忽略`) }
    }
    if (!progressed)
      break
  }
  for (const event of pending) reasons.push(`错记冲销 ${event.id} 的原收付或前序冲销无法核实`)
  return { rows, reasons }
}
