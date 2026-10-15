import { expect, it } from 'vitest'
import { initializePayrollSchema } from '../../app/lib/payroll/central-schema'
import { loadPayrollDayworkOccupations, loadPayrollSourceExclusions, payrollDayworkOccupationsFromGraph, payrollSourceExclusionsFromGraph } from '../../app/lib/payroll/central-source-locks'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { seedPayrollC2MigrationSource } from '../helpers/payroll-c2-migration-source'
import { insertRows } from '../helpers/sql-rows'

/** 已退役本地建单曾为 C2 半工源产出的未发草稿（逐行固化）：仅领用已确认半工。 */
const c2DraftRows: Record<string, Record<string, string | number>[]> = {
  wage_statements: [
    { id: 'wage_statement_mv52zf5q_g', project_id: 'c2-project', crew_id: 'c2-crew', leader_worker_id: 'c2-leader', subject_config_id: 'payroll_subject_config_mv52zf52_d', month: '2026-08', format_family: 'C2', period_kind: 'monthly', purpose: 'advance', quantity_source: 'field', status: 'draft', needs_recheck: 0, pay_ratio: 1, cumulative_amount: 175.06, previously_paid: 0, gross_amount: 175.06, source_version: 'wage-src-fb8f2c37', source_updated_at: '2026-10-12 10:00:05', checked_source_version: '', adjustment_reason: '', operator_name: '', note: '', created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05' },
  ],
  wage_statement_lines: [
    { id: 'wage_line_mv52zf5q_k', statement_id: 'wage_statement_mv52zf5q_g', worker_id: 'c2-worker', item_name: '零星签工 · 签工人员', unit: '工', quantity: 0.5, unit_price: 350.125, amount: 175.06, sort_order: 0, created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05' },
  ],
  wage_statement_members: [
    { id: 'wage_member_mv52zf5q_h', statement_id: 'wage_statement_mv52zf5q_g', worker_id: 'c2-leader', is_leader: 1, created_at: '2026-10-12 10:00:05' },
    { id: 'wage_member_mv52zf5q_i', statement_id: 'wage_statement_mv52zf5q_g', worker_id: 'c2-worker', is_leader: 0, created_at: '2026-10-12 10:00:05' },
    { id: 'wage_member_mv52zf5q_j', statement_id: 'wage_statement_mv52zf5q_g', worker_id: 'c2-zero', is_leader: 0, created_at: '2026-10-12 10:00:05' },
  ],
  wage_statement_daywork_records: [
    { id: 'wage_daywork_mv52zf5r_l', statement_id: 'wage_statement_mv52zf5q_g', daywork_record_id: 'signed_daywork_mv52zf53_e', created_at: '2026-10-12 10:00:05' },
  ],
}

it('他单未发逐条领用可见，但不制造同格式整月编辑锁；已发软删头与关联仍占用', async () => {
  const db = await createMigratedMemoryDb()
  try {
    const { dayworkIds } = await seedPayrollC2MigrationSource(db)
    await initializePayrollSchema(db)
    for (const [table, rows] of Object.entries(c2DraftRows))
      await insertRows(db, table, rows)
    const statementId = String(c2DraftRows.wage_statements![0]!.id)
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
