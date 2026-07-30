import type { SoftDb } from '~/lib/db/soft-delete'
import { logCreate, selectVisibleSql } from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'

export interface QuantityRegionBuilding {
  id: string
  code: string
  name: string
  sortOrder: number
}

export interface QuantityRegionFloor {
  id: string
  buildingId: string
  code: string
  name: string
  sortOrder: number
}

export interface QuantityRegionUnit {
  id: string
  floorId: string
  templateId: string
  code: string
  name: string
  sortOrder: number
}

export interface QuantityRegionTemplate {
  id: string
  code: string
  name: string
}

export interface QuantityRegionWorkspace {
  projectId: string
  projectCode: string
  projectName: string
  matrixArchivedAt: string | null
  buildings: readonly QuantityRegionBuilding[]
  floors: readonly QuantityRegionFloor[]
  units: readonly QuantityRegionUnit[]
  templates: readonly QuantityRegionTemplate[]
}

export interface QuantityRegionNodeDraft {
  code: string
  name: string
}

export interface QuantityRegionUnitDraft extends QuantityRegionNodeDraft {
  templateId: string
}

export async function confirmQuantityRegionLeave(
  hasDraft: boolean,
  confirm: () => Promise<boolean>,
): Promise<boolean> {
  return hasDraft ? confirm() : true
}

interface ProjectRow {
  id: string
  code: string | null
  name: string | null
  matrix_archived_at: string | null
}

interface BuildingRow {
  id: string
  code: string
  name: string
  sort_order: number
}

interface FloorRow {
  id: string
  building_id: string
  code: string
  name: string
  sort_order: number
}

interface UnitRow {
  id: string
  floor_id: string
  house_type_template_id: string
  code: string
  name: string | null
  sort_order: number
}

interface TemplateRow {
  id: string
  code: string
  name: string | null
}

function normalizedNode(draft: QuantityRegionNodeDraft): QuantityRegionNodeDraft {
  const code = draft.code.trim()
  const name = draft.name.trim()
  if (!code)
    throw new Error('编码不能为空')
  if (!name)
    throw new Error('显示名称不能为空')
  return { code, name }
}

async function assertProjectWritable(db: SoftDb, projectId: string): Promise<ProjectRow> {
  const [project] = await db.select<ProjectRow>(
    selectVisibleSql('projects', 'AND id = ?'),
    [projectId],
  )
  if (!project)
    throw new Error('项目不存在或已删除')
  if (project.matrix_archived_at)
    throw new Error('工程量矩阵已归档，不能调整项目区域')
  return project
}

async function nextSortOrder(
  db: SoftDb,
  table: 'buildings' | 'floors' | 'units',
  parentColumn: 'project_id' | 'building_id' | 'floor_id',
  parentId: string,
): Promise<number> {
  const [row] = await db.select<{ maximum: number | null }>(
    `SELECT MAX(sort_order) AS maximum FROM ${table} WHERE ${parentColumn} = ? AND deleted_at IS NULL`,
    [parentId],
  )
  return Number(row?.maximum ?? 0) + 10
}

async function assertCodeAvailable(
  db: SoftDb,
  table: 'buildings' | 'floors' | 'units',
  parentColumn: 'project_id' | 'building_id' | 'floor_id',
  parentId: string,
  code: string,
): Promise<void> {
  const [duplicate] = await db.select<{ id: string }>(
    `SELECT id FROM ${table} WHERE ${parentColumn} = ? AND code = ? AND deleted_at IS NULL LIMIT 1`,
    [parentId, code],
  )
  if (duplicate)
    throw new Error(`编码「${code}」已存在`)
}

export async function loadQuantityRegionWorkspace(
  db: SoftDb,
  projectId: string,
): Promise<QuantityRegionWorkspace> {
  const project = await assertProjectExists(db, projectId)
  const [buildings, floors, units, templates] = await Promise.all([
    db.select<BuildingRow>(
      selectVisibleSql('buildings', 'AND project_id = ? ORDER BY sort_order, code, id'),
      [projectId],
    ),
    db.select<FloorRow>(
      `SELECT f.*
       FROM floors f
       JOIN buildings b ON b.id = f.building_id
       WHERE f.deleted_at IS NULL AND b.deleted_at IS NULL AND b.project_id = ?
       ORDER BY b.sort_order, f.sort_order, f.code, f.id`,
      [projectId],
    ),
    db.select<UnitRow>(
      `SELECT u.*
       FROM units u
       JOIN floors f ON f.id = u.floor_id
       JOIN buildings b ON b.id = f.building_id
       JOIN house_type_templates ht ON ht.id = u.house_type_template_id
       WHERE u.deleted_at IS NULL AND f.deleted_at IS NULL AND b.deleted_at IS NULL
         AND ht.deleted_at IS NULL AND b.project_id = ? AND ht.project_id = ?
       ORDER BY b.sort_order, f.sort_order, u.sort_order, u.code, u.id`,
      [projectId, projectId],
    ),
    db.select<TemplateRow>(
      selectVisibleSql('house_type_templates', 'AND project_id = ? ORDER BY sort_order, code, id'),
      [projectId],
    ),
  ])
  return {
    projectId: project.id,
    projectCode: project.code ?? '',
    projectName: project.name || '未命名项目',
    matrixArchivedAt: project.matrix_archived_at,
    buildings: buildings.map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      sortOrder: Number(row.sort_order),
    })),
    floors: floors.map(row => ({
      id: row.id,
      buildingId: row.building_id,
      code: row.code,
      name: row.name,
      sortOrder: Number(row.sort_order),
    })),
    units: units.map(row => ({
      id: row.id,
      floorId: row.floor_id,
      templateId: row.house_type_template_id,
      code: row.code,
      name: row.name || row.code,
      sortOrder: Number(row.sort_order),
    })),
    templates: templates.map(row => ({
      id: row.id,
      code: row.code,
      name: row.name || row.code,
    })),
  }
}

async function assertProjectExists(db: SoftDb, projectId: string): Promise<ProjectRow> {
  const [project] = await db.select<ProjectRow>(
    selectVisibleSql('projects', 'AND id = ?'),
    [projectId],
  )
  if (!project)
    throw new Error('项目不存在或已删除')
  return project
}

export async function persistQuantityBuilding(
  db: SoftDb,
  projectId: string,
  draft: QuantityRegionNodeDraft,
): Promise<string> {
  await assertProjectWritable(db, projectId)
  const node = normalizedNode(draft)
  await assertCodeAvailable(db, 'buildings', 'project_id', projectId, node.code)
  const id = generateId('building')
  const sortOrder = await nextSortOrder(db, 'buildings', 'project_id', projectId)
  await db.execute(
    `INSERT INTO buildings (id, project_id, code, name, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
    [id, projectId, node.code, node.name, sortOrder],
  )
  await logCreate(db, 'buildings', id)
  return id
}

export async function persistQuantityFloor(
  db: SoftDb,
  projectId: string,
  buildingId: string,
  draft: QuantityRegionNodeDraft,
): Promise<string> {
  await assertProjectWritable(db, projectId)
  const [building] = await db.select<{ id: string }>(
    selectVisibleSql('buildings', 'AND id = ? AND project_id = ?'),
    [buildingId, projectId],
  )
  if (!building)
    throw new Error('所选楼栋不属于当前项目')
  const node = normalizedNode(draft)
  await assertCodeAvailable(db, 'floors', 'building_id', buildingId, node.code)
  const id = generateId('floor')
  const sortOrder = await nextSortOrder(db, 'floors', 'building_id', buildingId)
  await db.execute(
    `INSERT INTO floors (id, building_id, code, name, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
    [id, buildingId, node.code, node.name, sortOrder],
  )
  await logCreate(db, 'floors', id)
  return id
}

export async function persistQuantityUnit(
  db: SoftDb,
  projectId: string,
  floorId: string,
  draft: QuantityRegionUnitDraft,
): Promise<string> {
  await assertProjectWritable(db, projectId)
  const [floor] = await db.select<{ id: string }>(
    `SELECT f.id
     FROM floors f
     JOIN buildings b ON b.id = f.building_id
     WHERE f.id = ? AND f.deleted_at IS NULL
       AND b.deleted_at IS NULL AND b.project_id = ?`,
    [floorId, projectId],
  )
  if (!floor)
    throw new Error('所选楼层不属于当前项目')
  const [template] = await db.select<{ id: string }>(
    selectVisibleSql('house_type_templates', 'AND id = ? AND project_id = ?'),
    [draft.templateId, projectId],
  )
  if (!template)
    throw new Error('所选户型模板不属于当前项目')
  const node = normalizedNode(draft)
  await assertCodeAvailable(db, 'units', 'floor_id', floorId, node.code)
  const id = generateId('unit')
  const sortOrder = await nextSortOrder(db, 'units', 'floor_id', floorId)
  await db.execute(
    `INSERT INTO units (id, floor_id, house_type_template_id, code, name, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, floorId, draft.templateId, node.code, node.name, sortOrder],
  )
  await logCreate(db, 'units', id)
  return id
}
