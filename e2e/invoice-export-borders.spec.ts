import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { readInvoiceWorkbookStyleReadback } from '../app/lib/invoice/excel'
import { updateProductionSnapshot } from './helpers/browser-production-snapshot'

async function installFixture(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
  })
  await page.goto('/finance/ledger')
  await expect(page.getByRole('button', { name: '导出 Excel', exact: true })).toBeVisible({ timeout: 60_000 })
  await updateProductionSnapshot(page, (database) => {
    database.run(`INSERT INTO invoices (
      id, invoice_number, invoice_date, seller, invoice_type, total_amount,
      owner_kind, account_status, review_status, ocr_status, source
    ) VALUES ('invoice-border-e2e', '000043700001', '2026-09-11', '合成边框验证供应商',
      '增值税普通发票', 123.45, 'personal', 'archived', 'reviewed', 'done', 'excel')`)
    database.run(`INSERT INTO invoice_export_settings (id, settings_json) VALUES ('default', ?)`, [JSON.stringify({
      freezeRows: 4,
      mergeRepeatedValues: false,
      border: {
        top: { style: 'thin', color: 'FF112233' },
        bottom: { style: 'thin', color: 'FF112233' },
        left: { style: 'thin', color: 'FF112233' },
        right: { style: 'thin', color: 'FF112233' },
      },
    })])
  })
  await page.reload()
}

async function openPreview(page: Page) {
  await expect(page.getByRole('main')).toContainText('合成边框验证供应商', { timeout: 30_000 })
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导出 Excel 预览与样式设置' })
  await expect(dialog.getByRole('button', { name: '确认导出' })).toBeEnabled()
  return dialog
}

test.describe('Issue #437 发票 Excel 分组边框', () => {
  test.use({ timezoneId: 'Asia/Shanghai' })
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-11T00:30:00+08:00'))
  })
  test.setTimeout(120_000)
  test('旧默认继承、两组编辑、保存刷新及实际下载 XLSX 回读一致', async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await installFixture(page)
    let dialog = await openPreview(page)
    await expect(dialog).toContainText('发票台账_2026-09-11.xlsx')
    await expect(dialog.getByRole('combobox', { name: '金额格式' })).toHaveValue('0.00_);[Red]\\(0.00\\)')
    await expect(dialog.getByRole('combobox', { name: '金额格式' }).locator('option:checked')).toHaveText('1234.56（负数红色括号）')
    await expect(dialog.getByRole('textbox', { name: '表头上边框颜色' })).toHaveValue('FF112233')
    await expect(dialog.getByRole('textbox', { name: '数据行上边框颜色' })).toHaveValue('FF112233')
    const header = { top: ['medium', '#123456'], bottom: ['dashed', 'FF234567'], left: ['dotted', 'FF345678'], right: ['thin', 'FF456789'] }
    const data = { top: ['dotted', 'FF56789A'], bottom: ['thin', 'FF6789AB'], left: ['medium', 'FF789ABC'], right: ['none', 'FF89ABCD'] }
    for (const [label, borders] of [['表头', header], ['数据行', data]] as const) {
      for (const [side, sideLabel] of [['top', '上'], ['bottom', '下'], ['left', '左'], ['right', '右']] as const) {
        await dialog.getByRole('combobox', { name: `${label}${sideLabel}边框线型` }).selectOption(borders[side][0]!)
        await dialog.getByRole('textbox', { name: `${label}${sideLabel}边框颜色` }).fill(borders[side][1]!)
      }
    }
    await expect(dialog.locator('thead th').first()).toHaveCSS('border-top-style', 'solid')
    await expect(dialog.locator('thead th').first()).toHaveCSS('border-top-width', '2px')
    await expect(dialog.locator('thead th').first()).toHaveCSS('border-top-color', 'rgb(18, 52, 86)')
    await expect(dialog.locator('tbody tr').first().locator('td').nth(4)).toContainText('增值税普通发票')
    await expect(dialog.locator('tbody tr').first().locator('td').nth(5)).toContainText('123.45')
    await dialog.getByRole('button', { name: '保存为台账默认样式' }).click()
    await expect(dialog.getByText('已保存', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.reload()
    dialog = await openPreview(page)
    await expect(dialog.getByRole('textbox', { name: '表头上边框颜色' })).toHaveValue('FF123456')
    await expect(dialog.getByRole('combobox', { name: '数据行右边框线型' })).toHaveValue('none')
    await expect(dialog.getByRole('spinbutton', { name: '冻结行数' })).toHaveValue('4')
    const downloadEvent = page.waitForEvent('download')
    await dialog.getByRole('button', { name: '确认导出' }).click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toBe('发票台账_2026-09-11.xlsx')
    const filePath = testInfo.outputPath('invoice-borders.xlsx')
    await download.saveAs(filePath)
    const readback = await readInvoiceWorkbookStyleReadback(new Uint8Array(await readFile(filePath)))
    expect(readback.issues).toEqual([])
    const sheet = readback.sheets[0]!
    expect(sheet.freezeRows).toBe(4)
    expect(sheet.cells.A2?.border).toEqual({
      top: { style: 'medium', color: 'FF123456' },
      bottom: { style: 'dashed', color: 'FF234567' },
      left: { style: 'dotted', color: 'FF345678' },
      right: { style: 'thin', color: 'FF456789' },
    })
    expect(sheet.cells.A3?.border).toEqual({
      top: { style: 'dotted', color: 'FF56789A' },
      bottom: { style: 'thin', color: 'FF6789AB' },
      left: { style: 'medium', color: 'FF789ABC' },
      right: { style: 'none', color: 'FF89ABCD' },
    })
    expect(sheet.cells.A1?.border.top).toEqual({ style: 'thin', color: 'FF112233' })
    expect(sheet.cells.A4?.border.top).toEqual({ style: 'thin', color: 'FF112233' })
    expect(errors).toEqual([])
  })

  test('五档视口保留局部滚动、两组可编辑与弹窗键盘焦点，取消恢复不改默认', async ({ page }) => {
    await installFixture(page)
    let dialog = await openPreview(page)
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      const box = await dialog.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
      const table = dialog.getByTestId('invoice-export-preview-table')
      const scroll = table.locator('..')
      await scroll.scrollIntoViewIfNeeded()
      await scroll.evaluate((element) => {
        element.scrollLeft = element.scrollWidth
      })
      expect(await scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      await scroll.evaluate((element) => {
        element.scrollLeft = 0
      })
      for (const role of ['表头', '数据行']) {
        const color = dialog.getByRole('textbox', { name: `${role}上边框颜色` })
        await color.fill('#ABCDEF')
        await color.focus()
        await expect(color).toBeFocused()
        const group = dialog.getByRole('group', { name: `${role}边框`, exact: true })
        await group.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
        const groupBox = (await group.boundingBox())!
        const footerBox = (await dialog.getByText('导出文件会包含当前设置、标题带、格式、合并单元格和合计行。', { exact: true }).boundingBox())!
        expect(groupBox.y).toBeGreaterThan(box!.y)
        expect(groupBox.y + groupBox.height).toBeLessThanOrEqual(footerBox.y)
      }
      await dialog.getByRole('button', { name: '确认导出' }).focus()
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
      const layering = await dialog.evaluate(element => Number(getComputedStyle(element).zIndex))
      expect(layering).toBeGreaterThan(0)
    }
    await dialog.getByRole('textbox', { name: '表头上边框颜色' }).fill('#')
    await dialog.getByRole('button', { name: '确认导出' }).click()
    await expect(dialog.getByRole('alert')).toContainText('边框颜色')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    dialog = await openPreview(page)
    await expect(dialog.getByRole('textbox', { name: '表头上边框颜色' })).toHaveValue('FF112233')
    await dialog.getByRole('button', { name: '恢复默认' }).click()
    await expect(dialog.getByRole('textbox', { name: '表头上边框颜色' })).toHaveValue('FF000000')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    dialog = await openPreview(page)
    await expect(dialog.getByRole('textbox', { name: '表头上边框颜色' })).toHaveValue('FF112233')
  })
})
