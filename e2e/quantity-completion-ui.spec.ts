import type { QuantityCommand } from '../app/lib/quantity/central-contract'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { blankQuantityTemplateDraft } from '../app/lib/quantity/template'

test.use({ actionTimeout: 15_000 })

test('中央责任、缺照草稿、照片完成和责任替换保留历史，批量软卡逐项回读', async ({ page }) => {
  test.setTimeout(180_000)
  const headers = { 'x-ruihang-test-session': `quantity-completion-ui-${randomUUID()}` }
  await page.context().setExtraHTTPHeaders(headers)
  const session = await (await page.request.get('/api/read/business-session')).json()
  const create = async (entity: string, capability: string, draft: Record<string, unknown>, action = 'draft') => {
    const response = await page.request.post(`/api/commands/${entity}`, { data: { ...session, requiredCapability: capability, commandId: randomUUID(), baseVersion: null, action, draft, attachments: {} } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const { id: projectId } = await create('projects', 'project:write', { name: '责任完成整链验收项目', manager: '合成经办人', status: '筹备中' })
  const createCrew = (name: string) => create('crews', 'crew:write', { name, contactName: '合成负责人', contactPhone: '13800000000', trade: '泥水工', capabilityTrades: ['泥水工'], capabilityItems: ['墙面抹灰'], defaultPayRatio: 0.8, assignmentLevel: 'worker' }, 'save')
  const crews: [{ id: string }, { id: string }] = [await createCrew('原责任班组'), await createCrew('替换责任班组')]
  const query = { projectId, origin: 'real', includeDemo: false }
  const read = async (kind: string, params: Record<string, string | boolean> = {}) => {
    const response = await page.request.get(`/api/read/quantity/${kind}`, { params: { ...query, ...params } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const execute = async (action: QuantityCommand['action']) => {
    const current = await read('region')
    const response = await page.request.post('/api/commands/quantity', { data: { workspaceId: session.workspaceId, actorId: session.actorId, projectId, origin: 'real', requiredCapability: 'quantity:write', commandId: randomUUID(), baseVersion: current.sourceVersion, action } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const draft = blankQuantityTemplateDraft(projectId)
  Object.assign(draft, { code: 'A', name: '验收户型' })
  draft.newItems = [{ key: 'wall', code: 'WALL', name: '墙面抹灰', section: '', trade: '泥水工', unit: '㎡', sortOrder: 1 }]
  draft.lines = [{ key: 'line', id: null, roomKey: draft.rooms[0]!.key, itemId: 'wall', recognizedContractQty: null, contractQty: 0, provisionalQty: null, fieldFormula: '2*3', fieldQty: 6, note: '', sortOrder: 1 }]
  const template = await execute({ kind: 'save-template', draft })
  const itemId = (await read('templates')).data.items[0].id
  const building = await execute({ kind: 'create-building', draft: { code: '1', name: '第一栋' } })
  const floor = await execute({ kind: 'create-floor', buildingId: building.id, draft: { code: '1', name: '第一层' } })
  const createUnit = (code: string) => execute({ kind: 'create-unit', floorId: floor.id, draft: { code, name: `${code}户`, templateId: template.id } })
  const units: [{ id: string }, { id: string }] = [await createUnit('101'), await createUnit('102')]
  const stages = []
  for (const [index, name] of ['基层验收', '面层验收'].entries())
    stages.push(await execute({ kind: 'save-stage', allowArchivedEdit: false, draft: { id: null, code: `S${index}`, name, trade: '泥水工', completionMode: 'unit', sortOrder: index, itemIds: [itemId] } }))
  await execute({ kind: 'set-reporting-stage', itemId, stageId: stages[1].id, allowArchivedEdit: false })
  const matrixUrl = `/subcontract/quantity?project=${projectId}&origin=real`
  const capture = async (name: string, focus: import('@playwright/test').Locator) => {
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 12_000 })
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await focus.scrollIntoViewIfNeeded()
      await focus.focus()
      await expect(focus).toBeFocused()
      await focus.click({ trial: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    }
  }
  await page.goto(matrixUrl)
  await expect(page.getByRole('button', { name: '责任配置', exact: true })).toBeVisible({ timeout: 45_000 })
  await page.getByRole('button', { name: '责任配置', exact: true }).click()
  const assignment = page.getByRole('dialog', { name: '户 × 工种责任配置', exact: true })
  await assignment.getByRole('combobox', { name: '班组', exact: true }).click()
  await page.getByRole('option', { name: /原责任班组/ }).click()
  await assignment.getByRole('button', { name: '全选当前楼栋', exact: true }).click()
  await capture('assignment', assignment.getByRole('combobox', { name: '班组', exact: true }))
  await assignment.getByRole('button', { name: '保存责任', exact: true }).click()
  await expect(assignment).toBeHidden()
  expect((await read('assignments')).data.assignments).toEqual(expect.arrayContaining(units.map(unit => expect.objectContaining({ unitId: unit.id, assigneeId: crews[0].id }))))

  await page.goto(`/subcontract/quantity/${projectId}/${units[0].id}?origin=real&returnTo=${encodeURIComponent(matrixUrl)}`)
  await page.getByRole('button', { name: '登记', exact: true }).first().click()
  const completion = page.getByRole('dialog', { name: /阶段完成登记$/ })
  await completion.getByRole('textbox', { name: '备注', exact: true }).fill('缺照取消后保留')
  await completion.getByRole('button', { name: '登记完成', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '缺少验收照片', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(completion.getByRole('textbox', { name: '备注', exact: true })).toHaveValue('缺照取消后保留')
  await completion.getByRole('button', { name: '登记完成', exact: true }).click()
  await page.getByRole('button', { name: '保存到草稿', exact: true }).click()
  await expect.poll(async () => (await read('completion', { unitId: units[0].id })).data.stages[0].completion?.status).toBe('draft')
  await completion.getByRole('tab', { name: '登记完成', exact: true }).click()
  const chooserPromise = page.waitForEvent('filechooser')
  await completion.getByRole('button', { name: '添加照片', exact: true }).click()
  const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=', 'base64')
  await (await chooserPromise).setFiles({ name: '验收原件.png', mimeType: 'image/png', buffer: photo })
  await expect(completion.getByText('验收原件.png', { exact: true })).toBeVisible()
  await capture('completion', completion.getByRole('button', { name: '移除照片 验收原件.png', exact: true }))
  await completion.getByRole('button', { name: '登记完成', exact: true }).click()
  await expect.poll(async () => (await read('completion', { unitId: units[0].id })).data.stages[0].completion?.status).toBe('completed')
  await completion.getByRole('button', { name: '取消', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '预览照片 验收原件.png', exact: true }).click()
  const image = page.getByRole('img', { name: '验收照片 验收原件.png', exact: true })
  await expect(image).toBeVisible()
  expect((await image.getAttribute('src'))?.split(',')[1]).toBe(photo.toString('base64'))
  await page.keyboard.press('Escape')
  await capture('detail', page.getByRole('button', { name: '登记', exact: true }).first())
  const originalFact = (await read('completion', { unitId: units[0].id })).data.stages[0].completion
  await page.getByRole('link', { name: '返回工程量矩阵', exact: true }).click()
  await page.getByRole('button', { name: '责任配置', exact: true }).click()
  await assignment.getByRole('combobox', { name: '班组', exact: true }).click()
  await page.getByRole('option', { name: /替换责任班组/ }).click()
  await assignment.getByRole('checkbox', { name: '选择第一层101户', exact: true }).check()
  await assignment.getByRole('button', { name: '保存责任', exact: true }).click()
  await page.getByRole('button', { name: '确认替换', exact: true }).click()
  await expect(assignment).toBeHidden()
  const historic = (await read('completion', { unitId: units[0].id })).data.stages[0]
  expect(historic.currentAssignment.assigneeId).toBe(crews[1].id)
  expect(historic.completion.assignmentId).toBe(originalFact.assignmentId)
  expect(historic.completion.executionAssigneeName).toBe('原责任班组')
  expect(historic.completion.assignmentId).not.toBe(historic.currentAssignment.id)

  await page.getByRole('button', { name: '批量完成', exact: true }).click()
  const batch = page.getByRole('dialog', { name: /批量完成/ })
  await batch.getByRole('button', { name: '全选当前楼栋', exact: true }).click()
  await batch.getByRole('button', { name: '展开阶段', exact: true }).click()
  await expect(batch.getByText('将提交 3 项：0 项登记完成、3 项存草稿。', { exact: true })).toBeVisible()
  await capture('batch', batch.getByRole('checkbox').last())
  await batch.getByRole('button', { name: '提交批量登记', exact: true }).click()
  await expect(batch.getByText('提交结果（按阶段回显）', { exact: true })).toBeVisible()
  expect((await read('completion', { unitId: units[0].id })).data.stages.map((stage: { completion: { status: string } }) => stage.completion.status)).toEqual(['completed', 'draft'])
  expect((await read('completion', { unitId: units[1].id })).data.stages.every((stage: { completion: { status: string } }) => stage.completion.status === 'draft')).toBe(true)
})
