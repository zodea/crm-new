import type { TransactionDb } from '../db/coordinator'
import type { ScheduleDependencyInput, ScheduleDependencyTask } from './planning'
import { hiddenCtesFor, selectVisibleSql, visibleCond } from '../db/soft-delete'
import { scheduleProblem } from './central-contract'
import { dependencyConflicts, dependencyWouldCycle, normalizeDependencyLag } from './planning'

/** 撤销也必须保持完整活跃图合法，不能借历史日志绕开恢复入口。 */
export async function assertScheduleDependencyGraph(db: TransactionDb, projectId: string) {
  const rows = await db.select<ScheduleDependencyInput & { predProject: string, succProject: string, predGroup: string, succGroup: string }>(`${hiddenCtesFor('task_dependencies')}
    SELECT d.id, d.pred_id AS predId, d.succ_id AS succId, d.dependency_type AS dependencyType, d.lag_days AS lagDays,
      p.project_id AS predProject, s.project_id AS succProject, p.group_id AS predGroup, s.group_id AS succGroup
    FROM task_dependencies d JOIN schedule_tasks p ON p.id = d.pred_id JOIN schedule_tasks s ON s.id = d.succ_id
      JOIN schedule_groups pg ON pg.id = p.group_id JOIN schedule_groups sg ON sg.id = s.group_id
    WHERE ${visibleCond('task_dependencies', 'd')}
      AND (p.project_id = ? OR s.project_id = ?)`, [projectId, projectId])
  const successors = new Set<string>()
  for (const row of rows) {
    if (row.predProject !== projectId || row.succProject !== projectId || row.predGroup !== row.succGroup || row.predId === row.succId || row.dependencyType !== 'FS' || successors.has(row.succId))
      throw scheduleProblem('validation-failed', '当前动作会造成跨组、自依赖或多个活跃前置，未作更改')
    successors.add(row.succId)
    normalizeDependencyLag(row.lagDays)
    if (dependencyWouldCycle(rows, { predecessorId: row.predId, successorId: row.succId, excludeDependencyId: row.id }))
      throw scheduleProblem('validation-failed', '当前动作会造成循环依赖，未作更改')
  }
  const taskRows = await db.select<{ id: string, name: string, planned_start: string, planned_finish: string }>(selectVisibleSql('schedule_tasks', 'AND project_id = ?'), [projectId])
  const tasks: ScheduleDependencyTask[] = taskRows.map(row => ({ id: row.id, name: row.name, plannedStart: row.planned_start, plannedFinish: row.planned_finish }))
  if (dependencyConflicts(tasks, rows).length)
    throw scheduleProblem('validation-failed', '当前动作会恢复与计划日期冲突的依赖，请先核对计划')
  for (const row of rows) {
    const predecessor = tasks.find(task => task.id === row.predId)!
    const successor = tasks.find(task => task.id === row.succId)!
    if (predecessor.plannedStart > successor.plannedStart)
      throw scheduleProblem('validation-failed', '前置开始不能晚于后续工序，请先核对日期')
  }
}
