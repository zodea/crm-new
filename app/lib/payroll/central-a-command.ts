import type { TransactionDb } from '../db/coordinator'
import type { PayrollAFormRead, PayrollAFrozenDocument, PayrollAReleaseDraft } from './central-a-contract'
import type { PayrollAManagementOwnership, PayrollAStatementSourceVersioned } from './central-a-fees-contract'
import { logOperation } from '../db/soft-delete'
import { generateId } from '../util/id'
import { payrollACanonical } from './central-a-calculation'
import { isPayrollAFrozenDocument } from './central-a-codec'
import { hasPayrollAFeesForm } from './central-a-fees-contract'
import { payrollWriteRow as payrollAWriteRow } from './central-command-shared'
import { payrollProblem } from './central-contract'
import { adoptPayrollHollowOnRelease, payrollHollowAllowsZeroRelease } from './central-hollow-deduction-release'
import { amountInCents, normalizeAllocations } from './statements'

export { payrollWriteRow as payrollAWriteRow } from './central-command-shared'

type Row = Record<string, unknown>

/** 成功发放的事实所有权保留，软删头/重建完成行不能绕过；同负责人累计不重复领用。 */
export async function payrollACrossBookConflicts(db: TransactionDb, read: PayrollAFormRead): Promise<string[]> {
  const owned = new Set(read.facts.map(fact => fact.ownershipKey))
  if (read.draft.book?.bookPurpose === 'management') {
    const claims = await db.select<{ ownership_key: string, first_statement_id: string }>('SELECT ownership_key,first_statement_id FROM payroll_a_management_ownership WHERE project_id=? AND management_book_id<>?', [read.draft.projectId, read.draft.book.managementBookId])
    return claims.filter(c => owned.has(c.ownership_key)).map(c => c.first_statement_id)
  }
  const rows = await db.select<{ statement_id: string, leader_worker_id: string, source_json: string }>('SELECT s.statement_id,s.leader_worker_id,s.source_json FROM payroll_a_statement_sources s JOIN wage_statements w ON w.id=s.statement_id WHERE s.project_id=? AND w.status=\'released\'', [read.draft.projectId])
  const conflicts: string[] = []
  for (const row of rows) {
    if (row.leader_worker_id === read.draft.leaderWorkerId)
      continue
    const snapshot = JSON.parse(row.source_json) as PayrollAStatementSourceVersioned
    if (snapshot.schemaVersion !== 1 && snapshot.book.bookPurpose === 'management')
      continue
    if (snapshot.facts.some(fact => owned.has(fact.ownershipKey)))
      conflicts.push(row.statement_id)
  }
  return conflicts
}

export async function persistPayrollASource(db: TransactionDb, statementId: string, read: PayrollAFormRead): Promise<void> {
  const subject = { projectId: read.draft.projectId!, crewId: read.draft.crewId ?? null, leaderWorkerId: read.draft.leaderWorkerId!, memberWorkerIds: read.draft.memberWorkerIds! }
  const usedPrices = new Set(read.lines.flatMap(line => line.priceRevisionIds))
  if (read.draft.ratioPlan && (!hasPayrollAFeesForm(read) || !read.fees || !read.book))
    throw payrollProblem('validation-failed', '分项比例缺少完整的工资簿及费用来源')
  const snapshot: PayrollAStatementSourceVersioned = hasPayrollAFeesForm(read) && read.fees && read.book ? { ...(read.draft.ratioPlan ? { schemaVersion: 4 as const, ratioPlan: read.draft.ratioPlan, ...(read.hollow?.snapshot ? { hollow: read.hollow.snapshot } : {}) } : read.hollow?.snapshot ? { schemaVersion: 3 as const, hollow: read.hollow.snapshot } : { schemaVersion: 2 as const }), book: read.book, fees: read.fees, subject, facts: read.facts, priceRevisions: read.prices.filter(price => usedPrices.has(price.id)) } : { schemaVersion: 1, subject, facts: read.facts, priceRevisions: read.prices.filter(price => usedPrices.has(price.id)) }
  if (read.adjustmentReconciliation)
    snapshot.adjustmentReconciliation = read.adjustmentReconciliation
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

  if (hasPayrollAFeesForm(read) && read.book) {
    const relation = { statement_id: id, project_id: draft.projectId, leader_worker_id: draft.leaderWorkerId, book_purpose: read.book.bookPurpose, management_book_id: read.book.managementBookId, month: draft.month, period_kind: draft.periodKind }
    const [before] = await db.select<Row>('SELECT * FROM payroll_a_statement_books WHERE statement_id=?', [id])
    if (before && payrollACanonical(before) !== payrollACanonical(relation))
      throw payrollProblem('relationship-mismatch', '已存工资的请款簿或期间不能改变')
    if (!before) {
      await db.execute('INSERT INTO payroll_a_statement_books(statement_id,project_id,leader_worker_id,book_purpose,management_book_id,month,period_kind) VALUES(?,?,?,?,?,?,?)', Object.values(relation))
      await logOperation(db, { table: 'payroll_a_statement_books', recordId: id, action: 'create', before: null, after: relation, operator: actor })
    }
  }
  await payrollAWriteRow(db, 'wage_statements', id, { project_id: draft.projectId, crew_id: draft.crewId ?? null, leader_worker_id: draft.leaderWorkerId, month: draft.month, format_family: 'A', period_kind: draft.periodKind, purpose: draft.periodKind === 'monthly' ? 'advance' : 'final', quantity_source: 'field', status, needs_recheck: 0, pay_ratio: draft.payRatio, cumulative_amount: read.totals.cumulativeAmount.value, previously_paid: read.totals.previouslyPaid.value, gross_amount: read.totals.grossAmount.value, source_version: calculationVersion, source_updated_at: now, checked_source_version: status === 'checked' ? calculationVersion : '', checked_at: status === 'checked' ? now : null, operator_name: actor, note: draft.note ?? '', updated_at: now }, actor)
  await replaceChildren(db, 'wage_statement_members', id, read.members.map(member => ({ worker_id: member.id, is_leader: Number(member.id === draft.leaderWorkerId) })), actor)
  await replaceChildren(db, 'wage_statement_lines', id, read.lines.map((line, index) => ({ worker_id: line.workerId, item_id: line.itemId, item_name: line.itemName ?? '', unit: line.unit, quantity: line.quantity, unit_price: line.unitPrice, amount: line.amount, sort_order: index })), actor)
  await persistPayrollASource(db, id, read)
}

export function payrollACalculationVersion(read: PayrollAFormRead, identityVersion: unknown): string {
  return payrollACanonical({ draft: { ...read.draft, note: undefined }, facts: read.facts, prices: read.prices, paymentSourceVersion: read.paymentSourceVersion, identityVersion, ...(hasPayrollAFeesForm(read) ? { fees: read.fees } : {}), ...(read.hollow ? { hollow: read.hollow.snapshot } : {}) })
}

export async function releasePayrollA(db: TransactionDb, read: PayrollAFormRead, release: PayrollAReleaseDraft, calculationVersion: string, actor: string, commandId?: string) {
  if (!read.statementId || !read.eligibility.canRelease)
    throw payrollProblem('validation-failed', '工资尚未核对完整或需要重新核对')
  if (release.actualAmount === null || !Number.isFinite(release.actualAmount) || release.actualAmount < 0 || (release.actualAmount === 0 && !payrollHollowAllowsZeroRelease(read.hollow?.snapshot)) || Math.abs(release.actualAmount * 100 - Math.round(release.actualAmount * 100)) > 1e-8)
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
  if (hasPayrollAFeesForm(read) && read.fees?.management && read.book?.bookPurpose === 'management') {
    if (!commandId)
      throw payrollProblem('validation-failed', '管理归属缺少原发放命令身份')
    const managedFacts = [...new Map(read.fees.lines.filter(l => l.kind === 'management').flatMap(l => l.components.map(c => [c.ownershipKey, c.fact] as const))).values()]
    for (const fact of managedFacts) {
      if (read.fees.managementOwnership.some(o => o.ownershipKey === fact.ownershipKey))
        continue
      const ownership: PayrollAManagementOwnership = { id: generateId('management-ownership'), projectId: read.draft.projectId!, ownershipKey: fact.ownershipKey, managementBookId: read.book.managementBookId, firstStatementId: read.statementId, proof: { schemaVersion: 1, identity: { purpose: 'management-fee', projectId: read.draft.projectId!, ownershipKey: fact.ownershipKey }, managementBookId: read.book.managementBookId, managementRevisionId: read.fees.management.revision.id, firstStatementId: read.statementId, firstCommandId: commandId, fact } }
      await payrollAWriteRow(db, 'payroll_a_management_ownership', ownership.id, { project_id: ownership.projectId, ownership_key: ownership.ownershipKey, management_book_id: ownership.managementBookId, first_statement_id: ownership.firstStatementId, proof_json: payrollACanonical(ownership.proof) }, actor)
      read.fees.managementOwnership.push(ownership)
    }
  }
  const payments = hasPayrollAFeesForm(read) ? read.previousBookPayments.map(p => ({ id: p.statementId, month: p.month, actual_amount: p.amount.value! })) : await db.select<{ id: string, month: string, actual_amount: number }>('SELECT id,month,actual_amount FROM wage_statements WHERE project_id=? AND leader_worker_id=? AND format_family=\'A\' AND status=\'released\' AND id<>? ORDER BY month,id', [read.draft.projectId, read.draft.leaderWorkerId, read.statementId])
  const subject = { projectId: read.draft.projectId!, crewId: read.draft.crewId ?? null, leaderWorkerId: read.draft.leaderWorkerId!, memberWorkerIds: read.draft.memberWorkerIds! }
  const source: PayrollAStatementSourceVersioned = hasPayrollAFeesForm(read) && read.fees && read.book ? { ...(read.draft.ratioPlan ? { schemaVersion: 4 as const, ratioPlan: read.draft.ratioPlan, ...(read.hollow?.snapshot ? { hollow: read.hollow.snapshot } : {}) } : read.hollow?.snapshot ? { schemaVersion: 3 as const, hollow: read.hollow.snapshot } : { schemaVersion: 2 as const }), book: read.book, fees: read.fees, subject, facts: read.facts, priceRevisions: read.prices.filter(price => read.lines.some(line => line.priceRevisionIds.includes(price.id))) } : { schemaVersion: 1, subject, facts: read.facts, priceRevisions: read.prices.filter(price => read.lines.some(line => line.priceRevisionIds.includes(price.id))) }
  if (read.adjustmentReconciliation)
    source.adjustmentReconciliation = read.adjustmentReconciliation
  const document: PayrollAFrozenDocument = { id: read.statementId, projectId: read.draft.projectId!, projectName: project?.name ?? '', crewName: crew?.name ?? null, leaderName: members.find(member => member.isLeader)?.workerName ?? '', month: read.draft.month!, periodKind: read.draft.periodKind!, formatFamily: 'A', payRatio: read.draft.payRatio!, workAmount: read.totals.workAmount.value!, cumulativeAmount: read.totals.cumulativeAmount.value!, previouslyPaid: read.totals.previouslyPaid.value!, grossAmount: read.totals.grossAmount.value!, actualAmount: release.actualAmount, releasedAt: now, operatorName: actor, note: read.draft.note ?? '', lines: read.lines.map(line => ({ ...line, workerName: members.find(member => member.workerId === line.workerId)?.workerName ?? null })), members, allocations, previousPayments: payments.map(payment => ({ statementId: payment.id, month: payment.month, amount: payment.actual_amount })) }
  if (read.draft.ratioPlan)
    document.ratioPlan = read.draft.ratioPlan
  if (read.adjustmentReconciliation)
    document.adjustmentReconciliation = read.adjustmentReconciliation
  if (read.hollow) {
    if (!commandId)
      throw payrollProblem('validation-failed', '空鼓采用缺少原发放命令身份')
    document.hollow = await adoptPayrollHollowOnRelease(db, read.hollow, release.actualAmount, actor, commandId)
  }
  if (hasPayrollAFeesForm(read) && read.fees && read.book)
    Object.assign(document, { book: read.book, fees: read.fees, listAmount: read.fees.totals.listAmount.value, previousBookPayments: payments.map(p => ({ statementId: p.id, month: p.month, amount: p.actual_amount, book: read.book })) })
  if (!isPayrollAFrozenDocument(document))
    throw payrollProblem('validation-failed', '发放所需姓名、明细、金额或完整分配尚未提供')
  const snapshot = { ...document, quantitySource: 'field', sourceVersion: calculationVersion, sourceUpdatedAt: now, adjustmentReason: '', submittedAt: now, memberWorkerIds: members.map(member => member.workerId), allocationRecorded: true, actualAmountFen: amountInCents(release.actualAmount), allocationTotalFen: allocations.reduce((sum, row) => sum + row.allocatedAmountFen, 0), aSource: source, aDocument: document }
  await replaceChildren(db, 'wage_statement_allocations', read.statementId, allocations.map(allocation => ({ worker_id: allocation.workerId, allocated_amount_fen: allocation.allocatedAmountFen })), actor)
  await persistPayrollASource(db, read.statementId, read)
  await payrollAWriteRow(db, 'wage_statements', read.statementId, { status: 'released', actual_amount: release.actualAmount, cumulative_amount: read.totals.cumulativeAmount.value, previously_paid: read.totals.previouslyPaid.value, gross_amount: read.totals.grossAmount.value, snapshot_json: JSON.stringify(snapshot), released_at: now, submitted_at: now, updated_at: now, source_version: calculationVersion, operator_name: actor }, actor)
}
