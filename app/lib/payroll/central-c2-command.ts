import type { TransactionDb } from '../db/coordinator'
import type { PayrollC2FormRead, PayrollC2FrozenDocument, PayrollC2ReleaseDraft, PayrollC2StatementSourceSnapshot } from './central-c2-contract'
import type { PayrollDayworkFact, PayrollDayworkRecordRead } from './central-daywork-contract'
import { generateId } from '../util/id'
import { isPayrollC2FrozenDocument, isPayrollC2StatementSourceSnapshot } from './central-c2-codec'
import { payrollCanonical, payrollWriteRow } from './central-command-shared'
import { payrollProblem } from './central-contract'
import { amountInCents, normalizeAllocations } from './statements'

function sourceFact(row: PayrollDayworkRecordRead): PayrollDayworkFact {
  return { id: row.id, projectId: row.projectId, crewId: row.crewId, workerId: row.workerId, workDate: row.workDate, workContent: row.workContent, startTime: row.startTime, endTime: row.endTime, laborUnits: row.laborUnits, witness: row.witness, confirmedOn: row.confirmedOn, status: row.status, note: row.note, createdAt: row.createdAt, updatedAt: row.updatedAt, deletedAt: row.deletedAt, sourceFingerprint: row.sourceFingerprint, original: row.original }
}
export function payrollC2Source(read: PayrollC2FormRead): PayrollC2StatementSourceSnapshot {
  if (!read.config)
    throw payrollProblem('validation-failed', 'C2 缺少实际采用的主体配置')
  return { schemaVersion: 1, subject: { projectId: read.draft.projectId!, crewId: read.draft.crewId ?? null, leaderWorkerId: read.draft.leaderWorkerId!, memberWorkerIds: read.draft.memberWorkerIds! }, month: read.draft.month!, facts: read.facts.filter(f => read.adoptedRecordIds.includes(f.id)).map(sourceFact).sort((a, b) => a.id.localeCompare(b.id)), config: read.config, members: read.members.map(m => ({ workerId: m.id, workerName: m.name ?? '', crewId: m.crewId })), qualificationVersion: read.qualificationVersion }
}
async function replaceChildren(db: TransactionDb, table: string, id: string, rows: Record<string, unknown>[], actor: string) {
  for (const old of await db.select<{ id: string }>(`SELECT id FROM ${table} WHERE statement_id=? AND deleted_at IS NULL`, [id]))
    await payrollWriteRow(db, table, old.id, { deleted_at: new Date().toISOString() }, actor)
  for (const row of rows)
    await payrollWriteRow(db, table, generateId(table), { statement_id: id, ...row }, actor)
}
async function persistSource(db: TransactionDb, id: string, read: PayrollC2FormRead) {
  const source = payrollC2Source(read)
  if (!isPayrollC2StatementSourceSnapshot(source))
    throw payrollProblem('validation-failed', 'C2 原签工、配置、主体或确认事实不完整')
  await db.execute('INSERT INTO payroll_c2_statement_sources(statement_id,project_id,leader_worker_id,source_json) VALUES(?,?,?,?) ON CONFLICT(statement_id) DO UPDATE SET project_id=excluded.project_id,leader_worker_id=excluded.leader_worker_id,source_json=excluded.source_json', [id, source.subject.projectId, source.subject.leaderWorkerId, payrollCanonical(source)])
}
export async function persistPayrollC2(db: TransactionDb, id: string, read: PayrollC2FormRead, version: string, status: 'draft' | 'checked', actor: string) {
  const now = new Date().toISOString()
  for (const recordId of read.adoptedRecordIds) {
    if ((await db.select('SELECT id FROM wage_statement_daywork_records WHERE daywork_record_id=? AND statement_id<>? AND deleted_at IS NULL', [recordId, id])).length)
      throw payrollProblem('conflict', '原签工已被其他工资领用，不能抢占')
  }
  await payrollWriteRow(db, 'wage_statements', id, { project_id: read.draft.projectId, crew_id: read.draft.crewId ?? null, leader_worker_id: read.draft.leaderWorkerId, subject_config_id: read.config!.id, month: read.draft.month, format_family: 'C2', period_kind: 'monthly', purpose: 'advance', quantity_source: 'field', status, needs_recheck: 0, pay_ratio: 1, cumulative_amount: read.totals.grossAmount.value, previously_paid: 0, gross_amount: read.totals.grossAmount.value, source_version: version, source_updated_at: now, checked_source_version: status === 'checked' ? version : '', checked_at: status === 'checked' ? now : null, operator_name: actor, note: read.draft.note ?? '', updated_at: now }, actor)
  await replaceChildren(db, 'wage_statement_members', id, read.members.map(m => ({ worker_id: m.id, is_leader: Number(m.id === read.draft.leaderWorkerId) })), actor)
  await replaceChildren(db, 'wage_statement_lines', id, read.lines.map((line, index) => ({ worker_id: line.workerId, item_id: null, item_name: line.itemName, unit: line.unit, quantity: line.quantity, unit_price: line.unitPrice, amount: line.amount, sort_order: index })), actor)
  await replaceChildren(db, 'wage_statement_daywork_records', id, read.adoptedRecordIds.map(recordId => ({ daywork_record_id: recordId })), actor)
  await persistSource(db, id, read)
}

export async function releasePayrollC2(db: TransactionDb, read: PayrollC2FormRead, release: PayrollC2ReleaseDraft, version: string, actor: string) {
  if (!read.statementId || !read.eligibility.canRelease || release.actualAmount === null || !Number.isFinite(release.actualAmount) || release.actualAmount <= 0 || Math.abs(release.actualAmount * 100 - amountInCents(release.actualAmount)) > 1e-8 || read.totals.grossAmount.value === null || release.actualAmount > read.totals.grossAmount.value)
    throw payrollProblem('validation-failed', 'C2 须核对完整，实际金额须为正数、到分且不超过当月核算')
  if (release.allocations.some(a => a.amount === null))
    throw payrollProblem('validation-failed', '全体成员须明确实际分配，零分配也要填写 0')
  const members = read.members.map(m => ({ workerId: m.id, workerName: m.name ?? '', isLeader: m.id === read.draft.leaderWorkerId }))
  let allocations
  try {
    allocations = normalizeAllocations({ members }, release.actualAmount, release.allocations.map(a => ({ workerId: a.workerId, amount: a.amount! })))
  }
  catch (cause) { throw payrollProblem('validation-failed', cause instanceof Error ? cause.message : 'C2 分配无效') }
  const now = new Date().toISOString()
  const source = payrollC2Source(read)
  const links = await db.select<{ id: string, daywork_record_id: string }>('SELECT id,daywork_record_id FROM wage_statement_daywork_records WHERE statement_id=? AND deleted_at IS NULL ORDER BY id', [read.statementId])
  if (payrollCanonical(links.map(l => l.daywork_record_id).sort()) !== payrollCanonical(source.facts.map(f => f.id).sort()))
    throw payrollProblem('conflict', '原签工关联已变化，请重新核对后发放')
  const document: PayrollC2FrozenDocument = { id: read.statementId, projectId: source.subject.projectId, projectName: read.options.projects.find(p => p.id === source.subject.projectId)?.name ?? '', crewId: source.subject.crewId, crewName: read.options.crews.find(c => c.id === source.subject.crewId)?.name ?? null, leaderName: members.find(m => m.isLeader)?.workerName ?? '', month: source.month, formatFamily: 'C2', periodKind: 'monthly', payRatio: 1, grossAmount: read.totals.grossAmount.value, actualAmount: release.actualAmount, releasedAt: now, operatorName: actor, note: read.draft.note ?? '', lines: read.lines, daywork: source.facts, config: source.config, members, allocations }
  if (!isPayrollC2FrozenDocument(document))
    throw payrollProblem('validation-failed', 'C2 冻结所需原签工、确认事实、主体配置或全成员分配无法证明')
  const snapshot = { ...document, subjectConfig: source.config, dayworkRecords: source.facts, dayworkLinks: links.map(l => ({ id: l.id, dayworkRecordId: l.daywork_record_id })), quantitySource: 'field', cumulativeAmount: document.grossAmount, previouslyPaid: 0, sourceVersion: version, sourceUpdatedAt: now, submittedAt: now, memberWorkerIds: members.map(m => m.workerId), allocationRecorded: true, actualAmountFen: amountInCents(release.actualAmount), allocationTotalFen: allocations.reduce((sum, a) => sum + a.allocatedAmountFen, 0), c2Source: source, c2Document: document }
  await replaceChildren(db, 'wage_statement_allocations', read.statementId, allocations.map(a => ({ worker_id: a.workerId, allocated_amount_fen: a.allocatedAmountFen })), actor)
  await payrollWriteRow(db, 'wage_statements', read.statementId, { status: 'released', needs_recheck: 0, actual_amount: release.actualAmount, cumulative_amount: document.grossAmount, previously_paid: 0, gross_amount: document.grossAmount, snapshot_json: payrollCanonical(snapshot), released_at: now, submitted_at: now, updated_at: now, source_version: version, operator_name: actor }, actor)
  await persistSource(db, read.statementId, read)
}
