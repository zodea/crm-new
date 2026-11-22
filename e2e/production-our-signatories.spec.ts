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
import { selectVerifiedSignatory } from './helpers/contract-signatory'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'
import { expectNoPageOverflow } from './helpers/responsive'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '先构建，再运行独立本机合成库；不连接开发或用户数据')
test('材采整页选施工主合同后新建、编辑及刷新保留原关系', async ({ page }, info) => {
  test.setTimeout(120_000)
  const f = await createCrewWorkerProductionFixture(page, info)
  try {
    await f.start()
    await f.login()
    const ctxResponse = await f.request('/api/read/material-contracts/form-context')
    expect(ctxResponse.ok(), await ctxResponse.text()).toBe(true)
    const { workspaceId, actorId } = await ctxResponse.json()
    const identity = { workspaceId, actorId, baseVersion: null }
    async function command(path: string, capability: string, commandId: string, draft: object, action = 'draft') {
      const response = await f.request(`/api/commands/${path}`, { method: 'POST', data: { ...identity, requiredCapability: capability, commandId, action, draft, attachments: {} } })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const ownResponse = await f.request('/api/commands/our-signatories', { method: 'POST', data: { ...identity, requiredCapability: 'our-signatory:write', commandId: 'material-ui-own', draft: { name: '材采合成签约主体', taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '隔离测试核实', status: 'active' } } })
    expect(ownResponse.ok(), await ownResponse.text()).toBe(true)
    const own = await ownResponse.json()
    const customer = await command('customers', 'customer:write', 'material-ui-customer', { name: '材采合成客户', contact: '合成人' })
    const project = await command('projects', 'project:write', 'material-ui-project', { name: '材采合成工程', customerId: customer.id })
    const supplier = await command('suppliers', 'supplier:write', 'material-ui-supplier', { name: '材采合成分供方', supplierCategory: '材料供应商', contact: '合成人' })
    const main = await command('construction-contracts', 'construction-contract:write', 'material-ui-main', { name: '材采合成施工主合同', no: 'MATERIAL-UI-MAIN', projectId: project.id, customerId: customer.id, content: '合成施工范围', signDate: '2026-08-24', amount: 100, ourSignatoryId: own.id, ourSignatoryVersion: own.version }, 'submit')
    await page.goto(`${f.origin}/contract/material/form`)
    await expect(page.getByRole('heading', { name: /新建 · 材料采购合同/ })).toBeVisible()
    await selectVerifiedSignatory(page, own.id, '材采合成签约主体')
    await page.getByLabel('合同名称 *').fill('中央正式瓷砖合同')
    await page.getByRole('combobox', { name: '搜索工程及施工主合同' }).fill('材采合成施工主合同')
    await page.getByRole('option', { name: /材采合成施工主合同/ }).click()
    await page.getByRole('combobox', { name: '检索分供方' }).fill('材采合成分供方')
    await page.getByRole('option', { name: /材采合成分供方/ }).click()
    await page.getByLabel('合同内容简述 *').fill('正式瓷砖采购')
    await page.getByLabel('签约日期 *').fill('2026-08-24')
    await page.getByTestId('contract-amount').fill('0')
    const created = page.waitForResponse(response => response.url().includes('/api/commands/material-contracts') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    const result = await created
    expect(result.ok(), await result.text()).toBe(true)
    const saved = await result.json()
    await expect(page.getByRole('heading', { name: '中央正式瓷砖合同' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '中央正式瓷砖合同' })).toBeVisible()
    await page.getByTestId('material-contract-edit').click()
    await page.getByLabel('合同名称 *').fill('中央正式瓷砖合同（已编辑）')
    const updated = page.waitForResponse(response => response.url().includes('/api/commands/material-contracts/') && response.request().method() === 'PUT')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    const update = await updated
    expect(update.ok(), await update.text()).toBe(true)
    await expect(page.getByRole('heading', { name: '中央正式瓷砖合同（已编辑）' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '中央正式瓷砖合同（已编辑）' })).toBeVisible()
    const form = await f.request(`/api/read/material-contracts/${saved.id}/form`)
    expect(form.ok(), await form.text()).toBe(true)
    expect(await form.json()).toMatchObject({ draft: { projectId: project.id, supplierId: supplier.id, name: '中央正式瓷砖合同（已编辑）', amount: 0 }, constructionMain: { id: main.id, projectId: project.id } })
    await page.goto(`${f.origin}/contract/subcontract/form`)
    await selectVerifiedSignatory(page, own.id, '材采合成签约主体')
    await page.getByLabel('合同名称 *').fill('合成工程分包合同')
    await page.getByRole('combobox', { name: '搜索工程及施工主合同' }).fill('材采合成施工主合同')
    await page.getByRole('option', { name: /材采合成施工主合同/ }).click()
    await page.getByRole('combobox', { name: '检索分供方' }).fill('材采合成分供方')
    await page.getByRole('option', { name: /材采合成分供方/ }).click()
    await page.getByLabel('合同内容简述 *').fill('合成分包范围')
    await page.getByLabel('签约日期 *').fill('2026-08-24')
    const subcontractCreated = page.waitForResponse(response => response.url().endsWith('/api/commands/subcontract-contracts') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    const subcontractResult = await subcontractCreated
    expect(subcontractResult.ok(), await subcontractResult.text()).toBe(true)
    const subcontract = await subcontractResult.json()
    const subcontractForm = await f.request(`/api/read/subcontract-contracts/${subcontract.id}/form`)
    expect(subcontractForm.ok(), await subcontractForm.text()).toBe(true)
    expect(await subcontractForm.json()).toMatchObject({ draft: { projectId: project.id, supplierId: supplier.id }, constructionMain: { id: main.id, projectId: project.id } })
  }
  finally {
    await f.cleanup()
  }
})
test('主体整页维护、实际选择与冻结、原命令恢复、占号和重启读取使用真实中央库', async ({ page }) => {
  test.setTimeout(180000)
  const root = resolve('.')
  const base = resolve('.tmp/a02-material-e2e/production')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as {
    port: number
  }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  const accessCode = 'a02-synthetic-signatory-only'
  const salt = '0123456789abcdef0123456789abcdef'
  const hash = `scrypt$${salt}$${scryptSync(accessCode, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  let child: ChildProcess | null = null
  let logs = ''
  const pageErrors: string[] = []
  page.on('pageerror', cause => pageErrors.push(cause.message))
  page.on('dialog', dialog => void dialog.accept())
  async function start() {
    child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, windowsHide: true, env: { ...process.env, NODE_ENV: 'production', CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: 'signatory-browser-workspace', CRM_OWNER_ID: 'signatory-browser-owner', CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: hash, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
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
  const envelope = { workspaceId: 'signatory-browser-workspace', actorId: 'signatory-browser-owner', baseVersion: null, action: 'save', attachments: {} }
  const command = (path: string, data: object) => page.request.post(`${origin}${path}`, { headers: { origin }, data })
  try {
    await start()
    await page.goto(`${origin}/settings/our-signatories`)
    await page.getByLabel('本机访问码').fill(accessCode)
    await page.getByRole('button', { name: '进入工作区', exact: true }).click()
    await expect(page.getByRole('button', { name: '退出本机登录' })).toBeVisible()
    await expect(page).toHaveURL(`${origin}/base/customer`)
    await page.goto(`${origin}/settings/our-signatories`)
    const signatoryList = page.getByRole('region', { name: '签约主体目录', exact: true })
    const emptyMessage = '尚未录入主体。按真实文书核实后新增，再在合同中明确选择。'
    await expect(signatoryList.getByRole('strong').filter({ hasText: emptyMessage })).toBeVisible()
    await page.getByRole('link', { name: '新增主体', exact: true }).click()
    await page.getByTestId('our-signatory-name').fill('合成真实签约公司原名')
    await page.getByTestId('our-signatory-taxNo').fill('SYNTHETIC-OWN-TAX')
    await page.getByTestId('our-signatory-verificationNote').fill('原文书人工核实依据')
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `主体整页 ${width}px`)
      await page.getByTestId('our-signatory-name').focus()
      await expect(page.getByTestId('our-signatory-name')).toBeFocused()
    }
    const savedOwn = page.waitForResponse(response => response.url().endsWith('/api/commands/our-signatories') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await savedOwn).ok()).toBe(true)
    const own = await (await savedOwn).json()
    await expect(page.getByTestId('our-signatory-settings')).toContainText('合成真实签约公司原名')
    await expect(signatoryList.getByText('可选择', { exact: true })).toHaveAttribute('data-ui', 'status-tag')
    const customer = await (await command('/api/commands/customers', { ...envelope, requiredCapability: 'customer:write', commandId: 'own-customer', draft: { name: '合成签约客户', contact: '合成人' } })).json()
    const project = await (await command('/api/commands/projects', { ...envelope, requiredCapability: 'project:write', commandId: 'own-project', draft: { name: '合成签约项目', customerId: customer.id, manager: '合成经理' } })).json()
    const supplier = await (await command('/api/commands/suppliers', { ...envelope, requiredCapability: 'supplier:write', commandId: 'own-supplier', draft: { name: '合成签约分供方', supplierCategory: '其他', contact: '合成人' } })).json()
    const mainResponse = await command('/api/commands/construction-contracts', { ...envelope, requiredCapability: 'construction-contract:write', commandId: 'own-main', draft: { name: '主体验收施工主合同', no: 'OWN-MAIN-01', projectId: project.id, customerId: customer.id, content: '合成施工范围', signDate: '2026-10-04', amount: 100, ourSignatoryId: own.id, ourSignatoryVersion: own.version } })
    expect(mainResponse.ok(), await mainResponse.text()).toBe(true)
    const main = await mainResponse.json()
    const contextResponse = await page.request.get(`${origin}/api/read/material-contracts/form-context`)
    expect(contextResponse.ok(), await contextResponse.text()).toBe(true)
    const context = await contextResponse.json()
    const mainOption = context.constructionMains.find((row: { id: string }) => row.id === main.id)
    expect(mainOption).toBeDefined()
    const constructionMain = { id: mainOption.id, projectId: mainOption.projectId, basis: mainOption.basis }
    const materialDraft = { name: '主体冻结材采合同', no: 'OWN-GLOBAL-01', projectId: project.id, supplierId: supplier.id, content: '合成真实合同事实', signDate: '2026-10-04', amount: 20, taxRate: null, lineItems: [{ materialName: '原材料', qty: 1, unit: '米', taxInclusiveUnitPrice: 20 }], deductions: [] }
    const created = await command('/api/commands/material-contracts', { ...envelope, requiredCapability: 'material-contract:write', commandId: 'own-material-draft', action: 'draft', constructionMain, draft: materialDraft })
    expect(created.ok(), await created.text()).toBe(true)
    const material = await created.json()
    await page.goto(`${origin}/contract/material/form/${material.id}`)
    const signatoryField = page.getByTestId('contract-our-signatory').getByRole('combobox')
    await expect(signatoryField).toBeEnabled()
    await signatoryField.fill('合成真实签约公司原名')
    await page.getByRole('option', { name: /合成真实签约公司原名/ }).click({ timeout: 15_000 })
    await expect(page.getByTestId('contract-our-signatory-snapshot')).toContainText('合成真实签约公司原名 · 核实版本 1')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并提交', exact: true }).click()
    await expect(page.getByRole('heading', { name: '主体冻结材采合同', exact: true })).toBeVisible()
    const pricesResponse = await page.request.get(`${origin}/api/read/material-contracts/prices?origin=real`)
    expect(pricesResponse.ok()).toBe(true)
    const prices = await pricesResponse.json()
    const materialPrice = prices.items.find((row: { contractId: string }) => row.contractId === material.id)
    expect(materialPrice).toMatchObject({ taxInclusiveUnitPrice: 20, applicableTaxRate: null, unit: '米', supplierId: supplier.id })
    expect(prices.meta.sources.find((row: { key: string }) => row.key === 'material-contracts').state).toBe('readable')
    await page.goto(`${origin}/material/price`)
    await expect(page.getByRole('region', { name: '合同约定单价' })).toContainText('主体冻结材采合同')
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `真实生产约定价 ${width}px`)
      await page.getByRole('searchbox', { name: '搜索合同价格材料 / 规格 / 材质' }).focus()
      await expect(page.getByRole('searchbox', { name: '搜索合同价格材料 / 规格 / 材质' })).toBeFocused()
    }
    await expect(page.locator('[data-testid="contract-price-tax"]').first()).toHaveText('—')
    const conversion = page.getByText('按明确依据换算比较单位', { exact: true })
    await conversion.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('combobox', { name: '选择换算合同明细' })).toBeFocused()
    await page.getByRole('combobox', { name: '选择换算合同明细' }).selectOption(JSON.stringify(['real', material.id, materialPrice.lineId]))
    await page.getByRole('textbox', { name: '合同价格比较单位' }).fill('千米')
    await page.getByRole('spinbutton', { name: '合同价格换算倍数' }).fill('0.001')
    await expect(page.getByRole('status').filter({ hasText: '缺少可靠' })).toBeVisible()
    await page.getByRole('textbox', { name: '合同价格换算依据' }).fill('合成原文核实1米=0.001千米')
    await expect(page.locator('[data-testid="contract-price-comparison"]').first()).toContainText('千米 / ¥20,000.00')
    const priceOriginal = await (await page.request.get(`${origin}/api/read/material-contracts/${material.id}/form`)).json()
    expect(priceOriginal.draft.lineItems[0]).toMatchObject({ unit: '米', qty: 1, taxInclusiveUnitPrice: 20, applicableTaxRate: null })
    await page.goto(`${origin}/contract/${material.id}?contractKind=material&origin=real`)

    const protocolResponse = await command('/api/commands/material-contracts', { ...envelope, requiredCapability: 'material-contract:write', commandId: 'own-protocol', action: 'submit', constructionMain, draft: { ...materialDraft, name: '原主体协议', isSupplement: true, originalContractId: material.id, amount: 2, lineItems: [{ materialName: '新增材料', qty: 1, unit: '米', taxInclusiveUnitPrice: 2 }] } })
    expect(protocolResponse.ok(), await protocolResponse.text()).toBe(true)
    const protocol = await protocolResponse.json()
    await page.goto(`${origin}/settings/our-signatories/form/${own.id}`)
    await expect(page.getByLabel('主体核实历史')).toContainText('原文书人工核实依据')
    await page.getByTestId('our-signatory-name').fill('后来目录核实更名')
    await page.getByTestId('our-signatory-status').selectOption('inactive')
    let originalCommand = ''
    let persisted: (() => void) | null = null
    const persistedPromise = new Promise<void>(resolve => persisted = resolve)
    let release: (() => void) | null = null
    const releasePromise = new Promise<void>(resolve => release = resolve)
    await page.route('**/api/commands/our-signatories', async (route) => {
      originalCommand = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      persisted!()
      await releasePromise
      await route.abort('failed')
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await persistedPromise
    await page.getByTestId('our-signatory-name').fill('提交以后尚未保存的输入')
    release!()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '核对原提交', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('our-signatory-name')).toHaveValue('提交以后尚未保存的输入')
    await expect(page.getByLabel('主体核实历史')).toContainText('后来目录核实更名')
    await page.unroute('**/api/commands/our-signatories')
    await page.goto(`${origin}/contract/${material.id}?origin=real&contractKind=material&tab=supplements&supplementId=${protocol.id}`)
    await expect(page.locator(`#material-contract-supplement-${protocol.id}`)).toContainText('协议我方签约快照：合成真实签约公司原名')
    const detail = await (await page.request.get(`${origin}/api/read/material-contracts/${material.id}?origin=real`)).json()
    expect(detail.contract.ourSignatorySnapshot).toMatchObject({ id: own.id, version: '1', name: '合成真实签约公司原名', taxNo: 'SYNTHETIC-OWN-TAX' })
    expect(detail.contract.amounts.contract).toBe('20.00')
    const duplicate = await command('/api/commands/material-contracts', { ...envelope, requiredCapability: 'material-contract:write', commandId: 'own-current-duplicate', action: 'submit', constructionMain, draft: { ...materialDraft, ourSignatoryId: own.id, ourSignatoryVersion: '2' } })
    expect(duplicate.status()).toBe(422) // 停用目录也不能被当作新选择；已有合同仍保原快照。
    const otherOwnResponse = await command('/api/commands/our-signatories', { workspaceId: envelope.workspaceId, actorId: envelope.actorId, requiredCapability: 'our-signatory:write', commandId: 'own-second-active', baseVersion: null, draft: { name: '另一真实签约公司', taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '另一文书核实', status: 'active' } })
    expect(otherOwnResponse.ok()).toBe(true)
    const otherOwn = await otherOwnResponse.json()
    const duplicateCurrent = await command('/api/commands/material-contracts', { ...envelope, requiredCapability: 'material-contract:write', commandId: 'own-real-number-duplicate', action: 'submit', constructionMain, draft: { ...materialDraft, ourSignatoryId: otherOwn.id, ourSignatoryVersion: otherOwn.version } })
    expect(duplicateCurrent.status()).toBe(422)
    expect(await duplicateCurrent.json()).toMatchObject({ data: { code: 'validation-failed', message: expect.stringContaining('其他正式主合同重复') } })
    await stop()
    await start()
    await page.goto(`${origin}/settings/our-signatories`)
    await expect(page.getByLabel('本机访问码')).toBeVisible()
    await page.getByLabel('本机访问码').fill(accessCode)
    await page.getByRole('button', { name: '进入工作区', exact: true }).click()
    await expect(page).toHaveURL(`${origin}/base/customer`)
    await page.goto(`${origin}/settings/our-signatories`)
    await expect(page.getByTestId('our-signatory-settings')).toContainText('后来目录核实更名')
    const coldPrices = await (await page.request.get(`${origin}/api/read/material-contracts/prices?origin=real`)).json()
    expect(coldPrices.items.find((row: { contractId: string }) => row.contractId === material.id)).toMatchObject({ lineId: materialPrice.lineId, unit: '米', taxInclusiveUnitPrice: 20, applicableTaxRate: null })
    const recovered = await command('/api/commands/our-signatories/resolve', { commandId: originalCommand })
    expect(await recovered.json()).toMatchObject({ outcome: 'applied', result: { id: own.id, version: '2' } })
    await page.goto(`${origin}/settings/our-signatories/form/${own.id}`)
    await expect(page.getByLabel('主体核实历史')).toContainText('版本 1 · 合成真实签约公司原名')
    await expect(page.getByLabel('主体核实历史')).toContainText('版本 2 · 后来目录核实更名')
    expect(pageErrors).toEqual([])
  }
  finally {
    await stop()
  }
})
