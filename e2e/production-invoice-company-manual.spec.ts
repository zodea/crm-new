import process from 'node:process'
import { expect, test } from '@playwright/test'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'

test.skip(process.env.CRM_INVOICE_ACCEPTANCE !== '1', '仅在明确指定的独立测试层构建与合成数据库中运行')

test('手工发票在工作台选择公司开销、已有合同与购销主体后归档', async ({ page }, info) => {
  test.setTimeout(180_000)
  const entry = process.env.CRM_INVOICE_E2E_ENTRY
  if (!entry)
    throw new Error('必须指定包含发票工作台测试层的隔离构建入口。')
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: entry, requireIsolated: true })
  const identity = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner' }
  async function post<T>(path: string, data: unknown): Promise<T> {
    const response = await fixture.request(path, { method: 'POST', data })
    expect(response.ok(), await response.text()).toBe(true)
    return await response.json() as T
  }
  try {
    await fixture.start()
    await fixture.login()
    const supplier = await post<{ id: string, version: string }>('/api/commands/suppliers', { ...identity, requiredCapability: 'supplier:write', commandId: 'manual-company-supplier', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成公司分供方', taxNo: 'SYNTHETIC-SELLER', supplierCategory: '其他', contact: '合成联系人' } })
    const buyer = await post<{ id: string, version: string }>('/api/commands/our-signatories', { ...identity, requiredCapability: 'our-signatory:write', commandId: 'manual-company-buyer', baseVersion: null, draft: { name: '合成我方公司', taxNo: 'SYNTHETIC-BUYER', registeredAddress: null, legalRepresentative: null, verificationNote: '', status: 'active' } })
    const contract = await post<{ id: string, version: string }>('/api/commands/auxiliary-contracts', { ...identity, requiredCapability: 'auxiliary-contract:write', commandId: 'manual-company-contract', baseVersion: null, action: 'draft', attachments: {}, draft: { kind: 'company_expense', name: '合成公司支出合同', no: 'SYNTHETIC-COMPANY', category: '房租', supplierId: supplier.id, supplierVersion: supplier.version, ourSignatoryId: buyer.id, ourSignatoryVersion: buyer.version } })
    await page.goto(`${fixture.origin}/invoice-workspace-acceptance`)
    await page.getByRole('button', { name: '手工新建' }).click()
    await expect(page).toHaveURL(/\/finance\/invoice\/manual-new$/)
    const manual = page.getByRole('region', { name: '手工新建发票' })
    await manual.getByLabel('发票号码').fill('MANUAL-COMPANY-001')
    await manual.getByLabel('开票日期').fill('2026-10-07')
    await manual.getByLabel('购买方', { exact: true }).fill('合成我方公司')
    await manual.getByLabel('购买方税号').fill('SYNTHETIC-BUYER')
    await manual.getByLabel('销售方', { exact: true }).fill('合成公司分供方')
    await manual.getByLabel('销售方税号').fill('SYNTHETIC-SELLER')
    await manual.getByLabel('税额').fill('0')
    await manual.getByLabel('价税合计').fill('100')
    const created = page.waitForResponse(response => response.url().endsWith('/api/commands/invoices') && response.request().method() === 'POST' && (response.request().postDataJSON() as { action?: string }).action === 'manual')
    await manual.getByRole('button', { name: '保存草稿' }).click()
    const createdResponse = await created
    expect(createdResponse.ok(), await createdResponse.text()).toBe(true)
    const invoice = await createdResponse.json() as { invoiceId: string, version: string }
    await expect(page).toHaveURL(new RegExp(`invoice=${encodeURIComponent(invoice.invoiceId)}`))
    await expect(page.getByRole('region', { name: '发票队列' }).getByRole('button', { name: /MANUAL-COMPANY-001/ })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '确认人工补全' }).click()
    const owner = page.getByLabel('归属类型')
    await expect(owner.locator('option[value="personal"]')).toHaveCount(0)
    await owner.selectOption('company')
    await page.getByLabel('我方购买公司').selectOption(buyer.id)
    await page.getByLabel('分供方公司').selectOption(supplier.id)
    const archive = page.getByRole('button', { name: '归档发票' })
    await expect(archive).toBeDisabled()
    const contractSelect = page.getByRole('region', { name: '发票归属' }).getByLabel('公司支出合同')
    const contractOption = contractSelect.locator('option').filter({ hasText: contract.id })
    await expect(contractOption).toHaveCount(1)
    const contractValue = await contractOption.getAttribute('value')
    expect(contractValue).toBeTruthy()
    await contractSelect.selectOption(contractValue!)
    await expect(archive).toBeEnabled()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      const reviewTab = page.getByRole('tab', { name: '校对' })
      if (await reviewTab.isVisible())
        await reviewTab.click()
      await owner.focus()
      await expect(owner).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    }
    await archive.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('SYNTHETIC-BUYER')
    await expect(dialog).toContainText('SYNTHETIC-SELLER')
    const submitted = page.waitForResponse(response => response.url().endsWith('/api/commands/invoices') && response.request().method() === 'POST' && (response.request().postDataJSON() as { action?: string }).action === 'archive')
    await dialog.getByRole('button', { name: '已核对并归档' }).click()
    const response = await submitted
    expect(response.ok(), await response.text()).toBe(true)
    expect(response.request().postDataJSON()).toMatchObject({ invoiceId: invoice.invoiceId, ownerKind: 'company', projectId: null, supplierId: supplier.id, contract: { domain: 'company', id: contract.id, version: contract.version }, taxNumbersConfirmed: true, taxVerification: { buyerId: buyer.id, buyerVersion: buyer.version, supplierVersion: supplier.version } })
    const read = await fixture.request(`/api/read/invoices/${encodeURIComponent(invoice.invoiceId)}`)
    expect(read.ok(), await read.text()).toBe(true)
    expect(await read.json()).toMatchObject({ record: { id: invoice.invoiceId, sourceKind: 'manual', ownerKind: 'company', projectId: null, supplierId: supplier.id, contract: { domain: 'company', id: contract.id, version: contract.version }, accountStatus: 'archived', fields: { buyerTaxNo: 'SYNTHETIC-BUYER', sellerTaxNo: 'SYNTHETIC-SELLER', totalAmount: 100 } } })
  }
  finally {
    await fixture.cleanup()
  }
})
