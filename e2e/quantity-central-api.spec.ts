import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { decodeQuantityRegion, decodeQuantityTemplates } from '../app/lib/quantity/central-decoder'

test('工程量真实 HTTP 从中央新项目保存区域与模板，重读并拒绝身份、版本和来源错配', async ({ request }) => {
  test.setTimeout(120_000)
  const headers = { 'x-ruihang-test-session': `quantity-api-${randomUUID()}` }
  const session = await (await request.get('/api/read/business-session', { headers })).json()
  const projectResponse = await request.post('/api/commands/projects', {
    headers,
    data: { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'project:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft: { name: '中央工程量接口项目', manager: '合成经办人', status: '筹备中' }, attachments: {} },
  })
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
  const project = await projectResponse.json()
  const query = { projectId: project.id as string, origin: 'real' as const, includeDemo: false }
  const initial = await request.get('/api/read/quantity/region', { headers, params: query })
  expect(initial.ok(), await initial.text()).toBe(true)
  const first = decodeQuantityRegion(await initial.json(), query)
  let version = first.sourceVersion
  const execute = async (action: Record<string, unknown>) => {
    const command = { workspaceId: session.workspaceId, actorId: session.actorId, projectId: project.id, origin: 'real', requiredCapability: 'quantity:write', commandId: randomUUID(), baseVersion: version, action }
    const response = await request.post('/api/commands/quantity', { headers, data: command })
    expect(response.ok(), await response.text()).toBe(true)
    const saved = await response.json()
    version = saved.sourceVersion
    const retry = await request.post('/api/commands/quantity', { headers, data: command })
    expect(retry.ok(), await retry.text()).toBe(true)
    expect(await retry.json()).toEqual(saved)
    return saved
  }
  const building = await execute({ kind: 'create-building', draft: { code: 'B1', name: '1栋' } })
  const floor = await execute({ kind: 'create-floor', buildingId: building.id, draft: { code: 'F1', name: '1层' } })
  const template = await execute({
    kind: 'save-template',
    draft: { id: null, projectId: project.id, code: 'A', name: 'A户型', copiedFromTemplateId: null, sortOrder: 1, expectedUpdatedAt: null, rooms: [{ key: 'whole', id: null, code: '__whole_unit__', name: '整户范围', kind: 'whole_unit', sortOrder: -1 }], newItems: [{ key: 'wall', code: 'W', name: '墙面', section: '', trade: '泥水工', unit: '㎡', sortOrder: 1 }], lines: [{ key: 'line', id: null, roomKey: 'whole', itemId: 'wall', recognizedContractQty: null, contractQty: 0, provisionalQty: null, fieldFormula: '2 * 3', fieldQty: 999, note: '', sortOrder: 1 }] },
  })
  const unit = await execute({ kind: 'create-unit', floorId: floor.id, draft: { code: '101', name: '101室', templateId: template.id } })
  const area = decodeQuantityRegion(await (await request.get('/api/read/quantity/region', { headers, params: query })).json(), query)
  expect(area.data).toMatchObject({ projectName: '中央工程量接口项目', buildings: [{ id: building.id }], floors: [{ id: floor.id }], units: [{ id: unit.id }] })
  const templates = decodeQuantityTemplates(await (await request.get('/api/read/quantity/templates', { headers, params: query })).json(), query)
  expect(templates.data.lines).toEqual([expect.objectContaining({ contractQty: 0, provisionalQty: null, fieldQty: 6 })])
  const base = { workspaceId: session.workspaceId, actorId: session.actorId, projectId: project.id, origin: 'real', requiredCapability: 'quantity:write', commandId: randomUUID(), baseVersion: version, action: { kind: 'create-building', draft: { code: 'B2', name: '2栋' } } }
  expect((await request.post('/api/commands/quantity', { headers, data: { ...base, actorId: 'forged' } })).status()).toBe(403)
  expect((await request.post('/api/commands/quantity', { headers, data: { ...base, baseVersion: first.sourceVersion } })).status()).toBe(409)
  expect((await request.get('/api/read/quantity/region', { headers, params: { ...query, origin: 'demo' } })).status()).toBe(403)
  expect((await request.post('/api/commands/quantity', { headers, data: { ...base, action: { kind: 'create-building', draft: { code: 'B1', name: '重复编码' } } } })).status()).toBe(422)
  expect(decodeQuantityRegion(await (await request.get('/api/read/quantity/region', { headers, params: query })).json(), query).data.buildings).toHaveLength(1)
})
