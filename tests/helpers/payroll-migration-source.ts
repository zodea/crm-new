import type { TestDb } from './memory-db'
import { runMigrations } from '../../app/lib/db/migrations'
import { saveSignedDayworkRecord, upsertC2SubjectConfig } from '../../app/lib/payroll/daywork'
import { buildWageDraftSource, checkWageStatement, createWageStatementDraft, releaseWageStatement } from '../../app/lib/payroll/statements'
import { readQuantityCoreSource } from './quantity-migration-source'

export const payrollOriginalSnapshot = '{ "version": 1, "statementId": "pay-c2", "actualAmount": 300, "members": [{"workerId":"pay-worker","workerName":"历史负责人"},{"workerId":"pay-zero","workerName":"历史零成员"}], "allocations": [{"workerId":"pay-worker","amountFen":30000},{"workerId":"pay-zero","amountFen":0}], "subjectConfig": {"id":"pay-config","unitRate":300,"ruleText":"旧确认规则"}, "futureExtension": {"workerId":"原文不能递归改写"} }'

/** 合法本地公开 create/check/check/release 路径产生健康原快照，与部分历史样本独立。 */
export async function seedReleasedPayrollMigrationSource(db: TestDb) {
  await runMigrations(db)
  await db.execute('INSERT INTO projects(id,name) VALUES (\'pay-healthy-project\',\'冻结时工程名\')')
  await db.execute('INSERT INTO crews(id,name) VALUES (\'pay-healthy-crew\',\'冻结时班组名\')')
  for (const [id, name] of [['pay-healthy-leader', '冻结时负责人'], ['pay-healthy-zero', '冻结时零成员']])
    await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id) VALUES (?,?,\'pay-healthy-crew\',\'pay-healthy-project\')', [id, name])
  const participants = { projectId: 'pay-healthy-project', crewId: 'pay-healthy-crew', leaderWorkerId: 'pay-healthy-leader', memberWorkerIds: ['pay-healthy-leader', 'pay-healthy-zero'] }
  const subjectConfigId = await upsertC2SubjectConfig(db, { ...participants, unitRate: 300, ruleText: '冻结时人工确认规则' })
  await saveSignedDayworkRecord(db, { projectId: participants.projectId, crewId: participants.crewId, workerId: participants.leaderWorkerId, workDate: '2026-08-05', workContent: '材料搬运', startTime: '08:00', endTime: '18:00', laborUnits: 1, witness: '历史证明人', confirmedOn: '2026-08-05', status: 'confirmed' })
  const input = { ...participants, month: '2026-08', formatFamily: 'C2' as const, quantitySource: 'field' as const, subjectConfigId }
  const source = await buildWageDraftSource(db, input)
  const statementId = await createWageStatementDraft(db, { ...input, purpose: 'advance', payRatio: 1, lines: source.lines, sourceVersion: source.sourceVersion, sourceUpdatedAt: source.sourceUpdatedAt, sourceRecordIds: source.sourceRecordIds })
  for (let round = 0; round < 2; round++) {
    const fresh = await buildWageDraftSource(db, { ...input, statementId })
    await checkWageStatement(db, statementId, fresh.lines, fresh)
  }
  const result = await releaseWageStatement(db, statementId, 300, { operatorName: '历史发放人' }, [{ workerId: 'pay-healthy-leader', amount: 300 }, { workerId: 'pay-healthy-zero', amount: 0 }])
  if (result !== 'released')
    throw new Error('健康旧库工资未成功发放')
  const [record] = await db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id = ?', [statementId])
  await db.execute('UPDATE workers SET name = ? WHERE id = ?', ['当前已改名负责人', participants.leaderWorkerId])
  await upsertC2SubjectConfig(db, { ...participants, unitRate: 350, ruleText: '当前新规则，不能改旧冻结' })
  return { source: await readQuantityCoreSource(db), statementId, snapshot: record!.snapshot_json }
}

/** 真实八表旧库，另一个项目仅有独立来源；不手写迁入 DTO 或附件归属。 */
export async function seedPayrollMigrationSource(db: TestDb) {
  await runMigrations(db)
  for (const id of ['pay-project', 'pay-independent'])
    await db.execute('INSERT INTO projects(id,name) VALUES (?,?)', [id, id === 'pay-project' ? '工资迁入工程' : '仅有工资来源的工程'])
  await db.execute('INSERT INTO crews(id,name) VALUES (?,?)', ['pay-crew', '工资班组'])
  for (const [id, name] of [['pay-worker', '当前负责人'], ['pay-zero', '当前零成员']])
    await db.execute('INSERT INTO workers(id,name,crew_id) VALUES (?,?,?)', [id, name, 'pay-crew'])
  for (const [id, project] of [['pay-config', 'pay-project'], ['pay-independent-config', 'pay-independent']])
    await db.execute('INSERT INTO payroll_subject_configs(id,project_id,crew_id,leader_worker_id,unit_rate,rule_text) VALUES (?,?,\'pay-crew\',\'pay-worker\',300,\'当前确认规则\')', [id, project])
  await db.execute('INSERT INTO wage_statements(id,project_id,crew_id,leader_worker_id,subject_config_id,month,format_family,quantity_source,status,actual_amount,snapshot_json) VALUES (\'pay-c2\',\'pay-project\',\'pay-crew\',\'pay-worker\',\'pay-config\',\'2026-08\',\'C2\',\'field\',\'released\',300,?)', [payrollOriginalSnapshot])
  await db.execute('INSERT INTO wage_statement_lines(id,statement_id,worker_id,item_name,quantity,unit_price,amount,deleted_at) VALUES (\'pay-line-old\',\'pay-c2\',\'pay-worker\',\'历史重核行\',1,200,200,\'2026-08-31 01:00:00\')')
  for (const [id, leader] of [['pay-worker', 1], ['pay-zero', 0]] as const) {
    await db.execute('INSERT INTO wage_statement_members(id,statement_id,worker_id,is_leader) VALUES (?,\'pay-c2\',?,?)', [`member-${id}`, id, leader])
    await db.execute('INSERT INTO wage_statement_allocations(id,statement_id,worker_id,allocated_amount_fen) VALUES (?,\'pay-c2\',?,?)', [`allocation-${id}`, id, leader ? 30000 : 0])
  }
  for (const [id, project, status] of [['pay-day', 'pay-project', 'confirmed'], ['pay-independent-day', 'pay-independent', 'draft']])
    await db.execute('INSERT INTO signed_daywork_records(id,project_id,crew_id,worker_id,work_date,labor_units,status) VALUES (?,?,\'pay-crew\',\'pay-worker\',\'2026-08-02\',1,?)', [id, project, status])
  await db.execute('INSERT INTO wage_statement_daywork_records(id,statement_id,daywork_record_id) VALUES (\'pay-link\',\'pay-c2\',\'pay-day\')')
  await db.execute('INSERT INTO attendance_records(id,project_id,worker_id,work_date,hours) VALUES (\'pay-attendance\',\'pay-independent\',\'pay-zero\',\'2026-07-02\',0)')
  await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,before_data,after_data) VALUES (\'pay-log\',\'wage_statements\',\'pay-c2\',\'update\',NULL,?)', [JSON.stringify({ id: 'pay-c2', project_id: 'pay-project', snapshot_json: payrollOriginalSnapshot })])
  return readQuantityCoreSource(db)
}
