import type { ScheduleTaskTemplate } from './template'
import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'

export interface ScheduleProcessLibraryOption {
  id: string
  code: string
  name: string
  version: number
  description: string
  isDefault: boolean
  taskCount: number
}

export interface ScheduleProcessLibraryTask extends ScheduleTaskTemplate {
  id: string
  libraryId: string
  libraryVersion: number
  sortOrder: number
}

interface LibraryRow {
  id: string
  code: string
  name: string
  version: number
  description: string
  is_default: number
  task_count: number
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
           COUNT(task.id) AS task_count
    FROM schedule_process_libraries library
    LEFT JOIN schedule_process_library_tasks task
      ON task.library_id = library.id
     AND ${visibleCond('schedule_process_library_tasks', 'task')}
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
           task.sort_order
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
  }))
}
