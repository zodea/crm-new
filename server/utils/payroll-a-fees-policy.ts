import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollABookRef, PayrollAFeeConfigRead, PayrollAFeeConfigScope, PayrollAFeeDraft, PayrollAFeeRevision, PayrollAManagementScope } from '../../app/lib/payroll/central-a-fees-contract'
import type { PayrollHistoryEntry, PayrollJson } from '../../app/lib/payroll/central-contract'
import { payrollACanonical } from '../../app/lib/payroll/central-a-calculation'
import { payrollProblem } from '../../app/lib/payroll/central-contract'

export async function latestPayrollABookRelease(db: TransactionDb, projectId: string, leaderWorkerId: string | null, book: PayrollABookRef): Promise<string | null> {
  const [row] = await db.select<{ month: string | null }>('SELECT MAX(w.month) AS month FROM wage_statements w LEFT JOIN payroll_a_statement_books b ON b.statement_id=w.id WHERE w.project_id=? AND w.leader_worker_id=? AND w.format_family=\'A\' AND w.status=\'released\' AND COALESCE(b.book_purpose,\'ordinary\')=? AND b.management_book_id IS ?', [projectId, leaderWorkerId, book.bookPurpose, book.managementBookId])
  return row?.month ?? null
}

export async function assertPayrollAFeeMonth(db: TransactionDb, scope: PayrollAFeeConfigScope, effectiveMonth: string) {
  if (effectiveMonth < scope.month)
    throw payrollProblem('validation-failed', '费用修订从所选月份起生效，不能倒改此前月份')
  const released = await latestPayrollABookRelease(db, scope.projectId, scope.leaderWorkerId, scope.book)
  if (released && effectiveMonth <= released)
    throw payrollProblem('conflict', '该簿已有已发工资，费用修订须选择后续未发月份')
}

export function assertPayrollAFeeAdoption(item: PayrollAFeeDraft, read: PayrollAFeeConfigRead, old: PayrollAFeeRevision | null | undefined) {
  const adopted = item.adoptedDefault
  if (!adopted || (old && payrollACanonical(old.adoptedDefault) === payrollACanonical(adopted)))
    return
  if (adopted.kind === 'confirmed-housing-items') {
    if (item.kind !== 'housing' || item.unit !== '㎡' || item.unitPrice !== 1.3 || !adopted.evidenceNote.trim() || payrollACanonical([...adopted.itemIds].sort()) !== payrollACanonical([...item.basis.itemIds].sort()))
      throw payrollProblem('relationship-mismatch', '房补默认须明确确认当前适用分项、单位和采用金额')
    return
  }
  if (!read.crewDefaults || payrollACanonical(adopted.fact) !== payrollACanonical(read.crewDefaults) || adopted.fact.crewId !== read.scope.crewId || (adopted.kind === 'crew-management' ? item.kind !== 'management' : item.kind !== 'housing'))
    throw payrollProblem('stale-source', '班组默认来源已变化或无法证明，请重新核实采用依据')
  const enabled = adopted.kind === 'crew-management' ? adopted.fact.managementEnabled : adopted.fact.rentEnabled
  const price = adopted.kind === 'crew-management' ? adopted.fact.managementUnitPrice : adopted.fact.rentUnitPrice
  if (enabled.state !== 'value' || price.state !== 'value' || item.enabled !== enabled.value || item.unitPrice !== price.value)
    throw payrollProblem('relationship-mismatch', '班组默认开关或金额与本次采用内容不一致')
}

export function payrollAManagementScopeCurrent(scope: PayrollAManagementScope, options: PayrollAFeeConfigRead['responsibilityOptions']): boolean {
  return scope.assignments.length > 0 && new Set(scope.assignments.map(a => a.assignmentId)).size === scope.assignments.length && scope.assignments.every((selected) => {
    const origin = options.find(o => o.assignmentId === selected.assignmentId && o.eligible)
    return !!origin && (origin.scopeIds.length === 0 ? selected.scopeIds.length === 0 : selected.scopeIds.length > 0) && selected.cells.length > 0 && new Set(selected.cells.map(payrollACanonical)).size === selected.cells.length && new Set(selected.scopeIds).size === selected.scopeIds.length && selected.scopeIds.every(id => origin.scopeIds.includes(id)) && selected.cells.every(c => origin.cells.some(o => payrollACanonical(o) === payrollACanonical(c)))
  })
}

export async function payrollAFeesHistory(db: TransactionDb, ids: ReadonlySet<string>): Promise<PayrollHistoryEntry[]> {
  const rows = await db.select<{ id: string, table_name: string, record_id: string, action: string, created_at: string | null, operator: string | null, before_data: string | null, after_data: string | null }>('SELECT * FROM operation_logs WHERE table_name IN (\'payroll_a_fee_revisions\',\'payroll_a_management_books\',\'payroll_a_management_book_revisions\') ORDER BY created_at,id')
  const parsed = (raw: string | null): PayrollJson | null => {
    try {
      return raw === null ? null : JSON.parse(raw) as PayrollJson
    }
    catch { return null }
  }
  return rows.filter(r => ids.has(r.record_id)).map(r => ({ id: r.id, tableName: r.table_name, recordId: r.record_id, operation: r.action, operatedAt: r.created_at, operator: r.operator, beforeData: parsed(r.before_data), afterData: parsed(r.after_data), beforeRaw: r.before_data, afterRaw: r.after_data }))
}
