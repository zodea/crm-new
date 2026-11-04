import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'

test.use({ actionTimeout: 15_000 })
test.skip(process.env.CRM_COMPANY_PAYMENT_ACCEPTANCE !== '1', '仅在显式启用并指定隔离生产构建时执行')

test('正式公司合同与项目、公司付款页面保存真实合同身份并冷读', async ({ page }, info) => {
  test.setTimeout(240_000)
  const entry = process.env.CRM_COMPANY_PAYMENT_E2E_ENTRY
  if (!entry)
    throw new Error('必须显式指定项目内全新隔离生产构建入口。')
  const f = await createCrewWorkerProductionFixture(page, info, { serverEntry: entry, requireIsolated: true })
  const identity = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner' }
  async function post<T>(path: string, data: unknown): Promise<T> {
    const response = await f.request(path, { method: 'POST', data })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json() as Promise<T>
  }
  async function choose(placeholder: string, name: string) {
    const input = page.getByRole('combobox', { name: placeholder, exact: true })
    await input.fill(name)
    await page.getByRole('option').filter({ hasText: name }).first().click()
  }
  try {
    await f.start()
    await f.login()
    const supplier = await post<{ id: string, version: string }>('/api/commands/suppliers', { ...identity, requiredCapability: 'supplier:write', commandId: 'ui-contract-supplier', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成关联分供方', supplierCategory: '其他', contact: '合成人' } })
    const buyer = await post<{ id: string, version: string }>('/api/commands/our-signatories', { ...identity, requiredCapability: 'our-signatory:write', commandId: 'ui-contract-buyer', baseVersion: null, draft: { name: '合成合同我方', taxNo: 'SYNTHETIC-BUYER', registeredAddress: null, legalRepresentative: null, verificationNote: '', status: 'active' } })
    const customer = await post<{ id: string }>('/api/commands/customers', { ...identity, requiredCapability: 'customer:write', commandId: 'ui-contract-customer', baseVersion: null, action: 'draft', attachments: {}, draft: { name: '合成合同客户', contact: '合成人' } })
    const project = await post<{ id: string }>('/api/commands/projects', { ...identity, requiredCapability: 'project:write', commandId: 'ui-contract-project', baseVersion: null, action: 'draft', attachments: {}, draft: { name: '合成关联合同工程', customerId: customer.id, manager: '合成人' } })
    const main = await post<{ id: string }>('/api/commands/construction-contracts', { ...identity, requiredCapability: 'construction-contract:write', commandId: 'ui-contract-main', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成施工主合同', projectId: project.id, customerId: customer.id, content: '合成施工范围', signDate: '2026-01-01', amount: 100, ourSignatoryId: buyer.id, ourSignatoryVersion: buyer.version } })
    const contextResponse = await f.request('/api/read/material-contracts/form-context')
    expect(contextResponse.ok(), await contextResponse.text()).toBe(true)
    const context = await contextResponse.json() as { constructionMains: Array<{ id: string, projectId: string, basis: unknown }> }
    const selected = context.constructionMains.find(row => row.id === main.id)
    expect(selected).toBeDefined()
    const material = await post<{ id: string, version: string }>('/api/commands/material-contracts', { ...identity, requiredCapability: 'material-contract:write', commandId: 'ui-contract-material', baseVersion: null, action: 'draft', attachments: {}, constructionMain: { id: selected!.id, projectId: selected!.projectId, basis: selected!.basis }, draft: { name: '合成项目采购合同', projectId: project.id, supplierId: supplier.id, ourSignatoryId: buyer.id, ourSignatoryVersion: buyer.version, content: '合成采购', signDate: '2026-01-01', amount: 100, taxRate: null, lineItems: [] } })

    await page.goto(`${f.origin}/contract/company-expense/form`)
    await page.getByLabel('合同名称 *', { exact: true }).fill('合成页面公司合同')
    await choose('搜索已有分供方', '合成关联分供方')
    await expect(page.getByText('合同采用名称：合成关联分供方')).toBeVisible()
    const observed: { company?: { id: string, version: string }, command: string } = { command: '' }
    await page.route('**/api/commands/auxiliary-contracts', async (route) => {
      const request = route.request().postDataJSON()
      expect(request.draft).toMatchObject({ kind: 'company_expense', supplierId: supplier.id, supplierVersion: supplier.version })
      observed.command = request.commandId
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      observed.company = await response.json() as { id: string, version: string }
      await route.abort('failed')
    }, { times: 1 })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存草稿', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交结果' })).toBeVisible()
    await expect.poll(() => observed.company?.id).toBeTruthy()
    expect(observed.command).toBeTruthy()
    const descriptor = await page.evaluate(() => Object.entries(sessionStorage).find(([key]) => key.startsWith('crm:form-command:v1:auxiliary-contract:'))?.[1])
    expect(JSON.parse(descriptor!).commandId).toBe(observed.command)
    await expect(page.getByRole('button', { name: '核对原提交结果' })).toBeEnabled()
    await page.getByRole('button', { name: '核对原提交结果' }).click()
    await expect(page.getByRole('button', { name: '核对原提交结果' })).toHaveCount(0)
    expect(observed.company).toBeDefined()
    const savedCompany = observed.company!
    const companyDetail = await f.request(`/api/read/auxiliary-contracts/${savedCompany.id}?kind=company_expense`)
    expect(companyDetail.ok(), await companyDetail.text()).toBe(true)
    expect((await companyDetail.json()).contract.draft).toMatchObject({ supplierId: supplier.id, supplierVersion: supplier.version })

    const savedPayments: Array<{ id: string, domain: string, contractId: string, version: string }> = []
    for (const item of [{ bizType: '预付款', domain: 'material', contract: material, name: '合成项目采购合同', project: true }, { bizType: '公司付款', domain: 'company', contract: savedCompany, name: '合成页面公司合同', project: false }]) {
      await page.goto(`${f.origin}/finance/payment/new`)
      await page.getByRole('button', { name: item.bizType, exact: true }).click()
      await page.getByTestId('finance-name').fill(`合成${item.domain}付款申请`)
      if (item.project)
        await choose('检索项目', '合成关联合同工程')
      await choose('检索分供方', '合成关联分供方')
      await choose('检索支出合同', item.name)
      await page.getByTestId('finance-amount').fill('30')
      await page.getByTestId('finance-date').fill('2026-01-01')
      await page.getByRole('textbox', { name: '申请人 *', exact: true }).fill('合成财务')
      if (item.domain === 'company') {
        const before = await f.request(`/api/read/auxiliary-contracts/${item.contract.id}?kind=company_expense`)
        expect(before.ok(), await before.text()).toBe(true)
        const contract = (await before.json()).contract
        const changed = await post<{ id: string, version: string }>('/api/commands/auxiliary-contracts', { ...identity, requiredCapability: 'auxiliary-contract:write', commandId: 'ui-company-contract-version-change', id: item.contract.id, baseVersion: item.contract.version, action: 'draft', attachments: {}, draft: { ...contract.draft, mainTerms: '合成真实版本变更' } })
        expect(changed.version).not.toBe(item.contract.version)
        const rejected = page.waitForResponse(response => response.url().endsWith('/api/commands/finance') && response.request().method() === 'POST')
        await page.getByRole('button', { name: '保存草稿', exact: true }).click()
        const response = await rejected
        expect(response.status()).toBe(409)
        expect(await response.text()).toContain('合同版本已变化')
        await expect(page.getByTestId('finance-name')).toHaveValue('合成company付款申请')
        const recovery = page.getByRole('button', { name: '核对原提交', exact: true })
        await expect(recovery).toHaveCount(0)
        await page.getByRole('button', { name: '重新读取合同', exact: true }).click()
        const field = page.getByRole('combobox', { name: '检索支出合同', exact: true })
        const refresh = page.waitForResponse(response => response.url().includes('/api/read/finance/payment_application/lookup') && response.url().includes('payment-contracts'))
        await field.fill('合成页面')
        const refreshed = await refresh
        expect(refreshed.ok(), await refreshed.text()).toBe(true)
        const candidates = await refreshed.json() as { items: Array<{ paymentContract?: { id: string, version: string } }> }
        expect(candidates.items.find(candidate => candidate.paymentContract?.id === item.contract.id)?.paymentContract?.version).toBe(changed.version)
        await page.getByRole('option').filter({ hasText: item.name }).first().click()
        await expect(page.getByTestId('finance-name')).toHaveValue('合成company付款申请')
        await expect(page.getByTestId('finance-amount')).toHaveValue('30')
        for (const width of [390, 768, 1024, 1280, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          await field.focus()
          await expect(field).toBeFocused()
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
        }
        item.contract.version = changed.version
      }
      const write: { request?: { commandId: string, draft: unknown }, result?: { id: string }, resolved?: string } = {}
      if (item.domain === 'company') {
        await page.route('**/api/commands/finance', async (route) => {
          write.request = route.request().postDataJSON()
          const response = await route.fetch()
          expect(response.ok(), await response.text()).toBe(true)
          write.result = await response.json() as { id: string }
          await route.abort('failed')
        }, { times: 1 })
        await page.route('**/api/commands/finance/resolve', async (route) => {
          write.resolved = route.request().postDataJSON().commandId
          await route.continue()
        }, { times: 1 })
        await page.getByRole('button', { name: '保存草稿', exact: true }).click()
        await expect.poll(() => write.result?.id).toBeTruthy()
        const pending = page.getByRole('button', { name: '核对原提交', exact: true })
        await expect(pending).toBeVisible()
        await expect(pending).toBeEnabled()
        await pending.click()
        await expect(pending).toHaveCount(0)
        expect(write.resolved).toBe(write.request?.commandId)
      }
      else {
        const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/commands/finance') && response.request().method() === 'POST')
        await page.getByRole('button', { name: '保存草稿', exact: true }).click()
        const response = await responsePromise
        expect(response.ok(), await response.text()).toBe(true)
        write.request = response.request().postDataJSON()
        write.result = await response.json() as { id: string }
      }
      const request = write.request!
      expect(request.draft).toMatchObject({ supplierId: supplier.id, projectId: item.project ? project.id : null, contractId: item.contract.id, contractReference: { domain: item.domain, id: item.contract.id, version: item.contract.version } })
      const result = write.result!
      const read = await f.request(`/api/read/finance/payment_application/form/${result.id}`)
      expect(read.ok(), await read.text()).toBe(true)
      expect((await read.json()).draft.contractReference).toEqual({ domain: item.domain, id: item.contract.id, version: item.contract.version })
      savedPayments.push({ id: result.id, domain: item.domain, contractId: item.contract.id, version: item.contract.version })
    }
    await f.stop()
    const db = new DatabaseSync(join(f.directory, 'ruihang.sqlite'), { readOnly: true })
    try {
      expect(db.prepare('SELECT supplier_id FROM auxiliary_contract_records WHERE id=?').get(savedCompany.id)).toMatchObject({ supplier_id: supplier.id })
      expect(db.prepare('SELECT COUNT(*) AS count FROM auxiliary_contract_receipts WHERE command_id=?').get(observed.command)).toMatchObject({ count: 1 })
      for (const payment of savedPayments) {
        expect(db.prepare('SELECT contract_domain,contract_id,company_expense_contract_id,contract_version FROM payment_applications WHERE id=?').get(payment.id)).toMatchObject({ contract_domain: payment.domain, contract_id: payment.domain === 'company' ? null : payment.contractId, company_expense_contract_id: payment.domain === 'company' ? payment.contractId : null, contract_version: payment.version })
        expect(db.prepare('SELECT COUNT(*) AS count FROM payment_applications WHERE name=?').get(`合成${payment.domain}付款申请`)).toMatchObject({ count: 1 })
      }
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    }
    finally { db.close() }
    await f.start()
    await f.login()
    for (const payment of savedPayments) {
      const read = await f.request(`/api/read/finance/payment_application/form/${payment.id}`)
      expect(read.ok(), await read.text()).toBe(true)
      expect((await read.json()).draft.contractReference).toEqual({ domain: payment.domain, id: payment.contractId, version: payment.version })
    }
  }
  finally { await f.cleanup() }
})

test('正式会话失效后不能按旧权限保存公司合同付款', async ({ page }, info) => {
  test.setTimeout(120_000)
  const entry = process.env.CRM_COMPANY_PAYMENT_E2E_ENTRY
  if (!entry)
    throw new Error('必须显式指定项目内全新隔离生产构建入口。')
  const f = await createCrewWorkerProductionFixture(page, info, { serverEntry: entry, requireIsolated: true })
  const identity = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner' }
  try {
    await f.start()
    await f.login()
    const supplierResponse = await f.request('/api/commands/suppliers', { method: 'POST', data: { ...identity, requiredCapability: 'supplier:write', commandId: 'revoke-ui-supplier', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成失权分供方', supplierCategory: '其他', contact: '合成人' } } })
    expect(supplierResponse.ok(), await supplierResponse.text()).toBe(true)
    const supplier = await supplierResponse.json() as { id: string, version: string }
    const contractResponse = await f.request('/api/commands/auxiliary-contracts', { method: 'POST', data: { ...identity, requiredCapability: 'auxiliary-contract:write', commandId: 'revoke-ui-company', baseVersion: null, action: 'draft', attachments: {}, draft: { kind: 'company_expense', name: '合成失权公司合同', supplierId: supplier.id, supplierVersion: supplier.version } } })
    expect(contractResponse.ok(), await contractResponse.text()).toBe(true)
    await page.goto(`${f.origin}/finance/payment/new`)
    await page.getByRole('button', { name: '公司付款', exact: true }).click()
    await page.getByTestId('finance-name').fill('失权不可保存的合成申请')
    await page.getByRole('combobox', { name: '检索分供方' }).fill('合成失权分供方')
    await page.getByRole('option', { name: /合成失权分供方/ }).click()
    await page.getByRole('combobox', { name: '检索支出合同' }).fill('合成失权公司合同')
    await page.getByRole('option', { name: /合成失权公司合同/ }).click()
    const logout = await f.request('/api/auth/logout', { method: 'POST', data: {} })
    expect(logout.ok(), await logout.text()).toBe(true)
    const denied = page.waitForResponse(response => response.status() === 401 && response.url().includes('/api/'))
    await page.getByRole('button', { name: '保存草稿', exact: true }).click()
    expect((await denied).status()).toBe(401)
    await f.stop()
    const db = new DatabaseSync(join(f.directory, 'ruihang.sqlite'), { readOnly: true })
    try {
      expect(db.prepare('SELECT id FROM payment_applications WHERE name=?').all('失权不可保存的合成申请')).toEqual([])
    }
    finally { db.close() }
  }
  finally { await f.cleanup() }
})
