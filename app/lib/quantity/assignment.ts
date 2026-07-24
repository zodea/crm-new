import type { QuantityAssigneeKind } from './read-model'
import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtes, logCreate, selectVisibleSql, softDelete, visibleCond } from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'

export interface QuantityAssignmentWorkspaceUnit {
  id: string
  projectId: string
  buildingId: string
  buildingName: string
  floorId: string
  floorName: string
  templateId: string
  code: string
  name: string
  sortOrder: number
}

export interface QuantityAssignmentAssignee {
  kind: QuantityAssigneeKind
  id: string
  name: string
  trade: string
}

export interface QuantityAssignmentScope {
  roomId: string
  roomName: string
  itemId: string
  itemName: string
}

export interface QuantityAssignmentCurrent {
  id: string
  unitId: string
  trade: string
  assigneeKind: QuantityAssigneeKind
  assigneeId: string
  assigneeName: string
  note: string
  scopes: readonly QuantityAssignmentScope[]
  hasInvalidScopes: boolean
  fingerprint: string
}

export interface QuantityAssignmentScopeOption {
  templateId: string
  roomId: string
  roomName: string
  roomSortOrder: number
  itemId: string
  itemName: string
  trade: string
  itemSortOrder: number
}

export interface QuantityAssignmentWorkspace {
  projectId: string
  matrixArchivedAt: string | null
  units: readonly QuantityAssignmentWorkspaceUnit[]
  trades: readonly string[]
  assignees: readonly QuantityAssignmentAssignee[]
  assignments: readonly QuantityAssignmentCurrent[]
  scopeOptions: readonly QuantityAssignmentScopeOption[]
}

export interface QuantityAssignmentExpected {
  unitId: string
  assignmentId: string | null
  fingerprint: string | null
}

export interface QuantityAssignmentScopeDraft {
  unitId: string
  roomId: string
  itemId: string
}

export interface QuantityAssignmentBatchDraft {
  projectId: string
  trade: string
  assigneeKind: QuantityAssigneeKind
  assigneeId: string
  unitIds: string[]
  expectedAssignments: QuantityAssignmentExpected[]
  scopes: QuantityAssignmentScopeDraft[]
  note?: string
  allowReplacement: boolean
  allowArchivedEdit?: boolean
}

export interface QuantityAssignmentWriteResult {
  changedUnitIds: string[]
  unchangedUnitIds: string[]
  replacedUnitIds: string[]
  assignmentIds: string[]
  logIds: string[]
}

export interface QuantityAssignmentConflict {
  unitId: string
  unitName: string
  floorName: string
  currentAssigneeName: string
  currentAssignmentId: string
}

interface ProjectRow {
  id: string
  matrix_archived_at: string | null
}

interface UnitRow {
  id: string
  project_id: string
  building_id: string
  building_name: string
  building_sort_order: number
  floor_id: string
  floor_name: string
  floor_sort_order: number
  template_id: string
  code: string
  name: string | null
  sort_order: number
}

interface MasterAssigneeRow {
  id: string
  name: string
  trade: string | null
}

interface AssignmentRow {
  id: string
  unit_id: string
  trade: string
  crew_id: string | null
  worker_id: string | null
  crew_name: string | null
  worker_name: string | null
  note: string | null
}

interface ScopeRow {
  assignment_id: string
  assignment_trade: string
  unit_template_id: string
  room_id: string
  room_name: string | null
  room_template_id: string | null
  room_deleted_at: string | null
  item_id: string
  item_name: string | null
  item_project_id: string | null
  item_trade: string | null
  item_deleted_at: string | null
  line_id: string | null
}

interface ScopeOptionRow {
  template_id: string
  room_id: string
  room_name: string
  room_sort_order: number
  item_id: string
  item_name: string
  trade: string
  item_sort_order: number
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function strictLog(logId: string | null, message: string): string {
  if (!logId)
    throw new Error(message)
  return logId
}

function scopeIdentity(scope: Pick<QuantityAssignmentScope, 'roomId' | 'itemId'>): string {
  return `${scope.roomId}\u0000${scope.itemId}`
}

export function quantityAssignmentScopeKey(scope: QuantityAssignmentScopeDraft): string {
  return `${scope.unitId}\u0000${scope.roomId}\u0000${scope.itemId}`
}

export function parseQuantityAssignmentScopeKey(key: string): QuantityAssignmentScopeDraft | null {
  const [unitId, roomId, itemId, ...rest] = key.split('\u0000')
  if (!unitId || !roomId || !itemId || rest.length)
    return null
  return { unitId, roomId, itemId }
}

export function quantityAssignmentFingerprint(
  assigneeKind: QuantityAssigneeKind,
  assigneeId: string,
  note: string,
  scopes: readonly Pick<QuantityAssignmentScope, 'roomId' | 'itemId'>[],
): string {
  return JSON.stringify({
    assigneeKind,
    assigneeId,
    note,
    scopes: scopes.map(scopeIdentity).sort(),
  })
}

function assigneeFromRow(row: AssignmentRow): {
  kind: QuantityAssigneeKind
  id: string
  name: string
} {
  if (row.crew_id) {
    return {
      kind: 'crew',
      id: row.crew_id,
      name: row.crew_name || '已删除班组',
    }
  }
  return {
    kind: 'worker',
    id: row.worker_id ?? '',
    name: row.worker_name || '已删除工人',
  }
}

export async function loadQuantityAssignmentWorkspace(
  db: SoftDb,
  projectId: string,
): Promise<QuantityAssignmentWorkspace> {
  const [project] = await db.select<ProjectRow>(
    `${selectVisibleSql('projects')} AND id = ?`,
    [projectId],
  )
  if (!project)
    throw new Error('工程量项目不存在或已删除')

  const unitRows = await db.select<UnitRow>(
    `${hiddenCtes('units')}
     SELECT u.id,
            b.project_id,
            b.id AS building_id,
            b.name AS building_name,
            b.sort_order AS building_sort_order,
            f.id AS floor_id,
            f.name AS floor_name,
            f.sort_order AS floor_sort_order,
            u.house_type_template_id AS template_id,
            u.code,
            u.name,
            u.sort_order
     FROM units u
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN house_type_templates ht ON ht.id = u.house_type_template_id
     WHERE ${visibleCond('units', 'u')}
       AND b.project_id = ?
       AND ht.project_id = ?
     ORDER BY b.sort_order, b.code, f.sort_order, f.code, u.sort_order, u.code, u.id`,
    [projectId, projectId],
  )

  // 当前责任必须按 assignment 自身 active 状态物理读取。assignment 的责任人是身份引用，
  // 即使未来责任人被隐藏，仍要显示“已删除…”并允许显式替换，不能让部分唯一键成为幽灵占位。
  const assignmentRows = await db.select<AssignmentRow>(
    `${hiddenCtes('units')}
     SELECT ua.id,
            ua.unit_id,
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
     JOIN units u ON u.id = ua.unit_id
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN house_type_templates ht ON ht.id = u.house_type_template_id
     LEFT JOIN crews c ON c.id = ua.crew_id
     LEFT JOIN workers w ON w.id = ua.worker_id
     LEFT JOIN crews wc ON wc.id = w.crew_id
     WHERE ua.deleted_at IS NULL
       AND ${visibleCond('units', 'u')}
       AND b.project_id = ?
       AND ht.project_id = ?
     ORDER BY ua.trade, ua.created_at, ua.id`,
    [projectId, projectId],
  )

  const scopeRows = await db.select<ScopeRow>(
    `${hiddenCtes('units')}
     SELECT uas.assignment_id,
            ua.trade AS assignment_trade,
            u.house_type_template_id AS unit_template_id,
            uas.room_id,
            r.name AS room_name,
            r.template_id AS room_template_id,
            r.deleted_at AS room_deleted_at,
            uas.item_id,
            i.name AS item_name,
            i.project_id AS item_project_id,
            i.trade AS item_trade,
            i.deleted_at AS item_deleted_at,
            hti.id AS line_id
     FROM unit_assignment_scopes uas
     JOIN unit_assignments ua ON ua.id = uas.assignment_id
     JOIN units u ON u.id = ua.unit_id
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     LEFT JOIN rooms r ON r.id = uas.room_id
     LEFT JOIN items i ON i.id = uas.item_id
     LEFT JOIN house_type_template_items hti
       ON hti.room_id = uas.room_id
      AND hti.item_id = uas.item_id
      AND hti.deleted_at IS NULL
     WHERE uas.deleted_at IS NULL
       AND ua.deleted_at IS NULL
       AND ${visibleCond('units', 'u')}
       AND b.project_id = ?
     ORDER BY uas.assignment_id, r.sort_order, i.sort_order, uas.id`,
    [projectId],
  )
  const scopesByAssignment = new Map<string, QuantityAssignmentScope[]>()
  const physicalScopesByAssignment = new Map<string, QuantityAssignmentScope[]>()
  const invalidScopeAssignments = new Set<string>()
  for (const row of scopeRows) {
    const scope = {
      roomId: row.room_id,
      roomName: row.room_name || '已删除房间',
      itemId: row.item_id,
      itemName: row.item_name || '已删除分项',
    }
    const physicalScopes = physicalScopesByAssignment.get(row.assignment_id) ?? []
    physicalScopes.push(scope)
    physicalScopesByAssignment.set(row.assignment_id, physicalScopes)
    const valid = row.room_template_id === row.unit_template_id
      && row.room_deleted_at == null
      && row.item_project_id === projectId
      && row.item_trade === row.assignment_trade
      && row.item_deleted_at == null
      && row.line_id != null
    if (!valid) {
      invalidScopeAssignments.add(row.assignment_id)
      continue
    }
    const scopes = scopesByAssignment.get(row.assignment_id) ?? []
    scopes.push(scope)
    scopesByAssignment.set(row.assignment_id, scopes)
  }

  const assignments = assignmentRows.map<QuantityAssignmentCurrent>((row) => {
    const assignee = assigneeFromRow(row)
    const scopes = scopesByAssignment.get(row.id) ?? []
    const physicalScopes = physicalScopesByAssignment.get(row.id) ?? []
    const note = row.note ?? ''
    return {
      id: row.id,
      unitId: row.unit_id,
      trade: row.trade,
      assigneeKind: assignee.kind,
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      note,
      scopes,
      hasInvalidScopes: invalidScopeAssignments.has(row.id),
      fingerprint: quantityAssignmentFingerprint(assignee.kind, assignee.id, note, physicalScopes),
    }
  })

  const stageTrades = await db.select<{ trade: string, sort_order: number }>(
    selectVisibleSql('construction_stages', 'AND project_id = ? ORDER BY sort_order, code, id'),
    [projectId],
  )
  const itemTrades = await db.select<{ trade: string, sort_order: number }>(
    selectVisibleSql('items', 'AND project_id = ? ORDER BY sort_order, code, id'),
    [projectId],
  )
  const trades: string[] = []
  for (const trade of [
    ...stageTrades.map(row => row.trade),
    ...itemTrades.map(row => row.trade),
  ]) {
    const normalized = trade.trim()
    if (normalized && !trades.includes(normalized))
      trades.push(normalized)
  }

  const crewRows = await db.select<MasterAssigneeRow>(selectVisibleSql('crews'))
  const workerRows = await db.select<MasterAssigneeRow>(selectVisibleSql('workers'))
  const assignees = [
    ...crewRows.map<QuantityAssignmentAssignee>(row => ({
      kind: 'crew',
      id: row.id,
      name: row.name,
      trade: row.trade?.trim() ?? '',
    })),
    ...workerRows.map<QuantityAssignmentAssignee>(row => ({
      kind: 'worker',
      id: row.id,
      name: row.name,
      trade: row.trade?.trim() ?? '',
    })),
  ]
    .sort((left, right) => (
      Number(left.kind === 'worker') - Number(right.kind === 'worker')
      || left.name.localeCompare(right.name, 'zh-CN')
      || left.id.localeCompare(right.id)
    ))

  const scopeOptionRows = await db.select<ScopeOptionRow>(
    `${hiddenCtes('house_type_template_items')}
     SELECT ht.id AS template_id,
            r.id AS room_id,
            r.name AS room_name,
            r.sort_order AS room_sort_order,
            i.id AS item_id,
            i.name AS item_name,
            i.trade,
            i.sort_order AS item_sort_order
     FROM house_type_template_items hti
     JOIN rooms r ON r.id = hti.room_id
     JOIN house_type_templates ht ON ht.id = r.template_id
     JOIN items i ON i.id = hti.item_id
     WHERE ${visibleCond('house_type_template_items', 'hti')}
       AND ht.project_id = ?
       AND i.project_id = ?
     ORDER BY ht.sort_order, ht.code, r.sort_order, r.code, i.sort_order, i.code, hti.id`,
    [projectId, projectId],
  )

  return {
    projectId,
    matrixArchivedAt: project.matrix_archived_at,
    units: unitRows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      buildingId: row.building_id,
      buildingName: row.building_name,
      floorId: row.floor_id,
      floorName: row.floor_name,
      templateId: row.template_id,
      code: row.code,
      name: row.name || `${row.code}户`,
      sortOrder: numberValue(row.sort_order),
    })),
    trades,
    assignees,
    assignments,
    scopeOptions: scopeOptionRows.map(row => ({
      templateId: row.template_id,
      roomId: row.room_id,
      roomName: row.room_name,
      roomSortOrder: numberValue(row.room_sort_order),
      itemId: row.item_id,
      itemName: row.item_name,
      trade: row.trade,
      itemSortOrder: numberValue(row.item_sort_order),
    })),
  }
}

function desiredScopesByUnit(draft: QuantityAssignmentBatchDraft): Map<string, QuantityAssignmentScopeDraft[]> {
  const byUnit = new Map<string, QuantityAssignmentScopeDraft[]>()
  const seen = new Set<string>()
  for (const scope of draft.scopes) {
    const key = quantityAssignmentScopeKey(scope)
    if (seen.has(key))
      throw new Error('个人责任范围不能重复')
    seen.add(key)
    const scopes = byUnit.get(scope.unitId) ?? []
    scopes.push(scope)
    byUnit.set(scope.unitId, scopes)
  }
  return byUnit
}

function effectiveNote(draft: QuantityAssignmentBatchDraft, current: QuantityAssignmentCurrent | undefined): string {
  if (draft.note != null)
    return draft.note.trim()
  if (current?.assigneeKind === draft.assigneeKind && current.assigneeId === draft.assigneeId)
    return current.note
  return ''
}

function assignmentIsUnchanged(
  current: QuantityAssignmentCurrent,
  draft: QuantityAssignmentBatchDraft,
  scopes: readonly QuantityAssignmentScopeDraft[],
): boolean {
  if (current.hasInvalidScopes)
    return false
  return current.fingerprint === quantityAssignmentFingerprint(
    draft.assigneeKind,
    draft.assigneeId,
    effectiveNote(draft, current),
    scopes.map(scope => ({ roomId: scope.roomId, itemId: scope.itemId, roomName: '', itemName: '' })),
  )
}

export function previewQuantityAssignmentConflicts(
  workspace: QuantityAssignmentWorkspace,
  draft: QuantityAssignmentBatchDraft,
): QuantityAssignmentConflict[] {
  const scopesByUnit = desiredScopesByUnit(draft)
  const unitsById = new Map(workspace.units.map(unit => [unit.id, unit]))
  const currentByUnit = new Map(
    workspace.assignments
      .filter(assignment => assignment.trade === draft.trade)
      .map(assignment => [assignment.unitId, assignment]),
  )
  return draft.unitIds.flatMap((unitId) => {
    const current = currentByUnit.get(unitId)
    const unit = unitsById.get(unitId)
    if (!current || !unit || assignmentIsUnchanged(current, draft, scopesByUnit.get(unitId) ?? []))
      return []
    return [{
      unitId,
      unitName: unit.name,
      floorName: unit.floorName,
      currentAssigneeName: current.assigneeName,
      currentAssignmentId: current.id,
    }]
  })
}

export async function persistQuantityAssignments(
  db: SoftDb,
  draft: QuantityAssignmentBatchDraft,
): Promise<QuantityAssignmentWriteResult> {
  const projectId = draft.projectId.trim()
  const trade = draft.trade.trim()
  const assigneeId = draft.assigneeId.trim()
  if (!projectId || !trade || !assigneeId)
    throw new Error('请选择项目、工种和责任人')
  if (draft.assigneeKind !== 'crew' && draft.assigneeKind !== 'worker')
    throw new Error('责任类型无效')

  const unitIds = [...draft.unitIds]
  if (!unitIds.length)
    throw new Error('请至少选择一户')
  if (new Set(unitIds).size !== unitIds.length)
    throw new Error('同一户不能在批次中重复')

  const expectedByUnit = new Map<string, QuantityAssignmentExpected>()
  for (const expected of draft.expectedAssignments) {
    if (expectedByUnit.has(expected.unitId))
      throw new Error('责任版本检查项不能重复')
    expectedByUnit.set(expected.unitId, expected)
  }
  if (expectedByUnit.size !== unitIds.length || unitIds.some(unitId => !expectedByUnit.has(unitId)))
    throw new Error('责任版本检查项与所选户不一致')

  if (draft.assigneeKind === 'crew' && draft.scopes.length)
    throw new Error('只有个人责任可以配置房间分项范围')
  const scopesByUnit = desiredScopesByUnit(draft)
  if ([...scopesByUnit.keys()].some(unitId => !expectedByUnit.has(unitId)))
    throw new Error('个人责任范围包含未选择的户')

  // 在同一 transaction 内重新加载并验证所有事实，确认弹窗与真正提交之间不会 TOCTOU 覆盖。
  const workspace = await loadQuantityAssignmentWorkspace(db, projectId)
  const targetAssignee = workspace.assignees.find(assignee => (
    assignee.kind === draft.assigneeKind && assignee.id === assigneeId
  ))
  if (!targetAssignee)
    throw new Error('所选责任人不存在')
  if (targetAssignee.trade !== trade)
    throw new Error('所选责任人的工种与当前工种不一致')
  if (!workspace.trades.includes(trade))
    throw new Error('当前项目不存在该工种')

  const unitsById = new Map(workspace.units.map(unit => [unit.id, unit]))
  if (unitIds.some(unitId => !unitsById.has(unitId)))
    throw new Error('所选户不属于当前项目或已删除')

  const currentByUnit = new Map(
    workspace.assignments
      .filter(assignment => assignment.trade === trade)
      .map(assignment => [assignment.unitId, assignment]),
  )
  for (const unitId of unitIds) {
    const current = currentByUnit.get(unitId)
    const expected = expectedByUnit.get(unitId)!
    if ((current?.id ?? null) !== expected.assignmentId)
      throw new Error('所选户的当前责任已发生变化，请重新加载后再提交')
    if ((current?.fingerprint ?? null) !== expected.fingerprint)
      throw new Error('所选户的责任范围已发生变化，请重新加载后再提交')
  }

  const scopeOptions = new Set(workspace.scopeOptions.map(option => (
    `${option.templateId}\u0000${option.roomId}\u0000${option.itemId}\u0000${option.trade}`
  )))
  for (const [unitId, scopes] of scopesByUnit) {
    const unit = unitsById.get(unitId)!
    for (const scope of scopes) {
      const sameTemplate = workspace.scopeOptions.some(option => (
        option.templateId === unit.templateId
        && option.roomId === scope.roomId
        && option.itemId === scope.itemId
      ))
      if (!sameTemplate)
        throw new Error(`户「${unit.name}」的个人范围不属于其挂靠户型`)
      if (!scopeOptions.has(`${unit.templateId}\u0000${scope.roomId}\u0000${scope.itemId}\u0000${trade}`))
        throw new Error(`户「${unit.name}」的个人范围分项与当前工种不一致`)
    }
  }

  const changedUnitIds: string[] = []
  const unchangedUnitIds: string[] = []
  const replacedUnitIds: string[] = []
  for (const unitId of unitIds) {
    const current = currentByUnit.get(unitId)
    if (current && assignmentIsUnchanged(current, draft, scopesByUnit.get(unitId) ?? [])) {
      unchangedUnitIds.push(unitId)
      continue
    }
    if (current) {
      if (!draft.allowReplacement)
        throw new Error('所选户中存在既有责任，请确认替换后再提交')
      replacedUnitIds.push(unitId)
    }
    changedUnitIds.push(unitId)
  }

  if (changedUnitIds.length && workspace.matrixArchivedAt && !draft.allowArchivedEdit)
    throw new Error('工程量矩阵已归档，请二次确认后再修改责任')

  const now = new Date().toISOString()
  const logIds: string[] = []
  const assignmentIds: string[] = []
  for (const unitId of changedUnitIds) {
    const current = currentByUnit.get(unitId)
    if (current) {
      logIds.push(strictLog(
        await softDelete(db, 'unit_assignments', current.id),
        '旧责任未能软删除并记录操作日志',
      ))
    }

    const assignmentId = generateId('qty_asg')
    const crewId = draft.assigneeKind === 'crew' ? assigneeId : null
    const workerId = draft.assigneeKind === 'worker' ? assigneeId : null
    await db.execute(
      `INSERT INTO unit_assignments
        (id, unit_id, trade, crew_id, worker_id, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [assignmentId, unitId, trade, crewId, workerId, effectiveNote(draft, current) || null, now, now],
    )
    logIds.push(strictLog(
      await logCreate(db, 'unit_assignments', assignmentId),
      '新责任未能记录操作日志',
    ))
    assignmentIds.push(assignmentId)

    for (const scope of scopesByUnit.get(unitId) ?? []) {
      const scopeId = generateId('qty_scope')
      await db.execute(
        `INSERT INTO unit_assignment_scopes
          (id, assignment_id, room_id, item_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [scopeId, assignmentId, scope.roomId, scope.itemId, now, now],
      )
      logIds.push(strictLog(
        await logCreate(db, 'unit_assignment_scopes', scopeId),
        '个人责任范围未能记录操作日志',
      ))
    }
  }

  return {
    changedUnitIds,
    unchangedUnitIds,
    replacedUnitIds,
    assignmentIds,
    logIds,
  }
}
