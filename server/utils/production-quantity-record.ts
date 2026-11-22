import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { QuantityCommand, QuantityContext, QuantityReadQuery } from '../../app/lib/quantity/central-contract'
import type { QuantityPhotoContent, QuantityPhotoIdentity } from '../../app/lib/quantity/central-photo'
import type { QuantityConsumption } from '../../app/lib/quantity/central-service'
import type { QuantityCompletionPhotoDraft } from '../../app/lib/quantity/completion'
import type { BusinessSession } from './business-session'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { hiddenCtes, hiddenCtesFor, visibleCond } from '../../app/lib/db/soft-delete'
import { effectiveMasterDataCapabilities } from '../../app/lib/master-data/capabilities'
import { loadQuantityAssignmentWorkspace } from '../../app/lib/quantity/assignment'
import { assertQuantityBasis, QUANTITY_BASIS_COLUMNS } from '../../app/lib/quantity/basis'
import { loadQuantityBatchCompletionPlan } from '../../app/lib/quantity/batch-completion'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { validateQuantityPhoto } from '../../app/lib/quantity/central-photo'
import { loadQuantityStageWorkspace } from '../../app/lib/quantity/central-stages'
import { loadQuantityCentralWorkspace } from '../../app/lib/quantity/central-workspace'
import { loadQuantityCompletionWorkspace } from '../../app/lib/quantity/completion'
import { loadQuantityRegionWorkspace } from '../../app/lib/quantity/region'
import { loadQuantityTemplateWorkspace } from '../../app/lib/quantity/template'
import { createCrewWorkerCommandService } from './crew-worker-command-service'
import { loadProductionCrewWorkers } from './production-crew-worker-record'
import { productionScheduleVisibility as productionWbsVisibility } from './production-schedule-visibility'

export function quantityCanonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(quantityCanonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${quantityCanonical(entry)}`).join(',')}}`
  return JSON.stringify(value)
}
export const quantityDigest = (value: unknown) => createHash('sha256').update(quantityCanonical(value)).digest('hex')

export async function assertProductionQuantitySchema(db: TransactionDb) {
  const [participant] = await db.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'quantity\'')
  if (participant?.schema_version !== 1)
    throw quantityProblem('unavailable', '正式工程量参与者版本未注册；请先完成连续升级')
}
export const productionQuantityProjects = (db: TransactionDb) => db.select<{ id: string, name: string, code: string }>('SELECT id,name,code FROM projects WHERE deleted_at IS NULL ORDER BY id')

/** Read the existing global owner, including its authoritative deletion state. */
export async function productionQuantityPeople(db: TransactionDb, actor: QuantityContext) {
  if (!actor.capabilities.includes('crew:list:read') || !actor.capabilities.includes('worker:list:read'))
    throw quantityProblem('forbidden', '当前无权读取正式责任目录')
  const owner = createCrewWorkerCommandService({ initialState: await loadProductionCrewWorkers(db, actor as BusinessSession) })
  const crews = owner.crewRows()
  return [
    ...crews.map(row => ({ id: row.id, kind: 'crew' as const, name: row.name, trade: row.trade, dataOrigin: 'real' as const, ...effectiveMasterDataCapabilities(row.trade, row.tradeCapabilities, row.itemCapabilities) })),
    ...owner.workerRows().filter(row => !row.crewId || crews.some(crew => crew.id === row.crewId)).map(row => ({ id: row.id, kind: 'worker' as const, name: row.name, trade: row.trade, dataOrigin: 'real' as const, ...effectiveMasterDataCapabilities(row.trade, row.tradeCapabilities, row.itemCapabilities) })),
  ]
}

interface QuantityVersionVector { projectId: string, consumption: QuantityConsumption, parts: Record<string, string> }

/** Read tokens carry entity/relationship fingerprints. Writes compare only their selected dependencies. */
async function quantityVersionVector(db: TransactionDb, projectId: string, scope: QuantityReadQuery | QuantityCommand, consumption: QuantityConsumption): Promise<QuantityVersionVector> {
  const command = 'action' in scope ? scope : null
  const action = command?.action
  const parts: Record<string, string> = {}
  const put = (key: string, value: unknown) => {
    parts[key] = quantityDigest(value)
  }
  const [project] = await db.select<{ id: string, matrix_archived_at: string | null, deleted_at: string | null }>('SELECT id,matrix_archived_at,deleted_at FROM projects WHERE id=?', [projectId])
  if (!project || project.deleted_at)
    throw quantityProblem('not-found', '原工程量项目不可见')
  put('project', project)
  if (consumption === 'monthly') {
    const query = scope as QuantityReadQuery & { periodNo?: string, contractId?: string, basis?: string }
    const basis = query.basis ?? 'field'
    assertQuantityBasis(basis)
    const completedCondition = query.periodNo === undefined ? '' : 'AND substr(done.completed_at,1,7)=?'
    const contractCondition = query.contractId === undefined ? '' : 'AND EXISTS(SELECT 1 FROM quantity_boq_references ref WHERE ref.id=hti.boq_line_id AND ref.project_id=b.project_id AND ref.contract_id=?)'
    const rows = await db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('units', 'house_type_template_items', 'construction_stage_items', 'unit_stage_completions')}
      SELECT u.id AS unit_id,u.house_type_template_id,r.id AS room_id,hti.id AS template_line_id,
        hti.boq_line_id,hti.item_id,hti.${QUANTITY_BASIS_COLUMNS[basis]} AS selected_qty,
        item.unit,s.id AS stage_id,s.trade,csi.id AS reporting_mapping_id,
        done.id AS completion_id,done.completed_at
      FROM units u JOIN floors f ON f.id=u.floor_id JOIN buildings b ON b.id=f.building_id
      JOIN house_type_templates ht ON ht.id=u.house_type_template_id
      JOIN rooms r ON r.template_id=ht.id JOIN house_type_template_items hti ON hti.room_id=r.id
      JOIN items item ON item.id=hti.item_id
      JOIN construction_stage_items csi ON csi.item_id=item.id AND csi.is_reporting_stage=1
      JOIN construction_stages s ON s.id=csi.stage_id AND s.trade=item.trade
      LEFT JOIN unit_stage_completions done ON done.unit_id=u.id AND done.stage_id=s.id
        AND done.status='completed' AND done.completed_at IS NOT NULL
        AND ${visibleCond('unit_stage_completions', 'done')} ${completedCondition}
      WHERE b.project_id=? AND ht.project_id=? AND item.project_id=? AND s.project_id=?
        AND ${visibleCond('units', 'u')} AND ${visibleCond('house_type_template_items', 'hti')}
        AND ${visibleCond('construction_stage_items', 'csi')} AND hti.boq_line_id IS NOT NULL ${contractCondition}
      ORDER BY u.id,hti.id,csi.id,done.id`, [
      ...(query.periodNo === undefined ? [] : [query.periodNo]),
      projectId,
      projectId,
      projectId,
      projectId,
      ...(query.contractId === undefined ? [] : [query.contractId]),
    ])
    put('monthly-facts', { periodNo: query.periodNo ?? null, contractId: query.contractId ?? null, basis, rows })
    return { projectId, consumption, parts }
  }
  const region = await loadQuantityRegionWorkspace(db, projectId)
  for (const row of region.buildings) put(`building:${row.id}`, { id: row.id, projectId })
  for (const row of region.floors) put(`floor:${row.id}`, { id: row.id, buildingId: row.buildingId, projectId })
  for (const row of region.units) put(`unit:${row.id}`, { id: row.id, floorId: row.floorId, templateId: row.templateId, projectId })
  const templates = await loadQuantityTemplateWorkspace(db, projectId)
  for (const item of templates.items) put(`item:${item.id}`, item)
  for (const template of templates.templates) {
    const { unitCount: _usageCount, ...header } = template
    const rooms = templates.rooms.filter(room => room.templateId === template.id)
    const lines = templates.lines.filter(line => rooms.some(room => room.id === line.roomId))
    put(`template:${template.id}`, { template: header, rooms, lines, items: templates.items.filter(item => lines.some(line => line.itemId === item.id)) })
    put(`usage:${template.id}`, region.units.filter(unit => unit.templateId === template.id).map(unit => unit.id).sort())
  }
  const stages = await loadQuantityStageWorkspace(db, projectId)
  for (const stage of stages.stages) put(`stage:${stage.id}`, { stage, mappings: stages.mappings.filter(mapping => mapping.stageId === stage.id) })
  for (const item of templates.items) put(`reporting:${item.id}`, stages.mappings.filter(mapping => mapping.itemId === item.id))
  if (consumption === 'assignments' || consumption === 'workspace') {
    const assignments = await loadQuantityAssignmentWorkspace(db, projectId)
    for (const person of assignments.assignees) put(`person:${person.kind}:${person.id}`, { id: person.id, kind: person.kind, trade: person.trade, trades: person.trades, itemNames: person.itemNames })
    for (const unit of assignments.units) {
      for (const trade of assignments.trades)
        put(`responsibility:${unit.id}:${trade}`, assignments.assignments.filter(row => row.unitId === unit.id && row.trade === trade).map(row => ({ id: row.id, unitId: row.unitId, trade: row.trade, assigneeKind: row.assigneeKind, assigneeId: row.assigneeId, note: row.note, scopes: row.scopes.map(scope => ({ roomId: scope.roomId, itemId: scope.itemId })), hasInvalidScopes: row.hasInvalidScopes, fingerprint: row.fingerprint })))
    }
  }
  if (consumption === 'completion') {
    const unitId = action?.kind === 'save-completion' ? action.draft.unitId : action?.kind === 'import-row' ? action.unitId : (scope as QuantityReadQuery & { unitId: string }).unitId
    if (!unitId)
      throw quantityProblem('invalid-query', '完成版本缺少原目标户身份')
    const completed = await loadQuantityCompletionWorkspace(db, projectId, unitId, { planVisibility: productionWbsVisibility })
    for (const stage of completed.stages) put(`completion:${unitId}:${stage.id}`, stage)
  }
  else if (consumption === 'batch') {
    const draft = action?.kind === 'save-completion-batch' ? { trade: action.draft.trade, unitIds: action.draft.items.map(item => item.unitId) } : scope as QuantityReadQuery & { trade: string, unitIds: string[] }
    const batch = await loadQuantityBatchCompletionPlan(db, projectId, draft)
    for (const item of batch.items) put(`batch:${item.unitId}:${item.stageId}`, item)
  }
  else if (consumption === 'photo') {
    put('photo', await readProductionQuantityPhoto(db, scope as QuantityReadQuery & QuantityPhotoIdentity))
  }
  else if (consumption === 'workspace') {
    put('archive', await loadQuantityCentralWorkspace(db, projectId))
  }
  return { projectId, consumption, parts }
}

export async function productionQuantityVersion(db: TransactionDb, projectId: string, scope: QuantityReadQuery | QuantityCommand, consumption: QuantityConsumption): Promise<string> {
  return `quantity-vector-v1:${Buffer.from(quantityCanonical(await quantityVersionVector(db, projectId, scope, consumption))).toString('base64url')}`
}

export async function validateProductionQuantityVersion(db: TransactionDb, command: QuantityCommand) {
  let original: QuantityVersionVector
  try {
    if (!command.baseVersion.startsWith('quantity-vector-v1:'))
      throw new Error('missing vector')
    original = JSON.parse(Buffer.from(command.baseVersion.slice('quantity-vector-v1:'.length), 'base64url').toString('utf8'))
    if (original.projectId !== command.projectId || !original.parts || typeof original.parts !== 'object')
      throw new Error('different scope')
  }
  catch { throw quantityProblem('stale-source', '原工程量消费版本不可核对，请保留草稿重新读取') }
  const current = await quantityVersionVector(db, command.projectId, command, original.consumption)
  const required = new Set<string>(['project'])
  const action = command.action
  const requireUnit = (unitId: string) => {
    required.add(`unit:${unitId}`)
    const currentUnit = Object.keys(current.parts).includes(`unit:${unitId}`)
    if (!currentUnit)
      throw quantityProblem('stale-source', '原目标户或祖先已变化')
  }
  if (action.kind === 'create-floor') {
    required.add(`building:${action.buildingId}`)
  }
  else if (action.kind === 'create-unit') {
    required.add(`floor:${action.floorId}`)
    required.add(`template:${action.draft.templateId}`)
  }
  else if (action.kind === 'save-template') {
    if (action.draft.id)
      required.add(`template:${action.draft.id}`)
    if (action.draft.copiedFromTemplateId)
      required.add(`template:${action.draft.copiedFromTemplateId}`)
    for (const line of action.draft.lines) {
      if (!action.draft.newItems.some(item => item.key === line.itemId))
        required.add(`item:${line.itemId}`)
    }
  }
  else if (action.kind === 'delete-template') {
    required.add(`template:${action.templateId}`)
    required.add(`usage:${action.templateId}`)
  }
  else if (action.kind === 'save-stage') {
    if (action.draft.id)
      required.add(`stage:${action.draft.id}`)
    for (const itemId of action.draft.itemIds) required.add(`item:${itemId}`)
  }
  else if (action.kind === 'set-reporting-stage') {
    required.add(`item:${action.itemId}`)
    required.add(`reporting:${action.itemId}`)
    if (action.stageId)
      required.add(`stage:${action.stageId}`)
    // A reporting choice consumes all current mappings for this selected item.
    const currentStages = await loadQuantityStageWorkspace(db, command.projectId)
    for (const stage of currentStages.stages.filter(stage => currentStages.mappings.some(mapping => mapping.itemId === action.itemId && mapping.stageId === stage.id))) required.add(`stage:${stage.id}`)
  }
  else if (action.kind === 'save-assignments') {
    required.add(`person:${action.draft.assigneeKind}:${action.draft.assigneeId}`)
    const region = await loadQuantityRegionWorkspace(db, command.projectId)
    for (const unitId of action.draft.unitIds) {
      requireUnit(unitId)
      required.add(`responsibility:${unitId}:${action.draft.trade}`)
      const unit = region.units.find(unit => unit.id === unitId)
      if (unit)
        required.add(`template:${unit.templateId}`)
    }
  }
  else if (action.kind === 'save-completion') {
    requireUnit(action.draft.unitId)
    required.add(`completion:${action.draft.unitId}:${action.draft.stageId}`)
  }
  else if (action.kind === 'save-completion-batch') {
    for (const item of action.draft.items) {
      requireUnit(item.unitId)
      required.add(`batch:${item.unitId}:${item.stageId}`)
    }
  }
  else if (action.kind === 'set-archived') {
    required.add('archive')
  }
  else if (action.kind === 'import-row') {
    if (action.unitId)
      requireUnit(action.unitId)
    if (action.target === 'assignment' && action.assignee)
      required.add(`person:${action.assignee.kind}:${action.assignee.id}`)
    if (action.target === 'completion' && action.unitId) {
      const stage = (await loadQuantityStageWorkspace(db, command.projectId)).stages.find(stage => stage.code === action.row.stageCode)
      if (stage)
        required.add(`completion:${action.unitId}:${stage.id}`)
    }
  }
  for (const key of required) {
    if (!original.parts[key] || !current.parts[key] || original.parts[key] !== current.parts[key])
      throw quantityProblem('stale-source', '原目标、所选模板/阶段或责任资格已变化，请保留草稿重新核对')
  }
}

export async function writeProductionQuantityOriginal(db: TransactionDb, fileId: string, photo: QuantityCompletionPhotoDraft) {
  const bytes = validateQuantityPhoto(photo)
  const hash = createHash('sha256').update(bytes).digest('hex')
  await db.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES (?,?,?)', [fileId, bytes, hash])
}

export async function readProductionQuantityPhoto(db: TransactionDb, query: QuantityPhotoIdentity): Promise<QuantityPhotoContent> {
  const [row] = await db.select<{ file_name: string, mime_type: string, file_size: number, content: Uint8Array | null, sha256: string | null }>(`
    ${hiddenCtes('unit_stage_completions')}
    SELECT fr.file_name,fr.mime_type,fr.file_size,body.content,body.sha256 FROM file_refs fr
    JOIN unit_stage_completions done ON done.id=fr.owner_id
    JOIN construction_stages stage ON stage.id=done.stage_id
    JOIN units unit ON unit.id=done.unit_id JOIN floors floor_row ON floor_row.id=unit.floor_id
    JOIN buildings building ON building.id=floor_row.building_id
    JOIN house_type_templates template ON template.id=unit.house_type_template_id
    LEFT JOIN file_payloads body ON body.file_ref_id=fr.id
    WHERE fr.id=? AND done.id=? AND unit.id=? AND building.project_id=? AND template.project_id=? AND stage.project_id=?
    AND fr.owner_type='unit_stage_completion' AND fr.category='acceptance_photo' AND fr.deleted_at IS NULL
    AND ${visibleCond('unit_stage_completions', 'done')}
  `, [query.photoId, query.completionId, query.unitId, query.projectId, query.projectId, query.projectId])
  if (!row)
    throw quantityProblem('not-found', '原验收照片不存在、已删除或归属不同')
  if (row.content === null)
    throw quantityProblem('not-found', '历史照片未保存正文，不能以当前照片补造')
  if (!(row.content instanceof Uint8Array) || row.content.length !== row.file_size || createHash('sha256').update(row.content).digest('hex') !== row.sha256)
    throw quantityProblem('unavailable', '验收照片正文、大小或摘要无法核对')
  const photo = { fileName: row.file_name, mimeType: row.mime_type, fileSize: row.file_size, contentBase64: Buffer.from(row.content).toString('base64') }
  validateQuantityPhoto(photo, 'unavailable')
  return { ...query, ...photo, sha256: row.sha256! }
}
