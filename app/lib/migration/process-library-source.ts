import type { SoftDb } from '../db/soft-delete'
import type { CoreMigrationSourceEntityDTO } from './core-contract'
import { quantityMigrationTimestamp } from '../quantity/migration-graph'
import { processLibraryProblem } from '../schedule/process-library-contract'
import { compareCanonicalText } from './core-contract'

export interface ProcessLibraryMigrationHead {
  id: string
  code: string
  name: string
  version: number
  description: string
  is_default: number
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}
export interface ProcessLibraryMigrationTask {
  id: string
  library_id: string
  task_key: string
  name: string
  trade: string
  color: string
  duration_days: number
  stage_code: string
  item_codes_json: string
  sort_order: number
  predecessor_task_key: string | null
  predecessor_disabled: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}
export interface ProcessLibraryMigrationGraph {
  schemaVersion: 1
  library: ProcessLibraryMigrationHead
  tasks: ProcessLibraryMigrationTask[]
}

const headColumns = ['id', 'code', 'name', 'version', 'description', 'is_default', 'sort_order', 'created_at', 'updated_at', 'deleted_at'] as const
const taskColumns = ['id', 'library_id', 'task_key', 'name', 'trade', 'color', 'duration_days', 'stage_code', 'item_codes_json', 'sort_order', 'predecessor_task_key', 'predecessor_disabled', 'created_at', 'updated_at', 'deleted_at'] as const
const numberColumns = new Set(['version', 'is_default', 'sort_order', 'duration_days', 'predecessor_disabled'])

function invalid(message: string): never {
  throw processLibraryProblem('validation-failed', `工序库迁移：${message}`)
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}
function parseRow(value: unknown, columns: readonly string[], label: string): Record<string, string | number | null> {
  if (!object(value) || columns.some(column => !Object.hasOwn(value, column)) || Object.keys(value).some(column => !columns.includes(column)))
    return invalid(`${label}字段缺失或包含未识别字段`)
  const result: Record<string, string | number | null> = {}
  for (const column of columns) {
    const entry = value[column]
    if (column === 'deleted_at' || column === 'created_at' || column === 'updated_at') {
      if (column !== 'deleted_at' && entry === null)
        invalid(`${label}创建/更新时间不能为空`)
      result[column] = quantityMigrationTimestamp(entry, `${label}.${column}`)
    }
    else if (numberColumns.has(column)) {
      if (!Number.isSafeInteger(entry))
        invalid(`${label}.${column}必须为安全整数`)
      result[column] = entry as number
    }
    else if (column === 'predecessor_task_key' && entry === null) {
      result[column] = null
    }
    else {
      if (typeof entry !== 'string')
        invalid(`${label}.${column}必须为文本`)
      result[column] = entry as string
    }
  }
  if (!identifier(result.id))
    invalid(`${label}稳定身份无效`)
  return result
}

/** 映射 JSON 是原始证据，校验后保留原字节，不补空、不去重、不重新绑定项目。 */
export function parseProcessLibraryItemCodes(value: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  }
  catch { return invalid('分项映射 JSON 无效') }
  if (!Array.isArray(parsed) || parsed.some(entry => !identifier(entry)) || new Set(parsed).size !== parsed.length)
    invalid('分项映射必须为不重复、非空编码数组')
  return parsed as string[]
}

/** 物理图验证覆盖删除记录；旧 WBS 身份通过原头/任务 ID 留待下一片显式解析。 */
export function parseProcessLibraryMigrationGraph(value: unknown, legacyId?: string): ProcessLibraryMigrationGraph {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.tasks)
    || Object.keys(value).some(key => !['schemaVersion', 'library', 'tasks'].includes(key))) {
    invalid('图结构或版本无效')
  }
  const library = parseRow(value.library, headColumns, '库版本') as unknown as ProcessLibraryMigrationHead
  if ((legacyId !== undefined && library.id !== legacyId) || !identifier(library.code) || !library.name.trim()
    || library.version < 1 || ![0, 1].includes(library.is_default)) {
    invalid('库版本的身份、编码、版本号或默认状态无效')
  }
  const ids = new Set<string>()
  const keys = new Set<string>()
  const tasks = value.tasks.map((entry): ProcessLibraryMigrationTask => {
    const task = parseRow(entry, taskColumns, '库工序') as unknown as ProcessLibraryMigrationTask
    if (task.library_id !== library.id)
      invalid('任务父库身份无效')
    if (ids.has(task.id))
      invalid('任务稳定身份重复')
    if (!identifier(task.task_key) || keys.has(task.task_key))
      invalid('工序编码重复或无效')
    if (!task.name.trim() || task.duration_days < 1 || task.duration_days > 365 || ![0, 1].includes(task.predecessor_disabled)
      || (task.predecessor_task_key !== null && !identifier(task.predecessor_task_key))
      || (task.predecessor_task_key === null && task.predecessor_disabled === 1)) {
      invalid('工序名称、工期或前置禁用状态无效')
    }
    if (task.stage_code !== '' && !identifier(task.stage_code))
      invalid('阶段映射编码无效')
    parseProcessLibraryItemCodes(task.item_codes_json)
    ids.add(task.id)
    keys.add(task.task_key)
    return task
  }).sort((a, b) => a.sort_order - b.sort_order || compareCanonicalText(a.id, b.id))
  const byKey = new Map(tasks.map((task, index) => [task.task_key, { task, index }]))
  for (const [index, task] of tasks.entries()) {
    if (!task.predecessor_task_key)
      continue
    const predecessor = byKey.get(task.predecessor_task_key)
    if (!predecessor || predecessor.task.id === task.id)
      invalid('前置工序缺失或引用自身')
    if (library.deleted_at === null && task.deleted_at === null) {
      if (predecessor.task.deleted_at !== null)
        invalid('当前工序的前置身份已删除')
      if (!task.predecessor_disabled && predecessor.index >= index)
        invalid('未置灰的前置工序顺序无效')
    }
    const visited = new Set([task.task_key])
    let cursor: string | null = task.predecessor_task_key
    while (cursor !== null) {
      if (visited.has(cursor))
        invalid('前置关系形成循环，禁用关系也必须保有可解释身份')
      visited.add(cursor)
      const next = byKey.get(cursor)
      if (!next)
        invalid('前置工序缺失')
      cursor = next.task.predecessor_task_key
    }
  }
  return { schemaVersion: 1, library, tasks }
}

/** 只读取已受保护的 SQLite 快照，不经过会隐藏软删除祖先的普通目录查询。 */
export async function readProcessLibraryMigrationGraphs(selectSource: Pick<SoftDb, 'select'>): Promise<CoreMigrationSourceEntityDTO[]> {
  const libraries = await selectSource.select<ProcessLibraryMigrationHead>(`SELECT ${headColumns.join(', ')} FROM schedule_process_libraries ORDER BY id`)
  const tasks = await selectSource.select<ProcessLibraryMigrationTask>(`SELECT ${taskColumns.join(', ')} FROM schedule_process_library_tasks ORDER BY id`)
  const byLibrary = new Map<string, ProcessLibraryMigrationTask[]>()
  const codeVersions = new Set<string>()
  for (const library of libraries) {
    if (!identifier(library.id) || byLibrary.has(library.id))
      invalid('库稳定身份重复或无效')
    const codeVersion = JSON.stringify([library.code, library.version])
    if (codeVersions.has(codeVersion))
      invalid('库编码与版本重复，软删历史也需唯一对应')
    codeVersions.add(codeVersion)
    byLibrary.set(library.id, [])
  }
  const taskIds = new Set<string>()
  for (const task of tasks) {
    if (taskIds.has(task.id))
      invalid('任务稳定身份跨库重复')
    taskIds.add(task.id)
    const siblings = byLibrary.get(task.library_id)
    if (!siblings)
      invalid('任务缺少可解释的父库身份')
    siblings.push(task)
  }
  return libraries.map((library) => {
    const graph = parseProcessLibraryMigrationGraph({ schemaVersion: 1, library, tasks: byLibrary.get(library.id) }, library.id)
    return {
      legacyId: graph.library.id,
      name: graph.library.name,
      deletedAt: graph.library.deleted_at,
      attributes: { graphJson: JSON.stringify(graph) },
    }
  })
}
