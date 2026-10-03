import type { Page } from '@playwright/test'
import type { QuantityCommand } from '../../app/lib/quantity/central-contract'
import type { ScheduleAction, ScheduleRead } from '../../app/lib/schedule/central-contract'
import type { ProcessLibraryVersion } from '../../app/lib/schedule/process-library-contract'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import { blankQuantityTemplateDraft } from '../../app/lib/quantity/template'

/** 每例隔离中央会话，经正式命令创建事实；页面不读取旧浏览器 SQL 快照。 */
export async function installQuantityProductionFixture(page: Page, options: { totals?: boolean, detailedStages?: boolean } = {}) {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `quantity-fixture-${randomUUID()}` })
  const session = await (await page.request.get('/api/read/business-session')).json()
  const identity = { workspaceId: session.workspaceId, actorId: session.actorId }
  const create = async (entity: string, capability: string, draft: Record<string, unknown>, action = 'save') => {
    const response = await page.request.post(`/api/commands/${entity}`, { data: { ...identity, requiredCapability: capability, commandId: randomUUID(), baseVersion: null, action, draft, attachments: {} } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const project = await create('projects', 'project:write', { name: 'E2E正式工程量项目', manager: '合成经办人', status: '筹备中' }, 'draft')
  const projectId: string = project.id
  const query = { projectId, origin: 'real', includeDemo: false }
  const read = async (kind: string, params: Record<string, string> = {}) => {
    const response = await page.request.get(`/api/read/quantity/${kind}`, { params: { ...query, ...params } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  let version: string
  const execute = async (action: QuantityCommand['action']) => {
    const response = await page.request.post('/api/commands/quantity', { data: { ...identity, projectId, origin: 'real', requiredCapability: 'quantity:write', commandId: randomUUID(), baseVersion: version, action } })
    expect(response.ok(), await response.text()).toBe(true)
    const result = await response.json()
    version = result.sourceVersion
    return result
  }
  const crews: string[] = []
  for (const [name, trade] of [['泥水A班', '泥水工'], ['泥水B班', '泥水工'], ['水电班', '水暖工']]) {
    const crew = await create('crews', 'crew:write', { name, trade, contactName: '合成负责人', contactPhone: '13800000000', capabilityTrades: [trade], capabilityItems: [], defaultPayRatio: 0.8, assignmentLevel: 'worker' })
    crews.push(crew.id)
  }
  await create('workers', 'worker:write', { name: '周伟峰', phone: '13800000002', idCard: '440101199001011234', bankName: '示例银行', bankAccount: '6222000000001234', trade: '水暖工', crewId: crews[2], capabilityTrades: ['水暖工'], capabilityItems: ['给排水管安装'], safetyEducation: true, projectStatus: '在场' })
  version = (await read('region')).sourceVersion
  const draft = blankQuantityTemplateDraft(projectId)
  Object.assign(draft, { code: 'A', name: 'A户型' })
  draft.newItems = [
    { key: 'masonry', code: 'MASONRY', name: '墙砖铺贴', section: '装饰', trade: '泥水工', unit: '㎡', sortOrder: 0 },
    { key: 'length', code: 'LENGTH', name: options.totals ? '踢脚线' : '给排水管安装', section: '安装', trade: options.totals ? '泥水工' : '水暖工', unit: 'm', sortOrder: 1 },
  ]
  if (options.detailedStages) {
    draft.newItems.push({ key: 'floor', code: 'FLOOR', name: '地砖铺贴', section: '装饰', trade: '泥水工', unit: '㎡', sortOrder: 2 })
    draft.newItems.push({ key: 'waterproof', code: 'WATERPROOF', name: '防水涂膜', section: '装饰', trade: '防水工', unit: '㎡', sortOrder: 3 })
  }
  draft.lines = draft.newItems.map((item, index) => ({ key: `line-${item.key}`, id: null, roomKey: draft.rooms[0]!.key, itemId: item.key, recognizedContractQty: null, contractQty: options.totals && index === 0 ? 0 : index === 1 ? 8 : 12, provisionalQty: index === 1 ? 8 : 12, fieldQty: index === 1 ? 8 : 12, fieldFormula: index === 1 ? '8' : '12', note: '', sortOrder: index }))
  if (options.totals) {
    draft.rooms.push({ key: 'extra', id: null, code: 'EXTRA', name: '次卧', kind: 'room', sortOrder: 1 })
    draft.lines.push({ key: 'partial', id: null, roomKey: 'extra', itemId: 'masonry', recognizedContractQty: null, contractQty: 0, provisionalQty: 18, fieldQty: null, fieldFormula: '', note: '', sortOrder: 3 })
  }
  const template = await execute({ kind: 'save-template', draft })
  const items: Array<{ id: string, code: string }> = (await read('templates')).data.items
  const itemId = (code: string) => items.find(item => item.code === code)!.id
  const building = await execute({ kind: 'create-building', draft: { code: 'B1', name: '1栋' } })
  const units: Record<string, string> = {}
  for (const number of ['2', '1']) {
    const floor = await execute({ kind: 'create-floor', buildingId: building.id, draft: { code: `F${number}`, name: `${number}层` } })
    for (const suffix of ['01', '02']) {
      const code = `${number}${suffix}`
      const unit = await execute({ kind: 'create-unit', floorId: floor.id, draft: { code, name: `${code}户`, templateId: template.id } })
      units[code] = unit.id
    }
  }
  const stage = async (code: string, name: string, trade: string, itemIds: string[], sortOrder: number) => execute({ kind: 'save-stage', allowArchivedEdit: false, draft: { id: null, code, name, trade, completionMode: 'unit', itemIds, sortOrder } })
  const masonry = await stage('MASONRY-DONE', '泥水完成', '泥水工', options.totals ? [itemId('MASONRY'), itemId('LENGTH')] : [itemId('MASONRY')], 0)
  if (!options.totals)
    await stage('PLUMBING-DONE', '水暖完成', '水暖工', [itemId('LENGTH')], 1)
  if (options.detailedStages) {
    await stage('FLOOR-DONE', '地砖完成', '泥水工', [itemId('FLOOR')], 2)
    await stage('WATERPROOF-FIRST', '防水一遍', '防水工', [itemId('WATERPROOF')], 3)
    await stage('WATERPROOF-SECOND', '防水二遍', '防水工', [itemId('WATERPROOF')], 4)
  }
  for (const [index, unitIds] of [[0, [units['201']!, units['101']!]], [1, [units['202']!, units['102']!]]] as const)
    await execute({ kind: 'save-assignments', draft: { projectId, trade: '泥水工', assigneeKind: 'crew', assigneeId: crews[index]!, unitIds: [...unitIds], expectedAssignments: unitIds.map(unitId => ({ unitId, assignmentId: null, fingerprint: null })), scopes: [], allowReplacement: false } })
  const complete = async (stageId: string) => {
    const current = (await read('completion', { unitId: units['201']! })).data.stages.find((row: { id: string }) => row.id === stageId)
    const contentBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII='
    await execute({ kind: 'save-completion', draft: { projectId, unitId: units['201']!, stageId, status: 'completed', completedAt: '2026-08-01', note: '保存责任替换后仍保留完成时责任', expectedCompletionId: null, expectedCompletionFingerprint: null, expectedAssignmentId: current.currentAssignment.id, photos: [{ fileName: '历史验收.png', mimeType: 'image/png', fileSize: Buffer.from(contentBase64, 'base64').length, contentBase64 }] } })
  }
  await complete(masonry.id)
  if (options.totals) {
    for (const code of ['MASONRY', 'LENGTH'])
      await execute({ kind: 'set-reporting-stage', itemId: itemId(code), stageId: masonry.id, allowArchivedEdit: false })
    const shared = await stage('SHARED', '共用分项复验', '泥水工', [itemId('MASONRY')], 2)
    await complete(shared.id)
  }
  const matrixUrl = `/subcontract/quantity?project=${projectId}&origin=real`
  await page.goto(matrixUrl)
  await expect(page.getByTestId('quantity-matrix-cell').first()).toBeVisible({ timeout: 30_000 })
  return { projectId, matrixUrl, units, templateId: template.id, create, read, execute }
}

/** 复用正式工程量来源，排程和库版本同样经中央命令创建。 */
export async function installScheduleProductionFixture(page: Page, options: { createGroup?: boolean, startDate?: string } = {}) {
  const quantity = await installQuantityProductionFixture(page)
  const session = await (await page.request.get('/api/read/business-session')).json()
  const catalog = (await quantity.read('templates')).data
  const building = await quantity.execute({ kind: 'create-building', draft: { code: 'B2', name: '2栋' } })
  const floor = await quantity.execute({ kind: 'create-floor', buildingId: building.id, draft: { code: 'F1', name: '1层' } })
  await quantity.execute({ kind: 'create-unit', floorId: floor.id, draft: { code: '101', name: '101户', templateId: catalog.templates[0].id } })
  const libraryTasks = [
    { key: 'layout', name: '放线及新建墙体', trade: '其他', color: '#64748b', durationDays: 2, stageCode: '', itemCodes: [], predecessorKey: null, predecessorDisabled: false },
    { key: 'plumbing', name: '给排水安装', trade: '其他', color: '#64748b', durationDays: 3, stageCode: '', itemCodes: [], predecessorKey: 'layout', predecessorDisabled: false },
    { key: 'waterproof', name: '卫生间回填及防水', trade: '泥水工', color: '#0f766e', durationDays: 4, stageCode: 'MASONRY-DONE', itemCodes: ['MASONRY'], predecessorKey: 'plumbing', predecessorDisabled: false },
    { key: 'cleanup', name: '开荒保洁', trade: '其他', color: '#64748b', durationDays: 2, stageCode: '', itemCodes: [], predecessorKey: 'waterproof', predecessorDisabled: false },
  ]
  const libraryResponse = await page.request.post('/api/commands/process-libraries', {
    data: { workspaceId: session.workspaceId, actorId: session.actorId, commandId: randomUUID(), origin: 'real', requiredCapability: 'process-library:write', action: 'create-version', baseVersion: 0, sourceVersion: null, draft: { sourceLibraryId: null, code: 'E2E-SCHEDULE', name: 'E2E四工序库', description: '正式排程验收输入', tasks: libraryTasks } },
  })
  expect(libraryResponse.ok(), await libraryResponse.text()).toBe(true)
  const receipt = await libraryResponse.json()
  const libraryResponseRead = await page.request.get(`/api/read/process-libraries/${receipt.id}?origin=real`)
  expect(libraryResponseRead.ok(), await libraryResponseRead.text()).toBe(true)
  const library: ProcessLibraryVersion = await libraryResponseRead.json()
  const readSchedule = async (): Promise<ScheduleRead> => {
    const response = await page.request.get('/api/read/schedule/workspace', { params: { projectId: quantity.projectId, origin: 'real', includeDemo: false } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const executeSchedule = async (action: ScheduleAction) => {
    const current = await readSchedule()
    const response = await page.request.post('/api/commands/schedule', { data: { workspaceId: session.workspaceId, actorId: session.actorId, commandId: randomUUID(), origin: 'real', requiredCapability: 'schedule:write', projectId: quantity.projectId, sourceVersion: current.sourceVersion, action } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  if (options.createGroup !== false) {
    const region = (await quantity.read('region')).data
    await executeSchedule({ kind: 'create-group', draft: { projectId: quantity.projectId, scopeBasis: 'provisional', contractId: null, processLibraryId: library.id, librarySourceVersion: library.sourceVersion, name: '正式一栋组', buildingIds: [region.buildings.find((row: { code: string }) => row.code === 'B1').id], startDate: options.startDate ?? '2026-08-01', overlapMode: 'seq', tasks: libraryTasks.map(task => ({ templateKey: task.key, durationDays: task.durationDays, enabled: true, anchorStart: null })) } })
  }
  return { ...quantity, library, readSchedule, executeSchedule, newBuildingId: building.id, scheduleUrl: `/schedule?project=${quantity.projectId}&origin=real`, wizardUrl: `/schedule/new?project=${quantity.projectId}&origin=real` }
}
