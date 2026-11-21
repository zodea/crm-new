import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

test.use({ actionTimeout: 15_000 })

test('新项目经真实整页建立模板清单关联和区域，刷新与五档保持正式来源及未知量', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const headers = { 'x-ruihang-test-session': `quantity-ui-${randomUUID()}` }
  await page.context().setExtraHTTPHeaders(headers)
  const session = await (await page.request.get('/api/read/business-session', { headers })).json()
  const create = async (entity: string, capability: string, draft: Record<string, unknown>) => {
    const response = await page.request.post(`/api/commands/${entity}`, { headers, data: { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: capability, commandId: randomUUID(), baseVersion: null, action: 'draft', draft, attachments: {} } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const project = await create('projects', 'project:write', { name: '中央工程量整页验收项目', manager: '合成经办人', status: '筹备中' })
  const projectId = project.id as string
  const contract = await create('construction-contracts', 'construction-contract:write', { name: '整页验收施工合同', projectId, content: '合成验收', signDate: '2026-09-11', amount: 5200 })
  const ownerEnvelope = { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'owner-document:write', kind: 'owner_change', attachments: { add: [], removeIds: [], restoreIds: [] } }
  const changeResponse = await page.request.post('/api/commands/owner-documents', { headers, data: { ...ownerEnvelope, commandId: randomUUID(), action: 'submit', id: null, baseVersion: null, draft: { name: '新增整页验收清单', reason: '合成验收', projectId, contractId: contract.id, applicationDate: '2026-09-11', lines: [{ operation: 'add', itemName: '墙面抹灰', unit: '㎡', deltaQty: 100, newUnitPrice: 52 }] } } })
  expect(changeResponse.ok(), await changeResponse.text()).toBe(true)
  const change = await changeResponse.json()
  const approved = await page.request.post('/api/commands/owner-documents', { headers, data: { ...ownerEnvelope, commandId: randomUUID(), action: 'approve', id: change.id, baseVersion: change.version, approvedAt: '2026-09-11' } })
  expect(approved.ok(), await approved.text()).toBe(true)
  const query = { projectId, origin: 'real', includeDemo: false }
  const read = async (name: string) => {
    const response = await page.request.get(`/api/read/quantity/${name}`, { headers, params: query })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const boq = (await read('boq')).data.lines[0]
  expect(boq).toBeTruthy()
  const capture = async (name: string, focus: import('@playwright/test').Locator) => {
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 12_000 })
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await focus.scrollIntoViewIfNeeded()
      await focus.focus()
      await expect(focus).toBeFocused()
      await focus.click({ trial: true })
      if (name === 'template')
        expect((await page.getByRole('combobox', { name: '录入来源', exact: true }).boundingBox())?.width).toBeGreaterThanOrEqual(100)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), animations: 'disabled' })
    }
  }

  await page.goto(`/subcontract/quantity?project=${projectId}&origin=real`)
  await page.getByRole('button', { name: '户型模板', exact: true }).click()
  await expect(page).toHaveURL(/\/template\?.*origin=real/)
  const form = page.getByTestId('quantity-template-form')
  await form.getByLabel('户型编码 *', { exact: true }).fill('A')
  await form.getByLabel('户型名称 *', { exact: true }).fill('中央验收户型')
  await form.getByRole('button', { name: '新增手工分项', exact: true }).click()
  await form.getByRole('textbox', { name: '新分项编码', exact: true }).fill('WALL')
  await form.getByRole('textbox', { name: '新分项名称', exact: true }).fill('墙面抹灰')
  await form.getByRole('textbox', { name: '新分项工种', exact: true }).fill('泥水工')
  await form.getByRole('combobox', { name: '关联合同清单', exact: true }).selectOption(boq.id)
  await expect(form.getByText('待保存原识别量：100', { exact: true })).toBeVisible()
  await form.getByRole('combobox', { name: '录入来源', exact: true }).selectOption('contract')
  await form.getByRole('spinbutton', { name: '当前合同量', exact: true }).fill('0')
  await form.getByRole('combobox', { name: '录入来源', exact: true }).selectOption('field')
  await form.getByRole('button', { name: /现场复核量.*点击编辑算式/ }).click()
  await form.getByRole('textbox', { name: '现场复核算式', exact: true }).fill('2*3')
  await form.getByRole('textbox', { name: '现场复核算式', exact: true }).press('Enter')
  await form.getByRole('button', { name: '保存模板', exact: true }).click()
  await expect(form.getByRole('combobox', { name: '当前户型模板', exact: true })).not.toHaveValue('')
  const templates = await read('templates')
  expect(templates.data.lines).toEqual([expect.objectContaining({ boqLineId: boq.id, recognizedContractQty: 100, contractQty: 0, provisionalQty: null, fieldQty: 6 })])
  await capture('template', form.getByRole('combobox', { name: '录入来源', exact: true }))
  await form.getByRole('button', { name: '返回工程量矩阵', exact: true }).click()
  await page.getByRole('button', { name: '项目区域', exact: true }).click()
  await expect(page).toHaveURL(/\/region\?.*origin=real/)
  const region = page.getByTestId('quantity-region-form')
  await region.getByLabel('楼栋编码', { exact: true }).fill('1')
  await region.getByPlaceholder('如 1栋', { exact: true }).fill('第一栋')
  await region.getByRole('button', { name: '新增楼栋', exact: true }).click()
  await expect(region.getByLabel('楼栋编码', { exact: true })).toHaveValue('')
  await region.getByLabel('楼层编码', { exact: true }).fill('1')
  await region.getByPlaceholder('如 1层', { exact: true }).fill('第一层')
  await region.getByRole('button', { name: '新增楼层', exact: true }).click()
  await expect(region.getByLabel('楼层编码', { exact: true })).toHaveValue('')
  await region.getByLabel('户编码', { exact: true }).fill('101')
  await region.getByPlaceholder('如 101户', { exact: true }).fill('101户')
  await region.getByRole('button', { name: '新增户', exact: true }).click()
  await expect(region.getByLabel('户编码', { exact: true })).toHaveValue('')
  const areas = await read('region')
  expect(areas.data.units).toEqual([expect.objectContaining({ name: '101户', templateId: templates.data.templates[0].id })])
  await capture('region', region.getByLabel('户编码', { exact: true }))
  await region.getByRole('link', { name: '打开工程量矩阵', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/subcontract/quantity\\?.*project=${projectId}`))
  await expect(page.getByTestId('quantity-matrix-cell')).toHaveCount(1)
  await capture('matrix', page.getByRole('button', { name: '阶段配置', exact: true }))
  await page.reload()
  await expect(page.getByTestId('quantity-matrix-cell')).toHaveCount(1)
  expect((await read('templates')).data.lines[0]).toMatchObject({ contractQty: 0, provisionalQty: null, fieldQty: 6, boqLineId: boq.id })
})
