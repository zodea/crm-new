import type { TransactionDb } from '../db/coordinator'
import { hiddenCtesFor } from '../db/soft-delete'

export interface ScheduleHistoryLog {
  id: string
  tableName: string
  recordId: string
  action: string
  beforeJson: string | null
  afterJson: string | null
  operator: string | null
  createdAt: string
}
export interface ScheduleRemovedTask {
  id: string
  groupId: string | null
  name: string
  deletedAt: string | null
  plannedStart: string
  plannedFinish: string
  baselineStart: string | null
  baselineFinish: string | null
  manualProgress: number | null
  stageId: string | null
  sourceLibraryTaskId: string | null
  sourceLibraryVersion: number | null
  templateSnapshotJson: string | null
}
export interface ScheduleMigrationEvidence {
  entityId: string
  batchId: string
  sourceGraphJson: string
  provisionalDetailStatus: 'legacy-detail-unavailable' | 'not-applicable'
}
export interface ScheduleHistory {
  logs: ScheduleHistoryLog[]
  /** 被软删除祖先隐藏的任务及旧无分组任务同样保有可读历史。 */
  removedTasks: ScheduleRemovedTask[]
  migrationEvidence: ScheduleMigrationEvidence[]
}

/** 调用者先授权本项目；按真实项目祖先连接，不能仅凭日志 operator 或同名对象归属。 */
export async function loadScheduleHistory(db: TransactionDb, projectId: string, visibility: Pick<typeof import('../db/soft-delete'), 'hiddenCtesFor'> = { hiddenCtesFor }): Promise<ScheduleHistory> {
  const logs = await db.select<ScheduleHistoryLog>(`SELECT log.id, log.table_name AS tableName, log.record_id AS recordId,
      log.action, log.before_data AS beforeJson, log.after_data AS afterJson, log.operator, log.created_at AS createdAt
    FROM operation_logs log
    WHERE (log.table_name = 'schedule_groups' AND EXISTS (SELECT 1 FROM schedule_groups g WHERE g.id = log.record_id AND g.project_id = ?))
       OR (log.table_name = 'schedule_tasks' AND EXISTS (SELECT 1 FROM schedule_tasks t WHERE t.id = log.record_id AND t.project_id = ?))
       OR (log.table_name = 'schedule_group_buildings' AND EXISTS (SELECT 1 FROM schedule_group_buildings b JOIN schedule_groups g ON g.id = b.group_id WHERE b.id = log.record_id AND g.project_id = ?))
       OR (log.table_name = 'task_item_map' AND EXISTS (SELECT 1 FROM task_item_map m JOIN schedule_tasks t ON t.id = m.task_id WHERE m.id = log.record_id AND t.project_id = ?))
       OR (log.table_name = 'task_dependencies' AND EXISTS (SELECT 1 FROM task_dependencies d JOIN schedule_tasks t ON t.id = d.succ_id WHERE d.id = log.record_id AND t.project_id = ?))
       OR (log.table_name = 'schedule_task_floor_plans' AND EXISTS (SELECT 1 FROM schedule_task_floor_plans f JOIN schedule_tasks t ON t.id = f.task_id WHERE f.id = log.record_id AND t.project_id = ?))
    ORDER BY log.created_at, log.id`, Array.from({ length: 6 }).fill(projectId))
  const removedTasks = await db.select<ScheduleRemovedTask>(`${visibility.hiddenCtesFor('schedule_tasks')}
    SELECT t.id, t.group_id AS groupId, t.name, t.deleted_at AS deletedAt,
      t.planned_start AS plannedStart, t.planned_finish AS plannedFinish,
      t.baseline_start AS baselineStart, t.baseline_finish AS baselineFinish,
      t.manual_progress AS manualProgress, t.stage_id AS stageId,
      t.source_library_task_id AS sourceLibraryTaskId, t.source_library_version AS sourceLibraryVersion,
      t.template_snapshot_json AS templateSnapshotJson
    FROM schedule_tasks t
    WHERE t.project_id = ? AND (t.id IN (SELECT id FROM hidden_schedule_tasks) OR t.group_id IS NULL)
    ORDER BY t.sort_order, t.id`, [projectId])
  const migrationEvidence = await db.select<ScheduleMigrationEvidence>(`SELECT entity_id AS entityId, batch_id AS batchId,
      source_graph_json AS sourceGraphJson, provisional_detail_status AS provisionalDetailStatus
    FROM schedule_migration_evidence WHERE project_id = ? ORDER BY entity_id`, [projectId])
  return { logs, removedTasks, migrationEvidence }
}
