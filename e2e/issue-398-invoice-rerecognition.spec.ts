import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test('编辑页重新识别后保存新字段，四档视口可操作', async ({ page }) => {
  let attempt = 0
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/ocr/recognize', (route) => {
    attempt++
    const markdown = `电子发票（普通发票）
发票号码：${attempt === 1 ? '26442000000000000398' : '26442000000000000399'}
开票日期：2026年09月05日
购买方名称：瑞航建设
销售方名称：审计回归供应商
合计 ¥${attempt === 1 ? '100.00' : '200.00'} ¥${attempt === 1 ? '13.00' : '26.00'}
价税合计（小写）¥${attempt === 1 ? '113.00' : '226.00'}`
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      engine: 'paddleocr-official-api',
      model: 'PaddleOCR-VL-1.6',
      jobId: `audit-${attempt}`,
      pages: [{ pageIndex: 0, markdown, prunedResult: {}, layoutRegions: [] }],
      markdownPages: [markdown],
      dataInfo: { numPages: 1 },
    }) })
  })
  await page.goto('/finance/invoice')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传发票', exact: true }).click()
  await (await chooser).setFiles({ name: 'audit-398.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
  await expect(page.getByLabel('单据编号', { exact: true })).toHaveValue('26442000000000000398')
  // 用本应用现有路由打开编辑页，保留上传会话中的原文件。
  await page.evaluate(async () => {
    const app = (document.querySelector('#__nuxt') as any).__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('invoice')
    const invoice = store.list.find((row: { fileName: string }) => row.fileName === 'audit-398.png')
    await app.config.globalProperties.$router.push(`/finance/invoice/${invoice.id}`)
  })
  await page.getByRole('button', { name: '重新识别', exact: true }).click()
  await expect(page.getByLabel('单据编号', { exact: true })).toHaveValue('26442000000000000399')
  await expect(page.getByLabel('价税合计', { exact: true })).toHaveValue('226')
  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await expectNoPageOverflow(page, `发票重新识别 @ ${width}px`)
  }
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page).toHaveURL(/\/finance\/ledger$/)
  expect(await page.evaluate(() => {
    const app = (document.querySelector('#__nuxt') as any).__vue_app__
    const invoice = app.config.globalProperties.$pinia._s.get('invoice').list.find((row: { fileName: string }) => row.fileName === 'audit-398.png')
    return { number: invoice.invoiceNumber, total: invoice.totalAmount }
  })).toEqual({ number: '26442000000000000399', total: 226 })
  expect(errors).toEqual([])
})
