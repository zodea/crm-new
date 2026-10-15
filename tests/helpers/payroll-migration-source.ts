import type { TestDb } from './memory-db'
import { runMigrations } from '../../app/lib/db/migrations'
import { readQuantityCoreSource } from './quantity-migration-source'
import { insertRows } from './sql-rows'

export const payrollOriginalSnapshot = '{ "version": 1, "statementId": "pay-c2", "actualAmount": 300, "members": [{"workerId":"pay-worker","workerName":"历史负责人"},{"workerId":"pay-zero","workerName":"历史零成员"}], "allocations": [{"workerId":"pay-worker","amountFen":30000},{"workerId":"pay-zero","amountFen":0}], "subjectConfig": {"id":"pay-config","unitRate":300,"ruleText":"旧确认规则"}, "futureExtension": {"workerId":"原文不能递归改写"} }'

/**
 * 已退役本地 create/check/check/release 路径曾产出的健康原快照（逐行固化），与部分历史样本独立。
 * 两次核对各软删一组明细与签工关联；发放后负责人改名、C2 配置改价，均不得改写冻结快照。
 */
const releasedPayrollRows: Record<string, Record<string, string | number>[]> = {
  payroll_subject_configs: [
    { id: 'payroll_subject_config_mv52zf40_0', project_id: 'pay-healthy-project', crew_id: 'pay-healthy-crew', leader_worker_id: 'pay-healthy-leader', format_family: 'C2', unit_rate: 350, rule_text: '当前新规则，不能改旧冻结', enabled: 1, created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05' },
  ],
  wage_statements: [
    { id: 'wage_statement_mv52zf43_2', project_id: 'pay-healthy-project', crew_id: 'pay-healthy-crew', leader_worker_id: 'pay-healthy-leader', subject_config_id: 'payroll_subject_config_mv52zf40_0', month: '2026-08', format_family: 'C2', period_kind: 'monthly', purpose: 'advance', quantity_source: 'field', status: 'released', needs_recheck: 0, pay_ratio: 1, cumulative_amount: 300, previously_paid: 0, gross_amount: 300, actual_amount: 300, source_version: 'wage-src-f6e96455', source_updated_at: '2026-10-12 10:00:05', checked_source_version: 'wage-src-f6e96455', adjustment_reason: '', operator_name: '历史发放人', snapshot_json: '{"projectName":"冻结时工程名","crewName":"冻结时班组名","leaderName":"冻结时负责人","month":"2026-08","periodKind":"monthly","formatFamily":"C2","quantitySource":"field","sourceVersion":"wage-src-f6e96455","sourceUpdatedAt":"2026-10-12 10:00:05","payRatio":1,"cumulativeAmount":300,"previouslyPaid":0,"grossAmount":300,"actualAmount":300,"adjustmentReason":"","operatorName":"历史发放人","submittedAt":"2026-10-12T10:00:05.191Z","memberWorkerIds":["pay-healthy-leader","pay-healthy-zero"],"members":[{"workerId":"pay-healthy-leader","workerName":"冻结时负责人","isLeader":true},{"workerId":"pay-healthy-zero","workerName":"冻结时零成员","isLeader":false}],"allocations":[{"workerId":"pay-healthy-leader","workerName":"冻结时负责人","isLeader":true,"allocatedAmountFen":30000,"amount":300},{"workerId":"pay-healthy-zero","workerName":"冻结时零成员","isLeader":false,"allocatedAmountFen":0,"amount":0}],"allocationRecorded":true,"actualAmountFen":30000,"allocationTotalFen":30000,"lines":[{"id":"wage_line_mv52zf45_9","workerId":"pay-healthy-leader","itemId":null,"itemName":"零星签工 · 冻结时负责人","unit":"工","quantity":1,"unitPrice":300,"amount":300}],"dayworkRecords":[{"id":"signed_daywork_mv52zf41_1","projectId":"pay-healthy-project","projectName":"冻结时工程名","crewId":"pay-healthy-crew","crewName":"冻结时班组名","workerId":"pay-healthy-leader","workerName":"冻结时负责人","workDate":"2026-08-05","workContent":"材料搬运","startTime":"08:00","endTime":"18:00","laborUnits":1,"witness":"历史证明人","confirmedOn":"2026-08-05","status":"confirmed","note":"","updatedAt":"2026-10-12 10:00:05"}],"subjectConfig":{"id":"payroll_subject_config_mv52zf40_0","unitRate":300,"ruleText":"冻结时人工确认规则"},"note":"冻结时人工确认规则"}', checked_at: '2026-10-12 10:00:05', submitted_at: '2026-10-12T10:00:05.191Z', released_at: '2026-10-12 10:00:05', note: '冻结时人工确认规则', created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05' },
  ],
  wage_statement_lines: [
    { id: 'wage_line_mv52zf43_5', statement_id: 'wage_statement_mv52zf43_2', worker_id: 'pay-healthy-leader', item_name: '零星签工 · 冻结时负责人', unit: '工', quantity: 1, unit_price: 300, amount: 300, sort_order: 0, created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05', deleted_at: '2026-10-12 10:00:05' },
    { id: 'wage_line_mv52zf44_7', statement_id: 'wage_statement_mv52zf43_2', worker_id: 'pay-healthy-leader', item_name: '零星签工 · 冻结时负责人', unit: '工', quantity: 1, unit_price: 300, amount: 300, sort_order: 0, created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05', deleted_at: '2026-10-12 10:00:05' },
    { id: 'wage_line_mv52zf45_9', statement_id: 'wage_statement_mv52zf43_2', worker_id: 'pay-healthy-leader', item_name: '零星签工 · 冻结时负责人', unit: '工', quantity: 1, unit_price: 300, amount: 300, sort_order: 0, created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05' },
  ],
  wage_statement_members: [
    { id: 'wage_member_mv52zf43_3', statement_id: 'wage_statement_mv52zf43_2', worker_id: 'pay-healthy-leader', is_leader: 1, created_at: '2026-10-12 10:00:05' },
    { id: 'wage_member_mv52zf43_4', statement_id: 'wage_statement_mv52zf43_2', worker_id: 'pay-healthy-zero', is_leader: 0, created_at: '2026-10-12 10:00:05' },
  ],
  signed_daywork_records: [
    { id: 'signed_daywork_mv52zf41_1', project_id: 'pay-healthy-project', crew_id: 'pay-healthy-crew', worker_id: 'pay-healthy-leader', work_date: '2026-08-05', work_content: '材料搬运', start_time: '08:00', end_time: '18:00', labor_units: 1, witness: '历史证明人', confirmed_on: '2026-08-05', status: 'confirmed', note: '', created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05' },
  ],
  wage_statement_daywork_records: [
    { id: 'wage_daywork_mv52zf43_6', statement_id: 'wage_statement_mv52zf43_2', daywork_record_id: 'signed_daywork_mv52zf41_1', created_at: '2026-10-12 10:00:05', deleted_at: '2026-10-12 10:00:05' },
    { id: 'wage_daywork_mv52zf44_8', statement_id: 'wage_statement_mv52zf43_2', daywork_record_id: 'signed_daywork_mv52zf41_1', created_at: '2026-10-12 10:00:05', deleted_at: '2026-10-12 10:00:05' },
    { id: 'wage_daywork_mv52zf45_a', statement_id: 'wage_statement_mv52zf43_2', daywork_record_id: 'signed_daywork_mv52zf41_1', created_at: '2026-10-12 10:00:05' },
  ],
  wage_statement_allocations: [
    { id: 'wage_allocation_mv52zf47_b', statement_id: 'wage_statement_mv52zf43_2', worker_id: 'pay-healthy-leader', allocated_amount_fen: 30000, created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05' },
    { id: 'wage_allocation_mv52zf47_c', statement_id: 'wage_statement_mv52zf43_2', worker_id: 'pay-healthy-zero', allocated_amount_fen: 0, created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05' },
  ],
}

export async function seedReleasedPayrollMigrationSource(db: TestDb) {
  await runMigrations(db)
  await db.execute('INSERT INTO projects(id,name) VALUES (\'pay-healthy-project\',\'冻结时工程名\')')
  await db.execute('INSERT INTO crews(id,name) VALUES (\'pay-healthy-crew\',\'冻结时班组名\')')
  for (const [id, name] of [['pay-healthy-leader', '当前已改名负责人'], ['pay-healthy-zero', '冻结时零成员']])
    await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id) VALUES (?,?,\'pay-healthy-crew\',\'pay-healthy-project\')', [id, name])
  for (const [table, rows] of Object.entries(releasedPayrollRows))
    await insertRows(db, table, rows)
  const statement = releasedPayrollRows.wage_statements![0]!
  return { source: await readQuantityCoreSource(db), statementId: String(statement.id), snapshot: String(statement.snapshot_json) }
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
