import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAdjustmentBalance, PayrollAdjustmentDraft, PayrollAdjustmentRecord } from '../../app/lib/payroll/central-adjustment-contract'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { decodePayrollAdjustmentResult, isPayrollAdjustmentConfirmedSnapshot } from '../../app/lib/payroll/central-adjustment-codec'
import { initializePayrollAdjustmentSchema } from '../../app/lib/payroll/central-adjustment-schema'
import { assertPayrollAdjustmentCommand, assertPayrollAdjustmentDraft } from '../../app/lib/payroll/central-adjustment-validation'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { amountInCents } from '../../app/lib/payroll/statements'
import { loadPayrollActualFacts } from './payroll-actual-facts'
import { payrollMissingApplicationReasons } from './payroll-adjustment-application-integrity'
import { payrollAdjustmentChainHeads } from './payroll-adjustment-chain'
import { payrollAdjustmentHash as hash, loadPayrollAdjustmentOriginal } from './payroll-adjustment-facts'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'
import { loadPayrollReleasedApplicationIds } from './payroll-release-application-provenance'

export interface PayrollAdjustmentRow { id: string, root_adjustment_id: string, corrects_adjustment_id: string | null, original_statement_id: string, project_id: string, status: 'draft' | 'confirmed', reason: string, evidence_note: string, basis_json: string, signed_delta_fen: number | null, confirmed_snapshot_json: string | null }
export async function loadPayrollAdjustmentRows(tx: TransactionDb, originalStatementId?: string) {
  await initializePayrollAdjustmentSchema(tx)
  const imported = await loadPayrollMigratedProof(tx)
  const rows = (await tx.select<PayrollAdjustmentRow>(`SELECT * FROM payroll_adjustments${originalStatementId ? ' WHERE original_statement_id=?' : ''} ORDER BY rowid`, originalStatementId ? [originalStatementId] : [])).map((row) => {
    const proven = imported.records.get(row.id)
    const draft = imported.draftBases.get(row.id)
    if (row.status === 'draft' && draft && row.basis_json === draft.raw)
      return { ...row, basis_json: JSON.stringify(draft.basis) }
    return proven ? { ...row, basis_json: JSON.stringify(proven.draft.basis), confirmed_snapshot_json: JSON.stringify(proven.snapshot) } : row
  })
  payrollAdjustmentChainHeads(rows.map(readPayrollAdjustmentRecord))
  for (const row of rows.filter(r => r.status === 'confirmed')) {
    if (imported.records.has(row.id))
      continue
    const record = readPayrollAdjustmentRecord(row)
    const snapshot = record.snapshot!
    try {
      const [receipt] = await tx.select<{ fingerprint: string, actor_id: string, project_id: string, statement_id: string, action: string, command_json: string, result_json: string }>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [snapshot.commandId])
      if (!receipt)
        throw new Error('缺少原确认回执')
      const command: unknown = JSON.parse(receipt.command_json)
      assertPayrollAdjustmentCommand(command)
      const result = decodePayrollAdjustmentResult(JSON.parse(receipt.result_json), command)
      const original = await loadPayrollAdjustmentOriginal(tx, row.original_statement_id)
      const previous = rows.find(r => r.id === row.corrects_adjustment_id)
      const before = previous ? readPayrollAdjustmentRecord(previous).snapshot?.preview.after : original.basis
      if (command.action.kind !== 'confirm-adjustment' || command.target.adjustmentId !== row.id || command.commandId !== snapshot.commandId || command.projectId !== row.project_id || command.origin !== 'real' || command.actorId !== snapshot.confirmedBy || receipt.actor_id !== command.actorId || receipt.project_id !== row.project_id || receipt.statement_id !== row.original_statement_id || receipt.action !== command.action.kind || hash(command) !== receipt.fingerprint || payrollCanonical(command) !== receipt.command_json || result.adjustmentId !== row.id || result.originalStatementId !== row.original_statement_id || hash(snapshot.original) !== hash(original.original) || (row.corrects_adjustment_id === null ? row.root_adjustment_id !== row.id : !previous || previous.status !== 'confirmed' || previous.original_statement_id !== row.original_statement_id || previous.root_adjustment_id !== row.root_adjustment_id) || hash(before) !== hash(snapshot.preview.before))
        throw new Error('原确认及前序组成不一致')
    }
    catch { throw payrollProblem('unavailable', `更正 ${row.id} 的原工资、确认回执或前序依据不能互证，请保留原记录核查`) }
  }
  return rows
}
export function readPayrollAdjustmentRecord(row: PayrollAdjustmentRow): PayrollAdjustmentRecord {
  try {
    const draft: PayrollAdjustmentDraft = { reason: row.reason, evidenceNote: row.evidence_note, correctsAdjustmentId: row.corrects_adjustment_id, basis: JSON.parse(row.basis_json) }
    assertPayrollAdjustmentDraft(draft)
    const snapshot: unknown = row.confirmed_snapshot_json === null ? null : JSON.parse(row.confirmed_snapshot_json)
    if (row.status === 'confirmed' && (!isPayrollAdjustmentConfirmedSnapshot(snapshot) || snapshot.id !== row.id || snapshot.rootAdjustmentId !== row.root_adjustment_id || snapshot.correctsAdjustmentId !== row.corrects_adjustment_id || snapshot.original.statementId !== row.original_statement_id || snapshot.original.projectId !== row.project_id || snapshot.reason !== row.reason || snapshot.evidenceNote !== row.evidence_note || hash(snapshot.preview.after) !== hash(draft.basis) || amountInCents(snapshot.preview.delta.value!) !== row.signed_delta_fen))
      throw new Error('原冻结与更正正文不一致')
    if (row.status === 'draft' && (snapshot !== null || row.signed_delta_fen !== null))
      throw new Error('草稿不能有确认实效')
    return { id: row.id, rootAdjustmentId: row.root_adjustment_id, originalStatementId: row.original_statement_id, projectId: row.project_id, status: row.status, draft, delta: row.signed_delta_fen === null ? null : row.signed_delta_fen / 100, snapshot: row.status === 'confirmed' ? snapshot as PayrollAdjustmentRecord['snapshot'] : null }
  }
  catch { throw payrollProblem('unavailable', `更正 ${row.id} 的原正文或确认冻结已缺损，不能继续处理`) }
}
export async function loadPayrollAdjustmentBalance(tx: TransactionDb, adjustmentId: string): Promise<PayrollAdjustmentBalance> {
  const all = (await loadPayrollAdjustmentRows(tx)).map(readPayrollAdjustmentRecord)
  const current = all.find(r => r.id === adjustmentId)
  if (!current)
    throw payrollProblem('not-found', '工资更正不存在')
  const roots = all.filter(r => r.rootAdjustmentId === current.rootAdjustmentId)
  const rootIds = roots.map(r => r.id)
  const applications = await tx.select<{ id: string, root_adjustment_id: string, adjustment_id: string, signed_applied_fen: number, kind: string, actual_event_id: string | null, released_statement_id: string | null }>(`SELECT * FROM payroll_adjustment_applications WHERE root_adjustment_id=? OR adjustment_id IN (${rootIds.map(() => '?').join(',')}) ORDER BY id`, [current.rootAdjustmentId, ...rootIds])
  const confirmedDelta = payrollAAmount(roots.filter(r => r.status === 'confirmed').map(r => r.delta))
  const actual = applications.length ? await loadPayrollActualFacts(tx, { projectId: current.projectId }) : null
  const reasons = await payrollMissingApplicationReasons(tx, current.projectId, rootIds, applications.map(a => a.id))
  const amounts: Array<number | null> = reasons.length ? [null] : []
  for (const application of applications) {
    const fact = actual?.rows.find(f => application.actual_event_id ? f.ref.kind === 'actual-event' && f.ref.eventId === application.actual_event_id && f.applicationIds.includes(application.id) : f.ref.kind === 'released-statement' && f.ref.statementId === application.released_statement_id)
    const valid = fact && application.root_adjustment_id === current.rootAdjustmentId && rootIds.includes(application.adjustment_id) && Number.isSafeInteger(application.signed_applied_fen) && (application.actual_event_id ? application.kind === (fact.kind === 'recording-reversal' ? 'recording-reversal' : 'actual-payment') : application.kind === 'later-release' && (await loadPayrollReleasedApplicationIds(tx, application.released_statement_id!)).includes(application.id))
    amounts.push(valid ? application.signed_applied_fen / 100 : null)
    if (!valid)
      reasons.push(`处理 ${application.id} 缺少一致的实际发放或收退款确认，剩余暂不能证明`)
  }
  const appliedDelta = payrollAAmount(amounts, reasons)
  return { adjustmentId, rootAdjustmentId: current.rootAdjustmentId, confirmedDelta, appliedDelta, remainingDelta: payrollAAmount([confirmedDelta.value, appliedDelta.value === null ? null : -appliedDelta.value], reasons), balanceVersion: hash({ roots, applications, reasons }), applicationIds: applications.map(r => r.id) }
}
