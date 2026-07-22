// 工程量统一派生读 seam（ADR 0010 / #103）：阶段进度、施工记录、月度完成量。
// 施工记录不落独立表；页面、工资预览、排程（#114/#117）都消费这里，不各自重算口径。
import type { QuantityCompletionStatus } from './read-model'
import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtes, hiddenCtesFor, selectVisibleSql, visibleCond } from '~/lib/db/soft-delete'

export interface QuantityStageProgress {
  stageId: string
  stageName: string
  trade: string
  sortOrder: number
  /** 应做户数：该阶段任一分项在该户挂靠模板中有可见量明细。 */
  applicableUnits: number
  completedUnits: number
  draftUnits: number
  /** 已完成 ÷ 应做；应做为 0 时为 0。 */
  completionRate: number
}

export interface QuantityConstructionRecord {
  completionId: string
  unitId: string
  unitName: string
  floorName: string
  buildingName: string
  stageId: string
  stageName: string
  trade: string
  stageSortOrder: number
  status: QuantityCompletionStatus
  completedAt: string | null
  note: string
  /** 完成时执行责任（审计引用，物理读已软删 assignment，不随责任替换漂移）。 */
  executionAssigneeName: string | null
  /** 该户该工种的当前责任（可见口径），与执行责任并列展示。 */
  currentAssigneeName: string | null
  photoCount: number
}

export interface QuantityConstructionRecordFilter {
  unitId?: string
  crewId?: string
  workerId?: string
}

export interface QuantityMonthlyOutput {
  month: string
  trade: string
  stageId: string
  stageName: string
  stageSortOrder: number
  completedUnits: number
  contractQty: number
  provisionalQty: number
  fieldQty: number
}

interface StageRow {
  id: string
  name: string
  trade: string
  sort_order: number
}

interface ApplicabilityRow {
  stage_id: string
  n: number
}

interface StatusCountRow {
  stage_id: string
  status: QuantityCompletionStatus
  n: number
}

interface RecordRow {
  id: string
  unit_id: string
  unit_code: string
  unit_name: string | null
  floor_name: string
  building_name: string
  stage_id: string
  stage_name: string
  trade: string
  stage_sort_order: number
  status: QuantityCompletionStatus
  completed_at: string | null
  note: string | null
  execution_crew_name: string | null
  execution_worker_name: string | null
  current_crew_name: string | null
  current_worker_name: string | null
  photo_count: number
}

interface MonthlyRow {
  month: string
  stage_id: string
  stage_name: string
  trade: string
  stage_sort_order: number
  completed_units: number
  contract_qty: number | null
  provisional_qty: number | null
  field_qty: number | null
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function loadQuantityStageProgress(db: SoftDb, projectId: string): Promise<QuantityStageProgress[]> {
  const stages = await db.select<StageRow>(
    selectVisibleSql('construction_stages', `AND project_id = ? AND completion_mode = 'unit' ORDER BY sort_order, code, id`),
    [projectId],
  )

  const applicability = await db.select<ApplicabilityRow>(
    `${hiddenCtesFor('construction_stage_items', 'house_type_template_items', 'units')}
     SELECT csi.stage_id, COUNT(DISTINCT u.id) AS n
     FROM construction_stage_items csi
     JOIN construction_stages s ON s.id = csi.stage_id
     JOIN house_type_template_items hti ON hti.item_id = csi.item_id
     JOIN rooms r ON r.id = hti.room_id
     JOIN units u ON u.house_type_template_id = r.template_id
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     WHERE ${visibleCond('construction_stage_items', 'csi')}
       AND ${visibleCond('house_type_template_items', 'hti')}
       AND s.project_id = ?
       AND ${visibleCond('units', 'u')}
       AND b.project_id = ?
     GROUP BY csi.stage_id`,
    [projectId, projectId],
  )
  const applicableByStage = new Map(applicability.map(row => [row.stage_id, numberValue(row.n)]))

  // 完成事实以事实为准：模板后删分项不隐藏历史完成，应做口径只影响分母。
  const statusCounts = await db.select<StatusCountRow>(
    `${hiddenCtes('unit_stage_completions')}
     SELECT usc.stage_id, usc.status, COUNT(*) AS n
     FROM unit_stage_completions usc
     JOIN construction_stages s ON s.id = usc.stage_id
     WHERE ${visibleCond('unit_stage_completions', 'usc')}
       AND s.project_id = ?
     GROUP BY usc.stage_id, usc.status`,
    [projectId],
  )
  const countByStage = new Map<string, { completed: number, draft: number }>()
  for (const row of statusCounts) {
    const bucket = countByStage.get(row.stage_id) ?? { completed: 0, draft: 0 }
    bucket[row.status] += numberValue(row.n)
    countByStage.set(row.stage_id, bucket)
  }

  return stages.map((stage) => {
    const applicableUnits = applicableByStage.get(stage.id) ?? 0
    const counts = countByStage.get(stage.id) ?? { completed: 0, draft: 0 }
    return {
      stageId: stage.id,
      stageName: stage.name,
      trade: stage.trade,
      sortOrder: numberValue(stage.sort_order),
      applicableUnits,
      completedUnits: counts.completed,
      draftUnits: counts.draft,
      completionRate: applicableUnits ? counts.completed / applicableUnits : 0,
    }
  })
}

export async function loadQuantityConstructionRecords(
  db: SoftDb,
  projectId: string,
  filter: QuantityConstructionRecordFilter = {},
): Promise<QuantityConstructionRecord[]> {
  const conditions: string[] = []
  const params: unknown[] = [projectId, projectId, projectId]
  if (filter.unitId) {
    conditions.push('AND usc.unit_id = ?')
    params.push(filter.unitId)
  }
  if (filter.crewId) {
    conditions.push('AND audit.crew_id = ?')
    params.push(filter.crewId)
  }
  if (filter.workerId) {
    conditions.push('AND audit.worker_id = ?')
    params.push(filter.workerId)
  }

  // 执行责任按审计引用物理 JOIN（含已软删 assignment）；当前责任按可见口径独立 JOIN。
  const rows = await db.select<RecordRow>(
    `${hiddenCtes('unit_stage_completions')}
     SELECT usc.id,
            usc.unit_id,
            u.code AS unit_code,
            u.name AS unit_name,
            f.name AS floor_name,
            b.name AS building_name,
            usc.stage_id,
            s.name AS stage_name,
            s.trade,
            s.sort_order AS stage_sort_order,
            usc.status,
            usc.completed_at,
            usc.note,
            ec.name AS execution_crew_name,
            ew.name AS execution_worker_name,
            CASE
              WHEN cc.id IS NOT NULL AND cc.deleted_at IS NULL THEN cc.name
              ELSE NULL
            END AS current_crew_name,
            CASE
              WHEN cw.id IS NOT NULL
               AND cw.deleted_at IS NULL
               AND (cw.crew_id IS NULL OR (cwc.id IS NOT NULL AND cwc.deleted_at IS NULL))
              THEN cw.name
              ELSE NULL
            END AS current_worker_name,
            (
              SELECT COUNT(*)
              FROM file_refs fr
              WHERE fr.owner_type = 'unit_stage_completion'
                AND fr.category = 'acceptance_photo'
                AND fr.deleted_at IS NULL
                AND fr.owner_id = usc.id
            ) AS photo_count
     FROM unit_stage_completions usc
     JOIN units u ON u.id = usc.unit_id
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN house_type_templates ht ON ht.id = u.house_type_template_id
     JOIN construction_stages s ON s.id = usc.stage_id
     LEFT JOIN unit_assignments audit ON audit.id = usc.assignment_id
     LEFT JOIN crews ec ON ec.id = audit.crew_id
     LEFT JOIN workers ew ON ew.id = audit.worker_id
     LEFT JOIN unit_assignments cur
       ON cur.unit_id = usc.unit_id
      AND cur.trade = s.trade
      AND cur.deleted_at IS NULL
     LEFT JOIN crews cc ON cc.id = cur.crew_id
     LEFT JOIN workers cw ON cw.id = cur.worker_id
     LEFT JOIN crews cwc ON cwc.id = cw.crew_id
     WHERE ${visibleCond('unit_stage_completions', 'usc')}
       AND b.project_id = ?
       AND ht.project_id = ?
       AND s.project_id = ?
       ${conditions.join('\n       ')}`,
    params,
  )

  return rows
    .map<QuantityConstructionRecord>(row => ({
      completionId: row.id,
      unitId: row.unit_id,
      unitName: row.unit_name || `${row.unit_code}户`,
      floorName: row.floor_name,
      buildingName: row.building_name,
      stageId: row.stage_id,
      stageName: row.stage_name,
      trade: row.trade,
      stageSortOrder: numberValue(row.stage_sort_order),
      status: row.status,
      completedAt: row.completed_at,
      note: row.note ?? '',
      executionAssigneeName: row.execution_crew_name || row.execution_worker_name || null,
      currentAssigneeName: row.current_crew_name || row.current_worker_name || null,
      photoCount: numberValue(row.photo_count),
    }))
    .sort((left, right) => (
      left.trade.localeCompare(right.trade, 'zh-CN')
      || left.stageSortOrder - right.stageSortOrder
      || (left.completedAt ?? '').localeCompare(right.completedAt ?? '')
      || left.completionId.localeCompare(right.completionId)
    ))
}

export async function loadQuantityMonthlyOutput(db: SoftDb, projectId: string): Promise<QuantityMonthlyOutput[]> {
  // 月度只聚合 completed；量走活链接，且每个分项只在显式报量阶段计一次。
  const rows = await db.select<MonthlyRow>(
    `${hiddenCtesFor('unit_stage_completions', 'construction_stage_items', 'house_type_template_items')}
     SELECT substr(usc.completed_at, 1, 7) AS month,
            usc.stage_id,
            s.name AS stage_name,
            s.trade,
            s.sort_order AS stage_sort_order,
            COUNT(DISTINCT usc.id) AS completed_units,
            SUM(qty.contract_qty) AS contract_qty,
            SUM(qty.provisional_qty) AS provisional_qty,
            SUM(qty.field_qty) AS field_qty
     FROM unit_stage_completions usc
     JOIN units u ON u.id = usc.unit_id
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN house_type_templates ht ON ht.id = u.house_type_template_id
     JOIN construction_stages s ON s.id = usc.stage_id
     JOIN (
       SELECT r.template_id,
              csi.stage_id,
              SUM(COALESCE(hti.contract_qty, 0)) AS contract_qty,
              SUM(COALESCE(hti.provisional_qty, 0)) AS provisional_qty,
              SUM(COALESCE(hti.field_qty, 0)) AS field_qty
       FROM construction_stage_items csi
       JOIN house_type_template_items hti ON hti.item_id = csi.item_id
       JOIN rooms r ON r.id = hti.room_id
       WHERE ${visibleCond('construction_stage_items', 'csi')}
         AND ${visibleCond('house_type_template_items', 'hti')}
         AND csi.is_reporting_stage = 1
       GROUP BY r.template_id, csi.stage_id
     ) qty ON qty.template_id = u.house_type_template_id AND qty.stage_id = usc.stage_id
     WHERE ${visibleCond('unit_stage_completions', 'usc')}
       AND usc.status = 'completed'
       AND usc.completed_at IS NOT NULL
       AND b.project_id = ?
       AND ht.project_id = ?
       AND s.project_id = ?
     GROUP BY month, usc.stage_id
     ORDER BY month, s.sort_order, s.code, usc.stage_id`,
    [projectId, projectId, projectId],
  )

  return rows.map(row => ({
    month: row.month,
    trade: row.trade,
    stageId: row.stage_id,
    stageName: row.stage_name,
    stageSortOrder: numberValue(row.stage_sort_order),
    completedUnits: numberValue(row.completed_units),
    contractQty: numberValue(row.contract_qty),
    provisionalQty: numberValue(row.provisional_qty),
    fieldQty: numberValue(row.field_qty),
  }))
}
