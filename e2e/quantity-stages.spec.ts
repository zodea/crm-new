import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

test.use({ actionTimeout: 15_000 })

test('中央新项目建立两个阶段，显式报量逐项保存不丢草稿，五档可操作且取消归档修改保留输入', async ({ page }, testInfo) => {
  test.setTimeout(150_000)
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error')
      browserErrors.push(message.text())
  })
  const headers = { 'x-ruihang-test-session': `stage-ui-${randomUUID()}` }
  await page.context().setExtraHTTPHeaders(headers)
  const session = await (await page.request.get('/api/read/business-session', { headers })).json()
  const created = await page.request.post('/api/commands/projects', { headers, data: { ...session, requiredCapability: 'project:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft: { name: '阶段配置验收项目', manager: '合成经办人', status: '筹备中' }, attachments: {} } })
  expect(created.ok(), await created.text()).toBe(true)
  const { id: projectId } = await created.json()
  const query = { projectId, origin: 'real', includeDemo: false }
  const read = async () => {
    const response = await page.request.get('/api/read/quantity/stages', { headers, params: query })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const initial = await read()
  expect(initial.data.stages).toEqual([])
  const template = await page.request.post('/api/commands/quantity', { headers, data: {
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    projectId,
    origin: 'real',
    requiredCapability: 'quantity:write',
    commandId: randomUUID(),
    baseVersion: initial.sourceVersion,
    action: { kind: 'save-template', draft: { id: null, projectId, code: 'A', name: 'A户型', copiedFromTemplateId: null, sortOrder: 0, expectedUpdatedAt: null, rooms: [{ key: 'whole', id: null, code: '__whole_unit__', name: '整户范围', kind: 'whole_unit', sortOrder: -1 }], newItems: ['腻子', '涂料'].map((name, index) => ({ key: `item-${index}`, code: `P${index}`, name, section: '', trade: '油漆工', unit: '㎡', sortOrder: index })), lines: [0, 1].map(index => ({ key: `line-${index}`, id: null, roomKey: 'whole', itemId: `item-${index}`, recognizedContractQty: null, contractQty: 1, provisionalQty: 1, fieldFormula: '1', fieldQty: 1, note: '', sortOrder: index })) } },
  } })
  expect(template.ok(), await template.text()).toBe(true)
  await page.goto(`/subcontract/quantity/stages?project=${projectId}&origin=real`)
  try {
    await expect(page.getByRole('textbox', { name: '阶段编码', exact: true })).toBeVisible({ timeout: 15_000 })
  }
  catch (cause) {
    await testInfo.attach('browser-errors', { body: JSON.stringify(browserErrors), contentType: 'application/json' })
    throw cause
  }
  for (const [code, name] of [['FIRST', '第一遍'], ['SECOND', '第二遍']]) {
    if (code === 'SECOND')
      await page.getByRole('button', { name: '新建阶段', exact: true }).click()
    await page.getByRole('textbox', { name: '阶段编码', exact: true }).fill(code!)
    await page.getByRole('textbox', { name: '阶段名称', exact: true }).fill(name!)
    await page.getByRole('checkbox', { name: '关联腻子', exact: true }).check()
    await page.getByRole('checkbox', { name: '关联涂料', exact: true }).check()
    await page.getByRole('button', { name: '保存阶段', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '阶段编码', exact: true })).toHaveAttribute('readonly', '')
    await expect(page.getByRole('textbox', { name: '阶段名称', exact: true })).toHaveValue(name!)
  }
  let current = await read()
  expect(current.data.stages).toHaveLength(2)
  expect(current.data.mappings.every((row: { isReportingStage: boolean }) => !row.isReportingStage)).toBe(true)
  const second = current.data.stages.find((row: { code: string }) => row.code === 'SECOND').id
  await page.getByLabel('腻子的报量阶段', { exact: true }).selectOption(second)
  await page.getByLabel('涂料的报量阶段', { exact: true }).selectOption(second)
  await page.getByRole('button', { name: '保存腻子的报量阶段', exact: true }).click()
  await expect(page.getByLabel('腻子的报量阶段', { exact: true })).toBeEnabled()
  await expect(page.getByLabel('涂料的报量阶段', { exact: true })).toHaveValue(second)
  await expect(page.getByRole('button', { name: '保存涂料的报量阶段', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '保存涂料的报量阶段', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存涂料的报量阶段', exact: true })).toBeDisabled()
  current = await read()
  expect(current.data.mappings.filter((row: { isReportingStage: boolean }) => row.isReportingStage)).toHaveLength(2)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 12_000 })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const name = page.getByRole('textbox', { name: '阶段名称', exact: true })
    await name.scrollIntoViewIfNeeded()
    await name.focus()
    await expect(name).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    if (width === 390) {
      await page.getByLabel('涂料的报量阶段', { exact: true }).scrollIntoViewIfNeeded()
    }
  }
  const archived = await page.request.post('/api/commands/quantity', { headers, data: { workspaceId: session.workspaceId, actorId: session.actorId, projectId, origin: 'real', requiredCapability: 'quantity:write', commandId: randomUUID(), baseVersion: current.sourceVersion, action: { kind: 'set-archived', archived: true } } })
  expect(archived.ok(), await archived.text()).toBe(true)
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByText('矩阵已归档', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '阶段名称', exact: true }).fill('取消后保留的阶段输入')
  await page.getByRole('button', { name: '保存阶段', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: '阶段名称', exact: true })).toHaveValue('取消后保留的阶段输入')
  expect((await read()).data.stages.find((row: { id: string }) => row.id === second).name).toBe('第二遍')
})
