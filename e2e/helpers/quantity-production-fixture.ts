import type { Page } from '@playwright/test'
import type { QuantityCommand } from '../../app/lib/quantity/central-contract'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import { blankQuantityTemplateDraft } from '../../app/lib/quantity/template'

/** 每例隔离中央会话，经正式命令创建事实；页面不读取旧浏览器 SQL 快照。 */
export async function installQuantityProductionFixture(page: Page, options: { totals?: boolean, detailedStages?: boolean } = {}) {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `quantity-fixture-${randomUUID()}` })
  const session = await (await page.request.get('/api/read/business-session')).json()
  const create = async (entity: string, capability: string, draft: Record<string, unknown>, action = 'save') => {
    const response = await page.request.post(`/api/commands/${entity}`, { data: { ...session, requiredCapability: capability, commandId: randomUUID(), baseVersion: null, action, draft, attachments: {} } })
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
    const response = await page.request.post('/api/commands/quantity', { data: { ...session, projectId, origin: 'real', requiredCapability: 'quantity:write', commandId: randomUUID(), baseVersion: version, action } })
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
  return { projectId, matrixUrl, units, read, execute }
}
