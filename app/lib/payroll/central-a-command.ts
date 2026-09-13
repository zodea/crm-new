import type { TransactionDb } from '../db/coordinator'
import type { PayrollAFormRead, PayrollAFrozenDocument, PayrollAReleaseDraft, PayrollAStatementSourceSnapshot } from './central-a-contract'
import { logOperation } from '../db/soft-delete'
import { generateId } from '../util/id'
import { payrollACanonical } from './central-a-calculation'
import { isPayrollAFrozenDocument } from './central-a-codec'
import { payrollProblem } from './central-contract'
import { amountInCents, normalizeAllocations } from './statements'

type Row = Record<string, unknown>
export async function payrollAWriteRow(db: TransactionDb, table: string, id: string, after: Row, actor: string): Promise<string> {
  const [before] = await db.select<Row>(`SELECT * FROM ${table} WHERE id=?`, [id])
  const fields = Object.keys(after)
  if (before)
    await db.execute(`UPDATE ${table} SET ${fields.map(field => `${field}=?`).join(',')} WHERE id=?`, [...Object.values(after), id])
  else
    await db.execute(`INSERT INTO ${table}(id,${fields.join(',')}) VALUES (?,${fields.map(() => '?').join(',')})`, [id, ...Object.values(after)])
  return logOperation(db, { table, recordId: id, action: before ? 'update' : 'create', before, after: { ...(before ?? {}), id, ...after }, operator: actor })
}

/** 成功发放的事实所有权保留，软删头/重建完成行不能绕过；同负责人累计不重复领用。 */
export async function payrollACrossBookConflicts(db: TransactionDb, read: PayrollAFormRead): Promise<string[]> {
  const owned = new Set(read.facts.map(fact => fact.ownershipKey))
  const rows = await db.select<{ statement_id: string, leader_worker_id: string, source_json: string }>('SELECT s.statement_id,s.leader_worker_id,s.source_json FROM payroll_a_statement_sources s JOIN wage_statements w ON w.id=s.statement_id WHERE s.project_id=? AND w.status=\'released\'', [read.draft.projectId])
  const conflicts: string[] = []
  for (const row of rows) {
    if (row.leader_worker_id === read.draft.leaderWorkerId)
      continue
    const snapshot = JSON.parse(row.source_json) as PayrollAStatementSourceSnapshot
    if (snapshot.facts.some(fact => owned.has(fact.ownershipKey)))
      conflicts.push(row.statement_id)
  }
  return conflicts
}

export async function persistPayrollASource(db: TransactionDb, statementId: string, read: PayrollAFormRead): Promise<void> {
  const subject = { projectId: read.draft.projectId!, crewId: read.draft.crewId ?? null, leaderWorkerId: read.draft.leaderWorkerId!, memberWorkerIds: read.draft.memberWorkerIds! }
  const usedPrices = new Set(read.lines.flatMap(line => line.priceRevisionIds))
  const snapshot: PayrollAStatementSourceSnapshot = { schemaVersion: 1, subject, facts: read.facts, priceRevisions: read.prices.filter(price => usedPrices.has(price.id)) }
  await db.execute('INSERT INTO payroll_a_statement_sources(statement_id,project_id,leader_worker_id,source_json) VALUES(?,?,?,?) ON CONFLICT(statement_id) DO UPDATE SET project_id=excluded.project_id,leader_worker_id=excluded.leader_worker_id,source_json=excluded.source_json', [statementId, subject.projectId, subject.leaderWorkerId, JSON.stringify(snapshot)])
}

async function replaceChildren(db: TransactionDb, table: string, statementId: string, rows: Row[], actor: string) {
  for (const before of await db.select<Row>(`SELECT * FROM ${table} WHERE statement_id=? AND deleted_at IS NULL`, [statementId]))
    await payrollAWriteRow(db, table, String(before.id), { deleted_at: new Date().toISOString() }, actor)
  for (const row of rows)
    await payrollAWriteRow(db, table, generateId(table), { statement_id: statementId, ...row }, actor)
}

export async function persistPayrollACalculation(db: TransactionDb, id: string, read: PayrollAFormRead, calculationVersion: string, status: 'draft' | 'checked', actor: string) {
  const draft = read.draft
  const now = new Date().toISOString()
  await payrollAWriteRow(db, 'wage_statements', id, { project_id: draft.projectId, crew_id: draft.crewId ?? null, leader_worker_id: draft.leaderWorkerId, month: draft.month, format_family: 'A', period_kind: draft.periodKind, purpose: draft.periodKind === 'monthly' ? 'advance' : 'final', quantity_source: 'field', status, needs_recheck: 0, pay_ratio: draft.payRatio, cumulative_amount: read.totals.cumulativeAmount.value, previously_paid: read.totals.previouslyPaid.value, gross_amount: read.totals.grossAmount.value, source_version: calculationVersion, source_updated_at: now, checked_source_version: status === 'checked' ? calculationVersion : '', checked_at: status === 'checked' ? now : null, operator_name: actor, note: draft.note ?? '', updated_at: now }, actor)
  await replaceChildren(db, 'wage_statement_members', id, read.members.map(member => ({ worker_id: member.id, is_leader: Number(member.id === draft.leaderWorkerId) })), actor)
  await replaceChildren(db, 'wage_statement_lines', id, read.lines.map((line, index) => ({ worker_id: line.workerId, item_id: line.itemId, item_name: line.itemName ?? '', unit: line.unit, quantity: line.quantity, unit_price: line.unitPrice, amount: line.amount, sort_order: index })), actor)
  await persistPayrollASource(db, id, read)
}

export function payrollACalculationVersion(read: PayrollAFormRead, identityVersion: unknown): string {
  return payrollACanonical({ draft: { ...read.draft, note: undefined }, facts: read.facts, prices: read.prices, paymentSourceVersion: read.paymentSourceVersion, identityVersion })
}

export async function releasePayrollA(db: TransactionDb, read: PayrollAFormRead, release: PayrollAReleaseDraft, calculationVersion: string, actor: string) {
  if (!read.statementId || !read.eligibility.canRelease)
    throw payrollProblem('validation-failed', '工资尚未核对完整或需要重新核对')
  if (release.actualAmount === null || !Number.isFinite(release.actualAmount) || release.actualAmount <= 0 || Math.abs(release.actualAmount * 100 - Math.round(release.actualAmount * 100)) > 1e-8)
    throw payrollProblem('validation-failed', '实际发放须为正数并精确到分', { actualAmount: ['请明确填写实际发放金额'] })
  if (read.totals.grossAmount.value === null || release.actualAmount > read.totals.grossAmount.value)
    throw payrollProblem('validation-failed', '实际发放不能超过事务内重新核算的本次应发', { actualAmount: ['实际发放超过当前应付余额'] })
  if (!release.allocations.length || release.allocations.some(row => row.amount === null))
    throw payrollProblem('validation-failed', '每位成员的分配金额都必须明确，零分配也请填写 0')
  const members = read.members.map(member => ({ workerId: member.id, workerName: member.name ?? '', isLeader: member.id === read.draft.leaderWorkerId }))
  let allocations
  try {
    allocations = normalizeAllocations({ members }, release.actualAmount, release.allocations.map(row => ({ workerId: row.workerId, amount: row.amount! })))
  }
  catch (cause) {
    throw payrollProblem('validation-failed', cause instanceof Error ? cause.message : '工资分配无效')
  }
  const conflicts = await payrollACrossBookConflicts(db, read)
  if (conflicts.length)
    throw payrollProblem('conflict', '这些完成责任已有其他请款簿发放，不能再次计薪')
  const project = read.options.projects.find(project => project.id === read.draft.projectId)
  const crew = read.options.crews.find(crew => crew.id === read.draft.crewId)
  const now = new Date().toISOString()
  const payments = await db.select<{ id: string, month: string, actual_amount: number }>('SELECT id,month,actual_amount FROM wage_statements WHERE project_id=? AND leader_worker_id=? AND format_family=\'A\' AND status=\'released\' AND id<>? ORDER BY month,id', [read.draft.projectId, read.draft.leaderWorkerId, read.statementId])
  const source: PayrollAStatementSourceSnapshot = { schemaVersion: 1, subject: { projectId: read.draft.projectId!, crewId: read.draft.crewId ?? null, leaderWorkerId: read.draft.leaderWorkerId!, memberWorkerIds: read.draft.memberWorkerIds! }, facts: read.facts, priceRevisions: read.prices.filter(price => read.lines.some(line => line.priceRevisionIds.includes(price.id))) }
  const document: PayrollAFrozenDocument = { id: read.statementId, projectId: read.draft.projectId!, projectName: project?.name ?? '', crewName: crew?.name ?? null, leaderName: members.find(member => member.isLeader)?.workerName ?? '', month: read.draft.month!, periodKind: read.draft.periodKind!, formatFamily: 'A', payRatio: read.draft.payRatio!, workAmount: read.totals.workAmount.value!, cumulativeAmount: read.totals.cumulativeAmount.value!, previouslyPaid: read.totals.previouslyPaid.value!, grossAmount: read.totals.grossAmount.value!, actualAmount: release.actualAmount, releasedAt: now, operatorName: actor, note: read.draft.note ?? '', lines: read.lines.map(line => ({ ...line, workerName: members.find(member => member.workerId === line.workerId)?.workerName ?? null })), members, allocations, previousPayments: payments.map(payment => ({ statementId: payment.id, month: payment.month, amount: payment.actual_amount })) }
  if (!isPayrollAFrozenDocument(document))
    throw payrollProblem('validation-failed', '发放所需姓名、明细、金额或完整分配尚未提供')
  const snapshot = { ...document, quantitySource: 'field', sourceVersion: calculationVersion, sourceUpdatedAt: now, adjustmentReason: '', submittedAt: now, memberWorkerIds: members.map(member => member.workerId), allocationRecorded: true, actualAmountFen: amountInCents(release.actualAmount), allocationTotalFen: allocations.reduce((sum, row) => sum + row.allocatedAmountFen, 0), aSource: source, aDocument: document }
  await replaceChildren(db, 'wage_statement_allocations', read.statementId, allocations.map(allocation => ({ worker_id: allocation.workerId, allocated_amount_fen: allocation.allocatedAmountFen })), actor)
  await payrollAWriteRow(db, 'wage_statements', read.statementId, { status: 'released', actual_amount: release.actualAmount, cumulative_amount: read.totals.cumulativeAmount.value, previously_paid: read.totals.previouslyPaid.value, gross_amount: read.totals.grossAmount.value, snapshot_json: JSON.stringify(snapshot), released_at: now, submitted_at: now, updated_at: now, source_version: calculationVersion, operator_name: actor }, actor)
  await persistPayrollASource(db, read.statementId, read)
}
