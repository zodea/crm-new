import type { Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { runMigrations } from '../app/lib/db/migrations'
import { isolatedInheritedEnvironment, isolatedServerEntry } from '../scripts/e2e-isolation'
import { createMemoryDb } from '../tests/helpers/memory-db'
import { expectEscapeReturnsFocus, expectNoPageOverflow, expectOverlayAboveShell } from './helpers/responsive'

async function withFormalAuxiliary(page: Page, work: (formal: { origin: string, directory: string, request: (path: string, data?: unknown) => ReturnType<Page['request']['fetch']> }) => Promise<void>) {
  const base = resolve('.tmp/opt-02/auxiliary-ui')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/formal-`)
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  const code = 'auxiliary-synthetic-verification-only'
  const salt = '0123456789abcdef0123456789abcdef'
  const accessCodeHash = `scrypt$${salt}$${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  const entry = process.env.CRM_E2E_SERVER_ENTRY ? isolatedServerEntry(process.cwd(), process.env.CRM_E2E_SERVER_ENTRY) : '.output/server/index.mjs'
  const child: ChildProcess = spawn(process.execPath, [entry], { cwd: resolve('.'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...isolatedInheritedEnvironment(process.env), NODE_ENV: 'production', CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: 'auxiliary-browser', CRM_OWNER_ID: 'auxiliary-owner', CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: accessCodeHash, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), PORT: String(port) } })
  let logs = ''
  child.stdout!.on('data', data => logs += String(data))
  child.stderr!.on('data', data => logs += String(data))
  const request = (path: string, data?: unknown) => page.request.fetch(`${origin}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Origin: origin }, ...(data === undefined ? {} : { data }) })
  try {
    await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
    await expect.poll(async () => {
      if (child.exitCode !== null)
        throw new Error(logs)
      try {
        return (await fetch(`${origin}/api/auth/status`)).status
      }
      catch { return 0 }
    }, { timeout: 30_000 }).toBe(200)
    await page.goto(`${origin}/contract/company-expense/form`)
    await page.getByLabel('本机访问码').fill(code)
    await page.getByRole('button', { name: '进入工作区', exact: true }).click()
    await expect(page.getByRole('button', { name: '退出本机登录' })).toBeVisible()
    await expect(page).toHaveURL(`${origin}/base/customer`)
    const signer = await request('/api/commands/our-signatories', { workspaceId: 'auxiliary-browser', actorId: 'auxiliary-owner', requiredCapability: 'our-signatory:write', commandId: 'auxiliary-browser-signer', baseVersion: null, draft: { name: '真实合成签约主体', taxNo: 'AUXILIARY-BROWSER-ONLY', registeredAddress: null, legalRepresentative: null, verificationNote: '本次合成核验', status: 'active' } })
    expect(signer.ok(), await signer.text()).toBe(true)
    await page.goto(`${origin}/contract/company-expense/form`)
    await work({ origin, directory, request })
  }
  finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
  }
}

test('正式 Auxiliary 新建公司合同失响应后仅核对同原号，唯一记录、真实原件与审计回读，已保存GET失败仅重试读取', async ({ page }) => {
  test.setTimeout(180000)
  await withFormalAuxiliary(page, async ({ origin, request }) => {
    const supplier = await request('/api/commands/suppliers', { workspaceId: 'auxiliary-browser', actorId: 'auxiliary-owner', requiredCapability: 'supplier:write', commandId: 'aux-ui-company-supplier', baseVersion: null, action: 'save', attachments: {}, draft: { name: '验收出租单位', supplierCategory: '其他', contact: '合成联系人' } })
    expect(supplier.ok(), await supplier.text()).toBe(true)
    await page.goto(`${origin}/contract/company-expense/form`)
    await page.getByLabel('合同名称 *').fill('重试验收合同')
    await page.getByRole('combobox', { name: '搜索已有分供方' }).fill('验收出租单位')
    await page.getByRole('option', { name: /验收出租单位/ }).click()
    await page.getByLabel('签订日期 *').fill('2026-10-07')
    await page.getByLabel('合同金额 *').fill('1060')
    const signatory = page.getByRole('combobox', { name: '搜索真实签约主体', exact: true })
    await signatory.fill('真实合成')
    await page.getByRole('option', { name: /真实合成签约主体/ }).click()
    const bytes = Buffer.from('验收用实际持久化原件')
    await page.locator('input[type=file]').setInputFiles({ name: '验收合同说明.txt', mimeType: 'text/plain', buffer: bytes })
    await expect(page.getByText('验收合同说明.txt', { exact: true })).toBeVisible()
    const commands: string[] = []
    let loseResponse = true
    await page.route('**/api/commands/auxiliary-contracts', async (route) => {
      commands.push(route.request().postDataJSON().commandId)
      const response = await route.fetch()
      if (loseResponse) {
        loseResponse = false
        await route.abort('failed')
      }
      else {
        await route.fulfill({ response })
      }
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toBeVisible()
    await expect.poll(() => commands.length).toBe(1)
    await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toBeEnabled()
    await expect(page.getByLabel('合同名称 *')).toHaveValue('重试验收合同')
    const originalKey = commands[0]!
    const originalDescriptor = await page.evaluate(() => Object.entries(sessionStorage).find(([key]) => key.startsWith('crm:form-command:v1:auxiliary-contract:'))?.[1])
    expect(JSON.parse(originalDescriptor!).commandId).toBe(originalKey)
    expect(Object.keys(JSON.parse(originalDescriptor!)).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'scopeId', 'targetId', 'workspaceId'])
    expect(originalDescriptor).not.toContain(bytes.toString('base64'))
    const resolvedKeys: string[] = []
    await page.route('**/api/commands/auxiliary-contracts/resolve', async (route) => {
      resolvedKeys.push(route.request().postDataJSON().commandId)
      await route.continue()
    })
    await page.getByRole('button', { name: '核对原提交结果', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toHaveCount(0)
    expect(commands).toEqual([originalKey])
    expect(resolvedKeys).toEqual([originalKey])
    const list = await request('/api/read/auxiliary-contracts?kind=company_expense&search=重试验收合同')
    expect(list.ok(), await list.text()).toBe(true)
    const record = (await list.json()).items
    expect(record).toHaveLength(1)
    expect(record[0].audit).toMatchObject({ createdBy: 'auxiliary-owner', updatedBy: 'auxiliary-owner' })
    const id = record[0].id
    await page.goto(`${origin}/contract/company-expense/${id}?origin=real`)
    await expect(page.getByTestId('auxiliary-detail')).toContainText('验收合同说明.txt')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载', exact: true }).click()
    const downloaded = await download
    expect(await readFile((await downloaded.path())!)).toEqual(bytes)
    await page.getByRole('button', { name: '编辑合同', exact: true }).click()
    await page.getByLabel('合同名称 *').fill('原目标已保存后读失败')
    let getFails = true
    await page.route(`**/api/read/auxiliary-contracts/${id}?**`, async (route) => {
      if (getFails)
        await route.abort('failed')
      else await route.continue()
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toBeEnabled()
    const writes = commands.length
    const resolves = resolvedKeys.length
    getFails = false
    await page.getByRole('button', { name: '核对原提交结果', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toHaveCount(0)
    expect(commands.length).toBe(writes)
    expect(resolvedKeys.length).toBe(resolves)
    await page.goto(`${origin}/contract/company-expense/${id}?origin=real`)
    await expect(page.getByTestId('auxiliary-detail')).toContainText('原目标已保存后读失败')
  })
})

test('正式 Auxiliary 整页真实工程动态选择及重开，完整两类Native原图/补链/原件同次采用和危险整批恢复', async ({ page }) => {
  test.setTimeout(180000)
  await withFormalAuxiliary(page, async ({ origin, directory, request }) => {
    const base = { workspaceId: 'auxiliary-browser', actorId: 'auxiliary-owner', baseVersion: null, action: 'save', attachments: {} }
    const create = async (path: string, body: unknown) => {
      const response = await request(path, body)
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const customer = await create('/api/commands/customers', { ...base, commandId: 'aux-ui-customer', requiredCapability: 'customer:write', draft: { name: '实际辅助合同甲方', contact: '合成联系人' } })
    const project = await create('/api/commands/projects', { ...base, commandId: 'aux-ui-project', requiredCapability: 'project:write', draft: { name: '实际工程名称', customerId: customer.id, manager: '合成负责人' } })
    const supplier = await create('/api/commands/suppliers', { ...base, commandId: 'aux-ui-supplier', requiredCapability: 'supplier:write', draft: { name: '实际检测分供方', supplierCategory: '其他', contact: '合成联系人' } })
    const context = await (await request('/api/read/auxiliary-contracts/context')).json()
    const signer = context.ourSignatories.find((row: { draft: { name: string } }) => row.draft.name === '真实合成签约主体')
    for (const no of ['AUX-MAIN-A', 'AUX-MAIN-B'])
      await create('/api/commands/construction-contracts', { ...base, commandId: `aux-ui-${no}`, requiredCapability: 'construction-contract:write', draft: { name: '同一工程实际施工合同', no, projectId: project.id, customerId: customer.id, signDate: '2026-10-07', content: '真实上游约定', amount: 0, taxRate: 0, ourSignatoryId: signer.id, ourSignatoryVersion: signer.version, managementFeeAmount: 0, managementFeeBasis: '明确零配置' } })
    await page.goto(`${origin}/contract/other-expense/form`)
    const engineering = page.getByRole('combobox', { name: '搜索工程及施工主合同名称 / 编号', exact: true })
    await expect(engineering).toHaveValue('')
    await engineering.fill('AUX-MAIN-B')
    await page.getByRole('option', { name: /AUX-MAIN-B/ }).click()
    const label = await engineering.inputValue()
    expect(label).toContain('实际工程名称')
    expect(label).toContain('AUX-MAIN-B')
    await engineering.click()
    const selected = page.getByRole('option', { name: /AUX-MAIN-B/ })
    await expect(selected).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(engineering).toBeFocused()
    await expect(engineering).toHaveValue(label)
    await page.getByRole('combobox', { name: '检索分供方', exact: true }).fill('实际检测')
    await page.getByRole('option', { name: /实际检测分供方/ }).click()
    await page.getByRole('combobox', { name: '搜索真实签约主体', exact: true }).fill('真实合成')
    await page.getByRole('option', { name: /真实合成签约主体/ }).click()
    await page.getByLabel('合同名称 *').fill('实际工程必选辅助合同')
    await page.getByLabel('合同金额 *').fill('0')
    let sent: Record<string, unknown> | null = null
    await page.route('**/api/commands/auxiliary-contracts', async (route) => {
      sent = route.request().postDataJSON()
      await route.continue()
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存草稿', exact: true }).click()
    await expect(page.getByTestId('auxiliary-detail')).toContainText('实际工程必选辅助合同')
    const details = await (await request('/api/read/auxiliary-contracts?kind=other_expense')).json()
    expect(details.items).toHaveLength(1)
    expect(sent).toMatchObject({ draft: { projectId: project.id, supplierId: supplier.id, amount: 0 }, constructionMain: { projectId: project.id } })
    const record = await (await request(`/api/read/auxiliary-contracts/${details.items[0].id}?kind=other_expense&origin=real`)).json()
    const currentContext = await (await request('/api/read/auxiliary-contracts/context')).json()
    expect(record.constructionMain.id).toBe(currentContext.constructionMains.find((row: { no: string }) => row.no === 'AUX-MAIN-B').id)
    await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0)
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `正式辅助合同详情 ${width}`)
      await page.getByRole('button', { name: '编辑合同', exact: true }).click()
      await expect(engineering).toHaveValue(label)
      await expectNoPageOverflow(page, `正式辅助合同表单 ${width}`)
      await page.getByLabel('合同名称 *').fill(`实际工程必选辅助合同（${width}未保存）`)
      const cancel = page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '取消', exact: true })
      await cancel.click()
      const dialog = page.getByRole('dialog', { name: '放弃修改' })
      await expectOverlayAboveShell(dialog, `正式辅助合同确认 ${width}`)
      await expectEscapeReturnsFocus(page, dialog, cancel, `正式辅助合同确认 ${width}`)
      await cancel.click()
      await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
      await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
    }
    const native = await createMemoryDb()
    await runMigrations(native)
    await native.execute('INSERT INTO projects(id,name) VALUES (\'native-aux-ui-project\',\'原工程名称\')')
    await native.execute('INSERT INTO suppliers(id,name) VALUES (\'native-aux-ui-supplier\',\'原检测分供方\')')
    await native.execute('INSERT INTO contracts(id,no,name,kind,project_id,supplier_id,other_expense_kind,amount,status) VALUES (\'native-aux-ui-head\',\'NATIVE-AUX\',\'原完整检测合同\',\'其他支出\',\'native-aux-ui-project\',\'native-aux-ui-supplier\',\'检测服务\',NULL,\'已签订\')')
    await native.execute('INSERT INTO company_expense_contracts(id,no,name,category,counterparty,amount,status) VALUES (\'native-aux-ui-head\',\'NATIVE-COMPANY\',\'原完整公司合同\',\'房租\',\'原出租单位\',0,\'履约中\')')
    await native.execute('INSERT INTO contract_supplements(id,contract_id,name,amount,status) VALUES (\'native-aux-ui-supp\',\'native-aux-ui-head\',\'原完整检测增补\',0,\'有效\')')
    await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type) VALUES (\'native-aux-ui-file\',\'contract_supplement\',\'native-aux-ui-supp\',\'原完整增补原件.txt\',\'D:/原件/原完整增补原件.txt\',3,\'text/plain\')')
    await native.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data) VALUES (\'native-aux-ui-audit\',\'contracts\',\'native-aux-ui-head\',\'update\',?)', ['{"原审计":"完整保留"}'])
    const sourceBytes = Buffer.from(native.raw.export())
    native.close()
    const sourcePath = join(directory, 'explicit-native-auxiliary.sqlite')
    await writeFile(sourcePath, sourceBytes, { flag: 'wx' })
    await page.goto(`${origin}/contract/other-expense`)
    await expect(page.getByRole('link', { name: '实际工程必选辅助合同', exact: true })).toBeVisible({ timeout: 30_000 })
    const nativeSource = page.getByLabel('完整辅助合同来源文件')
    // 迁入身份尚未读取时，选文件会被 selectNative 忽略，入口必须保持禁用。
    await expect(nativeSource).toBeDisabled()
    await page.route('**/api/read/auxiliary-contracts/import', route => route.fulfill({ status: 503, json: { code: 'unavailable', message: '合成来源暂不可用', retryable: true, fieldErrors: {}, traceId: null } }))
    await page.getByText('完整 Native 辅助合同迁入与受保护恢复', { exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '合成来源暂不可用' })).toBeVisible()
    await expect(nativeSource).toBeDisabled()
    await page.unroute('**/api/read/auxiliary-contracts/import')
    await page.getByRole('button', { name: '重新核对来源', exact: true }).click()
    await expect(nativeSource).toBeEnabled({ timeout: 30_000 })
    await nativeSource.setInputFiles(sourcePath)
    await expect(page.getByLabel('采用native-aux-ui-project')).toBeVisible({ timeout: 30_000 })
    await page.getByLabel('采用native-aux-ui-project').selectOption(`${project.id}@${project.version}`)
    await page.getByLabel('采用native-aux-ui-supplier').selectOption(`${supplier.id}@${supplier.version}`)
    await page.getByLabel('补齐native-aux-ui-file').setInputFiles({ name: '原完整增补原件.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') })
    await page.getByRole('button', { name: '采用完整辅助合同原图', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '采用完整原图', exact: true }).click()
    await expect(page.getByRole('link', { name: '原完整检测合同', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '原完整检测合同', exact: true }).click()
    await expect(page.getByTestId('auxiliary-detail')).toContainText('原完整增补原件.txt')
    await page.getByRole('button', { name: '增补合同', exact: true }).click()
    await expect(page.getByTestId('auxiliary-detail')).toContainText('原完整检测增补')
    await page.goto(`${origin}/contract/company-expense`)
    await page.getByRole('link', { name: '原完整公司合同', exact: true }).click()
    await expect(page.getByTestId('auxiliary-detail')).toContainText('原出租单位')
    const invalid = await request('/api/commands/auxiliary-contracts', { ...base, requiredCapability: 'auxiliary-contract:write', commandId: 'aux-ui-later-intent', id: 'native-aux-ui-head', baseVersion: '0', draft: { kind: 'other_expense' }, attachments: {} })
    expect(invalid.status()).toBe(409)
    await page.goto(`${origin}/contract/other-expense`)
    await page.getByText('完整 Native 辅助合同迁入与受保护恢复', { exact: true }).click()
    await page.getByRole('button', { name: '受保护整批恢复', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '核验并退役采用', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '危险恢复拒绝' })).toBeVisible()
    expect(await readFile(sourcePath)).toEqual(sourceBytes)
  })
})
