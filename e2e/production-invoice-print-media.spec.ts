import { expect, test } from '@playwright/test'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'

test.skip(process.env.CRM_INVOICE_ACCEPTANCE !== '1', '仅在明确指定的独立测试层构建与合成数据中运行')

test('中央打印只在受控动作中开放票面，提示与未打印清单不进入纸面', async ({ page }, info) => {
  const entry = process.env.CRM_INVOICE_E2E_ENTRY
  if (!entry)
    throw new Error('必须指定包含发票测试层的隔离构建入口。')
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: entry, requireIsolated: true })
  try {
    await page.addInitScript(() => {
      window.print = () => {
        const target = window as unknown as { controlledPrintOpen: boolean }
        target.controlledPrintOpen = !document.querySelector('.central-print-unverified')
        window.dispatchEvent(new Event('afterprint'))
      }
    })
    await fixture.start()
    await fixture.login()
    await page.goto(`${fixture.origin}/invoice-print-media-acceptance`)
    await page.getByLabel('选择发票 MEDIA-SCAN').check()
    await page.getByLabel('选择发票 MEDIA-EXCEL').check()
    await page.getByRole('button', { name: '打印所选' }).click()
    const excluded = page.getByRole('region', { name: '不能打印的发票' })
    const output = page.locator('.invoice-print-output')
    await expect(excluded).toBeVisible()
    await page.emulateMedia({ media: 'print' })
    await expect(excluded).toHaveCSS('display', 'none')
    await expect(output).toHaveCSS('display', 'none')
    await page.emulateMedia({ media: 'screen' })
    await page.getByRole('button', { name: '打印选中' }).click()
    const busy = page.getByText('正在处理打印，请稍候。')
    await expect(busy).toBeVisible()
    await page.emulateMedia({ media: 'print' })
    await expect(busy).toHaveCSS('display', 'none')
    await expect(excluded).toHaveCSS('display', 'none')
    await expect(output).toHaveCSS('display', 'none')
    await page.emulateMedia({ media: 'screen' })
    await page.evaluate(() => (window as unknown as { releaseInvoiceMediaOriginal: () => void }).releaseInvoiceMediaOriginal())
    await expect.poll(() => page.evaluate(() => (window as unknown as { controlledPrintOpen: boolean }).controlledPrintOpen)).toBe(true)
    await expect(page.getByRole('button', { name: '已打印' })).toBeFocused()
    await page.emulateMedia({ media: 'print' })
    await expect(output).toHaveCSS('display', 'none')
    await page.locator('.central-print-unverified').evaluate(element => element.classList.remove('central-print-unverified'))
    await expect(output).toHaveCSS('display', 'block')
    await expect(output.locator('[data-print-invoice-id="media-scan"]')).toHaveCSS('visibility', 'visible')
    await expect(excluded).toHaveCSS('display', 'none')
    await page.emulateMedia({ media: 'screen' })
  }
  finally {
    await fixture.cleanup()
  }
})
