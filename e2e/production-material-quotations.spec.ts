import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { createQuotationMigrationSource } from './helpers/quotation-migration-source'
import { expectNoPageOverflow } from './helpers/responsive'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '使用全新正式构建与隔离合成库，不连接开发或用户数据')
test('真实生产报价整页、原件、冻结版本、未知回执恢复、冲突与冷开五档验收', async ({ page }, testInfo) => {
  test.setTimeout(180000)
  const base = resolve('.tmp/a02-material-e2e/quotation-production')
  await mkdir(base, { recursive: true })
  let directory = await mkdtemp(`${base}/synthetic-`)
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as {
    port: number
  }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  const workspaceId = 'quotation-browser-workspace'
  const actorId = 'quotation-browser-owner'
  const accessCode = 'quotation-synthetic-verification'
  const salt = '0123456789abcdef0123456789abcdef'
  const hash = `scrypt$${salt}$${scryptSync(accessCode, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  let child: ChildProcess | null = null
  let logs = ''
  const errors: string[] = []
  page.on('pageerror', cause => errors.push(cause.message))
  page.on('dialog', dialog => void dialog.accept())
  async function start() {
    child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: resolve('.'), windowsHide: true, env: { ...process.env, NODE_ENV: 'production', CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: workspaceId, CRM_OWNER_ID: actorId, CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: hash, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout!.on('data', bytes => logs += String(bytes))
    child.stderr!.on('data', bytes => logs += String(bytes))
    await expect.poll(async () => {
      if (child?.exitCode !== null)
        throw new Error(logs)
      try {
        return (await fetch(`${origin}/api/auth/status`)).status
      }
      catch {
        return 0
      }
    }, { timeout: 30000 }).toBe(200)
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const stopped = once(child, 'exit')
      child.kill()
      await stopped
    }
    child = null
  }
  async function login() {
    await page.goto(`${origin}/material/quotations`)
    await page.getByLabel('本机访问码').fill(accessCode)
    await page.getByRole('button', { name: '进入工作区', exact: true }).click()
    await expect(page).toHaveURL(`${origin}/base/customer`)
    await expect(page.getByRole('button', { name: '退出本机登录' })).toBeVisible()
  }
  const command = (data: object) => page.request.post(`${origin}/api/commands/material-quotations`, { headers: { origin }, data })
  const read = async () => (await page.request.get(`${origin}/api/read/material-quotations`)).json()
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=', 'base64')
  try {
    await start()
    await login()
    await page.goto(`${origin}/material/quotations/form`)
    await page.getByTestId('quotation-party').fill('未建档原报价方')
    await page.getByTestId('quotation-scope').selectOption('general')
    await page.getByTestId('quotation-line-0-name').fill('实际原材料')
    await page.getByTestId('quotation-line-0-unit').fill('米')
    await page.getByTestId('quotation-line-0-price').fill('0')
    await page.getByTestId('finance-attachment-input').setInputFiles({ name: '原报价.png', mimeType: 'image/png', buffer: image })
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `报价整页 ${width}px`)
      await page.getByTestId('quotation-party').focus()
      await expect(page.getByTestId('quotation-party')).toBeFocused()
    }
    const firstResponse = page.waitForResponse(response => response.url().endsWith('/api/commands/material-quotations') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await firstResponse).ok()).toBe(true)
    const first = await (await firstResponse).json()
    await expect(page).toHaveURL(`${origin}/material/quotations/${first.id}`)
    let original = (await read()).records[0]
    expect(original.draft).toMatchObject({ partyName: '未建档原报价方', supplierId: null, projectId: null, scope: 'general', quotationDate: null })
    expect(original.draft.lines[0]).toMatchObject({ unitPrice: 0, taxRate: null, unit: '米' })
    expect(original.history[0].files[0].id).toBe(first.attachmentIds[0])
    await page.getByRole('button', { name: '预览', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('原报价.png')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '预览', exact: true })).toBeFocused()
    await page.goto(`${origin}/material/quotations/form/${first.id}`)
    await page.getByTestId('quotation-line-0-price').fill('18')
    let originalCommand = ''
    let sends = 0
    let persisted: (() => void) | null = null
    const persistedPromise = new Promise<void>(resolve => persisted = resolve)
    let release: (() => void) | null = null
    const releasePromise = new Promise<void>(resolve => release = resolve)
    await page.route('**/api/commands/material-quotations', async (route) => {
      sends++
      originalCommand = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      persisted!()
      await releasePromise
      await route.abort('failed')
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await persistedPromise
    await page.getByTestId('quotation-party').fill('提交之后尚未保存的原文')
    release!()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '核对原提交', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('quotation-party')).toHaveValue('提交之后尚未保存的原文')
    expect(sends).toBe(1)
    await page.unroute('**/api/commands/material-quotations')
    original = (await read()).records[0]
    expect(original.version).toBe('2')
    expect(original.draft.partyName).toBe('未建档原报价方')
    expect(original.attachments).toHaveLength(1)
    const remote = await command({ workspaceId, actorId, requiredCapability: 'material-quotation:write', commandId: 'quotation-concurrent-original', id: first.id, baseVersion: '2', action: 'save', draft: { ...original.draft, note: '另一实际提交' }, attachments: {} })
    expect(remote.ok()).toBe(true)
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('最新报价版本 3 · 未建档原报价方')).toBeVisible()
    await expect(page.getByTestId('quotation-party')).toHaveValue('提交之后尚未保存的原文')
    await page.getByRole('button', { name: '核对最新版本并保留当前输入', exact: true }).click()
    let failRead = true
    await page.route('**/api/read/material-quotations', async (route) => {
      if (failRead) {
        failRead = false
        await route.abort('failed')
      }
      else {
        await route.continue()
      }
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: '重新读取已保存记录', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '重新读取已保存记录', exact: true }).click()
    await expect(page.getByRole('button', { name: '重新读取已保存记录', exact: true })).toHaveCount(0)
    await page.unroute('**/api/read/material-quotations')
    await page.goto(`${origin}/material/quotations/${first.id}`)
    await page.getByTestId('quotation-history').selectOption('1')
    await expect(page.getByRole('heading', { name: '未建档原报价方', exact: true })).toBeVisible()
    await expect(page.getByLabel('报价原件')).toContainText('原报价.png')
    const oldOriginal = await page.request.get(`${origin}/api/read/material-quotations/${first.id}/files/${first.attachmentIds[0]}?version=1`)
    expect(oldOriginal.ok()).toBe(true)
    expect(Buffer.from((await oldOriginal.json()).payloadBase64, 'base64')).toEqual(image)
    expect((await page.request.get(`${origin}/api/read/material-quotations/${first.id}/files/${first.attachmentIds[0]}?version=0`)).ok()).toBe(false)
    await page.goto(`${origin}/material/price`)
    await expect(page.getByRole('link', { name: '报价版本 1', exact: true })).toHaveAttribute('href', `/material/quotations/${first.id}?version=1`)
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `报价比较 ${width}px`)
    }
    await stop()
    await start()
    await login()
    await page.goto(`${origin}/material/quotations/${first.id}?version=1`)
    await expect(page.getByTestId('quotation-history')).toHaveValue('1')
    original = (await read()).records[0]
    expect(original.history.map((row: {
      version: string
    }) => row.version)).toEqual(['1', '2', '3', '4'])
    expect(original.history[0].draft.lines[0]).toMatchObject({ unitPrice: 0, taxRate: null })
    expect(original.history[1].draft.lines[0].unitPrice).toBe(18)
    const recovered = await page.request.post(`${origin}/api/commands/material-quotations/resolve`, { headers: { origin }, data: { commandId: originalCommand } })
    expect(await recovered.json()).toMatchObject({ outcome: 'applied', result: { id: first.id, version: '2', commandId: originalCommand } })
    // New-form recovery must keep the actual tab instance while later bytes are still unsaved.
    await page.goto(`${origin}/material/quotations/form`)
    await page.getByTestId('quotation-party').fill('首次新建报价方')
    await page.getByTestId('quotation-scope').selectOption('general')
    await page.getByTestId('quotation-line-0-name').fill('新建原材料')
    await page.getByTestId('quotation-line-0-unit').fill('吨')
    await page.getByTestId('quotation-line-0-price').fill('0')
    await page.getByRole('checkbox', { name: '【保存】后关闭', exact: true }).uncheck()
    await page.getByTestId('finance-attachment-input').setInputFiles({ name: '新建原件A.png', mimeType: 'image/png', buffer: image })
    await expect(page.getByText('新建原件A.png', { exact: true })).toBeVisible()
    await page.evaluate(() => {
      const browser = window as Window & { releaseQuotationFile?: () => void, restoreQuotationFile?: () => void }
      const originalRead = File.prototype.arrayBuffer
      browser.restoreQuotationFile = () => File.prototype.arrayBuffer = originalRead
      File.prototype.arrayBuffer = function () {
        const bytes = originalRead.call(this)
        return this.name === '后来新报价B.png'
          ? bytes.then(buffer => new Promise<ArrayBuffer>((resolve) => {
              browser.releaseQuotationFile = () => resolve(buffer)
            }))
          : bytes
      }
    })
    await page.getByTestId('finance-attachment-input').setInputFiles({ name: '后来新报价B.png', mimeType: 'image/png', buffer: image })
    await expect.poll(() => page.evaluate(() => typeof (window as Window & { releaseQuotationFile?: () => void }).releaseQuotationFile)).toBe('function')
    let releaseCreate!: () => void
    let createPersisted!: () => void
    const createHold = new Promise<void>(resolve => releaseCreate = resolve)
    const createWritten = new Promise<void>(resolve => createPersisted = resolve)
    let createSends = 0
    let createResolves = 0
    let created!: { id: string, version: string, commandId: string, attachmentIds: string[] }
    await page.route('**/api/commands/material-quotations/resolve', async (route) => {
      createResolves++
      await route.continue()
    })
    await page.route('**/api/commands/material-quotations', async (route) => {
      createSends++
      const request = route.request().postDataJSON()
      expect(request.id).toBeUndefined()
      expect(request.baseVersion).toBeNull()
      expect(request.attachments.add.map((file: { fileName: string }) => file.fileName)).toEqual(['新建原件A.png'])
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      created = await response.json()
      createPersisted()
      await createHold
      await route.abort('failed')
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await createWritten
    await page.getByTestId('quotation-party').fill('后来尚未保存的新报价方')
    await page.evaluate(() => {
      const browser = window as Window & { releaseQuotationFile?: () => void, restoreQuotationFile?: () => void }
      browser.releaseQuotationFile!()
      browser.restoreQuotationFile!()
    })
    await expect(page.getByText('后来新报价B.png', { exact: true })).toBeVisible()
    releaseCreate()
    await page.getByRole('button', { name: '核对原提交', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toHaveCount(0)
    await expect(page).toHaveURL(`${origin}/material/quotations/form`)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('quotation-party')).toHaveValue('后来尚未保存的新报价方')
    await expect(page.getByText('后来新报价B.png', { exact: true })).toBeVisible()
    const createdRecord = (await read()).records.find((record: { id: string }) => record.id === created.id)
    expect(createdRecord.version).toBe('1')
    expect(createdRecord.draft.partyName).toBe('首次新建报价方')
    expect(createdRecord.attachments.map((file: { fileName: string }) => file.fileName)).toEqual(['新建原件A.png'])
    expect(createSends).toBe(1)
    expect(createResolves).toBe(1)
    await page.unroute('**/api/commands/material-quotations')
    const nextResponse = page.waitForResponse(response => response.url().endsWith('/api/commands/material-quotations') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    const updated = await nextResponse
    expect(updated.request().postDataJSON()).toMatchObject({ id: created.id, baseVersion: '1', draft: { partyName: '后来尚未保存的新报价方' }, attachments: { add: [{ fileName: '后来新报价B.png', payloadBase64: image.toString('base64') }] } })
    expect(updated.ok()).toBe(true)
    expect(await updated.json()).toMatchObject({ id: created.id, version: '2' })
    await expect(page).toHaveURL(`${origin}/material/quotations/form/${created.id}`)
    const updatedRecord = (await read()).records.find((record: { id: string }) => record.id === created.id)
    expect(updatedRecord.history[0].draft.partyName).toBe('首次新建报价方')
    expect(updatedRecord.history[0].files.map((file: { fileName: string }) => file.fileName)).toEqual(['新建原件A.png'])
    expect(updatedRecord.attachments.map((file: { fileName: string }) => file.fileName).sort()).toEqual(['后来新报价B.png', '新建原件A.png'].sort())
    await page.unroute('**/api/commands/material-quotations/resolve')
    // Separate empty actual production owner for full historical import; the existing quote database is preserved.
    await stop()
    const source = await createQuotationMigrationSource(`${directory}/native-source`)
    directory = await mkdtemp(`${base}/import-target-`)
    await start()
    await login()
    const createMaster = async (domain: string, requiredCapability: string, draft: object, commandId: string) => {
      const response = await page.request.post(`${origin}/api/commands/${domain}`, { headers: { origin }, data: { workspaceId, actorId, requiredCapability, commandId, baseVersion: null, action: 'save', draft, attachments: {} } })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const customer = await createMaster('customers', 'customer:write', { name: '实际迁入客户', contact: '真实联系人' }, 'migration-actual-customer')
    const project = await createMaster('projects', 'project:write', { name: '确认目标项目', code: 'QM001', manager: '实际经理', customerId: customer.id }, 'migration-actual-project')
    const supplier = await createMaster('suppliers', 'supplier:write', { name: '确认目标分供方', supplierCategory: '其他', contact: '实际联系人' }, 'migration-actual-supplier')
    await page.goto(`${origin}/material/quotations/import`)
    await page.getByLabel('选择完整 SQLite 来源快照').setInputFiles({ name: 'original-native-quotation.sqlite', mimeType: 'application/vnd.sqlite3', buffer: source.bytes })
    const projectSelect = page.getByRole('combobox', { name: `原项目 ${source.projectId}`, exact: true })
    const supplierSelect = page.getByRole('combobox', { name: `原分供方 ${source.supplierId}`, exact: true })
    await expect(projectSelect.locator('option:checked')).toHaveText('请选择实际对应记录')
    await expect(supplierSelect.locator('option:checked')).toHaveText('请选择实际对应记录')
    await expect(page.getByRole('button', { name: '核验并迁入报价', exact: true })).toBeDisabled()
    await projectSelect.selectOption(project.id)
    await supplierSelect.selectOption(supplier.id)
    await page.getByRole('checkbox', { name: '我已逐条核对原身份与目标记录的对应关系' }).check()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `实际报价关联迁入 ${width}px`)
      await projectSelect.focus()
      await expect(projectSelect).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(supplierSelect).toBeFocused()
    }
    let importSends = 0
    let importResolves = 0
    let failPostResolveContext = false
    let failedPostResolveContextReads = 0
    let importCommand = ''
    let importAborted!: () => void
    const importAbortDelivered = new Promise<void>(resolve => importAborted = resolve)
    await page.route('**/api/read/material-quotations/import-context', async (route) => {
      if (failPostResolveContext) {
        failedPostResolveContextReads++
        await route.fulfill({ status: 503, json: { data: { code: 'unavailable', message: '后置报价会话读取失败', retryable: true, fieldErrors: {}, traceId: null } } })
      }
      else {
        await route.continue()
      }
    })
    await page.route('**/api/commands/material-quotations/import/resolve', async (route) => {
      importResolves++
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      expect(await response.json()).toMatchObject({ outcome: 'applied', result: { commandId: importCommand } })
      failPostResolveContext = true
      await route.fulfill({ response })
    })
    await page.route('**/api/commands/material-quotations/import', async (route) => {
      importSends++
      const body = route.request().postDataJSON()
      importCommand = body.commandId
      expect(body.bindings.map((row: {
        serverId: string
      }) => row.serverId).sort()).toEqual([project.id, supplier.id].sort())
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      expect(await response.json()).toMatchObject({ commandId: importCommand, graphHash: body.graphHash, importedIds: [source.id] })
      await route.abort('failed')
      importAborted()
    })
    await page.getByRole('button', { name: '核验并迁入报价', exact: true }).click()
    await importAbortDelivered
    expect(importCommand).not.toBe('')
    expect(importSends).toBe(1)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('status', { name: '原提交恢复' }).getByText('原提交结果未知', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeEnabled()
    await page.reload()
    await expect(page.getByText('后置报价会话读取失败', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeEnabled()
    expect(failedPostResolveContextReads).toBeGreaterThan(0)
    expect(importResolves).toBe(1)
    failPostResolveContext = false
    await page.getByRole('button', { name: '核对原提交', exact: true }).click()
    await expect(page.getByText('报价迁入已保存并核验读取', { exact: true })).toBeVisible()
    expect(importSends).toBe(1)
    expect(importResolves).toBe(1)
    await page.unroute('**/api/commands/material-quotations/import')
    await page.unroute('**/api/commands/material-quotations/import/resolve')
    await page.unroute('**/api/read/material-quotations/import-context')
    const imported = (await read()).records[0]
    expect(imported.id).toBe(source.id)
    expect(imported.draft).toMatchObject({ projectId: source.projectId, supplierId: source.supplierId })
    expect(imported.relations.map((row: {
      version: string
      projectId: string
      supplierId: string
    }) => ({ version: row.version, projectId: row.projectId, supplierId: row.supplierId }))).toEqual([{ version: '1', projectId: project.id, supplierId: supplier.id }, { version: '2', projectId: project.id, supplierId: supplier.id }])
    expect(imported.history[0].draft.lines[0]).toMatchObject({ unitPrice: 0, taxRate: null })
    expect(imported.history[1].draft.lines[0]).toMatchObject({ unitPrice: null, taxRate: 0 })
    await page.goto(`${origin}/material/quotations/${source.id}?version=1`)
    await expect(page.getByText(`明确分供方 ${source.supplierId}`, { exact: false })).toBeVisible()
    await expect(page.getByText('已确认当前关联：', { exact: false })).toContainText(project.id)
    await page.goto(`${origin}/material/quotations/form/${source.id}`)
    await expect(page.getByTestId('quotation-project')).toHaveValue(project.id)
    await expect(page.getByTestId('quotation-supplier')).toHaveValue(supplier.id)
    await stop()
    await start()
    await login()
    const importResolution = await page.request.post(`${origin}/api/commands/material-quotations/import/resolve`, { headers: { origin }, data: { commandId: importCommand } })
    expect(await importResolution.json()).toMatchObject({ outcome: 'applied', result: { commandId: importCommand, importedIds: [source.id] } })
    const importedOriginal = await page.request.get(`${origin}/api/read/material-quotations/${source.id}/files/${source.fileId}?version=1`)
    expect((await importedOriginal.json()).payloadBase64).toBe('YWJj')
    expect(errors).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('quotation-cold-history.png'), fullPage: true })
  }
  finally {
    await stop()
  }
})
