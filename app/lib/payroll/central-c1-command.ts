import type { TransactionDb } from '../db/coordinator'
import type { PayrollC1FormRead, PayrollC1FrozenDocument, PayrollC1ReleaseDraft, PayrollC1StatementSourceSnapshot, PayrollC1StatementSourceVersioned } from './central-c1-contract'
import { generateId } from '../util/id'
import { isPayrollC1FrozenDocument } from './central-c1-codec'
import { payrollCanonical, payrollWriteRow } from './central-command-shared'
import { payrollProblem } from './central-contract'
import { adoptPayrollHollowOnRelease, payrollHollowAllowsZeroRelease } from './central-hollow-deduction-release'
import { amountInCents, normalizeAllocations } from './statements'

export function payrollC1Source(read: PayrollC1FormRead): PayrollC1StatementSourceVersioned {
  const source: PayrollC1StatementSourceSnapshot = { schemaVersion: 1, subject: { projectId: read.draft.projectId!, crewId: read.draft.crewId ?? null, leaderWorkerId: read.draft.leaderWorkerId!, memberWorkerIds: read.draft.memberWorkerIds! }, month: read.draft.month!, facts: read.facts, rates: read.rates }
  return read.hollow?.snapshot ? { ...source, schemaVersion: 2, hollow: structuredClone(read.hollow.snapshot) } : source
}
async function replaceChildren(db: TransactionDb, table: string, id: string, rows: Record<string, unknown>[], actor: string) {
  for (const old of await db.select<{ id: string }>(`SELECT id FROM ${table} WHERE statement_id=? AND deleted_at IS NULL`, [id]))
    await payrollWriteRow(db, table, old.id, { deleted_at: new Date().toISOString() }, actor)
  for (const row of rows)
    await payrollWriteRow(db, table, generateId(table), { statement_id: id, ...row }, actor)
}
async function persistSource(db: TransactionDb, id: string, read: PayrollC1FormRead) {
  const source = payrollC1Source(read)
  await db.execute('INSERT INTO payroll_c1_statement_sources(statement_id,project_id,leader_worker_id,source_json) VALUES(?,?,?,?) ON CONFLICT(statement_id) DO UPDATE SET project_id=excluded.project_id,leader_worker_id=excluded.leader_worker_id,source_json=excluded.source_json', [id, source.subject.projectId, source.subject.leaderWorkerId, payrollCanonical(source)])
}
export async function persistPayrollC1(db: TransactionDb, id: string, read: PayrollC1FormRead, version: string, status: 'draft' | 'checked', actor: string) {
  const now = new Date().toISOString()
  await payrollWriteRow(db, 'wage_statements', id, { project_id: read.draft.projectId, crew_id: read.draft.crewId ?? null, leader_worker_id: read.draft.leaderWorkerId, month: read.draft.month, format_family: 'C1', period_kind: 'monthly', purpose: 'advance', quantity_source: 'field', status, needs_recheck: 0, pay_ratio: 1, cumulative_amount: read.totals.grossAmount.value, previously_paid: 0, gross_amount: read.totals.grossAmount.value, source_version: version, source_updated_at: now, checked_source_version: status === 'checked' ? version : '', checked_at: status === 'checked' ? now : null, operator_name: actor, note: read.draft.note ?? '', updated_at: now }, actor)
  await replaceChildren(db, 'wage_statement_members', id, read.members.map(m => ({ worker_id: m.id, is_leader: Number(m.id === read.draft.leaderWorkerId) })), actor)
  await replaceChildren(db, 'wage_statement_lines', id, read.lines.map((l, index) => ({ worker_id: l.workerId, item_id: null, item_name: l.itemName, unit: l.unit, quantity: l.quantity, unit_price: l.unitPrice, amount: l.amount, sort_order: index })), actor)
  await persistSource(db, id, read)
}
export async function releasePayrollC1(db: TransactionDb, read: PayrollC1FormRead, release: PayrollC1ReleaseDraft, version: string, actor: string, commandId?: string) {
  if (!read.statementId || !read.eligibility.canRelease || release.actualAmount === null || !Number.isFinite(release.actualAmount) || release.actualAmount < 0 || (release.actualAmount === 0 && !payrollHollowAllowsZeroRelease(read.hollow?.snapshot)) || Math.abs(release.actualAmount * 100 - amountInCents(release.actualAmount)) > 1e-8 || read.totals.grossAmount.value === null || release.actualAmount > read.totals.grossAmount.value)
    throw payrollProblem('validation-failed', 'C1 需重新核对完整，实际金额须到分且不超过当月应发；零额仅适用于明确启动并完整抵扣的空鼓处理')
  if (release.allocations.some(a => a.amount === null))
    throw payrollProblem('validation-failed', '全部成员须明确填写实际分配，零分配也请填写 0')
  const members = read.members.map(m => ({ workerId: m.id, workerName: m.name ?? '', isLeader: m.id === read.draft.leaderWorkerId }))
  let allocations
  try {
    allocations = normalizeAllocations({ members }, release.actualAmount, release.allocations.map(a => ({ workerId: a.workerId, amount: a.amount! })))
  }
  catch (cause) { throw payrollProblem('validation-failed', cause instanceof Error ? cause.message : 'C1 分配无效') }
  if (read.hollow && !commandId)
    throw payrollProblem('validation-failed', '空鼓采用须绑定本次完整发放命令')
  const hollow = await adoptPayrollHollowOnRelease(db, read.hollow, release.actualAmount, actor, commandId ?? '')
  const now = new Date().toISOString()
  const document: PayrollC1FrozenDocument = { id: read.statementId, projectId: read.draft.projectId!, projectName: read.options.projects.find(p => p.id === read.draft.projectId)?.name ?? '', crewId: read.draft.crewId ?? null, crewName: read.options.crews.find(c => c.id === read.draft.crewId)?.name ?? null, leaderName: members.find(m => m.isLeader)?.workerName ?? '', month: read.draft.month!, formatFamily: 'C1', periodKind: 'monthly', payRatio: 1, grossAmount: read.totals.grossAmount.value, actualAmount: release.actualAmount, releasedAt: now, operatorName: actor, note: read.draft.note ?? '', lines: read.lines, rates: read.rates, attendance: read.facts, members, allocations }
  if (hollow)
    document.hollow = hollow
  if (!isPayrollC1FrozenDocument(document))
    throw payrollProblem('validation-failed', 'C1 冻结所需原考勤、个人标准、姓名或完整分配不可确认')
  const snapshot = { ...document, quantitySource: 'field', cumulativeAmount: document.grossAmount, previouslyPaid: 0, sourceVersion: version, sourceUpdatedAt: now, submittedAt: now, memberWorkerIds: members.map(m => m.workerId), allocationRecorded: true, actualAmountFen: amountInCents(release.actualAmount), allocationTotalFen: allocations.reduce((sum, a) => sum + a.allocatedAmountFen, 0), c1Source: payrollC1Source(read), c1Document: document }
  await replaceChildren(db, 'wage_statement_allocations', read.statementId, allocations.map(a => ({ worker_id: a.workerId, allocated_amount_fen: a.allocatedAmountFen })), actor)
  await payrollWriteRow(db, 'wage_statements', read.statementId, { status: 'released', needs_recheck: 0, actual_amount: release.actualAmount, cumulative_amount: document.grossAmount, previously_paid: 0, gross_amount: document.grossAmount, snapshot_json: payrollCanonical(snapshot), released_at: now, submitted_at: now, updated_at: now, source_version: version, operator_name: actor }, actor)
  await persistSource(db, read.statementId, read)
}
