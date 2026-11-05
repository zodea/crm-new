import process from 'node:process'
import { expect, test } from '@playwright/test'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'

test.skip(process.env.CRM_INVOICE_ACCEPTANCE !== '1', '仅在明确指定的独立测试层构建与合成数据库中运行')

test('手工草稿响应丢失后重启并刷新，以原编号恢复且不重复建票', async ({ page }, info) => {
  test.setTimeout(180_000)
  const entry = process.env.CRM_INVOICE_E2E_ENTRY
  if (!entry)
    throw new Error('必须指定包含发票工作台测试层的隔离构建入口。')
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: entry, requireIsolated: true })
  let originalCommand = ''
  let creates = 0
  try {
    await fixture.start()
    await fixture.login()
    await page.goto(`${fixture.origin}/invoice-workspace-acceptance`)
    await page.getByRole('button', { name: '手工新建' }).click()
    const manual = page.getByRole('region', { name: '手工新建发票' })
    await manual.getByLabel('发票号码').fill('RECOVERY-MANUAL-001')
    await manual.getByLabel('销售方', { exact: true }).fill('合成销售方')
    await page.route('**/api/commands/invoices', async (route) => {
      const request = route.request()
      const command = request.method() === 'POST' ? request.postDataJSON() as { action?: string, commandId?: string } : null
      if (command?.action !== 'manual') {
        await route.continue()
        return
      }
      creates++
      originalCommand = command.commandId ?? ''
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusCode: 503, statusMessage: '合成响应丢失' }) })
    })
    await manual.getByRole('button', { name: '保存草稿' }).click()
    await expect(page.getByRole('button', { name: '核对上次提交' })).toBeVisible()
    expect(originalCommand).toBeTruthy()
    expect(await manual.getByLabel('发票号码').inputValue()).toBe('RECOVERY-MANUAL-001')
    await expect(manual.getByLabel('发票号码')).toBeDisabled()
    const stored = await page.evaluate(() => Object.values(sessionStorage).filter(value => value.includes('finance-invoice')))
    expect(stored).toHaveLength(1)
    expect(stored[0]).toContain(originalCommand)
    expect(stored[0]).not.toContain('RECOVERY-MANUAL-001')
    await fixture.stop()
    await fixture.start()
    await page.reload()
    await expect(page.getByRole('region', { name: '进入本机工作区' })).toBeVisible()
    await fixture.login()
    await page.goto(`${fixture.origin}/finance/invoice/manual-new`)
    await expect(page.getByRole('button', { name: '核对上次提交' })).toBeVisible()
    await page.reload()
    await expect(page).toHaveURL(`${fixture.origin}/finance/invoice/manual-new`)
    await expect(page.getByRole('button', { name: '核对上次提交' })).toBeVisible()
    const resolution = page.waitForRequest(request => request.url().endsWith('/api/commands/invoices/resolve') && request.method() === 'POST')
    await page.getByRole('button', { name: '核对上次提交' }).click()
    expect((await resolution).postDataJSON()).toMatchObject({ commandId: originalCommand })
    await expect(page).toHaveURL(/\?invoice=/)
    const invoiceId = new URL(page.url()).searchParams.get('invoice')
    expect(invoiceId).toBeTruthy()
    await expect(page.getByRole('region', { name: '发票队列' }).getByRole('button', { name: /RECOVERY-MANUAL-001/ })).toHaveAttribute('aria-pressed', 'true')
    const read = await fixture.request(`/api/read/invoices/${encodeURIComponent(invoiceId!)}`)
    expect(read.ok(), await read.text()).toBe(true)
    expect(await read.json()).toMatchObject({ record: { id: invoiceId, sourceKind: 'manual', ownerKind: null, accountStatus: 'none', fields: { invoiceNumber: 'RECOVERY-MANUAL-001', seller: '合成销售方' } } })
    expect(creates).toBe(1)
    expect(await page.evaluate(command => Object.values(sessionStorage).some(value => value.includes(command)), originalCommand)).toBe(false)
  }
  finally {
    await fixture.cleanup()
  }
})
