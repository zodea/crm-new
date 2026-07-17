import { expect, test } from '@playwright/test'

test('发票打印排版：1/2/4 张、勾选合计、旋转、打印确认与计数持久化', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, '__invoicePrintCalls', {
      configurable: true,
      writable: true,
      value: 0,
    })
    window.print = () => {
      const target = window as Window & { __invoicePrintCalls: number }
      target.__invoicePrintCalls += 1
    }
  })

  await page.goto('/finance/invoice')
  await page.waitForLoadState('networkidle')
  await page.getByRole('tab', { name: '打印排版', exact: true }).click()

  const perPage = page.getByLabel('每页张数')
  const summary = page.getByTestId('invoice-print-summary')
  const preview = page.getByTestId('invoice-print-preview')
  await expect(perPage).toHaveValue('2')
  await expect(summary).toHaveText('已勾 7 张 · 4 页 A4 · 金额合计 ¥379,340.00')
  await expect(preview.locator('[data-print-invoice-id]')).toHaveCount(2)
  await expect(preview.locator('[data-print-invoice-id]').first().locator('svg text').first()).toHaveCSS('font-size', '17px')
  await page.getByLabel('勾选发票 09442026000058760').click()
  await expect(summary).toHaveText('已勾 6 张 · 3 页 A4 · 金额合计 ¥250,700.00')
  await page.getByLabel('勾选发票 09442026000058760').click()
  await expect(summary).toHaveText('已勾 7 张 · 4 页 A4 · 金额合计 ¥379,340.00')
  await page.getByLabel('全选发票').click()
  await expect(summary).toHaveText('已勾 0 张 · 0 页 A4 · 金额合计 ¥0.00')
  await expect(preview.locator('[data-print-invoice-id]')).toHaveCount(2)
  await page.getByLabel('全选发票').click()
  await expect(summary).toHaveText('已勾 7 张 · 4 页 A4 · 金额合计 ¥379,340.00')

  await perPage.selectOption('1')
  await expect(summary).toContainText('已勾 7 张 · 7 页 A4')
  await expect(preview.locator('[data-print-invoice-id]')).toHaveCount(1)
  await perPage.selectOption('4')
  await expect(summary).toContainText('已勾 7 张 · 2 页 A4')
  await expect(preview.locator('[data-print-invoice-id]')).toHaveCount(4)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByText('第 2 / 2 页', { exact: true })).toBeVisible()
  await expect(preview.locator('[data-print-invoice-id]')).toHaveCount(3)

  await perPage.selectOption('2')
  await expect(page.getByText('第 1 / 4 页', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '选择发票 scan_0609_007.pdf', exact: true }).click()
  await expect(page.getByText('第 3 / 4 页', { exact: true })).toBeVisible()
  await expect(preview.locator('[data-print-invoice-id="inv_demo_005"]')).toBeVisible()
  await page.getByRole('button', { name: '选择发票 09442026000058760', exact: true }).click()
  await expect(page.getByText('第 1 / 4 页', { exact: true })).toBeVisible()
  const firstInvoice = preview.locator('[data-print-invoice-id="inv_demo_001"]')
  const secondInvoice = preview.locator('[data-print-invoice-id="inv_demo_002"]')
  await firstInvoice.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '旋转 90°', exact: true }).click()
  await expect(firstInvoice).toHaveAttribute('data-rotation', '90')
  await page.getByRole('button', { name: '整页旋转 90°', exact: true }).click()
  await expect(firstInvoice).toHaveAttribute('data-rotation', '180')
  await expect(secondInvoice).toHaveAttribute('data-rotation', '90')
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.invoice-print-output')).toHaveCSS('display', 'block')
  await expect(preview).toHaveCSS('visibility', 'hidden')
  const printedSecond = page.locator('.invoice-print-output [data-print-invoice-id="inv_demo_002"]')
  await expect(printedSecond).toHaveCSS('visibility', 'visible')
  await expect(printedSecond.locator('[style*="rotate(90deg)"]')).toHaveCSS('transform', 'matrix(0, 0.7, -0.7, 0, 0, 0)')
  await page.emulateMedia({ media: 'screen' })
  await page.getByLabel('勾选发票 09442026000058761').click()
  await expect(summary).toHaveText('已勾 6 张 · 3 页 A4 · 金额合计 ¥334,140.00')

  await page.getByRole('button', { name: '打印选中', exact: true }).click()
  expect(await page.evaluate(() => (window as Window & { __invoicePrintCalls: number }).__invoicePrintCalls)).toBe(1)
  let confirm = page.getByRole('dialog', { name: '确认打印结果' })
  await confirm.getByRole('button', { name: '取消', exact: true }).click()
  await expect(firstInvoice).toContainText('打印 0 次')

  await page.getByRole('button', { name: '打印选中', exact: true }).click()
  expect(await page.evaluate(() => (window as Window & { __invoicePrintCalls: number }).__invoicePrintCalls)).toBe(2)
  confirm = page.getByRole('dialog', { name: '确认打印结果' })
  await expect(confirm).toContainText('6 张发票')
  await expect(confirm).toContainText('3 页 A4')
  await expect(confirm).toContainText('¥334,140.00')
  await expect(page.locator('.invoice-print-output [data-print-invoice-id="inv_demo_001"]')).toHaveAttribute('data-rotation', '180')
  await expect(page.locator('.invoice-print-output [data-print-invoice-id="inv_demo_002"]')).toHaveCount(0)
  await confirm.getByRole('button', { name: '已打印', exact: true }).click()
  await expect(page.locator('[data-sonner-toaster][data-y-position="top"]')
    .getByText('已记录 6 张发票的打印次数', { exact: true })).toBeVisible()
  await expect(firstInvoice).toContainText('打印 1 次')

  await page.getByRole('tab', { name: '字段校对', exact: true }).click()
  await page.getByRole('tab', { name: '打印排版', exact: true }).click()
  await expect(preview.locator('[data-print-invoice-id="inv_demo_001"]')).toHaveAttribute('data-rotation', '180')
  await expect(preview.locator('[data-print-invoice-id="inv_demo_001"]')).toContainText('打印 1 次')
  await expect(preview.locator('[data-print-invoice-id="inv_demo_002"]')).toHaveAttribute('data-rotation', '0')
  await expect(preview.locator('[data-print-invoice-id="inv_demo_002"]')).toContainText('打印 0 次')
  expect(pageErrors, '打印排版旅程不应产生客户端运行错误').toEqual([])
})
