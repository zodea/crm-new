import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { ScheduleCommand } from '../../app/lib/schedule/central-contract'
import type { BusinessSession } from './business-session'
import { Buffer } from 'node:buffer'
import { resolveScheduleBoqBuildingReference } from '../../app/lib/schedule/building-reference'
import { scheduleProblem } from '../../app/lib/schedule/central-contract'
import { readProductionProcessLibraryState } from './production-process-library-record'
import { productionWbsBoqLines, productionWbsBoqReadable, productionWbsContract, productionWbsContracts } from './production-wbs-boq-sources'
import { productionWbsGraph, productionWbsProject, productionWbsVisibility, wbsDigest } from './production-wbs-record'

interface Basis {
  revision: number
  projectId: string
  project: string
  groups: Record<string, string>
  tasks: Record<string, { groupId: string | null, parentId: string | null, hash: string, plan: string }>
  edges: Record<string, { predId: string, succId: string, hash: string }>
  logs: Record<string, { groupId: string | null, table: string, recordId: string, hash: string }>
  floors: Record<string, string>
  taskFloorSets: Record<string, string[]>
  members: Record<string, string>
  topology: Record<string, string>
  buildings: Record<string, string>
  names: Record<string, string>
  libraries: Record<string, string>
  stages: Record<string, string>
  items: Record<string, string>
  baseline: string
  contracts: Record<string, { qualification: string, audit: string }>
  boq: Record<string, { contractId: string, itemId: string | null, building: string | null, declaredBuildingId?: string | null, shape: string, quantity: string }>
  buildingRefs: Record<string, { id: string, code: string, name: string }>
  bindingGroups: Record<string, string>
  contractBuildings: Record<string, string>
}
const prefix = 'wbs-v1:'
export function decodeProductionWbsVersion(version: string): Basis {
  try {
    if (!version.startsWith(prefix))
      throw new Error('version')
    const basis = JSON.parse(Buffer.from(version.slice(prefix.length), 'base64url').toString())
    if (!basis || !Number.isSafeInteger(basis.revision) || basis.revision < 0 || typeof basis.projectId !== 'string' || typeof basis.project !== 'string' || typeof basis.baseline !== 'string' || !['groups', 'tasks', 'edges', 'logs', 'buildings', 'names', 'libraries', 'stages', 'items'].every(key => basis[key] && typeof basis[key] === 'object' && !Array.isArray(basis[key])))
      throw new Error('version')
    for (const key of ['contracts', 'boq', 'buildingRefs', 'bindingGroups', 'contractBuildings']) {
      if (basis[key] === undefined)
        basis[key] = {}
      if (!basis[key] || typeof basis[key] !== 'object' || Array.isArray(basis[key]))
        throw new Error('version')
    }
    return basis
  }
  catch { throw scheduleProblem('stale-source', '原WBS读取依据无法核验，请保留输入重新核对') }
}
export async function productionWbsVersion(tx: TransactionDb, actor: BusinessSession, projectId: string) {
  const project = await productionWbsProject(tx, projectId)
  const graph = await productionWbsGraph(tx, projectId)
  const revision = (await tx.select<{ revision: number }>('SELECT revision FROM schedule_revisions WHERE project_id=?', [projectId]))[0]?.revision ?? 0
  const basis: Basis = { revision, projectId, project: wbsDigest([project.id, project.deleted_at]), groups: {}, tasks: {}, edges: {}, logs: {}, floors: {}, taskFloorSets: {}, members: {}, topology: {}, buildings: {}, names: {}, libraries: {}, stages: {}, items: {}, baseline: '', contracts: {}, boq: {}, buildingRefs: {}, bindingGroups: {}, contractBuildings: {} }
  for (const group of graph.schedule_groups!) {
    const taskIds = graph.schedule_tasks!.filter(task => task.group_id === group.id).map(task => task.id)
    basis.groups[String(group.id)] = wbsDigest({ group, buildings: graph.schedule_group_buildings!.filter(row => row.group_id === group.id) })
    basis.members[String(group.id)] = wbsDigest(graph.schedule_tasks!.filter(task => taskIds.includes(task.id)).map(task => [task.id, task.sort_order, task.source_library_task_id, task.deleted_at, task.parent_id]))
    basis.topology[String(group.id)] = wbsDigest(graph.task_dependencies!.filter(row => taskIds.includes(row.pred_id) || taskIds.includes(row.succ_id)))
    basis.bindingGroups[String(group.id)] = wbsDigest({ tasks: graph.schedule_tasks!.filter(task => taskIds.includes(task.id)).map(task => [task.id, task.group_id, task.deleted_at]), maps: graph.task_item_map!.filter(row => taskIds.includes(row.task_id)), floors: graph.schedule_task_floor_plans!.filter(row => taskIds.includes(row.task_id)).map(row => [row.id, row.task_id, row.floor_id, row.item_id, row.source_basis, row.provisional_qty, row.deleted_at]), frozen: graph.schedule_floor_quantity_snapshots!.filter(row => graph.schedule_task_floor_plans!.some(floor => floor.id === row.id && taskIds.includes(floor.task_id))) })
    if (group.deleted_at === null)
      basis.names[String(group.name)] = String(group.id)
  }
  for (const task of graph.schedule_tasks!) {
    basis.tasks[String(task.id)] = { groupId: task.group_id === null ? null : String(task.group_id), parentId: task.parent_id === null ? null : String(task.parent_id), hash: wbsDigest(task), plan: wbsDigest([task.id, task.group_id, task.parent_id, task.deleted_at, task.planned_start, task.planned_finish]) }
    const floors = graph.schedule_task_floor_plans!.filter(row => row.task_id === task.id)
    basis.taskFloorSets[String(task.id)] = floors.map(floor => String(floor.id))
    for (const floor of floors)
      basis.floors[String(floor.id)] = wbsDigest([floor, graph.schedule_floor_quantity_snapshots!.find(row => row.id === floor.id)])
  }
  for (const edge of graph.task_dependencies!)
    basis.edges[String(edge.id)] = { predId: String(edge.pred_id), succId: String(edge.succ_id), hash: wbsDigest(edge) }
  const logs = await tx.select<{ id: string, record_id: string, table_name: string }>('SELECT * FROM operation_logs ORDER BY id')
  for (const log of logs) {
    const row = graph[log.table_name]?.find(row => row.id === log.record_id)
    if (!row)
      continue
    const task = log.table_name === 'schedule_tasks' ? row : graph.schedule_tasks!.find(task => task.id === (row.task_id ?? row.succ_id))
    basis.logs[log.id] = { groupId: log.table_name === 'schedule_groups' ? String(row.id) : log.table_name === 'schedule_group_buildings' ? String(row.group_id) : task?.group_id == null ? null : String(task.group_id), table: log.table_name, recordId: log.record_id, hash: wbsDigest([log, row]) }
  }
  const buildings = await tx.select<{ id: string, code: string, name: string }>('SELECT id,code,name FROM buildings WHERE project_id=? ORDER BY id', [projectId])
  for (const building of buildings) {
    basis.buildingRefs[building.id] = building
    // Creation consumes the selected physical range and effective template/stage mappings, never payroll or live completion facts.
    const scoped: Record<string, unknown> = {}
    scoped.buildings = await tx.select('SELECT * FROM buildings WHERE id=?', [building.id])
    scoped.floors = await tx.select('SELECT * FROM floors WHERE building_id=? ORDER BY id', [building.id])
    scoped.units = await tx.select('SELECT u.* FROM units u JOIN floors f ON f.id=u.floor_id WHERE f.building_id=? ORDER BY u.id', [building.id])
    scoped.templates = await tx.select('SELECT DISTINCT t.* FROM house_type_templates t JOIN units u ON u.house_type_template_id=t.id JOIN floors f ON f.id=u.floor_id WHERE f.building_id=? ORDER BY t.id', [building.id])
    scoped.quantities = await tx.select('SELECT q.* FROM house_type_template_items q JOIN rooms r ON r.id=q.room_id WHERE r.template_id IN (SELECT u.house_type_template_id FROM units u JOIN floors f ON f.id=u.floor_id WHERE f.building_id=?) ORDER BY q.id', [building.id])
    scoped.rooms = await tx.select('SELECT r.* FROM rooms r WHERE r.template_id IN (SELECT u.house_type_template_id FROM units u JOIN floors f ON f.id=u.floor_id WHERE f.building_id=?) ORDER BY r.id', [building.id])
    scoped.items = await tx.select('SELECT i.* FROM items i WHERE i.id IN (SELECT q.item_id FROM house_type_template_items q JOIN rooms r ON r.id=q.room_id JOIN units u ON u.house_type_template_id=r.template_id JOIN floors f ON f.id=u.floor_id WHERE f.building_id=?) ORDER BY i.id', [building.id])
    scoped.occupation = graph.schedule_group_buildings!.filter(row => row.building_id === building.id && row.deleted_at === null).map(row => [row.id, row.group_id, graph.schedule_groups!.find(group => group.id === row.group_id)?.deleted_at])
    basis.buildings[building.id] = wbsDigest(scoped)
    basis.contractBuildings[building.id] = wbsDigest([scoped.buildings, scoped.floors, scoped.units, scoped.templates, scoped.occupation])
  }
  const libraries = await readProductionProcessLibraryState(tx, actor)
  for (const library of libraries.versions)
    basis.libraries[library.id] = wbsDigest([library.id, library.version, library.tasks])
  for (const row of await tx.select<Record<string, unknown>>('SELECT * FROM construction_stages WHERE project_id=? ORDER BY id', [projectId]))
    basis.stages[String(row.code)] = wbsDigest([row, await tx.select('SELECT * FROM construction_stage_items WHERE stage_id=? ORDER BY id', [row.id])])
  for (const row of await tx.select<Record<string, unknown>>('SELECT * FROM items WHERE project_id=? ORDER BY id', [projectId]))
    basis.items[String(row.code)] = wbsDigest(row)
  basis.baseline = wbsDigest((await tx.select<Record<string, unknown>>(productionWbsVisibility.selectVisibleSql('schedule_tasks', 'AND project_id=? AND group_id IS NOT NULL ORDER BY id'), [projectId])).map(task => [task.id, task.group_id, task.parent_id, task.planned_start, task.planned_finish, task.baseline_start, task.baseline_finish]))
  if (productionWbsBoqReadable(actor)) {
    for (const row of await productionWbsContracts(tx, actor, projectId)) {
      const head = await productionWbsContract(tx, actor, projectId, row.id)
      basis.contracts[row.id] = { qualification: wbsDigest([head.id, head.projectId, head.status, head.deletedAt, head.projectDeletedAt, head.customerDeletedAt]), audit: wbsDigest([head.no, head.name]) }
      for (const line of await productionWbsBoqLines(tx, actor, projectId, row.id))
        basis.boq[line.id] = { contractId: row.id, itemId: line.itemId, building: line.building, declaredBuildingId: line.declaredBuildingId, shape: wbsDigest([line.qualificationVersion, line.id, line.itemId, line.declaredBuildingId ?? line.building, line.unitType, line.floorZone]), quantity: wbsDigest([line.qty, line.approvedDeltaQty, line.unit]) }
    }
  }
  return `${prefix}${Buffer.from(JSON.stringify(basis)).toString('base64url')}`
}
export async function checkProductionWbsVersion(tx: TransactionDb, actor: BusinessSession, command: ScheduleCommand) {
  const original = decodeProductionWbsVersion(command.sourceVersion)
  const current = decodeProductionWbsVersion(await productionWbsVersion(tx, actor, command.projectId))
  const fail = (): never => {
    throw scheduleProblem('stale-source', '本动作实际采用的WBS或来源范围已变化，请保留原输入重新核对')
  }
  if (original.projectId !== command.projectId || original.project !== current.project)
    fail()
  const group = (id: string | null | undefined) => {
    if (!id || !original.groups[id] || original.groups[id] !== current.groups[id])
      fail()
  }
  const task = (id: string) => {
    if (!original.tasks[id] || original.tasks[id].hash !== current.tasks[id]?.hash)
      fail()
    group(current.tasks[id]?.groupId)
    let parent = current.tasks[id]?.parentId
    while (parent) {
      const expected = original.tasks[parent]
      if (!expected || expected.plan !== current.tasks[parent]?.plan)
        fail()
      parent = current.tasks[parent]?.parentId
    }
  }
  const floor = (id: string) => {
    if (!original.floors[id] || original.floors[id] !== current.floors[id])
      fail()
  }
  const floors = (taskId: string) => {
    if (wbsDigest(original.taskFloorSets[taskId]) !== wbsDigest(current.taskFloorSets[taskId]))
      fail()
    for (const id of current.taskFloorSets[taskId] ?? [])
      floor(id)
  }
  const connected = (id: string) => {
    const edges = (basis: Basis) => Object.entries(basis.edges).filter(([, row]) => row.predId === id || row.succId === id)
    if (wbsDigest(edges(original)) !== wbsDigest(edges(current)))
      fail()
    for (const [, edge] of edges(current)) {
      for (const endpoint of [edge.predId, edge.succId]) {
        if (original.tasks[endpoint]?.plan !== current.tasks[endpoint]?.plan)
          fail()
      }
    }
  }
  const action = command.action
  const upstream = async (contractId: string, buildingIds: readonly string[], itemIds?: readonly string[], comparison = false) => {
    const head = original.contracts[contractId]
    if (!head || head.qualification !== current.contracts[contractId]?.qualification || (comparison && head.audit !== current.contracts[contractId]?.audit))
      fail()
    const rows = (basis: Basis) => Object.entries(basis.boq).filter(([, row]) => row.contractId === contractId && buildingIds.includes(resolveScheduleBoqBuildingReference(Object.values(basis.buildingRefs), row)?.id ?? '') && (!itemIds || (row.itemId !== null && itemIds.includes(row.itemId)))).map(([id, row]) => [id, row.shape, ...(comparison ? [row.quantity] : [])])
    if (wbsDigest(rows(original)) !== wbsDigest(rows(current)))
      fail()
    const coverage = (basis: Basis) => Object.entries(basis.boq).filter(([, row]) => row.contractId === contractId && buildingIds.includes(resolveScheduleBoqBuildingReference(Object.values(basis.buildingRefs), row)?.id ?? '')).map(([id, row]) => [id, row.declaredBuildingId ?? row.building])
    if (wbsDigest(coverage(original)) !== wbsDigest(coverage(current)))
      fail()
  }
  const selectedMappings = async (libraryId: string, keys: string[]) => {
    const library = (await readProductionProcessLibraryState(tx, actor)).versions.find(row => row.id === libraryId) ?? fail()
    if (original.libraries[libraryId] !== current.libraries[libraryId])
      fail()
    for (const key of keys) {
      const template = library.tasks.find(task => task.key === key) ?? fail()
      if (template.stageCode && (!original.stages[template.stageCode] || original.stages[template.stageCode] !== current.stages[template.stageCode]))
        fail()
      for (const code of template.itemCodes) {
        if (!original.items[code] || original.items[code] !== current.items[code])
          fail()
      }
    }
  }
  if (action.kind === 'create-group') {
    const id = action.draft.processLibraryId ?? ''
    if (!original.libraries[id] || original.libraries[id] !== current.libraries[id] || original.names[action.draft.name.trim()] !== current.names[action.draft.name.trim()])
      fail()
    await selectedMappings(id, action.draft.tasks.filter(task => task.enabled).map(task => task.templateKey))
    for (const id of action.draft.buildingIds) {
      const before = action.draft.scopeBasis !== 'provisional' ? original.contractBuildings[id] : original.buildings[id]
      const after = action.draft.scopeBasis !== 'provisional' ? current.contractBuildings[id] : current.buildings[id]
      if (!before || before !== after)
        fail()
    }
    if (action.draft.scopeBasis !== 'provisional') {
      const library = (await readProductionProcessLibraryState(tx, actor)).versions.find(row => row.id === action.draft.processLibraryId)
      const codes = library?.tasks.filter(task => action.draft.tasks.some(input => input.enabled && input.templateKey === task.key)).flatMap(task => task.itemCodes) ?? []
      const itemIds = (await tx.select<{ id: string, code: string }>('SELECT id,code FROM items WHERE project_id=? AND deleted_at IS NULL', [command.projectId])).filter(row => codes.includes(row.code)).map(row => row.id)
      await upstream(action.draft.contractId ?? '', action.draft.buildingIds, itemIds)
    }
  }
  else if (action.kind === 'set-baseline') {
    if (original.baseline !== current.baseline)
      fail()
  }
  else if (action.kind === 'add-task' || action.kind === 'bind-contract') {
    group(action.groupId)
    const graph = await productionWbsGraph(tx, command.projectId)
    const groupRow = graph.schedule_groups!.find(group => group.id === action.groupId)
    const buildingIds = graph.schedule_group_buildings!.filter(row => row.group_id === action.groupId && row.deleted_at === null).map(row => String(row.building_id))
    if (action.kind === 'bind-contract') {
      if (original.bindingGroups[action.groupId] !== current.bindingGroups[action.groupId])
        fail()
      await upstream(action.contractId, buildingIds, undefined, true)
    }
    if (action.kind === 'add-task') {
      if (original.members[action.groupId] !== current.members[action.groupId])
        fail()
      const libraryId = String(graph.schedule_groups!.find(group => group.id === action.groupId)?.process_library_id ?? '')
      await selectedMappings(libraryId, [action.draft.templateKey])
      if (groupRow?.scope_basis === 'contract') {
        const template = (await readProductionProcessLibraryState(tx, actor)).versions.find(row => row.id === libraryId)?.tasks.find(task => task.key === action.draft.templateKey)
        const itemIds = (await tx.select<{ id: string, code: string }>('SELECT id,code FROM items WHERE project_id=? AND deleted_at IS NULL', [command.projectId])).filter(row => template?.itemCodes.includes(row.code)).map(row => row.id)
        await upstream(String(groupRow.contract_id), buildingIds, itemIds)
      }
      const last = graph.schedule_tasks!.filter(task => task.group_id === action.groupId && task.deleted_at === null).sort((a, b) => Number(a.sort_order) - Number(b.sort_order)).at(-1)
      if (last && original.tasks[String(last.id)]?.plan !== current.tasks[String(last.id)]?.plan)
        fail()
      const scope = (await productionWbsGraph(tx, command.projectId)).schedule_group_buildings!.filter(row => row.group_id === action.groupId && row.deleted_at === null)
      for (const row of scope) {
        const id = String(row.building_id)
        const before = groupRow?.scope_basis === 'contract' ? original.contractBuildings[id] : original.buildings[id]
        const after = groupRow?.scope_basis === 'contract' ? current.contractBuildings[id] : current.buildings[id]
        if (!before || before !== after)
          fail()
      }
    }
  }
  else if (action.kind === 'undo') {
    for (const id of action.logIds) {
      if (!original.logs[id] || original.logs[id].hash !== current.logs[id]?.hash)
        fail()
      group(current.logs[id]?.groupId)
      const log = current.logs[id]!
      if (log.table === 'schedule_tasks') {
        task(log.recordId)
        connected(log.recordId)
        floors(log.recordId)
      }
    }
  }
  else if (action.kind === 'remove-dependency' || action.kind === 'restore-dependency') {
    if (original.edges[action.dependencyId]?.hash !== current.edges[action.dependencyId]?.hash || !current.edges[action.dependencyId])
      fail()
    const edge = current.edges[action.dependencyId]!
    task(edge.succId)
    task(edge.predId)
    if (action.kind === 'restore-dependency' && original.topology[current.tasks[edge.succId]!.groupId!] !== current.topology[current.tasks[edge.succId]!.groupId!])
      fail()
  }
  else if (action.kind === 'update-dependency') {
    task(action.successorId)
    task(action.predecessorId)
    const groupId = current.tasks[action.successorId]!.groupId!
    if (original.topology[groupId] !== current.topology[groupId])
      fail()
  }
  else if ('taskId' in action) {
    task(action.taskId)
    if (action.kind === 'update-floors') {
      for (const patch of action.patches)
        floor(patch.id)
    }
    else if (action.kind === 'remove-task') {
      connected(action.taskId)
      floors(action.taskId)
      const descendants = (basis: Basis) => Object.entries(basis.tasks).filter(([, row]) => row.parentId === action.taskId)
      if (wbsDigest(descendants(original)) !== wbsDigest(descendants(current)))
        fail()
    }
    else {
      const patch = action.kind === 'save-task-plan' ? action.draft.task : action.patch
      if (patch.plannedStart !== undefined || patch.plannedFinish !== undefined) {
        floors(action.taskId)
        connected(action.taskId)
      }
      if (action.kind === 'save-task-plan') {
        for (const patch of action.draft.floorPlans)
          floor(patch.id)
      }
      if (action.kind === 'save-task-plan' && action.draft.dependency) {
        task(action.draft.dependency.predecessorId)
        const groupId = current.tasks[action.taskId]!.groupId!
        if (original.topology[groupId] !== current.topology[groupId])
          fail()
      }
    }
  }
  else { fail() }
}
