import { expect, test } from '@playwright/test'

test('发票台账打印入口：进入双栏选择、打印确认并返回台账', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, '__invoiceLedgerPrintCalls', {
      configurable: true,
      writable: true,
      value: 0,
    })
    window.print = () => {
      const target = window as Window & { __invoiceLedgerPrintCalls: number }
      target.__invoiceLedgerPrintCalls += 1
    }
  })

  await page.goto('/finance/ledger')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: '打印 PDF', exact: true }).click()

  await expect(page.getByRole('button', { name: '返回台账', exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: '待打印发票列表' })).toBeVisible()
  await expect(page.getByTestId('invoice-print-summary')).toContainText('已勾')

  await page.getByRole('button', { name: '打印选中', exact: true }).click()
  expect(await page.evaluate(() => (window as Window & { __invoiceLedgerPrintCalls: number }).__invoiceLedgerPrintCalls)).toBe(1)
  const confirmation = page.getByRole('dialog', { name: '确认打印结果' })
  await expect(confirmation).toBeVisible()
  await expect(page.getByRole('button', { name: '返回台账', exact: true })).toBeHidden()
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  await expect(confirmation).toBeHidden()

  await page.getByRole('button', { name: '返回台账', exact: true }).click()
  await expect(page.getByRole('button', { name: '打印 PDF', exact: true })).toBeVisible()
  expect(pageErrors, '台账打印入口不应产生客户端运行错误').toEqual([])
})
