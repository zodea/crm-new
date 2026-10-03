import { expect, test } from '@playwright/test'
import { updateProductionSnapshot } from './helpers/browser-production-snapshot'

for (const input of [
  { label: '单张归档票', numbers: ['26442000000000000501'], amounts: [113] },
  { label: '多张归档票', numbers: ['26442000000000000502', '26442000000000000503'], amounts: [226, 339] },
]) {
  test(`发票台账打印入口：双栏选择、取消打印确认并返回：${input.label}`, async ({ page }) => {
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

    await page.clock.setFixedTime(new Date('2026-09-11T04:00:00.000Z'))
    await page.goto('/finance/ledger')
    await expect(page.getByRole('button', { name: '打印 PDF', exact: true })).toBeVisible()
    await updateProductionSnapshot(page, (database) => {
      database.run('DELETE FROM invoices')
      for (const [index, number] of input.numbers.entries()) {
        database.run(`INSERT INTO invoices (id, invoice_number, invoice_date, seller, invoice_type, total_amount, owner_kind, account_status, review_status, ocr_status, source)
        VALUES (?, ?, '2026-09-11', '合成打印供方', '增值税普通发票', ?, 'personal', 'archived', 'reviewed', 'done', 'scan')`, [`print-ledger-${index}`, number, input.amounts[index]])
      }
    })
    await page.reload()
    await expect(page.getByRole('button', { name: '打印 PDF', exact: true })).toBeVisible()
    await expect(page.getByRole('main')).toContainText(`共 ${input.numbers.length} 张`)
    await page.getByRole('button', { name: '打印 PDF', exact: true }).click()

    await expect(page.getByRole('button', { name: '返回台账', exact: true })).toBeVisible()
    await expect(page.getByRole('complementary', { name: '待打印发票列表' })).toBeVisible()
    await expect(page.getByTestId('invoice-print-summary')).toContainText(`已勾 ${input.numbers.length} 张`)

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
}
