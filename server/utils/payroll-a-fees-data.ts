import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAFeeRevision, PayrollAManagementBook, PayrollAManagementBookRevision, PayrollANegativeLineRevision } from '../../app/lib/payroll/central-a-fees-contract'

import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { loadPayrollMigratedFees } from './payroll-migrated-fees'

type Row = Record<string, unknown>
function projected<T extends { id: string }>(rows: T[], mapping: Map<string, T>, unavailable: Set<string>): T[] {
  if (rows.some(r => unavailable.has(r.id)))
    throw payrollProblem('unavailable', '迁入费用身份或原证据无法映射，请保留原资料核实')
  return rows.map(r => mapping.get(r.id) ?? r)
}
const str = (v: unknown) => String(v)
const nullable = (v: unknown) => v === null ? null : String(v)
const num = (v: unknown) => v === null ? null : Number(v)
export async function loadPayrollAFeeRevisions(db: TransactionDb, projectId: string): Promise<PayrollAFeeRevision[]> {
  const rows = (await db.select<Row>('SELECT * FROM payroll_a_fee_revisions WHERE project_id=? ORDER BY revision,id', [projectId])).map(r => ({ id: str(r.id), feeId: str(r.fee_id), projectId: str(r.project_id), crewId: nullable(r.crew_id), leaderWorkerId: str(r.leader_worker_id), bookPurpose: r.book_purpose, managementBookId: nullable(r.management_book_id), kind: r.kind, name: str(r.name), enabled: r.enabled === 1, unitPrice: num(r.unit_price), unit: nullable(r.unit), basis: JSON.parse(str(r.basis_json)), effectiveMonth: str(r.effective_month), adoptedDefault: JSON.parse(str(r.adopted_default_json)), revision: Number(r.revision), removed: r.removed === 1, operatorId: str(r.operator_id), createdAt: str(r.created_at) }) as PayrollAFeeRevision)
  const mapping = await loadPayrollMigratedFees(db, projectId)
  return projected(rows, mapping.feeRevisions, mapping.unavailableIds)
}
export async function loadPayrollAManagementBooks(db: TransactionDb, projectId: string): Promise<PayrollAManagementBook[]> {
  const rows = (await db.select<Row>('SELECT * FROM payroll_a_management_books WHERE project_id=? ORDER BY id', [projectId])).map(r => ({ id: str(r.id), projectId: str(r.project_id), managerWorkerId: nullable(r.manager_worker_id), createdBy: str(r.created_by), createdAt: str(r.created_at), deletedAt: nullable(r.deleted_at) }))
  const mapping = await loadPayrollMigratedFees(db, projectId)
  return projected(rows, mapping.managementBooks, mapping.unavailableIds)
}
export async function loadPayrollAManagementRevisions(db: TransactionDb, projectId: string): Promise<PayrollAManagementBookRevision[]> {
  const rows = (await db.select<Row>('SELECT * FROM payroll_a_management_book_revisions WHERE project_id=? ORDER BY revision,id', [projectId])).map(r => ({ id: str(r.id), managementBookId: str(r.management_book_id), projectId: str(r.project_id), revision: Number(r.revision), effectiveMonth: str(r.effective_month), managementMode: r.management_mode as PayrollAManagementBookRevision['managementMode'], scope: JSON.parse(str(r.scope_json)), initialPayRatio: num(r.initial_pay_ratio), evidenceNote: str(r.evidence_note), sourceVersion: str(r.source_version), operatorId: str(r.operator_id), createdAt: str(r.created_at) }))
  const mapping = await loadPayrollMigratedFees(db, projectId)
  return projected(rows, mapping.managementRevisions, mapping.unavailableIds)
}
export async function loadPayrollANegativeLines(db: TransactionDb, statementId: string): Promise<PayrollANegativeLineRevision[]> {
  const rows = (await db.select<Row>('SELECT * FROM payroll_a_negative_lines WHERE statement_id=? ORDER BY revision,id', [statementId])).map(r => ({ id: str(r.id), lineId: str(r.line_id), statementId: str(r.statement_id), projectId: str(r.project_id), managementBookId: str(r.management_book_id), managementRevisionId: str(r.management_revision_id), revision: Number(r.revision), label: str(r.label), quantity: num(r.quantity), unit: nullable(r.unit), unitPrice: num(r.unit_price), signedAmountFen: num(r.signed_amount_fen), scope: JSON.parse(str(r.scope_json)), reason: str(r.reason), evidenceNote: str(r.evidence_note), actualRef: JSON.parse(str(r.actual_ref_json)), removed: r.removed === 1, operatorId: str(r.operator_id), createdAt: str(r.created_at) }))
  const mapping = await loadPayrollMigratedFees(db, String((await db.select<Row>('SELECT project_id FROM wage_statements WHERE id=?', [statementId]))[0]?.project_id ?? ''))
  return projected(rows, mapping.negativeLines, mapping.unavailableIds)
}
export function effectivePayrollARevision<T extends { revision: number, effectiveMonth: string }>(rows: T[], month: string): T | null {
  return rows.filter(r => r.effectiveMonth <= month).sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth) || b.revision - a.revision)[0] ?? null
}
export function currentPayrollANegativeLines(rows: PayrollANegativeLineRevision[]) {
  const current = new Map<string, PayrollANegativeLineRevision>()
  for (const r of rows) {
    if (!current.has(r.lineId) || current.get(r.lineId)!.revision < r.revision)
      current.set(r.lineId, r)
  }
  return [...current.values()].filter(r => !r.removed)
}
