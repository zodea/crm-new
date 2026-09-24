import type { PayrollAFeesPhysicalProjection } from './central-a-fees-provenance'
import type { PayrollAdjustmentRecord } from './central-adjustment-contract'
import type { PayrollHollowSnapshot } from './central-hollow-deduction-contract'
import type { PayrollHollowProvenProjection } from './central-hollow-deduction-projection'
import type { PayrollHollowOriginal } from './central-hollow-processed-original'
import type { PayrollDb } from './statements'
import { payrollAAmount, payrollAMoney } from './central-a-calculation'
import { decodePayrollAdjustmentResult, isPayrollAdjustmentConfirmedSnapshot } from './central-adjustment-codec'
import { assertPayrollAdjustmentCommand } from './central-adjustment-validation'
import { payrollCanonical } from './central-command-shared'
import { payrollHollowProofHash as hash, payrollHollowProcessedOriginal, payrollHollowProofSame as same } from './central-hollow-processed-original'
import { payrollObject } from './central-snapshot'
import { amountInCents } from './statements'

type Row = Record<string, unknown>
type Projection = Pick<PayrollHollowProvenProjection, 'adjustments' | 'originals' | 'processedVersions' | 'documents' | 'unavailableIds'> & { fees?: PayrollAFeesPhysicalProjection }
const parsed = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : null

async function frozenSetProven(db: PayrollDb, snapshot: PayrollHollowSnapshot, statementId: string, projection?: Projection) {
  if (projection?.unavailableIds.has(statementId))
    return false
  const mapped = projection?.documents.get(statementId)
  if (mapped)
    return same(mapped, snapshot)
  const [head] = await db.select<Row>('SELECT * FROM wage_statements WHERE id=?', [statementId])
  const raw = head ? parsed(head.snapshot_json) : null
  const document = payrollObject(raw) ? raw[`${snapshot.scope.formatFamily.toLowerCase()}Document`] : null
  if (!head || head.status !== 'released' || head.project_id !== snapshot.scope.projectId || head.format_family !== snapshot.scope.formatFamily || !payrollObject(document) || !same(document.hollow, snapshot))
    return false
  const receipts = await db.select<Row>('SELECT * FROM payroll_command_receipts WHERE statement_id=? AND action=?', [statementId, `release-${snapshot.scope.formatFamily.toLowerCase()}`])
  if (receipts.length !== 1)
    return false
  const receipt = receipts[0]!
  const command = parsed(receipt.command_json)
  const result = parsed(receipt.result_json)
  if (!payrollObject(command) || !payrollObject(result) || command.commandId !== receipt.command_id || command.actorId !== receipt.actor_id || command.statementId !== statementId || command.projectId !== snapshot.scope.projectId || receipt.fingerprint !== await hash(command) || payrollCanonical(command) !== receipt.command_json
    || result.commandId !== command.commandId || result.statementId !== statementId || result.outcome !== 'released' || !Array.isArray(result.logIds) || !result.logIds.length || result.logIds.some(id => typeof id !== 'string') || new Set(result.logIds).size !== result.logIds.length) {
    return false
  }
  const logs = await db.select<Row>(`SELECT * FROM operation_logs WHERE id IN (${result.logIds.map(() => '?').join(',')})`, result.logIds)
  return logs.length === result.logIds.length && logs.every(log => log.operator === command.actorId)
    && logs.some(log => log.table_name === 'wage_statements' && log.record_id === statementId && log.action === 'update' && payrollObject(parsed(log.after_data)) && (parsed(log.after_data) as Row).snapshot_json === head.snapshot_json)
}

function nativeRecord(row: Row): PayrollAdjustmentRecord | null {
  const snapshot = parsed(row.confirmed_snapshot_json)
  const basis = parsed(row.basis_json)
  if (row.status !== 'confirmed' || !isPayrollAdjustmentConfirmedSnapshot(snapshot) || snapshot.id !== row.id || snapshot.rootAdjustmentId !== row.root_adjustment_id || snapshot.correctsAdjustmentId !== row.corrects_adjustment_id || snapshot.original.statementId !== row.original_statement_id || snapshot.original.projectId !== row.project_id || snapshot.original.formatFamily !== row.format_family
    || snapshot.reason !== row.reason || snapshot.evidenceNote !== row.evidence_note || !same(snapshot.preview.after, basis) || amountInCents(snapshot.preview.delta.value!) !== row.signed_delta_fen || snapshot.confirmedBy !== row.confirmed_by || snapshot.confirmedAt !== row.confirmed_at) {
    return null
  }
  return { id: snapshot.id, rootAdjustmentId: snapshot.rootAdjustmentId, originalStatementId: snapshot.original.statementId, projectId: snapshot.original.projectId, status: 'confirmed', draft: { reason: snapshot.reason, evidenceNote: snapshot.evidenceNote, correctsAdjustmentId: snapshot.correctsAdjustmentId, basis: snapshot.preview.after }, delta: snapshot.preview.delta.value, snapshot }
}

async function confirmationProven(db: PayrollDb, row: Row, record: PayrollAdjustmentRecord): Promise<boolean> {
  const snapshot = record.snapshot!
  const [receipt] = await db.select<Row>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [snapshot.commandId])
  if (!receipt)
    return false
  const command = parsed(receipt.command_json)
  assertPayrollAdjustmentCommand(command)
  const result = decodePayrollAdjustmentResult(parsed(receipt.result_json), command)
  if (command.action.kind !== 'confirm-adjustment' || command.target.adjustmentId !== record.id || command.commandId !== snapshot.commandId || command.actorId !== snapshot.confirmedBy || command.projectId !== record.projectId || command.origin !== 'real'
    || receipt.command_id !== command.commandId || receipt.actor_id !== command.actorId || receipt.project_id !== command.projectId || receipt.statement_id !== record.originalStatementId || receipt.action !== command.action.kind || receipt.fingerprint !== await hash(command) || payrollCanonical(command) !== receipt.command_json
    || result.adjustmentId !== record.id || result.originalStatementId !== record.originalStatementId || result.logIds.length !== 1) {
    return false
  }
  const [log] = await db.select<Row>('SELECT * FROM operation_logs WHERE id=?', [result.logIds[0]])
  const before = log ? parsed(log.before_data) : null
  return !!log && log.table_name === 'payroll_adjustments' && log.record_id === record.id && log.action === 'update' && log.operator === snapshot.confirmedBy && same(parsed(log.after_data), row)
    && payrollObject(before) && before.id === row.id && before.status === 'draft' && before.original_statement_id === row.original_statement_id && before.basis_json === row.basis_json && before.confirmed_snapshot_json === null && before.signed_delta_fen === null
}

/** 只验证冻结引用的确认链前缀。后续新确认仍可存在，不重算旧冻结为当前端点。 */
export async function provePayrollHollowProcessed(db: PayrollDb, snapshot: PayrollHollowSnapshot, statementId: string, projection?: Projection): Promise<boolean> {
  try {
    if (!snapshot.previousProcessed.length)
      return true
    if (!await frozenSetProven(db, snapshot, statementId, projection))
      return false
    const originals = new Map<string, PayrollHollowOriginal>()
    for (const processed of snapshot.previousProcessed) {
      const adoption = processed.adoption
      if (adoption.statementId === statementId || !same(adoption.scope, snapshot.scope) || adoption.month > snapshot.month || processed.adjustmentIds.length > 1)
        return false
      const rows = await db.select<Row>('SELECT * FROM payroll_adjustments WHERE original_statement_id=? ORDER BY rowid', [adoption.statementId])
      const prefix = new Map<string, PayrollAdjustmentRecord>()
      let id: string | null = processed.adjustmentIds[0] ?? null
      while (id) {
        if (prefix.has(id) || projection?.unavailableIds.has(id))
          return false
        const row = rows.find(row => row.id === id)
        const mapped = projection?.adjustments.get(id)
        const record = mapped ?? (row ? nativeRecord(row) : null)
        if (!row || !record || record.status !== 'confirmed' || !record.snapshot || !isPayrollAdjustmentConfirmedSnapshot(record.snapshot) || record.originalStatementId !== adoption.statementId || record.projectId !== adoption.projectId || (!mapped && !await confirmationProven(db, row, record)))
          return false
        prefix.set(id, record)
        id = record.draft.correctsAdjustmentId
      }
      const records = rows.filter(row => prefix.has(String(row.id))).map(row => prefix.get(String(row.id))!)
      if (records.length !== prefix.size)
        return false
      const head = processed.adjustmentIds[0] ? prefix.get(processed.adjustmentIds[0]) : null
      if (head) {
        let original = originals.get(adoption.statementId) ?? projection?.originals.get(adoption.statementId)
        original ??= await payrollHollowProcessedOriginal(db, adoption, projection?.fees) ?? undefined
        if (!original || !original.basis.hollow?.source.adoptions.some(row => same(row, adoption)))
          return false
        originals.set(adoption.statementId, original)
        for (const record of records) {
          const before = record.draft.correctsAdjustmentId ? prefix.get(record.draft.correctsAdjustmentId)?.snapshot?.preview.after : original.basis
          if (!same(record.snapshot!.original, original.original) || !same(record.snapshot!.preview.before, before) || record.rootAdjustmentId !== head.rootAdjustmentId || (record.draft.correctsAdjustmentId === null && record.id !== record.rootAdjustmentId))
            return false
        }
      }
      const basis = head?.snapshot?.preview.after?.hollow
      const component = basis?.components.find(row => row.adoptionId === adoption.id && row.recordId === adoption.line.recordId)
      if (head && (!basis || !component || !basis.source.adoptions.some(row => same(row, adoption)) || component.count === null || component.unitAmount === null))
        return false
      const effectiveAmount = payrollAAmount([component ? payrollAMoney(component.count! * component.unitAmount!) : adoption.line.amount])
      if (!same(effectiveAmount, processed.effectiveAmount))
        return false
      if (processed.sourceVersion !== await hash({ adoption, records, effectiveAmount }) && !projection?.processedVersions.get(processed.sourceVersion)?.some(alias => alias.adoptionId === adoption.id && same(alias.adjustmentIds, processed.adjustmentIds) && same(alias.effectiveAmount, effectiveAmount)))
        return false
    }
    return true
  }
  catch { return false }
}
