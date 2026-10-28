import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.use({ actionTimeout: 15_000 })

test('三类实际 CSV 经中央导入：零与未知、唯一责任、缺照拒绝和草稿反馈', async ({ page }, testInfo) => {
  test.setTimeout(150_000)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
  })
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `quantity-import-${randomUUID()}` })
  const session = await (await page.request.get('/api/read/business-session')).json()
  const create = async (entity: string, capability: string, draft: Record<string, unknown>, action = 'draft') => {
    const response = await page.request.post(`/api/commands/${entity}`, { data: { ...session, requiredCapability: capability, commandId: randomUUID(), baseVersion: null, action, draft, attachments: {} } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const project = await create('projects', 'project:write', { code: 'Q-IMPORT-442', name: '中央三类文件导入验收', manager: '合成经办人', status: '筹备中' })
  const crew = await create('crews', 'crew:write', { name: '文件导入泥水班', contactName: '合成负责人', contactPhone: '13800000000', trade: '泥水工', capabilityTrades: ['泥水工'], capabilityItems: ['墙砖'], defaultPayRatio: 0.8, assignmentLevel: 'worker' }, 'save')
  const query = { projectId: project.id, origin: 'real', includeDemo: false }
  const read = async (name: string, extra: Record<string, string> = {}) => {
    const response = await page.request.get(`/api/read/quantity/${name}`, { params: { ...query, ...extra } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const code = (await read('region')).data.projectCode
  expect(code).toBe('Q-IMPORT-442')
  const execute = async (action: Record<string, unknown>) => {
    const response = await page.request.post('/api/commands/quantity', { data: { ...session, projectId: project.id, origin: 'real', requiredCapability: 'quantity:write', commandId: randomUUID(), baseVersion: (await read('region')).sourceVersion, action } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const matrixUrl = `/subcontract/quantity?project=${project.id}&origin=real`
  const importFile = async (label: string, entity: string, csv: string, rejected = false) => {
    await page.goto(matrixUrl)
    await expect(page.getByRole('button', { name: '导入', exact: true })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: '导入', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '工程量导入', exact: true })
    await dialog.getByRole('combobox').selectOption(label)
    await dialog.getByRole('button', { name: '进入映射', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/import/mapping/${entity}$`))
    await page.getByLabel('选择导入文件').setInputFiles({ name: `${entity}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') })
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.getByRole('button', { name: '开始导入', exact: true }).click()
    if (!rejected)
      await expect(page).not.toHaveURL(/\/import\/mapping\//)
  }
  await importFile('户型模板量', 'quantity-template', `项目编码,户型编码,户型名称,房间编码,房间名称,分项编码,分项名称,工种,单位,合同量,暂定量,现场算式\n${code},A,文件户型,living,客厅,wall,墙砖,泥水工,㎡,0,,2*3`)
  const template = (await read('templates')).data
  expect(template.lines).toEqual([expect.objectContaining({ contractQty: 0, provisionalQty: null, fieldQty: 6, recognizedContractQty: null })])
  const building = await execute({ kind: 'create-building', draft: { code: 'B', name: '1栋' } })
  const floor = await execute({ kind: 'create-floor', buildingId: building.id, draft: { code: 'F', name: '1层' } })
  const unit = await execute({ kind: 'create-unit', floorId: floor.id, draft: { code: '101', name: '101户', templateId: template.templates[0].id } })
  await execute({ kind: 'save-stage', allowArchivedEdit: false, draft: { id: null, code: 'S', name: '铺贴', trade: '泥水工', completionMode: 'unit', sortOrder: 1, itemIds: [template.items[0].id] } })
  await importFile('责任配置', 'quantity-assignment', `项目编码,楼栋编码,楼层编码,户编码,工种,班组名称\n${code},B,F,101,泥水工,文件导入泥水班`)
  expect((await read('assignments')).data.assignments).toMatchObject([{ unitId: unit.id, assigneeId: crew.id }])
  await importFile('阶段完成', 'quantity-completion', `项目编码,楼栋编码,楼层编码,户编码,阶段编码,状态,完成日期,备注\n${code},B,F,101,S,completed,2026-09-11,不应假完成\n${code},B,F,101,S,draft,2026-09-11,明确待补照`, true)
  await expect(page.getByText(/缺少验收照片.*draft/).first()).toBeVisible()
  await expect(page.getByRole('progressbar', { name: '导入进度', exact: true })).toHaveAttribute('aria-valuenow', '100')
  expect((await read('completion', { unitId: unit.id })).data.stages[0].completion).toMatchObject({ status: 'draft', note: '明确待补照' })
  await expect(page.getByText('已处理 2 行，1 行被拒绝：工程量·阶段完成', { exact: true })).toBeHidden({ timeout: 15_000 })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const download = page.getByRole('button', { name: /下载.*拒绝/ })
    await download.scrollIntoViewIfNeeded()
    await download.focus()
    await expect(download).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  }
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载.*拒绝/ }).click()
  const download = await downloadPromise
  await download.saveAs(testInfo.outputPath('quantity-import-rejections.csv'))
  const exported = await readFile(testInfo.outputPath('quantity-import-rejections.csv'), 'utf8')
  expect(exported).toContain('缺少验收照片')
  expect(exported).toContain('"2"')
  expect(exported).toContain('"completed"')
  expect(exported).not.toContain('明确待补照')
})
