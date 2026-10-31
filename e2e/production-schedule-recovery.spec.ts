import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'
import { installScheduleProductionFixture } from './helpers/quantity-production-fixture'
import { expectNoPageOverflow } from './helpers/responsive'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '使用全新正式构建与隔离合成数据库，不连接用户数据库')
test.use({ actionTimeout: 15_000 })

test('正式排程生成回执丢失后核对原编号，独立进程冷开不重复建组', async ({ page }, info) => {
  test.setTimeout(180_000)
  const runtime = await createCrewWorkerProductionFixture(page, info)
  try {
    await runtime.start()
    await runtime.login()
    const fixture = await installScheduleProductionFixture(page, { baseUrl: runtime.origin, createGroup: false })
    await page.goto(`${runtime.origin}${fixture.wizardUrl}`)
    await page.getByLabel('分组名称').fill('合成原编号恢复组')
    await page.getByRole('radio', { name: /内部暂估/ }).check()
    await page.getByRole('checkbox', { name: /1栋/ }).check()
    await page.getByRole('checkbox', { name: /2栋/ }).uncheck()
    await page.getByRole('button', { name: '下一步：选择工序' }).click()
    await page.getByRole('combobox', { name: '标准工序库', exact: true }).click()
    await page.getByRole('option', { name: /E2E四工序库/ }).click()
    await page.getByLabel('计划开始', { exact: true }).fill('2026-08-01')
    await page.getByRole('button', { name: '下一步：预览排程' }).click()
    let commandId = ''
    let submissions = 0
    let resolutions = 0
    await page.route('**/api/commands/schedule', async (route) => {
      submissions++
      commandId = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.abort('failed')
    })
    await page.route('**/api/commands/schedule/resolve', async (route) => {
      resolutions++
      expect(route.request().postDataJSON().commandId).toBe(commandId)
      await route.continue()
    })
    await page.getByRole('button', { name: '生成排程', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '生成排程', exact: true }).click()
    const recover = page.getByRole('button', { name: '核对原提交', exact: true })
    await expect(recover).toBeVisible()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `排程原提交恢复 ${width}`)
      await recover.scrollIntoViewIfNeeded()
      await recover.focus()
      await expect(recover).toBeFocused()
    }
    await recover.click()
    await expect(page).toHaveURL(/\/schedule\?.*group=/)
    expect(submissions).toBe(1)
    expect(resolutions).toBe(1)
    expect(commandId).toBeTruthy()
    const read = await fixture.readSchedule()
    const groups = read.snapshot.groups.filter(group => group.name === '合成原编号恢复组')
    expect(groups).toHaveLength(1)
    const task = groups[0]!.tasks.find(row => row.name === '卫生间回填及防水')!
    expect(task.actualProgress).toBe(0.25)
    await runtime.stop()
    await runtime.start()
    await runtime.login()
    const cold = await fixture.readSchedule()
    expect(cold.snapshot.groups.filter(group => group.name === '合成原编号恢复组')).toHaveLength(1)
  }
  finally {
    await runtime.cleanup()
  }
})

test('正式暂估绑定回执丢失后核对原编号，保留冻结计划并冷恢复', async ({ page }, info) => {
  test.setTimeout(180_000)
  const runtime = await createCrewWorkerProductionFixture(page, info)
  try {
    await runtime.start()
    await runtime.login()
    const fixture = await installScheduleProductionFixture(page, { baseUrl: runtime.origin })
    const session = await (await runtime.request('/api/read/business-session')).json()
    const identity = { workspaceId: session.workspaceId, actorId: session.actorId }
    const command = async (path: string, data: Record<string, unknown>, method = 'POST') => {
      const response = await runtime.request(path, { method, data: { ...identity, commandId: randomUUID(), ...data } })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const base = { baseVersion: null, action: 'draft', attachments: {} }
    const customer = await command('/api/commands/customers', { ...base, requiredCapability: 'customer:write', draft: { name: '排程绑定合成客户' } })
    const projectForm = await (await runtime.request(`/api/read/projects/${fixture.projectId}/form`)).json()
    await command(`/api/commands/projects/${fixture.projectId}`, { ...base, id: fixture.projectId, requiredCapability: 'project:write', baseVersion: projectForm.version, draft: { ...projectForm.draft, customerId: customer.id } }, 'PUT')
    const signatory = await command('/api/commands/our-signatories', { requiredCapability: 'our-signatory:write', baseVersion: null, draft: { name: '排程绑定合成签约公司', taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '隔离合成文书核实', status: 'active' } })
    const contract = await command('/api/commands/construction-contracts', { ...base, action: 'save', requiredCapability: 'construction-contract:write', draft: { name: '排程绑定合成施工合同', no: 'E2E-BIND', projectId: fixture.projectId, customerId: customer.id, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, content: '合成一栋工程范围', signDate: '2026-10-07', status: '履约中', amount: null, taxRate: 0 } })
    const scope = { projectId: fixture.projectId, contractId: contract.id, origin: 'real' }
    const query = new URLSearchParams(scope).toString()
    const boq = await (await runtime.request(`/api/read/boq/workspace?${query}`)).json()
    const items = await (await runtime.request(`/api/read/boq/items?${query}`)).json()
    const item = items.find((row: { code: string }) => row.code === 'MASONRY')
    expect(item).toBeTruthy()
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['分项名称', '单位', '工程量', '合同单价', '楼栋'], ['墙砖铺贴', '㎡', 48, 12, 'B1']]), '原清单')
    const bytes = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
    const row = { itemCode: 'MASONRY', itemName: '墙砖铺贴', unit: '㎡', qty: 48, unitPrice: 12, amount: 576, sourceRow: 2, section: '装饰', trade: '泥水工', totalQty: null, building: 'B1', unitType: '', multiplier: null, room: '', floorZone: '', spec: '', taxRate: null, ownerSupplied: false, sourceSheet: '原清单' }
    await command('/api/commands/boq', { ...scope, requiredCapability: 'boq:write', contractVersion: boq.contractVersion, action: { kind: 'import-file', original: { fileName: '合成施工清单.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') }, formatClass: 'D', rows: [row], bindings: [{ rowKey: '0', itemId: item.id, itemVersion: item.version }] } })
    const before = (await fixture.readSchedule()).snapshot.groups.find(group => group.name === '正式一栋组')!
    expect(before.scopeBasis).toBe('provisional')
    const completionBefore = await fixture.read('completion', { unitId: fixture.units['201']! })
    const bindingUrl = `${runtime.origin}/schedule/${fixture.projectId}/bind/${before.id}?origin=real&contract=${contract.id}`
    await page.goto(bindingUrl)
    const confirm = page.getByRole('button', { name: '确认绑定合同', exact: true })
    await expect(confirm).toBeEnabled({ timeout: 30_000 })
    let submitted = 0
    let resolved = 0
    let commandId = ''
    await page.route('**/api/commands/schedule', async (route) => {
      const body = route.request().postDataJSON()
      if (body.action.kind !== 'bind-contract')
        return route.continue()
      submitted++
      commandId = body.commandId
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.abort('failed')
    })
    await page.route('**/api/commands/schedule/resolve', async (route) => {
      resolved++
      expect(route.request().postDataJSON().commandId).toBe(commandId)
      await route.continue()
    })
    await confirm.click()
    await page.getByRole('dialog').getByRole('button', { name: '确认绑定', exact: true }).click()
    const recover = page.getByRole('button', { name: '核对原提交', exact: true })
    await expect(recover).toBeEnabled()
    await expect(page.getByLabel('已选施工合同', { exact: true })).toHaveText('排程绑定合成施工合同')
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `绑定原提交恢复 ${width}`)
      await recover.scrollIntoViewIfNeeded()
      await recover.focus()
      await expect(recover).toBeFocused()
    }
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(url => url.pathname === '/schedule' && url.searchParams.get('group') === before.id)
    expect(submitted).toBe(1)
    expect(resolved).toBe(1)
    expect(commandId).toBeTruthy()
    const after = (await fixture.readSchedule()).snapshot.groups.find(group => group.id === before.id)!
    expect(after.contractId).toBe(contract.id)
    expect(after.tasks).toEqual(before.tasks)
    expect((await fixture.read('completion', { unitId: fixture.units['201']! })).data).toEqual(completionBefore.data)
    await runtime.stop()
    await runtime.start()
    await runtime.login()
    const cold = (await fixture.readSchedule()).snapshot.groups.find(group => group.id === before.id)!
    expect(cold.contractId).toBe(contract.id)
    expect(cold.tasks).toEqual(before.tasks)
    await page.goto(bindingUrl)
    await expect(page.getByRole('heading', { name: '施工合同绑定依据' })).toBeVisible()
    await expect(page.getByRole('button', { name: '确认绑定合同', exact: true })).toHaveCount(0)
  }
  finally {
    await runtime.cleanup()
  }
})
