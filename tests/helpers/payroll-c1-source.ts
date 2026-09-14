import type { TestDb } from './memory-db'
import { runMigrations } from '../../app/lib/db/migrations'
import { readQuantityCoreSource } from './quantity-migration-source'

/** 无工程量和工资头的真实人员/考勤源；健康新 C1 由中央公开命令产生。 */
export async function seedPayrollC1Source(db: TestDb) {
  await runMigrations(db)
  await db.execute('INSERT INTO projects(id,name) VALUES (?,?)', ['c1-project', '仅考勤工资工程'])
  for (const [id, name] of [['c1-crew-old', '原考勤班组'], ['c1-crew-current', '当前班组']])
    await db.execute('INSERT INTO crews(id,name) VALUES (?,?)', [id, name])
  for (const [id, name, wage] of [['c1-null', '无原日薪', null], ['c1-zero', '明确零日薪', 0], ['c1-worker', '真实日薪人员', 481]] as const)
    await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id,daily_wage) VALUES (?,?,\'c1-crew-current\',\'c1-project\',?)', [id, name, wage])
  await db.execute('INSERT INTO attendance_records(id,project_id,crew_id,worker_id,work_date,hours,overtime_hours,work_content,note) VALUES (\'c1-attendance\',\'c1-project\',\'c1-crew-old\',\'c1-worker\',\'2026-08-02\',7.51,2,\'原班组施工\',\'原考勤备注\')')
  await db.execute('INSERT INTO attendance_records(id,project_id,crew_id,worker_id,work_date,hours,overtime_hours) VALUES (\'c1-attendance-zero\',\'c1-project\',\'c1-crew-current\',\'c1-zero\',\'2026-08-03\',0,0)')
  return readQuantityCoreSource(db)
}
