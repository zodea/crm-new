import type { QuantityCompletionStatus } from './read-model'
import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtes, selectVisibleSql, visibleCond } from '~/lib/db/soft-delete'
import { persistQuantityStageCompletion, quantityCompletionFingerprint } from './completion'

export type QuantityBatchDraftReason = 'missing-photo' | 'missing-assignment'

export interface QuantityBatchCompletionItem {
  unitId: string
  unitName: string
  floorName: string
  stageId: string
  stageName: string
  trade: string
  stageSortOrder: number
  currentStatus: QuantityCompletionStatus | null
  currentCompletedAt: string | null
  hasPhotos: boolean
  assigneeName: string | null
  expectedCompletionId: string | null
  expectedCompletionFingerprint: string | null
  expectedAssignmentId: string | null
  /** 提交时的目标结果预告：有照片且有责任才允许 completed，否则按软卡降级草稿。 */
  projectedStatus: QuantityCompletionStatus
  projectedReason: QuantityBatchDraftReason | null
}

export interface QuantityBatchCompletionPlan {
  projectId: string
  trade: string
  matrixArchivedAt: string | null
  items: readonly QuantityBatchCompletionItem[]
}

export interface QuantityBatchCompletionDraftItem {
  unitId: string
  stageId: string
  expectedCompletionId: string | null
  expectedCompletionFingerprint: string | null
  expectedAssignmentId: string | null
}

export interface QuantityBatchCompletionDraft {
  projectId: string
  trade: string
  completedAt: string
  note: string
  items: QuantityBatchCompletionDraftItem[]
  allowArchivedEdit?: boolean
}

export interface QuantityBatchCompletionResultItem {
  unitId: string
  unitName: string
  stageId: string
  stageName: string
  completionId: string
  reason: QuantityBatchDraftReason | null
}

export interface QuantityBatchCompletionResult {
  completed: QuantityBatchCompletionResultItem[]
  drafted: QuantityBatchCompletionResultItem[]
  unchanged: QuantityBatchCompletionResultItem[]
  logIds: string[]
}

interface ProjectRow {
  id: string
  matrix_archived_at: string | null
}

interface UnitRow {
  id: string
  code: string
  name: string | null
  floor_name: string
  template_id: string
  sort_order: number
}

interface StageRow {
  id: string
  name: string
  trade: string
  sort_order: number
}

interface ApplicabilityRow {
  stage_id: string
  template_id: string
}

interface AssignmentRow {
  id: string
  unit_id: string
  crew_name: string | null
  worker_name: string | null
}

interface CompletionRow {
  id: string
  unit_id: string
  stage_id: string
  assignment_id: string | null
  status: QuantityCompletionStatus
  completed_at: string | null
  note: string | null
}

interface PhotoRow {
  id: string
  completion_id: string
}

function placeholders(count: number): string {
  return Array.from({ length: count }).fill('?').join(', ')
}

export async function loadQuantityBatchCompletionPlan(
  db: SoftDb,
  projectId: string,
  input: { trade: string, unitIds: string[] },
): Promise<QuantityBatchCompletionPlan> {
  const trade = input.trade.trim()
  if (!trade)
    throw new Error('请选择工种')
  const unitIds = [...input.unitIds]
  if (!unitIds.length)
    throw new Error('请至少选择一户')
  if (new Set(unitIds).size !== unitIds.length)
    throw new Error('同一户不能在批次中重复')

  const [project] = await db.select<ProjectRow>(
    `${selectVisibleSql('projects')} AND id = ?`,
    [projectId],
  )
  if (!project)
    throw new Error('工程量项目不存在或已删除')

  const unitRows = await db.select<UnitRow>(
    `${hiddenCtes('units')}
     SELECT u.id,
            u.code,
            u.name,
            f.name AS floor_name,
            u.house_type_template_id AS template_id,
            u.sort_order
     FROM units u
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN house_type_templates ht ON ht.id = u.house_type_template_id
     WHERE ${visibleCond('units', 'u')}
       AND u.id IN (${placeholders(unitIds.length)})
       AND b.project_id = ?
       AND ht.project_id = ?
     ORDER BY f.sort_order, f.code, u.sort_order, u.code, u.id`,
    [...unitIds, projectId, projectId],
  )
  if (unitRows.length !== unitIds.length)
    throw new Error('所选户不属于当前项目或已删除')

  const stageRows = await db.select<StageRow>(
    selectVisibleSql('construction_stages', `AND project_id = ? AND trade = ? AND completion_mode = 'unit' ORDER BY sort_order, code, id`),
    [projectId, trade],
  )
  if (!stageRows.length)
    throw new Error('当前工种没有按户完成的工序阶段')
  const stageIds = stageRows.map(row => row.id)

  // 适用性 = 该阶段任一分项在该户挂靠模板中有可见量明细；模板没有的阶段不进批次。
  const templateIds = [...new Set(unitRows.map(row => row.template_id))]
  const applicabilityRows = await db.select<ApplicabilityRow>(
    `${hiddenCtes('house_type_template_items')}
     SELECT DISTINCT csi.stage_id, r.template_id
     FROM construction_stage_items csi
     JOIN house_type_template_items hti ON hti.item_id = csi.item_id
     JOIN rooms r ON r.id = hti.room_id
     WHERE csi.deleted_at IS NULL
       AND ${visibleCond('house_type_template_items', 'hti')}
       AND csi.stage_id IN (${placeholders(stageIds.length)})
       AND r.template_id IN (${placeholders(templateIds.length)})`,
    [...stageIds, ...templateIds],
  )
  const applicable = new Set(applicabilityRows.map(row => `${row.stage_id} ${row.template_id}`))

  const assignmentRows = await db.select<AssignmentRow>(
    `SELECT ua.id,
            ua.unit_id,
            CASE
              WHEN c.id IS NOT NULL AND c.deleted_at IS NULL THEN c.name
              ELSE NULL
            END AS crew_name,
            CASE
              WHEN w.id IS NOT NULL
               AND w.deleted_at IS NULL
               AND (w.crew_id IS NULL OR (wc.id IS NOT NULL AND wc.deleted_at IS NULL))
              THEN w.name
              ELSE NULL
            END AS worker_name
     FROM unit_assignments ua
     LEFT JOIN crews c ON c.id = ua.crew_id
     LEFT JOIN workers w ON w.id = ua.worker_id
     LEFT JOIN crews wc ON wc.id = w.crew_id
     WHERE ua.deleted_at IS NULL
       AND ua.trade = ?
       AND ua.unit_id IN (${placeholders(unitIds.length)})`,
    [trade, ...unitIds],
  )
  const assignmentByUnit = new Map(assignmentRows.map(row => [row.unit_id, row]))

  const completionRows = await db.select<CompletionRow>(
    `${hiddenCtes('unit_stage_completions')}
     SELECT usc.id, usc.unit_id, usc.stage_id, usc.assignment_id, usc.status, usc.completed_at, usc.note
     FROM unit_stage_completions usc
     WHERE ${visibleCond('unit_stage_completions', 'usc')}
       AND usc.unit_id IN (${placeholders(unitIds.length)})
       AND usc.stage_id IN (${placeholders(stageIds.length)})`,
    [...unitIds, ...stageIds],
  )
  const completionIds = completionRows.map(row => row.id)
  const photoRows = completionIds.length
    ? await db.select<PhotoRow>(
        `SELECT fr.id, fr.owner_id AS completion_id
         FROM file_refs fr
         WHERE fr.owner_type = 'unit_stage_completion'
           AND fr.category = 'acceptance_photo'
           AND fr.deleted_at IS NULL
           AND fr.owner_id IN (${placeholders(completionIds.length)})`,
        completionIds,
      )
    : []
  const photoIdsByCompletion = new Map<string, string[]>()
  for (const row of photoRows) {
    const ids = photoIdsByCompletion.get(row.completion_id) ?? []
    ids.push(row.id)
    photoIdsByCompletion.set(row.completion_id, ids)
  }
  const completionByKey = new Map(completionRows.map(row => [`${row.unit_id} ${row.stage_id}`, row]))

  const items: QuantityBatchCompletionItem[] = []
  for (const unit of unitRows) {
    const assignment = assignmentByUnit.get(unit.id) ?? null
    const assigneeName = assignment
      ? assignment.crew_name || assignment.worker_name || '已删除责任人'
      : null
    for (const stage of stageRows) {
      if (!applicable.has(`${stage.id} ${unit.template_id}`))
        continue
      const completion = completionByKey.get(`${unit.id} ${stage.id}`) ?? null
      const photoIds = completion ? photoIdsByCompletion.get(completion.id) ?? [] : []
      const hasExecutionAssignment = completion?.status === 'completed' && !!completion.assignment_id
      const hasCurrentAssignment = !!assignment && (assignment.crew_name !== null || assignment.worker_name !== null)
      const projectedReason: QuantityBatchDraftReason | null = !hasExecutionAssignment && !hasCurrentAssignment
        ? 'missing-assignment'
        : photoIds.length ? null : 'missing-photo'
      items.push({
        unitId: unit.id,
        unitName: unit.name || `${unit.code}户`,
        floorName: unit.floor_name,
        stageId: stage.id,
        stageName: stage.name,
        trade: stage.trade,
        stageSortOrder: Number(stage.sort_order) || 0,
        currentStatus: completion?.status ?? null,
        currentCompletedAt: completion?.completed_at ?? null,
        hasPhotos: photoIds.length > 0,
        assigneeName,
        expectedCompletionId: completion?.id ?? null,
        expectedCompletionFingerprint: completion
          ? quantityCompletionFingerprint({
              status: completion.status,
              completedAt: completion.completed_at,
              note: completion.note ?? '',
              assignmentId: completion.assignment_id,
              photoIds,
            })
          : null,
        expectedAssignmentId: assignment?.id ?? null,
        projectedStatus: projectedReason ? 'draft' : 'completed',
        projectedReason,
      })
    }
  }

  return {
    projectId,
    trade,
    matrixArchivedAt: project.matrix_archived_at,
    items,
  }
}

export async function persistQuantityBatchCompletion(
  db: SoftDb,
  draft: QuantityBatchCompletionDraft,
): Promise<QuantityBatchCompletionResult> {
  const completedAt = draft.completedAt.trim()
  if (!completedAt)
    throw new Error('请填写完成日期')
  if (!draft.items.length)
    throw new Error('请至少选择一个户×阶段')
  const keys = draft.items.map(item => `${item.unitId} ${item.stageId}`)
  if (new Set(keys).size !== keys.length)
    throw new Error('同一户×阶段不能在批次中重复')

  // 在同一 transaction 内重新展开计划：既校验 expected 防 TOCTOU，也用最新照片/责任重算目标状态。
  const plan = await loadQuantityBatchCompletionPlan(db, draft.projectId, {
    trade: draft.trade,
    unitIds: [...new Set(draft.items.map(item => item.unitId))],
  })
  const planByKey = new Map(plan.items.map(item => [`${item.unitId} ${item.stageId}`, item]))

  const targets: QuantityBatchCompletionItem[] = []
  for (const item of draft.items) {
    const planned = planByKey.get(`${item.unitId} ${item.stageId}`)
    if (!planned)
      throw new Error('批次包含不适用的户×阶段，请重新展开后再提交')
    if (
      planned.expectedCompletionId !== item.expectedCompletionId
      || planned.expectedCompletionFingerprint !== item.expectedCompletionFingerprint
      || planned.expectedAssignmentId !== item.expectedAssignmentId
    ) {
      throw new Error('部分户×阶段的完成事实已发生变化，请重新展开后再提交')
    }
    targets.push(planned)
  }

  const result: QuantityBatchCompletionResult = {
    completed: [],
    drafted: [],
    unchanged: [],
    logIds: [],
  }
  for (const target of targets) {
    // 唯一写路径：逐阶段复用单条完成写入（含归档授权、执行责任审计与操作日志）。
    const single = await persistQuantityStageCompletion(db, {
      projectId: draft.projectId,
      unitId: target.unitId,
      stageId: target.stageId,
      status: target.projectedStatus,
      completedAt,
      note: draft.note,
      expectedCompletionId: target.expectedCompletionId,
      expectedCompletionFingerprint: target.expectedCompletionFingerprint,
      expectedAssignmentId: target.expectedAssignmentId,
      photos: [],
      allowArchivedEdit: draft.allowArchivedEdit,
    })
    const resultItem: QuantityBatchCompletionResultItem = {
      unitId: target.unitId,
      unitName: target.unitName,
      stageId: target.stageId,
      stageName: target.stageName,
      completionId: single.completionId,
      reason: target.projectedReason,
    }
    result.logIds.push(...single.logIds)
    if (!single.changed)
      result.unchanged.push(resultItem)
    else if (single.status === 'completed')
      result.completed.push(resultItem)
    else
      result.drafted.push(resultItem)
  }
  return result
}
