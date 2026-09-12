import type { QuantityAssigneeKind, QuantityCompletionStatus } from './read-model'
import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtes, hiddenCtesFor, logCreate, selectVisibleSql, visibleCond, withUpdateLog } from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'

export interface QuantityCompletionUnit {
  id: string
  code: string
  name: string
  floorId: string
  floorName: string
  buildingId: string
  buildingName: string
  templateId: string
}

export interface QuantityCompletionAssignment {
  id: string
  assigneeKind: QuantityAssigneeKind
  assigneeId: string
  assigneeName: string
  /** 当前主数据仍可用；历史审计身份可保留但不能据此新登记完成。 */
  available: boolean
  note: string
}

export interface QuantityCompletionQuantityLine {
  roomId: string
  roomName: string
  itemId: string
  itemName: string
  unit: string
  recognizedContractQty: number | null
  contractQty: number | null
  provisionalQty: number | null
  fieldQty: number | null
}

export interface QuantityCompletionPhoto {
  id: string
  fileName: string
  mimeType: string
  fileSize: number
}

export interface QuantityCompletionFact {
  id: string
  status: QuantityCompletionStatus
  completedAt: string | null
  note: string
  assignmentId: string | null
  executionAssigneeName: string
  fingerprint: string
}

export type QuantityCompletionWarningCode = 'prior-incomplete' | 'prior-photo-missing'

export interface QuantityCompletionWarning {
  code: QuantityCompletionWarningCode
  stageId: string
  stageName: string
}

export interface QuantityCompletionStageView {
  id: string
  code: string
  name: string
  trade: string
  sortOrder: number
  currentAssignment: QuantityCompletionAssignment | null
  quantities: readonly QuantityCompletionQuantityLine[]
  completion: QuantityCompletionFact | null
  photos: readonly QuantityCompletionPhoto[]
  warnings: readonly QuantityCompletionWarning[]
}

export interface QuantityCompletionWorkspace {
  projectId: string
  matrixArchivedAt: string | null
  unit: QuantityCompletionUnit
  /** 计划区间读 seam：#114 排程落地前恒为 null，页面按“未排期”展示。 */
  planWindow: { plannedStartAt: string, plannedEndAt: string } | null
  stages: readonly QuantityCompletionStageView[]
}

export interface QuantityCompletionPhotoDraft {
  fileName: string
  mimeType: string
  fileSize: number
  contentBase64: string
}

export interface QuantityCompletionDraft {
  projectId: string
  unitId: string
  stageId: string
  status: QuantityCompletionStatus
  completedAt: string | null
  note: string
  expectedCompletionId: string | null
  expectedCompletionFingerprint: string | null
  expectedAssignmentId: string | null
  photos: QuantityCompletionPhotoDraft[]
  allowArchivedEdit?: boolean
  /** 历史迁移导入专用：跳过缺照片软卡（ADR 0010 §24 交互软卡不适用于旧数据回填）；UI 不暴露。 */
  allowMissingPhotos?: boolean
}

export interface QuantityCompletionWriteResult {
  completionId: string
  status: QuantityCompletionStatus
  created: boolean
  changed: boolean
  photoIds: string[]
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
  floor_id: string
  floor_name: string
  building_id: string
  building_name: string
  template_id: string
}

interface StageRow {
  id: string
  code: string
  name: string
  trade: string
  sort_order: number
}

interface PlanWindowRow {
  planned_start: string | null
  planned_finish: string | null
}

interface AssignmentRow {
  id: string
  trade: string
  crew_id: string | null
  worker_id: string | null
  crew_name: string | null
  worker_name: string | null
  note: string | null
}

interface QuantityLineRow {
  stage_id: string
  room_id: string
  room_name: string
  item_id: string
  item_name: string
  unit: string | null
  recognized_contract_qty: number | null
  contract_qty: number | null
  provisional_qty: number | null
  field_qty: number | null
}

interface CompletionRow {
  id: string
  stage_id: string
  assignment_id: string | null
  crew_name: string | null
  worker_name: string | null
  status: QuantityCompletionStatus
  completed_at: string | null
  note: string | null
}

interface PhotoRow {
  id: string
  completion_id: string
  file_name: string
  mime_type: string
  file_size: number
}

function nullableNumber(value: unknown): number | null {
  if (value == null)
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function strictLog(logId: string | null, message: string): string {
  if (!logId)
    throw new Error(message)
  return logId
}

export function quantityCompletionFingerprint(fact: {
  status: QuantityCompletionStatus
  completedAt: string | null
  note: string
  assignmentId: string | null
  photoIds: readonly string[]
}): string {
  return JSON.stringify({
    status: fact.status,
    completedAt: fact.completedAt,
    note: fact.note,
    assignmentId: fact.assignmentId,
    photoIds: [...fact.photoIds].sort(),
  })
}

export async function loadQuantityCompletionWorkspace(
  db: SoftDb,
  projectId: string,
  unitId: string,
): Promise<QuantityCompletionWorkspace> {
  const [project] = await db.select<ProjectRow>(
    `${selectVisibleSql('projects')} AND id = ?`,
    [projectId],
  )
  if (!project)
    throw new Error('工程量项目不存在或已删除')

  const [unit] = await db.select<UnitRow>(
    `${hiddenCtes('units')}
     SELECT u.id,
            u.code,
            u.name,
            f.id AS floor_id,
            f.name AS floor_name,
            b.id AS building_id,
            b.name AS building_name,
            u.house_type_template_id AS template_id
     FROM units u
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN house_type_templates ht ON ht.id = u.house_type_template_id
     WHERE ${visibleCond('units', 'u')}
       AND u.id = ?
       AND b.project_id = ?
       AND ht.project_id = ?`,
    [unitId, projectId, projectId],
  )
  if (!unit)
    throw new Error('户不存在、已删除或不属于当前项目')

  const [planWindowRow] = await db.select<PlanWindowRow>(
    `${hiddenCtesFor('schedule_group_buildings', 'schedule_tasks')}
     SELECT MIN(st.planned_start) AS planned_start,
            MAX(st.planned_finish) AS planned_finish
     FROM schedule_group_buildings sgb
     JOIN schedule_groups sg ON sg.id = sgb.group_id
     JOIN schedule_tasks st ON st.group_id = sg.id
     WHERE ${visibleCond('schedule_group_buildings', 'sgb')}
       AND ${visibleCond('schedule_tasks', 'st')}
       AND sgb.building_id = ?
       AND sg.project_id = ?
       AND st.project_id = ?`,
    [unit.building_id, projectId, projectId],
  )
  const planWindow = planWindowRow?.planned_start && planWindowRow.planned_finish
    ? {
        plannedStartAt: planWindowRow.planned_start,
        plannedEndAt: planWindowRow.planned_finish,
      }
    : null

  const stageRows = await db.select<StageRow>(
    selectVisibleSql('construction_stages', `AND project_id = ? AND completion_mode = 'unit' ORDER BY sort_order, code, id`),
    [projectId],
  )

  // 当前责任按 assignment 自身 active 状态读取；责任人显示口径与责任配置页一致。
  const assignmentRows = await db.select<AssignmentRow>(
    `SELECT ua.id,
            ua.trade,
            ua.crew_id,
            ua.worker_id,
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
            END AS worker_name,
            ua.note
     FROM unit_assignments ua
     LEFT JOIN crews c ON c.id = ua.crew_id
     LEFT JOIN workers w ON w.id = ua.worker_id
     LEFT JOIN crews wc ON wc.id = w.crew_id
     WHERE ua.deleted_at IS NULL AND ua.unit_id = ?
     ORDER BY ua.trade, ua.created_at, ua.id`,
    [unitId],
  )
  const assignmentByTrade = new Map<string, QuantityCompletionAssignment>()
  for (const row of assignmentRows) {
    const assignee = row.crew_id
      ? { kind: 'crew' as const, id: row.crew_id, name: row.crew_name || '已删除班组' }
      : { kind: 'worker' as const, id: row.worker_id ?? '', name: row.worker_name || '已删除工人' }
    assignmentByTrade.set(row.trade, {
      id: row.id,
      assigneeKind: assignee.kind,
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      available: row.crew_id ? row.crew_name !== null : row.worker_name !== null,
      note: row.note ?? '',
    })
  }

  // 活链接：三量永远读该户挂靠模板的当前明细，不读快照。
  const quantityRows = await db.select<QuantityLineRow>(
    `${hiddenCtes('house_type_template_items')}
     SELECT csi.stage_id,
            r.id AS room_id,
            r.name AS room_name,
            i.id AS item_id,
            i.name AS item_name,
            i.unit,
            hti.recognized_contract_qty,
            hti.contract_qty,
            hti.provisional_qty,
            hti.field_qty
     FROM construction_stage_items csi
     JOIN items i ON i.id = csi.item_id
     JOIN house_type_template_items hti ON hti.item_id = csi.item_id
     JOIN rooms r ON r.id = hti.room_id
     WHERE csi.deleted_at IS NULL
       AND ${visibleCond('house_type_template_items', 'hti')}
       AND r.template_id = ?
       AND i.project_id = ?
     ORDER BY r.sort_order, r.code, i.sort_order, i.code, hti.id`,
    [unit.template_id, projectId],
  )
  const quantitiesByStage = new Map<string, QuantityCompletionQuantityLine[]>()
  for (const row of quantityRows) {
    const lines = quantitiesByStage.get(row.stage_id) ?? []
    lines.push({
      roomId: row.room_id,
      roomName: row.room_name,
      itemId: row.item_id,
      itemName: row.item_name,
      unit: row.unit ?? '',
      recognizedContractQty: nullableNumber(row.recognized_contract_qty),
      contractQty: nullableNumber(row.contract_qty),
      provisionalQty: nullableNumber(row.provisional_qty),
      fieldQty: nullableNumber(row.field_qty),
    })
    quantitiesByStage.set(row.stage_id, lines)
  }

  // assignment_id 是“完成时执行责任”的审计引用：物理 JOIN 已软删 assignment/crew/worker，
  // 责任替换或软删后历史时间线仍显示当时身份，不得改用可见性过滤（见 ADR 0010）。
  const completionRows = await db.select<CompletionRow>(
    `${hiddenCtes('unit_stage_completions')}
     SELECT usc.id,
            usc.stage_id,
            usc.assignment_id,
            c.name AS crew_name,
            w.name AS worker_name,
            usc.status,
            usc.completed_at,
            usc.note
     FROM unit_stage_completions usc
     LEFT JOIN unit_assignments audit ON audit.id = usc.assignment_id
     LEFT JOIN crews c ON c.id = audit.crew_id
     LEFT JOIN workers w ON w.id = audit.worker_id
     WHERE ${visibleCond('unit_stage_completions', 'usc')}
       AND usc.unit_id = ?`,
    [unitId],
  )

  // 验收照片必须随可见完成事实读取：owner_type/category 精确匹配 + 完成事实可见性，
  // 不能仅按 owner_id 裸读（防多态 owner 撞 id、防已隐藏完成事实的照片泄漏）。
  const photoRows = await db.select<PhotoRow>(
    `${hiddenCtes('unit_stage_completions')}
     SELECT fr.id,
            fr.owner_id AS completion_id,
            fr.file_name,
            fr.mime_type,
            fr.file_size
     FROM file_refs fr
     JOIN unit_stage_completions usc ON usc.id = fr.owner_id
     WHERE fr.owner_type = 'unit_stage_completion'
       AND fr.category = 'acceptance_photo'
       AND fr.deleted_at IS NULL
       AND ${visibleCond('unit_stage_completions', 'usc')}
       AND usc.unit_id = ?
     ORDER BY fr.uploaded_at, fr.id`,
    [unitId],
  )
  const photosByCompletion = new Map<string, QuantityCompletionPhoto[]>()
  for (const row of photoRows) {
    const photos = photosByCompletion.get(row.completion_id) ?? []
    photos.push({
      id: row.id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSize: Number(row.file_size) || 0,
    })
    photosByCompletion.set(row.completion_id, photos)
  }

  const completionByStage = new Map<string, QuantityCompletionFact>()
  for (const row of completionRows) {
    const note = row.note ?? ''
    const photoIds = (photosByCompletion.get(row.id) ?? []).map(photo => photo.id)
    completionByStage.set(row.stage_id, {
      id: row.id,
      status: row.status,
      completedAt: row.completed_at,
      note,
      assignmentId: row.assignment_id,
      executionAssigneeName: row.crew_name || row.worker_name || '未记录执行责任',
      fingerprint: quantityCompletionFingerprint({
        status: row.status,
        completedAt: row.completed_at,
        note,
        assignmentId: row.assignment_id,
        photoIds,
      }),
    })
  }

  const stages: QuantityCompletionStageView[] = []
  for (const row of stageRows) {
    const completion = completionByStage.get(row.id) ?? null
    const quantities = quantitiesByStage.get(row.id) ?? []
    // 新登记只暴露该户型确有可见量明细的阶段；既有历史事实即使模板后来调整仍保留只读/修正入口。
    if (!quantities.length && !completion)
      continue
    stages.push({
      id: row.id,
      code: row.code,
      name: row.name,
      trade: row.trade,
      sortOrder: Number(row.sort_order) || 0,
      currentAssignment: assignmentByTrade.get(row.trade) ?? null,
      quantities,
      completion,
      photos: completion ? photosByCompletion.get(completion.id) ?? [] : [],
      warnings: [],
    })
  }

  // 风险软提示（蓝本§四）：同工种紧邻的上一阶段未完成 / 已完成但缺可见照片，
  // 只提示不硬锁——写入路径不消费 warnings。
  const previousByTrade = new Map<string, QuantityCompletionStageView>()
  for (const stage of stages) {
    const prior = previousByTrade.get(stage.trade)
    if (prior) {
      const warnings: QuantityCompletionWarning[] = []
      if (prior.completion?.status !== 'completed')
        warnings.push({ code: 'prior-incomplete', stageId: prior.id, stageName: prior.name })
      else if (!prior.photos.length)
        warnings.push({ code: 'prior-photo-missing', stageId: prior.id, stageName: prior.name })
      stage.warnings = warnings
    }
    previousByTrade.set(stage.trade, stage)
  }

  return {
    projectId,
    matrixArchivedAt: project.matrix_archived_at,
    unit: {
      id: unit.id,
      code: unit.code,
      name: unit.name || `${unit.code}户`,
      floorId: unit.floor_id,
      floorName: unit.floor_name,
      buildingId: unit.building_id,
      buildingName: unit.building_name,
      templateId: unit.template_id,
    },
    planWindow,
    stages,
  }
}

/**
 * 惰性读取验收照片正文（file_payloads 独立存放，列表只带元数据）。
 * 仍按可见口径校验 file_ref 与所属完成事实：任一方或业务祖先隐藏后都不提供正文。
 */
export async function loadQuantityPhotoDataUrl(db: SoftDb, photoId: string): Promise<string> {
  const [row] = await db.select<{ mime_type: string, encoding: string, content: string }>(
    `${hiddenCtes('unit_stage_completions')}
     SELECT fr.mime_type, fp.encoding, fp.content
     FROM file_refs fr
     JOIN file_payloads fp ON fp.file_ref_id = fr.id
     JOIN unit_stage_completions usc ON usc.id = fr.owner_id
     WHERE fr.id = ?
       AND fr.owner_type = 'unit_stage_completion'
       AND fr.category = 'acceptance_photo'
       AND fr.deleted_at IS NULL
       AND ${visibleCond('unit_stage_completions', 'usc')}`,
    [photoId],
  )
  if (!row)
    throw new Error('验收照片不存在或已删除')
  if (row.encoding !== 'base64')
    throw new Error('验收照片编码不受支持')
  return `data:${row.mime_type || 'image/jpeg'};base64,${row.content}`
}

export async function persistQuantityStageCompletion(
  db: SoftDb,
  draft: QuantityCompletionDraft,
  options: { uploader?: string } = {},
): Promise<QuantityCompletionWriteResult> {
  const projectId = draft.projectId.trim()
  const unitId = draft.unitId.trim()
  const stageId = draft.stageId.trim()
  if (!projectId || !unitId || !stageId)
    throw new Error('请选择项目、户和工序阶段')
  if (draft.status !== 'draft' && draft.status !== 'completed')
    throw new Error('完成状态无效')
  for (const photo of draft.photos) {
    if (!photo.fileName.trim() || !photo.contentBase64)
      throw new Error('验收照片内容无效')
  }

  // 在同一 transaction 内重新加载并校验全部事实，确认弹窗与真正提交之间不会 TOCTOU 覆盖。
  const workspace = await loadQuantityCompletionWorkspace(db, projectId, unitId)
  const stage = workspace.stages.find(candidate => candidate.id === stageId)
  if (!stage)
    throw new Error('工序阶段不属于当前项目或不支持按户完成')

  const current = stage.completion
  if ((current?.id ?? null) !== draft.expectedCompletionId)
    throw new Error('该阶段的完成事实已发生变化，请重新加载后再提交')
  if ((current?.fingerprint ?? null) !== draft.expectedCompletionFingerprint)
    throw new Error('该阶段的完成事实已发生变化，请重新加载后再提交')
  if ((stage.currentAssignment?.id ?? null) !== draft.expectedAssignmentId)
    throw new Error('该户当前责任已发生变化，请重新加载后再提交')

  const note = draft.note.trim()
  const completedAt = draft.completedAt?.trim() || null
  // 已完成事实冻结完成时责任；责任替换后的日期/备注修正不得把审计引用改成当前责任。
  // 草稿首次转完成时才绑定提交当下的 active assignment。
  const assignmentId = current?.status === 'completed'
    ? current.assignmentId
    : stage.currentAssignment?.id ?? null
  if (draft.status === 'completed') {
    if (!completedAt)
      throw new Error('请填写完成日期')
    if (!assignmentId)
      throw new Error('该户当前工种还没有责任人，请先在责任配置中指派')
    if (current?.status !== 'completed' && !stage.currentAssignment?.available)
      throw new Error('该户当前责任人已不可用，请先在责任配置中重新指派')
    if (!draft.photos.length && !stage.photos.length && !draft.allowMissingPhotos)
      throw new Error('缺少验收照片：请补拍上传，或保存到草稿')
  }

  const unchanged = current
    && current.status === draft.status
    && current.completedAt === completedAt
    && current.note === note
    && current.assignmentId === assignmentId
    && !draft.photos.length
  if (unchanged) {
    return {
      completionId: current.id,
      status: current.status,
      created: false,
      changed: false,
      photoIds: [],
      logIds: [],
    }
  }

  if (workspace.matrixArchivedAt && !draft.allowArchivedEdit)
    throw new Error('工程量矩阵已归档，请二次确认后再修改完成事实')

  const now = new Date().toISOString()
  const logIds: string[] = []
  let completionId: string
  if (current) {
    completionId = current.id
    logIds.push(strictLog(
      await withUpdateLog(db, 'unit_stage_completions', completionId, async () => {
        await db.execute(
          `UPDATE unit_stage_completions
           SET status = ?, completed_at = ?, note = ?, assignment_id = ?, updated_at = ?
           WHERE id = ?`,
          [draft.status, completedAt, note || null, assignmentId, now, completionId],
        )
      }),
      '完成事实未能更新并记录操作日志',
    ))
  }
  else {
    completionId = generateId('qty_done')
    await db.execute(
      `INSERT INTO unit_stage_completions
        (id, unit_id, stage_id, assignment_id, status, completed_at, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [completionId, unitId, stageId, assignmentId, draft.status, completedAt, note || null, now, now],
    )
    logIds.push(strictLog(
      await logCreate(db, 'unit_stage_completions', completionId),
      '完成事实未能记录操作日志',
    ))
  }

  const photoIds: string[] = []
  for (const photo of draft.photos) {
    const photoId = generateId('file')
    await db.execute(
      `INSERT INTO file_refs
        (id, owner_type, owner_id, file_name, file_path, file_size, category, uploader, uploaded_at, mime_type)
       VALUES (?, 'unit_stage_completion', ?, ?, '', ?, 'acceptance_photo', ?, ?, ?)`,
      [photoId, completionId, photo.fileName.trim(), photo.fileSize, options.uploader ?? '', now, photo.mimeType],
    )
    logIds.push(strictLog(
      await logCreate(db, 'file_refs', photoId),
      '验收照片未能记录操作日志',
    ))
    // 正文独立存放（v10 file_payloads），不进通用软删快照。
    await db.execute(
      `INSERT INTO file_payloads (file_ref_id, encoding, content) VALUES (?, 'base64', ?)`,
      [photoId, photo.contentBase64],
    )
    photoIds.push(photoId)
  }

  return {
    completionId,
    status: draft.status,
    created: !current,
    changed: true,
    photoIds,
    logIds,
  }
}
