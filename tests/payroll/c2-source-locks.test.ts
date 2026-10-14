import { expect, it } from 'vitest'
import { initializePayrollSchema } from '../../app/lib/payroll/central-schema'
import { loadPayrollDayworkOccupations, loadPayrollSourceExclusions, payrollDayworkOccupationsFromGraph, payrollSourceExclusionsFromGraph } from '../../app/lib/payroll/central-source-locks'
import { buildWageDraftSource, createWageStatementDraft } from '../../app/lib/payroll/statements'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { seedPayrollC2MigrationSource } from '../helpers/payroll-c2-migration-source'

it('他单未发逐条领用可见，但不制造同格式整月编辑锁；已发软删头与关联仍占用', async () => {
  const db = await createMigratedMemoryDb()
  try {
    const { dayworkIds, configId } = await seedPayrollC2MigrationSource(db)
    await initializePayrollSchema(db)
    const draft = { projectId: 'c2-project', crewId: 'c2-crew', leaderWorkerId: 'c2-leader', memberWorkerIds: ['c2-worker', 'c2-zero'], month: '2026-08', formatFamily: 'C2' as const, quantitySource: 'field' as const, subjectConfigId: configId }
    const source = await buildWageDraftSource(db, draft)
    const statementId = await createWageStatementDraft(db, { ...draft, purpose: 'advance', periodKind: 'monthly', payRatio: 1, lines: source.lines, sourceVersion: source.sourceVersion, sourceUpdatedAt: source.sourceUpdatedAt, sourceRecordIds: source.sourceRecordIds })
    const query = { projectId: 'c2-project', recordIds: [dayworkIds[0]!] }
    expect(await loadPayrollDayworkOccupations(db, query)).toContainEqual(expect.objectContaining({ statementId, dayworkRecordId: dayworkIds[0], kind: 'active-link', status: 'draft' }))
    expect(await loadPayrollDayworkOccupations(db, { ...query, recordIds: [] })).toEqual([])
    const lockQuery = { projectId: 'c2-project', month: '2026-08', workerIds: ['c2-worker', 'c2-zero'], formatFamily: 'C2' as const, statementId: null }
    expect(await loadPayrollSourceExclusions(db, lockQuery)).toEqual([])
    // 只检验锁投影对历史状态的保留，不把此损坏头当作健康发放证据。
    await db.execute('UPDATE wage_statements SET status=\'released\',deleted_at=\'2026-09-01\' WHERE id=?', [statementId])
    await db.execute('UPDATE wage_statement_daywork_records SET deleted_at=\'2026-09-01\' WHERE statement_id=?', [statementId])
    await db.execute('UPDATE wage_statement_members SET deleted_at=\'2026-09-01\' WHERE statement_id=?', [statementId])
    expect(await loadPayrollDayworkOccupations(db, query)).toContainEqual(expect.objectContaining({ statementId, kind: 'released-link', statementDeletedAt: '2026-09-01', linkDeletedAt: '2026-09-01' }))
    expect(await loadPayrollSourceExclusions(db, lockQuery)).toContainEqual(expect.objectContaining({ workerId: 'c2-zero', kind: 'released-month' }))
  }
  finally { db.close() }
})

it.each(['source-table', 'frozen-document', 'frozen-links'] as const)('已发只余 C2 原证据时，完整无签工成员或原签工的月份锁仍保留：%s', (kind) => {
  const source = { schemaVersion: 1, month: '2026-08', subject: { projectId: 'p', leaderWorkerId: 'leader', memberWorkerIds: ['leader', 'zero'], crewId: null }, facts: [], members: [{ workerId: 'zero', workerName: '零分配成员', crewId: null }] }
  const snapshot = kind === 'frozen-document' ? { c2Document: { month: '2026-08', members: source.members, daywork: [{ id: 'only-document-record', workerId: 'zero' }] } } : { dayworkLinks: [{ id: 'frozen-physical-link', dayworkRecordId: 'only-document-record' }] }
  const graph = { statements: [{ id: 'released', project_id: 'p', month: '2026-08', leader_worker_id: 'leader', status: 'released', format_family: 'C2', deleted_at: '2026-09-01', snapshot_json: kind === 'source-table' ? null : JSON.stringify(snapshot) }], members: [], attendance: [], daywork: kind === 'frozen-links' ? [{ id: 'only-document-record', worker_id: 'zero' }] : [], statementDaywork: [], evidence: [], c2Sources: kind === 'source-table' ? [{ statement_id: 'released', source_json: JSON.stringify(source) }] : [] }
  expect(payrollSourceExclusionsFromGraph(graph, { projectId: 'p', month: '2026-08', workerIds: ['zero'], formatFamily: 'C2', statementId: null })).toEqual([expect.objectContaining({ statementId: 'released', workerId: 'zero', kind: 'released-month' })])
  if (kind !== 'source-table')
    expect(payrollDayworkOccupationsFromGraph(graph)).toContainEqual(expect.objectContaining({ dayworkRecordId: 'only-document-record', kind: 'released-snapshot' }))
})

it('缺头关联与可定位快照/新源独立保留，未知扩展ID不推断签工', () => {
  const graph = {
    statements: [{ id: 'released', project_id: 'p', month: '2026-08', status: 'released', format_family: 'C2', deleted_at: null, snapshot_json: JSON.stringify({ dayworkRecords: [{ id: 'frozen-record' }], future: { dayworkRecordId: 'not-a-source' } }) }],
    statementDaywork: [{ id: 'orphan-link', statement_id: 'missing', daywork_record_id: 'record', deleted_at: null }],
    daywork: [{ id: 'record', project_id: 'p', work_date: '2026-08-02' }],
    evidence: [],
    c2Sources: [{ statement_id: 'missing-source-head', project_id: 'p', source_json: JSON.stringify({ schemaVersion: 1, month: '2026-08', facts: [{ id: 'source-only' }] }) }],
  }
  const result = payrollDayworkOccupationsFromGraph(graph, { projectId: 'p' })
  expect(result).toContainEqual(expect.objectContaining({ dayworkRecordId: 'record', statementId: 'missing', kind: 'missing-head', status: null }))
  expect(result).toContainEqual(expect.objectContaining({ dayworkRecordId: 'frozen-record', kind: 'released-snapshot' }))
  expect(result).toContainEqual(expect.objectContaining({ dayworkRecordId: 'source-only', kind: 'c2-source', status: null }))
  expect(result.some(row => row.dayworkRecordId === 'not-a-source')).toBe(false)
})
