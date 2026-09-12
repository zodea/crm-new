import type { TransactionDb } from '../db/coordinator'
import { logCreate, selectVisibleSql, withUpdateLog } from '../db/soft-delete'
import { generateId } from '../util/id'
import { quantityProblem } from './central-contract'

export interface QuantityStageDraft {
  id: string | null
  code: string
  name: string
  trade: string
  completionMode: 'unit' | 'manual'
  sortOrder: number
  itemIds: string[]
}

export type QuantityStageAction = { kind: 'save-stage', draft: QuantityStageDraft, allowArchivedEdit: boolean }
  | { kind: 'set-reporting-stage', itemId: string, stageId: string | null, allowArchivedEdit: boolean }

export interface QuantityStageWorkspace {
  projectId: string
  matrixArchivedAt: string | null
  stages: Array<Omit<QuantityStageDraft, 'id' | 'itemIds'> & { id: string }>
  items: Array<{ id: string, code: string, name: string, trade: string, unit: string | null }>
  mappings: Array<{ id: string, stageId: string, itemId: string, isReportingStage: boolean }>
}

interface ProjectRow { id: string, matrix_archived_at: string | null }
interface StageRow {
  id: string
  project_id: string
  code: string
  name: string
  trade: string
  completion_mode: 'unit' | 'manual'
  sort_order: number
}
interface ItemRow { id: string, project_id: string, code: string, name: string, trade: string, unit: string | null }
interface MappingRow { id: string, stage_id: string, item_id: string, is_reporting_stage: number }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function parseQuantityStageAction(value: unknown): QuantityStageAction | null {
  if (!object(value) || (value.kind !== 'save-stage' && value.kind !== 'set-reporting-stage'))
    return null
  if (typeof value.allowArchivedEdit !== 'boolean')
    throw quantityProblem('validation-failed', '阶段配置的归档确认参数无效')
  if (value.kind === 'set-reporting-stage') {
    if (!text(value.itemId) || !(value.stageId === null || text(value.stageId)))
      throw quantityProblem('validation-failed', '报量阶段选择无效')
    return { kind: value.kind, itemId: value.itemId.trim(), stageId: value.stageId?.trim() ?? null, allowArchivedEdit: value.allowArchivedEdit }
  }
  const draft = value.draft
  if (!object(draft) || !(draft.id === null || text(draft.id))
    || !text(draft.code) || !text(draft.name) || !text(draft.trade)
    || (draft.completionMode !== 'unit' && draft.completionMode !== 'manual') || !Number.isSafeInteger(draft.sortOrder)
    || !Array.isArray(draft.itemIds) || !draft.itemIds.every(text)) {
    throw quantityProblem('validation-failed', '阶段配置格式无效，请核对编码、名称、工种和分项')
  }
  const itemIds = draft.itemIds.map(id => id.trim())
  if (new Set(itemIds).size !== itemIds.length)
    throw quantityProblem('validation-failed', '同一阶段不能重复关联相同分项')
  if (draft.completionMode === 'manual' && itemIds.length)
    throw quantityProblem('validation-failed', '人工进度阶段不能关联计量分项')
  return {
    kind: 'save-stage',
    allowArchivedEdit: value.allowArchivedEdit,
    draft: {
      id: draft.id?.trim() ?? null,
      code: draft.code.trim(),
      name: draft.name.trim(),
      trade: draft.trade.trim(),
      completionMode: draft.completionMode as 'unit' | 'manual',
      sortOrder: Number(draft.sortOrder),
      itemIds,
    },
  }
}

async function project(db: TransactionDb, projectId: string): Promise<ProjectRow> {
  const [row] = await db.select<ProjectRow>(selectVisibleSql('projects', 'AND id = ?'), [projectId])
  if (!row)
    throw quantityProblem('not-found', '当前项目不存在或已不可见')
  return row
}

async function stage(db: TransactionDb, projectId: string, id: string): Promise<StageRow> {
  const [row] = await db.select<StageRow>(selectVisibleSql('construction_stages', 'AND id = ? AND project_id = ?'), [id, projectId])
  if (!row)
    throw quantityProblem('relationship-mismatch', '所选阶段已不可用或不属于当前项目')
  return row
}

async function item(db: TransactionDb, projectId: string, id: string): Promise<ItemRow> {
  const [row] = await db.select<ItemRow>(selectVisibleSql('items', 'AND id = ? AND project_id = ?'), [id, projectId])
  if (!row)
    throw quantityProblem('relationship-mismatch', '所选分项已不可用或不属于当前项目')
  return row
}

/** 仅重验当前关联；不比较可能已被本命令改变的历史版本或报量标记。 */
export async function validateQuantityStageParent(db: TransactionDb, projectId: string, action: QuantityStageAction) {
  const currentProject = await project(db, projectId)
  if (currentProject.matrix_archived_at && !action.allowArchivedEdit)
    throw quantityProblem('validation-failed', '工程量矩阵已归档，请明确确认后修改阶段配置')
  if (action.kind === 'save-stage') {
    if (action.draft.id)
      await stage(db, projectId, action.draft.id)
    for (const id of action.draft.itemIds) {
      if ((await item(db, projectId, id)).trade !== action.draft.trade)
        throw quantityProblem('relationship-mismatch', '阶段和关联分项的工种不一致')
    }
    return
  }
  const currentItem = await item(db, projectId, action.itemId)
  if (action.stageId === null)
    return
  const currentStage = await stage(db, projectId, action.stageId)
  if (currentStage.trade !== currentItem.trade || currentStage.completion_mode !== 'unit')
    throw quantityProblem('relationship-mismatch', '报量阶段必须属于同一工种并使用逐户完成事实')
  const [mapping] = await db.select<MappingRow>(selectVisibleSql('construction_stage_items', 'AND stage_id = ? AND item_id = ?'), [action.stageId, action.itemId])
  if (!mapping)
    throw quantityProblem('relationship-mismatch', '该分项尚未关联所选报量阶段')
}

export async function loadQuantityStageWorkspace(db: TransactionDb, projectId: string): Promise<QuantityStageWorkspace> {
  const currentProject = await project(db, projectId)
  const stages = await db.select<StageRow>(selectVisibleSql('construction_stages', 'AND project_id = ? ORDER BY sort_order, code, id'), [projectId])
  const items = await db.select<ItemRow>(selectVisibleSql('items', 'AND project_id = ? ORDER BY sort_order, code, id'), [projectId])
  const mappings = await db.select<MappingRow>(selectVisibleSql('construction_stage_items', 'AND stage_id IN (SELECT id FROM construction_stages WHERE project_id = ?) ORDER BY stage_id, item_id, id'), [projectId])
  const itemById = new Map(items.map(row => [row.id, row]))
  const stageById = new Map(stages.map(row => [row.id, row]))
  for (const mapping of mappings) {
    const linkedItem = itemById.get(mapping.item_id)
    if (!linkedItem || linkedItem.trade !== stageById.get(mapping.stage_id)?.trade)
      throw quantityProblem('relationship-mismatch', '现有阶段映射的项目或工种不一致，请先核对来源')
  }
  return {
    projectId,
    matrixArchivedAt: currentProject.matrix_archived_at,
    stages: stages.map(row => ({ id: row.id, code: row.code, name: row.name, trade: row.trade, completionMode: row.completion_mode, sortOrder: row.sort_order })),
    items: items.map(row => ({ id: row.id, code: row.code, name: row.name, trade: row.trade, unit: row.unit?.trim() || null })),
    mappings: mappings.map(row => ({ id: row.id, stageId: row.stage_id, itemId: row.item_id, isReportingStage: row.is_reporting_stage === 1 })),
  }
}

async function saveStage(db: TransactionDb, projectId: string, draft: QuantityStageDraft) {
  const logIds: string[] = []
  const current = draft.id ? await stage(db, projectId, draft.id) : null
  if (current && (current.code !== draft.code || current.trade !== draft.trade || current.completion_mode !== draft.completionMode))
    throw quantityProblem('validation-failed', '已有阶段的稳定编码、工种和完成模式不能改写，请另建阶段')
  const [duplicate] = await db.select<{ id: string }>('SELECT id FROM construction_stages WHERE project_id = ? AND code = ? AND deleted_at IS NULL AND id <> ? LIMIT 1', [projectId, draft.code, current?.id ?? ''])
  if (duplicate)
    throw quantityProblem('validation-failed', `阶段编码「${draft.code}」已存在`)
  const id = current?.id ?? generateId('quantity_stage')
  const previous = await db.select<MappingRow>('SELECT * FROM construction_stage_items WHERE stage_id = ? AND deleted_at IS NULL', [id])
  for (const mapping of previous) {
    if (draft.itemIds.includes(mapping.item_id))
      continue
    const [visible] = await db.select<{ id: string }>(selectVisibleSql('construction_stage_items', 'AND id = ?'), [mapping.id])
    if (!visible)
      throw quantityProblem('conflict', '阶段仍有关联但当前不可见的分项，请先核对或恢复来源后再修改')
  }
  if (current) {
    const logId = await withUpdateLog(db, 'construction_stages', id, () => db.execute('UPDATE construction_stages SET name = ?, sort_order = ?, updated_at = datetime(\'now\') WHERE id = ?', [draft.name, draft.sortOrder, id]))
    if (logId)
      logIds.push(logId)
  }
  else {
    await db.execute('INSERT INTO construction_stages (id, project_id, code, name, trade, completion_mode, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, projectId, draft.code, draft.name, draft.trade, draft.completionMode, draft.sortOrder])
    const logId = await logCreate(db, 'construction_stages', id)
    if (logId)
      logIds.push(logId)
  }
  for (const mapping of previous) {
    if (draft.itemIds.includes(mapping.item_id))
      continue
    const logId = await withUpdateLog(db, 'construction_stage_items', mapping.id, () => db.execute('UPDATE construction_stage_items SET deleted_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?', [mapping.id]))
    if (logId)
      logIds.push(logId)
  }
  for (const itemId of draft.itemIds) {
    if (previous.some(mapping => mapping.item_id === itemId))
      continue
    const mappingId = generateId('quantity_stage_item')
    await db.execute('INSERT INTO construction_stage_items (id, stage_id, item_id, is_reporting_stage) VALUES (?, ?, ?, 0)', [mappingId, id, itemId])
    const logId = await logCreate(db, 'construction_stage_items', mappingId)
    if (logId)
      logIds.push(logId)
  }
  return { id, logIds }
}

async function setReportingStage(db: TransactionDb, projectId: string, action: Extract<QuantityStageAction, { kind: 'set-reporting-stage' }>) {
  const logIds: string[] = []
  const active = await db.select<MappingRow>('SELECT * FROM construction_stage_items WHERE item_id = ? AND is_reporting_stage = 1 AND deleted_at IS NULL', [action.itemId])
  for (const mapping of active) {
    // 祖先隐藏仍可能占有物理唯一键；不能静默替换用户当前不可见的旧身份。
    const [visible] = await db.select<{ id: string }>(selectVisibleSql('construction_stage_items', 'AND id = ?'), [mapping.id])
    if (!visible)
      throw quantityProblem('conflict', '该分项存在当前不可见的报量映射，请先核对或恢复原阶段')
    await stage(db, projectId, mapping.stage_id)
    if (mapping.stage_id === action.stageId)
      return { id: action.itemId, logIds }
    const logId = await withUpdateLog(db, 'construction_stage_items', mapping.id, () => db.execute('UPDATE construction_stage_items SET is_reporting_stage = 0, updated_at = datetime(\'now\') WHERE id = ?', [mapping.id]))
    if (logId)
      logIds.push(logId)
  }
  if (action.stageId !== null) {
    const [mapping] = await db.select<MappingRow>(selectVisibleSql('construction_stage_items', 'AND stage_id = ? AND item_id = ?'), [action.stageId, action.itemId])
    if (!mapping)
      throw quantityProblem('relationship-mismatch', '报量阶段映射已失效，请重新读取')
    const logId = await withUpdateLog(db, 'construction_stage_items', mapping.id, () => db.execute('UPDATE construction_stage_items SET is_reporting_stage = 1, updated_at = datetime(\'now\') WHERE id = ?', [mapping.id]))
    if (logId)
      logIds.push(logId)
  }
  return { id: action.itemId, logIds }
}

/** 调用方持有同一 quantity command 事务；此处不单独提交或推进中央版本。 */
export async function persistQuantityStageAction(db: TransactionDb, projectId: string, action: QuantityStageAction): Promise<{ id: string, logIds: string[] }> {
  await validateQuantityStageParent(db, projectId, action)
  return action.kind === 'save-stage' ? saveStage(db, projectId, action.draft) : setReportingStage(db, projectId, action)
}
