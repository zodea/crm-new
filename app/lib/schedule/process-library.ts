import type { ScheduleTaskTemplate } from './template'
import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'

export interface ScheduleProcessLibraryOption {
  sourceVersion?: string
  id: string
  code: string
  name: string
  version: number
  description: string
  isDefault: boolean
  taskCount: number
  usageCount: number | null
}

export interface ScheduleProcessLibraryTask extends ScheduleTaskTemplate {
  id: string
  libraryId: string
  libraryVersion: number
  sortOrder: number
  predecessorKey: string | null
  predecessorDisabled: boolean
}

export interface ScheduleProcessLibraryDetail extends ScheduleProcessLibraryOption {
  tasks: ScheduleProcessLibraryTask[]
}

export interface ScheduleProcessLibraryTaskDraft {
  key: string
  name: string
  durationDays: number
  trade: string
  color: string
  stageCode: string
  itemCodes: readonly string[]
  predecessorKey: string | null
  predecessorDisabled?: boolean
}

export interface ScheduleProcessLibraryVersionDraft {
  sourceLibraryId: string | null
  code: string
  name: string
  description: string
  tasks: readonly ScheduleProcessLibraryTaskDraft[]
}

interface LibraryRow {
  id: string
  code: string
  name: string
  version: number
  description: string
  is_default: number
  task_count: number
  usage_count: number
}

interface LibraryTaskRow {
  id: string
  library_id: string
  library_version: number
  task_key: string
  name: string
  duration_days: number
  trade: string
  color: string
  stage_code: string
  item_codes_json: string
  sort_order: number
  predecessor_task_key: string | null
  predecessor_disabled: number
}

function stringArrayJson(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : []
  }
  catch {
    return []
  }
}

export async function loadScheduleProcessLibraries(
  db: SoftDb,
): Promise<ScheduleProcessLibraryOption[]> {
  const rows = await db.select<LibraryRow>(`
    ${hiddenCtesFor('schedule_process_libraries', 'schedule_process_library_tasks')}
    SELECT library.id,
           library.code,
           library.name,
           library.version,
           library.description,
           library.is_default,
           COUNT(DISTINCT task.id) AS task_count,
           COUNT(DISTINCT schedule_group.id) AS usage_count
    FROM schedule_process_libraries library
    LEFT JOIN schedule_process_library_tasks task
      ON task.library_id = library.id
     AND ${visibleCond('schedule_process_library_tasks', 'task')}
    LEFT JOIN schedule_groups schedule_group
      ON schedule_group.process_library_id = library.id
     AND schedule_group.deleted_at IS NULL
    WHERE ${visibleCond('schedule_process_libraries', 'library')}
    GROUP BY library.id, library.code, library.name, library.version,
             library.description, library.is_default, library.sort_order
    ORDER BY library.is_default DESC, library.sort_order, library.name, library.id
  `)
  return rows.map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    version: Number(row.version) || 1,
    description: row.description,
    isDefault: Boolean(row.is_default),
    taskCount: Number(row.task_count) || 0,
    usageCount: Number(row.usage_count) || 0,
  }))
}

export async function loadScheduleProcessLibraryTasks(
  db: SoftDb,
  libraryId: string,
): Promise<ScheduleProcessLibraryTask[]> {
  if (!libraryId)
    return []
  const rows = await db.select<LibraryTaskRow>(`
    ${hiddenCtesFor('schedule_process_libraries', 'schedule_process_library_tasks')}
    SELECT task.id,
           task.library_id,
           library.version AS library_version,
           task.task_key,
           task.name,
           task.duration_days,
           task.trade,
           task.color,
           task.stage_code,
           task.item_codes_json,
           task.sort_order,
           task.predecessor_task_key,
           task.predecessor_disabled
    FROM schedule_process_library_tasks task
    JOIN schedule_process_libraries library ON library.id = task.library_id
    WHERE ${visibleCond('schedule_process_library_tasks', 'task')}
      AND ${visibleCond('schedule_process_libraries', 'library')}
      AND task.library_id = ?
    ORDER BY task.sort_order, task.id
  `, [libraryId])
  return rows.map(row => ({
    id: row.id,
    libraryId: row.library_id,
    libraryVersion: Number(row.library_version) || 1,
    key: row.task_key,
    name: row.name,
    durationDays: Number(row.duration_days) || 1,
    trade: row.trade,
    color: row.color,
    stageCode: row.stage_code || undefined,
    itemCodes: stringArrayJson(row.item_codes_json),
    sortOrder: Number(row.sort_order) || 0,
    predecessorKey: row.predecessor_task_key || null,
    predecessorDisabled: Boolean(row.predecessor_disabled),
  }))
}
