import type { PayrollAFeeRevision, PayrollAManagementBook, PayrollAManagementBookRevision, PayrollAManagementOwnership, PayrollANegativeLineRevision, PayrollAStatementSourceSnapshotV2, PayrollAStatementSourceSnapshotV4 } from './central-a-fees-contract'
import type { PayrollAStatementSourceSnapshotV3 } from './central-a-hollow-contract'
import type { PayrollDb } from './statements'
import { payrollACanonical } from './central-a-calculation'
import { encodePayrollAFeesWire, parsePayrollAFeesCommand } from './central-a-fees-codec'
import { feeObject } from './central-a-fees-validation'

type Row = Record<string, unknown>
const same = (a: unknown, b: unknown) => payrollACanonical(a) === payrollACanonical(b)
export interface PayrollAFeesPhysicalProjection {
  feeRevisions: ReadonlyMap<string, PayrollAFeeRevision>
  managementBooks: ReadonlyMap<string, PayrollAManagementBook>
  managementRevisions: ReadonlyMap<string, PayrollAManagementBookRevision>
  negativeLines: ReadonlyMap<string, PayrollANegativeLineRevision>
  managementOwnership: ReadonlyMap<string, PayrollAManagementOwnership>
  unavailableIds: ReadonlySet<string>
}
/** 提供方须先按不可变原图核验当前物理行；这里只消费已经过证明的封闭身份投影。 */
export type PayrollAFeesProjectionLoader = (projectId: string) => Promise<PayrollAFeesPhysicalProjection>

/** 自己的负价修订只能来自已成功的原命令；最新有效集合须与发放冻结一致。 */
async function negativeCollectionProof(db: PayrollDb, statementId: string, source: PayrollAStatementSourceSnapshotV2 | PayrollAStatementSourceSnapshotV3 | PayrollAStatementSourceSnapshotV4): Promise<boolean> {
  const rows = await db.select<Row>('SELECT id,line_id,revision,removed FROM payroll_a_negative_lines WHERE statement_id=? ORDER BY revision,id', [statementId])
  const receipts = await db.select<Row>('SELECT command_id,actor_id,project_id,fingerprint,command_json,result_json FROM payroll_command_receipts WHERE statement_id=? AND action=\'save-a-negative-lines\'', [statementId])
  const signedIds: string[] = []
  for (const receipt of receipts) {
    try {
      const raw = String(receipt.command_json)
      const parsed: unknown = JSON.parse(raw)
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
      if (payrollACanonical(parsed) !== raw || [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') !== receipt.fingerprint)
        return false
      const command = parsePayrollAFeesCommand(encodePayrollAFeesWire(parsed))
      const result: unknown = JSON.parse(String(receipt.result_json))
      if (command.action.kind !== 'save-a-negative-lines' || command.commandId !== receipt.command_id || command.actorId !== receipt.actor_id || command.projectId !== source.subject.projectId || receipt.project_id !== source.subject.projectId || command.statementId !== statementId || !same(command.book, source.book) || !feeObject(result) || result.commandId !== command.commandId || result.projectId !== command.projectId || result.statementId !== statementId || !['saved', 'needs-recheck'].includes(String(result.outcome)) || !Array.isArray(result.negativeLineRevisionIds) || result.negativeLineRevisionIds.some(id => typeof id !== 'string') || result.negativeLineRevisionIds.length !== command.action.lines.length + command.action.remove.length)
        return false
      signedIds.push(...result.negativeLineRevisionIds as string[])
    }
    catch { return false }
  }
  if (new Set(signedIds).size !== signedIds.length || !same(signedIds.sort(), rows.map(r => String(r.id)).sort()))
    return false
  const current = new Map<string, Row>()
  for (const row of rows) current.set(String(row.line_id), row)
  return same([...current.values()].filter(r => r.removed === 0).map(r => String(r.id)).sort(), source.fees.negativeLines.filter(n => n.statementId === statementId).map(n => n.id).sort())
}
/** 原冻结指向的物理修订、用途和领取关系仍须存在；原文与关系分开核验。 */
export async function payrollAFeesPhysicalProof(db: PayrollDb, statementId: string, source: PayrollAStatementSourceSnapshotV2 | PayrollAStatementSourceSnapshotV3 | PayrollAStatementSourceSnapshotV4, projection?: PayrollAFeesPhysicalProjection): Promise<boolean> {
  const [relation] = await db.select<Row>('SELECT * FROM payroll_a_statement_books WHERE statement_id=?', [statementId])
  if (!relation || relation.project_id !== source.subject.projectId || relation.leader_worker_id !== source.subject.leaderWorkerId || relation.book_purpose !== source.book.bookPurpose || relation.management_book_id !== source.book.managementBookId)
    return false
  if (!await negativeCollectionProof(db, statementId, source))
    return false
  for (const r of source.fees.feeRevisions) {
    if (projection?.unavailableIds.has(r.id))
      return false
    const mapped = projection?.feeRevisions.get(r.id)
    if (mapped) {
      if (!same(mapped, r))
        return false
      continue
    }
    const [row] = await db.select<Row>('SELECT * FROM payroll_a_fee_revisions WHERE id=?', [r.id])
    const expected = { id: r.id, fee_id: r.feeId, project_id: r.projectId, crew_id: r.crewId, leader_worker_id: r.leaderWorkerId, book_purpose: r.bookPurpose, management_book_id: r.managementBookId, kind: r.kind, name: r.name, enabled: Number(r.enabled), unit_price: r.unitPrice, unit: r.unit, basis_json: payrollACanonical(r.basis), effective_month: r.effectiveMonth, adopted_default_json: payrollACanonical(r.adoptedDefault), revision: r.revision, removed: Number(r.removed), operator_id: r.operatorId, created_at: r.createdAt }
    if (!same(row, expected))
      return false
  }
  const management = source.fees.management
  if (management) {
    if (projection?.unavailableIds.has(management.book.id) || projection?.unavailableIds.has(management.revision.id))
      return false
    const [book] = await db.select<Row>('SELECT * FROM payroll_a_management_books WHERE id=?', [management.book.id])
    const [revision] = await db.select<Row>('SELECT * FROM payroll_a_management_book_revisions WHERE id=?', [management.revision.id])
    const r = management.revision
    if (!book || book.project_id !== source.subject.projectId || book.manager_worker_id !== source.subject.leaderWorkerId || book.created_at !== management.book.createdAt || book.created_by !== management.book.createdBy)
      return false
    const mappedBook = projection?.managementBooks.get(management.book.id)
    if (mappedBook && !same({ ...mappedBook, deletedAt: management.book.deletedAt }, management.book))
      return false
    const mappedRevision = projection?.managementRevisions.get(r.id)
    if (mappedRevision ? !same(mappedRevision, r) : !same(revision, { id: r.id, management_book_id: r.managementBookId, project_id: r.projectId, revision: r.revision, effective_month: r.effectiveMonth, management_mode: r.managementMode, scope_json: payrollACanonical(r.scope), initial_pay_ratio: r.initialPayRatio, evidence_note: r.evidenceNote, source_version: r.sourceVersion, operator_id: r.operatorId, created_at: r.createdAt }))
      return false
  }
  for (const n of source.fees.negativeLines) {
    if (projection?.unavailableIds.has(n.id))
      return false
    const mapped = projection?.negativeLines.get(n.id)
    if (mapped) {
      if (!same(mapped, n))
        return false
      continue
    }
    const [row] = await db.select<Row>('SELECT * FROM payroll_a_negative_lines WHERE id=?', [n.id])
    if (!same(row, { id: n.id, line_id: n.lineId, statement_id: n.statementId, project_id: n.projectId, management_book_id: n.managementBookId, management_revision_id: n.managementRevisionId, revision: n.revision, label: n.label, quantity: n.quantity, unit: n.unit, unit_price: n.unitPrice, signed_amount_fen: n.signedAmountFen, scope_json: payrollACanonical(n.scope), reason: n.reason, evidence_note: n.evidenceNote, actual_ref_json: payrollACanonical(n.actualRef), removed: Number(n.removed), operator_id: n.operatorId, created_at: n.createdAt }))
      return false
  }
  for (const o of source.fees.managementOwnership) {
    if (projection?.unavailableIds.has(o.id))
      return false
    const [row] = await db.select<Row>('SELECT * FROM payroll_a_management_ownership WHERE id=?', [o.id])
    const mapped = projection?.managementOwnership.get(o.id)
    if (mapped ? !same(mapped, o) : !same(row, { id: o.id, project_id: o.projectId, ownership_key: o.ownershipKey, management_book_id: o.managementBookId, first_statement_id: o.firstStatementId, proof_json: payrollACanonical(o.proof) }))
      return false
    const [original] = await db.select<Row>('SELECT w.status,b.management_book_id,r.command_id FROM wage_statements w JOIN payroll_a_statement_books b ON b.statement_id=w.id JOIN payroll_command_receipts r ON r.statement_id=w.id AND r.action=\'release-a\' WHERE w.id=? AND r.command_id=?', [o.firstStatementId, o.proof.firstCommandId])
    if (!original || original.status !== 'released' || original.management_book_id !== o.managementBookId)
      return false
  }
  return source.book.bookPurpose !== 'management' || source.fees.lines.every(l => l.components.every(c => source.fees.managementOwnership.some(o => o.ownershipKey === c.ownershipKey && o.managementBookId === source.book.managementBookId)))
}
