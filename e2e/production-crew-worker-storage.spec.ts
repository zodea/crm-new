import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import { createCrewWorkerNativeSource } from '../tests/helpers/crew-worker-native-source'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '构建后在专属合成目录验收真实中央存储，不连接用户数据库。')
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 })
const widths = [390, 768, 1024, 1280, 1440]
async function assertViewport(page: import('@playwright/test').Page, scope: import('@playwright/test').Locator, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await expect(scope).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await scope.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
}
for (const chain of ['unknown-cold', 'known-read-failed'] as const) {
  test(`工人班组真实 Native 迁入 ${chain} 原键恢复与五档布局/焦点/冻结历史`, async ({ page }, info) => {
    test.setTimeout(180_000)
    const fixture = await createCrewWorkerProductionFixture(page, info)
    const source = await createCrewWorkerNativeSource()
    let writes = 0
    let resolutions = 0
    let allowRead = true
    let allowResolve = false
    let originalId = ''
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await fixture.start()
      await fixture.login()
      const project = await (await fixture.request('/api/commands/projects', { method: 'POST', data: { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner', commandId: 'cw-project-original', requiredCapability: 'project:write', baseVersion: null, action: 'draft', draft: { name: '中央明确项目' }, attachments: {} } })).json()
      expect(project.version).toBe('1')
      await page.goto(`${fixture.origin}/settings/data-migration`)
      const panel = page.getByTestId('crew-worker-migration')
      await expect(panel.locator('input[type=file]')).toBeEnabled()
      await panel.locator('input[type=file]').setInputFiles({ name: 'synthetic-native.sqlite', mimeType: 'application/vnd.sqlite3', buffer: Buffer.from(source.source.payloadBase64, 'base64') })
      await expect(panel.getByText('原项目 原项目名称（native-project）对应中央项目')).toBeVisible()
      await panel.getByRole('combobox').selectOption(project.id)
      await panel.getByRole('button', { name: '重新核对来源与项目', exact: true }).click()
      await expect(panel.getByRole('button', { name: '采用核验后的工人、班组目录', exact: true })).toBeEnabled()
      for (const width of widths)
        await assertViewport(page, panel, width)
      await page.route('**/api/read/crew-worker/import', async (route) => {
        if (allowRead)
          return route.continue()
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic-read-failure-after-commit' }) })
      })
      await page.route('**/api/commands/crew-worker/import/resolve', async (route) => {
        resolutions++
        if (!allowResolve)
          return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic-original-resolution-unavailable' }) })
        return route.continue()
      })
      await page.route('**/api/commands/crew-worker/import', async (route) => {
        const request = route.request().postDataJSON()
        if (request.action !== 'adopt')
          return route.continue()
        writes++
        originalId = request.commandId
        const response = await route.fetch()
        expect(response.status(), await response.text()).toBe(200)
        if (chain === 'unknown-cold')
          return route.abort()
        allowRead = false
        return route.fulfill({ response })
      })
      await panel.getByRole('button', { name: '采用核验后的工人、班组目录', exact: true }).click()
      await expect.poll(() => writes).toBe(1)
      if (chain === 'unknown-cold') {
        await fixture.stop()
        await fixture.start()
        await fixture.login()
        await page.goto(`${fixture.origin}/settings/data-migration`)
      }
      const recovery = panel.getByTestId('crew-worker-import-recovery')
      await expect(recovery).toBeVisible()
      const button = recovery.getByRole('button', { name: '核对原工人班组迁入', exact: true })
      for (const width of widths) {
        await assertViewport(page, recovery, width)
        await button.focus()
        await expect(button).toBeFocused()
        expect(writes).toBe(1)
      }
      const saved = await page.evaluate(() => JSON.stringify({ ...localStorage }))
      expect(saved).toContain(originalId)
      expect(saved).not.toContain('原工人')
      expect(saved).not.toContain(source.source.payloadBase64)
      expect(saved).not.toContain('portraitId')
      allowRead = true
      allowResolve = true
      await button.press('Enter')
      await expect(panel.getByTestId('crew-worker-import-result')).toContainText('已采用 1 个班组、1 个工人')
      expect(writes).toBe(1)
      expect(resolutions).toBe(chain === 'unknown-cold' ? 1 : 0)
      const archive = await (await fixture.request(`/api/read/worker-roster/archive?projectId=${project.id}&archiveId=${source.archive.id}`)).json()
      expect(archive).toMatchObject({ createdBy: 'native-original-actor', scope: { projectId: project.id }, members: [{ payrollNames: ['原工资冻结姓名'], profile: { name: '原冻结工人姓名' } }] })
      await panel.getByRole('link', { name: '查看全局工人目录', exact: true }).click()
      await expect(page.getByRole('link', { name: '原工人', exact: true })).toBeVisible()
      await page.getByRole('link', { name: '原工人', exact: true }).click()
      await expect(page.getByRole('heading', { name: '原工人', exact: true })).toBeVisible()
      await expect(page.getByTestId('worker-central-summary')).toContainText('尚不能确认')
      for (const width of widths)
        await assertViewport(page, page.getByTestId('worker-central-summary'), width)
      expect(errors).toEqual([])
      await fixture.stop()
      const disk = new DatabaseSync(resolve(fixture.directory, 'ruihang.sqlite'), { readOnly: true })
      try {
        expect(disk.prepare('SELECT COUNT(*) n FROM crew_worker_import_receipts').get()?.n).toBe(1)
        expect(disk.prepare('SELECT COUNT(*) n FROM workers').get()?.n).toBe(1)
        const evidence = JSON.parse(String(disk.prepare('SELECT source_graph_json FROM crew_worker_import_sources').get()?.source_graph_json))
        expect(evidence.archives[0].snapshot_json).toBe(source.rawArchive)
      }
      finally { disk.close() }
    }
    finally { await fixture.cleanup() }
  })
}

test('正式整页新建编辑工人班组，跨项目复用稳定目录身份并冷恢复原关系与银行资料', async ({ page }, info) => {
  test.setTimeout(180_000)
  const fixture = await createCrewWorkerProductionFixture(page, info)
  const writes: Array<{ path: string, method: string }> = []
  const errors: string[] = []
  const lookupReads: Array<{ url: string, status: number, body: string }> = []
  const lookupCompletions: Array<Promise<void>> = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (/^\/api\/commands\/(?:crews|workers)(?:\/[^/]+)?$/.test(path) && ['POST', 'PUT'].includes(request.method()) && !path.endsWith('/resolve'))
      writes.push({ path, method: request.method() })
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (response.request().method() === 'GET' && ['/api/read/crews', '/api/read/projects'].includes(url.pathname)) {
      lookupCompletions.push(response.text().then((body) => {
        lookupReads.push({ url: response.url(), status: response.status(), body })
      }).catch(() => {}))
    }
  })
  const form = page.locator('[data-ui="entity-form-shell"]')
  async function submit(path: string, method: 'POST' | 'PUT', buttonName: '保存并提交' | '保存') {
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method)
    const button = page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: buttonName, exact: true })
    await button.focus()
    await expect(button).toBeFocused()
    await button.press('Enter')
    const response = await saved
    expect(response.status(), await response.text()).toBe(200)
    return await response.json() as { id: string, commandId: string, version: string }
  }
  async function read(path: string, data?: { commandId: string }) {
    const response = await fixture.request(path, data ? { method: 'POST', data } : {})
    expect(response.status(), await response.text()).toBe(200)
    return response.json()
  }
  async function assertFormViewports() {
    for (const width of widths) {
      await assertViewport(page, form, width)
      const save = page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并提交', exact: true })
      await save.focus()
      await expect(save).toBeFocused()
    }
    await page.setViewportSize({ width: 390, height: 900 })
  }
  try {
    await fixture.start()
    await fixture.login()
    const projects: string[] = []
    for (const [suffix, commandSuffix] of [['甲', 'first'], ['乙', 'second']]) {
      const response = await fixture.request('/api/commands/projects', { method: 'POST', data: { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner', commandId: `cw-ui-dependency-${commandSuffix}`, requiredCapability: 'project:write', baseVersion: null, action: 'draft', draft: { name: `正式跨项目工程${suffix}` }, attachments: {} } })
      expect(response.status(), await response.text()).toBe(200)
      const result = await response.json()
      expect(result.version).toBe('1')
      projects.push(result.id)
    }

    await page.goto(`${fixture.origin}/base/crew`)
    await expect(page.getByRole('heading', { name: '班组资料库', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '新增班组', exact: true }).click()
    await page.getByLabel('班组名称 *').fill('正式共享泥工班组')
    await page.getByLabel('工种 *', { exact: true }).fill('泥工')
    await page.getByLabel('负责人 *', { exact: true }).fill('合成负责人')
    await page.getByLabel('联系电话 *', { exact: true }).fill('13900139000')
    await page.getByLabel('默认发放比例', { exact: true }).fill('0.8')
    await assertFormViewports()
    const crewCreated = await submit('/api/commands/crews', 'POST', '保存并提交')
    expect(crewCreated.version).toBe('1')
    await expect(page).toHaveURL(url => url.pathname === `/base/crew/${crewCreated.id}` && url.searchParams.get('origin') === 'real')
    await expect(page.getByRole('heading', { name: '正式共享泥工班组', exact: true })).toBeFocused()
    await expect(page.getByText('暂无成员关系', { exact: true })).toBeVisible()
    const originalCrewReceipt = await read('/api/commands/crews/resolve', { commandId: crewCreated.commandId })
    expect(originalCrewReceipt).toMatchObject({ outcome: 'applied', result: crewCreated })

    await page.goto(`${fixture.origin}/base/worker`)
    await expect(page.getByRole('heading', { name: '工人资料库', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '新增工人', exact: true }).click()
    await page.getByLabel('姓名 *', { exact: true }).fill('正式跨项目工人')
    await page.getByLabel('联系电话 *', { exact: true }).fill('13800000021')
    await page.getByLabel('身份证号', { exact: true }).fill('440101199001011234')
    await page.getByLabel('工种 *', { exact: true }).fill('泥工')
    await page.getByLabel('开户银行 *', { exact: true }).fill('合成测试银行')
    await page.getByLabel('银行卡号 *', { exact: true }).fill('6222000000001234')
    await page.getByLabel('参考日工资', { exact: true }).fill('0')
    await page.getByRole('combobox', { name: '检索班组', exact: true }).fill('正式共享泥工班组')
    await page.getByRole('option', { name: '正式共享泥工班组' }).click()
    await page.getByRole('combobox', { name: '检索项目', exact: true }).fill('正式跨项目工程甲')
    await page.getByRole('option', { name: '正式跨项目工程甲' }).click()
    await page.getByLabel('已完成三级安全教育', { exact: true }).check()
    await assertFormViewports()
    const workerCreated = await submit('/api/commands/workers', 'POST', '保存并提交')
    expect(workerCreated.version).toBe('1')
    await expect(page).toHaveURL(url => url.pathname === `/base/worker/${workerCreated.id}` && url.searchParams.get('origin') === 'real')
    await expect(page.getByRole('heading', { name: '正式跨项目工人', exact: true })).toBeFocused()
    await expect(page.getByRole('link', { name: '正式共享泥工班组', exact: true })).toHaveAttribute('href', new RegExp(`/base/crew/${crewCreated.id}\\?origin=real`))
    await expect(page.getByRole('link', { name: '正式跨项目工程甲', exact: true }).first()).toBeVisible()
    await expect(page.getByText('6222 **** 1234', { exact: true })).toBeVisible()
    await expect(page.getByText('6222000000001234', { exact: true })).toHaveCount(0)
    const originalWorkerReceipt = await read('/api/commands/workers/resolve', { commandId: workerCreated.commandId })
    expect(originalWorkerReceipt).toMatchObject({ outcome: 'applied', result: workerCreated })
    expect(await read(`/api/read/workers/${workerCreated.id}/form`)).toMatchObject({ version: '1', draft: { id: workerCreated.id, crewId: crewCreated.id, currentProjectId: projects[0], bankAccount: '6222000000001234', dailyWage: 0 } })

    await page.getByRole('link', { name: '正式共享泥工班组', exact: true }).click()
    await expect(page.getByRole('heading', { name: '正式共享泥工班组', exact: true })).toBeVisible()
    const initialMember = page.getByRole('row').filter({ has: page.getByRole('link', { name: '正式跨项目工人', exact: true }) })
    await expect(initialMember).toContainText('正式跨项目工程甲')
    await page.getByRole('link', { name: '编辑', exact: true }).click()
    await expect(page.getByLabel('默认发放比例', { exact: true })).toHaveValue('0.8')
    await page.getByLabel('班组名称 *', { exact: true }).fill('正式共享泥工班组（更正）')
    await page.getByLabel('默认发放比例', { exact: true }).fill('0')
    await assertFormViewports()
    const crewEdited = await submit(`/api/commands/crews/${crewCreated.id}`, 'PUT', '保存')
    expect(crewEdited).toMatchObject({ id: crewCreated.id, version: '2' })
    await expect(page.getByRole('heading', { name: '正式共享泥工班组（更正）', exact: true })).toBeFocused()
    expect(await read(`/api/read/crews/${crewCreated.id}/form`)).toMatchObject({ version: '2', draft: { id: crewCreated.id, name: '正式共享泥工班组（更正）', defaultPayRatio: 0 } })
    await page.getByRole('row').filter({ has: page.getByRole('link', { name: '正式跨项目工人', exact: true }) }).getByRole('link', { name: '正式跨项目工人', exact: true }).click()
    await page.getByRole('link', { name: '编辑', exact: true }).click()
    await expect(page.getByLabel('银行卡号 *', { exact: true })).toHaveValue('6222000000001234')
    await page.getByLabel('姓名 *', { exact: true }).fill('正式跨项目工人（更正）')
    await page.getByLabel('银行卡号 *', { exact: true }).fill('6222000000005678')
    await page.getByRole('combobox', { name: '检索班组', exact: true }).fill('正式共享泥工班组（更正）')
    await page.getByRole('option', { name: '正式共享泥工班组（更正）' }).click()
    await page.getByRole('combobox', { name: '检索项目', exact: true }).fill('正式跨项目工程乙')
    await page.getByRole('option', { name: '正式跨项目工程乙' }).click()
    await assertFormViewports()
    const workerEdited = await submit(`/api/commands/workers/${workerCreated.id}`, 'PUT', '保存')
    expect(workerEdited).toMatchObject({ id: workerCreated.id, version: '2' })
    await expect(page.getByRole('heading', { name: '正式跨项目工人（更正）', exact: true })).toBeFocused()
    await expect(page.getByRole('link', { name: '正式跨项目工程乙', exact: true }).first()).toBeVisible()
    await expect(page.getByText('6222 **** 5678', { exact: true })).toBeVisible()
    await expect(page.getByText('6222000000005678', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('worker-central-summary')).toContainText('尚不能确认')
    const expectedWorker = { version: '2', draft: { id: workerCreated.id, name: '正式跨项目工人（更正）', crewId: crewCreated.id, currentProjectId: projects[1], bankName: '合成测试银行', bankAccount: '6222000000005678', idCard: '440101199001011234', dailyWage: 0 } }
    expect(await read(`/api/read/workers/${workerCreated.id}/form`)).toMatchObject(expectedWorker)
    expect(await read('/api/commands/crews/resolve', { commandId: crewCreated.commandId })).toEqual(originalCrewReceipt)
    expect(await read('/api/commands/workers/resolve', { commandId: workerCreated.commandId })).toEqual(originalWorkerReceipt)
    expect(writes).toEqual([{ path: '/api/commands/crews', method: 'POST' }, { path: '/api/commands/workers', method: 'POST' }, { path: `/api/commands/crews/${crewCreated.id}`, method: 'PUT' }, { path: `/api/commands/workers/${workerCreated.id}`, method: 'PUT' }])

    await fixture.stop()
    await fixture.start()
    await fixture.login()
    await page.goto(`${fixture.origin}/base/worker`)
    const workerTable = page.locator('[data-ui="worker-central-list-table"]')
    const workerLink = workerTable.getByRole('link', { name: '正式跨项目工人（更正）', exact: true })
    await expect(workerLink).toHaveCount(1)
    await expect(workerLink).toHaveAttribute('href', new RegExp(`/base/worker/${workerCreated.id}\\?origin=real`))
    await expect(workerTable.getByRole('link', { name: '正式共享泥工班组（更正）', exact: true })).toHaveAttribute('href', new RegExp(`/base/crew/${crewCreated.id}\\?origin=real`))
    await expect(workerTable.getByRole('link', { name: '正式跨项目工程乙', exact: true })).toBeVisible()
    for (const width of widths)
      await assertViewport(page, workerTable, width)
    await workerLink.click()
    await expect(page.getByRole('heading', { name: '正式跨项目工人（更正）', exact: true })).toBeVisible()
    await expect(page.getByText('6222 **** 5678', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: '正式共享泥工班组（更正）', exact: true }).click()
    const crewDetail = page.locator('[data-ui="crew-central-detail"]')
    const member = crewDetail.getByRole('row').filter({ has: page.getByRole('link', { name: '正式跨项目工人（更正）', exact: true }) })
    await expect(member).toHaveCount(1)
    await expect(member).toContainText('正式跨项目工程乙')
    await expect(crewDetail.getByRole('link', { name: '正式跨项目工程甲', exact: true })).toHaveCount(0)
    for (const width of widths)
      await assertViewport(page, crewDetail, width)
    await page.goto(`${fixture.origin}/base/crew`)
    const crewTable = page.locator('[data-ui="crew-central-list-table"]')
    await expect(crewTable.getByRole('link', { name: '正式共享泥工班组（更正）', exact: true })).toHaveCount(1)
    await expect(crewTable.getByRole('link', { name: '正式共享泥工班组（更正）', exact: true })).toHaveAttribute('href', new RegExp(`/base/crew/${crewCreated.id}\\?origin=real`))
    for (const width of widths)
      await assertViewport(page, crewTable, width)
    expect(await read(`/api/read/workers/${workerCreated.id}/form`)).toMatchObject(expectedWorker)
    expect(await read(`/api/read/crews/${crewCreated.id}/form`)).toMatchObject({ version: '2', draft: { id: crewCreated.id, defaultPayRatio: 0 } })
    expect(await read('/api/commands/crews/resolve', { commandId: crewCreated.commandId })).toEqual(originalCrewReceipt)
    expect(await read('/api/commands/workers/resolve', { commandId: workerCreated.commandId })).toEqual(originalWorkerReceipt)
    expect(errors).toEqual([])
    await fixture.stop()
    const disk = new DatabaseSync(resolve(fixture.directory, 'ruihang.sqlite'), { readOnly: true })
    try {
      expect(disk.prepare('SELECT id FROM crews').all()).toEqual([{ id: crewCreated.id }])
      expect(disk.prepare('SELECT id FROM workers').all()).toEqual([{ id: workerCreated.id }])
      const history = disk.prepare('SELECT after_json FROM crew_worker_audits WHERE command_id=?').get(workerCreated.commandId)
      expect(JSON.parse(String(history?.after_json))).toMatchObject({ id: workerCreated.id, version: 1, draft: { name: '正式跨项目工人', crewId: crewCreated.id, currentProjectId: projects[0], bankAccount: '6222000000001234', dailyWage: 0 } })
      const crewHistory = disk.prepare('SELECT after_json FROM crew_worker_audits WHERE command_id=?').get(crewCreated.commandId)
      expect(JSON.parse(String(crewHistory?.after_json))).toMatchObject({ id: crewCreated.id, version: 1, draft: { name: '正式共享泥工班组', defaultPayRatio: 0.8 } })
    }
    finally { disk.close() }
  }
  catch (cause) {
    await Promise.allSettled(lookupCompletions)
    const crews = await fixture.request('/api/read/crews?includeDemo=false').then(async response => ({ status: response.status(), body: await response.text() })).catch(error => ({ error: String(error) }))
    await info.attach('normal-ui-read-diagnostic', { body: JSON.stringify({ url: page.url(), writes, errors, lookupReads, currentCrews: crews }), contentType: 'application/json' })
    throw cause
  }
  finally { await fixture.cleanup() }
})
